# Raspberry Pi Image Specification

## Hardware Requirements

### Minimum Specification

| Component | Requirement | Notes |
|-----------|-------------|-------|
| **Model** | Raspberry Pi 3B+ | ARM64 Cortex-A53 |
| **RAM** | 1GB | Sufficient for basic operation |
| **Storage** | 8GB SD Card | Class 10 or better |
| **Network** | WiFi or Ethernet | WiFi included on 3B+ |
| **Power** | 5V 2.5A | Official PSU recommended |

### Recommended Specification

| Component | Requirement | Notes |
|-----------|-------------|-------|
| **Model** | Raspberry Pi 4 Model B | Better CPU, USB 3.0, Gigabit Ethernet |
| **RAM** | 2GB or 4GB | Headroom for video transcoding |
| **Storage** | 32GB SD Card | A2 rated for better random I/O |
| **Network** | Gigabit Ethernet | More stable than WiFi for video |
| **Power** | 5V 3A USB-C | Official Pi 4 PSU |
| **Case** | Passive/Active cooling | Prevents thermal throttling |

### Model Comparison

| Feature | Pi 3B+ | Pi 4 (2GB) | Pi 4 (4GB) | Pi Zero 2W |
|---------|--------|------------|------------|------------|
| CPU | 1.4GHz Quad | 1.5GHz Quad | 1.5GHz Quad | 1GHz Quad |
| RAM | 1GB | 2GB | 4GB | 512MB |
| Ethernet | 300Mbps | 1Gbps | 1Gbps | None |
| WiFi | 2.4/5GHz | 2.4/5GHz | 2.4/5GHz | 2.4/5GHz |
| USB | 2.0 | 3.0 + 2.0 | 3.0 + 2.0 | Micro USB |
| Power | 2.5A | 3A | 3A | 2A |
| **Suitable** | Yes | Recommended | Overkill | Not recommended |
| **Price** | ~$35 | ~$45 | ~$55 | ~$15 |

## Software Requirements

### Operating System

**Raspberry Pi OS Lite (64-bit)**
- Version: Bookworm (Debian 12) or newer
- Architecture: ARM64 (aarch64)
- Desktop: None (headless)
- Download: https://www.raspberrypi.com/software/operating-systems/

```
Image: 2024-xx-xx-raspios-bookworm-arm64-lite.img.xz
Size: ~400MB compressed, ~2GB uncompressed
```

### Required Packages

| Package | Version | Purpose | Install Size |
|---------|---------|---------|--------------|
| nodejs | 18.x LTS | Application runtime | ~70MB |
| npm | 9.x+ | Package manager | Included |
| curl | Any | HTTP client | ~400KB |
| git | Any | Version control (optional) | ~40MB |

### Application Components

| Component | Version | Size | Source |
|-----------|---------|------|--------|
| cloudflared | Latest | ~30MB | Cloudflare releases |
| MediaMTX | Latest | ~15MB | Included in repo |
| PTZ Controller | Latest | ~5MB | This repository |
| Node modules | - | ~50MB | npm install |

## Memory Budget

### Runtime Memory Usage

| Process | Typical | Peak | Notes |
|---------|---------|------|-------|
| Linux kernel + OS | 150MB | 200MB | Headless, minimal services |
| cloudflared | 20MB | 40MB | Single tunnel |
| Node.js (Express) | 50MB | 100MB | With API load |
| MediaMTX | 30MB | 80MB | During video transcode |
| **Total** | **250MB** | **420MB** | |

### Memory Recommendations

| Pi RAM | Suitability | Notes |
|--------|-------------|-------|
| 512MB | Not suitable | Insufficient headroom |
| 1GB | Adequate | ~500MB free for buffers/cache |
| 2GB | Recommended | Comfortable margin |
| 4GB+ | Overkill | Unnecessary for this workload |

## Storage Budget

### Disk Space Usage

| Component | Size | Notes |
|-----------|------|-------|
| Raspberry Pi OS Lite | 2.0GB | Base installation |
| Node.js 18 | 70MB | Runtime |
| cloudflared | 30MB | Tunnel client |
| PTZ Controller app | 5MB | Application code |
| Node modules | 50MB | Dependencies |
| MediaMTX | 15MB | Video transcoder |
| Log rotation (reserved) | 500MB | journald logs |
| **Total** | **~2.7GB** | |

