# Browser-First Architecture Analysis

## Proposed Architecture

```
[AWS Amplify] ─── serves ───→ [Browser App]
                                    │
                                    ├── RTSP directly? ──→ [Camera]
                                    ├── HTTP API directly? ──→ [Camera VISCA]
                                    └── MQTT directly? ──→ [Vidiu]
```

**Goal:** Eliminate MediaMTX and Node server entirely. Host static app on AWS Amplify.

---

## Feasibility Analysis

### 1. Browser Receiving RTSP Directly

**Question:** Can browsers play RTSP streams without a transcoding server?

**Answer: NO** - Browsers cannot natively play RTSP streams.

**Why:**
- RTSP uses TCP/UDP for signaling and RTP for media transport
- Browsers have no native RTSP client
- The `<video>` element only supports: MP4, WebM, HLS, DASH

**JavaScript libraries that claim RTSP support:**
| Library | How it works | Requires server? |
|---------|--------------|------------------|
| `node-rtsp-stream` | WebSocket proxy + JSMPEG | YES (Node.js) |
| `ffmpeg.wasm` | Decode in browser | Needs raw stream fed in |
| `jMuxer` | Reassemble H.264 | Needs stream fed via WebSocket |

**All solutions require a server-side component to:**
1. Connect to RTSP stream (TCP)
2. Transcode or repackage
3. Send to browser via WebSocket or HTTP

**HOWEVER: MJPEG Alternative**

PTZ Optics cameras support **MJPEG** which IS browser-compatible:
```html
<img src="http://camera-ip/cgi-bin/mjpeg?stream=1" />
```

**MJPEG Limitation:** CORS
- Camera doesn't send `Access-Control-Allow-Origin` header
- Browser blocks cross-origin image from different host
- Amplify-hosted app cannot load MJPEG from local camera IP

**Verdict:** ❌ Cannot eliminate video transcoding server without CORS proxy

---

### 2. Browser Calling Camera API Directly (VISCA)

**Question:** Can the browser send PTZ commands directly to the camera?

**Answer: NO** - VISCA uses raw TCP sockets on port 5678.

**Why browsers can't do this:**
- `WebSocket` - Only works with WebSocket servers, not raw TCP
- `fetch()` / `XMLHttpRequest` - HTTP only
- `WebRTC` - For peer-to-peer media, not arbitrary TCP
- `WebTransport` - Requires QUIC server support

**There is no browser API for raw TCP connections.** This is a fundamental security restriction.

