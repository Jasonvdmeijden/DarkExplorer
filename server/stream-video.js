// stream-server.js
const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');

let activeStream = null;

router.get('/video', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=ffserver',
    'Cache-Control': 'no-cache',
    'Connection': 'close',
    'Pragma': 'no-cache'
  });

  if (activeStream) {
    activeStream.kill();
  }

  const isMac = process.platform === 'darwin';
  
  // High performance hardware-accelerated MJPEG desktop capture
  const args = isMac 
    ? ['-f', 'avfoundation', '-r', '30', '-i', '1', '-c:v', 'mjpeg', '-q:v', '3', '-f', 'mpjpeg', 'pipe:1']
    : ['-f', 'gdigrab', '-framerate', '30', '-i', 'desktop', '-c:v', 'mjpeg', '-q:v', '3', '-f', 'mpjpeg', 'pipe:1'];

  activeStream = spawn('ffmpeg', args);

  activeStream.stdout.on('data', (data) => {
    res.write(data);
  });

  req.on('close', () => {
    if (activeStream) {
      activeStream.kill();
      activeStream = null;
    }
  });
});

module.exports = router;
