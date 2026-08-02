/**
 * scripts/__tests__/u6-run-provenance.test.ts
 *
 * Usage: npx jest --testPathPattern='run-lifecycle|u6' from plugin/scripts.
 *
 * Unit 6 — Run provenance (resolved-settings snapshot).
 *
 * Covers:
 *   - writeResolvedSettingsSnapshot writes resolved-settings.json with ALL
 *     required fields (source_chain, effective backend, providers, communication_contract).
 *   - resolved_at_ref is set (to the run-id or a passed ref), never null, after write.
 *   - readResolvedSettingsSnapshot round-trips the snapshot.
 *   - startRun WITH a snapshot writes resolved-settings.json AND adds settings_ref to run.yaml.
 *   - startRun WITHOUT a snapshot is back-compat: behavior is exactly as before
 *     (no extra files, existing tests stay green).
 *   - run.yaml settings_ref shape: { path, schema_version, effective_backend, review, recommended_provider }.
 *   - AC-10: the snapshot includes source_chain, effective backend, providers
 *     {authorHost, detected, recommended, selected?}, and communication_contract.
 */

import * as fsNode from "fs";
import * as os from "os";
import * as path from "path";
import {
  createRunLifecycle,
  writeResolvedSettingsSnapshot,
  readResolvedSettingsSnapshot,
  type RunLifecycleEnv,
  type StartRunOpts,
} from "../lib/run-lifecycle";
import type { HostKind } from "../lib/host-types";
import type { ResolvedSettingsSnapshot } from "../lib/runstart-preflight";

// ── In-memory fs seam (same pattern as run-lifecycle.test.ts) ────────────────

interface MemFs {
  files: Map<string, string>;
  dirs: Set<string>;
  env: RunLifecycleEnv["fs"];
}

function memFs(): MemFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const env: RunLifecycleEnv["fs"] = {
    mkdirp(absPath: string): void {
      let p = absPath;
      while (p && p !== path.dirname(p)) {
        dirs.add(p);
        p = path.dirname(p);
      }
    },
    writeFile(absPath: string, contents: string): void {
      dirs.add(path.dirname(absPath));
      files.set(absPath, contents);
    },
    readFile(absPath: string): string | null {
      return files.has(absPath) ? (files.get(absPath) as string) : null;
    },
    exists(absPath: string): boolean {
      return files.has(absPath) || dirs.has(absPath);
    },
  };
  return { files, dirs, env };
}

function makeEnv(
  mem: MemFs,
  opts: { now?: string; resolved?: HostKind } = {}
): RunLifecycleEnv {
  const clock = opts.now ?? "2026-05-29T08:40:21Z";
  return {
    now: () => clock,
    fs: mem.env,
    resolveHost: (requested: string) => ({
      requested,
      resolved: opts.resolved ?? ("claude" as HostKind),
    }),
    __rootHint: ROOT,
  } as RunLifecycleEnv;
}

/**
 * THE PROJECT ROOT IS A REAL DIRECTORY. The writes are still in-memory.
 *
 * ── Why this changed (task #37) ────────────────────────────────────────────────
 * `ROOT` used to be the fictional string "/abs/workspace". That worked while
 * run-lifecycle's `assertContained` was purely lexical, and stopped working when
 * feature/path-containment migrated it to `checkContained(..., {policy:
 * "physical"})`. The primitive `realpathSync`es the ROOT, so a root that is not on
 * disk is `root-unresolvable` and every call throws.
 *
 * That migration is CORRECT on the merits — the lexical guard walked straight
 * through a symlinked `.guild/runs` — and it made the root's physical reality part
 * of this function's contract. In production the root is the project root and is
 * always real (`startRun` mkdirps under it before the guard ever runs). So the
 * honest repair is on THIS side: the fixture root now IS a directory, which is what
 * the contract has required since the migration.
 *
 * THE FS SEAM IS UNTOUCHED. Every write and read still goes through the in-memory
 * `memFs`, including the HK-06 `scrubbedWriteDurable` fail-closed cases — nothing
 * is written to the real filesystem by any test in this file. Only the ROOT is real,
 * because only the ROOT is what the containment guard reads.
 *
 * ── What the fictional root was silently costing ──────────────────────────────
 * It did not merely fail 16 tests. Under an unresolvable root, EVERY call threw
 * (write) or returned null (read) regardless of its arguments — so the 28
 * runId-validation cases below were passing VACUOUSLY: they asserted "throws" /
 * "returns null" and got it from the containment root check, never reaching
 * `validateRunId`. The tell was visible in the suite all along: the bad-id cases
 * were green while "a valid runId still works" was red. Those cases now assert the
 * MESSAGE, so they can only pass by way of the validator they are named for.
 *
 * ── The residual, NOT fixed here ───────────────────────────────────────────────
 * `run-lifecycle.ts` is built around an injectable fs seam, and this one guard
 * reaches past it to the real filesystem. Against a virtual fs the guard therefore
 * describes a filesystem the writes never touch. That is a real inconsistency, it
 * is pinned by an explicit test at the bottom of this file rather than left
 * implicit, and it is deliberately NOT repaired here: every candidate repair
 * (an fs seam on the kernel primitive; a lexical pre-check; a policy the seam
 * selects) is a design change to the shared containment primitive while tasks #34
 * and #35 are still deciding its authority contract. See task #37.
 */
