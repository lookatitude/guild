/**
 * src/modules/distribution/workflows/verify-installer.ts
 *
 * Verifies the non-mutating installer contract exposed by install.sh. This rail
 * proves every supported host has a concrete dry-run install path without
 * installing into any external host.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { PLUGIN_ROOT } from "./build-inventory";

export type InstallerHost =
  | "claude-code-cli"
  | "codex-cli"
  | "agents-file"
  | "pi-cli"
  | "antigravity-cli";

export interface InstallerHostExpectation {
  host: InstallerHost;
  snippets: string[];
}

export interface InstallerVerification {
  ok: boolean;
  checks: string[];
  errors: string[];
}

interface VerifyOptions {
  root?: string;
  installScript?: string;
  pathEnv?: string;
  executeFixtures?: boolean;
  executeLiveIsolated?: boolean;
}

export const INSTALLER_HOST_EXPECTATIONS: InstallerHostExpectation[] = [
  {
    host: "claude-code-cli",
    snippets: [
      "Claude Code selected (dry-run; claude binary not required for planning)",
      "would run: npx tsx scripts/build-host-packages.ts --root . --out dist --generated-at <generated-at>",
      "would run: claude plugin validate ./dist/claude-code",
      "would run: claude plugin marketplace add ./dist/claude-code",
      "would run: claude plugin marketplace update guild",
      "would run: claude plugin install guild@guild",
      "Guild installed into Claude Code.",
    ],
  },
  {
    host: "codex-cli",
    snippets: [
      "Codex CLI selected (dry-run; codex binary not required for planning)",
      "would run: npx tsx scripts/build-host-packages.ts --root . --out dist --generated-at <generated-at>",
      "would run: codex plugin marketplace remove guild || true",
      "would run: codex plugin marketplace add ./dist/codex-marketplace",
      "would run: codex plugin add guild@guild",
      "Package bootstrap: AGENTS.md plus .agents/skills/guild.",
    ],
  },
  {
    host: "agents-file",
    snippets: [
      "Universal AGENTS.md package target selected.",
      "would run: npx tsx scripts/build-host-packages.ts --root . --out dist --generated-at <generated-at>",
      "dist/agents/AGENTS.md",
      "dist/agents/.agents/skills/guild",
    ],
  },
  {
    host: "pi-cli",
    snippets: [
      "Pi CLI selected (dry-run; pi binary not required for planning)",
      "would run: npx tsx scripts/build-host-packages.ts --root . --out dist --generated-at <generated-at>",
      "would run: pi install ./dist/pi",
      "pi-manifest.json",
      "guild-run --host pi",
    ],
  },
  {
    host: "antigravity-cli",
    snippets: [
      "Antigravity CLI selected (dry-run; agy binary not required for planning)",
      "would run: npx tsx scripts/build-host-packages.ts --root . --out dist --generated-at <generated-at>",
      "would run: agy plugin validate ./dist/antigravity",
      "would run: agy plugin install ./dist/antigravity",
      "plugin.json",
      "antigravity-manifest.json",
      "guild-run --host antigravity",
    ],
  },
];

const REAL_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/;

const INSTALLER_EXECUTION_CALLS: Record<InstallerHost, string[]> = {
  "claude-code-cli": [
    "claude\tplugin validate ./dist/claude-code",
    "claude\tplugin marketplace add ./dist/claude-code",
    "claude\tplugin marketplace update guild",
    "claude\tplugin install guild@guild",
  ],
  "codex-cli": [
    "codex\tplugin marketplace remove guild",
    "codex\tplugin marketplace add ./dist/codex-marketplace",
    "codex\tplugin add guild@guild",
  ],
  "agents-file": [],
  "pi-cli": ["pi\tinstall ./dist/pi"],
  "antigravity-cli": [
    "agy\tplugin validate ./dist/antigravity",
    "agy\tplugin install ./dist/antigravity",
  ],
};

const INSTALLER_EXECUTION_FILES: Record<InstallerHost, string[]> = {
  "claude-code-cli": ["dist/claude-code/.claude-plugin/plugin.json"],
  "codex-cli": ["dist/codex-marketplace/.agents/plugins/marketplace.json"],
  "agents-file": ["dist/agents/AGENTS.md", "dist/agents/.agents/skills/guild/meta/using-guild/SKILL.src.md"],
  "pi-cli": ["dist/pi/pi-manifest.json"],
  "antigravity-cli": ["dist/antigravity/antigravity-manifest.json", "dist/antigravity/plugin.json"],
};

export function verifyInstallerDryRunOutput(host: InstallerHost, stdout: string): string[] {
  const expectation = INSTALLER_HOST_EXPECTATIONS.find((entry) => entry.host === host);
  if (!expectation) return [`unsupported installer host expectation: ${host}`];

  const errors: string[] = [];
  for (const snippet of expectation.snippets) {
    if (!stdout.includes(snippet)) {
      errors.push(`${host}: missing dry-run output snippet: ${snippet}`);
    }
  }
  if (REAL_TIMESTAMP.test(stdout)) {
    errors.push(`${host}: dry-run emitted a real timestamp instead of <generated-at>`);
  }
  return errors;
}

export function verifyInstallerHostExecutionLog(host: InstallerHost, lines: string[]): string[] {
  const expected = INSTALLER_EXECUTION_CALLS[host];
  const errors: string[] = [];
  for (const call of expected) {
    if (!lines.includes(call)) errors.push(`${host}: missing executed host call: ${call}`);
  }
  for (const line of lines) {
    if (!expected.includes(line)) errors.push(`${host}: unexpected executed host call: ${line}`);
  }
  return errors;
}

function writeFakeHostBinary(binDir: string, name: string): void {
  const abs = path.join(binDir, name);
  fs.writeFileSync(
    abs,
    [
      "#!/usr/bin/env bash",
      'printf "%s\\t" "$(basename "$0")" >> "$GUILD_INSTALL_FAKE_HOST_LOG"',
      'printf "%s" "$*" >> "$GUILD_INSTALL_FAKE_HOST_LOG"',
      'printf "\\n" >> "$GUILD_INSTALL_FAKE_HOST_LOG"',
      "exit 0",
      "",
    ].join("\n")
  );
  fs.chmodSync(abs, 0o755);
}

function readLogLines(logFile: string): string[] {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, "utf8").split(/\r?\n/).filter(Boolean);
}

function hostBinaryFor(host: InstallerHost): string | null {
  switch (host) {
    case "claude-code-cli":
      return "claude";
    case "codex-cli":
      return "codex";
    case "pi-cli":
      return "pi";
    case "antigravity-cli":
      return "agy";
    case "agents-file":
      return null;
  }
}

function executableOnPath(binary: string, pathEnv: string): boolean {
  const res = spawnSync("bash", ["-lc", `command -v ${binary}`], {
    encoding: "utf8",
    env: { ...process.env, PATH: pathEnv },
  });
  return res.status === 0 && res.stdout.trim().length > 0;
}

export function verifyInstallerDryRuns(options: VerifyOptions = {}): InstallerVerification {
  const root = options.root ?? PLUGIN_ROOT;
  const installScript = options.installScript ?? path.join(root, "install.sh");
  const checks: string[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(installScript) || !fs.statSync(installScript).isFile()) {
    return {
      ok: false,
      checks,
      errors: [`missing installer script: ${installScript}`],
    };
  }

  for (const expectation of INSTALLER_HOST_EXPECTATIONS) {
    const res = spawnSync("bash", [installScript, "--dry-run", "--host", expectation.host], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: options.pathEnv ?? "/usr/bin:/bin",
        npm_config_cache: process.env["npm_config_cache"] ?? "/private/tmp/guild-npm-cache",
      },
      maxBuffer: 10 * 1024 * 1024,
    });
    if (res.status !== 0) {
      errors.push(`${expectation.host}: install.sh dry-run exited ${res.status}: ${res.stderr || res.stdout}`);
      continue;
    }
    const outputErrors = verifyInstallerDryRunOutput(expectation.host, res.stdout);
    errors.push(...outputErrors);
    if (outputErrors.length === 0) checks.push(`${expectation.host}:install.sh --dry-run`);
  }

  return { ok: errors.length === 0, checks, errors };
}

export function verifyInstallerFixtureExecutions(options: VerifyOptions = {}): InstallerVerification {
  const root = options.root ?? PLUGIN_ROOT;
  const installScript = options.installScript ?? path.join(root, "install.sh");
  const checks: string[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(installScript) || !fs.statSync(installScript).isFile()) {
    return {
      ok: false,
      checks,
      errors: [`missing installer script: ${installScript}`],
    };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-installer-exec-"));
  try {
    const fakeBin = path.join(tmp, "bin");
    const fakeHome = path.join(tmp, "home");
    const fakeConfig = path.join(tmp, "config");
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.mkdirSync(fakeConfig, { recursive: true });
    for (const binary of ["claude", "codex", "pi", "agy"]) writeFakeHostBinary(fakeBin, binary);

    for (const expectation of INSTALLER_HOST_EXPECTATIONS) {
      const logFile = path.join(tmp, `${expectation.host}.log`);
      fs.writeFileSync(logFile, "");
      const res = spawnSync("bash", [installScript, "--host", expectation.host], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: fakeHome,
          XDG_CONFIG_HOME: fakeConfig,
          GUILD_INSTALL_FAKE_HOST_LOG: logFile,
          PATH: `${fakeBin}${path.delimiter}${options.pathEnv ?? process.env.PATH ?? "/usr/bin:/bin"}`,
          npm_config_cache: process.env["npm_config_cache"] ?? "/private/tmp/guild-npm-cache",
        },
        maxBuffer: 20 * 1024 * 1024,
      });
      if (res.status !== 0) {
        errors.push(`${expectation.host}: install.sh fixture execution exited ${res.status}: ${res.stderr || res.stdout}`);
        continue;
      }
      if (res.stdout.includes("would run:")) {
        errors.push(`${expectation.host}: fixture execution unexpectedly used dry-run output`);
      }
      if (!res.stdout.includes("running: npx tsx")) {
        errors.push(`${expectation.host}: fixture execution did not run host package generation`);
      }

      const lines = readLogLines(logFile);
      errors.push(...verifyInstallerHostExecutionLog(expectation.host, lines));
      for (const rel of INSTALLER_EXECUTION_FILES[expectation.host]) {
        const abs = path.join(root, rel);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          errors.push(`${expectation.host}: expected generated install artifact missing: ${rel}`);
        }
      }

      const hostErrors = errors.filter((error) => error.startsWith(`${expectation.host}:`));
      if (hostErrors.length === 0) checks.push(`${expectation.host}:install.sh fixture execution`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  return { ok: errors.length === 0, checks, errors };
}

export function verifyInstallerLiveIsolatedExecutions(options: VerifyOptions = {}): InstallerVerification {
  const root = options.root ?? PLUGIN_ROOT;
  const installScript = options.installScript ?? path.join(root, "install.sh");
  const pathEnv = options.pathEnv ?? process.env.PATH ?? "/usr/bin:/bin";
  const checks: string[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(installScript) || !fs.statSync(installScript).isFile()) {
    return {
      ok: false,
      checks,
      errors: [`missing installer script: ${installScript}`],
    };
  }

  for (const expectation of INSTALLER_HOST_EXPECTATIONS) {
    const binary = hostBinaryFor(expectation.host);
    if (binary && !executableOnPath(binary, pathEnv)) {
      errors.push(`${expectation.host}: real host binary not found on PATH: ${binary}`);
      continue;
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `guild-installer-live-${expectation.host}-`));
    try {
      const home = path.join(tmp, "home");
      const config = path.join(tmp, "config");
      const cache = path.join(tmp, "cache");
      const data = path.join(tmp, "data");
      const state = path.join(tmp, "state");
      for (const dir of [home, config, cache, data, state]) fs.mkdirSync(dir, { recursive: true });

      const res = spawnSync("bash", [installScript, "--host", expectation.host], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          XDG_CONFIG_HOME: config,
          XDG_CACHE_HOME: cache,
          XDG_DATA_HOME: data,
          XDG_STATE_HOME: state,
          PATH: pathEnv,
          npm_config_cache: process.env["npm_config_cache"] ?? "/private/tmp/guild-npm-cache",
        },
        timeout: 120_000,
        maxBuffer: 30 * 1024 * 1024,
      });

      if (res.error) {
        errors.push(`${expectation.host}: live isolated installer failed to execute: ${res.error.message}`);
        continue;
      }
      if (res.status !== 0) {
        errors.push(
          `${expectation.host}: live isolated install.sh exited ${res.status}: ${res.stderr || res.stdout}`
        );
        continue;
      }
      if (res.stdout.includes("would run:")) {
        errors.push(`${expectation.host}: live isolated execution unexpectedly used dry-run output`);
      }
      if (!res.stdout.includes("running: npx tsx")) {
        errors.push(`${expectation.host}: live isolated execution did not run host package generation`);
      }
      for (const call of INSTALLER_EXECUTION_CALLS[expectation.host]) {
        const rendered = call.replace("\t", " ");
        if (!res.stdout.includes(`running: ${rendered}`) && !res.stdout.includes(`running: ${call.split("\t")[0]}`)) {
          errors.push(`${expectation.host}: live isolated output missing host command: ${rendered}`);
        }
      }
      for (const rel of INSTALLER_EXECUTION_FILES[expectation.host]) {
        const abs = path.join(root, rel);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          errors.push(`${expectation.host}: expected generated install artifact missing: ${rel}`);
        }
      }

      const hostErrors = errors.filter((error) => error.startsWith(`${expectation.host}:`));
      if (hostErrors.length === 0) checks.push(`${expectation.host}:install.sh live isolated execution`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  return { ok: errors.length === 0, checks, errors };
}

export function parseVerifyInstallerArgs(argv: string[]): VerifyOptions | { error: string } {
  let root = PLUGIN_ROOT;
  let installScript = "";
  let executeFixtures = false;
  let executeLiveIsolated = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root" && argv[i + 1] !== undefined) root = path.resolve(argv[++i]);
    else if (arg.startsWith("--root=")) root = path.resolve(arg.slice("--root=".length));
    else if (arg === "--install-script" && argv[i + 1] !== undefined) installScript = path.resolve(argv[++i]);
    else if (arg.startsWith("--install-script=")) {
      installScript = path.resolve(arg.slice("--install-script=".length));
    } else if (arg === "--execute-fixtures") {
      executeFixtures = true;
    } else if (arg === "--execute-live-isolated") {
      executeLiveIsolated = true;
    } else {
      return { error: `unknown argument: ${arg}` };
    }
  }
  if (executeFixtures && executeLiveIsolated) {
    return { error: "--execute-fixtures and --execute-live-isolated are mutually exclusive" };
  }
  return { root, executeFixtures, executeLiveIsolated, ...(installScript ? { installScript } : {}) };
}

export function runVerifyInstallerCli(argv: string[] = process.argv.slice(2)): number {
  const parsed = parseVerifyInstallerArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(
      `${parsed.error}\nusage: verify-installer.ts [--root <pluginRoot>] [--install-script <path>] [--execute-fixtures|--execute-live-isolated]\n`
    );
    return 1;
  }
  const result = parsed.executeFixtures
    ? verifyInstallerFixtureExecutions(parsed)
    : parsed.executeLiveIsolated
      ? verifyInstallerLiveIsolatedExecutions(parsed)
      : verifyInstallerDryRuns(parsed);
  if (!result.ok) {
    process.stderr.write("verify-installer: FAIL\n  " + result.errors.join("\n  ") + "\n");
    return 2;
  }
  const label = parsed.executeFixtures
    ? "fixture execution"
    : parsed.executeLiveIsolated
      ? "live isolated execution"
      : "dry-run";
  process.stdout.write(
    `verify-installer: PASS (${result.checks.length} ${label} checks).\n`
  );
  return 0;
}
