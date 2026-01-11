const axios = require('axios');
const config = require('../../config.json');

const CAMERA_BASE_URL = `http://${config.camera.ip}`;

/**
 * Send a PTZ command to the camera via HTTP-CGI
 * @param {string} command - The command string (e.g., "up&12&12")
 */
async function sendPTZCommand(command) {
  const url = `${CAMERA_BASE_URL}/cgi-bin/ptzctrl.cgi?ptzcmd&${command}`;
  try {
    const response = await axios.get(url, { timeout: 5000 });
    return { success: true, data: response.data };
  } catch (error) {
    console.error(`PTZ command failed: ${command}`, error.message);
    return { success: false, error: error.message };
  }
}

// Track if we're simulating diagonal movement
let diagonalSimulation = null;

/**
 * Move camera in a direction
 * @param {string} direction - up, down, left, right, upleft, upright, downleft, downright
 * @param {number} panSpeed - 1-24
 * @param {number} tiltSpeed - 1-20
 * @param {boolean} simulate - If true, simulate diagonals with alternating movements
 */
async function move(direction, panSpeed = 12, tiltSpeed = 12, simulate = false) {
  // Clamp speeds to valid ranges
  panSpeed = Math.max(1, Math.min(24, Math.round(panSpeed)));
  tiltSpeed = Math.max(1, Math.min(20, Math.round(tiltSpeed)));

  // Check if this is a diagonal direction
  const isDiagonal = ['upleft', 'upright', 'downleft', 'downright'].includes(direction);

  if (isDiagonal && simulate) {
    // Simulate diagonal with alternating pan/tilt
    return startDiagonalSimulation(direction, panSpeed, tiltSpeed);
  }

  // Stop any diagonal simulation
  stopDiagonalSimulation();

  // Map direction names to PTZ Optics expected format
  const directionMap = {
    'up': 'up',
    'down': 'down',
    'left': 'left',
    'right': 'right',
    'upleft': 'leftup',
    'upright': 'rightup',
    'downleft': 'leftdown',
    'downright': 'rightdown'
  };

  const ptzDirection = directionMap[direction] || direction;
  return sendPTZCommand(`${ptzDirection}&${panSpeed}&${tiltSpeed}`);
}

/**
 * Start simulating diagonal movement by alternating pan and tilt
 */
function startDiagonalSimulation(direction, panSpeed, tiltSpeed) {
  stopDiagonalSimulation();

  const vertical = direction.includes('up') ? 'up' : 'down';
  const horizontal = direction.includes('left') ? 'left' : 'right';

  let toggle = false;

  diagonalSimulation = setInterval(() => {
    const dir = toggle ? vertical : horizontal;
    const speed = toggle ? tiltSpeed : panSpeed;
    sendPTZCommand(`${dir}&${speed}&${speed}`);
    toggle = !toggle;
  }, 50); // Alternate every 50ms

  // Start immediately with first direction
  sendPTZCommand(`${vertical}&${tiltSpeed}&${tiltSpeed}`);

  return { success: true, simulated: true };
}

/**
 * Stop diagonal simulation
 */
function stopDiagonalSimulation() {
  if (diagonalSimulation) {
    clearInterval(diagonalSimulation);
    diagonalSimulation = null;
  }
}

/**
 * Stop all PTZ movement
 */
async function stop() {
  stopDiagonalSimulation();
  return sendPTZCommand('ptzstop');
}

/**
 * Zoom in
 * @param {number} speed - 1-7
 */
async function zoomIn(speed = 4) {
  speed = Math.max(1, Math.min(7, Math.round(speed)));
  return sendPTZCommand(`zoomin&${speed}`);
}

/**
 * Zoom out
 * @param {number} speed - 1-7
 */
async function zoomOut(speed = 4) {
  speed = Math.max(1, Math.min(7, Math.round(speed)));
  return sendPTZCommand(`zoomout&${speed}`);
}

/**
 * Stop zoom
 */
async function zoomStop() {
  return sendPTZCommand('zoomstop');
}

/**
 * Focus in (near)
 * @param {number} speed - 1-7
 */
async function focusIn(speed = 4) {
  speed = Math.max(1, Math.min(7, Math.round(speed)));
  return sendPTZCommand(`focusin&${speed}`);
}

/**
 * Focus out (far)
 * @param {number} speed - 1-7
 */
async function focusOut(speed = 4) {
  speed = Math.max(1, Math.min(7, Math.round(speed)));
  return sendPTZCommand(`focusout&${speed}`);
}

/**
 * Stop focus
 */
async function focusStop() {
  return sendPTZCommand('focusstop');
}

/**
 * Call a preset position
 * @param {number} preset - 1-254
 */
async function presetCall(preset) {
  preset = Math.max(1, Math.min(254, Math.round(preset)));
  return sendPTZCommand(`poscall&${preset}`);
}

/**
 * Save current position to a preset
 * @param {number} preset - 1-254
 */
async function presetSet(preset) {
  preset = Math.max(1, Math.min(254, Math.round(preset)));
  return sendPTZCommand(`posset&${preset}`);
}

/**
 * Go to home position
 */
async function home() {
  return sendPTZCommand('home');
}

module.exports = {
  sendPTZCommand,
  move,
  stop,
  zoomIn,
  zoomOut,
  zoomStop,
  focusIn,
  focusOut,
  focusStop,
  presetCall,
  presetSet,
  home
};
