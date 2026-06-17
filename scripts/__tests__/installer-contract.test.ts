/**
 * scripts/__tests__/installer-contract.test.ts
 *
 * TDD suite for scripts/lib/installer-contract.ts
 * P2 Wave-3 / SC-W3-4 / AC24 (step 19, PRE-CUTOVER) — installer contract + per-host
 * receipt model.
 * Contract (BY POINTER): .guild/spec/universal-host-p2-wave3.md SC-W3-4
 *
 * Coverage:
 *   - guild.install_receipt.v1: the four AC24 facets present + named, execution-ban
 *     markers (executed:false / side_effects:"none"), unsupported facets surfaced.
 *   - guild.installer_plan.v1: PLAN-ONLY + execution-ban markers, parity vs current
 *     canonical, per-host install + reconcile step descriptions, embedded receipt.
 *   - Validators FAIL CLOSED: bad discriminator, flipped execution-ban marker, missing
 *     facet, empty steps each rejected.
 *   - EXECUTION-BAN / ZERO SIDE EFFECT: building the plan over the REAL registry rows
 *     touches NO filesystem and asserts executed:false / side_effects:"none" everywhere.
 *   - Determinism: same input + same renderedAt → byte-identical output.
 *   - Parity over current canonical: the plan yields the expected receipt SHAPE per
 *     host row (claude native + no result_adapter; codex target + result_adapter; etc.).
 */

import {
  buildInstallReceipt,
  buildHostInstallerPlan,
  buildInstallerPlan,
  buildInstallSteps,
  buildReconcileSteps,
  deriveReceiptFacets,
  validateInstallReceipt,
  validateInstallerPlan,
  isInstallReceipt,
  isInstallerPlan,
  INSTALL_RECEIPT_SCHEMA,
  INSTALLER_PLAN_SCHEMA,
  RECEIPT_FACET_KEYS,
  type BuildOptions,
} from "../lib/installer-contract";
import {
  HOST_REGISTRY_ROWS,
  HOST_IDS,
  type HostId,
} from "../lib/host-registry-schema";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import * as child_process from "child_process";

const OPTS: BuildOptions = { renderedAt: "2026-06-17T00:00:00Z", sourceVersion: "2.0.0" };
const ALL_ROWS = HOST_IDS.map((id) => HOST_REGISTRY_ROWS[id as HostId]);

/** The committed CURRENT canonical package manifest (read once for the parity proof). */
const CANONICAL_MANIFEST_PATH = path.resolve(__dirname, "../../.claude-plugin/plugin.json");
const CANONICAL = JSON.parse(fs.readFileSync(CANONICAL_MANIFEST_PATH, "utf8")) as {
  name: string;
  version: string;
};

// ---------------------------------------------------------------------------
// Receipt — facets + execution-ban markers
// ---------------------------------------------------------------------------

describe("buildInstallReceipt", () => {
  it("emits all four named AC24 facets for every host row", () => {
    for (const entry of ALL_ROWS) {
      const r = buildInstallReceipt(entry, OPTS);
      for (const key of RECEIPT_FACET_KEYS) {
        expect(r.facets[key]).toBeDefined();
        expect(typeof r.facets[key].present).toBe("boolean");
        expect(r.facets[key].mechanism.length).toBeGreaterThan(0);
      }
      expect(r.schema_version).toBe(INSTALL_RECEIPT_SCHEMA);
    }
  });

  it("carries the execution-ban markers (executed:false / side_effects:'none')", () => {
    for (const entry of ALL_ROWS) {
      const r = buildInstallReceipt(entry, OPTS);
      expect(r.executed).toBe(false);
      expect(r.side_effects).toBe("none");
    }
  });

  it("derives provenance, host identity, and timestamps from the row + caller", () => {
    const codex = buildInstallReceipt(HOST_REGISTRY_ROWS["codex"], OPTS);
    expect(codex.host_id).toBe("codex");
    expect(codex.family).toBe("codex");
    expect(codex.installability).toBe("target");
    expect(codex.provenance).toBe("verified");
    expect(codex._rendered_at).toBe(OPTS.renderedAt);
    expect(codex._source_version).toBe(OPTS.sourceVersion);
  });

  it("surfaces an unsupported facet rather than silently omitting it (render-or-degrade)", () => {
    // Synthesize a row whose permissions express no posture at all.
    const base = HOST_REGISTRY_ROWS["claude"];
    const stripped = {
      ...base,
      result_adapter: false,
      capabilities: {
        ...base.capabilities,
        permissions: {
          ...base.capabilities.permissions,
          ask: false,
          deny: false,
          bypass_prompts: false,
        },
        structured_output: { native_json: false, schema_validation: false, repair_prompt: false },
      },
    };
    const r = buildInstallReceipt(stripped, OPTS);
    expect(r.facets.permission_mode.present).toBe(false);
    expect(r.facets.permission_mode.mechanism).toBe("none");
    expect(r.facets.result_normalization.present).toBe(false);
    const facetsFlagged = (r._unsupported ?? []).map((u) => u.facet);
    expect(facetsFlagged).toContain("permission_mode");
    expect(facetsFlagged).toContain("result_normalization");
  });
});

