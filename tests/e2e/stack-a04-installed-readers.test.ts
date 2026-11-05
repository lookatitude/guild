/**
 * A04 installed old/new reader matrix (AT02) and reader rollback (AT47, reader half).
 * Both packages are assembled outside the checkout and run with plain `node`.
 * OLD_PACKAGE_COMMIT is the last package without the A04 reader (E00 head);
 * re-pin it to the E00 merge commit when this branch is rebased onto next.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createRealEnv, createRunLifecycle, type StartRunOpts } from "../../src/domains/lifecycle";

const OLD_PACKAGE_COMMIT = "d2c35f1f";
const PLUGIN = path.resolve(__dirname, "../..");
const PACKAGE_PATHS = [".claude-plugin/plugin.json", "guild.inventory.json", "runtime/scripts/stack-operations.js"];
const parity = JSON.parse(fs.readFileSync(path.join(PLUGIN, "tests/fixtures/stack-contract-reader/parity.generated.json"), "utf8"));
const digest = (b: string | Buffer) => "sha256:" + createHash("sha256").update(b).digest("hex");
const text = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

let home = "", root = "", install = "", oldPkg = "", newPkg = "", state = "", runId = "";
function tree(base: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) out[path.relative(base, p)] = digest(fs.readFileSync(p)); } };
  walk(base);
  return out;
}
function installFrom(source: string) {
  fs.rmSync(install, { recursive: true, force: true });
  fs.cpSync(source, install, { recursive: true });
}
function call(request: unknown): any {
  const r = spawnSync("node", [path.join(install, "runtime/scripts/stack-operations.js"), "--cwd", root], {
    input: JSON.stringify(request), encoding: "utf8", cwd: home,
    env: { PATH: process.env.PATH ?? "", HOME: home, GUILD_STATE_HOME: state },
  });
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}
const row = (origin: string, schema: string, accepted: boolean) =>
  parity.v2.find((r: any) => r.origin === origin && r.schema === schema && (r.schema_valid && !r.semantic_errors.length) === accepted);
const v1Doc = parity.v1.find((r: any) => r.contract === "read-projection" && r.valid).instance;
const v2Doc = row("golden-document", "run-analysis", true).instance;
const v2Bad = parity.v2.find((r: any) => r.origin === "golden-refusal" && r.semantic_errors.length).instance;
const allVersions = [v1Doc.schema_version, v2Doc.schema_version, v2Bad.schema_version];

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "guild-a04-installed-"));
  root = path.join(home, "project"); install = path.join(home, "install", "guild"); state = path.join(home, "private-state");
  oldPkg = path.join(home, "pkg-old"); newPkg = path.join(home, "pkg-new");
  try { execFileSync("git", ["cat-file", "-e", OLD_PACKAGE_COMMIT + "^{commit}"], { cwd: PLUGIN, stdio: "ignore" }); }
  catch { throw new Error("OLD_PACKAGE_COMMIT " + OLD_PACKAGE_COMMIT + " is not in history; re-pin it to the pre-A04 package commit"); }
  for (const rel of PACKAGE_PATHS) {
    const o = path.join(oldPkg, rel), n = path.join(newPkg, rel);
    fs.mkdirSync(path.dirname(o), { recursive: true }); fs.mkdirSync(path.dirname(n), { recursive: true });
    fs.writeFileSync(o, execFileSync("git", ["show", OLD_PACKAGE_COMMIT + ":" + rel], { cwd: PLUGIN, maxBuffer: 1 << 28 }));
    fs.copyFileSync(path.join(PLUGIN, rel), n);
  }
  const put = (rel: string, bytes: string) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); };
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  put(".guild/guild.yaml", "schema_version: guild.root.v1\nkind: project\n");
  put(".guild/storage-layout.json", text({ storage_layout_version: 2 }));
  put(".guild/config/project.json", text({ advisorRounds: 2, tiers: { default: "mid" } }));
  // A real v1 run record, produced by the current lifecycle, for every installed reader to consume.
  const previous = process.env.GUILD_STATE_HOME; process.env.GUILD_STATE_HOME = state;
  try {
    const env = createRealEnv(root, (requested) => ({ requested, resolved: "codex" })); env.now = () => "2026-10-25T23:30:00.000Z";
    const opts: StartRunOpts = { command: "/guild:build", arguments: { brief: "A04 v1 run fixture" }, cwd: root, root, target_kind: "existing_guild_project", workspace: { is_workspace: false, root }, project: "a04-fixture", host_requested: "codex", model_tier_policy: "explicit", ignore_policy: "project", scan_policy: "none", initiative: null, session_identity: { envelope_host: "codex", active_model: "local-no-model-fixture" } };
    const lifecycle = createRunLifecycle(env);
    runId = lifecycle.materializeRunStart(lifecycle.stageRunStart(opts, { detached: true }));
  } finally { if (previous === undefined) delete process.env.GUILD_STATE_HOME; else process.env.GUILD_STATE_HOME = previous; }
  // A v2 artifact already on disk at its versioned home (storage-contract v2); readers must leave it untouched.
  put(".guild/analysis/runs/run-gf1/versions/analysis-run-gf1/analysis.json", text(v2Doc));
});
afterAll(() => { if (home) fs.rmSync(home, { recursive: true, force: true }); });

const opsOf = (manifest: any) => manifest.operations.map((o: any) => [o.id, o.availability, o.entry_id]);
/** v1 read surfaces over the materialized run; session-scoped ids are normalized for old/new comparison. */
function v1Reads(): { docs: any[]; normalized: string } {
  const session = call({ action: "bind" });
  const base = { session_id: session.session_id, source_id: session.root.source_id };
  const list = call({ action: "list", ...base, collection: "run", limit: 50 });
  const inspect = call({ action: "inspect", ...base, collection: "run", entity_id: runId });
  const docs = [session, list, inspect];
  const normalized = JSON.stringify([list, inspect]).split(session.session_id).join("<session>").replace(/"observed_at":"[^"]*"/g, '"observed_at":"<clock>"');
  return { docs, normalized };
}
const consumed: Record<string, { docs: any[]; normalized: string }> = {};

