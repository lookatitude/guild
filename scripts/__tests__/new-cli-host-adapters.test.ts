/**
 * scripts/__tests__/new-cli-host-adapters.test.ts
 *
 * verified-multi-host-support L7 (wave-2 adapter-test slice) — the PERMANENT jest suite
 * for the four new-CLI host adapters (cursor / github-copilot / opencode / rovo-dev) that
 * L2 built on the shared wrapped-CLI base. It promotes L2's throwaway real-factory harness
 * (11 concerns × 4 hosts + IDE deref + unknown-id control) into a durable regression suite.
 *
 * Discipline (the recurring "injected-seam masks real-path miss" defect):
 *   - EVERY primary assertion runs through the REAL routed factory `createHostAdapter`
 *     (scripts/lib/host-adapter-factory) over the REAL `HOST_REGISTRY_ROWS` — the shipped
 *     path a host actually resolves through, NOT a hand-authored fixture or injected seam.
 *   - Row-grounding is proven against the real registry rows (dispatch.command ===
 *     detection.bin, subcommand at args[0], invoke = "gh copilot" / "acli rovodev").
 *   - A dedicated "anti-vacuity" block proves each grounded assertion is DISCRIMINATING:
 *     with a mutated registry row the adapter's output tracks the mutation, so a green
 *     suite cannot be false-clean. (The injection block builds a sibling adapter from a
 *     mutated `entry` ONLY to prove non-vacuity; it never replaces the real-factory path.)
 *
 * Covers: AC-ADP-1 (concrete adapter + IDE dereference, anti-vacuous), AC-ADP-3 (success +
 * failure/unsupported + permission-denial per new-CLI host), AC-BOOT-1 (guild-run wiring
 * discoverable through the adapter surface, distinct from concern-10 bootstrap).
 */
import { createHostAdapter } from "../lib/host-adapter-factory";
import { HOST_REGISTRY_ROWS, type HostId } from "../lib/host-registry-schema";
import {
  createWrappedCliAdapter,
  guildRunWiring,
} from "../lib/host-adapters/wrapped-cli-base";
import type { HostAdapterOperation } from "../lib/host-adapter-contract";

/** The four new-CLI hosts under test, with their row-grounded facts (ADR §2.3). */
const NEW_CLI_HOSTS = [
  { id: "cursor" as HostId, label: "Cursor", bin: "cursor-agent", subcommand: null, invoke: "cursor-agent" },
  { id: "github-copilot" as HostId, label: "GitHub Copilot", bin: "gh", subcommand: "copilot", invoke: "gh copilot" },
  { id: "opencode" as HostId, label: "opencode", bin: "opencode", subcommand: null, invoke: "opencode" },
  { id: "rovo-dev" as HostId, label: "Rovo Dev", bin: "acli", subcommand: "rovodev", invoke: "acli rovodev" },
] as const;

/** The 10 adapter operations and the HEALTHY status each returns for these degrade-and-record
 * CLI hosts. NONE is ever "unavailable" — that is what `unavailable_operations: []` promises. */
const HEALTHY_OP_STATUS: Record<Exclude<HostAdapterOperation, "capabilities">, "ok" | "degraded"> = {
  bootstrap: "ok", // instruction_file bootstrap (concern 10)
  preflight: "degraded", // no native hooks — guild-run/instruction-file fallback
  dispatch: "ok",
  collect: "ok",
  renderCommandSurface: "degraded", // no native slash surface
  renderPackage: "degraded", // installability: target
  renderPermissionDecision: "degraded", // no per-tool permission hook
  resolveModelParams: "degraded", // inferred row: no model configured
  memory: "degraded", // filesystem/bm25 fallback
};

/** Invoke every op with a minimal healthy request; used to prove no op returns "unavailable". */
function runOp(adapter: ReturnType<typeof createHostAdapter>, op: HostAdapterOperation) {
  switch (op) {
    case "bootstrap": return adapter.bootstrap();
    case "preflight": return adapter.preflight();
    case "dispatch": return adapter.dispatch({ taskRun: { prompt: "do X" } });
    case "collect": return adapter.collect();
    case "renderCommandSurface": return adapter.renderCommandSurface();
    case "renderPackage": return adapter.renderPackage();
    case "renderPermissionDecision": return adapter.renderPermissionDecision({ decision: "deny" });
    case "resolveModelParams": return adapter.resolveModelParams({ tier: "cheap" });
    case "memory": return adapter.memory({ mode: "status" });
    default: throw new Error(`capabilities has no HostAdapterResult status: ${op}`);
  }
}

