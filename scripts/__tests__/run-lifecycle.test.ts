/**
 * scripts/__tests__/run-lifecycle.test.ts
 *
 * SC-B — run-lifecycle library (B1 contract §4).
 *
 * Covers:
 *   - createRunLifecycle wires injected now()/fs/resolveHost (no Date.now, no
 *     global fs, no Claude pin).
 *   - startRun writes exactly run.yaml (guild.run.v1) + current-run-id + logs/;
 *     returns the run_id; records initiative as a SCALAR field only.
 *   - NN#5: startRun({initiative}) creates ZERO .guild/initiatives/<slug>/ dir.
 *   - host-neutrality: a NON-claude HostKind resolves + is recorded verbatim
 *     with no error and no claude assumption.
 *   - closeRun writes provenance.json (guild.provenance.v1), references the
 *     terminal trace event by pointer,
 *     flips run.yaml.status.
 *   - lightweight run_class: closeRun short-circuits the learning checkpoint
 *     (final_learning_checkpoint === null) and writes only runs/-scoped files.
 *   - retention_class follows initiative attachment (one-off-90d vs until-archive).
 */

import * as path from "path";
import { createHash } from "crypto";
import {
  createRunLifecycle,
  appendPhase,
  appendGateOutcome,
  assertCanonicalRunId,
  isCanonicalPhase,
  isCanonicalRunId,
  CANONICAL_PHASES,
  type RunLifecycleEnv,
  type StartRunOpts,
} from "../lib/run-lifecycle";
import type { HostKind } from "../lib/host-types";
import { loadRunBinding } from "../lib/run-binding";
import { parseYaml } from "../lib/frontmatter";

/**
 * T3 F2: closeRun requires the run's minted binding nonce (fail-closed §5).
 * Read it back off the in-memory fs for the run the test just started.
 */
function refOf(mem: { env: RunLifecycleEnv["fs"] }, runId: string): string {
  const record = loadRunBinding({ root: ROOT, run_id: runId, fs: mem.env });
  if (!record) throw new Error(`test setup: no minted binding for ${runId}`);
  return record.binding_ref;
}

/** Parse a run.yaml document and read one top-level scalar via the shared parser (OD-3). */
function runField(rawYaml: string, key: string): unknown {
  const doc = parseYaml(rawYaml);
  return doc && typeof doc === "object" && !Array.isArray(doc)
    ? (doc as Record<string, unknown>)[key]
    : undefined;
}

// ── In-memory fs seam (deterministic; no disk) ───────────────────────────────

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
      // record this dir and every ancestor
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
    removeTree(absPath: string): void {
      const prefix = `${absPath}${path.sep}`;
      for (const key of [...files.keys()]) if (key === absPath || key.startsWith(prefix)) files.delete(key);
      for (const key of [...dirs]) if (key === absPath || key.startsWith(prefix)) dirs.delete(key);
    },
  };
  return { files, dirs, env };
}

// ── Fixed-clock + host-stub env ───────────────────────────────────────────────

function makeEnv(
  mem: MemFs,
  opts: { now?: string; resolved?: HostKind; capabilities_ref?: string } = {}
): RunLifecycleEnv {
  const clock = opts.now ?? "2026-05-29T08:40:21Z";
  return {
    now: () => clock,
    fs: mem.env,
    withRunBindingExclusion: <T>(_root: string, _runId: string, fn: () => T): T => fn(),
    resolveHost: (requested: string) => ({
      requested,
      resolved: opts.resolved ?? ("claude" as HostKind),
      ...(opts.capabilities_ref ? { capabilities_ref: opts.capabilities_ref } : {}),
    }),
    // The .guild/ write base; closeRun reads it to locate the run dir (mirrors
    // the createRealEnv __rootHint stamp). Without it close would fall back to
    // process.cwd().
    __rootHint: ROOT,
  } as RunLifecycleEnv;
}

const ROOT = "/abs/workspace";

function baseStartOpts(over: Partial<StartRunOpts> = {}): StartRunOpts {
  return {
    command: "/guild:learn",
    arguments: { rigor: "deep", host: "auto", initiative: null },
    cwd: ROOT,
    root: ROOT,
    target_kind: "workspace",
    workspace: { is_workspace: true, root: ROOT, sub_guilds: ["plugin"] },
    project: "guild (workspace root)",
    host_requested: "auto",
    model_tier_policy: "rigor=deep profile",
    ignore_policy: "workspace .gitignore + .guild share-policy allow-list",
    scan_policy: "cheap-map",
    initiative: null,
    phase: "learn",
    run_class: "full",
    ...over,
  };
}

// ── startRun ──────────────────────────────────────────────────────────────────

