/**
 * src/modules/prompting/workflows/compose-prompt.ts — deterministic prompt compose (KTD31/R47).
 *
 * Models do not follow instructions the same way, so Guild composes a dialect at
 * SESSION BIND rather than freezing one into a file. The result is runtime-only:
 * only its hash lands on `guild.session_binding.v1`, never the composed text and
 * never a concrete model name.
 *
 * Layer order, lowest first:
 *
 *   base (plugin src/surfaces) < workspace extensions < project extensions
 *     < host overlay (host family) < model-family dialect
 *
 * Two budgets are enforced here rather than hoped for:
 *
 *   - A dialect fragment is ≤200 tokens. Over budget it is SKIPPED and the skip
 *     is recorded — an over-long dialect must not be able to blow the always-on
 *     prefix cap by itself, and silent truncation would leave a half sentence.
 *   - A fragment that names a concrete model (`opus`, `gpt-5.4`) is REJECTED.
 *     Dialects key on families: anthropic · openai · google.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** ≤200 tokens (KTD31). Tokens are approximated; see `approxTokens`. */
export const DIALECT_TOKEN_BUDGET = 200;

export interface PromptFragment {
  /** Stable id: the overlay path or `dialect:<family>`. */
  id: string;
  text: string;
}

export interface ComposeExtensions {
  /** Workspace `.guild/prompts/**` overlays, in read order. */
  workspace?: PromptFragment[];
  /** Project `.guild/prompts/**` overlays, in read order. Project wins on an id. */
  project?: PromptFragment[];
  /** Plugin `src/adapters/<family>/prompts/` overlay for the bound host. */
  hostOverlay?: PromptFragment | null;
  /** Model-family dialect fragment (plugin, optionally appended by the project). */
  dialect?: PromptFragment | null;
}

export type SkipReason = "dialect-over-budget" | "concrete-model-name" | "host-identity" | "wrong-family";

export interface ComposedPrompt {
  /** The composed always-on text. RUNTIME ONLY — never written to config. */
  text: string;
  /** `dialect:<model_family>`, or `dialect:none` when no dialect applied. */
  dialect_id: string;
  /** Ids of every fragment that made it into `text`, in order. */
  overlay_ids: string[];
  /** sha256 of `text`, the value that lands on session_binding.prompt_compose. */
  hash: string;
  /** Fragments left out, each with the reason. Recorded, never silent. */
  skipped: Array<{ id: string; reason: SkipReason }>;
}

/**
 * Token approximation. Deliberately conservative and dependency-free: the budget
 * is an authoring guard, so over-counting a fragment by a few tokens costs an
 * author some words, while under-counting costs every session its prefix budget.
 */
export function approxTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(Math.max(words * 1.3, text.length / 4));
}

const MODEL_NAME_RE =
  /\b(opus|sonnet|haiku|fable|gpt-?[0-9][^\s]*|o[1-9](?:-(?:mini|pro|preview))?|gemini-[0-9][^\s]*|claude-[a-z0-9][^\s]*|llama-?[0-9][^\s]*|mistral|grok-?[0-9][^\s]*|deepseek|qwen)\b/i;

/** The concrete model name in `text`, or `null`. Exported for the authoring lint. */
export function concreteModelNameIn(text: string): string | null {
  const m = MODEL_NAME_RE.exec(text);
  return m ? m[0] : null;
}

export const MODEL_FAMILIES = Object.freeze(["anthropic", "openai", "google"]);

/** Which skip reason a prompt-identity hit reports. */
function skipReasonFor(hit: { kind: PromptIdentityKind }): SkipReason {
  return hit.kind === "model-name" ? "concrete-model-name" : "host-identity";
}

/**
 * Host FAMILIES a durable prompt file may not name. The plugin's own host overlay
 * lives under `src/adapters/<family>/prompts/` and is selected at bind; a file
 * under a project's `.guild/prompts/` that names a host is a durable host pin.
 */
const HOST_FAMILY_TOKENS_PROMPT: readonly string[] = Object.freeze([
  "claude", "codex", "cursor", "gemini", "copilot", "windsurf", "aider",
  "antigravity", "cline", "zed",
]);

const HOST_FAMILY_RE = new RegExp(`\\b(${HOST_FAMILY_TOKENS_PROMPT.join("|")})\\b`, "i");

/**
 * The "you are <host>" phrase family. KTD31 names it directly: a composed prompt
 * never says "you are Claude", and neither may a file that feeds one. Matched
 * separately from the bare family token so the message can say WHICH rule fired.
 */
const YOU_ARE_HOST_RE = new RegExp(
  `\\byou(?:'re| are)\\s+(?:an?\\s+)?(${HOST_FAMILY_TOKENS_PROMPT.join("|")})\\b`,
  "i",
);

