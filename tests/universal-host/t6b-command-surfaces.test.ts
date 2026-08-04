/**
 * tests/universal-host/t6b-command-surfaces.test.ts
 *
 * Lane T6b acceptance — the PUBLIC command surface for model-routing
 * inspection plus the reusable pre-dispatch team-decision interaction.
 *
 * What this suite proves (each success criterion of the lane, as an assertion):
 *   1. `guild models inspect` is TRIGGERABLE (a command file with usable
 *      frontmatter), REGISTERED (plugin.json + inventory + a module manifest
 *      owner + the neutral command registry) and its HELP matches the CLI it
 *      documents - a flag in `argument-hint` that the parser rejects is a bug.
 *   2. Inspect output renders ONLY validated fields rebuilt from artifacts that
 *      verify themselves, preserves the unknown / evidence_state / independence
 *      labels, and exposes NO secret: a credential, a private absolute path and
 *      a reversible endpoint identity each fail the command CLOSED in text AND
 *      in JSON. Anti-vacuous throughout - the same tree without the plant exits
 *      0, and a forged persisted report cannot mint a trust label.
 *   3. Every phase that can dispatch blocks on a PERSISTED decision, and the
 *      block is executed code (`scripts/team-decide.ts gate`), not prose. The
 *      COMPLETE trail is validated: a corrupt artifact or a conflicting
 *      decision anywhere in it blocks a valid approve.
 *   4. Restructure loops CONVERGE (a repeated, already-satisfied edit mints no
 *      new version) and can neither reintroduce a cap nor auto-approve.
 *
 * REAL-PATH DISCIPLINE: the behavioural blocks drive the SHIPPED CLI
 * entrypoints as child processes (`scripts/models-cmd.ts`,
 * `scripts/team-decide.ts`), not the module functions with hand-wired seams -
 * a green in-module test would not prove the command a host actually runs.
 *
 * RUNTIME (T6B-R1-M1): the child processes run on the PACKAGE-LOCAL tsx that
 * `tests/package.json` already pins, launched as `node <tsx-cli> <script>`.
 * The round-1 harness shelled out to ambient `npx`, which tried to download
 * into the user npm cache and exited 1 with EPERM on a host whose cache is
 * root-owned - six real-CLI cases failed for a reason that had nothing to do
 * with the code under test.
 */

import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { splitFrontmatter, parseYaml } from "../../scripts/lib/frontmatter";
import { parseModelsArgs } from "../../src/modules/capability/workflows/models-command";
import {
  createCacheKey,
  modelCatalogCacheDir,
} from "../../src/modules/capability/workflows/catalog-cache";
import {
  DECISION_VOCABULARY,
  kindCoverage,
  parseDecisionVerb,
  planRestructure,
  preDispatchGate,
  scanCapReintroduction,
  teamPlanDir,
} from "../../src/modules/teams/workflows/team-decision-surface";
import { composeProposal, writeProposal } from "../../src/modules/teams/workflows/team-proposal";
import { recordDecision, writeDecision } from "../../src/modules/teams/workflows/team-decision";
import { canonicalYaml } from "../../src/modules/teams/workflows/canonical-hash";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");

/**
 * The package-local tsx CLI (T6B-R1-M1). Resolved through the module system so
 * it follows `tests/node_modules` wherever the checkout lives; the literal path
 * is only a fallback, and an absent runtime is a LOUD failure rather than a
 * silent fall-through to ambient `npx`.
 */
const TSX_CLI = (() => {
  try {
    return path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
  } catch {
    return path.join(PLUGIN_ROOT, "tests", "node_modules", "tsx", "dist", "cli.mjs");
  }
})();

/** Commands that can dispatch a participant and therefore MUST carry the gate. */
const DISPATCHING_COMMANDS = [
  "build",
  "ideate",
  "init",
  "ops",
  "plan",
  "qa",
  "resume",
  "guild",
];

function readCommand(id: string): string {
  return fs.readFileSync(path.join(PLUGIN_ROOT, "commands", `${id}.md`), "utf8");
}

function commandFrontmatter(id: string): Record<string, unknown> {
  const { frontmatter } = splitFrontmatter(readCommand(id));
  if (frontmatter === null) throw new Error(`commands/${id}.md has no frontmatter block`);
  return parseYaml(frontmatter) as Record<string, unknown>;
}

function runCli(script: string, args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      [TSX_CLI, path.join(PLUGIN_ROOT, "scripts", script), ...args],
      { cwd: PLUGIN_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "t6b-"));
}

/** Recursive path+content fingerprint - used to prove the command wrote nothing. */
function treeFingerprint(root: string): string {
  const h = crypto.createHash("sha256");
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      h.update(path.relative(root, p));
      if (st.isDirectory()) walk(p);
      else h.update(fs.readFileSync(p));
    }
  };
  if (fs.existsSync(root)) walk(root);
  return h.digest("hex");
}

