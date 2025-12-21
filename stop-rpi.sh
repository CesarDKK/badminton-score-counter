#!/bin/bash
# Raspberry Pi Badminton App Stop Script

set -e

echo "========================================"
echo "Stopping Badminton Counter App..."
echo "========================================"
echo ""

# Stop the containers
docker-compose -f docker-compose.rpi.yml down

echo ""
echo "Application stopped successfully!"
echo ""
echo "To start again: ./start-rpi.sh"
echo ""
echo "To remove all data (careful!):"
echo "  docker-compose -f docker-compose.rpi.yml down -v"
echo "========================================"
