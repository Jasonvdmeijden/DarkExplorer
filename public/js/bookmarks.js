/* Bookmarks panel */
const Bookmarks = (() => {
  const panel = document.getElementById('bookmarks-panel');

  async function load() {
    const items = await WS.send('bookmark:list');
    render(items);
  }

  function render(items) {
    panel.innerHTML = '';
    if (!items.length) {
      panel.innerHTML = '<p style="padding:.6rem .75rem;font-size:.8rem;color:var(--text-muted)">No bookmarks yet.<br>Right-click a folder to add one.</p>';
      return;
    }
    items.forEach(b => {
      const el = document.createElement('div');
      el.className = 'bookmark-item';
      el.innerHTML = `<span>📌</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis">${escHtml(b.label || b.path)}</span>
        <button class="bookmark-remove icon-btn" title="Remove">✕</button>`;
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('bookmark-remove')) {
          remove(b.id);
        } else {
          Explorer.navigate(b.path);
        }
      });
      panel.appendChild(el);
    });
  }

  async function add(path, label) {
    await WS.send('bookmark:add', { path, label });
    load();
  }

  async function remove(id) {
    await WS.send('bookmark:remove', { id });
    load();
  }

  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  load();
  return { load, add, remove };
})();
