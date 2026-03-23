import express from 'express';
import cors from 'cors';
import { execFile, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { wbsLoader } from './lib/wbs-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Resolve rover binary ──────────────────────────────────────────────────
// Priority: ROVER_BIN env var → local monorepo build → npm global → system 'rover'
function resolveRoverBin() {
  if (process.env.ROVER_BIN) return process.env.ROVER_BIN;

  // Try local monorepo build first (for local development)
  const candidates = [
    path.resolve(__dirname, '../cli/dist/index.mjs'),       // packages/web → packages/cli
    path.resolve(__dirname, '../../packages/cli/dist/index.mjs'), // root check
  ];
  for (const p of candidates) {
    if (existsSync(p)) return `node "${p}"`;
  }

  // Try common npm global binary locations (for Railway / Docker deployments)
  const globalCandidates = [
    '/usr/local/bin/rover',
    '/usr/bin/rover',
    '/root/.npm-global/bin/rover',
    path.join(process.env.HOME || '/root', '.npm/bin/rover'),
  ];
  for (const p of globalCandidates) {
    if (existsSync(p)) return p;
  }

  return 'rover'; // fall back to system PATH lookup
}

const ROVER_BIN = resolveRoverBin();
const IS_NODE_INVOKE = ROVER_BIN.startsWith('node ');

// ── App setup ─────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3700;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Public health check (before auth) ─────────────────────────────────────
app.get('/api/health', (_req, res) => {
  // If the binary path was resolved to an explicit path (not the fallback 'rover'),
  // verify it exists on disk — no need to execute it (Docker may not be available on Railway).
  let roverAvailable = false;
  let roverVersion = null;
  let roverError = null;

  if (IS_NODE_INVOKE) {
    // Local monorepo build — extract the actual .mjs path and check it
    const mjsPath = ROVER_BIN.replace(/^node "?/, '').replace(/"?$/, '');
    if (existsSync(mjsPath)) {
      roverAvailable = true;
      roverVersion = 'installed (path verified)';
    } else {
      roverError = `File not found: ${mjsPath}`;
    }
  } else if (ROVER_BIN !== 'rover') {
    // Resolved to an absolute path — just check it exists
    if (existsSync(ROVER_BIN)) {
      roverAvailable = true;
      roverVersion = 'installed (path verified)';
    } else {
      roverError = `Binary not found at path: ${ROVER_BIN}`;
    }
  } else {
    // Fell back to system PATH — mark unavailable; can't verify without executing
    roverError = 'Rover binary not found in known paths; fallback to system PATH';
  }

  res.json({
    ok: true,
    authRequired: !!process.env.ROVER_WEB_TOKEN,
    version: '1.1.0',
    roverCli: {
      available: roverAvailable,
      version: roverVersion,
      path: ROVER_BIN,
      error: roverError,
    },
  });
});

// ── Auth middleware ────────────────────────────────────────────────────────
// If ROVER_WEB_TOKEN is set, all /api/* routes require Bearer token auth.
// Static files (the SPA itself) are NOT gated, so the login page can load.
const AUTH_TOKEN = process.env.ROVER_WEB_TOKEN;

function authMiddleware(req, res, next) {
  if (!AUTH_TOKEN) return next(); // No token set → open access (local dev)
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }
  
  const token = authHeader.slice(7); // strip "Bearer "
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
  }
  
  next();
}

// Apply to all API routes
app.use('/api', authMiddleware);

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Run a rover CLI command and return parsed JSON.
 * Supports both direct executables ('rover') and
 * 'node "path/to/index.mjs"' invocations for the local build.
 */
function rover(args, { cwd, timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const onResult = (err, stdout, stderr) => {
      if (err) {
        // Some commands still write valid JSON to stdout on non-zero exit
        try { return resolve(JSON.parse(stdout)); } catch { /**/ }
        return reject(new Error(stderr || stdout || err.message));
      }
      try { resolve(JSON.parse(stdout)); }
      catch { resolve({ raw: stdout }); }
    };

    if (IS_NODE_INVOKE) {
      // Shell out for 'node "path"' invocations
      const safeArgs = args.map(a => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
      exec(`${ROVER_BIN} ${safeArgs}`, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, onResult);
    } else {
      execFile(ROVER_BIN, args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, onResult);
    }
  });
}

