/**
 * scripts/dot-guild/convert/detect.ts — the SC-1 detection probe (§1).
 *
 * Implements the `schema_version` probe over the 11 ordered targets (P1–P11),
 * builds the M1 (v1) / M2 (v2) evidence sets, and classifies into the 5 states
 * with precedence `corrupt > mixed > {v1,v2} > none` (§1.3).
 *
 * Read-only / side-effect-free (R4). NEVER writes, normalizes, or touches a file.
 *
 * Zero-false-positive invariant (§1.1): a `.vN` schema stamp is the SCHEMA
 * version, NOT Guild-v1 — it is M2 (v2-lineage), never M1. Absence of markers ⇒
 * `none`, never `v1`. `.guild/.backup-v1-*` and `.unmigrated-v1.json` are excluded
 * from v1 evidence (CF-W1b-2 / CF-W1b-1c).
 */

import * as path from "path";
import type { Fs, DetectResult, Evidence } from "./types";
import { parseJson, parseYaml, extractSchemaVersion } from "./seams";

type DirEntry = { name: string; isDirectory: boolean; isFile: boolean };

/** R2 / P10 stamp regex — the v2-lineage guard. Family segment allows digits. */
export const SCHEMA_STAMP_RE = /^guild\.[a-z0-9_]+\.v\d+$/;
/** P10 in-content scan (head-bounded) — same family, quote/colon tolerant. */
const P10_SCAN_RE = /schema_version["':\s]+guild\.[a-z0-9_]+\.v\d+/;

/** v2 schema stamps that are positive M2 evidence when found via P3–P8. */
const V2_STAMPS = new Set([
  "guild.run.v1",
  "guild.provenance.v1",
  "guild.initiatives_registry.v1",
  "guild.workspace.v1",
  "guild.host_capability.v1",
  "guild.reflection.v1",
]);

/** P10 traversal exclusions (CF-W1b-8): backups, telemetry payloads. */
const P10_HEAD_BYTES = 4096;
const P10_EXTS = new Set([".json", ".yaml", ".yml", ".md"]);

function isBackupDir(name: string): boolean {
  return name.startsWith(".backup-v1-");
}
function isReportFile(name: string): boolean {
  return name.startsWith(".migration-report-");
}

/** Recursively list files under a dir using the injected Fs, with an exclusion predicate. */
function walk(fs: Fs, dir: string, excludeDir: (name: string) => boolean, base: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  let entries: DirEntry[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory) {
      if (excludeDir(e.name)) continue;
      out.push(...walk(fs, full, excludeDir, base));
    } else if (e.isFile) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The §1.4 / §2.0a-aware key scanner. Given a parsed config object, return the
 * v1-only keys present. Detects: codex_review (bool), auto_approve as a STRING
 * (v1 form — v2 is an array), defaults.agent_team.
 */
export function v1KeysIn(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];
  const rec = obj as Record<string, unknown>;
  const hits: string[] = [];
  if ("codex_review" in rec) hits.push("codex_review");
  if (typeof rec["auto_approve"] === "string") hits.push("auto_approve");
  const defaults = rec["defaults"];
  if (defaults && typeof defaults === "object" && "agent_team" in (defaults as Record<string, unknown>)) {
    hits.push("defaults.agent_team");
  }
  return hits;
}

interface Probe {
  fs: Fs;
  guildDir: string;
  evidence: Evidence[];
  unparseable: Array<{ path: string; authoritative: boolean }>;
}

function relTo(guildDir: string, p: string): string {
  return path.relative(guildDir, p);
}

/** Read + parse a JSON/YAML authoritative artifact; record unparseable if it fails. */
function readParsed(
  pr: Probe,
  p: string,
  kind: "json" | "yaml",
  authoritative: boolean
): unknown | undefined {
  if (!pr.fs.existsSync(p)) return undefined;
  let content: string;
  try {
    content = pr.fs.readFileSync(p);
  } catch {
    pr.unparseable.push({ path: relTo(pr.guildDir, p), authoritative });
    return undefined;
  }
  const res = kind === "json" ? parseJson(content) : parseYaml(content);
  if (!res.ok) {
    pr.unparseable.push({ path: relTo(pr.guildDir, p), authoritative });
    return undefined;
  }
  return res.value;
}

/**
 * The probe (§1.2 / §1.3). Returns the 5-state classification + evidence.
 * Read-only.
 */
export function detect(fs: Fs, guildDir: string): DetectResult {
  const evidence: Evidence[] = [];
  const unparseable: Array<{ path: string; authoritative: boolean }> = [];
  const pr: Probe = { fs, guildDir, evidence, unparseable };

  const addM1 = (p: string, marker: string, note?: string) =>
    evidence.push({ path: relTo(guildDir, p), marker, contributes: "M1", note });
  const addM2 = (p: string, marker: string, note?: string) =>
    evidence.push({ path: relTo(guildDir, p), marker, contributes: "M2", note });

  // §1.3 step 0 — absent or empty ⇒ none.
  if (!fs.existsSync(guildDir)) {
    return { classification: "none", m1: false, m2: false, hasUnparseable: false, evidence, unparseable };
  }
  const topFiles = walk(fs, guildDir, (name) => isBackupDir(name), guildDir);
  if (topFiles.length === 0) {
    return { classification: "none", m1: false, m2: false, hasUnparseable: false, evidence, unparseable };
  }

  const j = (rel: string) => path.join(guildDir, rel);

  // ── P1: settings.json — existence ⇒ M2; parse for v1-only keys ⇒ M1.
  {
    const p = j("settings.json");
    if (fs.existsSync(p)) {
      addM2(p, "P1", "settings.json exists (v2-only file)");
      const parsed = readParsed(pr, p, "json", true);
      for (const k of v1KeysIn(parsed)) addM1(p, "P1", `v1-only key: ${k}`);
    }
  }

  // ── P9: settings.local.json — existence ⇒ M2 (v2-era surface); v1 keys ⇒ M1.
  {
    const p = j("settings.local.json");
    if (fs.existsSync(p)) {
      addM2(p, "P9", "settings.local.json exists (v2-era surface — F2)");
      const parsed = readParsed(pr, p, "json", true);
      for (const k of v1KeysIn(parsed)) addM1(p, "P9", `local-only v1 key: ${k}`);
    }
  }

  // ── P2: config.yml — existence ⇒ M1 (v1-only file).
  {
    const p = j("config.yml");
    if (fs.existsSync(p)) {
      addM1(p, "P2", "config.yml exists (v1-only file)");
      // Parse it so a truncated config.yml registers as authoritative-unparseable.
      readParsed(pr, p, "yaml", true);
    }
  }

  // ── P3: initiatives-registry.yaml schema_version.
  {
    const p = j(path.join("indexes", "initiatives-registry.yaml"));
    const parsed = readParsed(pr, p, "yaml", true);
    const sv = svOf(parsed);
    if (sv) {
      if (V2_STAMPS.has(sv) || SCHEMA_STAMP_RE.test(sv)) addM2(p, "P3", `schema_version: ${sv}`);
    }
  }

  // ── P4: workspace.json schema_version: guild.workspace.v1.
  {
    const p = j("workspace.json");
    const parsed = readParsed(pr, p, "json", true);
    const sv = svOf(parsed);
    if (sv && (sv === "guild.workspace.v1" || SCHEMA_STAMP_RE.test(sv))) addM2(p, "P4", `schema_version: ${sv}`);
  }

  // ── P5/P6: runs/*/run.yaml (v2) + runs/*/metadata.json without run.yaml (v1).
  {
    const runsDir = j("runs");
    if (fs.existsSync(runsDir)) {
      let runEntries: DirEntry[];
      try {
        runEntries = fs.readdirSync(runsDir);
      } catch {
        runEntries = [];
      }
      for (const e of runEntries) {
        if (!e.isDirectory) continue;
        const runDir = path.join(runsDir, e.name);
        const runYaml = path.join(runDir, "run.yaml");
        const meta = path.join(runDir, "metadata.json");
        const hasRunYaml = fs.existsSync(runYaml);
        if (hasRunYaml) {
          const parsed = readParsed(pr, runYaml, "yaml", true);
          const sv = svOf(parsed);
          // R1: run.yaml stamp is authoritative regardless of sibling events.ndjson.
          if (sv === "guild.run.v1" || (sv && SCHEMA_STAMP_RE.test(sv))) addM2(runYaml, "P5", `schema_version: ${sv}`);
          else addM2(runYaml, "P5", "run.yaml present (v2 run manifest)");
        }
        // P6: metadata.json WITHOUT a sibling run.yaml ⇒ v1 run signal.
        if (fs.existsSync(meta) && !hasRunYaml) {
          addM1(meta, "P6", "metadata.json without sibling run.yaml (v1 run record)");
          readParsed(pr, meta, "json", true); // authoritative parse check
        }
      }
    }
  }

  // ── P7: hosts/*/capability.json schema_version: guild.host_capability.v1.
  {
    const hostsDir = j("hosts");
    if (fs.existsSync(hostsDir)) {
      let hostEntries: DirEntry[];
      try {
        hostEntries = fs.readdirSync(hostsDir);
      } catch {
        hostEntries = [];
      }
      for (const e of hostEntries) {
        if (!e.isDirectory) continue;
        const cap = path.join(hostsDir, e.name, "capability.json");
        const parsed = readParsed(pr, cap, "json", false);
        const sv = svOf(parsed);
        if (sv && (sv === "guild.host_capability.v1" || SCHEMA_STAMP_RE.test(sv))) addM2(cap, "P7", `schema_version: ${sv}`);
      }
    }
  }

  // ── P8: reflections/*.md frontmatter (absence neutral).
  {
    const refDir = j("reflections");
    if (fs.existsSync(refDir)) {
      let refEntries: DirEntry[];
      try {
        refEntries = fs.readdirSync(refDir);
      } catch {
        refEntries = [];
      }
      for (const e of refEntries) {
        if (!e.isFile || !e.name.endsWith(".md")) continue;
        const p = path.join(refDir, e.name);
        let head = "";
        try {
          head = fs.readFileSync(p).slice(0, P10_HEAD_BYTES);
        } catch {
          continue;
        }
        const sv = extractSchemaVersion(head);
        if (sv && (sv === "guild.reflection.v1" || SCHEMA_STAMP_RE.test(sv))) addM2(p, "P8", `schema_version: ${sv}`);
      }
    }
  }

  // ── P11: project.yaml — wiki.share_mode present ⇒ M1 (RF1).
  {
    const p = j("project.yaml");
    const parsed = readParsed(pr, p, "yaml", true);
    if (hasWikiShareMode(parsed)) addM1(p, "P11", "project.yaml wiki.share_mode (v1 key — RF1)");
  }

  // ── P10: bounded generic guild.*.vN scan ⇒ M2 (the future-subtree guard).
  //   Excludes .backup-v1-*, telemetry payloads, the report file; 4 KiB head;
  //   json/yaml/yml/md only. NEVER contributes to M1 (R2). `.unmigrated-v1.json`
  //   is stamped guild.unmigrated.v1 ⇒ it reads as M2 here, never M1 (CF-W1b-1c).
  {
    const files = walk(
      fs,
      guildDir,
      (name) => isBackupDir(name),
      guildDir
    );
    for (const f of files) {
      const base = path.basename(f);
      const ext = path.extname(f).toLowerCase();
      if (isBackupDir(base) || isReportFile(base)) continue;
      // skip telemetry payloads regardless of ext
      if (base === "events.ndjson" || f.includes(`${path.sep}logs${path.sep}`) || ext === ".jsonl") continue;
      if (!P10_EXTS.has(ext)) continue;
      let head = "";
      try {
        head = fs.readFileSync(f).slice(0, P10_HEAD_BYTES);
      } catch {
        continue;
      }
      if (P10_SCAN_RE.test(head)) {
        const sv = extractSchemaVersion(head) ?? "guild.*.vN";
        // already-counted P1–P9 stamps will re-appear; that's fine (additive).
        addM2(f, "P10", `generic scan hit: ${sv}`);
      }
    }
  }

  // ── Classify (§1.3). corrupt dominates: any AUTHORITATIVE unparseable.
  const hasUnparseable = unparseable.some((u) => u.authoritative);
  if (hasUnparseable) {
    return { classification: "corrupt", m1: false, m2: false, hasUnparseable: true, evidence, unparseable };
  }
  const m1 = evidence.some((e) => e.contributes === "M1");
  const m2 = evidence.some((e) => e.contributes === "M2");

  let classification: DetectResult["classification"];
  if (m2 && !m1) classification = "v2";
  else if (m1 && !m2) classification = "v1";
  else if (m1 && m2) classification = "mixed";
  else classification = "none";

  return { classification, m1, m2, hasUnparseable: false, evidence, unparseable };
}

/** Extract schema_version from a parsed object (object form). */
function svOf(parsed: unknown): string | null {
  if (parsed && typeof parsed === "object" && "schema_version" in (parsed as Record<string, unknown>)) {
    const v = (parsed as Record<string, unknown>)["schema_version"];
    return typeof v === "string" ? v : null;
  }
  return null;
}

/** project.yaml: detect a wiki.share_mode key (nested or dotted). */
function hasWikiShareMode(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const rec = parsed as Record<string, unknown>;
  const wiki = rec["wiki"];
  if (wiki && typeof wiki === "object" && "share_mode" in (wiki as Record<string, unknown>)) return true;
  if ("wiki.share_mode" in rec) return true;
  return false;
}
