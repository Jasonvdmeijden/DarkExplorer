// server/sunshine-sync-win.js
// Syncs DarkExplorer-scanned Windows apps + Steam games into Apollo/Sunshine's apps.json
// so they can be launched by name through the Moonlight Web Stream proxy.
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const CANDIDATE_DIRS = [
  'C:\\Program Files\\Apollo\\config',
  'C:\\Program Files\\Sunshine\\config',
  'C:\\ProgramData\\Apollo\\config',
  'C:\\ProgramData\\Sunshine\\config'
];

function findConfigDir() {
  for (const dir of CANDIDATE_DIRS) {
    if (fs.existsSync(path.join(dir, 'apps.json'))) return dir;
  }
  return null;
}

function extractIconToFile(targetPath, outPng) {
  const psScript = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct SHFILEINFO {
  public IntPtr hIcon;
  public int iIcon;
  public uint dwAttributes;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
}
public class Shell32Sync {
  [DllImport("shell32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbSizeFileInfo, uint uFlags);
}
"@
try {
  $info = New-Object SHFILEINFO
  $flags = 0x100 -bor 0x10
  [Shell32Sync]::SHGetFileInfo("${targetPath.replace(/`/g, '``').replace(/"/g, '`"')}", 0, [ref]$info, [System.Runtime.InteropServices.Marshal]::SizeOf($info), $flags) | Out-Null
  if ($info.hIcon -ne [IntPtr]::Zero) {
    $icon = [System.Drawing.Icon]::FromHandle($info.hIcon)
    $bmp = $icon.ToBitmap()
    $bmp.Save("${outPng.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
  }
} catch {}
`.trim();
  try {
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { timeout: 10000 });
  } catch (e) {}
  return fs.existsSync(outPng);
}

// apps: [{ name, path }]  steamGames: [{ name, appid }]
function syncWindowsApps(apps, steamGames) {
  const configDir = findConfigDir();
  if (!configDir) return { ok: false, reason: 'Apollo/Sunshine config not found' };

  const appsJsonPath = path.join(configDir, 'apps.json');
  const coversDir = path.join(configDir, 'covers');
  try {
    if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });
  } catch (e) {
    return { ok: false, reason: `No write access to ${configDir} (run as admin once, or grant your user Modify rights on that folder): ${e.message}` };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(appsJsonPath, 'utf8'));
  } catch (e) {
    return { ok: false, reason: 'Failed to read apps.json: ' + e.message };
  }

  const existing = Array.isArray(data.apps) ? data.apps : [];
  // Keep everything that wasn't auto-managed by us (manual entries like Desktop, Xbox, Steam Big Picture)
  const kept = existing.filter(a => !a['darkexplorer-managed']);

  const managed = [];

  for (const app of (apps || []).slice(0, 60)) {
    try {
      const coverName = `de_app_${Buffer.from(app.name).toString('base64').replace(/[/+=]/g, '_')}.png`;
      const coverPath = path.join(coversDir, coverName);
      if (!fs.existsSync(coverPath)) extractIconToFile(app.path, coverPath);

      managed.push({
        name: app.name,
        cmd: `"${app.path}"`,
        'auto-detach': true,
        'image-path': fs.existsSync(coverPath) ? coverName : undefined,
        'darkexplorer-managed': true
      });
    } catch (e) {}
  }

  for (const game of (steamGames || []).slice(0, 60)) {
    try {
      const coverName = `de_steam_${game.appid}.jpg`;
      const coverPath = path.join(coversDir, coverName);
      if (!fs.existsSync(coverPath)) {
        try {
          execSync(`curl -s "https://steamcdn-a.akamaihd.net/steam/apps/${game.appid}/header.jpg" -o "${coverPath}"`, { timeout: 10000 });
        } catch (e) {}
      }

      managed.push({
        name: game.name,
        detached: [`steam://rungameid/${game.appid}`],
        'image-path': fs.existsSync(coverPath) ? coverName : undefined,
        'darkexplorer-managed': true
      });
    } catch (e) {}
  }

  data.apps = [...kept, ...managed];

  try {
    fs.writeFileSync(appsJsonPath, JSON.stringify(data, null, 4));
  } catch (e) {
    return { ok: false, reason: 'Failed to write apps.json: ' + e.message };
  }

  return { ok: true, configDir, synced: managed.length };
}

module.exports = { syncWindowsApps, findConfigDir };
