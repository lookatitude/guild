/**
 * src/modules/config/workflows/policy-resolver.ts — the policy-only resolver (U-CFG).
 *
 * Reads `.guild/config/workspace.json` and `.guild/config/project.json` (durable,
 * in git) plus ONE machine-local overlay on the platform state root (not in git),
 * and returns the closed policy key set with a source per key.
 *
 * It keeps the shipped inheritance semantics for policy keys — later layers win,
 * `_local` files stay machine-private, CLI flags stay on top:
 *
 *   builtin < workspace < workspace-local < project < project-local < overlay < rigor < CLI
 *
 * What it does NOT do, on purpose: resolve a model, name a host, or fall back to
 * Claude. Those are session facts, bound per run by `session-binding.ts`.
 *
 * FAIL CLOSED: a durable file (or the overlay) that carries a host family, a host
 * id, a concrete model name, or per-host inventory is REJECTED at read with a
 * message naming the key. The resolver does not strip the key and continue —
 * silently dropping inventory is how a stale pin survives an upgrade unnoticed.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  POLICY_KEYS,
  POLICY_KEY_ALIASES,
  PolicyRejectedError,
  assertPolicyWrite,
  canonicalPolicyKey,
  getByPath,
  policyDefaults,
  policyKeySpec,
  scanHostIdentity,
  setByPath,
  validatePolicyValue,
} from "./policy-keys";

/** Durable policy file names under `.guild/config/`. */
export const POLICY_FILES = Object.freeze({
  project: "config/project.json",
  projectLocal: "config/project.local.json",
  workspace: "config/workspace.json",
  workspaceLocal: "config/workspace.local.json",
});

/** The machine-local overlay file name under the platform STATE root. */
export const POLICY_OVERLAY_FILE = "policy-overlay.json";

export type PolicySource =
  | "builtin"
  | "workspace"
  | "workspace-local"
  | "project"
  | "project-local"
  | "overlay"
  | "rigor"
  | "cli";

export interface ResolvePolicyOptions {
  cwd: string;
  /** Workspace root, when this cwd is a child of one. */
  workspaceRoot?: string | null;
  /**
   * The machine-local overlay.
   *
   * `undefined` (the default) resolves the platform-state path through
   * `GuildStorage` — so every caller sees the overlay, and an identity violation
   * in it surfaces wherever policy is read. Pass `null` to skip the layer
   * deliberately (a fixture that is not testing the overlay).
   */
  overlayFile?: string | null;
  /** Rigor-profile policy overrides (sparse, already expanded by the caller). */
  rigor?: Record<string, unknown>;
  /** CLI flag overrides (sparse, dotted keys). */
  flags?: Record<string, unknown>;
  /** Live host-registry ids, threaded through to the identity guard. */
  knownHostIds?: readonly string[];
}

/** One legacy `defaults.*` spelling found on disk, and what became of it. */
export interface LegacyAliasRecord {
  /** The canonical policy key it aliases. */
  key: string;
  /** The legacy dotted spelling as written in the file. */
  legacy: string;
  layer: PolicySource;
  file: string;
  /**
   * `true` when the canonical key was ALSO present in the same file and won, so
   * this alias contributed nothing. `false` when the alias supplied the value
   * because no canonical spelling was there.
   */
  shadowed: boolean;
}

export interface ResolvedPolicy {
  /** Nested object: every policy key present, defaults filled in. */
  policy: Record<string, unknown>;
  /** Dotted key → the layer that last set it. */
  sources: Record<string, PolicySource>;
  /** Layer label → absolute file that contributed (only layers that existed). */
  files: Array<{ layer: PolicySource; file: string }>;
  /**
   * Every legacy alias seen, in read order. `show --sources` prints these so an
   * operator can see the old spelling is inert before T07 deletes it.
   */
  legacyAliases: LegacyAliasRecord[];
}

