/**
 * tests/universal-host/p2-w3-sc4-installer-contract.test.ts
 *
 * AUTHORITATIVE cross-cutting acceptance test for SC-W3-4 (ADR step 19 PRE-CUTOVER / AC24 —
 * multi-host installer contract + per-host receipt model, EXECUTION-BANNED).
 *
 * Binding assertions (anti-vacuity mandatory):
 *  (1) The plan built over the CURRENT canonical host registry validates fail-closed
 *      (validateInstallerPlan), and EVERY per-host receipt validates (validateInstallReceipt)
 *      with the four AC24 facets present + the execution-ban markers
 *      (executed:false / side_effects:"none" / mode:"plan" / parity_target:"current-canonical").
 *  (2) EXECUTION-BAN: building the plan performs ZERO fs writes — a real spy over
 *      fs.writeFile/appendFile/etc. AND fs/promises is not-called (with a non-vacuous control).
 *  (3) Fail-closed controls: a receipt with executed:true, side_effects≠none, a missing facet,
 *      or an unknown key is REJECTED; a plan with mode≠"plan" or parity_target≠current-canonical
 *      is REJECTED.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";

import {
  buildInstallerPlan,
  buildInstallReceipt,
  validateInstallerPlan,
  validateInstallReceipt,
  RECEIPT_FACET_KEYS,
  INSTALL_RECEIPT_SCHEMA,
  INSTALLER_PLAN_SCHEMA,
} from "../../scripts/lib/installer-contract";
import { HOST_REGISTRY_ROWS, HOST_IDS } from "../../scripts/lib/host-registry";
import type { HostRegistryEntry } from "../../scripts/lib/host-registry-schema";

const OPTS = { renderedAt: "2026-06-17T00:00:00Z", sourceVersion: "2.0.0" };

/** The current canonical host rows (the registry the live package ships). */
const ROWS: HostRegistryEntry[] = (HOST_IDS as readonly string[]).map(
  (id) => (HOST_REGISTRY_ROWS as Record<string, HostRegistryEntry>)[id]
);

const FS_WRITE_MUTATORS = [
  "writeFile", "writeFileSync", "appendFile", "appendFileSync", "rename", "renameSync",
  "rm", "rmSync", "unlink", "unlinkSync", "mkdir", "mkdirSync", "createWriteStream",
  "truncate", "truncateSync", "open", "openSync", "copyFile", "copyFileSync",
] as const;
const FSP_WRITE_MUTATORS = ["writeFile", "appendFile", "rename", "rm", "unlink", "mkdir", "truncate", "copyFile"] as const;

function spyAllWrites(): { paths: string[]; restore: () => void } {
  const paths: string[] = [];
  const spies: Array<{ mockRestore: () => void } | null> = [];
  for (const name of FS_WRITE_MUTATORS) {
    if (typeof (fs as unknown as Record<string, unknown>)[name] !== "function") { spies.push(null); continue; }
    spies.push(jest.spyOn(fs as unknown as Record<string, (...a: unknown[]) => unknown>, name as never)
      .mockImplementation(((...a: unknown[]) => { paths.push(`fs.${name}:${String(a[0])}`); return undefined as never; }) as never));
  }
  for (const name of FSP_WRITE_MUTATORS) {
    if (typeof (fsp as unknown as Record<string, unknown>)[name] !== "function") { spies.push(null); continue; }
    spies.push(jest.spyOn(fsp as unknown as Record<string, (...a: unknown[]) => unknown>, name as never)
      .mockImplementation(((...a: unknown[]) => { paths.push(`fsp.${name}:${String(a[0])}`); return Promise.resolve() as never; }) as never));
  }
  return { paths, restore: () => spies.forEach((s) => s?.mockRestore()) };
}

