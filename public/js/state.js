/* Workspace state — persists to server, live-syncs across devices */
const State = (() => {
  let cache   = {};   // key → raw JSON string
  const subs  = {};   // key → [fn(parsedValue)]
  const readyQ = [];
  let isReady  = false;
  const timers = {};
  const DEBOUNCE = 500;

  // Server pushes full state on every new WS connection
  WS.on('state:full', (data) => {
    const newCache = data || {};
    if (!isReady) {
      cache   = newCache;
      isReady = true;
      readyQ.splice(0).forEach(fn => fn());
    } else {
      // Reconnected — notify only keys whose values changed
      Object.entries(newCache).forEach(([key, value]) => {
        if (cache[key] !== value) { cache[key] = value; _notify(key); }
      });
      cache = newCache;
    }
  });

  // Another device changed a key
  WS.on('state:push', ({ key, value }) => {
    if (cache[key] === value) return;
    cache[key] = value;
    _notify(key);
  });

  function _notify(key) {
    const v = _parse(cache[key]);
    (subs[key] || []).forEach(fn => fn(v));
  }

  function _parse(v) {
    if (v === undefined) return undefined;
    try { return JSON.parse(v); } catch { return v; }
  }

  function get(key, def) {
    const v = _parse(cache[key]);
    return v !== undefined ? v : def;
  }

  function set(key, value) {
    const json = JSON.stringify(value);
    if (cache[key] === json) return; // nothing changed — skip round-trip
    cache[key] = json;
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => {
      WS.send('state:set', { key, value: json }).catch(() => {});
    }, DEBOUNCE);
  }

  function onChange(key, fn) {
    (subs[key] = subs[key] || []).push(fn);
  }

  function onReady(fn) {
    if (isReady) { fn(); return; }
    readyQ.push(fn);
  }

  return { get, set, onChange, onReady };
})();
