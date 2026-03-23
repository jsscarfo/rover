import { wbsLoader } from '../web/lib/wbs-loader.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

const WORKERS = process.env.WORKER_URLS ? process.env.WORKER_URLS.split(',').map(u => u.trim()) : [];
const AUTH_TOKEN = process.env.ROVER_WEB_TOKEN;
const WORKER_AUTH_HEADER = AUTH_TOKEN ? `Bearer ${AUTH_TOKEN}` : undefined;

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

async function spawnPhase(task, workerUrl, repoUrl, branch) {
  console.log(`Spawning phase ${task.phase} for task ${task.id} on worker ${workerUrl}`);
  
  try {
    const resp = await fetch(`${workerUrl}/task/${task.id}/phase/${task.phase}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(WORKER_AUTH_HEADER ? { Authorization: WORKER_AUTH_HEADER } : {}),
      },
      body: JSON.stringify({
        repo: repoUrl,
        branch: branch,
        taskId: task.id,
        phase: task.phase,
        // Add context and prompt here
      }),
    });
    
    if (resp.ok) {
      console.log(`Successfully spawned phase ${task.phase} for task ${task.id}`);
      // Update WBS to mark task as in-progress
      await wbsLoader.updateTask(repoUrl, task.id, {
        status: 'in-progress',
        worker: workerUrl,
        phases: {
          ...task.phases,
          [task.phase]: {
            status: 'in-progress',
            worker: workerUrl,
            startedAt: new Date().toISOString()
          }
        }
      }, branch);
    } else {
      console.error(`Failed to spawn phase ${task.phase} for task ${task.id}: ${resp.statusText}`);
    }
  } catch (err) {
    console.error(`Error spawning phase ${task.phase} for task ${task.id}:`, err);
  }
}

async function pollCompletions(repoUrl, branch) {
  const completedSessions = [];
  const workDir = path.join(tmpdir(), `rover-director-poll-${randomUUID()}`);
  
  try {
    mkdirSync(workDir, { recursive: true });
    
    let cloneUrl = repoUrl;
    if (process.env.GITHUB_TOKEN && cloneUrl.startsWith('https://github.com/')) {
      cloneUrl = cloneUrl.replace(
        'https://github.com/',
        `https://${process.env.GITHUB_TOKEN}@github.com/`
      );
    }

    await execFileAsync('git', ['clone', '--depth=1', '--branch', branch, '--no-checkout', cloneUrl, workDir], {
      timeout: 60_000
    });
    
    await execFileAsync('git', ['sparse-checkout', 'set', '.rover/sessions'], { cwd: workDir });
    await execFileAsync('git', ['checkout'], { cwd: workDir });

    const sessionsDir = path.join(workDir, '.rover', 'sessions');
    if (existsSync(sessionsDir)) {
      const fs = await import('node:fs');
      const files = fs.readdirSync(sessionsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const sessionData = JSON.parse(readFileSync(path.join(sessionsDir, file), 'utf8'));
          if (sessionData.status === 'completed') {
            completedSessions.push(sessionData);
          }
        }
      }
    }
  } catch (err) {
    console.error(`Failed to poll completions from ${repoUrl}:`, err);
  } finally {
    try {
      if (existsSync(workDir)) {
        import('node:fs').then(fs => fs.rmSync(workDir, { recursive: true, force: true }));
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
  
  return completedSessions;
}

async function advancePhase(repoUrl, taskId, currentPhase, branch) {
  console.log(`Advancing phase for task ${taskId} from ${currentPhase}`);
  
  const task = await wbsLoader.getTask(repoUrl, taskId, branch);
  if (!task) {
    console.error(`Task ${taskId} not found in WBS`);
    return;
  }
  
  const phases = ['planning', 'design', 'implement', 'test', 'deploy'];
  const currentIndex = phases.indexOf(currentPhase);
  
  if (currentIndex === -1 || currentIndex === phases.length - 1) {
    console.log(`Task ${taskId} has completed all phases`);
    await wbsLoader.updateTask(repoUrl, taskId, {
      status: 'completed',
      progress: 100,
      phases: {
        ...task.phases,
        [currentPhase]: {
          ...task.phases?.[currentPhase],
          status: 'completed'
        }
      }
    }, branch);
    return;
  }
  
  const nextPhase = phases[currentIndex + 1];
  console.log(`Next phase for task ${taskId} is ${nextPhase}`);
  
  await wbsLoader.updateTask(repoUrl, taskId, {
    phase: nextPhase,
    status: 'pending',
    phases: {
      ...task.phases,
      [currentPhase]: {
        ...task.phases?.[currentPhase],
        status: 'completed'
      },
      [nextPhase]: {
        status: 'pending'
      }
    }
  }, branch);
}

export async function directorLoop(repoUrl, branch = 'main') {
  let running = true;
  
  console.log(`Starting director loop for ${repoUrl} on branch ${branch}`);
  
  while (running) {
    try {
      const wbs = await wbsLoader.load(repoUrl, branch);
      
      // Find tasks ready for next phase
      const readyTasks = [];
      const findReady = (modules) => {
        for (const mod of modules) {
          if (mod.status === 'pending' || (mod.status === 'in-progress' && !mod.worker)) {
            readyTasks.push(mod);
          }
          if (mod.subtasks) {
            findReady(mod.subtasks);
          }
        }
      };
      findReady(wbs.modules || []);
      
      for (const task of readyTasks) {
        const worker = await getIdleWorker();
        if (worker) {
          await spawnPhase(task, worker, repoUrl, branch);
        } else {
          console.log(`No idle workers available for task ${task.id}`);
          break; // Wait for next loop
        }
      }
      
      // Check for completed phases
      const completed = await pollCompletions(repoUrl, branch);
      for (const session of completed) {
        // Check if WBS already reflects this completion to avoid duplicate advancement
        const task = await wbsLoader.getTask(repoUrl, session.taskId, branch);
        if (task && task.phases?.[session.phase]?.status !== 'completed') {
          
          // Budget Enforcement
          const manifestPath = path.join(tmpdir(), `rover-manifest-${randomUUID()}`);
          try {
            await execFileAsync('git', ['clone', '--depth=1', '--branch', branch, '--no-checkout', repoUrl, manifestPath]);
            await execFileAsync('git', ['sparse-checkout', 'set', '.rover/manifest.json'], { cwd: manifestPath });
            await execFileAsync('git', ['checkout'], { cwd: manifestPath });
            
            const manifestFile = path.join(manifestPath, '.rover', 'manifest.json');
            if (existsSync(manifestFile)) {
              const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
              if (manifest.budget) {
                const totalCost = (task.costUSD || 0) + (session.costUSD || 0);
                if (totalCost >= manifest.budget.maxCostUSD) {
                  console.warn(`Budget exceeded for task ${task.id}. Pausing pipeline.`);
                  await wbsLoader.updateTask(repoUrl, task.id, { status: 'paused', error: 'Budget exceeded' }, branch);
                  continue;
                } else if (totalCost >= manifest.budget.maxCostUSD * manifest.budget.warningAt) {
                  console.warn(`Budget warning for task ${task.id}. Approaching limit.`);
                }
              }
            }
          } catch (e) {
            console.error('Failed to check budget:', e);
          } finally {
            try { if (existsSync(manifestPath)) import('node:fs').then(fs => fs.rmSync(manifestPath, { recursive: true, force: true })); } catch (e) {}
          }

          await advancePhase(repoUrl, session.taskId, session.phase, branch);
        }
      }
      
    } catch (err) {
      console.error('Error in director loop:', err);
    }
    
    // Wait 30 seconds before next iteration
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
}
