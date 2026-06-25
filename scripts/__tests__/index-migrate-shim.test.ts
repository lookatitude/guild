import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../index-migrate";
import * as moduleImpl from "../../src/modules/migrations/workflows/index-migrate";

describe("index-migrate compatibility shim", () => {
  test("scripts/index-migrate re-exports src/modules/migrations", () => {
    expect(shim.CURRENT_SCHEMA_VERSION).toBe(moduleImpl.CURRENT_SCHEMA_VERSION);
    expect(shim.runMigrations).toBe(moduleImpl.runMigrations);
    expect(shim.resolveGuildRoot).toBe(moduleImpl.resolveGuildRoot);
    expect(shim.runIndexMigrateCli).toBe(moduleImpl.runIndexMigrateCli);
  });

  test("legacy path stays a thin public and CLI wrapper", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/index-migrate.ts"), "utf8");
    const modulePath = fs.readFileSync(
      path.join(repoRoot, "src/modules/migrations/workflows/index-migrate.ts"),
      "utf8",
    );

    expect(oldPath).toMatch(/src\/modules\/migrations\/workflows\/index-migrate/);
    expect(oldPath).not.toMatch(/export\s+function\s+runMigrations/);
    expect(oldPath).toMatch(/runIndexMigrateCli\(\)/);
    expect(modulePath).toMatch(/export\s+function\s+runMigrations/);
    expect(modulePath).toMatch(/export\s+function\s+runIndexMigrateCli/);
  });
});
