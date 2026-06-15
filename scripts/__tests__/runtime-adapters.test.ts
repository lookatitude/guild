/**
 * scripts/__tests__/runtime-adapters.test.ts
 *
 * P1-L11 SC-8 — the four runtime adapters resolve a rung for every host, name a
 * concrete strategy, record a degradation receipt, and degrade (never assume) on an
 * unknown host. INFERRED rungs are flagged.
 */

import {
  resolveAdapter,
  resolveAllAdapters,
  RUNTIME_ADAPTERS,
  DegradationRecorder,
} from "../lib/runtime-adapters";
import {
  ADAPTER_SURFACES,
  validateDegradationReceipt,
  validateLadderTableComplete,
} from "../lib/adapter-fallback-ladders";
import { HOST_IDS } from "../lib/host-registry-schema";

describe("P1-L11 runtime adapters — every surface resolves a rung for every host (SC-8)", () => {
  it("the L0 ladder table is complete (precondition)", () => {
    expect(validateLadderTableComplete().valid).toBe(true);
  });

  it("each surface × each host resolves a valid rung + strategy + valid receipt", () => {
    for (const surface of ADAPTER_SURFACES) {
      for (const host of HOST_IDS) {
        const res = resolveAdapter(surface, host);
        expect(res.surface).toBe(surface);
        expect(res.host).toBe(host);
        expect(typeof res.rung).toBe("string");
        expect(res.strategy).toBeTruthy(); // every concrete cell has a named strategy
        expect(validateDegradationReceipt(res.receipt).valid).toBe(true);
      }
    }
  });

  it("concrete Claude/Codex rungs match the contract (interaction native/wrapped; browser bridged)", () => {
    expect(resolveAdapter("interaction", "claude").rung).toBe("native");
    expect(resolveAdapter("interaction", "codex").rung).toBe("wrapped");
    expect(resolveAdapter("session", "claude").rung).toBe("native");
    expect(resolveAdapter("browser", "claude").rung).toBe("bridged");
    expect(resolveAdapter("browser", "antigravity").rung).toBe("native"); // agy browser
  });
});

describe("P1-L11 runtime adapters — degradation recorded + inferred flagged", () => {
  it("records a receipt per resolve into the recorder", () => {
    const rec = new DegradationRecorder();
    resolveAllAdapters("codex", rec);
    expect(rec.all().length).toBe(ADAPTER_SURFACES.length);
    // codex: interaction=wrapped, session=wrapped, semantic_tool=bridged, browser=bridged → all degraded (below native)
    expect(rec.degraded().length).toBe(ADAPTER_SURFACES.length);
    // codex rungs are concrete (not inferred).
    expect(rec.inferred().length).toBe(0);
  });

  it("INFERRED hosts flag their receipts (off-box, must re-verify)", () => {
    const rec = new DegradationRecorder();
    resolveAllAdapters(".agents", rec);
    expect(rec.inferred().length).toBe(ADAPTER_SURFACES.length); // every .agents cell is INFERRED
  });

  it("claude native interaction/session are NOT degraded", () => {
    const rec = new DegradationRecorder();
    resolveAdapter("interaction", "claude", rec);
    resolveAdapter("session", "claude", rec);
    expect(rec.degraded().length).toBe(0);
  });
});

describe("P1-L11 runtime adapters — unknown host degrades (never assumes)", () => {
  it("an unknown host resolves to degraded + records, for every surface", () => {
    const rec = new DegradationRecorder();
    for (const surface of ADAPTER_SURFACES) {
      const res = resolveAdapter(surface, "totally-unknown-host", rec);
      expect(res.rung).toBe("degraded");
      expect(res.receipt.degraded).toBe(true);
      expect(res.receipt.inferred).toBe(false); // unknown ≠ inferred — it's a hard no-capability
    }
    expect(rec.degraded().length).toBe(ADAPTER_SURFACES.length);
  });

  it("RUNTIME_ADAPTERS exposes exactly the four surfaces", () => {
    expect(Object.keys(RUNTIME_ADAPTERS).sort()).toEqual([...ADAPTER_SURFACES].sort());
  });
});