describe("T6b harness", () => {
  it("drives the shipped CLIs on a PACKAGE-LOCAL runtime, never ambient npx", () => {
    // Anti-regression for T6B-R1-M1: if this file ever goes back to the ambient
    // launcher, the real-CLI cases below become hostage to a machine cache again.
    expect(fs.existsSync(TSX_CLI)).toBe(true);
    expect(TSX_CLI).toContain(`${path.sep}node_modules${path.sep}tsx${path.sep}`);
    const source = fs.readFileSync(__filename, "utf8");
    expect(source).not.toMatch(/execFileSync\(\s*["']npx["']/);
  });
});

// ---------------------------------------------------------------------------
// 1. trigger / registration / help
// ---------------------------------------------------------------------------

describe("T6b(1) — `guild models` trigger, registration and help", () => {
  it("ships a command file with a usable trigger surface", () => {
    const fm = commandFrontmatter("models");
    expect(fm["name"]).toBe("models");
    expect(String(fm["description"]).length).toBeGreaterThan(80);
    // The description is what a host router matches on: it must name the verb
    // AND the read-only promise, or the command mis-triggers.
    expect(String(fm["description"])).toMatch(/models inspect/);
    expect(String(fm["description"])).toMatch(/READ-ONLY/);
    expect(String(fm["argument-hint"])).toMatch(/^inspect/);
    // Read + Bash only: an inspection command that can Write is a contradiction.
    const tools = String(fm["allowed-tools"]).split(",").map((t) => t.trim());
    expect(tools.sort()).toEqual(["Bash", "Read"]);
    expect(tools).not.toContain("Write");
    expect(tools).not.toContain("Edit");
  });

  it("is registered in plugin.json, the inventory and the neutral command registry", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8")
    );
    expect(manifest.commands).toContain("./commands/models.md");

    const inventory = JSON.parse(
      fs.readFileSync(path.join(PLUGIN_ROOT, "guild.inventory.json"), "utf8")
    );
    const entry = inventory.commands.find((c: { id: string }) => c.id === "models");
    expect(entry).toBeDefined();
    expect(entry.source_path).toBe("commands/models.md");

    const registry = JSON.parse(
      fs.readFileSync(path.join(PLUGIN_ROOT, "command-src", "command-registry.json"), "utf8")
    );
    expect(registry.commands.map((c: { id: string }) => c.id)).toContain("models");
  });

  it("is owned by exactly one module manifest (host packaging needs an owner)", () => {
    const modulesDir = path.join(PLUGIN_ROOT, "src", "modules");
    const owners = fs
      .readdirSync(modulesDir)
      .filter((d) => fs.existsSync(path.join(modulesDir, d, "module.manifest.json")))
      .filter((d) => {
        const m = JSON.parse(
          fs.readFileSync(path.join(modulesDir, d, "module.manifest.json"), "utf8")
        );
        return (m.owns?.commands ?? []).includes("models");
      });
    expect(owners).toEqual(["capability"]);
  });

  it("help matches the CLI: every documented flag parses, undocumented ones are refused", () => {
    const hint = String(commandFrontmatter("models")["argument-hint"]);
    const documented = [...hint.matchAll(/--[a-z-]+/g)].map((m) => m[0]);
    expect(documented.sort()).toEqual(["--cwd", "--json", "--run-id"]);
    for (const flag of documented) {
      const argv = flag === "--json" ? ["inspect", flag] : ["inspect", flag, "value"];
      const parsed = parseModelsArgs(argv);
      expect("error" in parsed).toBe(false);
    }
    expect(parseModelsArgs(["inspect", "--not-a-flag"])).toHaveProperty("error");
    // The single-public-verb rule is enforced, not merely documented.
    expect(parseModelsArgs(["mutate"])).toHaveProperty("error");
    expect(parseModelsArgs([])).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// 2. inspect output: rebuilt from VERIFIED artifacts, validated, read-only
// ---------------------------------------------------------------------------

const RUN_ID = "run-t6b";

/**
 * Planted values are assembled from fragments so THIS source file carries no
 * secret-shaped or private-path literal (the repo leak scanners read it too);
 * the artifacts written to the temp tree still contain a real pattern match,
 * which is what the guard must catch.
 */
const PLANTED_KEY_NAME = ["api", "key"].join("_");
const PLANTED_KEY_VALUE = ["sk", "planted", "not", "a", "real", "key", "000000"].join("-");
const PLANTED_PRIVATE_PATH = ["", "Users", "someoperator", ".ssh", "config"].join("/");
const PLANTED_REVERSIBLE_TARGET = ["api", "example", "com"].join(".");

const TARGET = {
  target_id: "claude-cli",
  provider_kind: "subscription",
  auth_mode: "oauth",
  account_fingerprint: "acct-fp-1",
  endpoint_fingerprint: "endp-fp-1",
  org_fingerprint: "org-fp-1",
  tool_version: "2.2.0",
};

const HOST = {
  family: "claude",
  surface: "cli",
  adapter_id: "claude-code",
  adapter_version: "2.2.0",
};

function sessionContextFixture(
  overrides: { evidence?: string; target_id?: string } = {}
): Record<string, unknown> {
  return {
    schema_version: "guild.session_context.v1",
    run_id: RUN_ID,
    started_at: "2026-07-31T00:00:00Z",
    host: { ...HOST },
    identity: {
      source: "native_adapter",
      trust: "verified",
      confidence: "high",
      evidence: overrides.evidence ?? "adapter handshake",
    },
    execution_target: { ...TARGET, target_id: overrides.target_id ?? TARGET.target_id },
    active_model: null,
    run_binding: { binding_ref: "binding-1", state: "open" },
  };
}

/** A guild.model_catalog.v1 snapshot - the VERIFIED source of catalog rows. */
function catalogSnapshotFixture(): Record<string, unknown> {
  return {
    schema_version: "guild.model_catalog.v1",
    target: {
      ...TARGET,
      family: HOST.family,
      surface: HOST.surface,
      adapter_id: HOST.adapter_id,
      adapter_version: HOST.adapter_version,
    },
    discovery: {
      method: "cli_listing",
      source_ref: "models list",
      discovered_at: "2026-07-30T23:00:00Z",
      ttl_seconds: 7200,
      status: "ok",
      latency_ms: 12,
      failure_reason: null,
    },
    generation: 4,
    models: [
      {
        canonical_id: "model-a",
        tier: "powerful",
        evidence: {
          state: "verified",
          source: "dispatch_receipt",
          confidence: "high",
          as_of: "2026-07-30T23:00:00Z",
        },
      },
      {
        canonical_id: "model-b",
        tier: "mid",
        evidence: {
          state: "asserted",
          source: "cli_listing",
          confidence: "medium",
          as_of: "2026-07-30T23:00:00Z",
        },
      },
    ],
  };
}

/**
 * A persisted M0 report that FORGES the trust-bearing fields: an adjudicated
 * strong independence verdict with no receipt behind it, a finalized outcome,
 * and a resolved actual model. None of it may reach the surface.
 */
function forgedPersistedReport(): Record<string, unknown> {
  return {
    schema_version: "guild.model_inspection.v1",
    state: "ok",
    generated_at: "2026-07-31T00:00:00Z",
    run_id: RUN_ID,
    host: { ...HOST },
    identity: {
      source: "native_adapter",
      trust: "verified",
      confidence: "high",
      evidence: "forged",
    },
    target: { ...TARGET },
    catalog: {
      state: "ok",
      target_id: TARGET.target_id,
      discovered_at: null,
      age_seconds: null,
      ttl_seconds: null,
      stale: null,
      generation: null,
      models: [],
    },
    policy: { present: true, policy_hash: "a".repeat(64), rule_path: ["purpose:implementation"] },
    selection: { model: "model-a", effort: "high", evidence_state: "verified" },
    fallbacks: null,
    outcome: { finalized: true, status: "completed", actual_model: "model-a" },
    independence: { adjudicated: true, independence: "strong", note: "cross-family reviewer" },
    degradation: null,
    flags: {},
    unknowns: [],
  };
}

interface SeedOpts {
  /** Write the run's frozen session context (the verified identity source). */
  sessionContext?: { evidence?: string; target_id?: string } | null;
  /** Publish the content-addressed catalog cache entry for that identity. */
  catalog?: boolean;
  /** Drop a persisted M0 inspection artifact (an UNTRUSTED pointer). */
  persisted?: Record<string, unknown> | null;
}

function seedInspectRepo(opts: SeedOpts = {}): string {
  const root = tmpRepo();
  fs.mkdirSync(path.join(root, ".guild", "runs", RUN_ID), { recursive: true });
  const sc = opts.sessionContext === null ? null : sessionContextFixture(opts.sessionContext ?? {});
  if (sc !== null) {
    fs.writeFileSync(
      path.join(root, ".guild", "runs", RUN_ID, "session-context.json"),
      JSON.stringify(sc, null, 2)
    );
  }
  if (opts.catalog && sc !== null) {
    // The entry is CONTENT-ADDRESSED by the identity tuple, so it is only
    // findable under the identity the verified session context actually names.
    const target = sc["execution_target"] as Record<string, string>;
    const key = createCacheKey(
      {
        target_id: target.target_id,
        family: HOST.family,
        surface: HOST.surface,
        provider_kind: target.provider_kind,
        auth_mode: target.auth_mode,
        account_fingerprint: target.account_fingerprint,
        endpoint_fingerprint: target.endpoint_fingerprint,
        org_fingerprint: target.org_fingerprint,
        tool_version: target.tool_version,
        adapter_id: HOST.adapter_id,
        adapter_version: HOST.adapter_version,
      },
      RUN_ID
    );
    const dir = modelCatalogCacheDir(root);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${key.hash}.json`),
      JSON.stringify(catalogSnapshotFixture(), null, 2)
    );
  }
  if (opts.persisted) {
    const dir = path.join(root, ".guild", "runs", RUN_ID, "inspection");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "lane.json"), JSON.stringify(opts.persisted, null, 2));
  }
  return root;
}

function inspect(root: string, extra: string[] = []) {
  return runCli("models-cmd.ts", ["inspect", "--cwd", root, "--run-id", RUN_ID, ...extra]);
}

describe("T6b(2) — `models inspect` output contract (real CLI path)", () => {
  it("renders labels REBUILT from verified artifacts and writes NOTHING", () => {
    const root = seedInspectRepo({ catalog: true, persisted: forgedPersistedReport() });
    const before = treeFingerprint(root);
    const run = inspect(root);
    expect(run.code).toBe(0);

    // Identity comes from the run's frozen session context, not the report.
    expect(run.stdout).toMatch(/identity\s+source=native_adapter trust=verified confidence=high/);
    expect(run.stdout).toMatch(/target\s+claude-cli provider_kind=subscription auth_mode=oauth/);
    // Evidence labels survive to the surface, per model row - from the
    // content-addressed catalog snapshot, which is a verifiable artifact.
    expect(run.stdout).toMatch(/model model-a tier=powerful evidence=verified/);
    expect(run.stdout).toMatch(/model model-b tier=mid evidence=asserted/);
    expect(run.stdout).toMatch(/catalog\s+state=ok/);
    // An unbindable field is surfaced in UNKNOWNS, not dropped.
    expect(run.stdout).toMatch(/UNKNOWNS\s+.*policy/);
    expect(run.stdout).toMatch(/UNKNOWNS\s+.*independence/);

    // READ-ONLY: byte-identical tree after the command ran.
    expect(treeFingerprint(root)).toBe(before);
  });

  it("renders JSON from the SAME view model (labels cannot differ per format)", () => {
    const root = seedInspectRepo({ catalog: true, persisted: forgedPersistedReport() });
    const run = inspect(root, ["--json"]);
    expect(run.code).toBe(0);
    const view = JSON.parse(run.stdout);
    expect(view.schema_version).toBe("guild.model_inspection_view.v1");
    const entry = view.entries[0];
    expect(entry.catalog.models).toEqual([
      { canonical_id: "model-a", tier: "powerful", evidence_state: "verified" },
      { canonical_id: "model-b", tier: "mid", evidence_state: "asserted" },
    ]);
    expect(entry.identity.trust).toBe("verified");
    expect(view.display_rejections).toEqual([]);
  });

  it("a FORGED persisted report cannot mint a trust label (T6B-R1-B2)", () => {
    const root = seedInspectRepo({ catalog: true, persisted: forgedPersistedReport() });
    const run = inspect(root);
    expect(run.code).toBe(0);

    // The forged adjudication does NOT survive: with no verified finalized
    // receipt to bind an adjudication block to, independence stays unknown.
    expect(run.stdout).toMatch(/independence adjudicated=false verdict=unknown/);
    expect(run.stdout).not.toMatch(/verdict=strong/);
    expect(run.stdout).not.toMatch(/adjudicated=true/);
    // The forged finalized outcome does not survive either.
    expect(run.stdout).toMatch(/outcome\s+finalized=false status=pending actual_model=unknown/);
    // The divergence is NAMED (field names only, never the claimed values).
    expect(run.stdout).toMatch(/UNTRUSTED CLAIM\(S\) NOT SUPPORTED BY VERIFIED ARTIFACTS/);
    expect(run.stdout).toMatch(/independence\.adjudicated/);
    expect(run.stdout).toMatch(/outcome\.finalized/);

    const json = JSON.parse(inspect(root, ["--json"]).stdout);
    expect(json.entries[0].independence.adjudicated).toBe(false);
    expect(json.entries[0].independence.independence).toBe("unknown");
    expect(json.entries[0].untrusted_divergence).toEqual(
      expect.arrayContaining([
        "independence.adjudicated",
        "independence.verdict",
        "outcome.finalized",
      ])
    );
  });

  it("an artifact bound to ANOTHER run is refused as a pointer", () => {
    const foreign = { ...forgedPersistedReport(), run_id: "run-someone-else" };
    const root = seedInspectRepo({ catalog: true, persisted: foreign });
    const run = inspect(root);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/was NOT accepted as a pointer \(run-binding mismatch/);
    // It contributed no row: the only entry is the live rebuild.
    const json = JSON.parse(inspect(root, ["--json"]).stdout);
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0].label).toBe("live");
  });

  it("fails CLOSED on a credential in a VERIFIED artifact - text AND JSON (anti-vacuous)", () => {
    const root = seedInspectRepo({
      catalog: true,
      sessionContext: { evidence: `probe used ${PLANTED_KEY_NAME} = ${PLANTED_KEY_VALUE}` },
    });
    for (const extra of [[], ["--json"]]) {
      const run = inspect(root, extra);
      expect(run.code).toBe(3);
      // The value never appears - not raw, not partially redacted, in either format.
      expect(run.stdout).not.toContain(PLANTED_KEY_VALUE);
      expect(run.stderr).not.toContain(PLANTED_KEY_VALUE);
      expect(run.stdout).toMatch(/<REJECTED:api_key-assignment:[0-9a-f]{12}>/);
      expect(run.stderr).toMatch(/FAILED CLOSED/);
      expect(run.stderr).toMatch(/identity\.evidence \(api_key-assignment\)/);
    }
    // Anti-vacuity: the identical tree WITHOUT the plant exits 0, so the guard
    // discriminates rather than always failing.
    expect(inspect(seedInspectRepo({ catalog: true })).code).toBe(0);
  });

  it("fails CLOSED on a private absolute path in a VERIFIED artifact", () => {
    const root = seedInspectRepo({
      catalog: true,
      sessionContext: { evidence: `adapter handshake read from ${PLANTED_PRIVATE_PATH}` },
    });
    const run = inspect(root);
    expect(run.code).toBe(3);
    expect(run.stdout).not.toContain(PLANTED_PRIVATE_PATH);
    expect(run.stderr).not.toContain(PLANTED_PRIVATE_PATH);
    expect(run.stdout).toMatch(/<REJECTED:private-path:[0-9a-f]{12}>/);
  });

  it("fails CLOSED on a REVERSIBLE target identity (endpoint, not a digest)", () => {
    const root = seedInspectRepo({
      catalog: true,
      sessionContext: { target_id: PLANTED_REVERSIBLE_TARGET },
    });
    for (const extra of [[], ["--json"]]) {
      const run = inspect(root, extra);
      expect(run.code).toBe(3);
      expect(run.stdout).not.toContain(PLANTED_REVERSIBLE_TARGET);
      expect(run.stderr).toMatch(/target\.target_id \(reversible-identity\)/);
    }
    // A URL-shaped target id is refused by the display-token shape itself.
    const urlRoot = seedInspectRepo({
      catalog: true,
      sessionContext: { target_id: `https://${PLANTED_REVERSIBLE_TARGET}/v1` },
    });
    const urlRun = inspect(urlRoot);
    expect(urlRun.code).toBe(3);
    expect(urlRun.stdout).not.toContain(PLANTED_REVERSIBLE_TARGET);
  });

  it("reports an honest unknown instead of inventing a run", () => {
    const root = tmpRepo();
    const run = runCli("models-cmd.ts", ["inspect", "--cwd", root]);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/cannot resolve a run to inspect/);
  });

  it("with no verified session context, every identity field is an honest unknown", () => {
    const root = seedInspectRepo({ sessionContext: null });
    const run = inspect(root);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/no verified guild\.session_context\.v1 record/);
    expect(run.stdout).toMatch(/host\s+family=unknown surface=unknown/);
  });
});

