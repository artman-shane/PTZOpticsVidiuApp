#!/bin/bash
#
# PTZ Controller - Raspberry Pi Setup Script
#
# This script installs all required software and configures the Pi
# for running the PTZ Controller with Cloudflare Tunnel.
#
# Usage: sudo ./pi-setup.sh
#
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="/opt/ptz-controller"
CONFIG_DIR="/etc/ptz-controller"
CLOUDFLARED_DIR="/etc/cloudflared"
NODE_VERSION="20"
GITHUB_REPO="https://github.com/artman-shane/PTZOpticsVidiuApp.git"
MEDIAMTX_VERSION="v1.17.0"

# Detect the non-root user who invoked sudo (falls back to first user in /home)
if [[ -n "$SUDO_USER" && "$SUDO_USER" != "root" ]]; then
    APP_USER="$SUDO_USER"
else
    APP_USER=$(ls /home | head -1)
fi
APP_GROUP="$APP_USER"

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

check_pi() {
    if ! grep -q "Raspberry Pi" /proc/device-tree/model 2>/dev/null; then
        log_warn "This doesn't appear to be a Raspberry Pi"
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

check_architecture() {
    ARCH=$(uname -m)
    if [[ "$ARCH" != "aarch64" ]]; then
        log_warn "Expected aarch64 (ARM64), got $ARCH"
        log_warn "Some downloads may need adjustment"
    fi
}

# Main setup functions
update_system() {
    log_info "Updating system packages..."
    apt-get update
    apt-get upgrade -y
}

install_dependencies() {
    log_info "Installing dependencies..."
    apt-get install -y \
        curl \
        git \
        ca-certificates \
        gnupg
}

install_nodejs() {
    log_info "Installing Node.js ${NODE_VERSION}..."

    # Check if already installed
    if command -v node &> /dev/null; then
        CURRENT_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ "$CURRENT_VERSION" -ge "$NODE_VERSION" ]]; then
            log_info "Node.js $(node -v) already installed"
            return
        fi
    fi

    # Install Node.js from NodeSource
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs

    log_info "Node.js $(node -v) installed"
    log_info "npm $(npm -v) installed"
}

install_cloudflared() {
    log_info "Installing cloudflared..."

    # Check if already installed
    if command -v cloudflared &> /dev/null; then
        log_info "cloudflared already installed: $(cloudflared --version)"
        return
    fi

    # Download for ARM64
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
        -o /usr/local/bin/cloudflared

    chmod +x /usr/local/bin/cloudflared

    log_info "cloudflared $(cloudflared --version) installed"
}

install_mediamtx() {
    log_info "Installing MediaMTX ${MEDIAMTX_VERSION}..."

    local MEDIAMTX_DIR="$APP_DIR/mediamtx"

    # Check if already installed
    if [[ -x "$MEDIAMTX_DIR/mediamtx" ]]; then
        log_info "MediaMTX binary already exists at $MEDIAMTX_DIR/mediamtx"
        return
    fi

    mkdir -p "$MEDIAMTX_DIR"

    local DOWNLOAD_URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_linux_arm64.tar.gz"
    log_info "Downloading from $DOWNLOAD_URL"

    curl -L "$DOWNLOAD_URL" -o /tmp/mediamtx.tar.gz
    tar -xzf /tmp/mediamtx.tar.gz -C "$MEDIAMTX_DIR"
    rm -f /tmp/mediamtx.tar.gz

    chmod +x "$MEDIAMTX_DIR/mediamtx"
    chown -R "$APP_USER:$APP_GROUP" "$MEDIAMTX_DIR"

    log_info "MediaMTX installed to $MEDIAMTX_DIR"
}

create_directories() {
    log_info "Creating application directories..."

    # Config directory
    mkdir -p "$CONFIG_DIR"

    # Cloudflared directory
    mkdir -p "$CLOUDFLARED_DIR"

    # Set ownership
    chown -R "$APP_USER:$APP_GROUP" "$CONFIG_DIR"
}

