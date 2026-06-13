/* Git panel — VS Code-style git operations for the current directory */
const Git = (() => {
  const panel = document.getElementById('git-panel');
  let _cwd       = null;  // The folder the user is in (informational)
  let _root      = null;  // Root the panel currently operates against (main repo OR a submodule)
  let _mainRoot  = null;  // Top-level repo root, used to populate the submodule dropdown
  let _submodules = [];   // [{ path, relPath, name, sha }, ...]

  const STATUS_COLOR = { M: '#e2a44f', A: '#5cb85c', D: '#e05252', R: '#7c6ef5', '?': '#5cb85c', C: '#5cb85c', U: '#e05252' };
  const STATUS_LABEL = { M: 'M', A: 'A', D: 'D', R: 'R', '?': 'C', C: 'C', U: 'U' };

  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _fmtHash(h) { return `<span class="git-hash">${_esc(h)}</span>`; }

  async function refresh(dirPath, opts = {}) {
    if (!dirPath) { _showEmpty('Navigate to a folder to see git status.'); return; }
    if (!opts.keepMainRoot) _cwd = dirPath;

    let repoInfo;
    try { repoInfo = await WS.send('git:is-repo', { cwd: dirPath }); } catch { _showError('Git not available.'); return; }
    if (!repoInfo.isRepo) { _showNotRepo(dirPath); return; }
    _root = repoInfo.root || dirPath;
    if (!opts.keepMainRoot) {
      // First-time enter (or normal nav): treat this as the main repo and discover its submodules
      _mainRoot = _root;
      try {
        const subs = await WS.send('git:submodules', { cwd: _mainRoot });
        _submodules = subs.items || [];
      } catch { _submodules = []; }
    }

    panel.innerHTML = '<div class="git-loading">Loading…</div>';
    try {
      const [branchRes, statusRes, logRes, aheadBehind, mergeStatus, rebaseStatus, stashRes] = await Promise.all([
        WS.send('git:branches',      { cwd: _root }),
        WS.send('git:status',        { cwd: _root }),
        WS.send('git:log',           { cwd: _root, n: 5 }),
        WS.send('git:ahead-behind',  { cwd: _root }),
        WS.send('git:merge-status',  { cwd: _root }),
        WS.send('git:rebase-status', { cwd: _root }),
        WS.send('git:stash-list',    { cwd: _root })
      ]);
      _render(branchRes, statusRes, logRes.commits || [], aheadBehind, mergeStatus, rebaseStatus, stashRes.items || []);
    } catch (e) { _showError(e.message); }
  }

  // Run a fetch/pull/push sync operation, showing busy/error state in `statusEl`
  async function _runSync(action, label, statusEl) {
    const buttons = panel.querySelectorAll('.git-sync-btn');
    buttons.forEach(b => b.disabled = true);
    statusEl.textContent = `${label}…`;
    statusEl.className = 'git-sync-status';
    try {
      const res = await WS.send(`git:${action}`, { cwd: _root });
      if (res && res.ok === false) {
        statusEl.textContent = (res.error || 'Failed').split('\n')[0];
        statusEl.className = 'git-sync-status err';
        buttons.forEach(b => b.disabled = false);
        return;
      }
      refresh(_cwd);
    } catch (e) {
      statusEl.textContent = (e.message || 'Failed').split('\n')[0];
      statusEl.className = 'git-sync-status err';
      buttons.forEach(b => b.disabled = false);
    }
  }

  // Swap the panel to operate against a submodule (or back to the main repo if path === _mainRoot)
  function _switchRoot(newRoot) {
    if (!newRoot || newRoot === _root) return;
    refresh(newRoot, { keepMainRoot: true });
  }

  function _showEmpty(msg) {
    panel.innerHTML = `<p class="git-empty">${_esc(msg)}</p>`;
  }
  function _showError(msg) {
    panel.innerHTML = `<p class="git-empty git-error">${_esc(msg)}</p>`;
  }

  function _showNotRepo(dirPath) {
    panel.innerHTML = `
      <p class="git-empty">Not a git repository.</p>
      <div class="git-clone-form">
        <div class="git-clone-label">Remote repository URL</div>
        <input type="text" id="git-clone-url" placeholder="https://github.com/user/repo.git" spellcheck="false" autocomplete="off">
        <div class="git-clone-actions">
          <button id="git-clone-btn" class="git-commit-btn" title="Clone the repo into this folder (folder must be empty)">⬇ Clone repo here</button>
          <button id="git-link-btn"  class="git-commit-btn secondary" title="Run git init in this folder and set origin to the URL above">🔗 Init &amp; link</button>
        </div>
        <p class="git-clone-hint">
          <b>Clone repo here</b> — pulls the remote repo into this folder. Folder must be empty.<br>
          <b>Init &amp; link</b> — runs <code>git init</code> + <code>git remote add origin &lt;url&gt;</code>. Use when the folder already has files you want to push.
        </p>
        <p id="git-clone-status" class="git-clone-status"></p>
      </div>`;

    const input    = panel.querySelector('#git-clone-url');
    const cloneBtn = panel.querySelector('#git-clone-btn');
    const linkBtn  = panel.querySelector('#git-link-btn');
    const status   = panel.querySelector('#git-clone-status');

    const setBusy = (busy) => {
      cloneBtn.disabled = busy; linkBtn.disabled = busy; input.disabled = busy;
    };

    const run = async (op, label) => {
      const url = input.value.trim();
      if (!url) { input.focus(); return; }
      setBusy(true);
      status.textContent = `${label}…`;
      status.className = 'git-clone-status';
      try {
        await WS.send(op, { cwd: dirPath, url });
        status.textContent = 'Done. Refreshing…';
        status.className = 'git-clone-status ok';
        try { await Explorer.refresh(); } catch {}
        refresh(dirPath);
      } catch (e) {
        status.textContent = (e.message || 'Failed').split('\n')[0];
        status.className = 'git-clone-status err';
        setBusy(false);
      }
    };

    cloneBtn.addEventListener('click', () => run('git:clone',     'Cloning repo (can take a minute for large repos)'));
    linkBtn .addEventListener('click', () => run('git:init-link', 'Initialising & linking'));
    // Enter defaults to clone (most common case)
    input.addEventListener('keydown', e => { if (e.key === 'Enter') cloneBtn.click(); });
  }

  function _render(branchRes, statusRes, commits, aheadBehind, mergeStatus, rebaseStatus, stashItems) {
    panel.innerHTML = '';

    // ── Repo selector (only when there are submodules) ──
    if (_submodules.length) {
      const repoBar = document.createElement('div');
      repoBar.className = 'git-repo-bar';
      const label = document.createElement('span');
      label.className = 'git-repo-label';
      label.textContent = 'Repo:';
      const sel = document.createElement('select');
      sel.className = 'git-repo-select';
      const optMain = document.createElement('option');
      optMain.value = _mainRoot;
      optMain.textContent = '⊕ Main repo';
      if (_root === _mainRoot) optMain.selected = true;
      sel.appendChild(optMain);
      _submodules.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.path;
        opt.textContent = '↳ ' + s.relPath;
        if (s.path === _root) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => _switchRoot(sel.value));
      repoBar.appendChild(label);
      repoBar.appendChild(sel);
      panel.appendChild(repoBar);
    }

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

    // ── Merge / Rebase ──
    const currentBranchName = (branchRes.branches || []).find(b => b.current)?.name || '';
    const otherBranches = (branchRes.branches || []).filter(b => !b.current);
    if (otherBranches.length) {
      const opBar = document.createElement('div');
      opBar.className = 'git-branch-bar git-op-bar';

      const branchOptionsHtml = otherBranches.map(b => `<option value="${_esc(b.name)}">${_esc(b.name)}</option>`).join('');

      const mergeSel = document.createElement('select');
      mergeSel.className = 'git-branch-select git-op-select';
      mergeSel.title = 'Merge a branch into the current branch';
      mergeSel.innerHTML = `<option value="">⇄ Merge…</option>${branchOptionsHtml}`;
      mergeSel.addEventListener('change', async () => {
        const branch = mergeSel.value; mergeSel.value = '';
        if (!branch) return;
        if (!confirm(`Merge '${branch}' into '${currentBranchName}'?`)) return;
        try {
          const res = await WS.send('git:merge', { cwd: _root, branch });
          if (!res.ok) alert((res.conflict ? 'Merge has conflicts — resolve them, then commit.\n\n' : 'Merge failed.\n\n') + (res.error || ''));
        } catch (e) { alert('Merge failed: ' + e.message); }
        refresh(_cwd);
      });

      const rebaseSel = document.createElement('select');
      rebaseSel.className = 'git-branch-select git-op-select';
      rebaseSel.title = 'Rebase the current branch onto another branch';
      rebaseSel.innerHTML = `<option value="">⤴ Rebase…</option>${branchOptionsHtml}`;
      rebaseSel.addEventListener('change', async () => {
        const branch = rebaseSel.value; rebaseSel.value = '';
        if (!branch) return;
        if (!confirm(`Rebase '${currentBranchName}' onto '${branch}'? This rewrites local history.`)) return;
        try {
          const res = await WS.send('git:rebase', { cwd: _root, branch });
          if (!res.ok) alert((res.conflict ? 'Rebase has conflicts — resolve them, then Continue or Abort below.\n\n' : 'Rebase failed.\n\n') + (res.error || ''));
        } catch (e) { alert('Rebase failed: ' + e.message); }
        refresh(_cwd);
      });

      opBar.appendChild(mergeSel);
      opBar.appendChild(rebaseSel);
      panel.appendChild(opBar);
    }

    // ── Sync bar (fetch / pull / push) ──
    const syncBar = document.createElement('div');
    syncBar.className = 'git-sync-bar';

    const fetchBtn = document.createElement('button');
    fetchBtn.className = 'git-sync-btn';
    fetchBtn.title = 'Fetch from remote';
    fetchBtn.textContent = '⤓ Fetch';

    const pullBtn = document.createElement('button');
    pullBtn.className = 'git-sync-btn';
    pullBtn.title = 'Pull from remote';
    pullBtn.textContent = '⇣ Pull';

    const pushBtn = document.createElement('button');
    pushBtn.className = 'git-sync-btn';
    pushBtn.title = 'Push to remote';
    pushBtn.textContent = '⇡ Push';

    const syncStatus = document.createElement('span');
    syncStatus.className = 'git-sync-status';

    fetchBtn.addEventListener('click', () => _runSync('fetch', 'Fetching', syncStatus));
    pullBtn.addEventListener('click',  () => _runSync('pull',  'Pulling',  syncStatus));
    pushBtn.addEventListener('click',  () => _runSync('push',  'Pushing',  syncStatus));

    syncBar.appendChild(fetchBtn);
    syncBar.appendChild(pullBtn);
    syncBar.appendChild(pushBtn);

    if (aheadBehind && !aheadBehind.noUpstream && (aheadBehind.ahead || aheadBehind.behind)) {
      const badge = document.createElement('span');
      badge.className = 'git-ahead-behind';
      if (aheadBehind.behind) badge.innerHTML += `<span class="git-behind" title="${aheadBehind.behind} commit(s) behind upstream">↓${aheadBehind.behind}</span>`;
      if (aheadBehind.ahead)  badge.innerHTML += `<span class="git-ahead"  title="${aheadBehind.ahead} commit(s) ahead of upstream">↑${aheadBehind.ahead}</span>`;
      syncBar.appendChild(badge);
    }

    syncBar.appendChild(syncStatus);
    panel.appendChild(syncBar);

    // ── Merge / rebase in-progress banner ──
    if (mergeStatus?.inProgress || rebaseStatus?.inProgress) {
      const isRebase = !!rebaseStatus?.inProgress;
      const banner = document.createElement('div');
      banner.className = 'git-conflict-banner';

      const text = document.createElement('span');
      text.className = 'git-conflict-text';
      text.textContent = isRebase
        ? '⚠ Rebase in progress — resolve conflicts, then Continue or Abort.'
        : '⚠ Merge in progress — resolve conflicts, then commit, or Abort.';

      const actions = document.createElement('span');
      actions.className = 'git-conflict-actions';

      if (isRebase) {
        const contBtn = document.createElement('button');
        contBtn.className = 'git-commit-btn secondary';
        contBtn.textContent = 'Continue';
        contBtn.addEventListener('click', async () => {
          try {
            const res = await WS.send('git:rebase-continue', { cwd: _root });
            if (!res.ok) alert((res.conflict ? 'Still conflicted.\n\n' : 'Failed.\n\n') + (res.error || ''));
          } catch (e) { alert('Failed: ' + e.message); }
          refresh(_cwd);
        });
        actions.appendChild(contBtn);
      }

      const abortBtn = document.createElement('button');
      abortBtn.className = 'git-commit-btn secondary git-conflict-abort';
      abortBtn.textContent = 'Abort';
      abortBtn.addEventListener('click', async () => {
        if (!confirm(`Abort the ${isRebase ? 'rebase' : 'merge'}?`)) return;
        try { await WS.send(isRebase ? 'git:rebase-abort' : 'git:merge-abort', { cwd: _root }); }
        catch (e) { alert('Failed: ' + e.message); }
        refresh(_cwd);
      });
      actions.appendChild(abortBtn);

      banner.appendChild(text);
      banner.appendChild(actions);
      panel.appendChild(banner);
    }

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

    // ── Stash (collapsible) ──
    panel.appendChild(_makeStashSection(stashItems));

    // ── Add submodule (collapsible) ──
    panel.appendChild(_makeSubmoduleSection());
  }

  function _makeStashSection(stashItems) {
    const section = document.createElement('div');
    section.className = 'git-section';

    const header = document.createElement('div');
    header.className = 'git-section-header';
    let collapsed = stashItems.length === 0;
    header.innerHTML = `<span class="git-section-arrow">${collapsed ? '▸' : '▾'}</span> Stash <span class="git-section-count">${stashItems.length}</span>`;

    const body = document.createElement('div');
    body.className = 'git-section-body';
    body.style.display = collapsed ? 'none' : '';

    header.addEventListener('click', () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : '';
      header.querySelector('.git-section-arrow').textContent = collapsed ? '▸' : '▾';
    });

    stashItems.forEach(s => {
      const row = document.createElement('div');
      row.className = 'git-stash-row';
      row.innerHTML = `
        <span class="git-stash-info" title="${_esc(s.ref)}">${_esc(s.subject || s.ref)}</span>
        <span class="git-stash-date">${_esc(s.date)}</span>
        <span class="git-stash-actions"></span>`;
      const actions = row.querySelector('.git-stash-actions');

      const applyBtn = document.createElement('button');
      applyBtn.className = 'git-icon-btn';
      applyBtn.title = 'Apply (keep stash)';
      applyBtn.innerHTML = '⇪';
      applyBtn.addEventListener('click', async () => {
        const res = await WS.send('git:stash-apply', { cwd: _root, index: s.index });
        if (!res.ok) alert((res.conflict ? 'Apply has conflicts — resolve them manually.\n\n' : 'Apply failed.\n\n') + (res.error || ''));
        refresh(_cwd);
      });

      const popBtn = document.createElement('button');
      popBtn.className = 'git-icon-btn';
      popBtn.title = 'Pop (apply and drop)';
      popBtn.innerHTML = '⤴';
      popBtn.addEventListener('click', async () => {
        const res = await WS.send('git:stash-pop', { cwd: _root, index: s.index });
        if (!res.ok) alert((res.conflict ? 'Pop has conflicts — resolve them manually.\n\n' : 'Pop failed.\n\n') + (res.error || ''));
        refresh(_cwd);
      });

      const dropBtn = document.createElement('button');
      dropBtn.className = 'git-icon-btn git-icon-danger';
      dropBtn.title = 'Drop (discard)';
      dropBtn.innerHTML = '✕';
      dropBtn.addEventListener('click', async () => {
        if (!confirm(`Drop stash "${s.subject || s.ref}"?`)) return;
        try { await WS.send('git:stash-drop', { cwd: _root, index: s.index }); }
        catch (e) { alert('Drop failed: ' + e.message); }
        refresh(_cwd);
      });

      actions.appendChild(applyBtn);
      actions.appendChild(popBtn);
      actions.appendChild(dropBtn);
      body.appendChild(row);
    });

    // New-stash form
    const form = document.createElement('div');
    form.className = 'git-stash-form';
    form.innerHTML = `
      <input type="text" class="git-stash-msg" placeholder="Stash message (optional)" spellcheck="false" autocomplete="off">
      <label class="git-stash-untracked"><input type="checkbox"> Include untracked</label>
      <button class="git-commit-btn secondary">📦 Stash changes</button>`;
    const msgEl       = form.querySelector('.git-stash-msg');
    const untrackedEl = form.querySelector('input[type=checkbox]');
    const stashBtn    = form.querySelector('button');
    stashBtn.addEventListener('click', async () => {
      try {
        await WS.send('git:stash-save', { cwd: _root, message: msgEl.value.trim(), includeUntracked: untrackedEl.checked });
        refresh(_cwd);
      } catch (e) { alert('Stash failed: ' + e.message); }
    });
    body.appendChild(form);

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  function _makeSubmoduleSection() {
    const section = document.createElement('div');
    section.className = 'git-section';

    const header = document.createElement('div');
    header.className = 'git-section-header';
    header.innerHTML = '<span class="git-section-arrow">▸</span> Add submodule';
    let collapsed = true;

    const body = document.createElement('div');
    body.className = 'git-section-body';
    body.style.display = 'none';
    body.innerHTML = `
      <div class="git-clone-form" style="border-top:none;padding:.5rem .8rem">
        <input type="text" id="git-sub-url"  placeholder="https://github.com/user/repo.git" spellcheck="false" autocomplete="off">
        <input type="text" id="git-sub-path" placeholder="Optional path (defaults to repo name)" spellcheck="false" autocomplete="off">
        <button id="git-sub-btn" class="git-commit-btn">📦 Clone as submodule</button>
        <p class="git-clone-hint">Runs <code>git submodule add &lt;url&gt; [path]</code>. The submodule is added at the repo root.</p>
        <p id="git-sub-status" class="git-clone-status"></p>
      </div>`;

    header.addEventListener('click', () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : '';
      header.querySelector('.git-section-arrow').textContent = collapsed ? '▸' : '▾';
    });

    section.appendChild(header);
    section.appendChild(body);

    // Wire form (lazy — happens once)
    queueMicrotask(() => {
      const urlEl    = body.querySelector('#git-sub-url');
      const pathEl   = body.querySelector('#git-sub-path');
      const btn      = body.querySelector('#git-sub-btn');
      const statusEl = body.querySelector('#git-sub-status');
      const submit = async () => {
        const url = urlEl.value.trim();
        if (!url) { urlEl.focus(); return; }
        const subPath = pathEl.value.trim() || null;
        btn.disabled = true; urlEl.disabled = true; pathEl.disabled = true;
        statusEl.textContent = 'Cloning submodule (can take a minute for large repos)…';
        statusEl.className = 'git-clone-status';
        try {
          await WS.send('git:submodule-add', { cwd: _root, url, path: subPath });
          statusEl.textContent = 'Submodule added. Refreshing…';
          statusEl.className = 'git-clone-status ok';
          try { await Explorer.refresh(); } catch {}
          refresh(_cwd);
        } catch (e) {
          statusEl.textContent = (e.message || 'Failed').split('\n')[0];
          statusEl.className = 'git-clone-status err';
          btn.disabled = false; urlEl.disabled = false; pathEl.disabled = false;
        }
      };
      btn.addEventListener('click', submit);
      urlEl.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
      pathEl.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    });

    return section;
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
