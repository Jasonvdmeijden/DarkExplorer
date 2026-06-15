/* Boot — auth check, restore workspace state, init modules */
(function () {
  if (!localStorage.getItem('de_token')) {
    location.href = '/enroll';
    return;
  }

  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
  }

  // Wire git panel refresh when user navigates (all modules loaded at this point)
  Explorer.addNavListener((path) => {
    const gitTab = document.querySelector('.ptab[data-panel="git"]');
    if (gitTab?.classList.contains('active')) Git.refresh(path);
  });

  // Keep an open terminal's cwd in sync with explorer navigation (and vice versa)
  Explorer.addNavListener((path) => Term.syncToPath(path));

  window.addEventListener('load', () => {
    State.onReady(async () => {
      await Drives.init();

      const savedTabs   = State.get('tabs', null);
      const savedActive = State.get('activeTab', null);

      if (savedTabs && savedTabs.length > 0) {
        Tabs.restore(savedTabs, savedActive);
      } else {
        Tabs.create('Home', null);
      }

      Tree.init();
      Panels.restore();
    });
  });
})();
