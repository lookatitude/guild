/**
 * scripts/lib/isolation-capability-set.ts
 *
 * W2-A1 (isolation-default asymmetry) reader — deferred v2.x feature item 35.
 *
 * Context (ledger §8 W2-A1, COMPLETENESS-LEDGER.md §7):
 *   The isolation gap fires only when a host advertises `capability_set.isolation`.
 *   In v2.0, no host emits that field — both the writer (which defaults to
 *   `isolation:worktree`) and the router (which treats absent-isolation as
 *   unconstrained) are consistent on the axes they enforce today. This module
 *   is the reader-half of that deferred surface: it extracts `isolation` from a
 *   host's `capability_set` block, returning `"none"` (unconstrained) when the
 *   field is absent. Wire it from the router's `capabilityGap()` when hosts
 *   begin advertising the field.
 *
 * **Wiring status:** DORMANT. No production call-site in v2.0. Safe to import
 * at any time — defaults preserve current behavior unchanged (absent field ⇒
 * "none" ⇒ no rejection). The enabling condition is a host manifest emitting
 * `capability_set: { isolation: "worktree" | "sandbox" | "cloud_container" }`.
 *
 * **Determinism contract:** all exported functions are pure and synchronous.
 * No Date.now(), Math.random(), or I/O. The caller supplies any external
 * inputs. A `if (require.main === module)` harness at the bottom may use
 * Date.now() for ad-hoc inspection.
 *
 * **Lenient-reader contract (shared invariant §12 / lenient-reader rule):**
 *   - Unknown keys inside `capability_set` are silently ignored.
 *   - An entirely absent `capability_set` block returns the "none" default.
 *   - An `isolation` value that is not in the closed enum is treated as
 *     invalid and the validator reports it; the reader falls back to `"none"`.
 *
 * Owned by tooling-engineer. Contract pointer: ledger §8 W2-A1 +
 * docs/knowledge/decisions/host-adapter-contract.md Decision 2
 * (`host_capabilities.v1` schema) + scripts/lib/host-router.ts
 * `HostCapabilitySet` (the source-of-truth type this module reads from).
 */

// ── Isolation mode enum ───────────────────────────────────────────────────────

/**
 * Closed set of isolation modes a host can advertise.
 *
 * - `"worktree"` — host isolates each lane in a dedicated git worktree.
 * - `"sandbox"` — host isolates via an OS sandbox (e.g. container with network
 *   off, read-only mounts). Stronger than worktree; forward value (no host
 *   advertises this yet in v2.0).
 * - `"cloud_container"` — host dispatches into an ephemeral cloud container.
 *   Forward value (no host advertises this yet in v2.0).
 * - `"none"` — host imposes no lane isolation (the lenient default).
 *
 * The `"none"` value is the safe fallback when `capability_set.isolation` is
 * absent. It is NOT an advertised mode — a host that wants to express
 * "no isolation" may omit the field rather than set it to `"none"`.
 */
export const ISOLATION_MODES = [
  "worktree",
  "sandbox",
  "cloud_container",
  "none",
] as const;

export type IsolationMode = (typeof ISOLATION_MODES)[number];

// ── Input shape ───────────────────────────────────────────────────────────────

/**
 * The minimal slice of `RoutableHost.capability_set` this module cares about.
 * Defined here so callers do not import all of `host-router.ts`; the shape is
 * a strict subset of `HostCapabilitySet` (and is forward-compatible: extra
 * keys are ignored per the lenient-reader contract).
 *
 * The `isolation` field is the W2-A1 deferred surface. All other
 * `HostCapabilitySet` keys (`needs_pr`, `needs_parallel`, `needs_network`) are
 * out of scope for this module — each has its own enforcement path in the router.
 */
export interface CapabilitySetWithIsolation {
  /** Advertised isolation mode. Absent ⇒ caller receives "none". */
  isolation?: string; // intentionally `string` — validated by the reader
  /** Forward-compatible: ignore any other keys. */
  [key: string]: unknown;
}

// ── Reader ────────────────────────────────────────────────────────────────────

