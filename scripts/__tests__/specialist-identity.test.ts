/**
 * scripts/__tests__/specialist-identity.test.ts
 *
 * G7 (task-cell-runtime P1.1) conformance for the two UPSTREAM identity schemas
 * the G2 `guild.agent_instance.v1` binds by hash — `guild.specialist_type.v2` and
 * `guild.specialist_profile.v1` — plus the deterministic hashing and the REAL
 * feedstock projections.
 *
 * Non-vacuous: the type projections run against the ACTUAL shipped template
 * library (`templates/specialists/*.md`) via the shared frontmatter parser, so the
 * tiers under test are the real `model:` frontmatter values mapped through
 * `tierForModel` — a template that regressed to carrying a provider model name in
 * its projected tier fails a test. The profile projection runs against a real
 * `.guild/agents/*.md` when one exists, and always against a hand-authored fixture.
 */

import * as fs from "fs";
import * as path from "path";

import { parseFrontmatter } from "../lib/frontmatter";
import {
  MODEL_TIERS,
  SPECIALIST_PROFILE_SCHEMA,
  SPECIALIST_TYPE_SCHEMA,
  TOOL_TO_CAPABILITY,
  canonicalJson,
  hashSpecialistProfile,
  hashSpecialistType,
  specialistProfileFromAgentFrontmatter,
  specialistTypeFromTemplateFrontmatter,
  validateSpecialistProfileV1,
  validateSpecialistTypeV2,
  type SpecialistProfileV1,
  type SpecialistTypeBinding,
  type SpecialistTypeV2,
} from "../lib/core/contracts/specialist-identity";
import {
  AGENT_INSTANCE_SCHEMA,
  type AgentInstanceV1,
  type ModelTier,
} from "../lib/core/contracts/task-cell-backend";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const TEMPLATES_DIR = path.join(PLUGIN_ROOT, "templates", "specialists");
const PROJECT_AGENTS_DIR = path.join(PLUGIN_ROOT, ".guild", "agents");

const TIER_SET = new Set<string>(MODEL_TIERS);
const PROVIDER_NAMES = new Set(["opus", "sonnet", "haiku", "gpt", "claude", "gemini"]);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function goodType(over: Partial<SpecialistTypeV2> = {}): SpecialistTypeV2 {
  return {
    schema_version: SPECIALIST_TYPE_SCHEMA,
    type_id: "architect",
    version: "1",
    role: "architect",
    capability_tags: ["systems-design", "adr"],
    compatible_skill_refs: ["architect-systems-design", "architect-adr-writer"],
    semantic_tool_requirements: ["read-files", "write-files", "run-shell"],
    default_model_tier: "powerful",
    constraints: { operating_style: "methodical" },
    eval_fixture_refs: [],
    ...over,
  };
}

function goodBinding(over: Partial<SpecialistTypeBinding> = {}): SpecialistTypeBinding {
  const t = goodType();
  return {
    type_id: t.type_id,
    type_version: t.version,
    type_hash: hashSpecialistType(t),
    ...over,
  };
}

function goodProfile(over: Partial<SpecialistProfileV1> = {}): SpecialistProfileV1 {
  return {
    schema_version: SPECIALIST_PROFILE_SCHEMA,
    profile_id: "architect",
    version: "1",
    derived_from: goodBinding(),
    project_instructions: "Prefer hexagonal boundaries in this repo.",
    local_skill_refs: ["repo-adr-style"],
    ...over,
  };
}

/** A minimal AgentInstanceV1 literal (no G2 builder ships; brief §adversarial-2). */
function agentInstance(over: Partial<AgentInstanceV1>): AgentInstanceV1 {
  return {
    schema_version: AGENT_INSTANCE_SCHEMA,
    instance_id: "inst-A",
    run_id: "run-1",
    cell_id: "cell-1",
    logical_task_id: "task-1",
    task_run_id: "task-1#a",
    attempt: 1,
    attempt_id: "att-A",
    worker_role: "architect",
    specialist_type_id: "architect",
    specialist_type_version: "1",
    specialist_type_hash: "TYPE_HASH_PLACEHOLDER",
    specialist_profile_id: "architect",
    specialist_profile_hash: "PROFILE_HASH_PLACEHOLDER",
    host_id: "claude-code-cli",
    adapter_id: "tmux",
    host_capabilities_hash: "hostcaps-1",
    substrate: "tmux",
    model_tier: "powerful",
    model_id: null,
    context_bundle_id: "ctx-A",
    context_bundle_hash: "ctxhash-A",
    projection: { tools: [], permissions: [], recorded_losses: [] },
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    created_at: "2026-07-16T00:00:00Z",
    started_at: null,
    terminated_at: null,
    terminal_state: null,
    terminal_reason: null,
    ...over,
  };
}

