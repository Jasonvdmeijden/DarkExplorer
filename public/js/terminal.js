/* Terminal — xterm.js PTY bridge + command runner fallback */
const Term = (() => {
  let term = null;
  let fitAddon = null;
  let sid = null;
  let ptMode = true; // true = PTY, false = command runner

  function open(cwd) {
    Panels.showBottom();
    if (sid) return; // already running

    if (window.Terminal) {
      term = new Terminal({
        theme: {
          background: '#12121a',
          foreground: '#e2e2f0',
          cursor:     '#7c6ef5'
        },
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
        cursorBlink: true
      });
      fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      const container = document.getElementById('terminal-container');
      container.innerHTML = '';
      term.open(container);
      fitAddon.fit();

      term.onData(data => {
        if (sid) WS.emit('terminal:input', { sid, data });
      });
    }

    createSession(cwd);

    // resize on layout change
    window.addEventListener('resize', fitIfOpen);
  }

  async function createSession(cwd) {
    try {
      const res = await WS.send('terminal:create', {
        cwd:  cwd || null,
        cols: term ? term.cols : 80,
        rows: term ? term.rows : 24
      });
      sid = res.sid;

      WS.on('terminal:data', (d) => {
        if (d.sid !== sid) return;
        if (term) term.write(d.data);
      });
      WS.on('terminal:exit', (d) => {
        if (d.sid !== sid) return;
        if (term) term.write('\r\n[Process exited]\r\n');
        sid = null;
      });
    } catch (e) {
      if (term) term.write(`\r\n[Error: ${e.message}]\r\n`);
    }
  }

  function openHere(path) {
    open(path);
    if (sid) {
      const cmd = `cd "${path}"\r`;
      WS.emit('terminal:input', { sid, data: cmd });
    }
  }

  async function switchShell(shellName) {
    if (sid) {
      await WS.send('terminal:switch', { sid });
      sid = null;
    }
    const res = await WS.send('terminal:create', {
      shell: shellName,
      cols: term ? term.cols : 80,
      rows: term ? term.rows : 24
    });
    sid = res.sid;
  }

  function fitIfOpen() {
    if (fitAddon && sid) fitAddon.fit();
    if (sid && term) WS.emit('terminal:resize', { sid, cols: term.cols, rows: term.rows });
  }

  function close() {
    if (sid) { WS.send('terminal:destroy', { sid }).catch(() => {}); sid = null; }
    Panels.hideBottom();
  }

  // toolbar buttons
  document.getElementById('btn-term-close').addEventListener('click', close);
  document.getElementById('btn-toggle-terminal').addEventListener('click', () => {
    if (sid || document.getElementById('panel-bottom').style.display !== 'none') {
      close();
    } else {
      open();
    }
  });
  document.getElementById('btn-term-shell').addEventListener('click', async () => {
    const isWin = navigator.platform.toLowerCase().includes('win');
    const newShell = isWin ? (prompt('Shell (cmd / powershell):') || 'cmd') : 'bash';
    await switchShell(newShell);
  });

  // Ctrl+`
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === '`') {
      e.preventDefault();
      document.getElementById('btn-toggle-terminal').click();
    }
  });

  return { open, openHere, switchShell, close };
})();
