/**
 * src/modules/config/workflows/policy-keys.ts — the CLOSED policy key set (KTD22).
 *
 * Durable Guild config is POLICY. Host family, host id, and concrete model names
 * are SESSION state: they are detected from the T0 process at run start and land
 * on the run record as `guild.session_binding.v1`, never in a file under git.
 *
 * This module is the single place that answers two questions:
 *
 *   1. Is this dotted key inside the closed policy set? (`isPolicyKey`)
 *   2. Does this key or value carry host identity? (`findHostIdentity`)
 *
 * Both answers are enforced at WRITE (`config set`, overlay writes) and at READ
 * (the policy resolver). A rejected key fails CLOSED with a message that names
 * the key — never a silent drop, and never a coercion to a Claude default.
 *
 * Changing this list is an operator decision, not a lane decision: the set is
 * fixed by the source plan §Config ("What may live where") and U-CFG.
 */

// The kernel primitive, not a local helper: the closed-collection rail only trusts
// a freeze it can resolve to a real implementation. `kernel` imports no other
// domain, so this stays the resolver's only domain edge.
import { deepFreeze } from "../../kernel";

// ── The closed policy key set ────────────────────────────────────────────────

/** How a policy value is validated. `enum` carries its own allowed member list. */
export type PolicyKeyType = "enum" | "boolean" | "integer" | "number";

export interface PolicyKeySpec {
  /** Dotted path as written on disk and typed at `config set`. */
  key: string;
  type: PolicyKeyType;
  /** Allowed members for `type: "enum"`. */
  values?: readonly string[];
  /** Inclusive bounds for numeric types. */
  min?: number;
  max?: number;
  /** Builtin value — the bottom layer of the resolver chain. */
  default: unknown;
  /** One line, printed by `config show` and the reject message. */
  note: string;
}

/**
 * The closed set. Every entry traces to the plan's policy row:
 * tier selectors · score floors · advisorRounds · budget.tokens|usd ·
 * team.compose_scope · recall.backend · recall thresholds · review.critic ·
 * review independence · wiki.autopromote · agent_mode preference.
 *
 * Note what is NOT here, by design: `models.tiers.<host>`, `host`,
 * `host_profiles.*`, or any key whose value is a provider model name.
 */
export const POLICY_KEYS: readonly PolicyKeySpec[] = deepFreeze([
  // Tier SELECTORS — which tier a lane starts at, never which model serves it.
  {
    key: "tiers.default",
    type: "enum",
    values: ["cheap", "mid", "powerful"],
    default: "mid",
    note: "tier a lane starts at when its score names none; the adapter maps tier→model at dispatch",
  },
  // Score floors — the complexity score at which a lane is promoted a tier.
  {
    key: "tiers.floors.mid",
    type: "number",
    min: 0,
    max: 10,
    default: 3,
    note: "complexity-score floor at which a lane resolves to the mid tier",
  },
  {
    key: "tiers.floors.powerful",
    type: "number",
    min: 0,
    max: 10,
    default: 6,
    note: "complexity-score floor at which a lane resolves to the powerful tier",
  },
  {
    key: "advisorRounds",
    type: "integer",
    min: 0,
    max: 10,
    default: 2,
    note: "advisor escalation rounds a cell may spend before it blocks with next_need: budget (R72)",
  },
  {
    key: "budget.tokens",
    type: "integer",
    min: 0,
    default: null,
    note: "optional per-run token cap; null = uncapped. D-PROBE and inner verify do not decrement it",
  },
  {
    key: "budget.usd",
    type: "number",
    min: 0,
    default: null,
    note: "optional per-run spend cap in USD; null = uncapped",
  },
  {
    key: "team.compose_scope",
    type: "enum",
    values: ["phase", "goal"],
    default: "phase",
    note: "whether team-compose mints per phase or slices a roster per goal (KTD62)",
  },
  {
    key: "recall.backend",
    type: "enum",
    values: ["bm25", "hybrid"],
    default: "bm25",
    note: "recall backend; embeddings are cache only and a missing model fails open to bm25 (KTD67)",
  },
  {
    key: "recall.thresholds.min_score",
    type: "number",
    min: 0,
    max: 1,
    default: 0.2,
    note: "minimum BM25 score a recall hit needs to enter a bundle",
  },
  {
    key: "recall.thresholds.max_hits",
    type: "integer",
    min: 1,
    max: 100,
    default: 8,
    note: "maximum recall hits a lane bundle may carry",
  },
  {
    key: "review.critic",
    type: "enum",
    values: ["off", "advisor"],
    default: "advisor",
    note: "who plays critic; `advisor` is the machinery agent, never a new model family (KTD68)",
  },
  {
    key: "review.independence",
    type: "boolean",
    default: true,
    note: "a Team Lead may not review its own cell (KTD58); false only for single-agent local runs",
  },
  {
    key: "wiki.autopromote",
    type: "boolean",
    default: true,
    note: "harvest auto-promotes decisions on this cwd; false = candidates-only (KTD35)",
  },
  {
    key: "agent_mode",
    type: "enum",
    values: ["auto", "team", "agent", "subagent"],
    default: "auto",
    note: "dispatch backend PREFERENCE only; never a statement about which host is running",
  },
] as PolicyKeySpec[]);

