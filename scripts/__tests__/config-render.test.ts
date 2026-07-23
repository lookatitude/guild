/**
 * scripts/__tests__/config-render.test.ts
 *
 * TDD suite for scripts/lib/config-render.ts — the per-host config rendering core
 * (P2-Wave-1 LW1-6, SC-W1-8 / ADR step 14).
 *
 * Coverage:
 *   - renders all canonical host shapes from the registry
 *   - renders strictly via the registry capability rows (host_id-keyed, not name-driven)
 *   - permission block surfaced only for hosts with caps.permissions.ask
 *   - render-or-degrade: hooks/skills/permissions/models flagged in _unsupported
 *   - SECURITY fail-closed (F-9): a secret value is NEVER emitted; ok:false under "closed"
 *   - SECURITY fail-closed (F-9): a local-scope value is withheld from the shared output
 *   - failMode "open" redacts but keeps ok:true
 *   - determinism: same input + renderedAt ⇒ byte-identical output
 *   - the renderer never reads the clock (renderedAt comes from caller opts)
 *
 * The exact rendered SHAPE here is the contract LW1-8 pins with a per-host golden and
 * LW1-9 signs off.
 */

import {
  renderAllHostConfigs,
  renderHostConfig,
  HostConfigRender,
  RenderConfigInput,
} from "../lib/config-render";
import { HOST_IDS } from "../lib/host-registry-schema";
import { resolveBaselineGolden } from "../lib/permission-policy-schema";

const NOW = "2026-06-17T00:00:00Z";

function baseInput(over: Partial<RenderConfigInput> = {}): RenderConfigInput {
  return {
    config: {
      models: { tiers: { cheap: { "claude-code-cli": "haiku" }, mid: { "claude-code-cli": "sonnet" }, powerful: { "claude-code-cli": "opus" } } },
      security: { bypass_permissions_policy: "audit" },
      auto_approve: [],
      ...(over.config ?? {}),
    },
    permissions: over.permissions ?? resolveBaselineGolden(),
    sources: over.sources,
    options: { renderedAt: NOW, sourceVersion: "2.0.0", ...(over.options ?? {}) },
  };
}

describe("renderAllHostConfigs — all five host shapes", () => {
  it("renders exactly the five registry hosts, keyed by host_id", () => {
    const all = renderAllHostConfigs(baseInput());
    expect(Object.keys(all).sort()).toEqual([...HOST_IDS].sort());
    for (const id of HOST_IDS) {
      expect(all[id].host_id).toBe(id);
      expect(all[id].schema_version).toBe("guild.host_config_render.v1");
      expect(all[id]._rendered_at).toBe(NOW);
      expect(all[id]._source_version).toBe("2.0.0");
    }
  });

  it("carries the registry family / surface_kind / provenance (single SoT, not name-driven)", () => {
    const all = renderAllHostConfigs(baseInput());
    expect(all["claude-code-cli"].surface_kind).toBe("cli");
    expect(all["claude-code-cli"].provenance).toBe("verified");
    expect(all["agents-file"].surface_kind).toBe("file"); // .agents is a FILE surface
    expect(all["agents-file"].family).toBe("agents");
    expect(all["antigravity-cli"].family).toBe("antigravity");
  });
});

describe("permissions block — capability-gated (caps.permissions.ask)", () => {
  it("claude (ask=true) carries the full 36-cell permission block", () => {
    const r = renderHostConfig("claude-code-cli", baseInput());
    expect(r.permissions).toBeDefined();
    expect(Object.keys(r.permissions as object).length).toBe(36);
    // baseline: every cell is the all-ask triple
    expect(r.permissions!["build.plan"]).toEqual({ host_mode: "ask", guild_gates: "ask", bypass: "audit" });
  });

  it("all five shipped rows have caps.permissions.ask=true ⇒ each carries the permission block", () => {
    const all = renderAllHostConfigs(baseInput());
    for (const id of HOST_IDS) {
      expect(all[id].permissions).toBeDefined();
      expect(Object.keys(all[id].permissions as object).length).toBe(36);
      // none of the shipped rows hit the ask=false degrade branch (it is forward-compat).
      expect(all[id]._unsupported?.some((u) => u.field === "permissions")).toBeFalsy();
    }
  });

  it("flags bypass 'allow' on a host that cannot bypass prompts", () => {
    const inp = baseInput({ config: { security: { bypass_permissions_policy: "allow" } } });
    // pi caps.permissions.bypass_prompts is false (inferred row) → flag the degrade
    const r = renderHostConfig("pi-cli", inp);
    expect(r._unsupported?.some((u) => u.field === "security.bypass_permissions_policy")).toBe(true);
  });

  it("omits the permission block entirely when no permissions input is supplied", () => {
    const r = renderHostConfig("claude-code-cli", baseInput({ permissions: {} }));
    expect(r.permissions).toBeUndefined();
  });
});

