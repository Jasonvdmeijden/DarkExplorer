// stream.js
const StreamView = (function() {
  let container;

  function render(appContainer) {
    container = document.createElement('div');
    container.className = 'stream-view active';
    appContainer.appendChild(container);

    container.innerHTML = `
      <div class="stream-row" id="stream-folder-row" style="display:none;">
        <h2 class="stream-row-title">Current Folder</h2>
        <div class="stream-folder-list" id="stream-folder-list"></div>
      </div>
      <div class="stream-row" id="stream-apps-row">
        <h2 class="stream-row-title">Apollo Apps</h2>
        <div class="stream-carousel" id="stream-apps-carousel">
          <div style="padding: 20px; color: #888;">Scanning applications...</div>
        </div>
      </div>
      <div class="stream-row" id="stream-steam-row">
        <h2 class="stream-row-title">Steam Library</h2>
        <div class="stream-carousel" id="stream-steam-carousel">
          <div style="padding: 20px; color: #888;">Scanning Steam library...</div>
        </div>
      </div>
      <div class="stream-row" id="stream-xbox-row">
        <h2 class="stream-row-title">Xbox Library</h2>
        <div class="stream-carousel" id="stream-xbox-carousel">
          <div style="padding: 20px; color: #888;">Scanning Xbox library...</div>
        </div>
      </div>
      <div class="stream-row" id="stream-apollo-row" style="display:none;">
        <h2 class="stream-row-title">Apollo Apps</h2>
        <div class="stream-carousel" id="stream-apollo-carousel"></div>
      </div>
      <div id="stream-dynamic-groups"></div>`;
    if (cachedSystemApps.length > 0 || cachedApolloApps.length > 0) {
      renderAllCarousels();
    } else {
      fetchApps();
    }
    fetchFolderApps();
  }

  let cachedSystemApps = [];
  let cachedApolloApps = [];
  let cachedSteam = [];
  let cachedXbox = [];
  let cachedFolderApps = [];
  let activeFilter = '';
  let activeSort = 'none';

  function setFilter(text) {
    activeFilter = (text || '').toLowerCase();
    renderAllCarousels();
  }

  function setSort(mode) {
    activeSort = mode || 'none';
    renderAllCarousels();
  }

  // Apps/games runnable from whatever folder is currently selected in the file
  // explorer's tree, so App Mode can launch something without needing it to be
  // in your Favourites or scanned as a Steam/Xbox title first.
  const FOLDER_EXEC_EXTS = ['exe', 'msi', 'bat', 'cmd', 'com', 'ps1', 'sh', 'app'];
  async function fetchFolderApps() {
    const row = document.getElementById('stream-folder-row');
    if (!row) return;
    const path = (typeof Explorer !== 'undefined' && Explorer.getCurrentPath) ? Explorer.getCurrentPath() : null;
    if (!path) { row.style.display = 'none'; return; }
    try {
      const list = await WS.send('fs:list', { path });
      const apps = (Array.isArray(list) ? list : [])
        .filter(item => !item.isDir && FOLDER_EXEC_EXTS.includes((item.ext || '').replace('.', '').toLowerCase()))
        .map(item => {
          const ext = (item.ext || '').replace('.', '').toLowerCase();
          const iconEndpoint = ext === 'app' ? '/stream/icon' : '/stream/icon-win';
          return { name: item.name.replace(/\.[^.]+$/, ''), path: item.path, image: `${iconEndpoint}?path=${encodeURIComponent(item.path)}` };
        });
      cachedFolderApps = apps;
      const row = document.getElementById('stream-folder-row');
      if (row) renderList('stream-folder-row', 'stream-folder-list', apps, false);
    } catch (e) {
      row.style.display = 'none';
    }
  }
  // Registered once at load — re-fetches whenever the explorer navigates, but
  // only does anything if App Mode is the view currently on screen.
  if (typeof Explorer !== 'undefined' && Explorer.addNavListener) {
    Explorer.addNavListener(() => { if (container) fetchFolderApps(); });
  }

  // Is this browser running on the same physical machine as the DarkExplorer
  // server? If so, launching an app should just launch it locally instead of
  // pointlessly starting a remote-desktop RTC session to watch it.
  // A manual override (Settings → App Mode / RTC) always wins, since network-based
  // detection can be fooled by tunnels/proxies that relay everyone through loopback.
  let isLocalClient = null;
  function checkIsLocal() {
    const override = localStorage.getItem('de_local_override') || 'auto';
    if (override === 'local') return Promise.resolve(true);
    if (override === 'remote') return Promise.resolve(false);
    if (isLocalClient !== null) return Promise.resolve(isLocalClient);
    
    const host = window.location.hostname;
    const isLocalHostName = (host === 'localhost' || host === '127.0.0.1' || host === '::1');

    return fetch('/stream/is-local')
      .then(res => res.json())
      .then(d => { 
        // If server thinks we are local, but we are connecting via a public domain
        // (not localhost and not a LAN IP), we are likely coming through a tunnel
        // that masks our IP as loopback. We are remote.
        if (d.isLocal && !isLocalHostName && !host.startsWith('192.168.') && !host.startsWith('10.') && !host.startsWith('172.')) {
          isLocalClient = false;
        } else {
          isLocalClient = !!d.isLocal; 
        }
        return isLocalClient; 
      })
      .catch(() => { isLocalClient = false; return false; });
  }
  checkIsLocal();

  let isFetchingApps = false;
  let hasFetchedApps = false;

  async function fetchApps() {
    if (isFetchingApps || hasFetchedApps) return;
    isFetchingApps = true;
    try {
      const token = localStorage.getItem('de_token') || '';
      const res = await fetch('/stream/scan', { headers: { 'Authorization': 'Bearer ' + token } });
      if (!res.ok) throw new Error('Failed to scan apps');
      const data = await res.json();

      cachedSystemApps = [
        { name: "Remote Desktop", image: "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&q=80&w=400", path: null, appid: null },
        { name: "Xbox", image: "https://images.unsplash.com/photo-1621259182978-fbf93132d53d?auto=format&fit=crop&q=80&w=400", path: null, appid: null },
        { name: "Steam Big Picture", image: "https://upload.wikimedia.org/wikipedia/commons/8/83/Steam_icon_logo.svg", path: null, appid: null }
      ];
      cachedApolloApps = data.apps || [];
      cachedSteam = data.steam || [];
      cachedXbox = data.xbox || [];
      hasFetchedApps = true;
      renderAllCarousels();
    } catch (e) {
      console.error('Stream view fetch error:', e);
    } finally {
      isFetchingApps = false;
    }
  }

  function setupCollapsible(rowId, listId, items, startCollapsed, renderItems) {
    const row = document.getElementById(rowId);
    if (!row) return;
    row.style.display = items.length ? 'block' : 'none';
    if (!items.length) return;

    const titleEl = row.querySelector('.stream-row-title');
    const container = document.getElementById(listId);
    if (!titleEl || !container) return;

    if (!titleEl.dataset.initialized) {
      titleEl.style.cursor = 'pointer';
      titleEl.style.userSelect = 'none';
      const arrow = document.createElement('span');
      arrow.className = 'section-arrow';
      arrow.style.display = 'inline-block';
      arrow.style.width = '24px';
      titleEl.insertBefore(arrow, titleEl.firstChild);
      titleEl.dataset.initialized = 'true';
      titleEl.dataset.collapsed = startCollapsed ? 'true' : 'false';
      titleEl.dataset.rendered = 'false';

      titleEl.onclick = () => {
        const isNowCollapsed = titleEl.dataset.collapsed === 'false';
        titleEl.dataset.collapsed = isNowCollapsed ? 'true' : 'false';
        titleEl.querySelector('.section-arrow').textContent = isNowCollapsed ? '▸ ' : '▾ ';
        container.style.display = isNowCollapsed ? 'none' : '';
        if (!isNowCollapsed && titleEl.dataset.rendered === 'false') {
          renderItems(container);
          titleEl.dataset.rendered = 'true';
        }
      };
    }

    const collapsed = titleEl.dataset.collapsed === 'true';
    titleEl.querySelector('.section-arrow').textContent = collapsed ? '▸ ' : '▾ ';
    container.style.display = collapsed ? 'none' : '';

    titleEl.dataset.rendered = 'false';
    container.innerHTML = '';
    if (!collapsed) {
      renderItems(container);
      titleEl.dataset.rendered = 'true';
    }
  }

  function sortItems(items) {
    if (activeSort === 'none') return items;
    // We mainly have 'name' for apps. Other sorts like date/size might not exist on these objects, fallback to name.
    return items.slice().sort((a,b) => a.name.localeCompare(b.name));
  }

  function getGroupValue(item) {
    if (activeSort === 'name') return (item.name[0] || '?').toUpperCase();
    if (activeSort === 'app' || activeSort === 'ext') {
      if (item.appid) return 'Steam Game';
      if (item.image && item.image.includes('unsplash')) return 'Xbox Game'; // Best guess for xbox
      return 'Application';
    }
    // Fallback
    return 'Apps';
  }

  function renderAllCarousels() {
    const isGrouping = activeSort !== 'none' && activeSort !== '';
    const dynContainer = document.getElementById('stream-dynamic-groups');
    if (dynContainer) dynContainer.innerHTML = '';
    
    if (isGrouping) {
      // Hide all standard rows
      ['stream-apps-row', 'stream-steam-row', 'stream-xbox-row', 'stream-folder-row', 'stream-apollo-row'].forEach(id => {
        const row = document.getElementById(id);
        if (row) row.style.display = 'none';
      });

      // Combine all apps
      let allApps = [].concat(cachedSystemApps, cachedSteam, cachedXbox, cachedApolloApps);
      if (cachedFolderApps) allApps = allApps.concat(cachedFolderApps);

      allApps = filterItems(allApps);
      allApps = sortItems(allApps);

      const groups = {};
      allApps.forEach(item => {
        const val = getGroupValue(item);
        if (!groups[val]) groups[val] = [];
        groups[val].push(item);
      });

      if (dynContainer) {
        Object.keys(groups).sort().forEach((key, idx) => {
           const rowId = 'dyn-row-' + idx;
           const listId = 'dyn-list-' + idx;
           
           const row = document.createElement('div');
           row.className = 'stream-row';
           row.id = rowId;
           row.innerHTML = `<h2 class="stream-row-title">${key}</h2><div class="stream-folder-list" id="${listId}"></div>`;
           dynContainer.appendChild(row);
           
           renderList(rowId, listId, groups[key], false); // false = force expanded
        });
      }

    } else {
      // Normal view (filtering within normal view if activeFilter is set)
      ['stream-apps-row', 'stream-steam-row', 'stream-xbox-row', 'stream-apollo-row'].forEach(id => {
        const row = document.getElementById(id);
        if (row) row.style.display = 'block';
      });

      const isSearching = !!activeFilter;

      const apolloRowTitle = document.querySelector('#stream-apollo-row .stream-row-title');
      if (apolloRowTitle) {
         const textNode = Array.from(apolloRowTitle.childNodes).find(n => n.nodeType === 3);
         if (textNode) textNode.textContent = ' PC Applications';
      }

      renderCarousel('stream-apps-carousel', cachedSystemApps, 'pc', {}, false);
      renderCarousel('stream-steam-carousel', cachedSteam, 'steam', {}, false);
      renderCarousel('stream-xbox-carousel', cachedXbox, 'xbox', {}, false);
      renderCarousel('stream-apollo-carousel', cachedApolloApps, 'pc', {}, !isSearching);
      
      if (cachedFolderApps && cachedFolderApps.length) {
        const row = document.getElementById('stream-folder-row');
        if (row) {
          row.style.display = 'block';
          renderList('stream-folder-row', 'stream-folder-list', cachedFolderApps, false);
        }
      }
    }
    
    if (typeof Bookmarks !== 'undefined') Bookmarks.refreshApps();
  }

  function filterItems(items) {
    if (!activeFilter) return items;
    return items.filter(i => i.name.toLowerCase().includes(activeFilter));
  }

  function renderList(rowId, listId, items, startCollapsed = false) {
    items = filterItems(items);
    setupCollapsible(rowId, listId, items, startCollapsed, (container) => {
      items.forEach(item => {
        const el = document.createElement('div');
        el.className = 'stream-folder-item';
        el.innerHTML = `
          <img src="${item.image || 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=400'}" class="stream-folder-item-img" onerror="this.src='https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=400'">
          <span class="stream-folder-item-name">${item.name}</span>
        `;
        el.onclick = () => launchApp(item);
        container.appendChild(el);
      });
    });
  }

  function renderCarousel(id, items, platform, opts, startCollapsed = false) {
    opts = opts || {};
    items = filterItems(items);
    const rowId = id.replace('-carousel', '-row');
    setupCollapsible(rowId, id, items, startCollapsed, (carousel) => {
      if (items.length === 0) {
        carousel.innerHTML = `<div style="padding:20px;color:#888;">${opts.emptyMessage || 'No games found for this platform.'}</div>`;
        return;
      }
      items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'stream-card';

        const img = document.createElement('img');
        img.className = 'stream-card-img';
        img.src = item.image || 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=400';
        img.onerror = () => { img.src = 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=400'; };

        const meta = document.createElement('div');
        meta.className = 'stream-card-meta';

        const title = document.createElement('div');
        title.className = 'stream-card-title';
        title.textContent = item.name;

        const plat = document.createElement('div');
        plat.className = 'stream-card-platform';
        plat.textContent = platform;

        meta.appendChild(title);
        meta.appendChild(plat);

        card.appendChild(img);
        card.appendChild(meta);

        card.onclick = () => launchApp(item);
        carousel.appendChild(card);
      });
    });
  }

  function renderFolderList(id, items) {
    const container = document.getElementById(id);
    if (!container) return;
    
    // Change class from grid to list container
    container.className = 'stream-folder-list';
    container.innerHTML = '';
    
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'stream-folder-item';
      
      const img = document.createElement('img');
      img.className = 'stream-folder-item-img';
      img.src = item.image || '/assets/default-app.png'; // Assuming fallback or icon fetch returns valid src
      img.onerror = () => { img.src = 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=40'; };

      const name = document.createElement('span');
      name.className = 'stream-folder-item-name';
      name.textContent = item.name;

      row.appendChild(img);
      row.appendChild(name);
      
      row.onclick = () => launchApp(item);
      container.appendChild(row);
    });
  }

  function launchApp(item, skipModal = false) {
    // If skipModal is an Event (like a click event), ignore it
    if (skipModal && typeof skipModal === 'object') {
      skipModal = false;
    }
    
    const isOverride = localStorage.getItem('de_rtc_override') === 'true';

    if (!skipModal && !isOverride) {
      checkIsLocal().then(isLocal => {
        if (isLocal) {
          // Local: just launch the app quietly (it will show the brief overlay)
          actuallyLaunchApp(item, false);
        } else {
          // Remote: show modal
          if (typeof Explorer !== 'undefined' && Explorer.showRtcLaunchModal) {
            Explorer.showRtcLaunchModal(item, () => actuallyLaunchApp(item, true));
          } else {
            actuallyLaunchApp(item, true);
          }
        }
      });
      return;
    }
    
    actuallyLaunchApp(item, true);
  }

  function showCloseConfirm(isPcApp, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'app-settings-modal open';
    modal.style.zIndex = '3000';
    
    let closeAppHtml = '';
    if (isPcApp) {
      closeAppHtml = `
        <div class="settings-toggle-row">
          <div>
            <label for="close-app-toggle">Close App</label>
            <span>Terminate the app on the host PC</span>
          </div>
          <label class="ui-switch">
            <input type="checkbox" id="close-app-toggle" checked>
            <span class="ui-slider"></span>
          </label>
        </div>
      `;
    }

    modal.innerHTML = `
      <div class="app-settings-box" style="width: 400px; max-width: 90vw; height: auto;">
        <div class="app-settings-header">
          <h2>Close Stream</h2>
          <button class="app-settings-close" title="Close">&times;</button>
        </div>
        <div class="app-settings-body">
          ${closeAppHtml}
          <div class="settings-toggle-row">
            <div>
              <label for="close-stream-toggle">Close Stream Connection</label>
              <span>Disconnect this viewer from the host</span>
            </div>
            <label class="ui-switch">
              <input type="checkbox" id="close-stream-toggle" checked>
              <span class="ui-slider"></span>
            </label>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.8rem;margin-top:1.2rem;">
          <button id="btn-cancel-close" class="icon-btn" style="padding:0.5rem 1rem;border-radius:6px;border:1px solid var(--border);width:auto;cursor:pointer;">Cancel</button>
          <button id="btn-confirm-close" class="icon-btn" style="padding:0.5rem 1rem;border-radius:6px;background:var(--accent);color:white;border:none;width:auto;font-weight:bold;cursor:pointer;">Confirm</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const removeModal = () => {
      modal.classList.remove('open');
      setTimeout(() => modal.remove(), 250);
    };

    modal.querySelector('.app-settings-close').onclick = removeModal;
    modal.querySelector('#btn-cancel-close').onclick = removeModal;
    modal.querySelector('#btn-confirm-close').onclick = () => {
      const closeAppEl = modal.querySelector('#close-app-toggle');
      const closeApp = closeAppEl ? closeAppEl.checked : false;
      const closeStream = modal.querySelector('#close-stream-toggle').checked;
      removeModal();
      onConfirm({ closeApp, closeStream });
    };
  }

  // Builds the moonlight-web-stream query string from our own RTC settings
  // tab (settings.js) so quality is configured there instead of via the
  // proxy's own in-stream settings drawer.
  function getRtcQueryParams() {
    const res = localStorage.getItem('de_stream_res') || '1080';
    const videoSize = res === '2160' ? '4k' : res + 'p';
    const fps = localStorage.getItem('de_stream_fps') || '60';
    const bitrateKbps = (parseInt(localStorage.getItem('de_stream_bitrate'), 10) || 30) * 1000;
    const hdr = localStorage.getItem('de_stream_hdr') === 'true';
    return new URLSearchParams({ videoSize, fps, bitrate: String(bitrateKbps), hdr: String(hdr) }).toString();
  }

  // The proxy's own in-stream settings drawer clutters the stream view with a
  // floating arrow button — hide just the trigger, but leave the panel itself
  // intact so it can still be opened via the four-finger-tap gesture below
  // (quality lives in our own RTC settings tab now, but mouse/touch mode and
  // its debug/stats toggles are still only available in that drawer).
  function hideProxySidebarButton(doc) {
    const style = doc.createElement('style');
    style.textContent = '#sidebar-button { display: none !important; }';
    doc.head.appendChild(style);
    // Belt-and-suspenders in case the stylesheet doesn't win the cascade, and
    // in case the proxy's own JS re-creates the button later.
    const forceHide = () => {
      const btn = doc.getElementById('sidebar-button');
      if (btn) btn.style.setProperty('display', 'none', 'important');
    };
    forceHide();
    new MutationObserver(forceHide).observe(doc.body || doc.documentElement, { childList: true, subtree: true });
  }

  function toggleProxySidebarPanel(doc) {
    const root = doc.getElementById('sidebar-root');
    if (root) root.classList.toggle('sidebar-show');
  }

  // ── Client-side on-screen keyboard ──────────────────────────────────────
  // Mirrors the proxy's own ScreenKeyboard trick (a hidden, off-screen
  // textarea whose focus state drives the mobile OS's native virtual
  // keyboard, diffing its value against a sentinel string since mobile
  // browsers don't fire reliable keydown/keyup for IME/autocomplete input) —
  // but hosted in *our* document instead of the iframe's, so the keyboard is
  // the client's, not the stream proxy's, while still feeding keystrokes into
  // the same Moonlight input channel via the iframe's exposed Stream API.
  const KB_SENTINEL = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  let clientKbInput = null;
  // The toolbar/iframe belonging to whichever stream is currently open — the
  // hidden textarea itself is a page-level singleton (created once, reused
  // across stream sessions), so these track "whichever session is live now"
  // for it to read at event time.
  let currentKbToolbar = null;
  let currentKbIframe = null;

  // Same toggle-and-hold modifier model as the terminal panel's mobile
  // modifier bar (terminal.js) — Ctrl/Alt/Shift/Meta stay "held" across
  // keypresses until tapped again, rather than auto-releasing after one key.
  const _streamMods = { ctrl: false, alt: false, shift: false, meta: false };
  function _toggleStreamMod(name, btn) {
    _streamMods[name] = !_streamMods[name];
    btn.classList.toggle('active', _streamMods[name]);
  }
  function _charToCode(ch) {
    if (/^[a-z]$/i.test(ch)) return 'Key' + ch.toUpperCase();
    if (/^[0-9]$/.test(ch)) return 'Digit' + ch;
    return null;
  }

  function resetClientKbValue(el) {
    el.value = KB_SENTINEL;
    el.setSelectionRange(KB_SENTINEL.length, KB_SENTINEL.length);
  }

  function extractClientKbText(el) {
    const value = el.value;
    if (value === KB_SENTINEL) return '';
    if (value.startsWith(KB_SENTINEL)) return value.slice(KB_SENTINEL.length);
    if (value.endsWith(KB_SENTINEL)) return value.slice(0, -KB_SENTINEL.length);
    if (value.includes(KB_SENTINEL)) return value.replace(KB_SENTINEL, '');
    return value;
  }

  // mods, when passed, are applied to the synthetic event (ctrlKey/altKey/
  // shiftKey/metaKey) so the toolbar's held modifiers reach the stream.
  function sendClientKbKey(input, code, mods) {
    const init = mods
      ? { code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta }
      : { code };
    input.onKeyDown(new KeyboardEvent('keydown', init));
    input.onKeyUp(new KeyboardEvent('keyup', init));
  }

  function sendClientKbText(input, text) {
    text.split(/\r\n|\r|\n/).forEach((part, i, parts) => {
      if (part) input.sendText(part);
      if (i < parts.length - 1) sendClientKbKey(input, 'Enter');
    });
  }

  function getCurrentStreamInput() {
    const app = currentKbIframe && currentKbIframe.contentWindow && currentKbIframe.contentWindow.app;
    const stream = app && app.getStream && app.getStream();
    return stream && stream.getInput && stream.getInput();
  }

  // Shows/hides the modifier+arrow toolbar above the stream, and shrinks the
  // video area by the toolbar's height so it's never covered by it.
  function setKbToolbarVisible(visible) {
    if (!currentKbToolbar) return;
    currentKbToolbar.style.display = visible ? 'flex' : 'none';
    const videoContainer = currentKbToolbar.parentElement && currentKbToolbar.parentElement.querySelector('#stream-video-container');
    if (videoContainer) {
      const h = visible ? currentKbToolbar.offsetHeight : 0;
      videoContainer.style.top = h + 'px';
      videoContainer.style.height = `calc(100% - ${h}px)`;
    }
  }

  function ensureClientKbInput() {
    if (clientKbInput) return clientKbInput;
    const el = document.createElement('textarea');
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
    el.style.cssText = 'position:fixed; top:0; left:0; width:1px; height:1px; opacity:0; border:none; padding:0; resize:none; pointer-events:none; z-index:-1;';
    resetClientKbValue(el);

    el.addEventListener('focus', () => setKbToolbarVisible(true));
    el.addEventListener('blur', () => {
      // Deferred: tapping a toolbar button blurs this textarea too, but that
      // handler re-focuses it synchronously before this fires, so the
      // toolbar should only actually hide once focus has truly moved away.
      setTimeout(() => { if (document.activeElement !== el) setKbToolbarVisible(false); }, 0);
    });

    el.addEventListener('input', (e) => {
      if (e.isComposing) return;
      const input = getCurrentStreamInput();
      if (!input) return;
      if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
        sendClientKbKey(input, 'Enter');
      } else if ((e.inputType === 'insertText' || e.inputType === 'insertFromPaste' || e.inputType === 'insertReplacementText') && e.data != null) {
        const mods = _streamMods;
        const code = (mods.ctrl || mods.alt || mods.meta) && e.data.length === 1 ? _charToCode(e.data) : null;
        if (code) sendClientKbKey(input, code, mods);
        else sendClientKbText(input, e.data);
      } else if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteByCut') {
        sendClientKbKey(input, 'Backspace');
      } else if (e.inputType === 'deleteContentForward') {
        sendClientKbKey(input, 'Delete');
      } else {
        const text = extractClientKbText(el);
        if (text) sendClientKbText(input, text);
      }
      resetClientKbValue(el);
    });

    el.addEventListener('compositionend', () => {
      const input = getCurrentStreamInput();
      const text = extractClientKbText(el);
      if (input && text) sendClientKbText(input, text);
      resetClientKbValue(el);
    });

    document.body.appendChild(el);
    clientKbInput = el;
    return el;
  }

  // Wires the per-session modifier/arrow toolbar (mirrors terminal.js's
  // #term-mods/#term-arrows) to the given stream session's input channel.
  function wireKbToolbar(toolbar) {
    currentKbToolbar = toolbar;
    const refocus = () => { if (clientKbInput) clientKbInput.focus(); };

    toolbar.querySelectorAll('.term-key[data-mod]').forEach((btn) => {
      btn.addEventListener('click', () => { _toggleStreamMod(btn.dataset.mod, btn); refocus(); });
    });
    toolbar.querySelectorAll('.term-key[data-arrow]').forEach((btn) => {
      const code = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[btn.dataset.arrow];
      btn.addEventListener('click', () => {
        const input = getCurrentStreamInput();
        if (input) sendClientKbKey(input, code, _streamMods);
        refocus();
      });
    });
    toolbar.querySelectorAll('.term-key[data-key="esc"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = getCurrentStreamInput();
        if (input) sendClientKbKey(input, 'Escape', _streamMods);
        refocus();
      });
    });
  }

  function toggleClientKeyboard(iframe) {
    currentKbIframe = iframe;
    const el = ensureClientKbInput();
    if (document.activeElement === el) {
      el.blur();
    } else {
      resetClientKbValue(el);
      el.focus();
    }
  }

  // Three simultaneous fingers toggles our own on-screen keyboard; four
  // toggles the proxy's settings drawer (mouse/touch mode, stats, debug) —
  // matches gestures official Moonlight mobile clients use, on iOS/Android
  // Safari and Chrome alike. Tracked by touch identifier rather than raw
  // touches.length so it survives fingers landing a few ms apart, which is
  // the norm rather than the exception on real touchscreens.
  function attachMultiFingerTapGestures(doc, iframe) {
    const active = new Set();
    let peak = 0;
    doc.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) active.add(t.identifier);
      peak = Math.max(peak, active.size);
    }, { passive: true, capture: true });
    const release = (e) => {
      for (const t of e.changedTouches) active.delete(t.identifier);
      if (active.size === 0) {
        if (peak === 3) toggleClientKeyboard(iframe);
        else if (peak === 4) toggleProxySidebarPanel(doc);
        peak = 0;
      }
    };
    doc.addEventListener('touchend', release, { passive: true, capture: true });
    doc.addEventListener('touchcancel', release, { passive: true, capture: true });
  }

  // Keeps the stream overlay sized/positioned to exactly the visible area
  // reported by the visualViewport API, instead of the full layout viewport.
  // Without this, focusing our keyboard-trigger textarea opens the mobile
  // on-screen keyboard and the overlay — anchored to the layout viewport,
  // which most mobile browsers don't shrink — ends up partly hidden behind
  // the keyboard (or the page scrolls to "reveal" the focused element,
  // dragging the whole stream view up and off-screen with it). Pinning to
  // visualViewport's own box, and stamping scroll position back to the
  // origin on every change, keeps the video pinned to the top of whatever
  // area is actually visible, with no visible page shift either way.
  function pinOverlayToVisualViewport(overlay) {
    const vv = window.visualViewport;
    if (!vv) return () => {};
    const update = () => {
      overlay.style.position = 'fixed';
      overlay.style.inset = 'auto';
      overlay.style.left = vv.offsetLeft + 'px';
      overlay.style.top = vv.offsetTop + 'px';
      overlay.style.width = vv.width + 'px';
      overlay.style.height = vv.height + 'px';
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('scroll', update);
    };
  }

  function enhanceStreamIframe(iframe) {
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      hideProxySidebarButton(doc);
      attachMultiFingerTapGestures(doc, iframe);
    } catch (e) {
      console.warn('Could not enhance stream iframe:', e);
    }
  }

  function actuallyLaunchApp(item, forceRtc = false) {
    if (document.querySelector('.stream-overlay')) {
      return; // Prevent duplicate overlays if user double clicks an app
    }
    const overlay = document.createElement('div');
    overlay.className = 'stream-overlay';
    overlay.style.flexDirection = 'column';
    overlay.style.background = `linear-gradient(to bottom, rgba(0,0,0,0.8), rgba(0,0,0,1)), url('${item.image}')`;
    overlay.style.backgroundSize = 'cover';
    overlay.style.backgroundPosition = 'center';

    // Pin the overlay to the visible (visualViewport) area rather than the
    // full layout viewport, and route every later overlay.remove() call
    // through the matching cleanup, however the stream session ends.
    const unpinViewport = pinOverlayToVisualViewport(overlay);
    const baseRemove = overlay.remove.bind(overlay);
    overlay.remove = () => {
      unpinViewport();
      if (clientKbInput && document.activeElement === clientKbInput) clientKbInput.blur();
      currentKbToolbar = null;
      currentKbIframe = null;
      baseRemove();
    };

    // Instead of an img tag for MJPEG, we use the Moonlight WebRTC iframe!
    overlay.innerHTML = `
      <div id="stream-loading-ui" class="stream-loading" style="z-index: 10;">
        <img src="${item.image}" style="width: 120px; height: 120px; border-radius: 20px; margin-bottom: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <div class="stream-spinner"></div>
        <div style="font-size: 1.2rem; font-weight: bold; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">Connecting to Explorer RTC...</div>
        <div style="font-size: 1rem; color: #ccc; margin-top: 10px; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">Launching ${item.name}</div>
        <button class="stream-play-btn" style="margin-top: 30px; background: rgba(255,255,255,0.2); color: white; border: 1px solid rgba(255,255,255,0.4); backdrop-filter: blur(5px);" onclick="this.parentElement.parentElement.remove()">Cancel</button>
      </div>
      <div id="stream-kb-toolbar" style="display:none; position:absolute; top:0; left:0; right:0; z-index:1002; background:rgba(0,0,0,0.75); backdrop-filter:blur(8px); padding:8px 10px; align-items:center; gap:6px; flex-wrap:wrap;">
        <button class="term-key" data-mod="meta"  title="Win / Cmd">⌘</button>
        <button class="term-key" data-mod="ctrl"  title="Ctrl">Ctrl</button>
        <button class="term-key" data-mod="alt"   title="Alt">Alt</button>
        <button class="term-key" data-mod="shift" title="Shift">⇧</button>
        <button class="term-key" data-key="esc"   title="Escape">Esc</button>
        <span style="flex:1"></span>
        <button class="term-key" data-arrow="up"    title="Up">↑</button>
        <button class="term-key" data-arrow="down"  title="Down">↓</button>
        <button class="term-key" data-arrow="left"  title="Left">←</button>
        <button class="term-key" data-arrow="right" title="Right">→</button>
      </div>
      <div id="stream-video-container" style="display:none; width:100%; height:100%; position: absolute; top:0; left:0; z-index: 5;">
         <!-- WebRTC Iframe injected here -->
      </div>
      <div id="stream-controls" style="display:none; position:absolute; top:20px; right:20px; z-index:1001;">
        <button id="stream-ingame-menu-trigger" class="stream-ingame-trigger" title="Menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1.3" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"></circle><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"></circle></svg>
        </button>
        <div id="stream-ingame-menu-panel" class="stream-ingame-panel">
          <span style="color: rgba(255,255,255,0.7); font-size: 0.85rem; font-weight: bold;">Press Shift+ESC to instantly exit stream</span>
          <button id="stream-exit-btn" style="background:rgba(255,0,0,0.8); color:white; border:1px solid rgba(255,255,255,0.3); padding:10px 20px; border-radius:8px; cursor:pointer; font-weight: bold; width: 100%;">Close App</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    wireKbToolbar(overlay.querySelector('#stream-kb-toolbar'));

    const token = localStorage.getItem('de_token') || '';
    
    const startWebRTCStream = () => {
      fetch('/stream/webrtc-config')
        .then(res => res.json())
        .then(config => {
          const hostId = config.hostId || 1;
          return fetch(`/moonlight-proxy/api/apps?host_id=${hostId}`, { credentials: 'same-origin' })
            .then(res => res.ok ? res.json().then(d => ({ ok: true, data: d })) : res.text().then(t => ({ ok: false, status: res.status, text: t })))
            .then(result => {
              if (!result.ok) {
                console.error("Proxy fetch failed:", result.status, result.text);
                return { hostId, apps: [], fetchError: result };
              }
              return { hostId, apps: result.data.apps || [] };
            });
        })
        .then(({ hostId, apps, fetchError }) => {
          // The proxy identifies apps by numeric app_id (assigned by Sunshine/Apollo's app
          // list), not by name, so we have to resolve the desired app's name to its id here.
          let match = item.app_id ? apps.find(a => a.app_id === item.app_id) : null;
          
          if (!match && item) {
            const targetName = (item.name || "").toLowerCase();
            if (targetName.includes("steam")) {
              match = apps.find(a => a.title.toLowerCase().includes("steam"));
            } else if (targetName.includes("xbox")) {
              match = apps.find(a => a.title.toLowerCase().includes("xbox"));
            } else if (targetName.includes("cbox")) {
              match = apps.find(a => a.title.toLowerCase().includes("cbox"));
            }
          }
          
          if (!match) {
            // Fallback to Desktop stream for all other apps and games
            match = apps.find(a => a.title.toLowerCase().includes("desktop"));
          }

          if (!match && apps.length > 0) {
            // If "Desktop" isn't explicitly named, fallback to the first available app 
            // so we can at least get a video stream going.
            match = apps[0];
          }

          if (!match) {
            let errorHtml = `<div style="font-size:1.1rem; color:#ff6b6b; max-width:400px; text-align:center;">No apps registered on the host yet. Add "Desktop" in Engine Setup.</div>`;
            if (fetchError) {
              if (fetchError.status === 401 || fetchError.status === 403) {
                errorHtml = `<div style="font-size:1.1rem; color:#ffb142; max-width:400px; text-align:center; margin-bottom: 15px;">Please log in to the Moonlight Stream Proxy to authorize access.</div>
                             <a href="/moonlight-proxy/" target="_blank" class="stream-play-btn" style="text-decoration:none; display:inline-block; margin-bottom: 15px;">Open Proxy Login</a>`;
              } else {
                errorHtml = `<div style="font-size:1.1rem; color:#ff6b6b; max-width:400px; text-align:center;">Failed to get apps from proxy (HTTP ${fetchError.status})</div>
                             <div style="font-size:0.8rem; color:#ccc; max-width:400px; text-align:center; margin-top:10px;">${fetchError.text.substring(0, 100)}</div>`;
              }
            }
            
            document.getElementById('stream-loading-ui').innerHTML = errorHtml + `<br><button class="stream-play-btn" style="margin-top: 20px;" onclick="this.closest('.stream-overlay').remove()">Close</button>`;
            return;
          }

          document.getElementById('stream-loading-ui').style.display = 'none';
          const videoContainer = document.getElementById('stream-video-container');
          const exitBtn = document.getElementById('stream-exit-btn');
          const controls = document.getElementById('stream-controls');
          const ingameTrigger = document.getElementById('stream-ingame-menu-trigger');
          const ingamePanel = document.getElementById('stream-ingame-menu-panel');

          videoContainer.style.display = 'block';
          controls.style.display = 'block';
          ingameTrigger.onclick = (e) => { e.stopPropagation(); ingamePanel.classList.toggle('open'); };
          overlay.addEventListener('click', (e) => {
            if (ingamePanel.classList.contains('open') && !ingamePanel.contains(e.target) && e.target !== ingameTrigger) {
              ingamePanel.classList.remove('open');
            }
          });

          const proxyUrl = "/moonlight-proxy/stream.html?hostId=" + hostId + "&appId=" + match.app_id + "&" + getRtcQueryParams();
          const iframe = document.createElement('iframe');
          iframe.src = proxyUrl;
          iframe.style = "width: 100%; height: 100%; border: none; outline: none; background: #000;";
          iframe.allow = "gamepad; microphone; autoplay; fullscreen; display-capture; clipboard-read; clipboard-write";

          videoContainer.appendChild(iframe);
          currentKbIframe = iframe;

          // Ensure the iframe has focus so keyboard and gamepad inputs are passed down!
          iframe.focus();
          iframe.onload = () => { iframe.focus(); enhanceStreamIframe(iframe); };
          overlay.onclick = () => iframe.focus();
          exitBtn.onclick = () => {
            const isPcApp = !!(item.path || item.appid || (item.familyName && item.appId));
            showCloseConfirm(isPcApp, ({ closeApp, closeStream }) => {
              if (closeApp && isPcApp) {
                fetch('/stream/kill', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {});
              }
              if (closeStream) {
                // Removing the iframe only drops the browser's end of the WebRTC
                // connection — Apollo/Sunshine still thinks a client is attached
                // until it's told to cancel, so send the real Moonlight "cancel"
                // call through the proxy to end the session host-side too.
                fetch('/moonlight-proxy/api/host/cancel', {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ host_id: Number(hostId) })
                }).catch(() => {});
                if (document.fullscreenElement) document.exitFullscreen();
                videoContainer.innerHTML = '';
                overlay.remove();
              }
            });
          };

          const messageListener = (event) => {
            if (event.data && event.data.type === 'DARKEXPLORER_CLOSE') {
              fetch('/moonlight-proxy/api/host/cancel', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host_id: Number(hostId) })
              }).catch(() => {});
              if (document.fullscreenElement) document.exitFullscreen();
              videoContainer.innerHTML = '';
              overlay.remove();
              window.removeEventListener('message', messageListener);
            }
          };
          window.addEventListener('message', messageListener);
        });
    };

    if (item.path || item.appid || (item.familyName && item.appId) || item.name === 'Remote Desktop' || item.name === 'Steam Big Picture' || item.name === 'Xbox') {
      fetch('/stream/launch', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: item.path, appid: item.appid, familyName: item.familyName, xboxAppId: item.appId, name: item.name })
      }).then(res => res.json()).then(data => {
        if (!data.ok) {
          alert('Failed to launch application on host.');
          overlay.remove();
          return;
        }
        if (!forceRtc) {
          // Already at the host — the app just opened and grabbed focus there. No need for a remote session.
          document.getElementById('stream-loading-ui').innerHTML =
            `<div style="font-size:1.2rem; font-weight:bold; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">Launched ${item.name}</div>
             <div style="font-size:1rem; color:#ccc; margin-top:10px; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">Running on this PC</div>`;
          setTimeout(() => overlay.remove(), 1200);
        } else {
          setTimeout(startWebRTCStream, 1500);
        }
      }).catch(e => {
        console.error(e);
        document.getElementById('stream-loading-ui').innerHTML =
            `<div style="font-size:1.2rem; font-weight:bold; color:#ff6b6b; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">Network error</div>
             <div style="font-size:1rem; color:#ccc; margin-top:10px; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">Could not reach host</div>`;
        setTimeout(() => overlay.remove(), 2500);
      });
    } else {
      if (!forceRtc) {
        document.getElementById('stream-loading-ui').innerHTML =
            `<div style="font-size:1.2rem; font-weight:bold; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">Launched ${item.name}</div>
             <div style="font-size:1rem; color:#ccc; margin-top:10px; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">Running on this PC</div>`;
        setTimeout(() => overlay.remove(), 1200);
      } else {
        setTimeout(startWebRTCStream, 500);
      }
    }
  }

  function hide() {
    if (container) {
      container.innerHTML = '';
      container = null;
    }
  }

  // Pre-fetch apps in the background at startup so they are ready when App Mode is opened
  fetchApps().catch(console.error);

  return {
    render, hide, launchApp, setFilter, setSort,
    isLocal: checkIsLocal,
    fetchApps,
    getSystemApps: () => cachedSystemApps,
    getApolloApps: () => cachedApolloApps,
    getSteamGames: () => cachedSteam,
    getXboxGames: () => cachedXbox,
  };
})();
