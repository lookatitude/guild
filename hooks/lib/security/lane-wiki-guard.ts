/**
 * hooks/lib/security/lane-wiki-guard.ts
 *
 * KTD35 "specialists never Write wiki", as code (plr-wi-15-3). A lane worker —
 * a session with GUILD_TASK_ID or GUILD_LANE_ID set — may not write under this
 * root's wiki (the caller passes the roots from GuildStorage `knowledge()`). It
 * stages a knowledge candidate instead and the lead promotes it through harvest. The lead / T0 session (neither var
 * set) is not a lane worker, and the harvest writer is an in-process knowledge
 * domain call, not a tool call, so neither reaches this guard.
 *
 * The target is compared by REALPATH (deepest existing ancestor, then the
 * remaining segments), so a symlink or `..` spelling that lands in the wiki is
 * still the wiki. Bash is covered only where the target is deterministic from
 * the command text: `>` / `>>` / `>|` / `&>` redirections and `tee` operands.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** True when the env names a lane worker (either id set, non-empty). */
export function isLaneWorker(env: NodeJS.ProcessEnv): boolean {
  const task = env["GUILD_TASK_ID"];
  const lane = env["GUILD_LANE_ID"];
  return (typeof task === "string" && task.length > 0) || (typeof lane === "string" && lane.length > 0);
}

/** Resolve `p` through the deepest existing ancestor's realpath. */
export function realpathDeep(p: string): string {
  let current = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...rest);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** Does `target` (resolved against `cwd`) realpath under one of `wikiRoots`? */
export function resolvesUnderWiki(wikiRoots: readonly string[], target: string, cwd: string): boolean {
  const expanded = target === "~" || target.startsWith("~/") ? path.join(os.homedir(), target.slice(1)) : target;
  const abs = realpathDeep(path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded));
  return wikiRoots.some((root) => {
    const rel = path.relative(realpathDeep(root), abs);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

const WORD = String.raw`(?:"([^"]*)"|'([^']*)'|([^\s;|&<>()]+))`;
const REDIRECT_RE = new RegExp(String.raw`(?:^|[^<>&|=-])(?:\d*|&)>>?\|?\s*(?!&)` + WORD, "g");
const WORD_NC = String.raw`(?:"[^"]*"|'[^']*'|[^\s;|&<>()]+)`;
const TEE_RE = new RegExp(String.raw`(?:^|[\s;|&(])tee((?:\s+` + WORD_NC + String.raw`)+)`, "g");
const ARG_RE = new RegExp(WORD, "g");

/** The file targets a Bash command writes, where the command text names them. */
export function bashWriteTargets(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(REDIRECT_RE)) {
    const t = m[1] ?? m[2] ?? m[3];
    if (t !== undefined && t.length > 0) out.push(t);
  }
  for (const m of command.matchAll(TEE_RE)) {
    for (const a of (m[1] ?? "").matchAll(ARG_RE)) {
      const t = a[1] ?? a[2] ?? a[3];
      if (t !== undefined && t.length > 0 && !t.startsWith("-")) out.push(t);
    }
  }
  return out;
}

/** Every file target a Write / Edit / MultiEdit / NotebookEdit / Bash call writes. */
export function toolWriteTargets(tool: string, input: Record<string, unknown>): string[] {
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const t = typeof input["file_path"] === "string" ? input["file_path"] : input["notebook_path"];
    return typeof t === "string" && t.length > 0 ? [t] : [];
  }
  if (tool === "Bash") {
    return typeof input["command"] === "string" ? bashWriteTargets(input["command"]) : [];
  }
  return [];
}

/**
 * The first wiki target a lane worker's call would write, or null. Pure apart
 * from the realpath reads. Null for any non-lane session.
 */
export function laneWikiWriteTarget(
  env: NodeJS.ProcessEnv,
  tool: string,
  input: Record<string, unknown>,
  wikiRoots: readonly string[],
  cwd: string,
): string | null {
  if (!isLaneWorker(env)) return null;
  return toolWriteTargets(tool, input).find((t) => resolvesUnderWiki(wikiRoots, t, cwd)) ?? null;
}
