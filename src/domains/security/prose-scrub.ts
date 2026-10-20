/**
 * src/domains/security/prose-scrub.ts
 *
 * #108 / D2 — the prose policy. Human-authored Markdown under `.guild/wiki/**` and
 * the run's review / handoff receipts is never rewritten in place. A write that
 * carries a real credential shape is REFUSED with the offending span named (line,
 * column, category — never the value). Content that passes lands byte-identical.
 *
 * The log redactors (redact-log.ts groups 1-4) stay on log/JSONL and the other
 * durable surfaces. They are not used here: the length-entropy group destroys
 * ordinary identifiers, the home-dir group removes documented file names, and the
 * bare `key: value` group eats sentences.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { canonicalizeRealPath } from "../kernel";
import type { SecretsPolicy } from "./config";
import { SECRET_PATTERNS } from "./secret-patterns";
import { TOKEN_SHAPE_PATTERNS } from "./redact-log";
import type { ScrubSurface } from "./scrubbed-write";
import { inShareSet } from "./share-set";

// ── Surface classification ─────────────────────────────────────────────────

/**
 * Classify an absolute path as an HK-06 scrub-target surface.
 *   "wiki"       → .guild/wiki/**
 *   "review"     → .guild/runs/<id>/review/** and other share-set Markdown in a run
 *   "handoff"    → .guild/runs/<id>/handoffs/**
 *   "provenance" → .guild/runs/<id>/provenance.json
 *   null         → not a target
 */
export function classifyGuildScrubSurface(absPath: string, guildRoot: string): ScrubSurface | null {
  const parts = path.relative(guildRoot, absPath).split(path.sep);
  if (parts[0] === ".guild" && parts[1] === "wiki") return "wiki";
  if (parts[0] === ".guild" && parts[1] === "runs" && parts.length >= 4) {
    if (parts[3] === "review") return "review";
    if (parts[3] === "handoffs") return "handoff";
    // Other share-set Markdown at any depth (summary.md, verify.md, review.md) is review prose.
    const runRel = parts.slice(3).join(path.sep);
    if (runRel.endsWith(".md") && inShareSet(runRel, false)) return "review";
    if (parts[3] === "provenance.json" && parts.length === 4) return "provenance";
  }
  return null;
}

const PROSE_SURFACES: ReadonlySet<ScrubSurface> = new Set<ScrubSurface>(["wiki", "review", "handoff"]);
const PROSE_EXTENSION = /\.(?:md|markdown)$/i;

/** Markdown on a prose surface: refuse-don't-rewrite applies. */
export function isProseScrubTarget(surface: ScrubSurface | null, absPath: string): boolean {
  return surface !== null && PROSE_SURFACES.has(surface) && PROSE_EXTENSION.test(absPath);
}

/** A dangling symlink's target, or null when the path is not a dangling link. */
function danglingLinkTarget(p: string): string | null {
  try {
    if (!fs.lstatSync(p).isSymbolicLink()) return null;
  } catch {
    return null;
  }
  try {
    fs.statSync(p);
    return null; // resolves: canonicalizeRealPath sees through it
  } catch {
    return path.resolve(path.dirname(p), fs.readlinkSync(p));
  }
}

/**
 * Where a write to this path physically lands: walk the path forward, following any
 * dangling symlink (leaf or ancestor; a write through it lands at its target), then
 * hand the result to the kernel's canonicalizeRealPath.
 */
function physicalPath(p: string): string {
  const abs = path.resolve(p);
  let cur = path.parse(abs).root;
  let hops = 0;
  for (const seg of abs.slice(cur.length).split(path.sep)) {
    if (seg.length === 0) continue;
    cur = path.join(cur, seg);
    for (let next = danglingLinkTarget(cur); next !== null && hops < 40; next = danglingLinkTarget(cur)) {
      cur = next;
      hops++;
    }
  }
  return canonicalizeRealPath(cur);
}

/**
 * The prose surface a write lands on, by its lexical path or through symlinks
 * (a link outside `.guild/` that points at a wiki page is still a wiki write).
 * Null when neither path is a prose target.
 */
export function proseTargetSurface(absPath: string, guildRoot: string): ScrubSurface | null {
  const lexical = classifyGuildScrubSurface(absPath, guildRoot);
  if (isProseScrubTarget(lexical, absPath)) return lexical;
  const phys = physicalPath(absPath);
  const physical = classifyGuildScrubSurface(phys, physicalPath(guildRoot));
  return isProseScrubTarget(physical, phys) ? physical : null;
}

// ── Credential shapes ──────────────────────────────────────────────────────

