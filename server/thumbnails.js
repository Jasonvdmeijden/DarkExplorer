const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'thumbcache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

let sharp, ffmpeg, createCanvas, heicConvert;

try { sharp = require('sharp'); } catch { sharp = null; }
try { ffmpeg = require('fluent-ffmpeg'); } catch { ffmpeg = null; }
try { ({ createCanvas } = require('canvas')); } catch { createCanvas = null; }
// heic-convert bundles libheif + libde265 (HEVC) as WebAssembly — works where sharp's
// libheif lacks the HEVC decoder plugin (most Windows installs).
try { heicConvert = require('heic-convert'); } catch { heicConvert = null; }

const IMAGE_EXTS = new Set([
  '.jpg','.jpeg','.png','.gif','.webp','.avif','.tiff','.tif','.bmp',
  '.heic','.heif',
  '.dng','.cr2','.cr3','.nef','.arw','.raf','.orf','.rw2'
]);
// Browsers can't render these directly — transcode to JPEG via sharp
const CONVERT_EXTS = new Set([
  '.heic','.heif',
  '.dng','.cr2','.cr3','.nef','.arw','.raf','.orf','.rw2'
]);
const VIDEO_EXTS = new Set(['.mp4','.webm','.mov','.mkv','.avi','.m4v']);
const TEXT_EXTS  = new Set([
  '.txt','.md','.js','.mjs','.ts','.tsx','.jsx','.json','.yaml','.yml',
  '.html','.css','.scss','.py','.rb','.go','.rs','.java','.c','.cpp',
  '.h','.cs','.php','.sql','.sh','.env','.toml','.cfg','.conf'
]);

// token highlighter colour map (approximate, by category)
const HIGHLIGHT = {
  keyword:  '#c792ea',
  string:   '#c3e88d',
  number:   '#f78c6c',
  comment:  '#546e7a',
  default:  '#e2e2f0'
};

function cacheKey(filePath, mtime, width) {
  return crypto.createHash('md5').update(`${filePath}:${mtime}:${width}`).digest('hex');
}

function cachePath(key) {
  return path.join(CACHE_DIR, key + '.jpg');
}

async function get(filePath, targetWidth = 300) {
  try {
    const stat = await fsp.stat(filePath);
    const key  = cacheKey(filePath, stat.mtimeMs, targetWidth);
    const ext  = path.extname(filePath).toLowerCase();

    if (IMAGE_EXTS.has(ext)) {
      const cpJpg  = cachePath(key);                          // .jpg (default for images)
      const cpWebp = cpJpg.replace(/\.jpg$/, '.webp');        // .webp (used for animated GIFs)
      if (fs.existsSync(cpJpg))  return cpJpg;
      if (fs.existsSync(cpWebp)) return cpWebp;
      return await imageThumb(filePath, cpJpg, targetWidth);
    }

    if (VIDEO_EXTS.has(ext)) {
      const mp4  = path.join(CACHE_DIR, key + '.mp4');
      const webm = path.join(CACHE_DIR, key + '.webm');
      if (fs.existsSync(mp4))  return mp4;
      if (fs.existsSync(webm)) return webm;
      return await videoClip(filePath, mp4, webm, targetWidth);
    }

    if (TEXT_EXTS.has(ext)) {
      const cp = cachePath(key);
      if (fs.existsSync(cp)) return cp;
      return await codeThumb(filePath, cp, targetWidth);
    }
  } catch { /* fall through */ }
  return null;
}

// Decode a HEIC/HEIF file to a JPEG buffer via heic-convert (WASM libheif+libde265).
// Used as a fallback path when sharp's libheif lacks the HEVC decoder plugin.
//
// Concurrency cap: heic-convert is CPU-heavy WASM. When a user navigates to a folder
// with 50+ HEIC files the browser fires 50+ thumbnail requests at once. Without a cap
// the event loop and CPU get monopolised — even cached-thumbnail requests stall.
const _heicSem = { active: 0, queue: [] };
// Cap matches roughly half the available cores so we keep the event loop snappy
// while still saturating the WASM decoder pipeline. heic-convert internally uses
// a worker per call so this also caps Node worker_threads spawned at once.
const HEIC_MAX_CONCURRENT = Math.max(2, Math.min(6, Math.floor((require('os').cpus().length || 4) / 2)));

