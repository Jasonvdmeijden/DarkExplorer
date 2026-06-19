const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const mime = require('mime-types');

// Fire-and-forget: tell the disk cache about a filesystem change so it can
// bubble the size delta up to ancestors without a full rescan.
function _notify(targetPath) {
  try { require('./disk').notifyChange(targetPath); } catch {}
}

async function list(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const items = await Promise.all(entries.map(async (e) => {
    const full = path.join(dirPath, e.name);
    try {
      const stat = await fsp.stat(full);
      return {
        name: e.name,
        path: full,
        isDir: e.isDirectory(),
        size: stat.size,
        mtime: stat.mtimeMs,
        ctime: stat.birthtimeMs,
        ext: e.isDirectory() ? null : path.extname(e.name).toLowerCase(),
        mime: e.isDirectory() ? null : (mime.lookup(e.name) || 'application/octet-stream')
      };
    } catch {
      return null;
    }
  }));
  const filtered = items.filter(Boolean);

  // Detect iPhone Live Photo pairs: <basename>.HEIC + <basename>.MOV in the same folder.
  // Attach the MOV's full path to the HEIC item so the client can play it as a looping live photo.
  const movByBase = new Map();
  for (const it of filtered) {
    if (it.isDir) continue;
    if (it.ext === '.mov') {
      const base = path.basename(it.name, path.extname(it.name)).toLowerCase();
      movByBase.set(base, it.path);
    }
  }
  for (const it of filtered) {
    if (it.isDir) continue;
    if (it.ext === '.heic' || it.ext === '.heif') {
      const base = path.basename(it.name, path.extname(it.name)).toLowerCase();
      const mov  = movByBase.get(base);
      if (mov) it.livePhotoMov = mov;
    }
  }
  return filtered;
}

async function stat(filePath) {
  const s = await fsp.stat(filePath);
  const name = path.basename(filePath);
  return {
    name,
    path: filePath,
    isDir: s.isDirectory(),
    size: s.size,
    mtime: s.mtimeMs,
    ctime: s.birthtimeMs,
    ext: s.isDirectory() ? null : path.extname(name).toLowerCase(),
    mime: s.isDirectory() ? null : (mime.lookup(name) || 'application/octet-stream')
  };
}

// Hard cap: anything bigger than this is refused outright for preview
const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;   // 5 MB
// Soft cap: files between SOFT and MAX are read partially (head only)
const PREVIEW_SOFT_BYTES = 256 * 1024;       // 256 KB

async function read(filePath) {
  const s = await fsp.stat(filePath);
  if (s.size > PREVIEW_MAX_BYTES) {
    return { tooLarge: true, size: s.size, limit: PREVIEW_MAX_BYTES };
  }
  if (s.size > PREVIEW_SOFT_BYTES) {
    // Read only first PREVIEW_SOFT_BYTES bytes
    const fh = await fsp.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(PREVIEW_SOFT_BYTES);
      await fh.read(buf, 0, PREVIEW_SOFT_BYTES, 0);
      return { content: buf.toString('utf8'), truncated: true, size: s.size, shown: PREVIEW_SOFT_BYTES };
    } finally { await fh.close(); }
  }
  return { content: await fsp.readFile(filePath, 'utf8') };
}

async function readBinary(filePath) {
  const s = await fsp.stat(filePath);
  if (s.size > PREVIEW_MAX_BYTES) {
    return { tooLarge: true, size: s.size, limit: PREVIEW_MAX_BYTES };
  }
  const buf = await fsp.readFile(filePath);
  return { content: buf.toString('base64') };
}

async function write(filePath, content) {
  await fsp.writeFile(filePath, content, 'utf8');
  _notify(filePath);
}

async function mkdir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
  _notify(dirPath);
}

async function remove(targets) {
  for (const t of targets) {
    await fsp.rm(t, { recursive: true, force: true });
    _notify(t);
  }
}

