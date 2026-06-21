// stream.js
const StreamView = (function() {
  let container;

  function render(appContainer) {
    container = document.createElement('div');
    container.className = 'stream-view active';
    appContainer.appendChild(container);

    container.innerHTML = `
      <div class="stream-header" style="padding: 20px 4%; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 0px; position: relative; background: var(--bg-surface); z-index: 10;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h1 style="font-size: 2.2rem; font-weight: 800; margin-bottom: 0; color: var(--text-primary);">Explorer RTC (WebRTC Engine)</h1>
          </div>
        </div>
      </div>
      <div style="width: 100%; height: calc(100% - 85px); position: relative; background: #000;">
        <iframe id="moonlight-webrtc-frame" src="http://localhost:8080" style="width: 100%; height: 100%; border: none; outline: none; display: block;"></iframe>
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
