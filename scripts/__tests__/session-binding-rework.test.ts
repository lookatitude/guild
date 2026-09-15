/**
 * scripts/__tests__/session-binding-rework.test.ts
 *
 * The five codex G-lane r1 P1s, each driven through the REAL caller and each
 * written to fail on the pre-rework tree:
 *
 *   P1-1  startRun binds with the real composed hash + tier map, and SURFACES a
 *         bind failure (session-binding.error on the run record, then throw).
 *   P1-2  `config show --sources` renders the POLICY resolution with per-key
 *         source attribution, separately from the legacy inventory.
 *   P1-3  `config set` writes the 14 policy keys and refuses every other key.
 *   P1-4  the identity guard scans every string leaf — arrays, nested objects,
 *         mixed case — and the prompt scan catches the "you are <host>" prose.
 *   P1-5  binding creation is exclusive: of two competing hosts exactly one wins.
 *
 * Usage (from plugin/scripts/):
 *   npx jest --testPathPattern=session-binding-rework
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  bindSession,
  detectSession,
  readSessionBinding,
  sessionBindingPath,
} from "../../src/modules/config/workflows/session-binding";
import { scanHostIdentity } from "../../src/modules/config/workflows/policy-keys";
import {
  policyOverlayFile,
  policyValue,
  resolvePolicy,
} from "../../src/modules/config/workflows/policy-resolver";
import {
  composeSessionPrompt,
  loadPromptExtensions,
  promptIdentityIn,
  PromptRejectedError,
} from "../../src/modules/prompting/workflows/compose-prompt";
import { createRunLifecycle, type RunLifecycleEnv, type StartRunOpts } from "../lib/run-lifecycle";

/**
 * Every env var `detectSession` reads. The test runner IS a Claude Code session,
 * so its ambient CLAUDE_* vars leak into any fixture that only sets the var it
 * cares about — scrub them all, then set exactly one.
 */
const HOST_SIGNAL_VARS = [
  "GUILD_HOST_FAMILY", "GUILD_HOST_SURFACE", "CLAUDE_PLUGIN_ROOT", "CLAUDECODE",
  "CODEX_HOME", "CODEX_SANDBOX", "CURSOR_TRACE_ID", "GEMINI_CLI",
];

function onlyHostSignal(set: Record<string, string> = {}): void {
  for (const v of HOST_SIGNAL_VARS) delete process.env[v];
  for (const [k, v] of Object.entries(set)) process.env[k] = v;
}

/** The refusal arm of BindResult. ts-jest does not narrow it through `if (!r.ok)`. */
type Refused = Extract<ReturnType<typeof bindSession>, { ok: false }>;

const CONFIG_CMD = path.resolve(__dirname, "..", "config-cmd.ts");

function runConfig(args: string[]): { status: number; out: string } {
  const r = spawnSync("npx", ["tsx", CONFIG_CMD, ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function mkRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t06r1-"));
  fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".guild", "guild.yaml"), "kind: project\n");
  return dir;
}

/** Every file under `.guild/`, so "nothing was written" is checkable. */
function guildFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  };
  walk(path.join(root, ".guild"), "");
  return out.sort();
}

// ---------------------------------------------------------------------------
// P1-1 — startRun is the caller under test
// ---------------------------------------------------------------------------

/**
 * A real-fs `RunLifecycleEnv`, because the point of this fixture is the REAL
 * caller: an in-memory seam would prove the helper works, which is what the
 * first cut proved and codex rejected.
 */
function realEnv(root: string, host: "claude" | "codex"): RunLifecycleEnv {
  return {
    now: () => "2026-09-15T08:40:21Z",
    fs: {
      mkdirp: (p) => void fs.mkdirSync(p, { recursive: true }),
      writeFile: (p, c) => {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, c, "utf8");
      },
      readFile: (p) => {
        try {
          return fs.readFileSync(p, "utf8");
        } catch {
          return null;
        }
      },
      exists: (p) => fs.existsSync(p),
      removeTree: (p) => fs.rmSync(p, { recursive: true, force: true }),
    },
    withRunBindingExclusion: <T>(_r: string, _i: string, fn: () => T): T => fn(),
    resolveHost: (requested: string) => ({ requested, resolved: host as never }),
    __rootHint: root,
  } as unknown as RunLifecycleEnv;
}

