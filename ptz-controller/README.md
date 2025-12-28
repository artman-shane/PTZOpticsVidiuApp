# PTZ Camera Controller

A mobile-first web application for controlling PTZ Optics cameras with smooth controls and low-latency video.

## Features

- **Live Video Stream** - WebRTC streaming with <500ms latency
- **Virtual Joystick** - Touch-friendly pan/tilt control with variable speed
- **Zoom Controls** - Smooth zoom in/out with continuous press support
- **Preset Management** - 12 presets (tap to recall, long-press to save)
- **Focus Controls** - Auto/Manual modes, Near/Far adjustment, One-Push autofocus
- **Exposure Settings** - Auto/Manual/Shutter Priority/Iris Priority modes
- **White Balance** - Auto/Indoor/Outdoor/Manual modes with R/B gain adjustment
- **Haptic Feedback** - Vibration on mobile devices for button presses

## Requirements

- Node.js 18 or higher
- PTZ Optics camera on the local network
- Computer and phone on the same WiFi network (for mobile access)

## Quick Start

```bash
# Navigate to the project directory
cd ptz-controller

# Install dependencies (first time only)
npm install

# Start the application
npm start
```

The app will be available at:
- **Computer:** http://localhost:3000
- **Phone/Tablet:** http://[your-computer-ip]:3000

## Configuration

Edit `config.json` to match your camera setup:

```json
{
  "camera": {
    "ip": "192.168.108.20",
    "rtspPort": 554,
    "viscaPort": 5678,
    "username": "admin",
    "password": ""
  },
  "server": {
    "port": 3000
  },
  "mediamtx": {
    "webrtcPort": 8889
  }
}
```

### Finding Your Computer's IP Address

**Mac:**
```bash
ipconfig getifaddr en0
```

**Windows:**
```bash
ipconfig
```
Look for "IPv4 Address" under your WiFi adapter.

## Usage

### Pan & Tilt
- Use the virtual joystick in the center of the screen
- Drag further from center for faster movement
- Release to stop

### Zoom
- Tap and hold the + or - buttons
- The longer you hold, the more it zooms

### Presets
- **Tap** a preset button to recall that position
- **Long-press** (hold for 0.5 seconds) to save the current position
- Preset names are stored in your browser

### Settings Panels

**Focus Tab:**
- Toggle between Auto and Manual focus
- Use Near/Far buttons for manual adjustment
- One Push button triggers a single autofocus

**Exposure Tab:**
- Select exposure mode from dropdown
- Adjust Gain, Shutter, and Iris with +/- buttons
- Toggle Backlight Compensation

**White Balance Tab:**
- Select WB mode from dropdown
- Adjust Red/Blue gain for manual white balance

## Troubleshooting

### Video not showing
1. Verify camera IP is correct in `config.json`
2. Check that RTSP is enabled on the camera (Work Mode: RTSP)
3. Test camera stream directly: `rtsp://192.168.108.20:554/1`

### Controls not responding
1. Check browser console for errors (F12 → Console)
2. Verify camera is reachable: `ping 192.168.108.20`
3. Ensure VISCA port (5678) is accessible

### Port already in use
```bash
# Kill processes on ports 3000 and 8889
lsof -ti :3000 | xargs kill -9
lsof -ti :8889 | xargs kill -9
```

### MediaMTX errors
Check MediaMTX configuration in `mediamtx/mediamtx.yml`. The camera path should match:
```yaml
paths:
  camera:
    source: rtsp://192.168.108.20:554/1
```

## Project Structure

```
ptz-controller/
├── server/
│   ├── index.js           # Express server
│   ├── routes/
│   │   ├── ptz.js         # PTZ HTTP-CGI commands
│   │   └── visca.js       # VISCA TCP commands
│   └── services/
│       ├── camera.js      # Camera command builder
│       └── visca-client.js # VISCA TCP client
├── public/
│   ├── index.html         # Main app UI
│   ├── css/styles.css     # Custom styles
│   └── js/app.js          # Frontend logic
├── mediamtx/
│   ├── mediamtx           # MediaMTX binary
│   └── mediamtx.yml       # MediaMTX config
├── config.json            # App configuration
├── start.js               # Startup script
└── package.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Check server status |
| `/api/ptz/move` | POST | Pan/tilt movement |
| `/api/ptz/stop` | POST | Stop all movement |
| `/api/ptz/zoom` | POST | Zoom in/out/stop |
| `/api/ptz/focus` | POST | Focus near/far/stop |
| `/api/ptz/preset` | POST | Call or set preset |
| `/api/ptz/home` | POST | Go to home position |
| `/api/visca/exposure/mode` | POST | Set exposure mode |
| `/api/visca/wb/mode` | POST | Set white balance mode |

## Camera Compatibility

Tested with PTZ Optics cameras using:
- HTTP-CGI API for PTZ control
- VISCA over IP (TCP port 5678) for exposure/WB
- RTSP streaming (port 554)

## License

MIT
