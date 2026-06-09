const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  port: 3322,
  origins: [
    'http://explorer.somevault.co.za',
    'http://192.168.88.253:3322',
    'http://localhost:3322'
  ],
  shell: {
    windows: 'cmd',
    linux: 'bash',
    mac: 'zsh'
  },
  search: {
    maxFileSizeBytes: 524288,
    exclusions: ['node_modules', '.git', 'dist', 'build', '__pycache__', '*.min.js', '*.min.css']
  },
  thumbnails: {
    rowHeight: 200,
    maxWidth: 400
  },
  theme: 'dark'
};

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (override[key] !== null && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = deepMerge(base[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function load() {
  const configPath = path.join(__dirname, '..', 'config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    return { ...DEFAULTS };
  }
}

module.exports = load();
