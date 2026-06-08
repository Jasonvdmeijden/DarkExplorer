/* WebSocket client — single connection, request/response matching, auto-reconnect */
const WS = (() => {
  let socket = null;
  let pending = {};   // id -> { resolve, reject, timer }
  let seq = 0;
  const TIMEOUT = 30000;
  const listeners = {}; // type -> [fn]

  function connect() {
    const token = localStorage.getItem('de_token') || '';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${location.host}?token=${token}`);

    socket.onopen = () => console.log('[ws] connected');

    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      // push event (no id)
      if (!msg.id) {
        const fns = listeners[msg.type] || [];
        fns.forEach(fn => fn(msg.data));
        return;
      }
      const p = pending[msg.id];
      if (!p) return;
      clearTimeout(p.timer);
      delete pending[msg.id];
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error || 'Request failed'));
    };

    socket.onclose = (e) => {
      if (e.code === 4001) {
        // unauthorised — redirect to enroll
        localStorage.removeItem('de_token');
        location.href = '/enroll';
        return;
      }
      console.log('[ws] disconnected — reconnecting in 2s');
      setTimeout(connect, 2000);
    };

    socket.onerror = () => {};
  }

  function send(type, payload) {
    return new Promise((resolve, reject) => {
      const id = String(++seq);
      const timer = setTimeout(() => {
        delete pending[id];
        reject(new Error('Request timed out'));
      }, TIMEOUT);
      pending[id] = { resolve, reject, timer };
      socket.send(JSON.stringify({ id, type, payload: payload || {} }));
    });
  }

  function on(type, fn) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(fn);
  }

  function off(type, fn) {
    if (!listeners[type]) return;
    listeners[type] = listeners[type].filter(f => f !== fn);
  }

  // send without waiting for a reply (terminal input)
  function emit(type, payload) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, payload: payload || {} }));
    }
  }

  connect();
  return { send, on, off, emit };
})();
