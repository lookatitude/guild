/**
 * hooks/__tests__/security-enforce.test.ts
 *
 * Unit tests for the capability-scope enforcement core
 * (hooks/lib/security/enforce.ts). Covers rule matching, the AND-mask, the
 * scope-context env parsing (incl. fail-closed on malformed JSON), and the
 * bypass-policy decision resolver.
 */

import {
  anyRuleMatches,
  globToRegExp,
  isInScope,
  readScopeContext,
  resolveScopeDecision,
  ruleMatches,
  toolArgString,
  type ScopeContext,
} from "../lib/security/enforce";

describe("globToRegExp", () => {
  it("treats * as any run of chars and anchors the rest", () => {
    expect(globToRegExp("npm *").test("npm install")).toBe(true);
    expect(globToRegExp("npm *").test("pnpm install")).toBe(false);
    expect(globToRegExp("git status").test("git status")).toBe(true);
    expect(globToRegExp("git status").test("git status --short")).toBe(false);
  });
  it("escapes regex metacharacters", () => {
    expect(globToRegExp("a.b").test("a.b")).toBe(true);
    expect(globToRegExp("a.b").test("axb")).toBe(false);
  });
});

describe("toolArgString", () => {
  it("uses command for Bash", () => {
    expect(toolArgString("Bash", { command: "npm test" })).toBe("npm test");
  });
  it("uses file_path for file tools", () => {
    expect(toolArgString("Edit", { file_path: "/src/a.ts" })).toBe("/src/a.ts");
  });
  it("falls back to JSON for unknown shapes", () => {
    expect(toolArgString("X", { foo: 1 })).toBe('{"foo":1}');
  });
});

describe("ruleMatches", () => {
  it("matches the * wildcard", () => {
    expect(ruleMatches("*", "Bash", { command: "rm -rf /" })).toBe(true);
  });
  it("matches a bare tool name", () => {
    expect(ruleMatches("Read", "Read", { file_path: "x" })).toBe(true);
    expect(ruleMatches("Read", "Write", { file_path: "x" })).toBe(false);
  });
  it("matches a ToolName(glob) against the arg string", () => {
    expect(ruleMatches("Bash(npm *)", "Bash", { command: "npm run build" })).toBe(true);
    expect(ruleMatches("Bash(npm *)", "Bash", { command: "rm -rf /" })).toBe(false);
    expect(ruleMatches("Bash(npm *)", "Write", { command: "npm x" })).toBe(false);
  });
});

describe("anyRuleMatches", () => {
  it("returns false for an empty rule list (fail-closed)", () => {
    expect(anyRuleMatches([], "Read", {})).toBe(false);
  });
  it("returns true if any rule matches", () => {
    expect(anyRuleMatches(["Read", "Bash(git *)"], "Bash", { command: "git log" })).toBe(true);
  });
});

