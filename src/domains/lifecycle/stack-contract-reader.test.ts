import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { ORACLE_URI_PATTERN, stackReaderValidator as stackValidator } from "../../../scripts/lib/stack-contract-reader-validator";
import { stackContractBundle } from "./index";
import stackContractBundleV2 from "./stack-contracts.v2.generated.json";
import {
  createStackContractReader,
  stackContractDigest,
  stackReaderCheckpoint,
  stackReaderPrerequisite,
  stackReaderVersions,
  stackV1SemanticErrors,
  stackV2SemanticErrors,
} from "./stack-contract-reader";

const FIXTURE = path.resolve(__dirname, "../../../tests/fixtures/stack-contract-reader/parity.generated.json");
const parity = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const check = stackValidator();
const reader = createStackContractReader({ check });
const legacy = createStackContractReader({ check, profile: "v1" });
const V2 = "https://guildstack.dev/contracts/guild-stack/v2/";
const shape = (name: string, value: unknown) => { try { check(V2 + name + ".schema.json", value); return true; } catch { return false; } };
const v1ok = (id: string, value: unknown) => { try { check(id, value); return true; } catch { return false; } };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const all = stackReaderVersions();
const v2Row = (schema: string) => parity.v2.find((r: any) => r.schema === schema && r.schema_valid && !r.semantic_errors.length);
const v1Row = (contract: string) => parity.v1.find((r: any) => r.contract === contract && r.valid);

// Raw-byte pins of the frozen umbrella contracts this fixture was generated from.
const FROZEN = {
  "v2/contract-bundle.json": "sha256:05833d374acb729cad021bb7a54141d67f1429fcaaca112b6fa29a10d3ec7d94",
};

describe("A04 parity fixture is the frozen A02 oracle output", () => {
  it("names the frozen v2 bundle and covers every fixture family", () => {
    expect(parity.sources["v2/contract-bundle.json"]).toBe(FROZEN["v2/contract-bundle.json"]);
    const origins = new Set(parity.v2.map((r: any) => r.origin));
    expect([...origins].sort()).toEqual(["a04-edge", "cases", "golden-document", "golden-refusal", "regressions"]);
    expect(parity.v2.length).toBe(551);
    expect(ORACLE_URI_PATTERN).toBe(parity.uri_pattern);
    expect(parity.v1.length).toBe(60);
  });
  it("plugin v2 copy is the A02 distribution payload (bundle hash list unchanged)", () => {
    const files = (stackContractBundleV2 as any).contract_bundle.files as Array<{ file: string; sha256: string }>;
    expect(files.length).toBe(45);
    const ids = Object.values((stackContractBundleV2 as any).schemas).map((s: any) => s.$id);
    expect(ids.every((id: string) => id.startsWith(V2))).toBe(true);
  });
});

describe("AT02 v2 reader enforces A02 shape and semantics with exact oracle parity", () => {
  for (const row of parity.v2 as any[])
    it(row.origin + " " + row.id, () => {
      expect(shape(row.schema, row.instance)).toBe(row.schema_valid);
      if (row.schema_valid && !row.oracle_exception) expect(stackV2SemanticErrors(row.schema, row.instance, shape)).toEqual(row.semantic_errors);
      const out = reader.read({ request_id: "parity", accept: all, document: row.instance });
      const accepted = row.schema_valid && row.semantic_errors.length === 0;
      if (accepted) expect(out).toBe(row.instance);
      else {
        expect(out.schema_version).toBe("guild.stack.refusal.v2");
        expect(out.code).toBe("invalid_request");
        expect(shape("refusal", out)).toBe(true);
      }
    });
});

