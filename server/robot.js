// server/robot.js
let robot = null;
try {
  robot = require('robotjs');
  // Speed up robotjs
  robot.setMouseDelay(2);
  robot.setKeyboardDelay(2);
} catch (e) {
  console.warn('[robot] failed to load robotjs:', e.message);
}

module.exports = {
  handleInput(payload) {
    if (!robot) return;
    try {
      if (payload.action === 'mousemove') {
        const { width, height } = robot.getScreenSize();
        robot.moveMouse(payload.nx * width, payload.ny * height);
      } else if (payload.action === 'mouserelative') {
        const pos = robot.getMousePos();
        const { width, height } = robot.getScreenSize();
        let nx = pos.x + payload.dx;
        let ny = pos.y + payload.dy;
        robot.moveMouse(nx, ny);
      } else if (payload.action === 'click') {
        robot.mouseClick(payload.button || 'left', payload.double || false);
      } else if (payload.action === 'mousedown') {
        robot.mouseToggle('down', payload.button || 'left');
      } else if (payload.action === 'mouseup') {
        robot.mouseToggle('up', payload.button || 'left');
      } else if (payload.action === 'scroll') {
        robot.scrollMouse(payload.dx, payload.dy);
      } else if (payload.action === 'keydown') {
        robot.keyToggle(payload.key, 'down', payload.modifiers || []);
      } else if (payload.action === 'keyup') {
        robot.keyToggle(payload.key, 'up', payload.modifiers || []);
      } else if (payload.action === 'type') {
        robot.typeString(payload.string);
      }
    } catch (e) {
      console.error('[robot] action failed:', e);
    }
  }
};
