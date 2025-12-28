// PTZ Controller Main Application

// Configuration defaults
const DEFAULT_CONFIG = {
  mediamtxPort: 8889,
  presetCount: 12,
  cameraIP: '',
  vidiuIP: ''
};

// State
let config = { ...DEFAULT_CONFIG };
let presets = {};
let joystick = null;
let isMoving = false;
let currentPreset = null;
let speedMultiplier = 0.5; // 0.1 to 1.0
let vidiuStreaming = false;
let pendingDestination = null;
let vidiuStatusInterval = null;

// DOM Elements
const elements = {
  videoFrame: document.getElementById('video-frame'),
  videoLoading: document.getElementById('video-loading'),
  connectionStatus: document.getElementById('connection-status'),
  joystickZone: document.getElementById('joystick-zone'),
  presetGrid: document.getElementById('preset-grid'),
  settingsModal: document.getElementById('settings-modal'),
  presetModal: document.getElementById('preset-modal'),
};

// Initialize application
document.addEventListener('DOMContentLoaded', init);

async function init() {
  loadConfig();
  loadPresets();
  setupVideo();
  setupJoystick();
  setupSpeedControl();
  setupZoomControls();
  setupFocusControls();
  setupExposureControls();
  setupWhiteBalanceControls();
  setupPresets();
  setupSettingsTabs();
  setupModals();
  setupDeviceDiscovery();
  setupVidiuControls();
  checkConnection();
}

// Setup speed control slider
function setupSpeedControl() {
  const speedSlider = document.getElementById('speed-slider');
  const speedValue = document.getElementById('speed-value');

  // Load saved speed
  const savedSpeed = localStorage.getItem('ptz-speed');
  if (savedSpeed) {
    speedMultiplier = parseInt(savedSpeed) / 100;
    speedSlider.value = savedSpeed;
    speedValue.textContent = savedSpeed + '%';
  }

  speedSlider.addEventListener('input', () => {
    const value = parseInt(speedSlider.value);
    speedMultiplier = value / 100;
    speedValue.textContent = value + '%';
    localStorage.setItem('ptz-speed', value);
  });
}

// Load configuration from localStorage
function loadConfig() {
  const saved = localStorage.getItem('ptz-config');
  if (saved) {
    config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  }
  document.getElementById('mediamtx-port-input').value = config.mediamtxPort;
  document.getElementById('preset-count').value = config.presetCount;
  document.getElementById('camera-ip-input').value = config.cameraIP || '';
  document.getElementById('vidiu-ip-input').value = config.vidiuIP || '';
}

// Save configuration to localStorage
function saveConfig() {
  config.mediamtxPort = parseInt(document.getElementById('mediamtx-port-input').value) || 8889;
  config.presetCount = parseInt(document.getElementById('preset-count').value) || 12;
  config.cameraIP = document.getElementById('camera-ip-input').value.trim();
  config.vidiuIP = document.getElementById('vidiu-ip-input').value.trim();
  localStorage.setItem('ptz-config', JSON.stringify(config));
  setupVideo();
  setupPresets();
}

// Load presets from localStorage
function loadPresets() {
  const saved = localStorage.getItem('ptz-presets');
  if (saved) {
    presets = JSON.parse(saved);
  }
}

// Save presets to localStorage
function savePresets() {
  localStorage.setItem('ptz-presets', JSON.stringify(presets));
}

// Setup video player
function setupVideo() {
  const host = window.location.hostname || 'localhost';
  const videoUrl = `http://${host}:${config.mediamtxPort}/camera?controls=false&muted=true&autoplay=true&playsInline=true`;
  elements.videoFrame.src = videoUrl;

  elements.videoFrame.onload = () => {
    elements.videoLoading.classList.add('hidden');
    elements.connectionStatus.classList.remove('bg-yellow-500');
    elements.connectionStatus.classList.add('connected');
  };

  elements.videoFrame.onerror = () => {
    elements.connectionStatus.classList.remove('bg-yellow-500', 'connected');
    elements.connectionStatus.classList.add('disconnected');
  };
}

// Check API connection
async function checkConnection() {
  try {
    const response = await fetch('/api/health');
    if (response.ok) {
      elements.connectionStatus.classList.remove('bg-yellow-500', 'disconnected');
      elements.connectionStatus.classList.add('connected');
    }
  } catch (e) {
    elements.connectionStatus.classList.remove('bg-yellow-500', 'connected');
    elements.connectionStatus.classList.add('disconnected');
  }
}

