const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const fs   = require('fs');
const path = require('path');

const _execFileAsync = promisify(execFile);

// Disables credential prompts (which would otherwise hang until timeout) and
// any commit-message editor (merge/rebase/pull can try to open one).
const NO_PROMPT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' };

function _git(cwd, args, opts = {}) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8',
    timeout: opts.timeout || 10000,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
    env: opts.env || process.env
  });
}

// For network ops (fetch/pull/push) — doesn't block the event loop while git talks to a remote.
function _gitAsync(cwd, args, timeoutMs = 2 * 60 * 1000, opts = {}) {
  return _execFileAsync('git', args, {
    cwd, encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
    env: opts.env || NO_PROMPT_ENV
  });
}

function _errMsg(e) {
  const stderr = (e.stderr || '').toString().trim();
  return stderr || (e.message || String(e)).trim();
}

// Resolve the actual .git directory, even for submodules where `.git` is a file pointer.
function _gitDirAbs(cwd) {
  try {
    const gd = _git(cwd, ['rev-parse', '--git-dir']).trim();
    return path.isAbsolute(gd) ? gd : path.join(cwd, gd);
  } catch { return null; }
}

function _hasConflicts(cwd) {
  const st = status(cwd);
  return st.staged.some(c => c.code === 'U') || st.changes.some(c => c.code === 'U');
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
    out.split(/\r?\n/).filter(line => line.length > 0).forEach(line => {
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

function _validateUrl(url) {
  if (!url || !/^[a-z]+:\/\/|^git@/.test(url.trim())) {
    throw new Error('Invalid git URL — expected https://, git://, ssh:// or git@host:repo');
  }
  return url.trim();
}

function _isFolderEmpty(cwd) {
  const fs = require('fs');
  let entries;
  try { entries = fs.readdirSync(cwd); } catch { entries = []; }
  return entries.filter(e => e !== '.DS_Store' && e !== 'Thumbs.db' && e !== '.git').length === 0;
}

// Clone an existing remote repo INTO this folder. Requires the folder to be empty.
function cloneRepo(cwd, url) {
  const cleanUrl = _validateUrl(url);
  if (isRepo(cwd)) throw new Error('This folder is already a git repository.');
  if (!_isFolderEmpty(cwd)) throw new Error('Folder is not empty. Use "Init + Link" instead, or pick an empty folder to clone into.');
  _git(cwd, ['clone', cleanUrl, '.'], { timeout: 10 * 60 * 1000 });
  return { ok: true, mode: 'clone', root: repoRoot(cwd) || cwd };
}

// Initialise git in an existing (possibly non-empty) folder and point origin at the given URL.
// Files in the folder are left intact — user can pull/merge from origin manually if needed.
function initAndLink(cwd, url) {
  const cleanUrl = _validateUrl(url);
  if (isRepo(cwd)) throw new Error('This folder is already a git repository.');
  _git(cwd, ['init']);
  try { _git(cwd, ['remote', 'add', 'origin', cleanUrl]); }
  catch { _git(cwd, ['remote', 'set-url', 'origin', cleanUrl]); }
  // Best-effort fetch so branches show up; if offline, just skip.
  try { _git(cwd, ['fetch', 'origin'], { timeout: 5 * 60 * 1000 }); } catch { /* non-fatal */ }
  return { ok: true, mode: 'init', root: repoRoot(cwd) || cwd };
}

// List git submodules under a repo. Returns [{ path, name, sha }, ...]
// `path` is the absolute path to each submodule for the client to use as a new _root.
function listSubmodules(cwd) {
  if (!isRepo(cwd)) return [];
  try {
    const out = _git(cwd, ['submodule', 'status']).trim();
    if (!out) return [];
    const path = require('path');
    const root = repoRoot(cwd) || cwd;
    return out.split('\n').map(line => {
      // Format: " <sha> <path> (<ref>)"   or "+<sha> <path>"  or "-<sha> <path>" (not initialised)
      const m = line.match(/^[ +\-U]([0-9a-f]+)\s+(\S+)/);
      if (!m) return null;
      const relPath = m[2];
      return {
        sha: m[1],
        relPath,
        name: relPath.split(/[\\/]/).pop(),
        path: path.join(root, relPath)
      };
    }).filter(Boolean);
  } catch { return []; }
}

// Add a remote repo as a git submodule of the current repo.
// `subPath` is optional — if omitted, git uses the basename of the URL (e.g. "bar"
// from "https://github.com/foo/bar.git").
function addSubmodule(cwd, url, subPath) {
  const cleanUrl = _validateUrl(url);
  if (!isRepo(cwd)) throw new Error('This folder is not a git repository.');
  const args = ['submodule', 'add', cleanUrl];
  if (subPath && subPath.trim()) args.push(subPath.trim());
  // submodule add does a clone internally → give it room to breathe
  _git(cwd, args, { timeout: 10 * 60 * 1000 });
  return { ok: true };
}

// ── Remotes / sync ─────────────────────────────────────────────────────

function remotes(cwd) {
  try {
    const out = _git(cwd, ['remote', '-v']).trim();
    if (!out) return [];
    const seen = new Map();
    out.split('\n').forEach(line => {
      const m = line.match(/^(\S+)\s+(\S+)\s+\((?:fetch|push)\)/);
      if (m) seen.set(m[1], m[2]);
    });
    return [...seen.entries()].map(([name, url]) => ({ name, url }));
  } catch { return []; }
}

async function fetch(cwd, remote) {
  try {
    const args = remote ? ['fetch', remote] : ['fetch', '--all'];
    const { stdout, stderr } = await _gitAsync(cwd, args, 2 * 60 * 1000);
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (e) {
    return { ok: false, error: _errMsg(e) };
  }
}

async function pull(cwd) {
  try {
    const { stdout, stderr } = await _gitAsync(cwd, ['pull'], 2 * 60 * 1000);
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (e) {
    return { ok: false, error: _errMsg(e), conflict: _hasConflicts(cwd) };
  }
}

async function push(cwd) {
  try {
    let hasUpstream = true;
    try { _git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']); }
    catch { hasUpstream = false; }
    const args = hasUpstream ? ['push'] : ['push', '-u', 'origin', currentBranch(cwd)];
    const { stdout, stderr } = await _gitAsync(cwd, args, 2 * 60 * 1000);
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (e) {
    return { ok: false, error: _errMsg(e) };
  }
}

function aheadBehind(cwd) {
  try { _git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']); }
  catch { return { ahead: 0, behind: 0, noUpstream: true }; }
  try {
    const out = _git(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']).trim();
    const [ahead, behind] = out.split(/\s+/).map(n => parseInt(n, 10) || 0);
    return { ahead, behind, noUpstream: false };
  } catch { return { ahead: 0, behind: 0, noUpstream: true }; }
}

// ── Stash ──────────────────────────────────────────────────────────────

function stashList(cwd) {
  try {
    const out = _git(cwd, ['stash', 'list', '--format=%gd%x00%s%x00%cr']).trim();
    if (!out) return [];
    return out.split('\n').map((line, i) => {
      const [ref, subject, date] = line.split('\x00');
      return { index: i, ref: ref || `stash@{${i}}`, subject: subject || '', date: date || '' };
    });
  } catch { return []; }
}

function stashSave(cwd, message, includeUntracked) {
  const args = ['stash', 'push'];
  if (includeUntracked) args.push('-u');
  if (message && message.trim()) args.push('-m', message.trim());
  _git(cwd, args, { env: NO_PROMPT_ENV });
  return { ok: true };
}

function stashApply(cwd, index) {
  try { _git(cwd, ['stash', 'apply', `stash@{${index}}`], { env: NO_PROMPT_ENV }); return { ok: true }; }
  catch (e) { return { ok: false, error: _errMsg(e), conflict: _hasConflicts(cwd) }; }
}

function stashPop(cwd, index) {
  try { _git(cwd, ['stash', 'pop', `stash@{${index}}`], { env: NO_PROMPT_ENV }); return { ok: true }; }
  catch (e) { return { ok: false, error: _errMsg(e), conflict: _hasConflicts(cwd) }; }
}

function stashDrop(cwd, index) {
  _git(cwd, ['stash', 'drop', `stash@{${index}}`]);
  return { ok: true };
}

// ── Merge ──────────────────────────────────────────────────────────────

function merge(cwd, branch) {
  try {
    const out = _git(cwd, ['merge', branch], { env: NO_PROMPT_ENV });
    return { ok: true, output: out.trim() };
  } catch (e) {
    return { ok: false, error: _errMsg(e), conflict: _hasConflicts(cwd) };
  }
}

function mergeAbort(cwd) {
  _git(cwd, ['merge', '--abort'], { env: NO_PROMPT_ENV });
  return { ok: true };
}

function mergeStatus(cwd) {
  const gd = _gitDirAbs(cwd);
  if (!gd) return { inProgress: false };
  return { inProgress: fs.existsSync(path.join(gd, 'MERGE_HEAD')) };
}

// ── Rebase ─────────────────────────────────────────────────────────────

function rebase(cwd, branch) {
  try {
    const out = _git(cwd, ['rebase', branch], { env: NO_PROMPT_ENV });
    return { ok: true, output: out.trim() };
  } catch (e) {
    return { ok: false, error: _errMsg(e), conflict: _hasConflicts(cwd) || rebaseStatus(cwd).inProgress };
  }
}

function rebaseContinue(cwd) {
  try {
    const out = _git(cwd, ['rebase', '--continue'], { env: NO_PROMPT_ENV });
    return { ok: true, output: out.trim() };
  } catch (e) {
    return { ok: false, error: _errMsg(e), conflict: _hasConflicts(cwd) || rebaseStatus(cwd).inProgress };
  }
}

function rebaseAbort(cwd) {
  _git(cwd, ['rebase', '--abort'], { env: NO_PROMPT_ENV });
  return { ok: true };
}

function rebaseStatus(cwd) {
  const gd = _gitDirAbs(cwd);
  if (!gd) return { inProgress: false };
  const inProgress = fs.existsSync(path.join(gd, 'rebase-merge')) || fs.existsSync(path.join(gd, 'rebase-apply'));
  return { inProgress };
}

module.exports = {
  isRepo, repoRoot, currentBranch, branches, status, log, diff, stage, unstage, revert, commit, checkout, createBranch, cloneRepo, initAndLink, addSubmodule, listSubmodules,
  remotes, fetch, pull, push, aheadBehind,
  stashList, stashSave, stashApply, stashPop, stashDrop,
  merge, mergeAbort, mergeStatus,
  rebase, rebaseContinue, rebaseAbort, rebaseStatus
};
