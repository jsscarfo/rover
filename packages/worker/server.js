/**
 * @endorhq/rover-worker — Rover Constellation Worker Node
 *
 * An Express.js HTTP service that:
 *  1. Accepts tasks via POST /task
 *  2. Clones the target repo, runs an AI agent CLI, commits and pushes changes
 *  3. Reports status via GET /status and GET /task/:id
 *
 * Environment variables:
 *  PORT              — defaults to 3701
 *  ROVER_WEB_TOKEN   — shared Bearer auth token (same as web service)
 *  GITHUB_TOKEN      — for cloning private repos and pushing branches
 *  ANTHROPIC_API_KEY — passed to claude agent
 *  GEMINI_API_KEY    — passed to gemini agent
 *  GOOGLE_API_KEY    — passed to gemini agent (alias)
 */

import express from 'express';
import { execFile, exec } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3701;
const AUTH_TOKEN = process.env.ROVER_WEB_TOKEN;
const WORKER_ID = process.env.RAILWAY_SERVICE_NAME || 'worker-local';

// ── App ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ── Auth middleware ────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  if (!AUTH_TOKEN) return next(); // open in local dev
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice(7);
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  next();
}

app.use(authMiddleware);

// ── State ─────────────────────────────────────────────────────────────────

/** @type {Map<string, TaskRecord>} */
const tasks = new Map();

let currentTaskId = null;
let taskCount = 0;
const startedAt = Date.now();

/**
 * @typedef {Object} TaskRecord
 * @property {string} id
 * @property {string} repo
 * @property {string} [branch]
 * @property {string} [worktreeBranch]
 * @property {string} [agent]
 * @property {string} [prompt]
 * @property {string} [model]
 * @property {string} [charter]
 * @property {object} [envVars]
 * @property {string} status
 * @property {string[]} logs
 * @property {number} startedAt
 * @property {number|null} completedAt
 * @property {number|null} failedAt
 * @property {string|null} error
 * @property {string|null} workDir
 * @property {import('child_process').ChildProcess|null} process
 */

function createTask(fields) {
  return {
    id: fields.taskId || randomUUID(),
    repo: fields.repo,
    branch: fields.branch || 'main',
    worktreeBranch: fields.worktreeBranch || `rover/task/${fields.taskId || randomUUID()}`,
    agent: fields.agent || 'claude',
    prompt: fields.prompt || '',
    model: fields.model || null,
    charter: fields.charter || null,
    envVars: fields.envVars || {},
    description: fields.prompt || fields.description || '', // Added for web app compatibility
    status: 'ACCEPTED',
    logs: [],
    startedAt: Date.now(),
    completedAt: null,
    failedAt: null,
    error: null,
    workDir: null,
    process: null,
  };
}

function log(task, message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  task.logs.push(line);
  console.log(`[${task.id}] ${message}`);
}

// ── Agent resolution ───────────────────────────────────────────────────────

const AGENT_PACKAGES = {
  claude: '@anthropic-ai/claude-code',
  gemini: '@google/gemini-cli',
};

async function ensureAgent(agentName, taskLog) {
  const known = {
    claude: ['/usr/local/bin/claude', '/usr/bin/claude'],
    gemini: ['/usr/local/bin/gemini', '/usr/bin/gemini'],
  };

  const candidates = known[agentName] || [];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // Try PATH
  try {
    const { stdout } = await execAsync(`which ${agentName}`);
    const resolved = stdout.trim();
    if (resolved) return resolved;
  } catch {
    // not on PATH
  }

  // Install globally
  const pkg = AGENT_PACKAGES[agentName];
  if (!pkg) throw new Error(`Unknown agent: ${agentName}`);
  taskLog(`Agent '${agentName}' not found, installing ${pkg}…`);
  await execAsync(`npm install -g ${pkg}@latest`, { timeout: 120_000 });
  taskLog(`Installed ${pkg}`);
  return agentName; // rely on PATH after npm install
}

// ── Task execution ─────────────────────────────────────────────────────────

