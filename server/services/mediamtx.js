const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');

/**
 * Get local IPv4 addresses for WebRTC ICE candidates
 */
function getLocalIPs() {
  const ips = ['127.0.0.1'];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

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
webrtcLocalUDPAddress: 0.0.0.0:8189
webrtcIPsFromInterfaces: yes
webrtcAdditionalHosts: [${getLocalIPs().join(', ')}]

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
 * Kill any stale MediaMTX processes from previous runs
 */
function killStaleProcesses() {
  try {
    const pids = execSync('pgrep -f mediamtx', { encoding: 'utf8' }).trim().split('\n');
    for (const pid of pids) {
      if (pid && parseInt(pid) !== process.pid) {
        console.log(`[MediaMTX] Killing stale process ${pid}`);
        process.kill(parseInt(pid), 'SIGKILL');
      }
    }
  } catch (e) {
    // pgrep returns non-zero when no processes found — that's fine
  }
}

/**
 * Start MediaMTX process
 */
function start() {
  if (mediamtxProcess) {
    console.log('[MediaMTX] Already running');
    return;
  }

  killStaleProcesses();
  console.log('[MediaMTX] Starting...');

  mediamtxProcess = spawn(BINARY_PATH, [], {
    cwd: MEDIAMTX_DIR,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  mediamtxProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      if (line.includes('ERR') || line.includes('WAR') || line.includes('listener opened') || line.includes('started') || line.includes('ready') || line.includes('peer connection')) {
        console.log(`[MediaMTX] ${line}`);
      }
    });
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