### Storage Recommendations

| SD Card Size | Suitability | Free Space |
|--------------|-------------|------------|
| 8GB | Minimum | ~5GB free |
| 16GB | Comfortable | ~13GB free |
| 32GB | Recommended | ~29GB free (room for logs, recordings) |

### SD Card Specifications

| Rating | Random Read | Random Write | Recommendation |
|--------|-------------|--------------|----------------|
| Class 10 | 10MB/s seq | 10MB/s seq | Minimum |
| UHS-I U1 | 10MB/s | 10MB/s | Acceptable |
| UHS-I U3 | 30MB/s | 30MB/s | Good |
| A1 | 1500 IOPS | 500 IOPS | Better for OS |
| A2 | 4000 IOPS | 2000 IOPS | Best for OS |

**Recommended**: Samsung EVO Plus 32GB (A2 rated) or SanDisk Extreme 32GB

## Network Requirements

### Bandwidth

| Traffic Type | Bandwidth | Direction |
|--------------|-----------|-----------|
| PTZ Control commands | <1 Kbps | Bidirectional |
| Vidiu MQTT | <10 Kbps | Bidirectional |
| WebRTC Video (720p) | 2-4 Mbps | Outbound |
| WebRTC Video (1080p) | 4-8 Mbps | Outbound |
| Tunnel overhead | ~5% | Bidirectional |

### Minimum Internet Speed

| Quality | Upload Speed | Notes |
|---------|--------------|-------|
| 720p | 5 Mbps | Comfortable margin |
| 1080p | 10 Mbps | Recommended |
| Multiple viewers | +2 Mbps each | WebRTC is peer-based through tunnel |

### Firewall Requirements

**Inbound**: None required (all connections are outbound)

**Outbound**:
| Destination | Port | Protocol | Purpose |
|-------------|------|----------|---------|
| Cloudflare | 443 | TCP/HTTPS | Tunnel connection |
| Cloudflare | 7844 | TCP/UDP | QUIC tunnel (optional) |

### Local Network

| Device | Port | Protocol |
|--------|------|----------|
| PTZ Camera | 80 | HTTP |
| PTZ Camera | 5678 | TCP (VISCA) |
| PTZ Camera | 554 | RTSP |
| Vidiu | 80 | HTTP/WebSocket |

## Pre-Built Image Contents

When creating a deployable Pi image, include:

### Installed Software
- Raspberry Pi OS Lite (64-bit)
- Node.js 18 LTS
- cloudflared (latest)
- PTZ Controller application
- All npm dependencies
- systemd service files

### Configuration (Template)
- `/opt/ptz-controller/` - Application directory
- `/etc/cloudflared/config.yml.template` - Tunnel config template
- `/etc/systemd/system/*.service` - Service definitions

### First-Boot Script
Script to run on first boot:
1. Expand filesystem
2. Prompt for site name
3. Configure cloudflared tunnel
4. Set camera/Vidiu IPs
5. Start services

## Image Creation Process

### Method 1: Manual Setup
1. Flash Raspberry Pi OS Lite
2. Boot and run `pi-setup.sh`
3. Configure per-site settings

### Method 2: Pre-Built Image
1. Create golden image with all software
2. Use `pi-gen` or similar to create custom image
3. Flash image to SD card
4. Run first-boot configuration

### Image Distribution
- Compressed image size: ~800MB
- Uncompressed: ~4GB
- Distribution: Direct download or SD card duplication

## Environmental Considerations

### Operating Temperature
| Condition | Pi 3B+ | Pi 4 |
|-----------|--------|------|
| Minimum | 0°C | 0°C |
| Maximum (no throttle) | 70°C | 70°C |
| Throttle temp | 80°C | 80°C |
| Shutdown temp | 85°C | 85°C |

### Recommendations
- Use case with passive heatsink for warm environments
- Active cooling (fan) for enclosed spaces
- Avoid direct sunlight
- Ensure adequate ventilation

### Power
- Use official power supply
- Consider UPS for critical deployments
- Pi 4 is more sensitive to undervoltage than Pi 3
