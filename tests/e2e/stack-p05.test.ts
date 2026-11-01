import { it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { StackFacade } from "../../src/domains/lifecycle";
import { stackValidator } from "../../scripts/lib/stack-contract-validator";

type A = any;
let serial = 0;
const bytes = (v: A) => JSON.stringify(v, null, 2) + "\n";
const hash = (v: string | Buffer) => "sha256:" + createHash("sha256").update(v).digest("hex");
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "guild-independent-p05-"));
  const root = path.join(home, "project"), pkg = path.join(home, "package");
  const put = (rel: string, v: A) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof v === "string" ? v : bytes(v)); };
  put(".guild/guild.yaml", "schema_version: guild.root.v1\nkind: project\n");
  put(".guild/storage-layout.json", { storage_layout_version: 2 });
  put(".guild/config/project.json", { advisorRounds: 2, tiers: { default: "mid" } });
  fs.mkdirSync(path.join(pkg, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "runtime/scripts"), { recursive: true });
  fs.writeFileSync(path.join(pkg, ".claude-plugin/plugin.json"), bytes({ name: "guild", version: "3.2.0-beta.1" }));
  fs.writeFileSync(path.join(pkg, "guild.inventory.json"), bytes({ schema_version: "guild.inventory.v1", plugin_version: "3.2.0-beta.1", manifest: { name: "guild", version: "3.2.0-beta.1" }, scripts: [{ id: "stack-operations", kind: "cli" }] }));
  fs.writeFileSync(path.join(pkg, "runtime/scripts/stack-operations.js"), "source test package identity fixture");
  const oldState = process.env.GUILD_STATE_HOME;
  process.env.GUILD_STATE_HOME = path.join(home, "private-state");
  const make = () => new StackFacade({ root, packageRoot: pkg, validate: stackValidator() });
  let facade = make();
  let session = facade.dispatch({ action: "bind" });
  const read = (operation: string, target?: A, options: A = {}) => facade.dispatch({ action: "read", schema_version: "guild.stack.p05.read_request.v1", session_id: session.session_id, source_id: session.root.source_id, operation, arguments: { ...(target ? { target } : {}), cursor: null, limit: 50, ...options } });
  const preview = (operation: string, args: A, targets: A[] = [], key = "preview-" + (++serial)) => facade.dispatch({ action: "preview", request: { session_id: session.session_id, source_id: session.root.source_id, operation, arguments: args, targets, idempotency_key: key } });
  const decide = (p: A, decision = "approved") => facade.dispatch({ action: "decide", operation_id: p.operation_id, request: { session_id: session.session_id, preview_hash: p.preview_hash, decision, rationale: "Independent acceptance fixture" } });
  const apply = (p: A, key = "apply-" + (++serial)) => facade.dispatch({ action: "apply", operation_id: p.operation_id, request: { session_id: session.session_id, preview_hash: p.preview_hash, idempotency_key: key } });
  const execute = (operation: string, args: A, targets: A[] = []) => { const p = preview(operation, args, targets); decide(p); return apply(p); };
  const create = () => { const r = execute("initiative.create", { title: "Independent QA", body: "Fixture summary", owner: "operator", acceptance: ["Acceptance condition"] }); return read("initiative.inspect", r.after[0]).items[0]; };
  const current = (id: string) => read("initiative.list").items.find((i: A) => i.ref.id === id);
  const revision = (i: A, change: A = {}) => ({ schema_version: "guild.stack.initiative_revision.v1", manifest: { ...i.data.manifest }, definition_items: i.data.definition_items, work_items: i.data.work_items, close_gate: i.data.close_gate, ...change });
  const revise = (i: A, body: A) => preview("initiative.revise", { target: i.ref, format: "json", content: bytes(body) }, [i.ref]);
  const census = (base = path.join(root, ".guild")): A => fs.existsSync(base) ? Object.fromEntries(fs.readdirSync(base, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => { const p = path.join(e.parentPath, e.name); return [path.relative(base, p), hash(fs.readFileSync(p))]; }).sort(([a], [b]) => a.localeCompare(b))) : {};
  return { home, root, pkg, put, read, preview, decide, apply, execute, create, current, revision, revise, census,
    get facade() { return facade; }, get session() { return session; },
    restart() { facade = make(); session = facade.dispatch({ action: "bind" }); },
    close() { if (oldState === undefined) delete process.env.GUILD_STATE_HOME; else process.env.GUILD_STATE_HOME = oldState; fs.rmSync(home, { recursive: true, force: true }); }
  };
}
function refuses(run: () => unknown, code: string) { let error: A; try { run(); } catch (e) { error = e; } expect(error?.code).toBe(code); }
function test(name: string, run: (f: ReturnType<typeof fixture>) => void) { it(name, () => { const f = fixture(); try { run(f); } finally { f.close(); } }); }
function runRecord(f: ReturnType<typeof fixture>, id = "run-20260101-000000-independent", initiative: string | null = null, verify = "") {
  f.put(".guild/runs/" + id + "/run.yaml", { schema_version: "guild.run_manifest.v1", run_id: id, run_scope: initiative ? "initiative" : "independent", initiative_attachment: initiative, attachment_resolution: { resolved: initiative ? "initiative" : "independent", initiative_id: initiative, source: "explicit", confidence: "high" } });
  f.put(".guild/runs/" + id + "/provenance.json", { schema_version: "guild.run_provenance.v1", initiative, run_scope: initiative ? "initiative" : "independent" });
  f.put(".guild/runs/" + id + "/verify.md", verify || "# Verify — " + id + "\n\nOverall status: pass\n\n" + [1,2,3,4,5,6].map(n => n + ". pass").join("\n") + "\n");
  return f.read("run.list").items.find((r: A) => r.ref.id === id);
}
function ready(f: ReturnType<typeof fixture>, patch: A = {}, verify?: string) {
  let i = f.create();
  runRecord(f, undefined, i.ref.id, verify);
  if (verify !== undefined) f.put(".guild/runs/run-20260101-000000-independent/verify.md", verify);
  i = f.current(i.ref.id);
  const body = f.revision(i, { manifest: { ...i.data.manifest, definition_status: "complete", execution_status: "done", release_status: "released", documentation_status: "updated", ...patch } });
  f.put(".guild/artifacts/qa/release-docs.txt", "release and docs verified\n");
  body.close_gate = { evidence: [".guild/artifacts/qa/release-docs.txt"] };
  const p = f.revise(i, body); f.decide(p); f.apply(p);
  return f.current(i.ref.id);
}
function propose(f: ReturnType<typeof fixture>, id: string, title = "Decision") {
  const i = f.current(id);
  const r = f.execute("decision.propose", { title, owner: "untrusted-label", acceptance: [], body: bytes({ schema_version: "guild.initiative_decision_proposal.v1", initiative: i.ref, rationale: "Retain original proposal", alternatives: ["Alternative"], evidence: [] }) });
  return f.read("decision.inspect", r.after[0]).items[0];
}
function approve(f: ReturnType<typeof fixture>, d: A) { const r = f.execute("decision.approve", { target: d.ref, rationale: "Event rationale" }, [d.ref]); return f.read("decision.inspect", r.after[0]).items[0]; }

