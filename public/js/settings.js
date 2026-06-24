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

  return { open, close, getFavLimit };
})();
