# Mobile Deployment Plan: PTZ & Vidiu Controller

## Problem Statement
- Camera and Vidiu have **outbound** internet access but no inbound (no port forwarding)
- Need to control from mobile device
- Currently running two services: Node.js server + MediaMTX
- Need cross-platform solution (Android + iOS)
- Live video preview is essential
- **Multiple venues** - must work on different networks

## Key Discovery: PTZ Optics Camera Capabilities
PTZ Optics cameras support **MJPEG streaming** directly viewable in browsers. This could eliminate MediaMTX for the video preview component.

**Camera's MJPEG Setup:**
1. Set "Second stream" to "MJPEG" in camera's WebUI → Video → Encode Protocol
2. Access via `http://<camera-ip>/live/jpeg` or similar endpoint
3. Works directly in `<img>` tag with refresh or in dedicated MJPEG viewer

## Architecture Constraints

**Why a pure browser solution won't work:**
- Browsers cannot run Node.js servers or spawn processes
- Browsers cannot make direct TCP connections (needed for VISCA camera control on port 5678)
- RTSP streams cannot be played directly in browsers (requires transcoding)

---

## Option A: Raspberry Pi on Local Network (Recommended)

**Architecture:**
```
[Mobile Browser] ←→ WiFi ←→ [Raspberry Pi] ←→ [Camera/Vidiu]
                              ├─ Node.js (port 3005)
                              └─ MediaMTX (ports 8554, 8888, 8889)
```

**Pros:**
- Uses existing code with minimal changes
- Simple deployment - just run on Pi
- No App Store approval needed
- Both Android and iOS work via browser
- Pi can stay powered and connected permanently

**Cons:**
- Additional hardware ($35-50 for Pi 4)
- Need to know Pi's IP address

**Implementation Steps:**

1. **Pi Setup**
   - Install Raspberry Pi OS Lite (64-bit)
   - Install Node.js 18+
   - Download MediaMTX ARM64 binary
   - Clone your project

2. **Service Configuration**
   - Create systemd service for auto-start
   - Configure to bind to all interfaces (0.0.0.0)
   - Set up static IP or hostname

3. **IP Discovery Options (choose one):**
   - **mDNS/Bonjour**: Pi advertises `ptz-controller.local`
   - **QR Code**: Pi displays QR code with IP on attached screen
   - **Manual entry**: Settings page in app for IP configuration
   - **Network scan**: App scans local network for the service

4. **Mobile Access**
   - Open browser to `http://ptz-controller.local:3005`
   - Or use discovered/entered IP address
   - Existing responsive UI works on mobile

**Changes Required:**
- Update server to bind to `0.0.0.0` instead of `localhost`
- Add CORS headers for cross-origin access
- Add service discovery endpoint (`/api/discover`)
- Create setup scripts for Pi deployment

---

## Option B: Native Mobile App with Embedded Services

**Architecture:**
```
[Mobile App] ─── contains ───→ [Embedded Node.js + MediaMTX]
     │                                    │
     └──── WiFi ──── [Camera/Vidiu] ◄─────┘
```

**Technology Stack:**
- **Framework**: Capacitor (Ionic) or React Native
- **Node.js**: `nodejs-mobile` plugin
- **MediaMTX**: Compiled for ARM (iOS/Android)
- **UI**: WebView showing existing web interface

**Pros:**
- Everything runs on phone
- No additional hardware
- Can work offline (once configured)

**Cons:**
- Complex build process
- MediaMTX needs to be compiled for mobile platforms
- iOS App Store review for network-accessing apps
- Battery drain from running services
- App must stay in foreground (or use background modes)

**Implementation Steps:**

1. **Project Setup**
   - Create Capacitor project
   - Install `capacitor-nodejs` plugin
   - Port Node.js server to run in mobile context

2. **MediaMTX Integration**
   - Compile MediaMTX for iOS (arm64) and Android (arm64-v8a)
   - Bundle binaries in app assets
   - Create native bridge to spawn/manage process

3. **UI Adaptation**
   - WebView loads existing HTML/CSS/JS
   - Point API calls to `localhost:3005`
   - Point video player to `localhost:8889`

4. **Platform-Specific Work**
   - **iOS**: Background modes, network permissions, TestFlight/App Store
   - **Android**: Foreground service for background operation

**Estimated Complexity: HIGH**

---

## Option C: Hybrid - Mobile App (Control) + Pi (Video Only)

**Architecture:**
```
[Mobile App] ←─ WebRTC ─→ [Raspberry Pi] ←─ RTSP ─→ [Camera]
     │                       └─ MediaMTX only
     │
     └──── Direct TCP/MQTT ──→ [Camera VISCA / Vidiu MQTT]
```

**Concept:**
- Mobile app handles camera control (VISCA) and Vidiu (MQTT) directly
- Pi only runs MediaMTX for video transcoding
- Reduces Pi's role, but still needed for video

**Why this might not work well:**
- iOS browsers cannot make raw TCP connections (VISCA)
- Would need native code for VISCA anyway
- If building native app, might as well include Node.js

**Verdict: Not recommended** - complexity similar to Option B with Pi still required.

---

