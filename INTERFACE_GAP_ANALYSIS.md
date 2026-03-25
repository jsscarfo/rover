# Rover Interface Gap Analysis

**Date**: 2026-03-25
**Scan Tool**: Playwright
**Deployed Version**: Director-as-Orchestrator Edition

---

## ✅ What's Working

| Feature | Status | Notes |
|---------|--------|-------|
| Sidebar Navigation | ✅ | All menu items load correctly |
| Projects Page | ✅ | Grid layout renders |
| Director Chat Page | ✅ | UI renders, input works |
| Workers Page | ✅ | Worker list displays |
| Tasks Page | ✅ | Task table renders |
| Load Project Modal | ✅ | Opens, all fields present |
| Authentication | ✅ | Token-based auth working |

---

## ❌ Gaps Identified

### 1. Director Chat is Mock/Simulated

**Current Behavior**: 
- Chat messages are simulated with setTimeout
- No actual backend connection
- Response: "I would need to be restarted with additional instructions"

**Expected Behavior**:
- Director should maintain ongoing conversation
- Should be able to dispatch workers from chat
- Should have memory of project context

**Fix Required**:
- Create `/api/director/chat` endpoint
- Store conversation history per project
- Connect to actual Claude API with context

### 2. Tasks from Audit Don't Pre-populate

**Current Behavior**:
- Director creates ROVER_PROJECT_AUDIT.md
- Tasks listed in markdown table
- User must manually create each task

**Expected Behavior**:
- Parse audit.md and extract tasks
- Create "draft" tasks with status "NOT_STARTED"
- Human reviews and clicks "Launch" to dispatch

**Fix Required**:
- Parse markdown tables from audit
- Create task drafts in localStorage
- Add "Launch" button to draft tasks

### 3. Wrong Model Version

**Current Behavior**:
- Model dropdown shows: `claude-opus-4-20250514`
- This is the older Opus 4 model

**Expected Behavior**:
- Should use `claude-opus-4-6-20250620` (Opus 4.6)
- Or latest available Opus version

**Fix Required**:
- Update model dropdown options
- Verify model name with Anthropic docs

### 4. Context Engineer Role Not Visible

**Current Behavior**:
- "Agent Role" dropdown has "Context Engineer" option
- No visibility into what this role does
- No triggering mechanism shown

**Expected Behavior**:
- Context Engineer should be triggered at specific times
- Should show when it's running
- Should have visible output/reports

**Clarification Needed**:
- When is Context Engineer triggered?
- What does it produce?
- How is it different from Director?

### 5. No "Restart" Button in Task Detail

**Current Behavior**:
- Agent says "use the Restart button"
- But no Restart button visible in UI

**Expected Behavior**:
- Restart button should be in task detail actions
- Should allow continuing with new instructions

**Fix Required**:
- Add Restart button to task detail page
- Implement restart functionality

### 6. Project Detail Shows Empty State

**Current Behavior**:
- Projects page shows no cards (Playwright scan)
- Projects stored in localStorage only
- No server-side persistence

**Expected Behavior**:
- Projects should persist across sessions
- Should show FPX Laureline project from audit

**Fix Required**:
- Server-side project storage
- Or hydrate from audit task metadata

---

## 🔧 Implementation Priority

| Priority | Gap | Effort | Impact |
|----------|-----|--------|--------|
| P0 | Task pre-population from audit | Medium | High - Saves manual work |
| P0 | Add Restart button | Low | High - Core functionality |
| P1 | Fix Director chat backend | High | High - Key feature |
| P1 | Update model to Opus 4.6 | Low | Medium |
| P2 | Context Engineer visibility | Medium | Low |
| P2 | Server-side project storage | High | Medium |

---

## 📋 Specific Fixes Needed

### Fix 1: Update Model Selection

```javascript
// In index.html, update the model dropdown:
<select class="form-select" id="project-model">
  <option value="claude-opus-4-6-20250620">Claude Opus 4.6</option>
  <option value="claude-opus-4-20250514">Claude Opus 4</option>
  <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
</select>
```

### Fix 2: Parse Audit and Create Draft Tasks

```javascript
// After Director task completes:
function parseAuditAndCreateTasks(auditContent, projectId) {
  // Extract tasks from markdown tables
  // Create draft tasks with status: 'DRAFT'
  // Store in localStorage
}
```

### Fix 3: Add Restart Button

```javascript
// In task detail actions:
if (t.status === 'FAILED' || t.status === 'NEW' || t.status === 'COMPLETED') {
  btns += `<button class="btn btn-ghost" onclick="restartTask('${id}')">Restart</button>`;
}
```

### Fix 4: Director Chat Backend

```javascript
// New API endpoint:
POST /api/director/chat
{
  projectId: "...",
  message: "...",
  history: [...]
}
```

---

## 🎯 Context Engineer Clarification

Based on the code, Context Engineer is listed as an agent role option but:

1. **When triggered?** - Not clear from current implementation
2. **What does it do?** - Likely manages context/state across tasks
3. **Visibility?** - Currently none in UI

**Recommendation**: 
- Remove from dropdown until fully implemented
- Or add info tooltip explaining when it's used

---

## 📸 Screenshot Reference

Playwright scan screenshot saved at:
`packages/web/rover-interface-scan.png`

---

## Next Steps

1. Implement Fix 1 (model update) - 5 min
2. Implement Fix 2 (Restart button) - 15 min
3. Implement Fix 3 (task pre-population) - 2 hours
4. Design Fix 4 (Director chat backend) - 4 hours
5. Clarify Context Engineer with team
