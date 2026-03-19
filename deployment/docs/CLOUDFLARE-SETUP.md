# Cloudflare Setup Guide

## Overview

This guide walks through setting up Cloudflare Tunnel and Cloudflare Access for secure remote access to your PTZ controller.

**Total Setup Time**: ~30 minutes

## Prerequisites

1. **Domain Name**: You need a domain (e.g., `example.com`)
   - Can use any registrar (Namecheap, GoDaddy, Google, etc.)
   - Will transfer DNS to Cloudflare (free)

2. **Cloudflare Account**: Free account at https://cloudflare.com

3. **Raspberry Pi**: With PTZ Controller installed and running locally

## Part 1: Cloudflare Account Setup

### Step 1.1: Create Cloudflare Account

1. Go to https://dash.cloudflare.com/sign-up
2. Enter email and password
3. Verify email address

### Step 1.2: Add Your Domain to Cloudflare

1. In Cloudflare dashboard, click **"Add a Site"**
2. Enter your domain name (e.g., `example.com`)
3. Select **Free** plan
4. Cloudflare will scan existing DNS records

### Step 1.3: Update Nameservers

1. Cloudflare provides two nameservers (e.g., `ada.ns.cloudflare.com`)
2. Go to your domain registrar
3. Update nameservers to Cloudflare's
4. Wait for propagation (can take up to 24 hours, usually faster)

### Step 1.4: Verify Domain is Active

1. Return to Cloudflare dashboard
2. Domain should show "Active" status
3. Green checkmark indicates DNS is working

## Part 2: Cloudflare Tunnel Setup

### Step 2.1: Install cloudflared on Raspberry Pi

SSH into your Raspberry Pi and run:

```bash
# Download cloudflared for ARM64
sudo curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
  -o /usr/local/bin/cloudflared

# Make executable
sudo chmod +x /usr/local/bin/cloudflared

# Verify installation
cloudflared --version
```

### Step 2.2: Authenticate cloudflared

```bash
# This opens a browser for authentication
cloudflared tunnel login
```

If running headless (no browser):
1. Command outputs a URL
2. Open URL on another device
3. Log in to Cloudflare
4. Select your domain
5. Credentials are saved to `~/.cloudflared/cert.pem`

### Step 2.3: Create a Tunnel

```bash
# Replace 'winder' with your location name
cloudflared tunnel create winder
```

Output shows:
```
Created tunnel winder with id xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**Save this Tunnel ID** - you'll need it for configuration.

### Step 2.4: Create Tunnel Configuration

Create the configuration directory and file:

```bash
sudo mkdir -p /etc/cloudflared
```

Create `/etc/cloudflared/config.yml`:

```yaml
# Tunnel ID from step 2.3
tunnel: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Credentials file (created during tunnel create)
credentials-file: /home/pi/.cloudflared/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.json

# Route traffic to local services
ingress:
  # Your subdomain
  - hostname: winder.example.com
    service: http://localhost:3005
  # Catch-all (required)
  - service: http_status:404
```

### Step 2.5: Create DNS Route

```bash
# This creates CNAME record automatically
cloudflared tunnel route dns winder winder.example.com
```

### Step 2.6: Test Tunnel Manually

```bash
# Run tunnel in foreground for testing
cloudflared tunnel run winder
```

You should see:
```
INF Connection established
INF Registered tunnel connection
```

Press `Ctrl+C` to stop.

### Step 2.7: Install as System Service

```bash
# Install cloudflared as a service
sudo cloudflared service install

# Or manually copy the service file
sudo cp /path/to/deployment/systemd/cloudflared.service /etc/systemd/system/

# Enable and start
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

