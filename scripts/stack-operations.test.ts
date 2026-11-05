import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StackFacade } from "../src/domains/lifecycle";
import { stackValidator } from "./lib/stack-contract-validator";

function fixture(kind = "project") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-facade-"));
  const root = path.join(dir, "project"),
    pkg = path.join(dir, "package");
  fs.mkdirSync(path.join(root, ".guild", "config"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".guild", "guild.yaml"),
    `schema_version: guild.root.v1\nkind: ${kind}\n`,
  );
  fs.writeFileSync(
    path.join(root, ".guild", "storage-layout.json"),
    JSON.stringify({ storage_layout_version: 2 }),
  );
  fs.writeFileSync(
    path.join(root, ".guild", "config", kind + ".json"),
    JSON.stringify({ advisorRounds: 2, tiers: { default: "mid" } }),
  );
  fs.mkdirSync(path.join(pkg, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "runtime", "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(pkg, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "guild", version: "3.2.0-beta.1" }),
  );
  fs.writeFileSync(
    path.join(pkg, "guild.inventory.json"),
    JSON.stringify({
      schema_version: "guild.inventory.v1",
      plugin_version: "3.2.0-beta.1",
      manifest: { name: "guild", version: "3.2.0-beta.1" },
      scripts: [{ id: "stack-operations", kind: "cli" }],
    }),
  );
  fs.writeFileSync(
    path.join(pkg, "runtime", "scripts", "stack-operations.js"),
    "fixture entry",
  );
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
      if (previous === undefined) delete process.env.GUILD_STATE_HOME;
      else process.env.GUILD_STATE_HOME = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
function preview(f: any, s: any, key = "advisorRounds", value = 3) {
  const p = f.facade.dispatch({
    action: "list",
    session_id: s.session_id,
    source_id: s.root.source_id,
    collection: "config",
  }) as any;
  const target = p.items[0].ref;
  return f.facade.dispatch({
    action: "preview",
    request: {
      operation: "config.set",
      session_id: s.session_id,
      source_id: s.root.source_id,
      targets: [target],
      arguments: { target, layer: "project", key, value, reset: false },
      idempotency_key: "request-1",
    },
  }) as any;
}
describe("packaged Stack operation authority", () => {
  it("rejects a folder without a Guild manifest", () => {
    const f = fixture();
    try {
      fs.unlinkSync(path.join(f.root, ".guild", "guild.yaml"));
      expect(() => f.facade.dispatch({ action: "bind" })).toThrow();
    } finally {
      f.close();
    }
  });
  it("reads real scoped records, preserving content revisions", () => {
    const f = fixture();
    try {
      const s = f.facade.dispatch({ action: "bind" }) as any;
      const x = f.facade.dispatch({
        action: "list",
        session_id: s.session_id,
        source_id: s.root.source_id,
        collection: "config",
      }) as any;
      expect(x.items[0].data.local.advisorRounds).toBe(2);
      expect(x.items[0].ref.revision).toStartWith("sha256:");
    } finally {
      f.close();
    }
  });
  it("requires exact approval, applies through producer and preserves unrelated fields", () => {
    const f = fixture();
    try {
      const s = f.facade.dispatch({ action: "bind" }) as any;
      const p = preview(f, s);
      expect(() =>
        f.facade.dispatch({
          action: "apply",
          operation_id: p.operation_id,
          request: {
            session_id: s.session_id,
            preview_hash: p.preview_hash,
            idempotency_key: "apply-1",
          },
        }),
      ).toThrow();
      f.facade.dispatch({
        action: "decide",
        operation_id: p.operation_id,
        request: {
          session_id: s.session_id,
          preview_hash: p.preview_hash,
          decision: "approved",
          rationale: "Local policy change",
        },
      });
      f.facade.dispatch({
        action: "apply",
        operation_id: p.operation_id,
        request: {
          session_id: s.session_id,
          preview_hash: p.preview_hash,
          idempotency_key: "apply-1",
        },
      });
      const config = JSON.parse(
        fs.readFileSync(
          path.join(f.root, ".guild", "config", "project.json"),
          "utf8",
        ),
      );
      expect(config.advisorRounds).toBe(3);
      expect(config.tiers.default).toBe("mid");
    } finally {
      f.close();
    }
  });
  it("refuses stale target and unknown operation rather than writing", () => {
    const f = fixture();
    try {
      const s = f.facade.dispatch({ action: "bind" }) as any;
      const p = preview(f, s);
      fs.writeFileSync(
        path.join(f.root, ".guild", "config", "project.json"),
        JSON.stringify({ advisorRounds: 4 }),
      );
      expect(() =>
        f.facade.dispatch({
          action: "decide",
          operation_id: p.operation_id,
          request: {
            session_id: s.session_id,
            preview_hash: p.preview_hash,
            decision: "approved",
            rationale: "",
          },
        }),
      ).toThrow();
      expect(() =>
        f.facade.dispatch({
          action: "preview",
          request: {
            operation: "operation.shell",
            session_id: s.session_id,
            source_id: s.root.source_id,
            targets: [],
            arguments: {},
            idempotency_key: "bad",
          },
        }),
      ).toThrow();
    } finally {
      f.close();
    }
  });
});

describe("Stack compatibility and recovery boundaries", () => {
  it("advertises only implemented operations and no inverse writer", () => {
    const f = fixture();
    try {
      const s = f.facade.dispatch({ action: "bind" }) as any;
      const c = f.facade.dispatch({
        action: "capabilities",
        session_id: s.session_id,
      }) as any;
      expect(c.operations).toHaveLength(99);
      expect(
        c.operations.find((o: any) => o.id === "config.set").availability,
      ).toBe("available");
      expect(
        c.operations.find((o: any) => o.id === "initiative.close").availability,
      ).toBe("available");
      expect(preview(f, s).rollback).toBe("not_available");
    } finally {
      f.close();
    }
  });
  it("rejects legacy writes, future layout and symlinked config", () => {
    const f = fixture();
    try {
      fs.unlinkSync(path.join(f.root, ".guild/storage-layout.json"));
      let s = f.facade.dispatch({ action: "bind" }) as any;
      expect(s.root.read_only_reason).not.toBeNull();
      expect(() => preview(f, s)).toThrow();
      fs.writeFileSync(
        path.join(f.root, ".guild/storage-layout.json"),
        '{"storage_layout_version":99}',
      );
      expect(() => f.facade.dispatch({ action: "bind" })).toThrow();
      fs.writeFileSync(
        path.join(f.root, ".guild/storage-layout.json"),
        '{"storage_layout_version":2}',
      );
      const file = path.join(f.root, ".guild/config/project.json");
      fs.unlinkSync(file);
      fs.symlinkSync(path.join(f.pkg, ".claude-plugin/plugin.json"), file);
      s = f.facade.dispatch({ action: "bind" });
      expect(() => preview(f, s)).toThrow();
    } finally {
      f.close();
    }
  });
  it("refuses unknown policy input without altering canonical bytes", () => {
    const f = fixture();
    try {
      const file = path.join(f.root, ".guild/config/project.json");
      const before = fs.readFileSync(file, "utf8");
      const s = f.facade.dispatch({ action: "bind" }) as any;
      expect(() => preview(f, s, "__proto__.x", true)).toThrow();
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    } finally {
      f.close();
    }
  });
  it("keeps old operations observable after restart but invalidates old previews", () => {
    const f = fixture();
    try {
      const s = f.facade.dispatch({ action: "bind" }) as any;
      const p = preview(f, s);
      const fresh = f.facade.dispatch({ action: "bind" }) as any;
      expect(
        (
          f.facade.dispatch({
            action: "status",
            session_id: fresh.session_id,
            operation_id: p.operation_id,
          }) as any
        ).state,
      ).toBe("queued");
      expect(() =>
        f.facade.dispatch({
          action: "decide",
          operation_id: p.operation_id,
          request: {
            session_id: fresh.session_id,
            preview_hash: p.preview_hash,
            decision: "approved",
            rationale: "",
          },
        }),
      ).toThrow();
    } finally {
      f.close();
    }
  });
  it("invalidates approved previews on package or local policy changes", () => {
    const f = fixture();
    try {
      const s = f.facade.dispatch({ action: "bind" }) as any;
      const p = preview(f, s);
      f.facade.dispatch({
        action: "decide",
        operation_id: p.operation_id,
        request: {
          session_id: s.session_id,
          preview_hash: p.preview_hash,
          decision: "approved",
          rationale: "",
        },
      });
      fs.appendFileSync(
        path.join(f.pkg, "runtime/scripts/stack-operations.js"),
        "changed",
      );
      expect(() =>
        f.facade.dispatch({
          action: "apply",
          operation_id: p.operation_id,
          request: {
            session_id: s.session_id,
            preview_hash: p.preview_hash,
            idempotency_key: "apply",
          },
        }),
      ).toThrow();
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(f.root, ".guild/config/project.json"),
            "utf8",
          ),
        ).advisorRounds,
      ).toBe(2);
    } finally {
      f.close();
    }
  });
  it("returns the same receipt for a retry and refuses a different apply key", () => {
    const f = fixture();
    try {
      const s = f.facade.dispatch({ action: "bind" }) as any,
        p = preview(f, s);
      f.facade.dispatch({
        action: "decide",
        operation_id: p.operation_id,
        request: {
          session_id: s.session_id,
          preview_hash: p.preview_hash,
          decision: "approved",
          rationale: "",
        },
      });
      const input = {
        action: "apply",
        operation_id: p.operation_id,
        request: {
          session_id: s.session_id,
          preview_hash: p.preview_hash,
          idempotency_key: "apply",
        },
      };
      const a = f.facade.dispatch(input);
      expect(f.facade.dispatch(input)).toEqual(a);
      expect(() =>
        f.facade.dispatch({
          ...input,
          request: { ...input.request, idempotency_key: "other" },
        }),
      ).toThrow();
    } finally {
      f.close();
    }
  });
  it("reconciles a dead writer after its exact deterministic effect and refuses uncertain cancellation", () => {
    const f = fixture();
    try {
      const s = f.facade.dispatch({ action: "bind" }) as any,
        p = preview(f, s);
      f.facade.dispatch({
        action: "decide",
        operation_id: p.operation_id,
        request: {
          session_id: s.session_id,
          preview_hash: p.preview_hash,
          decision: "approved",
          rationale: "",
        },
      });
      const runtime = (f.facade as any).runtime(
        "operations/" + p.operation_id + ".json",
        s.root,
      );
      const r = JSON.parse(fs.readFileSync(runtime, "utf8"));
      r.state = "running";
      r.pid = 2147483647;
      r.apply_key = "crash-apply";
      fs.writeFileSync(runtime, JSON.stringify(r));
      fs.writeFileSync(path.join(f.root, r.relative), r.after);
      const lease = (f.facade as any).runtime("writer.lock", s.root);
      fs.mkdirSync(lease);
      fs.writeFileSync(path.join(lease, "owner.json"), '{"pid":2147483647}');
      const status = f.facade.dispatch({
        action: "status",
        session_id: s.session_id,
        operation_id: p.operation_id,
      }) as any;
      expect(status.state).toBe("succeeded");
      expect(status.receipt.touched[0].schema_version).toBe("guild.policy.v1");
      fs.unlinkSync(
        path.join(
          f.root,
          ".guild/artifacts/operations",
          p.operation_id,
          "receipt.json",
        ),
      );
      r.state = "recovery_needed";
      fs.writeFileSync(runtime, JSON.stringify(r));
      expect(() =>
        f.facade.dispatch({
          action: "cancel",
          operation_id: p.operation_id,
          request: { session_id: s.session_id, rationale: "cancel" },
        }),
      ).toThrow();
    } finally {
      f.close();
    }
  });
});

