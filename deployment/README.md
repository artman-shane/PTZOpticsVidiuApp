# PTZ Controller - Deployment

This directory contains everything needed to deploy the PTZ Controller for remote access via Cloudflare Tunnel.

## Quick Start

### Prerequisites

1. Raspberry Pi 3B+ or newer with Raspberry Pi OS Lite
2. Domain with DNS managed by Cloudflare (free)
3. Cloudflare account (free)

### Deployment Steps

1. **Flash Pi OS**: Write Raspberry Pi OS Lite to SD card
2. **Enable SSH**: Create empty `ssh` file in boot partition
3. **Transfer files**: Copy this entire repository to the Pi
4. **Run setup**: `sudo ./deployment/scripts/pi-setup.sh`
5. **Configure tunnel**: `./deployment/scripts/tunnel-setup.sh <site-name> <subdomain>`
6. **Start services**: `sudo systemctl start ptz-controller mediamtx cloudflared`
7. **Set up access**: Configure Cloudflare Access in dashboard

## Directory Structure

```
deployment/
├── README.md                    # This file
├── docs/
│   ├── DEPLOYMENT-OVERVIEW.md   # Architecture and components
│   ├── PI-IMAGE-SPEC.md         # Hardware/software requirements
│   ├── CLOUDFLARE-SETUP.md      # Detailed Cloudflare configuration
│   └── MULTI-SITE.md            # Multi-location deployment guide
├── systemd/
│   ├── ptz-controller.service   # Node.js application
│   ├── mediamtx.service         # Video transcoder
│   └── cloudflared.service      # Tunnel daemon
├── scripts/
│   ├── pi-setup.sh              # Initial Pi provisioning
│   ├── tunnel-setup.sh          # Cloudflare tunnel configuration
│   └── pi-update.sh             # Update application on Pi
└── cloudflared/
    └── config.yml.template      # Tunnel config template
```

## Documentation

| Document | Description |
|----------|-------------|
| [DEPLOYMENT-OVERVIEW.md](docs/DEPLOYMENT-OVERVIEW.md) | Architecture, components, and costs |
| [PI-IMAGE-SPEC.md](docs/PI-IMAGE-SPEC.md) | Hardware requirements, memory/storage budget |
| [CLOUDFLARE-SETUP.md](docs/CLOUDFLARE-SETUP.md) | Step-by-step Cloudflare configuration |
| [MULTI-SITE.md](docs/MULTI-SITE.md) | Deploying to multiple locations |

## Architecture Summary

```
User → Cloudflare Access (Auth) → Cloudflare Tunnel → Pi → Camera/Vidiu
```

- **No inbound ports** required on Pi
- **Free** Cloudflare services
- **~$0-15/year** total cost per site

## Cost Breakdown

| Item | One-Time | Recurring |
|------|----------|-----------|
| Raspberry Pi 4 | ~$45 | - |
| SD Card | ~$10 | - |
| Cloudflare | - | Free |
| Domain | - | $10-15/year |

## Support

For issues or questions, see the individual documentation files or check the main project README.
