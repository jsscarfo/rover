export class TaskDetailPanel {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.task = null;
  }

  render(task) {
    this.task = task;
    this.container.innerHTML = '';
    
    if (!task) {
      this.container.innerHTML = '<div class="empty-state">Select a task to view details.</div>';
      return;
    }

    const panel = document.createElement('div');
    panel.className = 'task-detail-panel';
    
    // Header
    const header = document.createElement('div');
    header.className = 'task-detail-header';
    
    const title = document.createElement('h2');
    title.textContent = task.title || task.id;
    header.appendChild(title);
    
    const meta = document.createElement('div');
    meta.className = 'task-detail-meta';
    
    if (task.phase) {
      const phase = document.createElement('span');
      phase.className = `badge phase-${task.phase}`;
      phase.textContent = `Phase: ${task.phase}`;
      meta.appendChild(phase);
    }
    
    if (task.status) {
      const status = document.createElement('span');
      status.className = `badge status-${task.status}`;
      status.textContent = `Status: ${task.status}`;
      meta.appendChild(status);
    }
    
    if (task.worker) {
      const worker = document.createElement('span');
      worker.className = 'badge worker';
      worker.textContent = `Worker: ${task.worker}`;
      meta.appendChild(worker);
    }
    
    header.appendChild(meta);
    panel.appendChild(header);
    
    // Description
    if (task.description) {
      const desc = document.createElement('div');
      desc.className = 'task-detail-section';
      desc.innerHTML = `<h3>Description</h3><p>${task.description}</p>`;
      panel.appendChild(desc);
    }
    
    // Phase History
    if (task.phases) {
      const history = document.createElement('div');
      history.className = 'task-detail-section';
      history.innerHTML = '<h3>Phase History</h3>';
      
      const list = document.createElement('ul');
      list.className = 'phase-history-list';
      
      for (const [phaseName, phaseData] of Object.entries(task.phases)) {
        const item = document.createElement('li');
        item.className = `phase-history-item status-${phaseData.status}`;
        
        let content = `<strong>${phaseName}</strong>: ${phaseData.status}`;
        if (phaseData.summary) {
          content += `<br><span class="phase-summary">${phaseData.summary}</span>`;
        }
        if (phaseData.tokens) {
          content += `<br><span class="phase-tokens">Tokens: ${phaseData.tokens}</span>`;
        }
        
        item.innerHTML = content;
        list.appendChild(item);
      }
      
      history.appendChild(list);
      panel.appendChild(history);
    }
    
    // Deliverables
    if (task.deliverables && task.deliverables.length > 0) {
      const deliverables = document.createElement('div');
      deliverables.className = 'task-detail-section';
      deliverables.innerHTML = '<h3>Deliverables</h3>';
      
      const list = document.createElement('ul');
      task.deliverables.forEach(d => {
        const item = document.createElement('li');
        item.textContent = d;
        list.appendChild(item);
      });
      
      deliverables.appendChild(list);
      panel.appendChild(deliverables);
    }
    
    this.container.appendChild(panel);
  }
}
