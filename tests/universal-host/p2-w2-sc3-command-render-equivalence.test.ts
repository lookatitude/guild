/**
 * tests/universal-host/p2-w2-sc3-command-render-equivalence.test.ts
 *
 * AUTHORITATIVE acceptance test for SC-W2-3 (ADR step 16) — per-command
 * render-equivalence across the whole command set.
 *
 * The neutral `guild.command.v1` registry `plugin/command-src/command-registry.json`
 * + the LW2-3 renderer emits the host-native Claude command-file shape such that
 * `renderCommandV1(entry)` is BYTE-IDENTICAL to the committed `plugin/commands/<id>.md`
 * for EVERY command. The registry must also be fail-closed-valid and cover the
 * committed corpus exactly (no missing, no extra).
 *
 * Falsifiable: any entry that drifts from its committed file fails byte equality;
 * any id-set mismatch fails. Anti-vacuity: the corpus is asserted non-empty and the
 * id set is asserted equal to the on-disk `commands/*.md` stems.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  renderCommandV1,
  validateCommandRegistryV1,
  type CommandRegistryV1,
} from "../../scripts/lib/command-registry";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const COMMANDS_DIR = path.join(PLUGIN_ROOT, "commands");
const REGISTRY_PATH = path.join(PLUGIN_ROOT, "command-src", "command-registry.json");

const REGISTRY = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as CommandRegistryV1;

function committedCommandMd(id: string): string {
  return fs.readFileSync(path.join(COMMANDS_DIR, `${id}.md`), "utf8");
}

function committedCommandIds(): string[] {
  return fs
    .readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

describe("SC-W2-3 — command render-equivalence over the committed corpus", () => {
  it("the neutral registry is fail-closed-valid", () => {
    expect(validateCommandRegistryV1(REGISTRY).valid).toBe(true);
  });

  it("covers EXACTLY the committed commands/*.md id set (anti-vacuity)", () => {
    const ondisk = committedCommandIds();
    expect(ondisk.length).toBeGreaterThan(0);
    expect(REGISTRY.commands.map((c) => c.id).sort()).toEqual(ondisk);
  });

  for (const entry of REGISTRY.commands) {
    it(`renders commands/${entry.id}.md BYTE-IDENTICAL`, () => {
      const committed = committedCommandMd(entry.id);
      const rendered = renderCommandV1(entry);
      expect(rendered).toBe(committed);
      expect(Buffer.from(rendered)).toEqual(Buffer.from(committed));
    });
  }
});
