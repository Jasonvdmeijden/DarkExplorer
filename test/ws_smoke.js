// Quick WS smoke test — verifies new endpoints work on the host platform
const WS = require('ws');
const path = require('path');
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
    const tags = await call('fs:list-tags', {});
    console.log('fs:list-tags    ->', tags.ok ? 'OK n=' + (tags.data?.length || 0) : 'FAIL ' + tags.error);

    const stats = await call('stats:get', {});
    console.log('stats:get       ->', stats.ok ? `OK cpu=${stats.data?.cpu}% disk=${stats.data?.disk?.mbps}MB/s net=${stats.data?.net?.mbps}Mbps` : 'FAIL ' + stats.error);

    const ls = await call('fs:list', { path: 'C:\\' });
    console.log('fs:list C:\\    ->', ls.ok ? 'OK n=' + (ls.data?.length || 0) : 'FAIL ' + ls.error);

    const t = await call('terminal:create', { cwd: 'C:\\', cols: 80, rows: 24 });
    console.log('terminal:create ->', t.ok ? 'OK sid=' + (t.data?.sid?.slice(0,8) || '?') : 'FAIL ' + t.error);

    if (t.data?.sid) {
      // terminal:input is fire-and-forget (server doesn't reply); send raw without await
      ws.send(JSON.stringify({ id: 9999, type: 'terminal:input', payload: { sid: t.data.sid, data: 'echo hello\r' } }));
      await new Promise(r => setTimeout(r, 500));
      const verify = await call('terminal:verify', { sid: t.data.sid });
      console.log('terminal:verify ->', verify.ok && verify.data?.alive ? 'OK alive' : 'FAIL not alive');
      const d = await call('terminal:destroy', { sid: t.data.sid });
      console.log('terminal:destroy->', d.ok ? 'OK' : 'FAIL ' + d.error);
    }

    const search = await call('search:filename', { query: 'package.json', limit: 5 });
    console.log('search:filename ->', search.ok ? 'OK n=' + (search.data?.results?.length || 0) : 'FAIL ' + search.error);
  } catch (e) { console.log('ERROR:', e.message); }
  ws.close(); process.exit(0);
});
ws.on('error', e => { console.log('WS error:', e.message); process.exit(1); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 8000);
