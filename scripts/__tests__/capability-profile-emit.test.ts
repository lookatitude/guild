/**
 * D1 (consumer half) — capability-profile emission, and the no-mutation invariant.
 *
 * A1.5 declares the invariant, A1.6 checks it inside the validator, and **A1.7
 * proves it on the real path**. This suite owns A1.7 and A1.9, which S1's contract
 * module deliberately deferred here because both need I/O:
 *
 *   A1.7  a real full-Learn run mutates nothing  — real CLI, shell-computed hashes
 *   A1.9  absent feedstock is recorded           — real emission with inputs removed
 *
 * THE POINT OF THE SHELL CROSS-CHECK. A1.7 is only non-circular if the hashes in
 * the profile are compared against hashes computed by something OTHER than the
 * emitter. So the "expected" side here is computed with `shasum`/`find` in a
 * subshell, and the "actual" side comes out of the shipped CLI. Two independent
 * computations, one number.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  baselineBinding,
  emitCapabilityProfile,
  hashTree,
  profileRelPath,
  readCapabilityProfile,
  snapshotFeedstock,
  snapshotTreeHashes,
  type DerivedFacts,
} from "../lib/capability/profile-emit";
import { validateProjectCapabilityProfileV1 } from "../lib/core/contracts/project-capability-profile";

const CLI = path.join(__dirname, "..", "capability-profile.ts");
const RUN_ID = "run-20260801-120000-cap-profile";

let tmp: string;

function mk(rel: string, body: string): void {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

/**
 * The INDEPENDENT hash: plain shell, no project code. Reproduces
 * `TREE_HASH_RECIPE` — sorted "<relpath> <sha256>\n" lines, hashed.
 *
 * This is the whole reason A1.7 is not circular. If this function ever imports
 * from `profile-emit`, the assertion becomes "the emitter agrees with itself".
 */
function shellHashTree(root: string, relRoot: string): string {
  const abs = path.join(root, relRoot);
  if (!fs.existsSync(abs)) {
    return execFileSync("shasum", ["-a", "256"], { input: "" }).toString().split(" ")[0];
  }
  // NUL-separated, exactly as TREE_HASH_RECIPE states — including the DIRECTORY
  // and SYMLINK entries, which are what make an emptied directory or a swapped
  // root visible to the comparison.
  const script = `
    cd "${abs}" || exit 1
    entries=$(find . -mindepth 1 | sed 's|^\\./||' | LC_ALL=C sort)
    if [ -z "$entries" ]; then printf '' | shasum -a 256 | cut -d' ' -f1; exit 0; fi
    # while-read with IFS cleared, NOT \`for f in $entries\` — word splitting would
    # break on a filename containing a space, and the production hash does not.
    printf '%s\\n' "$entries" | while IFS= read -r f; do
      if [ -L "$f" ]; then printf '%s\\0symlink\\n' "$f"
      elif [ -d "$f" ]; then printf '%s\\0dir\\n' "$f"
      elif [ -f "$f" ]; then printf '%s\\0%s\\n' "$f" "$(shasum -a 256 "$f" | cut -d' ' -f1)"
      else printf '%s\\0symlink\\n' "$f"
      fi
    done | shasum -a 256 | cut -d' ' -f1
  `;
  return execFileSync("bash", ["-c", script]).toString().trim();
}

const EMPTY_FACTS: DerivedFacts = {
  domains: [],
  boundaries: [],
  repeated_methods: [],
  coverage: { covered: [], uncovered: [], unmatched_roles: [] },
  candidates: [],
};

/** A baseline BOUND to this tmp project and this run — what the emitter accepts. */
function boundBaseline(runId: string = RUN_ID) {
  return {
    ...snapshotTreeHashes(tmp)!,
    bound_root: baselineBinding(tmp)!,
    bound_run_id: runId,
  };
}

