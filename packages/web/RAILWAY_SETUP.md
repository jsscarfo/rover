# Railway Deployment Setup for Rover Web Dashboard

## Required Environment Variables

Configure these in Railway Dashboard → Service → Variables:

### 1. Authentication (Required)
```
ROVER_WEB_TOKEN=<your-secure-token>
```
Generate a secure token:
```bash
openssl rand -hex 32
```

### 2. AI Agent API Keys (Required for task execution)

Choose at least one AI provider:

**For Claude (Anthropic):**
```
ANTHROPIC_API_KEY=sk-ant-...
```

**For Gemini (Google):**
```
GEMINI_API_KEY=...
```

**For OpenAI Codex:**
```
OPENAI_API_KEY=sk-...
```

### 3. GitHub Access (Required for private repos)
```
GITHUB_TOKEN=ghp_...
```
Create a GitHub Personal Access Token with `repo` scope at:
https://github.com/settings/tokens/new

### 4. Docker Configuration (Optional)
```
DOCKER_HOST=unix:///var/run/docker.sock
```
Note: Railway doesn't support Docker-in-Docker by default. For full Rover functionality, you'll need to:
- Use Railway's Docker socket mounting (if available)
- Or deploy to a platform that supports Docker (e.g., AWS ECS, DigitalOcean)

## Deployment Steps

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Configure Railway deployment"
   git push origin main
   ```

2. **Configure Railway Service**
   - Go to Railway Dashboard
   - Select your service
   - Navigate to Variables tab
   - Add all required environment variables above

3. **Verify Deployment**
   - Check deployment logs for errors
   - Visit your Railway URL
   - Login with your `ROVER_WEB_TOKEN`
   - Try creating a test task

## Troubleshooting

### "spawn rover ENOENT" Error
This means the rover CLI wasn't built. Check:
- Build logs show `pnpm --filter @endorhq/rover build` succeeded
- `packages/cli/dist/index.mjs` exists after build

### "Authentication required" on all requests
- Verify `ROVER_WEB_TOKEN` is set in Railway variables
- Check you're using the correct token in the login modal

### Tasks fail with "API key not found"
- Add the appropriate AI provider API key (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc.)
- Restart the service after adding variables

### "Could not reach Rover CLI" error
- Check Railway logs for the actual error
- Verify the rover CLI build succeeded
- Ensure Node.js 20+ is being used

## Architecture Notes

The web dashboard runs the rover CLI as a child process. The CLI:
1. Creates Docker containers for AI agent execution
2. Manages Git worktrees for isolated task branches
3. Coordinates with AI providers (Claude, Gemini, etc.)

For production use, consider:
- Using a dedicated Docker host
- Setting up persistent storage for Git repositories
- Configuring proper resource limits
- Implementing rate limiting for API calls