const ROOT = fsNode.realpathSync(fsNode.mkdtempSync(path.join(os.tmpdir(), "guild-u6-root-")));

afterAll(() => {
  fsNode.rmSync(ROOT, { recursive: true, force: true });
});

function baseStartOpts(over: Partial<StartRunOpts> = {}): StartRunOpts {
  return {
    command: "/guild:plan",
    arguments: { rigor: "deep" },
    cwd: ROOT,
    root: ROOT,
    target_kind: "workspace",
    workspace: { is_workspace: true, root: ROOT },
    project: "guild (workspace root)",
    host_requested: "auto",
    model_tier_policy: "rigor=deep profile",
    ignore_policy: "workspace .gitignore",
    scan_policy: "cheap-map",
    initiative: null,
    phase: "plan",
    run_class: "full",
    ...over,
  };
}

/** A minimal but fully-valid ResolvedSettingsSnapshot for use in tests. */
function makeSnapshot(over: Partial<ResolvedSettingsSnapshot> = {}): ResolvedSettingsSnapshot {
  return {
    schema_version: "guild.resolved_settings.v1",
    source_chain: {
      agent_mode: "workspace",
      review: "workspace",
      rigor: "workspace",
      loops: "builtin",
      loop_cap: "builtin",
      host: "builtin",
    },
    effective: {
      agent_mode: "team",
      host: "auto",
      review: "cross",
      rigor: "deep",
      loops: "all",
      loop_cap: 16,
    },
    providers: {
      authorHost: "claude",
      detected: [
        { id: "codex-plugin", kind: "plugin-adapter", detected: true, authed: true, selectable: true, family: "codex", detail: "codex plugin adapter" },
        { id: "codex-cli", kind: "cli", detected: false, authed: false, selectable: false, family: "codex", detail: "codex cli not found" },
      ],
      recommended: "codex-plugin",
    },
    communication_contract: "review_result.v1",
    // P1-L8: roles is a required field on ResolvedSettingsSnapshot — minimal valid set
    // (host substrate = claude-code-cli; advisory/adversarial resolve to canonical hosts).
    roles: {
      schema_version: "guild.role_resolution.v1",
      host: { role: "host", substrate: "claude-code-cli", strength: "strong", reason: "author host" },
      advisory: { role: "advisory", substrate: "claude-code-cli", strength: "weak", reason: "same-family fallback" },
      adversarial: { role: "adversarial", substrate: "codex-cli", strength: "strong", reason: "cross-family" },
    },
    resolved_at_ref: null,
    ...over,
  };
}

// ── writeResolvedSettingsSnapshot ──────────────────────────────────────────────

