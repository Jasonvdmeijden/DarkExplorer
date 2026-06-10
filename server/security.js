const fsp = require('fs/promises');
const os  = require('os');

function _modeToRwx(mode) {
  const perms = ['r','w','x'];
  let out = '';
  for (let shift = 6; shift >= 0; shift -= 3) {
    for (let i = 0; i < 3; i++) {
      out += (mode >> (shift + (2 - i))) & 1 ? perms[i] : '-';
    }
  }
  return out;
}

async function info(filePath) {
  const s = await fsp.stat(filePath);
  const result = {
    platform: process.platform,
    isDirectory: s.isDirectory(),
    sizeBytes: s.size,
    mtime: s.mtimeMs,
    ctime: s.ctimeMs,
    birthtime: s.birthtimeMs,
  };

  if (process.platform === 'win32') {
    // Windows: mode bits are limited. fs.stat returns a mock-ish mode (always 0o666 / 0o444).
    // Read-only is reflected: 0o100444 vs 0o100666. No real ACL surfacing without extra deps.
    result.readOnly   = (s.mode & 0o200) === 0;
    result.attributes = {
      readOnly: result.readOnly,
      // Hidden/System/Archive flags aren't directly accessible from fs.stat — leave undefined.
    };
    result.owner = { name: os.userInfo().username };
  } else {
    // Unix: real mode + uid/gid
    result.octal = (s.mode & 0o777).toString(8).padStart(3, '0');
    result.rwx   = _modeToRwx(s.mode & 0o777);
    result.uid   = s.uid;
    result.gid   = s.gid;
    try {
      const me = os.userInfo();
      result.owner = { name: me.uid === s.uid ? me.username : `uid:${s.uid}`, uid: s.uid, gid: s.gid };
    } catch {
      result.owner = { name: `uid:${s.uid}`, uid: s.uid, gid: s.gid };
    }
  }
  return result;
}

module.exports = { info };
