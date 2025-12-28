const net = require('net');
const config = require('../../config.json');

const VISCA_PORT = config.camera.viscaPort;
const CAMERA_IP = config.camera.ip;

// VISCA command constants
const VISCA_COMMANDS = {
  // Exposure modes
  EXPOSURE_AUTO: Buffer.from([0x81, 0x01, 0x04, 0x39, 0x00, 0xFF]),
  EXPOSURE_MANUAL: Buffer.from([0x81, 0x01, 0x04, 0x39, 0x03, 0xFF]),
  EXPOSURE_SHUTTER: Buffer.from([0x81, 0x01, 0x04, 0x39, 0x0A, 0xFF]),
  EXPOSURE_IRIS: Buffer.from([0x81, 0x01, 0x04, 0x39, 0x0B, 0xFF]),
  EXPOSURE_BRIGHT: Buffer.from([0x81, 0x01, 0x04, 0x39, 0x0D, 0xFF]),

  // White balance modes
  WB_AUTO: Buffer.from([0x81, 0x01, 0x04, 0x35, 0x00, 0xFF]),
  WB_INDOOR: Buffer.from([0x81, 0x01, 0x04, 0x35, 0x01, 0xFF]),
  WB_OUTDOOR: Buffer.from([0x81, 0x01, 0x04, 0x35, 0x02, 0xFF]),
  WB_ONEPUSH: Buffer.from([0x81, 0x01, 0x04, 0x35, 0x03, 0xFF]),
  WB_MANUAL: Buffer.from([0x81, 0x01, 0x04, 0x35, 0x05, 0xFF]),

  // Backlight
  BACKLIGHT_ON: Buffer.from([0x81, 0x01, 0x04, 0x33, 0x02, 0xFF]),
  BACKLIGHT_OFF: Buffer.from([0x81, 0x01, 0x04, 0x33, 0x03, 0xFF]),

  // Gain
  GAIN_RESET: Buffer.from([0x81, 0x01, 0x04, 0x0C, 0x00, 0xFF]),
  GAIN_UP: Buffer.from([0x81, 0x01, 0x04, 0x0C, 0x02, 0xFF]),
  GAIN_DOWN: Buffer.from([0x81, 0x01, 0x04, 0x0C, 0x03, 0xFF]),

  // Shutter
  SHUTTER_RESET: Buffer.from([0x81, 0x01, 0x04, 0x0A, 0x00, 0xFF]),
  SHUTTER_UP: Buffer.from([0x81, 0x01, 0x04, 0x0A, 0x02, 0xFF]),
  SHUTTER_DOWN: Buffer.from([0x81, 0x01, 0x04, 0x0A, 0x03, 0xFF]),

  // Iris
  IRIS_RESET: Buffer.from([0x81, 0x01, 0x04, 0x0B, 0x00, 0xFF]),
  IRIS_UP: Buffer.from([0x81, 0x01, 0x04, 0x0B, 0x02, 0xFF]),
  IRIS_DOWN: Buffer.from([0x81, 0x01, 0x04, 0x0B, 0x03, 0xFF]),

  // Red/Blue gain for manual white balance
  RED_GAIN_RESET: Buffer.from([0x81, 0x01, 0x04, 0x03, 0x00, 0xFF]),
  RED_GAIN_UP: Buffer.from([0x81, 0x01, 0x04, 0x03, 0x02, 0xFF]),
  RED_GAIN_DOWN: Buffer.from([0x81, 0x01, 0x04, 0x03, 0x03, 0xFF]),
  BLUE_GAIN_RESET: Buffer.from([0x81, 0x01, 0x04, 0x04, 0x00, 0xFF]),
  BLUE_GAIN_UP: Buffer.from([0x81, 0x01, 0x04, 0x04, 0x02, 0xFF]),
  BLUE_GAIN_DOWN: Buffer.from([0x81, 0x01, 0x04, 0x04, 0x03, 0xFF]),

  // Focus
  FOCUS_AUTO: Buffer.from([0x81, 0x01, 0x04, 0x38, 0x02, 0xFF]),
  FOCUS_MANUAL: Buffer.from([0x81, 0x01, 0x04, 0x38, 0x03, 0xFF]),
  FOCUS_ONE_PUSH: Buffer.from([0x81, 0x01, 0x04, 0x18, 0x01, 0xFF]),
};

/**
 * Send a VISCA command via TCP
 * @param {Buffer} command - The VISCA command buffer
 * @returns {Promise<{success: boolean, data?: Buffer, error?: string}>}
 */