test("C4/C5/C6 creation is private, idempotent and exact", f => {
  const before = f.census();
  const args = { title: "Create fixture", body: "Summary", owner: "operator", acceptance: ["First"] };
  const p = f.preview("initiative.create", args, [], "same-preview");
  expect(f.preview("initiative.create", args, [], "same-preview")).toEqual(p);
  expect(f.census()).toEqual(before);
  expect(p.targets).toHaveLength(1);
  f.decide(p);
  expect(f.read("initiative.list").items).toHaveLength(0);
  const r = f.apply(p, "same-apply");
  expect(r.state).toBe("applied");
  expect(r.touched).toHaveLength(4);
  expect(f.apply(p, "same-apply")).toEqual(r);
  expect(f.read("initiative.list").items).toHaveLength(1);
  expect(f.read("initiative.list").items[0].ref).toEqual(r.after[0]);
  expect(() => f.preview("initiative.create", { ...args, title: "Different" }, [], "same-preview")).toThrow();
});
for (const disposition of ["rejected", "returned"]) test("C5 " + disposition + " cannot apply", f => {
  const i = f.create(), p = f.preview("initiative.pause", { target: i.ref, rationale: "Pause" }, [i.ref]);
  f.decide(p, disposition);
  expect(() => f.apply(p)).toThrow();
  expect(f.current(i.ref.id).data.lifecycle.paused).toBe(false);
});
test("legacy, future, missing and malformed axes remain visible without writes", f => {
  const m = { id: "legacy", title: "Legacy", summary_ref: "summary.md", created_at: "2026-01-01", updated_at: "2026-01-01", definition_status: "complete", execution_status: "completed", release_status: "mystery" };
  f.put(".guild/initiatives/active/legacy/initiative.yaml", m);
  f.put(".guild/initiatives/active/future/initiative.yaml", { initiative: { ...m, id: "future", schema_version: "guild.initiative.v99" } });
  f.put(".guild/initiatives/active/broken/initiative.yaml", "initiative: [\n");
  const before = f.census(); const items = f.read("initiative.list").items;
  expect(items).toHaveLength(3);
  const i = items.find((x: A) => x.ref.id === "legacy");
  expect(i.data.axes.execution).toEqual({ raw: "completed", value: "done", normalization: "documented_alias" });
  expect(i.data.axes.release.value).toBeNull();
  expect(i.data.axes.documentation.normalization).toBe("missing");
  expect(items.find((x: A) => x.ref.id === "future").data.compatibility).toBe("unsupported");
  expect(items.find((x: A) => x.ref.id === "broken").data.issues.length).toBeGreaterThan(0);
  expect(f.census()).toEqual(before);
});
for (const field of ["id", "created_at", "scope", "unknown_new_field"]) test("revision refuses immutable/new field " + field, f => {
  const i = f.create(), body = f.revision(i); body.manifest[field] = "changed";
  const before = f.census(); expect(() => f.revise(i, body)).toThrow(); expect(f.census()).toEqual(before);
});
for (const graph of ["missing", "cycle", "duplicate", "cancelled", "deferred"]) test("dependency graph refuses " + graph + " predecessor", f => {
  const i = f.create(); const w = (id: string, status: string, depends_on: string[] = []) => ({ id, initiative_id: i.ref.id, title: id, type: "implementation", status, depends_on });
  const works = graph === "missing" ? [w("a", "ready", ["missing"])] : graph === "cycle" ? [w("a", "proposed", ["b"]), w("b", "proposed", ["a"])] : graph === "duplicate" ? [w("a", "proposed"), w("a", "proposed")] : [w("a", graph), w("b", "ready", ["a"])];
  refuses(() => f.revise(i, f.revision(i, { work_items: works })), "invalid_dependencies");
});
test("blocking definition prevents readiness", f => {
  const i = f.create(), body = f.revision(i); body.manifest.definition_status = "complete"; body.definition_items[0].status = "needs_definition";
  refuses(() => f.revise(i, body), "definition_unresolved");
});
test("link and unlink disclose physical run writes and preserve original run directory", f => {
  let i = f.create(); const r = runRecord(f); i = f.current(i.ref.id);
  const result = f.execute("initiative.link", { target: i.ref, related: r.ref, rationale: "Link" }, [i.ref]);
  expect(result.touched.some((e: A) => e.path.endsWith("/run.yaml"))).toBe(true);
  i = f.current(i.ref.id); expect(i.data.linked_runs).toHaveLength(1);
  const linked = f.read("run.list").items[0]; expect(linked.data.manifest.initiative_attachment).toBe(i.ref.id);
  f.execute("initiative.unlink", { target: i.ref, related: linked.ref, rationale: "Unlink" }, [i.ref]);
  expect(f.current(i.ref.id).data.linked_runs).toHaveLength(0);
  expect(fs.readdirSync(path.join(f.root, ".guild/runs"))).toEqual([r.ref.id]);
});
test("cross-source targets refuse without modifying canonical bytes", f => {
  const i = f.create(), before = f.census(), foreign = { ...i.ref, source_id: "foreign-source" };
  expect(() => f.read("initiative.inspect", foreign)).toThrow();
  expect(() => f.preview("initiative.pause", { target: foreign, rationale: "Pause" }, [foreign])).toThrow();
  expect(f.census()).toEqual(before);
});
for (const [axis, value, leg] of [["execution_status", "not_started", "exec"], ["release_status", "not_released", "release"], ["documentation_status", "stale", "docs"]]) test("D8 independently refuses " + leg, f => {
  const i = ready(f, { [axis]: value });
  const check = f.read("initiative.close_check", i.ref).items[0].data;
  expect(check.result.legs[leg]).toBe(false); expect(check.pass).toBe(false);
  const before = f.census(); expect(() => f.preview("initiative.close", { target: i.ref, rationale: "Close" }, [i.ref])).toThrow(); expect(f.census()).toEqual(before);
});
for (const verify of ["", "## FAIL\nPASS appears in explanatory prose\n", "Overall status: pass\n", "## PASS\n## FAIL\n"]) test("D8 refuses unsupported execution verification " + JSON.stringify(verify), f => {
  const i = ready(f, {}, verify); expect(i.data.close_check.inputs.execVerified).toBe(false); expect(i.data.close_check.pass).toBe(false);
});
test("valid D8 closes once, survives restart and restores immutable history", f => {
  const initial = ready(f); const decision = approve(f, propose(f, initial.ref.id));
  const i = f.current(initial.ref.id); expect(i.data.close_check.pass).toBe(true);
  const p = f.preview("initiative.close", { target: i.ref, rationale: "All legs independently verified" }, [i.ref]); f.decide(p);
  const result = f.apply(p, "close-once"); expect(result.state).toBe("applied");
  expect(f.current(i.ref.id).data.bucket).toBe("archived");
  const archived = f.current(i.ref.id), lifecycle = archived.data.lifecycle;
  expect(fs.existsSync(path.join(f.root, archived.data.manifest.summary_ref))).toBe(true);
  const archivedDecision = f.read("decision.list", archived.ref).items.find((d: A) => d.ref.id === decision.ref.id); expect(archivedDecision.data.authority.status).toBe("verified");
  f.restart(); const status = f.facade.dispatch({ action: "status", session_id: f.session.session_id, operation_id: p.operation_id }); expect(status.state).toBe("succeeded");
  const restore = f.execute("initiative.restore", { target: archived.ref, rationale: "Restore" }, [archived.ref]);
  expect(restore.state).toBe("applied"); expect(f.current(i.ref.id).data.bucket).toBe("active"); expect(f.current(i.ref.id).data.lifecycle).toEqual(lifecycle);
  expect(fs.existsSync(path.join(f.root, f.current(i.ref.id).data.manifest.summary_ref))).toBe(true);
  expect(f.read("decision.list", f.current(i.ref.id).ref).items[0].data.authority.status).toBe("verified");
});
test("changing cited execution evidence after approval refuses close", f => {
  const i = ready(f), p = f.preview("initiative.close", { target: i.ref, rationale: "Close" }, [i.ref]); f.decide(p);
  f.put(".guild/runs/run-20260101-000000-independent/verify.md", "## FAIL\n");
  expect(() => f.apply(p)).toThrow(); expect(f.current(i.ref.id).data.bucket).toBe("active");
});
test("canonical decision changes only at apply and retains authority and prior event bytes", f => {
  const i = f.create(), d = propose(f, i.ref.id), priorPath = ".guild/" + d.data.evidence[0].path, prior = fs.readFileSync(path.join(f.root, priorPath));
  expect(d.data.authority.status).toBe("verified"); expect(d.data.authority.actor).toBe("local operator");
  const p = f.preview("decision.approve", { target: d.ref, rationale: "Approval rationale" }, [d.ref]); f.decide(p);
  expect(f.read("decision.inspect", d.ref).items[0].data.state).toBe("proposed");
  const r = f.apply(p), approved = f.read("decision.inspect", r.after[0]).items[0];
  expect(approved.data.state).toBe("approved"); expect(approved.data.authority.status).toBe("verified");
  expect(fs.readFileSync(path.join(f.root, priorPath))).toEqual(prior);
  expect(approved.data.history.map((e: A) => e.event)).toEqual(["proposed", "approved"]);
  expect(approved.data.head.rationale).toBe("Approval rationale");
  expect(approved.data.history[0].rationale).toBe("Retain original proposal");
  expect(() => f.preview("decision.reject", { target: d.ref, rationale: "Replay" }, [d.ref])).toThrow();
});
test("reject is terminal and supersede preserves both approved event chains", f => {
  const i = f.create(), rejected = propose(f, i.ref.id, "Rejected");
  const reject = f.execute("decision.reject", { target: rejected.ref, rationale: "Reject" }, [rejected.ref]); expect(f.read("decision.inspect", reject.after[0]).items[0].data.state).toBe("rejected");
  const old = approve(f, propose(f, i.ref.id, "Old")), replacement = approve(f, propose(f, i.ref.id, "New"));
  const prior = old.data.evidence.map((e: A) => [e.path, fs.readFileSync(path.join(f.root, ".guild", e.path))]);
  const superseded = f.execute("decision.supersede", { target: old.ref, related: replacement.ref, rationale: "Replace" }, [old.ref, replacement.ref]);
  const result = f.read("decision.inspect", superseded.after.find((r: A) => r.id === old.ref.id)).items[0];
  expect(result.data.state).toBe("superseded"); expect(result.data.head.replacement.decision_id).toBe(replacement.ref.id);
  for (const [p, b] of prior) expect(fs.readFileSync(path.join(f.root, ".guild", p))).toEqual(b);
  expect(f.read("decision.inspect", replacement.ref).items[0].data.state).toBe("approved");
});
test("tampered decision sequence is visible and immutable", f => {
  const i = f.create(), d = propose(f, i.ref.id), p = path.join(f.root, ".guild", d.data.evidence[0].path), e = JSON.parse(fs.readFileSync(p, "utf8")); e.sequence = 5; fs.writeFileSync(p, bytes(e));
  const bad = f.read("decision.list", f.current(i.ref.id).ref).items[0]; expect(bad.data.state).toBe("invalid");
  expect(() => f.preview("decision.approve", { target: bad.ref, rationale: "Forged" }, [bad.ref])).toThrow();
});
test("trace cursors bind exact snapshot and malformed events remain explicit", f => {
  const r = runRecord(f); const rel = ".guild/runs/" + r.ref.id + "/trace.jsonl";
  f.put(rel, Array.from({ length: 201 }, (_, index) => JSON.stringify({ index })).join("\n") + "\n{invalid\n" + JSON.stringify({ oversized: "x".repeat(65536) }) + "\n");
  const first = f.read("run.trace", r.ref, { limit: 200 }); expect(first.items[0].data.events).toHaveLength(200); expect(first.next_cursor).not.toBeNull();
  expect(first.items[0].data.issues.map((i: A) => i.code)).toContain("malformed_event"); expect(first.items[0].data.issues.map((i: A) => i.code)).toContain("event_limit");
  const second = f.read("run.trace", r.ref, { limit: 200, cursor: first.next_cursor }); expect(second.items[0].data.events).toHaveLength(1);
  fs.appendFileSync(path.join(f.root, rel), bytes({ index: 202 })); expect(() => f.read("run.trace", r.ref, { limit: 200, cursor: first.next_cursor })).toThrow();
});
test("artifact selectors refuse traversal, hide secret/runtime entries and never preview binaries", f => {
  const r = runRecord(f), rel = ".guild/runs/" + r.ref.id;
  f.put(rel + "/secrets/token.txt", "secret"); f.put(rel + "/runtime/state.txt", "private"); f.put(rel + "/image.bin", "binary"); f.put(rel + "/page.html", "<script>throw Error('hostile')</script>");
  const listing = f.read("run.artifacts", r.ref).items[0].data;
  expect(listing.entries.some((e: A) => /secrets|runtime/.test(e.evidence.path))).toBe(false);
  const binary = f.read("run.artifacts", r.ref, { query: rel.slice(7) + "/image.bin" }).items[0].data.entries[0]; expect(binary.preview).toBeNull();
  const html = f.read("run.artifacts", r.ref, { query: rel.slice(7) + "/page.html" }).items[0].data.entries[0]; expect(html.media_type).toBe("text/plain"); expect(html.preview).toContain("<script>");
  for (const query of ["/etc/passwd", "../secret", "runs/missing.txt"]) expect(() => f.read("run.artifacts", r.ref, { query })).toThrow();
});
test("artifact text previews remain within 64KiB for Unicode", f => {
  const r = runRecord(f), p = "runs/" + r.ref.id + "/unicode.txt";
  f.put(".guild/" + p, "界".repeat(40000));
  const e = f.read("run.artifacts", r.ref, { query: p }).items[0].data.entries[0];
  expect(Buffer.byteLength(e.preview)).toBeLessThanOrEqual(65536); expect(e.truncated).toBe(true);
});
test("host capability remains unavailable without actual installed proof and enforceable budget", f => {
  const c = f.facade.dispatch({ action: "capabilities", session_id: f.session.session_id });
  for (const id of ["initiative.resume", "run.start", "run.resume", "run.cancel", "run.rerun"]) { const op = c.operations.find((o: A) => o.id === id); expect(op.availability).toBe("unavailable"); expect(op.unavailable_reason).not.toBe(""); }
  const i = f.create(); expect(() => f.preview("initiative.resume", { target: i.ref, rationale: "Resume" }, [i.ref])).toThrow();
});

