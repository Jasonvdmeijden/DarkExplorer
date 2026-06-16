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
  let glassMode   = localStorage.getItem('de_glass') === 'true';
  let animateMode = localStorage.getItem('de_glass_animate') === 'true';

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
    const themeLink = document.getElementById('theme-css');
    themeLink.href = `/css/themes/${file}.css`;
    // Once the new CSS file has loaded, recompute glass vars AND re-dispatch
    // themechange so listeners (e.g. terminal.js xterm theme) read the correct
    // CSS variables. The immediate dispatch below handles glass toggles (no
    // file change); this handles actual theme/mode switches.
    themeLink.addEventListener('load', () => {
      _updateGlassVars();
      document.dispatchEvent(new CustomEvent('themechange', { detail: { id: currentId, mode: currentMode } }));
    }, { once: true });
    document.documentElement.dataset.theme = entry.id;
    document.documentElement.dataset.mode  = currentMode;
    localStorage.setItem('de_theme', currentId);
    localStorage.setItem('de_mode',  currentMode);

    // Apply Glass Effect Modifier
    document.body.classList.toggle('glass-effect', glassMode);
    document.body.classList.toggle('glass-animate', glassMode && animateMode);
    _updateGlassVars();

    // Toggle highlight.js stylesheet pair to match the chosen mode
    const hd = document.getElementById('hljs-dark');
    const hl = document.getElementById('hljs-light');
    if (hd && hl) {
      hd.disabled = (currentMode === 'light');
      hl.disabled = (currentMode === 'dark');
    }
    document.dispatchEvent(new CustomEvent('themechange', { detail: { id: currentId, mode: currentMode } }));
  }

  // ── Glass-mode derived variables ──────────────────────────────
  // The frosted-glass look uses translucent versions of the *active theme's*
  // own colours (computed here from its resolved CSS variables), so glass
  // mode always matches whichever theme + light/dark mode is selected.
  function _hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex || '').trim());
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  }
  function _rgba(hex, alpha, fallback) {
    const rgb = _hexToRgb(hex);
    return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : fallback;
  }
  function _updateGlassVars() {
    const root = document.documentElement;
    const s = getComputedStyle(root);
    const get = (name, fallback) => s.getPropertyValue(name).trim() || fallback;

    const base    = get('--bg-base',     '#12121a');
    const text    = get('--text-primary','#e2e2f0');
    const accent  = get('--accent',      '#7c6ef5');
    const accent2 = get('--accent-2',    accent);

    // Tonal surfaces — derived from --bg-base, translucent enough that the
    // blurred wallpaper clearly shows through, while the 60px frosted-card
    // blur keeps text legible against --text-primary.
    root.style.setProperty('--glass-base',     _rgba(base, .20, base));
    root.style.setProperty('--glass-panel',    _rgba(base, .30, base));
    root.style.setProperty('--glass-surface',  _rgba(base, .42, base));

    // Accent-tinted highlight states
    root.style.setProperty('--glass-hover',    _rgba(accent, .14, accent));
    root.style.setProperty('--glass-selected', _rgba(accent, .24, accent));
    root.style.setProperty('--glass-active',   _rgba(accent, .32, accent));

    // Frosted-edge border, from the theme's text colour
    root.style.setProperty('--glass-border',   _rgba(text, .18, text));

    // Sync browser chrome / phone status-bar colour with the app background.
    // Glass mode uses the accent colour (matches the gradient tint visible
    // behind panels); non-glass uses the real base from :root (not the
    // glass-overridden body value) so it stays dark in dark mode.
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', glassMode ? accent : base);
  }

  // Toggle dark/light of the currently selected theme
  function toggle() {
    apply(currentId, currentMode === 'dark' ? 'light' : 'dark');
  }
  
  function toggleGlass() {
    glassMode = !glassMode;
    localStorage.setItem('de_glass', glassMode);
    apply(currentId, currentMode);
  }

  function toggleAnimate() {
    animateMode = !animateMode;
    localStorage.setItem('de_glass_animate', animateMode);
    apply(currentId, currentMode);
  }

  function getCurrent()     { return currentId; }
  function getCurrentMode() { return currentMode; }
  function isGlassMode()    { return glassMode; }
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

    const header = document.createElement('div');
    header.className = 'theme-picker-header';
    header.innerHTML = `
      <span class="theme-picker-title" style="flex:1">Theme</span>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:11px; color:var(--text-muted);">Dark</span>
          <label class="ui-switch">
            <input type="checkbox" id="theme-dark-toggle" ${currentMode === 'dark' ? 'checked' : ''}>
            <span class="ui-slider"></span>
          </label>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:11px; color:var(--text-muted);">Glass</span>
          <label class="ui-switch">
            <input type="checkbox" id="theme-glass-toggle" ${glassMode ? 'checked' : ''}>
            <span class="ui-slider"></span>
          </label>
        </div>
        <div style="display:flex; align-items:center; gap:8px; ${glassMode ? '' : 'opacity:.4;'}">
          <span style="font-size:11px; color:var(--text-muted);">Animate</span>
          <label class="ui-switch">
            <input type="checkbox" id="theme-animate-toggle" ${animateMode ? 'checked' : ''} ${glassMode ? '' : 'disabled'}>
            <span class="ui-slider"></span>
          </label>
        </div>
      </div>
    `;

    header.querySelector('#theme-dark-toggle').addEventListener('change', () => {
      toggle();
      showPicker(anchor);
    });
    header.querySelector('#theme-glass-toggle').addEventListener('change', () => {
      toggleGlass();
      showPicker(anchor);
    });
    header.querySelector('#theme-animate-toggle').addEventListener('change', () => {
      toggleAnimate();
      showPicker(anchor);
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
    'glass':          ['#2a5298', '#ffffff'],
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
    const pBtn = document.getElementById('btn-theme-picker');
    if (pBtn) pBtn.addEventListener('click', (e) => { e.stopPropagation(); showPicker(pBtn); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire);
  else _wire();

  return { apply, toggle, getCurrent, getCurrentMode, list, showPicker, THEMES };
})();
