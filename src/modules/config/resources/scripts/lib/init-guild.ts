/**
 * scripts/lib/init-guild.ts
 *
 * P? — init-config-goal lane L2 (§E4 init API, §E7a repair-by-manifest + config
 * reconcile). The plugin-owned initialization + repair functions that `/guild:init`
 * and host-open init/repair drive. STRUCTURED RESULTS + file writes only — no UI.
 *
 *   initializeGuild(root, mode)  — scaffold a `single_project` | `workspace` install
 *                                  from the versioned manifest, then materialize
 *                                  settings.json through the reconciler (no drift,
 *                                  §E4) and validate via resolveSettings.
 *   repairGuildInstall(cwd)      — classify an incomplete `.guild/` and repair by
 *                                  manifest + config reconcile/repair, NEVER
 *                                  clobbering user-authored content (§E7a / V7).
 *
 * NEVER-CLOBBER (spec §O lines 112-119): a present file is overwritten only when
 * it is genuinely missing; an existing copy is `already_present` iff its embedded
 * schema `version` (or `expected_hash`) matches, else `skipped_user_modified`
 * (manual review). `.guild/settings.json` is `reconcile-only` — only the config
 * reconciler writes it.
 *
 * L3 SEAMS (NOT this lane): §E7b fail-closed SECURITY reconcile and §E13
 * `.gitignore` policy are owned by L3 (security-auditor). They are wired here as
 * injectable hooks with inert no-op defaults — this lane never implements security
 * or gitignore logic. L3 replaces `reconcileSecurity` / `updateGitignore`.
 *
 * Module: config (owns config-reconcile/config-schema). Owned by tooling-engineer (L2).
 */

import * as nodeFs from "fs";
import * as path from "path";
import {
  type ScaffoldEntry,
  type ScaffoldMode,
  scaffoldFor,
} from "./init-scaffold-manifest";
import {
  type GuildStateResult,
  type InitMode,
  detectGuildState,
  detectChildGitRepos,
} from "./host-open-preflight";
import {
  type ReconcileIO,
  type ReconcileRunResult,
  reconcileConfig,
} from "./config-reconcile";
import { flattenSettings, setDotted } from "./config-schema";
import {
  type ResolvedConfig,
  type Source,
  resolveSettings,
} from "./settings-resolver";

// ---------------------------------------------------------------------------
// Injectable IO (CI-safe + test-injectable; production uses node fs)
// ---------------------------------------------------------------------------

export interface InitGuildIO {
  exists(p: string): boolean;
  isDir(p: string): boolean;
  isFile(p: string): boolean;
  readText(p: string): string | null;
  writeText(p: string, text: string): void;
  ensureDir(p: string): void;
}

