#!/usr/bin/env bash
# Sets up the restaurant's mini PC (Ubuntu 24.04) for the fiscal printer, after
# a clean install: updates, never sleeps, Node.js 22, and ErpNet.FP as a
# service that talks to the Datecs FP-700MX over the network. The bridge
# itself is installed later, on the day the till goes live (install-linux.sh).
#
#   sudo ./setup-mini-pc.sh [printer-ip]      default 192.168.0.175
#
# Safe to run again. See docs/qr-ordering/MINI-PC-SETUP-BG.md.
set -euo pipefail

PRINTER_IP="${1:-192.168.0.175}"
ERPNET_VERSION=v1.1.0.1694
ERPNET_DIR=/opt/erpnet-fp
RUN_AS="${SUDO_USER:-raya}"

if [[ $EUID -ne 0 ]]; then echo "Run it with sudo: sudo $0" >&2; exit 1; fi
step() { echo; echo "== $*"; }

step "Updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get full-upgrade -y -q
apt-get install -y -q curl unzip ca-certificates

step "Never sleep"
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
# GNOME's own automatic suspend, for the desktop user
sudo -u "$RUN_AS" dbus-launch gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing' 2>/dev/null || true

step "Clock"
timedatectl set-timezone Europe/Sofia
timedatectl set-ntp true
timedatectl | grep -E "Time zone|synchronized"

step "Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node -v

step "ErpNet.FP $ERPNET_VERSION"
if [[ ! -x "$ERPNET_DIR/ErpNet.FP.Server" ]]; then
  tmp="$(mktemp -d)"
  curl -fL -o "$tmp/linux-x64.zip" "https://github.com/erpnet/ErpNet.FP/releases/download/$ERPNET_VERSION/linux-x64.zip"
  mkdir -p "$ERPNET_DIR"
  unzip -o -q "$tmp/linux-x64.zip" -d "$ERPNET_DIR"
  rm -rf "$tmp"
fi
chmod +x "$ERPNET_DIR/ErpNet.FP.Server"
cat > "$ERPNET_DIR/appsettings.json" <<EOF
{
  "ErpNet.FP": {
    "AutoDetect": false,
    "Printers": {
      "dt055322": { "Id": "dt055322", "Uri": "bg.dt.x.isl.tcp://$PRINTER_IP:4999" }
    },
    "PrintersProperties": {
      "DA055322": {
        "PaymentTypeMappings": {},
        "PrinterConstants": {},
        "PrinterOptions": { "supportPaymentTerminal": "True", "usePaymentTerminal": "False" }
      }
    },
    "UdpBeaconPort": 8001,
    "ExcludePortList": "",
    "DetectionTimeout": 30,
    "WebAccess": { "AllowedOrigins": [], "EnablePrivateNetwork": false }
  },
  "Kestrel": { "EndPoints": { "Http": { "Url": "http://127.0.0.1:8001" } } }
}
EOF
chown -R "$RUN_AS:$RUN_AS" "$ERPNET_DIR"

cat > /etc/systemd/system/erpnet-fp.service <<EOF
[Unit]
Description=ErpNet.FP (fiscal printer server)
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_AS
WorkingDirectory=$ERPNET_DIR
ExecStart=$ERPNET_DIR/ErpNet.FP.Server
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable erpnet-fp
systemctl restart erpnet-fp

step "The printer"
if ping -c 2 -W 2 "$PRINTER_IP" >/dev/null; then echo "$PRINTER_IP answers"; else echo "$PRINTER_IP does not answer: is the printer on, with its cable?"; fi
sleep 15
echo "ErpNet.FP sees: $(curl -s http://127.0.0.1:8001/printers || echo 'nothing yet')"

echo
echo "Done. ErpNet.FP runs as the service erpnet-fp (log: journalctl -u erpnet-fp -f)."
echo "A restart now applies the updates: sudo reboot"
