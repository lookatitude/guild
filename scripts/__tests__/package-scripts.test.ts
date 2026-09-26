import * as fs from "node:fs";
import * as path from "node:path";

describe("scripts package command rails", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
  ) as { scripts: Record<string, string> };

  test("module source-of-truth rail checks domain ownership and Claude metadata", () => {
    expect(pkg.scripts["check:module-source-of-truth"]).toContain("check:modules -- --root ..");
    expect(pkg.scripts["check:module-source-of-truth"]).toContain("check:claude-install -- --root ..");
  });

  test("the retired mirror-sync rails are gone (T12: one projector, no byte mirrors)", () => {
    for (const retired of [
      "sync:module-resources",
      "check:module-resources",
      "sync:live-resources",
      "check:live-resources",
    ]) {
      expect(pkg.scripts[retired]).toBeUndefined();
    }
    expect(JSON.stringify(pkg.scripts)).not.toContain("sync-module-resources.ts");
    expect(JSON.stringify(pkg.scripts)).not.toContain("sync-live-resources.ts");
  });

  test("check:modules runs the domain-ownership check", () => {
    expect(pkg.scripts["check:modules"]).toContain("check-domain-ownership.ts");
  });

  test("verify:host-packages is the single projector gate", () => {
    expect(pkg.scripts["verify:host-packages"]).toContain("build-host-packages.ts --check-claude-install");
    expect(pkg.scripts["verify:host-packages"]).toContain("verify-host-packages.ts");
    expect(pkg.scripts["verify:host-packages"]).not.toContain("sync-live-resources.ts");
  });

  test("installer execution rails include fake-host and live-isolated variants", () => {
    expect(pkg.scripts["verify:installer-execution"]).toContain("--execute-fixtures");
    expect(pkg.scripts["verify:installer-live"]).toContain("--execute-live-isolated");
  });
});
