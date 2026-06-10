// Theme palette generator. Run: node scripts/gen-themes.js
// Convention: the SATURATED brand colour lives in --bg-panel and --bg-surface
// (sidebars, toolbar, dialogs). The main file-listing area uses --bg-base which is
// the most NEUTRAL / least chromatic shade of the theme. This keeps the chrome
// distinctive while the content area stays calm and readable.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'css', 'themes');

const COMMON = `
  --radius:         8px;
  --radius-sm:      5px;
  --radius-lg:      12px;

  --font-size:      13px;
  --font-mono:      'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;`;

function css(p) {
  return `:root {
  --bg-base:       ${p.bgBase};
  --bg-surface:    ${p.bgSurface};
  --bg-panel:      ${p.bgPanel};
  --bg-hover:      ${p.bgHover};
  --bg-selected:   ${p.bgSelected};
  --bg-active:     ${p.bgActive};

  --border:        ${p.border};
  --border-focus:  ${p.accent};

  --text-primary:   ${p.textPrimary};
  --text-secondary: ${p.textSecondary};
  --text-muted:     ${p.textMuted};
  --text-inverse:   ${p.textInverse};

  --accent:         ${p.accent};
  --accent-hover:   ${p.accentHover};
  --accent-dim:     ${p.accentDim};
  --accent-2:       ${p.accent2};
  --accent-2-hover: ${p.accent2Hover};

  --danger:         ${p.danger};
  --warn:           ${p.warn};
  --success:        ${p.success};

  --scrollbar-track: ${p.scrollTrack};
  --scrollbar-thumb: ${p.scrollThumb};
  --scrollbar-thumb-hover: ${p.accent};

  --shadow:         ${p.shadow};
  --shadow-sm:      ${p.shadowSm};
${COMMON}
}
`;
}

