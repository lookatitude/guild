/**
 * src/modules/host-runtime/workflows/provider-detect.ts
 *
 * Usage (library — no CLI, no process.exit):
 *   import { detectProviders, recommendProvider, selectReviewer } from "./lib/provider-detect";
 *   const detection = detectProviders({ cwd, host });           // probe author host + reviewers
 *   const rec = recommendProvider(detection, resolvedReview);   // OD-5 auto recommendation
 *   const sel = selectReviewer(detection, resolvedReview);      // AC-8 hard-rule selection
 *
 * Unit 4 of the settings-control-and-tmux initiative — review-provider detection
 * and the broker-wiring inputs. This module picks WHO reviews, not HOW reviewers
 * communicate. The communication contract is OWNED by `guild:review-broker`
 * (packet/result/trail under `.guild/runs/<id>/review/<gate>/` + `review_result.v1`)
 * and is intentionally OUT OF SCOPE here (AC-9). Provider choice must not fork
 * comms — this library returns only { provider, status, reason }.
 *
 * SECURITY (false-signoff guard, AC-8): a SAME-FAMILY reviewer can NEVER satisfy
 * `review=cross`. selectReviewer returns `degraded-local` or `skipped` (never
 * `selected`) when the only available reviewer shares the author's host family,
 * or when no selectable different-family reviewer exists. There is no code path
 * that returns a same-family `selected` verdict — this is the whole point of the
 * adversarial contract (a model must not grade its own homework).
 *
 * Detection tiers (OD-6):
 *   - A provider is `detected` if its CLI is on PATH AND a light version probe
 *     passes, OR a `.guild/hosts/**​/capability.json` manifest declares it.
 *   - A provider is `authed` when its auth probe passes (codex stored-auth or
 *     OPENAI_API_KEY for codex; equivalents per provider where probeable).
 *   - A provider is `selectable` for cross-review ONLY when a real adapter exists:
 *       * codex-plugin (the `codex:codex-rescue` reference adapter) — selectable
 *         when detected + authed (the plugin dispatch path works today).
 *       * codex-cli — selectable when detected + authed.
 *       * gemini-cli / pi / antigravity — detect-only (NOT selectable) until
 *         their adapters ship. Detecting them is informational, never a cross-gate
 *         satisfier.
 *
 * Provider=auto (OD-5): recommendProvider RE-DETECTS each call from the live
 * `DetectionResult` passed in; it never persists a recommendation. Persisting a
 * provider is an explicit `config set review.adversarial.provider …` action only
 * (U2). Run provenance (U6) records what was recommended + selected per run.
 *
 * Probes are INJECTABLE via `ProbeEnv` so this module never hard-depends on a
 * binary existing (CI-safe). The real default probes (`defaultProbeEnv`) shell
 * out, but tests pass a fake `ProbeEnv`.
 *
 * Host taxonomy: docs/knowledge/decisions/host-adapter-contract.md (Decision 2,
 * the `family` field). HostFamily here is the coarse family, distinct from the
 * 9-host `HostKind` in scripts/lib/host-types.ts (e.g. antigravity-2 → antigravity).
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
// P1-L7: the single source of truth for whether a cross-review adapter exists for a
// host family. `hasAdapter` below is no longer a hand-maintained literal — it is the
// `result_adapter` independent column read off `guild.host_registry.v1`. The family
// collapse the registry uses is byte-aligned with resolveAuthorHost() (proven in
// host-id-namespace.ts), so the selectable/detail outputs are unchanged for every
// family (claude → false, codex → true, gemini/pi/antigravity → false). SC-4 A/B.
import { resultAdapterForFamily } from "./host-registry";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The coarse host family used for the STRONG-independence assertion. Distinct
 * from the 9-host `HostKind` (host-types.ts) — this is the family key the broker
 * compares author-vs-reviewer against. `unknown` is a real, safe value: an
 * unknown author family means we cannot prove independence by family name, so a
 * cross gate degrades rather than guessing.
 */
