/**
 * hooks/lib/ensure-layout.ts — the layout bootstrap, hook side (KTD23 / R45).
 *
 *     Every entry naming a durable path calls the layout bootstrap.
 *
 * A hook IS a write-capable entry: PostToolUse appends to the event log,
 * PreCompact appends a hook event, the agent-team hooks write receipts. Each one
 * can be the first thing to touch a root after an upgrade landed, so each one
 * runs the bootstrap rather than assuming an earlier entry did.
 *
 * This module is a thin wrapper over the canonical implementation in
 * `scripts/lib/state/ensure-storage-layout.ts`, kept deliberately under the same
 * exported NAME (a hook entry must call the bootstrap by name for the KTD23
 * grep to see it), and adding exactly three behaviours a hook needs and a
 * command does not:
 *
 *  1. **A GATE, not a status.** The canonical entry THROWS on a future layout
 *     and returns a status otherwise; a hook can do neither. It must exit 0, and
 *     on a future layout it must WRITE NOTHING — KTD23 fails closed rather than
 *     down-migrating, and a hook that carried on would append a rung record and
 *     a JSONL line into a root this build does not understand (codex G-lane r1,
 *     P1 #2). So the return is `{ ok: true, status }` or `{ ok: false, … }`, and
 *     every caller bails on the refusal before its first write.
 *  2. **Silent, and memoized per cwd.** Several registered hooks are budgeted to
 *     0 bytes of stderr (`hooks/__tests__/hook-output-budget.test.ts`), and the
 *     upgrade chain's step report is ~1.2 KB, so this module prints nothing: a
 *     caller with stderr budget prints its own single line. The refusal lives in
 *     the process memo, never on disk, so a second call inside one invocation is
 *     free rather than merely cheap (the budgeted paths are 50ms at SessionStart
 *     and 250ms after an edit).
 *  3. **A reachable cold half.** The canonical entry loads its upgrade chain by
 *     a non-analyzable require, which has no resolvable target inside a hook
 *     bundle; `runColdBootstrapOutOfProcess` below spawns the compiled CLI so an
 *     unmarked root is still upgraded.
 */

import * as path from "node:path";
import { spawnSync } from "node:child_process";

import {
  detect,
  ensureStorageLayout as ensureStorageLayoutImpl,
  type LayoutState,
  type LayoutStatus,
} from "../../scripts/lib/state/ensure-storage-layout.js";

export type { LayoutStatus, LayoutState };

/**
 * The gate a hook entry acts on.
 *
 * Exactly ONE refusal, and it is the one KTD23 names: a layout NEWER than this
 * build. That asymmetry is the whole rule — a future root may not be written to
 * because this build does not know its shape, while an OLD or unmarked root is
 * the ordinary case Guild has always read and written. Refusing an unmarked root
 * too was tried and is wrong: it silences the D-SECRETS scrub, the event log and
 * the receipts on every project that has not upgraded yet, which is a much worse
 * failure than the one it guards against.
 *
 * Every member carries EVERY field (`null` where it does not apply) rather than
 * being a minimal discriminated union. That is not style: the hooks jest project
 * compiles with `module: commonjs` and no `strict`, and without
 * `strictNullChecks` TypeScript does not narrow `if (!gate.ok)`, so a member
 * that omitted `refused` made `gate.refused` a compile error at every call site.
 * A uniform shape reads the same in both compilations.
 */
export type LayoutGate =
  | { ok: true; status: LayoutStatus; refused: null; reason: null }
  | { ok: false; status: null; refused: "future"; reason: string };

const memo = new Map<string, LayoutGate>();

