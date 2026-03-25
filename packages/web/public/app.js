/* ─────────────────────────────────────────────────────────
   Rover Web Dashboard — Director-as-Orchestrator Edition
   ─────────────────────────────────────────────────────── */

'use strict';

// ── State ───────────────────────────────────────────────
const state = {
  currentPage: 'projects',
  currentTask: null,
  currentTaskId: null,
  currentTab: 'overview',
  currentProjectTab: 'overview',
  currentProjectId: null,
  tasks: [],
  projects: [], // New: loaded projects with Director ownership
  info: null,
  autoRefreshTimer: null,
  constellationTimer: null,
  AUTO_REFRESH_MS: 8000,
  CONSTELLATION_MS: 10000,
  workers: [],
  drawerWorkerIndex: null,
  drawerTaskId: null,
  drawerLogTimer: null,
  directorChat: [], // New: main director conversation
  projectChats: {}, // New: per-project director conversations
  taskConversations: {}, // New: per-task agent conversations
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
      showLoginModal(
        data.code === 'INVALID_TOKEN'
          ? 'Invalid token. Please try again.'
          : null
      );
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
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
    NEW: 'New',
    IN_PROGRESS: 'Running',
    ITERATING: 'Iterating',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    MERGED: 'Merged',
    PUSHED: 'Pushed',
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
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
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
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="#e87878" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--teal-light)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>`,
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
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${name}`)?.classList.add('active');

  document.querySelectorAll('.nav-item[data-page]').forEach(n => {
    n.classList.toggle('active', n.dataset.page === name);
  });

  state.currentPage = name;

  const titles = {
    projects: 'Projects',
    'project-detail': 'Project Detail',
    director: 'Director Chat',
    workers: 'Workers',
    tasks: 'All Tasks',
    detail: 'Task Detail',
    info: 'Rover Store'
  };
  const icons = {
    projects: `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
    'project-detail': `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
    director: `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`,
    workers: `<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>`,
    tasks: `<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>`,
    detail: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`,
    info: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="8"/><line x1="12" y1="12" x2="12" y2="16"/>`,
  };
  document.getElementById('topbar-title').innerHTML =
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icons[name] || ''}</svg>${titles[name] || ''}`;

  // Load page data
  if (name === 'projects') loadProjects();
  if (name === 'director') loadDirectorPage();
  if (name === 'workers') loadWorkersPage();
  if (name === 'tasks') loadTasks();
  if (name === 'info') loadInfo();
}

// ── Auto-refresh ─────────────────────────────────────────

function startAutoRefresh() {
  stopAutoRefresh();
  state.autoRefreshTimer = setInterval(() => {
    if (state.currentPage === 'projects') loadProjects(true);
    if (state.currentPage === 'tasks') loadTasks(true);
    if (state.currentPage === 'detail' && state.currentTaskId) {
      loadTaskDetail(state.currentTaskId, true);
    }
    if (state.currentPage === 'project-detail' && state.currentProjectId) {
      loadProjectDetail(state.currentProjectId, true);
    }
  }, state.AUTO_REFRESH_MS);

  document.getElementById('refresh-dot').style.display = 'inline-block';
}

function stopAutoRefresh() {
  if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = null;
}

function refreshCurrentPage() {
  if (state.currentPage === 'projects') loadProjects();
  else if (state.currentPage === 'project-detail' && state.currentProjectId)
    loadProjectDetail(state.currentProjectId);
  else if (state.currentPage === 'director') loadDirectorPage();
  else if (state.currentPage === 'workers') loadWorkersPage();
  else if (state.currentPage === 'tasks') loadTasks();
  else if (state.currentPage === 'detail' && state.currentTaskId)
    loadTaskDetail(state.currentTaskId);
  else if (state.currentPage === 'info') loadInfo();
}

function setLastRefresh() {
  const el = document.getElementById('last-refresh');
  if (el) el.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

// ── Constellation / Worker Status ─────────────────────

async function loadConstellationStatus(silent = false) {
  try {
    const data = await api('/api/constellation/status');
    state.workers = data.workers || [];
    renderConstellationBar(data);
    return data;
  } catch {
    if (!silent) renderConstellationBar(null);
  }
}

function renderConstellationBar(data) {
  const workersEl = document.getElementById('constellation-workers');
  const summaryEl = document.getElementById('constellation-summary');
  const placeholder = document.getElementById('worker-placeholder');

  if (!data || !data.total) {
    if (placeholder) placeholder.style.display = '';
    workersEl.querySelectorAll('.worker-badge').forEach(b => b.remove());
    summaryEl.style.display = 'none';
    return;
  }

  if (placeholder) placeholder.style.display = 'none';
  summaryEl.style.display = 'flex';

  document.getElementById('cs-idle').textContent = data.idle ?? 0;
  document.getElementById('cs-busy').textContent = data.busy ?? 0;
  document.getElementById('cs-offline').textContent =
    data.total - data.online ?? 0;

  const workers = data.workers || [];
  const existingBadges = workersEl.querySelectorAll('.worker-badge');

  workers.forEach((w, i) => {
    const stateClass =
      w.state === 'idle' ? 'idle' : w.state === 'busy' ? 'busy' : 'offline';
    const label = w.taskId
      ? `W${w.index + 1} · ${escHtml(w.agent || '?')}`
      : `W${w.index + 1}`;
    const title =
      w.state === 'busy'
        ? `Worker ${w.index + 1} — busy (task ${w.taskId})`
        : `Worker ${w.index + 1} — ${w.state}`;

    let badge = existingBadges[i];
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'worker-badge';
      badge.innerHTML = '<span class="wdot"></span><span class="wlbl"></span>';
      workersEl.appendChild(badge);
    }
    badge.className = `worker-badge ${stateClass}${w.state === 'busy' ? ' clickable' : ''}`;
    badge.title = title;
    badge.querySelector('.wlbl').textContent = label;

    if (w.state === 'busy' && w.taskId !== undefined) {
      badge.onclick = () => openWorkerDrawer(w.index, w.taskId);
    } else {
      badge.onclick = null;
    }
  });

  for (let i = workers.length; i < existingBadges.length; i++) {
    existingBadges[i].remove();
  }
}

function startConstellationPolling() {
  stopConstellationPolling();
  loadConstellationStatus(true);
  state.constellationTimer = setInterval(
    () => loadConstellationStatus(true),
    state.CONSTELLATION_MS
  );
}

function stopConstellationPolling() {
  if (state.constellationTimer) clearInterval(state.constellationTimer);
  state.constellationTimer = null;
}

// ── Worker Drawer ─────────────────────────────────────

async function openWorkerDrawer(index, taskId) {
  state.drawerWorkerIndex = index;
  state.drawerTaskId = taskId;
  const drawer = document.getElementById('worker-drawer');
  drawer.classList.add('open');
  document.getElementById('drawer-worker-label').textContent = `Worker ${index + 1}`;

  // Find worker info
  const worker = state.workers.find(w => w.index === index);
  document.getElementById('drawer-meta').innerHTML = worker
    ? `<span>Task: <code>${escHtml(taskId || '—')}</code></span>
       <span>Agent: ${escHtml(worker.agent || '—')}</span>
       <span>State: ${escHtml(worker.state)}</span>`
    : '';

  // Show/hide stop button based on task status
  const stopBtn = document.getElementById('drawer-stop-btn');
  stopBtn.style.display = taskId ? '' : 'none';

  await loadDrawerLogs();
  if (state.drawerLogTimer) clearInterval(state.drawerLogTimer);
  state.drawerLogTimer = setInterval(loadDrawerLogs, 3000);
}

function closeWorkerDrawer() {
  document.getElementById('worker-drawer').classList.remove('open');
  if (state.drawerLogTimer) clearInterval(state.drawerLogTimer);
  state.drawerLogTimer = null;
  state.drawerWorkerIndex = null;
  state.drawerTaskId = null;
}

async function loadDrawerLogs() {
  if (!state.drawerTaskId) return;
  try {
    const data = await api(`/api/tasks/${state.drawerTaskId}/logs`);
    const logEl = document.getElementById('drawer-log');
    if (data.logs !== undefined) {
      logEl.innerHTML = `<pre class="log-content">${escHtml(data.logs)}</pre>`;
      logEl.scrollTop = logEl.scrollHeight;
    }
  } catch {
    // ignore
  }
}

async function stopWorkerTask() {
  if (!state.drawerTaskId) return;
  try {
    await api(`/api/tasks/${state.drawerTaskId}/stop`, 'POST');
    toast('Task stopped', 'success');
    loadDrawerLogs();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Projects ────────────────────────────────────────────

// In-memory project storage (until backend persistence)
function getProjects() {
  const stored = localStorage.getItem('rover_projects');
  return stored ? JSON.parse(stored) : [];
}

function saveProjects(projects) {
  localStorage.setItem('rover_projects', JSON.stringify(projects));
  state.projects = projects;
}

function addProject(project) {
  const projects = getProjects();
  project.id = `proj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  project.createdAt = new Date().toISOString();
  project.status = 'loading';
  project.directorTaskId = null;
  project.tasks = [];
  project.repos = [project.baseRepo, ...(project.additionalRepos || [])].filter(Boolean);
  projects.push(project);
  saveProjects(projects);
  return project;
}

