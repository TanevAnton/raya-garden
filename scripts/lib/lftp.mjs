// lftp sessions for scripts/deploy-ftp.mjs and scripts/qr-server-config.mjs:
// the FTPS settings SuperHosting needs, and a watchdog around every session.

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// SuperHosting's Pure-FTPd uses a self-signed cert (CN cloud.theadmin.net),
// so strict verification fails — lftp keeps the transfer encrypted but skips
// cert verification.
//
// TLS 1.2, not 1.3: from deploy #91 on (01.10.2026) every upload over TLS 1.3
// was dropped at once — the server answered "451-Error during read from data
// connection" with 0 bytes stored — while listings, which come the other
// way, still worked. A known clash between lftp/GnuTLS and FTP servers on
// TLS 1.3 data connections; 1.2 is still fully encrypted.
export const FTPS = [
  "set ftp:ssl-force true",
  "set ftp:ssl-protect-data true",
  "set ssl:verify-certificate no",
  'set ssl:priority "NORMAL:-VERS-TLS1.3"',
];

// Printed by lftp once the last command of a session has succeeded.
const MARK = "::lftp-finished::";

// Deploy #95 sent all 65 files of step 2, ran its last command — and lftp
// never exited: 53 minutes later the run was cancelled, the site still on the
// old index.html. Closing an FTPS connection can wait forever on the
// server's goodbye. So once lftp prints MARK it gets a few seconds to leave,
// then is stopped: nothing is left for it to do. A session that runs past its
// time limit is stopped as well; its unfinished work shows up in the next
// listing like any failed transfer.
const WATCHDOG = `
out=$1 limit=$2 mark=$3
lftp -c "$LFTP_SCRIPT" >"$out" &
pid=$!
while kill -0 "$pid" 2>/dev/null; do
  if grep -qF -- "$mark" "$out" 2>/dev/null; then
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.3; done
    kill -0 "$pid" 2>/dev/null && echo "   (lftp finished but did not exit — stopped it)" >&2
    kill -9 "$pid" 2>/dev/null
    break
  fi
  if [ "$SECONDS" -ge "$limit" ]; then
    echo "   lftp still busy after \${limit}s — stopped it; the listing shows what got through" >&2
    kill -9 "$pid" 2>/dev/null
    break
  fi
  sleep 0.2
done
wait "$pid" 2>/dev/null
exit 0
`;

/** Seconds a session may run: generous, for a slow line and lftp's own retries. */
export const allow = (bytes = 0, files = 1) => Math.ceil(120 + 10 * files + bytes / 25000);
export const bytesOf = (files) => files.reduce((sum, f) => sum + (statSync(f, { throwIfNoEntry: false })?.size || 0), 0);

/**
 * Sessions against one server. `settings` are lftp `set` commands (joined
 * with "; "), `work` a private temporary directory. LFTP_EXTRA from the
 * environment is appended to the settings — for tests against a local plain
 * FTP server; empty in CI. `quiet` hides lftp's own error messages.
 */
export function lftpSessions({ server, user, password, settings, work, quiet = false }) {
  /**
   * Run lftp commands in one session. Returns { out, ok }: what `echo`
   * printed, and whether the last command ran and succeeded (MARK, appended
   * to it with &&, was printed). `out` holds whatever was printed even when
   * not ok. Only echo lines are reliable here: lftp holds other commands'
   * stdout back until it exits, and prints echo straight away — MARK can land
   * in the middle of a listing. Read a command's output with `read` instead.
   */
  function run(commands, limit = allow()) {
    const file = path.join(work, "cmds.lftp");
    const outFile = path.join(work, "out.txt");
    const lines = [...commands];
    lines[lines.length - 1] += ` && echo "${MARK}"`;
    writeFileSync(file, lines.join("\n") + "\n");
    rmSync(outFile, { force: true });
    try {
      execFileSync("bash", ["-c", WATCHDOG, "watchdog", outFile, String(limit), MARK], {
        // The script, password included, goes by environment, not by argv.
        env: { ...process.env, LFTP_SCRIPT: `${settings}; ${process.env.LFTP_EXTRA || ""}; open -u "${user}","${password}" "${server}"; source "${file}"` },
        stdio: ["ignore", "inherit", quiet ? "ignore" : "inherit"],
      });
    } catch {
      // the watchdog itself always exits 0; nothing to add
    }
    let out = "";
    try {
      out = readFileSync(outFile, "utf8");
    } catch {
      out = "";
    }
    return { out: out.split(`${MARK}\n`).join(""), ok: out.includes(MARK) };
  }

  /** Run lftp commands in one session: true if the last one succeeded. */
  const ok = (commands, limit) => run(commands, limit).ok;

  /**
   * One command's output (a listing, a remote file), or null if it failed.
   * lftp writes it to a local file, which is whole by the time MARK is
   * printed — its stdout would not be, and an lftp that never exits takes the
   * held-back end of it along (tried: the listing was cut mid-line).
   */
  function read(command, limit) {
    const file = path.join(work, "read.txt");
    rmSync(file, { force: true });
    if (!ok([`${command} > "${file}"`], limit)) return null;
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }

  return { run, ok, read };
}
