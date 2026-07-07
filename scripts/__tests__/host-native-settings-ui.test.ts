/**
 * scripts/__tests__/host-native-settings-ui.test.ts
 *
 * init-config-goal lane L5 (§V / V10 + V11 + V14) — the host-native config-UI SEPARATION.
 *
 * V10 (no direct mutation, all native hosts): for EVERY CLI/agents-file host, the
 *   `config ui set` adapter routes its write through the plugin config API and mutates
 *   NO file (or shells out) of its own. A runtime spy proves the API is invoked exactly
 *   once with the resolved scope/key/value while fs + child_process stay untouched; a
 *   direct-fs and a shell-out COUNTEREXAMPLE prove the assertions are non-vacuous; a
 *   static scan proves the surface module imports no fs/child_process/exec/spawn and
 *   contains no shell-redirect. (The single-host L4 boundary test in config-ui-surface.test.ts
 *   is NOT duplicated — this generalizes it across all hosts + adds the child_process/shell dim.)
 *
 * V11 (app/connector feasibility): app/connector hosts have NO native edit path — the
 *   surface returns `blocked` and `config ui set` refuses, mirroring the L0 verdict. The
 *   blocked-set is exactly HOST_IDS \ CLI_NATIVE_HOSTS, and matches hostOpenPreflight.
 *
 * V14 (regression / safe-default): malformed settings fail CLOSED — the write is refused
 *   without corrupting the file, and the resolver degrades to built-in defaults.
 */

import { spawnSync } from "child_process";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { cmdUiSet, type UiSetDeps } from "../config-cmd";
import { buildHostConfigUiSurface } from "../lib/config-ui-surface";
import { resolveSettings } from "../lib/settings-resolver";
import { CLI_NATIVE_HOSTS, hostOpenPreflight } from "../lib/host-open-preflight";
import { HOST_IDS } from "../lib/host-registry-schema";

const NOW = "2026-06-26T00:00:00.000Z";
const NATIVE_HOSTS = ["claude-code-cli", "codex-cli", "pi-cli", "antigravity-cli", "agents-file"];
const APP_CONNECTOR_HOSTS = ["claude-code-app", "claude-code-web", "codex-app", "claude-ai-connector"];

