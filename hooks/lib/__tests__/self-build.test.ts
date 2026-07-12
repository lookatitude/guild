/**
 * hooks/lib/__tests__/self-build.test.ts
 *
 * Pins the self-build marker contract against REAL files, not fixtures —
 * the whole point of this module is that the marker previously drifted
 * silently (plugin/CLAUDE.md → AGENTS.md, 2026-06-21) and both maybe-reflect.ts
 * and bootstrap.sh kept grepping the stale location for months. A test that
 * only exercises hand-authored fixtures would not have caught that; these
 * tests read the actual repo files on disk.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { SELF_BUILD_MARKER, detectSelfBuild } from "../self-build.js";

// hooks/lib/__tests__ → hooks/lib → hooks → plugin (the real plugin repo root).
const PLUGIN_ROOT = path.resolve(__dirname, "..", "..", "..");

describe("self-build.ts — SELF_BUILD_MARKER against the REAL repo", () => {
  it("plugin/AGENTS.md on disk still contains the marker", () => {
    const agentsMd = path.join(PLUGIN_ROOT, "AGENTS.md");
    expect(fs.existsSync(agentsMd)).toBe(true);
    const content = fs.readFileSync(agentsMd, "utf8");
    expect(content).toContain(SELF_BUILD_MARKER);
  });

  it("plugin/CLAUDE.md on disk does NOT contain the marker (it is a shim — regression guard)", () => {
    const claudeMd = path.join(PLUGIN_ROOT, "CLAUDE.md");
    expect(fs.existsSync(claudeMd)).toBe(true);
    const content = fs.readFileSync(claudeMd, "utf8");
    expect(content).not.toContain(SELF_BUILD_MARKER);
    expect(content).toContain("@AGENTS.md");
  });

  it("detectSelfBuild(PLUGIN_ROOT) arms via the direct <root>/AGENTS.md branch", () => {
    const result = detectSelfBuild(PLUGIN_ROOT);
    expect(result.armed).toBe(true);
    expect(result.path).toBe(path.join(PLUGIN_ROOT, "AGENTS.md"));
  });
});

describe("self-build.ts — detectSelfBuild() umbrella + negative cases", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-self-build-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("arms via the <root>/plugin/AGENTS.md branch (umbrella workspace root)", () => {
    const pluginDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, "AGENTS.md"),
      `# ${SELF_BUILD_MARKER}\n\nbody\n`,
      "utf8",
    );

    const result = detectSelfBuild(tmpDir);
    expect(result.armed).toBe(true);
    expect(result.path).toBe(path.join(pluginDir, "AGENTS.md"));
  });

  it("does NOT arm when neither AGENTS.md location exists", () => {
    const result = detectSelfBuild(tmpDir);
    expect(result.armed).toBe(false);
    expect(result.path).toBeNull();
  });

  it("does NOT arm when AGENTS.md exists but lacks the marker (a consuming repo's own AGENTS.md)", () => {
    fs.writeFileSync(
      path.join(tmpDir, "AGENTS.md"),
      "# Some other project\n\nnothing to see here\n",
      "utf8",
    );
    const result = detectSelfBuild(tmpDir);
    expect(result.armed).toBe(false);
  });

  it("prefers the direct <root>/AGENTS.md branch over the nested plugin/ branch", () => {
    fs.writeFileSync(
      path.join(tmpDir, "AGENTS.md"),
      `# ${SELF_BUILD_MARKER}\n`,
      "utf8",
    );
    const pluginDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, "AGENTS.md"),
      `# ${SELF_BUILD_MARKER}\n`,
      "utf8",
    );
    const result = detectSelfBuild(tmpDir);
    expect(result.path).toBe(path.join(tmpDir, "AGENTS.md"));
  });
});

describe("self-build.ts — bootstrap.sh mirrors the SAME marker literal", () => {
  it("bootstrap.sh's SELF_BUILD_MARKER bash literal matches the TS constant", () => {
    const bootstrapPath = path.join(PLUGIN_ROOT, "hooks", "bootstrap.sh");
    const content = fs.readFileSync(bootstrapPath, "utf8");
    const m = content.match(/SELF_BUILD_MARKER="([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe(SELF_BUILD_MARKER);
  });

  it("bootstrap.sh checks BOTH the direct and nested AGENTS.md paths", () => {
    const bootstrapPath = path.join(PLUGIN_ROOT, "hooks", "bootstrap.sh");
    const content = fs.readFileSync(bootstrapPath, "utf8");
    expect(content).toContain('${PWD}/AGENTS.md');
    expect(content).toContain('${PWD}/plugin/AGENTS.md');
  });
});
