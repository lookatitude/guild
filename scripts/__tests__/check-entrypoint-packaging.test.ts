/**
 * scripts/__tests__/check-entrypoint-packaging.test.ts
 *
 * TDD for check-entrypoint-packaging.ts (packaging rail, issue #55's defect class).
 *
 * Covers:
 *  - extractEntrypointRefs: finds `npx tsx`/`node` hooks/ entrypoint references,
 *    including multi-line shell-continuation invocations and env-var prefixes.
 *  - findMissingEntrypoints (SOURCE_MISSING): flags a referenced-but-absent file
 *    anywhere in the source tree; passes when present.
 *  - findMissingInRenderedTree / checkHostPackages (PACKAGE_MISSING): renders the
 *    REAL host packages via build-host-packages.ts and flags a documented
 *    entrypoint that exists in the checkout but is absent from the rendered
 *    package output — the exact regression shape issue #55 was, and the one a
 *    source-tree-only check cannot detect (a revert of the packaging fix would
 *    stay green if the rail only re-checked the source tree).
 *  - CLI (spawnSync): consistent → exit 0; planted missing source entrypoint →
 *    exit 1 + message.
 *  - Live-repo smoke test: the real plugin tree AND every rendered host package
 *    are clean (exit 0) — proves the emit-learning-checkpoint fix end-to-end.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  extractEntrypointRefs,
  findMissingEntrypoints,
  findMissingInRenderedTree,
  checkHostPackages,
  looksLikeRealPluginRoot,
  collectSkillEntrypointRefs,
  ALL_CHECKED_HOST_IDS,
} from "../check-entrypoint-packaging";
import { buildInventory, PLUGIN_ROOT, UNSTAMPED_GENERATED_AT } from "../build-inventory";
import { writeClaudeTree } from "../build-host-packages";
import { syncModuleResources } from "../lib/module-resources";

const SCRIPT = path.resolve(__dirname, "../check-entrypoint-packaging.ts");

function runScript(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 120_000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ── Unit tests: extractEntrypointRefs ──────────────────────────────────────

describe("extractEntrypointRefs", () => {
  it("extracts a single-line npx tsx hooks/ reference", () => {
    const md = "Run: `npx tsx hooks/emit-learning-checkpoint.ts`";
    const refs = extractEntrypointRefs(md, "skills/x/SKILL.md");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      sourceFile: "skills/x/SKILL.md",
      invocation: "npx tsx",
      entrypoint: "hooks/emit-learning-checkpoint.ts",
    });
  });

  it("extracts a reference behind an env-var prefix", () => {
    const md = "npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/emit-learning-checkpoint.ts";
    const refs = extractEntrypointRefs(md, "skills/x/SKILL.md");
    expect(refs).toHaveLength(1);
    expect(refs[0].entrypoint).toBe("hooks/emit-learning-checkpoint.ts");
  });

  it("extracts a multi-line shell-continuation invocation (npx tsx on the next line)", () => {
    const md = [
      "GUILD_RUN_ID=<id> GUILD_PHASE=<phase> \\",
      "  npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/emit-learning-checkpoint.ts",
    ].join("\n");
    const refs = extractEntrypointRefs(md, "skills/x/SKILL.md");
    expect(refs).toHaveLength(1);
    expect(refs[0].entrypoint).toBe("hooks/emit-learning-checkpoint.ts");
  });

  it("extracts a node hooks/dist/ reference", () => {
    const md = 'node "${GUILD_PLUGIN_ROOT}/hooks/dist/run-trace.js" start';
    const refs = extractEntrypointRefs(md, "commands/x.md");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      sourceFile: "commands/x.md",
      invocation: "node",
      entrypoint: "hooks/dist/run-trace.js",
    });
  });

  it("extracts multiple distinct references from the same file", () => {
    const md = [
      "npx tsx hooks/a.ts",
      "some prose in between",
      "node hooks/dist/b.js",
    ].join("\n");
    const refs = extractEntrypointRefs(md, "f.md");
    expect(refs.map(r => r.entrypoint).sort()).toEqual(["hooks/a.ts", "hooks/dist/b.js"]);
  });

  it("returns an empty array when no hooks/ entrypoint invocation is present", () => {
    const md = "Just prose. `npx tsx scripts/other.ts` — not a hooks/ reference.";
    expect(extractEntrypointRefs(md, "f.md")).toHaveLength(0);
  });
});

// ── Unit tests: findMissingEntrypoints (SOURCE_MISSING) ────────────────────

describe("findMissingEntrypoints (SOURCE_MISSING)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-entrypoint-rail-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty when every referenced entrypoint exists", () => {
    fs.mkdirSync(path.join(tmpDir, "skills", "meta", "ok-skill"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "hooks", "real.ts"), "export const x = 1;\n", "utf8");
    fs.writeFileSync(
      path.join(tmpDir, "skills", "meta", "ok-skill", "SKILL.md"),
      "npx tsx ${GUILD_PLUGIN_ROOT}/hooks/real.ts\n",
      "utf8"
    );
    expect(findMissingEntrypoints(tmpDir)).toHaveLength(0);
  });

  it("(anti-vacuity) flags a SKILL.md that documents a missing hooks/ entrypoint", () => {
    fs.mkdirSync(path.join(tmpDir, "skills", "meta", "broken-skill"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "skills", "meta", "broken-skill", "SKILL.md"),
      "npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/does-not-exist.ts\n",
      "utf8"
    );
    const missing = findMissingEntrypoints(tmpDir);
    expect(missing).toHaveLength(1);
    expect(missing[0].entrypoint).toBe("hooks/does-not-exist.ts");
    expect(missing[0].sourceFile).toBe(path.join("skills", "meta", "broken-skill", "SKILL.md"));
  });

  it("flags a hook source's own doc comment referencing a missing sibling entrypoint", () => {
    fs.mkdirSync(path.join(tmpDir, "hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "hooks", "caller.ts"),
      "// Usage: npx tsx hooks/ghost.ts\nexport {};\n",
      "utf8"
    );
    const missing = findMissingEntrypoints(tmpDir);
    expect(missing).toHaveLength(1);
    expect(missing[0].entrypoint).toBe("hooks/ghost.ts");
    expect(missing[0].sourceFile).toBe(path.join("hooks", "caller.ts"));
  });

  it("does not scan excluded directories (dist/__tests__/fixtures/node_modules)", () => {
    fs.mkdirSync(path.join(tmpDir, "hooks", "__tests__"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "hooks", "__tests__", "some.test.ts"),
      "// npx tsx hooks/never-checked.ts\n",
      "utf8"
    );
    expect(findMissingEntrypoints(tmpDir)).toHaveLength(0);
  });
});

// ── Unit tests: findMissingInRenderedTree (pure) ───────────────────────────

describe("findMissingInRenderedTree", () => {
  it("flags entrypoints absent from a rendered-tree-shaped directory", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rendered-tree-"));
    try {
      fs.mkdirSync(path.join(tmp, "hooks"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "hooks", "present.ts"), "export {};\n", "utf8");
      const missing = findMissingInRenderedTree(["hooks/present.ts", "hooks/absent.ts"], tmp);
      expect(missing).toEqual(["hooks/absent.ts"]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty when every entrypoint is present", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rendered-tree-"));
    try {
      fs.mkdirSync(path.join(tmp, "hooks"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "hooks", "a.ts"), "export {};\n", "utf8");
      expect(findMissingInRenderedTree(["hooks/a.ts"], tmp)).toHaveLength(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── looksLikeRealPluginRoot ─────────────────────────────────────────────────

describe("looksLikeRealPluginRoot", () => {
  it("is false for a synthetic minimal fixture", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-fixture-"));
    try {
      expect(looksLikeRealPluginRoot(tmp)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("is true for the real plugin root", () => {
    expect(looksLikeRealPluginRoot(PLUGIN_ROOT)).toBe(true);
  });
});

// ── PACKAGE_MISSING: real renderer, anti-vacuity via post-render deletion ──
//
// Codex review finding: a rail that only re-checks the SOURCE tree stays green
// even if the packaging copy is reverted (the source file already existed
// before issue #55 was fixed — only the render omitted it). This proves the
// check catches that exact regression shape using the REAL renderer
// (writeClaudeTree, not an injected seam): render normally, then delete the
// copied file from the OUTPUT to simulate the copy being silently dropped,
// and assert checkHostPackages-equivalent logic (findMissingInRenderedTree)
// flags it.

describe("PACKAGE_MISSING (real renderer, anti-vacuity)", () => {
  it("flags an entrypoint that exists in the checkout but was removed from rendered package output", () => {
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), "guild-r3-entrypoint-rail-"));
    try {
      const inv = buildInventory(PLUGIN_ROOT);
      const dest = writeClaudeTree(PLUGIN_ROOT, inv, tmpDist, UNSTAMPED_GENERATED_AT);

      // Sanity: the real, current renderer DOES ship it (the fix under test).
      expect(findMissingInRenderedTree(["hooks/emit-learning-checkpoint.ts"], dest)).toHaveLength(0);

      // Simulate the exact issue #55 regression: the source exists, the doc
      // still references it, but the rendered package output lacks it.
      fs.rmSync(path.join(dest, "hooks", "emit-learning-checkpoint.ts"));

      const missing = findMissingInRenderedTree(["hooks/emit-learning-checkpoint.ts"], dest);
      expect(missing).toEqual(["hooks/emit-learning-checkpoint.ts"]);
    } finally {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
  });

  it("checkHostPackages is clean against the live plugin root (every host ships every skill-documented entrypoint)", () => {
    const missingByHost = checkHostPackages(PLUGIN_ROOT, ["hooks/emit-learning-checkpoint.ts"]);
    expect(missingByHost.length).toBeGreaterThan(0); // proves it actually checked something
    for (const { host, missing, renderError } of missingByHost) {
      expect(renderError).toBeUndefined();
      if (missing.length > 0) {
        throw new Error(`host "${host}" is missing: ${missing.join(", ")}`);
      }
    }
  }, 60_000);

  it("checks the EXACT pinned host set — literal ids, so replacing/renaming a host (not just shrinking the list) is caught", () => {
    // Pinned as literals (not derived from ALL_CHECKED_HOST_IDS/HOST_RENDERERS) so this
    // assertion isn't self-referential: a future edit that swaps or renames a host id
    // inside check-entrypoint-packaging.ts must still show up as a real diff here.
    const EXPECTED_HOST_IDS = [
      "claude-code",
      "codex",
      "codex-marketplace",
      "agents",
      "pi",
      "antigravity",
      "cursor",
      "github-copilot",
      "opencode",
      "rovo-dev",
    ];
    const missingByHost = checkHostPackages(PLUGIN_ROOT, ["hooks/emit-learning-checkpoint.ts"]);
    expect(missingByHost.map((r) => r.host).sort()).toEqual([...EXPECTED_HOST_IDS].sort());
    expect([...ALL_CHECKED_HOST_IDS].sort()).toEqual([...EXPECTED_HOST_IDS].sort());
  }, 60_000);

  it("(pinned discovery) collectSkillEntrypointRefs finds the live learning-checkpoint reference", () => {
    // Guards against the extraction grammar silently losing coverage (e.g. a future
    // SKILL.md rewrite to variable-indirection form `ENTRYPOINT="...hooks/x.ts"; npx
    // tsx "$ENTRYPOINT"` would not match ENTRYPOINT_PATTERN). If this ever goes to
    // zero, checkHostPackages() short-circuits and PACKAGE_MISSING silently stops
    // running — this test forces that regression to be visible and fixed instead.
    const refs = collectSkillEntrypointRefs(PLUGIN_ROOT);
    expect(refs.some((r) => r.entrypoint === "hooks/emit-learning-checkpoint.ts")).toBe(true);
  });
});

// ── CLI integration tests ──────────────────────────────────────────────────

describe("CLI: check-entrypoint-packaging.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-entrypoint-rail-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 when every referenced entrypoint exists (synthetic fixture, --source-only)", () => {
    fs.mkdirSync(path.join(tmpDir, "skills", "meta", "ok-skill"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "hooks", "real.ts"), "export const x = 1;\n", "utf8");
    fs.writeFileSync(
      path.join(tmpDir, "skills", "meta", "ok-skill", "SKILL.md"),
      "npx tsx ${GUILD_PLUGIN_ROOT}/hooks/real.ts\n",
      "utf8"
    );
    const { exitCode, stdout, stderr } = runScript(["--cwd", tmpDir, "--source-only"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/every npx tsx \/ node hooks\/ entrypoint/i);
    expect(stderr).toMatch(/--source-only: skipping the rendered host-package check/i);
  });

  it("(anti-vacuity) exits 1 and reports SOURCE_MISSING for a planted-missing fixture", () => {
    fs.mkdirSync(path.join(tmpDir, "skills", "meta", "broken-skill"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "skills", "meta", "broken-skill", "SKILL.md"),
      "npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/does-not-exist.ts\n",
      "utf8"
    );
    const { exitCode, stderr } = runScript(["--cwd", tmpDir, "--source-only"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/SOURCE_MISSING/);
    expect(stderr).toMatch(/hooks\/does-not-exist\.ts/);
  });

  it("(fail-closed) exits 1 with INCOMPLETE_PLUGIN_ROOT when --cwd is incomplete and --source-only is NOT passed", () => {
    // A synthetic fixture with no doc references at all would otherwise exit 0
    // vacuously — the fail-closed guard must still catch the incomplete root.
    const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/INCOMPLETE_PLUGIN_ROOT/);
    expect(stderr).toMatch(/--source-only/);
  });

  describe("against the live plugin root", () => {
    it("is clean on the current codebase, incl. every rendered host package (exit 0) — proves the emit-learning-checkpoint fix", () => {
      const { exitCode, stdout, stderr } = runScript(["--cwd", PLUGIN_ROOT]);
      if (exitCode !== 0) {
        throw new Error(`check-entrypoint-packaging found drift in live codebase:\n${stderr}`);
      }
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/exists in source and in every rendered host package/i);
    }, 60_000);
  });

  describe("(anti-vacuity) full-fixture packaging regression — the CLI's real orchestration must fire", () => {
    it("reports PACKAGE_MISSING via the real CLI for a hooks/ file that genuinely isn't shipped by any renderer", () => {
      // IMPORTANT: check-entrypoint-packaging.ts statically imports writeClaudeTree
      // et al. from THIS repo's scripts/build-host-packages.ts — mutating a COPY of
      // that file inside a fixture has no effect (the CLI subprocess still runs the
      // real, unmutated code; --cwd only changes which tree it scans/renders FROM).
      // So instead of trying to revert the fix, this proves the orchestration fires
      // for real: copy a full plugin tree, then add a throwaway SKILL.md that
      // documents `hooks/comms-format-lint.ts` — a file that genuinely EXISTS in
      // source (passes SOURCE_MISSING) but is never shipped as raw .ts source by any
      // real host renderer (only its dist/*.js bundle ships, for the event-bound
      // hook — its own header even says "For dev/test" for the .ts invocation). No
      // source mutation, no code injection — this is the REAL checkHostPackages
      // orchestration, run via the actual CLI, hitting a genuine discrepancy.
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-r3-packaging-regression-"));
      try {
        for (const dir of ["commands", "skills", "agents", "hooks", "scripts", "src", ".claude-plugin"]) {
          fs.cpSync(path.join(PLUGIN_ROOT, dir), path.join(fixtureRoot, dir), {
            recursive: true,
            // Excluding only `/node_modules/` skips its CONTENTS but not the
            // directory ENTRY itself. When `scripts/node_modules` is a SYMLINK — the
            // ordinary shape in a git worktree that shares one install — the link is
            // copied verbatim, so the per-dep copy below resolves src and dest to the
            // same real path and Node throws "src and dest cannot be the same". The
            // suite then fails for a reason that has nothing to do with packaging.
            filter: (src) =>
              !src.includes(`${path.sep}node_modules${path.sep}`) &&
              path.basename(src) !== "node_modules",
          });
        }
        fs.copyFileSync(path.join(PLUGIN_ROOT, ".mcp.json"), path.join(fixtureRoot, ".mcp.json"));
        for (const dep of ["js-yaml", "argparse"]) {
          fs.cpSync(
            path.join(PLUGIN_ROOT, "scripts", "node_modules", dep),
            path.join(fixtureRoot, "scripts", "node_modules", dep),
            { recursive: true }
          );
        }

        // Sanity: the target file genuinely exists in source but is a "dev/test only"
        // self-invocation, not something any renderer ships as raw source.
        expect(fs.existsSync(path.join(fixtureRoot, "hooks", "comms-format-lint.ts"))).toBe(true);

        // Append (not add — a NEW skill dir would trip module-ownership validation,
        // since it wouldn't be declared in any src/modules/*/module.manifest.json) a
        // throwaway reference to an EXISTING, already-owned skill body.
        const skillPath = path.join(fixtureRoot, "skills", "meta", "learning-checkpoint", "SKILL.md");
        fs.appendFileSync(
          skillPath,
          "\n<!-- test-only, unshipped reference: -->\n" +
            "npx tsx ${GUILD_PLUGIN_ROOT}/hooks/comms-format-lint.ts\n",
          "utf8"
        );
        // Re-derive the fixture's module-resources.json (sha256 manifest) so the
        // appended-to live skill file and its mirror stay consistent — the render
        // must fail for the REAL reason (a genuinely unshipped entrypoint), not an
        // unrelated resource-drift error caused by editing only the live copy.
        const resync = syncModuleResources({ root: fixtureRoot, check: false });
        expect(resync.ok).toBe(true);

        const { exitCode, stderr } = runScript(["--cwd", fixtureRoot]);
        expect(exitCode).toBe(1);
        expect(stderr).toMatch(/PACKAGE_MISSING/);
        expect(stderr).toMatch(/hooks\/comms-format-lint\.ts/);
        expect(stderr).toMatch(/host "claude-code"/);
        // The real, unmutated entrypoint (this lane's actual fix) must still be fine.
        expect(stderr).not.toMatch(/hooks\/emit-learning-checkpoint\.ts/);
      } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }, 60_000);
  });
});
