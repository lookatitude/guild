/**
 * tests/universal-host/p1-sc8-adapter-ladder.test.ts
 *
 * P1 SC-8 — ADAPTER FALLBACK LADDER (C3): minimum-loss degradation + receipts.
 *
 * Each of the four adapter surfaces (interaction / session / semantic_tool / browser)
 * degrades through the explicit chain `native > wrapped > bridged > emulated >
 * degraded` per host, and `resolveRung()` records the chosen rung in a receipt.
 * Routing reads the TABLE, never the host name; an UNKNOWN host degrades + records
 * (never silently assumes a capability).
 *
 * REAL PATH (no seam): the SHIPPED `resolveRung()` / `validateDegradationReceipt()` /
 * `validateLadderTableComplete()` + the frozen `FALLBACK_LADDER_TABLE` are exercised
 * directly. The verbatim gated rungs are pinned cell-by-cell so a silent table edit
 * fails; the unknown-host fail path is the RED discriminator.
 *
 * Status at authoring: GREEN (P1-L0 shipped C3). L11 (tooling-engineer) builds the
 * runtime adapters against this table (asserted live when the adapters land).
 */

import {
  RUNGS,
  ADAPTER_SURFACES,
  rungLoss,
  FALLBACK_LADDER_TABLE,
  INFERRED_HOSTS,
  isHostInferred,
  resolveRung,
  validateDegradationReceipt,
  validateLadderTableComplete,
  type AdapterSurface,
  type Rung,
} from "../../scripts/lib/adapter-fallback-ladders";
import { HOST_IDS, type HostId } from "../../scripts/lib/host-registry-schema";

// ── Table completeness + verbatim rungs ─────────────────────────────────────

