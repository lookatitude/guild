/**
 * tests/universal-host/_helpers.ts
 *
 * Shared REAL-PATH fixtures for the L6 universal-host SC tests (SC-2/4/5/6/7).
 *
 * Test-the-real-path discipline (the #1 recurring defect class): these helpers
 * NEVER hand-author a synthetic inventory or a fake fs seam for the green-now
 * assertions. They drive the SAME `discoverSurfaces()` / `buildInventory()` the
 * L1 generator uses, and read the SAME committed plugin tree the L2 generator
 * renders from — so a passing test reflects the real wiring, not a helper double.
 *
 * The one place we construct data by hand is the FAIL-FIXTURES (an unmapped
 * surface, a drifted package reference, a misloaded snapshot, a prose blob) —
 * those are deliberately-broken inputs whose REJECTION is the thing under test.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  discoverSurfaces,
  buildInventory,
  type DiscoveryOutput,
} from "../../scripts/build-inventory";
// PRODUCTION L2 loader — the SAME function the real build:hosts gate uses
// (build-host-packages.ts:353-354). The tests load BOTH the committed and the
// generated tree through it, so a bug in the real loader cannot be masked by a
// test-local re-implementation (codex G-lane Finding 1).
import { loadLogicalPackage } from "../../scripts/build-host-packages";
import type { GuildInventoryV1 } from "../../scripts/lib/inventory-schema";
import type { LogicalPackage, ExpectedSurfaces } from "../../scripts/lib/equivalence-contract";

/** Plugin root — tests/universal-host/ sits two levels under the plugin repo root. */
export const PLUGIN_ROOT = path.resolve(__dirname, "../..");

/** The real discovery of the live committed surface (one implementation, shared with L1). */
export function realDiscovery(): DiscoveryOutput {
  return discoverSurfaces(PLUGIN_ROOT);
}

/** The real, validated guild.inventory.v1 built from the live committed surface. */
export function realInventory(): GuildInventoryV1 {
  return buildInventory(PLUGIN_ROOT);
}

/**
 * Load the COMMITTED Claude package into the LogicalPackage shape via the
 * PRODUCTION loader — not a test double. Reads the real tree off disk.
 */
export function loadCommittedPackage(): LogicalPackage {
  return loadLogicalPackage(PLUGIN_ROOT);
}

/** Load a GENERATED Claude package tree via the SAME production loader (real cut-over path). */
export function loadGeneratedPackage(root: string = GENERATED_CLAUDE_ROOT): LogicalPackage {
  return loadLogicalPackage(root);
}

/**
 * The anti-vacuity FLOOR for SC-2, derived from the REAL inventory. A snapshot
 * that misloaded (omitted) any of these ids fails checkClaudeEquivalence's floor
 * instead of passing vacuously. Strongly recommended for any real SC-2 gate, and
 * MANDATORY in this harness (the MUST-encode misload test depends on it).
 */
export function expectedSurfacesFromInventory(inv: GuildInventoryV1 = realInventory()): ExpectedSurfaces {
  return {
    commands: inv.commands.map((e) => e.id),
    skills: inv.skills.map((e) => e.id),
    agents: inv.agents.map((e) => e.id),
    script_refs: inv.scripts.map((e) => e.id),
  };
}

/** A deep structural clone of a LogicalPackage (so a misload fixture can't mutate the real one). */
export function clonePackage(pkg: LogicalPackage): LogicalPackage {
  return JSON.parse(JSON.stringify(pkg)) as LogicalPackage;
}

// ── Generated-side (L2) detection — SC-2/SC-5 go live the moment L2/L3 land ──

/** Candidate roots the L2 generator writes the Claude package to. */
export const GENERATED_CLAUDE_ROOT = path.join(PLUGIN_ROOT, "dist", "claude-code");
export const GUILD_RUN_WRAPPER = path.join(PLUGIN_ROOT, "scripts", "guild-run.ts");

export function generatedClaudeExists(): boolean {
  return fs.existsSync(GENERATED_CLAUDE_ROOT) && fs.statSync(GENERATED_CLAUDE_ROOT).isDirectory();
}
export function guildRunWrapperExists(): boolean {
  return fs.existsSync(GUILD_RUN_WRAPPER);
}
