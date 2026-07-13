/**
 * tests/universal-host/sc7-two-sided-parity.test.ts
 *
 * SC-7 — the TWO-SIDED parity contract. BOTH sides must hold:
 *   (a) COVERAGE — discovery == inventory (a real surface absent from the
 *       inventory is a silent drop → FAIL; an inventory id absent from the repo
 *       is a phantom → FAIL).
 *   (b) SUBSET   — package ⊆ inventory (a package referencing an id/schema_version
 *       absent from the inventory → FAIL).
 *
 * REAL PATH: the coverage side drives the SAME `discoverSurfaces()` the L1
 * generator uses (MUST-encode: DISCOVERY_RULES id-derivation is identical on the
 * builder and the scan side — there is ONE implementation, imported, not a second
 * copy). The green-now assertions read the live committed tree; the FAIL-FIXTURES
 * are deliberately-broken inputs whose rejection is the contract.
 *
 * Status at authoring: GREEN — L0 (predicates) + L1 (discoverSurfaces) landed.
 *
 * Contract: scripts/lib/parity-contract.ts (SC-7). Owned by L0; consumed here.
 */

import {
  DISCOVERY_RULES,
  COVERAGE_ENFORCED_CATEGORIES,
  checkCoverage,
  checkSubset,
  checkParity,
  type DiscoveredSurfaces,
  type PackageReferences,
} from "../../scripts/lib/parity-contract";
import { readScalarField } from "../../scripts/lib/frontmatter";
import type { InventoryCategory } from "../../scripts/lib/inventory-schema";
import { realDiscovery, realInventory, PLUGIN_ROOT } from "./_helpers";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Read the frontmatter `name:` scalar via the shared sibling-tolerant reader
 * (OD-3). `readScalarField` does a single-field line read — it does NOT YAML-parse
 * the whole block, so a skill/agent file whose unquoted multi-colon `description:`
 * sibling is YAML-hostile (invalid YAML as a whole) still yields `name:` robustly.
 * (whole-block `readFrontmatterString` returns undefined on those files.)
 */
function frontmatterName(absPath: string): string | undefined {
  return readScalarField(fs.readFileSync(absPath, "utf8"), "name");
}

// A package whose references are a genuine subset of the real inventory (one id
// per category, drawn from the inventory itself), built from REAL inventory.
function realSubsetPackage(): PackageReferences {
  const inv = realInventory();
  const firstId = (list: Array<{ id: string }>): string[] => (list.length ? [list[0]!.id] : []);
  return {
    host: "claude",
    command_ids: firstId(inv.commands),
    skill_ids: firstId(inv.skills),
    agent_ids: firstId(inv.agents),
    mcp_server_ids: firstId(inv.mcp_servers),
    script_ids: firstId(inv.scripts),
    hook_ids: firstId(inv.hooks),
    schema_versions: firstId(inv.schemas),
  };
}

