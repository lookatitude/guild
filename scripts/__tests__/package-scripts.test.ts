import * as fs from "node:fs";
import * as path from "node:path";

describe("scripts package command rails", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
  ) as { scripts: Record<string, string> };

  test("module source-of-truth rail checks ownership, module resources, live mirrors, and Claude metadata", () => {
    expect(pkg.scripts["check:module-source-of-truth"]).toContain("check:modules -- --root ..");
    expect(pkg.scripts["check:module-source-of-truth"]).toContain("check:module-resources -- --root ..");
    expect(pkg.scripts["check:module-source-of-truth"]).toContain("check:live-resources -- --root ..");
    expect(pkg.scripts["check:module-source-of-truth"]).toContain("check:claude-install -- --root ..");
  });

  test("verify:host-packages enforces generated package source-of-truth mirrors", () => {
    expect(pkg.scripts["verify:host-packages"]).toContain("sync-live-resources.ts --check --root ..");
    expect(pkg.scripts["verify:host-packages"]).toContain("build-host-packages.ts --check-claude-install");
    expect(pkg.scripts["verify:host-packages"]).toContain("verify-host-packages.ts");
  });

  test("installer execution rails include fake-host and live-isolated variants", () => {
    expect(pkg.scripts["verify:installer-execution"]).toContain("--execute-fixtures");
    expect(pkg.scripts["verify:installer-live"]).toContain("--execute-live-isolated");
  });
});
