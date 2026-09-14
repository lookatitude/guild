import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { lintCommsFormat } from "../comms-format-lint";

// A hand-rolled frontmatter splitter — check-b idiom (1). Assembled at runtime so
// this test file does not itself carry the idiom the lint greps for.
const HAND_ROLLED_YAML = ["const parts = text.spl", 'it("---");\n'].join("");

function writeTemp(relPath: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-gen-"));
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, HAND_ROLLED_YAML, "utf8");
  return abs;
}

describe("generated build-output exemption (dist/ and runtime/)", () => {
  it("does NOT flag a compiled bundle under runtime/ (the committed Node graph, KTD29)", () => {
    const findings = lintCommsFormat({ paths: [writeTemp("plugin/runtime/scripts/config-cmd.js")] });
    expect(findings.filter((f) => f.check === "b")).toHaveLength(0);
  });

  it("does NOT flag a compiled bundle under hooks/dist/", () => {
    const findings = lintCommsFormat({ paths: [writeTemp("plugin/hooks/dist/x.js")] });
    expect(findings.filter((f) => f.check === "b")).toHaveLength(0);
  });

  it("STILL flags the same reader in authored source (anti-vacuity)", () => {
    const findings = lintCommsFormat({ paths: [writeTemp("plugin/scripts/lib/read-thing.ts")] });
    expect(findings.filter((f) => f.check === "b").length).toBeGreaterThan(0);
  });
});