// ── Worker Registry ──────────────────────────────────────────────────────

/**
 * Read worker URLs from env vars:
 *   WORKER_URLS=http://w1.railway.internal:3701,http://w2.railway.internal:3701
 * OR individually:
 *   WORKER_1_URL, WORKER_2_URL, ... WORKER_8_URL
 */
function getWorkerUrls() {
  if (process.env.WORKER_URLS) {
    return process.env.WORKER_URLS
      .split(',')
      .map(u => u.trim())
      .filter(Boolean);
  }
  const urls = [];
  for (let i = 1; i <= 8; i++) {
    const u = process.env[`WORKER_${i}_URL`];
    if (u) urls.push(u.trim());
  }
  return urls;
}

const WORKERS = getWorkerUrls();

const WORKER_AUTH_HEADER = AUTH_TOKEN ? `Bearer ${AUTH_TOKEN}` : undefined;

/**
 * Poll each worker's /status endpoint and return the first idle one.
 * Returns null if all workers are busy or unreachable.
 *
 * @returns {Promise<string|null>} Worker base URL or null
 */
async function getIdleWorker() {
  for (const url of WORKERS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`${url}/status`, {
        signal: controller.signal,
        headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
      });
      clearTimeout(timeout);
      if (resp.ok) {
        const data = await resp.json();
        if (!data.busy) return url;
      }
    } catch {
      // worker unreachable — skip
    }
  }
  return null;
}

/**
 * Dispatch a task payload to the first available idle worker.
 * Retries all workers if a race-condition 409 is returned.
 *
 * @param {object} taskPayload
 * @returns {Promise<{status: number, data: object, workerUrl: string}>}
 */
