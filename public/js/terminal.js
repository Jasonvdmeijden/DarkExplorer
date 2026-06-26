/* Terminal — xterm.js PTY bridge, shared across all connected devices */
const Term = (() => {
  let term     = null;
  let fitAddon = null;
  let sid      = null;
  let resizeObs = null;

  // sid -> normalized cwd, kept in sync via terminal:cwd broadcasts
  const sessions = new Map();
  // shell currently driving the active session, for building the right `cd` command
  let _shellKind = /win/i.test(navigator.platform || '') ? 'cmd' : 'bash';
  // loop guards between explorer navigation and terminal `cd`
  let _pendingExplorerSync = null; // cwd we navigated the explorer to, awaiting its nav listener
  let _pendingTermSync     = null; // path we `cd`'d the terminal to, awaiting its cwd report

  // Normalize a path for comparison: forward slashes, lowercase, no trailing slash
  // (except drive roots, which always keep one — "C:" -> "C:/").
  function _norm(p) {
    if (!p) return p;
    let s = String(p).replace(/\\/g, '/').replace(/\/+$/, '');
    if (/^[A-Za-z]:$/.test(s)) s += '/';
    return s.toLowerCase();
  }
  function pathsEqual(a, b) {
    if (a == null || b == null) return a === b;
    return _norm(a) === _norm(b);
  }
  function _cdCommand(path) {
    const p = String(path);
    if (_shellKind === 'powershell') return `Set-Location -LiteralPath "${p}"\r`;
    if (_shellKind === 'cmd')        return `cd /d "${p}"\r`;
    return `cd "${p.replace(/"/g, '\\"')}"\r`;
  }

  // ── In-app on-screen keyboard (mobile only) ────────────────────────
  // The native mobile keyboard is unreliable over a PTY (it hides/show the
  // viewport, autocorrects, and can't send Ctrl/Esc/arrows), so on touch
  // devices we render our own keyboard — mirroring the remote-control overlay's
  // layout — and translate each press into raw terminal bytes. The header's
  // arrow/modifier bar was removed in favour of this; desktop uses the physical
  // keyboard and never shows the OSK.
  let _oskLayer = 'alpha';                                  // 'alpha' | 'symbol'
  const _oskMods = { ctrl: false, alt: false, shift: false, meta: false };
  const CTRL_MAP = (() => {
    const m = {};
    for (let c = 65; c <= 90; c++) m[String.fromCharCode(c)] = c - 64;  // Ctrl+A..Z
    for (let c = 97; c <= 122; c++) m[String.fromCharCode(c)] = c - 96; // Ctrl+a..z
    Object.assign(m, { '@': 0, '[': 27, '\\': 28, ']': 29, '^': 30, '_': 31, '?': 127 });
    return m;
  })();
  const ARROW_CODE = { up: 'A', down: 'B', right: 'C', left: 'D' };

  const OSK_LAYERS = {
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
  function _oskCommonRows() {
    return [
      [{ layer: 1, l: _oskLayer === 'alpha' ? '123' : 'ABC', w: 1.4 },
       { mod: 'ctrl', l: 'Ctrl' }, { mod: 'alt', l: 'Alt' }, { mod: 'meta', l: '⌘' },
       { char: ' ', l: 'space', w: 4 },
       { key: 'Tab', l: '⇥' }, { key: 'Escape', l: 'Esc' }, { key: 'Enter', l: '⏎', w: 1.4 }],
      [{ key: 'ArrowLeft', l: '←' }, { key: 'ArrowUp', l: '↑' },
       { key: 'ArrowDown', l: '↓' }, { key: 'ArrowRight', l: '→' }],
    ];
  }
  function _oskMakeKey(cell) {
    if (typeof cell === 'string') cell = { char: cell, l: cell };
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'term-key';
    b.textContent = cell.l != null ? cell.l : (cell.char || '');
    if (cell.w) b.style.flex = String(cell.w);
    if (cell.char != null)   b.dataset.char = cell.char;
    else if (cell.mod)     { b.dataset.mod = cell.mod; if (_oskMods[cell.mod]) b.classList.add('active'); }
    else if (cell.key)       b.dataset.key = cell.key;
    else if (cell.layer)     b.dataset.layer = '1';
    return b;
  }
  function _buildOsk() {
    const host = document.getElementById('term-osk');
    if (!host) return;
    host.innerHTML = '';
    for (const row of OSK_LAYERS[_oskLayer].concat(_oskCommonRows())) {
      const r = document.createElement('div');
      r.className = 'osk-row';
      for (const cell of row) r.appendChild(_oskMakeKey(cell));
      host.appendChild(r);
    }
  }
  // Sticky modifiers are one-shot: applied to the next key, then released.
  function _clearOskMods() {
    let changed = false;
    for (const k in _oskMods) if (_oskMods[k]) { _oskMods[k] = false; changed = true; }
    if (changed) {
      document.querySelectorAll('#term-osk .term-key.active').forEach(b => b.classList.remove('active'));
    }
  }
  function _oskSend(data) {
    if (!sid || data == null) return;
    WS.emit('terminal:input', { sid, data });
    if (term) term.focus();
  }
  // Translate a printable character through the active sticky modifiers.
  function _oskSendChar(ch) {
    const m = _oskMods;
    let out = ch;
    if (m.shift && out.length === 1 && /[a-z]/.test(out)) out = out.toUpperCase();
    if (m.ctrl && CTRL_MAP[out] !== undefined) out = String.fromCharCode(CTRL_MAP[out]);
    if (m.alt || m.meta) out = '\x1b' + out;                // Alt/Meta → Escape-prefixed
    _oskSend(out);
    _clearOskMods();
  }
  // Translate a named key (arrows/Tab/Enter/Esc/Backspace) into a byte sequence.
  function _oskSendKey(key) {
    const m = _oskMods;
    const param = 1 + (m.shift ? 1 : 0) + (m.alt ? 2 : 0) + (m.ctrl ? 4 : 0) + (m.meta ? 8 : 0);
    const arrowDir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[key];
    let seq;
    if (arrowDir) {
      const code = ARROW_CODE[arrowDir];
      seq = param > 1 ? `\x1b[1;${param}${code}` : `\x1b[${code}`;
    } else if (key === 'Enter')      seq = '\r';
    else if (key === 'Tab')          seq = m.shift ? '\x1b[Z' : '\t';
    else if (key === 'Escape')       seq = (m.alt || m.meta) ? '\x1b\x1b' : '\x1b';
    else if (key === 'Backspace')    seq = '\x7f';
    else return;
    _oskSend(seq);
    _clearOskMods();
  }
  function _oskPress(btn) {
    if (btn.dataset.layer) {
      _oskLayer = _oskLayer === 'alpha' ? 'symbol' : 'alpha';
      _buildOsk();
    } else if (btn.dataset.mod) {
      _oskMods[btn.dataset.mod] = !_oskMods[btn.dataset.mod];
      btn.classList.toggle('active', _oskMods[btn.dataset.mod]);
    } else if (btn.dataset.char != null) {
      _oskSendChar(btn.dataset.char);
    } else if (btn.dataset.key) {
      _oskSendKey(btn.dataset.key);
    }
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch {} }
  }
  function _initOsk() {
    const host = document.getElementById('term-osk');
    if (!host || host.dataset.wired) return;
    host.dataset.wired = '1';
    _buildOsk();
    // pointerdown for instant response; preventDefault keeps the PTY focused.
    host.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('.term-key');
      if (!btn) return;
      e.preventDefault();
      btn.classList.add('pressed');
      _oskPress(btn);
    });
    host.addEventListener('pointerup',     (e) => { const b = e.target.closest('.term-key'); if (b) b.classList.remove('pressed'); });
    host.addEventListener('pointercancel', (e) => { const b = e.target.closest('.term-key'); if (b) b.classList.remove('pressed'); });
  }

  // Build an xterm theme from the current page CSS vars so the terminal matches
  // the active app theme (and in particular flips with the light/dark toggle).
  function _themeForXterm() {
    const s = getComputedStyle(document.documentElement);
    const v = (n, fallback) => (s.getPropertyValue(n).trim() || fallback);
    const mode = document.documentElement.dataset.mode || 'dark';
    const isGlass = document.body.classList.contains('glass-effect');
    
    // Use transparent background for glass effect, otherwise fallback to theme base
    const bg = isGlass ? 'transparent' : v('--bg-base', mode === 'light' ? '#ffffff' : '#12121a');
    const fg = v('--text-primary', mode === 'light' ? '#1a1a2e' : '#e2e2f0');
    const cursor = v('--accent', '#7c6ef5');
    const selBg  = v('--accent-dim', 'rgba(124,110,245,.35)');
    return {
      background: bg,
      foreground: fg,
      cursor: cursor,
      cursorAccent: bg,
      selectionBackground: selBg,
      selectionForeground: fg
    };
  }
  // React to app theme changes — flip the xterm theme without reattaching the PTY
  document.addEventListener('themechange', () => {
    if (term) {
      try { term.options.theme = _themeForXterm(); } catch {}
    }
  });

  WS.on('terminal:data', (d) => {
    if (d.sid !== sid) return;
    if (term) term.write(d.data);
  });
  WS.on('terminal:exit', (d) => {
    sessions.delete(d.sid);
    if (d.sid !== sid) return;
    if (term) term.write('\r\n[Process exited]\r\n');
    sid = null;
    State.set('activeTerm', { open: false, sid: null });
  });

  // The shell's cwd changed (it received `cd`, or we sent one) — keep the explorer in sync.
  WS.on('terminal:cwd', (d) => {
    if (!d?.sid) return;
    sessions.set(d.sid, _norm(d.cwd));
    if (d.sid !== sid) return;
    if (_pendingTermSync !== null && pathsEqual(d.cwd, _pendingTermSync)) {
      _pendingTermSync = null;
      return;
    }
    _pendingTermSync = null;
    const current = Explorer.getCurrentPath();
    if (!pathsEqual(d.cwd, current)) {
      _pendingExplorerSync = d.cwd;
      Explorer.navigate(d.cwd);
    }
  });

  // Called via Explorer.addNavListener — the app navigated, keep the terminal in sync.
  function syncToPath(path) {
    if (path == null) return;
    if (_pendingExplorerSync !== null && pathsEqual(path, _pendingExplorerSync)) {
      _pendingExplorerSync = null;
      return;
    }
    _pendingExplorerSync = null;
    if (!sid) return; // terminal not open — nothing to sync
    if (pathsEqual(sessions.get(sid), path)) return;

    // Reuse an existing session for this folder instead of spawning a new one
    for (const [s, cwd] of sessions) {
      if (s !== sid && pathsEqual(cwd, path)) { _attachExisting(s); return; }
    }

    _pendingTermSync = path;
    WS.emit('terminal:input', { sid, data: _cdCommand(path) });
  }

  async function _attachExisting(newSid) {
    if (newSid === sid) return;
    sid = newSid;
    State.set('activeTerm', { open: true, sid });
    Panels.showBottom();
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      const ok = await _initXterm();
      if (ok) { term.clear(); _safeFit(); term.focus(); }
    }));
  }

  // Cross-device: another device opened or closed the terminal
  State.onChange('activeTerm', async (val) => {
    if (!val) return;
    if (val.open && val.sid && val.sid !== sid) {
      const ok = await _verifySid(val.sid);
      if (ok) _attach(val.sid);
    } else if (!val.open && sid) {
      _localClose();
    }
  });

  // On first connect, only restore if the server still has the session
  State.onReady(async () => {
    const val = State.get('activeTerm', null);
    if (!val?.open || !val?.sid) return;
    const ok = await _verifySid(val.sid);
    if (ok) _attach(val.sid);
    else State.set('activeTerm', { open: false, sid: null });
  });

  async function _verifySid(checkSid) {
    try {
      const res = await WS.send('terminal:verify', { sid: checkSid });
      if (res?.alive && res?.cwd) sessions.set(checkSid, _norm(res.cwd));
      return !!res?.alive;
    } catch { return false; }
  }

  function _ensureXtermLoaded() {
    return new Promise((resolve, reject) => {
      if (window.Terminal) return resolve();
      const t0 = Date.now();
      const i = setInterval(() => {
        if (window.Terminal) { clearInterval(i); resolve(); }
        else if (Date.now() - t0 > 5000) { clearInterval(i); reject(new Error('xterm.js failed to load')); }
      }, 50);
    });
  }

  async function _initXterm() {
    if (term) return true;
    try { await _ensureXtermLoaded(); }
    catch (e) {
      const c = document.getElementById('terminal-container');
      c.textContent = 'Terminal library failed to load (check network/CDN)';
      c.style.color = 'var(--danger)';
      c.style.padding = '1rem';
      return false;
    }

    const isMobile = window.innerWidth <= 768;
    term = new Terminal({
      theme: _themeForXterm(),
      fontSize: isMobile ? 10 : 13,
      lineHeight: isMobile ? 1.1 : 1.2,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'SF Mono', Menlo, Monaco, Consolas, 'DejaVu Sans Mono', 'Ubuntu Mono', monospace",
      cursorBlink: true,
      allowTransparency: true,
      allowProposedApi: true,
      scrollback: 5000,
      overviewRulerWidth: 10
    });

    if (window.FitAddon) {
      fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
    }

    const container = document.getElementById('terminal-container');
    container.innerHTML = '';
    container.style.color = '';
    container.style.padding = '.3rem';
    term.open(container);
    term.focus();

    // On mobile we type through our own in-app keyboard (#term-osk), so suppress
    // the native soft keyboard: xterm's hidden helper <textarea> would otherwise
    // pop the OS keyboard whenever it's focused (incl. the touch handler below).
    // inputmode="none" keeps the textarea focusable/selectable but hides the VKB.
    if (isMobile) {
      const ta = term.textarea || container.querySelector('.xterm-helper-textarea');
      if (ta) {
        ta.setAttribute('inputmode', 'none');
        ta.setAttribute('autocorrect', 'off');
        ta.setAttribute('autocapitalize', 'off');
        ta.setAttribute('spellcheck', 'false');
      }
    }

    _safeFit();
    // Belt-and-braces refits as layout settles
    setTimeout(_safeFit, 80);
    setTimeout(_safeFit, 250);

    // ResizeObserver catches any later container resize (panel splitter drag, viewport change)
    if (window.ResizeObserver && !resizeObs) {
      resizeObs = new ResizeObserver(() => _safeFit());
      resizeObs.observe(container);
    }

    // iOS Safari focus workaround — must run from a direct touch handler
    container.addEventListener('touchstart', () => {
      if (!term) return;
      term.focus();
      const ta = container.querySelector('textarea');
      if (ta) ta.focus();
    }, { passive: true });

    term.onData(data => {
      if (!sid) return;
      WS.emit('terminal:input', { sid, data });
    });
    window.addEventListener('resize', _safeFit);
    return true;
  }

  function _safeFit() {
    if (!fitAddon || !term) return;
    const c = document.getElementById('terminal-container');
    if (!c || c.clientWidth < 20 || c.clientHeight < 20) return;
    try {
      fitAddon.fit();
      if (sid) WS.emit('terminal:resize', { sid, cols: term.cols, rows: term.rows });
    } catch {}
  }

  async function _attach(remoteSid) {
    Panels.showBottom();
    sid = remoteSid;
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      const ok = await _initXterm();
      if (ok) _safeFit();
    }));
  }

  function _localClose() {
    sid = null;
    Panels.hideBottom();
  }

  async function open(cwd) {
    Panels.showBottom();
    _initOsk();                              // idempotent; OSK shown only on mobile (CSS)
    const target = cwd || Explorer.getCurrentPath();

    // Already showing a session for this folder — just (re)fit it
    if (sid && pathsEqual(sessions.get(sid), target)) {
      requestAnimationFrame(() => requestAnimationFrame(async () => {
        const ok = await _initXterm();
        if (ok) _safeFit();
      }));
      return;
    }

    // Reuse an existing background session for this folder instead of spawning a new one
    for (const [s, scwd] of sessions) {
      if (pathsEqual(scwd, target)) { await _attachExisting(s); return; }
    }

    if (sid) {
      await WS.send('terminal:destroy', { sid }).catch(() => {});
      sessions.delete(sid);
      sid = null;
    }

    requestAnimationFrame(() => requestAnimationFrame(async () => {
      const ok = await _initXterm();
      if (ok) createSession(target);
    }));
  }

  async function createSession(cwd) {
    try {
      const res = await WS.send('terminal:create', {
        cwd:  cwd || null,
        cols: term ? term.cols : 80,
        rows: term ? term.rows : 24
      });
      sid = res.sid;
      if (!sessions.has(sid)) sessions.set(sid, _norm(cwd) || null);
      State.set('activeTerm', { open: true, sid });
      _safeFit();
      if (term) term.focus();
    } catch (e) {
      if (term) term.write(`\r\n[Error: ${e.message}]\r\n`);
    }
  }

  function openHere(dirPath) { open(dirPath); }

  async function switchShell(shellName) {
    if (sid) { await WS.send('terminal:switch', { sid }).catch(() => {}); sessions.delete(sid); sid = null; }
    _shellKind = shellName === 'powershell' ? 'powershell' : (shellName === 'cmd' ? 'cmd' : 'bash');
    const res = await WS.send('terminal:create', {
      shell: shellName,
      cwd: Explorer.getCurrentPath(),
      cols: term ? term.cols : 80,
      rows: term ? term.rows : 24
    });
    sid = res.sid;
    State.set('activeTerm', { open: true, sid });
  }

  function destroy() {
    if (sid) { WS.send('terminal:destroy', { sid }).catch(() => {}); sessions.delete(sid); sid = null; }
    _localClose();
    State.set('activeTerm', { open: false, sid: null });
  }

  function hide() {
    Panels.hideBottom();
  }

  document.getElementById('btn-term-close').addEventListener('click', hide);
  document.getElementById('btn-toggle-terminal').addEventListener('click', () => {
    const panelBottom = document.getElementById('panel-bottom');
    if (panelBottom.style.display !== 'none') {
      hide();
    } else {
      if (sid) {
        Panels.showBottom();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (term) { _safeFit(); term.focus(); }
        }));
      } else {
        open();
      }
    }
  });
  document.getElementById('btn-term-shell').addEventListener('click', async () => {
    const isWin = navigator.platform.toLowerCase().includes('win');
    const newShell = isWin ? (prompt('Shell (cmd / powershell):') || 'cmd') : 'bash';
    await switchShell(newShell);
  });

  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === '`') {
      e.preventDefault();
      document.getElementById('btn-toggle-terminal').click();
    }
  });

  return { open, openHere, switchShell, hide, destroy, syncToPath };
})();