// ---------------------------------------------------------------------------
// Parity over the CURRENT canonical — expected receipt shape per host row
// ---------------------------------------------------------------------------

describe("parity over current canonical — per-host receipt shape", () => {
  it("claude: native install, no result-normalization adapter (reference author host)", () => {
    const r = buildInstallReceipt(HOST_REGISTRY_ROWS["claude"], OPTS);
    expect(r.installability).toBe("native");
    // Claude has result_adapter:false but ships native skill autoload + ask permissions.
    expect(r.facets.bootstrap_context.present).toBe(true);
    expect(r.facets.bootstrap_context.mechanism).toContain("skill_autoload");
    expect(r.facets.permission_mode.present).toBe(true);
  });

  it("codex: target install, result_adapter drives result-normalization", () => {
    const r = buildInstallReceipt(HOST_REGISTRY_ROWS["codex"], OPTS);
    expect(r.installability).toBe("target");
    expect(r.facets.result_normalization.present).toBe(true);
    expect(r.facets.result_normalization.mechanism).toBe("result_adapter");
    expect(r.facets.bootstrap_context.mechanism).toBe("instruction_file");
  });

  it(".agents: file surface, target install", () => {
    const r = buildInstallReceipt(HOST_REGISTRY_ROWS[".agents"], OPTS);
    expect(r.surface_kind).toBe("file");
    expect(r.installability).toBe("target");
    expect(r.provenance).toBe("inferred");
  });

  it("antigravity: bypass permission posture surfaces as permission_mode 'bypass'", () => {
    const r = buildInstallReceipt(HOST_REGISTRY_ROWS["antigravity"], OPTS);
    expect(r.facets.permission_mode.present).toBe(true);
    expect(r.facets.permission_mode.mechanism).toBe("bypass");
  });

  it("pi: native_json structured output drives result-normalization mechanism", () => {
    const r = buildInstallReceipt(HOST_REGISTRY_ROWS["pi"], OPTS);
    expect(r.facets.result_normalization.present).toBe(true);
    // pi has result_adapter:false but native_json:true.
    expect(r.facets.result_normalization.mechanism).toBe("native_json");
  });
});

// ---------------------------------------------------------------------------
// Step descriptions
// ---------------------------------------------------------------------------

describe("step descriptions", () => {
  it("install steps are ordered, non-empty, and end with emit-receipt", () => {
    for (const entry of ALL_ROWS) {
      const steps = buildInstallSteps(entry);
      expect(steps.length).toBeGreaterThan(0);
      steps.forEach((s, i) => expect(s.order).toBe(i + 1));
      expect(steps[steps.length - 1].id).toBe("emit-receipt");
    }
  });

  it("reconcile steps describe check → sync → repair → re-emit and never weaken security", () => {
    const steps = buildReconcileSteps(HOST_REGISTRY_ROWS["claude"]);
    const ids = steps.map((s) => s.id);
    expect(ids).toEqual(["reconcile-check", "reconcile-sync", "reconcile-repair", "re-emit-receipt"]);
    expect(steps[0].writes).toBe(false); // check is read-only
    expect(steps.find((s) => s.id === "reconcile-repair")!.description).toMatch(/fail CLOSED/i);
  });

  it("a host with installability 'none' offers no stage/render steps", () => {
    const base = HOST_REGISTRY_ROWS["pi"];
    const none = { ...base, installability: "none" as const };
    const steps = buildInstallSteps(none);
    const ids = steps.map((s) => s.id);
    expect(ids).not.toContain("stage-package");
    expect(ids).toContain("verify-installability");
    expect(ids[ids.length - 1]).toBe("emit-receipt");
  });
});