describe("run-lifecycle — startRun (SC-B §1)", () => {
  it("returns a run_id and writes it to .guild/runs/current-run-id", () => {
    const mem = memFs();
    const env = makeEnv(mem);
    const initializeRunBindingExclusion = jest.fn();
    env.initializeRunBindingExclusion = initializeRunBindingExclusion;
    const lc = createRunLifecycle(env);
    const runId = lc.startRun(baseStartOpts({ initiative: "learn-knowledge-convergence" }));
    expect(typeof runId).toBe("string");
    expect(runId.length).toBeGreaterThan(0);
    const sentinel = path.join(ROOT, ".guild", "runs", "current-run-id");
    expect(mem.files.get(sentinel)).toBe(runId);
    expect(initializeRunBindingExclusion).toHaveBeenCalledWith(ROOT, runId);
  });

  it("generates run-<UTC-compact>-<slug> for an initiative-attached run", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem, { now: "2026-05-29T08:40:21Z" }));
    const runId = lc.startRun(baseStartOpts({ initiative: "learn-knowledge-convergence" }));
    expect(runId).toBe("run-20260529-084021-learn-knowledge-convergence");
  });

  it("derives a mandatory slug from a one-off brief", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({
      initiative: null,
      arguments: { brief: "Verify release candidate" },
    }));
    expect(runId).toBe("run-20260529-084021-verify-release-candidate");
  });

  it("falls back to the command slug for a one-off without a brief", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ initiative: null }));
    expect(runId).toBe("run-20260529-084021-learn");
  });

  it("adds a UUID tail only when the canonical second+slug already exists", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    expect(lc.startRun(baseStartOpts({ initiative: null }))).toBe("run-20260529-084021-learn");
    expect(lc.startRun(baseStartOpts({ initiative: null }))).toMatch(
      /^run-20260529-084021-learn-[0-9a-f]{8}-[0-9a-f-]{27}$/,
    );
  });

  it("exports one strict creation-time assertion for the canonical run-id shape", () => {
    expect(isCanonicalRunId("run-20260529-084021-learn")).toBe(true);
    expect(isCanonicalRunId("run-learn-20260529-084021")).toBe(false);
    expect(isCanonicalRunId("run-20260529-256199-learn")).toBe(false);
    expect(() => assertCanonicalRunId("run-legacy-id")).toThrow(/canonical run id/i);
  });

  it("writes run.yaml with schema_version guild.run.v1 + the caller-injected clock", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem, { now: "2026-05-29T08:40:21Z" }));
    const runId = lc.startRun(baseStartOpts({ initiative: "alpha" }));
    const yamlPath = path.join(ROOT, ".guild", "runs", runId, "run.yaml");
    const raw = mem.files.get(yamlPath);
    expect(raw).toBeDefined();
    expect(raw).toContain("schema_version: guild.run.v1");
    expect(raw).toContain("started_at: 2026-05-29T08:40:21Z");
    expect(raw).toContain("status: open");
    expect(raw).toContain("initiative_attachment: alpha");
  });

  it("captures and hash-binds the capability baseline inside the run-start transaction", () => {
    const mem = memFs();
    const env = makeEnv(mem);
    const recorded: unknown[] = [];
    env.captureCapabilityBaseline = (_root, runId) => ({
      agents: "1".repeat(64), skills: "2".repeat(64), registries: "3".repeat(64),
      bound_root: "4".repeat(64), bound_run_id: runId,
    });
    env.recordCapabilityBaselineCapture = (_root, evidence) => { recorded.push(evidence); return true; };
    const runId = createRunLifecycle(env).startRun(baseStartOpts());
    const snapshotPath = path.join(ROOT, ".guild", "runs", runId, "capability", "run-start-snapshot.json");
    const snapshot = mem.files.get(snapshotPath);
    expect(snapshot).toBeDefined();
    expect(JSON.parse(snapshot!)).toEqual(expect.objectContaining({
      schema_version: "guild.capability_run_start_snapshot.v1",
      run_id: runId,
      run_started_at: "2026-05-29T08:40:21Z",
      captured_at: "2026-05-29T08:40:21Z",
      bound_run_id: runId,
    }));
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml"))!;
    const ref = runField(raw, "capability_start_snapshot_ref") as Record<string, unknown>;
    expect(ref).toEqual({
      path: "capability/run-start-snapshot.json",
      sha256: createHash("sha256").update(snapshot!).digest("hex"),
    });
    expect(recorded).toEqual([expect.objectContaining({
      run_id: runId,
      run_started_at: "2026-05-29T08:40:21Z",
      snapshot_sha256: ref.sha256,
      start_identity_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    })]);
  });

  it("refuses to return a baseline-capturing run without its append-only producer receipt", () => {
    const mem = memFs();
    const env = makeEnv(mem);
    env.captureCapabilityBaseline = (_root, runId) => ({
      agents: "1".repeat(64), skills: "2".repeat(64), registries: "3".repeat(64),
      bound_root: "4".repeat(64), bound_run_id: runId,
    });
    expect(() => createRunLifecycle(env).startRun(baseStartOpts())).toThrow(/receipt recorder is unavailable/i);
    expect(mem.files.get(path.join(ROOT, ".guild", "runs", "current-run-id"))).toBeUndefined();
    expect([...mem.files.keys()].some((key) => key.includes("/.guild/runs/run-"))).toBe(false);
    expect([...mem.dirs].some((key) => key.includes("/.guild/runs/run-"))).toBe(false);
  });

  it("rolls back every pre-exposure run write when the producer receipt is refused", () => {
    const mem = memFs();
    const env = makeEnv(mem);
    env.captureCapabilityBaseline = (_root, runId) => ({
      agents: "1".repeat(64), skills: "2".repeat(64), registries: "3".repeat(64),
      bound_root: "4".repeat(64), bound_run_id: runId,
    });
    env.recordCapabilityBaselineCapture = () => false;
    expect(() => createRunLifecycle(env).startRun(baseStartOpts())).toThrow(/receipt capture failed/i);
    expect([...mem.files.keys()].some((key) => key.includes("/.guild/runs/run-"))).toBe(false);
    expect([...mem.dirs].some((key) => key.includes("/.guild/runs/run-"))).toBe(false);
  });

  it("retains a same-ID run when rollback no longer owns its binding", () => {
    const mem = memFs();
    const env = makeEnv(mem);
    env.captureCapabilityBaseline = (_root, runId) => ({
      agents: "1".repeat(64), skills: "2".repeat(64), registries: "3".repeat(64),
      bound_root: "4".repeat(64), bound_run_id: runId,
    });
    env.recordCapabilityBaselineCapture = (_root, evidence) => {
      const bindingPath = path.join(ROOT, ".guild", "runs", evidence.run_id, "binding.json");
      mem.files.set(bindingPath, `${JSON.stringify({
        schema_version: "guild.run_binding.v1",
        run_id: evidence.run_id,
        binding_ref: "rb-concurrent-winner",
        state: "open",
      }, null, 2)}\n`);
      return false;
    };
    expect(() => createRunLifecycle(env).startRun(baseStartOpts()))
      .toThrow(/rollback.*refused.*no longer owns/i);
    expect([...mem.files.keys()].some((key) => key.endsWith("/binding.json"))).toBe(true);
    expect([...mem.files.keys()].some((key) => key.endsWith("/run.yaml"))).toBe(true);
  });

  it("rolls back a receipt-backed run when a later start step fails", () => {
    const mem = memFs();
    const env = makeEnv(mem);
    env.captureCapabilityBaseline = (_root, runId) => ({
      agents: "1".repeat(64), skills: "2".repeat(64), registries: "3".repeat(64),
      bound_root: "4".repeat(64), bound_run_id: runId,
    });
    env.recordCapabilityBaselineCapture = () => true;
    env.emitAnalysisEvent = () => { throw new Error("planted post-receipt analysis failure"); };
    expect(() => createRunLifecycle(env).startRun(baseStartOpts())).toThrow(/post-receipt analysis failure/i);
    expect(mem.files.get(path.join(ROOT, ".guild", "runs", "current-run-id"))).toBeUndefined();
    expect([...mem.files.keys()].some((key) => key.includes("/.guild/runs/run-"))).toBe(false);
    expect([...mem.dirs].some((key) => key.includes("/.guild/runs/run-"))).toBe(false);
  });

  it("writes no run state when the configured capability baseline capture fails", () => {
    const mem = memFs();
    const env = makeEnv(mem);
    env.captureCapabilityBaseline = () => null;
    expect(() => createRunLifecycle(env).startRun(baseStartOpts())).toThrow(/baseline capture failed/i);
    expect([...mem.files.keys()].some((key) => key.includes("/.guild/runs/"))).toBe(false);
  });

  it("creates the logs/ directory at start", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts());
    expect(mem.dirs.has(path.join(ROOT, ".guild", "runs", runId, "logs"))).toBe(true);
  });

  it("records null initiative_attachment for a one-off", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ initiative: null }));
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(raw).toContain("initiative_attachment: null");
  });

  it("records an initiative analysis identity and attachment provenance additively", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({
      initiative: "alpha",
      entry_prompt_ref: "logs/payloads/entry.json",
      attachment_source: "user_selected",
      attachment_confidence: "high",
    }));
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(raw).toContain("run_scope: initiative");
    expect(raw).toContain("independent_run_group: null");
    expect(raw).toContain("entry_prompt_ref: logs/payloads/entry.json");
    expect(raw).toContain("source: user_selected");
    expect(raw).toContain("confidence: high");
  });

  it("records a discoverable independent run group without minting a fake initiative", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({
      initiative: null,
      independent_run_group: "release-verification",
      attachment_source: "independent",
    }));
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(raw).toContain("run_scope: independent");
    expect(raw).toContain("initiative_attachment: null");
    expect(raw).toContain("independent_run_group: release-verification");
    expect(mem.dirs.has(path.join(ROOT, ".guild", "initiatives"))).toBe(false);
  });

  // ── NN#5 — the load-bearing invariant ────────────────────────────────────────
  it("NN#5: startRun({initiative}) creates ZERO .guild/initiatives/<slug>/ dir", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    lc.startRun(baseStartOpts({ initiative: "foo" }));
    // No initiatives dir at any level.
    expect(mem.dirs.has(path.join(ROOT, ".guild", "initiatives"))).toBe(false);
    expect(mem.dirs.has(path.join(ROOT, ".guild", "initiatives", "active", "foo"))).toBe(false);
    expect(mem.dirs.has(path.join(ROOT, ".guild", "initiatives", "foo"))).toBe(false);
    // No file path anywhere under .guild/initiatives/.
    for (const f of mem.files.keys()) {
      expect(f).not.toContain(`${path.sep}initiatives${path.sep}`);
    }
    for (const d of mem.dirs) {
      expect(d).not.toContain(`${path.sep}initiatives`);
    }
  });

  it("writes EXACTLY run.yaml + current-run-id + binding.json + session-context.json at start", () => {
    // T3 (guild.session_context.v1): startRun additionally mints the run
    // binding (§5) and freezes the session context (§1) — both run-scoped.
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ initiative: "foo" }));
    const written = [...mem.files.keys()].sort();
    expect(written).toEqual(
      [
        path.join(ROOT, ".guild", "runs", "current-run-id"),
        path.join(ROOT, ".guild", "runs", runId, "run.yaml"),
        path.join(ROOT, ".guild", "runs", runId, "binding.json"),
        path.join(ROOT, ".guild", "runs", runId, "session-context.json"),
      ].sort()
    );
  });
});

