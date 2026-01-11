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
let currentPresetIcon = ''; // Currently selected icon in modal
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
  await loadConfig();
  await loadPresets();
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

// Load configuration from server and localStorage
async function loadConfig() {
  // Load UI-only settings from localStorage
  const saved = localStorage.getItem('ptz-config');
  if (saved) {
    const localConfig = JSON.parse(saved);
    config.presetCount = localConfig.presetCount || DEFAULT_CONFIG.presetCount;
  }

  // Load server settings
  try {
    const response = await fetch('/api/settings');
    const data = await response.json();
    if (data.success) {
      config.cameraIP = data.data.camera.ip;
      config.cameraUsername = data.data.camera.username;
      config.cameraPassword = data.data.camera.password;
      config.vidiuIP = data.data.vidiu.ip;
      config.mediamtxPort = data.data.mediamtx.webrtcPort;
    }
  } catch (error) {
    console.error('Failed to load settings from server:', error);
  }

  // Update UI
  document.getElementById('mediamtx-port-input').value = config.mediamtxPort;
  document.getElementById('preset-count').value = config.presetCount;
  document.getElementById('camera-ip-input').value = config.cameraIP || '';
  document.getElementById('vidiu-ip-input').value = config.vidiuIP || '';
}

// Save configuration to server and localStorage
async function saveConfig() {
  const saveBtn = document.querySelector('#settings-modal button:last-child');
  const originalText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  config.mediamtxPort = parseInt(document.getElementById('mediamtx-port-input').value) || 8889;
  config.presetCount = parseInt(document.getElementById('preset-count').value) || 12;
  config.cameraIP = document.getElementById('camera-ip-input').value.trim();
  config.vidiuIP = document.getElementById('vidiu-ip-input').value.trim();

  // Save UI-only settings to localStorage
  localStorage.setItem('ptz-config', JSON.stringify({
    presetCount: config.presetCount
  }));

  // Save server settings
  try {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        camera: {
          ip: config.cameraIP
        },
        vidiu: {
          ip: config.vidiuIP
        },
        mediamtx: {
          webrtcPort: config.mediamtxPort
        }
      })
    });
    const data = await response.json();
    if (data.success) {
      console.log('Settings saved to server');
      vibrate(30);
    } else {
      console.error('Failed to save settings:', data.error);
      alert('Failed to save settings: ' + data.error);
    }
  } catch (error) {
    console.error('Failed to save settings:', error);
    alert('Failed to save settings: ' + error.message);
  }

  saveBtn.disabled = false;
  saveBtn.textContent = originalText;

  setupVideo();
  setupPresets();
}

// Load presets from server
async function loadPresets() {
  try {
    const response = await fetch('/api/presets');
    const data = await response.json();
    if (data.success) {
      presets = data.data || {};
    }
  } catch (error) {
    console.error('Failed to load presets from server:', error);
    // Fallback to localStorage
    const saved = localStorage.getItem('ptz-presets');
    if (saved) {
      presets = JSON.parse(saved);
    }
  }
}

