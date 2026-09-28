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
 * gated. Bash is shell-word normalized (quotes and escapes stripped); a
 * redirection or `tee` operand into the wiki is refused, and so is any command
 * outside a small read-only allowlist whose words (or any path fragment inside
 * a word, e.g. a `node -e` literal or `of=`) resolve under the wiki. A path
 * computed at run time (variables, string joins) is not parseable from the text.
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
  for (const seg of abs.slice(current.length).split(/[\\/]+/)) {
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
  const expanded = target === "~" || target.startsWith("~/") ? os.homedir() + target.slice(1) : target;
  const abs = realpathDeep(path.isAbsolute(expanded) ? expanded : cwd + path.sep + expanded);
  return wikiRoots.some((root) => isWithin(realpathDeep(root), abs));
}

type Tok = { kind: "word"; value: string } | { kind: "op"; value: string };

const CONTROL = new Set([";", "&", "|", "&&", "||", "|&", ";;", "\n", "(", ")", "`", "$(", "{", "}"]);

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

const isRedirect = (op: string): boolean => /^\d*(>>?|>\||>&|<>)$|^&>>?$/.test(op);

/** Split tokens into simple commands: their words plus their redirection targets. */
function simpleCommands(tokens: Tok[]): Array<{ words: string[]; redirects: string[] }> {
  const cmds: Array<{ words: string[]; redirects: string[] }> = [];
  let cur = { words: [] as string[], redirects: [] as string[] };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === "op" && CONTROL.has(t.value)) {
      if (cur.words.length > 0 || cur.redirects.length > 0) cmds.push(cur);
      cur = { words: [], redirects: [] };
      continue;
    }
    if (t.kind === "op") {
      const next = tokens[i + 1];
      if (next?.kind !== "word") continue;
      i++;
      // `>&1` / `>&-` duplicate an fd; `<`, `<<`, `<<<` read.
      if (isRedirect(t.value) && !(t.value.endsWith(">&") && /^(\d+|-)$/.test(next.value))) {
        cur.redirects.push(next.value);
      }
      continue;
    }
    cur.words.push(t.value);
  }
  if (cur.words.length > 0 || cur.redirects.length > 0) cmds.push(cur);
  return cmds;
}

/** The file targets a Bash command writes by redirection or `tee`, where the text names them. */
export function bashWriteTargets(command: string): string[] {
  const redirects: string[] = [];
  const tees: string[] = [];
  for (const c of simpleCommands(shellTokens(command))) {
    redirects.push(...c.redirects.filter((t) => t.length > 0));
    const name = c.words[0] !== undefined ? path.basename(c.words[0]) : "";
    if (name === "tee") tees.push(...c.words.slice(1).filter((w) => w.length > 0 && !w.startsWith("-")));
  }
  return [...redirects, ...tees];
}

/** Commands that never write their operands (their redirections are still checked). */
const READERS = new Set([
  "cat", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "rg", "ag", "ls", "wc",
  "diff", "cmp", "stat", "file", "test", "[", "echo", "printf", "realpath", "readlink",
  "basename", "dirname", "jq", "bat", "cut", "tr", "nl", "md5", "shasum", "sha256sum", "du",
  "cd", "pwd", "true", "false",
]);
const GIT_READS = new Set(["log", "show", "diff", "status", "blame", "grep", "ls-files", "rev-parse", "cat-file"]);
const FIND_WRITES = /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/;
const WRAPPERS = new Set(["env", "command", "builtin", "exec", "nohup", "time", "nice", "sudo", "stdbuf"]);
const FRAGMENT_SPLIT = /[\s'"`(),;=<>|&{}[\]+:]+/;

/**
 * The first word of a Bash command that would write under the wiki, or null.
 * `inWiki` decides whether one path string resolves under the wiki.
 */
export function bashWikiWriteTarget(command: string, inWiki: (p: string) => boolean): string | null {
  const names = (w: string): string | null =>
    inWiki(w) ? w : (w.split(FRAGMENT_SPLIT).find((f) => f.length > 0 && f !== w && inWiki(f)) ?? null);
  for (const c of simpleCommands(shellTokens(command))) {
    const hit = c.redirects.find(inWiki);
    if (hit !== undefined) return hit;
    let words = c.words;
    while (words.length > 0 && (WRAPPERS.has(path.basename(words[0]!)) || /^[A-Za-z_]\w*=/.test(words[0]!))) {
      words = words.slice(1);
    }
    if (words.length === 0) continue;
    const name = path.basename(words[0]!);
    const args = words.slice(1);
    const reader =
      READERS.has(name) ||
      // sed reads unless in-place, or unless its script names a wiki path (`w FILE`).
      (name === "sed" &&
        !args.some((a) => /^(--in-place|-[a-zA-Z]*i)/.test(a)) &&
        !args.some((a) => !inWiki(a) && names(a) !== null)) ||
      (name === "find" && !args.some((a) => FIND_WRITES.test(a))) ||
      (name === "git" && GIT_READS.has(args.find((a) => !a.startsWith("-")) ?? ""));
    if (reader) continue;
    for (const w of words) {
      const n = names(w);
      if (n !== null) return n;
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
    return typeof input["command"] === "string" ? bashWikiWriteTarget(input["command"], inWiki) : null;
  }
  return toolWriteTargets(tool, input).find(inWiki) ?? null;
}
