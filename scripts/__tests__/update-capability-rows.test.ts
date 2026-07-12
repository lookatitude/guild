/**
 * scripts/__tests__/update-capability-rows.test.ts
 *
 * AC-7 (plugin-update-lifecycle, multi-host honesty): EVERY registry host
 * carries an update-check/update-apply capability row; hosts without an apply
 * path degrade to notify with the loss recorded — no claimed-but-absent
 * capability. Plus the runtime wiring: the row is the SoT for signal commands
 * and guild-run's self-update guard.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  HOST_REGISTRY_ROWS,
  type HostId,
} from "../../src/modules/host-runtime/workflows/host-registry-schema";
import { UPDATE_COMMANDS } from "../../src/modules/host-runtime/workflows/host-capabilities-schema";
import { computeSignal, updateCapsForHost, CACHE_SCHEMA, RECEIPT_BASENAME, RECEIPT_SCHEMA } from "../lib/update-check";
import { runSelfUpdate } from "../lib/self-update";

const ALL_HOSTS = Object.keys(HOST_REGISTRY_ROWS) as HostId[];
const APP_SURFACES: HostId[] = ["claude-code-app", "claude-code-web", "codex-app", "claude-ai-connector"];
const WRAPPED_CLI: HostId[] = ["codex-cli", "pi-cli", "antigravity-cli", "cursor", "github-copilot", "opencode", "rovo-dev"];
const FILE_SURFACES: HostId[] = ["agents-file", "kiro", "qoder", "trae"];

describe("AC-7 — every host has a coherent update capability row", () => {
  it("all 16 registry rows carry package.update", () => {
    expect(ALL_HOSTS.length).toBe(16);
    for (const h of ALL_HOSTS) {
      const u = HOST_REGISTRY_ROWS[h].capabilities.package.update;
      expect(u).toBeDefined();
      expect(["marketplace_clone", "receipt", "none"]).toContain(u.check);
      expect(["marketplace_cli", "self_update", "reinstall_command", "none"]).toContain(u.apply);
    }
  });

  it("internal coherence: command iff apply; auto only with an apply path", () => {
    for (const h of ALL_HOSTS) {
      const u = HOST_REGISTRY_ROWS[h].capabilities.package.update;
      if (u.apply === "none") {
        expect(u.command).toBeNull();
        expect(u.auto_capable).toBe(false);
        expect(u.check).toBe("none");
      } else {
        expect(typeof u.command).toBe("string");
        expect((u.command as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("refused app/connector surfaces degrade to notify-only (none/none)", () => {
    for (const h of APP_SURFACES) {
      expect(HOST_REGISTRY_ROWS[h].capabilities.package.update).toEqual({
        check: "none",
        apply: "none",
        command: null,
        auto_capable: false,
      });
    }
  });

  it("claude = marketplace CLI (auto-capable); wrapped CLIs = guild-run self-update; file surfaces = reinstall command (not auto)", () => {
    expect(HOST_REGISTRY_ROWS["claude-code-cli"].capabilities.package.update).toEqual({
      check: "marketplace_clone",
      apply: "marketplace_cli",
      command: UPDATE_COMMANDS.marketplace_cli,
      auto_capable: true,
    });
    for (const h of WRAPPED_CLI) {
      const u = HOST_REGISTRY_ROWS[h].capabilities.package.update;
      expect(u.apply).toBe("self_update");
      expect(u.command).toBe(UPDATE_COMMANDS.self_update);
      expect(u.check).toBe("receipt");
      // Two-field honesty: guild-run update EXISTS but nothing invokes it
      // automatically yet — auto_capable stays false until an auto path ships.
      expect(u.auto_capable).toBe(false);
    }
    for (const h of FILE_SURFACES) {
      const u = HOST_REGISTRY_ROWS[h].capabilities.package.update;
      expect(u.apply).toBe("reinstall_command");
      expect(u.command).toBe(UPDATE_COMMANDS.reinstall_command);
      expect(u.auto_capable).toBe(false);
    }
  });
});

describe("runtime wiring — the row is the SoT", () => {
  it("computeSignal takes the command from the host's row when hostId is given", () => {
    const sig = computeSignal({
      state: { channel: "stable", version: "2.0.1", commit: null, source: "receipt" },
      cache: {
        schema_version: CACHE_SCHEMA,
        checked_at: new Date().toISOString(),
        source_repo: "r",
        remote: { latest_tag: "v9.9.9", next_head_sha: null, main_head_sha: null },
      },
      hostKind: "claude", // coarse fallback says claude…
      hostId: "kiro", //     …but the row says reinstall_command — row wins
    });
    expect(sig.command).toBe(UPDATE_COMMANDS.reinstall_command);
    expect(updateCapsForHost("nonexistent-host")).toBeNull();
  });

  it("the schema validator rejects a row missing or violating the update shape (AC-7 fail-closed)", () => {
    const { validateHostCapabilitiesV1 } = require("../../src/modules/host-runtime/workflows/host-capabilities-schema");
    const good = JSON.parse(JSON.stringify(HOST_REGISTRY_ROWS["claude-code-cli"].capabilities));
    expect(validateHostCapabilitiesV1(good).valid).toBe(true);
    const missing = JSON.parse(JSON.stringify(good));
    delete missing.package.update;
    const r1 = validateHostCapabilitiesV1(missing);
    expect(r1.valid).toBe(false);
    expect(r1.errors.join("\n")).toContain("package.update is required");
    const incoherent = JSON.parse(JSON.stringify(good));
    incoherent.package.update = { check: "none", apply: "none", command: "oops", auto_capable: true };
    const r2 = validateHostCapabilitiesV1(incoherent);
    expect(r2.valid).toBe(false);
    expect(r2.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("guild-run self-update refuses an UNKNOWN host id before any network call (guard fail-closed)", () => {
    const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "guild-caprow-unknown-"));
    fs.writeFileSync(
      path.join(pkg, RECEIPT_BASENAME),
      JSON.stringify({
        schema_version: RECEIPT_SCHEMA,
        host: "totally-unknown-host",
        channel: "beta",
        ref: "next",
        commit: null,
        version: "2.1.0",
        installed_at: "2026-07-12T00:00:00Z",
      })
    );
    const lines: string[] = [];
    let network = false;
    const rc = runSelfUpdate({
      pkgRoot: pkg,
      deps: { log: (l) => lines.push(l), run: () => void (network = true) },
    });
    expect(rc).toBe(1);
    expect(network).toBe(false);
    expect(lines.join("\n")).toContain("no update capability row");
  });

  it("guild-run self-update refuses a host whose row is not self_update, naming the real command", () => {
    const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "guild-caprow-"));
    fs.writeFileSync(
      path.join(pkg, RECEIPT_BASENAME),
      JSON.stringify({
        schema_version: RECEIPT_SCHEMA,
        host: "kiro", // file surface — reinstall_command, NOT self_update
        channel: "stable",
        ref: "main",
        commit: null,
        version: "2.1.0",
        installed_at: "2026-07-12T00:00:00Z",
      })
    );
    const lines: string[] = [];
    let network = false;
    const rc = runSelfUpdate({
      pkgRoot: pkg,
      deps: { log: (l) => lines.push(l), run: () => void (network = true) },
    });
    expect(rc).toBe(1);
    expect(network).toBe(false); // guard fires before any network call
    expect(lines.join("\n")).toContain("apply=reinstall_command");
    expect(lines.join("\n")).toContain(UPDATE_COMMANDS.reinstall_command);
  });
});
