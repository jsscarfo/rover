---
name: rover-remote
description: Manage Rover AI coding tasks on the remote Railway deployment via REST API
---

# Rover Remote Task Management

## Overview
Rover is an AI coding agent manager running at `https://rover.xaedron.com`.
You can create, monitor, and manage coding tasks that run autonomously in
isolated Docker containers with their own Git worktrees.

## Authentication
All API calls (except `/api/health`) require a Bearer token in the Authorization header:
```
Authorization: Bearer <token>
```

The token is stored in the environment variable `ROVER_WEB_TOKEN`.
If you need to read the token, check the user's environment or ask them.

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
  "agent": "claude",           // optional: claude, gemini, codex, cursor, qwen, opencode
  "workflow": "swe",            // optional: swe, research
  "sourceBranch": "main",      // optional: branch to create worktree from
  "targetBranch": "develop"    // optional: merge target
}
```
Returns: Task creation result with `taskId`.

> IMPORTANT: Task creation can take 30-60 seconds as it sets up Docker
> containers and Git worktrees. The timeout is set to 5 minutes.

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
1. `POST /api/tasks` with description → get `taskId`
2. Poll `GET /api/tasks/:id` every 10-15 seconds to check status
3. When status is COMPLETED:
   - `GET /api/tasks/:id/diff` to review changes
   - `GET /api/tasks/:id/logs` to verify execution
4. `POST /api/tasks/:id/merge` to merge, or `POST /api/tasks/:id/push` to push

### Check on All Running Tasks
1. `GET /api/tasks` to list everything
2. Filter by `status === "IN_PROGRESS"` or `status === "ITERATING"`
3. For each running task, `GET /api/tasks/:id` for detailed progress

### Handle a Failed Task
1. `GET /api/tasks/:id/logs` to understand the failure
2. Either `POST /api/tasks/:id/restart` to retry, or
3. `POST /api/tasks/:id/delete` to clean up

## Error Handling
- `401` → Authentication required or invalid token
- `400` → Bad request (e.g., missing description)
- `500` → Server error (usually CLI command failed — check `error` field)

## Future: MCP over HTTP (Phase 2)
In a future phase, a full MCP endpoint will be available at:
```
POST https://rover.xaedron.com/mcp
Authorization: Bearer <token>
```
This will expose all Rover tools via the MCP protocol with
Streamable HTTP transport, enabling native tool discovery in IDEs.