/** Prefix-anchored credential shapes from the canonical SECRET_PATTERNS list. */
const PROSE_SECRET_LABELS: ReadonlySet<string> = new Set([
  "password-assignment",
  "api_key-assignment",
  "secret-assignment",
  "AWS access key",
  "GCP API key",
  "GitHub personal access token",
  "GitHub server token",
  "PEM private key block",
  "bearer-token",
  "provider-api-key",
  "Slack token",
  "GitHub token",
  "GitLab personal access token",
  "npm token",
  "HuggingFace token",
]);

/** Token shapes SECRET_PATTERNS lacks, taken from the log group-1 list by prefix. */
const TOKEN_SHAPE_EXTRAS: ReadonlyArray<readonly [string, string]> = [
  ["\\bgithub_pat_", "GitHub fine-grained token"],
  ["\\beyJ", "JWT"],
];

/**
 * DEEP-FROZEN prose credential set. Composed from the frozen canonical lists, never
 * re-spelled. Excluded on purpose: the 40-hex and length-entropy heuristics, the
 * home-dir group, bare `authorization:` / `*_token:` / `key: value` forms, and the
 * PII identifiers (not credentials; they stay on the share scrubber).
 */
export const PROSE_CREDENTIAL_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  // The canonical password form is case-sensitive; prose also catches `PASSWORD=`.
  ...SECRET_PATTERNS.filter(([, label]) => PROSE_SECRET_LABELS.has(label)).map(([re, label]) =>
    re.flags.includes("i") ? ([re, label] as const) : Object.freeze([new RegExp(re.source, re.flags + "i"), label] as const),
  ),
  ...TOKEN_SHAPE_EXTRAS.flatMap(([prefix, label]) =>
    TOKEN_SHAPE_PATTERNS.filter((re) => re.source.startsWith(prefix)).map(
      (re) => Object.freeze([re, label] as const),
    ),
  ),
]);

export interface ProseCredentialSpan {
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  /** Matched length in characters. The value itself is never carried. */
  length: number;
  category: string;
}

export interface ProseVerdict {
  /** True ⇒ the content may land byte-identical. */
  ok: boolean;
  spans: ProseCredentialSpan[];
  /** Operator patterns that failed to compile (fail-closed on a durable surface). */
  failures: string[];
}

function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") starts.push(i + 1);
  return starts;
}

function locate(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}

function collect(
  content: string,
  source: string,
  flags: string,
  category: string,
  hits: Map<number, ProseCredentialSpan>,
  starts: number[],
): void {
  const re = new RegExp(source, flags.includes("g") ? flags : flags + "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (!hits.has(m.index)) hits.set(m.index, { ...locate(starts, m.index), length: m[0].length, category });
  }
}

/**
 * Detect credential shapes and operator patterns in prose. Pure; never rewrites.
 * An operator `redaction_patterns` entry is a refusal trigger here, not a rewrite.
 */