// Save presets to server
async function savePresets() {
  try {
    const response = await fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(presets)
    });
    const data = await response.json();
    if (!data.success) {
      console.error('Failed to save presets:', data.error);
    }
  } catch (error) {
    console.error('Failed to save presets to server:', error);
  }
  // Also save to localStorage as backup
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
// Joystick state
let joystickActive = false;
let lastMoveTime = 0;
let stopTimeout = null;

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

  joystick.on('start', () => {
    joystickActive = true;
    // Clear any pending stop
    if (stopTimeout) {
      clearTimeout(stopTimeout);
      stopTimeout = null;
    }
  });

  joystick.on('move', (evt, data) => {
    if (joystickActive) {
      handleJoystickMove(data);
    }
  });

  joystick.on('end', () => {
    joystickActive = false;
    isMoving = false;
    // Send stop immediately and multiple times for reliability
    stopMovement();
    // Send additional stops with slight delays to ensure camera receives it
    setTimeout(() => stopMovement(), 50);
    setTimeout(() => stopMovement(), 100);
  });

  // Failsafe: if no movement for 200ms while not active, send stop
  setInterval(() => {
    if (!joystickActive && Date.now() - lastMoveTime > 200 && lastMoveTime > 0) {
      stopMovement();
      lastMoveTime = 0;
    }
  }, 100);
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

  // Throttle movement commands - send every 50ms max
  const now = Date.now();
  if (now - lastMoveTime >= 50) {
    lastMoveTime = now;
    sendMove(direction, panSpeed, tiltSpeed);
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
    if (presetData && (presetData.icon || presetData.name)) {
      // Show icon if set, otherwise show full name with auto-sizing
      if (presetData.icon) {
        btn.textContent = presetData.icon;
        btn.classList.add('has-icon');
      } else if (presetData.name) {
        // Show full name, auto-size based on length
        const name = presetData.name;
        btn.textContent = name;

        // Apply size class based on text length
        if (name.length <= 3) {
          btn.classList.add('text-lg');
        } else if (name.length <= 6) {
          btn.classList.add('text-md');
        } else {
          btn.classList.add('text-sm');
        }
      }
      btn.title = presetData.name || `Preset ${i}`;
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
// Helper functions to open/close modals with body scroll lock
function openModal(modal) {
  document.body.classList.add('modal-open');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeModal(modal) {
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  // Only remove modal-open if no other modals are visible
  const anyModalOpen = document.querySelector('#settings-modal.flex, #preset-modal.flex, #destination-modal:not(.hidden)');
  if (!anyModalOpen) {
    document.body.classList.remove('modal-open');
  }
}

function setupModals() {
  // Settings modal
  document.getElementById('settings-btn').addEventListener('click', () => {
    openModal(elements.settingsModal);
  });

  document.getElementById('close-settings').addEventListener('click', () => {
    closeModal(elements.settingsModal);
  });

  // Close settings modal when clicking backdrop
  elements.settingsModal.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) {
      closeModal(elements.settingsModal);
    }
  });

  document.getElementById('save-settings').addEventListener('click', () => {
    saveConfig();
    closeModal(elements.settingsModal);
    vibrate(30);
  });

  // Preset modal - main view
  const presetMainView = document.getElementById('preset-main-view');
  const presetConfirmView = document.getElementById('preset-confirm-view');

  document.getElementById('close-preset-modal').addEventListener('click', () => {
    closeModal(elements.presetModal);
    presetMainView.classList.remove('hidden');
    presetConfirmView.classList.add('hidden');
  });

  // Close preset modal when clicking backdrop
  elements.presetModal.addEventListener('click', (e) => {
    if (e.target === elements.presetModal) {
      closeModal(elements.presetModal);
      presetMainView.classList.remove('hidden');
      presetConfirmView.classList.add('hidden');
    }
  });

  // Icon selection handlers
  document.querySelectorAll('.preset-icon-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove selection from all icons
      document.querySelectorAll('.preset-icon-btn').forEach(b => {
        b.classList.remove('bg-blue-600', 'ring-2', 'ring-blue-400');
      });
      // Select clicked icon
      btn.classList.add('bg-blue-600', 'ring-2', 'ring-blue-400');
      currentPresetIcon = btn.dataset.icon;
      // Update preview
      updatePresetPreview();
      vibrate(10);
    });
  });

  // Update preview when label changes
  document.getElementById('preset-name-input').addEventListener('input', () => {
    updatePresetPreview();
  });

  // Save label and icon (no position change)
  document.getElementById('save-preset-name').addEventListener('click', () => {
    if (currentPreset) {
      const name = document.getElementById('preset-name-input').value.trim();
      if (!presets[currentPreset]) presets[currentPreset] = {};
      presets[currentPreset].name = name;
      presets[currentPreset].icon = currentPresetIcon;
      savePresets();
      setupPresets();
      closeModal(elements.presetModal);
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
      presets[currentPreset].icon = currentPresetIcon;
      savePresets();
      setupPresets();
      closeModal(elements.presetModal);
      presetMainView.classList.remove('hidden');
      presetConfirmView.classList.add('hidden');
      vibrate(50);
    }
  });

  document.getElementById('call-preset').addEventListener('click', () => {
    if (currentPreset) {
      callPreset(currentPreset);
      closeModal(elements.presetModal);
    }
  });

  // Broadcast change confirmation modal
  const destModal = document.getElementById('destination-modal');
  document.getElementById('cancel-destination').addEventListener('click', () => {
    destModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    // Reset dropdown to previous value
    loadVidiuBroadcasts();
  });

  document.getElementById('confirm-destination').addEventListener('click', async () => {
    const newBroadcast = pendingDestination;
    if (newBroadcast) {
      await selectVidiuBroadcast(newBroadcast);
      pendingDestination = null;
    }
    destModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
  });

  destModal.addEventListener('click', (e) => {
    if (e.target === destModal) {
      destModal.classList.add('hidden');
      document.body.classList.remove('modal-open');
      loadVidiuBroadcasts();
    }
  });
}

