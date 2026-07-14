/**
 * read-guild-config-import.test.ts
 *
 * Regression for the U2 round-3 codex finding: read-guild-config.ts must NOT run its CLI
 * main() when IMPORTED (config-cmd.ts imports its exported validators). Without the
 * `if (require.main === module)` guard, importing it would parse the importer's argv and
 * pollute stdout. This pins the guard.
 */

import { spawnSync } from "child_process";
import * as path from "path";

const SCRIPT = path.resolve(__dirname, "../read-guild-config.ts");

describe("read-guild-config.ts — import is side-effect-free (require.main guard)", () => {
  test("importing the module does NOT run main() / emit stdout, and exports the validators", () => {
    // A tiny program that imports read-guild-config and touches an export. If main() ran on
    // import it would write the resolved-config JSON to stdout; the guard must prevent that.
    const program =
      `const rgc = require(${JSON.stringify(SCRIPT)});` +
      `if (typeof rgc.validateModels !== "function") { console.error("MISSING_EXPORT"); process.exit(3); }` +
      `process.stderr.write("ok");`;
    const r = spawnSync("npx", ["tsx", "-e", program], {
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      timeout: 120_000,
    });
    expect(r.stdout ?? "").toBe(""); // main() did not run → no JSON on stdout
    expect(r.stderr ?? "").toContain("ok"); // export present, program completed
    expect(r.status).toBe(0);
  });

  test("running the script directly STILL executes the CLI (emits resolved JSON)", () => {
    const r = spawnSync("npx", ["tsx", SCRIPT, "--cwd", path.resolve(__dirname, "..")], {
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      timeout: 120_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout ?? "").toContain("{"); // direct invocation prints the resolved config
  });
});
