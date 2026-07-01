/**
 * tests/dot-guild/no-v1-compat.test.ts
 *
 * SC-VALIDATION grep-gate (W3): machine-checkable proof that NO v1 compat code
 * survives in the shipped plugin tree outside the one allowlisted survivor —
 * the on-open .guild→v2 converter + its wiring.
 *
 * The operator's criterion (verbatim from spec.md SC-VALIDATION):
 *   "Apart from the migration logic and its wiring (the on-tool-open .guild→v2
 *    converter), ALL other v1 code is either already part of v2 or has been
 *    removed. No standalone v1 compat shims / deprecated aliases / redirect
 *    stubs remain in the shipped v2 tree."
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THREAT MODEL (what this gate IS and IS NOT)
 * ──────────────────────────────────────────────────────────────────────────
 * This is a REGRESSION gate: it catches accidental reintroduction of v1-compat
 * code and proves the current tree is clean. It is NOT a defense against a
 * developer who deliberately smuggles a shim behind the allowlist — that is a
 * code-review concern, not a grep concern.
 *
 * Accepted boundaries (documented per codex review D1/D10/D12/D14):
 *   - D1: `scripts/dot-guild/convert/**` is the DESIGNATED v1-aware survivor.
 *     It is SUPPOSED to contain v1-aware code (it reads/converts v1 trees). A
 *     grep gate cannot distinguish legitimate converter logic from a smuggled
 *     shim inside it — that distinction is a code-review responsibility. We
 *     allowlist the whole converter subtree and accept this boundary.
 *   - D10: `hooks/lib/v1.4/log-jsonl.ts` "backward-compat shim" is a
 *     FUNCTION-SIGNATURE compat where "v1.4" is the events-LOG schema version,
 *     NOT Guild v1. Out of scope — not gated.
 *   - D12: `GuildDispatchDescriptor` (the v2 rename target) is correct v2 code,
 *     never a target. Only the OLD `AgentDispatchDescriptor` name is forbidden.
 *   - D14: plugin-local `.guild/` is runtime data for Guild's own self-build,
 *     not shipped plugin source. Allowlisted.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SCAN SURFACE
 * ──────────────────────────────────────────────────────────────────────────
 * Two surfaces are scanned:
 *   (A) SOURCE tree: scripts/**, hooks/** (.ts), commands/**, skills/**,
 *       templates/**, agents/**, plus scaffold/fixture .json/.yaml.
 *   (B) SHIPPED DIST bundles: hooks/dist, hooks/agent-team/dist,
 *       mcp-servers/<name>/dist — the COMPILED code that actually ships and
 *       runs. The stale-bundle-with-metadata.json bug (source fixed, bundle
 *       stale) lives precisely here, so the gate MUST scan compiled output.
 *       Exempts the allowlisted converter-wiring bundle
 *       (hooks/dist/detect-guild-version.js) only.
 *
 * All checks use Node's `fs` + recursive walk — zero network, zero random,
 * deterministic by construction. Each assertion names file:line so any
 * regression is immediately actionable.
 */