function listTemplateFrontmatters(): Array<{ name: string; fm: Record<string, unknown> }> {
  return fs
    .readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const fm = parseFrontmatter(fs.readFileSync(path.join(TEMPLATES_DIR, f), "utf8"));
      return { name: f, fm: (fm ?? {}) as Record<string, unknown> };
    });
}

// ── Schema strings + validators are exported & frozen ────────────────────────

describe("frozen schema strings", () => {
  it("carry the G7 identity versions", () => {
    expect(SPECIALIST_TYPE_SCHEMA).toBe("guild.specialist_type.v2");
    expect(SPECIALIST_PROFILE_SCHEMA).toBe("guild.specialist_profile.v1");
  });
});

// ── Adversarial test 2 (the acceptance) ──────────────────────────────────────

describe("adversarial test 2 — shared type/profile identity, never-shared instance identity", () => {
  it("two instances from the SAME type+profile share both hashes but never share instance identity", () => {
    // One type + one profile → one type_hash + one profile_hash.
    const type = goodType();
    const typeHash = hashSpecialistType(type);
    const profile = goodProfile({
      derived_from: { type_id: type.type_id, type_version: type.version, type_hash: typeHash },
    });
    const profileHash = hashSpecialistProfile(profile);

    // Two DISTINCT (task_run_id, attempt) instances built from that identity.
    const a = agentInstance({
      instance_id: "inst-A",
      task_run_id: "task-1#a",
      attempt: 1,
      attempt_id: "att-A",
      specialist_type_hash: typeHash,
      specialist_profile_hash: profileHash,
      context_bundle_id: "ctx-A",
      context_bundle_hash: "ctxhash-A",
      terminal_state: "terminated",
      terminal_reason: "done-A",
    });
    const b = agentInstance({
      instance_id: "inst-B",
      task_run_id: "task-1#b",
      attempt: 2,
      attempt_id: "att-B",
      specialist_type_hash: typeHash,
      specialist_profile_hash: profileHash,
      context_bundle_id: "ctx-B",
      context_bundle_hash: "ctxhash-B",
      terminal_state: "failed",
      terminal_reason: "done-B",
    });

    // SHARED type/profile identity.
    expect(a.specialist_type_hash).toBe(b.specialist_type_hash);
    expect(a.specialist_profile_hash).toBe(b.specialist_profile_hash);

    // NEVER-SHARED instance identity, context, or terminal record.
    expect(a.instance_id).not.toBe(b.instance_id);
    expect(a.task_run_id).not.toBe(b.task_run_id);
    expect(a.context_bundle_hash).not.toBe(b.context_bundle_hash);
    expect([a.terminal_state, a.terminal_reason]).not.toEqual([
      b.terminal_state,
      b.terminal_reason,
    ]);
  });
});

// ── Real feedstock parses ────────────────────────────────────────────────────

