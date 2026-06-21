// stream.js - Stream View UI

window.StreamView = (function() {
  let container = null;
  let currentPath = '';

  function render(hostEl, pathStr) {
    container = hostEl;
    currentPath = pathStr;
    container.innerHTML = `
      <div class="stream-hero" id="stream-hero" style="background-image: url('https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&q=80&w=2000');">
        <div class="stream-hero-content">
          <div class="stream-hero-title">Library Sync</div>
          <div class="stream-hero-desc">Discovering all installed games and applications across Steam, Xbox, and Local Apps. Preparing them for zero-latency WebRTC streaming via Sunshine.</div>
          <button class="stream-play-btn" onclick="alert('Sunshine backend manager is not yet fully implemented in Phase 1!')">
            ▶ Stream Now
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
    overlay.innerHTML = `
      <div class="stream-loading">
        <div class="stream-spinner"></div>
        <div>Connecting to Sunshine WebRTC...</div>
        <div style="font-size:1rem;color:#ccc;margin-top:10px;">Launching ${item.name}</div>
        <button class="stream-play-btn" style="margin-top:30px;background:var(--bg-surface);color:white;" onclick="this.parentElement.parentElement.remove()">Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  return { render };
})();
