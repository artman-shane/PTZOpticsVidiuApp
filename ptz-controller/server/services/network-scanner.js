const net = require('net');
const os = require('os');
const axios = require('axios');

/**
 * Get local network info (IP and subnet)
 */
function getLocalNetworkInfo() {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip loopback and non-IPv4
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        const subnet = parts.slice(0, 3).join('.');
        return {
          localIP: iface.address,
          subnet: subnet,
          netmask: iface.netmask
        };
      }
    }
  }
  return null;
}

/**
 * Check if a port is open on a host
 */
function checkPort(host, port, timeout = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * Try to identify device type by probing endpoints
 */
async function identifyDevice(ip) {
  const device = { ip, type: 'unknown', name: null };

  // Check for PTZ Optics camera (has CGI interface)
  try {
    const ptzResponse = await axios.get(`http://${ip}/cgi-bin/param.cgi?get_device_conf`, {
      timeout: 1500
    });
    if (ptzResponse.data && (ptzResponse.data.includes('PTZ') || ptzResponse.data.includes('devname'))) {
      device.type = 'ptz-camera';
      // Try to extract name
      const match = ptzResponse.data.match(/devname=([^\r\n&]+)/);
      if (match) device.name = decodeURIComponent(match[1]);
      else device.name = 'PTZ Camera';
      return device;
    }
  } catch (e) {}

  // Check for Teradek Vidiu (has specific API)
  try {
    const vidiuResponse = await axios.get(`http://${ip}/api/status`, {
      timeout: 1500
    });
    if (vidiuResponse.data && (vidiuResponse.data.device || vidiuResponse.data.streaming !== undefined)) {
      device.type = 'vidiu';
      device.name = vidiuResponse.data.device?.name || 'Vidiu';
      return device;
    }
  } catch (e) {}

  // Alternative Vidiu check - try the web UI
  try {
    const vidiuAlt = await axios.get(`http://${ip}/`, {
      timeout: 1500
    });
    if (vidiuAlt.data && (vidiuAlt.data.includes('Teradek') || vidiuAlt.data.includes('Vidiu'))) {
      device.type = 'vidiu';
      device.name = 'Vidiu';
      return device;
    }
  } catch (e) {}

  return null;
}

/**
 * Scan network for devices
 * @param {function} onProgress - Callback for progress updates
 */
async function scanNetwork(onProgress) {
  const networkInfo = getLocalNetworkInfo();
  if (!networkInfo) {
    throw new Error('Could not determine local network');
  }

  const { subnet } = networkInfo;
  const devices = [];
  const portsToCheck = [80, 554]; // HTTP and RTSP

  // Scan IPs 1-254
  const scanPromises = [];

  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;

    scanPromises.push(
      (async () => {
        // Quick port check first
        const hasHttp = await checkPort(ip, 80, 300);

        if (hasHttp) {
          const device = await identifyDevice(ip);
          if (device && device.type !== 'unknown') {
            devices.push(device);
            if (onProgress) onProgress({ found: device, progress: i / 254 });
          }
        }

        if (onProgress && i % 25 === 0) {
          onProgress({ progress: i / 254 });
        }
      })()
    );

    // Batch requests to avoid overwhelming the network
    if (scanPromises.length >= 20) {
      await Promise.all(scanPromises);
      scanPromises.length = 0;
    }
  }

  // Wait for remaining scans
  await Promise.all(scanPromises);

  return {
    networkInfo,
    devices
  };
}

module.exports = {
  getLocalNetworkInfo,
  checkPort,
  identifyDevice,
  scanNetwork
};