async function dispatchToWorker(taskPayload) {
  // Gather all worker statuses in parallel
  const statuses = await Promise.all(
    WORKERS.map(async (url) => {
      try {
        const resp = await fetch(`${url}/status`, {
          headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
          signal: AbortSignal.timeout(3000),
        });
        if (!resp.ok) return { url, idle: false };
        const data = await resp.json();
        return { url, idle: !data.busy };
      } catch {
        return { url, idle: false };
      }
    })
  );

  const idleWorkers = statuses.filter((s) => s.idle).map((s) => s.url);
  if (idleWorkers.length === 0) {
    return { status: 503, data: { error: 'All workers busy', code: 'ALL_WORKERS_BUSY' }, workerUrl: null };
  }

  // Try each idle worker in turn (race-condition safety)
  for (const url of idleWorkers) {
    try {
      const resp = await fetch(`${url}/task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {}),
        },
        body: JSON.stringify(taskPayload),
        signal: AbortSignal.timeout(10000),
      });
      const data = await resp.json();
      if (resp.status === 202) {
        // Accepted!
        return { status: 202, data, workerUrl: url };
      }
      // 409 = busy (race), try next
      if (resp.status !== 409) {
        // Any other error — return immediately
        return { status: resp.status, data, workerUrl: url };
      }
    } catch (err) {
      // Network error on this worker, try next
    }
  }

  return { status: 503, data: { error: 'All workers rejected the task', code: 'ALL_WORKERS_BUSY' }, workerUrl: null };
}

// ── API Routes ────────────────────────────────────────────────────────────

// Get WBS for a project
app.get('/api/projects/:id/wbs', async (req, res) => {
  try {
    const repoUrl = req.query.repo;
    if (!repoUrl) {
      return res.status(400).json({ error: 'repo query parameter is required' });
    }
    const branch = req.query.branch || 'main';
    const wbs = await wbsLoader.load(repoUrl, branch);
    res.json(wbs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get task detail from WBS
app.get('/api/projects/:id/tasks/:taskId', async (req, res) => {
  try {
    const repoUrl = req.query.repo;
    if (!repoUrl) {
      return res.status(400).json({ error: 'repo query parameter is required' });
    }
    const branch = req.query.branch || 'main';
    const task = await wbsLoader.getTask(repoUrl, req.params.taskId, branch);
    if (!task) {
      return res.status(404).json({ error: 'Task not found in WBS' });
    }
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List tasks — aggregate from workers when configured, else use local rover CLI
app.get('/api/tasks', async (req, res) => {
  // ── Worker aggregation ─────────────────────────────────────────────────
  if (WORKERS.length > 0) {
    try {
      const statuses = await Promise.all(
        WORKERS.map((url, i) => fetchWorkerStatus(url, i + 1))
      );
      const allTasks = [];
      await Promise.all(
        statuses.map(async (s) => {
          if (!s.online) return;
          try {
            const resp = await fetch(`${s.url}/tasks`, {
              headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
              signal: AbortSignal.timeout(3000),
            });
            if (resp.ok) {
              const workerTasks = await resp.json();
              if (Array.isArray(workerTasks)) {
                for (const wt of workerTasks) {
                  allTasks.push({
                    ...wt,
                    workerId: s.workerId || s.index,
                    workerIndex: s.index,
                    workerUrl: s.url,
                  });
                }
              }
            }
          } catch { /* worker tasks fetch failed */ }
        })
      );
      return res.json(allTasks);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Local CLI fallback (no workers configured) ─────────────────────────
  try {
    const args = ['ls', '--json'];
    if (req.query.project) args.push('--project', req.query.project);
    res.json(await rover(args));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Inspect a task
app.get('/api/tasks/:id', async (req, res) => {
  if (WORKERS.length > 0) {
    for (const url of WORKERS) {
      try {
        const resp = await fetch(`${url}/task/${req.params.id}`, {
          headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {}
        });
        if (resp.ok) return res.status(200).json(await resp.json());
      } catch { /* skip */ }
    }
    return res.status(404).json({ error: 'Task not found on any worker' });
  }

  try {
    const args = ['inspect', req.params.id, '--json'];
    if (req.query.project) args.push('--project', req.query.project);
    res.json(await rover(args));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Task logs
app.get('/api/tasks/:id/logs', async (req, res) => {
  if (WORKERS.length > 0) {
    for (const url of WORKERS) {
      try {
        const resp = await fetch(`${url}/task/${req.params.id}/logs`, {
          headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {}
        });
        if (resp.ok) return res.status(200).json(await resp.json());
      } catch { /* skip */ }
    }
    return res.status(404).json({ error: 'Task not found on any worker' });
  }

  try {
    const args = ['logs', req.params.id];
    if (req.query.iteration) args.push(req.query.iteration);
    args.push('--json');
    if (req.query.project) args.push('--project', req.query.project);
    res.json(await rover(args));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Task diff
app.get('/api/tasks/:id/diff', async (req, res) => {
  if (WORKERS.length > 0) {
    for (const url of WORKERS) {
      try {
        const taskRes = await fetch(`${url}/task/${req.params.id}`, {
          headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
          signal: AbortSignal.timeout(5000),
        });
        if (taskRes.ok) {
          // This worker has the task — get its diff
          const diffRes = await fetch(`${url}/task/${req.params.id}/diff`, {
            headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
            signal: AbortSignal.timeout(10000),
          });
          if (diffRes.ok) {
            return res.status(200).json(await diffRes.json());
          }
          // Worker has task but diff endpoint failed — return empty
          return res.status(200).json({ diff: '', diffTruncated: false, taskId: req.params.id });
        }
      } catch { /* worker unreachable, try next */ }
    }
    // No worker has this task
    return res.status(200).json({ diff: '', diffTruncated: false, taskId: req.params.id });
  }

  try {
    const args = ['diff', req.params.id, '--json'];
    if (req.query.project) args.push('--project', req.query.project);
    res.json(await rover(args));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a task — dispatches to worker pool if workers are configured
app.post('/api/tasks', async (req, res) => {
  try {
    const { description, agent, workflow, sourceBranch, targetBranch, project,
            repo, prompt, model, worktreeBranch, charter, envVars, taskId } = req.body;

    // ── Worker pool dispatch ────────────────────────────────────────────
    if (WORKERS.length > 0) {
      const taskPayload = {
        taskId,
        repo: repo || '',
        prompt: prompt || description || '',
        agent: agent || 'claude',
        model,
        worktreeBranch,
        charter,
        envVars,
      };

      const { status, data, workerUrl } = await dispatchToWorker(taskPayload);
      return res.status(status).json({ ...data, dispatchedTo: workerUrl });
    }

    // ── Local CLI fallback (no workers configured) ──────────────────────
    if (!description) return res.status(400).json({ error: 'description is required' });

    const args = ['task', '--json', '-y'];
    if (agent)        args.push('-a', agent);
    if (workflow)     args.push('-w', workflow);
    if (sourceBranch) args.push('-s', sourceBranch);
    if (targetBranch) args.push('-t', targetBranch);
    if (project)      args.push('--project', project);
    args.push(description);

    res.json(await rover(args, { timeout: 300_000 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop a task
app.post('/api/tasks/:id/stop', async (req, res) => {
  if (WORKERS.length > 0) {
    for (const url of WORKERS) {
      try {
        const resp = await fetch(`${url}/task/${req.params.id}/stop`, {
          method: 'POST',
          headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {}
        });
        if (resp.ok) return res.status(200).json(await resp.json());
      } catch { /* skip */ }
    }
    return res.status(404).json({ error: 'Task not found on any worker' });
  }

  try {
    const args = ['stop', req.params.id, '--json'];
    if (req.query.project) args.push('--project', req.query.project);
    res.json(await rover(args));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a task
app.post('/api/tasks/:id/delete', async (req, res) => {
  if (WORKERS.length > 0) {
    for (const url of WORKERS) {
      try {
        const resp = await fetch(`${url}/task/${req.params.id}`, {
          method: 'DELETE',
          headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {}
        });
        if (resp.ok) return res.status(200).json(await resp.json());
      } catch { /* skip */ }
    }
    return res.status(404).json({ error: 'Task not found on any worker' });
  }

  try {
    const args = ['delete', req.params.id, '-y', '--json'];
    if (req.query.project) args.push('--project', req.query.project);
    res.json(await rover(args));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Merge a task
app.post('/api/tasks/:id/merge', async (req, res) => {
  // Try workers first if configured
  if (WORKERS.length > 0) {
    for (const url of WORKERS) {
      try {
        const taskRes = await fetch(`${url}/task/${req.params.id}`, {
          headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
          signal: AbortSignal.timeout(5000),
        });
        if (taskRes.ok) {
          // This worker has the task — proxy the merge request
          const mergeRes = await fetch(`${url}/task/${req.params.id}/merge`, {
            method: 'POST',
            headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
            signal: AbortSignal.timeout(120000), // 2 min for clone + merge + push
          });
          if (mergeRes.ok) {
            return res.status(200).json(await mergeRes.json());
          }
          const errData = await mergeRes.json();
          return res.status(mergeRes.status).json(errData);
        }
      } catch { /* worker unreachable, try next */ }
    }
    // No worker has this task
    return res.status(404).json({ error: 'Task not found in any worker' });
  }

  // CLI fallback
  try {
    const args = ['merge', req.params.id, '--json'];
    if (req.query.project) args.push('--project', req.query.project);
    res.json(await rover(args));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Push a task
app.post('/api/tasks/:id/push', async (req, res) => {
  // Try workers first if configured
  if (WORKERS.length > 0) {
    for (const url of WORKERS) {
      try {
        const taskRes = await fetch(`${url}/task/${req.params.id}`, {
          headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
          signal: AbortSignal.timeout(5000),
        });
        if (taskRes.ok) {
          // This worker has the task — proxy the push request
          const pushRes = await fetch(`${url}/task/${req.params.id}/push`, {
            method: 'POST',
            headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
            signal: AbortSignal.timeout(120000), // 2 min for clone + push
          });
          if (pushRes.ok) {
            return res.status(200).json(await pushRes.json());
          }
          const errData = await pushRes.json();
          return res.status(pushRes.status).json(errData);
        }
      } catch { /* worker unreachable, try next */ }
    }
    // No worker has this task
    return res.status(404).json({ error: 'Task not found in any worker' });
  }

  // CLI fallback
  try {
    const args = ['push', req.params.id, '--json'];
    if (req.body?.message) args.push('-m', req.body.message);
    if (req.query.project) args.push('--project', req.query.project);
    res.json(await rover(args));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restart a task
app.post('/api/tasks/:id/restart', async (req, res) => {
  if (WORKERS.length > 0) {
    for (const url of WORKERS) {
      try {
        const resp = await fetch(`${url}/task/${req.params.id}`, {
          headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {}
        });
        if (resp.ok) {
          const detail = await resp.json();
          // Found the task, create a replacement
          const taskPayload = {
            repo: detail.repo || '',
            prompt: detail.prompt || detail.description || '',
            agent: detail.agent || 'claude',
            model: detail.model,
            worktreeBranch: detail.worktreeBranch,
            charter: detail.charter,
            envVars: detail.envVars,
          };
          const dispatchRes = await dispatchToWorker(taskPayload);
          return res.status(dispatchRes.status).json({ ...dispatchRes.data, dispatchedTo: dispatchRes.workerUrl });
        }
      } catch { /* skip */ }
    }
    return res.status(404).json({ error: 'Task not found on any worker to restart' });
  }

  try {
    const args = ['restart', req.params.id, '--json'];
    if (req.query.project) args.push('--project', req.query.project);
    res.json(await rover(args));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Global store info
app.get('/api/info', async (_req, res) => {
  try {
    res.json(await rover(['info', '--json']));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Worker / Constellation Routes ─────────────────────────────────────────

/**
 * Poll a single worker's /status endpoint.
 * Returns a status object augmented with index and url, or an error record.
 */
async function fetchWorkerStatus(url, index) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${url}/status`, {
      signal: controller.signal,
      headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
    });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      return { index, url, online: true, ...data };
    }
    return { index, url, online: false, error: `HTTP ${resp.status}` };
  } catch (err) {
    return { index, url, online: false, error: err.message };
  }
}

