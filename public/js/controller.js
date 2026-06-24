const ControllerMode = (() => {
  let active = false;
  let ws = null;
  let overlay = null;
  let gyroEnabled = false;

  // Touch tracking
  let touchStartPos = { x: 0, y: 0 };
  let lastTouchPos = { x: 0, y: 0 };
  let isScrolling = false;
  let touchStartT = 0;
  
  function init() {
    const btn = document.getElementById('btn-controller-mode');
    if (!btn) return;

    // Only show on remote mobile/touch devices (never on host PC)
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      btn.style.display = 'inline-block';
    }

    btn.addEventListener('click', toggle);
  }

  function toggle() {
    active = !active;
    if (active) {
      document.body.classList.add('controller-mode-active');
      createOverlay();
      connectWs();
    } else {
      document.body.classList.remove('controller-mode-active');
      destroyOverlay();
      if (ws) ws.close();
    }
  }

  function connectWs() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = localStorage.getItem('de_token') || '';
    ws = new WebSocket(`${protocol}//${window.location.host}/?token=${token}`);
    ws.onclose = () => { if (active) setTimeout(connectWs, 2000); };
  }

  function send(action, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stream:input', payload: { action, ...payload } }));
    }
  }

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'controller-overlay';
    overlay.innerHTML = `
      <div class="controller-header" style="display:flex; padding: 1rem; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.5);">
        <button class="controller-btn icon-btn" id="ctrl-close" style="width: 40px; height: 40px; border-radius: 50%; font-size:1.5rem;">&times;</button>
        <span style="flex-grow: 1; text-align: center; font-weight: bold; font-size: 1.2rem; letter-spacing: 2px;">TRACKPAD</span>
        <button class="controller-btn icon-btn" id="ctrl-keyboard" style="width: 40px; height: 40px; border-radius: 50%; margin-right: 10px; font-size:1.2rem;">⌨️</button>
        <button class="controller-btn icon-btn" id="ctrl-gyro" style="width: 40px; height: 40px; border-radius: 50%; font-size:1.2rem;">🧭</button>
      </div>
      
      <div class="controller-trackpad" id="ctrl-trackpad" style="flex-grow:1; display:flex; align-items:center; justify-content:center; touch-action:none;">
        <div class="trackpad-hint" style="color:rgba(255,255,255,0.3); text-align:center; pointer-events:none;">
          1-Finger: Move & Tap to Click<br>
          2-Finger: Scroll & Tap to Right-Click<br>
          3-Finger: Tap for Middle-Click
        </div>
      </div>
      
      <div class="controller-media-controls netflix-remote-panel" style="display:none; width:100%; box-sizing:border-box; background:rgba(0,0,0,0.85); padding:1.5rem; border-top:1px solid rgba(255,255,255,0.1);">
        <div class="remote-keypad" style="margin-bottom:20px; justify-content:center; gap:20px;">
          <button class="remote-btn" data-cmd="minimize" title="Minimize / Fullscreen" style="font-size:1.5rem; border:none; background:none;">🗕</button>
          <button class="remote-btn control-rewind" data-cmd="rewind" title="Rewind 10s">⟲ 10</button>
          <button class="remote-btn control-play active" data-cmd="toggle-play" id="ctrl-play-toggle" style="width:70px; height:70px; border-radius:50%; font-size:2rem; flex-shrink:0;">▶</button>
          <button class="remote-btn control-forward" data-cmd="forward" title="Forward 10s">10 ⟳</button>
          <button class="remote-btn" data-cmd="cast" title="Cast" style="font-size:1.5rem; border:none; background:none;">📺</button>
        </div>

        <div class="remote-volume-row" style="margin-bottom:20px;">
          <span style="font-size:1.2rem;">🔈</span>
          <input type="range" id="ctrl-volume" min="0" max="1" step="0.1" value="1" style="flex-grow:1;">
          <span style="font-size:1.2rem;">🔊</span>
        </div>

        <div style="text-align:center;">
          <button class="netflix-btn danger" data-cmd="close" style="padding:10px 30px; font-size:1.1rem; border-radius:20px;">Exit Playback</button>
        </div>
      </div>

      <div class="controller-dpad" style="padding: 1rem; display:flex; flex-direction:column; align-items:center; background:rgba(0,0,0,0.3);">
        <button class="dpad-btn" data-key="up" style="width:50px; height:50px; margin-bottom:5px; border-radius:8px; background:var(--bg-hover); color:#fff; border:none; font-size:1.5rem;">▲</button>
        <div class="dpad-row" style="display:flex; gap: 55px; position:relative;">
          <button class="dpad-btn" data-key="left" style="width:50px; height:50px; border-radius:8px; background:var(--bg-hover); color:#fff; border:none; font-size:1.5rem;">◀</button>
          <button class="dpad-btn" data-key="down" style="width:50px; height:50px; border-radius:8px; background:var(--bg-hover); color:#fff; border:none; font-size:1.5rem; position:absolute; left:calc(50% - 25px);">▼</button>
          <button class="dpad-btn" data-key="right" style="width:50px; height:50px; border-radius:8px; background:var(--bg-hover); color:#fff; border:none; font-size:1.5rem;">▶</button>
          <button class="dpad-btn" data-key="enter" style="width:50px; height:50px; border-radius:8px; background:var(--accent); color:#fff; border:none; font-size:1rem; position:absolute; right:-75px;">↵</button>
        </div>
      </div>
      
      <!-- Hidden native input to trigger mobile keyboard -->
      <input type="text" id="ctrl-hidden-input" style="position: absolute; top: -1000px; opacity: 0;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
    `;
    
    // Styling the overlay
    Object.assign(overlay.style, {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(15,15,20,0.95)',
      backdropFilter: 'blur(10px)',
      zIndex: 9999,
      display: 'flex', flexDirection: 'column',
      color: '#fff'
    });
    
    document.body.appendChild(overlay);

    overlay.querySelector('#ctrl-close').onclick = toggle;
    
    // Keyboard Logic
    const hiddenInput = overlay.querySelector('#ctrl-hidden-input');
    overlay.querySelector('#ctrl-keyboard').onclick = () => {
      hiddenInput.focus();
      hiddenInput.click();
    };
    hiddenInput.addEventListener('input', (e) => {
      if (e.data) {
        send('type', { string: e.data });
      }
      hiddenInput.value = '';
    });
    hiddenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Enter') {
        send('keydown', { key: e.key.toLowerCase() });
        setTimeout(() => send('keyup', { key: e.key.toLowerCase() }), 50);
      }
    });

    // Gyro Logic
    const gyroBtn = overlay.querySelector('#ctrl-gyro');
    gyroBtn.onclick = () => {
      if (!gyroEnabled && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(state => {
          if (state === 'granted') toggleGyro(gyroBtn);
        });
      } else {
        toggleGyro(gyroBtn);
      }
    };

    // D-Pad
    overlay.querySelectorAll('.dpad-btn').forEach(btn => {
      btn.ontouchstart = (e) => { e.preventDefault(); btn.style.background = 'var(--accent)'; send('keydown', { key: btn.dataset.key }); };
      btn.ontouchend = (e) => { e.preventDefault(); btn.style.background = 'var(--bg-hover)'; send('keyup', { key: btn.dataset.key }); };
    });

    // Media Controls & D-Pad Toggling
    const mediaCtrlBar = overlay.querySelector('.controller-media-controls');
    const dpadPanel = overlay.querySelector('.controller-dpad');
    
    if (typeof State !== 'undefined') {
      const playToggle = mediaCtrlBar.querySelector('#ctrl-play-toggle');
      const volume = mediaCtrlBar.querySelector('#ctrl-volume');

      const sendRemoteCmd = (command, value = null) => {
        State.set('mediaCommand', { command, value, timestamp: Date.now() });
      };

      playToggle.addEventListener('click', (e) => {
        e.preventDefault();
        const isPlaying = playToggle.textContent.trim() === '⏸';
        sendRemoteCmd(isPlaying ? 'pause' : 'play');
      });

      mediaCtrlBar.querySelector('[data-cmd="rewind"]').addEventListener('click', (e) => { e.preventDefault(); sendRemoteCmd('rewind'); });
      mediaCtrlBar.querySelector('[data-cmd="forward"]').addEventListener('click', (e) => { e.preventDefault(); sendRemoteCmd('forward'); });
      mediaCtrlBar.querySelector('[data-cmd="close"]').addEventListener('click', (e) => { e.preventDefault(); sendRemoteCmd('close'); });
      mediaCtrlBar.querySelector('[data-cmd="minimize"]').addEventListener('click', (e) => { e.preventDefault(); sendRemoteCmd('minimize'); });
      mediaCtrlBar.querySelector('[data-cmd="cast"]').addEventListener('click', (e) => { e.preventDefault(); sendRemoteCmd('cast'); });

      volume.addEventListener('input', () => {
        sendRemoteCmd('volume', parseFloat(volume.value));
      });

      const syncStatus = (status) => {
        if (status) {
          mediaCtrlBar.style.display = 'block';
          dpadPanel.style.display = 'none';
          playToggle.textContent = status.playing ? '⏸' : '▶';
        } else {
          mediaCtrlBar.style.display = 'none';
          dpadPanel.style.display = 'flex';
        }
      };

      State.onChange('mediaStatus', syncStatus);
      syncStatus(State.get('mediaStatus'));
    }

    // Trackpad Multi-touch Logic
    const pad = overlay.querySelector('#ctrl-trackpad');
    pad.addEventListener('touchstart', handleTouchStart, { passive: false });
    pad.addEventListener('touchmove', handleTouchMove, { passive: false });
    pad.addEventListener('touchend', handleTouchEnd, { passive: false });
  }

  function toggleGyro(btn) {
    gyroEnabled = !gyroEnabled;
    btn.style.background = gyroEnabled ? 'var(--accent)' : 'rgba(0,0,0,0)';
    if (gyroEnabled) {
      window.addEventListener('deviceorientation', handleGyro);
    } else {
      window.removeEventListener('deviceorientation', handleGyro);
    }
  }

  let lastGamma = null, lastBeta = null;
  function handleGyro(e) {
    if (lastGamma === null) { lastGamma = e.gamma; lastBeta = e.beta; return; }
    
    // Gamma = left/right tilt (roll)
    // Beta = front/back tilt (pitch)
    let dx = (e.gamma - lastGamma);
    let dy = (e.beta - lastBeta);
    
    // Normalize around 90/180 boundaries if they flip (though gamma usually stays within -90 to 90)
    if (dx > 90) dx -= 180; else if (dx < -90) dx += 180;
    if (dy > 90) dy -= 180; else if (dy < -90) dy += 180;
    
    // Invert dy: tilting top of phone AWAY from you (forward) increases beta, which should move mouse UP (negative Y)
    dy = -dy;
    
    dx *= 8; dy *= 8;
    
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      send('mouserelative', { dx: Math.round(dx), dy: Math.round(dy) });
      lastGamma = e.gamma;
      lastBeta = e.beta;
    }
  }

  // --- Trackpad Gestures ---
  function handleTouchStart(e) {
    e.preventDefault();
    touchStartT = Date.now();
    isScrolling = e.touches.length === 2;
    
    if (e.touches.length > 0) {
      touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }

  let scrollAccumX = 0;
  let scrollAccumY = 0;

  function handleTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && !isScrolling) {
      let dx = e.touches[0].clientX - lastTouchPos.x;
      let dy = e.touches[0].clientY - lastTouchPos.y;
      dx *= 1.5; dy *= 1.5;
      send('mouserelative', { dx: Math.round(dx), dy: Math.round(dy) });
      lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      let dx = e.touches[0].clientX - lastTouchPos.x;
      let dy = e.touches[0].clientY - lastTouchPos.y;
      
      scrollAccumX += dx;
      scrollAccumY += dy;
      
      let sendDx = 0, sendDy = 0;
      if (Math.abs(scrollAccumX) >= 5) {
        sendDx = Math.round(-scrollAccumX / 5);
        scrollAccumX = 0;
      }
      if (Math.abs(scrollAccumY) >= 5) {
        sendDy = Math.round(-scrollAccumY / 5);
        scrollAccumY = 0;
      }
      
      if (sendDx !== 0 || sendDy !== 0) {
        send('scroll', { dx: sendDx, dy: sendDy });
      }
      
      lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }

  function handleTouchEnd(e) {
    e.preventDefault();
    const duration = Date.now() - touchStartT;
    if (duration < 200) {
      const movedX = Math.abs(lastTouchPos.x - touchStartPos.x);
      const movedY = Math.abs(lastTouchPos.y - touchStartPos.y);
      if (movedX < 10 && movedY < 10) {
        if (e.changedTouches.length === 1 && !isScrolling) {
          send('click', { button: 'left' });
        } else if (e.changedTouches.length === 2 || isScrolling) {
          send('click', { button: 'right' });
        } else if (e.changedTouches.length === 3) {
          send('click', { button: 'middle' });
        }
      }
    }
    if (e.touches.length === 0) isScrolling = false;
  }

  function destroyOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    if (gyroEnabled) {
      window.removeEventListener('deviceorientation', handleGyro);
      gyroEnabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return { init, toggle };
})();