// ── host-neutrality ─────────────────────────────────────────────────────────────

describe("run-lifecycle — host neutrality (SC-B §4)", () => {
  it("resolves a NON-claude HostKind without error and records it verbatim", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem, { resolved: "codex" as HostKind }));
    const runId = lc.startRun(baseStartOpts({ host_requested: "codex" }));
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(raw).toContain("resolved: codex");
    expect(raw).toContain("requested: codex");
    expect(raw).not.toContain("resolved: claude");
  });

  it("records a non-Claude host + capabilities_ref pointer", () => {
    const mem = memFs();
    const lc = createRunLifecycle(
      makeEnv(mem, { resolved: "pi" as HostKind, capabilities_ref: ".guild/hosts/pi/capability.json" })
    );
    const runId = lc.startRun(baseStartOpts({ host_requested: "auto" }));
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(raw).toContain("resolved: pi");
    expect(raw).toContain("capabilities_ref: .guild/hosts/pi/capability.json");
  });
});

// ── closeRun ────────────────────────────────────────────────────────────────────

describe("run-lifecycle — closeRun (SC-B §2)", () => {
  function startThenClose(
    startOver: Partial<StartRunOpts>,
    closeOpts: Omit<Parameters<ReturnType<typeof createRunLifecycle>["closeRun"]>[1], "binding_ref">,
    envOver: Parameters<typeof makeEnv>[1] = {}
  ) {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem, { now: "2026-05-29T08:40:21Z", ...envOver }));
    const runId = lc.startRun(baseStartOpts(startOver));
    // T3 F2: every close threads the run's minted nonce (fail-closed otherwise).
    lc.closeRun(runId, { ...closeOpts, binding_ref: refOf(mem, runId) });
    return { mem, runId };
  }

  it("writes provenance.json with schema_version guild.provenance.v1", () => {
    const { mem, runId } = startThenClose({ initiative: "alpha" }, { status: "closed" });
    const provPath = path.join(ROOT, ".guild", "runs", runId, "provenance.json");
    const prov = JSON.parse(mem.files.get(provPath) as string);
    expect(prov.schema_version).toBe("guild.provenance.v1");
    expect(prov.run_id).toBe(runId);
    expect(prov.status).toBe("closed");
    expect(prov.initiative).toBe("alpha");
    expect(prov.command).toBe("/guild:learn");
  });

  it("references the terminal trace event by POINTER (not an inline copy)", () => {
    const { mem, runId } = startThenClose({}, { status: "closed" });
    const prov = JSON.parse(
      mem.files.get(path.join(ROOT, ".guild", "runs", runId, "provenance.json")) as string
    );
    expect(prov.terminal_trace_event.event_name).toBe("run_closed");
    expect(prov.terminal_trace_event.log_ref).toBe(
      `.guild/runs/${runId}/logs/v1.4-events.jsonl`
    );
    expect(prov.terminal_trace_event.at).toBe("2026-05-29T08:40:21Z");
    // pointer only — no embedded event body fields beyond the reference set
    expect(prov.terminal_trace_event).not.toHaveProperty("payload");
  });

  it("uses the caller-injected close clock for closed_at", () => {
    const mem = memFs();
    let t = "2026-05-29T08:40:21Z";
    const lc = createRunLifecycle({
      now: () => t,
      fs: mem.env,
      withRunBindingExclusion: <T>(_root: string, _runId: string, fn: () => T): T => fn(),
      resolveHost: (requested) => ({ requested, resolved: "claude" as HostKind }),
      __rootHint: ROOT,
    } as RunLifecycleEnv);
    const runId = lc.startRun(baseStartOpts());
    t = "2026-05-29T09:12:04Z"; // advance the injected clock before close
    lc.closeRun(runId, { status: "closed", binding_ref: refOf(mem, runId) });
    const prov = JSON.parse(
      mem.files.get(path.join(ROOT, ".guild", "runs", runId, "provenance.json")) as string
    );
    expect(prov.started_at).toBe("2026-05-29T08:40:21Z");
    expect(prov.closed_at).toBe("2026-05-29T09:12:04Z");
  });

  it("defaults touched sub-arrays to [] and merges caller-supplied facts", () => {
    const { mem, runId } = startThenClose(
      {},
      { status: "closed", touched: { skills: ["guild:learn-map"], files: ["a.ts"] } }
    );
    const prov = JSON.parse(
      mem.files.get(path.join(ROOT, ".guild", "runs", runId, "provenance.json")) as string
    );
    expect(prov.touched.skills).toEqual(["guild:learn-map"]);
    expect(prov.touched.files).toEqual(["a.ts"]);
    expect(prov.touched.tasks).toEqual([]);
    expect(prov.touched.agents).toEqual([]);
    expect(prov.touched.decisions).toEqual([]);
  });

  it("flips run.yaml.status to the terminal status", () => {
    const { mem, runId } = startThenClose({}, { status: "failed" });
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(raw).toContain("status: failed");
    expect(raw).not.toContain("status: open");
  });

  it("does NOT write metadata.json (SC-8: dual-write removed, v2 is run.yaml + provenance.json only)", () => {
    const { mem, runId } = startThenClose(
      { initiative: "alpha" },
      {
        status: "closed",
        artifacts: { spec: ".guild/spec/x.md", plan: ".guild/plan/x.md", team: ".guild/team/x.yaml" },
      }
    );
    const metaPath = path.join(ROOT, ".guild", "runs", runId, "metadata.json");
    expect(mem.files.has(metaPath)).toBe(false);
  });

  it("retention_class is until-archive for an initiative-attached run", () => {
    const { mem, runId } = startThenClose({ initiative: "alpha" }, { status: "closed" });
    const prov = JSON.parse(
      mem.files.get(path.join(ROOT, ".guild", "runs", runId, "provenance.json")) as string
    );
    expect(prov.retention_class).toBe("until-archive");
  });

  it("retention_class is one-off-90d for an unnamed one-off", () => {
    const { mem, runId } = startThenClose({ initiative: null }, { status: "closed" });
    const prov = JSON.parse(
      mem.files.get(path.join(ROOT, ".guild", "runs", runId, "provenance.json")) as string
    );
    expect(prov.retention_class).toBe("one-off-90d");
  });

  it("benchmark_eligible is true on a normal closed full run", () => {
    const { mem, runId } = startThenClose({}, { status: "closed" });
    const prov = JSON.parse(
      mem.files.get(path.join(ROOT, ".guild", "runs", runId, "provenance.json")) as string
    );
    expect(prov.benchmark_eligible).toBe(true);
  });

  it("throws when closing an unknown run-id (no run.yaml on disk)", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    expect(() =>
      lc.closeRun("run-does-not-exist", { status: "closed", binding_ref: "rb-nonexistent" })
    ).toThrow();
  });

  // ── G5(a) — current-run-id sentinel is cleared at close ──────────────────
  // v23x-deferred-followups rf-wi-05, origin oir-wi-58: before this fix,
  // closeRun never touched the sentinel, so every guard reading it stayed
  // "armed" for a run that had already closed.
  describe("G5(a) — current-run-id sentinel cleared at close", () => {
    const sentinelPath = path.join(ROOT, ".guild", "runs", "current-run-id");

    it("clears the sentinel when it still points at the run being closed", () => {
      const mem = memFs();
      const lc = createRunLifecycle(makeEnv(mem));
      const runId = lc.startRun(baseStartOpts({ initiative: null }));
      expect(mem.files.get(sentinelPath)).toBe(runId); // sanity: sentinel armed at start
      // T3 F2: closeRun requires the run's minted binding nonce (fail-closed §5).
      lc.closeRun(runId, { status: "closed", binding_ref: refOf(mem, runId) });
      const cleared = mem.files.get(sentinelPath);
      // Every real reader (capture-telemetry.ts readCurrentRunId, run-trace.ts
      // readSentinel, ...) treats a trimmed-empty value identically to a
      // missing sentinel — this is the actual "cleared" contract.
      expect(cleared === undefined || cleared.trim() === "").toBe(true);
    });

    it("does NOT clobber a NEWER run's sentinel when closing an OLDER run out of order", () => {
      const mem = memFs();
      const lc = createRunLifecycle(makeEnv(mem));
      const olderRunId = lc.startRun(baseStartOpts({ initiative: "alpha" }));
      const newerRunId = lc.startRun(baseStartOpts({ initiative: "beta" }));
      expect(mem.files.get(sentinelPath)).toBe(newerRunId);
      // T3 F2: closeRun requires the run's minted binding nonce (fail-closed §5).
      lc.closeRun(olderRunId, { status: "closed", binding_ref: refOf(mem, olderRunId) });
      // The sentinel still names the NEWER (still-current) run — closing an
      // older run must never disarm guards for the run that is actually live.
      expect(mem.files.get(sentinelPath)).toBe(newerRunId);
    });
  });
});

