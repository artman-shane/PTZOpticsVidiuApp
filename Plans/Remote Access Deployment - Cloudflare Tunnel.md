# Remote Access Deployment: PTZ & Vidiu Controller

## Overview

Deploy the PTZ/Vidiu controller for secure remote access using a **single Cloudflare Tunnel** from the Raspberry Pi. Everything (frontend, API, video) runs on the Pi and is exposed securely through Cloudflare.

**Stack:**
- **Cloudflare Tunnel**: Secure outbound tunnel from Pi (free)
- **Cloudflare Access**: Simple password/email authentication (free)
- **Raspberry Pi**: Runs everything - Express server, frontend, MediaMTX video

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    REMOTE USER (Browser)                     │
│                  https://ptz.yourdomain.com                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS
                           ▼
              ┌────────────────────────────┐
              │   Cloudflare Edge          │
              │   + Cloudflare Access      │
              │   (Authentication Layer)   │
              └────────────┬───────────────┘
                           │
            Outbound tunnel (Pi → Cloudflare)
                           │
              ┌────────────▼───────────────┐
              │      RASPBERRY PI          │
              │  ┌──────────────────────┐  │
              │  │ Express Server (3005)│  │
              │  │  - Static frontend   │  │
              │  │  - REST API          │  │
              │  │  - Proxy to MediaMTX │  │
              │  ├──────────────────────┤  │
              │  │ MediaMTX (8889)      │  │
              │  │  - RTSP → WebRTC     │  │
              │  ├──────────────────────┤  │
              │  │ cloudflared          │  │
              │  │  - Tunnel client     │  │
              │  └──────────────────────┘  │
              └───────┬────────┬───────────┘
                      │        │
                      ▼        ▼
                   Camera    Vidiu
                 (LAN only) (LAN only)
```

## Why This Architecture

| Benefit | Description |
|---------|-------------|
| **Simple** | Everything on one device, one tunnel, one URL |
| **Zero inbound ports** | Pi only makes outbound connections (firewall friendly) |
| **Free** | Cloudflare Tunnel and Access are free tier |
| **Secure** | Cloudflare Access handles authentication before traffic reaches Pi |
| **Low latency video** | WebRTC tunneled directly, ~50-100ms added latency |
| **Minimal Pi footprint** | Just add `cloudflared` binary (~30MB) |

---

## Implementation Plan

### Phase 1: Code Changes (Minimal)

#### 1.1 Update Server Binding

File: `server/index.js`

Change the Express server to listen on all interfaces instead of just localhost:

```javascript
// Change from:
app.listen(PORT, 'localhost', () => { ... })

// To:
app.listen(PORT, '0.0.0.0', () => { ... })
```

#### 1.2 Add Video Proxy Route

Add to Express server to proxy video requests through the main server port. This allows everything to go through the single Cloudflare tunnel.

File: `server/index.js`

```javascript
const { createProxyMiddleware } = require('http-proxy-middleware');

// Add before other routes
app.use('/video', createProxyMiddleware({
  target: 'http://localhost:8889',
  changeOrigin: true,
  pathRewrite: { '^/video': '' },
  ws: true  // Enable WebSocket proxying for WebRTC
}));
```

#### 1.3 Update Video Player URL

File: `public/js/app.js`

Update the video iframe source to use the proxied path:

```javascript
// Change from hardcoded MediaMTX port:
// http://localhost:8889/camera

// To relative path:
// /video/camera
```

#### 1.4 Add Dependency

```bash
npm install http-proxy-middleware
```

#### 1.5 (Optional) Backup Authentication Middleware

For defense-in-depth, add a simple auth check in Express as backup to Cloudflare Access:

File: `server/middleware/auth.js` (new)

```javascript
const AUTH_PASSWORD = process.env.PTZ_PASSWORD || 'changeme';

