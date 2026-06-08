/* File preview — text/code, markdown, HTML iframe, image, PDF, video/audio */
const Preview = (() => {
  const content = document.getElementById('preview-content');
  const meta    = document.getElementById('preview-meta');
  let currentMode = 'rich';
  let currentFile = null;
  let rawContent  = null;

  const CODE_EXTS = new Set([
    'js','mjs','ts','tsx','jsx','json','yaml','yml','css','scss','html','htm',
    'py','rb','go','rs','java','c','cpp','h','cs','php','sh','bash','sql','toml','env'
  ]);

  async function open(fileStat) {
    currentFile = fileStat;
    Panels.showRight();
    setMode(currentMode);
  }

  async function render() {
    if (!currentFile) return;
    const ext = (currentFile.ext || '').replace('.', '').toLowerCase();

    content.innerHTML = '';

    if (['jpg','jpeg','png','gif','webp','avif','svg','bmp'].includes(ext)) {
      return renderImage();
    }
    if (['mp4','webm','mov','mkv','avi','m4v'].includes(ext)) {
      return renderVideo();
    }
    if (['mp3','ogg','wav','flac','aac'].includes(ext)) {
      return renderAudio();
    }
    if (ext === 'pdf') {
      return renderPdf();
    }
    if (ext === 'md') {
      return renderMarkdown();
    }
    if (ext === 'html' || ext === 'htm') {
      if (currentMode === 'rich') return renderHtmlIframe();
      return renderCode(ext);
    }
    if (CODE_EXTS.has(ext) || !ext) {
      return renderCode(ext);
    }
    content.textContent = 'Preview not available for this file type.';
  }

  async function getContent() {
    if (rawContent !== null) return rawContent;
    try {
      const res = await WS.send('fs:read', { path: currentFile.path });
      rawContent = res.content;
      return rawContent;
    } catch (e) {
      return null;
    }
  }

  async function renderMarkdown() {
    const text = await getContent();
    if (text === null) { content.textContent = 'Could not read file.'; return; }

    if (currentMode === 'raw') {
      renderHighlighted(text, 'markdown');
      return;
    }

    // parse mermaid blocks before marked
    const html = window.marked ? marked.parse(text) : `<pre>${escHtml(text)}</pre>`;
    content.innerHTML = html;

    // render mermaid diagrams
    if (window.mermaid) {
      content.querySelectorAll('code.language-mermaid').forEach((el, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'mermaid';
        wrap.textContent = el.textContent;
        el.parentElement.replaceWith(wrap);
      });
      mermaid.init(undefined, content.querySelectorAll('.mermaid'));
    }

    // syntax highlight code blocks
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
    iframe.style.width  = '100%';
    iframe.style.height = '500px';
    iframe.style.border = 'none';
    content.appendChild(iframe);
  }

  function renderImage() {
    const token = localStorage.getItem('de_token') || '';
    const img = document.createElement('img');
    img.src = `/download?path=${encodeURIComponent(currentFile.path)}&token=${token}`;
    img.style.maxWidth = '100%';
    content.appendChild(img);
  }

  function renderVideo() {
    const token = localStorage.getItem('de_token') || '';
    const video = document.createElement('video');
    video.src      = `/download?path=${encodeURIComponent(currentFile.path)}&token=${token}`;
    video.controls = true;
    video.style.maxWidth = '100%';
    content.appendChild(video);
  }

  function renderAudio() {
    const token = localStorage.getItem('de_token') || '';
    const audio = document.createElement('audio');
    audio.src      = `/download?path=${encodeURIComponent(currentFile.path)}&token=${token}`;
    audio.controls = true;
    content.appendChild(audio);
  }

  function renderPdf() {
    const token = localStorage.getItem('de_token') || '';
    const iframe = document.createElement('iframe');
    iframe.src    = `/download?path=${encodeURIComponent(currentFile.path)}&token=${token}`;
    iframe.style.width  = '100%';
    iframe.style.height = '600px';
    iframe.style.border = 'none';
    content.appendChild(iframe);
  }

  function renderMeta() {
    if (!currentFile) return;
    const f = currentFile;
    meta.innerHTML = `
      <strong>Name</strong>      ${escHtml(f.name)}<br>
      <strong>Path</strong>      <span style="font-family:var(--font-mono);font-size:.75rem">${escHtml(f.path)}</span><br>
      <strong>Type</strong>      ${f.isDir ? 'Folder' : (f.mime || 'File')}<br>
      <strong>Extension</strong> ${f.ext || '—'}<br>
      <strong>Size</strong>      ${formatSize(f.size)}<br>
      <strong>Modified</strong>  ${f.mtime ? new Date(f.mtime).toLocaleString() : '—'}<br>
      <strong>Created</strong>   ${f.ctime ? new Date(f.ctime).toLocaleString() : '—'}
    `;
  }

  function setMode(mode) {
    currentMode = mode;
    rawContent = null;
    document.querySelectorAll('.preview-toolbar .ptab[data-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    if (mode === 'meta') {
      renderMeta();
      meta.style.display = meta.style.display === 'none' ? '' : 'none';
      return;
    }
    meta.style.display = 'none';
    render();
  }

  // wire toolbar
  document.querySelectorAll('.preview-toolbar .ptab[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

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

  return { open };
})();