function _acquireHeicSlot() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (_heicSem.active < HEIC_MAX_CONCURRENT) { _heicSem.active++; resolve(); }
      else _heicSem.queue.push(tryAcquire);
    };
    tryAcquire();
  });
}
function _releaseHeicSlot() {
  _heicSem.active--;
  const next = _heicSem.queue.shift();
  if (next) next();
}

async function _heicToJpegBuffer(filePath, quality = 0.85) {
  if (!heicConvert) return null;
  await _acquireHeicSlot();
  try {
    const buf = await fsp.readFile(filePath);
    const out = await heicConvert({ buffer: buf, format: 'JPEG', quality });
    return Buffer.from(out);
  } finally {
    _releaseHeicSlot();
  }
}

async function imageThumb(filePath, cp, targetWidth) {
  if (!sharp) return null;
  const ext = path.extname(filePath).toLowerCase();
  const isHeic = ext === '.heic' || ext === '.heif';
  const isGif  = ext === '.gif';
  // Animated GIFs need WebP to preserve frames (JPEG is single-frame).
  // Everything else gets JPEG for maximum browser compatibility.
  const outPath = isGif ? cp.replace(/\.jpg$/, '.webp') : cp;
  try {
    let pipeline = sharp(filePath, isGif ? { animated: true } : {})
      .resize(targetWidth, null, { withoutEnlargement: true });
    if (isGif) pipeline = pipeline.webp({ quality: 75 });
    else       pipeline = pipeline.jpeg({ quality: 80, mozjpeg: true });
    await pipeline.toFile(outPath);
    return outPath;
  } catch (e) {
    if (!isHeic) throw e;
    // For thumbnails we don't need a high-quality decode — the output is 300px wide.
    // Quality 0.5 cuts heic-convert encode time noticeably with no visible difference at thumb size.
    const jpgBuf = await _heicToJpegBuffer(filePath, 0.5).catch(() => null);
    if (!jpgBuf) throw e;
    await sharp(jpgBuf)
      .resize(targetWidth, null, { withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(outPath);
    return outPath;
  }
}

// Per-codec output options. Hardware encoders need their own preset/quality flags.
const CODEC_OPTS = {
  // NVIDIA NVENC — significantly faster than CPU (often 10×+). Available with recent drivers.
  h264_nvenc:        ['-preset','p4','-tune','hq','-rc','vbr','-cq','23'],
  // Intel Quick Sync — modern Intel CPUs/iGPUs.
  h264_qsv:          ['-preset','medium','-global_quality','23'],
  // AMD AMF — modern AMD GPUs (Windows + Linux).
  h264_amf:          ['-quality','balanced','-rc','cqp','-qp_i','22','-qp_p','24'],
  // Linux VAAPI — Intel/AMD on Linux with kernel driver. Needs -vaapi_device.
  h264_vaapi:        ['-qp','24'],
  // Windows MediaFoundation — built-in Windows hardware encoder (slowest of the HW ones but always present).
  h264_mf:           [],
  // macOS VideoToolbox — Apple Silicon and Intel Macs hardware encoder.
  h264_videotoolbox: ['-q:v','60'],
  // Software fallback.
  libx264:           ['-preset','veryfast','-crf','24'],
  libvpx:            ['-b:v','500k','-deadline','realtime'],
};

// Per-platform preference order (only encoders in CODEC_OPTS are considered).
const CODEC_PREFERENCE = {
  win32:  ['h264_nvenc','h264_qsv','h264_amf','h264_mf','libx264'],
  darwin: ['h264_videotoolbox','libx264'],
  linux:  ['h264_nvenc','h264_qsv','h264_vaapi','libx264'],
};

// Cache discovered encoder list. Probed lazily on first videoClip call.
let _availableCodecs = null;
// Codecs that have failed at runtime are dropped from rotation for the rest of the server's lifetime.
const _deadCodecs = new Set();

// Matching hwaccel for the decode side. Saves significant CPU because ffmpeg otherwise
// decodes the input video in software even when the encoder is on the GPU.
const HWACCEL_FOR = {
  h264_nvenc:        'cuda',
  h264_qsv:          'qsv',
  h264_amf:          'd3d11va',
  h264_vaapi:        'vaapi',
  h264_mf:           'd3d11va',
  h264_videotoolbox: 'videotoolbox',
};

function _probeAvailableCodecs() {
  if (_availableCodecs) return Promise.resolve(_availableCodecs);
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-hide_banner','-encoders'], { timeout: 5000 }, (err, stdout) => {
      if (err) { _availableCodecs = []; return resolve([]); }
      // Lines look like:  V....D libx264              libx264 H.264 / AVC ...
      const names = new Set();
      for (const line of stdout.split('\n')) {
        const m = line.match(/^\s*V\S*\s+(\S+)\s/);
        if (m) names.add(m[1]);
      }
      const pref = CODEC_PREFERENCE[process.platform] || ['libx264'];
      _availableCodecs = pref.filter(c => names.has(c));
      if (!_availableCodecs.length) _availableCodecs = ['libx264']; // last-ditch
      console.log(`[thumbs] available H.264 encoders (priority): ${_availableCodecs.join(' > ')}`);
      resolve(_availableCodecs);
    });
  });
}

