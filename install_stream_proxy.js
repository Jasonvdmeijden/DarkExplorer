const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('===========================================================');
console.log('  DarkExplorer - Stream View WebRTC Proxy Installer (Node)');
console.log('===========================================================');

function run(cmd, cwd) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd });
  } catch (e) {
    console.error(`Command failed: ${cmd}`);
    process.exit(1);
  }
}

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// 1. Rust
try {
  execSync('cargo --version', { stdio: 'ignore' });
  console.log('Rust is already installed.');
} catch (e) {
  console.log('Installing Rust...');
  if (isWin) {
    console.log('Please install Rust manually on Windows: https://rustup.rs/');
  } else {
    run(`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`);
  }
}

// 2. CMake
try {
  execSync('cmake --version', { stdio: 'ignore' });
  console.log('CMake is already installed.');
} catch (e) {
  console.log('Installing CMake...');
  if (isMac) {
    run('brew install cmake');
  } else if (isWin) {
    run('winget install cmake');
  }
}

// 3. Sunshine
if (isMac) {
  if (!fs.existsSync('/Applications/Sunshine.app')) {
    console.log('Installing Sunshine...');
    run('curl -L -o /tmp/sunshine.dmg https://github.com/LizardByte/Sunshine/releases/latest/download/Sunshine-macOS-arm64.dmg');
    run('yes | hdiutil attach /tmp/sunshine.dmg -mountpoint /Volumes/Sunshine -nobrowse -noverify -noautoopen');
    run('cp -R /Volumes/Sunshine/Sunshine.app /Applications/');
    run('hdiutil detach /Volumes/Sunshine');
    run('rm /tmp/sunshine.dmg');
    console.log('Please launch Sunshine from /Applications to grant permissions.');
  } else {
    console.log('Sunshine is already installed.');
  }
} else if (isWin) {
  console.log('Ensure Sunshine is installed: https://github.com/LizardByte/Sunshine/releases');
}

// 4. Proxy
const proxyDir = path.join(os.homedir(), 'moonlight-web-stream');
if (!fs.existsSync(proxyDir)) {
  run(`git clone https://github.com/MrCreativ3001/moonlight-web-stream.git "${proxyDir}"`);
}

console.log('Building proxy...');
run('npm install', proxyDir);
// Source cargo env on unix
const cargoEnv = isWin ? '' : `source "$HOME/.cargo/env" && `;
run(`${cargoEnv}npm run build`, proxyDir);
run(`${cargoEnv}cargo build --release`, proxyDir);

console.log('===========================================================');
console.log('Installation complete!');
console.log(`To start the proxy, navigate to ${proxyDir} and run:`);
console.log(isWin ? '.\\target\\release\\web-server.exe' : './target/release/web-server');
console.log('===========================================================');
