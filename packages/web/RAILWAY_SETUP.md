# Railway Deployment Setup for Rover Web Dashboard

## ✅ Current Status

The Rover web dashboard is fully operational on Railway using a **distributed worker pool architecture**. The system consists of:

- **Web Coordinator** - Public-facing dashboard that dispatches tasks
- **Worker Pool** - 5+ private Railway services that execute AI agent tasks natively

## Architecture Overview

```
Web Dashboard (rover.xaedron.com)
├── Serves the UI
├── Aggregates worker status
├── Dispatches tasks to idle workers
└── Proxies task requests to owning worker

Worker Pool (Railway private network)
├── rover-worker-1 through rover-worker-5
├── Each worker runs Express + in-memory task Map
├── Clone repos → run agents natively → push results
└── MCP servers: Laureline-Code + Playwright
```

Workers run agents **natively** in Railway containers (no Docker-in-Docker required). The Rover CLI is installed from npm during the build phase.

## Required Environment Variables

### Web Coordinator Service

Configure these in Railway Dashboard → Web Service → Variables:

```bash
# Authentication (Required)
ROVER_WEB_TOKEN=<your-secure-token>  # Generate with: openssl rand -hex 32

# Worker URLs (Required for worker pool)
WORKER_1_URL=http://rover-worker-1.railway.internal:3701
WORKER_2_URL=http://rover-worker-2.railway.internal:3701
WORKER_3_URL=http://rover-worker-3.railway.internal:3701
WORKER_4_URL=http://rover-worker-4.railway.internal:3701
WORKER_5_URL=http://rover-worker-5.railway.internal:3701

# Or use comma-separated list:
# WORKER_URLS=http://rover-worker-1.railway.internal:3701,http://rover-worker-2.railway.internal:3701,...
```

### Worker Services (Each Worker Needs These)

Configure these in Railway Dashboard → Worker Service → Variables:

```bash
# Authentication (Required - same token as web)
ROVER_WEB_TOKEN=<same-token-as-web>

# AI Provider API Keys (Required)
ANTHROPIC_API_KEY=sk-ant-...  # For Claude agent

# GitHub Access (Required for cloning/pushing)
GITHUB_TOKEN=ghp_...  # Create at: https://github.com/settings/tokens/new (repo scope)

# Optional: Additional AI providers
GEMINI_API_KEY=...    # For Gemini agent
GOOGLE_API_KEY=...    # Alias for Gemini

# Optional: MCP Configuration
LAURELINE_INDEX_URL=http://laureline-index.railway.internal:8080/sse  # If using Laureline MCP
PLAYWRIGHT_MCP=true   # Enable Playwright MCP (default: true)
```

## Deployment Steps

### 1. Deploy Web Coordinator

```bash
# Push to GitHub
git add .
git commit -m "Configure Railway deployment"
git push origin main
```

In Railway Dashboard:
1. Create new service from GitHub repo
2. Set root directory to repository root
3. Configure environment variables (see above)
4. Deploy

### 2. Deploy Worker Services

For each worker (repeat 5 times for rover-worker-1 through rover-worker-5):

1. Create new service from same GitHub repo
2. Set root directory to `packages/worker`
3. Configure environment variables (see above)
4. Deploy

Railway will automatically use the Dockerfile in `packages/worker/` to build each worker.

### 3. Verify Deployment

1. Visit your Railway web URL
2. Login with your `ROVER_WEB_TOKEN`
3. Check the constellation bar at the top - you should see W1-W5 badges
4. Green badges = idle workers ready to accept tasks
5. Try creating a test task with a GitHub repo URL

## Common Issues & Solutions

### Issue: "repo is required" error when creating tasks

**Cause**: The repo field is empty in the create task form.

**Solution**: Always provide a full GitHub repository URL when creating tasks:
```
https://github.com/username/repository
```

The worker needs to clone the repository to execute the agent task.

### Issue: Tasks fail immediately with "Agent exited with code 1"

**Possible causes**:
1. **Invalid ANTHROPIC_API_KEY** - Check the API key has credit and is valid
2. **Invalid GITHUB_TOKEN** - Check the token has `repo` scope for private repos
3. **Repository not accessible** - Verify the GitHub token can access the repo
4. **Empty prompt** - Ensure the task description is not empty

**Debug steps**:
1. Click the failed task in the dashboard
2. Switch to the "Logs" tab to see detailed error messages
3. Check worker logs in Railway dashboard for the specific worker

### Issue: All workers show as offline

**Cause**: Worker URLs not configured or incorrect.

**Solution**: 
1. Verify `WORKER_1_URL` through `WORKER_5_URL` are set in web service
2. Use Railway private networking URLs: `http://rover-worker-N.railway.internal:3701`
3. Ensure `ROVER_WEB_TOKEN` matches between web and all workers

### Issue: Workers show as idle but tasks fail with "All workers busy"

**Cause**: Race condition or worker status polling issue.

**Solution**: 
1. Refresh the page
2. Wait a few seconds and try again
3. Check worker logs for errors

### Issue: "Authentication required" on all requests

**Cause**: Token mismatch or not set.

**Solution**:
- Verify `ROVER_WEB_TOKEN` is set in Railway variables
- Check you're using the correct token in the login modal
- Restart the service after adding variables

## Architecture Notes

### How It Works

1. **Task Creation**: User submits task via web dashboard with repo URL and prompt
2. **Dispatch**: Web coordinator finds an idle worker and POSTs task payload
3. **Execution**: Worker clones repo, runs agent CLI, commits and pushes changes
4. **Monitoring**: Web dashboard polls workers for status and aggregates task list
5. **Completion**: Worker pushes branch to GitHub, task marked as completed

### Worker Task Lifecycle

```
ACCEPTED → CLONING → SETUP → RUNNING → PUSHING → COMPLETED
                                  ↓
                               FAILED
```

### Key Features

- **Parallel execution**: Multiple workers can run tasks simultaneously
- **Fault tolerance**: Workers restart on failure, tasks can be retried
- **Live logs**: Stream task output in real-time via drawer UI
- **Task management**: Stop, restart, delete tasks from the dashboard
- **MCP integration**: Workers support Model Context Protocol servers
- **Native execution**: No Docker-in-Docker complexity

### Performance Considerations

- Each worker can handle 1 task at a time
- Tasks timeout after 30 minutes
- Workers use Railway's private networking (low latency)
- Temporary directories are cleaned up after each task
- Workers sleep when idle (Railway's default behavior)

### Security

- All API endpoints require Bearer token authentication
- GitHub tokens are never exposed to the frontend
- Workers run as non-root user (security best practice)
- Private Railway networking isolates workers from public internet
