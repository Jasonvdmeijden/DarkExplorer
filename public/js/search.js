/* Search — filename fuzzy + content search UI */
const Search = (() => {
  let panel = null;
  let visible = false;

  function init() {
    panel = document.createElement('div');
    panel.id = 'search-panel';
    panel.style.cssText = `
      position:absolute; top:44px; left:50%; transform:translateX(-50%);
      width:min(640px,90vw); background:var(--bg-surface);
      border:1px solid var(--border); border-radius:var(--radius-lg);
      box-shadow:var(--shadow); z-index:200; display:none;
      flex-direction:column; overflow:hidden;
    `;
    panel.innerHTML = `
      <div style="display:flex;align-items:center;border-bottom:1px solid var(--border);padding:.5rem .75rem;gap:.5rem">
        <select id="search-mode" style="background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);border-radius:var(--radius-sm);padding:.25rem .4rem;font-size:.8rem">
          <option value="filename">Filename</option>
          <option value="content">Content</option>
        </select>
        <input id="search-term" type="text" placeholder="Search…" autocomplete="off"
          style="flex:1;background:none;border:none;outline:none;color:var(--text-primary);font-size:.9rem">
        <button id="search-close" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px">✕</button>
      </div>
      <div id="search-filters" style="display:flex;padding:.4rem .75rem;border-bottom:1px solid var(--border);gap:.4rem;flex-wrap:wrap;align-items:center">
        <input id="search-include" placeholder="Include (*.ts, src/**)" style="flex:1;min-width:120px;background:var(--bg-base);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.25rem .5rem;color:var(--text-primary);font-size:.78rem;outline:none">
        <input id="search-exclude" placeholder="Exclude (node_modules)" style="flex:1;min-width:120px;background:var(--bg-base);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.25rem .5rem;color:var(--text-primary);font-size:.78rem;outline:none">
        <label style="display:flex;align-items:center;gap:.3rem;font-size:.78rem;color:var(--text-secondary)">
          <input type="checkbox" id="search-regex"> Regex
        </label>
      </div>
      <div id="search-results" style="overflow-y:auto;max-height:400px;padding:.3rem 0"></div>
      <div id="search-status" style="padding:.3rem .75rem;font-size:.75rem;color:var(--text-muted);border-top:1px solid var(--border)"></div>
    `;
    document.body.appendChild(panel);

    document.getElementById('search-term').addEventListener('input', debounce(run, 600));
    document.getElementById('search-close').addEventListener('click', hide);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && visible) hide(); });
    
    // Close on click outside
    document.addEventListener('mousedown', e => {
      if (visible && panel && !panel.contains(e.target) && !e.target.closest('#btn-search')) {
        hide();
      }
    });
  }

  function show() {
    visible = true;
    panel.style.display = 'flex';
    document.getElementById('search-term').focus();
  }

  function hide() {
    visible = false;
    panel.style.display = 'none';
  }

  function showFromPath(scopePath) {
    document.getElementById('search-include').value = scopePath.replace(/\\/g, '/') + '/**';
    document.getElementById('search-mode').value = 'content';
    show();
  }

  async function run() {
    const term    = document.getElementById('search-term').value.trim();
    const mode    = document.getElementById('search-mode').value;
    const results = document.getElementById('search-results');
    const status  = document.getElementById('search-status');

    if (!term) { results.innerHTML = ''; status.textContent = ''; return; }

    results.innerHTML = '<div class="search-loader"><span class="search-spin"></span>Searching…</div>';
    status.textContent = '';

    try {
      if (mode === 'filename') {
        const res = await WS.send('search:filename', { query: term, limit: 200 });
        const filtered = applyPathFilters(res.results);
        const apps = matchApps(term);
        renderFilenameResults(filtered, apps);
        const total = filtered.length + apps.length;
        status.textContent = `${total} result${total !== 1 ? 's' : ''}`;
      } else {
        const include = getFilterList('search-include');
        const exclude = getFilterList('search-exclude');
        const isRegex = document.getElementById('search-regex').checked;
        const res = await WS.send('search:content', { term, isRegex, includes: include, excludes: exclude });
        if (res.error) { status.textContent = res.error; return; }
        renderContentResults(res.results);
        status.textContent = `${res.total} match${res.total !== 1 ? 'es' : ''}`;
      }
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
    }
  }

  function getFilterList(id) {
    return document.getElementById(id).value.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Client-side path filter for filename results (server doesn't support include/exclude for filename search)
  function applyPathFilters(items) {
    const include = getFilterList('search-include');
    const exclude = getFilterList('search-exclude');
    let out = items;
    if (include.length) out = out.filter(i => include.some(p => matchGlob(i.path, p)));
    if (exclude.length) out = out.filter(i => !exclude.some(p => matchGlob(i.path, p)));
    return out;
  }

  function matchGlob(str, pattern) {
    const s = str.replace(/\\/g, '/').toLowerCase();
    const p = pattern.replace(/\\/g, '/').toLowerCase()
      .replace(/[.+^${}()|[\]]/g, '\\$&')
      .replace(/\*\*/g, '\x00')
      .replace(/\*/g, '[^/]*')
      .replace(/\x00/g, '.*');
    try { return new RegExp(p).test(s); }
    catch { return s.includes(pattern.toLowerCase()); }
  }

  // PC apps/games (Apollo apps, Steam, Xbox, system shortcuts) so "filename"
  // search can surface things you'd launch, not just files on disk.
  function getAllApps() {
    if (typeof StreamView === 'undefined') return [];
    return [
      StreamView.getApolloApps  ? StreamView.getApolloApps()  : [],
      StreamView.getSteamGames ? StreamView.getSteamGames() : [],
      StreamView.getXboxGames  ? StreamView.getXboxGames()  : [],
      StreamView.getSystemApps ? StreamView.getSystemApps() : [],
    ].flat();
  }

  function matchApps(term) {
    const t = term.toLowerCase();
    return getAllApps().filter(a => (a.name || '').toLowerCase().includes(t));
  }

  function makeGroupHeader(label) {
    const header = document.createElement('div');
    header.className = 'group-header';
    header.textContent = label;
    return header;
  }

  function renderFilenameResults(items, apps = []) {
    const results = document.getElementById('search-results');
    results.innerHTML = '';

    if (apps.length) {
      results.appendChild(makeGroupHeader(`Apps (${apps.length})`));
      apps.forEach(app => results.appendChild(makeAppResultRow(app)));
    }

    if (items.length) {
      results.appendChild(makeGroupHeader(`Files (${items.length})`));
      items.forEach(item => {
        const el = document.createElement('div');
        el.style.cssText = 'padding:.3rem .75rem;cursor:pointer;font-size:.82rem;display:flex;align-items:center;gap:.5rem';
        el.innerHTML = `<span style="color:var(--text-muted)">${fileIcon(item)}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(item.name)}</span>
          <span style="color:var(--text-muted);font-size:.72rem;flex-shrink:0">${shortPath(item.path)}</span>`;
        el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-hover)');
        el.addEventListener('mouseleave', () => el.style.background = '');
        el.addEventListener('click', () => {
          hide();
          const dest = item.isDir ? item.path : parentPath(item.path);
          Explorer.navigate(dest);
        });
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          Explorer.showContextMenu(e.clientX, e.clientY, item);
        });
        results.appendChild(el);
      });
    }
  }

  function makeAppResultRow(app) {
    const el = document.createElement('div');
    el.style.cssText = 'padding:.3rem .75rem;cursor:pointer;font-size:.82rem;display:flex;align-items:center;gap:.5rem';

    const iconSpan = document.createElement('span');
    iconSpan.style.color = 'var(--text-muted)';
    if (app.image) {
      const img = document.createElement('img');
      img.src = app.image;
      img.style.cssText = 'width:1em;height:1em;border-radius:3px;object-fit:cover;vertical-align:-.15em';
      img.addEventListener('error', () => { img.replaceWith(document.createTextNode('🎮')); }, { once: true });
      iconSpan.appendChild(img);
    } else {
      iconSpan.textContent = '🎮';
    }

    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    nameSpan.textContent = app.name;

    el.appendChild(iconSpan);
    el.appendChild(nameSpan);
    el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-hover)');
    el.addEventListener('mouseleave', () => el.style.background = '');
    el.addEventListener('click', () => {
      hide();
      if (typeof StreamView !== 'undefined') StreamView.launchApp(app);
    });
    return el;
  }

  function renderContentResults(items) {
    const results = document.getElementById('search-results');
    results.innerHTML = '';
    let lastFile = null;
    items.forEach(item => {
      if (item.path !== lastFile) {
        lastFile = item.path;
        const header = document.createElement('div');
        header.style.cssText = 'padding:.3rem .75rem .1rem;font-size:.78rem;color:var(--accent);font-weight:600;cursor:pointer';
        header.textContent = item.path;
        header.addEventListener('click', () => { hide(); Explorer.navigate(parentPath(item.path)); });
        header.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // For content search, we need to synthesize a file object for the context menu
          const fileObj = {
            path: item.path,
            name: item.path.split(/[\\/]/).pop(),
            isDir: false,
            ext: '.' + item.path.split('.').pop()
          };
          Explorer.showContextMenu(e.clientX, e.clientY, fileObj);
        });
        results.appendChild(header);
      }
      const el = document.createElement('div');
      el.style.cssText = 'padding:.15rem .75rem .15rem 1.5rem;cursor:pointer;font-size:.78rem;font-family:var(--font-mono);display:flex;gap:.6rem';
      el.innerHTML = `<span style="color:var(--text-muted);flex-shrink:0">${item.line}</span>
        <span style="color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(item.text)}</span>`;
      el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-hover)');
      el.addEventListener('mouseleave', () => el.style.background = '');
      el.addEventListener('click', () => {
        hide();
        Explorer.navigate(parentPath(item.path));
        // Small delay to ensure navigation completes before preview
        setTimeout(() => {
          Preview.open({ path: item.path, name: item.path.split(/[\\/]/).pop(), isDir: false });
        }, 100);
      });
      results.appendChild(el);
    });
  }

  function fileIcon(item) { return item.isDir ? (Drives.icon(item.path, true) || '📁') : '📄'; }
  function shortPath(p)   { const parts = p.split(/[\\/]/); return parts.slice(-3, -1).join('/'); }
  function parentPath(p)  { return p.split(/[\\/]/).slice(0, -1).join('/') || '/'; }
  function escHtml(s)     { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // Wire toolbar search button + Ctrl+F
  document.getElementById('btn-search').addEventListener('click', show);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); show(); }
  });

  init();
  return { show, hide, showFromPath };
})();
