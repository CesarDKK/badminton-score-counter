#!/bin/sh

# Start dbus
mkdir -p /var/run/dbus
dbus-daemon --system

# Start Avahi daemon
avahi-daemon --no-chroot