## Option D: Eliminate MediaMTX (If Camera Supports HLS/MJPEG)

**Question to Investigate:** Does your PTZ camera support:
- HLS streaming directly?
- MJPEG streaming?
- WebRTC directly?

If yes, we could eliminate MediaMTX entirely and simplify the architecture significantly.

**If camera supports HLS:**
```
[Mobile Browser] ←─ HLS ─→ [Camera:8080/stream.m3u8]
        │
        └─── HTTP/WS ───→ [Pi or Phone: Node.js only]
```

This would make Option B much more feasible since we only need Node.js, not MediaMTX.

---

## Recommendation

### Primary: Option A (Raspberry Pi)

**Reasons:**
1. Lowest complexity - your existing code works
2. No App Store approval process
3. Works on both platforms immediately
4. Pi can be a permanent, always-on solution
5. Better battery life on mobile (not running servers)

### Implementation Priority:

1. **Phase 1: Basic Pi Deployment**
   - Server binds to all interfaces
   - systemd service for auto-start
   - Manual IP configuration in browser

2. **Phase 2: Discovery**
   - Add mDNS advertisement (`ptz-controller.local`)
   - Add network scan capability

3. **Phase 3 (Optional): Companion App**
   - Simple native app that:
     - Discovers Pi on network
     - Opens WebView to Pi's address
     - Provides better mobile experience (full screen, etc.)

---

---

## Option E: Cloud Tunnel (Enabled by Outbound Access)

Since devices have **outbound** internet access, we can use tunneling services to expose local services securely.

**Architecture:**
```
[Mobile App/Browser] ←── Internet ──→ [Tunnel Service]
        (anywhere)                          │
                                           │ Secure tunnel
                                           ▼
                    [Local Device] ←→ [Camera/Vidiu]
                    (Pi or laptop)
                    ├─ Node.js server
                    ├─ MediaMTX (or camera MJPEG)
                    └─ Tunnel client (outbound connection)
```

**Tunnel Service Options:**

| Service | Free Tier | Ease | Notes |
|---------|-----------|------|-------|
| **Tailscale** | Yes (3 users) | Easy | Mesh VPN, no port forwarding needed |
| **Cloudflare Tunnel** | Yes | Medium | HTTPS only, great for web apps |
| **ngrok** | Yes (limited) | Easy | Quick setup, dynamic URLs |
| **ZeroTier** | Yes (25 devices) | Medium | Similar to Tailscale |

**Best Option: Tailscale**
- Install on Pi (or laptop) + mobile device
- Both join same Tailscale network
- Access Pi via Tailscale IP (e.g., `100.x.x.x`)
- Works from **anywhere** - cellular, different WiFi, etc.
- No port forwarding or firewall changes needed
- End-to-end encrypted

**Workflow at Venue:**
1. Connect Pi to venue network (Ethernet/WiFi)
2. Tailscale auto-connects (outbound to Tailscale servers)
3. Open browser on phone to Pi's Tailscale IP
4. Works whether phone is on same WiFi, cellular, or anywhere

**Pros:**
- Works from anywhere (not just local network)
- No per-venue configuration needed
- Secure (encrypted, authenticated)
- Free tier sufficient for this use case

**Cons:**
- Requires internet at venue (you confirmed this exists)
- Small latency for video (adds ~10-50ms)
- Need Tailscale account

---

## NEW RECOMMENDATION (Updated)

Given your requirements:
- Multiple venues
- Cross-platform (iOS + Android)
- Outbound internet available
- No Pi currently owned

### Recommended Architecture: Option A + E Hybrid

**Components:**
1. **Raspberry Pi 4** (~$50) at venue
   - Runs Node.js server + MediaMTX (or direct MJPEG from camera)
   - Runs Tailscale client
   - Connects to venue network

2. **Tailscale** on Pi + Mobile
   - Creates secure tunnel from anywhere
   - No per-venue network config needed
   - Works from cellular or any WiFi

