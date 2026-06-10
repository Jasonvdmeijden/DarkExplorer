/* Theme management — switches CSS link, persists choice */
const Theme = (() => {
  const THEMES = ['dark', 'light', 'dracula', 'solarized-light'];
  let current = localStorage.getItem('de_theme') || 'dark';

  function apply(name) {
    current = name;
    document.getElementById('theme-css').href = `/css/themes/${name}.css`;
    document.documentElement.dataset.theme = name;
    localStorage.setItem('de_theme', name);
  }

  function toggle() {
    const idx = THEMES.indexOf(current);
    apply(THEMES[(idx + 1) % THEMES.length]);
  }

  function getCurrent() { return current; }

  // apply on load
  apply(current);

  return { apply, toggle, getCurrent, THEMES };
})();
