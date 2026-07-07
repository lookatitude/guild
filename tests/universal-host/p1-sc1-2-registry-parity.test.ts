/**
 * tests/universal-host/p1-sc1-2-registry-parity.test.ts
 *
 * P1 SC-1 / SC-2 — HOST-REGISTRY PARITY + INDEPENDENT COLUMNS.
 *
 * SC-1 (host registry): RECONCILED to the host-adapter migration (R0–R13). The registry
 *   carries exactly the nine canonical host ids
 *   {claude-code-cli, codex-cli, pi-cli, antigravity-cli, agents-file, claude-code-app,
 *   claude-code-web, codex-app, claude-ai-connector} — the legacy ids
 *   {claude, codex, .agents, pi, antigravity} were RENAMED (`.agents`→`agents-file`, no
 *   leading dot) and four app/web/connector surfaces were added; Gemini stays dropped (D10);
 *   every row validates.
 * SC-2 (independent capability columns + INFERRED provenance): the single detect-only
 *   `hasAdapter` flag is REPLACED by three INDEPENDENT columns (installability /
 *   result_adapter / dispatch_selectable); the four CLI/file primary hosts
 *   (claude-code-cli/codex-cli/pi-cli/antigravity-cli) are `verified` (pi+antigravity
 *   on-host-verified by commit 445f7b6) while `agents-file` and the four app/web/connector
 *   surfaces remain `inferred`; no inferred host claims a `native` install; the cross-field
 *   surface_kind invariant holds.
 *
 * REAL PATH (no seam): tests drive the SHIPPED `validateHostRegistryEntry()` over the
 * SHIPPED `HOST_REGISTRY_ROWS` — the same validator + rows L7 unifies against. The
 * fail-fixtures are deliberately-broken entries whose REJECTION is the contract (the
 * RED discriminators: a column collapsed back to one flag, an unknown host, a
 * surface_kind mismatch — each must fail-closed).
 *
 * Status at authoring: GREEN (P1-L0 shipped the schema + rows).
 */

import {
  HOST_IDS,
  HOST_FAMILIES,
  HOST_REGISTRY_ROWS,
  validateHostRegistryEntry,
  isHostRegistryEntry,
  type HostId,
  type HostRegistryEntry,
} from "../../scripts/lib/host-registry-schema";

const ROWS = HOST_IDS.map((id) => HOST_REGISTRY_ROWS[id]);

// ── SC-1 — the five-host namespace ──────────────────────────────────────────

describe("P1 SC-1 — canonical host namespace (host-adapter migration)", () => {
  it("is EXACTLY the 9 canonical ids — legacy ids renamed, Gemini dropped (D10)", () => {
    expect([...HOST_IDS]).toEqual([
      "claude-code-cli",
      "codex-cli",
      "pi-cli",
      "antigravity-cli",
      "agents-file",
      "claude-code-app",
      "claude-code-web",
      "codex-app",
      "claude-ai-connector",
    ]);
    expect((HOST_IDS as readonly string[])).not.toContain("gemini");
    expect((HOST_IDS as readonly string[])).not.toContain("gemini-cli");
    // The legacy bare ids were RENAMED away (no compat aliases survive in the roster).
    for (const legacy of ["claude", "codex", ".agents", "pi", "antigravity"]) {
      expect((HOST_IDS as readonly string[])).not.toContain(legacy);
    }
  });

  it("the AGENTS.md target is the canonical `agents-file` id (renamed from `.agents`), family `agents`", () => {
    expect(HOST_IDS).toContain("agents-file");
    expect((HOST_IDS as readonly string[])).not.toContain(".agents"); // leading-dot id renamed away
    expect(HOST_REGISTRY_ROWS["agents-file"].host_id).toBe("agents-file");
    // The id no longer carries a leading dot; the family is still "agents".
    expect(HOST_REGISTRY_ROWS["agents-file"].family).toBe("agents");
  });

  it("has exactly one row per host id, each with a matching host_id key", () => {
    expect(Object.keys(HOST_REGISTRY_ROWS).sort()).toEqual([...HOST_IDS].sort());
    for (const id of HOST_IDS) expect(HOST_REGISTRY_ROWS[id].host_id).toBe(id);
  });

  it("every shipped row passes the real validator", () => {
    for (const row of ROWS) {
      const r = validateHostRegistryEntry(row);
      expect(r.errors).toEqual([]);
      expect(r.valid).toBe(true);
      expect(isHostRegistryEntry(row)).toBe(true);
    }
  });

  it("each row's family is a known family", () => {
    for (const row of ROWS) expect(HOST_FAMILIES as readonly string[]).toContain(row.family);
  });
});

// ── SC-2 — three INDEPENDENT capability columns ─────────────────────────────

