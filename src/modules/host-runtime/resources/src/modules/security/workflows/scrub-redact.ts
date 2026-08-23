/**
 * src/modules/security/workflows/scrub-redact.ts
 *
 * CANONICAL, single-source redaction applier for share-dot-guild (verified-multi-
 * host-support L0 ADR §6.4, security F1 BLOCKER). Scrubbing MUST be code on the
 * write/commit path, not prose — this module is the ONE place the operator-path +
 * tilde-Claude-path + secret-pattern redaction lives. Extracted verbatim from the
 * formerly-local `redact()` in scripts/dot-guild/scrub.ts.
 *
 * Consumers (all import from here — no re-spelled duplicate):
 *   - scrub.ts   — the per-run share-dot-guild scrubber (write path).
 *   - audit.ts   — the package/receipt-tree leak scan (ADR §7.2); "same applier as
 *                  the write path → no drift".
 *   - L5         — receipt-write-time scrub (clean at commit, not post-push).
 *   - L6         — the build/verify redaction-verify pass over plugin/evidence.
 *   - L8         — the byte-identical no-op cleanliness assertion
 *                  (redact(committed).out === committed).
 *
 * Secret patterns are sourced (never re-spelled) from the canonical SoT at the
 * sibling `secret-patterns.ts` (moved here from docs-hygiene/scan.ts — audit
 * remediation item 16 — so the security module no longer imports UPWARD from a
 * self-build docs scanner; `scan.ts` now re-exports FROM here instead).
 *
 * PURITY: no I/O, no spawn, no clock. Fully unit-testable.
 */

import { SECRET_PATTERNS } from "./secret-patterns";
import { parseYaml } from "../../state";

