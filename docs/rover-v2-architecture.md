# Rover V2 Architecture: Claude Code Orchestration Layer

## Philosophy

Leverage Claude Code's proven capabilities (file editing, git, context management) and add:
1. **Git-centric persistence** (no database needed)
2. **Pipeline orchestration** (plan → design → code → test → deploy)
3. **Multi-project coordination** (Director manages multiple workstreams)

Claude Code does the heavy lifting. We provide the structure.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ROVER V2 ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────────┐   │
│  │   WEB UI    │────▶│  API COORD  │────▶│      WORKER POOL        │   │
│  │  (Dashboard)│◀────│   (Node.js) │◀────│    (Railway Docker)     │   │
│  └─────────────┘     └──────┬──────┘     └───────────┬─────────────┘   │
│                             │                        │                 │
│                             │    ┌───────────────────┘                 │
│                             │    │                                     │
│                             ▼    ▼                                     │
│                        ┌─────────────────────────┐                     │
│                        │   PROJECT REPOSITORY    │                     │
│                        │   (Git = Database)      │                     │
│                        │                         │                     │
│                        │  .rover/                │                     │
│                        │  ├── wbs.json          │◀── Work Breakdown   │
│                        │  ├── manifest.json     │◀── Config           │
│                        │  ├── sessions/         │◀── Active states    │
│                        │  └── memories/         │◀── Learnings        │
│                        │                         │                     │
│                        │  rover/task/{id}/      │◀── Claude Code      │
│                        │  └── (work happens)    │    worktrees        │
│                        └─────────────────────────┘                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Git as Database

All state lives in `.rover/` directory of the target project (not Rover itself):

```
project-repo/
├── src/                          # Your code
├── .rover/                       # Rover data (committed to main)
│   ├── .gitignore               # Ignore sessions/*.tmp
│   ├── manifest.json            # Project config
│   ├── wbs.json                 # Work breakdown structure
│   ├── sessions/                # Active/paused sessions
│   │   └── {task-id}.json
│   └── memories/                # Persistent knowledge
│       ├── global/              # Cross-task learnings
│       └── tasks/               # Per-task memory
│           └── {task-id}/
│               ├── context.md
│               └── summary.md
└── rover/task/{id}/             # Claude Code worktrees
    └── (actual development)
```

**Why this works:**
- Survives worker restarts (GitHub is the DB)
- Versioned (can see WBS evolution)
- Portable (clone repo = get full project state)
- No Railway volumes needed

---

### 2. Pipeline Workflow

Each task flows through 5 phases:

```
PLANNING ──▶ DESIGN ──▶ IMPLEMENT ──▶ TEST ──▶ DEPLOY
(Director)  (Director   (Claude      (Tests   (Deploy
 decomposes   refines)   Code)        run)     script)
             or API)
```

**Handover Protocol:**
1. Agent completes phase
2. Writes summary to `.rover/sessions/{id}.json`
3. Commits to main branch
4. Parent agent (Director) polls for update
5. Director spawns next phase agent

**Example WBS Node:**
```json
{
  "id": "auth-module",
  "title": "Authentication Module",
  "phase": "implement",
  "status": "in-progress",
  "progress": 45,
  "assignedWorker": "worker-2",
  "taskRef": "rover/task/550e8400-e29b-41d4-a716-446655440000",
  "phases": {
    "planning": { "status": "completed", "output": "memories/tasks/.../plan.md" },
    "design": { "status": "completed", "output": "memories/tasks/.../design.md" },
    "implement": { "status": "in-progress", "worker": "worker-2" },
    "test": { "status": "pending" },
    "deploy": { "status": "pending" }
  }
}
```

---

### 3. Claude Code Integration

Workers invoke Claude Code CLI directly:

```bash
# Worker executes:
claude-code \
  --dangerously-skip-permissions \
  -p "You are in {phase} phase for task {id}.
      
      Context: {compressed_context}
      
      Deliverables: {acceptance_criteria}
      
      When complete, write summary to .rover/sessions/{id}.json
      and commit with message 'rover: {phase} complete for {id}'" \
  --allowedTools="Edit,Bash,Git"
```

