#!/bin/bash
# Raspberry Pi Badminton App Startup Script

set -e

echo "========================================"
echo "Badminton Counter - Raspberry Pi Startup"
echo "========================================"
echo ""

# Check if running on ARM architecture
ARCH=$(uname -m)
if [[ "$ARCH" != "aarch64" && "$ARCH" != "armv7l" && "$ARCH" != "arm64" ]]; then
    echo "WARNING: This doesn't appear to be an ARM system."
    echo "Detected architecture: $ARCH"
    echo "This script is optimized for Raspberry Pi (ARM)."
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is not installed."
    echo "Please install Docker first:"
    echo "  curl -fsSL https://get.docker.com -o get-docker.sh"
    echo "  sudo sh get-docker.sh"
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "ERROR: docker-compose is not installed."
    echo "Please install docker-compose first:"
    echo "  sudo apt install -y docker-compose"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "WARNING: .env file not found."
    if [ -f .env.example ]; then
        echo "Creating .env from .env.example..."
        cp .env.example .env
        echo ""
        echo "IMPORTANT: Edit .env and set secure passwords!"
        echo "  nano .env"
        echo ""
        read -p "Press Enter after you've configured .env, or Ctrl+C to exit..."
    else
        echo "ERROR: .env.example not found. Cannot create .env file."
        exit 1
    fi
fi

# Display system info
echo "System Information:"
echo "  Architecture: $ARCH"
echo "  OS: $(cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2)"
echo "  Memory: $(free -h | awk '/^Mem:/ {print $2}')"
echo "  Disk Space: $(df -h / | awk 'NR==2 {print $4}') free"
echo ""

# Check available memory
AVAILABLE_MEM=$(free -m | awk '/^Mem:/ {print $7}')
if [ "$AVAILABLE_MEM" -lt 512 ]; then
    echo "WARNING: Low available memory (${AVAILABLE_MEM}MB)"
    echo "Consider closing other applications or increasing swap space."
    echo ""
fi

# Check CPU temperature (Raspberry Pi specific)
if command -v vcgencmd &> /dev/null; then
    TEMP=$(vcgencmd measure_temp | cut -d'=' -f2 | cut -d"'" -f1)
    echo "CPU Temperature: ${TEMP}°C"
    if (( $(echo "$TEMP > 70" | bc -l) )); then
        echo "WARNING: High temperature! Consider adding cooling."
    fi
    echo ""
fi

# Pull latest images (if connected to internet)
echo "Checking for image updates..."
if timeout 5 wget -q --spider http://google.com; then
    docker-compose -f docker-compose.rpi.yml pull || echo "Could not pull updates (continuing with local images)"
else
    echo "No internet connection, using local images"
fi
echo ""

# Start the application
echo "Starting Badminton Counter App..."
echo "This may take 10-20 minutes on first run while building images..."
echo ""

docker-compose -f docker-compose.rpi.yml up -d

echo ""
echo "========================================"
echo "Application is starting!"
echo "========================================"
echo ""
echo "Monitor startup progress:"
echo "  docker-compose -f docker-compose.rpi.yml logs -f"
echo ""
echo "Check status:"
echo "  docker-compose -f docker-compose.rpi.yml ps"
echo ""
echo "Once started, access at:"
echo "  http://localhost:8080"
echo ""

# Try to get IP address
IP=$(hostname -I | awk '{print $1}')
if [ -n "$IP" ]; then
    echo "Or from other devices on your network:"
    echo "  http://${IP}:8080"
    echo ""
fi

echo "To stop: ./stop-rpi.sh"
echo "========================================"
