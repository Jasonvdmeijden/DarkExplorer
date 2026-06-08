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
    const cp   = cachePath(key);
    if (fs.existsSync(cp)) return cp;

    const ext = path.extname(filePath).toLowerCase();

    if (IMAGE_EXTS.has(ext))  return await imageThumb(filePath, cp, targetWidth);
    if (VIDEO_EXTS.has(ext))  return await videoThumb(filePath, cp, targetWidth);
    if (TEXT_EXTS.has(ext))   return await codeThumb(filePath, cp, targetWidth);
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

async function videoThumb(filePath, cp, targetWidth) {
  if (!ffmpeg) return null;
  return new Promise((resolve) => {
    const tmpDir = path.join(CACHE_DIR, '_tmp_' + path.basename(filePath, path.extname(filePath)));
    fs.mkdirSync(tmpDir, { recursive: true });
    ffmpeg(filePath)
      .on('end', async () => {
        try {
          const frames = fs.readdirSync(tmpDir).filter(f => f.endsWith('.jpg')).sort().slice(0, 3);
          if (!frames.length) { resolve(null); return; }
          // stitch frames side by side with sharp
          if (sharp) {
            const images = frames.map(f => ({ input: path.join(tmpDir, f) }));
            const meta   = await sharp(path.join(tmpDir, frames[0])).metadata();
            const w = meta.width || 160;
            const h = meta.height || 90;
            await sharp({ create: { width: w * images.length, height: h, channels: 3, background: '#000' } })
              .composite(images.map((img, i) => ({ ...img, left: i * w, top: 0 })))
              .resize(targetWidth, null)
              .webp({ quality: 70 })
              .toFile(cp);
          } else {
            fs.copyFileSync(path.join(tmpDir, frames[0]), cp);
          }
          fs.rmSync(tmpDir, { recursive: true, force: true });
          resolve(cp);
        } catch { fs.rmSync(tmpDir, { recursive: true, force: true }); resolve(null); }
      })
      .on('error', () => { fs.rmSync(tmpDir, { recursive: true, force: true }); resolve(null); })
      .screenshots({ count: 3, folder: tmpDir, filename: 'frame-%i.jpg', size: `${targetWidth}x?` });
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
