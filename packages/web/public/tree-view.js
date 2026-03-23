export class TreeView {
  constructor(containerId, onTaskSelect) {
    this.container = document.getElementById(containerId);
    this.onTaskSelect = onTaskSelect;
    this.wbs = null;
  }

  render(wbs) {
    this.wbs = wbs;
    this.container.innerHTML = '';
    
    if (!wbs || !wbs.modules || wbs.modules.length === 0) {
      this.container.innerHTML = '<div class="empty-state">No tasks found in WBS.</div>';
      return;
    }

    const treeRoot = document.createElement('div');
    treeRoot.className = 'tree-root';
    
    wbs.modules.forEach(mod => {
      treeRoot.appendChild(this.createNode(mod, 0));
    });
    
    this.container.appendChild(treeRoot);
  }

  createNode(task, level) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.style.paddingLeft = `${level * 20}px`;
    
    const header = document.createElement('div');
    header.className = 'tree-node-header';
    
    // Expand/Collapse icon
    const expandIcon = document.createElement('span');
    expandIcon.className = 'tree-expand-icon';
    if (task.subtasks && task.subtasks.length > 0) {
      expandIcon.innerHTML = '▾';
      expandIcon.onclick = (e) => {
        e.stopPropagation();
        const children = node.querySelector('.tree-children');
        if (children) {
          const isHidden = children.style.display === 'none';
          children.style.display = isHidden ? 'block' : 'none';
          expandIcon.innerHTML = isHidden ? '▾' : '▸';
        }
      };
    } else {
      expandIcon.innerHTML = '•';
      expandIcon.style.visibility = 'hidden';
    }
    header.appendChild(expandIcon);
    
    // Title
    const title = document.createElement('span');
    title.className = 'tree-title';
    title.textContent = task.title || task.id;
    header.appendChild(title);
    
    // Phase badge
    if (task.phase) {
      const phaseBadge = document.createElement('span');
      phaseBadge.className = `badge phase-${task.phase}`;
      phaseBadge.textContent = task.phase;
      header.appendChild(phaseBadge);
    }
    
    // Status icon
    const statusIcon = document.createElement('span');
    statusIcon.className = 'tree-status-icon';
    if (task.status === 'completed') statusIcon.innerHTML = '✅';
    else if (task.status === 'in-progress') statusIcon.innerHTML = '🔄';
    else statusIcon.innerHTML = '⏳';
    header.appendChild(statusIcon);
    
    // Progress
    if (task.progress !== undefined) {
      const progress = document.createElement('span');
      progress.className = 'tree-progress';
      progress.textContent = `[${task.progress}%]`;
      header.appendChild(progress);
    }
    
    header.onclick = () => {
      // Highlight selected
      document.querySelectorAll('.tree-node-header').forEach(el => el.classList.remove('selected'));
      header.classList.add('selected');
      
      if (this.onTaskSelect) {
        this.onTaskSelect(task);
      }
    };
    
    node.appendChild(header);
    
    // Children
    if (task.subtasks && task.subtasks.length > 0) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'tree-children';
      task.subtasks.forEach(subtask => {
        childrenContainer.appendChild(this.createNode(subtask, level + 1));
      });
      node.appendChild(childrenContainer);
    }
    
    return node;
  }
}
