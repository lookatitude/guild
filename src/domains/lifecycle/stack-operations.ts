import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  StackScope,
  StackError,
  stackHash,
  stackId,
  stackRead,
  stackContained,
  createGuildStorage,
  atomicWriteDurable,
  parseYaml,
  type StackSource,
  type GuildStorage,
} from "../state";
import { resolvePolicy, assertPolicyWrite, policyKeySpec } from "../config";
import { canonicalizeRealPath } from "../kernel";
import {
  scrubbedWrite,
  redactTokenShapes,
  redactKeyValueSecrets,
} from "../security";
import {
  applyWorkflowGraphOverlay,
  validateWorkflowGraphDocument,
} from "./workflow-graph-overlay";
import bundle from "./stack-contracts.generated.json";

import { StackP05, P05_READS, P05_WRITES } from "./stack-p05";
import { createRunLifecycle, createRealEnv, type StagedRunStart } from "./run-lifecycle";
import { bindManagedLaunchProof, resolveManagedRunTarget } from "./managed-segment";
import { claimManagedAttempt, managedLaunchHash, reconcileManagedAttempt, markManagedAttemptUncertain, readManagedAttempt, prepareManagedWorker, type ManagedAttemptIdentity, type ManagedLaunchSpec, type ManagedWorkerPackage } from "./managed-run";
export interface ManagedFacadeRuntime {
  availability: string[];
  policy_reason: string;
  host_requirements?:{host_id:string;capability:string;evidence:"verified"|"inferred"|"unavailable";proof:string|null}[];
  resolve(input:{source:StackSource;operation:string;arguments:any;native_session_id?:string}):{launch:ManagedLaunchSpec;worker:ManagedWorkerPackage};
  checkAdmission?(runtime:string,launch:ManagedLaunchSpec):void;
  workerStatus?(runtime:string,identity:ManagedAttemptIdentity):"alive"|"dead"|"unknown";
  launch(runtime:string,identity:ManagedAttemptIdentity,worker:ManagedWorkerPackage):void;
  control(runtime:string,identity:ManagedAttemptIdentity,nonce:string,action:"status"|"cancel"):Promise<any>;
}


type RecordData = Record<string, any>;
const PREFIX = "https://guildstack.dev/contracts/guild-stack/v1/";
const readOps = new Set([
  "session.inspect",
  "session.sources",
  "initiative.list",
  "initiative.inspect",
  "run.list",
  "run.inspect",
  "knowledge.read",
  "memory.list",
  "memory.inspect",
  "workflow.list",
  "workflow.inspect",
  "component.list",
  "component.inspect",
  "config.inspect",
]);
const writeOps = new Set(["config.set", "config.reset"]);
export function stackCanonical(value: any): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        value,
      )
    )
      throw new StackError("invalid_json", "Invalid Unicode");
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    )
      throw new StackError("invalid_json", "Number is not interoperable JSON");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value))
    return "[" + value.map(stackCanonical).join(",") + "]";
  if (
    value &&
    typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => stackCanonical(k) + ":" + stackCanonical(value[k]))
        .join(",") +
      "}"
    );
  throw new StackError("invalid_json", "Unsupported JSON value");
}
export const stackPreviewHash = (preview: RecordData) =>
  stackHash(
    stackCanonical(
      Object.fromEntries(
        Object.entries(preview).filter(([k]) => k !== "preview_hash"),
      ),
    ),
  );
