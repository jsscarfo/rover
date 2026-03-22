import fs from 'node:fs';
import path from 'node:path';

const ACTIVE_STATES = new Set(['ACCEPTED', 'CLONING', 'SETUP', 'RUNNING', 'PUSHING']);
const FLUSH_DELAY_MS = 2000;

/**
 * Persistent task storage backed by a JSON file with atomic writes.
 * Keeps an in-memory Map as cache and flushes to disk on mutation.
 */
export class TaskStore {
  /** @type {Map<string, object>} */
  #tasks = new Map();
  /** @type {string} */
  #filePath;
  /** @type {string} */
  #tmpPath;
  /** @type {NodeJS.Timeout|null} */
  #flushTimer = null;
  /** @type {number} */
  #maxTasks;

  /**
   * @param {string} [storagePath] Directory for the tasks.json file.
   *   Defaults to STORAGE_PATH env var or './data'.
   */
  constructor(storagePath) {
    const dir = storagePath || process.env.STORAGE_PATH || './data';
    this.#filePath = path.join(dir, 'tasks.json');
    this.#tmpPath = path.join(dir, 'tasks.json.tmp');
    this.#maxTasks = Number(process.env.MAX_TASKS) || 100;

    // Ensure storage directory exists
    fs.mkdirSync(dir, { recursive: true });

    // Load existing data
    this.#load();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get a task by id.
   * @param {string} id
   * @returns {object|undefined}
   */
  get(id) {
    return this.#tasks.get(id);
  }

  /**
   * Insert or update a task and schedule a flush.
   * @param {string} id
   * @param {object} task
   */
  set(id, task) {
    this.#evictIfNeeded();
    this.#tasks.set(id, task);
    this.#scheduleFlush();
  }

  /**
   * Remove a task and schedule a flush.
   * @param {string} id
   * @returns {boolean}
   */
  delete(id) {
    const result = this.#tasks.delete(id);
    if (result) {
      this.#scheduleFlush();
    }
    return result;
  }

  /**
   * Return all tasks as an array.
   * @returns {object[]}
   */
  getAll() {
    return Array.from(this.#tasks.values());
  }

  /**
   * Check whether a task exists.
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this.#tasks.has(id);
  }

  /**
   * Number of stored tasks.
   * @returns {number}
   */
  get size() {
    return this.#tasks.size;
  }

  /**
   * Force an immediate write to disk, cancelling any pending debounce.
   */
  flush() {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    this.#writeToDisk();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Load tasks from disk, applying crash recovery.
   */
  #load() {
    if (!fs.existsSync(this.#filePath)) {
      console.log('[TaskStore] No existing tasks.json found — starting with empty store');
      return;
    }

    let raw;
    try {
      raw = fs.readFileSync(this.#filePath, 'utf-8');
    } catch (err) {
      console.warn(`[TaskStore] Failed to read tasks.json: ${err.message} — starting fresh`);
      return;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.warn(`[TaskStore] tasks.json is corrupted (invalid JSON): ${err.message} — starting fresh`);
      return;
    }

    if (!data || typeof data.tasks !== 'object') {
      console.warn('[TaskStore] tasks.json has unexpected structure — starting fresh');
      return;
    }

    let recoveredCount = 0;
    for (const [id, task] of Object.entries(data.tasks)) {
      // Crash recovery: mark active-state tasks as FAILED
      if (ACTIVE_STATES.has(task.status)) {
        const prevStatus = task.status;
        task.status = 'FAILED';
        task.updatedAt = new Date().toISOString();
        const recoveryMsg = `[RECOVERY] Task was in ${prevStatus} state when worker restarted — marked as FAILED`;

        // Normalize logs to an array: existing logs may be string or array
        const existingLogs = Array.isArray(task.logs)
          ? task.logs
          : (task.logs ? task.logs.split('\n') : []);
        task.logs = [...existingLogs, recoveryMsg];

        recoveredCount++;
        console.log(`[TaskStore] Recovery: task ${id} was ${prevStatus} → FAILED`);
      } else {
        // Even for non-active tasks, normalize logs to array to maintain consistency
        // This ensures log() can always call .push() on the task's logs
        if (typeof task.logs === 'string') {
          task.logs = task.logs.split('\n').filter(line => line.length > 0);
        } else if (!Array.isArray(task.logs)) {
          task.logs = [];
        }
      }

      // Ensure new fields have defaults
      if (task.diff === undefined) task.diff = '';
      if (task.diffTruncated === undefined) task.diffTruncated = false;

      this.#tasks.set(id, task);
    }

    console.log(`[TaskStore] Loaded ${this.#tasks.size} task(s) from disk`);
    if (recoveredCount > 0) {
      console.log(`[TaskStore] Recovered ${recoveredCount} task(s) from active states`);
      // Persist recovery changes immediately
      this.#writeToDisk();
    }
  }

  /**
   * Serialize tasks (excluding runtime-only fields) and write atomically.
   */
  #writeToDisk() {
    const tasks = {};
    for (const [id, task] of this.#tasks) {
      tasks[id] = this.#serialize(task);
    }

    const payload = JSON.stringify({ version: 1, tasks }, null, 2);

    try {
      fs.writeFileSync(this.#tmpPath, payload, 'utf-8');
      fs.renameSync(this.#tmpPath, this.#filePath);
    } catch (err) {
      console.error(`[TaskStore] Failed to write tasks.json: ${err.message} — will retry on next flush`);
    }
  }

  /**
   * Return a plain object suitable for JSON serialization.
   * Excludes `process` (runtime handle) and `logsRaw` (large array).
   * Ensures `logs` is a string and new fields have defaults.
   * @param {object} task
   * @returns {object}
   */
  #serialize(task) {
    const {
      process: _process,
      logsRaw: _logsRaw,
      ...rest
    } = task;

    return {
      id: rest.id ?? '',
      description: rest.description ?? '',
      repo: rest.repo ?? '',
      branch: rest.branch ?? '',
      baseBranch: rest.baseBranch ?? '',
      agent: rest.agent ?? '',
      model: rest.model ?? '',
      role: rest.role ?? '',
      priority: rest.priority ?? '',
      project: rest.project ?? '',
      status: rest.status ?? '',
      logs: typeof rest.logs === 'string' ? rest.logs : Array.isArray(rest.logs) ? rest.logs.join('\n') : '',
      diff: rest.diff ?? '',
      diffTruncated: rest.diffTruncated ?? false,
      createdAt: rest.createdAt ?? '',
      updatedAt: rest.updatedAt ?? '',
      exitCode: rest.exitCode ?? null,
      error: rest.error ?? null,
    };
  }

  /**
   * Schedule a debounced flush. Resets the timer on each call.
   */
  #scheduleFlush() {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
    }
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.#writeToDisk();
    }, FLUSH_DELAY_MS);
  }

