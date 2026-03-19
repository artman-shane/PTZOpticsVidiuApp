# Multi-Site Deployment Guide

## Overview

Deploy PTZ controllers at multiple locations, each accessible via its own subdomain:

- `winder.example.com` → Winder location
- `dallas.example.com` → Dallas location
- `austin.example.com` → Austin location

## Architecture

```
                              example.com
                                   │
           ┌───────────────────────┼───────────────────────┐
           │                       │                       │
           ▼                       ▼                       ▼
   winder.example.com      dallas.example.com      austin.example.com
           │                       │                       │
           ▼                       ▼                       ▼
    ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
    │ Cloudflare  │         │ Cloudflare  │         │ Cloudflare  │
    │ Tunnel:     │         │ Tunnel:     │         │ Tunnel:     │
    │ winder      │         │ dallas      │         │ austin      │
    └──────┬──────┘         └──────┬──────┘         └──────┬──────┘
           │                       │                       │
           ▼                       ▼                       ▼
    ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
    │ Pi @ Winder │         │ Pi @ Dallas │         │ Pi @ Austin │
    │ 192.168.1.x │         │ 192.168.2.x │         │ 192.168.3.x │
    └──────┬──────┘         └──────┬──────┘         └──────┬──────┘
           │                       │                       │
    ┌──────┴──────┐         ┌──────┴──────┐         ┌──────┴──────┐
    │Camera Vidiu │         │Camera Vidiu │         │Camera Vidiu │
    └─────────────┘         └─────────────┘         └─────────────┘
```

## Setup Checklist Per Site

### Hardware
- [ ] Raspberry Pi (3B+ or 4)
- [ ] 32GB SD Card
- [ ] Power supply
- [ ] Ethernet cable (recommended)
- [ ] PTZ Camera on local network
- [ ] Vidiu on local network (if applicable)

### Software/Accounts
- [ ] Cloudflare account (one account for all sites)
- [ ] Domain added to Cloudflare
- [ ] Raspberry Pi OS Lite flashed

### Configuration Items Needed
- [ ] Site name (e.g., "winder")
- [ ] Subdomain (e.g., "winder.example.com")
- [ ] Camera IP address
- [ ] Camera credentials (if required)
- [ ] Vidiu IP address
- [ ] Vidiu credentials

## Site Provisioning Steps

### Step 1: Prepare the Pi

```bash
# Flash Raspberry Pi OS Lite to SD card
# Enable SSH: create empty file named "ssh" in boot partition

# Boot Pi and connect via SSH
ssh pi@raspberrypi.local

# Change default password
passwd

# Update system
sudo apt update && sudo apt upgrade -y
```

### Step 2: Run Setup Script

Transfer and run the setup script:

```bash
# From your workstation
scp -r deployment/scripts/pi-setup.sh pi@<pi-ip>:~/

# On the Pi
chmod +x ~/pi-setup.sh
sudo ~/pi-setup.sh
```

### Step 3: Configure for This Site

Set the site name:

```bash
# Set environment variable for this site
echo "SITE_NAME=winder" | sudo tee /etc/ptz-controller/site.env
```

Configure camera and Vidiu IPs:

```bash
# Edit the config
sudo nano /opt/ptz-controller/config.json
```

```json
{
  "camera": {
    "ip": "192.168.1.20",
    "httpPort": 80,
    "viscaPort": 5678,
    "rtspPort": 554,
    "username": "",
    "password": ""
  },
  "vidiu": {
    "ip": "192.168.1.30",
    "username": "admin",
    "password": "admin"
  }
}
```

### Step 4: Create Cloudflare Tunnel

```bash
# Authenticate (first time only on this Pi)
cloudflared tunnel login

# Create tunnel with site name
cloudflared tunnel create winder

# Note the Tunnel ID output
# Example: Created tunnel winder with id abc12345-...
```

### Step 5: Configure Tunnel

Create `/etc/cloudflared/config.yml`:

```yaml
tunnel: abc12345-xxxx-xxxx-xxxx-xxxxxxxxxxxx
credentials-file: /home/pi/.cloudflared/abc12345-xxxx-xxxx-xxxx-xxxxxxxxxxxx.json

ingress:
  - hostname: winder.example.com
    service: http://localhost:3005
  - service: http_status:404
```

