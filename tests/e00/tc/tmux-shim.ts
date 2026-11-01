/**
 * tests/e00/tc/tmux-shim.ts — test-owned `tmux` on PATH for the TC tier (F5/F8).
 *
 * The packaged backend runs `tmux` through PATH (scripts/lib/host/tmux-backend.ts),
 * so a shim placed first on PATH reaches every call with no production test mode.
 * The shim:
 *   - pins each call to an isolated server on a root-local socket (`-S`, `-f /dev/null`)
 *     and unsets TMUX/TMUX_PANE, so no operator session is ever touched;
 *   - holds `kill-pane`, and the E00-L identity-bound `if-shell` kill, while
 *     <root>/.tc-tmux/hold-kill-pane exists, after writing kill-pane-arrived (a
 *     test can replace the server at the action). The runtime kills the worker pane BEFORE sealTerminalAttempt
 *     writes and publishes the terminal record (task-cell-runtime.ts terminate), so
 *     this is a deterministic barrier between final.json and terminal publication;
 *   - logs only the subcommand name, never arguments;
 *   - writes the ledger <root>/.tc-tmux/identities.tsv: a `start` record BEFORE any
 *     potentially server-starting call runs (if that write, or the calls.log write,
 *     fails the shim exits 125 without invoking tmux), then `server` when that call brought
 *     up a server that was not answering before it, or `reuse` when the same server
 *     answered before and after; after each successful call, `pane` identities
 *     tagged with the server that answered. Teardown (readTmuxLedger) owns only
 *     servers captured by their start call and panes under them, so a later query
 *     never adopts a replacement server and an uncaptured start stays unknown.
 * The server is registered with teardownOwned, which closes and confirms it.
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { ownTmuxServer } from "../support/e00-harness";

export interface TmuxShim {
  realTmux: string;
  socket: string;
  dir: string;
  holdFile: string;
  arrivedFile: string;
  callsLog: string;
  identities: string;
  /** Test-only fault: while this file exists the shim records starts but captures no identity. */
  failCapture: string;
  /**
   * Test-only fault: while this file exists, new-session/new-window run for real but
   * their printed -F output has its leading "%" rewritten, so the controller sees an
   * unparseable identity for a pane that really exists (an unknown spawn).
   */
  malformCreate: string;
  /**
   * Test-only fault: while this file exists, `list-panes` runs for real but every output
   * line containing the file's text (a pane title) is dropped, so a captured pane is
   * missing from the creating command's enumeration.
   */
  dropPaneTitle: string;
}

