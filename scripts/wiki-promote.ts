#!/usr/bin/env -S npx tsx
/**
 * wiki-promote.ts — promote a staged decision candidate into the wiki (#220).
 *
 * `guild:decisions` stages `.guild/knowledge/candidates/decisions/<slug>.md`; the
 * lead promotes it through harvest, the only automatic wiki writer. This CLI is
 * that supported path: it reads the candidate and runs `harvestDecision`, which
 * screens it, writes `.guild/wiki/decisions/<slug>.md` through the scrubbing
 * writer, links it from `index.md`, appends `log.md`, and journals an inverse
 * `wiki-revert` can replay. It never commits.
 *
 *   npx tsx scripts/wiki-promote.ts <slug | candidate-path> [--run <run-id>] [--op <op-id>] [--cwd <dir>]
 *
 * Prints the harvest result as JSON. Exit 0 when the page was promoted; exit 1
 * when the candidate is missing or harvest refused (the JSON names why). A
 * blocked promotion resumes with the same `--run` and `--op`, so one op owns the
 * page and its inverse; a fresh op would journal the half-promoted page as "before".
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { harvestDecision } from "../src/domains/knowledge";
import { createGuildStorage, readScalarField } from "../src/domains/state";

interface Args {
  target: string | null;
  runId: string | null;
  opId: string | null;
  cwd: string;
}

export function parseArgs(argv: readonly string[]): Args {
  const out: Args = { target: null, runId: null, opId: null, cwd: process.env["GUILD_CWD"] ?? process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--run") out.runId = argv[++i] ?? null;
    else if (a.startsWith("--run=")) out.runId = a.slice(6);
    else if (a === "--op") out.opId = argv[++i] ?? null;
    else if (a.startsWith("--op=")) out.opId = a.slice(5);
    else if (a === "--cwd") out.cwd = argv[++i] ?? out.cwd;
    else if (a.startsWith("--cwd=")) out.cwd = a.slice(6);
    else if (!a.startsWith("-") && out.target === null) out.target = a;
  }
  return out;
}

export interface ParsedCandidate {
  slug: string;
  title: string;
  body: string;
  reasoning: string;
  source_refs: string[];
  replaces?: string;
}

const NULLISH = new Set(["", "null", "~"]);

/** Read an ADR-lite or `guild.decision.v1` candidate into harvest input. */
export function parseCandidate(text: string, fileSlug: string): ParsedCandidate {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const front = fm ? fm[0] : "";
  let body = fm ? text.slice(fm[0].length) : text;
  const field = (key: string): string | undefined => {
    const v = front ? readScalarField(front, key) : undefined;
    if (v === undefined) return undefined;
    const unq = v.trim().replace(/^["']|["']$/g, "");
    return NULLISH.has(unq) ? undefined : unq;
  };

  // The first H1 is the candidate's own title line; harvest renders its own.
  const h1 = /^#\s+(.+)\s*$/m.exec(body);
  if (h1 && body.slice(0, h1.index).trim() === "") body = body.slice(h1.index + h1[0].length);
  const slug = field("slug") ?? fileSlug;
  const title = field("title") ?? h1?.[1]?.trim() ?? slug;

  const decision = /^##\s+Decision\s*\n+([^\n]+)/m.exec(body)?.[1]?.trim();
  const reasoning = field("reasoning") ?? decision ?? `Promoted from the staged candidate ${slug}.`;

  const refsRaw = front ? readScalarField(front, "source_refs") : undefined;
  const source_refs = (refsRaw ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((r) => r.trim().replace(/^["']|["']$/g, ""))
    .filter((r) => r.length > 0);

  const replaces = field("replaces") ?? (field("supersedes") ? `decision:${field("supersedes")}` : undefined);
  return { slug, title, body: body.trim(), reasoning, source_refs, ...(replaces ? { replaces } : {}) };
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

const USAGE = "usage: wiki-promote <slug | candidate-path> [--run <run-id>] [--op <op-id>] [--cwd <dir>]\n";

export function runWikiPromoteCli(argv: string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv);
  if (!args.target) {
    process.stderr.write(`[wiki-promote] a candidate slug or path is required\n${USAGE}`);
    return 1;
  }
  if (args.opId && !args.runId) {
    process.stderr.write(`[wiki-promote] --op resumes an op in a run: pass the same --run\n${USAGE}`);
    return 1;
  }
  const cwd = path.resolve(args.cwd);
  const storage = createGuildStorage(cwd);
  const scope = storage.project ?? storage.workspace;
  if (!scope) {
    process.stderr.write("[wiki-promote] this root owns no wiki\n");
    return 1;
  }

  const candidatesDir = scope.definitions("knowledge", "candidates", "decisions");
  const candidatePath =
    args.target.endsWith(".md") || args.target.includes("/")
      ? path.resolve(cwd, args.target)
      : path.join(candidatesDir, `${args.target}.md`);
  // Only a staged decision candidate is promotable through this door.
  if (path.dirname(candidatePath) !== path.resolve(candidatesDir) || !fs.existsSync(candidatePath)) {
    process.stderr.write(`[wiki-promote] no staged decision candidate at ${candidatePath}\n`);
    return 1;
  }

  const fileSlug = path.basename(candidatePath, ".md").split(".")[0]!;
  const parsed = parseCandidate(fs.readFileSync(candidatePath, "utf8"), fileSlug);
  const runId = args.runId ?? `run-${stamp()}-promote-${parsed.slug}`;
  const runDir = scope.runRecord(runId);
  fs.mkdirSync(runDir, { recursive: true });

  const result = harvestDecision({
    run_id: runId,
    runDir,
    storage,
    trigger: "manual",
    slug: parsed.slug,
    title: parsed.title,
    body: parsed.body,
    reasoning: parsed.reasoning,
    source_refs: [...parsed.source_refs, `candidate:${path.relative(cwd, candidatePath)}`],
    ...(parsed.replaces ? { replaces: parsed.replaces } : {}),
    // An explicit operator promotion: the candidate already passed staging.
    autopromote: true,
    ...(args.opId ? { op_id: args.opId } : {}),
  });
  process.stdout.write(
    JSON.stringify({
      promoted: result.promoted,
      run_id: runId,
      op_id: result.op.op_id,
      status: result.op.status,
      ...(result.op.refuse_reason ? { refuse_reason: result.op.refuse_reason } : {}),
      ...(result.wiki_path ? { wiki_path: result.wiki_path } : {}),
      next_need: result.next_need,
    }) + "\n",
  );
  if (!result.promoted && result.blocked_confirm) {
    process.stderr.write(
      `[wiki-promote] blocked: ${result.blocked_detail ?? "see JSON"}. Fix it, then resume with --run ${runId} --op ${result.op.op_id}\n`,
    );
  }
  return result.promoted ? 0 : 1;
}

if (require.main === module) {
  process.exit(runWikiPromoteCli());
}
