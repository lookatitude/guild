/**
 * scripts/__tests__/mh-03-host-adapter-adoption.test.ts
 *
 * MH-03 attempt 2 — PRODUCTION ADOPTION of `guild.host_adapter_boundary.v1`.
 *
 * Attempt 1 delivered the boundary and proved it correct in isolation; the
 * review's single blocking finding (MH-03-R1-B01) was that no shipped caller
 * used it, so the one-snapshot-per-run and provider-membership guarantees were
 * opt-in rather than obtained by production execution.
 *
 * This suite pins the opposite: the real `guild-run` host-adapter receipt path
 * is BUILT FROM a successful binding, carries machine-readable boundary
 * evidence, and a failed / unsupported / refused binding fails closed BEFORE
 * adapter preflight, model-parameter resolution, or dispatch is reached.
 *
 * The boundary keeps taking the factory as an INJECTED provider — the boundary
 * never imports the factory, so there is no recursion and no layering
 * inversion. These tests therefore drive the same seam production drives, and
 * substitute spies only to prove what is NOT called.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  bindGuildRunHostAdapter,
  hostAdapterRefusalReceipt,
  hostAdapterRuntimeReceipt,
  parseArgs,
  type CliArgs,
} from "../guild-run";
import { createHostAdapter } from "../lib/host-adapter-factory";
import { planWrapperInvocation, type WrapperPlan, type WrapperRequest } from "../lib/guild-run-wrapper";
import { DERIVED_HOST_CAPABILITY_ROWS } from "../lib/host-registry";
import {
  HOST_ADAPTER_BOUNDARY_SCHEMA,
  HOST_ADAPTER_CONTRACT_VERSION,
  HOST_CAPABILITY_SNAPSHOT_SCHEMA,
  HOST_RUNTIME_BINDING_RESULT_SCHEMA,
  HOST_RUNTIME_BINDING_SCHEMA,
  createHostCapabilitySnapshotStore,
  type HostAdapter,
  type HostAdapterProvider,
} from "../../src/modules/host-runtime";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const LIVE_GUILD_RUN = path.join(REPO_ROOT, "scripts", "guild-run.ts");
const RESOURCE_GUILD_RUN = path.join(
  REPO_ROOT,
  "src",
  "modules",
  "host-runtime",
  "resources",
  "scripts",
  "guild-run.ts"
);

/** The hosts the shipped wrapper can actually plan an invocation for. */
const PLANNER_HOSTS = Object.keys(DERIVED_HOST_CAPABILITY_ROWS);

function args(overrides: Partial<CliArgs> & { host: string }): CliArgs {
  const parsed = parseArgs(["--host", overrides.host, "--prompt", "hi"]);
  if ("error" in parsed) throw new Error(parsed.error);
  return { ...parsed, ...overrides };
}

function requestFor(parsed: CliArgs): WrapperRequest {
  const request: WrapperRequest = {
    host: parsed.host,
    mode: parsed.mode,
    cwd: parsed.cwd,
    writableRoots: parsed.writableRoots,
  };
  if (parsed.prompt !== undefined) request.prompt = parsed.prompt;
  return request;
}

function planFor(parsed: CliArgs): WrapperPlan {
  return planWrapperInvocation(requestFor(parsed));
}

/** Operations that must never run when a binding does not succeed. */
const GUARDED_OPERATIONS = ["preflight", "resolveModelParams", "dispatch"] as const;

interface SpyAdapter {
  adapter: HostAdapter;
  calls: string[];
}

/**
 * Wrap a real adapter so every guarded operation records that it ran. The
 * wrapper delegates, so a spy adapter is still a fully working adapter — a test
 * that sees zero calls saw a real refusal, not a broken stub.
 */
