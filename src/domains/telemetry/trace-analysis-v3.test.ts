/**
 * T01 · trace analysis v3 validator parity with the frozen A02 contract.
 *
 * The frozen checkout is read from A02_CONTRACT_ROOT, or from
 * <umbrella>/contracts/guild-stack/v2 next to the plugin. A plugin-only checkout
 * runs the vendored cases only; T01_REQUIRE_A02=1 makes the differential mandatory.
 */
import { describe, it, expect } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { TRACE_ANALYSIS_V3_SCHEMA, validateTraceAnalysisV3, validateTraceAnalysisV3Shape } from "./trace-analysis-v3";

const PLUGIN_ROOT = path.resolve(__dirname, "../../..");
const VENDORED = path.join(__dirname, "trace-analysis-v3.a02-cases.json");
const A02_ROOT = process.env["A02_CONTRACT_ROOT"] ?? path.resolve(PLUGIN_ROOT, "../contracts/guild-stack/v2");
const A02_PRESENT = fs.existsSync(path.join(A02_ROOT, "contract-bundle.json"));

interface VendoredCase { id: string; origin: "cases" | "regressions"; schema: string; valid: boolean; expected_errors: string[]; instance: Record<string, unknown> }
const vendored = JSON.parse(fs.readFileSync(VENDORED, "utf8")) as {
  source: { bundle_sha256: string; cases_sha256: string; regressions_sha256: string };
  schemas: string[];
  cases: VendoredCase[];
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const H = (c: string) => `sha256:${c.repeat(64)}`;
const valid = () => clone(vendored.cases.find((c) => c.id === "trace-analysis-valid")!.instance) as any;
const errorsOf = (v: unknown) => {
  const r = validateTraceAnalysisV3(v);
  return r.ok ? [] : r.errors;
};

describe("trace analysis v3 validator matches the frozen A02 contract", () => {
  it("vendored subset equals the frozen A02 fixtures (mandatory when T01_REQUIRE_A02=1)", () => {
    if (!A02_PRESENT) {
      expect(process.env["T01_REQUIRE_A02"]).not.toBe("1");
      return;
    }
    const sha = (p: string) => `sha256:${crypto.createHash("sha256").update(fs.readFileSync(path.join(A02_ROOT, p))).digest("hex")}`;
    expect(sha("contract-bundle.json")).toBe(vendored.source.bundle_sha256);
    expect(sha("fixtures/cases.json")).toBe(vendored.source.cases_sha256);
    expect(sha("fixtures/regressions.json")).toBe(vendored.source.regressions_sha256);
    const cases = JSON.parse(fs.readFileSync(path.join(A02_ROOT, "fixtures/cases.json"), "utf8")) as any[];
    const regs = JSON.parse(fs.readFileSync(path.join(A02_ROOT, "fixtures/regressions.json"), "utf8")).cases as any[];
    const derived = [
      ...cases.filter((c) => vendored.schemas.includes(c.schema)).map((c) => ({ id: c.id, origin: "cases", schema: c.schema, valid: c.valid, expected_errors: [], instance: c.instance })),
      ...regs.filter((c) => vendored.schemas.includes(c.schema)).map((c) => ({ id: c.id, origin: "regressions", schema: c.schema, valid: c.expected_valid, expected_errors: c.expected_errors, instance: c.instance })),
    ];
    expect(vendored.cases).toEqual(derived as VendoredCase[]);
  });

  for (const c of vendored.cases) {
    it(`${c.origin}:${c.id} → ${c.valid ? "valid" : "invalid"}`, () => {
      const verdict = validateTraceAnalysisV3(c.instance);
      expect(verdict.ok).toBe(c.valid);
      if (!verdict.ok) for (const e of c.expected_errors) expect(verdict.errors).toContain(e);
    });
  }

  it("structural validation agrees with the frozen JSON schema over a mutation corpus", () => {
    if (!A02_PRESENT) {
      expect(process.env["T01_REQUIRE_A02"]).not.toBe("1");
      return;
    }
    const req = createRequire(path.join(PLUGIN_ROOT, "scripts", "package.json"));
    const Ajv2020 = req("ajv/dist/2020").default;
    const addFormats = req("ajv-formats").default;
    const ajv = new Ajv2020({ strict: false, allErrors: false });
    addFormats(ajv);
    const dir = path.join(A02_ROOT, "schemas");
    for (const f of fs.readdirSync(dir)) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    const validate = ajv.getSchema("https://guildstack.dev/contracts/guild-stack/v2/trace-analysis.schema.json");
    expect(validate).toBeDefined();
    const leafValues: unknown[] = [null, 7, 1.5, -1, 0, true, "", "x", "😀".repeat(3000), "2026-02-30T00:00:00Z", H("a"), "../up", "USD", "run-1", [], {}];
    const mutate = (instance: any): unknown[] => {
      const out: unknown[] = [];
      const visit = (node: any, set: (v: unknown) => void, del: (() => void) | null) => {
        for (const v of leafValues) { set(v); out.push(clone(instance)); }
        if (del) { del(); out.push(clone(instance)); }
        set(node);
        if (Array.isArray(node)) node.forEach((x, i) => visit(x, (v) => { node[i] = v; }, null));
        else if (node && typeof node === "object") {
          for (const extra of ["zz_unknown", "constructor", "toString"]) { node[extra] = 1; out.push(clone(instance)); delete node[extra]; }
          for (const k of Object.keys(node)) {
            const keep = node[k];
            visit(keep, (v) => { node[k] = v; }, () => { delete node[k]; });
            node[k] = keep;
          }
        }
      };
      for (const k of Object.keys(instance)) {
        const keep = instance[k];
        visit(keep, (v) => { instance[k] = v; }, () => { delete instance[k]; });
        instance[k] = keep;
      }
      return out;
    };
    const mismatches: string[] = [];
    let compared = 0;
    for (const c of vendored.cases) {
      for (const m of [clone(c.instance), ...mutate(clone(c.instance))]) {
        compared++;
        const value = JSON.parse(JSON.stringify(m));
        const expected = validate(value) === true;
        const actual = validateTraceAnalysisV3Shape(value).ok;
        if (expected !== actual) mismatches.push(`${c.id}: ajv=${expected} t01=${actual} ${JSON.stringify(value).slice(0, 200)}`);
      }
    }
    expect(compared).toBeGreaterThan(1000);
    expect(mismatches).toEqual([]);
  });

  it("mirrors the verify_contracts trace-analysis and usage rules", () => {
    expect(valid().schema_version).toBe(TRACE_ANALYSIS_V3_SCHEMA);
    const req = valid();
    req.lineage.request_id = null;
    expect(errorsOf(req)).toContain("request event missing request id");
    const est = valid();
    est.observed_identity = { provider: null, model: null, status: "unavailable", reason: "provider did not report" };
    expect(errorsOf(est)).toContain("derived model pricing needs observed model, not requested fallback");
    const cache = valid();
    cache.usage.cache_read_subset = 101;
    expect(errorsOf(cache)).toContain("cache must be subset of inclusive input");
    const total = valid();
    total.usage.total = 160;
    expect(errorsOf(total)).toContain("total must be input plus output; cache is not additive");
    const owner = valid();
    owner.payload_ref.source_id = "source-b";
    expect(errorsOf(owner)).toContain("lineage-owned evidence recorded by another source");
    const cov = valid();
    cov.capture = { ...cov.capture, state: "partial", reason: null };
    expect(errorsOf(cov)).toContain("incomplete coverage needs reason");
    const att = valid();
    att.lineage.attempt_id = "attempt-1";
    expect(errorsOf(att)).toContain("attempt requires logical task");
    const sess = valid();
    sess.usage = { ...sess.usage, granularity: "native_session" };
    expect(errorsOf(sess)).toContain("session accounting cannot claim leaf semantics");
    const unk = valid();
    unk.interval.clock.basis = "unknown";
    expect(errorsOf(unk)).toContain("unknown clock cannot claim duration");
  });

  it("F7: native-session delta uses math.isclose tolerances (rel 1e-9, abs 1e-12)", () => {
    const v = valid();
    v.usage = {
      ...v.usage, granularity: "native_session", inclusion: "session_cumulative", usage_semantics: "provider_session_only.v1",
      input_inclusive: null, output: null, cache_read_subset: null, cache_write_subset: null, total: null,
      cost_basis: "native_estimate", pricing_version: null, native_baseline_usd: 0.1, native_cumulative_usd: 1.1, cost_usd: 1.0000000005,
    };
    expect(errorsOf(v)).not.toContain("session delta needs non-reset baseline");
    v.usage.cost_usd = 1.01;
    expect(errorsOf(v)).toContain("session delta needs non-reset baseline");
  });

  it("refuses non-JSON-safe values and own-property tricks", () => {
    const v = valid();
    expect(validateTraceAnalysisV3Shape(JSON.parse(JSON.stringify(v).replace("{", '{"constructor":1,'))).ok).toBe(false);
    expect(validateTraceAnalysisV3Shape({ ...v, sequence: Number.NaN }).ok).toBe(false);
    expect(validateTraceAnalysisV3Shape({ ...v, at: "2026-02-30T00:00:00Z" }).ok).toBe(false);
    expect(validateTraceAnalysisV3Shape(null).ok).toBe(false);
  });
});
