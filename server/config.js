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
    windows: 'cmd.exe',
    linux: '/bin/bash',
    mac: '/bin/zsh'
  },
  search: {
    maxFileSizeBytes: 524288,
    exclusions: [
      'node_modules', '.git', 'dist', 'build', '__pycache__', '*.min.js', '*.min.css',
      'Library', 'Applications', 'System', 'Volumes', '.Trash', 'Developer'
    ]
  },
  thumbnails: {
    rowHeight: 200,
    maxWidth: 400
  },
  // Optional HTTPS listener. Needed for secure-context-only browser features
  // (e.g. the remote-control air-mouse) when not on localhost. certPath/keyPath
  // may point at a real cert; if null a self-signed pair is generated.
  tls: {
    enabled: true,
    port: 3443,
    certPath: null,
    keyPath: null
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
