const express = require('express');
const router = express.Router();
const camera = require('../services/camera');

// Move camera in a direction
// POST /api/ptz/move { direction, panSpeed, tiltSpeed, simulate }
router.post('/move', async (req, res) => {
  const { direction, panSpeed, tiltSpeed, simulate } = req.body;

  const validDirections = ['up', 'down', 'left', 'right', 'upleft', 'upright', 'downleft', 'downright'];
  if (!validDirections.includes(direction)) {
    return res.status(400).json({ error: 'Invalid direction' });
  }

  // Enable diagonal simulation by default for now (can be toggled via setting later)
  const useSimulation = simulate !== undefined ? simulate : true;
  const result = await camera.move(direction, panSpeed || 12, tiltSpeed || 12, useSimulation);
  res.json(result);
});

// Stop all movement
// POST /api/ptz/stop
router.post('/stop', async (req, res) => {
  const result = await camera.stop();
  res.json(result);
});

// Zoom control
// POST /api/ptz/zoom { action, speed }
router.post('/zoom', async (req, res) => {
  const { action, speed } = req.body;

  let result;
  switch (action) {
    case 'in':
      result = await camera.zoomIn(speed || 4);
      break;
    case 'out':
      result = await camera.zoomOut(speed || 4);
      break;
    case 'stop':
      result = await camera.zoomStop();
      break;
    default:
      return res.status(400).json({ error: 'Invalid zoom action' });
  }
  res.json(result);
});

// Focus control
// POST /api/ptz/focus { action, speed }
router.post('/focus', async (req, res) => {
  const { action, speed } = req.body;

  let result;
  switch (action) {
    case 'in':
      result = await camera.focusIn(speed || 4);
      break;
    case 'out':
      result = await camera.focusOut(speed || 4);
      break;
    case 'stop':
      result = await camera.focusStop();
      break;
    default:
      return res.status(400).json({ error: 'Invalid focus action' });
  }
  res.json(result);
});

// Preset control
// POST /api/ptz/preset { action, number }
router.post('/preset', async (req, res) => {
  const { action, number } = req.body;

  if (!number || number < 1 || number > 254) {
    return res.status(400).json({ error: 'Invalid preset number (1-254)' });
  }

  let result;
  switch (action) {
    case 'call':
      result = await camera.presetCall(number);
      break;
    case 'set':
      result = await camera.presetSet(number);
      break;
    default:
      return res.status(400).json({ error: 'Invalid preset action' });
  }
  res.json(result);
});

// Home position
// POST /api/ptz/home
router.post('/home', async (req, res) => {
  const result = await camera.home();
  res.json(result);
});

module.exports = router;
