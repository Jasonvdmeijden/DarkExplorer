/* settings.js — single consolidated Settings modal for the whole app.
   Houses Gallery (mosaic density), RTC/App Mode (stream quality + engine
   setup) and Favourites (how many frequent folders to remember) settings,
   all of which previously lived scattered across separate ad-hoc UIs. */
const AppSettings = (() => {
  const TABS = [
    { id: 'gallery',     label: 'Gallery' },
    { id: 'rtc',         label: 'App Mode / RTC' },
    { id: 'favourites',  label: 'Favourites' },
    { id: 'theme',       label: 'Theme' },
    { id: 'devices',     label: 'Linked Devices' },
  ];

  let modal, tabsEl, bodyEl;

  function ensureModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.id = 'app-settings-modal';
    modal.className = 'app-settings-modal';
    modal.innerHTML = `
      <div class="app-settings-box">
        <div class="app-settings-header">
          <h2>Settings</h2>
          <button class="app-settings-close" id="app-settings-close" title="Close">&times;</button>
        </div>
        <div class="app-settings-tabs" id="app-settings-tabs">
          ${TABS.map(t => `<button class="app-settings-tab" data-tab="${t.id}">${t.label}</button>`).join('')}
        </div>
        <div class="app-settings-body" id="app-settings-body"></div>
      </div>
    `;
    document.body.appendChild(modal);
    tabsEl = modal.querySelector('#app-settings-tabs');
    bodyEl = modal.querySelector('#app-settings-body');

    modal.querySelector('#app-settings-close').onclick = close;
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });
    tabsEl.querySelectorAll('.app-settings-tab').forEach(btn => {
      btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });
  }

  function showTab(tabId) {
    tabsEl.querySelectorAll('.app-settings-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    bodyEl.innerHTML = '';
    if (tabId === 'rtc') renderRtcTab(bodyEl);
    else if (tabId === 'favourites') renderFavouritesTab(bodyEl);
    else if (tabId === 'theme' && typeof Theme !== 'undefined') Theme.renderThemeTab(bodyEl);
    else if (tabId === 'devices') renderDevicesTab(bodyEl);
    else renderGalleryTab(bodyEl);
    localStorage.setItem('de_settings_last_tab', tabId);
  }

  function open(tabId) {
    ensureModal();
    modal.classList.add('open');
    showTab(tabId || localStorage.getItem('de_settings_last_tab') || 'gallery');
  }

  function close() {
    if (modal) modal.classList.remove('open');
  }

  function field(labelHtml, controlHtml) {
    return `<div class="settings-field"><label>${labelHtml}</label>${controlHtml}</div>`;
  }

  function toggleField(id, labelTitle, desc, checked) {
    return `
      <div class="settings-toggle-row">
        <div>
          <label for="${id}">${labelTitle}</label>
          <span>${desc}</span>
        </div>
        <label class="ui-switch">
          <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
          <span class="ui-slider"></span>
        </label>
      </div>`;
  }

  // ── Gallery tab ──────────────────────────────────────────
  function renderGalleryTab(host) {
    const cols = parseInt(localStorage.getItem('de_mosaic_cols') || '4', 10);
    host.innerHTML = field(
      'Thumbnails per row <span class="settings-field-val" id="settings-mosaic-cols-val">' + cols + '</span>',
      `<input type="range" id="settings-mosaic-cols" min="1" max="8" value="${cols}">`
    );
    const slider = host.querySelector('#settings-mosaic-cols');
    const val = host.querySelector('#settings-mosaic-cols-val');
    slider.addEventListener('input', () => {
      const v = parseInt(slider.value, 10);
      val.textContent = v;
      if (typeof Explorer !== 'undefined' && Explorer.setMosaicCols) Explorer.setMosaicCols(v);
      else { localStorage.setItem('de_mosaic_cols', v); State.set('mosaicSize', v); }
    });
  }

  // ── RTC / App Mode tab ──────────────────────────────────
  function renderRtcTab(host) {
    host.innerHTML = `
      ${field('Same-device detection <span class="settings-hint" style="display:block;margin-top:2px;font-weight:400;">Decides whether launching an app starts a remote RTC session, or just opens it directly. Auto-detect can be fooled by tunnels/VPNs that relay every device through the same address — override it here if App Mode ever guesses wrong.</span>', `
        <select id="setting-local-override">
          <option value="auto">Auto-detect (default)</option>
          <option value="local">This device IS the streaming host</option>
          <option value="remote">This device is NOT the streaming host</option>
        </select>`)}
      <hr class="settings-divider">
      ${field('Resolution', `
        <select id="setting-resolution">
          <option value="720">720p (HD)</option>
          <option value="1080">1080p (FHD)</option>
          <option value="1440">1440p (QHD)</option>
          <option value="2160">2160p (4K)</option>
        </select>`)}
      ${field('Frame Rate', `
        <select id="setting-fps">
          <option value="30">30 FPS</option>
          <option value="60">60 FPS</option>
          <option value="120">120 FPS</option>
        </select>`)}
      ${field('Video Bitrate (Mbps) <span class="settings-field-val" id="setting-bitrate-val">30</span>',
        `<input type="range" id="setting-bitrate" min="5" max="150" value="30">`)}
      ${field('Audio Configuration', `
        <select id="setting-audio">
          <option value="stereo">Stereo (2.0)</option>
          <option value="surround51">Surround (5.1)</option>
          <option value="surround71">Surround (7.1)</option>
        </select>`)}
      ${toggleField('setting-vsync', 'Enable V-Sync', 'Prevents screen tearing during high-motion scenes')}
      ${toggleField('setting-hdr', 'Enable HDR', 'Requires an HDR compatible display')}
      ${toggleField('setting-network', 'Optimize Network Drops', 'Drops frames to reduce latency on bad connections')}
      <hr class="settings-divider">
      <div class="settings-field">
        <label>WebRTC Engine Setup</label>
        <span class="settings-hint">Configure the internal Moonlight engine and pair it with the server. You only need to do this once.</span>
        <button id="settings-engine-setup-btn" class="settings-action-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
          Open Engine Setup
        </button>
      </div>
    `;

    host.querySelector('#setting-local-override').value = localStorage.getItem('de_local_override') || 'auto';
    host.querySelector('#setting-local-override').addEventListener('change', (e) => {
      localStorage.setItem('de_local_override', e.target.value);
    });

    host.querySelector('#setting-resolution').value = localStorage.getItem('de_stream_res') || '1080';
    host.querySelector('#setting-fps').value = localStorage.getItem('de_stream_fps') || '60';
    host.querySelector('#setting-bitrate').value = localStorage.getItem('de_stream_bitrate') || '30';
    host.querySelector('#setting-bitrate-val').textContent = host.querySelector('#setting-bitrate').value;
    host.querySelector('#setting-audio').value = localStorage.getItem('de_stream_audio') || 'stereo';
    host.querySelector('#setting-vsync').checked = (localStorage.getItem('de_stream_vsync') !== 'false');
    host.querySelector('#setting-hdr').checked = (localStorage.getItem('de_stream_hdr') === 'true');
    host.querySelector('#setting-network').checked = (localStorage.getItem('de_stream_network') === 'true');

    host.querySelector('#setting-bitrate').addEventListener('input', (e) => {
      host.querySelector('#setting-bitrate-val').textContent = e.target.value;
    });

    host.querySelectorAll('select, input').forEach((el) => {
      el.addEventListener('change', () => {
        localStorage.setItem('de_stream_res', host.querySelector('#setting-resolution').value);
        localStorage.setItem('de_stream_fps', host.querySelector('#setting-fps').value);
        localStorage.setItem('de_stream_bitrate', host.querySelector('#setting-bitrate').value);
        localStorage.setItem('de_stream_audio', host.querySelector('#setting-audio').value);
        localStorage.setItem('de_stream_vsync', host.querySelector('#setting-vsync').checked);
        localStorage.setItem('de_stream_hdr', host.querySelector('#setting-hdr').checked);
        localStorage.setItem('de_stream_network', host.querySelector('#setting-network').checked);
      });
    });

    host.querySelector('#settings-engine-setup-btn').onclick = () => {
      close();
      const setupOverlay = document.createElement('div');
      setupOverlay.style = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 3000; background: black;";
      setupOverlay.innerHTML = `
        <div style="position: absolute; top: 20px; right: 20px; z-index: 3001;">
          <button id="setup-close-btn" style="background: rgba(255,0,0,0.8); color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer;">Close Setup</button>
        </div>
        <iframe src="/moonlight-proxy/" style="width: 100%; height: 100%; border: none;"></iframe>
      `;
      document.body.appendChild(setupOverlay);
      document.getElementById('setup-close-btn').onclick = () => setupOverlay.remove();
    };
  }

  // ── Favourites tab ──────────────────────────────────────
  function getFavLimit() {
    return parseInt(localStorage.getItem('de_fav_limit') || '10', 10);
  }

  function renderFavouritesTab(host) {
    const limit = getFavLimit();
    host.innerHTML = field(
      'Folders to remember <span class="settings-field-val" id="settings-fav-limit-val">' + limit + '</span>',
      `<input type="range" id="settings-fav-limit" min="3" max="50" value="${limit}">
       <span class="settings-hint">How many of your most-visited folders show up in the left panel's Fav tab.</span>`
    );
    const slider = host.querySelector('#settings-fav-limit');
    const val = host.querySelector('#settings-fav-limit-val');
    slider.addEventListener('input', () => {
      const v = parseInt(slider.value, 10);
      val.textContent = v;
      localStorage.setItem('de_fav_limit', v);
      if (typeof Favourites !== 'undefined') Favourites.render();
    });
  }

  document.getElementById('btn-app-settings').addEventListener('click', () => open());

  async function renderDevicesTab(container) {
    container.innerHTML = `
      <div class="settings-field">
        <label>Pair New Device</label>
        <span class="settings-hint">Scan this QR code with your phone or tablet to link it to DarkExplorer. This allows you to use your device as a remote Trackpad/Controller and access files over the local network or VPN.</span>
        <div style="display: flex; flex-direction: column; align-items: center; margin-top: 1rem;">
          <button id="btn-pair-device" class="settings-action-btn" style="width: 100%; max-width: 300px; justify-content: center; padding: 0.8rem; font-size: 1rem;">Generate QR Code</button>
          <div id="qr-container" style="margin-top: 1.5rem; display: none; background: white; padding: 1.5rem; border-radius: 12px; align-items: center; flex-direction: column; box-shadow: 0 4px 15px rgba(0,0,0,0.2);"></div>
        </div>
      </div>
      <hr class="settings-divider">
      <div class="settings-field">
        <label>Linked Devices</label>
        <span class="settings-hint">Manage devices currently authenticated with your server.</span>
        <div id="devices-list" style="margin-top: .5rem; display: flex; flex-direction: column; gap: .5rem;">
          <span class="settings-hint">Loading...</span>
        </div>
      </div>
    `;

    const btnPair = container.querySelector('#btn-pair-device');
    const qrContainer = container.querySelector('#qr-container');
    const listContainer = container.querySelector('#devices-list');

    btnPair.addEventListener('click', async () => {
      btnPair.disabled = true;
      btnPair.textContent = 'Generating...';
      try {
        const res = await fetch('/admin/gen-otp');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        qrContainer.innerHTML = `<div style="text-align: center; margin-bottom: 1rem;">
          <span style="font-size: .8rem; color: #666;">Manual Pairing Code:</span><br>
          <strong style="font-size: 1.5rem; letter-spacing: 2px; color: #000; user-select: text;">${data.code}</strong>
        </div>`;
        qrContainer.style.display = 'flex';
        const ip = (data.ips && data.ips.length > 0) ? data.ips[0] : window.location.hostname;
        const port = window.location.port ? ':' + window.location.port : '';
        const url = window.location.protocol + '//' + ip + port + '/?auth=' + data.code;
        
        const qrCanvas = document.createElement('div');
        qrCanvas.style.display = 'flex';
        qrCanvas.style.justifyContent = 'center';
        qrContainer.appendChild(qrCanvas);
        
        new QRCode(qrCanvas, {
          text: url,
          width: 200,
          height: 200,
          colorDark : "#000000",
          colorLight : "#ffffff",
          correctLevel : QRCode.CorrectLevel.M
        });
        btnPair.textContent = 'Code Active (Expires in 1hr)';
      } catch (err) {
        btnPair.textContent = 'Error Generating Code';
        btnPair.disabled = false;
        console.error(err);
      }
    });

    let devicePollInterval = null;

    async function loadDevices() {
      try {
        const res = await fetch('/admin/devices');
        if (!res.ok) throw new Error('Failed to load devices');
        const devices = await res.json();
        if (devices.length === 0) {
          listContainer.innerHTML = '<span class="settings-hint">No external devices linked.</span>';
          return;
        }

        const formatBytes = (bytes) => {
          if (!bytes) return '0 B';
          const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'], i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };
        
        const now = Date.now();

        listContainer.innerHTML = devices.map(d => {
          const isLive = (now - d.last_seen) < 15000; // 15 seconds
          const liveIcon = isLive ? `<div style="width:8px; height:8px; border-radius:50%; background:#4ade80; box-shadow:0 0 8px #4ade80; margin-left:8px;" title="Connected & Active"></div>` : `<div style="width:8px; height:8px; border-radius:50%; border:1px solid var(--text-muted); margin-left:8px; opacity: 0.5;" title="Offline"></div>`;
          return `
          <div style="display: flex; flex-direction: column; padding: .75rem; background: var(--bg-base); border: 1px solid var(--border); border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
              <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                ${liveIcon}
                <span style="font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;" title="${d.label}">${d.label}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                <button class="settings-action-btn btn-rename" data-id="${d.id}" data-label="${d.label}" style="padding: .2rem .6rem; font-size: .75rem; border-color: rgba(255,255,255,0.2); display:flex; align-items:center; gap: 4px;" title="Rename Device">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                  Rename
                </button>
                <button class="settings-action-btn btn-relink" data-id="${d.id}" style="padding: .2rem .6rem; font-size: .75rem; border-color: rgba(255,255,255,0.2); display:flex; align-items:center; gap: 4px;" title="Re-link Network (IP changed)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                  Re-link IP
                </button>
                <button class="settings-action-btn btn-revoke" data-id="${d.id}" style="padding: .2rem .6rem; font-size: .75rem; color: #ff5f56; border-color: rgba(255, 95, 86, 0.3);">Revoke</button>
              </div>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: .5rem; font-size: .75rem; color: var(--text-muted);">
              <span>Data Transferred: <strong style="color:var(--text-primary)">${formatBytes(d.traffic_bytes)}</strong></span>
              <span>Last Seen: ${new Date(d.last_seen).toLocaleString()}</span>
            </div>
          </div>`;
        }).join('');

        listContainer.querySelectorAll('.btn-revoke').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Revoke access for this device?')) return;
            await fetch(`/admin/devices/${btn.dataset.id}`, { method: 'DELETE' });
            loadDevices();
          });
        });

        listContainer.querySelectorAll('.btn-rename').forEach(btn => {
          btn.addEventListener('click', async () => {
            const newLabel = prompt('Enter a new name for this device:', btn.dataset.label);
            if (newLabel && newLabel.trim() !== '') {
              await fetch(`/admin/devices/${btn.dataset.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: newLabel.trim() })
              });
              loadDevices();
            }
          });
        });

        listContainer.querySelectorAll('.btn-relink').forEach(btn => {
          btn.addEventListener('click', async () => {
            try {
              const res = await fetch(`/admin/gen-otp?device_id=${btn.dataset.id}`);
              const data = await res.json();
              if (data.error) throw new Error(data.error);
              
              qrContainer.innerHTML = `<div style="text-align: center; margin-bottom: 1rem;">
                <span style="font-size: .8rem; color: #666;">Manual Re-link Code:</span><br>
                <strong style="font-size: 1.5rem; letter-spacing: 2px; color: #000; user-select: text;">${data.code}</strong>
              </div>`;
              qrContainer.style.display = 'flex';
              const ip = (data.ips && data.ips.length > 0) ? data.ips[0] : window.location.hostname;
              const port = window.location.port ? ':' + window.location.port : '';
              const url = window.location.protocol + '//' + ip + port + '/?auth=' + data.code;
              
              const qrCanvas = document.createElement('div');
              qrCanvas.style.display = 'flex';
              qrCanvas.style.justifyContent = 'center';
              qrContainer.appendChild(qrCanvas);
              
              new QRCode(qrCanvas, {
                text: url, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M
              });
              
              // Scroll to QR code
              qrContainer.scrollIntoView({ behavior: 'smooth' });
            } catch (err) {
              console.error(err);
              alert('Failed to generate re-link code.');
            }
          });
        });
      } catch (e) {
        listContainer.innerHTML = '<span class="settings-hint" style="color: #ff5f56">Failed to load devices (Only accessible from the host PC).</span>';
      }
    }

    loadDevices();
    
    // Live update for throughput and status
    devicePollInterval = setInterval(loadDevices, 5000);
    
    // Clear interval when modal closes
    const obs = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (!document.getElementById('app-settings-modal').classList.contains('open')) {
          clearInterval(devicePollInterval);
          obs.disconnect();
        }
      });
    });
    obs.observe(document.getElementById('app-settings-modal'), { attributes: true, attributeFilter: ['class'] });
  }

  return { open, close, getFavLimit };
})();
