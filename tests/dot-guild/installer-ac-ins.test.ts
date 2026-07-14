/**
 * tests/dot-guild/installer-ac-ins.test.ts
 *
 * verified-multi-host-support L7 (wave-4b) — the durable AC-INS regression suite for
 * the rewritten `plugin/install.sh` (L4). It turns L4's manual dry-run transcripts into
 * permanent tests against the exit-code / build-once / consent / refusal CONTRACT
 * (L4 handoff "interface contract"):
 *
 *   exit 0  install or dry-run completed
 *   exit 2  unknown / unsupported host id
 *   exit 3  consent required — a >1-host write with neither --yes nor a TTY
 *   exit 4  app/connector surface refused
 *
 * Everything is driven through `install.sh --dry-run` — NEVER a real install. spawnSync
 * gives the child a non-TTY stdin (a pipe, no data), which is exactly the CI condition
 * the consent gate must fail closed on; interactive y/N is L4's pty concern, not this
 * suite's. "Build once" is asserted by counting how many times the render step
 * (`build-host-packages.ts`) is scheduled in the dry-run output — it must be exactly 1
 * for any installable set, and 0 whenever the run is refused/gated before render.
 *
 * Grounding: plugin/install.sh, the L4 handoff exit-code contract, and the existing
 * install-sh-equivalence.test.ts sibling-path pattern.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const INSTALL_SH = path.join(PLUGIN_ROOT, "install.sh");

interface Run {
  status: number;
  stdout: string;
  stderr: string;
  /** Times the build-once render step was scheduled (dry-run: `would run: … build-host-packages.ts`). */
  renderCount: number;
}

/**
 * Run install.sh --dry-run with a NON-TTY stdin (spawnSync pipes stdin with no data),
 * which is the exact non-interactive CI condition the consent gate keys on. `cwd`
 * defaults to the plugin root; a caller passes a temp dir to prove the absolute-path /
 * cwd-independence contract. `--dry-run` is always injected — no real install ever runs.
 */
function runInstaller(args: string[], cwd: string = PLUGIN_ROOT): Run {
  const res = spawnSync("bash", [INSTALL_SH, "--dry-run", ...args], {
    cwd,
    encoding: "utf8",
    // Explicit non-TTY stdin: a pipe with no data. `[ -t 0 ]` is false in the script.
    stdio: ["pipe", "pipe", "pipe"],
    input: "",
    env: { ...process.env },
    maxBuffer: 20 * 1024 * 1024,
    timeout: 60_000,
  });
  const stdout = res.stdout ?? "";
  const renderCount = (stdout.match(/build-host-packages\.ts/g) ?? []).length;
  return { status: res.status ?? -1, stdout, stderr: res.stderr ?? "", renderCount };
}

const INSTALLABLE_IDS = [
  "claude-code-cli",
  "codex-cli",
  "pi-cli",
  "antigravity-cli",
  "agents-file",
  "cursor",
  "github-copilot",
  "opencode",
  "rovo-dev",
  "kiro",
  "qoder",
  "trae",
];

const REFUSE_IDS = ["claude-code-app", "claude-code-web", "codex-app", "claude-ai-connector"];

