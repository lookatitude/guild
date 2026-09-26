/**
 * evolve-apply.ts — the ONE evolve gate, routing to its TWO homes (KTD18 / R32 / R74).
 *
 * `applyEvolveDelta` is the only function in the domain that turns a
 * `guild.evolve_delta.v1` into bytes on disk, and what it does is decided entirely by
 * the target's home:
 *
 *   PROJECT home (`skill | playbook | profile | glossary`)
 *     The delta lands under THIS repo's own `.guild/` tree, in the sub-tree that owns
 *     that target, with the inverse recorded in compact history first. The plugin
 *     install dir is not a candidate target and neither is the plugin's starter
 *     feedstock: a project's live specialist body is the minted copy under its own
 *     `.guild/agents/`, never the recipe it was minted from (KTD20).
 *
 *   PLUGIN home (`assembler | command | agent | hook | adapter | learn_script |
 *     domain_ts`)
 *     NOTHING is written to the machinery. The delta is serialized as a CANDIDATE
 *     under the plugin's own `.guild/evolve/candidates/`, and the result carries
 *     `next_need: "operator"`. Promotion into `src/surfaces/**` (or `src/` for the four
 *     KTD63 types) is a human commit after compile + D5 + adapter-matrix tests. This is
 *     not a policy the function checks and could forget — `assertNotRuntimeTree` makes
 *     the machinery unreachable from any writer in this module.
 *
 * The automatic (KTD33) path is the cheap curator and is narrower still: it may only
 * carry `playbook` and `skill`, and it fails closed on everything else with
 * `next_need: "operator"`. A `--target=domain_ts` under `--auto` never reaches the
 * candidate write either — it is refused at the gate, because an unattended run
 * queueing machinery candidates is how a human gate becomes a rubber stamp.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { atomicWriteDurable, createGuildStorage, type GuildStorage } from "../state";
import { assertNotRuntimeTree, checkContained, isRefused } from "../kernel";
import {
  SCRUBBED_WRITER_BRAND,
  assertScrubbedWriter,
  locatePlaybookSpan,
  type WikiWriter,
} from "../knowledge";
import { scrubbedWrite } from "../security";
import { gateProfileCreation } from "../teams";
import {
  assertCheapCurator,
  planEvolveDelta,
  sha256,
  type EvolveDelta,
  type EvolveDeltaPlan,
} from "./evolve-delta";
import {
  EvolveTargetRefusal,
  assertAutoPathAllowed,
  assertNotPermissionEdit,
  classifyAutoPath,
  classifyFileClass,
  classifyPermissionContent,
  evolveHome,
  type EvolveHome,
  type EvolveTarget,
} from "./evolve-targets";
import { recordEvolveDelta, type EvolveHistoryEntry } from "./compact-history";

export interface EvolveApplyContext {
  cwd?: string;
  storage?: GuildStorage;
  runId?: string;
  /** The plugin install root. Defaults to `cwd` (the self-build case, where they are one). */
  pluginRoot?: string;
  /** True for the KTD33 automatic path. Default false = explicit `maintain evolve`. */
  auto?: boolean;
  /**
   * The run record dir. REQUIRED for the `glossary` target: the glossary is a wiki
   * page, so its bytes go out through the branded scrubbing writer (KTD37), and that
   * writer emits its security events onto this run.
   */
  runDir?: string;
  /** Injected in tests. Production gets the branded scrubbing writer. */
  writer?: WikiWriter;
  /**
   * The plugin root's storage, for machinery candidates. Injected in tests so a
   * fixture can point both roots at its own sandbox; production derives it from
   * `pluginRoot`.
   */
  plugin_storage?: GuildStorage;
  /** The rollback key. Defaults to the delta file's basename without extension. */
  historyKey?: string;
  now?: () => Date;
}

export interface EvolveApplyResult {
  target: EvolveTarget;
  home: EvolveHome;
  applied: boolean;
  /** The file written, for a project-home apply. */
  path?: string;
  /** The candidate written, for a plugin-home delta. */
  candidate_path?: string;
  /** The compact-history entry, for a project-home apply. */
  history?: EvolveHistoryEntry;
  /** Set whenever a human must act before anything reaches the machinery. */
  next_need?: "operator";
  detail: string;
}