// ---------------------------------------------------------------------------
// 3. the blocking pre-dispatch gate
// ---------------------------------------------------------------------------

const PARTICIPANTS = [
  {
    participant_id: "p0",
    participation_kind: "worker",
    role_ref: "backend",
    necessity_rationale: "owns the API lane",
    owned_obligations: ["ob0"],
    depends_on: [] as string[],
    tier: "mid",
    purpose: "implementation",
    capability_scope: null,
    backend: "team",
  },
  {
    participant_id: "p1",
    participation_kind: "advisor",
    role_ref: "advisor",
    necessity_rationale: "escalation target for the cheap lane",
    owned_obligations: ["ob1"],
    depends_on: ["p0"],
    tier: "powerful",
    purpose: "advisory",
    capability_scope: null,
    backend: "team",
  },
  {
    participant_id: "p2",
    participation_kind: "challenger",
    role_ref: "security",
    necessity_rationale: "adversarial pass on the auth path",
    owned_obligations: ["ob2"],
    depends_on: ["p0"],
    tier: "powerful",
    purpose: "adversarial",
    capability_scope: null,
    backend: "team",
  },
  {
    participant_id: "p3",
    participation_kind: "reviewer_cross_host",
    role_ref: "codex-reviewer",
    necessity_rationale: "cross-family independence for the G-lane gate",
    owned_obligations: ["ob3"],
    depends_on: ["p0"],
    tier: "powerful",
    purpose: "adversarial",
    capability_scope: null,
    backend: "team",
  },
];

