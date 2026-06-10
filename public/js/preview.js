/* File preview — <dialog> modal with showModal() top-layer rendering */
const Preview = (() => {
  const modal   = document.getElementById('preview-modal');
  const content = document.getElementById('preview-content');
  const titleEl = document.getElementById('preview-modal-title');
  const iconEl  = document.getElementById('preview-modal-icon');
  const prevBtn = document.getElementById('btn-preview-prev');
  const nextBtn = document.getElementById('btn-preview-next');
  let currentMode = 'raw';
  let currentFile = null;
  let rawContent  = null;
  let navItems    = [];
  let navIdx      = -1;
  let navLayout   = { view: 'details', cols: 4 }; // Added layout tracking
  let _zoomCleanup = null;
  let _fromRemote  = false;

  // Cross-device: sync preview open/close
  State.onChange('activePreview', (fileStat) => {
    if (!fileStat) { if (modal.open) close(true); return; }
    if (modal.open && currentFile?.path === fileStat.path) return;
    _fromRemote = true;
    open(fileStat, null);
    _fromRemote = false;
  });

  // File types with a rich rendered view
  const RICH_EXTS = new Set([
    'md', 'html', 'htm', 'csv',
    'pdf', 'docx', 'doc', 'odt',
    'xlsx', 'xls', 'xlsm', 'ods',
    'pptx', 'ppt', 'odp',
    'zip'
  ]);
  // Binary / non-text types — hide Raw tab (would show garbage)
  const NO_RAW_EXTS = new Set([
    'pdf', 'docx', 'doc', 'odt',
    'xlsx', 'xls', 'xlsm', 'ods',
    'pptx', 'ppt', 'odp',
    'zip', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico', 'tiff', 'tif',
    'heic', 'heif', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2',
    'mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', '3gp', 'flv', 'ogv',
    'mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a', 'm4b', 'opus'
  ]);

  const editBtn = document.getElementById('btn-preview-edit');
  const tabRich = modal.querySelector('[data-mode="rich"]');
  const tabRaw  = modal.querySelector('[data-mode="raw"]');

  // File types with no useful plain-text content (suppress Edit button)
  const BINARY_EXTS = new Set([
    'jpg','jpeg','png','gif','webp','avif','svg','bmp','ico','tiff','tif',
    'heic','heif','dng','cr2','cr3','nef','arw','raf','orf','rw2',
    'mp4','webm','mov','mkv','avi','m4v','3gp','flv','ogv',
    'mp3','ogg','wav','flac','aac','m4a','m4b','opus','mid',
    'pdf','docx','doc','odt','xlsx','xls','xlsm','ods','pptx','ppt','odp',
    'zip','rar','7z','tar','gz','exe','msi','dll','app','dmg','pkg'
  ]);

  async function open(fileStat, newNavItems, layout) {
    if (_zoomCleanup) { _zoomCleanup(); _zoomCleanup = null; }
    currentFile = fileStat;
    rawContent  = null;
    if (layout) navLayout = layout; // Save layout context

    titleEl.textContent = fileStat.name || fileStat.url || 'Preview';
    iconEl.textContent  = fileIcon(fileStat);
    if (!_fromRemote) State.set('activePreview', fileStat);

    navItems = Array.isArray(newNavItems) ? newNavItems.filter(i => !i.isDir) : [];
    navIdx   = navItems.findIndex(i => i.path === fileStat.path);

    // URL bookmark: open in iframe
    if (fileStat.url) {
      tabRich.style.display = '';
      tabRaw.style.display  = 'none';
      modal.showModal();
      updateNavButtons();
      setMode('rich');
      return;
    }

    // Folders: show metadata only — never try to read a directory as a file
    if (fileStat.isDir) {
      tabRich.style.display = 'none';
      tabRaw.style.display  = 'none';
      modal.showModal();
      updateNavButtons();
      setMode('meta');
      return;
    }

    const ext     = (fileStat.ext || '').replace('.', '').toLowerCase();
    const hasRich = RICH_EXTS.has(ext);
    const hasRaw  = !NO_RAW_EXTS.has(ext);

    tabRich.style.display = hasRich ? '' : 'none';
    tabRaw.style.display  = hasRaw  ? '' : 'none';

    modal.showModal();
    updateNavButtons();
    setMode(hasRich ? 'rich' : 'raw');
  }

  function updateNavButtons() {
    const show = navItems.length > 1;
    prevBtn.style.display = show ? '' : 'none';
    nextBtn.style.display = show ? '' : 'none';
    if (show) {
      prevBtn.disabled = navIdx <= 0;
      nextBtn.disabled = navIdx >= navItems.length - 1;
    }
  }

  function openItem(idx) {
    if (idx < 0 || idx >= navItems.length) return;
    navIdx = idx;
    open(navItems[navIdx], navItems);
  }

  prevBtn.addEventListener('click', () => openItem(navIdx - 1));
  nextBtn.addEventListener('click', () => openItem(navIdx + 1));

  document.addEventListener('keydown', (e) => {
    if (!modal.open) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    // Left/Right: Standard sequence
    if (e.key === 'ArrowLeft')  { e.preventDefault(); openItem(navIdx - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); openItem(navIdx + 1); }

    // Up/Down: Multi-directional grid navigation
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (navLayout.view === 'mosaic') openItem(navIdx - navLayout.cols);
      else openItem(navIdx - 1);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (navLayout.view === 'mosaic') openItem(navIdx + navLayout.cols);
      else openItem(navIdx + 1);
    }
  });

  // Find the nearest scrollable ancestor up to (but not including) `stopAt`.
  // Used to suppress swipe-to-close when the user is mid-scroll inside content.
  function _getScrollableAncestor(el, stopAt) {
    let cur = el;
    while (cur && cur !== stopAt && cur !== document.body) {
      const cs = getComputedStyle(cur);
      if (/auto|scroll/.test(cs.overflowY) && cur.scrollHeight > cur.clientHeight + 1) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  // ── Touch swipe navigation + swipe-down-to-close (mobile) ─────────────
  (function attachSwipe() {
    let start = null;
    const NAV_DX_MIN  = 50;     // px — horizontal distance for prev/next
    const NAV_DY_MAX  = 40;     // px — max vertical drift for horizontal swipe
    const CLOSE_DY    = 120;    // px — downward distance to trigger close
    const CLOSE_DX_MAX= 80;     // px — max horizontal drift for vertical swipe
    const GESTURE_MS_MAX = 600; // ms — max gesture duration
    const blockSel = 'audio, video, input, textarea, select, button, a, #preview-resize-handle';

    modal.addEventListener('touchstart', (e) => {
      if (!modal.open || e.touches.length !== 1)          { start = null; return; }
      if (e.target.closest(blockSel))                     { start = null; return; }
      // Carousel strip handles its own touches
      if (document.getElementById('preview-swipe-strip')) { start = null; return; }
      const t = e.touches[0];
      const scroller = _getScrollableAncestor(e.target, modal);
      start = { x: t.clientX, y: t.clientY, t: Date.now(), scrollTopAtStart: scroller?.scrollTop ?? 0 };
    }, { passive: true });

    modal.addEventListener('touchmove', (e) => {
      if (!start) return;
      if (e.touches.length > 1) start = null;
    }, { passive: true });

    modal.addEventListener('touchend', (e) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const dt = Date.now() - start.t;
      const wasAtTop = start.scrollTopAtStart <= 0;
      start = null;
      if (dt > GESTURE_MS_MAX) return;

      // Horizontal: prev/next navigation (requires >1 nav items)
      if (Math.abs(dx) >= NAV_DX_MIN && Math.abs(dy) < NAV_DY_MAX && navItems.length > 1) {
        if (dx > 0) openItem(navIdx - 1);
        else        openItem(navIdx + 1);
        return;
      }
      // Vertical down: close — only if user wasn't mid-scroll
      if (dy >= CLOSE_DY && Math.abs(dx) < CLOSE_DX_MAX && wasAtTop) {
        close();
      }
    }, { passive: true });
  })();

  function close(_fromRemoteClose = false) {
    if (_zoomCleanup) { _zoomCleanup(); _zoomCleanup = null; }
    if (!_fromRemoteClose) State.set('activePreview', null);
    modal.close();
    currentFile = null;
    rawContent  = null;
    navItems    = [];
    navIdx      = -1;
    content.innerHTML = '';
    content.style.padding       = '';
    content.style.overflow      = '';
    content.style.display       = '';
    content.style.alignItems    = '';
    content.style.justifyContent= '';
    content.style.flexDirection = '';
    editBtn.style.display = 'none';
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  }

  async function render() {
    if (_zoomCleanup) { _zoomCleanup(); _zoomCleanup = null; }
    if (!currentFile) return;
    const ext = (currentFile.ext || '').replace('.', '').toLowerCase();
    content.innerHTML = '';
    content.style.padding       = '';
    content.style.overflow      = '';
    content.style.display       = '';
    content.style.alignItems    = '';
    content.style.justifyContent= '';
    content.style.flexDirection = '';

    if (currentFile.url) return renderUrl();
    if (['jpg','jpeg','png','gif','webp','avif','svg','bmp','ico','tiff','tif','heic','heif','dng','cr2','cr3','nef','arw','raf','orf','rw2'].includes(ext)) return renderImage();
    if (['mp4','webm','mov','mkv','avi','m4v','3gp','flv','ogv'].includes(ext))               return renderVideo();
    if (['mp3','ogg','wav','flac','aac','m4a','m4b','opus'].includes(ext))                    return renderAudio();
    if (ext === 'pdf')                                                                        return renderPdf();
    if (ext === 'csv')                                                                        return renderCsv();
    if (ext === 'md')                                                                         return renderMarkdown();
    if (ext === 'html' || ext === 'htm') {
      if (currentMode === 'rich') return renderHtmlIframe();
      return renderCode(ext);
    }
    if (['docx','doc','odt'].includes(ext))        return renderDocx();
    if (['xlsx','xls','xlsm','ods'].includes(ext)) return renderXlsx();
    if (['pptx','ppt','odp'].includes(ext))        return renderUnsupported('Presentation preview is not supported');
    if (ext === 'zip')                              return renderZip();
    return renderCode(ext);
  }

  // ── content fetchers ─────────────────────────────────────────────────────────

  let _readMeta = null; // { tooLarge?, truncated?, size?, shown?, limit? }

  function _renderTooLarge(meta) {
    const token = localStorage.getItem('de_token') || '';
    content.style.display       = 'flex';
    content.style.flexDirection = 'column';
    content.style.alignItems    = 'center';
    content.style.justifyContent= 'center';
    content.style.gap           = '.8rem';
    content.style.padding       = '2rem';
    content.style.textAlign     = 'center';
    const fmt = (b) => b < 1024*1024 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB';
    content.innerHTML = `
      <div style="font-size:3rem;opacity:.6">📄</div>
      <div style="font-size:.95rem;color:var(--text-primary)">File is too large to preview</div>
      <div style="font-size:.8rem;color:var(--text-muted)">${fmt(meta.size)} (limit ${fmt(meta.limit)})</div>
      <div style="display:flex;gap:.5rem;margin-top:.5rem">
        <a href="/serve?path=${encodeURIComponent(currentFile.path)}&token=${token}" target="_blank" rel="noopener" style="padding:.4rem .9rem;background:var(--accent);color:#fff;border-radius:var(--radius-sm);text-decoration:none;font-size:.85rem">Open in new tab</a>
        <a href="/download?path=${encodeURIComponent(currentFile.path)}&token=${token}" style="padding:.4rem .9rem;background:var(--bg-hover);color:var(--text-primary);border-radius:var(--radius-sm);text-decoration:none;font-size:.85rem">Download</a>
      </div>`;
  }

  function _renderTruncatedBanner(meta) {
    const banner = document.createElement('div');
    const fmt = (b) => b < 1024*1024 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB';
    banner.style.cssText = 'position:sticky;top:0;background:var(--accent-dim);color:var(--accent);padding:.4rem .8rem;font-size:.78rem;border-bottom:1px solid var(--border);z-index:5';
    const token = localStorage.getItem('de_token') || '';
    banner.innerHTML = `Showing first ${fmt(meta.shown)} of ${fmt(meta.size)} —
      <a href="/download?path=${encodeURIComponent(currentFile.path)}&token=${token}" style="color:inherit;font-weight:600">download full file</a>`;
    content.insertBefore(banner, content.firstChild);
  }

  async function getContent() {
    if (rawContent !== null) return rawContent;
    try {
      const res = await WS.send('fs:read', { path: currentFile.path });
      _readMeta = res;
      if (res.tooLarge) { _renderTooLarge(res); return null; }
      rawContent = res.content;
      // Defer banner insertion until renderer's synchronous content write is done
      if (res.truncated) setTimeout(() => _renderTruncatedBanner(res), 0);
      return rawContent;
    } catch {
      return null;
    }
  }

  async function getBase64() {
    try {
      const res = await WS.send('fs:readBase64', { path: currentFile.path });
      if (res.tooLarge) { _renderTooLarge(res); return null; }
      return res.content;
    } catch {
      return null;
    }
  }

  // ── renderers ────────────────────────────────────────────────────────────────

  async function renderMarkdown() {
    const text = await getContent();
    if (text === null) { content.textContent = 'Could not read file.'; return; }
    if (currentMode === 'raw') { renderHighlighted(text, 'markdown'); return; }
    const html = window.marked ? marked.parse(text) : `<pre>${escHtml(text)}</pre>`;
    content.innerHTML = html;
    if (window.mermaid) {
      content.querySelectorAll('code.language-mermaid').forEach((el) => {
        const wrap = document.createElement('div');
        wrap.className = 'mermaid';
        wrap.textContent = el.textContent;
        el.parentElement.replaceWith(wrap);
      });
      mermaid.init(undefined, content.querySelectorAll('.mermaid'));
    }
    if (window.hljs) {
      content.querySelectorAll('pre code:not(.language-mermaid)').forEach(el => hljs.highlightElement(el));
    }
  }

  async function renderCode(lang) {
    const text = await getContent();
    if (text === null) { content.textContent = 'Could not read file.'; return; }
    renderHighlighted(text, lang);
  }

  function renderHighlighted(text, lang) {
    const pre  = document.createElement('pre');
    const code = document.createElement('code');
    if (lang && window.hljs && hljs.getLanguage(lang)) {
      code.className = `language-${lang}`;
      code.textContent = text;
      pre.appendChild(code);
      content.appendChild(pre);
      hljs.highlightElement(code);
    } else {
      code.textContent = text;
      pre.appendChild(code);
      content.appendChild(pre);
    }
  }

  async function renderHtmlIframe() {
    const text = await getContent();
    if (text === null) { content.textContent = 'Could not read file.'; return; }
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.srcdoc  = text;
    iframe.style.cssText = 'width:100%;height:100%;border:none';
    content.appendChild(iframe);
  }

  const IMG_EXT_SET = new Set(['jpg','jpeg','png','gif','webp','avif','svg','bmp','ico','tiff','tif','heic','heif','dng','cr2','cr3','nef','arw','raf','orf','rw2']);
  const VID_EXT_SET = new Set(['mp4','webm','mov','mkv','avi','m4v','3gp','flv','ogv','wmv','ts','m2ts']);
  // Containers Chrome can't reliably play (or fails silently on) → eagerly route to /transcode,
  // which writes a +faststart MP4 to disk and serves with full Range support.
  // Native-playable containers stay on /serve for instant playback.
  const VIDEO_DIRECT_OK_EXTS = new Set(['mp4','webm','m4v']);
  function _videoSrc(item) {
    const ext = (item.ext || '').replace('.','').toLowerCase();
    const token = localStorage.getItem('de_token') || '';
    const route = VIDEO_DIRECT_OK_EXTS.has(ext) ? '/serve' : '/transcode';
    return `${route}?path=${encodeURIComponent(item.path)}&token=${token}`;
  }
  function _videoTranscodeSrc(item) {
    const token = localStorage.getItem('de_token') || '';
    return `/transcode?path=${encodeURIComponent(item.path)}&token=${token}`;
  }

  function _isMediaItem(item) {
    if (!item || item.isDir) return false;
    const e = (item.ext || '').replace('.','').toLowerCase();
    return IMG_EXT_SET.has(e) || VID_EXT_SET.has(e);
  }

  function _makeMediaSlide(item, isCurrent) {
    const token = localStorage.getItem('de_token') || '';
    const slide = document.createElement('div');
    slide.className = 'preview-swipe-slide';
    slide.style.cssText = 'flex:0 0 33.3333%;width:33.3333%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;position:relative';
    if (!item) return slide;

    const ext = (item.ext || '').replace('.','').toLowerCase();
    const isVideo = VID_EXT_SET.has(ext);

    // Loading spinner (removed on first frame / load event)
    const spinner = document.createElement('div');
    spinner.className = 'preview-slide-loader';
    slide.appendChild(spinner);
    const clearSpinner = () => { if (spinner.parentNode) spinner.remove(); };

    if (isVideo && isCurrent) {
      const v = document.createElement('video');
      v.src         = _videoSrc(item);
      v.controls    = true;
      v.preload     = 'metadata';
      // iOS Safari: keep playback inline. Without this, iOS hijacks into its native
      // fullscreen player, and after exit the element ends up in a state where play()
      // is silently rejected. With playsinline, fullscreen becomes opt-in (controls button).
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.style.cssText = 'max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;background:#000';
      v.addEventListener('loadedmetadata', clearSpinner, { once: true });
      v.addEventListener('canplay',        clearSpinner, { once: true });
      // If direct serve fails, transparently retry through the transcoder.
      // Some MKVs/AVIs need server-side remux to be browser-playable.
      let _retried = false;
      v.addEventListener('error', () => {
        if (_retried) { clearSpinner(); return; }
        _retried = true;
        if (v.src.indexOf('/transcode') === -1) {
          console.warn('[preview] direct serve failed for', item.name, '— retrying with /transcode');
          v.src = _videoTranscodeSrc(item);
          v.load();
        } else {
          clearSpinner();
        }
      });
      slide.appendChild(v);
    } else if (isVideo) {
      // Adjacent video → cheap thumbnail preview only
      const img = document.createElement('img');
      img.src = `/thumbnail?path=${encodeURIComponent(item.path)}&width=800&token=${token}`;
      img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;display:block;user-select:none;-webkit-user-drag:none';
      img.draggable = false;
      img.addEventListener('load',  clearSpinner, { once: true });
      img.addEventListener('error', clearSpinner, { once: true });
      slide.appendChild(img);
    } else if (item.livePhotoMov && isCurrent) {
      // iPhone Live Photo (current slide): play the .MOV once, then swap to the still image.
      const vid = document.createElement('video');
      vid.src         = `/serve?path=${encodeURIComponent(item.livePhotoMov)}&token=${token}`;
      vid.autoplay    = true;
      vid.muted       = true;
      vid.setAttribute('playsinline', '');
      vid.style.cssText = 'max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;display:block;background:#000';
      vid.addEventListener('loadeddata', clearSpinner, { once: true });
      const swapToStill = () => {
        const img = document.createElement('img');
        img.src = `/serve?path=${encodeURIComponent(item.path)}&token=${token}`;
        img.style.cssText = vid.style.cssText + ';object-fit:contain';
        vid.replaceWith(img);
      };
      vid.addEventListener('ended', swapToStill, { once: true });
      vid.addEventListener('error', () => { clearSpinner(); swapToStill(); }, { once: true });
      slide.appendChild(vid);
      const badge = document.createElement('span');
      badge.className = 'live-photo-badge';
      badge.textContent = 'LIVE';
      slide.appendChild(badge);
    } else {
      // Image (current or adjacent — preloaded by simply being in the DOM)
      const img = document.createElement('img');
      img.src = `/serve?path=${encodeURIComponent(item.path)}&token=${token}`;
      img.style.cssText = 'max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;display:block;user-select:none;-webkit-user-drag:none';
      img.draggable = false;
      img.addEventListener('load',  clearSpinner, { once: true });
      img.addEventListener('error', clearSpinner, { once: true });
      slide.appendChild(img);
    }
    return slide;
  }

  // Build the swipe strip for the current media item. Called from renderImage / renderVideo on mobile.
  function _renderMediaCarousel() {
    content.style.padding  = '0';
    content.style.overflow = 'hidden';
    content.style.position = 'relative';

    const strip = document.createElement('div');
    strip.id = 'preview-swipe-strip';
    strip.style.cssText = 'display:flex;width:300%;height:100%;transform:translateX(-33.3333%);will-change:transform;touch-action:pan-y';

    const prev = navItems[navIdx - 1] || null;
    const curr = navItems[navIdx];
    const next = navItems[navIdx + 1] || null;

    strip.appendChild(_makeMediaSlide(prev, false));
    strip.appendChild(_makeMediaSlide(curr, true));
    strip.appendChild(_makeMediaSlide(next, false));

    content.appendChild(strip);
    _attachStripSwipe(strip);
  }

  function _attachStripSwipe(strip) {
    let startX = null, startY = null;
    let width = 0;
    let locked = null; // 'x' | 'y' | null — gesture axis once decided
    const DECIDE_PX = 8;

    const onStart = (e) => {
      if (e.touches.length !== 1) { startX = null; return; }
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY;
      width  = strip.offsetWidth / 3;
      locked = null;
      strip.style.transition = 'none';
    };

    const onMove = (e) => {
      if (startX === null || e.touches.length > 1) { startX = null; return; }
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!locked) {
        if (Math.abs(dx) > DECIDE_PX || Math.abs(dy) > DECIDE_PX) {
          locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        } else return;
      }
      if (locked !== 'x') return;
      // Resist swiping past the ends
      let useDx = dx;
      if ((dx > 0 && navIdx <= 0) || (dx < 0 && navIdx >= navItems.length - 1)) {
        useDx = dx * 0.3; // rubber-band
      }
      strip.style.transform = `translate3d(calc(-33.3333% + ${useDx}px), 0, 0)`;
    };

    const onEnd = (e) => {
      if (startX === null) { return; }
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const lockedAxis = locked;
      startX = null;

      // Vertical-down swipe closes the modal (no inner scroll to worry about — strip has overflow hidden)
      if (lockedAxis === 'y' && dy > 120 && Math.abs(dx) < 80) {
        close();
        return;
      }
      if (lockedAxis !== 'x') return;

      strip.style.transition = 'transform .22s cubic-bezier(.2,.9,.3,1)';
      const threshold = Math.min(80, width * 0.2);

      const goingPrev = dx > threshold && navIdx > 0;
      const goingNext = dx < -threshold && navIdx < navItems.length - 1;

      if (goingPrev) {
        strip.style.transform = 'translate3d(0, 0, 0)';
        strip.addEventListener('transitionend', () => openItem(navIdx - 1), { once: true });
      } else if (goingNext) {
        strip.style.transform = 'translate3d(-66.6666%, 0, 0)';
        strip.addEventListener('transitionend', () => openItem(navIdx + 1), { once: true });
      } else {
        strip.style.transform = 'translate3d(-33.3333%, 0, 0)';
      }
    };

    strip.addEventListener('touchstart', onStart, { passive: true });
    strip.addEventListener('touchmove',  onMove,  { passive: true });
    strip.addEventListener('touchend',   onEnd,   { passive: true });
    strip.addEventListener('touchcancel',onEnd,   { passive: true });
  }

  function _useMobileCarousel() {
    return window.innerWidth <= 768 && navItems.length > 1 && _isMediaItem(currentFile);
  }

  function renderImage() {
    if (_useMobileCarousel()) return _renderMediaCarousel();
    const token = localStorage.getItem('de_token') || '';
    content.style.padding  = '0';
    content.style.overflow = 'hidden';
    content.style.position = 'relative';

    // iPhone Live Photo: play the .MOV once, then swap to the still HEIC
    if (currentFile.livePhotoMov) {
      const vid = document.createElement('video');
      vid.src = `/serve?path=${encodeURIComponent(currentFile.livePhotoMov)}&token=${token}`;
      vid.autoplay = true; vid.muted = true;
      vid.setAttribute('playsinline', '');
      vid.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;background:#000';
      const swapToStill = () => {
        const img = document.createElement('img');
        img.src = `/serve?path=${encodeURIComponent(currentFile.path)}&token=${token}`;
        img.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;cursor:grab;transform-origin:center center';
        vid.replaceWith(img);
        if (_zoomCleanup) { _zoomCleanup(); _zoomCleanup = null; }
        _zoomCleanup = makeZoomable(img);
      };
      vid.addEventListener('ended', swapToStill, { once: true });
      vid.addEventListener('error', swapToStill, { once: true });
      content.appendChild(vid);
      const badge = document.createElement('span');
      badge.className = 'live-photo-badge';
      badge.textContent = 'LIVE';
      content.appendChild(badge);
      return;
    }

    const img = document.createElement('img');
    img.src = `/serve?path=${encodeURIComponent(currentFile.path)}&token=${token}`;
    img.style.display         = 'block';
    img.style.width           = '100%';
    img.style.height          = '100%';
    img.style.objectFit       = 'contain';
    img.style.cursor          = 'grab';
    img.style.transformOrigin = 'center center';
    content.appendChild(img);
    _zoomCleanup = makeZoomable(img);
  }

  function renderVideo() {
    if (_useMobileCarousel()) return _renderMediaCarousel();
    const token = localStorage.getItem('de_token') || '';
    content.style.padding  = '0';
    content.style.overflow = 'hidden';
    const video = document.createElement('video');
    video.src = _videoSrc(currentFile);
    video.controls = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.style.display    = 'block';
    video.style.width      = '100%';
    video.style.height     = '100%';
    video.style.objectFit  = 'contain';
    video.style.background = '#000';
    // Fall back to /transcode if direct serve fails
    let _retried = false;
    video.addEventListener('error', () => {
      if (_retried) return;
      _retried = true;
      if (video.src.indexOf('/transcode') === -1) {
        console.warn('[preview] direct serve failed for', currentFile.name, '— retrying with /transcode');
        video.src = _videoTranscodeSrc(currentFile);
        video.load();
      }
    });
    content.appendChild(video);
  }

  function renderAudio() {
    const token = localStorage.getItem('de_token') || '';
    content.style.display       = 'flex';
    content.style.flexDirection = 'column';
    content.style.alignItems    = 'center';
    content.style.justifyContent= 'center';
    content.style.gap           = '1rem';
    content.style.padding       = '2rem';

    const icon = document.createElement('div');
    icon.textContent = '🎵';
    icon.style.cssText = 'font-size:5rem;opacity:.8';

    const name = document.createElement('div');
    name.textContent = currentFile.name || '';
    name.style.cssText = 'font-size:.95rem;color:var(--text-secondary);max-width:90%;text-align:center;word-break:break-all';

    const audio = document.createElement('audio');
    audio.src      = `/serve?path=${encodeURIComponent(currentFile.path)}&token=${token}`;
    audio.controls = true;
    audio.preload  = 'metadata';
    audio.style.cssText = 'width:min(90%,560px);outline:none';
    audio.addEventListener('error', () => {
      const err = document.createElement('div');
      err.textContent = 'Could not play this audio file (unsupported codec or browser restriction).';
      err.style.cssText = 'color:var(--danger);font-size:.85rem';
      content.appendChild(err);
    });

    content.appendChild(icon);
    content.appendChild(name);
    content.appendChild(audio);
  }

  function renderPdf() {
    const token = localStorage.getItem('de_token') || '';
    content.style.padding  = '0';
    content.style.overflow = 'hidden';
    const iframe = document.createElement('iframe');
    iframe.src = `/serve?path=${encodeURIComponent(currentFile.path)}&token=${token}#toolbar=1&navpanes=0&scrollbar=1`;
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;background:#fff';
    content.appendChild(iframe);
    
    // Add a small helper message for browsers that might block the iframe
    const helper = document.createElement('div');
    helper.style.cssText = 'position:absolute;bottom:10px;right:10px;font-size:10px;color:#888;pointer-events:none';
    helper.textContent = 'Use native viewer if preview fails';
    content.appendChild(helper);
  }

  async function renderCsv() {
    const text = await getContent();
    if (text === null) { content.textContent = 'Could not read file.'; return; }

    if (currentMode === 'raw') { renderHighlighted(text, 'csv'); return; }

    const lines = text.trim().split(/\r?\n/);
    if (lines.length === 0) { content.textContent = 'Empty file.'; return; }

    const rows  = lines.map(parseCsvLine);
    const table = document.createElement('table');
    table.className = 'csv-table';

    const thead = document.createElement('thead');
    const hrow  = document.createElement('tr');
    rows[0].forEach(cell => {
      const th = document.createElement('th');
      th.textContent = cell;
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.slice(1).forEach(row => {
      const tr = document.createElement('tr');
      row.forEach(cell => {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    content.appendChild(table);
  }

  function parseCsvLine(line) {
    const result = [];
    let inQuote = false;
    let cell = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuote && line[i + 1] === '"') { cell += '"'; i++; }
        else inQuote = !inQuote;
      } else if (c === ',' && !inQuote) {
        result.push(cell); cell = '';
      } else {
        cell += c;
      }
    }
    result.push(cell);
    return result;
  }

  async function renderDocx() {
    if (!window.mammoth) {
      renderUnsupported('Word preview requires mammoth.js — still loading, please retry');
      return;
    }
    const b64 = await getBase64();
    if (!b64) { content.textContent = 'Could not read file.'; return; }

    const binary = atob(b64);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);

    try {
      const result  = await mammoth.convertToHtml({ arrayBuffer: buf.buffer });
      const wrapper = document.createElement('div');
      wrapper.className = 'docx-content';
      wrapper.innerHTML = result.value;
      content.appendChild(wrapper);
    } catch (e) {
      content.textContent = 'Failed to render document: ' + e.message;
    }
  }

  async function renderXlsx() {
    if (!window.XLSX) {
      renderUnsupported('Spreadsheet preview requires SheetJS — still loading, please retry');
      return;
    }
    const b64 = await getBase64();
    if (!b64) { content.textContent = 'Could not read file.'; return; }

    try {
      const workbook = XLSX.read(b64, { type: 'base64' });

      content.style.padding      = '0';
      content.style.overflow     = 'hidden';
      content.style.display      = 'flex';
      content.style.flexDirection = 'column';

      const sheetTabsEl = document.createElement('div');
      sheetTabsEl.className = 'xlsx-tabs';

      const sheetBodyEl = document.createElement('div');
      sheetBodyEl.className = 'xlsx-body';

      content.appendChild(sheetTabsEl);
      content.appendChild(sheetBodyEl);

      function showSheet(name) {
        sheetTabsEl.querySelectorAll('.xlsx-tab').forEach(t =>
          t.classList.toggle('active', t.dataset.sheet === name)
        );
        const sheet = workbook.Sheets[name];
        const html  = XLSX.utils.sheet_to_html(sheet, { editable: false });
        sheetBodyEl.innerHTML = html;
        const tbl = sheetBodyEl.querySelector('table');
        if (tbl) tbl.className = 'xlsx-table';
      }

      workbook.SheetNames.forEach(name => {
        const tab = document.createElement('button');
        tab.className     = 'xlsx-tab';
        tab.dataset.sheet = name;
        tab.textContent   = name;
        tab.addEventListener('click', () => showSheet(name));
        sheetTabsEl.appendChild(tab);
      });

      if (workbook.SheetNames.length > 0) showSheet(workbook.SheetNames[0]);
    } catch (e) {
      content.textContent = 'Failed to render spreadsheet: ' + e.message;
    }
  }

  async function renderZip() {
    try {
      const res = await WS.send('zip:preview', { path: currentFile.path });
      content.style.overflow = 'auto';
      const info = document.createElement('div');
      info.style.cssText = 'padding:.4rem .75rem;font-size:.78rem;color:var(--text-muted)';
      info.textContent = `${res.entries.length} entries`;
      content.appendChild(info);
      const table = document.createElement('table');
      table.className = 'csv-table';
      table.innerHTML = `<thead><tr><th>Name</th><th style="text-align:right">Size</th><th style="text-align:right">Compressed</th></tr></thead>`;
      const tbody = document.createElement('tbody');
      res.entries.forEach(e => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="font-family:var(--font-mono);font-size:.82rem">${e.isDir ? '📁 ' : '📄 '}${escHtml(e.name)}</td>
          <td style="text-align:right;color:var(--text-muted)">${e.isDir ? '—' : formatSize(e.size)}</td>
          <td style="text-align:right;color:var(--text-muted)">${e.isDir ? '—' : formatSize(e.compressedSize)}</td>`;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      content.appendChild(table);
    } catch (e) {
      content.textContent = 'Failed to read zip: ' + e.message;
    }
  }

  function renderUnsupported(msg) {
    const token = localStorage.getItem('de_token') || '';
    content.innerHTML = `
      <div class="preview-unsupported">
        <div class="preview-unsupported-icon">📎</div>
        <div class="preview-unsupported-name">${escHtml(currentFile.name)}</div>
        <div class="preview-unsupported-msg">${escHtml(msg)}</div>
        <a href="/download?path=${encodeURIComponent(currentFile.path)}&token=${encodeURIComponent(token)}"
           download="${escHtml(currentFile.name)}"
           class="preview-unsupported-dl">Download file</a>
      </div>`;
  }

  // ── meta ─────────────────────────────────────────────────────────────────────

  function renderMeta() {
    if (!currentFile) return;
    const f = currentFile;
    const rows = [
      ['Name',     escHtml(f.name)],
      ['Path',     `<span style="font-family:var(--font-mono);font-size:.72rem">${escHtml(f.path)}</span>`],
      ['Type',     f.isDir ? 'Folder' : (f.mime || 'File')],
      ['Ext',      f.ext || '—'],
      ['Size',     formatSize(f.size)],
      ['Modified', f.mtime ? new Date(f.mtime).toLocaleString() : '—'],
      ['Created',  f.ctime ? new Date(f.ctime).toLocaleString() : '—'],
    ];
    content.innerHTML = `<div class="meta-table">${
      rows.map(([k, v]) =>
        `<div class="meta-row"><span class="meta-key">${k}</span><span class="meta-val">${v}</span></div>`
      ).join('')
    }</div>`;
  }

  // ── zoom / pan ───────────────────────────────────────────────

  function makeZoomable(el) {
    let scale = 1, ox = 0, oy = 0;
    let panning = false, lastX, lastY;

    function apply() {
      el.style.transform = `scale(${scale}) translate(${ox / scale}px, ${oy / scale}px)`;
      el.style.cursor    = scale > 1 ? 'grab' : 'default';
    }

    function onWheel(e) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      scale = Math.min(10, Math.max(0.2, scale * factor));
      apply();
    }

    function onMousedown(e) {
      if (e.button !== 0 || scale <= 1) return;
      panning = true;
      lastX = e.clientX; lastY = e.clientY;
      el.style.cursor = 'grabbing';
      e.preventDefault();
    }

    function onMousemove(e) {
      if (!panning) return;
      ox += e.clientX - lastX;
      oy += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      apply();
    }

    function onMouseup() {
      if (!panning) return;
      panning = false;
      apply();
    }

    function onDblclick() { scale = 1; ox = 0; oy = 0; apply(); }

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mousedown', onMousedown);
    document.addEventListener('mousemove', onMousemove);
    document.addEventListener('mouseup', onMouseup);
    el.addEventListener('dblclick', onDblclick);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mousedown', onMousedown);
      document.removeEventListener('mousemove', onMousemove);
      document.removeEventListener('mouseup', onMouseup);
      el.removeEventListener('dblclick', onDblclick);
    };
  }

  // ── mode & events ─────────────────────────────────────────────

  function setMode(mode) {
    currentMode = mode;
    rawContent  = null;
    content.innerHTML        = '';
    content.style.padding    = '';
    content.style.overflow   = '';
    content.style.display    = '';
    content.style.alignItems = '';
    content.style.justifyContent = '';
    content.style.flexDirection  = '';
    modal.querySelectorAll('#preview-modal-tabs .pv-tab[data-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    // Show edit button only in raw mode for text files
    const ext = currentFile ? (currentFile.ext || '').replace('.', '').toLowerCase() : '';
    editBtn.style.display = (mode === 'raw' && !BINARY_EXTS.has(ext)) ? '' : 'none';
    if (mode === 'meta') { renderMeta(); return; }
    render();
  }

  // ── Edit mode ─────────────────────────────────────────────

  editBtn.addEventListener('click', () => {
    if (!currentFile || rawContent === null) return;
    renderRawEdit();
  });

  function renderRawEdit() {
    content.innerHTML       = '';
    content.style.padding   = '0';
    content.style.overflow  = 'hidden';
    content.style.display   = 'flex';
    content.style.flexDirection = 'column';
    editBtn.style.display   = 'none';

    const toolbar = document.createElement('div');
    toolbar.className = 'raw-edit-toolbar';

    const saveBtn   = document.createElement('button');
    saveBtn.className = 'raw-edit-save';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'raw-edit-cancel';
    cancelBtn.textContent = 'Cancel';

    toolbar.appendChild(saveBtn);
    toolbar.appendChild(cancelBtn);

    const textarea = document.createElement('textarea');
    textarea.className = 'raw-edit-textarea';
    textarea.spellcheck = false;
    textarea.value = rawContent;

    content.appendChild(toolbar);
    content.appendChild(textarea);
    textarea.focus();

    saveBtn.addEventListener('click', async () => {
      try {
        await WS.send('fs:write', { path: currentFile.path, content: textarea.value });
        rawContent = textarea.value;
        setMode('raw');
      } catch (e) {
        alert('Save failed: ' + e.message);
      }
    });

    cancelBtn.addEventListener('click', () => setMode('raw'));

    // Ctrl+S to save
    textarea.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveBtn.click(); }
    });
  }

  function renderUrl() {
    content.style.padding  = '0';
    content.style.overflow = 'hidden';
    content.style.position = 'relative';

    const url = currentFile.url;

    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block';
    content.appendChild(iframe);

    // Banner appears if the site blocks framing (X-Frame-Options / CSP frame-ancestors)
    // We can't detect cross-origin block reliably from JS, so we show it after a delay
    // unless the iframe clearly succeeded (same-origin contentDocument readable).
    const banner = document.createElement('div');
    banner.style.cssText = `
      position:absolute; top:8px; right:8px; z-index:5;
      background:var(--bg-surface); border:1px solid var(--border);
      border-radius:var(--radius-sm); padding:.35rem .55rem;
      font-size:.78rem; color:var(--text-secondary); display:none;
      box-shadow:0 4px 14px rgba(0,0,0,.4); display:flex; align-items:center; gap:.5rem`;
    banner.innerHTML = `<span>Site may block embedding</span>`;
    const openBtn = document.createElement('a');
    openBtn.href = url;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener noreferrer';
    openBtn.textContent = 'Open in new tab ↗';
    openBtn.style.cssText = 'color:var(--accent); text-decoration:none; font-weight:600';
    banner.appendChild(openBtn);
    content.appendChild(banner);

    // Show after 1.5s — long enough for normal sites to render
    setTimeout(() => {
      try {
        // Same-origin: we can read contentDocument and confirm content rendered
        if (iframe.contentDocument && iframe.contentDocument.body && iframe.contentDocument.body.childElementCount > 0) {
          return; // loaded fine
        }
      } catch { /* cross-origin — can't tell; show banner just in case */ }
      banner.style.display = 'flex';
    }, 1500);
  }

  // ── Properties popup ────────────────────────────────────────
  let _propsItem = null;

  function showProperties(item) {
    _propsItem = item;
    const d = document.getElementById('props-dialog');
    document.getElementById('props-title').textContent = item.name || item.url || 'Properties';
    // Default to General tab on each open
    _setPropsTab('general');
    if (!d.open) d.showModal();
  }

  function _setPropsTab(tab) {
    document.querySelectorAll('.props-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'general')  return _renderPropsGeneral(_propsItem);
    if (tab === 'sharing')  return _renderPropsSharing(_propsItem);
    if (tab === 'security') return _renderPropsSecurity(_propsItem);
  }

  function _renderPropsGeneral(item) {
    const body = document.getElementById('props-body');
    const sizeVal = item.isDir
      ? '<span id="props-size-val" style="color:var(--text-muted)">Calculating…</span>'
      : formatSize(item.size);
    const rows = [
      ['Name',     escHtml(item.name || '—')],
      ['Path',     `<span style="font-family:var(--font-mono);font-size:.72rem;word-break:break-all">${escHtml(item.path || item.url || '—')}</span>`],
      ['Type',     item.isDir ? 'Folder' : (item.mime || (item.ext ? item.ext.replace('.','').toUpperCase() + ' file' : 'File'))],
      ['Size',     sizeVal],
      ['Modified', item.mtime ? new Date(item.mtime).toLocaleString() : '—'],
      ['Created',  item.ctime ? new Date(item.ctime).toLocaleString() : '—'],
    ];
    body.innerHTML = `<div class="meta-table">${
      rows.map(([k, v]) =>
        `<div class="meta-row"><span class="meta-key">${k}</span><span class="meta-val">${v}</span></div>`
      ).join('')
    }</div>`;
    if (item.isDir && item.path) {
      WS.send('fs:folder-size', { path: item.path })
        .then(r => { const el = document.getElementById('props-size-val'); if (el) el.textContent = formatSize(r.size); })
        .catch(() => { const el = document.getElementById('props-size-val'); if (el) el.textContent = '—'; });
    }
  }

  async function _renderPropsSharing(item) {
    const body = document.getElementById('props-body');
    if (!item.path || item.url) {
      body.innerHTML = '<p style="color:var(--text-muted);font-size:.8rem">Sharing is not available for this item.</p>';
      return;
    }
    body.innerHTML = `
      <div class="share-form">
        <div style="font-weight:600;font-size:.8rem;color:var(--text-primary)">Create a share link</div>
        <label>Expires in
          <select id="share-expiry">
            <option value="3600000">1 hour</option>
            <option value="86400000" selected>1 day</option>
            <option value="604800000">7 days</option>
            <option value="">Never</option>
          </select>
        </label>
        <label>Max uses (optional)
          <input id="share-maxuses" type="number" min="1" placeholder="unlimited">
        </label>
        <button class="share-btn" id="share-create-btn">Create link</button>
      </div>
      <div style="font-weight:600;font-size:.8rem;color:var(--text-primary);margin-bottom:.4rem">Existing links</div>
      <div id="share-list"><span style="color:var(--text-muted);font-size:.78rem">Loading…</span></div>`;

    document.getElementById('share-create-btn').addEventListener('click', async () => {
      const expSel = document.getElementById('share-expiry').value;
      const maxUsesInput = document.getElementById('share-maxuses').value;
      const expiresAt = expSel ? Date.now() + parseInt(expSel, 10) : null;
      const maxUses   = maxUsesInput ? parseInt(maxUsesInput, 10) : null;
      try {
        await WS.send('share:create', { path: item.path, expiresAt, maxUses });
        _refreshShareList(item.path);
      } catch (e) { alert('Failed to create share: ' + e.message); }
    });

    _refreshShareList(item.path);
  }

  async function _refreshShareList(path) {
    const list = document.getElementById('share-list');
    if (!list) return;
    try {
      const res = await WS.send('share:list', { path });
      const items = res.items || [];
      if (!items.length) {
        list.innerHTML = '<p style="color:var(--text-muted);font-size:.78rem">No active share links.</p>';
        return;
      }
      const origin = window.location.origin;
      list.innerHTML = items.map(s => {
        const url = `${origin}/share/${s.token}`;
        const expiry = s.expires_at ? new Date(s.expires_at).toLocaleString() : 'Never';
        const uses   = s.max_uses ? `${s.used_count}/${s.max_uses} uses` : `${s.used_count} uses`;
        return `<div class="share-row">
          <div class="share-link" data-url="${url}" title="Click to copy">${escHtml(url)}</div>
          <span class="share-meta">${expiry} · ${uses}</span>
          <button class="share-btn danger" data-revoke="${s.id}">Revoke</button>
        </div>`;
      }).join('');
      list.querySelectorAll('.share-link').forEach(el => {
        el.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(el.dataset.url); el.style.background = 'var(--accent-dim)'; setTimeout(() => el.style.background = '', 500); } catch {}
        });
      });
      list.querySelectorAll('[data-revoke]').forEach(b => {
        b.addEventListener('click', async () => {
          if (!confirm('Revoke this share link?')) return;
          await WS.send('share:revoke', { id: b.dataset.revoke });
          _refreshShareList(path);
        });
      });
    } catch (e) {
      list.innerHTML = `<p style="color:var(--danger);font-size:.78rem">Failed to load: ${escHtml(e.message)}</p>`;
    }
  }

  async function _renderPropsSecurity(item) {
    const body = document.getElementById('props-body');
    if (!item.path || item.url) {
      body.innerHTML = '<p style="color:var(--text-muted);font-size:.8rem">Security info not available for this item.</p>';
      return;
    }
    body.innerHTML = '<span style="color:var(--text-muted);font-size:.78rem">Loading…</span>';
    try {
      const info = await WS.send('fs:security', { path: item.path });
      const rows = [
        ['Platform', info.platform],
        ['Owner',    info.owner?.name || '—'],
      ];
      if (info.platform === 'win32') {
        rows.push(['Read-only', info.readOnly ? 'Yes' : 'No']);
        rows.push(['Note', '<span style="color:var(--text-muted);font-size:.72rem">Windows ACLs are not surfaced through Node.js. Edit via Explorer → Properties → Security for full control.</span>']);
      } else {
        rows.push(['Permissions', `<span style="font-family:var(--font-mono)">${info.rwx} (${info.octal})</span>`]);
        rows.push(['UID',         info.uid]);
        rows.push(['GID',         info.gid]);
      }
      body.innerHTML = `<div class="meta-table">${
        rows.map(([k, v]) =>
          `<div class="meta-row"><span class="meta-key">${k}</span><span class="meta-val">${v}</span></div>`
        ).join('')
      }</div>`;
    } catch (e) {
      body.innerHTML = `<p style="color:var(--danger);font-size:.78rem">${escHtml(e.message)}</p>`;
    }
  }

  // Wire props tab switching once
  document.querySelectorAll('.props-tab').forEach(btn => {
    btn.addEventListener('click', () => _setPropsTab(btn.dataset.tab));
  });

  // ── Diff viewer ─────────────────────────────────────────────
  function showDiff(filePath, diffText) {
    titleEl.textContent = filePath;
    iconEl.textContent  = '±';
    currentFile = { name: filePath, path: filePath, ext: '.diff', isDir: false };
    navItems = []; navIdx = -1;
    tabRich.style.display = 'none';
    tabRaw.style.display  = 'none';
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
    editBtn.style.display = 'none';
    modal.querySelectorAll('#preview-modal-tabs .pv-tab[data-mode]').forEach(b =>
      b.classList.toggle('active', false));
    content.innerHTML = '';
    content.style.padding  = '';
    content.style.overflow = 'auto';
    content.style.display  = '';
    content.style.alignItems = '';
    content.style.justifyContent = '';
    _renderDiff(diffText);
    if (!modal.open) modal.showModal();
  }

  function _renderDiff(text) {
    const pre = document.createElement('pre');
    pre.className = 'diff-view';
    const lines = text.split('\n');
    lines.forEach(line => {
      const span = document.createElement('span');
      span.className =
        line.startsWith('+') && !line.startsWith('+++') ? 'diff-add' :
        line.startsWith('-') && !line.startsWith('---') ? 'diff-del' :
        line.startsWith('@@')                            ? 'diff-hunk' :
        line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++') ? 'diff-meta' :
        '';
      span.textContent = line + '\n';
      pre.appendChild(span);
    });
    content.appendChild(pre);
  }

  modal.querySelectorAll('#preview-modal-tabs .pv-tab[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // Open in new tab (replaces download)
  document.getElementById('btn-preview-newtab').addEventListener('click', () => {
    if (!currentFile) return;
    if (currentFile.url) { window.open(currentFile.url, '_blank'); return; }
    if (!currentFile.path) return;
    const token = localStorage.getItem('de_token') || '';
    window.open(`/serve?path=${encodeURIComponent(currentFile.path)}&token=${token}`, '_blank');
  });

  document.getElementById('btn-preview-close').addEventListener('click', () => close());

  // Properties dialog close
  document.getElementById('btn-props-close').addEventListener('click', () => {
    document.getElementById('props-dialog').close();
  });
  document.getElementById('props-dialog').addEventListener('cancel', (e) => { e.preventDefault(); document.getElementById('props-dialog').close(); });
  document.getElementById('props-dialog').addEventListener('click', (e) => {
    if (e.target === document.getElementById('props-dialog')) document.getElementById('props-dialog').close();
  });

  // Swipe down on props-dialog to close (mobile gesture)
  (function attachPropsSwipeClose() {
    const dlg = document.getElementById('props-dialog');
    let s = null;
    const blockSel = 'audio, video, input, textarea, select, button, a';
    dlg.addEventListener('touchstart', (e) => {
      if (!dlg.open || e.touches.length !== 1) { s = null; return; }
      if (e.target.closest(blockSel))           { s = null; return; }
      const t = e.touches[0];
      const scroller = _getScrollableAncestor(e.target, dlg);
      s = { x: t.clientX, y: t.clientY, t: Date.now(), scrollTopAtStart: scroller?.scrollTop ?? 0 };
    }, { passive: true });
    dlg.addEventListener('touchmove', (e) => {
      if (s && e.touches.length > 1) s = null;
    }, { passive: true });
    dlg.addEventListener('touchend', (e) => {
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x, dy = t.clientY - s.y, dt = Date.now() - s.t;
      const wasAtTop = s.scrollTopAtStart <= 0;
      s = null;
      if (dt > 600) return;
      if (dy >= 120 && Math.abs(dx) < 80 && wasAtTop) dlg.close();
    }, { passive: true });
  })();

  modal.addEventListener('click', (e) => { if (e.target === modal && !_resizing) close(); });
  modal.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

  // ── helpers ───────────────────────────────────────────────────────────────────

  function fileIcon(fileStat) {
    if (fileStat.isDir) return '📁';
    const ext = (fileStat.ext || '').replace('.', '').toLowerCase();
    if (['jpg','jpeg','png','gif','webp','avif','svg','bmp','ico'].includes(ext)) return '🖼';
    if (['mp4','webm','mov','mkv','avi','m4v','3gp','flv','ogv'].includes(ext)) return '🎬';
    if (['mp3','ogg','wav','flac','aac','m4a','m4b','opus'].includes(ext)) return '🎵';
    if (ext === 'pdf') return '📕';
    if (['docx','doc','odt'].includes(ext)) return '📝';
    if (['xlsx','xls','xlsm','ods','csv'].includes(ext)) return '📊';
    if (['pptx','ppt','odp'].includes(ext)) return '📊';
    if (['zip','rar','7z','tar','gz'].includes(ext)) return '🗜';
    if (['html','htm'].includes(ext)) return '🌐';
    if (ext === 'md') return '📋';
    if (['js','ts','jsx','tsx','py','rb','go','rs','java','c','cpp','h','cs','php','sh','bash','zsh','sql','json','yaml','yml','xml','toml'].includes(ext)) return '📝';
    if (['exe','msi','bat','cmd','app','dmg','pkg'].includes(ext)) return '⚙';
    return '📄';
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function formatSize(b) {
    if (!b) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b/1048576).toFixed(1) + ' MB';
    return (b/1073741824).toFixed(1) + ' GB';
  }

  // ── Drag-to-resize (desktop only) ────────────────────────────
  const RKEY_W = 'de_preview_w', RKEY_H = 'de_preview_h';
  let _resizing = false;

  function _clampSize(w, h) {
    const vw = window.innerWidth, vh = window.innerHeight;
    return [
      Math.min(vw * 0.9, Math.max(vw * 0.5, w)),
      Math.min(vh * 0.9, Math.max(vh * 0.5, h))
    ];
  }

  function _applySize(w, h) {
    if (window.innerWidth <= 768) return; // mobile: CSS handles full-screen
    const [cw, ch] = _clampSize(w, h);
    modal.style.width     = cw + 'px';
    modal.style.height    = ch + 'px';
    // Neutralise CSS max constraints so JS sizing wins at any scale
    modal.style.maxWidth  = 'none';
    modal.style.maxHeight = 'none';
  }

  // Restore persisted size on page load
  (function () {
    const sw = parseFloat(localStorage.getItem(RKEY_W));
    const sh = parseFloat(localStorage.getItem(RKEY_H));
    if (sw && sh) _applySize(sw, sh);
  })();

  // Re-clamp if the viewport shrinks around an open modal
  window.addEventListener('resize', () => {
    if (!modal.open) return;
    const sw = parseFloat(modal.style.width);
    const sh = parseFloat(modal.style.height);
    if (sw && sh) _applySize(sw, sh);
  });

  document.getElementById('preview-resize-handle').addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    _resizing = true;
    // Modal is centered; both edges grow symmetrically from screen centre
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const onMove = (ev) => {
      _applySize(2 * (ev.clientX - cx), 2 * (ev.clientY - cy));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem(RKEY_W, modal.style.width);
      localStorage.setItem(RKEY_H, modal.style.height);
      // Delay clearing flag so the click event that follows mouseup-outside is suppressed
      setTimeout(() => { _resizing = false; }, 50);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  return { open, close, showProperties, showDiff };
})();
