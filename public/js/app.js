/* Boot — auth check, restore workspace state, init modules */
(function () {
  if (!localStorage.getItem('de_token')) {
    location.href = '/enroll';
    return;
  }

  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
  }

  // Fix iOS Safari viewport shifting on orientation change
  // When rotating, the address bar height changes and 100dvh updates, but the
  // layout needs to be recomputed. Trigger a tiny style recalc to force layout.
  function fixIOSViewport() {
    const html = document.documentElement;
    const current = html.style.minHeight;
    html.style.minHeight = '100dvh';
    // Trigger repaint by reading a computed style
    window.getComputedStyle(html).minHeight;
    if (current) html.style.minHeight = current;
  }
  window.addEventListener('orientationchange', fixIOSViewport);
  window.addEventListener('resize', () => {
    if (window.visualViewport) {
      // visualViewport.height gives the true visible height on iOS Safari
      const viewportHeight = window.visualViewport.height;
      if (viewportHeight > 0) {
        // Recalculate if viewport actually changed
        fixIOSViewport();
      }
    }
  });

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