function openPresetModal(number) {
  currentPreset = number;
  document.getElementById('preset-number').textContent = number;
  document.getElementById('preset-name-input').value = presets[number]?.name || '';

  // Load current icon
  currentPresetIcon = presets[number]?.icon || '';

  // Update icon selection UI
  document.querySelectorAll('.preset-icon-btn').forEach(btn => {
    btn.classList.remove('bg-blue-600', 'ring-2', 'ring-blue-400');
    if (btn.dataset.icon === currentPresetIcon) {
      btn.classList.add('bg-blue-600', 'ring-2', 'ring-blue-400');
    }
  });

  // Update preview
  updatePresetPreview();

  openModal(elements.presetModal);
  vibrate(30);
}

function updatePresetPreview() {
  const previewIcon = document.getElementById('preset-preview-icon');
  const previewLabel = document.getElementById('preset-preview-label');
  const nameInput = document.getElementById('preset-name-input');

  // Update icon preview
  previewIcon.textContent = currentPresetIcon || '—';

  // Update label preview
  const name = nameInput.value.trim();
  if (name) {
    previewLabel.textContent = name;
    previewLabel.classList.remove('text-gray-500');
    previewLabel.classList.add('text-gray-300');
  } else {
    previewLabel.textContent = 'No label';
    previewLabel.classList.remove('text-gray-300');
    previewLabel.classList.add('text-gray-500');
  }
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
  const previewBtn = document.getElementById('vidiu-preview-btn');
  const endPreviewBtn = document.getElementById('vidiu-endpreview-btn');
  const completeBtn = document.getElementById('vidiu-complete-btn');
  const broadcastSelect = document.getElementById('vidiu-broadcast');
  const refreshBtn = document.getElementById('vidiu-refresh-btn');

  // Setup Vidiu tabs
  setupVidiuTabs();

  // Stream button (Go Live / Stop)
  streamBtn.addEventListener('click', async () => {
    streamBtn.disabled = true;
    if (vidiuStreaming) {
      await stopVidiuStream();
    } else {
      await startVidiuStream();
    }
    streamBtn.disabled = false;
  });

  // Preview button
  previewBtn.addEventListener('click', async () => {
    previewBtn.disabled = true;
    await startVidiuPreview();
    previewBtn.disabled = false;
  });

  // End Preview button
  endPreviewBtn.addEventListener('click', async () => {
    endPreviewBtn.disabled = true;
    await endVidiuPreview();
    endPreviewBtn.disabled = false;
  });

  // Complete broadcast button
  completeBtn.addEventListener('click', async () => {
    completeBtn.disabled = true;
    await completeVidiuBroadcast();
    completeBtn.disabled = false;
  });

  // Broadcast change with confirmation
  broadcastSelect.addEventListener('change', () => {
    const selectedOption = broadcastSelect.options[broadcastSelect.selectedIndex];
    if (selectedOption.value) {
      pendingDestination = selectedOption.value;
      document.getElementById('new-destination-name').textContent = selectedOption.text;
      document.getElementById('destination-modal').classList.remove('hidden');
    }
  });

  // Refresh broadcasts button
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('animate-spin');
    await refreshVidiuBroadcasts();
    refreshBtn.classList.remove('animate-spin');
    refreshBtn.disabled = false;
  });

  // Setup encoder settings
  setupVidiuEncoderSettings();

  // Setup mode settings
  setupVidiuModeSettings();

  // Setup advanced actions
  setupVidiuAdvanced();

  // Initial load
  loadVidiuStatus();
  loadVidiuBroadcasts();

  // Poll status every 5 seconds
  vidiuStatusInterval = setInterval(loadVidiuStatus, 5000);
}