install_application() {
    log_info "Installing PTZ Controller application..."

    if [[ -d "$APP_DIR/.git" ]]; then
        log_info "Repository already cloned at $APP_DIR, pulling latest..."
        cd "$APP_DIR"
        sudo -u "$APP_USER" git pull
    else
        log_info "Cloning repository from $GITHUB_REPO..."
        # Remove directory if it exists but isn't a git repo
        if [[ -d "$APP_DIR" ]]; then
            # Preserve any existing config files
            if [[ -f "$APP_DIR/config.json" ]]; then
                cp "$APP_DIR/config.json" /tmp/ptz-config-backup.json
            fi
            if [[ -f "$APP_DIR/presets.json" ]]; then
                cp "$APP_DIR/presets.json" /tmp/ptz-presets-backup.json
            fi
            rm -rf "$APP_DIR"
        fi

        git clone "$GITHUB_REPO" "$APP_DIR"
        chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

        # Restore config backups if they existed
        if [[ -f /tmp/ptz-config-backup.json ]]; then
            cp /tmp/ptz-config-backup.json "$APP_DIR/config.json"
            chown "$APP_USER:$APP_GROUP" "$APP_DIR/config.json"
        fi
        if [[ -f /tmp/ptz-presets-backup.json ]]; then
            cp /tmp/ptz-presets-backup.json "$APP_DIR/presets.json"
            chown "$APP_USER:$APP_GROUP" "$APP_DIR/presets.json"
        fi
    fi

    # Create default config if none exists
    if [[ ! -f "$APP_DIR/config.json" ]]; then
        log_info "Creating default config.json from template..."
        cp "$APP_DIR/config.json.example" "$APP_DIR/config.json"
        chown "$APP_USER:$APP_GROUP" "$APP_DIR/config.json"
    fi

    # Create default presets if none exists
    if [[ ! -f "$APP_DIR/presets.json" ]]; then
        log_info "Creating default presets.json from template..."
        cp "$APP_DIR/presets.json.example" "$APP_DIR/presets.json"
        chown "$APP_USER:$APP_GROUP" "$APP_DIR/presets.json"
    fi

    # Install npm dependencies
    if [[ -f "$APP_DIR/package.json" ]]; then
        log_info "Installing npm dependencies..."
        cd "$APP_DIR"
        sudo -u "$APP_USER" npm install --production
    fi

    chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
}

install_systemd_services() {
    log_info "Installing systemd services..."

    local SYSTEMD_SOURCE="$APP_DIR/deployment/systemd"

    if [[ -d "$SYSTEMD_SOURCE" ]]; then
        # Install ptz-controller and cloudflared services
        cp "$SYSTEMD_SOURCE/ptz-controller.service" /etc/systemd/system/
        cp "$SYSTEMD_SOURCE/cloudflared.service" /etc/systemd/system/
        # Note: mediamtx.service is NOT installed because the Node.js app
        # manages MediaMTX as a child process (see server/services/mediamtx.js)

        # Patch service file to use the detected user instead of hardcoded 'pi'
        sed -i "s/^User=pi$/User=$APP_USER/" /etc/systemd/system/ptz-controller.service
        sed -i "s/^Group=pi$/Group=$APP_GROUP/" /etc/systemd/system/ptz-controller.service
    else
        log_warn "Systemd service files not found at $SYSTEMD_SOURCE"
        log_warn "You'll need to install them manually"
        return
    fi

    # Reload systemd
    systemctl daemon-reload

    # Enable ptz-controller (but don't start yet - needs config)
    systemctl enable ptz-controller.service
    # Don't enable cloudflared until tunnel is configured
    # Don't enable mediamtx - the Node.js app manages it as a child process

    log_info "Services installed. ptz-controller enabled for boot."
}

