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
  // NUL-separated, exactly as TREE_HASH_RECIPE states. `printf '%s\\0%s\\n'` is
  // what makes this a real reproduction rather than an approximation of it.
  const script = `
    cd "${abs}" || exit 1
    files=$(find . -type f | sed 's|^\\./||' | LC_ALL=C sort)
    if [ -z "$files" ]; then printf '' | shasum -a 256 | cut -d' ' -f1; exit 0; fi
    # while-read with IFS cleared, NOT \`for f in $files\` — word splitting would
    # break on a filename containing a space, and the production hash does not.
    printf '%s\\n' "$files" | while IFS= read -r f; do
      h=$(shasum -a 256 "$f" | cut -d' ' -f1)
      printf '%s\\0%s\\n' "$f" "$h"
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
    const realWrite = fs.writeFileSync;
    const spy = jest.spyOn(fs, "writeFileSync").mockImplementation(((p: never, d: never, o: never) => {
      realWrite(p, d, o);
      if (String(p).includes("capability/profile.json")) {
        realWrite(path.join(tmp, ".guild/agents/late.md"), "# late\n", "utf8");
      }
    }) as typeof fs.writeFileSync);

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
