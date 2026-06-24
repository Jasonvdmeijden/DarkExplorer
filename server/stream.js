const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');
const videoRouter = require('./stream-video');

router.use('/', videoRouter);

const { exec, execSync, spawn, spawnSync } = require('child_process');
const sunshineSyncWin = require('./sunshine-sync-win');

// Tracks whatever was most recently launched via /launch, so /kill knows what
// to terminate without the client having to resend identifying details (it
// only has what StreamView's `item` carried at launch time, which isn't
// always enough to find the right process on its own — e.g. a Steam appid).
let lastLaunched = null;

// Helper to safely check if a directory exists
function dirExists(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// Is this request coming from the same physical machine the server runs on?
// Used so launching an app doesn't kick off a pointless RTC session when
// you're already sitting at the host.
function getLocalIps() {
  const ips = new Set(['127.0.0.1', '::1']);
  const ifaces = os.networkInterfaces();
  for (const name in ifaces) {
    for (const iface of ifaces[name]) ips.add(iface.address);
  }
  return ips;
}

// req.socket.remoteAddress is useless when traffic arrives via a local tunnel
// (Cloudflare WARP/cloudflared, etc.) — the tunnel daemon relays everything to
// the app over loopback, so EVERY client (including a phone on the far side of
// the tunnel) shows up as 127.0.0.1. Prefer the headers a reverse proxy sets to
// carry the real origin IP, and only fall back to the socket address when none
// of them are present (i.e. a direct, unproxied connection).
function getClientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return cf.trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  const xreal = req.headers['x-real-ip'];
  if (xreal) return xreal.trim();
  let ip = req.socket.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

router.get('/is-local', (req, res) => {
  res.json({ isLocal: getLocalIps().has(getClientIp(req)) });
});

router.get('/webrtc-config', (req, res) => {
  try {
    const dataPath = path.join(os.homedir(), 'moonlight-web-stream', 'server', 'data.json');
    if (fs.existsSync(dataPath)) {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      if (data.hosts) {
        const hostIds = Object.keys(data.hosts);
        if (hostIds.length > 0) {
          return res.json({ hostId: hostIds[0] });
        }
      }
    }
    res.json({ hostId: null });
  } catch (e) {
    console.error('Failed to read Moonlight data.json:', e);
    res.json({ hostId: null });
  }
});

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
          const appPath = path.join(sp, entry);
          apps.push({
            name: entry.replace('.app', ''),
            path: appPath,
            image: `/stream/icon?path=${encodeURIComponent(appPath)}`
          });
        }
      }
    } catch (e) {
      console.warn('Failed to scan apps in', sp, e.message);
    }
  }
  return apps;
}

// Endpoint to dynamically extract and serve macOS App icons
router.get('/icon', (req, res) => {
  const appPath = req.query.path;
  if (!appPath || !appPath.endsWith('.app')) return res.status(400).send('Invalid app path');

  const cacheDir = path.join(__dirname, '..', 'data', 'appicons');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const appName = path.basename(appPath, '.app');
  const cachedPng = path.join(cacheDir, `${appName}.png`);

  if (fs.existsSync(cachedPng)) {
    return res.sendFile(cachedPng);
  }

  // Parse Info.plist to find the .icns file
  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
  let icnsName = 'AppIcon.icns'; // fallback
  
  if (fs.existsSync(infoPlistPath)) {
    try {
      const plistContent = fs.readFileSync(infoPlistPath, 'utf8');
      // Simple regex to extract CFBundleIconFile
      const iconMatch = plistContent.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/);
      if (iconMatch) {
        icnsName = iconMatch[1];
        if (!icnsName.endsWith('.icns')) icnsName += '.icns';
      }
    } catch (e) { }
  }

  const icnsPath = path.join(appPath, 'Contents', 'Resources', icnsName);
  
  if (!fs.existsSync(icnsPath)) {
    // Return generic fallback
    return res.redirect('https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=400');
  }

  // Use sips to convert .icns to .png
  exec(`sips -s format png "${icnsPath}" --out "${cachedPng}"`, (err) => {
    if (err) {
      console.error('Failed to convert icns:', err);
      return res.redirect('https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=400');
    }
    res.sendFile(cachedPng);
  });
});

