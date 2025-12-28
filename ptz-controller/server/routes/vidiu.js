const express = require('express');
const router = express.Router();
const vidiu = require('../services/vidiu');

// Helper to wrap async routes with error handling
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Get Vidiu status
// GET /api/vidiu/status
router.get('/status', asyncHandler(async (req, res) => {
  const result = await vidiu.getStatus();
  res.json(result);
}));

// Get streaming status
// GET /api/vidiu/streaming
router.get('/streaming', asyncHandler(async (req, res) => {
  const result = await vidiu.getStreamingStatus();
  res.json(result);
}));

// Start streaming
// POST /api/vidiu/streaming/start
router.post('/streaming/start', asyncHandler(async (req, res) => {
  const result = await vidiu.startStreaming();
  res.json(result);
}));

// Stop streaming
// POST /api/vidiu/streaming/stop
router.post('/streaming/stop', asyncHandler(async (req, res) => {
  const result = await vidiu.stopStreaming();
  res.json(result);
}));

// Get available destinations
// GET /api/vidiu/destinations
router.get('/destinations', asyncHandler(async (req, res) => {
  const result = await vidiu.getDestinations();
  res.json(result);
}));

// Set streaming destination/mode
// POST /api/vidiu/destination { id }
router.post('/destination', asyncHandler(async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Destination ID required' });
  }
  const result = await vidiu.setDestination(id);
  res.json(result);
}));

// Select a specific broadcast (e.g., YouTube scheduled broadcast)
// POST /api/vidiu/broadcast { id }
router.post('/broadcast', asyncHandler(async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Broadcast ID required' });
  }
  const result = await vidiu.selectBroadcast(id);
  res.json(result);
}));

// Get device info
// GET /api/vidiu/device
router.get('/device', asyncHandler(async (req, res) => {
  const result = await vidiu.getDeviceInfo();
  res.json(result);
}));

// Get connection info (bitrate, quality)
// GET /api/vidiu/connection
router.get('/connection', asyncHandler(async (req, res) => {
  const result = await vidiu.getConnectionInfo();
  res.json(result);
}));

// Error handler for this router
router.use((err, req, res, next) => {
  console.error('[Vidiu Route Error]', err.message);
  res.status(500).json({ success: false, error: err.message });
});

module.exports = router;
