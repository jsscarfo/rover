---
name: rover-remote
description: Manage Rover AI coding tasks on the remote Railway deployment via REST API
---

# Rover Remote Task Management

## Overview
Rover is an AI coding agent manager running at `https://rover.xaedron.com`.
You can create, monitor, and manage coding tasks that run autonomously in
isolated Docker containers with their own Git worktrees.

## ✅ Current Setup Status

**System is FULLY OPERATIONAL** - Worker pool architecture deployed and tested.

### Architecture
- **Web Coordinator**: https://rover.xaedron.com (public)
- **Worker Pool**: 7 workers (rover-worker-1 through rover-worker-7) on Railway private network
- **Execution Model**: Workers run AI agents natively in Railway containers (no Docker-in-Docker)

### Environment Variables (Configured)
✅ **ROVER_WEB_TOKEN** - Set on web and all workers
✅ **ANTHROPIC_API_KEY** - Set on all workers (Claude agent)
✅ **GITHUB_TOKEN** - Set on all workers (repo access)
✅ **WORKER_1_URL through WORKER_7_URL** - Set on web coordinator

### System Health
- ✅ 7 workers online and idle
- ✅ Authentication working
- ✅ All API endpoints functional
- ✅ Dashboard UI working (task detail, logs, diff tabs)
- ✅ Worker status badges visible

## Authentication
All API calls (except `/api/health`) require a Bearer token in the Authorization header:
```
Authorization: Bearer 8c2eae820354a8fa4479b1d1d6adc5a5e7ec2bdbbd1169ec998db521ec16575
```

Store this token securely - it's the only access credential for the dashboard.

## Base URL
```
https://rover.xaedron.com
```

## API Reference

### Health Check
Check if the server is up and whether authentication is required.
```
GET /api/health
```
Response: `{ "ok": true, "authRequired": true, "version": "1.0.0" }`

### List All Tasks
```
GET /api/tasks
GET /api/tasks?project=<project-path>
```
Returns: JSON array of task objects with fields:
- `id` (number) — task ID
- `title` (string) — auto-generated title
- `description` (string) — original task description
- `status` — one of: NEW, IN_PROGRESS, ITERATING, COMPLETED, FAILED, MERGED, PUSHED
- `agent` — the AI agent being used (claude, gemini, codex, cursor, etc.)
- `iterations` (number) — how many iterations have been run
- `branchName` — the Git branch for this task
- `startedAt`, `completedAt`, `failedAt` — timestamps

### Inspect a Task
```
GET /api/tasks/:id
GET /api/tasks/:id?project=<project-path>
```
Returns: Full task detail object including file changes, iteration data, etc.

### View Task Logs
```
GET /api/tasks/:id/logs
GET /api/tasks/:id/logs?iteration=<number>
```
Returns: `{ "logs": "...", ... }` — execution log output.

### View Task Diff
```
GET /api/tasks/:id/diff
```
Returns: `{ "diff": "...", "files": [...] }` — git diff of changes.

### Create a New Task
```
POST /api/tasks
Content-Type: application/json
Authorization: Bearer <token>

{
  "description": "Implement feature X by doing Y",
  "repo": "https://github.com/username/repository",  // REQUIRED - full GitHub URL
  "agent": "claude",                                 // optional: claude, gemini, codex
  "model": "claude-sonnet-4-6-20250620",            // optional: specific model
  "sourceBranch": "main",                           // optional: base branch (default: main)
  "project": "/path/to/local/project"               // optional: for CLI fallback only
}
```
Returns: `{ "accepted": true, "taskId": "uuid", "dispatchedTo": "worker-url" }`