describe("models — config slot then registry capability row", () => {
  it("claude resolves cheap/mid/powerful from the config tiers slot", () => {
    const r = renderHostConfig("claude-code-cli", baseInput());
    expect(r.models).toEqual({ cheap: "haiku", mid: "sonnet", powerful: "opus" });
  });

  it("codex (no config slot set) flags models unsupported when the capability row is empty", () => {
    const r = renderHostConfig("codex-cli", baseInput());
    // CODEX_CAPABILITIES.models are all null and settings codex slot is unset → no model
    expect(r.models).toBeUndefined();
    expect(r._unsupported?.some((u) => u.field === "models")).toBe(true);
  });

  it("honors the {model,effort} object form in the config tiers slot", () => {
    const inp = baseInput({
      config: { models: { tiers: { cheap: { "claude-code-cli": { model: "haiku" } }, mid: { "claude-code-cli": { model: "sonnet" } }, powerful: { "claude-code-cli": { model: "opus" } } } } },
    });
    const r = renderHostConfig("claude-code-cli", inp);
    expect(r.models).toEqual({ cheap: "haiku", mid: "sonnet", powerful: "opus" });
  });
});

describe("render-or-degrade — degrade markers", () => {
  it("flags hooks + skills unsupported on a file/instruction host (.agents)", () => {
    const r = renderHostConfig("agents-file", baseInput());
    expect(r._unsupported?.some((u) => u.field === "hooks")).toBe(true);
    expect(r._unsupported?.some((u) => u.field === "skills")).toBe(true);
  });

  it("claude (native skills + hooks) does NOT flag hooks/skills", () => {
    const r = renderHostConfig("claude-code-cli", baseInput());
    expect(r._unsupported?.some((u) => u.field === "hooks")).toBeFalsy();
    expect(r._unsupported?.some((u) => u.field === "skills")).toBeFalsy();
  });
});

