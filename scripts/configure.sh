#!/usr/bin/env bash
# Creates .env and ring-mqtt/config.json with random secrets. Safe to re-run: never overwrites.
set -euo pipefail
cd "$(dirname "$0")/.."

rand() { od -An -tx1 -N "$1" /dev/urandom | tr -d ' \n'; }

ip=$(hostname -I 2>/dev/null | awk '{print $1}')
pass=$(rand 24)

if [[ ! -f .env ]]; then
  cp .env.example .env
  sed -i \
    -e "s|^LIVESTREAM_PASS=.*|LIVESTREAM_PASS=${pass}|" \
    -e "s|^NTFY_TOPIC=.*|NTFY_TOPIC=doorbell-$(rand 20)|" \
    -e "s|^WEB_BASE_URL=.*|WEB_BASE_URL=http://${ip:-192.168.2.50}:8080|" \
    .env
  echo "Created .env"
else
  echo ".env already exists, leaving it alone"
  pass=$(grep '^LIVESTREAM_PASS=' .env | cut -d= -f2-)
fi

mkdir -p ring-mqtt
if [[ ! -f ring-mqtt/config.json ]]; then
  cat > ring-mqtt/config.json <<EOF
{
  "mqtt_url": "mqtt://mosquitto:1883",
  "mqtt_options": "",
  "livestream_user": "doorbell",
  "livestream_pass": "${pass}",
  "disarm_code": "",
  "enable_cameras": true,
  "enable_modes": false,
  "enable_panic": false,
  "hass_topic": "homeassistant/status",
  "ring_topic": "ring",
  "location_ids": []
}
EOF
  echo "Created ring-mqtt/config.json"
fi

echo
echo "Your ntfy topic (subscribe to this in the ntfy phone app):"
grep '^NTFY_TOPIC=' .env | cut -d= -f2-
