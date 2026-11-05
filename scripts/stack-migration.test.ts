/**
 * scripts/stack-migration.test.ts — AT47 (package A03): Guild Stack v1→v2
 * migration dry-run, reader-first activation, checkpoint restart and rollback.
 *
 * Fixture: a disposable `.guild` root with archived + open v1 runs, legacy v1
 * analysis/comparison exports, legacy knowledge exports, and consumers at old
 * (v1-only) and new (v1+v2) protocol versions. Nothing here touches a real root.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  FROZEN_V2_BUNDLE_SHA256,
  MIGRATION_HOME,
  activateReaders,
  activateWriters,
  admitWriter,
  applyMigration,
  inventory,
  planMigration,
  rollback,
  runCli,
  verifyBackup,
  type Consumer,
} from "./lib/stack-migration";

const OLD_AND_NEW: Consumer[] = [
  { name: "benchmark-ui", protocol_majors: [1] },
  { name: "plugin-status", protocol_majors: [1, 2] },
];
const NEW_ONLY: Consumer[] = [
  { name: "benchmark-ui", protocol_majors: [1, 2] },
  { name: "plugin-status", protocol_majors: [1, 2] },
];
const LINK = [{ v1_run_id: "run-b-open", v2_run_id: "run-b-v2" }];
const READERS = { plugin: "3.3.0-beta.1", benchmark: "3.3.0-beta.1" };

let tmp: string;
let root: string;

function write(rel: string, body: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function runYaml(id: string, status: string, schema = "guild.run.v1"): string {
  return `schema_version: ${schema}\nrun_id: ${id}\nstatus: ${status}\nphase: build\n`;
}

function seedFixture(): void {
  write("runs/run-a-closed/run.yaml", runYaml("run-a-closed", "closed"));
  write("runs/run-a-closed/logs/v1.4-events.jsonl", '{"e":1}\n');
  write("runs/run-b-open/run.yaml", runYaml("run-b-open", "open"));
  write("runs/run-b-open/receipt.json", '{"ok":true}\n');
  write("runs/_archive/run-c-old/run.yaml", runYaml("run-c-old", "closed"));
  write("analysis/runs/run-a-closed/analysis.json", '{"schema_version":"guild.stack.run-analysis.v1"}\n');
  write("analysis/comparisons/cmp-1/comparison.json", '{"schema_version":"guild.stack.run-comparison.v1"}\n');
  write("knowledge/graph/knowledge-graph.json", '{"nodes":[]}\n');
  write("knowledge/indexes/recall.json", '{"terms":{}}\n');
  write("guild.yaml", "name: fixture\n");
}

interface Entry {
  sha: string;
  mtime: number;
  mode: number;
}

function snapshot(dir: string): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      const rel = path.relative(dir, p);
      if (st.isDirectory()) {
        out[`${rel}/`] = { sha: "dir", mtime: st.mtimeMs, mode: st.mode };
        walk(p);
      } else {
        out[rel] = {
          sha: crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"),
          mtime: st.mtimeMs,
          mode: st.mode,
        };
      }
    }
  };
  walk(dir);
  return out;
}

function bytesOnly(snap: Record<string, Entry>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap)) if (k.startsWith(prefix)) out[k] = v.sha;
  return out;
}

function readerReceipt(over: Record<string, unknown> = {}): string {
  const file = path.join(tmp, `reader-checkpoint-${crypto.randomUUID()}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      schema_version: "guild.stack.reader_checkpoint.v1",
      package: "A04",
      status: "passed",
      contract_bundle_sha256: FROZEN_V2_BUNDLE_SHA256,
      reader_versions: READERS,
      ...over,
    }),
  );
  return file;
}

function gateReceipts(over: Record<string, Record<string, unknown>> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ["V01", "D01", "Z01"]) {
    const file = path.join(tmp, `gate-${id}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({ schema_version: "guild.stack.package_gate.v1", package: id, status: "passed", ...(over[id] ?? {}) }),
    );
    out[id] = file;
  }
  return out;
}

function addV2Evidence(): void {
  write("runs/run-d-v2/run.yaml", runYaml("run-d-v2", "open", "guild.run.v2"));
  write("analysis/runs/run-d-v2/versions/an-1/analysis.json", '{"schema_version":"guild.stack.run-analysis.v2"}\n');
  write("analysis/runs/run-d-v2/current.v2.json", '{"analysis_id":"an-1"}\n');
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "at47-"));
  root = path.join(tmp, ".guild");
  fs.mkdirSync(root);
  seedFixture();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("AT47 read-only inventory and dry-run", () => {
  it("classifies archived/open v1 runs, legacy exports and v2 records", () => {
    addV2Evidence();
    const inv = inventory(root);
    const runs = Object.fromEntries(inv.sources.filter((s) => s.kind === "v1_run").map((s) => [s.key, s.state]));
    expect(runs).toEqual({
      "runs/_archive/run-c-old": "archived",
      "runs/run-a-closed": "closed",
      "runs/run-b-open": "open",
    });
    expect(inv.sources.filter((s) => s.kind === "legacy_v1_analysis").map((s) => s.key)).toEqual([
      "analysis/comparisons/cmp-1/comparison.json",
      "analysis/runs/run-a-closed/analysis.json",
    ]);
    expect(inv.sources.filter((s) => s.kind === "legacy_knowledge_export").map((s) => s.key)).toEqual([
      "knowledge/graph/knowledge-graph.json",
      "knowledge/indexes/recall.json",
    ]);
    expect(inv.v2_records.sort()).toEqual([
      "analysis/runs/run-d-v2/current.v2.json",
      "analysis/runs/run-d-v2/versions/an-1/analysis.json",
      "runs/run-d-v2/run.yaml",
    ]);
    expect(inv.open_v1_runs).toEqual(["run-b-open"]);
  });

  it("performs zero writes and is idempotent (byte-identical plans)", () => {
    const before = snapshot(tmp);
    const a = planMigration(root, { consumers: OLD_AND_NEW });
    const b = planMigration(root, { consumers: OLD_AND_NEW });
    expect(snapshot(tmp)).toEqual(before);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.canonical_writes).toBe(0);
    expect(fs.existsSync(path.join(root, MIGRATION_HOME))).toBe(false);
    // Open v1 runs are never rewritten; every projection lands in the versioned home.
    const open = a.actions.find((x) => x.source_key === "runs/run-b-open");
    expect(open?.disposition).toBe("finish_on_v1_or_link");
    for (const action of a.actions) {
      expect(action.projection_path.startsWith(`${MIGRATION_HOME}/projections/`)).toBe(true);
      expect(action.writes_to_source).toBe(false);
    }
  });

  it("CLI plan prints the plan and writes nothing", () => {
    const before = snapshot(tmp);
    const out: string[] = [];
    const code = runCli(["plan", "--root", root, "--consumer", "benchmark-ui@1", "--consumer", "plugin-status@1,2"], {
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(JSON.parse(out.join("")).canonical_writes).toBe(0);
    expect(snapshot(tmp)).toEqual(before);
  });
});

describe("AT47 apply: backup manifest, checkpoints, restart idempotency", () => {
  it("leaves originals unchanged and verifies the backup manifest", () => {
    const sourcesBefore = bytesOnly(snapshot(root));
    const plan = planMigration(root, { consumers: OLD_AND_NEW });
    const result = applyMigration(root, plan);
    expect(result.status).toBe("complete");
    const after = bytesOnly(snapshot(root));
    for (const [k, sha] of Object.entries(sourcesBefore)) expect(after[k]).toBe(sha);
    for (const k of Object.keys(after)) {
      if (!(k in sourcesBefore)) expect(k === "migrations/" || k.startsWith(MIGRATION_HOME)).toBe(true);
    }
    expect(verifyBackup(root)).toEqual({ ok: true, mismatches: [] });
  });

  it("restarts from per-source checkpoints to the same bytes as an uninterrupted run", () => {
    const clean = path.join(tmp, "clean", ".guild");
    fs.cpSync(root, clean, { recursive: true });
    applyMigration(clean, planMigration(clean, { consumers: OLD_AND_NEW }));

    const plan = planMigration(root, { consumers: OLD_AND_NEW });
    expect(() => applyMigration(root, plan, { failAfterSources: 2 })).toThrow(/injected fault/);
    const partial = fs.readdirSync(path.join(root, MIGRATION_HOME, "checkpoints"));
    expect(partial.length).toBe(2);
    const resumed = applyMigration(root, plan);
    expect(resumed.skipped_checkpoints).toBe(2);
    const checkpointsBefore = snapshot(path.join(root, MIGRATION_HOME, "checkpoints"));
    const again = applyMigration(root, plan);
    expect(again.skipped_checkpoints).toBe(plan.actions.length);
    expect(again.applied_checkpoints).toBe(0);
    expect(snapshot(path.join(root, MIGRATION_HOME, "checkpoints"))).toEqual(checkpointsBefore);

    expect(bytesOnly(snapshot(root), MIGRATION_HOME)).toEqual(bytesOnly(snapshot(clean), MIGRATION_HOME));
  });

  it("refuses when an original changed after planning or after its checkpoint", () => {
    const plan = planMigration(root, { consumers: OLD_AND_NEW });
    write("runs/run-a-closed/run.yaml", runYaml("run-a-closed", "closed") + "tampered: true\n");
    expect(() => applyMigration(root, plan)).toThrow(/source_changed_since_plan/);

    fs.rmSync(path.join(root, MIGRATION_HOME), { recursive: true, force: true });
    const plan2 = planMigration(root, { consumers: OLD_AND_NEW });
    applyMigration(root, plan2);
    write("knowledge/indexes/recall.json", '{"terms":{"x":1}}\n');
    expect(verifyBackup(root).ok).toBe(false);
    expect(() => applyMigration(root, planMigration(root, { consumers: OLD_AND_NEW }))).toThrow(
      /source_changed_since_checkpoint/,
    );
  });
});

describe("AT47 reader-first activation and rollback", () => {
  function applied(consumers: Consumer[] = NEW_ONLY): void {
    applyMigration(root, planMigration(root, { consumers }));
  }

  it("refuses activation before the migration is applied", () => {
    const r = activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    expect(r.status).toBe("refused");
    expect(r.refusal?.code).toBe("migration_not_applied");
  });

  it("requires the A04 reader checkpoint with exact reader versions and the frozen bundle", () => {
    applied();
    const wrongVersion = activateReaders(root, {
      readerCheckpointPath: readerReceipt({ reader_versions: { ...READERS, benchmark: "3.2.0" } }),
      expectedReaderVersions: READERS,
    });
    expect(wrongVersion.refusal?.code).toBe("reader_version_mismatch");
    const wrongBundle = activateReaders(root, {
      readerCheckpointPath: readerReceipt({ contract_bundle_sha256: "sha256:" + "0".repeat(64) }),
      expectedReaderVersions: READERS,
    });
    expect(wrongBundle.refusal?.code).toBe("contract_bundle_mismatch");
    const ok = activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    expect(ok.status).toBe("activated");
    expect(ok.capability.v2_read).toBe(true);
    expect(ok.capability.v2_write).toBe(false);
  });

  it("refuses writer activation before readers, without V01/D01/Z01 gates, or with old consumers", () => {
    applied(OLD_AND_NEW);
    expect(activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: LINK }).refusal?.code).toBe(
      "readers_not_active",
    );
    activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    const missing = gateReceipts();
    delete missing.Z01;
    expect(activateWriters(root, { gateReceipts: missing, linkOpenRuns: LINK }).refusal?.code).toBe(
      "package_gate_missing",
    );
    expect(
      activateWriters(root, { gateReceipts: gateReceipts({ D01: { status: "pending" } }), linkOpenRuns: LINK })
        .refusal?.code,
    ).toBe("package_gate_not_passed");
    expect(activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: LINK }).refusal?.code).toBe(
      "consumer_not_v2_capable",
    );
  });

  it("refuses writer activation while an open v1 run is neither drained nor linked", () => {
    applied();
    activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    expect(activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: [] }).refusal?.code).toBe(
      "open_v1_run_unresolved",
    );
    const ok = activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: LINK });
    expect(ok.status).toBe("activated");
    expect(ok.capability.v2_write).toBe(true);
    expect(ok.capability.run_links).toEqual(LINK);
  });

  it("negative control: an old writer resuming after v2 activation is refused", () => {
    applied();
    expect(admitWriter(root, { protocolMajor: 1, runId: "run-b-open" }).admitted).toBe(true);
    expect(admitWriter(root, { protocolMajor: 2, runId: "run-new" }).refusal?.code).toBe("v2_write_disabled");
    activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: LINK });
    expect(admitWriter(root, { protocolMajor: 1, runId: "run-b-open" }).refusal?.code).toBe("v1_writer_fenced");
    expect(admitWriter(root, { protocolMajor: 1, runId: "run-z-new" }).refusal?.code).toBe("v1_writer_fenced");
    expect(admitWriter(root, { protocolMajor: 2, runId: "run-new" }).admitted).toBe(true);
  });

  it("rollback hides v2 controls without deleting or down-converting v2 evidence", () => {
    applied();
    activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: LINK });
    addV2Evidence();
    const before = bytesOnly(snapshot(root));

    const refused = rollback(root, { downgradeRecords: true });
    expect(refused.status).toBe("refused");
    expect(refused.refusal?.code).toBe("downgrade_mutates_v2");
    expect(bytesOnly(snapshot(root))).toEqual(before);

    const r = rollback(root, {});
    expect(r.status).toBe("rolled_back");
    expect(r.capability.v2_read).toBe(false);
    expect(r.capability.v2_write).toBe(false);
    expect(r.capability.v2_write_ever_activated).toBe(true);
    const after = bytesOnly(snapshot(root));
    for (const [k, sha] of Object.entries(before)) {
      if (!k.startsWith(`${MIGRATION_HOME}/capability`) && !k.startsWith(`${MIGRATION_HOME}/journal`)) {
        expect(after[k]).toBe(sha);
      }
    }
    for (const rec of inventory(root).v2_records) expect(fs.existsSync(path.join(root, rec))).toBe(true);
    // v2 launches are disabled; runs touched by v2 stay fenced from v1 writers.
    expect(admitWriter(root, { protocolMajor: 2, runId: "run-new" }).refusal?.code).toBe("v2_write_disabled");
    expect(admitWriter(root, { protocolMajor: 1, runId: "run-b-open" }).refusal?.code).toBe("run_linked_to_v2");
    expect(admitWriter(root, { protocolMajor: 1, runId: "run-d-v2" }).refusal?.code).toBe("run_linked_to_v2");
    expect(admitWriter(root, { protocolMajor: 1, runId: "run-fresh" }).admitted).toBe(true);
  });
});

describe("AT47 review regressions (codex r1)", () => {
  it("F1: refuses an edited plan path before writing and a symlinked migration home", () => {
    const plan = planMigration(root, { consumers: OLD_AND_NEW });
    const before = snapshot(tmp);
    const edited = JSON.parse(JSON.stringify(plan));
    edited.actions[0].projection_path = "runs/run-a-closed/run.yaml";
    expect(() => applyMigration(root, edited)).toThrow(/source_changed_since_plan/);
    expect(snapshot(tmp)).toEqual(before);

    const outside = path.join(tmp, "outside");
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(root, "migrations"));
    fs.symlinkSync(outside, path.join(root, MIGRATION_HOME));
    expect(() => applyMigration(root, plan)).toThrow(/symlink_in_migration_home/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("F2: an old-to-new consumer upgrade re-applies and reuses verified checkpoints", () => {
    applyMigration(root, planMigration(root, { consumers: OLD_AND_NEW }));
    const r = applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    expect(r.applied_checkpoints).toBe(0);
    expect(activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS }).status).toBe(
      "activated",
    );
    expect(activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: LINK }).status).toBe("activated");
  });

  it("F2: an open v1 run that drains between apply and activation needs a re-apply, then proceeds", () => {
    applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    write("runs/run-b-open/run.yaml", runYaml("run-b-open", "closed"));
    const blocked = activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    expect(blocked.refusal?.code).toBe("reapply_required");
    const r = applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    expect(r.applied_checkpoints).toBe(1);
    // Both generations of the drained run are retained.
    const dirs = fs.readdirSync(path.join(root, MIGRATION_HOME, "checkpoints")).filter((d) => d.startsWith("runs__run-b-open"));
    expect(fs.readdirSync(path.join(root, MIGRATION_HOME, "checkpoints", dirs[0])).length).toBe(2);
    activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    expect(activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: [] }).status).toBe("activated");
  });

  it("F3: restart repairs missing or corrupt backup blobs and projections before skipping", () => {
    const plan = planMigration(root, { consumers: NEW_ONLY });
    applyMigration(root, plan);
    const blobs = path.join(root, MIGRATION_HOME, "backup", "blobs");
    const [first, second] = fs.readdirSync(blobs);
    fs.rmSync(path.join(blobs, first));
    fs.writeFileSync(path.join(blobs, second), "corrupt");
    fs.rmSync(path.join(root, plan.actions[0].projection_path));
    expect(verifyBackup(root).ok).toBe(false);
    expect(activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS }).refusal?.code).toBe(
      "migration_outputs_incomplete",
    );
    const r = applyMigration(root, plan);
    expect(r.repaired_outputs).toBe(3);
    expect(verifyBackup(root)).toEqual({ ok: true, mismatches: [] });
  });

  it("F4: v2 writers may not reuse a v1 run identity; links name a distinct v2 run", () => {
    applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    expect(
      activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: [{ v1_run_id: "run-b-open", v2_run_id: "run-a-closed" }] })
        .refusal?.code,
    ).toBe("invalid_run_link");
    activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: LINK });
    expect(admitWriter(root, { protocolMajor: 2, runId: "run-b-open" }).refusal?.code).toBe("v1_identity_immutable");
    expect(admitWriter(root, { protocolMajor: 2, runId: "run-b-v2" }).admitted).toBe(true);
  });

  it("F4: a missing capability file fails closed; v2 analysis identity fences v1 writers", () => {
    applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    write("analysis/runs/derived-only/versions/an-9/analysis.json", "{}\n");
    expect(admitWriter(root, { protocolMajor: 1, runId: "derived-only" }).refusal?.code).toBe("run_linked_to_v2");
    fs.rmSync(path.join(root, MIGRATION_HOME, "capability.json"));
    expect(admitWriter(root, { protocolMajor: 1, runId: "run-fresh" }).refusal?.code).toBe("capability_state_missing");
  });

  it("F5: gate receipts must carry the package_gate schema", () => {
    applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    const r = activateWriters(root, {
      gateReceipts: gateReceipts({ V01: { schema_version: undefined } }),
      linkOpenRuns: LINK,
    });
    expect(r.refusal?.code).toBe("package_gate_invalid");
  });
});

describe("AT47 review regressions (codex r2)", () => {
  function activated(): void {
    applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
  }

  it("a hard-linked journal never writes through to an original", () => {
    applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    const journal = path.join(root, MIGRATION_HOME, "journal.jsonl");
    const original = path.join(root, "runs/run-a-closed/run.yaml");
    const bytes = fs.readFileSync(original);
    fs.rmSync(journal);
    fs.linkSync(original, journal);
    rollback(root, {});
    expect(fs.readFileSync(original)).toEqual(bytes);
  });

  it("re-apply refuses a checkpointed original that disappeared", () => {
    applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    fs.rmSync(path.join(root, "knowledge/indexes/recall.json"));
    expect(() => applyMigration(root, planMigration(root, { consumers: NEW_ONLY }))).toThrow(/source_disappeared/);
  });

  it("re-apply keeps fences: missing capability state and consumer downgrade while active are refused", () => {
    activated();
    activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: LINK });
    expect(() => applyMigration(root, planMigration(root, { consumers: OLD_AND_NEW }))).toThrow(
      /capabilities_active_consumers_changed/,
    );
    fs.rmSync(path.join(root, MIGRATION_HOME, "capability.json"));
    expect(() => applyMigration(root, planMigration(root, { consumers: NEW_ONLY }))).toThrow(/capability_state_missing/);
    expect(admitWriter(root, { protocolMajor: 1, runId: "run-b-open" }).admitted).toBe(false);
  });

  it("an emptied backup manifest fails verification and blocks activation", () => {
    applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    const manifest = path.join(root, MIGRATION_HOME, "backup", "manifest.json");
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    fs.writeFileSync(manifest, JSON.stringify({ ...m, files: [] }));
    fs.rmSync(path.join(root, MIGRATION_HOME, "backup", "blobs"), { recursive: true });
    expect(verifyBackup(root).ok).toBe(false);
    expect(activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS }).status).toBe(
      "refused",
    );
  });

  it("after rollback, persisted links replay exactly and remapping is refused", () => {
    activated();
    activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: LINK });
    rollback(root, {});
    activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    expect(
      activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: [{ v1_run_id: "run-b-open", v2_run_id: "run-other" }] })
        .refusal?.code,
    ).toBe("invalid_run_link");
    const replay = activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: LINK });
    expect(replay.status).toBe("activated");
    expect(replay.capability.run_links).toEqual(LINK);
    rollback(root, {});
    activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    const reuse = activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: [] });
    expect(reuse.status).toBe("activated");
    expect(reuse.capability.run_links).toEqual(LINK);
  });
});

describe("AT47 review regressions (codex r3)", () => {
  it("run-id path aliases are refused by both admission branches and by links", () => {
    applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    expect(
      activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: [{ v1_run_id: "run-b-open", v2_run_id: ".." }] })
        .refusal?.code,
    ).toBe("invalid_run_link");
    activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: LINK });
    expect(admitWriter(root, { protocolMajor: 2, runId: "../runs/run-b-open" }).refusal?.code).toBe("invalid_run_id");
    rollback(root, {});
    addV2Evidence();
    expect(admitWriter(root, { protocolMajor: 1, runId: "../runs/run-d-v2" }).refusal?.code).toBe("invalid_run_id");
    expect(admitWriter(root, { protocolMajor: 1, runId: "./run-d-v2" }).refusal?.code).toBe("invalid_run_id");
  });

  it("a first apply interrupted before plan publication resumes to the same bytes", () => {
    const clean = path.join(tmp, "clean", ".guild");
    fs.cpSync(root, clean, { recursive: true });
    applyMigration(clean, planMigration(clean, { consumers: NEW_ONLY }));
    const plan = planMigration(root, { consumers: NEW_ONLY });
    expect(() => applyMigration(root, plan, { failBeforePlanPublish: true })).toThrow(/before plan publication/);
    expect(fs.existsSync(path.join(root, MIGRATION_HOME, "capability.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, MIGRATION_HOME, "plan.json"))).toBe(false);
    expect(applyMigration(root, plan).status).toBe("complete");
    expect(bytesOnly(snapshot(root), MIGRATION_HOME)).toEqual(bytesOnly(snapshot(clean), MIGRATION_HOME));
    expect(activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS }).status).toBe(
      "activated",
    );
  });
});

describe("AT47 review regressions (codex r4)", () => {
  it("symlinked run directories cannot alias a fenced identity in either direction", () => {
    applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: LINK });
    fs.symlinkSync(path.join(root, "runs/run-a-closed"), path.join(root, "runs/alias-v1"));
    expect(admitWriter(root, { protocolMajor: 2, runId: "alias-v1" }).refusal?.code).toBe("run_path_alias");
    rollback(root, {});
    addV2Evidence();
    fs.symlinkSync(path.join(root, "runs/run-d-v2"), path.join(root, "runs/alias-v2"));
    expect(admitWriter(root, { protocolMajor: 1, runId: "alias-v2" }).refusal?.code).toBe("run_path_alias");
  });

  it("a source removed after an interrupted first apply is refused on resume", () => {
    const plan = planMigration(root, { consumers: NEW_ONLY });
    expect(() => applyMigration(root, plan, { failAfterSources: 1 })).toThrow(/injected fault/);
    fs.rmSync(path.join(root, plan.actions[0].source_key), { recursive: true });
    expect(() => applyMigration(root, planMigration(root, { consumers: NEW_ONLY }))).toThrow(/source_disappeared/);
  });
});

describe("AT47 review regressions (codex r5)", () => {
  it("case variants of a run id are the same identity for admission and links", () => {
    applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    expect(
      activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: [{ v1_run_id: "run-b-open", v2_run_id: "RUN-A-CLOSED" }] })
        .refusal?.code,
    ).toBe("invalid_run_link");
    activateWriters(root, { gateReceipts: gateReceipts(), linkOpenRuns: LINK });
    expect(admitWriter(root, { protocolMajor: 2, runId: "RUN-A-CLOSED" }).refusal?.code).toBe("v1_identity_immutable");
    rollback(root, {});
    addV2Evidence();
    expect(admitWriter(root, { protocolMajor: 1, runId: "Run-D-V2" }).refusal?.code).toBe("run_linked_to_v2");
    expect(admitWriter(root, { protocolMajor: 1, runId: "RUN-B-V2" }).refusal?.code).toBe("run_linked_to_v2");
  });
});

describe("AT47 review regressions (codex r6)", () => {
  it("a crash before the first checkpoint publication still tracks every planned source", () => {
    const plan = planMigration(root, { consumers: NEW_ONLY });
    expect(() => applyMigration(root, plan, { failBeforeCheckpoint: true })).toThrow(/before checkpoint publication/);
    fs.rmSync(path.join(root, plan.actions[0].source_key), { recursive: true });
    expect(() => applyMigration(root, planMigration(root, { consumers: NEW_ONLY }))).toThrow(/source_disappeared/);
  });

  it("a symlinked journal is refused before capability state changes", () => {
    applyMigration(root, planMigration(root, { consumers: NEW_ONLY }));
    const journal = path.join(root, MIGRATION_HOME, "journal.jsonl");
    fs.rmSync(journal);
    fs.symlinkSync(path.join(tmp, "elsewhere.jsonl"), journal);
    const r = activateReaders(root, { readerCheckpointPath: readerReceipt(), expectedReaderVersions: READERS });
    expect(r.status).toBe("refused");
    const persisted = JSON.parse(fs.readFileSync(path.join(root, MIGRATION_HOME, "capability.json"), "utf8"));
    expect(persisted.v2_read).toBe(false);
    expect(fs.existsSync(path.join(tmp, "elsewhere.jsonl"))).toBe(false);
  });
});
