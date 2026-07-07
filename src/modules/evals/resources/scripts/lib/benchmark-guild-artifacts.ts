/**
 * scripts/lib/benchmark-guild-artifacts.ts
 *
 * Host-neutral `.guild/` artifact inventory consumed by benchmark fixtures.
 * This intentionally reads only sanitized/shareable surfaces for R6; raw
 * trace-bearing run records wait for the R7 scrub/export path.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type BenchmarkGuildArtifactKind = "agent" | "skill" | "tool" | "wiki" | "initiative" | "sanitized-run-stub";

export interface BenchmarkGuildArtifact {
  kind: BenchmarkGuildArtifactKind;
  path: string;
  host: string | null;
  sanitized: boolean;
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  return out.sort();
}

function addFiles(root: string, relDir: string, kind: BenchmarkGuildArtifactKind, out: BenchmarkGuildArtifact[]): void {
  for (const file of walkFiles(path.join(root, ".guild", relDir))) {
    out.push({ kind, path: path.relative(root, file), host: null, sanitized: true });
  }
}

function runStubIsSanitized(runYaml: string): boolean {
  try {
    const text = fs.readFileSync(runYaml, "utf8");
    return /(^|\n)\s*sanitized:\s*true\s*(\n|$)/.test(text);
  } catch {
    return false;
  }
}

export function collectBenchmarkGuildArtifacts(root: string): BenchmarkGuildArtifact[] {
  const out: BenchmarkGuildArtifact[] = [];
  addFiles(root, "agents", "agent", out);
  addFiles(root, "skills", "skill", out);
  addFiles(root, "tools", "tool", out);
  addFiles(root, "wiki", "wiki", out);
  addFiles(root, "initiatives", "initiative", out);

  const runsDir = path.join(root, ".guild", "runs");
  if (fs.existsSync(runsDir)) {
    for (const ent of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const runYaml = path.join(runsDir, ent.name, "run.yaml");
      if (runStubIsSanitized(runYaml)) {
        out.push({
          kind: "sanitized-run-stub",
          path: path.relative(root, runYaml),
          host: null,
          sanitized: true,
        });
      }
    }
  }

  return out.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
}
