const path = require('path');
const fsp = require('fs/promises');

async function scan(rootPath, wsClient) {
  const db = require('./db');
  
  let totalSpace = 0;
  let freeSpace = 0;

  try {
    const s = await fsp.statfs(rootPath);
    totalSpace = s.bsize * s.blocks;
    freeSpace = s.bsize * s.bfree;
  } catch (e) {
    console.error("[disk:scan] statfs error:", e.message);
  }

  if (wsClient) wsClient.send(JSON.stringify({ type: 'disk:progress', data: { scanned: 0, current: 'Querying database...' } }));

  // Fetch all files
  let rows = [];
  try {
    if (rootPath === '/' || rootPath === 'C:\\') {
      rows = db.prepare('SELECT path, size FROM files WHERE is_dir = 0').all();
    } else {
      rows = db.prepare('SELECT path, size FROM files WHERE is_dir = 0 AND path LIKE ?').all(rootPath + '%');
    }
  } catch (e) {
    console.error("[disk:scan] DB error:", e.message);
  }
  
  if (wsClient) wsClient.send(JSON.stringify({ type: 'disk:progress', data: { scanned: rows.length, current: 'Building tree...' } }));

  const rootNode = { name: path.basename(rootPath) || rootPath, path: rootPath, size: 0, children: new Map(), isDir: true };

  const isWin = process.platform === 'win32';
  const sep = isWin ? '\\' : '/';

  for (const r of rows) {
    // Determine relative path from root
    if (!r.path.startsWith(rootPath)) continue;
    let rel = r.path.slice(rootPath.length);
    if (rel.startsWith(sep)) rel = rel.slice(1);
    if (!rel) continue; // It's the root itself

    const parts = rel.split(sep);
    let curr = rootNode;
    let currPath = rootPath;

    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      currPath = currPath.endsWith(sep) ? currPath + p : currPath + sep + p;
      if (!curr.children.has(p)) {
        curr.children.set(p, { name: p, path: currPath, size: 0, children: new Map(), isDir: true });
      }
      curr = curr.children.get(p);
    }
    const name = parts[parts.length - 1];
    const fullPath = r.path;
    curr.children.set(name, { name, path: fullPath, size: r.size, isDir: false });
  }

  // Calculate sizes and convert maps to arrays
  function calcAndConvert(node) {
    if (!node.isDir) return node.size;
    let total = 0;
    const arr = [];
    for (const child of node.children.values()) {
      total += calcAndConvert(child);
      arr.push(child);
    }
    node.size = total;
    node.children = arr;
    return total;
  }

  calcAndConvert(rootNode);
  const indexedSize = rootNode.size;

  // Add Free Space and Hidden Space if we're scanning a root drive or top-level path
  // Only add if the indexed size is significantly smaller than the total space
  if (totalSpace > 0 && indexedSize < totalSpace) {
    rootNode.size = totalSpace;
    
    rootNode.children.push({
      name: 'Free space',
      path: '__free__',
      size: freeSpace,
      isDir: false,
      isGroup: true,
      fixedColor: 'rgba(255,255,255,0.1)' // special flag for frontend
    });

    const hiddenSize = totalSpace - freeSpace - indexedSize;
    if (hiddenSize > 0) {
      rootNode.children.push({
        name: 'Hidden space...',
        path: '__hidden__',
        size: hiddenSize,
        isDir: false,
        isGroup: true,
        fixedColor: 'rgba(255,255,255,0.05)'
      });
    }
  }

  // Prune the tree to keep it manageable for the frontend SVG renderer
  function prune(node) {
    if (!node.children) return;
    node.children.sort((a, b) => b.size - a.size);
    let visible = [];
    let smallerSize = 0;

    for (const child of node.children) {
      // Keep top 25 items, or any item that is at least 0.5% of the parent folder's size
      // Always keep groups like 'Free space'
      if (child.isGroup || (visible.length < 25 && (child.size / (node.size || 1)) >= 0.005)) {
        if (child.isDir) prune(child);
        visible.push(child);
      } else {
        smallerSize += child.size;
      }
    }

    if (smallerSize > 0) {
      visible.push({
        name: `smaller objects...`,
        path: node.path + '/__smaller',
        size: smallerSize,
        isDir: false,
        isGroup: true,
        fixedColor: 'rgba(255,255,255,0.2)'
      });
    }
    node.children = visible;
  }

  prune(rootNode);
  return rootNode;
}

module.exports = { scan };