const themes = {
  // ── Dracula light (companion to existing dracula.css dark)
  'dracula-light': {
    bgBase:    '#fdfdf8', // soft warm white content
    bgSurface: '#c4c5d8', // saturated lavender chrome
    bgPanel:   '#d2d2e3',
    bgHover:   '#b5b6cc', bgSelected: '#a3a4be', bgActive: '#9192af',
    border: '#d8d8d0',
    textPrimary: '#282a36', textSecondary: '#5b5d6a', textMuted: '#8a8a96', textInverse: '#fff',
    accent: '#6272a4', accentHover: '#44475a', accentDim: 'rgba(98,114,164,.15)',
    accent2: '#af67a8', accent2Hover: '#c87fc0',
    danger: '#cd3a55', warn: '#c08b32', success: '#2f9e44',
    scrollTrack: '#d2d2e3', scrollThumb: '#a8aac0',
    shadow: '0 4px 24px rgba(40,42,54,.12)', shadowSm: '0 2px 8px rgba(40,42,54,.08)'
  },

  // ── Solarized ──
  'solarized-dark': {
    bgBase: '#0a1d22', bgSurface: '#073642', bgPanel: '#062f3a',
    bgHover: '#0c4252', bgSelected: '#11556a', bgActive: '#176680',
    border: '#0e4250',
    textPrimary: '#eee8d5', textSecondary: '#93a1a1', textMuted: '#586e75', textInverse: '#0a1d22',
    accent: '#268bd2', accentHover: '#3fa3e8', accentDim: 'rgba(38,139,210,.18)',
    accent2: '#2aa198', accent2Hover: '#3cb9b1',
    danger: '#dc322f', warn: '#cb4b16', success: '#859900',
    scrollTrack: '#073642', scrollThumb: '#1a4f60',
    shadow: '0 4px 24px rgba(0,0,0,.55)', shadowSm: '0 2px 8px rgba(0,0,0,.4)'
  },

  // ── Retro Arcade — content stays muted, panels/toolbar pop with neon purple
  'arcade-dark': {
    bgBase:    '#0d0a14', // near-black, almost no chroma
    bgSurface: '#280048', // saturated arcade purple (toolbar/dialog)
    bgPanel:   '#1f0038', // deep saturated panel
    bgHover:   '#330058', bgSelected: '#480078', bgActive: '#5e009c',
    border: '#3a0a5e',
    textPrimary: '#f8e8ff', textSecondary: '#b478e0', textMuted: '#6a4090', textInverse: '#0d0a14',
    accent: '#ff00aa', accentHover: '#ff44c4', accentDim: 'rgba(255,0,170,.22)',
    accent2: '#00ffff', accent2Hover: '#5eeaff',
    danger: '#ff3366', warn: '#ffcc00', success: '#00ff88',
    scrollTrack: '#1a002e', scrollThumb: '#4d1980',
    shadow: '0 4px 24px rgba(255,0,170,.25)', shadowSm: '0 2px 8px rgba(0,0,0,.55)'
  },
  'arcade-light': {
    bgBase:    '#fdf8ec', // gentle cream content area
    bgSurface: '#ffd5e6', // saturated bubblegum pink chrome
    bgPanel:   '#ffe1ed',
    bgHover:   '#ffc8db', bgSelected: '#ffb5d0', bgActive: '#ffa2c4',
    border: '#e8c47a',
    textPrimary: '#3d0030', textSecondary: '#7a2266', textMuted: '#b8829e', textInverse: '#fff',
    accent: '#ff2d8e', accentHover: '#ff5fa6', accentDim: 'rgba(255,45,142,.18)',
    accent2: '#00a3a3', accent2Hover: '#1ec0c0',
    danger: '#d6234a', warn: '#cc7e00', success: '#1a9a4a',
    scrollTrack: '#ffe1ed', scrollThumb: '#e6a8cf',
    shadow: '0 4px 24px rgba(255,45,142,.18)', shadowSm: '0 2px 8px rgba(0,0,0,.12)'
  },

  // ── Vice City — neutral content, saturated sunset chrome
  'vice-dark': {
    bgBase:    '#171022', // near-black with slight violet wash
    bgSurface: '#3a0e5e', // saturated sunset purple (toolbar)
    bgPanel:   '#2a0d4a',
    bgHover:   '#4a1875', bgSelected: '#5e2390', bgActive: '#7530a8',
    border: '#4b1e6e',
    textPrimary: '#ffe4f2', textSecondary: '#d199cf', textMuted: '#8e6093', textInverse: '#171022',
    accent: '#ff6fff', accentHover: '#ff95ff', accentDim: 'rgba(255,111,255,.2)',
    accent2: '#ffa46b', accent2Hover: '#ffbb91',
    danger: '#ff4f7e', warn: '#ffb648', success: '#5eead4',
    scrollTrack: '#2a1444', scrollThumb: '#653d8e',
    shadow: '0 4px 24px rgba(255,111,255,.25)', shadowSm: '0 2px 8px rgba(0,0,0,.5)'
  },
  'vice-light': {
    bgBase:    '#fff8f0', // soft warm white content
    bgSurface: '#ffb88c', // saturated peach chrome
    bgPanel:   '#ffc8a2',
    bgHover:   '#ffa974', bgSelected: '#ff9b6b', bgActive: '#fa8c5a',
    border: '#e8b88c',
    textPrimary: '#4b1652', textSecondary: '#7a3473', textMuted: '#b27ca0', textInverse: '#fff',
    accent: '#ff5e9f', accentHover: '#ff85b6', accentDim: 'rgba(255,94,159,.18)',
    accent2: '#ff7a3d', accent2Hover: '#ff9460',
    danger: '#d63f5e', warn: '#cf7d00', success: '#1aa37e',
    scrollTrack: '#ffd2b3', scrollThumb: '#e29bb3',
    shadow: '0 4px 24px rgba(255,94,159,.18)', shadowSm: '0 2px 8px rgba(0,0,0,.12)'
  },

  // ── Earthy — content is dark mocha, panels are warm terracotta
  'earthy-dark': {
    bgBase:    '#1d160e', // dark mocha, low chroma
    bgSurface: '#4d3520', // saturated terracotta toolbar
    bgPanel:   '#3d2a18',
    bgHover:   '#5a4028', bgSelected: '#704e32', bgActive: '#855c3a',
    border: '#4a3622',
    textPrimary: '#f3e6cc', textSecondary: '#b59a78', textMuted: '#7a6850', textInverse: '#1d160e',
    accent: '#d77a3a', accentHover: '#e89854', accentDim: 'rgba(215,122,58,.2)',
    accent2: '#9bb86a', accent2Hover: '#b3cb87',
    danger: '#d65a3b', warn: '#e2a82a', success: '#88b15a',
    scrollTrack: '#3a2c1a', scrollThumb: '#6b5538',
    shadow: '0 4px 24px rgba(0,0,0,.5)', shadowSm: '0 2px 8px rgba(0,0,0,.35)'
  },
  'earthy-light': {
    bgBase:    '#fbf6ea', // cream content
    bgSurface: '#dcb98a', // saturated tan chrome
    bgPanel:   '#e5c79e',
    bgHover:   '#d2a874', bgSelected: '#c39860', bgActive: '#b3884c',
    border: '#cdb78a',
    textPrimary: '#3a2412', textSecondary: '#6e553a', textMuted: '#a39072', textInverse: '#fff',
    accent: '#8b4513', accentHover: '#a5572d', accentDim: 'rgba(139,69,19,.15)',
    accent2: '#5e7a3a', accent2Hover: '#789854',
    danger: '#b53a23', warn: '#b07a18', success: '#4b8b30',
    scrollTrack: '#e5c79e', scrollThumb: '#bca576',
    shadow: '0 4px 24px rgba(58,36,18,.15)', shadowSm: '0 2px 8px rgba(58,36,18,.1)'
  },

  // ── Forest — content is muted slate, chrome is rich deep green
  'forest-dark': {
    bgBase:    '#10181a', // dark slate-gray, very low green
    bgSurface: '#1d4a24', // saturated forest green toolbar
    bgPanel:   '#15391a',
    bgHover:   '#266030', bgSelected: '#31783c', bgActive: '#3d9148',
    border: '#234d2e',
    textPrimary: '#e5f0d8', textSecondary: '#a5c099', textMuted: '#6a8466', textInverse: '#10181a',
    accent: '#6dbe6d', accentHover: '#88d088', accentDim: 'rgba(109,190,109,.2)',
    accent2: '#d4a84a', accent2Hover: '#e4bf6a',
    danger: '#d65a3b', warn: '#e2b035', success: '#5dba5d',
    scrollTrack: '#162d1c', scrollThumb: '#3a5d3a',
    shadow: '0 4px 24px rgba(0,0,0,.5)', shadowSm: '0 2px 8px rgba(0,0,0,.35)'
  },
  'forest-light': {
    bgBase:    '#f5faf0', // off-white content
    bgSurface: '#a8cf95', // saturated sage chrome
    bgPanel:   '#bcdaaa',
    bgHover:   '#9ac483', bgSelected: '#88b873', bgActive: '#76ad62',
    border: '#bccfae',
    textPrimary: '#1a2e1b', textSecondary: '#4a6750', textMuted: '#86a386', textInverse: '#fff',
    accent: '#2f6f3e', accentHover: '#458a55', accentDim: 'rgba(47,111,62,.15)',
    accent2: '#a07f1a', accent2Hover: '#bf9a32',
    danger: '#b5341a', warn: '#a07410', success: '#357a4a',
    scrollTrack: '#bcdaaa', scrollThumb: '#abc498',
    shadow: '0 4px 24px rgba(26,46,27,.12)', shadowSm: '0 2px 8px rgba(26,46,27,.08)'
  },

  // ── Pastel — content is silvery, chrome is soft saturated rose
  'pastel-dark': {
    bgBase:    '#272029', // muted grey-violet content
    bgSurface: '#5a3a6f', // saturated rose-violet toolbar
    bgPanel:   '#4a2f5c',
    bgHover:   '#6a4682', bgSelected: '#7d5396', bgActive: '#8e62a8',
    border: '#4b3a5c',
    textPrimary: '#f8e4f3', textSecondary: '#c7b1ce', textMuted: '#8a7896', textInverse: '#272029',
    accent: '#f7b2d9', accentHover: '#facce6', accentDim: 'rgba(247,178,217,.2)',
    accent2: '#b2e0d0', accent2Hover: '#c7ecdf',
    danger: '#f08080', warn: '#f7c87a', success: '#a4d8a4',
    scrollTrack: '#3a2c4a', scrollThumb: '#6a5483',
    shadow: '0 4px 24px rgba(0,0,0,.4)', shadowSm: '0 2px 8px rgba(0,0,0,.25)'
  },
  'pastel-light': {
    bgBase:    '#fffaff', // near-white content
    bgSurface: '#f5cce3', // saturated pastel pink chrome
    bgPanel:   '#fbd8ec',
    bgHover:   '#f3bdd9', bgSelected: '#eaa9c8', bgActive: '#df95b8',
    border: '#f0d5e6',
    textPrimary: '#4a2949', textSecondary: '#7c5a7a', textMuted: '#b394ac', textInverse: '#fff',
    accent: '#c896d8', accentHover: '#d6acdf', accentDim: 'rgba(200,150,216,.18)',
    accent2: '#74c2ad', accent2Hover: '#8ecfbd',
    danger: '#d56e7c', warn: '#caa358', success: '#6db380',
    scrollTrack: '#fbd8ec', scrollThumb: '#d8b3cc',
    shadow: '0 4px 24px rgba(74,41,73,.1)', shadowSm: '0 2px 8px rgba(74,41,73,.08)'
  },

  // ── Hacker — pure black content (so the green text really pops), dark-green chrome
  'hacker-dark': {
    bgBase:    '#000000', // pitch black file listing
    bgSurface: '#062611', // saturated terminal green-tinted chrome
    bgPanel:   '#041809',
    bgHover:   '#0a3315', bgSelected: '#0e431b', bgActive: '#125424',
    border: '#0e2f0a',
    textPrimary: '#00ff66', textSecondary: '#33b14a', textMuted: '#226833', textInverse: '#000000',
    accent: '#00ff66', accentHover: '#3fff8a', accentDim: 'rgba(0,255,102,.2)',
    accent2: '#ffb000', accent2Hover: '#ffcc46',
    danger: '#ff2020', warn: '#ffaf00', success: '#00ff66',
    scrollTrack: '#050505', scrollThumb: '#1f6633',
    shadow: '0 0 24px rgba(0,255,102,.25)', shadowSm: '0 0 8px rgba(0,255,102,.18)'
  },
  'hacker-light': {
    bgBase:    '#fafaee', // light cream content (terminal-on-paper)
    bgSurface: '#c5d3a8', // saturated olive chrome
    bgPanel:   '#d4debf',
    bgHover:   '#b6c995', bgSelected: '#a7bf82', bgActive: '#98b572',
    border: '#cdcc9c',
    textPrimary: '#0a2010', textSecondary: '#345e2d', textMuted: '#6a8c5a', textInverse: '#fafaee',
    accent: '#067a32', accentHover: '#15945a', accentDim: 'rgba(6,122,50,.16)',
    accent2: '#a8550a', accent2Hover: '#c66f25',
    danger: '#a51e1e', warn: '#a05f0c', success: '#067a32',
    scrollTrack: '#d4debf', scrollThumb: '#aab575',
    shadow: '0 4px 24px rgba(6,122,50,.12)', shadowSm: '0 2px 8px rgba(6,122,50,.08)'
  },

  // ── Clean — grayscale, panels slightly darker/lighter than content for distinction
  'clean-dark': {
    bgBase:    '#202020', // mid-dark gray content
    bgSurface: '#0e0e0e', // black chrome (contrasts against content)
    bgPanel:   '#161616',
    bgHover:   '#2a2a2a', bgSelected: '#383838', bgActive: '#454545',
    border: '#3a3a3a',
    textPrimary: '#f0f0f0', textSecondary: '#a0a0a0', textMuted: '#666666', textInverse: '#1a1a1a',
    accent: '#888888', accentHover: '#aaaaaa', accentDim: 'rgba(136,136,136,.2)',
    accent2: '#cccccc', accent2Hover: '#e0e0e0',
    danger: '#e05a5a', warn: '#d0a040', success: '#7ec27e',
    scrollTrack: '#252525', scrollThumb: '#4a4a4a',
    shadow: '0 4px 24px rgba(0,0,0,.5)', shadowSm: '0 2px 8px rgba(0,0,0,.35)'
  },
  'clean-light': {
    bgBase:    '#ffffff', // pure white content
    bgSurface: '#e0e0e0', // mid gray chrome (visible against white)
    bgPanel:   '#ececec',
    bgHover:   '#d4d4d4', bgSelected: '#c2c2c2', bgActive: '#b0b0b0',
    border: '#d8d8d8',
    textPrimary: '#1a1a1a', textSecondary: '#5a5a5a', textMuted: '#9c9c9c', textInverse: '#fff',
    accent: '#444444', accentHover: '#5d5d5d', accentDim: 'rgba(68,68,68,.12)',
    accent2: '#666666', accent2Hover: '#7e7e7e',
    danger: '#c92a2a', warn: '#a86a14', success: '#2c8a37',
    scrollTrack: '#ececec', scrollThumb: '#bbbbbb',
    shadow: '0 4px 24px rgba(0,0,0,.08)', shadowSm: '0 2px 8px rgba(0,0,0,.06)'
  },

  // ── High Contrast — content is neutral, chrome is the brand colour
  'contrast-dark': {
    bgBase:    '#0a0a0a', // near-black content
    bgSurface: '#000000', // pure black chrome
    bgPanel:   '#000000',
    bgHover:   '#1e1e1e', bgSelected: '#333333', bgActive: '#4a4a4a',
    border: '#ffffff',
    textPrimary: '#ffffff', textSecondary: '#e8e8e8', textMuted: '#c0c0c0', textInverse: '#000',
    accent: '#ffd400', accentHover: '#ffe040', accentDim: 'rgba(255,212,0,.28)',
    accent2: '#00b0ff', accent2Hover: '#3fc0ff',
    danger: '#ff5050', warn: '#ffb000', success: '#22dd22',
    scrollTrack: '#0a0a0a', scrollThumb: '#666666',
    shadow: '0 0 0 1px #ffffff', shadowSm: '0 0 0 1px #ffffff'
  },
  'contrast-light': {
    bgBase:    '#ffffff', // pure white content
    bgSurface: '#000000', // pure black chrome (huge contrast)
    bgPanel:   '#1a1a1a',
    bgHover:   '#2c2c2c', bgSelected: '#404040', bgActive: '#525252',
    border: '#000000',
    textPrimary: '#000000', textSecondary: '#1a1a1a', textMuted: '#404040', textInverse: '#fff',
    accent: '#0033ff', accentHover: '#1f57ff', accentDim: 'rgba(0,51,255,.18)',
    accent2: '#a00080', accent2Hover: '#c020a0',
    danger: '#c00010', warn: '#7a3000', success: '#005a18',
    scrollTrack: '#fafafa', scrollThumb: '#888888',
    shadow: '0 0 0 1px #000000', shadowSm: '0 0 0 1px #000000'
  },

  // ── Ocean — content quiet, chrome deep blue
  'ocean-dark': {
    bgBase:    '#0f1820', // very dark slate, slight blue
    bgSurface: '#143f5d', // saturated ocean blue toolbar
    bgPanel:   '#0e324a',
    bgHover:   '#1a5072', bgSelected: '#22638c', bgActive: '#2d77a4',
    border: '#1d3d57',
    textPrimary: '#e0f2f7', textSecondary: '#8db0c0', textMuted: '#587486', textInverse: '#0f1820',
    accent: '#39c5d9', accentHover: '#5cd5e5', accentDim: 'rgba(57,197,217,.2)',
    accent2: '#f7c873', accent2Hover: '#fcd58f',
    danger: '#ef6a6a', warn: '#f7c873', success: '#7ed388',
    scrollTrack: '#142a3e', scrollThumb: '#3a607e',
    shadow: '0 4px 24px rgba(0,0,0,.5)', shadowSm: '0 2px 8px rgba(0,0,0,.35)'
  },
  'ocean-light': {
    bgBase:    '#f6fafb', // off-white content
    bgSurface: '#a6d4e0', // saturated cyan chrome
    bgPanel:   '#bce0ea',
    bgHover:   '#94c8d8', bgSelected: '#7fbacc', bgActive: '#6aabbf',
    border: '#b9d4dc',
    textPrimary: '#0b1d2e', textSecondary: '#3e5f70', textMuted: '#7a98a6', textInverse: '#fff',
    accent: '#0d6986', accentHover: '#1488a8', accentDim: 'rgba(13,105,134,.15)',
    accent2: '#b07020', accent2Hover: '#c5853a',
    danger: '#c63b3b', warn: '#a06010', success: '#1d8e3a',
    scrollTrack: '#bce0ea', scrollThumb: '#92b8c5',
    shadow: '0 4px 24px rgba(11,29,46,.12)', shadowSm: '0 2px 8px rgba(11,29,46,.08)'
  },
};

let count = 0;
for (const [name, palette] of Object.entries(themes)) {
  fs.writeFileSync(path.join(OUT, name + '.css'), css(palette));
  count++;
}
console.log(`Wrote ${count} theme files to ${OUT}`);
