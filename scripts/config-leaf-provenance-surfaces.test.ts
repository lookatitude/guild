/**
 * scripts/config-leaf-provenance-surfaces.test.ts
 *
 * Issue #145 — every provenance consumer reads the resolver's dotted-leaf map.
 * Fixture: workspace sets defaults.lifecycle_gate.enabled, the child project sets
 * a sibling (defaults.team.size) and a local override (defaults.lean_lead.enabled).
 * Each surface must label the workspace-only leaf [workspace], the project leaf
 * [project], the local leaf [project-local], and an untouched sibling [builtin].
 * Before #145 all four read [project] (or [project-local]) from the `defaults` block.
 */

import { describe, it, expect, afterAll } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { cmdUiSet } from "./config-cmd";
import { resolveSettings } from "./lib/settings-resolver";
import { defaultPreflightProbe, runStartPreflight } from "./lib/runstart-preflight";

const CONFIG_CMD = path.resolve(__dirname, "config-cmd.ts");
const ENV = { ...process.env, NODE_NO_WARNINGS: "1" } as NodeJS.ProcessEnv;

const TMPDIRS: string[] = [];
afterAll(() => {
  for (const d of TMPDIRS) fs.rmSync(d, { recursive: true, force: true });
});

function writeJson(filePath: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

function mkMixed(): string {
  const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-leaf-surf-"));
  TMPDIRS.push(wsRoot);
  const child = path.join(wsRoot, "child");
  writeJson(path.join(wsRoot, ".guild", "workspace.json"), {
    schema_version: "guild.workspace.v1",
    is_workspace: true,
    sub_guilds: [{ name: "child", path: "child", kind: "sub-guild" }],
  });
  writeJson(path.join(wsRoot, ".guild", "settings.json"), {
    defaults: { lifecycle_gate: { enabled: false } },
  });
  writeJson(path.join(child, ".guild", "settings.json"), { defaults: { team: { size: 7 } } });
  writeJson(path.join(child, ".guild", "settings.local.json"), {
    defaults: { lean_lead: { enabled: false } },
  });
  return child;
}

function runConfigCmd(args: string[]): { status: number; out: string } {
  const r = spawnSync("npx", ["tsx", CONFIG_CMD, ...args], { encoding: "utf8", env: ENV });
  return { status: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function lineFor(out: string, key: string): string | undefined {
  return out.split("\n").find((l) => l.trimStart().startsWith(`${key} = `));
}

const child = mkMixed();

describe("#145 — config show --sources prints per-leaf provenance", () => {
  const { status, out } = runConfigCmd(["show", "--sources", "--cwd", child]);

  it("exits 0", () => expect(status).toBe(0));

  it("labels each leaf with the layer its value came from", () => {
    expect(lineFor(out, "defaults.lifecycle_gate.enabled")).toMatch(/= false\s+\[workspace\]$/);
    expect(lineFor(out, "defaults.team.size")).toMatch(/= 7\s+\[project\]$/);
    expect(lineFor(out, "defaults.lean_lead.enabled")).toMatch(/= false\s+\[project-local\]$/);
    expect(lineFor(out, "defaults.auto_learn")).toMatch(/= false\s+\[builtin\]$/);
  });

  it("keeps the block summary line and prints workspace.mode once", () => {
    expect(lineFor(out, "defaults")).toContain("[project-local]");
    expect(out.split("\n").filter((l) => l.startsWith("workspace.mode = ")).length).toBe(1);
  });
});

describe("#145 — config ui sources reads the leaf map", () => {
  it("labels the workspace-only leaf [workspace]", () => {
    const { status, out } = runConfigCmd(["ui", "sources", "--cwd", child]);
    expect(status).toBe(0);
    expect(out).toMatch(/defaults\.lifecycle_gate\.enabled = false\s+\[workspace\]/);
    expect(out).toMatch(/defaults\.lean_lead\.enabled = false\s+\[project-local\]/);
    expect(out).toMatch(/defaults\.lifecycle_gate\.adhoc_activity_threshold = 20\s+\[builtin\]/);
  });
});

describe("#145 — ui set post-write reload reports the leaf layer", () => {
  it("prints [workspace] for a leaf the project never set", () => {
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      writes.push(String(s));
      return true;
    };
    let rc: number;
    try {
      rc = cmdUiSet(child, "defaults.lifecycle_gate.enabled", "false", "project", "claude-code-cli", "explicit", {
        persist: () => 0,
        reload: (cwd) => {
          const r = resolveSettings({ cwd });
          return { config: r.config as unknown as Record<string, unknown>, sources: r.sources };
        },
      });
    } finally {
      (process.stdout as unknown as { write: typeof orig }).write = orig;
    }
    const out = writes.join("");
    expect(rc).toBe(0);
    expect(out).toContain("defaults.lifecycle_gate.enabled = false  [workspace]");
  });
});

describe("#145 — run-start preflight source_chain carries leaves", () => {
  it("source_chain labels the workspace-only leaf [workspace]", () => {
    const r = runStartPreflight({ cwd: child, probe: defaultPreflightProbe(child) });
    expect(r.snapshot.source_chain["defaults.lifecycle_gate.enabled"]).toBe("workspace");
    expect(r.snapshot.source_chain["defaults.team.size"]).toBe("project");
    expect(r.snapshot.source_chain["defaults.lean_lead.enabled"]).toBe("project-local");
  });
});
