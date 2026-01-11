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

// Start preview (send to YouTube but not live yet)
// POST /api/vidiu/streaming/preview
router.post('/streaming/preview', asyncHandler(async (req, res) => {
  const result = await vidiu.startPreview();
  res.json(result);
}));

// End preview
// POST /api/vidiu/streaming/endpreview
router.post('/streaming/endpreview', asyncHandler(async (req, res) => {
  const result = await vidiu.endPreview();
  res.json(result);
}));

// Go live (transition from preview to broadcast)
// POST /api/vidiu/streaming/broadcast
router.post('/streaming/broadcast', asyncHandler(async (req, res) => {
  const result = await vidiu.broadcast();
  res.json(result);
}));

// Complete/end broadcast
// POST /api/vidiu/streaming/complete
router.post('/streaming/complete', asyncHandler(async (req, res) => {
  const result = await vidiu.completeBroadcast();
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

// Get available YouTube broadcasts
// GET /api/vidiu/broadcasts
router.get('/broadcasts', asyncHandler(async (req, res) => {
  const result = await vidiu.getBroadcasts();
  res.json(result);
}));

// Refresh YouTube broadcasts list
// POST /api/vidiu/broadcasts/refresh
router.post('/broadcasts/refresh', asyncHandler(async (req, res) => {
  const result = await vidiu.refreshBroadcasts();
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

// ============ SETTINGS ROUTES ============

// Generic settings update
// POST /api/vidiu/settings { topic, settings }
router.post('/settings', asyncHandler(async (req, res) => {
  const { topic, settings } = req.body;
  if (!topic || !settings) {
    return res.status(400).json({ error: 'Topic and settings required' });
  }
  const result = await vidiu.updateSettings(topic, settings);
  res.json(result);
}));

// Update YouTube Live settings
// POST /api/vidiu/settings/youtube { broadcast_id, account_id, auto_reconnect, adaptive_bitrate }
router.post('/settings/youtube', asyncHandler(async (req, res) => {
  const result = await vidiu.setYouTubeSettings(req.body);
  res.json(result);
}));

// Update Facebook Live settings
// POST /api/vidiu/settings/facebook { live_mode, page_id, timeline_title, timeline_privacy }
router.post('/settings/facebook', asyncHandler(async (req, res) => {
  const result = await vidiu.setFacebookSettings(req.body);
  res.json(result);
}));

// Update RTMP settings
// POST /api/vidiu/settings/rtmp { url, stream_key, channel_name }
router.post('/settings/rtmp', asyncHandler(async (req, res) => {
  const result = await vidiu.setRTMPSettings(req.body);
  res.json(result);
}));

// Update video encoder settings
// POST /api/vidiu/settings/video { codec, bitrate_setting, bitrate_range, resolution }
router.post('/settings/video', asyncHandler(async (req, res) => {
  const result = await vidiu.setVideoEncoderSettings(req.body);
  res.json(result);
}));

// Update audio encoder settings
// POST /api/vidiu/settings/audio { bitrate_setting, stream_mute, stream_volume }
router.post('/settings/audio', asyncHandler(async (req, res) => {
  const result = await vidiu.setAudioEncoderSettings(req.body);
  res.json(result);
}));

// Update network settings
// POST /api/vidiu/settings/network/:interface { ip_address, ip_netmask, etc }
router.post('/settings/network/:interface', asyncHandler(async (req, res) => {
  const iface = req.params.interface; // e.g., 'Wired/0', 'Wireless/0'
  const result = await vidiu.setNetworkSettings(iface, req.body);
  res.json(result);
}));

// Update system settings
// POST /api/vidiu/settings/system { password, public_snapshot, etc }
router.post('/settings/system', asyncHandler(async (req, res) => {
  const result = await vidiu.setSystemSettings(req.body);
  res.json(result);
}));

// Debug endpoint to check connection status
// GET /api/vidiu/debug
router.get('/debug', asyncHandler(async (req, res) => {
  const client = vidiu.client;
  res.json({
    success: true,
    data: {
      connected: client.connected,
      connecting: client.connecting,
      vidiuIP: client.getVidiuIP(),
      wsUrl: client.getWsUrl(),
      status: client.status,
      currentMode: client.currentMode,
      broadcastsMapSize: client.broadcastsMap.size,
      broadcastOrder: client.broadcastOrder,
      broadcasts: Array.from(client.broadcastsMap.values())
    }
  });
}));

// Error handler for this router
router.use((err, req, res, next) => {
  console.error('[Vidiu Route Error]', err.message);
  res.status(500).json({ success: false, error: err.message });
});

module.exports = router;
