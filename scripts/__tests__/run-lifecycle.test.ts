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
import {
  createRunLifecycle,
  type RunLifecycleEnv,
  type StartRunOpts,
} from "../lib/run-lifecycle";
import type { HostKind } from "../lib/host-types";

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
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ initiative: "learn-knowledge-convergence" }));
    expect(typeof runId).toBe("string");
    expect(runId.length).toBeGreaterThan(0);
    const sentinel = path.join(ROOT, ".guild", "runs", "current-run-id");
    expect(mem.files.get(sentinel)).toBe(runId);
  });

  it("generates run-<slug>-<UTC-compact> for an initiative-attached run", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem, { now: "2026-05-29T08:40:21Z" }));
    const runId = lc.startRun(baseStartOpts({ initiative: "learn-knowledge-convergence" }));
    expect(runId).toBe("run-learn-knowledge-convergence-20260529-084021");
  });

  it("generates run-<uuidv4> for an unnamed one-off (no initiative)", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ initiative: null }));
    expect(runId).toMatch(
      /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
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

  it("writes EXACTLY run.yaml + current-run-id (the only two files at start)", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ initiative: "foo" }));
    const written = [...mem.files.keys()].sort();
    expect(written).toEqual(
      [
        path.join(ROOT, ".guild", "runs", "current-run-id"),
        path.join(ROOT, ".guild", "runs", runId, "run.yaml"),
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

  it("records a gemini host + capabilities_ref pointer", () => {
    const mem = memFs();
    const lc = createRunLifecycle(
      makeEnv(mem, { resolved: "gemini" as HostKind, capabilities_ref: ".guild/hosts/gemini/capability.json" })
    );
    const runId = lc.startRun(baseStartOpts({ host_requested: "auto" }));
    const raw = mem.files.get(path.join(ROOT, ".guild", "runs", runId, "run.yaml")) as string;
    expect(raw).toContain("resolved: gemini");
    expect(raw).toContain("capabilities_ref: .guild/hosts/gemini/capability.json");
  });
});

// ── closeRun ────────────────────────────────────────────────────────────────────

describe("run-lifecycle — closeRun (SC-B §2)", () => {
  function startThenClose(
    startOver: Partial<StartRunOpts>,
    closeOpts: Parameters<ReturnType<typeof createRunLifecycle>["closeRun"]>[1],
    envOver: Parameters<typeof makeEnv>[1] = {}
  ) {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem, { now: "2026-05-29T08:40:21Z", ...envOver }));
    const runId = lc.startRun(baseStartOpts(startOver));
    lc.closeRun(runId, closeOpts);
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
      resolveHost: (requested) => ({ requested, resolved: "claude" as HostKind }),
      __rootHint: ROOT,
    } as RunLifecycleEnv);
    const runId = lc.startRun(baseStartOpts());
    t = "2026-05-29T09:12:04Z"; // advance the injected clock before close
    lc.closeRun(runId, { status: "closed" });
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
    expect(() => lc.closeRun("run-does-not-exist", { status: "closed" })).toThrow();
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

  it("closeRun short-circuits the learning checkpoint (final_learning_checkpoint === null)", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(baseStartOpts({ command: "/guild:status", run_class: "lightweight" }));
    // Caller mistakenly supplies a checkpoint path — lightweight MUST null it.
    lc.closeRun(runId, {
      status: "closed",
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
    lc.closeRun(runId, { status: "closed" });
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
      final_learning_checkpoint: ".guild/runs/x/learning/reflection-x.yaml",
    });
    const prov = JSON.parse(
      mem.files.get(path.join(ROOT, ".guild", "runs", runId, "provenance.json")) as string
    );
    expect(prov.final_learning_checkpoint).toBe(".guild/runs/x/learning/reflection-x.yaml");
  });
});
