/* Shared lazy video-preview controller — gallery mosaic and Netflix cards both
   show a static frame by default and only request the (ffmpeg-generated)
   preview clip on hover/tap, instead of loading a clip for every visible
   thumbnail at once. */
const VideoPreview = (() => {
  let active = null; // the one controller currently tap-armed on touch

  function makeController(containerEl, getUrl, opts = {}) {
    const readyClass = opts.readyClass || 'preview-ready';
    const videoClass  = opts.videoClass  || 'video-preview-clip';
    let videoEl = null;

    function load() {
      if (videoEl) return videoEl;
      videoEl = document.createElement('video');
      videoEl.className = videoClass;
      videoEl.muted = true;
      videoEl.loop = true;
      videoEl.playsInline = true;
      videoEl.preload = 'auto';
      videoEl.src = getUrl();
      videoEl.addEventListener('loadeddata', () => containerEl.classList.add(readyClass), { once: true });
      videoEl.onerror = () => unload();
      containerEl.appendChild(videoEl);
      videoEl.play().catch(() => {});
      return videoEl;
    }

    function unload() {
      if (active === ctrl) active = null;
      if (!videoEl) return;
      videoEl.pause();
      videoEl.remove();
      videoEl = null;
      containerEl.classList.remove(readyClass);
    }

    const ctrl = { load, unload, get loaded() { return !!videoEl; } };
    return ctrl;
  }

  // Only one tap-armed (touch) preview should be active at a time — arming a
  // new one unloads whatever was previously armed.
  function armExclusive(ctrl) {
    if (active && active !== ctrl) active.unload();
    active = ctrl;
  }

  function isTouch() {
    return matchMedia('(hover: none)').matches;
  }

  return { makeController, armExclusive, isTouch };
})();