import * as fs from "fs";
import * as path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Root of the plugin SOURCE tree (relative to this test file's location)
// ─────────────────────────────────────────────────────────────────────────────

const PLUGIN_ROOT = path.resolve(__dirname, "../../");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk a directory recursively and return all regular files with the given
 * extensions. Skips node_modules. By default skips `dist/` (source-only walk);
 * pass `includeDist: true` to walk compiled bundles too.
 */
function walk(
  dir: string,
  exts: string[],
  opts: { includeDist?: boolean } = {}
): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      if (entry.name === "dist" && !opts.includeDist) continue;
      // SCAN-SCOPE: `.guild/` is project-local RUNTIME state (run traces, payloads,
      // context bundles, reflections) — or runtime-shaped fixture data — never shipped
      // plugin source. Skip every `.guild/` subtree wherever it nests (e.g. the
      // gitignored `scripts/.guild/runs/**/logs/payloads/*.json` run-trace payloads that
      // merely CAPTURED test-file text containing `agent_team`). This generalizes the
      // pre-existing top-level `.guild` allowlist (D14) to the nested case; tracked source
      // (scripts/*.ts, hooks/**, commands/**, skills/**, …) stays fully scanned, so a real
      // v1 marker in tracked source still fails (anti-vacuity preserved).
      if (entry.name === ".guild") continue;
      results.push(...walk(full, exts, opts));
    } else if (exts.some((e) => full.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Return true if a file path is within ANY of the allowlisted prefixes.
 * All comparisons use normalized absolute paths.
 */
function isAllowlisted(filePath: string, allowlist: string[]): boolean {
  const norm = path.normalize(filePath);
  return allowlist.some((prefix) => {
    const normPrefix = path.normalize(prefix);
    // Exact match (e.g. MIGRATION.md) or subtree prefix
    return norm === normPrefix || norm.startsWith(normPrefix + path.sep);
  });
}

/** Strip the "file:line: " prefix produced by grepFile, returning the raw line. */
function lineTextOf(hit: string): string {
  return hit.replace(/^[^\n]*?:\d+:\s?/, "");
}

/** True if a trimmed source line is a comment line (//, /*, *, or markdown >). */
function isCommentLine(rawLine: string): boolean {
  const t = rawLine.trim();
  return /^(\/\/|\/\*|\*)/.test(t);
}

/** Grep a single file for a regex. Returns array of "file:line: <text>" strings. */
function grepFile(filePath: string, pattern: RegExp): string[] {
  const hits: string[] = [];
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    if (pattern.test(line)) {
      hits.push(`${filePath}:${idx + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

/**
 * Scan all SOURCE files in PLUGIN_ROOT with given extensions (dist excluded),
 * skip allowlisted paths, return hits matching the pattern.
 */
function scanForPattern(
  pattern: RegExp,
  exts: string[],
  allowlist: string[]
): string[] {
  const files = walk(PLUGIN_ROOT, exts);
  const hits: string[] = [];
  for (const f of files) {
    if (isAllowlisted(f, allowlist)) continue;
    hits.push(...grepFile(f, pattern));
  }
  return hits;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shipped DIST bundle discovery (D2)
//
// The non-node_modules dist directories that ship compiled, runnable code:
//   hooks/dist/                  — native hook bundles
//   hooks/agent-team/dist/       — agent-team hook bundles
//   mcp-servers/*/dist/          — MCP server bundles
//
// detect-guild-version.js is the compiled CONVERTER WIRING — allowlisted.
// ─────────────────────────────────────────────────────────────────────────────

const SHIPPED_DIST_DIRS = [
  path.join(PLUGIN_ROOT, "hooks/dist"),
  path.join(PLUGIN_ROOT, "hooks/agent-team/dist"),
  path.join(PLUGIN_ROOT, "mcp-servers/guild-memory/dist"),
  path.join(PLUGIN_ROOT, "mcp-servers/guild-telemetry/dist"),
];

// The single dist file exempt from the scan: the compiled converter wiring.
const DIST_ALLOWLIST = [
  path.join(PLUGIN_ROOT, "hooks/dist/detect-guild-version.js"),
];

/** Collect all shipped .js dist bundles, excluding the allowlisted wiring bundle. */
function shippedDistFiles(): string[] {
  const out: string[] = [];
  for (const d of SHIPPED_DIST_DIRS) {
    if (!fs.existsSync(d)) continue;
    // includeDist so the walker descends into the dist/ dir itself.
    for (const f of walk(d, [".js"], { includeDist: true })) {
      if (isAllowlisted(f, DIST_ALLOWLIST)) continue;
      out.push(f);
    }
  }
  return out;
}

/** Grep every shipped dist bundle for a pattern. */
function scanDistForPattern(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const f of shippedDistFiles()) {
    hits.push(...grepFile(f, pattern));
  }
  return hits;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHIPPED SOURCE roots (G2)
//
// The .ts/.js SOURCE roots that compile into shipped, runnable code. Markers
// with their OWN bespoke scan (Marker 5 metadata-write) must iterate THESE, not
// just scripts/ + hooks/. Critically includes `mcp-servers/<name>/src` — an MCP
// server is real shipped source; a marker there would otherwise only be caught
// after a dist refresh.
//
// Markers that use scanSource() already cover mcp-servers/*/src implicitly (it
// walks the whole PLUGIN_ROOT minus node_modules/dist/allowlist). SHIPPED_SOURCE_ROOTS
// exists for the bespoke-scan markers that do NOT use scanSource.
// ─────────────────────────────────────────────────────────────────────────────

const SHIPPED_SOURCE_ROOTS = [
  path.join(PLUGIN_ROOT, "scripts"),
  path.join(PLUGIN_ROOT, "hooks"),
  path.join(PLUGIN_ROOT, "mcp-servers/guild-memory/src"),
  path.join(PLUGIN_ROOT, "mcp-servers/guild-telemetry/src"),
];

/** Collect all .ts source files under SHIPPED_SOURCE_ROOTS, minus allowlist + tests. */
function shippedSourceTsFiles(): string[] {
  const out: string[] = [];
  for (const root of SHIPPED_SOURCE_ROOTS) {
    for (const f of walk(root, [".ts"])) {
      if (isAllowlisted(f, ALLOWLIST)) continue;
      if (f.includes(path.sep + "__tests__" + path.sep)) continue;
      out.push(f);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Allowlist (absolute paths) — SOURCE scan
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWLIST = [
  // The one allowed v1-aware survivor: converter + wiring (D1 accepted boundary)
  path.join(PLUGIN_ROOT, "scripts/dot-guild/convert"),
  path.join(PLUGIN_ROOT, "scripts/dot-guild/migrate-guild.ts"),
  path.join(PLUGIN_ROOT, "scripts/dot-guild/migrate.ts"),
  // Module-source mirror of the same converter+wiring bundle (the module-tree
  // reorg, 27a388f, duplicated scripts/dot-guild/ under src/modules/migrations/).
  // Same D1 accepted boundary — mirror the three converter entries exactly (NOT
  // the sibling audit.ts/scrub.ts, which stay scanned).
  path.join(PLUGIN_ROOT, "src/modules/migrations/resources/scripts/dot-guild/convert"),
  path.join(PLUGIN_ROOT, "src/modules/migrations/resources/scripts/dot-guild/migrate-guild.ts"),
  path.join(PLUGIN_ROOT, "src/modules/migrations/resources/scripts/dot-guild/migrate.ts"),
  path.join(PLUGIN_ROOT, "hooks/detect-guild-version.ts"),
  path.join(PLUGIN_ROOT, "hooks/dist"), // dist scanned separately via scanDistForPattern
  // Test SUITES (D3): narrowed — only the test-runner files + fixtures.
  // Non-test .ts under tests/ (e.g. tests/workspace/_fixtures.ts) IS scanned.
  // These are handled by the dedicated isTestAllowlisted() below, not here.
  path.join(PLUGIN_ROOT, "scripts/__tests__"),
  path.join(PLUGIN_ROOT, "hooks/__tests__"),
  // Docs / history: document what was removed, not live code
  path.join(PLUGIN_ROOT, "MIGRATION.md"),
  // Removal documentation (same class as MIGRATION.md): the changelog and
  // release notes legitimately NAME removed v1 surfaces.
  path.join(PLUGIN_ROOT, "CHANGELOG.md"),
  path.join(PLUGIN_ROOT, "docs", "RELEASE-NOTES-2.0.0.md"),
  path.join(PLUGIN_ROOT, "CHANGELOG.md"),
  // .guild/ data: v1 on-disk artifacts legitimately contain v1 content (D14)
  path.join(PLUGIN_ROOT, ".guild"),
];

/**
 * D3: narrow the tests/ allowlist. Only *.test.ts / *.test.js (the test runners
 * that NAME markers to assert removal) and tests/**\/fixtures/** are exempt.
 * A non-test .ts under tests/ (a shared helper, an accidentally-checked-in
 * shim) IS scanned.
 */
function isTestAllowlisted(filePath: string): boolean {
  const norm = path.normalize(filePath);
  const testsRoot = path.normalize(path.join(PLUGIN_ROOT, "tests"));
  if (!norm.startsWith(testsRoot + path.sep)) return false;
  // Exempt the test-runner files themselves.
  if (/\.test\.(ts|js)$/.test(norm)) return true;
  // Exempt anything under a fixtures/ directory.
  if (norm.includes(path.sep + "fixtures" + path.sep)) return true;
  return false;
}

/**
 * Combined source scan that applies BOTH the prefix allowlist and the narrowed
 * tests/ rule. This replaces the bare scanForPattern for markers that scan the
 * tests/ tree.
 */
function scanSource(pattern: RegExp, exts: string[]): string[] {
  const files = walk(PLUGIN_ROOT, exts);
  const hits: string[] = [];
  for (const f of files) {
    if (isAllowlisted(f, ALLOWLIST)) continue;
    if (isTestAllowlisted(f)) continue;
    hits.push(...grepFile(f, pattern));
  }
  return hits;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source file extensions to scan
// ─────────────────────────────────────────────────────────────────────────────

const CODE_EXTS = [".ts", ".js"];
const ALL_EXTS = [".ts", ".js", ".md"];
const CONFIG_EXTS = [".json", ".yaml", ".yml"];

// ═════════════════════════════════════════════════════════════════════════════

describe("SC-VALIDATION: no v1 compat outside converter+wiring", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Marker 1 (D4 + D11): agent_team as a CONFIG KEY, across access forms + file types
  //
  // The removed v1 alias is the `defaults.agent_team` CONFIG KEY. v2 replaced it
  // with the top-level `agent_mode`. A live regression could re-introduce it as:
  //   defaults.agent_team           (dotted member access)
  //   defaults["agent_team"]        (bracket string access)
  //   defaults?.["agent_team"]      (optional bracket access)
  //   const { agent_team } = defaults   (destructure off a `defaults` object)
  //   agent_team: <val>             (a YAML/JSON config key in a scaffold/fixture)
  //
  // MUST NOT flag the legitimate v2 keys that merely contain the substring:
  //   tool_support.agent_team       (host CAPABILITY flag — write-host-capability.ts, host-router.ts)
  //   user_approved_agent_team      (team.yaml user-approval flag for agent_mode:team)
  //   backendForMode → "agent_team" (a BackendCapability key, not a config key)
  //
  // Strategy: a set of forbidden FORMS, each precise enough to exclude the
  // legitimate keys. Comment lines documenting the removal are skipped.
  // ───────────────────────────────────────────────────────────────────────────

  test("Marker 1: agent_team config-key alias absent (all access forms, .ts/.js/.md/.json/.yaml)", () => {
    // Forbidden code/doc forms — the dotted/bracket/destructure access patterns.
    // Each anchors on a `defaults` config object or a bare `agent_team` config
    // key, never on tool_support/user_approved/BackendCapability.
    const codeForms = new RegExp(
      [
        // defaults.agent_team (dotted member access; NOT tool_support.agent_team
        // because the literal "defaults." prefix is required)
        "defaults\\.agent_team",
        // defaults["agent_team"] / defaults?.["agent_team"] (bracket access)
        "defaults\\??\\.?\\[\\s*[\"']agent_team[\"']\\s*\\]",
        // Destructure off a `defaults` object — G4 broadened to accept a member
        // chain ending in `.defaults` OR a bare identifier `defaults`:
        //   const { agent_team } = defaults
        //   const { agent_team } = settings.defaults
        //   const { agent_team } = cfg.foo.defaults
        "\\{[^}]*\\bagent_team\\b[^}]*\\}\\s*=\\s*[^=;]*\\bdefaults\\b",
      ].join("|")
    );
    // .ts/.js: HARD hits (minus comment lines documenting the removal).
    const tsJsHits = scanSource(codeForms, CODE_EXTS).filter(
      (h) => !isCommentLine(lineTextOf(h))
    );

    // .md: prose may legitimately DOCUMENT the removal ("defaults.agent_team is
    // hard-removed", "supersedes the old defaults.agent_team"). Keep only LIVE
    // usage — drop removal-documentation prose. A live .md hit would be an
    // argument-hint or config example presenting agent_team as an ACTIVE key.
    const mdHits = scanSource(codeForms, [".md"]).filter((h) => {
      const lower = lineTextOf(h).toLowerCase();
      return (
        !lower.includes("supersede") &&
        !lower.includes("removed") &&
        !lower.includes("hard-removed") &&
        !lower.includes("replaced") &&
        !lower.includes("replaces") &&
        !lower.includes("rejected") &&
        !lower.includes("no warn-once") &&
        !lower.includes("there is no warn-once") &&
        !lower.includes("validation error") &&
        !lower.includes("unknown key") &&
        !lower.includes("→") &&
        !lower.includes("the old")
      );
    });

    const codeHits = [...tsJsHits, ...mdHits];

    // Config-file form: a bare `agent_team:` key (YAML) or `"agent_team":` (JSON).
    // Anchored to start-of-key so `user_approved_agent_team:` does NOT match
    // (it has the `user_approved_` prefix before agent_team, so the key name is
    // not `agent_team`). The (^|[^\w]) guard before agent_team blocks substring
    // matches inside a longer key name.
    const configForms = /(^|[\s{,"])agent_team\s*[:=]/;
    const configHits = scanSource(configForms, CONFIG_EXTS).filter(
      (h) => !isCommentLine(lineTextOf(h))
    );

    const hits = [...codeHits, ...configHits];
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `agent_team config-key alias found in non-allowlisted source (the removed defaults.agent_team alias):\n${hits.join("\n")}`
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Marker 1b (D2): agent_team config-key alias absent from SHIPPED DIST bundles.
  //
  // tsc compilation preserves identifier strings, so `defaults.agent_team` or
  // a `defaults["agent_team"]` access survives into the bundle verbatim. We
  // forbid the dotted + bracket access forms in compiled output. (We do NOT
  // forbid the bare token `agent_team` here because tool_support.agent_team is
  // legitimately compiled into host-capability bundles if any ship.)
  // ───────────────────────────────────────────────────────────────────────────

  test("Marker 1b (dist): agent_team config-key alias absent from shipped bundles", () => {
    const distForms = new RegExp(
      [
        "defaults\\.agent_team",
        "defaults\\??\\.?\\[\\s*[\"']agent_team[\"']\\s*\\]",
      ].join("|")
    );
    const hits = scanDistForPattern(distForms);
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `agent_team config-key alias found in SHIPPED dist bundle:\n${hits.join("\n")}`
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Marker 2: AgentDispatchDescriptor (renamed to GuildDispatchDescriptor) — D12
  // Source + dist.
  // ───────────────────────────────────────────────────────────────────────────

  test("Marker 2: AgentDispatchDescriptor type absent from source", () => {
    const hits = scanSource(/AgentDispatchDescriptor/, CODE_EXTS);
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `AgentDispatchDescriptor (deprecated type alias) found in source:\n${hits.join("\n")}`
      );
    }
  });

  test("Marker 2b (dist): AgentDispatchDescriptor absent from shipped bundles", () => {
    const hits = scanDistForPattern(/AgentDispatchDescriptor/);
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `AgentDispatchDescriptor found in SHIPPED dist bundle:\n${hits.join("\n")}`
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Marker 3: 7 redirect-stub command files must NOT exist
  // ───────────────────────────────────────────────────────────────────────────

  test("Marker 3: 7 redirect-stub command files do not exist", () => {
    const stubs = [
      "guild-wiki.md",
      "guild-evolve.md",
      "guild-rollback.md",
      "guild-stats.md",
      "guild-audit.md",
      "guild-diagnose.md",
      "guild-team.md",
    ];
    const found = stubs
      .map((s) => path.join(PLUGIN_ROOT, "commands", s))
      .filter((p) => fs.existsSync(p));
    expect(found).toEqual([]);
    if (found.length > 0) {
      fail(
        `Redirect-stub command files found (should be deleted):\n${found.join("\n")}`
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Marker 4 (D5 tightened): --codex-review flag handling.
  //
  // `--codex-review` is replaced by `--review=cross`. We treat HANDLER SYNTAX as
  // a HARD hit regardless of any explanatory comment on the line:
  //     === "--codex-review"        | === '--codex-review'
  //     case "--codex-review"
  //     arg.startsWith("--codex-review") / .includes("--codex-review") / .indexOf
  //     "--codex-review": ...        (an options/flag map key)
  //     ["--codex-review"].includes(arg)   (G5 reversed-array membership)
  // For PROSE mentions (markdown), we keep the doc-removal filter so a sentence
  // documenting the v1→v2 rename ("replaces v1 --codex-review") is not a hit.
  // ───────────────────────────────────────────────────────────────────────────

  test("Marker 4: --codex-review handler syntax absent; prose mentions allowed only as removal docs", () => {
    // HARD handler syntax in .ts/.js — a hit regardless of comments.
    const handlerSyntax = new RegExp(
      [
        // === "--codex-review"  /  "--codex-review" ===
        "===?\\s*[\"']--codex-review[\"']",
        "[\"']--codex-review[\"']\\s*===?",
        // case "--codex-review"
        "case\\s+[\"']--codex-review[\"']",
        // arg.startsWith/includes/indexOf("--codex-review")
        "(startsWith|includes|indexOf)\\s*\\(\\s*[\"']--codex-review[\"']",
        // "--codex-review": ...  (options/flag map key)
        "[\"']--codex-review[\"']\\s*:",
        // G5: ["--codex-review"].includes(arg) / [ ..., "--codex-review", ... ].includes(
        "\\[[^\\]]*[\"']--codex-review[\"'][^\\]]*\\]\\s*\\.\\s*(includes|indexOf)\\s*\\(",
      ].join("|")
    );
    const codeHits = scanSource(handlerSyntax, CODE_EXTS);

    // Any --codex-review mention in .md — filtered to keep only LIVE flag usage
    // (a live argument-hint listing the flag as active), dropping removal prose.
    const mdMentions = scanSource(/--codex-review/, [".md"]);
    const liveMdHits = mdMentions.filter((h) => {
      const lower = lineTextOf(h).toLowerCase();
      return (
        !lower.includes("replaced") &&
        !lower.includes("replaces") &&
        !lower.includes("superseded") &&
        !lower.includes("supersedes") &&
        !lower.includes("removed") &&
        !lower.includes("→") &&
        !lower.includes("->") &&
        !lower.includes("v1 flag") &&
        !lower.includes("v1 surface") &&
        !lower.includes("v1 `") &&
        !lower.includes("the v1")
      );
    });

    const hits = [...codeHits, ...liveMdHits];
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `--codex-review live flag handler/usage found:\n${hits.join("\n")}`
      );
    }
  });

  test("Marker 4b (dist): --codex-review absent from shipped bundles", () => {
    const hits = scanDistForPattern(/--codex-review/);
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `--codex-review found in SHIPPED dist bundle:\n${hits.join("\n")}`
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Marker 5 (D6 broadened): metadata.json WRITE anywhere in scripts/ + hooks/
  // source AND shipped dist bundles.
  //
  // The converter legitimately READS legacy metadata.json (convert/** allowlisted).
  // A metadata.json WRITE in any non-converter location is the violation.
  // Handles same-line + template-literal forms:
  //   writeFileSync(".../metadata.json", ...)
  //   writeFileSync(`${dir}/metadata.json`, ...)
  //   fs.writeFile(path.join(dir, "metadata.json"), ...)
  // and the path-built-on-a-prior-line form via a two-pass scan: a line that
  // names metadata.json as a write target OR a write call whose argument region
  // (this line) references a metadata.json path variable.
  // ───────────────────────────────────────────────────────────────────────────

  test("Marker 5: metadata.json is not written anywhere outside the converter (source)", () => {
    const hits: string[] = [];
    // G2: iterate ALL shipped source roots (scripts/ + hooks/ + mcp-servers/*/src),
    // not just scripts/ + hooks/. dist handled by Marker 5b.
    for (const f of shippedSourceTsFiles()) {
      const content = fs.readFileSync(f, "utf8");
      const lines = content.split("\n");

      // ── G1: REAL two-pass split-path detection ──────────────────────────────
      // First pass: find any variable whose assignment references metadata.json,
      // including MULTI-LINE assignments (e.g. a path.join(...) that spans lines).
      // We track an "open assignment" until we see a `;` or a blank line; if the
      // metadata.json token appears anywhere in that span, the assigned variable
      // is a metadata.json path holder.
      const metaPathVars = new Set<string>();
      {
        let openVar: string | null = null;
        let openBuf = "";
        const assignStart = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/;
        for (const line of lines) {
          if (openVar === null) {
            const m = line.match(assignStart);
            if (m) {
              openVar = m[1];
              openBuf = m[2];
              // Single-line assignment terminated by ; on the same line.
              if (/;\s*$/.test(line)) {
                if (/metadata\.json/.test(openBuf)) metaPathVars.add(openVar);
                openVar = null;
                openBuf = "";
              }
            }
          } else {
            openBuf += "\n" + line;
            if (/;\s*$/.test(line) || line.trim() === "") {
              if (/metadata\.json/.test(openBuf)) metaPathVars.add(openVar);
              openVar = null;
              openBuf = "";
            }
          }
        }
        if (openVar !== null && /metadata\.json/.test(openBuf)) {
          metaPathVars.add(openVar);
        }
      }

      // Second pass: flag writes.
      lines.forEach((line, idx) => {
        const t = line.trim();
        if (isCommentLine(t)) return;
        // (a) Direct write call referencing the metadata.json string literal.
        const directWrite =
          /write[A-Za-z]*\s*\([^;]*metadata\.json/i.test(line) ||
          (/metadata\.json/.test(line) && /write[A-Za-z]*\s*\(/i.test(line));
        // (b) Write call referencing a known metadata.json path variable ANYWHERE
        //     in the call's argument region (not just first position).
        const varWrite =
          metaPathVars.size > 0 &&
          /write[A-Za-z]*\s*\(/i.test(line) &&
          [...metaPathVars].some((v) =>
            // write...( <args incl. \bvar\b> — the var appears as a whole token
            // inside a write call on this line.
            new RegExp(`write[A-Za-z]*\\s*\\([^;]*\\b${v}\\b`, "i").test(line)
          );
        if (directWrite || varWrite) {
          hits.push(`${f}:${idx + 1}: ${t}`);
        }
      });
    }
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `metadata.json WRITE found outside the converter (source):\n${hits.join("\n")}`
      );
    }
  });

  test("Marker 5b (dist): metadata.json WRITE absent from shipped bundles", () => {
    // In compiled output the write call + metadata.json string survive. We look
    // for a write API call with metadata.json in its argument region on the same
    // line (minifier keeps these adjacent in tsc output).
    const hits = scanDistForPattern(/write[A-Za-z]*\s*\([^;]*metadata\.json/i);
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `metadata.json WRITE found in SHIPPED dist bundle:\n${hits.join("\n")}`
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Marker 6: migrateLegacyConfig / parseYamlSimple — the v1 config.yml runtime
  // reader. Source + dist.
  // ───────────────────────────────────────────────────────────────────────────

  test("Marker 6: migrateLegacyConfig and parseYamlSimple absent from source", () => {
    const hits = scanSource(/migrateLegacyConfig|parseYamlSimple/, CODE_EXTS);
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `migrateLegacyConfig / parseYamlSimple found in source (v1 config.yml reader survived):\n${hits.join("\n")}`
      );
    }
  });

  test("Marker 6b (dist): config.yml runtime reader absent from shipped bundles", () => {
    // The reader functions + a runtime read of .guild/config.yml. In dist, the
    // function names survive; a config.yml read string survives too.
    const hits = scanDistForPattern(/migrateLegacyConfig|parseYamlSimple/);
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `config.yml runtime reader found in SHIPPED dist bundle:\n${hits.join("\n")}`
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Marker 7: new-run-id.ts must not exist (the second sentinel writer).
  // ───────────────────────────────────────────────────────────────────────────

  test("Marker 7: new-run-id.ts file does not exist", () => {
    const candidates = [
      path.join(PLUGIN_ROOT, "scripts/new-run-id.ts"),
      path.join(PLUGIN_ROOT, "scripts/lib/new-run-id.ts"),
      path.join(PLUGIN_ROOT, "hooks/new-run-id.ts"),
    ];
    const found = candidates.filter((p) => fs.existsSync(p));
    expect(found).toEqual([]);
    if (found.length > 0) {
      fail(
        `new-run-id.ts found (should be deleted — v1 second sentinel writer):\n${found.join("\n")}`
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Marker 8 (D8 broadened): v1 --restart first-word positional handler.
  //
  // The v1 hack dispatched on a bare positional "restart". v2 uses the named
  // `--restart` flag on /guild:resume. Forbidden positional-dispatch forms:
  //   ARGUMENTS === "restart"          | argv[0] === "restart"
  //   args[0] === "restart"            | process.argv[2] === "restart"
  //   const [sub] = argv; ... sub === "restart"   (destructured first positional,
  //                                                ANY var name — G3 generalized)
  //   "first word ... restart" prose
  //
  // G3: a v2 codebase has NO legitimate `=== "restart"` comparison (verified —
  // grep of scripts/ + hooks/ + mcp-servers/*/src found zero). So we flag ANY
  // bare-string comparison to the literal "restart" / 'restart' as a positional
  // dispatch. The legitimate v2 `--restart` NAMED flag is NOT matched — it is
  // always compared as the "--restart" string (with the -- prefix), which the
  // bare-"restart" pattern (anchored on a quote boundary, no leading --) excludes.
  // ───────────────────────────────────────────────────────────────────────────

  test("Marker 8: v1 --restart first-word positional / bare 'restart' comparison absent from source", () => {
    const positionalForms = new RegExp(
      [
        // ANY === / == comparison to the bare literal "restart" or 'restart'.
        // The [^-] (or start) guard before the opening quote ensures we do not
        // match "--restart" (the legit v2 named flag): the char before the quote
        // would be `-`, which is excluded. Using a quote not preceded by `-`.
        "===?\\s*([\"'])restart\\1",
        // Mirror form: "restart" === x  (literal on the left).
        "([\"'])restart\\1\\s*===?",
        // first-word prose forms.
        "\\bfirst[\\s_-]?word\\b.*restart",
        "restart\\b.*\\bfirst[\\s_-]?word",
      ].join("|"),
      "i"
    );
    // Pre-filter: a hit on `"--restart"` should NOT count. We post-filter any hit
    // whose matched comparison is actually against "--restart" (the named flag).
    const rawHits = scanSource(positionalForms, CODE_EXTS);
    const hits = rawHits.filter((h) => {
      const t = lineTextOf(h);
      // Drop lines that ONLY compare against the named flag "--restart" and never
      // the bare positional "restart".
      const hasBare = /===?\s*["']restart["']|["']restart["']\s*===?/.test(t);
      const hasFirstWord = /first[\s_-]?word/i.test(t);
      return hasBare || hasFirstWord;
    });
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `v1 --restart positional / bare 'restart' comparison found in source:\n${hits.join("\n")}`
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Marker 9: "removed at v2.1.0" sunset tags — the staged-removal plan.
  // ───────────────────────────────────────────────────────────────────────────

  test("Marker 9: 'removed at v2.1.0' sunset tags absent from source", () => {
    const hits = scanSource(/removed at v2\.1\.0/i, ALL_EXTS);
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `'removed at v2.1.0' sunset tags found in source (staged-removal plan still active):\n${hits.join("\n")}`
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Marker 10: @deprecated live symbol annotations — warn-once aliases.
  // ───────────────────────────────────────────────────────────────────────────

  test("Marker 10: no @deprecated live symbol annotations in source", () => {
    const hits = scanSource(/@deprecated/, CODE_EXTS);
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `@deprecated annotation found on live symbol in source:\n${hits.join("\n")}`
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Marker 11 (D9 NEW): no command file BODY is a v1→v2 redirect stub.
  //
  // Beyond the 7 deleted filenames (Marker 3), guard against a command whose
  // ENTIRE body is a redirect notice ("this command moved to", "renamed to
  // /guild:", "use /guild:<x> instead"). Conservative: a hit requires a
  // redirect PHRASE in a command body whose total prose (minus frontmatter) is
  // short enough to be a stub, so legitimate cross-references in a full command
  // doc are not flagged.
  // ───────────────────────────────────────────────────────────────────────────

  test("Marker 11: no command file body is a v1→v2 redirect stub", () => {
    const cmdDir = path.join(PLUGIN_ROOT, "commands");
    const redirectPhrase =
      /(this command\s+(has\s+)?(moved|been moved|renamed)|renamed to\s+\/guild:|use\s+\/guild:[\w-]+\s+instead|moved to\s+\/guild:)/i;
    const hits: string[] = [];
    if (fs.existsSync(cmdDir)) {
      for (const entry of fs.readdirSync(cmdDir)) {
        if (!entry.endsWith(".md")) continue;
        const p = path.join(cmdDir, entry);
        const content = fs.readFileSync(p, "utf8");
        // Strip YAML frontmatter for the body-length heuristic.
        const body = content.replace(/^---[\s\S]*?\n---\n/, "");
        const bodyLines = body
          .split("\n")
          .filter((l) => l.trim().length > 0);
        const hasRedirect = redirectPhrase.test(content);
        // A stub is SHORT (a real command doc has many body lines).
        const looksLikeStub = bodyLines.length <= 8;
        if (hasRedirect && looksLikeStub) {
          hits.push(`${p}: redirect-stub body (${bodyLines.length} body lines)`);
        }
      }
    }
    expect(hits).toEqual([]);
    if (hits.length > 0) {
      fail(
        `Command file body looks like a v1→v2 redirect stub:\n${hits.join("\n")}`
      );
    }
  });
});
