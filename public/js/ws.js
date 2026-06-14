/* WebSocket client — single connection, request/response matching, auto-reconnect */
const WS = (() => {
  let socket = null;
  let pending = {};   // id -> { resolve, reject, timer }
  let seq = 0;
  let sendQueue = []; // buffered while socket is connecting
  let isOpen = false;
  const TIMEOUT = 30000;
  const listeners = {}; // type -> [fn]

  function connect() {
    const token = localStorage.getItem('de_token') || '';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${location.host}?token=${token}`);
    isOpen = false;

    socket.onopen = () => {
      isOpen = true;
      console.log('[ws] connected');
      sendQueue.forEach(msg => socket.send(msg));
      sendQueue = [];
    };

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
      isOpen = false;
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

  function send(type, payload, opts) {
    return new Promise((resolve, reject) => {
      const id = String(++seq);
      const ms = (opts && opts.timeout) ? opts.timeout : TIMEOUT;
      const timer = setTimeout(() => {
        delete pending[id];
        reject(new Error('Request timed out'));
      }, ms);
      pending[id] = { resolve, reject, timer };
      const msg = JSON.stringify({ id, type, payload: payload || {} });
      if (isOpen) {
        socket.send(msg);
      } else {
        sendQueue.push(msg);
      }
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
