import { it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { createRunLifecycle, createRealEnv, StackFacade, type StagedRunStart, type StartRunOpts } from "../../src/domains/lifecycle";
import { inShareSet } from "../../src/domains/security";
import { stackValidator } from "../../scripts/lib/stack-contract-validator";

const text = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const digest = (value: string | Buffer) => "sha256:" + createHash("sha256").update(value).digest("hex");
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "guild-a08-independent-")), root = path.join(home, "project"), pkg = path.join(home, "package");
  const put = (relative: string, bytes: string) => { const p = path.join(root, relative); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); };
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  put(".guild/guild.yaml", "schema_version: guild.root.v1\nkind: project\n"); put(".guild/storage-layout.json", text({ storage_layout_version: 2 })); put(".guild/config/project.json", text({ advisorRounds: 2, tiers: { default: "mid" } }));
  put(".guild/runs/current-run-id", "run-20261025-220000-parent-orchestrator\n");
  fs.mkdirSync(path.join(pkg, ".claude-plugin"), { recursive: true }); fs.mkdirSync(path.join(pkg, "runtime/scripts"), { recursive: true });
  fs.writeFileSync(path.join(pkg, ".claude-plugin/plugin.json"), text({ name: "guild", version: "3.2.0-beta.1" })); fs.writeFileSync(path.join(pkg, "guild.inventory.json"), text({ schema_version: "guild.inventory.v1", plugin_version: "3.2.0-beta.1", manifest: { name: "guild", version: "3.2.0-beta.1" }, scripts: [{ id: "stack-operations", kind: "cli" }] })); fs.writeFileSync(path.join(pkg, "runtime/scripts/stack-operations.js"), "source-only package identity fixture");
  const previous = process.env.GUILD_STATE_HOME; process.env.GUILD_STATE_HOME = path.join(home, "private-state");
  const env = createRealEnv(root, requested => ({ requested, resolved: "codex" })); env.now = () => "2026-10-25T23:30:00.000Z";
  const lifecycle = createRunLifecycle(env);
  const opts: StartRunOpts = { command: "/guild:build", arguments: { brief: "Independent staged fixture" }, cwd: root, root, target_kind: "existing_guild_project", workspace: { is_workspace: false, root }, project: "qa-fixture", host_requested: "codex", model_tier_policy: "explicit", ignore_policy: "project", scan_policy: "none", initiative: null, session_identity: { envelope_host: "codex", active_model: "local-no-model-fixture" } };
  const files = (base = root): Record<string, string> => { const found: Record<string, string> = {}; const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) found[path.relative(base, p)] = digest(fs.readFileSync(p)); } }; walk(base); return found; };
  const facade = () => new StackFacade({ root, packageRoot: pkg, validate: stackValidator() });
  return { home, root, env, lifecycle, opts, put, files, facade, close() { if (previous === undefined) delete process.env.GUILD_STATE_HOME; else process.env.GUILD_STATE_HOME = previous; fs.rmSync(home, { recursive: true, force: true }); } };
}
function test(name: string, run: (f: ReturnType<typeof fixture>) => void) { it(name, () => { const f = fixture(); try { run(f); } finally { f.close(); } }); }
function reseal(plan: StagedRunStart) { const { digest: _digest, ...body } = plan; plan.digest = digest(JSON.stringify(body)); }

test("A08 detached lifecycle JSON replay preserves the actual parent intake sentinel and source bytes outside its run", f => {
  const before = f.files(), plan = f.lifecycle.stageRunStart(f.opts, { detached: true });
  expect(f.files()).toEqual(before);
  const copy: StagedRunStart = JSON.parse(JSON.stringify(plan));
  expect(f.lifecycle.materializeRunStart(copy)).toBe(plan.run_id);
  const own = path.join(".guild/runs", plan.run_id) + path.sep;
  const outside = Object.fromEntries(Object.entries(f.files()).filter(([name]) => !name.startsWith(own)));
  expect(outside).toEqual(before); expect(fs.readFileSync(path.join(f.root, ".guild/runs/current-run-id"), "utf8")).toBe("run-20261025-220000-parent-orchestrator\n");
  for (const file of plan.files) expect(digest(fs.readFileSync(path.join(f.root, file.path)))).toBe(digest(file.bytes));
});

for (const kind of ["file", "directory"]) test("A08 rehashed private stage " + kind + " escape refuses without publishing any bytes", f => {
  const plan = f.lifecycle.stageRunStart(f.opts, { detached: true }), before = f.files();
  if (kind === "file") plan.files[0].path = "../escaped-independent.txt"; else plan.directories.push("../escaped-independent");
  reseal(plan); expect(() => f.lifecycle.materializeRunStart(plan)).toThrow(); expect(f.files()).toEqual(before); expect(fs.existsSync(path.join(f.home, kind === "file" ? "escaped-independent.txt" : "escaped-independent"))).toBe(false);
});

