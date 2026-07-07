/**
 * scripts/__tests__/init-guild-security.test.ts
 *
 * init-config-goal lane L3 (§E7b / V14) — the fail-closed SECURITY reconcile.
 * A MALFORMED security value must be coerced to its MOST-RESTRICTIVE value
 * (deny / block / closed / []), NEVER to the (possibly wider) schema default and
 * NEVER widened. Anti-vacuity: a malformed value that STAYS WIDE fails the test.
 *
 * Exercises the REAL fs path (temp dirs + defaultInitGuildIO) — not an injected seam —
 * so a real-wiring miss cannot pass green (per the injected-seam-masks-misses lesson).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  reconcileSecurity,
  initializeGuild,
  defaultInitGuildIO,
  SECURITY_FAIL_CLOSED_POLICY,
} from "../lib/init-guild";

const NOW = "2026-06-26T00:00:00Z";

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-sec-"));
}
function writeSettings(root: string, obj: unknown): void {
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify(obj, null, 2) + "\n");
}
function readSettings(root: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(root, ".guild", "settings.json"), "utf8"));
}

// Independent oracle (NOT imported from the impl) so a dropped/weakened rule fails here.
const EXPECTED_FAIL_CLOSED: Record<string, unknown> = {
  "security.bypass_permissions_policy": "deny",
  codex_skip_enforcement: "block",
  "secrets_policy.fail_mode_durable": "closed",
  "secrets_policy.fail_mode_telemetry": "closed",
  auto_approve: [],
  "defaults.gates.auto_approve": [],
};

describe("§E7b fail-closed security reconcile (V14)", () => {
  const tmpDirs: string[] = [];
  afterAll(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  });
  function tmp(): string {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  }

  it("coerces EVERY malformed security key to its most-restrictive value (never the wider default)", () => {
    const root = tmp();
    // Seed malformed values for all six keys. Note three defaults are WIDER than the
    // fail-closed value (audit/warn/open), so coercion must NOT target the default.
    writeSettings(root, {
      auto_approve: "all", // malformed (string, not array) → []
      codex_skip_enforcement: "loud", // malformed enum → block (default is "warn", wider)
      security: { bypass_permissions_policy: "banana" }, // → deny (default "audit", wider)
      secrets_policy: { fail_mode_durable: "maybe", fail_mode_telemetry: "loud" }, // → closed/closed (telemetry default "open", wider)
      defaults: { gates: { auto_approve: { not: "an array" } } }, // → []
    });

    const out = reconcileSecurity({ cwd: root, mode: "repair", io: defaultInitGuildIO(), now: NOW });
    expect(out.applied).toBe(true);
    expect(out.coerced?.map((c) => c.key).sort()).toEqual(Object.keys(EXPECTED_FAIL_CLOSED).sort());

    const s = readSettings(root);
    expect(s.security.bypass_permissions_policy).toBe("deny");
    expect(s.codex_skip_enforcement).toBe("block");
    expect(s.secrets_policy.fail_mode_durable).toBe("closed");
    expect(s.secrets_policy.fail_mode_telemetry).toBe("closed");
    expect(s.auto_approve).toEqual([]);
    expect(s.defaults.gates.auto_approve).toEqual([]);
  });

  // Anti-vacuity, per key: a malformed value that survives WIDE must fail.
  for (const [key, failClosed] of Object.entries(EXPECTED_FAIL_CLOSED)) {
    it(`anti-vacuity: malformed ${key} is coerced to the restrictive value, not left wide`, () => {
      const root = tmp();
      // Seed a deliberately WIDE/garbage value at this key only.
      const seed: Record<string, any> = {};
      const parts = key.split(".");
      let node = seed;
      for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] = {};
      node[parts[parts.length - 1]] = "WIDE_GARBAGE_VALUE";
      writeSettings(root, seed);

      reconcileSecurity({ cwd: root, mode: "repair", io: defaultInitGuildIO(), now: NOW });

      const s = readSettings(root);
      let got: any = s;
      for (const p of parts) got = got?.[p];
      expect(got).toEqual(failClosed);
      expect(got).not.toBe("WIDE_GARBAGE_VALUE");
    });
  }

  it("NEVER widens a VALID permissive value (leaves the user's valid choice untouched)", () => {
    const root = tmp();
    // Realistic post-reconcile state: all six security keys present and VALID
    // (some at permissive-but-valid values the user explicitly chose).
    writeSettings(root, {
      security: { bypass_permissions_policy: "allow" }, // valid + permissive → kept
      auto_approve: ["all"], // valid → kept
      codex_skip_enforcement: "warn", // valid → kept
      secrets_policy: { fail_mode_durable: "open", fail_mode_telemetry: "open" }, // valid → kept
      defaults: { gates: { auto_approve: ["spec"] } }, // valid → kept
    });
    const out = reconcileSecurity({ cwd: root, mode: "init", io: defaultInitGuildIO(), now: NOW });
    expect(out.applied).toBe(false);
    const s = readSettings(root);
    expect(s.security.bypass_permissions_policy).toBe("allow");
    expect(s.auto_approve).toEqual(["all"]);
    expect(s.codex_skip_enforcement).toBe("warn");
    expect(s.secrets_policy.fail_mode_durable).toBe("open");
    expect(s.defaults.gates.auto_approve).toEqual(["spec"]);
  });

  it("is idempotent — a second pass over already-fail-closed settings is a no-op", () => {
    const root = tmp();
    writeSettings(root, { security: { bypass_permissions_policy: "nope" } });
    reconcileSecurity({ cwd: root, mode: "repair", io: defaultInitGuildIO(), now: NOW });
    const after1 = fs.readFileSync(path.join(root, ".guild", "settings.json"), "utf8");
    const out2 = reconcileSecurity({ cwd: root, mode: "repair", io: defaultInitGuildIO(), now: NOW });
    const after2 = fs.readFileSync(path.join(root, ".guild", "settings.json"), "utf8");
    expect(out2.applied).toBe(false);
    expect(after2).toBe(after1);
  });

  it("marks coerced keys as `reconciled` in the provenance sidecar (not a wide `user` value)", () => {
    const root = tmp();
    writeSettings(root, { security: { bypass_permissions_policy: "banana" } });
    reconcileSecurity({ cwd: root, mode: "repair", io: defaultInitGuildIO(), now: NOW });
    const sidecar = JSON.parse(
      fs.readFileSync(path.join(root, ".guild", "settings.provenance.json"), "utf8")
    );
    expect(sidecar["security.bypass_permissions_policy"]).toEqual({
      provenance: "reconciled",
      last_reconciled_at: NOW,
    });
  });

  it("end-to-end: initializeGuild fails closed on a pre-existing malformed (user) security value", () => {
    const root = tmp();
    // A hand-authored (no provenance sidecar ⇒ user) settings.json with malformed security.
    writeSettings(root, {
      security: { bypass_permissions_policy: "wide-open" },
      auto_approve: "yes-everything",
    });
    const res = initializeGuild(root, "single_project", { now: NOW });
    expect(res.security.applied).toBe(true);
    const s = readSettings(root);
    // reconcileConfig(sync) preserved the user values; the security pass then failed them closed.
    expect(s.security.bypass_permissions_policy).toBe("deny");
    expect(s.auto_approve).toEqual([]);
  });

  it("the fail-closed policy covers exactly the six V14 keys", () => {
    expect(SECURITY_FAIL_CLOSED_POLICY.map((r) => r.key).sort()).toEqual(
      Object.keys(EXPECTED_FAIL_CLOSED).sort()
    );
  });
});