describe("real shipped template feedstock projects to a valid SpecialistTypeV2", () => {
  const templates = listTemplateFrontmatters();

  it("finds the shipped template library", () => {
    expect(templates.length).toBeGreaterThanOrEqual(10);
  });

  it.each(templates.map((t) => [t.name, t.fm] as const))(
    "%s → a valid v2 type carrying a TIER (never a provider name)",
    (_name, fm) => {
      const type = specialistTypeFromTemplateFrontmatter(fm);
      expect(type).not.toBeNull();
      const t = type as SpecialistTypeV2;
      // A tier, not a provider model name.
      expect(TIER_SET.has(t.default_model_tier)).toBe(true);
      expect(PROVIDER_NAMES.has(t.default_model_tier as string)).toBe(false);
      // Round-trips through its own validator.
      expect(validateSpecialistTypeV2(t)).toEqual(t);
      // type_id/role came from the template `name`.
      expect(t.type_id).toBe(fm["name"]);
      expect(t.role).toBe(fm["name"]);
    }
  );

  it("maps the architect template's provider `opus` model → the `powerful` tier", () => {
    const arch = templates.find((t) => t.name === "architect.md");
    expect(arch).toBeDefined();
    const t = specialistTypeFromTemplateFrontmatter(arch!.fm) as SpecialistTypeV2;
    expect(t.default_model_tier).toBe("powerful");
    // Concrete host tools became semantic requirements.
    expect(t.semantic_tool_requirements).toContain("read-files");
    expect(t.semantic_tool_requirements).not.toContain("Read");
  });
});

describe("real / fixture agent feedstock projects to a valid SpecialistProfileV1", () => {
  const binding = goodBinding();

  it("a hand-authored `.guild/agents/<role>.md`-shaped frontmatter projects", () => {
    const fm = {
      name: "architect",
      description: "Project architect specialist.",
      model: "opus",
      skills: ["guild-principles", "architect-systems-design"],
      project_instructions: "Prefer hexagonal boundaries.",
    } as Record<string, unknown>;
    const profile = specialistProfileFromAgentFrontmatter(fm, binding);
    expect(profile).not.toBeNull();
    const p = profile as SpecialistProfileV1;
    expect(p.profile_id).toBe("architect");
    expect(p.derived_from).toEqual(binding);
    expect(p.local_skill_refs).toEqual(["guild-principles", "architect-systems-design"]);
    expect(validateSpecialistProfileV1(p)).toEqual(p);
  });

  it("every real minted `.guild/agents/*.md` (if any) projects to a valid profile", () => {
    if (!fs.existsSync(PROJECT_AGENTS_DIR)) return;
    const files = fs
      .readdirSync(PROJECT_AGENTS_DIR)
      .filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const fm = parseFrontmatter(fs.readFileSync(path.join(PROJECT_AGENTS_DIR, f), "utf8"));
      if (!fm) continue; // registry.yaml et al. carry no frontmatter — skip
      const profile = specialistProfileFromAgentFrontmatter(
        fm as Record<string, unknown>,
        binding
      );
      expect(profile).not.toBeNull();
    }
  });
});

// ── Hash stability ───────────────────────────────────────────────────────────

describe("hash stability", () => {
  it("same type → same hash", () => {
    expect(hashSpecialistType(goodType())).toBe(hashSpecialistType(goodType()));
  });

  it("key-reordered-but-structurally-equal type → SAME hash (key-order-independent)", () => {
    const a = goodType();
    // Rebuild with keys inserted in reverse order + reordered constraint keys.
    const reordered = {
      eval_fixture_refs: a.eval_fixture_refs,
      constraints: { operating_style: "methodical" },
      default_model_tier: a.default_model_tier,
      semantic_tool_requirements: a.semantic_tool_requirements,
      compatible_skill_refs: a.compatible_skill_refs,
      capability_tags: a.capability_tags,
      role: a.role,
      version: a.version,
      type_id: a.type_id,
      schema_version: a.schema_version,
    } as unknown as SpecialistTypeV2;
    expect(hashSpecialistType(reordered)).toBe(hashSpecialistType(a));
    // canonicalJson is itself key-order-independent.
    expect(canonicalJson(reordered)).toBe(canonicalJson(a));
  });

  it("any type field change → different hash (content-sensitive)", () => {
    const base = hashSpecialistType(goodType());
    expect(hashSpecialistType(goodType({ version: "2" }))).not.toBe(base);
    expect(hashSpecialistType(goodType({ default_model_tier: "mid" }))).not.toBe(base);
    expect(hashSpecialistType(goodType({ capability_tags: ["x"] }))).not.toBe(base);
    expect(hashSpecialistType(goodType({ constraints: { operating_style: "bold" } }))).not.toBe(
      base
    );
  });

  it("same profile → same hash; a bound type_hash change → different profile hash", () => {
    const base = hashSpecialistProfile(goodProfile());
    expect(hashSpecialistProfile(goodProfile())).toBe(base);
    const rebound = goodProfile({
      derived_from: goodBinding({ type_hash: "deadbeef" }),
    });
    expect(hashSpecialistProfile(rebound)).not.toBe(base);
  });

  it("key-reordered profile → SAME hash", () => {
    const a = goodProfile();
    const reordered = {
      local_skill_refs: a.local_skill_refs,
      project_instructions: a.project_instructions,
      derived_from: {
        type_hash: a.derived_from.type_hash,
        type_version: a.derived_from.type_version,
        type_id: a.derived_from.type_id,
      },
      version: a.version,
      profile_id: a.profile_id,
      schema_version: a.schema_version,
    } as unknown as SpecialistProfileV1;
    expect(hashSpecialistProfile(reordered)).toBe(hashSpecialistProfile(a));
  });

  it("array order IS significant (arrays are ordered data)", () => {
    const a = hashSpecialistType(goodType({ capability_tags: ["a", "b"] }));
    const b = hashSpecialistType(goodType({ capability_tags: ["b", "a"] }));
    expect(a).not.toBe(b);
  });
});

