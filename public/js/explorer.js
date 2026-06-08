/* Explorer — directory listing, navigation, views, context menu, breadcrumbs */
const Explorer = (() => {
  let currentPath = null;
  let items       = [];
  let selected    = new Set();
  let history     = [];
  let historyIdx  = -1;
  let view        = localStorage.getItem('de_view') || 'details';
  let sortKey     = 'name';
  let sortAsc     = true;
  let mosaicRowH  = 200;
  let activeTabId = null;

  const pane1     = (() => { const d = document.createElement('div'); d.className = 'pane'; d.id = 'pane-1'; return d; })();
  const ctxMenu   = document.getElementById('context-menu');

  function init() {
    document.getElementById('panes').appendChild(pane1);
    setView(view);
    navigate(null); // show roots
  }

  // ── Navigation ──────────────────────────────────────────
  async function navigate(path, tabId) {
    if (tabId) activeTabId = tabId;
    if (path !== currentPath) {
      history = history.slice(0, historyIdx + 1);
      history.push(path);
      historyIdx = history.length - 1;
    }
    currentPath = path;
    selected.clear();
    await loadDir(path);
    updateBreadcrumb(path);
    updateNavButtons();
    updateStatus();
    if (activeTabId) {
      Tabs.updateName(activeTabId, path ? path.split(/[\\/]/).pop() || path : 'Home', path);
    }
    document.getElementById('status-path').textContent = path || 'Home';
  }

  async function loadDir(path) {
    try {
      const result = await WS.send('fs:list', path ? { path } : {});
      items = sortItems(result);
      renderView();
    } catch (e) {
      pane1.innerHTML = `<p style="padding:1rem;color:var(--danger)">Error: ${e.message}</p>`;
    }
  }

  function goBack() {
    if (historyIdx > 0) { historyIdx--; navigate(history[historyIdx]); }
  }
  function goForward() {
    if (historyIdx < history.length - 1) { historyIdx++; navigate(history[historyIdx]); }
  }
  function goUp() {
    if (!currentPath) return;
    const parts = currentPath.split(/[\\/]/);
    const parent = parts.slice(0, -1).join('/') || parts[0] + '/' || null;
    navigate(parent);
  }

  function updateNavButtons() {
    document.getElementById('btn-back').disabled    = historyIdx <= 0;
    document.getElementById('btn-forward').disabled = historyIdx >= history.length - 1;
  }

  // ── Breadcrumb ───────────────────────────────────────────
  function updateBreadcrumb(path) {
    const bc = document.getElementById('breadcrumb');
    bc.innerHTML = '';
    if (!path) {
      const span = document.createElement('span');
      span.className = 'crumb last';
      span.textContent = 'Home';
      bc.appendChild(span);
      return;
    }
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    // root (drive or /)
    const rootLabel = path.match(/^([A-Za-z]:)/) ? path.match(/^([A-Za-z]:)/)[1] + '\\' : '/';

    const rootCrumb = document.createElement('span');
    rootCrumb.className = 'crumb';
    rootCrumb.textContent = rootLabel;
    rootCrumb.addEventListener('click', () => navigate(rootLabel));
    bc.appendChild(rootCrumb);

    parts.forEach((part, i) => {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      bc.appendChild(sep);

      const crumb = document.createElement('span');
      crumb.className = 'crumb' + (i === parts.length - 1 ? ' last' : '');
      crumb.textContent = part;
      const crumbPath = path.replace(/\\/g, '/').split('/').slice(0, i + 2).join('/') || '/';
      crumb.addEventListener('click', () => navigate(crumbPath));
      bc.appendChild(crumb);
    });
  }

  // ── Views ────────────────────────────────────────────────
  function setView(v) {
    view = v;
    localStorage.setItem('de_view', v);
    document.querySelectorAll('[data-view]').forEach(b =>
      b.classList.toggle('active', b.dataset.view === v));
    renderView();
  }

  function renderView() {
    if (view === 'mosaic')  renderMosaic();
    else if (view === 'list') renderList();
    else                      renderDetails();
  }

  function sortItems(arr) {
    return [...arr].sort((a, b) => {
      if (a.isDir !== b.isDir) return b.isDir - a.isDir;
      let va = a[sortKey] ?? '', vb = b[sortKey] ?? '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
  }

  // ── Details view ─────────────────────────────────────────
  function renderDetails() {
    const cols = [
      { key: 'name', label: 'Name', width: '40%' },
      { key: 'size', label: 'Size', width: '10%' },
      { key: 'ext',  label: 'Type', width: '10%' },
      { key: 'mtime',label: 'Modified', width: '20%' },
      { key: 'ctime',label: 'Created', width: '20%' }
    ];

    pane1.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'file-pane';

    const table = document.createElement('div');
    table.className = 'view-details';

    // header
    const head = document.createElement('div');
    head.className = 'col-head';
    cols.forEach(col => {
      const th = document.createElement('div');
      th.className = 'col-h';
      th.style.width = col.width;
      th.innerHTML = col.label + (sortKey === col.key ? `<span class="sort-arrow">${sortAsc ? '▲' : '▼'}</span>` : '');
      th.addEventListener('click', () => {
        if (sortKey === col.key) sortAsc = !sortAsc; else { sortKey = col.key; sortAsc = true; }
        items = sortItems(items);
        renderDetails();
      });
      head.appendChild(th);
    });
    table.appendChild(head);

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'file-row' + (selected.has(item.path) ? ' selected' : '');
      row.dataset.path = item.path;

      cols.forEach(col => {
        const cell = document.createElement('div');
        cell.className = 'cell' + (col.key !== 'name' ? ' cell-muted' : '');
        cell.style.width = col.width;
        if (col.key === 'name') {
          cell.innerHTML = `<div class="cell-name"><span class="file-icon">${fileIcon(item)}</span><span>${escHtml(item.name)}</span></div>`;
        } else if (col.key === 'size') {
          cell.textContent = item.isDir ? '—' : formatSize(item.size);
        } else if (col.key === 'ext') {
          cell.textContent = item.ext ? item.ext.replace('.','') : (item.isDir ? 'folder' : '—');
        } else if (col.key === 'mtime' || col.key === 'ctime') {
          cell.textContent = item[col.key] ? new Date(item[col.key]).toLocaleString() : '—';
        }
        row.appendChild(cell);
      });

      attachRowEvents(row, item);
      table.appendChild(row);
    });

    wrap.appendChild(table);
    pane1.appendChild(wrap);
  }

  // ── List view ────────────────────────────────────────────
  function renderList() {
    pane1.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'file-pane';
    const list = document.createElement('div');
    list.className = 'view-list';

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'file-row' + (selected.has(item.path) ? ' selected' : '');
      row.dataset.path = item.path;
      row.innerHTML = `<span class="file-icon">${fileIcon(item)}</span><span>${escHtml(item.name)}</span>`;
      attachRowEvents(row, item);
      list.appendChild(row);
    });

    wrap.appendChild(list);
    pane1.appendChild(wrap);
  }

  // ── Mosaic view ──────────────────────────────────────────
  function renderMosaic() {
    pane1.innerHTML = '';

    // slider
    const sliderWrap = document.createElement('div');
    sliderWrap.className = 'mosaic-slider-wrap';
    sliderWrap.innerHTML = `<span style="color:var(--text-muted);font-size:.75rem">Size</span>
      <input type="range" min="80" max="400" value="${mosaicRowH}" style="flex:1;accent-color:var(--accent)">
      <span style="color:var(--text-muted);font-size:.75rem">${mosaicRowH}px</span>`;
    const slider = sliderWrap.querySelector('input');
    const label  = sliderWrap.querySelector('span:last-child');
    slider.addEventListener('input', () => {
      mosaicRowH = parseInt(slider.value);
      label.textContent = mosaicRowH + 'px';
      layoutMosaic(mosaicContainer);
    });

    const mosaicContainer = document.createElement('div');
    mosaicContainer.className = 'file-pane view-mosaic';

    pane1.appendChild(sliderWrap);
    pane1.appendChild(mosaicContainer);

    layoutMosaic(mosaicContainer);
  }

  function layoutMosaic(container) {
    container.innerHTML = '';
    const containerW = container.clientWidth || 800;
    const rowH = mosaicRowH;
    const gap = 3;

    // group items into rows
    let rowItems = [];
    let rowW = 0;

    const flush = () => {
      if (!rowItems.length) return;
      const row = document.createElement('div');
      row.className = 'mosaic-row';
      row.style.setProperty('--row-height', rowH + 'px');
      rowItems.forEach(({ item, ratio }) => {
        const tile = makeMosaicTile(item, ratio, rowH);
        row.appendChild(tile);
      });
      container.appendChild(row);
      rowItems = [];
      rowW = 0;
    };

    items.forEach(item => {
      const ratio = getAspectRatio(item);
      const w = Math.round(ratio * rowH);
      if (rowW + w + gap > containerW && rowItems.length) flush();
      rowItems.push({ item, ratio });
      rowW += w + gap;
    });
    flush();
  }

  function getAspectRatio(item) {
    if (item.isDir) return 1;
    const ext = (item.ext || '').toLowerCase();
    if (['.jpg','.jpeg','.png','.gif','.webp'].includes(ext)) return 4/3;
    if (['.mp4','.webm','.mov'].includes(ext)) return 16/9;
    return 1; // square for code/other
  }

  function makeMosaicTile(item, ratio, rowH) {
    const tile = document.createElement('div');
    tile.className = 'mosaic-item' + (selected.has(item.path) ? ' selected' : '');
    tile.style.width = Math.round(ratio * rowH) + 'px';
    tile.dataset.path = item.path;

    const token = localStorage.getItem('de_token') || '';
    const ext = (item.ext || '').toLowerCase();
    const isMedia = ['.jpg','.jpeg','.png','.gif','.webp','.avif','.mp4','.webm','.mov'].includes(ext);

    if (!item.isDir && isMedia) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = `/thumbnail?path=${encodeURIComponent(item.path)}&width=${Math.round(ratio * rowH * 1.5)}&token=${token}`;
      img.onerror = () => { img.replaceWith(makeIconTile(item)); };
      tile.appendChild(img);
    } else {
      tile.appendChild(makeIconTile(item));
    }

    const label = document.createElement('div');
    label.className = 'mosaic-label';
    label.textContent = item.name;
    tile.appendChild(label);

    attachRowEvents(tile, item);
    return tile;
  }

  function makeIconTile(item) {
    const div = document.createElement('div');
    div.className = 'mosaic-icon-tile';
    div.innerHTML = `<span class="big-icon">${fileIcon(item)}</span><span>${escHtml(item.name)}</span>`;
    return div;
  }

  // ── Row interaction ──────────────────────────────────────
  function attachRowEvents(el, item) {
    el.addEventListener('click', (e) => {
      if (!e.ctrlKey && !e.shiftKey) selected.clear();
      if (e.ctrlKey) {
        selected.has(item.path) ? selected.delete(item.path) : selected.add(item.path);
      } else {
        selected.add(item.path);
      }
      updateSelectionUI();
      updateStatus();
    });

    el.addEventListener('dblclick', () => {
      if (item.isDir) navigate(item.path);
      else Preview.open(item);
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!selected.has(item.path)) { selected.clear(); selected.add(item.path); updateSelectionUI(); }
      showContextMenu(e.clientX, e.clientY, item);
    });
  }

  function updateSelectionUI() {
    document.querySelectorAll('[data-path]').forEach(el => {
      el.classList.toggle('selected', selected.has(el.dataset.path));
    });
  }

  // ── Inline rename ────────────────────────────────────────
  async function startRename(item) {
    const el = document.querySelector(`[data-path="${CSS.escape(item.path)}"] .tab-name,
      [data-path="${CSS.escape(item.path)}"] .cell-name span:last-child,
      [data-path="${CSS.escape(item.path)}"] span:last-child`);
    if (!el) return;
    const orig = el.textContent;
    const input = document.createElement('input');
    input.value = orig;
    input.style.cssText = 'background:var(--bg-base);border:1px solid var(--accent);border-radius:3px;color:var(--text-primary);padding:0 .3rem;font-size:inherit;width:100%';
    el.replaceWith(input);
    input.focus();
    input.select();

    const commit = async () => {
      const newName = input.value.trim();
      if (newName && newName !== orig) {
        try { await WS.send('fs:rename', { path: item.path, name: newName }); } catch (e) { alert(e.message); }
      }
      refresh();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); refresh(); }
    });
  }

  // ── Context menu ─────────────────────────────────────────
  function showContextMenu(x, y, item) {
    const sel = Array.from(selected);
    const multi = sel.length > 1;

    const menuItems = [
      { label: multi ? `Open all (${sel.length})` : 'Open', action: () => { if (item.isDir) navigate(item.path); else Preview.open(item); } },
      !multi && { label: 'Open in new tab',   action: () => Tabs.create(item.name, item.path) },
      !multi && { label: 'Open in split pane', action: () => { Panels.toggleRight(); Preview.open(item); } },
      'sep',
      { label: '🖥 Open terminal here', action: () => Term.openHere(item.isDir ? item.path : parentOf(item.path)) },
      { label: '🔍 Search from here',   action: () => Search.showFromPath(item.isDir ? item.path : parentOf(item.path)) },
      'sep',
      { label: '✂ Cut',      action: () => Clipboard.set(sel, 'cut') },
      { label: '⎘ Copy',     action: () => Clipboard.set(sel, 'copy') },
      { label: '⬇ Download', action: () => Clipboard.download(sel) },
      { label: '📋 Paste',   action: () => Clipboard.paste(currentPath) },
      'sep',
      !multi && { label: '✏ Rename (F2)', action: () => startRename(item) },
      { label: '📁 New folder',           action: () => newFolder() },
      { label: '🗑 Delete',  cls: 'danger', action: () => deleteSelected() },
      'sep',
      !multi && { label: '📌 Bookmark',   action: () => Bookmarks.add(item.path, item.name) },
      !multi && { label: 'ℹ Properties',  action: () => Preview.open(item) }
    ].filter(Boolean);

    ctxMenu.innerHTML = '';
    menuItems.forEach(m => {
      if (m === 'sep') {
        const sep = document.createElement('li');
        sep.className = 'ctx-sep';
        ctxMenu.appendChild(sep);
        return;
      }
      const li = document.createElement('li');
      li.className = 'ctx-item' + (m.cls ? ' ' + m.cls : '');
      li.textContent = m.label;
      li.addEventListener('click', () => { hideContextMenu(); m.action(); });
      ctxMenu.appendChild(li);
    });

    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top  = y + 'px';
    ctxMenu.classList.add('visible');
  }

  function hideContextMenu() { ctxMenu.classList.remove('visible'); }

  document.addEventListener('click', hideContextMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideContextMenu(); });

  // ── File operations ───────────────────────────────────────
  async function newFolder() {
    const name = prompt('Folder name:');
    if (!name || !currentPath) return;
    await WS.send('fs:mkdir', { path: currentPath + '/' + name });
    refresh();
  }

  async function deleteSelected() {
    const sel = Array.from(selected);
    if (!sel.length) return;
    if (!confirm(`Delete ${sel.length} item(s)?`)) return;
    await WS.send('fs:delete', { paths: sel });
    selected.clear();
    refresh();
  }

  function refresh() { loadDir(currentPath); }

  // ── Status bar ────────────────────────────────────────────
  function updateStatus() {
    const el = document.getElementById('status-items');
    if (selected.size) {
      el.textContent = `${selected.size} of ${items.length} selected`;
    } else {
      el.textContent = `${items.length} items`;
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'F2' && selected.size === 1) {
      const item = items.find(i => i.path === Array.from(selected)[0]);
      if (item) startRename(item);
    }
    if (e.key === 'Delete' && selected.size) deleteSelected();
    if (e.ctrlKey && e.key === 'c' && selected.size) Clipboard.set(Array.from(selected), 'copy');
    if (e.ctrlKey && e.key === 'x' && selected.size) Clipboard.set(Array.from(selected), 'cut');
    if (e.ctrlKey && e.key === 'v') Clipboard.paste(currentPath);
    if (e.altKey && e.key === 'ArrowLeft')  goBack();
    if (e.altKey && e.key === 'ArrowRight') goForward();
    if (e.altKey && e.key === 'ArrowUp')    goUp();
  });

  // ── Path bar ─────────────────────────────────────────────
  const pathbar   = document.getElementById('pathbar');
  const breadcrumb= document.getElementById('breadcrumb');
  const pathInput = document.getElementById('path-input');

  pathbar.addEventListener('click', () => {
    breadcrumb.style.display = 'none';
    pathInput.style.display  = '';
    pathInput.value = currentPath || '';
    pathInput.focus();
  });

  pathInput.addEventListener('blur', () => {
    breadcrumb.style.display = '';
    pathInput.style.display  = 'none';
  });

  pathInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { navigate(pathInput.value.trim()); pathInput.blur(); }
    if (e.key === 'Escape') pathInput.blur();
  });

  // ── Toolbar buttons ───────────────────────────────────────
  document.getElementById('btn-back').addEventListener('click', goBack);
  document.getElementById('btn-forward').addEventListener('click', goForward);
  document.getElementById('btn-up').addEventListener('click', goUp);
  document.getElementById('btn-theme').addEventListener('click', () => Theme.toggle());
  document.getElementById('btn-new-folder').addEventListener('click', newFolder);
  document.getElementById('btn-upload').addEventListener('click', () => document.getElementById('upload-input').click());
  document.querySelectorAll('[data-view]').forEach(btn =>
    btn.addEventListener('click', () => setView(btn.dataset.view))
  );

  // Upload handler
  document.getElementById('upload-input').addEventListener('change', async (e) => {
    const form = new FormData();
    Array.from(e.target.files).forEach(f => form.append('files', f));
    const token = localStorage.getItem('de_token') || '';
    await fetch(`/upload?path=${encodeURIComponent(currentPath)}&token=${token}`, {
      method: 'POST', headers: { 'X-Token': token }, body: form
    });
    refresh();
    e.target.value = '';
  });

  // ── Drop upload ───────────────────────────────────────────
  document.getElementById('panes').addEventListener('dragover', e => e.preventDefault());
  document.getElementById('panes').addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!e.dataTransfer.files.length) return;
    const form = new FormData();
    Array.from(e.dataTransfer.files).forEach(f => form.append('files', f));
    const token = localStorage.getItem('de_token') || '';
    await fetch(`/upload?path=${encodeURIComponent(currentPath)}&token=${token}`, {
      method: 'POST', headers: { 'X-Token': token }, body: form
    });
    refresh();
  });

  // ── Helpers ───────────────────────────────────────────────
  function renderInPane(pane, path) {
    // used for split pane — minimal independent pane
    pane.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">Navigate to a folder.</p>';
  }

  function parentOf(p) { return p.split(/[\\/]/).slice(0,-1).join('/') || '/'; }
  function fileIcon(item) {
    if (item.isDir) return '📁';
    const ext = (item.ext || '').toLowerCase();
    if (['.jpg','.jpeg','.png','.gif','.webp','.svg'].includes(ext)) return '🖼';
    if (['.mp4','.webm','.mov','.avi'].includes(ext)) return '🎬';
    if (['.mp3','.ogg','.wav','.flac'].includes(ext)) return '🎵';
    if (['.pdf'].includes(ext)) return '📕';
    if (['.zip','.rar','.7z','.tar','.gz'].includes(ext)) return '🗜';
    if (['.js','.ts','.py','.rb','.go','.rs'].includes(ext)) return '📝';
    return '📄';
  }
  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function formatSize(b) {
    if (!b) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b/1048576).toFixed(1) + ' MB';
    return (b/1073741824).toFixed(1) + ' GB';
  }

  return { navigate, refresh, renderInPane };
})();
