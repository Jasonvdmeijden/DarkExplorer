/* Terminal — xterm.js PTY bridge, shared across all connected devices */
const Term = (() => {
  let term     = null;
  let fitAddon = null;
  let sid      = null;
  let resizeObs = null;

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
    if (d.sid !== sid) return;
    if (term) term.write('\r\n[Process exited]\r\n');
    sid = null;
    State.set('activeTerm', { open: false, sid: null });
  });

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

    term.onData(data => { if (sid) WS.emit('terminal:input', { sid, data }); });
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

    // Always destroy existing session to ensure a "fresh" start as requested
    if (sid) {
      await WS.send('terminal:destroy', { sid }).catch(() => {});
      sid = null;
    }

    requestAnimationFrame(() => requestAnimationFrame(async () => {
      const ok = await _initXterm();
      if (ok) createSession(cwd);
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
      State.set('activeTerm', { open: true, sid });
      _safeFit();
      if (term) term.focus();
    } catch (e) {
      if (term) term.write(`\r\n[Error: ${e.message}]\r\n`);
    }
  }

  function openHere(dirPath) { open(dirPath); }

  async function switchShell(shellName) {
    if (sid) { await WS.send('terminal:switch', { sid }).catch(() => {}); sid = null; }
    const res = await WS.send('terminal:create', {
      shell: shellName,
      cols: term ? term.cols : 80,
      rows: term ? term.rows : 24
    });
    sid = res.sid;
    State.set('activeTerm', { open: true, sid });
  }

  function close() {
    if (sid) { WS.send('terminal:destroy', { sid }).catch(() => {}); sid = null; }
    _localClose();
    State.set('activeTerm', { open: false, sid: null });
  }

  document.getElementById('btn-term-close').addEventListener('click', close);
  document.getElementById('btn-toggle-terminal').addEventListener('click', () => {
    const panelBottom = document.getElementById('panel-bottom');
    if (sid || panelBottom.style.display !== 'none') close();
    else open();
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

  return { open, openHere, switchShell, close };
})();