describe("u6 — writeResolvedSettingsSnapshot", () => {
  it("writes resolved-settings.json at the expected path and returns it", () => {
    const mem = memFs();
    const snapshot = makeSnapshot();
    const writtenPath = writeResolvedSettingsSnapshot(
      "run-test-123",
      snapshot,
      { cwd: ROOT, fs: mem.env }
    );

    const expectedPath = path.join(ROOT, ".guild", "runs", "run-test-123", "resolved-settings.json");
    expect(writtenPath).toBe(expectedPath);
    expect(mem.files.has(expectedPath)).toBe(true);
  });

  it("AC-10: written file contains ALL required fields: source_chain, effective, providers, communication_contract", () => {
    const mem = memFs();
    const snapshot = makeSnapshot();
    writeResolvedSettingsSnapshot("run-ac10", snapshot, { cwd: ROOT, fs: mem.env });

    const filePath = path.join(ROOT, ".guild", "runs", "run-ac10", "resolved-settings.json");
    const parsed = JSON.parse(mem.files.get(filePath) as string);

    // schema version
    expect(parsed.schema_version).toBe("guild.resolved_settings.v1");

    // source_chain: at least the expected keys
    expect(parsed.source_chain).toBeDefined();
    expect(typeof parsed.source_chain).toBe("object");
    expect(parsed.source_chain.agent_mode).toBe("workspace");

    // effective: all 6 keys
    expect(parsed.effective.agent_mode).toBe("team");
    expect(parsed.effective.host).toBe("auto");
    expect(parsed.effective.review).toBe("cross");
    expect(parsed.effective.rigor).toBe("deep");
    expect(parsed.effective.loops).toBe("all");
    expect(parsed.effective.loop_cap).toBe(16);

    // providers block with authorHost, detected, recommended
    expect(parsed.providers.authorHost).toBe("claude");
    expect(Array.isArray(parsed.providers.detected)).toBe(true);
    expect(parsed.providers.recommended).toBe("codex-plugin");

    // communication_contract
    expect(parsed.communication_contract).toBe("review_result.v1");
  });

  it("AC-10: providers block may carry optional selected field when set in snapshot", () => {
    const mem = memFs();
    const snapshot = makeSnapshot({
      providers: {
        authorHost: "claude" as const,
        detected: [],
        recommended: "codex-plugin",
        selected: "codex-plugin",
      },
    });
    writeResolvedSettingsSnapshot("run-selected", snapshot, { cwd: ROOT, fs: mem.env });

    const filePath = path.join(ROOT, ".guild", "runs", "run-selected", "resolved-settings.json");
    const parsed = JSON.parse(mem.files.get(filePath) as string);
    expect(parsed.providers.selected).toBe("codex-plugin");
  });

  it("resolved_at_ref is set to the run-id (default) when no resolvedAtRef param is passed", () => {
    const mem = memFs();
    const snapshot = makeSnapshot();
    writeResolvedSettingsSnapshot("run-ref-default", snapshot, { cwd: ROOT, fs: mem.env });

    const filePath = path.join(ROOT, ".guild", "runs", "run-ref-default", "resolved-settings.json");
    const parsed = JSON.parse(mem.files.get(filePath) as string);
    // resolved_at_ref must be set (not null) — default = the runId
    expect(parsed.resolved_at_ref).toBe("run-ref-default");
  });

  it("resolved_at_ref is set to the passed timestamp ref when provided", () => {
    const mem = memFs();
    const snapshot = makeSnapshot();
    writeResolvedSettingsSnapshot("run-ref-custom", snapshot, {
      cwd: ROOT,
      fs: mem.env,
      resolvedAtRef: "2026-06-01T10:00:00Z",
    });

    const filePath = path.join(ROOT, ".guild", "runs", "run-ref-custom", "resolved-settings.json");
    const parsed = JSON.parse(mem.files.get(filePath) as string);
    expect(parsed.resolved_at_ref).toBe("2026-06-01T10:00:00Z");
  });

  it("does NOT mutate the input snapshot's resolved_at_ref field", () => {
    const mem = memFs();
    const snapshot = makeSnapshot();
    expect(snapshot.resolved_at_ref).toBeNull();
    writeResolvedSettingsSnapshot("run-no-mutate", snapshot, { cwd: ROOT, fs: mem.env });
    // Original snapshot object should remain unmodified
    expect(snapshot.resolved_at_ref).toBeNull();
  });
});

// ── readResolvedSettingsSnapshot ───────────────────────────────────────────────