test("P01 raw schema and operation catalog pins remain frozen", f => {
  const generated = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "../../src/domains/lifecycle/stack-contracts.generated.json"), "utf8"));
  const bundle = generated.contract_bundle;
  for (const record of bundle.contracts) expect(hash(bytes(generated.schemas[path.basename(record.file)]))).toBe(record.sha256);
  expect(hash(bytes(generated.catalog))).toBe(bundle.operation_catalog_sha256);
  const caps = f.facade.dispatch({ action: "capabilities", session_id: f.session.session_id });
  for (const op of caps.operations.filter((op: A) => ["initiative.list", "initiative.inspect", "initiative.close_check", "decision.list", "decision.inspect", "run.list", "run.inspect", "run.trace", "run.artifacts"].includes(op.id))) expect(op.entry_id).toBe("stack.p05.read.v1");
});
test("source public legacy list and P05 reads expose identical entity revisions", f => {
  const i = f.create();
  const old = f.facade.dispatch({ action: "list", session_id: f.session.session_id, source_id: f.session.root.source_id, collection: "initiative", limit: 50 });
  expect(old.items[0].ref).toEqual(i.ref);
});
test("large artifacts are listed with exact streamed metadata and explicit bounded preview refusal", f => {
  const r = runRecord(f), p = "runs/" + r.ref.id + "/large.txt", content = "x".repeat(1048577);
  f.put(".guild/" + p, content);
  const listing = f.read("run.artifacts", r.ref).items[0].data;
  const entry = listing.entries.find((e: A) => e.evidence.path === p);
  expect(entry.size_bytes).toBe(1048577); expect(entry.evidence.sha256).toBe(hash(content));
  const preview = f.read("run.artifacts", r.ref, { query: p }).items[0].data;
  expect(preview.entries[0].preview).toBeNull(); expect(preview.issues.length).toBeGreaterThan(0);
});
test("oversized trace produces bounded explicit issue rather than rejecting the whole source", f => {
  const r = runRecord(f); f.put(".guild/runs/" + r.ref.id + "/large.jsonl", "x".repeat(1048577));
  const result = f.read("run.trace", r.ref); expect(result.items[0].data.events).toHaveLength(0); expect(result.items[0].data.issues.length).toBeGreaterThan(0);
});
test("stale config and package identity invalidate approved domain writes", f => {
  const i = f.create(), p = f.preview("initiative.pause", { target: i.ref, rationale: "Pause" }, [i.ref]); f.decide(p);
  f.put(".guild/config/project.json", { advisorRounds: 4, tiers: { default: "mid" } });
  expect(() => f.apply(p)).toThrow(); expect(f.current(i.ref.id).data.lifecycle.paused).toBe(false);
});

