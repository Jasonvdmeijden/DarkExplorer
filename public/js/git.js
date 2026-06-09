/* Git panel — VS Code-style git operations for the current directory */
const Git = (() => {
  const panel = document.getElementById('git-panel');
  let _cwd    = null;
  let _root   = null;

  const STATUS_COLOR = { M: '#e2a44f', A: '#5cb85c', D: '#e05252', R: '#7c6ef5', '?': '#5cb85c', C: '#5cb85c', U: '#e05252' };
  const STATUS_LABEL = { M: 'M', A: 'A', D: 'D', R: 'R', '?': 'C', C: 'C', U: 'U' };

  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _fmtHash(h) { return `<span class="git-hash">${_esc(h)}</span>`; }

  async function refresh(dirPath) {
    if (!dirPath) { _showEmpty('Navigate to a folder to see git status.'); return; }
    _cwd = dirPath;

    let repoInfo;
    try { repoInfo = await WS.send('git:is-repo', { cwd: dirPath }); } catch { _showError('Git not available.'); return; }
    if (!repoInfo.isRepo) { _showEmpty('Not a git repository.'); return; }
    _root = repoInfo.root || dirPath;

    panel.innerHTML = '<div class="git-loading">Loading…</div>';
    try {
      const [branchRes, statusRes, logRes] = await Promise.all([
        WS.send('git:branches',  { cwd: _root }),
        WS.send('git:status',    { cwd: _root }),
        WS.send('git:log',       { cwd: _root, n: 5 })
      ]);
      _render(branchRes, statusRes, logRes.commits || []);
    } catch (e) { _showError(e.message); }
  }

  function _showEmpty(msg) {
    panel.innerHTML = `<p class="git-empty">${_esc(msg)}</p>`;
  }
  function _showError(msg) {
    panel.innerHTML = `<p class="git-empty git-error">${_esc(msg)}</p>`;
  }

  function _render(branchRes, statusRes, commits) {
    panel.innerHTML = '';

    // ── Branch bar ──
    const branchBar = document.createElement('div');
    branchBar.className = 'git-branch-bar';

    const branchSel = document.createElement('select');
    branchSel.className = 'git-branch-select';
    (branchRes.branches || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.name;
      opt.textContent = b.name;
      if (b.current) opt.selected = true;
      branchSel.appendChild(opt);
    });
    branchSel.addEventListener('change', async () => {
      try { await WS.send('git:checkout', { cwd: _root, branch: branchSel.value }); refresh(_cwd); }
      catch (e) { alert('Checkout failed: ' + e.message); refresh(_cwd); }
    });

    const newBranchBtn = document.createElement('button');
    newBranchBtn.className = 'git-icon-btn';
    newBranchBtn.title = 'Create new branch';
    newBranchBtn.innerHTML = '⊕';
    newBranchBtn.addEventListener('click', async () => {
      const name = prompt('New branch name:');
      if (!name) return;
      try { await WS.send('git:create-branch', { cwd: _root, name }); refresh(_cwd); }
      catch (e) { alert('Failed: ' + e.message); refresh(_cwd); }
    });

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'git-icon-btn';
    refreshBtn.title = 'Refresh';
    refreshBtn.innerHTML = '↻';
    refreshBtn.addEventListener('click', () => refresh(_cwd));

    branchBar.appendChild(branchSel);
    branchBar.appendChild(newBranchBtn);
    branchBar.appendChild(refreshBtn);
    panel.appendChild(branchBar);

    // ── Commit area ──
    const commitArea = document.createElement('div');
    commitArea.className = 'git-commit-area';

    const msgInput = document.createElement('textarea');
    msgInput.className = 'git-commit-msg';
    msgInput.placeholder = 'Commit message…';
    msgInput.rows = 3;

    const commitBtn = document.createElement('button');
    commitBtn.className = 'git-commit-btn';
    commitBtn.textContent = `✓ Commit${statusRes.staged?.length ? ` (${statusRes.staged.length})` : ''}`;
    commitBtn.disabled = !statusRes.staged?.length;
    commitBtn.addEventListener('click', async () => {
      const msg = msgInput.value.trim();
      if (!msg) { msgInput.focus(); return; }
      try {
        await WS.send('git:commit', { cwd: _root, message: msg });
        msgInput.value = '';
        refresh(_cwd);
      } catch (e) { alert('Commit failed: ' + e.message); }
    });

    commitArea.appendChild(msgInput);
    commitArea.appendChild(commitBtn);
    panel.appendChild(commitArea);

    // ── Staged changes ──
    if (statusRes.staged?.length) {
      panel.appendChild(_makeSection('Staged Changes', statusRes.staged, true));
    }

    // ── Unstaged / untracked changes ──
    if (statusRes.changes?.length) {
      panel.appendChild(_makeSection('Changes', statusRes.changes, false));
    }

    if (!statusRes.staged?.length && !statusRes.changes?.length) {
      const clean = document.createElement('div');
      clean.className = 'git-clean';
      clean.textContent = '✓ No changes';
      panel.appendChild(clean);
    }

    // ── Recent commits ──
    if (commits.length) {
      panel.appendChild(_makeCommitLog(commits));
    }
  }

  function _makeSection(title, fileList, staged) {
    const section = document.createElement('div');
    section.className = 'git-section';

    const header = document.createElement('div');
    header.className = 'git-section-header';
    let collapsed = false;
    header.innerHTML = `<span class="git-section-arrow">▾</span> ${_esc(title)} <span class="git-section-count">${fileList.length}</span>`;

    const stageAllBtn = document.createElement('button');
    stageAllBtn.className = 'git-icon-btn';
    stageAllBtn.title = staged ? 'Unstage all' : 'Stage all';
    stageAllBtn.innerHTML = staged ? '−' : '+';
    stageAllBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const paths = fileList.map(f => f.path);
      try {
        if (staged) await WS.send('git:unstage', { cwd: _root, files: paths });
        else        await WS.send('git:stage',   { cwd: _root, files: paths });
        refresh(_cwd);
      } catch (e2) { alert(e2.message); }
    });
    header.appendChild(stageAllBtn);

    const body = document.createElement('div');
    body.className = 'git-section-body';

    header.addEventListener('click', (e) => {
      if (e.target === stageAllBtn) return;
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : '';
      header.querySelector('.git-section-arrow').textContent = collapsed ? '▸' : '▾';
    });

    fileList.forEach(f => {
      const row = document.createElement('div');
      row.className = 'git-file-row';
      const color = STATUS_COLOR[f.code] || '#888';
      const label = STATUS_LABEL[f.code] || f.code;
      row.innerHTML = `
        <span class="git-file-status" style="color:${color}">${label}</span>
        <span class="git-file-name" title="${_esc(f.path)}">${_esc(f.path)}</span>
        <span class="git-file-actions"></span>`;

      const actionsEl = row.querySelector('.git-file-actions');

      // Stage / Unstage button
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'git-icon-btn';
      toggleBtn.title = staged ? 'Unstage' : 'Stage';
      toggleBtn.innerHTML = staged ? '−' : '+';
      toggleBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          if (staged) await WS.send('git:unstage', { cwd: _root, files: [f.path] });
          else        await WS.send('git:stage',   { cwd: _root, files: [f.path] });
          refresh(_cwd);
        } catch (e2) { alert(e2.message); }
      });
      actionsEl.appendChild(toggleBtn);

      // Revert button (not for untracked)
      if (f.code !== '?') {
        const revertBtn = document.createElement('button');
        revertBtn.className = 'git-icon-btn git-icon-danger';
        revertBtn.title = 'Discard changes';
        revertBtn.innerHTML = '↩';
        revertBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`Discard changes to "${f.path}"?`)) return;
          try {
            if (staged) await WS.send('git:unstage', { cwd: _root, files: [f.path] });
            await WS.send('git:revert', { cwd: _root, files: [f.path] });
            refresh(_cwd);
          } catch (e2) { alert(e2.message); }
        });
        actionsEl.appendChild(revertBtn);
      }

      // Click row to view diff
      row.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        _showDiff(f.path, staged);
      });

      body.appendChild(row);
    });

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  function _makeCommitLog(commits) {
    const section = document.createElement('div');
    section.className = 'git-section';

    const header = document.createElement('div');
    header.className = 'git-section-header';
    header.innerHTML = '<span class="git-section-arrow">▾</span> Recent Commits';
    let collapsed = false;
    header.addEventListener('click', () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : '';
      header.querySelector('.git-section-arrow').textContent = collapsed ? '▸' : '▾';
    });

    const body = document.createElement('div');
    body.className = 'git-section-body';

    commits.forEach(c => {
      const entry = document.createElement('div');
      entry.className = 'git-log-entry';
      entry.innerHTML = `
        <div class="git-log-top">${_fmtHash(c.hash)} <span class="git-log-subject">${_esc(c.subject)}</span></div>
        <div class="git-log-meta">${_esc(c.author)} · ${_esc(c.date)}</div>`;
      body.appendChild(entry);
    });

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  async function _showDiff(filePath, staged) {
    try {
      const res = await WS.send('git:diff', { cwd: _root, file: filePath, staged });
      Preview.showDiff(filePath, res.diff || '(No diff available)');
    } catch (e) { alert('Could not load diff: ' + e.message); }
  }

  // Called by panels.js when Git tab is clicked
  function activate() {
    const currentPath = Explorer.getCurrentPath();
    refresh(currentPath);
  }

  return { refresh, activate };
})();
