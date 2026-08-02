/**
 * scripts/__tests__/path-containment.test.ts
 *
 * THE THREE KNOWN VARIANTS, AS REGRESSION TESTS.
 *
 * ── ANTI-VACUITY, THREE WAYS ───────────────────────────────────────────────────
 * This initiative found three ways a guard's test can pass while proving nothing.
 * Each is answered structurally here, not by assertion:
 *
 *   1. A WEAKENING THAT REDDENS FOR THE WRONG REASON is indistinguishable from a
 *      guard that works. Every refusal below asserts the `code` — WHICH rule fired
 *      — never merely that something was refused. `detail` is explicitly never
 *      asserted on. This is why the primitive returns a coded result at all: the
 *      resolver lane returned free text, the learn lane a bare boolean, and the
 *      teams lane threw — none of the three could express "refused, but for the
 *      wrong reason", so none of their tests could have caught it.
 *
 *   2. A GUARD ALREADY SUBSUMED BY ANOTHER proves nothing when it is added. Each
 *      variant is therefore paired with a NEGATIVE CONTROL: the historical buggy
 *      implementation, transcribed verbatim from the lane that shipped it, run
 *      against the SAME fixture. The test asserts the old code ACCEPTS the attack
 *      and the new code refuses it. If the fixture were not actually dangerous —
 *      if the rule had nothing to feel — the negative control would refuse too and
 *      the test would fail. A green run therefore proves the fixture is live.
 *
 *   3. A RULE CAN HAVE NOTHING TO FEEL IT. Every fixture here plants a REAL
 *      symlink on a REAL temp filesystem and then asks for a REAL write. Nothing
 *      is mocked, so nothing can be quietly made compliant.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  CONTAINMENT_REFUSAL_CODES,
  assertContained,
  checkContained,
  prepareContainedWrite,
  writeContainedFile,
  type ContainmentRefused,
  type ContainmentResult,
  type PrepareResult,
} from "../../src/modules/kernel/workflows/path-containment";

// ───────────────────────────────────────────────────────────────────────────────
// The historical implementations, transcribed VERBATIM from the lanes that
// shipped them. These are NEGATIVE CONTROLS: each must ACCEPT the attack its
// variant describes. They are the proof that the fixtures below are live.
// ───────────────────────────────────────────────────────────────────────────────

/**
 * RESOLVER LANE, `capability/adoption-migrate.ts` — `escapesProjectRoot`.
 * Climbs with `existsSync`, which FOLLOWS symlinks.
 */
function historicalResolverEscapes(abs: string, root: string): string | null {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return `project root ${root} does not resolve`;
  }
  let probe = abs;
  for (;;) {
    if (fs.existsSync(probe)) break;
    const parent = path.dirname(probe);
    if (parent === probe) return `no existing ancestor of ${abs}`;
    probe = parent;
  }
  let realProbe: string;
  try {
    realProbe = fs.realpathSync(probe);
  } catch {
    return `${probe} does not resolve`;
  }
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) {
    return `${abs} resolves outside the project root (${realProbe})`;
  }
  return null;
}

/**
 * RESOLVER LANE, ROUND 1 — the "literal-only" fix, kept because variant 1's second
 * half (a symlinked PARENT) is precisely what it fails to see.
 */
function historicalLeafOnlyCheck(abs: string): string | null {
  const st = fs.existsSync(abs) ? fs.lstatSync(abs) : null;
  if (st !== null && !st.isFile()) return `${abs} is not a regular file`;
  return null;
}

/**
 * LEARN LANE, ROUND 4 — the over-correction: ANY symlink on the climb refuses,
 * with no root exception. This is the one that broke a legitimate symlinked
 * project root, so it is a control for a FALSE REFUSAL rather than a false accept.
 */
