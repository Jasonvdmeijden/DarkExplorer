/* Tab management */
const Tabs = (() => {
  let tabs     = [];
  let activeId = null;
  let seq      = 0;
  let _saving  = false; // prevent re-entrant saves during programmatic updates

  const list = document.getElementById('tabs-list');

  function _saveState() {
    if (_saving) return;
    State.set('tabs',      tabs.map(t => ({ id: t.id, name: t.name, path: t.path })));
    State.set('activeTab', activeId);
  }

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
    _saveState();
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
    _saveState();
  }

  function updateName(id, name, path) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    tab.name = name;
    tab.path = path;
    render();
    _saveState();
  }

  function getActive() { return tabs.find(t => t.id === activeId) || null; }

  // Called by app.js on startup to restore persisted or synced tabs
  function restore(savedTabs, savedActiveId) {
    _saving = true;
    tabs    = [];
    seq     = 0;
    savedTabs.forEach(t => {
      tabs.push({ id: t.id, name: t.name, path: t.path });
      if (t.id > seq) seq = t.id;
    });
    activeId = savedActiveId || (tabs[0] ? tabs[0].id : null);
    render();
    if (activeId) {
      const tab = tabs.find(t => t.id === activeId);
      if (tab) Explorer.navigate(tab.path, activeId);
    }
    _saving = false;
  }

  // Cross-device: another device changed the tab list.
  // While driving a remote (controller overlay up) we don't follow the live
  // session — the controller's own explorer stays put instead of navigating
  // along with the controllee underneath the overlay.
  State.onChange('tabs', (newTabs) => {
    if (document.body.classList.contains('de-controlling')) return;
    if (!newTabs || _saving) return;
    _saving = true;
    const prevPath = tabs.find(t => t.id === activeId)?.path ?? null;
    tabs = newTabs.map(t => ({ ...t }));
    seq  = Math.max(seq, ...tabs.map(t => t.id), 0);
    if (!tabs.find(t => t.id === activeId) && tabs.length > 0) {
      activeId = tabs[0].id;
    }
    render();
    // Follow navigation: if the active tab's path changed on another device, navigate here too
    const activeTab = tabs.find(t => t.id === activeId);
    if (activeTab && activeTab.path !== prevPath) {
      Explorer.navigate(activeTab.path, activeId);
    }
    _saving = false;
  });

  // Cross-device: another device switched the active tab
  State.onChange('activeTab', (newId) => {
    if (document.body.classList.contains('de-controlling')) return;
    if (newId === activeId || _saving) return;
    const tab = tabs.find(t => t.id === newId);
    if (!tab) return;
    _saving  = true;
    activeId = newId;
    render();
    Explorer.navigate(tab.path, newId);
    _saving = false;
  });

  function render() {
    list.innerHTML = '';
    tabs.forEach((tab, idx) => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === activeId ? ' active' : '');
      el.innerHTML = `<span class="tab-name" title="${tab.path || ''}">${tab.name}</span><span class="tab-close">✕</span>`;
      
      el.setAttribute('draggable', 'true');
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', idx);
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));

      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-close')) close(tab.id);
        else activate(tab.id);
      });
      list.appendChild(el);
    });

    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = list.querySelector('.tab.dragging');
      if (!dragging) return;
      const afterElement = getDragAfterElement(list, e.clientX);
      if (afterElement == null) {
        list.appendChild(dragging);
      } else {
        list.insertBefore(dragging, afterElement);
      }
    });

    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const oldIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const newIdx = [...list.children].indexOf(list.querySelector('.tab.dragging'));
      
      if (oldIdx !== newIdx) {
        const [movedTab] = tabs.splice(oldIdx, 1);
        tabs.splice(newIdx, 0, movedTab);
        _saveState();
      }
    });
  }

  function getDragAfterElement(container, x) {
    const draggableElements = [...container.querySelectorAll('.tab:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  document.getElementById('btn-new-tab').addEventListener('click', () => {
    create('Home', null);
  });

  // Attach "open folder in new tab" behaviour to an element.
  //   - Desktop:  middle-click (auxclick button 1) or Ctrl+click
  //   - Mobile:   triple-tap within 600ms
  // `getTarget(event)` should return { name, path, isDir } or null. We only act on folders.
  function attachOpenInNewTab(el, getTarget) {
    el.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const t = getTarget(e);
      if (!t || !t.isDir) return;
      e.preventDefault();
      create(t.name || (t.path || '').split(/[\\/]/).pop() || 'Tab', t.path);
    });
    el.addEventListener('click', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = getTarget(e);
      if (!t || !t.isDir) return;
      e.preventDefault();
      e.stopPropagation();
      create(t.name || (t.path || '').split(/[\\/]/).pop() || 'Tab', t.path);
    });

    // Triple-tap on touchscreens
    let _taps = 0, _tapTimer = null;
    el.addEventListener('touchend', (e) => {
      _taps++;
      if (_tapTimer) clearTimeout(_tapTimer);
      if (_taps >= 3) {
        _taps = 0;
        const t = getTarget(e);
        if (t && t.isDir) {
          e.preventDefault();
          e.stopPropagation();
          create(t.name || (t.path || '').split(/[\\/]/).pop() || 'Tab', t.path);
        }
      } else {
        _tapTimer = setTimeout(() => { _taps = 0; }, 600);
      }
    }, { passive: false });
  }

  return { create, activate, close, updateName, getActive, restore, attachOpenInNewTab };
})();
