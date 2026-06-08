/* Boot — auth check, initial tab, mermaid init */
(function () {
  // redirect to enroll if no token
  if (!localStorage.getItem('de_token')) {
    location.href = '/enroll';
    return;
  }

  // init mermaid dark theme
  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
  }

  // open first tab on load
  window.addEventListener('load', () => {
    Tabs.create('Home', null);
  });
})();
