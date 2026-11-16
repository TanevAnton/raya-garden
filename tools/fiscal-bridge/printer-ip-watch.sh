#!/usr/bin/env bash
# Keeps ErpNet.FP pointed at the fiscal printer if the router gives the printer
# a new address. The printer is found by its MAC address; only ping and the ARP
# table are used, never the printer's own port, so a receipt being printed is
# never disturbed. Runs as the normal user (no sudo), from cron every 5 minutes:
#
#   */5 * * * * /opt/erpnet-fp/printer-ip-watch.sh
#
# Log: journalctl -t printer-ip-watch
set -uo pipefail

MAC="${PRINTER_MAC:-68:aa:d2:2f:49:7f}"
SETTINGS="${ERPNET_SETTINGS:-/opt/erpnet-fp/appsettings.json}"
log() { logger -t printer-ip-watch "$*"; echo "$*"; }

current="$(grep -oE 'tcp://[0-9.]+' "$SETTINGS" | head -1 | cut -c7-)"
[[ -n "$current" ]] || { log "no printer address in $SETTINGS"; exit 1; }

is_printer() { # the address answers and the answer comes from the printer's MAC
  ping -c 1 -W 1 "$1" >/dev/null 2>&1 && ip neigh show "$1" | grep -qi "$MAC"
}
is_printer "$current" && exit 0

# Not there: ask every address on our network once, then look the MAC up.
net="$(ip -4 route show default | awk '{print $5; exit}')"
prefix="$(ip -4 -o addr show dev "$net" | awk '{print $4}' | head -1 | cut -d. -f1-3)"
[[ -n "$prefix" ]] || exit 0
for i in $(seq 1 254); do ping -c 1 -W 1 "$prefix.$i" >/dev/null 2>&1 & done
wait
found="$(ip neigh | grep -i "$MAC" | grep -E 'REACHABLE|DELAY' | awk '{print $1}' | head -1)"

if [[ -z "$found" ]]; then exit 0; fi   # printer switched off: nothing to do
if [[ "$found" == "$current" ]]; then exit 0; fi

sed -i "s#tcp://$current:#tcp://$found:#" "$SETTINGS"
log "the printer moved from $current to $found: ErpNet.FP restarted with the new address"
pkill -x ErpNet.FP.Serve || true   # systemd starts it again within 5 seconds
