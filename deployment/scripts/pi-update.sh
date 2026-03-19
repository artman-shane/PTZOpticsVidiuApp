#!/bin/bash
#
# PTZ Controller - Update Script
#
# Updates the PTZ Controller application on a Raspberry Pi
# by pulling the latest code from GitHub.
#
# Usage: sudo ./pi-update.sh
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

APP_DIR="/opt/ptz-controller"

# Detect the non-root user who invoked sudo (falls back to first user in /home)
if [[ -n "$SUDO_USER" && "$SUDO_USER" != "root" ]]; then
    APP_USER="$SUDO_USER"
else
    APP_USER=$(ls /home | head -1)
fi
APP_GROUP="$APP_USER"

# Verify app directory exists and is a git repo
if [[ ! -d "$APP_DIR/.git" ]]; then
    log_error "$APP_DIR is not a git repository."
    log_error "Run pi-setup.sh first to install the application."
    exit 1
fi

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    log_error "This script must be run as root (use sudo)"
    exit 1
fi

log_info "Updating PTZ Controller..."

# Stop service
log_info "Stopping ptz-controller service..."
systemctl stop ptz-controller || true

# Backup site-specific config files
log_info "Backing up configuration..."
cp "$APP_DIR/config.json" /tmp/ptz-config-backup.json 2>/dev/null || true
cp "$APP_DIR/presets.json" /tmp/ptz-presets-backup.json 2>/dev/null || true

# Pull latest code
log_info "Pulling latest code from GitHub..."
cd "$APP_DIR"
sudo -u "$APP_USER" git pull

# Restore config backups (git pull won't touch them since they're
# in .gitignore, but restore just in case)
if [[ -f /tmp/ptz-config-backup.json ]]; then
    cp /tmp/ptz-config-backup.json "$APP_DIR/config.json"
    chown "$APP_USER:$APP_GROUP" "$APP_DIR/config.json"
    log_info "Restored config.json"
fi
if [[ -f /tmp/ptz-presets-backup.json ]]; then
    cp /tmp/ptz-presets-backup.json "$APP_DIR/presets.json"
    chown "$APP_USER:$APP_GROUP" "$APP_DIR/presets.json"
    log_info "Restored presets.json"
fi

# Update npm dependencies
log_info "Updating npm dependencies..."
cd "$APP_DIR"
sudo -u "$APP_USER" npm install --production

# Update systemd service files if changed
log_info "Updating systemd services..."
if [[ -d "$APP_DIR/deployment/systemd" ]]; then
    cp "$APP_DIR/deployment/systemd/ptz-controller.service" /etc/systemd/system/
    cp "$APP_DIR/deployment/systemd/cloudflared.service" /etc/systemd/system/
    # Patch service file to use the detected user
    sed -i "s/^User=pi$/User=$APP_USER/" /etc/systemd/system/ptz-controller.service
    sed -i "s/^Group=pi$/Group=$APP_GROUP/" /etc/systemd/system/ptz-controller.service
    systemctl daemon-reload
fi

# Set permissions
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

# Restart service
log_info "Starting ptz-controller service..."
systemctl start ptz-controller

# Verify service is running
sleep 3
if systemctl is-active --quiet ptz-controller; then
    log_info "ptz-controller is running"
else
    log_warn "ptz-controller may not have started correctly"
    log_warn "Check logs: sudo journalctl -u ptz-controller -n 50"
fi

log_info "Update complete!"