// Setup virtual joystick
function setupJoystick() {
  joystick = nipplejs.create({
    zone: elements.joystickZone,
    mode: 'static',
    position: { left: '50%', top: '50%' },
    color: '#3b82f6',
    size: 140,
    threshold: 0.1,
    fadeTime: 100,
    restJoystick: true,
  });

  joystick.on('move', (evt, data) => {
    handleJoystickMove(data);
  });

  joystick.on('end', () => {
    stopMovement();
  });
}

// Handle joystick movement
function handleJoystickMove(data) {
  const angle = data.angle.degree;
  const force = Math.min(data.force, 1);

  // Calculate speeds based on force AND speed multiplier (1-24 for pan, 1-20 for tilt)
  const panSpeed = Math.max(1, Math.round(force * 24 * speedMultiplier));
  const tiltSpeed = Math.max(1, Math.round(force * 20 * speedMultiplier));

  // Determine direction based on angle
  let direction;
  if (angle >= 337.5 || angle < 22.5) direction = 'right';
  else if (angle >= 22.5 && angle < 67.5) direction = 'upright';
  else if (angle >= 67.5 && angle < 112.5) direction = 'up';
  else if (angle >= 112.5 && angle < 157.5) direction = 'upleft';
  else if (angle >= 157.5 && angle < 202.5) direction = 'left';
  else if (angle >= 202.5 && angle < 247.5) direction = 'downleft';
  else if (angle >= 247.5 && angle < 292.5) direction = 'down';
  else direction = 'downright';

  // Throttle movement commands
  if (!isMoving) {
    isMoving = true;
    sendMove(direction, panSpeed, tiltSpeed);
    setTimeout(() => { isMoving = false; }, 50);
  }
}

// Send move command
async function sendMove(direction, panSpeed, tiltSpeed) {
  try {
    await fetch('/api/ptz/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, panSpeed, tiltSpeed })
    });
    vibrate(10);
  } catch (e) {
    console.error('Move failed:', e);
  }
}

// Stop all movement
async function stopMovement() {
  try {
    await fetch('/api/ptz/stop', { method: 'POST' });
  } catch (e) {
    console.error('Stop failed:', e);
  }
}

// Setup zoom controls
function setupZoomControls() {
  const zoomInBtn = document.getElementById('zoom-in-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');
  const zoomSlider = document.getElementById('zoom-slider');

  // Button press/release for continuous zoom
  setupContinuousButton(zoomInBtn, () => sendZoom('in'), () => sendZoom('stop'));
  setupContinuousButton(zoomOutBtn, () => sendZoom('out'), () => sendZoom('stop'));

  // Slider for zoom (future: could track absolute position)
  zoomSlider.addEventListener('input', () => {
    // For now, slider is decorative - real zoom uses buttons
  });
}

// Setup continuous press button
function setupContinuousButton(btn, onStart, onEnd) {
  let interval = null;

  const start = () => {
    onStart();
    vibrate(20);
    interval = setInterval(onStart, 100);
  };

  const end = () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    onEnd();
  };

  btn.addEventListener('mousedown', start);
  btn.addEventListener('mouseup', end);
  btn.addEventListener('mouseleave', end);
  btn.addEventListener('touchstart', (e) => { e.preventDefault(); start(); });
  btn.addEventListener('touchend', end);
  btn.addEventListener('touchcancel', end);
}

// Send zoom command
async function sendZoom(action, speed = 4) {
  try {
    await fetch('/api/ptz/zoom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, speed })
    });
  } catch (e) {
    console.error('Zoom failed:', e);
  }
}