/**
 * The production glossary writer: `scrubbedWrite` on the `wiki` surface, branded so
 * `assertScrubbedWriter` accepts it. Declared here rather than reusing harvest's copy
 * so this module carries its own `scrubbedWrite` CALL SITE — the KTD37 lint reads call
 * sites, and a module that reaches the choke point only through another module's
 * closure is indistinguishable, to the grep, from one that skips it.
 */
const GLOSSARY_WRITER: WikiWriter = Object.assign(
  (absPath: string, content: string, opts: { runDir: string; runId: string; laneId?: string }) =>
    scrubbedWrite(absPath, content, { surface: "wiki", ...opts }),
  { [SCRUBBED_WRITER_BRAND]: true as const },
);

function storageFor(ctx: EvolveApplyContext): GuildStorage {
  return ctx.storage ?? createGuildStorage(ctx.cwd ?? process.cwd());
}

/**
 * The project sub-tree that owns each project-home target. Every one is reached
 * through `GuildStorage`, so none of these lines builds a `.guild` path (KTD15).
 */
export function projectTargetRoot(storage: GuildStorage, target: EvolveTarget): string {
  switch (target) {
    case "skill":
      return path.resolve(storage.definition("skills"));
    case "playbook":
      return path.resolve(storage.definition("playbooks"));
    case "profile":
      return path.resolve(storage.definition("agents"));
    case "glossary": {
      const scope = storage.project ?? storage.workspace;
      if (!scope) {
        throw new EvolveTargetRefusal(
          "this root owns no knowledge scope, so it has no glossary to evolve",
          "scope",
        );
      }
      return path.resolve(scope.knowledge());
    }
    default:
      throw new EvolveTargetRefusal(
        `'${target}' is plugin machinery and has no project home (KTD18)`,
        "human_gate",
      );
  }
}

/**
 * Refuse a project-home target outside the sub-tree that owns it. Same kernel
 * primitive and same policy the harvest writer uses for the wiki and the playbook:
 * a `../` spelling or a symlinked file must be REFUSED, not guessed (R67).
 */
export function assertProjectHome(
  storage: GuildStorage,
  target: EvolveTarget,
  absTarget: string,
): void {
  const root = projectTargetRoot(storage, target);
  fs.mkdirSync(root, { recursive: true });
  const contained = checkContained(root, path.resolve(absTarget), { policy: "resolve" });
  if (contained === null || isRefused(contained)) {
    throw new EvolveTargetRefusal(
      `project RSI writes under this repo's own .guild/ only; '${path.resolve(absTarget)}' is ` +
        `outside '${root}'${contained && isRefused(contained) ? ` [${contained.code}]` : ""} (DH-3/R32)`,
      "scope",
    );
  }
}

/**
 * Where a plugin-home candidate is parked. Never the machinery it describes.
 *
 * `storage` here is the PLUGIN root's storage, not the consuming repo's. The first
 * cut used whichever storage the caller happened to pass, so on a real install
 * (consuming repo ≠ plugin root) every machinery candidate landed in the user's own
 * `.guild/evolve/` and the plugin root — the thing an operator actually reviews
 * before committing machinery — received nothing at all.
 */
export function candidatePath(storage: GuildStorage, delta: EvolveDelta, id: string): string {
  return storage.definition("evolve", "candidates", `${delta.target}-${id}.json`);
}

/** The plugin root's own storage. Machinery candidates live here and only here. */
function pluginStorage(ctx: EvolveApplyContext, fallback: GuildStorage): GuildStorage {
  if (ctx.plugin_storage) return ctx.plugin_storage;
  const root = ctx.pluginRoot;
  if (!root || path.resolve(root) === path.resolve(fallback.activeRoot)) return fallback;
  return createGuildStorage(root, { activeRoot: root, profile: "standalone" });
}

/**
 * Serialize a delta as a candidate and stop. Returns the path written.
 *
 * The candidate carries the delta verbatim plus the human checklist, so the operator
 * who promotes it is looking at the same span and the same `before_hash` the proposer
 * saw — a promotion that silently re-based would be the hole this whole module closes.
 *
 * The NAME carries a content hash, and the file is created with the `wx` flag so an
 * existing name is an error rather than an overwrite. The first cut derived the name
 * from a 14-character timestamp; two proposals inside the same second produced one
 * path and the second silently replaced the first, which loses a queued proposal
 * exactly when a run is generating several.
 */