test("A08 existing lifecycle private records stay excluded from both default and payload-enabled share sets", f => {
  const plan = f.lifecycle.stageRunStart(f.opts, { detached: true }); f.lifecycle.materializeRunStart(plan);
  const runDir = path.join(f.root, ".guild/runs", plan.run_id), binding = JSON.parse(fs.readFileSync(path.join(runDir, "binding.json"), "utf8"));
  expect(binding.binding_ref === plan.private_binding_ref).toBe(true);
  for (const includePayloads of [false, true]) {
    expect(inShareSet("binding.json", includePayloads)).toBe(false); expect(inShareSet("session-context.json", includePayloads)).toBe(false);
    const shared = Object.keys(f.files(runDir)).filter(name => inShareSet(name, includePayloads));
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.some(name => fs.readFileSync(path.join(runDir, name), "utf8").includes(plan.private_binding_ref))).toBe(false);
  }
});

for (const privateFile of ["binding.json", "session-context.json"]) test("A08 public artifact selector does not expose existing private lifecycle nonce from " + privateFile, f => {
  const plan = f.lifecycle.stageRunStart(f.opts, { detached: true }); f.lifecycle.materializeRunStart(plan);
  const facade = f.facade(), session = facade.dispatch({ action: "bind" });
  const read = (operation: string, target?: unknown, query?: string) => facade.dispatch({ action: "read", schema_version: "guild.stack.p05.read_request.v1", session_id: session.session_id, source_id: session.root.source_id, operation, arguments: { ...(target ? { target } : {}), ...(query ? { query } : {}), cursor: null, limit: 50 } });
  const run = read("run.list").items.find((item: any) => item.ref.id === plan.run_id); expect(run).toBeDefined();
  let published: unknown;
  try { published = read("run.artifacts", run.ref, "runs/" + plan.run_id + "/" + privateFile); }
  catch (error) { expect((error as { code?: string }).code).toBe("invalid_artifact"); return; }
  expect(JSON.stringify(published).includes(plan.private_binding_ref)).toBe(false);
});

test("A08 other public run inventories, details, artifact browse and trace do not publish private binding bytes", f => {
  const plan = f.lifecycle.stageRunStart(f.opts, { detached: true }); f.lifecycle.materializeRunStart(plan);
  const facade = f.facade(), session = facade.dispatch({ action: "bind" }), base = { session_id: session.session_id, source_id: session.root.source_id };
  const read = (operation: string, target?: unknown) => facade.dispatch({ action: "read", schema_version: "guild.stack.p05.read_request.v1", ...base, operation, arguments: { ...(target ? { target } : {}), cursor: null, limit: 50 } });
  const list = read("run.list"), run = list.items.find((item: any) => item.ref.id === plan.run_id);
  const surfaces = [facade.dispatch({ action: "list", ...base, collection: "run", limit: 50 }), facade.dispatch({ action: "inspect", ...base, collection: "run", entity_id: plan.run_id }), list, read("run.inspect", run.ref), read("run.artifacts", run.ref), read("run.trace", run.ref)];
  for (const published of surfaces) expect(JSON.stringify(published).includes(plan.private_binding_ref)).toBe(false);
  const entries = surfaces[4].items[0].data.entries;
  expect(entries.some((entry: any) => /(?:^|\/)(?:binding|session-context)\.json$/.test(entry.evidence.path))).toBe(false);
  const foreign = { ...run.ref, source_id: "foreign-source" }; expect(() => read("run.inspect", foreign)).toThrow();
});

test("A08 private lifecycle names remain absent from every bounded page of a large artifact browse", f => {
  const plan = f.lifecycle.stageRunStart(f.opts, { detached: true }); f.lifecycle.materializeRunStart(plan);
  for (let n = 0; n < 205; n++) f.put(".guild/runs/" + plan.run_id + "/browse/record-" + String(n).padStart(3, "0") + ".txt", "Safe independent artifact\n");
  const facade = f.facade(), session = facade.dispatch({ action: "bind" }), base = { session_id: session.session_id, source_id: session.root.source_id };
  const read = (operation: string, target?: unknown, cursor: string | null = null) => facade.dispatch({ action: "read", schema_version: "guild.stack.p05.read_request.v1", ...base, operation, arguments: { ...(target ? { target } : {}), cursor, limit: 50 } });
  const run = read("run.list").items.find((item: any) => item.ref.id === plan.run_id);
  let cursor: string | null = null, count = 0, pages = 0;
  do {
    const page = read("run.artifacts", run.ref, cursor), entries = page.items[0].data.entries;
    expect(entries.length).toBeLessThanOrEqual(50); expect(entries.some((entry: any) => /(?:^|\/)(?:binding|session-context)\.json$/.test(entry.evidence.path))).toBe(false); expect(JSON.stringify(page).includes(plan.private_binding_ref)).toBe(false);
    count += entries.length; cursor = page.next_cursor; pages++; expect(pages).toBeLessThan(10);
  } while (cursor);
  expect(count).toBeGreaterThanOrEqual(205); expect(pages).toBeGreaterThan(1);
});