> **CRITICAL REQUIREMENTS**: 
> - ✅ **`repo` field is REQUIRED** - Must be a full GitHub URL: `https://github.com/username/repo`
> - ✅ **`description` field is REQUIRED** - Clear instructions for the AI agent
> - ⚠️ **Common Error**: If `repo` is missing, worker returns `400 {"error": "repo is required"}`
> - ⚠️ **Do NOT confuse with API key issues** - Missing repo ≠ invalid API key
> 
> **Task Execution**:
> - Worker clones the repository
> - Runs AI agent in cloned directory
> - Commits and pushes changes to new branch
> - Typical duration: 2-10 minutes depending on task complexity
> 
> **Error Handling**:
> - `400 "repo is required"` → Add repo field with GitHub URL
> - `409 "Worker is busy"` → All workers occupied, retry in a few seconds
> - `503 "All workers busy"` → No idle workers available, wait and retry
> - Agent errors → Check logs via `GET /api/tasks/:id/logs`

### Stop a Running Task
```
POST /api/tasks/:id/stop
Authorization: Bearer <token>
```

### Delete a Task
```
POST /api/tasks/:id/delete
Authorization: Bearer <token>
```
WARNING: This permanently deletes the task, its worktree, and branch.

### Merge a Completed Task
```
POST /api/tasks/:id/merge
Authorization: Bearer <token>
```
Merges the task's changes back into the source branch.

### Push Task Changes
```
POST /api/tasks/:id/push
Content-Type: application/json
Authorization: Bearer <token>

{ "message": "optional commit message" }
```
Pushes the task branch to the remote Git repository.

### Restart a Failed/New Task
```
POST /api/tasks/:id/restart
Authorization: Bearer <token>
```

### Get Global Store Info
```
GET /api/info
Authorization: Bearer <token>
```
Returns: registered projects, task counts, store path.

## Common Workflows

### Create and Monitor a Task
1. `POST /api/tasks` with **description AND repo** → get `taskId`
   ```json
   {
     "description": "Add logging to error handlers",
     "repo": "https://github.com/username/my-project"
   }
   ```
2. Poll `GET /api/tasks/:id` every 10-15 seconds to check status
3. When status is COMPLETED:
   - `GET /api/tasks/:id/diff` to review changes
   - `GET /api/tasks/:id/logs` to verify execution
4. Check the new branch on GitHub (branch name in task detail)
5. Optionally `POST /api/tasks/:id/merge` or manually merge the PR

### Check on All Running Tasks
1. `GET /api/tasks` to list everything
2. Filter by `status === "IN_PROGRESS"` or `status === "ITERATING"`
3. For each running task, `GET /api/tasks/:id` for detailed progress

### Handle a Failed Task
1. `GET /api/tasks/:id/logs` to understand the failure
2. Either `POST /api/tasks/:id/restart` to retry, or
3. `POST /api/tasks/:id/delete` to clean up

## Error Handling

### HTTP Status Codes
- `401` → Authentication required or invalid token
- `400` → Bad request - **CHECK THE ERROR MESSAGE**:
  - `"repo is required"` → Missing repository URL (most common)
  - `"description is required"` → Missing task description
- `409` → Worker is busy (race condition, retry with another worker)
- `503` → All workers busy (wait and retry)
- `500` → Server error (check logs for details)

### Common Errors and Solutions

| Error Message | Cause | Solution |
|---------------|-------|----------|
| `"repo is required"` | Missing `repo` field | Add `"repo": "https://github.com/user/repo"` |
| `"All workers busy"` | No idle workers | Wait 30-60 seconds and retry |
| `"Agent exited with code 1"` | Agent execution failed | Check task logs for details |
| `"Repository not found"` | Invalid repo URL or no access | Verify GitHub token has access |
| `"Authentication required"` | Missing/invalid token | Check Authorization header |

### Debugging Failed Tasks
1. Get task details: `GET /api/tasks/:id`
2. Check status field for error state
3. Get logs: `GET /api/tasks/:id/logs`
4. Look for error messages in logs
5. Common issues:
   - Repository access denied → Check GITHUB_TOKEN
   - API key invalid → Check ANTHROPIC_API_KEY on worker
   - Task timeout → Task took > 30 minutes

## Future: MCP over HTTP (Phase 2)
In a future phase, a full MCP endpoint will be available at:
```
POST https://rover.xaedron.com/mcp
Authorization: Bearer <token>
```
This will expose all Rover tools via the MCP protocol with
Streamable HTTP transport, enabling native tool discovery in IDEs.