function journal(f: ReturnType<typeof fixture>, id: string) {
  const base = path.join(f.home, "private-state");
  const found = fs.readdirSync(base, { recursive: true, withFileTypes: true }).filter(e => e.isFile() && e.name === id + ".json").map(e => path.join(e.parentPath, e.name)).find(p => p.includes(path.sep + "operations" + path.sep));
  if (!found) throw Error("Private fixture journal missing");
  return { file: found, record: JSON.parse(fs.readFileSync(found, "utf8")) };
}
for (const cut of [0, 1, 2, 3, 4]) test("fault-injected private journal recovery after " + cut + " of four creation writes", f => {
  const p = f.preview("initiative.create", { title: "Recovery", body: "Recover fixture", owner: "operator", acceptance: ["Acceptance"] }); f.decide(p);
  const { file, record } = journal(f, p.operation_id); record.state = "running"; record.pid = null; record.apply_key = "lost-response";
  fs.writeFileSync(file, bytes(record));
  for (const w of record.writes.slice(0, cut)) f.put(w.path, w.after_bytes);
  const before = f.census(); f.restart();
  const status = f.facade.dispatch({ action: "status", session_id: f.session.session_id, operation_id: p.operation_id });
  if (cut === 4) { expect(status.state).toBe("succeeded"); expect(status.receipt.state).toBe("applied"); expect(f.read("initiative.list").items).toHaveLength(1); const again = f.facade.dispatch({ action: "status", session_id: f.session.session_id, operation_id: p.operation_id }); expect(again.receipt).toEqual(status.receipt); }
  else { expect(status.state).toBe("recovery_needed"); expect(status.receipt).toBeNull(); expect(f.census()).toEqual(before); expect(() => f.preview("initiative.create", { title: "Conflicting", body: "Fixture", owner: "operator", acceptance: [] })).toThrow(); }
});
test("all-after recovery refuses missing approval and preserves foreign edits", f => {
  const p = f.preview("initiative.create", { title: "Missing approval", body: "Fixture", owner: "operator", acceptance: [] });
  const { file, record } = journal(f, p.operation_id); record.state = "running"; record.pid = null; record.apply_key = "lost-response"; fs.writeFileSync(file, bytes(record));
  for (const w of record.writes) f.put(w.path, w.after_bytes);
  f.put(".guild/artifacts/foreign.txt", "Unrelated edit"); const before = f.census(); f.restart();
  const status = f.facade.dispatch({ action: "status", session_id: f.session.session_id, operation_id: p.operation_id }); expect(status.state).toBe("recovery_needed"); expect(status.receipt).toBeNull(); expect(f.census()).toEqual(before);
});
test("private journal cannot inject an arbitrary file path into approved handler", f => {
  const p = f.preview("initiative.create", { title: "Tamper", body: "Fixture", owner: "operator", acceptance: [] }); f.decide(p);
  const { file, record } = journal(f, p.operation_id); record.writes[0].path = ".guild/artifacts/injected.txt"; fs.writeFileSync(file, bytes(record));
  const before = f.census(); expect(() => f.apply(p)).toThrow(); expect(f.census()).toEqual(before); expect(fs.existsSync(path.join(f.root, ".guild/artifacts/injected.txt"))).toBe(false);
});

