/**
 * decision-propagation.test.ts — K04 AT37 (decision propagation) and AT38
 * (promotion boundary). Drives the real harvest writer, the real learn
 * publication path and the owner `.guild/` on disposable roots only.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createGuildStorage, type GuildStorage } from "../state";
import {
  decisionPublicationRefs,
  decisionsHome,
  federatedCandidateView,
  harvestDecision,
  pinDependent,
  propagateDecisions,
  publishDecisionCandidates,
  readDecisionLedger,
  recordAcceptedDecision,
  type EntityRef,
} from ".";
import { publishGeneration, readPublicationRecord, type BasisRef } from "./publication";
import { publicationStatus } from "./publication-boundary";
import { upsertOp } from "./harvest-journal";
import { basisDigest } from "./source-basis";

const RUN_ID = "run-k04";
let sandbox: string;
const savedEnv: Record<string, string | undefined> = {};
const HOST_ENV = ["HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME"];

interface Root {
  root: string;
  guildDir: string;
  storage: GuildStorage;
  runDir: string;
}

function mkRoot(name: string, profile: "standalone" | "child" = "standalone"): Root {
  const root = path.join(sandbox, name);
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  const ext = path.join(sandbox, "external", name);
  const storage = createGuildStorage(root, {
    activeRoot: root,
    profile,
    env: {
      GUILD_STATE_HOME: path.join(ext, "state"),
      GUILD_CACHE_HOME: path.join(ext, "cache"),
      GUILD_WORKTREE_HOME: path.join(ext, "worktrees"),
      GUILD_TEMP_HOME: path.join(ext, "temp"),
    } as NodeJS.ProcessEnv,
  });
  const runDir = storage.project!.runRecord(RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  return { root, guildDir: storage.project!.definitions(), storage, runDir };
}

function harvest(r: Root, slug: string, extra: Record<string, unknown> = {}) {
  return harvestDecision({
    run_id: RUN_ID,
    runDir: r.runDir,
    storage: r.storage,
    trigger: "redirect_threshold",
    slug,
    title: `Decision ${slug}`,
    body: `The team adopts ${slug} for queue consumers.`,
    reasoning: "Recorded by the K04 fixture.",
    source_refs: ["run:run-k04"],
    ...extra,
  });
}

function write(abs: string, text: string): string {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

function sha(b: Buffer | string): `sha256:${string}` {
  return `sha256:${crypto.createHash("sha256").update(b).digest("hex")}`;
}

/** Path → sha256 of every regular file under `dir` (symlinks recorded as such). */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) out[path.relative(dir, p)] = "symlink";
      else if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = sha(fs.readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

function changed(before: Record<string, string>, after: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => before[k] !== after[k]).sort();
}

function decisionRev(r: Root, slug: string): `sha256:${string}` {
  return sha(fs.readFileSync(path.join(r.guildDir, "wiki", "decisions", `${slug}.md`)));
}

beforeEach(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-k04-")));
  const host = path.join(sandbox, "host");
  for (const k of HOST_ENV) {
    savedEnv[k] = process.env[k];
    process.env[k] = path.join(host, k.toLowerCase());
  }
});