3. **Mobile Browser** (no app needed initially)
   - Access `http://100.x.x.x:3005` (Pi's Tailscale IP)
   - Existing web UI works perfectly

**Why This is Best:**
- **Simplest path**: Uses your existing code
- **No app development**: Browser works on both platforms
- **Works anywhere**: Not limited to local network
- **Portable**: Pi travels with you
- **Reliable**: Tailscale reconnects automatically

### Deployment Model: Independent Buildings

Each building has:
- Its own Raspberry Pi
- Its own camera + Vidiu
- Its own local network
- Independent operation (no central management)

**Key Requirement: Non-technical staff must be able to set this up.**

---

### Implementation Phases (Updated for Easy Setup)

**Phase 1: Create Pre-Configured Pi Image**

Goal: Staff can flash SD card, plug in Pi, and it works.

- [ ] Create Raspberry Pi OS image with:
  - Node.js 18+ pre-installed
  - Project code pre-installed
  - MediaMTX ARM64 pre-installed
  - Auto-start service configured
  - mDNS enabled (`ptz-controller.local`)
  - WiFi/Ethernet auto-connect
- [ ] Use Raspberry Pi Imager custom image
- [ ] Document: "Flash card, insert, power on"

**Phase 2: Web-Based Setup Wizard**

Goal: First-time setup from mobile browser - no command line needed.

- [ ] Add setup wizard at `/setup` route:
  1. Welcome screen with instructions
  2. Network scan for devices (uses existing `/api/devices/scan`)
  3. Select camera from discovered devices
  4. Select Vidiu from discovered devices
  5. Test connections
  6. Save configuration
  7. Redirect to main app
- [ ] Add "Reconfigure" button in settings for later changes
- [ ] Store "setup complete" flag to skip wizard on subsequent visits

**Phase 3: mDNS Discovery (Easy Access)**

Goal: Staff types `ptz-controller.local` - no IP addresses needed.

- [ ] Install/enable Avahi (mDNS) on Pi image
- [ ] Advertise service as `ptz-controller.local`
- [ ] Works on iOS Safari and most Android browsers
- [ ] Fallback: Display IP on HDMI output (if monitor attached)

**Phase 4: Simple Mobile App (Optional Enhancement)**

Goal: Even easier access - open app, it finds Pi automatically.

- [ ] Create Capacitor app (cross-platform)
- [ ] App scans network for `ptz-controller.local`
- [ ] Opens WebView to discovered Pi
- [ ] Saves last-used Pi for quick access
- [ ] Could distribute via TestFlight (iOS) / APK sideload (Android)

**Phase 5 (Future): Tailscale for Remote Access**

Only if remote access is needed (e.g., manage from home):
- Would require Tailscale setup (more technical)
- Could be optional advanced feature

---

### Setup Experience for Non-Technical Staff

```
Step 1: Receive kit (Pi + SD card + power supply)
        ↓
Step 2: Insert SD card, connect Ethernet, power on
        (Wait 2 minutes for boot)
        ↓
Step 3: On phone, connect to same WiFi
        ↓
Step 4: Open browser, go to "ptz-controller.local"
        ↓
Step 5: Setup wizard opens:
        - "Welcome! Let's find your camera..."
        - [Scanning network...]
        - "Found: PTZ Optics at 192.168.1.20" [Select]
        - "Found: Vidiu at 192.168.1.21" [Select]
        - [Testing connection... ✓]
        - "Setup complete! Tap to open controller"
        ↓
Step 6: Use the app!
```

**No command line. No IP addresses to remember. No technical knowledge required.**

---

## Alternative: Just Use Camera MJPEG (Simplify Video)

If camera's MJPEG quality is acceptable, you could:
1. Eliminate MediaMTX entirely
2. Point video viewer directly at `http://<camera-ip>/cgi-bin/mjpeg?stream=1`
3. Reduces Pi resource usage and complexity

**Trade-off:** MJPEG has higher bandwidth usage and slightly more latency than WebRTC, but simpler architecture.

---

## Files to Modify

1. `server/index.js` - Bind to `0.0.0.0`, add CORS
2. `public/index.html` - Option to use MJPEG directly
3. `public/js/app.js` - Settings for camera/Vidiu IP entry
4. `config.json` - Add dynamic IP configuration
5. New: `scripts/install-pi.sh` - Setup script for Pi
6. New: `scripts/ptz-controller.service` - systemd service file

---

## Questions Resolved
- ~~Camera model~~ → PTZ Optics (supports MJPEG)
- ~~Fixed/multiple venues~~ → Multiple independent buildings
- ~~Pi available~~ → Would need to purchase
- ~~Outbound internet~~ → Yes, available
- ~~Deployment model~~ → Independent setups per building
- ~~Setup by~~ → Non-technical staff (needs easy setup wizard)

---

## Verification Plan

### Testing Setup Wizard
1. Boot fresh Pi with new image
2. Connect to network with test camera/Vidiu
3. Access `ptz-controller.local` from mobile
4. Complete setup wizard
5. Verify camera preview works
6. Verify PTZ controls work
7. Verify Vidiu controls work (start/stop stream)

### Testing Cross-Platform
- [ ] iOS Safari on iPhone
- [ ] iOS Safari on iPad
- [ ] Android Chrome on phone
- [ ] Android Chrome on tablet

### Testing Network Scenarios
- [ ] Pi on Ethernet, phone on same WiFi
- [ ] Pi on WiFi, phone on same WiFi
- [ ] Different subnet (if applicable)

---

## Summary: Final Recommendation

**Solution**: Raspberry Pi + Pre-configured Image + Web Setup Wizard

**Why this approach:**
1. Uses existing codebase (minimal new code)
2. Works on both iOS and Android (browser-based)
3. Non-technical friendly (setup wizard)
4. No App Store approval needed
5. Deployable to multiple independent buildings
6. Cost-effective (~$50-60 per building)

**What we'll build:**
1. Web-based setup wizard for first-time configuration
2. mDNS support for easy discovery (`ptz-controller.local`)
3. Pre-configured Raspberry Pi disk image
4. Optional: Simple mobile app wrapper for even easier access

**Hardware per building:**
- Raspberry Pi 4 (2GB+ RAM) - ~$45
- MicroSD card (16GB+) - ~$8
- USB-C power supply - ~$10
- (Optional) Case - ~$5