function startOpts(root: string, initiative: string): StartRunOpts {
  return {
    command: "/guild:build",
    arguments: { rigor: "deep", host: "auto", initiative: null },
    cwd: root,
    root,
    target_kind: "project",
    workspace: { is_workspace: false, root },
    project: "fixture",
    host_requested: "auto",
    model_tier_policy: "rigor=deep profile",
    ignore_policy: ".gitignore",
    scan_policy: "cheap-map",
    initiative,
  } as unknown as StartRunOpts;
}

describe("P1-1 · startRun binds with real inputs and surfaces failure", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  test("a Claude run start writes a populated binding: composed hash and tier map", () => {
    const root = mkRoot();
    onlyHostSignal({ CLAUDECODE: "1" });
    process.env["GUILD_PLUGIN_ROOT"] = path.resolve(__dirname, "..", "..");

    const runId = createRunLifecycle(realEnv(root, "claude")).startRun(startOpts(root, "p1-1"));
    const binding = readSessionBinding(path.join(root, ".guild", "runs", runId));

    expect(binding).not.toBeNull();
    expect(binding!.host_family).toBe("claude");
    expect(binding!.model_family).toBe("anthropic");
    // The two things the first cut left empty.
    expect(binding!.prompt_compose.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(binding!.models).length).toBeGreaterThan(0);
    // R47: the composed TEXT never lands on the run record — only ids and a hash.
    // Compare against the real base body: no span of it may appear in the file.
    const raw = fs.readFileSync(sessionBindingPath(path.join(root, ".guild", "runs", runId)), "utf8");
    const baseBody = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "skills", "meta", "using-guild", "SKILL.src.md"),
      "utf8",
    );
    const span = baseBody.replace(/\s+/g, " ").trim().slice(200, 260);
    expect(span.length).toBeGreaterThan(20); // the fixture is comparing something real
    expect(raw.replace(/\s+/g, " ")).not.toContain(span);
    expect(binding!.prompt_compose.overlay_ids).toContain("base:using-guild");
  });

  test("a Codex continuation of the same run is REFUSED, and a second run binds separately", () => {
    const root = mkRoot();
    process.env["GUILD_PLUGIN_ROOT"] = path.resolve(__dirname, "..", "..");

    // Session A — Claude.
    onlyHostSignal({ CLAUDECODE: "1" });
    const runA = createRunLifecycle(realEnv(root, "claude")).startRun(startOpts(root, "p1-1-a"));
    const bindingA = readSessionBinding(path.join(root, ".guild", "runs", runA))!;

    // Continuing THAT run on Codex is refused with the continuation offer.
    onlyHostSignal({ CODEX_HOME: "/x" });
    const refused = bindSession({
      runDir: path.join(root, ".guild", "runs", runA),
      runId: runA,
      detected: detectSession(process.env),
      promptCompose: { dialect_id: "dialect:openai", overlay_ids: [], hash: "h" },
    });
    expect(refused.ok).toBe(false);
    expect((refused as Refused).message).toMatch(/NEW run on this host/);
    expect(readSessionBinding(path.join(root, ".guild", "runs", runA))!.host_family).toBe("claude");

    // A NEW run on Codex binds cleanly, and differs in all three fields.
    const runB = createRunLifecycle(realEnv(root, "codex")).startRun(startOpts(root, "p1-1-b"));
    const bindingB = readSessionBinding(path.join(root, ".guild", "runs", runB))!;
    expect(runB).not.toBe(runA);
    expect(bindingB.host_family).toBe("codex");
    expect(bindingA.host_family).not.toBe(bindingB.host_family);
    expect(bindingA.model_family).not.toBe(bindingB.model_family);
    expect(bindingA.prompt_compose.hash).not.toBe(bindingB.prompt_compose.hash);
  });

  test("an unknown host binds with NO tier map — never Claude's ladder", () => {
    const root = mkRoot();
    onlyHostSignal({ GUILD_HOST_FAMILY: "nosuchhost" });

    const runId = createRunLifecycle(realEnv(root, "claude")).startRun(startOpts(root, "p1-1-unknown"));
    const binding = readSessionBinding(path.join(root, ".guild", "runs", runId))!;
    expect(binding.host_family).toBe("unknown");
    expect(binding.models).toEqual({});
  });

  test("a bind failure is SURFACED: session-binding.error on the run record, and a throw", () => {
    const root = mkRoot();
    onlyHostSignal({ CLAUDECODE: "1" });
    process.env["GUILD_PLUGIN_ROOT"] = path.resolve(__dirname, "..", "..");
    // A project prompt overlay that names a host is refused at compose time.
    const prompts = path.join(root, ".guild", "prompts");
    fs.mkdirSync(prompts, { recursive: true });
    fs.writeFileSync(path.join(prompts, "using-guild.overlay.md"), "You are Claude. Be terse.\n");

    expect(() => createRunLifecycle(realEnv(root, "claude")).startRun(startOpts(root, "p1-1-fail"))).toThrow(
      /session binding failed/,
    );

    const runsDir = path.join(root, ".guild", "runs");
    const runs = fs.readdirSync(runsDir).filter((d) => d.startsWith("run-"));
    expect(runs.length).toBe(1);
    const errFile = path.join(runsDir, runs[0], "session-binding.error");
    expect(fs.existsSync(errFile)).toBe(true);
    expect(fs.readFileSync(errFile, "utf8")).toMatch(/prompt composition refused/);
  });
});

