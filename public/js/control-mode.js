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
  function airSens()      { return lsNum('de_control_air_sens', 12); }
  function airInvert(ax)  { return localStorage.getItem('de_control_air_inv' + ax) === '1'; }

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
    WS.emit('control:input', { events: queue });
    queue = [];
  }

  // ── Roster / identity ────────────────────────────────────────────
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
    if (!sessionActive) return;
    bound = false;
    beginReconnect();          // our own socket dropped; rebind once it's back
  });
  WS.onOpen(() => {
    if (sessionActive && reconnecting) { rebindTries = 0; attemptRebind(); }
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
    empty.textContent = !serverSupportsControl
      ? 'Remote control isn’t active on the server — restart the DarkExplorer server to load it.'
      : 'No other devices are connected. Open DarkExplorer on another device pointed at this same server.';
    empty.style.display = targets.length ? 'none' : 'block';
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

  // ── Capture overlay ──────────────────────────────────────────────
  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'de-control-overlay';
    overlay.innerHTML =
      `<div class="dco-topbar">
         <span class="dco-title"></span>
         <span class="dco-topbar-right">
           <button class="dco-gear" type="button" title="Settings">⚙</button>
           <button class="dco-exit" type="button">Exit control</button>
         </span>
       </div>
       <div class="dco-settings" hidden>
         <label class="dcs-row"><span>Trackpad speed</span><input type="range" min="0.5" max="4" step="0.1" data-set="tp"></label>
         <label class="dcs-row"><span>Air-mouse speed</span><input type="range" min="2" max="40" step="1" data-set="air"></label>
         <label class="dcs-check"><input type="checkbox" data-set="invx"> Invert air-mouse X</label>
         <label class="dcs-check"><input type="checkbox" data-set="invy"> Invert air-mouse Y</label>
         <label class="dcs-check"><input type="checkbox" data-set="haptics"> Haptic feedback (Android)</label>
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
    root.querySelector('[data-set="tp"]').value      = trackpadSens();
    root.querySelector('[data-set="air"]').value     = airSens();
    root.querySelector('[data-set="invx"]').checked  = airInvert('x');
    root.querySelector('[data-set="invy"]').checked  = airInvert('y');
    root.querySelector('[data-set="haptics"]').checked = localStorage.getItem('de_control_haptics') !== '0';
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
    settings.addEventListener('input', (e) => {
      const el = e.target;
      switch (el.dataset.set) {
        case 'tp':      localStorage.setItem('de_control_tp_sens', el.value); break;
        case 'air':     localStorage.setItem('de_control_air_sens', el.value); break;
        case 'invx':    localStorage.setItem('de_control_air_invx', el.checked ? '1' : '0'); break;
        case 'invy':    localStorage.setItem('de_control_air_invy', el.checked ? '1' : '0'); break;
        case 'haptics': localStorage.setItem('de_control_haptics', el.checked ? '1' : '0'); break;
      }
    });

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
    const s = airSens();
    const dx = -yawRate   * dt * s * (airInvert('x') ? -1 : 1);
    const dy = -pitchRate * dt * s * (airInvert('y') ? -1 : 1);  // rotate up → cursor up
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
  }
  function closeOverlay() {
    if (document.pointerLockElement) document.exitPointerLock();
    locked = false;
    stopAir();
    if (overlay) overlay.style.display = 'none';
    document.body.classList.remove('de-controlling');
    for (const k in mods) mods[k] = false;
    if (overlay) overlay.querySelectorAll('.term-key.active').forEach(b => b.classList.remove('active'));
  }
  function exit() {
    WS.send('control:unbind', {}).catch(() => {});
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