function mkProject(settings: unknown = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-host-native-"));
  fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".guild", "settings.json"), JSON.stringify(settings, null, 2));
  return dir;
}
function rm(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** A reload seam returning a synthetic resolved config — keeps these units pure (no I/O). */
function fakeReload(value: unknown): UiSetDeps["reload"] {
  return () => ({ config: { rigor: value }, sources: { rigor: "project" } });
}

// ===========================================================================
// V10 — every native host routes its write through the config API (no self-mutation)
// ===========================================================================

describe("V10 — `config ui set` routes through the config API on ALL native hosts", () => {
  for (const host of NATIVE_HOSTS) {
    it(`${host}: invokes the write API once; performs NO direct fs/child_process write`, () => {
      const dir = mkProject({});
      const fsWriteSpy = jest.spyOn(fs, "writeFileSync");
      const execSpy = jest.spyOn(childProcess, "execSync").mockImplementation(() => Buffer.from(""));
      const spawnSpy = jest.spyOn(childProcess, "spawnSync");
      const persistSpy = jest.fn<number, [string, string, "workspace" | "project" | "local", string]>(() => 0);
      const stdout = jest.spyOn(process.stdout, "write").mockImplementation(() => true);

      const rc = cmdUiSet(dir, "rigor", "deep", "project", host, undefined, {
        persist: persistSpy,
        reload: fakeReload("deep"),
      });

      stdout.mockRestore();
      expect(rc).toBe(0);
      // (a) the config write API was invoked exactly once with the resolved scope/key/value
      expect(persistSpy).toHaveBeenCalledTimes(1);
      expect(persistSpy).toHaveBeenCalledWith("rigor", "deep", "project", dir);
      // (b) the adapter path itself mutated nothing — no fs write, no shell-out
      expect(fsWriteSpy).not.toHaveBeenCalled();
      expect(execSpy).not.toHaveBeenCalled();
      expect(spawnSpy).not.toHaveBeenCalled();

      fsWriteSpy.mockRestore();
      execSpy.mockRestore();
      spawnSpy.mockRestore();
      rm(dir);
    });
  }

  it("COUNTEREXAMPLE — a direct-fs rewire DOES write fs (boundary proof is non-vacuous)", () => {
    const dir = mkProject({});
    const fsWriteSpy = jest.spyOn(fs, "writeFileSync");
    const stdout = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    const directFsRewire = jest.fn<number, [string, string, "workspace" | "project" | "local", string]>(
      (k, v, _s, c) => {
        fs.writeFileSync(path.join(c, ".guild", "settings.json"), JSON.stringify({ [k]: v }, null, 2));
        return 0;
      }
    );
    cmdUiSet(dir, "rigor", "deep", "project", "claude-code-cli", undefined, {
      persist: directFsRewire,
      reload: fakeReload("deep"),
    });
    stdout.mockRestore();
    // The real routed path passes `fsWriteSpy not called`; the rewire FAILS it — so the
    // V10 assertion genuinely distinguishes routed-through-API from a direct-fs write.
    expect(fsWriteSpy).toHaveBeenCalled();
    expect(() => expect(fsWriteSpy).not.toHaveBeenCalled()).toThrow();
    fsWriteSpy.mockRestore();
    rm(dir);
  });

  it("COUNTEREXAMPLE — a shell-out rewire DOES spawn a process (child_process deny is non-vacuous)", () => {
    const dir = mkProject({});
    const execSpy = jest.spyOn(childProcess, "execSync").mockImplementation(() => Buffer.from(""));
    const stdout = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    const shellRewire = jest.fn<number, [string, string, "workspace" | "project" | "local", string]>(
      (k, v) => {
        childProcess.execSync(`printf '%s=%s' ${k} ${v}`); // the exact anti-pattern: shelling out to write
        return 0;
      }
    );
    cmdUiSet(dir, "rigor", "deep", "project", "claude-code-cli", undefined, {
      persist: shellRewire,
      reload: fakeReload("deep"),
    });
    stdout.mockRestore();
    expect(execSpy).toHaveBeenCalled();
    expect(() => expect(execSpy).not.toHaveBeenCalled()).toThrow();
    execSpy.mockRestore();
    rm(dir);
  });

  it("the surface module imports NO fs / child_process and contains no exec/spawn/redirect", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "..", "lib", "config-ui-surface.ts"), "utf8");
    // strip line comments + block comments so prose (e.g. "NO fs here") never trips the scan
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+["']fs["']/);
    expect(code).not.toMatch(/from\s+["']child_process["']/);
    expect(code).not.toMatch(/writeFileSync|mkdirSync|appendFileSync/);
    expect(code).not.toMatch(/execSync|spawnSync|\bexec\(|\bspawn\(/);
    // no shell redirect operators in any string literal (a >/>> write path)
    expect(code).not.toMatch(/["'`][^"'`]*\s>>?\s[^"'`]*["'`]/);
  });
});

// ===========================================================================
// V11 — app/connector hosts are blocked (no native edit path)
// ===========================================================================

describe("V11 — app/connector hosts → blocked (the L0 verdict's blocked-set holds)", () => {
  it("the blocked-set is EXACTLY HOST_IDS minus the CLI-native set (partition holds)", () => {
    const blocked = HOST_IDS.filter((h) => !CLI_NATIVE_HOSTS.has(h));
    expect(new Set(blocked)).toEqual(new Set(APP_CONNECTOR_HOSTS));
    // native ∪ blocked == all hosts, and the two are disjoint
    expect(new Set([...CLI_NATIVE_HOSTS, ...blocked])).toEqual(new Set(HOST_IDS));
    expect(CLI_NATIVE_HOSTS.size + blocked.length).toBe(HOST_IDS.length);
    for (const h of APP_CONNECTOR_HOSTS) expect(CLI_NATIVE_HOSTS.has(h)).toBe(false);
  });

  for (const host of APP_CONNECTOR_HOSTS) {
    it(`${host}: the surface is blocked and renders no native edit path`, () => {
      const s = buildHostConfigUiSurface({ host, config: { rigor: "deep" }, renderedAt: NOW });
      expect(s.blocked).toBe(true);
      expect(s.advisory).toBe("host_unsupported");
      expect(s.groups).toEqual([]);
      expect(s.key_count).toBe(0);
      expect(s.native_render).toBeNull();
    });

    it(`${host}: \`config ui set\` refuses and the config API is NEVER reached`, () => {
      const dir = mkProject({});
      const persistSpy = jest.fn<number, [string, string, "workspace" | "project" | "local", string]>(() => 0);
      const stdout = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
      const rc = cmdUiSet(dir, "rigor", "deep", "project", host, undefined, {
        persist: persistSpy,
        reload: fakeReload("deep"),
      });
      stdout.mockRestore();
      expect(rc).toBe(1);
      expect(persistSpy).not.toHaveBeenCalled(); // never even attempted a write
      rm(dir);
    });

    it(`${host}: hostOpenPreflight agrees — action="blocked" (consistent with the surface)`, () => {
      const dir = mkProject({});
      expect(hostOpenPreflight(dir, host).action).toBe("blocked");
      rm(dir);
    });
  }

  it("anti-vacuity: a native host is NOT blocked (the block is host-specific, not always-on)", () => {
    const s = buildHostConfigUiSurface({ host: "claude-code-cli", config: { rigor: "deep" }, renderedAt: NOW });
    expect(s.blocked).toBe(false);
    expect(hostOpenPreflight(mkProject({}), "claude-code-cli").action).not.toBe("blocked");
  });
});

// ===========================================================================
// V14 — regression / security: malformed input → safe default (fail closed)
// ===========================================================================

describe("V14 — malformed settings → safe default (fail closed)", () => {
  it("a malformed project settings.json makes the resolver degrade to built-in defaults", () => {
    const dir = mkProject();
    fs.writeFileSync(path.join(dir, ".guild", "settings.json"), "{ not: valid json ");
    const { config } = resolveSettings({ cwd: dir });
    expect(config.rigor).toBe("standard"); // built-in
    expect(config.agent_mode).toBe("auto"); // built-in
    rm(dir);
  });

  it("a bogus-typed security value is dropped to the safe default, never carried through", () => {
    const dir = mkProject({ security: { bypass_permissions_policy: "yolo" } });
    const { config } = resolveSettings({ cwd: dir });
    expect(config.security.bypass_permissions_policy).toBe("audit"); // safe default
    expect(config.security.bypass_permissions_policy).not.toBe("yolo");
    rm(dir);
  });

  it("`config ui set` against a malformed settings.json fails CLOSED (no corruption, NONZERO)", () => {
    const dir = mkProject();
    const malformed = "{ rigor: broken ";
    fs.writeFileSync(path.join(dir, ".guild", "settings.json"), malformed);
    const stdout = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    // Real config API (cmdSet) — its read-modify-write throws on the malformed file and aborts.
    const rc = cmdUiSet(dir, "rigor", "deep", "project", "claude-code-cli", undefined);
    stdout.mockRestore();
    expect(rc).toBe(1);
    // the malformed file was left untouched — fail closed, never a partial overwrite
    expect(fs.readFileSync(path.join(dir, ".guild", "settings.json"), "utf8")).toBe(malformed);
    rm(dir);
  });

  it("regression smoke — a real CLI `config ui list` still renders for a native host", () => {
    const dir = mkProject({ rigor: "deep" });
    const SCRIPT = path.resolve(__dirname, "..", "config-cmd.ts");
    const r = spawnSync("npx", ["tsx", SCRIPT, "ui", "list", "--group", "startup", "--cwd", dir], {
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/ui list — host "claude-code-cli"/);
    rm(dir);
  });
});
