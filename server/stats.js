const os = require('os');
const fsp = require('fs/promises');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

let _prevCpu = null;
let _prevDisk = null; // { bytes, t }
let _prevNet  = null; // { bytes, t }

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

// ── Windows: WMIC ──────────────────────────────────────────────────
async function diskStatsWin() {
  try {
    const { stdout } = await execAsync(
      'wmic path Win32_PerfFormattedData_PerfDisk_PhysicalDisk get Name,PercentDiskTime,DiskBytesPerSec,DiskBytesPersec /value',
      { timeout: 4000, windowsHide: true }
    );
    const items = parseWmic(stdout);
    const total = items.find(i => i.Name === '_Total') || items[0];
    if (!total) return { pct: 0, mbps: 0 };
    const bps = parseInt(total.DiskBytesPersec || total.DiskBytesPerSec) || 0;
    return {
      pct: Math.min(100, parseInt(total.PercentDiskTime) || 0),
      mbps: Math.round(bps / 1e6 * 10) / 10
    };
  } catch { return { pct: 0, mbps: 0 }; }
}

async function networkStatsWin() {
  try {
    const { stdout } = await execAsync(
      'wmic path Win32_PerfFormattedData_Tcpip_NetworkInterface get BytesTotalPerSec,BytesTotalPersec /value',
      { timeout: 4000, windowsHide: true }
    );
    const items = parseWmic(stdout);
    const totalBps = items.reduce((acc, i) =>
      acc + (parseInt(i.BytesTotalPersec || i.BytesTotalPerSec) || 0), 0);
    const mbps = Math.round(totalBps * 8 / 1e6 * 10) / 10;
    return { mbps, pct: Math.min(100, Math.round(mbps / 10)) };
  } catch { return { mbps: 0, pct: 0 }; }
}

// ── Linux: /proc filesystem ────────────────────────────────────────
async function diskStatsLinux() {
  try {
    const txt = await fsp.readFile('/proc/diskstats', 'utf8');
    let sectors = 0;
    for (const line of txt.split('\n')) {
      const f = line.trim().split(/\s+/);
      if (f.length < 14) continue;
      const name = f[2];
      // skip partitions (e.g. "sda1") and loop/ram devices — keep whole-disks only
      if (/\d$/.test(name) && !/^nvme\d+n\d+$/.test(name)) continue;
      if (/^(loop|ram|fd)/.test(name)) continue;
      // sectors read (f[5]) + sectors written (f[9]) × 512 bytes
      sectors += (parseInt(f[5]) || 0) + (parseInt(f[9]) || 0);
    }
    const now = Date.now();
    const bytes = sectors * 512;
    if (!_prevDisk) { _prevDisk = { bytes, t: now }; return { pct: 0, mbps: 0 }; }
    const dBytes = Math.max(0, bytes - _prevDisk.bytes);
    const dt     = (now - _prevDisk.t) / 1000;
    _prevDisk    = { bytes, t: now };
    const mbps   = dt > 0 ? Math.round(dBytes / dt / 1e6 * 10) / 10 : 0;
    return { mbps, pct: Math.min(100, Math.round(mbps / 5)) }; // 500 MB/s ≈ 100%
  } catch { return { pct: 0, mbps: 0 }; }
}

