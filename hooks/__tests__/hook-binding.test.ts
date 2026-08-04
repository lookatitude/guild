/**
 * hooks/__tests__/hook-binding.test.ts
 *
 * T3b — negative controls for the single hook write-authorization guard
 * (hooks/lib/hook-binding.ts authorizeHookWrite), pinning session_context §5:
 * writers fail CLOSED on absent / not-minted / malformed / closed / mismatched
 * bindings, the GUILD_RUN_BINDING_REF env envelope only authorizes the exact
 * run it names, a malformed envelope never authorizes anything, and no
 * sentinel value ever participates (SC-1: a moved sentinel cannot redirect).
 *
 * These are the hook-leg counterparts of the core verifier tests
 * (src/modules/lifecycle run-binding); the writer-level effects are pinned in
 * run-trace.test.ts / capture-telemetry.test.ts — this suite pins the GUARD.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  authorizeHookWrite,
  formatBindingRejected,
  locateCandidateRunId,
} from "../lib/hook-binding";
import { mintTestBinding } from "../test-support/mint-binding";

const RUN = "run-hb-test";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-hook-binding-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Env seam: every call passes an explicit env so the runner's own lane env can never leak in. */
const noEnv: Record<string, string | undefined> = {};

describe("authorizeHookWrite — positive paths", () => {
  it("authorizes an explicitly-addressed run when the caller presents the exact nonce", () => {
    const ref = mintTestBinding(root, RUN);
    const auth = authorizeHookWrite(root, { runId: RUN, bindingRef: ref, env: noEnv });
    expect(auth).toEqual({ ok: true, run_id: RUN, binding_ref: ref });
  });

  it("authorizes via the GUILD_RUN_ID + GUILD_RUN_BINDING_REF env envelope", () => {
    const ref = mintTestBinding(root, RUN);
    const auth = authorizeHookWrite(root, {
      env: { GUILD_RUN_ID: RUN, GUILD_RUN_BINDING_REF: ref },
    });
    expect(auth).toEqual({ ok: true, run_id: RUN, binding_ref: ref });
  });

  it("prefers an explicit caller-held nonce over the env envelope", () => {
    const ref = mintTestBinding(root, RUN);
    const auth = authorizeHookWrite(root, {
      runId: RUN,
      bindingRef: ref,
      env: { GUILD_RUN_ID: RUN, GUILD_RUN_BINDING_REF: "rb-wrong-envelope" },
    });
    expect(auth).toEqual({ ok: true, run_id: RUN, binding_ref: ref });
  });
});

describe("authorizeHookWrite — fail-closed negative controls (§5)", () => {
  it("binding_absent: no runId anywhere refuses with a structured diagnostic", () => {
    const auth = authorizeHookWrite(root, { env: noEnv });
    expect(auth).toEqual({
      ok: false,
      diagnostic: "binding_rejected",
      reason: "binding_absent",
      run_id: null,
    });
  });

  it("REWORK F1: a run id alone NEVER authorizes — a loadable OPEN record is not recovered", () => {
    // The exact escape the G-lane review probed: a valid open binding record
    // exists and is readable, the caller presents GUILD_RUN_ID (here: an
    // explicit runId) but NO nonce. The guard must refuse — it may not read
    // binding.json to recover the nonce for authorization.
    mintTestBinding(root, RUN);
    const auth = authorizeHookWrite(root, { runId: RUN, env: noEnv });
    expect(auth).toEqual({
      ok: false,
      diagnostic: "binding_rejected",
      reason: "binding_absent",
      run_id: RUN,
    });
  });

  it("REWORK F1: env GUILD_RUN_ID alone (open record on disk, no ref env) refuses", () => {
    mintTestBinding(root, RUN);
    const auth = authorizeHookWrite(root, { env: { GUILD_RUN_ID: RUN } });
    expect(auth).toMatchObject({ ok: false, reason: "binding_absent", run_id: RUN });
  });

  it("REWORK F1: a whitespace-only GUILD_RUN_BINDING_REF (open record on disk) refuses", () => {
    mintTestBinding(root, RUN);
    const auth = authorizeHookWrite(root, {
      env: { GUILD_RUN_ID: RUN, GUILD_RUN_BINDING_REF: "   " },
    });
    expect(auth).toMatchObject({ ok: false, reason: "binding_absent", run_id: RUN });
  });

  it("binding_not_minted: a presented pair for a run with no record refuses", () => {
    fs.mkdirSync(path.join(root, ".guild", "runs", RUN), { recursive: true });
    const auth = authorizeHookWrite(root, { runId: RUN, bindingRef: "rb-some-nonce", env: noEnv });
    expect(auth).toMatchObject({ ok: false, reason: "binding_not_minted", run_id: RUN });
  });

  it("binding_malformed: a schema-invalid record refuses (closed, never repaired)", () => {
    mintTestBinding(root, RUN, { malformed: true });
    const auth = authorizeHookWrite(root, { runId: RUN, bindingRef: "rb-any", env: noEnv });
    expect(auth).toMatchObject({ ok: false, reason: "binding_malformed", run_id: RUN });
  });

  it("unparseable JSON in the record is malformed, not absent", () => {
    const p = path.join(root, ".guild", "runs", RUN, "binding.json");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "{not json", "utf8");
    const auth = authorizeHookWrite(root, { runId: RUN, bindingRef: "rb-any", env: noEnv });
    expect(auth).toMatchObject({ ok: false, reason: "binding_malformed" });
  });

  it("binding_closed: a closed (revoked) binding refuses even with the exact nonce", () => {
    const ref = mintTestBinding(root, RUN, { state: "closed" });
    const auth = authorizeHookWrite(root, { runId: RUN, bindingRef: ref, env: noEnv });
    expect(auth).toMatchObject({ ok: false, reason: "binding_closed", run_id: RUN });
  });

  it("binding_mismatch: another run's nonce refuses", () => {
    mintTestBinding(root, RUN);
    const otherRef = mintTestBinding(root, "run-hb-other", { ref: "rb-other-nonce" });
    const auth = authorizeHookWrite(root, { runId: RUN, bindingRef: otherRef, env: noEnv });
    expect(auth).toMatchObject({ ok: false, reason: "binding_mismatch", run_id: RUN });
  });
});