describe("P1 SC-8 — ladder table is complete (4 surfaces × 9 hosts)", () => {
  it("validateLadderTableComplete passes", () => {
    const r = validateLadderTableComplete();
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("every surface has a valid rung for every registry host id", () => {
    for (const surface of ADAPTER_SURFACES) {
      for (const host of HOST_IDS) {
        expect(RUNGS as readonly string[]).toContain(FALLBACK_LADDER_TABLE[surface][host]);
      }
    }
  });

  // Pin the ENTIRE gated C3 table verbatim — EVERY one of the 4×5 cells, not just
  // the "notable" ones, so a silent edit to ANY cell (e.g. session.codex,
  // semantic_tool.antigravity) fails (codex G-lane round-1 MINOR).
  it("pins the verbatim gated rung table — all 4×9 cells exactly", () => {
    // Oracle refreshed to the CURRENT production FALLBACK_LADDER_TABLE after the
    // host-adapter-migration renamed the roster to the canonical 9 host ids
    // (claude→claude-code-cli, codex→codex-cli, .agents→agents-file, pi→pi-cli,
    // antigravity→antigravity-cli) and added the four app/connector surfaces
    // (claude-code-app, claude-code-web, codex-app, claude-ai-connector), all of
    // which degrade across every surface. The RUNG VALUES for the original five
    // hosts are byte-identical to the pre-rename pin (pure key rename); the four
    // app/connector rows are the new canonical-roster additions (all "degraded").
    const EXPECTED: Record<AdapterSurface, Record<HostId, Rung>> = {
      interaction: {
        "claude-code-cli": "native", "codex-cli": "wrapped", "agents-file": "bridged",
        "pi-cli": "wrapped", "antigravity-cli": "wrapped",
        "claude-code-app": "degraded", "claude-code-web": "degraded",
        "codex-app": "degraded", "claude-ai-connector": "degraded",
      },
      session: {
        "claude-code-cli": "native", "codex-cli": "wrapped", "agents-file": "emulated",
        "pi-cli": "native", "antigravity-cli": "wrapped",
        "claude-code-app": "degraded", "claude-code-web": "degraded",
        "codex-app": "degraded", "claude-ai-connector": "degraded",
      },
      semantic_tool: {
        "claude-code-cli": "native", "codex-cli": "bridged", "agents-file": "bridged",
        "pi-cli": "bridged", "antigravity-cli": "bridged",
        "claude-code-app": "degraded", "claude-code-web": "degraded",
        "codex-app": "degraded", "claude-ai-connector": "degraded",
      },
      browser: {
        "claude-code-cli": "bridged", "codex-cli": "bridged", "agents-file": "degraded",
        "pi-cli": "degraded", "antigravity-cli": "native",
        "claude-code-app": "degraded", "claude-code-web": "degraded",
        "codex-app": "degraded", "claude-ai-connector": "degraded",
      },
    };
    // Exact whole-table equality — catches any single-cell drift in either direction.
    expect(FALLBACK_LADDER_TABLE).toEqual(EXPECTED);
    // And cell-by-cell so a failure names the offending (surface, host).
    for (const surface of ADAPTER_SURFACES) {
      for (const host of HOST_IDS) {
        expect(FALLBACK_LADDER_TABLE[surface][host]).toBe(EXPECTED[surface][host]);
      }
    }
  });

  // The notable non-defaults, called out explicitly for documentation/intent.
  it("encodes the notable non-defaults (Claude browser=bridged, antigravity browser=native)", () => {
    expect(FALLBACK_LADDER_TABLE.browser["claude-code-cli"]).toBe("bridged");
    expect(FALLBACK_LADDER_TABLE.browser["codex-cli"]).toBe("bridged");
    expect(FALLBACK_LADDER_TABLE.browser["antigravity-cli"]).toBe("native");
    expect(FALLBACK_LADDER_TABLE.browser["agents-file"]).toBe("degraded");
  });
});

// ── rung loss ordering ──────────────────────────────────────────────────────

describe("P1 SC-8 — rung loss ordering (minimum-loss rule)", () => {
  it("native is loss 0 and degraded is the max; the chain is strictly increasing", () => {
    expect(rungLoss("native")).toBe(0);
    expect(rungLoss("degraded")).toBe(RUNGS.length - 1);
    for (let i = 1; i < RUNGS.length; i++) {
      expect(rungLoss(RUNGS[i])).toBeGreaterThan(rungLoss(RUNGS[i - 1]));
    }
  });
});

// ── resolveRung receipts for known hosts ────────────────────────────────────

describe("P1 SC-8 — resolveRung produces correct receipts for known hosts", () => {
  it("returns the table rung + correct degraded/inferred flags for every (surface, host)", () => {
    for (const surface of ADAPTER_SURFACES) {
      for (const host of HOST_IDS) {
        const receipt = resolveRung(surface, host);
        const expectedRung = FALLBACK_LADDER_TABLE[surface][host];
        expect(receipt.schema_version).toBe("guild.degradation_receipt.v1");
        expect(receipt.rung).toBe(expectedRung);
        expect(receipt.degraded).toBe(rungLoss(expectedRung) > 0);
        expect(receipt.inferred).toBe(INFERRED_HOSTS.has(host));
        expect(validateDegradationReceipt(receipt).valid).toBe(true);
      }
    }
  });

  it("claude interaction is native ⇒ degraded:false; codex interaction is wrapped ⇒ degraded:true", () => {
    expect(resolveRung("interaction", "claude-code-cli").degraded).toBe(false);
    expect(resolveRung("interaction", "codex-cli").degraded).toBe(true);
  });

  it("INFERRED set is the agents-file/pi/antigravity + app/connector hosts; claude-code-cli/codex-cli are concrete", () => {
    // Canonical-roster INFERRED set: agents-file, pi-cli, antigravity-cli plus the
    // four app/connector surfaces. claude-code-cli + codex-cli are the only concrete
    // (live-verified) rows.
    expect([...INFERRED_HOSTS].sort()).toEqual([
      "agents-file",
      "antigravity-cli",
      "claude-ai-connector",
      "claude-code-app",
      "claude-code-web",
      "codex-app",
      "pi-cli",
    ]);
    expect(isHostInferred("claude-code-cli")).toBe(false);
    expect(isHostInferred("codex-cli")).toBe(false);
    expect(isHostInferred("agents-file")).toBe(true);
  });

  it("a degraded inferred cell carries the INFERRED note in its reason", () => {
    const r = resolveRung("browser", "agents-file"); // degraded + inferred
    expect(r.degraded).toBe(true);
    expect(r.inferred).toBe(true);
    expect(r.reason).toMatch(/INFERRED/);
  });
});

// ── unknown host degrades + records (RED discriminator) ─────────────────────

describe("P1 SC-8 — unknown host fails closed to degraded", () => {
  it("an unknown host resolves to degraded, NOT silently to some capable rung", () => {
    const r = resolveRung("interaction", "gemini");
    expect(r.rung).toBe("degraded");
    expect(r.degraded).toBe(true);
    expect(r.inferred).toBe(false); // not an inferred-known cell — genuinely unknown
    expect(r.host).toBe("gemini");
    expect(r.reason).toMatch(/unknown host/i);
    expect(validateDegradationReceipt(r).valid).toBe(true);
  });

  it("never returns 'native' for an unknown host on any surface", () => {
    for (const surface of ADAPTER_SURFACES) {
      expect(resolveRung(surface, "totally-made-up").rung).toBe("degraded");
    }
  });
});

// ── receipt validator fail-fixtures ─────────────────────────────────────────

describe("P1 SC-8 — degradation-receipt validator fail-closed", () => {
  const good = resolveRung("session", "codex-cli");

  it("rejects an invalid rung, a bad schema_version, and a non-boolean flag", () => {
    expect(validateDegradationReceipt({ ...good, rung: "supercharged" }).valid).toBe(false);
    expect(validateDegradationReceipt({ ...good, schema_version: "guild.degradation_receipt.v2" }).valid).toBe(false);
    expect(validateDegradationReceipt({ ...good, degraded: "yes" }).valid).toBe(false);
  });

  it("rejects an invalid surface and a non-object", () => {
    expect(validateDegradationReceipt({ ...good, surface: "telepathy" }).valid).toBe(false);
    expect(validateDegradationReceipt(null).valid).toBe(false);
  });
});
