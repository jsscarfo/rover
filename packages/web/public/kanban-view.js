export class KanbanView {
  constructor(containerId, onTaskSelect) {
    this.container = document.getElementById(containerId);
    this.onTaskSelect = onTaskSelect;
    this.wbs = null;
    this.columns = ['backlog', 'planning', 'design', 'implement', 'test', 'deploy'];
  }

  render(wbs) {
    this.wbs = wbs;
    this.container.innerHTML = '';
    
    if (!wbs || !wbs.modules || wbs.modules.length === 0) {
      this.container.innerHTML = '<div class="empty-state">No tasks found in WBS.</div>';
      return;
    }

    const board = document.createElement('div');
    board.className = 'kanban-board';
    
    // Create columns
    const columnEls = {};
    this.columns.forEach(col => {
      const colEl = document.createElement('div');
      colEl.className = 'kanban-column';
      
      const header = document.createElement('div');
      header.className = 'kanban-column-header';
      header.textContent = col.toUpperCase();
      colEl.appendChild(header);
      
      const content = document.createElement('div');
      content.className = 'kanban-column-content';
      content.id = `kanban-col-${col}`;
      colEl.appendChild(content);
      
      board.appendChild(colEl);
      columnEls[col] = content;
    });
    
    // Populate tasks
    const populateTasks = (modules) => {
      modules.forEach(task => {
        const phase = task.phase || 'backlog';
        const col = columnEls[phase] || columnEls['backlog'];
        
        const card = this.createCard(task);
        col.appendChild(card);
        
        if (task.subtasks) {
          populateTasks(task.subtasks);
        }
      });
    };
    
    populateTasks(wbs.modules);
    
    this.container.appendChild(board);
  }

  createCard(task) {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    
    const title = document.createElement('div');
    title.className = 'kanban-card-title';
    title.textContent = task.title || task.id;
    card.appendChild(title);
    
    const meta = document.createElement('div');
    meta.className = 'kanban-card-meta';
    
    if (task.worker) {
      const worker = document.createElement('span');
      worker.className = 'kanban-worker';
      worker.textContent = task.worker;
      meta.appendChild(worker);
    }
    
    if (task.status) {
      const status = document.createElement('span');
      status.className = `kanban-status status-${task.status}`;
      status.textContent = task.status;
      meta.appendChild(status);
    }
    
    card.appendChild(meta);
    
    card.onclick = () => {
      document.querySelectorAll('.kanban-card').forEach(el => el.classList.remove('selected'));
      card.classList.add('selected');
      
      if (this.onTaskSelect) {
        this.onTaskSelect(task);
      }
    };
    
    return card;
  }
}
