#!/usr/bin/env bash
# Upload dist/ to SuperHosting over FTPS so that visitors never get a
# half-deployed site. Run by .github/workflows/deploy.yml.
#
# Why the order matters. index.html names the build's JS and CSS by hash,
# and the moment a new index.html is live every visitor asks for the new
# files. A single `mirror` uploads top-level files first, so index.html went
# up minutes before assets/: during deploy #80 and #81 the page asked for
# chunks that were not on the server yet, Apache's SPA fallback answered with
# index.html, and /events stayed blank for 4½ and 6 minutes. Ads run around
# the clock, so every deploy blanked the landing page.
#
# So, in four steps, each run only if the one before succeeded:
#
#   1. assets/     The new chunks go up next to the old ones. Nothing is
#                  deleted, so the live (old) index.html keeps working. Then
#                  every new file is checked on the server, by size, before
#                  anything points at it.
#   2. the rest    Images, api/, .htaccess, sitemap.xml, the bot snapshots —
#                  everything except assets/ and index.html, with stale files
#                  removed as before.
#   3. index.html  Last: one small file, and the switch to the new build.
#   4. prune       Delete chunks that belong to neither this build nor the
#                  previous one. The previous build's chunks stay until the
#                  next deploy, so a tab opened before this one can still load
#                  the page it navigates to next. Each deploy leaves its chunk
#                  list in assets/.deployed for the next one to read; without
#                  it (the first run) nothing is pruned.
#
# FTPS: SuperHosting's Pure-FTPd uses a self-signed cert (CN
# cloud.theadmin.net), so strict verification fails — lftp keeps the transfer
# encrypted but skips cert verification.
#
# Serial, with generous retries: parallel transfers had a data channel die
# mid-file (the same file twice, while 1.8 MB PNGs went through in the same
# run), which leaves mirror having deleted the old copy and failed to replace
# it.
#
# error_log is never touched: PHP writes it into api/ when a request fatals,
# and it is the only record of what went wrong. Deleting it on every deploy
# threw away the evidence exactly when it was needed.
#
# One lftp command per call: `set cmd:fail-exit` hangs lftp 4.9 after a
# failed command, so bash's -e does the stopping instead.
#
# LFTP_EXTRA is appended to the settings — for testing against a local plain
# FTP server; empty in CI.

set -euo pipefail
export LC_ALL=C # one sort order for comm, locally and remotely

: "${FTP_SERVER:?}" "${FTP_USERNAME:?}" "${FTP_PASSWORD:?}"
SRC="${SRC:-dist}"
DIR="${FTP_DIR:-rayagarden.bg/}"
DIR="${DIR%/}"
MANIFEST=.deployed

ftp() {
  lftp -c "set ftp:ssl-force true; set ftp:ssl-protect-data true; set ssl:verify-certificate no; set net:timeout 40; set net:max-retries 6; set net:reconnect-interval-base 5; set net:persist-retries 3; ${LFTP_EXTRA:-}; open -u \"$FTP_USERNAME\",\"$FTP_PASSWORD\" \"$FTP_SERVER\"; $1"
}

# "<name> <size>" per file in the remote assets/, directories left out.
remote_assets() {
  ftp "cls -1a --basename -s --block-size=1 \"$DIR/assets/\"" | awk '$2 !~ /\/$/ { print $2, $1 }' | sort
}

test -s "$SRC/index.html" && test -d "$SRC/assets" || { echo "no $SRC/index.html or $SRC/assets" >&2; exit 1; }
local_assets=$(cd "$SRC/assets" && find . -maxdepth 1 -type f -printf '%f %s\n' | sort)

echo "── 1/4 assets/ ($(wc -l <<<"$local_assets") files), nothing deleted"
# --ignore-time: names are content hashes, so a file already there with the
# same name and size is the same file. Re-sending it would rewrite a chunk
# the live page is using, for nothing.
ftp "mkdir -p -f \"$DIR/assets\""
ftp "mirror -R --ignore-time --verbose \"$SRC/assets/\" \"$DIR/assets/\""

missing=$(comm -23 <(echo "$local_assets") <(remote_assets))
if [ -n "$missing" ]; then
  echo "Not on the server, or the wrong size, after upload — index.html NOT switched:" >&2
  echo "$missing" >&2
  exit 1
fi
echo "   all $(wc -l <<<"$local_assets") present at the right size"

echo "── 2/4 everything except assets/ and index.html"
ftp "mirror -R --delete --verbose --exclude-glob .git* --exclude-glob error_log --exclude ^assets/ --exclude ^index\\.html\$ \"$SRC/\" \"$DIR\""

echo "── 3/4 index.html"
ftp "put \"$SRC/index.html\" -o \"$DIR/index.html\""

echo "── 4/4 prune assets/"
current=$(cut -d' ' -f1 <<<"$local_assets")
previous=$(ftp "cat \"$DIR/assets/$MANIFEST\"" 2>/dev/null) || previous=""
if [ -n "$previous" ]; then
  keep=$(printf '%s\n%s\n%s\n' "$current" "$previous" "$MANIFEST" | sort -u)
  stale=$(remote_assets | cut -d' ' -f1 | comm -23 - <(echo "$keep") | grep -E '^[A-Za-z0-9._-]+$' | grep -vE '^\.+$' || true)
  if [ -n "$stale" ]; then
    echo "   removing $(wc -l <<<"$stale") from builds before the previous one"
    ftp "rm -f $(sed "s|^|\"$DIR/assets/|; s|$|\"|" <<<"$stale" | tr '\n' ' ')"
  else
    echo "   nothing older than the previous build"
  fi
else
  echo "   no $MANIFEST from an earlier deploy — keeping everything this time"
fi
tmp=$(mktemp)
echo "$current" >"$tmp"
ftp "put \"$tmp\" -o \"$DIR/assets/$MANIFEST\""
rm -f "$tmp"
echo "── done"
