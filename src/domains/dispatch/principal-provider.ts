/**
 * src/domains/dispatch/principal-provider.ts
 *
 * Worker principal providers for the E00 TaskCell controller (CD16/CD19/CD20).
 *
 * One shipped implementation, `cooperative_local`: trusted same-operator local
 * workers sharing the operator UID. It makes no malicious-same-UID secrecy or
 * authenticity claim. `isolated_worker` (dual-UID confinement, R03/AT12) is not
 * implemented in E00: selecting it refuses with worker_principal_unavailable
 * before any TaskCell record is written. Selection is by the run's requested
 * policy only — there is no flag, env var or path rule for another provider.
 */

export const WORKER_TRUST_POLICIES = Object.freeze(["cooperative_local", "isolated_worker"] as const);
export type WorkerTrustPolicy = (typeof WORKER_TRUST_POLICIES)[number];

export function isWorkerTrustPolicy(value: unknown): value is WorkerTrustPolicy {
  return typeof value === "string" && (WORKER_TRUST_POLICIES as readonly string[]).includes(value);
}

export interface PrincipalProvider {
  readonly id: "cooperative_local";
  readonly worker_trust_policy: WorkerTrustPolicy;
  /** The status `principal.mode` this provider reports (CD7). */
  readonly mode: "cooperative_same_uid";
  /** Operator uid; under cooperative_local the worker shares it. */
  operatorUid(): number;
  workerUid(): number;
  /** True when a consumer requiring `required` may consume this run's work. */
  satisfies(required: WorkerTrustPolicy): boolean;
}

export const COOPERATIVE_LOCAL_PROVIDER: PrincipalProvider = Object.freeze({
  id: "cooperative_local" as const,
  worker_trust_policy: "cooperative_local" as const,
  mode: "cooperative_same_uid" as const,
  operatorUid: () => (typeof process.getuid === "function" ? process.getuid() : -1),
  workerUid: () => (typeof process.getuid === "function" ? process.getuid() : -1),
  // cooperative_local never satisfies isolated_worker; nothing upgrades it.
  satisfies: (required: WorkerTrustPolicy) => required === "cooperative_local",
});

export type PrincipalSelection =
  | { ok: true; provider: PrincipalProvider }
  | { ok: false; reason: "worker_principal_unavailable" | "worker_trust_policy_invalid" };

/** The one composition-root selector: by the run's requested policy, nothing else. */
export function selectPrincipalProvider(requested: unknown): PrincipalSelection {
  if (requested === "cooperative_local") return { ok: true, provider: COOPERATIVE_LOCAL_PROVIDER };
  if (requested === "isolated_worker") return { ok: false, reason: "worker_principal_unavailable" };
  return { ok: false, reason: "worker_trust_policy_invalid" };
}
