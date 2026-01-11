const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MEDIAMTX_DIR = path.join(__dirname, '../../mediamtx');
const CONFIG_PATH = path.join(MEDIAMTX_DIR, 'mediamtx.yml');
const BINARY_PATH = path.join(MEDIAMTX_DIR, 'mediamtx');

let mediamtxProcess = null;

/**
 * Generate MediaMTX config from application settings
 */
function generateConfig(settings) {
  const { camera, mediamtx } = settings;

  // Build RTSP source URL with optional credentials
  let rtspUrl = 'rtsp://';
  if (camera.username && camera.password) {
    rtspUrl += `${camera.username}:${camera.password}@`;
  }
  rtspUrl += `${camera.ip}:${camera.rtspPort || 554}${camera.rtspPath || '/1'}`;

  const config = `###############################################
# MediaMTX Configuration - Auto-generated
# Do not edit manually - changes will be overwritten
###############################################

logLevel: info
logDestinations: [stdout]

readTimeout: 10s
writeTimeout: 10s
writeQueueSize: 512
udpMaxPayloadSize: 1472

authMethod: internal
authInternalUsers:
- user: any
  pass:
  ips: []
  permissions:
  - action: publish
    path:
  - action: read
    path:
  - action: playback
    path:
- user: any
  pass:
  ips: ['127.0.0.1', '::1']
  permissions:
  - action: api
  - action: metrics
  - action: pprof

api: no
apiAddress: :9997

rtsp: yes
protocols: [udp, multicast, tcp]
encryption: "no"
rtspAddress: :${mediamtx.rtspPort || 8554}
rtspsAddress: :8322
rtpAddress: :8000
rtcpAddress: :8001

rtmp: yes
rtmpAddress: :1935
rtmpEncryption: "no"

hls: yes
hlsAddress: :${mediamtx.hlsPort || 8888}
hlsEncryption: no
hlsAllowOrigin: '*'
hlsVariant: lowLatency
hlsSegmentCount: 7
hlsSegmentDuration: 1s
hlsPartDuration: 200ms

webrtc: yes
webrtcAddress: :${mediamtx.webrtcPort || 8889}
webrtcEncryption: no
webrtcAllowOrigin: '*'
webrtcLocalUDPAddress: :8189
webrtcIPsFromInterfaces: yes

srt: yes
srtAddress: :8890

pathDefaults:
  source: publisher
  sourceOnDemand: no
  maxReaders: 0

paths:
  # PTZ Camera stream - pulled from camera RTSP
  camera:
    source: ${rtspUrl}
    sourceOnDemand: yes
    sourceOnDemandStartTimeout: 10s
    sourceOnDemandCloseAfter: 10s

  all_others:
`;

  return config;
}

/**
 * Write config and restart MediaMTX
 */
async function updateConfig(settings) {
  const config = generateConfig(settings);

  // Write config file
  fs.writeFileSync(CONFIG_PATH, config, 'utf8');
  console.log('[MediaMTX] Config updated');

  // Restart MediaMTX
  await restart();
}

/**
 * Start MediaMTX process
 */
function start() {
  if (mediamtxProcess) {
    console.log('[MediaMTX] Already running');
    return;
  }

  console.log('[MediaMTX] Starting...');

  mediamtxProcess = spawn(BINARY_PATH, [], {
    cwd: MEDIAMTX_DIR,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  mediamtxProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => console.log(`[MediaMTX] ${line}`));
  });

  mediamtxProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => console.error(`[MediaMTX] ${line}`));
  });

  mediamtxProcess.on('close', (code) => {
    console.log(`[MediaMTX] Process exited with code ${code}`);
    mediamtxProcess = null;
  });

  mediamtxProcess.on('error', (err) => {
    console.error('[MediaMTX] Failed to start:', err.message);
    mediamtxProcess = null;
  });
}

/**
 * Stop MediaMTX process
 */
function stop() {
  return new Promise((resolve) => {
    if (!mediamtxProcess) {
      resolve();
      return;
    }

    console.log('[MediaMTX] Stopping...');

    mediamtxProcess.on('close', () => {
      mediamtxProcess = null;
      resolve();
    });

    mediamtxProcess.kill('SIGTERM');

    // Force kill after 5 seconds
    setTimeout(() => {
      if (mediamtxProcess) {
        mediamtxProcess.kill('SIGKILL');
      }
    }, 5000);
  });
}

/**
 * Restart MediaMTX
 */
async function restart() {
  await stop();
  await new Promise(resolve => setTimeout(resolve, 1000));
  start();
}

/**
 * Check if MediaMTX is running
 */
function isRunning() {
  return mediamtxProcess !== null;
}

module.exports = {
  generateConfig,
  updateConfig,
  start,
  stop,
  restart,
  isRunning
};
