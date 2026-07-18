/**
 * Regression: esbuild CJS bundling makes every inlined module's
 * `require.main === module` guard true inside hook bundles, which once fired
 * four CLI entry points (index-migrate, advisory-record, read-guild-config,
 * classify-proposal) on every hook event (~5.7KB stdout per prompt).
 *
 * The fix gates each CLI on the exact argv[1] BASENAME. This suite runs the
 * REAL dist bundles (not source imports — an ordinary import test cannot
 * reproduce the bundling failure) from adversarially-named parent directories
 * (the exact bypass codex demonstrated: a parent dir named after a CLI
 * satisfied the old substring regex) and asserts the leak markers stay absent
 * while intentional hook stdout (using-guild-bootstrap's SessionStart context)
 * is preserved.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIST = join(__dirname, "..", "dist");
const LEAK_MARKERS = [
  "advisory-example-001", // advisory-record fixture skeleton
  "[index-migrate]", // index-migrate CLI status line
  '"schema_version": "guild.advisory.v1"', // advisory JSON body
  '"verdict":', // classify-proposal CLI JSON
  '"_rigor_expanded"', // resolved-config dump tail marker
];
// Parent dir names matching each CLI's guard vocabulary — the demonstrated bypass.
const ADVERSARIAL_PARENTS = [
  "index-migrate",
  "advisory-record",
  "read-guild-config",
  "classify-proposal",
];

const SILENT_BUNDLES = readdirSync(DIST).filter(
  (f) => f.endsWith(".js") && f !== "using-guild-bootstrap.js",
);

function runBundle(bundlePath: string): string {
  try {
    return execFileSync(process.execPath, [bundlePath], {
      input: "",
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, GUILD_HOOK_TEST: "1" },
    });
  } catch (err) {
    // Hooks may exit non-zero on empty stdin; stdout is still what we assert on.
    const e = err as { stdout?: string };
    return e.stdout ?? "";
  }
}

describe("hook bundles never fire bundled CLI entry points", () => {
  let scratch: string;
  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "bundle-cli-leak-"));
  });
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test.each(ADVERSARIAL_PARENTS)(
    "silent bundles emit no leak markers under adversarial parent dir %s/",
    (parent) => {
      const dir = join(scratch, parent);
      mkdirSync(dir, { recursive: true });
      for (const bundle of SILENT_BUNDLES) {
        const copied = join(dir, bundle);
        copyFileSync(join(DIST, bundle), copied);
        const out = runBundle(copied);
        for (const marker of LEAK_MARKERS) {
          if (out.includes(marker)) {
            throw new Error(
              `${bundle} under ${parent}/ leaked marker ${JSON.stringify(marker)} (${out.length} bytes)`,
            );
          }
        }
      }
    },
  );

  test("using-guild-bootstrap keeps its intentional SessionStart stdout", () => {
    const out = runBundle(join(DIST, "using-guild-bootstrap.js"));
    expect(out).toContain("using-guild"); // contract: it MUST emit context
    for (const marker of LEAK_MARKERS) {
      expect(out).not.toContain(marker);
    }
  });

  test("anti-vacuity: the marker list detects the real fixture string", () => {
    // Guards the test itself: if the fixture is ever renamed, this fails loudly
    // instead of the leak assertions passing vacuously.
    const grep = execFileSync(
      "grep",
      ["-rl", "advisory-example-001", DIST],
      { encoding: "utf8" },
    );
    expect(grep.trim().length).toBeGreaterThan(0);
  });
});