const BY_KEY = new Map(POLICY_KEYS.map((s) => [s.key, s]));

/**
 * Legacy dotted paths that mean a policy key. The v1 surface nested most of
 * these under `defaults.`; accepting the old spelling keeps `config set` usable
 * across the upgrade without widening the closed set (T07 rewrites the files).
 */
export const POLICY_KEY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "defaults.wiki.autopromote": "wiki.autopromote",
  "defaults.agent_mode": "agent_mode",
  "defaults.team.compose_scope": "team.compose_scope",
  "defaults.recall.backend": "recall.backend",
  "defaults.review.critic": "review.critic",
  "defaults.advisorRounds": "advisorRounds",
});

/** Canonical policy key for `dotted`, or `dotted` itself when it is not an alias. */
export function canonicalPolicyKey(dotted: string): string {
  return POLICY_KEY_ALIASES[dotted] ?? dotted;
}

export function isPolicyKey(dotted: string): boolean {
  return BY_KEY.has(canonicalPolicyKey(dotted));
}

export function policyKeySpec(dotted: string): PolicyKeySpec | undefined {
  return BY_KEY.get(canonicalPolicyKey(dotted));
}

/** The builtin layer: every policy key at its default, as a nested object. */
export function policyDefaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of POLICY_KEYS) setByPath(out, spec.key, spec.default);
  return out;
}

// ── Host identity: what durable config may never carry ───────────────────────

/**
 * Host FAMILIES. A durable file naming one of these as authority is the exact
 * defect KTD22 forbids — the initiative gets stuck on the first host that ran it.
 */
export const HOST_FAMILY_TOKENS: readonly string[] = Object.freeze([
  "claude", "codex", "cursor", "gemini", "copilot", "windsurf", "aider",
  "antigravity", "pi", "cline", "continue", "zed",
]);

/**
 * MODEL FAMILIES are allowed — they are what the dialect layer keys on, and they
 * name no product. `anthropic` in a dialect filename is fine; `opus` is not.
 */
export const MODEL_FAMILY_TOKENS: readonly string[] = Object.freeze([
  "anthropic", "openai", "google",
]);

/**
 * Concrete model names. Deliberately a token/pattern list rather than a catalog
 * snapshot: the catalog lives on the platform cache and must not become a second
 * durable inventory, so the guard cannot depend on it being present.
 */
const MODEL_NAME_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bopus\b/i,
  /\bsonnet\b/i,
  /\bhaiku\b/i,
  /\bfable\b/i,
  /\bgpt-?[0-9]/i,
  /\bo[1-9](?:-(?:mini|pro|preview))?\b/i,
  /\bgemini-[0-9]/i,
  /\bclaude-[a-z0-9]/i,
  /\bllama-?[0-9]/i,
  /\bmistral\b/i,
  /\bgrok-?[0-9]/i,
  /\bdeepseek\b/i,
  /\bqwen\b/i,
]);

