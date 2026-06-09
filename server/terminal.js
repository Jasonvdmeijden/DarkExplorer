const { spawn } = require('child_process');
const os = require('os');

let pty;
try { pty = require('node-pty'); } catch { pty = null; }

const sessions = new Map();

function defaultShell() {
  const config = require('./config');
  const p = process.platform;
  if (p === 'win32') return config.shell.windows || 'cmd.exe';
  if (p === 'darwin') return config.shell.mac || 'bash';
  return config.shell.linux || 'bash';
}

function shellArgs(shell) {
  if (shell === 'cmd' || shell === 'cmd.exe') return [];
  if (shell === 'powershell' || shell === 'powershell.exe') return ['-NoLogo'];
  return [];
}

function resolveShell(name) {
  if (!name) return defaultShell();
  if (process.platform === 'win32') {
    if (name === 'powershell') return 'powershell.exe';
    if (name === 'cmd') return 'cmd.exe';
  }
  return name;
}

function create(id, { cwd, shell: shellName, cols = 80, rows = 24, onData, onExit }) {
  const shell = resolveShell(shellName);
  const args  = shellArgs(shell);

  if (pty) {
    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || os.homedir(),
      env: process.env
    });
    proc.onData(onData);
    proc.onExit(({ exitCode }) => onExit(exitCode));
    sessions.set(id, { type: 'pty', proc, shell });
  } else {
    // fallback: command runner (no true PTY)
    sessions.set(id, { type: 'runner', shell, cwd: cwd || os.homedir(), onData, onExit });
    onData(`[PTY unavailable — command runner mode]\r\n${shell}> `);
  }
}

function input(id, data) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.type === 'pty') {
    s.proc.write(data);
  } else {
    // command runner: accumulate until newline
    if (!s._buf) s._buf = '';
    s._buf += data;
    if (s._buf.includes('\n') || s._buf.includes('\r')) {
      const cmd = s._buf.trim();
      s._buf = '';
      runCommand(s, cmd);
    }
  }
}

function runCommand(session, cmd) {
  const { shell, cwd, onData, onExit } = session;
  const isWin = process.platform === 'win32';
  const proc = spawn(
    isWin ? 'cmd.exe' : shell,
    isWin ? ['/c', cmd] : ['-c', cmd],
    { cwd, env: process.env, shell: false }
  );
  proc.stdout.on('data', d => onData(d.toString()));
  proc.stderr.on('data', d => onData(d.toString()));
  proc.on('close', code => {
    onData(`\r\n${shell}> `);
  });
}

function resize(id, cols, rows) {
  const s = sessions.get(id);
  if (s && s.type === 'pty') s.proc.resize(cols, rows);
}

function switchShell(id, shellName) {
  const s = sessions.get(id);
  if (!s) return;
  const { onData, onExit } = s.type === 'pty'
    ? { onData: s.proc._listeners?.data?.[0], onExit: s.proc._listeners?.exit?.[0] }
    : s;
  destroy(id);
  // re-create with new shell, preserving callbacks
  if (s.type === 'pty') {
    // callbacks need to be passed again — caller handles this
  }
  return resolveShell(shellName);
}

function destroy(id) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.type === 'pty') {
    try { s.proc.kill(); } catch {}
  }
  sessions.delete(id);
}

function isAlive(id) { return sessions.has(id); }

module.exports = { create, input, resize, switchShell, destroy, resolveShell, isAlive };
