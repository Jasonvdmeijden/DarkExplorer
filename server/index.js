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
const disk     = require('./disk');
const thumbs   = require('./thumbnails');
const term     = require('./terminal');
const upload   = require('./upload');
const zipOps   = require('./zip');
const gitOps   = require('./git');
const sysStats = require('./stats');
const shares   = require('./shares');
const security = require('./security');
const robot    = require('./robot');
const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');

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
  res.json({ token: result.token, deviceId: result.deviceId });
});

function requireAuth(req, res, next) {
  const token = req.headers['x-token'] || req.query.token || getCookie(req, 'de_token');
  const device = auth.validateToken(token);
  if (!device) return res.status(401).json({ error: 'Unauthorised' });
  req.device = device;
  next();
}

const streamRouter = require('./stream');
app.use('/stream', requireAuth, streamRouter);

const webPreviewRouter = require('./web-preview');
app.use('/web-preview', requireAuth, webPreviewRouter);

// Reverse-proxies the Moonlight Web Stream engine (normally on its own port 8080) through
// DarkExplorer's own port, so it's reachable through whatever tunnel/VPN/NAT path already
// gets clients to DarkExplorer itself, without needing a second port forwarded separately.
const moonlightProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:8080',
  changeOrigin: true,
  ws: true,
  pathFilter: (pathname) => {
    return pathname.startsWith('/moonlight-proxy') ||
           pathname.startsWith('/authenticate') ||
           pathname.startsWith('/api') ||
           pathname.startsWith('/config') ||
           pathname.startsWith('/pin') ||
           pathname.startsWith('/serverinfo');
  },
  pathRewrite: { '^/moonlight-proxy': '' },
  on: { proxyReq: fixRequestBody }
});
app.use(moonlightProxy);

app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(js|css|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-store');
  }
}));