// Setup focus controls
function setupFocusControls() {
  const focusAutoBtn = document.getElementById('focus-auto-btn');
  const focusManualBtn = document.getElementById('focus-manual-btn');
  const focusNearBtn = document.getElementById('focus-near-btn');
  const focusFarBtn = document.getElementById('focus-far-btn');
  const focusOnePushBtn = document.getElementById('focus-onepush-btn');

  focusAutoBtn.addEventListener('click', () => {
    sendViscaFocusMode('auto');
    focusAutoBtn.classList.add('bg-blue-600');
    focusAutoBtn.classList.remove('bg-gray-700');
    focusManualBtn.classList.remove('bg-blue-600');
    focusManualBtn.classList.add('bg-gray-700');
  });

  focusManualBtn.addEventListener('click', () => {
    sendViscaFocusMode('manual');
    focusManualBtn.classList.add('bg-blue-600');
    focusManualBtn.classList.remove('bg-gray-700');
    focusAutoBtn.classList.remove('bg-blue-600');
    focusAutoBtn.classList.add('bg-gray-700');
  });

  setupContinuousButton(focusNearBtn, () => sendFocus('in'), () => sendFocus('stop'));
  setupContinuousButton(focusFarBtn, () => sendFocus('out'), () => sendFocus('stop'));

  focusOnePushBtn.addEventListener('click', () => {
    sendViscaFocusOnePush();
    vibrate(30);
  });
}

async function sendFocus(action, speed = 4) {
  try {
    await fetch('/api/ptz/focus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, speed })
    });
  } catch (e) {
    console.error('Focus failed:', e);
  }
}

async function sendViscaFocusMode(mode) {
  try {
    await fetch('/api/visca/focus/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
  } catch (e) {
    console.error('Focus mode failed:', e);
  }
}

async function sendViscaFocusOnePush() {
  try {
    await fetch('/api/visca/focus/onepush', { method: 'POST' });
  } catch (e) {
    console.error('Focus one push failed:', e);
  }
}

// Setup exposure controls
function setupExposureControls() {
  const exposureMode = document.getElementById('exposure-mode');
  const backlightToggle = document.getElementById('backlight-toggle');

  exposureMode.addEventListener('change', () => {
    sendExposureMode(exposureMode.value);
  });

  backlightToggle.addEventListener('click', () => {
    backlightToggle.classList.toggle('active');
    const enabled = backlightToggle.classList.contains('active');
    sendBacklight(enabled);
    vibrate(20);
  });

  // Adjustment buttons
  document.querySelectorAll('.adjust-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const direction = btn.dataset.dir;
      sendExposureAdjust(action, direction);
      vibrate(15);
    });
  });
}

async function sendExposureMode(mode) {
  try {
    await fetch('/api/visca/exposure/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
  } catch (e) {
    console.error('Exposure mode failed:', e);
  }
}

async function sendExposureAdjust(action, direction) {
  try {
    await fetch(`/api/visca/exposure/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction })
    });
  } catch (e) {
    console.error('Exposure adjust failed:', e);
  }
}

async function sendBacklight(enabled) {
  try {
    await fetch('/api/visca/exposure/backlight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
  } catch (e) {
    console.error('Backlight failed:', e);
  }
}

// Setup white balance controls
function setupWhiteBalanceControls() {
  const wbMode = document.getElementById('wb-mode');

  wbMode.addEventListener('change', () => {
    sendWhiteBalanceMode(wbMode.value);
  });

  document.querySelectorAll('.wb-adjust-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      const direction = btn.dataset.dir;
      sendWhiteBalanceAdjust(color, direction);
      vibrate(15);
    });
  });
}

async function sendWhiteBalanceMode(mode) {
  try {
    await fetch('/api/visca/wb/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
  } catch (e) {
    console.error('WB mode failed:', e);
  }
}

async function sendWhiteBalanceAdjust(color, direction) {
  try {
    await fetch(`/api/visca/wb/${color}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction })
    });
  } catch (e) {
    console.error('WB adjust failed:', e);
  }
}

// Setup presets
function setupPresets() {
  elements.presetGrid.innerHTML = '';

  for (let i = 1; i <= config.presetCount; i++) {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.dataset.preset = i;

    const presetData = presets[i];
    if (presetData && presetData.name) {
      btn.textContent = presetData.name.substring(0, 2).toUpperCase();
      btn.title = presetData.name;
      btn.classList.add('has-name');
    } else {
      btn.textContent = i;
    }

    // Tap to call preset
    btn.addEventListener('click', () => {
      callPreset(i);
    });

    // Long press to edit
    let pressTimer;
    btn.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => {
        openPresetModal(i);
      }, 500);
    });
    btn.addEventListener('touchend', () => clearTimeout(pressTimer));
    btn.addEventListener('touchmove', () => clearTimeout(pressTimer));
    btn.addEventListener('mousedown', () => {
      pressTimer = setTimeout(() => {
        openPresetModal(i);
      }, 500);
    });
    btn.addEventListener('mouseup', () => clearTimeout(pressTimer));
    btn.addEventListener('mouseleave', () => clearTimeout(pressTimer));

    elements.presetGrid.appendChild(btn);
  }

  // Home button
  document.getElementById('home-btn').addEventListener('click', () => {
    sendHome();
    vibrate(30);
  });
}