// ── Validators fail-closed ───────────────────────────────────────────────────

describe("validateSpecialistTypeV2 fails closed", () => {
  it("accepts a good type unchanged", () => {
    expect(validateSpecialistTypeV2(goodType())).toEqual(goodType());
  });

  it("rejects a wrong schema_version", () => {
    expect(validateSpecialistTypeV2(goodType({ schema_version: "guild.specialist_type.v1" as never }))).toBeNull();
  });

  it("rejects a PROVIDER model name in default_model_tier", () => {
    expect(
      validateSpecialistTypeV2({ ...goodType(), default_model_tier: "opus" })
    ).toBeNull();
    expect(
      validateSpecialistTypeV2({ ...goodType(), default_model_tier: "sonnet" })
    ).toBeNull();
  });

  it("rejects an unknown top-level key", () => {
    expect(validateSpecialistTypeV2({ ...goodType(), rogue: true })).toBeNull();
  });

  it("rejects a non-string array entry", () => {
    expect(
      validateSpecialistTypeV2({ ...goodType(), capability_tags: ["ok", 42] })
    ).toBeNull();
  });

  it("rejects a sparse array (hole would serialize to null on re-read)", () => {
    const sparse: string[] = ["a"];
    sparse[2] = "c"; // index 1 is a hole
    expect(validateSpecialistTypeV2({ ...goodType(), compatible_skill_refs: sparse })).toBeNull();
  });

  it("rejects an accessor-index array (TOCTOU: valid on 1st read, garbage on 2nd)", () => {
    // A single-read own-data-descriptor sanitizer must reject a getter index outright
    // (never validate one value then store another). Codex's exact counterexample.
    let reads = 0;
    const tags: unknown[] = [];
    Object.defineProperty(tags, "0", {
      enumerable: true,
      configurable: true,
      get() {
        return ++reads <= 1 ? "ok" : 42;
      },
    });
    const out = validateSpecialistTypeV2({ ...goodType(), capability_tags: tags as string[] });
    expect(out).toBeNull(); // must NOT return { capability_tags: [42] }
  });

  it("rejects a Proxy array whose length shrinks mid-loop (hides a bad entry)", () => {
    let n = 2;
    const evil = new Proxy(["x", 42], {
      get(target, p, recv) {
        if (p === "length") return n--; // decreasing on each re-read
        return Reflect.get(target, p, recv);
      },
    });
    const out = validateSpecialistTypeV2({ ...goodType(), capability_tags: evil as unknown as string[] });
    expect(out).toBeNull(); // length snapshotted once ⇒ index 1 (42) is still checked → null
  });

  it("rejects an array carrying symbol-keyed data (fail-closed, not silently dropped)", () => {
    const arr: string[] = ["a"];
    (arr as unknown as Record<symbol, unknown>)[Symbol("x")] = "hidden";
    expect(validateSpecialistTypeV2({ ...goodType(), capability_tags: arr })).toBeNull();
  });

  it("rejects a Proxy array that lies about length via a getOwnPropertyDescriptor trap", () => {
    const evil = new Proxy(["ok", 42], {
      getOwnPropertyDescriptor(target, p) {
        if (p === "length") return { value: 1, writable: true, enumerable: false, configurable: true };
        return Reflect.getOwnPropertyDescriptor(target, p);
      },
    });
    expect(
      validateSpecialistTypeV2({ ...goodType(), capability_tags: evil as unknown as string[] })
    ).toBeNull(); // a Proxy is rejected outright — it cannot hide index 1's 42
  });

  it("rejects a Proxy array whose ownKeys trap hides a symbol-keyed entry", () => {
    const target: string[] = ["ok"];
    (target as unknown as Record<symbol, unknown>)[Symbol("x")] = "hidden";
    const evil = new Proxy(target, {
      ownKeys(t) {
        return Reflect.ownKeys(t).filter((k) => typeof k !== "symbol"); // hide the symbol
      },
    });
    expect(
      validateSpecialistTypeV2({ ...goodType(), capability_tags: evil as unknown as string[] })
    ).toBeNull();
  });

  it("rejects a Proxy over the top-level type object", () => {
    const evil = new Proxy(goodType(), {}); // even a transparent Proxy is rejected
    expect(validateSpecialistTypeV2(evil)).toBeNull();
  });

  it("rejects a Proxy ARRAY nested inside constraints (deep clone must not read through it)", () => {
    const nested = new Proxy(["ok", 42], {
      getOwnPropertyDescriptor(target, p) {
        if (p === "length") return { value: 1, writable: true, enumerable: false, configurable: true };
        return Reflect.getOwnPropertyDescriptor(target, p);
      },
    });
    expect(
      validateSpecialistTypeV2({ ...goodType(), constraints: { nested } })
    ).toBeNull();
  });

  it("rejects an accessor-index array nested inside constraints", () => {
    const arr: unknown[] = ["ok"];
    Object.defineProperty(arr, "1", { enumerable: true, configurable: true, get: () => 42 });
    expect(
      validateSpecialistTypeV2({ ...goodType(), constraints: { arr } })
    ).toBeNull();
  });

  it("never throws on a throwing getter (accessor field → null)", () => {
    const evil: Record<string, unknown> = { ...goodType() };
    Object.defineProperty(evil, "type_id", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(() => validateSpecialistTypeV2(evil)).not.toThrow();
    expect(validateSpecialistTypeV2(evil)).toBeNull();
  });

  it("never throws + rejects a prototype-pollution carrier", () => {
    const polluted = Object.create({ default_model_tier: "powerful" });
    Object.assign(polluted, {
      schema_version: SPECIALIST_TYPE_SCHEMA,
      type_id: "x",
      version: "1",
      role: "x",
      capability_tags: [],
      compatible_skill_refs: [],
      semantic_tool_requirements: [],
      // default_model_tier deliberately only on the PROTOTYPE, not own
      constraints: {},
      eval_fixture_refs: [],
    });
    expect(() => validateSpecialistTypeV2(polluted)).not.toThrow();
    // Exotic (non-plain) prototype ⇒ reject outright.
    expect(validateSpecialistTypeV2(polluted)).toBeNull();
  });

  it("rejects a constraints carrying a non-JSON (function) value", () => {
    expect(
      validateSpecialistTypeV2({ ...goodType(), constraints: { f: () => 1 } })
    ).toBeNull();
  });

  it("rejects a non-object", () => {
    expect(validateSpecialistTypeV2(null)).toBeNull();
    expect(validateSpecialistTypeV2("x")).toBeNull();
    expect(validateSpecialistTypeV2([goodType()])).toBeNull();
  });
});

describe("validateSpecialistProfileV1 fails closed", () => {
  it("accepts a good profile unchanged", () => {
    expect(validateSpecialistProfileV1(goodProfile())).toEqual(goodProfile());
  });

  it("rejects a wrong schema_version", () => {
    expect(
      validateSpecialistProfileV1(goodProfile({ schema_version: "guild.specialist_profile.v2" as never }))
    ).toBeNull();
  });

  it("rejects a malformed derived_from binding", () => {
    expect(
      validateSpecialistProfileV1({ ...goodProfile(), derived_from: { type_id: "x" } })
    ).toBeNull();
    expect(
      validateSpecialistProfileV1({
        ...goodProfile(),
        derived_from: { type_id: "x", type_version: "1", type_hash: "", extra: 1 },
      })
    ).toBeNull();
  });

  it("rejects an unknown top-level key", () => {
    expect(validateSpecialistProfileV1({ ...goodProfile(), rogue: 1 })).toBeNull();
  });

  it("rejects a non-string local_skill_refs entry + accepts null project_instructions", () => {
    expect(
      validateSpecialistProfileV1({ ...goodProfile(), local_skill_refs: [1] })
    ).toBeNull();
    const noInstr = validateSpecialistProfileV1(goodProfile({ project_instructions: null }));
    expect(noInstr).not.toBeNull();
    expect((noInstr as SpecialistProfileV1).project_instructions).toBeNull();
  });

  it("never throws on a throwing getter", () => {
    const evil: Record<string, unknown> = { ...goodProfile() };
    Object.defineProperty(evil, "profile_id", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(() => validateSpecialistProfileV1(evil)).not.toThrow();
    expect(validateSpecialistProfileV1(evil)).toBeNull();
  });

  it("rejects an accessor-index local_skill_refs (TOCTOU double-read)", () => {
    let reads = 0;
    const skills: unknown[] = [];
    Object.defineProperty(skills, "0", {
      enumerable: true,
      configurable: true,
      get() {
        return ++reads <= 1 ? "ok" : 42;
      },
    });
    const out = validateSpecialistProfileV1(goodProfile({ local_skill_refs: skills as string[] }));
    expect(out).toBeNull();
  });
});

// ── Projection fail-closed ───────────────────────────────────────────────────

describe("projections fail closed", () => {
  it("template projection rejects a missing template_version", () => {
    expect(specialistTypeFromTemplateFrontmatter({ name: "x", model: "opus" })).toBeNull();
  });

  it("template projection rejects a model that yields no tier + no default_tier", () => {
    expect(
      specialistTypeFromTemplateFrontmatter({
        template_version: "guild.specialist_template.v1",
        name: "x",
        model: "some-unknown-provider-model",
      })
    ).toBeNull();
  });

  it("template projection: explicit default_tier wins over the model mapping", () => {
    const t = specialistTypeFromTemplateFrontmatter({
      template_version: "guild.specialist_template.v1",
      name: "x",
      model: "opus", // would map to powerful
      default_tier: "cheap", // but the explicit tier wins
    });
    expect((t as SpecialistTypeV2).default_model_tier).toBe("cheap");
  });

  it("TOOL_TO_CAPABILITY maps the known host tools; unknown carried verbatim", () => {
    const t = specialistTypeFromTemplateFrontmatter({
      template_version: "guild.specialist_template.v1",
      name: "x",
      model: "sonnet",
      tools: "Read, Bash, SomeExoticTool",
    }) as SpecialistTypeV2;
    expect(t.semantic_tool_requirements).toEqual([
      TOOL_TO_CAPABILITY.Read,
      TOOL_TO_CAPABILITY.Bash,
      "SomeExoticTool",
    ]);
  });

  it("profile projection rejects a bad binding", () => {
    expect(
      specialistProfileFromAgentFrontmatter({ name: "x" }, { type_id: "x" } as never)
    ).toBeNull();
  });

  it("a projected type + profile hash cleanly (end-to-end)", () => {
    const t = specialistTypeFromTemplateFrontmatter({
      template_version: "guild.specialist_template.v1",
      name: "backend",
      model: "sonnet",
      skills: ["backend-api-contract"],
      tools: "Read, Write, Bash",
    }) as SpecialistTypeV2;
    const th = hashSpecialistType(t);
    const p = specialistProfileFromAgentFrontmatter(
      { name: "backend", skills: ["repo-conventions"] },
      { type_id: t.type_id, type_version: t.version, type_hash: th }
    ) as SpecialistProfileV1;
    expect(p.derived_from.type_hash).toBe(th);
    expect(typeof hashSpecialistProfile(p)).toBe("string");
    expect(hashSpecialistProfile(p)).toHaveLength(64); // sha256 hex
  });
});

// Silence unused import if the ModelTier type is only referenced structurally.
const _tierRef: ModelTier = "cheap";
void _tierRef;
