#!/usr/bin/env bash
# Installs the fiscal bridge as a service on Linux (Raspberry Pi OS, Ubuntu,
# Debian): it starts when the computer starts and restarts if it stops.
#
#   sudo ./install-linux.sh
#
# Asks for the settings (the key is not shown while typed), writes config.json
# (readable only by the user it runs as), runs the bridge's check, and
# installs the systemd service raya-fiscal-bridge. Run it again to change the
# settings: the old config.json is kept unless you type new values.
#
# ErpNet.FP must already be installed and see the printer:
# https://github.com/erpnet/ErpNet.FP/releases — see README.md.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run it with sudo: sudo $0" >&2
  exit 1
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_AS="${SUDO_USER:-root}"
SERVICE=raya-fiscal-bridge
CONFIG="$DIR/config.json"

# Node.js 18 or newer
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "Node.js is not installed. On Raspberry Pi OS / Debian:" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs" >&2
  exit 1
fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if (( MAJOR < 18 )); then
  echo "Node.js $("$NODE" -v) is too old: 18 or newer is needed." >&2
  exit 1
fi
echo "Node.js $("$NODE" -v): ok"

# The settings
current() { [[ -f "$CONFIG" ]] && "$NODE" -p "(JSON.parse(require('fs').readFileSync('$CONFIG','utf8'))['$1'] || '')" 2>/dev/null || true; }
ask() { # name, question, default
  local value
  read -r -p "$2 [$3]: " value
  echo "${value:-$3}"
}
SERVER="$(ask RAYA_SERVER "The site" "$(current RAYA_SERVER || true)")"
SERVER="${SERVER:-https://rayagarden.bg}"
ERPNET="$(ask ERPNET_URL "ErpNet.FP" "$(current ERPNET_URL || true)")"
ERPNET="${ERPNET:-http://localhost:8001}"
PRINTER="$(ask PRINTER_ID "Printer id (empty: the first one ErpNet.FP finds)" "$(current PRINTER_ID || true)")"
OLD_KEY="$(current RAYA_BRIDGE_KEY || true)"
read -r -s -p "The bridge's key (QR_FISCAL_BRIDGE_TOKEN)${OLD_KEY:+ [keep the current one: Enter]}: " KEY
echo
KEY="${KEY:-$OLD_KEY}"
if (( ${#KEY} < 32 )); then
  echo "The key must be at least 32 characters (the same as QR_FISCAL_BRIDGE_TOKEN in GitHub)." >&2
  exit 1
fi

umask 077
RAYA_SERVER="$SERVER" ERPNET_URL="$ERPNET" PRINTER_ID="$PRINTER" RAYA_BRIDGE_KEY="$KEY" "$NODE" -e '
  const c = { RAYA_SERVER: process.env.RAYA_SERVER, RAYA_BRIDGE_KEY: process.env.RAYA_BRIDGE_KEY,
              ERPNET_URL: process.env.ERPNET_URL, PRINTER_ID: process.env.PRINTER_ID };
  require("fs").writeFileSync(process.argv[1], JSON.stringify(c, null, 2) + "\n");' "$CONFIG"
chown "$RUN_AS" "$CONFIG"
chmod 600 "$CONFIG"
echo "config.json written (readable by $RUN_AS only)"

# The check
echo
echo "Checking ErpNet.FP, the printer and the site:"
if ! sudo -u "$RUN_AS" "$NODE" "$DIR/bridge.mjs" --check; then
  echo
  echo "Something above is not right yet. The service is installed anyway and keeps trying;"
  echo "fix it, then: sudo systemctl restart $SERVICE"
fi

# The service
cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=RAYA Garden fiscal bridge (QR menu receipts → ErpNet.FP)
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_AS
WorkingDirectory=$DIR
ExecStart=$NODE $DIR/bridge.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now "$SERVICE"
sleep 2
echo
systemctl --no-pager --lines=5 status "$SERVICE" || true
echo
echo "Done. The bridge runs as the service $SERVICE."
echo "  its log:   journalctl -u $SERVICE -f"
echo "  restart:   sudo systemctl restart $SERVICE"
echo "  check:     node $DIR/bridge.mjs --check"
