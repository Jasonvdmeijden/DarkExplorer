/* Favourites — flat list of the top-10 most-accessed folders */
const Favourites = (() => {
  const panel = document.getElementById('favourites-panel');
  let counts = JSON.parse(localStorage.getItem('de_fav_counts') || '{}');

  function logAccess(path) {
    if (!path) return;
    counts[path] = (counts[path] || 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 50) {
      counts = Object.fromEntries(sorted.slice(0, 50));
    }
    localStorage.setItem('de_fav_counts', JSON.stringify(counts));
    // Deliberately no re-render — items would shuffle under the user's finger.
    // The new ordering is picked up the next time the panel is opened.
  }

  async function render() {
    panel.innerHTML = '';

    // Stat ALL tracked paths so we can drop any that no longer exist.
    // counts may grow well past 10; we sort + slice the survivors afterwards.
    const allPaths = Object.keys(counts);
    if (allPaths.length === 0) {
      panel.innerHTML = '<div style="padding:1rem;color:var(--text-muted);font-size:.8rem">No frequent folders yet.</div>';
      return;
    }
    const stats = await Promise.all(allPaths.map(async (p) => {
      try { return await WS.send('fs:stat', { path: p }); }
      catch { return null; }
    }));

    // Prune dead entries from counts (file/folder no longer exists)
    let pruned = 0;
    allPaths.forEach((p, i) => { if (stats[i] === null) { delete counts[p]; pruned++; } });
    if (pruned) {
      localStorage.setItem('de_fav_counts', JSON.stringify(counts));
      console.log(`[favourites] pruned ${pruned} dead entries`);
    }

    // Build a path → stat map for the survivors, then render the top 10
    const statByPath = new Map();
    allPaths.forEach((p, i) => { if (stats[i] !== null) statByPath.set(p, stats[i]); });

    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (sorted.length === 0) {
      panel.innerHTML = '<div style="padding:1rem;color:var(--text-muted);font-size:.8rem">No frequent folders yet.</div>';
      return;
    }

    sorted.forEach(([path]) => {
      const stat   = statByPath.get(path);
      const name   = path.split(/[\\/]/).pop() || path;
      const isDir  = stat ? !!stat.isDir : true;
      panel.appendChild(makeRow(path, name, isDir, stat));
    });
  }

  function makeRow(path, name, isDir, item) {
    const row = document.createElement('div');
    row.className = 'tree-node';
    row.style.cursor = 'pointer';
    row.dataset.path = path;
    const icon = isDir ? (Drives.icon(path, true) || '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-.15em"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>') : '📄';
    row.innerHTML = `<span class="tree-icon">${icon}</span> <span class="tree-label">${name}</span>`;
    row.title = path;
    // Middle-click / triple-tap → open folder in a new tab (folders only)
    if (isDir) Tabs.attachOpenInNewTab(row, () => ({ name, path, isDir: true }));

    row.addEventListener('click', async () => {
      if (isDir) {
        Explorer.navigateFocused(path);
      } else {
        // File: navigate to its parent folder, then open the file in preview
        const parent = path.replace(/[\\/][^\\/]+$/, '');
        try {
          await Explorer.navigate(parent || path);
          const siblings = await WS.send('fs:list', { path: parent });
          const file = (Array.isArray(siblings) ? siblings.find(s => s.path === path) : null) || item || { name, path, isDir: false };
          Preview.open(file, Array.isArray(siblings) ? siblings : [file]);
        } catch {
          Preview.open(item || { name, path, isDir: false }, [item || { name, path, isDir: false }]);
        }
      }
    });
    return row;
  }

  return { logAccess, render };
})();
