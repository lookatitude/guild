/**
 * hooks/lib/security/lane-wiki-guard.ts
 *
 * KTD35 "specialists never Write wiki", as code (plr-wi-15-3). A lane worker —
 * a session with GUILD_TASK_ID or GUILD_LANE_ID set — may not write under this
 * root's wiki (the caller passes the roots from GuildStorage `knowledge()`). It
 * stages a knowledge candidate instead and the lead promotes it through harvest. The lead / T0 session (neither var
 * set) is not a lane worker, and the harvest writer is an in-process knowledge
 * domain call, not a tool call, so neither reaches this guard.
 *
 * The target is resolved PHYSICALLY, one raw segment at a time (a symlink is
 * followed before a later `..` pops it, as the kernel does), and containment is
 * a path.relative check, so `alias/../x` and `wiki/..hidden` are both judged
 * where they really land. Write / Edit / MultiEdit / NotebookEdit are fully
 * gated. Bash fails closed: a command whose shell-word-normalized text (quotes
 * and escapes stripped, substitutions included), any quoted literal or absolute
 * run of it (spaces kept), names any path resolving under
 * the wiki is refused, whatever the verb; there is no reader allowlist, and a
 * lane reads the wiki through Read / Grep / Glob. A path computed at run time
 * (variables, string joins, globs, `cd` then a relative path) is not visible in
 * the text.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** True when the env names a lane worker (either id set, non-empty). */
export function isLaneWorker(env: NodeJS.ProcessEnv): boolean {
  const task = env["GUILD_TASK_ID"];
  const lane = env["GUILD_LANE_ID"];
  return (typeof task === "string" && task.length > 0) || (typeof lane === "string" && lane.length > 0);
}

/**
 * Resolve absolute `p` physically, walking its RAW segments: each existing
 * segment is realpath'd before the next `..` applies; a dangling symlink is
 * followed to its target; segments past the deepest existing one join lexically.
 */
export function realpathDeep(p: string, depth = 0): string {
  const abs = path.isAbsolute(p) ? p : process.cwd() + path.sep + p;
  let current = path.parse(abs).root;
  let exists = true;
  // Split on the platform separator only: on POSIX a backslash is part of a name
  // (`..\\x.md` is a file inside the directory, not a climb out of it).
  const SEP = path.sep === "\\" ? /[\\/]+/ : /\/+/;
  for (const seg of abs.slice(current.length).split(SEP)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      current = path.dirname(current);
      continue;
    }
    const next = path.join(current, seg);
    if (!exists) {
      current = next;
      continue;
    }
    try {
      current = fs.realpathSync(next);
      continue;
    } catch {
      /* missing, or a dangling / looping symlink */
    }
    let link: string | null = null;
    try {
      if (fs.lstatSync(next).isSymbolicLink()) link = fs.readlinkSync(next);
    } catch {
      /* does not exist */
    }
    if (link !== null && depth < 40) {
      current = realpathDeep(path.isAbsolute(link) ? link : current + path.sep + link, depth + 1);
    } else {
      exists = false;
      current = next;
    }
  }
  return current;
}

