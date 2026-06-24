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
  let groupKey    = localStorage.getItem('de_group') || 'none';
  let mosaicCols  = parseInt(localStorage.getItem('de_mosaic_cols') || '4');
  let activeTabId     = null;
  let lastClickedPath = null;
  let tagMap      = new Map(); // path -> { color, label }
  let filterText  = '';
  let colorFilter = null; // null or color hex
  let typeFilter  = ''; // file extension filter

  const EXEC_EXTS = ['exe','msi','bat','cmd','com','ps1','sh','app'];
  const isExecItem = (item) => !item.isDir && EXEC_EXTS.includes((item.ext || '').replace('.', '').toLowerCase());

  // Launches a runnable file on the server. If we're browsing from a different
  // device than the host, switch to the Stream view and connect to the Desktop
  // session so the app is immediately visible. If we're already at the host,
  // just launch it — it'll open and focus itself on the screen we're looking at.
  function showRtcLaunchModal(item, launchFn) {
    fetch('/stream/webrtc-config')
      .then(res => res.json())
      .then(config => {
        const isSetup = !!config.hostId;
        const modal = document.createElement('div');
        modal.className = 'app-settings-modal open';
        modal.innerHTML = `
          <div class="app-settings-box" style="width: 440px; max-width: 90vw; height: auto;">
            <div class="app-settings-header">
              <h2>Remote App Launch</h2>
              <button class="app-settings-close" title="Close">×</button>
            </div>
            <div class="app-settings-body">
              <p style="color: var(--text-primary); font-size: 0.95rem; line-height: 1.5; margin-bottom: 0.5rem;">
                You are accessing this session from a remote device. This will launch the app on the host computer and stream it to your device via WebRTC.
              </p>
              ${!isSetup ? `<p style="color: #ff6b6b; font-size: 0.85rem; background: rgba(239,68,68,0.1); padding: 0.8rem; border-radius: var(--radius-sm);"><b>RTC Not Configured:</b> You need to set up WebRTC Engine before you can stream this app.</p>` : ''}
              <div style="margin-top: 1.5rem; display: flex; gap: 0.8rem; justify-content: flex-end;">
                <button class="icon-btn rtc-close-btn" style="padding: 0.5rem 1rem; border: 1px solid var(--border); border-radius: var(--radius-sm);">Cancel</button>
                ${isSetup ? 
                  `<button class="icon-btn rtc-open-btn" style="padding: 0.5rem 1rem; background: var(--accent); color: #fff; border-radius: var(--radius-sm);">Open App</button>` : 
                  `<button class="icon-btn rtc-setup-btn" style="padding: 0.5rem 1rem; background: var(--accent); color: #fff; border-radius: var(--radius-sm);">Setup RTC</button>`
                }
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.querySelector('.app-settings-close').onclick = close;
        modal.querySelector('.rtc-close-btn').onclick = close;
        
        if (isSetup) {
          modal.querySelector('.rtc-open-btn').onclick = () => {
            close();
            launchFn();
            setView('stream');
            StreamView.launchApp({
              name: item.name || item.path.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''),
              image: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=400',
              path: null,
              appid: null
            }, true);
          };
        } else {
          modal.querySelector('.rtc-setup-btn').onclick = () => {
            close();
            if (typeof AppSettings !== 'undefined') AppSettings.open('rtc');
          };
        }
      })
      .catch(() => {
        launchFn(); // Fallback if API fails
      });
  }

  function runAndStream(item) {
    const launch = () => WS.send('fs:exec', { path: item.path });
    if (typeof StreamView !== 'undefined' && StreamView.isLocal) {
      StreamView.isLocal().then((isLocal) => {
        if (isLocal) {
          launch();
          return;
        }
        showRtcLaunchModal(item, launch);
      });
    } else {
      launch();
    }
  }

  const pane1   = (() => { const d = document.createElement('div'); d.className = 'pane'; d.id = 'pane-1'; return d; })();
  const ctxMenu = document.getElementById('context-menu');

  // focused pane tracking
  let focusedPaneEl = pane1;

  document.getElementById('panes').appendChild(pane1);
  pane1.addEventListener('mousedown', () => setFocusedPane(pane1));

  WS.on('tags:update', (data) => {
    if (data.color || data.label) tagMap.set(data.path, data);
    else tagMap.delete(data.path);
    renderView();
    if (window.Tree && Tree.updateTags) Tree.updateTags(tagMap);
  });

  // Drag-to-select rectangle
  pane1.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.file-row,.mosaic-item,.col-head,.mosaic-slider-wrap')) return;
    const x0 = e.clientX, y0 = e.clientY;
    let rect = null, started = false;
    const onMove = (mv) => {
      if (!started) {
        if (Math.hypot(mv.clientX - x0, mv.clientY - y0) < 6) return;
        started = true;
        rect = document.createElement('div');
        rect.className = 'drag-select-rect';
        document.body.appendChild(rect);
        if (!e.ctrlKey) { selected.clear(); updateSelectionUI(); }
      }
      const x1 = Math.min(x0, mv.clientX), y1 = Math.min(y0, mv.clientY);
      rect.style.left          = x1 + 'px';
        rect.style.top           = y1 + 'px';
        rect.style.width         = Math.abs(mv.clientX - x0) + 'px';
        rect.style.height        = Math.abs(mv.clientY - y0) + 'px';
    };
    const onUp = (up) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!rect) return;
      rect.remove();
      const r = { left: Math.min(x0, up.clientX), right: Math.max(x0, up.clientX),
                  top:  Math.min(y0, up.clientY),  bottom: Math.max(y0, up.clientY) };
      pane1.querySelectorAll('[data-path]').forEach(el => {
        const b = el.getBoundingClientRect();
        if (b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) {
          selected.add(el.dataset.path);
        }
      });
      updateSelectionUI();
      updateStatus();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Right-click on empty pane space → context menu for current folder
  pane1.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (e.target.closest('.file-row,.mosaic-item,.col-head')) return;
    selected.clear();
    lastClickedPath = null;
    updateSelectionUI();
    showContextMenu(e.clientX, e.clientY, {
      path: currentPath, isDir: true, ext: null, size: 0, mtime: 0, ctime: 0,
      name: currentPath ? currentPath.split(/[\\/]/).pop() || currentPath : 'Home'
    });
  });

  // ── Focus tracking ────────────────────────────────────────
  function setFocusedPane(pane) {
    focusedPaneEl = pane;
    document.querySelectorAll('.pane').forEach(p =>
      p.classList.toggle('pane-focused', p === pane)
    );
  }

  // Called by tree: navigate the currently focused pane
  function navigateFocused(path) {
    const pane2 = document.getElementById('pane-2');
    if (focusedPaneEl !== pane1 && focusedPaneEl?._explorer) {
      focusedPaneEl._explorer.navigate(path);
    } else {
      navigate(path);
    }
  }

  // Open a path in the split pane (creating it if needed)
  function openInSplit(path) {
    let pane2 = document.getElementById('pane-2');
    if (!pane2) {
      Panels.addPane();
      pane2 = document.getElementById('pane-2');
    }
    if (pane2?._explorer) pane2._explorer.navigate(path);
  }

  // Called by panels.js when the last extra pane is removed
  function setFocusToPrimary() {
    setFocusedPane(pane1);
  }

  // Nav listeners — called after every navigation (used by Git panel etc.)
  const _navListeners = [];
  function addNavListener(fn) { _navListeners.push(fn); }
  function getCurrentPath()   { return currentPath; }

  // ── Navigation ──────────────────────────────────────────
  // Core navigation work without touching app or browser history
  async function _go(path) {
    currentPath = path;
    selected.clear();
    lastClickedPath = null;

    await loadDir(path);
    updateBreadcrumb(path);
    updateNavButtons();
    updateStatus();
    if (path) Tree.expandTo(path);
    if (path) Favourites.logAccess(path);
    if (activeTabId) {
      Tabs.updateName(activeTabId, path ? path.split(/[\\/]/).pop() || path : 'Home', path);
    }
    _navListeners.forEach(fn => { try { fn(path); } catch {} });
  }

  async function navigate(path, tabId) {
    if (tabId) activeTabId = tabId;
    if (path !== currentPath) {
      history = history.slice(0, historyIdx + 1);
      history.push(path);
      historyIdx = history.length - 1;
      window.history.pushState({ de_idx: historyIdx }, '');
    }
    await _go(path);
  }

  async function loadDir(path) {
    try {
      const [result, tags] = await Promise.all([
        WS.send('fs:list', path ? { path } : {}),
        WS.send('fs:list-tags', {})
      ]);
      
      tagMap.clear();
      tags.forEach(t => tagMap.set(t.path, t));
      if (window.Tree && Tree.updateTags) Tree.updateTags(tagMap);

      items = sortItems(result);
      renderView();
    } catch (e) {
      pane1.innerHTML = `<p style="padding:1rem;color:var(--danger)">Error: ${e.message}</p>`;
    }
  }

  function goBack() {
    if (historyIdx > 0) window.history.back();
    else                goUp();  // No more back history → climb to parent directory
  }
  function goForward() { if (historyIdx < history.length - 1) window.history.forward(); }
  function goUp() {
    if (!currentPath) return;
    const parts = currentPath.split(/[\\/]/);
    const parent = parts.slice(0, -1).join('/') || parts[0] + '/' || null;
    navigate(parent);
  }

  // Whether the current path still has a parent we can climb to (i.e. not at a root)
  function _hasParentDir() {
    if (!currentPath) return false;
    const parts = currentPath.replace(/[\\/]+$/, '').split(/[\\/]/);
    return parts.length > 1 && parts[parts.length - 1] !== '';
  }
  function updateNavButtons() {
    // Back is enabled if either there's history to pop OR a parent directory to climb into
    document.getElementById('btn-back').disabled    = historyIdx <= 0 && !_hasParentDir();
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

    // Detect Windows drive root (e.g. "C:") vs Unix root ("/")
    const winMatch = path.match(/^([A-Za-z]:)/);
    let rootLabel, rootPath, segments;
    if (winMatch) {
      rootLabel = winMatch[1] + '\\';
      rootPath  = winMatch[1] + '\\';
      // strip "C:" then split on either separator
      segments  = path.slice(2).split(/[\\/]+/).filter(Boolean);
    } else {
      rootLabel = '/';
      rootPath  = '/';
      segments  = path.split(/[\\/]+/).filter(Boolean);
    }

    const makeCrumb = (label, targetPath, isLast) => {
      const c = document.createElement('span');
      c.className = 'crumb' + (isLast ? ' last' : '');
      c.textContent = label;
      if (!isLast) {
        c.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          navigate(targetPath);
        });
      }
      return c;
    };

    bc.appendChild(makeCrumb(rootLabel, rootPath, segments.length === 0));

    let accum = rootPath;
    segments.forEach((seg, i) => {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      bc.appendChild(sep);

      // Build the absolute path up to this segment
      accum = winMatch
        ? (i === 0 ? rootPath + seg : accum + '\\' + seg)
        : (accum === '/' ? '/' + seg : accum + '/' + seg);
      const isLast = i === segments.length - 1;
      bc.appendChild(makeCrumb(seg, accum, isLast));
    });
  }

  // ── Views ────────────────────────────────────────────────
  function setView(v) {
    view = v;
    localStorage.setItem('de_view', v);
    State.set('view', v);
    document.querySelectorAll('[data-view]').forEach(b =>
      b.classList.toggle('active', b.dataset.view === v));
    syncViewModeDropdown();
    if (typeof Favourites !== 'undefined') Favourites.render();
    renderView();
  }

  // Mobile: the individual view-mode buttons collapse into a single dropdown.
  // The trigger keeps its own fixed "eye" icon (so it doesn't end up looking
  // like the left-panel hamburger when Details view, which is also a hamburger
  // glyph, happens to be active) — only the menu's active highlight changes.
  function syncViewModeDropdown() {
    document.querySelectorAll('.view-mode-menu-item').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
  }

  (function setupViewModeDropdown() {
    const trigger = document.getElementById('btn-view-dropdown-trigger');
    const menu = document.getElementById('view-mode-menu');
    if (!trigger || !menu) return;
    document.querySelectorAll('.view-mode-group [data-view]').forEach(btn => {
      const item = document.createElement('button');
      item.className = 'view-mode-menu-item';
      item.dataset.view = btn.dataset.view;
      const icon = document.createElement('span');
      icon.innerHTML = btn.innerHTML;
      const label = document.createElement('span');
      label.textContent = btn.title;
      item.appendChild(icon);
      item.appendChild(label);
      item.addEventListener('click', () => { setView(btn.dataset.view); menu.classList.remove('open'); });
      menu.appendChild(item);
    });
    trigger.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('open'); });
    document.addEventListener('mousedown', (e) => {
      if (menu.classList.contains('open') && !menu.contains(e.target) && e.target !== trigger) menu.classList.remove('open');
    });
    syncViewModeDropdown();
  })();

  // setGroup is defined above, but we have a duplicate here? Let's fix this duplicate later, just replace it.
  function setGroupDuplicate(g) {
    // handled above now
  }

  // Restore view/sort from state when it first loads
  State.onReady(() => {
    const sv = State.get('view', null);
    const ss = State.get('sort', null);
    if (sv && sv !== view) { view = sv; localStorage.setItem('de_view', sv); }
    if (ss) { sortKey = ss.key; sortAsc = ss.asc; }
    const sm = State.get('mosaicSize', null);
    if (sm) { mosaicCols = sm; localStorage.setItem('de_mosaic_cols', sm); }
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    syncViewModeDropdown();
  });

  // Live-sync from other devices
  State.onChange('view', (v) => {
    if (!v || v === view) return;
    view = v; localStorage.setItem('de_view', v);
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    syncViewModeDropdown();
    if (items.length) renderView();
  });
  State.onChange('sort', (s) => {
    if (!s) return;
    sortKey = s.key; sortAsc = s.asc;
    if (items.length) { items = sortItems(items); renderView(); }
  });
  State.onChange('mosaicSize', (n) => {
    if (!n || n === mosaicCols) return;
    mosaicCols = n; localStorage.setItem('de_mosaic_cols', n);
    if (view === 'mosaic' && items.length) renderView();
  });

  function renderView() {
    if (view === 'stream' || view === 'media') {
      document.body.classList.add('immersive-mode');
    } else {
      document.body.classList.remove('immersive-mode');
    }

    if (view === 'mosaic')      renderMosaic();
    else if (view === 'list')   renderList();
    else if (view === 'disk')   renderDisk();
    else if (view === 'media')  renderMedia();
    else if (view === 'stream') renderStream();
    else                        renderDetails();
  }

  function renderMedia() {
    pane1.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'file-pane view-media';
    pane1.appendChild(host);
    if (!currentPath) {
      host.innerHTML = '<div style="padding:1.5rem;color:var(--text-muted)">Navigate to a folder to use Media Mode.</div>';
      return;
    }
    if (typeof NetflixMedia === 'undefined') {
      host.innerHTML = '<div style="padding:1.5rem;color:var(--text-muted)">Media Mode script failed to load — check console.</div>';
      return;
    }
    NetflixMedia.render(host, currentPath);
  }

  function renderStream() {
    pane1.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'file-pane view-stream';
    pane1.appendChild(host);
    if (typeof StreamView === 'undefined') {
      host.innerHTML = '<div style="padding:1.5rem;color:var(--text-muted)">Stream View script failed to load — check console.</div>';
      return;
    }
    StreamView.render(host, currentPath);
    if (StreamView.setFilter) StreamView.setFilter(filterText);
    if (StreamView.setSort) StreamView.setSort(typeof groupKey !== 'undefined' ? groupKey : 'none');
  }

  // Disk-usage view — full-pane sunburst rooted at currentPath
  function renderDisk() {
    pane1.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'file-pane view-disk';
    pane1.appendChild(host);
    if (!currentPath) {
      host.innerHTML = '<div style="padding:1.5rem;color:var(--text-muted)">Navigate to a folder to analyse its disk usage.</div>';
      return;
    }
    if (typeof DiskAnalyzer === 'undefined') {
      host.innerHTML = '<div style="padding:1.5rem;color:var(--text-muted)">Disk analyser script failed to load — check console.</div>';
      return;
    }
    DiskAnalyzer.render(host, currentPath);
  }

  function sortItems(arr) {
    let filtered = arr;
    if (filterText) {
      const low = filterText.toLowerCase();
      filtered = filtered.filter(i => i.name.toLowerCase().includes(low));
    }
    if (colorFilter) {
      filtered = filtered.filter(i => tagMap.get(i.path)?.color === colorFilter);
    }
    if (typeFilter) {
      const typeLow = typeFilter.toLowerCase();
      filtered = filtered.filter(i => {
        if (i.isDir) return typeLow === 'folder' || typeLow === 'dir';
        return (i.ext || '').toLowerCase().includes(typeLow) || (i.mime || '').toLowerCase().includes(typeLow);
      });
    }

    return [...filtered].sort((a, b) => {
      // If grouping, sort by group key first
      if (groupKey !== 'none') {
        const ga = getGroupValue(a, groupKey);
        const gb = getGroupValue(b, groupKey);
        if (ga !== gb) {
          if (groupKey === 'mtime' || groupKey === 'ctime' || groupKey === 'size') {
             // Descending for dates/sizes by default
             return ga > gb ? -1 : 1;
          }
          return String(ga).localeCompare(String(gb));
        }
      }

      if (a.isDir !== b.isDir) return b.isDir - a.isDir;
      let va = a[sortKey] ?? '', vb = b[sortKey] ?? '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
  }

  function getGroupValue(item, key) {
    if (key === 'ext') return item.isDir ? 'Folder' : (item.ext ? item.ext.replace('.', '').toUpperCase() + ' File' : 'Unknown File');
    if (key === 'tags') return tagMap.get(item.path)?.color || 'Untagged';
    if (key === 'mtime' || key === 'ctime') {
      if (!item[key]) return 'Unknown Date';
      const d = new Date(item[key]);
      const now = new Date();
      const diffTime = Math.abs(now - d);
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return 'Previous 7 Days';
      if (diffDays < 30) return 'Previous 30 Days';
      return `${d.toLocaleString('default', { month: 'long' })} ${d.getFullYear()}`;
    }
    if (key === 'size') {
      if (item.isDir) return 'Folders';
      if (item.size < 1024 * 1024) return 'Small (Under 1 MB)';
      if (item.size < 100 * 1024 * 1024) return 'Medium (1 MB - 100 MB)';
      if (item.size < 1024 * 1024 * 1024) return 'Large (100 MB - 1 GB)';
      return 'Huge (Over 1 GB)';
    }
    // Default (Name) - Group by first letter
    return (item.name[0] || '?').toUpperCase();
  }

  function renderGroupHeader(val) {
    const el = document.createElement('div');
    el.className = 'group-header';
    if (groupKey === 'tags' && val !== 'Untagged') {
       el.innerHTML = `<span class="color-dot" style="background:${val}; margin-right:6px"></span> Tagged`;
    } else {
       el.textContent = val;
    }
    return el;
  }

  // ── Details view ─────────────────────────────────────────
  let columnWidths = JSON.parse(localStorage.getItem('de_column_widths') || '{}');
  if (!columnWidths.name) columnWidths = { name: '40%', size: '10%', ext: '10%', mtime: '20%', ctime: '20%' };

  function renderDetails() {
    const cols = [
      { key: 'name', label: 'Name', width: columnWidths.name },
      { key: 'size', label: 'Size', width: columnWidths.size },
      { key: 'ext',  label: 'Type', width: columnWidths.ext },
      { key: 'mtime',label: 'Modified', width: columnWidths.mtime },
      { key: 'ctime',label: 'Created', width: columnWidths.ctime }
    ];

    pane1.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'file-pane';

    const table = document.createElement('div');
    table.className = 'view-details';

    const head = document.createElement('div');
    head.className = 'col-head';
    cols.forEach((col, idx) => {
      const th = document.createElement('div');
      th.className = 'col-h';
      th.style.width = col.width;
      th.dataset.key = col.key;
      th.innerHTML = `<span>${col.label}</span>` + (sortKey === col.key ? `<span class="sort-arrow">${sortAsc ? '▲' : '▼'}</span>` : '');
      
      th.addEventListener('click', (e) => {
        if (e.target.closest('.col-resizer')) return;
        if (sortKey === col.key) sortAsc = !sortAsc; else { sortKey = col.key; sortAsc = true; }
        State.set('sort', { key: sortKey, asc: sortAsc });
        items = sortItems(items);
        renderDetails();
      });

      // Add resizer handle
      if (idx < cols.length - 1) {
        const resizer = document.createElement('div');
        resizer.className = 'col-resizer';
        resizer.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          const startWidth = th.offsetWidth;
          const nextTh = th.nextElementSibling;
          const nextStartWidth = nextTh.offsetWidth;
          resizer.classList.add('resizing');

          const onMove = (moveEvent) => {
            const delta = moveEvent.clientX - startX;
            const newWidth = Math.max(50, startWidth + delta);
            const totalWidth = table.offsetWidth;
            
            // Convert to percentages for responsive behavior
            const p1 = (newWidth / totalWidth) * 100;
            const p2 = ((nextStartWidth - delta) / totalWidth) * 100;
            
            if (p2 > 5) {
              th.style.width = p1 + '%';
              nextTh.style.width = p2 + '%';
              columnWidths[col.key] = p1 + '%';
              columnWidths[nextTh.dataset.key] = p2 + '%';
            }
          };

          const onUp = () => {
            resizer.classList.remove('resizing');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            localStorage.setItem('de_column_widths', JSON.stringify(columnWidths));
            // Re-render to ensure all rows match the new header widths
            renderDetails();
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
        th.appendChild(resizer);
      }

      head.appendChild(th);
    });
    table.appendChild(head);

    const sortedItems = sortItems(items);
    let currentGroup = null;
    let renderedCount = 0;
    const CHUNK_SIZE = 100;

    function renderNextChunk() {
      const nextChunk = sortedItems.slice(renderedCount, renderedCount + CHUNK_SIZE);
      if (nextChunk.length === 0) return;

      nextChunk.forEach(item => {
        if (groupKey !== 'none') {
          const groupVal = getGroupValue(item, groupKey);
          if (groupVal !== currentGroup) {
            table.appendChild(renderGroupHeader(groupVal));
            currentGroup = groupVal;
          }
        }

        const row = document.createElement('div');
        row.className = 'file-row' + (selected.has(item.path) ? ' selected' : '');
        row.dataset.path = item.path;

        cols.forEach(col => {
          const cell = document.createElement('div');
          cell.className = 'cell' + (col.key !== 'name' ? ' cell-muted' : '');
          cell.style.width = col.width;
          if (col.key === 'name') {
            cell.innerHTML = `<div class="cell-name">${getTagDot(item)}<span class="file-icon">${fileIcon(item)}</span><span class="file-name-text">${escHtml(item.name)}</span></div>`;
          } else if (col.key === 'size') {
            if (item.isDir) { cell.textContent = '…'; cell.dataset.sizeFor = item.path; }
            else cell.textContent = formatSize(item.size);
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

      renderedCount += nextChunk.length;

      // Fetch folder sizes asynchronously for only the newly rendered folder cells
      table.querySelectorAll('[data-size-for]:not([data-size-requested])').forEach(cell => {
        cell.setAttribute('data-size-requested', 'true');
        WS.send('fs:folder-size', { path: cell.dataset.sizeFor })
          .then(r => {
            cell.textContent = r.diskTotal
              ? `${formatSize(r.size)} of ${formatSize(r.diskTotal)}`
              : formatSize(r.size);
          })
          .catch(() => { cell.textContent = '—'; });
      });
    }

    // Render initial chunk
    renderNextChunk();

    // Listen for scroll to load more
    wrap.addEventListener('scroll', () => {
      if (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 200) {
        renderNextChunk();
      }
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

    const sortedItems = sortItems(items);
    let currentGroup = null;
    let renderedCount = 0;
    const CHUNK_SIZE = 100;

    function renderNextChunk() {
      const nextChunk = sortedItems.slice(renderedCount, renderedCount + CHUNK_SIZE);
      if (nextChunk.length === 0) return;

      nextChunk.forEach(item => {
        if (groupKey !== 'none') {
          const groupVal = getGroupValue(item, groupKey);
          if (groupVal !== currentGroup) {
            list.appendChild(renderGroupHeader(groupVal));
            currentGroup = groupVal;
          }
        }

        const row = document.createElement('div');
        row.className = 'file-row' + (selected.has(item.path) ? ' selected' : '');
        row.dataset.path = item.path;
        row.innerHTML = `${getTagDot(item)}<span class="file-icon">${fileIcon(item)}</span><span>${escHtml(item.name)}</span>`;
        attachRowEvents(row, item);
        list.appendChild(row);
      });

      renderedCount += nextChunk.length;
    }

    // Render initial chunk
    renderNextChunk();

    // Listen for scroll to load more
    wrap.addEventListener('scroll', () => {
      if (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 200) {
        renderNextChunk();
      }
    });

    wrap.appendChild(list);
    pane1.appendChild(wrap);
  }

  // ── Mosaic view ──────────────────────────────────────────
  // Thumbnails-per-row is configured from the Settings modal (Gallery tab) now,
  // not an inline control — setMosaicCols() is the live-update hook it calls.
  function renderMosaic() {
    pane1.innerHTML = '';

    const mosaicContainer = document.createElement('div');
    mosaicContainer.className = 'file-pane view-mosaic';

    pane1.appendChild(mosaicContainer);

    layoutMosaic(mosaicContainer);
  }

  function setMosaicCols(n) {
    mosaicCols = Math.max(1, Math.min(8, parseInt(n, 10) || mosaicCols));
    localStorage.setItem('de_mosaic_cols', mosaicCols);
    State.set('mosaicSize', mosaicCols);
    if (view === 'mosaic' && items.length) renderView();
  }

  const GALLERY_IMG_EXTS = new Set([
    '.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.tiff','.tif',
    '.heic','.heif',
    '.dng','.cr2','.cr3','.nef','.arw','.raf','.orf','.rw2'
  ]);
  const GALLERY_VID_EXTS = new Set(['.mp4','.webm','.mov','.mkv','.avi','.m4v']);

  function layoutMosaic(container) {
    container.innerHTML = '';
    const containerW = container.clientWidth || 800;
    
    // Dynamic gap that scales with column count: 12px for 1 col, down to 3px for 8 cols
    const gap = Math.max(3, Math.round(14 - (mosaicCols * 1.3)));
    container.style.gap = gap + 'px';

    const tileW = Math.round((containerW - gap * (mosaicCols - 1)) / mosaicCols);

    const filtered = sortItems(items);
    const sorted = filtered
      .filter(item => !item.isDir && (
        GALLERY_IMG_EXTS.has((item.ext || '').toLowerCase()) ||
        GALLERY_VID_EXTS.has((item.ext || '').toLowerCase())
      ))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    if (!sorted.length) {
      container.innerHTML = '<div style="padding:2rem;color:var(--text-muted);font-size:.85rem;text-align:center">No images or videos in this folder</div>';
      return;
    }

    container.style.gridTemplateColumns = `repeat(${mosaicCols}, 1fr)`;

    let currentGroup = null;
    let renderedCount = 0;
    const CHUNK_SIZE = 100;

    function renderNextChunk() {
      const nextChunk = sorted.slice(renderedCount, renderedCount + CHUNK_SIZE);
      if (nextChunk.length === 0) return;

      nextChunk.forEach(item => {
        if (groupKey !== 'none') {
          const groupVal = getGroupValue(item, groupKey);
          if (groupVal !== currentGroup) {
            const header = renderGroupHeader(groupVal);
            header.style.gridColumn = '1 / -1'; // Span across all columns in mosaic
            container.appendChild(header);
            currentGroup = groupVal;
          }
        }
        container.appendChild(makeMosaicTile(item, tileW, Math.round(tileW * 0.75)));
      });

      renderedCount += nextChunk.length;
    }

    // Render initial chunk
    renderNextChunk();

    // Listen for scroll to load more
    container.addEventListener('scroll', () => {
      if (container.scrollHeight - container.scrollTop - container.clientHeight < 200) {
        renderNextChunk();
      }
    });
  }

  function makeMosaicTile(item, tileW, tileH, navList) {
    const tile = document.createElement('div');
    tile.className = 'mosaic-item' + (selected.has(item.path) ? ' selected' : '');
    tile.dataset.path = item.path;
    tile.style.height = tileH + 'px';

    const token = localStorage.getItem('de_token') || '';
    const ext   = (item.ext || '').toLowerCase();
    // Include mtime in the URL so browsers don't reuse stale cached responses
    // (notably old 204s from before the heic-convert HEIC fallback was added).
    const ver   = item.mtime ? Math.floor(item.mtime) : 0;
    const src    = `/thumbnail?path=${encodeURIComponent(item.path)}&width=${Math.round(tileW * 1.5)}&token=${token}&v=${ver}`;

    const loader = document.createElement('div');
    loader.className = 'mosaic-loader';
    tile.appendChild(loader);

    const removeLoader = () => { if (loader.parentNode) loader.remove(); };

    let videoPreview = null;
    if (GALLERY_VID_EXTS.has(ext)) {
      // Static frame by default — the animated preview clip is only fetched
      // lazily on hover (desktop) or first tap (touch), see attachRowEvents.
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src     = src;
      img.addEventListener('load', removeLoader, { once: true });
      img.onerror = () => { removeLoader(); img.replaceWith(makeIconTile(item)); };
      tile.appendChild(img);

      const previewWrap = document.createElement('div');
      previewWrap.className = 'mosaic-preview-wrap';
      tile.appendChild(previewWrap);

      const previewUrl = `/video-preview?path=${encodeURIComponent(item.path)}&width=${Math.round(tileW * 1.5)}&token=${token}&v=${ver}`;
      videoPreview = VideoPreview.makeController(previewWrap, () => previewUrl);
    } else if (item.livePhotoMov) {
      // iPhone Live Photo (HEIC + sibling .MOV) — play the live photo on loop
      const vid = document.createElement('video');
      vid.autoplay = true;
      vid.muted    = true;
      vid.loop     = true;
      vid.setAttribute('playsinline', '');
      vid.preload  = 'auto';
      vid.poster   = src; // HEIC thumbnail behind the video until it loads
      vid.src      = `/serve?path=${encodeURIComponent(item.livePhotoMov)}&token=${token}`;
      vid.addEventListener('loadeddata', removeLoader, { once: true });
      vid.onerror  = () => {
        // Fall back to the still HEIC thumbnail if the MOV won't play
        const img = document.createElement('img');
        img.src = src; img.style.cssText = vid.style.cssText;
        vid.replaceWith(img);
      };
      tile.appendChild(vid);
      const badge = document.createElement('span');
      badge.className = 'live-photo-badge';
      badge.textContent = 'LIVE';
      tile.appendChild(badge);
    } else {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src     = src;
      img.addEventListener('load', removeLoader, { once: true });
      img.onerror = () => { removeLoader(); img.replaceWith(makeIconTile(item)); };
      tile.appendChild(img);
    }

    const label = document.createElement('div');
    label.className = 'mosaic-label';
    label.textContent = item.name;
    tile.appendChild(label);

    tile._videoPreview = videoPreview;
    attachRowEvents(tile, item, navList);
    return tile;
  }

  function makeIconTile(item) {
    const div = document.createElement('div');
    div.className = 'mosaic-icon-tile';
    div.innerHTML = `<span class="big-icon">${fileIcon(item)}</span><span>${escHtml(item.name)}</span>`;
    return div;
  }

  // ── Row interaction ──────────────────────────────────────
  // navList: optional restricted list for preview prev/next navigation (e.g. gallery passes media-only)
  function attachRowEvents(el, item, navList) {
    const previewList = () => navList || items;
    el.addEventListener('click', (e) => {
      setFocusedPane(pane1);
      if (e.shiftKey && lastClickedPath !== null) {
        const allPaths = items.map(i => i.path);
        const a = allPaths.indexOf(lastClickedPath);
        const b = allPaths.indexOf(item.path);
        if (a !== -1 && b !== -1) {
          if (!e.ctrlKey) selected.clear();
          const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
          for (let i = lo; i <= hi; i++) selected.add(allPaths[i]);
        }
      } else if (e.ctrlKey) {
        selected.has(item.path) ? selected.delete(item.path) : selected.add(item.path);
        lastClickedPath = item.path;
      } else {
        selected.clear();
        selected.add(item.path);
        lastClickedPath = item.path;
      }
      updateSelectionUI();
      updateStatus();
    });

    el.addEventListener('dblclick', () => {
      el._videoPreview?.unload();
      if (item.isDir) {
        navigate(item.path);
      } else if (isExecItem(item)) {
        runAndStream(item);
      } else {
        Preview.open(item, previewList());
      }
    });

    // Video tiles: lazily load the preview clip on hover instead of eagerly
    // for every visible thumbnail. Touch fires synthetic mouseenter/mouseleave
    // around a tap, which would race with the two-tap arm/open logic in the
    // touchend handler below — so hover here is desktop-only.
    if (el._videoPreview) {
      let hoverTimer = null;
      el.addEventListener('mouseenter', () => {
        if (VideoPreview.isTouch()) return;
        hoverTimer = setTimeout(() => el._videoPreview.load(), 300);
      });
      el.addEventListener('mouseleave', () => {
        if (VideoPreview.isTouch()) return;
        clearTimeout(hoverTimer);
        el._videoPreview.unload();
      });
    }

    // Touch: double-tap → context menu; single-tap → open/navigate
    // Scroll-detection: if finger moves > TAP_SLOP px between touchstart and touchend, treat as scroll.
    let _lastTap = 0, _tapTimer = null;
    let _touchStart = null;
    const TAP_SLOP = 10; // px
    const _openItem = () => {
      if (item.isDir) { navigate(item.path); return; }
      if (isExecItem(item)) runAndStream(item);
      else Preview.open(item, previewList());
    };
    el.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      _touchStart = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!_touchStart) return;
      const t = e.changedTouches[0];
      if (Math.hypot(t.clientX - _touchStart.x, t.clientY - _touchStart.y) > TAP_SLOP) {
        // Convert to scroll: cancel pending taps and stop tracking
        if (_tapTimer) { clearTimeout(_tapTimer); _tapTimer = null; _lastTap = 0; }
        _touchStart = null;
      }
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (!_touchStart) return;  // was a scroll — do nothing, let the browser handle it
      _touchStart = null;
      e.preventDefault();

      // Video tiles: first tap arms the preview clip instead of opening,
      // second tap (preview already loaded) opens for real. Long-press still
      // reaches the context menu via the native contextmenu event.
      if (el._videoPreview) {
        if (!el._videoPreview.loaded) {
          VideoPreview.armExclusive(el._videoPreview);
          el._videoPreview.load();
        } else {
          el._videoPreview.unload();
          _openItem();
        }
        return;
      }

      const now = Date.now(), touch = e.changedTouches[0];
      if (now - _lastTap < 280) {
        if (_tapTimer) { clearTimeout(_tapTimer); _tapTimer = null; }
        _lastTap = 0;
        setFocusedPane(pane1);
        if (!selected.has(item.path)) { selected.clear(); selected.add(item.path); updateSelectionUI(); }
        showContextMenu(touch.clientX, touch.clientY, item);
      } else {
        _lastTap = now;
        _tapTimer = setTimeout(() => { _tapTimer = null; _lastTap = 0; _openItem(); }, 280);
      }
    }, { passive: false });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setFocusedPane(pane1);
      if (!selected.has(item.path)) { selected.clear(); selected.add(item.path); updateSelectionUI(); }
      showContextMenu(e.clientX, e.clientY, item);
    });

    // Middle-click (desktop) / Ctrl+click / triple-tap (mobile) → open folder in a new tab.
    // No-op for files since tabs represent folder views.
    Tabs.attachOpenInNewTab(el, () => item);
  }

  function updateSelectionUI() {
    document.querySelectorAll('[data-path]').forEach(el => {
      el.classList.toggle('selected', selected.has(el.dataset.path));
    });
  }

  // Used by other views (e.g. disk analyser) to point the context menu /
  // clipboard / rename actions at a single item that isn't part of pane1's list.
  function selectOnly(path) {
    setFocusedPane(pane1);
    selected.clear();
    selected.add(path);
    updateSelectionUI();
  }

  // ── Inline rename ────────────────────────────────────────
  async function startRename(item) {
    const el = document.querySelector(`[data-path="${CSS.escape(item.path)}"] .tab-name,
      [data-path="${CSS.escape(item.path)}"] .cell-name span:last-child,
      [data-path="${CSS.escape(item.path)}"] .disk-row-name,
      [data-path="${CSS.escape(item.path)}"] span:last-child`);
    if (!el) return;
    const orig = el.textContent;
    const input = document.createElement('input');
    input.value = orig;
    input.style.cssText = 'background:var(--bg-base);border:1px solid var(--accent);border-radius:3px;color:var(--text-primary);padding:0 .3rem;font-size:inherit;width:100%';
    el.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;

    const commit = async () => {
      if (committed) return;
      committed = true;
      const newName = input.value.trim();
      // Optimistic: replace input with new name immediately — no waiting for server
      const span = document.createElement('span');
      span.textContent = (newName && newName !== orig) ? newName : orig;
      input.replaceWith(span);
      if (newName && newName !== orig) {
        try { await WS.send('fs:rename', { path: item.path, name: newName }); }
        catch (e) { alert(e.message); span.textContent = orig; }
        refresh();
      }
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        committed = true;
        const span = document.createElement('span');
        span.textContent = orig;
        input.replaceWith(span);
      }
    });
  }

  // ── Context menu ─────────────────────────────────────────
  function showContextMenu(x, y, item) {
    const sel   = Array.from(selected);
    const multi = sel.length > 1;
    const ext   = (item.ext || '').replace('.', '').toLowerCase();
    const isExec = !multi && isExecItem(item);
    const isZip  = !multi && !item.isDir && ext === 'zip';

    const tag = tagMap.get(item.path);
    const colors = ['#ff5f56', '#ffbd2e', '#27c93f', '#42a5f5', '#a29bfe', '#abb2bf'];

    const menuItems = [
      { label: multi ? `Open all (${sel.length})` : 'Open',
        action: () => { if (item.isDir) navigate(item.path); else if (isExec) runAndStream(item); else Preview.open(item, items); } },
      !multi && { label: 'Open in new tab',                         action: () => Tabs.create(item.name, item.isDir ? item.path : parentOf(item.path)) },
      !multi && { label: '⊞ Open in split panel',                  action: () => openInSplit(item.isDir ? item.path : parentOf(item.path)) },
      !multi && !item.isDir && { label: 'Preview',                 action: () => Preview.open(item, items) },
      isExec                 && { label: '▶ Run',                  action: () => runAndStream(item) },
      isZip                  && { label: '📂 Extract here',        action: () => extractZipHere(item.path) },
      isZip                  && { label: '📂 Extract to...',       action: () => extractZipTo(item.path) },
      'sep',
      { label: '🖥 Open terminal here', action: () => Term.openHere(item.isDir ? item.path : parentOf(item.path)) },
      { label: '🔍 Search from here',   action: () => Search.showFromPath(item.isDir ? item.path : parentOf(item.path)) },
      'sep',
      { label: '✂ Cut',      action: () => Clipboard.set(sel, 'cut') },
      { label: '⎘ Copy',     action: () => Clipboard.set(sel, 'copy') },
      (!item.isDir && !multi) && { label: '⬇ Download',            action: () => Clipboard.download(sel) },
      (item.isDir && !multi)  && { label: '📦 Download as ZIP',    action: () => downloadAsZip([item.path], item.name + '.zip') },
      multi                   && { label: '📦 Download as ZIP',    action: () => downloadAsZip(sel) },
      (item.isDir && !multi)  && { label: '🗜 Zip here',           action: () => zipHere([item.path], item.name + '.zip') },
      multi                   && { label: '🗜 Zip selected',       action: () => zipHere(sel) },
      { label: '📋 Paste',   action: () => Clipboard.paste(currentPath) },
      'sep',
      !multi && { label: '✏ Rename (F2)', action: () => startRename(item) },
      !multi && { label: '📑 Duplicate',    action: () => WS.send('fs:duplicate', { path: item.path }).then(() => refresh()) },
      'sep',
      { label: '🏷 Tag Color:', type: 'label' },
      { 
        type: 'colors',
        colors: colors,
        active: tag?.color,
        onSelect: (c) => WS.send('fs:set-tag', { path: item.path, color: c === tag?.color ? null : c }).then(() => refresh())
      },
      'sep',
      !multi && { label: 'Copy name',        action: () => navigator.clipboard.writeText(item.name) },
      !multi && { label: 'Copy path',        action: () => navigator.clipboard.writeText(item.path) },
      !multi && !item.isDir && { label: 'Copy folder path', action: () => navigator.clipboard.writeText(parentOf(item.path)) },
      'sep',
      { label: '📁 New folder',           action: () => newFolder() },
      { label: '🗑 Delete',  cls: 'danger', action: () => deleteSelected() },
      'sep',
      !multi && { label: '📌 Bookmark',   action: () => Bookmarks.add(item.path, item.name) },
      !multi && { label: 'ℹ Properties',  action: () => Preview.showProperties(item) }
    ].filter(Boolean);

    ctxMenu.innerHTML = '';
    menuItems.forEach(m => {
      if (m === 'sep') {
        const sep = document.createElement('li');
        sep.className = 'ctx-sep';
        ctxMenu.appendChild(sep);
        return;
      }
      if (m.type === 'label') {
        const li = document.createElement('li');
        li.className = 'ctx-label';
        li.textContent = m.label;
        ctxMenu.appendChild(li);
        return;
      }
      if (m.type === 'colors') {
        const li = document.createElement('li');
        li.className = 'ctx-colors';
        m.colors.forEach(c => {
          const dot = document.createElement('span');
          dot.className = 'color-dot' + (m.active === c ? ' active' : '');
          dot.style.background = c;
          dot.addEventListener('click', (e) => { e.stopPropagation(); m.onSelect(c); hideContextMenu(); });
          li.appendChild(dot);
        });
        ctxMenu.appendChild(li);
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
    const r = ctxMenu.getBoundingClientRect();
    if (r.right  > window.innerWidth)  ctxMenu.style.left = Math.max(0, x - r.width)  + 'px';
    if (r.bottom > window.innerHeight) ctxMenu.style.top  = Math.max(0, y - r.height) + 'px';
  }

  function hideContextMenu() { ctxMenu.classList.remove('visible'); }

  document.addEventListener('click', hideContextMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideContextMenu(); });

  function setFilter(text) {
    filterText = text;
    if (view === 'stream' && typeof StreamView !== 'undefined' && StreamView.setFilter) {
      StreamView.setFilter(text);
    } else {
      renderView();
    }
  }

  function setGroup(g) {
    groupKey = g;
    localStorage.setItem('de_group', g);
    if (view === 'stream' && typeof StreamView !== 'undefined' && StreamView.setSort) {
      StreamView.setSort(g);
    } else {
      renderView();
    }
  }

  function setColorFilter(color) {
    colorFilter = color;
    renderView();
  }

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

  // ── Zip helpers ───────────────────────────────────────────
  function downloadAsZip(paths, name) {
    const token = localStorage.getItem('de_token') || '';
    const n = name || 'archive.zip';
    const a = document.createElement('a');
    a.href = `/zip-download?paths=${encodeURIComponent(JSON.stringify(paths))}&name=${encodeURIComponent(n)}&token=${encodeURIComponent(token)}`;
    a.download = n;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function zipHere(paths, name) {
    if (!currentPath) { alert('Navigate to a folder first.'); return; }
    const n = name || `archive-${Date.now()}.zip`;
    try {
      await WS.send('zip:create', { paths, outputPath: currentPath + '/' + n });
      refresh();
    } catch (e) { alert('Failed to create zip: ' + e.message); }
  }

  async function extractZipHere(zipPath) {
    try {
      await WS.send('zip:extract', { path: zipPath, dest: parentOf(zipPath) });
      refresh();
    } catch (e) { alert('Extraction failed: ' + e.message); }
  }

  async function extractZipTo(zipPath) {
    const dest = prompt('Extract to:', parentOf(zipPath));
    if (dest) {
      try {
        await WS.send('zip:extract', { path: zipPath, dest });
        refresh();
      } catch (e) { alert('Extraction failed: ' + e.message); }
    }
  }

  // ── Status bar ────────────────────────────────────────────
  function updateStatus() {
    const el = document.getElementById('status-items');
    if (selected.size) {
      el.textContent = `${selected.size} of ${items.length} selected`;
    } else {
      el.textContent = `${items.length} items`;
    }
  }

  // ── Split pane mini-explorer ──────────────────────────────
  function renderInPane(pane, initialPath) {
    let paneCurrentPath = null;
    let paneItems       = [];

    async function paneNavigate(p) {
      paneCurrentPath = p;
      // Update path indicator
      const pathText = pane.querySelector('.pane-path-text');
      if (pathText) pathText.textContent = p || 'Home';

      try {
        const result = await WS.send('fs:list', p ? { path: p } : {});
        paneItems = result.sort((a, b) => {
          if (a.isDir !== b.isDir) return b.isDir - a.isDir;
          return String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
        });
        renderPaneList();
        Panels.saveSplitState();
      } catch (e) {
        const body = pane.querySelector('.pane-body');
        if (body) body.innerHTML = `<p style="padding:1rem;color:var(--danger)">Error: ${e.message}</p>`;
      }
    }

    function renderPaneList() {
      const body = pane.querySelector('.pane-body');
      if (!body) return;
      body.innerHTML = '';

      const wrap = document.createElement('div');
      wrap.className = 'file-pane';
      const list = document.createElement('div');
      list.className = 'view-list';

      paneItems.forEach(item => {
        const row = document.createElement('div');
        row.className = 'file-row';
        row.dataset.path = item.path;
        row.innerHTML = `<span class="file-icon">${fileIcon(item)}</span><span>${escHtml(item.name)}</span>`;

        row.addEventListener('click', (e) => {
          setFocusedPane(pane);
          body.querySelectorAll('.file-row').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          Tree.setSelected(item.isDir ? item.path : paneCurrentPath);
          e.stopPropagation();
        });

        row.addEventListener('dblclick', () => {
          if (item.isDir) {
            paneNavigate(item.path);
          } else if (isExecItem(item)) {
            runAndStream(item);
          } else {
            Preview.open(item, paneItems);
          }
        });

        // Touch: double-tap → context menu; single-tap → open/navigate (scroll-aware)
        let _lastPTap = 0, _pTapTimer = null;
        let _pTouchStart = null;
        const _pOpen = () => {
          if (item.isDir) { paneNavigate(item.path); return; }
          if (isExecItem(item)) runAndStream(item);
          else Preview.open(item, paneItems);
        };
        row.addEventListener('touchstart', (e) => {
          const t = e.changedTouches[0];
          _pTouchStart = { x: t.clientX, y: t.clientY };
        }, { passive: true });
        row.addEventListener('touchmove', (e) => {
          if (!_pTouchStart) return;
          const t = e.changedTouches[0];
          if (Math.hypot(t.clientX - _pTouchStart.x, t.clientY - _pTouchStart.y) > 10) {
            if (_pTapTimer) { clearTimeout(_pTapTimer); _pTapTimer = null; _lastPTap = 0; }
            _pTouchStart = null;
          }
        }, { passive: true });
        row.addEventListener('touchend', (e) => {
          if (!_pTouchStart) return;
          _pTouchStart = null;
          e.preventDefault();
          const now = Date.now(), touch = e.changedTouches[0];
          if (now - _lastPTap < 280) {
            if (_pTapTimer) { clearTimeout(_pTapTimer); _pTapTimer = null; }
            _lastPTap = 0;
            setFocusedPane(pane);
            showContextMenu(touch.clientX, touch.clientY, item);
          } else {
            _lastPTap = now;
            _pTapTimer = setTimeout(() => { _pTapTimer = null; _lastPTap = 0; _pOpen(); }, 280);
          }
        }, { passive: false });

        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          setFocusedPane(pane);
          showContextMenu(e.clientX, e.clientY, item);
        });

        list.appendChild(row);
      });

      wrap.appendChild(list);
      body.appendChild(wrap);
    }

    // Build pane structure
    pane.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'pane-pathbar';
    bar.innerHTML = `<span class="pane-path-text">${initialPath || 'Home'}</span>
      <button class="pane-close-btn" title="Close pane">✕</button>`;
    bar.querySelector('.pane-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      Panels.removePane(pane);
    });

    const body = document.createElement('div');
    body.className = 'pane-body';

    pane.appendChild(bar);
    pane.appendChild(body);

    pane.addEventListener('mousedown', () => setFocusedPane(pane));

    pane._explorer = {
      navigate: paneNavigate,
      get currentPath() { return paneCurrentPath; }
    };

    paneNavigate(initialPath);
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
    if (e.key === 'v' && e.ctrlKey) Clipboard.paste(currentPath);
    if (e.key === 'p' || e.key === 'P') {
      const sel = Array.from(selected);
      if (sel.length === 1) {
        const item = items.find(i => i.path === sel[0]);
        if (item && !item.isDir) {
          e.preventDefault();
          Preview.open(item, items, { 
            view: view, 
            cols: mosaicCols 
          });
        }
      }
    }
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
  // #btn-theme-picker is wired by theme.js
  document.getElementById('btn-new-folder').addEventListener('click', newFolder);
  
  const btnSort = document.getElementById('btn-sort');
  if (btnSort) {
    btnSort.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = document.getElementById('sort-menu');
      if (existing) {
        existing.remove();
        return;
      }
      showSortMenu(btnSort);
    });
  }

  // anchor: the button the menu drops down from — positioned below it (not
  // at the raw click point), so the popup never lands on top of the button.
  function showSortMenu(anchor) {
    const anchorRect = anchor.getBoundingClientRect();
    const menu = document.createElement('ul');
    menu.className = 'filter-menu'; // Use filter-menu class for shared glass styling
    menu.id = 'sort-menu'; // Unique ID for toggling
    menu.setAttribute('role', 'menu');
    menu.style.cssText = `position:fixed; left:-9999px; top:${anchorRect.bottom + 6}px; z-index:1000; padding:.5rem 0; margin:0; list-style:none; min-width:180px; border-radius:var(--radius-md); box-shadow:var(--shadow-lg); background:var(--bg-surface); border:1px solid var(--border);`;
    
    const isG = (key) => groupKey === key ? '✓' : '';

    const menuItems = [
      { label: 'None',              check: isG('none'),  action: () => setGroup('none') },
      'sep',
      { label: 'Name',              check: isG('name'),  action: () => setGroup('name') },
      { label: 'Kind',              check: isG('ext'),   action: () => setGroup('ext') },
      { label: 'Application',       check: isG('app'),   action: () => setGroup('app') },
      { label: 'Date Last Opened',  check: isG('atime'), action: () => setGroup('atime') },
      { label: 'Date Added',        check: isG('btime'), action: () => setGroup('btime') },
      { label: 'Date Modified',     check: isG('mtime'), action: () => setGroup('mtime') },
      { label: 'Date Created',      check: isG('ctime'), action: () => setGroup('ctime') },
      { label: 'Size',              check: isG('size'),  action: () => setGroup('size') },
      { label: 'Tags',              check: isG('tags'),  action: () => setGroup('tags') }
    ];

    menuItems.forEach(m => {
      if (m === 'sep') {
        const sep = document.createElement('li');
        sep.className = 'ctx-sep';
        menu.appendChild(sep);
        return;
      }
      
      const li = document.createElement('li');
      li.className = 'ctx-item';
      li.innerHTML = `<span class="ctx-check">${m.check}</span> <span class="${m.check ? '' : 'ctx-indent'}">${m.label}</span>`;
      li.addEventListener('click', () => {
        menu.remove();
        m.action();
      });
      menu.appendChild(li);
    });

    document.body.appendChild(menu);

    // Right-align under the button, clamped so it never runs off-screen
    const rect = menu.getBoundingClientRect();
    let safeX = anchorRect.right - rect.width;
    if (safeX < 4) safeX = 4;
    if (safeX + rect.width > window.innerWidth) {
      safeX = Math.max(4, window.innerWidth - rect.width - 10);
    }
    menu.style.left = safeX + 'px';
    menu.classList.add('visible');

    const closeHandler = (e) => {
      if (!menu.contains(e.target) && !e.target.closest('#btn-sort')) {
        menu.remove();
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 10);
  }

  const btnFilter = document.getElementById('btn-filter');
  if (btnFilter) {
    btnFilter.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = document.getElementById('filter-popup');
      if (existing) {
        existing.remove();
        return;
      }
      showFilterMenu(btnFilter);
    });
  }

  // anchor: the button the menu drops down from — positioned below it (not
  // at the raw click point), so the popup never lands on top of the button.
  function showFilterMenu(anchor) {
    const anchorRect = anchor.getBoundingClientRect();
    const colors = ['#ff5f56', '#ffbd2e', '#27c93f', '#42a5f5', '#a29bfe', '#abb2bf'];
    const menu = document.createElement('div');
    menu.className = 'filter-menu';
    menu.id = 'filter-popup'; // Unique ID for toggling
    // Position initially off-screen to measure, then move
    menu.style.cssText = `position:fixed; left:-9999px; top:${anchorRect.bottom + 6}px; background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--radius-md); box-shadow:var(--shadow-lg); z-index:1000; padding:.75rem; min-width:240px; display:flex; flex-direction:column; gap:.8rem;`;

    let html = `
      <div style="font-size:.7rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.05em">Filters</div>

      <div class="input-clear-wrap">
        <input type="text" id="filter-input" placeholder="Filter by name..." value="${filterText}"
          style="width:100%; background:var(--bg-base); border:1px solid var(--border); color:var(--text-primary); padding:.35rem 1.6rem .35rem .35rem; border-radius:4px; outline:none; font-size:.85rem">
        <button class="input-clear-btn" id="filter-input-clear" title="Clear" style="display:${filterText ? '' : 'none'}">&times;</button>
      </div>

      <div class="input-clear-wrap">
        <input type="text" id="filter-type" placeholder="Filter by kind (e.g. pdf, jpg)" value="${typeFilter}"
          style="width:100%; background:var(--bg-base); border:1px solid var(--border); color:var(--text-primary); padding:.35rem 1.6rem .35rem .35rem; border-radius:4px; outline:none; font-size:.85rem">
        <button class="input-clear-btn" id="filter-type-clear" title="Clear" style="display:${typeFilter ? '' : 'none'}">&times;</button>
      </div>

      <div>
        <div style="font-size:.7rem; color:var(--text-muted); margin-bottom:.4rem">Color Tag</div>
        <div class="ctx-colors" style="justify-content:flex-start; padding:0; gap:.5rem">
          <span class="color-dot ${!colorFilter ? 'active' : ''}" style="background:#888" data-color="clear" title="Clear color filter"></span>
    `;
    colors.forEach(c => {
      html += `<span class="color-dot ${colorFilter === c ? 'active' : ''}" style="background:${c}" data-color="${c}"></span>`;
    });
    html += `</div></div>`;
    menu.innerHTML = html;
    document.body.appendChild(menu);

    // Right-align under the button, clamped so it never runs off-screen
    const rect = menu.getBoundingClientRect();
    let safeX = anchorRect.right - rect.width;
    if (safeX < 4) safeX = 4;
    if (safeX + rect.width > window.innerWidth) {
      safeX = Math.max(4, window.innerWidth - rect.width - 10);
    }
    menu.style.left = safeX + 'px';

    const inputName = menu.querySelector('#filter-input');
    const inputNameClear = menu.querySelector('#filter-input-clear');
    inputName.addEventListener('input', (e) => {
      setFilter(e.target.value);
      inputNameClear.style.display = e.target.value ? '' : 'none';
    });
    inputNameClear.addEventListener('click', () => {
      inputName.value = '';
      setFilter('');
      inputNameClear.style.display = 'none';
      inputName.focus();
    });

    const inputType = menu.querySelector('#filter-type');
    const inputTypeClear = menu.querySelector('#filter-type-clear');
    inputType.addEventListener('input', (e) => {
      typeFilter = e.target.value.trim();
      inputTypeClear.style.display = e.target.value ? '' : 'none';
      renderView();
    });
    inputTypeClear.addEventListener('click', () => {
      inputType.value = '';
      typeFilter = '';
      inputTypeClear.style.display = 'none';
      renderView();
      inputType.focus();
    });

    menu.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        const c = dot.dataset.color;
        colorFilter = c === 'clear' ? null : c;
        renderView();
        menu.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
      });
    });

    const closeHandler = (e) => { if (!menu.contains(e.target) && !e.target.closest('#btn-filter')) { menu.remove(); document.removeEventListener('mousedown', closeHandler); } };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 10);
  }

  document.getElementById('btn-upload').addEventListener('click', () => document.getElementById('upload-input').click());
  document.querySelectorAll('[data-view]').forEach(btn =>
    btn.addEventListener('click', () => setView(btn.dataset.view))
  );

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
  function parentOf(p) { return p.split(/[\\/]/).slice(0,-1).join('/') || '/'; }
  function fileIcon(item) {
    const tag = tagMap.get(item.path);
    const colorStyle = tag?.color ? `style="color:${tag.color};filter:drop-shadow(0 0 2px ${tag.color}66)"` : '';

    if (item.isDir) return `<span ${colorStyle}>${Drives.icon(item.path, true) || '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-.15em"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'}</span>`;
    const ext = (item.ext || '').toLowerCase();
    let icon = '📄';
    if (['.jpg','.jpeg','.png','.gif','.webp','.svg','.avif','.bmp','.ico','.tiff','.tif','.heic','.heif','.dng','.cr2','.cr3','.nef','.arw','.raf','.orf','.rw2'].includes(ext)) icon = '🖼';
    else if (['.mp4','.webm','.mov','.avi','.mkv','.m4v','.3gp','.flv','.ogv'].includes(ext)) icon = '🎬';
    else if (['.mp3','.ogg','.wav','.flac','.aac','.m4a','.m4b','.opus'].includes(ext)) icon = '🎵';
    else if (ext === '.pdf') icon = '📕';
    else if (['.zip','.rar','.7z','.tar','.gz'].includes(ext)) icon = '🗜';
    else if (['.js','.ts','.py','.rb','.go','.rs'].includes(ext)) icon = '📝';
    else if (['.exe','.msi','.bat','.cmd','.sh'].includes(ext)) icon = '⚙';

    return `<span ${colorStyle}>${icon}</span>`;
  }

  function getTagDot(item) {
    const tag = tagMap.get(item.path);
    if (!tag?.color) return '';
    return `<span class="tag-dot" style="background:${tag.color}"></span>`;
  }
  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function formatSize(b) {
    if (!b) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b/1048576).toFixed(1) + ' MB';
    return (b/1073741824).toFixed(1) + ' GB';
  }

  setView(view);

  // Intercept browser back/forward to drive app navigation
  window.history.replaceState({ de_idx: -1 }, '');
  window.addEventListener('popstate', (e) => {
    const idx = e.state?.de_idx ?? -1;
    if (idx < 0 || idx >= history.length) return;
    historyIdx = idx;
    _go(history[idx]);
  });

  return { navigate, refresh, renderInPane, navigateFocused, openInSplit, setFocusToPrimary, showContextMenu, selectOnly, addNavListener, getCurrentPath, setFilter, setColorFilter, setMosaicCols, showRtcLaunchModal };
})();
