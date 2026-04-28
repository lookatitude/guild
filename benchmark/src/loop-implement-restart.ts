// v1.4.0 adversarial-loops — F-3 security-restart machinery for
// `guild:loop-implement`.
//
// Architect contract (verbatim, see benchmark/plans/v1.4-loop-skill-contracts.md
// §"Restart semantics — security restart" + §"Restart cap = 3"
// + §"Per-lane counters — isolation contract").
//
// Restart trigger:
//   - Security receipt body contains a heading matching
//     /^##\s+(Findings|Open issues|Blockers)\b/im BEFORE the
//     `## NO MORE QUESTIONS` sentinel.
//   - Under that heading, YAML-bullet entries with required fields:
//       severity: high | medium | low
//       addressed_by_owner: true | false
//       description: <free text>
//   - Restart fires iff ANY single finding has
//       severity: high  AND  addressed_by_owner: false
//
// Restart cap = 3 per lane per task. The 4th restart attempt escalates
// via AskUserQuestion (`force-pass` / `extend-cap` / `rework`).
//
// On restart fire:
//   1. Move L3/L4/security receipts for this lane to
//      .guild/runs/<run-id>/handoffs/superseded/<lane_id>-restart-<N>/.
//   2. Each prior receipt gains frontmatter `superseded_by:` pointing
//      at the new (post-restart) receipt path.
//   3. Reset L3/L4/security counters for this lane (preserve restart counter).
//      → counter-store's `resetLaneCounters` does this for L3/L4/security
//        and PRESERVES `restart:<lane>` per T3a's decision §6.
//   4. Increment `restart:<lane>` counter by 1.
//   5. New context bundle includes the security findings verbatim.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { LOOP_SENTINEL } from "./loop-sentinel.js";

/**
 * Restart cap default per architect contract. Verify-done greps for
 * the literal `cap = 3` somewhere in the source/skills.
 */
export const RESTART_CAP_DEFAULT = 3; // cap = 3

/** Heading regex per architect: matches `## Findings`, `## Open issues`, `## Blockers`. */
export const FINDINGS_HEADING_RE = /^##\s+(Findings|Open issues|Blockers)\b/im;

/** A single parsed security finding. */
export interface SecurityFinding {
  severity: "high" | "medium" | "low";
  addressed_by_owner: boolean;
  description: string;
}

/** Outcome of parsing a security receipt's findings section. */
export type FindingsParseResult =
  | { kind: "no_findings_section"; findings: [] }
  | { kind: "ok"; findings: SecurityFinding[] }
  | {
      kind: "malformed_bullet";
      findings: SecurityFinding[]; // Findings parsed before the malformed one (if any).
      malformed_index: number;
      reason: string;
    };

/**
 * Parse the YAML-bullet findings section of a security receipt body.
 *
 * Implementation note: we only run on the substring BEFORE the
 * `## NO MORE QUESTIONS` sentinel — security findings live above the
 * sentinel per the architect contract. If the sentinel is absent,
 * we parse the entire body (caller decides what to do with that).
 *
 * The parser is deliberately small and forgiving:
 *   - Heading matched by FINDINGS_HEADING_RE.
 *   - Bullets are blocks separated by a blank line, where the block
 *     starts with `- key: value` and continues with `  key: value` lines
 *     until the next `-` bullet OR a blank-line gap larger than 1 OR
 *     end of section.
 *   - Required keys: `severity`, `addressed_by_owner`. `description` is
 *     STRONGLY-recommended but optional (the parser fills with empty
 *     string when missing — only `severity`+`addressed_by_owner` are
 *     load-bearing for the restart decision).
 *
 * Out-of-vocabulary `severity` or non-boolean `addressed_by_owner` is a
 * malformed bullet — the architect's fallback rule applies (caller
 * logs `assumption_logged` and treats as no-restart).
 */
