const express = require('express');
const router = express.Router();
const visca = require('../services/visca-client');

// Set exposure mode
// POST /api/visca/exposure/mode { mode: 'auto'|'manual'|'shutter'|'iris'|'bright' }
router.post('/exposure/mode', async (req, res) => {
  const { mode } = req.body;
  const result = await visca.setExposureMode(mode);
  res.json(result);
});

// Adjust gain
// POST /api/visca/exposure/gain { direction: 'up'|'down'|'reset' }
router.post('/exposure/gain', async (req, res) => {
  const { direction } = req.body;
  const result = await visca.adjustGain(direction);
  res.json(result);
});

// Adjust shutter
// POST /api/visca/exposure/shutter { direction: 'up'|'down'|'reset' }
router.post('/exposure/shutter', async (req, res) => {
  const { direction } = req.body;
  const result = await visca.adjustShutter(direction);
  res.json(result);
});

// Adjust iris
// POST /api/visca/exposure/iris { direction: 'up'|'down'|'reset' }
router.post('/exposure/iris', async (req, res) => {
  const { direction } = req.body;
  const result = await visca.adjustIris(direction);
  res.json(result);
});

// Set backlight compensation
// POST /api/visca/exposure/backlight { enabled: true|false }
router.post('/exposure/backlight', async (req, res) => {
  const { enabled } = req.body;
  const result = await visca.setBacklight(enabled);
  res.json(result);
});

// Set white balance mode
// POST /api/visca/wb/mode { mode: 'auto'|'indoor'|'outdoor'|'onepush'|'manual' }
router.post('/wb/mode', async (req, res) => {
  const { mode } = req.body;
  const result = await visca.setWhiteBalanceMode(mode);
  res.json(result);
});

// Adjust red gain
// POST /api/visca/wb/red { direction: 'up'|'down'|'reset' }
router.post('/wb/red', async (req, res) => {
  const { direction } = req.body;
  const result = await visca.adjustRedGain(direction);
  res.json(result);
});

// Adjust blue gain
// POST /api/visca/wb/blue { direction: 'up'|'down'|'reset' }
router.post('/wb/blue', async (req, res) => {
  const { direction } = req.body;
  const result = await visca.adjustBlueGain(direction);
  res.json(result);
});

// Set focus mode
// POST /api/visca/focus/mode { mode: 'auto'|'manual' }
router.post('/focus/mode', async (req, res) => {
  const { mode } = req.body;
  const result = await visca.setFocusMode(mode);
  res.json(result);
});

// One-push autofocus
// POST /api/visca/focus/onepush
router.post('/focus/onepush', async (req, res) => {
  const result = await visca.focusOnePush();
  res.json(result);
});

module.exports = router;
