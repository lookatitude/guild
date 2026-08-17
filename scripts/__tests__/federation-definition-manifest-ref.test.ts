import { FEDERATION_DEFINITION_MANIFEST_REF_SCHEMA, validateFederationDefinitionManifestRefV1 } from "../lib/core/contracts/federation-definition-manifest-ref";

const valid = {
  schema_version: FEDERATION_DEFINITION_MANIFEST_REF_SCHEMA,
  project_id: "plugin",
  manifest_path: ".guild/adoption-manifest.json",
  manifest_commitment: "a".repeat(64),
  source_commit: "b".repeat(40),
};

describe("federation definition-manifest reference", () => {
  it("binds a child project to one committed manifest without copying entries", () => {
    expect(validateFederationDefinitionManifestRefV1(valid)).toEqual(valid);
  });

  it.each([
    { ...valid, manifest_path: "/tmp/.guild/adoption-manifest.json" },
    { ...valid, manifest_path: ".guild/other.json" },
    { ...valid, manifest_commitment: "a".repeat(63) },
    { ...valid, extra: true },
  ])("rejects malformed or unbound references", (candidate) => {
    expect(validateFederationDefinitionManifestRefV1(candidate)).toBeNull();
  });

  it("rejects symbol-keyed extras", () => {
    const candidate = { ...valid, [Symbol("extra")]: true };
    expect(validateFederationDefinitionManifestRefV1(candidate)).toBeNull();
  });

  it("rejects accessors without invoking them and never throws", () => {
    let reads = 0;
    const candidate = { ...valid } as Record<string, unknown>;
    Object.defineProperty(candidate, "project_id", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("getter-fired");
      },
    });
    expect(() => validateFederationDefinitionManifestRefV1(candidate)).not.toThrow();
    expect(validateFederationDefinitionManifestRefV1(candidate)).toBeNull();
    expect(reads).toBe(0);
  });

  it("rejects proxies and exotic prototypes", () => {
    expect(validateFederationDefinitionManifestRefV1(new Proxy({ ...valid }, {}))).toBeNull();
    expect(
      validateFederationDefinitionManifestRefV1(Object.assign(Object.create({ inherited: true }), valid)),
    ).toBeNull();
  });

  it("returns a detached plain-data snapshot", () => {
    const candidate = { ...valid };
    const out = validateFederationDefinitionManifestRefV1(candidate);
    expect(out).toEqual(valid);
    expect(out).not.toBe(candidate);
    candidate.project_id = "website";
    expect(out?.project_id).toBe("plugin");
  });
});
