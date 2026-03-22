#!/bin/sh
set -e

# Clean up any stale PID files
rm -f /var/run/dbus/dbus.pid /var/run/dbus/system_bus_socket
rm -f /var/run/avahi-daemon/pid

# Ensure directories exist
mkdir -p /var/run/dbus
mkdir -p /var/run/avahi-daemon

# Start dbus daemon
echo "Starting D-Bus daemon..."
dbus-daemon --system --nofork &
DBUS_PID=$!

# Wait for D-Bus to be ready
echo "Waiting for D-Bus..."
for i in $(seq 1 15); do
    if [ -S /var/run/dbus/system_bus_socket ]; then
        echo "D-Bus ready after ${i}s"
        break
    fi
    sleep 1
done
if ! kill -0 $DBUS_PID 2>/dev/null; then
    echo "ERROR: D-Bus daemon failed to start"
    exit 1
fi

# Start Avahi daemon in foreground
echo "Starting Avahi daemon..."
exec avahi-daemon --no-chroot --no-drop-root
