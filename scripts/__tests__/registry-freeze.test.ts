/**
 * scripts/__tests__/registry-freeze.test.ts
 *
 * THE REGISTRY-FREEZE RAIL — "the closed vocabulary is actually closed".
 *
 * `as const` is a COMPILE-TIME assertion. It erases. The emitted JavaScript array is a
 * plain mutable array, so every exported "closed vocabulary" in this plugin was
 * runtime-mutable, and the ones whose predicates read them at CALL TIME were
 * exploitable in-process. Demonstrated, not theorised:
 *
 *     EXECUTION_OPERATIONS.push("exfiltrate")   // succeeds, 7 -> 8 entries
 *     isExecutionOperation("exfiltrate")        // false -> TRUE
 *
 * That is the closed 7-name transport vocabulary D11's "additive under major 1"
 * argument rests on, and `NEUTRAL_EVENT_NAMES` / `NEUTRAL_REASON_CODES` (re-ratified
 * for gap B4) behaved identically. Threat model is integrity-of-invariant in-process,
 * not RCE — but "the vocabulary is closed" is load-bearing for the MH conformance
 * claims, and a vocabulary anyone can widen at runtime is not closed.
 *
 * ── WHY THIS RAIL IS HYBRID ────────────────────────────────────────────────────────
 * RUNTIME half: imports each module's PUBLIC INDEX and asserts `Object.isFrozen` on
 * every exported array. This tests the actual property. It is scoped to the module
 * indexes because they are import-safe by construction; importing arbitrary CLI
 * entrypoints would execute them (this repo already carries a `require.main === module`
 * guard in read-guild-config.ts precisely because esbuild inlines it).
 *
 * STATIC half: for the `scripts/**` + `hooks/**` tail, asserts the SPELLING —
 * `export const X = Object.freeze([...] as const)`. Weaker evidence, and the rail SAYS
 * SO in its own output rather than letting a green read as stronger than it is.
 *
 * ── TWO POPULATIONS, REPORTED SEPARATELY ───────────────────────────────────────────
 * `Object.freeze` is SHALLOW. For a string vocabulary that is total. For an array of
 * OBJECTS, freezing the array leaves every element mutable — so a single "N frozen"
 * count would quietly mean "N arrays, some with mutable contents", which is exactly the
 * vacuous-gate shape this codebase keeps finding. Object-element registries are counted
 * and asserted separately, with one DOCUMENTED exception (see EXPECTED_SHALLOW).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO = path.resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Count floor — provenance is part of the contract
// ---------------------------------------------------------------------------

/**
 * Measured on the integrated contracts tip **bc3596d** (2026-08-01), by the same scan
 * this rail runs. A scan that silently matches ZERO — a moved directory, a changed
 * declaration style, a broken glob — would otherwise pass forever while asserting
 * nothing. That silent-skip class has bitten this repo twice already (the docs-architecture
 * rail SKIPping on a worktree, and the dist-sync sub-check skipping when esbuild was
 * absent), so the floor is mandatory.
 *
 * PROVENANCE MATTERS: a drop below this floor is a REGRESSION TO INVESTIGATE (a registry
 * was deleted, or the scan stopped seeing a directory), NOT a number to retune. Raise it
 * when registries are genuinely added; never lower it to make a red rail green.
 */
const FLOOR = {
  measuredAt: "bc3596d (2026-08-01)",
  totalRegistries: 160, // 168 found at measurement; floored slightly below to absorb legitimate deletions
};

/**
 * The ONE justified shallow freeze. `TOKEN_SHAPE_PATTERNS` holds `/g` RegExps, and
 * `.exec()`/`.test()` WRITE `lastIndex` while scanning. On a frozen RegExp that write
 * throws `TypeError: Cannot assign to read only property 'lastIndex'` in strict mode —
 * verified against Node, not assumed — so deep-freezing would turn the secrets redactor
 * from "scrubs the log" into "throws on the first line". The ARRAY is frozen (no adding
 * or removing patterns, which is the hole that matters); the elements must stay mutable.
 */
const EXPECTED_SHALLOW = new Set(["TOKEN_SHAPE_PATTERNS"]);

// ---------------------------------------------------------------------------
// Source scan
// ---------------------------------------------------------------------------

// Matched against the REPO-RELATIVE path. Matching absolute paths would be a
// self-inflicted silent skip: this repo is routinely checked out INSIDE a
// `.worktrees/` directory, so an absolute `/.worktrees/` test excludes every file and
// the scan finds nothing — which is precisely the vacuous pass the floor exists to catch.
const SKIP = ["node_modules/", "dist/", ".git/", "resources/", "__tests__/"];

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(REPO, full).replace(/\\/g, "/") + (e.isDirectory() ? "/" : "");
    if (SKIP.some((s) => rel.includes(s))) continue;
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

