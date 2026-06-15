/**
 * scripts/__tests__/config-reconcile.test.ts
 *
 * P1-L9 SC-6 — the config reconciler: golden byte-identical `config init` (reconcile
 * sync on a fresh repo == today's scaffold output), never-clobber, idempotency,
 * check-is-read-only, repair. Uses an in-memory IO (no real fs).
 */

import * as fs from "fs";
import * as path from "path";
import {
  reconcileConfig,
  type ReconcileIO,
} from "../lib/config-reconcile";
import { CONFIG_SCHEMA, isSecuritySensitiveKey } from "../lib/config-schema";
import { scaffold } from "../read-guild-config";

const NOW = "2026-06-15T12:00:00Z";
const GOLDEN = fs.readFileSync(
  path.join(__dirname, "..", "..", "tests", "universal-host", "fixtures", "config-init-baseline.json"),
  "utf8"
);

function memIO(seed: Record<string, string> = {}): { io: ReconcileIO; store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(seed));
  const io: ReconcileIO = {
    readFileText: (p) => (store.has(p) ? (store.get(p) as string) : null),
    writeFileText: (p, text) => void store.set(p, text),
    ensureDir: () => {},
  };
  return { io, store };
}

const SETTINGS = "/repo/.guild/settings.json";
const PROV = "/repo/.guild/settings.provenance.json";

describe("P1-L9 reconcile sync — byte-identical config init (SC-6 golden)", () => {
  it("the golden equals today's scaffold() output (capture is current)", () => {
    expect(scaffold()).toBe(GOLDEN);
  });

  it("reconcile sync on a FRESH repo produces settings.json byte-identical to the golden", () => {
    const { io, store } = memIO();
    const r = reconcileConfig({ cwd: "/repo", mode: "sync", now: NOW, io });
    expect(store.get(SETTINGS)).toBe(GOLDEN);
    expect(r.changed).toBe(true);
    // settings.json stays byte-clean (no provenance pollution) — sidecar carries it.
    expect(store.has(PROV)).toBe(true);
    const prov = JSON.parse(store.get(PROV) as string);
    // every schema field is recorded as reconciled with the now stamp.
    expect(prov["review"]).toEqual({ provenance: "reconciled", last_reconciled_at: NOW });
    expect(Object.keys(prov).length).toBe(CONFIG_SCHEMA.length);
  });
});

describe("P1-L9 reconcile — idempotency + check read-only", () => {
  it("a second sync writes nothing (idempotent) and settings stay golden", () => {
    const { io, store } = memIO();
    reconcileConfig({ cwd: "/repo", mode: "sync", now: NOW, io });
    const r2 = reconcileConfig({ cwd: "/repo", mode: "sync", now: "2026-07-01T00:00:00Z", io });
    expect(r2.changed).toBe(false); // no drift, no write
    expect(store.get(SETTINGS)).toBe(GOLDEN); // unchanged
  });

  it("check never writes (read-only) and reports missing fields on a fresh repo", () => {
    const { io, store } = memIO();
    const r = reconcileConfig({ cwd: "/repo", mode: "check", now: NOW, io });
    expect(r.wrote).toBe(false);
    expect(r.changed).toBe(false);
    expect(store.size).toBe(0); // nothing written
    expect(r.findings.every((f) => f.status === "missing")).toBe(true);
  });
});

describe("P1-L9 reconcile — never-clobber (incl. security keys)", () => {
  it("keeps a user value present in settings.json with NO sidecar (hand-authored ⇒ user)", () => {
    const seed = { [SETTINGS]: JSON.stringify({ review: "cross", loop_cap: 99 }, null, 2) + "\n" };
    const { io, store } = memIO(seed);
    const r = reconcileConfig({ cwd: "/repo", mode: "sync", now: NOW, io });
    const out = JSON.parse(store.get(SETTINGS) as string);
    expect(out.review).toBe("cross"); // user value preserved
    expect(out.loop_cap).toBe(99); // user value preserved
    expect(out.host).toBe("auto"); // missing key filled to default
    // those two are recorded as user-override-kept
    expect(r.findings.find((f) => f.key === "review")?.status).toBe("user-override-kept");
  });

  it("never weakens a security key the user set (security_sensitive coverage)", () => {
    expect(isSecuritySensitiveKey("security.bypass_permissions_policy")).toBe(true);
    expect(isSecuritySensitiveKey("auto_approve")).toBe(true);
    const seed = {
      [SETTINGS]:
        JSON.stringify({ security: { bypass_permissions_policy: "deny" } }, null, 2) + "\n",
    };
    const { io, store } = memIO(seed);
    reconcileConfig({ cwd: "/repo", mode: "repair", now: NOW, io });
    const out = JSON.parse(store.get(SETTINGS) as string);
    // user hardened it to "deny"; reconcile (even repair) must NOT reset it to the "audit" default.
    expect(out.security.bypass_permissions_policy).toBe("deny");
  });
});

describe("P1-L9 reconcile — repair coerces malformed reconciled values, keeps user", () => {
  it("repair fixes a malformed RECONCILED value but never a user value", () => {
    // loop_cap is reconciled (sidecar) but malformed (string); host is user + malformed.
    const seed = {
      [SETTINGS]: JSON.stringify({ loop_cap: "oops", host: 123 }, null, 2) + "\n",
      [PROV]:
        JSON.stringify(
          { loop_cap: { provenance: "reconciled", last_reconciled_at: NOW } },
          null,
          2
        ) + "\n",
    };
    const { io, store } = memIO(seed);
    reconcileConfig({ cwd: "/repo", mode: "repair", now: "2026-07-01T00:00:00Z", io });
    const out = JSON.parse(store.get(SETTINGS) as string);
    expect(out.loop_cap).toBe(16); // reconciled+malformed ⇒ repaired to default
    expect(out.host).toBe(123); // user+malformed ⇒ KEPT (never-clobber wins over repair)
  });

  it("sync does NOT repair a malformed reconciled value (only repair mode does)", () => {
    const seed = {
      [SETTINGS]: JSON.stringify({ loop_cap: "oops" }, null, 2) + "\n",
      [PROV]:
        JSON.stringify({ loop_cap: { provenance: "reconciled", last_reconciled_at: NOW } }, null, 2) +
        "\n",
    };
    const { io, store } = memIO(seed);
    reconcileConfig({ cwd: "/repo", mode: "sync", now: NOW, io });
    const out = JSON.parse(store.get(SETTINGS) as string);
    expect(out.loop_cap).toBe("oops"); // sync leaves malformed reconciled values as-is
  });
});
