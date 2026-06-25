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
  let peerName = '';
  let peerDeviceId = null;     // stable id used to re-find the controllee after a reconnect
  let overlay = null, picker = null, titleEl = null;

  // Sticky modifier toggles (like the terminal key bar)
  const mods = { ctrl: false, alt: false, shift: false, meta: false };
  const currentMods = () => ({ ...mods });

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
         <button class="dco-exit" type="button">Exit control</button>
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
  // our own keyboard that drives the same input pipeline.
  function buildKeyboard(host) {
    if (!host) return;
    const k = (attrs, label, wide) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'term-key';
      b.textContent = label; if (wide) b.style.flex = String(wide);
      Object.assign(b.dataset, attrs);
      return b;
    };
    const c = (ch, label, wide) => k({ char: ch }, label || ch, wide);
    const mod = (m, label) => k({ mod: m }, label);
    const sp = (key, label, wide) => k({ key }, label, wide);
    const rows = [
      [c('1'),c('2'),c('3'),c('4'),c('5'),c('6'),c('7'),c('8'),c('9'),c('0')],
      [c('q'),c('w'),c('e'),c('r'),c('t'),c('y'),c('u'),c('i'),c('o'),c('p')],
      [c('a'),c('s'),c('d'),c('f'),c('g'),c('h'),c('j'),c('k'),c('l')],
      [mod('shift','⇧'),c('z'),c('x'),c('c'),c('v'),c('b'),c('n'),c('m'),sp('Backspace','⌫',1.4)],
      [c('-'),c('/'),c(':'),c(';'),c('('),c(')'),c('$'),c('&'),c('@'),c('"')],
      [c('.'),c(','),c('?'),c('!'),c("'"),c('_'),c('+'),c('='),c('*'),c('#')],
      [mod('ctrl','Ctrl'),mod('alt','Alt'),mod('meta','⌘'),sp('Tab','⇥'),c(' ','space',4),sp('Escape','Esc'),sp('Enter','⏎',1.4)],
      [sp('ArrowLeft','←'),sp('ArrowUp','↑'),sp('ArrowDown','↓'),sp('ArrowRight','→')],
    ];
    host.innerHTML = '';
    for (const row of rows) {
      const r = document.createElement('div');
      r.className = 'dco-krow';
      for (const key of row) r.appendChild(key);
      host.appendChild(r);
    }
  }

  // Send a typed character, applying active sticky modifiers (one-shot).
  function sendChar(ch) {
    const m = currentMods();
    if (m.ctrl || m.alt || m.meta) { enqueue({ t: 'key', key: ch.toLowerCase(), mods: m }); clearOneShotMods(); }
    else if (m.shift)              { enqueue({ t: 'text', str: ch.toUpperCase() }); clearOneShotMods(); }
    else                           { enqueue({ t: 'text', str: ch }); }
  }

  function wireOverlay() {
    overlay.querySelector('.dco-exit').addEventListener('click', exit);

    // Mouse buttons + navigation
    overlay.querySelectorAll('.dco-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.btn != null) enqueue({ t: 'click', button: +btn.dataset.btn });
        else if (btn.dataset.nav)    enqueue({ t: 'nav', dir: btn.dataset.nav });
      });
    });

    // On-screen keyboard: modifier toggles, character keys, and literal keys.
    // Modifiers are one-shot (auto-released after the next character/key).
    overlay.querySelector('.dco-kbd').addEventListener('click', (e) => {
      const btn = e.target.closest('.term-key');
      if (!btn) return;
      if (btn.dataset.mod) {
        mods[btn.dataset.mod] = !mods[btn.dataset.mod];
        btn.classList.toggle('active', mods[btn.dataset.mod]);
      } else if (btn.dataset.char != null) {
        sendChar(btn.dataset.char);
      } else if (btn.dataset.key) {
        enqueue({ t: 'key', key: btn.dataset.key, mods: currentMods() });
        clearOneShotMods();
      }
    });

    // Air-mouse (device orientation). Only available in a secure context, so it
    // degrades gracefully to a disabled button over plain HTTP.
    const airBtn = overlay.querySelector('[data-air]');
    if (airBtn) {
      const supported = 'DeviceOrientationEvent' in window;
      if (!window.isSecureContext || !supported) {
        airBtn.disabled = true;
        airBtn.classList.add('dco-disabled');
        airBtn.title = !supported ? 'No orientation sensor on this device'
                                  : 'Air mouse needs HTTPS — open the https:// URL';
      } else {
        airBtn.addEventListener('click', () => toggleAir(airBtn));
      }
    }

    wireTrackpad(overlay.querySelector('.dco-trackpad'));
  }

  // ── Air-mouse: tilt the phone to move the cursor ─────────────────
  const AIR_SENS = 8;
  let airOn = false, airLast = null;
  function airHandler(e) {
    if (e.beta == null || e.gamma == null) return;
    if (airLast) {
      enqueue({ t: 'move', dx: (e.gamma - airLast.gamma) * AIR_SENS,
                           dy: (e.beta  - airLast.beta)  * AIR_SENS });
    }
    airLast = { beta: e.beta, gamma: e.gamma };
  }
  async function toggleAir(btn) {
    if (airOn) return stopAir(btn);
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try { if (await DOE.requestPermission() !== 'granted') return; } catch { return; }
    }
    airLast = null; airOn = true;
    window.addEventListener('deviceorientation', airHandler);
    btn.classList.add('active');
  }
  function stopAir(btn) {
    airOn = false;
    window.removeEventListener('deviceorientation', airHandler);
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
    const SENS = 1.6;            // pointer speed multiplier
    let touchMode = null;       // 'move' | 'scroll'
    let lastX = 0, lastY = 0, moved = 0, startT = 0;

    pad.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startT = Date.now(); moved = 0;
      if (e.touches.length === 2) {
        touchMode = 'scroll';
        lastX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        lastY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      } else {
        touchMode = 'move';
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      }
    }, { passive: false });

    pad.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (touchMode === 'scroll' && e.touches.length >= 2) {
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        enqueue({ t: 'wheel', dx: -(cx - lastX), dy: -(cy - lastY) });
        lastX = cx; lastY = cy;
      } else if (touchMode === 'move') {
        const t = e.touches[0];
        const dx = t.clientX - lastX, dy = t.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        enqueue({ t: 'move', dx: dx * SENS, dy: dy * SENS });
        lastX = t.clientX; lastY = t.clientY;
      }
    }, { passive: false });

    pad.addEventListener('touchend', (e) => {
      e.preventDefault();
      const quick = Date.now() - startT < 250;
      if (touchMode === 'move' && moved < 8 && quick) enqueue({ t: 'click', button: 0 });
      else if (touchMode === 'scroll' && moved < 8 && quick) enqueue({ t: 'click', button: 2 });
      touchMode = null;
    }, { passive: false });

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
      if (locked) enqueue({ t: 'move', dx: e.movementX * SENS, dy: e.movementY * SENS });
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

  // Whole-keyboard capture while pointer-locked (desktop). Esc is reserved by
  // the browser to release the lock, so a real Esc to the controllee is sent
  // via the on-screen Esc key instead.
  function captureKey(e) {
    if (!locked) return;
    if (e.key === 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    const special = ['Enter','Backspace','Tab','Delete','Home','End','PageUp','PageDown',
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
