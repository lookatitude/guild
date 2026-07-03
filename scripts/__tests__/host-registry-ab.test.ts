/**
 * scripts/__tests__/host-registry-ab.test.ts
 *
 * P1-L7 SC-4 — the behavior-preserving A/B gate for the host-registry unification.
 *
 * `runRoutingAbMatrix()` is a single deterministic enumeration of `route()` +
 * `selectReviewer()` (+ the `detectProviders` input they consume) over a
 * representative Claude/Codex case set, each serialized via the L0 `canonicalJSON`
 * contract. The golden (fixtures/routing-ab-golden.json) was captured PRE-edit, from
 * the hand-kept `hasAdapter` literals; this test re-runs the SAME matrix POST-edit —
 * now that `hasAdapter` is sourced from the registry's `result_adapter` column — and
 * asserts EVERY case is byte-identical. Any drift in a Claude/Codex routing decision
 * fails here. That is the whole point of the gate.
 *
 * Pure + deterministic: fixed clock, injected fake `ProbeEnv` (no shell-out), no
 * filesystem read beyond the golden. Owned by tooling-engineer (L7).
 */

import * as fs from "fs";
import * as path from "path";
import {
  detectProviders,
  selectReviewer,
  type ProbeEnv,
  type ResolvedReview,
} from "../lib/provider-detect";
import {
  route,
  type RoutableHost,
  type LaneRequest,
  type AgentMode,
  type Tier,
  type WorkType,
} from "../lib/host-router";
import type { HostCapabilityManifest } from "../write-host-capability";
import {
  canonicalJSON,
  compareRoutingAb,
  deepEqualCanonical,
} from "../lib/routing-ab-contract";
import { resultAdapterForFamily } from "../lib/host-registry";

// ── Fixed clock (route freshness math) ────────────────────────────────────────
const NOW = Date.parse("2026-06-15T12:00:00Z");
const FRESH = "2026-06-15T11:59:00Z";

// ── Fake ProbeEnv builder (selectReviewer/detectProviders input) ──────────────
interface ProbeFacts {
  onPath?: Record<string, boolean>;
  versionOk?: Record<string, boolean>;
  storedCodexAuth?: boolean;
  env?: Record<string, string>;
  capabilityProviders?: string[];
  pluginAdapters?: Record<string, boolean>;
}

function fakeProbe(f: ProbeFacts): ProbeEnv {
  return {
    commandOnPath: (bin) => !!f.onPath?.[bin],
    probeVersion: (bin) => !!f.versionOk?.[bin],
    readStoredCodexAuth: () => !!f.storedCodexAuth,
    readEnv: (name) => f.env?.[name],
    readCapabilityProviders: () => f.capabilityProviders ?? [],
    readPluginAdapter: (id) => !!f.pluginAdapters?.[id],
  };
}

// Common probe scenarios (Claude/Codex centric — the SC-4 byte-identical scope).
const PROBE_SCENARIOS: Record<string, ProbeFacts> = {
  codexPluginAuthed: {
    onPath: { codex: true },
    versionOk: { codex: true },
    storedCodexAuth: true,
    pluginAdapters: { "codex-plugin": true },
  },
  codexCliOnlyAuthed: {
    onPath: { codex: true },
    versionOk: { codex: true },
    storedCodexAuth: true,
    pluginAdapters: { "codex-plugin": false },
  },
  codexCliNoAuth: {
    onPath: { codex: true },
    versionOk: { codex: true },
    storedCodexAuth: false,
    pluginAdapters: { "codex-plugin": false },
  },
  detectOnlyTrio: {
    // Antigravity's CLI is `agy` (verified on-host 2026-06-16), not `antigravity` — the
    // detector probes `agy`, so the fake PATH must expose `agy` for detection to fire.
    // (gemini was sunset 2026-06-14 — no longer a detectable provider; the scenario name
    // is retained for golden-key stability.)
    onPath: { pi: true, agy: true },
    versionOk: { pi: true, agy: true },
  },
  empty: {},
};

// ── route() host fixtures (real guild.host_capability.v1 shape) ───────────────
function claudeHost(overrides: Partial<RoutableHost> = {}): RoutableHost {
  const base: HostCapabilityManifest = {
    schema_version: "guild.host_capability.v1",
    host_id: "claude",
    host_kind: "claude",
    advertised_at: FRESH,
    source: "ab-matrix",
    tier_models: { cheap: "haiku", mid: "sonnet", powerful: "opus" },
    supported_tiers: ["cheap", "mid", "powerful"],
    models: ["haiku", "sonnet", "opus"],
    tool_support: {
      subagent: true,
      agent_team: true,
      independent_agents: true,
      tmux: true,
      mcp: true,
      pre_tool_use_ask: true,
    },
  };
  return { ...base, ...overrides } as RoutableHost;
}

function codexHost(overrides: Partial<RoutableHost> = {}): RoutableHost {
  return claudeHost({
    host_id: "codex",
    host_kind: "codex",
    tier_models: { cheap: "gpt-4o-mini", mid: "gpt-4o", powerful: "o3" },
    supported_tiers: ["cheap", "mid", "powerful"],
    models: ["gpt-4o-mini", "gpt-4o", "o3"],
    tool_support: {
      subagent: true,
      agent_team: false,
      independent_agents: false,
      tmux: false,
      mcp: true,
      pre_tool_use_ask: false,
    },
    ...overrides,
  });
}

/**
 * Run the full SC-4 A/B matrix → map of caseName → canonicalJSON(decision).
 * Deterministic; identical logic to the PRE-edit capture that produced the golden.
 */
