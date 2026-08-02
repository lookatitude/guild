/**
 * Module-ownership rail for the src/modules/* reorganization.
 *
 * Module manifests own every inventory id, module resources hold the canonical
 * bodies, and live host-facing paths stay as generated compatibility mirrors.
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import { buildInventory } from "../build-inventory";
import {
  loadModuleManifests,
  validateModuleBoundaries,
  validateModuleHealth,
  validateModuleOwnership,
  type ModuleManifest,
} from "../lib/module-manifest";
import * as shim from "../lib/module-manifest";
import * as moduleImpl from "../../src/modules/kernel/workflows/module-manifest";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

function cloneManifests(manifests: ModuleManifest[]): ModuleManifest[] {
  return JSON.parse(JSON.stringify(manifests)) as ModuleManifest[];
}

describe("src/modules ownership manifests", () => {
  const inventory = buildInventory(PLUGIN_ROOT);
  const manifests = loadModuleManifests(PLUGIN_ROOT);

  it("loads the module map with the expected substrate modules present", () => {
    const ids = manifests.map((manifest) => manifest.id).sort();
    expect(ids).toContain("context");
    expect(ids).toContain("prompting");
    expect(ids).toContain("communication");
    expect(ids).toContain("dispatch");
    expect(ids).toContain("kernel");
    for (const id of ["intake", "loops", "review"]) {
      expect(manifests.find((manifest) => manifest.id === id)?.implementation_mode).toBe("workflow-backed");
    }
    // dashboard flipped to resource-only when its orphaned projector was deleted
    // (plugin-audit-remediation G5b) — it owns resources, ships no workflow code.
    expect(manifests.find((manifest) => manifest.id === "dashboard")?.implementation_mode).toBe("resource-only");
    expect(ids.length).toBeGreaterThanOrEqual(25);
  });

  it("keeps scripts/lib/module-manifest as a compatibility shim over src/modules/kernel", () => {
    expect(shim.MODULE_MANIFEST_SCHEMA_VERSION).toBe(moduleImpl.MODULE_MANIFEST_SCHEMA_VERSION);
    expect(shim.loadModuleManifests).toBe(moduleImpl.loadModuleManifests);
    expect(shim.validateModuleOwnership).toBe(moduleImpl.validateModuleOwnership);
    expect(shim.validateModuleBoundaries).toBe(moduleImpl.validateModuleBoundaries);
    expect(shim.validateModuleHealth).toBe(moduleImpl.validateModuleHealth);
  });

  it("versions every public module API introduced for host-facing migrations", () => {
    for (const moduleId of [
      "config", "dispatch", "distribution", "learning",
      "migrations", "review", "security", "specialists",
    ]) {
      const publicIndex = fs.readFileSync(
        path.join(PLUGIN_ROOT, "src", "modules", moduleId, "index.ts"),
        "utf8"
      );
      expect(publicIndex).toContain(
        'export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;'
      );
    }
  });

  it("assigns every live command/skill/agent/hook/mcp/script inventory id to exactly one module", () => {
    const result = validateModuleOwnership(inventory, manifests);
    expect(result).toEqual({ ok: true, missing: [], duplicate: [], errors: [] });

    // Anti-vacuity floors: the rail is checking the real current surface, not an
    // empty fixture or a narrow sample.
    expect(inventory.commands.length).toBeGreaterThanOrEqual(20);
    expect(inventory.skills.length).toBeGreaterThanOrEqual(100);
    // Machinery agents only (machinery-vs-template-library ADR): advisor +
    // developer. The 15 domain roles are templates/specialists/*.md, not
    // inventoried agents.
    // cap-loc-D01 added `context-manager` as the third machinery agent, gated on
    // its written contract (scripts/lib/capability/context-manager-contract.ts).
    expect(inventory.agents.length).toBe(3);
    expect(inventory.hooks.length).toBeGreaterThanOrEqual(10);
    expect(inventory.scripts.length).toBeGreaterThanOrEqual(200);
  });

  it("uses public module indexes for cross-module imports and declares each dependency", () => {
    const result = validateModuleBoundaries(PLUGIN_ROOT, manifests);
    expect(result).toEqual({ ok: true, violations: [], errors: [] });
  });

  it("keeps every module healthy: generated resources exist and workflow modules expose public indexes", () => {
    const result = validateModuleHealth(PLUGIN_ROOT, manifests);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.modules.length).toBe(manifests.length);
    expect(result.modules.filter((module) => module.workflows > 0).length).toBeGreaterThanOrEqual(20);
    expect(result.modules.filter((module) => module.workflows > 0).every((module) => module.has_public_index)).toBe(
      true
    );
    expect(
      result.modules
        .filter((module) => module.implementation_mode === "resource-only")
        .map((module) => module.module_id)
        .sort()
      // dashboard: resource-only since its orphaned projector was deleted (G5b)
    ).toEqual(["dashboard"]);
    expect(
      result.modules
        .filter((module) => module.implementation_mode === "resource-only")
        .every((module) => module.workflows === 0)
    ).toBe(true);
    expect(
      result.modules
        .filter((module) => module.implementation_mode === "workflow-backed")
        .every((module) => module.workflows > 0)
    ).toBe(true);
    expect(result.modules.reduce((sum, module) => sum + module.resources, 0)).toBeGreaterThanOrEqual(390);
  });

  it("CONTROL: removing an owner makes the real inventory report a missing surface", () => {
    const mutated = cloneManifests(manifests);
    const knowledge = mutated.find((manifest) => manifest.id === "knowledge");
    if (!knowledge) throw new Error("knowledge manifest missing");
    knowledge.owns.skills = (knowledge.owns.skills ?? []).filter((id) => id !== "guild-learn");

    const result = validateModuleOwnership(inventory, mutated);
    expect(result.ok).toBe(false);
    expect(result.missing).toContainEqual(
      expect.objectContaining({ category: "skills", id: "guild-learn", owners: [] })
    );
  });

  it("CONTROL: adding a second owner reports a duplicate surface", () => {
    const mutated = cloneManifests(manifests);
    const context = mutated.find((manifest) => manifest.id === "context");
    if (!context) throw new Error("context manifest missing");
    context.owns.skills = [...(context.owns.skills ?? []), "guild-learn"];

    const result = validateModuleOwnership(inventory, mutated);
    expect(result.ok).toBe(false);
    expect(result.duplicate).toContainEqual(
      expect.objectContaining({
        category: "skills",
        id: "guild-learn",
        owners: ["context", "knowledge"],
      })
    );
  });

  it("CONTROL: removing a dependency makes an existing cross-module import fail the boundary rail", () => {
    const mutated = cloneManifests(manifests);
    const context = mutated.find((manifest) => manifest.id === "context");
    if (!context) throw new Error("context manifest missing");
    context.depends_on = (context.depends_on ?? []).filter((id) => id !== "knowledge");

    const result = validateModuleBoundaries(PLUGIN_ROOT, mutated);
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        importer: "src/modules/context/workflows/recall.ts",
        from_module: "context",
        to_module: "knowledge",
        reason: "undeclared_dependency",
      })
    );
  });

  it("CONTROL: declared dependencies still reject private cross-module workflow imports", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-module-boundary-"));
    try {
      fs.mkdirSync(path.join(tmp, "src/modules/a/workflows"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "src/modules/b/workflows"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/modules/a/index.ts"), "export * from './workflows/a';\n");
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/workflows/a.ts"),
        "import { b } from '../../b/workflows/b';\nexport const a = b;\n"
      );
      fs.writeFileSync(path.join(tmp, "src/modules/b/index.ts"), "export * from './workflows/b';\n");
      fs.writeFileSync(path.join(tmp, "src/modules/b/workflows/b.ts"), "export const b = 1;\n");

      const fixtureManifests: ModuleManifest[] = [
        {
          schema_version: "guild.module_manifest.v1",
          id: "a",
          title: "A",
          kind: "substrate",
          implementation_mode: "workflow-backed",
          description: "fixture",
          depends_on: ["b"],
          owns: {},
        },
        {
          schema_version: "guild.module_manifest.v1",
          id: "b",
          title: "B",
          kind: "substrate",
          implementation_mode: "workflow-backed",
          description: "fixture",
          owns: {},
        },
      ];

      const result = validateModuleBoundaries(tmp, fixtureManifests);
      expect(result.ok).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          importer: "src/modules/a/workflows/a.ts",
          imported: "src/modules/b/workflows/b.ts",
          from_module: "a",
          to_module: "b",
          reason: "private_import",
        })
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("CONTROL: export-from host-facing re-exports are detected once per importer/specifier", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-module-host-export-"));
    try {
      fs.mkdirSync(path.join(tmp, "src/modules/state/workflows"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "hooks/lib"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "src/modules/state/workflows/guild-root.ts"),
        [
          "export { findGuildRoot } from '../../../../hooks/lib/guild-root';",
          "export { requireGuildRoot } from '../../../../hooks/lib/guild-root';",
          "",
        ].join("\n")
      );
      fs.writeFileSync(path.join(tmp, "hooks/lib/guild-root.ts"), "export const findGuildRoot = 1;\n");

      const fixtureManifests: ModuleManifest[] = [
        {
          schema_version: "guild.module_manifest.v1",
          id: "state",
          title: "State",
          kind: "substrate",
          implementation_mode: "workflow-backed",
          description: "fixture",
          owns: {},
        },
      ];

      const result = validateModuleBoundaries(tmp, fixtureManifests);
      expect(result.violations).toEqual([
        expect.objectContaining({
          importer: "src/modules/state/workflows/guild-root.ts",
          imported: "hooks/lib/guild-root.ts",
          from_module: "state",
          to_module: "hooks",
          specifier: "../../../../hooks/lib/guild-root",
          reason: "host_facing_import",
        }),
      ]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it.each([
    ["reviewer side-effect import", 'import "../../../../hooks/lib/guild-root";', 1],
    ["reviewer commented import", '// import { x } from "../../../../hooks/lib/guild-root";', 0],
    ["import-from", 'import { x } from "../../../../hooks/lib/guild-root";', 1],
    ["type import-from", 'import type { X } from "../../../../hooks/lib/guild-root";', 1],
    ["export-from", 'export { x } from "../../../../hooks/lib/guild-root";', 1],
    ["type export-from", 'export type { X } from "../../../../hooks/lib/guild-root";', 1],
    ["literal dynamic import", 'const x = import("../../../../hooks/lib/guild-root");', 1],
    ["literal require", 'const x = require("../../../../hooks/lib/guild-root");', 1],
    [
      "literal require between numeric division operators",
      'const x = 2 / require("../../../../hooks/lib/guild-root") / 3;',
      1,
    ],
    [
      "literal require after a parenthesized division operand",
      'const x = (2) / require("../../../../hooks/lib/guild-root") / 3;',
      1,
    ],
    [
      "literal require after a string-valued division operand",
      'const x = "left" / require("../../../../hooks/lib/guild-root") / 3;',
      1,
    ],
    ["line comment", '// require("../../../../hooks/lib/guild-root");', 0],
    ["block comment", '/* import "../../../../hooks/lib/guild-root"; */', 0],
    ["ordinary string", 'const x = \'import "../../../../hooks/lib/guild-root"\';', 0],
    ["template text", 'const x = `import "../../../../hooks/lib/guild-root"`;', 0],
    [
      "cross-statement decoy",
      'import { x };\nconst from = "../../../../hooks/lib/guild-root";',
      0,
    ],
    [
      "semicolonless cross-statement decoy",
      'import { x }\nconst from = "../../../../hooks/lib/guild-root"',
      0,
    ],
    [
      "regular-expression literal decoys",
      [
        'const requirePattern = /require\\("\\.\\.\\/\\.\\.\\/\\.\\.\\/\\.\\.\\/hooks\\/lib\\/guild-root"\\)/;',
        'const importPattern = /import\\("\\.\\.\\/\\.\\.\\/\\.\\.\\/\\.\\.\\/hooks\\/lib\\/guild-root"\\)/;',
        'const exportPattern = /export .* from "\\.\\.\\/\\.\\.\\/\\.\\.\\/\\.\\.\\/hooks\\/lib\\/guild-root"/;',
      ].join("\n"),
      0,
    ],
    [
      "member-call decoys",
      [
        'loader.require("../../../../hooks/lib/guild-root");',
        'loader.import("../../../../hooks/lib/guild-root");',
      ].join("\n"),
      0,
    ],
    [
      "live import inside template interpolation",
      'const loaded = `${import("../../../../hooks/lib/guild-root")}`;',
      1,
    ],
    [
      "live import inside nested escaped template interpolation",
      'const loaded = `raw \\` ${`nested ${import("../../../../hooks/lib/guild-root")}`} tail`;',
      1,
    ],
    [
      "duplicate importer/specifier references",
      [
        'import "../../../../hooks/lib/guild-root";',
        'export { x } from "../../../../hooks/lib/guild-root";',
        'require("../../../../hooks/lib/guild-root");',
      ].join("\n"),
      1,
    ],
    [
      "non-literal dynamic and require expressions",
      [
        'const specifier = "../../../../hooks/lib/guild-root";',
        "void import(specifier);",
        "void require(specifier);",
      ].join("\n"),
      0,
    ],
  ])("CONTROL: dependency lexer handles %s", (_label, source, expectedCount) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-module-dependency-lexer-"));
    try {
      fs.mkdirSync(path.join(tmp, "src/modules/state/workflows"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "hooks/lib"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/modules/state/workflows/probe.ts"), `${source}\n`);
      fs.writeFileSync(path.join(tmp, "hooks/lib/guild-root.ts"), "export const x = 1;\n");

      const fixtureManifests: ModuleManifest[] = [
        {
          schema_version: "guild.module_manifest.v1",
          id: "state",
          title: "State",
          kind: "substrate",
          implementation_mode: "workflow-backed",
          description: "fixture",
          owns: {},
        },
      ];

      const hostFacing = validateModuleBoundaries(tmp, fixtureManifests).violations.filter(
        (item) => item.reason === "host_facing_import"
      );
      expect(hostFacing).toHaveLength(expectedCount);
      if (expectedCount === 1) {
        expect(hostFacing[0]).toEqual(
          expect.objectContaining({
            importer: "src/modules/state/workflows/probe.ts",
            imported: "hooks/lib/guild-root.ts",
            specifier: "../../../../hooks/lib/guild-root",
            reason: "host_facing_import",
          })
        );
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("CONTROL: the real state workflow re-export remains part of the 19-edge baseline", () => {
    const stateEdge = [...OBSERVED_HOST_FACING_EDGES, ...REMAINING_HOST_FACING_EDGES].filter(
      (edge) =>
        edge.importer === "src/modules/state/workflows/guild-root.ts" &&
        edge.specifier === "../../../../hooks/lib/guild-root"
    );
    expect(stateEdge).toHaveLength(1);
    expect(new Set([...OBSERVED_HOST_FACING_EDGES, ...REMAINING_HOST_FACING_EDGES].map(edgeKey)).size).toBe(19);
  });

  it("CONTROL: workflow modules without a public index fail the health rail", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-module-health-"));
    try {
      fs.mkdirSync(path.join(tmp, "src/modules/a/workflows"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "src/modules/a/resources"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/modules/a/workflows/a.ts"), "export const a = 1;\n");
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/resources/.generated-by-guild-module-resources"),
        "generated by test\n"
      );
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/resources/module-resources.json"),
        JSON.stringify(
          {
            schema_version: "guild.module_resources.v1",
            module_id: "a",
            generated_from: "guild.inventory.v1",
            entries: [],
          },
          null,
          2
        ) + "\n"
      );

      const fixtureManifests: ModuleManifest[] = [
        {
          schema_version: "guild.module_manifest.v1",
          id: "a",
          title: "A",
          kind: "substrate",
          implementation_mode: "workflow-backed",
          description: "fixture",
          owns: {},
        },
      ];

      const result = validateModuleHealth(tmp, fixtureManifests);
      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          module_id: "a",
          reason: "workflow_module_missing_public_index",
          path: "src/modules/a/index.ts",
        })
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("CONTROL: resource-only modules with workflows fail the health rail", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-module-resource-only-"));
    try {
      fs.mkdirSync(path.join(tmp, "src/modules/a/workflows"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "src/modules/a/resources"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/modules/a/index.ts"), "export * from './workflows/a';\n");
      fs.writeFileSync(path.join(tmp, "src/modules/a/workflows/a.ts"), "export const a = 1;\n");
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/resources/.generated-by-guild-module-resources"),
        "generated by test\n"
      );
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/resources/module-resources.json"),
        JSON.stringify(
          {
            schema_version: "guild.module_resources.v1",
            module_id: "a",
            generated_from: "guild.inventory.v1",
            entries: [],
          },
          null,
          2
        ) + "\n"
      );

      const fixtureManifests: ModuleManifest[] = [
        {
          schema_version: "guild.module_manifest.v1",
          id: "a",
          title: "A",
          kind: "substrate",
          implementation_mode: "resource-only",
          description: "fixture",
          owns: {},
        },
      ];

      const result = validateModuleHealth(tmp, fixtureManifests);
      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          module_id: "a",
          reason: "resource_only_module_has_workflows",
          path: "src/modules/a/workflows",
        })
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("CONTROL: workflow-backed modules without workflows fail the health rail", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-module-workflow-backed-"));
    try {
      fs.mkdirSync(path.join(tmp, "src/modules/a/resources"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/modules/a/index.ts"), "export const a = 1;\n");
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/resources/.generated-by-guild-module-resources"),
        "generated by test\n"
      );
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/resources/module-resources.json"),
        JSON.stringify(
          {
            schema_version: "guild.module_resources.v1",
            module_id: "a",
            generated_from: "guild.inventory.v1",
            entries: [],
          },
          null,
          2
        ) + "\n"
      );

      const fixtureManifests: ModuleManifest[] = [
        {
          schema_version: "guild.module_manifest.v1",
          id: "a",
          title: "A",
          kind: "substrate",
          implementation_mode: "workflow-backed",
          description: "fixture",
          owns: {},
        },
      ];

      const result = validateModuleHealth(tmp, fixtureManifests);
      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          module_id: "a",
          reason: "workflow_backed_module_has_no_workflows",
          path: "src/modules/a/workflows",
        })
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

/**
 * MH-07: modules must reach hosts through public module APIs, never by importing
 * a host-facing top-level mirror. These are the real-tree edges observed on this
 * base, so the boundary rail is pinned against the actual repository rather than
 * a synthetic fixture.
 */
interface HostFacingEdge {
  importer: string;
  specifier: string;
  imported: string;
  from_module: string;
  to_module: string;
}

const OBSERVED_HOST_FACING_EDGES: readonly HostFacingEdge[] = [
  {
    importer: "src/modules/context/workflows/recall-protect.ts",
    specifier: "../../../../hooks/lib/security/injection-guard",
    imported: "hooks/lib/security/injection-guard.ts",
    from_module: "context",
    to_module: "hooks",
  },
  {
    importer: "src/modules/context/workflows/recall.ts",
    specifier: "../../../../scripts/learn/lib/graph-query",
    imported: "scripts/learn/lib/graph-query.ts",
    from_module: "context",
    to_module: "scripts",
  },
  {
    importer: "src/modules/capability/workflows/role-resolver.ts",
    specifier: "../../../../scripts/lib/advisory-record",
    imported: "scripts/lib/advisory-record.ts",
    from_module: "capability",
    to_module: "scripts",
  },
  {
    importer: "src/modules/dispatch/workflows/task-assignment-v2.ts",
    specifier: "../../../../scripts/lib/core/contracts/task-cell-backend",
    imported: "scripts/lib/core/contracts/task-cell-backend.ts",
    from_module: "dispatch",
    to_module: "scripts",
  },
  {
    importer: "src/modules/dispatch/workflows/task-cell-acceptance.ts",
    specifier: "../../../../scripts/lib/core/contracts/task-cell-backend",
    imported: "scripts/lib/core/contracts/task-cell-backend.ts",
    from_module: "dispatch",
    to_module: "scripts",
  },
  {
    importer: "src/modules/distribution/workflows/result-contracts.ts",
    specifier: "../../../../hooks/lib/handoff-v2",
    imported: "hooks/lib/handoff-v2.ts",
    from_module: "distribution",
    to_module: "hooks",
  },
];

/**
 * The rest of the real-tree host-facing surface on this base. The dispatch
 * packet named only the six edges above; enumerating the remainder here keeps
 * the rail's true debt visible instead of letting it hide behind a short list.
 */
const REMAINING_HOST_FACING_EDGES: readonly HostFacingEdge[] = [
  {
    importer: "src/modules/communication/workflows/comms-format-lint.ts",
    specifier: "../../../../hooks/lib/handoff-v2",
    imported: "hooks/lib/handoff-v2.ts",
    from_module: "communication",
    to_module: "hooks",
  },
  {
    importer: "src/modules/docs-sync/workflows/wiki-lint-checks.ts",
    specifier: "../../../../scripts/dot-guild/convert/wiki-importance",
    imported: "scripts/dot-guild/convert/wiki-importance.ts",
    from_module: "docs-sync",
    to_module: "scripts",
  },
  {
    importer: "src/modules/docs-sync/workflows/wiki-lint-checks.ts",
    specifier: "../../../../scripts/learn/wiki-lint-knowledge",
    imported: "scripts/learn/wiki-lint-knowledge.ts",
    from_module: "docs-sync",
    to_module: "scripts",
  },
  {
    importer: "src/modules/docs-sync/workflows/wiki-lint-checks.ts",
    specifier: "../../../../scripts/learn/lib/schema",
    imported: "scripts/learn/lib/schema.ts",
    from_module: "docs-sync",
    to_module: "scripts",
  },
  {
    importer: "src/modules/lifecycle/workflows/emit-loop-event.ts",
    specifier: "../../../../hooks/lib/v1.4/log-jsonl.js",
    // no .ts candidate resolves for a ".js" specifier, so the validator keeps
    // the unresolved base path — still unambiguously a hooks/ mirror target.
    imported: "hooks/lib/v1.4/log-jsonl.js",
    from_module: "lifecycle",
    to_module: "hooks",
  },
  {
    importer: "src/modules/lifecycle/workflows/mark-lane-dead.ts",
    specifier: "../../../../hooks/lib/run-state",
    imported: "hooks/lib/run-state.ts",
    from_module: "lifecycle",
    to_module: "hooks",
  },
  {
    importer: "src/modules/lifecycle/workflows/resume-lanes.ts",
    specifier: "../../../../hooks/lib/run-state",
    imported: "hooks/lib/run-state.ts",
    from_module: "lifecycle",
    to_module: "hooks",
  },
  {
    importer: "src/modules/lifecycle/workflows/run-lifecycle.ts",
    specifier: "../../../../hooks/lib/security/scrubbed-write",
    imported: "hooks/lib/security/scrubbed-write.ts",
    from_module: "lifecycle",
    to_module: "hooks",
  },
  {
    importer: "src/modules/lifecycle/workflows/runstart-preflight.ts",
    specifier: "../../../../scripts/read-guild-config",
    imported: "scripts/read-guild-config.ts",
    from_module: "lifecycle",
    to_module: "scripts",
  },
  {
    importer: "src/modules/state/workflows/guild-root.ts",
    specifier: "../../../../hooks/lib/guild-root",
    imported: "hooks/lib/guild-root.ts",
    from_module: "state",
    to_module: "hooks",
  },
  {
    importer: "src/modules/teams/workflows/station-composer.ts",
    specifier: "../../../../scripts/lib/core/contracts/task-cell-backend",
    imported: "scripts/lib/core/contracts/task-cell-backend.ts",
    from_module: "teams",
    to_module: "scripts",
  },
  {
    importer: "src/modules/teams/workflows/station-composer.ts",
    specifier: "../../../../scripts/lib/roster",
    imported: "scripts/lib/roster.ts",
    from_module: "teams",
    to_module: "scripts",
  },
  {
    importer: "src/modules/teams/workflows/station-signals.ts",
    specifier: "../../../../scripts/lib/core/contracts/task-cell-backend",
    imported: "scripts/lib/core/contracts/task-cell-backend.ts",
    from_module: "teams",
    to_module: "scripts",
  },
];

function edgeKey(edge: { importer: string; specifier: string; imported: string }): string {
  return `${edge.importer} --${edge.specifier}--> ${edge.imported}`;
}

describe("module-to-host-facing mirror imports are rejected", () => {
  const manifests = loadModuleManifests(PLUGIN_ROOT);
  const result = moduleImpl.validateModuleBoundaries(PLUGIN_ROOT, manifests);
  const hostFacing = result.violations.filter((item) => item.reason === "host_facing_import");

  it.each([...OBSERVED_HOST_FACING_EDGES, ...REMAINING_HOST_FACING_EDGES])(
    "resolves $importer -> $specifier through a module-owned API",
    (edge) => {
      expect(
        hostFacing.find(
          (item) => item.importer === edge.importer && item.specifier === edge.specifier
        )
      ).toBeUndefined();
    }
  );

  it("resolves every observed host-facing edge to a real file in the mirror tree", () => {
    for (const edge of OBSERVED_HOST_FACING_EDGES) {
      expect(fs.existsSync(path.join(PLUGIN_ROOT, edge.imported))).toBe(true);
    }
  });

  it("pins the complete resolved host-facing surface, not just an exemplar", () => {
    const pinned = [...OBSERVED_HOST_FACING_EDGES, ...REMAINING_HOST_FACING_EDGES];
    expect(pinned).toHaveLength(19);
    expect(new Set(pinned.map(edgeKey)).size).toBe(19);
  });

  it("passes the boundary rail with no host-facing imports", () => {
    expect(hostFacing).toEqual([]);
    expect(result).toEqual({ ok: true, violations: [], errors: [] });
  });

  it("still renders a synthetic host-facing violation with module and mirror root", () => {
    const first = OBSERVED_HOST_FACING_EDGES[0];
    const rendered = moduleImpl.formatBoundaryValidation({
      ok: false,
      errors: [],
      violations: [{ ...first, reason: "host_facing_import" }],
    });
    expect(rendered).toContain(
      `BOUNDARY ${first.importer} imports host-facing ${first.imported} ` +
        `via ${JSON.stringify(first.specifier)}; ` +
        `module ${first.from_module} must not depend on the ${first.to_module}/ mirror`
    );
    // the undeclared-dependency wording must not be reused for this reason
    expect(rendered).not.toContain(`without ${first.from_module}.depends_on`);
  });
});
