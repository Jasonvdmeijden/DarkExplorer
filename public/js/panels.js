/* Panel layout — left/right/bottom toggle, drag-resize splitters, split pane */
const Panels = (() => {
  const layout      = document.getElementById('layout');
  const panelLeft   = document.getElementById('panel-left');
  const panelRight  = document.getElementById('panel-right');
  const panelBottom = document.getElementById('panel-bottom');
  const splLeft     = document.getElementById('splitter-left');
  const splRight    = document.getElementById('splitter-right');
  const splBottom   = document.getElementById('splitter-bottom');
  const panesEl     = document.getElementById('panes');

  // New elements for split side panel
  const leftTabsTop = document.getElementById('left-tabs-top');
  const leftTabsBottom = document.getElementById('left-tabs-bottom');
  const panelBottomLeft = document.getElementById('panel-left-bottom');
  const splSideV = document.getElementById('splitter-side-v');

  let leftVisible   = !window.matchMedia('(max-width: 768px)').matches;
  let rightVisible  = false;
  let bottomVisible = false;
  let extraPanes    = []; // [{ pane, splitter }] — up to 2 extras (3 total)

  // Mobile drawer backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'layout-backdrop';
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', () => {
    panelLeft.classList.remove('mobile-open');
    backdrop.classList.remove('visible');
    leftVisible = false;
  });

  function showRight()  { panelRight.style.display = ''; splRight.style.display = ''; rightVisible = true; }
  function hideRight()  { panelRight.style.display = 'none'; splRight.style.display = 'none'; rightVisible = false; }
  function toggleRight(){ rightVisible ? hideRight() : showRight(); }

  function showBottom() { panelBottom.style.display = ''; splBottom.style.display = ''; bottomVisible = true; }
  function hideBottom() { panelBottom.style.display = 'none'; splBottom.style.display = 'none'; bottomVisible = false; }
  function toggleBottom(){ bottomVisible ? hideBottom() : showBottom(); }

  function toggleLeft() {
    if (window.matchMedia('(max-width: 768px)').matches) {
      leftVisible = !leftVisible;
      panelLeft.classList.toggle('mobile-open', leftVisible);
      backdrop.classList.toggle('visible', leftVisible);
    } else {
      leftVisible = !leftVisible;
      panelLeft.style.display = leftVisible ? '' : 'none';
      splLeft.style.display   = leftVisible ? '' : 'none';
    }
  }

  // drag resize; optional onDragEnd(target) callback
  function makeDraggable(splitter, target, axis, onDragEnd) {
    let start, startSize;
    splitter.addEventListener('mousedown', (e) => {
      start = axis === 'v' ? e.clientX : e.clientY;
      startSize = axis === 'v' ? target.offsetWidth : target.offsetHeight;
      splitter.classList.add('dragging');

      const onMove = (ev) => {
        const delta = (axis === 'v' ? ev.clientX : ev.clientY) - start;
        const sign  = (splitter === splRight || splitter === splBottom || splitter === splSideV) ? -1 : 1;
        const size  = Math.max(100, Math.min(800, startSize + sign * delta));
        if (axis === 'v') target.style.width  = size + 'px';
        else              target.style.height = size + 'px';
      };
      const onUp = () => {
        splitter.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (onDragEnd) onDragEnd(target);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  makeDraggable(splLeft,   panelLeft,   'v', () => State.set('panelLeftW', panelLeft.offsetWidth));
  makeDraggable(splRight,  panelRight,  'v');
  makeDraggable(splBottom, panelBottom, 'h');
  makeDraggable(splSideV,  panelBottomLeft, 'h');

  function saveSplitState() {
    State.set('splitPanes', extraPanes.map(ep => ep.pane._explorer?.currentPath || null));
  }

  function addPane(initialPath = null) {
    if (extraPanes.length >= 2) return;
    const n   = extraPanes.length + 2;
    const pane = document.createElement('div');
    pane.className = 'pane';
    pane.id = `pane-${n}`;
    const spl = document.createElement('div');
    spl.className = 'splitter splitter-v';
    spl.id = `splitter-pane-${n}`;
    panesEl.appendChild(spl);
    panesEl.appendChild(pane);
    makeDraggable(spl, pane, 'v');
    Explorer.renderInPane(pane, initialPath);
    extraPanes.push({ pane, splitter: spl });
    saveSplitState();
  }

  function removePane(pane) {
    const idx = extraPanes.findIndex(ep => ep.pane === pane);
    if (idx === -1) return;
    const { splitter } = extraPanes[idx];
    pane.remove();
    splitter.remove();
    extraPanes.splice(idx, 1);
    Explorer.setFocusToPrimary();
    saveSplitState();
  }

  // Restore panel width and split panes from saved state
  function restore() {
    const w = State.get('panelLeftW', null);
    if (w) panelLeft.style.width = w + 'px';

    const splitPaths = State.get('splitPanes', []);
    splitPaths.forEach(p => addPane(p));
  }

  document.getElementById('btn-toggle-tree').addEventListener('click', toggleLeft);
  
  document.getElementById('btn-split').addEventListener('click', () => {
    if (extraPanes.length < 2) addPane();
    else removePane(extraPanes[extraPanes.length - 1].pane);
  });

  // panel tab switching (left panel)
  function initTabListeners(container) {
    container.querySelectorAll('.ptab').forEach(btn => {
      btn.addEventListener('click', () => {
        const panelId = btn.dataset.panel;
        if (!panelId) return;
        
        const isBottom = !!btn.closest('#left-tabs-bottom');
        
        // Deactivate other tabs in the SAME section container
        container.querySelectorAll('.ptab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const target = document.getElementById(panelId + '-panel');
        if (target) {
          // Hide all panels in the relevant section
          const parentSection = isBottom ? document.getElementById('panel-left-bottom') : document.getElementById('panel-left-top');
          parentSection.querySelectorAll('.panel-content, .panel-content-bottom > div').forEach(p => p.style.display = 'none');
          
          // Show the selected one
          target.style.display = panelId === 'bookmarks' ? 'flex' : 'block';
          
          // Move the panel to the correct content area if it's not there
          if (isBottom) {
            const bottomContent = document.querySelector('.panel-content-bottom');
            if (target.parentElement !== bottomContent) {
              bottomContent.appendChild(target);
            }
          } else {
            const topSection = document.getElementById('panel-left-top');
            if (target.parentElement !== topSection) {
              topSection.appendChild(target);
            }
          }
          
          if (panelId === 'git') Git.activate();
          if (panelId === 'favourites') Favourites.render();
        }
      });

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showTabContextMenu(e.clientX, e.clientY, btn);
      });

      // Enable dragging for reordering and splitting
      btn.setAttribute('draggable', 'true');
      btn.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', btn.dataset.panel);
        btn.classList.add('dragging');
        // Show drop zone when dragging starts
        document.getElementById('side-split-dropzone').style.display = 'flex';
      });
      btn.addEventListener('dragend', () => {
        btn.classList.remove('dragging');
        // Hide drop zone when dragging ends
        document.getElementById('side-split-dropzone').style.display = 'none';
        document.getElementById('side-split-dropzone').classList.remove('active');
      });
    });
  }

  function initDragArea(container) {
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = document.querySelector('.ptab.dragging');
      if (!dragging) return;
      
      const afterElement = getDragAfterElement(container, e.clientX);
      if (afterElement == null) {
        container.appendChild(dragging);
      } else {
        container.insertBefore(dragging, afterElement);
      }
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      const panelId = e.dataTransfer.getData('text/plain');
      const droppedTab = document.querySelector(`.ptab[data-panel="${panelId}"]`);
      
      const isToBottom = container.id === 'left-tabs-bottom';
      
      if (isToBottom) {
        panelBottomLeft.style.display = 'flex';
        splSideV.style.display = 'block';
      } else {
        if (leftTabsBottom.children.length === 0) {
          panelBottomLeft.style.display = 'none';
          splSideV.style.display = 'none';
          document.getElementById('panel-left-top').style.flex = '1';
          document.getElementById('panel-left-top').style.height = '';
        }
      }
      
      if (droppedTab) droppedTab.click();
      
      // Equalize heights on initial split
      if (isToBottom && panelBottomLeft.style.display === 'flex') {
        equalizeHeights();
      }
    });
  }

  const dropZone = document.getElementById('side-split-dropzone');
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('active');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('active');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const panelId = e.dataTransfer.getData('text/plain');
    const tab = document.querySelector(`.ptab[data-panel="${panelId}"]`);
    if (tab) {
      leftTabsBottom.appendChild(tab);
      panelBottomLeft.style.display = 'flex';
      splSideV.style.display = 'block';
      equalizeHeights();
      tab.click();
    }
    dropZone.classList.remove('active');
    dropZone.style.display = 'none';
  });

  function equalizeHeights() {
    const parentH = panelLeft.offsetHeight;
    const topH = (parentH / 2) - 10;
    document.getElementById('panel-left-top').style.flex = 'none';
    document.getElementById('panel-left-top').style.height = topH + 'px';
    panelBottomLeft.style.flex = 'none';
    panelBottomLeft.style.height = topH + 'px';
  }

  function showTabContextMenu(x, y, btn) {
    const isBottom = !!btn.closest('#left-tabs-bottom');
    const menu = document.getElementById('context-menu');
    menu.innerHTML = `<li class="ctx-item">Split</li>`;
    const splitBtn = menu.querySelector('li');
    
    splitBtn.addEventListener('click', () => {
      const panelId = btn.dataset.panel;
      const targetContainer = isBottom ? leftTabsTop : leftTabsBottom;
      
      // Move tab
      targetContainer.appendChild(btn);
      
      // Toggle containers
      if (!isBottom) {
        panelBottomLeft.style.display = 'flex';
        splSideV.style.display = 'block';
        equalizeHeights();
      } else if (leftTabsBottom.children.length === 0) {
        panelBottomLeft.style.display = 'none';
        splSideV.style.display = 'none';
        document.getElementById('panel-left-top').style.flex = '1';
        document.getElementById('panel-left-top').style.height = '';
      }

      btn.click();
      menu.classList.remove('visible');
    });

    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    menu.classList.add('visible');
  }

  function getDragAfterElement(container, x) {
    const draggableElements = [...container.querySelectorAll('.ptab:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  // Initialize
  initTabListeners(leftTabsTop);
  initTabListeners(leftTabsBottom);
  initDragArea(leftTabsTop);
  initDragArea(leftTabsBottom);

  return { showRight, hideRight, toggleRight, showBottom, hideBottom, toggleBottom, toggleLeft, addPane, removePane, saveSplitState, restore };
})();
