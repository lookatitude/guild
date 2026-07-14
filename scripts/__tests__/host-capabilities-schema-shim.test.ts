import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/host-capabilities-schema";
import { planWrapperInvocation } from "../lib/guild-run-wrapper";
import * as moduleImpl from "../../src/modules/host-runtime/workflows/host-capabilities-schema";

describe("host-capabilities-schema compatibility shim", () => {
  test("scripts/lib/host-capabilities-schema re-exports src/modules/host-runtime", () => {
    expect(shim.CLAUDE_CAPABILITIES).toBe(moduleImpl.CLAUDE_CAPABILITIES);
    expect(shim.CODEX_CAPABILITIES).toBe(moduleImpl.CODEX_CAPABILITIES);
    expect(shim.AGENTS_FILE_CAPABILITIES).toBe(moduleImpl.AGENTS_FILE_CAPABILITIES);
    expect(shim.REQUIRED_HOOK_EVENTS).toBe(moduleImpl.REQUIRED_HOOK_EVENTS);
    expect(shim.validateHostCapabilitiesV1).toBe(moduleImpl.validateHostCapabilitiesV1);
    expect(shim.isHostCapabilitiesV1).toBe(moduleImpl.isHostCapabilitiesV1);
  });

  test("only the module file defines the capability row body", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/host-capabilities-schema.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/host-runtime/workflows/host-capabilities-schema.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/host-runtime\/workflows\/host-capabilities-schema["']/);
    expect(oldPath).not.toMatch(/export\s+const\s+CLAUDE_CAPABILITIES/);
    expect(modulePath).toMatch(/export\s+const\s+CLAUDE_CAPABILITIES/);
  });

  test("the legacy HOST_CAPABILITY_ROWS aggregate is retired, not just unreferenced", () => {
    // Consumer-free since guild-run-wrapper.ts/permission-policy.ts moved to
    // host-registry.ts's registry-derived DERIVED_HOST_CAPABILITY_ROWS. Assert the
    // export is actually gone (a real retirement), not merely unused in this file.
    expect((shim as Record<string, unknown>)["HOST_CAPABILITY_ROWS"]).toBeUndefined();
    expect((moduleImpl as Record<string, unknown>)["HOST_CAPABILITY_ROWS"]).toBeUndefined();
  });

  test("agents-file has a conservative file-surface capability row", () => {
    const row = shim.AGENTS_FILE_CAPABILITIES;
    expect(shim.validateHostCapabilitiesV1(row)).toEqual({ valid: true, errors: [] });
    expect(row).toMatchObject({
      host_kind: "agents-file",
      family: "agents",
      surface_kind: "file",
      package: { installable: false, installability: "target", manifest_format: "agents-file" },
      dispatch: { plain_processes: false, tmux_processes: false, inline: false },
      interaction: { file_bus_questions: true },
    });
  });

  test("agents-file wrapper planning is explicit and degraded, not guessed", () => {
    const plan = planWrapperInvocation({
      host: "agents-file",
      mode: "auto",
      cwd: "/tmp/guild-agents-package",
      bootstrap: "Guild bootstrap",
      prompt: "verify agents",
    });

    expect(plan.host).toBe("agents-file");
    expect(plan.command).toBe("agents-file");
    expect(plan.args).toContain("verify agents");
    expect(plan.launch).toMatchObject({
      requested: "auto",
      effective: "auto",
      degraded: true,
    });
    expect(plan.bootstrap).toMatchObject({
      method: "instruction_file",
      via: "instruction_file",
    });
    expect(plan.bootstrap.files).toEqual([{ path: "AGENTS.md", content: "Guild bootstrap" }]);
  });
});
