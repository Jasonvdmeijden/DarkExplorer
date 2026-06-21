// stream.js
const StreamView = (function() {
  let container;

  function render(appContainer) {
    container = document.createElement('div');
    container.className = 'stream-view active';
    appContainer.appendChild(container);

    container.innerHTML = `
      <div class="stream-header" style="padding: 40px 4% 20px 4%; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 30px; position: relative;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h1 style="font-size: 2.5rem; font-weight: 800; margin-bottom: 0; color: var(--text-primary);">Explorer RTC</h1>
          </div>
          <button id="stream-settings-btn" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 8px; backdrop-filter: blur(10px);">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            Settings
          </button>
        </div>
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

    fetchApps();
  }

  async function fetchApps() {
    try {
      const token = localStorage.getItem('de_token') || '';
      const res = await fetch('/stream/scan', { headers: { 'Authorization': 'Bearer ' + token } });
      if (!res.ok) throw new Error('Failed to scan apps');
      const data = await res.json();
      
      renderCarousel('stream-apps-carousel', data.apps || [], 'app');
      renderCarousel('stream-steam-carousel', data.steam || [], 'steam');
    } catch (e) {
      console.error('Stream view fetch error:', e);
      document.getElementById('stream-apps-carousel').innerHTML = '<div style="padding:20px;color:red">Failed to scan applications. Backend endpoint /stream/scan not yet implemented.</div>';
    }
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

      meta.appendChild(title);
      meta.appendChild(plat);
      card.appendChild(img);
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
      <div id="stream-controls" style="display:none; position:absolute; top:20px; right:20px; z-index:1001;">
        <button id="stream-exit-btn" style="background:rgba(255,0,0,0.8); color:white; border:1px solid rgba(255,255,255,0.3); padding:10px 20px; border-radius:8px; cursor:pointer; backdrop-filter: blur(10px); font-weight: bold; transition: all 0.2s; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">Close Game</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const token = localStorage.getItem('de_token') || '';

    // 1. Tell backend to launch the app natively on host
    fetch('/stream/launch', {
      method: 'POST',
      headers: { 
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path: item.path, appid: item.appid })
    }).then(res => res.json()).then(data => {
      if (data.ok) {
        // 2. Hide loading UI and inject WebRTC Feed
        setTimeout(() => {
          document.getElementById('stream-loading-ui').style.display = 'none';
          const videoContainer = document.getElementById('stream-video-container');
          const exitBtn = document.getElementById('stream-exit-btn');
          const controls = document.getElementById('stream-controls');
          
          videoContainer.style.display = 'block';
          controls.style.display = 'block';
          
          // Inject Moonlight WebRTC Frame directly into DarkExplorer overlay!
          // We use window.location.hostname to ensure it works on remote devices, avoiding localhost CORS issues!
          // Now that Moonlight is paired, we pass ?hostId=1&appId=1 to auto-launch the stream and completely hide the Moonlight Library UI!
          const proxyUrl = window.location.protocol + "//" + window.location.hostname + ":8080/stream.html?hostId=1&appId=1";
          
          const iframe = document.createElement('iframe');
          iframe.src = proxyUrl;
          iframe.style = "width: 100%; height: 100%; border: none; outline: none; background: #000;";
          iframe.allow = "gamepad; microphone; autoplay; fullscreen; display-capture; clipboard-read; clipboard-write";
          
          videoContainer.appendChild(iframe);

          exitBtn.onclick = () => {
            if (document.fullscreenElement) document.exitFullscreen();
            videoContainer.innerHTML = ''; // stop stream
            overlay.remove();
          };

          // Removed old MJPEG custom input handlers since WebRTC handles it natively.

        }, 1500); // Give the app 1.5s to open before streaming screen
      } else {
        alert('Failed to launch application on host.');
        overlay.remove();
      }
    }).catch(e => {
      console.error(e);
      alert('Network error launching application.');
      overlay.remove();
    });
  }

  function hide() {
    if (container) {
      container.innerHTML = '';
      container = null;
    }
  }

  return { render, hide };
})();
