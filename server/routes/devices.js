const express = require('express');
const router = express.Router();
const scanner = require('../services/network-scanner');

// Get network info
// GET /api/devices/network
router.get('/network', (req, res) => {
  const info = scanner.getLocalNetworkInfo();
  if (info) {
    res.json(info);
  } else {
    res.status(500).json({ error: 'Could not determine network info' });
  }
});

// Scan network for devices
// GET /api/devices/scan
router.get('/scan', async (req, res) => {
  try {
    const results = await scanner.scanNetwork();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check specific IP for device
// POST /api/devices/check { ip }
router.post('/check', async (req, res) => {
  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ error: 'IP address required' });
  }

  try {
    const hasHttp = await scanner.checkPort(ip, 80, 1000);
    if (!hasHttp) {
      return res.json({ found: false, ip });
    }

    const device = await scanner.identifyDevice(ip);
    res.json({ found: !!device, device });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