// ---------------------------------------------------------------------------
// Plan — execution-ban + parity markers
// ---------------------------------------------------------------------------

describe("buildInstallerPlan", () => {
  it("is PLAN-ONLY + execution-banned + parity vs current canonical", () => {
    const plan = buildInstallerPlan(ALL_ROWS, OPTS);
    expect(plan.schema_version).toBe(INSTALLER_PLAN_SCHEMA);
    expect(plan.mode).toBe("plan");
    expect(plan.executed).toBe(false);
    expect(plan.side_effects).toBe("none");
    expect(plan.parity_target).toBe("current-canonical");
    expect(plan.hosts.length).toBe(ALL_ROWS.length);
  });

  it("every embedded host receipt is itself execution-banned", () => {
    const plan = buildInstallerPlan(ALL_ROWS, OPTS);
    for (const h of plan.hosts) {
      expect(h.receipt.executed).toBe(false);
      expect(h.receipt.side_effects).toBe("none");
      expect(h.install_steps.length).toBeGreaterThan(0);
      expect(h.reconcile_steps.length).toBeGreaterThan(0);
    }
  });

  it("per-host plan mirrors the row identity", () => {
    const h = buildHostInstallerPlan(HOST_REGISTRY_ROWS["codex"], OPTS);
    expect(h.host_id).toBe("codex");
    expect(h.family).toBe("codex");
    expect(h.installability).toBe("target");
  });
});

// ---------------------------------------------------------------------------
// Validators — fail closed
// ---------------------------------------------------------------------------

describe("validateInstallReceipt — fail closed", () => {
  it("accepts a built receipt", () => {
    for (const entry of ALL_ROWS) {
      const res = validateInstallReceipt(buildInstallReceipt(entry, OPTS));
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual([]);
    }
  });

  it("rejects a flipped execution-ban marker (executed:true)", () => {
    const r = { ...buildInstallReceipt(HOST_REGISTRY_ROWS["claude"], OPTS), executed: true };
    const res = validateInstallReceipt(r);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/executed must be the literal false/);
  });

  it("rejects side_effects other than 'none'", () => {
    const r = { ...buildInstallReceipt(HOST_REGISTRY_ROWS["claude"], OPTS), side_effects: "wrote-files" };
    expect(validateInstallReceipt(r).valid).toBe(false);
  });

  it("rejects a receipt missing an AC24 facet", () => {
    const good = buildInstallReceipt(HOST_REGISTRY_ROWS["claude"], OPTS);
    const facets = { ...good.facets } as Record<string, unknown>;
    delete facets["permission_mode"];
    const res = validateInstallReceipt({ ...good, facets });
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/facets\.permission_mode is required/);
  });

  it("rejects a wrong schema_version and non-object input", () => {
    expect(validateInstallReceipt({ ...buildInstallReceipt(HOST_REGISTRY_ROWS["claude"], OPTS), schema_version: "x" }).valid).toBe(false);
    expect(validateInstallReceipt(null).valid).toBe(false);
    expect(validateInstallReceipt([]).valid).toBe(false);
  });
});