# Check status
sudo systemctl status cloudflared
```

### Step 2.8: Verify Tunnel is Running

In Cloudflare dashboard:
1. Go to **Zero Trust** → **Networks** → **Tunnels**
2. Your tunnel should show "HEALTHY" status

Or from command line:
```bash
cloudflared tunnel info winder
```

## Part 3: Cloudflare Access Setup

Cloudflare Access adds authentication before users can reach your tunnel.

### Step 3.1: Access Zero Trust Dashboard

1. In Cloudflare dashboard, click **Zero Trust** in left sidebar
2. Or go directly to https://one.dash.cloudflare.com

### Step 3.2: Create Access Application

1. Go to **Access** → **Applications**
2. Click **"Add an application"**
3. Select **"Self-hosted"**

Configure:
- **Application name**: PTZ Controller - Winder
- **Session duration**: 24 hours (or your preference)
- **Application domain**: `winder.example.com`
- **Path**: Leave empty (protects entire domain)

### Step 3.3: Configure Access Policy

Add a policy to control who can access:

**Policy name**: Allowed Users

**Action**: Allow

**Include rules** (choose one or combine):

| Rule Type | Configuration | Use Case |
|-----------|---------------|----------|
| Emails | `user1@gmail.com`, `user2@gmail.com` | Specific individuals |
| Emails ending in | `@yourcompany.com` | Organization members |
| Everyone | (no additional config) | Open to anyone with auth |

### Step 3.4: Choose Authentication Method

In **Authentication** tab, enable identity providers:

| Method | Setup Complexity | User Experience |
|--------|------------------|-----------------|
| **One-time PIN** | None | User enters email, receives PIN via email |
| **Google** | Medium | "Sign in with Google" button |
| **GitHub** | Medium | "Sign in with GitHub" button |
| **App Launcher Password** | Low | Shared password for all users |

**Recommended for simplicity**: One-time PIN (no setup required)

### Step 3.5: Save and Test

1. Click **Save application**
2. Open `https://winder.example.com` in browser
3. You should see Cloudflare Access login page
4. Enter email → receive PIN → enter PIN
5. You're now authenticated and see the PTZ Controller UI

## Part 4: Multi-Site Setup

For additional locations, repeat Parts 2 and 3 with different names:

### Each New Location Needs:

1. **New Tunnel** (on each Pi):
   ```bash
   cloudflared tunnel create dallas
   cloudflared tunnel route dns dallas dallas.example.com
   ```

2. **Site-specific config** (`/etc/cloudflared/config.yml`):
   ```yaml
   tunnel: <DALLAS_TUNNEL_ID>
   credentials-file: /home/pi/.cloudflared/<DALLAS_TUNNEL_ID>.json
   ingress:
     - hostname: dallas.example.com
       service: http://localhost:3005
     - service: http_status:404
   ```

3. **Access Application** (in dashboard):
   - Name: PTZ Controller - Dallas
   - Domain: `dallas.example.com`

### Shared Access Policy (Optional)

Instead of per-site policies, use wildcard:
- Domain: `*.example.com`
- This protects all subdomains with one policy

## Troubleshooting

### Tunnel Won't Connect

```bash
# Check logs
sudo journalctl -u cloudflared -f

# Common issues:
# - Wrong credentials file path
# - Network blocking outbound 443
# - Certificate expired (re-run cloudflared tunnel login)
```

### "Bad Gateway" Error

```bash
# Verify local service is running
curl http://localhost:3005/api/settings

# Check ingress configuration
# Ensure hostname matches exactly
```

### Access Page Not Showing

- Verify DNS record exists: `dig winder.example.com`
- Check tunnel is healthy in Cloudflare dashboard
- Ensure Access application domain matches tunnel hostname

### Session Expires Too Quickly

- Increase session duration in Access application settings
- Default is 24 hours, can extend to 1 month

## Configuration Reference

### Tunnel Config Options

```yaml
tunnel: <UUID>
credentials-file: /path/to/credentials.json

# Optional: metrics server
metrics: localhost:8080

# Optional: logging
loglevel: info

ingress:
  - hostname: example.com
    service: http://localhost:3005
    # Optional: origin server settings
    originRequest:
      connectTimeout: 30s
      noTLSVerify: false
  - service: http_status:404
```

### Useful Commands

```bash
# List all tunnels
cloudflared tunnel list

# Get tunnel info
cloudflared tunnel info <name>

# Delete tunnel (must remove DNS routes first)
cloudflared tunnel delete <name>

# View tunnel connections
cloudflared tunnel route list

# Test configuration
cloudflared tunnel ingress validate

# Run with debug logging
cloudflared tunnel --loglevel debug run <name>
```

## Security Best Practices

1. **Rotate credentials periodically**
   - Delete old tunnel, create new one
   - Update systemd service

2. **Use specific email rules** instead of "Everyone"

3. **Enable audit logging** in Zero Trust dashboard

4. **Set appropriate session duration**
   - Shorter for sensitive operations
   - Longer for convenience

5. **Review access logs** periodically
   - Zero Trust → Logs → Access
