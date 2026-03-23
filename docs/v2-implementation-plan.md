# Rover V2 Implementation Plan

## Overview

This document provides a concrete, step-by-step plan to implement the Rover V2 architecture. Each task is specific, measurable, and ready for implementation.

---

## Phase 1: Foundation (Git Persistence)

### Task 1.1: Modify Worker to Persist Sessions
**File:** [`packages/worker/server.js`](packages/worker/server.js)

**Changes needed:**
1. Import Git utilities for committing `.rover/` directory
2. After Claude Code task completes successfully, write session file to `.rover/sessions/{taskId}.json`
3. Commit and push `.rover/` changes to main branch

**Code snippet to add:**
```javascript
const { execSync } = require('child_process');

// After task completion, before cleanup
async function persistSession(task, result) {
  const sessionData = {
    sessionId: task.sessionId,
    taskId: task.id,
    phase: task.phase,
    status: result.success ? 'completed' : 'failed',
    completedAt: new Date().toISOString(),
    summary: result.summary,
    deliverables: result.files,
    tokensUsed: result.tokensUsed,
    costUSD: result.costUSD
  };
  
  // Write to .rover/sessions/{id}.json
  const sessionPath = path.join(projectPath, '.rover', 'sessions', `${task.id}.json`);
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));
  
  // Git commit and push
  execSync('git add .rover/', { cwd: projectPath });
  execSync(`git commit -m "rover: ${task.phase} complete for ${task.id}"`, { cwd: projectPath });
  execSync('git push origin main', { cwd: projectPath });
}
```

---

### Task 1.2: Create WBS Loader
**New file:** [`packages/web/lib/wbs-loader.js`](packages/web/lib/wbs-loader.js)

**Purpose:** Load and cache WBS from Git repository

**Functions needed:**
```javascript
class WBSLoder {
  async load(repoUrl, branch = 'main') {
    // Clone or pull latest
    // Parse .rover/wbs.json
    // Return structured WBS
  }
  
  async getTask(taskId) {
    // Find task in WBS tree
  }
  
  async updateTask(taskId, updates) {
    // Update task in WBS
    // Write to .rover/wbs.json
    // Commit and push
  }
}
```

---

### Task 1.3: Update Dashboard to Read from Git
**File:** [`packages/web/server.js`](packages/web/server.js)

**Changes needed:**
1. Remove `/tasks` endpoint that lists from workers
2. Add `/projects/:id/wbs` endpoint that reads from Git
3. Add `/projects/:id/tasks/:taskId` for task detail

**Example:**
```javascript
app.get('/projects/:projectId/wbs', async (req, res) => {
  const wbs = await wbsLoader.load(projectRepoUrl);
  res.json(wbs);
});
```

---

### Task 1.4: Initialize .rover/ Directory
**New file:** [`packages/cli/src/commands/init-rover.js`](packages/cli/src/commands/init-rover.js)

**Purpose:** Create `.rover/` directory structure in a project

**Creates:**
```
.rover/
├── .gitignore           # Ignore sessions/*.tmp
├── manifest.json        # Default config
├── wbs.json             # Empty WBS
├── sessions/            # Task states
└── memories/            # Persistent knowledge
```

---

## Phase 2: Pipeline Workflow

### Task 2.1: Create Phase Prompts
**New directory:** [`packages/worker/prompts/`](packages/worker/prompts/)

**Files to create:**
- `planning.txt` - How to decompose a feature
- `design.txt` - How to design module structure
- `implement.txt` - How to implement (Claude Code instructions)
- `test.txt` - How to write tests
- `deploy.txt` - How to deploy

Each prompt includes:
- Phase objective
- Expected output format
- Where to write session file
- Handover instructions

---

### Task 2.2: Create Director Process
**New file:** [`packages/director/index.js`](packages/director/index.js)

**Purpose:** Orchestrate pipeline phases

**Core loop:**
```javascript
async function directorLoop() {
  while (running) {
    const wbs = await loadWBS();
    
    // Find tasks ready for next phase
    const ready = wbs.findReadyTasks();
    
    for (const task of ready) {
      const worker = await findIdleWorker();
      await spawnPhase(task, worker);
    }
    
    // Check for completed phases
    const completed = await pollCompletions();
    for (const session of completed) {
      await advancePhase(session.taskId, session.phase);
    }
    
    await sleep(30000); // 30 seconds
  }
}
```

---

### Task 2.3: Add Phase Routes to Worker
**File:** [`packages/worker/server.js`](packages/worker/server.js)

**New endpoints:**
- `POST /task/:id/phase/:phase` - Start a specific phase

**Body:**
```json
{
  "phase": "design",
  "prompt": "...",
  "context": "..."
}
```

---

## Phase 3: Dashboard Enhancements

### Task 3.1: Tree View Component
**New file:** [`packages/web/public/tree-view.js`](packages/web/public/tree-view.js)

**Features:**
- Recursive tree rendering
- Collapsible nodes
- Phase badges (colors)
- Progress bars
- Click to expand task detail

