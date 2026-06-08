/* Panel layout — left/right/bottom toggle, drag-resize splitters, split pane */
const Panels = (() => {
  const layout      = document.getElementById('layout');
  const panelLeft   = document.getElementById('panel-left');
  const panelRight  = document.getElementById('panel-right');
  const panelBottom = document.getElementById('panel-bottom');
  const splLeft     = document.getElementById('splitter-left');
  const splRight    = document.getElementById('splitter-right');
  const splBottom   = document.getElementById('splitter-bottom');

  let leftVisible   = true;
  let rightVisible  = false;
  let bottomVisible = false;

  function showRight()  { panelRight.style.display = ''; splRight.style.display = ''; rightVisible = true; }
  function hideRight()  { panelRight.style.display = 'none'; splRight.style.display = 'none'; rightVisible = false; }
  function toggleRight(){ rightVisible ? hideRight() : showRight(); }

  function showBottom() { panelBottom.style.display = ''; splBottom.style.display = ''; bottomVisible = true; }
  function hideBottom() { panelBottom.style.display = 'none'; splBottom.style.display = 'none'; bottomVisible = false; }
  function toggleBottom(){ bottomVisible ? hideBottom() : showBottom(); }

  function toggleLeft() {
    leftVisible = !leftVisible;
    panelLeft.style.display = leftVisible ? '' : 'none';
    splLeft.style.display   = leftVisible ? '' : 'none';
  }

  // drag resize
  function makeDraggable(splitter, target, axis) {
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
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  makeDraggable(splLeft,   panelLeft,   'v');
  makeDraggable(splRight,  panelRight,  'v');
  makeDraggable(splBottom, panelBottom, 'h');

  // Split pane (horizontal split of center)
  let split = false;
  document.getElementById('btn-split').addEventListener('click', () => {
    split = !split;
    const panes = document.getElementById('panes');
    if (split) {
      // add second pane
      const p2 = document.createElement('div');
      p2.className = 'pane';
      p2.id = 'pane-2';
      const spl = document.createElement('div');
      spl.className = 'splitter splitter-v';
      spl.id = 'splitter-pane';
      panes.appendChild(spl);
      panes.appendChild(p2);
      makeDraggable(spl, p2, 'v');
      Explorer.renderInPane(p2, null);
    } else {
      const spl = document.getElementById('splitter-pane');
      const p2  = document.getElementById('pane-2');
      if (spl) spl.remove();
      if (p2)  p2.remove();
    }
  });

  // panel tab switching (left panel)
  document.querySelectorAll('.panel-tabs .ptab').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      if (!panel) return;
      btn.closest('.panel-tabs').querySelectorAll('.ptab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tree-panel').style.display      = panel === 'tree'      ? '' : 'none';
      document.getElementById('bookmarks-panel').style.display = panel === 'bookmarks' ? '' : 'none';
    });
  });

  return { showRight, hideRight, toggleRight, showBottom, hideBottom, toggleBottom, toggleLeft };
})();
