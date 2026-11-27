import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { StackError, stackHash, stackId, stackRead, stackContained, parseYaml, type StackSource } from "../state";
import { redactTokenShapes, redactKeyValueSecrets } from "../security";
import { sealSet } from "../kernel";
import { validateInitiativeManifest, validateDefinitionItem, ledgerReady, deriveInitiativeStatus, d8CloseGate, DEFINITION_STATUS, EXECUTION_STATUS, RELEASE_STATUS, DOCUMENTATION_STATUS } from "./initiative";
import { validateWorkItem, populateReleaseDocsWorkItems } from "./initiative-workitems";
import { updateRunAttachment } from './run-lifecycle';
import { buildD8Input, checkInitiativeEvidenceRefs } from "./initiative-evidence";
type R = Record<string, any>;
export const P05_READS = sealSet(["initiative.list", "initiative.inspect", "initiative.close_check", "decision.list", "decision.inspect", "run.list", "run.inspect", "run.trace", "run.artifacts"], "P05_READS");
export const P05_WRITES = sealSet(["initiative.create", "initiative.revise", "initiative.link", "initiative.unlink", "initiative.pause", "initiative.close", "initiative.archive", "initiative.restore", "decision.propose", "decision.approve", "decision.reject", "decision.supersede"], "P05_WRITES");
const EMPTY = /* @__PURE__ */ stackHash("");
const json = (v: any) => JSON.stringify(v, null, 2) + "\n";
const issue = (code: string, message: string) => ({ code, message, evidence: [] });
function p05CredentialKey(key: string, value: unknown): boolean {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return /password|credential|secret|authorization|apikey/.test(normalized)
        || (typeof value !== 'number' && /^(?:(?:access|refresh|id|session|auth|authentication|api|bearer)?token|bearer)$/.test(normalized));
}
export function p05Redact(v: any): any { if (typeof v === "string")
    return redactKeyValueSecrets(redactTokenShapes(v)); if (Array.isArray(v))
    return v.map(p05Redact); if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => {
        return [k, p05CredentialKey(k, x) ? "[redacted]" : p05Redact(x)];
    })); return v; }
