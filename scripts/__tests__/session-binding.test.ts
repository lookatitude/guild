/**
 * scripts/__tests__/session-binding.test.ts
 *
 * The six U-CFG success-criteria fixtures, verbatim from the plan's Verification
 * Contract (R38, R47):
 *
 *   1. Claude session then Codex continuation → two run bindings differing in
 *      host_family, model_family and prompt_compose.hash, with durable config and
 *      the overlay byte-identical.
 *   2. `config set models.tiers.claude` rejects.
 *   3. A project overlay containing `opus` rejects.
 *   4. An unknown host does NOT resolve to Claude defaults.
 *   5. `config set wiki.autopromote false` is accepted.
 *   6. Dialect fragments are ≤200 tokens and the composed text never reaches config.
 *
 * Usage (from plugin/scripts/):
 *   npx jest --testPathPattern=session-binding
 */

import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  bindSession,
  detectSession,
  isUnknownHost,
  readSessionBinding,
} from "../../src/modules/config/workflows/session-binding";
import {
  PolicyRejectedError,
  assertPolicyWrite,
  isPolicyKey,
} from "../../src/modules/config/workflows/policy-keys";
import { resolvePolicy } from "../../src/modules/config/workflows/policy-resolver";
import {
  DIALECT_TOKEN_BUDGET,
  approxTokens,
  composePrompt,
  loadPromptExtensions,
  PromptRejectedError,
} from "../../src/modules/prompting/workflows/compose-prompt";

const CONFIG_CMD = path.resolve(__dirname, "..", "config-cmd.ts");

function runConfig(args: string[]): { status: number; out: string } {
  const r = spawnSync("npx", ["tsx", CONFIG_CMD, ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function mkRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t06-"));
  fs.mkdirSync(path.join(dir, ".guild", "config"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".guild", "guild.yaml"), "kind: project\n");
  return dir;
}

/** sha256 of every durable file under `.guild/`, so "byte-identical" is checkable. */
function durableDigest(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, e.name);
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (r.startsWith("runs")) continue; // the run record is where identity belongs
        walk(abs, r);
      } else if (e.isFile()) {
        out[r] = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
      }
    }
  };
  walk(path.join(root, ".guild"), "");
  return out;
}

const BASE_PROMPT = "You are running Guild. Follow the phase spine.";

// ---------------------------------------------------------------------------
// Fixture 1 — Claude session, then a Codex continuation of the same initiative
// ---------------------------------------------------------------------------

