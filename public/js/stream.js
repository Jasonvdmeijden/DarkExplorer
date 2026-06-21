// stream.js - Stream View UI

window.StreamView = (function() {
  let container = null;
  let currentPath = '';

  function render(hostEl, pathStr) {
    container = hostEl;
    currentPath = pathStr;
    container.innerHTML = `
      <div class="stream-header" style="padding: 40px 4% 20px 4%; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 30px;">
        <h1 style="font-size: 2.5rem; font-weight: 800; margin-bottom: 10px; color: var(--text-primary);">Explorer RTC</h1>
        <p style="font-size: 1.1rem; color: var(--text-muted); max-width: 800px; line-height: 1.5;">
          Seamlessly launch and stream your installed applications and Steam library directly into the browser. Powered by hardware-accelerated zero-latency MJPEG capturing and interactive WebSocket input injection.
        </p>
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
    `;

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
    overlay.innerHTML = `
      <div id="stream-loading-ui" class="stream-loading">
        <div class="stream-spinner"></div>
        <div>Connecting to Explorer RTC...</div>
        <div style="font-size:1rem;color:#ccc;margin-top:10px;">Launching ${item.name}</div>
        <button class="stream-play-btn" style="margin-top:30px;background:var(--bg-surface);color:white;" onclick="this.parentElement.parentElement.remove()">Cancel</button>
      </div>
      <img id="stream-video-feed" style="display:none; width:100%; height:100%; object-fit:contain; background:black;" />
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