export type HostFamily =
  | "claude"
  | "codex"
  | "gemini"
  | "pi"
  | "antigravity"
  | "unknown";

/** How a provider is reachable. */
export type ProviderKind = "host" | "plugin-adapter" | "cli";

/** A single provider's detection state. */
export interface DetectedProvider {
  /** Stable provider id (e.g. "codex-plugin", "codex-cli", "gemini-cli"). */
  id: string;
  /** Reachability class. */
  kind: ProviderKind;
  /** True iff CLI-on-PATH + version probe passed, OR a capability manifest declares it. */
  detected: boolean;
  /** True iff an auth probe passed (where the provider has one). */
  authed: boolean;
  /**
   * True iff this provider can ACTUALLY satisfy a cross gate (a real adapter
   * exists AND it is detected/authed as required). gemini/pi/antigravity are
   * detect-only (selectable=false) until their adapters ship (OD-6).
   */
  selectable: boolean;
  /** The host family this provider belongs to. */
  family: HostFamily;
  /** Human-readable detail for the run snapshot / config show. */
  detail: string;
}

/** Result of a single detection pass. */
export interface DetectionResult {
  /** The resolved author host family (the side that DRAFTED the artifact). */
  authorHost: HostFamily;
  /** Every known provider with its detection state. */
  providers: DetectedProvider[];
}

/**
 * The narrow review projection this module consumes. U2/U6 map this onto the
 * current settings keys — see the "Deferred config wiring" note at the bottom.
 *   - mode:     from `review` (local | cross | off).
 *   - provider: the operator's choice; "auto" ⇒ re-detect+recommend (OD-5), or an
 *               explicit provider id pin (e.g. "codex-plugin", "gemini-cli").
 */
export interface ResolvedReview {
  mode: "local" | "cross" | "off";
  provider: "auto" | string;
}

/** Output of recommendProvider — the OD-5 auto recommendation. */
export interface RecommendResult {
  recommended: string | null;
  reason: string;
}

/**
 * Output of selectReviewer — picks WHO, never HOW (AC-9). The key set is exactly
 * { provider, status, reason }; no comms/transport field ever appears here.
 */
export interface SelectResult {
  /** The selected provider id, or null when none can satisfy the gate. */
  provider: string | null;
  /**
   *  - "selected"        — a different-family selectable reviewer was chosen.
   *  - "degraded-local"  — cross could not be satisfied; fall back to weak/local review.
   *  - "skipped"         — no review (cross unsatisfiable with no local fallback, or off).
   */
  status: "selected" | "degraded-local" | "skipped";
  reason: string;
}

// ---------------------------------------------------------------------------
// Injectable probe environment
// ---------------------------------------------------------------------------

/**
 * The seam that makes detection CI-safe + deterministic. Tests inject a fake;
 * production uses `defaultProbeEnv(cwd)`. No method here may throw — each returns
 * a safe falsy default on failure (a missing binary must never crash a run).
 */
export interface ProbeEnv {
  /** Is `bin` resolvable on PATH? */
  commandOnPath(bin: string): boolean;
  /** Does `bin --version` exit 0? (only called when commandOnPath is true) */
  probeVersion(bin: string): boolean;
  /** Is codex stored-auth present (~/.codex/auth.json non-empty)? */
  readStoredCodexAuth(): boolean;
  /** Read an env var (auth probes). */
  readEnv(name: string): string | undefined;
  /** Provider ids declared by `.guild/hosts/**​/capability.json` manifests. */
  readCapabilityProviders(): string[];
  /**
   * Is the named native plugin adapter installed in the current host (e.g. the
   * `codex:codex-rescue` Claude Code plugin)? This is a DISTINCT signal from the
   * raw CLI being on PATH: a host can have the codex CLI without the plugin
   * adapter (the "codex-cli only" scenario), or the plugin without the CLI.
   * Defaults to "codex CLI present" in the real probe (the reference adapter
   * dispatches through codex), but tests can decouple the two.
   */
  readPluginAdapter(adapterId: string): boolean;
}