export function parseSecurityFindings(body: string): FindingsParseResult {
  // 1. Truncate to the pre-sentinel region if a sentinel is present.
  let region = body;
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === LOOP_SENTINEL) {
      region = lines.slice(0, i).join("\n");
      break;
    }
  }

  // 2. Locate the findings heading.
  const headingMatch = FINDINGS_HEADING_RE.exec(region);
  if (!headingMatch) {
    return { kind: "no_findings_section", findings: [] };
  }
  const headingEnd = headingMatch.index + headingMatch[0].length;
  const afterHeading = region.slice(headingEnd);

  // 3. Slice until the next `## ` heading (any depth-2 markdown heading
  //    closes the findings section).
  const nextHeadingIdx = afterHeading.search(/^##\s/m);
  const section =
    nextHeadingIdx === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIdx);

  // 4. Split into bullets. A bullet starts with `-` at the beginning of a
  //    (possibly indented) line.
  const sectionLines = section.split("\n");
  const bullets: string[][] = [];
  let current: string[] | null = null;
  for (const line of sectionLines) {
    if (/^\s*-\s+\S/.test(line)) {
      if (current) bullets.push(current);
      current = [line];
    } else if (current && line.trim() === "") {
      // Blank line — finalize the current bullet.
      bullets.push(current);
      current = null;
    } else if (current && /^\s+\S/.test(line)) {
      // Continuation of the current bullet.
      current.push(line);
    }
    // Anything else (text outside a bullet) is ignored.
  }
  if (current) bullets.push(current);

  // 5. Parse each bullet. Bullets are `key: value` pairs where the first
  //    line has its `key:` after the `-` marker.
  const findings: SecurityFinding[] = [];
  for (let bi = 0; bi < bullets.length; bi++) {
    const block = (bullets[bi] as string[]).join("\n");
    // Strip the leading `- ` marker on the first line for uniform parsing.
    const cleaned = block.replace(/^\s*-\s+/, "  ");
    const kv = parseKvBlock(cleaned);
    const sev = kv.severity;
    const addr = kv.addressed_by_owner;
    if (sev === undefined || addr === undefined) {
      return {
        kind: "malformed_bullet",
        findings,
        malformed_index: bi,
        reason: `Malformed security finding bullet — missing severity or addressed_by_owner; bullet ${bi}`,
      };
    }
    if (sev !== "high" && sev !== "medium" && sev !== "low") {
      return {
        kind: "malformed_bullet",
        findings,
        malformed_index: bi,
        reason: `Malformed security finding bullet — severity must be high|medium|low (got ${sev}); bullet ${bi}`,
      };
    }
    let addrBool: boolean;
    if (addr === "true") addrBool = true;
    else if (addr === "false") addrBool = false;
    else
      return {
        kind: "malformed_bullet",
        findings,
        malformed_index: bi,
        reason: `Malformed security finding bullet — addressed_by_owner must be true|false (got ${addr}); bullet ${bi}`,
      };
    findings.push({
      severity: sev,
      addressed_by_owner: addrBool,
      description: kv.description ?? "",
    });
  }

  return { kind: "ok", findings };
}

/**
 * Parse a `key: value` block (one key per line). Permissive: trims, and
 * preserves the *first* occurrence of each key (subsequent duplicates
 * are ignored, matching YAML "last-key-wins" only loosely — defensive).
 */
function parseKvBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = block.split("\n");
  for (const raw of lines) {
    const m = /^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const k = m[1] as string;
    const v = (m[2] as string).trim();
    if (out[k] === undefined) {
      // Strip surrounding quotes if present.
      const unq = /^"(.*)"$/.exec(v) ?? /^'(.*)'$/.exec(v);
      out[k] = unq ? (unq[1] as string) : v;
    }
  }
  return out;
}

/**
 * Decide whether the parsed findings trigger a security restart.
 *
 * Restart fires iff ANY finding has `severity: high` AND
 * `addressed_by_owner: false`. Anything else (medium/low, or
 * already-addressed high) does NOT trigger; lower-severity findings
 * are recorded in `assumption_logged` but the loop proceeds.
 *
 * Malformed-bullet results NEVER trigger a restart (defends against typos
 * blocking the lane). Caller is expected to emit an `assumption_logged`
 * event with the architect's literal text.
 */
export function shouldRestartFromSecurity(
  parse: FindingsParseResult,
): boolean {
  if (parse.kind !== "ok") return false;
  return parse.findings.some(
    (f) => f.severity === "high" && f.addressed_by_owner === false,
  );
}

/**
 * Architect-pinned literal text for the malformed-bullet `assumption_logged`
 * event. Caller fills in `<lane_id>` and `<N>` (round number).
 */
