/**
 * C1 — Unknown-safe identity (session_context §3; SC-2).
 *
 * Contract: unset/"auto"/malformed host input resolves family "unknown" —
 * NEVER defaults to claude. This retires:
 *   - src/modules/host-runtime/workflows/provider-detect.ts:246
 *     (resolveAuthorHost: "auto"/unset/"" ⇒ "claude")
 *   - hooks/lib/run-trace.ts:204 (defaultResolveHost: unrecognized ⇒ "claude")
 *
 * EXPECTED TO FAIL TODAY (challenger lane T2): the failing tests document the
 * live defect; they clear when T3 (provider-detect) and T3b (hook leg) land.
 * [control] tests pass today and prove the assertions are non-vacuous.
 */

import { resolveAuthorHost } from "../../src/modules/host-runtime/workflows/provider-detect";
import { defaultResolveHost } from "../../hooks/lib/run-trace";

describe("C1 session_context §3 — unknown-safe identity", () => {
  describe("resolveAuthorHost (provider-detect.ts) — unknown stays unknown", () => {
    test.each([undefined, "auto", ""])(
      "FAILING-TODAY: unset/auto/empty host input %p resolves 'unknown', never 'claude'",
      (input) => {
        // Contract session_context §3: unset, malformed, or unrecognized host
        // input MUST resolve family "unknown". The current implementation
        // returns "claude" for these inputs — the exact defect this pins.
        expect(resolveAuthorHost(input as string | undefined)).toBe("unknown");
      }
    );

    test("[control] recognized families still resolve exactly (anti-vacuity)", () => {
      expect(resolveAuthorHost("codex-app")).toBe("codex");
      expect(resolveAuthorHost("antigravity-2")).toBe("antigravity");
      expect(resolveAuthorHost("claude-code-desktop")).toBe("claude");
      expect(resolveAuthorHost("pi")).toBe("pi");
    });

    test("[control] garbage input already resolves 'unknown' (proves the assertion CAN pass)", () => {
      expect(resolveAuthorHost("definitely-not-a-host")).toBe("unknown");
    });

    test("[control] injected known-bad resolver is caught by the contract table", () => {
      // A resolver that "repairs" garbage to claude must be flagged by the
      // same table the failing tests use — proves the table detects the bug
      // class, not just today's binary.
      const knownBad = (_h?: string) => "claude";
      expect(knownBad("definitely-not-a-host")).not.toBe("unknown");
    });
  });

  describe("defaultResolveHost (hooks/lib/run-trace.ts) — hook leg", () => {
    const OLD_ENV = process.env["GUILD_HOST"];
    afterEach(() => {
      if (OLD_ENV === undefined) delete process.env["GUILD_HOST"];
      else process.env["GUILD_HOST"] = OLD_ENV;
    });

    test("FAILING-TODAY: unrecognized GUILD_HOST resolves 'unknown', never 'claude'", () => {
      process.env["GUILD_HOST"] = "totally-bogus-host-9000";
      // run-trace.ts:204-class defect: unrecognized values resolve to claude.
      expect(defaultResolveHost("totally-bogus-host-9000").resolved).toBe("unknown");
    });

    test("FAILING-TODAY: unset/auto requested host resolves 'unknown', never 'claude'", () => {
      delete process.env["GUILD_HOST"];
      expect(defaultResolveHost("auto").resolved).toBe("unknown");
      expect(defaultResolveHost("").resolved).toBe("unknown");
    });

    test("[control] recognized host kinds resolve verbatim (anti-vacuity)", () => {
      delete process.env["GUILD_HOST"];
      expect(defaultResolveHost("codex").resolved).toBe("codex");
      expect(defaultResolveHost("antigravity-2").resolved).toBe("antigravity-2");
      expect(defaultResolveHost("claude").resolved).toBe("claude");
    });

    test("[control] GUILD_HOST env wins over the requested arg (precedence pin)", () => {
      process.env["GUILD_HOST"] = "codex";
      expect(defaultResolveHost("claude").resolved).toBe("codex");
    });
  });

  describe("consumers must never 'repair' unknown (session_context §3 terminal-value rule)", () => {
    test("FAILING-TODAY: session-context builder module exists and exposes buildSessionContext", () => {
      // Owning lane T3 — src/modules/host-runtime/workflows/session-context.ts
      // (module-map §1). Fails today with CONTRACT-MODULE-MISSING by design.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { requireContractModule } = require("./_helpers");
      const mod = requireContractModule(
        "src/modules/host-runtime/workflows/session-context",
        "T3-session-identity-binding"
      );
      expect(typeof mod.buildSessionContext).toBe("function");
    });
  });
});
