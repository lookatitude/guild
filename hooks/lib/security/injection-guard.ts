/**
 * hooks/lib/security/injection-guard.ts
 *
 * HK-08 — cheap-tier directive-language detector for guild.handoff.v2
 * free-text fields (summary, notes).
 *
 * PURPOSE:
 *   Before the lead folds a specialist's summary into rolling context, it must
 *   pass a sanitization check that strips/flags "directive language" — patterns
 *   characteristic of prompt-injection attacks smuggled via handoff free-text.
 *
 * SCOPE:
 *   - Inspects: `summary` and `notes` (free-text on guild.handoff.v2)
 *   - Exempt:   `followups` and `assumptions` (structured, not fed verbatim
 *               into rolling context — and not fields on guild.handoff.v2)
 *
 * FAIL MODE:
 *   - Result `flagged` → caller emits guild.security_event.v1 with
 *     event_type=injection_attempt_detected and records in injection-audit.jsonl
 *   - Advisory only: does NOT block the task completion
 *   - `unverified` is the absence state — caller must re-run sanitizer
 *
 * BINDING:
 *   docs/v2/11-security.md §D-INJECT (HK-08 cross-ref)
 *   docs/knowledge/decisions/v2-security-and-untrusted-content.md
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type InjectionClean = "clean" | "flagged" | "unverified";

export interface SanitizeResult {
  /** clean | flagged — never "unverified" (unverified is the absent state) */
  result: "clean" | "flagged";
  /** The text as-received (non-destructive — we flag, not rewrite) */
  sanitized: string;
  /** Names of patterns that matched, for diagnostics + security event detail */
  matchedPatterns: string[];
}

// ── Directive-language patterns (cheap-tier = regex-only, no LLM) ─────────

/**
 * Each entry: { name, pattern }
 *
 * Patterns are compiled once at module load (const). Case-insensitive flag
 * applied universally. Ordered roughly by attack frequency.
 *
 * Design: high precision over recall. Only flag patterns that are essentially
 * never benign in a handoff summary. A pattern should NOT fire on incidental
 * word overlap (e.g. "ignore" alone, "system" alone).
 */
const DIRECTIVE_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  // ── Classic "ignore previous / all / above" ───────────────────────────────
  // Broad form: "ignore [optional modifiers] instructions/prompt/context/directives"
  // Handles: "ignore instructions", "ignore previous instructions",
  //          "ignore above instructions", "ignore all previous directives", etc.
  {
    name: "ignore-previous-instructions",
    re: /\bignore\b(?:\s+\w+){0,3}\s+\b(instructions?|prompt|context|directives?)\b/i,
  },
  {
    name: "disregard-previous-instructions",
    re: /\bdisregard\b(?:\s+\w+){0,3}\s+\b(instructions?|prompt|context)\b/i,
  },
  // "forget [your/my/all] [previous/prior/past] instructions/context"
  {
    name: "forget-previous-instructions",
    re: /\bforget\b(?:\s+(?:your|my|all|previous|prior|past|earlier)){1,3}\s+\b(instructions?|prompt|context|rules?)\b/i,
  },
  {
    name: "override-previous-instructions",
    re: /\boverride\b(?:\s+\w+){0,3}\s+\b(instructions?|context|prompt)\b/i,
  },

  // ── Role-reassignment: "you are now / act as / pretend" ──────────────────
  {
    name: "you-are-now",
    re: /you\s+are\s+now\s+(a|an|the|going|able|authorized|required)/i,
  },
  {
    name: "act-as-if",
    re: /act\s+as\s+(if|though|a|an|the)\b/i,
  },
  {
    name: "pretend-you-are",
    re: /pretend\s+(you\s+are|to\s+be)\b/i,
  },
  {
    name: "your-new-instructions",
    re: /your\s+(new|updated|actual|real|true)\s+(instructions?|persona|role|identity|task)/i,
  },

  // ── System / context injection ────────────────────────────────────────────
  {
    name: "system-prompt",
    re: /system\s+prompt/i,
  },
  {
    name: "markdown-system-block",
    re: /```\s*system\b/i,
  },
  // Anthropic conversation-format injection (\n\nHuman: / \n\nAssistant:)
  {
    name: "anthropic-format-human",
    re: /\n\s*human\s*:/i,
  },
  {
    name: "anthropic-format-assistant",
    re: /\n\s*assistant\s*:/i,
  },
  // HTML comment injection
  {
    name: "html-comment-injection",
    re: /<!--\s*(ignore|override|instruction|system|disregard)/i,
  },

  // ── Jailbreak keywords ────────────────────────────────────────────────────
  {
    name: "jailbreak",
    re: /\bjailbreak\b/i,
  },
] as const;

// ── Core sanitizer ─────────────────────────────────────────────────────────

/**
 * Scan `text` for directive language. Returns the classification result and
 * which patterns (if any) matched. Pure — no I/O, no side effects.
 *
 * Design note: we do NOT mutate the text (non-destructive). The caller decides
 * whether to strip, redact, or pass it through after flagging.
 */
export function sanitizeForInjection(text: string): SanitizeResult {
  const matchedPatterns: string[] = [];

  for (const { name, re } of DIRECTIVE_PATTERNS) {
    if (re.test(text)) {
      matchedPatterns.push(name);
    }
  }

  return {
    result: matchedPatterns.length > 0 ? "flagged" : "clean",
    sanitized: text,
    matchedPatterns,
  };
}

// ── Envelope classifier (task-completed seam) ─────────────────────────────

/**
 * Classify a guild.handoff.v2 envelope's injection safety.
 *
 * Logic:
 *   1. If the specialist pre-computed `injection_clean: clean|flagged`, trust it.
 *   2. If absent or `unverified`, run the sanitizer on summary + notes.
 *
 * `followups` and `assumptions` are exempt — they are not fed verbatim into
 * rolling context and are not fields on guild.handoff.v2.
 *
 * @param envelope A plain object (pre-validation) representing the handoff envelope.
 * @returns The classification: "clean" | "flagged"
 */
export function classifyEnvelope(envelope: Record<string, unknown>): "clean" | "flagged" {
  const existing = envelope["injection_clean"];

  if (existing === "clean") return "clean";
  if (existing === "flagged") return "flagged";
  // absent or "unverified" → run sanitizer

  const summary = typeof envelope["summary"] === "string" ? envelope["summary"] : "";
  const notes = typeof envelope["notes"] === "string" ? envelope["notes"] : "";
  const combined = [summary, notes].filter(Boolean).join("\n");

  const r = sanitizeForInjection(combined);
  return r.result;
}
