/* Left-panel folder tree — lazy-loads children on expand, tracks path for expandTo */
const Tree = (() => {
  const panel   = document.getElementById('tree-panel');
  const nodeMap = new Map(); // path → { expand, collapse, isOpen }

  const expandedPaths = new Set();

  let _saveTimer;
  function _saveExpanded() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      State.set('treeExpanded', Array.from(expandedPaths));
    }, 800);
  }

  async function init() {
    panel.innerHTML = '<p style="padding:.5rem .75rem;font-size:.8rem;color:var(--text-muted)">Loading…</p>';
    try {
      const roots = await WS.send('fs:roots', {});
      panel.innerHTML = '';
      roots.forEach(r => panel.appendChild(makeNode(r.path, r.name)));

      // Restore previously expanded paths
      const saved = State.get('treeExpanded', []);
      for (const p of saved) {
        await expandTo(p);
      }
    } catch (e) {
      panel.innerHTML = `<p style="padding:.5rem .75rem;font-size:.8rem;color:var(--danger)">${e.message}</p>`;
    }
  }

  function makeNode(path, name) {
    const wrapper = document.createElement('div');

    const node = document.createElement('div');
    node.className = 'tree-node';
    node.dataset.path = path;

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = '▶';

    const tag = explorerTagMap?.get(path);
    const colorStyle = tag?.color ? `style="color:${tag.color}"` : '';

    const label = document.createElement('span');
    label.className = 'tree-label';
    const icon = Drives.icon(path, true) || '📁';
    label.innerHTML = `<span class="tree-icon" ${colorStyle}>${icon}</span> ` + name;

    node.append(toggle, label);
    wrapper.appendChild(node);

    let open = false;
    let childrenEl = null;

    async function expand() {
      if (open) return;
      open = true;
      toggle.textContent = '▼';
      childrenEl = document.createElement('div');
      childrenEl.className = 'tree-children';
      wrapper.appendChild(childrenEl);

      try {
        const items = await WS.send('fs:list', { path });
        const dirs  = items.filter(i => i.isDir);
        if (dirs.length === 0) {
          // Leaf folder — hide arrow, reset
          toggle.style.display = 'none';
          open = false;
          childrenEl.remove();
          childrenEl = null;
        } else {
          dirs.forEach(d => childrenEl.appendChild(makeNode(d.path, d.name)));
          expandedPaths.add(path);
          _saveExpanded();
        }
      } catch { childrenEl.innerHTML = ''; }
    }

    function collapse() {
      if (!open) return;
      open = false;
      toggle.textContent = '▶';
      toggle.style.display = '';
      if (childrenEl) { childrenEl.remove(); childrenEl = null; }
      expandedPaths.delete(path);
      _saveExpanded();
    }

    toggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!open) await expand();
      else collapse();
    });

    label.addEventListener('click', async (e) => {
      e.stopPropagation();
      setSelected(path);
      Explorer.navigateFocused(path);
      if (!open) await expand();
    });

    // Middle-click / Ctrl+click / triple-tap → open this folder in a new tab
    Tabs.attachOpenInNewTab(label, () => ({ name, path, isDir: true }));

    label.addEventListener('contextmenu', (e) => {
      e.stopPropagation();
      e.preventDefault();
      Explorer.showContextMenu(e.clientX, e.clientY, {
        path, name, isDir: true, ext: null, size: 0, mtime: 0, ctime: 0
      });
    });

    nodeMap.set(path, { expand, collapse, get isOpen() { return open; } });

    return wrapper;
  }

  function setSelected(path) {
    panel.querySelectorAll('.tree-node').forEach(n => {
      n.classList.toggle('selected', n.dataset.path === path);
    });
  }

  function updateTags(tagMap) {
    explorerTagMap = tagMap;
    panel.querySelectorAll('.tree-node').forEach(node => {
      const path = node.dataset.path;
      const tag = tagMap.get(path);
      const icon = node.querySelector('.tree-icon');
      if (icon) {
        icon.style.color = tag?.color || '';
      }
    });
  }

  let explorerTagMap = null;

  async function expandTo(path) {
    if (!path) return;
    const ancestors = getAncestorPaths(path);

    for (const ap of ancestors) {
      const nd = nodeMap.get(ap);
      if (nd && !nd.isOpen) {
        await nd.expand();
        await new Promise(r => setTimeout(r, 30));
      }
    }

    setSelected(path);
    const sel = panel.querySelector(`.tree-node[data-path="${CSS.escape(path)}"]`);
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function getAncestorPaths(p) {
    const norm  = p.replace(/\//g, '\\');
    const parts = norm.split('\\').filter(Boolean);
    const result = [];

    if (/^[A-Za-z]:$/.test(parts[0])) {
      let cur = parts[0] + '\\';
      result.push(cur);
      for (let i = 1; i < parts.length - 1; i++) {
        cur = cur.replace(/\\$/, '') + '\\' + parts[i];
        result.push(cur);
      }
    } else {
      result.push('/');
      for (let i = 0; i < parts.length - 1; i++) {
        result.push('/' + parts.slice(0, i + 1).join('/'));
      }
    }
    return result;
  }

  return { init, setSelected, expandTo };
})();