describe("L7 new-CLI adapters — AC-ADP-1/AC-ADP-3 concrete adapter (real factory path)", () => {
  for (const host of NEW_CLI_HOSTS) {
    describe(host.id, () => {
      const adapter = createHostAdapter(host.id);

      it("resolves a CONCRETE own adapter (known, id echoes, no agents-file deref, no default fail-closed)", () => {
        // AC-ADP-1: adapter_binding:"self" ⇒ the id resolves to ITS OWN adapter, never the
        // agents-file dereference and never the fail-closed default (which would echo `null`).
        expect(adapter.hostId).toBe(host.id);
        expect(adapter.hostId).not.toBe("agents-file");
        expect(adapter.hostId).not.toBeNull();

        const profile = adapter.capabilities();
        expect(profile.schema_version).toBe("guild.host_adapter_capabilities.v1");
        expect(profile.known).toBe(true);
        expect(profile.host_id).toBe(host.id);
        // AC-ADP-3: a concrete adapter advertises NO unavailable operations.
        expect(profile.unavailable_operations).toEqual([]);
      });

      it("SUCCESS path — every one of the 10 ops resolves to its healthy status; NONE is unavailable", () => {
        for (const [op, expectedStatus] of Object.entries(HEALTHY_OP_STATUS) as [HostAdapterOperation, "ok" | "degraded"][]) {
          const result = runOp(adapter, op);
          expect(result.status).not.toBe("unavailable"); // honours unavailable_operations: []
          expect(result.status).toBe(expectedStatus);
          expect(result.receipt.schema_version).toBe("guild.host_adapter_receipt.v1");
          expect(result.schema_version).toBe("guild.host_adapter_result.v1");
        }
      });

      it("SUCCESS path — dispatch is row-grounded: command === detection.bin, subcommand at args[0]", () => {
        const row = HOST_REGISTRY_ROWS[host.id];
        const dispatch = adapter.dispatch({ taskRun: { prompt: "run the lane" } });
        expect(dispatch.status).toBe("ok");
        expect(dispatch.value).toMatchObject({ dispatch_kind: "plain_process" });
        const value = dispatch.value as { command: string; args: string[] };
        // Row-grounding: the command is the row's detection.bin (not a re-declared literal).
        expect(value.command).toBe(row.detection.bin);
        expect(value.command).toBe(host.bin);
        if (host.subcommand) {
          // subcommand hosts (gh copilot / acli rovodev) put the subcommand at args[0].
          expect(value.args[0]).toBe(host.subcommand);
          expect(value.args[0]).toBe(row.detection.subcommand);
          expect(value.args[1]).toBe("run the lane");
        } else {
          expect(value.args[0]).toBe("run the lane");
        }
      });

      it("SUCCESS path — dispatch honours the guild-run wrapper launch plan when a command is supplied", () => {
        const dispatch = adapter.dispatch({
          taskRun: { command: "guild-run", args: ["--host", host.id], env: { GUILD: "1" } },
        });
        expect(dispatch.status).toBe("ok");
        expect(dispatch.value).toMatchObject({
          dispatch_kind: "wrapper_launch",
          command: "guild-run",
          args: ["--host", host.id],
          env: { GUILD: "1" },
        });
      });

      it("SUCCESS path — renderCommandSurface exposes the row-grounded invoke string", () => {
        const surface = adapter.renderCommandSurface();
        expect(surface.status).toBe("degraded");
        expect(surface.value).toMatchObject({ invoke: host.invoke, native_slash_commands: false });
      });

      it("FAILURE/unsupported path — resolveModelParams degrades (no model in the inferred row)", () => {
        // The inferred rows carry models: {cheap/mid/powerful: {model: null}} ⇒ degrade, not enforce.
        for (const tier of ["cheap", "mid", "powerful"] as const) {
          const result = adapter.resolveModelParams({ tier });
          expect(result.status).toBe("degraded");
          expect(result.value).toEqual({ modelParams: null, unsupported_model_params: [] });
          expect(result.receipt.degradation_receipt).toBeDefined();
        }
      });

      it("FAILURE/unsupported path — resolveModelParams records unsupported keys, enforces --model", () => {
        // A supplied model maps to --model; an unenforceable key (effort) is recorded, not silently dropped.
        const degraded = adapter.resolveModelParams({ tier: "powerful", params: { model: "frontier", effort: "low" } });
        expect(degraded.status).toBe("degraded");
        expect(degraded.value).toMatchObject({
          modelParams: { model: "frontier", effort: "low" },
          argv: ["--model", "frontier"],
          unsupported_model_params: ["effort"],
        });

        // With only a supported key, the op is fully OK (not a forced degrade).
        const ok = adapter.resolveModelParams({ tier: "powerful", params: { model: "frontier" } });
        expect(ok.status).toBe("ok");
        expect(ok.value).toMatchObject({ argv: ["--model", "frontier"], unsupported_model_params: [] });
      });

      it("PERMISSION-denial path (concern 6) — deny maps to a degraded, row-grounded policy receipt", () => {
        const row = HOST_REGISTRY_ROWS[host.id];
        const decision = adapter.renderPermissionDecision({ decision: "deny" });
        expect(decision.status).toBe("degraded"); // no per-tool permission hook
        expect(decision.value).toMatchObject({
          decision: "deny",
          native_deny: row.capabilities.permissions.deny,
          native_ask: row.capabilities.permissions.ask,
          native_prompt_layer: false,
        });
        expect(decision.receipt.reason).toMatch(/no per-tool Guild permission hook|coarse launch flags/);
      });
    });
  }
});