describe("R38 · a Claude session then a Codex continuation writes two run bindings", () => {
  test("host_family, model_family and prompt_compose.hash all differ; durable files are byte-identical", () => {
    const root = mkRoot();
    fs.writeFileSync(
      path.join(root, ".guild", "config", "project.json"),
      JSON.stringify({ wiki: { autopromote: true }, advisorRounds: 2 }, null, 2) + "\n",
    );
    const overlayFile = path.join(root, "overlay.json");
    fs.writeFileSync(overlayFile, JSON.stringify({ "tiers.default": "mid" }, null, 2) + "\n");

    const before = durableDigest(root);
    const overlayBefore = fs.readFileSync(overlayFile, "utf8");

    // Session A — Claude.
    const a = detectSession({ CLAUDECODE: "1" } as NodeJS.ProcessEnv);
    expect(a.host_family).toBe("claude");
    expect(a.model_family).toBe("anthropic");
    const composedA = composePrompt(
      BASE_PROMPT,
      { dialect: { id: "dialect:anthropic", text: "One tool call at a time. Cite file and line." } },
      a.host_family,
      a.model_family,
    );
    const runA = path.join(root, ".guild", "runs", "run-a");
    const boundA = bindSession({
      runDir: runA,
      runId: "run-a",
      detected: a,
      promptCompose: {
        dialect_id: composedA.dialect_id,
        overlay_ids: composedA.overlay_ids,
        hash: composedA.hash,
      },
      models: { cheap: "tier-cheap", mid: "tier-mid", powerful: "tier-powerful" },
    });
    expect(boundA.ok).toBe(true);

    // Session B — the SAME initiative continued on Codex. A new session is a NEW
    // run, so it binds afresh rather than inheriting Claude's ids.
    const b = detectSession({ CODEX_HOME: "/x" } as NodeJS.ProcessEnv);
    expect(b.host_family).toBe("codex");
    expect(b.model_family).toBe("openai");
    const composedB = composePrompt(
      BASE_PROMPT,
      { dialect: { id: "dialect:openai", text: "Batch tool calls. Answer first, detail after." } },
      b.host_family,
      b.model_family,
    );
    const runB = path.join(root, ".guild", "runs", "run-b");
    bindSession({
      runDir: runB,
      runId: "run-b",
      detected: b,
      promptCompose: {
        dialect_id: composedB.dialect_id,
        overlay_ids: composedB.overlay_ids,
        hash: composedB.hash,
      },
      models: { cheap: "tier-cheap", mid: "tier-mid", powerful: "tier-powerful" },
    });

    const bindingA = readSessionBinding(runA)!;
    const bindingB = readSessionBinding(runB)!;
    expect(bindingA.host_family).not.toBe(bindingB.host_family);
    expect(bindingA.model_family).not.toBe(bindingB.model_family);
    expect(bindingA.prompt_compose.hash).not.toBe(bindingB.prompt_compose.hash);

    // R38: not one durable byte moved, and neither did the machine overlay.
    expect(durableDigest(root)).toEqual(before);
    expect(fs.readFileSync(overlayFile, "utf8")).toBe(overlayBefore);

    // R47: the composed TEXT is runtime-only — only its hash was persisted.
    const onDisk = fs.readFileSync(path.join(runA, "session-binding.json"), "utf8");
    expect(onDisk).not.toContain(BASE_PROMPT);
    expect(onDisk).toContain(bindingA.prompt_compose.hash);
  });

  test("a mid-run host change is refused with a continuation offer, never a silent rebind", () => {
    const root = mkRoot();
    const runDir = path.join(root, ".guild", "runs", "run-c");
    const claude = detectSession({ CLAUDECODE: "1" } as NodeJS.ProcessEnv);
    const compose = { dialect_id: "dialect:anthropic", overlay_ids: [], hash: "h" };
    bindSession({ runDir, runId: "run-c", detected: claude, promptCompose: compose });

    const codex = detectSession({ CODEX_HOME: "/x" } as NodeJS.ProcessEnv);
    const refused = bindSession({ runDir, runId: "run-c", detected: codex, promptCompose: compose }) as Extract<
      ReturnType<typeof bindSession>,
      { ok: false }
    >;
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe("host_changed_mid_run");
    expect(refused.message).toMatch(/NEW run on this host/);
    // The on-disk binding is untouched: in-flight assignments already named a host.
    expect(readSessionBinding(runDir)!.host_family).toBe("claude");
  });

  test("a same-host crash resume keeps the run's snapshot instead of re-detecting", () => {
    const root = mkRoot();
    const runDir = path.join(root, ".guild", "runs", "run-d");
    const claude = detectSession({ CLAUDECODE: "1" } as NodeJS.ProcessEnv);
    const first = bindSession({
      runDir,
      runId: "run-d",
      detected: claude,
      promptCompose: { dialect_id: "dialect:anthropic", overlay_ids: [], hash: "h1" },
    });
    const second = bindSession({
      runDir,
      runId: "run-d",
      detected: claude,
      promptCompose: { dialect_id: "dialect:anthropic", overlay_ids: [], hash: "h2" },
    });
    expect(first.ok && first.created).toBe(true);
    expect(second.ok && second.created).toBe(false);
    expect(readSessionBinding(runDir)!.prompt_compose.hash).toBe("h1");
  });
});

// ---------------------------------------------------------------------------
// Fixture 2 — `config set models.tiers.claude` rejects
// ---------------------------------------------------------------------------

describe("KTD22 · config set refuses per-host model inventory", () => {
  test("`config set models.tiers.claude` is rejected and writes nothing", () => {
    const root = mkRoot();
    const r = runConfig(["set", "models.tiers.claude", '{"cheap":"haiku"}', "--scope", "project", "--cwd", root]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/models\.tiers\.claude/);
    expect(r.out).toMatch(/host or model inventory/);
    expect(r.out).toMatch(/KTD22/);
    expect(fs.existsSync(path.join(root, ".guild", "config", "project.json"))).toBe(false);
  });

  test("the library gate names the key for a host-family write", () => {
    expect(() => assertPolicyWrite("tiers.claude", "opus")).toThrow(PolicyRejectedError);
    try {
      assertPolicyWrite("tiers.claude", "opus");
    } catch (e) {
      expect((e as PolicyRejectedError).key).toBe("tiers.claude");
      expect((e as Error).message).toMatch(/claude/);
    }
  });

  test("a policy value that is a concrete model name is refused", () => {
    expect(() => assertPolicyWrite("tiers.default", "opus")).toThrow(/opus/);
  });
});

// ---------------------------------------------------------------------------
// Fixture 3 — an overlay containing `opus` rejects
// ---------------------------------------------------------------------------

