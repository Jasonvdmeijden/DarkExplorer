// server/tls.js
// Provides credentials for the optional HTTPS listener. Cert source is
// pluggable: if a cert/key already exist (a real Let's Encrypt / Cloudflare
// cert dropped in, or a self-signed one from a previous boot) they are used
// as-is; otherwise a self-signed pair is generated and cached under data/tls.
const fs = require('fs');
const path = require('path');

async function loadOrCreate(config) {
  const tls = (config && config.tls) || {};
  const dir = path.join(__dirname, '..', 'data', 'tls');
  const certPath = tls.certPath || path.join(dir, 'cert.pem');
  const keyPath  = tls.keyPath  || path.join(dir, 'key.pem');

  try {
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath), selfSigned: false };
    }
  } catch { /* fall through to generation */ }

  let selfsigned;
  try { selfsigned = require('selfsigned'); }
  catch { console.warn('[tls] "selfsigned" not installed — HTTPS disabled'); return null; }

  try {
    const pems = await selfsigned.generate(
      [{ name: 'commonName', value: 'darkexplorer.local' }],
      {
        days: 3650, keySize: 2048, algorithm: 'sha256',
        extensions: [
          { name: 'basicConstraints', cA: true },
          { name: 'subjectAltName', altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
          ] },
        ],
      });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(certPath, pems.cert);
    fs.writeFileSync(keyPath, pems.private);
    return { cert: pems.cert, key: pems.private, selfSigned: true };
  } catch (e) {
    console.warn('[tls] failed to generate self-signed cert:', e.message);
    return null;
  }
}

module.exports = { loadOrCreate };