**HTTP alternative?**
Some PTZ cameras have HTTP-based control APIs. Let me check PTZ Optics:
- PTZ Optics does have CGI commands: `http://camera-ip/cgi-bin/ptzctrl.cgi?...`
- But still blocked by CORS (camera doesn't send CORS headers)

**Verdict:** ❌ Cannot control camera from browser without local proxy

---

### 3. Browser Connecting to Vidiu MQTT Directly

**Question:** Can the browser connect to Vidiu's MQTT broker?

**Answer: MAYBE** - Vidiu exposes MQTT over WebSocket at `ws://vidiu-ip/mqtt`

**How it could work:**
```javascript
import mqtt from 'mqtt';
const client = mqtt.connect('ws://192.168.1.21/mqtt', {
  username: 'admin',
  password: 'admin'
});
```

**Potential issues:**
1. **CORS/Security:** WebSocket connections from browsers may be blocked if Vidiu checks `Origin` header
2. **Mixed Content:** If Amplify serves HTTPS, browser blocks `ws://` (insecure WebSocket)
   - Would need `wss://` but Vidiu likely doesn't support TLS
3. **Local network access:** Browser on internet cannot reach local IP `192.168.1.21`

**Critical realization:** Even if CORS isn't an issue, the browser running from Amplify (internet) **cannot reach local network IPs**.

**Verdict:** ❌ Cannot connect to Vidiu from Amplify-hosted app (network isolation)

---

### 4. AWS Amplify API Returning Commands

**Question:** Could an Amplify API return commands that run locally?

**Proposed flow:**
```
Browser → Amplify API → Returns "send VISCA command X to IP Y"
Browser → ??? → Execute command locally
```

**Problem:** Who executes the command?

- Browser cannot execute system commands
- Browser cannot make TCP connections
- Browser cannot bypass CORS

**This would require a local agent** that:
1. Polls Amplify API for commands (or uses WebSocket)
2. Executes commands against local devices
3. Reports results back

This is essentially the same as having a local Node server, just with the "brain" in the cloud.

**Verdict:** ❌ Still requires local execution agent

---

## The Fundamental Problem

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER SECURITY MODEL                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ✗ Cannot make raw TCP connections (VISCA needs this)       │
│  ✗ Cannot bypass CORS (camera/Vidiu don't send headers)     │
│  ✗ Cannot access local network from internet-hosted app     │
│  ✗ Cannot mix HTTPS app with HTTP/WS local resources        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**The browser is sandboxed.** It cannot directly communicate with arbitrary local network devices.

---

## What IS Possible: Hybrid Approaches

### Option A: Minimal Local Proxy (Lighter than current)

Instead of full Node server + MediaMTX, create a tiny proxy:

```
[Amplify Static App] ← loads in → [Browser]
                                      │
                                      │ HTTP (localhost)
                                      ▼
                            [Tiny Local Proxy]
                              ├── CORS proxy for MJPEG
                              ├── HTTP → VISCA translation
                              └── WebSocket → MQTT relay
                                      │
                              [Camera / Vidiu]
```

**Implementation:** Single Go binary (~5MB), auto-starts, minimal resources.

**Pros:**
- App logic lives on Amplify (easy updates)
- Local proxy is "dumb" - just translates protocols
- Lighter than Node + MediaMTX

**Cons:**
- Still need something local
- Cross-platform binary distribution

---

### Option B: Progressive Web App (PWA) with Local Discovery

```
[Amplify PWA] ← installed on → [Mobile Device]
                                     │
              (When on local network, talks to devices)
                                     │
                            Still blocked by CORS/TCP
```

PWAs have the same browser limitations. No improvement.

---

### Option C: Native App with WebView (Capacitor)

```
[Amplify] ← provides updates → [Capacitor App]
                                     │
                    Native code bridges for:
                    ├── TCP sockets (VISCA)
                    ├── MQTT client
                    └── Video player
                                     │
                            [Camera / Vidiu]
```

**How it works:**
- App shell loads web content from Amplify (or bundled)
- Native plugins handle device communication
- Updates to UI can come from Amplify
- Native bridges updated via app store

**Pros:**
- No local server needed
- Single app on phone
- Can use native video players (VLC libs)

**Cons:**
- Requires native app development
- App Store distribution
- Need to maintain native bridges

---

### Option D: Browser Extension (Chrome/Firefox)

Browser extensions have elevated permissions:
- Can make cross-origin requests (bypass CORS)
- Can potentially use native messaging

**Limitations:**
- Still can't do raw TCP (VISCA)
- Mobile browsers don't support extensions
- Poor user experience

**Verdict:** Not viable for mobile use case.

---

## Revised Architecture Comparison

| Approach | Video | PTZ Control | Vidiu | Local Component |
|----------|-------|-------------|-------|-----------------|
| **Current (Node+MediaMTX)** | ✅ WebRTC | ✅ VISCA | ✅ MQTT | Node.js + MediaMTX |
| **Browser Direct** | ❌ | ❌ | ❌ | None (doesn't work) |
| **Tiny Local Proxy** | ✅ MJPEG proxy | ✅ HTTP→VISCA | ✅ WS→MQTT | Go binary (~5MB) |
| **Capacitor Native** | ✅ Native player | ✅ TCP plugin | ✅ MQTT plugin | None (all in app) |

---

## Recommendation

### If you want to minimize local infrastructure:

**Go with Capacitor Native App (Option C)**

- Host UI on Amplify for easy updates
- App loads UI from Amplify URL (or caches locally)
- Native plugins handle:
  - VISCA TCP communication
  - MQTT WebSocket to Vidiu
  - Native video player for RTSP/MJPEG
- Single app install, no separate server

### If you want to keep browser-only access:

**Go with Tiny Local Proxy (Option A)**

- Simplify current stack to single Go binary
- Eliminates Node.js dependency
- Eliminates MediaMTX (use MJPEG instead)
- App hosted on Amplify
- User still needs to run proxy (but it's minimal)

---

## Technical Deep-Dive: Capacitor Native App

If you choose the Capacitor route, here's what the architecture looks like:

```
┌─────────────────────────────────────────────────────────────┐
│                    CAPACITOR APP                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              WebView (Your existing UI)              │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │  - HTML/CSS/JS from Amplify or bundled      │    │    │
│  │  │  - Calls Capacitor.Plugins.* for native     │    │    │
│  │  └─────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│                    Bridge (Capacitor)                        │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Native Layer (Swift/Kotlin)             │    │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐       │    │
│  │  │ TCP Plugin │ │MQTT Plugin │ │Video Plugin│       │    │
│  │  │  (VISCA)   │ │  (Vidiu)   │ │ (RTSP/MJ)  │       │    │
│  │  └────────────┘ └────────────┘ └────────────┘       │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
└───────────────────────────┼─────────────────────────────────┘
                            │
                   Local Network
                            │
            ┌───────────────┼───────────────┐
            │               │               │
        [Camera]        [Vidiu]        [Router]
```

**Plugins needed:**
1. `capacitor-tcp` - For VISCA commands
2. `capacitor-mqtt` or native MQTT library
3. `capacitor-video-player` or VLCKit/ExoPlayer

---

## Summary

**Your proposed architecture (pure browser + Amplify) is not feasible** due to browser security restrictions:

1. ❌ Browsers cannot play RTSP directly
2. ❌ Browsers cannot make TCP connections (VISCA)
3. ❌ Browsers cannot bypass CORS
4. ❌ Internet-hosted apps cannot reach local network IPs

**Viable alternatives:**
- **Capacitor App**: Eliminates all local servers, everything in one mobile app
- **Tiny Local Proxy**: Simplifies current stack, keeps browser-based UI

Both still require something running locally that has elevated network permissions.
