import express from 'express';
import cors from 'cors';
import { execFile, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

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

// ── API Routes ────────────────────────────────────────────────────────────

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
          const taskId = s.currentTaskId || s.taskId;
          if (taskId) {
            try {
              const resp = await fetch(`${s.url}/task/${taskId}`, {
                headers: WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {},
                signal: AbortSignal.timeout(3000),
              });
              if (resp.ok) {
                const detail = await resp.json();
                allTasks.push({
                  ...detail,
                  workerId: s.workerId || s.index,
                  workerIndex: s.index,
                  workerUrl: s.url,
                });
                return;
              }
            } catch { /* worker task fetch failed */ }
          }
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
      const workerUrl = await getIdleWorker();
      if (!workerUrl) {
        return res.status(503).json({ error: 'All workers busy', code: 'ALL_WORKERS_BUSY' });
      }

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

      const workerResp = await fetch(`${workerUrl}/task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {}),
        },
        body: JSON.stringify(taskPayload),
      });

      const workerData = await workerResp.json();
      return res.status(workerResp.status).json({ ...workerData, dispatchedTo: workerUrl });
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