async function callPreset(number) {
  try {
    await fetch('/api/ptz/preset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'call', number })
    });
    vibrate(30);
  } catch (e) {
    console.error('Preset call failed:', e);
  }
}

async function setPreset(number) {
  try {
    await fetch('/api/ptz/preset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set', number })
    });
    vibrate(50);
  } catch (e) {
    console.error('Preset set failed:', e);
  }
}

async function sendHome() {
  try {
    await fetch('/api/ptz/home', { method: 'POST' });
  } catch (e) {
    console.error('Home failed:', e);
  }
}

// Setup settings tabs
function setupSettingsTabs() {
  const tabs = document.querySelectorAll('.settings-tab');
  const panels = document.querySelectorAll('.settings-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetPanel = tab.dataset.tab;
      panels.forEach(panel => {
        panel.classList.add('hidden');
        if (panel.id === `${targetPanel}-panel`) {
          panel.classList.remove('hidden');
        }
      });
    });
  });
}

// Setup modals
function setupModals() {
  // Settings modal
  document.getElementById('settings-btn').addEventListener('click', () => {
    elements.settingsModal.classList.remove('hidden');
  });

  document.getElementById('close-settings').addEventListener('click', () => {
    elements.settingsModal.classList.add('hidden');
  });

  document.getElementById('save-settings').addEventListener('click', () => {
    saveConfig();
    elements.settingsModal.classList.add('hidden');
    vibrate(30);
  });

  // Preset modal - main view
  const presetMainView = document.getElementById('preset-main-view');
  const presetConfirmView = document.getElementById('preset-confirm-view');

  document.getElementById('close-preset-modal').addEventListener('click', () => {
    elements.presetModal.classList.add('hidden');
    presetMainView.classList.remove('hidden');
    presetConfirmView.classList.add('hidden');
  });

  // Save label only (no position change)
  document.getElementById('save-preset-name').addEventListener('click', () => {
    if (currentPreset) {
      const name = document.getElementById('preset-name-input').value.trim();
      if (!presets[currentPreset]) presets[currentPreset] = {};
      presets[currentPreset].name = name;
      savePresets();
      setupPresets();
      elements.presetModal.classList.add('hidden');
      vibrate(20);
    }
  });

  // Show confirmation for position save
  document.getElementById('save-preset-position').addEventListener('click', () => {
    document.getElementById('confirm-preset-number').textContent = currentPreset;
    presetMainView.classList.add('hidden');
    presetConfirmView.classList.remove('hidden');
  });

  // Cancel position save
  document.getElementById('cancel-save-position').addEventListener('click', () => {
    presetMainView.classList.remove('hidden');
    presetConfirmView.classList.add('hidden');
  });

  // Confirm position save
  document.getElementById('confirm-save-position').addEventListener('click', () => {
    if (currentPreset) {
      setPreset(currentPreset);
      const name = document.getElementById('preset-name-input').value.trim();
      if (!presets[currentPreset]) presets[currentPreset] = {};
      if (name) presets[currentPreset].name = name;
      savePresets();
      setupPresets();
      elements.presetModal.classList.add('hidden');
      presetMainView.classList.remove('hidden');
      presetConfirmView.classList.add('hidden');
      vibrate(50);
    }
  });

  document.getElementById('call-preset').addEventListener('click', () => {
    if (currentPreset) {
      callPreset(currentPreset);
      elements.presetModal.classList.add('hidden');
    }
  });

  // Click outside to close
  elements.settingsModal.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) {
      elements.settingsModal.classList.add('hidden');
    }
  });

  elements.presetModal.addEventListener('click', (e) => {
    if (e.target === elements.presetModal) {
      elements.presetModal.classList.add('hidden');
      presetMainView.classList.remove('hidden');
      presetConfirmView.classList.add('hidden');
    }
  });

  // Destination change confirmation modal
  const destModal = document.getElementById('destination-modal');
  document.getElementById('cancel-destination').addEventListener('click', () => {
    destModal.classList.add('hidden');
    // Reset dropdown to previous value
    loadVidiuDestinations();
  });

  document.getElementById('confirm-destination').addEventListener('click', async () => {
    const newDest = pendingDestination;
    if (newDest) {
      await setVidiuDestination(newDest);
      pendingDestination = null;
    }
    destModal.classList.add('hidden');
  });

  destModal.addEventListener('click', (e) => {
    if (e.target === destModal) {
      destModal.classList.add('hidden');
      loadVidiuDestinations();
    }
  });
}

