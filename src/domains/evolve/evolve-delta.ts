/**
 * evolve-delta.ts — `guild.evolve_delta.v1`: the span replace that is the ONLY way an
 * evolve writer changes a context file (KTD32 / KTD18 / R49).
 *
 * The shape is deliberately narrow:
 *
 *   op          replace (default) | add (a genuinely new heading) | remove
 *   span        a markdown heading — the NAMED region, never a line range
 *   before_hash the sha256 of the region as the proposer read it
 *
 * `before_hash` is the whole safety story. A delta is computed against bytes someone
 * read at some earlier point; between the read and the write the file may have been
 * evolved, harvested, or hand-edited. Re-locating the heading is not enough, because
 * the heading survives a rewrite of everything under it. A mismatch REFUSES — it never
 * "re-bases" onto the current text, because a re-based replace silently discards the
 * change it lands on top of.
 *
 * The curator that runs on the KTD33 auto path is CHEAP AND NOT A MODEL: lint plus
 * `before_hash`, and the replacement text comes from the redirect ledger's deterministic
 * template (T09), never from an LLM rewriting the file. That is the difference between
 * "the operator said do Y, so the span now says do Y" and "a model re-authored your
 * playbook". `assertCheapCurator` is the structural form of that rule.
 *
 * Latest-only (R49) is enforced on the replacement, not just on the file after the
 * fact: a delta whose own text carries a dated update appendix or a changelog heading
 * is refused before it can create the lint violation it would then be blamed for.
 *
 * Span location and rendering are REUSED from the knowledge domain's harvest writer
 * (`locatePlaybookSpan` / `renderPlaybookSpan`). One span grammar, one set of bytes:
 * a second implementation would put revert and rollback on different definitions of
 * "the region".
 */

import * as crypto from "node:crypto";

import {
  locatePlaybookSpan,
  renderPlaybookSpan,
  type PlaybookSpanLocation,
} from "../knowledge";
import { frozenList } from "../kernel";
import {
  EVOLVE_DELTA_SCHEMA,
  EvolveTargetRefusal,
  assertAutoPathAllowed,
  assertNotPermissionEdit,
  evolveHome,
  isEvolveTarget,
  type EvolveTarget,
} from "./evolve-targets";

export const EVOLVE_DELTA_OPS = frozenList(["replace", "add", "remove"] as const);
export type EvolveDeltaOp = (typeof EVOLVE_DELTA_OPS)[number];