function p05ArtifactText(bytes: string, relative: string): string | null {
    const structured = (value: any): string => {
        const seen = new Set<object>();
        let nodes = 0;
        const visit = (item: any, depth = 0) => {
            if (++nodes > 10000 || depth > 64) throw new Error('complex artifact');
            if (item && typeof item === 'object') {
                if (seen.has(item)) throw new Error('aliased artifact');
                seen.add(item);
                for (const child of Object.values(item)) visit(child, depth + 1);
            }
        };
        visit(value);
        return JSON.stringify(p05Redact(value));
    };
    const yaml = (text: string) => {
        const value = parseYaml(text);
        if (value === null && text.trim() !== '' && !/^(?:null|~)$/i.test(text.trim())) throw new Error('invalid YAML');
        return value;
    };
    try {
        if (/\.json$/i.test(relative)) return structured(JSON.parse(bytes));
        if (/\.jsonl$/i.test(relative)) return bytes.split(/\r?\n/).map(line => line.trim() ? structured(JSON.parse(line)) : line).join('\n');
        if (/\.ya?ml$/i.test(relative)) return structured(yaml(bytes));
        try { return structured(JSON.parse(bytes)); } catch { /* Other advertised text formats retain safe prose. */ }
        const lines = bytes.split(/\r?\n/);
        if (lines.some(line => line.trim()) && lines.every(line => !line.trim() || /^[\[{]/.test(line.trim())))
            return lines.map(line => line.trim() ? structured(JSON.parse(line)) : line).join('\n');
        const credentialField = [...bytes.matchAll(/["']?([A-Za-z][A-Za-z0-9_. -]{0,63})["']?\s*[:=,\t]/g)].some(match => {
            const words = match[1].trim().split(/\s+/);
            return words.some((_, n) => p05CredentialKey(words.slice(n).join(' '), null));
        }) || [...bytes.matchAll(/["']([^"'\r\n]{1,64})["']/g)].some(match => p05CredentialKey(match[1], null));
        if (credentialField) return null;
        return p05Redact(bytes);
    } catch { return null; }
}
export interface P05Write {
    path: string;
    before_exists: boolean;
    before_bytes: string | null;
    before_hash: string;
    after_exists: boolean;
    after_bytes: string | null;
    after_hash: string;
}
export class StackP05 {
    constructor(readonly source: StackSource, readonly canonical: (v: any) => string, readonly now: () => Date, readonly overlays = new Map<string, string | null>(), readonly snapshotOnly = false, readonly validateSchema?: (schema: string, value: any) => void) { }
    read(rel: string, optional = true): string | null { if (this.overlays.has(rel))
        return this.overlays.get(rel)!; return this.snapshotOnly ? null : stackRead(this.source.realpath, rel, optional); }
    parse(rel: string, optional = true): any { const b = this.read(rel, optional); return b === null ? null : rel.endsWith('.yaml') ? parseYaml(b) : JSON.parse(b); }
    names(rel: string): string[] { let names: string[] = []; try {
        if (!this.snapshotOnly)
            names = fs.readdirSync(stackContained(this.source.realpath, rel)).sort();
    }
    catch (e) {
        if ((e as any).code !== "ENOENT")
            throw e;
    } for (const [p, b] of this.overlays)
        if (b !== null && p.startsWith(rel + '/'))
            names.push(p.slice(rel.length + 1).split('/')[0]); return [...new Set(names)].sort(); }
    directory(rel:string):boolean {
        if([...this.overlays].some(([p,b])=>b!==null&&p.startsWith(rel+'/')))return true;
        if(this.snapshotOnly)return false;
        try{return fs.lstatSync(stackContained(this.source.realpath,rel)).isDirectory();}catch(e){if((e as any).code==='ENOENT'||(e as any).code==='ENOTDIR')return false;throw e;}
    }
    files(rel: string, depth = 0, counter = { n: 0 }): string[] { if (depth > 8)
        throw new StackError("collection_limit", "Artifact depth exceeds eight", 413); const out: string[] = []; for (const n of this.names(rel)) {
        if (++counter.n > 10000)
            throw new StackError("collection_limit", "Snapshot exceeds 10000 entries", 413);
        if (n.startsWith('.') || /^(?:node_modules|runtime|secrets)$/.test(n))
            continue;
        const p = rel + '/' + n;
        let st;
        try {
            if (this.snapshotOnly) {
                const children = [...this.overlays].some(([k, v]) => v !== null && k.startsWith(p + '/'));
                if (children) {
                    out.push(...this.files(p, depth + 1, counter));
                    continue;
                }
                if (this.read(p) !== null)
                    out.push(p);
                continue;
            }
            st = fs.lstatSync(stackContained(this.source.realpath, p));
        }
        catch (e) {
            if ([...this.overlays].some(([k,v])=>v!==null&&k.startsWith(p+'/'))) { out.push(...this.files(p,depth+1,counter)); continue; }
                if (this.overlays.has(p)) {
                if (this.overlays.get(p) !== null)
                    out.push(p);
                continue;
            }
            throw e;
        }
        if (st.isSymbolicLink())
            throw new StackError("unsafe_path", "Symlink is not permitted in canonical aggregate", 403);
        if (st.isDirectory())
            out.push(...this.files(p, depth + 1, counter));
        else if (st.isFile() && (!this.overlays.has(p) || this.overlays.get(p) !== null))
            out.push(p);
    } return out.sort(); }
    digest(files: string[]): string { return stackHash(this.canonical([...new Set(files)].sort().map(p => [p, this.read(p) === null ? null : stackHash(this.read(p)!)]))); }
    evidence(rel: string): any { return { source_id: this.source.source_id, path: rel.startsWith('.guild/')?rel.slice(7):rel, sha256: stackHash(this.read(rel, false)!), schema_version: "guild.stack.raw-evidence.v1", observed_at: this.now().toISOString(), freshness: "current" }; }
    entity(kind: string, id: string, revision: string) { return { source_id: this.source.source_id, kind, id, revision }; }
    runs(): any[] { const out: any[] = []; for (const id of this.names('.guild/runs')) {
        if (id.startsWith('.') || id.startsWith('_'))
            continue;
        stackId(id);
        const rel = '.guild/runs/' + id;
        if(!this.directory(rel))continue;
        if (this.read(rel + '/run.yaml') === null && this.read(rel + '/provenance.json') === null)
            continue;
        out.push(this.run(id));
        if (out.length > 2000)
            throw new StackError("collection_limit", "Run attachment snapshot exceeds limit", 413);
    } return out; }
    run(id: string): any { stackId(id); const rel = '.guild/runs/' + id; const files = ['run.yaml', 'provenance.json', 'workflow-cursor.json', 'attempt.json', 'resolved-settings.json', 'resolved-settings.sha256', 'plugin-config-snapshot.json', 'session-context.json', 'launch.json', 'host-dispatch.json'].map(p => rel + '/' + p); const issues: any[] = []; const get = (n: string) => { try {
        const value=this.parse(rel + '/' + n);if(this.read(rel+'/'+n)!==null&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error('Malformed object');return value;
    }
    catch {
        return issues.push(issue('malformed_record', n + ' is malformed')), null;
    } }; const manifest = get('run.yaml'), provenance = get('provenance.json'); if (this.read(rel+'/run.yaml')===null&&this.read(rel+'/provenance.json')===null)
        throw new StackError('not_found', 'Run not found', 404); const proof = get('host-dispatch.json'); const data = { schema_version: 'guild.stack.run_view.v1', path: rel.slice(7), manifest, provenance, workflow_cursor: get('workflow-cursor.json'), attempt: get('attempt.json'), configuration: { effective: get('resolved-settings.json'), config_hash: get('launch.json')?.config_hash ?? null, evidence: files.filter(p => this.read(p) !== null && /settings|snapshot/.test(p)).map(p => this.evidence(p)) }, host: { host_id: typeof proof?.host_id === 'string' ? proof.host_id : typeof manifest?.host?.resolved === 'string' ? manifest.host.resolved : typeof manifest?.host_resolved === 'string' ? manifest.host_resolved : null, model: proof?.model ?? null, dispatch_state: proof?.state ?? 'unknown', proof: proof ? [this.evidence(rel + '/host-dispatch.json')] : [] }, controls: ['run.start', 'run.resume', 'run.cancel', 'run.rerun'].map(operation => ({ operation, available: false, reason: 'Installed host execution and monetary budget enforcement are not qualified', qualification: 'unavailable' })), evidence: files.filter(p => this.read(p) !== null).map(p => this.evidence(p)), issues }; return { ref: this.entity('run', id, this.digest(files)), data: p05Redact(data) }; }
    locate(id: string): string { stackId(id); const found = ['active', 'archived'].map(b => '.guild/initiatives/' + b + '/' + id).filter(p => this.read(p + '/initiative.yaml') !== null); if (found.length !== 1)
        throw new StackError(found.length ? 'ambiguous_entity' : 'not_found', 'Initiative ownership is missing or ambiguous', 409); return found[0]; }
    attachmentFiles(): string[] { return this.runs().flatMap(r => ['run.yaml', 'provenance.json'].map(n => '.guild/' + r.data.path + '/' + n)); }
    initiatives(): any[] { const ids = [...new Set(['active', 'archived'].flatMap(b => this.names('.guild/initiatives/' + b).filter(id=>this.directory('.guild/initiatives/'+b+'/'+id))))].filter(id => !id.startsWith('.')&&['active','archived'].some(b=>this.read('.guild/initiatives/'+b+'/'+id+'/initiative.yaml')!==null)); return ids.map(id => this.initiative(id)); }
    canonicalInitiativeFiles(rel:string):string[] {
      const paths=['initiative.yaml','summary.md','definition-ledger.json','definition-ledger.md','decisions.md','lifecycle.json'].map(n=>rel+'/'+n).filter(p=>this.read(p)!==null);
      for(const name of this.names(rel+'/work-items'))if(/\.(?:json|ya?ml)$/.test(name))paths.push(rel+'/work-items/'+name);
      paths.push(...this.files(rel+'/decisions').filter(p=>p.endsWith('.json')));
      return paths.sort();
    }
    initiative(id: string): any { const rel = this.locate(id), issues: any[] = []; let outer: any = null; try {
        outer = this.parse(rel + '/initiative.yaml');
    }
    catch {
        issues.push(issue('malformed_record', 'Initiative YAML is malformed'));
    } const nested = outer?.initiative; const m = nested ?? outer; if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length === 0)
        issues.push(issue('malformed_record', 'Initiative must contain a manifest object'));
    else if (!validateInitiativeManifest(m).valid)
        issues.push(issue('invalid_manifest', 'Manifest has missing or unsupported fields')); let compatibility = !m || typeof m !== 'object' ? 'malformed' : !nested ? 'legacy' : validateInitiativeManifest(m).valid ? 'canonical' : 'legacy'; if (m?.schema_version && m.schema_version !== 'guild.initiative.v1')
        compatibility = 'unsupported'; let defs: any[] = [], works: any[] = [], life: any = null; try {
        const d = this.parse(rel + '/definition-ledger.json');
        if (d && d.schema_version === 'guild.initiative_definition_ledger.v1' && Array.isArray(d.items) && d.items.length <= 200 && d.items.every((v: any) => validateDefinitionItem(v).valid && v.initiative_id === id))
            defs = d.items;
        else if (d)
            issues.push(issue('invalid_definition', 'Definition ledger is invalid'));
    }
    catch {
        issues.push(issue('invalid_definition', 'Definition ledger is malformed'));
    } for (const n of this.names(rel + '/work-items')) {
        if (!n.endsWith('.json')) {
            issues.push(issue('legacy_work_item', 'Legacy work item remains read-only'));
            continue;
        }
        try {
            const w = this.parse(rel + '/work-items/' + n);
            if (w?.schema_version !== 'guild.initiative_work_item.v1' || !validateWorkItem(w.item).valid || w.item.initiative_id !== id)
                throw Error();
            works.push(w.item);
        }
        catch {
            issues.push(issue('invalid_work_item', 'Work item is malformed or unsupported'));
        }
    } if (works.length > 200)
        throw new StackError('collection_limit', 'Work items exceed 200', 413); try {
        life = this.parse(rel + '/lifecycle.json');
        if (life && (life.schema_version !== 'guild.initiative_lifecycle.v1' || typeof life.paused !== 'boolean'))
            throw Error();
    }
    catch {
        life = null;
        issues.push(issue('invalid_lifecycle', 'Lifecycle is invalid'));
    } const runs = this.runs(), linked = runs.filter(r => r.data.manifest?.initiative_attachment === id || r.data.provenance?.initiative === id); const dependencies = this.dependencies(works); const axes: any = {}; const enums: any = { definition: DEFINITION_STATUS, execution: EXECUTION_STATUS, release: RELEASE_STATUS, documentation: DOCUMENTATION_STATUS }; const mapped = buildD8Input(m ?? {}, false).input; for (const a of Object.keys(enums)) {
        const raw = m?.[a + '_status'] ?? null;
        const val = enums[a].includes(raw) ? raw : a === 'definition' ? null : (mapped as any)[a + '_status'];
        const known = raw !== null && ((a === 'execution' && ['in_progress', 'in-progress', 'completed', 'complete'].includes(raw)) || (a === 'release' && ['released_to_canon', 'released-to-canon'].includes(raw)) || (a === 'documentation' && ['pending', 'in-sync', 'in_sync', 'not-assessed', 'done'].includes(raw)));
        axes[a] = { raw: typeof raw === 'string' ? raw : null, value: enums[a].includes(raw) ? raw : known ? val : null, normalization: raw === null ? 'missing' : enums[a].includes(raw) ? 'canonical' : known ? 'documented_alias' : 'unsupported' };
    } const closeGate = m?.close_gate === undefined ? { evidence: [] } : m.close_gate; let validCloseGate = closeGate && typeof closeGate === 'object' && !Array.isArray(closeGate) && Object.keys(closeGate).join(',') === 'evidence' && Array.isArray(closeGate.evidence) && closeGate.evidence.every((x: any) => typeof x === 'string'); if(validCloseGate)try{this.validateSchema?.('https://guildstack.dev/contracts/guild-stack/p05/v1/domain.schema.json#/$defs/close_gate_input',closeGate);}catch{validCloseGate=false;}
    if (!validCloseGate)
        issues.push(issue('invalid_close_gate', 'Close gate must contain only repository-relative evidence')); const decisionIds = this.names(rel + '/decisions'); const decisions = decisionIds.map(d => this.decision(id, d)); const files = this.canonicalInitiativeFiles(rel); const evidencePaths = new Set<string>(); const closeErrors: any[] = []; const evidenceResult = checkInitiativeEvidenceRefs(this.source.realpath, path.join(this.source.realpath, rel), m ?? {}); for (const rec of evidenceResult.checked) {
        const p = path.relative(this.source.realpath, rec.resolved_path);
        try {
            stackContained(this.source.realpath, p);
            if (this.read(p) !== null)
                evidencePaths.add(p);
            else
                closeErrors.push(issue('missing_evidence', 'Required evidence is missing'));
        }
        catch {
            closeErrors.push(issue('invalid_evidence', 'Required evidence is unsafe'));
        }
    } if (!evidenceResult.valid)
        closeErrors.push(issue('invalid_evidence', 'Close gate has missing or invalid evidence')); for (const w of [...defs,...works])
        for (const ref of w.evidence_refs ?? []) {
            try {
                if (typeof ref !== 'string' || path.isAbsolute(ref))
                    throw Error();
                const p = ref.split('#')[0];
                stackContained(this.source.realpath, p);
                if (this.read(p) === null)
                    throw Error();
                evidencePaths.add(p);
            }
            catch {
                closeErrors.push(issue('invalid_evidence', 'Work item evidence is missing or unsafe'));
            }
        } let execVerified = linked.length > 0; for (const r of linked) {
        const p = '.guild/' + r.data.path + '/verify.md';
        const bytes = this.read(p);
        if (bytes === null || !this.verifyRunPass(r.ref.id, bytes))
            execVerified = false;
        if (bytes !== null)
            evidencePaths.add(p);
    } if (!ledgerReady(defs) || dependencies.some(d => d.state !== 'satisfied') || works.some(w => !['done', 'cancelled', 'deferred'].includes(w.status)))
        closeErrors.push(issue('unresolved_dependencies', 'Blocking definition or work remains')); if (issues.length)
        closeErrors.push(...issues); const inputs = buildD8Input(m ?? {}, execVerified).input; const result = d8CloseGate(inputs); const revision = this.digest([...files, ...this.attachmentFiles(), ...evidencePaths]); const ref = this.entity('initiative', id, revision); const close = { schema_version: 'guild.stack.initiative_close_check.v1', initiative: ref, inputs, result, evidence: [...evidencePaths].map(p => this.evidence(p)), evidence_errors: closeErrors, pass: compatibility === 'canonical' && result.canClose && closeErrors.length === 0, required_work_items: populateReleaseDocsWorkItems(id, result, inputs.documentation_status) }; const page = (total: number) => ({ next_cursor: null, total, partial: false }); return { ref, data: p05Redact({ schema_version: 'guild.stack.initiative_view.v1', path: rel.slice(7), title: typeof m?.title==='string'?m.title:id, manifest: m&&typeof m==='object'&&!Array.isArray(m)?m:null, close_gate: validCloseGate ? closeGate : null, bucket: rel.split('/')[2], compatibility, axes, derived_status: compatibility === 'canonical' ? deriveInitiativeStatus(m, { paused: life?.paused ?? false, archived: rel.includes('/archived/') }) : null, definition_items: defs, work_items: works, dependencies, linked_runs: linked.map(r => r.ref), decisions: decisions.map(d => d.ref), lifecycle: life, close_check: close, evidence: files.map(p => this.evidence(p)), issues, sections: { definition: page(defs.length), work_items: page(works.length), runs: page(linked.length), decisions: page(decisions.length) } }) }; }
    verifyRunPass(id: string, bytes: string): boolean { const lines = bytes.split(/\r?\n/).filter(l => l.trim() !== ''); if (lines[0] !== '# Verify — ' + id || lines[1] !== 'Overall status: pass' || bytes.includes('✗') || /^Overall status: (?!pass$)/m.test(bytes))
        return false; return [1, 2, 3, 4, 5, 6].every(n => lines.some(l => l.startsWith(n + '. ') && (/\bpass\b/.test(l) || l.includes('✓')))); }
    dependencies(works: any[]): any[] { const ids = new Set(works.map(w => w.id)); if (ids.size !== works.length)
        throw new StackError('invalid_dependencies', 'Duplicate work item IDs', 422); const out: any[] = []; const visit = (id: string, stack: string[]): boolean => { if (stack.includes(id))
        return true; const w = works.find(w => w.id === id); return (w?.depends_on ?? []).some((to: string) => visit(to, [...stack, id])); }; for (const w of works) {
        if (w.depends_on !== undefined && !Array.isArray(w.depends_on))
            throw new StackError('invalid_dependencies', 'Work dependencies must be arrays', 422);
        for (const to of w.depends_on ?? []) {
            const t = works.find(x => x.id === to);
            out.push({ from: w.id, to, state: !ids.has(to) ? 'missing' : visit(w.id, []) ? 'cycle' : t.status === 'done' ? 'satisfied' : 'blocked' });
        }
    } return out; }
    decision(initiativeId: string, id: string): any { stackId(id); const rel = this.locate(initiativeId) + '/decisions/' + id; const files = this.files(rel); if (!files.length)
        throw new StackError('not_found', 'Decision not found', 404); const history: any[] = [], issues: any[] = []; let previous: string | null = null; for (const [idx, p] of files.entries()) {
        try {
            const e = this.parse(p, false);
            this.validateSchema?.('https://guildstack.dev/contracts/guild-stack/p05/v1/domain.schema.json#/$defs/decision_event', e);
            const transition = idx === 0 ? e.event === 'proposed' : history[idx - 1]?.event === 'proposed' ? ['approved', 'rejected'].includes(e.event) : history[idx - 1]?.event === 'approved' ? e.event === 'superseded' : false;
            if (e.schema_version !== 'guild.initiative_decision_event.v1' || e.sequence !== idx + 1 || e.previous_event_hash !== previous || e.initiative_id !== initiativeId || e.decision_id !== id || !transition)
                throw Error();
            history.push(e);
            previous = stackHash(this.read(p, false)!);
        }
        catch {
            issues.push(issue('invalid_history', 'Decision event chain is invalid'));
        }
    } if (history.length > 200)
        throw new StackError('collection_limit', 'Decision history exceeds 200', 413); const head = history.at(-1) ?? null; const authority = this.decisionAuthority(head, this.entity('decision', id, stackHash(this.canonical(files.map(p=>[p.slice(rel.length+1),stackHash(this.read(p,false)!)])))), issues); return { ref: this.entity('decision', id, stackHash(this.canonical(files.map(p=>[p.slice(rel.length+1),stackHash(this.read(p,false)!)])))), data: p05Redact({ authority, schema_version: 'guild.stack.decision_view.v1', initiative: this.entity('initiative', initiativeId, EMPTY), decision_id: id, state: issues.length ? 'invalid' : head?.event ?? 'invalid', head, history, evidence: files.map(p => this.evidence(p)), issues }) }; }
    decisionAuthority(head: any, ref: any, issues: any[]): any {
        if (!head)
            return null;
        const result: any = { status: 'missing', actor: null, approval: null, receipt: null };
        try {
            const op = head.operation, id = stackId(op.operation_id);
            if (op.approval.source_id !== this.source.source_id || op.receipt.source_id !== this.source.source_id || op.approval.path !== 'artifacts/operations/' + id + '/approval.json' || op.receipt.path !== 'artifacts/operations/' + id + '/receipt.json')
                throw Error();
            const ap = '.guild/' + op.approval.path, rp = '.guild/' + op.receipt.path, ab = this.read(ap), rb = this.read(rp);
            if (ab === null) {
                issues.push(issue('missing_authority', 'Decision approval is missing'));
                return result;
            }
            const a = JSON.parse(ab);
            this.validateSchema?.('https://guildstack.dev/contracts/guild-stack/v1/approval-record.schema.json', a);
            if (a.operation_id !== id || a.source_id !== this.source.source_id || a.decision !== 'approved' || a.actor !== 'local operator')
                throw Error();
            result.approval = this.evidence(ap);
            if (rb === null) {
                result.status = 'pending';
                issues.push(issue('pending_authority', 'Decision receipt is pending'));
                return result;
            }
            const r = JSON.parse(rb);
            this.validateSchema?.('https://guildstack.dev/contracts/guild-stack/v1/operation-receipt.schema.json', r);
            if (r.operation_id !== id || r.source_id !== this.source.source_id || r.preview_hash !== a.preview_hash || r.state !== 'applied' || !r.after.some((x: any) => this.canonical(x) === this.canonical(ref)))
                throw Error();
            result.receipt = this.evidence(rp);
            result.status = 'verified';
            result.actor = a.actor;
            return result;
        }
        catch {
            issues.push(issue('invalid_authority', 'Decision operation authority is invalid'));
            return { status: 'invalid', actor: null, approval: null, receipt: null };
        }
    }
    resolve(ref: any): any { if (!ref || ref.source_id !== this.source.source_id)
        throw new StackError('stale_target', 'Target source does not match', 409); let item; if (ref.kind === 'initiative')
        item = this.initiative(stackId(ref.id));
    else if (ref.kind === 'run')
        item = this.run(stackId(ref.id));
    else if (ref.kind === 'decision') {
        const matches = this.initiatives().filter(i => i.data.decisions.some((d: any) => d.id === ref.id));
        if (matches.length !== 1)
            throw new StackError('not_found', 'Decision ownership missing or ambiguous', 404);
        item = this.decision(matches[0].ref.id, ref.id);
            item.data.initiative=matches[0].ref;
    }
    else
        throw new StackError('invalid_target', 'Unsupported target kind', 422); if (this.canonical(item.ref) !== this.canonical(ref))
        throw new StackError('stale_target', 'Canonical aggregate changed', 409); return item; }
    plan(operation: string, args: any, targets: any[], id: string, allocated: string, at: string): any {
        const writes: P05Write[] = [], moves: any[] = [], dependencies: any[] = [];
        let finalTargets: any[] = [], afterKeys: any[] = [];
        const write = (p: string, bytes: string | null) => { if (writes.some(w => w.path === p))
            throw new StackError('invalid_plan', 'Duplicate planned path'); const before = this.read(p); writes.push({ path: p, before_exists: before !== null, before_bytes: before, before_hash: stackHash(before ?? ''), after_exists: bytes !== null, after_bytes: bytes, after_hash: stackHash(bytes ?? '') }); };
        const exact = (expected: any[]) => { if (this.canonical(targets) !== this.canonical(expected))
            throw new StackError('invalid_target', 'Writable targets do not match operation', 422); };
        const event = (initiativeId: string, decisionId: string, type: string, head: any, sequence: number, previous: string | null, replacement: any = null) => ({ schema_version: 'guild.initiative_decision_event.v1', event_id: allocated, decision_id: decisionId, initiative_id: initiativeId, sequence, previous_event_hash: previous, event: type, created_at: at, title: head.title, rationale: head.rationale, alternatives: head.alternatives, evidence: head.evidence, supersedes: null, replacement, operation: { operation_id: id, approval: { source_id: this.source.source_id, path: 'artifacts/operations/' + id + '/approval.json' }, receipt: { source_id: this.source.source_id, path: 'artifacts/operations/' + id + '/receipt.json' } } });
        if (operation === 'initiative.create') {
            exact([]);
            const rel = '.guild/initiatives/active/' + allocated;
            if (this.read(rel + '/initiative.yaml') !== null)
                throw new StackError('creation_collision', 'Allocated initiative exists', 409);
            finalTargets = [this.entity('initiative', allocated, EMPTY)];
            afterKeys = finalTargets;
            const m = { schema_version: 'guild.initiative.v1', id: allocated, title: args.title, summary_ref: rel + '/summary.md', created_at: at, updated_at: at, owner: args.owner, definition_status: 'incomplete', execution_status: 'not_started', release_status: 'not_released', documentation_status: 'not_assessed' };
            write(rel + '/summary.md', args.body + '\n');
            write(rel + '/definition-ledger.json', json({ schema_version: 'guild.initiative_definition_ledger.v1', items: args.acceptance.map((statement: string, n: number) => ({ id: 'acceptance-' + (n + 1), initiative_id: allocated, category: 'acceptance', statement, status: 'defined', blocking: true, updated_at: at })) }));
            write(rel + '/lifecycle.json', json({ schema_version: 'guild.initiative_lifecycle.v1', paused: false, closed_at: null, close_operation_id: null }));
            write(rel + '/initiative.yaml', json({ initiative: m }));
        }
        else if (operation.startsWith('initiative.')) {
            const current = this.resolve(args.target);
            if (current.ref.kind !== 'initiative')
                throw new StackError('invalid_target', 'Initiative target required');
            exact([args.target]);
            finalTargets = targets;
            afterKeys = targets;
            const rel = '.guild/' + current.data.path, m = current.data.manifest;
            if ((current.data.compatibility !== 'canonical' || current.data.close_gate === null) && operation !== 'initiative.revise')
                throw new StackError('unsupported_schema', 'Explicit canonical adoption required', 422);
            if (operation === 'initiative.revise') {
                if (args.format !== 'json')
                    throw new StackError('invalid_revision', 'Initiative revision requires JSON');
                let body;
                try {
                    body = JSON.parse(args.content);
                }
                catch {
                    throw new StackError('invalid_revision', 'Revision must be JSON');
                }
                if (body.schema_version !== 'guild.stack.initiative_revision.v1' || Object.keys(body).sort().join(',') !== 'close_gate,definition_items,manifest,schema_version,work_items' || !validateInitiativeManifest(body.manifest).valid || !Array.isArray(body.definition_items) || !Array.isArray(body.work_items) || body.definition_items.length > 200 || body.work_items.length > 200)
                    throw new StackError('invalid_revision', 'Revision contract is invalid', 422);
                if (body.manifest.id !== m.id || body.manifest.created_at !== m.created_at || body.manifest.scope !== m.scope || body.manifest.project_id !== m.project_id)
                    throw new StackError('immutable_identity', 'Initiative identity cannot change', 422);
                const allowed = new Set([...Object.keys(m), 'schema_version', 'id', 'title', 'summary_ref', 'created_at', 'updated_at', 'owner', 'definition_status', 'execution_status', 'release_status', 'documentation_status']);
                if (Object.keys(body.manifest).some(k => !allowed.has(k)) || Object.keys(m).some(k => !allowed.has(k) || !(k in body.manifest)))
                    throw new StackError('invalid_revision', 'Unknown manifest fields cannot be introduced or removed');
                if (body.definition_items.some((v: any) => !validateDefinitionItem(v).valid || v.initiative_id !== m.id) || new Set(body.definition_items.map((v: any) => v.id)).size !== body.definition_items.length || body.work_items.some((v: any) => !validateWorkItem(v).valid || v.initiative_id !== m.id))
                    throw new StackError('invalid_revision', 'Invalid definition or work item');
                for(const item of [...body.definition_items,...body.work_items])for(const field of ['depends_on','acceptance','evidence_refs'])if(item[field]!==undefined&&(!Array.isArray(item[field])||item[field].some((v:any)=>typeof v!=='string'||v.length===0)))throw new StackError('invalid_revision','Optional item collections must contain strings');
                for(const item of [...body.definition_items,...body.work_items])for(const ref of item.evidence_refs??[]){const rel=ref.split('#')[0];stackContained(this.source.realpath,rel);if(this.read(rel)===null)throw new StackError('missing_evidence','Item evidence is missing');}
                const deps = this.dependencies(body.work_items);
                if (deps.some(d => ['missing', 'cycle'].includes(d.state)) || body.work_items.some((w: any) => ['ready', 'in_progress', 'done'].includes(w.status) && deps.some(d => d.from === w.id && d.state !== 'satisfied')))
                    throw new StackError('invalid_dependencies', 'Unresolved work dependencies');
                if ((body.manifest.definition_status !== 'incomplete'||body.work_items.some((w:any)=>['ready','in_progress','done'].includes(w.status))) && !ledgerReady(body.definition_items))
                    throw new StackError('definition_unresolved', 'Blocking definition is unresolved');
                try{this.validateSchema?.('https://guildstack.dev/contracts/guild-stack/p05/v1/domain.schema.json#/$defs/close_gate_input',body.close_gate);}catch{throw new StackError('invalid_close_gate','Close gate evidence contract invalid');}
                if (!body.close_gate || Object.keys(body.close_gate).join(',') !== 'evidence' || !Array.isArray(body.close_gate.evidence))
                    throw new StackError('invalid_close_gate', 'Close gate accepts only evidence paths');
                const changed = ['execution', 'release', 'documentation'].some(a => body.manifest[a + '_status'] !== m[a + '_status']);
                if (changed && (!body.close_gate || !Array.isArray(body.close_gate.evidence) || body.close_gate.evidence.length === 0))
                    throw new StackError('evidence_required', 'Axis changes require cited evidence');
                for (const p of body.close_gate.evidence ?? []) {
                    if (typeof p !== 'string' || path.isAbsolute(p))
                        throw new StackError('invalid_evidence', 'Evidence must be repository-relative');
                    stackContained(this.source.realpath, p.split('#')[0]);
                    if (this.read(p.split('#')[0]) === null)
                        throw new StackError('missing_evidence', 'Revision evidence is missing');
                }
                write(rel + '/definition-ledger.json', json({ schema_version: 'guild.initiative_definition_ledger.v1', items: body.definition_items }));
                const nextIds = new Set(body.work_items.map((w: any) => w.id));
                for (const n of this.names(rel + '/work-items'))
                    if (n.endsWith('.json') && !nextIds.has(n.slice(0, -5)))
                        write(rel + '/work-items/' + n, null);
                for (const w of body.work_items) {
                    stackId(w.id);
                    write(rel + '/work-items/' + w.id + '.json', json({ schema_version: 'guild.initiative_work_item.v1', item: w }));
                }
                write(rel + '/initiative.yaml', json({ initiative: { ...body.manifest, close_gate: body.close_gate } }));
            }
            else if (operation === 'initiative.link' || operation === 'initiative.unlink') {
                const run = this.resolve(args.related);
                if (run.ref.kind !== 'run')
                    throw new StackError('invalid_target', 'Related run required');
                dependencies.push(run.ref);
                const rm = run.data.manifest;
                if (!rm)
                    throw new StackError('invalid_run', 'Canonical run manifest required');
                const linked = rm.initiative_attachment ?? null;
                if (operation === 'initiative.link' && linked !== null && linked !== m.id || operation === 'initiative.unlink' && linked !== m.id)
                    throw new StackError('attachment_conflict', 'Run belongs to a different initiative');
                const next = operation === 'initiative.link' ? m.id : null;
                const rrel = '.guild/' + run.data.path;
                const patched = updateRunAttachment(rm, this.parse(rrel+'/provenance.json'), next);
                write(rrel+'/run.yaml',json(patched.manifest));
                if(patched.provenance)write(rrel+'/provenance.json',json(patched.provenance));
            }
            else if (operation === 'initiative.pause')
                write(rel + '/lifecycle.json', json({ ...current.data.lifecycle, schema_version: 'guild.initiative_lifecycle.v1', paused: true, closed_at: current.data.lifecycle?.closed_at ?? null, close_operation_id: current.data.lifecycle?.close_operation_id ?? null }));
            else if (['initiative.close', 'initiative.archive', 'initiative.restore'].includes(operation)) {
                const bucket = current.data.bucket, to = operation === 'initiative.restore' ? 'active' : 'archived';
                if (bucket === to)
                    throw new StackError('invalid_transition', 'Initiative already in destination');
                if (operation === 'initiative.close') {
                    if (!current.data.close_check.pass)
                        throw new StackError('close_gate_refused', 'D8 evidence or dependencies unresolved', 422);
                    write(rel + '/lifecycle.json', json({ schema_version: 'guild.initiative_lifecycle.v1', paused: false, closed_at: at, close_operation_id: id }));
                }
                else if (operation === 'initiative.archive' && !current.data.lifecycle?.closed_at)
                    throw new StackError('close_gate_refused', 'Only a closed initiative can be archived');
                const dest = '.guild/initiatives/' + to + '/' + m.id;
                if (this.snapshotOnly) {
                    if (this.names(dest).length)
                        throw new StackError('destination_collision', 'Archive destination exists');
                }
                else {
                    try {
                        stackContained(this.source.realpath, dest);
                        throw new StackError('destination_collision', 'Archive destination exists');
                    }
                    catch (e) {
                        if ((e as any).code !== 'ENOENT')
                            throw e;
                    }
                }
                if(typeof m.summary_ref==='string'&&m.summary_ref.startsWith(rel+'/'))write(rel+'/initiative.yaml',json({initiative:{...m,summary_ref:dest+m.summary_ref.slice(rel.length)}}));
                moves.push({ from: rel, to: dest, before_tree_hash: this.digest(this.files(rel)) });
            }
            else
                throw new StackError('operation_unavailable', 'Initiative host control is unavailable', 503);
        }
        else if (operation.startsWith('decision.')) {
            let initiativeId, decisionId, head: any, sequence = 1, previous: string | null = null, type = operation.split('.')[1], rel: string, current: any;
            if (operation === 'decision.propose') {
                exact([]);
                let body;
                try {
                    body = JSON.parse(args.body);
                }
                catch {
                    throw new StackError('invalid_proposal', 'Decision proposal must be JSON');
                }
                if (body.schema_version !== 'guild.initiative_decision_proposal.v1' || Object.keys(body).sort().join(',') !== 'alternatives,evidence,initiative,rationale,schema_version' || args.acceptance.length !== 0 || !Array.isArray(body.alternatives) || !Array.isArray(body.evidence))
                    throw new StackError('invalid_proposal', 'Decision proposal contract invalid');
                const i = this.resolve(body.initiative);
                if (i.ref.kind !== 'initiative' || i.data.compatibility !== 'canonical')
                    throw new StackError('invalid_target', 'Canonical initiative required');
                dependencies.push(i.ref);
                initiativeId = i.ref.id;
                decisionId = allocated;
                head = { title: args.title, rationale: body.rationale, alternatives: body.alternatives, evidence: body.evidence };
                finalTargets = [this.entity('decision', decisionId, EMPTY)];
                afterKeys = finalTargets;
                type = 'proposed';
                rel = this.locate(initiativeId) + '/decisions/' + decisionId;
            }
            else {
                current = this.resolve(args.target);
                if (current.ref.kind !== 'decision' || current.data.state === 'invalid' || current.data.authority?.status !== 'verified')
                    throw new StackError('invalid_history', 'Valid decision target required');
                initiativeId = current.data.head.initiative_id;
                decisionId = current.ref.id;
                head = { ...current.data.head, rationale: args.rationale };
                rel = this.locate(initiativeId) + '/decisions/' + decisionId;
                sequence = current.data.history.length + 1;
                previous = stackHash(this.read(this.files(rel).at(-1)!, false)!);
                finalTargets = [args.target];
                afterKeys = finalTargets;
                exact(operation === 'decision.supersede' ? [args.target, args.related] : [args.target]);
                if (operation === 'decision.supersede') {
                    const replacement = this.resolve(args.related);
                    if (current.data.state !== 'approved' || replacement.data.state !== 'approved' || replacement.data.head.initiative_id !== initiativeId || replacement.ref.id === decisionId)
                        throw new StackError('invalid_transition', 'Supersede requires two approved decisions in same initiative');
                    finalTargets = [args.target, args.related];
                    afterKeys = finalTargets;
                    type = 'superseded';
                    head = { ...head, replacement: { decision_id: replacement.ref.id, event_hash: stackHash(this.read(this.files(this.locate(initiativeId) + '/decisions/' + replacement.ref.id).at(-1)!, false)!) } };
                }
                else {
                    if (current.data.state !== 'proposed')
                        throw new StackError('invalid_transition', 'Only proposed decision can approve or reject');
                    type = operation === 'decision.approve' ? 'approved' : 'rejected';
                }
            }
            for(const evidence of head.evidence??[]){if(evidence.source_id!==this.source.source_id||evidence.sha256!==stackHash(this.read('.guild/'+evidence.path,false)!))throw new StackError('invalid_evidence','Decision evidence changed or belongs to another source');}
            const e = event(initiativeId, decisionId, type, head, sequence, previous, head.replacement ?? null);
            write(rel + '/' + String(sequence).padStart(6, '0') + '-' + allocated + '.json', json(e));
        }
        else
            throw new StackError('operation_unavailable', 'Unqualified host or unsupported operation', 503);
        const overlay = new Map(this.overlays);
        for (const w of writes)
            overlay.set(w.path, w.after_bytes);
        for (const move of moves) {
            for (const p of this.files(move.from)) {
                overlay.set(move.to + p.slice(move.from.length), overlay.has(p) ? overlay.get(p)! : this.read(p));
                overlay.set(p, null);
            }
            for (const w of writes)
                if (w.path.startsWith(move.from + '/')) {
                    overlay.set(move.to + w.path.slice(move.from.length), w.after_bytes);
                    overlay.set(w.path, null);
                }
        }
        const simulated = new StackP05(this.source, this.canonical, this.now, overlay, this.snapshotOnly, this.validateSchema);
        const after = afterKeys.map(ref => { if (ref.kind === 'initiative')
            return simulated.initiative(ref.id).ref; if (ref.kind === 'decision') {
            const wi = writes.find(w => w.path.includes('/decisions/' + ref.id + '/'));
            if (wi)
                return simulated.decision(JSON.parse(wi.after_bytes!).initiative_id, ref.id).ref;
            return this.resolve(ref).ref;
        } return ref; });
        const diffs = finalTargets.filter(t => writes.some(w => t.kind === 'initiative' || w.path.includes('/decisions/' + t.id + '/')) || moves.length).map(t => ({ target: t, before_hash: t.revision, after_hash: after.find(a => a.kind === t.kind && a.id === t.id)!.revision, patch: json({ writes: writes.map(w => ({ path: w.path.slice(7), before_hash: w.before_hash, after_hash: w.after_hash, after_exists: w.after_exists })), moves }) }));
        return { writes, moves, targets: finalTargets, dependencies, after, diff: diffs };
    }
    readProjection(input: any, secret: string): any {
        const a = input.arguments, op = input.operation, target = a.target;
        let items: any[] = [];
        if (op === 'initiative.list')
            items = this.initiatives();
        else if (op === 'run.list')
            items = this.runs();
        else if (op === 'decision.list') {
            const i = this.resolve(target);
            if (i.ref.kind !== 'initiative')
                throw new StackError('invalid_target', 'Initiative target required');
            items = i.data.decisions.map((d: any) => {const item=this.decision(i.ref.id,d.id);item.data.initiative=i.ref;return item;});
        }
        else {
            const item = this.resolve(target);
            const expected = op.startsWith('initiative.') ? 'initiative' : op.startsWith('decision.') ? 'decision' : 'run';
            if (item.ref.kind !== expected)
                throw new StackError('invalid_target', 'Read target kind does not match');
            items = [op === 'initiative.close_check' ? { ref: item.ref, data: item.data.close_check } : item];
        }
        if (a.query && !['run.trace', 'run.artifacts'].includes(op))
            items = items.filter(i => this.canonical(i.data).toLowerCase().includes(a.query.toLowerCase()));
        let snapshot = stackHash(this.canonical(items.map(i => i.ref))), offset = 0;
        const bind = { session_id: input.session_id, source_id: this.source.source_id, operation: op, target: target ?? null, query: a.query ?? '', snapshot };
        if (op === 'run.trace') {
            const r = items[0], rel = '.guild/' + r.data.path;
            const files = this.files(rel).filter(p => /\.(?:jsonl|ndjson)$/.test(p));
            const events: any[] = [], issues: any[] = [];
            for (const p of files) {
                const st = fs.statSync(stackContained(this.source.realpath, p));
                if (st.size > 1048576) {
                    issues.push(issue('trace_limit', 'Trace file exceeds bounded snapshot'));
                    continue;
                }
                const bytes = this.read(p, false)!;
                for (const line of bytes.split('\n')) {
                    if (!line)
                        continue;
                    if (Buffer.byteLength(line) > 65536) {
                        issues.push(issue('event_limit', 'Trace event exceeds 64KiB'));
                        continue;
                    }
                    try {
                        const event = JSON.parse(line);
                        if (!event || typeof event !== 'object' || Array.isArray(event))
                            throw Error();
                        events.push({ index: events.length, event: p05Redact(event), evidence: this.evidence(p) });
                    }
                    catch {
                        issues.push(issue('malformed_event', 'Trace contains malformed event'));
                    }
                }
            }
            snapshot = this.metadataDigest(files);
            bind.snapshot = snapshot;
            items = [{ ref: r.ref, data: { schema_version: 'guild.stack.run_trace_page.v1', events, snapshot_hash: snapshot, issues } }];
        }
        if (op === 'run.artifacts') {
            const r = items[0], rel = '.guild/' + r.data.path;
            const files = this.files(rel).filter(p => !['binding.json', 'session-context.json'].includes(path.basename(p).toLowerCase()) && !/(?:^|[\/._-])(?:secret|secrets|credential|credentials|auth|token|env)(?:[\/._-]|$)/i.test(p));
            const entries: any[] = [], issues: any[] = [];
            if (a.query && !files.some(p => p.slice(7) === a.query))
                throw new StackError('invalid_artifact', 'Artifact selector must be exact listed run path');
            for (const p of files) {
                if (a.query && p.slice(7) !== a.query)
                    continue;
                const physical = stackContained(this.source.realpath, p);
                const stat = fs.statSync(physical);
                const text = /\.(?:json|jsonl|md|txt|yaml|yml|html|csv|log)$/.test(p);
                let preview = null, truncated = false;
                if (a.query && text) {
                    if (stat.size > 1048576) {
                        issues.push(issue('artifact_limit', 'Artifact exceeds bounded read'));
                        truncated = true;
                    }
                    else {
                        const bytes = this.read(p, false)!;
                        preview = p05ArtifactText(bytes, p);
                        if (preview === null)
                            issues.push(issue('artifact_content_refused', 'Artifact content cannot be safely redacted'));
                        else preview = this.utf8Prefix(preview, 65536);
                        truncated = Buffer.byteLength(bytes) > 65536;
                    }
                }
                let sha: string;
                if (stat.size <= 1048576)
                    sha = stackHash(fs.readFileSync(physical));
                else {
                    const crypto = require('node:crypto');
                    const h = crypto.createHash('sha256'), fd = fs.openSync(physical, 'r'), buffer = Buffer.alloc(65536);
                    try {
                        let n;
                        while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
                            h.update(buffer.subarray(0, n));
                    }
                    finally {
                        fs.closeSync(fd);
                    }
                    sha = 'sha256:' + h.digest('hex');
                }
                entries.push({ evidence: { ...this.evidenceMetadata(p, sha) }, media_type: text ? 'text/plain' : 'application/octet-stream', size_bytes: stat.size, preview, truncated });
            }
            snapshot = stackHash(this.canonical(entries.map(e => [e.evidence.path, e.evidence.sha256])));
            bind.snapshot = snapshot;
            items = [{ ref: r.ref, data: { schema_version: 'guild.stack.run_artifact_page.v1', entries, issues } }];
        }
        const mac = (v: string) => createHmac('sha256', secret).update(v).digest('base64url');
        if (a.cursor) {
            try {
                const [body, sig] = a.cursor.split('.');
                if (sig !== mac(body))
                    throw Error();
                const c = JSON.parse(Buffer.from(body, 'base64url').toString());
                if (this.canonical(c.bind) !== this.canonical(bind) || !Number.isSafeInteger(c.offset) || c.offset < 0)
                    throw Error();
                offset = c.offset;
            }
            catch {
                throw new StackError('stale_cursor', 'Cursor authority or snapshot changed', 409);
            }
        }
        const limit = a.limit ?? 50;
        let total = items.length;
        const field = op === 'run.trace' ? 'events' : op === 'run.artifacts' ? 'entries' : null;
        if (field) {
            total = items[0].data[field].length;
            items[0].data[field] = items[0].data[field].slice(offset, offset + limit);
        }
        else
            items = items.slice(offset, offset + limit);
        let next_cursor = null;
        if (offset + limit < total) {
            const body = Buffer.from(json({ bind, offset: offset + limit })).toString('base64url');
            next_cursor = body + '.' + mac(body);
        }
        const result = { schema_version: 'guild.stack.read-projection.v1', session_id: input.session_id, generation: 0, items, next_cursor, total, partial: false, source_errors: [] };
        if (Buffer.byteLength(json(result)) > 1048576)
            throw new StackError('response_too_large', 'Narrow the projection', 413);
        return result;
    }
    utf8Prefix(value: string, limit: number): string { const b = Buffer.from(value); if (b.length <= limit)
        return value; let end = limit; const decode = new TextDecoder('utf-8', { fatal: true }); while (end > limit - 4) {
        try {
            return decode.decode(b.subarray(0, end));
        }
        catch {
            end--;
        }
    } return ''; }
    metadataDigest(files: string[]): string { return stackHash(this.canonical(files.map(p => { const s = fs.statSync(stackContained(this.source.realpath, p)); return [p, s.size, s.mtimeMs, s.ctimeMs]; }))); }
    evidenceMetadata(rel: string, sha: string) { return { source_id: this.source.source_id, path: rel.slice(7), sha256: sha, schema_version: "guild.stack.raw-evidence.v1", observed_at: this.now().toISOString(), freshness: 'current' }; }
}
