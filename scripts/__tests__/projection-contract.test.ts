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

it("keeps generated TypeScript projection bytes free of diff-check whitespace defects", () => {
  const projectedRuntime = fs.mkdtempSync(
    path.join(os.tmpdir(), "guild-projection-diff-check-")
  );
  try {
    const hostRuntime = buildModuleResourcePlan(PLUGIN_ROOT).find(
      (plan) => plan.module_id === "host-runtime"
    );
    expect(hostRuntime).toBeDefined();

    for (const entry of hostRuntime!.entries) {
      if (!entry.resource_path.endsWith(".ts")) continue;

      const projected = path.join(
        PLUGIN_ROOT,
        "src",
        "modules",
        "host-runtime",
        entry.resource_path
      );
      const temporary = path.join(projectedRuntime, entry.resource_path);
      fs.mkdirSync(path.dirname(temporary), { recursive: true });
      fs.writeFileSync(temporary, fs.readFileSync(projected));

      const diffCheck = spawnSync(
        "git",
        ["diff", "--no-index", "--check", "/dev/null", temporary],
        { encoding: "utf8" }
      );
      expect({
        path: entry.resource_path,
        status: diffCheck.status,
        stdout: diffCheck.stdout,
        stderr: diffCheck.stderr,
      }).toEqual({
        path: entry.resource_path,
        status: 1,
        stdout: "",
        stderr: "",
      });
    }
  } finally {
    fs.rmSync(projectedRuntime, { recursive: true, force: true });
  }
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

  const sourceInputs = adapterEntries.map((entry) =>
    path.join("src", "modules", "host-runtime", entry.resource_path)
  );
  const sourceCompile = compileStrict(PLUGIN_ROOT, sourceInputs);
  expect({
    status: sourceCompile.status,
    stdout: sourceCompile.stdout,
    stderr: sourceCompile.stderr,
  }).toEqual({ status: 0, stdout: "", stderr: "" });

  const installed = fs.mkdtempSync(path.join(os.tmpdir(), "guild-projected-runtime-"));
  try {
    for (const plan of plans) {
      for (const entry of plan.entries) {
        const from = path.join(
          PLUGIN_ROOT,
          "src",
          "modules",
          plan.module_id,
          entry.resource_path
        );
        const to = path.join(installed, entry.source_path);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
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
