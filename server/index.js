const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const url = require('url');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const config  = require('./config');
const auth    = require('./auth');
const files   = require('./files');
const search  = require('./search');
const thumbs  = require('./thumbnails');
const term    = require('./terminal');
const upload  = require('./upload');

// --- CLI: generate OTP ---
if (process.argv.includes('--gen-otp')) {
  const code = auth.generateOtp();
  console.log(`\nDarkExplorer OTP: ${code}\nExpires in 1 hour.\n`);
  process.exit(0);
}

// --- Express app ---
const app = express();
app.use(express.json());

// CORS
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

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Auth middleware for API routes
function requireAuth(req, res, next) {
  const token = req.headers['x-token'] || req.query.token;
  const device = auth.validateToken(token);
  if (!device) return res.status(401).json({ error: 'Unauthorised' });
  req.device = device;
  next();
}

// Admin: generate OTP (localhost only)
app.get('/admin/gen-otp', (req, res) => {
  if (!isLocalhost(req)) return res.status(403).json({ error: 'Forbidden' });
  const code = auth.generateOtp();
  res.json({ code, expiresIn: '1 hour' });
});

// Admin: list devices
app.get('/admin/devices', (req, res) => {
  if (!isLocalhost(req)) return res.status(403).json({ error: 'Forbidden' });
  res.json(auth.listDevices());
});

// Admin: revoke device
app.delete('/admin/devices/:id', (req, res) => {
  if (!isLocalhost(req)) return res.status(403).json({ error: 'Forbidden' });
  auth.revokeDevice(req.params.id);
  res.json({ ok: true });
});

// File upload
app.post('/upload', requireAuth, upload.array('files'), (req, res) => {
  res.json({ ok: true, count: req.files.length });
});

// File download
app.get('/download', requireAuth, async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  try {
    const stat = await files.stat(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(stat.name)}"`);
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// Thumbnail
app.get('/thumbnail', requireAuth, async (req, res) => {
  const filePath = req.query.path;
  const width = parseInt(req.query.width) || 300;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  const thumbPath = await thumbs.get(filePath, width);
  if (!thumbPath) return res.status(204).end();
  res.sendFile(thumbPath);
});

// Enroll page redirect
app.get('/enroll', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'enroll.html'));
});

// --- HTTP + WS server ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const params = new url.URL(req.url, `http://localhost`).searchParams;
  const token  = params.get('token');
  const device = auth.validateToken(token);

  if (!device) {
    ws.close(4001, 'Unauthorised');
    return;
  }

  ws.deviceId = device.id;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { id, type, payload } = msg;
    const reply = (data, error) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id, type, ok: !error, data, error }));
      }
    };

    try {
      await handle(type, payload, reply, ws, device);
    } catch (err) {
      reply(null, err.message);
    }
  });

  ws.on('close', () => {
    // clean up terminal sessions owned by this socket
    for (const [sid, s] of ws._termSessions || []) {
      term.destroy(sid);
    }
  });
});

const serverClipboard = new Map(); // deviceId -> [paths]

async function handle(type, payload, reply, ws, device) {
  switch (type) {

    // --- auth ---
    case 'auth:enroll': {
      const result = auth.enrollDevice(payload.code, payload.label);
      reply(result.ok ? { token: result.token } : null, result.error);
      break;
    }

    // --- filesystem ---
    case 'fs:list': {
      const items = payload.path ? await files.list(payload.path) : files.roots().map(r => ({
        name: r, path: r, isDir: true, size: 0, mtime: 0, ctime: 0, ext: null, mime: null
      }));
      reply(items);
      break;
    }
    case 'fs:stat':   reply(await files.stat(payload.path));   break;
    case 'fs:read':   reply({ content: await files.read(payload.path) }); break;
    case 'fs:write':  await files.write(payload.path, payload.content); reply({ ok: true }); break;
    case 'fs:mkdir':  await files.mkdir(payload.path); reply({ ok: true }); break;
    case 'fs:delete': await files.remove(payload.paths); reply({ ok: true }); break;
    case 'fs:copy':   await files.copy(payload.sources, payload.dest); reply({ ok: true }); break;
    case 'fs:move':   await files.move(payload.sources, payload.dest); reply({ ok: true }); break;
    case 'fs:rename': reply({ path: await files.rename(payload.path, payload.name) }); break;

    case 'fs:roots': reply(files.roots().map(r => ({ name: r, path: r, isDir: true }))); break;

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
      const bid = uuidv4();
      db.prepare('INSERT INTO bookmarks (id, path, label, device_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(bid, payload.path, payload.label || path.basename(payload.path), device.id, Date.now());
      reply({ id: bid });
      break;
    }
    case 'bookmark:remove': {
      const db = require('./db');
      db.prepare('DELETE FROM bookmarks WHERE id = ? AND device_id = ?').run(payload.id, device.id);
      reply({ ok: true });
      break;
    }

    // --- terminal ---
    case 'terminal:create': {
      const sid = uuidv4();
      if (!ws._termSessions) ws._termSessions = new Map();
      term.create(sid, {
        cwd:   payload.cwd || os.homedir(),
        shell: payload.shell,
        cols:  payload.cols || 80,
        rows:  payload.rows || 24,
        onData: (data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'terminal:data', data: { sid, data } }));
          }
        },
        onExit: (code) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'terminal:exit', data: { sid, code } }));
          }
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
    case 'terminal:switch': {
      term.destroy(payload.sid);
      ws._termSessions?.delete(payload.sid);
      // client should follow up with terminal:create using the new shell
      reply({ ok: true });
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

// --- Start ---
const PORT = config.port;
server.listen(PORT, () => {
  console.log(`DarkExplorer running on http://localhost:${PORT}`);
  search.startWatcher();
});
