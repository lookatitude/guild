/**
 * tests/universal-host/sc2-full-tree-equivalence.test.ts
 *
 * SC-2 — the GENERATED Claude package (dist/claude-code/**) must be functionally
 * EQUIVALENT to the COMMITTED Claude package across the FULL installed tree:
 * manifest + commands + skills + agents + hooks + bootstrap + MCP/scripts refs —
 * not just plugin.json + skills/ (which would pass VACUOUSLY).
 *
 * MUST-encode (#1): the ExpectedSurfaces FLOOR is always passed, and a misloaded
 * snapshot (one that omitted a surface) FAILS the floor instead of passing
 * vacuously. The floor is derived from the REAL inventory.
 *
 * REAL PATH: the committed side is the live plugin tree loaded off disk
 * (loadCommittedPackage). The generated side is read from dist/claude-code/** the
 * moment L2 lands — this IS the cut-over gate, not a fixture double.
 *
 * Status at authoring:
 *   GREEN now — floor + misload-fails + self-equivalence on REAL committed data.
 *   RED until L2 — the committed-vs-generated comparison (guarded; goes live when
 *   dist/claude-code exists). Reported RED in the handoff.
 */

import {
  checkClaudeEquivalence,
  EQUIVALENCE_SURFACES,
  INTENTIONAL_EXCLUSIONS,
  normalizeJson,
  normalizeText,
  type LogicalPackage,
} from "../../scripts/lib/equivalence-contract";
import {
  loadCommittedPackage,
  loadGeneratedPackage,
  clonePackage,
  expectedSurfacesFromInventory,
  realInventory,
  PLUGIN_ROOT,
} from "./_helpers";
import { writeClaudeTree } from "../../scripts/build-host-packages";
import { UNSTAMPED_GENERATED_AT } from "../../scripts/build-inventory";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("SC-2 ExpectedSurfaces FLOOR — anti-vacuity (MUST-encode #1)", () => {
  it("the real committed package satisfies the inventory-derived floor", () => {
    const committed = loadCommittedPackage();
    const expected = expectedSurfacesFromInventory();
    // Comparing committed against itself must pass WITH the floor — proves the
    // floor is satisfiable by a fully-loaded snapshot (not impossibly strict).
    const res = checkClaudeEquivalence(committed, clonePackage(committed), expected);
    expect(res.reasons).toEqual([]);
    expect(res.ok).toBe(true);
    // Evidence the check spanned the full tree, not a subset.
    expect(res.surfaces_compared).toEqual(expect.arrayContaining([...EQUIVALENCE_SURFACES]));
  });

  it("MISLOAD FAILS: a snapshot that dropped the skills surface fails the floor", () => {
    const committed = loadCommittedPackage();
    const expected = expectedSurfacesFromInventory();
    const misloaded = clonePackage(committed);
    misloaded.skills = {}; // simulate a generator that never loaded skills/
    const res = checkClaudeEquivalence(committed, misloaded, expected);
    expect(res.ok).toBe(false);
    expect(
      res.reasons.some((r) => r.includes("missing expected skill") && r.includes("vacuity guard"))
    ).toBe(true);
  });

  it("MISLOAD FAILS for EACH floored surface (commands/skills/agents/script_refs)", () => {
    const committed = loadCommittedPackage();
    const expected = expectedSurfacesFromInventory();
    const drops: Array<[keyof LogicalPackage, string]> = [
      ["commands", "command"],
      ["skills", "skill"],
      ["agents", "agent"],
      ["script_refs", "script_ref"],
    ];
    for (const [surface, label] of drops) {
      const misloaded = clonePackage(committed);
      // Empty the surface (object → {}, array → []).
      (misloaded as unknown as Record<string, unknown>)[surface] = Array.isArray(
        (committed as unknown as Record<string, unknown>)[surface]
      )
        ? []
        : {};
      const res = checkClaudeEquivalence(committed, misloaded, expected);
      expect(res.ok).toBe(false);
      expect(res.reasons.some((r) => r.includes(`missing expected ${label}`))).toBe(true);
    }
  });

  it("the floor arrays are non-empty (an empty floor would be satisfiable vacuously)", () => {
    const expected = expectedSurfacesFromInventory();
    expect(expected.commands.length).toBeGreaterThan(0);
    expect(expected.skills.length).toBeGreaterThan(0);
    expect(expected.agents.length).toBeGreaterThan(0);
    expect(expected.script_refs.length).toBeGreaterThan(0);
  });

  it("ISOLATES the floor as the cause: when BOTH sides drop a surface, only the floor fails it", () => {
    // If BOTH committed and generated omit skills, compareIdMap sees no delta
    // (nothing present-in-one-side-only) → WITHOUT the floor this passes ok:true.
    // WITH the inventory-derived floor it must FAIL — proving the floor, not the
    // pairwise compare, is the mechanism that catches a full-tree misload.
    const committed = loadCommittedPackage();
    const a = clonePackage(committed);
    const b = clonePackage(committed);
    a.skills = {};
    b.skills = {};
    const withoutFloor = checkClaudeEquivalence(a, b /* no expected */);
    const withFloor = checkClaudeEquivalence(a, b, expectedSurfacesFromInventory());
    expect(withoutFloor.ok).toBe(true); // the pairwise compare alone does NOT catch it
    expect(withFloor.ok).toBe(false); // ONLY the floor does
    expect(withFloor.reasons.some((r) => r.includes("missing expected skill"))).toBe(true);
  });
});

