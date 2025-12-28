const express = require('express');
const path = require('path');
const config = require('../config.json');

const ptzRoutes = require('./routes/ptz');
const viscaRoutes = require('./routes/visca');
const devicesRoutes = require('./routes/devices');
const vidiuRoutes = require('./routes/vidiu');

const app = express();
const PORT = config.server.port;

// Middleware
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
    camera: config.camera.ip,
    mediamtx: `http://localhost:${config.mediamtx.webrtcPort}/camera`
  });
});

// Serve index.html for all other routes (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PTZ Controller running at http://localhost:${PORT}`);
  console.log(`Camera IP: ${config.camera.ip}`);
  console.log(`MediaMTX WebRTC: http://localhost:${config.mediamtx.webrtcPort}/camera`);
});
