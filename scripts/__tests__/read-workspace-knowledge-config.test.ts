/**
 * scripts/__tests__/read-workspace-knowledge-config.test.ts
 *
 * SC-D — workspace-knowledge config reader (B1 contract §3 schema delta).
 *
 * Covers the three additive keys, all default-safe-when-absent:
 *   - workspace.json: workspace_knowledge (default true), learn_fanout
 *     (default "auto"), root_wiki UNCHANGED (default false).
 *   - settings.json: record_status_runs (default true).
 *   - Reader is lenient: missing files, missing keys, malformed values all
 *     resolve to the documented defaults without throwing.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  readWorkspaceKnowledgeConfig,
  readRecordStatusRuns,
} from "../lib/run-lifecycle";

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-wkconfig-"));
}

function writeWorkspace(root: string, obj: Record<string, unknown>): void {
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "workspace.json"), JSON.stringify(obj, null, 2));
}

function writeSettings(root: string, obj: Record<string, unknown>): void {
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify(obj, null, 2));
}

describe("readWorkspaceKnowledgeConfig (SC-D)", () => {
  const tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  it("returns safe defaults when workspace.json is absent", () => {
    const cfg = readWorkspaceKnowledgeConfig(mkRoot());
    expect(cfg.root_wiki).toBe(false);
    expect(cfg.workspace_knowledge).toBe(true);
    expect(cfg.learn_fanout).toBe("auto");
  });

  it("reads explicit values verbatim", () => {
    const root = mkRoot();
    writeWorkspace(root, {
      schema_version: "guild.workspace.v1",
      is_workspace: true,
      root_wiki: false,
      workspace_knowledge: true,
      learn_fanout: "plan-only",
    });
    const cfg = readWorkspaceKnowledgeConfig(root);
    expect(cfg.root_wiki).toBe(false);
    expect(cfg.workspace_knowledge).toBe(true);
    expect(cfg.learn_fanout).toBe("plan-only");
  });

  it("workspace_knowledge defaults true when the key is absent", () => {
    const root = mkRoot();
    writeWorkspace(root, { schema_version: "guild.workspace.v1", root_wiki: true });
    const cfg = readWorkspaceKnowledgeConfig(root);
    expect(cfg.root_wiki).toBe(true);
    expect(cfg.workspace_knowledge).toBe(true);
  });

  it("learn_fanout falls back to auto on a malformed value", () => {
    const root = mkRoot();
    writeWorkspace(root, { learn_fanout: "garbage" });
    expect(readWorkspaceKnowledgeConfig(root).learn_fanout).toBe("auto");
  });

  it("is lenient on a malformed workspace.json (returns defaults)", () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "workspace.json"), "{ not json");
    const cfg = readWorkspaceKnowledgeConfig(root);
    expect(cfg.workspace_knowledge).toBe(true);
    expect(cfg.learn_fanout).toBe("auto");
  });
});

describe("readRecordStatusRuns (SC-B §5)", () => {
  const tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  it("defaults true when settings.json is absent", () => {
    expect(readRecordStatusRuns(mkRoot())).toBe(true);
  });

  it("defaults true when the key is absent", () => {
    const root = mkRoot();
    writeSettings(root, { rigor: "standard" });
    expect(readRecordStatusRuns(root)).toBe(true);
  });

  it("reads an explicit false (the OQ6 rollback)", () => {
    const root = mkRoot();
    writeSettings(root, { record_status_runs: false });
    expect(readRecordStatusRuns(root)).toBe(false);
  });

  it("is lenient on a malformed settings.json (returns default true)", () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "settings.json"), "{ bad");
    expect(readRecordStatusRuns(root)).toBe(true);
  });
});
