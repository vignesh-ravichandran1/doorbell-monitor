#!/usr/bin/env bash
# One-time prep of the old laptop (Debian 12 / Ubuntu Server 24.04) as an always-on doorbell box.
#
#   sudo ./scripts/setup-laptop.sh                 # docker + lid/sleep settings
#   sudo ./scripts/setup-laptop.sh /dev/sdb1       # ...and mount that external disk partition at /mnt/doorbell
#
# It never formats anything. It only mounts the partition you name, by UUID, at every boot.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run with sudo"; exit 1; fi
user=${SUDO_USER:-root}

echo "==> Installing Docker"
if ! command -v docker >/dev/null; then
  apt-get update
  apt-get install -y curl ca-certificates
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$user"
systemctl enable --now docker

echo "==> Keep running with the lid closed, never sleep"
mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/doorbell.conf <<EOF
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
EOF
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
systemctl restart systemd-logind || true

echo "==> Turn the screen off after 1 minute (saves power and the old backlight)"
if ! grep -q consoleblank /etc/default/grub 2>/dev/null; then
  sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT="/&consoleblank=60 /' /etc/default/grub
  update-grub || true
fi

if [[ $# -ge 1 ]]; then
  part=$1
  uuid=$(blkid -s UUID -o value "$part")
  fstype=$(blkid -s TYPE -o value "$part")
  [[ -n $uuid ]] || { echo "No filesystem found on $part"; exit 1; }
  [[ $fstype == ntfs ]] && fstype=ntfs3
  echo "==> Mounting $part ($fstype, UUID=$uuid) at /mnt/doorbell"
  mkdir -p /mnt/doorbell
  if ! grep -q "$uuid" /etc/fstab; then
    opts="defaults,nofail,x-systemd.device-timeout=10"
    case $fstype in
      ntfs3|exfat|vfat) opts="$opts,uid=0,gid=0,umask=000" ;;
    esac
    echo "UUID=$uuid /mnt/doorbell $fstype $opts 0 0" >> /etc/fstab
  fi
  systemctl daemon-reload
  mount /mnt/doorbell || mount -a
  df -h /mnt/doorbell
fi

echo
echo "Done. Log out and back in (for docker group), then run: ./scripts/configure.sh && docker compose up -d"
