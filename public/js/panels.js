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

      const onMove = (e) => {
        const delta = (axis === 'v' ? e.clientX : e.clientY) - start;
        const sign  = splitter === splRight || splitter === splBottom ? -1 : 1;
        const size  = Math.max(140, Math.min(600, startSize + sign * delta));
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

  // btn-split: add pane if below max, otherwise remove last
  document.getElementById('btn-split').addEventListener('click', () => {
    if (extraPanes.length < 2) addPane();
    else removePane(extraPanes[extraPanes.length - 1].pane);
  });

  document.getElementById('btn-toggle-tree').addEventListener('click', toggleLeft);

  // panel tab switching (left panel)
  document.querySelectorAll('.panel-tabs .ptab').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      if (!panel) return;
      btn.closest('.panel-tabs').querySelectorAll('.ptab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tree-panel').style.display      = panel === 'tree'      ? '' : 'none';
      document.getElementById('bookmarks-panel').style.display = panel === 'bookmarks' ? '' : 'none';
      document.getElementById('git-panel').style.display       = panel === 'git'       ? '' : 'none';
      if (panel === 'git') Git.activate();
    });
  });

  return { showRight, hideRight, toggleRight, showBottom, hideBottom, toggleBottom, toggleLeft, addPane, removePane, saveSplitState, restore };
})();