  /**
   * Evict oldest completed/failed tasks when the store is at capacity.
   * Never evicts tasks in active states.
   */
  #evictIfNeeded() {
    if (this.#tasks.size < this.#maxTasks) return;

    // Collect eviction candidates (completed or failed)
    const candidates = [];
    for (const [id, task] of this.#tasks) {
      if (!ACTIVE_STATES.has(task.status)) {
        candidates.push({ id, updatedAt: task.updatedAt || '' });
      }
    }

    if (candidates.length === 0) {
      // All tasks are active — nothing to evict
      return;
    }

    // Sort oldest first
    candidates.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0));

    // Evict enough to make room for one new task
    const toEvict = Math.max(1, this.#tasks.size - this.#maxTasks + 1);
    for (let i = 0; i < toEvict && i < candidates.length; i++) {
      this.#tasks.delete(candidates[i].id);
      console.log(`[TaskStore] Evicted task ${candidates[i].id} (status was not active)`);
    }
  }
}

/** Default singleton instance */
export const store = new TaskStore();

// Flush pending writes on graceful shutdown (e.g., Railway deploy, container stop)
process.on('SIGTERM', () => {
  console.log('[TaskStore] Received SIGTERM — flushing pending writes to disk');
  store.flush();
  // Give the flush a moment to complete before exiting
  setTimeout(() => process.exit(0), 500);
});
