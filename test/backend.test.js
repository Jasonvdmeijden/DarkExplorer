/**
 * DarkExplorer backend test suite
 * Usage: node test/backend.test.js [--otp XXXXXX]
 *
 * Enroll a fresh test device, then exercise every HTTP endpoint
 * and every WebSocket message handler.
 */

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3322';
const OTP = (process.argv[process.argv.indexOf('--otp') + 1] || 'LGR8D5').trim().toUpperCase();
const TMP_DIR  = path.join(process.env.TEMP || '/tmp', 'de_test_' + Date.now());
const TMP_FILE = path.join(TMP_DIR, 'hello.txt');

let TOKEN = null;
let pass = 0, fail = 0;

// ─── helpers ────────────────────────────────────────────────────────────────

function req(method, urlPath, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, BASE);
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(TOKEN ? { 'X-Token': TOKEN } : {}),
        ...extraHeaders
      }
    };
    const r = http.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: res.statusCode, headers: res.headers, data });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

let wsConn = null;
let wsSeq  = 0;
let wsPending = {};

function wsConnect(token) {
  return new Promise((resolve, reject) => {
    wsConn = new WebSocket(`ws://localhost:3322?token=${token}`);
    wsConn.on('open', () => resolve());
    wsConn.on('error', reject);
    wsConn.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (!msg.id) return;
      const p = wsPending[msg.id];
      if (!p) return;
      delete wsPending[msg.id];
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error));
    });
    wsConn.on('close', (code) => {
      if (code === 4001) reject(new Error('WS auth rejected (4001)'));
    });
  });
}

function wsSend(type, payload) {
  return new Promise((resolve, reject) => {
    const id = String(++wsSeq);
    const timer = setTimeout(() => {
      delete wsPending[id];
      reject(new Error(`Timeout: ${type}`));
    }, 10000);
    wsPending[id] = {
      resolve: (d) => { clearTimeout(timer); resolve(d); },
      reject:  (e) => { clearTimeout(timer); reject(e); }
    };
    wsConn.send(JSON.stringify({ id, type, payload: payload || {} }));
  });
}