**Claude Code handles:**
- ✅ File editing (Edit tool)
- ✅ Git operations (Git tool)
- ✅ Terminal commands (Bash tool)
- ✅ Context within session
- ✅ Code understanding

**We handle:**
- ✅ Orchestration (which phase, when)
- ✅ Persistence (WBS in Git)
- ✅ Cross-session context (memories)
- ✅ Dashboard/monitoring

---

### 4. Director Agent

The Director is the "smart" orchestrator, responsible of agent results:

**Responsibilities:**
1. Parse PRD/feature request
2. Decompose into WBS nodes
3. Assign phases to workers
4. Monitor progress via Git polling
5. Handle failures (retry, escalate, or split)

**Implementation:**
```javascript
// Director runs as a special worker or local process
class Director {
  async run(projectRepo) {
    // 1. Load WBS from Git
    const wbs = await this.loadWBS(projectRepo);
    
    // 2. Find ready tasks (deps satisfied, no worker assigned)
    const ready = wbs.findReadyTasks();
    
    // 3. Assign to available workers
    for (const task of ready) {
      const worker = await this.findIdleWorker();
      await this.spawnPhase(task, worker);
    }
    
    // 4. Poll for completions
    await this.pollCompletions();
    
    // 5. Update WBS, spawn next phases
    await this.advancePipeline();
  }
}
```

**Model:** Claude Opus (via API, not CLI)

---

### 5. Context Management

**Problem:** Claude Code sessions are isolated (no shared context)
**Solution:** Feed context as part of the prompt

```javascript
function buildContextPrompt(task, memories) {
  return `
# Task: ${task.title}
Phase: ${task.phase}

## Relevant Memories
${memories.map(m => `- ${m.content}`).join('\n')}

## Previous Phase Output
${loadPreviousPhaseOutput(task)}

## Constraints
${task.constraints.join('\n')}

## Deliverables
${task.acceptanceCriteria.join('\n')}

---

Proceed with ${task.phase} phase. When complete:
1. Ensure all files are committed
2. Write summary to .rover/sessions/${task.id}.json
3. Commit the session file
`;
}
```

**Context Compression:**
- Keep full: Last phase output, key decisions
- Summarize: Older phases (Haiku compresses)
- Archive: Full conversation to memories/

---

## Data Formats

### manifest.json

```json
{
  "version": "2.0.0",
  "project": {
    "name": "fpx-laureline",
    "mainRepo": "https://github.com/user/fpx-laureline",
    "createdAt": "2024-01-15T10:00:00Z"
  },
  "director": {
    "model": "claude-opus-4-6",
    "checkIntervalSeconds": 30
  },
  "pipeline": {
    "phases": ["planning", "design", "implement", "test", "deploy"],
    "autoAdvance": true
  },
  "budget": {
    "maxTokens": 10000000,
    "maxCostUSD": 500,
    "warningAt": 0.5
  }
}
```

### wbs.json

```json
{
  "version": "2.0.0",
  "updatedAt": "2024-01-20T15:30:00Z",
  "modules": [
    {
      "id": "mod-auth",
      "title": "Authentication",
      "dependencies": [],
      "phase": "implement",
      "status": "in-progress",
      "progress": 45,
      "worker": "worker-2",
      "branch": "rover/task/550e8400...",
      "acceptanceCriteria": [
        "JWT token generation",
        "Password hashing with bcrypt",
        "Rate limiting"
      ],
      "phases": {
        "planning": {
          "status": "completed",
          "summary": "Use JWT, bcrypt, express-rate-limit",
          "tokens": 45000
        },
        "design": {
          "status": "completed",
          "summary": "See memories/tasks/.../design.md",
          "tokens": 120000
        },
        "implement": {
          "status": "in-progress",
          "worker": "worker-2",
          "startedAt": "2024-01-20T10:00:00Z"
        }
      }
    }
  ]
}
```

### Session State (sessions/{id}.json)

