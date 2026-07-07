/**
 * scripts/__tests__/command-registry-source.test.ts
 *
 * Anti-vacuous parity suite for the NEUTRAL command-registry SOURCE authored by
 * lane LW2-4 (command-builder) at `plugin/command-src/command-registry.json`
 * (spec SC-W2-3 / ADR step 16). SC-W2-3 ownership is LW2-4 (this lane), so the
 * lane ships its own anti-vacuous proof rather than deferring it.
 *
 * Distinct from `command-registry.test.ts` (LW2-3): that suite extracts entries
 * FRESH from the committed corpus each run (the renderer's self-proof). THIS suite
 * loads the AUTHORED source FILE off disk and proves the file itself:
 *   1. validates under the fail-closed registry validator,
 *   2. renders BYTE-IDENTICAL to every committed `commands/<id>.md`, and
 *   3. covers EXACTLY the committed command-id set (no missing / no extra).
 * If the authored source ever drifts from the corpus, (2)/(3) go RED — the gap the
 * fresh-extract suite cannot see.
 *
 * Anti-vacuous BOTH directions: a mutated source value (description / body / tools)
 * breaks byte-identity, and a removed/added entry breaks the id-set equality — so a
 * source that does not actually reproduce the corpus cannot pass.
 *
 * HARD INVARIANT under test: renders go to a temp/staging dir ONLY via
 * `resolveStagingPath` (R2 / SC-W2-5). No test writes into the live surface; the
 * committed files are read solely as comparison oracles.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  CommandRegistryV1,
  CommandV1,
  validateCommandRegistryV1,
  renderCommandV1,
  resolveStagingPath,
  COMMAND_SCHEMA_VERSION,
} from "../lib/command-registry";

const COMMANDS_DIR = path.resolve(__dirname, "..", "..", "commands");
const SOURCE_PATH = path.resolve(__dirname, "..", "..", "command-src", "command-registry.json");

function committedStems(): string[] {
  return fs
    .readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

function loadSource(): CommandRegistryV1 {
  return JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8")) as CommandRegistryV1;
}

// ---------------------------------------------------------------------------
// The authored source validates fail-closed
// ---------------------------------------------------------------------------

describe("authored command-registry source — schema validity", () => {
  it("exists and parses as a guild.command.v1 registry", () => {
    expect(fs.existsSync(SOURCE_PATH)).toBe(true);
    const reg = loadSource();
    expect(reg.schema_version).toBe(COMMAND_SCHEMA_VERSION);
    expect(Array.isArray(reg.commands)).toBe(true);
  });

  it("passes the fail-closed registry validator with zero errors", () => {
    expect(validateCommandRegistryV1(loadSource())).toEqual({ valid: true, errors: [] });
  });
});

// ---------------------------------------------------------------------------
// The authored source covers EXACTLY the committed id set (completeness)
// ---------------------------------------------------------------------------

describe("authored command-registry source — covers exactly the committed corpus", () => {
  it("declares the same command-id set as commands/*.md (no missing, no extra)", () => {
    const sourceIds = loadSource()
      .commands.map((c) => c.id)
      .sort();
    expect(sourceIds).toEqual(committedStems());
    // anti-vacuity floor: the corpus is the full 20-command surface, incl. the
    // tricky-quoting oracles (escaped quotes / long desc / empty argument-hint).
    expect(sourceIds.length).toBeGreaterThanOrEqual(20);
    for (const must of ["status", "config", "fix", "initiative", "wiki", "audit"]) {
      expect(sourceIds).toContain(must);
    }
  });
});

// ---------------------------------------------------------------------------
// Per-command render-equivalence — the authored entry renders BYTE-IDENTICAL
// to its committed file (the SC-W2-3 parity proof for the SOURCE artifact)
// ---------------------------------------------------------------------------

describe("authored command-registry source — render(entry) === committed bytes", () => {
  const reg = loadSource();
  for (const entry of reg.commands) {
    it(`commands/${entry.id}.md renders byte-for-byte from the source entry`, () => {
      const committedPath = path.join(COMMANDS_DIR, `${entry.id}.md`);
      const original = fs.readFileSync(committedPath, "utf8");
      const originalBuf = fs.readFileSync(committedPath); // raw bytes

      const rendered = renderCommandV1(entry);
      expect(rendered).toBe(original);
      expect(Buffer.from(rendered, "utf8").equals(originalBuf)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Anti-vacuity (both directions) — a drifted source MUST fail
// ---------------------------------------------------------------------------

describe("authored command-registry source — anti-vacuity (a drifted source fails)", () => {
  function entryFor(id: string): CommandV1 {
    const e = loadSource().commands.find((c) => c.id === id);
    if (!e) throw new Error(`fixture id not found in source: ${id}`);
    return e;
  }

  it("a mutated description no longer renders byte-identical", () => {
    const e = entryFor("status");
    const original = fs.readFileSync(path.join(COMMANDS_DIR, "status.md"), "utf8");
    const mutated: CommandV1 = { ...e, description: e.description + " (drift)" };
    expect(renderCommandV1(mutated)).not.toBe(original);
  });

  it("a mutated body no longer renders byte-identical", () => {
    const e = entryFor("status");
    const original = fs.readFileSync(path.join(COMMANDS_DIR, "status.md"), "utf8");
    const mutated: CommandV1 = { ...e, body: e.body.replace(/\n$/, " drift\n") };
    expect(renderCommandV1(mutated)).not.toBe(original);
  });

  it("a mutated allowed_tools list no longer renders byte-identical", () => {
    const e = entryFor("status");
    const original = fs.readFileSync(path.join(COMMANDS_DIR, "status.md"), "utf8");
    const mutated: CommandV1 = { ...e, allowed_tools: [...e.allowed_tools, "Bogus"] };
    expect(renderCommandV1(mutated)).not.toBe(original);
  });

  it("dropping a command from the source breaks id-set equality", () => {
    const reg = loadSource();
    const dropped = reg.commands.filter((c) => c.id !== "status").map((c) => c.id).sort();
    expect(dropped).not.toEqual(committedStems());
  });
});

// ---------------------------------------------------------------------------
// HARD INVARIANT — the source renders ONLY to a staging tree, never live
// ---------------------------------------------------------------------------

describe("authored command-registry source — renders to staging only (R2)", () => {
  it("renders every entry into a temp staging dir, byte-identical, then cleans up", () => {
    const reg = loadSource();
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), "lw2-4-src-"));
    try {
      for (const entry of reg.commands) {
        const out = resolveStagingPath(stage, entry.id); // THROWS on a live tree
        fs.writeFileSync(out, renderCommandV1(entry));
        const committed = fs.readFileSync(path.join(COMMANDS_DIR, `${entry.id}.md`));
        expect(fs.readFileSync(out).equals(committed)).toBe(true);
      }
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  });

  it("resolveStagingPath refuses to target the live commands/ tree", () => {
    expect(() => resolveStagingPath(COMMANDS_DIR, "status")).toThrow(/live "commands\/" tree/);
  });
});