describe("L7 AC-BOOT-1 — guild-run wiring discoverable via the adapter surface (distinct from bootstrap)", () => {
  for (const host of NEW_CLI_HOSTS) {
    it(`${host.id}: guildRunWiring returns the launcher + guild-run --host + wrapper_injection, row-grounded`, () => {
      const row = HOST_REGISTRY_ROWS[host.id];
      const wiring = guildRunWiring(row);
      expect(wiring).toMatchObject({
        concern: "guild-run-wrapper",
        launcher: "bin/guild-run",
        invocation: `guild-run --host ${host.id}`,
        bin: row.detection.bin,
        subcommand: row.detection.subcommand ?? null,
        wrapper_injection: row.capabilities.bootstrap.wrapper_injection,
      });
      expect(wiring.wrapper_injection).toBe(true); // inferredCaps default for these CLI rows
    });

    it(`${host.id}: the SAME wiring is echoed through bootstrap / preflight / renderPackage (discoverable)`, () => {
      const adapter = createHostAdapter(host.id);
      const expected = guildRunWiring(HOST_REGISTRY_ROWS[host.id]);
      const bootstrap = adapter.bootstrap();
      const preflight = adapter.preflight();
      const renderPackage = adapter.renderPackage();
      expect((bootstrap.value as { guild_run: unknown }).guild_run).toEqual(expected);
      expect((preflight.value as { guild_run: unknown }).guild_run).toEqual(expected);
      expect((renderPackage.value as { guild_run: unknown }).guild_run).toEqual(expected);
    });

    it(`${host.id}: concern-11 (guild-run) is DISTINCT from concern-10 (bootstrap primitive)`, () => {
      const adapter = createHostAdapter(host.id);
      const bootstrap = adapter.bootstrap();
      const value = bootstrap.value as { guild_run: { concern: string; launcher: string }; instruction_file: string; skill_root: string };
      // Bootstrap renders the primitive descriptor (instruction file + skill root)…
      expect(value.instruction_file).toBe("AGENTS.md");
      expect(value.skill_root).toBe(".agents/skills/guild");
      // …and ALSO carries the distinct concern-11 wiring as a nested object (not the same thing).
      expect(value.guild_run.concern).toBe("guild-run-wrapper");
      expect(value.guild_run.launcher).toBe("bin/guild-run");
    });
  }
});

describe("L7 AC-ADP-1 — IDE dereference on the REAL factory (kiro/qoder/trae → agents-file)", () => {
  const agentsFileId = createHostAdapter("agents-file").hostId;

  for (const ide of ["kiro", "qoder", "trae"] as const) {
    it(`createHostAdapter("${ide}").hostId === "agents-file" (deref on the factory, not the row — C-B2)`, () => {
      const adapter = createHostAdapter(ide);
      // Real factory output, NOT the registry row: the adapter IDENTITY is agents-file,
      // proving the factory branched on adapter_binding rather than falling through to a
      // default adapter that would stamp the IDE's own id.
      expect(adapter.hostId).toBe("agents-file");
      expect(adapter.hostId).toBe(agentsFileId);
      expect(adapter.hostId).not.toBe(ide);
      // Sanity: the registry row's id is still the IDE's own id (deref is a factory concern).
      expect(HOST_REGISTRY_ROWS[ide].host_id).toBe(ide);
      expect(HOST_REGISTRY_ROWS[ide].adapter_binding).toBe("agents-file");
    });
  }

  it("anti-vacuity control — an unknown id does NOT become agents-file (deref is registry-keyed)", () => {
    // If the deref were a blanket catch-all, this would wrongly resolve to agents-file.
    expect(createHostAdapter("totally-unknown-host").hostId).not.toBe("agents-file");
  });

  it("anti-vacuity control — a self-bound new-CLI id returns its OWN adapter, not agents-file", () => {
    for (const host of NEW_CLI_HOSTS) {
      expect(HOST_REGISTRY_ROWS[host.id].adapter_binding).toBe("self");
      expect(createHostAdapter(host.id).hostId).toBe(host.id);
      expect(createHostAdapter(host.id).hostId).not.toBe("agents-file");
    }
  });
});

