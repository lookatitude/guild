/**
 * tests/universal-host/new-cli-renderer.test.ts
 *
 * verified-multi-host-support L3 — the shared wrapped-CLI renderer base (AC-PKG-3).
 *
 * Real-path wiring (not an injected seam): imports through the SHIPPED shim
 * scripts/lib/per-host-packaging.ts and grounds every host fact in the REAL L1
 * registry rows (scripts/lib/host-registry-schema.ts). Proves:
 *   - ONE shared renderer (renderWrappedCliPackage) emits all 4 new-CLI packages,
 *     each self-identifying via the registry row's manifest_format (no copy-paste),
 *   - R1: a rendered manifest is never support — installability "target",
 *     _provenance "inferred",
 *   - render-or-degrade: native agents / hooks / MCP land in _unsupported,
 *   - IDE hosts (kiro/qoder/trae) carry NO per-host renderer — they dereference the
 *     agents-file renderer via adapter_binding (AC-REG-4 / AC-ADP-1).
 */

import {
  renderWrappedCliPackage,
  type GuildPluginManifest,
} from "../../scripts/lib/per-host-packaging";
import { HOST_REGISTRY_ROWS } from "../../scripts/lib/host-registry-schema";

const NEW_CLI_HOST_IDS = ["cursor", "github-copilot", "opencode", "rovo-dev"] as const;
const IDE_HOST_IDS = ["kiro", "qoder", "trae"] as const;

const MANIFEST: GuildPluginManifest = {
  name: "guild",
  version: "2.0.0",
  description: "Guild",
  commands: ["./commands/plan.md", "./commands/build.md"],
  skills: ["./skills/core/", "./skills/meta/"],
  agents: ["./agents/architect.md"],
  mcpServers: [{ id: "guild-memory", transport: "stdio" }],
  hooks: [{ event: "SessionStart", script: "hooks/bootstrap.sh" }],
};

function specFor(hostId: (typeof NEW_CLI_HOST_IDS)[number]) {
  const row = HOST_REGISTRY_ROWS[hostId];
  return {
    hostId: row.host_id,
    schemaVersion: row.capabilities.package.manifest_format,
    agentsSkillRoot: ".agents/skills/guild",
    launcher: "bin/guild-run",
    provenance: row.provenance,
  };
}

describe("shared wrapped-CLI renderer base (AC-PKG-3)", () => {
  test.each(NEW_CLI_HOST_IDS)("%s renders on the shared base, grounded in its registry row", (hostId) => {
    const pkg = renderWrappedCliPackage(MANIFEST, { renderedAt: "2026-07-04" }, specFor(hostId));

    // Self-identifying from the registry row's manifest_format (= "<host>-package").
    expect(pkg.schema_version).toBe(HOST_REGISTRY_ROWS[hostId].capabilities.package.manifest_format);
    expect(pkg.schema_version).toBe(`${hostId}-package`);
    expect(pkg.host_id).toBe(hostId);

    // R1 — renderer ≠ support. Derived from the row's own provenance (audit fix:
    // this used to be a hardcoded "inferred" literal in the renderer). Since
    // issue #110, the four rows are no longer uniform: github-copilot + opencode
    // are live-verified, cursor + rovo-dev remain inferred — assert row-grounding
    // against each host's OWN value, plus the current expected split.
    expect(pkg.installability).toBe("target");
    expect(pkg._provenance).toBe(HOST_REGISTRY_ROWS[hostId].provenance);
    expect(pkg._provenance).toBe(
      hostId === "github-copilot" || hostId === "opencode" ? "verified" : "inferred"
    );

    // Packaging contract (L2 adapter surface) + 11th concern.
    expect(pkg.agents_skill_root).toBe(".agents/skills/guild");
    expect(pkg.launcher).toBe("bin/guild-run");

    // Extension body — commands as descriptors (name-only: commands/*.md never ships
    // in a wrapped-CLI package), skills remapped under the package's skill-tree root
    // (audit fix — both used to be Claude-shaped paths resolving to nothing).
    expect(pkg.commands?.map((c) => c.name).sort()).toEqual(["build", "plan"]);
    expect(pkg.commands?.every((c) => c.source_path === undefined)).toBe(true);
    expect(pkg.skills).toEqual([".agents/skills/guild/core/", ".agents/skills/guild/meta/"]);

    // render-or-degrade: native agents / hooks / MCP flagged, never silently dropped.
    const unsupportedFields = (pkg._unsupported ?? []).map((u) => u.field);
    expect(unsupportedFields).toContain("agents");
    expect(unsupportedFields).toContain("hooks");
    expect(unsupportedFields).toContain("commands[].source_path");
    expect(unsupportedFields.some((f) => f.startsWith("mcpServers"))).toBe(true);
  });

  test("all 4 new-CLI hosts share ONE renderer, differing only by registry spec (no copy-paste)", () => {
    const schemas = NEW_CLI_HOST_IDS.map(
      (h) => renderWrappedCliPackage(MANIFEST, { renderedAt: "2026-07-04" }, specFor(h)).schema_version
    );
    // Distinct, self-identifying, registry-derived — same function, different row.
    expect(new Set(schemas).size).toBe(NEW_CLI_HOST_IDS.length);
    expect(schemas).toEqual(["cursor-package", "github-copilot-package", "opencode-package", "rovo-dev-package"]);
  });

  test("IDE hosts dereference agents-file (no per-host renderer/adapter)", () => {
    for (const ide of IDE_HOST_IDS) {
      expect(HOST_REGISTRY_ROWS[ide].adapter_binding).toBe("agents-file");
    }
  });

  test("clean manifest (no agents/hooks/mcp) → no _unsupported", () => {
    const lean: GuildPluginManifest = { name: "guild", version: "2.0.0", description: "d", commands: [], skills: [] };
    const pkg = renderWrappedCliPackage(lean, { renderedAt: "2026-07-04" }, specFor("cursor"));
    expect(pkg._unsupported).toBeUndefined();
  });
});
