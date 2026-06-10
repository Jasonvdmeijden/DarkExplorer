const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

let pty;
try { pty = require('node-pty'); } catch { pty = null; }

const sessions = new Map();

function defaultShell() {
  const config = require('./config');
  const p = process.platform;
  if (p === 'win32') return config.shell.windows || 'cmd.exe';
  if (p === 'darwin') return config.shell.mac || '/bin/zsh';
  return config.shell.linux || '/bin/bash';
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
  if (sessions.has(id)) {
    destroy(id);
  }

  const shell = resolveShell(shellName);
  const args  = shellArgs(shell);
  const spawnCwd = cwd || os.homedir();
  const isMac = process.platform === 'darwin';

  if (pty && !isMac) {
    try {
      const proc = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: spawnCwd,
        env: process.env
      });
      proc.onData(onData);
      proc.onExit(({ exitCode }) => onExit(exitCode));
      sessions.set(id, { type: 'pty', proc, shell });
    } catch (err) {
      console.error(`[terminal] pty.spawn failed: ${err.message}`);
      onData(`\r\n[Error: ${err.message}]\r\n`);
      if (onExit) onExit(1);
    }
  } else if (isMac) {
    // Mac Bridge: Use Python to create a real PTY since node-pty is failing.
    // This provides the native zsh prompt and interactive features.
    const pythonCmd = `import pty, os; os.chdir("${spawnCwd}"); pty.spawn("${shell}")`;
    const proc = spawn('python3', ['-c', pythonCmd], {
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const session = { type: 'bridge', shell, cwd: spawnCwd, proc, onData, onExit };
    sessions.set(id, session);

    proc.stdout.on('data', d => onData(d.toString().replace(/\n/g, '\r\n')));
    proc.stderr.on('data', d => onData(d.toString().replace(/\n/g, '\r\n')));
    proc.on('exit', code => {
      onData(`\r\n[Terminal session finished]\r\n`);
      if (onExit) onExit(code);
      sessions.delete(id);
    });

    // Auto-clear to hide initial startup noise
    setTimeout(() => {
      proc.stdin.write('clear\n');
    }, 500);
  } else {
    // Linux/Other Fallback
    const proc = spawn(shell, ['-i'], {
      cwd: spawnCwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const session = { type: 'runner', shell, cwd: spawnCwd, proc, onData, onExit, _buf: '' };
    sessions.set(id, session);
    proc.stdout.on('data', d => onData(d.toString().replace(/\n/g, '\r\n')));
    proc.stderr.on('data', d => onData(d.toString().replace(/\n/g, '\r\n')));
    proc.on('exit', code => {
      onData(`\r\n[Process exited]\r\n`);
      if (onExit) onExit(code);
      sessions.delete(id);
    });
  }
}

function input(id, data) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.type === 'pty') {
    s.proc.write(data);
  } else if (s.type === 'bridge') {
    // Python PTY bridge handles echo and everything else naturally
    if (data === '\r' || data === '\n') {
      s.proc.stdin.write('\n');
    } else {
      s.proc.stdin.write(data);
    }
  } else {
    // basic runner fallback
    if (data === '\r' || data === '\n') {
      s.onData('\r\n');
      s.proc.stdin.write('\n');
    } else {
      s.onData(data);
      s.proc.stdin.write(data);
    }
  }
}

function resize(id, cols, rows) {
  const s = sessions.get(id);
  if (s && s.type === 'pty') s.proc.resize(cols, rows);
}

function switchShell(id, shellName) {
  const s = sessions.get(id);
  if (!s) return;
  destroy(id);
  return resolveShell(shellName);
}

function destroy(id) {
  const s = sessions.get(id);
  if (!s) return;
  try { s.proc.kill(); } catch {}
  sessions.delete(id);
}

function isAlive(id) { return sessions.has(id); }

module.exports = { create, input, resize, switchShell, destroy, resolveShell, isAlive };