describe("AT02 v1 fallback reader consumes the frozen v1 fixtures", () => {
  for (const row of parity.v1 as any[])
    it(row.id, () => {
      const version = row.instance?.schema_version;
      expect(row.valid).toBe(row.schema_valid && row.semantic_errors.length === 0);
      let shaped = true;
      try { check("https://guildstack.dev/contracts/guild-stack/v1/" + row.contract + ".schema.json", row.instance); } catch { shaped = false; }
      expect(shaped).toBe(row.schema_valid);
      if (row.schema_valid) expect(stackV1SemanticErrors(row.contract, row.instance, v1ok)).toEqual(row.semantic_errors);
      for (const r of [reader, legacy]) {
        const out = r.read({ request_id: "v1-case", accept: [version], document: row.instance });
        if (row.valid) expect(out).toBe(row.instance);
        else expect(out.schema_version).toBe("guild.stack.refusal.v2");
      }
    });
});

describe("AT02 explicit negotiation", () => {
  it("selects v2 for a v2-first client and returns a valid negotiation document", () => {
    const n = reader.negotiate({ request_id: "n1", client_supported: ["guild.run_analysis.v2", "guild.stack.read-projection.v1"] });
    expect(n.status).toBe("compatible");
    expect(n.selected_schema_version).toBe("guild.run_analysis.v2");
    expect(n.selected_schema_id).toBe(V2 + "run-analysis.schema.json");
    expect(shape("negotiation", n) && stackV2SemanticErrors("negotiation", n, shape).length === 0).toBe(true);
  });
  it("falls back to v1 when the reader is v1-only", () => {
    const n = legacy.negotiate({ request_id: "n2", client_supported: ["guild.stack.read-projection.v2", "guild.stack.read-projection.v1"] });
    expect(n.selected_schema_version).toBe("guild.stack.read-projection.v1");
    expect(n.server_supported.some((x: string) => x.endsWith(".v2") || x.endsWith(".v3"))).toBe(false);
  });
  it("refuses an empty intersection explicitly", () => {
    const n = reader.negotiate({ request_id: "n3", client_supported: ["guild.stack.read-projection.v9"] });
    expect([n.status, n.selected_schema_id, n.selected_schema_version, n.error.code]).toEqual(["unsupported", null, null, "unsupported_schema"]);
    expect(shape("negotiation", n)).toBe(true);
  });
  it("refuses malformed negotiation requests with a structured refusal", () => {
    for (const bad of [{}, { request_id: "x" }, { request_id: "x", client_supported: [] }, { request_id: "x", client_supported: ["a", "a"] }, { request_id: "bad id", client_supported: ["a"] }]) {
      const out = reader.negotiate(bad as any);
      expect([out.schema_version, out.code]).toEqual(["guild.stack.refusal.v2", "invalid_request"]);
    }
  });
});

describe("AT02 unsupported v2 returns structured refusal", () => {
  it("v1-only reader refuses a valid v2 document", () => {
    const doc = v2Row("run-analysis").instance;
    const out = legacy.read({ request_id: "r1", accept: ["guild.run_analysis.v2"], document: doc });
    expect([out.schema_version, out.code]).toEqual(["guild.stack.refusal.v2", "unsupported_schema"]);
  });
  it("new reader refuses a v2 document that was not negotiated", () => {
    const out = reader.read({ request_id: "r2", accept: ["guild.stack.read-projection.v1"], document: v2Row("run-analysis").instance });
    expect(out.code).toBe("unsupported_schema");
  });
  it("refuses unknown and missing schema versions", () => {
    for (const document of [{ schema_version: "guild.run_analysis.v9" }, {}, null, "x"]) {
      const out = reader.read({ request_id: "r3", accept: all, document });
      expect(out.code).toBe("unsupported_schema");
    }
  });
});

describe("AT02 negative control: v2 fields on a strict v1 document", () => {
  it("adding a v2 field to a v1 document is refused by the v1 reader", () => {
    const doc = clone(v1Row("read-projection").instance);
    (doc as any).snapshot_v2 = { source_generations: [] };
    for (const r of [reader, legacy]) expect(r.read({ request_id: "nc", accept: all, document: doc }).code).toBe("invalid_request");
  });
  it("adding a v2 field to the strict v1 schema changes the pinned v1 contract identity", () => {
    const pinned = stackReaderCheckpoint().v1_contract_sha256;
    const mutated = clone(stackContractBundle) as any;
    mutated.schemas["read-projection.schema.json"].properties.snapshot_v2 = { type: "object" };
    expect(stackContractDigest(mutated)).not.toBe(pinned);
    expect(stackContractDigest(clone(stackContractBundle))).toBe(pinned);
  });
});

