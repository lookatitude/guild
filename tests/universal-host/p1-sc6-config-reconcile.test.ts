/**
 * tests/universal-host/p1-sc6-config-reconcile.test.ts
 *
 * P1 SC-6 — CONFIG RECONCILE: idempotency + never-clobber.
 *
 * The reconciler has three modes (check | sync | repair) and ONE load-bearing
 * invariant: it NEVER overwrites a user-set value — for any key, in any mode,
 * security keys included (Lsec depends on this covering security_sensitive fields).
 *
 *   - check  : reports drift, writes NOTHING (wrote=false always).
 *   - sync   : fills MISSING keys to default; keeps user values.
 *   - repair : additionally coerces a MALFORMED default/reconciled value back to the
 *              schema default; still keeps a VALID — and even a malformed — user value.
 *   - IDEMPOTENCY: applying `sync` and re-running `sync` writes nothing the 2nd time.
 *
 * REAL PATH (no seam): the SHIPPED `reconcile()` reference + `mayReconcileWrite()` +
 * `defaultIsValidValue()` are exercised directly — the same decision logic L9's
 * runtime reconciler must match. The "apply" step re-derives the post-state from the
 * real findings (no re-implemented reconciler), then re-runs the real function.
 *
 * Status at authoring: GREEN (P1-L0 shipped the contract). L9 builds the runtime
 * reconcile against this reference (asserted live when L9 + config-init-baseline land).
 */

import {
  reconcile,
  mayReconcileWrite,
  defaultIsValidValue,
  validateConfigFieldSpec,
  type ConfigFieldSpec,
  type MaterializedField,
  type ReconcileResult,
} from "../../scripts/lib/config-reconcile-contract";

const NOW = "2026-06-15T12:00:00Z";

// A representative schema: a plain key, an enum, and a SECURITY-sensitive key.
const SCHEMA: ConfigFieldSpec[] = [
  { key: "auto_approve", type: "array", default: [], scope: "workspace", security_sensitive: false },
  {
    key: "review",
    type: "enum",
    enum_values: ["local", "cross", "off"],
    default: "local",
    scope: "project",
    security_sensitive: false,
  },
  {
    key: "security.bypass_permissions_policy",
    type: "enum",
    enum_values: ["audit", "honor", "deny"],
    default: "audit",
    scope: "workspace",
    security_sensitive: true,
  },
];

function field(
  key: string,
  value: unknown,
  provenance: MaterializedField["provenance"]
): MaterializedField {
  return { key, value, provenance, last_reconciled_at: null };
}

/** Re-derive the post-reconcile materialized map from the REAL findings (no re-impl). */
function applyFindings(res: ReconcileResult): Record<string, MaterializedField> {
  const out: Record<string, MaterializedField> = {};
  for (const f of res.findings) {
    out[f.key] = field(f.key, f.resolved_value, f.resolved_provenance);
  }
  return out;
}

// ── mayReconcileWrite predicate ─────────────────────────────────────────────

describe("P1 SC-6 — mayReconcileWrite (the never-clobber gate)", () => {
  it("permits write when absent / default / reconciled; FORBIDS when user-set", () => {
    expect(mayReconcileWrite(undefined)).toBe(true);
    expect(mayReconcileWrite(field("k", 1, "default"))).toBe(true);
    expect(mayReconcileWrite(field("k", 1, "reconciled"))).toBe(true);
    expect(mayReconcileWrite(field("k", 1, "user"))).toBe(false);
  });
});

// ── check never writes ──────────────────────────────────────────────────────

describe("P1 SC-6 — check mode is read-only", () => {
  it("reports drift but writes nothing (wrote=false), even with missing + malformed fields", () => {
    const current = {
      review: field("review", "not-a-mode", "default"), // malformed
      // auto_approve + security key MISSING
    };
    const res = reconcile(SCHEMA, current, "check", NOW);
    expect(res.wrote).toBe(false);
    expect(res.findings.every((f) => f.action === "none")).toBe(true);
  });
});

// ── sync fills missing, keeps user ──────────────────────────────────────────

describe("P1 SC-6 — sync fills missing, never clobbers user", () => {
  it("fills a MISSING key to default (provenance reconciled); keeps a user value untouched", () => {
    const current = {
      auto_approve: field("auto_approve", ["build"], "user"), // user-set
      // review + security key MISSING
    };
    const res = reconcile(SCHEMA, current, "sync", NOW);
    const byKey = Object.fromEntries(res.findings.map((f) => [f.key, f]));

    expect(byKey["auto_approve"].status).toBe("user-override-kept");
    expect(byKey["auto_approve"].resolved_value).toEqual(["build"]);
    expect(byKey["auto_approve"].resolved_provenance).toBe("user");

    expect(byKey["review"].status).toBe("missing");
    expect(byKey["review"].action).toBe("fill-default");
    expect(byKey["review"].resolved_value).toBe("local");
    expect(byKey["review"].resolved_provenance).toBe("reconciled");

    expect(res.wrote).toBe(true);
  });
});