function openPresetModal(number) {
  currentPreset = number;
  document.getElementById('preset-number').textContent = number;
  document.getElementById('preset-name-input').value = presets[number]?.name || '';
  elements.presetModal.classList.remove('hidden');
  vibrate(30);
}

// Haptic feedback
function vibrate(duration) {
  if (navigator.vibrate) {
    navigator.vibrate(duration);
  }
}

// Setup device discovery
function setupDeviceDiscovery() {
  const scanBtn = document.getElementById('scan-network-btn');
  const scanStatus = document.getElementById('scan-status');
  const scanProgress = document.getElementById('scan-progress');
  const scanProgressBar = document.getElementById('scan-progress-bar');
  const discoveredDevices = document.getElementById('discovered-devices');

  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';
    scanStatus.classList.remove('hidden');
    scanProgress.classList.remove('hidden');
    scanProgressBar.style.width = '0%';
    discoveredDevices.innerHTML = '';

    try {
      const response = await fetch('/api/devices/scan');
      const data = await response.json();

      scanProgressBar.style.width = '100%';

      if (data.devices && data.devices.length > 0) {
        data.devices.forEach(device => {
          const deviceEl = document.createElement('div');
          deviceEl.className = 'flex items-center justify-between p-2 bg-gray-700 rounded text-sm';

          const icon = device.type === 'ptz-camera' ? '📷' : '📡';
          const typeName = device.type === 'ptz-camera' ? 'PTZ Camera' : 'Vidiu';

          deviceEl.innerHTML = `
            <div>
              <span class="mr-2">${icon}</span>
              <span class="font-medium">${device.name || typeName}</span>
              <span class="text-gray-400 ml-2">${device.ip}</span>
            </div>
            <button class="use-device-btn px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
                    data-ip="${device.ip}" data-type="${device.type}">
              Use
            </button>
          `;
          discoveredDevices.appendChild(deviceEl);
        });

        // Add click handlers for "Use" buttons
        discoveredDevices.querySelectorAll('.use-device-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const ip = btn.dataset.ip;
            const type = btn.dataset.type;
            if (type === 'ptz-camera') {
              document.getElementById('camera-ip-input').value = ip;
              updateDeviceStatus('camera', true);
            } else if (type === 'vidiu') {
              document.getElementById('vidiu-ip-input').value = ip;
              updateDeviceStatus('vidiu', true);
            }
            vibrate(20);
          });
        });
      } else {
        discoveredDevices.innerHTML = '<p class="text-xs text-gray-500">No devices found</p>';
      }

      scanStatus.textContent = `Found ${data.devices?.length || 0} device(s)`;
    } catch (error) {
      console.error('Scan failed:', error);
      scanStatus.textContent = 'Scan failed';
      discoveredDevices.innerHTML = '<p class="text-xs text-red-400">Error scanning network</p>';
    }

    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan Network';
  });
}

// Update device status indicator
function updateDeviceStatus(device, connected) {
  const statusEl = document.getElementById(`${device}-status`);
  if (statusEl) {
    if (connected) {
      statusEl.textContent = 'OK';
      statusEl.classList.remove('bg-gray-700', 'bg-red-600');
      statusEl.classList.add('bg-green-600');
    } else {
      statusEl.textContent = '--';
      statusEl.classList.remove('bg-green-600', 'bg-red-600');
      statusEl.classList.add('bg-gray-700');
    }
  }
}

// ============================================
// Vidiu Controls
// ============================================

function setupVidiuControls() {
  const streamBtn = document.getElementById('vidiu-stream-btn');
  const destSelect = document.getElementById('vidiu-destination');

  // Stream button
  streamBtn.addEventListener('click', async () => {
    streamBtn.disabled = true;
    if (vidiuStreaming) {
      await stopVidiuStream();
    } else {
      await startVidiuStream();
    }
    streamBtn.disabled = false;
  });

  // Destination change with confirmation
  destSelect.addEventListener('change', () => {
    const selectedOption = destSelect.options[destSelect.selectedIndex];
    if (selectedOption.value) {
      pendingDestination = selectedOption.value;
      document.getElementById('new-destination-name').textContent = selectedOption.text;
      document.getElementById('destination-modal').classList.remove('hidden');
    }
  });

  // Initial load
  loadVidiuStatus();
  loadVidiuDestinations();

  // Poll status every 5 seconds
  vidiuStatusInterval = setInterval(loadVidiuStatus, 5000);
}

