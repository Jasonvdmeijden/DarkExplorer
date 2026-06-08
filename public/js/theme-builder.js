/* Theme builder — colour picker UI, live preview, save/load custom themes */
const ThemeBuilder = (() => {
  const VARS = [
    { key: '--bg-base',       label: 'Background' },
    { key: '--bg-surface',    label: 'Surface' },
    { key: '--bg-panel',      label: 'Panel' },
    { key: '--bg-hover',      label: 'Hover' },
    { key: '--bg-selected',   label: 'Selected' },
    { key: '--border',        label: 'Border' },
    { key: '--text-primary',  label: 'Text primary' },
    { key: '--text-secondary',label: 'Text secondary' },
    { key: '--text-muted',    label: 'Text muted' },
    { key: '--accent',        label: 'Accent' },
    { key: '--accent-2',      label: 'Accent 2' },
    { key: '--danger',        label: 'Danger' }
  ];

  let panel = null;
  let styleEl = null;
  let current = {};

  function open() {
    if (!panel) build();
    loadCurrentValues();
    panel.style.display = 'flex';
  }

  function close() {
    if (panel) panel.style.display = 'none';
  }

  function build() {
    panel = document.createElement('div');
    panel.style.cssText = `
      position:fixed; inset:0; z-index:500;
      background:rgba(0,0,0,.55); display:none;
      align-items:center; justify-content:center;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      background:var(--bg-surface); border:1px solid var(--border);
      border-radius:var(--radius-lg); width:min(480px,95vw);
      box-shadow:var(--shadow); display:flex; flex-direction:column;
      max-height:90vh; overflow:hidden;
    `;

    card.innerHTML = `
      <div style="display:flex;align-items:center;padding:.75rem 1rem;border-bottom:1px solid var(--border)">
        <span style="font-weight:700;flex:1">Theme Builder</span>
        <select id="tb-preset" style="background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);border-radius:var(--radius-sm);padding:.2rem .4rem;font-size:.8rem;margin-right:.5rem">
          <option value="dark">Vault Dark</option>
          <option value="light">Vault Light</option>
        </select>
        <button id="tb-close" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px">✕</button>
      </div>
      <div id="tb-pickers" style="overflow-y:auto;padding:.75rem 1rem;display:grid;grid-template-columns:1fr 1fr;gap:.5rem .75rem"></div>
      <div style="padding:.75rem 1rem;border-top:1px solid var(--border);display:flex;gap:.5rem;align-items:center">
        <input id="tb-name" placeholder="Theme name" style="flex:1;background:var(--bg-base);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.3rem .6rem;color:var(--text-primary);font-size:.85rem;outline:none">
        <button id="tb-save" style="background:var(--accent);border:none;color:#fff;border-radius:var(--radius-sm);padding:.3rem .8rem;cursor:pointer;font-size:.85rem;font-weight:600">Save</button>
        <button id="tb-cancel" style="background:none;border:1px solid var(--border);color:var(--text-secondary);border-radius:var(--radius-sm);padding:.3rem .8rem;cursor:pointer;font-size:.85rem">Cancel</button>
      </div>
    `;

    // build pickers
    const pickers = card.querySelector('#tb-pickers');
    VARS.forEach(({ key, label }) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:.5rem';
      row.innerHTML = `
        <input type="color" data-var="${key}" style="width:32px;height:28px;border:none;border-radius:4px;cursor:pointer;background:none;padding:0">
        <span style="font-size:.8rem;color:var(--text-secondary)">${label}</span>
      `;
      row.querySelector('input').addEventListener('input', (e) => {
        current[key] = e.target.value;
        applyPreview();
      });
      pickers.appendChild(row);
    });

    card.querySelector('#tb-preset').addEventListener('change', (e) => {
      Theme.apply(e.target.value);
      setTimeout(() => { loadCurrentValues(); applyPreview(); }, 50);
    });

    card.querySelector('#tb-close').addEventListener('click', () => { revert(); close(); });
    card.querySelector('#tb-cancel').addEventListener('click', () => { revert(); close(); });
    card.querySelector('#tb-save').addEventListener('click', save);

    panel.appendChild(card);
    document.body.appendChild(panel);
    panel.addEventListener('click', (e) => { if (e.target === panel) { revert(); close(); } });
  }

  function loadCurrentValues() {
    const style = getComputedStyle(document.documentElement);
    VARS.forEach(({ key }) => {
      const val = style.getPropertyValue(key).trim();
      current[key] = val;
      const input = panel.querySelector(`input[data-var="${key}"]`);
      if (input && val.startsWith('#')) input.value = val;
    });
  }

  function applyPreview() {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'theme-builder-preview';
      document.head.appendChild(styleEl);
    }
    const rules = Object.entries(current).map(([k, v]) => `${k}:${v}`).join(';');
    styleEl.textContent = `:root{${rules}}`;
  }

  function revert() {
    if (styleEl) { styleEl.remove(); styleEl = null; }
  }

  async function save() {
    const name = panel.querySelector('#tb-name').value.trim();
    if (!name) { panel.querySelector('#tb-name').focus(); return; }
    try {
      await WS.send('fs:write', {
        path: `data/themes/${name}.json`,
        content: JSON.stringify({ name, vars: current }, null, 2)
      });
      if (styleEl) {
        // keep the preview — user saved it, so make it permanent
        styleEl.id = `theme-${name}`;
        styleEl = null;
      }
      close();
    } catch (e) {
      alert('Could not save theme: ' + e.message);
    }
  }

  // wire settings button
  document.getElementById('btn-settings').addEventListener('click', open);

  return { open, close };
})();