export function malformedFindingAssumptionText(
  laneId: string,
  roundNumber: number,
): string {
  return `Malformed security finding bullet — treated as no-restart; lane ${laneId}; round ${roundNumber}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Receipt supersession
// ──────────────────────────────────────────────────────────────────────────

/**
 * Move prior L3/L4/security receipts for `laneId` to
 * `<runDir>/handoffs/superseded/<laneId>-restart-<N>/`. Each moved
 * receipt gains a frontmatter field `superseded_by: <newReceiptPath>`.
 *
 * Returns the absolute paths of the moved files (post-rename).
 *
 * `restartCount` is the new (post-increment) restart count — i.e., on
 * the first restart pass `restartCount === 1` and the directory is
 * `<laneId>-restart-1/`.
 *
 * Idempotent on repeat calls only insofar as `renameSync` on a missing
 * source throws — caller is expected to call this exactly once per
 * restart fire.
 */
export interface SupersedeArgs {
  runDir: string;
  laneId: string;
  /** Post-increment restart count (1, 2, 3, ...). */
  restartCount: number;
  /** Repo-relative path to the NEW (post-restart) receipt that supersedes the old ones. */
  newReceiptRelPath: string;
  /**
   * Optional list of prior-receipt filenames to move; if omitted the
   * function scans `<runDir>/handoffs/` for files matching the lane's
   * L3/L4/security pattern.
   */
  priorReceiptNames?: string[];
}

export interface SupersedeResult {
  movedFromTo: Array<{ from: string; to: string }>;
  supersededDir: string;
}

export function supersedePriorReceipts(args: SupersedeArgs): SupersedeResult {
  const handoffsDir = join(args.runDir, "handoffs");
  const targetDir = join(
    handoffsDir,
    "superseded",
    `${args.laneId}-restart-${args.restartCount}`,
  );
  mkdirSync(targetDir, { recursive: true });

  // Discover prior receipts: anything containing the lane id in
  // handoffsDir (excluding superseded/) is a candidate. The architect
  // contract is "L3 + L4 + security-review receipts for this lane" —
  // we use a name-substring match because receipts are named by
  // `<specialist>-<task-id>.md` per §8.2 and the lane_id is the
  // task-id.
  let priorNames: string[];
  if (args.priorReceiptNames && args.priorReceiptNames.length > 0) {
    priorNames = args.priorReceiptNames;
  } else {
    if (!existsSync(handoffsDir)) {
      return { movedFromTo: [], supersededDir: targetDir };
    }
    priorNames = readdirSync(handoffsDir).filter((entry) => {
      if (entry === "superseded") return false;
      // Match receipts that mention the lane id in their filename.
      return entry.endsWith(".md") && entry.includes(args.laneId);
    });
  }

  const movedFromTo: Array<{ from: string; to: string }> = [];
  for (const name of priorNames) {
    const from = join(handoffsDir, name);
    if (!existsSync(from)) continue; // Skip receipts that don't exist yet.
    const to = join(targetDir, name);
    // Rewrite frontmatter `superseded_by:` BEFORE moving so the new
    // path is captured in the moved file (not the original location).
    const original = readFileSync(from, "utf8");
    const rewritten = injectSupersededBy(original, args.newReceiptRelPath);
    writeFileSync(from, rewritten, "utf8");
    renameSync(from, to);
    movedFromTo.push({ from, to });
  }

  return { movedFromTo, supersededDir: targetDir };
}

/**
 * Inject (or replace) a `superseded_by:` field in a markdown receipt's
 * YAML frontmatter. If the frontmatter is missing, prepend one with
 * just this field.
 *
 * Pure string transform, exported for tests.
 */
export function injectSupersededBy(
  content: string,
  newReceiptRelPath: string,
): string {
  // Detect a YAML-frontmatter block opening with `---\n`.
  if (!content.startsWith("---")) {
    return `---\nsuperseded_by: ${newReceiptRelPath}\n---\n${content}`;
  }
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!match) {
    // Malformed frontmatter — prepend a fresh block.
    return `---\nsuperseded_by: ${newReceiptRelPath}\n---\n${content}`;
  }
  const inner = match[1] as string;
  const after = content.slice(match[0].length);
  // Replace existing `superseded_by:` if present, else append.
  if (/^superseded_by:\s*/m.test(inner)) {
    const replacedInner = inner.replace(
      /^superseded_by:.*$/m,
      `superseded_by: ${newReceiptRelPath}`,
    );
    return `---\n${replacedInner}\n---\n${after}`;
  }
  const newInner = `${inner}\nsuperseded_by: ${newReceiptRelPath}`;
  return `---\n${newInner}\n---\n${after}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Restart-cap escalation gate
// ──────────────────────────────────────────────────────────────────────────

/**
 * Decide whether an attempted restart hits the cap and must escalate.
 *
 * `currentRestartCount` is the count BEFORE this attempted increment
 * (i.e., the value just read from counters.json).
 * Returns true iff the next restart would be the (cap+1)-th attempt.
 *
 * With cap = 3, 3 restarts are allowed (counter values 1, 2, 3); the
 * 4th attempt escalates.
 */
export function isRestartCapHit(
  currentRestartCount: number,
  restartCap: number = RESTART_CAP_DEFAULT,
): boolean {
  return currentRestartCount >= restartCap;
}
