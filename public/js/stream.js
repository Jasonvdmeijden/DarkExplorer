// stream.js - Stream View UI

window.StreamView = (function() {
  let container = null;

  function render(hostEl, pathStr) {
    container = hostEl;
    
    // We seamlessly embed the Moonlight WebRTC Proxy directly into DarkExplorer's UI
    container.innerHTML = `
      <div class="stream-header" style="padding: 20px 4%; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface);">
        <div>
          <h1 style="font-size: 1.8rem; font-weight: 800; margin: 0; color: var(--text-primary);">Explorer RTC (Powered by Sunshine)</h1>
          <p style="font-size: 0.9rem; color: var(--text-muted); margin: 5px 0 0 0;">Zero-Latency WebRTC, Gamepad, and Audio Support.</p>
        </div>
      </div>
      <div style="width: 100%; height: calc(100% - 85px); position: relative;">
        <iframe src="http://localhost:8080" style="width: 100%; height: 100%; border: none; background: #000;"></iframe>
      </div>
    `;
  }

  function hide() {
    if (container) {
      container.innerHTML = '';
      container = null;
    }
  }

  return { render, hide };
})();
