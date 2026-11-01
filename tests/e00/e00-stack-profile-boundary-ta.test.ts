/**
 * E00-T0 baseline guard (R67) · the packaged Stack facade never creates,
 * overwrites or moves into a project agent profile (.guild/agents/**).
 *
 * Independent check of the UI/P05 owner's claim about src/domains/lifecycle/
 * stack-operations.ts (sha256 b54bd68b...): writes are limited to the exact
 * config file (writeOps, configPath, verifyJournal) or P05 initiative/decision/
 * run journals reproduced from the reviewed handler plan (verifyP05Journal,
 * freshP05); any other preview operation is operation_unavailable.
 *
 * Expected baseline-negative controls (they pass on current code; they are not
 * fixes). Fixtures follow the existing facade tests (scripts/stack-operations.
 * test.ts, src/domains/lifecycle/stack-p05.test.ts): an owned temp project root,
 * a fixture package, GUILD_STATE_HOME inside the owned root, and only the public
 * dispatch() actions. The R67 writer intent is planted the only way a caller
 * could: by editing the facade's own persisted operation journal after an
 * approval, then asking dispatch() to apply it.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";

import { StackFacade } from "../../src/domains/lifecycle";
import { StackError } from "../../src/domains/state";
import { stackValidator } from "../../scripts/lib/stack-contract-validator";
import { ownedTempDir, sha256, teardownOwned, walkFiles } from "./support/e00-harness";

afterEach(teardownOwned);

const PROFILE = ".guild/agents/backend.md";
const REGISTRY = ".guild/agents/registry.yaml";
const PLANTED_NEW = ".guild/agents/r67-planted.md";
const PLANTED_MOVE = ".guild/agents/r67-moved";
const PLANTED_BYTES = "---\nname: r67-planted\n---\nplanted R67 writer intent\n";

interface F { root: string; state: string; facade: StackFacade; restore(): void }

function fixture(): F {
  const dir = ownedTempDir("guild-e00-stackguard-");
  const root = path.join(dir, "project"), pkg = path.join(dir, "package");
  fs.mkdirSync(path.join(root, ".guild", "config"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  fs.writeFileSync(path.join(root, ".guild", "storage-layout.json"), JSON.stringify({ storage_layout_version: 2 }));
  fs.writeFileSync(path.join(root, ".guild", "config", "project.json"), JSON.stringify({ advisorRounds: 2, tiers: { default: "mid" } }));
  fs.mkdirSync(path.join(root, ".guild", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, PROFILE), "---\nname: backend\ntype: specialist\n---\nexisting project profile\n");
  fs.writeFileSync(path.join(root, REGISTRY), "schema_version: guild.agents_registry.v1\nagents:\n  - backend\n");
  fs.mkdirSync(path.join(pkg, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "runtime", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(pkg, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "guild", version: "3.2.0-beta.1" }));
  fs.writeFileSync(path.join(pkg, "guild.inventory.json"), JSON.stringify({
    schema_version: "guild.inventory.v1", plugin_version: "3.2.0-beta.1",
    manifest: { name: "guild", version: "3.2.0-beta.1" }, scripts: [{ id: "stack-operations", kind: "cli" }],
  }));
  fs.writeFileSync(path.join(pkg, "runtime", "scripts", "stack-operations.js"), "fixture entry");
  const previous = process.env["GUILD_STATE_HOME"];
  const state = path.join(dir, "state");
  process.env["GUILD_STATE_HOME"] = state;
  const facade = new StackFacade({ root, packageRoot: pkg, validate: stackValidator() });
  return {
    root, state, facade,
    restore() {
      if (previous === undefined) delete process.env["GUILD_STATE_HOME"];
      else process.env["GUILD_STATE_HOME"] = previous;
    },
  };
}

const agentsDigest = (f: F) => {
  const dir = path.join(f.root, ".guild", "agents");
  return walkFiles(dir).map((p) => `${path.relative(dir, p)}:${sha256(fs.readFileSync(p))}`).join("\n");
};

function bind(f: F) {
  const s = f.facade.dispatch({ action: "bind" }) as any;
  return { sid: s.session_id as string, source: s.root.source_id as string };
}

function configPreview(f: F, c: { sid: string; source: string }) {
  const list = f.facade.dispatch({ action: "list", session_id: c.sid, source_id: c.source, collection: "config" }) as any;
  const target = list.items[0].ref;
  return f.facade.dispatch({ action: "preview", request: {
    operation: "config.set", session_id: c.sid, source_id: c.source, targets: [target],
    arguments: { target, layer: "project", key: "advisorRounds", value: 3, reset: false }, idempotency_key: randomUUID(),
  } }) as any;
}

const createArgs = { title: "Fixture initiative", body: "Exact fixture summary", acceptance: ["Acceptance"], owner: "operator" };

function p05Preview(f: F, c: { sid: string; source: string }) {
  return f.facade.dispatch({ action: "preview", request: {
    session_id: c.sid, source_id: c.source, operation: "initiative.create", arguments: createArgs, targets: [], idempotency_key: randomUUID(),
  } }) as any;
}

function decide(f: F, c: { sid: string }, p: any) {
  f.facade.dispatch({ action: "decide", operation_id: p.operation_id, request: { session_id: c.sid, preview_hash: p.preview_hash, decision: "approved", rationale: "Reviewed exact fixture change" } });
}

function apply(f: F, c: { sid: string }, p: any) {
  return f.facade.dispatch({ action: "apply", operation_id: p.operation_id, request: { session_id: c.sid, preview_hash: p.preview_hash, idempotency_key: randomUUID() } }) as any;
}

/** The facade's own persisted journal for an operation (under GUILD_STATE_HOME). */
function journalPath(f: F, operationId: string): string {
  const hits = walkFiles(f.state).filter((p) => p.endsWith(path.join("stack", "operations", `${operationId}.json`)));
  expect(hits.length).toBe(1);
  return hits[0];
}