describe("u6 — readResolvedSettingsSnapshot", () => {
  it("round-trips: read returns a snapshot equal to what was written (bar resolved_at_ref)", () => {
    const mem = memFs();
    const snapshot = makeSnapshot();
    writeResolvedSettingsSnapshot("run-roundtrip", snapshot, { cwd: ROOT, fs: mem.env });

    const readBack = readResolvedSettingsSnapshot("run-roundtrip", { cwd: ROOT, fs: mem.env });
    expect(readBack).not.toBeNull();
    expect(readBack!.schema_version).toBe("guild.resolved_settings.v1");
    expect(readBack!.effective.agent_mode).toBe("team");
    expect(readBack!.effective.review).toBe("cross");
    expect(readBack!.providers.authorHost).toBe("claude");
    expect(readBack!.providers.recommended).toBe("codex-plugin");
    expect(readBack!.communication_contract).toBe("review_result.v1");
    // resolved_at_ref was set to the runId by write
    expect(readBack!.resolved_at_ref).toBe("run-roundtrip");
  });

  it("returns null when resolved-settings.json does not exist", () => {
    const mem = memFs();
    const result = readResolvedSettingsSnapshot("run-nonexistent", { cwd: ROOT, fs: mem.env });
    expect(result).toBeNull();
  });

  it("returns null when the file is not valid JSON", () => {
    const mem = memFs();
    const badPath = path.join(ROOT, ".guild", "runs", "run-badjson", "resolved-settings.json");
    mem.env.writeFile(badPath, "not valid json {{ ");

    const result = readResolvedSettingsSnapshot("run-badjson", { cwd: ROOT, fs: mem.env });
    expect(result).toBeNull();
  });
});

// ── startRun WITH snapshot ─────────────────────────────────────────────────────

describe("u6 — startRun with snapshot (settings_ref in run.yaml)", () => {
  it("writes resolved-settings.json when snapshot is provided", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const snapshot = makeSnapshot();
    const runId = lc.startRun(baseStartOpts({ initiative: "test-init", snapshot }));

    const expectedPath = path.join(ROOT, ".guild", "runs", runId, "resolved-settings.json");
    expect(mem.files.has(expectedPath)).toBe(true);
  });

  it("run.yaml gains settings_ref block when snapshot is provided", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const snapshot = makeSnapshot();
    const runId = lc.startRun(baseStartOpts({ snapshot }));

    const yamlPath = path.join(ROOT, ".guild", "runs", runId, "run.yaml");
    const raw = mem.files.get(yamlPath) as string;
    expect(raw).toContain("settings_ref:");
    expect(raw).toContain("resolved-settings.json");
    expect(raw).toContain("guild.resolved_settings.v1");
  });

  it("settings_ref contains effective_backend (agent_mode), review, recommended_provider", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const snapshot = makeSnapshot();
    const runId = lc.startRun(baseStartOpts({ snapshot }));

    const yamlPath = path.join(ROOT, ".guild", "runs", runId, "run.yaml");
    const raw = mem.files.get(yamlPath) as string;
    expect(raw).toContain("effective_backend: team");
    expect(raw).toContain("review: cross");
    expect(raw).toContain("recommended_provider: codex-plugin");
  });

  it("resolved-settings.json resolved_at_ref is set to runId (not null)", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const snapshot = makeSnapshot();
    const runId = lc.startRun(baseStartOpts({ initiative: "prov-test", snapshot }));

    const filePath = path.join(ROOT, ".guild", "runs", runId, "resolved-settings.json");
    const parsed = JSON.parse(mem.files.get(filePath) as string);
    expect(parsed.resolved_at_ref).toBe(runId);
    expect(parsed.resolved_at_ref).not.toBeNull();
  });

  it("resolved-settings.json has all AC-10 required fields when written via startRun", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const snapshot = makeSnapshot({
      providers: {
        authorHost: "claude" as const,
        detected: [{ id: "codex-plugin", kind: "plugin-adapter", detected: true, authed: true, selectable: true, family: "codex" as const, detail: "codex plugin adapter" }],
        recommended: "codex-plugin",
        selected: "codex-plugin",
      },
    });
    const runId = lc.startRun(baseStartOpts({ snapshot }));

    const filePath = path.join(ROOT, ".guild", "runs", runId, "resolved-settings.json");
    const parsed = JSON.parse(mem.files.get(filePath) as string);

    expect(parsed.source_chain).toBeDefined();
    expect(parsed.effective.agent_mode).toBe("team");
    expect(parsed.providers.authorHost).toBe("claude");
    expect(parsed.providers.detected).toHaveLength(1);
    expect(parsed.providers.recommended).toBe("codex-plugin");
    expect(parsed.providers.selected).toBe("codex-plugin");
    expect(parsed.communication_contract).toBe("review_result.v1");
  });
});

