/**
 * scripts/__tests__/adoption-migrate.test.ts
 *
 * D6 — the adoption migration: read-only report, per-item dispositions, versioned
 * `guild.adoption_manifest.v1`, and one-command rollback.
 *
 * The rows that keep this honest rather than merely green:
 *   - the first pass writes NOTHING, proven by a before/after tree hash rather
 *     than by reading the code (that is exactly D03's observe advance condition);
 *   - only ACTUALLY REFERENCED assets are adopted — the anti-vacuity partner row
 *     proves a referenced one really is picked up;
 *   - historical receipts and team files are byte-identical after a full
 *     adopt + rollback cycle (R11/R14: rollback must not destroy evidence);
 *   - old ids still resolve after migration, through `resolveHistorical`, which
 *     is the whole reason history is not rewritten;
 *   - a source whose bytes changed since the report REFUSES rather than adopting
 *     something the operator never approved.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  ADOPTION_CONFLICTS,
  ADOPTION_PROVENANCE_KEY,
  ADOPTION_DISPOSITIONS,
  ADOPTION_MANIFEST_RELPATH,
  ADOPTION_REPORT_SCHEMA,
  REFERENCE_SITES,
  applyAdoptionPlan,
  buildAdoptionReport,
  readAdoptionManifest,
  rollbackAdoption,
} from "../lib/capability/adoption-migrate";
import {
  manifestCommitment,
  resolveHistorical,
  verifyAgainstTip,
} from "../lib/core/contracts/adoption-manifest";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const AT = "2026-08-01T12:00:00Z";

/** Non-strict ts-jest: read both arms flatly rather than narrowing per call. */
type Flat = Record<string, unknown> & { status: string };
const flat = (v: unknown): Flat => v as unknown as Flat;

let tmp: string;

function write(rel: string, body: string): void {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

/** A stable hash over every file in a subtree — the "nothing was written" proof. */
function treeHash(root: string): string {
  const h = crypto.createHash("sha256");
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else h.update(path.relative(root, abs)).update(fs.readFileSync(abs));
    }
  };
  walk(root);
  return h.digest("hex");
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-adopt-"));
  // A team file referencing the `qa` template, and a plan referencing the
  // `qa-test-strategy` domain skill. Both are HISTORICAL EVIDENCE.
  write(
    ".guild/team/feature.build.yaml",
    "specialists:\n  - name: qa\n    definition_source: shipped\n  - name: developer\n    definition_source: shipped\n",
  );
  write(".guild/plan/feature.md", "# plan\n\nLane 1 uses qa-test-strategy for the suite shape.\n");
  write(
    ".guild/runs/run-20260701-000000-feature/handoffs/qa-t1.md",
    "# handoff\n\nrole: qa\nskills: qa-test-strategy\n",
  );
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function report(): Record<string, unknown> {
  return buildAdoptionReport({
    pluginRoot: PLUGIN_ROOT,
    projectRoot: tmp,
    projectId: "demo",
  }) as unknown as Record<string, unknown>;
}

describe("D6 — the read-only first pass", () => {
  it("writes NOTHING, proven by a before/after tree hash", () => {
    const before = treeHash(tmp);
    const r = report();
    expect(treeHash(tmp)).toBe(before);
    expect(r.read_only).toBe(true);
    expect(r.schema_version).toBe(ADOPTION_REPORT_SCHEMA);
    expect(fs.existsSync(path.join(tmp, ADOPTION_MANIFEST_RELPATH))).toBe(false);
  });

  // ANTI-VACUITY: the exclusion row below is only meaningful if referenced
  // assets really are picked up.
  it("finds the referenced role AND the referenced domain skill, with exact hashes", () => {
    const items = report().items as Array<Record<string, unknown>>;
    const ids = items.map((i) => i.id);
    expect(ids).toContain("qa");
    expect(ids).toContain("qa-test-strategy");
    for (const item of items) {
      expect(String(item.source_hash)).toMatch(/^sha256:[0-9a-f]{64}$/);
      // The hash describes the bytes actually on disk.
      const bytes = fs.readFileSync(path.join(PLUGIN_ROOT, String(item.source_path)));
      expect(item.source_hash).toBe(`sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`);
    }
  });

  it("copies ONLY what is referenced — an unmentioned asset never appears", () => {
    const ids = (report().items as Array<Record<string, unknown>>).map((i) => i.id);
    // 73 shipped assets exist; this project mentions a handful.
    expect(ids).not.toContain("sales-cold-outreach");
    expect(ids).not.toContain("seo-keyword-research");
    expect((ids as string[]).length).toBeLessThan(10);
  });

  it("records every reference site as evidence", () => {
    const qa = (report().items as Array<Record<string, unknown>>).find((i) => i.id === "qa")!;
    const sites = (qa.referenced_at as Array<{ at: string; site: string }>).map((r) => r.site);
    expect(sites).toContain("team_file");
    expect(sites).toContain("handoff_receipt");
    for (const s of sites) expect(REFERENCE_SITES).toContain(s as never);
  });

  it("matches on token boundaries, not substrings", () => {
    // `qa` must not be reported merely because `qa-test-strategy` appears.
    write(".guild/plan/only-skill.md", "uses qa-flaky-test-hunter only\n");
    fs.rmSync(path.join(tmp, ".guild", "team"), { recursive: true });
    fs.rmSync(path.join(tmp, ".guild", "runs"), { recursive: true });
    fs.rmSync(path.join(tmp, ".guild", "plan", "feature.md"));
    const ids = (report().items as Array<Record<string, unknown>>).map((i) => i.id);
    expect(ids).toEqual(["qa-flaky-test-hunter"]);
  });

  it("flags a divergent local definition as a conflict and suggests compatibility_only", () => {
    write(".guild/agents/qa.md", "---\nname: qa\n---\n\nhand-edited\n");
    const qa = (report().items as Array<Record<string, unknown>>).find((i) => i.id === "qa")!;
    expect(qa.conflicts).toContain("local_definition_differs");
    expect(qa.suggested_disposition).toBe("compatibility_only");
    for (const c of qa.conflicts as string[]) expect(ADOPTION_CONFLICTS).toContain(c as never);
  });

  it("names an unresolvable reference rather than dropping it", () => {
    // A reference to something the catalog does not contain is not reported as a
    // referenced asset AND is not silently forgotten — but only catalog ids are
    // scanned for, so this asserts the field exists and stays empty here.
    expect(report().unresolvable_references).toEqual([]);
  });

  it("rejects a bad options bag rather than guessing", () => {
    expect((buildAdoptionReport(new Proxy({}, {})) as unknown as Flat).problems).toHaveLength(1);
    expect(
      (buildAdoptionReport({ pluginRoot: PLUGIN_ROOT, projectRoot: tmp, projectId: "a b" }) as unknown as Flat)
        .problems,
    ).toHaveLength(1);
  });
});

