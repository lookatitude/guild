import { it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { StackFacade } from "../../src/domains/lifecycle";
import { stackValidator } from "../../scripts/lib/stack-contract-validator";
function fixture(kind = "project") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-facade-"));
    const root = path.join(dir, "project"), pkg = path.join(dir, "package");
    fs.mkdirSync(path.join(root, ".guild", "config"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), `schema_version: guild.root.v1\nkind: ${kind}\n`);
    fs.writeFileSync(path.join(root, ".guild", "storage-layout.json"), JSON.stringify({ storage_layout_version: 2 }));
    fs.writeFileSync(path.join(root, ".guild", "config", kind + ".json"), JSON.stringify({ advisorRounds: 2, tiers: { default: "mid" } }));
    fs.mkdirSync(path.join(pkg, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(path.join(pkg, "runtime", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(pkg, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "guild", version: "3.2.0-beta.1" }));
    fs.writeFileSync(path.join(pkg, "guild.inventory.json"), JSON.stringify({
        schema_version: "guild.inventory.v1",
        plugin_version: "3.2.0-beta.1",
        manifest: { name: "guild", version: "3.2.0-beta.1" },
        scripts: [{ id: "stack-operations", kind: "cli" }],
    }));
    fs.writeFileSync(path.join(pkg, "runtime", "scripts", "stack-operations.js"), "fixture entry");
    const previous = process.env.GUILD_STATE_HOME;
    process.env.GUILD_STATE_HOME = path.join(dir, "state");
    const facade = new StackFacade({
        root,
        packageRoot: pkg,
        validate: stackValidator(),
    });
    return {
        dir,
        root,
        pkg,
        facade,
        close() {
            if (previous === undefined)
                delete process.env.GUILD_STATE_HOME;
            else
                process.env.GUILD_STATE_HOME = previous;
            fs.rmSync(dir, { recursive: true, force: true });
        },
    };
}
function start(f: any) { const s = f.facade.dispatch({ action: "bind" }); return { s, sid: s.session_id, source: s.root.source_id }; }
function read(f: any, c: any, operation: string, target: any = null, query: any = null, cursor: any = null, limit = 50) { return f.facade.dispatch({ action: "read", schema_version: "guild.stack.p05.read_request.v1", session_id: c.sid, source_id: c.source, operation, arguments: { ...(target ? { target } : {}), ...(query ? { query } : {}), cursor, limit } }); }
function preview(f: any, c: any, operation: string, args: any, targets: any[] = []) { return f.facade.dispatch({ action: "preview", request: { session_id: c.sid, source_id: c.source, operation, arguments: args, targets, idempotency_key: randomUUID() } }); }
function apply(f: any, c: any, p: any) { f.facade.dispatch({ action: "decide", operation_id: p.operation_id, request: { session_id: c.sid, preview_hash: p.preview_hash, decision: "approved", rationale: "Reviewed exact fixture change" } }); return f.facade.dispatch({ action: "apply", operation_id: p.operation_id, request: { session_id: c.sid, preview_hash: p.preview_hash, idempotency_key: randomUUID() } }); }
const createArgs = { title: "Fixture initiative", body: "Exact fixture summary", acceptance: ["Acceptance"], owner: "operator" };
it("P05 negotiates and allocates privately before exact approval", () => { const f = fixture(); try {
    const c = start(f);
    const caps = f.facade.dispatch({ action: "capabilities", session_id: c.sid });
    expect(caps.operations.find((o: any) => o.id === "initiative.list").entry_id).toBe("stack.p05.read.v1");
    const p = preview(f, c, "initiative.create", createArgs);
    expect(p.targets).toHaveLength(1);
    expect(read(f, c, "initiative.list").items).toHaveLength(0);
    const r = apply(f, c, p);
    expect(r.state).toBe("applied");
    expect(r.touched).toHaveLength(4);
    const item = read(f, c, "initiative.list").items[0];
    expect(item.ref).toEqual(r.after[0]);
    expect(item.data.axes.execution.value).toBe("not_started");
    expect(item.data.close_check.pass).toBe(false);
}
finally {
    f.close();
} });
it("P05 decisions append immutable history and reject stale target", () => { const f = fixture(); try {
    const c = start(f);
    apply(f, c, preview(f, c, "initiative.create", createArgs));
    const i = read(f, c, "initiative.list").items[0];
    const p = preview(f, c, "decision.propose", { title: "Decision", owner: "operator", acceptance: [], body: JSON.stringify({ schema_version: "guild.initiative_decision_proposal.v1", initiative: i.ref, rationale: "Reason", alternatives: ["Other"], evidence: [] }) });
    const r = apply(f, c, p);
    const d = read(f, c, "decision.inspect", r.after[0]).items[0];
    expect(d.data.state).toBe("proposed");
    const q = preview(f, c, "decision.approve", { target: d.ref, rationale: "Approved" }, [d.ref]);
    apply(f, c, q);
    expect(() => preview(f, c, "decision.reject", { target: d.ref, rationale: "Reject" }, [d.ref])).toThrow();
    const ds = read(f, c, "decision.list", read(f, c, "initiative.list").items[0].ref);
        expect(ds.items[0].data.head.rationale).toBe('Approved');
        expect(ds.items[0].data.history[0].rationale).toBe('Reason');
    expect(ds.items[0].data.history.map((e: any) => e.event)).toEqual(["proposed", "approved"]);
}
finally {
    f.close();
} });
it("P05 refuses unsupported dispatch and domain close before writes", () => { const f = fixture(); try {
    const c = start(f);
    const caps = f.facade.dispatch({ action: "capabilities", session_id: c.sid });
    expect(caps.operations.find((o: any) => o.id === "run.start").availability).toBe("unavailable");
    const r = apply(f, c, preview(f, c, "initiative.create", createArgs));
    expect(() => preview(f, c, "initiative.close", { target: r.after[0], rationale: "Close" }, r.after)).toThrow();
    expect(read(f, c, "initiative.list").items[0].data.bucket).toBe("active");
}
finally {
    f.close();
} });
it("P05 revisions pin raw evidence and sidecars under approval", () => { const f = fixture(); try {
    const c = start(f);
    const r = apply(f, c, preview(f, c, "initiative.create", createArgs));
    const p = preview(f, c, "initiative.pause", { target: r.after[0], rationale: "Pause" }, r.after);
    const item = read(f, c, "initiative.list").items[0];
    const ledger = path.join(f.root, '.guild', item.data.path, 'definition-ledger.json');
    fs.appendFileSync(ledger, ' ');
    expect(() => apply(f, c, p)).toThrow();
    expect(read(f, c, "initiative.list").items[0].data.lifecycle.paused).toBe(false);
}
finally {
    f.close();
} });
it("P05 rejects forged read context and stale cursor", () => { const f = fixture(); try {
    const c = start(f);
    apply(f, c, preview(f, c, "initiative.create", createArgs));
    apply(f, c, preview(f, c, "initiative.create", { ...createArgs, title: "Second" }));
    const p = read(f, c, "initiative.list", null, null, null, 1);
    expect(p.next_cursor).not.toBeNull();
    apply(f, c, preview(f, c, "initiative.create", { ...createArgs, title: "Third" }));
    expect(() => read(f, c, "initiative.list", null, null, p.next_cursor, 1)).toThrow();
    expect(() => read(f, c, "initiative.inspect", { ...p.items[0].ref, source_id: "foreign" })).toThrow();
}
finally {
    f.close();
} });
function put(f: any, rel: string, value: any) { const p = path.join(f.root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); return p; }
function runFixture(f: any, id = 'run-20261025-190000-fixture') { put(f, '.guild/runs/' + id + '/run.yaml', { schema_version: 'guild.run.v1', id, run_scope: 'independent', initiative_attachment: null, attachment_resolution: { source: 'explicit', confidence: 'high', resolved: 'independent' } }); put(f, '.guild/runs/' + id + '/provenance.json', { initiative: null, run_scope: 'independent' }); return id; }
function getJournal(f: any, id: string) { const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); return walk(path.join(f.dir, 'state')).find(p => p.endsWith('/operations/' + id + '.json'))!; }
it('P05 link and unlink change exact backing fields and invalidate the aggregate', () => { const f = fixture(); try {
    const c = start(f);
    apply(f, c, preview(f, c, 'initiative.create', createArgs));
    runFixture(f);
    const i = read(f, c, 'initiative.list').items[0], r = read(f, c, 'run.list').items[0];
    const p = preview(f, c, 'initiative.link', { target: i.ref, related: r.ref, rationale: 'Attach' }, [i.ref]);
    const receipt = apply(f, c, p);
    expect(receipt.touched.map((e: any) => e.path)).toHaveLength(2);
    expect(read(f, c, 'initiative.list').items[0].data.linked_runs).toHaveLength(1);
    expect(() => read(f, c, 'initiative.inspect', i.ref)).toThrow();
    const i2 = read(f, c, 'initiative.list').items[0], r2 = read(f, c, 'run.list').items[0];
    apply(f, c, preview(f, c, 'initiative.unlink', { target: i2.ref, related: r2.ref, rationale: 'Detach' }, [i2.ref]));
    expect(read(f, c, 'initiative.list').items[0].data.linked_runs).toHaveLength(0);
}
finally {
    f.close();
} });
it('P05 refuses dependency cycles and unsafe revision evidence', () => { const f = fixture(); try {
    const c = start(f);
    apply(f, c, preview(f, c, 'initiative.create', createArgs));
    const i = read(f, c, 'initiative.list').items[0];
    const body = { schema_version: 'guild.stack.initiative_revision.v1', manifest: i.data.manifest, definition_items: i.data.definition_items, work_items: [{ id: 'a', initiative_id: i.ref.id, title: 'A', type: 'implementation', status: 'ready', depends_on: ['b'] }, { id: 'b', initiative_id: i.ref.id, title: 'B', type: 'implementation', status: 'ready', depends_on: ['a'] }], close_gate: { evidence: [] } };
    expect(() => preview(f, c, 'initiative.revise', { target: i.ref, format: 'json', content: JSON.stringify(body) }, [i.ref])).toThrow();
    body.work_items = [];
    body.close_gate.evidence = ['../escape'] as never[];
    expect(() => preview(f, c, 'initiative.revise', { target: i.ref, format: 'json', content: JSON.stringify(body) }, [i.ref])).toThrow();
}
finally {
    f.close();
} });
it('P05 closes only verified D8 and restores complete history', () => { const f = fixture(); try {
    const c = start(f);
    apply(f, c, preview(f, c, 'initiative.create', createArgs));
    const rid = runFixture(f);
    put(f, '.guild/runs/' + rid + '/verify.md', '# Verify — ' + rid + '\n\nOverall status: pass\n\n1. Tests: pass\n2. Scope: pass\n3. Criteria: pass\n4. Blockers: pass\n5. Assumptions: pass\n6. Dispatch: pass\n');
    let i = read(f, c, 'initiative.list').items[0], r = read(f, c, 'run.list').items[0];
    apply(f, c, preview(f, c, 'initiative.link', { target: i.ref, related: r.ref, rationale: 'Attach verification' }, [i.ref]));
    i = read(f, c, 'initiative.list').items[0];
    const evidence = put(f, '.guild/artifacts/release-proof.json', { verified: true });
    const body = { schema_version: 'guild.stack.initiative_revision.v1', manifest: { ...i.data.manifest, execution_status: 'done', release_status: 'released', documentation_status: 'updated' }, definition_items: i.data.definition_items, work_items: [], close_gate: { evidence: ['.guild/artifacts/release-proof.json'] } };
    apply(f, c, preview(f, c, 'initiative.revise', { target: i.ref, format: 'json', content: JSON.stringify(body) }, [i.ref]));
    i = read(f, c, 'initiative.list').items[0];
    expect(i.data.close_check.pass).toBe(true);
    const p = preview(f, c, 'initiative.close', { target: i.ref, rationale: 'D8 verified' }, [i.ref]);
    apply(f, c, p);
    i = read(f, c, 'initiative.list').items[0];
    expect(i.data.bucket).toBe('archived');
    const restarted = new StackFacade({ root: f.root, packageRoot: f.pkg, validate: stackValidator() });
    const rs = restarted.dispatch({ action: 'bind' });
    expect(restarted.dispatch({ action: 'status', session_id: rs.session_id, operation_id: p.operation_id }).state).toBe('succeeded');
    expect(i.data.lifecycle.close_operation_id).toBe(p.operation_id);
    apply(f, c, preview(f, c, 'initiative.restore', { target: i.ref, rationale: 'Restore' }, [i.ref]));
    expect(read(f, c, 'initiative.list').items[0].data.lifecycle.close_operation_id).toBe(p.operation_id);
}
finally {
    f.close();
} });
it('P05 authenticates trace cursors and surfaces malformed records', () => { const f = fixture(); try {
    const c = start(f), rid = runFixture(f);
    put(f, '.guild/runs/' + rid + '/logs/trace.jsonl', '{"event":"one"}\ninvalid\n{"event":"two"}\n');
    const r = read(f, c, 'run.list').items[0];
    const p = read(f, c, 'run.trace', r.ref, null, null, 1);
    expect(p.items[0].data.events).toHaveLength(1);
    expect(p.items[0].data.issues[0].code).toBe('malformed_event');
    expect(read(f, c, 'run.trace', r.ref, null, p.next_cursor, 1).items[0].data.events[0].index).toBe(1);
    expect(() => read(f, c, 'run.trace', r.ref, null, p.next_cursor + 'x', 1)).toThrow();
    put(f, '.guild/runs/' + rid + '/logs/trace.jsonl', '{"event":"changed"}\n');
    expect(() => read(f, c, 'run.trace', r.ref, null, p.next_cursor, 1)).toThrow();
}
finally {
    f.close();
} });
it('P05 bounds artifact previews and refuses unlisted selectors', () => { const f = fixture(); try {
    const c = start(f), rid = runFixture(f);
    put(f, '.guild/runs/' + rid + '/artifact.html', '<script>alert(1)</script>');
    const r = read(f, c, 'run.list').items[0], p = read(f, c, 'run.artifacts', r.ref);
    const e = p.items[0].data.entries.find((e: any) => e.evidence.path.endsWith('artifact.html'));
    expect(e.preview).toBeNull();
    expect(read(f, c, 'run.artifacts', r.ref, e.evidence.path).items[0].data.entries[0].preview).toContain('<script>');
    expect(() => read(f, c, 'run.artifacts', r.ref, '/etc/passwd')).toThrow();
    expect(() => read(f, c, 'run.artifacts', r.ref, '../escape')).toThrow();
}
finally {
    f.close();
} });
it('P05 journal corruption cannot widen the producer write set', () => { const f = fixture(); try {
    const c = start(f), p = preview(f, c, 'initiative.create', createArgs);
    const jp = getJournal(f, p.operation_id), j = JSON.parse(fs.readFileSync(jp, 'utf8'));
    j.writes[0].path = '.guild/config/project.json';
    fs.writeFileSync(jp, JSON.stringify(j));
    expect(() => apply(f, c, p)).toThrow();
    expect(read(f, c, 'initiative.list').items).toHaveLength(0);
}
finally {
    f.close();
} });
it('P05 recovers all-after crash without repeating writes and leaves mixed state unresolved', () => { const f = fixture(); try {
    const c = start(f), p = preview(f, c, 'initiative.create', createArgs);
    f.facade.dispatch({ action: 'decide', operation_id: p.operation_id, request: { session_id: c.sid, preview_hash: p.preview_hash, decision: 'approved', rationale: 'Reviewed' } });
    const jp = getJournal(f, p.operation_id), j = JSON.parse(fs.readFileSync(jp, 'utf8'));
    j.state = 'running';
    j.pid = 2147483647;
    j.apply_key = 'crash-fixture';
    for (const w of j.writes)
        put(f, w.path, w.after_bytes);
    fs.writeFileSync(jp, JSON.stringify(j));
    const status = f.facade.dispatch({ action: 'status', session_id: c.sid, operation_id: p.operation_id });
    expect(status.state).toBe('succeeded');
    expect(status.receipt.after).toEqual(j.expected_after);
    const p2 = preview(f, c, 'initiative.create', { ...createArgs, title: 'Mixed' });
    f.facade.dispatch({ action: 'decide', operation_id: p2.operation_id, request: { session_id: c.sid, preview_hash: p2.preview_hash, decision: 'approved', rationale: 'Reviewed' } });
    const jp2 = getJournal(f, p2.operation_id), j2 = JSON.parse(fs.readFileSync(jp2, 'utf8'));
    j2.state = 'running';
    j2.pid = 2147483647;
    j2.apply_key = 'mixed-fixture';
    put(f, j2.writes[0].path, j2.writes[0].after_bytes);
    fs.writeFileSync(jp2, JSON.stringify(j2));
    expect(f.facade.dispatch({ action: 'status', session_id: c.sid, operation_id: p2.operation_id }).state).toBe('recovery_needed');
    expect(() => preview(f, c, 'initiative.create', createArgs)).toThrow();
}
finally {
    f.close();
} });
it('P05 preserves complete close evidence and rejects malformed editable gate input',()=>{const f=fixture();try{const c=start(f);apply(f,c,preview(f,c,'initiative.create',createArgs));let i=read(f,c,'initiative.list').items[0];const refs=Array.from({length:201},(_,n)=>'.guild/artifacts/proof-'+n+'.txt');for(const ref of refs)put(f,ref,'verified fixture\n');put(f,'.guild/'+i.data.path+'/initiative.yaml',{initiative:{...i.data.manifest,close_gate:{evidence:refs}}});i=read(f,c,'initiative.list').items[0];expect(i.data.close_gate).toBeNull();expect(i.data.close_check.evidence).toHaveLength(201);expect(i.data.close_check.pass).toBe(false);}finally{f.close();}});


it('P05 redacts opaque credential keys across trace artifact manifest and resolved config while preserving numeric usage', () => {
    const f = fixture();
    try {
        const c = start(f), rid = runFixture(f), root = '.guild/runs/' + rid;
        const names = ['token', 'TOKEN', 'access_token', 'Access-Token', 'accessToken', 'access token', 'refresh_token', 'Refresh.Token', 'refreshToken', 'id_token', 'sessionToken', 'bearer', 'Bearer-Token', 'api_key', 'password'];
        const secrets = Object.fromEntries(names.map((name, n) => [name, 'opaque-fixture-' + n]));
        const usage = { input_tokens: 12, output_tokens: 8, total_tokens: 20, cached_tokens: 3, token: 20 };
        const payload = { credentials: secrets, nested: [secrets], usage, text: 'token=opaque-text-fixture' };
        put(f, root + '/trace.jsonl', JSON.stringify(payload) + '\n');
        put(f, root + '/details.json', payload);
        put(f, root + '/resolved-settings.json', payload);
        const manifest = JSON.parse(fs.readFileSync(path.join(f.root, root, 'run.yaml'), 'utf8'));
        put(f, root + '/run.yaml', { ...manifest, nested: [secrets], usage });
        const run = read(f, c, 'run.list').items[0];
        const trace = read(f, c, 'run.trace', run.ref).items[0].data.events[0].event;
        const artifact = JSON.parse(read(f, c, 'run.artifacts', run.ref, 'runs/' + rid + '/details.json').items[0].data.entries[0].preview);
        for (const data of [trace, artifact, run.data.configuration.effective]) {
            for (const name of names) expect(data.nested[0][name]).toBe('[redacted]');
            expect(data.usage).toEqual(usage);
            expect(data.text).not.toContain('opaque-text-fixture');
        }
        for (const name of names) expect(run.data.manifest.nested[0][name]).toBe('[redacted]');
        expect(run.data.manifest.usage).toEqual(usage);
    } finally { f.close(); }
});

it('P05 records canonical resolved host without inferring dispatch qualification', () => {
    const f = fixture();
    try {
        const c = start(f), rid = runFixture(f), rel = '.guild/runs/' + rid + '/run.yaml';
        const original = JSON.parse(fs.readFileSync(path.join(f.root, rel), 'utf8'));
        for (const [host, legacy, expected] of [[{ requested: 'codex', resolved: 'codex' }, 'legacy-host', 'codex'], [{ requested: 'codex' }, 'legacy-host', 'legacy-host'], [{ resolved: 42 }, null, null], [{ requested: 'codex' }, null, null]] as any[]) {
            put(f, rel, { ...original, host, host_resolved: legacy });
            const run = read(f, c, 'run.list').items[0];
            expect(run.data.host.host_id).toBe(expected);
            expect(run.data.host.dispatch_state).toBe('unknown');
            expect(run.data.host.proof).toEqual([]);
            expect(run.data.controls.every((control: any) => control.available === false)).toBe(true);
        }
    } finally { f.close(); }
});

function citedRevision(f: any, c: any) {
    apply(f, c, preview(f, c, 'initiative.create', createArgs));
    const item = read(f, c, 'initiative.list').items[0];
    const definitionPath = '.guild/artifacts/definition-proof.txt', workPath = '.guild/artifacts/work-proof.txt';
    put(f, definitionPath, 'verified definition fixture\n');
    put(f, workPath, 'verified work fixture\n');
    const body = { schema_version: 'guild.stack.initiative_revision.v1', manifest: item.data.manifest, definition_items: item.data.definition_items.map((v: any) => ({ ...v, evidence_refs: [definitionPath + '#acceptance'] })), work_items: [{ id: 'implementation-proof', initiative_id: item.ref.id, title: 'Implementation', type: 'implementation', status: 'proposed', evidence_refs: [workPath] }], close_gate: { evidence: [] } };
    return { item, body, definitionPath, workPath, args: () => ({ target: item.ref, format: 'json', content: JSON.stringify(body) }) };
}

it('P05 snapshots new definition and work evidence through preview replay and apply', () => {
    const f = fixture();
    try {
        const c = start(f), v = citedRevision(f, c);
        const p = preview(f, c, 'initiative.revise', v.args(), [v.item.ref]);
        const journal = JSON.parse(fs.readFileSync(getJournal(f, p.operation_id), 'utf8'));
        for (const rel of [v.definitionPath, v.workPath]) expect(journal.snapshot.find((s: any) => s.path === rel)?.sha256).toBe('sha256:' + createHash('sha256').update(fs.readFileSync(path.join(f.root, rel))).digest('hex'));
        expect(apply(f, c, p).state).toBe('applied');
        expect(read(f, c, 'initiative.list').items[0].data.work_items[0].evidence_refs).toEqual([v.workPath]);
    } finally { f.close(); }
});

it('P05 refuses newly cited evidence changed to different existing bytes after approval', () => {
    const f = fixture();
    try {
        const c = start(f), v = citedRevision(f, c), p = preview(f, c, 'initiative.revise', v.args(), [v.item.ref]);
        f.facade.dispatch({ action: 'decide', operation_id: p.operation_id, request: { session_id: c.sid, preview_hash: p.preview_hash, decision: 'approved', rationale: 'Reviewed exact evidence' } });
        put(f, v.workPath, 'different existing fixture bytes\n');
        expect(() => f.facade.dispatch({ action: 'apply', operation_id: p.operation_id, request: { session_id: c.sid, preview_hash: p.preview_hash, idempotency_key: randomUUID() } })).toThrow();
        expect(read(f, c, 'initiative.list').items[0].data.work_items).toEqual([]);
    } finally { f.close(); }
});

function citedDecision(f: any, c: any) {
    apply(f, c, preview(f, c, 'initiative.create', createArgs));
    const i = read(f, c, 'initiative.list').items[0];
    const rel = 'artifacts/decision-proof.txt'; put(f, '.guild/' + rel, 'verified decision fixture\n');
    const evidence = { source_id: c.source, path: rel, sha256: 'sha256:' + createHash('sha256').update(fs.readFileSync(path.join(f.root, '.guild', rel))).digest('hex'), schema_version: 'guild.stack.raw-evidence.v1', observed_at: '2026-01-01T00:00:00.000Z', freshness: 'current' };
    const body = { schema_version: 'guild.initiative_decision_proposal.v1', initiative: i.ref, rationale: 'Reason', alternatives: ['Alternative'], evidence: [evidence] };
    return { rel, body, evidence, args: () => ({ title: 'Cited decision', owner: 'operator', acceptance: [], body: JSON.stringify(body) }) };
}

it('P05 snapshots nonempty decision evidence and preserves it in immutable events', () => {
    const f = fixture();
    try {
        const c = start(f), v = citedDecision(f, c), p = preview(f, c, 'decision.propose', v.args());
        const result = apply(f, c, p);
        const d = read(f, c, 'decision.inspect', result.after[0]).items[0];
        expect(d.data.head.evidence).toEqual([v.evidence]);
        expect(apply(f, c, preview(f, c, 'decision.approve', { target: d.ref, rationale: 'Approved cited evidence' }, [d.ref])).state).toBe('applied');
    } finally { f.close(); }
});

it('P05 refuses decision evidence changed after preview and cross-source or symlink evidence', () => {
    const f = fixture();
    try {
        const c = start(f), v = citedDecision(f, c), p = preview(f, c, 'decision.propose', v.args());
        put(f, '.guild/' + v.rel, 'changed fixture bytes\n');
        expect(() => apply(f, c, p)).toThrow();
        v.evidence.source_id = 'source:foreign';
        expect(() => preview(f, c, 'decision.propose', v.args())).toThrow();
        v.evidence.source_id = c.source;
        fs.unlinkSync(path.join(f.root, '.guild', v.rel));
        fs.symlinkSync(path.join(f.root, '.guild/config/project.json'), path.join(f.root, '.guild', v.rel));
        expect(() => preview(f, c, 'decision.propose', v.args())).toThrow();
    } finally { f.close(); }
});


it('P05 artifact credential redaction follows content across advertised text formats and preserves numeric usage', () => {
    const f = fixture();
    try {
        const c = start(f), rid = runFixture(f), rel = '.guild/runs/' + rid;
        const payload = { access_token: 'opaque-artifact-fixture', nested: { refreshToken: 'opaque-refresh-fixture' }, usage: { input_tokens: 7, output_tokens: 5, total_tokens: 12 } };
        const contents: Record<string, string> = {
            'trace.jsonl': JSON.stringify(payload) + '\n' + JSON.stringify(payload) + '\n',
            'details.yaml': 'access_token: opaque-artifact-fixture\nnested:\n  refreshToken: opaque-refresh-fixture\nusage:\n  input_tokens: 7\n  output_tokens: 5\n  total_tokens: 12\n',
            'details.yml': '"Access-Token": |\n  opaque-artifact-fixture\n"Refresh.Token": >\n  opaque-refresh-fixture\nusage: {input_tokens: 7, output_tokens: 5, total_tokens: 12}\n',
        };
        for (const ext of ['md', 'txt', 'html', 'csv', 'log']) contents['embedded.' + ext] = JSON.stringify(payload);
        for (const [name, bytes] of Object.entries(contents)) put(f, rel + '/' + name, bytes);
        const original = JSON.parse(fs.readFileSync(path.join(f.root, rel, 'run.yaml'), 'utf8'));
        put(f, rel + '/run.yaml', { ...original, ...payload });
        for (const name of [...Object.keys(contents), 'run.yaml']) {
            const run = read(f, c, 'run.list').items[0];
            const entry = read(f, c, 'run.artifacts', run.ref, 'runs/' + rid + '/' + name).items[0].data.entries[0];
            expect(entry.preview).not.toBeNull();
            expect(entry.preview).not.toContain('opaque-artifact-fixture');
            expect(entry.preview).not.toContain('opaque-refresh-fixture');
            const decoded = entry.preview.trim().split('\n').map((line: string) => JSON.parse(line));
            for (const item of decoded) expect(item.usage).toEqual(payload.usage);
            expect(Buffer.byteLength(entry.preview)).toBeLessThanOrEqual(65536);
        }
    } finally { f.close(); }
});

it('P05 artifact preview refuses ambiguous credential content and YAML alias expansion without raw fallback', () => {
    const f = fixture();
    try {
        const c = start(f), rid = runFixture(f), rel = '.guild/runs/' + rid;
        const contents = {
            'details.csv': 'access_token,input_tokens\nopaque-artifact-fixture,7\n',
            'broken.txt': 'prefix {"access_token":"opaque-artifact-fixture", invalid',
            'details.log': 'INFO {"refresh_token":"opaque-artifact-fixture"}',
            'plain.log': 'INFO access_token: opaque-artifact-fixture',
            'details.html': '<input name="access_token" value="opaque-artifact-fixture">',
            'aliases.yaml': 'loop: &loop\n  again: *loop\naccess_token: opaque-artifact-fixture\n',
        };
        for (const [name, bytes] of Object.entries(contents)) {
            put(f, rel + '/' + name, bytes);
            const run = read(f, c, 'run.list').items[0];
            const data = read(f, c, 'run.artifacts', run.ref, 'runs/' + rid + '/' + name).items[0].data;
            expect(data.entries[0].preview).toBeNull();
            expect(data.issues.some((v: any) => v.code === 'artifact_content_refused')).toBe(true);
            expect(JSON.stringify(data)).not.toContain('opaque-artifact-fixture');
        }
        const safe = '# Notes\n\nReadable ordinary Markdown, with prose and a safe <code>example</code>.\n';
        put(f, rel + '/notes.md', safe);
        const run = read(f, c, 'run.list').items[0];
        expect(read(f, c, 'run.artifacts', run.ref, 'runs/' + rid + '/notes.md').items[0].data.entries[0].preview).toBe(safe);
    } finally { f.close(); }
});
