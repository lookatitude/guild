/**
 * scripts/lint/baseline-shrink-gate.ts — the layout baseline may only SHRINK.
 *
 * codex G-lane r1 found the hole: `lint:layout` reads the PR's own baseline, so a
 * PR that adds a violation AND adds a matching baseline entry is green. The
 * shrink-only rule (T01) was a convention with nothing enforcing it. This compares
 * the PR's baseline against the BASE revision's and fails on any added entry.
 *
 * Removals are always allowed — but a removal only passes `lint:layout` when the
 * violation was actually fixed, so the two gates together give: fix-and-shrink OK,
 * shrink-without-fix caught by lint, grow caught here.
 *
 * Usage:
 *   baseline-shrink-gate.ts --base <git-ref>      compare against that ref
 *   baseline-shrink-gate.ts --base-file <path>    compare against a file (tests)
 *
 * Exit 0 same or smaller · 1 an entry was added · 2 the base could not be read.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "..", "..");
const BASELINE_REL = "scripts/lint/layout-baseline.json";

const ADDITIONS_REL = "scripts/lint/baseline-additions.json";

interface BaselineAddition {
  key: string;
  reason: string;
  lane: string;
}

const ADDITION_FIELDS = ["key", "reason", "lane"] as const;
const MIN_REASON = 40;

/** A declaration file that could not be trusted, with the exact reason. */
class MalformedDeclarations extends Error {}

/**
 * PR-scoped, PER-KEY declarations for baseline additions.
 *
 * A per-CHECK waiver (r2) was too coarse; every added key is listed individually
 * with a reason and the owning lane (r3). And a malformed entry is now a HARD
 * FAILURE, not a silent drop (codex G-lane r4): dropping `{"key": "still-present"}`
 * made a half-written declaration look like an absent one, so the file could read as
 * empty on a channel branch while still carrying text, and a typo'd field silently
 * withdrew a waiver the author believed was in force. Fail loudly in every mode,
 * before any other check, with exit 2.
 *
 * `rawCount` is the number of entries the file literally contains — the emptiness
 * check on next/main uses that, never the parsed count, so nothing can be "empty"
 * by being unparseable.
 */
function readDeclaredAdditions(root: string): { declarations: BaselineAddition[]; rawCount: number } {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(root, ADDITIONS_REL), "utf8");
  } catch {
    return { declarations: [], rawCount: 0 }; // absent file = no declarations
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw new MalformedDeclarations(`${ADDITIONS_REL}: not valid JSON — ${(e as Error).message}`);
  }
  const additions = (doc as { additions?: unknown }).additions;
  if (!Array.isArray(additions)) {
    throw new MalformedDeclarations(`${ADDITIONS_REL}: "additions" must be an array`);
  }

  const problems: string[] = [];
  const out: BaselineAddition[] = [];
  additions.forEach((a, i) => {
    const at = `additions[${i}]`;
    if (typeof a !== "object" || a === null || Array.isArray(a)) {
      problems.push(`${at}: must be an object`);
      return;
    }
    const rec = a as Record<string, unknown>;
    for (const f of ADDITION_FIELDS) {
      if (!(f in rec)) problems.push(`${at}: missing "${f}"`);
      else if (typeof rec[f] !== "string") problems.push(`${at}.${f}: must be a string`);
      else if ((rec[f] as string).trim().length === 0) problems.push(`${at}.${f}: must not be empty`);
    }
    // An unknown field is a typo or a field the author expected to mean something.
    for (const k of Object.keys(rec)) {
      if (!(ADDITION_FIELDS as readonly string[]).includes(k)) problems.push(`${at}: unknown field "${k}"`);
    }
    if (typeof rec.reason === "string" && rec.reason.trim().length > 0 &&
        rec.reason.trim().length < MIN_REASON) {
      problems.push(`${at}.reason: too short (${rec.reason.trim().length} < ${MIN_REASON} chars)`);
    }
    if (problems.length === 0) out.push(rec as unknown as BaselineAddition);
  });
  if (problems.length > 0) {
    throw new MalformedDeclarations(
      `${ADDITIONS_REL}: ${problems.length} malformed declaration(s)\n  ` + problems.slice(0, 20).join("\n  "),
    );
  }
  return { declarations: out, rawCount: additions.length };
}

