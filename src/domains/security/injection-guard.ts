export type InjectionClean = "clean" | "flagged" | "unverified";
export interface SanitizeResult { result: "clean" | "flagged"; sanitized: string; matchedPatterns: string[] }
const PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["ignore-previous-instructions", /\bignore\b(?:\s+\w+){0,3}\s+\b(instructions?|prompt|context|directives?)\b/i],
  ["disregard-previous-instructions", /\bdisregard\b(?:\s+\w+){0,3}\s+\b(instructions?|prompt|context)\b/i],
  ["forget-previous-instructions", /\bforget\b(?:\s+(?:your|my|all|previous|prior|past|earlier)){1,3}\s+\b(instructions?|prompt|context|rules?)\b/i],
  ["override-previous-instructions", /\boverride\b(?:\s+\w+){0,3}\s+\b(instructions?|context|prompt)\b/i],
  ["you-are-now", /you\s+are\s+now\s+(a|an|the|going|able|authorized|required)/i],
  ["act-as-if", /act\s+as\s+(if|though|a|an|the)\b/i],
  ["pretend-you-are", /pretend\s+(you\s+are|to\s+be)\b/i],
  ["your-new-instructions", /your\s+(new|updated|actual|real|true)\s+(instructions?|persona|role|identity|task)/i],
  ["system-prompt", /system\s+prompt/i], ["markdown-system-block", /```\s*system\b/i],
  ["anthropic-format-human", /\n\s*human\s*:/i], ["anthropic-format-assistant", /\n\s*assistant\s*:/i],
  ["html-comment-injection", /<!--\s*(ignore|override|instruction|system|disregard)/i],
  ["jailbreak", /\bjailbreak\b/i],
];
export function sanitizeForInjection(text: string): SanitizeResult {
  const matchedPatterns = PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
  return { result: matchedPatterns.length ? "flagged" : "clean", sanitized: text, matchedPatterns };
}
export function classifyEnvelope(envelope: Record<string, unknown>): "clean" | "flagged" {
  if (envelope.injection_clean === "clean" || envelope.injection_clean === "flagged")
    return envelope.injection_clean;
  return sanitizeForInjection([envelope.summary, envelope.notes].filter((v): v is string => typeof v === "string").join("\n")).result;
}
