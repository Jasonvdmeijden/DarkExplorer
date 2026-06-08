/* Tab management */
const Tabs = (() => {
  let tabs = [];
  let activeId = null;
  let seq = 0;

  const list = document.getElementById('tabs-list');

  function create(name, path) {
    const id = ++seq;
    tabs.push({ id, name, path });
    render();
    activate(id);
    return id;
  }

  function activate(id) {
    activeId = id;
    render();
    const tab = tabs.find(t => t.id === id);
    if (tab) Explorer.navigate(tab.path, id);
  }

  function close(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    tabs.splice(idx, 1);
    if (activeId === id) {
      const next = tabs[idx] || tabs[idx - 1];
      activeId = next ? next.id : null;
    }
    render();
    if (activeId) {
      const tab = tabs.find(t => t.id === activeId);
      if (tab) Explorer.navigate(tab.path, activeId);
    }
  }

  function updateName(id, name, path) {
    const tab = tabs.find(t => t.id === id);
    if (tab) { tab.name = name; tab.path = path; render(); }
  }

  function getActive() { return tabs.find(t => t.id === activeId) || null; }

  function render() {
    list.innerHTML = '';
    tabs.forEach(tab => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === activeId ? ' active' : '');
      el.innerHTML = `<span class="tab-name" title="${tab.path}">${tab.name}</span><span class="tab-close">✕</span>`;
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-close')) close(tab.id);
        else activate(tab.id);
      });
      list.appendChild(el);
    });
  }

  document.getElementById('btn-new-tab').addEventListener('click', () => {
    create('Home', null);
  });

  return { create, activate, close, updateName, getActive };
})();