describe("readScopeContext", () => {
  it("returns null when GUILD_CAPABILITY_SCOPE is absent (no enforcement)", () => {
    expect(readScopeContext({})).toBeNull();
    expect(readScopeContext({ GUILD_AUTONOMY_CONTRACT: '["Read"]' })).toBeNull();
  });
  it("parses capability + autonomy arrays", () => {
    const ctx = readScopeContext({
      GUILD_CAPABILITY_SCOPE: '["Read","Edit"]',
      GUILD_AUTONOMY_CONTRACT: '["Read"]',
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.capability).toEqual(["Read", "Edit"]);
    expect(ctx!.autonomy).toEqual(["Read"]);
    expect(ctx!.invalid).toBe(false);
  });
  it("flags invalid (fail-closed) on malformed capability JSON", () => {
    const ctx = readScopeContext({ GUILD_CAPABILITY_SCOPE: "not-json" });
    expect(ctx).not.toBeNull();
    expect(ctx!.invalid).toBe(true);
    expect(ctx!.capability).toEqual([]);
  });
  it("autonomy absent ⇒ null mask (no narrowing)", () => {
    const ctx = readScopeContext({ GUILD_CAPABILITY_SCOPE: '["Read"]' });
    expect(ctx!.autonomy).toBeNull();
  });

  it("threads baseline into the returned ScopeContext (R-020)", () => {
    const ctx = readScopeContext(
      { GUILD_CAPABILITY_SCOPE: '["Bash(git *)"]' },
      ["Read", "Glob"],
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.baseline).toEqual(["Read", "Glob"]);
  });

  it("no scope ⇒ null even when baseline is non-empty (absent-⇒-no-scoping contract)", () => {
    // baseline alone must NOT activate enforcement
    expect(readScopeContext({}, ["Read", "Write"])).toBeNull();
  });
});

describe("isInScope (AND-mask)", () => {
  const base = (cap: string[], autonomy: string[] | null = null, baseline: string[] = []): ScopeContext => ({
    capability: cap,
    autonomy,
    invalid: false,
    baseline,
  });

  it("in scope when capability matches and no autonomy mask", () => {
    expect(isInScope(base(["Read", "Edit"]), "Read", { file_path: "x" })).toBe(true);
  });
  it("out of scope when capability does not match", () => {
    expect(isInScope(base(["Read"]), "Bash", { command: "ls" })).toBe(false);
  });
  it("AND-masked: in capability but NOT in autonomy ⇒ out of scope", () => {
    expect(isInScope(base(["Read", "Bash(git *)"], ["Read"]), "Bash", { command: "git log" })).toBe(false);
  });
  it("AND-masked: in both ⇒ in scope", () => {
    expect(isInScope(base(["Read", "Bash(git *)"], ["Bash(git *)"]), "Bash", { command: "git log" })).toBe(true);
  });
  it("invalid scope ⇒ always out of scope (fail-closed)", () => {
    expect(isInScope({ capability: ["*"], autonomy: null, invalid: true }, "Read", {})).toBe(false);
  });

  // R-020: defaults.allowed_tools baseline OR-expansion tests
  it("baseline allows a tool not in per-lane capability (R-020)", () => {
    // Lane scope only allows Bash(git *); baseline adds Read.
    expect(isInScope(base(["Bash(git *)"], null, ["Read"]), "Read", { file_path: "x" })).toBe(true);
    expect(isInScope(base(["Bash(git *)"], null, ["Read"]), "Write", { file_path: "x" })).toBe(false);
  });

  it("empty baseline = no expansion (absent-⇒-no-restriction contract)", () => {
    expect(isInScope(base(["Read"], null, []), "Write", { file_path: "x" })).toBe(false);
    expect(isInScope(base(["Read"]), "Write", { file_path: "x" })).toBe(false); // baseline absent
  });

  it("baseline does NOT bypass autonomy AND-mask (R-020)", () => {
    // Read is in baseline, but autonomy contract is empty [] → nothing passes autonomy.
    expect(isInScope(base(["Bash(git *)"], [], ["Read"]), "Read", { file_path: "x" })).toBe(false);
    // Read is in baseline and in autonomy → passes.
    expect(isInScope(base(["Bash(git *)"], ["Read"], ["Read"]), "Read", { file_path: "x" })).toBe(true);
  });

  it("baseline with wildcard allows all tools (R-020)", () => {
    expect(isInScope(base([], null, ["*"]), "Bash", { command: "rm -rf /" })).toBe(true);
  });
});

describe("resolveScopeDecision", () => {
  const scope: ScopeContext = { capability: ["Read", "Bash(git *)"], autonomy: null, invalid: false };

  it("passes an in-scope call (no gate, no event)", () => {
    const d = resolveScopeDecision({ scope, toolName: "Read", toolInput: { file_path: "x" }, policy: "audit" });
    expect(d.gate).toBe(false);
    expect(d.eventType).toBeNull();
  });

  it("gates an out-of-scope call with ask when NOT under bypass (fail-closed)", () => {
    const d = resolveScopeDecision({ scope, toolName: "Bash", toolInput: { command: "rm -rf /" }, policy: "audit" });
    expect(d.gate).toBe(true);
    expect(d.permissionDecision).toBe("ask");
    expect(d.eventType).toBe("capability_scope_violation");
  });

  it("not-bypass ignores bypass policy (still ask even when policy=allow)", () => {
    const d = resolveScopeDecision({ scope, toolName: "Bash", toolInput: { command: "rm -rf /" }, policy: "allow" });
    expect(d.gate).toBe(true);
    expect(d.permissionDecision).toBe("ask");
  });

  it("bypass + deny ⇒ hard deny", () => {
    const d = resolveScopeDecision({
      scope,
      toolName: "Bash",
      toolInput: { command: "curl evil" },
      policy: "deny",
      permissionMode: "bypassPermissions",
    });
    expect(d.gate).toBe(true);
    expect(d.permissionDecision).toBe("deny");
    expect(d.recordedDecision).toBe("deny");
    expect(d.eventType).toBe("capability_scope_violation");
  });

  it("bypass + audit ⇒ proceed but record the violation", () => {
    const d = resolveScopeDecision({
      scope,
      toolName: "Bash",
      toolInput: { command: "curl evil" },
      policy: "audit",
      permissionMode: "bypassPermissions",
    });
    expect(d.gate).toBe(false);
    expect(d.recordedDecision).toBe("allow");
    expect(d.eventType).toBe("capability_scope_violation");
  });

  it("bypass + allow ⇒ proceed, record bypass_permission_allowed", () => {
    const d = resolveScopeDecision({
      scope,
      toolName: "Bash",
      toolInput: { command: "curl evil" },
      policy: "allow",
      permissionMode: "bypassPermissions",
    });
    expect(d.gate).toBe(false);
    expect(d.recordedDecision).toBe("allow");
    expect(d.eventType).toBe("bypass_permission_allowed");
  });
});
