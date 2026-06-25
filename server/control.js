// server/control.js
// Ephemeral, targeted remote-control relay over the existing WS hub.
// Nothing here is persisted — bindings live only as long as both sockets are open.
//
// Model: a "controller" connection drives exactly one "controllee" connection.
//   - a connection may control at most one controllee
//   - a connection may be controlled by at most one controller
//   - no chains (a controllee can't simultaneously be a controller) and no self-control
const WebSocket = require('ws');

const conns        = new Map(); // connId -> ws
const controlleeOf = new Map(); // controller connId -> controllee connId
const controllerOf = new Map(); // controllee connId -> controller connId

function send(ws, type, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  }
}

function rosterList() {
  return [...conns.values()].map(ws => ({
    connId:       ws.connId,
    name:         ws.controlName || 'Device',
    deviceId:     ws.deviceId,
    controlling:  controlleeOf.get(ws.connId) || null,
    controlledBy: controllerOf.get(ws.connId) || null,
  }));
}

function broadcastRoster() {
  const list = rosterList();
  for (const ws of conns.values()) send(ws, 'control:roster', list);
}

function register(ws) {
  conns.set(ws.connId, ws);
  // Tell the socket its own identity so the client can recognise itself in the roster.
  send(ws, 'control:self', { connId: ws.connId, name: ws.controlName || 'Device' });
  broadcastRoster();
}

function setName(ws, name) {
  if (typeof name === 'string' && name.trim()) ws.controlName = name.trim().slice(0, 60);
  broadcastRoster();
}

// Tear down the binding owned by `controllerId`, notifying both ends.
function teardown(controllerId, reason) {
  const controlleeId = controlleeOf.get(controllerId);
  if (!controlleeId) return;
  controlleeOf.delete(controllerId);
  controllerOf.delete(controlleeId);
  send(conns.get(controllerId), 'control:unbound', { role: 'controller', reason });
  send(conns.get(controlleeId), 'control:unbound', { role: 'controllee', reason });
}

function bind(ws, targetConnId) {
  const target = conns.get(targetConnId);
  if (!target)                          return { ok: false, error: 'Target not found' };
  if (target === ws)                    return { ok: false, error: 'Cannot control yourself' };
  if (controllerOf.has(ws.connId))      return { ok: false, error: 'You are currently being controlled' };
  if (controlleeOf.has(targetConnId))   return { ok: false, error: 'Target is currently controlling another device' };
  if (controllerOf.has(targetConnId))   return { ok: false, error: 'Target is already being controlled' };

  // A controller may only drive one controllee — release any previous one first.
  if (controlleeOf.has(ws.connId)) teardown(ws.connId, 'switch');

  controlleeOf.set(ws.connId, targetConnId);
  controllerOf.set(targetConnId, ws.connId);
  send(ws,     'control:bound', { role: 'controller', peerConnId: targetConnId, peerName: target.controlName || 'Device', peerDeviceId: target.deviceId });
  send(target, 'control:bound', { role: 'controllee', peerConnId: ws.connId,    peerName: ws.controlName     || 'Device', peerDeviceId: ws.deviceId });
  broadcastRoster();
  return { ok: true, peerConnId: targetConnId, peerName: target.controlName || 'Device' };
}

// Tear down whichever binding `ws` participates in (as controller or controllee).
function unbindAny(ws, reason) {
  if (controlleeOf.has(ws.connId))      teardown(ws.connId, reason);
  else if (controllerOf.has(ws.connId)) teardown(controllerOf.get(ws.connId), reason);
  broadcastRoster();
}

// Relay an input batch from a controller to its bound controllee. Fire-and-forget.
function relayInput(ws, payload) {
  const controlleeId = controlleeOf.get(ws.connId);
  if (controlleeId) send(conns.get(controlleeId), 'control:input', payload);
}

function unregister(ws) {
  unbindAny(ws, 'disconnect');
  conns.delete(ws.connId);
  broadcastRoster();
}

module.exports = { register, unregister, setName, bind, unbindAny, relayInput, rosterList };
