# PTZ Controller - Remote Deployment Overview

## Architecture Summary

This deployment enables secure remote access to PTZ cameras and Vidiu streaming devices through a Raspberry Pi gateway, using Cloudflare Tunnel for secure connectivity.

```
┌─────────────────────────────────────────────────────────────┐
│                    REMOTE USER (Browser)                     │
│              https://<location>.yourdomain.com               │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS (TLS 1.3)
                           ▼
              ┌────────────────────────────┐
              │   CLOUDFLARE EDGE          │
              │   ┌────────────────────┐   │
              │   │ Cloudflare Access  │   │
              │   │ (Authentication)   │   │
              │   └────────────────────┘   │
              │   ┌────────────────────┐   │
              │   │ Cloudflare Tunnel  │   │
              │   │ (Secure Relay)     │   │
              │   └────────────────────┘   │
              └────────────┬───────────────┘
                           │
            Outbound-only tunnel connection
            (No inbound ports required)
                           │
              ┌────────────▼───────────────┐
              │      RASPBERRY PI          │
              │      (On-Premise)          │
              │  ┌──────────────────────┐  │
              │  │ cloudflared daemon   │  │
              │  │ (tunnel client)      │  │
              │  ├──────────────────────┤  │
              │  │ Express Server :3005 │  │
              │  │  • Static UI         │  │
              │  │  • REST API          │  │
              │  │  • Video proxy       │  │
              │  ├──────────────────────┤  │
              │  │ MediaMTX :8889       │  │
              │  │  • RTSP → WebRTC     │  │
              │  └──────────────────────┘  │
              └───────┬────────┬───────────┘
                      │        │
               LAN    │        │    LAN
             ┌────────┘        └────────┐
             ▼                          ▼
      ┌─────────────┐           ┌─────────────┐
      │ PTZ Camera  │           │   Vidiu     │
      │ HTTP/VISCA  │           │   MQTT/WS   │
      └─────────────┘           └─────────────┘
```

## Components

### 1. Cloudflare (Cloud - Free Tier)

| Component | Purpose | Cost |
|-----------|---------|------|
| **Cloudflare Tunnel** | Secure outbound tunnel from Pi to Cloudflare edge | Free |
| **Cloudflare Access** | Authentication (email OTP, password, or OAuth) | Free (up to 50 users) |
| **DNS** | Route subdomains to tunnels | Free with Cloudflare DNS |

### 2. Raspberry Pi (On-Premise)

| Component | Purpose | Resource Usage |
|-----------|---------|----------------|
| **cloudflared** | Tunnel daemon, connects to Cloudflare | ~20MB RAM |
| **Node.js + Express** | Web server, API, static files | ~50MB RAM |
| **MediaMTX** | RTSP to WebRTC transcoding | ~30MB RAM |
| **Raspberry Pi OS Lite** | Minimal headless OS | ~200MB RAM |

### 3. Local Network Devices

| Device | Protocol | Port |
|--------|----------|------|
| PTZ Camera | HTTP-CGI | 80 |
| PTZ Camera | VISCA TCP | 5678 |
| PTZ Camera | RTSP | 554 |
| Vidiu | MQTT over WebSocket | 80 |

## Deployment Files

```
deployment/
├── docs/
│   ├── DEPLOYMENT-OVERVIEW.md      # This file
│   ├── PI-IMAGE-SPEC.md            # Raspberry Pi requirements
│   ├── CLOUDFLARE-SETUP.md         # Cloudflare configuration guide
│   └── MULTI-SITE.md               # Multi-location deployment
├── systemd/
│   ├── ptz-controller.service      # Node.js application service
│   ├── mediamtx.service            # Video transcoder service
│   └── cloudflared.service         # Tunnel daemon service
├── scripts/
│   ├── pi-setup.sh                 # Initial Pi provisioning
│   ├── pi-update.sh                # Update application on Pi
│   └── tunnel-setup.sh             # Cloudflare tunnel configuration
└── cloudflared/
    └── config.yml.template         # Tunnel configuration template
```

## Quick Start

### Prerequisites

1. Raspberry Pi 3B+ or newer with Raspberry Pi OS Lite
2. Domain with DNS managed by Cloudflare (free)
3. Cloudflare account (free)
4. PTZ camera and/or Vidiu on local network

### Deployment Steps

1. **Prepare Pi**: Flash Raspberry Pi OS Lite, enable SSH
2. **Run Setup**: Execute `pi-setup.sh` on the Pi
3. **Configure Tunnel**: Run `tunnel-setup.sh` to create Cloudflare tunnel
4. **Configure Access**: Set up authentication in Cloudflare dashboard
5. **Test**: Access `https://<location>.yourdomain.com`

See individual documentation files for detailed instructions.

## Multi-Site Deployment

Each location gets:
- Its own Raspberry Pi
- Its own Cloudflare tunnel
- Its own subdomain (e.g., `winder.yourdomain.com`, `dallas.yourdomain.com`)

All locations share:
- Single Cloudflare account
- Single domain
- Cloudflare Access policies (can be per-site or shared)

## Security Model

| Layer | Protection |
|-------|------------|
| **Transport** | TLS 1.3 encryption (Cloudflare edge) |
| **Authentication** | Cloudflare Access (before traffic reaches Pi) |
| **Network** | Pi makes outbound-only connections |
| **Credentials** | Camera/Vidiu credentials stay on-premise |
| **Firewall** | Pi can block ALL inbound traffic |

## Cost Summary

| Item | One-Time | Recurring |
|------|----------|-----------|
| Raspberry Pi 4 (2GB) | $45 | - |
| SD Card (32GB) | $10 | - |
| Power supply | $10 | - |
| Cloudflare services | - | $0 |
| Domain (if needed) | - | $10-15/year |
| **Total per site** | **~$65** | **$0-15/year** |