function setupVidiuTabs() {
  const tabs = document.querySelectorAll('.vidiu-tab');
  const panels = document.querySelectorAll('.vidiu-panel');

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

function setupVidiuEncoderSettings() {
  const saveBtn = document.getElementById('vidiu-save-encoder');

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Applying...';

    try {
      // Video encoder settings
      const videoSettings = {
        resolution: document.getElementById('vidiu-resolution').value,
        bitrate_setting: parseInt(document.getElementById('vidiu-video-bitrate').value),
        codec: document.getElementById('vidiu-codec').value
      };

      await fetch('/api/vidiu/settings/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(videoSettings)
      });

      // Audio encoder settings
      const audioSettings = {
        bitrate_setting: parseInt(document.getElementById('vidiu-audio-bitrate').value),
        stream_volume: parseInt(document.getElementById('vidiu-audio-volume').value),
        stream_mute: document.getElementById('vidiu-audio-mute').checked
      };

      await fetch('/api/vidiu/settings/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audioSettings)
      });

      vibrate(30);
    } catch (error) {
      console.error('Failed to save encoder settings:', error);
    }

    saveBtn.disabled = false;
    saveBtn.textContent = 'Apply Encoder Settings';
  });
}

function setupVidiuModeSettings() {
  const modeSelect = document.getElementById('vidiu-mode-select');
  const youtubeSettings = document.getElementById('youtube-settings');
  const rtmpSettings = document.getElementById('rtmp-settings');
  const saveBtn = document.getElementById('vidiu-save-mode');

  // Toggle settings panels based on mode
  modeSelect.addEventListener('change', () => {
    const mode = modeSelect.value;
    youtubeSettings.classList.toggle('hidden', mode !== 'YouTubeLive');
    rtmpSettings.classList.toggle('hidden', mode !== 'RTMP');
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Applying...';

    try {
      const mode = modeSelect.value;

      // Set the streaming mode/destination
      await fetch('/api/vidiu/destination', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mode })
      });

      // Apply mode-specific settings
      if (mode === 'YouTubeLive') {
        const ytSettings = {
          adaptive_bitrate: document.getElementById('vidiu-yt-adaptive').checked,
          auto_reconnect: document.getElementById('vidiu-yt-reconnect').checked
        };
        await fetch('/api/vidiu/settings/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ytSettings)
        });
      } else if (mode === 'RTMP') {
        const rtmpSettingsData = {
          url: document.getElementById('vidiu-rtmp-url').value,
          stream_key: document.getElementById('vidiu-rtmp-key').value
        };
        await fetch('/api/vidiu/settings/rtmp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rtmpSettingsData)
        });
      }

      vibrate(30);
      loadVidiuStatus(); // Refresh status to show new mode
    } catch (error) {
      console.error('Failed to save mode settings:', error);
    }

    saveBtn.disabled = false;
    saveBtn.textContent = 'Apply Mode Settings';
  });
}

function setupVidiuAdvanced() {
  const haltBtn = document.getElementById('vidiu-halt-btn');
  const reconnectBtn = document.getElementById('vidiu-reconnect-btn');

  haltBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to halt the stream? This will immediately stop streaming.')) {
      return;
    }
    haltBtn.disabled = true;
    try {
      await fetch('/api/vidiu/streaming/stop', { method: 'POST' });
      vibrate(50);
      loadVidiuStatus();
    } catch (error) {
      console.error('Halt failed:', error);
    }
    haltBtn.disabled = false;
  });

  reconnectBtn.addEventListener('click', async () => {
    reconnectBtn.disabled = true;
    reconnectBtn.textContent = 'Reconnecting...';
    try {
      // Trigger a reconnect by stopping and starting
      await fetch('/api/vidiu/streaming/stop', { method: 'POST' });
      await new Promise(resolve => setTimeout(resolve, 2000));
      await fetch('/api/vidiu/streaming/start', { method: 'POST' });
      vibrate(30);
      startFastPolling();
    } catch (error) {
      console.error('Reconnect failed:', error);
    }
    reconnectBtn.textContent = 'Reconnect';
    reconnectBtn.disabled = false;
  });
}

