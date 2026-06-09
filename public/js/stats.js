/* System stats — updates status bar from server push every 3 s */
const Stats = (() => {
  function heatColor(pct) {
    if (pct >= 90) return '#ef4444';
    if (pct >= 75) return '#fb923c';
    if (pct >= 50) return '#facc15';
    return '#4ade80';
  }

  function fmtBytes(b) {
    if (b >= 1e12) return (b / 1e12).toFixed(1) + ' TB';
    if (b >= 1e9)  return (b / 1e9).toFixed(1)  + ' GB';
    if (b >= 1e6)  return (b / 1e6).toFixed(1)  + ' MB';
    return (b / 1e3).toFixed(0) + ' KB';
  }

  function update(data) {
    const cpuEl  = document.getElementById('stat-cpu-val');
    if (!cpuEl) return;
    const memEl  = document.getElementById('stat-mem-val');
    const diskEl = document.getElementById('stat-disk-val');
    const netEl  = document.getElementById('stat-net-val');

    const cpu = data.cpu ?? 0;
    cpuEl.textContent = cpu + '%';
    cpuEl.style.color = heatColor(cpu);

    const mem = data.mem;
    if (mem) {
      memEl.textContent = mem.pct + '%';
      memEl.style.color = heatColor(mem.pct);
      document.getElementById('stat-mem-tip').title =
        `Memory: ${fmtBytes(mem.used)} / ${fmtBytes(mem.total)}`;
    }

    const disk = data.disk;
    if (disk && diskEl) {
      const mbpsStr = disk.mbps >= 1 ? disk.mbps.toFixed(1) + ' MB/s' : (disk.mbps * 1000).toFixed(0) + ' KB/s';
      diskEl.textContent = mbpsStr;
      diskEl.style.color = heatColor(disk.pct);
      document.getElementById('stat-disk-tip').title = `Disk I/O: ${mbpsStr} (${disk.pct}% busy)`;
    }

    const net = data.net;
    if (net && netEl) {
      const mbpsStr = net.mbps >= 1 ? net.mbps.toFixed(1) + ' Mbps' : (net.mbps * 1000).toFixed(0) + ' Kbps';
      netEl.textContent = mbpsStr;
      netEl.style.color = heatColor(net.pct);
      document.getElementById('stat-net-tip').title = `Network: ${mbpsStr} (max 1 Gbps)`;
    }
  }

  WS.on('stats:push', update);

  // Request initial stats right away
  WS.send('stats:get').then(update).catch(() => {});

  return { update };
})();
