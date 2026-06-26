/* control-receiver.js — the CONTROLLEE side of remote control.
 *
 * Renders a fake "DarkExplorer pointer" and replays input streamed from a
 * controller: move / click / scroll / nav / keyboard / text. Hover and focus
 * are made to behave like a real cursor:
 *   - focus is real (synthetic el.focus() sets :focus for free)
 *   - :hover is emulated via a runtime stylesheet shim that mirrors every
 *     `:hover` rule onto a `.de-vhover` class, toggled along the cursor's
 *     element-from-point ancestor chain.
 *
 * Nothing here is persisted; it only acts while this client is bound as a
 * controllee. The controller drives it through the server relay (control:input).
 */
const ControlReceiver = (() => {
  let active = false;          // bound as a controllee right now
  let controllerName = '';
  let cursorEl = null;
  let bannerEl = null;
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  let hoverChain = [];         // elements currently carrying .de-vhover
  let lastOver = null;         // last element for mouseover/out emulation
  let shimBuilt = false;
  let held = 0;                // pressed-button bitmask (DOM `buttons`)

  // ── Virtual cursor ───────────────────────────────────────────────
  function ensureCursor() {
    if (cursorEl) return;
    cursorEl = document.createElement('div');
    cursorEl.id = 'de-vcursor';
    cursorEl.innerHTML =
      `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
         <path d="M2 2 L2 16 L6 12.5 L8.5 18 L11 17 L8.6 11.6 L14 11 Z"
               fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/>
       </svg>`;
    document.body.appendChild(cursorEl);
    paintCursor();
  }
  function paintCursor() {
    if (cursorEl) cursorEl.style.transform = `translate(${x}px, ${y}px)`;
  }

  // ── Hover shim: mirror every `:hover` rule onto `.de-vhover` ──────
  function buildHoverShim() {
    if (shimBuilt) return;
    const out = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; } // cross-origin — skip
      if (rules) collectHoverRules(rules, out);
    }
    if (out.length) {
      const style = document.createElement('style');
      style.id = 'de-vhover-shim';
      style.textContent = out.join('\n');
      document.head.appendChild(style);
    }
    shimBuilt = true;
  }
  function collectHoverRules(rules, out) {
    for (const rule of rules) {
      if (rule.cssRules) { // @media / @supports — recurse, preserve the wrapper
        const inner = [];
        collectHoverRules(rule.cssRules, inner);
        if (inner.length) {
          const cond = rule.media ? `@media ${rule.media.mediaText}`
                     : (rule.conditionText ? `@supports ${rule.conditionText}` : null);
          out.push(cond ? `${cond}{${inner.join('')}}` : inner.join(''));
        }
        continue;
      }
      if (rule.selectorText && rule.selectorText.includes(':hover')) {
        const sel = rule.selectorText.replace(/:hover/g, '.de-vhover');
        out.push(`${sel}{${rule.style.cssText}}`);
      }
    }
  }

  // ── Event dispatch helpers ───────────────────────────────────────
  function mouse(el, type, init) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent(type, Object.assign(
      { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: held }, init)));
  }
  function pointer(el, type, init) {
    if (!el || typeof PointerEvent === 'undefined') return;
    el.dispatchEvent(new PointerEvent(type, Object.assign(
      { bubbles: true, cancelable: true, view: window, pointerId: 1,
        pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, buttons: held }, init)));
  }
  function btnBit(b) { return b === 0 ? 1 : b === 2 ? 2 : b === 1 ? 4 : 0; }

  function elAt() { return document.elementFromPoint(x, y); }

  // ── Hover update (CSS :hover via class + JS mouseover/out events) ─
  function updateHover() {
    const el = elAt();
    const chain = [];
    let n = el;
    while (n && n.nodeType === 1) { chain.push(n); n = n.parentElement; }

    const next = new Set(chain);
    for (const e of hoverChain) if (!next.has(e)) e.classList.remove('de-vhover');
    for (const e of chain)      if (!e.classList.contains('de-vhover')) e.classList.add('de-vhover');
    hoverChain = chain;

    if (el !== lastOver) {
      if (lastOver) { mouse(lastOver, 'mouseout'); mouse(lastOver, 'mouseleave'); pointer(lastOver, 'pointerout'); }
      if (el)       { mouse(el, 'mouseover'); mouse(el, 'mouseenter'); pointer(el, 'pointerover'); }
      lastOver = el;
    }
    mouse(el, 'mousemove');
    pointer(el, 'pointermove');
  }

  // ── Focus / text ─────────────────────────────────────────────────
  function focusFrom(el) {
    let n = el;
    while (n && n !== document.body) {
      if (n.matches && n.matches('input,textarea,select,[contenteditable],[contenteditable=""],[tabindex],button,a[href]')) {
        try { n.focus(); } catch {}
        return n;
      }
      n = n.parentElement;
    }
    return document.activeElement;
  }
  function insertText(el, str) {
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    el.value = el.value.slice(0, start) + str + el.value.slice(end);
    const pos = start + str.length;
    try { el.setSelectionRange(pos, pos); } catch {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function typeText(str) {
    if (streamRect()) {
      for (const ch of str) {
        const k = robotKey(ch);
        if (!k) continue;
        const mods = (ch >= 'A' && ch <= 'Z') ? ['shift'] : [];
        emitStream({ action: 'keydown', key: k, modifiers: mods });
        emitStream({ action: 'keyup',   key: k, modifiers: mods });
      }
      return;
    }
    // Terminal (xterm) ignores synthetic DOM input — forward to the PTY instead.
    if (typeof Term !== 'undefined' && Term.isTerminalFocused && Term.isTerminalFocused()) {
      Term.remoteText(str);
      return;
    }
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) insertText(el, str);
    else if (el && el.isContentEditable) document.execCommand('insertText', false, str);
  }

  // ── Stream passthrough (phase 2) ─────────────────────────────────
  // A live Sunshine stream is a black-box WebRTC <iframe> — synthetic DOM
  // events can't reach inside it. Instead, when the cursor is over a live
  // stream we drive the HOST's real OS cursor via the server's robotjs path
  // (`stream:input`); the stream video then shows the movement.
  const BTN = { 0: 'left', 1: 'middle', 2: 'right' };
  const ROBOT_KEYS = {
    Enter: 'enter', Backspace: 'backspace', Tab: 'tab', Escape: 'escape',
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    ' ': 'space', Delete: 'delete', Home: 'home', End: 'end',
    PageUp: 'pageup', PageDown: 'pagedown',
  };
  function streamRect() {
    const overlay = document.querySelector('.stream-overlay');
    if (!overlay) return null;
    const cont = overlay.querySelector('#stream-video-container') || overlay;
    const r = cont.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    return r;
  }
  function emitStream(p) { WS.emit('stream:input', p); }
  function robotKey(k) { return ROBOT_KEYS[k] || (k && k.length === 1 ? k.toLowerCase() : null); }
  function robotMods(m) {
    const o = []; if (!m) return o;
    if (m.ctrl) o.push('control'); if (m.alt) o.push('alt');
    if (m.shift) o.push('shift'); if (m.meta) o.push('command');
    return o;
  }

  // ── Action handlers ──────────────────────────────────────────────
  function move(dx, dy) {
    x = Math.max(0, Math.min(window.innerWidth  - 1, x + dx));
    y = Math.max(0, Math.min(window.innerHeight - 1, y + dy));
    paintCursor();
    const st = streamRect();
    if (st) {
      if (cursorEl) cursorEl.style.display = 'none';   // host cursor shows in the stream
      emitStream({ action: 'mousemove', nx: (x - st.left) / st.width, ny: (y - st.top) / st.height });
    } else {
      if (cursorEl && active) cursorEl.style.display = 'block';
      updateHover();
    }
  }
  function moveAbs(nx, ny) {
    x = Math.max(0, Math.min(window.innerWidth  - 1, nx * window.innerWidth));
    y = Math.max(0, Math.min(window.innerHeight - 1, ny * window.innerHeight));
    move(0, 0);
  }
  function down(button) {
    const st = streamRect();
    if (st) { held |= btnBit(button); emitStream({ action: 'mousedown', button: BTN[button] || 'left' }); return; }
    const el = elAt();
    if (!el) return;
    held |= btnBit(button);
    pointer(el, 'pointerdown', { button });
    mouse(el, 'mousedown', { button });
    if (button === 0) focusFrom(el);
  }
  function up(button) {
    held &= ~btnBit(button);
    const st = streamRect();
    if (st) { emitStream({ action: 'mouseup', button: BTN[button] || 'left' }); return; }
    const el = elAt();
    if (!el) return;
    pointer(el, 'pointerup', { button });
    mouse(el, 'mouseup', { button });
    if (button === 2)      mouse(el, 'contextmenu', { button });
    else if (button === 1) mouse(el, 'auxclick', { button });
    else                   mouse(el, 'click', { button });
  }
  function click(button) { down(button); up(button); }
  function nav(dir) {
    if (window.Explorer && Explorer.goBack && dir === 'back')    return Explorer.goBack();
    if (window.Explorer && Explorer.goForward && dir === 'forward') return Explorer.goForward();
    dir === 'back' ? history.back() : history.forward();
  }
  function scroll(dx, dy) {
    if (streamRect()) { emitStream({ action: 'scroll', dx: -dx, dy: -dy }); return; }
    const el = elAt();
    let n = el, target = null;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      const canY = /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight;
      const canX = /(auto|scroll)/.test(s.overflowX) && n.scrollWidth  > n.clientWidth;
      if ((Math.abs(dy) >= Math.abs(dx) && canY) || (Math.abs(dx) > Math.abs(dy) && canX)) { target = n; break; }
      n = n.parentElement;
    }
    (target || document.scrollingElement || document.documentElement).scrollBy({ left: dx, top: dy });
    if (el && typeof WheelEvent !== 'undefined') {
      el.dispatchEvent(new WheelEvent('wheel',
        { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaX: dx, deltaY: dy }));
    }
  }
  function key(info) {
    if (streamRect()) {
      const k = robotKey(info.key);
      if (k) { const mods = robotMods(info.mods); emitStream({ action: 'keydown', key: k, modifiers: mods }); emitStream({ action: 'keyup', key: k, modifiers: mods }); }
      return;
    }
    // Terminal (xterm) ignores synthetic DOM keys — forward to the PTY instead.
    if (typeof Term !== 'undefined' && Term.isTerminalFocused && Term.isTerminalFocused()) {
      Term.remoteKey(info.key, info.mods);
      return;
    }
    const el = document.activeElement || document.body;
    const m = info.mods || {};
    const init = { key: info.key, code: info.code || '', bubbles: true, cancelable: true,
                   ctrlKey: !!m.ctrl, altKey: !!m.alt, shiftKey: !!m.shift, metaKey: !!m.meta };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    // Synthetic keydown won't mutate text fields — apply edits ourselves.
    const isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    if (isField) {
      if (info.key === 'Backspace') {
        const s = el.selectionStart, e = el.selectionEnd;
        if (s === e && s > 0) { el.value = el.value.slice(0, s - 1) + el.value.slice(e); try { el.setSelectionRange(s - 1, s - 1); } catch {} }
        else if (s !== e)     { el.value = el.value.slice(0, s) + el.value.slice(e); try { el.setSelectionRange(s, s); } catch {} }
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (info.key === 'Enter' && el.tagName === 'TEXTAREA') insertText(el, '\n');
    } else if (el.isContentEditable) {
      if (info.key === 'Backspace')  document.execCommand('delete');
      else if (info.key === 'Enter') document.execCommand('insertParagraph');
    }
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  // ── Apply a batch of relayed events ──────────────────────────────
  function applyBatch(payload) {
    if (!active || !payload || !payload.events) return;
    for (const ev of payload.events) {
      switch (ev.t) {
        case 'move':  move(ev.dx || 0, ev.dy || 0); break;
        case 'abs':   moveAbs(ev.nx, ev.ny); break;
        case 'down':  down(ev.button || 0); break;
        case 'up':    up(ev.button || 0); break;
        case 'click': click(ev.button || 0); break;
        case 'nav':   nav(ev.dir); break;
        case 'wheel': scroll(ev.dx || 0, ev.dy || 0); break;
        case 'key':   key(ev); break;
        case 'text':  typeText(ev.str || ''); break;
      }
    }
  }

  // ── Being-controlled banner ──────────────────────────────────────
  function showBanner() {
    if (!bannerEl) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'de-controlled-banner';
      bannerEl.innerHTML =
        `<span class="dcb-dot"></span>
         <span class="dcb-text"></span>
         <button class="dcb-stop" type="button">Stop</button>`;
      bannerEl.querySelector('.dcb-stop').addEventListener('click', () => {
        WS.send('control:unbind', {}).catch(() => {});
      });
      document.body.appendChild(bannerEl);
    }
    bannerEl.querySelector('.dcb-text').textContent = `Controlled by ${controllerName || 'another device'}`;
    bannerEl.style.display = 'flex';
  }
  function hideBanner() { if (bannerEl) bannerEl.style.display = 'none'; }

  function start(name) {
    controllerName = name || '';
    active = true;
    buildHoverShim();
    ensureCursor();
    cursorEl.style.display = 'block';
    showBanner();
  }
  function stop() {
    active = false;
    held = 0;
    if (cursorEl) cursorEl.style.display = 'none';
    for (const e of hoverChain) e.classList.remove('de-vhover');
    hoverChain = []; lastOver = null;
    hideBanner();
  }

  // ── Wire WS ──────────────────────────────────────────────────────
  WS.on('control:bound', (d) => { if (d && d.role === 'controllee') start(d.peerName); });
  WS.on('control:unbound', (d) => { if (!d || d.role === 'controllee') stop(); });
  WS.on('control:input', applyBatch);

  // If our own connection drops, go idle immediately; the controller re-binds us
  // (via control:bound) once both sides are back online.
  if (WS.onClose) WS.onClose(() => { if (active) stop(); });

  window.addEventListener('resize', () => {
    x = Math.min(x, window.innerWidth - 1);
    y = Math.min(y, window.innerHeight - 1);
    paintCursor();
  });

  return { isActive: () => active };
})();
