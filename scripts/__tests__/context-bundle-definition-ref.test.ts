import { createHash } from "node:crypto";
import { ADOPTION_MANIFEST_SCHEMA, type AdoptionManifestV1 } from "../lib/core/contracts/adoption-manifest";
import { PROJECT_DEFINITION_REF_SCHEMA, type ProjectDefinitionRefV1 } from "../lib/core/contracts/project-definition-ref";
import { resolveContextBundleDefinition } from "../lib/core/contracts/context-bundle-definition-ref";

const H = (c: string) => `sha256:${c.repeat(64)}`;
const ref: ProjectDefinitionRefV1 = {
  schema_version: PROJECT_DEFINITION_REF_SCHEMA,
  project_id: "plugin",
  layer: "project-guild",
  kind: "agent",
  id: "architect",
  relative_path: ".guild/agents/architect.md",
  content_hash: H("a"),
  source_commit: null,
  specialist_profile_hash: "b".repeat(64),
  specialist_type_hash: "c".repeat(64),
  skills: [],
};
const manifest: AdoptionManifestV1 = {
  schema_version: ADOPTION_MANIFEST_SCHEMA,
  project_id: "plugin",
  entries: [{
    sequence: 1,
    kind: "agent",
    from: { project_id: "plugin", id: "architect", historical_path: "/Users/miguel/project/.guild/agents/architect.md", content_hash: H("d"), home: "project-guild" },
    to: ref,
    reason: "migrated",
    detail: null,
    reverses_sequence: null,
    adopted_at: "2026-08-10T00:00:00Z",
    run_id: "run-context",
    authorized_by: "cap-loc-D09",
    prev_digest: null,
  }],
};

describe("context bundle definition resolution", () => {
  it("resolves an embedded validated ref", () => {
    const result = resolveContextBundleDefinition(`---\ndefinition_ref: ${JSON.stringify(ref)}\n---\n`, manifest);
    expect(result.status).toBe("resolved");
    expect(result.ref).toEqual(ref);
  });

  it("resolves one legacy absolute locator through the adoption manifest", () => {
    const legacy = "definition: /Users/miguel/project/.guild/agents/architect.md\n";
    const before = createHash("sha256").update(legacy).digest("hex");
    const result = resolveContextBundleDefinition(legacy, manifest);
    const after = createHash("sha256").update(legacy).digest("hex");
    expect(result.status).toBe("resolved");
    expect(result.ref).toEqual(ref);
    expect(after).toBe(before);
  });

  it("refuses multiple legacy locators rather than guessing", () => {
    const text = "definition: /Users/miguel/project/.guild/agents/architect.md\ndefinition: /Users/miguel/project/.guild/agents/qa.md\n";
    expect(resolveContextBundleDefinition(text, manifest).status).toBe("ambiguous");
  });

  it("does not fall back when an embedded ref is malformed", () => {
    const text = "definition_ref: {bad}\ndefinition: /Users/miguel/project/.guild/agents/architect.md\n";
    expect(resolveContextBundleDefinition(text, manifest).status).toBe("ambiguous");
  });
});