// ── back-compat: startRun WITHOUT snapshot ────────────────────────────────────

describe("u6 — back-compat: startRun WITHOUT snapshot", () => {
  it("writes EXACTLY run.yaml + current-run-id (no resolved-settings.json)", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ initiative: "compat-test" }));
    const written = [...mem.files.keys()].sort();
    expect(written).toEqual(
      [
        path.join(ROOT, ".guild", "runs", "current-run-id"),
        path.join(ROOT, ".guild", "runs", runId, "run.yaml"),
      ].sort()
    );
  });

  it("run.yaml does NOT contain settings_ref when no snapshot is provided", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts());
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(raw).not.toContain("settings_ref:");
  });

  it("existing run.yaml fields are unchanged when no snapshot is provided", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem, { now: "2026-05-29T08:40:21Z" }));
    const runId = lc.startRun(baseStartOpts({ initiative: "alpha" }));
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(raw).toContain("schema_version: guild.run.v1");
    expect(raw).toContain("started_at: 2026-05-29T08:40:21Z");
    expect(raw).toContain("status: open");
    expect(raw).toContain("initiative_attachment: alpha");
  });

  it("NN#5 back-compat: no .guild/initiatives/ dir created without snapshot", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    lc.startRun(baseStartOpts({ initiative: "foo" }));
    for (const d of mem.dirs) {
      expect(d).not.toContain(`${path.sep}initiatives`);
    }
    for (const f of mem.files.keys()) {
      expect(f).not.toContain(`${path.sep}initiatives${path.sep}`);
    }
  });

  it("readResolvedSettingsSnapshot returns null for a run started without snapshot", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts());
    const result = readResolvedSettingsSnapshot(runId, { cwd: ROOT, fs: mem.env });
    expect(result).toBeNull();
  });
});

// ── Security: runId validation + path containment ──────────────────────────────

describe("u6 — runId validation (path-traversal containment)", () => {
  const traversalIds = [
    "../escape",
    "../../etc/passwd",
    "../escape/resolved-settings",
    "..",
    ".",
    "",
    "   ",
    "/absolute/path",
    "\\windows\\path",
    "run/with/slash",
    "run\\backslash",
    "run\x00null",
    "..foo",
    "foo..bar",
  ];

  describe("writeResolvedSettingsSnapshot — throws on bad runId, writes nothing outside runs/", () => {
    for (const badId of traversalIds) {
      it(`throws for runId ${JSON.stringify(badId)}`, () => {
        const mem = memFs();
        const snapshot = makeSnapshot();
        // ASSERT THE MESSAGE, not merely "it threw". A bare toThrow() is satisfied
        // by ANY throw, which is how these cases stayed green for months while the
        // containment guard was rejecting the fixture root before `validateRunId`
        // was ever reached. Naming the validator is what makes the case about the
        // runId — swap `badId` for a valid one and this goes red, which a bare
        // toThrow() would not have.
        expect(() =>
          writeResolvedSettingsSnapshot(badId, snapshot, { cwd: ROOT, fs: mem.env })
        ).toThrow(/invalid runId/);
        // No file written outside .guild/runs/<safe-subdir>/
        const runsBase = path.join(ROOT, ".guild", "runs") + path.sep;
        for (const f of mem.files.keys()) {
          expect(f.startsWith(runsBase)).toBe(true);
        }
      });
    }
  });

  describe("readResolvedSettingsSnapshot — returns null on bad runId", () => {
    for (const badId of traversalIds) {
      it(`returns null for runId ${JSON.stringify(badId)}`, () => {
        const mem = memFs();
        // Seed a file at a location the bad id might resolve to
        const maybeEscape = path.join(ROOT, ".guild", "resolved-settings.json");
        mem.env.writeFile(maybeEscape, '{"schema_version":"guild.resolved_settings.v1"}');
        const result = readResolvedSettingsSnapshot(badId, { cwd: ROOT, fs: mem.env });
        expect(result).toBeNull();
      });
    }
  });

  it("a valid runId still works after validation is added", () => {
    const mem = memFs();
    const snapshot = makeSnapshot();
    const writtenPath = writeResolvedSettingsSnapshot(
      "run-safe-abc123",
      snapshot,
      { cwd: ROOT, fs: mem.env }
    );
    expect(writtenPath).toBe(
      path.join(ROOT, ".guild", "runs", "run-safe-abc123", "resolved-settings.json")
    );
    const readBack = readResolvedSettingsSnapshot("run-safe-abc123", { cwd: ROOT, fs: mem.env });
    expect(readBack).not.toBeNull();
    expect(readBack!.schema_version).toBe("guild.resolved_settings.v1");
  });
});

