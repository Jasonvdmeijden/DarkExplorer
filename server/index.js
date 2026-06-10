const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const url = require('url');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

process.on('uncaughtException',  (err) => console.error('[uncaughtException]', err.stack || err.message));
process.on('unhandledRejection', (r)   => console.error('[unhandledRejection]', r instanceof Error ? r.stack : r));

const config   = require('./config');
const auth     = require('./auth');
const files    = require('./files');
const search   = require('./search');
const thumbs   = require('./thumbnails');
const term     = require('./terminal');
const upload   = require('./upload');
const zipOps   = require('./zip');
const gitOps   = require('./git');
const sysStats = require('./stats');

if (process.argv.includes('--gen-otp')) {
  const code = auth.generateOtp();
  console.log(`\nDarkExplorer OTP: ${code}\nExpires in 1 hour.\n`);
  process.exit(0);
}

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || config.origins.includes(origin) || isLocalhost(req)) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Token');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.split('=');
    if (k.trim() === name) return decodeURIComponent(v.join('=').trim());
  }
  return null;
}

app.post('/enroll', express.json(), (req, res) => {
  const { code, label } = req.body || {};
  const result = auth.enrollDevice(code, label);
  if (!result.ok) return res.status(401).json({ error: result.error });
  res.setHeader('Set-Cookie', `de_token=${result.token}; Path=/; SameSite=Strict; Max-Age=31536000`);
  res.json({ token: result.token });
});

function requireAuth(req, res, next) {
  const token = req.headers['x-token'] || req.query.token || getCookie(req, 'de_token');
  const device = auth.validateToken(token);
  if (!device) return res.status(401).json({ error: 'Unauthorised' });
  req.device = device;
  next();
}

app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(js|css|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-store');
  }
}));

app.get('/admin/gen-otp', (req, res) => {
  if (!isLocalhost(req)) return res.status(403).json({ error: 'Forbidden' });
  res.json({ code: auth.generateOtp(), expiresIn: '1 hour' });
});
app.get('/admin/devices', (req, res) => {
  if (!isLocalhost(req)) return res.status(403).json({ error: 'Forbidden' });
  res.json(auth.listDevices());
});
app.delete('/admin/devices/:id', (req, res) => {
  if (!isLocalhost(req)) return res.status(403).json({ error: 'Forbidden' });
  auth.revokeDevice(req.params.id);
  res.json({ ok: true });
});

app.post('/upload', requireAuth, upload.array('files'), (req, res) => {
  res.json({ ok: true, count: req.files.length });
});

app.get('/download', requireAuth, async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  try {
    const stat = await files.stat(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(stat.name)}"`);
    res.sendFile(filePath);
  } catch { res.status(404).json({ error: 'Not found' }); }
});

app.get('/serve', requireAuth, async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  try {
    const stat = await files.stat(filePath);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(stat.name)}"`);
    if (stat.name.toLowerCase().endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
    }
    res.sendFile(filePath);
  } catch { res.status(404).json({ error: 'Not found' }); }
});

app.get('/thumbnail', requireAuth, async (req, res) => {
  const filePath = req.query.path;
  const width = parseInt(req.query.width) || 300;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  try {
    const thumbPath = await thumbs.get(filePath, width);
    if (!thumbPath) return res.status(204).end();
    res.sendFile(thumbPath);
  } catch { res.status(204).end(); }
});

app.get('/zip-download', requireAuth, async (req, res) => {
  try {
    const paths = JSON.parse(req.query.paths);
    const name  = req.query.name || 'archive.zip';
    const buf   = await zipOps.createZipBuffer(paths);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.end(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/enroll', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'enroll.html'));
});

// --- HTTP + WS server ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcast(msg, exceptWs) {
  wss.clients.forEach(c => {
    if (c !== exceptWs && c.readyState === WebSocket.OPEN) c.send(msg);
  });
}
function broadcastAll(msg) {
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

wss.on('connection', (ws, req) => {
  const params = new url.URL(req.url, 'http://localhost').searchParams;
  const token  = params.get('token');
  const device = auth.validateToken(token);

  if (!device) { ws.close(4001, 'Unauthorised'); return; }
  ws.deviceId = device.id;

  try {
    const db = require('./db');
    const rows = db.prepare('SELECT key, value FROM workspace_state').all();
    const stateMap = {};
    rows.forEach(r => { stateMap[r.key] = r.value; });
    ws.send(JSON.stringify({ type: 'state:full', data: stateMap }));
  } catch {}

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { id, type, payload } = msg;

    const reply = (data, error) => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ id, type, ok: !error, data, error }));
    };
    try { await handle(type, payload, reply, ws, device); }
    catch (err) { reply(null, err.message); }
  });

  ws.on('close', () => {
    for (const [sid] of ws._termSessions || []) term.destroy(sid);
  });
});

