/**
 * scripts/check-host-mcp-claims.test.ts
 *
 * ISSUE #116 — host entity wiki pages vs HOST_REGISTRY_ROWS[<id>].capabilities.mcp.
 * The registry row is authoritative. A page may not claim a transport the row
 * denies, and where the row's provenance is `inferred` the page must say
 * UNVERIFIED (structured `mcp:` block only; prose is never parsed). The last describe runs the checker over the real wiki tree, so
 * this file is also the CI rail.
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { checkHostMcpClaims, type McpRows } from "./check-host-mcp-claims";
import { HOST_REGISTRY_ROWS } from "./lib/host-registry-schema";

const ENTITIES = path.resolve(__dirname, "..", ".guild", "wiki", "entities");

function page(hostId: string, stdio: boolean, http: boolean, mcpRow: string, comment = ""): string {
  return [
    "---",
    "type: concept",
    "---",
    "# t",
    "```yaml",
    `host_id: "${hostId}"`,
    "mcp:",
    `  stdio: ${stdio}${comment}`,
    `  http: ${http}`,
    "```",
    `| (7) MCP | ${mcpRow} | - | n |`,
    "",
  ].join("\n");
}

function tmpDir(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mcpclaims-"));
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(d, n), c);
  return d;
}

const rows: McpRows = {
  "host-a": { mcp: { stdio: true, http: false }, provenance: "verified" },
  "host-b": { mcp: { stdio: false, http: false }, provenance: "inferred" },
};

describe("checkHostMcpClaims", () => {
  it("passes a page that matches a verified row", () => {
    const d = tmpDir({ "a.md": page("host-a", true, false, "stdio") });
    expect(checkHostMcpClaims({ entitiesDir: d, rows, aliases: {}, exempt: [] })).toEqual([]);
  });

  it("flags a transport the row denies", () => {
    const d = tmpDir({ "a.md": page("host-a", true, true, "stdio + HTTP") });
    const v = checkHostMcpClaims({ entitiesDir: d, rows, aliases: {}, exempt: [] });
    expect(v.map((x) => x.kind)).toEqual(["transport_mismatch"]);
    expect(v[0].detail).toContain("http");
  });

  it("flags a transport the row asserts but the page omits", () => {
    const d = tmpDir({ "a.md": page("host-a", false, false, "stdio") });
    expect(checkHostMcpClaims({ entitiesDir: d, rows, aliases: {}, exempt: [] }).map((x) => x.kind)).toEqual([
      "transport_mismatch",
    ]);
  });

  it("requires UNVERIFIED on a page backed by an inferred row", () => {
    const d = tmpDir({ "b.md": page("host-b", false, false, "none claimed") });
    expect(checkHostMcpClaims({ entitiesDir: d, rows, aliases: {}, exempt: [] }).map((x) => x.kind)).toEqual([
      "missing_unverified_label",
    ]);
  });

  it("accepts UNVERIFIED in the (7) MCP row for an inferred row", () => {
    const d = tmpDir({ "b.md": page("host-b", false, false, "UNVERIFIED (row inferred)") });
    expect(checkHostMcpClaims({ entitiesDir: d, rows, aliases: {}, exempt: [] })).toEqual([]);
  });

  it("does not parse prose: a hedged-or-not (7) row never fails by itself", () => {
    const d = tmpDir({ "a.md": page("host-a", true, false, "stdio + HTTP via config") });
    expect(checkHostMcpClaims({ entitiesDir: d, rows, aliases: {}, exempt: [] })).toEqual([]);
  });

  it("resolves page host_id through aliases", () => {
    const d = tmpDir({ "a.md": page("alias-a", true, false, "stdio") });
    expect(checkHostMcpClaims({ entitiesDir: d, rows, aliases: { "alias-a": "host-a" }, exempt: [] })).toEqual([]);
  });

  it("flags a host page with no registry row and no exemption", () => {
    const d = tmpDir({ "z.md": page("unknown", true, false, "stdio") });
    expect(checkHostMcpClaims({ entitiesDir: d, rows, aliases: {}, exempt: [] }).map((x) => x.kind)).toEqual([
      "unmapped_host",
    ]);
    expect(checkHostMcpClaims({ entitiesDir: d, rows, aliases: {}, exempt: ["unknown"] })).toEqual([]);
  });

  it("ignores pages without a host_id", () => {
    const d = tmpDir({ "n.md": "# not a host page\n" });
    expect(checkHostMcpClaims({ entitiesDir: d, rows, aliases: {}, exempt: [] })).toEqual([]);
  });
});

describe("the real host entity pages agree with the registry rows", () => {
  it("has no violations", () => {
    const v = checkHostMcpClaims({ entitiesDir: ENTITIES });
    expect(v.map((x) => `${x.file}: ${x.kind}: ${x.detail}`)).toEqual([]);
  });

  it("covers every host page that exists (sanity: the checker actually read pages)", () => {
    const withHostId = fs
      .readdirSync(ENTITIES)
      .filter((f) => /^host_id:/m.test(fs.readFileSync(path.join(ENTITIES, f), "utf8")));
    expect(withHostId.length).toBeGreaterThanOrEqual(9);
    expect(Object.keys(HOST_REGISTRY_ROWS).length).toBe(16);
  });
});
