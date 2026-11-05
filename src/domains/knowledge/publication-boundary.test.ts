/**
 * K03 (CW-20) — hook hints meet the published generation (K02 carry-over).
 * Disposable git repos only.
 */
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { basisDigest, sourceWorktreeId, type Sha256 } from "./source-basis";
import { publishGeneration, type BasisRef } from "./publication";
import { hintPublicationFromCwd, publicationStatus, recordPublicationHints } from "./publication-boundary";
import { refreshTouched } from "./refresh-touched";
import { createGuildStorage } from "../state";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function repo(): string {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "k03-bnd-")));
  roots.push(r);
  execFileSync("git", ["init", "-q"], { cwd: r });
  fs.mkdirSync(path.join(r, "src"));
  fs.writeFileSync(path.join(r, "src", "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(r, "src", "b.ts"), "export const b = 1;\n");
  return r;
}

const H = (c: string) => `sha256:${c.repeat(64)}` as Sha256;

/** A tiny observer: inventory = sha of each file under src/. */
function observe(root: string): BasisRef {
  const inventory = fs
    .readdirSync(path.join(root, "src"))
    .sort()
    .map((f) => ({ path: `src/${f}`, sha256: basisDigest(fs.readFileSync(path.join(root, "src", f), "utf8")) }));
  const basis = {
    commit: null,
    tree: H("1"),
    dirty_blob_manifest: H("2"),
    file_inventory: basisDigest(inventory),
    resolver_policy: H("3"),
    scan_policy: H("4"),
    source_worktree_id: sourceWorktreeId(root),
  };
  return { basis, source_basis_hash: basisDigest(basis), inventory };
}

function publish(root: string): string {
  const indexesDir = path.join(root, ".guild", "indexes");
  const b = observe(root);
  const r = publishGeneration({
    indexesDir,
    identity: { source_id: "owner", durable_owner_source_id: "owner", publication_scope_source_id: "owner" },
    layers: { structural_graph: { artifact: "layer.json", digest: (a) => basisDigest(a["layer.json"]!.toString()) } },
    channels: ["structural_graph"],
    base: null,
    basis: b,
    observe: () => b,
    artifacts: { "layer.json": "{}" },
  });
  expect(r.status).toBe("published");
  return indexesDir;
}

describe("K03 boundary: hook hints are not evidence", () => {
  test("a hint makes the published layer pending; verification against the source decides", () => {
    const r = repo();
    const idx = publish(r);
    expect(publicationStatus({ indexesDir: idx })!.channels[0].state).toBe("current_for_basis");
    // Hook fires on a no-op save: pending, not stale, not current.
    expect(recordPublicationHints({ indexesDir: idx, sourceRoot: r, paths: [path.join(r, "src/a.ts")] }).recorded).toBe(true);
    const pending = publicationStatus({ indexesDir: idx })!;
    expect(pending.channels[0].state).toBe("pending");
    expect(pending.admit_critical).toBe(false);
    expect(pending.refresh!.jobs[0]).toEqual({ channel: "structural_graph", paths: ["src/a.ts"] });
    // Verification: bytes unchanged ⇒ current again, critical admitted.
    const v = publicationStatus({ indexesDir: idx, observe: () => observe(r) })!;
    expect(v.channels[0].state).toBe("current_for_basis");
    expect(v.admit_critical).toBe(true);
    // A later hint is pending again.
    recordPublicationHints({ indexesDir: idx, sourceRoot: r, paths: ["src/b.ts"] });
    expect(publicationStatus({ indexesDir: idx })!.channels[0].state).toBe("pending");
  });

  test("a dropped hook is caught by the basis comparison (drift + hints_missed)", () => {
    const r = repo();
    const idx = publish(r);
    fs.writeFileSync(path.join(r, "src", "b.ts"), "export const b = 2;\n"); // no hook fired
    recordPublicationHints({ indexesDir: idx, sourceRoot: r, paths: ["src/a.ts"] });
    const st = publicationStatus({ indexesDir: idx, observe: () => observe(r) })!;
    expect(st.channels[0].state).toBe("stale");
    expect(st.verdict!.drift).toEqual(["src/b.ts"]);
    expect(st.verdict!.hints_missed).toEqual(["src/b.ts"]);
    expect(st.refresh!.jobs[0].paths).toEqual(["src/a.ts", "src/b.ts"]);
    // The recorded verification keeps readers without an observer stale.
    expect(publicationStatus({ indexesDir: idx })!.channels[0].state).toBe("stale");
  });

  test("negative control: without the hint log a no-hint reader would call it current", () => {
    const r = repo();
    const idx = publish(r);
    fs.writeFileSync(path.join(r, "src", "a.ts"), "export const a = 9;\n");
    // No hint and no observer: the record alone still says current (not evidence).
    expect(publicationStatus({ indexesDir: idx })!.channels[0].state).toBe("current_for_basis");
    expect(publicationStatus({ indexesDir: idx })!.admit_critical).toBe(false);
    // Only the comparison finds it.
    expect(publicationStatus({ indexesDir: idx, observe: () => observe(r) })!.channels[0].state).toBe("stale");
  });

  test("critical admission verifies the generation bytes, not only its metadata", () => {
    const r = repo();
    const idx = publish(r);
    expect(publicationStatus({ indexesDir: idx, observe: () => observe(r) })!.admit_critical).toBe(true);
    const gdir = path.join(idx, "publication", "generations");
    const g = fs.readdirSync(gdir).find((n) => !n.startsWith("."))!;
    const f = path.join(gdir, g, "layer.json");
    fs.chmodSync(f, 0o644);
    fs.writeFileSync(f, "{\"tampered\":true}");
    expect(publicationStatus({ indexesDir: idx, observe: () => observe(r) })!.admit_critical).toBe(false);
  });

  test("a planted symlink at a predictable temp path is never followed", () => {
    const r = repo();
    const idx = publish(r);
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "k03-out-")), "victim");
    roots.push(path.dirname(outside));
    fs.writeFileSync(outside, "keep");
    const st = publicationStatus({ indexesDir: idx, observe: () => observe(r) })!;
    const ver = path.join(idx, "publication", "verifications", `${st.generation.slice(7)}.json`);
    fs.symlinkSync(outside, `${ver}.${process.pid}.tmp`);
    publicationStatus({ indexesDir: idx, observe: () => observe(r) });
    expect(fs.readFileSync(outside, "utf8")).toBe("keep");
  });

  test("over-budget verification stays pending", () => {
    const r = repo();
    const idx = publish(r);
    recordPublicationHints({ indexesDir: idx, sourceRoot: r, paths: ["src/a.ts"] });
    const st = publicationStatus({ indexesDir: idx, observe: () => observe(r), budget: { max_files: 1, max_bytes: 1 } })!;
    expect(st.verdict!.state).toBe("pending");
    expect(st.channels[0].state).toBe("pending");
    // Without any hint too: an unverified call never echoes the record's current.
    const r2 = repo();
    const idx2 = publish(r2);
    const st2 = publicationStatus({ indexesDir: idx2, observe: () => observe(r2), budget: { max_files: 1, max_bytes: 1 } })!;
    expect(st2.channels[0].state).toBe("pending");
  });

  test("hints from another worktree, outside the source root, or into .guild are ignored", () => {
    const r = repo();
    const idx = publish(r);
    const other = repo();
    expect(recordPublicationHints({ indexesDir: idx, sourceRoot: other, paths: ["src/a.ts"] }).reason).toMatch(/another worktree/);
    expect(recordPublicationHints({ indexesDir: idx, sourceRoot: r, paths: ["/etc/passwd", "../x.ts", ".guild/wiki/a.md"] }).recorded).toBe(false);
    expect(publicationStatus({ indexesDir: idx })!.channels[0].state).toBe("current_for_basis");
  });

  test("refreshTouched (the after-edit hook path) logs the hint against the owner publication", () => {
    const r = repo();
    const idx = publish(r);
    const storage = createGuildStorage(r);
    const res = refreshTouched([path.join(r, "src", "a.ts")], { storage });
    expect(res.publication_hint.recorded).toBe(true);
    expect(res.publication_hint.paths).toEqual(["src/a.ts"]);
    expect(publicationStatus({ indexesDir: idx })!.channels[0].state).toBe("pending");
  });

  test("hintPublicationFromCwd never throws and records nothing without a publication", () => {
    const r = repo();
    expect(hintPublicationFromCwd(r, ["src/a.ts"]).recorded).toBe(false);
    fs.mkdirSync(path.join(r, ".guild", "indexes", "publication"), { recursive: true });
    fs.writeFileSync(path.join(r, ".guild", "indexes", "publication", "CURRENT"), "garbage");
    expect(hintPublicationFromCwd(r, ["src/a.ts"]).recorded).toBe(false);
  });
});
