import * as fs from "node:fs";
import * as path from "node:path";
import { parseYaml } from "../state";
import { durableGuildDir } from "../state";
import { EXECUTION_STATUS, RELEASE_STATUS, DOCUMENTATION_STATUS, type ExecutionStatus, type ReleaseStatus, type DocumentationStatus, type D8Input } from "./initiative";
// ── Manifest lookup ──────────────────────────────────────────────────────────

export interface LoadedManifest {
  path: string;
  raw: Record<string, unknown>;
}

/**
 * Find + parse `.guild/initiatives/{active,archived}/<id>/initiative.yaml`.
 * Checks `active/` first, then `archived/` (a closed initiative's manifest
 * still lives there). Returns `null` when neither exists or the file does not
 * parse to an object carrying a top-level `initiative:` map.
 */
export function loadInitiativeManifest(root: string, id: string): LoadedManifest | null {
  for (const bucket of ["active", "archived"] as const) {
    const p = path.join(durableGuildDir(root), "initiatives", bucket, id, "initiative.yaml");
    if (!fs.existsSync(p)) continue;
    let text: string;
    try {
      text = fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
    const parsed = parseYaml(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const inner = obj["initiative"];
    if (inner === null || typeof inner !== "object" || Array.isArray(inner)) return null;
    return { path: p, raw: inner as Record<string, unknown> };
  }
  return null;
}

// ── Legacy status mapping (fail-closed on the unrecognized) ────────────────

/**
 * Known legacy/loose spellings seen in the real repo corpus, mapped onto the
 * frozen closed-enum values. Anything not listed here (and not already a
 * canonical value) is left UNMAPPED — the caller treats that leg as
 * unresolved rather than guessing.
 */
const EXECUTION_STATUS_ALIASES: Record<string, ExecutionStatus> = {
  in_progress: "active",
  "in-progress": "active",
  completed: "done",
  complete: "done",
};
const DOCUMENTATION_STATUS_ALIASES: Record<string, DocumentationStatus> = {
  pending: "update_required",
  "in-sync": "no_update_required",
  in_sync: "no_update_required",
  "not-assessed": "not_assessed",
  // real archived-corpus spelling (host-adapter-migration): docs shipped
  done: "updated",
};
const RELEASE_STATUS_ALIASES: Record<string, ReleaseStatus> = {
  // real archived-corpus spelling (settings-control-and-tmux)
  released_to_canon: "released",
  "released-to-canon": "released",
};

export interface MappedStatus<T extends string> {
  /** The canonical value, or null when the raw value could not be mapped. */
  value: T | null;
  warning?: string;
}

function mapStatus<T extends string>(
  field: string,
  raw: unknown,
  canonical: readonly T[],
  aliases: Record<string, T>,
): MappedStatus<T> {
  if (typeof raw !== "string" || raw.length === 0) {
    return { value: null, warning: `${field}: missing — leg treated as unresolved` };
  }
  if ((canonical as readonly string[]).includes(raw)) return { value: raw as T };
  const aliased = aliases[raw];
  if (aliased !== undefined) {
    return {
      value: aliased,
      warning: `${field}: legacy value "${raw}" mapped to "${aliased}"`,
    };
  }
  return {
    value: null,
    warning: `${field}: unrecognized value "${raw}" (not in ${canonical.join("|")}) — leg treated as unresolved`,
  };
}

export interface BuiltD8Input {
  input: D8Input;
  warnings: string[];
}

/** Build the `D8Input` the real `d8CloseGate` consumes, from a raw manifest + supplied execVerified. */
export function buildD8Input(raw: Record<string, unknown>, execVerified: boolean): BuiltD8Input {
  const warnings: string[] = [];

  const exec = mapStatus("execution_status", raw["execution_status"], EXECUTION_STATUS, EXECUTION_STATUS_ALIASES);
  const release = mapStatus("release_status", raw["release_status"], RELEASE_STATUS, RELEASE_STATUS_ALIASES);
  const docs = mapStatus(
    "documentation_status",
    raw["documentation_status"],
    DOCUMENTATION_STATUS,
    DOCUMENTATION_STATUS_ALIASES,
  );
  for (const m of [exec, release, docs]) if (m.warning) warnings.push(m.warning);

  // A leg that failed to map has NO canonical resolved value — fall back to
  // the enum's least-resolved member so d8CloseGate sees it as unresolved
  // (never silently "not present" — the gate always receives a valid D8Input).
  const input: D8Input = {
    execVerified,
    execution_status: exec.value ?? "not_started",
    release_status: release.value ?? "not_released",
    documentation_status: docs.value ?? "not_assessed",
  };
  return { input, warnings };
}

// ── Evidence-reference existence binding ───────────────────────────────────

export interface EvidenceRefRecord {
  ref: string;
  source: string;
  resolved_path: string;
}

export interface InvalidEvidenceRef {
  ref: unknown;
  source: string;
  reason: string;
}

export interface InitiativeEvidenceCheck {
  valid: boolean;
  /** Canonical path-shaped refs presented to the filesystem; missing refs also appear in `missing`. */
  checked: EvidenceRefRecord[];
  missing: EvidenceRefRecord[];
  invalid: InvalidEvidenceRef[];
}

function isPathContained(rootPath: string, candidatePath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(rootPath + path.sep);
}

/**
 * Older Guild work items emitted two labeled evidence forms before D8 made
 * evidence_refs path-only. Preserve those records without turning arbitrary
 * prose into evidence: the label vocabulary and optional trailing annotation
 * are closed, and the extracted token still passes every normal path,
 * existence, realpath-containment, and regular-file check below.
 */
function evidencePathToken(rawRef: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(rawRef)) return null;
  if (!/\s/.test(rawRef)) return rawRef;
  const legacy = /^(?:receipt|deliverable):\s+(\S+)(?:\s+\(branch [A-Za-z0-9._/-]+\))?$/i.exec(rawRef);
  return legacy?.[1] ?? null;
}

function classifyEvidenceRef(root: string, source: string, rawRef: unknown):
  | { kind: "valid"; record: EvidenceRefRecord }
  | { kind: "invalid"; record: InvalidEvidenceRef } {
  if (typeof rawRef !== "string" || rawRef.length === 0) {
    return { kind: "invalid", record: { ref: rawRef, source, reason: "evidence ref must be a non-empty string" } };
  }
  const normalizedRef = evidencePathToken(rawRef);
  if (normalizedRef === null) {
    return { kind: "invalid", record: { ref: rawRef, source, reason: "evidence ref must be a path, not prose/control text" } };
  }

  // HTML fragments identify a location inside the cited file, not a distinct
  // filesystem object. Existence binds to the bytes before `#`.
  const fileRef = normalizedRef.split("#", 1)[0];
  if (!fileRef || path.isAbsolute(fileRef)) {
    return { kind: "invalid", record: { ref: rawRef, source, reason: "evidence ref must be repository-relative" } };
  }
  const segments = fileRef.split(/[\\/]/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return { kind: "invalid", record: { ref: rawRef, source, reason: "evidence ref must be a canonical contained path" } };
  }
  const rootAbs = path.resolve(root);
  const resolved = path.resolve(rootAbs, fileRef);
  if (!isPathContained(rootAbs, resolved)) {
    return { kind: "invalid", record: { ref: rawRef, source, reason: "evidence ref escapes repository root" } };
  }
  return {
    kind: "valid",
    record: { ref: rawRef, source, resolved_path: resolved },
  };
}

/**
 * Bind D8 to cited bytes. Every path under `close_gate.evidence` and every
 * work-item `evidence_refs` entry must be a canonical repository-relative path
 * that exists on disk. Missing/malformed work-item files fail closed too.
 */
export function checkInitiativeEvidenceRefs(
  root: string,
  initiativeDir: string,
  manifest: Record<string, unknown>,
): InitiativeEvidenceCheck {
  const checked: EvidenceRefRecord[] = [];
  const missing: EvidenceRefRecord[] = [];
  const invalid: InvalidEvidenceRef[] = [];

  const consume = (source: string, rawRefs: unknown): void => {
    if (rawRefs === undefined) return;
    if (!Array.isArray(rawRefs)) {
      invalid.push({ ref: rawRefs, source, reason: "evidence refs must be an array" });
      return;
    }
    for (const rawRef of rawRefs) {
      const classified = classifyEvidenceRef(root, source, rawRef);
      if (classified.kind === "invalid") {
        invalid.push(classified.record);
        continue;
      }
      if (!fs.existsSync(classified.record.resolved_path)) {
        checked.push(classified.record);
        missing.push(classified.record);
        continue;
      }
      try {
        const rootReal = fs.realpathSync.native(path.resolve(root));
        const evidenceReal = fs.realpathSync.native(classified.record.resolved_path);
        if (!isPathContained(rootReal, evidenceReal)) {
          invalid.push({
            ref: classified.record.ref,
            source,
            reason: "evidence ref resolves outside repository root",
          });
          continue;
        }
        if (!fs.statSync(evidenceReal).isFile()) {
          invalid.push({
            ref: classified.record.ref,
            source,
            reason: "evidence ref must resolve to a regular file",
          });
          continue;
        }
      } catch {
        invalid.push({
          ref: classified.record.ref,
          source,
          reason: "evidence ref cannot be resolved or read",
        });
        continue;
      }
      checked.push(classified.record);
    }
  };

  const closeGate = manifest["close_gate"];
  if (closeGate !== undefined) {
    if (!closeGate || typeof closeGate !== "object" || Array.isArray(closeGate)) {
      invalid.push({ ref: closeGate, source: "initiative.yaml#close_gate", reason: "close_gate must be an object" });
    } else {
      consume("initiative.yaml#close_gate.evidence", (closeGate as Record<string, unknown>)["evidence"]);
    }
  }

  const workItemsDir = path.join(initiativeDir, "work-items");
  if (fs.existsSync(workItemsDir)) {
    let names: string[];
    try {
      const entries = fs.readdirSync(workItemsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      names = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
        .map((entry) => entry.name)
        .sort();
      for (const entry of entries) {
        if (entry.name.endsWith(".yaml") && !entry.isFile()) {
          invalid.push({
            ref: entry.name,
            source: `work-items/${entry.name}`,
            reason: "work-item YAML entries must be regular files",
          });
          continue;
        }
        if (!entry.isFile()) continue;
        if (/\.ya?ml$/i.test(entry.name) && !entry.name.endsWith(".yaml")) {
          invalid.push({
            ref: entry.name,
            source: `work-items/${entry.name}`,
            reason: "work-item files must use the canonical .yaml extension",
          });
        }
      }
    } catch {
      invalid.push({ ref: "work-items/", source: "work-items/", reason: "work-items directory is unreadable" });
      names = [];
    }
    for (const name of names) {
      const source = `work-items/${name}`;
      let parsed: unknown;
      try {
        parsed = parseYaml(fs.readFileSync(path.join(workItemsDir, name), "utf8"));
      } catch {
        invalid.push({ ref: name, source, reason: "work item is unreadable or malformed YAML" });
        continue;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        invalid.push({ ref: name, source, reason: "work item must parse to an object" });
        continue;
      }
      consume(source, (parsed as Record<string, unknown>)["evidence_refs"]);
    }
  }

  return { valid: missing.length === 0 && invalid.length === 0, checked, missing, invalid };
}
