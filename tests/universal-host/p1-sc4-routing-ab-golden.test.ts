/**
 * tests/universal-host/p1-sc4-routing-ab-golden.test.ts
 *
 * P1 SC-4 — ROUTING A/B GOLDEN. The L7 host-registry unification is
 * behavior-preserving: `route()` and `selectReviewer()` must produce
 * BYTE-IDENTICAL decisions for Claude/Codex before and after the registry swap.
 *
 * The A/B method (C4, routing-ab-contract.ts): serialize both sides via
 * canonical-JSON (recursively sorted keys, undefined dropped) and deep-equal.
 *
 * What this file pins:
 *   (1) The C4 compare MACHINERY is correct AND discriminating — canonicalJSON is
 *       key-order independent, treats absent==explicit-undefined, preserves array
 *       order; compareRoutingAb DETECTS a one-field drift and surfaces both
 *       canonical strings (the RED discriminator — proves non-vacuity).
 *   (2) The "A" side (pre-registry) golden: the REAL `route()` / `selectReviewer()`
 *       decisions over a fixed input matrix, captured as committed fixtures. The
 *       real functions re-run here must equal the committed golden (drift guard).
 *   (3) Determinism: the same inputs through the real functions twice canonicalize
 *       identically (the A/B is meaningful only if each side is deterministic).
 *
 * REAL PATH (no seam): `route()` is the shipped router driven by real
 * `guild.host_capability.v1` manifests + a fixed clock; `selectReviewer()` is
 * driven through the production `detectProviders()` + the module's sanctioned
 * `ProbeEnv` injection. No decision is hand-authored — the golden is GENERATED
 * from the real functions, so a contract drift in L7 fails (2), not a test double.
 *
 * Status at authoring:
 *   GREEN now — machinery + A-side golden pin + determinism (L0 C4 + the existing
 *   route/selectReviewer shipped).
 *   RED until L7 — the post-registry "B" side (the unified registry path) is
 *   asserted against this same golden the moment L7 lands; until then the B-side
 *   block is guarded + REPORTED (see "B-side" describe). This file is the cut-over
 *   gate, not a fixture double.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  canonicalJSON,
  deepEqualCanonical,
  compareRoutingAb,
} from "../../scripts/lib/routing-ab-contract";
import {
  routingAbCases,
  runRoutingCase,
  selectReviewerAbCases,
  runSelectReviewerCase,
} from "./_p1-helpers";

const FIX = path.resolve(__dirname, "fixtures");
function readGolden(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(FIX, name), "utf8"));
}

// ── (1) Canonical-JSON / compare machinery (C4) ─────────────────────────────

describe("P1 SC-4 — canonical-JSON A/B machinery (C4)", () => {
  it("is key-order independent (deep-equal modulo key order ⇒ identical string)", () => {
    const a = { host: "claude", tier: "mid", nested: { z: 1, a: 2 } };
    const b = { nested: { a: 2, z: 1 }, tier: "mid", host: "claude" };
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
    expect(deepEqualCanonical(a, b)).toBe(true);
  });

  it("treats an absent key and an explicit-undefined key identically", () => {
    expect(canonicalJSON({ a: 1 })).toBe(canonicalJSON({ a: 1, b: undefined }));
    expect(deepEqualCanonical({ a: 1 }, { a: 1, b: undefined })).toBe(true);
  });

  it("preserves array order (arrays are sequence-significant, not sorted)", () => {
    expect(deepEqualCanonical([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(canonicalJSON({ fallbackChain: ["a", "b"] })).not.toBe(
      canonicalJSON({ fallbackChain: ["b", "a"] })
    );
  });

  // RED discriminator: a single-field drift MUST be caught, with both byte strings.
  it("DETECTS a one-field drift and surfaces both canonical strings (non-vacuity)", () => {
    const expected = { host: "claude", tier: "mid", model: "sonnet" };
    const drifted = { host: "claude", tier: "mid", model: "opus" }; // model drift
    const cmp = compareRoutingAb(expected, drifted);
    expect(cmp.equal).toBe(false);
    expect(cmp.expected_canonical).toBeDefined();
    expect(cmp.actual_canonical).toBeDefined();
    expect(cmp.expected_canonical).not.toBe(cmp.actual_canonical);
    expect(cmp.expected_canonical).toContain("sonnet");
    expect(cmp.actual_canonical).toContain("opus");
  });

  it("reports equal=true (no diff strings) for an identical-modulo-order pair", () => {
    const cmp = compareRoutingAb(
      { host: "claude", tier: "mid" },
      { tier: "mid", host: "claude" }
    );
    expect(cmp.equal).toBe(true);
    expect(cmp.expected_canonical).toBeUndefined();
    expect(cmp.actual_canonical).toBeUndefined();
  });
});

// ── (2) A-side golden pin — real route() decisions ──────────────────────────

describe("P1 SC-4 — route() A-side golden (pre-registry baseline)", () => {
  const golden = readGolden("sc4-routing-ab-golden.json");

  it("covers every routing case (golden ⊇ matrix — no silently-dropped case)", () => {
    const matrixNames = routingAbCases().map((c) => c.name).sort();
    expect(Object.keys(golden).sort()).toEqual(matrixNames);
  });

  for (const c of routingAbCases()) {
    it(`real route() == committed golden — ${c.name}`, () => {
      const actual = JSON.parse(canonicalJSON(runRoutingCase(c)));
      const cmp = compareRoutingAb(golden[c.name], actual);
      // On drift the message carries both byte strings (compareRoutingAb output).
      expect(cmp).toEqual({ equal: true });
    });

    it(`route() is deterministic (two real calls byte-identical) — ${c.name}`, () => {
      expect(canonicalJSON(runRoutingCase(c))).toBe(canonicalJSON(runRoutingCase(c)));
    });
  }

  it("the golden is non-trivial — at least one cross-host (codex) decision is pinned", () => {
    const hosts = Object.values(golden).map((d) => (d as { host: string }).host);
    expect(hosts).toContain("codex"); // adversarial-review/powerful routes to codex
    expect(hosts).toContain("claude");
  });

  // T7-H2 REGRESSION PIN. The router used to set `independence: "strong"`
  // unconditionally on every non-degraded route — including the claude→claude
  // case, where there is no cross-host anything. The launcher persisted that
  // value into `run-state.json`, which is in the share-set AND git re-included,
  // so an unverified "strong" reached a committed artifact while the honest
  // §7a adjudication was never written at all. No route may claim strong again.
  it("T7-H2: NO routing decision in the golden claims independence:'strong'", () => {
    for (const [name, d] of Object.entries(golden)) {
      expect({ name, independence: (d as { independence: string }).independence }).toEqual({
        name,
        independence: "weak",
      });
    }
  });

  it("T7-H2: the real route() never returns independence:'strong', and reports hostDiversity instead", () => {
    for (const c of routingAbCases()) {
      const decision = runRoutingCase(c) as unknown as Record<string, unknown>;
      expect(decision["independence"]).toBe("weak");
      expect(["distinct", "same", "unknown"]).toContain(decision["hostDiversity"]);
    }
  });
});

// ── (2b) A-side golden pin — real selectReviewer() decisions ────────────────

describe("P1 SC-4 — selectReviewer() A-side golden (pre-registry baseline)", () => {
  const golden = readGolden("sc4-select-reviewer-golden.json");

  it("covers every selectReviewer case", () => {
    const names = selectReviewerAbCases().map((c) => c.name).sort();
    expect(Object.keys(golden).sort()).toEqual(names);
  });

  for (const c of selectReviewerAbCases()) {
    it(`real detectProviders→selectReviewer == golden — ${c.name}`, () => {
      const actual = JSON.parse(canonicalJSON(runSelectReviewerCase(c)));
      expect(compareRoutingAb(golden[c.name], actual)).toEqual({ equal: true });
    });
  }

  it("the false-signoff guard holds in the golden — only a different-family pick is 'selected'", () => {
    for (const [name, d] of Object.entries(golden)) {
      const r = d as { status: string; provider: string | null };
      if (r.status === "selected") {
        expect(r.provider).toBe("codex-plugin"); // never a same-family / null 'selected'
        expect(name).toMatch(/codex/i);
      } else {
        expect(r.provider).toBeNull();
      }
    }
  });
});

// ── (3) B-side — the post-registry path (LIVE: L7 host-registry.ts has landed) ──

describe("P1 SC-4 — post-registry B-side A/B (L7 registry unification)", () => {
  // L7 (tooling-engineer) unified host-router/provider-detect through
  // host-registry.ts, which exposes the SAME route()/selectReviewer() surface backed
  // by the registry. The behavior-preserving contract: the registry-backed decision
  // canonicalizes byte-identically to the committed A-side golden. host-registry.ts
  // having landed is a HARD precondition of this gate — asserted, not assumed.
  const REGISTRY_MARKER = path.resolve(__dirname, "../../scripts/lib/host-registry.ts");

  it("L7 host-registry.ts has landed (the cut-over precondition this gate requires)", () => {
    expect(fs.existsSync(REGISTRY_MARKER)).toBe(true);
  });

  it("post-registry route() == A-side golden (byte-identical, every case)", () => {
    const routeG = readGolden("sc4-routing-ab-golden.json");
    for (const c of routingAbCases()) {
      expect(
        compareRoutingAb(routeG[c.name], JSON.parse(canonicalJSON(runRoutingCase(c))))
      ).toEqual({ equal: true });
    }
  });

  it("post-registry selectReviewer() == A-side golden (byte-identical, every case)", () => {
    const selG = readGolden("sc4-select-reviewer-golden.json");
    for (const c of selectReviewerAbCases()) {
      expect(
        compareRoutingAb(selG[c.name], JSON.parse(canonicalJSON(runSelectReviewerCase(c))))
      ).toEqual({ equal: true });
    }
  });
});