// ---------------------------------------------------------------------------
// Provider registry — the canonical set (briefing §5 `providers.available`).
// ---------------------------------------------------------------------------

interface ProviderSpec {
  id: string;
  kind: ProviderKind;
  family: HostFamily;
  /** CLI binary to probe on PATH (when kind involves a binary). */
  bin?: string;
  /**
   * Whether a real cross-review adapter exists for this provider TODAY. When
   * false, the provider is detect-only — `selectable` is forced false regardless
   * of detection/auth (OD-6 gemini/pi/antigravity).
   *
   * P1-L7: sourced from the `result_adapter` independent column on
   * `guild.host_registry.v1` (via `resultAdapterForFamily`), NOT a hand-kept
   * literal. The registry is the SoT; this conflated-flag field is the consumer.
   */
  hasAdapter: boolean;
  /** Whether selectability additionally requires a passing auth probe. */
  requiresAuth: boolean;
}

/**
 * Registry order is the ranker's base preference within a family:
 * native plugin adapter BEFORE the raw CLI (codex-plugin > codex-cli).
 *
 * P1-L7: each entry's `hasAdapter` is read from the host registry's `result_adapter`
 * column by family — claude→false, codex→true, gemini/pi/antigravity→false — so the
 * detect-only posture is owned in ONE place (the registry rows) instead of being
 * duplicated as literals here. Behavior is byte-identical (SC-4 A/B).
 */
const PROVIDER_REGISTRY: ProviderSpec[] = [
  // The author host itself — always "detected on the host", never a cross reviewer
  // for a same-family author (the AC-8 guard handles that).
  { id: "claude", kind: "host", family: "claude", hasAdapter: resultAdapterForFamily("claude"), requiresAuth: false },
  // Codex reference adapters (the only selectable cross reviewers today).
  { id: "codex-plugin", kind: "plugin-adapter", family: "codex", bin: "codex", hasAdapter: resultAdapterForFamily("codex"), requiresAuth: true },
  { id: "codex-cli", kind: "cli", family: "codex", bin: "codex", hasAdapter: resultAdapterForFamily("codex"), requiresAuth: true },
  // Detect-only until adapters ship (OD-6) — no registry row for gemini (D10); pi/antigravity rows carry result_adapter:false.
  { id: "gemini-cli", kind: "cli", family: "gemini", bin: "gemini", hasAdapter: resultAdapterForFamily("gemini"), requiresAuth: false },
  { id: "pi", kind: "cli", family: "pi", bin: "pi", hasAdapter: resultAdapterForFamily("pi"), requiresAuth: false },
  // VERIFIED on-host 2026-06-16: the Antigravity CLI is `agy` (1.0.8), not `antigravity` — detection must probe `agy` or it never finds the host.
  { id: "antigravity", kind: "cli", family: "antigravity", bin: "agy", hasAdapter: resultAdapterForFamily("antigravity"), requiresAuth: false },
];

// ---------------------------------------------------------------------------
// Host-family resolution
// ---------------------------------------------------------------------------

const KNOWN_FAMILIES = new Set<HostFamily>([
  "claude",
  "codex",
  "gemini",
  "pi",
  "antigravity",
]);

/**
 * Map a host string (from settings `host:` or an explicit override) to a family.
 * "auto"/unset ⇒ claude (the expected reference host). Antigravity host-kinds
 * (`antigravity-2`) collapse to `antigravity`. Anything unrecognized ⇒ "unknown"
 * — a SAFE value: an unknown author family forces cross to degrade rather than
 * risk a same-family self-review masquerading as independent.
 */