/** Is `child` equal to or inside `root` (both absolute, resolved)? */
export function isWithin(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

/** Does `target` (resolved against `cwd`) realpath under one of `wikiRoots`? */
export function resolvesUnderWiki(wikiRoots: readonly string[], target: string, cwd: string): boolean {
  if (target.length === 0) return false;
  // A quoted `~` is literal to the shell and an unquoted one expands; the scanner
  // cannot tell which, so both readings are checked.
  const readings = [target];
  if (target === "~" || target.startsWith("~/")) readings.push(os.homedir() + target.slice(1));
  const roots = wikiRoots.map((root) => realpathDeep(root));
  return readings.some((r) => {
    const abs = realpathDeep(path.isAbsolute(r) ? r : cwd + path.sep + r);
    return roots.some((root) => isWithin(root, abs));
  });
}

type Tok = { kind: "word"; value: string } | { kind: "op"; value: string };

/**
 * Shell-word lexer: quotes and backslash escapes are removed from words, and
 * control / redirection operators come out as separate tokens. Not a full shell
 * grammar; anything it cannot read stays a word, which the guard then scans.
 */
export function shellTokens(command: string): Tok[] {
  const out: Tok[] = [];
  let word = "";
  let inWord = false;
  let quoted = false;
  const flush = (): void => {
    if (inWord) out.push({ kind: "word", value: word });
    word = "";
    inWord = false;
    quoted = false;
  };
  const s = command;
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "\\") {
      if (s[i + 1] === "\n") {
        i += 2;
        continue;
      }
      word += s[i + 1] ?? "";
      inWord = true;
      quoted = true;
      i += 2;
      continue;
    }
    if (c === "'" || (c === "$" && s[i + 1] === "'")) {
      const start = c === "$" ? i + 2 : i + 1;
      const end = s.indexOf("'", start);
      word += s.slice(start, end === -1 ? s.length : end);
      inWord = true;
      quoted = true;
      i = end === -1 ? s.length : end + 1;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length && '"\\$`\n'.includes(s[i + 1]!)) {
          if (s[i + 1] !== "\n") word += s[i + 1];
          i += 2;
        } else {
          word += s[i];
          i++;
        }
      }
      i++;
      inWord = true;
      quoted = true;
      continue;
    }
    if (c === "#" && !inWord) {
      const nl = s.indexOf("\n", i);
      i = nl === -1 ? s.length : nl;
      continue;
    }
    if (c === " " || c === "\t") {
      flush();
      i++;
      continue;
    }
    if (c === ">" || c === "<") {
      // A bare digit run right before the operator is its fd number.
      const fd = inWord && !quoted && /^\d+$/.test(word) ? word : "";
      if (fd !== "") {
        word = "";
        inWord = false;
      }
      flush();
      const m = /^(<<<|<<-|<<|<>|<&|<|>>|>\||>&|>)/.exec(s.slice(i))!;
      out.push({ kind: "op", value: fd + m[1] });
      i += m[1]!.length;
      continue;
    }
    if (c === "&" && s[i + 1] === ">") {
      flush();
      const op = s[i + 2] === ">" ? "&>>" : "&>";
      out.push({ kind: "op", value: op });
      i += op.length;
      continue;
    }
    if (c === "$" && s[i + 1] === "(") {
      flush();
      out.push({ kind: "op", value: "$(" });
      i += 2;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === "&&" || two === "||" || two === "|&" || two === ";;") {
      flush();
      out.push({ kind: "op", value: two });
      i += 2;
      continue;
    }
    if (";&|()`\n".includes(c) || ((c === "{" || c === "}") && !inWord)) {
      flush();
      out.push({ kind: "op", value: c });
      i++;
      continue;
    }
    word += c;
    inWord = true;
    i++;
  }
  flush();
  return out;
}

const SUBSTITUTION = /\$\(|`|\$\{|[<>]\(/;
const FRAGMENT_SPLIT = /[\s'"`(),;=<>|&{}[\]+:]+/;

/**
 * Every shell word of `command`, quotes and escapes stripped, plus the words of
 * any `$(...)`, backtick, `${...}` or process substitution inside a word
 * (double-quoted substitutions included), re-lexed to a bounded depth.
 */
export function bashWords(command: string, depth = 0): string[] {
  const words: string[] = [];
  for (const t of shellTokens(command)) {
    if (t.kind !== "word") continue;
    words.push(t.value);
    if (depth < 8 && SUBSTITUTION.test(t.value)) words.push(...bashWords(t.value, depth + 1));
  }
  return words;
}