function writeCandidate(
  storage: GuildStorage,
  delta: EvolveDelta,
  ctx: EvolveApplyContext,
  reason: string,
): string {
  const now = (ctx.now ?? (() => new Date()))();
  const body =
    `${JSON.stringify(
      {
        schema_version: "guild.evolve_candidate.v1",
        created_at: now.toISOString(),
        run_id: ctx.runId ?? "",
        home: "plugin",
        reason,
        delta,
        promote_requires: [
          "a human commit into src/surfaces/** (machinery) or src/ (hook|adapter|learn_script|domain_ts)",
          "compile",
          "D5 permission review",
          "adapter-matrix tests",
        ],
      },
      null,
      2,
    )}\n`;

  const stamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const digest = sha256(body).slice(0, 12);
  const cwd = ctx.cwd ?? storage.activeRoot;

  // A distinct proposal gets a distinct name from its own content; two proposals that
  // are byte-identical get a numbered sibling rather than clobbering each other.
  for (let attempt = 0; attempt < 64; attempt++) {
    const suffix = attempt === 0 ? `${stamp}-${digest}` : `${stamp}-${digest}-${attempt}`;
    const p = candidatePath(storage, delta, suffix);
    assertNotRuntimeTree(path.dirname(p), ctx.pluginRoot ?? cwd, cwd);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    try {
      // `wx` — create-or-fail. The collision is reported by the filesystem, not
      // guessed from a prior `existsSync` that another writer can invalidate.
      fs.writeFileSync(p, body, { encoding: "utf8", flag: "wx" });
      return p;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new EvolveTargetRefusal(
    "could not find a free candidate name after 64 attempts",
    "scope",
  );
}

/** A candidate-only outcome: nothing reached the live file. */
function candidateOutcome(
  delta: EvolveDelta,
  ctx: EvolveApplyContext,
  storage: GuildStorage,
  home: EvolveHome,
  reason: string,
): EvolveApplyResult {
  const p = writeCandidate(pluginStorage(ctx, storage), delta, ctx, reason);
  return {
    target: delta.target,
    home,
    applied: false,
    candidate_path: p,
    next_need: "operator",
    detail: reason,
  };
}

/**
 * Run one delta through the gate.
 *
 * Order matters, and every step before the write is a REFUSAL or a CANDIDATE, never a
 * partial application:
 *
 *   1. the target token is not a permission token (D5, the cheap check);
 *   2. the CONTENT is not a permission edit — heading, frontmatter key, or changed
 *      approval language — on ANY target, auto or not (D5, the real check);
 *   3. the auto path may carry this target at all;
 *   4. machinery targets become a candidate under the PLUGIN root;
 *   5. the file is a markdown/text definition, whatever token was passed;
 *   6. a curator/auto delta satisfies the cheap-curator contract;
 *   7. plan → record the inverse → write.
 *
 * @throws EvolveTargetRefusal on an unknown target, an auto-path violation, a
 *   non-definition file class, a missing or mismatched `before_hash`, a curator span
 *   that is not template-rendered, or unreadable compact history.
 */
export function applyEvolveDelta(
  delta: EvolveDelta,
  ctx: EvolveApplyContext = {},
): EvolveApplyResult {
  assertNotPermissionEdit(String(delta.target));
  const home = evolveHome(delta.target);
  const storage = storageFor(ctx);
  const cwd = ctx.cwd ?? storage.activeRoot;
  const abs = path.resolve(cwd, delta.path);
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";

  // ── D5 as a CONTENT class (codex r1 #1) ──────────────────────────────────
  //
  // Read the span as it stands so a permissions block is caught by what it SAYS, not
  // by the token the caller chose. This runs before the auto-path check, because a
  // permission edit is proposal-only on every target including the two the curator
  // may otherwise write.
  const located = current === "" ? null : locatePlaybookSpan(current, delta.span);
  const d5 = classifyPermissionContent({
    span: delta.span,
    beforeSpan: located?.text ?? "",
    replacement: delta.replacement,
  });
  if (d5.isPermissionEdit) {
    return candidateOutcome(
      delta,
      ctx,
      storage,
      home,
      `permissions are proposal-only (D5): ${d5.detail}. The live file is unchanged; ` +
        `a human reviews the candidate`,
    );
  }

  if (ctx.auto) {
    // Fail closed BEFORE the home split: an unattended run must not even queue a
    // machinery candidate (R74).
    assertAutoPathAllowed(delta.target);
  }

  if (home === "plugin") {
    const verdict = classifyAutoPath(delta.target);
    return candidateOutcome(
      delta,
      ctx,
      storage,
      home,
      verdict.reason ??
        `'${delta.target}' is plugin machinery; the candidate is parked for a human commit (KTD63)`,
    );
  }

  assertProjectHome(storage, delta.target, abs);
  assertNotRuntimeTree(path.dirname(abs), ctx.pluginRoot ?? cwd, cwd);

  // Project RSI edits a profile; it never CREATES one. Creation is class-scoped
  // (R67) and this writer has no bound class, so the one creation seam refuses.
  if (delta.target === "profile" && !fs.existsSync(abs)) {
    const gate = gateProfileCreation({
      workflow_class: null,
      role: path.basename(abs, path.extname(abs)),
      writer: "evolve.apply",
    });
    if (!gate.ok) throw new EvolveTargetRefusal(gate.reason, "scope");
  }

  // ── file class beats the token (codex r1 #2) ─────────────────────────────
  //
  // `.guild/skills/script.ts` is inside the project's own skills tree, so containment
  // said yes; a markdown heading inside a `//` comment gave the span a home; and the
  // writer emitted executable TypeScript. The file's own class is the KTD63 question.
  const fileClass = classifyFileClass(abs, current.slice(0, 512));
  if (!fileClass.writable) {
    return candidateOutcome(
      delta,
      ctx,
      storage,
      "plugin",
      `${fileClass.detail}; '${path.basename(abs)}' is ` +
        `${fileClass.reclassified_as} class whatever the token said, so it is human-only (KTD63)`,
    );
  }

  // ── the cheap-curator contract, actually wired (codex r1 #3) ─────────────
  //
  // Declared since the first cut and called by nothing, which is how an automatic
  // `add` with no `before_hash` reached the writer.
  if (ctx.auto || delta.proposer === "curator") {
    assertCheapCurator(delta);
  }

  const plan: EvolveDeltaPlan = planEvolveDelta({ ...delta, path: abs }, current);

  // Inverse first: the record is fsynced before the file moves.
  const history = recordEvolveDelta(ctx.historyKey ?? path.basename(abs, path.extname(abs)), plan, {
    cwd,
    storage,
    runId: ctx.runId,
    pluginRoot: ctx.pluginRoot,
    now: ctx.now,
  });

  fs.mkdirSync(path.dirname(abs), { recursive: true });

  if (delta.target === "glossary") {
    // The glossary IS a wiki page. KTD37 has exactly one choke point for wiki bytes,
    // and "the evolve writer is not harvest" is not a reason to route around it — an
    // unscreened glossary term is a prompt injection with a persistence mechanism,
    // because every later lane reads the terms it hits.
    if (!ctx.runDir) {
      throw new EvolveTargetRefusal(
        "a glossary evolve needs runDir: its bytes go out through the scrubbing wiki writer (KTD37)",
        "scope",
      );
    }
    const writer = assertScrubbedWriter(ctx.writer ?? GLOSSARY_WRITER);
    const wrote = writer(abs, plan.next, { runDir: ctx.runDir, runId: ctx.runId ?? "" });
    if (!wrote.written) {
      return {
        target: delta.target,
        home,
        applied: false,
        path: abs,
        history,
        next_need: "operator",
        detail: "the scrub blocked the glossary write; the span is unchanged",
      };
    }
  } else {
    atomicWriteDurable(abs, plan.next);
  }

  return {
    target: delta.target,
    home,
    applied: true,
    path: abs,
    history,
    detail: `replaced the span '${delta.span}' under this repo's own durable tree`,
  };
}
