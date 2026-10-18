/**
 * C3 — R-DECL compares PARSED YAML values, not raw scalar text. Two scalars
 * that differ only in quoting/escaping are the same value and stay GREEN; a
 * real value drift still turns the cross-check RED.
 */

import { describe, test, expect } from "bun:test";
import { crossCheck, extractManifestBlock, frontmatterValue } from "../../tests/rearch/r-decl";
import { validateSurfaceManifest } from "./surface-manifest";

/** Agent doc: frontmatter description written `fm`, manifest description written `mf`. */
function agentDoc(fm: string, mf: string): string {
  return [
    "---",
    "name: demo-agent",
    `description: ${fm}`,
    "model: opus",
    "surface_manifest:",
    "  schema_version: guild.surface_manifest.v1",
    "  kind: agent",
    "  name: demo-agent",
    `  description: ${mf}`,
    "  type: powerful",
    "---",
    "# demo-agent",
    "",
  ].join("\n");
}

function findings(doc: string) {
  const v = validateSurfaceManifest(extractManifestBlock(doc));
  expect(v.ok).toBe(true);
  return crossCheck(doc, v.manifest!, "demo-agent");
}

describe("C3 — R-DECL prose-≡ uses parsed YAML values", () => {
  test("double-quoted with \\\" escapes ≡ single-quoted with literal quotes", () => {
    expect(findings(agentDoc('"say \\"hi\\" now"', `'say "hi" now'`))).toEqual([]);
  });

  test("single-quoted '' escape ≡ double-quoted apostrophe", () => {
    expect(findings(agentDoc(`"the cell's lanes"`, `'the cell''s lanes'`))).toEqual([]);
  });

  test("plain scalar ≡ the same value quoted", () => {
    expect(findings(agentDoc("An agent.", '"An agent."'))).toEqual([]);
  });

  test("an escape that changes the parsed value is drift", () => {
    // single-quoted keeps the backslash literally: `say \"hi\"` ≠ `say "hi"`
    const f = findings(agentDoc('"say \\"hi\\" now"', `'say \\"hi\\" now'`));
    expect(f.some((x) => x.reason.includes("description"))).toBe(true);
  });

  test("a real value drift still fails", () => {
    const f = findings(agentDoc('"An agent."', '"A different agent."'));
    expect(f.some((x) => x.reason.includes("description"))).toBe(true);
  });

  test("YAML-hostile unquoted skill description is read as its literal plain value", () => {
    const doc = 'name: x\ndescription: Does a thing. Output: a table. TRIGGER: "do it".\n';
    expect(frontmatterValue(`---\n${doc}---\n`, "description")).toBe('Does a thing. Output: a table. TRIGGER: "do it".');
  });

  test("a malformed quoted frontmatter scalar does not match anything", () => {
    expect(frontmatterValue('---\nname: x\ndescription: "unterminated\n---\n', "description")).toBeUndefined();
  });
});