async function loadVidiuStatus() {
  const connectionStatus = document.getElementById('vidiu-connection-status');
  const bitrateEl = document.getElementById('vidiu-bitrate');
  const statusText = document.getElementById('vidiu-status-text');
  const streamBtn = document.getElementById('vidiu-stream-btn');

  try {
    const response = await fetch('/api/vidiu/streaming');
    const data = await response.json();

    if (data.success) {
      connectionStatus.classList.remove('bg-gray-500', 'bg-red-500');
      connectionStatus.classList.add('bg-green-500');

      const state = data.data?.state || 'Unknown';

      // Update UI based on state machine:
      // Invalid → Waiting → Ready → Starting → Live → Stopping → Ready/Complete
      switch (state) {
        case 'Live':
          vidiuStreaming = true;
          streamBtn.textContent = 'Stop';
          streamBtn.classList.remove('bg-green-600', 'hover:bg-green-700', 'bg-yellow-600', 'hover:bg-yellow-700');
          streamBtn.classList.add('bg-red-600', 'hover:bg-red-700');
          streamBtn.disabled = false;
          statusText.textContent = data.data?.broadcast ? `LIVE: ${data.data.broadcast}` : 'LIVE';
          statusText.classList.add('text-red-400');
          statusText.classList.remove('text-yellow-400', 'text-gray-500');
          break;

        case 'Starting':
          vidiuStreaming = false;
          streamBtn.textContent = 'Starting...';
          streamBtn.classList.remove('bg-green-600', 'hover:bg-green-700', 'bg-red-600', 'hover:bg-red-700');
          streamBtn.classList.add('bg-yellow-600', 'hover:bg-yellow-700');
          streamBtn.disabled = true;
          statusText.textContent = 'Starting broadcast...';
          statusText.classList.add('text-yellow-400');
          statusText.classList.remove('text-red-400', 'text-gray-500');
          break;

        case 'Stopping':
          vidiuStreaming = true;
          streamBtn.textContent = 'Stopping...';
          streamBtn.classList.remove('bg-green-600', 'hover:bg-green-700', 'bg-red-600', 'hover:bg-red-700');
          streamBtn.classList.add('bg-yellow-600', 'hover:bg-yellow-700');
          streamBtn.disabled = true;
          statusText.textContent = 'Stopping broadcast...';
          statusText.classList.add('text-yellow-400');
          statusText.classList.remove('text-red-400', 'text-gray-500');
          break;

        case 'Ready':
          vidiuStreaming = false;
          streamBtn.textContent = 'Go Live';
          streamBtn.classList.remove('bg-red-600', 'hover:bg-red-700', 'bg-yellow-600', 'hover:bg-yellow-700');
          streamBtn.classList.add('bg-green-600', 'hover:bg-green-700');
          streamBtn.disabled = false;
          statusText.textContent = data.data?.broadcast ? `Ready: ${data.data.broadcast}` : 'Ready';
          statusText.classList.remove('text-red-400', 'text-yellow-400');
          statusText.classList.add('text-gray-500');
          break;

        case 'Invalid':
        case 'Waiting':
          vidiuStreaming = false;
          streamBtn.textContent = 'Go Live';
          streamBtn.classList.remove('bg-red-600', 'hover:bg-red-700', 'bg-yellow-600', 'hover:bg-yellow-700');
          streamBtn.classList.add('bg-green-600', 'hover:bg-green-700');
          streamBtn.disabled = true;
          statusText.textContent = state === 'Invalid' ? 'Not configured' : 'Waiting...';
          statusText.classList.remove('text-red-400', 'text-yellow-400');
          statusText.classList.add('text-gray-500');
          break;

        default:
          vidiuStreaming = false;
          streamBtn.textContent = 'Go Live';
          streamBtn.disabled = false;
          statusText.textContent = state;
          statusText.classList.remove('text-red-400', 'text-yellow-400');
      }

      // Bitrate display
      if (data.data?.bitrate) {
        const kbps = data.data.bitrate;
        if (kbps > 1000) {
          bitrateEl.textContent = `${(kbps / 1000).toFixed(1)} Mbps`;
        } else {
          bitrateEl.textContent = `${kbps} kbps`;
        }
      } else {
        bitrateEl.textContent = '--';
      }

      // Uptime display
      if (data.data?.uptime && state === 'Live') {
        bitrateEl.textContent += ` | ${data.data.uptime}`;
      }

    } else {
      connectionStatus.classList.remove('bg-green-500', 'bg-gray-500');
      connectionStatus.classList.add('bg-red-500');
      statusText.textContent = 'Not connected';
      bitrateEl.textContent = '--';
      streamBtn.disabled = true;
    }
  } catch (error) {
    connectionStatus.classList.remove('bg-green-500', 'bg-gray-500');
    connectionStatus.classList.add('bg-red-500');
    statusText.textContent = 'Connection error';
    streamBtn.disabled = true;
  }
}