test("unresolved blocking definition refuses ready work even while definition axis remains incomplete", f => {
  const i = f.create(), body = f.revision(i); body.definition_items[0].status = "needs_definition";
  body.work_items = [{ id: "premature", initiative_id: i.ref.id, title: "Premature work", type: "implementation", status: "ready", depends_on: [] }];
  refuses(() => f.revise(i, body), "definition_unresolved");
});
test("completed predecessor permits ready work and preserves existing manifest extensions", f => {
  let i = f.create(); const rel = ".guild/" + i.data.path + "/initiative.yaml";
  f.put(rel, { initiative: { ...i.data.manifest, existing_extension: { preserved: true } } }); i = f.current(i.ref.id);
  const body = f.revision(i); body.manifest.title = "Revised title";
  body.work_items = [{ id: "a", initiative_id: i.ref.id, title: "Done", type: "implementation", status: "done" }, { id: "b", initiative_id: i.ref.id, title: "Ready", type: "validation", status: "ready", depends_on: ["a"] }];
  const p = f.revise(i, body); f.decide(p); f.apply(p); const after = f.current(i.ref.id);
  expect(after.data.manifest.existing_extension).toEqual({ preserved: true }); expect(after.data.dependencies[0].state).toBe("satisfied"); expect(after.data.manifest.title).toBe("Revised title");
});
test("supersede refuses replacement from another initiative or unapproved replacement", f => {
  const i = f.create(), old = approve(f, propose(f, i.ref.id)), pending = propose(f, i.ref.id, "Pending");
  expect(() => f.preview("decision.supersede", { target: old.ref, related: pending.ref, rationale: "Invalid" }, [old.ref, pending.ref])).toThrow();
  const j = f.create(), foreign = approve(f, propose(f, j.ref.id));
  expect(() => f.preview("decision.supersede", { target: old.ref, related: foreign.ref, rationale: "Foreign" }, [old.ref, foreign.ref])).toThrow();
});
test("archive refuses unresolved initiative without deleting or moving its bytes", f => {
  const i = f.create(), before = f.census(); expect(() => f.preview("initiative.archive", { target: i.ref, rationale: "Archive" }, [i.ref])).toThrow(); expect(f.census()).toEqual(before);
});
test("trace cursor cannot cross run identity or query and forged cursor never silently resets", f => {
  const r = runRecord(f), other = runRecord(f, "run-20260101-000001-other");
  f.put(".guild/runs/" + r.ref.id + "/trace.jsonl", JSON.stringify({ n: 1 }) + "\n" + JSON.stringify({ n: 2 }) + "\n");
  const first = f.read("run.trace", r.ref, { limit: 1 });
  expect(() => f.read("run.trace", other.ref, { limit: 1, cursor: first.next_cursor })).toThrow();
  expect(() => f.read("run.trace", r.ref, { limit: 1, query: "changed", cursor: first.next_cursor })).toThrow();
  expect(() => f.read("run.trace", r.ref, { limit: 1, cursor: first.next_cursor + "x" })).toThrow();
});
test("symlink evidence fails closed and missing close evidence cannot advance axes", f => {
  const i = f.create(), body = f.revision(i); body.manifest.execution_status = "done"; body.close_gate = { evidence: [".guild/artifacts/missing.txt"] }; expect(() => f.revise(i, body)).toThrow();
  const external = path.join(f.home, "external.txt"); fs.writeFileSync(external, "External"); fs.mkdirSync(path.join(f.root, ".guild/artifacts"), { recursive: true }); fs.symlinkSync(external, path.join(f.root, ".guild/artifacts/linked.txt")); body.close_gate.evidence = [".guild/artifacts/linked.txt"]; expect(() => f.revise(i, body)).toThrow();
});