// ── HK-06 — resolved-settings.json fail-CLOSED via scrubbedWriteDurable seam ────
//
// Argument-identity invariant: when scrubbedWriteDurable returns blocked:true,
// resolved-settings.json MUST NOT exist on disk. Assert the on-disk effect.
//
// Uses scrubbedWriteDurable (NOT scrubbedWriteFile) so the seam matches
// RunLifecycleEnv.fs — the REAL start-run path that createRealEnv wires.

describe("u6 — HK-06 resolved-settings.json scrubbed-write coverage", () => {
  type ScrubResult = { written: boolean; blocked: boolean };
  type ScrubSurface = "handoff" | "learnings" | "provenance" | "config" | "wiki" | "review" | "bus" | "telemetry";

  /** Build a memFs whose env has a fake scrubbedWriteDurable seam. */
  function memFsWithScrubWriteDurable(scrubResult: ScrubResult): MemFs {
    const mem = memFs();
    // mem.env is RunLifecycleEnv["fs"] which already declares scrubbedWriteDurable? —
    // no cast needed.
    mem.env.scrubbedWriteDurable = (
      outPath: string,
      contents: string,
      _surface: ScrubSurface,
      _runDir: string,
      _runId: string,
    ): ScrubResult => {
      if (scrubResult.written) {
        mem.files.set(outPath, contents);
        mem.dirs.add(path.dirname(outPath));
      }
      return scrubResult;
    };
    return mem;
  }

  it("HK-06: resolved-settings.json NOT created when scrubbedWriteDurable returns blocked:true (fail-CLOSED)", () => {
    const mem = memFsWithScrubWriteDurable({ written: false, blocked: true });
    const snapshot = makeSnapshot();
    writeResolvedSettingsSnapshot("run-scrub-blocked", snapshot, { cwd: ROOT, fs: mem.env });

    const expectedPath = path.join(ROOT, ".guild", "runs", "run-scrub-blocked", "resolved-settings.json");
    // Fail-CLOSED invariant: the file MUST NOT exist when scrub is blocked.
    expect(mem.files.has(expectedPath)).toBe(false);
  });

  it("HK-06: resolved-settings.json IS created when scrubbedWriteDurable returns written:true (happy path)", () => {
    const mem = memFsWithScrubWriteDurable({ written: true, blocked: false });
    const snapshot = makeSnapshot();
    writeResolvedSettingsSnapshot("run-scrub-ok", snapshot, { cwd: ROOT, fs: mem.env });

    const expectedPath = path.join(ROOT, ".guild", "runs", "run-scrub-ok", "resolved-settings.json");
    expect(mem.files.has(expectedPath)).toBe(true);
  });

  it("HK-06: backward compat — no scrubbedWriteDurable on seam → falls through to writeFile", () => {
    // Standard memFs (no scrubbedWriteDurable) — resolved-settings.json written normally.
    const mem = memFs();
    const snapshot = makeSnapshot();
    writeResolvedSettingsSnapshot("run-compat", snapshot, { cwd: ROOT, fs: mem.env });

    const expectedPath = path.join(ROOT, ".guild", "runs", "run-compat", "resolved-settings.json");
    expect(mem.files.has(expectedPath)).toBe(true);
    const parsed = JSON.parse(mem.files.get(expectedPath) as string);
    expect(parsed.schema_version).toBe("guild.resolved_settings.v1");
  });
});

