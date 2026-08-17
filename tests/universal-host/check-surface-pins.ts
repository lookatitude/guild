#!/usr/bin/env -S npx tsx
/**
 * tests/universal-host/check-surface-pins.ts
 *
 * G6b — the skills/commands surface-change checklist, as DETERMINISTIC
 * lane-runnable code instead of prose.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 * The pinned-surface discipline (edit a skill/command → re-extract the neutral
 * registry → re-ratify RATIFIED_TREES → rebuild+sync) was a manual checklist, and
 * it was MISSED in 3 of 4 skill-surface lanes even with active steering. A missed
 * step lands a PR that fails CI on `p2-w2-sc1`/`p2-w2-sc3` (registry byte-drift) or
 * `p2-w2-sc5`/`p2-w3-sc6` (tree-pin drift) — late, opaquely, and usually on an
 * UNRELATED later PR when a squash orphans the pin.
 *
 * This module turns the checklist into ONE command a lane runs BEFORE it commits:
 *
 *     npx tsx tests/universal-host/check-surface-pins.ts
 *
 * It runs the EXACT invariants the CI guards enforce and, on any drift, prints the
 * precise remediation step — so the lane fixes it in-commit instead of discovering
 * it in CI. It is co-located with `live-surface-anchor.ts` (the pin source of
 * truth) and the `p2-w2-*` / `p2-w3-*` guards it front-runs, and drives the SAME
 * `renderSkillFromRegistry` / `renderCommandV1` / `worktreeTreeHash` those guards
 * do — no second implementation to drift.
 *
 * Two invariant families, four checks:
 *   1. REGISTRY round-trip — `render(entry) === committed <SKILL.md|command.md>`
 *      byte-for-byte, for the 5 WAVE2 skills and every command. A drift here means
 *      the neutral registry was not re-extracted after the surface edit.
 *   2. TREE pin — `worktreeTreeHash(surface) === RATIFIED_TREES[surface]` for
 *      `skills` and `commands`. A drift here means the surface changed but
 *      RATIFIED_TREES was not re-ratified (or was ratified BEFORE the rebuild/sync).
 *
 * Exit 0 = clean (safe to commit); exit 1 = drift (remediation printed). NEVER a
 * false green: an unreadable registry / missing file surfaces as a violation, not
 * a skipped check.
 *
 * Owner: eval-engineer (co-owned with the surface-editing lane).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  loadSkillRegistry,
  renderSkillFromRegistry,
  WAVE2_SKILL_IDS,
} from "../../scripts/lib/skill-source-transform";
import {
  renderCommandV1,
  validateCommandRegistryV1,
  type CommandRegistryV1,
} from "../../scripts/lib/command-registry";
import { PLUGIN_ROOT, RATIFIED_TREES, withLiveSurfaceLock, worktreeTreeHash } from "./live-surface-anchor";

/** A single checklist failure, with the deterministic fix. */
export interface SurfacePinViolation {
  kind: "registry_stale" | "tree_pin_stale";
  surface: "skills" | "commands";
  /** skill/command id for a registry drift; the surface name for a tree drift. */
  id: string;
  detail: string;
  remedy: string;
}

export interface SurfacePinReport {
  ok: boolean;
  violations: SurfacePinViolation[];
}

export interface SurfacePinOptions {
  pluginRoot?: string;
  skillRegistryPath?: string;
  commandRegistryPath?: string;
  /** The ratified anchor to compare against (default: the committed RATIFIED_TREES). */
  ratifiedTrees?: Readonly<Record<string, string>>;
  /** Worktree tree-hasher (default: the real git-backed `worktreeTreeHash`). */
  treeHashOf?: (p: string) => string;
}

const REEXTRACT_SKILL_REMEDY =
  "re-extract skill-src/skill-registry.json (extractSkillV1 per WAVE2 skill), " +
  "verify renderSkillFromRegistry round-trips byte-identical, and commit it WITH the skill edit";
const REEXTRACT_COMMAND_REMEDY =
  "re-extract command-src/command-registry.json (extractCommandV1 per command), " +
  "verify renderCommandV1 round-trips byte-identical, and commit it WITH the command edit";
const RERATIFY_REMEDY =
  "re-ratify RATIFIED_TREES in tests/universal-host/live-surface-anchor.ts with the NEW " +
  "worktreeTreeHash value (computed AFTER rebuild+sync, in the SAME commit, with a dated note)";

/**
 * The pure checklist. Compares the committed registry renders and the worktree
 * tree hashes against the ratified anchor, collecting every drift. No process
 * exit, no printing — so the CI test drives it directly and can inject synthetic
 * drift to prove the detector is live.
 */