function assert(label, ok, extra) {
  if (ok) {
    console.log(`  ✓  ${label}`);
    pass++;
  } else {
    console.log(`  ✗  ${label}${extra ? ' — ' + extra : ''}`);
    fail++;
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ─── test groups ────────────────────────────────────────────────────────────

async function testHTTP() {
  section('HTTP — static pages');

  let r = await req('GET', '/enroll');
  assert('GET /enroll → 200 HTML', r.status === 200 && r.data.includes('DarkExplorer'));

  r = await req('GET', '/');
  assert('GET / → 200 (index.html)', r.status === 200);

  section('HTTP — enrollment');

  r = await req('POST', '/enroll', { code: 'BADOTP', label: 'test' });
  assert('POST /enroll bad OTP → 401', r.status === 401);
  assert('POST /enroll bad OTP has error field', typeof r.data.error === 'string');

  r = await req('POST', '/enroll', { code: OTP, label: 'test-device' });
  assert('POST /enroll valid OTP → 200', r.status === 200);
  assert('POST /enroll returns token', typeof r.data.token === 'string' && r.data.token.length > 0);
  TOKEN = r.data.token;
  const cookieSet = r.headers['set-cookie']?.[0] || '';
  assert('POST /enroll sets de_token cookie', cookieSet.includes('de_token='));

  section('HTTP — admin (localhost)');

  r = await req('GET', '/admin/gen-otp');
  assert('GET /admin/gen-otp → 200 with code', r.status === 200 && typeof r.data.code === 'string');

  r = await req('GET', '/admin/devices');
  assert('GET /admin/devices → 200 array', r.status === 200 && Array.isArray(r.data));
  assert('GET /admin/devices has test device', r.data.some(d => d.label === 'test-device'));

  section('HTTP — auth guard');

  const savedToken = TOKEN;
  TOKEN = null;
  r = await req('GET', '/download?path=C:/Windows/System32/drivers/etc/hosts');
  assert('GET /download without token → 401', r.status === 401);
  TOKEN = savedToken;

  r = await req('GET', '/download?path=C:/Windows/System32/drivers/etc/hosts');
  assert('GET /download with token → 200 or file response', r.status === 200 || r.status === 400);

  section('HTTP — thumbnail');
  // use a real file that exists
  r = await req('GET', '/thumbnail?path=' + encodeURIComponent('C:\\Windows\\System32\\drivers\\etc\\hosts') + '&width=100');
  assert('GET /thumbnail text file → 204 (no thumb) or 200', r.status === 204 || r.status === 200);
}

async function testWS() {
  section('WebSocket — connection & auth');

  // bad token
  await new Promise((resolve) => {
    const badWs = new WebSocket('ws://localhost:3322?token=badtoken');
    badWs.on('close', (code) => {
      assert('WS bad token closes with 4001', code === 4001);
      resolve();
    });
    badWs.on('error', () => resolve());
  });

  await wsConnect(TOKEN);
  assert('WS good token connects', true);

  section('WebSocket — fs:roots & fs:list');

  let roots = await wsSend('fs:roots', {});
  assert('fs:roots returns array', Array.isArray(roots));
  assert('fs:roots contains C:\\', roots.some(r => r.path && r.path.startsWith('C')));

  let items = await wsSend('fs:list', {});
  assert('fs:list (no path) returns drive roots', Array.isArray(items) && items.length > 0);
  assert('fs:list root items are dirs', items.every(i => i.isDir));

  items = await wsSend('fs:list', { path: 'C:\\Windows' });
  assert('fs:list C:\\Windows returns entries', Array.isArray(items) && items.length > 0);
  assert('fs:list entries have name/path/isDir', items[0] && 'name' in items[0] && 'path' in items[0] && 'isDir' in items[0]);

  section('WebSocket — fs:stat');

  const statResult = await wsSend('fs:stat', { path: 'C:\\Windows' });
  assert('fs:stat returns dir info', statResult && statResult.isDir === true);
  assert('fs:stat has mtime', typeof statResult.mtime === 'number');

  section('WebSocket — fs:mkdir / fs:write / fs:read / fs:rename / fs:delete');

  fs.mkdirSync(path.dirname(TMP_DIR), { recursive: true });

  await wsSend('fs:mkdir', { path: TMP_DIR });
  assert('fs:mkdir creates directory', fs.existsSync(TMP_DIR));

  await wsSend('fs:write', { path: TMP_FILE, content: 'Hello DarkExplorer!' });
  assert('fs:write creates file', fs.existsSync(TMP_FILE));
  assert('fs:write correct content', fs.readFileSync(TMP_FILE, 'utf8') === 'Hello DarkExplorer!');

  const readResult = await wsSend('fs:read', { path: TMP_FILE });
  assert('fs:read returns content', readResult.content === 'Hello DarkExplorer!');

  const renamedFile = path.join(TMP_DIR, 'renamed.txt');
  const renameResult = await wsSend('fs:rename', { path: TMP_FILE, name: 'renamed.txt' });
  assert('fs:rename returns new path', renameResult.path && renameResult.path.endsWith('renamed.txt'));
  assert('fs:rename file exists at new path', fs.existsSync(renamedFile));

  section('WebSocket — fs:copy / fs:move');

  const copyDir  = path.join(TMP_DIR, 'copydir');
  const copiedFile = path.join(copyDir, 'renamed.txt');
  await wsSend('fs:mkdir', { path: copyDir });
  await wsSend('fs:copy', { sources: [renamedFile], dest: copyDir });
  assert('fs:copy copied file exists at dest', fs.existsSync(copiedFile));
  assert('fs:copy source still exists', fs.existsSync(renamedFile));

  const moveDir = path.join(TMP_DIR, 'movedir');
  await wsSend('fs:mkdir', { path: moveDir });
  const movedFile = path.join(moveDir, 'renamed.txt');
  await wsSend('fs:move', { sources: [renamedFile], dest: moveDir });
  assert('fs:move dest exists', fs.existsSync(movedFile));
  assert('fs:move source gone', !fs.existsSync(renamedFile));

  // cleanup
  await wsSend('fs:delete', { paths: [TMP_DIR] });
  assert('fs:delete removes directory', !fs.existsSync(TMP_DIR));

  section('WebSocket — clipboard');

  await wsSend('clipboard:set', { paths: ['C:\\test\\a', 'C:\\test\\b'], op: 'copy' });
  const clip = await wsSend('clipboard:get', {});
  assert('clipboard:set/get round-trip', Array.isArray(clip.paths) && clip.paths.length === 2 && clip.op === 'copy');

  await wsSend('clipboard:clear', {});
  const clipCleared = await wsSend('clipboard:get', {});
  assert('clipboard:clear empties buffer', clipCleared.paths.length === 0);

  section('WebSocket — bookmarks');

  await wsSend('bookmark:add', { path: 'C:\\Windows', label: 'Test bookmark' });
  const bookmarks = await wsSend('bookmark:list', {});
  assert('bookmark:add + bookmark:list', Array.isArray(bookmarks) && bookmarks.some(b => b.path === 'C:\\Windows'));

  const bmId = bookmarks.find(b => b.path === 'C:\\Windows').id;
  await wsSend('bookmark:remove', { id: bmId });
  const afterRemove = await wsSend('bookmark:list', {});
  assert('bookmark:remove removes it', !afterRemove.some(b => b.id === bmId));

  section('WebSocket — search (filename)');

  const searchResult = await wsSend('search:filename', { query: 'hosts', limit: 5 });
  // the watcher may not have indexed everything yet — just check shape
  assert('search:filename returns results object', searchResult && 'results' in searchResult);

  section('WebSocket — terminal');

  const termResult = await wsSend('terminal:create', { cwd: 'C:\\', cols: 80, rows: 24 });
  assert('terminal:create returns sid', typeof termResult.sid === 'string');
  const sid = termResult.sid;

  // give it a moment then destroy
  await new Promise(r => setTimeout(r, 500));
  const destroyResult = await wsSend('terminal:destroy', { sid });
  assert('terminal:destroy returns ok', destroyResult && destroyResult.ok === true);

  section('WebSocket — unknown type');

  try {
    await wsSend('unknown:type', {});
    assert('unknown type rejects', false, 'expected rejection');
  } catch (e) {
    assert('unknown type returns error', e.message.includes('Unknown'));
  }

  wsConn.close();
}

async function testAdminRevoke() {
  section('HTTP — admin device revoke');

  let r = await req('GET', '/admin/devices');
  const testDevice = r.data.find(d => d.label === 'test-device');
  if (!testDevice) {
    assert('find test-device for revoke', false, 'not found in device list');
    return;
  }
  r = await req('DELETE', `/admin/devices/${testDevice.id}`);
  assert('DELETE /admin/devices/:id → 200', r.status === 200 && r.data.ok === true);

  // token should now be invalid
  r = await req('GET', '/download?path=C:/anything');
  assert('revoked token rejected by API', r.status === 401);
}

// ─── main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('DarkExplorer Backend Test Suite');
  console.log('================================');
  console.log(`Target: ${BASE}   OTP: ${OTP}\n`);

  try {
    await testHTTP();
    await testWS();
    await testAdminRevoke();
  } catch (e) {
    console.error('\nFATAL:', e.message);
    fail++;
  } finally {
    if (wsConn && wsConn.readyState === WebSocket.OPEN) wsConn.close();
    // ensure cleanup
    if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }

  console.log(`\n================================`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