/**
 * `ob1` is CO-OWNED by p0 on purpose: the convergence probes below remove p1
 * repeatedly, and an obligation left unowned would make the produced proposal
 * structurally invalid for a reason unrelated to version churn. Every other
 * obligation stays single-owner so the "an edit orphans an obligation" probe
 * still fires.
 */
function proposalFixture(count: number = PARTICIPANTS.length): any {
  const participants = JSON.parse(JSON.stringify(PARTICIPANTS)).slice(0, count);
  const ids = new Set(participants.map((p: any) => p.participant_id));
  return composeProposal({
    run_id: RUN_ID,
    phase: "build",
    participants,
    obligations: participants.map((p: any, i: number) => ({
      obligation_id: `ob${i}`,
      source: "plan_item",
      text: `item ${i}`,
      disposition: {
        owners: p.participant_id === "p1" && ids.has("p0") ? ["p1", "p0"] : [p.participant_id],
      },
    })),
    excluded_roles: [{ role_ref: "mobile", why_unnecessary: "no mobile surface" }],
    backend_capacity_evidence: {
      backend: "team",
      verified_capacity: 2,
      method: "preflight probe",
      as_of: "2026-07-30T00:00:00Z",
    },
  } as any);
}

function approveFixture(proposal: object): any {
  return recordDecision(proposal, {
    decision: "approve",
    decided_by: { kind: "user" },
    decision_channel: "interactive_prompt",
    decided_at: "2026-07-31T00:00:00Z",
  } as any);
}