create_default_config() {
    log_info "Creating default configuration..."

    # Site environment file
    if [[ ! -f "$CONFIG_DIR/site.env" ]]; then
        cat > "$CONFIG_DIR/site.env" << 'EOF'
# Site-specific configuration
# Edit this file with your site name
SITE_NAME=default
EOF
    fi

    # Cloudflared config template
    if [[ ! -f "$CLOUDFLARED_DIR/config.yml" ]]; then
        cat > "$CLOUDFLARED_DIR/config.yml.template" << 'EOF'
# Cloudflare Tunnel Configuration
#
# Replace the following values after creating your tunnel:
# - TUNNEL_ID: from 'cloudflared tunnel create <name>'
# - YOUR_SUBDOMAIN: your chosen subdomain (e.g., winder.example.com)
#
# Then rename this file to config.yml

tunnel: TUNNEL_ID
credentials-file: /etc/cloudflared/TUNNEL_ID.json

ingress:
  - hostname: YOUR_SUBDOMAIN
    service: http://localhost:80
  - service: http_status:404
EOF
    fi
}

configure_firewall() {
    log_info "Configuring firewall..."

    # Install ufw if not present
    if ! command -v ufw &> /dev/null; then
        log_info "Installing ufw..."
        apt-get install -y ufw
    fi

    # Add all rules BEFORE enabling the firewall
    ufw default allow outgoing
    ufw allow ssh
    ufw allow 80/tcp comment "PTZ Controller web UI"
    ufw allow 8889/tcp comment "MediaMTX WebRTC"
    ufw allow 8888/tcp comment "MediaMTX HLS"
    ufw allow 8554/tcp comment "MediaMTX RTSP"

    # Verify SSH rule was added before enabling — never lock ourselves out
    # (ufw status only shows rules when active, so check the rules file directly)
    if ! grep -q "dport 22" /etc/ufw/user.rules 2>/dev/null; then
        log_error "SSH rule not found in ufw — refusing to enable firewall to avoid lockout"
        log_error "Run 'sudo ufw allow ssh' manually, then 'sudo ufw enable'"
        return 1
    fi

    # Safe to enable now that all rules are confirmed
    ufw --force enable

    log_info "Firewall enabled with ports open: 22 (SSH), 80 (web UI), 8889 (WebRTC), 8888 (HLS), 8554 (RTSP)"
}

print_next_steps() {
    echo ""
    echo "=============================================="
    echo -e "${GREEN}PTZ Controller Setup Complete!${NC}"
    echo "=============================================="
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Configure camera and Vidiu IPs:"
    echo "   sudo nano $APP_DIR/config.json"
    echo ""
    echo "2. Start the application:"
    echo "   sudo systemctl start ptz-controller"
    echo ""
    echo "3. Verify it's running:"
    echo "   curl http://localhost:80/api/health"
    echo ""
    echo "4. (Optional) Set up Cloudflare Tunnel:"
    echo "   cloudflared tunnel login"
    echo "   cloudflared tunnel create <site-name>"
    echo "   sudo nano $CLOUDFLARED_DIR/config.yml"
    echo "   # Copy from config.yml.template and fill in values"
    echo "   sudo systemctl enable --now cloudflared"
    echo ""
    echo "For troubleshooting, check logs:"
    echo "   sudo journalctl -u ptz-controller -f"
    echo ""
    echo "To update later:"
    echo "   sudo $APP_DIR/deployment/scripts/pi-update.sh"
    echo ""
}

# Main execution
main() {
    echo "=============================================="
    echo "PTZ Controller - Raspberry Pi Setup"
    echo "=============================================="
    echo ""

    check_root
    check_pi
    check_architecture

    update_system
    install_dependencies
    install_nodejs
    install_cloudflared
    create_directories
    install_mediamtx
    install_application
    install_systemd_services
    create_default_config
    configure_firewall

    print_next_steps
}

# Run main function
main "$@"