async function runTask(task) {
  const workDir = path.join(tmpdir(), `rover-task-${task.id}`);
  task.workDir = workDir;

  try {
    // ── CLONING ────────────────────────────────────────────────────────
    task.status = 'CLONING';
    log(task, `Cloning ${task.repo} into ${workDir}`);
    mkdirSync(workDir, { recursive: true });

    // Inject GitHub token into URL if available
    let repoUrl = task.repo;
    if (process.env.GITHUB_TOKEN && repoUrl.startsWith('https://github.com/')) {
      repoUrl = repoUrl.replace(
        'https://github.com/',
        `https://${process.env.GITHUB_TOKEN}@github.com/`,
      );
    }

    await execFileAsync('git', ['clone', '--depth=50', repoUrl, workDir], {
      timeout: 120_000,
      env: { ...process.env },
    });
    log(task, 'Clone complete');

    // ── SETUP ──────────────────────────────────────────────────────────
    task.status = 'SETUP';

    // Checkout worktree branch
    log(task, `Creating branch ${task.worktreeBranch}`);
    await execFileAsync('git', ['checkout', '-B', task.worktreeBranch], {
      cwd: workDir,
      timeout: 15_000,
    });

    // Configure git identity
    await execFileAsync('git', ['config', 'user.name', 'Rover Worker'], { cwd: workDir });
    await execFileAsync('git', ['config', 'user.email', 'rover@xaedron.com'], { cwd: workDir });
    log(task, 'Git identity configured');

    // Ensure agent binary is available
    const agentBin = await ensureAgent(task.agent, (msg) => log(task, msg));
    log(task, `Using agent binary: ${agentBin}`);

    // ── MCP CONFIG INJECTION ───────────────────────────────────────────
    // Build mcp.json with Laureline Code index + Playwright if configured.
    const mcpServers = {};
    const LAURELINE_INDEX_URL = process.env.LAURELINE_INDEX_URL;
    const PLAYWRIGHT_MCP = process.env.PLAYWRIGHT_MCP !== 'false'; // default on

    if (LAURELINE_INDEX_URL) {
      // Copy mcp-bridge.js into the workDir
      const bridgeSrc = path.join(__dirname, 'mcp-bridge.js');
      const bridgeDst = path.join(workDir, 'mcp-bridge.js');
      if (existsSync(bridgeSrc)) {
        writeFileSync(bridgeDst, readFileSync(bridgeSrc));
        mcpServers['laureline-code'] = {
          command: 'node',
          args: ['./mcp-bridge.js'],
          env: {
            LAURELINE_INDEX_URL,
            ...(AUTH_TOKEN ? { ROVER_WEB_TOKEN: AUTH_TOKEN } : {}),
          },
        };
        log(task, `MCP: laureline-code → ${LAURELINE_INDEX_URL}`);
      } else {
        log(task, 'MCP: mcp-bridge.js not found, skipping laureline-code');
      }
    }

    if (PLAYWRIGHT_MCP) {
      mcpServers['playwright'] = {
        command: 'npx',
        args: ['@playwright/mcp@latest', '--headless'],
      };
      log(task, 'MCP: playwright enabled (headless)');
    }

    const hasMcp = Object.keys(mcpServers).length > 0;
    let mcpConfigPath = null;
    if (hasMcp) {
      mcpConfigPath = path.join(workDir, '.mcp.json');
      writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }, null, 2));
      log(task, `MCP config written: ${Object.keys(mcpServers).join(', ')}`);
    }

    // ── RUNNING ────────────────────────────────────────────────────────
    task.status = 'RUNNING';
    log(task, `Running agent: ${agentBin}`);

    const agentEnv = {
      ...process.env,
      ...(task.envVars || {}),
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
      GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
    };

    // Build agent args based on agent type
    let agentArgs = [];
    if (task.agent === 'claude') {
      agentArgs = ['--dangerously-skip-permissions', '-p', task.prompt];
      if (task.model) agentArgs.push('--model', task.model);
      if (mcpConfigPath) agentArgs.push('--mcp-config', mcpConfigPath);
    } else if (task.agent === 'gemini') {
      agentArgs = ['-p', task.prompt];
      if (task.model) agentArgs.push('--model', task.model);
      // Gemini CLI MCP support: add when available
    } else {
      agentArgs = ['-p', task.prompt];
    }

    await new Promise((resolve, reject) => {
      const proc = execFile(agentBin, agentArgs, {
        cwd: workDir,
        env: agentEnv,
        timeout: 30 * 60 * 1000, // 30 min max
        maxBuffer: 50 * 1024 * 1024,
      });

      task.process = proc;

      proc.stdout?.on('data', (data) => {
        for (const line of data.toString().split('\n')) {
          if (line.trim()) log(task, `[stdout] ${line}`);
        }
      });

      proc.stderr?.on('data', (data) => {
        for (const line of data.toString().split('\n')) {
          if (line.trim()) log(task, `[stderr] ${line}`);
        }
      });

      proc.on('close', (code) => {
        task.process = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Agent exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        task.process = null;
        reject(err);
      });
    });

    log(task, 'Agent finished');

    // ── PUSHING ────────────────────────────────────────────────────────
    task.status = 'PUSHING';

    // Check if there are any changes to commit
    const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workDir,
    });

    if (statusOut.trim()) {
      log(task, 'Committing changes');
      await execFileAsync('git', ['add', '-A'], { cwd: workDir });
      await execFileAsync('git', ['commit', '-m', `rover: task ${task.id}`], { cwd: workDir });

      log(task, `Pushing branch ${task.worktreeBranch}`);
      await execFileAsync('git', ['push', '-f', 'origin', task.worktreeBranch], {
        cwd: workDir,
        timeout: 60_000,
        env: agentEnv,
      });
      log(task, 'Push complete');
    } else {
      log(task, 'No changes to commit');
    }

    // ── COMPLETED ──────────────────────────────────────────────────────
    task.status = 'COMPLETED';
    task.completedAt = Date.now();
    log(task, `Task completed in ${((task.completedAt - task.startedAt) / 1000).toFixed(1)}s`);
  } catch (err) {
    task.status = 'FAILED';
    task.failedAt = Date.now();
    task.error = err.message;
    log(task, `Task FAILED: ${err.message}`);
  } finally {
    // Cleanup workdir
    try {
      if (task.workDir && existsSync(task.workDir)) {
        rmSync(task.workDir, { recursive: true, force: true });
        task.workDir = null;
      }
    } catch {
      // ignore cleanup errors
    }

    // Free the worker slot
    if (currentTaskId === task.id) {
      currentTaskId = null;
    }
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

// GET /status — worker status
app.get('/status', (_req, res) => {
  const busy = currentTaskId !== null;
  const currentTask = currentTaskId ? tasks.get(currentTaskId) : null;
  res.json({
    workerId: WORKER_ID,
    busy,
    currentTaskId,
    taskId: currentTaskId,           // alias expected by constellation bar
    agent: currentTask?.agent || null, // show agent name in busy badge
    taskCount,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  });
});

// POST /task — accept a new task
app.post('/task', (req, res) => {
  if (currentTaskId !== null) {
    return res.status(409).json({ error: 'Worker is busy', currentTaskId });
  }

  const body = req.body || {};
  if (!body.repo) {
    return res.status(400).json({ error: 'repo is required' });
  }

  const task = createTask({ ...body, description: body.description || body.prompt });
  tasks.set(task.id, task);
  currentTaskId = task.id;
  taskCount++;

  // Execute asynchronously — do not await
  runTask(task);

  return res.status(202).json({ accepted: true, taskId: task.id });
});

// GET /tasks — list all tasks on this worker
app.get('/tasks', (_req, res) => {
  const allTasks = Array.from(tasks.values()).map(t => {
    const { process: _proc, logs: _logs, ...rest } = t;
    return { ...rest, logCount: t.logs.length };
  });
  res.json(allTasks);
});

// GET /task/:id — task detail
app.get('/task/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { process: _proc, logs: _logs, ...rest } = task;
  res.json({
    ...rest,
    logCount: task.logs.length,
  });
});

// GET /task/:id/logs — task logs as JSON (frontend api() always calls .json())
app.get('/task/:id/logs', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const since = parseInt(req.query.since || '0', 10);
  const lines = task.logs.slice(since);

  res.json({ logs: lines.join('\n'), count: task.logs.length, since });
});

// POST /task/:id/stop — kill running task
app.post('/task/:id/stop', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (task.process) {
    try {
      task.process.kill('SIGTERM');
      log(task, 'Task stopped by request');
      res.json({ stopped: true, taskId: task.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    res.json({ stopped: false, message: 'No running process for this task', status: task.status });
  }
});

// DELETE /task/:id — delete a task
app.delete('/task/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (task.process) {
    try { task.process.kill('SIGKILL'); } catch {}
  }
  tasks.delete(task.id);
  res.json({ deleted: true, taskId: task.id });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  🤖 Rover Worker Node`);
  console.log(`  ───────────────────`);
  console.log(`  Worker ID: ${WORKER_ID}`);
  console.log(`  Port:      ${PORT}`);
  console.log(`  Auth:      ${AUTH_TOKEN ? 'enabled' : 'disabled (no ROVER_WEB_TOKEN)'}`);
  console.log();
});
