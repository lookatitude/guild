/**
 * C2 — Explicit run binding; writers fail closed; sentinel intake-only
 * (session_context §5; SC-1).
 *
 * Contract: every runtime write carries run_id + binding_ref; writes fail
 * closed when the binding is absent/closed/mismatched. The workspace-global
 * sentinels (.guild/runs/current-run-id legacy AND .guild/current-run-id B2 —
 * hooks/lib/run-trace.ts:140-157) are demoted to interactive command intake
 * only: a sentinel MUST NOT authorize a runtime write, and moving the sentinel
 * mid-run cannot redirect an in-flight write.
 *
 * EXPECTED TO FAIL TODAY: resolveRunIdForTrace authorizes trace writes from
 * the sentinel with no binding at all. Clears with T3 (run-binding core) +
 * T3b (hook leg). Deterministic: real fs in tmp dirs, no clocks, no network.
 */

import * as fs from "fs";
import * as path from "path";

import { resolveRunIdForTrace } from "../../hooks/lib/run-trace";
import { mkTmpWorkspace, requireContractModule } from "./_helpers";

function writeSentinel(root: string, location: "legacy" | "b2", runId: string): void {
  const p =
    location === "legacy"
      ? path.join(root, ".guild", "runs", "current-run-id")
      : path.join(root, ".guild", "current-run-id");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${runId}\n`, "utf8");
}

describe("C2 session_context §5 — run binding + sentinel demotion", () => {
  describe("sentinel is intake-only (never a write authorization)", () => {
    test("FAILING-TODAY: a trace WRITER with no explicit binding resolves null (fail closed), even when a sentinel exists", () => {
      const root = mkTmpWorkspace();
      writeSentinel(root, "legacy", "run-aaaa");
      // Contract: absent an explicit binding (env/envelope), the writer-side
      // resolver must refuse — the sentinel may only locate a CANDIDATE run
      // for interactive command intake. Today it returns "run-aaaa" and the
      // hook leg writes under it: the exact demotion defect.
      expect(resolveRunIdForTrace(root, {})).toBeNull();
    });

    test("FAILING-TODAY: moving the sentinel mid-run cannot redirect an in-flight writer (SC-1 concurrency)", () => {
      const root = mkTmpWorkspace();
      writeSentinel(root, "legacy", "run-aaaa");
      // Writer resolves its run identity at write 1...
      const firstWrite = resolveRunIdForTrace(root, {});
      // ...another actor moves the sentinel between the writer's two writes
      // (deterministic simulation of the concurrent-runs race)...
      writeSentinel(root, "legacy", "run-bbbb");
      const secondWrite = resolveRunIdForTrace(root, {});
      // Contract: an in-flight run's writes are bound to ITS binding — the two
      // resolutions may never diverge onto different runs. (Under the fixed
      // implementation both are null here — no binding, no write; the
      // stability assertion still holds.)
      expect(secondWrite).toBe(firstWrite);
    });

    test("FAILING-TODAY: the B2 sentinel location is equally demoted", () => {
      const root = mkTmpWorkspace();
      writeSentinel(root, "b2", "run-cccc");
      expect(resolveRunIdForTrace(root, {})).toBeNull();
    });

    test("[control] the full two-field envelope's run identity wins and is move-stable (anti-vacuity)", () => {
      // T3b rework F1 correction: the frozen contract's binding is the PAIR
      // GUILD_RUN_ID + GUILD_RUN_BINDING_REF — GUILD_RUN_ID alone is only a
      // run-IDENTITY input, never a write authorization. resolveRunIdForTrace
      // resolves identity only; write AUTHORIZATION is separately pinned by
      // hooks/__tests__/hook-binding.test.ts + dist-binding-probes.test.ts
      // (a run id alone, even with a loadable open record, refuses).
      const root = mkTmpWorkspace();
      writeSentinel(root, "legacy", "run-aaaa");
      const bound = { GUILD_RUN_ID: "run-explicit", GUILD_RUN_BINDING_REF: "rb-explicit" };
      expect(resolveRunIdForTrace(root, bound)).toBe("run-explicit");
      writeSentinel(root, "legacy", "run-bbbb");
      expect(resolveRunIdForTrace(root, bound)).toBe("run-explicit");
    });

    test("[control] no sentinel + no binding already resolves null (proves the null assertion CAN pass)", () => {
      const root = mkTmpWorkspace();
      expect(resolveRunIdForTrace(root, {})).toBeNull();
    });
  });

  describe("run-binding core (T3 — mint/verify/fail-closed writers)", () => {
    const BINDING_MODULE = "src/modules/lifecycle/workflows/run-binding";

    test("FAILING-TODAY: run-binding module exists with mint/verify surface", () => {
      const mod = requireContractModule(BINDING_MODULE, "T3-session-identity-binding");
      expect(typeof mod.mintRunBinding).toBe("function");
      expect(typeof mod.verifyRunBinding).toBe("function");
    });

    test("FAILING-TODAY: missing binding is rejected with a structured binding_rejected diagnostic", () => {
      const mod: any = requireContractModule(BINDING_MODULE, "T3-session-identity-binding");
      const verdict = mod.verifyRunBinding({ run_id: "run-x", binding_ref: undefined });
      expect(verdict.ok).toBe(false);
      expect(verdict.diagnostic).toBe("binding_rejected");
    });

    test("FAILING-TODAY: a closed binding is rejected (writers fail closed after run close)", () => {
      const mod: any = requireContractModule(BINDING_MODULE, "T3-session-identity-binding");
      const root = mkTmpWorkspace();
      const binding = mod.mintRunBinding({ root, run_id: "run-x" });
      mod.closeRunBinding({ root, run_id: "run-x" });
      const verdict = mod.verifyRunBinding({ run_id: "run-x", binding_ref: binding.binding_ref, root });
      expect(verdict.ok).toBe(false);
      expect(verdict.diagnostic).toBe("binding_rejected");
    });

    test("FAILING-TODAY: a mismatched binding_ref (another run's nonce) is rejected", () => {
      const mod: any = requireContractModule(BINDING_MODULE, "T3-session-identity-binding");
      const root = mkTmpWorkspace();
      mod.mintRunBinding({ root, run_id: "run-x" });
      const other = mod.mintRunBinding({ root, run_id: "run-y" });
      const verdict = mod.verifyRunBinding({ run_id: "run-x", binding_ref: other.binding_ref, root });
      expect(verdict.ok).toBe(false);
      expect(verdict.diagnostic).toBe("binding_rejected");
    });

    test("[control] reference fail-closed verifier distinguishes good/bad bindings (anti-vacuity)", () => {
      // Minimal reference semantics the runtime must satisfy — proves the
      // acceptance shape used above can both pass and fail.
      const minted = new Map<string, { ref: string; state: "open" | "closed" }>();
      const mint = (runId: string, ref: string) => minted.set(runId, { ref, state: "open" });
      const verify = (runId: string, ref: string | undefined) => {
        const b = minted.get(runId);
        const ok = !!b && b.state === "open" && !!ref && ref === b.ref;
        return ok ? { ok: true as const } : { ok: false as const, diagnostic: "binding_rejected" };
      };
      mint("run-x", "nonce-1");
      expect(verify("run-x", "nonce-1").ok).toBe(true);
      expect(verify("run-x", undefined)).toEqual({ ok: false, diagnostic: "binding_rejected" });
      expect(verify("run-x", "nonce-other")).toEqual({ ok: false, diagnostic: "binding_rejected" });
      minted.get("run-x")!.state = "closed";
      expect(verify("run-x", "nonce-1").ok).toBe(false);
    });
  });
});