export function checkSurfacePins(options: SurfacePinOptions = {}): SurfacePinReport {
  // Codex round-2 item 7: ONE mutex acquisition covers the COMPLETE default
  // live-surface read window — the registry round-trip file reads (skills dir,
  // commands dir, every committed command body) AND the tree hashing — so a
  // parallel guard suite's anti-vacuity perturbation window can never be
  // observed anywhere inside a single checklist evaluation (round 1 locked
  // only the hash step; the registry reads could still see a mid-window probe
  // and report a false registry_stale). The lock is non-reentrant, so it is
  // lifted here to the top of the path and the inner default reader below is
  // the bare lock-free `worktreeTreeHash`. An injected `treeHashOf` (the
  // suite's synthetic-drift probes) is untouched — what the checklist asserts
  // is unchanged.
  return withLiveSurfaceLock(() => checkSurfacePinsHoldingLock(options));
}

/** The checklist body. Callers hold the live-surface lock (see above). */
function checkSurfacePinsHoldingLock(options: SurfacePinOptions = {}): SurfacePinReport {
  const root = options.pluginRoot ?? PLUGIN_ROOT;
  const ratified = options.ratifiedTrees ?? RATIFIED_TREES;
  const treeHashOf = options.treeHashOf ?? worktreeTreeHash;
  const violations: SurfacePinViolation[] = [];

  // 1a — skill registry round-trip (the 5 WAVE2 skills).
  try {
    const registry = loadSkillRegistry(options.skillRegistryPath);
    // ID-SET COVERAGE (F1): the skill registry must cover EXACTLY the WAVE2 ids.
    // A round-trip loop over WAVE2_SKILL_IDS alone would silently pass a registry
    // that dropped or duplicated an entry — the byte-compare only fires for ids it
    // iterates. Assert the set equality the p2-w2-sc1 guard also enforces.
    const registryIds = registry.skills.map((s) => s.id).sort();
    const expectedIds = [...WAVE2_SKILL_IDS].sort();
    if (
      registryIds.length !== expectedIds.length ||
      registryIds.some((id, i) => id !== expectedIds[i])
    ) {
      violations.push({
        kind: "registry_stale",
        surface: "skills",
        id: "*",
        detail: `skill registry ids [${registryIds.join(", ")}] ≠ WAVE2 ids [${expectedIds.join(", ")}]`,
        remedy: REEXTRACT_SKILL_REMEDY,
      });
    }
    for (const id of WAVE2_SKILL_IDS) {
      const committedPath = path.join(root, "skills", "meta", id, "SKILL.md");
      let committed: string;
      try {
        committed = fs.readFileSync(committedPath, "utf8");
      } catch {
        violations.push({
          kind: "registry_stale",
          surface: "skills",
          id,
          detail: `committed skills/meta/${id}/SKILL.md is unreadable`,
          remedy: REEXTRACT_SKILL_REMEDY,
        });
        continue;
      }
      let rendered: string;
      try {
        rendered = renderSkillFromRegistry(registry, id);
      } catch (err) {
        violations.push({
          kind: "registry_stale",
          surface: "skills",
          id,
          detail: `renderSkillFromRegistry failed: ${String(err instanceof Error ? err.message : err)}`,
          remedy: REEXTRACT_SKILL_REMEDY,
        });
        continue;
      }
      if (rendered !== committed) {
        violations.push({
          kind: "registry_stale",
          surface: "skills",
          id,
          detail: `render(skill-registry[${id}]) is NOT byte-identical to the committed SKILL.md`,
          remedy: REEXTRACT_SKILL_REMEDY,
        });
      }
    }
  } catch (err) {
    violations.push({
      kind: "registry_stale",
      surface: "skills",
      id: "*",
      detail: `skill-src/skill-registry.json is unreadable/invalid: ${String(err instanceof Error ? err.message : err)}`,
      remedy: REEXTRACT_SKILL_REMEDY,
    });
  }

  // 1b — command registry round-trip (every committed command).
  try {
    const registryPath =
      options.commandRegistryPath ?? path.join(root, "command-src", "command-registry.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as CommandRegistryV1;
    // STRUCTURAL VALIDITY (F1): a semantically-invalid registry (unknown keys,
    // wrong types) must not pass just because each present entry happens to
    // render — the p2-w2-sc3 guard asserts fail-closed validity too.
    const structural = validateCommandRegistryV1(registry);
    if (!structural.valid) {
      violations.push({
        kind: "registry_stale",
        surface: "commands",
        id: "*",
        detail: `command-registry.json is not fail-closed-valid: ${structural.errors.join("; ")}`,
        remedy: REEXTRACT_COMMAND_REMEDY,
      });
    }
    // ID-SET COVERAGE (F1): the registry must cover EXACTLY the on-disk
    // commands/*.md stems. A NEW command file absent from the registry (or a
    // registry entry with no file) is drift the per-entry render loop below can
    // never see — it only iterates the registry's OWN entries.
    let ondiskIds: string[] = [];
    try {
      ondiskIds = fs
        .readdirSync(path.join(root, "commands"))
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""))
        .sort();
      const regIds = registry.commands.map((c) => c.id).sort();
      if (regIds.length !== ondiskIds.length || regIds.some((id, i) => id !== ondiskIds[i])) {
        violations.push({
          kind: "registry_stale",
          surface: "commands",
          id: "*",
          detail: `command registry ids [${regIds.join(", ")}] ≠ on-disk commands/*.md stems [${ondiskIds.join(", ")}]`,
          remedy: REEXTRACT_COMMAND_REMEDY,
        });
      }
    } catch {
      /* commands dir unreadable is caught by the per-entry render loop below */
    }
    for (const entry of registry.commands) {
      const committedPath = path.join(root, "commands", `${entry.id}.md`);
      let committed: string;
      try {
        committed = fs.readFileSync(committedPath, "utf8");
      } catch {
        violations.push({
          kind: "registry_stale",
          surface: "commands",
          id: entry.id,
          detail: `committed commands/${entry.id}.md is unreadable`,
          remedy: REEXTRACT_COMMAND_REMEDY,
        });
        continue;
      }
      let rendered: string;
      try {
        rendered = renderCommandV1(entry);
      } catch (err) {
        violations.push({
          kind: "registry_stale",
          surface: "commands",
          id: entry.id,
          detail: `renderCommandV1 failed: ${String(err instanceof Error ? err.message : err)}`,
          remedy: REEXTRACT_COMMAND_REMEDY,
        });
        continue;
      }
      if (rendered !== committed) {
        violations.push({
          kind: "registry_stale",
          surface: "commands",
          id: entry.id,
          detail: `render(command-registry[${entry.id}]) is NOT byte-identical to the committed command.md`,
          remedy: REEXTRACT_COMMAND_REMEDY,
        });
      }
    }
  } catch (err) {
    violations.push({
      kind: "registry_stale",
      surface: "commands",
      id: "*",
      detail: `command-src/command-registry.json is unreadable/invalid: ${String(err instanceof Error ? err.message : err)}`,
      remedy: REEXTRACT_COMMAND_REMEDY,
    });
  }

  // 2 — tree pins for both surfaces.
  for (const surface of ["skills", "commands"] as const) {
    const expected = ratified[surface];
    let actual: string;
    try {
      actual = treeHashOf(surface);
    } catch (err) {
      violations.push({
        kind: "tree_pin_stale",
        surface,
        id: surface,
        detail: `worktreeTreeHash(${surface}) failed: ${String(err instanceof Error ? err.message : err)}`,
        remedy: RERATIFY_REMEDY,
      });
      continue;
    }
    if (actual !== expected) {
      violations.push({
        kind: "tree_pin_stale",
        surface,
        id: surface,
        detail: `worktree ${surface} tree ${actual} ≠ RATIFIED_TREES.${surface} ${expected}`,
        remedy: RERATIFY_REMEDY,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

/** Render the human-facing checklist report (pure — pinned by tests). */
export function renderSurfacePinReport(report: SurfacePinReport): string {
  if (report.ok) {
    return "[surface-pins] OK — registry round-trips byte-identical and RATIFIED_TREES matches the worktree.";
  }
  const lines = [
    `[surface-pins] DRIFT — ${report.violations.length} violation(s). The skills/commands ` +
      "surface changed but the pinned-surface checklist is not complete IN THIS COMMIT:",
    "",
  ];
  for (const v of report.violations) {
    lines.push(`  ✗ [${v.kind}] ${v.surface}/${v.id}`);
    lines.push(`      ${v.detail}`);
    lines.push(`      FIX: ${v.remedy}`);
  }
  lines.push("");
  lines.push(
    "Order (never bare sync-live-resources after a rebuild; compute pins AFTER sync):",
  );
  lines.push("  1. re-extract registries  2. rebuild hooks (cd hooks && npm run build)");
  lines.push("  3. npx tsx scripts/sync-module-resources.ts + BOTH --check modes");
  lines.push("  4. re-ratify RATIFIED_TREES with the post-sync worktreeTreeHash values");
  return lines.join("\n");
}

if (require.main === module) {
  const report = checkSurfacePins();
  process.stdout.write(renderSurfacePinReport(report) + "\n");
  process.exit(report.ok ? 0 : 1);
}
