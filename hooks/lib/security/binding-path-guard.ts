/**
 * CD21 — a lane worker's Read / Grep / Glob / Edit / Write / Bash input naming, or
 * lexically able to resolve to, .guild/runs/<run>/binding.json is refused
 * (binding_path_refused).
 *
 * cooperative_local accident prevention only. The binding's authority comes from the
 * controller holding the nonce, not from this guard. The match is purely lexical: no
 * file is listed, stat'd or read. Supported forms: absolute and relative paths, `.` /
 * `..` / duplicate separators, case (macOS volumes fold it), quotes and backslash
 * escapes, segment globs `* ? [...] {a,b} **`, Glob `path`+`pattern`, Grep `path`+`glob`
 * (a slash-free glob matches at any depth), and in Bash a word naming a binding file
 * together with another word naming a `.guild/runs` directory. NOT covered: variable or
 * command substitution, interpreters and scripts, symlink or hard-link aliases, a
 * recursive Grep/Glob whose filters do not name the file, and tools other than these six.
 */
import { isLaneWorker } from "./lane-wiki-guard.js";
import { sealSet } from "../../../src/domains/kernel/index";

/** Exactly the six native tools the frozen contract names; no projection widening. */
export const BINDING_GUARDED_TOOLS: ReadonlySet<string> = sealSet(["Read", "Grep", "Glob", "Edit", "Write", "Bash"], "BINDING_GUARDED_TOOLS");

/** The limits a deny reason states, so no caller reads the guard as isolation. */
export const BINDING_GUARD_LIMITS =
  "cooperative_local lexical guard; variable/command substitution, interpreters and symlink or hard-link aliases are not covered";

// A literal run binding path anywhere in any string input (the original CD21 rule).
const BINDING_PATH = /(^|[\\/\s"'=:])\.guild[\\/]runs[\\/][^\\/\s"']+[\\/]binding\.json(?![\w.-])/;

/** `.guild/runs/<run>/binding.json`; `null` is the run slot (any single segment). */
const TARGET: ReadonlyArray<string | null> = [".guild", "runs", null, "binding.json"];
const MAX_BRACE_EXPANSIONS = 256;

/** Expand `{a,b}` sets; past the bound every remaining set becomes `*` (a superset). */
function expandBraces(pattern: string): string[] {
  const out: string[] = [];
  const queue = [pattern];
  while (queue.length > 0) {
    const s = queue.shift()!;
    const set = firstBraceSet(s);
    if (set === null) {
      out.push(s);
      continue;
    }
    if (out.length + queue.length + set.alternatives.length > MAX_BRACE_EXPANSIONS) {
      out.push(s.replace(/\{[^{}]*\}/g, "*"));
      continue;
    }
    for (const alt of set.alternatives) queue.push(s.slice(0, set.start) + alt + s.slice(set.end + 1));
  }
  return out;
}

function firstBraceSet(s: string): { start: number; end: number; alternatives: string[] } | null {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue; }
    if (s[i] !== "{") continue;
    let depth = 0;
    const commas: number[] = [];
    for (let j = i; j < s.length; j++) {
      if (s[j] === "\\") { j++; continue; }
      if (s[j] === "{") depth++;
      else if (s[j] === "}" && --depth === 0) {
        if (commas.length === 0) break;
        const cuts = [i, ...commas, j];
        return { start: i, end: j, alternatives: cuts.slice(0, -1).map((c, k) => s.slice(c + 1, cuts[k + 1])) };
      } else if (s[j] === "," && depth === 1) commas.push(j);
    }
  }
  return null;
}

/** One glob segment as an anchored, case-insensitive RegExp. */
function segmentRegex(seg: string): RegExp {
  let re = "";
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]!;
    if (c === "\\" && i + 1 < seg.length) re += escapeRe(seg[++i]!);
    else if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else if (c === "[") {
      const close = seg.indexOf("]", i + 2);
      if (close === -1) { re += "\\["; continue; }
      let body = seg.slice(i + 1, close);
      const negate = body.startsWith("!") || body.startsWith("^");
      if (negate) body = body.slice(1);
      re += `[${negate ? "^" : ""}${body.replace(/[\\\]^]/g, "\\$&")}]`;
      i = close;
    } else re += escapeRe(c);
  }
  try {
    return new RegExp(`^${re}$`, "i");
  } catch {
    // An invalid class (e.g. `[z-a]`) cannot be proven not to name the binding; every caller denies on a match.
    return /^[\s\S]*$/;
  }
}