export type PromptIdentityKind = "model-name" | "host-family" | "you-are-host";

export interface PromptIdentityHit {
  kind: PromptIdentityKind;
  token: string;
}

/**
 * Host or model identity anywhere in `text`, or `null`.
 *
 * Checked in order of specificity so the message names the most useful rule:
 * the prose form first ("You are Claude."), then a concrete model name, then a
 * bare host family. Case-insensitive, word-boundary — `claudette` is not a hit.
 */
export function promptIdentityIn(text: string): PromptIdentityHit | null {
  const prose = YOU_ARE_HOST_RE.exec(text);
  if (prose) return { kind: "you-are-host", token: prose[0] };
  const model = MODEL_NAME_RE.exec(text);
  if (model) return { kind: "model-name", token: model[0] };
  const fam = HOST_FAMILY_RE.exec(text);
  if (fam) return { kind: "host-family", token: fam[0] };
  return null;
}

/**
 * Compose the always-on Guild prompt for this session.
 *
 * Pure: it reads no files and writes none, so the same (base, extensions, host,
 * family) always produces the same hash. That determinism is what makes a
 * Claude→Codex continuation observable as two different `prompt_compose.hash`
 * values rather than a diff nobody can check.
 */
export function composePrompt(
  base: string,
  extensions: ComposeExtensions,
  host_family: string,
  model_family: string,
): ComposedPrompt {
  const skipped: Array<{ id: string; reason: SkipReason }> = [];
  const parts: PromptFragment[] = [{ id: "base:using-guild", text: base }];

  // Project wins on a shared id (KTD31: plugin < workspace < project), except that
  // using-guild is append-only — a project overlay adds chapters, never replaces.
  const byId = new Map<string, PromptFragment>();
  for (const f of extensions.workspace ?? []) byId.set(f.id, f);
  for (const f of extensions.project ?? []) byId.set(f.id, f);
  for (const f of byId.values()) {
    const hit = promptIdentityIn(f.text);
    if (hit) {
      skipped.push({ id: f.id, reason: skipReasonFor(hit) });
      continue;
    }
    parts.push(f);
  }

  if (extensions.hostOverlay) {
    // The PLUGIN's own host overlay is the one layer allowed to talk about the
    // host it was selected for, so only a concrete MODEL name disqualifies it.
    const o = extensions.hostOverlay;
    if (concreteModelNameIn(o.text)) skipped.push({ id: o.id, reason: "concrete-model-name" });
    else parts.push(o);
  }

  let dialect_id = "dialect:none";
  const d = extensions.dialect;
  if (d) {
    // A dialect for a family this session is not on does not load (KTD31).
    const declared = d.id.replace(/^dialect:/, "");
    if (MODEL_FAMILIES.includes(declared) && declared !== model_family) {
      skipped.push({ id: d.id, reason: "wrong-family" });
    } else if (promptIdentityIn(d.text)) {
      skipped.push({ id: d.id, reason: skipReasonFor(promptIdentityIn(d.text)!) });
    } else if (approxTokens(d.text) > DIALECT_TOKEN_BUDGET) {
      skipped.push({ id: d.id, reason: "dialect-over-budget" });
    } else {
      parts.push(d);
      dialect_id = `dialect:${model_family}`;
    }
  }

  // The host family is a compose INPUT, not a line of text: nothing in the
  // composed prompt says "you are Claude" (KTD31). It still changes the hash,
  // because the host overlay and dialect it selects differ.
  const text = parts.map((p) => p.text.trimEnd()).join("\n\n");
  const hash = crypto
    .createHash("sha256")
    .update(`${host_family} ${model_family} ${text}`)
    .digest("hex");

  return { text, dialect_id, overlay_ids: parts.map((p) => p.id), hash, skipped };
}

// ── Project prompt extensions (`.guild/prompts/**`) ──────────────────────────

/** Thrown when a prompt overlay carries identity durable files may not hold. */
export class PromptRejectedError extends Error {
  constructor(
    readonly file: string,
    readonly token: string,
    message: string,
  ) {
    super(message);
    this.name = "PromptRejectedError";
  }
}

/** `.guild/prompts/` — the only place a project may extend the always-on text. */
export const PROMPTS_DIRNAME = "prompts";
export const USING_GUILD_OVERLAY = "using-guild.overlay.md";
export const DIALECTS_DIRNAME = "dialects";

export interface LoadedPromptExtensions {
  overlays: PromptFragment[];
  /** The dialect for `model_family`, or `null` when the project ships none. */
  dialect: PromptFragment | null;
}

