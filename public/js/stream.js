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
    
    // Instead of an img tag for MJPEG, we use the Moonlight WebRTC iframe!
    overlay.innerHTML = `
      <div id="stream-loading-ui" class="stream-loading" style="z-index: 10;">
        <img src="${item.image}" style="width: 120px; height: 120px; border-radius: 20px; margin-bottom: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <div class="stream-spinner"></div>
        <div style="font-size: 1.2rem; font-weight: bold; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">Connecting to Explorer RTC...</div>
        <div style="font-size: 1rem; color: #ccc; margin-top: 10px; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">Launching ${item.name}</div>
        <button class="stream-play-btn" style="margin-top: 30px; background: rgba(255,255,255,0.2); color: white; border: 1px solid rgba(255,255,255,0.4); backdrop-filter: blur(5px);" onclick="this.parentElement.parentElement.remove()">Cancel</button>
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

          const proxyUrl = "/moonlight-proxy/stream.html?hostId=" + hostId + "&appId=" + match.app_id;
          const iframe = document.createElement('iframe');
          iframe.src = proxyUrl;
          iframe.style = "width: 100%; height: 100%; border: none; outline: none; background: #000;";
          iframe.allow = "gamepad; microphone; autoplay; fullscreen; display-capture; clipboard-read; clipboard-write";
          
          videoContainer.appendChild(iframe);
          
          // Ensure the iframe has focus so keyboard and gamepad inputs are passed down!
          iframe.focus();
          iframe.onload = () => iframe.focus();
          overlay.onclick = () => iframe.focus();
          exitBtn.onclick = () => {
            const isPcApp = !!(item.path || item.appid || (item.familyName && item.appId));
            showCloseConfirm(isPcApp, ({ closeApp, closeStream }) => {
              if (closeApp && isPcApp) {
                fetch('/stream/kill', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {});
              }
              if (closeStream) {
                if (document.fullscreenElement) document.exitFullscreen();
                videoContainer.innerHTML = '';
                overlay.remove();
              }
            });
          };

          const messageListener = (event) => {
            if (event.data && event.data.type === 'DARKEXPLORER_CLOSE') {
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
