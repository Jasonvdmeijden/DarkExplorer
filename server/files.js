const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const mime = require('mime-types');

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
  return items.filter(Boolean);
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

async function read(filePath) {
  return fsp.readFile(filePath, 'utf8');
}

async function write(filePath, content) {
  await fsp.writeFile(filePath, content, 'utf8');
}

async function mkdir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function remove(targets) {
  for (const t of targets) {
    await fsp.rm(t, { recursive: true, force: true });
  }
}

async function copy(sources, destDir) {
  for (const src of sources) {
    const dest = path.join(destDir, path.basename(src));
    await copyEntry(src, dest);
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
  }
}

async function rename(filePath, newName) {
  const dest = path.join(path.dirname(filePath), newName);
  await fsp.rename(filePath, dest);
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

module.exports = { list, stat, read, write, mkdir, remove, copy, move, rename, roots };