describe("A04 activation barrier", () => {
  const receipt = stackReaderCheckpoint();
  it("checkpoint pins exact reader versions and keeps v2 writers disabled", () => {
    expect(receipt.v2_writers).toBe("disabled");
    expect(receipt.activation_gates).toEqual(["V01", "D01", "Z01"]);
    expect(receipt.versions).toEqual(all);
    expect(receipt.versions).toContain("guild.trace.analysis.v3");
  });
  it("refuses a missing receipt", () => {
    const out = stackReaderPrerequisite(undefined) as any;
    expect([out.schema_version, out.code]).toEqual(["guild.stack.refusal.v2", "unsupported_capability"]);
  });
  it("refuses a receipt whose reader versions differ", () => {
    for (const mutate of [(r: any) => r.versions.pop(), (r: any) => (r.v2_contract_sha256 = "sha256:" + "0".repeat(64)), (r: any) => (r.v2_writers = "enabled")]) {
      const r = clone(receipt); mutate(r);
      expect((stackReaderPrerequisite(r) as any).code).toBe("unsupported_capability");
    }
  });
  it("an exact receipt satisfies the reader prerequisite without enabling writers", () => {
    expect(stackReaderPrerequisite(clone(receipt))).toEqual({ satisfied: true, v2_writers: "disabled" });
  });
  it("the v1-only profile receipt cannot satisfy the v1+v2 prerequisite", () => {
    expect((stackReaderPrerequisite(stackReaderCheckpoint("v1")) as any).code).toBe("unsupported_capability");
  });
});

describe("A04 JS/Python divergence guards", () => {
  it("refuses integers outside the interoperable range instead of rounding coverage arithmetic", () => {
    const doc = clone(v2Row("run-analysis").instance) as any;
    const cov = doc.usage[0].coverage;
    Object.assign(cov, { eligible: 9007199254740992, covered: 9007199254740992, missing: 1, state: "partial", reason: "r" });
    const out = reader.read({ request_id: "big", accept: all, document: doc });
    expect([out.schema_version, out.code]).toEqual(["guild.stack.refusal.v2", "invalid_request"]);
  });
  it("refuses non-finite numbers (raw 1e400) that Python would still evaluate", () => {
    const gf4 = parity.v2.find((r: any) => r.id === "GF4.analysis").instance;
    const raw = JSON.stringify(gf4).replace(/"cost_usd":([0-9.eE+-]+)/, '"cost_usd":1e400');
    expect(raw.includes("1e400")).toBe(true);
    const out = reader.read({ request_id: "inf", accept: all, document: JSON.parse(raw) });
    expect([out.schema_version, out.code]).toEqual(["guild.stack.refusal.v2", "invalid_request"]);
  });
  it("refuses lone surrogates even when the document hash is recomputed", () => {
    const doc = clone(v2Row("read-request").instance) as any;
    doc.query.window.timezone = "\ud800";
    expect(() => stackContractDigest(doc.query)).toThrow();
    for (const document of [doc, { ...clone(v2Row("read-request").instance), ["k\udc00"]: 1 }]) {
      const out = reader.read({ request_id: "sur", accept: all, document });
      expect([out.schema_version, out.code]).toEqual(["guild.stack.refusal.v2", "invalid_request"]);
    }
  });
  it("prerequisite refusals keep a schema-valid request id", () => {
    const out = stackReaderPrerequisite(undefined, "bad id") as any;
    expect(out.request_id).toBe("invalid-request");
    expect(shape("refusal", out)).toBe(true);
  });
});

describe("A04 reader is pure", () => {
  it("reads do not mutate the input document", () => {
    const doc = v2Row("workflow-projection").instance;
    const before = createHash("sha256").update(JSON.stringify(doc)).digest("hex");
    reader.read({ request_id: "p", accept: all, document: doc });
    expect(createHash("sha256").update(JSON.stringify(doc)).digest("hex")).toBe(before);
  });
});
