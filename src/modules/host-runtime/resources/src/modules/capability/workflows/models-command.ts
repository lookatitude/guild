/**
 * src/modules/capability/workflows/models-command.ts
 *
 * T6b - the implementation behind the PUBLIC, READ-ONLY `guild models inspect`
 * command (module map §1: `command-src/` -> `commands/models.md`). The command
 * file is a thin prompt that shells out to `scripts/models-cmd.ts`, which calls
 * THIS module - so every supported host command surface prints the SAME bytes
 * instead of each host's model paraphrasing a report.
 *
 * DELEGATION: discovery/resolution/composition logic is NOT re-implemented
 * here. The report is built by the canonical M0 inspection service
 * (`buildModelInspection`, lane T6); rollout flags come from
 * `readRoutingFlags`; identity comes from the frozen
 * `guild.session_context.v1` record via host-runtime's public entrypoint. This
 * file only LOCATES artifacts, PRESENTS them, and refuses to print anything
 * unsafe.
 *
 * THREE INVARIANTS THIS FILE OWNS (all executed, none prose):
 *  1. READ-ONLY. Nothing here opens a file for writing, creates a directory or
 *     spawns a process. `guild models inspect` can never mutate a run.
 *  2. LABELS SURVIVE. Text and JSON are rendered from ONE view model, so the
 *     `unknown` markers, per-model `evidence_state`, and the independence
 *     verdict cannot be present on one host surface and absent on another. An
 *     unbindable field is printed as `unknown`, never omitted and never guessed.
 *  3. NO SECRETS. Every displayed field is VALIDATED before it is rendered
 *     (round-2 T6B-R1-B1: the round-1 surface copied persisted
 *     `identity.evidence` and `target.target_id` verbatim and leaked a
 *     credential, a private absolute path and a reversible endpoint identity
 *     through a live probe). Identifier fields must match a closed display
 *     token shape and must not be reversible endpoint/account identities;
 *     free-text fields must survive the CANONICAL redaction applier
 *     (`redact`, security module) untouched. A field that fails is replaced by
 *     a neutral `<REJECTED:...>` marker plus a NON-REVERSIBLE 12-hex
 *     fingerprint - the offending value never reaches the terminal in any
 *     form, in text OR in JSON - and the command exits non-zero. The whole
 *     rendered payload then passes through `redact` again as a belt to that
 *     brace. Display hashes are 12-char prefixes, which keeps the
 *     high-entropy-hex detector meaningful instead of matching our own bytes.
 *
 *  4. PERSISTED REPORTS ARE UNTRUSTED (round-2 T6B-R1-B2). A
 *     `.guild/runs/<id>/inspection/*.json` file is a plain writable file: the
 *     round-1 surface schema-checked it and rendered it, so a forged
 *     `adjudicated: true / independence: strong` reached the public surface
 *     without any receipt or hash-bound §7a block behind it. This file now
 *     treats those artifacts as UNTRUSTED POINTERS ONLY: every rendered claim
 *     is REBUILT through `buildModelInspection` from artifacts that verify
 *     themselves (the run's frozen `guild.session_context.v1`, the
 *     content-addressed `guild.model_catalog.v1` cache entry), so
 *     receipt-verification and hash-bound adjudication run on the real path.
 *     Where the persisted claim and the rebuilt truth disagree, the FIELD NAME
 *     (never the claimed value) is surfaced as a divergence note.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { loadSessionContext } from "../../host-runtime";
import { redact } from "../../security";
import {
  createCacheKey,
  modelCatalogCacheDir,
  MODEL_CATALOG_SCHEMA_VERSION,
} from "./catalog-cache";
import { buildModelInspection, MODEL_INSPECTION_SCHEMA, type ModelInspectionV1 } from "./model-inspect";
import { readRoutingFlags, ROUTING_FLAG_KEYS, type RoutingFlags } from "./routing-rollout";

export const MODELS_COMMAND_USAGE = [
  "usage: guild models inspect [--cwd <repo-root>] [--run-id <id>] [--json]",
  "",
  "  inspect   READ-ONLY view of this run's model routing: identity trust, target",
  "            evidence, catalog age, policy path, selection, fallbacks, actual",
  "            model, independence and degradation - with honest unknowns.",
  "",
  "  --cwd     repo root that owns .guild/ (default: process cwd)",
  "  --run-id  inspect this run (default: the intake candidate run, labeled)",
  "  --json    emit the same view model as JSON instead of text",
].join("\n");

// -- deps (only the pieces capability may not import directly are injectable) -

export interface ModelsCommandDeps {
  /**
   * Intake-only candidate run id. The canonical implementation lives in the
   * lifecycle module (`locateCandidateRunId`), which capability must not import
   * (lifecycle depends on capability - the reverse edge would be a cycle), so
   * `scripts/models-cmd.ts` threads the REAL one in. The default returns null:
   * absent a candidate the command says so and asks for `--run-id`; it never
   * invents a run.
   */
  candidateRunId?: (root: string) => { run_id: string; source: string } | null;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** RFC3339 clock for `generated_at` only (never for evidence). */
  now?: () => string;
}