interface Registry {
  file: string;
  name: string;
  frozen: boolean;
  hasObjectElements: boolean;
}

/** Every `export const NAME = [...] as const` in `src`, with its freeze spelling. */
function scanRegistries(): Registry[] {
  const found: Registry[] = [];
  for (const root of ["src", "scripts", "hooks"]) {
    for (const file of walk(path.join(REPO, root))) {
      const src = fs.readFileSync(file, "utf8");
      const re = /export\s+const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]*?)?=\s*/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const name = m[1];
        let i = m.index + m[0].length;
        let frozen = false;
        if (src.startsWith("Object.freeze(", i)) {
          frozen = true;
          i += "Object.freeze(".length;
        }
        while (i < src.length && /\s/.test(src[i])) i++;
        if (src[i] !== "[") continue;
        let depth = 0;
        let j = i;
        for (; j < src.length; j++) {
          if (src[j] === "[") depth++;
          else if (src[j] === "]" && --depth === 0) break;
        }
        const body = src.slice(i, j + 1);
        if (!/^\s*as\s+const/.test(src.slice(j + 1, j + 40))) continue;
        found.push({
          file: path.relative(REPO, file),
          name,
          frozen,
          hasObjectElements: body.includes("{"),
        });
      }
    }
  }
  return found;
}

const registries = scanRegistries();

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