app.get('/admin/gen-otp', (req, res) => {
  if (!isLocalhost(req)) return res.status(403).json({ error: 'Forbidden' });
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  res.json({ code: auth.generateOtp(req.query.device_id || null), expiresIn: '1 hour', ips });
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
app.put('/admin/devices/:id', express.json(), (req, res) => {
  if (!isLocalhost(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.body.label) auth.renameDevice(req.params.id, req.body.label);
  res.json({ ok: true });
});

app.post('/upload', requireAuth, upload.array('files'), (req, res) => {
  for (const f of req.files) disk.notifyChange(path.join(req.query.path, f.filename));
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

const AUDIO_MIME = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg',  opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac'
};
const VIDEO_MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', '3gp': 'video/3gpp', ogv: 'video/ogg',
  flv: 'video/x-flv', f4v: 'video/x-f4v', wmv: 'video/x-ms-wmv', ts: 'video/mp2t',
  mpeg: 'video/mpeg', mpg: 'video/mpeg', m2v: 'video/mpeg', '3g2': 'video/3gpp2',
  divx: 'video/divx', asf: 'video/x-ms-asf', rm: 'application/vnd.rn-realmedia',
  rmvb: 'application/vnd.rn-realmedia', vob: 'video/dvd', mts: 'video/mp2t',
  m2ts: 'video/mp2t', h264: 'video/h264'
};

app.get('/serve', requireAuth, async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  try {
    const stat = await files.stat(filePath);
    const name = stat.name.toLowerCase();
    const ext  = name.includes('.') ? name.split('.').pop() : '';
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(stat.name)}"`);
    res.setHeader('Accept-Ranges', 'bytes');

    // HEIC/HEIF and RAW (dng/cr2/nef/arw/raf/orf/rw2): convert to JPEG (cached)
    if (['heic','heif','dng','cr2','cr3','nef','arw','raf','orf','rw2'].includes(ext)) {
      const jpg = await thumbs.getViewableImage(filePath);
      if (jpg) {
        res.setHeader('Content-Type', 'image/jpeg');
        // The cached jpg key is path+mtime so it's safe to cache aggressively in the browser
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.sendFile(jpg);
      }
      // fall through if conversion failed — browser will likely show broken-image
    }

    if (ext === 'pdf')           res.setHeader('Content-Type', 'application/pdf');
    else if (AUDIO_MIME[ext])    res.setHeader('Content-Type', AUDIO_MIME[ext]);
    else if (VIDEO_MIME[ext])    res.setHeader('Content-Type', VIDEO_MIME[ext]);
    res.sendFile(filePath);
  } catch { res.status(404).json({ error: 'Not found' }); }
});

// Transcoder for browser-unfriendly containers/audio.
// Writes a +faststart MP4 to disk (cached by path+mtime), then sendFile() with full
// HTTP Range support — way more reliable across browsers than streaming fragmented MP4.
const TRANSCODE_DIR = path.join(__dirname, '..', 'data', 'transcodecache');
const fs_ = require('fs');
if (!fs_.existsSync(TRANSCODE_DIR)) fs_.mkdirSync(TRANSCODE_DIR, { recursive: true });

// One ffmpeg per source file at a time; concurrent requests for the same file share the promise
const _transcodeInflight = new Map();

async function _ensureTranscoded(srcPath, quality) {
  const stat = await files.stat(srcPath);
  const crypto = require('crypto');
  const keyStr = `${srcPath}:${stat.mtime || stat.mtimeMs}` + (quality ? `:${quality}` : '');
  const key = crypto.createHash('md5').update(keyStr).digest('hex');
  const outPath = path.join(TRANSCODE_DIR, key + '.mp4');
  if (fs_.existsSync(outPath)) return { outPath, fromCache: true };
  if (_transcodeInflight.has(outPath)) return _transcodeInflight.get(outPath);

  const promise = (async () => {
    const { spawn } = require('child_process');
    // Probe codecs
    let probed = { streams: [], format: {} };
    try {
      probed = await new Promise((resolve, reject) => {
        const p = spawn('ffprobe', ['-v','error','-print_format','json','-show_streams','-show_format', srcPath]);
        let buf = ''; p.stdout.on('data', d => buf += d);
        p.on('close', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
        p.on('error', reject);
      });
    } catch {}
    const v = (probed.streams || []).find(s => s.codec_type === 'video');
    const a = (probed.streams || []).find(s => s.codec_type === 'audio');
    const vIsH264 = v && v.codec_name === 'h264';
    const aIsAac  = a && (a.codec_name === 'aac' || a.codec_name === 'mp3');
    const thumbs = require('./thumbnails');
    const bestCodec = await thumbs.getBestEncoder();
    const opts      = thumbs.CODEC_OPTS[bestCodec] || [];
    const hwaccel   = thumbs.HWACCEL_FOR[bestCodec];
    console.log(`[transcode] building cache for ${path.basename(srcPath)} (video=${v?.codec_name}${vIsH264?' copy':' reencode'}, audio=${a?.codec_name}${aIsAac?' copy':' aac'}) using ${bestCodec}`);

    const args = ['-hide_banner','-loglevel','warning','-y'];
    const isVaapi = bestCodec === 'h264_vaapi';
    const isH264  = bestCodec.includes('h264') || bestCodec.includes('libx264');
    const scaleFilter = quality ? `scale=-2:${quality}` : null;
    const finalFilter = scaleFilter ? (isVaapi ? `${scaleFilter},format=nv12,hwupload` : (isH264 ? `${scaleFilter},format=yuv420p` : scaleFilter)) : null;

    if (hwaccel) {
      if (isVaapi) args.push('-vaapi_device', '/dev/dri/renderD128', '-hwaccel', 'vaapi');
      else args.push('-hwaccel', hwaccel);
    }
    args.push('-i', srcPath);

    if (finalFilter) args.push('-vf', finalFilter);

    if (quality || !vIsH264) {
      args.push('-c:v', bestCodec, ...opts);
      if (quality && bestCodec === 'libx264') args.push('-maxrate', '2000k', '-bufsize', '4000k');
    } else {
      args.push('-c:v', 'copy');
    }
    if (aIsAac)  args.push('-c:a','copy'); else args.push('-c:a','aac','-b:a','192k');
    // +faststart writes the moov atom to the start of the file after encoding completes →
    // browsers can start playback immediately and seek freely.
    args.push('-movflags','+faststart', outPath);

    return await new Promise((resolve, reject) => {
      const t0 = Date.now();
      const child = spawn('ffmpeg', args, { stdio: ['ignore','ignore','pipe'] });
      let errBuf = '';
      child.stderr.on('data', d => { errBuf += d; if (errBuf.length > 4096) errBuf = errBuf.slice(-4096); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0 && fs_.existsSync(outPath)) {
          console.log(`[transcode] cached ${path.basename(outPath)} in ${((Date.now()-t0)/1000).toFixed(1)}s`);
          resolve({ outPath, fromCache: false });
        } else {
          try { fs_.unlinkSync(outPath); } catch {}
          reject(new Error(`ffmpeg exited ${code}: ${errBuf.split('\n').filter(Boolean).slice(-2).join(' | ')}`));
        }
      });
    });
  })().finally(() => _transcodeInflight.delete(outPath));

  _transcodeInflight.set(outPath, promise);
  return promise;
}

// LRU-evict the cache when it grows too large. Run after each new entry is added.
const TRANSCODE_CACHE_MAX_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB
async function _pruneTranscodeCache() {
  try {
    const entries = await fsp.readdir(TRANSCODE_DIR);
    const items = await Promise.all(entries.map(async (name) => {
      const fp = path.join(TRANSCODE_DIR, name);
      try { const st = await fsp.stat(fp); return { fp, size: st.size, atime: st.atimeMs }; }
      catch { return null; }
    }));
    const valid = items.filter(Boolean).sort((a, b) => a.atime - b.atime); // oldest access first
    let total = valid.reduce((s, i) => s + i.size, 0);
    while (total > TRANSCODE_CACHE_MAX_BYTES && valid.length) {
      const v = valid.shift();
      try { await fsp.unlink(v.fp); total -= v.size; console.log(`[transcode] evicted ${path.basename(v.fp)} (LRU)`); }
      catch {}
    }
  } catch {}
}

const fsp = require('fs/promises');

app.get('/transcode', requireAuth, async (req, res) => {
  const filePath = req.query.path;
  const quality = req.query.quality;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  console.log(`[transcode] request: ${path.basename(filePath)}${quality ? ` (quality: ${quality})` : ''}`);
  try {
    const { outPath, fromCache } = await _ensureTranscoded(filePath, quality);
    if (!fromCache) _pruneTranscodeCache(); // fire-and-forget
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(outPath); // Express handles Range requests automatically
  } catch (e) {
    console.error('[transcode] failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/media-info', requireAuth, async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  try {
    const { spawn } = require('child_process');
    const probed = await new Promise((resolve, reject) => {
      const p = spawn('ffprobe', [
        '-v', 'error', '-print_format', 'json',
        '-show_streams', '-show_format', filePath
      ]);
      let buf = '';
      p.stdout.on('data', d => buf += d);
      p.on('error', reject);
      p.on('close', (code) => {
        if (code !== 0) return reject(new Error(`ffprobe exited with code ${code}`));
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    });

    const streams = probed.streams || [];
    const format = probed.format || {};
    const video = streams.find(s => s.codec_type === 'video');
    const audio = streams.find(s => s.codec_type === 'audio');

    const info = {
      format: {
        filename: format.filename,
        format_name: format.format_name,
        format_long_name: format.format_long_name,
        duration: format.duration ? parseFloat(format.duration) : null,
        size: format.size ? parseInt(format.size, 10) : null,
        bit_rate: format.bit_rate ? parseInt(format.bit_rate, 10) : null,
      },
      video: video ? {
        codec_name: video.codec_name,
        codec_long_name: video.codec_long_name,
        profile: video.profile || null,
        width: video.width,
        height: video.height,
        display_aspect_ratio: video.display_aspect_ratio || null,
        pix_fmt: video.pix_fmt || null,
        r_frame_rate: video.r_frame_rate || null,
        avg_frame_rate: video.avg_frame_rate || null,
        bit_rate: video.bit_rate ? parseInt(video.bit_rate, 10) : null,
        // HDR metadata
        color_primaries: video.color_primaries || null,
        color_transfer: video.color_transfer || null,
        color_space: video.color_space || null,
        color_range: video.color_range || null,
      } : null,
      audio: audio ? {
        codec_name: audio.codec_name,
        codec_long_name: audio.codec_long_name,
        sample_rate: audio.sample_rate ? parseInt(audio.sample_rate, 10) : null,
        channels: audio.channels || null,
        channel_layout: audio.channel_layout || null,
        bit_rate: audio.bit_rate ? parseInt(audio.bit_rate, 10) : null,
      } : null,
      streams: streams.map(s => ({
        index: s.index,
        codec_type: s.codec_type,
        codec_name: s.codec_name,
        codec_long_name: s.codec_long_name,
      })),
    };

    res.json(info);
  } catch (e) {
    console.error('[media-info] failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/media-progress', requireAuth, (req, res) => {
  const db = require('./db');
  res.json(db.prepare('SELECT * FROM media_progress ORDER BY updated_at DESC').all());
});

app.post('/media-progress', requireAuth, require('express').json(), (req, res) => {
  const db = require('./db');
  const { path, progress_pct, current_time, duration } = req.body;
  if (!path) return res.status(400).json({error: 'Missing path'});
  db.prepare('INSERT OR REPLACE INTO media_progress (path, progress_pct, current_time, duration, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(path, progress_pct, current_time, duration, Date.now());
  res.json({ok:true});
});

app.delete('/media-progress', requireAuth, require('express').json(), (req, res) => {
  const db = require('./db');
  const { path } = req.body;
  db.prepare('DELETE FROM media_progress WHERE path = ?').run(path);
  res.json({ok:true});
});

app.get('/media-favorites', requireAuth, (req, res) => {
  const db = require('./db');
  res.json(db.prepare('SELECT * FROM media_favorites ORDER BY added_at DESC').all());
});

app.post('/media-favorites', requireAuth, require('express').json(), (req, res) => {
  const db = require('./db');
  const { path } = req.body;
  if (!path) return res.status(400).json({error: 'Missing path'});
  db.prepare('INSERT OR REPLACE INTO media_favorites (path, added_at) VALUES (?, ?)').run(path, Date.now());
  res.json({ok:true});
});

app.delete('/media-favorites', requireAuth, require('express').json(), (req, res) => {
  const db = require('./db');
  const { path } = req.body;
  db.prepare('DELETE FROM media_favorites WHERE path = ?').run(path);
  res.json({ok:true});
});

app.get('/thumbnail', requireAuth, async (req, res) => {
  const filePath = req.query.path;
  const width = parseInt(req.query.width) || 300;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  const ext = path.extname(filePath).toLowerCase();
  const isHeic = ext === '.heic' || ext === '.heif';
  try {
    const thumbPath = await thumbs.get(filePath, width);
    if (!thumbPath) {
      console.warn(`[thumbnail] FAILED → 204 for ${path.basename(filePath)}`);
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      return res.status(204).end();
    }
    if (isHeic) console.log(`[thumbnail] OK ${path.basename(filePath)} → ${path.basename(thumbPath)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(thumbPath);
  } catch (e) {
    console.warn(`[thumbnail] EXCEPTION for ${path.basename(filePath)}: ${e.message}`);
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.status(204).end();
  }
});

// On-demand 5s preview clip — only requested by the client on hover/tap,
// never eagerly for every visible thumbnail (see thumbnails.js getPreviewClip).
app.get('/video-preview', requireAuth, async (req, res) => {
  const filePath = req.query.path;
  const width = parseInt(req.query.width) || 400;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  try {
    const clipPath = await thumbs.getPreviewClip(filePath, width);
    if (!clipPath) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      return res.status(204).end();
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(clipPath);
  } catch (e) {
    console.warn(`[video-preview] EXCEPTION for ${path.basename(filePath)}: ${e.message}`);
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.status(204).end();
  }
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

// Public share endpoint — token-gated, no device enrollment needed.
// Files: streams the file inline. Folders: streams a zip on the fly.
app.get('/share/:token', async (req, res) => {
  const share = shares.resolveToken(req.params.token);
  if (!share) return res.status(404).send('Share link invalid, expired, or revoked.');
  try {
    if (share.is_dir) {
      const buf = await zipOps.createZipBuffer([share.path]);
      const name = path.basename(share.path) || 'shared';
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}.zip"`);
      shares.recordUse(share.id);
      return res.end(buf);
    }
    const stat = await files.stat(share.path);
    const ext  = (stat.name.split('.').pop() || '').toLowerCase();
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(stat.name)}"`);
    if (ext === 'pdf')        res.setHeader('Content-Type', 'application/pdf');
    else if (AUDIO_MIME[ext]) res.setHeader('Content-Type', AUDIO_MIME[ext]);
    else if (VIDEO_MIME[ext]) res.setHeader('Content-Type', VIDEO_MIME[ext]);
    shares.recordUse(share.id);
    res.sendFile(share.path);
  } catch (e) {
    res.status(500).send('Failed to serve shared file: ' + e.message);
  }
});

// --- HTTP + WS server ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/moonlight-proxy')) {
    moonlightProxy.upgrade(req, socket, head);
  } else {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }
});

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
      const items = payload.path ? await files.list(payload.path) : (() => {
        const types = files.driveTypes();
        return files.roots().map(r => ({
          name: r, path: r, isDir: true, size: 0, mtime: 0, ctime: 0, ext: null, mime: null, driveType: types[r] ?? null
        }));
      })();
      reply(items);
      break;
    }
    case 'fs:folder-size': reply({ size: await files.folderSize(payload.path), diskTotal: files.driveTotalBytes(payload.path) }); break;
    case 'fs:stat':       reply(await files.stat(payload.path)); break;
    case 'fs:read':       reply(await files.read(payload.path)); break;
    case 'fs:readBase64': reply(await files.readBinary(payload.path)); break;
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
    case 'fs:security':  reply(await security.info(payload.path)); break;

    // --- shares ---
    case 'share:create': reply(await shares.create({
      path: payload.path,
      expiresAt: payload.expiresAt || null,
      maxUses: payload.maxUses || null,
      deviceId: device.id
    })); break;
    case 'share:list':   reply({ items: shares.listForPath(payload.path) }); break;
    case 'share:revoke': shares.revoke(payload.id); reply({ ok: true }); break;
    case 'fs:media-list': {
      try {
        reply(await files.mediaList(payload.path));
      } catch (e) {
        reply(null, e.message);
      }
      break;
    }
    case 'fs:roots': {
      const types = files.driveTypes();
      reply(files.roots().map(r => ({ name: r, path: r, isDir: true, driveType: types[r] ?? null })));
      break;
    }

    case 'fs:exec': {
      const { spawn, exec } = require('child_process');
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
      try { 
        const p = spawn(cmd, args, opts); 
        p.unref(); 
        
        // Attempt to force focus after a short delay
        setTimeout(() => {
          let baseName = path.basename(fp, path.extname(fp));
          if (!baseName) return;
          baseName = baseName.replace(/"/g, '');
          
          if (process.platform === 'win32') {
            exec(`powershell -Command "$wshell = New-Object -ComObject wscript.shell; $wshell.AppActivate('${baseName}')"`);
          } else if (process.platform === 'linux') {
            exec(`wmctrl -a "${baseName}"`);
          } else if (process.platform === 'darwin') {
            exec(`osascript -e 'tell application "${baseName}" to activate'`);
          }
        }, 3000);
        
        reply({ ok: true }); 
      }
      catch (e) { reply({ ok: false, error: e.message }); }
      break;
    }

    // --- disk ---
    case 'disk:scan':         reply(disk.getTree(payload.path, { refresh: !!payload.refresh })); break;
    case 'disk:clear-cache':  reply(disk.clearCache(payload.path || null)); break;

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
      const fs_ = require('fs');
      const all = db.prepare('SELECT * FROM bookmarks WHERE device_id = ? ORDER BY created_at DESC').all(device.id);
      // Prune bookmarks whose target no longer exists; annotate path bookmarks with isDir.
      const alive = [];
      let pruned = 0;
      for (const b of all) {
        if (b.url) { alive.push(b); continue; }
        if (!b.path) { db.prepare('DELETE FROM bookmarks WHERE id = ?').run(b.id); pruned++; continue; }
        try {
          const s = fs_.statSync(b.path);
          alive.push({ ...b, isDir: s.isDirectory() });
        } catch {
          db.prepare('DELETE FROM bookmarks WHERE id = ?').run(b.id);
          pruned++;
        }
      }
      if (pruned) console.log(`[bookmarks] pruned ${pruned} broken entries for device ${device.id.slice(0,8)}`);
      reply(alive);
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
        },
        onCwd: (cwd) => {
          broadcastAll(JSON.stringify({ type: 'terminal:cwd', data: { sid, cwd } }));
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
    case 'terminal:verify': {
      const alive = term.isAlive(payload.sid);
      reply({ alive, cwd: alive ? term.getCwd(payload.sid) : null });
      break;
    }

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
    case 'git:clone':         reply(gitOps.cloneRepo(payload.cwd, payload.url)); break;
    case 'git:init-link':     reply(gitOps.initAndLink(payload.cwd, payload.url)); break;
    case 'git:submodule-add': reply(gitOps.addSubmodule(payload.cwd, payload.url, payload.path)); break;
    case 'git:submodules':    reply({ items: gitOps.listSubmodules(payload.cwd) }); break;

    // --- git sync ---
    case 'git:remotes':      reply({ remotes: gitOps.remotes(payload.cwd) }); break;
    case 'git:fetch':        reply(await gitOps.fetch(payload.cwd, payload.remote)); break;
    case 'git:pull':         reply(await gitOps.pull(payload.cwd)); break;
    case 'git:push':         reply(await gitOps.push(payload.cwd)); break;
    case 'git:ahead-behind': reply(gitOps.aheadBehind(payload.cwd)); break;

    // --- git stash ---
    case 'git:stash-list':  reply({ items: gitOps.stashList(payload.cwd) }); break;
    case 'git:stash-save':  reply(gitOps.stashSave(payload.cwd, payload.message, !!payload.includeUntracked)); break;
    case 'git:stash-apply': reply(gitOps.stashApply(payload.cwd, payload.index)); break;
    case 'git:stash-pop':   reply(gitOps.stashPop(payload.cwd, payload.index)); break;
    case 'git:stash-drop':  reply(gitOps.stashDrop(payload.cwd, payload.index)); break;

    // --- git merge / rebase ---
    case 'git:merge':           reply(gitOps.merge(payload.cwd, payload.branch)); break;
    case 'git:merge-abort':     reply(gitOps.mergeAbort(payload.cwd)); break;
    case 'git:merge-status':    reply(gitOps.mergeStatus(payload.cwd)); break;
    case 'git:rebase':           reply(gitOps.rebase(payload.cwd, payload.branch)); break;
    case 'git:rebase-continue':  reply(gitOps.rebaseContinue(payload.cwd)); break;
    case 'git:rebase-abort':     reply(gitOps.rebaseAbort(payload.cwd)); break;
    case 'git:rebase-status':    reply(gitOps.rebaseStatus(payload.cwd)); break;

    // --- stats ---
    case 'stats:get': sysStats.getStats().then(reply).catch(() => reply({})); break;

    // --- stream ---
    case 'stream:input': robot.handleInput(payload); break;

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
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  
  // Also allow if the request originated from one of the host's own network interfaces
  const cleanIp = ip.replace('::ffff:', '');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.address === cleanIp) return true;
    }
  }
  return false;
}

const PORT = config.port;
server.listen(PORT, () => {
  console.log(`DarkExplorer running on http://localhost:${PORT}`);
  search.startWatcher();

  disk.setBroadcaster(broadcastAll);
  disk.initBackgroundScan();

  // Push system stats to all clients every 3 seconds
  setInterval(async () => {
    const data = await sysStats.getStats();
    broadcastAll(JSON.stringify({ type: 'stats:push', data }));
  }, 3000);
});
