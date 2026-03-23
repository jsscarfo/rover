import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

export class MemoryStore {
  constructor() {
    this.cache = new Map();
  }

  async _cloneRepo(repoUrl, branch) {
    const workDir = path.join(tmpdir(), `rover-memory-${randomUUID()}`);
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
    
    await execFileAsync('git', ['sparse-checkout', 'set', '.rover/memories'], { cwd: workDir });
    await execFileAsync('git', ['checkout'], { cwd: workDir });
    
    return workDir;
  }

  async _cleanup(workDir) {
    try {
      if (existsSync(workDir)) {
        import('node:fs').then(fs => fs.rmSync(workDir, { recursive: true, force: true }));
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  async saveTaskMemory(repoUrl, taskId, data, branch = 'main') {
    const workDir = await this._cloneRepo(repoUrl, branch);
    
    try {
      const memoryDir = path.join(workDir, '.rover', 'memories', 'tasks', taskId);
      mkdirSync(memoryDir, { recursive: true });
      
      const memoryPath = path.join(memoryDir, 'memory.json');
      writeFileSync(memoryPath, JSON.stringify(data, null, 2));

      // Configure git identity
      await execFileAsync('git', ['config', 'user.name', 'Rover Director'], { cwd: workDir });
      await execFileAsync('git', ['config', 'user.email', 'rover@xaedron.com'], { cwd: workDir });

      // Commit and push
      await execFileAsync('git', ['add', '.rover/memories/'], { cwd: workDir });
      await execFileAsync('git', ['commit', '-m', `rover: save memory for task ${taskId}`], { cwd: workDir });
      await execFileAsync('git', ['push', 'origin', branch], { cwd: workDir });

      // Update cache
      const cacheKey = `${repoUrl}:${branch}:task:${taskId}`;
      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      
      return true;
    } catch (err) {
      console.error(`Failed to save memory for task ${taskId}:`, err);
      throw err;
    } finally {
      await this._cleanup(workDir);
    }
  }

  async getGlobalMemory(repoUrl, branch = 'main') {
    const cacheKey = `${repoUrl}:${branch}:global`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey).data;
    }

    const workDir = await this._cloneRepo(repoUrl, branch);
    
    try {
      const globalMemoryPath = path.join(workDir, '.rover', 'memories', 'global', 'memory.json');
      if (existsSync(globalMemoryPath)) {
        const data = JSON.parse(readFileSync(globalMemoryPath, 'utf8'));
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
      }
      return {};
    } catch (err) {
      console.error(`Failed to get global memory from ${repoUrl}:`, err);
      return {};
    } finally {
      await this._cleanup(workDir);
    }
  }

  async getRelevantMemories(repoUrl, taskId, branch = 'main') {
    const cacheKey = `${repoUrl}:${branch}:task:${taskId}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey).data;
    }

    const workDir = await this._cloneRepo(repoUrl, branch);
    
    try {
      const memoryPath = path.join(workDir, '.rover', 'memories', 'tasks', taskId, 'memory.json');
      if (existsSync(memoryPath)) {
        const data = JSON.parse(readFileSync(memoryPath, 'utf8'));
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
      }
      return {};
    } catch (err) {
      console.error(`Failed to get memory for task ${taskId}:`, err);
      return {};
    } finally {
      await this._cleanup(workDir);
    }
  }
}

export const memoryStore = new MemoryStore();