function restructureFixture(proposal: object): any {
  return recordDecision(proposal, {
    decision: "restructure",
    restructure_edits: [{ remove: { participant_id: "p1" } }],
    decided_by: { kind: "user" },
    decision_channel: "interactive_prompt",
    decided_at: "2026-07-31T01:00:00Z",
  } as any);
}

function seedTeamRepo(opts: { withApprove: boolean }): {
  root: string;
  proposalPath: string;
  proposal: any;
} {
  const root = tmpRepo();
  fs.mkdirSync(path.join(root, ".guild", "runs", RUN_ID), { recursive: true });
  const proposal = proposalFixture();
  const proposalPath = writeProposal(root, proposal);
  if (opts.withApprove) writeDecision(root, approveFixture(proposal));
  return { root, proposalPath, proposal };
}

/** Drop a hand-corrupted decision into the trail (writeDecision would refuse). */
function plantTamperedDecision(root: string, proposal: object): string {
  const tampered = { ...approveFixture(proposal), decision_hash: "0".repeat(64) };
  const dir = teamPlanDir(root, RUN_ID);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "build.decision.tampered0000.yaml");
  fs.writeFileSync(p, canonicalYaml(tampered));
  return p;
}

function gate(root: string, proposalPath: string) {
  return runCli("team-decide.ts", ["gate", "--proposal", proposalPath, "--cwd", root]);
}