describe("KTD22 · a durable layer carrying a concrete model name fails closed at READ", () => {
  test("a machine overlay containing `opus` is rejected, naming the key", () => {
    const root = mkRoot();
    const overlay = path.join(root, "overlay.json");
    fs.writeFileSync(overlay, JSON.stringify({ tiers: { default: "opus" } }));
    expect(() => resolvePolicy({ cwd: root, overlayFile: overlay })).toThrow(/opus/);
  });

  test("a project policy file carrying models.tiers is rejected as inventory", () => {
    const root = mkRoot();
    fs.writeFileSync(
      path.join(root, ".guild", "config", "project.json"),
      JSON.stringify({ models: { tiers: { cheap: { "claude-code-cli": "haiku" } } } }),
    );
    expect(() => resolvePolicy({ cwd: root })).toThrow(/models/);
  });

  test("a `.guild/prompts/` dialect naming a concrete model is rejected, naming the file", () => {
    const root = mkRoot();
    const dialects = path.join(root, ".guild", "prompts", "dialects");
    fs.mkdirSync(dialects, { recursive: true });
    fs.writeFileSync(path.join(dialects, "anthropic.md"), "Prefer opus for long tasks.\n");
    expect(() => loadPromptExtensions(path.join(root, ".guild"), "anthropic")).toThrow(PromptRejectedError);
    try {
      loadPromptExtensions(path.join(root, ".guild"), "anthropic");
    } catch (e) {
      expect((e as PromptRejectedError).token.toLowerCase()).toBe("opus");
      expect((e as PromptRejectedError).file).toMatch(/anthropic\.md$/);
    }
  });

  test("a family-only dialect loads unchanged", () => {
    const root = mkRoot();
    const dialects = path.join(root, ".guild", "prompts", "dialects");
    fs.mkdirSync(dialects, { recursive: true });
    fs.writeFileSync(path.join(dialects, "anthropic.md"), "One tool call at a time. Cite file and line.\n");
    const loaded = loadPromptExtensions(path.join(root, ".guild"), "anthropic");
    expect(loaded.dialect?.id).toBe("dialect:anthropic");
  });
});

// ---------------------------------------------------------------------------
// Fixture 4 — an unknown host does NOT resolve to Claude defaults
// ---------------------------------------------------------------------------

