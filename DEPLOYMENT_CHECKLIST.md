# Rover Web Dashboard - Deployment Checklist

## ✅ Pre-Flight Checks

Use this checklist to verify your Railway deployment is configured correctly.

### 1. Web Coordinator Service

Check these environment variables are set in Railway Dashboard → Web Service → Variables:

- [ ] `ROVER_WEB_TOKEN` - Your authentication token
- [ ] `WORKER_1_URL` through `WORKER_5_URL` - Worker private URLs
  - Format: `http://rover-worker-N.railway.internal:3701`
  - Or use `WORKER_URLS` with comma-separated list

### 2. Each Worker Service (rover-worker-1 through rover-worker-5)

Check these environment variables are set for EACH worker:

- [ ] `ROVER_WEB_TOKEN` - Same token as web service
- [ ] `ANTHROPIC_API_KEY` - Your Claude API key (starts with `sk-ant-`)
- [ ] `GITHUB_TOKEN` - GitHub personal access token with `repo` scope

### 3. Verify Deployment

1. **Check Web Service Health**
   ```bash
   curl https://rover.xaedron.com/api/health
   ```
   Should return: `{"ok":true,"authRequired":true,...}`

2. **Check Worker Status** (from web dashboard)
   - Login to dashboard
   - Look at constellation bar at top
   - Should see W1-W5 badges
   - Green = idle and ready
   - Grey = offline (check worker logs)

3. **Test Task Creation**
   - Click "New Task"
   - Fill in ALL fields:
     - **Description**: What you want the agent to do
     - **Repository URL**: `https://github.com/username/repo` (REQUIRED!)
     - **Agent**: claude (default)
     - **Branch**: main (or your base branch)
   - Click "Create Task"
   - Should see task appear in list

## 🐛 Common Issues

### Issue: "repo is required" error

**Symptom**: Task fails immediately after creation

**Cause**: Repository URL field was left empty

**Fix**: Always provide a full GitHub repository URL:
```
https://github.com/yourusername/your-repository
```

### Issue: Task fails with "Agent exited with code 1"

**Possible Causes**:

1. **Invalid API Key**
   - Check `ANTHROPIC_API_KEY` is set correctly in worker
   - Verify key has available credit at https://console.anthropic.com/
   - Try creating a new API key

2. **Repository Access Denied**
   - Check `GITHUB_TOKEN` has `repo` scope
   - Verify token can access the repository (especially for private repos)
   - Test: `curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/user/repos`

3. **Empty or Invalid Prompt**
   - Ensure task description is clear and specific
   - Agent needs actionable instructions

**Debug Steps**:
1. Click the failed task in dashboard
2. Switch to "Logs" tab
3. Look for error messages from Claude CLI
4. Check Railway worker logs for detailed stack traces

### Issue: All workers show as offline (grey badges)

**Cause**: Worker URLs not configured or workers not deployed

**Fix**:
1. Verify workers are deployed in Railway dashboard
2. Check `WORKER_1_URL` through `WORKER_5_URL` in web service
3. Ensure URLs use Railway private networking: `http://rover-worker-N.railway.internal:3701`
4. Restart web service after adding worker URLs

### Issue: Workers show idle but tasks fail with "All workers busy"

**Cause**: Race condition or stale status

**Fix**:
1. Refresh the browser page
2. Wait 5-10 seconds for status to update
3. Try creating task again

### Issue: "Authentication required" error

**Cause**: Token not set or mismatch

**Fix**:
1. Set `ROVER_WEB_TOKEN` in Railway web service variables
2. Set same `ROVER_WEB_TOKEN` in all worker services
3. Restart all services after setting tokens
4. Clear browser cache and login again

## 📊 Monitoring

### Check Worker Logs

In Railway Dashboard:
1. Select a worker service (e.g., rover-worker-1)
2. Click "Deployments" tab
3. Click latest deployment
4. View logs for errors

Common log patterns:
- `[task:xxx] Cloning...` - Task started successfully
- `[task:xxx] Agent finished` - Task completed
- `[task:xxx] Task FAILED: ...` - Task error (read the message)

### Check API Key Credit

Visit https://console.anthropic.com/settings/usage to verify:
- API key is active
- You have available credit
- No rate limits hit

## 🎯 Quick Test

To verify everything is working:

1. **Create a test repository** on GitHub (can be empty or with a README)
2. **Create a simple task**:
   - Description: "Add a comment to the README explaining what this repo is for"
   - Repository: `https://github.com/yourusername/test-repo`
   - Agent: claude
   - Branch: main
3. **Watch the worker badge** turn amber (busy)
4. **Check logs** by clicking the amber badge
5. **Verify completion** - should see new branch pushed to GitHub

## 📝 Environment Variable Template

Copy this template and fill in your values:

### Web Service
```bash
ROVER_WEB_TOKEN=<generate with: openssl rand -hex 32>
WORKER_1_URL=http://rover-worker-1.railway.internal:3701
WORKER_2_URL=http://rover-worker-2.railway.internal:3701
WORKER_3_URL=http://rover-worker-3.railway.internal:3701
WORKER_4_URL=http://rover-worker-4.railway.internal:3701
WORKER_5_URL=http://rover-worker-5.railway.internal:3701
```

### Each Worker Service
```bash
ROVER_WEB_TOKEN=<same as web service>
ANTHROPIC_API_KEY=sk-ant-api03-...
GITHUB_TOKEN=ghp_...
```

## 🚀 Next Steps

Once everything is working:

1. **Scale workers** - Add more workers if needed (W6, W7, etc.)
2. **Add MCP servers** - Configure Laureline-Code for semantic search
3. **Set up monitoring** - Track API costs and task success rates
4. **Create workflows** - Define common task patterns for your team

---

**Need help?** Check the full documentation in `packages/web/RAILWAY_SETUP.md`
