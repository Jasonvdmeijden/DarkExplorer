const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

function _git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10000, windowsHide: true });
}

function _statusOf(cwd, file) {
  try {
    const out = _git(cwd, ['status', '--porcelain', '--', file]);
    return out.length >= 2 ? { x: out[0], y: out[1] } : null;
  } catch { return null; }
}

function _looksBinary(buf) {
  const probe = buf.slice(0, Math.min(buf.length, 8000));
  for (let i = 0; i < probe.length; i++) if (probe[i] === 0) return true;
  return false;
}

function _newFileDiff(cwd, file) {
  const full = path.join(cwd, file);
  let buf;
  try { buf = fs.readFileSync(full); } catch { return ''; }
  const header = `diff --git a/${file} b/${file}\nnew file\n--- /dev/null\n+++ b/${file}\n`;
  if (_looksBinary(buf)) return header + '@@ Binary file (new) @@\n';
  const text  = buf.toString('utf8');
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop(); // drop trailing empty
  return header + `@@ -0,0 +1,${lines.length} @@\n` + lines.map(l => '+' + l).join('\n') + '\n';
}

function isRepo(dirPath) {
  if (!dirPath) return false;
  try { _git(dirPath, ['rev-parse', '--git-dir']); return true; } catch { return false; }
}

function repoRoot(cwd) {
  try { return _git(cwd, ['rev-parse', '--show-toplevel']).trim(); } catch { return null; }
}

function currentBranch(cwd) {
  try { return _git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(); } catch { return 'HEAD'; }
}

function branches(cwd) {
  try {
    return _git(cwd, ['branch', '--format=%(refname:short)|%(HEAD)'])
      .trim().split('\n').filter(Boolean)
      .map(l => { const [n, h] = l.split('|'); return { name: n.trim(), current: h.trim() === '*' }; });
  } catch { return []; }
}

function status(cwd) {
  const LABELS = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict', '?': 'untracked' };
  try {
    const out = _git(cwd, ['status', '--porcelain=v1', '-uall']);
    const staged = [], changes = [];
    out.trim().split('\n').filter(Boolean).forEach(line => {
      const X = line[0], Y = line[1], file = line.slice(3);
      if (X !== ' ' && X !== '?') staged.push({ path: file, code: X, label: LABELS[X] || X });
      if (Y !== ' ')               changes.push({ path: file, code: Y === '?' ? '?' : Y, label: LABELS[Y] || Y });
    });
    return { staged, changes };
  } catch { return { staged: [], changes: [] }; }
}

function log(cwd, n = 5) {
  try {
    const out = _git(cwd, ['log', `--max-count=${n}`, '--format=%H%x00%an%x00%s%x00%cr%x1E']);
    return out.trim().split('\x1e').filter(l => l.trim()).map(e => {
      const [h, a, s, d] = e.trim().split('\x00');
      return { hash: (h || '').slice(0, 7), author: a || '', subject: s || '', date: d || '' };
    });
  } catch { return []; }
}

function diff(cwd, file, staged = false) {
  let out = '';
  try { out = _git(cwd, staged ? ['diff', '--cached', '--', file] : ['diff', '--', file]); } catch {}
  if (out.trim()) return out;

  // Empty diff — handle the cases git doesn't show by default
  const st = _statusOf(cwd, file);
  if (!st) return '';

  // Untracked: synthesize a "new file" diff from the working-copy contents
  if (st.x === '?' && st.y === '?') return _newFileDiff(cwd, file);

  // Deleted (unstaged D, or staged D when looking at staged view)
  const isDeleted = (!staged && st.y === 'D') || (staged && st.x === 'D');
  if (isDeleted) return `diff --git a/${file} b/${file}\ndeleted file\n--- a/${file}\n+++ /dev/null\n@@ File deleted @@\n`;

  return '';
}

function stage(cwd, files)   { _git(cwd, ['add',      '--', ...files]); }
function unstage(cwd, files) { _git(cwd, ['reset', 'HEAD', '--', ...files]); }
function revert(cwd, files)  { _git(cwd, ['checkout',  '--', ...files]); }
function commit(cwd, msg)    { _git(cwd, ['commit', '-m', msg]); }
function checkout(cwd, br)   { _git(cwd, ['checkout', br]); }
function createBranch(cwd, n){ _git(cwd, ['checkout', '-b', n]); }

module.exports = { isRepo, repoRoot, currentBranch, branches, status, log, diff, stage, unstage, revert, commit, checkout, createBranch };