// ── The seam-bypass residual, PINNED rather than skipped (task #37) ────────────
//
// This block exists because the alternative was a skipped test, and a skipped test
// is a defect nobody can see. It does not assert that the behaviour below is GOOD.
// It asserts exactly what the behaviour IS, so that the day someone routes the
// containment guard through the module's fs seam — or gives the kernel primitive a
// seam of its own — these cases go red and force the decision to be re-recorded
// here instead of silently changing under everyone.
//
// THE FACT: `run-lifecycle.ts` accepts an injectable fs seam for every read and
// write, but `assertContained` calls the kernel's `checkContained` with
// `policy: "physical"`, which reaches the REAL filesystem directly. So the guard
// judges a filesystem the writes never touch. Against a virtual root the verdict is
// `root-unresolvable` — not because anything escaped, but because the guard cannot
// see the fs the caller injected.
//
// WHY IT IS NOT REPAIRED HERE, and why that is a waiver rather than a shrug:
//   - Production is unaffected, and that was measured, not assumed:
//     run-lifecycle.test.ts and write-run-manifest.test.ts drive the REAL fs
//     (mkdtempSync / createRealEnv) and pass; on the startRun path
//     env.fs.mkdirp(logsDir(...)) runs BEFORE writeResolvedSettingsSnapshot, so
//     the root exists by the time the guard runs. The exposure is
//     writeResolvedSettingsSnapshot as a STANDALONE export against a root that is
//     not on disk.
//   - Every candidate repair is a design change to the SHARED containment
//     primitive: (a) an optional fs seam on `checkContained` is a public API
//     change; (b) a lexical pre-check reintroduces exactly the lexical-guard shape
//     whose absence the rail's signal is built to detect; (c) letting the seam
//     select the policy is the authority question tasks #34 and #35 are open on.
//     Picking one inside a merge-unblocking commit would be deciding #35 by
//     accident.
describe("u6 — KNOWN RESIDUAL (task #37): the containment guard bypasses the fs seam", () => {
  const VIRTUAL_ROOT = "/abs/workspace-that-is-not-on-disk";

  it("a virtual root is REFUSED even though the injected seam could serve it", () => {
    const mem = memFs();
    const snapshot = makeSnapshot();
    // The seam is perfectly capable of this write — prove that first, so the
    // refusal below cannot be mistaken for the seam being unable to cope.
    const target = path.join(VIRTUAL_ROOT, ".guild", "runs", "run-virtual", "resolved-settings.json");
    mem.env.writeFile(target, "{}");
    expect(mem.files.has(target)).toBe(true);
    mem.files.delete(target);

    // ASSERT THE CODE, not just "it threw": `root-unresolvable` is the specific
    // refusal that proves the guard is reading the real filesystem for the root.
    // If someone routes it through the seam, the refusal disappears (or becomes a
    // different code) and this goes red — which is the entire point.
    expect(() =>
      writeResolvedSettingsSnapshot("run-virtual", snapshot, { cwd: VIRTUAL_ROOT, fs: mem.env })
    ).toThrow(/root-unresolvable/);
    expect(mem.files.has(target)).toBe(false);
  });

  it("the read side degrades to null on the same virtual root (it does not throw)", () => {
    const mem = memFs();
    const filePath = path.join(
      VIRTUAL_ROOT, ".guild", "runs", "run-virtual", "resolved-settings.json"
    );
    mem.env.writeFile(filePath, '{"schema_version":"guild.resolved_settings.v1"}');
    // The bytes ARE in the seam; the read still reports nothing, because the guard
    // refuses before the seam is consulted. Asserting the file is present first is
    // what stops this being a vacuous "null because empty" case.
    expect(mem.files.has(filePath)).toBe(true);
    expect(readResolvedSettingsSnapshot("run-virtual", { cwd: VIRTUAL_ROOT, fs: mem.env })).toBeNull();
  });

  it("CONTROL: the identical call against a REAL root succeeds through the same seam", () => {
    // Without this the two cases above would be consistent with "the seam is
    // broken" or "run-virtual is a bad id". It is the root, and only the root.
    const mem = memFs();
    const snapshot = makeSnapshot();
    const written = writeResolvedSettingsSnapshot("run-virtual", snapshot, {
      cwd: ROOT,
      fs: mem.env,
    });
    expect(written).toBe(
      path.join(ROOT, ".guild", "runs", "run-virtual", "resolved-settings.json")
    );
    expect(mem.files.has(written)).toBe(true);
  });
});
