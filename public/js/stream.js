// stream.js
const StreamView = (function() {
  let container;

  function render(appContainer) {
    container = document.createElement('div');
    container.className = 'stream-view active';
    appContainer.appendChild(container);

    container.innerHTML = `
      <div class="stream-header" style="padding: 20px 4%; display: flex; justify-content: flex-end; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 30px;">
        <div style="display: flex; gap: 15px;">
          <button class="stream-play-btn" id="stream-desktop-btn" style="background: var(--accent); color: white; padding: 10px 20px; font-size: 1rem;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
            Desktop
          </button>
          <button class="stream-play-btn" id="stream-settings-btn" style="background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2); backdrop-filter: blur(10px); padding: 10px 20px; font-size: 1rem;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            Settings
          </button>
        </div>
      </div>
      <div class="stream-row" id="stream-fav-row" style="display:none;">
        <h2 class="stream-row-title">Favorites</h2>
        <div class="stream-carousel" id="stream-fav-carousel"></div>
      </div>
      <div class="stream-row" id="stream-apps-row">
        <h2 class="stream-row-title">Installed Applications</h2>
        <div class="stream-carousel" id="stream-apps-carousel">
          <div style="padding: 20px; color: #888;">Scanning for apps...</div>
        </div>
      </div>
      <div class="stream-row" id="stream-steam-row">
        <h2 class="stream-row-title">Steam Library</h2>
        <div class="stream-carousel" id="stream-steam-carousel">
          <div style="padding: 20px; color: #888;">Scanning Steam library...</div>
        </div>
      </div>

      <!-- Settings Modal -->
      <div id="stream-settings-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); backdrop-filter: blur(5px); z-index: 2000; align-items: center; justify-content: center;">
        <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 12px; width: 500px; max-width: 90%; padding: 30px; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
            <h2 style="margin: 0; font-size: 1.5rem; color: var(--text-primary);">Stream Settings</h2>
            <button id="stream-settings-close" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1.5rem;">&times;</button>
          </div>
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <div>
              <label style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-weight: bold;">Resolution</label>
              <select id="setting-resolution" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 6px; outline: none;">
                <option value="720">720p (HD)</option>
                <option value="1080">1080p (FHD)</option>
                <option value="1440">1440p (QHD)</option>
                <option value="2160">2160p (4K)</option>
              </select>
            </div>
            <div>
              <label style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-weight: bold;">Frame Rate</label>
              <select id="setting-fps" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 6px; outline: none;">
                <option value="30">30 FPS</option>
                <option value="60">60 FPS</option>
                <option value="120">120 FPS</option>
              </select>
            </div>
            <div>
              <label style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-weight: bold;">Video Bitrate (Mbps)</label>
              <input type="range" id="setting-bitrate" min="5" max="150" value="30" style="width: 100%; accent-color: var(--accent);">
              <div style="text-align: right; color: var(--accent); font-weight: bold; margin-top: 5px;"><span id="setting-bitrate-val">30</span> Mbps</div>
            </div>
            <div>
              <label style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-weight: bold;">Audio Configuration</label>
              <select id="setting-audio" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 6px; outline: none;">
                <option value="stereo">Stereo (2.0)</option>
                <option value="surround51">Surround (5.1)</option>
                <option value="surround71">Surround (7.1)</option>
              </select>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <div>
                <label for="setting-vsync" style="color: var(--text-primary); font-weight: bold; display: block;">Enable V-Sync</label>
                <span style="font-size: 0.85rem; color: var(--text-muted);">Prevents screen tearing during high-motion scenes</span>
              </div>
              <input type="checkbox" id="setting-vsync" checked style="width: 20px; height: 20px; accent-color: var(--accent);">
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <div>
                <label for="setting-hdr" style="color: var(--text-primary); font-weight: bold; display: block;">Enable HDR</label>
                <span style="font-size: 0.85rem; color: var(--text-muted);">Requires an HDR compatible display</span>
              </div>
              <input type="checkbox" id="setting-hdr" style="width: 20px; height: 20px; accent-color: var(--accent);">
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <div>
                <label for="setting-network" style="color: var(--text-primary); font-weight: bold; display: block;">Optimize Network Drops</label>
                <span style="font-size: 0.85rem; color: var(--text-muted);">Drops frames to reduce latency on bad connections</span>
              </div>
              <input type="checkbox" id="setting-network" style="width: 20px; height: 20px; accent-color: var(--accent);">
            </div>
            <hr style="border: 0; height: 1px; background: rgba(255,255,255,0.1); margin: 10px 0;">
            <div>
              <label style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-weight: bold;">WebRTC Engine Setup</label>
              <span style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 15px;">Configure the internal Moonlight engine and pair it with the server. You only need to do this once.</span>
              <button id="stream-settings-setup-btn" style="width: 100%; padding: 12px; background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 10px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
                Open Engine Setup
              </button>
            </div>
          </div>
          <button id="stream-settings-save" style="width: 100%; padding: 12px; background: var(--accent); color: white; border: none; border-radius: 8px; font-weight: bold; font-size: 1.1rem; cursor: pointer; margin-top: 25px;">Save Settings</button>
        </div>
      </div>
    `;

    // Attach Settings Handlers
    const settingsModal = document.getElementById('stream-settings-modal');
    document.getElementById('stream-settings-btn').onclick = () => {
      // Load saved settings
      document.getElementById('setting-resolution').value = localStorage.getItem('de_stream_res') || '1080';
      document.getElementById('setting-fps').value = localStorage.getItem('de_stream_fps') || '60';
      document.getElementById('setting-bitrate').value = localStorage.getItem('de_stream_bitrate') || '30';
      document.getElementById('setting-audio').value = localStorage.getItem('de_stream_audio') || 'stereo';
      document.getElementById('setting-bitrate-val').textContent = document.getElementById('setting-bitrate').value;
      document.getElementById('setting-vsync').checked = (localStorage.getItem('de_stream_vsync') !== 'false');
      document.getElementById('setting-hdr').checked = (localStorage.getItem('de_stream_hdr') === 'true');
      document.getElementById('setting-network').checked = (localStorage.getItem('de_stream_network') === 'true');
      settingsModal.style.display = 'flex';
    };
    document.getElementById('stream-settings-close').onclick = () => {
      settingsModal.style.display = 'none';
    };
    
    document.getElementById('stream-desktop-btn').onclick = () => {
      launchApp({
        name: "Remote Desktop",
        image: "https://images.unsplash.com/photo-1618424181497-157f25b6ce50?auto=format&fit=crop&q=80&w=400",
        path: null,
        appid: null
      });
    };

    document.getElementById('setting-bitrate').oninput = (e) => {
      document.getElementById('setting-bitrate-val').textContent = e.target.value;
    };
    document.getElementById('stream-settings-save').onclick = () => {
      localStorage.setItem('de_stream_res', document.getElementById('setting-resolution').value);
      localStorage.setItem('de_stream_fps', document.getElementById('setting-fps').value);
      localStorage.setItem('de_stream_bitrate', document.getElementById('setting-bitrate').value);
      localStorage.setItem('de_stream_audio', document.getElementById('setting-audio').value);
      localStorage.setItem('de_stream_vsync', document.getElementById('setting-vsync').checked);
      localStorage.setItem('de_stream_hdr', document.getElementById('setting-hdr').checked);
      localStorage.setItem('de_stream_network', document.getElementById('setting-network').checked);
      settingsModal.style.display = 'none';
    };

    document.getElementById('stream-settings-setup-btn').onclick = () => {
      settingsModal.style.display = 'none';
      
      const setupOverlay = document.createElement('div');
      setupOverlay.style = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 3000; background: black;";
      setupOverlay.innerHTML = `
        <div style="position: absolute; top: 20px; right: 20px; z-index: 3001;">
          <button id="setup-close-btn" style="background: rgba(255,0,0,0.8); color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer;">Close Setup</button>
        </div>
        <iframe src="${window.location.protocol}//${window.location.hostname}:8080/" style="width: 100%; height: 100%; border: none;"></iframe>
      `;
      document.body.appendChild(setupOverlay);
      
      document.getElementById('setup-close-btn').onclick = () => {
        setupOverlay.remove();
      };
    };

    fetchApps();
  }

  let cachedApps = [];
  let cachedSteam = [];

  async function fetchApps() {
    try {
      const token = localStorage.getItem('de_token') || '';
      const res = await fetch('/stream/scan', { headers: { 'Authorization': 'Bearer ' + token } });
      if (!res.ok) throw new Error('Failed to scan apps');
      const data = await res.json();
      
      cachedApps = data.apps || [];
      cachedSteam = data.steam || [];
      renderAllCarousels();
    } catch (e) {
      console.error('Stream view fetch error:', e);
      document.getElementById('stream-apps-carousel').innerHTML = '<div style="padding:20px;color:red">Failed to scan applications. Backend endpoint /stream/scan not yet implemented.</div>';
    }
  }

  function renderAllCarousels() {
    let favs = JSON.parse(localStorage.getItem('de_stream_favs') || '[]');
    const favRow = document.getElementById('stream-fav-row');
    if (favRow) favRow.style.display = favs.length > 0 ? 'block' : 'none';
    
    renderCarousel('stream-fav-carousel', favs, 'favorite');
    renderCarousel('stream-apps-carousel', cachedApps, 'app');
    renderCarousel('stream-steam-carousel', cachedSteam, 'steam');
  }

  function renderCarousel(id, items, platform) {
    const carousel = document.getElementById(id);
    if (!carousel) return;
    if (items.length === 0) {
      carousel.innerHTML = '<div style="padding:20px;color:#888;">No games found for this platform.</div>';
      return;
    }

    carousel.innerHTML = '';
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
      plat.textContent = platform.toUpperCase();

      const favBtn = document.createElement('div');
      favBtn.className = 'stream-card-fav';
      let favs = JSON.parse(localStorage.getItem('de_stream_favs') || '[]');
      if (favs.some(f => f.name === item.name)) {
        favBtn.classList.add('active');
      }
      favBtn.innerHTML = '★';
      favBtn.onclick = (ev) => {
        ev.stopPropagation();
        let currentFavs = JSON.parse(localStorage.getItem('de_stream_favs') || '[]');
        const idx = currentFavs.findIndex(f => f.name === item.name);
        if (idx >= 0) currentFavs.splice(idx, 1);
        else currentFavs.push(item);
        localStorage.setItem('de_stream_favs', JSON.stringify(currentFavs));
        renderAllCarousels();
      };

      meta.appendChild(title);
      meta.appendChild(plat);
      card.appendChild(img);
      card.appendChild(favBtn);
      card.appendChild(meta);

      card.onclick = () => launchApp(item);
      carousel.appendChild(card);
    });
  }

  function launchApp(item) {
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
      <div id="stream-controls" style="display:none; position:absolute; top:20px; right:20px; z-index:1001; display:flex; align-items:center; gap: 15px;">
        <span style="color: rgba(255,255,255,0.7); font-size: 0.9rem; font-weight: bold; text-shadow: 0 2px 4px rgba(0,0,0,0.8); background: rgba(0,0,0,0.4); padding: 5px 10px; border-radius: 6px;">Press Shift+ESC to instantly exit stream</span>
        <button id="stream-exit-btn" style="background:rgba(255,0,0,0.8); color:white; border:1px solid rgba(255,255,255,0.3); padding:10px 20px; border-radius:8px; cursor:pointer; backdrop-filter: blur(10px); font-weight: bold; transition: all 0.2s; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">Close Game</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const token = localStorage.getItem('de_token') || '';
    
    const startWebRTCStream = () => {
      fetch('/stream/webrtc-config')
        .then(res => res.json())
        .then(config => {
          const hostId = config.hostId || 1;
          
          document.getElementById('stream-loading-ui').style.display = 'none';
          const videoContainer = document.getElementById('stream-video-container');
          const exitBtn = document.getElementById('stream-exit-btn');
          const controls = document.getElementById('stream-controls');
          
          videoContainer.style.display = 'block';
          controls.style.display = 'block';
          
          // Delegate the actual app launching entirely to the Sunshine engine.
          // By passing the dynamic appName to the proxy, Moonlight Web Stream will request Sunshine
          // to execute the native application launch and isolation automatically.
          const dynamicAppName = (item.name && item.name !== "Remote Desktop") ? encodeURIComponent(item.name) : "Desktop";
          const proxyUrl = window.location.protocol + "//" + window.location.hostname + ":8080/stream.html?hostId=" + hostId + "&appName=" + dynamicAppName;
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
            if (document.fullscreenElement) document.exitFullscreen();
            videoContainer.innerHTML = '';
            overlay.remove();
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

    if (item.path || item.appid) {
      fetch('/stream/launch', {
        method: 'POST',
        headers: { 
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: item.path, appid: item.appid })
      }).then(res => res.json()).then(data => {
        if (data.ok) {
          setTimeout(startWebRTCStream, 1500);
        } else {
          alert('Failed to launch application on host.');
          overlay.remove();
        }
      }).catch(e => {
        console.error(e);
        alert('Network error launching application.');
        overlay.remove();
      });
    } else {
      setTimeout(startWebRTCStream, 500);
    }
  }

  function hide() {
    if (container) {
      container.innerHTML = '';
      container = null;
    }
  }

  return { render, hide };
})();