// ---------------------------------------------------------------------------
// P1-2 — `config show --sources` renders the policy resolution
// ---------------------------------------------------------------------------

describe("P1-2 · config show --sources renders POLICY with per-key source", () => {
  test("a key set through the real CLI shows its value, layer and file", () => {
    const root = mkRoot();
    expect(runConfig(["set", "wiki.autopromote", "false", "--scope", "project", "--cwd", root]).status).toBe(0);

    const shown = runConfig(["show", "--sources", "--cwd", root]);
    expect(shown.status).toBe(0);
    expect(shown.out).toMatch(/POLICY {2}\(\.guild\/config\/\*\.json/);
    expect(shown.out).toMatch(/wiki\.autopromote = false {2}\[project\]/);
    expect(shown.out).toContain(path.join(root, ".guild", "config", "project.json"));
    // The legacy inventory is still shown, under its own heading.
    expect(shown.out).toMatch(/LEGACY SETTINGS/);
  });

  test("every policy key is listed, defaults included, before the legacy section", () => {
    const root = mkRoot();
    const out = runConfig(["show", "--sources", "--cwd", root]).out;
    for (const key of ["tiers.default", "advisorRounds", "budget.tokens", "recall.backend", "agent_mode"]) {
      expect(out).toContain(`  ${key} = `);
    }
    expect(out.indexOf("POLICY")).toBeLessThan(out.indexOf("LEGACY SETTINGS"));
  });

  test("a refused policy file is REPORTED in the policy section, not swallowed", () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, ".guild", "config"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".guild", "config", "project.json"),
      JSON.stringify({ tiers: { default: "opus" } }),
    );
    const out = runConfig(["show", "--sources", "--cwd", root]).out;
    expect(out).toMatch(/REFUSED:/);
    expect(out).toMatch(/opus/);
  });
});

// ---------------------------------------------------------------------------
// P1-3 — config set is policy-only
// ---------------------------------------------------------------------------

