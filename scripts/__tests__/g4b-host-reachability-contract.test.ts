/**
 * scripts/__tests__/g4b-host-reachability-contract.test.ts
 *
 * G4b — HOST REACHABILITY CONTRACT (the gate for this lane).
 *
 * The audit finding this closes: 7 registry hosts (cursor, github-copilot, opencode,
 * rovo-dev, kiro, qoder, trae) declared `dispatch_selectable:true` but were
 * unreachable through EVERY dispatch surface — no HostKind member, no PaneAdapter, no
 * capability-row entry (the legacy hand-authored `HOST_CAPABILITY_ROWS` map in
 * host-capabilities-schema.ts has since been retired; guild-run-wrapper.ts now
 * consumes the registry-derived `DERIVED_HOST_CAPABILITY_ROWS` asserted below).
 *
 * This file asserts, over the REAL SHIPPED registry (not a synthetic fixture):
 *   (1) every `dispatch_selectable:true` row resolves, via the SAME registry-bridge
 *       primitives `parseHostKind`/`paneHostKindForStartingHost` now delegate to
 *       (`normalizeHostId` + `registryIdToCanonicalHostKind`), to a real `HostKind`;
 *   (2) that HostKind has a PaneAdapter in `buildAdapters()` (bespoke or the generic
 *       `WrappedCliPaneAdapter`);
 *   (3) that adapter's `hostKind` matches, and it produces a non-throwing preflight +
 *       a command containing the registry's own `detection.bin`;
 *   (4) the registry host_id has a `DERIVED_HOST_CAPABILITY_ROWS` entry (the
 *       guild-run-wrapper.ts consumer);
 *   (5) every `dispatch_selectable:false` row is EITHER an app/connector surface
 *       (`surface_kind:"app"`) OR an agents-file dereference (`adapter_binding:
 *       "agents-file"`) — never a mystery "false" with no explanation.
 *
 * (6) is a REAL end-to-end proof (no seam): a real team.yaml with a per-specialist
 *     `host: cursor` is fed through the REAL agent-team-launcher.ts CLI in --dry-run
 *     mode, and the printed tmux pane command + session manifest are asserted to
 *     carry the generic adapter's `cursor-agent -p` invocation and `host_kind:
 *     "cursor"` — proving the full chain (team.yaml -> parseHostKind -> buildAdapters
 *     -> WrappedCliPaneAdapter) wired end-to-end, not just its pieces in isolation.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  HOST_IDS,
  HOST_REGISTRY_ROWS,
  type HostId,
} from "../lib/host-registry-schema";
import { normalizeHostId, registryIdToCanonicalHostKind } from "../lib/host-id-namespace";
import { buildAdapters } from "../lib/pane-adapter";
import { DERIVED_HOST_CAPABILITY_ROWS } from "../lib/host-registry";
import type { HostKind } from "../lib/host-types";

// "agents-file" itself is dispatch_selectable:true but surface_kind:"file" — it is
// the ABSTRACT universal package target ("a host consuming AGENTS.md can run a
// lane" — its own registry comment), not a concrete pane-dispatchable host. It
// matches neither the wrapped-CLI PaneAdapter loop (surface_kind must be "cli") nor
// the kiro/qoder/trae agents-file-DEREFERENCE pattern (those dereference THIS row;
// this row has adapter_binding:"self", it IS the target). No real host ever routes
// to "agents-file" as a host_kind — a concrete AGENTS.md-consuming host would carry
// its OWN row. This is a pre-existing, documented exception (unrelated to the 7
// hosts this lane fixes), excluded from the per-row PaneAdapter/DERIVED_HOST_CAPABILITY_ROWS
// assertions below on that basis — asserted explicitly, not silently skipped.
const PANE_DISPATCHABLE_IDS = HOST_IDS.filter(
  (id) => HOST_REGISTRY_ROWS[id].dispatch_selectable && HOST_REGISTRY_ROWS[id].surface_kind === "cli"
);
const NON_DISPATCH_SELECTABLE_IDS = HOST_IDS.filter((id) => !HOST_REGISTRY_ROWS[id].dispatch_selectable);

describe("G4b contract — the one documented dispatch_selectable exception (agents-file)", () => {
  it('"agents-file" is dispatch_selectable:true but surface_kind:"file", not "cli" — never pane-dispatched directly', () => {
    const row = HOST_REGISTRY_ROWS["agents-file"];
    expect(row.dispatch_selectable).toBe(true);
    expect(row.surface_kind).toBe("file");
    expect(row.adapter_binding).toBe("self");
    // Confirms it is excluded from PANE_DISPATCHABLE_IDS by the surface_kind filter.
    expect(PANE_DISPATCHABLE_IDS).not.toContain("agents-file");
  });
});

describe("G4b contract — every pane-dispatchable (dispatch_selectable + surface_kind:cli) registry row is reachable", () => {
  it("non-vacuity: both partitions are non-empty (else the two describes below prove nothing)", () => {
    expect(PANE_DISPATCHABLE_IDS.length).toBeGreaterThan(0);
    expect(NON_DISPATCH_SELECTABLE_IDS.length).toBeGreaterThan(0);
    // The 7 hosts the audit found unreachable must all be selectable-and-covered
    // (cursor/github-copilot/opencode/rovo-dev) now, and kiro/qoder/trae must have
    // flipped to the honest false (asserted in the second describe below).
    for (const id of ["cursor", "github-copilot", "opencode", "rovo-dev"] as HostId[]) {
      expect(PANE_DISPATCHABLE_IDS).toContain(id);
    }
    for (const id of ["kiro", "qoder", "trae"] as HostId[]) {
      expect(NON_DISPATCH_SELECTABLE_IDS).toContain(id);
    }
  });

  const adapters = buildAdapters();

  for (const id of PANE_DISPATCHABLE_IDS) {
    describe(`registry row "${id}" (dispatch_selectable:true)`, () => {
      const row = HOST_REGISTRY_ROWS[id];
      let hostKind: HostKind | null;

      it("resolves to a real HostKind via the registry bridge (normalizeHostId + registryIdToCanonicalHostKind)", () => {
        const normalized = normalizeHostId(id);
        expect(normalized).not.toBeNull();
        hostKind = normalized ? registryIdToCanonicalHostKind(normalized) : null;
        expect(hostKind).not.toBeNull();
      });

      it("has a PaneAdapter in buildAdapters() (bespoke or generic) whose hostKind matches", () => {
        const normalized = normalizeHostId(id)!;
        const resolvedKind = registryIdToCanonicalHostKind(normalized)!;
        const adapter = adapters[resolvedKind];
        expect(adapter).toBeDefined();
        expect(adapter!.hostKind).toBe(resolvedKind);
      });

      it("the adapter's command() references the registry row's own detection.bin (not a guess)", () => {
        const normalized = normalizeHostId(id)!;
        const resolvedKind = registryIdToCanonicalHostKind(normalized)!;
        const adapter = adapters[resolvedKind]!;
        if (row.detection.bin) {
          const cmd = adapter.command({
            name: "x", scope: "s", runId: "r1", slug: "demo", prompt: "hello",
            hostKind: resolvedKind,
          });
          expect(cmd).toContain(row.detection.bin);
        }
      });

      it("preflight() never throws (fails closed with ok:false when the binary is absent, never crashes)", () => {
        const normalized = normalizeHostId(id)!;
        const resolvedKind = registryIdToCanonicalHostKind(normalized)!;
        const adapter = adapters[resolvedKind]!;
        expect(() => adapter.preflight()).not.toThrow();
      });

      it("has a DERIVED_HOST_CAPABILITY_ROWS entry keyed by its registry host_id (the guild-run-wrapper.ts consumer)", () => {
        expect(DERIVED_HOST_CAPABILITY_ROWS[id]).toBeDefined();
        expect(DERIVED_HOST_CAPABILITY_ROWS[id]).toBe(row.capabilities);
      });
    });
  }
});

describe("G4b contract — every dispatch_selectable:false row is an honest app/connector or agents-file surface", () => {
  for (const id of NON_DISPATCH_SELECTABLE_IDS) {
    it(`registry row "${id}" (dispatch_selectable:false) is app/connector OR agents-file — never unexplained`, () => {
      const row = HOST_REGISTRY_ROWS[id];
      const isAppConnector = row.surface_kind === "app";
      const isAgentsFile = row.adapter_binding === "agents-file";
      expect(isAppConnector || isAgentsFile).toBe(true);
    });
  }
});

// ── Real end-to-end proof: team.yaml `host: cursor` -> the REAL CLI -> a real
// generic-adapter pane command (no seam, no reimplementation) ─────────────────

describe("G4b contract — real end-to-end: team.yaml host:cursor dispatches through the REAL launcher CLI", () => {
  const SCRIPT = path.resolve(__dirname, "../agent-team-launcher.ts");
  const FIXTURE = path.resolve(__dirname, "../fixtures/team-wrapped-cli-host.yaml");

  it("dry-run prints a cursor-agent pane command and records host_kind:\"cursor\" in the session manifest", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "g4b-e2e-"));
    try {
      const teamDir = path.join(tmpDir, ".guild", "team");
      fs.mkdirSync(teamDir, { recursive: true });
      const teamPath = path.join(teamDir, "test-slug.yaml");
      fs.copyFileSync(FIXTURE, teamPath);

      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined && k !== "TMUX") env[k] = v;
      }
      // T7R-R1-B1: this fixture is about host reachability, not approval, and
      // carries no team-plan trail. Opt into the ONE audited escape hatch; the
      // gate's own pins live in t7-h1-dispatch-approval.test.ts.
      env.GUILD_DISPATCH_APPROVAL_OVERRIDE =
        "host-reachability fixture: no team-plan trail; approval verification is pinned separately";

      const result = spawnSync(
        "npx",
        ["tsx", SCRIPT, "--team", teamPath, "--session-name", "guild-g4b-contract", "--cwd", tmpDir, "--dry-run"],
        { encoding: "utf8", env, timeout: 120_000 }
      );

      expect(result.status).toBe(0);
      const stdout = result.stdout ?? "";
      // The generic WrappedCliPaneAdapter's real invocation shape.
      expect(stdout).toMatch(/cursor-agent -p/);

      const runsDir = path.join(tmpDir, ".guild", "runs");
      const runId = fs.readdirSync(runsDir)[0];
      const manifestPath = path.join(runsDir, runId, "agent-team", "session.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const hostKinds = manifest.teammate_panes.map((p: { host_kind: string }) => p.host_kind);
      expect(hostKinds).toContain("cursor");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