function updateProject(id, updates) {
  const projects = getProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx >= 0) {
    projects[idx] = { ...projects[idx], ...updates };
    saveProjects(projects);
    return projects[idx];
  }
  return null;
}

async function loadProjects(silent = false) {
  const projects = getProjects();
  state.projects = projects;

  if (!silent) {
    document.getElementById('projects-grid').innerHTML =
      projects.length === 0
        ? `<div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <div class="empty-state-title">No projects loaded</div>
            <div class="empty-state-desc">Load a project to start Director orchestration.</div>
            <button class="btn btn-primary btn-sm" onclick="openLoadProjectModal()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Load Project
            </button>
          </div>`
        : renderProjectsGrid(projects);
  } else {
    const grid = document.getElementById('projects-grid');
    if (grid && projects.length > 0) {
      grid.innerHTML = renderProjectsGrid(projects);
    }
  }

  document.getElementById('badge-projects').textContent = projects.length;
  document.getElementById('badge-projects').style.display = projects.length > 0 ? '' : 'none';

  setLastRefresh();
}

function renderProjectsGrid(projects) {
  return `<div class="projects-grid">${projects.map(p => `
    <div class="project-card" onclick="openProject('${p.id}')">
      <div class="project-card-header">
        <div class="project-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </div>
        <div class="project-card-status status-${p.status || 'loading'}">${p.status || 'loading'}</div>
      </div>
      <div class="project-card-title">${escHtml(p.name)}</div>
      <div class="project-card-repo">${escHtml(p.baseRepo?.replace('https://github.com/', '') || '—')}</div>
      <div class="project-card-meta">
        <span>${p.repos?.length || 1} repo${(p.repos?.length || 1) !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span>${p.tasks?.length || 0} tasks</span>
      </div>
    </div>
  `).join('')}</div>`;
}

async function openProject(id) {
  state.currentProjectId = id;
  showPage('project-detail');
  await loadProjectDetail(id);
}

async function loadProjectDetail(id, silent = false) {
  const project = getProjects().find(p => p.id === id);
  if (!project) {
    toast('Project not found', 'error');
    showPage('projects');
    return;
  }

  document.getElementById('project-detail-breadcrumb').textContent = project.name;
  document.getElementById('project-detail-title').textContent = project.name;
  document.getElementById('project-detail-subtitle').textContent = project.baseRepo;

  document.getElementById('project-detail-meta').innerHTML = `
    ${metaItem('Status', statusBadge(project.status))}
    ${metaItem('Base Repo', project.baseRepo, true)}
    ${metaItem('Source Branch', project.sourceBranch || 'main')}
    ${metaItem('Director Model', project.model || 'claude-sonnet-4-20250514')}
    ${metaItem('Created', fmt(project.createdAt))}
    ${metaItem('Director Task', project.directorTaskId ? `<code>${project.directorTaskId}</code>` : 'Not dispatched', true)}
  `;

  document.getElementById('project-director-info').innerHTML = project.directorTaskId
    ? `<div style="font-size:0.85rem">
        <div style="margin-bottom:8px"><strong>Director Task:</strong></div>
        <code style="font-size:0.75rem">${project.directorTaskId}</code>
        <div style="margin-top:12px">
          <button class="btn btn-ghost btn-sm" onclick="viewDirectorTask('${project.directorTaskId}')">
            View Director Task
          </button>
        </div>
       </div>`
    : `<div class="text-dim" style="font-size:0.85rem">Director not yet dispatched.</div>`;

  // Load project tasks
  await loadProjectTasks(project);

  // Render repos
  document.getElementById('project-repos-list').innerHTML = `
    <div class="repo-list">
      ${project.repos?.map((repo, i) => `
        <div class="repo-item">
          <div class="repo-item-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
            </svg>
          </div>
          <div class="repo-item-info">
            <div class="repo-item-name">${escHtml(repo.replace('https://github.com/', ''))}</div>
            <div class="repo-item-url">${escHtml(repo)}</div>
          </div>
          <div class="repo-item-type">${i === 0 ? '<span class="badge">Base</span>' : ''}</div>
        </div>
      `).join('') || '<div class="text-dim">No repositories</div>'}
    </div>
  `;

  setLastRefresh();
}

async function loadProjectTasks(project) {
  // Filter tasks that belong to this project's repos
  const allTasks = await api('/api/tasks').catch(() => []);
  const projectTasks = allTasks.filter(t =>
    project.repos?.some(r => t.repo === r || t.repo?.includes(r.replace('https://github.com/', '')))
  );

  project.tasks = projectTasks;
  updateProject(project.id, { tasks: projectTasks });

  const container = document.getElementById('project-tasks-list');
  if (projectTasks.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-title">No tasks yet</div>
      <div class="empty-state-desc">Create a task to start work on this project.</div>
      <button class="btn btn-primary btn-sm" onclick="openCreateTaskModal()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        New Task
      </button>
    </div>`;
  } else {
    container.innerHTML = renderTaskTable(projectTasks);
  }

  // Update worker assignments
  const assignments = state.workers
    .filter(w => w.state === 'busy' && projectTasks.some(t => t.id === w.taskId))
    .map(w => {
      const task = projectTasks.find(t => t.id === w.taskId);
      return { worker: w, task };
    });

  document.getElementById('project-worker-assignments').innerHTML = assignments.length > 0
    ? `<div class="worker-assignments">
        ${assignments.map(a => `
          <div class="worker-assignment">
            <div class="worker-assignment-worker">W${a.worker.index + 1}</div>
            <div class="worker-assignment-task">${escHtml(a.task?.description?.slice(0, 40) || '—')}…</div>
            <div class="worker-assignment-repo">${escHtml(a.task?.repo?.replace('https://github.com/', '') || '—')}</div>
          </div>
        `).join('')}
       </div>`
    : `<div class="text-dim" style="font-size:0.8rem">No workers currently assigned to this project.</div>`;
}

function switchProjectTab(tab) {
  state.currentProjectTab = tab;

  document.querySelectorAll('[id^="tab-project-"]').forEach(btn => {
    btn.classList.remove('active');
  });
  document.getElementById(`tab-project-${tab}`)?.classList.add('active');

  document.querySelectorAll('[id^="tab-panel-project-"]').forEach(panel => {
    panel.classList.add('hidden');
  });
  document.getElementById(`tab-panel-project-${tab}`)?.classList.remove('hidden');
}

function viewDirectorTask(taskId) {
  openTask(taskId);
}

// ── Load Project Modal ─────────────────────────────────

function openLoadProjectModal() {
  document.getElementById('load-project-modal').classList.add('open');
  updateWorkerAvailBanner();
}

function closeLoadProjectModal() {
  document.getElementById('load-project-modal').classList.remove('open');
}

async function loadProject() {
  const name = document.getElementById('project-name').value.trim();
  const baseRepo = document.getElementById('project-base-repo').value.trim();
  const additionalRepos = document.getElementById('project-additional-repos').value
    .split('\n')
    .map(r => r.trim())
    .filter(Boolean);
  const sourceBranch = document.getElementById('project-source-branch').value.trim() || 'main';
  const model = document.getElementById('project-model').value;
  const directorPrompt = document.getElementById('project-director-prompt').value.trim();

  if (!name) {
    toast('Project name is required', 'error');
    return;
  }
  if (!baseRepo) {
    toast('Base repository is required', 'error');
    return;
  }

  const project = addProject({
    name,
    baseRepo,
    additionalRepos,
    sourceBranch,
    model,
    directorPrompt,
  });

  closeLoadProjectModal();
  toast(`Project "${name}" created. Dispatching Director…`, 'success');

  // Dispatch Director task
  try {
    const reposList = [baseRepo, ...additionalRepos].join(', ');
    const result = await api('/api/tasks', 'POST', {
      description: `**DIRECTOR ORCHESTRATION TASK** for project "${name}"

You are the Director for this multi-repository project. Your mission:

1. **Initial Scan**: Clone and analyze all repositories:
   ${reposList}

2. **Discovery**: Find and document:
   - Existing tasks, issues, or TODOs in the codebase
   - Documentation (README, ROADMAP, PLAN, ADR files)
   - Current implementation status
   - Technical architecture and patterns

3. **Analysis**: Create a comprehensive project audit including:
   - Repository structure for each repo
   - Key components and their relationships
   - Work items identified (features, bugs, tech debt)
   - Cross-repository dependencies
   - Recommended task priorities

4. **Coordination Plan**: Document how workers should be assigned:
   - Which repositories need attention
   - Suggested worker-agent assignments
   - Priority order for tasks

5. **Deliverable**: Create ROVER_PROJECT_AUDIT.md in the base repository with all findings.

Project-specific instructions: ${directorPrompt || 'None provided'}

This audit will guide the worker pool dispatch plan.`,
      repo: baseRepo,
      agent: 'claude',
      model: model,
      sourceBranch: sourceBranch,
    });

    if (result.accepted) {
      updateProject(project.id, {
        status: 'audit-running',
        directorTaskId: result.taskId,
      });
      toast(`Director dispatched (Task: ${result.taskId})`, 'success');
      loadProjects();
    }
  } catch (e) {
    toast(`Failed to dispatch Director: ${e.message}`, 'error');
    updateProject(project.id, { status: 'error' });
  }
}

// ── Create Task Modal ──────────────────────────────────

function openCreateTaskModal() {
  const project = getProjects().find(p => p.id === state.currentProjectId);
  if (!project) {
    toast('No project selected', 'error');
    return;
  }

  document.getElementById('task-project-id').value = state.currentProjectId;

  // Populate repo dropdown
  const repoSelect = document.getElementById('task-repo');
  repoSelect.innerHTML = '<option value="">Select repository…</option>' +
    project.repos?.map(r => `<option value="${escHtml(r)}">${escHtml(r.replace('https://github.com/', ''))}</option>`).join('');

  document.getElementById('create-task-modal').classList.add('open');
}

function closeCreateTaskModal() {
  document.getElementById('create-task-modal').classList.remove('open');
}

async function createTask() {
  const projectId = document.getElementById('task-project-id').value;
  const description = document.getElementById('task-description').value.trim();
  const repo = document.getElementById('task-repo').value;
  const agent = document.getElementById('task-agent').value;
  const model = document.getElementById('task-model').value.trim();
  const priority = document.getElementById('task-priority').value;

  if (!description) {
    toast('Task description is required', 'error');
    return;
  }
  if (!repo) {
    toast('Target repository is required', 'error');
    return;
  }

  try {
    const result = await api('/api/tasks', 'POST', {
      description,
      repo,
      agent: agent || undefined,
      model: model || undefined,
      priority,
    });

    if (result.accepted) {
      toast(`Task created and dispatched to ${result.dispatchedTo}`, 'success');
      closeCreateTaskModal();
      if (state.currentPage === 'project-detail') {
        loadProjectDetail(projectId);
      } else {
        loadTasks();
      }
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Director Chat ───────────────────────────────────────

async function loadDirectorPage() {
  // Load active projects for sidebar
  const projects = getProjects();
  const activeProjects = projects.filter(p => p.status !== 'error');

  document.getElementById('director-projects-list').innerHTML = activeProjects.length > 0
    ? activeProjects.map(p => `
        <div class="director-project-item" onclick="openProject('${p.id}')">
          <div class="director-project-name">${escHtml(p.name)}</div>
          <div class="director-project-status status-${p.status}">${p.status}</div>
        </div>
      `).join('')
    : `<div class="text-dim" style="font-size:0.85rem;text-align:center;padding:var(--space-4)">
        No active projects.
       </div>`;

  // Load worker status
  const workerStatus = await loadConstellationStatus(true);
  document.getElementById('director-worker-status').innerHTML = workerStatus
    ? `<div class="worker-status-grid">
        ${workerStatus.workers?.map(w => `
          <div class="worker-status-item ${w.state}">
            <div class="worker-status-id">W${w.index + 1}</div>
            <div class="worker-status-state">${w.state}</div>
            ${w.taskId ? `<div class="worker-status-task">${w.taskId.slice(0, 8)}…</div>` : ''}
          </div>
        `).join('') || '<div class="text-dim">No workers</div>'}
       </div>`
    : `<div class="text-dim">Worker status unavailable</div>`;
}

function sendDirectorMessage() {
  const input = document.getElementById('director-input');
  const message = input.value.trim();
  if (!message) return;

  // Add user message to chat
  addChatMessage('director-chat-messages', 'user', message);
  input.value = '';

  // TODO: Send to backend for Director agent
  // For now, simulate response
  setTimeout(() => {
    addChatMessage('director-chat-messages', 'director',
      `I received your message: "${message}"\n\n` +
      `I'm currently managing ${getProjects().length} project(s). ` +
      `Would you like me to create a new task, check on existing work, or load another project?`
    );
  }, 500);
}

