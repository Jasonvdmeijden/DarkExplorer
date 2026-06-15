const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

let pty;
try { pty = require('node-pty'); } catch { pty = null; }

const sessions = new Map();

// Matches OSC 9;9;<path> (cmd/PowerShell "report cwd") and OSC 7;<uri> (bash/zsh "report cwd")
const CWD_OSC_RE = /\x1b\](?:9;9|7);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

// Appended to bash/zsh PROMPT_COMMAND so the shell reports its cwd via OSC 7 on every prompt
const BASH_OSC_INIT = 'export PROMPT_COMMAND=\'printf "\\033]7;file://%s\\033\\\\" "$PWD"\'\n';

// Redefines the PowerShell prompt to also report cwd via OSC 9;9 on every prompt
const POWERSHELL_OSC_INIT = 'function prompt { $p = $PWD.Path; $e=[char]27; Write-Host -NoNewline "$e]9;9;$p$e\\"; "PS $p> " }\r';

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

// Scans PTY output for OSC 9;9 / OSC 7 "report cwd" sequences and reports changes via onCwd.
// Keeps a small rolling buffer so a sequence split across two data chunks is still caught.
function makeCwdScanner(id, onCwd) {
  let buf = '';
  return function scan(chunk) {
    if (!onCwd) return;
    buf = (buf + chunk).slice(-4096);
    let m, last = null;
    CWD_OSC_RE.lastIndex = 0;
    while ((m = CWD_OSC_RE.exec(buf))) last = m;
    if (!last) return;
    let p = last[1];
    if (p.startsWith('file://')) {
      try { p = decodeURIComponent(p.replace(/^file:\/\/[^/]*/, '')); } catch {}
    }
    const session = sessions.get(id);
    if (p && session && p !== session.cwd) {
      session.cwd = p;
      onCwd(p);
    }
    buf = buf.slice(last.index + last[0].length);
  };
}

function create(id, { cwd, shell: shellName, cols = 80, rows = 24, onData, onExit, onCwd }) {
  if (sessions.has(id)) {
    destroy(id);
  }

  const shell = resolveShell(shellName);
  const args  = shellArgs(shell);
  const spawnCwd = cwd || os.homedir();
  const isMac = process.platform === 'darwin';
  const scanCwd = makeCwdScanner(id, onCwd);

  if (pty && !isMac) {
    try {
      const env = { ...process.env };
      if (shell === 'cmd.exe') env.PROMPT = '$E]9;9;$P$E\\$P$G';
      const proc = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: spawnCwd,
        env
      });
      proc.onData(data => { scanCwd(data); onData(data); });
      proc.onExit(({ exitCode }) => onExit(exitCode));
      sessions.set(id, { type: 'pty', proc, shell, cwd: spawnCwd });
      if (onCwd) onCwd(spawnCwd);
      if (shell === 'powershell.exe') {
        setTimeout(() => { try { proc.write(POWERSHELL_OSC_INIT); } catch {} }, 400);
      }
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
    if (onCwd) onCwd(spawnCwd);

    proc.stdout.on('data', d => { const s = d.toString(); scanCwd(s); onData(s.replace(/\n/g, '\r\n')); });
    proc.stderr.on('data', d => { const s = d.toString(); scanCwd(s); onData(s.replace(/\n/g, '\r\n')); });
    proc.on('exit', code => {
      onData(`\r\n[Terminal session finished]\r\n`);
      if (onExit) onExit(code);
      sessions.delete(id);
    });

    // Auto-clear to hide initial startup noise, then enable OSC 7 cwd reporting
    setTimeout(() => {
      proc.stdin.write('clear\n');
      proc.stdin.write(BASH_OSC_INIT);
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
    if (onCwd) onCwd(spawnCwd);

    proc.stdout.on('data', d => { const s = d.toString(); scanCwd(s); onData(s.replace(/\n/g, '\r\n')); });
    proc.stderr.on('data', d => { const s = d.toString(); scanCwd(s); onData(s.replace(/\n/g, '\r\n')); });
    proc.on('exit', code => {
      onData(`\r\n[Process exited]\r\n`);
      if (onExit) onExit(code);
      sessions.delete(id);
    });

    // Enable OSC 7 cwd reporting on every prompt
    setTimeout(() => { try { proc.stdin.write(BASH_OSC_INIT); } catch {} }, 300);
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

function getCwd(id) {
  const s = sessions.get(id);
  return s ? s.cwd : null;
}

module.exports = { create, input, resize, switchShell, destroy, resolveShell, isAlive, getCwd };