// ── repair coerces malformed default; keeps VALID and MALFORMED user values ──

describe("P1 SC-6 — repair coerces malformed default; never clobbers user", () => {
  it("repairs a malformed default/reconciled value to the schema default", () => {
    const current = {
      review: field("review", "not-a-mode", "reconciled"), // malformed, not user
    };
    const res = reconcile(SCHEMA, current, "repair", NOW);
    const review = res.findings.find((f) => f.key === "review")!;
    expect(review.status).toBe("malformed");
    expect(review.action).toBe("repair-default");
    expect(review.resolved_value).toBe("local");
    expect(res.wrote).toBe(true);
  });

  it("keeps a MALFORMED USER value (never-clobber wins over repair)", () => {
    const current = {
      review: field("review", "not-a-mode", "user"), // malformed BUT user-set
    };
    const res = reconcile(SCHEMA, current, "repair", NOW);
    const review = res.findings.find((f) => f.key === "review")!;
    expect(review.status).toBe("user-override-kept");
    expect(review.action).toBe("none");
    expect(review.resolved_value).toBe("not-a-mode"); // untouched
    expect(review.resolved_provenance).toBe("user");
  });

  it("keeps a VALID user value under repair (no needless rewrite)", () => {
    const current = { review: field("review", "cross", "user") };
    const res = reconcile(SCHEMA, current, "repair", NOW);
    const review = res.findings.find((f) => f.key === "review")!;
    expect(review.status).toBe("user-override-kept");
    expect(review.resolved_value).toBe("cross");
  });
});

// ── never-clobber covers SECURITY keys (Lsec dependency) ────────────────────

describe("P1 SC-6 — never-clobber applies to security_sensitive keys", () => {
  it("a user-set security key is NEVER weakened by sync OR repair", () => {
    // User hardened the policy to "deny"; the schema default is the weaker "audit".
    const current = {
      "security.bypass_permissions_policy": field(
        "security.bypass_permissions_policy",
        "deny",
        "user"
      ),
    };
    for (const mode of ["sync", "repair"] as const) {
      const res = reconcile(SCHEMA, current, mode, NOW);
      const sec = res.findings.find(
        (f) => f.key === "security.bypass_permissions_policy"
      )!;
      expect(sec.status).toBe("user-override-kept");
      expect(sec.resolved_value).toBe("deny"); // NOT silently weakened back to "audit"
      expect(sec.resolved_provenance).toBe("user");
    }
  });

  it("the schema marks the bypass-policy field security_sensitive (explicit coverage)", () => {
    const sec = SCHEMA.find((s) => s.key === "security.bypass_permissions_policy")!;
    expect(sec.security_sensitive).toBe(true);
    expect(validateConfigFieldSpec(sec).valid).toBe(true);
  });
});

// ── IDEMPOTENCY ─────────────────────────────────────────────────────────────

describe("P1 SC-6 — sync is idempotent", () => {
  it("first sync fills; applying it and re-syncing writes NOTHING the 2nd time", () => {
    const current = {
      auto_approve: field("auto_approve", ["build"], "user"),
      // review + security key MISSING on the first pass
    };
    const first = reconcile(SCHEMA, current, "sync", NOW);
    expect(first.wrote).toBe(true);

    const afterFirst = applyFindings(first);
    const second = reconcile(SCHEMA, afterFirst, "sync", NOW);

    expect(second.wrote).toBe(false); // fixed point reached
    for (const f of second.findings) {
      expect(f.action).toBe("none");
      expect(["ok", "user-override-kept"]).toContain(f.status);
    }
    // A third pass is also stable.
    const third = reconcile(SCHEMA, applyFindings(second), "sync", NOW);
    expect(third.wrote).toBe(false);
  });

  it("repair reaches a fixed point too (malformed default repaired once, then stable)", () => {
    const current = { review: field("review", 123, "reconciled") }; // malformed
    const first = reconcile(SCHEMA, current, "repair", NOW);
    expect(first.wrote).toBe(true);
    const second = reconcile(SCHEMA, applyFindings(first), "repair", NOW);
    expect(second.wrote).toBe(false);
  });
});

// ── defaultIsValidValue structural checks (used by repair) ──────────────────

describe("P1 SC-6 — defaultIsValidValue structural validator", () => {
  it("validates by declared type and rejects mismatches", () => {
    const arr = SCHEMA[0];
    const en = SCHEMA[1];
    expect(defaultIsValidValue(arr, [])).toBe(true);
    expect(defaultIsValidValue(arr, "nope")).toBe(false);
    expect(defaultIsValidValue(en, "cross")).toBe(true);
    expect(defaultIsValidValue(en, "bogus")).toBe(false);
  });
});