test("legacy pointer files and placeholder directories do not become domain entities", f => {
  f.put(".guild/runs/current-run-id", "run-20260101-000000-independent\n"); fs.mkdirSync(path.join(f.root, ".guild/runs/placeholder"), { recursive: true });
  fs.mkdirSync(path.join(f.root, ".guild/initiatives/active/placeholder"), { recursive: true }); fs.mkdirSync(path.join(f.root, ".guild/initiatives/archived/placeholder"), { recursive: true });
  expect(f.read("run.list").items).toHaveLength(0); expect(f.read("initiative.list").items).toHaveLength(0);
  const run = runRecord(f), i = f.create(); expect(f.read("run.list").items[0].ref).toEqual(run.ref); expect(f.read("initiative.list").items[0].ref).toEqual(i.ref);
});
test("unrelated historical large initiative artifact does not break canonical projection or revision", f => {
  let i = f.create(); f.put(".guild/" + i.data.path + "/history/large.html", "x".repeat(1048577)); i = f.current(i.ref.id);
  const body = f.revision(i); body.manifest.title = "Canonical title"; const p = f.revise(i, body); f.decide(p); f.apply(p);
  expect(f.current(i.ref.id).data.manifest.title).toBe("Canonical title");
});

test("existing malformed run remains visible with explicit issues and null manifest", f => {
  f.put(".guild/runs/run-20260101-000000-malformed/run.yaml", "run_id: [\n");
  const page = f.read("run.list"); expect(page.items).toHaveLength(1); expect(page.items[0].data.manifest).toBeNull(); expect(page.items[0].data.issues.map((e: A) => e.code)).toContain("malformed_record");
});
test("close check preserves205 evidence references without imposing an undeclared item cap", f => {
  let i = f.create(); const paths = Array.from({ length: 200 }, (_, n) => ".guild/artifacts/qa/evidence-" + n + ".txt"); for (const p of paths) f.put(p, "Evidence\n");
  for (let n = 0; n < 5; n++) runRecord(f, "run-20260101-00000" + n + "-evidence", i.ref.id); i = f.current(i.ref.id);
  const body = f.revision(i, { close_gate: { evidence: paths } }); const p = f.revise(i, body); f.decide(p); f.apply(p); i = f.current(i.ref.id);
  expect(i.data.close_check.evidence).toHaveLength(205); expect(i.data.close_check.evidence_errors.some((e: A) => e.code === "evidence_limit")).toBe(false);
});