export type HostIdentityKind = "host-family" | "host-id" | "model-name" | "model-inventory";

export interface HostIdentityHit {
  kind: HostIdentityKind;
  /** The dotted key path the hit was found at (`""` for a free-text scan). */
  key: string;
  /** The exact token that tripped the guard. */
  token: string;
}

/**
 * Key paths that persist per-host model inventory. These are rejected on the key
 * alone, because the VALUE is often innocuous (`"cheap"`) while the key itself is
 * the inventory KTD22 forbids.
 */
const INVENTORY_KEY_PATTERNS: readonly RegExp[] = Object.freeze([
  /^models(\.|$)/,
  /^defaults\.models(\.|$)/,
  /^host_profiles(\.|$)/,
  /^defaults\.host_profiles(\.|$)/,
  /^host(\.|$)/,
  /^defaults\.host(\.|$)/,
  /^roles\.[^.]+\.host(\.|$)/,
  /^defaults\.cross_host(\.|$)/,
]);

/** A token that is a host family standing alone (not a substring of a word). */
function matchesHostFamily(text: string): string | null {
  for (const fam of HOST_FAMILY_TOKENS) {
    if (new RegExp(`(^|[^a-z0-9])${fam}([^a-z0-9]|$)`, "i").test(text)) return fam;
  }
  return null;
}

function matchesModelName(text: string): string | null {
  for (const re of MODEL_NAME_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/**
 * Scan ONE key/value pair. Returns the first hit, or `null` when the pair carries
 * no host identity.
 *
 * `knownHostIds` lets a caller thread in the live host registry; the guard works
 * without it (families + model patterns + inventory keys already cover the
 * fixtures), so a missing registry never opens the gate.
 */
export function findHostIdentity(
  key: string,
  value: unknown,
  knownHostIds: readonly string[] = [],
): HostIdentityHit | null {
  for (const re of INVENTORY_KEY_PATTERNS) {
    if (re.test(key)) return { kind: "model-inventory", key, token: key };
  }

  const segments = key.split(".");
  for (const seg of segments) {
    if (MODEL_FAMILY_TOKENS.includes(seg.toLowerCase())) continue;
    const fam = matchesHostFamily(seg);
    if (fam) return { kind: "host-family", key, token: fam };
    if (knownHostIds.some((h) => h.toLowerCase() === seg.toLowerCase())) {
      return { kind: "host-id", key, token: seg };
    }
    const model = matchesModelName(seg);
    if (model) return { kind: "model-name", key, token: model };
  }

  if (typeof value === "string") {
    const model = matchesModelName(value);
    if (model) return { kind: "model-name", key, token: model };
    if (knownHostIds.some((h) => h.toLowerCase() === value.toLowerCase())) {
      return { kind: "host-id", key, token: value };
    }
    if (!MODEL_FAMILY_TOKENS.includes(value.toLowerCase())) {
      const fam = matchesHostFamily(value);
      if (fam) return { kind: "host-family", key, token: fam };
    }
  }
  return null;
}

/**
 * Walk a parsed config value and collect every host-identity hit.
 *
 * EVERY string leaf is scanned, at any depth, through objects AND arrays. The
 * first cut treated an array as a leaf and handed the array itself to the
 * per-pair check, so `{"tiers": ["opus"]}` passed the guard while
 * `{"tiers": "opus"}` was refused — the same pin, hidden one bracket deeper
 * (codex G-lane r1 P1-4). An array index appears in the reported key as `[i]`,
 * so the message still names the exact place to edit.
 */
export function scanHostIdentity(
  obj: unknown,
  knownHostIds: readonly string[] = [],
  prefix = "",
): HostIdentityHit[] {
  const out: HostIdentityHit[] = [];

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      out.push(...scanHostIdentity(item, knownHostIds, `${prefix}[${i}]`));
    });
    return out;
  }

  if (obj === null || typeof obj !== "object") {
    // A scalar leaf. `prefix === ""` only for a top-level scalar document, which
    // the resolver already refuses as "not an object" — scan it anyway rather
    // than let the shape decide whether the guard runs.
    const hit = findHostIdentity(prefix, obj, knownHostIds);
    if (hit) out.push(hit);
    return out;
  }

  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const dotted = prefix === "" ? k : `${prefix}.${k}`;
    // The KEY is checked on its own first: an inventory key is refused even when
    // its value is innocuous, and the whole subtree goes with it.
    const keyHit = findHostIdentity(dotted, undefined, knownHostIds);
    if (keyHit) {
      out.push(keyHit);
      continue;
    }
    out.push(...scanHostIdentity(v, knownHostIds, dotted));
  }
  return out;
}