function readJsonFile(file: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new PolicyRejectedError(
      "not-policy",
      file,
      `policy config: ${file} is not valid JSON (${(e as Error).message}). ` +
        `Refusing to resolve policy from a file Guild cannot parse.`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PolicyRejectedError("not-policy", file, `policy config: ${file} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Validate ONE durable layer: reject host identity, reject unknown keys, reject
 * out-of-range values. Returns the sparse set of canonical policy keys it sets.
 */
function readLayer(
  file: string,
  layer: PolicySource,
  knownHostIds: readonly string[],
): { values: Map<string, unknown>; aliases: LegacyAliasRecord[] } | null {
  const parsed = readJsonFile(file);
  if (parsed === null) return null;

  const identity = scanHostIdentity(parsed, knownHostIds);
  if (identity.length > 0) {
    const hit = identity[0];
    throw new PolicyRejectedError(
      hit.kind,
      hit.key,
      `policy config (${layer}, ${file}): key '${hit.key}' carries ${
        hit.kind === "model-inventory" ? "per-host model inventory" : `'${hit.token}'`
      }. Durable config is policy only (KTD22); host and model are bound per ` +
        `session on the run record. Remove the key, or inspect the session with ` +
        `\`guild config models\`.`,
    );
  }

  const out = new Map<string, unknown>();
  const aliases: LegacyAliasRecord[] = [];
  for (const spec of POLICY_KEYS) {
    // CANONICAL FIRST, and it wins. The first cut iterated
    // `[canonical, ...aliases]` and let each assignment overwrite the last, so a
    // legacy `defaults.wiki.autopromote: true` sitting beside a canonical
    // `wiki.autopromote: false` silently won — `config set` reported success and
    // the effective value never moved (codex G-lane r2 P1-1).
    const canonical = getByPath(parsed, spec.key);
    if (canonical !== undefined) {
      const err = validatePolicyValue(spec, canonical);
      if (err) {
        throw new PolicyRejectedError("not-policy", spec.key, `policy config (${layer}, ${file}): ${err}`);
      }
      out.set(spec.key, canonical);
    }
    for (const legacy of aliasesFor(spec.key)) {
      const v = getByPath(parsed, legacy);
      if (v === undefined) continue;
      const err = validatePolicyValue(spec, v);
      if (err) {
        throw new PolicyRejectedError("not-policy", spec.key, `policy config (${layer}, ${file}): ${err}`);
      }
      // An alias only supplies a value when the canonical spelling is absent.
      const shadowed = out.has(spec.key);
      if (!shadowed) out.set(spec.key, v);
      aliases.push({ key: spec.key, legacy, layer, file, shadowed });
    }
  }

  // Anything left over is an unknown key: fail closed rather than ignore it, so a
  // typo does not read as "the default is fine".
  const known = new Set<string>();
  for (const spec of POLICY_KEYS) {
    known.add(spec.key);
    for (const a of aliasesFor(spec.key)) known.add(a);
  }
  for (const dotted of leafPaths(parsed)) {
    if (known.has(dotted)) continue;
    // A container path (`budget`) whose leaves are known is fine.
    if ([...known].some((k) => k.startsWith(`${dotted}.`))) continue;
    throw new PolicyRejectedError(
      "not-policy",
      dotted,
      `policy config (${layer}, ${file}): '${dotted}' is not a policy key. ` +
        `The closed set is: ${POLICY_KEYS.map((s) => s.key).join(", ")}.`,
    );
  }
  return { values: out, aliases };
}

/** Legacy spellings that resolve to `canonical` (reverse of POLICY_KEY_ALIASES). */
const ALIASES_BY_CANONICAL: ReadonlyMap<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [legacy, target] of Object.entries(POLICY_KEY_ALIASES)) {
    m.set(target, [...(m.get(target) ?? []), legacy]);
  }
  return m;
})();

function aliasesFor(canonical: string): string[] {
  return ALIASES_BY_CANONICAL.get(canonical) ?? [];
}

function leafPaths(obj: unknown, prefix = "", out: string[] = []): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    if (prefix !== "") out.push(prefix);
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    leafPaths(v, prefix === "" ? k : `${prefix}.${k}`, out);
  }
  return out;
}

/**
 * Resolve one scope's policy file pair through `GuildStorage` — the only
 * constructor of a durable path (KTD15). The require is LAZY on purpose: a
 * top-level state import closes an init cycle (state -> migrations -> lifecycle
 * -> config) that throws on load, and nothing here needs the path before the
 * first resolve.
 *
 * `.local.json` is derived from the scope's config name rather than joined, so
 * the two files can never drift apart when the split moves.
 */
export function policyFilesFor(root: string, scope: "project" | "workspace"): { config: string; local: string } | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createGuildStorage } = require("../../state") as {
    createGuildStorage: (cwd: string, opts?: { profile?: string }) => {
      project?: { config(): string };
      workspace?: { config(): string };
    };
  };
  // The SCOPE is the caller's assertion about which file it means, so it picks the
  // storage profile rather than depending on root auto-detection: `--scope workspace`
  // on a root whose profile probe says "standalone" must still name the workspace
  // policy file, not silently fall through to the project one.
  const storage = createGuildStorage(root, {
    profile: scope === "workspace" ? "workspace-only" : "standalone",
  });
  const scoped = scope === "workspace" ? storage.workspace : storage.project;
  if (!scoped) return null;
  const config = scoped.config();
  return { config, local: config.replace(/\.json$/, ".local.json") };
}

