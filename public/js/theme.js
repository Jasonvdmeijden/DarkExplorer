/* Theme management — pick a named theme + a dark/light mode for that theme */
const Theme = (() => {
  // Each entry has a display name plus two CSS files (one per mode).
  const THEMES = [
    { id: 'vault',     name: 'Vault',         dark: 'dark',          light: 'light' },
    { id: 'dracula',   name: 'Dracula',       dark: 'dracula',       light: 'dracula-light' },
    { id: 'solarized', name: 'Solarized',     dark: 'solarized-dark',light: 'solarized-light' },
    { id: 'arcade',    name: 'Retro Arcade',  dark: 'arcade-dark',   light: 'arcade-light' },
    { id: 'vice',      name: 'Vice City',     dark: 'vice-dark',     light: 'vice-light' },
    { id: 'earthy',    name: 'Earthy',        dark: 'earthy-dark',   light: 'earthy-light' },
    { id: 'forest',    name: 'Forest',        dark: 'forest-dark',   light: 'forest-light' },
    { id: 'pastel',    name: 'Pastel',        dark: 'pastel-dark',   light: 'pastel-light' },
    { id: 'hacker',    name: 'Hacker',        dark: 'hacker-dark',   light: 'hacker-light' },
    { id: 'clean',     name: 'Clean',         dark: 'clean-dark',    light: 'clean-light' },
    { id: 'contrast',  name: 'High Contrast', dark: 'contrast-dark', light: 'contrast-light' },
    { id: 'ocean',     name: 'Ocean',         dark: 'ocean-dark',    light: 'ocean-light' },
  ];

  // Legacy single-mode IDs that pre-date this catalog → map them to a theme+mode pair.
  const LEGACY = {
    'dark':            { id: 'vault',     mode: 'dark'  },
    'light':           { id: 'vault',     mode: 'light' },
    'dracula':         { id: 'dracula',   mode: 'dark'  },
    'solarized-light': { id: 'solarized', mode: 'light' },
  };

  let currentId   = localStorage.getItem('de_theme') || 'vault';
  let currentMode = localStorage.getItem('de_mode')  || 'dark';

  // Migrate any legacy stored value
  if (LEGACY[currentId]) {
    currentMode = LEGACY[currentId].mode;
    currentId   = LEGACY[currentId].id;
  }

  function _entry(id) {
    return THEMES.find(t => t.id === id) || THEMES[0];
  }

  function apply(id, mode) {
    const entry = _entry(id || currentId);
    currentId   = entry.id;
    currentMode = (mode === 'light' || mode === 'dark') ? mode : currentMode;
    const file  = entry[currentMode] || entry.dark;
    document.getElementById('theme-css').href = `/css/themes/${file}.css`;
    document.documentElement.dataset.theme = entry.id;
    document.documentElement.dataset.mode  = currentMode;
    localStorage.setItem('de_theme', currentId);
    localStorage.setItem('de_mode',  currentMode);
    // Toggle highlight.js stylesheet pair to match the chosen mode
    const hd = document.getElementById('hljs-dark');
    const hl = document.getElementById('hljs-light');
    if (hd && hl) {
      hd.disabled = (currentMode === 'light');
      hl.disabled = (currentMode === 'dark');
    }
    document.dispatchEvent(new CustomEvent('themechange', { detail: { id: currentId, mode: currentMode } }));
  }

  // Toggle dark/light of the currently selected theme
  function toggle() {
    apply(currentId, currentMode === 'dark' ? 'light' : 'dark');
  }

  function getCurrent()     { return currentId; }
  function getCurrentMode() { return currentMode; }
  function list()           { return THEMES.slice(); }

  // ── Picker popover ────────────────────────────────────────────
  let _popover = null;
  function _buildPopover() {
    _popover = document.createElement('div');
    _popover.id = 'theme-picker-popover';
    document.body.appendChild(_popover);

    document.addEventListener('click', (e) => {
      if (!_popover || _popover.style.display === 'none') return;
      if (e.target.closest('#theme-picker-popover')) return;
      if (e.target.closest('#btn-theme-picker'))     return;
      _popover.style.display = 'none';
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _popover && _popover.style.display !== 'none') {
        _popover.style.display = 'none';
      }
    });
  }

  function showPicker(anchor) {
    if (!_popover) _buildPopover();
    _popover.innerHTML = '';

    // Header with dark/light toggle (so users on mobile — where #btn-theme is hidden — still have it)
    const header = document.createElement('div');
    header.className = 'theme-picker-header';
    header.innerHTML = `
      <span class="theme-picker-title">Theme</span>
      <div class="theme-mode-toggle" role="tablist">
        <button class="theme-mode-btn ${currentMode === 'light' ? 'active' : ''}" data-mode="light" title="Light mode">☀ Light</button>
        <button class="theme-mode-btn ${currentMode === 'dark'  ? 'active' : ''}" data-mode="dark"  title="Dark mode">☾ Dark</button>
      </div>`;
    header.querySelectorAll('.theme-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        apply(currentId, btn.dataset.mode);
        // Rebuild the popover so the active states and swatches reflect the new mode
        showPicker(anchor);
      });
    });
    _popover.appendChild(header);

    const list = document.createElement('div');
    list.className = 'theme-picker-list';
    THEMES.forEach(t => {
      const row = document.createElement('button');
      row.className = 'theme-picker-row';
      if (t.id === currentId) row.classList.add('active');
      // Show the swatch matching the CURRENT mode prominently, the other muted
      const primary   = t[currentMode] || t.dark;
      const secondary = t[currentMode === 'dark' ? 'light' : 'dark'];
      row.innerHTML = `
        <span class="theme-picker-swatches">
          ${_swatch(primary)}${_swatch(secondary, true)}
        </span>
        <span class="theme-picker-name">${t.name}</span>
        ${t.id === currentId ? '<span class="theme-picker-check">✓</span>' : ''}`;
      row.addEventListener('click', () => {
        apply(t.id, currentMode);
        _popover.style.display = 'none';
      });
      list.appendChild(row);
    });
    _popover.appendChild(list);

    // Position below the anchor button (right-anchored)
    const r = anchor.getBoundingClientRect();
    _popover.style.position = 'fixed';
    _popover.style.top  = (r.bottom + 6) + 'px';
    _popover.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    _popover.style.display = 'block';
  }

  // Tiny preview swatch — a 14×14 box coloured to roughly match the theme's bg+accent.
  // Uses inline style with a hint from the theme id so all swatches don't need to load CSS.
  function _swatch(file, muted) {
    const palette = SWATCHES[file] || ['#888', '#666'];
    const cls = muted ? 'theme-swatch muted' : 'theme-swatch';
    return `<span class="${cls}" style="background:${palette[0]};border-color:${palette[1]}"></span>`;
  }
  // Hard-coded swatch hints (bg colour + accent) — fast and avoids parsing CSS at runtime.
  const SWATCHES = {
    'dark':           ['#12121a', '#7c6ef5'],
    'light':          ['#f0f0f8', '#6254d8'],
    'dracula':        ['#282a36', '#bd93f9'],
    'dracula-light':  ['#f8f8f2', '#6272a4'],
    'solarized-dark': ['#002b36', '#268bd2'],
    'solarized-light':['#fdf6e3', '#268bd2'],
    'arcade-dark':    ['#0a0014', '#ff00aa'],
    'arcade-light':   ['#fff4d6', '#ff2d8e'],
    'vice-dark':      ['#1a0b2e', '#ff6fff'],
    'vice-light':     ['#ffe1c5', '#ff5e9f'],
    'earthy-dark':    ['#2a1f12', '#d77a3a'],
    'earthy-light':   ['#f5ead4', '#8b4513'],
    'forest-dark':    ['#0d1f12', '#6dbe6d'],
    'forest-light':   ['#eaf4e2', '#2f6f3e'],
    'pastel-dark':    ['#2d2238', '#f7b2d9'],
    'pastel-light':   ['#fef0f7', '#c896d8'],
    'hacker-dark':    ['#000000', '#00ff66'],
    'hacker-light':   ['#f4f4dc', '#067a32'],
    'clean-dark':     ['#1a1a1a', '#888888'],
    'clean-light':    ['#ffffff', '#444444'],
    'contrast-dark':  ['#000000', '#ffd400'],
    'contrast-light': ['#ffffff', '#0033ff'],
    'ocean-dark':     ['#0b1d2e', '#39c5d9'],
    'ocean-light':    ['#e3f2f6', '#0d6986'],
  };

  // Initial apply
  apply(currentId, currentMode);

  // Wire UI buttons (deferred to DOM ready in case theme.js loads early)
  function _wire() {
    const tBtn = document.getElementById('btn-theme');
    const pBtn = document.getElementById('btn-theme-picker');
    if (tBtn) tBtn.addEventListener('click', toggle);
    if (pBtn) pBtn.addEventListener('click', (e) => { e.stopPropagation(); showPicker(pBtn); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire);
  else _wire();

  return { apply, toggle, getCurrent, getCurrentMode, list, showPicker, THEMES };
})();
