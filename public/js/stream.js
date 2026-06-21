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
      <div style="width: 100%; height: calc(100% - 85px); position: relative; background: #000;" id="webrtc-container">
        <!-- iframe will be injected here with dynamic host -->
      </div>
    `;

    // Dynamically inject iframe to use the correct hostname instead of hardcoded localhost
    const proxyUrl = window.location.protocol + "//" + window.location.hostname + ":8080";
    const iframe = document.createElement('iframe');
    iframe.id = "moonlight-webrtc-frame";
    iframe.src = proxyUrl;
    iframe.style = "width: 100%; height: 100%; border: none; outline: none; display: block;";
    iframe.allow = "gamepad; microphone; autoplay; fullscreen; display-capture; clipboard-read; clipboard-write";
    
    document.getElementById('webrtc-container').appendChild(iframe);
  }

  function hide() {
    if (container) {
      container.innerHTML = '';
      container = null;
    }
  }

  return { render, hide };
})();
