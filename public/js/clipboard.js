/* Clipboard — server buffer mode and browser download mode */
const Clipboard = (() => {
  let mode = null; // 'copy' | 'cut'

  async function set(paths, op) {
    mode = op;
    await WS.send('clipboard:set', { paths, op });
    updateStatus(paths.length, op);
  }

  async function paste(destPath) {
    const buf = await WS.send('clipboard:get');
    if (!buf || !buf.paths || !buf.paths.length) return;
    if (buf.op === 'cut') {
      await WS.send('fs:move', { sources: buf.paths, dest: destPath });
      await WS.send('clipboard:clear');
    } else {
      await WS.send('fs:copy', { sources: buf.paths, dest: destPath });
    }
    Explorer.refresh();
  }

  async function download(paths) {
    for (const p of paths) {
      const token = localStorage.getItem('de_token') || '';
      const a = document.createElement('a');
      a.href = `/download?path=${encodeURIComponent(p)}&token=${token}`;
      a.download = '';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // brief delay between multiple downloads
      if (paths.length > 1) await delay(300);
    }
  }

  function updateStatus(count, op) {
    const label = op === 'cut' ? 'cut' : 'copied';
    document.getElementById('status-items').textContent =
      `${count} item${count !== 1 ? 's' : ''} ${label}`;
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  return { set, paste, download };
})();