export function resolveRealTmux(): string | null {
  const r = spawnSync("/bin/sh", ["-c", "command -v tmux"], { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" } });
  const p = (r.stdout ?? "").trim();
  return r.status === 0 && path.isAbsolute(p) ? p : null;
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function installTmuxShim(root: string, bin: string): TmuxShim {
  const realTmux = resolveRealTmux();
  if (!realTmux) throw new Error("tmux not found on PATH");
  const dir = path.join(root, ".tc-tmux");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const shim: TmuxShim = {
    realTmux, dir,
    socket: path.join(dir, "sock"),
    holdFile: path.join(dir, "hold-kill-pane"),
    arrivedFile: path.join(dir, "kill-pane-arrived"),
    callsLog: path.join(dir, "calls.log"),
    identities: path.join(dir, "identities.tsv"),
    failCapture: path.join(dir, "fail-capture"),
    malformCreate: path.join(dir, "malform-create"),
    dropPaneTitle: path.join(dir, "drop-pane-title"),
  };
  if (Buffer.byteLength(shim.socket) > 100) throw new Error("tmux socket path too long for this root");
  if (/\s/.test(shim.socket)) throw new Error("tmux socket path must not contain whitespace (exact argv matching)");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "tmux"), [
    "#!/bin/sh",
    // Fail closed: no tmux runs unless the call (and, below, its start record) is on disk.
    `printf '%s\\n' "$1" >> ${q(shim.callsLog)} || { echo "tmux-shim: calls log write failed; not launching" >&2; exit 125; }`,
    // Hold the legacy kill-pane and the E00-L identity-bound kill (`if-shell -F -t <pane> <cond> 'kill-pane ...'`).
    `if { [ "$1" = "kill-pane" ] || [ "$1" = "if-shell" ]; } && [ -e ${q(shim.holdFile)} ]; then`,
    `  : > ${q(shim.arrivedFile)}`,
    `  while [ -e ${q(shim.holdFile)} ]; do sleep 0.05; done`,
    "fi",
    "unset TMUX TMUX_PANE",
    // LC_ALL=C applies to the shim's own ps reads only: under the C locale tmux rewrites a tab in -F output to "_".
    // srv: "<pid>\t<lstart>" of the server answering on the socket, or failure.
    `srv() { p=$(${q(realTmux)} -S ${q(shim.socket)} list-sessions -F '#{pid}' 2>/dev/null | sort -u | head -n 1); [ -n "$p" ] || return 1; s=$(LC_ALL=C ps -o lstart= -p "$p" 2>/dev/null | tr -s ' '); [ -n "$s" ] || return 1; printf '%s\\t%s' "$p" "$s"; }`,
    // Keep in sync with startCapable() in support/e00-harness.ts (bare `tmux` starts a session).
    'case "$1" in -V) starting=0 ;; ""|new|new-session|new-s*|start|start-server|start-s*|-*) starting=1 ;; *) starting=0 ;; esac',
    'if [ "$starting" = 1 ]; then',
    '  seq="$$.$(date +%s)"',
    `  printf 'start\\t%s\\t%s\\n' "$seq" "$(date +%s)" >> ${q(shim.identities)} || { echo "tmux-shim: start record write failed; not launching" >&2; exit 125; }`,
    '  pre=$(srv) || pre=""',
    "fi",
    `if [ -e ${q(shim.malformCreate)} ] && { [ "$1" = "new-session" ] || [ "$1" = "new-window" ]; }; then`,
    `  out=$(${q(realTmux)} -S ${q(shim.socket)} -f /dev/null "$@"); rc=$?`,
    `  [ -n "$out" ] && printf '%s\\n' "$out" | sed 's/^%/?/'`,
    `elif [ -e ${q(shim.dropPaneTitle)} ] && [ "$1" = "list-panes" ]; then`,
    `  out=$(${q(realTmux)} -S ${q(shim.socket)} -f /dev/null "$@"); rc=$?`,
    `  [ -n "$out" ] && printf '%s\\n' "$out" | grep -v -F -- "$(cat ${q(shim.dropPaneTitle)})"`,
    "else",
    `  ${q(realTmux)} -S ${q(shim.socket)} -f /dev/null "$@"`,
    "  rc=$?",
    "fi",
    `if [ "$starting" = 1 ] && [ ! -e ${q(shim.failCapture)} ]; then`,
    '  post=$(srv) || post=""',
    '  if [ -n "$post" ] && [ -z "$pre" ]; then',
    `    printf 'server\\t%s\\t%s\\n' "$seq" "$post" >> ${q(shim.identities)}`,
    '  elif [ -n "$post" ] && [ "$post" = "$pre" ]; then',
    `    printf 'reuse\\t%s\\t%s\\n' "$seq" "$post" >> ${q(shim.identities)}`,
    "  fi",
    "fi",
    'if [ "$rc" -eq 0 ] && [ "$1" != "kill-server" ] && cur=$(srv); then',
    `  for pp in $(${q(realTmux)} -S ${q(shim.socket)} list-panes -a -F '#{pane_pid}' 2>/dev/null); do`,
    `    printf 'pane\\t%s\\t%s\\t%s\\n' "$cur" "$pp" "$(LC_ALL=C ps -o lstart= -p "$pp" | tr -s ' ')" >> ${q(shim.identities)}`,
    "  done",
    "fi",
    'exit "$rc"',
    "",
  ].join("\n"), { mode: 0o755 });
  ownTmuxServer(root, realTmux, shim.socket, shim.identities);
  return shim;
}

/** Run the REAL tmux against the shim's isolated server (test-side inspection only). */
export function tmuxOn(shim: TmuxShim, args: string[]) {
  return spawnSync(shim.realTmux, ["-S", shim.socket, ...args], { encoding: "utf8", timeout: 10000 });
}
