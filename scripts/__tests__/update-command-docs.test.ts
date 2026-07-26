/**
 * scripts/__tests__/update-command-docs.test.ts
 *
 * UPDATE-COMMAND DOC↔REGISTRY CONSISTENCY RAIL
 * (initiative cross-host-release-distribution, work item xhrd-wi-05 / G5).
 *
 * G5 requires a documented, tested update command for every registry host.
 * "Tested" here means the DOCS are pinned to the REGISTRY: the capability rows
 * (`UPDATE_COMMANDS` + each host's `update.apply`) are the single source of
 * truth for what command a host uses, and this rail fails when README drifts
 * from them — the matrix cannot silently rot the way the pre-G1 docs did.
 *
 * It also asserts COVERAGE: every one of the 16 registry hosts must be
 * accounted for in the README section, either by name or through its class
 * grouping, so a future 17th host cannot ship undocumented.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { HOST_REGISTRY_ROWS } from "../lib/host-registry";
import { UPDATE_COMMANDS } from "../lib/host-capabilities-schema";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const README = fs.readFileSync(path.join(PLUGIN_ROOT, "README.md"), "utf8");

/** The README section under test. */
function updatesSection(): string {
  const start = README.indexOf("Applying updates per host");
  expect(start).toBeGreaterThan(-1);
  // Section runs to the next markdown heading.
  const rest = README.slice(start);
  const end = rest.search(/\n#{2,}\s/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("README documents the registry's own update commands", () => {
  const section = updatesSection();

  it("the Claude pair is the registry's marketplace_cli command, verbatim", () => {
    expect(section).toContain(UPDATE_COMMANDS.marketplace_cli);
  });

  it("the wrapper command is the registry's self_update command, verbatim", () => {
    expect(section).toContain(UPDATE_COMMANDS.self_update);
  });

  it("the file-surface command is the registry's reinstall command, verbatim", () => {
    expect(section).toContain(UPDATE_COMMANDS.reinstall_command);
  });

  it("every registry host is accounted for in the section", () => {
    const rows = HOST_REGISTRY_ROWS as Record<string, { host_id: string; installability: string }>;
    const ids = Object.keys(rows);
    expect(ids).toHaveLength(16); // a 17th host must update this section too
    for (const id of ids) {
      // Word-boundary, not substring: "codex-cli" must not be satisfied by an
      // unrelated mention, and "cursor" must not match inside another word.
      expect(section).toMatch(new RegExp(`(^|[^A-Za-z0-9-])${id}([^A-Za-z0-9-]|$)`));
    }
  });

  it("groups hosts by their ACTUAL apply mechanism, not by guess", () => {
    // Derive each host's apply from the registry and check it sits in the
    // right documented group. Refused surfaces are documented as no-command.
    const rows = HOST_REGISTRY_ROWS as Record<
      string,
      { host_id: string; installability: string; capabilities?: { update?: { apply?: string } } }
    >;
    for (const [id, row] of Object.entries(rows)) {
      const apply = row.capabilities?.update?.apply;
      if (row.installability === "none") {
        // The refused surfaces live in the no-update paragraph.
        expect(section).toMatch(new RegExp(`${id}[\\s\\S]{0,200}no (install and therefore no )?update`));
        continue;
      }
      if (apply === "marketplace_cli") {
        expect(section.indexOf(id)).toBeGreaterThan(-1);
        expect(section.indexOf(id)).toBeLessThan(section.indexOf(UPDATE_COMMANDS.self_update));
      }
      if (apply === "self_update") {
        // Round-1 gate: this branch was MISSING, so all seven wrapper hosts
        // could sit in the wrong group without failing. A wrapper host must
        // appear after the Claude command and before the reinstall block.
        expect(section.indexOf(id)).toBeGreaterThan(section.indexOf(UPDATE_COMMANDS.marketplace_cli));
        expect(section.indexOf(id)).toBeLessThan(section.indexOf(UPDATE_COMMANDS.reinstall_command));
      }
      if (apply === "reinstall_command") {
        // Reinstall-class hosts (file surfaces AND codex-cli after option A)
        // appear after the wrapper block.
        expect(section.indexOf(id)).toBeGreaterThan(section.indexOf(UPDATE_COMMANDS.self_update));
      }
    }
  });
});
