/* Disk Analyser — DaisyDisk-style sunburst rendered as one of the explorer views.
 *
 * Public API:
 *   DiskAnalyzer.render(container, rootPath)   → fills `container` with the
 *      sunburst + list for the recursive contents of `rootPath`. Re-rendering
 *      with a different path is cheap if the server has it cached.
 *   DiskAnalyzer.refresh()                     → force a re-scan of the current root
 *
 * The view is rooted at whatever folder the explorer is currently navigated to.
 * Tree-panel navigation re-runs render() automatically because explorer.js
 * calls renderView() on every folder change.
 */
const DiskAnalyzer = (() => {
  // Curated palette that reads well on both light and dark themes
  const PALETTE = [
    '#4f8ff7', '#f06595', '#ff8e3c', '#ffd43b',
    '#51cf66', '#22b8cf', '#9775fa', '#ff6b6b',
    '#94d82d', '#fcc2d7', '#69db7c', '#3bc9db'
  ];

  let _currentContainer = null;
  let _currentRoot      = null;   // root node from server
  let _currentRootPath  = null;   // path string
  let _statusEl         = null;
  let _refreshing       = false;

  // Listen for progress events as long as one render is active
  WS.on('disk:progress', (d) => {
    if (_statusEl && d?.current) {
      _statusEl.textContent = `Scanning… ${d.scanned ? d.scanned + ' files · ' : ''}${_shortPath(d.current)}`;
    }
  });

  function _shortPath(p) {
    if (!p) return '';
    if (p.length <= 60) return p;
    return '…' + p.slice(-58);
  }

  function _formatSize(b) {
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    if (b < 1099511627776) return (b / 1073741824).toFixed(2) + ' GB';
    return (b / 1099511627776).toFixed(2) + ' TB';
  }

  function _formatAge(ms) {
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60)   return 'just now';
    if (s < 3600) return Math.floor(s/60) + ' min ago';
    if (s < 86400) return Math.floor(s/3600) + ' h ago';
    return Math.floor(s/86400) + ' d ago';
  }

  function _linkParents(node, parent = null) {
    node.parent = parent;
    if (node.children) node.children.forEach(c => _linkParents(c, node));
  }

  function _assignColors(node, color) {
    node.color = color;
    if (node.children) node.children.forEach((c, i) => {
      const childColor = node === _currentRoot ? PALETTE[i % PALETTE.length] : color;
      _assignColors(c, childColor);
    });
  }

  async function render(container, rootPath) {
    _currentContainer = container;
    _currentRootPath  = rootPath;

    container.innerHTML = `
      <div class="disk-view">
        <div class="disk-header">
          <div class="disk-info">
            <span class="disk-title">Disk Usage</span>
            <span class="disk-subtitle" id="disk-path-label">${_escape(rootPath || 'Home')}</span>
          </div>
          <div class="disk-actions">
            <span id="disk-status" class="disk-status"></span>
            <button class="icon-btn" id="disk-refresh" title="Force rescan">↻ Rescan</button>
          </div>
        </div>
        <div class="disk-body">
          <div class="disk-svg-container">
            <svg id="disk-svg" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid meet">
              <g id="disk-arcs"></g>
              <circle id="disk-center" cx="300" cy="300" r="78"></circle>
              <text id="disk-center-text" x="300" y="300" text-anchor="middle" dominant-baseline="middle"></text>
            </svg>
          </div>
          <aside class="disk-list-container">
            <div class="disk-list-header">
              <div class="disk-list-title" id="disk-list-title"></div>
              <div class="disk-list-size"  id="disk-list-size"></div>
              <div class="disk-list-meta"  id="disk-list-meta"></div>
            </div>
            <div id="disk-list" class="disk-list"></div>
          </aside>
        </div>
      </div>`;

    _statusEl = container.querySelector('#disk-status');
    container.querySelector('#disk-refresh').addEventListener('click', refresh);

    await _doScan(false);
  }

  async function refresh() {
    if (_refreshing) return;
    await _doScan(true);
  }

  async function _doScan(forceRefresh) {
    if (!_currentContainer || !_currentRootPath) return;
    _refreshing = true;

    const listEl  = _currentContainer.querySelector('#disk-list');
    const titleEl = _currentContainer.querySelector('#disk-list-title');
    const sizeEl  = _currentContainer.querySelector('#disk-list-size');
    const metaEl  = _currentContainer.querySelector('#disk-list-meta');
    const arcsEl  = _currentContainer.querySelector('#disk-arcs');
    const centerText = _currentContainer.querySelector('#disk-center-text');

    if (arcsEl) arcsEl.innerHTML = '';
    listEl.innerHTML = '<div class="disk-loading">Crawling…</div>';
    titleEl.textContent = _currentRootPath.split(/[\\/]/).pop() || _currentRootPath;
    sizeEl.textContent  = '—';
    metaEl.textContent  = '';
    centerText.innerHTML = `<tspan x="300" dy="0" class="disk-center-status">Scanning…</tspan>`;

    try {
      const tree = await WS.send('disk:scan', { path: _currentRootPath, refresh: !!forceRefresh });
      _currentRoot = tree;
      _linkParents(_currentRoot);
      _assignColors(_currentRoot, 'var(--accent)');
      _statusEl.textContent = '';
      _renderSunburst(_currentRoot);
      _renderList(_currentRoot);
      _renderMeta(tree);
    } catch (e) {
      listEl.innerHTML = `<div class="disk-error">Scan failed: ${_escape(e.message || String(e))}</div>`;
      centerText.innerHTML = `<tspan x="300" dy="0" class="disk-center-status">Error</tspan>`;
    } finally {
      _refreshing = false;
    }
  }

  function _renderMeta(tree) {
    if (!_currentContainer) return;
    const metaEl = _currentContainer.querySelector('#disk-list-meta');
    if (!metaEl) return;
    const cached = tree._cached;
    const fileCount = tree._fileCount || 0;
    const scannedAt = tree._scannedAt;
    metaEl.textContent = `${fileCount.toLocaleString()} files · ${cached ? 'cached ' + _formatAge(scannedAt) : 'just scanned'}`;
  }

  // ── Sunburst rendering ────────────────────────────────────────────
  function _polar(cx, cy, r, deg) {
    const rad = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function _arcPath(cx, cy, rIn, rOut, startA, endA) {
    if (endA - startA >= 360) endA = startA + 359.99;
    const s = _polar(cx, cy, rOut, endA);
    const e = _polar(cx, cy, rOut, startA);
    const s2 = _polar(cx, cy, rIn, endA);
    const e2 = _polar(cx, cy, rIn, startA);
    const large = endA - startA <= 180 ? '0' : '1';
    return [
      'M', s.x, s.y,
      'A', rOut, rOut, 0, large, 0, e.x, e.y,
      'L', e2.x, e2.y,
      'A', rIn, rIn, 0, large, 1, s2.x, s2.y,
      'Z'
    ].join(' ');
  }

  function _renderSunburst(node) {
    const arcs = _currentContainer.querySelector('#disk-arcs');
    const centerText = _currentContainer.querySelector('#disk-center-text');
    arcs.innerHTML = '';

    centerText.innerHTML = `
      <tspan x="300" dy="-10" class="disk-center-size">${_escape(_formatSize(node.size))}</tspan>
      <tspan x="300" dy="26"   class="disk-center-label">${_escape(node.name || 'Total')}</tspan>`;

    const MAX_DEPTH   = 5;
    const RADIUS_STEP = 38;
    const CENTER_R    = 80;

    if (!node.children || !node.children.length) return;

    // Sort once so consistent ordering
    node.children.sort((a, b) => b.size - a.size);

    function layout(n, startA, endA, depth) {
      const sweep = endA - startA;
      if (sweep < 0.15) return; // too thin to render
      if (depth > 0 && depth <= MAX_DEPTH) {
        const rIn  = CENTER_R + (depth - 1) * RADIUS_STEP;
        const rOut = rIn + RADIUS_STEP - 2;  // visible gap between rings
        // tiny gap between sibling slices
        const gap = Math.min(0.5, sweep * 0.04);
        const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        arc.setAttribute('d', _arcPath(300, 300, rIn, rOut, startA, endA - gap));
        const opacity = n.isGroup ? 0.25 : Math.max(0.45, 1 - (depth - 1) * 0.13);
        arc.setAttribute('fill', n.color || 'var(--accent)');
        arc.setAttribute('opacity', opacity.toString());
        arc.setAttribute('class', 'disk-arc' + (n.isGroup ? ' is-group' : ''));
        arc.dataset.path = n.path;
        if (n.isDir && !n.isGroup) {
          arc.style.cursor = 'pointer';
          arc.addEventListener('click', () => _navigateTo(n));
        }
        arc.addEventListener('mouseenter', () => _hoverHighlight(n, true));
        arc.addEventListener('mouseleave', () => _hoverHighlight(n, false));
        arcs.appendChild(arc);
      }
      if (n.children && depth < MAX_DEPTH) {
        let cur = startA;
        for (const c of n.children) {
          const childSweep = (c.size / (n.size || 1)) * sweep;
          layout(c, cur, cur + childSweep, depth + 1);
          cur += childSweep;
        }
      }
    }
    layout(node, 0, 360, 0);
  }

  function _hoverHighlight(n, on) {
    const arc = _currentContainer?.querySelector(`.disk-arc[data-path="${CSS.escape(n.path)}"]`);
    const row = _currentContainer?.querySelector(`.disk-row[data-path="${CSS.escape(n.path)}"]`);
    if (arc) arc.classList.toggle('arc-hover', on);
    if (row) row.classList.toggle('row-hover', on);
  }

  // ── List rendering ────────────────────────────────────────────────
  function _renderList(node) {
    const listEl = _currentContainer.querySelector('#disk-list');
    const titleEl = _currentContainer.querySelector('#disk-list-title');
    const sizeEl  = _currentContainer.querySelector('#disk-list-size');

    titleEl.textContent = node.name || _currentRootPath;
    sizeEl.textContent  = _formatSize(node.size);

    listEl.innerHTML = '';
    if (!node.children || !node.children.length) {
      listEl.innerHTML = '<div class="disk-empty">No files in this folder</div>';
      return;
    }
    const total = node.size || 1;
    for (const c of node.children) {
      const pct = Math.min(100, (c.size / total) * 100);
      const row = document.createElement('div');
      row.className = 'disk-row' + (c.isGroup ? ' is-group' : '');
      row.dataset.path = c.path;
      row.innerHTML = `
        <span class="disk-row-bar" style="width:${pct.toFixed(2)}%;background:${c.color || 'var(--accent)'};"></span>
        <span class="disk-row-dot" style="background:${c.color || 'var(--accent)'};opacity:${c.isGroup ? 0.4 : 1}"></span>
        <span class="disk-row-icon">${c.isDir ? (c.isGroup ? '…' : '📁') : '📄'}</span>
        <span class="disk-row-name" title="${_escape(c.path)}">${_escape(c.name)}</span>
        <span class="disk-row-pct">${pct.toFixed(1)}%</span>
        <span class="disk-row-size">${_formatSize(c.size)}</span>`;

      if (!c.isGroup) {
        row.addEventListener('click', () => {
          if (c.isDir) _navigateTo(c);
          else _previewFile(c);
        });
      }
      row.addEventListener('mouseenter', () => _hoverHighlight(c, true));
      row.addEventListener('mouseleave', () => _hoverHighlight(c, false));
      listEl.appendChild(row);
    }
  }

  function _navigateTo(n) {
    // Defer to the explorer — it will re-call render() because disk is the active view
    if (n.isDir && n.path && window.Explorer) {
      Explorer.navigate(n.path);
    }
  }

  async function _previewFile(n) {
    if (!window.Preview) return;
    try {
      const stat = await WS.send('fs:stat', { path: n.path });
      Preview.open(stat || { name: n.name, path: n.path, isDir: false }, []);
    } catch {
      Preview.open({ name: n.name, path: n.path, isDir: false }, []);
    }
  }

  function _escape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { render, refresh };
})();
