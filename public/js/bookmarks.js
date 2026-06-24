/* Bookmarks panel — supports both filesystem paths and web URLs */
const Bookmarks = (() => {
  const panel = document.getElementById('bookmarks-panel');
  const SVG_GLOBE = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-.15em"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;

  async function load() {
    try {
      if (typeof StreamView !== 'undefined') StreamView.fetchApps();
      const items = await WS.send('bookmark:list');
      render(Array.isArray(items) ? items : []);
    } catch (e) {
      console.error('[bookmarks] load failed:', e);
    }
  }

  function render(items) {
    const list = panel.querySelector('#bookmark-list');
    const headerCount = document.getElementById('bm-header-bookmarks')?.querySelector('.git-section-count');
    if (headerCount) headerCount.textContent = items.length;
    
    if (!list) return;
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<p style="padding:.6rem .75rem;font-size:.8rem;color:var(--text-muted)">No bookmarks yet.<br>Right-click a folder or file to add one,<br>or paste a path/URL above.</p>';
      refreshApps();
      return;
    }
    items.forEach(b => {
      const isUrl = !!b.url;
      const isDir = isUrl ? false : (b.isDir !== false);   // default to folder if not annotated
      
      let iconHTML = '';
      let isFavicon = false;
      if (isUrl) {
        try {
          const hostname = new URL(b.url).hostname;
          iconHTML = `<img src="https://www.google.com/s2/favicons?domain=${hostname}&sz=32" style="width:1.2em;height:1.2em;border-radius:4px;object-fit:cover;vertical-align:-.2em">`;
          isFavicon = true;
        } catch {
          iconHTML = SVG_GLOBE;
        }
      } else {
        iconHTML = isDir ? (Drives.icon(b.path, true) || '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-.15em"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>') : '📄';
      }

      const el = document.createElement('div');
      el.className = 'bookmark-item';
      el.innerHTML = `<span>${iconHTML}</span>
        <span class="bookmark-label">${escHtml(b.label || b.path || b.url)}</span>
        <button class="bookmark-remove icon-btn" title="Remove">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>`;
      // Inline onerror= HTML attributes can't safely hold markup that itself
      // contains quotes (the SVG fallback's own attribute quotes terminate the
      // onerror="..." attribute early and corrupt the DOM) — wire the fallback
      // up as a real event listener instead.
      if (isFavicon) {
        const img = el.querySelector('img');
        if (img) img.addEventListener('error', () => { img.outerHTML = SVG_GLOBE; }, { once: true });
      }
      el.addEventListener('click', async (e) => {
        if (e.target.classList.contains('bookmark-remove')) {
          remove(b.id);
          return;
        }
        if (isUrl) {
          Preview.open({ name: b.label || b.url, url: b.url, isDir: false, path: null });
          return;
        }
        if (isDir) {
          Explorer.navigate(b.path);
          return;
        }
        
        const ext = b.path.split('.').pop().toLowerCase();
        const EXEC_EXTS = ['exe','msi','bat','cmd','com','ps1','sh','app'];
        if (EXEC_EXTS.includes(ext)) {
            if (typeof StreamView !== 'undefined') {
                StreamView.launchApp({ name: b.label || b.path.split(/[\\/]/).pop(), path: b.path });
            } else {
                WS.send('fs:exec', { path: b.path });
            }
            return;
        }

        // File bookmark — navigate to its parent folder, then open it in preview
        const parent = b.path.replace(/[\\/][^\\/]+$/, '');
        try {
          await Explorer.navigate(parent || b.path);
          const siblings = await WS.send('fs:list', { path: parent });
          const file = (Array.isArray(siblings) ? siblings.find(s => s.path === b.path) : null)
                        || { name: b.label || b.path.split(/[\\/]/).pop(), path: b.path, isDir: false };
          Preview.open(file, Array.isArray(siblings) ? siblings : [file]);
        } catch {
          Preview.open({ name: b.label || b.path.split(/[\\/]/).pop(), path: b.path, isDir: false },
                       [{ name: b.label || b.path.split(/[\\/]/).pop(), path: b.path, isDir: false }]);
        }
      });
      // Folder path bookmarks: middle-click / triple-tap → open in new tab
      if (!isUrl && isDir && b.path) {
        Tabs.attachOpenInNewTab(el, () => ({ name: b.label || b.path.split(/[\\/]/).pop(), path: b.path, isDir: true }));
      }
      list.appendChild(el);
    });
    refreshApps();
  }

  function refreshApps() {
    const appsList = panel.querySelector('#bookmark-apps-list');
    if (appsList) {
      appsList.innerHTML = '';
      const pcApps = (typeof StreamView !== 'undefined' && StreamView.getSystemApps) ? StreamView.getSystemApps() : [];
      const blackholeApps = (typeof StreamView !== 'undefined' && StreamView.getBlackholeApps) ? StreamView.getBlackholeApps() : [];
      const steam = (typeof StreamView !== 'undefined') ? StreamView.getSteamGames() : [];
      const xbox = (typeof StreamView !== 'undefined') ? StreamView.getXboxGames() : [];
      if (pcApps.length) appsList.appendChild(makeSubSection('Blackhole Apps', pcApps, pcApps.length, false));
      if (steam.length) appsList.appendChild(makeSubSection('Steam', steam, steam.length, false));
      if (xbox.length) appsList.appendChild(makeSubSection('Xbox', xbox, xbox.length, false));
      if (blackholeApps.length) appsList.appendChild(makeSubSection('PC Applications', blackholeApps, blackholeApps.length, true));
    }
    applyQuickFilter(quickSearchInput.value);
  }

  function makeAppRow(item) {
    const row = document.createElement('div');
    row.className = 'bookmark-item';
    row.title = item.name;
    row.innerHTML = `
      <span><img src="${item.image || ''}" style="width:1.2em;height:1.2em;border-radius:4px;object-fit:cover;vertical-align:-.2em"></span>
      <span class="bookmark-label">${item.name}</span>
    `;
    const appIcon = row.querySelector('img');
    if (appIcon) appIcon.addEventListener('error', () => { appIcon.outerHTML = SVG_GLOBE; }, { once: true });
    row.addEventListener('click', () => {
      if (typeof StreamView !== 'undefined') StreamView.launchApp(item);
    });
    return row;
  }

  function makeSubSection(title, items, count, defaultCollapsed) {
    const section = document.createElement('div');
    section.className = 'git-section';
    const header = document.createElement('div');
    header.className = 'git-section-header';
    let collapsed = defaultCollapsed;
    header.innerHTML = `<span class="git-section-arrow">${collapsed ? '▸' : '▾'}</span> ${title} <span class="git-section-count">${count}</span>`;
    const body = document.createElement('div');
    body.className = 'git-section-body';
    body.style.display = collapsed ? 'none' : '';
    let rendered = false;
    const renderItems = () => {
      if (rendered) return;
      if (items.length === 0) {
        body.innerHTML = '<div style="padding:.6rem 1rem;color:var(--text-muted);font-size:.78rem">Nothing here yet.</div>';
      } else {
        items.forEach((item) => body.appendChild(makeAppRow(item)));
      }
      rendered = true;
    };

    if (!collapsed) renderItems();

    header.addEventListener('click', () => {
      collapsed = !collapsed;
      if (!collapsed) renderItems();
      body.style.display = collapsed ? 'none' : '';
      header.querySelector('.git-section-arrow').textContent = collapsed ? '▸' : '▾';
    });
    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  async function add(pathVal, label) {
    await WS.send('bookmark:add', { path: pathVal, label });
    await load();
  }

  async function addUrl(urlVal, label) {
    if (!urlVal) return;
    if (!/^https?:\/\//i.test(urlVal)) urlVal = 'https://' + urlVal;
    await WS.send('bookmark:add', { url: urlVal, label: label || urlVal });
    await load();
  }

  async function remove(id) {
    await WS.send('bookmark:remove', { id });
    await load();
  }

  function setStatus(msg, isErr) {
    const el = panel.querySelector('#bm-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isErr ? 'var(--danger)' : 'var(--accent)';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; }, 2500);
  }

  function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Build panel structure
  panel.innerHTML = `
    <div class="bookmark-add-bar" style="border-bottom: none; min-height: 40px; padding: 0.5rem 0.75rem 0; gap: 0.5rem;">
      <div class="input-clear-wrap" style="flex:1; min-width:0;">
        <input id="bookmark-quick-search" type="text" placeholder="Filter…" spellcheck="false" style="padding-right:1.6rem;">
        <button class="input-clear-btn" id="bookmark-quick-search-clear" title="Clear" style="display:none;">&times;</button>
      </div>
      <button id="btn-add-url-bm" class="icon-btn" title="Add Bookmark" style="flex-shrink:0; width: auto; padding: 0 0.8rem; border-radius: 6px; font-weight: 600; font-size: 0.8rem;">
         <span style="margin-right: 0.3rem;">+</span> Add
      </button>
    </div>
    <span id="bm-status" style="font-size:.74rem;padding:.1rem .75rem;min-height:1.1rem;display:block;color:var(--accent);"></span>
    <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;padding-bottom:1rem;">
      <div class="git-section">
        <div class="git-section-header" id="bm-header-bookmarks">
          <span class="git-section-arrow">▾</span> Bookmarks <span class="git-section-count">0</span>
        </div>
        <div class="git-section-body" id="bookmark-list"></div>
      </div>

      <div class="git-section" style="margin-top:0.5rem;">
        <div class="git-section-header" id="bm-header-favourites">
          <span class="git-section-arrow">▾</span> Frequent Folders <span class="git-section-count">0</span>
        </div>
        <div class="git-section-body" id="favourites-list"></div>
      </div>

      <div id="bookmark-apps-list" style="margin-top: 0.5rem; flex:none"></div>
    </div>`;

  const quickSearchInput = panel.querySelector('#bookmark-quick-search');
  const quickSearchClear = panel.querySelector('#bookmark-quick-search-clear');
  quickSearchInput.addEventListener('input', () => {
    quickSearchClear.style.display = quickSearchInput.value ? '' : 'none';
    applyQuickFilter(quickSearchInput.value);
  });
  quickSearchClear.addEventListener('click', () => {
    quickSearchInput.value = '';
    quickSearchClear.style.display = 'none';
    applyQuickFilter('');
    quickSearchInput.focus();
  });

  function applyQuickFilter(query) {
    const q = query.trim().toLowerCase();
    if (q) {
      // Force-expand any collapsed sections so their items exist in the DOM to search
      panel.querySelectorAll('.git-section-header').forEach(header => {
        const body = header.nextElementSibling;
        if (body && body.style.display === 'none') header.click();
      });
    }
    panel.querySelectorAll('.bookmark-item').forEach(item => {
      const label = (item.querySelector('.bookmark-label')?.textContent || item.title || '').toLowerCase();
      item.style.display = (!q || label.includes(q)) ? '' : 'none';
    });
  }

  // Attach expand/collapse behavior for the two new sections
  ['bookmarks', 'favourites'].forEach(id => {
    const header = document.getElementById(`bm-header-${id}`);
    const body = document.getElementById(id === 'bookmarks' ? 'bookmark-list' : 'favourites-list');
    header.addEventListener('click', () => {
      const isCollapsed = body.style.display === 'none';
      body.style.display = isCollapsed ? '' : 'none';
      header.querySelector('.git-section-arrow').textContent = isCollapsed ? '▾' : '▸';
    });
  });

  document.getElementById('btn-add-url-bm').addEventListener('click', () => {
    const modal = document.createElement('div');
    modal.className = 'app-settings-modal open';
    modal.innerHTML = `
      <div class="app-settings-box" style="width: 400px; max-width: 90vw; height: auto;">
        <div class="app-settings-header">
          <h2>Add Bookmark</h2>
          <button class="app-settings-close" title="Close">×</button>
        </div>
        <div class="app-settings-body">
          <label style="display:block;margin-bottom:0.4rem;font-size:0.85rem;color:var(--text-muted);">Name (Optional)</label>
          <input type="text" id="bm-name-input" placeholder="e.g. My Server" style="width:100%;margin-bottom:1.2rem;background:var(--bg-base);border:1px solid var(--border);border-radius:6px;padding:0.6rem;color:var(--text-primary);outline:none;">
          
          <label style="display:block;margin-bottom:0.4rem;font-size:0.85rem;color:var(--text-muted);">URL or File Path</label>
          <input type="text" id="bm-url-input" placeholder="https://example.com or C:\\path\\to\\folder" style="width:100%;margin-bottom:1.5rem;background:var(--bg-base);border:1px solid var(--border);border-radius:6px;padding:0.6rem;color:var(--text-primary);outline:none;">
          
          <div style="display:flex;justify-content:flex-end;gap:0.8rem;">
            <button class="icon-btn bm-cancel-btn" style="padding:0.5rem 1rem;border-radius:6px;border:1px solid var(--border);width:auto;">Cancel</button>
            <button class="icon-btn bm-save-btn" style="padding:0.5rem 1rem;border-radius:6px;background:var(--accent);color:white;border:none;width:auto;font-weight:bold;">Save Bookmark</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    const nameInput = modal.querySelector('#bm-name-input');
    const urlInput = modal.querySelector('#bm-url-input');
    
    const close = () => modal.remove();
    modal.querySelector('.app-settings-close').onclick = close;
    modal.querySelector('.bm-cancel-btn').onclick = close;
    
    const save = async () => {
      const val = urlInput.value.trim();
      if (!val) return;
      const label = nameInput.value.trim() || undefined;
      
      const saveBtn = modal.querySelector('.bm-save-btn');
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.5';
      
      try {
        if (/^([A-Za-z]:[\\\/]|\/|\\\\)/.test(val)) {
          await add(val, label);
        } else {
          await addUrl(val, label);
        }
        setStatus('Bookmark added');
        close();
      } catch(e) {
        alert(e.message || 'Failed to add bookmark');
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
      }
    };
    
    modal.querySelector('.bm-save-btn').onclick = save;
    urlInput.addEventListener('keydown', e => { if(e.key === 'Enter') save(); });
    nameInput.addEventListener('keydown', e => { if(e.key === 'Enter') save(); });
    urlInput.focus();
  });

  load().catch(() => {});
  return { load, add, addUrl, remove, refreshApps, applyQuickFilter: (q) => applyQuickFilter(q ?? quickSearchInput.value) };
})();