describe("A04 installed old/new reader matrix", () => {
  let oldOps: unknown, before: Record<string, string>;
  it("packages are outside the checkout and differ only by the A04 reader", () => {
    expect(path.relative(PLUGIN, install).startsWith("..")).toBe(true);
    expect(tree(oldPkg)["runtime/scripts/stack-operations.js"]).not.toBe(tree(newPkg)["runtime/scripts/stack-operations.js"]);
    expect(fs.readFileSync(path.join(oldPkg, "runtime/scripts/stack-operations.js"), "utf8").includes("guild.stack.negotiation.v2")).toBe(false);
  });
  it("old installed reader consumes v1 and refuses the v2 surface with a structured error", () => {
    before = tree(root);
    installFrom(oldPkg);
    const session = call({ action: "bind" });
    expect(session.schema_version).toBe("guild.stack.scope-session.v1");
    const caps = call({ action: "capabilities", session_id: session.session_id });
    expect([caps.schema_version, caps.protocol_major]).toEqual(["guild.stack.capability-manifest.v1", 1]);
    oldOps = opsOf(caps);
    consumed.old = v1Reads();
    expect(consumed.old.docs.map((d) => d.schema_version)).toEqual(["guild.stack.scope-session.v1", "guild.stack.read-projection.v1", "guild.stack.read-projection.v1"]);
    expect(consumed.old.normalized.includes(runId)).toBe(true);
    for (const req of [{ action: "negotiate", request_id: "n", client_supported: ["guild.run_analysis.v2"] }, { action: "read_contract", request_id: "r", accept: allVersions, document: v2Doc }])
      expect(call(req).error.code).toBe("unknown_action");
    expect(tree(root)).toEqual(before);
  });
  it("new installed reader keeps the v1 surface byte-compatible and enables no writer", () => {
    installFrom(newPkg);
    const session = call({ action: "bind" });
    expect(session.schema_version).toBe("guild.stack.scope-session.v1");
    const caps = call({ action: "capabilities", session_id: session.session_id });
    expect(caps.schema_version).toBe("guild.stack.capability-manifest.v1");
    expect(opsOf(caps)).toEqual(oldOps);
    expect(JSON.stringify(caps).includes(".v2")).toBe(false);
    consumed.new = v1Reads();
    expect(consumed.new.normalized).toBe(consumed.old.normalized);
  });
  it("new installed reader accepts every v1 document the old installed reader produced (frozen v1 schema + semantics)", () => {
    for (const doc of [...consumed.old.docs, ...consumed.new.docs])
      expect(call({ action: "read_contract", request_id: "v1-out", accept: [doc.schema_version], document: doc })).toEqual(doc);
  });
  it("new installed reader negotiates v1/v2 explicitly", () => {
    const v2 = call({ action: "negotiate", request_id: "n1", client_supported: ["guild.run_analysis.v2", "guild.stack.read-projection.v1"] });
    expect([v2.schema_version, v2.status, v2.selected_schema_version]).toEqual(["guild.stack.negotiation.v2", "compatible", "guild.run_analysis.v2"]);
    const v1 = call({ action: "negotiate", request_id: "n2", client_supported: ["guild.stack.read-projection.v1"] });
    expect(v1.selected_schema_version).toBe("guild.stack.read-projection.v1");
    const none = call({ action: "negotiate", request_id: "n3", client_supported: ["guild.run_analysis.v9"] });
    expect([none.status, none.error.code]).toEqual(["unsupported", "unsupported_schema"]);
  });
  it("new installed reader reads old (v1) and new (v2) fixtures and refuses invalid or un-negotiated v2", () => {
    expect(call({ action: "read_contract", request_id: "r1", accept: [v1Doc.schema_version], document: v1Doc })).toEqual(v1Doc);
    expect(call({ action: "read_contract", request_id: "r2", accept: [v2Doc.schema_version], document: v2Doc })).toEqual(v2Doc);
    const bad = call({ action: "read_contract", request_id: "r3", accept: allVersions, document: v2Bad });
    expect([bad.schema_version, bad.code]).toEqual(["guild.stack.refusal.v2", "invalid_request"]);
    const unneg = call({ action: "read_contract", request_id: "r4", accept: [v1Doc.schema_version], document: v2Doc });
    expect([unneg.schema_version, unneg.code]).toEqual(["guild.stack.refusal.v2", "unsupported_schema"]);
    const extra = call({ action: "read_contract", request_id: "r5", accept: allVersions, document: v2Doc, write: true });
    expect(extra.code).toBe("invalid_request");
    for (const id of ["uri-16", "uri-17"]) {
      const edge = parity.v2.find((r: any) => r.id === id);
      expect(call({ action: "read_contract", request_id: "edge", accept: [edge.instance.schema_version], document: edge.instance })).toEqual(edge.instance);
    }
    for (const id of ["uri-0", "uri-20", "uri-21", "date-time-1", "submillisecond-interval-0"]) {
      const edge = parity.v2.find((r: any) => r.id === id);
      expect(edge.schema_valid && !edge.semantic_errors.length).toBe(false);
      expect(call({ action: "read_contract", request_id: "edge", accept: [edge.instance.schema_version], document: edge.instance }).code).toBe("invalid_request");
    }
    for (const action of [["read_contract"], { toString: null }, 1])
      expect(call({ action, request_id: "r7", accept: allVersions, document: v2Doc }).error?.code).toBe("invalid_request");
    expect(tree(root)).toEqual(before);
  });
  it("AT47 rollback to the old reader hides v2 controls without deleting or rewriting v2 evidence", () => {
    installFrom(oldPkg);
    expect(call({ action: "negotiate", request_id: "n4", client_supported: ["guild.run_analysis.v2"] }).error.code).toBe("unknown_action");
    const session = call({ action: "bind" });
    expect(opsOf(call({ action: "capabilities", session_id: session.session_id }))).toEqual(oldOps);
    expect(v1Reads().normalized).toBe(consumed.old.normalized);
    expect(tree(root)).toEqual(before);
    expect(JSON.parse(fs.readFileSync(path.join(root, ".guild/analysis/runs/run-gf1/versions/analysis-run-gf1/analysis.json"), "utf8"))).toEqual(v2Doc);
  });
  it("AT47 re-upgrade after rollback is idempotent", () => {
    installFrom(newPkg);
    expect(call({ action: "read_contract", request_id: "r6", accept: [v2Doc.schema_version], document: v2Doc })).toEqual(v2Doc);
    expect(tree(root)).toEqual(before);
  });
});