describe("install.sh AC-INS contract (dry-run only)", () => {
  it("the installer script exists at the plugin repo root", () => {
    expect(fs.existsSync(INSTALL_SH)).toBe(true);
  });

  // ── AC-INS-1 — every installable id dry-runs to exit 0 with exactly one render ──
  describe("AC-INS-1 — --host <id> exits 0 and renders once for every installable/file/IDE id", () => {
    for (const id of INSTALLABLE_IDS) {
      it(`--host ${id} → exit 0, render-count 1`, () => {
        const run = runInstaller(["--host", id]);
        expect(run.status).toBe(0);
        expect(run.renderCount).toBe(1); // build-once
      });
    }

    it("run by ABSOLUTE path from a DIFFERENT cwd → exit 0, no `.//`, absolute dist path (L4 cwd-bug fix)", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-installer-cwd-"));
      try {
        const run = runInstaller(["--host", "claude-code-cli"], tmp);
        expect(run.status).toBe(0);
        // The cwd bug produced `.//Users/.../dist` — assert it never reappears.
        expect(run.stdout).not.toContain(".//");
        // From a foreign cwd the render resolves to the plugin's own absolute dist tree.
        expect(run.stdout).toContain(`${PLUGIN_ROOT}/dist/claude-code`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  // ── AC-INS-2 — multi-select dispatches all, renders once, de-dupes ─────────────
  describe("AC-INS-2 — --hosts a,b,c multi-select builds once and dispatches all", () => {
    it("--yes --hosts cursor,pi-cli,trae → exit 0, render-count 1, all three dispatched", () => {
      const run = runInstaller(["--yes", "--hosts", "cursor,pi-cli,trae"]);
      expect(run.status).toBe(0);
      expect(run.renderCount).toBe(1); // build-once across the whole set
      expect(run.stdout).toContain("cursor (new-CLI)");
      expect(run.stdout).toContain("Pi CLI");
      expect(run.stdout).toContain("trae (new-IDE");
    });

    it("de-dupes a repeated id — --hosts cursor,cursor,pi-cli resolves to 2 hosts, one render", () => {
      const run = runInstaller(["--yes", "--hosts", "cursor,cursor,pi-cli"]);
      expect(run.status).toBe(0);
      expect(run.renderCount).toBe(1);
      expect(run.stdout).toMatch(/Selected 2 hosts:/); // not 3
    });
  });

  // ── AC-INS-3 — consent gate: negative control + paired positive ────────────────
  describe("AC-INS-3 — non-interactive multi-host write requires consent (SEC-M1)", () => {
    it("NEGATIVE control: >1-host write, no --yes, non-TTY → exit 3 and NOTHING rendered/written", () => {
      const distBefore = fs.existsSync(path.join(PLUGIN_ROOT, "dist"))
        ? fs.statSync(path.join(PLUGIN_ROOT, "dist")).mtimeMs
        : null;

      const run = runInstaller(["--hosts", "claude-code-cli,codex-cli"]);
      expect(run.status).toBe(3);
      // Gated BEFORE render — build-once never even scheduled.
      expect(run.renderCount).toBe(0);
      expect(run.stdout).not.toContain("would run: npx tsx");
      expect(run.stderr).toMatch(/Refusing to write Guild payload to 2 hosts without consent/);

      // fs/dist untouched — the gate aborts before any package generation.
      const distAfter = fs.existsSync(path.join(PLUGIN_ROOT, "dist"))
        ? fs.statSync(path.join(PLUGIN_ROOT, "dist")).mtimeMs
        : null;
      expect(distAfter).toBe(distBefore);
    });

    it("POSITIVE control: the same set with --yes → exit 0, render-count 1", () => {
      const run = runInstaller(["--yes", "--hosts", "claude-code-cli,codex-cli"]);
      expect(run.status).toBe(0);
      expect(run.renderCount).toBe(1);
    });

    it("a SINGLE host is NEVER gated — no --yes, non-TTY → exit 0", () => {
      const run = runInstaller(["--host", "claude-code-cli"]);
      expect(run.status).toBe(0);
      expect(run.renderCount).toBe(1);
    });

    it("auto-detect of >1 host is gated too — isolated PATH with two fake host bins → exit 3", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-installer-detect-"));
      try {
        const bin = path.join(tmp, "bin");
        fs.mkdirSync(bin, { recursive: true });
        for (const b of ["claude", "codex"]) {
          const p = path.join(bin, b);
          fs.writeFileSync(p, "#!/usr/bin/env bash\nexit 0\n");
          fs.chmodSync(p, 0o755);
        }
        // Shadow real host CLIs that live in /usr/bin on CI runners (GitHub's
        // runners ship `gh` WITH the copilot extension, which the registry
        // subcommand probe legitimately detects) — the fixture must pin
        // detection to exactly claude+codex.
        // Only gh/acli need shadowing (present in /usr/bin on runners; their
        // hosts require a SUBCOMMAND probe, so an exit-1 fake defeats it).
        // Bare CLIs (pi/agy/cursor-agent/opencode) are presence-probed — a fake
        // of any exit code would ADD hosts, and none exist in /usr/bin anyway.
        for (const b of ["gh", "acli"]) {
          const p = path.join(bin, b);
          fs.writeFileSync(p, "#!/usr/bin/env bash\nexit 1\n");
          fs.chmodSync(p, 0o755);
        }
        // Bare auto-detect (no --host/--hosts): PATH probe finds claude + codex → 2 hosts.
        const gated = spawnSync("bash", [INSTALL_SH, "--dry-run"], {
          cwd: tmp,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          input: "",
          env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
          maxBuffer: 20 * 1024 * 1024,
          timeout: 60_000,
        });
        expect(gated.status).toBe(3);
        expect((gated.stdout ?? "").match(/build-host-packages\.ts/g)).toBeNull();
        expect(gated.stdout ?? "").toMatch(/Auto-detected 2 supported hosts/);

        // DISCRIMINATING: the same detection with --yes proceeds to a single render.
        const consented = spawnSync("bash", [INSTALL_SH, "--dry-run", "--yes"], {
          cwd: tmp,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          input: "",
          env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
          maxBuffer: 20 * 1024 * 1024,
          timeout: 60_000,
        });
        expect(consented.status).toBe(0);
        expect((consented.stdout ?? "").match(/build-host-packages\.ts/g)).toHaveLength(1);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  // ── AC-INS-5 — app/connector refusal (fail-closed, no partial write) ───────────
  describe("AC-INS-5 — app/connector surfaces are refused with exit 4 and no render", () => {
    for (const id of [...REFUSE_IDS, "claude-code-desktop"]) {
      it(`--host ${id} → exit 4, render-count 0, refusal on stderr`, () => {
        const run = runInstaller(["--host", id]);
        expect(run.status).toBe(4);
        expect(run.renderCount).toBe(0);
        expect(run.stderr).toMatch(/app\/connector surface/);
      });
    }

    it("a MIXED installable+refuse set is refused as a whole — exit 4, no partial render", () => {
      const run = runInstaller(["--yes", "--hosts", "claude-code-cli,codex-app"]);
      expect(run.status).toBe(4);
      expect(run.renderCount).toBe(0); // fail-closed before build-once
    });
  });

  // ── Error paths — unknown / unsupported ids ────────────────────────────────────
  describe("error paths — unknown ids exit 2 with no render", () => {
    it("--host frobnicate → exit 2", () => {
      const run = runInstaller(["--host", "frobnicate"]);
      expect(run.status).toBe(2);
      expect(run.renderCount).toBe(0);
    });

    it("--hosts cursor,frobnicate → exit 2, no partial render (validated up front)", () => {
      const run = runInstaller(["--hosts", "cursor,frobnicate"]);
      expect(run.status).toBe(2);
      expect(run.renderCount).toBe(0);
    });
  });
});
