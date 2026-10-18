/**
 * hooks/__tests__/post-tool-use-hot-path.test.ts — C04H: the measured after-edit
 * hot path on a CANDIDATE build, with verification preserved.
 *
 * The C04 profiles attributed the blown KTD29 after-edit budget to guild
 * discovery readdir-ing every sibling of the active root's parent on each hook
 * spawn (432ms of existsSync when that parent is large, e.g. os.tmpdir in the
 * budget fixture). The cut (findParentWorkspace probes the active root's own
 * markers) must keep every verification outcome observable:
 *   pass          silent, exit 0;
 *   fail          stderr excerpt (never swallowed);
 *   rung marker   written by the REAL configured child, not this harness.
 *
 * Candidate bundles are compiled HERE from source through the production
 * compile path (buildOne) into a scratch dir; committed dist is never trusted
 * to represent changed source (C-PERF provisional_source). Identity (source +
 * candidate bundle sha256) is printed so the receipt can pin it.
 *
 * Wall-clock budgets are machine-dependent: per C-PERF, CI wall-clock is
 * ADVISORY — the p95 assertions gate only off CI; correctness always gates.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildOne, targets } from "../../scripts/compile";

const REPO = path.resolve(__dirname, "..", "..");
const BUDGET_AFTER_EDIT_MS = 250;
const RUNS = 20;
const GATE_WALL_CLOCK = process.env["CI"] === undefined;

const sha256 = (file: string): string =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Env for candidate spawns: ambient minus GUILD_*, plus the fixture's own. */
function fixtureEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GUILD_")) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

/** An active-run fixture in os.tmpdir — the ancestry that exposed the C04 storm. */
function makeActiveRunFixture(): { dir: string; runId: string; marker: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-hotpath-c04h-"));
  const runId = "run-c04h-hot-path";
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "touched.ts"), "export const a = 1;\n");
  fs.mkdirSync(path.join(dir, ".guild", "runs", runId, "logs"), { recursive: true });
  const { CURRENT_LAYOUT_VERSION } = require(path.join(REPO, "scripts", "lib", "state", "ensure-storage-layout")) as {
    CURRENT_LAYOUT_VERSION: number;
  };
  fs.writeFileSync(
    path.join(dir, ".guild", "storage-layout.json"),
    JSON.stringify({ storage_layout_version: CURRENT_LAYOUT_VERSION }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(dir, ".guild", "runs", runId, "run.yaml"),
    `schema_version: guild.run.v1\nrun_id: ${runId}\nphase: build\n`,
  );
  const marker = path.join(dir, ".guild", "after-edit-check.marker");
  fs.writeFileSync(
    path.join(dir, ".guild", "verify.json"),
    JSON.stringify(
      {
        schema_version: "guild.verify_checks.v1",
        checks: {
          "verify.after_edit": {
            command: process.execPath,
            args: ["-e", `require("fs").writeFileSync(process.env.GUILD_CHECK_MARKER, "ran"); process.exit(0);`],
          },
        },
      },
      null,
      2,
    ) + "\n",
  );
  return { dir, runId, marker };
}

function editPayload(dir: string): string {
  const edited = path.join(dir, "src", "touched.ts");
  return JSON.stringify({
    session_id: "c04h-hot-path",
    tool_name: "Edit",
    tool_input: { file_path: edited, old_string: "a", new_string: "b" },
    tool_response: { success: true, filePath: edited },
  });
}

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[i];
}

