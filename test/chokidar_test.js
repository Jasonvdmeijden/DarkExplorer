const chokidar = require('chokidar');
const { execSync } = require('child_process');
const { fork } = require('child_process');
const path = require('path');

const out = execSync('wmic logicaldisk get name', { encoding: 'utf8' });
const roots = out.split('\n').map(l => l.trim()).filter(l => /^[A-Z]:$/.test(l)).map(d => d + '\\');
console.log('roots:', roots);

// Test 1: Does chokidar.watch() block?
console.log('\n--- Test 1: chokidar.watch() ---');
const t0 = Date.now();
const w = chokidar.watch(roots, { persistent: false, ignoreInitial: true, depth: 2 });
console.log('chokidar.watch() returned immediately:', Date.now() - t0, 'ms');

// check if event loop is free
setImmediate(() => console.log('event loop: setImmediate fired OK'));
setTimeout(() => {
  console.log('event loop: setTimeout fired OK, closing chokidar...');
  w.close();

  // Test 2: Does fork() block?
  console.log('\n--- Test 2: fork() ---');
  const t1 = Date.now();
  const child = fork(path.join(__dirname, '../server/indexer.js'), [], { stdio: 'ignore' });
  console.log('fork() returned in', Date.now() - t1, 'ms');
  setImmediate(() => console.log('event loop after fork: setImmediate fired OK'));
  setTimeout(() => {
    console.log('killing child process');
    child.kill();
    process.exit(0);
  }, 2000);
}, 1000);