describe("P1-3 · config set writes the 14 policy keys and refuses the rest", () => {
  for (const [key, value] of [
    ["models.tiers.claude", "x"],
    ["hosts.claude.profile", "y"],
    ["roles.backend.model", "z"],
  ] as const) {
    test(`\`config set ${key}\` exits 1 and writes nothing`, () => {
      const root = mkRoot();
      const before = guildFiles(root);
      const r = runConfig(["set", key, value, "--scope", "project", "--cwd", root]);
      expect(r.status).toBe(1);
      expect(r.out).toContain("is not a policy key");
      expect(r.out).toContain("Durable config holds exactly these 14 keys");
      expect(guildFiles(root)).toEqual(before);
    });
  }

  test("a legacy NON-inventory key is refused too — policy-only means policy-only", () => {
    const root = mkRoot();
    const before = guildFiles(root);
    const r = runConfig(["set", "rigor", "deep", "--scope", "project", "--cwd", root]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("is not a policy key");
    expect(guildFiles(root)).toEqual(before);
  });

  test("each of the 14 policy keys is accepted", () => {
    const accepted: Array<[string, string]> = [
      ["tiers.default", "powerful"],
      ["tiers.floors.mid", "4"],
      ["tiers.floors.powerful", "7"],
      ["advisorRounds", "3"],
      ["budget.tokens", "1000"],
      ["budget.usd", "2.5"],
      ["team.compose_scope", "goal"],
      ["recall.backend", "hybrid"],
      ["recall.thresholds.min_score", "0.4"],
      ["recall.thresholds.max_hits", "5"],
      ["review.critic", "off"],
      ["review.independence", "false"],
      ["wiki.autopromote", "false"],
      ["agent_mode", "team"],
    ];
    const root = mkRoot();
    for (const [key, value] of accepted) {
      const r = runConfig(["set", key, value, "--scope", "project", "--cwd", root]);
      expect([key, r.status]).toEqual([key, 0]);
    }
    const written = JSON.parse(
      fs.readFileSync(path.join(root, ".guild", "config", "project.json"), "utf8"),
    );
    expect(written.tiers.default).toBe("powerful");
    expect(written.agent_mode).toBe("team");
    expect(written.budget.usd).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// P1-4 — the identity guard reaches every string leaf
// ---------------------------------------------------------------------------

describe("P1-4 · host/model identity is found at any depth and in prose", () => {
  test("a value nested in an ARRAY is found", () => {
    const hits = scanHostIdentity({ tiers: ["opus"] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].token.toLowerCase()).toBe("opus");
    expect(hits[0].key).toBe("tiers[0]");
  });

  test("a value nested in an object inside an array is found", () => {
    const hits = scanHostIdentity({ a: [{ b: { c: "gpt-5.4" } }] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].key).toBe("a[0].b.c");
  });

  test("the match is case-insensitive and word-bounded", () => {
    expect(scanHostIdentity({ note: "OPUS" }).length).toBeGreaterThan(0);
    expect(scanHostIdentity({ note: "Sonnet" }).length).toBeGreaterThan(0);
    // NEGATIVE CONTROL: a word that merely contains a token is not a hit.
    expect(scanHostIdentity({ note: "opusculum" })).toEqual([]);
  });

  test("NEGATIVE CONTROL: an ordinary policy document passes clean", () => {
    expect(
      scanHostIdentity({
        advisorRounds: 2,
        tiers: { default: "mid", floors: { mid: 3, powerful: 6 } },
        recall: { backend: "bm25", thresholds: { min_score: 0.2, max_hits: 8 } },
        wiki: { autopromote: true },
        agent_mode: "auto",
      }),
    ).toEqual([]);
  });

  test("the resolver refuses an array-nested model name through the real read path", () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, ".guild", "config"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".guild", "config", "project.json"),
      JSON.stringify({ tiers: ["opus"] }),
    );
    expect(() => resolvePolicy({ cwd: root })).toThrow(/opus/);
  });

  test("the prose form 'You are Claude.' is refused in a prompt overlay", () => {
    const root = mkRoot();
    const prompts = path.join(root, ".guild", "prompts");
    fs.mkdirSync(prompts, { recursive: true });
    fs.writeFileSync(path.join(prompts, "using-guild.overlay.md"), "You are Claude. Answer briefly.\n");
    expect(() => loadPromptExtensions(path.join(root, ".guild"), "anthropic")).toThrow(PromptRejectedError);
  });

  test("a bare host family in a prompt overlay is refused; a host-agnostic one is not", () => {
    expect(promptIdentityIn("Prefer the codex tool-call style.")?.kind).toBe("host-family");
    expect(promptIdentityIn("you're Codex")?.kind).toBe("you-are-host");
    expect(promptIdentityIn("One tool call at a time. Cite file and line.")).toBeNull();
  });

  test("composeSessionPrompt propagates the refusal rather than composing around it", () => {
    const root = mkRoot();
    const prompts = path.join(root, ".guild", "prompts");
    fs.mkdirSync(prompts, { recursive: true });
    fs.writeFileSync(path.join(prompts, "using-guild.overlay.md"), "You are Claude.\n");
    expect(() =>
      composeSessionPrompt({
        host_family: "claude",
        model_family: "anthropic",
        guildDir: path.join(root, ".guild"),
      }),
    ).toThrow(PromptRejectedError);
  });
});

// ---------------------------------------------------------------------------
// P1-5 — creation is exclusive
// ---------------------------------------------------------------------------

describe("P1-5 · exactly one of two competing hosts binds the run", () => {
  test("two binds racing on one run: one ok, one refused, content is the winner's", () => {
    const root = mkRoot();
    const runDir = path.join(root, ".guild", "runs", "run-race");
    fs.mkdirSync(runDir, { recursive: true });

    const claude = detectSession({ CLAUDECODE: "1" } as NodeJS.ProcessEnv);
    const codex = detectSession({ CODEX_HOME: "/x" } as NodeJS.ProcessEnv);
    const compose = { dialect_id: "dialect:none", overlay_ids: [], hash: "h" };

    const results = [
      bindSession({ runDir, runId: "run-race", detected: claude, promptCompose: compose }),
      bindSession({ runDir, runId: "run-race", detected: codex, promptCompose: compose }),
    ];

    const created = results.filter((r) => r.ok && r.created);
    const refusedResults = results.filter((r) => !r.ok);
    expect(created.length).toBe(1);
    expect(refusedResults.length).toBe(1);

    const onDisk = readSessionBinding(runDir)!;
    expect(onDisk.host_family).toBe("claude"); // the first caller created it
    const loser = refusedResults[0] as Refused;
    expect(loser.reason).toBe("host_changed_mid_run");
    expect(loser.message).toMatch(/NEW run on this host/);
  });

  test("the create is O_EXCL: a pre-existing file is never overwritten", () => {
    const root = mkRoot();
    const runDir = path.join(root, ".guild", "runs", "run-excl");
    fs.mkdirSync(runDir, { recursive: true });
    // A binding written by "another process" between our read and our write.
    fs.writeFileSync(
      sessionBindingPath(runDir),
      JSON.stringify(
        {
          schema_version: "guild.session_binding.v1",
          run_id: "run-excl",
          host_family: "codex",
          surface: "codex",
          detected_at: "2026-09-15T00:00:00.000Z",
          models: {},
          model_family: "openai",
          prompt_compose: { dialect_id: "dialect:none", overlay_ids: [], hash: "winner" },
          evidence: { cheap: "advertised", mid: "advertised", powerful: "advertised" },
        },
        null,
        2,
      ),
    );
    const r = bindSession({
      runDir,
      runId: "run-excl",
      detected: detectSession({ CLAUDECODE: "1" } as NodeJS.ProcessEnv),
      promptCompose: { dialect_id: "dialect:anthropic", overlay_ids: [], hash: "loser" },
    });
    expect(r.ok).toBe(false);
    expect(readSessionBinding(runDir)!.prompt_compose.hash).toBe("winner");
  });

  test("an unreadable existing binding is refused, never clobbered", () => {
    const root = mkRoot();
    const runDir = path.join(root, ".guild", "runs", "run-bad");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(sessionBindingPath(runDir), "{ not json");
    const r = bindSession({
      runDir,
      runId: "run-bad",
      detected: detectSession({ CLAUDECODE: "1" } as NodeJS.ProcessEnv),
      promptCompose: { dialect_id: "dialect:none", overlay_ids: [], hash: "h" },
    });
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(sessionBindingPath(runDir), "utf8")).toBe("{ not json");
  });
});

// ===========================================================================
// codex G-lane ROUND 2 — 3 P1 + 1 P2
// ===========================================================================

describe("r2 P1-1 · a policy file value beats its legacy alias at the same scope", () => {
  test("canonical wins over `defaults.*` in the SAME file, and the alias is reported shadowed", () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, ".guild", "config"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".guild", "config", "project.json"),
      JSON.stringify({ defaults: { wiki: { autopromote: true } }, wiki: { autopromote: false } }),
    );
    const r = resolvePolicy({ cwd: root, overlayFile: null });
    expect(policyValue(r, "wiki.autopromote")).toBe(false);
    expect(r.sources["wiki.autopromote"]).toBe("project");
    expect(r.legacyAliases).toEqual([
      expect.objectContaining({ key: "wiki.autopromote", legacy: "defaults.wiki.autopromote", shadowed: true }),
    ]);
  });

  test("the alias still SUPPLIES the value when no canonical spelling is there", () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, ".guild", "config"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".guild", "config", "project.json"),
      JSON.stringify({ defaults: { wiki: { autopromote: false } } }),
    );
    const r = resolvePolicy({ cwd: root, overlayFile: null });
    expect(policyValue(r, "wiki.autopromote")).toBe(false);
    expect(r.legacyAliases[0].shadowed).toBe(false);
  });

  test("seeded legacy alias + `config set` through the real CLI → the policy file wins", () => {
    const root = mkRoot();
    // The legacy spelling, seeded where an upgraded project would have it.
    fs.writeFileSync(
      path.join(root, ".guild", "settings.json"),
      JSON.stringify({ defaults: { wiki: { autopromote: true } } }),
    );
    expect(runConfig(["set", "wiki.autopromote", "false", "--scope", "project", "--cwd", root]).status).toBe(0);

    const r = resolvePolicy({ cwd: root, overlayFile: null });
    expect(policyValue(r, "wiki.autopromote")).toBe(false);
    expect(r.sources["wiki.autopromote"]).toBe("project");
    expect(r.files.find((f) => f.layer === "project")!.file).toBe(
      path.join(root, ".guild", "config", "project.json"),
    );
  });

  test("`show --sources` labels a shadowed alias", () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, ".guild", "config"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".guild", "config", "project.json"),
      JSON.stringify({ defaults: { wiki: { autopromote: true } }, wiki: { autopromote: false } }),
    );
    const out = runConfig(["show", "--sources", "--cwd", root]).out;
    expect(out).toMatch(/wiki\.autopromote = false {2}\[project\]/);
    expect(out).toMatch(/defaults\.wiki\.autopromote → wiki\.autopromote {2}\[legacy-alias \(shadowed\)\]/);
  });
});