function sendProjectDirectorMessage() {
  const input = document.getElementById('project-director-input');
  const message = input.value.trim();
  if (!message) return;

  addChatMessage('project-director-chat', 'user', message);
  input.value = '';

  // TODO: Send to backend
  setTimeout(() => {
    addChatMessage('project-director-chat', 'director',
      `Project Director: I received your message about this project.\n\n` +
      `I can help coordinate work across the ${getProjects().find(p => p.id === state.currentProjectId)?.repos?.length || 1} repositories. ` +
      `What would you like me to do?`
    );
  }, 500);
}

function addChatMessage(containerId, role, message) {
  const container = document.getElementById(containerId);
  const messageEl = document.createElement('div');
  messageEl.className = `chat-message ${role}`;
  messageEl.innerHTML = `
    <div class="chat-avatar">${role === 'director' ? 'D' : 'U'}</div>
    <div class="chat-content">
      <div class="chat-header">${role === 'director' ? 'Director' : 'You'}</div>
      <div class="chat-body">${escHtml(message).replace(/\n/g, '<br>')}</div>
    </div>
  `;
  container.appendChild(messageEl);
  container.scrollTop = container.scrollHeight;
}

// ── Workers Page ────────────────────────────────────────

async function loadWorkersPage() {
  const data = await loadConstellationStatus();

  document.getElementById('workers-list').innerHTML = data && data.workers
    ? `<div class="workers-table-wrap">
        <table class="task-table">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Status</th>
              <th>Agent</th>
              <th>Current Task</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${data.workers.map(w => `
              <tr>
                <td><strong>W${w.index + 1}</strong></td>
                <td>${statusBadge(w.state.toUpperCase())}</td>
                <td>${escHtml(w.agent || '—')}</td>
                <td>${w.taskId ? `<code>${escHtml(w.taskId)}</code>` : '—'}</td>
                <td>
                  ${w.state === 'busy' && w.taskId
                    ? `<button class="btn btn-ghost btn-sm" onclick="openWorkerDrawer(${w.index}, '${w.taskId}')">View Logs</button>`
                    : '—'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
       </div>`
    : `<div class="empty-state">
        <div class="empty-state-title">No workers configured</div>
        <div class="empty-state-desc">Worker pool is not available.</div>
       </div>`;

  document.getElementById('badge-workers').textContent = data?.total || 0;
}

// ── Tasks Page ───────────────────────────────────────────

async function loadTasks(silent = false) {
  if (!silent) {
    document.getElementById('task-list-body').innerHTML =
      `<div class="loading-state"><div class="spinner"></div> Loading tasks…</div>`;
  }
  try {
    const tasks = await api('/api/tasks');
    state.tasks = Array.isArray(tasks) ? tasks.map(normalizeTask) : [];

    const container = document.getElementById('task-list-body');
    container.innerHTML = renderTaskTable(state.tasks);

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

function renderTaskTable(tasks) {
  if (tasks.length === 0) {
    return `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
      </svg>
      <div class="empty-state-title">No tasks found</div>
      <div class="empty-state-desc">Create a new task to get started.</div>
      <button class="btn btn-primary btn-sm" onclick="openLoadProjectModal()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Load Project
      </button>
    </div>`;
  }

  const sorted = [...tasks].sort((a, b) => {
    const running = s => (['IN_PROGRESS', 'ITERATING'].includes(s) ? 1 : 0);
    if (running(b.status) !== running(a.status))
      return running(b.status) - running(a.status);
    return b.id - a.id;
  });

  return `<div class="task-table-wrap">
    <table class="task-table">
      <thead>
        <tr>
          <th>ID</th><th>Title</th><th>Repository</th><th>Agent</th><th>Status</th>
          <th>Progress</th><th>Duration</th><th></th>
        </tr>
      </thead>
      <tbody id="task-tbody">
        ${sorted.map(t => {
          const iterData = t.iterationsData?.[t.iterationsData.length - 1];
          const iterStatus = iterData?.status ? iterData.status() : null;
          let pct = iterStatus?.progress ?? 0;
          const endTime = t.completedAt || t.failedAt;
          const duration = fmtDuration(t.startedAt, endTime);
          let agentDisplay = t.agent || '—';
          if (t.agent && t.model) agentDisplay = `${t.agent}:${t.model.slice(0, 10)}`;

          return `<tr onclick="openTask('${t.id}')" title="Open task ${t.id}">
            <td><span class="task-id">#${t.id.slice(0, 8)}</span></td>
            <td><span class="task-title">${escHtml(t.title || t.description?.slice(0, 60) || 'Untitled')}</span></td>
            <td><span class="task-repo" title="${escHtml(t.repo || '')}">${escHtml(t.repo?.replace('https://github.com/', '').slice(0, 30) || '—')}</span></td>
            <td><span class="task-agent">${escHtml(agentDisplay)}</span></td>
            <td>${statusBadge(t.status)}</td>
            <td>${progressBar(pct, t.status)}</td>
            <td style="font-size:0.78rem;color:var(--text-3);white-space:nowrap">${duration}</td>
            <td>
              <div style="display:flex;gap:4px;opacity:0;transition:opacity 0.15s" class="row-actions">
                ${actionButtons(t)}
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

function updateStats(tasks) {
  const total = tasks.length;
  const running = tasks.filter(t =>
    ['IN_PROGRESS', 'ITERATING'].includes(t.status)
  ).length;
  const done = tasks.filter(t =>
    ['COMPLETED', 'MERGED', 'PUSHED'].includes(t.status)
  ).length;
  const failed = tasks.filter(t => t.status === 'FAILED').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-running').textContent = running;
  document.getElementById('stat-done').textContent = done;
  document.getElementById('stat-failed').textContent = failed;

  const badge = document.getElementById('badge-tasks');
  badge.textContent = total;
  badge.style.display = total > 0 ? '' : 'none';
}

function actionButtons(t) {
  const isRunning = ['IN_PROGRESS', 'ITERATING'].includes(t.status);
  const isDone = ['COMPLETED', 'MERGED', 'PUSHED', 'FAILED'].includes(t.status);
  let btns = '';
  if (isRunning) {
    btns += `<button class="btn btn-ghost btn-sm btn-icon" title="Stop" onclick="event.stopPropagation();stopTask('${t.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg>
    </button>`;
  }
  if (isDone && t.status !== 'MERGED') {
    btns += `<button class="btn btn-ghost btn-sm btn-icon" title="Merge" onclick="event.stopPropagation();mergeTask('${t.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>
    </button>`;
  }
  if (t.status === 'FAILED' || t.status === 'NEW') {
    btns += `<button class="btn btn-ghost btn-sm btn-icon" title="Restart" onclick="event.stopPropagation();restartTask('${t.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.26"/></svg>
    </button>`;
  }
  btns += `<button class="btn btn-danger btn-sm btn-icon" title="Delete" onclick="event.stopPropagation();deleteTask('${t.id}')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
  </button>`;
  return btns;
}

// ── Task Detail Page ────────────────────────────────────

async function openTask(id) {
  state.currentTaskId = id;
  showPage('detail');
  switchTab('overview');
  document.getElementById('detail-breadcrumb').textContent = `Task #${id.slice(0, 8)}`;
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
    const t = await api(`/api/tasks/${id}`);
    state.currentTask = normalizeTask(t);

    document.getElementById('detail-breadcrumb').textContent = `Task #${id.slice(0, 8)}`;
    document.getElementById('detail-title').textContent =
      t.title || t.description?.slice(0, 60) || 'Untitled Task';
    document.getElementById('detail-subtitle').textContent =
      `Created ${fmt(t.createdAt)} · ${t.repo || '—'}`;

    const isRunning = ['IN_PROGRESS', 'ITERATING'].includes(t.status);
    const isDone = ['COMPLETED', 'MERGED', 'PUSHED', 'FAILED'].includes(t.status);

    document.getElementById('detail-actions').innerHTML = `
      ${isRunning
        ? `<button class="btn btn-danger" onclick="stopTask('${id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="6" y="6" width="12" height="12"/></svg> Stop</button>`
        : ''}
      ${isDone && t.status !== 'MERGED'
        ? `<button class="btn btn-primary" onclick="mergeTask('${id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg> Merge</button>`
        : ''}
      ${t.status === 'FAILED' || t.status === 'NEW'
        ? `<button class="btn btn-ghost" onclick="restartTask('${id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.26"/></svg> Restart</button>`
        : ''}
      <button class="btn btn-ghost" onclick="deleteTask('${id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg> Delete</button>
    `;

    document.getElementById('detail-meta').innerHTML = `
      ${metaItem('ID', `<code>${t.id}</code>`, true)}
      ${metaItem('Status', statusBadge(t.status))}
      ${metaItem('Agent', t.agent || '—')}
      ${metaItem('Model', t.model || '—')}
      ${metaItem('Repository', t.repo || '—', true)}
      ${metaItem('Branch', t.branch || '—')}
      ${metaItem('Worktree', t.worktreeBranch || '—', true)}
      ${metaItem('Started', fmt(t.startedAt))}
      ${metaItem('Completed', fmt(t.completedAt))}
    `;

    document.getElementById('detail-description').textContent = t.description || '—';

    setLastRefresh();
  } catch (e) {
    if (!silent) toast(e.message, 'error');
  }
}

function switchTab(tab) {
  state.currentTab = tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.getElementById(`tab-${tab}`)?.classList.add('active');

  document.querySelectorAll('[id^="tab-panel-"]').forEach(panel => {
    panel.classList.add('hidden');
  });
  document.getElementById(`tab-panel-${tab}`)?.classList.remove('hidden');

  if (tab === 'logs') loadLogs();
  if (tab === 'diff') loadDiff();
  if (tab === 'conversation') loadTaskConversation();
}

async function loadLogs() {
  if (!state.currentTaskId) return;
  const viewer = document.getElementById('log-viewer');
  viewer.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
  try {
    const data = await api(`/api/tasks/${state.currentTaskId}/logs`);
    viewer.innerHTML = `<pre class="log-content">${escHtml(data.logs || 'No logs yet.')}</pre>`;
  } catch (e) {
    viewer.innerHTML = `<div class="empty-state" style="padding:var(--space-6)">${escHtml(e.message)}</div>`;
  }
}

async function loadDiff() {
  if (!state.currentTaskId) return;
  const viewer = document.getElementById('diff-viewer');
  viewer.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
  try {
    const data = await api(`/api/tasks/${state.currentTaskId}/diff`);
    const diffText = data.diff || '';
    const files = data.files || [];

    document.getElementById('diff-stats').textContent =
      files.length > 0 ? `${files.length} file${files.length !== 1 ? 's' : ''} changed` : '';

    if (!diffText) {
      viewer.innerHTML = `<div class="empty-state" style="padding:var(--space-6)">No changes yet.</div>`;
      return;
    }

    const html = diffText.split('\n').map(line => {
      const cls = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'meta' : '';
      return `<div class="diff-line ${cls}">${escHtml(line)}</div>`;
    }).join('');

    viewer.innerHTML = html;
  } catch (e) {
    viewer.innerHTML = `<div class="empty-state" style="padding:var(--space-6)">${escHtml(e.message)}</div>`;
  }
}

// ── Conversation Continuation ───────────────────────────

function continueTaskConversation() {
  document.getElementById('conversation-modal').classList.add('open');
  loadTaskConversation();
}

function closeConversationModal() {
  document.getElementById('conversation-modal').classList.remove('open');
}

async function loadTaskConversation() {
  const container = document.getElementById('conversation-messages');
  const task = state.currentTask;

  if (!task) {
    container.innerHTML = `<div class="text-dim" style="text-align:center;padding:var(--space-8)">No task selected</div>`;
    return;
  }

  // Load conversation history from task logs
  try {
    const logs = await api(`/api/tasks/${task.id}/logs`);
    container.innerHTML = `
      <div class="chat-message system">
        <div class="chat-avatar">S</div>
        <div class="chat-content">
          <div class="chat-header">System</div>
          <div class="chat-body">
            Continuing conversation for task <code>${task.id.slice(0, 8)}</code>.<br>
            Agent: ${task.agent || '—'}<br>
            Repository: ${task.repo?.replace('https://github.com/', '') || '—'}
          </div>
        </div>
      </div>
      <div class="chat-message director">
        <div class="chat-avatar">D</div>
        <div class="chat-content">
          <div class="chat-header">Task Context</div>
          <div class="chat-body">
            Original task: ${task.description?.slice(0, 200) || '—'}…
          </div>
        </div>
      </div>
      <div class="chat-message system">
        <div class="chat-avatar">📋</div>
        <div class="chat-content">
          <div class="chat-header">Execution Logs</div>
          <div class="chat-body" style="font-family:monospace;font-size:0.8rem;white-space:pre-wrap;background:rgba(0,0,0,0.2);padding:12px;border-radius:6px;max-height:200px;overflow-y:auto">
            ${escHtml(logs.logs?.slice(-2000) || 'No logs available')}
          </div>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="text-dim" style="text-align:center;padding:var(--space-8)">Error loading conversation: ${e.message}</div>`;
  }
}

function sendConversationMessage() {
  const input = document.getElementById('conversation-input');
  const message = input.value.trim();
  if (!message) return;

  const container = document.getElementById('conversation-messages');

  // Add user message
  const userMsg = document.createElement('div');
  userMsg.className = 'chat-message user';
  userMsg.innerHTML = `
    <div class="chat-avatar">U</div>
    <div class="chat-content">
      <div class="chat-header">You</div>
      <div class="chat-body">${escHtml(message)}</div>
    </div>
  `;
  container.appendChild(userMsg);
  input.value = '';
  container.scrollTop = container.scrollHeight;

  // TODO: Send to backend for agent continuation
  setTimeout(() => {
    const agentMsg = document.createElement('div');
    agentMsg.className = 'chat-message agent';
    agentMsg.innerHTML = `
      <div class="chat-avatar">A</div>
      <div class="chat-content">
        <div class="chat-header">Agent (${state.currentTask?.agent || '—'})</div>
        <div class="chat-body">
          I received your follow-up message. To continue working on this task, I would need to be restarted with additional instructions. Please use the "Restart" button and include your new requirements in the task description.
        </div>
      </div>
    `;
    container.appendChild(agentMsg);
    container.scrollTop = container.scrollHeight;
  }, 500);
}

function sendTaskConversationMessage() {
  const input = document.getElementById('task-conversation-input');
  const message = input.value.trim();
  if (!message) return;

  addChatMessage('task-conversation-messages', 'user', message);
  input.value = '';

  setTimeout(() => {
    addChatMessage('task-conversation-messages', 'agent',
      `I'm the task agent. To implement your request: "${message.slice(0, 50)}...", ` +
      `I would need to continue working on this task. Please restart the task with additional instructions.`
    );
  }, 500);
}