const FALLBACK_ICON = 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=400';

// Endpoint to dynamically extract and serve Windows icons (.exe / .lnk targets)
router.get('/icon-win', (req, res) => {
  const targetPath = req.query.path;
  if (!targetPath) return res.status(400).send('Invalid path');

  const cacheDir = path.join(__dirname, '..', 'data', 'appicons');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const cacheKey = Buffer.from(targetPath).toString('base64').replace(/[/+=]/g, '_');
  const cachedPng = path.join(cacheDir, `${cacheKey}.png`);

  if (fs.existsSync(cachedPng)) return res.sendFile(cachedPng);

  // Extract the shell icon (handles .exe, .lnk, UWP shortcuts) via SHGetFileInfo and save as PNG
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
public class Shell32 {
  [DllImport("shell32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbSizeFileInfo, uint uFlags);
}
"@
try {
  $info = New-Object SHFILEINFO
  $flags = 0x100 -bor 0x000 -bor 0x10  # SHGFI_ICON | SHGFI_LARGEICON
  [Shell32]::SHGetFileInfo("${targetPath.replace(/`/g, '``').replace(/"/g, '`"')}", 0, [ref]$info, [System.Runtime.InteropServices.Marshal]::SizeOf($info), $flags) | Out-Null
  if ($info.hIcon -ne [IntPtr]::Zero) {
    $icon = [System.Drawing.Icon]::FromHandle($info.hIcon)
    $bmp = $icon.ToBitmap()
    $bmp.Save("${cachedPng.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
  }
} catch {}
`.trim();

  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { timeout: 10000 });

  if (result.error || !fs.existsSync(cachedPng)) {
    return res.redirect(FALLBACK_ICON);
  }
  res.sendFile(cachedPng);
});

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
          const nameLower = name.toLowerCase();
          if (!nameLower.includes('wallpaper engine') && !nameLower.includes('steamworks common')) {
            steamGames.push({
              name: name,
              appid: appid,
              // Steam's official CDN for game box art using appid!
              image: `https://steamcdn-a.akamaihd.net/steam/apps/${appid}/library_600x900.jpg`
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn('Failed to scan Steam games', e.message);
  }
  return steamGames;
}

// Windows: scan Start Menu (.lnk) shortcuts for installed applications
function scanWindowsApps() {
  const apps = [];
  const seen = new Set();
  const searchPaths = [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ];

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.toLowerCase().endsWith('.lnk')) {
        const name = entry.name.replace(/\.lnk$/i, '');
        if (seen.has(name.toLowerCase())) continue;
        // Skip noisy uninstaller/help shortcuts
        if (/uninstall|read me|readme|help|license/i.test(name)) continue;
        seen.add(name.toLowerCase());
        apps.push({
          name,
          path: full,
          image: `/stream/icon-win?path=${encodeURIComponent(full)}`
        });
      }
    }
  }

  for (const sp of searchPaths) {
    if (dirExists(sp)) walk(sp);
  }
  return apps;
}

function findSteamInstallPath() {
  try {
    const out = execSync('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath', { encoding: 'utf8' });
    const m = out.match(/InstallPath\s+REG_SZ\s+(.+)/i);
    if (m) return m[1].trim();
  } catch (e) {}
  return 'C:\\Program Files (x86)\\Steam';
}

function parseAppManifest(content) {
  const nameMatch = content.match(/"name"\s+"([^"]+)"/i);
  const appidMatch = content.match(/"appid"\s+"([^"]+)"/i);
  if (!nameMatch || !appidMatch) return null;

  const name = nameMatch[1];
  const nameLower = name.toLowerCase();
  if (nameLower.includes('wallpaper engine') || nameLower.includes('steamworks common')) return null;

  return { name: name, appid: appidMatch[1] };
}