// ── G5(b) — run.yaml `gates:` writer ────────────────────────────────────────
// v23x-deferred-followups rf-wi-05, origin oir-wi-58: run.yaml's `gates:`
// block was written ONCE at start (always `{}`) and nothing ever updated it,
// so hooks/lib/reanchor.ts's next-gate pointer could never advance past a
// gate that had actually passed.
describe("run-lifecycle — appendGateOutcome (G5(b))", () => {
  function startRunFor(mem: MemFs): { runId: string; env: RunLifecycleEnv } {
    const env = makeEnv(mem);
    const lc = createRunLifecycle(env);
    const runId = lc.startRun(baseStartOpts({ phase: "build" }));
    return { runId, env };
  }

  it("converts the inline `gates: {}` map into a block carrying the recorded gate", () => {
    const mem = memFs();
    const { runId, env } = startRunFor(mem);
    const rawBefore = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(rawBefore).toContain("gates: {}");

    const ok = appendGateOutcome(env.fs, ROOT, runId, "review", {
      posture: "auto",
      outcome: "pass",
      codex_review: "unknown",
    });
    expect(ok).toBe(true);

    const rawAfter = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(rawAfter).not.toContain("gates: {}");
    const doc = runField(rawAfter, "gates") as Record<string, { outcome: string }>;
    expect(doc.review.outcome).toBe("pass");
  });

  it("appends a second gate alongside an already-recorded one", () => {
    const mem = memFs();
    const { runId, env } = startRunFor(mem);
    appendGateOutcome(env.fs, ROOT, runId, "review", {
      posture: "auto",
      outcome: "pass",
      codex_review: "unknown",
    });
    appendGateOutcome(env.fs, ROOT, runId, "verify-done", {
      posture: "auto",
      outcome: "pass",
      codex_review: "unknown",
    });
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    const doc = runField(raw, "gates") as Record<string, { outcome: string }>;
    expect(doc.review.outcome).toBe("pass");
    expect(doc["verify-done"].outcome).toBe("pass");
  });

  it("re-recording the SAME gate replaces its entry instead of duplicating it", () => {
    const mem = memFs();
    const { runId, env } = startRunFor(mem);
    appendGateOutcome(env.fs, ROOT, runId, "review", {
      posture: "auto",
      outcome: "fail",
      codex_review: "unknown",
    });
    appendGateOutcome(env.fs, ROOT, runId, "review", {
      posture: "auto",
      outcome: "pass",
      codex_review: "unknown",
    });
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(raw.match(/^  review:$/m) ?? []).toHaveLength(1); // exactly one entry
    const doc = runField(raw, "gates") as Record<string, { outcome: string }>;
    expect(doc.review.outcome).toBe("pass");
  });

  it("every other run.yaml field is byte-unchanged", () => {
    const mem = memFs();
    const { runId, env } = startRunFor(mem);
    const before = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    appendGateOutcome(env.fs, ROOT, runId, "review", {
      posture: "auto",
      outcome: "pass",
      codex_review: "unknown",
    });
    const after = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    const beforeLines = new Set(before.split("\n").filter((l) => !l.startsWith("gates")));
    const afterLines = after.split("\n");
    for (const line of beforeLines) {
      if (line.trim() === "") continue;
      expect(afterLines).toContain(line);
    }
  });

  it("is a fail-open no-op when run.yaml does not exist", () => {
    const mem = memFs();
    const ok = appendGateOutcome(mem.env, ROOT, "run-does-not-exist", "review", {
      posture: "auto",
      outcome: "pass",
      codex_review: "unknown",
    });
    expect(ok).toBe(false);
  });

  it("rejects a non-token gate name and never writes it", () => {
    const mem = memFs();
    const { runId, env } = startRunFor(mem);
    const ok = appendGateOutcome(env.fs, ROOT, runId, "not a token!", {
      posture: "auto",
      outcome: "pass",
      codex_review: "unknown",
    });
    expect(ok).toBe(false);
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(raw).toContain("gates: {}");
  });
});