for (const kind of ["definition", "work", "decision"]) for (const stale of [false, true]) test("R1 C1 new " + kind + " evidence " + (stale ? "changes after approval refuse apply" : "survives exact preview and apply"), f => {
  const i = f.create(), rel = ".guild/artifacts/qa/new-proof.txt", content = "Independent new evidence\n";
  f.put(rel, content);
  let p: A;
  if (kind === "decision") {
    const evidence = { source_id: f.session.root.source_id, path: rel.slice(7), sha256: hash(content), schema_version: "guild.stack.raw-evidence.v1", observed_at: "2026-01-01T00:00:00.000Z", freshness: "current" };
    p = f.preview("decision.propose", { title: "Evidence decision", owner: "operator", acceptance: [], body: bytes({ schema_version: "guild.initiative_decision_proposal.v1", initiative: i.ref, rationale: "Nonempty evidence", alternatives: ["Alternative"], evidence: [evidence] }) });
  } else {
    const revision = f.revision(i);
    if (kind === "definition") revision.definition_items = revision.definition_items.map((d: A) => ({ ...d, evidence_refs: [rel] }));
    else revision.work_items = [{ id: "evidence-work", initiative_id: i.ref.id, title: "Evidence work", type: "validation", status: "proposed", evidence_refs: [rel] }];
    p = f.revise(i, revision);
  }
  f.decide(p);
  if (stale) { f.put(rel, "Changed after approval\n"); const before = f.census(); expect(() => f.apply(p)).toThrow(); expect(f.census()).toEqual(before); }
  else { const result = f.apply(p); expect(result.state).toBe("applied"); if (kind === "decision") expect(f.read("decision.inspect", result.after[0]).items[0].data.head.evidence[0].sha256).toBe(hash(content)); else expect(f.current(i.ref.id).data[kind === "definition" ? "definition_items" : "work_items"][0].evidence_refs).toEqual([rel]); }
});
for (const surface of ["trace", "artifact"]) test("R1 F14 opaque credential keys are redacted in " + surface + " while numeric usage remains", f => {
  const r = runRecord(f), rel = ".guild/runs/" + r.ref.id;
  const credentials = { token: "opaque-session-value", access_token: "opaque-oauth-value", refresh_token: "opaque-refresh-value" };
  const payload = { nested: [credentials], usage: { tokens: 31, input_tokens: 15, output_tokens: 16, total_tokens: 31 }, message: "Ordinary event" };
  f.put(rel + (surface === "trace" ? "/trace.jsonl" : "/details.json"), JSON.stringify(payload) + "\n");
  const current = f.read("run.list").items[0];
  const actual = surface === "trace" ? f.read("run.trace", current.ref).items[0].data.events[0].event : JSON.parse(f.read("run.artifacts", current.ref, { query: rel.slice(7) + "/details.json" }).items[0].data.entries[0].preview);
  expect(actual.nested[0]).toEqual({ token: "[redacted]", access_token: "[redacted]", refresh_token: "[redacted]" }); expect(actual.usage).toEqual(payload.usage); expect(actual.message).toBe(payload.message);
});
test("R1 I2 canonical recorded host remains visible without dispatch qualification", f => {
  const r = runRecord(f), rel = ".guild/runs/" + r.ref.id + "/run.yaml";
  const m = JSON.parse(fs.readFileSync(path.join(f.root, rel), "utf8")); f.put(rel, { ...m, host: { requested: "codex", resolved: "codex" } });
  const list = f.read("run.list").items[0], inspected = f.read("run.inspect", list.ref).items[0];
  for (const item of [list, inspected]) { expect(item.data.host.host_id).toBe("codex"); expect(item.data.host.dispatch_state).toBe("unknown"); expect(item.data.host.proof).toEqual([]); expect(item.data.controls.every((c: A) => c.available === false)).toBe(true); }
});