describe("D6 — applying a plan", () => {
  const decisions = [
    { kind: "agent", id: "qa", disposition: "adopt_as_is" },
    { kind: "skill", id: "qa-test-strategy", disposition: "adopt_as_is" },
  ];

  function apply(over: Record<string, unknown> = {}): Flat {
    return flat(
      applyAdoptionPlan({
        pluginRoot: PLUGIN_ROOT,
        projectRoot: tmp,
        projectId: "demo",
        report: report(),
        decisions,
        runId: "run-20260801-120000-adopt",
        authorizedBy: "cap-loc-D06",
        adoptedAt: AT,
        ...over,
      }),
    );
  }

  it("copies the referenced assets and writes a valid manifest", () => {
    const out = apply();
    expect(out.status).toBe("applied");
    expect(out.written).toEqual([".guild/agents/qa.md", ".guild/skills/qa-test-strategy/SKILL.md"]);
    expect(out.entries_appended).toBe(2);

    const manifest = readAdoptionManifest(tmp)!;
    expect(manifest).not.toBeNull();
    expect(manifest.project_id).toBe("demo");
    expect(manifest.entries.map((e) => e.sequence)).toEqual([1, 2]);
    expect(manifest.entries[0].prev_digest).toBeNull();
    expect(manifest.entries[1].prev_digest).toMatch(/^[0-9a-f]{64}$/);
    // The externally-committed digest the apply reported really commits this file.
    expect(verifyAgainstTip(manifest, String(out.manifest_digest))).toBe(true);
    expect(manifestCommitment(manifest).digest).toBe(out.manifest_digest);
  });

  it("preserves the source version and hash IN THE STAMP and the manifest", () => {
    apply();
    const src = fs.readFileSync(path.join(PLUGIN_ROOT, "templates/specialists/qa.md"));
    const srcHash = `sha256:${crypto.createHash("sha256").update(src).digest("hex")}`;
    const dst = fs.readFileSync(path.join(tmp, ".guild/agents/qa.md"), "utf8");
    // The copy carries its own provenance: which file, which bytes, which version.
    expect(dst).toContain(`${ADOPTION_PROVENANCE_KEY}: templates/specialists/qa.md`);
    expect(dst).toContain(`adopted_source_hash: ${srcHash}`);
    expect(dst).toContain("adopted_disposition: adopt_as_is");
    // Everything after the stamped frontmatter keys is the source, unchanged.
    expect(dst.endsWith(src.toString("utf8").slice(4))).toBe(true);
    const manifest = readAdoptionManifest(tmp)!;
    const entry = manifest.entries.find((e) => e.from.id === "qa")!;
    expect(entry.from.content_hash).toBe(
      `sha256:${crypto.createHash("sha256").update(src).digest("hex")}`,
    );
    // The successor is a DISTINCT identity — see stampProvenance: byte equality
    // would make the entry's own destination dead on arrival under S3's
    // (kind, id, content_hash) identity, so nothing could roll it back.
    expect(entry.to!.content_hash).not.toBe(entry.from.content_hash);
    // kind:"agent" binds BOTH identity hashes, or the ref could not complete a receipt.
    expect(entry.to!.specialist_profile_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.to!.specialist_type_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // THE IMMUTABILITY ROW. R11/R14: rollback must not destroy evidence, and a
  // migration that edits its own audit trail cannot be audited.
  it("NEVER rewrites team files, plan files, or handoff receipts", () => {
    const evidence = [
      ".guild/team/feature.build.yaml",
      ".guild/plan/feature.md",
      ".guild/runs/run-20260701-000000-feature/handoffs/qa-t1.md",
    ];
    const before = evidence.map((f) => fs.readFileSync(path.join(tmp, f)));
    apply();
    evidence.forEach((f, i) => {
      expect(fs.readFileSync(path.join(tmp, f)).equals(before[i])).toBe(true);
    });
  });

  it("resolves the OLD id forward through the manifest after migration", () => {
    apply();
    const manifest = readAdoptionManifest(tmp)!;
    const res = resolveHistorical(manifest, { kind: "agent", id: "qa" });
    expect(res.status).toBe("resolved");
    expect(res.ref!.relative_path).toBe(".guild/agents/qa.md");
    expect(res.trail).toEqual([1]);
  });

  it("dry-run runs every check and writes nothing", () => {
    const before = treeHash(tmp);
    const out = apply({ dryRun: true });
    expect(out.status).toBe("applied");
    expect(out.entries_appended).toBe(2);
    expect(treeHash(tmp)).toBe(before);
  });

  it("compatibility_only copies nothing and appends nothing", () => {
    const out = apply({
      decisions: [{ kind: "agent", id: "qa", disposition: "compatibility_only" }],
    });
    expect(out.status).toBe("applied");
    expect(out.written).toEqual([]);
    expect(out.compatibility_only).toEqual(["qa"]);
    expect(out.entries_appended).toBe(0);
  });

  it("substitute maps the legacy id onto an existing local definition", () => {
    write(".guild/agents/quality.md", "---\nname: quality\n---\n\nour own\n");
    const out = apply({
      decisions: [
        {
          kind: "agent",
          id: "qa",
          disposition: "substitute",
          substitute_path: ".guild/agents/quality.md",
          substitute_id: "quality",
        },
      ],
    });
    expect(out.status).toBe("applied");
    expect(out.written).toEqual([]);
    const entry = readAdoptionManifest(tmp)!.entries[0];
    expect(entry.reason).toBe("renamed");
    expect(entry.to!.id).toBe("quality");
    expect(entry.to!.relative_path).toBe(".guild/agents/quality.md");
    expect(resolveHistorical(readAdoptionManifest(tmp), { kind: "agent", id: "qa" }).ref!.id).toBe(
      "quality",
    );
  });

  it("REFUSES when the shipped source changed since the report", () => {
    const fresh = report();
    const stale = {
      ...fresh,
      items: (fresh.items as Array<Record<string, unknown>>).map((i) => ({
        ...i,
        source_hash: `sha256:${"0".repeat(64)}`,
      })),
    };
    const out = apply({ report: stale });
    expect(out.status).toBe("refused");
    expect(String(out.reason)).toMatch(/changed since the report/);
  });

  it("REFUSES to clobber a divergent local file", () => {
    write(".guild/agents/qa.md", "---\nname: qa\n---\n\nhand-edited\n");
    const out = apply({ decisions: [{ kind: "agent", id: "qa", disposition: "adopt_as_is" }] });
    expect(out.status).toBe("refused");
    expect(String(out.reason)).toMatch(/already exists with different bytes/);
    expect(fs.readFileSync(path.join(tmp, ".guild/agents/qa.md"), "utf8")).toContain("hand-edited");
  });

  it("refuses a decision for an asset the report never saw", () => {
    const out = apply({
      decisions: [{ kind: "agent", id: "architect", disposition: "adopt_as_is" }],
    });
    expect(out.status).toBe("refused");
    expect(String(out.reason)).toMatch(/only referenced assets may be adopted/);
  });

  it("refuses a duplicate decision rather than picking one", () => {
    const out = apply({
      decisions: [
        { kind: "agent", id: "qa", disposition: "adopt_as_is" },
        { kind: "agent", id: "qa", disposition: "compatibility_only" },
      ],
    });
    expect(out.status).toBe("refused");
    expect(String(out.reason)).toMatch(/duplicate decision/);
  });

  it("requires an authorizing record and a caller-supplied RFC3339 timestamp", () => {
    expect(flat(apply({ authorizedBy: undefined })).status).toBe("refused");
    expect(flat(apply({ adoptedAt: "yesterday" })).status).toBe("refused");
    expect(flat(apply({ runId: "run id with spaces" })).status).toBe("refused");
  });

  it("is deterministic — the same inputs produce the same commitment", () => {
    const a = apply({ dryRun: true });
    const b = apply({ dryRun: true });
    expect(a.manifest_digest).toBe(b.manifest_digest);
  });

  it("refuses every malformed disposition and options shape", () => {
    expect(flat(apply({ decisions: [] })).status).toBe("refused");
    expect(flat(apply({ decisions: [{ kind: "agent", id: "qa", disposition: "vibes" }] })).status).toBe(
      "refused",
    );
    expect(flat(apply({ decisions: new Proxy([], {}) })).status).toBe("refused");
    expect(flat(applyAdoptionPlan(new Proxy({}, {}))).status).toBe("refused");
    for (const d of ADOPTION_DISPOSITIONS) expect(typeof d).toBe("string");
  });

  it("refuses to extend a manifest that exists but does not validate", () => {
    write(ADOPTION_MANIFEST_RELPATH, '{"schema_version":"guild.adoption_manifest.v1"}');
    const out = apply();
    expect(out.status).toBe("refused");
    expect(String(out.reason)).toMatch(/not a valid guild.adoption_manifest.v1/);
  });
});

describe("D6 — one-command rollback", () => {
  function adopt(): void {
    const out = flat(
      applyAdoptionPlan({
        pluginRoot: PLUGIN_ROOT,
        projectRoot: tmp,
        projectId: "demo",
        report: report(),
        decisions: [
          { kind: "agent", id: "qa", disposition: "adopt_as_is" },
          { kind: "skill", id: "qa-test-strategy", disposition: "adopt_as_is" },
        ],
        runId: "run-20260801-120000-adopt",
        authorizedBy: "cap-loc-D06",
        adoptedAt: AT,
      }),
    );
    if (out.status !== "applied") throw new Error(`adopt failed: ${String(out.reason)}`);
  }

  function rollback(over: Record<string, unknown> = {}): Flat {
    return flat(
      rollbackAdoption({
        pluginRoot: PLUGIN_ROOT,
        projectRoot: tmp,
        projectId: "demo",
        runId: "run-20260801-130000-rollback",
        authorizedBy: "cap-loc-D03",
        adoptedAt: "2026-08-01T13:00:00Z",
        reason: "adoption regressed lane dispatch",
        ...over,
      }),
    );
  }

  it("removes the copies and APPENDS reversal entries — never deletes history", () => {
    adopt();
    const out = rollback();
    expect(out.status).toBe("rolled_back");
    expect(out.removed).toEqual([".guild/agents/qa.md", ".guild/skills/qa-test-strategy/SKILL.md"]);
    expect(out.restored_ids).toEqual(["qa", "qa-test-strategy"]);
    expect(fs.existsSync(path.join(tmp, ".guild/agents/qa.md"))).toBe(false);

    const manifest = readAdoptionManifest(tmp)!;
    // The original entries are STILL THERE. The rollback is forward history.
    expect(manifest.entries.length).toBe(4);
    expect(manifest.entries.slice(0, 2).map((e) => e.reason)).toEqual(["migrated", "migrated"]);
    expect(manifest.entries.slice(2).every((e) => e.reason === "rolled_back")).toBe(true);
    expect(manifest.entries.slice(2).map((e) => e.reverses_sequence).sort()).toEqual([1, 2]);
    expect(manifest.entries.slice(2).every((e) => String(e.detail).includes("regressed"))).toBe(true);
  });

  it("leaves the historical evidence byte-identical across adopt + rollback", () => {
    const evidence = [
      ".guild/team/feature.build.yaml",
      ".guild/plan/feature.md",
      ".guild/runs/run-20260701-000000-feature/handoffs/qa-t1.md",
    ];
    const before = evidence.map((f) => fs.readFileSync(path.join(tmp, f)));
    adopt();
    rollback();
    evidence.forEach((f, i) => {
      expect(fs.readFileSync(path.join(tmp, f)).equals(before[i])).toBe(true);
    });
  });

  it("LEAVES a hand-edited copy in place rather than destroying the work", () => {
    adopt();
    write(".guild/agents/qa.md", "---\nname: qa\n---\n\nedited after adoption\n");
    const out = rollback();
    expect(out.status).toBe("rolled_back");
    expect(out.removed).toEqual([".guild/skills/qa-test-strategy/SKILL.md"]);
    expect(fs.readFileSync(path.join(tmp, ".guild/agents/qa.md"), "utf8")).toContain("edited after");
  });

  it("rolls back one named sequence, and refuses to reverse it twice", () => {
    adopt();
    const first = rollback({ sequences: [1] });
    expect(first.status).toBe("rolled_back");
    expect(first.entries_appended).toBe(1);
    expect(fs.existsSync(path.join(tmp, ".guild/skills/qa-test-strategy/SKILL.md"))).toBe(true);

    const again = rollback({ sequences: [1] });
    expect(again.status).toBe("refused");
    expect(String(again.reason)).toMatch(/already reversed/);
  });

  it("requires a reason, and refuses when there is nothing to roll back", () => {
    adopt();
    expect(flat(rollback({ reason: "" })).status).toBe("refused");
    rollback();
    expect(flat(rollback()).status).toBe("refused");
  });

  it("refuses when the manifest belongs to another project", () => {
    adopt();
    expect(flat(rollback({ projectId: "other" })).status).toBe("refused");
  });

  it("refuses with no manifest at all", () => {
    const out = rollback();
    expect(out.status).toBe("refused");
    expect(String(out.reason)).toMatch(/no valid/);
  });

  it("re-adoption after a rollback resolves as NEW history, not a cycle", () => {
    adopt();
    rollback();
    const again = flat(
      applyAdoptionPlan({
        pluginRoot: PLUGIN_ROOT,
        projectRoot: tmp,
        projectId: "demo",
        report: report(),
        decisions: [{ kind: "agent", id: "qa", disposition: "adopt_as_is" }],
        runId: "run-20260801-140000-readopt",
        authorizedBy: "cap-loc-D06",
        adoptedAt: "2026-08-01T14:00:00Z",
      }),
    );
    expect(again.status).toBe("applied");

    // The query PINS the origin bytes. Once an id has been adopted, rolled back,
    // and re-adopted, its history contains two genuinely different sources
    // (the shipped bytes and the adopted copy), so a bare-id query is correctly
    // `ambiguous` — the caller has not said which one it means. A real caller
    // always can: a handoff receipt records the definition it actually used.
    const shipped = fs.readFileSync(path.join(PLUGIN_ROOT, "templates/specialists/qa.md"));
    const originHash = `sha256:${crypto.createHash("sha256").update(shipped).digest("hex")}`;
    expect(resolveHistorical(readAdoptionManifest(tmp), { kind: "agent", id: "qa" }).status).toBe(
      "ambiguous",
    );

    const res = resolveHistorical(readAdoptionManifest(tmp), {
      kind: "agent",
      id: "qa",
      content_hash: originHash,
    });
    expect(res.status).toBe("resolved");
    expect(res.ref!.relative_path).toBe(".guild/agents/qa.md");
    // adopt → rollback → re-adopt, walked as forward history rather than a cycle.
    expect(res.trail.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Codex adversarial round 1 — regression rows
// ---------------------------------------------------------------------------

describe("D6 — codex round 1 regressions", () => {
  const decisions = [
    { kind: "agent", id: "qa", disposition: "adopt_as_is" },
    { kind: "skill", id: "qa-test-strategy", disposition: "adopt_as_is" },
  ];

  function apply(over: Record<string, unknown> = {}): Flat {
    return flat(
      applyAdoptionPlan({
        pluginRoot: PLUGIN_ROOT,
        projectRoot: tmp,
        projectId: "demo",
        report: report(),
        decisions,
        runId: "run-20260801-120000-adopt",
        authorizedBy: "cap-loc-D06",
        adoptedAt: AT,
        ...over,
      }),
    );
  }

  it("#1 (CRITICAL) refuses to write through a symlinked target", () => {
    // `readRegularFile` returns null for a symlink, so the existence check read the
    // target as ABSENT while `writeFileSync` follows it — an arbitrary file outside
    // the project was overwritten with the adopted template, and the call reported
    // `applied`.
    const victimDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-victim-"));
    const victim = path.join(victimDir, "victim.md");
    fs.writeFileSync(victim, "PRECIOUS\n", "utf8");
    fs.mkdirSync(path.join(tmp, ".guild/agents"), { recursive: true });
    fs.symlinkSync(victim, path.join(tmp, ".guild/agents/qa.md"));

    const out = apply({ decisions: [{ kind: "agent", id: "qa", disposition: "adopt_as_is" }] });
    expect(out.status).toBe("refused");
    expect(fs.readFileSync(victim, "utf8")).toBe("PRECIOUS\n");
    expect(fs.lstatSync(path.join(tmp, ".guild/agents/qa.md")).isSymbolicLink()).toBe(true);
    fs.rmSync(victimDir, { recursive: true, force: true });
  });

  it("#2 rollback does NOT delete a pre-existing substitute target", () => {
    // Hash equality proves "unchanged", not "created by the migration". A
    // `substitute` writes nothing, so rolling one back used to delete the operator's
    // own hand-authored file.
    write(".guild/agents/quality.md", "---\nname: quality\n---\n\nhand-authored\n");
    const adopted = apply({
      decisions: [
        {
          kind: "agent",
          id: "qa",
          disposition: "substitute",
          substitute_path: ".guild/agents/quality.md",
          substitute_id: "quality",
        },
      ],
    });
    expect(adopted.status).toBe("applied");

    const out = flat(
      rollbackAdoption({
        pluginRoot: PLUGIN_ROOT,
        projectRoot: tmp,
        projectId: "demo",
        runId: "run-20260801-130000-rollback",
        authorizedBy: "cap-loc-D03",
        adoptedAt: "2026-08-01T13:00:00Z",
        reason: "substitution regressed",
      }),
    );
    expect(out.status).toBe("rolled_back");
    expect(out.removed).toEqual([]);
    expect(out.kept_local_edits).toEqual([".guild/agents/quality.md"]);
    expect(fs.readFileSync(path.join(tmp, ".guild/agents/quality.md"), "utf8")).toContain("hand-authored");
  });

  it("#3 a mid-write I/O failure is rolled back, not half-applied", () => {
    // A regular file where a skill DIRECTORY must go makes the second mkdirSync
    // fail. Previously that threw EEXIST out of the function after the first file
    // had been written and before the manifest existed.
    fs.mkdirSync(path.join(tmp, ".guild/skills"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".guild/skills/qa-test-strategy"), "not a directory\n");

    let out: Flat;
    expect(() => {
      out = apply();
    }).not.toThrow();
    expect(out!.status).toBe("refused");
    expect(String(out!.reason)).toMatch(/rolled back/);
    // The first write was undone and no manifest was left behind.
    expect(fs.existsSync(path.join(tmp, ".guild/agents/qa.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, ADOPTION_MANIFEST_RELPATH))).toBe(false);
  });

  it("#5 names a role a team file claims is shipped but the catalog lacks", () => {
    // Was DEAD CODE: the scan only recognized ids already in the catalog, so a
    // team file naming a vanished shipped role produced an empty report with no
    // problems — the loudest breakage a migration must surface, reported as
    // "nothing to do".
    write(
      ".guild/team/ghost.build.yaml",
      "specialists:\n  - name: ghost-role\n    definition_source: shipped\n",
    );
    const r = report();
    expect(r.unresolvable_references).toContain("ghost-role");
    // …and machinery agents are NOT flagged: they are shipped forever and are
    // correctly absent from the 73-asset compatibility surface.
    expect(r.unresolvable_references).not.toContain("developer");
    expect(r.unresolvable_references).not.toContain("advisor");
  });

  it("#6 an incomplete plan reports its own incompleteness", () => {
    const out = apply({ decisions: [{ kind: "agent", id: "qa", disposition: "adopt_as_is" }] });
    expect(out.status).toBe("applied");
    // Was: indistinguishable from a complete migration.
    expect(out.undecided).toEqual(["qa-test-strategy"]);
  });

  it("#6 refuses to apply a plan built on a report that names an unresolvable reference", () => {
    write(
      ".guild/team/ghost.build.yaml",
      "specialists:\n  - name: ghost-role\n    definition_source: shipped\n",
    );
    const out = apply();
    expect(out.status).toBe("refused");
    expect(String(out.reason)).toMatch(/unresolvable reference/);
  });

  it("#10 a Proxy on the nested catalog cannot execute or escape", () => {
    // The outer options snapshot protected the bag but not the object NESTED in it,
    // so a throwing `get` trap ran and escaped a function that claims never to throw.
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("catalog getter ran");
        },
      },
    );
    let r: Record<string, unknown>;
    expect(() => {
      r = buildAdoptionReport({
        pluginRoot: PLUGIN_ROOT,
        projectRoot: tmp,
        projectId: "demo",
        catalog: hostile,
      }) as unknown as Record<string, unknown>;
    }).not.toThrow();
    expect((r!.problems as string[]).length).toBe(1);
    expect(r!.items).toEqual([]);
  });

  it("#13 never throws on a BigInt", () => {
    expect(() => buildAdoptionReport({ pluginRoot: PLUGIN_ROOT, projectRoot: tmp, projectId: 1n })).not.toThrow();
    expect(() => apply({ decisions: [{ kind: "agent", id: "qa", disposition: 1n }] })).not.toThrow();
    expect(apply({ decisions: [{ kind: "agent", id: "qa", disposition: 1n }] }).status).toBe("refused");
  });
});

describe("D6 — codex round 2 regressions (literal-only fixes)", () => {
  function apply(over: Record<string, unknown> = {}): Flat {
    return flat(
      applyAdoptionPlan({
        pluginRoot: PLUGIN_ROOT,
        projectRoot: tmp,
        projectId: "demo",
        report: report(),
        decisions: [{ kind: "agent", id: "qa", disposition: "adopt_as_is" }],
        runId: "run-20260801-120000-adopt",
        authorizedBy: "cap-loc-D06",
        adoptedAt: AT,
        ...over,
      }),
    );
  }

  it("R2 refuses a write through a symlinked PARENT DIRECTORY", () => {
    // Round 1's fix lstat-ed the LEAF, so a symlinked `.guild/agents` left the leaf
    // non-existent, `mkdirSync(recursive)` succeeded because the directory already
    // did, and the adopted template landed outside the project anyway — the same
    // escape one level up.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-outside-"));
    fs.mkdirSync(path.join(tmp, ".guild"), { recursive: true });
    fs.symlinkSync(outsideDir, path.join(tmp, ".guild/agents"), "dir");

    const out = apply();
    expect(out.status).toBe("refused");
    expect(String(out.reason)).toMatch(/outside the project root/);
    expect(fs.readdirSync(outsideDir)).toEqual([]);
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("R2 refuses a ROLLBACK removal that would escape the project root", () => {
    // A delete that escapes is worse than a write that does.
    const adopted = apply();
    expect(adopted.status).toBe("applied");

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-outside-"));
    const adoptedBytes = fs.readFileSync(path.join(tmp, ".guild/agents/qa.md"));
    fs.rmSync(path.join(tmp, ".guild/agents"), { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "qa.md"), adoptedBytes);
    fs.symlinkSync(outsideDir, path.join(tmp, ".guild/agents"), "dir");

    const out = flat(
      rollbackAdoption({
        pluginRoot: PLUGIN_ROOT,
        projectRoot: tmp,
        projectId: "demo",
        runId: "run-20260801-130000-rollback",
        authorizedBy: "cap-loc-D03",
        adoptedAt: "2026-08-01T13:00:00Z",
        reason: "escape probe",
      }),
    );
    expect(out.status).toBe("refused");
    expect(String(out.reason)).toMatch(/outside the project root/);
    expect(fs.existsSync(path.join(outsideDir, "qa.md"))).toBe(true);
    fs.rmSync(path.join(tmp, ".guild/agents"));
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  // ANTI-VACUITY partner: an ordinary adoption still works, so the two rows above
  // are not passing because containment refuses everything.
  it("R2 an ordinary in-project adoption is still permitted", () => {
    expect(apply().status).toBe("applied");
    expect(fs.existsSync(path.join(tmp, ".guild/agents/qa.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The CLI surface
// ---------------------------------------------------------------------------
//
// The suites above call the library directly, so they cannot catch a verb that
// forgets to pass a required argument. An end-to-end adopt → rollback through the
// actual command found exactly that (`rollback` omitted `pluginRoot` and refused
// every invocation), which is why this walks the CLI rather than the library.

describe("D6 — the capability-adopt command, end to end", () => {
  it("report → adopt → rollback completes through the real verbs", () => {
    const { capabilityAdoptMain } = require("../capability-adopt") as {
      capabilityAdoptMain: (argv: readonly string[]) => number;
    };
    const base = ["--project-id", "demo", "--project-root", tmp, "--plugin-root", PLUGIN_ROOT];

    const out: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    // Silence the command's own output; the assertions are on exit codes and disk.
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      out.push(s);
      return true;
    };
    try {
      expect(capabilityAdoptMain(["report", ...base])).toBe(0);
      // The read-only verb really is read-only, through the CLI too.
      expect(fs.existsSync(path.join(tmp, ADOPTION_MANIFEST_RELPATH))).toBe(false);

      const plan = path.join(tmp, "plan.json");
      fs.writeFileSync(
        plan,
        JSON.stringify({ decisions: [{ kind: "agent", id: "qa", disposition: "adopt_as_is" }] }),
      );
      expect(
        capabilityAdoptMain([
          "adopt",
          ...base,
          "--decisions",
          plan,
          "--run-id",
          "run-a",
          "--authorized-by",
          "cap-loc-D06",
          "--adopted-at",
          AT,
        ]),
      ).toBe(0);
      expect(fs.existsSync(path.join(tmp, ".guild/agents/qa.md"))).toBe(true);

      expect(
        capabilityAdoptMain([
          "rollback",
          ...base,
          "--run-id",
          "run-b",
          "--authorized-by",
          "cap-loc-D03",
          "--adopted-at",
          "2026-08-01T13:00:00Z",
          "--reason",
          "smoke",
        ]),
      ).toBe(0);
      expect(fs.existsSync(path.join(tmp, ".guild/agents/qa.md"))).toBe(false);

      const manifest = readAdoptionManifest(tmp)!;
      expect(manifest.entries.map((e) => e.reason)).toEqual(["migrated", "rolled_back"]);
    } finally {
      (process.stdout as unknown as { write: typeof write }).write = write;
    }
  });
});

describe("D6 — codex round 3 regressions (rollback mutation phase)", () => {
  function adopt(): void {
    const out = flat(
      applyAdoptionPlan({
        pluginRoot: PLUGIN_ROOT,
        projectRoot: tmp,
        projectId: "demo",
        report: report(),
        decisions: [{ kind: "agent", id: "qa", disposition: "adopt_as_is" }],
        runId: "run-a",
        authorizedBy: "cap-loc-D06",
        adoptedAt: AT,
      }),
    );
    if (out.status !== "applied") throw new Error(`adopt failed: ${String(out.reason)}`);
  }

  function rollback(): Flat {
    return flat(
      rollbackAdoption({
        pluginRoot: PLUGIN_ROOT,
        projectRoot: tmp,
        projectId: "demo",
        runId: "run-b",
        authorizedBy: "cap-loc-D03",
        adoptedAt: "2026-08-01T13:00:00Z",
        reason: "io probe",
      }),
    );
  }

  it("R3 an unwritable manifest REFUSES without deleting anything", () => {
    // Was: the EACCES escaped a function documented as never throwing, and by then
    // the adopted copy had ALREADY been deleted — file gone, no record that the
    // reversal happened. The manifest is now written FIRST, so a failure there
    // means nothing was touched.
    adopt();
    const manifest = path.join(tmp, ADOPTION_MANIFEST_RELPATH);
    fs.chmodSync(manifest, 0o444);
    try {
      let out: Flat;
      expect(() => {
        out = rollback();
      }).not.toThrow();
      expect(out!.status).toBe("refused");
      expect(String(out!.reason)).toMatch(/nothing was removed/);
      expect(fs.existsSync(path.join(tmp, ".guild/agents/qa.md"))).toBe(true);
    } finally {
      fs.chmodSync(manifest, 0o644);
    }
  });

  it("R3 `removed` never claims a deletion that did not happen", () => {
    // Was: rmSync threw against a read-only parent, the catch swallowed it, and the
    // outcome still reported the file as removed while it sat on disk.
    adopt();
    const agents = path.join(tmp, ".guild/agents");
    fs.chmodSync(agents, 0o555);
    try {
      const out = rollback();
      expect(out.status).toBe("rolled_back");
      expect(out.removed).toEqual([]);
      expect((out.removal_failed as string[]).length).toBe(1);
      expect(String((out.removal_failed as string[])[0])).toContain(".guild/agents/qa.md");
      expect(fs.existsSync(path.join(agents, "qa.md"))).toBe(true);
    } finally {
      fs.chmodSync(agents, 0o755);
    }
  });

  // ANTI-VACUITY partner: an unobstructed rollback still removes and reports it.
  it("R3 an unobstructed rollback still removes the copy and reports no failures", () => {
    adopt();
    const out = rollback();
    expect(out.status).toBe("rolled_back");
    expect(out.removed).toEqual([".guild/agents/qa.md"]);
    expect(out.removal_failed).toEqual([]);
    expect(fs.existsSync(path.join(tmp, ".guild/agents/qa.md"))).toBe(false);
  });
});

describe("D6 — re-running the report over an already-migrated project", () => {
  function adoptQa(): void {
    const out = flat(
      applyAdoptionPlan({
        pluginRoot: PLUGIN_ROOT,
        projectRoot: tmp,
        projectId: "demo",
        report: report(),
        decisions: [{ kind: "agent", id: "qa", disposition: "adopt_as_is" }],
        runId: "run-a",
        authorizedBy: "cap-loc-D06",
        adoptedAt: AT,
      }),
    );
    if (out.status !== "applied") throw new Error(`adopt failed: ${String(out.reason)}`);
  }

  it("reads a definition's DECLARED skills, not the roles named in its prose", () => {
    // A shipped template's `description` carries DO-NOT-TRIGGER boundary guidance
    // naming half the roster ("DO NOT TRIGGER for: system design (architect …),
    // app code (backend …), CI/CD (devops …)"). Scanning the whole file reported
    // architect, backend, devops, marketing, mobile, researcher and security as
    // dependencies of `qa` — seven templates a migration would copy for no reason.
    // A boundary note is the OPPOSITE of a dependency.
    adoptQa();
    const ids = (report().items as Array<Record<string, unknown>>).map((i) => i.id);

    // The four skills `qa` actually declares in its frontmatter `skills:` list.
    expect(ids).toEqual(
      expect.arrayContaining([
        "qa",
        "qa-test-strategy",
        "qa-property-based-tests",
        "qa-snapshot-tests",
        "qa-flaky-test-hunter",
      ]),
    );
    // …and none of the roles its DO-NOT-TRIGGER prose merely mentions.
    for (const prose of ["architect", "backend", "devops", "marketing", "mobile", "researcher", "security"]) {
      expect(ids).not.toContain(prose);
    }
  });

  it("does not report an ADOPTED COPY as a hand-edited divergence", () => {
    // The copy differs from its source by exactly the provenance stamp, so a naive
    // byte compare called it `local_definition_differs` — which reads as "someone
    // hand-edited this", the one conflict that tells an operator to stop and merge.
    adoptQa();
    const qa = (report().items as Array<Record<string, unknown>>).find((i) => i.id === "qa")!;
    expect(qa.conflicts).toContain("local_definition_identical");
    expect(qa.conflicts).toContain("already_adopted");
    expect(qa.conflicts).not.toContain("local_definition_differs");
  });

  // ANTI-VACUITY: a genuinely hand-edited file must STILL be flagged, or the row
  // above is just "never report a divergence".
  it("still flags a genuinely hand-edited local definition", () => {
    write(".guild/agents/qa.md", "---\nname: qa\n---\n\nhand-edited, no stamp\n");
    const qa = (report().items as Array<Record<string, unknown>>).find((i) => i.id === "qa")!;
    expect(qa.conflicts).toContain("local_definition_differs");
  });

  it("flags a copy whose stamp names bytes the shipped asset no longer has", () => {
    // A stale stamp is not provenance for the CURRENT source — the shipped asset
    // moved on, so this copy really is out of date and must not read as identical.
    adoptQa();
    const p = path.join(tmp, ".guild/agents/qa.md");
    fs.writeFileSync(
      p,
      fs.readFileSync(p, "utf8").replace(/adopted_source_hash: sha256:[0-9a-f]{64}/, `adopted_source_hash: sha256:${"0".repeat(64)}`),
    );
    const qa = (report().items as Array<Record<string, unknown>>).find((i) => i.id === "qa")!;
    expect(qa.conflicts).toContain("local_definition_differs");
  });
});