// Anti-vacuity — prove the grounded assertions above are DISCRIMINATING, not false-clean.
// Each block builds a sibling adapter from a MUTATED registry-row clone (via the base's
// `entry` override) and shows the adapter's output tracks the mutation. If the adapter
// ignored the row (hard-coded facts), these would fail — so a green primary suite is
// genuinely load-bearing. (This block deliberately uses an injected `entry`; the primary
// suite above never does — it always runs the real factory.)
describe("L7 anti-vacuity — a broken row breaks the assertion (injected control)", () => {
  function mutatedRow(id: HostId, patch: (row: any) => void) {
    const clone = JSON.parse(JSON.stringify(HOST_REGISTRY_ROWS[id]));
    patch(clone);
    return clone;
  }

  it("dispatch.command tracks detection.bin (flip the bin → command flips)", () => {
    const realBin = HOST_REGISTRY_ROWS["cursor"].detection.bin;
    const broken = createWrappedCliAdapter({
      hostId: "cursor",
      label: "Cursor",
      entry: mutatedRow("cursor", (r) => (r.detection.bin = "WRONG-BIN")),
    });
    const value = broken.dispatch({ taskRun: { prompt: "x" } }).value as { command: string };
    expect(value.command).toBe("WRONG-BIN");
    expect(value.command).not.toBe(realBin); // the real assertion would have FAILED on this adapter
  });

  it("subcommand at args[0] tracks detection.subcommand (drop it → args[0] becomes the prompt)", () => {
    const broken = createWrappedCliAdapter({
      hostId: "github-copilot",
      label: "GitHub Copilot",
      entry: mutatedRow("github-copilot", (r) => (r.detection.subcommand = null)),
    });
    const value = broken.dispatch({ taskRun: { prompt: "PROMPT" } }).value as { args: string[] };
    // With the subcommand removed, the prompt is now at args[0] — so the real "args[0] === 'copilot'"
    // assertion is discriminating (it would fail here), not vacuously true.
    expect(value.args[0]).toBe("PROMPT");
    expect(value.args[0]).not.toBe("copilot");
  });

  it("guildRunWiring.invocation tracks host_id (mutate id → invocation changes)", () => {
    const wiring = guildRunWiring(mutatedRow("opencode", (r) => (r.host_id = "mutant-id")));
    expect(wiring.invocation).toBe("guild-run --host mutant-id");
    expect(wiring.invocation).not.toBe("guild-run --host opencode");
  });

  it("permission receipt native_ask tracks the row (flip caps.permissions.ask → native_ask flips)", () => {
    const broken = createWrappedCliAdapter({
      hostId: "rovo-dev",
      label: "Rovo Dev",
      entry: mutatedRow("rovo-dev", (r) => (r.capabilities.permissions.ask = false)),
    });
    const value = broken.renderPermissionDecision({ decision: "deny" }).value as { native_ask: boolean };
    expect(value.native_ask).toBe(false);
    expect(HOST_REGISTRY_ROWS["rovo-dev"].capabilities.permissions.ask).toBe(true); // real row differs
  });

  it("resolveModelParams enforces a configured model (present model → --model argv, not degraded-null)", () => {
    // Proves the FAILURE-path assertion (no-model ⇒ null) is discriminating: supply a model
    // and the SAME op flips to ok/--model, so the null-degrade check is not vacuously always-true.
    const enforced = createHostAdapter("opencode").resolveModelParams({ tier: "mid", params: { model: "m" } });
    expect(enforced.status).toBe("ok");
    expect((enforced.value as { modelParams: { model: string } }).modelParams.model).toBe("m");
  });
});