export interface EvolveDelta {
  schema_version: typeof EVOLVE_DELTA_SCHEMA;
  target: EvolveTarget;
  /** The file the span lives in. Containment is the caller's write boundary, not this shape's. */
  path: string;
  /** The heading text that names the region (no leading `#`). */
  span: string;
  op: EvolveDeltaOp;
  /** The bytes that replace the region, anchor line excluded. Empty for `remove`. */
  replacement: string;
  /** sha256 of the region as the proposer read it. Required for `replace` and `remove`. */
  before_hash?: string;
  /** Who proposed it — `curator` marks the cheap KTD33 auto path. */
  proposer: "curator" | "operator" | "pipeline";
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Dated-update / changelog shapes forbidden in prompt-loaded text (R49).
 *
 * The first cut matched `^#{0,6}\s*\**Update\s*\(\d{4}` and `^#{1,6}\s*Changelog`
 * case-sensitively on ATX headings only, and therefore missed every spelling a real
 * author uses: `## update (2026-09-16):`, `## UPDATE (…)`, `## **Changelog**`, and a
 * Setext `Changelog` underlined with `===`/`---`. Each miss is a stacked section
 * shipping into a prompt-loaded file, which is the whole of what R49 forbids.
 *
 * The rule now normalises a heading before matching it — ATX or Setext, with any
 * bold/emphasis wrapper stripped — and separately catches a dated `Update (…)` at the
 * start of ANY line, heading or paragraph. A body sentence that merely contains the
 * word "update" is untouched, because the title words must BE the heading.
 */
const STACKED_TITLE_RE = /^(changelog|change ?log|history|updates?|revision history|version history)\b/i;
/** `Update (2026-09-16)` / `Update (2026/09)` at the head of a line, heading or not. */
const DATED_UPDATE_RE = /^[ \t]*(?:#{1,6}[ \t]*)?[*_~`]*update[*_~`]*[ \t]*\([ \t]*\d{4}[-/]\d{1,2}/im;

/** Strip `#` markers and any bold/emphasis wrapper, so `## **Changelog**` reads as `changelog`. */
function headingText(line: string): string {
  return line
    .replace(/^[ \t]*#{1,6}[ \t]*/, "")
    .replace(/[ \t]*#*[ \t]*$/, "")
    .replace(/^[*_~`]+/, "")
    .replace(/[*_~`:]+$/, "")
    .trim();
}

/** A Setext underline: `===…` (h1) or `---…` (h2) directly under a title line. */
function isSetextUnderline(line: string | undefined): boolean {
  return typeof line === "string" && /^[ \t]*(={2,}|-{2,})[ \t]*$/.test(line);
}

export function findLatestOnlyViolation(text: string): string | null {
  if (DATED_UPDATE_RE.test(text)) return 'a dated "Update (…)" appendix';
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isAtx = /^[ \t]*#{1,6}[ \t]+\S/.test(line);
    const isSetext = line.trim() !== "" && isSetextUnderline(lines[i + 1]);
    if (!isAtx && !isSetext) continue;
    if (STACKED_TITLE_RE.test(headingText(line))) return "a Changelog heading";
  }
  return null;
}

/**
 * Lint one proposed replacement. Pure text rules only — this is the whole of the cheap
 * curator's judgement, and it is the reason the curator needs no model.
 */
export function lintReplacement(delta: EvolveDelta): string | null {
  if (delta.op === "remove") return null;
  const violation = findLatestOnlyViolation(delta.replacement);
  if (violation) {
    return (
      `the replacement carries ${violation}; context files are latest-only (R49). ` +
      `The reasoning belongs on a guild.decision.v1 wiki page, not in the live file`
    );
  }
  if (delta.replacement.trim() === "" && delta.op === "replace") {
    return "an empty replacement is a `remove`, not a `replace` — name the op you mean";
  }
  return null;
}

export interface CuratorSpanInput {
  /** The approach the operator rejected. */
  rejected: string;
  /** The approach the operator asked for instead — the ledger's Y. */
  preferred: string;
  /** The `guild.decision.v1` id this span cites. A stable slug. */
  decision_id: string;
}

/**
 * Render the ONE span text the cheap curator is allowed to write (KTD33).
 *
 * Deterministic bytes from the redirect ledger's three fields. This is the
 * difference between "the operator said do Y, so the span now says do Y" and "a
 * model re-authored your playbook": there is no room in this function for a
 * sentence nobody typed.
 */
export function renderCuratorSpan(input: CuratorSpanInput): string {
  return `Do not ${input.rejected.trim()}. Do ${input.preferred.trim()}.\n\nDecided in ${input.decision_id.trim()}.`;
}

/** The exact shape `renderCuratorSpan` produces. Anything else is an LLM rewrite. */
const CURATOR_SPAN_RE =
  /^Do not [^\n]+\. Do [^\n]+\.\n\nDecided in [a-z0-9][a-z0-9._-]*\.$/;

export function isCuratorSpan(replacement: string): boolean {
  return CURATOR_SPAN_RE.test(replacement.trim());
}

/**
 * The cheap curator's structural contract (KTD33): lint + `before_hash` + the
 * deterministic template, and nothing else.
 *
 * Four conditions, and the last one is the reason the curator needs no model:
 *
 *   1. the target is on the auto path;
 *   2. the op is `replace` — `add` is new guidance, a human's call, never a
 *      mechanical consequence of a third redirect;
 *   3. `before_hash` is present (its VALUE is checked when the plan meets the file);
 *   4. the replacement is template-rendered. A free-prose body is an LLM rewrite of
 *      someone's playbook, which is exactly what the auto path may not do.
 */
export function assertCheapCurator(delta: EvolveDelta): void {
  assertAutoPathAllowed(delta.target);
  if (delta.op !== "replace") {
    throw new EvolveTargetRefusal(
      `the cheap curator replaces a named span; '${delta.op}' is a proposal a human runs (KTD33)`,
      "auto_path_forbidden",
    );
  }
  if (!delta.before_hash) {
    throw new EvolveTargetRefusal(
      "the cheap curator requires before_hash: a span replace without one is an unchecked overwrite",
      "hash_required",
    );
  }
  if (!isCuratorSpan(delta.replacement)) {
    throw new EvolveTargetRefusal(
      "the automatic path writes the deterministic redirect template only " +
        "(`renderCuratorSpan`); free prose in a curator span is an LLM rewrite of the " +
        "project's own guidance (KTD33)",
      "curator_shape",
    );
  }
}

export interface EvolveDeltaPlan {
  /** The file as it stands. */
  before: string;
  /** The heading LINE that locates the region. */
  anchor: string;
  /** The region as it stands, anchor line included. */
  before_span: string;
  /** sha256 of `before_span`. */
  before_hash: string;
  /** The exact region bytes the apply step writes. Empty for `remove`. */
  after_span: string;
  /** sha256 of `after_span`. */
  after_hash: string;
  /** The whole file the apply step writes. */
  next: string;
  /** Everything before / after the region. */
  head: string;
  tail: string;
  /**
   * Byte offset of `after_span` in `next`. Rollback locates the region by THIS,
   * not by re-scanning for the anchor: a file with a duplicate heading gave the
   * re-scan two equally good matches and it restored the wrong one. For `remove`
   * (`after_span` empty) the offset is the only locator there is.
   */
  offset: number;
  /** sha256 of everything before `offset` in `next`. */
  head_hash: string;
  /** sha256 of everything after the region in `next`. */
  tail_hash: string;
  delta: EvolveDelta;
}

type PlanRefusal =
  | "span_missing"
  | "hash_required"
  | "hash_mismatch"
  | "scope"
  | "unknown_target";

function refuse(message: string, kind: PlanRefusal): never {
  throw new EvolveTargetRefusal(message, kind);
}

/**
 * Validate a delta and compute exactly what applying it would write.
 *
 * Nothing is written here. The plan carries both hashes, so a compact-history record
 * made from it is already sufficient to undo the write it precedes — the same
 * plan-before-apply split T09 uses for the playbook span, and for the same reason.
 *
 * @throws EvolveTargetRefusal on an unknown target, a permission edit, a missing span,
 *   a `before_hash` mismatch, or a latest-only violation in the replacement.
 */
export function planEvolveDelta(delta: EvolveDelta, currentText: string): EvolveDeltaPlan {
  assertNotPermissionEdit(String(delta.target));
  if (!isEvolveTarget(delta.target)) {
    refuse(
      `'${String(delta.target)}' is not an evolve target; the enum is closed (KTD18)`,
      "unknown_target",
    );
  }
  // Reading the home is not cosmetic: it throws on a target this build does not know,
  // so a delta can never be planned against a home nobody decided.
  evolveHome(delta.target);

  if (delta.schema_version !== EVOLVE_DELTA_SCHEMA) {
    refuse(`delta schema must be ${EVOLVE_DELTA_SCHEMA}`, "scope");
  }
  if (!(EVOLVE_DELTA_OPS as readonly string[]).includes(delta.op)) {
    refuse(`unknown delta op '${String(delta.op)}'; ${EVOLVE_DELTA_OPS.join(" | ")}`, "scope");
  }
  const lint = lintReplacement(delta);
  if (lint) refuse(lint, "scope");

  // `before_hash` is REQUIRED on every apply, not just when the caller bothered to
  // supply one. An optional integrity check is not a check: the first cut treated a
  // missing hash as "nothing to compare" and overwrote whatever it found.
  if (!delta.before_hash) {
    refuse(
      `before_hash is required on every ${delta.op} (it is what makes this not an ` +
        `unchecked overwrite); re-read the span and propose again`,
      "hash_required",
    );
  }

  const located: PlaybookSpanLocation | null = locatePlaybookSpan(currentText, delta.span);
  if (delta.op === "add") {
    if (located) {
      refuse(
        `span '${delta.span}' already exists; \`add\` is for a genuinely new heading — ` +
          `use \`replace\` (R49: no stacked sections)`,
        "scope",
      );
    }
    // For `add` the region does not exist yet, so `before_hash` pins the WHOLE FILE.
    const fileHash = sha256(currentText);
    if (delta.before_hash !== fileHash) {
      refuse(
        `before_hash mismatch on ${delta.path}: an \`add\` pins the whole file, proposed ` +
          `${delta.before_hash.slice(0, 12)}…, on disk ${fileHash.slice(0, 12)}…`,
        "hash_mismatch",
      );
    }
    const anchor = `## ${delta.span}`;
    // The separator is PART of the span, not part of the head. Appending to a file
    // with no trailing newline used to add one outside the recorded region, so the
    // inverse put the region back and left the newline behind (codex r1 #9).
    const separator = currentText === "" || currentText.endsWith("\n") ? "" : "\n";
    const afterSpan = separator + renderPlaybookSpan(anchor, delta.replacement);
    const head = currentText;
    return {
      before: currentText,
      anchor,
      before_span: "",
      before_hash: fileHash,
      after_span: afterSpan,
      after_hash: sha256(afterSpan),
      next: head + afterSpan,
      head,
      tail: "",
      offset: head.length,
      head_hash: sha256(head),
      tail_hash: sha256(""),
      delta,
    };
  }

  if (!located) {
    refuse(
      `span '${delta.span}' is not in ${delta.path}; a replace never appends (R49)`,
      "span_missing",
    );
  }
  const beforeHash = sha256(located.text);
  if (delta.before_hash !== beforeHash) {
    refuse(
      `before_hash mismatch on span '${delta.span}' of ${delta.path}: proposed ` +
        `${delta.before_hash.slice(0, 12)}…, on disk ${beforeHash.slice(0, 12)}… — the span moved ` +
        `under the proposal. Re-read and re-propose; a replace never re-bases`,
      "hash_mismatch",
    );
  }

  const afterSpan =
    delta.op === "remove" ? "" : renderPlaybookSpan(located.anchor, delta.replacement);
  const head = currentText.slice(0, located.start);
  const tail = currentText.slice(located.end);
  return {
    before: currentText,
    anchor: located.anchor,
    before_span: located.text,
    before_hash: beforeHash,
    after_span: afterSpan,
    after_hash: sha256(afterSpan),
    next: head + afterSpan + tail,
    head,
    tail,
    offset: head.length,
    head_hash: sha256(head),
    tail_hash: sha256(tail),
    delta,
  };
}