describe("post-tool-use hot path on the candidate build (C04H)", () => {
  let candidateRoot: string;
  let pre: string;
  let post: string;

  beforeAll(() => {
    candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-c04h-candidate-"));
    // A COMPLETE candidate checkout: the hook bundles plus the lazy domain
    // chunks they resolve from the package root (C04). Without the chunks the
    // candidate exercises the fail-closed path instead of the shipped layout.
    for (const id of ["hooks/pre-tool-use", "hooks/post-tool-use", "scripts/lifecycle-api", "scripts/telemetry-api", "scripts/adapters-api"]) {
      const t = targets().find((x) => x.id === id);
      if (!t) throw new Error(`compile table lost ${id}`);
      const outAbs = path.join(candidateRoot, t.out);
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      buildOne(t, outAbs);
    }
    pre = path.join(candidateRoot, "hooks", "dist", "pre-tool-use.js");
    post = path.join(candidateRoot, "hooks", "dist", "post-tool-use.js");
    // Candidate identity for the receipt (AC1: exact candidate hashes).
    const identity = {
      source: {
        "hooks/pre-tool-use.ts": sha256(path.join(REPO, "hooks", "pre-tool-use.ts")),
        "hooks/post-tool-use.ts": sha256(path.join(REPO, "hooks", "post-tool-use.ts")),
        "src/domains/state/guild-discovery.ts": sha256(path.join(REPO, "src", "domains", "state", "guild-discovery.ts")),
      },
      candidate: { "pre-tool-use.js": sha256(pre), "post-tool-use.js": sha256(post) },
    };
    console.log(`[c04h] candidate identity ${JSON.stringify(identity)}`);
  });

  afterAll(() => fs.rmSync(candidateRoot, { recursive: true, force: true }));

  it("C04H-AC2: the REAL configured child writes the green verification marker", () => {
    const fixture = makeActiveRunFixture();
    try {
      fs.rmSync(fixture.marker, { force: true });
      const r = spawnSync("node", [post], {
        input: editPayload(fixture.dir),
        cwd: fixture.dir,
        encoding: "utf8",
        env: fixtureEnv({ GUILD_RUN_ID: fixture.runId, CLAUDE_PLUGIN_ROOT: REPO, GUILD_CHECK_MARKER: fixture.marker }),
      });
      expect(r.status).toBe(0);
      expect(fs.existsSync(fixture.marker)).toBe(true);
      expect(fs.readFileSync(fixture.marker, "utf8").trim()).toBe("ran");
      expect((r.stdout ?? "").length).toBe(0);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("C04H-AC3: a failing configured check is surfaced on stderr, never swallowed", () => {
    const fixture = makeActiveRunFixture();
    try {
      fs.writeFileSync(
        path.join(fixture.dir, ".guild", "verify.json"),
        JSON.stringify(
          {
            schema_version: "guild.verify_checks.v1",
            checks: {
              "verify.after_edit": {
                command: process.execPath,
                args: ["-e", `process.stderr.write("BOOM c04h red check\\n"); process.exit(1);`],
              },
            },
          },
          null,
          2,
        ) + "\n",
      );
      const r = spawnSync("node", [post], {
        input: editPayload(fixture.dir),
        cwd: fixture.dir,
        encoding: "utf8",
        env: fixtureEnv({ GUILD_RUN_ID: fixture.runId, CLAUDE_PLUGIN_ROOT: REPO }),
      });
      // The hook never breaks the user's edit, but the failure must be VISIBLE.
      expect(r.stderr).toContain("BOOM c04h red check");
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("C04H-AC1: 20-sample after-edit path (node, os.tmpdir fixture) meets the 250ms p95 budget", () => {
    // KTD29's `after_edit ≤250ms` names the PostToolUse path — the hook that runs
    // the project's check after an edit lands. It is measured here under plain
    // `node`, the interpreter hooks.json actually uses (the hot-path-budget
    // oracle inherits ITS OWN interpreter for spawns, so under `bun scripts/…`
    // it reports bun-spawn numbers). PreToolUse (not an after-edit stage) and
    // the two-spawn pair are recorded for the receipt: on this class of box a
    // bare `node -e ''` costs ~80ms, so the pair carries ~160ms of pure
    // interpreter startup that no hook change can remove.
    const fixture = makeActiveRunFixture();
    try {
      const payload = editPayload(fixture.dir);
      // GUILD_CHECK_MARKER makes the configured child a PASSING check; without it
      // every timed sample measured a THROWING child (codex C04H r1 F2).
      const env = fixtureEnv({ GUILD_RUN_ID: fixture.runId, CLAUDE_PLUGIN_ROOT: REPO, GUILD_CHECK_MARKER: fixture.marker });
      const postSamples: number[] = [];
      const preSamples: number[] = [];
      const pairSamples: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        fs.rmSync(fixture.marker, { force: true });
        const t0 = process.hrtime.bigint();
        const a = spawnSync("node", [pre], { input: payload, cwd: fixture.dir, encoding: "utf8", env });
        const t1 = process.hrtime.bigint();
        const b = spawnSync("node", [post], { input: payload, cwd: fixture.dir, encoding: "utf8", env });
        const t2 = process.hrtime.bigint();
        preSamples.push(Number(t1 - t0) / 1e6);
        postSamples.push(Number(t2 - t1) / 1e6);
        pairSamples.push(Number(t2 - t0) / 1e6);
        expect(a.status).toBe(0);
        expect(b.status).toBe(0);
        // Each timed sample must be a GREEN verification, proven by the child's marker.
        expect(fs.existsSync(fixture.marker)).toBe(true);
      }
      postSamples.sort((x, y) => x - y);
      preSamples.sort((x, y) => x - y);
      pairSamples.sort((x, y) => x - y);
      const p50 = percentile(postSamples, 50);
      const p95 = percentile(postSamples, 95);
      const pairP95 = percentile(pairSamples, 95);
      console.log(
        `[c04h] after-edit (post) over ${RUNS} runs: p50 ${p50.toFixed(1)}ms · p95 ${p95.toFixed(1)}ms · max ${postSamples[postSamples.length - 1].toFixed(1)}ms · raw ${postSamples.map((s) => s.toFixed(0)).join(",")}`,
      );
      console.log(
        `[c04h] informational: pre p95 ${percentile(preSamples, 95).toFixed(1)}ms · pre+post p95 ${pairP95.toFixed(1)}ms (includes ~2x node startup floor)`,
      );
      // Per C-PERF, CI wall-clock is advisory; the local target gates.
      if (GATE_WALL_CLOCK) expect(p95).toBeLessThanOrEqual(BUDGET_AFTER_EDIT_MS);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("C04H-AC3: discovery still resolves workspace membership identically (manifest and marker parents)", () => {
    // The cut replaced sibling enumeration with direct marker probes; pin the
    // three membership shapes so a regression cannot hide behind the speedup.
    const { discoverGuild } = require(path.join(REPO, "src", "domains", "state", "guild-discovery")) as {
      discoverGuild: (cwd: string) => { activeRoot: string; level: string; workspaceRoot: string | null };
    };
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-c04h-discovery-"));
    try {
      // 1. Manifest parent: child registered in .guild/workspace.json.
      const wsRoot = path.join(base, "ws");
      fs.mkdirSync(path.join(wsRoot, ".guild"), { recursive: true });
      fs.mkdirSync(path.join(wsRoot, "child", ".git"), { recursive: true });
      fs.mkdirSync(path.join(wsRoot, "child", ".guild"), { recursive: true });
      fs.writeFileSync(
        path.join(wsRoot, ".guild", "workspace.json"),
        JSON.stringify({ schema_version: "guild.workspace.v1", is_workspace: true, sub_guilds: [{ name: "child", path: "child" }] }) + "\n",
      );
      const viaManifest = discoverGuild(path.join(wsRoot, "child"));
      expect(viaManifest.level).toBe("project");
      expect(viaManifest.workspaceRoot).toBe(wsRoot);

      // 2. Marker parent (no manifest): child with .git/.guild is a registered child.
      const bare = path.join(base, "bare");
      fs.mkdirSync(path.join(bare, "proj", ".git"), { recursive: true });
      fs.mkdirSync(path.join(bare, "proj", ".guild"), { recursive: true });
      const viaMarkers = discoverGuild(path.join(bare, "proj"));
      expect(viaMarkers.level).toBe("project");
      expect(viaMarkers.activeRoot).toBe(path.join(bare, "proj"));

      // 3. A root that is itself a workspace (marked children, no parent claim).
      const solo = path.join(base, "solo");
      fs.mkdirSync(path.join(solo, ".git"), { recursive: true });
      fs.mkdirSync(path.join(solo, ".guild"), { recursive: true });
      fs.mkdirSync(path.join(solo, "sub", ".guild"), { recursive: true });
      fs.writeFileSync(
        path.join(solo, ".guild", "settings.json"),
        JSON.stringify({ workspace: { mode: "on" } }) + "\n",
      );
      const workspace = discoverGuild(solo);
      expect(workspace.level).toBe("workspace");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