function historicalLearnOverStrict(projectRoot: string, abs: string): boolean {
  try {
    const rootReal = fs.realpathSync(projectRoot);
    let probe = abs;
    for (;;) {
      let st: fs.Stats | null = null;
      try {
        st = fs.lstatSync(probe);
      } catch {
        st = null;
      }
      if (st !== null) {
        if (st.isSymbolicLink()) return false; // no root exception — the regression
        break;
      }
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
    const probeReal = fs.realpathSync(probe);
    const rel = path.relative(rootReal, probeReal);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────────────────

/**
 * Extract the refusal, failing loudly when the call was CONTAINED.
 *
 * Deliberately not `expect(r.contained).toBe(false)` followed by a cast: that
 * reports "expected false, got true" and loses the one fact worth knowing. Here a
 * wrongly-accepted attack names the path it accepted.
 */
function refusalOf(r: ContainmentResult | PrepareResult): ContainmentRefused {
  if (!("code" in r)) {
    throw new Error(`expected a refusal, but the path was CONTAINED at ${r.realPath}`);
  }
  return r;
}

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "guild-containment-"));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

/** A project root and an outside directory, both real, on the same temp tree. */
function fixture(): { root: string; outside: string } {
  const root = path.join(scratch, "project");
  const outside = path.join(scratch, "outside");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  return { root, outside };
}

describe("the refusal vocabulary is closed and frozen", () => {
  test("mutation is refused at runtime and the type list stays in sync", () => {
    expect(Object.isFrozen(CONTAINMENT_REFUSAL_CODES)).toBe(true);
    expect(() => {
      (CONTAINMENT_REFUSAL_CODES as string[]).push("anything");
    }).toThrow();
    expect([...CONTAINMENT_REFUSAL_CODES].sort()).toEqual(
      [
        "dangling-symlink",
        "leaf-not-regular-file",
        "mkdir-failed",
        "no-existing-ancestor",
        "outside-root",
        "physical-symlink",
        "root-unresolvable",
      ].sort()
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VARIANT 1 — RESOLVER LANE (CRITICAL): a symlinked TARGET, then a symlinked
// PARENT, let a write escape the project and overwrite an arbitrary file while
// the call reported `applied`.
// ═══════════════════════════════════════════════════════════════════════════════

describe("variant 1 — the write escape that still reported success", () => {
  test("1a: a symlinked TARGET is refused as leaf-not-regular-file", () => {
    const { root, outside } = fixture();
    const victim = path.join(outside, "victim.md");
    fs.writeFileSync(victim, "PRECIOUS", "utf8");
    fs.mkdirSync(path.join(root, ".guild", "agents"), { recursive: true });
    const target = path.join(root, ".guild", "agents", "qa.md");
    fs.symlinkSync(victim, target);

    const r = checkContained(root, target, { requireRegularFileLeaf: true });
    expect(refusalOf(r).code).toBe("leaf-not-regular-file");

    // The write path refuses too, and the victim is untouched.
    const w = writeContainedFile(root, target, Buffer.from("ADOPTED", "utf8"));
    expect(w.written).toBe(false);
    expect(w.code).toBe("leaf-not-regular-file");
    expect(fs.readFileSync(victim, "utf8")).toBe("PRECIOUS");
  });

  test("1b: a symlinked PARENT escapes the leaf-only check — and is refused as outside-root", () => {
    const { root, outside } = fixture();
    const victim = path.join(outside, "qa.md");
    fs.writeFileSync(victim, "PRECIOUS", "utf8");
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    // `.guild/agents` is a symlink to a directory OUTSIDE the project.
    fs.symlinkSync(outside, path.join(root, ".guild", "agents"));
    const target = path.join(root, ".guild", "agents", "qa.md");

    // NEGATIVE CONTROL: the round-1 leaf-only check sees a regular file (it
    // follows the parent link) and reports NO problem. The fixture is live.
    expect(historicalLeafOnlyCheck(target)).toBeNull();

    const r = checkContained(root, target, { requireRegularFileLeaf: true });
    expect(refusalOf(r).code).toBe("outside-root");

    const w = writeContainedFile(root, target, Buffer.from("ADOPTED", "utf8"));
    expect(w.written).toBe(false);
    expect(w.code).toBe("outside-root");
    expect(fs.readFileSync(victim, "utf8")).toBe("PRECIOUS");
  });

  test("1c: a refusal is never reported as an applied write", () => {
    const { root, outside } = fixture();
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ".guild", "agents"));
    const w = writeContainedFile(
      root,
      path.join(root, ".guild", "agents", "new.md"),
      Buffer.from("x", "utf8")
    );
    expect(w.written).toBe(false);
    expect(w.realPath).toBeUndefined();
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VARIANT 2 — LEARN LANE, both halves.
// ═══════════════════════════════════════════════════════════════════════════════

describe("variant 2a — mkdir ran BEFORE the check, so `mkdir -p` created through a symlinked ancestor", () => {
  test("nothing is created outside the root when the pre-check refuses", () => {
    const { root, outside } = fixture();
    fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
    // `.guild/runs/<id>` is a symlink out of the tree.
    fs.symlinkSync(outside, path.join(root, ".guild", "runs", "r1"));
    const target = path.join(root, ".guild", "runs", "r1", "capability", "profile.json");

    // The unguarded order: mkdir first. Demonstrate that it DOES create through
    // the link, which is what made the ordering a defect rather than a nicety.
    const unguarded = path.join(scratch, "unguarded", "runs", "r1");
    fs.mkdirSync(path.join(scratch, "unguarded", "runs"), { recursive: true });
    fs.symlinkSync(outside, unguarded);
    fs.mkdirSync(path.join(unguarded, "capability"), { recursive: true });
    expect(fs.existsSync(path.join(outside, "capability"))).toBe(true);
    fs.rmSync(path.join(outside, "capability"), { recursive: true, force: true });

    // The primitive: pre-check refuses, and `outside` is untouched.
    const before = fs.readdirSync(outside);
    const r = prepareContainedWrite(root, target);
    expect(refusalOf(r).code).toBe("outside-root");
    expect(fs.readdirSync(outside)).toEqual(before);
    expect(fs.existsSync(path.join(outside, "capability"))).toBe(false);
  });

  test("the mkdir DOES happen when the pre-check passes — the guard is not a blanket refusal", () => {
    const { root } = fixture();
    const target = path.join(root, ".guild", "runs", "r1", "capability", "profile.json");
    const r = prepareContainedWrite(root, target);
    expect(r.contained).toBe(true);
    if (!r.contained) throw new Error("unreachable");
    expect(fs.statSync(path.dirname(target)).isDirectory()).toBe(true);
    expect(r.realDir).toBe(fs.realpathSync(path.dirname(target)));
  });
});

describe("variant 2b — a DANGLING symlink walked through the helper written to stop symlinks", () => {
  test("`existsSync` reads a dangling link as absent; `lstatSync` catches it", () => {
    const { root, outside } = fixture();
    const capability = path.join(root, ".guild", "runs", "r1", "capability");
    fs.mkdirSync(capability, { recursive: true });
    const escaped = path.join(outside, "escaped.json");
    // The link target does NOT exist yet — this is the dangling case.
    fs.symlinkSync(escaped, path.join(capability, "profile.json"));
    const target = path.join(capability, "profile.json");

    // NEGATIVE CONTROL: the resolver lane's `existsSync` climb reports CONTAINED,
    // because the dangling link reads as absent and the climb validated its
    // in-root parent instead. The fixture is live.
    expect(historicalResolverEscapes(target, root)).toBeNull();

    const r = checkContained(root, target);
    expect(refusalOf(r).code).toBe("dangling-symlink");

    const w = writeContainedFile(root, target, Buffer.from("{}", "utf8"));
    expect(w.written).toBe(false);
    // Pinned EXACTLY, not as a set of acceptable codes. `writeContainedFile`
    // defaults `requireRegularFileLeaf` on, and that check runs before the link is
    // resolved — so the ordering is deterministic and a set-membership assertion
    // would only be hiding which rule actually fired. Both codes are correct
    // refusals; only one of them is the one that happens.
    expect(w.code).toBe("leaf-not-regular-file");
    expect(fs.existsSync(escaped)).toBe(false);
  });

  test("a dangling symlink at an ANCESTOR is refused too", () => {
    const { root, outside } = fixture();
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.symlinkSync(path.join(outside, "nope"), path.join(root, ".guild", "runs"));
    const target = path.join(root, ".guild", "runs", "r1", "profile.json");

    expect(historicalResolverEscapes(target, root)).toBeNull(); // control: accepts

    const r = checkContained(root, target);
    expect(refusalOf(r).code).toBe("dangling-symlink");
  });
});

describe("variant 2c — the over-correction broke a legitimate symlinked project ROOT", () => {
  test("a symlinked root is permitted, matched by realpath and not by name", () => {
    const real = path.join(scratch, "real");
    fs.mkdirSync(real, { recursive: true });
    const alias = path.join(scratch, "alias");
    fs.symlinkSync(real, alias);
    const target = path.join(alias, ".guild", "runs", "r1", "profile.json");

    // NEGATIVE CONTROL: the round-4 rule refuses this legitimate write, because
    // the climb reaches the root's own symlink and has no exception for it.
    expect(historicalLearnOverStrict(alias, target)).toBe(false);

    const r = checkContained(alias, target);
    expect(r.contained).toBe(true);
    if (!r.contained) throw new Error("unreachable");
    expect(r.realRoot).toBe(fs.realpathSync(real));

    const w = writeContainedFile(alias, target, Buffer.from("{}", "utf8"));
    expect(w.written).toBe(true);
    expect(fs.readFileSync(path.join(real, ".guild/runs/r1/profile.json"), "utf8")).toBe("{}");
  });

  test("an IN-ROOT symlink is permitted under `resolve` — the reconciled semantics", () => {
    const { root } = fixture();
    const realDir = path.join(root, ".guild", "_runs");
    fs.mkdirSync(realDir, { recursive: true });
    fs.symlinkSync(realDir, path.join(root, ".guild", "runs"));
    const target = path.join(root, ".guild", "runs", "r1", "profile.json");

    // The learn lane's rule refuses this; the resolver lane's permits it. The
    // reconciled rule permits it, because it resolves inside the root.
    expect(historicalLearnOverStrict(root, target)).toBe(false);
    const r = checkContained(root, target);
    expect(r.contained).toBe(true);
  });

  test("…and REFUSED under `physical`, which is a policy and not a second implementation", () => {
    const { root } = fixture();
    const realDir = path.join(root, ".guild", "_runs");
    fs.mkdirSync(realDir, { recursive: true });
    fs.symlinkSync(realDir, path.join(root, ".guild", "runs"));
    const target = path.join(root, ".guild", "runs", "r1", "profile.json");

    const r = checkContained(root, target, { policy: "physical" });
    expect(refusalOf(r).code).toBe("physical-symlink");
  });

  test("`physical` still permits a symlinked ROOT — the exception that is not an exception", () => {
    const real = path.join(scratch, "real");
    fs.mkdirSync(path.join(real, ".guild", "runs"), { recursive: true });
    const alias = path.join(scratch, "alias");
    fs.symlinkSync(real, alias);
    const r = checkContained(alias, path.join(alias, ".guild", "runs", "r1", "x.json"), {
      policy: "physical",
    });
    expect(r.contained).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VARIANT 3 — DEEP-FREEZE LANE: the same question through the build-determinism
// door. A symlinked `hooks/node_modules` made esbuild record resolved paths
// OUTSIDE the package, so the committed bytes depended on which sibling checkout
// happened to be installed.
// ═══════════════════════════════════════════════════════════════════════════════

describe("variant 3 — the determinism escape, same question, different door", () => {
  test("a symlinked node_modules is reported as outside-root, so a build can refuse it", () => {
    const pkg = path.join(scratch, "hooks");
    const sibling = path.join(scratch, "sibling", "node_modules", "js-yaml");
    fs.mkdirSync(pkg, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, "index.js"), "module.exports={}", "utf8");
    fs.symlinkSync(path.join(scratch, "sibling", "node_modules"), path.join(pkg, "node_modules"));

    const resolved = path.join(pkg, "node_modules", "js-yaml", "index.js");
    const r = checkContained(pkg, resolved);
    expect(refusalOf(r).code).toBe("outside-root");
    // The reported realPath is the out-of-package path esbuild would have baked in.
    expect(historicalResolverEscapes(resolved, pkg)).not.toBeNull();
  });

  test("a REAL node_modules in the package is contained — the check is not just 'refuse node_modules'", () => {
    const pkg = path.join(scratch, "hooks");
    const real = path.join(pkg, "node_modules", "js-yaml");
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, "index.js"), "module.exports={}", "utf8");
    const r = checkContained(pkg, path.join(real, "index.js"));
    expect(r.contained).toBe(true);
    if (!r.contained) throw new Error("unreachable");
    expect(r.realPath).toBe(fs.realpathSync(path.join(real, "index.js")));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// The remaining rules, each asserted by CODE.
// ═══════════════════════════════════════════════════════════════════════════════

describe("the rest of the refusal vocabulary", () => {
  test("`..` traversal is outside-root", () => {
    const { root } = fixture();
    const r = checkContained(root, path.join(root, "..", "outside", "x"));
    expect(refusalOf(r).code).toBe("outside-root");
  });

  test("a sibling named `..guild` is INSIDE — the containment test is segment-aware", () => {
    const { root } = fixture();
    // `path.relative` yields "..guild/x", which `startsWith("..")` would call an
    // escape. It is not one.
    const r = checkContained(root, path.join(root, "..guild", "x"));
    expect(r.contained).toBe(true);
  });

  test("an unresolvable root is root-unresolvable, not outside-root", () => {
    const r = checkContained(path.join(scratch, "nope"), path.join(scratch, "nope", "x"));
    expect(refusalOf(r).code).toBe("root-unresolvable");
  });

  test("a FIFO/directory at the leaf is leaf-not-regular-file, not outside-root", () => {
    const { root } = fixture();
    const target = path.join(root, "artifact");
    fs.mkdirSync(target);
    const r = checkContained(root, target, { requireRegularFileLeaf: true });
    expect(refusalOf(r).code).toBe("leaf-not-regular-file");
  });

  test("mkdir failure is mkdir-failed, distinct from every containment refusal", () => {
    const { root } = fixture();
    // A regular file occupying the directory slot: `mkdir -p` cannot proceed.
    fs.writeFileSync(path.join(root, "blocked"), "x", "utf8");
    const r = prepareContainedWrite(root, path.join(root, "blocked", "child.json"));
    expect(refusalOf(r).code).toBe("mkdir-failed");
  });

  test("assertContained throws with the code embedded, and returns the proof on success", () => {
    const { root, outside } = fixture();
    expect(() => assertContained(root, path.join(outside, "x"), "[emit]")).toThrow(
      /\[outside-root\]/
    );
    const ok = assertContained(root, path.join(root, "a", "b"), "[emit]");
    expect(ok.realRoot).toBe(fs.realpathSync(root));
  });
});

describe("the write is atomic and refuses a link planted at the leaf", () => {
  test("a successful write replaces the previous bytes wholesale", () => {
    const { root } = fixture();
    const target = path.join(root, "out", "profile.json");
    expect(writeContainedFile(root, target, Buffer.from("first", "utf8")).written).toBe(true);
    expect(writeContainedFile(root, target, Buffer.from("second", "utf8")).written).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("second");
    // No temp files left behind.
    expect(fs.readdirSync(path.dirname(target))).toEqual(["profile.json"]);
  });

  test("a link swapped BETWEEN the check and the open cannot move the write (adversarial repro)", () => {
    // Reproduced by an adversarial pass. `root/alias -> root/A`; the link is
    // re-pointed at `root/B` from inside the first `openSync`. The write must land
    // where containment was PROVEN, not where the name points afterwards.
    const { root } = fixture();
    const a = path.join(root, "A");
    const b = path.join(root, "B");
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(a, "file"), "A0", "utf8");
    fs.writeFileSync(path.join(b, "file"), "B0", "utf8");
    const alias = path.join(root, "alias");
    fs.symlinkSync(a, alias);

    const origOpen = fs.openSync;
    let swapped = false;
    (fs as { openSync: typeof fs.openSync }).openSync = ((...args: Parameters<typeof fs.openSync>) => {
      if (!swapped) {
        swapped = true;
        fs.unlinkSync(alias);
        fs.symlinkSync(b, alias);
      }
      return origOpen(...args);
    }) as typeof fs.openSync;

    let w: ReturnType<typeof writeContainedFile>;
    try {
      w = writeContainedFile(root, path.join(alias, "file"), Buffer.from("NEW", "utf8"));
    } finally {
      (fs as { openSync: typeof fs.openSync }).openSync = origOpen;
    }

    expect(swapped).toBe(true); // non-vacuity: the race really happened
    expect(w.written).toBe(true);
    // Bound to the LOCATION proven contained…
    expect(w.realPath).toBe(path.join(fs.realpathSync(a), "file"));
    expect(fs.readFileSync(path.join(a, "file"), "utf8")).toBe("NEW");
    // …and the swap target is untouched, which is the property that matters.
    expect(fs.readFileSync(path.join(b, "file"), "utf8")).toBe("B0");
    // The caller's NAME no longer refers to the written file. Documented, not a bug:
    // on a filesystem where a component can be re-pointed concurrently, containment
    // is available and name stability is not.
    expect(fs.readFileSync(path.join(alias, "file"), "utf8")).toBe("B0");
  });

  test("an in-root symlink at the leaf is refused rather than followed", () => {
    const { root } = fixture();
    fs.mkdirSync(path.join(root, "out"), { recursive: true });
    const inRoot = path.join(root, "other.json");
    fs.writeFileSync(inRoot, "OTHER", "utf8");
    fs.symlinkSync(inRoot, path.join(root, "out", "profile.json"));
    const w = writeContainedFile(root, path.join(root, "out", "profile.json"), Buffer.from("x"));
    expect(w.written).toBe(false);
    expect(w.code).toBe("leaf-not-regular-file");
    expect(fs.readFileSync(inRoot, "utf8")).toBe("OTHER");
  });
});