// ── lightweight run_class (OQ6 status variant) ──────────────────────────────────

describe("run-lifecycle — lightweight run_class (SC-B §5)", () => {
  it("records run_class lightweight in run.yaml", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ command: "/guild:status", run_class: "lightweight" }));
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(raw).toContain("run_class: lightweight");
  });

  it("lightweight start never invokes or writes the full-run capability baseline", () => {
    const mem = memFs();
    const env = makeEnv(mem);
    const capture = jest.fn((_root: string, runId: string) => ({
      agents: "1".repeat(64), skills: "2".repeat(64), registries: "3".repeat(64),
      bound_root: "4".repeat(64), bound_run_id: runId,
    }));
    const record = jest.fn(() => true);
    env.captureCapabilityBaseline = capture;
    env.recordCapabilityBaselineCapture = record;
    const runId = createRunLifecycle(env).startRun(baseStartOpts({ command: "/guild:status", run_class: "lightweight" }));
    expect(capture).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(mem.files.has(path.join(ROOT, ".guild", "runs", runId, "capability", "run-start-snapshot.json"))).toBe(false);
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml"))!;
    expect(runField(raw, "capability_start_snapshot_ref")).toBeNull();
  });

  it("closeRun short-circuits the learning checkpoint (final_learning_checkpoint === null)", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ command: "/guild:status", run_class: "lightweight" }));
    // Caller mistakenly supplies a checkpoint path — lightweight MUST null it.
    lc.closeRun(runId, {
      status: "closed",
      binding_ref: refOf(mem, runId),
      final_learning_checkpoint: ".guild/runs/x/learning/reflection-x.yaml",
    });
    const prov = JSON.parse(
      mem.files.get(path.join(ROOT, ".guild", "runs", runId, "provenance.json")) as string
    );
    expect(prov.final_learning_checkpoint).toBeNull();
    expect(prov.run_class).toBe("lightweight");
  });

  it("lightweight run writes ONLY runs/-scoped files (no wiki/indexes/reflections/initiatives)", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ command: "/guild:status", run_class: "lightweight" }));
    lc.closeRun(runId, { status: "closed", binding_ref: refOf(mem, runId) });
    const runsPrefix = path.join(ROOT, ".guild", "runs") + path.sep;
    for (const f of mem.files.keys()) {
      // sentinel is .guild/runs/current-run-id — already under runsPrefix.
      expect(f.startsWith(runsPrefix)).toBe(true);
    }
    expect(mem.dirs.has(path.join(ROOT, ".guild", "wiki"))).toBe(false);
    expect(mem.dirs.has(path.join(ROOT, ".guild", "indexes"))).toBe(false);
    expect(mem.dirs.has(path.join(ROOT, ".guild", "reflections"))).toBe(false);
    expect(mem.dirs.has(path.join(ROOT, ".guild", "initiatives"))).toBe(false);
  });

  it("full run preserves a caller-supplied final_learning_checkpoint", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ run_class: "full" }));
    lc.closeRun(runId, {
      status: "closed",
      binding_ref: refOf(mem, runId),
      final_learning_checkpoint: ".guild/runs/x/learning/reflection-x.yaml",
    });
    const prov = JSON.parse(
      mem.files.get(path.join(ROOT, ".guild", "runs", runId, "provenance.json")) as string
    );
    expect(prov.final_learning_checkpoint).toBe(".guild/runs/x/learning/reflection-x.yaml");
  });
});

