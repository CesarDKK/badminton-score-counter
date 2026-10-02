#!/bin/bash
# Kører inde i Raspberry Pi OS-billedet (chroot) under bygget af Pi-udgaven.
# Svarer til PC-udgavens live/config/hooks/normal/9000-badminton-tv.hook.chroot
# — ret begge, hvis noget fælles ændres.

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive LC_ALL=C.UTF-8

apt-get update -q

# --no-install-recommends som på PC'en: kun det der bruges. Raspberry Pi OS
# Lite har allerede NetworkManager, WiFi-firmware, timesyncd og zram-swap.
PAKKER=(
    cage chromium wlr-randr wlrctl
    libgl1-mesa-dri libegl-mesa0
    fonts-dejavu-core fonts-liberation2 fonts-noto-color-emoji
    jq kbd console-setup-linux
    v4l-utils iw rfkill wireless-regdb pciutils usbutils
    unattended-upgrades
)
# Raspberry Pi's Chromium-tilpasninger (hardware-videoafkodning m.m.), hvis
# arkivet har dem.
apt-cache show rpi-chromium-mods >/dev/null 2>&1 && PAKKER+=(rpi-chromium-mods)
apt-get install -y -q --no-install-recommends "${PAKKER[@]}"
apt-get clean
rm -rf /var/lib/apt/lists/*

# Bruger der kører browseren. Ingen adgangskode: kontoen kan ikke logges ind på.
if ! id tv >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash --comment "Badminton TV" tv
fi
passwd -l tv
for g in video render input audio; do
    getent group "$g" >/dev/null && usermod -aG "$g" tv
done

# Dansk tid og sprog. Tidszonen er vigtig: SLUK_KL er dansk tid.
ln -sf /usr/share/zoneinfo/Europe/Copenhagen /etc/localtime
echo Europe/Copenhagen > /etc/timezone
sed -i 's/^# *da_DK.UTF-8/da_DK.UTF-8/' /etc/locale.gen
locale-gen
printf 'LANG=da_DK.UTF-8\n' > /etc/default/locale

chmod 755 /usr/lib/badminton-tv/setup /usr/lib/badminton-tv/browser \
          /usr/lib/badminton-tv/cec /usr/lib/badminton-tv/sluk \
          /usr/lib/badminton-tv/netstatus /usr/lib/badminton-tv/diagnose \
          /usr/lib/systemd/system-generators/badminton-tv-sluk-generator
chmod 644 /usr/lib/badminton-tv/conf.sh

systemctl enable badminton-tv-setup.service badminton-tv-cec.service \
                 badminton-tv.service badminton-tv-netstatus.service \
                 badminton-tv-diagnose.service
systemctl enable NetworkManager.service systemd-timesyncd.service
systemctl set-default multi-user.target

# Aldrig dvale.
systemctl mask sleep.target suspend.target hibernate.target \
               hybrid-sleep.target suspend-then-hibernate.target

# Opdateringer kun ved automatisk slukning, ikke på tilfældige tidspunkter.
systemctl mask apt-daily.timer apt-daily-upgrade.timer

# ── Raspberry Pi OS' førstegangsopsætning ──────────────────
# userconfig spørger efter brugernavn på skærmen ved første opstart, og
# systemd-firstboot kan spørge efter sprog og tidszone — begge ville stå og
# vente foran TV-billedet. cloud-init læser Raspberry Pi Imagers egne
# indstillinger; her er det kiosk.conf alene, der bestemmer.
systemctl disable userconfig.service 2>/dev/null || true
systemctl mask userconfig.service systemd-firstboot.service
touch /etc/cloud/cloud-init.disabled