describe("registry freeze — every exported as-const vocabulary is frozen", () => {
  it(`ANTI-VACUITY: the scan finds at least ${FLOOR.totalRegistries} registries (floor from ${FLOOR.measuredAt})`, () => {
    // A scan matching zero must FAIL, not pass. A drop below the floor is a regression
    // to investigate — a deleted registry or a scan that stopped seeing a directory —
    // never a number to retune downward.
    expect(registries.length).toBeGreaterThanOrEqual(FLOOR.totalRegistries);
  });

  it("EVERY registry is frozen at its export site (spelling)", () => {
    const unfrozen = registries
      .filter((r) => !r.frozen)
      .map((r) => `${r.name} (${r.file})`)
      .sort();
    // Each entry here is a closed vocabulary that a caller can widen at runtime.
    expect(unfrozen).toEqual([]);
  });

  it("reports the two populations separately (a shallow freeze over objects is a half-truth)", () => {
    const strings = registries.filter((r) => !r.hasObjectElements);
    const objects = registries.filter((r) => r.hasObjectElements);
    // Both populations must be non-empty, else this split proves nothing.
    expect(strings.length).toBeGreaterThan(100);
    expect(objects.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `[registry-freeze] ${registries.length} registries: ` +
        `${strings.length} string vocabularies (freeze is total), ` +
        `${objects.length} object-element registries (freeze is SHALLOW — elements asserted below)`,
    );
  });

  it("object-element registries deep-freeze their elements, except documented cases", () => {
    for (const reg of registries.filter((r) => r.hasObjectElements && !EXPECTED_SHALLOW.has(r.name))) {
      const src = fs.readFileSync(path.join(REPO, reg.file), "utf8");
      const decl = src.indexOf(`export const ${reg.name}`);
      const open = src.indexOf("[", decl);
      // Balance brackets to isolate the array literal itself — counting braces over a
      // fixed window would sweep in type annotations and neighbouring declarations.
      let depth = 0;
      let close = open;
      for (; close < src.length; close++) {
        if (src[close] === "[") depth++;
        else if (src[close] === "]" && --depth === 0) break;
      }
      const body = src.slice(open, close + 1);
      const literals = (body.match(/\{/g) ?? []).length;
      const frozenLiterals = (body.match(/Object\.freeze\(\{/g) ?? []).length;
      // Every object literal inside the array must itself be frozen, or the array-level
      // freeze is a half-truth: the vocabulary is closed but its contents are not.
      expect({ registry: reg.name, literals, frozenLiterals }).toEqual({
        registry: reg.name,
        literals,
        frozenLiterals: literals,
      });
    }
  });

  it("the documented shallow exception is still exactly what it claims to be", () => {
    // If TOKEN_SHAPE_PATTERNS ever stops holding RegExps, the exception no longer
    // applies and this rail must stop granting it.
    const reg = registries.find((r) => r.name === "TOKEN_SHAPE_PATTERNS");
    expect(reg).toBeDefined();
    expect(reg!.frozen).toBe(true); // the ARRAY is closed even though elements are not
    const src = fs.readFileSync(path.join(REPO, reg!.file), "utf8");
    expect(src).toMatch(/readonly RegExp\[\]/);
    expect(src).toMatch(/lastIndex/); // the justification is present in the source
  });
});

describe("registry freeze — RUNTIME verification over the module public indexes", () => {
  // The static half above tests the SPELLING. This half tests the PROPERTY, on the
  // import-safe surface: a module's public index re-exports its vocabularies and runs
  // no CLI.
  const moduleDirs = fs
    .readdirSync(path.join(REPO, "src", "modules"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  it("there are module indexes to verify (anti-vacuity for this half)", () => {
    expect(moduleDirs.length).toBeGreaterThan(25);
  });

  /**
   * Module indexes that do NOT import cleanly for a reason PRE-EXISTING at the sweep's
   * base commit, verified against bc3596d before being listed here. They are REPORTED,
   * never silently skipped — a silent skip is how a rail quietly stops testing anything.
   * A module that starts failing to import and is not on this list FAILS the rail.
   */
  const KNOWN_UNIMPORTABLE: Record<string, string> = {
    "docs-sync": "TS2308 — three workflows each export `main`; ambiguous re-export. Pre-existing at bc3596d.",
  };

  const results: { module: string; checked: number; unfrozen: string[] }[] = [];
  const unimportable: string[] = [];

  for (const mod of moduleDirs) {
    const indexPath = path.join(REPO, "src", "modules", mod, "index.ts");
    if (!fs.existsSync(indexPath)) continue;

    it(`module "${mod}" exports no unfrozen array at runtime`, () => {
      let mods: Record<string, unknown>;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        mods = require(indexPath) as Record<string, unknown>;
      } catch (err) {
        const known = KNOWN_UNIMPORTABLE[mod];
        // An UNEXPECTED import failure is a rail failure, not a skip: otherwise the
        // runtime half silently shrinks to nothing while still reporting green.
        expect(known ? `known: ${mod}` : `${mod}: ${(err as Error).message.split("\n")[0]}`).toBe(
          `known: ${mod}`,
        );
        unimportable.push(mod);
        return;
      }
      const unfrozen: string[] = [];
      let checked = 0;
      for (const [key, value] of Object.entries(mods)) {
        if (!Array.isArray(value)) continue;
        checked += 1;
        if (!Object.isFrozen(value)) unfrozen.push(key);
      }
      results.push({ module: mod, checked, unfrozen });
      expect(unfrozen).toEqual([]);
    });
  }

  it("REPORTS EVIDENCE STRENGTH — runtime-verified vs spelling-only", () => {
    const runtimeChecked = results.reduce((n, r) => n + r.checked, 0);
    const spellingOnly = registries.length - runtimeChecked;
    // Stated explicitly so nobody reads a green rail as stronger evidence than it is:
    // the runtime half proves frozenness; the static half proves only that the source
    // says Object.freeze.
    // eslint-disable-next-line no-console
    console.log(
      `[registry-freeze] evidence: ${runtimeChecked} verified FROZEN AT RUNTIME ` +
        `(module public indexes), ${spellingOnly} verified BY SPELLING ONLY ` +
        `(scripts/hooks tail + non-index module internals)`,
    );
    if (unimportable.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[registry-freeze] ${unimportable.length} module index(es) not runtime-verified ` +
          `(documented pre-existing import failures): ${unimportable.join(", ")}`,
      );
    }
    expect(runtimeChecked).toBeGreaterThan(100);
  });
});

describe("registry freeze — the exploit this rail closes", () => {
  // A rail that never demonstrates the failure it prevents is a claim, not evidence.
  it("pushing onto a frozen vocabulary THROWS and the predicate does not budge", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dispatch = require(path.join(REPO, "src", "modules", "dispatch", "index.ts")) as {
      EXECUTION_OPERATIONS: readonly string[];
      isExecutionOperation: (v: unknown) => boolean;
    };
    expect(Object.isFrozen(dispatch.EXECUTION_OPERATIONS)).toBe(true);
    expect(dispatch.isExecutionOperation("exfiltrate")).toBe(false);
    expect(() => {
      (dispatch.EXECUTION_OPERATIONS as string[]).push("exfiltrate");
    }).toThrow(TypeError);
    // The predicate's answer is unchanged — the vocabulary stayed closed.
    expect(dispatch.isExecutionOperation("exfiltrate")).toBe(false);
    expect(dispatch.EXECUTION_OPERATIONS).toHaveLength(7);
  });
});
