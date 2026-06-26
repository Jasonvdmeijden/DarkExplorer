/* Netflix-style Immersive Media View & Custom Player */
const NetflixMedia = (() => {
  let hostEl = null;
  let currentPath = null;
  let catalog = null; // { movies, series }
  let activeFocusIndex = 0; // for keyboard/gamepad navigation
  let focusableElements = []; // list of DOM elements currently focusable in grid
  let activeCategory = 'all'; // 'all' | 'movies' | 'shows'
  let favoritesList = [];

  // Synced state variables
  let lastCommandTimestamp = 0;

  // Render entry point
  async function render(container, pathVal) {
    hostEl = container;
    currentPath = pathVal;
    activeFocusIndex = 0;
    focusableElements = [];

    container.innerHTML = `
      <div class="netflix-container">
        <div class="netflix-header">
          <div class="netflix-search-wrap">
            <input type="text" id="netflix-search" placeholder="Titles, genres, episodes…" spellcheck="false">
          </div>
          <div class="netflix-header-actions">
            <button id="netflix-btn-refresh" class="netflix-btn secondary">↻ <span class="label">Rescan</span></button>
          </div>
        </div>
        <div id="netflix-catalog-body" class="netflix-body">
          <div class="netflix-loader"><span class="netflix-spin"></span>Scanning Media…</div>
        </div>
      </div>
    `;

    // Bind header actions
    container.querySelector('#netflix-btn-refresh').addEventListener('click', () => render(container, pathVal));
    container.querySelector('#netflix-search').addEventListener('input', debounce(filterCatalog, 300));

    // Load data from backend
    try {
      catalog = await WS.send('fs:media-list', { path: pathVal });
      await buildCatalogUI();
      initControlLoops();
    } catch (e) {
      container.querySelector('#netflix-catalog-body').innerHTML = `
        <div class="netflix-error">
          <p>Failed to scan folder: ${e.message || e}</p>
          <button class="netflix-btn" onclick="NetflixMedia.render(document.querySelector('.view-media'), '${pathVal.replace(/\\/g, '\\\\')}')">Retry</button>
        </div>
      `;
    }
  }

  // Build the movies and series sections
  async function buildCatalogUI(filterQuery = '') {
    const body = hostEl.querySelector('#netflix-catalog-body');
    body.innerHTML = '';
    focusableElements = [];

    let movies = catalog.movies || [];
    let series = catalog.series || [];

    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      movies = movies.filter(m => m.name.toLowerCase().includes(q));
      series = series.filter(s => s.name.toLowerCase().includes(q) || s.episodes.some(e => e.name.toLowerCase().includes(q)));
    }

    // Category tab bar
    const tabBar = document.createElement('div');
    tabBar.className = 'netflix-category-tabs';
    ['all', 'movies', 'shows'].forEach(cat => {
      const tab = document.createElement('button');
      tab.className = 'netflix-category-tab' + (activeCategory === cat ? ' active' : '');
      tab.textContent = cat === 'all' ? 'All' : cat === 'movies' ? 'Movies' : 'TV Shows';
      tab.addEventListener('click', () => {
        activeCategory = cat;
        buildCatalogUI(filterQuery);
      });
      tabBar.appendChild(tab);
    });
    body.appendChild(tabBar);

    // Apply category filter
    if (activeCategory === 'movies') series = [];
    if (activeCategory === 'shows') movies = [];

    if (movies.length === 0 && series.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'netflix-empty';
      emptyDiv.innerHTML = `
        <div class="netflix-empty-icon">🎬</div>
        <h3>No media found</h3>
        <p>No video files or series folders were found in this directory. Try adding media files (.mp4, .mkv, .avi) or use the search bar to look for specific titles.</p>
      `;
      body.appendChild(emptyDiv);
      return;
    }

    // (Hero banner removed)

    // ── CONTINUE WATCHING (persisted in DB) ──
    const contItems = await getContinueWatching();
    if (contItems.length > 0) {
      body.appendChild(buildCarouselRow('Continue Watching', contItems, true));
    }

    // ── FAVORITES (persisted in DB) ──
    await loadFavorites();
    const favItems = getFavoriteItems(movies, series);
    if (favItems.length > 0) {
      body.appendChild(buildCarouselRow('My Favorites', favItems, false, 'movie'));
    }

    // ── RECENTLY ADDED ──
    const allItems = [...movies];
    series.forEach(s => { if (s.episodes) allItems.push(...s.episodes); });
    const recentItems = allItems.sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, 15);
    if (recentItems.length > 0) {
      body.appendChild(buildCarouselRow('Recently Added', recentItems, false, 'movie'));
    }

    // ── TV SHOWS / SERIES ROW ──
    if (series.length > 0) {
      body.appendChild(buildCarouselRow('TV Shows & Series', series, false, 'series'));
    }

    // ── MOVIES / VIDEOS ROW ──
    if (movies.length > 0) {
      body.appendChild(buildCarouselRow('Movies & Videos', movies, false, 'movie'));
    }

    // Set initial keyboard focus
    if (focusableElements.length > 0) {
      focusableElements[0].classList.add('focused');
    }
  }

  function buildCarouselRow(title, itemsList, isContinueRow = false, itemType = 'movie') {
    const row = document.createElement('div');
    row.className = 'netflix-row';
    row.innerHTML = `
      <h2 class="netflix-row-title">${title}</h2>
      <div class="netflix-carousel-container">
        <button class="carousel-nav-btn prev">‹</button>
        <div class="netflix-carousel"></div>
        <button class="carousel-nav-btn next">›</button>
      </div>
    `;

    const carousel = row.querySelector('.netflix-carousel');
    const token = localStorage.getItem('de_token') || '';

    itemsList.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'netflix-card';
      card.tabIndex = 0;
      card.dataset.path = item.path;

      // Extract details
      const isDir = !!item.episodes;
      const displayTitle = isDir ? item.name : (item.name.lastIndexOf('.') > 0 ? item.name.slice(0, item.name.lastIndexOf('.')) : item.name);
      const videoPath = isDir ? item.episodes[0].path : item.path;
      const mtimeVer = item.mtime ? Math.floor(item.mtime) : Date.now();
      const thumbUrl = `/thumbnail?path=${encodeURIComponent(videoPath)}&width=400&token=${token}&v=${mtimeVer}`;

      const badgesHtml = [
        item.quality ? `<span class="netflix-badge quality">${escHtml(item.quality)}</span>` : '',
        item.year ? `<span class="netflix-badge year">${escHtml(String(item.year))}</span>` : '',
        item.progress > 90 ? `<span class="netflix-badge watched">Watched ✅</span>` : ''
      ].filter(Boolean).join('');

      const isFavorited = favoritesList.includes(item.path);

      // Default thumbnail is a cheap static frame; the animated preview clip
      // is only fetched lazily on hover (desktop) or first tap (touch).
      const previewUrl = `/video-preview?path=${encodeURIComponent(videoPath)}&width=400&token=${token}&v=${mtimeVer}`;

      card.innerHTML = `
        <div class="netflix-card-media">
          <img class="netflix-card-img" src="${thumbUrl}">
          <div class="netflix-card-preview-wrap"></div>
          ${badgesHtml ? `<div class="netflix-card-badges">${badgesHtml}</div>` : ''}
        </div>
        <div class="netflix-card-meta">
          <div class="netflix-card-title-row">
            <div class="netflix-card-title">${escHtml(displayTitle)}</div>
            <button class="netflix-fav-btn${isFavorited ? ' active' : ''}" title="Favorite">♥</button>
          </div>
          <div class="netflix-card-sub">${isDir ? `${item.episodes.length} Episodes` : formatSize(item.size)}</div>
          ${isContinueRow && item.progress ? `<div class="netflix-card-progress"><div class="netflix-card-progress-bar" style="width:${item.progress}%"></div></div>` : ''}
        </div>
      `;

      // Favorite button
      const favBtn = card.querySelector('.netflix-fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(item.path, favBtn);
      });

      const imgEl = card.querySelector('.netflix-card-img');
      const previewWrap = card.querySelector('.netflix-card-preview-wrap');
      const preview = VideoPreview.makeController(previewWrap, () => previewUrl);

      // Hover preview handler (lazily loads + plays the preview clip on hover).
      // Touch fires synthetic mouseenter/mouseleave around a tap, which would
      // race with (and undo) the explicit tap-arm logic in the click handler
      // below — so hover is desktop-only, touch uses click alone.
      let hoverTimer = null;
      const startHover = () => {
        if (VideoPreview.isTouch()) return;
        hoverTimer = setTimeout(() => {
          card.classList.add('hovered');
          preview.load();
        }, 400);
      };
      const endHover = () => {
        if (VideoPreview.isTouch()) return;
        clearTimeout(hoverTimer);
        card.classList.remove('hovered');
        preview.unload();
      };

      imgEl.onerror = () => {
        const fallback = document.createElement('div');
        fallback.className = 'netflix-card-img fallback-icon';
        fallback.innerHTML = `<svg viewBox="0 0 24 24" fill="var(--text-secondary)" width="48" height="48"><path d="M4 6h16v12H4z" opacity=".3"/><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM10 8v8l6-4z"/></svg>`;
        fallback.style.display = 'flex';
        fallback.style.alignItems = 'center';
        fallback.style.justifyContent = 'center';
        fallback.style.background = 'var(--bg-hover)';
        imgEl.replaceWith(fallback);
      };

      // Mark card as loaded once the static frame arrives
      imgEl.addEventListener('load', () => card.classList.add('loaded'), { once: true });

      card.addEventListener('mouseenter', startHover);
      card.addEventListener('mouseleave', endHover);
      card.addEventListener('focus', () => {
        hostEl.querySelectorAll('.netflix-card').forEach(c => c.classList.remove('focused'));
        card.classList.add('focused');
        activeFocusIndex = focusableElements.indexOf(card);
      });
      card.addEventListener('blur', endHover);

      // Handle card select
      const selectCard = () => {
        preview.unload();
        if (isDir) {
          showSeriesDetails(item);
        } else {
          // Play directly
          playVideo(item, itemsList.filter(i => !i.episodes), itemsList.indexOf(item), 'Movies');
        }
      };
      card.addEventListener('click', (e) => {
        // Touch has no hover — first tap arms the preview instead of opening,
        // second tap (preview already loaded) opens for real.
        if (!isDir && VideoPreview.isTouch() && !preview.loaded) {
          e.preventDefault();
          e.stopPropagation();
          VideoPreview.armExclusive(preview);
          card.classList.add('hovered');
          preview.load();
          return;
        }
        selectCard();
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') selectCard();
      });

      carousel.appendChild(card);
      focusableElements.push(card);
    });

    // Wire carousel buttons
    const prev = row.querySelector('.carousel-nav-btn.prev');
    const next = row.querySelector('.carousel-nav-btn.next');
    prev.addEventListener('click', () => { carousel.scrollBy({ left: -400, behavior: 'smooth' }); });
    next.addEventListener('click', () => { carousel.scrollBy({ left: 400, behavior: 'smooth' }); });

    return row;
  }

  // ── SERIES EPISODE SELECT MODAL ──
  function showSeriesDetails(series) {
    const dialog = document.createElement('dialog');
    dialog.id = 'netflix-series-dialog';
    dialog.className = 'netflix-modal';
    document.body.appendChild(dialog);

    // Group episodes by season
    const seasonsMap = new Map();
    series.episodes.forEach(ep => {
      let list = seasonsMap.get(ep.season);
      if (!list) seasonsMap.set(ep.season, list = []);
      list.push(ep);
    });
    const seasons = Array.from(seasonsMap.keys()).sort((a, b) => a - b);

    const thumbUrl = series.episodes && series.episodes.length > 0 
      ? `/thumbnail?path=${encodeURIComponent(series.episodes[0].path)}&width=800&token=${localStorage.getItem('de_token') || ''}` 
      : '';

    dialog.innerHTML = `
      <div class="netflix-modal-wrap">
        ${thumbUrl ? `<img src="${thumbUrl}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(40px); opacity: 0.3; z-index: -1; pointer-events: none;">` : ''}
        <div class="netflix-modal-header">
          <div class="netflix-modal-title-info">
            <h2>${escHtml(series.name)}</h2>
            <span class="netflix-modal-count">${series.episodes.length} Episodes total</span>
          </div>
          <button class="netflix-modal-close">✕</button>
        </div>
        <div class="netflix-modal-body">
          <div class="netflix-season-pills" id="netflix-season-pills">
            ${seasons.map(s => `<button class="netflix-season-pill${s === seasons[0] ? ' active' : ''}" data-season="${s}">Season ${s}</button>`).join('')}
          </div>
          <div id="netflix-episodes-grid" class="netflix-episodes-grid"></div>
        </div>
      </div>
    `;

    const pillContainer = dialog.querySelector('#netflix-season-pills');
    const grid = dialog.querySelector('#netflix-episodes-grid');

    const renderSeason = (seasonNum) => {
      grid.innerHTML = '';
      const list = seasonsMap.get(seasonNum) || [];
      const token = localStorage.getItem('de_token') || '';

      list.forEach((ep, idx) => {
        const item = document.createElement('div');
        item.className = 'netflix-episode-row';
        const thumbUrl = `/thumbnail?path=${encodeURIComponent(ep.path)}&width=220&token=${token}`;
        const previewUrl = `/video-preview?path=${encodeURIComponent(ep.path)}&width=220&token=${token}`;
        const displayTitle = ep.name.slice(0, ep.name.lastIndexOf('.')) || ep.name;

        item.innerHTML = `
          <div class="netflix-episode-thumb-wrap">
            <img src="${thumbUrl}">
            <div class="netflix-episode-preview-wrap"></div>
            <div class="netflix-episode-play-icon">▶</div>
          </div>
          <div class="netflix-episode-info">
            <div class="netflix-episode-title">EPISODE ${ep.episode}: ${escHtml(displayTitle)}</div>
            <div class="netflix-episode-desc">Stream and play season ${ep.season} episode ${ep.episode} instantly inside the full-screen playback screen. Support remote inputs.</div>
            ${ep.size ? `<div class="netflix-episode-duration">${estimateDuration(ep.size)}</div>` : ''}
          </div>
        `;

        const imgEl = item.querySelector('img');
        const previewWrap = item.querySelector('.netflix-episode-preview-wrap');
        const preview = VideoPreview.makeController(previewWrap, () => previewUrl);

        // Touch fires synthetic mouseenter/mouseleave around a tap, which
        // would race with (and undo) the explicit tap-arm logic in the click
        // handler below — so hover is desktop-only, touch uses click alone.
        let hoverTimer = null;
        item.addEventListener('mouseenter', () => {
          if (VideoPreview.isTouch()) return;
          hoverTimer = setTimeout(() => preview.load(), 300);
        });
        item.addEventListener('mouseleave', () => {
          if (VideoPreview.isTouch()) return;
          clearTimeout(hoverTimer);
          preview.unload();
        });

        imgEl.onerror = () => {
          const fallback = document.createElement('div');
          fallback.className = 'fallback-icon';
          fallback.innerHTML = `<svg viewBox="0 0 24 24" fill="var(--text-secondary)" width="48" height="48"><path d="M4 6h16v12H4z" opacity=".3"/><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM10 8v8l6-4z"/></svg>`;
          fallback.style.display = 'flex';
          fallback.style.alignItems = 'center';
          fallback.style.justifyContent = 'center';
          fallback.style.background = 'var(--bg-hover)';
          fallback.style.width = '100%';
          fallback.style.height = '100%';
          imgEl.replaceWith(fallback);
        };

        const openEpisode = () => {
          preview.unload();
          dialog.close();
          dialog.remove();
          playVideo(ep, list, idx, `${series.name} - Season ${seasonNum}`);
        };
        item.addEventListener('click', (e) => {
          if (VideoPreview.isTouch() && !preview.loaded) {
            e.preventDefault();
            e.stopPropagation();
            VideoPreview.armExclusive(preview);
            preview.load();
            return;
          }
          openEpisode();
        });

        grid.appendChild(item);
      });
    };

    pillContainer.addEventListener('click', (e) => {
      const pill = e.target.closest('.netflix-season-pill');
      if (!pill) return;
      pillContainer.querySelectorAll('.netflix-season-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      renderSeason(parseInt(pill.dataset.season));
    });
    if (seasons.length > 0) renderSeason(seasons[0]);

    dialog.querySelector('.netflix-modal-close').addEventListener('click', () => {
      dialog.close();
      dialog.remove();
    });

    dialog.showModal();
  }

  // ── CUSTOM VIDEO PLAYER ──
  let activePlayer = null; // holds video player DOM references

  function playVideo(item, playlist, activeIdx, playlistName) {
    if (document.getElementById('netflix-player')) {
      document.getElementById('netflix-player').remove();
    }

    const player = document.createElement('div');
    player.id = 'netflix-player';
    player.className = 'netflix-player';
    document.body.appendChild(player);

    const token = localStorage.getItem('de_token') || '';
    const ext = item.path.includes('.') ? item.path.split('.').pop().toLowerCase() : '';
    // direct video extensions browser friendly
    const isDirect = ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'ts', 'm2ts', 'flv', 'ogv', 'mpg', 'mpeg', '3gp'].includes(ext);
    const streamUrl = `${isDirect ? '/serve' : '/transcode'}?path=${encodeURIComponent(item.path)}&token=${token}`;

    player.innerHTML = `
      <canvas id="ambient-canvas" style="filter: blur(80px); opacity: 0.5; position: absolute; inset: -10%; width: 120%; height: 120%; z-index: -1; pointer-events: none;"></canvas>
      <video id="netflix-video-el" src="${streamUrl}" playsinline>
        ${(item.subtitles || []).map((sub, i) => `<track label="CC ${i+1}" kind="subtitles" srclang="en" src="/serve?path=${encodeURIComponent(sub)}&token=${token}">`).join('')}
      </video>
      
      <!-- Custom controls layer -->
      <div id="netflix-player-controls" class="netflix-controls visible">
        <div class="netflix-controls-header">
          <button id="netflix-player-back" class="netflix-player-btn" title="Back to browsing">←</button>
          <div class="netflix-player-title-info">
            <span class="playlist-title">${escHtml(playlistName)}</span>
            <span class="episode-title">${escHtml(item.name)}</span>
          </div>
        </div>

        <div class="netflix-player-center">
          <button id="netflix-player-big-play" class="netflix-player-big-btn">▶</button>
        </div>

        <!-- Autoplay next countdown popup -->
        <div id="netflix-next-countdown" class="netflix-countdown-popup" style="display:none">
          <div class="netflix-countdown-msg">Next Episode starts in <span id="netflix-countdown-sec">5</span>s</div>
          <div class="netflix-countdown-title" id="netflix-countdown-title"></div>
          <div class="netflix-countdown-buttons">
            <button id="netflix-btn-play-now" class="netflix-btn">Play Now</button>
            <button id="netflix-btn-cancel-next" class="netflix-btn secondary">Cancel</button>
          </div>
        </div>

        <div class="netflix-controls-bottom">
          <div class="netflix-progress-area">
            <span class="netflix-time" id="netflix-time-current">00:00</span>
            <input type="range" id="netflix-scrubber" min="0" max="100" value="0">
            <span class="netflix-time" id="netflix-time-total">00:00</span>
          </div>

          <div class="netflix-buttons-row">
            <div class="buttons-left">
              <button id="netflix-player-play" class="netflix-player-btn">▶</button>
              <button id="netflix-player-rewind" class="netflix-player-btn" title="Rewind 10s">⟲ 10</button>
              <button id="netflix-player-forward" class="netflix-player-btn" title="Forward 10s">10 ⟳</button>
              
              <div class="netflix-volume-wrap">
                ${item.subtitles && item.subtitles.length > 0 ? `<button id="netflix-player-cc" class="netflix-player-btn" title="Subtitles">CC</button>` : ''}
                <button id="netflix-player-mute" class="netflix-player-btn">🔊</button>
                <input type="range" id="netflix-volume" min="0" max="1" step="0.05" value="1">
              </div>
            </div>

            <div class="buttons-right">
              ${playlist.length > 1 && activeIdx < playlist.length - 1 ? `<button id="netflix-player-next" class="netflix-player-btn" title="Next Episode">⏭</button>` : ''}
              <select id="netflix-speed" class="netflix-speed-select">
                <option value="0.5">0.5x</option>
                <option value="1" selected>1.0x</option>
                <option value="1.25">1.25x</option>
                <option value="1.5">1.5x</option>
                <option value="2">2.0x</option>
              </select>
              <button id="netflix-player-settings" class="netflix-player-btn" title="Settings">⚙</button>
              <button id="netflix-player-pip" class="netflix-player-btn" title="Picture in Picture">📺</button>
              <button id="netflix-player-fullscreen" class="netflix-player-btn" title="Full Screen">⛶</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Settings popup -->
      <div id="netflix-settings-popup" class="netflix-settings-popup">
        <h4>Quality Info</h4>
        <div class="settings-info-grid" id="settings-quality-info">
          <span class="info-label">Loading…</span><span class="info-value"></span>
        </div>
        <h4>Playback</h4>
        <div class="settings-row">
          <label>Quality</label>
          <select id="settings-quality-select" class="netflix-speed-select">
            <option value="auto" selected>Auto</option>
            <option value="1080">1080p</option>
            <option value="720">720p</option>
            <option value="480">480p</option>
          </select>
        </div>
        <div class="settings-row">
          <label>Auto-play next</label>
          <button id="settings-autoplay-toggle" class="settings-toggle active"></button>
        </div>
        <h4>Video Filters</h4>
        <div class="settings-row">
          <label>Brightness</label>
          <input type="range" id="settings-brightness" min="50" max="150" value="100">
          <span class="settings-value" id="settings-brightness-val">100%</span>
        </div>
        <div class="settings-row">
          <label>Contrast</label>
          <input type="range" id="settings-contrast" min="50" max="150" value="100">
          <span class="settings-value" id="settings-contrast-val">100%</span>
        </div>
      </div>

      <!-- Seek animation overlays -->
      <div id="netflix-seek-left" class="netflix-seek-overlay left" style="display:none">-10s</div>
      <div id="netflix-seek-right" class="netflix-seek-overlay right" style="display:none">+10s</div>
    `;

    const video = player.querySelector('#netflix-video-el');
    video.addEventListener('error', () => {
      if (video.src.indexOf('/transcode') === -1) {
        console.log('[NetflixMedia] Playback failed directly, falling back to transcode');
        video.src = `/transcode?path=${encodeURIComponent(item.path)}&token=${token}`;
        video.load();
        video.play().catch(e => console.warn('[NetflixMedia] Auto-play retry failed:', e.message));
      }
    });
    const controls = player.querySelector('#netflix-player-controls');
    const playBtn = player.querySelector('#netflix-player-play');
    const bigPlayBtn = player.querySelector('#netflix-player-big-play');
    const scrubber = player.querySelector('#netflix-scrubber');
    const timeCur = player.querySelector('#netflix-time-current');
    const timeTot = player.querySelector('#netflix-time-total');
    const volRange = player.querySelector('#netflix-volume');
    const muteBtn = player.querySelector('#netflix-player-mute');
    const speedSelect = player.querySelector('#netflix-speed');

    // Ambient Lighting Update
    const canvas = player.querySelector('#ambient-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      let ambientAnimationFrame;
      function updateAmbientLight() {
        if (!video.paused && !video.ended && video.readyState >= 2) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        ambientAnimationFrame = requestAnimationFrame(updateAmbientLight);
      }
      video.addEventListener('loadeddata', () => {
        canvas.width = 100;
        canvas.height = 100;
        updateAmbientLight();
      });
    }

    // CC Toggle
    const ccBtn = player.querySelector('#netflix-player-cc');
    if (ccBtn) {
      ccBtn.addEventListener('click', () => {
        const textTracks = video.textTracks;
        if (textTracks.length > 0) {
          const isShowing = textTracks[0].mode === 'showing';
          for (let i = 0; i < textTracks.length; i++) {
            textTracks[i].mode = isShowing ? 'hidden' : 'showing';
          }
          ccBtn.style.opacity = isShowing ? '0.5' : '1';
        }
      });
    }

    // Quality Selector
    const qualitySelect = player.querySelector('#settings-quality-select');
    if (qualitySelect) {
      qualitySelect.addEventListener('change', () => {
        const q = qualitySelect.value;
        const curTime = video.currentTime;
        const isPlaying = !video.paused;
        let newSrc = streamUrl;
        if (q !== 'auto') {
          newSrc += `&quality=${q}`;
        }
        video.src = newSrc;
        video.load();
        video.currentTime = curTime;
        if (isPlaying) video.play();
      });
    }

    activePlayer = {
      video,
      playlist,
      activeIdx,
      playlistName,
      item
    };

    // Auto-enter Fullscreen on play
    if (player.requestFullscreen) player.requestFullscreen();

    // Sync state for remote control on startup
    State.set('mediaStatus', {
      path: item.path,
      title: item.name,
      playing: false,
      currentTime: 0,
      duration: 0
    });

    // Control bar hide timeline
    let controlTimer = null;
    const showControls = () => {
      controls.classList.add('visible');
      player.style.cursor = 'default';
      clearTimeout(controlTimer);
      controlTimer = setTimeout(() => {
        if (!video.paused) {
          controls.classList.remove('visible');
          player.style.cursor = 'none';
        }
      }, 3500);
    };
    player.addEventListener('mousemove', showControls);
    player.addEventListener('click', showControls);

    // Toggle Play/Pause
    const togglePlay = () => {
      if (video.paused) {
        video.play();
        playBtn.textContent = '⏸';
        bigPlayBtn.style.display = 'none';
      } else {
        video.pause();
        playBtn.textContent = '▶';
        bigPlayBtn.style.display = 'flex';
        bigPlayBtn.textContent = '▶';
        showControls();
      }
      // Update sync state
      const state = State.get('mediaStatus', {});
      State.set('mediaStatus', { ...state, playing: !video.paused });
    };

    playBtn.addEventListener('click', togglePlay);
    bigPlayBtn.addEventListener('click', togglePlay);
    let lastTap = 0;
    video.addEventListener('click', (e) => {
      e.stopPropagation();
      const now = Date.now();
      const isTouch = e.pointerType === 'touch' || matchMedia('(hover: none)').matches;
      
      if (now - lastTap < 300) {
        // Double tap
        const rect = video.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < rect.width / 2) {
          video.currentTime = Math.max(0, video.currentTime - 10);
          showRipple(e.clientX, e.clientY, '⟲ 10s');
        } else {
          video.currentTime = Math.min(video.duration, video.currentTime + 10);
          showRipple(e.clientX, e.clientY, '10s ⟳');
        }
      } else {
        // Single tap
        if (isTouch) {
          if (controls.classList.contains('visible') && !video.paused) {
            controls.classList.remove('visible');
          } else {
            showControls();
          }
        } else {
          togglePlay();
        }
      }
      lastTap = now;
    });

    function showRipple(x, y, text) {
      const ripple = document.createElement('div');
      ripple.className = 'netflix-seek-ripple';
      ripple.textContent = text;
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';
      player.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    }

    // Timeline timeupdates
    video.addEventListener('timeupdate', () => {
      if (video.duration) {
        const pct = (video.currentTime / video.duration) * 100;
        scrubber.value = pct;
        timeCur.textContent = formatTime(video.currentTime);
        timeTot.textContent = formatTime(video.duration);

        // Sync to remote periodically (throttled)
        if (Math.floor(video.currentTime) % 2 === 0) {
          const state = State.get('mediaStatus', {});
          State.set('mediaStatus', {
            ...state,
            currentTime: video.currentTime,
            duration: video.duration
          });
        }
      }
    });

    video.addEventListener('loadedmetadata', () => {
      timeTot.textContent = formatTime(video.duration);
      const state = State.get('mediaStatus', {});
      State.set('mediaStatus', { ...state, duration: video.duration });
      video.play();
      playBtn.textContent = '⏸';
      bigPlayBtn.style.display = 'none';
    });

    // Scrubber seek input
    scrubber.addEventListener('input', () => {
      const seekTime = (scrubber.value / 100) * video.duration;
      video.currentTime = seekTime;
      timeCur.textContent = formatTime(seekTime);
    });

    // Volume controls
    volRange.addEventListener('input', () => {
      video.volume = volRange.value;
      muteBtn.textContent = video.volume === 0 ? '🔇' : '🔊';
    });
    muteBtn.addEventListener('click', () => {
      if (video.volume > 0) {
        video.volume = 0;
        volRange.value = 0;
        muteBtn.textContent = '🔇';
      } else {
        video.volume = 1;
        volRange.value = 1;
        muteBtn.textContent = '🔊';
      }
    });

    // Rewind/Forward 10s
    player.querySelector('#netflix-player-rewind').addEventListener('click', () => { video.currentTime = Math.max(0, video.currentTime - 10); });
    player.querySelector('#netflix-player-forward').addEventListener('click', () => { video.currentTime = Math.min(video.duration, video.currentTime + 10); });

    // Speed playback rate
    speedSelect.addEventListener('change', () => {
      video.playbackRate = parseFloat(speedSelect.value);
    });

    // PiP Mode
    player.querySelector('#netflix-player-pip').addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch (e) { console.error(e); }
    });

    // Fullscreen toggle
    const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
        player.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    };
    player.querySelector('#netflix-player-fullscreen').addEventListener('click', toggleFullscreen);

    // ── Settings gear menu ──
    let autoplayNext = true;
    const settingsPopup = player.querySelector('#netflix-settings-popup');
    const settingsBtn = player.querySelector('#netflix-player-settings');
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsPopup.classList.toggle('open');
      if (settingsPopup.classList.contains('open') && !settingsPopup.dataset.loaded) {
        settingsPopup.dataset.loaded = 'true';
        fetch(`/media-info?path=${encodeURIComponent(item.path)}&token=${token}`)
          .then(r => r.json())
          .then(info => {
            const grid = settingsPopup.querySelector('#settings-quality-info');
            const v = info.video || {};
            const a = info.audio || {};
            const f = info.format || {};
            const bitrate = v.bit_rate || f.bit_rate;
            const isHDR = v.color_transfer && v.color_transfer !== 'bt709' && v.color_transfer !== 'unknown';
            grid.innerHTML = `
              <span class="info-label">Resolution</span><span class="info-value">${v.width || '?'}×${v.height || '?'}</span>
              <span class="info-label">Video Codec</span><span class="info-value">${v.codec_name || 'Unknown'}${v.profile ? ' (' + v.profile + ')' : ''}</span>
              <span class="info-label">Bitrate</span><span class="info-value">${bitrate ? Math.round(bitrate / 1000) + ' kbps' : 'N/A'}</span>
              <span class="info-label">Audio</span><span class="info-value">${a.codec_name || 'N/A'}${a.channels ? ' · ' + a.channels + 'ch' : ''}${a.channel_layout ? ' (' + a.channel_layout + ')' : ''}</span>
              ${isHDR ? '<span class="info-label">HDR</span><span class="info-value" style="color:#ffcc00">✓ ' + (v.color_transfer || '') + '</span>' : ''}
              <span class="info-label">Container</span><span class="info-value">${f.format_name || 'N/A'}</span>
            `;
          })
          .catch(() => {
            settingsPopup.querySelector('#settings-quality-info').innerHTML =
              '<span class="info-label">Unavailable</span><span class="info-value">—</span>';
          });
      }
    });

    const autoplayToggle = player.querySelector('#settings-autoplay-toggle');
    autoplayToggle.addEventListener('click', () => {
      autoplayNext = !autoplayNext;
      autoplayToggle.classList.toggle('active', autoplayNext);
    });

    const brightnessSlider = player.querySelector('#settings-brightness');
    const contrastSlider = player.querySelector('#settings-contrast');
    const brightnessVal = player.querySelector('#settings-brightness-val');
    const contrastVal = player.querySelector('#settings-contrast-val');
    const applyFilters = () => {
      video.style.filter = `brightness(${brightnessSlider.value}%) contrast(${contrastSlider.value}%)`;
      brightnessVal.textContent = brightnessSlider.value + '%';
      contrastVal.textContent = contrastSlider.value + '%';
    };
    brightnessSlider.addEventListener('input', applyFilters);
    contrastSlider.addEventListener('input', applyFilters);

    player.addEventListener('click', () => settingsPopup.classList.remove('open'));
    settingsPopup.addEventListener('click', (e) => e.stopPropagation());

    // ── Double-tap to seek ──
    video.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = video.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const mid = rect.width / 2;
      if (x < mid) {
        video.currentTime = Math.max(0, video.currentTime - 10);
        showSeekAnimation('left');
      } else {
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
        showSeekAnimation('right');
      }
    });

    function showSeekAnimation(side) {
      const overlay = player.querySelector(`#netflix-seek-${side}`);
      if (!overlay) return;
      overlay.style.display = 'flex';
      overlay.style.animation = 'none';
      overlay.offsetHeight;
      overlay.style.animation = '';
      setTimeout(() => { overlay.style.display = 'none'; }, 600);
    }

    // ── Keyboard shortcuts in player ──
    const playerKeyHandler = (e) => {
      if (!document.getElementById('netflix-player')) {
        document.removeEventListener('keydown', playerKeyHandler);
        return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          showSeekAnimation('left');
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
          showSeekAnimation('right');
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          volRange.value = video.volume;
          muteBtn.textContent = video.volume === 0 ? '🔇' : '🔊';
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          volRange.value = video.volume;
          muteBtn.textContent = video.volume === 0 ? '🔇' : '🔊';
          break;
        case 'f': case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm': case 'M':
          e.preventDefault();
          muteBtn.click();
          break;
      }
    };
    document.addEventListener('keydown', playerKeyHandler);

    // Back to browse close
    const exitPlayer = () => {
      // Save progress to "continue watching" list
      if (video.duration && video.currentTime > 5) {
        saveContinueWatching(item, (video.currentTime / video.duration) * 100, video.currentTime, video.duration);
      }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      player.remove();
      activePlayer = null;
      // Tell remotes/controllers the player is gone so they hide their media UI.
      State.set('mediaStatus', { title: null, playing: false, currentTime: 0, duration: 0, closed: true });
      buildCatalogUI(); // Rebuild to sync continue watching row
    };
    player.querySelector('#netflix-player-back').addEventListener('click', exitPlayer);

    // ESC closes player
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        exitPlayer();
        document.removeEventListener('keydown', escHandler);
      }
    });

    // Play next button
    const nextBtn = player.querySelector('#netflix-player-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => playNextEpisodeDirect());
    }

    // Ended handler (Trigger next episode autoplay countdown)
    video.addEventListener('ended', () => {
      // Mark as finished (remove from continue watching)
      removeContinueWatching(item.path);

      if (autoplayNext && playlist.length > 1 && activeIdx < playlist.length - 1) {
        triggerAutoplayCountdown(playlist[activeIdx + 1], playlist, activeIdx + 1, playlistName);
      } else {
        exitPlayer();
      }
    });
  }

  // Autoplay countdown overlay
  let autoplayTimer = null;
  let autoplayInterval = null;

  function triggerAutoplayCountdown(nextItem, playlist, nextIdx, playlistName) {
    const countdownPopup = document.getElementById('netflix-next-countdown');
    if (!countdownPopup) return;

    countdownPopup.style.display = 'flex';
    countdownPopup.querySelector('#netflix-countdown-title').textContent = nextItem.name;

    let sec = 5;
    countdownPopup.querySelector('#netflix-countdown-sec').textContent = sec;

    const playNowBtn = countdownPopup.querySelector('#netflix-btn-play-now');
    const cancelBtn = countdownPopup.querySelector('#netflix-btn-cancel-next');

    const triggerPlay = () => {
      clearInterval(autoplayInterval);
      clearTimeout(autoplayTimer);
      countdownPopup.style.display = 'none';
      playVideo(nextItem, playlist, nextIdx, playlistName);
    };

    const cancelPlay = () => {
      clearInterval(autoplayInterval);
      clearTimeout(autoplayTimer);
      countdownPopup.style.display = 'none';
      const player = document.getElementById('netflix-player');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (player) player.remove();
      activePlayer = null;
      State.set('mediaStatus', { title: null, playing: false, currentTime: 0, duration: 0, closed: true });
      buildCatalogUI();
    };

    playNowBtn.onclick = triggerPlay;
    cancelBtn.onclick = cancelPlay;

    autoplayInterval = setInterval(() => {
      sec--;
      countdownPopup.querySelector('#netflix-countdown-sec').textContent = sec;
      if (sec <= 0) clearInterval(autoplayInterval);
    }, 1000);

    autoplayTimer = setTimeout(triggerPlay, 5000);
  }

  function playNextEpisodeDirect() {
    if (!activePlayer) return;
    const { playlist, activeIdx, playlistName } = activePlayer;
    if (activeIdx < playlist.length - 1) {
      playVideo(playlist[activeIdx + 1], playlist, activeIdx + 1, playlistName);
    }
  }

  function playPrevEpisodeDirect() {
    if (!activePlayer) return;
    const { video, playlist, activeIdx, playlistName } = activePlayer;
    // Mirror typical media players: restart the current item unless we're near
    // its start, in which case step to the previous one.
    if (video && video.currentTime > 3) { video.currentTime = 0; return; }
    if (activeIdx > 0) playVideo(playlist[activeIdx - 1], playlist, activeIdx - 1, playlistName);
    else if (video) video.currentTime = 0;
  }

  // ── KEYBOARD & GAMEPAD CONTROLS ──
  let controlLoopActive = false;

  function initControlLoops() {
    if (controlLoopActive) return;
    controlLoopActive = true;

    // Keyboard Arrow navigation for tiles
    document.addEventListener('keydown', (e) => {
      const activeDialog = document.getElementById('netflix-series-dialog');
      if (activeDialog || activePlayer) return; // Ignore if video playing or modal open
      if (!hostEl || !hostEl.isConnected) return;

      const viewMode = localStorage.getItem('de_view');
      if (viewMode !== 'media') return;

      if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        navigateGrid(e.key);
      }
    });

    // Gamepad API Loop
    function pollGamepad() {
      if (!hostEl || !hostEl.isConnected) {
        controlLoopActive = false;
        return;
      }
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = Array.from(gamepads).find(g => g && g.connected);

      if (gp) {
        handleGamepadInput(gp);
      }

      // Up Next early trigger
      if (activePlayer && activePlayer.video && !activePlayer.video.paused) {
        const { video, playlist, activeIdx, playlistName } = activePlayer;
        if (video.duration && video.currentTime > video.duration - 15) {
          if (playlist.length > 1 && activeIdx < playlist.length - 1) {
             const countdownPopup = document.getElementById('netflix-next-countdown');
             if (countdownPopup && countdownPopup.style.display !== 'flex') {
               countdownPopup.classList.add('early-overlay');
               countdownPopup.style.display = 'flex';
               countdownPopup.style.position = 'absolute';
               countdownPopup.style.bottom = '100px';
               countdownPopup.style.right = '40px';
               countdownPopup.style.transform = 'none';
               countdownPopup.style.width = '300px';
               countdownPopup.style.zIndex = '9999';

               const nextItem = playlist[activeIdx + 1];
               countdownPopup.querySelector('#netflix-countdown-title').textContent = nextItem.name;
               
               const playNowBtn = countdownPopup.querySelector('#netflix-btn-play-now');
               const cancelBtn = countdownPopup.querySelector('#netflix-btn-cancel-next');
               
               playNowBtn.onclick = () => {
                 countdownPopup.style.display = 'none';
                 playVideo(nextItem, playlist, activeIdx + 1, playlistName);
               };
               cancelBtn.onclick = () => {
                 countdownPopup.style.display = 'none';
                 countdownPopup.classList.remove('early-overlay');
               };
             }
             if (countdownPopup && countdownPopup.style.display === 'flex') {
               const sec = Math.ceil(video.duration - video.currentTime);
               countdownPopup.querySelector('#netflix-countdown-sec').textContent = sec;
             }
          }
        }
      }

      requestAnimationFrame(pollGamepad);
    }
    requestAnimationFrame(pollGamepad);

    // Cross-device Remote listener (mediaStatus & mediaCommand)
    State.onChange('mediaCommand', (cmdObj) => {
      if (!cmdObj || cmdObj.timestamp <= lastCommandTimestamp) return;
      lastCommandTimestamp = cmdObj.timestamp;
      
      // We are the playback client executing commands received from phone remote
      if (activePlayer && activePlayer.video) {
        const video = activePlayer.video;
        switch (cmdObj.command) {
          case 'play': video.play(); break;
          case 'pause': video.pause(); break;
          case 'rewind': video.currentTime = Math.max(0, video.currentTime - 10); break;
          case 'forward': video.currentTime = Math.min(video.duration, video.currentTime + 10); break;
          case 'seek': video.currentTime = (cmdObj.value / 100) * video.duration; break;
          case 'volume': video.volume = cmdObj.value; break;
          case 'next': playNextEpisodeDirect(); break;
          case 'prev': playPrevEpisodeDirect(); break;
          case 'close':
            const closeBtn = document.getElementById('netflix-player-back');
            if (closeBtn) closeBtn.click();
            break;
        }
      }
    });
  }

  // Grid Keyboard / Gamepad Navigation Helper
  function navigateGrid(direction) {
    if (focusableElements.length === 0) return;
    const focused = hostEl.querySelector('.netflix-card.focused');
    if (!focused) {
      focusableElements[0].focus();
      return;
    }

    let nextEl = null;
    const cardsPerRow = getCardsPerRow();

    switch (direction) {
      case 'ArrowRight':
        nextEl = focusableElements[activeFocusIndex + 1];
        break;
      case 'ArrowLeft':
        nextEl = focusableElements[activeFocusIndex - 1];
        break;
      case 'ArrowDown':
        nextEl = focusableElements[activeFocusIndex + cardsPerRow];
        break;
      case 'ArrowUp':
        nextEl = focusableElements[activeFocusIndex - cardsPerRow];
        break;
    }

    if (nextEl) {
      nextEl.focus();
      nextEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function getCardsPerRow() {
    const width = window.innerWidth;
    if (width > 1200) return 5;
    if (width > 800) return 4;
    return 2;
  }

  // Gamepad axis & button mappings
  let lastButtonPress = 0;
  let lastAxisMove = 0;

  function handleGamepadInput(gp) {
    const now = Date.now();
    const activeDialog = document.getElementById('netflix-series-dialog');

    // Axes mapping for DPAD / Joysticks (nav cards)
    if (now - lastAxisMove > 250) {
      const axisX = gp.axes[0];
      const axisY = gp.axes[1];
      
      if (axisX > 0.5)  { navigateGrid('ArrowRight'); lastAxisMove = now; }
      else if (axisX < -0.5) { navigateGrid('ArrowLeft'); lastAxisMove = now; }
      else if (axisY > 0.5)  { navigateGrid('ArrowDown'); lastAxisMove = now; }
      else if (axisY < -0.5) { navigateGrid('ArrowUp'); lastAxisMove = now; }
    }

    // Button mapping
    if (now - lastButtonPress > 280) {
      // Button index 0 is 'A' (Xbox) or 'Cross' (PS)
      if (gp.buttons[0].pressed) {
        lastButtonPress = now;
        const focused = hostEl.querySelector('.netflix-card.focused');
        if (activePlayer) {
          // toggle playback
          const playBtn = document.getElementById('netflix-player-play');
          if (playBtn) playBtn.click();
        } else if (activeDialog) {
          // play selected episode if dialog open (just play first episode for mock)
          const firstRow = activeDialog.querySelector('.netflix-episode-row');
          if (firstRow) firstRow.click();
        } else if (focused) {
          focused.click();
        }
      }

      // Button index 1 is 'B' (Xbox) or 'Circle' (PS) -> Back / Close
      if (gp.buttons[1].pressed) {
        lastButtonPress = now;
        if (activePlayer) {
          const backBtn = document.getElementById('netflix-player-back');
          if (backBtn) backBtn.click();
        } else if (activeDialog) {
          const closeBtn = activeDialog.querySelector('.netflix-modal-close');
          if (closeBtn) closeBtn.click();
        }
      }

      // Play/Pause mapping to Start button (button 9)
      if (gp.buttons[9].pressed && activePlayer) {
        lastButtonPress = now;
        const playBtn = document.getElementById('netflix-player-play');
        if (playBtn) playBtn.click();
      }
    }
  }

  // ── CONTINUE WATCHING STORAGE ──
  async function getContinueWatching() {
    try {
      const token = localStorage.getItem('de_token') || '';
      const res = await fetch(`/media-progress?token=${token}`);
      const data = await res.json();
      return data.map(item => {
        let matched = catalog.movies?.find(m => m.path === item.path);
        if (!matched) {
          for (const s of catalog.series || []) {
            matched = s.episodes?.find(e => e.path === item.path);
            if (matched) break;
          }
        }
        if (!matched) return null;
        return {
          ...matched,
          progress: item.progress_pct,
          time: item.current_time
        };
      }).filter(Boolean);
    } catch { return []; }
  }

  function saveContinueWatching(item, progress, time, duration) {
    const token = localStorage.getItem('de_token') || '';
    fetch(`/media-progress?token=${token}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ path: item.path, progress_pct: progress, current_time: time, duration })
    }).catch(()=>{});
  }

  function removeContinueWatching(path) {
    const token = localStorage.getItem('de_token') || '';
    fetch(`/media-progress?token=${token}`, {
      method: 'DELETE',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ path })
    }).catch(()=>{});
  }

  // ── FAVORITES STORAGE ──
  async function loadFavorites() {
    try {
      const token = localStorage.getItem('de_token') || '';
      const res = await fetch(`/media-favorites?token=${token}`);
      const data = await res.json();
      favoritesList = data.map(d => d.path);
    } catch {
      favoritesList = [];
    }
  }

  function getFavoriteItems(allMovies, allSeries) {
    const res = [];
    for (const path of favoritesList) {
      let matched = allMovies.find(m => m.path === path);
      if (!matched) {
        matched = allSeries.find(s => s.path === path);
      }
      if (matched) res.push(matched);
    }
    return res;
  }

  function toggleFavorite(path, btnEl) {
    const isFav = favoritesList.includes(path);
    const method = isFav ? 'DELETE' : 'POST';
    const token = localStorage.getItem('de_token') || '';
    
    if (isFav) {
      favoritesList = favoritesList.filter(p => p !== path);
      btnEl.classList.remove('active');
    } else {
      favoritesList.push(path);
      btnEl.classList.add('active');
    }

    fetch(`/media-favorites?token=${token}`, {
      method,
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ path })
    }).then(() => {
      // Re-render UI to update Favorites row
      buildCatalogUI();
    }).catch(()=>{});
  }

  // ── UTILS ──
  function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  
  function formatSize(b) {
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    return (b/1048576).toFixed(1) + ' MB';
  }

  function formatTime(sec) {
    const s = Math.floor(sec || 0);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const ss = String(s % 60).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    if (h > 0) return `${h}:${mm}:${ss}`;
    return `${mm}:${ss}`;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function filterCatalog() {
    const val = hostEl.querySelector('#netflix-search').value;
    buildCatalogUI(val);
  }

  function showPropertiesPopup(item) {
    if (window.Preview && Preview.showProperties) {
      Preview.showProperties(item);
    }
  }

  function estimateDuration(sizeBytes) {
    if (!sizeBytes) return '';
    const kbps = 694;
    const totalSec = Math.round(sizeBytes / 1024 / kbps);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h > 0) return `~${h}h ${m}m`;
    if (m > 0) return `~${m} min`;
    return '< 1 min';
  }

  return { render };
})();
