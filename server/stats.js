const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

let _prevCpu = null;

function cpuPct() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  if (!_prevCpu) { _prevCpu = { idle, total }; return 0; }
  const dIdle = idle - _prevCpu.idle, dTotal = total - _prevCpu.total;
  _prevCpu = { idle, total };
  return dTotal === 0 ? 0 : Math.round((1 - dIdle / dTotal) * 100);
}

function memStats() {
  const total = os.totalmem(), used = total - os.freemem();
  return { total, used, pct: Math.round(used / total * 100) };
}

function parseWmic(out) {
  const items = [];
  let cur = {};
  for (const raw of out.split(/\r?\n/)) {
    const eq = raw.indexOf('=');
    if (eq < 0) {
      if (Object.keys(cur).length) { items.push(cur); cur = {}; }
      continue;
    }
    cur[raw.slice(0, eq).trim()] = raw.slice(eq + 1).trim();
  }
  if (Object.keys(cur).length) items.push(cur);
  return items;
}

async function diskStats() {
  if (process.platform !== 'win32') return { pct: 0, mbps: 0 };
  try {
    const { stdout } = await execAsync(
      'wmic path Win32_PerfFormattedData_PerfDisk_PhysicalDisk get Name,PercentDiskTime,DiskBytesPerSec,DiskBytesPersec /value',
      { timeout: 4000, windowsHide: true }
    );
    const items = parseWmic(stdout);
    const total = items.find(i => i.Name === '_Total') || items[0];
    if (!total) return { pct: 0, mbps: 0 };
    // WMI returns either DiskBytesPersec or DiskBytesPerSec depending on OS version
    const bps = parseInt(total.DiskBytesPersec || total.DiskBytesPerSec) || 0;
    return {
      pct: Math.min(100, parseInt(total.PercentDiskTime) || 0),
      mbps: Math.round(bps / 1e6 * 10) / 10
    };
  } catch { return { pct: 0, mbps: 0 }; }
}

async function networkStats() {
  if (process.platform !== 'win32') return { mbps: 0, pct: 0 };
  try {
    const { stdout } = await execAsync(
      'wmic path Win32_PerfFormattedData_Tcpip_NetworkInterface get BytesTotalPerSec,BytesTotalPersec /value',
      { timeout: 4000, windowsHide: true }
    );
    const items = parseWmic(stdout);
    const totalBps = items.reduce((acc, i) => {
      return acc + (parseInt(i.BytesTotalPersec || i.BytesTotalPerSec) || 0);
    }, 0);
    const mbps = Math.round(totalBps * 8 / 1e6 * 10) / 10;
    // Color scale: 1 Gbps = 1000 Mbps = 100%
    const pct = Math.min(100, Math.round(mbps / 10));
    return { mbps, pct };
  } catch { return { mbps: 0, pct: 0 }; }
}

async function getStats() {
  const [disk, net] = await Promise.all([diskStats(), networkStats()]);
  return { cpu: cpuPct(), mem: memStats(), disk, net };
}

module.exports = { getStats };
