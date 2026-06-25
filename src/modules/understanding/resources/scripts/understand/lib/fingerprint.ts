/**
 * understand/lib/fingerprint.ts
 *
 * Incremental structural fingerprint + staleness change-classifier.
 * Forked Guild-native from Understand-Anything's fingerprint +
 * change-classifier (MIT — see ../LICENSE-attribution.md).
 *
 * Classifier states (codebase-understanding.md §"Refresh/staleness"):
 *   SKIP         — cosmetic / no structural delta (zero LLM tokens)
 *   PARTIAL      — bounded file set changed (re-analyze affected only)
 *   ARCHITECTURE — module/layer topology shifted (re-run stage 4 + deps)
 *   FULL         — fingerprint divergence beyond threshold (full rebuild)
 */

import { createHash } from "crypto";
import { dirname } from "path";
import { analyzeSource } from "./extract";

export interface FileFingerprint {
  contentHash: string;
  functions: string[]; // name(params)->ret signatures
  classes: string[]; // name{methods}
  imports: string[];
  exports: string[];
  hasStructural: boolean;
}
export interface FingerprintStore {
  version: "guild.understand_fingerprint.v1";
  generated_from_commit: string;
  generatedAt: string;
  files: Record<string, FileFingerprint>;
}

export function contentHash(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function fingerprintFile(rel: string, content: string): FileFingerprint {
  const a = analyzeSource(rel, content);
  if (!a) {
    return { contentHash: contentHash(content), functions: [], classes: [], imports: [], exports: [], hasStructural: false };
  }
  return {
    contentHash: contentHash(content),
    functions: a.functions.map((f) => `${f.name}/${f.exported ? "x" : "_"}`).sort(),
    classes: a.classes.map((c) => `${c.name}{${[...c.methods].sort().join(",")}}`).sort(),
    imports: a.imports.map((i) => `${i.source}:${[...i.specifiers].sort().join(",")}`).sort(),
    exports: [...a.exports].sort(),
    hasStructural: true,
  };
}

export type ChangeLevel = "NONE" | "COSMETIC" | "STRUCTURAL";

export function compareFingerprint(a: FileFingerprint, b: FileFingerprint): ChangeLevel {
  if (a.contentHash === b.contentHash) return "NONE";
  if (!a.hasStructural || !b.hasStructural) return "STRUCTURAL";
  const eq = (x: string[], y: string[]) => JSON.stringify(x) === JSON.stringify(y);
  if (
    !eq(a.functions, b.functions) ||
    !eq(a.classes, b.classes) ||
    !eq(a.imports, b.imports) ||
    !eq(a.exports, b.exports)
  ) {
    return "STRUCTURAL";
  }
  return "COSMETIC";
}

export interface ChangeAnalysis {
  newFiles: string[];
  deletedFiles: string[];
  structural: string[];
  cosmetic: string[];
  unchanged: string[];
}

export function buildStore(
  files: Record<string, string>,
  commit: string,
): FingerprintStore {
  const fp: Record<string, FileFingerprint> = {};
  for (const [rel, content] of Object.entries(files)) {
    fp[rel] = fingerprintFile(rel, content);
  }
  return {
    version: "guild.understand_fingerprint.v1",
    generated_from_commit: commit,
    generatedAt: new Date().toISOString(),
    files: fp,
  };
}

export function analyzeChanges(
  store: FingerprintStore,
  current: Record<string, string>,
): ChangeAnalysis {
  const res: ChangeAnalysis = { newFiles: [], deletedFiles: [], structural: [], cosmetic: [], unchanged: [] };
  const prev = store.files;
  for (const rel of Object.keys(prev)) {
    if (!(rel in current)) res.deletedFiles.push(rel);
  }
  for (const [rel, content] of Object.entries(current)) {
    if (!(rel in prev)) {
      res.newFiles.push(rel);
      continue;
    }
    const level = compareFingerprint(prev[rel], fingerprintFile(rel, content));
    if (level === "NONE") res.unchanged.push(rel);
    else if (level === "COSMETIC") res.cosmetic.push(rel);
    else res.structural.push(rel);
  }
  return res;
}

export type ClassifierState = "SKIP" | "PARTIAL" | "ARCHITECTURE" | "FULL";

export interface ClassifyResult {
  state: ClassifierState;
  filesToReanalyze: string[];
  rerunArchitecture: boolean;
  reason: string;
}

function topDir(p: string): string | null {
  const d = dirname(p);
  if (d === "." || d === "") return null;
  return d.split("/")[0] || null;
}

/** Forked thresholds: >30 or >50% → FULL; dir change or >10 → ARCHITECTURE. */
export function classify(
  a: ChangeAnalysis,
  totalFilesInGraph: number,
  allKnownFiles: string[] = [],
): ClassifyResult {
  const structuralCount = a.structural.length + a.newFiles.length + a.deletedFiles.length;
  if (structuralCount === 0) {
    return {
      state: "SKIP",
      filesToReanalyze: [],
      rerunArchitecture: false,
      reason: a.cosmetic.length ? `${a.cosmetic.length} cosmetic-only change(s)` : "no changes",
    };
  }
  const byCount = structuralCount > 30;
  const byPct = totalFilesInGraph > 0 && structuralCount / totalFilesInGraph > 0.5;
  if (byCount || byPct) {
    return {
      state: "FULL",
      filesToReanalyze: [...a.structural, ...a.newFiles],
      rerunArchitecture: true,
      reason: `${structuralCount} structural changes (${byCount && byPct ? ">30 & >50%" : byCount ? ">30 files" : ">50% of project"})`,
    };
  }
  const existingDirs = new Set(allKnownFiles.map(topDir).filter(Boolean) as string[]);
  const dirChange =
    a.newFiles.some((f) => { const d = topDir(f); return d && !existingDirs.has(d); }) ||
    a.deletedFiles.some((f) => { const d = topDir(f); return d && !existingDirs.has(d); });
  if (dirChange || structuralCount > 10) {
    return {
      state: "ARCHITECTURE",
      filesToReanalyze: [...a.structural, ...a.newFiles],
      rerunArchitecture: true,
      reason: dirChange ? "directory/topology shifted" : `${structuralCount} structural changes`,
    };
  }
  return {
    state: "PARTIAL",
    filesToReanalyze: [...a.structural, ...a.newFiles],
    rerunArchitecture: false,
    reason: `${structuralCount} localized structural change(s)`,
  };
}