describe("validateInstallerPlan — fail closed", () => {
  it("accepts a built plan", () => {
    const res = validateInstallerPlan(buildInstallerPlan(ALL_ROWS, OPTS));
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("rejects mode other than 'plan'", () => {
    const p = { ...buildInstallerPlan(ALL_ROWS, OPTS), mode: "execute" };
    const res = validateInstallerPlan(p);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/mode must be the literal "plan"/);
  });

  it("rejects a wrong parity_target (would signal a new install channel)", () => {
    const p = { ...buildInstallerPlan(ALL_ROWS, OPTS), parity_target: "new-channel" };
    expect(validateInstallerPlan(p).valid).toBe(false);
  });

  it("rejects a host plan with empty install steps", () => {
    const p = buildInstallerPlan(ALL_ROWS, OPTS);
    const broken = { ...p, hosts: [{ ...p.hosts[0], install_steps: [] }] };
    const res = validateInstallerPlan(broken);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/install_steps must be non-empty/);
  });

  it("propagates an embedded receipt failure", () => {
    const p = buildInstallerPlan(ALL_ROWS, OPTS);
    const broken = { ...p, hosts: [{ ...p.hosts[0], receipt: { ...p.hosts[0].receipt, executed: true } }] };
    const res = validateInstallerPlan(broken);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/receipt\..*executed/);
  });
});

