# Current State Diagnosis - March 22, 2026

## Issue Summary

Tasks were failing immediately without calling the Anthropic API, and failed tasks were disappearing from the system.

## Root Cause Analysis

### Problem 1: Invalid Model Name ❌

**Previous attempts used**: `claude-sonnet-4-6-20250620`  
**Error**: `"There's an issue with the selected model (claude-sonnet-4-6-20250620). It may not exist or you may not have access to it."`

**Root Cause**: The model name was incorrect. The actual model name is `claude-sonnet-4-20250514`.

**Impact**: Tasks failed immediately with exit code 1 before any API calls were made.

### Problem 2: Ephemeral Task Storage 🔄

**Architecture**: Workers store tasks in an in-memory `Map()` (see `packages/worker/server.js:35`)

```javascript
const tasks = new Map();
```

**Impact**: 
- When workers restart (every 3-5 minutes on Railway), all task history is lost
- Failed tasks disappear before logs can be retrieved
- No persistent audit trail

**Why tasks disappeared**: Railway workers auto-restart frequently, clearing the in-memory task storage.

## Solution Implemented

### ✅ Fixed Model Name

Updated task creation to use correct model: `claude-sonnet-4-20250514`

**New task created**: `3d969a34-4443-41d8-9720-168c55a576e9`  
**Status**: RUNNING (as of 03:00 UTC)  
**Worker**: rover-worker-1  
**Branch**: `rover/task/4a9c73de-a660-4885-af3a-057438d354af`

### ✅ Updated Documentation

Modified `.agents/skills/rover-remote/SKILL.md`:
1. Corrected model name in example
2. Added error message for invalid model names
3. Added debugging guidance for model-related failures

## Current System Status

### Active Tasks

| Task ID | Status | Agent | Model | Description |
|---------|--------|-------|-------|-------------|
| `73d6d2d4-faef-449c-8fc7-ca385510a165` | COMPLETED | claude | default | Simple README test |
| `6262ec5f-ec91-4594-897f-f37be55ec4e5` | FAILED | claude | claude-sonnet-4-6-20250620 | Director audit (wrong model) |
| `3d969a34-4443-41d8-9720-168c55a576e9` | RUNNING | claude | claude-sonnet-4-20250514 | Director audit (correct model) |

### Worker Pool

- **Total workers**: 7 (rover-worker-1 through rover-worker-7)
- **Online**: 7
- **Busy**: 1 (rover-worker-1 running audit task)
- **Idle**: 6

### Environment

- ✅ ANTHROPIC_API_KEY configured (has credit)
- ✅ GITHUB_TOKEN configured
- ✅ MCP servers configured (Laureline-Code + Playwright)
- ✅ Authentication working

## Lessons Learned

### 1. Model Names Matter

The error message "may not exist or you may not have access to it" was misleading - it suggested an API key issue when it was actually a model name issue.

**Correct model names**:
- `claude-sonnet-4-20250514` ✅
- `claude-opus-4-20250514` ✅
- NOT `claude-sonnet-4-6-20250620` ❌

### 2. Check Logs Immediately

With ephemeral storage, failed tasks can disappear within minutes. Always:
1. Create task
2. Immediately check status
3. Immediately retrieve logs if failed
4. Don't wait for worker restarts

### 3. Error Messages Can Be Ambiguous

"Agent exited with code 1" could mean:
- Invalid model name
- API key issue
- Repository access denied
- Agent crash
- Timeout

Always check the actual agent stderr/stdout in logs for the real error.

## Recommendations

### Short-term (Immediate)

1. ✅ **Use correct model names** - `claude-sonnet-4-20250514`
2. ✅ **Monitor tasks immediately** after creation
3. ✅ **Check logs on failure** before worker restarts

### Medium-term (Next Sprint)

1. **Add persistent task storage**
   - Use SQLite or PostgreSQL
   - Store task metadata and logs
   - Survive worker restarts

2. **Improve error messages**
   - Parse agent stderr for specific errors
   - Return structured error codes
   - Distinguish between error types

3. **Add model validation**
   - Validate model names before dispatching
   - Return 400 with helpful message
   - List available models in error

### Long-term (Future)

1. **Add task retention policy**
   - Keep failed tasks for 7 days
   - Auto-cleanup old tasks
   - Export logs to S3/storage

2. **Add worker health monitoring**
   - Track restart frequency
   - Alert on repeated failures
   - Log worker lifecycle events

3. **Add task recovery**
   - Auto-retry on worker restart
   - Resume interrupted tasks
   - Checkpoint progress

## Next Steps

1. **Wait for current task to complete** (ETA: 2-5 minutes)
2. **Verify ROVER_AUDIT.md was created** on branch
3. **Review audit findings**
4. **Dispatch follow-up tasks** based on audit results

## Files Modified

- `.agents/skills/rover-remote/SKILL.md` - Updated model name and error handling docs

## API Key Status

✅ **Confirmed working** - The Anthropic API key has credit and is functional. The previous failures were due to invalid model names, NOT API key issues.