async function copy(sources, destDir) {
  for (const src of sources) {
    const dest = path.join(destDir, path.basename(src));
    await copyEntry(src, dest);
    _notify(dest);
  }
}

async function copyEntry(src, dest) {
  const s = await fsp.stat(src);
  if (s.isDirectory()) {
    await fsp.mkdir(dest, { recursive: true });
    const entries = await fsp.readdir(src);
    for (const e of entries) {
      await copyEntry(path.join(src, e), path.join(dest, e));
    }
  } else {
    await fsp.copyFile(src, dest);
  }
}

async function move(sources, destDir) {
  for (const src of sources) {
    const dest = path.join(destDir, path.basename(src));
    try {
      await fsp.rename(src, dest);
    } catch {
      // cross-device move
      await copyEntry(src, dest);
      await fsp.rm(src, { recursive: true, force: true });
    }
    _notify(src);
    _notify(dest);
  }
}

async function rename(filePath, newName) {
  const dest = path.join(path.dirname(filePath), newName);
  await fsp.rename(filePath, dest);
  // Update tags if renamed
  const db = require('./db');
  db.prepare('UPDATE tags SET path = ? WHERE path = ?').run(dest, filePath);
  _notify(filePath);
  _notify(dest);
  return dest;
}

function setTag(path, color, label) {
  const db = require('./db');
  if (!color && !label) {
    db.prepare('DELETE FROM tags WHERE path = ?').run(path);
  } else {
    db.prepare('INSERT OR REPLACE INTO tags (path, color, label, updated_at) VALUES (?, ?, ?, ?)')
      .run(path, color || null, label || null, Date.now());
  }
  return { ok: true };
}