/** True on a push to a channel branch, where a PR-scoped declaration must not survive. */
function isChannelRef(ref: string | undefined): boolean {
  if (!ref) return false;
  const name = ref.replace(/^refs\/heads\//, "");
  return name === "next" || name === "main";
}

function entriesOf(json: string, source: string): string[] {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch (e) {
    throw new Error(`${source}: not valid JSON — ${(e as Error).message}`);
  }
  const entries = (doc as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) throw new Error(`${source}: no "entries" array`);
  return entries.map(String);
}

function readBaseFromGit(ref: string): string {
  const r = spawnSync("git", ["show", `${ref}:${BASELINE_REL}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`git show ${ref}:${BASELINE_REL} failed — ${(r.stderr ?? "").trim()}`);
  }
  return r.stdout;
}

function main(argv: string[]): number {
  // BEFORE anything else and in EVERY mode: a declaration file we cannot trust is a
  // hard failure, never a silent empty list.
  let declarations: BaselineAddition[];
  let rawDeclarationCount: number;
  try {
    ({ declarations, rawCount: rawDeclarationCount } = readDeclaredAdditions(ROOT));
  } catch (e) {
    if (e instanceof MalformedDeclarations) {
      process.stderr.write(`baseline-shrink-gate: malformed declaration\n  ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  const baseIdx = argv.indexOf("--base");
  const fileIdx = argv.indexOf("--base-file");
  if (baseIdx < 0 && fileIdx < 0) {
    process.stderr.write("usage: baseline-shrink-gate.ts --base <git-ref> | --base-file <path>\n");
    return 2;
  }

  let baseJson: string;
  let label: string;
  try {
    if (fileIdx >= 0) {
      label = argv[fileIdx + 1] ?? "";
      baseJson = fs.readFileSync(label, "utf8");
    } else {
      label = argv[baseIdx + 1] ?? "";
      baseJson = readBaseFromGit(label);
    }
  } catch (e) {
    process.stderr.write(`baseline-shrink-gate: ${(e as Error).message}\n`);
    return 2;
  }

  let base: string[];
  let head: string[];
  try {
    base = entriesOf(baseJson, `base (${label})`);
    head = entriesOf(fs.readFileSync(path.join(ROOT, BASELINE_REL), "utf8"), "PR");
  } catch (e) {
    process.stderr.write(`baseline-shrink-gate: ${(e as Error).message}\n`);
    return 2;
  }

  const baseSet = new Set(base);
  const added = [...new Set(head.filter((e) => !baseSet.has(e)))].sort();
  const headSet = new Set(head);
  const removed = base.filter((e) => !headSet.has(e)).length;

  const declaredKeys = new Set(declarations.map((d) => d.key));
  const headSetAll = new Set(head);

  process.stdout.write(
    `baseline-shrink-gate — base ${base.length} entries (${label}), PR ${head.length}; ` +
      `${removed} removed, ${added.length} added; ${rawDeclarationCount} declaration(s)\n`,
  );

  let failed = 0;

  // Declarations are PR-scoped. On a channel branch the file must be empty, or a
  // one-PR waiver has quietly become permanent.
  const ref = process.env.GITHUB_REF ?? process.env.GUILD_GATE_REF;
  if (isChannelRef(ref) && rawDeclarationCount > 0) {
    failed++;
    process.stdout.write(
      `FAIL — ${ADDITIONS_REL} carries ${rawDeclarationCount} entr(y|ies) on ${ref}. ` +
        `Declarations live for the life of a PR:\n` +
        `       fix the violations, or carry the entries with a fresh declaration on the next PR.\n`,
    );
    for (const d of declarations.slice(0, 10)) process.stdout.write(`  still declared (${d.lane}) ${d.key}\n`);
  }

  // Every ADDED key must be declared.
  const undeclared = added.filter((e) => !declaredKeys.has(e));
  if (undeclared.length > 0) {
    failed++;
    process.stdout.write(
      `FAIL — ${undeclared.length} baseline addition(s) are not declared in ${ADDITIONS_REL}.\n` +
        `       A new violation must be FIXED, not waived. If an addition is legitimate,\n` +
        `       list it as {key, reason, lane}.\n`,
    );
    for (const a of undeclared.slice(0, 20)) process.stdout.write(`  + ${a}\n`);
    if (undeclared.length > 20) process.stdout.write(`  … ${undeclared.length - 20} more\n`);
  }

  // Every DECLARED key must still be in the baseline — a declaration that outlives
  // its entry is stale and would silently pre-authorise re-adding it.
  const stale = declarations.filter((d) => !headSetAll.has(d.key));
  if (stale.length > 0) {
    failed++;
    process.stdout.write(
      `FAIL — ${stale.length} stale declaration(s): listed in ${ADDITIONS_REL} but absent from the baseline.\n`,
    );
    for (const d of stale.slice(0, 20)) process.stdout.write(`  ? (${d.lane}) ${d.key}\n`);
  }

  if (failed === 0) {
    for (const d of declarations) process.stdout.write(`  declared (${d.lane}) ${d.key.split("::")[0]}\n`);
  }
  return failed === 0 ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
