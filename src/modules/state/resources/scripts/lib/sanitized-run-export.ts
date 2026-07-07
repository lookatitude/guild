/**
 * scripts/lib/sanitized-run-export.ts
 *
 * R7 replayable sanitized run export. This module turns a `.guild/runs/<id>/`
 * directory into a shareable JSON artifact: same replay shape, scrubbed content,
 * scrubber version, and redaction metadata.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { assembleReplayManifest, type ReplayManifest } from "./replay-rundir";
import { SECRET_PATTERNS } from "../docs-hygiene/scan";

export const RUN_EXPORT_SCRUBBER_VERSION = "guild.run_export_scrubber.v1";

export interface RunExportPolicy {
  configuredSecrets?: string[];
  privatePathPrefixes?: string[];
  customPatterns?: string[];
}

export interface RedactionHit {
  kind: string;
  count: number;
}

export interface SanitizedRunExportFile {
  path: string;
  format: "json" | "jsonl" | "text";
  sha256_sanitized: string;
  redactions: RedactionHit[];
  content: unknown;
}

export interface SanitizedRunExport {
  schema_version: "guild.sanitized_run_export.v1";
  scrubber: {
    version: typeof RUN_EXPORT_SCRUBBER_VERSION;
    policy: {
      builtins: string[];
      configured_secret_count: number;
      private_path_prefix_count: number;
      custom_pattern_count: number;
    };
  };
  source: {
    run_dir: string;
  };
  replay_manifest: ReplayManifest;
  files: SanitizedRunExportFile[];
}

interface RedactAccumulator {
  hits: Map<string, number>;
}

const BUILTIN_KINDS = [
  "api-key",
  "password",
  "token",
  "cookie",
  "private-key",
  "auth-header",
  "payment-card",
  "email",
  "customer-id",
  "configured-secret",
  "private-path",
  "custom-pattern",
  "canonical-secret",
];

function addHit(acc: RedactAccumulator, kind: string, count: number): void {
  if (count <= 0) return;
  acc.hits.set(kind, (acc.hits.get(kind) ?? 0) + count);
}

function replaceAndCount(input: string, re: RegExp, replacement: string, kind: string, acc: RedactAccumulator): string {
  let count = 0;
  const out = input.replace(re, () => {
    count++;
    return replacement;
  });
  addHit(acc, kind, count);
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactRunString(input: string, policy: RunExportPolicy = {}, acc: RedactAccumulator = { hits: new Map() }): string {
  let out = input;

  out = replaceAndCount(out, /(?:\/Users\/|\/home\/)[^"'\s]+/g, "<redacted:private-path>", "private-path", acc);
  out = replaceAndCount(out, /\b[A-Za-z]:\\Users\\[^"'\s]+/g, "<redacted:private-path>", "private-path", acc);

  for (const secret of policy.configuredSecrets ?? []) {
    if (!secret) continue;
    out = replaceAndCount(out, new RegExp(escapeRegExp(secret), "g"), "<redacted:configured-secret>", "configured-secret", acc);
  }
  for (const prefix of policy.privatePathPrefixes ?? []) {
    if (!prefix) continue;
    out = replaceAndCount(out, new RegExp(`${escapeRegExp(prefix)}[^\\s\"']*`, "g"), "<redacted:private-path>", "private-path", acc);
  }
  for (const pattern of policy.customPatterns ?? []) {
    try {
      out = replaceAndCount(out, new RegExp(pattern, "g"), "<redacted:custom-pattern>", "custom-pattern", acc);
    } catch {
      // Invalid operator pattern is ignored by export; scrubber metadata still records count.
    }
  }

  out = replaceAndCount(out, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<redacted:private-key>", "private-key", acc);
  out = replaceAndCount(out, /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Authorization: Bearer <redacted:auth-header>", "auth-header", acc);
  out = replaceAndCount(out, /\bCookie\s*:\s*[^"\n\r]+/gi, "Cookie: <redacted:cookie>", "cookie", acc);
  out = replaceAndCount(out, /\bsk-[A-Za-z0-9_-]{16,}\b/g, "<redacted:api-key>", "api-key", acc);
  out = replaceAndCount(out, /\bsk_live_[A-Za-z0-9]{12,}\b/g, "<redacted:api-key>", "api-key", acc);
  out = replaceAndCount(out, /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<redacted:token>", "token", acc);
  out = replaceAndCount(out, /\b(?:ghp|ghs|xox[baprs])_[A-Za-z0-9-]{12,}/g, "<redacted:token>", "token", acc);
  out = replaceAndCount(out, /\bya29\.[A-Za-z0-9._-]{12,}/g, "<redacted:token>", "token", acc);
  out = replaceAndCount(out, /\b(password|passwd|pwd)\s*[:=]\s*([^\s"',}]+)/gi, "<redacted:password>", "password", acc);
  out = replaceAndCount(out, /\b(token|access_token|refresh_token|id_token)\s*[:=]\s*([^\s"',}]+)/gi, "<redacted:token>", "token", acc);
  out = replaceAndCount(out, /\b(?:\d[ -]*?){13,19}\b/g, "<redacted:payment-card>", "payment-card", acc);
  out = replaceAndCount(out, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<redacted:email>", "email", acc);
  out = replaceAndCount(out, /\b(cus|customer|user|usr)_[A-Za-z0-9]{6,}\b/g, "<redacted:customer-id>", "customer-id", acc);
  for (const [re, label] of SECRET_PATTERNS) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    out = replaceAndCount(out, new RegExp(re.source, flags), `<redacted:${label}>`, "canonical-secret", acc);
  }
  return out;
}

function sensitiveKindForKey(key: string): string | null {
  const normalized = key.toLowerCase().replace(/[-\s]/g, "_");
  if (/^(password|passwd|pwd)$/.test(normalized)) return "password";
  if (/(^|_)api_?key$/.test(normalized)) return "api-key";
  if (/(^|_)(token|access_token|refresh_token|id_token|secret)$/.test(normalized)) return "token";
  if (/^(authorization|auth_header)$/.test(normalized)) return "auth-header";
  if (/^cookie$/.test(normalized)) return "cookie";
  return null;
}

function redactValue(value: unknown, policy: RunExportPolicy, acc: RedactAccumulator, sensitiveKind: string | null = null): unknown {
  if (sensitiveKind !== null) {
    addHit(acc, sensitiveKind, 1);
    return `<redacted:${sensitiveKind}>`;
  }
  if (typeof value === "string") return redactRunString(value, policy, acc);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, policy, acc));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const safeKey = redactRunString(k, policy, acc);
      out[safeKey] = redactValue(v, policy, acc, sensitiveKindForKey(k));
    }
    return out;
  }
  return value;
}

function hitsArray(acc: RedactAccumulator): RedactionHit[] {
  return [...acc.hits.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
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

function replayFiles(runDir: string, manifest: ReplayManifest): string[] {
  const rels = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (!artifact.present) continue;
    const abs = path.join(runDir, artifact.relativePath);
    if (artifact.files !== undefined) {
      for (const file of walkFiles(abs)) rels.add(path.relative(runDir, file));
    } else {
      rels.add(artifact.relativePath);
    }
  }
  return [...rels].sort();
}

function sanitizeFile(runDir: string, relPath: string, policy: RunExportPolicy): SanitizedRunExportFile {
  const abs = path.join(runDir, relPath);
  const raw = fs.readFileSync(abs, "utf8");
  const acc: RedactAccumulator = { hits: new Map() };
  let format: SanitizedRunExportFile["format"] = "text";
  let content: unknown;

  if (relPath.endsWith(".json")) {
    try {
      content = redactValue(JSON.parse(raw), policy, acc);
      format = "json";
    } catch {
      content = redactRunString(raw, policy, acc);
    }
  } else if (relPath.endsWith(".jsonl") || relPath.endsWith(".ndjson")) {
    const records: unknown[] = [];
    let parsedAll = true;
    for (const line of raw.split(/\r?\n/).filter((l) => l.trim())) {
      try {
        records.push(redactValue(JSON.parse(line), policy, acc));
      } catch {
        parsedAll = false;
        break;
      }
    }
    if (parsedAll) {
      content = records;
      format = "jsonl";
    } else {
      content = redactRunString(raw, policy, acc);
    }
  } else {
    content = redactRunString(raw, policy, acc);
  }

  const stable = JSON.stringify(content);
  return {
    path: relPath,
    format,
    sha256_sanitized: sha256(stable),
    redactions: hitsArray(acc),
    content,
  };
}

export function exportSanitizedRun(runDir: string, policy: RunExportPolicy = {}): SanitizedRunExport {
  const manifest = assembleReplayManifest(runDir);
  const metaAcc: RedactAccumulator = { hits: new Map() };
  const redactedRunDir = redactRunString(runDir, policy, metaAcc);
  const safeRunDir = redactedRunDir === runDir && path.isAbsolute(runDir)
    ? "<redacted:private-path>"
    : redactedRunDir;
  if (safeRunDir !== redactedRunDir) addHit(metaAcc, "private-path", 1);
  const safeManifest = redactValue(manifest, policy, metaAcc) as ReplayManifest;
  safeManifest.runDir = safeRunDir;
  const files = replayFiles(runDir, manifest).map((rel) => sanitizeFile(runDir, rel, policy));
  return {
    schema_version: "guild.sanitized_run_export.v1",
    scrubber: {
      version: RUN_EXPORT_SCRUBBER_VERSION,
      policy: {
        builtins: BUILTIN_KINDS,
        configured_secret_count: policy.configuredSecrets?.length ?? 0,
        private_path_prefix_count: policy.privatePathPrefixes?.length ?? 0,
        custom_pattern_count: policy.customPatterns?.length ?? 0,
      },
    },
    source: { run_dir: safeRunDir },
    replay_manifest: safeManifest,
    files,
  };
}