/**
 * Run the COLD half of the bootstrap out of process.
 *
 * The canonical entry loads its upgrade chain through a deliberately
 * non-analyzable `require` so the 50ms SessionStart bundle carries the marker
 * read and nothing else (KTD29). Inside a hook BUNDLE that indirection has no
 * resolvable target — `__dirname` is `hooks/dist/`, and the chunk lives at
 * `runtime/scripts/upgrade-chain.js` next to the compiled CLI. So an unmarked or
 * stale root reached from a hook is upgraded by spawning that CLI, which does
 * resolve its own sibling chunk.
 *
 * Only ever reached OFF the budgeted path: a current root returns from the
 * marker read before this is considered.
 */
function runColdBootstrapOutOfProcess(cwd: string): boolean {
  const pluginRoot = process.env["CLAUDE_PLUGIN_ROOT"] ?? process.env["GUILD_PLUGIN_ROOT"];
  if (pluginRoot === undefined || pluginRoot.length === 0) return false;
  const cli = path.join(pluginRoot, "runtime", "scripts", "ensure-storage-layout.js");
  const r = spawnSync(process.execPath, [cli, `--cwd=${cwd}`], {
    encoding: "utf8",
    timeout: 60_000,
  });
  // The CLI's own stderr is DISCARDED here, deliberately. Its blocked-upgrade
  // report is ~1.2 KB and several hooks are budgeted to 0 bytes of stderr, so
  // forwarding it would trade a layout problem for an output-budget failure.
  // SessionStart runs the same CLI and prints the report where an operator is
  // actually reading; from a hook the useful outcome is that the chain RAN.
  return r.status === 0;
}

/**
 * The bootstrap gate for `cwd`. Memoized per process, silent, never throws.
 *
 * ```ts
 * const gate = ensureStorageLayout(guildRoot, "post-tool-use");
 * if (!gate.ok) return;          // future / indeterminate layout: write nothing
 * ```
 *
 * `absent` and `current` pass immediately — the budgeted branch, a stat plus one
 * marker read. `unmarked` and `stale` run the chain (in process, or through the
 * compiled CLI when the cold chunk is unreachable from this bundle) and then
 * pass on the re-detected status, INCLUDING when the chain blocked on dirty
 * durable paths: a blocked upgrade leaves a readable root, which is a reason to
 * tell the operator at activation, not a reason to stop recording telemetry.
 *
 * `future` is the ONE refusal: this build does not understand that layout and
 * KTD23 never down-migrates, so no write may follow.
 *
 * `hookName` is accepted for call-site legibility and is deliberately never
 * printed.
 */
export function ensureStorageLayout(cwd: string, hookName = "hook"): LayoutGate {
  void hookName;
  const cached = memo.get(cwd);
  if (cached !== undefined) return cached;
  const gate = ((): LayoutGate => {
    // `detect` never throws (documented on the canonical module) and names the
    // state BEFORE anything is attempted, so a future layout is refused without
    // the chain ever being reached.
    const pre = detect(cwd);
    if (pre.state === "future") {
      return {
        ok: false,
        status: null,
        refused: "future",
        reason: `layout ${String(pre.version)} is newer than this build (KTD23: never down-migrated)`,
      };
    }
    if (pre.state === "current" || pre.state === "absent") {
      return { ok: true, status: pre, refused: null, reason: null };
    }
    // `unmarked` / `stale`: run the chain. If it cannot run at all — no plugin
    // root to spawn the compiled CLI from — the root stays un-upgraded and the
    // hook carries on against it. That is NOT a fail-open hole: an old layout is
    // readable by this build by definition, and the alternative (refusing) would
    // stop the secret scrub and the audit log on exactly the projects that have
    // not upgraded yet.
    try {
      return { ok: true, status: ensureStorageLayoutImpl(cwd), refused: null, reason: null };
    } catch {
      runColdBootstrapOutOfProcess(cwd);
      return { ok: true, status: detect(cwd), refused: null, reason: null };
    }
  })();
  memo.set(cwd, gate);
  return gate;
}

/** Test seam: the memo is process-lifetime state and a test may need it clear. */
export function resetLayoutBootstrapMemo(): void {
  memo.clear();
}
