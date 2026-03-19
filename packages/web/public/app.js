/* ─────────────────────────────────────────────────────────
   Rover Web Dashboard — SPA Application
   ─────────────────────────────────────────────────────── */

'use strict';

// ── State ───────────────────────────────────────────────
const state = {
  currentPage: 'tasks',
  currentTask: null,        // full task inspection object
  currentTaskId: null,
  currentTab: 'overview',
  tasks: [],
  info: null,
  autoRefreshTimer: null,
  AUTO_REFRESH_MS: 8000,
};

// ── Utils ────────────────────────────────────────────────

// ── Auth ──────────────────────────────────────────────
function getToken() {
  return sessionStorage.getItem('rover_token');
}

function setToken(token) {
  sessionStorage.setItem('rover_token', token);
}

function clearToken() {
  sessionStorage.removeItem('rover_token');
}

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  const token = getToken();
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(path, opts);

  if (res.status === 401) {
    const data = await res.json().catch(() => ({}));
    if (data.code === 'AUTH_REQUIRED' || data.code === 'INVALID_TOKEN') {
      showLoginModal(data.code === 'INVALID_TOKEN' ? 'Invalid token. Please try again.' : null);
      throw new Error('AUTH_REQUIRED');
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(startTs, endTs) {
  if (!startTs) return '—';
  const start = new Date(startTs);
  const end = endTs ? new Date(endTs) : new Date();
  const s = Math.floor((end - start) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function statusLabel(s) {
  const map = {
    NEW: 'New', IN_PROGRESS: 'Running', ITERATING: 'Iterating',
    COMPLETED: 'Completed', FAILED: 'Failed', MERGED: 'Merged', PUSHED: 'Pushed',
  };
  return map[s] || s;
}

function statusBadge(s) {
  return `<span class="status-badge status-${s}">${statusLabel(s)}</span>`;
}

function progressBar(pct, status) {
  let cls = '';
  if (['COMPLETED', 'MERGED', 'PUSHED'].includes(status)) cls = 'done';
  else if (status === 'FAILED') cls = 'failed';
  else if (status === 'ITERATING') cls = 'purple';
  const p = Math.min(100, Math.max(0, pct || 0));
  return `<div class="progress-wrap">
    <div class="progress-bar"><div class="progress-fill ${cls}" style="width:${p}%"></div></div>
    <span class="progress-pct">${p}%</span>
  </div>`;
}

function escHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function metaItem(label, value, mono = false) {
  return `<div class="meta-item">
    <div class="meta-label">${label}</div>
    <div class="meta-value${mono ? ' mono' : ''}">${value || '—'}</div>
  </div>`;
}

// ── Toast ────────────────────────────────────────────────

function toast(msg, type = 'info') {
  const icons = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="#5dd6a0" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg viewBox="0 0 24 24" fill="none" stroke="#e87878" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info:    `<svg viewBox="0 0 24 24" fill="none" stroke="var(--teal-light)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>`,
  };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `${icons[type] || icons.info}<span>${escHtml(msg)}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// ── Navigation ────────────────────────────────────────────

function showPage(name) {
  // hide all, show target
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${name}`)?.classList.add('active');

  // update nav
  document.querySelectorAll('.nav-item[data-page]').forEach(n => {
    n.classList.toggle('active', n.dataset.page === name);
  });

  state.currentPage = name;

  // update topbar
  const titles = { tasks: 'Tasks', info: 'Rover Store', detail: 'Task Detail' };
  const icons = {
    tasks: `<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>`,
    info:  `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="8"/><line x1="12" y1="12" x2="12" y2="16"/>`,
    detail: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`,
  };
  document.getElementById('topbar-title').innerHTML =
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icons[name] || ''}</svg>${titles[name] || ''}`;

  if (name === 'info') loadInfo();
  if (name === 'tasks') loadTasks();
}

// ── Auto-refresh ─────────────────────────────────────────

function startAutoRefresh() {
  stopAutoRefresh();
  state.autoRefreshTimer = setInterval(() => {
    if (state.currentPage === 'tasks') loadTasks(true);
    if (state.currentPage === 'detail' && state.currentTaskId) {
      loadTaskDetail(state.currentTaskId, true);
    }
  }, state.AUTO_REFRESH_MS);

  document.getElementById('refresh-dot').style.display = 'inline-block';
}

function stopAutoRefresh() {
  if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = null;
}

function refreshCurrentPage() {
  if (state.currentPage === 'tasks') loadTasks();
  else if (state.currentPage === 'detail' && state.currentTaskId) loadTaskDetail(state.currentTaskId);
  else if (state.currentPage === 'info') loadInfo();
}

function setLastRefresh() {
  const el = document.getElementById('last-refresh');
  if (el) el.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

// ── Tasks Page ────────────────────────────────────────────

async function loadTasks(silent = false) {
  if (!silent) {
    document.getElementById('task-list-body').innerHTML =
      `<div class="loading-state"><div class="spinner"></div> Loading tasks…</div>`;
  }
  try {
    const tasks = await api('/api/tasks');
    state.tasks = Array.isArray(tasks) ? tasks : [];
    renderTasks(state.tasks);
    updateStats(state.tasks);
    setLastRefresh();
  } catch (e) {
    if (!silent) {
      document.getElementById('task-list-body').innerHTML =
        `<div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          <div class="empty-state-title">Could not reach Rover CLI</div>
          <div class="empty-state-desc">${escHtml(e.message)}</div>
        </div>`;
      toast(e.message, 'error');
    }
  }
}

function updateStats(tasks) {
  const total = tasks.length;
  const running = tasks.filter(t => ['IN_PROGRESS', 'ITERATING'].includes(t.status)).length;
  const done = tasks.filter(t => ['COMPLETED', 'MERGED', 'PUSHED'].includes(t.status)).length;
  const failed = tasks.filter(t => t.status === 'FAILED').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-running').textContent = running;
  document.getElementById('stat-done').textContent = done;
  document.getElementById('stat-failed').textContent = failed;

  const badge = document.getElementById('badge-tasks');
  badge.textContent = total;
  badge.style.display = total > 0 ? '' : 'none';
}

function renderTasks(tasks) {
  const container = document.getElementById('task-list-body');

  if (tasks.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
      </svg>
      <div class="empty-state-title">No tasks found</div>
      <div class="empty-state-desc">Create a new task to get started.</div>
      <button class="btn btn-primary btn-sm" onclick="openCreateModal()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Task
      </button>
    </div>`;
    return;
  }

  // Sort: running first, then by id desc
  const sorted = [...tasks].sort((a, b) => {
    const running = (s) => ['IN_PROGRESS', 'ITERATING'].includes(s) ? 1 : 0;
    if (running(b.status) !== running(a.status)) return running(b.status) - running(a.status);
    return b.id - a.id;
  });

  let rows = sorted.map(t => {
    const iterData = t.iterationsData?.[t.iterationsData.length - 1];
    const iterStatus = iterData?.status ? iterData.status() : null;
    let pct = iterStatus?.progress ?? 0;
    let step = iterStatus?.currentStep ?? '—';
    let endTime = t.completedAt || t.failedAt;
    const duration = fmtDuration(t.startedAt, endTime);
    let agentDisplay = t.agent || '—';
    if (t.agent && t.agentModel) agentDisplay = `${t.agent}:${t.agentModel}`;
    else if (t.agent) agentDisplay = t.agent;

    return `<tr onclick="openTask(${t.id})" title="Open task ${t.id}">
      <td><span class="task-id">#${t.id}</span></td>
      <td><span class="task-title">${escHtml(t.title || t.description?.slice(0, 60) || 'Untitled')}</span></td>
      <td><span class="task-agent">${escHtml(agentDisplay)}</span></td>
      <td>${statusBadge(t.status)}</td>
      <td>${progressBar(pct, t.status)}</td>
      <td style="font-size:0.78rem;color:var(--text-3);max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(step)}</td>
      <td style="font-size:0.78rem;color:var(--text-3);white-space:nowrap">${duration}</td>
      <td>
        <div style="display:flex;gap:4px;opacity:0;transition:opacity 0.15s" class="row-actions">
          ${actionButtons(t)}
        </div>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `<div class="task-table-wrap">
    <table class="task-table">
      <thead>
        <tr>
          <th>ID</th><th>Title</th><th>Agent</th><th>Status</th>
          <th>Progress</th><th>Current Step</th><th>Duration</th><th></th>
        </tr>
      </thead>
      <tbody id="task-tbody">${rows}</tbody>
    </table>
  </div>`;

  // Show row actions on hover
  container.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('mouseenter', () => tr.querySelector('.row-actions').style.opacity = '1');
    tr.addEventListener('mouseleave', () => tr.querySelector('.row-actions').style.opacity = '0');
  });
}

function actionButtons(t) {
  const isRunning = ['IN_PROGRESS', 'ITERATING'].includes(t.status);
  const isDone = ['COMPLETED', 'MERGED', 'PUSHED', 'FAILED'].includes(t.status);
  let btns = '';
  if (isRunning) {
    btns += `<button class="btn btn-ghost btn-sm btn-icon" title="Stop" onclick="event.stopPropagation();stopTask(${t.id})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg>
    </button>`;
  }
  if (isDone && t.status !== 'MERGED') {
    btns += `<button class="btn btn-ghost btn-sm btn-icon" title="Merge" onclick="event.stopPropagation();mergeTask(${t.id})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>
    </button>`;
  }
  if (t.status === 'FAILED' || t.status === 'NEW') {
    btns += `<button class="btn btn-ghost btn-sm btn-icon" title="Restart" onclick="event.stopPropagation();restartTask(${t.id})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.26"/></svg>
    </button>`;
  }
  btns += `<button class="btn btn-danger btn-sm btn-icon" title="Delete" onclick="event.stopPropagation();deleteTask(${t.id})">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
  </button>`;
  return btns;
}

// ── Task Detail Page ──────────────────────────────────────

async function openTask(id) {
  state.currentTaskId = id;
  showPage('detail');
  switchTab('overview');
  document.getElementById('detail-breadcrumb').textContent = `Task #${id}`;
  document.getElementById('detail-title').textContent = `Loading…`;
  document.getElementById('detail-subtitle').textContent = '';
  document.getElementById('detail-actions').innerHTML = '';
  document.getElementById('detail-meta').innerHTML = '';
  document.getElementById('detail-description').textContent = '';
  document.getElementById('detail-iterations').innerHTML =
    `<div class="loading-state"><div class="spinner"></div></div>`;

  await loadTaskDetail(id);
}

async function loadTaskDetail(id, silent = false) {
  try {
    const task = await api(`/api/tasks/${id}`);
    state.currentTask = task;
    renderTaskDetail(task);
    setLastRefresh();
  } catch (e) {
    if (!silent) toast(e.message, 'error');
  }
}

function renderTaskDetail(task) {
  if (!task) return;

  document.getElementById('detail-breadcrumb').textContent = `Task #${task.id}`;
  document.getElementById('detail-title').textContent = task.title || `Task #${task.id}`;
  document.getElementById('detail-subtitle').innerHTML = statusBadge(task.status);
  document.getElementById('detail-description').textContent = task.description || 'No description.';

  // Meta
  const agent = task.agentDisplay || (task.agent && task.agentModel ? `${task.agent}:${task.agentModel}` : task.agent || '—');
  document.getElementById('detail-meta').innerHTML = [
    metaItem('Status', statusBadge(task.status)),
    metaItem('Agent', escHtml(agent)),
    metaItem('Workflow', escHtml(task.workflowName)),
    metaItem('Iterations', task.iterations),
    metaItem('Branch', `<span class="mono">${escHtml(task.branchName)}</span>`),
    metaItem('Source Branch', `<span class="mono">${escHtml(task.sourceBranch || '—')}</span>`),
    metaItem('Created', fmt(task.createdAt)),
    metaItem('Started', fmt(task.startedAt)),
    task.completedAt ? metaItem('Completed', fmt(task.completedAt)) : '',
    task.failedAt    ? metaItem('Failed', fmt(task.failedAt)) : '',
    metaItem('Duration', fmtDuration(task.startedAt, task.completedAt || task.failedAt)),
  ].join('');

  // Action buttons
  const status = task.status;
  const isRunning = ['IN_PROGRESS', 'ITERATING'].includes(status);
  const isDone = ['COMPLETED', 'FAILED', 'MERGED', 'PUSHED'].includes(status);
  let actions = '';

  actions += `<button class="btn btn-ghost btn-sm" onclick="switchTab('logs')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg>
    Logs
  </button>`;

  actions += `<button class="btn btn-ghost btn-sm" onclick="switchTab('diff')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/></svg>
    Diff
  </button>`;

  if (isRunning) {
    actions += `<button class="btn btn-ghost btn-sm" onclick="stopTask(${task.id})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg>
      Stop
    </button>`;
  }

  if (isDone && status !== 'MERGED') {
    actions += `<button class="btn btn-ghost btn-sm" onclick="mergeTask(${task.id})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>
      Merge
    </button>`;
    if (status !== 'PUSHED') {
      actions += `<button class="btn btn-ghost btn-sm" onclick="pushTask(${task.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Push
      </button>`;
    }
  }

  if (['FAILED', 'NEW'].includes(status)) {
    actions += `<button class="btn btn-ghost btn-sm" onclick="restartTask(${task.id})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.26"/></svg>
      Restart
    </button>`;
  }

  actions += `<button class="btn btn-danger btn-sm" onclick="deleteTask(${task.id})">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
    Delete
  </button>`;

  document.getElementById('detail-actions').innerHTML = actions;

  // File changes
  const files = task.fileChanges || [];
  if (files.length > 0) {
    document.getElementById('detail-files').innerHTML = files.map(f => `
      <div class="file-item">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="truncate">${escHtml(f.path)}</span>
        <div class="file-stat">
          <span class="file-add">+${f.insertions}</span>
          <span class="file-del">-${f.deletions}</span>
        </div>
      </div>`
    ).join('');
  } else {
    document.getElementById('detail-files').innerHTML =
      `<div class="text-dim" style="font-size:0.8rem">No file changes recorded yet.</div>`;
  }

  // Iteration timeline
  renderIterations(task);
}

function renderIterations(task) {
  const container = document.getElementById('detail-iterations');
  const count = task.iterations || 1;
  let html = '<div class="timeline">';
  for (let i = 1; i <= count; i++) {
    const isLast = i === count;
    const dotClass = isLast ?
      (task.status === 'FAILED' ? 'failed' : ['COMPLETED','MERGED','PUSHED'].includes(task.status) ? 'completed' : 'running')
      : 'completed';
    html += `<div class="timeline-item">
      <div class="timeline-dot ${dotClass}"></div>
      <div class="timeline-line"></div>
      <div class="timeline-content">
        <div class="timeline-title">Iteration ${i}</div>
        <div class="timeline-time">${isLast ? statusLabel(task.status) : 'Completed'}</div>
      </div>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

// ── Tabs ──────────────────────────────────────────────────

function switchTab(name) {
  state.currentTab = name;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${name}`)?.classList.add('active');

  ['overview', 'logs', 'diff'].forEach(t => {
    document.getElementById(`tab-panel-${t}`)?.classList.toggle('hidden', t !== name);
  });

  if (name === 'logs' && state.currentTaskId) loadLogs();
  if (name === 'diff' && state.currentTaskId) loadDiff();
}

async function loadLogs() {
  const viewer = document.getElementById('log-viewer');
  viewer.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
  try {
    const data = await api(`/api/tasks/${state.currentTaskId}/logs`);
    const raw = data.logs || data.raw || JSON.stringify(data, null, 2);
    renderLogs(viewer, raw);
  } catch (e) {
    viewer.innerHTML = `<div class="log-line error">Error: ${escHtml(e.message)}</div>`;
  }
}

function renderLogs(viewer, raw) {
  const lines = raw.split('\n');
  viewer.innerHTML = lines.map(line => {
    let cls = 'log-line';
    const lo = line.toLowerCase();
    if (lo.includes('error') || lo.includes('fail')) cls += ' error';
    else if (lo.includes('success') || lo.includes('complete') || lo.includes('done')) cls += ' success';
    else if (lo.startsWith('[') || lo.includes(' info ')) cls += ' info';
    else if (lo.includes('warn')) cls += ' warn';
    return `<div class="${cls}">${escHtml(line)}</div>`;
  }).join('');
  viewer.scrollTop = viewer.scrollHeight;
}

async function loadDiff() {
  const viewer = document.getElementById('diff-viewer');
  viewer.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
  document.getElementById('diff-stats').textContent = '';
  try {
    const data = await api(`/api/tasks/${state.currentTaskId}/diff`);
    renderDiff(viewer, data);
  } catch (e) {
    viewer.innerHTML = `<div class="log-line error" style="padding:16px">Error: ${escHtml(e.message)}</div>`;
  }
}

function renderDiff(viewer, data) {
  const raw = data.diff || '';

  if (!raw.trim()) {
    viewer.innerHTML = `<div class="empty-state" style="padding:40px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
      <div class="empty-state-title">No diff available</div>
    </div>`;
    return;
  }

  // Compute stats
  if (data.files) {
    const adds = data.files.reduce((s, f) => s + (f.insertions || 0), 0);
    const dels = data.files.reduce((s, f) => s + (f.deletions || 0), 0);
    document.getElementById('diff-stats').innerHTML =
      `<span style="color:var(--status-completed)">+${adds}</span> &nbsp;<span style="color:var(--status-failed)">−${dels}</span>`;
  }

  const lines = raw.split('\n');
  let html = '';
  let lineNum = 0;

  lines.forEach(line => {
    let cls = 'diff-line';
    let prefix = ' ';
    if (line.startsWith('+++') || line.startsWith('---')) {
      cls += ' header'; prefix = '';
    } else if (line.startsWith('@@')) {
      cls += ' hunk'; prefix = '';
      lineNum = 0;
    } else if (line.startsWith('+')) {
      cls += ' added'; lineNum++; prefix = '+';
    } else if (line.startsWith('-')) {
      cls += ' removed'; prefix = '−';
    } else {
      lineNum++;
    }
    const gutter = (lineNum > 0 && !cls.includes('header') && !cls.includes('hunk'))
      ? `<span class="diff-gutter">${lineNum}</span>`
      : `<span class="diff-gutter"></span>`;

    html += `<div class="${cls}">${gutter}<span class="diff-content">${escHtml(line)}</span></div>`;
  });

  viewer.innerHTML = html;
}

// ── Info Page ─────────────────────────────────────────────

async function loadInfo() {
  document.getElementById('info-body').innerHTML =
    `<div class="loading-state"><div class="spinner"></div> Loading…</div>`;
  try {
    const data = await api('/api/info');
    renderInfo(data);
    setLastRefresh();
  } catch (e) {
    document.getElementById('info-body').innerHTML =
      `<div class="empty-state">
        <div class="empty-state-title">Could not load info</div>
        <div class="empty-state-desc">${escHtml(e.message)}</div>
      </div>`;
    toast(e.message, 'error');
  }
}

function renderInfo(data) {
  const projects = data.projects || [];
  let html = `<div class="stats-grid mb-5">
    <div class="stat-card">
      <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
      <div class="stat-value">${data.projectCount ?? projects.length}</div>
      <div class="stat-label">Projects</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg></div>
      <div class="stat-value">${projects.reduce((s, p) => s + (p.taskCount || 0), 0)}</div>
      <div class="stat-label">Total Tasks</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21l18-9L3 3v7l13 2-13 2z"/></svg></div>
      <div class="stat-value mono" style="font-size:0.8rem;word-break:break-all">${escHtml((data.storePath || '—').split(/[\/\\]/).pop() || '—')}</div>
      <div class="stat-label">Store</div>
    </div>
  </div>`;

  if (projects.length === 0) {
    html += `<div class="empty-state" style="padding:var(--space-10)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <div class="empty-state-title">No projects registered</div>
      <div class="empty-state-desc">Run <code>rover task</code> in a project directory to register it.</div>
    </div>`;
  } else {
    html += `<div class="card"><div class="card-header"><div class="card-title">Registered Projects</div></div>
      <div class="card-body"><div class="project-list">`;
    html += projects.map(p => `
      <div class="project-card">
        <div class="project-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
        <div style="min-width:0;flex:1">
          <div class="project-name">${escHtml(p.name)}</div>
          <div class="project-path" title="${escHtml(p.path)}">${escHtml(p.path)}</div>
        </div>
        <span class="project-tasks-count">${p.taskCount} task${p.taskCount !== 1 ? 's' : ''}</span>
      </div>`
    ).join('');
    html += `</div></div></div>`;
  }

  document.getElementById('info-body').innerHTML = html;
}

// ── Task Actions ──────────────────────────────────────────

async function stopTask(id) {
  if (!confirm(`Stop task #${id}?`)) return;
  try {
    await api(`/api/tasks/${id}/stop`, 'POST');
    toast(`Task #${id} stopped.`, 'success');
    loadTasks(true);
    if (state.currentPage === 'detail') loadTaskDetail(id, true);
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteTask(id) {
  if (!confirm(`Delete task #${id}? This cannot be undone.`)) return;
  try {
    await api(`/api/tasks/${id}/delete`, 'POST');
    toast(`Task #${id} deleted.`, 'success');
    if (state.currentPage === 'detail') showPage('tasks');
    else loadTasks();
  } catch (e) { toast(e.message, 'error'); }
}

async function mergeTask(id) {
  if (!confirm(`Merge task #${id} into current branch?`)) return;
  try {
    await api(`/api/tasks/${id}/merge`, 'POST');
    toast(`Task #${id} merged!`, 'success');
    loadTasks(true);
    if (state.currentPage === 'detail') loadTaskDetail(id, true);
  } catch (e) { toast(e.message, 'error'); }
}

async function pushTask(id) {
  if (!confirm(`Push task #${id} to remote?`)) return;
  try {
    await api(`/api/tasks/${id}/push`, 'POST');
    toast(`Task #${id} pushed!`, 'success');
    loadTasks(true);
    if (state.currentPage === 'detail') loadTaskDetail(id, true);
  } catch (e) { toast(e.message, 'error'); }
}

async function restartTask(id) {
  if (!confirm(`Restart task #${id}?`)) return;
  try {
    await api(`/api/tasks/${id}/restart`, 'POST');
    toast(`Task #${id} restarted.`, 'success');
    loadTasks(true);
    if (state.currentPage === 'detail') loadTaskDetail(id, true);
  } catch (e) { toast(e.message, 'error'); }
}

// ── Login Modal ───────────────────────────────────────────

function showLoginModal(errorMsg = null) {
  document.getElementById('login-modal').classList.add('open');
  const errEl = document.getElementById('login-error');
  if (errorMsg) {
    errEl.textContent = errorMsg;
    errEl.style.display = 'block';
  } else {
    errEl.style.display = 'none';
  }
  setTimeout(() => document.getElementById('login-token').focus(), 100);
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.remove('open');
}

async function submitLogin() {
  const token = document.getElementById('login-token').value.trim();
  if (!token) return;
  setToken(token);
  closeLoginModal();
  await init(); // re-initialize with the token
}

function logout() {
  clearToken();
  location.reload();
}

// ── Create Task Modal ─────────────────────────────────────

function openCreateModal() {
  document.getElementById('create-modal').classList.add('open');
  setTimeout(() => document.getElementById('task-description').focus(), 100);
}

function closeCreateModal() {
  document.getElementById('create-modal').classList.remove('open');
}

async function createTask() {
  const description = document.getElementById('task-description').value.trim();
  if (!description) {
    toast('Please enter a task description.', 'error');
    document.getElementById('task-description').focus();
    return;
  }

  const agent    = document.getElementById('task-agent').value || undefined;
  const workflow = document.getElementById('task-workflow').value || undefined;
  const branch   = document.getElementById('task-branch').value.trim() || undefined;

  const btn = document.getElementById('btn-create-task');
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div> Creating…`;

  try {
    const result = await api('/api/tasks', 'POST', { description, agent, workflow, sourceBranch: branch });
    closeCreateModal();
    document.getElementById('task-description').value = '';
    document.getElementById('task-agent').value = '';
    document.getElementById('task-workflow').value = '';
    document.getElementById('task-branch').value = '';

    const newId = result.taskId || result.tasks?.[0]?.taskId;
    toast(`Task created${newId ? ` (#${newId})` : ''}!`, 'success');
    showPage('tasks');
    await loadTasks();
    if (newId) setTimeout(() => openTask(newId), 600);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> Create Task`;
  }
}

// Close modal when clicking overlay
document.getElementById('create-modal').addEventListener('click', function(e) {
  if (e.target === this) closeCreateModal();
});

// Close login modal when clicking overlay
document.getElementById('login-modal').addEventListener('click', function(e) {
  if (e.target === this) closeLoginModal();
});

// Login token Enter key handler
document.getElementById('login-token')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') submitLogin();
});

// Close modal with Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeCreateModal();
    closeLoginModal();
  }
});

// Textarea: Ctrl+Enter to submit
document.getElementById('task-description').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') createTask();
});

// ── Init ──────────────────────────────────────────────────

async function init() {
  try {
    const health = await fetch('/api/health').then(r => r.json());
    if (health.authRequired && !getToken()) {
      showLoginModal();
      return;
    }
  } catch { /* ignore — server might not have health endpoint */ }

  // Show/hide logout button based on auth state
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.style.display = getToken() ? '' : 'none';

  await loadTasks();
  startAutoRefresh();
}

init();