async function videoClip(filePath, mp4Path, webmPath, targetWidth) {
  if (!ffmpeg) return null;
  const scale = `scale=${targetWidth}:-2`;

  // Probe duration so we can clip from the middle of the video
  const start = await new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      const dur = meta?.format?.duration || 0;
      resolve(Math.max(0, dur / 2 - 2.5).toFixed(3));
    });
  });

  const codecs = (await _probeAvailableCodecs()).filter(c => !_deadCodecs.has(c));

  const tryCodec = (codec) => new Promise((resolve) => {
    const extraOpts = CODEC_OPTS[codec] || [];
    const isVaapi   = codec === 'h264_vaapi';
    const hwaccel   = HWACCEL_FOR[codec];
    const cmd = ffmpeg(filePath);

    // Hardware decode acceleration matching the encoder — drastically cuts CPU usage.
    // We use the "soft" form (no explicit hw_device) so ffmpeg falls back to CPU decode
    // automatically if the hardware decoder can't handle the input.
    if (isVaapi) {
      cmd.inputOptions(['-vaapi_device','/dev/dri/renderD128','-hwaccel','vaapi']);
    } else if (hwaccel) {
      cmd.inputOptions(['-hwaccel', hwaccel]);
    }

    cmd
      .inputOptions(['-ss', start, '-t', '5'])
      .outputOptions([
        '-t','5',
        '-vf', isVaapi ? `${scale},format=nv12,hwupload` : scale,
        '-an',
        '-c:v', codec,
        ...extraOpts,
        '-movflags','+faststart'
      ])
      .output(mp4Path)
      .on('start', () => console.log(`[thumbs] encoding with ${codec} (hwaccel=${hwaccel || 'none'})`))
      .on('end', () => resolve(true))
      .on('error', (e) => {
        try { fs.unlinkSync(mp4Path); } catch {}
        const first = e.message.split('\n')[0];
        // Permanent disable on init/device errors so we don't keep retrying every video.
        // Transient errors (e.g. one bad input file) don't match these patterns.
        if (/Cannot load|No such|not found|Init|cannot init|unknown encoder|device|Could not|not supported/i.test(first)) {
          _deadCodecs.add(codec);
          console.warn(`[thumbs] ${codec} disabled for session: ${first}`);
        } else {
          console.warn(`[thumbs] ${codec} failed: ${first}`);
        }
        resolve(false);
      })
      .run();
  });

  for (const codec of codecs) {
    if (_deadCodecs.has(codec)) continue;
    if (await tryCodec(codec)) return mp4Path;
  }

  // Last-resort VP8 WebM (more widely available but slower/larger)
  return new Promise((resolve) => {
    ffmpeg(filePath)
      .inputOptions(['-ss', start, '-t', '5'])
      .outputOptions(['-t', '5', '-vf', scale, '-an', '-c:v', 'libvpx', '-b:v', '500k', '-deadline', 'realtime'])
      .output(webmPath)
      .on('end', () => resolve(webmPath))
      .on('error', (e) => {
        try { fs.unlinkSync(webmPath); } catch {}
        console.error('[thumbs] libvpx fallback failed:', e.message.split('\n')[0]);
        resolve(null);
      })
      .run();
  });
}