function emit(over: Partial<Parameters<typeof emitCapabilityProfile>[0]> = {}) {
  return emitCapabilityProfile({
    projectRoot: tmp,
    runId: RUN_ID,
    projectId: "fx-empty",
    generatedAt: "2026-08-01T12:00:00Z",
    sourceCommit: null,
    resolverMode: "observe",
    suggestionBudget: 4,
    facts: EMPTY_FACTS,
    ...over,
  });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cap-profile-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("tree hashing — the evidence, not an implementation detail", () => {
  it("matches a SHELL-computed hash over the same tree (the A1.7 cross-check)", () => {
    mk(".guild/agents/backend.md", "# backend\n");
    mk(".guild/agents/qa.md", "# qa\n");
    mk(".guild/skills/foo/SKILL.md", "# foo\n");
    expect(hashTree(tmp, ".guild/agents")).toBe(shellHashTree(tmp, ".guild/agents"));
    expect(hashTree(tmp, ".guild/skills")).toBe(shellHashTree(tmp, ".guild/skills"));
  });

  it("an absent tree hashes stably (and equals an empty one)", () => {
    const absent = hashTree(tmp, ".guild/agents");
    fs.mkdirSync(path.join(tmp, ".guild/agents"), { recursive: true });
    expect(hashTree(tmp, ".guild/agents")).toBe(absent);
  });

  it("ANTI-VACUITY: the hash MOVES when a byte moves", () => {
    // A hash that never changes would satisfy every before/after comparison in
    // this file while proving nothing at all.
    mk(".guild/agents/backend.md", "# backend\n");
    const a = hashTree(tmp, ".guild/agents");
    mk(".guild/agents/backend.md", "# backend!\n");
    expect(hashTree(tmp, ".guild/agents")).not.toBe(a);
    mk(".guild/agents/extra.md", "# extra\n");
    expect(hashTree(tmp, ".guild/agents")).not.toBe(a);
  });

  it("same bytes at a different path hash differently — the path is part of the tree", () => {
    // The separator's job is to keep the path and the hash from bleeding into each
    // other. NUL is chosen because it CANNOT occur in a path, so no path can forge
    // a record boundary; a space or slash separator has no such guarantee. That
    // property is not directly constructible as a test (you would need a filename
    // containing the separator AND 64 hex chars), so what is asserted here is the
    // consequence: identical content at a different location is a different tree.
    const one = fs.mkdtempSync(path.join(os.tmpdir(), "h1-"));
    const two = fs.mkdtempSync(path.join(os.tmpdir(), "h2-"));
    fs.mkdirSync(path.join(one, ".guild/agents/a"), { recursive: true });
    fs.writeFileSync(path.join(one, ".guild/agents/a/b.md"), "x");
    fs.mkdirSync(path.join(two, ".guild/agents"), { recursive: true });
    fs.writeFileSync(path.join(two, ".guild/agents/a-b.md"), "x");
    expect(hashTree(one, ".guild/agents")).not.toBe(hashTree(two, ".guild/agents"));
    fs.rmSync(one, { recursive: true, force: true });
    fs.rmSync(two, { recursive: true, force: true });
  });

  it("a filename containing a space still hashes reproducibly against the shell", () => {
    // The case a space separator would make ambiguous. It must round-trip.
    mk(".guild/agents/my role.md", "# spaced\n");
    expect(hashTree(tmp, ".guild/agents")).toBe(shellHashTree(tmp, ".guild/agents"));
  });
});

describe("A1.7 — a real emission mutates nothing", () => {
  it("emits a VALID profile whose before/after hashes equal the SHELL-computed ones", () => {
    mk(".guild/agents/backend.md", "# backend\n");
    mk(".guild/skills/foo/SKILL.md", "# foo\n");

    const shellBefore = {
      agents: shellHashTree(tmp, ".guild/agents"),
      skills: shellHashTree(tmp, ".guild/skills"),
    };

    const r = emit();
    expect(r.status).toBe("emitted");
    if (r.status !== "emitted") return;

    // The invariant, three ways: the field, the validator, and the shell.
    expect(r.profile.mutation_performed).toBe(false);
    expect(validateProjectCapabilityProfileV1(r.profile, { suggestionBudget: 4 })).not.toBeNull();
    expect(r.profile.mutation_evidence.agents_tree_hash_before).toBe(shellBefore.agents);
    expect(r.profile.mutation_evidence.agents_tree_hash_after).toBe(shellBefore.agents);
    expect(r.profile.mutation_evidence.skills_tree_hash_before).toBe(shellBefore.skills);

    // And the trees are byte-identical AFTER the run.
    expect(shellHashTree(tmp, ".guild/agents")).toBe(shellBefore.agents);
    expect(shellHashTree(tmp, ".guild/skills")).toBe(shellBefore.skills);
  });

  it("writes ONLY into .guild/runs/<run-id>/capability/", () => {
    mk(".guild/agents/backend.md", "# backend\n");
    const r = emit();
    expect(r.status).toBe("emitted");
    if (r.status !== "emitted") return;
    expect(r.rel_path).toBe(profileRelPath(RUN_ID));
    expect(fs.existsSync(path.join(tmp, r.rel_path))).toBe(true);
    // Nothing new appeared in the roster.
    expect(fs.readdirSync(path.join(tmp, ".guild/agents"))).toEqual(["backend.md"]);
  });

  it("the emitted file re-reads and re-validates", () => {
    const r = emit();
    expect(r.status).toBe("emitted");
    const round = readCapabilityProfile(tmp, RUN_ID, { suggestionBudget: 4 });
    expect(round).not.toBeNull();
    expect(round?.run_id).toBe(RUN_ID);
    expect(round?.mutation_performed).toBe(false);
  });

  it("✗-PROOF: a writer planted in the emission path makes the check FAIL", () => {
    // The load-bearing negative. B1: "plant a writer in the Learn path ⇒ B1 must
    // go red. If it doesn't, the tree-hash comparison isn't wired to the real run."
    //
    // The writer is planted where a real one would be — mutating the roster while
    // the emission is in flight — by hooking the read the emitter makes between
    // its two snapshots.
    mk(".guild/agents/backend.md", "# backend\n");
    const realReadFileSync = fs.readFileSync;
    let planted = false;
    const spy = jest.spyOn(fs, "readFileSync").mockImplementation(((p: never, o: never) => {
      if (!planted && String(p).includes("codebase-map.json")) {
        planted = true;
        fs.writeFileSync(path.join(tmp, ".guild/agents/smuggled.md"), "# smuggled\n");
      }
      return realReadFileSync(p, o);
    }) as typeof fs.readFileSync);

    try {
      const r = emit();
      expect(r.status).toBe("refused");
      if (r.status === "refused") expect(r.code).toBe("mutation_detected");
      // And no profile was left behind asserting a clean run.
      expect(fs.existsSync(path.join(tmp, profileRelPath(RUN_ID)))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("✗-PROOF: a POST-WRITE mutation removes the profile rather than blessing it", () => {
    // Steps 1-4 prove the derivation was clean; only the post-write re-hash proves
    // the EMISSION was. Without step 7 this case emits a profile that lies.
    mk(".guild/agents/backend.md", "# backend\n");
    // Hooked on `renameSync`, which is the moment the profile LANDS — the write
    // is atomic (temp + rename), so that is the real path a planted writer would
    // have to sit on.
    const realRename = fs.renameSync;
    const spy = jest.spyOn(fs, "renameSync").mockImplementation(((a: never, b: never) => {
      realRename(a, b);
      if (String(b).includes("capability/profile.json")) {
        fs.writeFileSync(path.join(tmp, ".guild/agents/late.md"), "# late\n", "utf8");
      }
    }) as typeof fs.renameSync);

    try {
      const r = emit();
      expect(r.status).toBe("refused");
      if (r.status === "refused") expect(r.code).toBe("post_write_mutation");
      expect(fs.existsSync(path.join(tmp, profileRelPath(RUN_ID)))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("baselineHashes — widening the window to the WHOLE Learn run", () => {
  it("a run-start baseline becomes the `before` half", () => {
    mk(".guild/agents/backend.md", "# backend\n");
    const baseline = boundBaseline();
    const r = emit({ baselineHashes: baseline });
    expect(r.status).toBe("emitted");
    if (r.status !== "emitted") return;
    expect(r.profile.mutation_evidence.agents_tree_hash_before).toBe(baseline.agents);
  });

  it("THE POINT: a mutation EARLIER IN THE RUN is caught, which the narrow window misses", () => {
    // This is the case the caveat in the header is about. Learn writes to the
    // roster at stage 4; the emitter runs at stage 12b. With no baseline, both
    // snapshots are taken after the write and agree — a clean-looking profile for
    // a run that mutated. With the run-start baseline, they disagree.
    mk(".guild/agents/backend.md", "# backend\n");
    const runStart = boundBaseline();

    mk(".guild/agents/written-mid-run.md", "# smuggled\n"); // an earlier Learn stage

    // Narrow window: emission-only. It reports a clean run — honestly, for the
    // window it can see, and misleadingly for the run as a whole.
    expect(emit().status).toBe("emitted");

    // Wide window: the same run, correctly refused.
    fs.rmSync(path.join(tmp, ".guild/runs"), { recursive: true, force: true });
    const wide = emit({ baselineHashes: runStart });
    expect(wide.status).toBe("refused");
    if (wide.status === "refused") expect(wide.code).toBe("mutation_detected");
    expect(fs.existsSync(path.join(tmp, profileRelPath(RUN_ID)))).toBe(false);
  });

  it("OPTIONS-FIRST: a hostile baseline is REJECTED and its getter NEVER fires", () => {
    // Rule 4. The baseline is the `before` half of the comparison, so a getter
    // that returned one value here and another on a second read would let a
    // mutated run produce a matching pair.
    let fired = 0;
    const hostile = Object.defineProperty(
      {
        skills: "a".repeat(64),
        registries: "b".repeat(64),
        bound_root: "c".repeat(64),
        bound_run_id: RUN_ID,
      },
      "agents",
      {
        enumerable: true,
        get() {
          fired += 1;
          return "c".repeat(64);
        },
      }
    );
    const r = emit({ baselineHashes: hostile as never });
    expect(r.status).toBe("refused");
    if (r.status === "refused") expect(r.code).toBe("invalid_baseline");
    expect(fired).toBe(0);
  });

  it("rejects Proxy, symbol keys, unknown keys, and non-hex values", () => {
    const good = {
      agents: "a".repeat(64),
      skills: "b".repeat(64),
      registries: "c".repeat(64),
      bound_root: "d".repeat(64),
      bound_run_id: RUN_ID,
    };
    const cases: unknown[] = [
      new Proxy(good, {}),
      Object.assign({ [Symbol("x")]: 1 }, good),
      { ...good, bogus: 1 },
      { agents: good.agents, skills: good.skills }, // missing keys
      { ...good, agents: "not-a-hash" },
      { ...good, agents: "A".repeat(64) }, // uppercase — one spelling only
      Object.assign(Object.create({ inherited: 1 }), good),
      null,
      [],
      "x",
    ];
    for (const bad of cases) {
      const r = emit({ baselineHashes: bad as never });
      expect(r.status).toBe("refused");
      if (r.status === "refused") expect(r.code).toBe("invalid_baseline");
    }
  });

  it("a malformed baseline REFUSES — it never falls back to the narrow window", () => {
    // Falling back would silently downgrade the claim the profile makes, which is
    // the accept-and-repair pattern this codebase forbids everywhere else.
    mk(".guild/agents/backend.md", "# backend\n");
    expect(emit({ baselineHashes: { agents: "x" } as never }).status).toBe("refused");
    expect(fs.existsSync(path.join(tmp, profileRelPath(RUN_ID)))).toBe(false);
  });
});

describe("A1.9 — absent feedstock is RECORDED, never silently omitted", () => {
  it("names every missing input", () => {
    const r = emit();
    expect(r.status).toBe("emitted");
    if (r.status !== "emitted") return;
    expect(r.profile.feedstock.absent.sort()).toEqual([
      "codebase_map",
      "knowledge_graph",
      "roster",
    ]);
    expect(r.profile.feedstock.knowledge_graph_hash).toBeNull();
  });

  it("a present input is hashed and NOT listed absent", () => {
    mk(".guild/indexes/codebase-map.json", '{"files":[]}\n');
    const snap = snapshotFeedstock(tmp);
    expect(snap.absent).not.toContain("codebase_map");
    expect(snap.codebase_map_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.absent).toContain("knowledge_graph");
  });

  it("✗-PROOF: deleting the graph makes it APPEAR in `absent`", () => {
    mk(".guild/indexes/knowledge-graph.json", '{"nodes":[]}\n');
    expect(snapshotFeedstock(tmp).absent).not.toContain("knowledge_graph");
    fs.rmSync(path.join(tmp, ".guild/indexes/knowledge-graph.json"));
    expect(snapshotFeedstock(tmp).absent).toContain("knowledge_graph");
  });
});

describe("mode gating — report-only, behind `observe`", () => {
  it("`legacy` emits NOTHING", () => {
    const r = emit({ resolverMode: "legacy" });
    expect(r.status).toBe("refused");
    if (r.status === "refused") expect(r.code).toBe("resolver_mode_disabled");
    expect(fs.existsSync(path.join(tmp, profileRelPath(RUN_ID)))).toBe(false);
  });

  it("every mode at or past `observe` emits", () => {
    for (const mode of ["observe", "shadow", "project-local", "strict"] as const) {
      fs.rmSync(path.join(tmp, ".guild"), { recursive: true, force: true });
      expect(emit({ resolverMode: mode }).status).toBe("emitted");
    }
  });
});

describe("refusals — every failure is typed, nothing is repaired", () => {
  it("rejects an unsafe run id rather than sanitizing it", () => {
    for (const bad of ["../escape", "run/../x", "RUN-UPPER", "", "a\nb"]) {
      const r = emit({ runId: bad });
      expect(r.status).toBe("refused");
      if (r.status === "refused") expect(r.code).toBe("invalid_run_id");
    }
  });

  it("A1.1 — an over-budget candidate set is REJECTED, not truncated", () => {
    const candidates = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      kind: "agent" as const,
      proposed_id: `role-${i}`,
      justified_by: ["d1"],
      action: "observe" as const,
      defer_reason: "insufficient evidence",
      confidence: "medium" as const,
      owning_layer: "project",
    }));
    const r = emit({
      facts: {
        ...EMPTY_FACTS,
        domains: [
          {
            id: "d1",
            label: "one",
            evidence_refs: ["codebase_map:src/a.ts"],
            confidence: "medium",
          },
        ],
        candidates,
      },
    });
    expect(r.status).toBe("refused");
    if (r.status === "refused") expect(r.code).toBe("profile_invalid");
    // Nothing on disk — an invalid profile is never written.
    expect(fs.existsSync(path.join(tmp, profileRelPath(RUN_ID)))).toBe(false);
  });

  it("NEVER throws, whatever the facts are", () => {
    for (const facts of [undefined, null, 0, "x", [], { domains: 1 }] as never[]) {
      expect(() => emit({ facts })).not.toThrow();
      expect(emit({ facts }).status).toBe("refused");
    }
  });
});

describe("the CLI is the REAL path (conformance rule 3)", () => {
  jest.setTimeout(120_000);

  const run = (args: string[]) =>
    execFileSync("npx", ["tsx", CLI, ...args], { encoding: "utf8", cwd: path.join(__dirname, "..") });

  it("`hash-tree --json` agrees with both the library AND the shell", () => {
    mk(".guild/agents/backend.md", "# backend\n");
    const out = JSON.parse(run(["hash-tree", "--cwd", tmp, "--json"]));
    expect(out.agents).toBe(snapshotTreeHashes(tmp).agents);
    expect(out.agents).toBe(shellHashTree(tmp, ".guild/agents"));
  });

  it("finding 6 — `--baseline` with NO VALUE is a hard error, never a silent downgrade", () => {
    // `emit ... --baseline --resolver-mode observe` previously read as "no
    // baseline", emitted with the NARROW window, and reported success — exactly
    // the silent downgrade the baseline documentation says must be a refusal.
    mk(".guild/agents/backend.md", "# backend\n");
    let threw = false;
    try {
      run([
        "emit", "--cwd", tmp, "--run-id", RUN_ID, "--project-id", "fx",
        "--generated-at", "2026-08-01T12:00:00Z",
        "--baseline", "--resolver-mode", "observe",
      ]);
    } catch (e) {
      threw = true;
      expect(String((e as { stderr?: Buffer }).stderr ?? e)).toMatch(/missing_value/);
    }
    expect(threw).toBe(true);
    expect(fs.existsSync(path.join(tmp, profileRelPath(RUN_ID)))).toBe(false);
  });

  it("`emit` writes a profile whose hashes match the shell, through the shipped CLI", () => {
    mk(".guild/agents/backend.md", "# backend\n");
    const shellBefore = shellHashTree(tmp, ".guild/agents");
    const out = JSON.parse(
      run([
        "emit",
        "--cwd",
        tmp,
        "--run-id",
        RUN_ID,
        "--project-id",
        "fx-empty",
        "--generated-at",
        "2026-08-01T12:00:00Z",
      ])
    );
    expect(out.status).toBe("emitted");
    expect(out.mutation_performed).toBe(false);
    expect(out.hashes.agents).toBe(shellBefore);
    // The tree is untouched after a REAL CLI invocation — the A1.7 shape.
    expect(shellHashTree(tmp, ".guild/agents")).toBe(shellBefore);
    const onDisk = readCapabilityProfile(tmp, RUN_ID);
    expect(onDisk?.mutation_evidence.agents_tree_hash_after).toBe(shellBefore);
  });
});

describe("CODEX ROUND 2 — regressions for the reported counterexamples", () => {
  it("finding 1 — a SYMLINKED write directory is REFUSED, and nothing lands outside", () => {
    // The reproduction: make `.guild/runs/<id>/capability` a symlink to /tmp/out.
    // The lexical classifier said allowed, the emitter said emitted, and the file
    // was written outside the project root. The bounded-write guarantee was false.
    mk(".guild/agents/backend.md", "# backend\n");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "escape-"));
    fs.mkdirSync(path.join(tmp, ".guild/runs", RUN_ID), { recursive: true });
    fs.symlinkSync(outside, path.join(tmp, ".guild/runs", RUN_ID, "capability"));

    const r = emit();
    expect(r.status).toBe("refused");
    if (r.status === "refused") expect(r.code).toBe("escapes_project_root");
    expect(fs.readdirSync(outside)).toEqual([]); // nothing landed outside
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("finding 1 — a Win32 trailing-dot/space traversal segment is refused", () => {
    // `".. "` reaches a Win32 filesystem AS `..`, so exact-matching `..` was not
    // enough. Checked here through the emitter's own classifier call path.
    const { classifyContextManagerWrite } = require("../lib/capability/context-manager-contract");
    for (const p of [
      ".guild/context/.. /agents/pwn.md",
      ".guild/context/.../agents/pwn.md",
      ".guild/context/. /x.md",
      ".guild/context/   /x.md",
    ]) {
      expect(classifyContextManagerWrite(p).allowed).toBe(false);
    }
  });

  it("finding 2 — a hostile options GETTER never fires and the emission is REFUSED", () => {
    // The reproduction: a `facts` getter that created `.guild/agents/transient.md`
    // on its first read and removed it on its second fired FIVE times, and emission
    // still returned `emitted` because the endpoints matched.
    mk(".guild/agents/backend.md", "# backend\n");
    let fired = 0;
    const hostile: Record<string, unknown> = {
      projectRoot: tmp,
      runId: RUN_ID,
      projectId: "fx",
      generatedAt: "2026-08-01T12:00:00Z",
      sourceCommit: null,
      resolverMode: "observe",
      suggestionBudget: 4,
      baselineHashes: undefined,
    };
    Object.defineProperty(hostile, "facts", {
      enumerable: true,
      get() {
        fired += 1;
        fs.writeFileSync(path.join(tmp, ".guild/agents/transient.md"), "# transient\n");
        return EMPTY_FACTS;
      },
    });

    const r = emitCapabilityProfile(hostile as never);
    expect(fired).toBe(0);
    expect(r.status).toBe("refused");
    if (r.status === "refused") expect(r.code).toBe("invalid_options");
    expect(fs.existsSync(path.join(tmp, ".guild/agents/transient.md"))).toBe(false);
  });

  it("finding 2 — Proxy, symbol keys, unknown keys and bad prototypes are refused", () => {
    const good = {
      projectRoot: tmp,
      runId: RUN_ID,
      projectId: "fx",
      generatedAt: "2026-08-01T12:00:00Z",
      sourceCommit: null,
      resolverMode: "observe",
      suggestionBudget: 4,
      facts: EMPTY_FACTS,
    };
    for (const bad of [
      new Proxy(good, {}),
      Object.assign({ [Symbol("x")]: 1 }, good),
      { ...good, bogus: 1 },
      Object.assign(Object.create({ inherited: 1 }), good),
    ]) {
      const r = emitCapabilityProfile(bad as never);
      expect(r.status).toBe("refused");
      if (r.status === "refused") expect(r.code).toBe("invalid_options");
    }
  });

  it("finding 3 — the RESULT records which window was compared", () => {
    // S1's shape is frozen so the FILE cannot carry this, but a caller must not be
    // left assuming the wider claim. The result says which one it just made.
    mk(".guild/agents/backend.md", "# backend\n");
    const narrow = emit();
    expect(narrow.status).toBe("emitted");
    if (narrow.status === "emitted") expect(narrow.window).toBe("emission");

    fs.rmSync(path.join(tmp, ".guild/runs"), { recursive: true, force: true });
    const wide = emit({ baselineHashes: boundBaseline() });
    expect(wide.status).toBe("emitted");
    if (wide.status === "emitted") expect(wide.window).toBe("run");
  });

  it("finding 4 — deleting an EMPTY directory moves the hash", () => {
    fs.mkdirSync(path.join(tmp, ".guild/agents/empty-sub"), { recursive: true });
    const withDir = hashTree(tmp, ".guild/agents");
    fs.rmdirSync(path.join(tmp, ".guild/agents/empty-sub"));
    expect(hashTree(tmp, ".guild/agents")).not.toBe(withDir);
  });

  it("finding 4 — swapping the ROOT for a symlink to an identical tree is REFUSED", () => {
    // The old walk produced byte-identical output for this, so the swap was
    // invisible to the comparison it exists to feed.
    mk(".guild/agents/backend.md", "# backend\n");
    const twin = fs.mkdtempSync(path.join(os.tmpdir(), "twin-"));
    fs.writeFileSync(path.join(twin, "backend.md"), "# backend\n");
    fs.rmSync(path.join(tmp, ".guild/agents"), { recursive: true, force: true });
    fs.symlinkSync(twin, path.join(tmp, ".guild/agents"));
    expect(hashTree(tmp, ".guild/agents")).toBeNull();
    expect(snapshotTreeHashes(tmp)).toBeNull();
    const r = emit();
    expect(r.status).toBe("refused");
    if (r.status === "refused") expect(r.code).toBe("hash_incomplete");
    fs.rmSync(twin, { recursive: true, force: true });
  });

  it("finding 4 — an UNREADABLE file REFUSES rather than being skipped (rule 6)", () => {
    mk(".guild/agents/backend.md", "# backend\n");
    const secret = path.join(tmp, ".guild/agents/secret.md");
    fs.writeFileSync(secret, "# secret\n");
    fs.chmodSync(secret, 0o000);
    try {
      // Root can read anything, so skip rather than assert a false negative.
      let readable = true;
      try {
        fs.readFileSync(secret);
      } catch {
        readable = false;
      }
      if (!readable) {
        expect(hashTree(tmp, ".guild/agents")).toBeNull();
        const r = emit();
        expect(r.status).toBe("refused");
        if (r.status === "refused") expect(r.code).toBe("hash_incomplete");
      }
    } finally {
      fs.chmodSync(secret, 0o644);
    }
  });

  it("finding 12 — a post-write refusal RESTORES the previous profile, never destroys it", () => {
    mk(".guild/agents/backend.md", "# backend\n");
    expect(emit().status).toBe("emitted");
    const abs = path.join(tmp, profileRelPath(RUN_ID));
    const original = fs.readFileSync(abs, "utf8");

    const realRename = fs.renameSync;
    const spy = jest.spyOn(fs, "renameSync").mockImplementation(((a: never, b: never) => {
      realRename(a, b);
      if (String(b).includes("capability/profile.json")) {
        fs.writeFileSync(path.join(tmp, ".guild/agents/late.md"), "# late\n", "utf8");
      }
    }) as typeof fs.renameSync);
    try {
      const r = emit();
      expect(r.status).toBe("refused");
      if (r.status === "refused") expect(r.code).toBe("post_write_mutation");
    } finally {
      spy.mockRestore();
    }
    // The profile that was valid a moment ago is still there, byte-identical.
    expect(fs.readFileSync(abs, "utf8")).toBe(original);
  });

  it("finding L — `generated_at` is RFC3339-SHAPED, not merely non-empty", () => {
    for (const bad of ["not-rfc3339", "yesterday", "2026-08-01", "", "2026-08-01T12:00:00"]) {
      const r = emit({ generatedAt: bad });
      expect(r.status).toBe("refused");
      if (r.status === "refused") expect(r.code).toBe("invalid_generated_at");
    }
    for (const good of ["2026-08-01T12:00:00Z", "2026-08-01T12:00:00.123Z", "2026-08-01T12:00:00+02:00"]) {
      fs.rmSync(path.join(tmp, ".guild/runs"), { recursive: true, force: true });
      expect(emit({ generatedAt: good }).status).toBe("emitted");
    }
  });
});


describe("the mutation window reaches the ARTIFACT, not just the result", () => {
  it("no baseline ⇒ the file itself says \"emission\"", () => {
    mk(".guild/agents/backend.md", "# backend\n");
    const r = emit();
    expect(r.status).toBe("emitted");
    if (r.status !== "emitted") return;
    expect(r.window).toBe("emission");
    expect(r.profile.mutation_window).toBe("emission");
    // And on disk, which is the half that matters: a reader of the FILE alone can
    // now tell the narrow claim from the wide one.
    expect(readCapabilityProfile(tmp, RUN_ID)!.mutation_window).toBe("emission");
  });

  it("a run-start baseline ⇒ the file itself says \"run\"", () => {
    mk(".guild/agents/backend.md", "# backend\n");
    const r = emit({ baselineHashes: boundBaseline() });
    expect(r.status).toBe("emitted");
    if (r.status !== "emitted") return;
    expect(r.profile.mutation_window).toBe("run");
    expect(readCapabilityProfile(tmp, RUN_ID)!.mutation_window).toBe("run");
  });
});

describe("CROSS-LANE CLASS — lexical path checks need a realpath half", () => {
  /**
   * Confirmed twice independently in parallel lanes: this emitter wrote outside
   * the project root through a symlinked directory, and a sibling lane rated the
   * same root cause CRITICAL when a symlinked TARGET and then a symlinked PARENT
   * let a write escape while the operation reported success. One root cause: a
   * LEXICAL path check with no realpath. Systemic, not incidental.
   */
  it("a symlinked LEAF directory is refused (the reported variant)", () => {
    mk(".guild/agents/backend.md", "# backend\n");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "escape-leaf-"));
    fs.mkdirSync(path.join(tmp, ".guild/runs", RUN_ID), { recursive: true });
    fs.symlinkSync(outside, path.join(tmp, ".guild/runs", RUN_ID, "capability"));
    const r = emit();
    expect(r.status).toBe("refused");
    if (r.status === "refused") expect(r.code).toBe("escapes_project_root");
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("a symlinked ANCESTOR is refused BEFORE mkdir creates anything through it", () => {
    // The variant the sibling lane found. A single post-mkdir check would refuse
    // the WRITE but only after `mkdirSync(..., {recursive:true})` had already
    // created directories through the symlink — a refusal with a side effect
    // outside its own bounds.
    mk(".guild/agents/backend.md", "# backend\n");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "escape-parent-"));
    fs.mkdirSync(path.join(tmp, ".guild/runs"), { recursive: true });
    fs.symlinkSync(outside, path.join(tmp, ".guild/runs", RUN_ID));

    const r = emit();
    expect(r.status).toBe("refused");
    if (r.status === "refused") expect(r.code).toBe("escapes_project_root");
    // NOTHING was created through the symlink — not even an empty directory.
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("ANTI-VACUITY: an ordinary (non-symlinked) destination still emits", () => {
    // A containment check that refused everything would pass both rows above.
    mk(".guild/agents/backend.md", "# backend\n");
    expect(emit().status).toBe("emitted");
  });
});


describe("CODEX ROUND 4 — regressions for the reported counterexamples", () => {
  it("finding C — a DANGLING symlink at the leaf no longer escapes", () => {
    // existsSync FOLLOWS symlinks, so a dangling one read as "does not exist" and
    // the climb validated its in-root parent instead. Reproduced: the file was
    // created OUTSIDE the project root and the emitter reported success.
    mk(".guild/agents/backend.md", "# backend\n");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "dangle-"));
    const target = path.join(outside, "escaped.json");
    fs.mkdirSync(path.join(tmp, ".guild/runs", RUN_ID, "capability"), { recursive: true });
    fs.symlinkSync(target, path.join(tmp, profileRelPath(RUN_ID)));
    expect(fs.existsSync(target)).toBe(false); // dangling

    const r = emit();
    expect(r.status).toBe("refused");
    if (r.status === "refused") expect(r.code).toBe("escapes_project_root");
    expect(fs.existsSync(target)).toBe(false); // nothing created outside
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("finding A — a baseline from ANOTHER PROJECT is refused", () => {
    // Reproduced: hashes from project A emitted `mutation_window: "run"` for
    // project B. Bare hashes carry no provenance; the binding supplies it.
    mk(".guild/agents/backend.md", "# backend\n");
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "otherproj-"));
    fs.mkdirSync(path.join(other, ".guild/agents"), { recursive: true });
    fs.writeFileSync(path.join(other, ".guild/agents/backend.md"), "# backend\n");

    const foreign = {
      ...snapshotTreeHashes(other)!,
      bound_root: baselineBinding(other)!,
      bound_run_id: RUN_ID,
    };
    const r = emit({ baselineHashes: foreign });
    expect(r.status).toBe("refused");
    if (r.status === "refused") expect(r.code).toBe("invalid_baseline");
    fs.rmSync(other, { recursive: true, force: true });
  });

  it("finding A — a baseline captured for ANOTHER RUN is refused", () => {
    mk(".guild/agents/backend.md", "# backend\n");
    const r = emit({ baselineHashes: boundBaseline("run-20260101-000000-other") });
    expect(r.status).toBe("refused");
    if (r.status === "refused") expect(r.code).toBe("invalid_baseline");
  });

  it("finding A — an UNBOUND baseline is refused, not silently trusted", () => {
    // The old shape. It must not be readable as a run-start capture any more.
    mk(".guild/agents/backend.md", "# backend\n");
    const r = emit({ baselineHashes: snapshotTreeHashes(tmp) as never });
    expect(r.status).toBe("refused");
    if (r.status === "refused") expect(r.code).toBe("invalid_baseline");
  });

  it("ANTI-VACUITY: a correctly bound baseline still yields window \"run\"", () => {
    mk(".guild/agents/backend.md", "# backend\n");
    const r = emit({ baselineHashes: boundBaseline() });
    expect(r.status).toBe("emitted");
    if (r.status === "emitted") expect(r.profile.mutation_window).toBe("run");
  });

  it("finding E — a failed write cannot destroy the previous profile", () => {
    // writeFileSync truncates before writing, so a failure part-way left the old
    // profile empty. The replacement is atomic (temp + rename): either the old
    // bytes or the new, never a torn file.
    mk(".guild/agents/backend.md", "# backend\n");
    expect(emit().status).toBe("emitted");
    const abs = path.join(tmp, profileRelPath(RUN_ID));
    const original = fs.readFileSync(abs, "utf8");

    const spy = jest.spyOn(fs, "writeSync").mockImplementation(() => {
      throw new Error("ENOSPC");
    });
    try {
      const r = emit();
      expect(r.status).toBe("refused");
      if (r.status === "refused") expect(r.code).toBe("write_failed");
    } finally {
      spy.mockRestore();
    }
    // Untouched, not truncated.
    expect(fs.readFileSync(abs, "utf8")).toBe(original);
  });

  it("finding G — a FIFO at the destination does not block the backup read", () => {
    // readFileSync on a FIFO with no writer blocks forever. The backup read is
    // now type- and size-checked first.
    mk(".guild/agents/backend.md", "# backend\n");
    fs.mkdirSync(path.join(tmp, ".guild/runs", RUN_ID, "capability"), { recursive: true });
    const abs = path.join(tmp, profileRelPath(RUN_ID));
    try {
      require("child_process").execFileSync("mkfifo", [abs]);
    } catch {
      return; // mkfifo unavailable — skip rather than assert a false pass
    }
    // Must return promptly, not hang. Jest would time out if the read blocked.
    const r = emit();
    expect(r.status === "emitted" || r.status === "refused").toBe(true);
  });

  it("finding E — a rollback onto an ESCAPING path is refused, not performed", () => {
    // The cleanup path was doing exactly what the write path was hardened
    // against: rmSync/writeFileSync with no fresh containment check.
    mk(".guild/agents/backend.md", "# backend\n");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-"));
    const victim = path.join(outside, "victim.txt");
    fs.writeFileSync(victim, "precious");

    // Land a valid profile first, then redirect the leaf and force a rollback.
    expect(emit().status).toBe("emitted");
    const abs = path.join(tmp, profileRelPath(RUN_ID));
    fs.rmSync(abs);
    fs.symlinkSync(victim, abs);

    const r = emit();
    expect(r.status).toBe("refused");
    expect(fs.readFileSync(victim, "utf8")).toBe("precious"); // untouched
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