afterEach(() => {
  for (const k of HOST_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** Shared AT37 fixture: accepted D1, a plan, a summary and a lesson pinning D1. */
function at37Fixture() {
  const r = mkRoot("repo");
  const d1 = harvest(r, "retry-policy-v1");
  expect(d1.promoted).toBe(true);
  const plan = write(path.join(r.guildDir, "plan", "lane-a.md"), "# Lane A\n\nUse retry-policy-v1.\n");
  const summary = write(path.join(r.guildDir, "memory", "summaries", "retries.md"), "Retries follow retry-policy-v1.\n");
  const lesson = write(path.join(r.guildDir, "memory", "lessons", "idempotency.md"), "Lesson: idempotent consumers.\n");
  const pinD1 = [{ id: "decision:retry-policy-v1", revision: decisionRev(r, "retry-policy-v1") }];
  for (const [kind, name, p] of [["plan", "lane-a", plan], ["summary", "retries", summary], ["lesson", "idempotency", lesson]] as const) {
    const res = pinDependent({ guildDir: r.guildDir, kind, name, path: p, decisions: pinD1, expectRevision: null });
    expect(res.status).toBe("pinned");
  }
  return { r, plan, summary, lesson, pinD1 };
}

describe("AT37 decision propagation", () => {
  it("harvest records accepted events; supersession marks the plan replan_required and memory stale without rewriting either", () => {
    const { r, plan, summary, lesson, pinD1 } = at37Fixture();
    const before = propagateDecisions({ guildDir: r.guildDir });
    expect(before.status === "ok" && before.report.replan_required).toEqual([]);
    expect(before.status === "ok" && before.report.project_memory.state).toBe("current_for_basis");

    const planBytes = fs.readFileSync(plan);
    const memBytes = [fs.readFileSync(summary), fs.readFileSync(lesson)];
    const pinsBefore = tree(path.join(decisionsHome(r.guildDir), "pins"));
    const d1Page = fs.readFileSync(path.join(r.guildDir, "wiki", "decisions", "retry-policy-v1.md"));

    const d2 = harvest(r, "retry-policy-v2", { replaces: "decision:retry-policy-v1", superseded_ids: ["decision:retry-policy-v1"] });
    expect(d2.promoted).toBe(true);
    // The real harvest path reports the dependents of the superseded decision.
    expect(d2.replan_queued).toBe(true);
    expect(d2.stale_decision_ids).toEqual(["decision:retry-policy-v1"]);
    expect(d2.replan_required?.map((e) => e.id)).toEqual(["plan:lane-a"]);

    const ledger = readDecisionLedger(r.guildDir);
    expect(ledger.events.map((e) => [e.seq, e.decision.id])).toEqual([[1, "decision:retry-policy-v1"], [2, "decision:retry-policy-v2"]]);
    expect(ledger.decisions.get("decision:retry-policy-v1")!.status).toBe("superseded");
    expect(ledger.decisions.get("decision:retry-policy-v1")!.superseded_by!.id).toBe("decision:retry-policy-v2");
    expect(ledger.events[1]!.supersedes).toEqual([{ ...pinD1[0]!, source_id: ledger.events[0]!.decision.source_id, kind: "decision" }]);

    const after = propagateDecisions({ guildDir: r.guildDir });
    if (after.status !== "ok") throw new Error(after.detail);
    const planStatus = after.report.dependents.find((d) => d.dependent.id === "plan:lane-a")!;
    expect(planStatus.state).toBe("replan_required");
    expect(planStatus.stale_decisions[0]!.superseded_by!.id).toBe("decision:retry-policy-v2");
    expect(after.report.replan_required).toEqual([{ ...planStatus.dependent }]);
    expect(after.report.replan_required[0]!.revision).toBe(sha(planBytes));
    expect(after.report.project_memory.state).toBe("stale");
    expect(after.report.project_memory.stale.map((e) => e.id)).toEqual(["lesson:idempotency", "summary:retries"]);
    expect(after.report.decision_refs.map((e) => e.id)).toEqual(["decision:retry-policy-v2"]);

    // Never rewritten: plan, memory, pins and the superseded page stay byte-identical.
    expect(fs.readFileSync(plan).equals(planBytes)).toBe(true);
    expect([fs.readFileSync(summary), fs.readFileSync(lesson)].every((b, i) => b.equals(memBytes[i]!))).toBe(true);
    expect(changed(pinsBefore, tree(path.join(decisionsHome(r.guildDir), "pins")))).toEqual([]);
    expect(fs.readFileSync(path.join(r.guildDir, "wiki", "decisions", "retry-policy-v1.md")).equals(d1Page)).toBe(true);
  });

  it("negative control: a plan cannot clear its replan by re-pinning new bytes to the superseded decision", () => {
    const { r, plan, pinD1 } = at37Fixture();
    harvest(r, "retry-policy-v2", { replaces: "decision:retry-policy-v1" });
    fs.appendFileSync(plan, "Edited after the supersession.\n");
    const repin = pinDependent({ guildDir: r.guildDir, kind: "plan", name: "lane-a", path: plan, decisions: pinD1 });
    expect(repin.status === "refused" && repin.reason).toBe("unapproved");
    // The in-place edit is not adopted as the pinned plan hash: still replan_required, pin unchanged.
    const p = propagateDecisions({ guildDir: r.guildDir });
    if (p.status !== "ok") throw new Error(p.detail);
    const st = p.report.dependents.find((d) => d.dependent.id === "plan:lane-a")!;
    expect(st.state).toBe("replan_required");
    expect(st.observed_revision).not.toBe(st.dependent.revision);
    expect(st.reasons.some((x) => /pin was not updated/.test(x))).toBe(true);

    // Replanning against D2 is the one way out, and the D1 pin stays in history.
    const ok = pinDependent({ guildDir: r.guildDir, kind: "plan", name: "lane-a", path: plan, decisions: [{ id: "decision:retry-policy-v2", revision: decisionRev(r, "retry-policy-v2") }], expectRevision: st.dependent.revision });
    expect(ok.status).toBe("pinned");
    expect(ok.status === "pinned" && ok.pin.history.map((h) => h.decisions[0]!.id)).toEqual(["decision:retry-policy-v1"]);
    const q = propagateDecisions({ guildDir: r.guildDir });
    expect(q.status === "ok" && q.report.replan_required).toEqual([]);
  });

  it("an in-place plan edit without a re-pin is replan_required, never silently adopted", () => {
    const { r, plan } = at37Fixture();
    fs.appendFileSync(plan, "Silent edit.\n");
    const p = propagateDecisions({ guildDir: r.guildDir });
    expect(p.status === "ok" && p.report.replan_required.map((e) => e.id)).toEqual(["plan:lane-a"]);
  });

  it("negative control: proposed decisions never become authority", () => {
    const r = mkRoot("repo");
    // autopromote:false stages a candidate; it has no accepted event and cannot be pinned.
    const staged = harvest(r, "proposed-cache", { autopromote: false });
    expect(staged.promoted).toBe(false);
    expect(staged.candidate_path).toBeDefined();
    expect(readDecisionLedger(r.guildDir).events).toEqual([]);
    const cand = staged.candidate_path!;
    expect(recordAcceptedDecision({ guildDir: r.guildDir, pagePath: cand }).status).toBe("refused");
    // Editing the candidate to say canonical does not make it authority.
    fs.writeFileSync(cand, fs.readFileSync(cand, "utf8").replace("status: candidate", "status: canonical"));
    const forged = recordAcceptedDecision({ guildDir: r.guildDir, pagePath: cand });
    expect(forged.status === "refused" && forged.reason).toBe("scope");
    // A wiki page that is not canonical is refused too.
    const proposed = write(
      path.join(r.guildDir, "wiki", "decisions", "proposed-cache.md"),
      "---\ntype: decision\nschema_version: guild.decision.v1\nid: decision:proposed-cache\nstatus: candidate\n---\n# x\n",
    );
    const np = recordAcceptedDecision({ guildDir: r.guildDir, pagePath: proposed });
    expect(np.status === "refused" && np.reason).toBe("not_canonical");
    const plan = write(path.join(r.guildDir, "plan", "p.md"), "plan\n");
    const pin = pinDependent({ guildDir: r.guildDir, kind: "plan", name: "p", path: plan, decisions: [{ id: "decision:proposed-cache", revision: sha(fs.readFileSync(cand)) }] });
    expect(pin.status === "refused" && pin.reason).toBe("unapproved");
    // A superseded id cannot be re-accepted.
    harvest(r, "a1");
    harvest(r, "a2", { replaces: "decision:a1" });
    const again = recordAcceptedDecision({ guildDir: r.guildDir, pagePath: path.join(r.guildDir, "wiki", "decisions", "a1.md") });
    expect(again.status === "refused" && again.reason).toBe("superseded");
  });

  it("a changed or reverted decision page invalidates its dependents; resume is idempotent", () => {
    const { r } = at37Fixture();
    const page = path.join(r.guildDir, "wiki", "decisions", "retry-policy-v1.md");
    expect(recordAcceptedDecision({ guildDir: r.guildDir, pagePath: page }).status).toBe("unchanged");
    fs.appendFileSync(page, "\nHand edit.\n");
    const p = propagateDecisions({ guildDir: r.guildDir });
    if (p.status !== "ok") throw new Error(p.detail);
    expect(p.report.replan_required.map((e) => e.id)).toEqual(["plan:lane-a"]);
    expect(p.report.dependents.find((d) => d.dependent.id === "plan:lane-a")!.stale_decisions[0]!.reason).toBe("page_changed");
    fs.rmSync(page);
    const q = propagateDecisions({ guildDir: r.guildDir, write: false });
    expect(q.status === "ok" && q.report.dependents[0]!.stale_decisions[0]!.reason).toBe("page_missing");
  });

  it("a tampered or forked ledger fails closed for propagation, pinning and publication refs", () => {
    const { r, plan, pinD1 } = at37Fixture();
    harvest(r, "retry-policy-v2", { replaces: "decision:retry-policy-v1" });
    const ev1 = path.join(decisionsHome(r.guildDir), "events", "000000000001.json");
    fs.writeFileSync(ev1, fs.readFileSync(ev1, "utf8").replace('"op_id"', '"op_id" ') );
    expect(propagateDecisions({ guildDir: r.guildDir }).status).toBe("refused");
    expect(pinDependent({ guildDir: r.guildDir, kind: "plan", name: "lane-a", path: plan, decisions: pinD1 }).status).toBe("refused");
    expect(() => decisionPublicationRefs(r.guildDir)).toThrow(/chain/);
  });

  it("concurrent accepts serialize into one contiguous chain", async () => {
    const r = mkRoot("repo");
    const slugs = ["c1", "c2", "c3", "c4"];
    for (const s of slugs) harvest(r, s, { autopromote: false });
    // Write canonical pages directly into this root's wiki (fixture only) and accept them in parallel processes.
    for (const s of slugs) write(path.join(r.guildDir, "wiki", "decisions", `${s}.md`), `---\ntype: decision\nschema_version: guild.decision.v1\nid: decision:${s}\nstatus: canonical\n---\n# ${s}\n`);
    const mod = path.join(__dirname, "decision-propagation.ts");
    const procs = slugs.map((s) =>
      Bun.spawn(["bun", "-e", `const m = require(${JSON.stringify(mod)}); const r = m.recordAcceptedDecision({ guildDir: ${JSON.stringify(r.guildDir)}, pagePath: ${JSON.stringify(path.join(r.guildDir, "wiki", "decisions", `${s}.md`))} }); if (r.status !== "recorded") { console.error(JSON.stringify(r)); process.exit(1); }`], { stderr: "pipe" }),
    );
    const codes = await Promise.all(procs.map((p) => p.exited));
    expect(codes).toEqual([0, 0, 0, 0]);
    const ledger = readDecisionLedger(r.guildDir);
    expect(ledger.events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(new Set(ledger.events.map((e) => e.decision.id)).size).toBe(4);
  }, 30000);

  it("the C13 publication carries decision_refs, replan_required and a stale project_memory channel", () => {
    const { r } = at37Fixture();
    harvest(r, "retry-policy-v2", { replaces: "decision:retry-policy-v1" });
    const indexesDir = path.join(r.guildDir, "indexes");
    const refs = decisionPublicationRefs(r.guildDir);
    expect(refs).not.toBeNull();
    const b0 = { commit: null, tree: sha("t"), dirty_blob_manifest: sha("d"), file_inventory: sha("f"), resolver_policy: sha("r"), scan_policy: sha("s"), source_worktree_id: "lane-a" };
    const basis: BasisRef = { basis: b0, source_basis_hash: basisDigest(b0) };
    const res = publishGeneration({
      indexesDir,
      identity: { source_id: "source-a", durable_owner_source_id: "source-a", publication_scope_source_id: "source-a" },
      layers: { structural_graph: { artifact: "g.json", digest: (a) => sha(a["g.json"] ?? "") } },
      channels: ["structural_graph"],
      base: null,
      basis,
      observe: () => basis,
      artifacts: { "g.json": "{}" },
      decisions: () => refs,
    });
    expect(res.status).toBe("published");
    const rec = readPublicationRecord(indexesDir)!.record;
    expect(rec.decision_refs.map((e: EntityRef) => e.id)).toEqual(["decision:retry-policy-v2"]);
    expect(rec.replan_required.map((e: EntityRef) => [e.kind, e.id])).toEqual([["knowledge", "plan:lane-a"]]);
    const mem = rec.channels.find((c) => c.channel === "project_memory")!;
    expect(mem.state).toBe("stale");
    expect(mem.output).toBeNull();
    for (const e of [...rec.decision_refs, ...rec.replan_required]) {
      expect(Object.keys(e).sort()).toEqual(["id", "kind", "revision", "source_id"]);
      expect(e.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(e.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    }
    expect(rec.channels.length).toBeLessThanOrEqual(5);
    // A ledger it cannot read refuses the publication rather than claiming no replan.
    const ev1 = path.join(decisionsHome(r.guildDir), "events", "000000000001.json");
    fs.writeFileSync(ev1, "{}");
    const refused = publishGeneration({
      indexesDir,
      identity: { source_id: "source-a", durable_owner_source_id: "source-a", publication_scope_source_id: "source-a" },
      layers: { structural_graph: { artifact: "g.json", digest: (a) => sha(a["g.json"] ?? "") } },
      channels: ["structural_graph"],
      base: readPublicationRecord(indexesDir)!.pointer,
      basis,
      observe: () => basis,
      artifacts: { "g.json": '{"n":1}' },
      decisions: () => decisionPublicationRefs(r.guildDir),
    });
    expect(refused.status === "refused" && refused.reason).toBe("invalid");
  });
});

describe("AT38 promotion boundary", () => {
  function workspace() {
    const umbrella = mkRoot("umbrella");
    const child = mkRoot(path.join("umbrella", "child"), "child");
    // Umbrella holds a canonical decision with the id the child will propose.
    const u = harvest(umbrella, "cache-strategy");
    expect(u.promoted).toBe(true);
    return { umbrella, child };
  }

  it("child candidate with an umbrella conflict stays pending human ingest; nothing crosses roots or reaches the host", () => {
    const { umbrella, child } = workspace();
    const host = path.join(sandbox, "host");
    const umbrellaWiki = path.join(umbrella.guildDir, "wiki");
    const before = { umbrella: tree(umbrella.guildDir), host: tree(host), childWiki: tree(path.join(child.guildDir, "wiki")) };

    const staged = harvest(child, "cache-strategy", { autopromote: false, body: "Children cache per request." });
    const again = harvest(child, "cache-strategy", { autopromote: false, body: "A second proposal for the same id." });
    expect(staged.promoted || again.promoted).toBe(false);
    expect(staged.candidate_path).not.toBe(again.candidate_path);

    const plan = write(path.join(child.guildDir, "plan", "lane.md"), "lane\n");
    const childD = harvest(child, "child-local");
    expect(childD.promoted).toBe(true);
    expect(pinDependent({ guildDir: child.guildDir, kind: "plan", name: "lane", path: plan, decisions: [{ id: "decision:child-local", revision: decisionRev(child, "child-local") }] }).status).toBe("pinned");
    expect(propagateDecisions({ guildDir: child.guildDir }).status).toBe("ok");

    const pub = publishDecisionCandidates({ guildDir: child.guildDir, autopromote: false, conflictRoots: [umbrella.guildDir] });
    if (pub.status !== "ok") throw new Error(pub.detail);
    expect(pub.manifest.autopromote).toBe(false);
    expect(pub.manifest.candidates).toHaveLength(2);
    for (const c of pub.manifest.candidates) {
      expect(c.state).toBe("pending_human_ingest");
      expect(c.promotion_gate).toBe("guild:wiki-ingest");
      expect(c.decision_id).toBe("decision:cache-strategy");
      expect(c.conflicts.map((x) => [x.id, x.revision])).toEqual([["decision:cache-strategy", decisionRev(umbrella, "cache-strategy")]]);
    }

    // Workspace read-through: references only, no candidate bytes copied anywhere.
    const view = federatedCandidateView([{ name: "child", guildDir: child.guildDir }]);
    expect(view[0]!.manifest!.candidates.map((c) => c.path)).toEqual(pub.manifest.candidates.map((c) => c.path));
    expect(JSON.stringify(view)).not.toContain("Children cache per request.");

    // Nothing reached the umbrella (wiki or otherwise), the child wiki gained only its own canonical page, nothing reached the host.
    expect(changed(before.umbrella, tree(umbrella.guildDir)).filter((k) => !k.startsWith("child" + path.sep))).toEqual([]);
    expect(fs.readFileSync(path.join(umbrellaWiki, "decisions", "cache-strategy.md"), "utf8")).not.toContain("Children cache");
    expect(changed(before.childWiki, tree(path.join(child.guildDir, "wiki"))).every((k) => !k.includes("cache-strategy"))).toBe(true);
    expect(tree(host)).toEqual(before.host);
    expect(Object.keys(tree(host))).toEqual([]);
    // Project memory and propagation live in the declared owner only.
    expect(fs.existsSync(path.join(decisionsHome(child.guildDir), "propagation.json"))).toBe(true);
    expect(fs.existsSync(path.join(decisionsHome(umbrella.guildDir), "pins"))).toBe(false);
  });

  it("negative controls: a cross-root pin or conflict root is refused, and a vanished candidate is reported", () => {
    const { umbrella, child } = workspace();
    const staged = harvest(child, "cache-strategy", { autopromote: false });
    // Pinning the umbrella's memory from the child is a cross-root write: refused.
    const umbrellaSummary = write(path.join(umbrella.guildDir, "memory", "summaries", "s.md"), "s\n");
    const cross = pinDependent({ guildDir: child.guildDir, kind: "summary", name: "s", path: umbrellaSummary, decisions: [{ id: "decision:cache-strategy", revision: decisionRev(umbrella, "cache-strategy") }] });
    expect(cross.status === "refused" && cross.reason).toBe("scope");
    // A conflict root that overlaps the owner is refused.
    const overlap = publishDecisionCandidates({ guildDir: child.guildDir, autopromote: false, conflictRoots: [path.join(child.guildDir, "..")] });
    expect(overlap.status === "refused" && overlap.reason).toBe("scope");

    // The candidates-only harvest itself wrote the baseline manifest.
    const baseline = JSON.parse(fs.readFileSync(path.join(child.guildDir, "knowledge", "candidates", "manifest.json"), "utf8"));
    expect(baseline.candidates.map((c: { state: string }) => c.state)).toEqual(["pending_human_ingest"]);
    // Workspace read-through reports the umbrella conflict at query time.
    const view = federatedCandidateView([{ name: "child", guildDir: child.guildDir }], { workspaceGuildDir: umbrella.guildDir });
    expect(view[0]!.manifest!.candidates[0]!.conflicts.map((c) => c.id)).toEqual(["decision:cache-strategy"]);
    fs.rmSync(staged.candidate_path!);
    const second = publishDecisionCandidates({ guildDir: child.guildDir, autopromote: false, conflictRoots: [umbrella.guildDir] });
    if (second.status !== "ok") throw new Error(second.detail);
    expect(second.missing).toHaveLength(1);
    expect(second.manifest.candidates.map((c) => c.state)).toEqual(["missing"]);
  });

  it("anti-vacuity: the tree snapshot catches a planted cross-root write", () => {
    const { umbrella, child } = workspace();
    const before = tree(umbrella.guildDir);
    const staged = harvest(child, "cache-strategy", { autopromote: false });
    // A naive promoter copying the candidate into the umbrella wiki.
    fs.copyFileSync(staged.candidate_path!, path.join(umbrella.guildDir, "wiki", "decisions", "cache-strategy-from-child.md"));
    expect(changed(before, tree(umbrella.guildDir)).filter((k) => !k.startsWith("child" + path.sep))).toEqual([path.join("wiki", "decisions", "cache-strategy-from-child.md")]);
  });
});

describe("K04 R1 regressions", () => {
  const b0 = { commit: null, tree: sha("t"), dirty_blob_manifest: sha("d"), file_inventory: sha("f"), resolver_policy: sha("r"), scan_policy: sha("s"), source_worktree_id: "lane-a" };
  const basis: BasisRef = { basis: b0, source_basis_hash: basisDigest(b0) };
  function publish(r: Root) {
    return publishGeneration({
      indexesDir: path.join(r.guildDir, "indexes"),
      identity: { source_id: "source-a", durable_owner_source_id: "source-a", publication_scope_source_id: "source-a" },
      layers: { structural_graph: { artifact: "g.json", digest: (a) => sha(a["g.json"] ?? "") } },
      channels: ["structural_graph"],
      base: readPublicationRecord(path.join(r.guildDir, "indexes"))?.pointer ?? null,
      basis,
      observe: () => basis,
      artifacts: { "g.json": "{}" },
      decisions: () => decisionPublicationRefs(r.guildDir),
    });
  }

  it("F1: a supersession after publication downgrades the published generation and blocks critical admission", () => {
    const { r } = at37Fixture();
    expect(publish(r).status).toBe("published");
    const ok = publicationStatus({ indexesDir: path.join(r.guildDir, "indexes"), observe: () => basis });
    expect(ok!.decisions.state).toBe("current");
    expect(ok!.admit_critical).toBe(true);
    harvest(r, "retry-policy-v2", { replaces: "decision:retry-policy-v1" });
    const st = publicationStatus({ indexesDir: path.join(r.guildDir, "indexes"), observe: () => basis })!;
    expect(st.decisions.state).toBe("stale");
    expect(st.decisions.live!.replan_required.map((e) => e.id)).toEqual(["plan:lane-a"]);
    expect(st.channels.find((c) => c.channel === "project_memory")!.state).toBe("stale");
    expect(st.admit_critical).toBe(false);
  });

  it("F2: a successor whose page is gone or edited is not published as authority", () => {
    const { r } = at37Fixture();
    harvest(r, "retry-policy-v2", { replaces: "decision:retry-policy-v1" });
    const d2 = path.join(r.guildDir, "wiki", "decisions", "retry-policy-v2.md");
    fs.appendFileSync(d2, "edit\n");
    expect(decisionPublicationRefs(r.guildDir)!.decision_refs).toEqual([]);
    fs.rmSync(d2);
    expect(decisionPublicationRefs(r.guildDir)!.decision_refs).toEqual([]);
    expect(decisionPublicationRefs(r.guildDir)!.replan_required.map((e) => e.id)).toEqual(["plan:lane-a"]);
  });

  it("F3: a same-id revision and a resume without `replaces` both report the replan", () => {
    const { r } = at37Fixture();
    const page = path.join(r.guildDir, "wiki", "decisions", "retry-policy-v1.md");
    const revised = harvest(r, "retry-policy-v1", { body: "Revised: consumers retry with jitter.", expect_before_hash: sha(fs.readFileSync(page)).slice(7) });
    expect(revised.promoted).toBe(true);
    expect(revised.replan_queued).toBe(true);
    expect(revised.replan_required?.map((e) => e.id)).toEqual(["plan:lane-a"]);

    const { r: r2 } = (() => { fs.rmSync(path.join(sandbox, "repo"), { recursive: true, force: true }); fs.rmSync(path.join(sandbox, "external"), { recursive: true, force: true }); return at37Fixture(); })();
    const first = harvest(r2, "retry-policy-v2", { replaces: "decision:retry-policy-v1" });
    upsertOp(RUN_ID, { ...first.op, status: "written" }, { storage: r2.storage });
    const resumed = harvest(r2, "retry-policy-v2", { op_id: first.op.op_id });
    expect(resumed.op.status).toBe("reported");
    expect(resumed.replan_queued).toBe(true);
    expect(resumed.replan_required?.map((e) => e.id)).toEqual(["plan:lane-a"]);
  });

  it("F4/R2-F3: only the candidate an acceptance names is explained; a sibling proposal stays missing", () => {
    const r = mkRoot("repo");
    harvest(r, "d1");
    const a = harvest(r, "d1", { autopromote: false, body: "Proposal A for d1." });
    const b = harvest(r, "d1", { autopromote: false, body: "Proposal B for d1." });
    const aRev = sha(fs.readFileSync(a.candidate_path!));
    const page = path.join(r.guildDir, "wiki", "decisions", "d1.md");
    // Human ingest of A only (the wiki-promote door binds the candidate).
    const promoted = harvest(r, "d1", { body: "Proposal A for d1.", expect_before_hash: sha(fs.readFileSync(page)).slice(7), from_candidate: { path: a.candidate_path!, sha256: aRev } });
    expect(promoted.promoted).toBe(true);
    fs.rmSync(a.candidate_path!);
    fs.rmSync(b.candidate_path!);
    const pub = publishDecisionCandidates({ guildDir: r.guildDir, autopromote: false });
    if (pub.status !== "ok") throw new Error(pub.detail);
    expect(pub.missing).toEqual([path.relative(r.guildDir, b.candidate_path!)]);
    // Still missing on the next publish; an unrelated acceptance of d1 does not explain it.
    harvest(r, "d1", { body: "Another d1 revision.", expect_before_hash: sha(fs.readFileSync(page)).slice(7) });
    const again = publishDecisionCandidates({ guildDir: r.guildDir, autopromote: false });
    expect(again.status === "ok" && again.missing).toHaveLength(1);
  });

  it("R2-F1: re-pinning a summary to the same decision invalidates the generation bound to the old summary", () => {
    const { r, summary, pinD1 } = at37Fixture();
    expect(publish(r).status).toBe("published");
    fs.appendFileSync(summary, "More detail.\n");
    expect(pinDependent({ guildDir: r.guildDir, kind: "summary", name: "retries", path: summary, decisions: pinD1 }).status).toBe("pinned");
    const st = publicationStatus({ indexesDir: path.join(r.guildDir, "indexes"), observe: () => basis })!;
    expect(st.decisions.state).toBe("stale");
    expect(st.admit_critical).toBe(false);
  });

  it("R2-F2: a legacy id superseded before it had an event can never become authority", () => {
    const r = mkRoot("repo");
    const legacy = write(path.join(r.guildDir, "wiki", "decisions", "legacy.md"), "---\ntype: decision\nschema_version: guild.decision.v1\nid: decision:legacy\nstatus: canonical\n---\n# legacy\n");
    const d2 = harvest(r, "modern", { replaces: "decision:legacy" });
    expect(d2.promoted).toBe(true);
    expect(readDecisionLedger(r.guildDir).tombstones.get("decision:legacy")!.id).toBe("decision:modern");
    const again = recordAcceptedDecision({ guildDir: r.guildDir, pagePath: legacy });
    expect(again.status === "refused" && again.reason).toBe("superseded");
    const plan = write(path.join(r.guildDir, "plan", "p.md"), "p\n");
    const pin = pinDependent({ guildDir: r.guildDir, kind: "plan", name: "p", path: plan, decisions: [{ id: "decision:legacy", revision: sha(fs.readFileSync(legacy)) }] });
    expect(pin.status === "refused" && pin.reason).toBe("unapproved");
  });

  it("R3-F1: a lost final event is detected as truncation, not a valid shorter chain", () => {
    const { r } = at37Fixture();
    harvest(r, "retry-policy-v2", { replaces: "decision:retry-policy-v1" });
    fs.rmSync(path.join(decisionsHome(r.guildDir), "events", "000000000002.json"));
    expect(() => readDecisionLedger(r.guildDir)).toThrow(/truncated/);
    expect(propagateDecisions({ guildDir: r.guildDir }).status).toBe("refused");
    expect(() => decisionPublicationRefs(r.guildDir)).toThrow(/truncated/);
  });

  it("R3-F2: a crash after replan_queued resumes with the replan signal intact", () => {
    const { r } = at37Fixture();
    const first = harvest(r, "retry-policy-v2", { replaces: "decision:retry-policy-v1" });
    upsertOp(RUN_ID, { ...first.op, status: "replan_queued" }, { storage: r.storage });
    const resumed = harvest(r, "retry-policy-v2", { op_id: first.op.op_id });
    expect(resumed.op.status).toBe("reported");
    expect(resumed.replan_queued).toBe(true);
    expect(resumed.replan_required?.map((e) => e.id)).toEqual(["plan:lane-a"]);
    expect(readDecisionLedger(r.guildDir).events).toHaveLength(2);
  });

  it("R3-F3: an invalid superseded id is refused before it reaches the ledger", () => {
    const r = mkRoot("repo");
    harvest(r, "d1");
    const page = write(path.join(r.guildDir, "wiki", "decisions", "d9.md"), "---\ntype: decision\nschema_version: guild.decision.v1\nid: decision:d9\nstatus: canonical\nreplaces: ../d1\n---\n# d9\n");
    const res = recordAcceptedDecision({ guildDir: r.guildDir, pagePath: page });
    expect(res.status).toBe("refused");
    expect(readDecisionLedger(r.guildDir).events).toHaveLength(1);
    expect(propagateDecisions({ guildDir: r.guildDir }).status).toBe("ok");
  });

  it("R3-F5: a restored candidate is a new occurrence an old promotion does not explain", () => {
    const r = mkRoot("repo");
    harvest(r, "d1");
    const a = harvest(r, "d1", { autopromote: false, body: "Proposal A." });
    const bytes = fs.readFileSync(a.candidate_path!);
    const page = path.join(r.guildDir, "wiki", "decisions", "d1.md");
    harvest(r, "d1", { body: "Proposal A.", expect_before_hash: sha(fs.readFileSync(page)).slice(7), from_candidate: { path: a.candidate_path!, sha256: sha(bytes) } });
    fs.rmSync(a.candidate_path!);
    const gone = publishDecisionCandidates({ guildDir: r.guildDir, autopromote: false });
    expect(gone.status === "ok" && gone.missing).toEqual([]);
    fs.writeFileSync(a.candidate_path!, bytes);
    expect(publishDecisionCandidates({ guildDir: r.guildDir, autopromote: false }).status).toBe("ok");
    fs.rmSync(a.candidate_path!);
    const again = publishDecisionCandidates({ guildDir: r.guildDir, autopromote: false });
    expect(again.status === "ok" && again.missing).toHaveLength(1);
  });
});