describe("SECURITY fail-closed (F-9) — secrets never leak", () => {
  it("redacts a secret in a role pin and never emits the raw value; ok:false under closed", () => {
    const secret = "ghp_0123456789abcdefghijABCDEFGHIJ012345";
    const inp = baseInput({ config: { roles: { host: "claude-code-cli", note: `token=${secret}` } } });
    const r = renderHostConfig("claude-code-cli", inp);
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain(secret); // raw secret NEVER present
    expect(r._redactions?.some((x) => x.reason === "secret")).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it("scans the renderer's own _redactions records — a secret in a config KEY NAME never survives", () => {
    // Codex G-lane round-5 completeness: a local-scoped roles key whose NAME is a secret would
    // put that secret into _redactions[].field — the final terminating pass must scrub it.
    const secret = "ghp_0123456789abcdefghijABCDEFGHIJ012345";
    const r = renderHostConfig("claude-code-cli", baseInput({
      config: { roles: { host: "claude-code-cli", [secret]: "x" } as Record<string, unknown> },
      sources: { [`roles.${secret}`]: "project-local" },
    }));
    expect(JSON.stringify(r)).not.toContain(secret); // absent everywhere, incl. _redactions.field
    expect(r._redactions?.some((x) => x.field.includes("SECRET-REDACTED"))).toBe(true);
  });

  it("operator redaction_patterns are honored (mirrors secrets_policy.redaction_patterns)", () => {
    const inp = baseInput({
      config: { roles: { host: "claude-code-cli", tag: "INTERNAL-CODENAME-XYZ" } },
      options: { renderedAt: NOW, redactionPatterns: ["INTERNAL-CODENAME-[A-Z]+"] },
    });
    const r = renderHostConfig("claude-code-cli", inp);
    expect(JSON.stringify(r)).not.toContain("INTERNAL-CODENAME-XYZ");
    expect(r._redactions?.some((x) => x.reason === "secret")).toBe(true);
  });

  it("failMode 'open' redacts but keeps ok:true (warn-and-proceed)", () => {
    const secret = "ghp_0123456789abcdefghijABCDEFGHIJ012345";
    const inp = baseInput({
      config: { roles: { host: "claude-code-cli", note: secret } },
      options: { renderedAt: NOW, failMode: "open" },
    });
    const r = renderHostConfig("claude-code-cli", inp);
    expect(JSON.stringify(r)).not.toContain(secret); // still never emitted
    expect(r._redactions?.some((x) => x.reason === "secret")).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.blocked).toBe(false);
  });
});

describe("SECURITY fail-closed (F-9) — local-scope values withheld from shared output", () => {
  it("withholds a project-local role sub-key and records it; ok:false under closed", () => {
    const inp = baseInput({
      config: { roles: { host: "claude-code-cli", adversarial: "codex-cli" } },
      sources: { "roles.adversarial": "project-local" },
    });
    const r = renderHostConfig("claude-code-cli", inp);
    expect(r.roles).toBeDefined();
    expect((r.roles as Record<string, unknown>)["adversarial"]).toBeUndefined(); // withheld
    expect((r.roles as Record<string, unknown>)["host"]).toBe("claude-code-cli"); // shared value kept
    expect(r._redactions?.some((x) => x.reason === "local-scope" && x.field === "roles.adversarial")).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("withholds an entire local-scoped block (roles wholly local)", () => {
    const inp = baseInput({
      config: { roles: { host: "claude-code-cli" } },
      sources: { roles: "workspace-local" },
    });
    const r = renderHostConfig("claude-code-cli", inp);
    expect(r.roles).toEqual({});
    expect(r._redactions?.some((x) => x.reason === "local-scope" && x.field === "roles")).toBe(true);
  });

  it("a shared (project/workspace) source is NOT withheld", () => {
    const inp = baseInput({
      config: { roles: { host: "claude-code-cli" } },
      sources: { "roles.host": "project" },
    });
    const r = renderHostConfig("claude-code-cli", inp);
    expect((r.roles as Record<string, unknown>)["host"]).toBe("claude-code-cli");
    expect(r.ok).toBe(true);
  });

  // ITEM 2 (Codex G-lane) — a LOCAL-only models override must not leak into a shared render.
  it("withholds a workspace-local models override from EVERY host shape (fails closed)", () => {
    const SECRET_LOCAL_MODEL = "local-only-secret-model-xyz";
    const all = renderAllHostConfigs(
      baseInput({
        config: {
          models: { tiers: { cheap: { "claude-code-cli": SECRET_LOCAL_MODEL }, mid: { "claude-code-cli": "sonnet" }, powerful: { "claude-code-cli": "opus" } } },
        },
        sources: { "models.tiers.cheap.claude-code-cli": "workspace-local" },
      })
    );
    for (const id of HOST_IDS) {
      // the local override string appears NOWHERE in the serialized render
      expect(JSON.stringify(all[id])).not.toContain(SECRET_LOCAL_MODEL);
    }
    // claude (the host with the local slot) records the local-scope redaction + fails closed
    const claude = all["claude-code-cli"];
    expect(claude.ok).toBe(false);
    expect(claude.blocked).toBe(true);
    expect(
      claude._redactions?.some((x) => x.reason === "local-scope" && x.field === "models.tiers.cheap.claude-code-cli")
    ).toBe(true);
    // the cheap slot fell back to the SHARED registry default (not the local value)
    expect(claude.models?.cheap).not.toBe(SECRET_LOCAL_MODEL);
  });

  // Codex G-lane round-3 BLOCKER A — a local source on the object-form `.model` CHILD key
  // (finer granularity than the slot) must still withhold the model (descendant taint).
  it("withholds an object-form model whose .model CHILD key is local-sourced", () => {
    const LOCAL = "local-child-only-model";
    const r = renderHostConfig("claude-code-cli", baseInput({
      config: { models: { tiers: { cheap: { "claude-code-cli": { model: LOCAL } }, mid: { "claude-code-cli": "sonnet" }, powerful: { "claude-code-cli": "opus" } } } },
      sources: { "models.tiers.cheap.claude-code-cli.model": "project-local" },
    }));
    expect(JSON.stringify(r)).not.toContain(LOCAL);
    expect(r.models?.cheap).not.toBe(LOCAL); // fell back to the shared registry default
    expect(r._redactions?.some((x) => x.reason === "local-scope" && x.field === "models.tiers.cheap.claude-code-cli")).toBe(true);
    expect(r.ok).toBe(false);
  });

  // Codex G-lane round-3 BLOCKER B — a nested DESCENDANT local source under a roles entry
  // must withhold that entry whole (defense-in-depth; roles values are strings in practice).
  it("withholds a roles entry whose nested DESCENDANT is local-sourced", () => {
    const LOCAL = "local-nested-role-value";
    const r = renderHostConfig("claude-code-cli", baseInput({
      config: { roles: { host: { pin: "claude-code-cli", child: LOCAL } } as unknown as Record<string, unknown> },
      sources: { "roles.host.child": "workspace-local" },
    }));
    expect(JSON.stringify(r)).not.toContain(LOCAL);
    expect(r._redactions?.some((x) => x.reason === "local-scope" && x.field === "roles.host")).toBe(true);
    expect(r.ok).toBe(false);
  });

  // Codex re-open — the permission block is DERIVED from feeder keys (auto_approve /
  // security.bypass_permissions_policy). A local-sourced feeder must withhold the block.
  it("withholds the permission block from EVERY host when a feeder (auto_approve) is project-local", () => {
    const LOCAL_TOKEN = "local-only-auto-approve-token";
    const all = renderAllHostConfigs(
      baseInput({
        config: { auto_approve: [LOCAL_TOKEN], security: { bypass_permissions_policy: "audit" } },
        sources: { auto_approve: "project-local" },
      })
    );
    for (const id of HOST_IDS) {
      expect(all[id].permissions).toBeUndefined(); // withheld everywhere
      expect(JSON.stringify(all[id])).not.toContain(LOCAL_TOKEN);
      expect(all[id].ok).toBe(false);
      expect(all[id].blocked).toBe(true);
      expect(all[id]._redactions?.some((x) => x.reason === "local-scope" && x.field === "permissions")).toBe(true);
    }
  });

  it("withholds the permission block when security.bypass_permissions_policy is workspace-local", () => {
    const r = renderHostConfig("claude-code-cli", baseInput({
      sources: { "security.bypass_permissions_policy": "workspace-local" },
    }));
    expect(r.permissions).toBeUndefined();
    expect(r.ok).toBe(false);
    expect(r._redactions?.some((x) => x.reason === "local-scope" && x.field === "permissions")).toBe(true);
  });

  // rf-wi-01 (G1 codex-review fix, P1) — host_mode now feeds the rendered permission
  // decisions (config-cmd.ts resolvePermissionPolicy overlay); a local-only host_mode
  // must withhold the block from every shared host shape, same as auto_approve/bypass.
  it("withholds the permission block from EVERY host when host_mode is project-local", () => {
    const all = renderAllHostConfigs(
      baseInput({
        config: { host_mode: "read_only" },
        sources: { host_mode: "project-local" },
      })
    );
    for (const id of HOST_IDS) {
      expect(all[id].permissions).toBeUndefined(); // withheld everywhere
      expect(all[id].ok).toBe(false);
      expect(all[id].blocked).toBe(true);
      expect(all[id]._redactions?.some((x) => x.reason === "local-scope" && x.field === "permissions")).toBe(true);
    }
  });

  it("a SHARED host_mode source keeps the full permission block (no false withhold)", () => {
    const r = renderHostConfig("claude-code-cli", baseInput({
      config: { host_mode: "accept_edits" },
      sources: { host_mode: "project" },
    }));
    expect(r.permissions).toBeDefined();
    expect(r.ok).toBe(true);
  });

  it("a SHARED feeder source keeps the full permission block (no false withhold)", () => {
    const r = renderHostConfig("claude-code-cli", baseInput({
      sources: { auto_approve: "project", "security.bypass_permissions_policy": "workspace" },
    }));
    expect(r.permissions).toBeDefined();
    expect(Object.keys(r.permissions as object).length).toBe(36);
    expect(r.ok).toBe(true);
  });
});

describe("determinism + clock-freedom", () => {
  it("same input + renderedAt ⇒ byte-identical output", () => {
    const a = JSON.stringify(renderAllHostConfigs(baseInput()));
    const b = JSON.stringify(renderAllHostConfigs(baseInput()));
    expect(a).toBe(b);
  });

  it("_rendered_at is exactly the caller-supplied timestamp (no clock read)", () => {
    const r = renderHostConfig("claude-code-cli", baseInput({ options: { renderedAt: "1999-01-01T00:00:00Z" } }));
    expect(r._rendered_at).toBe("1999-01-01T00:00:00Z");
  });
});

// ── Codex G-lane MAJOR 1 — host_profiles overrides are consumed by the renderer ──
describe("host_profiles overrides (SC-W1-8)", () => {
  it("applies a SHARED per-host models override over the tiers/registry value", () => {
    const r = renderHostConfig("claude-code-cli", baseInput({
      config: { host_profiles: { "claude-code-cli": { models: { cheap: "haiku-profile" } } } },
      sources: {},
    }));
    expect(r.models?.cheap).toBe("haiku-profile"); // profile wins
    expect(r.models?.mid).toBe("sonnet"); // untouched tiers value
    expect(r.ok).toBe(true);
  });

  it("surfaces the `enabled` toggle from the host profile", () => {
    const r = renderHostConfig("pi-cli", baseInput({
      config: { host_profiles: { "pi-cli": { enabled: false } } },
      sources: {},
    }));
    expect(r.enabled).toBe(false);
  });

  it("WITHHOLDS a LOCAL-sourced host_profiles `enabled` toggle (fails closed)", () => {
    const r = renderHostConfig("pi-cli", baseInput({
      config: { host_profiles: { "pi-cli": { enabled: false } } },
      sources: { "host_profiles.pi-cli.enabled": "project-local" },
    }));
    expect(r.enabled).toBeUndefined(); // withheld — not leaked into the shared render
    expect(r._redactions?.some((x) => x.reason === "local-scope" && x.field === "host_profiles.pi-cli.enabled")).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("WITHHOLDS a LOCAL-sourced host_profiles model override (fails closed) and keeps the shared value", () => {
    const LOCAL = "local-only-profile-model";
    const r = renderHostConfig("claude-code-cli", baseInput({
      config: { host_profiles: { "claude-code-cli": { models: { cheap: LOCAL } } } },
      sources: { "host_profiles.claude-code-cli.models.cheap": "project-local" },
    }));
    expect(JSON.stringify(r)).not.toContain(LOCAL);
    expect(r.models?.cheap).not.toBe(LOCAL); // fell back to the shared tiers/registry value
    expect(r._redactions?.some((x) => x.reason === "local-scope" && x.field === "host_profiles.claude-code-cli.models.cheap")).toBe(true);
    expect(r.ok).toBe(false);
  });
});

// ── Codex G-lane MAJOR 2 — every emitted string is secret-scanned, incl. _source_version ──
describe("secret scan covers caller-supplied scalar fields", () => {
  it("redacts a secret in sourceVersion and never emits it raw", () => {
    const secret = "ghp_0123456789abcdefghijABCDEFGHIJ012345";
    const r = renderHostConfig("claude-code-cli", baseInput({
      sources: {},
      options: { renderedAt: NOW, sourceVersion: `build ${secret}` },
    }));
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(r._redactions?.some((x) => x.reason === "secret" && x.field === "_source_version")).toBe(true);
    expect(r.ok).toBe(false);
  });
});

// ── Codex G-lane BLOCKER 2 — absent sources must NOT silently fail open ──
describe("local-scope guard verifiability (_local_guard)", () => {
  it("sources supplied ⇒ _local_guard 'enforced'", () => {
    const r = renderHostConfig("claude-code-cli", baseInput({ sources: {} }));
    expect(r._local_guard).toBe("enforced");
  });

  it("NO sources under failMode 'closed' ⇒ unverified + fails closed (ok:false/blocked)", () => {
    const r = renderHostConfig("claude-code-cli", baseInput({ sources: undefined }));
    expect(r._local_guard).toBe("unverified");
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r._redactions?.some((x) => x.field === "(sources)")).toBe(true);
  });

  it("NO sources under failMode 'open' ⇒ unverified but warn-and-proceed (ok:true)", () => {
    const r = renderHostConfig("claude-code-cli", baseInput({ sources: undefined, options: { renderedAt: NOW, failMode: "open" } }));
    expect(r._local_guard).toBe("unverified");
    expect(r.ok).toBe(true);
    expect(r.blocked).toBe(false);
  });
});