```json
{
  "sessionId": "sess-550e8400...",
  "taskId": "mod-auth",
  "phase": "implement",
  "status": "completed",
  "worker": "worker-2",
  "startedAt": "2024-01-20T10:00:00Z",
  "completedAt": "2024-01-20T12:30:00Z",
  "summary": "Implemented auth module with JWT, bcrypt, rate limiting",
  "deliverables": [
    "src/auth/controller.ts",
    "src/auth/service.ts",
    "src/auth/middleware.ts"
  ],
  "testsPassing": true,
  "tokensUsed": 89000,
  "costUSD": 2.67,
  "blockers": [],
  "nextSteps": ["Write integration tests"]
}
```

---

## Dashboard Views

### 1. Tree View (WBS Hierarchy)

```
FPX-Laureline [65%]
├── Authentication [implementing] 🔄 W2 (45%)
│   ├── Planning ✅ (45k tokens)
│   ├── Design ✅ (120k tokens)
│   └── Implement 🔄 (89k tokens, $2.67)
├── Dashboard [designing] 🔄 W3 (60%)
└── API Gateway [planning] ⏳ W4
```

### 2. Kanban View (Pipeline)

```
BACKLOG    PLANNING   DESIGNING  CODING     TESTING    DEPLOYING
─────────────────────────────────────────────────────────────────
           [Gateway]  [Dashbd]   [Auth]🔄
                      (W3)       (W2)
```

### 3. Worker Detail

```
Worker: worker-2
Status: busy
Task: mod-auth (implement phase)
Started: 2h 15m ago
Tokens: 89,000 ($2.67)
Model: claude-sonnet-4-6
Progress: 45%
Branch: rover/task/550e8400...

[Stop] [Pause] [View Logs] [Open Worktree]
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)

**Goal:** Git persistence working, basic WBS

1. **Modify worker** to save session on complete
   - After Claude Code exits, write `sessions/{id}.json`
   - Commit and push `.rover/` to main
   
2. **Create WBS schema** and loader
   - `wbs.json` format
   - Dashboard reads from Git
   
3. **Dashboard updates**
   - Tree view from WBS
   - Remove worker dependency for task list

### Phase 2: Pipeline (Week 2)

**Goal:** Multi-phase workflow

1. **Director process**
   - Polls WBS from Git
   - Spawns workers for ready tasks
   - Advances phases on completion
   
2. **Phase prompts**
   - Planning phase prompt
   - Design phase prompt
   - Implement phase prompt (Claude Code)
   
3. **Handover protocol**
   - Session file format
   - Parent reads child output

### Phase 3: Polish (Week 3)

**Goal:** Production ready

1. **Kanban view**
2. **Cost tracking**
3. **Context compression** (Haiku)
4. **Budget limits**
5. **Error handling**

---

## Open Questions Resolved

| Question | Decision |
|----------|----------|
| Real-time updates | Polling (every 30s), simpler than WebSocket |
| API keys | ENV vars per worker (`ANTHROPIC_API_KEY`, etc.) |
| Cost optimization | Auto-downgrade simple tasks to Haiku |
| Human approval | Director decides; draft PRD = no human needed |
| Git conflicts | Single Director has write lock |
| Large files | Context map from Architect phase |
| Long tasks | 5min checkpoints in Git |
| Claude Code | Use as execution engine, we do orchestration |

---

## Gaps Addressed

| Gap | Solution |
|-----|----------|
| **Write conflicts** | Single Director, workers report status |
| **Large repos** | Architect produces context map, coder loads subset |
| **Timeouts** | Claude Code handles long sessions; we checkpoint |
| **Dependencies** | Dependency graph in WBS, Director schedules |
| **Rollback** | Deploy phase creates rollback plan |
| **Budget** | Per-project token limits in manifest |

---

## Success Criteria

1. Create task in dashboard → appears in WBS
2. Director auto-assigns to worker
3. Claude Code runs in worktree
4. On complete, WBS updates, next phase spawns
5. Dashboard shows real progress without refresh
6. Repo clone = full project state restored

---

## Migration from V1

Current system has:
- Workers with in-memory tasks (lost on restart)
- Dashboard showing worker state

Migration:
1. Keep workers, add `.rover/` commit on complete
2. Dashboard reads WBS from Git instead of workers
3. Add Director process (can run locally initially)
4. Gradually move tasks to pipeline workflow