// GET /api/workers — status of all workers
app.get('/api/workers', async (_req, res) => {
  const statuses = await Promise.all(WORKERS.map((url, i) => fetchWorkerStatus(url, i + 1)));
  res.json(statuses);
});

// GET /api/workers/:index/task/:taskId — proxy to worker task detail
app.get('/api/workers/:index/task/:taskId', async (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (isNaN(idx) || idx < 0 || idx >= WORKERS.length) {
    return res.status(404).json({ error: 'Worker not found' });
  }
  try {
    const resp = await fetch(`${WORKERS[idx]}/task/${req.params.taskId}`, {
      headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/workers/:index/task/:taskId/logs — proxy to worker task logs
app.get('/api/workers/:index/task/:taskId/logs', async (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (isNaN(idx) || idx < 0 || idx >= WORKERS.length) {
    return res.status(404).json({ error: 'Worker not found' });
  }
  try {
    const url = `${WORKERS[idx]}/task/${req.params.taskId}/logs`;
    const qs = req.query.since ? `?since=${req.query.since}` : '';
    const resp = await fetch(`${url}${qs}`, {
      headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
    });
    const data = await resp.json().catch(async () => ({ logs: await resp.text() }));
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/workers/:index/task/:taskId/stop — proxy stop to worker
app.post('/api/workers/:index/task/:taskId/stop', async (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (isNaN(idx) || idx < 0 || idx >= WORKERS.length) {
    return res.status(404).json({ error: 'Worker not found' });
  }
  try {
    const resp = await fetch(`${WORKERS[idx]}/task/${req.params.taskId}/stop`, {
      method: 'POST',
      headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/constellation/status — aggregated worker status
app.get('/api/constellation/status', async (_req, res) => {
  if (WORKERS.length === 0) {
    return res.json({ total: 0, online: 0, idle: 0, busy: 0, workers: [] });
  }
  const statuses = await Promise.all(WORKERS.map((url, i) => fetchWorkerStatus(url, i)));
  const online = statuses.filter(s => s.online);
  const idleList = online.filter(s => !s.busy);
  const busyList = online.filter(s => s.busy);

  const workers = statuses.map(s => ({
    index: s.index,
    url: s.url,
    state: !s.online ? 'offline' : s.busy ? 'busy' : 'idle',
    taskId: s.taskId ?? null,
    agent: s.agent ?? null,
  }));

  res.json({
    total: WORKERS.length,
    online: online.length,
    idle: idleList.length,
    busy: busyList.length,
    workers,
  });
});

// SPA fallback — Express 5 wildcard syntax
app.get('/{*wildcard}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const binDisplay = IS_NODE_INVOKE
    ? '(local monorepo build)'
    : ROVER_BIN === 'rover' ? '(system PATH)' : ROVER_BIN;
  console.log(`\n  🚀 Rover Web Dashboard`);
  console.log(`  ─────────────────────`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  Rover:  ${binDisplay}`);
  console.log();
});