function spyOn(inner: HostAdapter): SpyAdapter {
  const calls: string[] = [];
  const adapter: HostAdapter = {
    host: inner.host,
    hostId: inner.hostId,
    capabilities: () => inner.capabilities(),
    bootstrap: (request) => inner.bootstrap(request),
    preflight: (request) => {
      calls.push("preflight");
      return inner.preflight(request);
    },
    dispatch: (request) => {
      calls.push("dispatch");
      return inner.dispatch(request);
    },
    collect: (request) => inner.collect(request),
    renderCommandSurface: (request) => inner.renderCommandSurface(request),
    renderPackage: (request) => inner.renderPackage(request),
    renderPermissionDecision: (request) => inner.renderPermissionDecision(request),
    resolveModelParams: (request) => {
      calls.push("resolveModelParams");
      return inner.resolveModelParams(request);
    },
    memory: (request) => inner.memory(request),
  };
  return { adapter, calls };
}

// ---------------------------------------------------------------------------
// Acceptance 1 — the shipped caller is structurally boundary-backed
// ---------------------------------------------------------------------------

describe("acceptance 1: the shipped guild-run caller routes through the public boundary", () => {
  const source = fs.readFileSync(LIVE_GUILD_RUN, "utf8");

  test("imports bindHostRuntimeAdapter from the host-runtime PUBLIC index", () => {
    expect(source).toMatch(/bindHostRuntimeAdapter/);
    expect(source).toMatch(/from\s+"\.\.\/src\/modules\/host-runtime"/);
    // Not reached around the public index into the workflow file.
    expect(source).not.toMatch(/src\/modules\/host-runtime\/workflows\//);
  });

  test("keeps the factory as the INJECTED provider rather than the receipt's adapter source", () => {
    // The factory is still imported (it is the real provider)...
    expect(source).toMatch(/import \{ createHostAdapter \} from "\.\/lib\/host-adapter-factory"/);
    // ...but it is only ever named as a provider default, never invoked to mint
    // the adapter the receipt is built from. Attempt 1's shipped line was
    // `const adapter = createHostAdapter(parsed.host);`.
    expect(source).not.toMatch(/=\s*createHostAdapter\(/);
    expect(source).toMatch(/provider[^\n]*=\s*createHostAdapter/);
  });

  test("the boundary does not import the factory, so adoption creates no recursion", () => {
    const boundary = fs.readFileSync(
      path.join(REPO_ROOT, "src", "modules", "host-runtime", "workflows", "host-adapter-boundary.ts"),
      "utf8"
    );
    // Only the module SPECIFIERS matter — the boundary's doc comment names the
    // factory on purpose, to say which provider production injects.
    const specifiers = [...boundary.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((s) => s.includes("host-adapter-factory"))).toEqual([]);
    expect(specifiers.filter((s) => s.includes("scripts/"))).toEqual([]);
  });

  test("module resource and live projection of guild-run.ts are byte-identical", () => {
    expect(fs.readFileSync(RESOURCE_GUILD_RUN)).toEqual(fs.readFileSync(LIVE_GUILD_RUN));
  });
});

// ---------------------------------------------------------------------------
// Acceptance 2 — a valid host's receipt is built from the binding
// ---------------------------------------------------------------------------

describe("acceptance 2: a valid host/run receipt is built from the successful binding", () => {
  test("carries machine-readable boundary evidence with version and snapshot hash", () => {
    const parsed = args({ host: "claude" });
    const result = bindGuildRunHostAdapter(parsed, createHostAdapter, createHostCapabilitySnapshotStore());
    expect(result.disposition).toBe("succeeded");
    expect(result.binding).not.toBeNull();

    const receipt = hostAdapterRuntimeReceipt(parsed, requestFor(parsed), planFor(parsed), result);
    const evidence = receipt.boundary;

    expect(evidence.boundary_version).toBe(HOST_ADAPTER_BOUNDARY_SCHEMA);
    expect(evidence.adapter_contract_version).toBe(HOST_ADAPTER_CONTRACT_VERSION);
    expect(evidence.binding_schema_version).toBe(HOST_RUNTIME_BINDING_SCHEMA);
    expect(evidence.binding_result_schema_version).toBe(HOST_RUNTIME_BINDING_RESULT_SCHEMA);
    expect(evidence.capability_snapshot_schema).toBe(HOST_CAPABILITY_SNAPSHOT_SCHEMA);
    expect(evidence.disposition).toBe("succeeded");
    expect(evidence.reason_code).toBeNull();
    expect(evidence.host_id).toBe("claude-code-cli");

    // The IMMUTABLE snapshot hash, and it is the binding's own — not recomputed.
    expect(evidence.capability_snapshot_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(evidence.capability_snapshot_hash).toBe(result.binding?.snapshot.snapshot_hash);
  });

  test("the adapter results come from the BOUND adapter, not a separately minted one", () => {
    const parsed = args({ host: "claude" });
    const spy = spyOn(createHostAdapter("claude"));
    const provider: HostAdapterProvider = () => spy.adapter;

    const result = bindGuildRunHostAdapter(parsed, provider, createHostCapabilitySnapshotStore());
    expect(result.binding?.adapter).toBe(spy.adapter);

    const receipt = hostAdapterRuntimeReceipt(parsed, requestFor(parsed), planFor(parsed), result);
    // Every guarded operation ran exactly once, and it ran on the BOUND adapter.
    expect(spy.calls.sort()).toEqual([...GUARDED_OPERATIONS].sort());
    expect(receipt.preflight).not.toBeNull();
    expect(receipt.model_params).not.toBeNull();
    expect(receipt.dispatch).not.toBeNull();
  });

  test("an alias and its canonical id bind to one host identity and one snapshot", () => {
    const canonical = bindGuildRunHostAdapter(
      args({ host: "claude-code-cli" }),
      createHostAdapter,
      createHostCapabilitySnapshotStore()
    );
    const alias = bindGuildRunHostAdapter(
      args({ host: "claude" }),
      createHostAdapter,
      createHostCapabilitySnapshotStore()
    );

    expect(alias.disposition).toBe("succeeded");
    expect(alias.binding?.host_id).toBe("claude-code-cli");
    expect(alias.binding?.host_id).toBe(canonical.binding?.host_id);
    expect(alias.binding?.snapshot.snapshot_hash).toBe(canonical.binding?.snapshot.snapshot_hash);
  });

  test("one run gets exactly one snapshot object across repeated binds", () => {
    const store = createHostCapabilitySnapshotStore();
    const parsed = args({ host: "claude" });
    const first = bindGuildRunHostAdapter(parsed, createHostAdapter, store);
    const second = bindGuildRunHostAdapter(parsed, createHostAdapter, store);
    // The SAME frozen object, not merely an equal one.
    expect(second.binding?.snapshot).toBe(first.binding?.snapshot);
    expect(Object.isFrozen(first.binding?.snapshot)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Acceptance 3 — fail closed before preflight / model params / dispatch
// ---------------------------------------------------------------------------

describe("acceptance 3: a failed, unsupported or refused binding never reaches an adapter operation", () => {
  test("an unsupported host is refused with no adapter operation in the receipt", () => {
    const parsed = args({ host: "definitely-not-a-host" });
    const result = bindGuildRunHostAdapter(parsed, createHostAdapter, createHostCapabilitySnapshotStore());

    expect(result.disposition).toBe("unsupported");
    expect(result.reason_code).toBe("capability_absent");
    expect(result.binding).toBeNull();

    const receipt = hostAdapterRefusalReceipt(parsed, result);
    expect(receipt.boundary.disposition).toBe("unsupported");
    expect(receipt.boundary.reason_code).toBe("capability_absent");
    expect(receipt.boundary.capability_snapshot_hash).toBeNull();
    expect(receipt.preflight).toBeNull();
    expect(receipt.model_params).toBeNull();
    expect(receipt.dispatch).toBeNull();
  });

  test("an IMPOSTOR provider is refused and its adapter is never operated", () => {
    const parsed = args({ host: "claude" });
    const impostor = spyOn(createHostAdapter("codex")); // a real adapter — for the WRONG host
    const result = bindGuildRunHostAdapter(parsed, () => impostor.adapter, createHostCapabilitySnapshotStore());

    expect(result.disposition).toBe("refused");
    expect(result.reason_code).toBe("boundary_membership_mismatch");
    expect(result.binding).toBeNull();
    expect(impostor.calls).toEqual([]);

    // Even handed to the full receipt builder, no guarded operation runs.
    const receipt = hostAdapterRuntimeReceipt(parsed, requestFor(parsed), planFor(parsed), result);
    expect(impostor.calls).toEqual([]);
    expect(receipt.preflight).toBeNull();
    expect(receipt.model_params).toBeNull();
    expect(receipt.dispatch).toBeNull();
    expect(receipt.boundary.reason_code).toBe("boundary_membership_mismatch");
  });

  test("a THROWING provider fails closed as failed, never as a working binding", () => {
    const parsed = args({ host: "claude" });
    const result = bindGuildRunHostAdapter(
      parsed,
      () => {
        throw new Error("provider exploded");
      },
      createHostCapabilitySnapshotStore()
    );

    expect(result.disposition).toBe("failed");
    expect(result.reason_code).toBe("execution_failed");
    expect(result.binding).toBeNull();

    const receipt = hostAdapterRuntimeReceipt(parsed, requestFor(parsed), planFor(parsed), result);
    expect(receipt.boundary.disposition).toBe("failed");
    expect(receipt.preflight).toBeNull();
    expect(receipt.dispatch).toBeNull();
  });

  test("no silent fallback: a refused binding never yields a direct-factory adapter", () => {
    const parsed = args({ host: "claude" });
    const result = bindGuildRunHostAdapter(parsed, () => createHostAdapter("codex"), createHostCapabilitySnapshotStore());
    const receipt = hostAdapterRuntimeReceipt(parsed, requestFor(parsed), planFor(parsed), result);
    // The receipt must not quietly describe a working claude adapter.
    expect(receipt.host).toBeNull();
    expect(receipt.provenance).toBeNull();
    expect(receipt.boundary.disposition).not.toBe("succeeded");
  });
});

// ---------------------------------------------------------------------------
// Acceptance 4 — adoption does not shrink the shipped host set or change results
// ---------------------------------------------------------------------------

describe("acceptance 4: every host the wrapper can plan still binds and behaves identically", () => {
  test("all planner-known hosts bind successfully through the boundary", () => {
    const failures = PLANNER_HOSTS.filter(
      (host) =>
        bindGuildRunHostAdapter(args({ host }), createHostAdapter, createHostCapabilitySnapshotStore())
          .disposition !== "succeeded"
    );
    expect(failures).toEqual([]);
    expect(PLANNER_HOSTS.length).toBeGreaterThan(0);
  });

  test("the boundary-backed receipt preserves every pre-adoption field value", () => {
    for (const host of PLANNER_HOSTS) {
      const parsed = args({ host });
      const request = requestFor(parsed);
      const plan = planFor(parsed);
      const result = bindGuildRunHostAdapter(parsed, createHostAdapter, createHostCapabilitySnapshotStore());
      const receipt = hostAdapterRuntimeReceipt(parsed, request, plan, result);

      // The pre-adoption path built these directly off createHostAdapter(host).
      const direct = createHostAdapter(host);
      expect(receipt.schema_version).toBe("guild.run_host_adapter_receipt.v1");
      expect(receipt.requested_host).toBe(host);
      expect(receipt.host).toBe(direct.host);
      expect(receipt.host_id).toBe(direct.hostId);
      expect(receipt.provenance).toBe(direct.capabilities().provenance);
      expect(receipt.preflight?.status).toBe(direct.preflight({ cwd: parsed.cwd, runId: "x" }).status);
      expect(receipt.dispatch?.status).toBe(
        direct.dispatch({ taskRun: { runId: "x", prompt: "", host, cwd: parsed.cwd } }).status
      );
      expect(receipt.boundary.disposition).toBe("succeeded");
      expect(receipt.boundary.capability_snapshot_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Acceptance 5 (MH-03-R2-B02) — receipt evidence is AUTHORED by the binding.
//
// Round 2 passed a `run-a` binding to `hostAdapterRuntimeReceipt()` for `run-b`
// and got a successful receipt stamped `boundary.run_id = "run-b"` carrying
// `run-a`'s snapshot hash. Evidence assembled from two different runs is worse
// than no evidence: it reads as proof while describing a run that never
// happened.
//
// The fix is that decision-bearing identity comes from the BINDING, and the
// caller's requested identity is cross-checked against it BEFORE any adapter
// operation runs. Legitimate alias/canonical pairs still agree, because they
// resolve to one canonical identity — which is exactly the line between an alias
// and a forgery.
// ---------------------------------------------------------------------------

describe("acceptance 5: boundary evidence is binding-authored and cannot be mixed", () => {
  /** `guildRunId()` derives the run id from `--record`; this names a run. */
  function runArgs(host: string, runId: string): CliArgs {
    return args({ host, record: `/tmp/${runId}.json` });
  }

  test("evidence for a legitimate receipt is stamped from the binding, not the CLI args", () => {
    const parsed = runArgs("claude", "run-authored");
    const result = bindGuildRunHostAdapter(parsed, createHostAdapter, createHostCapabilitySnapshotStore());
    const receipt = hostAdapterRuntimeReceipt(parsed, requestFor(parsed), planFor(parsed), result);

    expect(receipt.boundary.disposition).toBe("succeeded");
    expect(receipt.boundary.run_id).toBe(result.binding?.run_id);
    expect(receipt.boundary.run_id).toBe("run-authored");
    expect(receipt.boundary.host_id).toBe(result.binding?.host_id);
    expect(receipt.boundary.capability_snapshot_hash).toBe(result.binding?.snapshot.snapshot_hash);
  });

  test("a binding created for run-a cannot mint a successful receipt for run-b", () => {
    const store = createHostCapabilitySnapshotStore();
    const runA = runArgs("claude", "run-a");
    const runB = runArgs("claude", "run-b");

    const spy = spyOn(createHostAdapter("claude"));
    const bindingA = bindGuildRunHostAdapter(runA, () => spy.adapter, store);
    expect(bindingA.disposition).toBe("succeeded");
    const runAHash = bindingA.binding?.snapshot.snapshot_hash;
    expect(runAHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    spy.calls.length = 0;

    const receipt = hostAdapterRuntimeReceipt(runB, requestFor(runB), planFor(runB), bindingA);

    // No success, and — the precise round-2 forgery — no run-a evidence under
    // a run-b heading.
    expect(receipt.boundary.disposition).not.toBe("succeeded");
    expect(receipt.boundary.capability_snapshot_hash).toBeNull();
    expect(receipt.boundary.capability_snapshot_hash).not.toBe(runAHash);
    expect(receipt.boundary.host_id).toBeNull();
    expect(receipt.boundary.entry_point_kind).toBeNull();
    expect(receipt.boundary.event_source).toBeNull();
    expect(receipt.boundary.reason_code).not.toBeNull();

    // Fail-closed: nothing was reported, and no guarded operation ran.
    expect(receipt.host).toBeNull();
    expect(receipt.host_id).toBeNull();
    expect(receipt.provenance).toBeNull();
    expect(receipt.preflight).toBeNull();
    expect(receipt.model_params).toBeNull();
    expect(receipt.dispatch).toBeNull();
    expect(spy.calls).toEqual([]);
  });

  test("a binding for one host cannot be mixed into another requested host's receipt", () => {
    const store = createHostCapabilitySnapshotStore();
    const codexArgs = runArgs("codex-cli", "run-mixed");
    const claudeArgs = runArgs("claude-code-cli", "run-mixed");

    const spy = spyOn(createHostAdapter("codex-cli"));
    const codexBinding = bindGuildRunHostAdapter(codexArgs, () => spy.adapter, store);
    expect(codexBinding.disposition).toBe("succeeded");
    const codexHash = codexBinding.binding?.snapshot.snapshot_hash;
    spy.calls.length = 0;

    const receipt = hostAdapterRuntimeReceipt(claudeArgs, requestFor(claudeArgs), planFor(claudeArgs), codexBinding);

    expect(receipt.boundary.disposition).not.toBe("succeeded");
    expect(receipt.boundary.host_id).toBeNull();
    expect(receipt.boundary.capability_snapshot_hash).toBeNull();
    expect(receipt.boundary.capability_snapshot_hash).not.toBe(codexHash);
    expect(receipt.preflight).toBeNull();
    expect(receipt.model_params).toBeNull();
    expect(receipt.dispatch).toBeNull();
    expect(spy.calls).toEqual([]);
  });

  test("an alias INSIDE the binding's declared identity is still legitimate", () => {
    // `claude` and `claude-code-cli` are one canonical host. A binding made under
    // either name authors a receipt requested under the other — for the SAME run.
    const store = createHostCapabilitySnapshotStore();
    const aliasArgs = runArgs("claude", "run-alias");
    const canonicalArgs = runArgs("claude-code-cli", "run-alias");

    const aliasBinding = bindGuildRunHostAdapter(aliasArgs, createHostAdapter, store);
    expect(aliasBinding.disposition).toBe("succeeded");

    const receipt = hostAdapterRuntimeReceipt(
      canonicalArgs,
      requestFor(canonicalArgs),
      planFor(canonicalArgs),
      aliasBinding
    );

    expect(receipt.boundary.disposition).toBe("succeeded");
    expect(receipt.boundary.host_id).toBe("claude-code-cli");
    expect(receipt.boundary.run_id).toBe("run-alias");
    expect(receipt.boundary.capability_snapshot_hash).toBe(aliasBinding.binding?.snapshot.snapshot_hash);
    expect(receipt.preflight).not.toBeNull();
    expect(receipt.dispatch).not.toBeNull();
  });

  test("every planner host rejects a receipt requested for a different run", () => {
    for (const host of PLANNER_HOSTS) {
      const store = createHostCapabilitySnapshotStore();
      const own = runArgs(host, "run-own");
      const other = runArgs(host, "run-other");
      const binding = bindGuildRunHostAdapter(own, createHostAdapter, store);
      expect(binding.disposition).toBe("succeeded");

      const mixed = hostAdapterRuntimeReceipt(other, requestFor(other), planFor(other), binding);
      expect(mixed.boundary.disposition).not.toBe("succeeded");
      expect(mixed.boundary.capability_snapshot_hash).toBeNull();
      expect(mixed.dispatch).toBeNull();

      // …while the same binding still authors its OWN run's receipt.
      const authored = hostAdapterRuntimeReceipt(own, requestFor(own), planFor(own), binding);
      expect(authored.boundary.disposition).toBe("succeeded");
      expect(authored.boundary.capability_snapshot_hash).toBe(binding.binding?.snapshot.snapshot_hash);
    }
  });

  test("the refusal receipt for a genuinely unbound host carries no binding evidence", () => {
    const parsed = runArgs("definitely-not-a-host", "run-unsupported");
    const result = bindGuildRunHostAdapter(parsed, createHostAdapter, createHostCapabilitySnapshotStore());
    expect(result.disposition).toBe("unsupported");

    const receipt = hostAdapterRefusalReceipt(parsed, result);
    expect(receipt.boundary.host_id).toBeNull();
    expect(receipt.boundary.capability_snapshot_hash).toBeNull();
    expect(receipt.boundary.run_id).toBe("run-unsupported");
  });

  test("guild-run refuses to print a plan whose receipt is not binding-authored", () => {
    // The production caller binds and mints from ONE `parsed`, so it cannot
    // currently mix. This pins the property structurally rather than by luck:
    // the dry-run stdout is gated on the receipt's own boundary disposition.
    const source = fs.readFileSync(LIVE_GUILD_RUN, "utf8");
    const dryRunGate = source.indexOf("parsed.dryRun");
    const authorshipGate = source.indexOf("hostAdapter.boundary.disposition");
    expect(authorshipGate).toBeGreaterThan(-1);
    expect(authorshipGate).toBeLessThan(dryRunGate);
  });
});
