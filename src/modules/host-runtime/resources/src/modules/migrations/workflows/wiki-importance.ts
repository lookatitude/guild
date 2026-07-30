import * as path from "node:path";
import { parseYaml } from "../../state";

export const STRUCTURAL_BASENAMES = new Set([
  "index.md", "readme.md", "log.md", "query.md", "transfer-manifest.md",
]);
const PROVENANCE_SEGMENTS = new Set(["research", "ideation", "sources"]);
const PROVENANCE_VALUES = new Set(["provenance", "exploratory", "research", "ideation", "source"]);

export interface FmSplit { fmLines: string[] | null; body: string }
export function splitFrontmatter(content: string): FmSplit {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return { fmLines: null, body: content };
  const end = lines.slice(1).findIndex((line) => line.trim() === "---");
  return end < 0
    ? { fmLines: null, body: content }
    : { fmLines: lines.slice(1, end + 1), body: lines.slice(end + 2).join("\n") };
}
export function fmValue(lines: string[] | null, key: string): string | null {
  if (!lines) return null;
  const parsed = parseYaml(lines.join("\n"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = (parsed as Record<string, unknown>)[key];
  return value === undefined || value === null ? null : String(value);
}
export function isProvenance(relInWiki: string, lines: string[] | null): boolean {
  const segments = relInWiki.split(path.sep).slice(0, -1).map((value) => value.toLowerCase());
  if (segments.some((value) => PROVENANCE_SEGMENTS.has(value))) return true;
  return ["type", "category"].some((key) => {
    const value = fmValue(lines, key)?.toLowerCase();
    return value !== undefined && value !== null && PROVENANCE_VALUES.has(value);
  });
}