// Operator-path patterns (Decision H.2 + Decision M relative-paths-policy).
// Placeholders are idempotent — they won't re-match.
const OPERATOR_PATH_RE = /\/Users\/[^/\s]+\/Projects\/[^/\s]+/g;
const WORKSPACE_ROOT_MARKER = "<workspace-root>";
// Decision M: tilde-prefixed Claude project paths leak the workspace via the
// URL-encoded slug `~/.claude/projects/-Users-<NAME>-Projects-<WS>/...`.
const TILDE_CLAUDE_PROJECT_RE = /~\/\.claude\/projects\/-Users-[^/\s]+-Projects-[^/\s]+/g;
const OPERATOR_MEMORY_ROOT_MARKER = "<operator-memory-root>";
// T6B-R1-B1: the two patterns above only recognize the WORKSPACE forms (the
// macOS home + `Projects` + workspace path, and the tilde-Claude slug). A
// round-1 live probe leaked a private home path under a user's `.ssh`
// directory — an absolute path that is neither of those two shapes. This
// third pattern generalizes to ANY private home root (a macOS `Users` home or
// a Linux `home` home); only the home PREFIX is replaced, so
// the path's structure survives for replay (AGENTS.md §"Redaction must
// preserve structure"). It runs LAST so the two specific markers above win.
// Idempotent: the marker contains no `/Users/` or `/home/` segment.
const PRIVATE_HOME_PATH_RE = /\/(?:Users|home)\/[A-Za-z0-9._-]+(?=[/\s"',:;)\]}]|$)/g;
const PRIVATE_HOME_MARKER = "<private-home>";

export interface SecretHit {
  category: string;
  line: number;
}

/**
 * The result of a redaction pass. `opPaths` and `secrets` are INDEPENDENT counters
 * (round-2 minor): a caller decides an operator-path finding on `opPaths > 0` and a
 * secret finding on `secrets.length > 0` — they must never be conflated.
 */
export interface RedactResult {
  out: string;
  opPaths: number;
  secrets: SecretHit[];
}

const SHA256_VALUE = /^(?:sha256:)?[0-9a-f]{64}$/;
const SHA256_FIELDS = new Set([
  "sha256",
  "content_tree_sha256",
  "evidence_sha256",
  "install_surface_sha256",
  "manifest_sha256",
  "public_evidence_sha256",
  "producer_sha256",
  "receipt_sha256",
  "skill_sha256",
  "tree_sha256",
  "transcript_sha256",
  "worker_command_sha256",
  "worker_result_sha256",
  "package_hash",
]);
const HASH_BEARING_SCHEMAS = new Set([
  "guild.provenance.v1",
  "guild.activated_host_public_evidence.v1",
  "guild.activated_host_public_manifest.v1",
  "guild.capability_run_start_snapshot.v1",
  "guild.capability_run_baseline.v1",
  "guild.project_capability_profile.v1",
  "guild.receipt_record.v1",
  "guild.compatibility_usage.v1",
  "guild.capability_substantive_operation.v1",
  "guild.task_assignment.v2",
  "guild.session_context.v1",
]);

function recognizedHashDocument(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const schema = (value as Record<string, unknown>).schema_version;
  return typeof schema === "string" && (HASH_BEARING_SCHEMAS.has(schema) || schema.startsWith("guild.trace."));
}

function approvedHashPath(schema: string, pathParts: readonly string[]): boolean {
  const pathKey = pathParts.join("/");
  if (schema === "guild.capability_run_start_snapshot.v1" || schema === "guild.capability_run_baseline.v1") {
    return new Set(["agents", "skills", "registries", "bound_root"]).has(pathKey);
  }
  if (schema === "guild.project_capability_profile.v1") {
    return new Set([
      "feedstock/codebase_map_hash",
      "feedstock/knowledge_graph_hash",
      "feedstock/roster_hash",
      "mutation_evidence/agents_tree_hash_before",
      "mutation_evidence/agents_tree_hash_after",
      "mutation_evidence/skills_tree_hash_before",
      "mutation_evidence/skills_tree_hash_after",
      "mutation_evidence/registry_hash_before",
      "mutation_evidence/registry_hash_after",
      "source_commit",
    ]).has(pathKey) || /^(?:coverage|candidates)\/.*\/(?:profile_hash|content_hash|sha256)$/.test(pathKey);
  }
  if (schema === "guild.receipt_record.v1") {
    return pathKey === "input_hash" || pathKey === "output_hash" || pathKey === "record_hash" || pathKey === "versions/source_version";
  }
  if (schema === "guild.compatibility_usage.v1") return pathKey === "content_hash";
  if (schema === "guild.capability_substantive_operation.v1") {
    return new Set([
      "compatibility_payload_sha256",
      "assignment_sha256", "handoff_sha256", "handoff_receipt_sha256", "validation_sha256", "attempt_sha256", "acceptance_sha256",
      "projected_assignment_sha256", "projected_handoff_sha256", "projected_handoff_receipt_sha256", "projected_validation_sha256", "projected_attempt_sha256", "projected_acceptance_sha256",
    ]).has(pathKey);
  }
  if (schema === "guild.task_assignment.v2") {
    return new Set(["specialist_type_hash", "specialist_profile_hash", "context_bundle_hash", "host_capabilities_hash"]).has(pathKey);
  }
  if (schema === "guild.session_context.v1") {
    return new Set([
      "execution_target/account_fingerprint",
      "execution_target/endpoint_fingerprint",
      "execution_target/org_fingerprint",
    ]).has(pathKey);
  }
  if (schema === "guild.activated_host_public_manifest.v1") {
    return pathKey === "manifest_sha256" || pathKey === "evidence_sha256";
  }
  if (schema === "guild.activated_host_public_evidence.v1") {
    return new Set([
      "public_evidence_sha256",
      "runtime_package/manifest_sha256",
      "runtime_package/producer_sha256",
      "runtime_package/tree_sha256",
      "runtime_package/install_surface_sha256",
      "host_executable/sha256",
      "host_activation/receipt_sha256",
      "host_activation/skill_sha256",
      "consumer_trees/website/content_tree_sha256",
      "consumer_trees/benchmark/content_tree_sha256",
    ]).has(pathKey) || /^host_executable\/companions\/[0-9]+\/sha256$/.test(pathKey);
  }
  if (schema === "guild.provenance.v1") {
    return pathParts.length === 2 && pathParts[0] === "artifacts" && SHA256_FIELDS.has(pathParts[1]);
  }
  return schema.startsWith("guild.trace.") && pathParts.length === 1 && SHA256_FIELDS.has(pathParts[0]);
}

function protectSchemaBoundSha256Occurrences(
  content: string,
  rel: string,
): { content: string; tokens: Array<{ value: string; token: string }> } {
  const tokens: Array<{ value: string; token: string }> = [];
  let tokenIndex = 0;
  const uniqueToken = (): string => {
    let token = `<GUILD-SHA256-${tokenIndex++}>`;
    while (content.includes(token)) token = `<GUILD-SHA256-${tokenIndex++}>`;
    return token;
  };
  const protectDocument = (documentContent: string): string => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(documentContent);
    } catch {
      return documentContent;
    }
    if (!recognizedHashDocument(parsed)) return documentContent;
    const trailingNewline = documentContent.endsWith("\n");
    const body = trailingNewline ? documentContent.slice(0, -1) : documentContent;
    const compact = JSON.stringify(parsed);
    const pretty = JSON.stringify(parsed, null, 2);
    const indent = body === compact ? undefined : body === pretty ? 2 : null;
    if (indent === null) return documentContent;
    const schema = String(parsed.schema_version);
    const protect = (value: unknown, pathParts: string[]): void => {
      if (Array.isArray(value)) {
        value.forEach((entry, index) => protect(entry, [...pathParts, String(index)]));
        return;
      }
      if (typeof value !== "object" || value === null) return;
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        const childPath = [...pathParts, key];
        const approvedValue = SHA256_VALUE.test(String(entry))
          || (schema === "guild.session_context.v1" && /^fp-[0-9a-f]{64}$/.test(String(entry)))
          || (schema === "guild.project_capability_profile.v1" && childPath.join("/") === "source_commit" && /^[0-9a-f]{40}$/.test(String(entry)));
        if (typeof entry === "string" && approvedValue && approvedHashPath(schema, childPath)) {
          const token = uniqueToken();
          tokens.push({ value: entry, token });
          (value as Record<string, unknown>)[key] = token;
        } else {
          protect(entry, childPath);
        }
      }
    };
    protect(parsed, []);
    const serialized = JSON.stringify(parsed, null, indent === undefined ? undefined : indent);
    return `${serialized}${trailingNewline ? "\n" : ""}`;
  };

  const normalizedRel = rel.split(/[\\/]/).join("/");
  if (normalizedRel.endsWith(".jsonl")) {
    return { content: content.split("\n").map((line) => line.trim().length === 0 ? line : protectDocument(line)).join("\n"), tokens };
  }
  if (normalizedRel.endsWith(".json")) return { content: protectDocument(content), tokens };
  if (normalizedRel.endsWith("run.yaml")) {
    let document: Record<string, unknown> | null = null;
    try {
      const parsed = parseYaml(content);
      document = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch { document = null; }
    const rawRef = document?.capability_start_snapshot_ref;
    const ref = typeof rawRef === "object" && rawRef !== null && !Array.isArray(rawRef) ? rawRef as Record<string, unknown> : null;
    const reviewedSnapshotPath = ref?.path === "capability/run-start-snapshot.json" || ref?.path === "run-start-snapshot.json";
    const reviewedHash = document?.schema_version === "guild.run.v1" && reviewedSnapshotPath && typeof ref?.sha256 === "string" && SHA256_VALUE.test(ref.sha256)
      ? ref.sha256
      : null;
    if (reviewedHash && content.split(reviewedHash).length - 1 === 1) {
      const token = uniqueToken();
      tokens.push({ value: reviewedHash, token });
      return { content: content.replace(reviewedHash, token), tokens };
    }
  }
  return { content, tokens };
}