describe("r2 P1-2 · config role no longer writes a host into durable config", () => {
  test("`config role advisory codex --scope project` exits 1 and changes no file", () => {
    const root = mkRoot();
    const before = guildFiles(root);
    const r = runConfig(["role", "advisory", "codex", "--scope", "project", "--cwd", root]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/which names a host/);
    expect(r.out).toMatch(/guild\.session_binding\.v1/);
    expect(guildFiles(root)).toEqual(before);
  });

  test("every role alias is refused, valid host-id or not, and the tier form is NOT offered", () => {
    const root = mkRoot();
    for (const [alias, value] of [
      ["host", "claude-code-cli"],
      ["advisory", "codex-cli"],
      ["adversarial", "powerful"],
    ] as const) {
      const r = runConfig(["role", alias, value, "--scope", "project", "--cwd", root]);
      expect([alias, r.status]).toEqual([alias, 1]);
    }
    expect(fs.existsSync(path.join(root, ".guild", "settings.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".guild", "config", "project.json"))).toBe(false);
  });

  test("an unknown role still gets the closed-alias message first", () => {
    const root = mkRoot();
    const r = runConfig(["role", "nosuchrole", "x", "--scope", "project", "--cwd", root]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/unknown role/);
  });
});

describe("r2 P1-3 · the machine overlay is a visible source", () => {
  /** The overlay path for this root, on the platform state root. */
  function overlayFor(root: string): string {
    const p = policyOverlayFile(root);
    if (p === null) throw new Error("no overlay path for a real root");
    return p;
  }

  test("`show --sources` names the overlay even when it is absent", () => {
    const root = mkRoot();
    const out = runConfig(["show", "--sources", "--cwd", root]).out;
    expect(out).toMatch(/ {2}overlay: .*policy-overlay\.json {2}\(absent\)/);
  });

  test("an overlay containing `opus` surfaces as REFUSED through the CLI", () => {
    const root = mkRoot();
    const overlay = overlayFor(root);
    fs.mkdirSync(path.dirname(overlay), { recursive: true });
    fs.writeFileSync(overlay, JSON.stringify({ tiers: { default: "opus" } }));
    try {
      const out = runConfig(["show", "--sources", "--cwd", root]).out;
      expect(out).toMatch(/REFUSED:/);
      expect(out).toMatch(/opus/);
      expect(out).toMatch(/overlay/);
    } finally {
      fs.rmSync(overlay, { force: true });
    }
  });

  test("a VALID overlay is read and wins over the project file", () => {
    const root = mkRoot();
    expect(runConfig(["set", "advisorRounds", "3", "--scope", "project", "--cwd", root]).status).toBe(0);
    const overlay = overlayFor(root);
    fs.mkdirSync(path.dirname(overlay), { recursive: true });
    fs.writeFileSync(overlay, JSON.stringify({ advisorRounds: 7 }));
    try {
      const r = resolvePolicy({ cwd: root });
      expect(policyValue(r, "advisorRounds")).toBe(7);
      expect(r.sources["advisorRounds"]).toBe("overlay");
      expect(runConfig(["show", "--sources", "--cwd", root]).out).toMatch(/ {2}overlay: .* {2}\(read\)/);
    } finally {
      fs.rmSync(overlay, { force: true });
    }
  });

  test("resolvePolicy reads the overlay by DEFAULT — no caller has to opt in", () => {
    const root = mkRoot();
    const overlay = overlayFor(root);
    fs.mkdirSync(path.dirname(overlay), { recursive: true });
    fs.writeFileSync(overlay, JSON.stringify({ team: { compose_scope: "goal" } }));
    try {
      expect(policyValue(resolvePolicy({ cwd: root }), "team.compose_scope")).toBe("goal");
      // …and `null` still opts out deliberately.
      expect(policyValue(resolvePolicy({ cwd: root, overlayFile: null }), "team.compose_scope")).toBe("phase");
    } finally {
      fs.rmSync(overlay, { force: true });
    }
  });
});

describe("r2 P2 · the UI reload reads the file the write landed in", () => {
  test("`ui set agent_mode team` reports team [project], not auto [builtin]", () => {
    const root = mkRoot();
    fs.writeFileSync(path.join(root, ".guild", "settings.json"), "{}");
    const r = runConfig(["ui", "set", "agent_mode", "team", "--scope", "project", "--confirm", "advanced", "--cwd", root]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/reloaded: agent_mode = "team" {2}\[project\]/);
    expect(r.out).not.toMatch(/reloaded: agent_mode = "auto"/);
  });

  test("the legacy spelling reloads from the same place", () => {
    const root = mkRoot();
    fs.writeFileSync(path.join(root, ".guild", "settings.json"), "{}");
    const r = runConfig([
      "ui", "set", "defaults.wiki.autopromote", "false",
      "--scope", "project", "--confirm", "advanced", "--cwd", root,
    ]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/reloaded: defaults\.wiki\.autopromote = false {2}\[project\]/);
  });
});

describe("r2 sweep · the remaining settings.json writer carries no identity", () => {
  test("update-mcp-hashes refuses a payload that smuggles a host or model name", () => {
    const root = mkRoot();
    fs.writeFileSync(
      path.join(root, ".guild", "settings.json"),
      JSON.stringify({ mcp: { tool_description_hashes: { "claude-code-cli": "abc" } } }),
    );
    const tools = path.join(root, "tools.json");
    fs.writeFileSync(tools, JSON.stringify({ t: "a tool description" }));
    const r = runConfig(["update-mcp-hashes", "--tools", tools, "--scope", "project", "--cwd", root]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/carries 'claude'/);
  });

  test("a clean payload still writes", () => {
    const root = mkRoot();
    const tools = path.join(root, "tools.json");
    fs.writeFileSync(tools, JSON.stringify({ wiki_search: "a tool description" }));
    const r = runConfig(["update-mcp-hashes", "--tools", tools, "--scope", "project", "--cwd", root]);
    expect(r.status).toBe(0);
    const after = JSON.parse(fs.readFileSync(path.join(root, ".guild", "settings.json"), "utf8"));
    expect(Object.keys(after.mcp.tool_description_hashes)).toContain("wiki_search");
  });
});