async function loadVidiuStatus() {
  const connectionStatus = document.getElementById('vidiu-connection-status');
  const bitrateEl = document.getElementById('vidiu-bitrate');
  const uptimeEl = document.getElementById('vidiu-uptime');
  const statusText = document.getElementById('vidiu-status-text');
  const streamBtn = document.getElementById('vidiu-stream-btn');
  const previewBtn = document.getElementById('vidiu-preview-btn');
  const endPreviewBtn = document.getElementById('vidiu-endpreview-btn');
  const completeBtn = document.getElementById('vidiu-complete-btn');
  // Advanced panel elements
  const currentModeEl = document.getElementById('vidiu-current-mode');
  const accountNameEl = document.getElementById('vidiu-account-name');
  const stateEl = document.getElementById('vidiu-state');

  try {
    const response = await fetch('/api/vidiu/streaming');
    const data = await response.json();

    if (data.success) {
      connectionStatus.classList.remove('bg-gray-500', 'bg-red-500');
      connectionStatus.classList.add('bg-green-500');

      const state = data.data?.state || 'Unknown';

      // Update advanced panel info
      if (stateEl) stateEl.textContent = state;

      // Update UI based on state machine:
      // Invalid → Waiting → Ready → Starting → Previewing → Live → Stopping → Ready/Complete
      switch (state) {
        case 'Live':
          vidiuStreaming = true;
          streamBtn.textContent = 'Stop';
          streamBtn.classList.remove('bg-green-600', 'hover:bg-green-700', 'bg-yellow-600', 'hover:bg-yellow-700');
          streamBtn.classList.add('bg-red-600', 'hover:bg-red-700');
          streamBtn.disabled = false;
          previewBtn.classList.add('hidden');
          endPreviewBtn.classList.add('hidden');
          completeBtn.classList.remove('hidden');
          completeBtn.disabled = false;
          statusText.textContent = data.data?.broadcast ? `LIVE: ${data.data.broadcast}` : 'LIVE';
          statusText.classList.add('text-red-400');
          statusText.classList.remove('text-yellow-400', 'text-gray-500');
          break;

        case 'Previewing':
        case 'Preview':
          vidiuStreaming = false;
          streamBtn.textContent = 'Go Live';
          streamBtn.classList.remove('bg-red-600', 'hover:bg-red-700', 'bg-yellow-600', 'hover:bg-yellow-700');
          streamBtn.classList.add('bg-green-600', 'hover:bg-green-700');
          streamBtn.disabled = false;
          previewBtn.classList.add('hidden');
          endPreviewBtn.classList.remove('hidden');
          endPreviewBtn.disabled = false;
          completeBtn.classList.add('hidden');
          statusText.textContent = data.data?.broadcast ? `Preview: ${data.data.broadcast}` : 'Preview Active';
          statusText.classList.add('text-yellow-400');
          statusText.classList.remove('text-red-400', 'text-gray-500');
          break;

        case 'Starting':
          vidiuStreaming = false;
          streamBtn.textContent = 'Starting...';
          streamBtn.classList.remove('bg-green-600', 'hover:bg-green-700', 'bg-red-600', 'hover:bg-red-700');
          streamBtn.classList.add('bg-yellow-600', 'hover:bg-yellow-700');
          streamBtn.disabled = true;
          previewBtn.disabled = true;
          endPreviewBtn.classList.add('hidden');
          completeBtn.classList.add('hidden');
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
          previewBtn.disabled = true;
          endPreviewBtn.classList.add('hidden');
          completeBtn.classList.add('hidden');
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
          previewBtn.classList.remove('hidden');
          previewBtn.disabled = false;
          endPreviewBtn.classList.add('hidden');
          completeBtn.classList.add('hidden');
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
          previewBtn.disabled = true;
          endPreviewBtn.classList.add('hidden');
          completeBtn.classList.add('hidden');
          statusText.textContent = state === 'Invalid' ? 'Not configured' : 'Waiting...';
          statusText.classList.remove('text-red-400', 'text-yellow-400');
          statusText.classList.add('text-gray-500');
          break;

        default:
          vidiuStreaming = false;
          streamBtn.textContent = 'Go Live';
          streamBtn.disabled = false;
          previewBtn.classList.remove('hidden');
          previewBtn.disabled = false;
          endPreviewBtn.classList.add('hidden');
          completeBtn.classList.add('hidden');
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
      if (data.data?.uptime && (state === 'Live' || state === 'Previewing' || state === 'Preview')) {
        uptimeEl.textContent = data.data.uptime;
        uptimeEl.classList.remove('hidden');
      } else {
        uptimeEl.classList.add('hidden');
      }

    } else {
      connectionStatus.classList.remove('bg-green-500', 'bg-gray-500');
      connectionStatus.classList.add('bg-red-500');
      statusText.textContent = 'Not connected';
      bitrateEl.textContent = '--';
      streamBtn.disabled = true;
      previewBtn.disabled = true;
    }

    // Also fetch device info for advanced panel
    try {
      const deviceResponse = await fetch('/api/vidiu/device');
      const deviceData = await deviceResponse.json();
      if (deviceData.success && deviceData.data) {
        if (currentModeEl) currentModeEl.textContent = deviceData.data.currentMode || '--';
        if (accountNameEl) accountNameEl.textContent = deviceData.data.accountName || '--';
      }
    } catch (e) {
      // Silently fail for device info
    }

  } catch (error) {
    connectionStatus.classList.remove('bg-green-500', 'bg-gray-500');
    connectionStatus.classList.add('bg-red-500');
    statusText.textContent = 'Connection error';
    streamBtn.disabled = true;
    previewBtn.disabled = true;
  }
}

async function loadVidiuBroadcasts() {
  const broadcastSelect = document.getElementById('vidiu-broadcast');

  try {
    const response = await fetch('/api/vidiu/broadcasts');
    const data = await response.json();

    broadcastSelect.innerHTML = '<option value="">-- Select Broadcast --</option>';

    if (data.success && data.data) {
      const broadcasts = data.data.broadcasts || [];
      broadcasts.forEach(broadcast => {
        const option = document.createElement('option');
        option.value = broadcast.id;
        // Format: title with scheduled time if available
        let label = broadcast.title;
        if (broadcast.scheduledStartTime) {
          const date = new Date(broadcast.scheduledStartTime);
          const timeStr = date.toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit'
          });
          label += ` (${timeStr})`;
        }
        option.textContent = label;
        if (broadcast.selected) {
          option.selected = true;
        }
        broadcastSelect.appendChild(option);
      });
    }
  } catch (error) {
    console.error('Failed to load broadcasts:', error);
  }
}