describe("SC-W3-4 (1) — plan + per-host receipts over the CURRENT canonical validate fail-closed", () => {
  it("the registry is non-empty (the contract covers at least one host)", () => {
    expect(ROWS.length).toBeGreaterThan(0);
  });

  it("buildInstallerPlan over the canonical rows validates + carries the PRE-CUTOVER markers", () => {
    const plan = buildInstallerPlan(ROWS, OPTS);
    const v = validateInstallerPlan(plan);
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
    expect(plan.schema_version).toBe(INSTALLER_PLAN_SCHEMA);
    expect(plan.mode).toBe("plan");
    expect(plan.executed).toBe(false);
    expect(plan.side_effects).toBe("none");
    expect(plan.parity_target).toBe("current-canonical");
    expect(plan.hosts.length).toBe(ROWS.length);
  });

  it("EVERY per-host receipt validates + has the four AC24 facets + execution-ban markers", () => {
    const plan = buildInstallerPlan(ROWS, OPTS);
    for (const host of plan.hosts) {
      const r = validateInstallReceipt(host.receipt);
      expect(r.errors).toEqual([]);
      expect(r.valid).toBe(true);
      expect(host.receipt.schema_version).toBe(INSTALL_RECEIPT_SCHEMA);
      expect(host.receipt.executed).toBe(false);
      expect(host.receipt.side_effects).toBe("none");
      for (const facet of RECEIPT_FACET_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(host.receipt.facets, facet)).toBe(true);
      }
      // each host plan describes at least one install + one reconcile step.
      expect(host.install_steps.length).toBeGreaterThan(0);
      expect(host.reconcile_steps.length).toBeGreaterThan(0);
    }
  });
});

describe("SC-W3-4 (2) — EXECUTION-BAN: building the plan performs ZERO fs writes", () => {
  it("CONTROL: the write-spy fires on a real write (non-vacuous)", () => {
    const { paths, restore } = spyAllWrites();
    try {
      fs.writeFileSync("/tmp/sc4-control", "x"); // mocked — records only
    } finally {
      restore();
    }
    expect(paths.length).toBeGreaterThan(0);
  });

  it("buildInstallerPlan + buildInstallReceipt over ALL rows write NOTHING (fs + fs/promises)", () => {
    const { paths, restore } = spyAllWrites();
    try {
      const plan = buildInstallerPlan(ROWS, OPTS);
      ROWS.forEach((row) => buildInstallReceipt(row, OPTS));
      expect(plan.hosts.length).toBe(ROWS.length); // ran for real
    } finally {
      restore();
    }
    expect(paths).toEqual([]);
  });
});

describe("SC-W3-4 (3) — fail-closed controls (the validators are not vacuous)", () => {
  const goodPlan = buildInstallerPlan(ROWS, OPTS);
  const goodReceipt = goodPlan.hosts[0].receipt;

  it("a receipt with executed:true is REJECTED", () => {
    expect(validateInstallReceipt({ ...goodReceipt, executed: true }).valid).toBe(false);
  });
  it('a receipt with side_effects ≠ "none" is REJECTED', () => {
    expect(validateInstallReceipt({ ...goodReceipt, side_effects: "wrote-files" }).valid).toBe(false);
  });
  it("a receipt missing an AC24 facet is REJECTED", () => {
    const facets = { ...goodReceipt.facets } as Record<string, unknown>;
    delete facets["permission_mode"];
    expect(validateInstallReceipt({ ...goodReceipt, facets }).valid).toBe(false);
  });
  it("a receipt with an unknown key is REJECTED (strict)", () => {
    expect(validateInstallReceipt({ ...goodReceipt, surprise: 1 }).valid).toBe(false);
  });
  it('a plan with mode ≠ "plan" is REJECTED (PLAN-ONLY)', () => {
    expect(validateInstallerPlan({ ...goodPlan, mode: "execute" }).valid).toBe(false);
  });
  it('a plan with parity_target ≠ "current-canonical" is REJECTED (no new channel this wave)', () => {
    expect(validateInstallerPlan({ ...goodPlan, parity_target: "dist-channel" }).valid).toBe(false);
  });
  it("never throws on hostile input (Proxy ownKeys trap)", () => {
    const proxy = new Proxy({}, { ownKeys() { throw new Error("boom"); }, get() { return undefined; } });
    expect(() => validateInstallReceipt(proxy)).not.toThrow();
    expect(() => validateInstallerPlan(proxy)).not.toThrow();
    expect(validateInstallReceipt(proxy).valid).toBe(false);
  });
});
