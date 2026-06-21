// stream.js - Stream View UI

window.StreamView = (function() {
  let container = null;
  let currentPath = '';

  function render(hostEl, pathStr) {
    container = hostEl;
    currentPath = pathStr;
    container.innerHTML = `
      <div class="stream-header" style="padding: 40px 4% 20px 4%; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 30px; position: relative;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h1 style="font-size: 2.5rem; font-weight: 800; margin-bottom: 10px; color: var(--text-primary);">Explorer RTC</h1>
            <p style="font-size: 1.1rem; color: var(--text-muted); max-width: 800px; line-height: 1.5;">
              Seamlessly launch and stream your installed applications and Steam library directly into the browser. Powered by hardware-accelerated zero-latency capturing and interactive WebSocket input injection.
            </p>
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
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
            <h2 style="margin: 0; font-size: 1.5rem; color: var(--text-primary);">Stream Settings</h2>
            <button id="stream-settings-close" style="background: transparent; border: none; color: var(--text-muted); font-size: 1.5rem; cursor: pointer;">&times;</button>
          </div>
          
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <div>
              <label style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-weight: bold;">Resolution</label>
              <select id="setting-resolution" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 6px; outline: none;">
                <option value="1080">1080p (1920x1080)</option>
                <option value="1440">1440p (2560x1440)</option>
                <option value="4k">4K (3840x2160)</option>
                <option value="720">720p (1280x720)</option>
              </select>
            </div>
            <div>
              <label style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-weight: bold;">Framerate (FPS)</label>
              <select id="setting-fps" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 6px; outline: none;">
                <option value="60">60 FPS</option>
                <option value="120">120 FPS</option>
                <option value="30">30 FPS</option>
              </select>
            </div>
            <div>
              <label style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-weight: bold;">Video Bitrate (Mbps)</label>
              <input type="range" id="setting-bitrate" min="5" max="150" value="30" style="width: 100%; accent-color: var(--accent);">
              <div style="text-align: right; color: var(--accent); font-weight: bold; margin-top: 5px;"><span id="setting-bitrate-val">30</span> Mbps</div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <input type="checkbox" id="setting-vsync" checked style="width: 18px; height: 18px; accent-color: var(--accent);">
              <label for="setting-vsync" style="color: var(--text-secondary); font-weight: bold;">Enable V-Sync</label>
            </div>
          </div>

          <div style="margin-top: 30px; display: flex; justify-content: flex-end; gap: 10px;">
            <button id="stream-settings-save" style="background: var(--accent); color: black; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer;">Save Settings</button>
          </div>
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
      document.getElementById('setting-bitrate-val').textContent = document.getElementById('setting-bitrate').value;
      document.getElementById('setting-vsync').checked = (localStorage.getItem('de_stream_vsync') !== 'false');
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
      localStorage.setItem('de_stream_vsync', document.getElementById('setting-vsync').checked);
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
    
    overlay.innerHTML = `
      <div id="stream-loading-ui" class="stream-loading" style="z-index: 10;">
        <img src="${item.image}" style="width: 120px; height: 120px; border-radius: 20px; margin-bottom: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <div class="stream-spinner"></div>
        <div style="font-size: 1.2rem; font-weight: bold; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">Connecting to Explorer RTC...</div>
        <div style="font-size: 1rem; color: #ccc; margin-top: 10px; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">Launching ${item.name}</div>
        <button class="stream-play-btn" style="margin-top: 30px; background: rgba(255,255,255,0.2); color: white; border: 1px solid rgba(255,255,255,0.4); backdrop-filter: blur(5px);" onclick="this.parentElement.parentElement.remove()">Cancel</button>
      </div>
      <img id="stream-video-feed" style="display:none; width:100%; height:100%; object-fit:contain; background:black; position: absolute; top:0; left:0; z-index: 5;" />
      <button id="stream-exit-btn" style="display:none; position:absolute; top:20px; left:20px; background:rgba(0,0,0,0.5); color:white; border:none; padding:10px 20px; border-radius:5px; cursor:pointer; z-index:1001;">Exit Stream</button>
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
        // 2. Hide loading UI and show video feed
        setTimeout(() => {
          document.getElementById('stream-loading-ui').style.display = 'none';
          const videoFeed = document.getElementById('stream-video-feed');
          const exitBtn = document.getElementById('stream-exit-btn');
          
          videoFeed.style.display = 'block';
          exitBtn.style.display = 'block';
          
          // The MJPEG stream is authenticated via a short-lived token in the URL or cookies.
          // Since we use headers usually, we can pass token in URL.
          videoFeed.src = `/stream/video?token=${encodeURIComponent(token)}`;
          
          exitBtn.onclick = () => {
            videoFeed.src = ''; // stop stream
            document.removeEventListener('keydown', handleKey);
            document.removeEventListener('keyup', handleKey);
            overlay.remove();
          };

          // --- Input Layer Setup ---
          function sendInput(payload) {
            WS.request('stream:input', payload).catch(()=>{});
          }

          videoFeed.addEventListener('mousemove', (e) => {
            const rect = videoFeed.getBoundingClientRect();
            // The videoFeed is an img using object-fit: contain.
            // For true 1:1 mapping we need to calculate the letterbox, 
            // but for a quick seamless stream, normalized coordinates work well.
            const nx = (e.clientX - rect.left) / rect.width;
            const ny = (e.clientY - rect.top) / rect.height;
            sendInput({ action: 'mousemove', nx, ny });
          });

          videoFeed.addEventListener('mousedown', (e) => {
            const btn = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
            sendInput({ action: 'mousedown', button: btn });
          });

          videoFeed.addEventListener('mouseup', (e) => {
            const btn = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
            sendInput({ action: 'mouseup', button: btn });
          });

          videoFeed.addEventListener('wheel', (e) => {
            e.preventDefault();
            sendInput({ action: 'scroll', dx: Math.sign(e.deltaX), dy: -Math.sign(e.deltaY) });
          });

          // Prevent context menu on right click
          videoFeed.addEventListener('contextmenu', e => e.preventDefault());

          // Keyboard handling
          function mapKey(e) {
            let k = e.key.toLowerCase();
            if (k === ' ') return 'space';
            if (k === 'control') return 'control';
            if (k === 'meta') return 'command';
            if (k === 'shift') return 'shift';
            if (k === 'alt') return 'alt';
            if (k === 'enter') return 'enter';
            if (k === 'escape') return 'escape';
            if (k === 'backspace') return 'backspace';
            if (k === 'arrowup') return 'up';
            if (k === 'arrowdown') return 'down';
            if (k === 'arrowleft') return 'left';
            if (k === 'arrowright') return 'right';
            return k;
          }

          function handleKey(e) {
            e.preventDefault();
            const action = e.type === 'keydown' ? 'keydown' : 'keyup';
            sendInput({ action, key: mapKey(e) });
          }

          document.addEventListener('keydown', handleKey);
          document.addEventListener('keyup', handleKey);

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

  return { render };
})();
