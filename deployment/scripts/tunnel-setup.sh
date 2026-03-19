#!/bin/bash
#
# PTZ Controller - Cloudflare Tunnel Setup Script
#
# This script helps configure a Cloudflare tunnel after initial Pi setup.
#
# Usage: ./tunnel-setup.sh <site-name> <subdomain>
# Example: ./tunnel-setup.sh winder winder.example.com
#
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Configuration
CLOUDFLARED_DIR="/etc/cloudflared"
CONFIG_DIR="/etc/ptz-controller"

# Check arguments
if [[ $# -lt 2 ]]; then
    echo "Usage: $0 <site-name> <subdomain>"
    echo "Example: $0 winder winder.example.com"
    exit 1
fi

SITE_NAME="$1"
SUBDOMAIN="$2"

# Validate subdomain format
if [[ ! "$SUBDOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$ ]]; then
    log_error "Invalid subdomain format: $SUBDOMAIN"
    exit 1
fi

log_info "Setting up tunnel for site: $SITE_NAME"
log_info "Subdomain: $SUBDOMAIN"

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    log_error "cloudflared is not installed. Run pi-setup.sh first."
    exit 1
fi

# Check if already authenticated
if [[ ! -f ~/.cloudflared/cert.pem ]]; then
    log_info "Not authenticated with Cloudflare. Starting login..."
    cloudflared tunnel login
fi

# Check if tunnel already exists
if cloudflared tunnel list | grep -q "$SITE_NAME"; then
    log_warn "Tunnel '$SITE_NAME' already exists"
    read -p "Use existing tunnel? (Y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        log_info "Exiting. Delete existing tunnel first with:"
        log_info "  cloudflared tunnel delete $SITE_NAME"
        exit 1
    fi
    TUNNEL_ID=$(cloudflared tunnel list | grep "$SITE_NAME" | awk '{print $1}')
else
    # Create new tunnel
    log_info "Creating tunnel: $SITE_NAME"
    cloudflared tunnel create "$SITE_NAME"
    TUNNEL_ID=$(cloudflared tunnel list | grep "$SITE_NAME" | awk '{print $1}')
fi

log_info "Tunnel ID: $TUNNEL_ID"

# Create config directory if needed
sudo mkdir -p "$CLOUDFLARED_DIR"

# Copy credentials
log_info "Copying tunnel credentials..."
CRED_FILE="$HOME/.cloudflared/${TUNNEL_ID}.json"
if [[ -f "$CRED_FILE" ]]; then
    sudo cp "$CRED_FILE" "$CLOUDFLARED_DIR/"
    sudo chmod 600 "$CLOUDFLARED_DIR/${TUNNEL_ID}.json"
else
    log_error "Credentials file not found: $CRED_FILE"
    exit 1
fi

# Create config file
log_info "Creating tunnel configuration..."
sudo tee "$CLOUDFLARED_DIR/config.yml" > /dev/null << EOF
# Cloudflare Tunnel Configuration
# Site: $SITE_NAME
# Generated: $(date)

tunnel: $TUNNEL_ID
credentials-file: $CLOUDFLARED_DIR/${TUNNEL_ID}.json

ingress:
  - hostname: $SUBDOMAIN
    service: http://localhost:80
  - service: http_status:404
EOF

# Add DNS route
log_info "Adding DNS route..."
cloudflared tunnel route dns "$SITE_NAME" "$SUBDOMAIN" || {
    log_warn "DNS route may already exist or there was an error"
    log_warn "You may need to add it manually in Cloudflare dashboard"
}

# Update site config
log_info "Updating site configuration..."
sudo mkdir -p "$CONFIG_DIR"
echo "SITE_NAME=$SITE_NAME" | sudo tee "$CONFIG_DIR/site.env" > /dev/null

# Enable cloudflared service
log_info "Enabling cloudflared service..."
sudo systemctl enable cloudflared

echo ""
echo "=============================================="
echo -e "${GREEN}Tunnel Setup Complete!${NC}"
echo "=============================================="
echo ""
echo "Tunnel ID: $TUNNEL_ID"
echo "Subdomain: $SUBDOMAIN"
echo ""
echo "Next steps:"
echo ""
echo "1. Start the tunnel:"
echo "   sudo systemctl start cloudflared"
echo ""
echo "2. Check tunnel status:"
echo "   sudo systemctl status cloudflared"
echo "   cloudflared tunnel info $SITE_NAME"
echo ""
echo "3. Set up Cloudflare Access in the dashboard:"
echo "   - Go to Zero Trust > Access > Applications"
echo "   - Add application for: $SUBDOMAIN"
echo "   - Configure authentication policy"
echo ""
echo "4. Test access:"
echo "   Open https://$SUBDOMAIN in your browser"
echo ""