// ── T0 (G-PHASE-COMPOSE) — appendPhase + canonical-phase validation ───────────

describe("run-lifecycle — appendPhase (T0 full-run phase recording)", () => {
  /** Read a fresh run.yaml string for the active run. */
  function readRunYaml(mem: MemFs, runId: string): string {
    return mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
  }

  it("CANONICAL_PHASES is exactly the six lifecycle phases", () => {
    expect([...CANONICAL_PHASES]).toEqual(["init", "ideate", "plan", "build", "qa", "ops"]);
  });

  it("isCanonicalPhase accepts the six and rejects anything else", () => {
    for (const p of CANONICAL_PHASES) expect(isCanonicalPhase(p)).toBe(true);
    expect(isCanonicalPhase("learn")).toBe(false);
    expect(isCanonicalPhase("../etc/passwd")).toBe(false);
    expect(isCanonicalPhase("")).toBe(false);
  });

  it("appends a phases_log entry + rewrites top-level phase: for a full run seeded null", () => {
    const mem = memFs();
    const env = makeEnv(mem, { now: "2026-06-07T10:00:00Z" });
    const lc = createRunLifecycle(env);
    // Full run seeded with phase null (the pre-T0 main-path shape).
    const runId = lc.startRun(baseStartOpts({ phase: null, run_class: "full" }));

    const env2 = makeEnv(mem, { now: "2026-06-07T11:00:00Z" });
    const ok = appendPhase(env2, ROOT, runId, "plan");
    expect(ok).toBe(true);

    const yaml = readRunYaml(mem, runId);
    // top-level phase: rewritten
    expect(runField(yaml, "phase")).toBe("plan");
    // phases_log carries the appended entry with the env clock
    expect(yaml).toContain("- phase: plan");
    expect(yaml).toContain("at: 2026-06-07T11:00:00Z");
  });

  it("appends a SECOND phase to an existing block (plan → build) preserving order", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem, { now: "2026-06-07T10:00:00Z" }));
    // Seed a full run that already records phase=plan in its block.
    const runId = lc.startRun(baseStartOpts({ phase: "plan", run_class: "full" }));

    const ok = appendPhase(makeEnv(mem, { now: "2026-06-07T12:00:00Z" }), ROOT, runId, "build");
    expect(ok).toBe(true);

    const yaml = readRunYaml(mem, runId);
    expect(runField(yaml, "phase")).toBe("build"); // top-level reflects the latest
    // both entries present, plan before build
    const planIdx = yaml.indexOf("- phase: plan");
    const buildIdx = yaml.indexOf("- phase: build");
    expect(planIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeGreaterThan(planIdx);
  });

  it("REJECTS a non-canonical token: returns false, writes nothing", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ phase: null, run_class: "full" }));
    const before = readRunYaml(mem, runId);

    const ok = appendPhase(makeEnv(mem), ROOT, runId, "deploy"); // not canonical
    expect(ok).toBe(false);
    expect(readRunYaml(mem, runId)).toBe(before); // byte-identical — no write
  });

  it("is a no-op (returns false) when run.yaml is absent", () => {
    const mem = memFs();
    const ok = appendPhase(makeEnv(mem), ROOT, "run-does-not-exist", "plan");
    expect(ok).toBe(false);
  });

  it("is ADDITIVE: fields read by closeRun (status/run_class) are byte-unchanged after appendPhase", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ phase: null, run_class: "full" }));
    const before = readRunYaml(mem, runId);
    const statusBefore = runField(before, "status");
    const runClassBefore = runField(before, "run_class");

    appendPhase(makeEnv(mem), ROOT, runId, "qa");

    const after = readRunYaml(mem, runId);
    expect(runField(after, "status")).toBe(statusBefore);
    expect(runField(after, "run_class")).toBe(runClassBefore);
  });
});

