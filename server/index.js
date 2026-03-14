const express = require('express');
const path = require('path');
const fs = require('fs');
const { createProxyMiddleware } = require('http-proxy-middleware');

// Load config (use function to allow reloading)
const CONFIG_PATH = path.join(__dirname, '../config.json');
const PRESETS_PATH = path.join(__dirname, '../presets.json');

function loadConfig() {
  delete require.cache[require.resolve('../config.json')];
  return require('../config.json');
}
let config = loadConfig();

// Load presets from file
function loadPresets() {
  try {
    if (fs.existsSync(PRESETS_PATH)) {
      return JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8'));
    }
  } catch (error) {
    console.error('[Presets] Error loading presets:', error.message);
  }
  return {};
}

// Save presets to file
function savePresets(presets) {
  try {
    fs.writeFileSync(PRESETS_PATH, JSON.stringify(presets, null, 2), 'utf8');
    console.log('[Presets] Saved to file');
    return true;
  } catch (error) {
    console.error('[Presets] Error saving presets:', error.message);
    return false;
  }
}

const ptzRoutes = require('./routes/ptz');
const viscaRoutes = require('./routes/visca');
const devicesRoutes = require('./routes/devices');
const vidiuRoutes = require('./routes/vidiu');
const mediamtx = require('./services/mediamtx');

const app = express();
const PORT = config.server.port;

// Video proxy - routes /video/* and /camera/* to MediaMTX WebRTC server
// IMPORTANT: Must be before express.json() to avoid interfering with WHEP protocol
const videoProxyOptions = {
  target: `http://localhost:${config.mediamtx.webrtcPort}`,
  changeOrigin: true,
  ws: true,
  on: {
    error: (err, req, res) => {
      console.error('[Video Proxy] Error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Video server unavailable' });
      }
    }
  }
};

// Proxy /video, /camera, and /whep to MediaMTX
// - /video/* is rewritten to /* (removes /video prefix)
// - /camera/* needs to preserve the /camera prefix (Express strips mount path)
// - /whep/* goes to /camera/whep/* (MediaMTX session endpoints)
app.use('/video', createProxyMiddleware({
  ...videoProxyOptions,
  pathRewrite: { '^/video': '' }
}));
app.use('/camera', createProxyMiddleware({
  ...videoProxyOptions,
  // Express strips /camera from req.url, so we need to add it back
  pathRewrite: (path) => '/camera' + path
}));
app.use('/whep', createProxyMiddleware({
  ...videoProxyOptions,
  pathRewrite: { '^/whep': '/camera/whep' }
}));

// HLS proxy - routes /hls/* to MediaMTX HLS server for remote access fallback
app.use('/hls', createProxyMiddleware({
  target: `http://localhost:${config.mediamtx.hlsPort || 8888}`,
  changeOrigin: true,
  pathRewrite: { '^/hls': '' },
  on: {
    error: (err, req, res) => {
      console.error('[HLS Proxy] Error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'HLS server unavailable' });
      }
    }
  }
}));

// JSON parsing middleware - after proxy routes
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api/ptz', ptzRoutes);
app.use('/api/visca', viscaRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/vidiu', vidiuRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    siteName: process.env.SITE_NAME || 'PTZ Controller',
    camera: config.camera.ip,
    vidiu: config.vidiu.ip,
    mediamtx: `/video/camera`,
    version: require('../package.json').version
  });
});

// Get current settings
app.get('/api/settings', (req, res) => {
  config = loadConfig();
  res.json({
    success: true,
    data: {
      camera: {
        ip: config.camera.ip,
        rtspPort: config.camera.rtspPort,
        rtspPath: config.camera.rtspPath,
        viscaPort: config.camera.viscaPort,
        username: config.camera.username,
        password: config.camera.password
      },
      vidiu: {
        ip: config.vidiu.ip
      },
      mediamtx: {
        webrtcPort: config.mediamtx.webrtcPort
      }
    }
  });
});

// Update settings
app.post('/api/settings', async (req, res) => {
  try {
    const { camera, vidiu, mediamtx: mtxSettings } = req.body;

    // Update config object
    if (camera) {
      if (camera.ip) config.camera.ip = camera.ip;
      if (camera.rtspPort) config.camera.rtspPort = camera.rtspPort;
      if (camera.rtspPath) config.camera.rtspPath = camera.rtspPath;
      if (camera.viscaPort) config.camera.viscaPort = camera.viscaPort;
      if (camera.username !== undefined) config.camera.username = camera.username;
      if (camera.password !== undefined) config.camera.password = camera.password;
    }

    if (vidiu) {
      if (vidiu.ip) config.vidiu.ip = vidiu.ip;
    }

    if (mtxSettings) {
      if (mtxSettings.webrtcPort) config.mediamtx.webrtcPort = mtxSettings.webrtcPort;
    }

    // Save to config.json
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    console.log('[Settings] Config saved');

    // Update MediaMTX config and restart
    await mediamtx.updateConfig(config);
    console.log('[Settings] MediaMTX restarted with new config');

    res.json({ success: true, message: 'Settings saved and services restarted' });
  } catch (error) {
    console.error('[Settings] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all presets
app.get('/api/presets', (req, res) => {
  const presets = loadPresets();
  res.json({ success: true, data: presets });
});

// Save all presets
app.post('/api/presets', (req, res) => {
  const presets = req.body;
  if (savePresets(presets)) {
    res.json({ success: true, message: 'Presets saved' });
  } else {
    res.status(500).json({ success: false, error: 'Failed to save presets' });
  }
});

// Update a single preset
app.put('/api/presets/:id', (req, res) => {
  const presetId = req.params.id;
  const presetData = req.body;
  const presets = loadPresets();
  presets[presetId] = presetData;
  if (savePresets(presets)) {
    res.json({ success: true, message: `Preset ${presetId} saved` });
  } else {
    res.status(500).json({ success: false, error: 'Failed to save preset' });
  }
});

// Serve index.html for all other routes (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PTZ Controller running at http://localhost:${PORT}`);
  console.log(`Camera IP: ${config.camera.ip}`);
  console.log(`MediaMTX WebRTC: http://localhost:${config.mediamtx.webrtcPort}/camera`);

  // Generate MediaMTX config and start it
  mediamtx.updateConfig(config).then(() => {
    console.log('[MediaMTX] Started automatically');
  }).catch(err => {
    console.error('[MediaMTX] Failed to start:', err.message);
  });
});