/**
 * Read a root's prompt extensions, FAILING CLOSED on a concrete model name.
 *
 * The same reject as `config set` inventory, for the same reason (KTD22/KTD31): a
 * dialect that says "you are opus" is a durable host pin wearing a markdown hat,
 * and it strands the initiative on whichever provider the author happened to use.
 * The message names the FILE and the token, so the fix is one edit.
 */
export function loadPromptExtensions(guildDir: string, model_family: string): LoadedPromptExtensions {
  const dir = path.join(guildDir, PROMPTS_DIRNAME);
  const overlays: PromptFragment[] = [];
  let dialect: PromptFragment | null = null;

  const overlayFile = path.join(dir, USING_GUILD_OVERLAY);
  const overlayText = readIfFile(overlayFile);
  if (overlayText !== null) {
    assertNoModelName(overlayFile, overlayText);
    overlays.push({ id: `overlay:${USING_GUILD_OVERLAY}`, text: overlayText });
  }

  // A dialect for a family this session is not on is not even read: loading it
  // would make an unrelated file able to fail this session's bind.
  if (MODEL_FAMILIES.includes(model_family)) {
    const dialectFile = path.join(dir, DIALECTS_DIRNAME, `${model_family}.md`);
    const dialectText = readIfFile(dialectFile);
    if (dialectText !== null) {
      assertNoModelName(dialectFile, dialectText);
      dialect = { id: `dialect:${model_family}`, text: dialectText };
    }
  }
  return { overlays, dialect };
}

function readIfFile(file: string): string | null {
  try {
    return fs.statSync(file).isFile() ? fs.readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
}

function assertNoModelName(file: string, text: string): void {
  const hit = promptIdentityIn(text);
  if (hit === null) return;
  const what =
    hit.kind === "you-are-host"
      ? `says '${hit.token}'`
      : hit.kind === "model-name"
        ? `names the concrete model '${hit.token}'`
        : `names the host family '${hit.token}'`;
  throw new PromptRejectedError(
    file,
    hit.token,
    `prompt extension ${file} ${what}. Prompt overlays and dialects key on a model ` +
      `FAMILY (${MODEL_FAMILIES.join(" · ")}) and never name a host or a product — ` +
      `host and model are bound per session on the run record (KTD22/KTD31).`,
  );
}

// ── The composition a run start performs ─────────────────────────────────────

/**
 * Where the base always-on body lives inside a plugin root, most-built first.
 * A rendered package ships `SKILL.md`; the authoring tree has `SKILL.src.md`.
 */
export const USING_GUILD_BASE_RELS: readonly string[] = Object.freeze([
  "skills/meta/using-guild/SKILL.md",
  "skills/meta/using-guild/SKILL.src.md",
]);
/** Where a plugin-shipped model-family dialect lives, once T14 authors them. */
export const PLUGIN_DIALECTS_REL = "src/surfaces/prompts/dialects";

export interface SessionComposeInput {
  host_family: string;
  model_family: string;
  /** Plugin install root; omit to compose without the shipped base. */
  pluginRoot?: string | null;
  /** The consuming root's `.guild/`; omit to compose without project overlays. */
  guildDir?: string | null;
}

/**
 * Compose this session's always-on prompt from what is actually on disk.
 *
 * Every layer is optional and each absence is honest rather than fatal: a missing
 * plugin base composes an empty base, a project with no `.guild/prompts/` adds no
 * overlay. What is NOT tolerated is a project prompt file carrying host or model
 * identity — `loadPromptExtensions` throws `PromptRejectedError`, and the caller
 * must let that reach the operator (KTD22).
 *
 * The returned `hash` is what lands on `session_binding.prompt_compose`; the TEXT
 * never leaves this function's caller (R47).
 */
export function composeSessionPrompt(input: SessionComposeInput): ComposedPrompt {
  let base = "";
  if (input.pluginRoot) {
    for (const rel of USING_GUILD_BASE_RELS) {
      const text = readIfFile(path.join(input.pluginRoot, rel));
      if (text !== null) {
        base = text;
        break;
      }
    }
  }

  const project = input.guildDir ? loadPromptExtensions(input.guildDir, input.model_family) : null;

  let dialect: PromptFragment | null = project?.dialect ?? null;
  if (dialect === null && input.pluginRoot && MODEL_FAMILIES.includes(input.model_family)) {
    const shipped = readIfFile(
      path.join(input.pluginRoot, PLUGIN_DIALECTS_REL, `${input.model_family}.md`),
    );
    if (shipped !== null) dialect = { id: `dialect:${input.model_family}`, text: shipped };
  }

  return composePrompt(
    base,
    { project: project?.overlays ?? [], dialect },
    input.host_family,
    input.model_family,
  );
}