/** Plant the R67 writer intent into the stored journal after approval. */
function plant(f: F, operationId: string, edit: (record: any) => void) {
  const p = journalPath(f, operationId);
  const record = JSON.parse(fs.readFileSync(p, "utf8"));
  edit(record);
  fs.writeFileSync(p, JSON.stringify(record) + "\n");
}

/** A typed facade refusal (a StackError and its .code), never a Node/TypeError or untyped throw. */
function refusalCode(run: () => unknown): string {
  try {
    run();
  } catch (e) {
    if (e instanceof StackError) return e.code;
    throw new Error(`not a StackError refusal: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
  }
  throw new Error("expected a refusal, but the call succeeded");
}

function guarded(run: (f: F, c: { sid: string; source: string }) => string, codes: string[]) {
  const f = fixture();
  try {
    const c = bind(f);
    const before = agentsDigest(f);
    const code = run(f, c);
    expect(codes).toContain(code);
    expect(agentsDigest(f)).toBe(before);
    expect(fs.existsSync(path.join(f.root, PLANTED_NEW))).toBe(false);
    expect(fs.existsSync(path.join(f.root, PLANTED_MOVE))).toBe(false);
  } finally {
    f.restore();
  }
}

describe("R67 stack facade profile boundary · positive controls", () => {
  it("config.set applies through the facade and leaves .guild/agents byte-identical", () => {
    const f = fixture();
    try {
      const c = bind(f);
      const before = agentsDigest(f);
      const p = configPreview(f, c);
      decide(f, c, p);
      apply(f, c, p);
      expect(JSON.parse(fs.readFileSync(path.join(f.root, ".guild", "config", "project.json"), "utf8")).advisorRounds).toBe(3);
      expect(agentsDigest(f)).toBe(before);
    } finally {
      f.restore();
    }
  });

  it("P05 initiative.create applies and touches no agent profile", () => {
    const f = fixture();
    try {
      const c = bind(f);
      const before = agentsDigest(f);
      const p = p05Preview(f, c);
      decide(f, c, p);
      const r = apply(f, c, p);
      expect(r.state).toBe("applied");
      expect(r.touched.length).toBeGreaterThan(0);
      expect(r.touched.every((t: { path: string }) => !t.path.startsWith("agents/"))).toBe(true);
      expect(agentsDigest(f)).toBe(before);
    } finally {
      f.restore();
    }
  });

  it("the planting seam reaches the journal the facade re-reads (a benign edit is detected)", () => {
    guarded((f, c) => {
      const p = configPreview(f, c);
      decide(f, c, p);
      // Same field types, one changed byte in the reviewed `before` bytes.
      plant(f, p.operation_id, (r) => { r.before = `${r.before} `; });
      return refusalCode(() => apply(f, c, p));
    }, ["invalid_state"]);
  });
});

describe("R67 stack facade profile boundary · planted writer intents refuse and preserve profile bytes", () => {
  for (const operation of ["agent.create", "component.create", "profile.write", "component.update"]) {
    it(`preview of an unsupported ${operation} naming .guild/agents refuses`, () => {
      guarded((f, c) => refusalCode(() => f.facade.dispatch({ action: "preview", request: {
        session_id: c.sid, source_id: c.source, operation, targets: [],
        arguments: { path: PLANTED_NEW, body: PLANTED_BYTES }, idempotency_key: randomUUID(),
      } })), ["operation_unavailable", "invalid_request"]);
    });
  }

  it("a config journal re-pointed at a NEW .guild/agents profile refuses at apply", () => {
    guarded((f, c) => {
      const p = configPreview(f, c);
      decide(f, c, p);
      plant(f, p.operation_id, (r) => { r.relative = PLANTED_NEW; r.after = PLANTED_BYTES; });
      return refusalCode(() => apply(f, c, p));
    }, ["invalid_state"]);
  });

  it("a config journal re-pointed at the EXISTING profile refuses at apply", () => {
    guarded((f, c) => {
      const p = configPreview(f, c);
      decide(f, c, p);
      plant(f, p.operation_id, (r) => { r.relative = PROFILE; });
      return refusalCode(() => apply(f, c, p));
    }, ["invalid_state"]);
  });

  it("a P05 journal whose write targets a NEW .guild/agents profile refuses at apply", () => {
    guarded((f, c) => {
      const p = p05Preview(f, c);
      decide(f, c, p);
      plant(f, p.operation_id, (r) => {
        r.writes.push({ path: PLANTED_NEW, before_exists: false, before_hash: sha256Prefixed(""), after_exists: true, after_bytes: PLANTED_BYTES, after_hash: sha256Prefixed(PLANTED_BYTES) });
      });
      return refusalCode(() => apply(f, c, p));
    }, ["invalid_state"]);
  });

  it("a P05 journal whose write overwrites the EXISTING profile refuses at apply", () => {
    guarded((f, c) => {
      const p = p05Preview(f, c);
      decide(f, c, p);
      plant(f, p.operation_id, (r) => { r.writes[0].path = PROFILE; });
      return refusalCode(() => apply(f, c, p));
    }, ["invalid_state"]);
  });

  it("a P05 journal that moves an initiative into a .guild/agents destination refuses at apply", () => {
    guarded((f, c) => {
      const p = p05Preview(f, c);
      decide(f, c, p);
      plant(f, p.operation_id, (r) => {
        const dir = path.posix.dirname(r.writes[0].path);
        r.moves.push({ from: dir, to: PLANTED_MOVE, before_tree_hash: sha256Prefixed("") });
      });
      return refusalCode(() => apply(f, c, p));
    }, ["invalid_state"]);
  });
});

function sha256Prefixed(text: string): string {
  return `sha256:${sha256(text)}`;
}