interface ResolvedDeps {
  candidateRunId: (root: string) => { run_id: string; source: string } | null;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  now: () => string;
}

function resolveDeps(d: ModelsCommandDeps): ResolvedDeps {
  return {
    candidateRunId: d.candidateRunId ?? (() => null),
    stdout: d.stdout ?? ((s) => process.stdout.write(s)),
    stderr: d.stderr ?? ((s) => process.stderr.write(s)),
    now: d.now ?? (() => new Date().toISOString()),
  };
}

// -- argv ---------------------------------------------------------------------

export interface ModelsArgs {
  verb: "inspect";
  cwd: string;
  runId: string | null;
  json: boolean;
}

/** Parse argv fail-closed. Unknown verbs/flags are refused, never ignored. */
export function parseModelsArgs(argv: readonly string[]): ModelsArgs | { error: string } {
  if (argv.length === 0) return { error: "missing sub-verb" };
  const verb = argv[0];
  if (verb !== "inspect") {
    return {
      error:
        'unknown sub-verb "' +
        verb +
        '" - `guild models` exposes exactly one READ-ONLY sub-verb (inspect); ' +
        "adding another public verb is a requires-confirmation change",
    };
  }
  let cwd = process.cwd();
  let runId: string | null = null;
  let json = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--cwd" && argv[i + 1] !== undefined) cwd = path.resolve(argv[++i]);
    else if (a.startsWith("--cwd=")) cwd = path.resolve(a.slice("--cwd=".length));
    else if (a === "--run-id" && argv[i + 1] !== undefined) runId = argv[++i];
    else if (a.startsWith("--run-id=")) runId = a.slice("--run-id=".length);
    else return { error: "unknown argument: " + a };
  }
  if (runId !== null && !/^[A-Za-z0-9._-]+$/.test(runId)) {
    return { error: "unsafe --run-id value: " + runId };
  }
  return { verb: "inspect", cwd, runId, json };
}

// -- artifact location (read-only; every source is LABELED) -------------------