// ── Task Actions ────────────────────────────────────────

async function stopTask(id) {
  try {
    await api(`/api/tasks/${id}/stop`, 'POST');
    toast('Task stopped', 'success');
    refreshCurrentPage();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function mergeTask(id) {
  try {
    await api(`/api/tasks/${id}/merge`, 'POST');
    toast('Task merged', 'success');
    refreshCurrentPage();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function restartTask(id) {
  try {
    await api(`/api/tasks/${id}/restart`, 'POST');
    toast('Task restarted', 'success');
    refreshCurrentPage();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteTask(id) {
  if (!confirm('Delete this task? This cannot be undone.')) return;
  try {
    await api(`/api/tasks/${id}/delete`, 'POST');
    toast('Task deleted', 'success');
    if (state.currentPage === 'detail') showPage('tasks');
    else refreshCurrentPage();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Info Page ───────────────────────────────────────────

async function loadInfo() {
  const el = document.getElementById('info-body');
  try {
    const info = await api('/api/info');
    el.innerHTML = `<pre class="json-view">${escHtml(JSON.stringify(info, null, 2))}</pre>`;
  } catch (e) {
    el.innerHTML = `<div class="empty-state">${escHtml(e.message)}</div>`;
  }
}

// ── Worker availability banner ─────────────────────────

async function updateWorkerAvailBanner() {
  const banner = document.getElementById('worker-avail-banner');
  if (!banner) return;

  try {
    const data = await api('/api/constellation/status');
    if (!data || !data.total) {
      banner.style.display = 'flex';
      banner.className = 'worker-avail-banner avail-none';
      banner.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>No worker pool configured — task will run via local CLI.`;
      return;
    }
    if (data.idle > 0) {
      banner.style.display = 'flex';
      banner.className = 'worker-avail-banner avail-ok';
      banner.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>${data.idle} worker${data.idle !== 1 ? 's' : ''} idle and ready.`;
    } else {
      banner.style.display = 'flex';
      banner.className = 'worker-avail-banner avail-busy';
      banner.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>All ${data.total} workers busy — task will queue or may fail.`;
    }
  } catch {
    banner.style.display = 'none';
  }
}

// ── Data Normalization ─────────────────────────────────

function normalizeTask(t) {
  return {
    id: t.id || t.taskId || '—',
    title: t.title || null,
    description: t.description || t.prompt || '',
    status: t.status || 'NEW',
    agent: t.agent || '—',
    model: t.model || null,
    repo: t.repo || null,
    branch: t.branch || t.baseBranch || null,
    worktreeBranch: t.worktreeBranch || null,
    startedAt: t.startedAt || null,
    completedAt: t.completedAt || null,
    failedAt: t.failedAt || null,
    iterationsData: t.iterationsData || [],
    workerId: t.workerId || null,
    workerIndex: t.workerIndex || null,
  };
}

// ── Login ───────────────────────────────────────────────

function showLoginModal(errorMsg = null) {
  document.getElementById('login-modal').classList.add('open');
  const errEl = document.getElementById('login-error');
  if (errorMsg) {
    errEl.textContent = errorMsg;
    errEl.style.display = '';
  } else {
    errEl.style.display = 'none';
  }
}

function hideLoginModal() {
  document.getElementById('login-modal').classList.remove('open');
}

async function submitLogin() {
  const token = document.getElementById('login-token').value.trim();
  if (!token) return;

  setToken(token);
  hideLoginModal();

  try {
    await api('/api/health');
    init();
  } catch (e) {
    clearToken();
    showLoginModal('Invalid token');
  }
}

function logout() {
  clearToken();
  location.reload();
}

// ── Init ────────────────────────────────────────────────

async function init() {
  try {
    const health = await api('/api/health');

    if (health.authRequired && !getToken()) {
      showLoginModal();
      return;
    }

    document.getElementById('btn-logout').style.display = '';

    if (health.roverCli) {
      const v = health.roverCli.version || 'not available';
      document.getElementById('sidebar-version').textContent = `Rover ${v}`;
    }

    // Show projects page by default
    showPage('projects');
    startAutoRefresh();
    startConstellationPolling();

  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    toast(`Failed to initialize: ${e.message}`, 'error');
  }
}

// ── Event Listeners ─────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Close modals on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLoadProjectModal();
      closeCreateTaskModal();
      closeConversationModal();
      closeWorkerDrawer();
    }
  });

  // Row action hover effects
  document.addEventListener('mouseenter', (e) => {
    const tr = e.target.closest('tbody tr');
    if (tr) {
      const actions = tr.querySelector('.row-actions');
      if (actions) actions.style.opacity = '1';
    }
  }, true);

  document.addEventListener('mouseleave', (e) => {
    const tr = e.target.closest('tbody tr');
    if (tr) {
      const actions = tr.querySelector('.row-actions');
      if (actions) actions.style.opacity = '0';
    }
  }, true);

  init();
});