/**
 * Read the isolation capability from a host's `capability_set` block.
 *
 * Lenient contract:
 *   - `hostCapabilitySet` is `undefined` (no field advertised) ⇒ returns `"none"`.
 *   - `hostCapabilitySet.isolation` is absent ⇒ returns `"none"`.
 *   - `hostCapabilitySet.isolation` is a recognized `IsolationMode` ⇒ returns it.
 *   - `hostCapabilitySet.isolation` is a non-empty string NOT in the enum ⇒
 *     returns `"none"` (forward-compatible: future modes are treated as absent
 *     by older readers rather than rejected).
 *   - `hostCapabilitySet.isolation` is not a string ⇒ returns `"none"`.
 *
 * This function is PURE. No I/O, no Date.now(), no Math.random().
 *
 * @param hostCapabilitySet - The host's `capability_set` block, or `undefined`
 *   if the host manifest does not advertise a capability set.
 * @returns The resolved `IsolationMode`. Always a member of `ISOLATION_MODES`.
 *
 * @example
 *   // Host advertises worktree isolation:
 *   readIsolationCapability({ isolation: "worktree" }) // → "worktree"
 *
 *   // Host has no capability_set:
 *   readIsolationCapability(undefined) // → "none"
 *
 *   // Host has a capability_set but no isolation field:
 *   readIsolationCapability({ needs_pr: true }) // → "none"
 */
export function readIsolationCapability(
  hostCapabilitySet: CapabilitySetWithIsolation | undefined,
): IsolationMode {
  if (hostCapabilitySet === undefined || hostCapabilitySet === null) {
    return "none";
  }
  const raw = hostCapabilitySet["isolation"];
  if (typeof raw !== "string" || raw === "") {
    return "none";
  }
  const ISOLATION_MODE_SET = new Set<string>(ISOLATION_MODES);
  if (ISOLATION_MODE_SET.has(raw)) {
    return raw as IsolationMode;
  }
  // Unknown/forward value — fall back to "none" (lenient-reader).
  return "none";
}

// ── Validator ─────────────────────────────────────────────────────────────────

/**
 * Validate the `isolation` field inside a `capability_set` block.
 *
 * Returns `{ valid: true }` when the block is absent (lenient default) or
 * carries a recognized `IsolationMode`. Returns `{ valid: false, errors }` when
 * `isolation` is present but not a recognized mode.
 *
 * This validator is intentionally narrower than `readIsolationCapability`: the
 * reader silently falls back; the validator surfaces the unknown value as an
 * error so a manifest-authoring tool can warn the operator.
 *
 * @param hostCapabilitySet - The host's `capability_set` block, or `undefined`.
 */
export function validateIsolationCapability(
  hostCapabilitySet: CapabilitySetWithIsolation | undefined,
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (hostCapabilitySet === undefined || hostCapabilitySet === null) {
    return { valid: true };
  }

  const raw = hostCapabilitySet["isolation"];

  if (raw === undefined) {
    // Absent is valid — the host simply does not advertise isolation.
    return { valid: true };
  }

  if (typeof raw !== "string") {
    errors.push(
      `capability_set.isolation must be a string, got ${JSON.stringify(raw)}`,
    );
  } else {
    const ISOLATION_MODE_SET = new Set<string>(ISOLATION_MODES);
    if (!ISOLATION_MODE_SET.has(raw)) {
      errors.push(
        `capability_set.isolation "${raw}" is not a recognized IsolationMode; ` +
          `expected one of [${ISOLATION_MODES.join(", ")}]`,
      );
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ── isKnownIsolationMode convenience predicate ────────────────────────────────

/**
 * Type-predicate wrapper: returns `true` iff `value` is a member of
 * `ISOLATION_MODES`. Useful for narrowing `string` inputs without constructing
 * a full `CapabilitySetWithIsolation` object.
 */
export function isKnownIsolationMode(value: unknown): value is IsolationMode {
  return typeof value === "string" && (ISOLATION_MODES as readonly string[]).includes(value);
}