function runRoutingAbMatrix(): Record<string, string> {
  const out: Record<string, string> = {};

  const reviews: Array<[string, ResolvedReview]> = [
    ["cross-auto", { mode: "cross", provider: "auto" }],
    ["cross-pin-codex-plugin", { mode: "cross", provider: "codex-plugin" }],
    ["cross-pin-codex-cli", { mode: "cross", provider: "codex-cli" }],
    // (cross-pin-gemini-cli removed — gemini was sunset 2026-06-14, no such provider.)
    ["local-auto", { mode: "local", provider: "auto" }],
    ["off-auto", { mode: "off", provider: "auto" }],
  ];
  const authors = ["claude", "codex"];

  for (const author of authors) {
    for (const [scenName, facts] of Object.entries(PROBE_SCENARIOS)) {
      const detection = detectProviders({
        cwd: "/ab",
        host: author,
        probe: fakeProbe(facts),
      });
      out[`detect:${author}:${scenName}`] = canonicalJSON(detection);
      for (const [revName, review] of reviews) {
        const sel = selectReviewer(detection, review);
        out[`select:${author}:${scenName}:${revName}`] = canonicalJSON(sel);
      }
    }
  }

  const tiers: Tier[] = ["cheap", "mid", "powerful"];
  const modes: AgentMode[] = ["team", "agent", "subagent", "auto"];
  const workTypes: Array<WorkType | undefined> = [
    undefined,
    "adversarial_review",
    "background_implementation",
    "interactive_lifecycle",
  ];
  const hostSets: Array<[string, RoutableHost[], boolean]> = [
    ["claude-only", [claudeHost()], false],
    ["dual-crosshost-off", [claudeHost(), codexHost()], false],
    ["dual-crosshost-on", [claudeHost(), codexHost()], true],
  ];

  for (const [setName, hosts, crossHostEnabled] of hostSets) {
    for (const tier of tiers) {
      for (const mode of modes) {
        for (const wt of workTypes) {
          const lane: LaneRequest = {
            taskId: `t-${tier}-${mode}-${wt ?? "none"}`,
            tier,
            mode,
            workType: wt,
          };
          const decision = route(lane, hosts, { now: NOW, crossHostEnabled });
          out[`route:${setName}:${tier}:${mode}:${wt ?? "none"}`] =
            canonicalJSON(decision);
        }
      }
    }
  }

  return out;
}

const GOLDEN_PATH = path.join(__dirname, "fixtures", "routing-ab-golden.json");

describe("P1-L7 host-registry A/B (SC-4 — byte-identical Claude/Codex)", () => {
  const actual = runRoutingAbMatrix();
  // Regenerate the golden after an intentional registry change (e.g. the gemini
  // sunset removed the gemini-cli provider + cross-pin case): UPDATE_GOLDEN=1.
  if (process.env.UPDATE_GOLDEN) {
    fs.writeFileSync(GOLDEN_PATH, JSON.stringify(actual, null, 2) + "\n");
  }
  const golden: Record<string, string> = JSON.parse(
    fs.readFileSync(GOLDEN_PATH, "utf8")
  );

  it("captured a non-trivial matrix (route + select + detect cases)", () => {
    const keys = Object.keys(golden);
    expect(keys.length).toBeGreaterThan(100);
    expect(keys.some((k) => k.startsWith("route:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("select:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("detect:"))).toBe(true);
  });

  it("POST-edit case set is exactly the golden case set (no added/dropped cases)", () => {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(golden).sort());
  });

  it("every case is byte-identical pre/post registry unification", () => {
    const drift: string[] = [];
    for (const [name, expected] of Object.entries(golden)) {
      const cmp = compareRoutingAb(expected, actual[name]);
      if (!cmp.equal) {
        drift.push(
          `${name}\n  expected: ${cmp.expected_canonical}\n  actual:   ${cmp.actual_canonical}`
        );
      }
    }
    expect(drift).toEqual([]);
  });

  // Guard the gate itself: prove the matrix exercises the cells the hasAdapter→
  // registry rewire actually moves through, so a vacuous (all-skipped) golden can
  // never pass silently.
  it("the matrix actually exercises the adapter-sourced selectable path", () => {
    for (const src of [golden, actual]) {
      const codexSel = JSON.parse(src["select:claude:codexPluginAuthed:cross-auto"]);
      expect(codexSel.provider).toBe("codex-plugin");
      expect(codexSel.status).toBe("selected");

      // A pin that cannot be satisfied is skipped (anti-vacuity: proves the matrix
      // exercises the skipped path). In detectOnlyTrio codex is NOT on PATH, so pinning
      // codex-cli is unsatisfiable → skipped. (Was the gemini-cli pin before the 2026-06-14
      // gemini sunset removed that provider.)
      const unsatisfiablePin = JSON.parse(
        src["select:claude:detectOnlyTrio:cross-pin-codex-cli"]
      );
      expect(unsatisfiablePin.status).toBe("skipped");
    }
    expect(
      deepEqualCanonical(
        JSON.parse(golden["select:claude:codexPluginAuthed:cross-auto"]),
        JSON.parse(actual["select:claude:codexPluginAuthed:cross-auto"])
      )
    ).toBe(true);
  });
});

describe("P1-L7 result_adapter column sourcing (the hasAdapter replacement)", () => {
  it("maps families to the registry result_adapter column, byte-aligned with the old literals", () => {
    expect(resultAdapterForFamily("claude")).toBe(false);
    expect(resultAdapterForFamily("codex")).toBe(true);
    expect(resultAdapterForFamily("gemini")).toBe(false); // the sunset gemini family (2026-06-14) has no registry row → no adapter
    expect(resultAdapterForFamily("pi")).toBe(false);
    expect(resultAdapterForFamily("antigravity")).toBe(false);
    expect(resultAdapterForFamily("unknown")).toBe(false); // safe default
  });
});