const QUOTES = "'\"`";
const SPAN_START = /[\s'"`(,=:[{]/;
const SPAN_END = /['"`),;\]}|&<>\n]/;

/**
 * Every quoted string literal in `text`, spaces kept: the content from EACH
 * quote character to the next same unescaped quote, so a stray apostrophe
 * cannot shift the pairing off the path literal. Nested literals are re-read
 * to a bounded depth; a backslash-unescaped copy is added too.
 */
/** Candidate ceiling per scan; a command that reaches it is refused, never half-scanned. */
export const MAX_SCAN_CANDIDATES = 4096;

/** Thrown when a command yields more candidates than the scanner will check. */
export class ScanExhausted extends Error {}

export function quotedLiterals(text: string, depth = 0): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (out.length >= MAX_SCAN_CANDIDATES) throw new ScanExhausted("quoted-literal scan exhausted");
    const q = text[i]!;
    if (!QUOTES.includes(q)) continue;
    let j = i + 1;
    while (j < text.length && text[j] !== q) j += q !== "'" && text[j] === "\\" ? 2 : 1;
    if (j >= text.length) continue;
    const body = text.slice(i + 1, j);
    out.push(body, body.replace(/\\(.)/g, "$1"));
    if (depth < 4) out.push(...quotedLiterals(body, depth + 1));
  }
  return out;
}

/** Every absolute (`/`, `~/`) run in `text` up to a hard delimiter, spaces kept. */
export function absoluteSpans(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const starts = text[i] === "/" || (text[i] === "~" && text[i + 1] === "/");
    if (!starts || (i > 0 && !SPAN_START.test(text[i - 1]!))) continue;
    let j = i;
    while (j < text.length && !SPAN_END.test(text[j]!)) j++;
    out.push(text.slice(i, j), text.slice(i, j).trimEnd());
  }
  return out;
}

/**
 * The first path a Bash command names that resolves under the wiki, or null,
 * whatever the command verb. Checked: each normalized word; every quoted
 * literal and absolute run in the raw text and in each word, spaces kept; each
 * fragment of a word (`--output=`, `of=`, `${x:-...}` defaults); and the raw
 * text with quotes and backslashes removed. `inWiki` decides one string.
 */
export function bashWikiPath(command: string, inWiki: (p: string) => boolean): string | null {
  try {
    return scanBashWikiPath(command, inWiki);
  } catch (err) {
    // Fail closed: a command too large to scan fully is refused as if it named the wiki.
    if (err instanceof ScanExhausted) return "(command exceeds the wiki-path scan limit)";
    throw err;
  }
}

function scanBashWikiPath(command: string, inWiki: (p: string) => boolean): string | null {
  const seen = new Set<string>();
  const check = (c: string): boolean => {
    if (c.length === 0 || seen.has(c)) return false;
    seen.add(c);
    return inWiki(c);
  };
  const words = bashWords(command);
  for (const w of [...words, command]) {
    for (const c of [...quotedLiterals(w), ...absoluteSpans(w)]) if (check(c)) return c;
  }
  for (const w of [...words, command.replace(/["'\\]/g, "")]) {
    if (check(w)) return w;
    for (const f of w.split(FRAGMENT_SPLIT)) {
      if (check(f)) return f;
      const bare = f.replace(/^[-?#%!@*]+/, "");
      if (check(bare)) return bare;
    }
  }
  return null;
}

/** Every file target a Write / Edit / MultiEdit / NotebookEdit call writes. */
export function toolWriteTargets(tool: string, input: Record<string, unknown>): string[] {
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const t = typeof input["file_path"] === "string" ? input["file_path"] : input["notebook_path"];
    return typeof t === "string" && t.length > 0 ? [t] : [];
  }
  return [];
}

/**
 * The first wiki target a lane worker's call would write, or null. Pure apart
 * from the realpath reads. Null for any non-lane session.
 */
export function laneWikiWriteTarget(
  env: NodeJS.ProcessEnv,
  tool: string,
  input: Record<string, unknown>,
  wikiRoots: readonly string[],
  cwd: string,
): string | null {
  if (!isLaneWorker(env)) return null;
  const inWiki = (t: string): boolean => resolvesUnderWiki(wikiRoots, t, cwd);
  if (tool === "Bash") {
    return typeof input["command"] === "string" ? bashWikiPath(input["command"], inWiki) : null;
  }
  return toolWriteTargets(tool, input).find(inWiki) ?? null;
}