export function evaluateProseContent(content: string, policy: SecretsPolicy): ProseVerdict {
  const starts = lineStarts(content);
  const hits = new Map<number, ProseCredentialSpan>();
  for (const [re, label] of PROSE_CREDENTIAL_PATTERNS) collect(content, re.source, re.flags, label, hits, starts);
  const failures: string[] = [];
  policy.redaction_patterns.forEach((pat, i) => {
    try {
      new RegExp(pat, "g");
    } catch {
      // The engine's message echoes the pattern source, which may hold a credential.
      failures.push(`redaction_patterns[${i}] is not a valid regular expression`);
      return;
    }
    collect(content, pat, "g", `secrets_policy.redaction_patterns[${i}]`, hits, starts);
  });
  const spans = [...hits.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
  return { ok: spans.length === 0 && failures.length === 0, spans, failures };
}

/** Display label for a refused file: its path relative to the Guild root. */
export function proseFileLabel(absPath: string, guildRoot: string): string {
  return path.relative(guildRoot, absPath);
}

/** One-line refusal naming every span by position and category. Carries no secret. */
export function describeProseRefusal(verdict: ProseVerdict, fileLabel: string): string {
  const parts = verdict.spans.map((s) => `line ${s.line}, column ${s.column} (${s.category}, ${s.length} chars)`);
  const spanText = parts.length > 0 ? `: credential shape at ${parts.join("; ")}` : "";
  const failText = verdict.failures.length > 0
    ? `${parts.length > 0 ? ";" : ":"} secrets_policy has an invalid pattern (${verdict.failures.join("; ")}), so durable prose fails closed`
    : "";
  return `prose write to ${fileLabel} refused${spanText}${failText}. Prose is never rewritten in place; remove the span and retry.`;
}

// ── Proposed content (PreToolUse) ──────────────────────────────────────────

/** Tools whose writes the prose policy gates. */
export const PROSE_WRITE_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit"]);

function applyEdit(current: string, edit: unknown): string | null {
  if (edit === null || typeof edit !== "object") return null;
  const e = edit as Record<string, unknown>;
  const oldS = e["old_string"];
  const newS = e["new_string"];
  if (typeof oldS !== "string" || typeof newS !== "string" || oldS.length === 0) return null;
  const at = current.indexOf(oldS);
  if (at < 0) return null;
  if (e["replace_all"] === true) return current.split(oldS).join(newS);
  return current.slice(0, at) + newS + current.slice(at + oldS.length);
}

/**
 * The bytes a Write/Edit/MultiEdit would leave on disk, or null when they cannot be
 * known (another tool, a missing file for an edit, or an old_string that is not present).
 */
export function proposedWriteContent(toolName: string, toolInput: unknown, current: string | null): string | null {
  if (toolInput === null || typeof toolInput !== "object") return null;
  const ti = toolInput as Record<string, unknown>;
  if (toolName === "Write") return typeof ti["content"] === "string" ? ti["content"] : null;
  if (current === null) return null;
  if (toolName === "Edit") return applyEdit(current, ti);
  if (toolName !== "MultiEdit" || !Array.isArray(ti["edits"])) return null;
  let out: string | null = current;
  for (const edit of ti["edits"] as unknown[]) {
    out = applyEdit(out, edit);
    if (out === null) return null;
  }
  return out;
}

// ── Prior-content snapshots (PreToolUse → PostToolUse) ─────────────────────

const SNAPSHOT_KIND = "prose-prior-snapshot";

/** Session-scratch segment (GuildStorage.temporary) both hooks share for snapshots. */
export const PROSE_SNAPSHOT_SEGMENT = "prose-snapshots";

/**
 * Deterministic key for one tool call's write to one path. The host's tool-use id
 * keeps overlapping writes to the same path from sharing a snapshot.
 */
export function proseSnapshotKey(sessionId: string, toolUseId: string, absPath: string): string {
  return crypto.createHash("sha256").update(`${sessionId}\0${toolUseId}\0${absPath}`, "utf8").digest("hex");
}

/** The host's tool-use id for this call, or "" when the host sends none. */
export function hookToolUseId(payload: Record<string, unknown>): string {
  for (const key of ["tool_use_id", "toolUseId", "call_id", "callId"]) {
    const v = payload[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

/**
 * Prior bytes from the host's own tool result: Claude Code's Write/Edit/MultiEdit
 * report `originalFile` (absent file on a `create`). `found: false` otherwise.
 */
export function priorFromToolResponse(resp: unknown): { found: boolean; prior: string | null } {
  if (resp === null || typeof resp !== "object") return { found: false, prior: null };
  const r = resp as Record<string, unknown>;
  if (typeof r["originalFile"] === "string") return { found: true, prior: r["originalFile"] };
  if (r["type"] === "create" && (r["originalFile"] === null || r["originalFile"] === undefined)) {
    return { found: true, prior: null };
  }
  return { found: false, prior: null };
}

/** Record the prior bytes (null = the file did not exist). Best-effort; never throws. */
export function recordProseSnapshot(dir: string, key: string, prior: string | null): void {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify({ kind: SNAPSHOT_KIND, prior }), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    /* PostToolUse reports without restoring when the snapshot is missing */
  }
}

/** Read and delete a snapshot. `found: false` when none was recorded. */
export function takeProseSnapshot(dir: string, key: string): { found: boolean; prior: string | null } {
  const file = path.join(dir, `${key}.json`);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { found: false, prior: null };
  }
  try {
    fs.unlinkSync(file);
  } catch {
    /* a stale snapshot is overwritten by the next PreToolUse */
  }
  try {
    const rec = JSON.parse(raw) as { kind?: unknown; prior?: unknown };
    if (rec.kind !== SNAPSHOT_KIND) return { found: false, prior: null };
    if (rec.prior !== null && typeof rec.prior !== "string") return { found: false, prior: null };
    return { found: true, prior: rec.prior };
  } catch {
    return { found: false, prior: null };
  }
}

/** Put the prior bytes back (null ⇒ the file did not exist, so remove it). Throws on I/O failure. */
export function restoreProseSnapshot(absPath: string, prior: string | null): void {
  // Restore the file the write reached, not a symlink in front of it.
  const target = physicalPath(absPath);
  if (prior === null) {
    fs.rmSync(target, { force: true });
    return;
  }
  fs.writeFileSync(target, prior, "utf8");
}