async function codeThumb(filePath, cp, targetWidth) {
  if (!createCanvas) return null;
  try {
    const text = await fsp.readFile(filePath, 'utf8');
    const lines = text.split('\n').slice(0, 40);
    const size = targetWidth;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1c1c28';
    ctx.fillRect(0, 0, size, size);

    const fontSize = Math.max(6, Math.floor(size / 40));
    ctx.font = `${fontSize}px monospace`;
    const lineH = fontSize + 2;

    lines.forEach((line, i) => {
      const tokens = tokenise(line);
      let x = 6;
      tokens.forEach(({ text: t, type }) => {
        ctx.fillStyle = HIGHLIGHT[type] || HIGHLIGHT.default;
        ctx.fillText(t, x, (i + 1) * lineH + 4);
        x += ctx.measureText(t).width;
      });
    });

    const buf = canvas.toBuffer('image/png');
    if (sharp) {
      await sharp(buf).resize(size, size).webp({ quality: 80 }).toFile(cp);
    } else {
      await fsp.writeFile(cp.replace('.webp', '.png'), buf);
      return cp.replace('.webp', '.png');
    }
    return cp;
  } catch { return null; }
}

function tokenise(line) {
  const tokens = [];
  const patterns = [
    { re: /\/\/.*$/, type: 'comment' },
    { re: /#.*$/, type: 'comment' },
    { re: /"[^"]*"|'[^']*'|`[^`]*`/, type: 'string' },
    { re: /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|def|pub|fn|struct|enum|interface|type)\b/, type: 'keyword' },
    { re: /\b\d+(\.\d+)?\b/, type: 'number' }
  ];

  let remaining = line;
  while (remaining.length) {
    let matched = false;
    for (const { re, type } of patterns) {
      const m = remaining.match(re);
      if (m && m.index !== undefined) {
        if (m.index > 0) tokens.push({ text: remaining.slice(0, m.index), type: 'default' });
        tokens.push({ text: m[0], type });
        remaining = remaining.slice(m.index + m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) { tokens.push({ text: remaining, type: 'default' }); break; }
  }
  return tokens;
}

// Convert a non-browser-renderable image (HEIC/HEIF/RAW) to a cached JPEG.
// Returns the original path for normal images so the caller can sendFile() directly.
// Long-edge resize keeps encode/decode time bounded — typical phones shoot 4000-6000px
// HEIC which is wasteful for an in-app preview. 1800px is enough for any retina screen.
const PREVIEW_MAX_EDGE = 1800;

// Inflight de-dup: if two requests for the same path arrive while encoding, share the work
const _convertInflight = new Map();

async function getViewableImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!CONVERT_EXTS.has(ext)) return filePath;
  if (!sharp) return null;
  try {
    const stat = await fsp.stat(filePath);
    const key  = cacheKey(filePath, stat.mtimeMs, 'preview1800q75');
    const cp   = path.join(CACHE_DIR, key + '.jpg');
    if (fs.existsSync(cp)) return cp;

    if (_convertInflight.has(cp)) return _convertInflight.get(cp);

    const isHeic = ext === '.heic' || ext === '.heif';
    const convert = async () => {
      // Try sharp first (fast native path for non-HEVC HEIF, DNG, etc.)
      try {
        await sharp(filePath)
          .rotate()
          .resize({ width: PREVIEW_MAX_EDGE, height: PREVIEW_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true, progressive: true })
          .toFile(cp);
        return cp;
      } catch (e) {
        if (!isHeic) throw e;
        // HEIC fallback: heic-convert (WASM, bundles HEVC decoder)
        console.log(`[thumbs] sharp failed for ${ext}, using heic-convert fallback`);
        const jpgBuf = await _heicToJpegBuffer(filePath, 0.75);
        if (!jpgBuf) throw e;
        await sharp(jpgBuf)
          .rotate()
          .resize({ width: PREVIEW_MAX_EDGE, height: PREVIEW_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true, progressive: true })
          .toFile(cp);
        return cp;
      }
    };

    const p = convert()
      .catch((e) => { console.warn(`[thumbs] convert failed for ${ext}:`, e.message); return null; })
      .finally(() => _convertInflight.delete(cp));
    _convertInflight.set(cp, p);
    return p;
  } catch (e) {
    console.warn(`[thumbs] convert failed for ${ext}:`, e.message);
    return null;
  }
}

module.exports = { get, getViewableImage };