describe("SC-7(a) COVERAGE — discovery == inventory (real path)", () => {
  it("the live committed surface is fully covered by the real inventory", () => {
    const d = realDiscovery();
    const inv = realInventory();
    const res = checkCoverage(d.discovered, inv);
    expect(res.reasons).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("every enforced category is actually scanned (no vacuous pass)", () => {
    const d = realDiscovery();
    for (const cat of COVERAGE_ENFORCED_CATEGORIES) {
      expect(d.discovered[cat]).toBeInstanceOf(Set);
      expect((d.discovered[cat] as Set<string>).size).toBeGreaterThan(0);
    }
  });

  it("ANTI-VACUITY: a discovery map omitting an enforced category cannot pass", () => {
    const inv = realInventory();
    // Drop hooks from the discovery map — the enforced-category guard must fire.
    const sparse: DiscoveredSurfaces = { ...realDiscovery().discovered };
    delete sparse.hooks;
    const res = checkCoverage(sparse, inv);
    expect(res.ok).toBe(false);
    expect(res.reasons.some((r) => r.includes('"hooks"') && r.includes("not supplied"))).toBe(true);
  });

  // FAIL-FIXTURE: one unmapped surface per ENFORCED category must make coverage FAIL.
  for (const cat of COVERAGE_ENFORCED_CATEGORIES) {
    it(`FAIL-FIXTURE: an unmapped ${cat} surface (in repo, not in inventory) FAILS coverage`, () => {
      const inv = realInventory();
      const discovered: DiscoveredSurfaces = { ...realDiscovery().discovered };
      const phantomId = `__l6_unmapped_${cat}__`;
      // Simulate the live scan finding a NEW surface the inventory never recorded.
      discovered[cat] = new Set([...(discovered[cat] as Set<string>), phantomId]);
      const res = checkCoverage(discovered, inv);
      expect(res.ok).toBe(false);
      expect(
        res.reasons.some((r) => r.includes(phantomId) && r.includes("MISSING from guild.inventory.v1"))
      ).toBe(true);
    });
  }

  it("FAIL-FIXTURE: a phantom inventory id (no repo surface) FAILS coverage", () => {
    const inv = realInventory();
    const discovered: DiscoveredSurfaces = { ...realDiscovery().discovered };
    // Remove a real command id from the scan → the inventory entry is now a phantom.
    const cmds = new Set(discovered.commands);
    const victim = [...cmds][0]!;
    cmds.delete(victim);
    discovered.commands = cmds;
    const res = checkCoverage(discovered, inv);
    expect(res.ok).toBe(false);
    expect(res.reasons.some((r) => r.includes(victim) && r.includes("phantom"))).toBe(true);
  });
});

describe("SC-7 DISCOVERY_RULES — identical id-derivation on builder and scan (MUST-encode #3)", () => {
  it("the scan side imports the SAME discoverSurfaces the builder uses (one implementation)", () => {
    // If discovery were reimplemented in the test, the inventory (built from
    // discoverSurfaces) and the scan (also discoverSurfaces) could not be proven
    // identical. We assert structural identity: every enforced category's scanned
    // id set equals the inventory's id set, derived through the one shared impl.
    const d = realDiscovery();
    const inv = realInventory() as unknown as Record<string, Array<{ id: string }>>;
    for (const cat of COVERAGE_ENFORCED_CATEGORIES) {
      const scanned = [...(d.discovered[cat] as Set<string>)].sort();
      const invIds = inv[cat].map((e) => e.id).sort();
      expect(scanned).toEqual(invIds);
    }
  });

  it("each enforced DISCOVERY_RULE declares globs and an id_rule", () => {
    const enforced = DISCOVERY_RULES.filter((r) => r.enforced);
    expect(enforced.map((r) => r.category).sort()).toEqual([...COVERAGE_ENFORCED_CATEGORIES].sort());
    for (const r of enforced) {
      expect(r.globs.length).toBeGreaterThan(0);
      expect(r.id_rule.length).toBeGreaterThan(0);
    }
  });
});

// NON-CIRCULAR rule-honoring probes: independently verify the IMPLEMENTATION's
// discovered output matches the DISCOVERY_RULES SPEC (globs + id_rule). These do
// NOT compare discoverSurfaces to itself — they re-derive the documented id rule
// from each entry's source_path and assert the impl agrees. If discoverSurfaces
// drifts from the declared rule, these FAIL (closes codex G-lane Finding 5).
describe("SC-7 DISCOVERY_RULES — the impl HONORS the declared id_rule (non-circular)", () => {
  const d = realDiscovery();

  it("commands: source_path matches commands/*.md and id = basename without .md", () => {
    for (const e of d.commands) {
      expect(e.source_path).toMatch(/^commands\/[^/]+\.md$/);
      expect(e.id).toBe(path.basename(e.source_path).replace(/\.md$/, ""));
    }
  });

  it("agents: source_path matches agents/*.md and id = basename without .md", () => {
    for (const e of d.agents) {
      expect(e.source_path).toMatch(/^agents\/[^/]+\.md$/);
      expect(e.id).toBe(path.basename(e.source_path).replace(/\.md$/, ""));
    }
  });

  it("skills: source_path is a SKILL(.src).md and id = the file's real `name:` frontmatter", () => {
    for (const e of d.skills) {
      expect(e.source_path).toMatch(/^skills\/.+\/SKILL(\.src)?\.md$/);
      // Independently re-read the frontmatter and confirm the derived id matches.
      expect(e.id).toBe(frontmatterName(path.join(PLUGIN_ROOT, e.source_path)));
    }
  });

  it("hooks: discovered ids EQUAL ids independently re-derived from hooks/hooks.json", () => {
    // Parse the canonical source DIRECTLY (not via discoverSurfaces' e.event) and
    // derive '<event>:<script-basename>' per the documented id_rule, then assert
    // discoverSurfaces produced exactly that set. Independent of the impl.
    const raw = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "hooks/hooks.json"), "utf8")) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const expected = new Set<string>();
    for (const [event, blocks] of Object.entries(raw.hooks ?? {})) {
      for (const block of blocks) {
        for (const inner of block.hooks ?? []) {
          const cmd = inner.command;
          if (!cmd) continue;
          const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s"']+)/.exec(cmd);
          const sp = m ? m[1] : cmd.trim().split(/\s+/).pop();
          if (!sp || !sp.includes("/")) continue;
          expected.add(`${event}:${sp.split("/").pop()}`);
        }
      }
    }
    expect(expected.size).toBeGreaterThan(0);
    expect(new Set(d.hooks.map((e) => e.id))).toEqual(expected);
  });

  it("mcp_servers: discovered ids EQUAL the keys independently read from .mcp.json", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, ".mcp.json"), "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    const expected = new Set(Object.keys(raw.mcpServers ?? {}));
    expect(expected.size).toBeGreaterThan(0);
    expect(new Set(d.mcp_servers.map((e) => e.id))).toEqual(expected);
    for (const e of d.mcp_servers) expect(e.source_path).toBe(".mcp.json");
  });

  it("scripts: source_path under scripts/**/*.ts (no *.test.ts) or a command-referenced hooks/dist CLI bundle; id derives from the path", () => {
    // Two legitimate shapes since the packaging-closure fix:
    //  (a) scripts/**/*.ts sources — id = path under scripts/ sans .ts
    //  (b) hooks/dist/*.js CLI bundles that shipped command bodies invoke
    //      directly (discoverHookCliBundles) — id = path sans .js. These are
    //      runtime-closure entries, NOT hook-event bindings (those live in the
    //      hooks category), and are restricted to hooks/dist to stay tight.
    for (const e of d.scripts) {
      if (/^hooks\/dist\/[^/]+\.js$/.test(e.source_path)) {
        expect(e.id).toBe(e.source_path.replace(/\.js$/, ""));
        continue;
      }
      expect(e.source_path).toMatch(/^scripts\/.+\.ts$/);
      expect(e.source_path).not.toMatch(/\.test\.ts$/);
      expect(e.id).toBe(e.source_path.replace(/^scripts\//, "").replace(/\.ts$/, ""));
    }
    // anti-vacuity: the hooks/dist class actually occurs (run-trace is shipped)
    expect(d.scripts.some((e) => e.source_path === "hooks/dist/run-trace.js")).toBe(true);
  });
});

