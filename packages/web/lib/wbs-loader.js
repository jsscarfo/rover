import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

export class WBSLoader {
  constructor() {
    this.cache = new Map();
  }

  async load(repoUrl, branch = 'main') {
    const cacheKey = `${repoUrl}:${branch}`;
    
    // Create a temporary directory for cloning
    const workDir = path.join(tmpdir(), `rover-wbs-${randomUUID()}`);
    
    try {
      mkdirSync(workDir, { recursive: true });
      
      // Inject GitHub token if available
      let cloneUrl = repoUrl;
      if (process.env.GITHUB_TOKEN && cloneUrl.startsWith('https://github.com/')) {
        cloneUrl = cloneUrl.replace(
          'https://github.com/',
          `https://${process.env.GITHUB_TOKEN}@github.com/`
        );
      }

      // Clone just the .rover directory if possible, or shallow clone
      await execFileAsync('git', ['clone', '--depth=1', '--branch', branch, '--no-checkout', cloneUrl, workDir], {
        timeout: 60_000
      });
      
      await execFileAsync('git', ['sparse-checkout', 'set', '.rover'], { cwd: workDir });
      await execFileAsync('git', ['checkout'], { cwd: workDir });

      const wbsPath = path.join(workDir, '.rover', 'wbs.json');
      
      if (!existsSync(wbsPath)) {
        return { version: '2.0.0', modules: [] }; // Return empty WBS if not found
      }

      const wbsData = JSON.parse(readFileSync(wbsPath, 'utf8'));
      this.cache.set(cacheKey, { data: wbsData, timestamp: Date.now() });
      
      return wbsData;
    } catch (err) {
      console.error(`Failed to load WBS from ${repoUrl}:`, err);
      // Fallback to cache if available
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey).data;
      }
      throw err;
    } finally {
      // Cleanup
      try {
        if (existsSync(workDir)) {
          import('node:fs').then(fs => fs.rmSync(workDir, { recursive: true, force: true }));
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  async getTask(repoUrl, taskId, branch = 'main') {
    const wbs = await this.load(repoUrl, branch);
    
    // Recursive search for task
    const findTask = (modules) => {
      for (const mod of modules) {
        if (mod.id === taskId) return mod;
        if (mod.subtasks) {
          const found = findTask(mod.subtasks);
          if (found) return found;
        }
      }
      return null;
    };
    
    return findTask(wbs.modules || []);
  }

  async updateTask(repoUrl, taskId, updates, branch = 'main') {
    const workDir = path.join(tmpdir(), `rover-wbs-update-${randomUUID()}`);
    
    try {
      mkdirSync(workDir, { recursive: true });
      
      let cloneUrl = repoUrl;
      if (process.env.GITHUB_TOKEN && cloneUrl.startsWith('https://github.com/')) {
        cloneUrl = cloneUrl.replace(
          'https://github.com/',
          `https://${process.env.GITHUB_TOKEN}@github.com/`
        );
      }

      await execFileAsync('git', ['clone', '--depth=1', '--branch', branch, cloneUrl, workDir], {
        timeout: 60_000
      });

      const wbsPath = path.join(workDir, '.rover', 'wbs.json');
      
      let wbsData = { version: '2.0.0', modules: [] };
      if (existsSync(wbsPath)) {
        wbsData = JSON.parse(readFileSync(wbsPath, 'utf8'));
      } else {
        mkdirSync(path.dirname(wbsPath), { recursive: true });
      }

      // Recursive update
      let updated = false;
      const updateInModules = (modules) => {
        for (let i = 0; i < modules.length; i++) {
          if (modules[i].id === taskId) {
            modules[i] = { ...modules[i], ...updates };
            updated = true;
            return true;
          }
          if (modules[i].subtasks && updateInModules(modules[i].subtasks)) {
            return true;
          }
        }
        return false;
      };

      updateInModules(wbsData.modules || []);
      
      if (!updated) {
        throw new Error(`Task ${taskId} not found in WBS`);
      }

      wbsData.updatedAt = new Date().toISOString();
      writeFileSync(wbsPath, JSON.stringify(wbsData, null, 2));

      // Configure git identity
      await execFileAsync('git', ['config', 'user.name', 'Rover Director'], { cwd: workDir });
      await execFileAsync('git', ['config', 'user.email', 'rover@xaedron.com'], { cwd: workDir });

      // Commit and push
      await execFileAsync('git', ['add', '.rover/wbs.json'], { cwd: workDir });
      await execFileAsync('git', ['commit', '-m', `rover: update task ${taskId} in WBS`], { cwd: workDir });
      await execFileAsync('git', ['push', 'origin', branch], { cwd: workDir });

      // Update cache
      const cacheKey = `${repoUrl}:${branch}`;
      this.cache.set(cacheKey, { data: wbsData, timestamp: Date.now() });

      return wbsData;
    } finally {
      try {
        if (existsSync(workDir)) {
          import('node:fs').then(fs => fs.rmSync(workDir, { recursive: true, force: true }));
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}

export const wbsLoader = new WBSLoader();