export function defaultInitGuildIO(): InitGuildIO {
  const stat = (p: string): nodeFs.Stats | null => {
    try {
      return nodeFs.statSync(p);
    } catch {
      return null;
    }
  };
  return {
    exists: (p) => stat(p) !== null,
    isDir: (p) => {
      const s = stat(p);
      return s !== null && s.isDirectory();
    },
    isFile: (p) => {
      const s = stat(p);
      return s !== null && s.isFile();
    },
    readText: (p) => {
      try {
        return nodeFs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    writeText: (p, text) => nodeFs.writeFileSync(p, text, "utf8"),
    ensureDir: (p) => nodeFs.mkdirSync(p, { recursive: true }),
  };
}

/** Adapt an InitGuildIO to the reconciler's narrower IO so one injected IO drives both. */
function toReconcileIO(io: InitGuildIO): ReconcileIO {
  return {
    readFileText: (p) => io.readText(p),
    writeFileText: (p, text) => io.writeText(p, text),
    ensureDir: (p) => io.ensureDir(p),
  };
}

// ---------------------------------------------------------------------------
// L3 seams — §E7b fail-closed security reconcile + §E13 .gitignore policy
// ---------------------------------------------------------------------------

export interface SecurityReconcileContext {
  readonly cwd: string;
  readonly mode: "init" | "repair";
  readonly io: InitGuildIO;
  /** RFC3339 UTC stamp for the provenance sidecar on coerced keys (deterministic). */
  readonly now?: string;
}
export interface SecurityReconcileOutcome {
  readonly applied: boolean;
  readonly note: string;
  /** Keys coerced to their fail-closed value (populated by L3). */
  readonly coerced?: ReadonlyArray<{ key: string; from: unknown; to: unknown }>;
}
export type ReconcileSecurityFn = (ctx: SecurityReconcileContext) => SecurityReconcileOutcome;

// ---------------------------------------------------------------------------
// §E7b fail-closed security policy (V14) — the DETERMINISTIC security gate.
//
// This is the authoritative, code-level fail-closed table (not model prose): a
// malformed value for one of these keys is coerced to its MOST-RESTRICTIVE value,
// never to the (possibly wider) schema default and never widened. It is a
// defense-in-depth pass over the post-reconcile settings.json that closes two gaps
// the general reconciler leaves open:
//   1. INIT runs `reconcileConfig` in `sync` mode (fills missing only — no repair),
//      so a pre-existing malformed security value would survive init untouched.
//   2. The reconciler never rewrites a `user`-provenance value; a malformed
//      `user` security value would otherwise stay corrupt/wide.
// In the `repair` path the reconciler has already coerced malformed default/
// reconciled security values to `most_restrictive`, so this pass is a no-op for
// those — it only fires on the residual init/sync + user-provenance cases.
//
// NOTE: three of these defaults are WIDER than the fail-closed value
// (bypass="audit", codex_skip="warn", fail_mode_telemetry="open"), which is exactly
// why coercion targets the explicit fail-closed value here rather than the default.
// ---------------------------------------------------------------------------

function isStringArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

interface FailClosedRule {
  /** Flattened dotted config key. */
  readonly key: string;
  /** True when the value is well-formed (left untouched — never widened). */
  readonly isValid: (value: unknown) => boolean;
  /** The most-restrictive value applied when `isValid` is false (or the key is absent). */
  readonly failClosed: unknown;
}

/** The fail-closed coercion table — one rule per security-sensitive key in V14. */
export const SECURITY_FAIL_CLOSED_POLICY: readonly FailClosedRule[] = [
  {
    key: "security.bypass_permissions_policy",
    isValid: (v) => v === "deny" || v === "audit" || v === "allow",
    failClosed: "deny",
  },
  {
    key: "codex_skip_enforcement",
    isValid: (v) => v === "warn" || v === "block",
    failClosed: "block",
  },
  {
    key: "secrets_policy.fail_mode_durable",
    isValid: (v) => v === "closed" || v === "open",
    failClosed: "closed",
  },
  {
    key: "secrets_policy.fail_mode_telemetry",
    isValid: (v) => v === "open" || v === "closed",
    failClosed: "closed",
  },
  { key: "auto_approve", isValid: isStringArray, failClosed: [] as string[] },
  { key: "defaults.gates.auto_approve", isValid: isStringArray, failClosed: [] as string[] },
];

interface ProvenanceSidecarRecord {
  provenance: "default" | "user" | "reconciled";
  last_reconciled_at: string | null;
}

function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * §E7b — fail-closed security reconciliation (V14). Reads the post-reconcile
 * `.guild/settings.json`, coerces any MALFORMED security key to its most-restrictive
 * value (deny / block / closed / []), and writes the result back through the config
 * module's settings serialization (the injected IO seam — never direct fs). Valid
 * values are left untouched (never widened). The provenance sidecar is updated so a
 * coerced key reads as `reconciled`, not as a (wide) user value.
 */
export const reconcileSecurity: ReconcileSecurityFn = (ctx) => {
  const settingsPath = path.join(ctx.cwd, ...SETTINGS_REL.split("/"));
  const obj = parseJsonObject(ctx.io.readText(settingsPath));
  if (obj === null) {
    return {
      applied: false,
      note: "settings.json absent or unparseable — no security coercion applied.",
      coerced: [],
    };
  }

  const flat = flattenSettings({ ...obj });
  const coerced: Array<{ key: string; from: unknown; to: unknown }> = [];

  for (const rule of SECURITY_FAIL_CLOSED_POLICY) {
    const present = rule.key in flat;
    const current = flat[rule.key];
    if (present && rule.isValid(current)) continue; // well-formed ⇒ never widened/touched
    // Malformed (or absent due to a corrupt parent block) ⇒ fail closed.
    setDotted(obj, rule.key, rule.failClosed);
    coerced.push({ key: rule.key, from: present ? current : undefined, to: rule.failClosed });
  }

  if (coerced.length === 0) {
    return { applied: false, note: "security reconcile: all keys well-formed — no coercion.", coerced: [] };
  }

  // Write settings.json back through the config serialization contract (byte-clean,
  // 2-space + trailing newline, _help preserved in place) via the injected IO seam.
  ctx.io.writeText(settingsPath, JSON.stringify(obj, null, 2) + "\n");

  // Update the provenance sidecar so each coerced key reads `reconciled` (security-
  // enforced), never a wide `user` value. Absent/unparseable sidecar ⇒ start fresh.
  const provenancePath = path.join(ctx.cwd, ".guild", "settings.provenance.json");
  const sidecar = (parseJsonObject(ctx.io.readText(provenancePath)) ??
    {}) as Record<string, ProvenanceSidecarRecord>;
  for (const c of coerced) {
    sidecar[c.key] = { provenance: "reconciled", last_reconciled_at: ctx.now ?? null };
  }
  ctx.io.writeText(provenancePath, JSON.stringify(sidecar, null, 2) + "\n");

  return {
    applied: true,
    note: `fail-closed security reconcile (${ctx.mode}): coerced ${coerced.map((c) => c.key).join(", ")}.`,
    coerced,
  };
};

export interface GitignoreContext {
  readonly cwd: string;
  readonly mode: "init" | "repair";
  /** Absolute paths of detected child git repos (anchored ignore lines, workspace shape). */
  readonly childGitRepos: readonly string[];
  readonly io: InitGuildIO;
}
export interface GitignoreOutcome {
  readonly applied: boolean;
  readonly note: string;
}
export type UpdateGitignoreFn = (ctx: GitignoreContext) => GitignoreOutcome;

// ---------------------------------------------------------------------------
// §E13 `.gitignore` policy (V13) — preserve user content, one managed Guild block.
// ---------------------------------------------------------------------------

const GUILD_MANAGED_BEGIN = "# BEGIN Guild managed";
const GUILD_MANAGED_END = "# END Guild managed";

/**
 * The canonical managed-block body (spec §.gitignore policy), in EXACT order. V13
 * anti-vacuity: removing any one of these lines must fail the gitignore-policy test.
 * Shared Guild files are git-tracked (`!`-includes); local/runtime state is ignored.
 */
const GUILD_MANAGED_LINES: readonly string[] = [
  ".guild",
  "!/.guild/",
  "!.guild/wiki/",
  "!.guild/wiki/**",
  "!.guild/initiatives/",
  "!.guild/initiatives/**",
  "!.guild/spec/",
  "!.guild/spec/**",
  "!.guild/plan/",
  "!.guild/plan/**",
  "!.guild/prd/",
  "!.guild/prd/**",
  "!.guild/team/",
  "!.guild/team/**",
  "!.guild/reflections/",
  "!.guild/reflections/**",
  "!.guild/evolve/",
  "!.guild/evolve/**",
  "!.guild/indexes/",
  "!.guild/indexes/**",
  "!.guild/workspace.json",
  "!.guild/settings.json",
  "!.guild/runs/",
  "!.guild/runs/*/",
  ".guild/runs/*/**",
  "!.guild/runs/*/handoffs/",
  "!.guild/runs/*/handoffs/**",
  "!.guild/runs/*/verify.md",
  "!.guild/runs/*/review.md",
  "!.guild/runs/*/provenance.json",
  "!.guild/runs/*/run.yaml",
  "!.guild/runs/*/summary.md",
  "!.guild/runs/*/share-payloads.flag",
  ".guild/settings.local.json",
  ".guild/hosts/",
  "**/*.structural-cache.json",
];

/** The required (V13) ignore/include lines — exported for the anti-vacuity test. */
export const GUILD_GITIGNORE_REQUIRED_LINES: readonly string[] = GUILD_MANAGED_LINES;

/**
 * Strip ALL managed blocks (between BEGIN/END markers, inclusive) from a line array,
 * returning the surviving body lines and whether any managed block was found.
 */
function stripManagedBlocks(lines: readonly string[]): { body: string[]; hadManagedBlock: boolean } {
  const body: string[] = [];
  let inBlock = false;
  let hadManagedBlock = false;
  for (const line of lines) {
    if (line.trim() === GUILD_MANAGED_BEGIN) {
      inBlock = true;
      hadManagedBlock = true;
      continue;
    }
    if (inBlock) {
      if (line.trim() === GUILD_MANAGED_END) inBlock = false;
      continue;
    }
    body.push(line);
  }
  return { body, hadManagedBlock };
}

/**
 * §E13 — update `.gitignore` with the canonical managed Guild block (V13). Preserves
 * existing non-Guild user lines byte-for-byte and in order, collapses any prior managed
 * blocks into one canonical block, dedupes stray exact Guild policy lines on first
 * adoption, adds one anchored ignore line per detected child git repo (workspace shape),
 * preserves the file's newline style + trailing-newline, and is idempotent on re-run.
 * Writes through the injected IO seam — never direct fs.
 */
export const updateGitignore: UpdateGitignoreFn = (ctx) => {
  const gitignorePath = path.join(ctx.cwd, ".gitignore");
  const existing = ctx.io.readText(gitignorePath);
  const isNew = existing === null;

  // Preserve newline style + trailing-newline presence (new file ⇒ LF + trailing).
  const eol = !isNew && existing.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = isNew ? true : /\r?\n$/.test(existing);

  let rawLines = isNew ? [] : existing.split(/\r?\n/);
  if (!isNew && hadTrailingNewline && rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop(); // drop the empty element produced by a trailing newline
  }

  // 1. Remove all managed blocks.
  const { body, hadManagedBlock } = stripManagedBlocks(rawLines);

  // 2. First adoption (no managed block) ⇒ dedupe stray EXACT Guild policy lines.
  let cleanedBody = body;
  if (!hadManagedBlock) {
    const managedSet = new Set<string>(GUILD_MANAGED_LINES);
    cleanedBody = body.filter((line) => !managedSet.has(line));
  }

  // Anchored ignore line per detected child git repo — add if missing, preserve if present.
  const childLines = ctx.childGitRepos.map((p) => `/${path.basename(p.replace(/[/\\]+$/, ""))}/`);
  const bodySet = new Set<string>(cleanedBody);
  const missingChildLines = childLines.filter((l) => !bodySet.has(l));
  const bodyWithChildren = [...cleanedBody, ...missingChildLines];

  // 3+4. Append exactly one canonical managed block (required lines in exact order).
  const managedBlock = [GUILD_MANAGED_BEGIN, ...GUILD_MANAGED_LINES, GUILD_MANAGED_END];
  const finalLines = [...bodyWithChildren, ...managedBlock];

  let next = finalLines.join(eol);
  if (hadTrailingNewline || isNew) next += eol; // 5. preserve/ensure trailing newline

  if (!isNew && existing === next) {
    return { applied: false, note: ".gitignore already current — managed block in place (idempotent)." };
  }
  ctx.io.writeText(gitignorePath, next);
  return {
    applied: true,
    note: isNew
      ? "created .gitignore with Guild managed block."
      : `updated .gitignore Guild managed block${missingChildLines.length ? ` (+${missingChildLines.length} child ignore line(s))` : ""}.`,
  };
};

// ---------------------------------------------------------------------------
// Report shapes
// ---------------------------------------------------------------------------

/** Per-entry status (spec §O line 119 + Repair report schema). */
export type EntryStatus =
  | "created"
  | "already_present"
  | "reconciled"
  | "skipped_user_modified"
  | "failed";

/** One entry in an init/repair report (matches the spec Repair report schema). */
export interface ReportEntry {
  /** repo-root-relative POSIX path (e.g. ".guild/settings.json"). */
  readonly path: string;
  readonly status: EntryStatus;
  /** Short stable reason. */
  readonly reason: string;
  readonly action: "none" | "create" | "reconcile" | "manual_review";
  readonly error: string | null;
}

export const INIT_REPORT_SCHEMA_VERSION = "guild.init_report.v1" as const;
export const INIT_REPAIR_REPORT_SCHEMA_VERSION = "guild.init_repair_report.v1" as const;

export interface InitGuildResult {
  readonly schema_version: typeof INIT_REPORT_SCHEMA_VERSION;
  readonly cwd: string;
  readonly mode: InitMode;
  readonly entries: readonly ReportEntry[];
  readonly security: SecurityReconcileOutcome;
  readonly gitignore: GitignoreOutcome;
  /** The validated resolved settings after init (§E4 "make resolveSettings return defaults+sources"). */
  readonly settings: ResolvedConfig;
  readonly sources: Record<string, Source>;
}

export interface RepairGuildResult {
  readonly schema_version: typeof INIT_REPAIR_REPORT_SCHEMA_VERSION;
  readonly cwd: string;
  readonly entries: readonly ReportEntry[];
  readonly security: SecurityReconcileOutcome;
  readonly gitignore: GitignoreOutcome;
  /** The detection result that drove the repair (echoed for callers/telemetry). */
  readonly detection: GuildStateResult;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface InitGuildOptions {
  /** RFC3339 UTC stamp passed to the reconciler (deterministic). Defaults to now. */
  now?: string;
  io?: InitGuildIO;
  /** L3 override for §E7b fail-closed security reconcile. */
  reconcileSecurity?: ReconcileSecurityFn;
  /** L3 override for §E13 .gitignore policy. */
  updateGitignore?: UpdateGitignoreFn;
}

// ---------------------------------------------------------------------------
// Seed content (carries the embedded schema `version` markers the manifest pins)
// ---------------------------------------------------------------------------

const SETTINGS_REL = ".guild/settings.json";

function seedContentFor(root: string, entry: ScaffoldEntry): string {
  switch (entry.path) {
    case ".guild/project.yaml":
      return [
        "# Guild project manifest",
        "schema_version: guild.project.v1",
        `name: ${JSON.stringify(path.basename(root))}`,
        "created_by: guild.init",
        "",
      ].join("\n");
    case ".guild/wiki/index.md":
      return [
        "<!-- schema_version: guild.wiki_index.v1 -->",
        "# Project Wiki",
        "",
        "Guild knowledge base entrypoint. Synthesized memory, decisions, and standards accrete here.",
        "",
      ].join("\n");
    case ".guild/indexes/codebase-map.json":
      return (
        JSON.stringify(
          { schema_version: "guild.codebase_map.v1", generated_by: "guild.init", files: [] },
          null,
          2,
        ) + "\n"
      );
    case ".guild/indexes/architecture-map.md":
      return [
        "<!-- schema_version: guild.architecture_map.v1 -->",
        "# Architecture Map",
        "",
        "_Stub — populated by guild:learn for brownfield projects._",
        "",
      ].join("\n");
    case ".guild/workspace.json":
      return (
        JSON.stringify(
          { schema_version: "guild.workspace.v1", is_workspace: true, sub_guilds: [] },
          null,
          2,
        ) + "\n"
      );
    case ".guild/indexes/initiatives-registry.yaml":
      return ["# schema_version: guild.initiatives_registry.v1", "initiatives: []", ""].join("\n");
    default:
      // Unknown file entry — write a minimal stub carrying its version marker if any.
      return entry.version ? `# schema_version: ${entry.version}\n` : "";
  }
}

// ---------------------------------------------------------------------------
// Per-entry materialization (shared by init + repair — never-clobber)
// ---------------------------------------------------------------------------

/** Resolve a manifest entry's repo-root-relative POSIX path against an absolute root. */
function resolveEntryPath(root: string, entry: ScaffoldEntry): string {
  const segments = entry.path.replace(/\/+$/, "").split("/");
  return path.join(root, ...segments);
}

/**
 * Create-if-missing / classify-if-present for ONE manifest entry. Never overwrites.
 * settings.json is excluded (the reconciler owns it) — callers skip it.
 */
function materializeEntry(root: string, entry: ScaffoldEntry, io: InitGuildIO): ReportEntry {
  const abs = resolveEntryPath(root, entry);
  try {
    if (entry.kind === "dir") {
      if (io.isDir(abs)) {
        return { path: entry.path, status: "already_present", reason: "directory present", action: "none", error: null };
      }
      if (io.exists(abs)) {
        // A file exists where a directory is required — user-authored collision; never clobber.
        return {
          path: entry.path,
          status: "skipped_user_modified",
          reason: "path exists but is not a directory",
          action: "manual_review",
          error: null,
        };
      }
      io.ensureDir(abs);
      return { path: entry.path, status: "created", reason: "directory created", action: "create", error: null };
    }

    // file
    if (!io.exists(abs)) {
      io.ensureDir(path.dirname(abs));
      io.writeText(abs, seedContentFor(root, entry));
      return { path: entry.path, status: "created", reason: "seeded from manifest", action: "create", error: null };
    }

    // present — classify via embedded version marker (no mtime heuristic, spec §O line 116)
    const content = io.readText(abs) ?? "";
    if (entry.version && content.includes(entry.version)) {
      return { path: entry.path, status: "already_present", reason: `matches ${entry.version}`, action: "none", error: null };
    }
    if (!entry.version && !entry.expected_hash) {
      // Neither marker → treat as user-authored; never overwrite (spec §O line 117).
      return { path: entry.path, status: "already_present", reason: "user-authored (no schema marker); left intact", action: "none", error: null };
    }
    // Has an expectation but content does not match → manual review.
    return {
      path: entry.path,
      status: "skipped_user_modified",
      reason: `present but does not match ${entry.version ?? entry.expected_hash}`,
      action: "manual_review",
      error: null,
    };
  } catch (e) {
    return {
      path: entry.path,
      status: "failed",
      reason: "materialize error",
      action: "none",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Map a reconcile run to a settings.json report entry. */
function settingsReportEntry(preExisted: boolean, rec: ReconcileRunResult): ReportEntry {
  if (!rec.changed) {
    return { path: SETTINGS_REL, status: "already_present", reason: "settings reconciled — no change", action: "none", error: null };
  }
  return preExisted
    ? { path: SETTINGS_REL, status: "reconciled", reason: `reconcile ${rec.mode}`, action: "reconcile", error: null }
    : { path: SETTINGS_REL, status: "created", reason: `reconcile ${rec.mode} (fresh)`, action: "create", error: null };
}

// ---------------------------------------------------------------------------
// initializeGuild — §E4
// ---------------------------------------------------------------------------

/**
 * Create the required `.guild/` structure for `single_project` or `workspace`,
 * materialize `settings.json` via the reconciler (so generation cannot drift from
 * `/guild:config init`), validate via `resolveSettings`, and report what was done.
 * Re-running is never-clobber (V5/V6).
 */
export function initializeGuild(
  root: string,
  mode: InitMode,
  opts: InitGuildOptions = {},
): InitGuildResult {
  const io = opts.io ?? defaultInitGuildIO();
  const now = opts.now ?? new Date().toISOString();
  const scaffoldMode: ScaffoldMode = mode === "workspace" ? "workspace_root" : "single_project";
  const entries = scaffoldFor(scaffoldMode);

  const reportEntries: ReportEntry[] = [];
  const settingsAbs = path.join(root, ...SETTINGS_REL.split("/"));
  const settingsPreExisted = io.exists(settingsAbs);

  for (const entry of entries) {
    if (entry.path === SETTINGS_REL) continue; // reconciler owns it
    reportEntries.push(materializeEntry(root, entry, io));
  }

  // settings.json — config reconcile sync (fill defaults, never clobber user values).
  const rec = reconcileConfig({ cwd: root, mode: "sync", now, io: toReconcileIO(io) });
  reportEntries.push(settingsReportEntry(settingsPreExisted, rec));

  // L3 seams (inert by default).
  const security = (opts.reconcileSecurity ?? reconcileSecurity)({ cwd: root, mode: "init", io, now });
  const childGitRepos = mode === "workspace" ? detectChildGitRepos(root) : [];
  const gitignore = (opts.updateGitignore ?? updateGitignore)({ cwd: root, mode: "init", childGitRepos, io });

  // Validate — resolveSettings must return defaults + sources after init.
  const resolved = resolveSettings({ cwd: root });

  return {
    schema_version: INIT_REPORT_SCHEMA_VERSION,
    cwd: root,
    mode,
    entries: reportEntries,
    security,
    gitignore,
    settings: resolved.config,
    sources: resolved.sources,
  };
}

// ---------------------------------------------------------------------------
// repairGuildInstall — §E7a
// ---------------------------------------------------------------------------

/** Choose the scaffold mode to repair against from a detection result. */
function repairScaffoldMode(detection: GuildStateResult): ScaffoldMode {
  switch (detection.state) {
    case "workspace_root":
      return "workspace_root";
    case "workspace_child":
    case "single_project":
      return "single_project"; // child owns the project floor; no workspace extras
    case "installed_needs_repair":
      // workspaceRoot === cwd ⇒ a cwd-level workspace.json drove the repair state.
      return detection.workspaceRoot === detection.cwd ? "workspace_root" : "single_project";
    default:
      return "single_project";
  }
}

/**
 * Classify an incomplete `.guild/` (via detectGuildState) and repair it by manifest
 * + config reconcile/repair, NEVER deleting or rewriting user-authored content
 * (§E7a / V7). Fail-closed SECURITY reconcile (§E7b) and `.gitignore` (§E13) run
 * through the L3 seams.
 */
export function repairGuildInstall(cwd: string, opts: InitGuildOptions = {}): RepairGuildResult {
  const io = opts.io ?? defaultInitGuildIO();
  const now = opts.now ?? new Date().toISOString();
  const detection = detectGuildState(cwd);

  // Nothing to repair when there is no install at all.
  if (detection.state === "not_installed") {
    return {
      schema_version: INIT_REPAIR_REPORT_SCHEMA_VERSION,
      cwd,
      entries: [
        {
          path: ".guild",
          status: "failed",
          reason: "no .guild/ install present",
          action: "none",
          error: "not_installed — run initializeGuild to create the install",
        },
      ],
      security: { applied: false, note: "skipped — not_installed" },
      gitignore: { applied: false, note: "skipped — not_installed" },
      detection,
    };
  }

  const scaffoldMode = repairScaffoldMode(detection);
  const entries = scaffoldFor(scaffoldMode);
  const malformedPath = detection.problem?.problem === "malformed_workspace_json" ? detection.problem.path : null;

  const reportEntries: ReportEntry[] = [];
  const settingsAbs = path.join(cwd, ...SETTINGS_REL.split("/"));
  const settingsPreExisted = io.exists(settingsAbs);

  for (const entry of entries) {
    if (entry.path === SETTINGS_REL) continue; // reconciler owns it
    const abs = resolveEntryPath(cwd, entry);
    // A malformed workspace.json is never clobbered — surface it for manual review.
    if (malformedPath !== null && abs === malformedPath) {
      reportEntries.push({
        path: entry.path,
        status: "skipped_user_modified",
        reason: "malformed workspace.json — manual review (never clobbered)",
        action: "manual_review",
        error: null,
      });
      continue;
    }
    reportEntries.push(materializeEntry(cwd, entry, io));
  }

  // settings.json — config reconcile REPAIR (sync + coerce malformed default/reconciled;
  // never clobbers a valid or user value).
  const rec = reconcileConfig({ cwd, mode: "repair", now, io: toReconcileIO(io) });
  reportEntries.push(settingsReportEntry(settingsPreExisted, rec));

  // L3 seams (inert by default).
  const security = (opts.reconcileSecurity ?? reconcileSecurity)({ cwd, mode: "repair", io, now });
  const childGitRepos = scaffoldMode === "workspace_root" ? detectChildGitRepos(cwd) : [];
  const gitignore = (opts.updateGitignore ?? updateGitignore)({ cwd, mode: "repair", childGitRepos, io });

  return {
    schema_version: INIT_REPAIR_REPORT_SCHEMA_VERSION,
    cwd,
    entries: reportEntries,
    security,
    gitignore,
    detection,
  };
}
