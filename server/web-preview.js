/* Website preview proxy — lets the file-preview modal embed arbitrary
   http(s) URLs in an iframe. Most sites set X-Frame-Options / a CSP
   frame-ancestors directive that blocks being framed from a *different*
   origin — that's a browser security feature we can't bypass client-side.
   Instead we fetch the page server-side and re-serve it from our own
   origin (so the browser only ever sees OUR headers), rewriting every
   URL reference we can find so subsequent requests (assets, links, the
   page's own fetch()/XHR calls) keep flowing back through this proxy
   rather than escaping to the real site directly. */
const express = require('express');
const router = express.Router();
const cheerio = require('cheerio');

const PROXY_PATH = '/web-preview/fetch';

// Per-target-origin cookie jar so a site that sets a session/consent/CSRF
// cookie on the first request still has it on the next one — scoped to our
// server process, never exposed to the browser as a real cookie for that domain.
const cookieJars = new Map(); // origin -> Map(name -> value)

function jarFor(origin) {
  let jar = cookieJars.get(origin);
  if (!jar) { jar = new Map(); cookieJars.set(origin, jar); }
  return jar;
}

function cookieHeaderFor(origin) {
  const jar = cookieJars.get(origin);
  if (!jar || !jar.size) return undefined;
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeSetCookies(origin, setCookieLines) {
  if (!setCookieLines || !setCookieLines.length) return;
  const jar = jarFor(origin);
  for (const line of setCookieLines) {
    const m = /^\s*([^=;]+)=([^;]*)/.exec(line);
    if (!m) continue;
    const [, name, value] = m;
    const expired = /max-age=0/i.test(line) || /expires=Thu,?\s*01[- ]Jan[- ]1970/i.test(line);
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), value);
  }
}

function isAllowedUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch { return false; }
}

// Resolve a (possibly relative) URL found in proxied markup against the real
// page URL, then route it back through this proxy so the browser keeps
// talking to our origin only.
function rewriteUrl(raw, baseUrl) {
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (!trimmed || /^(data|blob|javascript|mailto|tel|#)/i.test(trimmed)) return raw;
  if (trimmed.startsWith(PROXY_PATH)) return raw; // already proxied
  try {
    const abs = new URL(trimmed, baseUrl).toString();
    return `${PROXY_PATH}?url=${encodeURIComponent(abs)}`;
  } catch { return raw; }
}

function rewriteCss(css, baseUrl) {
  if (!css) return css;
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, u) => {
    if (/^data:/i.test(u)) return match;
    return `url(${quote}${rewriteUrl(u, baseUrl)}${quote})`;
  });
}

const URL_ATTRS = {
  a: 'href', link: 'href', script: 'src', img: 'src', iframe: 'src',
  source: 'src', form: 'action', video: 'src', audio: 'src', embed: 'src'
};

function buildShim(baseUrl) {
  // Best-effort: the page's own fetch()/XHR calls resolve relative URLs
  // against document.baseURI, which is OUR origin, not the real site's — so
  // without this they'd silently 404 against us instead of hitting the real
  // API. This rewrites them to go through the proxy too. Also neutralises
  // the common `if (window.top !== window.self) location = ...` frame-buster
  // check some sites use in addition to (or instead of) X-Frame-Options.
  return `<script>(function(){
    var REAL_BASE = ${JSON.stringify(baseUrl)};
    var PROXY = ${JSON.stringify(PROXY_PATH)};
    function abs(u) { try { return new URL(u, REAL_BASE).toString(); } catch (e) { return u; } }
    function proxied(u) {
      if (typeof u !== 'string' || u.indexOf(PROXY) === 0 || /^(data|blob|javascript):/i.test(u)) return u;
      return PROXY + '?url=' + encodeURIComponent(abs(u));
    }
    var origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function(input, init) {
        try {
          if (typeof input === 'string') return origFetch(proxied(input), init);
          if (input && input.url) return origFetch(proxied(input.url), init);
        } catch (e) {}
        return origFetch(input, init);
      };
    }
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, u) {
      try { arguments[1] = proxied(u); } catch (e) {}
      return origOpen.apply(this, arguments);
    };
    try { Object.defineProperty(window, 'top', { get: function () { return window; } }); } catch (e) {}
    try { Object.defineProperty(window, 'parent', { get: function () { return window; } }); } catch (e) {}
  })();</script>`;
}

function rewriteHtml(html, baseUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });

  // The target's own CSP/frame-busting <meta> tags — headers are already
  // stripped below, but some sites duplicate the policy in markup too.
  $('meta[http-equiv]').each((_, el) => {
    const v = ($(el).attr('http-equiv') || '').toLowerCase();
    if (v === 'content-security-policy' || v === 'x-frame-options') $(el).remove();
  });

  Object.entries(URL_ATTRS).forEach(([tag, attr]) => {
    $(tag).each((_, el) => {
      const $el = $(el);
      const val = $el.attr(attr);
      if (val) $el.attr(attr, rewriteUrl(val, baseUrl));
    });
  });

  $('img, source').each((_, el) => {
    const $el = $(el);
    const srcset = $el.attr('srcset');
    if (!srcset) return;
    const rewritten = srcset.split(',').map(part => {
      const bits = part.trim().split(/\s+/);
      bits[0] = rewriteUrl(bits[0], baseUrl);
      return bits.join(' ');
    }).join(', ');
    $el.attr('srcset', rewritten);
  });

  $('style').each((_, el) => { $(el).html(rewriteCss($(el).html() || '', baseUrl)); });
  $('[style]').each((_, el) => {
    const $el = $(el);
    $el.attr('style', rewriteCss($el.attr('style') || '', baseUrl));
  });

  $('head').prepend(buildShim(baseUrl));
  $('head').prepend(`<base href="${baseUrl}">`);

  return $.html();
}

const SKIP_RESPONSE_HEADERS = new Set([
  'x-frame-options', 'content-security-policy', 'content-security-policy-report-only',
  'set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'strict-transport-security',
  'connection', 'keep-alive'
]);

router.get('/fetch', async (req, res) => {
  const target = req.query.url;
  if (!target || !isAllowedUrl(target)) return res.status(400).send('Invalid url');

  const targetOrigin = new URL(target).origin;

  let upstream;
  try {
    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (compatible; DarkExplorerPreview/1.0)',
      'Accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
    };
    const cookieHeader = cookieHeaderFor(targetOrigin);
    if (cookieHeader) headers.Cookie = cookieHeader;

    upstream = await fetch(target, { headers, redirect: 'follow' });
  } catch (e) {
    return res.status(502).send('Could not reach ' + target + ': ' + e.message);
  }

  const finalUrl = upstream.url || target;
  const finalOrigin = new URL(finalUrl).origin;
  const setCookies = typeof upstream.headers.getSetCookie === 'function'
    ? upstream.headers.getSetCookie()
    : (upstream.headers.get('set-cookie') ? [upstream.headers.get('set-cookie')] : []);
  storeSetCookies(finalOrigin, setCookies);

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
  });

  const contentType = upstream.headers.get('content-type') || '';

  try {
    if (contentType.includes('text/html')) {
      const html = await upstream.text();
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(rewriteHtml(html, finalUrl));
    }
    if (contentType.includes('text/css')) {
      const css = await upstream.text();
      res.set('Content-Type', 'text/css; charset=utf-8');
      return res.send(rewriteCss(css, finalUrl));
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.send(buf);
  } catch (e) {
    return res.status(502).send('Failed to relay response: ' + e.message);
  }
});

module.exports = router;