describe("review regressions", () => {
  it("refuses journal tampering and mismatched receipt identity", () => {
    const f = fixture();
    try {
      const s = f.facade.dispatch({ action: "bind" }) as any,
        p = preview(f, s);
      const file = (f.facade as any).runtime(
        "operations/" + p.operation_id + ".json",
        s.root,
      );
      const record = JSON.parse(fs.readFileSync(file, "utf8"));
      const original = JSON.stringify(record);
      record.after = '{"advisorRounds":10}\n';
      fs.writeFileSync(file, JSON.stringify(record));
      expect(() =>
        f.facade.dispatch({
          action: "status",
          operation_id: p.operation_id,
          session_id: s.session_id,
        }),
      ).toThrow();
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(f.root, ".guild/config/project.json"),
            "utf8",
          ),
        ).advisorRounds,
      ).toBe(2);
      fs.writeFileSync(file, original);
      f.facade.dispatch({
        action: "decide",
        operation_id: p.operation_id,
        request: {
          session_id: s.session_id,
          preview_hash: p.preview_hash,
          decision: "approved",
          rationale: "",
        },
      });
      f.facade.dispatch({
        action: "apply",
        operation_id: p.operation_id,
        request: {
          session_id: s.session_id,
          preview_hash: p.preview_hash,
          idempotency_key: "apply",
        },
      });
      const receiptPath = path.join(
        f.root,
        ".guild/artifacts/operations",
        p.operation_id,
        "receipt.json",
      );
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      receipt.operation_id = "op:unrelated";
      fs.writeFileSync(receiptPath, JSON.stringify(receipt));
      expect(() =>
        f.facade.dispatch({
          action: "status",
          operation_id: p.operation_id,
          session_id: s.session_id,
        }),
      ).toThrow();
    } finally {
      f.close();
    }
  });
  it("reloads cancellation inside the apply lease", () => {
    const f = fixture();
    try {
      const s = f.facade.dispatch({ action: "bind" }) as any,
        p = preview(f, s);
      f.facade.dispatch({
        action: "decide",
        operation_id: p.operation_id,
        request: {
          session_id: s.session_id,
          preview_hash: p.preview_hash,
          decision: "approved",
          rationale: "",
        },
      });
      const facade = f.facade as any,
        original = facade.lock.bind(facade);
      facade.lock = (source: any, fn: any) => {
        const file = facade.runtime(
            "operations/" + p.operation_id + ".json",
            source,
          ),
          r = JSON.parse(fs.readFileSync(file, "utf8"));
        r.state = "cancelled";
        fs.writeFileSync(file, JSON.stringify(r));
        return original(source, fn);
      };
      expect(() =>
        facade.dispatch({
          action: "apply",
          operation_id: p.operation_id,
          request: {
            session_id: s.session_id,
            preview_hash: p.preview_hash,
            idempotency_key: "apply",
          },
        }),
      ).toThrow();
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(f.root, ".guild/config/project.json"),
            "utf8",
          ),
        ).advisorRounds,
      ).toBe(2);
    } finally {
      f.close();
    }
  });
  it("uses private permissions for session and operation journals", () => {
    const f = fixture();
    try {
      const s = f.facade.dispatch({ action: "bind" }) as any,
        p = preview(f, s);
      const file = (f.facade as any).runtime(
        "operations/" + p.operation_id + ".json",
        s.root,
      );
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      f.close();
    }
  });
  it("qualifies equal project record IDs and retains unavailable children", () => {
    const f = fixture("workspace");
    try {
      for (const child of ["alpha", "beta"]) {
        const g = path.join(f.root, child, ".guild");
        fs.mkdirSync(path.join(g, "runs", "run-same"), { recursive: true });
        fs.writeFileSync(
          path.join(g, "guild.yaml"),
          "schema_version: guild.root.v1\nkind: project\n",
        );
        fs.writeFileSync(
          path.join(g, "storage-layout.json"),
          '{"storage_layout_version":2}',
        );
        fs.writeFileSync(
          path.join(g, "runs/run-same/run.yaml"),
          "status: running\n",
        );
      }
      fs.writeFileSync(
        path.join(f.root, ".guild/workspace.json"),
        JSON.stringify({
          schema_version: "guild.workspace.v1",
          is_workspace: true,
          sub_guilds: [
            { name: "alpha", path: "alpha" },
            { name: "beta", path: "beta" },
            { name: "missing", path: "missing" },
          ],
        }),
      );
      const s = f.facade.dispatch({ action: "bind" }) as any;
      expect(s.children).toHaveLength(3);
      expect(s.children[2].health).toBe("unavailable");
      const items = s.children.slice(0, 2).map(
        (c: any) =>
          (
            f.facade.dispatch({
              action: "list",
              session_id: s.session_id,
              source_id: c.source_id,
              collection: "run",
            }) as any
          ).items[0].ref,
      );
      expect(items[0].id).toBe(items[1].id);
      expect(items[0].source_id).not.toBe(items[1].source_id);
      expect(() =>
        f.facade.dispatch({
          action: "list",
          session_id: s.session_id,
          source_id: s.children[2].source_id,
          collection: "run",
        }),
      ).toThrow();
    } finally {
      f.close();
    }
  });
});

it("accepts native Codex identity and rejects conflicting installed identities", () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.pkg, ".codex-plugin"));
    const manifest = fs.readFileSync(
      path.join(f.pkg, ".claude-plugin/plugin.json"),
      "utf8",
    );
    fs.writeFileSync(path.join(f.pkg, ".codex-plugin/plugin.json"), manifest);
    fs.unlinkSync(path.join(f.pkg, ".claude-plugin/plugin.json"));
    expect((f.facade.dispatch({ action: "bind" }) as any).package_version).toBe(
      "3.2.0-beta.1",
    );
    fs.writeFileSync(
      path.join(f.pkg, ".claude-plugin/plugin.json"),
      '{"name":"guild","version":"3.1.0"}',
    );
    expect(() => f.facade.dispatch({ action: "bind" })).toThrow();
  } finally {
    f.close();
  }
});