function readJson(p: string): unknown | null {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * An UNTRUSTED persisted M0 report (`.guild/runs/<id>/inspection/*.json`).
 *
 * T6B-R1-B2: this is a plain file on disk. It is NOT evidence and it is NEVER
 * rendered - a persisted record contributes only its LABEL (which dispatch was
 * inspected) and, once the trusted view is rebuilt, a per-field divergence
 * report. `claims` is retained solely to compute that divergence; no consumer
 * may render it.
 */
export interface PersistedInspectionRecord {
  label: string;
  source_path: string;
  /** UNTRUSTED bytes as read from disk. Never rendered; diffed only. */
  claims: Partial<ModelInspectionV1>;
  /** False when the artifact fails its own run binding / schema check. */
  bound: boolean;
  /** Why the artifact was or was not accepted as a pointer. */
  binding_reason: string;
}

/**
 * List the persisted M0 reports for a run as UNTRUSTED POINTERS. The only
 * checks made here are the two that decide whether the file even names this
 * run: the frozen schema tag and the run binding (`report.run_id === runId` -
 * `persistInspectionReport` refuses to write any other combination, so a
 * mismatch means the artifact was hand-edited or copied in). Everything the
 * file CLAIMS is rebuilt elsewhere.
 */
export function loadPersistedInspections(
  root: string,
  runId: string
): PersistedInspectionRecord[] {
  const dir = path.join(root, ".guild", "runs", runId, "inspection");
  if (!fs.existsSync(dir)) return [];
  const out: PersistedInspectionRecord[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const p = path.join(dir, name);
    const parsed = readJson(p) as Partial<ModelInspectionV1> | null;
    const label = name.replace(/\.json$/, "");
    if (parsed === null || typeof parsed !== "object") {
      out.push({
        label,
        source_path: p,
        claims: {},
        bound: false,
        binding_reason: "unreadable or non-object inspection artifact",
      });
      continue;
    }
    if (parsed.schema_version !== MODEL_INSPECTION_SCHEMA) {
      out.push({
        label,
        source_path: p,
        claims: {},
        bound: false,
        binding_reason: "not a " + MODEL_INSPECTION_SCHEMA + " artifact",
      });
      continue;
    }
    if (parsed.run_id !== runId) {
      out.push({
        label,
        source_path: p,
        claims: {},
        bound: false,
        binding_reason:
          "run-binding mismatch: the artifact names a different run than the one inspected",
      });
      continue;
    }
    out.push({
      label,
      source_path: p,
      claims: parsed,
      bound: true,
      binding_reason: "schema + run binding hold (contents still untrusted)",
    });
  }
  return out;
}

// -- the VERIFIED source artifacts the trusted view is rebuilt from ----------

/**
 * The inputs `buildModelInspection` is allowed to see. Each one verifies
 * ITSELF - `loadSessionContext` refuses a record whose schema tag or run id
 * does not match, and the catalog entry is looked up by a CONTENT-ADDRESSED
 * cache key derived from that verified session context, so a snapshot can only
 * be found under the identity tuple it actually belongs to.
 */
export interface VerifiedInspectionSources {
  session_context: unknown | null;
  catalog_snapshot: unknown | null;
  /** Honest account of what could NOT be bound - surfaced, never silent. */
  notes: string[];
}

/**
 * Locate this run's catalog snapshot READ-ONLY. The cache entry is
 * content-addressed by the §7 identity tuple; the tuple is taken from the
 * VERIFIED session context, never from the persisted report, so a forged
 * report cannot point the reader at another target's catalog.
 *
 * Deliberately does NOT use `createStore` - that constructor mkdir's its root,
 * and `guild models inspect` may not write. The entry is read directly.
 */
function loadVerifiedCatalogSnapshot(
  root: string,
  runId: string,
  sessionContext: unknown
): { snapshot: unknown | null; note: string | null } {
  const sc = sessionContext as Record<string, any> | null;
  const target = sc?.["execution_target"];
  const host = sc?.["host"];
  if (!target || !host) {
    return { snapshot: null, note: "no execution target on the session context - catalog unbound" };
  }
  let key;
  try {
    key = createCacheKey(
      {
        target_id: String(target.target_id ?? "unknown"),
        family: String(host.family ?? "unknown"),
        surface: String(host.surface ?? "unknown"),
        provider_kind: String(target.provider_kind ?? "unknown"),
        auth_mode: String(target.auth_mode ?? "unknown"),
        account_fingerprint: String(target.account_fingerprint ?? "unknown"),
        endpoint_fingerprint: String(target.endpoint_fingerprint ?? "unknown"),
        org_fingerprint: String(target.org_fingerprint ?? "unknown"),
        tool_version: String(target.tool_version ?? "unknown"),
        adapter_id: String(host.adapter_id ?? "unknown"),
        adapter_version: String(host.adapter_version ?? "unknown"),
      },
      runId
    );
  } catch (err) {
    return {
      snapshot: null,
      note: "catalog cache identity could not be constructed: " + (err as Error).message,
    };
  }
  const entry = readJson(path.join(modelCatalogCacheDir(root), key.hash + ".json"));
  if (entry === null) {
    return { snapshot: null, note: "no catalog cache entry for this run's target identity" };
  }
  if ((entry as Record<string, unknown>)["schema_version"] !== MODEL_CATALOG_SCHEMA_VERSION) {
    return {
      snapshot: null,
      note: "catalog cache entry is not a " + MODEL_CATALOG_SCHEMA_VERSION + " snapshot - ignored",
    };
  }
  return { snapshot: entry, note: null };
}

/**
 * Load the self-verifying artifacts the report is rebuilt from.
 *
 * `policy`, `receipt` and `adjudication` are NOT bound yet: their canonical
 * on-disk readers do not exist in capability (the resolution receipt and
 * policy artifacts are YAML owned by other lanes), so they stay `null` and
 * `buildModelInspection` renders them as honest unknowns. That is the correct
 * failure mode - the alternative, trusting the persisted report's copies, is
 * exactly the bypass T6B-R1-B2 blocks.
 */
export function loadVerifiedSources(root: string, runId: string): VerifiedInspectionSources {
  const notes: string[] = [];
  const session_context = loadSessionContext(root, runId);
  if (session_context === null) {
    notes.push(
      "no verified guild.session_context.v1 record for this run - identity, host and target " +
        "are honest unknowns"
    );
  }
  const { snapshot, note } = loadVerifiedCatalogSnapshot(root, runId, session_context);
  if (note !== null) notes.push(note);
  notes.push(
    "policy / resolution receipt / §7a adjudication have no verified reader in this module yet - " +
      "they are rendered as honest unknowns rather than copied from a persisted report"
  );
  return { session_context, catalog_snapshot: snapshot, notes };
}

/** Rollout flags from the project settings file - source is reported, not assumed. */
export function loadRoutingFlags(root: string): {
  flags: RoutingFlags;
  source: string;
  rejects: string[];
} {
  const p = path.join(root, ".guild", "settings.json");
  const settings = readJson(p);
  if (settings === null) {
    const { flags, rejects } = readRoutingFlags(null);
    return { flags, source: "defaults (no .guild/settings.json)", rejects };
  }
  const { flags, rejects } = readRoutingFlags(settings);
  return { flags, source: ".guild/settings.json", rejects };
}

// -- display validation: NOTHING reaches the surface unvalidated (T6B-R1-B1) -

/** 12-char display prefix. Full hashes stay in the artifacts on disk. */
function shortHash(h: unknown): string {
  return typeof h === "string" && h.length >= 12 ? h.slice(0, 12) : "unknown";
}

/**
 * The closed shape an IDENTIFIER-class display field must have: a short
 * canonical token (`claude-cli`, `model-a`, `verified`, `oauth`). Anything
 * else - a path, a URL, a header, a quoted blob, a 4KB string - is not an
 * identifier and is never printed.
 */
const DISPLAY_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/;

/**
 * REVERSIBLE identity shapes. §6 of the session-context contract requires
 * account/endpoint/org identity to reach a surface only as a non-reversible
 * salted digest; a `target_id` that is a URL, a host name, an email or a raw
 * IP is the identity itself, so it is refused even though it satisfies the
 * token charset above.
 */
const REVERSIBLE_IDENTITY_RE =
  /:\/\/|@|\b\d{1,3}(?:\.\d{1,3}){3}\b|\.(?:com|net|org|io|ai|dev|app|cloud|internal|local)\b/i;

/**
 * Control characters are refused outright: an ESC byte in a persisted evidence
 * string is terminal-escape injection, which is a display exploit even when it
 * carries no secret. Printable Unicode is allowed (Guild's own contract prose
 * uses `§` and em dashes), and the field is length-bounded - a display surface
 * is not a log sink.
 */
const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/;
const FREE_TEXT_MAX = 240;

/** Non-reversible stable handle for a rejected value - 12 hex of its sha256. */
function fingerprint(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

/**
 * A display-validator rejection. Carries the FIELD and the CATEGORY only -
 * never the rejected value, and never anything derived from it beyond a
 * one-way fingerprint.
 */
export interface DisplayRejection {
  field: string;
  category: string;
}

function reject(
  rejections: DisplayRejection[],
  field: string,
  category: string,
  value: string
): string {
  rejections.push({ field, category });
  return "<REJECTED:" + category + ":" + fingerprint(value) + ">";
}

/** Identifier-class field: closed token shape, else rejected. */
function safeToken(v: unknown, field: string, rejections: DisplayRejection[]): string {
  if (v === null || v === undefined || v === "") return "unknown";
  if (typeof v !== "string") return reject(rejections, field, "non-string", String(v));
  if (!DISPLAY_TOKEN_RE.test(v)) return reject(rejections, field, "not-a-display-token", v);
  return v;
}

/**
 * Target-identity field: a display token that is additionally NOT a reversible
 * endpoint/account identity. This is the field the round-1 probe used to leak
 * a resolvable endpoint onto the terminal.
 */
function safeIdentity(v: unknown, field: string, rejections: DisplayRejection[]): string {
  if (v === null || v === undefined || v === "") return "unknown";
  if (typeof v !== "string") return reject(rejections, field, "non-string", String(v));
  if (!DISPLAY_TOKEN_RE.test(v)) return reject(rejections, field, "not-a-display-token", v);
  if (REVERSIBLE_IDENTITY_RE.test(v)) {
    return reject(rejections, field, "reversible-identity", v);
  }
  return v;
}

/**
 * Free-text field (evidence strings, adjudication predicate traces,
 * degradation notes). Accepted ONLY when the CANONICAL redaction applier finds
 * nothing in it and it is printable and bounded. Note the applier is used as a
 * DETECTOR here, not a filter: a hit rejects the whole field rather than
 * printing a partially-redacted line, so no fragment of the original survives.
 */
function safeText(v: unknown, field: string, rejections: DisplayRejection[]): string {
  if (v === null || v === undefined || v === "") return "unknown";
  if (typeof v !== "string") return reject(rejections, field, "non-string", String(v));
  if (v.length > FREE_TEXT_MAX) return reject(rejections, field, "oversized", v);
  if (CONTROL_CHAR_RE.test(v)) return reject(rejections, field, "control-characters", v);
  const scan = redact(v);
  if (scan.secrets.length > 0) {
    return reject(rejections, field, scan.secrets[0].category.replace(/\s+/g, "-"), v);
  }
  if (scan.opPaths > 0) return reject(rejections, field, "private-path", v);
  return v;
}

/** Boolean-ish field: only a real boolean is trusted; anything else is unknown. */
function safeBool(v: unknown): boolean {
  return v === true;
}

function safeNumeric(v: unknown, field: string, rejections: DisplayRejection[]): string {
  if (v === null || v === undefined) return "unknown";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return String(v);
  return reject(rejections, field, "non-numeric", String(v));
}

// -- ONE view model; text and JSON both render FROM it -----------------------

export interface InspectionEntryView {
  /** Where this row came from - always a REBUILD from verified artifacts. */
  origin: string;
  label: string;
  /**
   * Field names on which an UNTRUSTED persisted report disagreed with the
   * rebuilt truth. Names only - a claimed value is never echoed.
   */
  untrusted_divergence: string[];
  run_id: string;
  host: { family: string; surface: string };
  identity: { source: string; trust: string; confidence: string; evidence: string };
  target: { target_id: string; provider_kind: string; auth_mode: string };
  catalog: {
    state: string;
    target_id: string;
    discovered_at: string;
    age_seconds: string;
    ttl_seconds: string;
    stale: string;
    generation: string;
    models: Array<{ canonical_id: string; tier: string; evidence_state: string }>;
  };
  policy: { present: boolean; policy_hash_short: string; rule_path: string };
  selection: { model: string; effort: string; evidence_state: string };
  fallbacks: { chain_length: string; fallback_hash_short: string };
  outcome: { finalized: boolean; status: string; actual_model: string };
  independence: { adjudicated: boolean; independence: string; note: string };
  degradation: { kind: string; note: string };
  unknowns: string[];
}

export interface ModelsInspectView {
  schema_version: "guild.model_inspection_view.v1";
  generated_at: string;
  cwd: string;
  run_id: string;
  run_id_source: string;
  flags: { source: string; values: Array<{ key: string; value: string }>; rejects: string[] };
  entries: InspectionEntryView[];
  /** Command-level notes (missing artifacts, empty trails) - never silent. */
  notes: string[];
  /**
   * Every display-validator rejection across every entry. Non-empty means the
   * command failed closed (exit 3) - the surface refused to print something.
   */
  display_rejections: DisplayRejection[];
}

/**
 * Project one REBUILT canonical report into the display row, validating EVERY
 * displayed field on the way out (T6B-R1-B1). The returned `rejected` list is
 * the fail-closed signal; the entry itself never carries an unvalidated byte.
 */
export function buildEntryView(
  report: ModelInspectionV1,
  origin: string,
  label: string
): { entry: InspectionEntryView; rejected: DisplayRejection[] } {
  const cat = report.catalog;
  const r: DisplayRejection[] = [];
  const f = (name: string) => label + "." + name;
  const entry: InspectionEntryView = {
    origin,
    label: safeToken(label, "label", r),
    untrusted_divergence: [],
    run_id: safeToken(report.run_id, f("run_id"), r),
    host: {
      family: safeToken(report.host?.family, f("host.family"), r),
      surface: safeToken(report.host?.surface, f("host.surface"), r),
    },
    identity: {
      source: safeToken(report.identity?.source, f("identity.source"), r),
      trust: safeToken(report.identity?.trust, f("identity.trust"), r),
      confidence: safeToken(report.identity?.confidence, f("identity.confidence"), r),
      evidence: safeText(report.identity?.evidence, f("identity.evidence"), r),
    },
    target: {
      target_id: safeIdentity(report.target?.target_id, f("target.target_id"), r),
      provider_kind: safeToken(report.target?.provider_kind, f("target.provider_kind"), r),
      auth_mode: safeToken(report.target?.auth_mode, f("target.auth_mode"), r),
    },
    catalog: {
      state: safeToken(cat?.state, f("catalog.state"), r),
      target_id: safeIdentity(cat?.target_id, f("catalog.target_id"), r),
      discovered_at: safeToken(cat?.discovered_at, f("catalog.discovered_at"), r),
      age_seconds: safeNumeric(cat?.age_seconds, f("catalog.age_seconds"), r),
      ttl_seconds: safeNumeric(cat?.ttl_seconds, f("catalog.ttl_seconds"), r),
      stale: safeNumeric(cat?.stale, f("catalog.stale"), r),
      generation: safeNumeric(cat?.generation, f("catalog.generation"), r),
      models: (cat?.models ?? []).map((m, i) => ({
        canonical_id: safeToken(m?.canonical_id, f("catalog.models[" + i + "].canonical_id"), r),
        tier: safeToken(m?.tier, f("catalog.models[" + i + "].tier"), r),
        evidence_state: safeToken(
          m?.evidence_state,
          f("catalog.models[" + i + "].evidence_state"),
          r
        ),
      })),
    },
    policy: {
      present: safeBool(report.policy?.present),
      policy_hash_short: shortHash(report.policy?.policy_hash),
      rule_path:
        report.policy?.rule_path === null || report.policy?.rule_path === undefined
          ? "unknown"
          : report.policy.rule_path
              .map((step, i) => safeToken(step, f("policy.rule_path[" + i + "]"), r))
              .join(" > ") || "none",
    },
    selection: {
      model: safeToken(report.selection?.model, f("selection.model"), r),
      effort: safeToken(report.selection?.effort, f("selection.effort"), r),
      evidence_state: safeToken(report.selection?.evidence_state, f("selection.evidence_state"), r),
    },
    fallbacks: {
      chain_length:
        report.fallbacks === null || report.fallbacks === undefined
          ? "unknown"
          : String(report.fallbacks.chain.length),
      fallback_hash_short: shortHash(report.fallbacks?.fallback_hash),
    },
    outcome: {
      finalized: safeBool(report.outcome?.finalized),
      status: safeToken(report.outcome?.status, f("outcome.status"), r),
      actual_model: safeToken(report.outcome?.actual_model, f("outcome.actual_model"), r),
    },
    independence: {
      adjudicated: safeBool(report.independence?.adjudicated),
      independence: safeToken(report.independence?.independence, f("independence.verdict"), r),
      note: safeText(report.independence?.note, f("independence.note"), r),
    },
    degradation: {
      kind: safeToken(report.degradation?.kind, f("degradation.kind"), r),
      note: safeText(report.degradation?.note, f("degradation.note"), r),
    },
    unknowns: (report.unknowns ?? []).map((u, i) => safeToken(u, f("unknowns[" + i + "]"), r)),
  };
  return { entry, rejected: r };
}

/**
 * Diff an UNTRUSTED persisted report against the rebuilt truth and return the
 * FIELD NAMES that disagree. This is how a forged `adjudicated: true /
 * independence: strong` becomes visible without ever being rendered: the
 * rebuilt row shows the honest `adjudicated=false`, and this list names
 * `independence.adjudicated` as a claim the artifacts do not support.
 *
 * Claimed values are never returned, compared by hash, or logged - only the
 * boolean "these differ".
 */
export function divergentClaims(
  claims: Partial<ModelInspectionV1>,
  rebuilt: ModelInspectionV1
): string[] {
  const out: string[] = [];
  const cmp = (field: string, a: unknown, b: unknown): void => {
    if (a === undefined) return;
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push(field);
  };
  cmp("identity.trust", claims.identity?.trust, rebuilt.identity.trust);
  cmp("target.target_id", claims.target?.target_id, rebuilt.target.target_id);
  cmp("catalog.state", claims.catalog?.state, rebuilt.catalog.state);
  cmp("selection.model", claims.selection?.model ?? undefined, rebuilt.selection?.model);
  cmp("outcome.finalized", claims.outcome?.finalized, rebuilt.outcome.finalized);
  cmp("outcome.actual_model", claims.outcome?.actual_model, rebuilt.outcome.actual_model);
  cmp(
    "independence.adjudicated",
    claims.independence?.adjudicated,
    rebuilt.independence.adjudicated
  );
  cmp(
    "independence.verdict",
    claims.independence?.independence,
    rebuilt.independence.independence
  );
  return out;
}

/** Deterministic ASCII rendering - the bytes every host command surface shows. */
export function renderInspectView(view: ModelsInspectView): string {
  const L: string[] = [];
  L.push("guild models inspect - READ-ONLY (no artifact was written)");
  L.push("run: " + view.run_id + " (run id resolved from: " + view.run_id_source + ")");
  L.push("");
  L.push("ROLLOUT FLAGS  source=" + view.flags.source);
  for (const f of view.flags.values) L.push("  " + f.key + " = " + f.value);
  for (const r of view.flags.rejects) L.push("  REJECTED: " + r);
  for (const n of view.notes) L.push("note: " + n);

  for (const e of view.entries) {
    L.push("");
    L.push("--- " + e.label + "  (" + e.origin + ")");
    if (e.untrusted_divergence.length > 0) {
      L.push(
        "  UNTRUSTED CLAIM(S) NOT SUPPORTED BY VERIFIED ARTIFACTS: " +
          e.untrusted_divergence.join(", ")
      );
      L.push(
        "              (the persisted report asserted these; the rows below are the REBUILT truth)"
      );
    }
    L.push("  host        family=" + e.host.family + " surface=" + e.host.surface);
    L.push(
      "  identity    source=" +
        e.identity.source +
        " trust=" +
        e.identity.trust +
        " confidence=" +
        e.identity.confidence
    );
    L.push("              evidence: " + e.identity.evidence);
    L.push(
      "  target      " +
        e.target.target_id +
        " provider_kind=" +
        e.target.provider_kind +
        " auth_mode=" +
        e.target.auth_mode
    );
    L.push(
      "  catalog     state=" +
        e.catalog.state +
        " target=" +
        e.catalog.target_id +
        " age_s=" +
        e.catalog.age_seconds +
        " ttl_s=" +
        e.catalog.ttl_seconds +
        " stale=" +
        e.catalog.stale +
        " generation=" +
        e.catalog.generation
    );
    if (e.catalog.models.length === 0) {
      L.push("              models: none on record");
    } else {
      for (const m of e.catalog.models) {
        L.push(
          "              model " + m.canonical_id + " tier=" + m.tier + " evidence=" + m.evidence_state
        );
      }
    }
    L.push(
      "  policy      present=" +
        e.policy.present +
        " hash=" +
        e.policy.policy_hash_short +
        " rule_path=" +
        e.policy.rule_path
    );
    L.push(
      "  selection   model=" +
        e.selection.model +
        " effort=" +
        e.selection.effort +
        " evidence=" +
        e.selection.evidence_state
    );
    L.push(
      "  fallbacks   chain=" + e.fallbacks.chain_length + " hash=" + e.fallbacks.fallback_hash_short
    );
    L.push(
      "  outcome     finalized=" +
        e.outcome.finalized +
        " status=" +
        e.outcome.status +
        " actual_model=" +
        e.outcome.actual_model
    );
    L.push(
      "  independence adjudicated=" +
        e.independence.adjudicated +
        " verdict=" +
        e.independence.independence
    );
    L.push("              " + e.independence.note);
    L.push("  degradation kind=" + e.degradation.kind + " - " + e.degradation.note);
    L.push(
      "  UNKNOWNS    " + (e.unknowns.length === 0 ? "none" : e.unknowns.join(", "))
    );
  }
  if (view.display_rejections.length > 0) {
    L.push("");
    L.push("DISPLAY VALIDATOR REFUSED " + view.display_rejections.length + " FIELD(S)");
    for (const d of view.display_rejections) {
      L.push("  " + d.field + ": " + d.category);
    }
    L.push("  (the value itself was never printed - only a one-way fingerprint marks its place)");
  }
  L.push("");
  L.push("Honest-unknown contract: a field printed as `unknown` was NOT bindable from evidence.");
  L.push("Every row above is REBUILT from self-verifying artifacts; a persisted inspection report");
  L.push("is an untrusted pointer, never a source of claims. No secret is ever displayed.");
  return L.join("\n") + "\n";
}

// -- the fail-closed emit path ------------------------------------------------

export interface SafeEmit {
  /** The bytes to print - ALWAYS the redacted form. */
  out: string;
  /** True when the redaction applier found nothing (the only clean case). */
  clean: boolean;
  /** Categories + line numbers of what was caught (values are never echoed). */
  findings: string[];
}

/**
 * Run the CANONICAL redaction applier over the rendered output. This is the
 * "exposes no secrets" criterion as executed code: the caller prints `out`
 * (redacted, never the raw bytes) and exits non-zero when `clean` is false, so
 * a leak degrades the command instead of reaching the terminal, the host
 * transcript, or a copied receipt.
 */
export function safeEmit(rendered: string): SafeEmit {
  const result = redact(rendered);
  const findings = [
    ...result.secrets.map((s: { category: string; line: number }) => "secret-pattern " + s.category + " at line " + s.line),
    ...(result.opPaths > 0 ? ["operator path x" + result.opPaths] : []),
  ];
  return { out: result.out, clean: findings.length === 0, findings };
}

// -- the command --------------------------------------------------------------

/**
 * `guild models inspect`. Exit codes:
 *   0  report emitted, nothing redacted
 *   1  usage / argument error
 *   2  the run could not be resolved (no --run-id and no intake candidate)
 *   3  the rendered output tripped the redaction applier - REDACTED bytes were
 *      emitted and the command failed closed
 */
export function runModelsCommand(argv: readonly string[], deps: ModelsCommandDeps = {}): number {
  const d = resolveDeps(deps);
  const parsed = parseModelsArgs(argv);
  if ("error" in parsed) {
    d.stderr(parsed.error + "\n" + MODELS_COMMAND_USAGE + "\n");
    return 1;
  }
  const { cwd, runId: explicitRunId, json } = parsed;

  let runId = explicitRunId;
  let runIdSource = "--run-id (explicit)";
  if (runId === null) {
    const candidate = d.candidateRunId(cwd);
    if (candidate === null) {
      d.stderr(
        "cannot resolve a run to inspect: no --run-id was given and no intake candidate " +
          "run id is on record. Pass --run-id <id>.\n"
      );
      return 2;
    }
    runId = candidate.run_id;
    runIdSource = "intake candidate (" + candidate.source + ") - confirm it is the run you mean";
  }

  const notes: string[] = [];
  const { flags, source: flagSource, rejects } = loadRoutingFlags(cwd);

  // T6B-R1-B2: the persisted trail supplies LABELS ONLY. Every row below is
  // rebuilt through buildModelInspection from artifacts that verify
  // themselves, so receipt verification and the hash-bound §7a adjudication
  // check run on the real path no matter what a file on disk claims.
  const sources = loadVerifiedSources(cwd, runId);
  notes.push(...sources.notes);
  const now = d.now();
  const rebuild = (): ModelInspectionV1 =>
    buildModelInspection({
      session_context: sources.session_context,
      catalog_snapshot: sources.catalog_snapshot,
      policy: null,
      receipt: null,
      adjudication: null,
      flags,
      now,
    });

  const persisted = loadPersistedInspections(cwd, runId);
  const entries: InspectionEntryView[] = [];
  const display_rejections: DisplayRejection[] = [];
  if (persisted.length > 0) {
    for (const p of persisted) {
      if (!p.bound) {
        notes.push(
          "persisted inspection artifact for label \"" +
            p.label +
            "\" was NOT accepted as a pointer (" +
            p.binding_reason +
            ") - no row is shown for it"
        );
        continue;
      }
      const report = rebuild();
      const { entry, rejected } = buildEntryView(
        report,
        "REBUILT from verified artifacts (persisted report untrusted)",
        p.label
      );
      entry.untrusted_divergence = divergentClaims(p.claims, report);
      if (entry.untrusted_divergence.length > 0) {
        notes.push(
          "persisted report \"" +
            p.label +
            "\" asserts claim(s) the verified artifacts do not support: " +
            entry.untrusted_divergence.join(", ") +
            " - the rebuilt values are shown"
        );
      }
      entries.push(entry);
      display_rejections.push(...rejected);
    }
  }
  if (entries.length === 0) {
    notes.push(
      "no usable persisted M0 inspection pointer under .guild/runs/" +
        runId +
        "/inspection/ - built a single live report from the run's verified artifacts"
    );
    const { entry, rejected } = buildEntryView(
      rebuild(),
      "live (inspect-only; nothing persisted)",
      "live"
    );
    entries.push(entry);
    display_rejections.push(...rejected);
  }

  const view: ModelsInspectView = {
    schema_version: "guild.model_inspection_view.v1",
    generated_at: d.now(),
    cwd,
    run_id: runId,
    run_id_source: runIdSource,
    flags: {
      source: flagSource,
      values: ROUTING_FLAG_KEYS.map((k) => ({ key: k, value: flags[k] })),
      rejects,
    },
    entries,
    notes,
    display_rejections,
  };

  const rendered = json ? JSON.stringify(view, null, 2) + "\n" : renderInspectView(view);
  const emit = safeEmit(rendered);
  d.stdout(emit.out);
  // Two independent fail-closed legs, both non-zero. The display validator is
  // the PRIMARY one (it refuses the field before it is ever formatted, in text
  // AND in JSON); `safeEmit` is the belt behind it, catching anything a future
  // renderer composes that no per-field validator saw.
  if (display_rejections.length > 0) {
    d.stderr(
      "models inspect FAILED CLOSED: the display validator refused " +
        display_rejections.length +
        " field(s) - " +
        display_rejections.map((x) => x.field + " (" + x.category + ")").join("; ") +
        "\n"
    );
    return 3;
  }
  if (!emit.clean) {
    d.stderr(
      "models inspect FAILED CLOSED: the rendered report tripped the canonical redaction " +
        "applier and the REDACTED form was printed - " +
        emit.findings.join("; ") +
        "\n"
    );
    return 3;
  }
  return 0;
}