Copy credentials to system location:

```bash
sudo cp ~/.cloudflared/*.json /etc/cloudflared/
sudo chmod 600 /etc/cloudflared/*.json
```

### Step 6: Add DNS Route

```bash
cloudflared tunnel route dns winder winder.example.com
```

### Step 7: Start Services

```bash
sudo systemctl enable ptz-controller mediamtx cloudflared
sudo systemctl start ptz-controller mediamtx cloudflared
```

### Step 8: Configure Cloudflare Access

In Cloudflare Zero Trust dashboard:

1. **Access** → **Applications** → **Add application**
2. Choose **Self-hosted**
3. Configure:
   - Name: `PTZ Controller - Winder`
   - Domain: `winder.example.com`
4. Add access policy for authorized users
5. Save

### Step 9: Test

1. Open `https://winder.example.com` in browser
2. Authenticate via Cloudflare Access
3. Verify video feed loads
4. Test PTZ controls
5. Test Vidiu controls

## Managing Multiple Sites

### Shared Access Policy

For simpler management, use a wildcard Access application:

1. Create single Access application
2. Domain: `*.example.com`
3. All sites use same authentication

### Per-Site Access Control

For granular control:

1. Create separate Access application per site
2. Different allowed users per location
3. Different session durations if needed

### Monitoring All Sites

In Cloudflare dashboard:
- **Zero Trust** → **Networks** → **Tunnels**
- Shows status of all tunnels
- Alerts on tunnel disconnection

### Bulk Updates

To update application on all Pis:

```bash
# Script to update all sites
SITES="192.168.1.10 192.168.2.10 192.168.3.10"

for IP in $SITES; do
  echo "Updating $IP..."
  ssh pi@$IP "cd /opt/ptz-controller && git pull && npm install && sudo systemctl restart ptz-controller"
done
```

## Site Configuration Management

### Option 1: Per-Site Config Files

Each Pi has its own `/opt/ptz-controller/config.json`:

```json
{
  "siteName": "Winder",
  "camera": {
    "ip": "192.168.1.20"
  }
}
```

### Option 2: Environment Variables

Set site-specific config via systemd environment:

`/etc/ptz-controller/site.env`:
```
SITE_NAME=Winder
CAMERA_IP=192.168.1.20
VIDIU_IP=192.168.1.30
```

`/etc/systemd/system/ptz-controller.service`:
```ini
[Service]
EnvironmentFile=/etc/ptz-controller/site.env
```

### Option 3: Central Configuration Service

For many sites, consider:
- Store configs in S3/cloud storage
- Pi downloads config on boot based on hostname
- Enables remote configuration updates

## Naming Conventions

### Recommended

| Location | Subdomain | Tunnel Name |
|----------|-----------|-------------|
| Winder | winder.example.com | winder |
| Dallas | dallas.example.com | dallas |
| Austin | austin.example.com | austin |
| Main Office | hq.example.com | hq |

### Avoid

- Spaces in names
- Special characters
- Very long names
- Similar names that could be confused

## Site Inventory Template

Track your deployments:

| Site | Subdomain | Tunnel ID | Pi IP | Camera IP | Vidiu IP | Status |
|------|-----------|-----------|-------|-----------|----------|--------|
| Winder | winder.example.com | abc123... | 192.168.1.10 | 192.168.1.20 | 192.168.1.30 | Active |
| Dallas | dallas.example.com | def456... | 10.0.1.10 | 10.0.1.20 | 10.0.1.30 | Active |
| Austin | austin.example.com | ghi789... | 172.16.1.10 | 172.16.1.20 | - | Active |

## Troubleshooting Multi-Site

### One Site Down, Others Working

- Check that specific Pi is online
- Verify tunnel is running: `sudo systemctl status cloudflared`
- Check internet connectivity at that location

### All Sites Down

- Check Cloudflare status: https://www.cloudflarestatus.com
- Verify domain DNS is still pointed to Cloudflare
- Check Cloudflare account status

### Wrong Site Loads

- Verify DNS record points to correct tunnel
- Check config.yml has correct hostname
- Clear browser cache/cookies

### Authentication Issues

- Verify Access application exists for that subdomain
- Check user is in allowed list
- Confirm authentication method is enabled