**Visual:**
```
[▾] Project [65%]
  [▾] Auth [implement] 🔄 [45%]
    [✓] Planning
    [✓] Design
    [→] Implement
  [▸] Dashboard [design]
```

---

### Task 3.2: Kanban View Component
**New file:** [`packages/web/public/kanban-view.js`](packages/web/public/kanban-view.js)

**Features:**
- 6 columns: Backlog, Planning, Design, Code, Test, Deploy
- Draggable cards (optional)
- Worker assignment shown
- Click for task detail

---

### Task 3.3: Task Detail Panel
**New file:** [`packages/web/public/task-detail.js`](packages/web/public/task-detail.js)

**Shows:**
- Task title and description
- Current phase
- Phase history with summaries
- Deliverables (file list)
- Token usage and cost
- Logs (if available)

---

## Phase 4: Context Management

### Task 4.1: Create Context Compressor
**New file:** [`packages/director/context-compressor.js`](packages/director/context-compressor.js)

**Purpose:** Summarize old context for new agents

**Uses:** Haiku model for cheap summarization

**Function:**
```javascript
async function compressContext(fullContext, maxTokens = 4000) {
  // Use Haiku to summarize
  const summary = await haiku.chat({
    messages: [
      { role: 'system', content: 'Summarize the following project context concisely.' },
      { role: 'user', content: fullContext }
    ]
  });
  return summary.content;
}
```

---

### Task 4.2: Memory Store
**New file:** [`packages/director/memory-store.js`](packages/director/memory-store.js)

**Purpose:** Manage `.rover/memories/`

**Functions:**
- `saveTaskMemory(taskId, data)` - Save to `.rover/memories/tasks/{id}/`
- `getGlobalMemory()` - Load cross-task learnings
- `getRelevantMemories(taskId)` - Get memories relevant to task

---

## Phase 5: Cost Tracking

### Task 5.1: Add Token Tracking to Worker
**File:** [`packages/worker/server.js`](packages/worker/server.js)

**Changes:**
1. Parse Claude Code output for token usage
2. Calculate cost based on model
3. Include in session file

**Cost map:**
```javascript
const COST_PER_1K_TOKENS = {
  'claude-opus-4-6': { input: 0.015, output: 0.075 },
  'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
  'claude-haiku-4-6': { input: 0.00025, output: 0.00125 }
};
```

---

### Task 5.2: Budget Enforcement
**File:** [`packages/director/index.js`](packages/director/index.js)

**Changes:**
- Read `manifest.json` budget section
- Track cumulative spend
- Pause tasks if budget exceeded
- Warn at 50% threshold

---

## Phase 6: Testing & Polish

### Task 6.1: End-to-End Test
**New file:** [`e2e/test-v2-workflow.js`](e2e/test-v2-workflow.js)

**Test flow:**
1. Create project with `.rover/` initialized
2. Add task to WBS
3. Verify Director spawns Planning phase
4. Verify session file created on complete
5. Verify WBS advances to Design phase
6. Verify task completes all phases

---

### Task 6.2: Documentation
**Update:** [`docs/usage.md`](docs/usage.md)

**Document:**
- How to initialize Rover on a project
- How to add tasks
- How to monitor progress
- How to configure budget

---

## Implementation Order

### Week 1: Foundation
1. Task 1.1: Worker session persistence
2. Task 1.2: WBS Loader
3. Task 1.3: Dashboard reads from Git
4. Task 1.4: Init command

### Week 2: Pipeline
5. Task 2.1: Phase prompts
6. Task 2.2: Director process
7. Task 2.3: Phase routes

### Week 3: Dashboard
8. Task 3.1: Tree view
9. Task 3.2: Kanban view
10. Task 3.3: Task detail

### Week 4: Context & Cost
11. Task 4.1: Context compressor
12. Task 4.2: Memory store
13. Task 5.1: Token tracking
14. Task 5.2: Budget enforcement

### Week 5: Polish
15. Task 6.1: E2E tests
16. Task 6.2: Documentation

---

## Acceptance Criteria

**Foundation Phase:**
- [ ] Worker commits session to `.rover/sessions/{id}.json`
- [ ] Dashboard shows WBS from Git (not workers)
- [ ] `rover init` creates `.rover/` directory

**Pipeline Phase:**
- [ ] Director spawns phases automatically
- [ ] Phase completion advances WBS
- [ ] WBS tracks phase history

**Dashboard Phase:**
- [ ] Tree view shows hierarchy
- [ ] Kanban view shows pipeline
- [ ] Task detail shows phase history

**Context Phase:**
- [ ] Old context is summarized
- [ ] New agents receive context

**Cost Phase:**
- [ ] Token usage tracked per task
- [ ] Budget limits enforced

---

## Notes

- Keep existing worker infrastructure (P0/P1 fixes)
- Add new functionality incrementally
- Test each phase before moving to next
- Maintain backward compatibility during transition