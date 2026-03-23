import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { wbsLoader } from '../packages/web/lib/wbs-loader.js';

const execFileAsync = promisify(execFile);

async function runE2ETest() {
  console.log('Starting V2 Workflow E2E Test...');
  
  const testDir = path.join(tmpdir(), `rover-e2e-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
  
  try {
    // 1. Create a mock project repository
    console.log('1. Creating mock project repository...');
    await execFileAsync('git', ['init'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.name', 'E2E Test'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.email', 'e2e@test.com'], { cwd: testDir });
    
    writeFileSync(path.join(testDir, 'README.md'), '# E2E Test Project');
    await execFileAsync('git', ['add', 'README.md'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });
    
    // 2. Initialize .rover/ directory
    console.log('2. Initializing .rover/ directory...');
    const roverDir = path.join(testDir, '.rover');
    mkdirSync(roverDir, { recursive: true });
    mkdirSync(path.join(roverDir, 'sessions'), { recursive: true });
    
    const manifest = {
      version: '2.0.0',
      project: { name: 'e2e-test' },
      pipeline: { phases: ['planning', 'design', 'implement', 'test', 'deploy'] },
      budget: { maxCostUSD: 10, warningAt: 0.5 }
    };
    writeFileSync(path.join(roverDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    
    const wbs = {
      version: '2.0.0',
      modules: [
        {
          id: 'task-1',
          title: 'Test Task',
          status: 'pending',
          phase: 'planning',
          phases: {
            planning: { status: 'pending' }
          }
        }
      ]
    };
    writeFileSync(path.join(roverDir, 'wbs.json'), JSON.stringify(wbs, null, 2));
    
    await execFileAsync('git', ['add', '.rover/'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'Initialize rover'], { cwd: testDir });
    
    // 3. Verify WBS Loader can read it
    console.log('3. Verifying WBS Loader...');
    const loadedWbs = await wbsLoader.load(testDir, 'master');
    if (loadedWbs.modules[0].id !== 'task-1') {
      throw new Error('WBS Loader failed to read task');
    }
    
    // 4. Simulate worker completing a phase
    console.log('4. Simulating worker completing planning phase...');
    const sessionData = {
      sessionId: 'task-1',
      taskId: 'task-1',
      phase: 'planning',
      status: 'completed',
      completedAt: new Date().toISOString(),
      summary: 'Planning complete',
      costUSD: 0.05
    };
    writeFileSync(path.join(roverDir, 'sessions', 'task-1.json'), JSON.stringify(sessionData, null, 2));
    
    await execFileAsync('git', ['add', '.rover/sessions/task-1.json'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'rover: planning complete for task-1'], { cwd: testDir });
    
    // 5. Verify WBS update (simulating Director)
    console.log('5. Simulating Director advancing phase...');
    await wbsLoader.updateTask(testDir, 'task-1', {
      phase: 'design',
      status: 'pending',
      phases: {
        planning: { status: 'completed' },
        design: { status: 'pending' }
      }
    }, 'master');
    
    const updatedWbs = await wbsLoader.load(testDir, 'master');
    if (updatedWbs.modules[0].phase !== 'design') {
      throw new Error('Director failed to advance phase');
    }
    
    console.log('✅ E2E Test Passed!');
  } catch (err) {
    console.error('❌ E2E Test Failed:', err);
    process.exit(1);
  } finally {
    try {
      if (existsSync(testDir)) {
        import('node:fs').then(fs => fs.rmSync(testDir, { recursive: true, force: true }));
      }
    } catch (e) {}
  }
}

runE2ETest();