async function networkStatsLinux() {
  try {
    const txt = await fsp.readFile('/proc/net/dev', 'utf8');
    let bytes = 0;
    for (const line of txt.split('\n').slice(2)) {
      const m = line.match(/^\s*(\S+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
      if (!m) continue;
      if (m[1] === 'lo') continue; // skip loopback
      bytes += parseInt(m[2]) + parseInt(m[3]); // rx + tx
    }
    const now = Date.now();
    if (!_prevNet) { _prevNet = { bytes, t: now }; return { mbps: 0, pct: 0 }; }
    const dBytes = Math.max(0, bytes - _prevNet.bytes);
    const dt     = (now - _prevNet.t) / 1000;
    _prevNet     = { bytes, t: now };
    const mbps   = dt > 0 ? Math.round(dBytes * 8 / dt / 1e6 * 10) / 10 : 0;
    return { mbps, pct: Math.min(100, Math.round(mbps / 10)) }; // 1 Gbps = 100%
  } catch { return { mbps: 0, pct: 0 }; }
}

// ── macOS: iostat -d + netstat -ib ─────────────────────────────────
async function diskStatsMac() {
  try {
    // `iostat -d -c 2 -w 1` would give samples but blocks 1s. Use single snapshot + delta.
    const { stdout } = await execAsync('iostat -d -K', { timeout: 3000 });
    // Output: device columns then per-disk KB/t tps MB/s rows
    let mbps = 0;
    const lines = stdout.trim().split('\n');
    for (const line of lines.slice(2)) {
      const f = line.trim().split(/\s+/);
      // groups of [KB/t, tps, MB/s] per device — sum MB/s columns (indices 2,5,8,…)
      for (let i = 2; i < f.length; i += 3) {
        const v = parseFloat(f[i]);
        if (!isNaN(v)) mbps += v;
      }
    }
    mbps = Math.round(mbps * 10) / 10;
    return { mbps, pct: Math.min(100, Math.round(mbps / 5)) };
  } catch { return { pct: 0, mbps: 0 }; }
}

async function networkStatsMac() {
  try {
    const { stdout } = await execAsync('netstat -ib', { timeout: 3000 });
    let bytes = 0;
    const lines = stdout.trim().split('\n');
    for (const line of lines.slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 10) continue;
      if (f[0] === 'lo0' || /^lo\d/.test(f[0])) continue;
      // columns: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes
      const ibytes = parseInt(f[6]) || 0;
      const obytes = parseInt(f[9]) || 0;
      bytes += ibytes + obytes;
    }
    const now = Date.now();
    if (!_prevNet) { _prevNet = { bytes, t: now }; return { mbps: 0, pct: 0 }; }
    const dBytes = Math.max(0, bytes - _prevNet.bytes);
    const dt     = (now - _prevNet.t) / 1000;
    _prevNet     = { bytes, t: now };
    const mbps   = dt > 0 ? Math.round(dBytes * 8 / dt / 1e6 * 10) / 10 : 0;
    return { mbps, pct: Math.min(100, Math.round(mbps / 10)) };
  } catch { return { mbps: 0, pct: 0 }; }
}

async function diskStats() {
  if (process.platform === 'win32')  return diskStatsWin();
  if (process.platform === 'linux')  return diskStatsLinux();
  if (process.platform === 'darwin') return diskStatsMac();
  return { pct: 0, mbps: 0 };
}

async function networkStats() {
  if (process.platform === 'win32')  return networkStatsWin();
  if (process.platform === 'linux')  return networkStatsLinux();
  if (process.platform === 'darwin') return networkStatsMac();
  return { mbps: 0, pct: 0 };
}

// ── GPU usage ────────────────────────────────────────────────────
// nvidia-smi covers the common case (this app's primary use case is a
// gaming PC used as a Sunshine/Apollo streaming host, almost always Nvidia).
// Falls back to the Windows "GPU Engine" perf counter (works for any vendor's
// driver on Windows 10+, same data Task Manager's GPU graph is built from).
let _gpuAvailable = true;
async function gpuStatsNvidia() {
  const { stdout } = await execAsync(
    'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits',
    { timeout: 3000, windowsHide: true }
  );
  const pct = parseInt(stdout.trim().split('\n')[0]) || 0;
  return { pct, available: true };
}

async function gpuStatsWinCounter() {
  const { stdout } = await execAsync(
    'powershell -NoProfile -Command "(Get-Counter \'\\GPU Engine(*)\\Utilization Percentage\').CounterSamples ' +
    '| Measure-Object -Property CookedValue -Maximum | Select-Object -ExpandProperty Maximum"',
    { timeout: 4000, windowsHide: true }
  );
  const pct = Math.min(100, Math.round(parseFloat(stdout.trim()) || 0));
  return { pct, available: true };
}

async function gpuStats() {
  if (!_gpuAvailable) return { pct: 0, available: false };
  try {
    return await gpuStatsNvidia();
  } catch {
    if (process.platform !== 'win32') { _gpuAvailable = false; return { pct: 0, available: false }; }
    try {
      return await gpuStatsWinCounter();
    } catch {
      _gpuAvailable = false;
      return { pct: 0, available: false };
    }
  }
}

async function getStats() {
  const [disk, net, gpu] = await Promise.all([diskStats(), networkStats(), gpuStats()]);
  return { cpu: cpuPct(), mem: memStats(), disk, net, gpu };
}

module.exports = { getStats };