for (const format of ["trace.jsonl", "run.yaml", "details.yaml", "details.yml"]) test("R2 F14 exact artifact selector redacts structured " + format, f => {
  const r = runRecord(f), rel = ".guild/runs/" + r.ref.id;
  const values = ["opaque-case-token", "opaque-case-access", "opaque-case-refresh", "opaque-case-bearer"];
  const metadata = { Token: values[0], ACCESS_TOKEN: values[1], Refresh_Token: values[2], Bearer: values[3] };
  const payload = { metadata, usage: { input_tokens: 15, output_tokens: 16, total_tokens: 31 }, message: "Ordinary event" };
  let content = JSON.stringify(payload) + "\n";
  if (format === "run.yaml") content = bytes({ schema_version: "guild.run_manifest.v1", run_id: r.ref.id, run_scope: "independent", initiative_attachment: null, ...payload });
  if (format === "details.yaml" || format === "details.yml") content = "metadata:\n  Token: " + values[0] + "\n  ACCESS_TOKEN: " + values[1] + "\n  Refresh_Token: " + values[2] + "\n  Bearer: " + values[3] + "\nusage:\n  input_tokens: 15\n  output_tokens: 16\n  total_tokens: 31\nmessage: Ordinary event\n";
  f.put(rel + "/" + format, content);
  const current = f.read("run.list").items[0], data = f.read("run.artifacts", current.ref, { query: rel.slice(7) + "/" + format }).items[0].data;
  const preview = data.entries[0].preview; expect(typeof preview).toBe("string");
  for (const value of values) expect(preview).not.toContain(value);
  expect(preview).toContain("[redacted]"); expect(preview).toContain("Ordinary event"); expect(preview).toMatch(/["']?total_tokens["']?\s*:\s*31\b/);
});
for (const format of ["broken.json", "broken.jsonl", "broken.yaml"]) test("R2 F14 malformed structured artifact " + format + " refuses unsafe raw preview", f => {
  const r = runRecord(f), rel = ".guild/runs/" + r.ref.id, secret = "opaque-malformed-value";
  const content = format.endsWith("yaml") ? "access_token: " + secret + "\nbroken: [\n" : format.endsWith("jsonl") ? JSON.stringify({ access_token: secret }) + "\n{broken\n" : '{"access_token":"' + secret + '","broken":';
  f.put(rel + "/" + format, content);
  const current = f.read("run.list").items[0], data = f.read("run.artifacts", current.ref, { query: rel.slice(7) + "/" + format }).items[0].data;
  expect(data.entries).toHaveLength(1); expect(data.entries[0].preview).toBeNull(); expect(data.issues.length).toBeGreaterThan(0); expect(JSON.stringify(data)).not.toContain(secret);
});