const serverClipboard = new Map();

async function handle(type, payload, reply, ws, device) {
  switch (type) {

    // --- filesystem ---
    case 'fs:list': {
      const items = payload.path ? await files.list(payload.path) : files.roots().map(r => ({
        name: r, path: r, isDir: true, size: 0, mtime: 0, ctime: 0, ext: null, mime: null
      }));
      reply(items);
      break;
    }
    case 'fs:folder-size': reply({ size: await files.folderSize(payload.path) }); break;
    case 'fs:stat':       reply(await files.stat(payload.path)); break;
    case 'fs:read':       reply({ content: await files.read(payload.path) }); break;
    case 'fs:readBase64': reply({ content: await files.readBinary(payload.path) }); break;
    case 'fs:write':  await files.write(payload.path, payload.content); reply({ ok: true }); break;
    case 'fs:mkdir':  await files.mkdir(payload.path); reply({ ok: true }); break;
    case 'fs:delete': await files.remove(payload.paths); reply({ ok: true }); break;
    case 'fs:copy':   await files.copy(payload.sources, payload.dest); reply({ ok: true }); break;
    case 'fs:move':   await files.move(payload.sources, payload.dest); reply({ ok: true }); break;
    case 'fs:rename': reply({ path: await files.rename(payload.path, payload.name) }); break;
    case 'fs:duplicate': reply({ path: await files.duplicate(payload.path) }); break;
    case 'fs:set-tag':  reply(files.setTag(payload.path, payload.color, payload.label)); broadcastAll(JSON.stringify({ type: 'tags:update', data: { path: payload.path, color: payload.color, label: payload.label } })); break;
    case 'fs:get-tags':  reply(files.getTags(payload.paths)); break;
    case 'fs:list-tags': reply(files.listTags()); break;
    case 'fs:roots':  reply(files.roots().map(r => ({ name: r, path: r, isDir: true }))); break;

    case 'fs:exec': {
      const { spawn } = require('child_process');
      const fp = payload.path;
      let cmd, args, opts;
      if (process.platform === 'win32') {
        cmd = 'cmd'; args = ['/c', 'start', '', fp];
        opts = { cwd: path.dirname(fp), detached: true, stdio: 'ignore', shell: false };
      } else if (process.platform === 'darwin') {
        cmd = 'open'; args = [fp]; opts = { detached: true, stdio: 'ignore' };
      } else {
        cmd = 'xdg-open'; args = [fp]; opts = { detached: true, stdio: 'ignore' };
      }
      try { const p = spawn(cmd, args, opts); p.unref(); reply({ ok: true }); }
      catch (e) { reply({ ok: false, error: e.message }); }
      break;
    }

    // --- search ---
    case 'search:filename': reply({ results: search.searchFilename(payload.query, payload.limit) }); break;
    case 'search:content':  reply(await search.searchContent(payload)); break;

    // --- clipboard ---
    case 'clipboard:set':   serverClipboard.set(device.id, { paths: payload.paths, op: payload.op }); reply({ ok: true }); break;
    case 'clipboard:get':   reply(serverClipboard.get(device.id) || { paths: [], op: null }); break;
    case 'clipboard:clear': serverClipboard.delete(device.id); reply({ ok: true }); break;

    // --- bookmarks ---
    case 'bookmark:list': {
      const db = require('./db');
      reply(db.prepare('SELECT * FROM bookmarks WHERE device_id = ?').all(device.id));
      break;
    }
    case 'bookmark:add': {
      const db = require('./db');
      const bid   = uuidv4();
      const label = payload.label
        || (payload.url ? payload.url : (payload.path ? path.basename(payload.path) : 'Bookmark'));
      db.prepare('INSERT INTO bookmarks (id, path, url, label, device_id, created_at) VALUES (?,?,?,?,?,?)')
        .run(bid, payload.path || null, payload.url || null, label, device.id, Date.now());
      reply({ id: bid });
      break;
    }
    case 'bookmark:remove': {
      const db = require('./db');
      db.prepare('DELETE FROM bookmarks WHERE id = ? AND device_id = ?').run(payload.id, device.id);
      reply({ ok: true });
      break;
    }

    // --- terminal --- (data is broadcast to ALL clients so all devices share sessions)
    case 'terminal:create': {
      const sid = uuidv4();
      if (!ws._termSessions) ws._termSessions = new Map();
      term.create(sid, {
        cwd:  payload.cwd || os.homedir(),
        shell: payload.shell,
        cols:  payload.cols || 80,
        rows:  payload.rows || 24,
        onData: (data) => {
          broadcastAll(JSON.stringify({ type: 'terminal:data', data: { sid, data } }));
        },
        onExit: (code) => {
          broadcastAll(JSON.stringify({ type: 'terminal:exit', data: { sid, code } }));
          ws._termSessions?.delete(sid);
        }
      });
      ws._termSessions.set(sid, true);
      reply({ sid });
      break;
    }
    case 'terminal:input':   term.input(payload.sid, payload.data); break;
    case 'terminal:resize':  term.resize(payload.sid, payload.cols, payload.rows); break;
    case 'terminal:destroy': term.destroy(payload.sid); ws._termSessions?.delete(payload.sid); reply({ ok: true }); break;
    case 'terminal:switch':  term.destroy(payload.sid); ws._termSessions?.delete(payload.sid); reply({ ok: true }); break;
    case 'terminal:verify':  reply({ alive: term.isAlive(payload.sid) }); break;

    // --- zip ---
    case 'zip:preview': reply({ entries: zipOps.previewZip(payload.path) }); break;
    case 'zip:extract': await zipOps.extractZip(payload.path, payload.dest); reply({ ok: true }); break;
    case 'zip:create':  reply({ outputPath: await zipOps.createZip(payload.paths, payload.outputPath) }); break;

    // --- git ---
    case 'git:is-repo':       reply({ isRepo: gitOps.isRepo(payload.cwd), root: gitOps.repoRoot(payload.cwd) }); break;
    case 'git:status':        reply(gitOps.status(payload.cwd)); break;
    case 'git:log':           reply({ commits: gitOps.log(payload.cwd, payload.n || 5) }); break;
    case 'git:branches':      reply({ branches: gitOps.branches(payload.cwd), current: gitOps.currentBranch(payload.cwd) }); break;
    case 'git:diff':          reply({ diff: gitOps.diff(payload.cwd, payload.file, payload.staged || false) }); break;
    case 'git:stage':         gitOps.stage(payload.cwd, payload.files); reply({ ok: true }); break;
    case 'git:unstage':       gitOps.unstage(payload.cwd, payload.files); reply({ ok: true }); break;
    case 'git:revert':        gitOps.revert(payload.cwd, payload.files); reply({ ok: true }); break;
    case 'git:commit':        gitOps.commit(payload.cwd, payload.message); reply({ ok: true }); break;
    case 'git:checkout':      gitOps.checkout(payload.cwd, payload.branch); reply({ ok: true }); break;
    case 'git:create-branch': gitOps.createBranch(payload.cwd, payload.name); reply({ ok: true }); break;

    // --- stats ---
    case 'stats:get': sysStats.getStats().then(reply).catch(() => reply({})); break;

    // --- workspace state ---
    case 'state:set': {
      const { key, value } = payload;
      const db = require('./db');
      db.prepare('INSERT OR REPLACE INTO workspace_state (key, value, updated_at) VALUES (?, ?, ?)')
        .run(key, value, Date.now());
      reply({ ok: true });
      broadcast(JSON.stringify({ type: 'state:push', data: { key, value } }), ws);
      break;
    }

    default:
      reply(null, `Unknown message type: ${type}`);
  }
}

function isLocalhost(req) {
  const ip = req.socket.remoteAddress;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

const PORT = config.port;
server.listen(PORT, () => {
  console.log(`DarkExplorer running on http://localhost:${PORT}`);
  search.startWatcher();

  // Push system stats to all clients every 3 seconds
  setInterval(async () => {
    const data = await sysStats.getStats();
    broadcastAll(JSON.stringify({ type: 'stats:push', data }));
  }, 3000);
});
