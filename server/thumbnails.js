const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'thumbcache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

let sharp, ffmpeg, createCanvas;

try { sharp = require('sharp'); } catch { sharp = null; }
try { ffmpeg = require('fluent-ffmpeg'); } catch { ffmpeg = null; }
try { ({ createCanvas } = require('canvas')); } catch { createCanvas = null; }

const IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.tiff','.bmp']);
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
  return path.join(CACHE_DIR, key + '.webp');
}

async function get(filePath, targetWidth = 300) {
  try {
    const stat = await fsp.stat(filePath);
    const key  = cacheKey(filePath, stat.mtimeMs, targetWidth);
    const ext  = path.extname(filePath).toLowerCase();

    if (IMAGE_EXTS.has(ext)) {
      const cp = cachePath(key);
      if (fs.existsSync(cp)) return cp;
      return await imageThumb(filePath, cp, targetWidth);
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

async function imageThumb(filePath, cp, targetWidth) {
  if (!sharp) return null;
  await sharp(filePath)
    .resize(targetWidth, null, { withoutEnlargement: true })
    .webp({ quality: 75 })
    .toFile(cp);
  return cp;
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

  return new Promise((resolve) => {
    ffmpeg(filePath)
      .inputOptions(['-ss', start, '-t', '5'])
      .outputOptions(['-t', '5', '-vf', scale, '-an', '-c:v', 'h264_mf', '-movflags', '+faststart'])
      .output(mp4Path)
      .on('end', () => resolve(mp4Path))
      .on('error', (e1) => {
        console.warn('[thumbs] h264_mf failed, trying libvpx:', e1.message);
        try { fs.unlinkSync(mp4Path); } catch {}
        ffmpeg(filePath)
          .inputOptions(['-ss', start, '-t', '5'])
          .outputOptions(['-t', '5', '-vf', scale, '-an', '-c:v', 'libvpx', '-b:v', '500k', '-deadline', 'realtime'])
          .output(webmPath)
          .on('end', () => resolve(webmPath))
          .on('error', (e2) => {
            try { fs.unlinkSync(webmPath); } catch {}
            console.error('[thumbs] libvpx also failed:', e2.message);
            resolve(null);
          })
          .run();
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

module.exports = { get };