describe("type guards", () => {
  it("isInstallReceipt / isInstallerPlan narrow on valid built artifacts", () => {
    expect(isInstallReceipt(buildInstallReceipt(HOST_REGISTRY_ROWS["pi"], OPTS))).toBe(true);
    expect(isInstallerPlan(buildInstallerPlan(ALL_ROWS, OPTS))).toBe(true);
    expect(isInstallReceipt({})).toBe(false);
    expect(isInstallerPlan({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism + zero side effect
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("same input + same renderedAt → byte-identical output", () => {
    const a = buildInstallerPlan(ALL_ROWS, OPTS);
    const b = buildInstallerPlan(ALL_ROWS, OPTS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("deriveReceiptFacets is pure (no mutation of the input row)", () => {
    const entry = HOST_REGISTRY_ROWS["antigravity"];
    const before = JSON.stringify(entry);
    deriveReceiptFacets(entry);
    buildInstallerPlan(ALL_ROWS, OPTS);
    expect(JSON.stringify(entry)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// FIX 3 — execution-ban is REAL, not a comment proxy: spy on process exec + fs
// write and assert NOT called while the whole plan is built. Fails if execution
// were ever added.
// ---------------------------------------------------------------------------

describe("execution-ban (F-1) — no process exec, no fs write while building", () => {
  it("invokes NONE of child_process exec* / fs write* during plan + receipt + step builds", () => {
    const noop: any = () => undefined;
    const asyncNoop: any = () => Promise.resolve();
    const spies = [
      jest.spyOn(child_process, "execSync").mockImplementation((() => Buffer.from("")) as any),
      jest.spyOn(child_process, "spawnSync").mockImplementation((() => ({ status: 0 })) as any),
      jest.spyOn(child_process, "exec").mockImplementation((() => ({})) as any),
      jest.spyOn(child_process, "spawn").mockImplementation((() => ({})) as any),
      jest.spyOn(fs, "writeFileSync").mockImplementation(noop),
      jest.spyOn(fs, "writeFile").mockImplementation(noop), // async (callback)
      jest.spyOn(fs, "appendFile").mockImplementation(noop), // async (callback)
      jest.spyOn(fs, "appendFileSync").mockImplementation(noop),
      jest.spyOn(fs, "mkdirSync").mockImplementation(noop),
      jest.spyOn(fs, "cpSync").mockImplementation(noop),
      jest.spyOn(fs, "renameSync").mockImplementation(noop),
      jest.spyOn(fs, "rmSync").mockImplementation(noop),
      jest.spyOn(fsp, "writeFile").mockImplementation(asyncNoop), // fs/promises
      jest.spyOn(fsp, "appendFile").mockImplementation(asyncNoop), // fs/promises
    ];
    try {
      const plan = buildInstallerPlan(ALL_ROWS, OPTS);
      for (const entry of ALL_ROWS) {
        buildInstallReceipt(entry, OPTS);
        buildInstallSteps(entry);
        buildReconcileSteps(entry);
      }
      // Validating also must not shell out / write.
      validateInstallerPlan(plan);
      for (const s of spies) expect(s).not.toHaveBeenCalled();
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// FIX 4 — parity is PROVEN structurally against the CURRENT canonical package on
// disk (committed .claude-plugin/plugin.json), not just a string marker.
// ---------------------------------------------------------------------------

describe("parity-proven against the CURRENT canonical package (structural, on-disk)", () => {
  it("the committed canonical manifest exists and is the claude-plugin package", () => {
    expect(fs.existsSync(CANONICAL_MANIFEST_PATH)).toBe(true);
    expect(typeof CANONICAL.name).toBe("string");
    expect(CANONICAL.name.length).toBeGreaterThan(0);
    expect(typeof CANONICAL.version).toBe("string");
  });

  it("the plan's single NATIVE host is exactly the on-disk canonical (claude / claude-plugin)", () => {
    const plan = buildInstallerPlan(ALL_ROWS, { renderedAt: OPTS.renderedAt, sourceVersion: CANONICAL.version });
    const native = plan.hosts.filter((h) => h.installability === "native");
    // The current canonical package IS the Claude package — exactly one native host.
    expect(native.map((h) => h.host_id)).toEqual(["claude"]);
    // Its referenced manifest_format must match the canonical claude-plugin format on disk.
    expect(native[0].manifest_format).toBe("claude-plugin");
    // The canonical .claude-plugin directory the "claude-plugin" format names must exist.
    expect(fs.existsSync(path.resolve(__dirname, "../../.claude-plugin"))).toBe(true);
    // The native host's stage-package step must reference that same manifest format.
    const stage = native[0].install_steps.find((s) => s.id === "stage-package");
    expect(stage).toBeDefined();
    expect(stage!.description).toContain("claude-plugin");
  });

  it("the native host receipt carries the CURRENT canonical version (parity wiring, not a literal)", () => {
    const plan = buildInstallerPlan(ALL_ROWS, { renderedAt: OPTS.renderedAt, sourceVersion: CANONICAL.version });
    const native = plan.hosts.find((h) => h.installability === "native")!;
    expect(native.receipt._source_version).toBe(CANONICAL.version);
  });

  it("no plan host claims a manifest_format the registry row does not declare (no drift vs source)", () => {
    const plan = buildInstallerPlan(ALL_ROWS, OPTS);
    for (const h of plan.hosts) {
      const row = HOST_REGISTRY_ROWS[h.host_id as HostId];
      expect(h.manifest_format).toBe(row.capabilities.package.manifest_format);
    }
  });
});

// ---------------------------------------------------------------------------
// FIX 1 — strict unknown-key rejection at EVERY object level.
// ---------------------------------------------------------------------------

describe("strict unknown-key rejection (FIX 1)", () => {
  it("rejects an unknown top-level receipt key", () => {
    const r = { ...buildInstallReceipt(HOST_REGISTRY_ROWS["claude"], OPTS), sneaky: 1 };
    const res = validateInstallReceipt(r);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/unknown key "sneaky"/);
  });

  it("rejects an unknown key inside a facet", () => {
    const good = buildInstallReceipt(HOST_REGISTRY_ROWS["claude"], OPTS);
    const facets = { ...good.facets, bootstrap_context: { ...good.facets.bootstrap_context, extra: true } };
    const res = validateInstallReceipt({ ...good, facets });
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/facets\.bootstrap_context: unknown key "extra"/);
  });

  it("rejects an unknown key inside an _unsupported entry", () => {
    const base = HOST_REGISTRY_ROWS["claude"];
    const stripped = {
      ...base,
      capabilities: {
        ...base.capabilities,
        permissions: { ...base.capabilities.permissions, ask: false, deny: false, bypass_prompts: false },
      },
    };
    const r = buildInstallReceipt(stripped, OPTS);
    expect(r._unsupported && r._unsupported.length).toBeGreaterThan(0);
    const tampered = { ...r, _unsupported: r._unsupported!.map((u) => ({ ...u, oops: 1 })) };
    const res = validateInstallReceipt(tampered);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/_unsupported\[0\]: unknown key "oops"/);
  });

  it("rejects an unknown key on a host plan and on a step", () => {
    const plan = buildInstallerPlan(ALL_ROWS, OPTS);
    const badHost = { ...plan, hosts: [{ ...plan.hosts[0], rogue: true }] };
    expect(validateInstallerPlan(badHost).errors.join(" ")).toMatch(/hosts\[0\]: unknown key "rogue"/);

    const badStep = {
      ...plan,
      hosts: [{ ...plan.hosts[0], install_steps: [{ ...plan.hosts[0].install_steps[0], extra: 1 }] }],
    };
    expect(validateInstallerPlan(badStep).errors.join(" ")).toMatch(/install_steps\[0\]: unknown key "extra"/);
  });

  it("rejects an unknown top-level plan key", () => {
    const plan = { ...buildInstallerPlan(ALL_ROWS, OPTS), channel: "dist" };
    const res = validateInstallerPlan(plan);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/plan: unknown key "channel"/);
  });

  it("rejects a NON-ENUMERABLE smuggled key (Object.keys would miss it)", () => {
    const r: any = { ...buildInstallReceipt(HOST_REGISTRY_ROWS["claude"], OPTS) };
    Object.defineProperty(r, "sneaky", { enumerable: false, value: 1, configurable: true });
    // Sanity: Object.keys does NOT see it — proving the bypass the fix closes.
    expect(Object.keys(r)).not.toContain("sneaky");
    const res = validateInstallReceipt(r);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/unknown key "sneaky"/);
  });

  it("rejects a symbol own-key", () => {
    const r: any = { ...buildInstallReceipt(HOST_REGISTRY_ROWS["claude"], OPTS) };
    r[Symbol("smuggled")] = 1;
    const res = validateInstallReceipt(r);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/unknown key .*not permitted/);
  });
});

// ---------------------------------------------------------------------------
// FIX 2 — validators NEVER throw on hostile input (throwing getter / Proxy trap /
// toString-that-throws). The 'Never throws' contract is now PROVEN.
// ---------------------------------------------------------------------------

describe("hostile-input no-throw (FIX 2)", () => {
  it("a throwing getter on the receipt yields {valid:false} and does not throw", () => {
    const hostile: any = { ...buildInstallReceipt(HOST_REGISTRY_ROWS["claude"], OPTS) };
    Object.defineProperty(hostile, "schema_version", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    let res!: ReturnType<typeof validateInstallReceipt>;
    expect(() => {
      res = validateInstallReceipt(hostile);
    }).not.toThrow();
    expect(res.valid).toBe(false);
  });

  it("a value whose toJSON()/toString() throws does not break stringification", () => {
    const landmine = {
      toJSON() {
        throw new Error("toJSON boom");
      },
      toString() {
        throw new Error("toString boom");
      },
    };
    const hostile: any = { ...buildInstallReceipt(HOST_REGISTRY_ROWS["claude"], OPTS), schema_version: landmine };
    let res!: ReturnType<typeof validateInstallReceipt>;
    expect(() => {
      res = validateInstallReceipt(hostile);
    }).not.toThrow();
    expect(res.valid).toBe(false);
  });

  it("a Proxy with a throwing ownKeys trap yields {valid:false} and does not throw", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("ownKeys boom");
        },
        get() {
          throw new Error("get boom");
        },
      }
    );
    let res!: ReturnType<typeof validateInstallerPlan>;
    expect(() => {
      res = validateInstallerPlan(hostile);
    }).not.toThrow();
    expect(res.valid).toBe(false);
  });

  it("a throwing getter deep in a host plan does not throw the plan validator", () => {
    const plan: any = buildInstallerPlan(ALL_ROWS, OPTS);
    const host = { ...plan.hosts[0] };
    Object.defineProperty(host, "manifest_format", {
      enumerable: true,
      get() {
        throw new Error("deep boom");
      },
    });
    const hostile = { ...plan, hosts: [host] };
    let res!: ReturnType<typeof validateInstallerPlan>;
    expect(() => {
      res = validateInstallerPlan(hostile);
    }).not.toThrow();
    expect(res.valid).toBe(false);
  });
});
