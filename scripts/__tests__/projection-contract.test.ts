/**
 * Projection contract.
 *
 * T12 retired the `src/modules/<id>/resources/**` byte mirrors: a host package is
 * now a PROJECTION of the live surface (KTD28), so what these tests compile and
 * diff-check is the authored file itself, addressed through the projection plan's
 * `source_path`. There is no second copy left to drift from.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { buildModuleResourcePlan } from "../lib/module-resources";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const TSC = path.join(PLUGIN_ROOT, "scripts", "node_modules", ".bin", "tsc");
const HOST_ADAPTER_IDS = [
  "lib/host-adapters/claude-code-cli",
  "lib/host-adapters/codex-cli",
  "lib/host-adapters/pi-cli",
] as const;

function compileStrict(cwd: string, inputs: string[]) {
  return spawnSync(
    TSC,
    [
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2022",
      "--module",
      "commonjs",
      "--moduleResolution",
      "node",
      "--esModuleInterop",
      "--types",
      "node,jest",
      "--typeRoots",
      path.join(PLUGIN_ROOT, "scripts", "node_modules", "@types"),
      ...inputs,
    ],
    { cwd, encoding: "utf8" }
  );
}

it("keeps projected TypeScript bytes free of diff-check whitespace defects", () => {
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), "guild-projection-diff-check-"));
  try {
    const hostRuntime = buildModuleResourcePlan(PLUGIN_ROOT).find(
      (plan) => plan.module_id === "host-runtime"
    );
    expect(hostRuntime).toBeDefined();

    for (const entry of hostRuntime!.entries) {
      if (!entry.source_path.endsWith(".ts")) continue;

      const live = path.join(PLUGIN_ROOT, entry.source_path);
      const temporary = path.join(staged, entry.source_path);
      fs.mkdirSync(path.dirname(temporary), { recursive: true });
      fs.writeFileSync(temporary, fs.readFileSync(live));

      const diffCheck = spawnSync(
        "git",
        ["diff", "--no-index", "--check", "/dev/null", temporary],
        { encoding: "utf8" }
      );
      expect({
        path: entry.source_path,
        status: diffCheck.status,
        stdout: diffCheck.stdout,
        stderr: diffCheck.stderr,
      }).toEqual({
        path: entry.source_path,
        status: 1,
        stdout: "",
        stderr: "",
      });
    }
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
});

it("strictly compiles the lifecycle domain entrypoint the host adapters reach", () => {
  const compiled = compileStrict(PLUGIN_ROOT, [path.join("src", "domains", "lifecycle", "run-lifecycle.ts")]);
  expect({
    status: compiled.status,
    stdout: compiled.stdout,
    stderr: compiled.stderr,
  }).toEqual({ status: 0, stdout: "", stderr: "" });
});

it("projects the Claude, Codex, and Pi adapter dependency graph for source-tree and installed layouts", () => {
  const plans = buildModuleResourcePlan(PLUGIN_ROOT);
  const hostRuntime = plans.find((plan) => plan.module_id === "host-runtime");
  expect(hostRuntime).toBeDefined();

  const adapterEntries = HOST_ADAPTER_IDS.map((id) => {
    const entry = hostRuntime!.entries.find(
      (candidate) => candidate.category === "scripts" && candidate.id === id
    );
    expect(entry).toBeDefined();
    return entry!;
  });

  const sourceInputs = adapterEntries.map((entry) => entry.source_path);
  const sourceCompile = compileStrict(PLUGIN_ROOT, sourceInputs);
  expect({
    status: sourceCompile.status,
    stdout: sourceCompile.stdout,
    stderr: sourceCompile.stderr,
  }).toEqual({ status: 0, stdout: "", stderr: "" });

  const installed = fs.mkdtempSync(path.join(os.tmpdir(), "guild-projected-runtime-"));
  try {
    // The projector copies every planned surface file from its live path, exactly
    // as build-host-packages does, plus the domain tree those scripts import.
    for (const plan of plans) {
      for (const entry of plan.entries) {
        const to = path.join(installed, entry.source_path);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(PLUGIN_ROOT, entry.source_path), to);
      }
    }
    fs.cpSync(path.join(PLUGIN_ROOT, "src"), path.join(installed, "src"), {
      recursive: true,
    });

    const installedInputs = adapterEntries.map((entry) =>
      path.join(installed, entry.source_path)
    );
    const installedCompile = compileStrict(installed, installedInputs);
    expect({
      status: installedCompile.status,
      stdout: installedCompile.stdout,
      stderr: installedCompile.stderr,
    }).toEqual({ status: 0, stdout: "", stderr: "" });

    const mutated = installedInputs[0];
    const original = fs.readFileSync(mutated, "utf8");
    fs.writeFileSync(
      mutated,
      original.replace(
        'from "../host-adapter-contract"',
        'from "../host-adapter-contract-missing"'
      )
    );
    expect(compileStrict(installed, installedInputs).status).not.toBe(0);
  } finally {
    fs.rmSync(installed, { recursive: true, force: true });
  }
});
