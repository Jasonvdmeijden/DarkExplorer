/* control-mode.js — the CONTROLLER side of remote control.
 *
 * Lets this client pick a controllee from the live roster, then turns the
 * screen into a control surface: a trackpad (touch + mouse drag), mouse
 * buttons (L/M/R + back/forward), two-finger scroll, and a terminal-style
 * keyboard. Input is rAF-batched and streamed via WS.emit('control:input').
 *
 * Pointer-lock capture of a real mouse/keyboard and the air-mouse arrive in
 * later milestones; this module already exposes the hooks (enqueue/currentMods).
 */
const ControlMode = (() => {
  let selfConnId = null;
  let roster = [];
  let bound = false;           // live binding right now (can send input)
  let sessionActive = false;   // user intends to control; survives drops until exit
  let reconnecting = false;    // dropped mid-session, trying to restore
  let rebindTries = 0;
  let locked = false;          // pointer lock currently held (desktop capture)
  let serverMode = false;      // controlling the server OS via Apollo Remote Input
  let serverSink = null;       // input sink into the Apollo session (server mode)
  // Media remote: when the controllee has a video player open, the control
  // surface can switch to media controls that drive it via the synced State
  // channel (mediaCommand/mediaStatus) the in-app player already listens to.
  let mediaActive = false;     // controllee reports an open player
  let mediaShown = false;      // media surface currently displayed (vs trackpad)
  let mediaPlaying = false;    // last known play/pause state
  let mediaSeeking = false;    // user dragging the scrubber — don't fight status
  let mediaWasActive = false;  // for detecting the inactive→active transition
  let kbLayer = 'alpha';       // on-screen keyboard layer: 'alpha' | 'symbol'
  let peerName = '';
  let peerDeviceId = null;     // stable id used to re-find the controllee after a reconnect
  let overlay = null, picker = null, titleEl = null;

  // Sticky modifier toggles (like the terminal key bar)
  const mods = { ctrl: false, alt: false, shift: false, meta: false };
  const currentMods = () => ({ ...mods });

  // Per-device tunables (localStorage; defaults if unset)
  function lsNum(key, def) { const v = parseFloat(localStorage.getItem(key)); return isFinite(v) ? v : def; }
  function trackpadSens() { return lsNum('de_control_tp_sens', 1.6); }

  // Air-mouse is configured per phone axis: yaw (turning the phone left/right
  // around vertical) and pitch (tilting up/down). Each axis maps to a mouse
  // direction ('x' = left/right, 'y' = up/down, 'off' = ignore), with its own
  // sensitivity and invert toggle. Defaults reproduce the previous behaviour:
  // yaw→X, pitch→Y, rotate-up = cursor-up.
  const AIR_DEF = { yaw: { target: 'x', sens: 12 }, pitch: { target: 'y', sens: 12 } };
  function airAxisTarget(ax) { return localStorage.getItem('de_control_air_' + ax + '_target') || AIR_DEF[ax].target; }
  function airAxisSens(ax)   { return lsNum('de_control_air_' + ax + '_sens', AIR_DEF[ax].sens); }
  function airAxisInvert(ax) { return localStorage.getItem('de_control_air_' + ax + '_inv') === '1'; }

  // ── Outbound input batching ──────────────────────────────────────
  let queue = [];
  let rafId = 0;
  function enqueue(ev) {
    if (!bound) return;
    const last = queue[queue.length - 1];
    if (last && (ev.t === 'move' || ev.t === 'wheel') && last.t === ev.t) {
      last.dx += ev.dx; last.dy += ev.dy;          // coalesce streams of move/scroll
    } else {
      queue.push(ev);
    }
    if (!rafId) rafId = requestAnimationFrame(flush);
  }
  function flush() {
    rafId = 0;
    if (!queue.length) return;
    const evs = queue; queue = [];
    if (serverMode) { if (serverSink) sendToServer(evs); return; }
    WS.emit('control:input', { events: evs });
  }

  // Server mode: translate our input events into the Apollo Remote Input sink
  // (stream.js) instead of relaying over WS to a browser controllee.
  function sendToServer(evs) {
    for (const ev of evs) {
      switch (ev.t) {
        case 'move':  serverSink.move(ev.dx, ev.dy); break;
        case 'wheel': serverSink.scroll(ev.dx, ev.dy); break;
        case 'down':  serverSink.down(ev.button); break;
        case 'up':    serverSink.up(ev.button); break;
        case 'click': serverSink.click(ev.button); break;
        case 'nav':   serverSink.nav(ev.dir); break;
        case 'key':   serverSink.key(ev.key, ev.code, ev.mods); break;
        case 'text':  serverSink.text(ev.str); break;
      }
    }
  }

  // ── Roster / identity ────────────────────────────────────────────
  // The controllee broadcasts its player state on this synced key; mirror it
  // into the control overlay so the media surface tracks/drives it.
  if (typeof State !== 'undefined') State.onChange('mediaStatus', onMediaStatus);

  WS.on('control:self', (d) => { selfConnId = d.connId; });
  WS.on('control:roster', (list) => { roster = list || []; if (picker && picker.style.display !== 'none') renderPicker(); });
  WS.on('control:bound', (d) => {
    if (!d || d.role !== 'controller') return;
    bound = true; sessionActive = true; reconnecting = false; rebindTries = 0;
    peerName = d.peerName || 'device';
    if (d.peerDeviceId) peerDeviceId = d.peerDeviceId;
    openOverlay();
    updateOverlayState();
  });
  WS.on('control:unbound', (d) => {
    if (d && d.role !== 'controller') return;
    bound = false;
    // Controllee dropped (not a deliberate Stop) → keep the session and try to
    // re-bind to it when it comes back; otherwise end and return to the picker.
    if (sessionActive && d && d.reason === 'disconnect') {
      beginReconnect();
    } else {
      endSession();
    }
  });

  // ── Reconnection handling ────────────────────────────────────────
  WS.onClose(() => {
    if (!sessionActive || serverMode) return;  // server mode has no WS binding to restore
    bound = false;
    beginReconnect();          // our own socket dropped; rebind once it's back
  });
  WS.onOpen(() => {
    if (sessionActive && !serverMode && reconnecting) { rebindTries = 0; attemptRebind(); }
  });

  function beginReconnect() {
    reconnecting = true;
    updateOverlayState();
    // If the socket is already back, retry immediately; otherwise onOpen will.
    if (WS.connected && WS.connected()) { rebindTries = 0; attemptRebind(); }
  }

  async function attemptRebind() {
    if (!sessionActive || !reconnecting) return;
    if (!WS.connected || !WS.connected()) return; // wait for onOpen
    await refreshRoster();
    const target = roster.find(r =>
      r.deviceId === peerDeviceId && r.connId !== selfConnId && !r.controlledBy && !r.controlling);
    if (target) {
      try { await WS.send('control:bind', { targetConnId: target.connId }); return; } // control:bound clears reconnecting
      catch { /* fall through to retry */ }
    }
    if (++rebindTries < 6) { setTimeout(attemptRebind, 1500); return; }
    endSession(); // give up → back to the device list
    showPicker();
  }

  function endSession() {
    sessionActive = false; reconnecting = false; rebindTries = 0; bound = false;
    if (serverMode) {
      try { if (serverSink) serverSink.close(); } catch (e) {}
      serverSink = null; serverMode = false;
    }
    closeOverlay();
  }

  let serverSupportsControl = true;
  async function refreshRoster() {
    try {
      const r = await WS.send('control:list', {});
      selfConnId = r.self; roster = r.roster || [];
      serverSupportsControl = (r.self != null);
    } catch { serverSupportsControl = false; }
  }

  // ── Picker ───────────────────────────────────────────────────────
  function ensurePicker() {
    if (picker) return;
    picker = document.createElement('div');
    picker.id = 'de-control-picker';
    picker.innerHTML =
      `<div class="dcp-card">
         <div class="dcp-head">Control another device<button class="dcp-close" type="button">&times;</button></div>
         <div class="dcp-list"></div>
         <div class="dcp-empty" style="display:none">No other devices are connected.</div>
       </div>`;
    picker.addEventListener('click', (e) => { if (e.target === picker) hidePicker(); });
    picker.querySelector('.dcp-close').addEventListener('click', hidePicker);
    document.body.appendChild(picker);
  }
  function renderPicker() {
    const list = picker.querySelector('.dcp-list');
    const empty = picker.querySelector('.dcp-empty');
    const targets = roster.filter(r => r.connId !== selfConnId && !r.controlledBy && !r.controlling);
    list.innerHTML = '';

    // Pinned entry: control the server's own OS via Apollo Remote Input. Needs
    // the streaming subsystem (App Mode) to be present on this client.
    const serverAvailable = (typeof StreamView !== 'undefined' && StreamView.startServerControl);
    if (serverAvailable) {
      const sBtn = document.createElement('button');
      sBtn.className = 'dcp-item dcp-server';
      sBtn.type = 'button';
      sBtn.innerHTML = `<span class="dcp-name">🖥 This Computer (server)</span><span class="dcp-go">Control →</span>`;
      sBtn.addEventListener('click', bindToServer);
      list.appendChild(sBtn);
    }

    empty.textContent = !serverSupportsControl
      ? 'Remote control isn’t active on the server — restart the DarkExplorer server to load it.'
      : 'No other devices are connected. Open DarkExplorer on another device pointed at this same server.';
    // With the server entry present there's always something actionable, so only
    // show the "no devices" hint when there are neither.
    empty.style.display = (targets.length || serverAvailable) ? 'none' : 'block';
    for (const t of targets) {
      const btn = document.createElement('button');
      btn.className = 'dcp-item';
      btn.type = 'button';
      btn.innerHTML = `<span class="dcp-name">${escapeHtml(t.name)}</span><span class="dcp-go">Control →</span>`;
      btn.addEventListener('click', () => bindTo(t.connId));
      list.appendChild(btn);
    }
  }
  async function showPicker() {
    ensurePicker();
    await refreshRoster();
    renderPicker();
    picker.style.display = 'flex';
  }
  function hidePicker() { if (picker) picker.style.display = 'none'; }

  async function bindTo(connId) {
    try {
      await WS.send('control:bind', { targetConnId: connId });
      hidePicker();
    } catch (e) {
      alert('Could not start control: ' + e.message);
      refreshRoster().then(renderPicker);
    }
  }

  // Control the server's OS: launch Apollo's input-only "Remote Input" session
  // and drive it with our control surface instead of relaying over WS. There's
  // no WS binding here — input flows straight into the stream's input channel.
  async function bindToServer() {
    if (typeof StreamView === 'undefined' || !StreamView.startServerControl) {
      alert('Server control needs App Mode (streaming) available on this device.');
      return;
    }
    hidePicker();
    const sink = await StreamView.startServerControl();
    if (!sink) { showPicker(); return; }   // failed → back to the device list
    serverSink = sink;
    serverMode = true;
    bound = true; sessionActive = true; reconnecting = false; rebindTries = 0;
    peerName = 'This Computer';
    openOverlay();
    updateOverlayState();
  }

  // ── Capture overlay ──────────────────────────────────────────────
  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'de-control-overlay';
    overlay.innerHTML =
      `<div class="dco-topbar">
         <span class="dco-title"></span>
         <span class="dco-topbar-right">
           <button class="dco-media-btn" type="button" title="Media remote" hidden>🎬</button>
           <button class="dco-gear" type="button" title="Settings">⚙</button>
           <button class="dco-exit" type="button">Exit control</button>
         </span>
       </div>
       <div class="dco-settings" hidden>
         <label class="dcs-row"><span>Trackpad speed</span><input type="range" min="0.5" max="4" step="0.1" data-set="tp"></label>
         <div class="dcs-sep">Air-mouse · horizontal turn</div>
         <label class="dcs-row"><span>Controls</span>
           <select data-set="yaw-target"><option value="x">Mouse left/right</option><option value="y">Mouse up/down</option><option value="off">Off</option></select></label>
         <label class="dcs-row"><span>Speed</span><input type="range" min="2" max="40" step="1" data-set="yaw-sens"></label>
         <label class="dcs-check"><input type="checkbox" data-set="yaw-inv"> Invert</label>
         <div class="dcs-sep">Air-mouse · vertical tilt</div>
         <label class="dcs-row"><span>Controls</span>
           <select data-set="pitch-target"><option value="x">Mouse left/right</option><option value="y">Mouse up/down</option><option value="off">Off</option></select></label>
         <label class="dcs-row"><span>Speed</span><input type="range" min="2" max="40" step="1" data-set="pitch-sens"></label>
         <label class="dcs-check"><input type="checkbox" data-set="pitch-inv"> Invert</label>
         <label class="dcs-check"><input type="checkbox" data-set="haptics"> Haptic feedback (Android)</label>
       </div>
       <div class="dco-media">
         <div class="dcm-title">No media</div>
         <div class="dcm-scrub-row">
           <span class="dcm-cur">00:00</span>
           <input type="range" class="dcm-scrub" min="0" max="100" value="0">
           <span class="dcm-tot">00:00</span>
         </div>
         <div class="dcm-buttons">
           <button class="dcm-btn" data-mcmd="prev" title="Previous">⏮</button>
           <button class="dcm-btn" data-mcmd="rewind" title="Rewind 10s">⟲10</button>
           <button class="dcm-btn dcm-play" data-mcmd="toggle" title="Play / Pause">▶</button>
           <button class="dcm-btn" data-mcmd="forward" title="Forward 10s">10⟳</button>
           <button class="dcm-btn" data-mcmd="next" title="Next">⏭</button>
         </div>
         <div class="dcm-vol-row"><span>🔊</span><input type="range" class="dcm-vol" min="0" max="1" step="0.05" value="1"></div>
         <button class="dcm-close" data-mcmd="close" type="button">Exit playback</button>
       </div>
       <div class="dco-trackpad"><span class="dco-hint">Drag to move · tap to click · two fingers to scroll</span></div>
       <div class="dco-buttons">
         <button class="dco-btn" data-btn="0">Left</button>
         <button class="dco-btn" data-btn="1">Middle</button>
         <button class="dco-btn" data-btn="2">Right</button>
         <button class="dco-btn" data-nav="back">‹ Back</button>
         <button class="dco-btn" data-nav="forward">Fwd ›</button>
         <button class="dco-btn dco-air" data-air>✦ Air</button>
       </div>
       <div class="dco-keys"><div class="dco-kbd"></div></div>`;
    document.body.appendChild(overlay);
    titleEl = overlay.querySelector('.dco-title');
    buildKeyboard(overlay.querySelector('.dco-kbd'));
    wireOverlay();
  }

  // Always-visible on-screen keyboard. The native mobile keyboard can't stay up
  // while you use the trackpad (touching it dismisses the field), so we render
  // our own keyboard that drives the same input pipeline. Two layers — letters
  // and symbols — switched by the 123/ABC key, iOS-style.
  const KB_LAYERS = {
    alpha: [
      ['q','w','e','r','t','y','u','i','o','p'],
      ['a','s','d','f','g','h','j','k','l'],
      [{ mod: 'shift', l: '⇧', w: 1.4 }, 'z','x','c','v','b','n','m', { key: 'Backspace', l: '⌫', w: 1.4 }],
    ],
    symbol: [
      ['1','2','3','4','5','6','7','8','9','0'],
      ['-','/',':',';','(',')','$','&','@','"'],
      ['.',',','?','!',"'",'_','+','=','#', { key: 'Backspace', l: '⌫', w: 1.4 }],
    ],
  };
  function kbCommonRows() {
    return [
      [{ layer: 1, l: kbLayer === 'alpha' ? '123' : 'ABC', w: 1.4 },
       { mod: 'ctrl', l: 'Ctrl' }, { mod: 'alt', l: 'Alt' }, { mod: 'meta', l: '⌘' },
       { char: ' ', l: 'space', w: 4 },
       { key: 'Tab', l: '⇥' }, { key: 'Escape', l: 'Esc' }, { key: 'Enter', l: '⏎', w: 1.4 }],
      [{ key: 'ArrowLeft', l: '←' }, { key: 'ArrowUp', l: '↑' },
       { key: 'ArrowDown', l: '↓' }, { key: 'ArrowRight', l: '→' }],
    ];
  }
  function makeKey(cell) {
    if (typeof cell === 'string') cell = { char: cell, l: cell };
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'term-key';
    b.textContent = cell.l != null ? cell.l : (cell.char || '');
    if (cell.w) b.style.flex = String(cell.w);
    if (cell.char != null)   b.dataset.char = cell.char;
    else if (cell.mod)     { b.dataset.mod = cell.mod; if (mods[cell.mod]) b.classList.add('active'); }
    else if (cell.key)       b.dataset.key = cell.key;
    else if (cell.layer)     b.dataset.layer = '1';
    return b;
  }
  function buildKeyboard(host) {
    if (!host) return;
    host.innerHTML = '';
    for (const row of KB_LAYERS[kbLayer].concat(kbCommonRows())) {
      const r = document.createElement('div');
      r.className = 'dco-krow';
      for (const cell of row) r.appendChild(makeKey(cell));
      host.appendChild(r);
    }
  }

  function haptic() {
    if (localStorage.getItem('de_control_haptics') === '0') return;
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch {} }
  }

  // A single keyboard keypress (mod toggle / char / special key / layer switch).
  function handleKbPress(btn) {
    if (btn.dataset.layer) {
      kbLayer = kbLayer === 'alpha' ? 'symbol' : 'alpha';
      buildKeyboard(overlay.querySelector('.dco-kbd'));
    } else if (btn.dataset.mod) {
      mods[btn.dataset.mod] = !mods[btn.dataset.mod];
      btn.classList.toggle('active', mods[btn.dataset.mod]);
    } else if (btn.dataset.char != null) {
      sendChar(btn.dataset.char);
    } else if (btn.dataset.key) {
      enqueue({ t: 'key', key: btn.dataset.key, mods: currentMods() });
      clearOneShotMods();
    }
    haptic();
  }

  // Send a typed character, applying active sticky modifiers (one-shot).
  function sendChar(ch) {
    const m = currentMods();
    if (m.ctrl || m.alt || m.meta) { enqueue({ t: 'key', key: ch.toLowerCase(), mods: m }); clearOneShotMods(); }
    else if (m.shift)              { enqueue({ t: 'text', str: ch.toUpperCase() }); clearOneShotMods(); }
    else                           { enqueue({ t: 'text', str: ch }); }
  }

  function initSettings(root) {
    root.querySelector('[data-set="tp"]').value           = trackpadSens();
    root.querySelector('[data-set="yaw-target"]').value   = airAxisTarget('yaw');
    root.querySelector('[data-set="yaw-sens"]').value     = airAxisSens('yaw');
    root.querySelector('[data-set="yaw-inv"]').checked    = airAxisInvert('yaw');
    root.querySelector('[data-set="pitch-target"]').value = airAxisTarget('pitch');
    root.querySelector('[data-set="pitch-sens"]').value   = airAxisSens('pitch');
    root.querySelector('[data-set="pitch-inv"]').checked  = airAxisInvert('pitch');
    root.querySelector('[data-set="haptics"]').checked    = localStorage.getItem('de_control_haptics') !== '0';
  }

  // ── Media remote ─────────────────────────────────────────────────
  function fmtTime(sec) {
    const s = Math.floor(sec || 0), m = Math.floor(s / 60), h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  function sendMedia(command, value) {
    State.set('mediaCommand', { command, value: value == null ? null : value, timestamp: Date.now() });
  }
  function showMediaSurface(on) {
    if (on && !mediaActive) return;
    mediaShown = !!on;
    if (mediaShown) stopAir();                       // air-mouse is meaningless in media mode
    if (overlay) overlay.classList.toggle('dco-media-on', mediaShown);
  }
  function updateMediaPanel(status) {
    if (!overlay) return;
    const m = overlay.querySelector('.dco-media');
    if (!m) return;
    m.querySelector('.dcm-title').textContent = (status && status.title) || 'No media';
    m.querySelector('.dcm-play').textContent = mediaPlaying ? '⏸' : '▶';
    if (status && status.duration && !mediaSeeking) {
      m.querySelector('.dcm-scrub').value = (status.currentTime / status.duration) * 100;
      m.querySelector('.dcm-cur').textContent = fmtTime(status.currentTime);
      m.querySelector('.dcm-tot').textContent = fmtTime(status.duration);
    }
  }
  // Reflect the controllee's player into the overlay. Auto-opens the media
  // surface on the inactive→active transition; hides it (and the toggle) when
  // the player closes. No-op in server mode (Apollo OS has no in-app player).
  function onMediaStatus(status) {
    const active = !!(status && status.title && !status.closed);
    mediaActive = active;
    mediaPlaying = !!(status && status.playing);
    const usable = active && bound && !serverMode;
    if (overlay) {
      const btn = overlay.querySelector('.dco-media-btn');
      if (btn) btn.hidden = !usable;
    }
    if (usable && !mediaWasActive && !mediaShown) showMediaSurface(true); // media just started
    if (!active && mediaShown) showMediaSurface(false);                   // player closed
    updateMediaPanel(status);
    mediaWasActive = active;
  }
  // Baseline sync without auto-opening (used when a session opens).
  function syncMedia() {
    const status = (typeof State !== 'undefined') ? State.get('mediaStatus', null) : null;
    mediaActive = !!(status && status.title && !status.closed);
    mediaPlaying = !!(status && status.playing);
    mediaWasActive = mediaActive;
    if (overlay) {
      const btn = overlay.querySelector('.dco-media-btn');
      if (btn) btn.hidden = !(mediaActive && bound && !serverMode);
    }
    updateMediaPanel(status);
  }

  function wireOverlay() {
    overlay.querySelector('.dco-exit').addEventListener('click', exit);

    // Settings popover (per-device, localStorage)
    const gear = overlay.querySelector('.dco-gear');
    const settings = overlay.querySelector('.dco-settings');
    gear.addEventListener('click', () => {
      settings.hidden = !settings.hidden;
      if (!settings.hidden) initSettings(settings);
    });
    const onSetting = (e) => {
      const el = e.target;
      switch (el.dataset.set) {
        case 'tp':           localStorage.setItem('de_control_tp_sens', el.value); break;
        case 'yaw-target':   localStorage.setItem('de_control_air_yaw_target', el.value); break;
        case 'yaw-sens':     localStorage.setItem('de_control_air_yaw_sens', el.value); break;
        case 'yaw-inv':      localStorage.setItem('de_control_air_yaw_inv', el.checked ? '1' : '0'); break;
        case 'pitch-target': localStorage.setItem('de_control_air_pitch_target', el.value); break;
        case 'pitch-sens':   localStorage.setItem('de_control_air_pitch_sens', el.value); break;
        case 'pitch-inv':    localStorage.setItem('de_control_air_pitch_inv', el.checked ? '1' : '0'); break;
        case 'haptics':      localStorage.setItem('de_control_haptics', el.checked ? '1' : '0'); break;
      }
    };
    settings.addEventListener('input', onSetting);   // ranges/checkboxes
    settings.addEventListener('change', onSetting);  // <select> in all browsers

    // Media remote surface
    overlay.querySelector('.dco-media-btn').addEventListener('click', () => showMediaSurface(!mediaShown));
    const media = overlay.querySelector('.dco-media');
    media.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mcmd]');
      if (!b) return;
      const cmd = b.dataset.mcmd;
      if (cmd === 'toggle') sendMedia(mediaPlaying ? 'pause' : 'play');
      else sendMedia(cmd);
    });
    const scrub = media.querySelector('.dcm-scrub');
    scrub.addEventListener('input', () => { mediaSeeking = true; sendMedia('seek', parseInt(scrub.value, 10)); });
    const endSeek = () => { mediaSeeking = false; };
    scrub.addEventListener('change', endSeek);
    scrub.addEventListener('pointerup', endSeek);
    media.querySelector('.dcm-vol').addEventListener('input', (e) => sendMedia('volume', parseFloat(e.target.value)));

    // Mouse buttons + navigation
    overlay.querySelectorAll('.dco-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.btn != null) enqueue({ t: 'click', button: +btn.dataset.btn });
        else if (btn.dataset.nav)    enqueue({ t: 'nav', dir: btn.dataset.nav });
      });
    });

    // On-screen keyboard — pointerdown for instant response + visual/haptic
    // feedback. Modifiers are one-shot (auto-released after the next key).
    const kbEl = overlay.querySelector('.dco-kbd');
    kbEl.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('.term-key');
      if (!btn) return;
      e.preventDefault();              // don't steal focus / scroll
      btn.classList.add('pressed');
      handleKbPress(btn);
    });
    const clearPressed = () => kbEl.querySelectorAll('.pressed').forEach(b => b.classList.remove('pressed'));
    kbEl.addEventListener('pointerup', clearPressed);
    kbEl.addEventListener('pointercancel', clearPressed);
    kbEl.addEventListener('pointerleave', clearPressed);

    // Air-mouse (device orientation). Only available in a secure context, so it
    // degrades gracefully to a disabled button over plain HTTP.
    const airBtn = overlay.querySelector('[data-air]');
    if (airBtn) {
      const supported = 'DeviceMotionEvent' in window;
      if (!window.isSecureContext || !supported) {
        airBtn.disabled = true;
        airBtn.classList.add('dco-disabled');
        airBtn.title = !supported ? 'No motion sensor on this device'
                                  : 'Air mouse needs HTTPS — open the https:// URL';
      } else {
        airBtn.addEventListener('click', () => toggleAir(airBtn));
      }
    }

    wireTrackpad(overlay.querySelector('.dco-trackpad'));
  }

  // ── Air-mouse: rotate the phone to move the cursor (gyroscope) ───
  // Yaw (turning left/right around the vertical axis) → X; pitch (tilting the
  // phone up/down) → Y, non-inverted; roll/banking is ignored. Orientation-
  // independent: yaw is the angular velocity projected onto gravity, so it works
  // whether the phone is held flat or upright. Velocity-based (drift-free).
  let airOn = false, airLastT = 0;
  function airHandler(e) {
    const r = e.rotationRate;
    if (!r) return;
    const now = e.timeStamp || performance.now();
    const dt = airLastT ? Math.min((now - airLastT) / 1000, 0.1) : 0;
    airLastT = now;
    if (!dt) return;
    const wx = r.beta || 0, wy = r.gamma || 0, wz = r.alpha || 0; // ω about device X,Y,Z
    const g = e.accelerationIncludingGravity;
    let yawRate;
    if (g && (g.x || g.y || g.z)) {
      const m = Math.hypot(g.x, g.y, g.z) || 1;
      yawRate = (wx * g.x + wy * g.y + wz * g.z) / m;            // ω · ĝ  (about vertical)
    } else {
      yawRate = wz;
    }
    const pitchRate = wx;                                         // about device left-right axis
    // Route each axis to its configured mouse direction. The leading minus is
    // the base "normal" sign (rotate-right → cursor-right, rotate-up → cursor-up);
    // the per-axis invert toggle flips it.
    let dx = 0, dy = 0;
    for (const [axis, rate] of [['yaw', yawRate], ['pitch', pitchRate]]) {
      const target = airAxisTarget(axis);
      if (target === 'off') continue;
      const contrib = -rate * dt * airAxisSens(axis) * (airAxisInvert(axis) ? -1 : 1);
      if (target === 'x') dx += contrib; else dy += contrib;
    }
    if (dx || dy) enqueue({ t: 'move', dx, dy });
  }
  async function toggleAir(btn) {
    if (airOn) return stopAir(btn);
    const DME = window.DeviceMotionEvent;
    if (DME && typeof DME.requestPermission === 'function') {
      try { if (await DME.requestPermission() !== 'granted') return; } catch { return; }
    }
    airLastT = 0; airOn = true;
    window.addEventListener('devicemotion', airHandler);
    btn.classList.add('active');
  }
  function stopAir(btn) {
    airOn = false;
    window.removeEventListener('devicemotion', airHandler);
    const b = btn || (overlay && overlay.querySelector('[data-air]'));
    if (b) b.classList.remove('active');
  }

  function clearOneShotMods() {
    let changed = false;
    for (const k in mods) if (mods[k]) { mods[k] = false; changed = true; }
    if (changed && overlay) overlay.querySelectorAll('.term-key[data-mod].active').forEach(b => b.classList.remove('active'));
  }

  // ── Trackpad: touch + mouse-drag relative movement ───────────────
  function wireTrackpad(pad) {
    let touchMode = null;       // 'move' | 'scroll'
    let lastX = 0, lastY = 0, moved = 0, startT = 0;

    // Use targetTouches (fingers that started ON the pad) so a finger on the
    // keyboard doesn't disturb the pad — letting you type and move at once.
    pad.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startT = Date.now(); moved = 0;
      seedTouch(e.targetTouches);
    }, { passive: false });

    pad.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const tt = e.targetTouches;
      if (touchMode === 'scroll' && tt.length >= 2) {
        const cx = (tt[0].clientX + tt[1].clientX) / 2;
        const cy = (tt[0].clientY + tt[1].clientY) / 2;
        const s = trackpadSens();
        enqueue({ t: 'wheel', dx: -(cx - lastX) * s, dy: -(cy - lastY) * s });
        lastX = cx; lastY = cy;
      } else if (touchMode === 'move' && tt.length >= 1) {
        const dx = tt[0].clientX - lastX, dy = tt[0].clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        const s = trackpadSens();
        enqueue({ t: 'move', dx: dx * s, dy: dy * s });
        lastX = tt[0].clientX; lastY = tt[0].clientY;
      }
    }, { passive: false });

    pad.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (e.targetTouches.length === 0) {
        const quick = Date.now() - startT < 250;
        if (touchMode === 'move' && moved < 8 && quick) enqueue({ t: 'click', button: 0 });
        else if (touchMode === 'scroll' && moved < 8 && quick) enqueue({ t: 'click', button: 2 });
        touchMode = null;
      } else {
        seedTouch(e.targetTouches); // a finger lifted but others remain — re-seed
      }
    }, { passive: false });

    function seedTouch(tt) {
      if (tt.length >= 2) {
        touchMode = 'scroll';
        lastX = (tt[0].clientX + tt[1].clientX) / 2;
        lastY = (tt[0].clientY + tt[1].clientY) / 2;
      } else if (tt.length === 1) {
        touchMode = 'move';
        lastX = tt[0].clientX; lastY = tt[0].clientY;
      }
    }

    // Desktop: Pointer Lock captures the real mouse + keyboard so input is
    // proxied to the controllee and the controller's own page receives nothing.
    // Esc releases the lock (browser-forced) → we treat that as "pause"; the
    // always-visible Exit button then fully ends the session.
    const fine = () => window.matchMedia('(pointer:fine)').matches;
    pad.addEventListener('mousedown', (e) => {
      if (!locked && fine() && pad.requestPointerLock) { e.preventDefault(); pad.requestPointerLock(); }
    });
    document.addEventListener('pointerlockchange', () => {
      locked = (document.pointerLockElement === pad);
      updatePadHint();
    });
    document.addEventListener('mousemove', (e) => {
      if (locked) { const s = trackpadSens(); enqueue({ t: 'move', dx: e.movementX * s, dy: e.movementY * s }); }
    });
    document.addEventListener('mousedown', (e) => {
      if (!locked) return;
      e.preventDefault();
      if (e.button === 3) return enqueue({ t: 'nav', dir: 'back' });
      if (e.button === 4) return enqueue({ t: 'nav', dir: 'forward' });
      enqueue({ t: 'down', button: e.button });
    });
    document.addEventListener('mouseup', (e) => {
      if (!locked) return;
      e.preventDefault();
      if (e.button === 3 || e.button === 4) return;
      enqueue({ t: 'up', button: e.button });
    });
    document.addEventListener('wheel', (e) => {
      if (!locked) return;
      e.preventDefault();
      enqueue({ t: 'wheel', dx: e.deltaX, dy: e.deltaY });
    }, { passive: false });
    document.addEventListener('keydown', captureKey, true);
    document.addEventListener('contextmenu', (e) => { if (locked) e.preventDefault(); });
  }

  // Physical-keyboard capture for the whole session — works with or without
  // pointer lock, so a hardware keyboard drives the controllee (incl. Backspace)
  // and you can type while moving the mouse. When pointer-locked, Esc is reserved
  // by the browser to release the lock; otherwise Esc is forwarded to the remote.
  function captureKey(e) {
    if (!bound || !overlay || overlay.style.display === 'none') return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    if (e.key === 'Escape' && locked) return;
    e.preventDefault(); e.stopPropagation();
    const special = ['Enter','Backspace','Tab','Escape','Delete','Home','End','PageUp','PageDown',
                     'ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
    if (special.includes(e.key) || ((e.ctrlKey || e.metaKey || e.altKey) && e.key.length === 1)) {
      enqueue({ t: 'key', key: e.key, code: e.code,
                mods: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey } });
    } else if (e.key.length === 1) {
      enqueue({ t: 'text', str: e.key });
    }
  }

  function updatePadHint() {
    if (!overlay) return;
    const hint = overlay.querySelector('.dco-hint');
    const pad  = overlay.querySelector('.dco-trackpad');
    if (!hint || !pad) return;
    if (!window.matchMedia('(pointer:fine)').matches) {
      hint.textContent = 'Drag to move · tap to click · two fingers to scroll';
    } else if (locked) {
      hint.textContent = 'Capturing mouse & keyboard — press Esc to pause';
    } else {
      hint.textContent = bound ? 'Click trackpad to capture mouse & keyboard' : '';
    }
    pad.classList.toggle('dco-capturing', locked);
  }

  function updateOverlayState() {
    if (!overlay || !titleEl) return;
    titleEl.textContent = reconnecting ? `Reconnecting to ${peerName}…` : `Controlling: ${peerName}`;
    overlay.classList.toggle('dco-reconnecting', reconnecting);
  }
  function openOverlay() {
    ensureOverlay();
    overlay.style.display = 'flex';
    document.body.classList.add('de-controlling');
    updateOverlayState();
    updatePadHint();
    syncMedia();
  }
  function closeOverlay() {
    if (document.pointerLockElement) document.exitPointerLock();
    locked = false;
    stopAir();
    if (overlay) { overlay.style.display = 'none'; overlay.classList.remove('dco-media-on'); }
    mediaShown = false;
    document.body.classList.remove('de-controlling');
    for (const k in mods) mods[k] = false;
    if (overlay) overlay.querySelectorAll('.term-key.active').forEach(b => b.classList.remove('active'));
  }
  function exit() {
    if (!serverMode) WS.send('control:unbind', {}).catch(() => {}); // no WS binding in server mode
    endSession();
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ── Entry button ─────────────────────────────────────────────────
  function init() {
    const btn = document.getElementById('btn-control');
    if (btn) btn.addEventListener('click', () => { sessionActive ? exit() : showPicker(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { showPicker, exit, isControlling: () => bound, _enqueue: enqueue };
})();
