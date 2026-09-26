/**
 * R67 / KTD55: every writer that can create `.guild/agents/<role>.md` goes
 * through `gateProfileCreation`. Two halves:
 *
 *  - the gate itself (class-scoped, unknown class refused);
 *  - a lint-style scan of src/domains, src/adapters, scripts and hooks: a source
 *    file that names the project agents tree AND writes files must call the seam,
 *    or sit on the reviewed exemption list below with the reason it cannot
 *    create a profile. Planted writers prove the scan is not vacuous.
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { gateProfileCreation } from ".";

const PLUGIN_ROOT = path.resolve(import.meta.dir, "../../..");
const SCAN_ROOTS = ["src/domains", "src/adapters", "scripts", "hooks"];
const SKIP_DIRS = new Set(["node_modules", "dist", "fixtures"]);

/** Names the PROJECT agents tree (`.guild/agents`), in any of the spellings the tree uses. */
const AGENTS_TREE_REF = [
  /\.guild[\\/]agents/,
  /["'`]\.guild["'`]\s*,\s*["'`]agents["'`]/,
  /definition\(\s*["'`]agents["'`]/,
  /\bguild\w*\s*,\s*["'`]agents["'`]/i,
];
const FILE_WRITE =
  /\b(writeFileSync|appendFileSync|copyFileSync|cpSync|renameSync|symlinkSync|linkSync|atomicWrite\w*|writeFile|createWriteStream)\s*\(/;
const SEAM_CALL = /\bgateProfileCreation\s*\(/;

/** Reviewed: these name the agents tree and write files, but never create a profile. */
const NON_CREATING_WRITERS: Record<string, string> = {
  "src/domains/lifecycle/run-lifecycle.ts": "hashes .guild/agents/registry.yaml for the run snapshot; its writes are run records",
  "src/domains/state/upgrade-steps.ts": "deletes the DERIVED agents/registry.yaml; never writes a profile",
  "src/domains/state/upgrade-runner.ts": "reads profiles to prove the upgrade left them byte-identical",
  "scripts/lib/capability/profile-emit.ts": "hashes the agents tree before/after Learn; its writes are the capability profile",
};

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:\\])\/\/.*$/, "$1"))
    .join("\n");
}

/** Classify one source text: not a writer of the agents tree, gated, or ungated. */
function classify(text: string): "none" | "gated" | "ungated" {
  const code = stripComments(text);
  if (!AGENTS_TREE_REF.some((re) => re.test(code)) || !FILE_WRITE.test(code)) return "none";
  return SEAM_CALL.test(code) ? "gated" : "ungated";
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(abs, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) out.push(abs);
  }
  return out;
}

function scanTree(): { gated: string[]; ungated: string[] } {
  const gated: string[] = [];
  const ungated: string[] = [];
  for (const top of SCAN_ROOTS) {
    for (const abs of sourceFiles(path.join(PLUGIN_ROOT, top))) {
      const rel = path.relative(PLUGIN_ROOT, abs).split(path.sep).join("/");
      const verdict = classify(fs.readFileSync(abs, "utf8"));
      if (verdict === "gated") gated.push(rel);
      if (verdict === "ungated") ungated.push(rel);
    }
  }
  return { gated: gated.sort(), ungated: ungated.sort() };
}

describe("gateProfileCreation — the one .guild/agents creation seam (R67)", () => {
  it("lets product and init create, and refuses debug, research and ops", () => {
    for (const cls of ["product", "init"]) {
      expect(gateProfileCreation({ workflow_class: cls, role: "qa", writer: "t" }).ok).toBe(true);
    }
    for (const cls of ["debug", "research", "ops"]) {
      const g = gateProfileCreation({ workflow_class: cls, role: "qa", writer: "t" });
      expect(g.ok).toBe(false);
      if (g.ok) throw new Error("unreachable");
      expect(g.reason.startsWith(`t: class '${cls}' does not mint a delivery roster (R67)`)).toBe(true);
    }
  });

  it("refuses a writer that cannot name the class, and a string that is not a class", () => {
    for (const cls of [null, undefined, "", "Product", "build"]) {
      const g = gateProfileCreation({ workflow_class: cls, role: "qa", writer: "t" });
      expect(g.ok).toBe(false);
      if (g.ok) throw new Error("unreachable");
      expect(g.reason.startsWith("t: no workflow class bound")).toBe(true);
    }
  });
});

describe("no .guild/agents writer bypasses the creation seam (R67 guard)", () => {
  const live = scanTree();

  it("every live writer of the agents tree calls gateProfileCreation or is a reviewed non-creator", () => {
    const offenders = live.ungated.filter((rel) => !(rel in NON_CREATING_WRITERS));
    expect(offenders).toEqual([]);
    expect(live.gated).toEqual([
      "scripts/lib/capability/adoption-migrate.ts",
      "scripts/lib/roster.ts",
      "src/domains/evolve/evolve-apply.ts",
    ]);
  });

  it("the exemption list is not stale: each entry is still an ungated writer", () => {
    expect(Object.keys(NON_CREATING_WRITERS).sort()).toEqual(
      live.ungated.filter((rel) => rel in NON_CREATING_WRITERS),
    );
  });

  it("PLANTED: a new writer of the agents tree with no seam call is flagged", () => {
    const planted = `import * as fs from "fs";\nimport * as path from "path";\nexport function mint(root: string) {\n  fs.writeFileSync(path.join(root, ".guild", "agents", "x.md"), "---\\n---\\n");\n}\n`;
    expect(classify(planted)).toBe("ungated");
    expect(classify(`const t = \`.guild/agents/\${id}.md\`;\natomicWriteDurable(t, body);\n`)).toBe("ungated");
    expect(classify(`const d = storage.definition("agents");\nfs.copyFileSync(src, d + "/x.md");\n`)).toBe("ungated");
  });

  it("PLANTED CONTROL: adoption with its seam call removed is flagged; a commented-out call does not count", () => {
    const real = fs.readFileSync(path.join(PLUGIN_ROOT, "scripts/lib/capability/adoption-migrate.ts"), "utf8");
    expect(classify(real)).toBe("gated");
    const removed = real.replace(/gateProfileCreation\s*\(/g, "noGate(");
    expect(classify(removed)).toBe("ungated");
    const commented = removed.replace("noGate(", "// gateProfileCreation(\nnoGate(");
    expect(classify(commented)).toBe("ungated");
  });
});