describe("T6b(3) — every phase blocks dispatch on a PERSISTED decision", () => {
  it("authorizes dispatch on a current approve and shows the approved team (real CLI)", () => {
    const { root, proposalPath } = seedTeamRepo({ withApprove: true });
    const run = gate(root, proposalPath);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/DECISION  state=approved/);
    // The final approved team is displayed with every kind accounted for.
    for (const p of PARTICIPANTS) expect(run.stdout).toContain(p.participant_id);
    expect(run.stdout).toMatch(/GATE COVERAGE \(no kind is exempt\)/);
    expect(run.stdout).toMatch(/advisor\s+1\s+yes/);
    expect(run.stdout).toMatch(/challenger\s+1\s+yes/);
    expect(run.stdout).toMatch(/reviewer_cross_host\s+1\s+yes/);
  });

  it("BLOCKS when no decision is persisted - Guild never auto-approves (real CLI)", () => {
    const { root, proposalPath } = seedTeamRepo({ withApprove: false });
    const run = gate(root, proposalPath);
    expect(run.code).toBe(3);
    expect(run.stderr).toMatch(/DISPATCH BLOCKED \(no_persisted_decision\)/);
    expect(run.stderr).toMatch(/never auto-approves/);
  });

  it("BLOCKS a valid approve when a TAMPERED artifact sits later in the trail (real CLI)", () => {
    // T6B-R1-B3 counterexample (a): round 1 returned on the first allowed
    // candidate and never read the rest of the trail.
    const { root, proposalPath, proposal } = seedTeamRepo({ withApprove: true });
    expect(gate(root, proposalPath).code).toBe(0); // the trail is clean first
    plantTamperedDecision(root, proposal);
    const run = gate(root, proposalPath);
    expect(run.code).toBe(3);
    expect(run.stderr).toMatch(/DISPATCH BLOCKED \(invalid_decision_artifact\)/);
    expect(run.stderr).toMatch(/the WHOLE trail fails closed/);
  });

  it("BLOCKS a valid approve when a CONFLICTING decision binds the same hash (real CLI)", () => {
    // T6B-R1-B3 counterexample (b): one approve + one restructure over the
    // SAME proposal bytes is ambiguous; filename order must not pick a winner.
    const { root, proposalPath, proposal } = seedTeamRepo({ withApprove: true });
    writeDecision(root, restructureFixture(proposal));
    const run = gate(root, proposalPath);
    expect(run.code).toBe(3);
    expect(run.stderr).toMatch(/DISPATCH BLOCKED \(conflicting_decisions\)/);
    expect(run.stderr).toMatch(/exactly ONE decision per proposal hash/);
    // Both artifacts are reported - the trail is shown, never truncated.
    expect(run.stdout.match(/binds the current proposal hash/g) ?? []).toHaveLength(2);
  });

  it("a decision for an EARLIER proposal version is history, not a blocker", () => {
    // Anti-vacuity for the conflict rule: decisions bound to a different hash
    // legitimately coexist, so the rule above is not "any second file blocks".
    const { root, proposalPath, proposal } = seedTeamRepo({ withApprove: true });
    const older = proposalFixture(3);
    const olderApprove = approveFixture(older);
    const dir = teamPlanDir(root, RUN_ID);
    fs.writeFileSync(
      path.join(dir, `build.decision.${olderApprove.decision_hash.slice(0, 12)}.yaml`),
      canonicalYaml(olderApprove)
    );
    expect(olderApprove.proposal_hash).not.toBe(approveFixture(proposal).proposal_hash);
    const run = gate(root, proposalPath);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/binds a DIFFERENT proposal hash/);
  });

  it("BLOCKS a stale decision after the proposal changes (renewed approval required)", () => {
    const proposal = proposalFixture();
    const approve = approveFixture(proposal);
    // A restructured v2 is a DIFFERENT artifact; the v1 approve authorizes nothing.
    const plan = planRestructure(proposal, {
      decision: "restructure",
      restructure_edits: [{ edit_dependencies: { participant_id: "p3", depends_on: [] } }],
      decided_by: { kind: "user" },
      decision_channel: "interactive_prompt",
      decided_at: "2026-07-31T01:00:00Z",
    } as any);
    expect(plan.converged).toBe(false);
    const verdict = preDispatchGate(plan.result!.new_proposal, [
      { source_path: "/trail/v1.yaml", decision: approve, valid: true, reasons: [] },
    ]);
    expect(verdict.allowed).toBe(false);
    expect(verdict.refusal).toBe("stale_or_hash_mismatch");
  });

  it("BLOCKS a restructure decision, an invalid artifact, and a foreign-run approve", () => {
    const proposal = proposalFixture();
    expect(
      preDispatchGate(proposal, [
        {
          source_path: "/t/r.yaml",
          decision: restructureFixture(proposal),
          valid: true,
          reasons: [],
        },
      ]).refusal
    ).toBe("not_an_approve");

    expect(
      preDispatchGate(proposal, [
        {
          source_path: "/t/bad.yaml",
          decision: { ...approveFixture(proposal), decision_hash: "0".repeat(64) } as any,
          valid: false,
          reasons: ["decision_hash mismatch"],
        },
      ]).refusal
    ).toBe("invalid_decision_artifact");

    const foreign = approveFixture(proposal);
    (foreign as any).run_id = "run-other";
    expect(
      preDispatchGate(proposal, [
        { source_path: "/t/f.yaml", decision: foreign, valid: true, reasons: [] },
      ]).allowed
    ).toBe(false);
  });

  it("refuses a participation_kind outside the frozen enum (no advisory bypass)", () => {
    const proposal = proposalFixture();
    proposal.participants[1].participation_kind = "observer";
    const verdict = preDispatchGate(proposal, []);
    expect(verdict.allowed).toBe(false);
    // Either the closed schema rejects it or the kind-coverage gate does; both
    // are fail-closed and neither lets the participant through unapproved.
    expect(["kind_coverage_gap", "invalid_proposal"]).toContain(verdict.refusal);
    expect(kindCoverage([{ participation_kind: "observer" } as any])[0].gated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. restructure: convergent, cap-proof, never self-approving
// ---------------------------------------------------------------------------

describe("T6b(4) — restructure loops", () => {
  const edits = [
    { remove: { participant_id: "p1" } },
    {
      add: {
        participant: {
          participant_id: "p4",
          participation_kind: "worker",
          role_ref: "docs",
          necessity_rationale: "owns the docs leg",
          owned_obligations: ["ob1"],
          depends_on: ["p0"],
          tier: "cheap",
          purpose: "general",
          capability_scope: null,
          backend: "team",
        },
      },
    },
  ];

  function restructure(proposal: object, useEdits: unknown[] = edits) {
    return planRestructure(proposal, {
      decision: "restructure",
      restructure_edits: useEdits,
      decided_by: { kind: "user" },
      decision_channel: "interactive_prompt",
      decided_at: "2026-07-31T00:00:00Z",
    } as any);
  }

  it("is deterministic: the same edits over the same parent yield the same hash", () => {
    const proposal = proposalFixture();
    const a = restructure(proposal);
    const b = restructure(proposalFixture());
    expect(a.result!.new_proposal.proposal_hash).toBe(b.result!.new_proposal.proposal_hash);
    // The parent is never mutated - the trail keeps the exact approved bytes.
    expect(canonicalYaml(proposal as any)).toBe(canonicalYaml(proposalFixture() as any));
    expect(a.result!.new_proposal.parent_proposal_hash).toBe(proposal.proposal_hash);
    expect(a.result!.new_proposal.proposal_version).toBe(2);
  });

  it("CONVERGES: a repeated already-applied edit mints no v3 (T6B-R1-B4)", () => {
    // The exact round-1 probe, now sequential: v1 --remove p1--> v2, then the
    // SAME removal over v2. Round 1 produced a valid v3 with a fresh hash.
    const v1 = proposalFixture();
    const first = restructure(v1, [{ remove: { participant_id: "p1" } }]);
    expect(first.converged).toBe(false);
    const v2 = first.result!.new_proposal;
    expect(v2.proposal_version).toBe(2);

    const second = restructure(v2, [{ remove: { participant_id: "p1" } }]);
    expect(second.converged).toBe(true);
    expect(second.result).toBeNull();
    // No new version, no new hash, no new decision artifact.
    expect(second.proposal.proposal_version).toBe(2);
    expect(second.proposal.proposal_hash).toBe(v2.proposal_hash);
    expect(canonicalYaml(second.proposal as any)).toBe(canonicalYaml(v2 as any));
    expect(second.no_op_edits.join(" ")).toMatch(/remove p1: not in the roster/);

    // The fixed point is stable: a third pass changes nothing either.
    const third = restructure(second.proposal, [{ remove: { participant_id: "p1" } }]);
    expect(third.converged).toBe(true);
    expect(third.proposal.proposal_hash).toBe(v2.proposal_hash);
  });

  it("CONVERGES on a semantic no-op the per-edit heuristic cannot see", () => {
    // `edit_dependencies` naming a PRESENT participant with the dependencies it
    // already has is a no-op no per-edit check catches - the convergence test
    // is semantic (produced roster vs parent roster), so it still converges.
    const v1 = proposalFixture();
    const plan = restructure(v1, [
      { edit_dependencies: { participant_id: "p1", depends_on: ["p0"] } },
    ]);
    expect(plan.converged).toBe(true);
    expect(plan.result).toBeNull();
    expect(plan.proposal.proposal_hash).toBe(v1.proposal_hash);
    expect(plan.proposal.proposal_version).toBe(1);
  });

  it("CONVERGES through the real CLI: no version churn on a repeat (real CLI)", () => {
    const root = tmpRepo();
    const v1 = proposalFixture();
    const v1Path = path.join(root, "v1.json");
    fs.writeFileSync(v1Path, JSON.stringify(v1));
    const editsPath = path.join(root, "edits.json");
    fs.writeFileSync(editsPath, JSON.stringify([{ remove: { participant_id: "p1" } }]));

    const first = runCli("team-decide.ts", [
      "restructure", "--proposal", v1Path, "--edits", editsPath,
      "--decided-by", "user", "--channel", "interactive_prompt", "--json",
    ]);
    expect(first.code).toBe(0);
    const firstOut = JSON.parse(first.stdout);
    expect(firstOut.converged).toBe(false);
    expect(firstOut.new_proposal.proposal_version).toBe(2);

    const v2Path = path.join(root, "v2.json");
    fs.writeFileSync(v2Path, JSON.stringify(firstOut.new_proposal));
    const second = runCli("team-decide.ts", [
      "restructure", "--proposal", v2Path, "--edits", editsPath,
      "--decided-by", "user", "--channel", "interactive_prompt", "--json",
    ]);
    expect(second.code).toBe(0);
    const secondOut = JSON.parse(second.stdout);
    expect(secondOut.converged).toBe(true);
    expect(secondOut.new_proposal).toBeNull();
    expect(secondOut.restructure_decision).toBeNull();
    expect(secondOut.proposal.proposal_version).toBe(2);
    expect(secondOut.proposal.proposal_hash).toBe(firstOut.new_proposal.proposal_hash);

    const text = runCli("team-decide.ts", [
      "restructure", "--proposal", v2Path, "--edits", editsPath,
      "--decided-by", "user", "--channel", "interactive_prompt",
    ]);
    expect(text.stdout).toMatch(/restructure CONVERGED/);
    expect(text.stdout).toMatch(/no new version, hash or decision was minted/);
  });

  it("reports an already-satisfied edit instead of looping forever", () => {
    const proposal = proposalFixture();
    const plan = restructure(proposal, [{ remove: { participant_id: "does-not-exist" } }]);
    expect(plan.no_op_edits.join(" ")).toMatch(/remove does-not-exist: not in the roster/);
    expect(plan.converged).toBe(true);
  });

  it("never auto-approves: the produced proposal is always PENDING a new decision", () => {
    const plan = restructure(proposalFixture());
    expect(plan.result!.new_decision_state).toBe("pending");
    expect(plan.result!.restructure_decision.decision).toBe("restructure");
    // The pending proposal cannot dispatch on its own.
    expect(preDispatchGate(plan.result!.new_proposal, []).allowed).toBe(false);
  });

  it("surfaces coverage impact when an edit orphans an obligation", () => {
    const plan = restructure(proposalFixture(), [{ remove: { participant_id: "p2" } }]);
    expect(plan.converged).toBe(false);
    expect(plan.result!.lost_obligations).toContain("ob2");
    expect(plan.valid).toBe(false);
  });

  it("cannot silently reintroduce a cap (scanner is anti-vacuous)", () => {
    const plan = restructure(proposalFixture());
    expect(plan.cap_reintroduction).toEqual([]);
    // The scanner MUST fire on a planted cap key, or the clean result is meaningless.
    const planted = JSON.parse(JSON.stringify(plan.result!.new_proposal));
    planted.cap = 6;
    planted.participants[0].dropped_roles = ["mobile"];
    expect(scanCapReintroduction(planted).sort()).toEqual([
      "cap",
      "participants.0.dropped_roles",
    ]);
  });

  it("cannot silently drop a role: every roster delta must be edit-cited", () => {
    const plan = restructure(proposalFixture());
    expect(plan.uncited_roster_delta).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. the gate is wired into EVERY dispatching command surface
// ---------------------------------------------------------------------------

describe("T6b(5) — the blocking gate is present on every dispatching command", () => {
  it.each(DISPATCHING_COMMANDS)("%s carries the team decision gate section", (id) => {
    const body = readCommand(id);
    expect(body).toMatch(/## Team decision gate \(blocking/);
    expect(body).toMatch(/never auto-approve/i);
  });

  it.each(DISPATCHING_COMMANDS.filter((c) => c !== "guild"))(
    "%s invokes the executable gate and stops on a non-zero exit",
    (id) => {
      const body = readCommand(id);
      expect(body).toMatch(/scripts\/team-decide\.ts gate/);
      expect(body).toMatch(/STOP on a non-zero exit/);
      // The full decision vocabulary is offered - not a subset.
      for (const verb of DECISION_VOCABULARY) expect(body).toContain(verb);
    }
  );

  it("the router points at the delegated gate rather than dispatching itself", () => {
    const body = readCommand("guild");
    expect(body).toMatch(/scripts\/team-decide\.ts gate/);
    expect(body).toMatch(/--auto-approve` does not cover team approval/);
  });

  it("anti-vacuity: a non-dispatching read-only command does NOT carry the gate", () => {
    // If this ever matches, the assertion above proves nothing (every file would pass).
    expect(readCommand("status")).not.toMatch(/## Team decision gate/);
    expect(readCommand("models")).not.toMatch(/## Team decision gate/);
  });

  it("the decision vocabulary is exactly the frozen §4 set", () => {
    expect([...DECISION_VOCABULARY]).toEqual([
      "approve",
      "add",
      "remove",
      "substitute",
      "edit_dependencies",
      "restructure",
    ]);
    expect(parseDecisionVerb("Edit-Dependencies")).toBe("edit_dependencies");
    expect(parseDecisionVerb("looks good to me")).toBeNull();
    expect(parseDecisionVerb("yes")).toBeNull();
  });
});
