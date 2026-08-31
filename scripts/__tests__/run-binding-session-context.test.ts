/**
 * scripts/__tests__/run-binding-session-context.test.ts
 *
 * T3-session-identity-binding (run-20260730-131020-dynamic-host-model-routing):
 * unit coverage for the guild.session_context.v1 core — run-binding
 * mint/verify/fail-closed (§5), identity precedence + unknown-safety (§3/§4),
 * write-once persistence + verbatim resume restore, fingerprints (§6), and the
 * startRun/closeRun lifecycle wiring. The cross-cutting contract rail lives in
 * tests/contracts/ (c1/c2); this suite pins the module behaviors the rail does
 * not reach.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  BindingRejectedError,
  assertWritableBinding,
  closeRunBinding,
  completePendingSubstantiveOperation,
  loadRunBinding,
  locateCandidateRunId,
  mintRunBinding,
  pendingSubstantiveOperationPath,
  readHookBindingEnvelope,
  readPendingSubstantiveOperation,
  readRunBindingRecord,
  runBindingPath,
  stagePendingSubstantiveOperation,
  verifyRunBinding,
  withRunBindingExclusion,
} from "../lib/run-binding";
import {
  buildSessionContext,
  loadSessionContext,
  makeFingerprint,
  restoreSessionContext,
  sessionContextPath,
  writeSessionContext,
  type GuildSessionContextV1,
} from "../lib/session-context";
import {
  createRunLifecycle,
  type RunLifecycleEnv,
  type StartRunOpts,
} from "../lib/run-lifecycle";

function tmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t3-"));
  fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
  return root;
}

const BINDING = { binding_ref: "rb-test", state: "open" as const };

// ── run-binding: mint / verify / close ───────────────────────────────────────

describe("run-binding — mint/verify/fail-closed (§5)", () => {
  it("refuses a pending-operation marker through a symlinked capability directory", () => {
    const root = tmpRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t3-outside-"));
    const runId = "run-symlink-marker";
    mintRunBinding({ root, run_id: runId });
    const runDir = path.join(root, ".guild", "runs", runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.symlinkSync(outside, path.join(runDir, "capability"));

    expect(() => stagePendingSubstantiveOperation({ root, run_id: runId, task_id: "lt-escape" }))
      .toThrow(/write refused|symlink|contain/i);
    expect(fs.existsSync(path.join(outside, "pending-substantive-operation.json"))).toBe(false);
  });

  it("publishes a complete pending-operation marker as valid atomic replacement bytes", () => {
    const root = tmpRoot();
    const runId = "run-atomic-marker";
    mintRunBinding({ root, run_id: runId });
    stagePendingSubstantiveOperation({ root, run_id: runId, task_id: "lt-atomic" });
    completePendingSubstantiveOperation({ root, run_id: runId, task_id: "lt-atomic" });
    const pending = readPendingSubstantiveOperation(root, runId);
    expect(pending).toMatchObject({ state: "complete", task_id: "lt-atomic" });
    expect(() => JSON.parse(fs.readFileSync(pendingSubstantiveOperationPath(root, runId), "utf8"))).not.toThrow();
  });

  it("mint → verify round-trips ok; the record persists on disk", () => {
    const root = tmpRoot();
    const b = mintRunBinding({ root, run_id: "run-x" });
    expect(b.state).toBe("open");
    expect(b.binding_ref).toMatch(/^rb-[0-9a-f]{32}$/);
    const v = verifyRunBinding({ root, run_id: "run-x", binding_ref: b.binding_ref });
    expect(v.ok).toBe(true);
    expect(loadRunBinding({ root, run_id: "run-x" })?.binding_ref).toBe(b.binding_ref);
  });

  it("re-minting an existing binding throws (no mid-run nonce rotation, no re-authorization)", () => {
    const root = tmpRoot();
    mintRunBinding({ root, run_id: "run-x" });
    expect(() => mintRunBinding({ root, run_id: "run-x" })).toThrow(/already minted/);
    closeRunBinding({ root, run_id: "run-x" });
    expect(() => mintRunBinding({ root, run_id: "run-x" })).toThrow(/already minted/);
  });

  it("loses an atomic same-ID mint race without replacing the winner", () => {
    const root = tmpRoot();
    const winner = mintRunBinding({ root, run_id: "run-x" });
    const writes: string[] = [];
    expect(() => mintRunBinding({
      root,
      run_id: "run-x",
      fs: {
        mkdirp: () => undefined,
        writeFile: (_p, contents) => { writes.push(contents); },
        writeFileExclusive: () => false,
        readFile: () => null,
        exists: () => false,
      },
    })).toThrow(/already minted/);
    expect(writes).toEqual([]);
    expect(loadRunBinding({ root, run_id: "run-x" })).toEqual(winner);
  });

  it("verify rejects each §5 failure class with diagnostic binding_rejected", () => {
    const root = tmpRoot();
    const b = mintRunBinding({ root, run_id: "run-x" });
    expect(verifyRunBinding({ run_id: "run-x", binding_ref: undefined, root })).toMatchObject({
      ok: false, diagnostic: "binding_rejected", reason: "binding_absent",
    });
    expect(verifyRunBinding({ run_id: "run-x", binding_ref: b.binding_ref })).toMatchObject({
      ok: false, reason: "binding_unverifiable",
    });
    expect(verifyRunBinding({ root, run_id: "run-never", binding_ref: b.binding_ref })).toMatchObject({
      ok: false, reason: "binding_not_minted",
    });
    const other = mintRunBinding({ root, run_id: "run-y" });
    expect(verifyRunBinding({ root, run_id: "run-x", binding_ref: other.binding_ref })).toMatchObject({
      ok: false, reason: "binding_mismatch",
    });
    closeRunBinding({ root, run_id: "run-x" });
    expect(verifyRunBinding({ root, run_id: "run-x", binding_ref: b.binding_ref })).toMatchObject({
      ok: false, reason: "binding_closed",
    });
  });

  it("assertWritableBinding throws the structured BindingRejectedError", () => {
    const root = tmpRoot();
    try {
      assertWritableBinding({ root, run_id: "run-x", binding_ref: "rb-forged" });
      throw new Error("unreachable — assert must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BindingRejectedError);
      expect((e as BindingRejectedError).diagnostic).toBe("binding_rejected");
      expect((e as BindingRejectedError).reason).toBe("binding_not_minted");
    }
  });

  it("refuses missing run exclusion without creating a phantom run tree", () => {
    const root = tmpRoot();
    const missingRun = "run-missing";
    expect(() => withRunBindingExclusion(root, missingRun, () => undefined))
      .toThrow(BindingRejectedError);
    expect(fs.existsSync(path.join(root, ".guild", "runs", missingRun))).toBe(false);
  });

  it("F2: there is NO migration posture — an absent binding_ref is refused even for a minted OPEN run", () => {
    const root = tmpRoot();
    const b = mintRunBinding({ root, run_id: "run-x" });
    // The round-1 "open-unreferenced" and "legacy" fail-open postures are gone:
    expect(() => assertWritableBinding({ root, run_id: "run-x", binding_ref: undefined }))
      .toThrow(BindingRejectedError);
    expect(() => assertWritableBinding({ root, run_id: "run-legacy", binding_ref: undefined }))
      .toThrow(BindingRejectedError);
    // The explicit nonce still verifies.
    expect(assertWritableBinding({ root, run_id: "run-x", binding_ref: b.binding_ref }).state).toBe("open");
  });

  it("F1: a malformed persisted record is REJECTED at read/use time (schema-validated on load)", () => {
    const root = tmpRoot();
    const b = mintRunBinding({ root, run_id: "run-x" });
    // The reviewer's exact probe: a state value outside the closed enum.
    fs.writeFileSync(
      runBindingPath(root, "run-x"),
      JSON.stringify({
        schema_version: "guild.run_binding.v1",
        run_id: "run-x",
        binding_ref: b.binding_ref,
        state: "corrupt-openish",
      }, null, 2) + "\n"
    );
    expect(readRunBindingRecord({ root, run_id: "run-x" })).toEqual({ status: "malformed" });
    expect(loadRunBinding({ root, run_id: "run-x" })).toBeNull();
    expect(verifyRunBinding({ root, run_id: "run-x", binding_ref: b.binding_ref })).toMatchObject({
      ok: false, diagnostic: "binding_rejected", reason: "binding_malformed",
    });
    expect(() => assertWritableBinding({ root, run_id: "run-x", binding_ref: b.binding_ref }))
      .toThrow(BindingRejectedError);
  });

  it("F1: every malformed-record class rejects — wrong run_id, non-nonce ref, bad schema, garbage JSON", () => {
    const root = tmpRoot();
    const b = mintRunBinding({ root, run_id: "run-x" });
    const cases: string[] = [
      JSON.stringify({ schema_version: "guild.run_binding.v1", run_id: "run-other", binding_ref: b.binding_ref, state: "open" }),
      JSON.stringify({ schema_version: "guild.run_binding.v1", run_id: "run-x", binding_ref: 12345, state: "open" }),
      JSON.stringify({ schema_version: "guild.run_binding.v1", run_id: "run-x", binding_ref: "forged nonce!", state: "open" }),
      JSON.stringify({ schema_version: "guild.run_binding.v2", run_id: "run-x", binding_ref: b.binding_ref, state: "open" }),
      "{ not json",
    ];
    for (const raw of cases) {
      fs.writeFileSync(runBindingPath(root, "run-x"), raw);
      expect(readRunBindingRecord({ root, run_id: "run-x" }).status).toBe("malformed");
      expect(verifyRunBinding({ root, run_id: "run-x", binding_ref: b.binding_ref })).toMatchObject({
        ok: false, reason: "binding_malformed",
      });
    }
  });
});

// ── sentinel demotion + hook envelope ────────────────────────────────────────

describe("run-binding — sentinel intake-only + hook envelope contract", () => {
  it("locateCandidateRunId reads both sentinel locations, marked intake_only", () => {
    const root = tmpRoot();
    expect(locateCandidateRunId(root)).toBeNull();
    fs.writeFileSync(path.join(root, ".guild", "current-run-id"), "run-b2\n");
    expect(locateCandidateRunId(root)).toEqual({
      run_id: "run-b2", source: "sentinel-b2", intake_only: true,
    });
    fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), "run-legacy\n");
    expect(locateCandidateRunId(root)).toEqual({
      run_id: "run-legacy", source: "sentinel-legacy", intake_only: true,
    });
  });

  it("a sentinel value can NEVER pass write verification by itself (no fallback binding)", () => {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), "run-sent\n");
    const candidate = locateCandidateRunId(root)!;
    // The intake candidate carries no nonce — any verification attempt with it fails closed.
    expect(verifyRunBinding({ root, run_id: candidate.run_id, binding_ref: undefined })).toMatchObject({
      ok: false, diagnostic: "binding_rejected",
    });
  });

  it("readHookBindingEnvelope requires BOTH env keys (fail closed otherwise)", () => {
    expect(readHookBindingEnvelope({})).toBeNull();
    expect(readHookBindingEnvelope({ GUILD_RUN_ID: "run-x" })).toBeNull();
    expect(readHookBindingEnvelope({ GUILD_RUN_BINDING_REF: "rb-1" })).toBeNull();
    expect(readHookBindingEnvelope({ GUILD_RUN_ID: "run-x", GUILD_RUN_BINDING_REF: "rb-1" }))
      .toEqual({ run_id: "run-x", binding_ref: "rb-1" });
  });
});

// ── session-context: §3/§4 identity resolution ───────────────────────────────

describe("session-context — identity precedence and unknown-safety (§3/§4)", () => {
  const base = { run_id: "run-x", started_at: "2026-07-30T12:00:00Z", run_binding: BINDING };

  it("no identity source → terminal unknown / asserted / low / source none", () => {
    const ctx = buildSessionContext({ ...base });
    expect(ctx.host).toMatchObject({ family: "unknown", surface: "unknown" });
    expect(ctx.identity).toMatchObject({ source: "none", trust: "asserted", confidence: "low" });
    expect(ctx.active_model).toBeNull();
  });

  it("a malformed asserted host stays unknown — never repaired to a family", () => {
    const ctx = buildSessionContext({ ...base, envelope_host: "weird-future-host" });
    expect(ctx.host.family).toBe("unknown");
    expect(ctx.identity).toMatchObject({ source: "invocation_envelope", trust: "asserted", confidence: "low" });
  });

  it("GUILD_HOST_ID env is an ASSERTION (step 1b) — wins resolution, never gains trust", () => {
    const ctx = buildSessionContext({ ...base, env: { GUILD_HOST_ID: "codex" } });
    expect(ctx.host.family).toBe("codex");
    expect(ctx.identity).toMatchObject({ source: "env_guild_host_id", trust: "asserted", confidence: "medium" });
  });

  it("native adapter identity alone is verified/high (step 2)", () => {
    const ctx = buildSessionContext({
      ...base,
      native_adapter: {
        family: "claude", surface: "cli", adapter_id: "claude-code-native",
        adapter_version: "2.1.220", evidence: "host-set env marker",
      },
    });
    expect(ctx.host).toMatchObject({ family: "claude", surface: "cli", adapter_id: "claude-code-native" });
    expect(ctx.identity).toMatchObject({ source: "native_adapter", trust: "verified", confidence: "high" });
  });

  it("verification CONTRADICTING the assertion keeps the verified value and records the rejection", () => {
    const ctx = buildSessionContext({
      ...base,
      envelope_host: "pi",
      native_adapter: {
        family: "claude", surface: "cli", adapter_id: "claude-code-native",
        adapter_version: "2.1.220", evidence: "host-set env marker",
      },
    });
    expect(ctx.host.family).toBe("claude");
    expect(ctx.identity.trust).toBe("verified");
    expect(ctx.identity.evidence).toMatch(/asserted host "pi".*REJECTED/);
  });

  it("verification CONFIRMING the assertion upgrades trust and records both", () => {
    const ctx = buildSessionContext({
      ...base,
      envelope_host: "claude-code-desktop",
      native_adapter: {
        family: "claude", surface: "app", adapter_id: "claude-code-desktop",
        adapter_version: "1.0", evidence: "desktop adapter injection",
      },
    });
    expect(ctx.identity.trust).toBe("verified");
    expect(ctx.identity.evidence).toMatch(/confirms asserted host/);
  });

  it("handshake identity is verified (step 3) and surfaces default honestly", () => {
    const ctx = buildSessionContext({
      ...base,
      handshake: { family: "codex", evidence: "app-server model/list handshake" },
    });
    expect(ctx.host).toMatchObject({ family: "codex", surface: "unknown", adapter_id: "unknown" });
    expect(ctx.identity).toMatchObject({ source: "host_handshake", trust: "verified" });
  });

  it("omitted execution-target facts record the literal 'unknown' — never a guess", () => {
    const ctx = buildSessionContext({ ...base });
    expect(ctx.execution_target).toEqual({
      target_id: "unknown", provider_kind: "unknown", auth_mode: "unknown",
      account_fingerprint: "unknown", endpoint_fingerprint: "unknown",
      org_fingerprint: "unknown", tool_version: "unknown",
    });
  });
});

// ── session-context: persistence + resume restore ────────────────────────────

describe("session-context — write-once + verbatim resume restore (§1/§5)", () => {
  const ctxFor = (runId: string): GuildSessionContextV1 =>
    buildSessionContext({
      run_id: runId, started_at: "2026-07-30T12:00:00Z",
      envelope_host: "codex", run_binding: BINDING,
    });

  it("writes once; identical re-write is a no-op; differing content throws", () => {
    const root = tmpRoot();
    const ctx = ctxFor("run-x");
    writeSessionContext(root, ctx);
    expect(() => writeSessionContext(root, ctx)).not.toThrow();
    const mutated = { ...ctx, active_model: "claude-fable-5" };
    expect(() => writeSessionContext(root, mutated)).toThrow(/refusing to overwrite/);
  });

  it("restore returns the frozen record verbatim; missing record throws (never re-detects)", () => {
    const root = tmpRoot();
    const ctx = ctxFor("run-x");
    writeSessionContext(root, ctx);
    expect(restoreSessionContext(root, "run-x")).toEqual(ctx);
    expect(() => restoreSessionContext(root, "run-gone")).toThrow(/never re-detects/);
  });

  it("a record whose run_id mismatches its path is rejected on load (no cross-run substitution)", () => {
    const root = tmpRoot();
    const ctx = ctxFor("run-a");
    fs.mkdirSync(path.dirname(sessionContextPath(root, "run-b")), { recursive: true });
    fs.writeFileSync(sessionContextPath(root, "run-b"), JSON.stringify(ctx, null, 2) + "\n");
    expect(loadSessionContext(root, "run-b")).toBeNull();
  });
});

// ── fingerprints (§6) ────────────────────────────────────────────────────────

describe("session-context — fingerprints are salted, deterministic, non-raw (§6)", () => {
  it("same raw + same salt is stable; different salt or raw diverges; raw never appears", () => {
    const fp = makeFingerprint("acct-12345@example.com", "salt-a");
    expect(makeFingerprint("acct-12345@example.com", "salt-a")).toBe(fp);
    expect(makeFingerprint("acct-12345@example.com", "salt-b")).not.toBe(fp);
    expect(makeFingerprint("acct-99999@example.com", "salt-a")).not.toBe(fp);
    expect(fp).toMatch(/^fp-[0-9a-f]{64}$/);
    expect(fp).not.toContain("example.com");
  });
});

// ── lifecycle wiring: startRun mints + freezes; closeRun revokes ─────────────

interface MemFs {
  files: Map<string, string>;
  env: RunLifecycleEnv["fs"];
}

function memFs(): MemFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const env: RunLifecycleEnv["fs"] = {
    mkdirp: (p) => { dirs.add(p); },
    writeFile: (p, c) => { files.set(p, c); },
    readFile: (p) => (files.has(p) ? (files.get(p) as string) : null),
    exists: (p) => files.has(p) || dirs.has(p),
    removeTree: (p) => {
      const prefix = `${p}${path.sep}`;
      for (const key of [...files.keys()]) if (key === p || key.startsWith(prefix)) files.delete(key);
      for (const key of [...dirs]) if (key === p || key.startsWith(prefix)) dirs.delete(key);
    },
  };
  return { files, env };
}

const ROOT = "/abs/ws";

function makeEnv(mem: MemFs): RunLifecycleEnv {
  const env: RunLifecycleEnv = {
    now: () => "2026-07-30T12:00:00Z",
    fs: mem.env,
    withRunBindingExclusion: <T>(_root: string, _runId: string, fn: () => T): T => fn(),
    resolveHost: (requested) => ({ requested, resolved: "claude" }),
  };
  (env as RunLifecycleEnv & { __rootHint?: string }).__rootHint = ROOT;
  return env;
}

function startOpts(over: Partial<StartRunOpts> = {}): StartRunOpts {
  return {
    command: "/guild:plan",
    arguments: {},
    cwd: ROOT,
    root: ROOT,
    target_kind: "regular_project",
    workspace: { is_workspace: false, root: ROOT },
    project: "t3",
    host_requested: "auto",
    model_tier_policy: "default",
    ignore_policy: "default",
    scan_policy: "default",
    initiative: null,
    ...over,
  };
}

describe("run-lifecycle wiring — binding + session context across start/close/resume", () => {
  it("startRun mints an open binding and freezes a session context bound to it", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(startOpts());
    const binding = loadRunBinding({ root: ROOT, run_id: runId, fs: mem.env });
    expect(binding?.state).toBe("open");
    const ctx = loadSessionContext(ROOT, runId, mem.env);
    expect(ctx?.run_binding.binding_ref).toBe(binding?.binding_ref);
    // No identity inputs → the honest unknown, never a claude default (§3).
    expect(ctx?.host.family).toBe("unknown");
    expect(ctx?.identity).toMatchObject({ source: "none", trust: "asserted" });
  });

  it("startRun records adapter-injected identity when provided (session_identity)", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(
      startOpts({
        session_identity: {
          native_adapter: {
            family: "claude", surface: "cli", adapter_id: "claude-code-native",
            adapter_version: "2.1.220", evidence: "host-set env marker",
          },
        },
      })
    );
    const ctx = loadSessionContext(ROOT, runId, mem.env);
    expect(ctx?.host.family).toBe("claude");
    expect(ctx?.identity.trust).toBe("verified");
  });

  it("F2 (reviewer probe): closeRun with NO binding_ref is refused even for a newly minted OPEN run", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(startOpts());
    // Round-1 live probe: closeRun(runId, {status:"closed"}) with no binding_ref
    // succeeded and wrote the terminal records. It now fails closed:
    try {
      lc.closeRun(runId, { status: "closed" } as unknown as Parameters<typeof lc.closeRun>[1]);
      throw new Error("unreachable — closeRun must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BindingRejectedError);
      expect((e as BindingRejectedError).reason).toBe("binding_absent");
    }
    // No terminal records were written; the binding is still open.
    expect(mem.files.has(path.join(ROOT, ".guild", "runs", runId, "provenance.json"))).toBe(false);
    expect(loadRunBinding({ root: ROOT, run_id: runId, fs: mem.env })?.state).toBe("open");
  });

  it("closeRun with the minted nonce revokes the binding; a second closeRun fails closed", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(startOpts());
    const b = loadRunBinding({ root: ROOT, run_id: runId, fs: mem.env })!;
    lc.closeRun(runId, { status: "closed", binding_ref: b.binding_ref });
    expect(loadRunBinding({ root: ROOT, run_id: runId, fs: mem.env })?.state).toBe("closed");
    expect(() => lc.closeRun(runId, { status: "closed", binding_ref: b.binding_ref }))
      .toThrow(BindingRejectedError);
  });

  it("F1 (writer path): a malformed persisted binding blocks closeRun (malformed = closed, not writable)", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(startOpts());
    const b = loadRunBinding({ root: ROOT, run_id: runId, fs: mem.env })!;
    mem.env.writeFile(
      runBindingPath(ROOT, runId),
      JSON.stringify({
        schema_version: "guild.run_binding.v1",
        run_id: runId,
        binding_ref: b.binding_ref,
        state: "corrupt-openish",
      }, null, 2) + "\n"
    );
    try {
      lc.closeRun(runId, { status: "closed", binding_ref: b.binding_ref });
      throw new Error("unreachable — closeRun must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BindingRejectedError);
      expect((e as BindingRejectedError).reason).toBe("binding_malformed");
    }
    expect(mem.files.has(path.join(ROOT, ".guild", "runs", runId, "provenance.json"))).toBe(false);
  });

  it("closeRun verifies an explicit binding_ref and rejects a forged one", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(startOpts());
    expect(() => lc.closeRun(runId, { status: "closed", binding_ref: "rb-forged" }))
      .toThrow(BindingRejectedError);
    const good = loadRunBinding({ root: ROOT, run_id: runId, fs: mem.env })!;
    lc.closeRun(runId, { status: "closed", binding_ref: good.binding_ref });
    expect(loadRunBinding({ root: ROOT, run_id: runId, fs: mem.env })?.state).toBe("closed");
  });

  it("moving the sentinel does not touch a run's frozen context or binding (SC-1 core leg)", () => {
    const mem = memFs();
    const lc = createRunLifecycle(makeEnv(mem));
    const runId = lc.startRun(startOpts());
    const before = loadSessionContext(ROOT, runId, mem.env);
    // Another actor repoints the workspace sentinel at a different run.
    mem.env.writeFile(path.join(ROOT, ".guild", "runs", "current-run-id"), "run-other");
    expect(loadSessionContext(ROOT, runId, mem.env)).toEqual(before);
    const v = verifyRunBinding({
      root: ROOT, run_id: runId, fs: mem.env,
      binding_ref: before!.run_binding.binding_ref,
    });
    expect(v.ok).toBe(true);
  });
});
