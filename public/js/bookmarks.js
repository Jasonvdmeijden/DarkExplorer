/* Bookmarks panel — supports both filesystem paths and web URLs */
const Bookmarks = (() => {
  const panel = document.getElementById('bookmarks-panel');

  async function load() {
    try {
      const items = await WS.send('bookmark:list');
      render(Array.isArray(items) ? items : []);
    } catch (e) {
      console.error('[bookmarks] load failed:', e);
    }
  }

  function render(items) {
    const list = panel.querySelector('#bookmark-list');
    if (!list) return;
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<p style="padding:.6rem .75rem;font-size:.8rem;color:var(--text-muted)">No bookmarks yet.<br>Right-click a folder to add one.</p>';
      return;
    }
    items.forEach(b => {
      const isUrl = !!b.url;
      const icon  = isUrl ? '🌐' : (b.path && b.path.endsWith('\\') ? '💾' : '📌');
      const el = document.createElement('div');
      el.className = 'bookmark-item';
      el.innerHTML = `<span>${icon}</span>
        <span class="bookmark-label">${escHtml(b.label || b.path || b.url)}</span>
        <button class="bookmark-remove icon-btn" title="Remove">✕</button>`;
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('bookmark-remove')) {
          remove(b.id);
        } else if (isUrl) {
          Preview.open({ name: b.label || b.url, url: b.url, isDir: false, path: null });
        } else {
          Explorer.navigate(b.path);
        }
      });
      list.appendChild(el);
    });
  }

  async function add(pathVal, label) {
    await WS.send('bookmark:add', { path: pathVal, label });
    await load();
  }

  async function addUrl(urlVal, label) {
    if (!urlVal) return;
    if (!/^https?:\/\//i.test(urlVal)) urlVal = 'https://' + urlVal;
    await WS.send('bookmark:add', { url: urlVal, label: label || urlVal });
    await load();
  }

  async function remove(id) {
    await WS.send('bookmark:remove', { id });
    await load();
  }

  function setStatus(msg, isErr) {
    const el = panel.querySelector('#bm-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isErr ? 'var(--danger)' : 'var(--accent)';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; }, 2500);
  }

  function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Build panel structure: URL add bar + scrollable list
  panel.innerHTML = `
    <div class="bookmark-add-bar">
      <input id="bookmark-url-input" type="text" placeholder="Add URL or paste path…" spellcheck="false">
      <button id="btn-add-url-bm" class="icon-btn" title="Add bookmark">+</button>
    </div>
    <span id="bm-status" style="font-size:.74rem;padding:.1rem .75rem;min-height:1.1rem;display:block"></span>
    <div id="bookmark-list" style="flex:1;overflow-y:auto"></div>`;

  document.getElementById('btn-add-url-bm').addEventListener('click', async () => {
    const input = document.getElementById('bookmark-url-input');
    const val = input.value.trim();
    if (!val) return;
    input.value = '';
    input.disabled = true;
    try {
      // Detect filesystem path vs URL
      if (/^([A-Za-z]:[\\\/]|\/|\\\\)/.test(val)) {
        await add(val);
      } else {
        await addUrl(val);
      }
      setStatus('Bookmark added');
    } catch (e) {
      console.error('[bookmarks] add failed:', e);
      input.value = val; // restore so user can retry
      setStatus(e.message || 'Failed to add bookmark', true);
    } finally {
      input.disabled = false;
    }
  });

  document.getElementById('bookmark-url-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-add-url-bm').click();
  });

  load().catch(() => {});
  return { load, add, addUrl, remove };
})();
