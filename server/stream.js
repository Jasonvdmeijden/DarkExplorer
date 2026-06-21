const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');
const videoRouter = require('./stream-video');

router.use('/', videoRouter);

// Helper to safely check if a directory exists
function dirExists(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// Simple Mac App Scanner
function scanMacApps() {
  const apps = [];
  const searchPaths = ['/Applications', path.join(os.homedir(), 'Applications')];
  
  for (const sp of searchPaths) {
    if (!dirExists(sp)) continue;
    try {
      const entries = fs.readdirSync(sp);
      for (const entry of entries) {
        if (entry.endsWith('.app')) {
          apps.push({
            name: entry.replace('.app', ''),
            path: path.join(sp, entry),
            // We can add actual icon extraction later, fallback to generic image for now
            image: null
          });
        }
      }
    } catch (e) {
      console.warn('Failed to scan apps in', sp, e.message);
    }
  }
  return apps;
}

// Simple Steam Scanner (Mac specifically for now, but easily expandable to Windows)
function scanSteamGames() {
  const steamGames = [];
  const steamAppPath = path.join(os.homedir(), 'Library/Application Support/Steam/steamapps');
  
  if (!dirExists(steamAppPath)) return steamGames;

  try {
    const files = fs.readdirSync(steamAppPath);
    for (const file of files) {
      if (file.startsWith('appmanifest_') && file.endsWith('.acf')) {
        const content = fs.readFileSync(path.join(steamAppPath, file), 'utf8');
        // Simple regex parse for VDF
        const nameMatch = content.match(/"name"\s+"([^"]+)"/i);
        const appidMatch = content.match(/"appid"\s+"([^"]+)"/i);
        
        if (nameMatch && appidMatch) {
          const name = nameMatch[1];
          const appid = appidMatch[1];
          steamGames.push({
            name: name,
            appid: appid,
            // Steam's official CDN for game box art using appid!
            image: `https://steamcdn-a.akamaihd.net/steam/apps/${appid}/library_600x900.jpg`
          });
        }
      }
    }
  } catch (e) {
    console.warn('Failed to scan Steam games', e.message);
  }
  return steamGames;
}

// The main scan endpoint
router.get('/scan', (req, res) => {
  const platform = process.platform;
  let apps = [];
  let steam = [];

  if (platform === 'darwin') {
    apps = scanMacApps();
    steam = scanSteamGames();
  } else if (platform === 'win32') {
    // Windows scanning logic will go here
  }

  // Limit apps so we don't overload the frontend UI initially
  // Sort alphabetically
  apps.sort((a,b) => a.name.localeCompare(b.name));
  
  res.json({
    apps: apps,
    steam: steam
  });
});

router.post('/launch', (req, res) => {
  const { spawn } = require('child_process');
  const fp = req.body.path;
  const appid = req.body.appid;
  
  try {
    if (appid) {
      // Launch Steam game
      const cmd = process.platform === 'darwin' ? 'open' : 'cmd';
      const args = process.platform === 'darwin' ? [`steam://rungameid/${appid}`] : ['/c', 'start', `steam://rungameid/${appid}`];
      const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      p.unref();
    } else if (fp) {
      // Launch local app
      const cmd = process.platform === 'darwin' ? 'open' : 'cmd';
      const args = process.platform === 'darwin' ? [fp] : ['/c', 'start', '', fp];
      const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      p.unref();
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