describe("SC-7(b) SUBSET — package ⊆ inventory (real path)", () => {
  it("a package referencing only real inventory ids passes subset", () => {
    const inv = realInventory();
    const res = checkSubset(realSubsetPackage(), inv);
    expect(res.reasons).toEqual([]);
    expect(res.ok).toBe(true);
  });

  // FAIL-FIXTURE: a drifted/hand-edited reference in EACH required category must FAIL.
  const driftCases: Array<{ field: keyof PackageReferences; kind: string }> = [
    { field: "command_ids", kind: "command" },
    { field: "skill_ids", kind: "skill" },
    { field: "agent_ids", kind: "agent" },
    { field: "mcp_server_ids", kind: "mcp_server" },
    { field: "script_ids", kind: "script" },
    { field: "hook_ids", kind: "hook" },
    { field: "schema_versions", kind: "schema_version" },
  ];
  for (const { field, kind } of driftCases) {
    it(`FAIL-FIXTURE: a package referencing a non-inventoried ${kind} FAILS subset`, () => {
      const inv = realInventory();
      const pkg = realSubsetPackage();
      const bogus = `__l6_drift_${kind}__`;
      (pkg[field] as string[]) = [...(pkg[field] as string[]), bogus];
      const res = checkSubset(pkg, inv);
      expect(res.ok).toBe(false);
      expect(res.violations.some((v) => v.kind === kind && v.id === bogus)).toBe(true);
    });
  }

  it("POSITIVE: a package referencing the BARE `review_result.v1` schema PASSES subset", () => {
    // The accepted wire string carries no guild. prefix (result-contracts.ts).
    // Prove the bare form is in the inventory and accepted — the counterpart to
    // the prefixed-form rejection below.
    const inv = realInventory();
    expect(inv.schemas.map((s) => s.id)).toContain("review_result.v1");
    const pkg = realSubsetPackage();
    pkg.schema_versions = ["review_result.v1", "guild.handoff.v2"];
    const res = checkSubset(pkg, inv);
    expect(res.reasons).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("FAIL-FIXTURE: a package referencing the prefixed `guild.review_result.v1` schema FAILS subset", () => {
    // The real wire string is `review_result.v1` (no guild. prefix). A package
    // emitting the prose-table form mis-keys and must be caught as drift.
    const inv = realInventory();
    const pkg = realSubsetPackage();
    pkg.schema_versions = ["guild.review_result.v1"];
    const res = checkSubset(pkg, inv);
    expect(res.ok).toBe(false);
    expect(res.violations.some((v) => v.kind === "schema_version" && v.id === "guild.review_result.v1")).toBe(true);
  });
});

describe("SC-7 combined two-sided gate (checkParity)", () => {
  it("real discovery + a real-subset package + real inventory → ok", () => {
    const res = checkParity(realDiscovery().discovered, [realSubsetPackage()], realInventory());
    expect(res.reasons).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("a failure on EITHER side fails the combined gate", () => {
    const inv = realInventory();
    const discovered = { ...realDiscovery().discovered };
    (discovered.agents as Set<string>) = new Set([...(discovered.agents as Set<string>), "__l6_unmapped_agent__"]);
    const badPkg = realSubsetPackage();
    badPkg.command_ids = [...badPkg.command_ids, "__l6_drift_command__"];
    const res = checkParity(discovered as Record<InventoryCategory, Set<string>>, [badPkg], inv);
    expect(res.ok).toBe(false);
    expect(res.coverage.ok).toBe(false);
    expect(res.subset.every((s) => s.ok)).toBe(false);
  });
});
