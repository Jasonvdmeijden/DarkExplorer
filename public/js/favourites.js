/* Favourites — tracks top 10 most accessed folders with tree-like expansion */
const Favourites = (() => {
  const panel = document.getElementById('favourites-panel');
  let counts = JSON.parse(localStorage.getItem('de_fav_counts') || '{}');
  const nodeMap = new Map(); // path -> { element, open }

  function logAccess(path) {
    if (!path) return;
    counts[path] = (counts[path] || 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 50) {
      counts = Object.fromEntries(sorted.slice(0, 50));
    }
    localStorage.setItem('de_fav_counts', JSON.stringify(counts));
    if (panel.style.display !== 'none') render();
  }

  async function render() {
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    panel.innerHTML = '';
    if (sorted.length === 0) {
      panel.innerHTML = '<div style="padding:1rem;color:var(--text-muted);font-size:.8rem">No frequent folders yet.</div>';
      return;
    }

    for (const [path, count] of sorted) {
      const name = path.split(/[\\/]/).pop() || path;
      const node = await makeNode(path, name, 0);
      panel.appendChild(node);
    }
  }

  async function makeNode(path, name, depth) {
    const wrapper = document.createElement('div');
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.dataset.path = path;
    node.style.paddingLeft = (depth * 12 + 6) + 'px';

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = '▶';

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.innerHTML = `<span class="tree-icon">📁</span> ` + name;

    node.append(toggle, label);
    wrapper.appendChild(node);

    let open = false;
    let childrenLoaded = false;
    const childContainer = document.createElement('div');
    childContainer.style.display = 'none';
    wrapper.appendChild(childContainer);

    const toggleNode = async (e) => {
      if (e) e.stopPropagation();
      open = !open;
      toggle.classList.toggle('expanded', open);
      childContainer.style.display = open ? 'block' : 'none';

      if (open && !childrenLoaded) {
        childrenLoaded = true;
        try {
          const items = await WS.send('fs:list', { path });
          const sorted = items.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
          for (const item of sorted) {
            if (item.isDir) {
              const childNode = await makeNode(item.path, item.name, depth + 1);
              childContainer.appendChild(childNode);
            } else {
              const fileEl = document.createElement('div');
              fileEl.className = 'tree-node';
              fileEl.style.paddingLeft = ((depth + 1) * 12 + 18) + 'px';
              fileEl.innerHTML = `<span class="tree-icon">📄</span> <span class="tree-label">${item.name}</span>`;
              fileEl.addEventListener('click', (ev) => {
                ev.stopPropagation();
                Explorer.navigateFocused(item.path);
              });
              childContainer.appendChild(fileEl);
            }
          }
          if (sorted.length === 0) {
            toggle.classList.add('leaf');
            toggle.textContent = '▸';
          }
        } catch {
          childrenLoaded = false;
        }
      }
    };

    toggle.addEventListener('click', toggleNode);
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      Explorer.navigateFocused(path);
    });

    return wrapper;
  }

  return { logAccess, render };
})();