describe("SC-2 surface coverage + normalization", () => {
  it("the contract spans all eight logical surfaces", () => {
    expect([...EQUIVALENCE_SURFACES].sort()).toEqual(
      ["agents", "bootstrap_sh", "commands", "hooks_json", "manifest", "mcp_json", "script_refs", "skills"].sort()
    );
  });

  it("EQUIVALENCE is content-equivalence after normalization, not byte-identity", () => {
    // provenance fields are stripped; trailing whitespace/newlines normalized.
    expect(normalizeJson({ b: 1, a: 2, _rendered_at: "x" })).toEqual({ a: 2, b: 1 });
    expect(normalizeText("a  \nb\n\n\n")).toBe("a\nb\n");
  });

  it("the INTENTIONAL_EXCLUSIONS set is closed and each carries a verified_by guard", () => {
    expect(INTENTIONAL_EXCLUSIONS.length).toBeGreaterThan(0);
    for (const ex of INTENTIONAL_EXCLUSIONS) {
      expect(ex.path).toBeTruthy();
      expect(ex.reason).toBeTruthy();
      expect(ex.verified_by).toBeTruthy();
    }
  });

  it("a content drift in a single surface is caught (sensitivity check, real data)", () => {
    const committed = loadCommittedPackage();
    const generated = clonePackage(committed);
    const firstCmd = Object.keys(generated.commands)[0]!;
    generated.commands[firstCmd] = generated.commands[firstCmd] + "\nDRIFT INJECTED\n";
    const res = checkClaudeEquivalence(committed, generated, expectedSurfacesFromInventory());
    expect(res.ok).toBe(false);
    expect(res.reasons.some((r) => r.includes(firstCmd) && r.includes("content differs"))).toBe(true);
  });
});

// ── The real committed-vs-generated cut-over gate ───────────────────────────
// Renders a FRESH Claude tree from the live inventory via the production
// writeClaudeTree into a temp dir, then compares committed ≡ generated through
// the production loadLogicalPackage WITH the inventory-derived floor. Building
// fresh (rather than reading a possibly-stale dist/) makes this deterministic and
// flake-free — it tests the generator's output, the actual cut-over guarantee.
describe("SC-2 committed ≡ generated — real cut-over gate (fresh generator output)", () => {
  let tmpDist: string;
  let claudeDir: string;
  beforeAll(() => {
    tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), "guild-l6-sc2-"));
    const inv = realInventory();
    // writeClaudeTree renders ONLY into tmpDist; it does not mutate the repo root.
    claudeDir = writeClaudeTree(PLUGIN_ROOT, inv, tmpDist, UNSTAMPED_GENERATED_AT);
  });
  afterAll(() => {
    try {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("the freshly generated Claude tree equals the committed tree across the full tree", () => {
    const committed = loadCommittedPackage();
    const generated: LogicalPackage = loadGeneratedPackage(claudeDir);
    const res = checkClaudeEquivalence(committed, generated, expectedSurfacesFromInventory());
    expect(res.reasons).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("the generated tree actually loaded the full tree (floor satisfied on BOTH sides)", () => {
    // Guards against a generator that emits an empty/partial tree that would
    // otherwise compare-equal to a misloaded committed side.
    const generated = loadGeneratedPackage(claudeDir);
    const expected = expectedSurfacesFromInventory();
    expect(Object.keys(generated.skills).length).toBeGreaterThanOrEqual(expected.skills.length);
    expect(Object.keys(generated.commands).length).toBeGreaterThanOrEqual(expected.commands.length);
    expect(Object.keys(generated.agents).length).toBeGreaterThanOrEqual(expected.agents.length);
  });
});