describe("KTD22 · unknown host is unknown, never Claude", () => {
  test("no host signal → unknown family, unknown model family, unknown evidence", () => {
    const d = detectSession({} as NodeJS.ProcessEnv);
    expect(isUnknownHost(d)).toBe(true);
    expect(d.host_family).toBe("unknown");
    expect(d.model_family).not.toBe("anthropic");
    expect(d.evidence).toEqual({ cheap: "unknown", mid: "unknown", powerful: "unknown" });
  });

  test("an explicit but unrecognised family is unknown, not a near-match to Claude", () => {
    const d = detectSession({ GUILD_HOST_FAMILY: "claud" } as NodeJS.ProcessEnv);
    expect(d.host_family).toBe("unknown");
    expect(d.signal).toMatch(/unrecognised/);
  });

  test("an unknown host binds with an EMPTY tier map — a blocked dispatch, not a wrong one", () => {
    const root = mkRoot();
    const runDir = path.join(root, ".guild", "runs", "run-u");
    bindSession({
      runDir,
      runId: "run-u",
      detected: detectSession({} as NodeJS.ProcessEnv),
      promptCompose: { dialect_id: "dialect:none", overlay_ids: [], hash: "h" },
      // Even when a caller offers Claude's map, an unknown host does not take it.
      models: { cheap: "tier-cheap", mid: "tier-mid", powerful: "tier-powerful" },
    });
    expect(readSessionBinding(runDir)!.models).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Fixture 5 — `config set wiki.autopromote false` is accepted
// ---------------------------------------------------------------------------

describe("U-CFG · policy keys are accepted and land in the policy file", () => {
  test("`config set wiki.autopromote false` writes .guild/config/project.json", () => {
    const root = mkRoot();
    const r = runConfig(["set", "wiki.autopromote", "false", "--scope", "project", "--cwd", root]);
    expect(r.status).toBe(0);
    const file = path.join(root, ".guild", "config", "project.json");
    expect(r.out).toContain(file);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ wiki: { autopromote: false } });
    // And it reads back through the policy resolver with the right source.
    const resolved = resolvePolicy({ cwd: root });
    expect((resolved.policy as any).wiki.autopromote).toBe(false);
    expect(resolved.sources["wiki.autopromote"]).toBe("project");
  });

  test("the closed set covers exactly the plan's policy row", () => {
    for (const key of [
      "tiers.default",
      "tiers.floors.mid",
      "tiers.floors.powerful",
      "advisorRounds",
      "budget.tokens",
      "budget.usd",
      "team.compose_scope",
      "recall.backend",
      "recall.thresholds.min_score",
      "recall.thresholds.max_hits",
      "review.critic",
      "review.independence",
      "wiki.autopromote",
      "agent_mode",
    ]) {
      expect(isPolicyKey(key)).toBe(true);
    }
    for (const key of ["models.tiers.claude", "host_profiles.claude.enabled", "roles.host"]) {
      expect(isPolicyKey(key)).toBe(false);
    }
  });

  test("defaults fill in and later layers win, keeping the shipped inheritance order", () => {
    const root = mkRoot();
    fs.writeFileSync(
      path.join(root, ".guild", "config", "project.json"),
      JSON.stringify({ advisorRounds: 4 }),
    );
    const overlay = path.join(root, "overlay.json");
    fs.writeFileSync(overlay, JSON.stringify({ advisorRounds: 7 }));
    const noOverlay = resolvePolicy({ cwd: root });
    expect((noOverlay.policy as any).advisorRounds).toBe(4);
    expect((noOverlay.policy as any).wiki.autopromote).toBe(true); // builtin default
    const withOverlay = resolvePolicy({ cwd: root, overlayFile: overlay });
    expect((withOverlay.policy as any).advisorRounds).toBe(7);
    expect(withOverlay.sources["advisorRounds"]).toBe("overlay");
  });
});

// ---------------------------------------------------------------------------
// Fixture 6 — dialect budget, and compose never reaching config
// ---------------------------------------------------------------------------

describe("R47 · dialect fragments are ≤200 tokens and compose stays runtime-only", () => {
  test("an over-budget dialect is SKIPPED with a recorded reason, never truncated", () => {
    const long = "word ".repeat(400);
    expect(approxTokens(long)).toBeGreaterThan(DIALECT_TOKEN_BUDGET);
    const composed = composePrompt(
      BASE_PROMPT,
      { dialect: { id: "dialect:anthropic", text: long } },
      "claude",
      "anthropic",
    );
    expect(composed.skipped).toEqual([{ id: "dialect:anthropic", reason: "dialect-over-budget" }]);
    expect(composed.dialect_id).toBe("dialect:none");
    expect(composed.text).not.toContain(long.trim());
  });

  test("a dialect for another family does not load", () => {
    const composed = composePrompt(
      BASE_PROMPT,
      { dialect: { id: "dialect:openai", text: "Batch tool calls." } },
      "claude",
      "anthropic",
    );
    expect(composed.skipped).toEqual([{ id: "dialect:openai", reason: "wrong-family" }]);
  });

  test("compose is deterministic, and the hash changes with the host/model family", () => {
    const ext = { dialect: { id: "dialect:anthropic", text: "Cite file and line." } };
    const one = composePrompt(BASE_PROMPT, ext, "claude", "anthropic");
    const two = composePrompt(BASE_PROMPT, ext, "claude", "anthropic");
    expect(one.hash).toBe(two.hash);
    const other = composePrompt(BASE_PROMPT, ext, "codex", "openai");
    expect(other.hash).not.toBe(one.hash);
  });
});

// ---------------------------------------------------------------------------
// `config models` is session inspect — it reads the binding, writes nothing
// ---------------------------------------------------------------------------

describe("U-CFG · `guild models inspect` reports the session binding", () => {
  const MODELS_CMD = path.resolve(__dirname, "..", "models-cmd.ts");

  function runModels(root: string, runId: string): { status: number; out: string } {
    const r = spawnSync("npx", ["tsx", MODELS_CMD, "inspect", "--cwd", root, "--run-id", runId], {
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { status: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }

  test("it prints host_family, model_family and the prompt_compose hash from the run record", () => {
    const root = mkRoot();
    const runDir = path.join(root, ".guild", "runs", "run-inspect");
    bindSession({
      runDir,
      runId: "run-inspect",
      detected: detectSession({ CODEX_HOME: "/x" } as NodeJS.ProcessEnv),
      promptCompose: { dialect_id: "dialect:openai", overlay_ids: [], hash: "abc123def4567890" },
      models: { cheap: "tier-cheap" },
    });
    const before = durableDigest(root);
    const r = runModels(root, "run-inspect");
    expect(r.out).toMatch(/SESSION BINDING/);
    expect(r.out).toMatch(/host_family=codex model_family=openai/);
    expect(r.out).toMatch(/hash=abc123def4567890/);
    // READ-ONLY: inspect wrote nothing, durable or otherwise.
    expect(durableDigest(root)).toEqual(before);
  });

  test("an unbound run reports `not bound`, never a default host", () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, ".guild", "runs", "run-none"), { recursive: true });
    const r = runModels(root, "run-none");
    expect(r.out).toMatch(/not bound/);
    expect(r.out).not.toMatch(/host_family=claude/);
  });
});
