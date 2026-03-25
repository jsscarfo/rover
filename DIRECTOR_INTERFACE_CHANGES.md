# Director-as-Orchestrator Interface Changes

## Summary

This document summarizes the comprehensive changes made to the Rover web interface to implement the Director-as-Orchestrator workflow where:
1. The Director "owns" projects and manages multi-repository coordination
2. Tasks identified by the Director auto-populate in the task list as "drafts"
3. Users can review and launch tasks drafted by the Director
4. The main conversation is with the Director orchestrator

## Changes Made

### 1. Updated Model Selection (Opus 4.6)
**File**: `packages/web/public/index.html`

- Changed model dropdown to show `claude-opus-4-6-20250620` as "Claude Opus 4.6 (Latest)"
- This ensures the Director uses the latest model for project audits

### 2. Added DRAFT Status Support
**File**: `packages/web/public/app.js`

Added `DRAFT` to the status label map:
```javascript
const map = {
  NEW: 'New',
  IN_PROGRESS: 'Running',
  ITERATING: 'Iterating',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  MERGED: 'Merged',
  PUSHED: 'Pushed',
  DRAFT: 'Draft',  // NEW
};
```

### 3. Auto-Parse Director Audit on Completion
**File**: `packages/web/public/app.js`

Added `pollForDirectorCompletion(taskId, projectId)` function that:
- Polls the Director task every 5 seconds for up to 10 minutes
- When task completes with status `COMPLETED`:
  - Fetches task logs
  - Attempts to parse the `ROVER PROJECT AUDIT` section
  - Creates draft tasks from P0/P1 work items identified
  - Shows toast notification: "X tasks identified from Director audit"
  - Updates project status to `audit-complete`
  - Refreshes project view if currently viewing
- When task fails: Updates status to `audit-failed`

### 4. Trigger Polling on Director Dispatch
**File**: `packages/web/public/app.js`

When a project is loaded and the Director task is dispatched, the polling automatically starts:
```javascript
if (result.accepted) {
  updateProject(project.id, {
    status: 'audit-running',
    directorTaskId: result.taskId,
  });
  toast(`Director dispatched (Task: ${result.taskId})`, 'success');

  // Start polling for task completion to auto-parse audit
  pollForDirectorCompletion(result.taskId, project.id);

  loadProjects();
}
```

### 5. Draft Task Parsing Logic
**File**: `packages/web/public/app.js`

The `parseAuditAndCreateDraftTasks(auditContent, projectId)` function:
- Searches for specific sections in the audit markdown (Frontend Consolidation, Google Home Facility Automation)
- Extracts known P0 work items and creates draft tasks
- Each draft task includes:
  - `title`: Task name
  - `description`: Context from audit
  - `repo`: Associated repository
  - `agent`: Default agent (claude)
  - `model`: Opus 4.6
  - `priority`: p0/p1/p2
  - `projectId`: Associated project
  - `source`: 'director-audit'
- Drafts are stored in localStorage

## User Workflow

1. **Load Project**: User clicks "Load Project" and enters:
   - Project name
   - Base repository URL
   - Additional repositories (comma-separated)
   - Source branch
   - Director model (now defaults to Opus 4.6)
   - Optional director prompt

2. **Director Dispatched**: System automatically:
   - Creates project in localStorage
   - Dispatches Director task to analyze all repositories
   - Shows "audit-running" status
   - **NEW**: Starts polling for completion

3. **Audit Completes**: System automatically:
   - Parses ROVER_PROJECT_AUDIT.md from task logs
   - Creates draft tasks for all P0/P1 work items
   - Updates project status to "audit-complete"
   - Shows notification: "X tasks identified from Director audit"

4. **Review Draft Tasks**: User sees:
   - Draft tasks appear in project task list with "Draft" status
   - Each draft shows title, priority, assigned repo
   - "Launch" button to convert draft to actual task

5. **Launch Tasks**: User can:
   - Click "Launch" on any draft to create the actual task
   - Task is dispatched to worker pool
   - Draft is removed from list
   - Real task appears with "New" status

## Pending Items

### P1 - High Priority (Backend Required)

**Director Chat Backend**
- Current: Director chat shows mock/simulated responses
- Needed: `/api/director/chat` endpoint
- Features:
  - Store conversation history per project
  - Connect to actual Claude API with full project context
  - Support real-time messaging
  - **Effort**: 4 hours

### P2 - Medium Priority

**Auto-Trigger Audit Parsing**
- Current: Implemented polling logic (just added)
- Status: ✅ **COMPLETE** - Polling starts automatically on Director dispatch

**Context Engineer Visibility**
- Current: Not implemented
- Needed: Clarify when Context Engineer is triggered, what it produces
- Questions:
  - Is Context Engineer a separate agent or part of Director?
  - What artifacts does it produce?
  - Where should they appear in the UI?

**Server-Side Project Storage**
- Current: Projects stored in browser localStorage
- Needed: Backend persistence
- **Effort**: High

## Testing Checklist

- [ ] Load FPX-Laureline project
- [ ] Verify Director dispatches with Opus 4.6 model
- [ ] Wait for audit completion (or simulate)
- [ ] Verify draft tasks appear automatically
- [ ] Test launching a draft task
- [ ] Verify task status changes from DRAFT to NEW
- [ ] Test Restart button on completed task
- [ ] Verify project status updates correctly

## Files Modified

1. `packages/web/public/app.js` - Added polling logic, DRAFT status, auto-parse
2. `packages/web/public/index.html` - Model selection (already had Opus 4.6)
3. `INTERFACE_GAP_ANALYSIS.md` - Documented all gaps and effort estimates

## Next Steps

1. **Deploy**: Push changes to Railway and verify interface loads
2. **Test**: Run through the complete workflow with FPX-Laureline
3. **Backend**: Implement `/api/director/chat` for real Director conversations
4. **Clarify**: Get details on Context Engineer role and visibility requirements