function redacted(value: any): any {
  if (typeof value === "string")
    return redactKeyValueSecrets(redactTokenShapes(value)).slice(0, 8192);
  if (Array.isArray(value)) return value.slice(0, 100).map(redacted);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([k, v]) => [
          k,
          /password|credential|secret|authorization|api[_-]?key/i.test(k)
            ? "[redacted]"
            : redacted(v),
        ]),
    );
  return value;
}
function plain(value: any): value is RecordData {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export interface StackFacadeOptions {
  root: string;
  packageRoot: string;
  validate: (schema: string, value: unknown) => void;
  now?: () => Date;
  managed?: ManagedFacadeRuntime;
}
export function stackManagedReview(record:any,reason:string):any {return {native_session_id:record.native_session_id,budget_mode:record.launch.budget_mode??(record.launch.classification==='local_process_test'?'no_model_test':'strict'),cost_basis:record.launch.budget_mode==='native_estimated_spend_threshold'?'api_equivalent_native_estimate':'unknown',policy_sha256:record.launch.policy_sha256??null,stage_hash:stackHash(stackCanonical(record.stage)),launch_hash:managedLaunchHash(record.launch),worker:record.worker,attempt_id:record.attempt_id,parent:record.parent,parent_attempt_id:record.parent_attempt_id??null,deadline_derivation:"admitted_at + max_duration_ms",budget_reason:reason};}
export class StackFacade {
  readonly scope: StackScope;
  readonly packageRoot: string;
  private readonly validateSchema: StackFacadeOptions["validate"];
  private readonly now: () => Date;
  private readonly managed?: ManagedFacadeRuntime;
  constructor(opts: StackFacadeOptions) {
    this.managed=opts.managed;
    this.scope = new StackScope(opts.root);
    this.packageRoot = fs.realpathSync(opts.packageRoot);
    this.validateSchema = opts.validate;
    this.now = opts.now ?? (() => new Date());
  }
  private validate(name: string, value: any): any {
    try {
      this.validateSchema(PREFIX + name + ".schema.json", value);
    } catch {
      throw new StackError(
        "invalid_contract",
        "Request or result violates " + name,
        422,
      );
    }
    return value;
  }
  private transport(name: string, value: any): void {
    try {
      this.validateSchema(
        PREFIX + "transport.schema.json#/$defs/" + name,
        value,
      );
    } catch {
      throw new StackError("invalid_request", "Request violates " + name, 400);
    }
  }
  private storage(source?: StackSource): GuildStorage {
    const s = source ?? this.scope.discover().root;
    return createGuildStorage(s.realpath, {
      activeRoot: s.realpath,
      profile: s.kind === "workspace" ? "hybrid" : "standalone",
    });
  }
  private runtime(relative: string, source?: StackSource): string {
    const storage = this.storage(source);
    fs.mkdirSync(storage.root.state, { recursive: true });
    const base = canonicalizeRealPath(storage.root.state);
    return stackContained(
      base,
      "roots/" + storage.rootId + "/stack/" + relative,
      true,
    );
  }
  private saveRuntime(relative: string, value: any, source?: StackSource) {
    const target = this.runtime(relative, source);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = target + ".tmp-" + randomUUID();
    const fd = fs.openSync(temp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.renameSync(temp, target);
      const parent = fs.openSync(path.dirname(target), "r");
      try {
        fs.fsyncSync(parent);
      } finally {
        fs.closeSync(parent);
      }
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
  private loadRuntime(relative: string, source?: StackSource): any {
    const p = this.runtime(relative, source);
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new StackError(
          "not_found",
          "Operation or session not found",
          404,
        );
      throw new StackError(
        "invalid_state",
        "Stored operation state is invalid",
        409,
      );
    }
  }
  private discover() {
    return this.scope.discover();
  }
  private bind(): any {
    const { root, children } = this.discover();
    const s = {
      schema_version: "guild.stack.scope-session.v1",
      session_id: randomUUID(),
      mode: root.kind,
      root,
      children,
      package_version: this.packageIdentity().version,
      generation: 0,
      expires_at: new Date(this.now().getTime() + 3600000).toISOString(),
    };
    this.validate("scope-session", s);
    this.saveRuntime("sessions/" + s.session_id + ".json", s);
    return s;
  }
  private session(id: any): any {
    stackId(id);
    const saved = this.loadRuntime("sessions/" + id + ".json");
    this.validate("scope-session", saved);
    if (Date.parse(saved.expires_at) <= this.now().getTime())
      throw new StackError(
        "session_expired",
        "Bind a fresh local session",
        410,
      );
    const fresh = this.discover();
    if (
      stackCanonical([saved.root, ...saved.children]) !==
      stackCanonical([fresh.root, ...fresh.children])
    )
      throw new StackError(
        "scope_changed",
        "Root authority changed; bind a fresh session",
        409,
      );
    return saved;
  }
  private source(session: any, id: any): StackSource {
    stackId(id);
    const s = [session.root, ...session.children].find(
      (x) => x.source_id === id,
    );
    if (!s)
      throw new StackError(
        "unknown_source",
        "Source is not in this bound session",
        403,
      );
    if (s.health !== "healthy")
      throw new StackError(
        "source_unavailable",
        "Registered source is unavailable",
        503,
      );
    return s;
  }
  private packageIdentity(): any {
    const manifests = [
      ".claude-plugin/plugin.json",
      ".codex-plugin/plugin.json",
    ]
      .map((relative) => stackRead(this.packageRoot, relative, true))
      .filter((x): x is string => x !== null)
      .map((x) => JSON.parse(x));
    if (
      !manifests.length ||
      manifests.some(
        (x) =>
          x.name !== manifests[0].name || x.version !== manifests[0].version,
      )
    )
      throw new StackError(
        "package_invalid",
        "Missing or conflicting packaged identity",
        503,
      );
    const manifest = manifests[0];
    const inventory = JSON.parse(
      stackRead(this.packageRoot, "guild.inventory.json")!,
    );
    if (
      inventory.schema_version !== "guild.inventory.v1" ||
      manifest.name !== inventory.manifest?.name ||
      manifest.version !== inventory.manifest?.version ||
      manifest.version !== inventory.plugin_version ||
      !inventory.scripts?.some(
        (x: any) => x.id === "stack-operations" && x.kind === "cli",
      )
    )
      throw new StackError(
        "package_invalid",
        "Packaged Stack entry is not declared consistently",
        503,
      );
    return {
      name: manifest.name,
      version: manifest.version,
      inventory_schema: "guild.inventory.v1",
      entry_hash: this.entryHash(),
    };
  }
  private entryHash(): string {
    const file = stackContained(
      this.packageRoot,
      "runtime/scripts/stack-operations.js",
    );
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 16777216)
      throw new StackError(
        "package_invalid",
        "Packaged entry exceeds executable limit",
        503,
      );
    return stackHash(fs.readFileSync(file));
  }
  private capabilities(): any {
    const catalog = bundle.catalog.operations as RecordData[];
    return this.validate("capability-manifest", {
      schema_version: "guild.stack.capability-manifest.v1",
      package: this.packageIdentity(),
      protocol_major: 1,
      operations: catalog.map((o) => ({
        id: o.id,
        input_schema: o.input_schema,
        output_schema: o.output_schema,
        producer: o.producer,
        effect: o.effect,
        approval: o.approval,
        availability:
          readOps.has(o.id) || writeOps.has(o.id) || P05_READS.has(o.id) || P05_WRITES.has(o.id) || this.managed?.availability.includes(o.id) ? "available" : "unavailable",
        reason:
          this.managed?.availability.includes(o.id)?this.managed.policy_reason:readOps.has(o.id) || writeOps.has(o.id) || P05_READS.has(o.id) || P05_WRITES.has(o.id) || this.managed?.availability.includes(o.id)
            ? null
            : ["run.start","run.rerun","run.resume","run.cancel","initiative.resume"].includes(o.id) ? "Installed Codex CLI lacks a verified measured-USD budget source and host dispatch qualification" : "Domain handler requires " + o.owner_package,
        entry_id:
          P05_READS.has(o.id) ? "stack.p05.read.v1" : readOps.has(o.id) || writeOps.has(o.id) || P05_READS.has(o.id) || P05_WRITES.has(o.id) || this.managed?.availability.includes(o.id) ? "stack-operations" : null,
        target_kinds: o.target_kinds,
      })),
      host_requirements: this.managed?.host_requirements ?? [
        {
          host_id: "codex-cli",
          capability: "spawn",
          evidence: "inferred",
          proof: null,
        },
      ],
    });
  }
  private policy(source: StackSource): any {
    const all = this.discover();
    for (const owner of [
      source,
      ...(all.root.kind === "workspace" && source.realpath !== all.root.realpath
        ? [all.root]
        : []),
    ])
      for (const name of [
        "project.json",
        "project.local.json",
        "workspace.json",
        "workspace.local.json",
      ])
        stackContained(owner.realpath, ".guild/config/" + name, true);
    const result = resolvePolicy({
      cwd: source.realpath,
      ...(all.root.kind === "workspace"
        ? { workspaceRoot: all.root.realpath }
        : {}),
    });
    const revision = stackHash(
      stackCanonical({
        policy: result.policy,
        sources: result.sources,
        files: result.files.map((x) => ({
          layer: x.layer,
          bytes: fs.readFileSync(x.file, "utf8"),
        })),
      }),
    );
    return {
      revision,
      decision: "allowed",
      reason: "Closed policy keys; exact source-owned file",
      effective: result.policy,
    };
  }
  private configPath(source: StackSource): string {
    return ".guild/config/" + source.kind + ".json";
  }
  private config(source: StackSource): any {
    const rel = this.configPath(source);
    const bytes = stackRead(source.realpath, rel, true);
    let local: any = {};
    if (bytes) {
      try {
        local = JSON.parse(bytes);
      } catch {
        throw new StackError(
          "invalid_config",
          "Existing policy JSON is malformed",
          422,
        );
      }
      if (!plain(local))
        throw new StackError(
          "invalid_config",
          "Policy file must be an object",
          422,
        );
    }
    return {
      ref: {
        source_id: source.source_id,
        kind: "config",
        id: "policy." + source.kind,
        revision: stackHash(bytes ?? ""),
      },
      data: {
        local: redacted(local),
        effective: redacted(this.policy(source).effective),
        effective_hash: this.policy(source).revision,
        path: rel.slice(7),
      },
      bytes,
      local,
      relative: rel,
    };
  }
  private records(source: StackSource, collection: string): any[] {
    if (collection === "initiative") return this.domain(source).initiatives();
    if (collection === "run") return this.domain(source).runs();
    if (collection === "config") {
      const c = this.config(source);
      return [{ ref: c.ref, data: c.data }];
    }
    const dirs: Record<string, string[]> = {
      run: [".guild/runs"],
      initiative: [".guild/initiatives/active", ".guild/initiatives/archived"],
      knowledge: [".guild/wiki"],
      memory: [".guild/memory"],
      component: [".guild/agents", ".guild/skills", ".guild/teams"],
    };
    if (collection === "workflow") return this.workflows(source);
    if (!dirs[collection])
      throw new StackError(
        "unknown_collection",
        "Collection is not supported",
        404,
      );
    const out: any[] = [];
    let seen = 0;
    const walk = (relative: string, depth: number) => {
      if (depth > 8 || seen > 10000)
        throw new StackError(
          "collection_limit",
          "Collection requires narrower indexing before it can be read",
          413,
        );
      let names: string[];
      try {
        const p = stackContained(source.realpath, relative);
        names = fs.readdirSync(p).sort();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
        throw e;
      }
      for (const name of names) {
        seen++;
        const rel = relative + "/" + name;
        const p = stackContained(source.realpath, rel);
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          if (collection === "run" || collection === "initiative") {
            if (name.startsWith("_") || name.startsWith(".")) continue;
            const files =
              collection === "run"
                ? ["run.yaml", "provenance.json", "run-state.json"]
                : ["initiative.yaml"];
            const contents = files
              .map((file) => ({
                file,
                body: stackRead(source.realpath, rel + "/" + file, true),
              }))
              .filter((x) => x.body !== null);
            if (!contents.length) continue;
            const data: any = { path: rel.slice(7) };
            for (const c of contents) {
              try {
                data[c.file] = c.file.endsWith(".json")
                  ? JSON.parse(c.body!)
                  : parseYaml(c.body!);
              } catch {
                data[c.file] = { state: "malformed" };
              }
            }
            out.push({
              ref: {
                source_id: source.source_id,
                kind: collection,
                id: stackId(name),
                revision: stackHash(stackCanonical(contents)),
              },
              data: redacted(data),
            });
          } else walk(rel, depth + 1);
        } else if (
          st.isFile() &&
          [".md", ".json", ".yaml", ".yml"].includes(path.extname(name)) &&
          name !== "registry.yaml"
        ) {
          const text = stackRead(source.realpath, rel)!;
          const id =
            (collection === "component" ? "component:" : "") +
            stackHash(rel).slice(7, 39);
          const kind =
            collection === "component"
              ? rel.includes("/agents/")
                ? "agent"
                : rel.includes("/teams/")
                  ? "team"
                  : "skill"
              : collection;
          out.push({
            ref: {
              source_id: source.source_id,
              kind,
              id,
              revision: stackHash(text),
            },
            data: { path: rel.slice(7), content: redacted(text) },
          });
        }
      }
    };
    for (const dir of dirs[collection]) walk(dir, 0);
    return out.sort((a, b) => a.ref.id.localeCompare(b.ref.id));
  }
  private workflows(source: StackSource): any[] {
    const items: any[] = [];
    for (const cls of ["product", "research", "debug", "ops", "init"]) {
      const base = stackRead(
        this.packageRoot,
        "src/surfaces/graphs/" + cls + ".yaml",
        true,
      );
      if (!base) continue;
      const raw = parseYaml(base) as any;
      const checked = validateWorkflowGraphDocument(raw);
      if (!checked.valid)
        throw new StackError(
          "invalid_workflow",
          "Packaged workflow is invalid",
          422,
        );
      const overlay = stackRead(
        source.realpath,
        ".guild/graphs/" + cls + ".yaml",
        true,
      );
      let effective = raw;
      if (overlay) {
        const parsed = parseYaml(overlay) as any;
        effective = applyWorkflowGraphOverlay(raw, parsed);
      }
      items.push({
        ref: {
          source_id: source.source_id,
          kind: "workflow",
          id: cls,
          revision: stackHash(base + "\n" + (overlay ?? "")),
        },
        data: redacted({
          origin: overlay ? "project_overlay" : "packaged_graph",
          definition: effective,
        }),
      });
    }
    return items;
  }
  private projection(input: any, detail = false): any {
    const session = this.session(input.session_id),
      source = this.source(session, input.source_id);
    const collection = String(input.collection);
    const records = this.records(source, collection);
    if (detail) {
      const found = records.find((x) => x.ref.id === stackId(input.entity_id));
      if (!found)
        throw new StackError(
          "not_found",
          "Record not found in owning source",
          404,
        );
      return this.validate("read-projection", {
        schema_version: "guild.stack.read-projection.v1",
        session_id: session.session_id,
        generation: 0,
        items: [found],
        next_cursor: null,
        total: 1,
        partial: false,
        source_errors: [],
      });
    }
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new StackError("invalid_limit", "Limit must be 1..200");
    let offset = 0;
    if (input.cursor !== undefined) {
      try {
        const c = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
        if (
          c.source !== source.source_id ||
          c.collection !== collection ||
          c.revision !== stackHash(stackCanonical(records)) ||
          !Number.isInteger(c.offset) ||
          c.offset < 0
        )
          throw Error();
        offset = c.offset;
      } catch {
        throw new StackError(
          "stale_cursor",
          "Cursor is invalid or source records changed",
          409,
        );
      }
    }
    const next =
      offset + limit < records.length
        ? Buffer.from(
            JSON.stringify({
              source: source.source_id,
              collection,
              revision: stackHash(stackCanonical(records)),
              offset: offset + limit,
            }),
          ).toString("base64url")
        : null;
    return this.validate("read-projection", {
      schema_version: "guild.stack.read-projection.v1",
      session_id: session.session_id,
      generation: 0,
      items: records.slice(offset, offset + limit),
      next_cursor: next,
      total: records.length,
      partial: false,
      source_errors: [],
    });
  }
  private lock<T>(source: StackSource, fn: () => T): T {
    const p = this.runtime("writer.lock", source);
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    try {
      fs.mkdirSync(p, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const reaper = p + ".reclaim";
      try {
        fs.mkdirSync(reaper, { mode: 0o700 });
      } catch {
        throw new StackError(
          "operation_locked",
          "Writer recovery is already owned",
          409,
        );
      }
      try {
        let dead = false;
        try {
          const owner = JSON.parse(
            fs.readFileSync(path.join(p, "owner.json"), "utf8"),
          );
          if (Number.isInteger(owner.pid) && owner.pid > 0) {
            try {
              process.kill(owner.pid, 0);
            } catch (x) {
              dead = (x as NodeJS.ErrnoException).code === "ESRCH";
            }
          }
        } catch {}
        if (!dead)
          throw new StackError(
            "operation_locked",
            "Another operation or unresolved writer lease owns this root",
            409,
          );
        const retired = p + ".retired-" + randomUUID();
        fs.renameSync(p, retired);
        fs.rmSync(retired, { recursive: true, force: true });
        try {
          fs.mkdirSync(p, { mode: 0o700 });
        } catch {
          throw new StackError(
            "operation_locked",
            "Writer lease was claimed concurrently",
            409,
          );
        }
      } finally {
        fs.rmSync(reaper, { recursive: true, force: true });
      }
    }
    try {
      atomicWriteDurable(
        path.join(p, "owner.json"),
        JSON.stringify({ pid: process.pid }),
      );
      return fn();
    } finally {
      fs.rmSync(p, { recursive: true, force: true });
    }
  }
  private evidence(source: StackSource, relative: string): any {
    const bytes = stackRead(source.realpath, relative)!;
    return {
      source_id: source.source_id,
      path: relative.slice(7),
      sha256: stackHash(bytes),
      schema_version: "guild.policy.v1",
      observed_at: this.now().toISOString(),
      freshness: "current",
    };
  }
  private artifactPath(id: string, name: string): string {
    return ".guild/artifacts/operations/" + stackId(id) + "/" + name + ".json";
  }
  private screenedWrite(
    source: StackSource,
    target: string,
    bytes: string,
    id: string,
    relativeToRoot = false,
    typed = false,
  ): void {
    const storage = this.storage(source);
    const audit = (storage.project ?? storage.workspace!).artifact(
      "operations",
    );
    const staged = this.runtime(
      "staging/" + stackId(id) + "-" + randomUUID() + ".json",
      source,
    );
    fs.mkdirSync(path.dirname(staged), { recursive: true, mode: 0o700 });
    try {
      const screened = typed ? this.screenP05Bytes(source, bytes) : bytes;
      const result = scrubbedWrite(staged, screened, {
        surface: "config",
        runDir: audit,
        runId: id,
      });
      if (
        !result.written ||
        result.blocked ||
        fs.readFileSync(staged, "utf8") !== screened
      )
        throw new StackError(
          "content_refused",
          "Durable content changed or was blocked by the security writer",
          403,
        );
      const checked = relativeToRoot
        ? stackContained(source.realpath, target, true)
        : target;
      atomicWriteDurable(checked, bytes);
      let directory = path.dirname(checked);
      while (
        directory.startsWith(source.realpath + path.sep) ||
        directory === source.realpath
      ) {
        const fd = fs.openSync(directory, "r");
        try {
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        if (directory === source.realpath) break;
        directory = path.dirname(directory);
      }
    } finally {
      try {
        fs.unlinkSync(staged);
      } catch {}
    }
  }
  private verifyJournal(source: StackSource, record: any): void {
    const p = record.preview;
    if (record.schema_version === "guild.stack.managed_operation_journal.v1") { this.verifyManagedJournal(source,record);return; }
    if (record.schema_version === "guild.stack.operation_journal.v2") { this.verifyP05Journal(source, record); return; }
    if (
      !writeOps.has(p.operation) ||
      p.preview_hash !== stackPreviewHash(p) ||
      record.relative !== this.configPath(source) ||
      p.diff.length !== 1 ||
      stackHash(record.after) !== p.diff[0].after_hash ||
      stackHash(record.before) !== p.targets[0].revision ||
      stackCanonical(p.diff[0].target) !== stackCanonical(p.targets[0])
    )
      throw new StackError(
        "invalid_state",
        "Stored writer content does not match reviewed preview",
        409,
      );
  }
  private verifyReceipt(source: StackSource, record: any, value: any): void {
    this.validate("operation-receipt", value);
    if(record.schema_version==='guild.stack.operation_journal.v2'){
      if(stackCanonical(value.before)!==stackCanonical(record.preview.targets)||stackCanonical(value.after)!==stackCanonical(record.expected_after))throw new StackError('invalid_state','Domain receipt references differ from reviewed outcome',409);
      const expected=new Map<string,string>();
      for(const w of record.writes){let rel=w.path;for(const m of record.moves)if(rel.startsWith(m.from+'/'))rel=m.to+rel.slice(m.from.length);if(w.after_exists)expected.set(rel.slice(7),w.after_hash);}
      for(const m of record.moves)for(const f of record.snapshot)if(f.path.startsWith(m.from+'/')){const rel=m.to+f.path.slice(m.from.length);if(!record.writes.some((w:any)=>w.path===f.path))expected.set(rel.slice(7),f.sha256);}
      if(value.touched.length!==expected.size||value.touched.some((e:any)=>e.source_id!==source.source_id||expected.get(e.path)!==e.sha256))throw new StackError('invalid_state','Domain receipt evidence differs from journal',409);
    }
    if (
      value.operation_id !== record.preview.operation_id ||
      value.source_id !== source.source_id ||
      value.operation !== record.preview.operation ||
      value.preview_hash !== record.preview.preview_hash ||
      value.idempotency_key !== record.apply_key ||
      value.state !== "applied"
    )
      throw new StackError(
        "invalid_state",
        "Receipt does not match this operation",
        409,
      );
  }
  private operation(
    session: any,
    id: any,
  ): { source: StackSource; record: any } {
    stackId(id);
    for (const source of [session.root, ...session.children] as StackSource[]) {
      if (source.health !== "healthy") continue;
      try {
        const record = this.loadRuntime("operations/" + id + ".json", source);
        this.validate("operation-preview", record.preview);
        if (
          record.preview.operation_id !== id ||
          record.preview.source_id !== source.source_id
        )
          throw new StackError(
            "invalid_state",
            "Operation ownership is inconsistent",
            409,
          );
        this.verifyJournal(source, record);
        return { source, record };
      } catch (e) {
        if (e instanceof StackError && e.code === "not_found") continue;
        throw e;
      }
    }
    throw new StackError(
      "not_found",
      "Operation not found in bound sources",
      404,
    );
  }
  private preview(request: any): any {
    this.transport("preview_request", request);
    const session = this.session(request.session_id),
      source = this.source(session, request.source_id);
    if (source.read_only_reason)
      throw new StackError(
        "read_only",
        "Source requires activation before management writes",
        403,
      );
    if (this.managed?.availability.includes(request.operation)) return this.previewManaged(session,source,request);
    if (!writeOps.has(request.operation) && !P05_WRITES.has(request.operation))
      throw new StackError(
        "operation_unavailable",
        "Operation has no packaged management handler yet",
        503,
      );
    if (P05_WRITES.has(request.operation)) return this.previewP05(session, source, request);
    return this.lock(source, () => {
      const config = this.config(source),
        args = request.arguments;
      if (
        request.targets.length !== 1 ||
        stackCanonical(request.targets[0]) !== stackCanonical(config.ref) ||
        stackCanonical(args.target) !== stackCanonical(config.ref)
      )
        throw new StackError(
          "stale_target",
          "Configuration target/revision does not match owning source",
          409,
        );
      if (
        args.layer !== source.kind ||
        args.reset !== (request.operation === "config.reset")
      )
        throw new StackError(
          "invalid_layer",
          "Operation and editable policy layer do not agree",
          422,
        );
      const spec = policyKeySpec(args.key);
      if (!spec)
        throw new StackError("policy_refused", "Unknown policy key", 403);
      const key = assertPolicyWrite(
        args.key,
        args.reset ? spec.default : args.value,
        { where: "Guild Stack preview" },
      );
      let beforeValue: any = config.local;
      for (const part of key.split("."))
        beforeValue = plain(beforeValue) ? beforeValue[part] : undefined;
      const next = structuredClone(config.local);
      let parent = next;
      const parts = key.split(".");
      for (const part of parts.slice(0, -1)) {
        if (parent[part] === undefined) parent[part] = {};
        if (!plain(parent[part]))
          throw new StackError(
            "invalid_config",
            "Existing policy path is not an object",
            422,
          );
        parent = parent[part];
      }
      if (args.reset) delete parent[parts.at(-1)!];
      else parent[parts.at(-1)!] = args.value;
      const after = JSON.stringify(next, null, 2) + "\n";
      const currentPolicy = this.policy(source);
      const capabilities = this.capabilities();
      const fingerprint = stackHash(stackCanonical(request));
      const keyPath =
        "idempotency/" + stackHash(request.idempotency_key).slice(7) + ".json";
      try {
        const previous = this.loadRuntime(keyPath, source);
        if (previous.fingerprint !== fingerprint)
          throw new StackError(
            "idempotency_conflict",
            "Idempotency key was used for different content",
            409,
          );
        return this.loadRuntime(
          "operations/" + previous.operation_id + ".json",
          source,
        ).preview;
      } catch (e) {
        if (!(e instanceof StackError && e.code === "not_found")) throw e;
      }
      const id = "op:" + randomUUID();
      const result = {
        schema_version: "guild.stack.operation-preview.v1",
        operation_id: id,
        operation: request.operation,
        session_id: session.session_id,
        source_id: source.source_id,
        targets: [config.ref],
        dependencies: [],
        arguments: args,
        diff: [
          {
            target: config.ref,
            before_hash: config.ref.revision,
            after_hash: stackHash(after),
            patch: JSON.stringify({
              key,
              before: beforeValue ?? null,
              proposed: args.reset ? null : args.value,
            }),
          },
        ],
        policy: {
          decision: "allowed",
          revision: currentPolicy.revision,
          reason: currentPolicy.reason,
        },
        approval_required: true,
        preview_hash: "",
        scope_revision: source.revision,
        capability_revision: stackHash(stackCanonical(capabilities)),
        expires_at: new Date(
          Math.min(
            this.now().getTime() + 600000,
            Date.parse(session.expires_at),
          ),
        ).toISOString(),
        rollback: "not_available",
        budget: { max_usd: null, max_duration_ms: 30000 },
      };
      result.preview_hash = stackPreviewHash(result);
      this.validate("operation-preview", result);
      this.saveRuntime(
        "operations/" + id + ".json",
        {
          preview: result,
          before: config.bytes ?? "",
          after,
          relative: config.relative,
          state: "previewed",
          pid: null,
          apply_key: null,
        },
        source,
      );
      this.saveRuntime(keyPath, { fingerprint, operation_id: id }, source);
      return result;
    });
  }
  private fresh(
    session: any,
    source: StackSource,
    record: any,
    hash: any,
  ): void {
    const p = record.preview;
    if (p.preview_hash !== hash || p.preview_hash !== stackPreviewHash(p))
      throw new StackError(
        "preview_changed",
        "Preview identity does not match exact content",
        409,
      );
    if (
      p.session_id !== session.session_id ||
      p.scope_revision !== source.revision ||
      source.read_only_reason
    )
      throw new StackError(
        "stale_scope",
        "Preview belongs to stale scope/session authority",
        409,
      );
    if (Date.parse(p.expires_at) <= this.now().getTime())
      throw new StackError(
        "preview_expired",
        "Review a fresh preview before deciding",
        410,
      );
    if (
      p.capability_revision !==
        stackHash(stackCanonical(this.capabilities())) ||
      p.policy.revision !== this.policy(source).revision ||
      (!["guild.stack.operation_journal.v2","guild.stack.managed_operation_journal.v1"].includes(record.schema_version) && this.config(source).ref.revision !== p.targets[0].revision)
    )
      throw new StackError(
        "stale_preview",
        "Target, policy or package changed since preview",
        409,
      );
    if (record.schema_version === "guild.stack.managed_operation_journal.v1") { this.freshManaged(source,record);return; }
    if (record.schema_version === "guild.stack.operation_journal.v2") { this.freshP05(source, record); return; }
    const current = this.config(source).ref;
    if (stackCanonical(current) !== stackCanonical(p.arguments.target))
      throw new StackError(
        "stale_target",
        "Operation argument target is outside current authority",
        409,
      );
  }
  private decide(input: any): any {
    this.transport("decision_request", input.request);
    const session = this.session(input.request.session_id);
    const { source, record } = this.operation(session, input.operation_id);
    return this.lock(source, () => {
      const { record } = this.operation(session, input.operation_id);
      if (record.state === "cancelled")
        throw new StackError(
          "cancelled",
          "Cancelled operation cannot be decided",
          409,
        );
      this.fresh(session, source, record, input.request.preview_hash);
      if (
        !["approved", "rejected", "returned"].includes(
          input.request.decision,
        ) ||
        (input.request.decision !== "approved" &&
          !input.request.rationale.trim())
      )
        throw new StackError(
          "rationale_required",
          "A rejection or return requires rationale",
          422,
        );
      const relative = this.artifactPath(input.operation_id, "approval");
      const existing = stackRead(source.realpath, relative, true);
      const approval = {
        schema_version: "guild.stack.approval-record.v1",
        approval_id: input.operation_id,
        operation_id: input.operation_id,
        source_id: source.source_id,
        session_id: session.session_id,
        preview_hash: record.preview.preview_hash,
        actor: "local operator",
        decision: input.request.decision,
        rationale: input.request.rationale,
        decided_at: this.now().toISOString(),
      };
      this.validate("approval-record", approval);
      if (existing) {
        const old = JSON.parse(existing);
        if (
          old.decision !== approval.decision ||
          old.preview_hash !== approval.preview_hash ||
          old.rationale !== approval.rationale
        )
          throw new StackError(
            "decision_immutable",
            "A recorded decision cannot be changed; create a new preview",
            409,
          );
        return old;
      }
      this.screenedWrite(
        source,
        relative,
        JSON.stringify(approval, null, 2) + "\n",
        input.operation_id,
        true,
      );
      return approval;
    });
  }
  private receipt(
    source: StackSource,
    record: any,
    id: string,
    state = "applied",
    error: any = null,
  ): any {
    if (record.schema_version === "guild.stack.operation_journal.v2") return this.receiptP05(source, record, id, state, error);
    const after = this.config(source).ref;
    const ref = this.evidence(source, record.relative);
    const value = {
      schema_version: "guild.stack.operation-receipt.v1",
      operation_id: id,
      operation: record.preview.operation,
      source_id: source.source_id,
      idempotency_key: record.apply_key,
      preview_hash: record.preview.preview_hash,
      producer: { id: "guild", version: this.packageIdentity().version },
      state,
      before: record.preview.targets,
      after: [after],
      touched: [ref],
      validation: [],
      error,
      inverse_ref: null,
      closed_at: this.now().toISOString(),
    };
    this.validate("operation-receipt", value);
    this.screenedWrite(
      source,
      this.artifactPath(id, "receipt"),
      JSON.stringify(value, null, 2) + "\n",
      id,
      true,
    );
    record.state = state === "applied" ? "succeeded" : "recovery_needed";
    record.pid = null;
    this.saveRuntime("operations/" + id + ".json", record, source);
    return value;
  }
  private apply(input: any): any {
    this.transport("apply_request", input.request);
    const session = this.session(input.request.session_id);
    const { source, record } = this.operation(session, input.operation_id);
    return this.lock(source, () => {
      const { record } = this.operation(session, input.operation_id);
      const existing = stackRead(
        source.realpath,
        this.artifactPath(input.operation_id, "receipt"),
        true,
      );
      if (existing) {
        const receipt = JSON.parse(existing);
        this.verifyReceipt(source, record, receipt);
        if (
          receipt.idempotency_key !== input.request.idempotency_key ||
          receipt.preview_hash !== input.request.preview_hash
        )
          throw new StackError(
            "idempotency_conflict",
            "Applied operation cannot be reused for new content",
            409,
          );
        return receipt;
      }
      if(record.schema_version==="guild.stack.managed_operation_journal.v1"&&record.state!=="previewed"&&record.apply_key){
        if(record.apply_key!==input.request.idempotency_key||record.preview.preview_hash!==input.request.preview_hash)throw new StackError("idempotency_conflict","Managed Apply replay differs",409);
        return this.statusManaged(source,record);
      }
      if (record.state === "running" || record.state === "recovery_needed")
        throw new StackError(
          "recovery_required",
          "Reconcile the operation before retrying a write",
          409,
        );
      if (record.state === "cancelled")
        throw new StackError(
          "cancelled",
          "Cancelled operation cannot apply",
          409,
        );
      this.fresh(session, source, record, input.request.preview_hash);
      const raw = stackRead(
        source.realpath,
        this.artifactPath(input.operation_id, "approval"),
        true,
      );
      if (!raw)
        throw new StackError(
          "approval_required",
          "Exact producer approval is required",
          403,
        );
      const approval = JSON.parse(raw);
      this.validate("approval-record", approval);
      if (
        approval.decision !== "approved" ||
        approval.operation_id !== record.preview.operation_id ||
        approval.source_id !== source.source_id ||
        approval.session_id !== session.session_id ||
        approval.preview_hash !== record.preview.preview_hash
      )
        throw new StackError(
          "approval_required",
          "Approval is not valid for this exact operation",
          403,
        );
      record.apply_key = input.request.idempotency_key;
      record.state = "running";
      record.pid = process.pid;
      this.saveRuntime(
        "operations/" + input.operation_id + ".json",
        record,
        source,
      );
      try {
        if (record.schema_version === "guild.stack.managed_operation_journal.v1") return this.applyManaged(source,record);
        if (record.schema_version === "guild.stack.operation_journal.v2") { this.applyP05(source, record, input.operation_id); return this.receiptP05(source, record, input.operation_id); }
        this.screenedWrite(
          source,
          record.relative,
          record.after,
          input.operation_id,
          true,
        );
        return this.receipt(source, record, input.operation_id);
      } catch (error) {
        record.state = "recovery_needed";
        record.pid = null;
        this.saveRuntime(
          "operations/" + input.operation_id + ".json",
          record,
          source,
        );
        throw error;
      }
    });
  }
  private status(input: any, cancel = false): any {
    if (cancel) this.transport("cancel_request", input.request);
    const session = this.session(
      cancel ? input.request.session_id : input.session_id,
    );
    const { source, record } = this.operation(session, input.operation_id);
    if(record.schema_version==="guild.stack.managed_operation_journal.v1"){
      if(cancel){if(record.apply_key)throw new StackError("cancel_requires_review","Review run.cancel for an admitted host attempt",409);record.state="cancelled";this.saveRuntime("operations/"+input.operation_id+".json",record,source);}
      return this.lock(source,()=>{const current=this.operation(session,input.operation_id).record;return this.statusManaged(source,current);});
    }
    let receipt: any = null;
    const raw = stackRead(
      source.realpath,
      this.artifactPath(input.operation_id, "receipt"),
      true,
    );
    if (raw) {
      receipt = JSON.parse(raw);
      this.verifyReceipt(source, record, receipt);
    }
    if (!receipt && ["running","recovery_needed"].includes(record.state)) {
      let alive = false;
      try {
        if (record.pid) {
          process.kill(record.pid, 0);
          alive = true;
        }
      } catch {}
      if (!alive) {
        receipt = this.lock(source, () => {
          const { record: current } = this.operation(
            session,
            input.operation_id,
          );
          const existing = stackRead(
            source.realpath,
            this.artifactPath(input.operation_id, "receipt"),
            true,
          );
          if (existing) {
            const found = JSON.parse(existing);
            this.verifyReceipt(source, current, found);
            return found;
          }
          let currentAlive = false;
          try {
            if (current.pid) {
              process.kill(current.pid, 0);
              currentAlive = true;
            }
          } catch {}
          if (!["running","recovery_needed"].includes(current.state) || currentAlive) {
            Object.assign(record, current);
            return null;
          }
          const approvalBytes = stackRead(
            source.realpath,
            this.artifactPath(input.operation_id, "approval"),
            true,
          );
          let approved = false;
          if (approvalBytes) {
            const approval = JSON.parse(approvalBytes);
            this.validate("approval-record", approval);
            approved =
              approval.operation_id === current.preview.operation_id &&
              approval.source_id === source.source_id &&
              approval.preview_hash === current.preview.preview_hash &&
              approval.session_id === current.preview.session_id &&
              approval.decision === "approved";
          }
          if (current.schema_version === "guild.stack.operation_journal.v2") {
            if (approved && this.p05Outcome(source, current)) return this.receiptP05(source, current, input.operation_id);
            current.state="recovery_needed"; current.pid=null; this.saveRuntime("operations/"+input.operation_id+".json",current,source); Object.assign(record,current);return null;
          }
          const content =
            stackRead(source.realpath, current.relative, true) ?? "";
          if (
            approved &&
            stackHash(content) === current.preview.diff[0].after_hash
          )
            return this.receipt(source, current, input.operation_id);
          current.state = "recovery_needed";
          current.pid = null;
          this.saveRuntime(
            "operations/" + input.operation_id + ".json",
            current,
            source,
          );
          Object.assign(record, current);
          return null;
        });
      }
    }
    if (cancel && !receipt)
      return this.lock(source, () => {
        const { record: current } = this.operation(session, input.operation_id);
        if (
          current.state === "running" ||
          current.state === "recovery_needed" ||
          current.state === "succeeded"
        )
          throw new StackError(
            "cancel_not_supported",
            "Atomic policy writer cannot be interrupted; reconcile its receipt",
            409,
          );
        current.state = "cancelled";
        this.saveRuntime(
          "operations/" + input.operation_id + ".json",
          current,
          source,
        );
        return this.validateStatus({
          schema_version: "guild.stack.operation_status.v1",
          operation_id: input.operation_id,
          source_id: source.source_id,
          state: "cancelled",
          receipt: null,
          generation: 0,
        });
      });
    return this.validateStatus({
      schema_version: "guild.stack.operation_status.v1",
      operation_id: input.operation_id,
      source_id: source.source_id,
      state: receipt
        ? "succeeded"
        : record.state === "previewed"
          ? "queued"
          : record.state,
      receipt,
      generation: 0,
    });
  }

  private screenP05Bytes(source:StackSource,bytes:string):string {
    let value:any;try{value=JSON.parse(bytes);}catch{return bytes;}
    let seq=0;
    const mask=(object:any,key:string)=>{object[key]='path-'+(++seq);};
    const refs=(items:any)=>{if(items===undefined)return;if(!Array.isArray(items))throw new StackError('invalid_evidence','Evidence references must be arrays');for(let n=0;n<items.length;n++){const rel=items[n];if(typeof rel!=='string'||path.isAbsolute(rel))throw new StackError('invalid_evidence','Evidence path must be relative');stackContained(source.realpath,rel.split('#')[0]);if(stackRead(source.realpath,rel.split('#')[0])===null)throw new StackError('missing_evidence','Evidence is missing');items[n]='path-'+(++seq);}};
    const evidence=(items:any)=>{if(!Array.isArray(items))return;for(const e of items){if(e.source_id!==source.source_id||typeof e.path!=='string'||e.sha256!==stackHash(stackRead(source.realpath,'.guild/'+e.path)!))throw new StackError('invalid_evidence','Evidence does not match current source bytes');mask(e,'path');}};
    if(value.initiative&&typeof value.initiative==='object'){
      const m=value.initiative,expected=new RegExp('^\\.guild/initiatives/(?:active|archived)/'+stackId(m.id)+'/summary\\.md$');
      if(typeof m.summary_ref==='string'&&expected.test(m.summary_ref))mask(m,'summary_ref');
      if(m.close_gate)refs(m.close_gate.evidence);
    }
    if(value.schema_version==='guild.initiative_definition_ledger.v1')for(const item of value.items)refs(item.evidence_refs);
    if(value.schema_version==='guild.initiative_work_item.v1')refs(value.item.evidence_refs);
    if(value.schema_version==='guild.initiative_decision_event.v1'){
      const id=stackId(value.operation.operation_id);
      for(const kind of ['approval','receipt']){const pointer=value.operation[kind];if(pointer.source_id!==source.source_id||pointer.path!=='artifacts/operations/'+id+'/'+kind+'.json')throw new StackError('invalid_evidence','Decision operation pointer is not canonical');mask(pointer,'path');}
      evidence(value.evidence);
    }
    if(value.schema_version==='guild.stack.operation-receipt.v1')evidence(value.touched);
    return JSON.stringify(value,null,2)+'\n';
  }
  private domain(source: StackSource): StackP05 { return new StackP05(source, stackCanonical, this.now, new Map(), false, this.validateSchema); }
  private readP05(input: any): any {
      try {
          this.validateSchema("https://guildstack.dev/contracts/guild-stack/p05/v1/domain.schema.json#/$defs/read_request", input);
      }
      catch {
          throw new StackError("invalid_request", "P05 read contract invalid", 400);
      }
      const session = this.session(input.session_id), source = this.source(session, input.source_id);
      let secret: string;
      try {
          secret = this.loadRuntime("cursor-secret.json", source).secret;
      }
      catch (e) {
          if (!(e instanceof StackError && e.code === 'not_found'))
              throw e;
          secret = randomUUID() + randomUUID();
          this.saveRuntime("cursor-secret.json", { secret }, source);
      }
      return this.validate("read-projection", this.domain(source).readProjection(input, secret));
  }
  private snapshotP05(source: StackSource, domain: StackP05): any[] {
      const paths = new Set<string>();
      for (const item of domain.initiatives())for(const p of domain.canonicalInitiativeFiles('.guild/'+item.data.path))paths.add(p);
      for(const run of domain.runs())for(const name of ['run.yaml','provenance.json','workflow-cursor.json','attempt.json','resolved-settings.json','resolved-settings.sha256','plugin-config-snapshot.json','session-context.json','launch.json','host-dispatch.json','verify.md']){const p='.guild/'+run.data.path+'/'+name;if(domain.read(p)!==null)paths.add(p);}
      for (const item of domain.initiatives()) {
          for(const rel of item.data.close_gate?.evidence??[])paths.add(rel.split('#')[0]);
          for(const work of [...item.data.definition_items,...item.data.work_items])for(const rel of work.evidence_refs??[])paths.add(rel.split('#')[0]);
          for (const ref of item.data.decisions) {
              const decision = domain.decision(item.ref.id, ref.id);
              for (const event of decision.data.history)
                  for (const kind of ['approval', 'receipt']) {
                      const pointer = event.operation?.[kind];
                      if (pointer?.source_id === source.source_id && domain.read('.guild/' + pointer.path) !== null)
                          paths.add('.guild/' + pointer.path);
                  }
          }
      }
      return [...paths].sort().map(p => ({ path: p, bytes: domain.read(p), sha256: stackHash(domain.read(p) ?? '') }));
  }
  private verifyP05Journal(source: StackSource, record: any): void {
      const p = record.preview;
      if (record.handler !== p.operation || !P05_WRITES.has(p.operation) || p.preview_hash !== stackPreviewHash(p) || !Array.isArray(record.writes) || !Array.isArray(record.moves) || !Array.isArray(record.snapshot))
          throw new StackError('invalid_state', 'Invalid P05 journal', 409);
      if (new Set(record.snapshot.map((s: any) => s.path)).size !== record.snapshot.length
          || stackCanonical(record.read_set) !== stackCanonical(record.snapshot.map((s: any) => ({ source_id: source.source_id, path: s.path, exists: s.bytes !== null, sha256: s.sha256 }))))
          throw new StackError('invalid_state', 'Snapshot read authority differs from source', 409);
      for (const s of record.snapshot) {
          stackContained(source.realpath, s.path, true);
          if (stackHash(s.bytes ?? '') !== s.sha256)
              throw new StackError('invalid_state', 'Snapshot bytes corrupted', 409);
      }
      const domain = new StackP05(source, stackCanonical, this.now, new Map(record.snapshot.map((s: any) => [s.path, s.bytes])), true, this.validateSchema);
      let plan;
      try {
          plan = domain.plan(p.operation, p.arguments, record.request_targets, p.operation_id, record.allocated, record.planned_at);
      }
      catch (e) {
          throw new StackError('invalid_state', 'Journal cannot reproduce handler plan: ' + (e instanceof StackError ? e.code : 'invalid_inputs'), 409);
      }
      for (const key of ['writes', 'moves', 'targets', 'dependencies', 'diff', 'after'])
          if (stackCanonical(plan[key]) !== stackCanonical(key === 'targets' ? p.targets : key === 'dependencies' ? p.dependencies : key === 'diff' ? p.diff : key === 'after' ? record.expected_after : record[key]))
              throw new StackError('invalid_state', 'Journal differs from reviewed handler plan', 409);
  }
  private previewP05(session: any, source: StackSource, request: any): any {
      return this.lock(source, () => {
          const keyPath = 'idempotency/' + stackHash(request.idempotency_key).slice(7) + '.json', fingerprint = stackHash(stackCanonical(request));
          try {
              const previous = this.loadRuntime(keyPath, source);
              if (previous.fingerprint !== fingerprint)
                  throw new StackError('idempotency_conflict', 'Key already used', 409);
              return this.loadRuntime('operations/' + previous.operation_id + '.json', source).preview;
          }
          catch (e) {
              if (!(e instanceof StackError && e.code === 'not_found'))
                  throw e;
          }
          // An unresolved multi-file writer blocks every overlapping source mutation.
          const operations = this.runtime('operations', source);
          if (fs.existsSync(operations))
              for (const name of fs.readdirSync(operations)) {
                  const old = JSON.parse(fs.readFileSync(path.join(operations, name), 'utf8'));
                  if (['running', 'recovery_needed'].includes(old.state))
                      throw new StackError('recovery_required', 'Source has an unresolved writer', 409);
              }
          const id = 'op-' + randomUUID(), allocated = (request.operation === 'initiative.create' ? 'initiative-' : request.operation === 'decision.propose' ? 'decision-' : 'event-') + randomUUID(), at = this.now().toISOString();
          const domain = this.domain(source), snapshot = this.snapshotP05(source, domain), plan = domain.plan(request.operation, request.arguments, request.targets, id, allocated, at);
          const addEvidence = (relative: string, expectedHash?: string) => {
              stackContained(source.realpath, relative);
              const bytes = domain.read(relative, false), sha256 = stackHash(bytes!);
              if (expectedHash !== undefined && expectedHash !== sha256)
                  throw new StackError('invalid_evidence', 'Evidence changed before preview', 409);
              const existing = snapshot.find((s: any) => s.path === relative);
              if (existing && existing.sha256 !== sha256)
                  throw new StackError('stale_preview', 'Evidence changed while planning', 409);
              if (!existing) snapshot.push({ path: relative, bytes, sha256 });
          };
          for (const w of plan.writes) {
              if (!w.after_bytes || !/\.(json|yaml)$/.test(w.path)) continue;
              const value = w.path.endsWith('.yaml') ? parseYaml(w.after_bytes) as any : JSON.parse(w.after_bytes);
              for (const ref of value?.initiative?.close_gate?.evidence ?? []) addEvidence(ref.split('#')[0]);
              const items = value?.schema_version === 'guild.initiative_definition_ledger.v1' ? value.items
                  : value?.schema_version === 'guild.initiative_work_item.v1' ? [value.item] : [];
              for (const item of items) for (const ref of item.evidence_refs ?? []) addEvidence(ref.split('#')[0]);
              if (value?.schema_version === 'guild.initiative_decision_event.v1')
                  for (const ref of value.evidence ?? []) {
                      if (ref.source_id !== source.source_id)
                          throw new StackError('invalid_evidence', 'Evidence belongs to another source', 409);
                      addEvidence('.guild/' + ref.path, ref.sha256);
                  }
          }
          for(const move of plan.moves)for(const p of domain.files(move.from))if(!snapshot.some((s:any)=>s.path===p)){const bytes=domain.read(p,false);snapshot.push({path:p,bytes,sha256:stackHash(bytes??'')});}
      const policy = this.policy(source), capabilities = this.capabilities();
          const p: any = { schema_version: 'guild.stack.operation-preview.v1', operation_id: id, operation: request.operation, session_id: session.session_id, source_id: source.source_id, targets: plan.targets, dependencies: plan.dependencies, arguments: request.arguments, diff: plan.diff, policy: { decision: 'allowed', revision: policy.revision, reason: 'Exact canonical domain handler and source-owned write set' }, approval_required: true, preview_hash: '', scope_revision: source.revision, capability_revision: stackHash(stackCanonical(capabilities)), expires_at: new Date(Math.min(this.now().getTime() + 600000, Date.parse(session.expires_at))).toISOString(), rollback: 'handoff', budget: { max_usd: null, max_duration_ms: 30000 } };
          p.preview_hash = stackPreviewHash(p);
          this.validate('operation-preview', p);
          const record = { schema_version: 'guild.stack.operation_journal.v2', handler: request.operation, preview: p, writes: plan.writes, moves: plan.moves, expected_after: plan.after, snapshot, read_set: snapshot.map((s: any) => ({ source_id: source.source_id, path: s.path, exists: s.bytes !== null, sha256: s.sha256 })), allocated, planned_at: at, request_targets: request.targets, state: 'previewed', pid: null, apply_key: null, host_intent: null };
          this.verifyP05Journal(source, record);
          this.saveRuntime('operations/' + id + '.json', record, source);
          this.saveRuntime(keyPath, { fingerprint, operation_id: id }, source);
          return p;
      });
  }
  private freshP05(source: StackSource, record: any): void {
      const p = record.preview, domain = this.domain(source);
      for (const input of record.read_set) {
          if (input.source_id !== source.source_id)
              throw new StackError('invalid_state', 'Evidence read belongs to another source', 409);
          const bytes = stackRead(source.realpath, input.path, true);
          if ((bytes !== null) !== input.exists || stackHash(bytes ?? '') !== input.sha256)
              throw new StackError('stale_preview', 'Reviewed evidence bytes changed', 409);
      }
      const plan = domain.plan(p.operation, p.arguments, record.request_targets, p.operation_id, record.allocated, record.planned_at);
      for (const key of ['writes', 'moves', 'targets', 'dependencies', 'diff', 'after'])
          if (stackCanonical(plan[key]) !== stackCanonical(key === 'targets' ? p.targets : key === 'dependencies' ? p.dependencies : key === 'diff' ? p.diff : key === 'after' ? record.expected_after : record[key]))
              throw new StackError('stale_preview', 'Domain handler inputs or evidence changed', 409);
  }
  private applyP05(source: StackSource, record: any, id: string): void {
      for (const w of record.writes) {
          const before = stackRead(source.realpath, w.path, true);
          if ((before !== null) !== w.before_exists || stackHash(before ?? '') !== w.before_hash)
              throw new StackError('stale_preview', 'Planned file changed before apply', 409);
      }
      // Scrub every byte before the first canonical write.
      for (const w of record.writes)
          if (w.after_exists) {
              const staged = this.runtime('staging/' + randomUUID() + '.json', source);
              fs.mkdirSync(path.dirname(staged), { recursive: true, mode: 0o700 });
              try {
                  const result = scrubbedWrite(staged, this.screenP05Bytes(source, w.after_bytes), { surface: 'config', runDir: (this.storage(source).project ?? this.storage(source).workspace!).artifact('operations'), runId: id });
                  if (!result.written || result.blocked || fs.readFileSync(staged, 'utf8') !== this.screenP05Bytes(source, w.after_bytes))
                      throw new StackError('content_refused', 'Reviewed bytes failed security writer: ' + w.path, 403);
              }
              finally {
                  fs.rmSync(staged, { force: true });
              }
          }
      for (const w of record.writes) {
          if (w.after_exists)
              this.screenedWrite(source, w.path, w.after_bytes, id, true, true);
          else
              fs.unlinkSync(stackContained(source.realpath, w.path));
      }
      for (const move of record.moves) {
          const from = stackContained(source.realpath, move.from), to = stackContained(source.realpath, move.to, true);
          if (fs.existsSync(to))
              throw new StackError('destination_collision', 'Move destination exists', 409);
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.renameSync(from, to);
          for (const dir of new Set([path.dirname(from), path.dirname(to)])) {
              const fd = fs.openSync(dir, 'r');
              try {
                  fs.fsyncSync(fd);
              }
              finally {
                  fs.closeSync(fd);
              }
          }
      }
      if (!this.p05Outcome(source, record))
          throw new StackError('recovery_required', 'Actual bytes differ from reviewed outcome', 409);
  }
  private p05Outcome(source: StackSource, record: any): boolean {
      try {
          for (const w of record.writes) {
              let rel = w.path;
              for (const m of record.moves)
                  if (rel.startsWith(m.from + '/'))
                      rel = m.to + rel.slice(m.from.length);
              const b = stackRead(source.realpath, rel, true);
              if ((b !== null) !== w.after_exists || stackHash(b ?? '') !== w.after_hash)
                  return false;
          }
          for (const m of record.moves) {
              if (fs.existsSync(stackContained(source.realpath, m.from, true)) || !fs.existsSync(stackContained(source.realpath, m.to)))
                  return false;
          }
          const domain = this.domain(source);
          for (const ref of record.expected_after)
              domain.resolve(ref);
          return true;
      }
      catch {
          return false;
      }
  }
  private receiptP05(source: StackSource, record: any, id: string, state = 'applied', error: any = null): any {
      if (state === 'applied' && !this.p05Outcome(source, record))
          throw new StackError('recovery_required', 'Cannot attest incomplete domain write', 409);
      const domain = this.domain(source), touched: any[] = [];
      for (const w of record.writes) {
          let rel = w.path;
          for (const m of record.moves)
              if (rel.startsWith(m.from + '/'))
                  rel = m.to + rel.slice(m.from.length);
          if (w.after_exists)
              touched.push(domain.evidence(rel));
      }
      for (const m of record.moves)
          for (const rel of domain.files(m.to))
              if (!touched.some(e => e.path === rel.slice(7)))
                  touched.push(domain.evidence(rel));
      const value = { schema_version: 'guild.stack.operation-receipt.v1', operation_id: id, operation: record.preview.operation, source_id: source.source_id, idempotency_key: record.apply_key, preview_hash: record.preview.preview_hash, producer: { id: 'guild', version: this.packageIdentity().version }, state, before: record.preview.targets, after: record.expected_after, touched, validation: [], error, inverse_ref: null, closed_at: this.now().toISOString() };
      this.validate('operation-receipt', value);
      this.screenedWrite(source, this.artifactPath(id, 'receipt'), JSON.stringify(value, null, 2) + '\n', id, true, true);
      record.state = state === 'applied' ? 'succeeded' : 'recovery_needed';
      record.pid = null;
      this.saveRuntime('operations/' + id + '.json', record, source);
      return value;
  }
  private validateStatus(value: any): any {
    this.transport("operation_status", value);
    return value;
  }
  private managedRuntime(source:StackSource):string {return this.runtime("managed",source);}
  private managedReview(record:any):any {return stackManagedReview(record,this.managed!.policy_reason);}

  private verifyManagedJournal(source:StackSource,record:any):void {
    const p=record.preview;
    if(!this.managed||p.source_id!==source.source_id||!this.managed.availability.includes(p.operation)||p.preview_hash!==stackPreviewHash(p)||record.stage.root!==source.realpath||p.diff.length!==1||p.diff[0].after_hash!==stackHash(stackCanonical(this.managedReview(record)))||record.launch.max_duration_ms!==p.budget.max_duration_ms||record.launch.max_usd!==p.budget.max_usd)throw new StackError("invalid_state","Managed journal differs from reviewed authority",409);
  }
  private previewManaged(session:any,source:StackSource,request:any):any {
    try{this.validateSchema(bundle.catalog.operations.find((op:any)=>op.id===request.operation)!.input_schema,request.arguments);}catch{throw new StackError("invalid_contract","Managed arguments violate frozen P01 contract",422);}
    return this.lock(source,()=>{
      if(!["run.start","run.rerun"].includes(request.operation))throw new StackError("operation_unavailable","Managed control requires recorded session/attempt qualification",503);
      const key="idempotency/"+stackHash(request.idempotency_key).slice(7)+".json",fingerprint=stackHash(stackCanonical(request));
      try{const prior=this.loadRuntime(key,source);if(prior.fingerprint!==fingerprint)throw new StackError("idempotency_conflict","Key already used",409);return this.loadRuntime("operations/"+prior.operation_id+".json",source).preview;}catch(error){if(!(error instanceof StackError&&error.code==="not_found"))throw error;}
      const args=request.arguments,config=this.config(source),workflow=this.workflows(source).find(row=>stackCanonical(row.ref)===stackCanonical(args.workflow));
      if(!workflow||args.workflow.source_id!==source.source_id||args.config_hash!==config.data.effective_hash)throw new StackError("stale_preview","Exact current workflow and effective configuration required",409);
      if(request.operation==="run.rerun"&&request.targets.length===1)resolveManagedRunTarget({root:source.realpath,run_id:request.targets[0].id,source_id:source.source_id,host_id:args.host_id});
      const parent=request.operation==="run.rerun"?(request.targets.length===1?this.domain(source).run(request.targets[0].id):null):null;
      if(request.operation==="run.start"&&request.targets.length||request.operation==="run.rerun"&&(!parent||stackCanonical(parent.ref)!==stackCanonical(request.targets[0])))throw new StackError("stale_target","Exact source-qualified parent required",409);
      const initiative=args.initiative===null?null:this.domain(source).initiative(args.initiative.id);
      if(initiative&&stackCanonical(initiative.ref)!==stackCanonical(args.initiative))throw new StackError("stale_target","Exact source-qualified initiative required",409);
      const native_session_id=randomUUID();
      const resolved=this.managed!.resolve({source,operation:request.operation,arguments:args,native_session_id});
      if(resolved.launch.cwd!==source.realpath||resolved.launch.max_duration_ms!==args.max_duration_ms||resolved.launch.max_usd!==args.max_usd||resolved.launch.host_id!==args.host_id||resolved.launch.model!==args.model)throw new StackError("invalid_host_plan","Host plan differs from reviewed arguments",409);
      const env=createRealEnv(source.realpath,requested=>({requested,resolved:resolved.launch.host_id.startsWith("claude")?"claude":"codex"}));env.now=()=>this.now().toISOString();
      const stage=createRunLifecycle(env).stageRunStart({command:"/guild:build",arguments:{brief:args.brief,workflow:args.workflow.id},cwd:source.realpath,root:source.realpath,target_kind:"existing_guild_project",workspace:{is_workspace:source.kind==="workspace",root:source.realpath},project:path.basename(source.realpath),host_requested:resolved.launch.host_id.startsWith("claude")?"claude":"codex",model_tier_policy:"explicit",ignore_policy:"project",scan_policy:"none",initiative:initiative?.ref.id??null,session_identity:{envelope_host:resolved.launch.host_id.startsWith("claude")?"claude":"codex",active_model:resolved.launch.model}},{detached:true});
      const id="op-"+randomUUID(),record:any={schema_version:"guild.stack.managed_operation_journal.v1",native_session_id,stage,launch:resolved.launch,worker:resolved.worker,attempt_id:"attempt-"+randomUUID(),parent:parent?.ref??null,parent_attempt_id:parent?.data.attempt?.attempt_id??null,state:"previewed",pid:null,apply_key:null,identity:null};
      const target={source_id:source.source_id,kind:"run",id:stage.run_id,revision:stackHash("")},review=this.managedReview(record);
      const p:any={schema_version:"guild.stack.operation-preview.v1",operation_id:id,operation:request.operation,session_id:session.session_id,source_id:source.source_id,targets:parent?[parent.ref]:[target],dependencies:[workflow.ref,config.ref,...(initiative?[initiative.ref]:[])],arguments:args,diff:[{target,before_hash:stackHash(""),after_hash:stackHash(stackCanonical(review)),patch:JSON.stringify(review)}],policy:{decision:"allowed",revision:this.policy(source).revision,reason:this.managed!.policy_reason},approval_required:true,preview_hash:"",scope_revision:source.revision,capability_revision:stackHash(stackCanonical(this.capabilities())),expires_at:new Date(Math.min(this.now().getTime()+600000,Date.parse(session.expires_at))).toISOString(),rollback:"handoff",budget:{max_usd:args.max_usd,max_duration_ms:args.max_duration_ms}};
      p.preview_hash=stackPreviewHash(p);this.validate("operation-preview",p);record.preview=p;this.verifyManagedJournal(source,record);this.saveRuntime("operations/"+id+".json",record,source);this.saveRuntime(key,{fingerprint,operation_id:id},source);return p;
    });
  }
  private freshManaged(source:StackSource,record:any):void {
    this.verifyManagedJournal(source,record);const p=record.preview;
    const deps=[...this.workflows(source).map(row=>row.ref),this.config(source).ref,...this.domain(source).initiatives().map((row:any)=>row.ref)];
    if(p.dependencies.some((ref:any)=>!deps.some(current=>stackCanonical(ref)===stackCanonical(current))))throw new StackError("stale_preview","Managed dependency changed",409);
    if(record.parent&&stackCanonical(this.domain(source).run(record.parent.id).ref)!==stackCanonical(record.parent))throw new StackError("stale_target","Rerun parent changed",409);
    for(const read of record.stage.read_set)if(stackRead(source.realpath,read.path,true)!==read.bytes)throw new StackError("stale_preview","Lifecycle read set changed",409);
    const current=this.managed!.resolve({source,operation:p.operation,arguments:p.arguments,native_session_id:record.native_session_id});if(stackCanonical(current)!==stackCanonical({launch:record.launch,worker:record.worker}))throw new StackError("stale_preview","Host binary/package/launch changed",409);
  }
  private applyManaged(source:StackSource,record:any):any {
    const runtime=this.managedRuntime(source),p=record.preview;
    this.managed!.checkAdmission?.(runtime,record.launch);
    const claim=claimManagedAttempt(runtime,{source_id:source.source_id,operation_id:p.operation_id,run_id:record.stage.run_id,attempt_id:record.attempt_id,launch_hash:managedLaunchHash(record.launch),max_duration_ms:record.launch.max_duration_ms});
    record.identity=claim.identity;record.pid=null;this.saveRuntime("operations/"+p.operation_id+".json",record,source);
    if(!claim.created)throw new StackError("recovery_required","Managed claim already exists; never automatically dispatch again",409);
    createRunLifecycle(createRealEnv(source.realpath,requested=>({requested,resolved:record.launch.host_id.startsWith("claude")?"claude":"codex"}))).materializeRunStart(record.stage);
    const launch={schema_version:"guild.stack.managed_launch.v1",source_id:source.source_id,run_id:record.stage.run_id,operation_id:p.operation_id,operation:p.operation,attempt_id:record.attempt_id,classification:record.launch.classification,profile:record.launch.profile??null,host_binary_sha256:record.launch.binary_sha256,policy_sha256:record.launch.policy_sha256??null,budget_mode:record.launch.budget_mode??"strict",cost_basis:record.launch.budget_mode==="native_estimated_spend_threshold"?"api_equivalent_native_estimate":"unknown",preview_hash:p.preview_hash,arguments:p.arguments,native_session_id:record.native_session_id,parent_run:record.parent,parent_attempt_id:record.parent_attempt_id??null,launch_hash:record.identity.launch_hash,worker:{node_sha256:record.worker.node_sha256,entry_sha256:record.worker.entry_sha256},budget_semantics:p.policy.reason};
    this.screenedWrite(source,".guild/runs/"+record.stage.run_id+"/launch.json",JSON.stringify(launch,null,2)+"\n",p.operation_id,true);
    prepareManagedWorker(runtime,{sourceRoot:source.realpath,identity:claim.identity,launch:record.launch,worker:record.worker});this.managed!.launch(runtime,claim.identity,record.worker);return this.validateStatus({schema_version:"guild.stack.operation_status.v1",operation_id:p.operation_id,source_id:source.source_id,state:"running",receipt:null,generation:0});
  }
  private statusManaged(source:StackSource,record:any):any {
    const p=record.preview;let receipt:any=null,state=record.state==="previewed"?"queued":record.state;
    const bytes=stackRead(source.realpath,this.artifactPath(p.operation_id,"receipt"),true);if(bytes){receipt=JSON.parse(bytes);this.verifyReceipt(source,record,receipt);state="succeeded";}
    else if(record.identity){
      const claim=readManagedAttempt(this.managedRuntime(source),record.identity.attempt_id);
      if(stackCanonical(claim.identity)!==stackCanonical(record.identity))throw new StackError("invalid_state","Managed claim changed",409);
      if(claim.host){
        const launchBytes=stackRead(source.realpath,".guild/runs/"+record.stage.run_id+"/launch.json",true);
        let launchProof:unknown=null;try{launchProof=launchBytes===null?null:JSON.parse(launchBytes);}catch{launchProof=null;}
        bindManagedLaunchProof(launchProof,{source_id:source.source_id,run_id:record.stage.run_id,operation_id:p.operation_id,operation:p.operation,attempt_id:record.attempt_id,launch_hash:record.identity.launch_hash,parent_run:record.parent});
        receipt={schema_version:"guild.stack.operation-receipt.v1",operation_id:p.operation_id,operation:p.operation,source_id:source.source_id,idempotency_key:record.apply_key,preview_hash:p.preview_hash,producer:{id:"guild",version:this.packageIdentity().version},state:"applied",before:p.targets,after:[this.domain(source).run(record.stage.run_id).ref],touched:[this.evidence(source,".guild/runs/"+record.stage.run_id+"/attempts/"+record.attempt_id+"/intent.json")],validation:[],error:null,inverse_ref:null,closed_at:this.now().toISOString()};
        this.validate("operation-receipt",receipt);this.screenedWrite(source,this.artifactPath(p.operation_id,"receipt"),JSON.stringify(receipt,null,2)+"\n",p.operation_id,true,true);record.state="succeeded";this.saveRuntime("operations/"+p.operation_id+".json",record,source);state="succeeded";
      }else{
        let owned=false;try{owned=this.managed?.workerStatus?.(this.managedRuntime(source),record.identity)==="alive";}catch{}
        const reconciled=reconcileManagedAttempt(this.managedRuntime(source),record.identity,{verifyOwnedWorker:()=>owned});
        if(reconciled.state==="recovery_needed"){markManagedAttemptUncertain(this.managedRuntime(source),record.identity);record.state="recovery_needed";record.pid=null;this.saveRuntime("operations/"+p.operation_id+".json",record,source);state="recovery_needed";}
      }
    }
    return this.validateStatus({schema_version:"guild.stack.operation_status.v1",operation_id:p.operation_id,source_id:source.source_id,state,receipt,generation:0});
  }
  dispatch(input: any): any {
    if (!plain(input) || typeof input.action !== "string")
      throw new StackError("invalid_request", "Expected a typed Stack action");
    if (input.action === "read") return this.readP05(input);
    const shape = (bundle.transport.actions as RecordData)[input.action];
    if (!shape)
      throw new StackError(
        "unknown_action",
        "Action is not in the packaged facade",
        404,
      );
    const permitted = new Set(["action", ...Object.keys(shape)]);
    if (Object.keys(input).some((k) => !permitted.has(k)))
      throw new StackError("invalid_request", "Unknown action field");
    switch (input.action) {
      case "bind":
        return this.bind();
      case "session":
        return this.session(input.session_id);
      case "capabilities":
        this.session(input.session_id);
        return this.capabilities();
      case "list":
        return this.projection(input);
      case "inspect":
        return this.projection(input, true);
      case "preview":
        return this.preview(input.request);
      case "decide":
        return this.decide(input);
      case "apply":
        return this.apply(input);
      case "status":
        return this.status(input);
      case "cancel":
        return this.status(input, true);
      default:
        throw new StackError("unknown_action", "Unsupported action");
    }
  }
}