export function resolveAuthorHost(host?: string): HostFamily {
  if (host === undefined || host === "auto" || host === "") return "claude";
  if (host.startsWith("antigravity")) return "antigravity";
  if (host.startsWith("claude")) return "claude"; // claude, claude-code-*, claude-ai-connector
  if (host.startsWith("codex")) return "codex"; // codex, codex-app
  if (KNOWN_FAMILIES.has(host as HostFamily)) return host as HostFamily;
  return "unknown";
}

// ---------------------------------------------------------------------------
// Auth probes
// ---------------------------------------------------------------------------

function probeAuth(spec: ProviderSpec, probe: ProbeEnv): boolean {
  switch (spec.family) {
    case "codex":
      // BOTH paths (never env-var-only — that produces a false negative for the
      // stored-creds `codex login` flow; see codex-review SKILL availability note).
      return probe.readStoredCodexAuth() || !!probe.readEnv("OPENAI_API_KEY");
    case "gemini":
      return !!(probe.readEnv("GEMINI_API_KEY") || probe.readEnv("GOOGLE_API_KEY"));
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// detectProviders
// ---------------------------------------------------------------------------

export interface DetectOptions {
  cwd: string;
  host?: string;
  /** Injected probe env. Defaults to the real shelling probes. */
  probe?: ProbeEnv;
}

/**
 * Tiered detection (OD-6) for every registry provider + author-host resolution.
 * Pure w.r.t. settings — never writes. The `claude` host provider is always
 * reported as detected-on-the-host (it IS the reference author host).
 */
export function detectProviders(opts: DetectOptions): DetectionResult {
  const probe = opts.probe ?? defaultProbeEnv(opts.cwd);
  const authorHost = resolveAuthorHost(opts.host);
  const declared = new Set(safe(() => probe.readCapabilityProviders(), [] as string[]));

  const providers: DetectedProvider[] = PROVIDER_REGISTRY.map((spec) => {
    // The host provider (claude) is detected by virtue of being the host.
    if (spec.kind === "host") {
      return {
        id: spec.id,
        kind: spec.kind,
        family: spec.family,
        detected: true,
        authed: false, // not an auth concept for the host itself
        selectable: false, // never a CROSS reviewer for a same-family author
        detail: "current author host",
      };
    }

    // A plugin-adapter's PRIMARY detection signal is the native plugin being
    // installed in the host (e.g. `codex:codex-rescue`), NOT the raw CLI on PATH.
    // This makes "codex CLI present but plugin adapter absent" representable.
    const byPlugin =
      spec.kind === "plugin-adapter" && safe(() => probe.readPluginAdapter(spec.id), false);

    const onPath = !!spec.bin && safe(() => probe.commandOnPath(spec.bin as string), false);
    const versionOk = onPath && safe(() => probe.probeVersion(spec.bin as string), false);
    const byManifest = declared.has(spec.id) || declared.has(spec.family);

    // CLI providers detect via PATH+version; plugin-adapters via the plugin probe.
    // Capability manifests can declare either. (A plugin-adapter does NOT detect
    // off the bare CLI — that would conflate it with the cli provider.)
    const detected = spec.kind === "plugin-adapter" ? byPlugin || byManifest : versionOk || byManifest;
    const authed = detected ? safe(() => probeAuth(spec, probe), false) : false;

    // Selectable iff a real adapter exists AND it is detected AND (auth passes
    // when required). Detect-only providers (hasAdapter=false) are NEVER selectable.
    const selectable =
      spec.hasAdapter && detected && (!spec.requiresAuth || authed);

    const detail = describe(spec, { onPath, versionOk, byManifest, byPlugin, authed, selectable });

    return {
      id: spec.id,
      kind: spec.kind,
      family: spec.family,
      detected,
      authed,
      selectable,
      detail,
    };
  });

  return { authorHost, providers };
}

function describe(
  spec: ProviderSpec,
  s: {
    onPath: boolean;
    versionOk: boolean;
    byManifest: boolean;
    byPlugin: boolean;
    authed: boolean;
    selectable: boolean;
  }
): string {
  const bits: string[] = [];
  if (s.byPlugin) bits.push(`native plugin adapter '${spec.id}' installed`);
  if (s.versionOk) bits.push(`${spec.bin} on PATH (version ok)`);
  else if (s.onPath) bits.push(`${spec.bin} on PATH (version probe failed)`);
  if (s.byManifest) bits.push("declared by capability.json manifest");
  if (!bits.length) bits.push("not detected");
  if (s.authed) bits.push("authed");
  if (!spec.hasAdapter) bits.push("detect-only (no adapter yet — not selectable)");
  else if (!s.selectable) bits.push("adapter present but not yet usable (detection/auth incomplete)");
  return bits.join("; ");
}

// ---------------------------------------------------------------------------
// recommendProvider (OD-5 / AC-7)
// ---------------------------------------------------------------------------

/**
 * Recommend a provider for `provider=auto`. Re-detects from the live detection
 * passed in (OD-5: never persists). Policy (AC-7): a Claude author with the
 * codex-plugin available recommends `codex-plugin`. More generally: recommend the
 * highest-ranked selectable DIFFERENT-family provider. Returns null + a reason
 * when nothing recommendable exists.
 */
export function recommendProvider(
  detection: DetectionResult,
  resolvedReview: ResolvedReview
): RecommendResult {
  if (resolvedReview.mode !== "cross") {
    return {
      recommended: null,
      reason: `review.mode=${resolvedReview.mode} — no cross-family recommendation needed`,
    };
  }

  // SAFETY GATE — same as selectReviewer: unknown author cannot prove independence.
  if (detection.authorHost === "unknown") {
    return {
      recommended: null,
      reason:
        "author host family is 'unknown' — cannot prove cross-family independence; " +
        "identify the author host before recommending a cross-family reviewer",
    };
  }

  const ranked = rankReviewers(detection);
  if (ranked.length === 0) {
    return {
      recommended: null,
      reason:
        `no selectable different-family reviewer available for a ${detection.authorHost} author ` +
        `(gemini/pi/antigravity are detect-only until their adapters ship)`,
    };
  }

  const top = ranked[0];
  const claudePref =
    detection.authorHost === "claude" && top.id === "codex-plugin"
      ? "claude author prefers the native Codex plugin adapter (codex:codex-rescue); "
      : "";
  return {
    recommended: top.id,
    reason: `${claudePref}recommended '${top.id}' — highest-ranked selectable ${top.family}-family reviewer`,
  };
}

// ---------------------------------------------------------------------------
// selectReviewer (AC-8 hard rule)
// ---------------------------------------------------------------------------

/**
 * Resolve the actual reviewer to dispatch. THE false-signoff guard (AC-8):
 *
 *   - review.mode === "off"   ⇒ skipped (no provider).
 *   - review.mode === "local" ⇒ degraded-local (cross not requested).
 *   - review.mode === "cross":
 *       * If provider is an explicit pin:
 *           - same family as author ⇒ skipped (NEVER selected — self-review).
 *           - not selectable        ⇒ skipped (no real adapter / not authed).
 *           - else                  ⇒ selected.
 *         A non-selectable or same-family pin is NEVER silently substituted.
 *       * If provider === "auto": pick the highest-ranked selectable
 *         DIFFERENT-family reviewer. None ⇒ degraded-local (if any same-family
 *         reviewer exists, label the degradation) or skipped.
 *
 * There is NO branch that returns `selected` with a same-family provider.
 */
export function selectReviewer(
  detection: DetectionResult,
  resolvedReview: ResolvedReview
): SelectResult {
  if (resolvedReview.mode === "off") {
    return { provider: null, status: "skipped", reason: "review.mode=off — no review requested" };
  }
  if (resolvedReview.mode === "local") {
    return {
      provider: null,
      status: "degraded-local",
      reason: "review.mode=local — same-host review only (not adversarial cross-family)",
    };
  }

  // mode === "cross"
  const { authorHost } = detection;

  // SAFETY GATE — unknown author family cannot satisfy review=cross.
  //
  // The STRONG-independence rule (AC-8) requires we prove the reviewer is from a
  // DIFFERENT family than the author. When authorHost === "unknown" we have no
  // verified author family, so the `reviewer.family !== authorHost` inequality is
  // meaningless — "codex" !== "unknown" is vacuously true and would let any
  // reviewer through while providing zero independence guarantee.
  //
  // The safe posture is to degrade: if any reviewer is detected (even detect-only)
  // we call it degraded-local; if the world is entirely empty we skip. Either way
  // the gate is NEVER marked "selected" for an unknown author.
  if (authorHost === "unknown") {
    const unknownReason =
      "author host family is 'unknown' — cannot prove cross-family independence; " +
      "identify the author host to enable review=cross";
    const anyDetected = detection.providers.some((p) => p.kind !== "host" && p.detected);
    return {
      provider: null,
      status: anyDetected ? "degraded-local" : "skipped",
      reason: unknownReason,
    };
  }

  // Explicit pin path — honor-or-refuse, never silent-substitute.
  if (resolvedReview.provider !== "auto") {
    const pinned = detection.providers.find((p) => p.id === resolvedReview.provider);
    if (!pinned) {
      return {
        provider: null,
        status: "skipped",
        reason: `pinned provider '${resolvedReview.provider}' is unknown — not selectable for review=cross`,
      };
    }
    if (pinned.family === authorHost) {
      // AC-8: same family can NEVER satisfy cross.
      return {
        provider: null,
        status: "skipped",
        reason:
          `pinned provider '${pinned.id}' is the same family (${pinned.family}) as the author host — ` +
          `a same-family reviewer cannot satisfy review=cross (self-review)`,
      };
    }
    if (!pinned.selectable) {
      return {
        provider: null,
        status: "skipped",
        reason:
          `pinned provider '${pinned.id}' is detected but NOT selectable for review=cross ` +
          `(no usable adapter yet / auth incomplete) — refusing to silently substitute another provider`,
      };
    }
    return {
      provider: pinned.id,
      status: "selected",
      reason: `operator-pinned '${pinned.id}' (${pinned.family} family ≠ ${authorHost} author) selected`,
    };
  }

  // provider === "auto" — rank selectable different-family reviewers.
  const ranked = rankReviewers(detection);
  if (ranked.length > 0) {
    const top = ranked[0];
    return {
      provider: top.id,
      status: "selected",
      reason: `auto-selected '${top.id}' — highest-ranked selectable ${top.family}-family reviewer`,
    };
  }

  // No different-family selectable reviewer. Decide degraded-local vs skipped.
  // If ANY reviewer exists at all (even same-family/detect-only), we degrade to
  // local so the operator gets a weak-but-labelled review rather than a silent
  // gap. If nothing at all is around, skip with a reason. Either way: never a
  // false signoff (status is never "selected").
  const anyOther = detection.providers.some(
    (p) => p.kind !== "host" && (p.detected || p.authed)
  );
  if (anyOther) {
    return {
      provider: null,
      status: "degraded-local",
      reason:
        `no DIFFERENT-family selectable reviewer for a ${authorHost} author — ` +
        `only same-family or detect-only providers present; degrading to weak/local review (NOT adversarial)`,
    };
  }
  return {
    provider: null,
    status: "skipped",
    reason:
      `no reviewer available and review=cross — skipped with reason (NOT a sign-off). ` +
      `Install/authenticate a different-family reviewer (e.g. the Codex plugin) to satisfy the cross gate`,
  };
}

// ---------------------------------------------------------------------------
// Ranker — selectable, different-family, native plugin adapter before CLI.
// ---------------------------------------------------------------------------

/**
 * Rank the reviewers that can ACTUALLY satisfy a cross gate for this author:
 * selectable === true AND family !== authorHost. Registry order encodes the
 * within-family preference (plugin-adapter before cli). Across families, a
 * `plugin-adapter` outranks a `cli` so a native integration is preferred.
 */
function rankReviewers(detection: DetectionResult): DetectedProvider[] {
  const candidates = detection.providers.filter(
    (p) => p.selectable && p.family !== detection.authorHost
  );
  const kindRank: Record<ProviderKind, number> = { "plugin-adapter": 0, cli: 1, host: 2 };
  const regOrder = new Map(PROVIDER_REGISTRY.map((s, i) => [s.id, i] as const));
  return candidates.sort((a, b) => {
    const k = kindRank[a.kind] - kindRank[b.kind];
    if (k !== 0) return k;
    return (regOrder.get(a.id) ?? 99) - (regOrder.get(b.id) ?? 99);
  });
}

// ---------------------------------------------------------------------------
// Default (real) probe environment — shells out; never used in tests.
// ---------------------------------------------------------------------------

/**
 * The production probe env. Every method is best-effort + non-throwing: a
 * missing binary or unreadable file yields a safe falsy result so a detection
 * pass never crashes a run.
 */
export function defaultProbeEnv(cwd: string): ProbeEnv {
  return {
    commandOnPath: (bin: string) =>
      safe(() => {
        execSync(`command -v ${shellSafe(bin)}`, { stdio: "ignore" });
        return true;
      }, false),
    probeVersion: (bin: string) =>
      safe(() => {
        execSync(`${shellSafe(bin)} --version`, { stdio: "ignore", timeout: 5000 });
        return true;
      }, false),
    readStoredCodexAuth: () =>
      safe(() => {
        const home = process.env["CODEX_HOME"] || path.join(os.homedir(), ".codex");
        const authFile = path.join(home, "auth.json");
        const st = fs.statSync(authFile);
        return st.isFile() && st.size > 0;
      }, false),
    readEnv: (name: string) => process.env[name],
    readCapabilityProviders: () => safe(() => readCapabilityManifests(cwd), []),
    readPluginAdapter: (adapterId: string) =>
      // The reference codex-plugin adapter (`codex:codex-rescue`) dispatches
      // through the codex binary, so in production its presence tracks the codex
      // CLI being installed. A future host could expose a richer plugin-registry
      // probe; this default is the best signal available without one.
      adapterId === "codex-plugin"
        ? safe(() => {
            execSync(`command -v codex`, { stdio: "ignore" });
            return true;
          }, false)
        : false,
  };
}

/**
 * Scan `.guild/hosts/**​/capability.json` and collect declared provider ids /
 * families. Lenient: malformed JSON or a missing dir yields []. We read either a
 * `provider` / `id` field, a `family` field, or a `providers: []` list — whatever
 * a future host adapter chooses to declare.
 */
function readCapabilityManifests(cwd: string): string[] {
  const hostsDir = path.join(cwd, ".guild", "hosts");
  if (!fs.existsSync(hostsDir)) return [];
  const out = new Set<string>();
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name === "capability.json") {
        try {
          const m = JSON.parse(fs.readFileSync(full, "utf8")) as Record<string, unknown>;
          for (const key of ["provider", "id", "family"]) {
            if (typeof m[key] === "string") out.add(m[key] as string);
          }
          if (Array.isArray(m["providers"])) {
            for (const p of m["providers"]) if (typeof p === "string") out.add(p);
          }
        } catch {
          /* malformed manifest — skip */
        }
      }
    }
  };
  walk(hostsDir);
  return Array.from(out);
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Conservative allowlist for binary names interpolated into a shell probe. */
function shellSafe(bin: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(bin)) {
    throw new Error(`refusing to probe unsafe binary name: ${bin}`);
  }
  return bin;
}
