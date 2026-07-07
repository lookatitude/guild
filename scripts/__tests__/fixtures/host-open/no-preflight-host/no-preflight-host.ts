/**
 * FIXTURE (NOT a real adapter) — a deliberately-broken "generated host adapter"
 * that OMITS the host-open session-open preflight surface (the mandatory
 * HostAdapter member the coverage gate scans for).
 *
 * Consumed ONLY by host-open-preflight-coverage.test.ts as the anti-vacuity probe:
 * the coverage gate that scans the real generated adapters for their session-open
 * preflight wiring MUST flag this file as missing it. If this fixture ever silently
 * "passes" the coverage scan, the gate is vacuous.
 *
 * It intentionally implements the OTHER adapter operations (bootstrap/dispatch/…)
 * so the only thing wrong with it is the missing preflight — proving the scan keys
 * on the preflight surface specifically, not merely on "looks like an adapter".
 *
 * Lives under __tests__/fixtures/ so jest's testPathIgnorePatterns skips it as a
 * test, and so it is never wired into host-adapter-factory.ts.
 */

const HOST_ID = "no-preflight-host";

// NOTE: the session-open preflight method is deliberately ABSENT from this object.
export function createNoPreflightHostAdapter() {
  return {
    host: HOST_ID,
    hostId: HOST_ID,
    capabilities() {
      return { host: HOST_ID, known: false };
    },
    bootstrap() {
      return { host: HOST_ID, operation: "bootstrap", status: "degraded" };
    },
    dispatch() {
      return { host: HOST_ID, operation: "dispatch", status: "ok" };
    },
    collect() {
      return { host: HOST_ID, operation: "collect", status: "ok" };
    },
  };
}
