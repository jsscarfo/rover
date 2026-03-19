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
app.get('/api/health', async (_req, res) => {
  // Check if rover CLI is available
  let roverAvailable = false;
  let roverVersion = null;
  try {
    const result = await rover(['--version'], { timeout: 5000 });
    roverAvailable = true;
    roverVersion = result.raw || result.version || 'unknown';
  } catch (e) {
    // Rover CLI not available
  }
  
  res.json({ 
    ok: true, 
    authRequired: !!process.env.ROVER_WEB_TOKEN,
    version: '1.0.0',
    roverCli: {
      available: roverAvailable,
      version: roverVersion,
      path: ROVER_BIN
    }
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

// ── API Routes ────────────────────────────────────────────────────────────

// List tasks
app.get('/api/tasks', async (req, res) => {
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

// Create a task
app.post('/api/tasks', async (req, res) => {
  try {
    const { description, agent, workflow, sourceBranch, targetBranch, project } = req.body;
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