/**
 * The machine-local overlay path on the platform STATE root (KTD15). Not in git:
 * it is one operator's "on this machine prefer X", and it is still policy, so the
 * same closed key set and the same identity guard apply to it.
 */
export function policyOverlayFile(cwd: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createGuildStorage } = require("../../state") as {
      createGuildStorage: (c: string) => { runtime(...segments: string[]): string };
    };
    return createGuildStorage(cwd).runtime(POLICY_OVERLAY_FILE);
  } catch {
    // No resolvable root — there is no overlay to read, which is not an error.
    return null;
  }
}

/**
 * Resolve the closed policy key set for `cwd`.
 *
 * Throws `PolicyRejectedError` when any layer carries host identity or an unknown
 * key. The caller prints `err.message` — it already names the key and the file.
 */
export function resolvePolicy(opts: ResolvePolicyOptions): ResolvedPolicy {
  const knownHostIds = opts.knownHostIds ?? [];
  const policy = policyDefaults();
  const sources: Record<string, PolicySource> = {};
  for (const spec of POLICY_KEYS) sources[spec.key] = "builtin";
  const files: Array<{ layer: PolicySource; file: string }> = [];
  const legacyAliases: LegacyAliasRecord[] = [];

  const layers: Array<{ layer: PolicySource; file: string }> = [];
  if (opts.workspaceRoot) {
    const ws = policyFilesFor(opts.workspaceRoot, "workspace");
    if (ws) {
      layers.push({ layer: "workspace", file: ws.config });
      layers.push({ layer: "workspace-local", file: ws.local });
    }
  }
  const project = policyFilesFor(opts.cwd, "project");
  if (project) {
    layers.push({ layer: "project", file: project.config });
    layers.push({ layer: "project-local", file: project.local });
  }
  // `undefined` means "the machine's own overlay", not "no overlay": the first cut
  // only looked when a caller passed a path, so `config show --sources` never read
  // it and an overlay carrying `opus` was invisible (codex G-lane r2 P1-3).
  const overlay = opts.overlayFile === undefined ? policyOverlayFile(opts.cwd) : opts.overlayFile;
  if (overlay) layers.push({ layer: "overlay", file: overlay });

  for (const { layer, file } of layers) {
    const sparse = readLayer(file, layer, knownHostIds);
    if (sparse === null) continue;
    files.push({ layer, file });
    legacyAliases.push(...sparse.aliases);
    for (const [key, value] of sparse.values) {
      setByPath(policy, key, value);
      sources[key] = layer;
    }
  }

  for (const [key, value] of Object.entries(opts.rigor ?? {})) {
    const spec = policyKeySpec(key);
    if (!spec) continue;
    setByPath(policy, spec.key, value);
    sources[spec.key] = "rigor";
  }

  for (const [key, value] of Object.entries(opts.flags ?? {})) {
    if (value === undefined) continue;
    const canonical = canonicalPolicyKey(key);
    const spec = policyKeySpec(canonical);
    if (!spec) continue;
    const err = validatePolicyValue(spec, value);
    if (err) throw new PolicyRejectedError("not-policy", canonical, `policy config (cli): ${err}`);
    setByPath(policy, spec.key, value);
    sources[spec.key] = "cli";
  }

  return { policy, sources, files, legacyAliases };
}

/** Read one resolved policy key by its dotted name. */
export function policyValue(resolved: ResolvedPolicy, dotted: string): unknown {
  return getByPath(resolved.policy, canonicalPolicyKey(dotted));
}

/**
 * Write ONE key into the machine-local overlay, through the same gate the durable
 * files get. The overlay is "on this machine prefer X" and is operator-only; it
 * is not in git, but it is still policy — a model name here would pin the machine
 * exactly as a committed one pins the repo (KTD22).
 *
 * `overlayFile` is absolute and caller-supplied (the platform state root, via
 * `GuildStorage`), so this module stays free of domain imports and of the init
 * cycle they close.
 */
export function writePolicyOverlay(
  overlayFile: string,
  key: string,
  value: unknown,
  knownHostIds: readonly string[] = [],
): void {
  const canonical = assertPolicyWrite(key, value, { where: "policy overlay", knownHostIds });
  let existing: Record<string, unknown> = {};
  const parsed = readJsonFile(overlayFile);
  if (parsed !== null) existing = parsed;
  setByPath(existing, canonical, value);
  fs.mkdirSync(path.dirname(overlayFile), { recursive: true });
  const tmp = `${overlayFile}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, overlayFile);
}