module.exports = function authMiddleware(req, res, next) {
  // Skip for Cloudflare Access (they add cf-access-authenticated-user-email header)
  if (req.headers['cf-access-authenticated-user-email']) {
    return next();
  }

  // Check for backup auth header
  const authHeader = req.headers['x-ptz-auth'];
  if (authHeader === AUTH_PASSWORD) {
    return next();
  }

  // Allow if disabled
  if (process.env.DISABLE_BACKUP_AUTH === 'true') {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized' });
};
```

---

### Phase 2: Cloudflare Setup

#### 2.1 Prerequisites

- Domain registered with DNS managed by Cloudflare (free to add)
- Cloudflare account (free tier is sufficient)

#### 2.2 Create Cloudflare Tunnel

Run these commands on the Raspberry Pi:

```bash
# Download cloudflared for ARM64
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
  -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Authenticate with Cloudflare (opens browser)
cloudflared tunnel login

# Create the tunnel
cloudflared tunnel create ptz-controller

# Note the tunnel ID that is output - you'll need it for config
```

#### 2.3 Configure Tunnel

Create `/etc/cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json

ingress:
  # Single hostname serves everything
  - hostname: ptz.yourdomain.com
    service: http://localhost:3005
  # Catch-all returns 404
  - service: http_status:404
```

#### 2.4 Add DNS Record

```bash
# This creates a CNAME record pointing to the tunnel
cloudflared tunnel route dns ptz-controller ptz.yourdomain.com
```

#### 2.5 Configure Cloudflare Access (Authentication)

In Cloudflare Dashboard:

1. Go to **Zero Trust** → **Access** → **Applications**

2. Click **Add an application** → **Self-hosted**

3. Configure the application:
   - **Name**: PTZ Controller
   - **Session Duration**: 24 hours (or your preference)
   - **Application domain**: `ptz.yourdomain.com`

4. Add an access policy:
   - **Policy name**: Allowed Users
   - **Action**: Allow
   - **Include rule**:
     - Option A: "Emails" → list specific email addresses
     - Option B: "Emails ending in" → `@yourdomain.com`
     - Option C: "Everyone" with One-Time PIN (simplest)

5. Choose authentication method:
   - **One-time PIN** (simplest) - Users enter email, receive code via email
   - **App Launcher password** - Set a shared password
   - **Google/GitHub OAuth** - If you prefer social login

---

### Phase 3: Raspberry Pi Setup

#### 3.1 Pi Setup Script

Create `pi-setup.sh`:

```bash
#!/bin/bash
set -e

echo "=== PTZ Controller Pi Setup ==="

# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js 18
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install cloudflared
echo "Installing cloudflared..."
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
  -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Create app directory
echo "Setting up application directory..."
sudo mkdir -p /opt/ptz-controller
sudo chown $USER:$USER /opt/ptz-controller

# Copy application files (assumes files are in current directory)
echo "Copying application files..."
cp -r server public mediamtx package.json start.js /opt/ptz-controller/

# Install Node.js dependencies
echo "Installing dependencies..."
cd /opt/ptz-controller
npm install --production

# Install systemd services
echo "Installing systemd services..."
sudo cp systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload

# Enable services to start on boot
sudo systemctl enable ptz-controller
sudo systemctl enable cloudflared

echo "=== Setup complete! ==="
echo "Next steps:"
echo "1. Run 'cloudflared tunnel login' to authenticate"
echo "2. Create tunnel with 'cloudflared tunnel create ptz-controller'"
echo "3. Configure /etc/cloudflared/config.yml"
echo "4. Start services with 'sudo systemctl start ptz-controller cloudflared'"
```

#### 3.2 Systemd Service Files

Create `systemd/ptz-controller.service`:

```ini
[Unit]
Description=PTZ Controller Server
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/ptz-controller
ExecStart=/usr/bin/node start.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Create `systemd/cloudflared.service`:

```ini
[Unit]
Description=Cloudflare Tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/cloudflared tunnel run ptz-controller
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Create `systemd/mediamtx.service`:

```ini
[Unit]
Description=MediaMTX RTSP to WebRTC Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/ptz-controller/mediamtx
ExecStart=/opt/ptz-controller/mediamtx/mediamtx
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

#### 3.3 Directory Structure on Pi

```
/opt/ptz-controller/
├── server/
│   ├── index.js
│   ├── routes/
│   └── services/
├── public/
│   ├── index.html
│   └── js/
├── mediamtx/
│   ├── mediamtx (binary)
│   └── mediamtx.yml
├── config.json
├── package.json
└── start.js

/etc/cloudflared/
├── config.yml
└── <tunnel-id>.json

/etc/systemd/system/
├── ptz-controller.service
├── cloudflared.service
└── mediamtx.service
```

---

### Phase 4: Testing & Verification

#### 4.1 Local Testing (on Pi)

```bash
# Start services individually for testing
sudo systemctl start mediamtx
sudo systemctl start ptz-controller

# Test API is responding
curl http://localhost:3005/api/settings
# Should return JSON config

# Test video proxy
curl -I http://localhost:3005/video/
# Should return 200 or redirect to MediaMTX

# Check logs
sudo journalctl -u ptz-controller -f
```

#### 4.2 Tunnel Testing

```bash
# Start the tunnel
sudo systemctl start cloudflared

# Check tunnel status
cloudflared tunnel info ptz-controller

# From a different device/network, test access
curl https://ptz.yourdomain.com/api/settings
# Should return 401 (blocked by Cloudflare Access)
```

#### 4.3 End-to-End Testing

1. Open `https://ptz.yourdomain.com` in browser
2. Cloudflare Access login page appears
3. Enter email address
4. Receive one-time PIN via email
5. Enter PIN to authenticate
6. UI loads with live video feed
7. Test PTZ controls - verify camera responds
8. Test zoom in/out
9. Test Vidiu streaming start/stop
10. Verify video latency is acceptable (~100-200ms total)

#### 4.4 Verify Service Auto-Start

```bash
# Reboot Pi
sudo reboot

# After reboot, verify services are running
systemctl status ptz-controller
systemctl status cloudflared
systemctl status mediamtx

# Test remote access still works
```

---

## Files to Modify Summary

| File | Changes |
|------|---------|
| `server/index.js` | Bind to `0.0.0.0`, add video proxy middleware |
| `public/js/app.js` | Update video iframe to use `/video/camera` path |
| `package.json` | Add `http-proxy-middleware` dependency |
| NEW: `server/middleware/auth.js` | (Optional) Backup authentication |
| NEW: `pi-setup.sh` | Pi provisioning script |
| NEW: `systemd/ptz-controller.service` | Node.js service definition |
| NEW: `systemd/cloudflared.service` | Tunnel service definition |
| NEW: `systemd/mediamtx.service` | Video server service definition |

---

## Cost Estimate

| Service | Cost |
|---------|------|
| Cloudflare Tunnel | Free |
| Cloudflare Access (up to 50 users) | Free |
| Domain name (if needed) | ~$10-15/year |
| Raspberry Pi (one-time) | ~$35-75 |
| **Recurring Total** | **$0-15/year** |

---

## Security Considerations

### Primary Security: Cloudflare Access

- All traffic authenticated at Cloudflare edge BEFORE reaching your Pi
- Supports MFA, session timeouts, and audit logs
- No credentials stored in browser or transmitted over network

### Network Security

- Pi makes only outbound connections to Cloudflare
- No inbound ports needed - can block ALL inbound traffic on firewall
- Camera and Vidiu credentials never leave the local network
- All internet traffic encrypted via TLS (Cloudflare handles certificates)

### Defense in Depth (Optional)

- Add backup auth middleware in Express
- Use firewall to allow only outbound to Cloudflare IPs
- Regularly update cloudflared and Node.js
- Monitor Cloudflare Access logs for unauthorized attempts

---

## Pi Hardware Requirements

### Minimum

- **Model**: Raspberry Pi 3B+ or newer
- **RAM**: 1GB
- **Storage**: 8GB SD card
- **Network**: WiFi or Ethernet

### Recommended

- **Model**: Raspberry Pi 4 (2GB+)
- **RAM**: 2GB+ (better for video transcoding)
- **Storage**: 16GB+ SD card (room for logs)
- **Network**: Ethernet (more stable than WiFi)
- **OS**: Raspberry Pi OS Lite (headless, no desktop)

### Estimated Resource Usage

| Component | RAM Usage |
|-----------|-----------|
| Node.js server | ~50MB |
| MediaMTX | ~30MB |
| cloudflared | ~20MB |
| OS overhead | ~200MB |
| **Total** | **~300MB** |

---

## Troubleshooting

### Tunnel Not Connecting

```bash
# Check tunnel status
cloudflared tunnel info ptz-controller

# Check logs
sudo journalctl -u cloudflared -f

# Verify credentials file exists
ls -la /etc/cloudflared/
```

### Video Not Loading

```bash
# Check MediaMTX is running
systemctl status mediamtx

# Test direct MediaMTX access
curl http://localhost:8889/

# Check proxy logs
sudo journalctl -u ptz-controller | grep proxy
```

### Camera Not Responding

```bash
# Test camera connectivity from Pi
curl http://<camera-ip>/cgi-bin/ptzctrl.cgi?ptzcmd&home

# Check camera IP in config
cat /opt/ptz-controller/config.json
```

### Authentication Issues

1. Clear browser cookies for your domain
2. Check Cloudflare Access logs in Zero Trust dashboard
3. Verify email is in allowed list

---

## Multi-Site Deployment (Subdomain Routing)

For organizations with multiple locations, each site gets its own subdomain and tunnel.

### Architecture

```
                              yourdomain.com
                                    │
           ┌────────────────────────┼────────────────────────┐
           │                        │                        │
           ▼                        ▼                        ▼
    winder.yourdomain.com   dallas.yourdomain.com   austin.yourdomain.com
           │                        │                        │
           ▼                        ▼                        ▼
    ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
    │  Pi @ Winder │        │  Pi @ Dallas │        │  Pi @ Austin │
    │ Tunnel: winder│        │ Tunnel: dallas│       │ Tunnel: austin│
    └──────────────┘        └──────────────┘        └──────────────┘
```

### Setup for Each Site

#### 1. Create Named Tunnel for Each Location

On each Pi, create a unique tunnel:

```bash
# At Winder location
cloudflared tunnel create winder

# At Dallas location
cloudflared tunnel create dallas

# At Austin location
cloudflared tunnel create austin
```

#### 2. Configure Each Tunnel

Each Pi has its own `/etc/cloudflared/config.yml`:

**Winder Pi:**
```yaml
tunnel: <WINDER_TUNNEL_ID>
credentials-file: /etc/cloudflared/<WINDER_TUNNEL_ID>.json

ingress:
  - hostname: winder.yourdomain.com
    service: http://localhost:3005
  - service: http_status:404
```

**Dallas Pi:**
```yaml
tunnel: <DALLAS_TUNNEL_ID>
credentials-file: /etc/cloudflared/<DALLAS_TUNNEL_ID>.json

ingress:
  - hostname: dallas.yourdomain.com
    service: http://localhost:3005
  - service: http_status:404
```

#### 3. Add DNS Records for Each Site

```bash
# Run on each Pi (or from any machine with cloudflared authenticated)
cloudflared tunnel route dns winder winder.yourdomain.com
cloudflared tunnel route dns dallas dallas.yourdomain.com
cloudflared tunnel route dns austin austin.yourdomain.com
```

#### 4. Configure Cloudflare Access

You have two options for authentication:

**Option A: Single Policy for All Sites (Simpler)**

Create one Access application with wildcard:
- Domain: `*.yourdomain.com`
- Policy: Allow specific users to access all sites

**Option B: Per-Site Access Control**

Create separate Access applications:
- `winder.yourdomain.com` → Allow Winder operators
- `dallas.yourdomain.com` → Allow Dallas staff
- `austin.yourdomain.com` → Allow Austin team

This allows different people to access different locations.

### Multi-Site Management Tips

#### Site Identification

Add site name to the UI by setting environment variable on each Pi:

```bash
# In /etc/systemd/system/ptz-controller.service
Environment=SITE_NAME=Winder
```

Then display in the UI header for clarity (e.g., "PTZ Controller - Winder").

#### Centralized Configuration

Consider using environment variables or a config service so each Pi pulls its camera/Vidiu IPs from a central location:

```javascript
// config.js
const SITE_NAME = process.env.SITE_NAME || 'Default';
const config = {
  winder: { cameraIp: '192.168.1.20', vidiuIp: '192.168.1.30' },
  dallas: { cameraIp: '192.168.2.20', vidiuIp: '192.168.2.30' },
  austin: { cameraIp: '192.168.3.20', vidiuIp: '192.168.3.30' },
};
module.exports = config[SITE_NAME.toLowerCase()];
```

#### Monitoring Multiple Sites

- Use Cloudflare Tunnel dashboard to monitor all tunnel connections
- Set up alerts for tunnel disconnections
- Consider adding a simple health endpoint (`/api/health`) that returns site status

### Naming Convention

Simple subdomain structure:
```
<location>.yourdomain.com

Examples:
- winder.example.com
- dallas.example.com
- austin.example.com
- headquarters.example.com
```

---

## Future Enhancements

- [ ] Add status dashboard showing all Pi sites health
- [ ] Implement recording capability with cloud storage
- [ ] Add multiple camera support per site
- [ ] Create pre-built Pi image for easy deployment
- [ ] Add scheduling for automatic streaming
- [ ] Centralized multi-site management portal