describe("authorizeHookWrite — envelope negative controls", () => {
  it("a malformed envelope (empty binding_ref) never authorizes — no record recovery (F1)", () => {
    // Envelope with run_id but empty ref parses as NO envelope (fail closed
    // at parse). Rework F1: even with a loadable OPEN record for the run,
    // the guard refuses binding_absent — it never falls back to the record.
    mintTestBinding(root, RUN);
    const auth = authorizeHookWrite(root, {
      env: { GUILD_RUN_ID: RUN, GUILD_RUN_BINDING_REF: "   " },
    });
    expect(auth).toMatchObject({ ok: false, reason: "binding_absent", run_id: RUN });
  });

  it("an envelope for a DIFFERENT run never authorizes the addressed run", () => {
    mintTestBinding(root, "run-hb-other", { ref: "rb-other-nonce" });
    // Rework F1: RUN also has its own OPEN record — the guard must still
    // refuse binding_absent (no cross-run nonce leak, no record recovery).
    mintTestBinding(root, RUN);
    const auth = authorizeHookWrite(root, {
      runId: RUN,
      env: { GUILD_RUN_ID: "run-hb-other", GUILD_RUN_BINDING_REF: "rb-other-nonce" },
    });
    expect(auth).toMatchObject({ ok: false, reason: "binding_absent", run_id: RUN });
  });

  it("an envelope carrying a WRONG nonce for its own run refuses with mismatch", () => {
    mintTestBinding(root, RUN, { ref: "rb-real-nonce" });
    const auth = authorizeHookWrite(root, {
      env: { GUILD_RUN_ID: RUN, GUILD_RUN_BINDING_REF: "rb-forged-nonce" },
    });
    expect(auth).toMatchObject({ ok: false, reason: "binding_mismatch", run_id: RUN });
  });
});

describe("sentinel demotion (SC-1) — the guard never reads a sentinel", () => {
  function writeSentinel(location: "legacy" | "b2", runId: string): void {
    const p =
      location === "legacy"
        ? path.join(root, ".guild", "runs", "current-run-id")
        : path.join(root, ".guild", "current-run-id");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${runId}\n`, "utf8");
  }

  it("a sentinel pointing at a validly-bound run still cannot authorize a write", () => {
    mintTestBinding(root, RUN);
    writeSentinel("legacy", RUN);
    writeSentinel("b2", RUN);
    const auth = authorizeHookWrite(root, { env: noEnv });
    expect(auth).toMatchObject({ ok: false, reason: "binding_absent" });
  });

  it("moving the sentinel between two authorizations cannot redirect an explicitly-bound writer", () => {
    const ref = mintTestBinding(root, RUN);
    mintTestBinding(root, "run-hb-hijack");
    writeSentinel("legacy", RUN);
    const first = authorizeHookWrite(root, { env: { GUILD_RUN_ID: RUN, GUILD_RUN_BINDING_REF: ref } });
    writeSentinel("legacy", "run-hb-hijack");
    const second = authorizeHookWrite(root, { env: { GUILD_RUN_ID: RUN, GUILD_RUN_BINDING_REF: ref } });
    expect(first).toEqual({ ok: true, run_id: RUN, binding_ref: ref });
    expect(second).toEqual(first);
  });

  it("locateCandidateRunId surfaces the sentinel as intake-only (typed marker)", () => {
    writeSentinel("b2", RUN);
    const candidate = locateCandidateRunId(root);
    expect(candidate).toEqual({ run_id: RUN, source: "sentinel-b2", intake_only: true });
  });
});

describe("formatBindingRejected", () => {
  it("emits one structured line for a refusal and nothing for an ok verdict", () => {
    const ref = mintTestBinding(root, RUN);
    const ok = authorizeHookWrite(root, { runId: RUN, bindingRef: ref, env: noEnv });
    expect(formatBindingRejected("test-hook", ok)).toBe("");

    const refused = authorizeHookWrite(root, { env: noEnv });
    const line = formatBindingRejected("test-hook", refused);
    expect(line).toContain("[test-hook]");
    expect(line).toContain("binding_rejected (binding_absent)");
    expect(line).toContain("no write performed");
  });
});