function sendVISCACommand(command) {
  return new Promise((resolve) => {
    const client = new net.Socket();
    let responseData = Buffer.alloc(0);

    client.setTimeout(3000);

    client.connect(VISCA_PORT, CAMERA_IP, () => {
      client.write(command);
    });

    client.on('data', (data) => {
      responseData = Buffer.concat([responseData, data]);
      // VISCA responses end with 0xFF
      if (data[data.length - 1] === 0xFF) {
        client.destroy();
        resolve({ success: true, data: responseData });
      }
    });

    client.on('timeout', () => {
      client.destroy();
      resolve({ success: false, error: 'Connection timeout' });
    });

    client.on('error', (err) => {
      client.destroy();
      resolve({ success: false, error: err.message });
    });

    client.on('close', () => {
      if (responseData.length > 0) {
        resolve({ success: true, data: responseData });
      }
    });
  });
}

// Exposure functions
async function setExposureMode(mode) {
  const modeMap = {
    'auto': VISCA_COMMANDS.EXPOSURE_AUTO,
    'manual': VISCA_COMMANDS.EXPOSURE_MANUAL,
    'shutter': VISCA_COMMANDS.EXPOSURE_SHUTTER,
    'iris': VISCA_COMMANDS.EXPOSURE_IRIS,
    'bright': VISCA_COMMANDS.EXPOSURE_BRIGHT,
  };
  const cmd = modeMap[mode];
  if (!cmd) return { success: false, error: 'Invalid exposure mode' };
  return sendVISCACommand(cmd);
}

async function adjustGain(direction) {
  if (direction === 'up') return sendVISCACommand(VISCA_COMMANDS.GAIN_UP);
  if (direction === 'down') return sendVISCACommand(VISCA_COMMANDS.GAIN_DOWN);
  if (direction === 'reset') return sendVISCACommand(VISCA_COMMANDS.GAIN_RESET);
  return { success: false, error: 'Invalid direction' };
}

async function adjustShutter(direction) {
  if (direction === 'up') return sendVISCACommand(VISCA_COMMANDS.SHUTTER_UP);
  if (direction === 'down') return sendVISCACommand(VISCA_COMMANDS.SHUTTER_DOWN);
  if (direction === 'reset') return sendVISCACommand(VISCA_COMMANDS.SHUTTER_RESET);
  return { success: false, error: 'Invalid direction' };
}

async function adjustIris(direction) {
  if (direction === 'up') return sendVISCACommand(VISCA_COMMANDS.IRIS_UP);
  if (direction === 'down') return sendVISCACommand(VISCA_COMMANDS.IRIS_DOWN);
  if (direction === 'reset') return sendVISCACommand(VISCA_COMMANDS.IRIS_RESET);
  return { success: false, error: 'Invalid direction' };
}

async function setBacklight(enabled) {
  const cmd = enabled ? VISCA_COMMANDS.BACKLIGHT_ON : VISCA_COMMANDS.BACKLIGHT_OFF;
  return sendVISCACommand(cmd);
}

// White balance functions
async function setWhiteBalanceMode(mode) {
  const modeMap = {
    'auto': VISCA_COMMANDS.WB_AUTO,
    'indoor': VISCA_COMMANDS.WB_INDOOR,
    'outdoor': VISCA_COMMANDS.WB_OUTDOOR,
    'onepush': VISCA_COMMANDS.WB_ONEPUSH,
    'manual': VISCA_COMMANDS.WB_MANUAL,
  };
  const cmd = modeMap[mode];
  if (!cmd) return { success: false, error: 'Invalid white balance mode' };
  return sendVISCACommand(cmd);
}

async function adjustRedGain(direction) {
  if (direction === 'up') return sendVISCACommand(VISCA_COMMANDS.RED_GAIN_UP);
  if (direction === 'down') return sendVISCACommand(VISCA_COMMANDS.RED_GAIN_DOWN);
  if (direction === 'reset') return sendVISCACommand(VISCA_COMMANDS.RED_GAIN_RESET);
  return { success: false, error: 'Invalid direction' };
}

async function adjustBlueGain(direction) {
  if (direction === 'up') return sendVISCACommand(VISCA_COMMANDS.BLUE_GAIN_UP);
  if (direction === 'down') return sendVISCACommand(VISCA_COMMANDS.BLUE_GAIN_DOWN);
  if (direction === 'reset') return sendVISCACommand(VISCA_COMMANDS.BLUE_GAIN_RESET);
  return { success: false, error: 'Invalid direction' };
}

// Focus functions
async function setFocusMode(mode) {
  if (mode === 'auto') return sendVISCACommand(VISCA_COMMANDS.FOCUS_AUTO);
  if (mode === 'manual') return sendVISCACommand(VISCA_COMMANDS.FOCUS_MANUAL);
  return { success: false, error: 'Invalid focus mode' };
}

async function focusOnePush() {
  return sendVISCACommand(VISCA_COMMANDS.FOCUS_ONE_PUSH);
}

module.exports = {
  sendVISCACommand,
  VISCA_COMMANDS,
  setExposureMode,
  adjustGain,
  adjustShutter,
  adjustIris,
  setBacklight,
  setWhiteBalanceMode,
  adjustRedGain,
  adjustBlueGain,
  setFocusMode,
  focusOnePush,
};