// Finds the install directory (steamapps/common/<installdir>) for a given
// appid, by locating its appmanifest_<appid>.acf across all Steam library
// folders. Used to kill a running game by process path, since there's no
// real steam:// URI for terminating a title by appid.
function findSteamGameInstallDir(appid) {
  const steamPath = findSteamInstallPath();
  const libraryFolders = [path.join(steamPath, 'steamapps')];

  const libVdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (fs.existsSync(libVdfPath)) {
    try {
      const content = fs.readFileSync(libVdfPath, 'utf8');
      for (const m of content.matchAll(/"path"\s+"([^"]+)"/gi)) {
        const lp = path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps');
        if (!libraryFolders.includes(lp)) libraryFolders.push(lp);
      }
    } catch (e) {}
  }

  for (const lib of libraryFolders) {
    const manifestPath = path.join(lib, `appmanifest_${appid}.acf`);
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const content = fs.readFileSync(manifestPath, 'utf8');
      const m = content.match(/"installdir"\s+"([^"]+)"/i);
      if (m) return path.join(lib, 'common', m[1]);
    } catch (e) {}
  }
  return null;
}

// Windows: scan all Steam library folders for installed games
function scanWindowsSteamGames() {
  const steamGames = [];
  const steamPath = findSteamInstallPath();
  const libraryFolders = [path.join(steamPath, 'steamapps')];

  const libVdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (fs.existsSync(libVdfPath)) {
    try {
      const content = fs.readFileSync(libVdfPath, 'utf8');
      const pathMatches = content.matchAll(/"path"\s+"([^"]+)"/gi);
      for (const m of pathMatches) {
        const lp = path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps');
        if (!libraryFolders.includes(lp)) libraryFolders.push(lp);
      }
    } catch (e) {}
  }

  for (const lib of libraryFolders) {
    if (!dirExists(lib)) continue;
    try {
      const files = fs.readdirSync(lib);
      for (const file of files) {
        if (file.startsWith('appmanifest_') && file.endsWith('.acf')) {
          try {
            const content = fs.readFileSync(path.join(lib, file), 'utf8');
            const parsed = parseAppManifest(content);
            if (parsed) {
              steamGames.push({
                name: parsed.name,
                appid: parsed.appid,
                image: `https://steamcdn-a.akamaihd.net/steam/apps/${parsed.appid}/library_600x900.jpg`
              });
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  }
  return steamGames;
}

// Windows: known non-game UWP packages to exclude from the Xbox library (system apps,
// Xbox infrastructure components, OEM utilities, codec/extension packages, etc.)
const XBOX_SCAN_EXCLUDE = [
  /^Microsoft\.MixedReality\.Portal$/i, /^Microsoft\.Xbox\.TCUI$/i, /^Microsoft\.XboxGameOverlay$/i,
  /^Microsoft\.XboxApp$/i, /^Microsoft\.XboxSpeechToTextOverlay$/i, /^Microsoft\.XboxIdentityProvider$/i,
  /^Microsoft\.XboxGamingOverlay$/i, /^Microsoft\.XboxInsider$/i, /^Microsoft\.GamingApp$/i,
  /^Microsoft\.GamingServices$/i, /^Microsoft\.Winget\./i, /^Microsoft\.People$/i,
  /^CanonicalGroupLimited\.Ubuntu$/i, /^Microsoft\.Bing/i, /^microsoft\.windowscommunicationsapps$/i,
  /^Microsoft\.SkypeApp$/i, /^Microsoft\.Windows\.DevHome$/i, /^Microsoft\.Office\./i,
  /^Microsoft\.RemoteDesktop$/i, /VideoExtension/i, /ImageExtension/i, /^Microsoft\.MPEG2/i,
  /^Microsoft\.ApplicationCompatibilityEnhancements$/i, /^Microsoft\.Microsoft3DViewer$/i,
  /^MicrosoftCorporationII\./i, /CrosshairExtension/i, /^Microsoft\.WebMediaExtensions$/i,
  /^AppleInc\.AppleDevices$/i, /^Microsoft\.SecHealthUI$/i, /^MicrosoftWindows\.NarratorScript/i,
  /^MicrosoftWindows\.NarratorExtension/i, /^Microsoft\.WindowsTerminal$/i, /^Clipchamp\./i,
  /^Microsoft\.LanguageExperiencePack/i, /^MicrosoftWindows\.Speech/i, /^Microsoft\.WidgetsPlatformRuntime$/i,
  /^DolbyLaboratories\./i, /^Microsoft\.ScreenSketch$/i, /^Microsoft\.GetHelp$/i,
  /^Microsoft\.Ink\.Handwriting/i, /^Microsoft\.StorePurchaseApp$/i, /^MicrosoftWindows\.Client\.WebExperience$/i,
  /^Microsoft\.WindowsAlarms$/i, /^Microsoft\.Paint$/i, /^Microsoft\.WindowsSoundRecorder$/i,
  /^Microsoft\.ZuneVideo$/i, /^Microsoft\.ZuneMusic$/i, /^Microsoft\.YourPhone$/i,
  /^Microsoft\.WindowsCamera$/i, /^Microsoft\.Windows\.Photos$/i, /^Microsoft\.StartExperiencesApp$/i,
  /^Microsoft\.Todos$/i, /^Microsoft\.PowerAutomateDesktop$/i, /^Microsoft\.DesktopAppInstaller$/i,
  /^Microsoft\.WindowsNotepad$/i, /^Microsoft\.WindowsFeedbackHub$/i, /^Microsoft\.WindowsStore$/i,
  /^Microsoft\.MicrosoftOfficeHub$/i, /^Microsoft\.WindowsCalculator$/i, /^MicrosoftWindows\.CrossDevice$/i,
  /WhatsAppDesktop/i, /^DTSInc\./i, /GameBarWidgets/i, /^AMDLink/i, /^AdvancedMicroDevicesInc/i,
  /^NVIDIACorp\./i, /Cinebench/i
];

const XBOX_SCAN_SCRIPT = `
Get-AppxPackage | Where-Object {
  $_.SignatureKind -eq 'Store' -and -not $_.IsFramework -and -not $_.IsResourcePackage
} | ForEach-Object {
  try {
    $manifest = Get-AppxPackageManifest -Package $_
    $app = $manifest.Package.Applications.Application | Select-Object -First 1
    [PSCustomObject]@{
      name = $manifest.Package.Properties.DisplayName
      packageName = $_.Name
      familyName = $_.PackageFamilyName
      appId = $app.Id
      logo = $manifest.Package.Properties.Logo
      installLocation = $_.InstallLocation
    }
  } catch {}
} | ConvertTo-Json -Compress
`.trim();

// Windows: scan installed Xbox/Game Pass UWP games via the AppX package list
function scanWindowsXboxGames() {
  const games = [];
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', XBOX_SCAN_SCRIPT], {
      timeout: 20000,
      maxBuffer: 1024 * 1024 * 10
    });
    if (result.error || !result.stdout) return games;

    let parsed = JSON.parse(result.stdout.toString().trim() || '[]');
    if (!Array.isArray(parsed)) parsed = [parsed];

    for (const pkg of parsed) {
      if (!pkg || !pkg.packageName || !pkg.familyName || !pkg.appId) continue;
      if (XBOX_SCAN_EXCLUDE.some(re => re.test(pkg.packageName))) continue;
      if (!pkg.name || pkg.name.startsWith('ms-resource:')) pkg.name = pkg.packageName;

      let logoPath = null;
      if (pkg.logo && pkg.installLocation) {
        const candidate = path.join(pkg.installLocation, pkg.logo.replace(/\//g, path.sep));
        if (fs.existsSync(candidate)) logoPath = candidate;
      }

      games.push({
        name: pkg.name,
        familyName: pkg.familyName,
        appId: pkg.appId,
        image: logoPath ? `/stream/icon-xbox?path=${encodeURIComponent(logoPath)}` : undefined
      });
    }
  } catch (e) {
    console.warn('Failed to scan Xbox games', e.message);
  }
  return games;
}

// Endpoint to serve Xbox/UWP game logo images directly from their install location
router.get('/icon-xbox', (req, res) => {
  const imgPath = req.query.path;
  if (!imgPath || !fs.existsSync(imgPath)) return res.redirect(FALLBACK_ICON);
  res.sendFile(imgPath);
});

// The main scan endpoint
router.get('/scan', (req, res) => {
  const platform = process.platform;
  let apps = [];
  let steam = [];
  let xbox = [];

  if (platform === 'darwin') {
    apps = scanMacApps();
    steam = scanSteamGames();
  } else if (platform === 'win32') {
    apps = scanWindowsApps();
    steam = scanWindowsSteamGames();
    xbox = scanWindowsXboxGames();
  }

  // Limit apps so we don't overload the frontend UI initially
  // Sort alphabetically
  apps.sort((a,b) => a.name.localeCompare(b.name));

  res.json({
    apps: apps,
    steam: steam,
    xbox: xbox
  });

  // Best-effort: keep Apollo/Sunshine's apps.json in sync so individual launches
  // can be resolved by name through the Moonlight Web Stream proxy.
  if (platform === 'win32') {
    setImmediate(() => {
      try {
        const result = sunshineSyncWin.syncWindowsApps(apps, steam);
        if (!result.ok) console.warn('[sunshine-sync-win]', result.reason);
      } catch (e) {
        console.warn('[sunshine-sync-win] sync failed:', e.message);
      }
    });
  }
});

function forceFocus(appName, fp) {
  const { exec } = require('child_process');
  setTimeout(() => {
    let baseName = appName;
    if (!baseName && fp) {
      baseName = require('path').basename(fp, require('path').extname(fp));
    }
    if (!baseName) return;
    
    baseName = baseName.replace(/"/g, '');

    if (process.platform === 'win32') {
      exec(`powershell -Command "$wshell = New-Object -ComObject wscript.shell; $wshell.AppActivate('${baseName}')"`);
    } else if (process.platform === 'linux') {
      exec(`wmctrl -a "${baseName}"`);
    } else if (process.platform === 'darwin') {
      exec(`osascript -e 'tell application "${baseName}" to activate'`);
    }
  }, 3000);
}

router.post('/launch', (req, res) => {
  const fp = req.body.path;
  const appid = req.body.appid;
  const familyName = req.body.familyName;
  const xboxAppId = req.body.xboxAppId;
  const appName = req.body.name; // Use passed app name to help with focusing

  lastLaunched = { fp, appid, familyName, xboxAppId, appName };

  try {
    if (familyName && xboxAppId) {
      // Launch an installed Xbox/Game Pass UWP game via its AppsFolder shell path
      const p = spawn('explorer.exe', [`shell:AppsFolder\\${familyName}!${xboxAppId}`], { detached: true, stdio: 'ignore' });
      p.unref();
    } else if (appid) {
      // Launch Steam game
      const cmd = process.platform === 'darwin' ? 'open' : 'cmd';
      const args = process.platform === 'darwin' ? [`steam://rungameid/${appid}`] : ['/c', 'start', `steam://rungameid/${appid}`];
      const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      p.unref();
    } else if (fp) {
      // Launch local app natively using macOS 'open' command which guarantees it opens
      const cmd = process.platform === 'darwin' ? 'open' : 'cmd';
      const args = process.platform === 'darwin' ? [fp] : ['/c', 'start', '', fp];
      const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      p.unref();
    } else if (appName === 'Steam Big Picture') {
      const cmd = process.platform === 'darwin' ? 'open' : 'cmd';
      const args = process.platform === 'darwin' ? ['steam://open/bigpicture'] : ['/c', 'start', 'steam://open/bigpicture'];
      const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      p.unref();
    } else if (appName === 'Xbox') {
      const cmd = process.platform === 'darwin' ? 'open' : 'cmd';
      const args = process.platform === 'darwin' ? ['xbox:'] : ['/c', 'start', 'xbox:'];
      const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      p.unref();
    } else if (appName === 'Remote Desktop') {
      // Typically desktop is already there, but we can try to minimize things or just do nothing
      // We will just do nothing and return ok.
    }
    
    // Ensure window comes to foreground
    forceFocus(appName, fp);
    
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Terminates whatever app /launch most recently started, so closing a stream
// session can actually stop the game/app on the host instead of leaving it
// running in the background.
router.post('/kill', (req, res) => {
  const target = lastLaunched;
  if (!target) return res.json({ ok: true, skipped: true });
  lastLaunched = null;

  try {
    if (target.familyName) {
      // Xbox/Game Pass UWP app. PackageFamilyName (e.g. "Foo_8wekyb3d8bbwe")
      // is NOT a substring of the actual WindowsApps install folder (e.g.
      // "Foo_1.2.0.0_x64__8wekyb3d8bbwe" — version/arch are wedged in between
      // the name and publisher id), so a path-pattern match never hits.
      // Resolve the package's real InstallLocation first, then kill any
      // process whose exe lives under it.
      if (process.platform === 'win32') {
        const fam = target.familyName.replace(/`/g, '``').replace(/"/g, '`"');
        const ps = `
$pkg = Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq "${fam}" } | Select-Object -First 1
if ($pkg -and $pkg.InstallLocation) {
  $loc = $pkg.InstallLocation
  try { Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($loc, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } } catch {}
}
`.trim();
        spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 8000, windowsHide: true });
      }
    } else if (target.appid) {
      // Steam game — there's no real steam:// URI for terminating a title by
      // appid, so resolve its actual install directory from the local Steam
      // library manifest and kill any process running out of it.
      if (process.platform === 'win32') {
        const installDir = findSteamGameInstallDir(target.appid);
        if (installDir) {
          const escaped = installDir.replace(/`/g, '``').replace(/"/g, '`"');
          const ps = `
$loc = "${escaped}"
try { Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($loc, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } } catch {}
`.trim();
          spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 8000, windowsHide: true });
        }
      } else if (process.platform === 'darwin') {
        spawn('open', [`steam://terminateapp/${target.appid}`], { detached: true, stdio: 'ignore' }).unref();
      }
    } else if (target.fp) {
      if (process.platform === 'win32') {
        // target.fp is often a Start Menu .lnk shortcut, not the real exe —
        // taskkill needs the actual running image name, so resolve the
        // shortcut's target first. Belt-and-suspenders: kill by resolved
        // Path match (exact) and by image name (in case Path isn't readable
        // for that process, e.g. elevated/protected processes).
        const escaped = target.fp.replace(/`/g, '``').replace(/"/g, '`"');
        const ps = `
$lnk = "${escaped}"
$resolved = $lnk
if ($lnk -like "*.lnk") {
  try {
    $sh = New-Object -ComObject WScript.Shell
    $sc = $sh.CreateShortcut($lnk)
    if ($sc.TargetPath) { $resolved = $sc.TargetPath }
  } catch {}
}
$name = [System.IO.Path]::GetFileName($resolved)
try { Get-Process | Where-Object { $_.Path -and ([System.IO.Path]::GetFileName($_.Path) -ieq $name) } | Stop-Process -Force } catch {}
try { taskkill /F /IM "$name" } catch {}
`.trim();
        spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 8000, windowsHide: true });
      } else {
        const base = path.basename(target.fp);
        spawnSync('pkill', ['-f', base], { timeout: 5000 });
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
