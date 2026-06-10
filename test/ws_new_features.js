// Exercise the new endpoints: large-file gate, security info, share lifecycle
const WS = require('ws');
const path = require('path');
const http = require('http');
const db = require(path.join(__dirname, '..', 'server', 'db'));

const dev = db.prepare('SELECT token FROM devices LIMIT 1').get();
if (!dev) { console.log('No enrolled device — skip'); process.exit(0); }

const ws = new WS('ws://localhost:3322?token=' + dev.token);
let nextId = 1;
const pending = {};
ws.on('message', raw => {
  const m = JSON.parse(raw);
  if (pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
});
const call = (type, payload) => new Promise(r => {
  const id = nextId++; pending[id] = r;
  ws.send(JSON.stringify({ id, type, payload }));
});

ws.on('open', async () => {
  console.log('WS connected');
  try {
    // Security info on a known file
    const sec = await call('fs:security', { path: __filename });
    console.log('fs:security     ->', sec.ok ? `OK platform=${sec.data?.platform} owner=${sec.data?.owner?.name}` : 'FAIL ' + sec.error);

    // Create a share for this test file
    const created = await call('share:create', { path: __filename, expiresAt: Date.now() + 60000 });
    console.log('share:create    ->', created.ok ? `OK token=${created.data?.token?.slice(0,8)}…` : 'FAIL ' + created.error);
    const token = created.data?.token;

    // List shares for this path
    const list = await call('share:list', { path: __filename });
    console.log('share:list      ->', list.ok ? 'OK n=' + (list.data?.items?.length || 0) : 'FAIL ' + list.error);

    // Hit the public share URL via HTTP (no auth)
    if (token) {
      await new Promise(resolve => {
        const req = http.get(`http://localhost:3322/share/${token}`, (res) => {
          let bytes = 0;
          res.on('data', d => bytes += d.length);
          res.on('end', () => {
            console.log(`/share/:token   -> HTTP ${res.statusCode} bytes=${bytes}`);
            resolve();
          });
        });
        req.on('error', e => { console.log('/share/:token   -> FAIL ' + e.message); resolve(); });
      });
    }

    // Revoke
    if (created.data?.id) {
      const rev = await call('share:revoke', { id: created.data.id });
      console.log('share:revoke    ->', rev.ok ? 'OK' : 'FAIL ' + rev.error);
    }

    // Try a large file read — should return tooLarge. Use a synthetic test: package-lock.json may be small,
    // so skip if not big enough.
    const big = await call('fs:read', { path: path.join(__dirname, '..', 'package-lock.json') });
    if (big.ok) {
      const d = big.data;
      const tag = d.tooLarge ? 'tooLarge' : d.truncated ? 'truncated' : 'full';
      console.log(`fs:read big     -> OK [${tag}] size=${d.size || (d.content || '').length}`);
    } else {
      console.log('fs:read big     -> FAIL ' + big.error);
    }
  } catch (e) { console.log('ERROR:', e.message); }
  ws.close(); process.exit(0);
});
ws.on('error', e => { console.log('WS error:', e.message); process.exit(1); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 10000);