async function refreshVidiuBroadcasts() {
  const broadcastSelect = document.getElementById('vidiu-broadcast');
  broadcastSelect.innerHTML = '<option value="">Refreshing...</option>';

  try {
    const response = await fetch('/api/vidiu/broadcasts/refresh', { method: 'POST' });
    const data = await response.json();

    broadcastSelect.innerHTML = '<option value="">-- Select Broadcast --</option>';

    if (data.success && data.data) {
      const broadcasts = data.data.broadcasts || [];
      broadcasts.forEach(broadcast => {
        const option = document.createElement('option');
        option.value = broadcast.id;
        let label = broadcast.title;
        if (broadcast.scheduledStartTime) {
          const date = new Date(broadcast.scheduledStartTime);
          const timeStr = date.toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit'
          });
          label += ` (${timeStr})`;
        }
        option.textContent = label;
        if (broadcast.selected) {
          option.selected = true;
        }
        broadcastSelect.appendChild(option);
      });
      vibrate(30);
    }
  } catch (error) {
    console.error('Failed to refresh broadcasts:', error);
    broadcastSelect.innerHTML = '<option value="">-- Error loading --</option>';
  }
}

async function startVidiuStream() {
  const statusText = document.getElementById('vidiu-status-text');
  const streamBtn = document.getElementById('vidiu-stream-btn');

  statusText.textContent = 'Starting...';
  streamBtn.disabled = true;

  try {
    // Check current state
    const statusResponse = await fetch('/api/vidiu/streaming');
    const statusData = await statusResponse.json();
    const currentState = statusData.data?.state || '';

    console.log(`[Vidiu] Going live from state "${currentState}"`);

    if (currentState === 'Previewing' || currentState === 'Preview') {
      // Already in preview - just go live
      const response = await fetch('/api/vidiu/streaming/broadcast', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        vibrate(50);
        startFastPolling();
      } else {
        statusText.textContent = 'Failed to go live';
        streamBtn.disabled = false;
      }
    } else if (currentState === 'Ready') {
      // Try direct go-live first (publish)
      statusText.textContent = 'Going live...';
      const publishResponse = await fetch('/api/vidiu/streaming/start', { method: 'POST' });

      // Wait a moment to check if it worked
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if we're now streaming
      const checkResponse = await fetch('/api/vidiu/streaming');
      const checkData = await checkResponse.json();
      const newState = checkData.data?.state || '';

      if (newState === 'Live' || newState === 'Starting') {
        // Direct publish worked
        vibrate(50);
        startFastPolling();
      } else {
        // Direct publish failed - fall back to preview→live flow
        console.log('[Vidiu] Direct publish failed, using preview flow');
        statusText.textContent = 'Starting preview...';
        const previewResponse = await fetch('/api/vidiu/streaming/preview', { method: 'POST' });
        const previewData = await previewResponse.json();

        if (previewData.success) {
          vibrate(30);
          statusText.textContent = 'Waiting for preview...';
          await waitForState('Previewing', 30000);

          statusText.textContent = 'Going live...';
          const broadcastResponse = await fetch('/api/vidiu/streaming/broadcast', { method: 'POST' });
          const broadcastData = await broadcastResponse.json();

          if (broadcastData.success) {
            vibrate(50);
            startFastPolling();
          } else {
            statusText.textContent = 'Failed to go live';
            streamBtn.disabled = false;
          }
        } else {
          statusText.textContent = 'Failed to start';
          streamBtn.disabled = false;
        }
      }
    } else {
      // Unknown state - try direct start
      const response = await fetch('/api/vidiu/streaming/start', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        vibrate(50);
        startFastPolling();
      } else {
        statusText.textContent = 'Failed to start';
        streamBtn.disabled = false;
      }
    }
  } catch (error) {
    statusText.textContent = 'Start failed';
    streamBtn.disabled = false;
    console.error('Start stream failed:', error);
  }
}

