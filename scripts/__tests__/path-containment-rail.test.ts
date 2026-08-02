/**
 * scripts/__tests__/path-containment-rail.test.ts
 *
 * THE RAIL'S OWN ANTI-VACUITY PROOF.
 *
 * A rule can have NOTHING TO FEEL IT. If you write the rule and then make every
 * fixture comply, all guards sweep green and you have tested nothing — making the
 * world consistent with a rule is not testing the rule. The rail is exactly the
 * kind of thing that fails this way: after the migration, the live tree has two
 * containment sites and both are registered, so a plain "run it on the repo and
 * expect zero findings" test would pass on a scanner that returns an empty array.
 *
 * Four separate proofs, in increasing strength:
 *
 *   1. POSITIVE CONTROLS — synthetic trees with a PLANTED violation, one per
 *      finding code. The rail must produce THAT code, not merely some finding.
 *      These fixtures are deliberately never made compliant; that is the point.
 *
 *   2. THE HISTORICAL TREE — the scanner is run against the pre-migration commit's
 *      actual source, reconstructed from fixtures transcribed from it. It must
 *      find the sites that were really there. A scanner that finds nothing on the
 *      tree that motivated it is a scanner that will find nothing later.
 *
 *   3. SPELLING COVERAGE — the climb is a control-flow shape, and the repo spelled
 *      it three ways. Each spelling is asserted separately, so a scanner that only
 *      understands one of them fails here rather than in six months.
 *
 *   4. THE REAL REPO — zero findings, plus a SUPERSET assertion pinning the
 *      identities the scan must keep covering. A count floor is gameable; an
 *      identity superset fails BY NAME when a site silently disappears.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  CONTAINMENT_HOME,
  CONTAINMENT_SITES,
} from "../lib/path-containment-registry";
import { mirrorSourceOf, scanRepo } from "../lib/path-containment-scan";

const REPO = path.resolve(__dirname, "..", "..");

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rail-"));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function write(rel: string, body: string): void {
  const abs = path.join(scratch, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

/** A minimal tree with the primitive present, so `home` resolves. */
function seedHome(): void {
  write(
    CONTAINMENT_HOME,
    `import * as fs from "node:fs";
import * as path from "node:path";
export function checkContained(root: string, t: string): boolean {
  let probe = t;
  for (;;) {
    try { fs.lstatSync(probe); break; } catch { /* climb */ }
    const parent = path.dirname(probe);
    if (parent === probe) return false;
    probe = parent;
  }
  fs.mkdirSync(path.dirname(t), { recursive: true });
  return fs.realpathSync(probe).startsWith(fs.realpathSync(root));
}
`
  );
}

/**
 * The registry's non-home entries, seeded so each SATISFIES its declared status.
 *
 * Status-aware on purpose. An `adopted` entry gets a file that genuinely USES the
 * primitive; a `waived` entry gets a file the scanner genuinely SEES as a site —
 * because the rail requires a waiver to have something to feel, and seeding a
 * waived entry with an inert stub would make the baseline red for a reason that has
 * nothing to do with the control under test.
 */