describe("P1 SC-2 — independent capability columns (replace hasAdapter)", () => {
  it("pins every host's full column triple exactly (installability/result_adapter/dispatch_selectable)", () => {
    // Concrete per-host values — not just types. A column collapsed back into one flag,
    // or any single value flipped, fails here (exact-value behavioral assertion).
    const EXPECTED: Record<HostId, { installability: string; result_adapter: boolean; dispatch_selectable: boolean }> = {
      "claude-code-cli": { installability: "native", result_adapter: false, dispatch_selectable: true },
      "codex-cli": { installability: "target", result_adapter: true, dispatch_selectable: true },
      "pi-cli": { installability: "target", result_adapter: false, dispatch_selectable: true },
      "antigravity-cli": { installability: "target", result_adapter: false, dispatch_selectable: true },
      "agents-file": { installability: "target", result_adapter: false, dispatch_selectable: true },
      // App/web/connector surfaces: no install path, no result adapter, not dispatch-selectable.
      "claude-code-app": { installability: "none", result_adapter: false, dispatch_selectable: false },
      "claude-code-web": { installability: "none", result_adapter: false, dispatch_selectable: false },
      "codex-app": { installability: "none", result_adapter: false, dispatch_selectable: false },
      "claude-ai-connector": { installability: "none", result_adapter: false, dispatch_selectable: false },
    };
    for (const id of HOST_IDS) {
      const row = HOST_REGISTRY_ROWS[id];
      expect({
        installability: row.installability,
        result_adapter: row.result_adapter,
        dispatch_selectable: row.dispatch_selectable,
      }).toEqual(EXPECTED[id]);
    }
  });

  it("the columns are genuinely INDEPENDENT — codex-cli is dispatch_selectable AND result_adapter, agents-file is dispatch_selectable WITHOUT result_adapter", () => {
    const codex = HOST_REGISTRY_ROWS["codex-cli"];
    expect(codex.dispatch_selectable).toBe(true);
    expect(codex.result_adapter).toBe(true); // the only cross reviewer today
    expect(codex.installability).toBe("target"); // renderer exists, install unproven

    const agents = HOST_REGISTRY_ROWS["agents-file"];
    expect(agents.dispatch_selectable).toBe(true); // a lane can run there
    expect(agents.result_adapter).toBe(false); // but no cross-review path back
    // ⇒ the two columns are NOT the same flag (the SC-2 split is real).
    expect(agents.dispatch_selectable).not.toBe(agents.result_adapter);
  });

  it("claude-code-cli is the reference author host: native install, NOT a self cross-reviewer", () => {
    const claude = HOST_REGISTRY_ROWS["claude-code-cli"];
    expect(claude.installability).toBe("native");
    expect(claude.dispatch_selectable).toBe(true);
    expect(claude.result_adapter).toBe(false);
  });

  it("provenance: the 4 CLI/file primary hosts verified; agents-file + the app/web/connector surfaces inferred", () => {
    // Oracle refreshed to current production after commit 445f7b6 ("fix(host-registry):
    // verify pi + antigravity capability rows on-host; correct antigravity bin to agy"):
    // pi + antigravity were LIVE-VERIFIED on-host (the newer truth, not a regression),
    // so their provenance is "verified". The agents-file target and the four app/web/
    // connector surfaces were NOT live-verified → "inferred".
    for (const id of ["claude-code-cli", "codex-cli", "pi-cli", "antigravity-cli"] as HostId[]) {
      expect(HOST_REGISTRY_ROWS[id].provenance).toBe("verified");
    }
    for (const id of [
      "agents-file",
      "claude-code-app",
      "claude-code-web",
      "codex-app",
      "claude-ai-connector",
    ] as HostId[]) {
      expect(HOST_REGISTRY_ROWS[id].provenance).toBe("inferred");
    }
  });

  it("no INFERRED host claims a `native` install (honest placeholder — target or none, never native)", () => {
    // The SC-2 honesty invariant: an unverified host must never advertise a proven native
    // install. agents-file is "target" (a renderer exists); the app/web/connector surfaces
    // are "none" (no package surface). None is ever "native".
    for (const id of HOST_IDS) {
      const row = HOST_REGISTRY_ROWS[id];
      if (row.provenance === "inferred") {
        expect(row.installability).not.toBe("native");
        expect(["target", "none"]).toContain(row.installability);
      }
    }
    expect(HOST_REGISTRY_ROWS["agents-file"].installability).toBe("target");
    expect(HOST_REGISTRY_ROWS["claude-code-app"].installability).toBe("none");
  });

  it("cross-field invariant holds on shipped rows: caps.surface_kind == top-level surface_kind", () => {
    for (const row of ROWS) {
      expect(row.capabilities.surface_kind).toBe(row.surface_kind);
    }
    // `agents-file` is specifically a FILE surface, not cli.
    expect(HOST_REGISTRY_ROWS["agents-file"].surface_kind).toBe("file");
  });
});

// ── Fail-fixtures (RED discriminators — rejection IS the contract) ──────────

describe("P1 SC-1/2 — fail-closed rejection (non-vacuity)", () => {
  const claude: HostRegistryEntry = HOST_REGISTRY_ROWS["claude-code-cli"];

  it("rejects an entry missing an independent column (column collapsed away)", () => {
    const { result_adapter, ...noResultAdapter } = claude as unknown as Record<string, unknown>;
    const r = validateHostRegistryEntry(noResultAdapter);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/result_adapter/);
  });

  it("rejects a column collapsed to the WRONG type (e.g. result_adapter as a string)", () => {
    const r = validateHostRegistryEntry({ ...claude, result_adapter: "yes" });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/result_adapter.*boolean/);
  });

  it("rejects an unknown host id (e.g. gemini)", () => {
    const r = validateHostRegistryEntry({ ...claude, host_id: "gemini" });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/host_id/);
  });

  it("rejects a surface_kind cross-field mismatch (file row carrying a cli caps surface)", () => {
    const agents = HOST_REGISTRY_ROWS["agents-file"];
    const mismatched = {
      ...agents,
      capabilities: { ...agents.capabilities, surface_kind: "cli" },
    };
    const r = validateHostRegistryEntry(mismatched);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/surface_kind mismatch/);
  });

  it("rejects an invalid installability value", () => {
    const r = validateHostRegistryEntry({ ...claude, installability: "maybe" });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/installability/);
  });

  it("rejects a non-object and a null", () => {
    expect(validateHostRegistryEntry(null).valid).toBe(false);
    expect(validateHostRegistryEntry("nope").valid).toBe(false);
    expect(validateHostRegistryEntry([]).valid).toBe(false);
  });
});