// Helper to wait for a specific Vidiu state
async function waitForState(targetState, timeout = 30000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch('/api/vidiu/streaming');
      const data = await response.json();
      if (data.data?.state === targetState) {
        return true;
      }
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
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

async function selectVidiuBroadcast(broadcastId) {
  try {
    const response = await fetch('/api/vidiu/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: broadcastId })
    });
    const data = await response.json();

    if (data.success) {
      vibrate(30);
      // Reload status to show new broadcast name
      loadVidiuStatus();
    }
  } catch (error) {
    console.error('Select broadcast failed:', error);
  }
}

async function startVidiuPreview() {
  const statusText = document.getElementById('vidiu-status-text');
  const previewBtn = document.getElementById('vidiu-preview-btn');

  statusText.textContent = 'Starting preview...';
  previewBtn.disabled = true;

  try {
    const response = await fetch('/api/vidiu/streaming/preview', { method: 'POST' });
    const data = await response.json();

    if (data.success) {
      vibrate(30);
      startFastPolling();
    } else {
      statusText.textContent = 'Preview failed';
      previewBtn.disabled = false;
    }
  } catch (error) {
    statusText.textContent = 'Preview failed';
    previewBtn.disabled = false;
    console.error('Preview failed:', error);
  }
}

async function endVidiuPreview() {
  const statusText = document.getElementById('vidiu-status-text');
  const endPreviewBtn = document.getElementById('vidiu-endpreview-btn');

  statusText.textContent = 'Ending preview...';
  endPreviewBtn.disabled = true;

  try {
    const response = await fetch('/api/vidiu/streaming/endpreview', { method: 'POST' });
    const data = await response.json();

    if (data.success) {
      vibrate(30);
      startFastPolling();
    } else {
      statusText.textContent = 'End preview failed';
      endPreviewBtn.disabled = false;
    }
  } catch (error) {
    statusText.textContent = 'End preview failed';
    endPreviewBtn.disabled = false;
    console.error('End preview failed:', error);
  }
}

async function completeVidiuBroadcast() {
  const statusText = document.getElementById('vidiu-status-text');
  const completeBtn = document.getElementById('vidiu-complete-btn');
  const broadcastSelect = document.getElementById('vidiu-broadcast');

  if (!confirm('Are you sure you want to complete this broadcast? This will end the stream on YouTube.')) {
    return;
  }

  statusText.textContent = 'Completing broadcast...';
  completeBtn.disabled = true;

  try {
    const response = await fetch('/api/vidiu/streaming/complete', { method: 'POST' });
    const data = await response.json();

    if (data.success) {
      vibrate(50);
      startFastPolling();

      // Clear current selection since completed broadcast is no longer valid
      broadcastSelect.value = '';

      // Refresh broadcasts list after a short delay to get updated list from YouTube
      setTimeout(async () => {
        statusText.textContent = 'Refreshing broadcasts...';
        await loadVidiuBroadcasts();
        statusText.textContent = 'Broadcast completed';
      }, 2000);
    } else {
      statusText.textContent = 'Complete failed';
      completeBtn.disabled = false;
    }
  } catch (error) {
    statusText.textContent = 'Complete failed';
    completeBtn.disabled = false;
    console.error('Complete broadcast failed:', error);
  }
}
