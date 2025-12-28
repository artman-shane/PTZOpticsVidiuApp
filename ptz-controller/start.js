const { spawn } = require('child_process');
const path = require('path');
const config = require('./config.json');

const MEDIAMTX_PATH = path.join(__dirname, 'mediamtx', 'mediamtx');
const MEDIAMTX_CONFIG = path.join(__dirname, 'mediamtx', 'mediamtx.yml');

console.log('Starting PTZ Controller...\n');

// Start MediaMTX
console.log('Starting MediaMTX (RTSP to WebRTC converter)...');
const mediamtx = spawn(MEDIAMTX_PATH, [MEDIAMTX_CONFIG], {
  cwd: path.join(__dirname, 'mediamtx'),
  stdio: ['ignore', 'pipe', 'pipe']
});

mediamtx.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    if (line.includes('ERR') || line.includes('error')) {
      console.log(`[MediaMTX] ${line}`);
    } else if (line.includes('listener opened') || line.includes('is ready')) {
      console.log(`[MediaMTX] ${line}`);
    }
  });
});

mediamtx.stderr.on('data', (data) => {
  console.error(`[MediaMTX Error] ${data}`);
});

mediamtx.on('error', (err) => {
  console.error('Failed to start MediaMTX:', err.message);
});

// Start Express server after a brief delay
setTimeout(() => {
  console.log('\nStarting Express server...');
  require('./server/index.js');
}, 1000);

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  mediamtx.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  mediamtx.kill();
  process.exit(0);
});

// Keep the process running
process.stdin.resume();