function getTags(paths) {
  const db = require('./db');
  const placeholders = paths.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM tags WHERE path IN (${placeholders})`).all(paths);
}

function listTags() {
  const db = require('./db');
  return db.prepare('SELECT * FROM tags').all();
}

async function duplicate(filePath) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let name = `${base} copy${ext}`;
  let dest = path.join(dir, name);
  let counter = 1;

  while (fs.existsSync(dest)) {
    name = `${base} copy ${++counter}${ext}`;
    dest = path.join(dir, name);
  }

  await copyEntry(filePath, dest);
  _notify(dest);
  return dest;
}

function roots() {
  if (process.platform === 'win32') {
    // return available drive letters
    const { execSync } = require('child_process');
    try {
      const out = execSync('wmic logicaldisk get name', { encoding: 'utf8' });
      return out.split('\n')
        .map(l => l.trim())
        .filter(l => /^[A-Z]:$/.test(l))
        .map(d => d + '\\');
    } catch {
      return ['C:\\'];
    }
  }
  return ['/'];
}

// True if `p` is a drive root (e.g. 'C:\' on Windows, '/' on POSIX) — the only
// level where a folder's size can meaningfully be shown "out of" the disk's
// real total capacity.
function isDriveRoot(p) {
  return process.platform === 'win32' ? /^[A-Za-z]:\\?$/.test(p) : p === path.sep;
}

// Win32_LogicalDisk.DriveType per drive letter, e.g. { 'C:\\': 3, 'X:\\': 4 }.
// 2=Removable, 3=Local Fixed, 4=Network, 5=CD-ROM, 6=RAM Disk.
function driveTypes() {
  if (process.platform !== 'win32') return {};
  const { execSync } = require('child_process');
  try {
    const out = execSync('wmic logicaldisk get caption,drivetype', { encoding: 'utf8' });
    const map = {};
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^([A-Za-z]):\s+(\d+)/);
      if (m) map[m[1].toUpperCase() + ':\\'] = parseInt(m[2], 10);
    }
    return map;
  } catch {
    return {};
  }
}

// Total capacity of the drive `rootPath` lives on, or null if `rootPath` isn't
// a drive root.
function driveTotalBytes(rootPath) {
  if (!isDriveRoot(rootPath)) return null;
  try {
    const stats = fs.statfsSync(rootPath);
    return stats.blocks * stats.bsize;
  } catch {
    return null;
  }
}

// Folder-size walk: bounded by time + entry count, with an in-memory cache.
// Walks are serialized (no Promise.all recursion) to cap memory + open-FD use.
// Throttle: only N walks may run concurrently across the whole server.

const _sizeCache = new Map();   // path → { size, partial, expires }
const SIZE_TTL_MS    = 60 * 1000;       // memo for 1 minute
const TIME_BUDGET_MS = 2000;            // give up after 2s per request
const ENTRY_BUDGET   = 50000;           // stop after 50k entries
const MAX_CONCURRENT = 2;

let _active = 0;
const _queue = [];

function _runQueued(fn) {
  return new Promise((resolve) => {
    const task = async () => {
      _active++;
      try { resolve(await fn()); }
      finally {
        _active--;
        const next = _queue.shift();
        if (next) next();
      }
    };
    if (_active < MAX_CONCURRENT) task();
    else _queue.push(task);
  });
}

async function _walk(dirPath, ctx) {
  if (Date.now() > ctx.deadline || ctx.count >= ENTRY_BUDGET) { ctx.partial = true; return 0; }
  let total = 0;
  let entries;
  try { entries = await fsp.readdir(dirPath, { withFileTypes: true }); }
  catch { return 0; }
  for (const e of entries) {
    if (Date.now() > ctx.deadline || ctx.count >= ENTRY_BUDGET) { ctx.partial = true; break; }
    ctx.count++;
    const full = path.join(dirPath, e.name);
    try {
      if (e.isDirectory()) total += await _walk(full, ctx);
      else { const s = await fsp.stat(full); total += s.size; }
    } catch {}
  }
  return total;
}

async function folderSize(dirPath) {
  const cached = _sizeCache.get(dirPath);
  if (cached && cached.expires > Date.now()) return cached.size;

  return _runQueued(async () => {
    const ctx = { deadline: Date.now() + TIME_BUDGET_MS, count: 0, partial: false };
    const size = await _walk(dirPath, ctx);
    // Cache complete results longer; partial results only briefly so we may try again later
    _sizeCache.set(dirPath, {
      size,
      partial: ctx.partial,
      expires: Date.now() + (ctx.partial ? 5000 : SIZE_TTL_MS)
    });
    return size;
  });
}

const VIDEO_MIME_TYPES = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', '3gp': 'video/3gpp', ogv: 'video/ogg',
  flv: 'video/x-flv', f4v: 'video/x-f4v', wmv: 'video/x-ms-wmv',
  mpeg: 'video/mpeg', mpg: 'video/mpeg', m2v: 'video/mpeg', '3g2': 'video/3gpp2',
  divx: 'video/divx', vob: 'video/dvd', mts: 'video/mp2t',
  m2ts: 'video/mp2t', h264: 'video/h264'
};
const VIDEO_EXTENSIONS = new Set(Object.keys(VIDEO_MIME_TYPES).map(x => '.' + x));

// Extract year and quality tags from a folder or file name.
const SERIES_KEYWORDS = /\b(season|series|episodes?|complete|staffel|saison)\b/i;
const YEAR_RE = /(?:\((\d{4})\))|(?:\.(\d{4})\.)|(?:[.\s_-](\d{4})$)/;
const QUALITY_RE = /\b(720p|1080p|2160p|4K|BluRay|Blu-Ray|BDRip|BRRip|WEBRip|WEB-DL|WEBDL|HDRip|DVDRip|HDTV|PDTV|HDR|HDR10|DV|Dolby\s?Vision|Remux|UHD)\b/gi;

function _extractMeta(name) {
  const meta = {};
  const ym = name.match(YEAR_RE);
  if (ym) {
    const y = parseInt(ym[1] || ym[2] || ym[3], 10);
    if (y >= 1920 && y <= 2099) meta.year = y;
  }
  const qMatches = name.match(QUALITY_RE);
  if (qMatches && qMatches.length > 0) {
    // Deduplicate and normalise
    meta.quality = [...new Set(qMatches.map(q => q.trim()))].join(', ');
  }
  return meta;
}

async function mediaList(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const movies = [];
  const series = [];

  const _dirCache = new Map();
  async function getSubtitles(videoPath) {
    try {
      const dir = path.dirname(videoPath);
      const baseName = path.basename(videoPath, path.extname(videoPath));
      let dirEntries = _dirCache.get(dir);
      if (!dirEntries) {
        dirEntries = await fsp.readdir(dir, { withFileTypes: true });
        _dirCache.set(dir, dirEntries);
      }
      const subtitles = [];
      for (const e of dirEntries) {
        if (e.isFile()) {
          const lower = e.name.toLowerCase();
          if ((lower.endsWith('.srt') || lower.endsWith('.vtt')) && e.name.startsWith(baseName + '.')) {
            subtitles.push(path.join(dir, e.name));
          }
        }
      }
      return subtitles;
    } catch {
      return [];
    }
  }

  async function findVideos(folderPath) {
    const results = [];
    async function recurse(p) {
      let filesInFolder;
      try { filesInFolder = await fsp.readdir(p, { withFileTypes: true }); }
      catch { return; }
      for (const e of filesInFolder) {
        const full = path.join(p, e.name);
        if (e.isDirectory()) {
          await recurse(full);
        } else if (e.isFile()) {
          const ext = path.extname(e.name).toLowerCase();
          if (VIDEO_EXTENSIONS.has(ext)) {
            results.push({ name: e.name, path: full, ext });
          }
        }
      }
    }
    await recurse(folderPath);
    return results;
  }

  for (const e of entries) {
    const full = path.join(dirPath, e.name);
    const ext = path.extname(e.name).toLowerCase();

    if (e.isDirectory()) {
      const videos = await findVideos(full);
      if (videos.length > 0) {
        // Stat all videos upfront (needed for both movie & series paths)
        const videoStats = new Map();
        for (const vid of videos) {
          try {
            const s = await fsp.stat(vid.path);
            videoStats.set(vid.path, s);
          } catch {}
        }

        let isTV = false;

        // Check if any video matches season/episode naming patterns
        let hasEpisodePattern = false;
        for (const vid of videos) {
          const name = vid.name;
          const parentName = path.basename(path.dirname(vid.path));
          if (
            name.match(/s(\d+)\s*e(\d+)/i) ||
            name.match(/(\d+)x(\d+)/) ||
            name.match(/season\s*(\d+)/i) ||
            name.match(/s(\d+)/i) ||
            name.match(/ep\s*(\d+)/i) ||
            parentName.match(/season\s*(\d+)/i) ||
            parentName.match(/s(\d+)/i)
          ) {
            hasEpisodePattern = true;
            break;
          }
        }

        // Heuristic: >3 videos → likely a series
        if (videos.length > 3) {
          isTV = true;
        } else if (hasEpisodePattern) {
          // If 1-2 large files (>700 MB each), treat as movies even with
          // episode-style naming — these are typically movie rips.
          const LARGE_FILE_THRESHOLD = 700 * 1024 * 1024; // 700 MB
          const allLarge = videos.length <= 2 && videos.every(vid => {
            const s = videoStats.get(vid.path);
            return s && s.size > LARGE_FILE_THRESHOLD;
          });
          isTV = !allLarge;
        }

        // Also check folder name for series keywords
        if (!isTV) {
          const folderName = e.name;
          const parentOfFolder = path.basename(path.dirname(full));
          if (SERIES_KEYWORDS.test(folderName) || SERIES_KEYWORDS.test(parentOfFolder)) {
            isTV = true;
          }
        }

        // Extract metadata from the folder name
        const meta = _extractMeta(e.name);

        if (isTV) {
          const episodes = await Promise.all(videos.map(async vid => {
            const name = vid.name;
            let season = 1;
            let episode = 1;

            const m1 = name.match(/s(\d+)\s*e(\d+)/i);
            const m2 = name.match(/(\d+)x(\d+)/);
            const m3 = name.match(/season\s*(\d+)\s*episode\s*(\d+)/i);
            const m4 = name.match(/ep\s*(\d+)/i);
            
            if (m1) {
              season = parseInt(m1[1], 10);
              episode = parseInt(m1[2], 10);
            } else if (m3) {
              season = parseInt(m3[1], 10);
              episode = parseInt(m3[2], 10);
            } else if (m2) {
              season = parseInt(m2[1], 10);
              episode = parseInt(m2[2], 10);
            } else if (m4) {
              episode = parseInt(m4[1], 10);
              const parentName = path.basename(path.dirname(vid.path));
              const mSeason = parentName.match(/season\s*(\d+)/i) || parentName.match(/s(\d+)/i);
              if (mSeason) season = parseInt(mSeason[1], 10);
            } else {
              const mNum = name.match(/\b(\d+)\b/);
              if (mNum) episode = parseInt(mNum[1], 10);
              const parentName = path.basename(path.dirname(vid.path));
              const mSeason = parentName.match(/season\s*(\d+)/i) || parentName.match(/s(\d+)/i);
              if (mSeason) season = parseInt(mSeason[1], 10);
            }

            const s = videoStats.get(vid.path);
            const subs = await getSubtitles(vid.path);
            return {
              name,
              path: vid.path,
              ext: vid.ext,
              season,
              episode,
              size: s ? s.size : 0,
              mtime: s ? s.mtimeMs : 0,
              subtitles: subs
            };
          }));

          episodes.sort((a, b) => {
            if (a.season !== b.season) return a.season - b.season;
            if (a.episode !== b.episode) return a.episode - b.episode;
            return a.name.localeCompare(b.name);
          });

          const seriesItem = {
            name: e.name,
            path: full,
            isDir: true,
            episodes
          };
          if (meta.year) seriesItem.year = meta.year;
          if (meta.quality) seriesItem.quality = meta.quality;
          series.push(seriesItem);
        } else {
          // Treat all videos inside this subdirectory as individual movies
          for (const vid of videos) {
            const s = videoStats.get(vid.path);
            if (s) {
              const movieMeta = _extractMeta(vid.name);
              const subs = await getSubtitles(vid.path);
              const item = {
                name: vid.name,
                path: vid.path,
                isDir: false,
                size: s.size,
                mtime: s.mtimeMs,
                ext: vid.ext,
                mime: VIDEO_MIME_TYPES[vid.ext.replace('.', '')] || 'video/mp4',
                subtitles: subs
              };
              if (movieMeta.year || meta.year) item.year = movieMeta.year || meta.year;
              if (movieMeta.quality || meta.quality) item.quality = movieMeta.quality || meta.quality;
              movies.push(item);
            }
          }
        }
      }
    } else if (e.isFile() && VIDEO_EXTENSIONS.has(ext)) {
      try {
        const statVal = await fsp.stat(full);
        const movieMeta = _extractMeta(e.name);
        const subs = await getSubtitles(full);
        const item = {
          name: e.name,
          path: full,
          isDir: false,
          size: statVal.size,
          mtime: statVal.mtimeMs,
          ext,
          mime: VIDEO_MIME_TYPES[ext.replace('.', '')] || 'video/mp4',
          subtitles: subs
        };
        if (movieMeta.year) item.year = movieMeta.year;
        if (movieMeta.quality) item.quality = movieMeta.quality;
        movies.push(item);
      } catch {}
    }
  }

  movies.sort((a, b) => a.name.localeCompare(b.name));
  series.sort((a, b) => a.name.localeCompare(b.name));

  return { movies, series };
}

module.exports = { list, stat, read, readBinary, write, mkdir, remove, copy, move, rename, duplicate, setTag, getTags, listTags, roots, folderSize, isDriveRoot, driveTotalBytes, driveTypes, mediaList };