function escapeRe(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Lexical segments: `.`/empty dropped, `..` pops its parent. `\` is an escape in glob mode, a separator otherwise. */
function segments(p: string, glob: boolean): string[] {
  const parts = (glob ? p : p.replace(/\\/g, "/")).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out[out.length - 1] !== ".." && out[out.length - 1] !== "**") out.pop();
    else out.push(part);
  }
  return out;
}

function segmentCanBe(seg: string, slot: string | null): boolean {
  if (slot === null) return seg !== "..";
  return segmentRegex(seg).test(slot);
}

/** Could these segments, after any leading prefix, end exactly at a run binding? */
function canNameBinding(segs: string[]): boolean {
  const from = (gi: number, ti: number): boolean => {
    if (ti === TARGET.length) return segs.slice(gi).every((s) => s === "**");
    if (gi === segs.length) return false;
    const g = segs[gi]!;
    if (g === "**") return from(gi + 1, ti) || from(gi, ti + 1);
    return segmentCanBe(g, TARGET[ti]!) && from(gi + 1, ti + 1);
  };
  for (let i = 0; i <= segs.length; i++) if (from(i, 0)) return true;
  return false;
}

function pathCanNameBinding(p: string, glob: boolean): boolean {
  return expandBraces(p).some((e) => canNameBinding(segments(e, glob)));
}

function joinBase(base: string, rel: string): string {
  return rel.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rel) || base.length === 0 ? rel : `${base}/${rel}`;
}

/** Shell words after quote and escape removal; operators and newlines split words. */
function shellWords(command: string): string[] {
  const words: string[] = [];
  let cur = "";
  let has = false;
  const flush = () => { if (has) words.push(cur); cur = ""; has = false; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      cur += command.slice(i + 1, end === -1 ? command.length : end);
      has = true;
      i = end === -1 ? command.length : end;
    } else if (c === '"') {
      has = true;
      for (i++; i < command.length && command[i] !== '"'; i++) {
        if (command[i] === "\\" && i + 1 < command.length && '"\\$`'.includes(command[i + 1]!)) i++;
        cur += command[i];
      }
    } else if (c === "\\" && i + 1 < command.length) {
      if (command[i + 1] !== "\n") { cur += command[i + 1]; has = true; }
      i++;
    } else if (/[\s;&|<>()]/.test(c)) flush();
    else { cur += c; has = true; }
  }
  flush();
  return words.flatMap((w) => [w, ...w.split("=").slice(1)]);
}

function bashCanNameBinding(command: string): boolean {
  const words = shellWords(command);
  if (words.some((w) => pathCanNameBinding(w, true))) return true;
  // `cd .guild/runs/<run> && cat binding.json`: a run-tree word plus a different word
  // whose final segment can be binding.json.
  const runsWord = (w: string) =>
    expandBraces(w).some((e) => {
      const s = segments(e, true);
      return s.some((g, i) => (g === "**" || segmentCanBe(g, ".guild")) && i + 1 < s.length && (s[i + 1] === "**" || segmentCanBe(s[i + 1]!, "runs")));
    });
  const bindingWord = (w: string) =>
    expandBraces(w).some((e) => {
      const s = segments(e, true);
      const last = s[s.length - 1];
      return last !== undefined && last !== "**" && segmentCanBe(last, "binding.json");
    });
  return words.some((r, i) => runsWord(r) && words.some((b, j) => j !== i && bindingWord(b)));
}

/** The offending input string, or null when the guard has no opinion. */
export function laneBindingPathTarget(
  env: NodeJS.ProcessEnv,
  tool: string,
  input: Record<string, unknown>,
): string | null {
  if (!isLaneWorker(env) || !BINDING_GUARDED_TOOLS.has(tool)) return null;
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const strings = Object.values(input).filter((v): v is string => typeof v === "string");
  const base = str("path");
  // Original rule: a literal binding path in any string input, plus Glob/Grep joins.
  const legacy = [...strings];
  for (const key of ["pattern", "glob"]) if (str(key) && base) legacy.push(`${base}/${str(key)}`);
  const literal = legacy.find((s) => BINDING_PATH.test(s));
  if (literal !== undefined) return literal;

  // Path-valued fields, matched lexically (globs included).
  for (const key of ["file_path", "notebook_path", "path"]) {
    if (str(key) && pathCanNameBinding(str(key), false)) return str(key);
  }
  if (tool === "Glob" && str("pattern")) {
    const joined = joinBase(base, str("pattern"));
    if (pathCanNameBinding(joined, true)) return joined;
  }
  if (tool === "Grep" && str("glob")) {
    const g = str("glob");
    const joined = joinBase(base, g.includes("/") ? g : `**/${g}`);
    if (pathCanNameBinding(joined, true)) return joined;
  }
  if (tool === "Bash" && str("command") && bashCanNameBinding(str("command"))) return str("command");
  return null;
}