/**
 * Free-text scan for prompt overlays and dialect fragments (`.guild/prompts/**`).
 * Same reject as `config set` inventory: a dialect keys on a model FAMILY, never
 * on `opus` or `gpt-5.4`.
 */
export function findModelNameInText(text: string): string | null {
  return matchesModelName(text);
}

// ── The refusal ──────────────────────────────────────────────────────────────

export class PolicyRejectedError extends Error {
  constructor(
    readonly reason: "not-policy" | HostIdentityKind,
    readonly key: string,
    message: string,
  ) {
    super(message);
    this.name = "PolicyRejectedError";
  }
}

function identityMessage(hit: HostIdentityHit, where: string): string {
  const what =
    hit.kind === "model-inventory"
      ? `'${hit.key}' persists per-host model inventory`
      : hit.kind === "host-family"
        ? `'${hit.key}' carries the host family '${hit.token}'`
        : hit.kind === "host-id"
          ? `'${hit.key}' carries the host id '${hit.token}'`
          : `'${hit.key}' carries the concrete model name '${hit.token}'`;
  return (
    `${where}: ${what}. Durable config is policy only (KTD22) — host and models ` +
    `are bound per session on the run record (guild.session_binding.v1). ` +
    `Run \`guild config models\` to inspect this session's binding.`
  );
}

/**
 * Gate one `config set` / overlay write. Throws `PolicyRejectedError` naming the
 * key, or returns the canonical policy key when the write is allowed.
 */
export function assertPolicyWrite(
  key: string,
  value: unknown,
  opts: { where?: string; knownHostIds?: readonly string[] } = {},
): string {
  const where = opts.where ?? "config set";
  const hit = findHostIdentity(key, value, opts.knownHostIds ?? []);
  if (hit) throw new PolicyRejectedError(hit.kind, key, identityMessage(hit, where));

  const canonical = canonicalPolicyKey(key);
  const spec = BY_KEY.get(canonical);
  if (!spec) {
    throw new PolicyRejectedError(
      "not-policy",
      key,
      `${where}: '${key}' is not a policy key. Durable config holds the closed ` +
        `policy set only (KTD22): ${POLICY_KEYS.map((s) => s.key).join(", ")}.`,
    );
  }
  const valueErr = validatePolicyValue(spec, value);
  if (valueErr) throw new PolicyRejectedError("not-policy", key, `${where}: ${valueErr}`);
  return canonical;
}

/** Type/range check for a policy value. Returns an error string, or `null`. */
export function validatePolicyValue(spec: PolicyKeySpec, value: unknown): string | null {
  if (value === null) {
    return spec.default === null ? null : `'${spec.key}' does not accept null`;
  }
  switch (spec.type) {
    case "enum":
      return typeof value === "string" && spec.values!.includes(value)
        ? null
        : `'${spec.key}' must be one of: ${spec.values!.join(" | ")}`;
    case "boolean":
      return typeof value === "boolean" ? null : `'${spec.key}' must be true or false`;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return `'${spec.key}' must be an integer`;
      }
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `'${spec.key}' must be a number`;
      }
      break;
  }
  const n = value as number;
  if (spec.min !== undefined && n < spec.min) return `'${spec.key}' must be >= ${spec.min}`;
  if (spec.max !== undefined && n > spec.max) return `'${spec.key}' must be <= ${spec.max}`;
  return null;
}

// ── small helpers ────────────────────────────────────────────────────────────

export function setByPath(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    const next = cur[p];
    if (next === undefined || next === null || typeof next !== "object" || Array.isArray(next)) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

export function getByPath(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const p of dotted.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