async function loadVidiuDestinations() {
  const destSelect = document.getElementById('vidiu-destination');

  try {
    const response = await fetch('/api/vidiu/destinations');
    const data = await response.json();

    destSelect.innerHTML = '<option value="">-- Select --</option>';

    if (data.success && data.data) {
      const destinations = Array.isArray(data.data) ? data.data : (data.data.destinations || data.data.profiles || []);
      destinations.forEach(dest => {
        const option = document.createElement('option');
        option.value = dest.id || dest.name;
        option.textContent = dest.name || dest.title || dest.id;
        if (dest.active || dest.selected) {
          option.selected = true;
        }
        destSelect.appendChild(option);
      });
    }
  } catch (error) {
    console.error('Failed to load destinations:', error);
  }
}

async function startVidiuStream() {
  const statusText = document.getElementById('vidiu-status-text');
  const streamBtn = document.getElementById('vidiu-stream-btn');

  statusText.textContent = 'Starting...';
  streamBtn.disabled = true;

  try {
    const response = await fetch('/api/vidiu/streaming/start', { method: 'POST' });
    const data = await response.json();

    if (data.success) {
      vibrate(50);
      // Poll more frequently during state transitions
      startFastPolling();
    } else {
      statusText.textContent = 'Failed to start';
      streamBtn.disabled = false;
    }
  } catch (error) {
    statusText.textContent = 'Start failed';
    streamBtn.disabled = false;
    console.error('Start stream failed:', error);
  }
}

async function stopVidiuStream() {
  const statusText = document.getElementById('vidiu-status-text');
  const streamBtn = document.getElementById('vidiu-stream-btn');

  statusText.textContent = 'Stopping...';
  streamBtn.disabled = true;

  try {
    const response = await fetch('/api/vidiu/streaming/stop', { method: 'POST' });
    const data = await response.json();

    if (data.success) {
      vibrate(30);
      // Poll more frequently during state transitions
      startFastPolling();
    } else {
      statusText.textContent = 'Failed to stop';
      streamBtn.disabled = false;
    }
  } catch (error) {
    statusText.textContent = 'Stop failed';
    streamBtn.disabled = false;
    console.error('Stop stream failed:', error);
  }
}

// Fast polling during state transitions
let fastPollInterval = null;
let fastPollCount = 0;

function startFastPolling() {
  // Clear any existing fast poll
  if (fastPollInterval) {
    clearInterval(fastPollInterval);
  }
  fastPollCount = 0;

  // Poll every 500ms for up to 30 seconds (60 polls)
  fastPollInterval = setInterval(async () => {
    fastPollCount++;
    await loadVidiuStatus();

    // Stop fast polling after 60 polls or when state stabilizes
    const statusText = document.getElementById('vidiu-status-text');
    const stableStates = ['LIVE', 'Ready', 'Not configured'];
    const isStable = stableStates.some(s => statusText.textContent.includes(s));

    if (fastPollCount >= 60 || isStable) {
      clearInterval(fastPollInterval);
      fastPollInterval = null;
    }
  }, 500);
}

async function setVidiuDestination(destId) {
  try {
    const response = await fetch('/api/vidiu/destination', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: destId })
    });
    const data = await response.json();

    if (data.success) {
      vibrate(30);
    }
  } catch (error) {
    console.error('Set destination failed:', error);
  }
}