/**
 * Redact operator paths, tilde-Claude project paths, and secret-pattern matches.
 * Returns the scrubbed text plus the two independent counters. Idempotent +
 * deterministic (placeholders never re-match; no clock/PID/nonce).
 */
export function redact(content: string): RedactResult {
  let opPaths = 0;
  let out = content.replace(OPERATOR_PATH_RE, () => { opPaths++; return WORKSPACE_ROOT_MARKER; });
  // Decision M: also redact tilde-prefixed Claude project paths.
  out = out.replace(TILDE_CLAUDE_PROJECT_RE, () => { opPaths++; return OPERATOR_MEMORY_ROOT_MARKER; });
  // T6B-R1-B1: any remaining private home root (`/Users/<n>`, `/home/<n>`) —
  // the general case the two workspace-specific patterns above do not cover.
  out = out.replace(PRIVATE_HOME_PATH_RE, () => { opPaths++; return PRIVATE_HOME_MARKER; });
  const secrets: SecretHit[] = [];
  const lines = out.split("\n");
  out = lines.map((line, i) => {
    let l = line;
    for (const [re, label] of SECRET_PATTERNS) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      if (g.test(l)) {
        secrets.push({ category: label, line: i + 1 });
        l = l.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"),
          `<SECRET-REDACTED:${label}>`);
      }
    }
    return l;
  }).join("\n");
  return { out, opPaths, secrets };
}

/**
 * Redact one run-relative shareable file while preserving only SHA-256 values
 * attached to reviewed fields in a recognized Guild schema. Unknown schemas,
 * unstructured prose, credential-shaped strings, and arbitrary hex remain under
 * the strict `redact()` heuristic.
 */
export function redactShareableFile(content: string, rel: string): RedactResult {
  const protectedValue = protectSchemaBoundSha256Occurrences(content, rel);
  if (protectedValue.tokens.length === 0) return redact(content);
  const result = redact(protectedValue.content);
  let out = result.out;
  for (const { value, token } of protectedValue.tokens) out = out.split(token).join(value);
  return { ...result, out };
}