// ── HK-06 — provenance.json fail-CLOSED via scrubbedWriteDurable seam ──────────
//
// The injectable `scrubbedWriteDurable` seam lets tests verify the argument-identity
// invariant: when scrub returns blocked:true, provenance.json MUST NOT exist on disk.
// This asserts the ON-DISK EFFECT, not merely "a function was called."

describe("run-lifecycle — HK-06 provenance.json scrubbed-write coverage", () => {
  type ScrubResult = { written: boolean; blocked: boolean; sha256?: string };
  type ScrubSurface = "handoff" | "learnings" | "provenance" | "config" | "wiki" | "review" | "bus" | "telemetry";

  /** Build a memFs env with an optional fake scrubbedWriteDurable seam. */
  function memFsWithScrub(opts: {
    scrubResult?: ScrubResult;
    captureArgs?: { calls: Array<{ outPath: string; contents: string; surface: ScrubSurface }> };
  }): MemFs {
    const mem = memFs();
    if (opts.scrubResult !== undefined || opts.captureArgs !== undefined) {
      const captured = opts.captureArgs;
      const result = opts.scrubResult ?? { written: true, blocked: false };
      mem.env.scrubbedWriteDurable = (
        outPath: string,
        contents: string,
        surface: ScrubSurface,
        _runDir: string,
        _runId: string,
      ): ScrubResult => {
        if (captured) captured.calls.push({ outPath, contents, surface });
        if (result.written) {
          mem.files.set(outPath, contents);
          mem.dirs.add(path.dirname(outPath));
        }
        return result;
      };
    }
    return mem;
  }

  it("HK-06: provenance.json NOT created when scrubbedWriteDurable returns blocked:true (fail-CLOSED)", () => {
    const mem = memFsWithScrub({ scrubResult: { written: false, blocked: true } });
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts());
    lc.closeRun(runId, { status: "closed", binding_ref: refOf(mem, runId) });

    const provPath = path.join(ROOT, ".guild", "runs", runId, "provenance.json");
    // Fail-CLOSED invariant: the file MUST NOT exist when scrub is blocked.
    expect(mem.files.has(provPath)).toBe(false);
  });

  it("HK-06: provenance.json IS created when scrubbedWriteDurable returns written:true (happy path)", () => {
    const mem = memFsWithScrub({ scrubResult: { written: true, blocked: false } });
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts());
    lc.closeRun(runId, { status: "closed", binding_ref: refOf(mem, runId) });

    const provPath = path.join(ROOT, ".guild", "runs", runId, "provenance.json");
    expect(mem.files.has(provPath)).toBe(true);
    const prov = JSON.parse(mem.files.get(provPath) as string);
    expect(prov.schema_version).toBe("guild.provenance.v1");
  });

  it("HK-06: scrubbedWriteDurable receives surface='provenance' for provenance.json", () => {
    const captured: { calls: Array<{ outPath: string; contents: string; surface: ScrubSurface }> } =
      { calls: [] };
    const mem = memFsWithScrub({ scrubResult: { written: true, blocked: false }, captureArgs: captured });
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts());
    lc.closeRun(runId, { status: "closed", binding_ref: refOf(mem, runId) });

    // Exactly one call, surface must be "provenance".
    const provCalls = captured.calls.filter((c) => c.outPath.endsWith("provenance.json"));
    expect(provCalls.length).toBe(1);
    expect(provCalls[0].surface).toBe("provenance");
  });

  it("HK-06: existing tests still pass when scrubbedWriteDurable is absent (backward compat)", () => {
    // No scrubbedWriteDurable on the env — closeRun falls back to env.fs.writeFile.
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts());
    lc.closeRun(runId, { status: "closed", binding_ref: refOf(mem, runId) });

    const provPath = path.join(ROOT, ".guild", "runs", runId, "provenance.json");
    expect(mem.files.has(provPath)).toBe(true);
  });
});