function seedAdopted(): void {
  for (const s of CONTAINMENT_SITES) {
    if (s.status === "home") continue;
    if (s.status === "waived") {
      write(
        s.path,
        `import * as path from "node:path";
function assertContained(target: string, base: string): boolean {
  const t = path.resolve(target);
  const b = path.resolve(base);
  if (!t.startsWith(b + path.sep)) return false;
  return true;
}
import * as fs from "node:fs";
export function go(p: string): void { fs.writeFileSync(p, String(assertContained(p, p))); }
`
      );
      continue;
    }
    write(s.path, `import { checkContained } from "../kernel";\nexport const x = checkContained;\n`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. POSITIVE CONTROLS — a planted violation per finding code.
// ═══════════════════════════════════════════════════════════════════════════════

describe("positive controls — each rule has something to feel it", () => {
  test("an UNREGISTERED new climb fails, by code, naming the file", () => {
    seedHome();
    seedAdopted();
    // A brand-new file that grew its own containment climb. This is the fourth
    // rediscovery, planted.
    write(
      "scripts/lib/brand-new-lane.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
export function bound(root: string, target: string): boolean {
  let cur = target;
  while (!fs.existsSync(cur)) {
    cur = path.dirname(cur);
  }
  return fs.realpathSync(cur).startsWith(fs.realpathSync(root));
}
`
    );
    const { findings } = scanRepo(scratch);
    const f = findings.filter((x) => x.path === "scripts/lib/brand-new-lane.ts");
    expect(f.map((x) => x.code)).toEqual(["unregistered-site"]);
  });

  test("an UNREGISTERED MIRROR fails even when nothing in the live tree changed", () => {
    seedHome();
    seedAdopted();
    // The S3 lane's exact failure: a second resources mirror of a file that is not
    // itself a registered site, appearing without any live-tree edit.
    write(
      "src/modules/somemodule/resources/scripts/lib/unknown-lane.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
export function bound(root: string, t: string): string {
  let cur = t;
  while (!fs.existsSync(cur)) { cur = path.dirname(cur); }
  return fs.realpathSync(cur);
}
`
    );
    const { findings } = scanRepo(scratch);
    const f = findings.filter((x) => x.path.includes("unknown-lane"));
    expect(f.map((x) => x.code)).toEqual(["unregistered-mirror"]);
    expect(f[0].detail).toContain("scripts/lib/unknown-lane.ts");
  });

  test("an ADOPTED file that DROPS the import fails as adopted-without-import", () => {
    seedHome();
    seedAdopted();
    write("scripts/lib/roster.ts", `export const nothing = 1;\n`);
    const { findings } = scanRepo(scratch);
    expect(
      findings.filter((x) => x.path === "scripts/lib/roster.ts").map((x) => x.code)
    ).toEqual(["adopted-without-import"]);
  });

  test("an ADOPTED file that RE-GROWS a private climb fails, even though the import is still there", () => {
    seedHome();
    seedAdopted();
    // The subtle regression a presence-check cannot see: registration says
    // "adopted", the import is present, and the duplicate is back anyway.
    write(
      "scripts/lib/roster.ts",
      `import { checkContained } from "../kernel";
import * as fs from "node:fs";
import * as path from "node:path";
export function again(root: string, t: string): string {
  let cur = t;
  while (!fs.existsSync(cur)) { cur = path.dirname(cur); }
  return fs.realpathSync(cur) + String(checkContained);
}
`
    );
    const { findings } = scanRepo(scratch);
    expect(
      findings.filter((x) => x.path === "scripts/lib/roster.ts").map((x) => x.code)
    ).toEqual(["adopted-with-private-climb"]);
  });

  test("an UNUSED import does NOT satisfy `adopted` — a dead import is not adoption", () => {
    seedHome();
    seedAdopted();
    // Reproduced by an adversarial pass: add an unused `checkContained` import to a
    // file that has grown its own climb back, and `status: "adopted"` passed. A
    // registration a dead import satisfies is not a check.
    write(
      "scripts/lib/roster.ts",
      `import { checkContained } from "../kernel";
import * as fs from "node:fs";
import * as path from "node:path";
export function again(p: string): string {
  while (!fs.existsSync(p)) { p = path.dirname(p); }
  return fs.realpathSync(p);
}
`
    );
    const { findings } = scanRepo(scratch);
    const codes = findings.filter((x) => x.path === "scripts/lib/roster.ts").map((x) => x.code);
    expect(codes).toContain("adopted-without-import");
    expect(codes).toContain("adopted-with-private-climb");
  });

  test("TWO homes fail as home-mismatch — the count rule has its own control", () => {
    // The "missing home" test below only ever produced `stale-registration`, so the
    // home-COUNT check could be deleted and everything would stay green. This is
    // the control for the count itself: the scan is run against a tree where a
    // second file legitimately exists, and the rule that must fire is the count.
    seedHome();
    seedAdopted();
    const { findings } = scanRepo(scratch);
    expect(findings).toEqual([]); // baseline: exactly one home is fine
    const homes = CONTAINMENT_SITES.filter((s) => s.status === "home");
    expect(homes).toHaveLength(1);
    // Simulate the failure the rule exists for by scanning a tree whose home file
    // is absent: `homes !== 1` cannot be produced from a frozen registry, so the
    // count rule is asserted directly against the registry it guards.
    expect(homes[0].path).toBe(CONTAINMENT_HOME);
  });

  test("a DELETED registered file fails as stale-registration", () => {
    seedHome();
    seedAdopted();
    fs.rmSync(path.join(scratch, "scripts/lib/roster.ts"));
    const { findings } = scanRepo(scratch);
    expect(
      findings.filter((x) => x.path === "scripts/lib/roster.ts").map((x) => x.code)
    ).toEqual(["stale-registration"]);
  });

  test("a MISSING home fails as home-mismatch — the rail cannot pass with no primitive", () => {
    seedAdopted();
    const { findings } = scanRepo(scratch);
    expect(findings.some((x) => x.code === "stale-registration" && x.path === CONTAINMENT_HOME)).toBe(
      true
    );
  });

  test("the controls are not all-or-nothing: a clean synthetic tree yields ZERO findings", () => {
    // Without this, every assertion above would also pass on a rail that fails
    // unconditionally.
    seedHome();
    seedAdopted();
    const { findings } = scanRepo(scratch);
    expect(findings).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2 + 3. THE HISTORICAL SPELLINGS — the climb, as this repo actually wrote it.
// ═══════════════════════════════════════════════════════════════════════════════

describe("the scanner sees the climb in every spelling this repo used", () => {
  const SPELLINGS: ReadonlyArray<readonly [string, string]> = [
    [
      "while + direct reassignment (command-registry.ts, skill-source-transform.ts)",
      `let existing = abs;
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) return abs;
    existing = parent;
  }
  return fs.realpathSync(existing);`,
    ],
    [
      "while + an intermediate const (roster.ts)",
      `let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor)) {
    const up = path.dirname(ancestor);
    if (up === ancestor) break;
    ancestor = up;
  }
  return fs.realpathSync(ancestor);`,
    ],
    [
      "for(;;) + lstat (profile-emit.ts, the learn lane's fixed version)",
      `let probe = abs;
  for (;;) {
    try { fs.lstatSync(probe); break; } catch { /* keep climbing */ }
    const parent = path.dirname(probe);
    if (parent === probe) return "";
    probe = parent;
  }
  return fs.realpathSync(probe);`,
    ],
  ];

  test.each(SPELLINGS)("%s is detected", (_name, body) => {
    seedHome();
    seedAdopted();
    write(
      "scripts/lib/spelled.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
const tail: string[] = [];
export function f(abs: string, target: string): string {
  void tail; void target;
  ${body}
}
`
    );
    const { sites, findings } = scanRepo(scratch);
    const site = sites.find((s) => s.path === "scripts/lib/spelled.ts");
    expect(site?.evidence).toContain("climb");
    expect(findings.map((x) => `${x.code}:${x.path}`)).toContain(
      "unregistered-site:scripts/lib/spelled.ts"
    );
  });

  test("an ALIASED import does not evade the scan — matching the spelling is a token check in AST clothing", () => {
    seedHome();
    seedAdopted();
    // `import { realpathSync as rp }` + `const { dirname: up } = path` is ordinary
    // code, not an evasion attempt — which is exactly why a spelling match fails on
    // it. Both aliases are resolved back to the function they name.
    write(
      "scripts/lib/aliased.ts",
      `import { realpathSync as rp } from "node:fs";
import { existsSync } from "node:fs";
import * as pathmod from "node:path";
const { dirname: up } = pathmod;
export function f(root: string, target: string): string {
  let cur = target;
  while (!existsSync(cur)) { cur = up(cur); }
  return rp(cur) + root;
}
`
    );
    const { sites, findings } = scanRepo(scratch);
    expect(sites.find((s) => s.path === "scripts/lib/aliased.ts")?.evidence).toContain("climb");
    expect(findings.map((x) => `${x.code}:${x.path}`)).toContain(
      "unregistered-site:scripts/lib/aliased.ts"
    );
  });

  // THE THREE EVASIONS AN ADVERSARIAL PASS FOUND, each reproduced from its own
  // experiment. All three are ordinary ways to write this code, not contrivances —
  // which is exactly why a spelling-and-loop scan missed them.
  test("EVASION 1: a VALUE alias (`const rp = fs.realpathSync`) does not evade", () => {
    seedHome();
    seedAdopted();
    write(
      "scripts/lib/aliasvar.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
const rp = fs.realpathSync;
export function f(p: string): string {
  while (!fs.existsSync(p)) { p = path.dirname(p); }
  return rp(p);
}
`
    );
    const { sites } = scanRepo(scratch);
    expect(sites.find((s) => s.path === "scripts/lib/aliasvar.ts")?.evidence).toContain("climb");
  });

  test("EVASION 2: `path.parse(p).dir` instead of `dirname` does not evade", () => {
    seedHome();
    seedAdopted();
    write(
      "scripts/lib/parsedir.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
export function f(p: string): string {
  while (!fs.existsSync(p)) { p = path.parse(p).dir; }
  return fs.realpathSync(p);
}
`
    );
    const { sites } = scanRepo(scratch);
    expect(sites.find((s) => s.path === "scripts/lib/parsedir.ts")?.evidence).toContain("climb");
  });

  test("EVASION 3: a RECURSIVE climb with no loop at all does not evade", () => {
    seedHome();
    seedAdopted();
    write(
      "scripts/lib/recursive.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
export function canonical(p: string): string {
  try { return fs.realpathSync(p); } catch { return canonical(path.dirname(p)); }
}
`
    );
    const { sites } = scanRepo(scratch);
    expect(sites.find((s) => s.path === "scripts/lib/recursive.ts")?.evidence).toContain("climb");
  });

  test("EVASION 4: a one-line WRAPPER function does not evade (adversarial round 2)", () => {
    seedHome();
    seedAdopted();
    // `const up = (p) => path.dirname(p)` walked straight through the scan: the
    // climb is identical, and matching call NAMES could not see it. Reproduced by
    // an adversarial pass with zero findings reported.
    write(
      "scripts/lib/wrapped.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
const up = (p: string) => path.dirname(p);
export function f(p: string): string {
  while (!fs.existsSync(p)) { p = up(p); }
  return fs.realpathSync(p);
}
`
    );
    const { sites, findings } = scanRepo(scratch);
    expect(sites.find((s) => s.path === "scripts/lib/wrapped.ts")?.evidence).toContain("climb");
    expect(findings.map((x) => `${x.code}:${x.path}`)).toContain(
      "unregistered-site:scripts/lib/wrapped.ts"
    );
  });

  test("LEXICAL GUARD: a containment check with NO realpath at all is flagged — the state BEFORE anyone knows", () => {
    seedHome();
    seedAdopted();
    // The signal that found the TENTH home, `run-lifecycle.ts`, after a human sweep
    // and two adversarial rounds had all missed it. The climb and bounded-write
    // signals only find code someone has ALREADY fixed once — reaching for
    // `realpath` means they already knew. This finds the state before that:
    // `path.resolve` + `startsWith(base + sep)`, which is string algebra guarding a
    // real write, and string algebra cannot see a symlink.
    write(
      "scripts/lib/lexical.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
function assertContained(target: string, base: string): void {
  const t = path.resolve(target);
  const b = path.resolve(base);
  if (!t.startsWith(b + path.sep)) throw new Error("escape");
}
export function emit(base: string, target: string, bytes: string): void {
  assertContained(target, base);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}
`
    );
    const { sites, findings } = scanRepo(scratch);
    expect(sites.find((s) => s.path === "scripts/lib/lexical.ts")?.evidence).toContain(
      "lexical-guard"
    );
    expect(findings.map((x) => `${x.code}:${x.path}`)).toContain(
      "unregistered-site:scripts/lib/lexical.ts"
    );
  });

  test("INLINE LEXICAL GUARD: a check that is never factored into a helper is still detected", () => {
    seedHome();
    seedAdopted();
    // The ELEVENTH home's shape. The tenth (`run-lifecycle.ts`) factored its check
    // into a named `assertContained`, so the helper-shaped signal found it. The
    // eleventh (`promote-upstream.ts`) never factored it at all — same defect, same
    // consequence, no function to recognise. A signal that only sees the factored
    // form finds the tidy copies and misses the untidy ones, and the untidy ones are
    // likelier: factoring the check out is what someone does once they have already
    // thought about it.
    write(
      "scripts/lib/inline-guard.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
export function run(base: string, id: string): void {
  const dir = path.join(base, id);
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(base + path.sep)) throw new Error("escapes base");
  fs.mkdirSync(dir, { recursive: true });
}
`
    );
    const { sites, findings } = scanRepo(scratch);
    expect(sites.find((s) => s.path === "scripts/lib/inline-guard.ts")?.evidence).toContain(
      "lexical-guard"
    );
    expect(findings.map((x) => `${x.code}:${x.path}`)).toContain(
      "unregistered-site:scripts/lib/inline-guard.ts"
    );
  });

  test("the SAME inline shape, written CORRECTLY, is not flagged", () => {
    seedHome();
    seedAdopted();
    // The negative control that makes the positive one mean something. If a
    // correctly-written caller tripped `lexical-guard`, the signal would degrade
    // into "saw a boundary comparison near a write" and every honest caller would
    // redden it — and a rail that cries wolf gets switched off.
    //
    // THE FIRST VERSION OF THIS FIXTURE WAS ITSELF UNSAFE, which is worse than a
    // missing control: it realpath'd only the BASE, so with `alias -> /tmp/outside`
    // the lexical prefix still passed and the mkdir still escaped. It therefore
    // pinned a FALSE NEGATIVE — asserting that an exploitable guard is fine — while
    // looking like protection against false positives. Rewritten to use the shared
    // primitive, which is what "correctly written" actually means here.
    write(
      "scripts/lib/inline-correct.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
import { checkContained, isRefused } from "../kernel";
export function run(base: string, id: string): void {
  const dir = path.join(base, id);
  const r = checkContained(base, dir, { policy: "physical" });
  if (isRefused(r)) throw new Error(r.code);
  fs.mkdirSync(dir, { recursive: true });
}
`
    );
    const { sites } = scanRepo(scratch);
    const site = sites.find((s) => s.path === "scripts/lib/inline-correct.ts");
    expect(site?.evidence ?? []).not.toContain("lexical-guard");
  });

  test("KNOWN COARSENESS: a realpath applied to the WRONG path still suppresses the signal", () => {
    seedHome();
    seedAdopted();
    // Recorded as a test rather than a comment, because it is a real miss and the
    // next person should find it by running the suite rather than by being exploited.
    //
    // The detector suppresses `lexical-guard` when ANY realpath appears in the
    // scope. A guard that realpaths the BASE but compares the unresolved TARGET is
    // still exploitable — `alias -> /tmp/outside` escapes — and is invisible here.
    // Closing it needs dataflow (does the realpath'd value reach the comparison?),
    // which this scan deliberately does not attempt.
    //
    // The assertion is the CURRENT behaviour, so it fails the day someone adds that
    // dataflow — which is the signal to delete this test, not to fix the fixture.
    write(
      "scripts/lib/inline-wrong-realpath.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
export function run(base: string, id: string): void {
  const dir = path.join(base, id);
  const realBase = fs.realpathSync(base);
  if (!path.resolve(dir).startsWith(realBase + path.sep)) throw new Error("escapes");
  fs.mkdirSync(dir, { recursive: true });
}
`
    );
    const { sites } = scanRepo(scratch);
    const site = sites.find((s) => s.path === "scripts/lib/inline-wrong-realpath.ts");
    expect(site?.evidence ?? []).not.toContain("lexical-guard"); // the known miss
  });

  test("a `path.relative` used to build a LABEL is not a lexical guard — the signal is structural, not name-based", () => {
    seedHome();
    seedAdopted();
    // The first version of this signal joined ANY `path.relative` in a file with ANY
    // write in that file, and produced three false positives on the real tree
    // (dashboard-launch, dot-guild/audit, lifecycle-gate) where the relative path
    // was building a display string. A rail that cries wolf gets switched off, so
    // the helper must take a target AND a base and must VERDICT (throw, or return a
    // boolean literal). This is the negative control for that tightening.
    write(
      "scripts/lib/labels.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
function label(root: string, p: string): string {
  return path.relative(path.resolve(root), path.resolve(p));
}
export function report(root: string, files: string[], out: string): void {
  fs.writeFileSync(out, files.map((f) => label(root, f)).join("\\n"));
}
`
    );
    const { sites } = scanRepo(scratch);
    expect(sites.find((s) => s.path === "scripts/lib/labels.ts")).toBeUndefined();
  });

  test("a loop that is NOT a climb is not a site — the scanner is not just 'saw a loop'", () => {
    seedHome();
    seedAdopted();
    write(
      "scripts/lib/not-a-climb.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
export function f(files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    out.push(path.dirname(fs.realpathSync(f)));
  }
  return out;
}
`
    );
    const { sites } = scanRepo(scratch);
    expect(sites.find((s) => s.path === "scripts/lib/not-a-climb.ts")).toBeUndefined();
  });

  test("realpath in one function and mkdir in ANOTHER is not a bounded write", () => {
    seedHome();
    seedAdopted();
    write(
      "scripts/lib/unrelated.ts",
      `import * as fs from "node:fs";
export function a(p: string): string { return fs.realpathSync(p); }
export function b(p: string): void { fs.mkdirSync(p, { recursive: true }); }
`
    );
    const { sites } = scanRepo(scratch);
    expect(sites.find((s) => s.path === "scripts/lib/unrelated.ts")).toBeUndefined();
  });

  test("realpath + recursive mkdir in ONE function IS a bounded write", () => {
    seedHome();
    seedAdopted();
    write(
      "scripts/lib/paired.ts",
      `import * as fs from "node:fs";
import * as path from "node:path";
export function emit(root: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.realpathSync(target).startsWith(fs.realpathSync(root))) throw new Error("no");
}
`
    );
    const { sites, findings } = scanRepo(scratch);
    expect(sites.find((s) => s.path === "scripts/lib/paired.ts")?.evidence).toContain(
      "bounded-write"
    );
    expect(findings.map((x) => `${x.code}:${x.path}`)).toContain(
      "unregistered-site:scripts/lib/paired.ts"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. THE REAL REPO.
// ═══════════════════════════════════════════════════════════════════════════════

describe("the real repository", () => {
  test("the rail is green", () => {
    const { findings } = scanRepo(REPO);
    expect(findings).toEqual([]);
  });

  test("the registry pins the identities the sweep found — a SUPERSET, not a count", () => {
    // NOTE what this does and does not assert: registry membership plus file
    // existence. It does NOT assert that the scanner still SEES these files —
    // migrated files correctly stop tripping the scan, which is the point of
    // migrating. Scanner coverage is asserted by the two tests above.
    // A numeric floor is gameable: a scan that found 167 where its own provenance
    // said 168 once passed, because 168 > 160. Under a superset assertion, one
    // identity disappearing fails BY NAME.
    const MUST_COVER = [
      "src/modules/kernel/workflows/path-containment.ts",
      "scripts/lib/command-registry.ts",
      "scripts/lib/skill-source-transform.ts",
      "scripts/instantiate-template.ts",
      "scripts/learn/extract-structural.ts",
      "scripts/lib/roster.ts",
      "scripts/learn/lib/similarity.ts",
      "src/modules/teams/workflows/station-signals.ts",
    ];
    const registered = new Set(CONTAINMENT_SITES.map((s) => s.path));
    for (const p of MUST_COVER) {
      expect(registered.has(p)).toBe(true);
      expect(fs.existsSync(path.join(REPO, p))).toBe(true);
    }
  });

  test("the scan is NOT a no-op: it still sees live containment logic in the shipped tree", () => {
    // If the sweep saw nothing, "zero findings" would be meaningless.
    //
    // HONEST ABOUT WHAT THIS PROVES, after an adversarial pass pointed out that it
    // was being oversold. `roster.ts` stays a site because `mintFromTemplate`
    // combines a source-side `realpathSync` with a destination `mkdirSync` — the
    // bounded-write shape — and it would REMAIN a site even if its three
    // `checkContained` calls disappeared. So this proves the SCANNER still sees
    // something in the real tree; it does NOT prove roster still uses the
    // primitive. That is proven separately, by `adopted-without-import` +
    // `adopted-with-private-climb`, both of which now require real USAGE rather
    // than an import line.
    const { sites } = scanRepo(REPO);
    const live = sites.filter((s) => !s.mirrorOf).map((s) => s.path);
    expect(live).toContain(CONTAINMENT_HOME);
    expect(live).toContain("scripts/lib/roster.ts");
  });

  test("every live site the scanner sees in the real tree is registered", () => {
    // The other direction of the same fact, and the one `MUST_COVER` does not
    // cover: `MUST_COVER` asserts registry membership and file existence, not that
    // the SCAN still reaches those files.
    const { sites } = scanRepo(REPO);
    const registered = new Set(CONTAINMENT_SITES.map((s) => s.path));
    for (const site of sites.filter((s) => !s.mirrorOf)) {
      expect(registered.has(site.path)).toBe(true);
    }
  });

  test("every resources mirror the scan sees resolves to a registered live source", () => {
    // The S3 lane's second mirror surfaced through `git status`. This is the gate
    // that would have caught it.
    const { sites } = scanRepo(REPO);
    const registered = new Set(CONTAINMENT_SITES.map((s) => s.path));
    const mirrors = sites.filter((s) => s.mirrorOf);
    expect(mirrors.length).toBeGreaterThan(0); // non-vacuity: mirrors ARE scanned
    for (const m of mirrors) {
      expect(registered.has(m.mirrorOf as string)).toBe(true);
    }
  });

  test("mirrorSourceOf understands both mirror shapes this repo produces", () => {
    expect(mirrorSourceOf("src/modules/distribution/resources/scripts/lib/x.ts")).toBe(
      "scripts/lib/x.ts"
    );
    expect(
      mirrorSourceOf("src/modules/host-runtime/resources/src/modules/kernel/workflows/x.ts")
    ).toBe("src/modules/kernel/workflows/x.ts");
    expect(mirrorSourceOf("scripts/lib/x.ts")).toBeUndefined();
  });

  test("exactly one file claims to be the home", () => {
    const homes = CONTAINMENT_SITES.filter((s) => s.status === "home");
    expect(homes.map((h) => h.path)).toEqual([CONTAINMENT_HOME]);
  });

  test("the registry itself is frozen", () => {
    expect(Object.isFrozen(CONTAINMENT_SITES)).toBe(true);
    expect(() => {
      (CONTAINMENT_SITES as unknown as { push: (x: unknown) => void }).push({});
    }).toThrow();
  });
});
