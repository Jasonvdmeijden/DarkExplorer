/* Drive-specific icons — distinguishes drive roots (local, removable, network, etc.)
   from regular folders, using Win32_LogicalDisk.DriveType reported by fs:roots. */
const Drives = (() => {
  // 2=Removable, 3=Local Fixed, 4=Network, 5=CD-ROM, 6=RAM Disk
  const ICONS = { 2: '💽', 3: '🖴', 4: '🌐', 5: '💿', 6: '🖴' };
  const DEFAULT_ICON = '🖴';

  let typeByPath = new Map();

  // Normalizes a path to a drive-root key ('C:\\' or '/'), or null if it isn't one.
  function normalize(p) {
    if (typeof p !== 'string') return null;
    if (/^[A-Za-z]:\\?$/.test(p)) return p[0].toUpperCase() + ':\\';
    if (p === '/') return '/';
    return null;
  }

  async function init() {
    try {
      const roots = await WS.send('fs:roots', {});
      const map = new Map();
      roots.forEach(r => {
        const key = normalize(r.path);
        if (key) map.set(key, r.driveType);
      });
      typeByPath = map;
    } catch (e) {
      console.error('[drives] init failed:', e);
    }
  }

  function isRoot(p) {
    return normalize(p) !== null;
  }

  // Returns a drive icon for `p` if it's a drive root and `isDir`, else null
  // (caller should fall back to its normal folder/file icon).
  function icon(p, isDir) {
    if (!isDir) return null;
    const key = normalize(p);
    if (key === null) return null;
    return ICONS[typeByPath.get(key)] || DEFAULT_ICON;
  }

  return { init, isRoot, icon };
})();
