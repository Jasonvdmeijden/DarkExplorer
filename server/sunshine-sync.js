const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, exec } = require('child_process');

const SUNSHINE_DIR = path.join(os.homedir(), '.config', 'sunshine');
const APPS_JSON = path.join(SUNSHINE_DIR, 'apps.json');
const COVERS_DIR = path.join(SUNSHINE_DIR, 'covers');

if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });

function dirExists(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

async function syncSunshineApps() {
  console.log('[sunshine-sync] Starting sync of macOS and Steam apps to Sunshine...');
  
  const apps = [
    {
      "name": "Desktop",
      "image-path": "desktop.png"
    }
  ];

  // 1. Scan Steam Games
  const steamAppPath = path.join(os.homedir(), 'Library/Application Support/Steam/steamapps');
  if (dirExists(steamAppPath)) {
    const files = fs.readdirSync(steamAppPath);
    for (const file of files) {
      if (file.startsWith('appmanifest_') && file.endsWith('.acf')) {
        const content = fs.readFileSync(path.join(steamAppPath, file), 'utf8');
        const nameMatch = content.match(/"name"\s+"([^"]+)"/i);
        const appidMatch = content.match(/"appid"\s+"([^"]+)"/i);
        
        if (nameMatch && appidMatch) {
          const name = nameMatch[1];
          const appid = appidMatch[1];
          
          // Download Steam Header to covers dir
          const coverPath = path.join(COVERS_DIR, `steam_${appid}.jpg`);
          if (!fs.existsSync(coverPath)) {
            try {
              execSync(`curl -s "https://steamcdn-a.akamaihd.net/steam/apps/${appid}/header.jpg" -o "${coverPath}"`);
            } catch (e) {}
          }

          apps.push({
            name: name,
            detached: [`open steam://rungameid/${appid}`],
            "image-path": `steam_${appid}.jpg`
          });
        }
      }
    }
  }

  // 2. Scan Mac Apps
  const searchPaths = ['/Applications', path.join(os.homedir(), 'Applications')];
  for (const sp of searchPaths) {
    if (!dirExists(sp)) continue;
    const entries = fs.readdirSync(sp);
    for (const entry of entries) {
      if (entry.endsWith('.app')) {
        const appName = entry.replace('.app', '');
        const appPath = path.join(sp, entry);
        
        const coverName = `mac_${appName.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
        const coverPath = path.join(COVERS_DIR, coverName);

        // Extract icon if we don't have it
        if (!fs.existsSync(coverPath)) {
          const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
          let icnsName = 'AppIcon.icns';
          if (fs.existsSync(infoPlistPath)) {
            try {
              const plistContent = fs.readFileSync(infoPlistPath, 'utf8');
              const iconMatch = plistContent.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/);
              if (iconMatch) {
                icnsName = iconMatch[1];
                if (!icnsName.endsWith('.icns')) icnsName += '.icns';
              }
            } catch (e) {}
          }
          const icnsPath = path.join(appPath, 'Contents', 'Resources', icnsName);
          if (fs.existsSync(icnsPath)) {
            try {
              execSync(`sips -s format png "${icnsPath}" --out "${coverPath}"`);
            } catch (e) {}
          }
        }

        apps.push({
          name: appName,
          detached: [`open -a "${appPath}"`],
          "image-path": fs.existsSync(coverPath) ? coverName : undefined
        });
      }
    }
  }

  // 3. Write apps.json
  const appsJsonContent = {
    env: { PATH: "$(PATH):$(HOME)/.local/bin" },
    apps: apps
  };

  fs.writeFileSync(APPS_JSON, JSON.stringify(appsJsonContent, null, 2));
  console.log('[sunshine-sync] Successfully synced apps to Sunshine!');
  
  // Try to restart sunshine to pick up apps (if it's running via brew services, or just kill it)
  try {
    execSync('pkill sunshine || true');
  } catch (e) {}
}
module.exports = syncSunshineApps;
