/**
 * t11-evolve-rsi.test.ts — U-RSI "Done when" fixtures
 * (KTD15 / KTD18 / KTD32 / KTD33 / KTD48 / KTD57 / KTD63 / R32 / R49 / R60 / R74),
 * plus the ten codex G-lane round-1 findings.
 *
 * Each `it` is one clause, through the REAL code path — a consuming-repo fixture for
 * the project home, a separate plugin-root fixture for the candidate home.
 *
 * The round-1 cases are grouped under "codex r1 #N" so a regression names its finding.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createGuildStorage, type GuildStorage } from "../../src/domains/state";
import { AUTO_PATH_TARGETS, EVOLVE_TARGETS, EvolveTargetRefusal, HUMAN_ONLY_TARGETS, assertAutoPathAllowed, assertNotPermissionEdit, classifyAutoPath, isPermissionSentence, classifyFileClass, classifyPermissionContent, sentences, blockUnits, evolveHome, isEvolveTarget, routeCheckpointVerdict } from "../../src/domains/evolve";
import { assertCheapCurator, findLatestOnlyViolation, isCuratorSpan, lintReplacement, planEvolveDelta, renderCuratorSpan, sha256, type EvolveDelta } from "../../src/domains/evolve";
import { applyEvolveDelta, projectTargetRoot } from "../../src/domains/evolve";
import { compactHistoryPath, readCompactHistory, rollbackEvolve } from "../../src/domains/evolve";
import { locatePlaybookSpan } from "../../src/domains/knowledge";
import { assertNotRuntimeTree } from "../../src/domains/kernel";
import { learningCheckpoint } from "../../src/domains/lifecycle";

const RUN_ID = "run-t11";

let sandbox: string;
let repoRoot: string;
let pluginRoot: string;
let storage: GuildStorage;
let pluginStore: GuildStorage;

function mkStorage(root: string, external: string): GuildStorage {
  return createGuildStorage(root, {
    activeRoot: root,
    profile: "standalone",
    env: {
      GUILD_STATE_HOME: path.join(external, "state"),
      GUILD_CACHE_HOME: path.join(external, "cache"),
      GUILD_WORKTREE_HOME: path.join(external, "worktrees"),
      GUILD_TEMP_HOME: path.join(external, "temp"),
    } as NodeJS.ProcessEnv,
  });
}

/** The plugin install tree, with the feedstock a project RSI must never touch. */
function mkPluginTree(root: string): void {
  for (const rel of [
    "src/surfaces/playbooks/specialists",
    "src/domains/evolve",
    "skills/meta/evolve",
    "hooks",
    "templates/specialists",
    ".guild",
  ]) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, "src/surfaces/playbooks/specialists/backend-api-contract.md"),
    FEEDSTOCK,
    "utf8",
  );
}

const FEEDSTOCK = `# backend-api-contract

## Error envelope

The starter recipe. Plugin feedstock — copy-on-mint only.
`;

const PLAYBOOK = `# backend-api-contract

## Error envelope

Return a bare string in the body.

## Pagination

Cursor, never offset.
`;

function projectPlaybook(name: string, contents: string): string {
  const p = path.join(projectTargetRoot(storage, "playbook"), name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents, "utf8");
  return p;
}

/** The sha256 of a named span as it stands on disk — what `before_hash` must carry. */
function spanHash(file: string, span: string): string {
  const located = locatePlaybookSpan(fs.readFileSync(file, "utf8"), span);
  if (!located) throw new Error(`fixture: span '${span}' not in ${file}`);
  return sha256(located.text);
}

/**
 * A well-formed operator delta. `before_hash` is REQUIRED on every apply now, so the
 * helper fills it from disk unless a case is deliberately testing a wrong one.
 */
function delta(over: Partial<EvolveDelta> & { path: string }): EvolveDelta {
  const base: EvolveDelta = {
    schema_version: "guild.evolve_delta.v1",
    target: "playbook",
    path: over.path,
    span: "Error envelope",
    op: "replace",
    replacement: "Return a typed problem+json envelope. Never a bare string.",
    proposer: "operator",
    ...over,
  } as EvolveDelta;
  if (base.before_hash === undefined && base.op !== "add" && fs.existsSync(base.path)) {
    base.before_hash = spanHash(base.path, base.span);
  }
  return base;
}

function ctx(extra: Record<string, unknown> = {}) {
  return {
    cwd: repoRoot,
    storage,
    pluginRoot,
    plugin_storage: pluginStore,
    runId: RUN_ID,
    ...extra,
  };
}

/** Every path under `root` whose basename is `name`. */
function findByName(root: string, name: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.name === name) out.push(abs);
      if (e.isDirectory()) walk(abs);
    }
  };
  walk(root);
  return out;
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t11-rsi-"));
  repoRoot = path.join(sandbox, "repo");
  pluginRoot = path.join(sandbox, "plugin");
  fs.mkdirSync(path.join(repoRoot, ".guild"), { recursive: true });
  mkPluginTree(pluginRoot);
  storage = mkStorage(repoRoot, path.join(sandbox, "external"));
  pluginStore = mkStorage(pluginRoot, path.join(sandbox, "plugin-external"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// R32 — one gate, two homes
// ─────────────────────────────────────────────────────────────────────────────

describe("R32 — project RSI writes the consuming repo and nothing else", () => {
  it("--target=playbook replaces the named span under the consuming repo's own .guild/", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    const result = applyEvolveDelta(delta({ path: p }), ctx());

    expect(result.applied).toBe(true);
    expect(result.home).toBe("project");
    const text = fs.readFileSync(p, "utf8");
    expect(text).toContain("typed problem+json envelope");
    expect(text).not.toContain("Return a bare string");
    // The OTHER span is untouched — a span replace is not a file rewrite.
    expect(text).toContain("Cursor, never offset.");
  });

  it("does not touch the plugin's starter feedstock", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(delta({ path: p }), ctx());
    const feedstock = path.join(pluginRoot, "src/surfaces/playbooks/specialists/backend-api-contract.md");
    expect(fs.readFileSync(feedstock, "utf8")).toBe(FEEDSTOCK);
  });

  it("refuses a project-home target that resolves outside this repo's own tree", () => {
    const outside = path.join(sandbox, "other-repo", "playbooks", "x.md");
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, PLAYBOOK, "utf8");
    expect(() => applyEvolveDelta(delta({ path: outside }), ctx())).toThrow(/outside/);
  });

  it("the extended AC37 guard denies src/ and templates/ of a consuming repo", () => {
    for (const tree of ["src/modules", "templates/specialists", "skills/meta", "hooks"]) {
      expect(() => assertNotRuntimeTree(path.join(repoRoot, tree), pluginRoot, repoRoot)).toThrow(
        /AC37/,
      );
    }
    expect(() =>
      assertNotRuntimeTree(path.join(repoRoot, ".guild", "playbooks"), pluginRoot, repoRoot),
    ).not.toThrow();
  });

  it("the enum is closed and sealed", () => {
    expect(EVOLVE_TARGETS).toHaveLength(11);
    expect(isEvolveTarget("permission")).toBe(false);
    expect(() => (EVOLVE_TARGETS as unknown as string[]).push("permission")).toThrow();
    expect(EVOLVE_TARGETS.filter((t) => evolveHome(t) === "project").sort()).toEqual([
      "glossary",
      "playbook",
      "profile",
      "skill",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R74 — machinery is candidate-only, auto path fails closed
// ─────────────────────────────────────────────────────────────────────────────

describe("R74 — plugin RSI is a candidate plus a human commit", () => {
  it("--target=hook writes a candidate and never src/", () => {
    const result = applyEvolveDelta(
      delta({ target: "hook", path: path.join(pluginRoot, "hooks/verify-after-edit.ts") }),
      ctx(),
    );

    expect(result.applied).toBe(false);
    expect(result.home).toBe("plugin");
    expect(result.next_need).toBe("operator");
    expect(fs.existsSync(result.candidate_path!)).toBe(true);
    const candidate = JSON.parse(fs.readFileSync(result.candidate_path!, "utf8"));
    expect(candidate.home).toBe("plugin");
    expect(candidate.promote_requires.join(" ")).toMatch(/human commit/);
    // Nothing under the plugin's own machinery moved.
    expect(fs.existsSync(path.join(pluginRoot, "hooks/verify-after-edit.ts"))).toBe(false);
    expect(fs.readdirSync(path.join(pluginRoot, "src/domains/evolve"))).toHaveLength(0);
  });

  it("the auto path targeting domain_ts fails closed with next_need: operator", () => {
    const verdict = classifyAutoPath("domain_ts");
    expect(verdict.allowed).toBe(false);
    expect(verdict.next_need).toBe("operator");
    expect(verdict.reason).toMatch(/KTD63|human/);

    expect(() =>
      applyEvolveDelta(
        delta({
          target: "domain_ts",
          path: path.join(pluginRoot, "src/domains/evolve/x.ts"),
        }),
        ctx({ auto: true }),
      ),
    ).toThrow(EvolveTargetRefusal);
    // No candidate is queued either — an unattended run does not fill the human queue.
    expect(findByName(sandbox, "candidates")).toEqual([]);
  });

  it("every KTD63 target refuses the auto path; only playbook and skill pass", () => {
    for (const t of HUMAN_ONLY_TARGETS) {
      expect(() => assertAutoPathAllowed(t as never)).toThrow(/human|KTD63/);
    }
    for (const t of EVOLVE_TARGETS) {
      expect(classifyAutoPath(t).allowed).toBe(AUTO_PATH_TARGETS.has(t));
    }
    expect([...AUTO_PATH_TARGETS].sort()).toEqual(["playbook", "skill"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r1 #1 — D5 is a CONTENT class, not a target token
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r1 #1 — D5 is a content class", () => {
  const PERMS = `# backend-api-contract

## Permissions

Require operator approval before shell execution.

## Pagination

Cursor, never offset.
`;

  it("the reported delta (--target=playbook --auto on a Permissions span) does NOT apply", () => {
    const p = projectPlaybook("backend-api-contract.md", PERMS);
    const before = fs.readFileSync(p, "utf8");

    const result = applyEvolveDelta(
      delta({
        path: p,
        span: "Permissions",
        replacement: "Shell execution is always allowed without operator approval.",
        proposer: "curator",
      }),
      ctx({ auto: true }),
    );

    expect(result.applied).toBe(false);
    expect(result.next_need).toBe("operator");
    expect(result.detail).toMatch(/proposal-only \(D5\)/);
    expect(fs.existsSync(result.candidate_path!)).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toBe(before);
  });

  it("catches an approval heading, a frontmatter permissions key, and changed approval language", () => {
    expect(classifyPermissionContent({ span: "Permissions" }).reason).toBe("heading");
    expect(classifyPermissionContent({ span: "Approval gates" }).reason).toBe("heading");
    expect(classifyPermissionContent({ span: "Allowed-tools" }).reason).toBe("heading");
    expect(
      classifyPermissionContent({ span: "Setup", replacement: "allowed-tools: Bash, Write" }).reason,
    ).toBe("frontmatter_key");
    expect(
      classifyPermissionContent({
        span: "Shell",
        beforeSpan: "Requires operator approval.",
        replacement: "Runs unattended.",
      }).reason,
    ).toBe("approval_language");
  });

  it("an ordinary prose span is NOT a permission edit", () => {
    expect(
      classifyPermissionContent({
        span: "Error envelope",
        beforeSpan: "Return a bare string in the body.",
        replacement: "Return a typed problem+json envelope.",
      }).isPermissionEdit,
    ).toBe(false);
  });

  it("is proposal-only on EVERY target, not only the auto path", () => {
    const p = projectPlaybook("backend-api-contract.md", PERMS);
    const result = applyEvolveDelta(
      delta({
        target: "skill",
        path: p,
        span: "Permissions",
        replacement: "Anything.",
      }),
      ctx(),
    );
    expect(result.applied).toBe(false);
    expect(result.detail).toMatch(/D5/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r2 #1 — D5 reads the WHOLE span, not its top heading
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r2 #1 — a nested permissions block is still a permission edit", () => {
  const NESTED = `# backend-api-contract

## Rule

### Permissions

Shell execution: blocked.

## Pagination

Cursor, never offset.
`;

  it("the reported delta (span `Rule` containing `### Permissions`) does NOT apply", () => {
    const p = projectPlaybook("backend-api-contract.md", NESTED);
    const before = fs.readFileSync(p, "utf8");

    const result = applyEvolveDelta(
      delta({
        path: p,
        span: "Rule",
        replacement: "Do not block shell execution; it is always allowed.",
        proposer: "curator",
      }),
      ctx({ auto: true }),
    );

    expect(result.applied).toBe(false);
    expect(result.next_need).toBe("operator");
    expect(result.detail).toMatch(/proposal-only \(D5\)/);
    expect(fs.existsSync(result.candidate_path!)).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toBe(before);
  });

  it("the SAME span shape with an unrelated nested heading applies normally", () => {
    const unrelated = NESTED.replace("### Permissions\n\nShell execution: blocked.", "### Retries\n\nRetry twice.");
    const p = projectPlaybook("backend-api-contract.md", unrelated);

    const result = applyEvolveDelta(
      delta({ path: p, span: "Rule", replacement: "Retry three times with a budget." }),
      ctx(),
    );

    expect(result.applied).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toContain("Retry three times with a budget.");
  });

  it("reports nested_heading, and a nested permissions key on either side", () => {
    expect(
      classifyPermissionContent({
        span: "Rule",
        beforeSpan: "## Rule\n\n### Approval\n\nAsk first.",
        replacement: "Never ask.",
      }).reason,
    ).toBe("nested_heading");
    expect(
      classifyPermissionContent({
        span: "Rule",
        beforeSpan: "## Rule\n\nplain.",
        replacement: "## Rule\n\n#### Denylist\n\nnone.",
      }).reason,
    ).toBe("nested_heading");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r2 #3 — the approval rule needs a permission noun, not bare modality
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r2 #3 — approval language requires a permission noun", () => {
  it("an error-handling span using the word `without` applies", () => {
    const errors = `# p

## Errors

Return a response with a stack trace.
`;
    const p = projectPlaybook("errors.md", errors);
    const result = applyEvolveDelta(
      delta({ path: p, span: "Errors", replacement: "Return a response without a stack trace." }),
      ctx(),
    );
    expect(result.applied).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toContain("without a stack trace");
  });

  it("`Run without confirmation` and `Shell execution: blocked.` are permission edits", () => {
    expect(
      classifyPermissionContent({
        span: "Shell",
        beforeSpan: "Run interactively.",
        replacement: "Run without confirmation.",
      }).isPermissionEdit,
    ).toBe(true);
    expect(
      classifyPermissionContent({
        span: "Shell",
        beforeSpan: "Shell execution: blocked.",
        replacement: "Shell execution: allowed.",
      }).isPermissionEdit,
    ).toBe(true);
  });

  it("`The build must not block on lint` is NOT a permission edit", () => {
    expect(
      classifyPermissionContent({
        span: "CI",
        beforeSpan: "The build blocks on lint.",
        replacement: "The build must not block on lint.",
      }).isPermissionEdit,
    ).toBe(false);

    const ci = `# p

## CI

The build blocks on lint.
`;
    const p = projectPlaybook("ci.md", ci);
    const result = applyEvolveDelta(
      delta({ path: p, span: "CI", replacement: "The build must not block on lint." }),
      ctx(),
    );
    expect(result.applied).toBe(true);
  });

  it("the sentence rule needs BOTH a permission noun and modality", () => {
    // noun + modality
    expect(isPermissionSentence("Shell runs without approval.")).toBe(true);
    expect(isPermissionSentence("Writes must never be denied.")).toBe(true);
    // a bare state declaration is its own signature
    expect(isPermissionSentence("Network: denied")).toBe(true);
    // noun alone, describing rather than asserting
    expect(isPermissionSentence("The approval lives in settings.json.")).toBe(false);
    // modality alone
    expect(isPermissionSentence("Return the body without a trailing newline.")).toBe(false);
    expect(isPermissionSentence("You must always retry twice.")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r3 #1 — the sentence rule reads SENTENCES, not lines
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r3 #1 — soft-wrapped and structured permission sentences", () => {
  /** A one-span playbook whose span body is `body`. */
  function withBody(body: string): string {
    return `# p\n\n## Rule\n\n${body}\n`;
  }

  it("the reported wrapped sentence does NOT apply under --auto", () => {
    const p = projectPlaybook("rule.md", withBody("Shell runs interactively."));
    const before = fs.readFileSync(p, "utf8");

    const result = applyEvolveDelta(
      delta({
        path: p,
        span: "Rule",
        replacement: "Always require\noperator approval before shell execution.",
        proposer: "curator",
      }),
      ctx({ auto: true }),
    );

    expect(result.applied).toBe(false);
    expect(result.detail).toMatch(/proposal-only \(D5\)/);
    expect(fs.readFileSync(p, "utf8")).toBe(before);
  });

  it("the SAME sentence hard-wrapped at three different points blocks each time", () => {
    const wraps = [
      "Always\nrequire operator approval before shell execution.",
      "Always require operator\napproval before shell execution.",
      "Always require operator approval before\nshell execution.",
    ];
    for (const replacement of wraps) {
      const p = projectPlaybook("rule.md", withBody("Shell runs interactively."));
      const before = fs.readFileSync(p, "utf8");
      const result = applyEvolveDelta(
        delta({ path: p, span: "Rule", replacement, proposer: "curator" }),
        ctx({ auto: true }),
      );
      expect(result.applied).toBe(false);
      expect(fs.readFileSync(p, "utf8")).toBe(before);
    }
  });

  it("a bullet list item is its own sentence", () => {
    for (const marker of ["-", "*", "+", "1."]) {
      expect(
        classifyPermissionContent({
          span: "Rule",
          beforeSpan: "Shell runs interactively.",
          replacement: `${marker} never run without approval`,
        }).isPermissionEdit,
      ).toBe(true);
    }
  });

  it("a table row carries its noun and its modality in different cells and still blocks", () => {
    expect(
      classifyPermissionContent({
        span: "Rule",
        beforeSpan: "Shell runs interactively.",
        replacement: "| approval | required |",
      }).isPermissionEdit,
    ).toBe(true);
    expect(
      classifyPermissionContent({
        span: "Rule",
        beforeSpan: "Shell runs interactively.",
        replacement: "| Tool | Policy |\n|---|---|\n| approval | required |",
      }).isPermissionEdit,
    ).toBe(true);
  });

  it("the tokenizer unwraps paragraphs but never joins across a block boundary", () => {
    expect(sentences("Always require\noperator approval.")).toEqual([
      "Always require operator approval.",
    ]);
    // A blank line, a heading and a list marker each end the paragraph.
    expect(sentences("Always require\n\noperator approval.")).toEqual([
      "Always require",
      "operator approval.",
    ]);
    expect(sentences("Always require\n## Heading\noperator approval.")).toEqual([
      "Always require",
      "Heading",
      "operator approval.",
    ]);
    expect(sentences("Always require\n- operator approval.")).toEqual([
      "Always require",
      "operator approval.",
    ]);
    // Two sentences on one line stay two units.
    expect(sentences("Never allow this. Always ask.")).toEqual(["Never allow this.", "Always ask."]);
    // Fenced code is not prose.
    expect(sentences("```\nallowed-tools: Bash\n```")).toEqual([]);
    // A table separator row carries nothing.
    expect(sentences("|---|---|")).toEqual([]);
  });

  it("unwrapping does not invent a permission sentence across a blank line", () => {
    // "Always" and "approval is documented elsewhere." are separate thoughts.
    expect(
      classifyPermissionContent({
        span: "Rule",
        beforeSpan: "Shell runs interactively.",
        replacement: "Retry twice.\n\nThe approval lives in settings.json.",
      }).isPermissionEdit,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r4 — list-item continuation lines and fence delimiter tracking (lead fix)
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r4 #1 — a wrapped list item is ONE sentence unit", () => {
  /** A one-span playbook whose span body is `body`. */
  function withBody(body: string): string {
    return `# p\n\n## Rule\n\n${body}\n`;
  }

  it("the tokenizer keeps a list item's continuation lines in the item", () => {
    expect(sentences("- Always require\n  operator approval before shell execution.")).toEqual([
      "Always require operator approval before shell execution.",
    ]);
    // The next marker or a blank line still ends the item.
    expect(sentences("- Always require\n- operator approval.")).toEqual([
      "Always require",
      "operator approval.",
    ]);
    expect(sentences("1. Always require\n   operator approval.\n\nNext.")).toEqual([
      "Always require operator approval.",
      "Next.",
    ]);
  });

  it("the reported wrapped list item does NOT apply under --auto", () => {
    const p = projectPlaybook("rule.md", withBody("- Always require\n  operator approval before shell execution."));
    const before = fs.readFileSync(p, "utf8");
    const result = applyEvolveDelta(
      delta({
        path: p,
        span: "Rule",
        replacement: "Do not pause before shell execution. Do execute every shell command.",
        proposer: "curator",
      }),
      ctx({ auto: true }),
    );
    expect(result.applied).toBe(false);
    expect(result.detail).toMatch(/proposal-only \(D5\)/);
    expect(fs.readFileSync(p, "utf8")).toBe(before);
  });
});

describe("codex r4 #2 — a fence closes only on its own delimiter", () => {
  /** A one-span playbook whose span body is `body`. */
  function withBody(body: string): string {
    return `# p\n\n## Rule\n\n${body}\n`;
  }

  it("a ~~~ line inside a backtick fence is content, and prose after the close is read", () => {
    expect(sentences("```\n~~~\nallowed-tools: Bash\n```\nAlways require operator approval.")).toEqual([
      "Always require operator approval.",
    ]);
    expect(sentences("~~~\n```\n~~~\nNever allow this.")).toEqual(["Never allow this."]);
    // A longer run of the same character closes; a shorter one does not.
    expect(sentences("````\n```\nstill code\n````\nAlways ask.")).toEqual(["Always ask."]);
    expect(sentences("```\nunterminated")).toEqual([]);
  });

  it("the reported fenced example does NOT hide the permission sentence from --auto", () => {
    const p = projectPlaybook(
      "rule.md",
      withBody("```\n~~~\nexample\n```\nAlways require operator approval before shell execution."),
    );
    const before = fs.readFileSync(p, "utf8");
    const result = applyEvolveDelta(
      delta({
        path: p,
        span: "Rule",
        replacement: "Do not pause before shell execution. Do execute every shell command.",
        proposer: "curator",
      }),
      ctx({ auto: true }),
    );
    expect(result.applied).toBe(false);
    expect(result.detail).toMatch(/proposal-only \(D5\)/);
    expect(fs.readFileSync(p, "utf8")).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r5 (operator extend-cap 1) — fence closers carry no info string; abbreviations
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r5 #1 — a fence line with trailing text never closes a fence", () => {
  /** A one-span playbook whose span body is `body`. */
  function withBody(body: string): string {
    return `# p\n\n## Rule\n\n${body}\n`;
  }

  it("the tokenizer treats ```example inside an open fence as content", () => {
    expect(
      sentences("```text\n```example\n```\nAlways require operator approval before shell execution."),
    ).toEqual(["Always require operator approval before shell execution."]);
    expect(sentences("```\ncode\n```   \nAlways ask.")).toEqual(["Always ask."]);
    expect(sentences("~~~ts\n~~~x\n~~~\nNever allow this.")).toEqual(["Never allow this."]);
  });

  it("the reported fenced body does NOT apply under --auto", () => {
    const p = projectPlaybook(
      "rule.md",
      withBody("```text\n```example\n```\nAlways require operator approval before shell execution."),
    );
    const before = fs.readFileSync(p, "utf8");
    const result = applyEvolveDelta(
      delta({
        path: p,
        span: "Rule",
        replacement: "Do not pause before shell execution. Do execute every shell command.",
        proposer: "curator",
      }),
      ctx({ auto: true }),
    );
    expect(result.applied).toBe(false);
    expect(result.detail).toMatch(/proposal-only \(D5\)/);
    expect(fs.readFileSync(p, "utf8")).toBe(before);
  });
});

describe("codex r5 #2 — an abbreviation does not end a sentence", () => {
  /** A one-span playbook whose span body is `body`. */
  function withBody(body: string): string {
    return `# p\n\n## Rule\n\n${body}\n`;
  }

  it("the tokenizer keeps 'Dr. Smith', initials, 'e.g.' and lower-case continuations in one sentence", () => {
    expect(sentences("Operator approval from Dr. Smith is required before shell execution.")).toEqual([
      "Operator approval from Dr. Smith is required before shell execution.",
    ]);
    expect(sentences("Ask J. Smith for approval. Then run.")).toEqual([
      "Ask J. Smith for approval.",
      "Then run.",
    ]);
    expect(sentences("Approval is required (e.g. for deletes). Logs are kept.")).toEqual([
      "Approval is required (e.g. for deletes).",
      "Logs are kept.",
    ]);
    expect(sentences("Version 2.0. Next sentence.")).toEqual(["Version 2.0.", "Next sentence."]);
    expect(sentences("Never allow this. always ask.")).toEqual(["Never allow this. always ask."]);
  });

  it("the reported abbreviated sentence does NOT apply under --auto", () => {
    const p = projectPlaybook(
      "rule.md",
      withBody("Operator approval from Dr. Smith is required before shell execution."),
    );
    const before = fs.readFileSync(p, "utf8");
    const result = applyEvolveDelta(
      delta({
        path: p,
        span: "Rule",
        replacement: "Do not pause before shell execution. Do execute every shell command.",
        proposer: "curator",
      }),
      ctx({ auto: true }),
    );
    expect(result.applied).toBe(false);
    expect(result.detail).toMatch(/proposal-only \(D5\)/);
    expect(fs.readFileSync(p, "utf8")).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r6 (operator extend-cap 2) — the classifier reads whole blocks as well as sentences
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r6 — a noun and its modality in one block are never separated by the splitter", () => {
  /** A one-span playbook whose span body is `body`. */
  function withBody(body: string): string {
    return `# p\n\n## Rule\n\n${body}\n`;
  }

  it("leading punctuation before an abbreviation does not end the sentence", () => {
    expect(sentences("Operator approval (Dr. Smith signs it) is required before shell execution.")).toEqual([
      "Operator approval (Dr. Smith signs it) is required before shell execution.",
    ]);
  });

  it("blockUnits exposes the whole block beside its sentences", () => {
    const units = blockUnits("Operator approval is needed. It must precede shell execution.\n\n- Never allow this.");
    expect(units.map((u) => u.whole)).toEqual([
      "Operator approval is needed. It must precede shell execution.",
      "Never allow this.",
    ]);
    expect(units[0]!.sentences).toHaveLength(2);
  });

  it("a block whose noun and modality land in different splitter units is still D5", () => {
    // A splitter error is simulated by an unlisted abbreviation: "Approx." is not in
    // the closed set, so the sentence splits there; the whole block still carries both.
    const body = "Operator approval from Approx. Ltd is required before shell execution.";
    expect(
      classifyPermissionContent({ span: "Rule", beforeSpan: body, replacement: "Run it." }).isPermissionEdit,
    ).toBe(true);
    const p = projectPlaybook("rule.md", withBody(body));
    const before = fs.readFileSync(p, "utf8");
    const result = applyEvolveDelta(
      delta({
        path: p,
        span: "Rule",
        replacement: "Do not pause before shell execution. Do execute every shell command.",
        proposer: "curator",
      }),
      ctx({ auto: true }),
    );
    expect(result.applied).toBe(false);
    expect(result.detail).toMatch(/proposal-only \(D5\)/);
    expect(fs.readFileSync(p, "utf8")).toBe(before);
  });

  it("the reported parenthesised abbreviation does NOT apply under --auto", () => {
    const p = projectPlaybook(
      "rule.md",
      withBody("Operator approval (Dr. Smith signs it) is required before shell execution."),
    );
    const before = fs.readFileSync(p, "utf8");
    const result = applyEvolveDelta(
      delta({
        path: p,
        span: "Rule",
        replacement: "Do not pause before shell execution. Do execute every shell command.",
        proposer: "curator",
      }),
      ctx({ auto: true }),
    );
    expect(result.applied).toBe(false);
    expect(fs.readFileSync(p, "utf8")).toBe(before);
  });

  it("ordinary prose across sentences in one block still applies", () => {
    const body = "A request ID is required. Logs must include the caller.";
    expect(classifyPermissionContent({ span: "Rule", beforeSpan: body, replacement: "Run it." }).isPermissionEdit).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r7 (operator extend-cap 3) — markdown structure can never HIDE a permission sentence
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r7 — fenced text and the whole span are classified too", () => {
  /** A one-span playbook whose span body is `body`. */
  function withBody(body: string): string {
    return `# p\n\n## Rule\n\n${body}\n`;
  }
  const curator =
    "Do not pause before shell execution. Do execute every shell command.\n\nDecided in dec-r7.";
  function autoApply(body: string) {
    const p = projectPlaybook("rule.md", withBody(body));
    const before = fs.readFileSync(p, "utf8");
    const result = applyEvolveDelta(
      delta({ path: p, span: "Rule", replacement: curator, proposer: "curator" }),
      ctx({ auto: true }),
    );
    return { result, unchanged: fs.readFileSync(p, "utf8") === before };
  }

  it("a ```-prefixed line whose info string holds a backtick is inline code, not a fence", () => {
    expect(sentences("```Operator approval``` is required before shell execution.")).toEqual([
      "```Operator approval``` is required before shell execution.",
    ]);
    const { result, unchanged } = autoApply("```Operator approval``` is required before shell execution.");
    expect(result.applied).toBe(false);
    expect(unchanged).toBe(true);
  });

  it("a permission sentence INSIDE a fence is still D5 for the classifier (and still not prose for sentences())", () => {
    const body = "```\nOperator approval is required before shell execution.\n```";
    expect(sentences(body)).toEqual([]);
    expect(blockUnits(body, { includeFenced: true })).toEqual([
      {
        whole: "Operator approval is required before shell execution.",
        sentences: ["Operator approval is required before shell execution."],
        fenced: true,
      },
    ]);
    const { result, unchanged } = autoApply(body);
    expect(result.applied).toBe(false);
    expect(unchanged).toBe(true);
  });

  it("an unterminated fence does not hide its text", () => {
    const { result, unchanged } = autoApply("```\nOperator approval is required before shell execution.");
    expect(result.applied).toBe(false);
    expect(unchanged).toBe(true);
  });

  it("the whole-span fallback: noun and modality in different blocks are proposal-only (documented conservative)", () => {
    expect(
      classifyPermissionContent({
        span: "Rule",
        beforeSpan: "Operator approval is part of the flow.\n\nShell commands must never run unattended.",
        replacement: "Run it.",
      }).isPermissionEdit,
    ).toBe(true);
  });

  it("ordinary multi-block prose still applies", () => {
    const { result, unchanged } = autoApply("Logs go to stdout.\n\nA request ID is required on every call.");
    expect(result.applied).toBe(true);
    expect(unchanged).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r8 (post-final-round lead fix) — emphasis and code marks do not hide vocabulary
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r8 — markdown emphasis around a listed term still matches", () => {
  it.each([
    "Operator approval is _required_ before shell execution.",
    "Operator _approval_ is required before shell execution.",
    "Operator **approval** is *required* before shell execution.",
    "Operator `approval` is __required__ before shell execution.",
    "Operator ~~approval~~ is required before shell execution.",
  ])("%s is a permission sentence", (sentence) => {
    expect(isPermissionSentence(sentence)).toBe(true);
    expect(
      classifyPermissionContent({ span: "Rule", beforeSpan: sentence, replacement: "Run it." }).isPermissionEdit,
    ).toBe(true);
  });

  it("an emphasised ordinary sentence still applies", () => {
    expect(isPermissionSentence("A request ID is _required_ on every call.")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r3 #3 — `required` / `must` alone are not permission signals
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r3 #3 — a requirement is only D5 when a permission is required", () => {
  const CASES: Array<[string, boolean]> = [
    ["A request ID is required.", false],
    ["Operator approval is required.", true],
    ["Confirmation must precede deletion.", true],
    ["The response must include a request ID.", false],
    ["Every field is required.", false],
    ["Consent must be recorded.", true],
    ["The timeout must never exceed 30s.", false],
    ["Deletion requires an operator click.", true],
  ];

  it("classifies each requirement sentence by whether a PERMISSION is required", () => {
    for (const [sentence, want] of CASES) {
      expect([sentence, isPermissionSentence(sentence)]).toEqual([sentence, want]);
    }
  });

  it("`A request ID is required.` applies through the real gate", () => {
    const p = projectPlaybook("api.md", "# p\n\n## Rule\n\nThe response carries a request ID.\n");
    const result = applyEvolveDelta(
      delta({ path: p, span: "Rule", replacement: "A request ID is required." }),
      ctx(),
    );
    expect(result.applied).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toContain("A request ID is required.");
  });

  it("`Operator approval is required.` is blocked through the real gate", () => {
    const p = projectPlaybook("api.md", "# p\n\n## Rule\n\nThe response carries a request ID.\n");
    const before = fs.readFileSync(p, "utf8");
    const result = applyEvolveDelta(
      delta({ path: p, span: "Rule", replacement: "Operator approval is required." }),
      ctx(),
    );
    expect(result.applied).toBe(false);
    expect(fs.readFileSync(p, "utf8")).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r1 #2 — file class beats the target token
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r1 #2 — the auto path writes prose definitions only", () => {
  const SCRIPT = `// # Error envelope
//
// Return a bare string.
export const x = 1;
`;

  it("a --target=skill delta against .guild/skills/script.ts is blocked and the file is untouched", () => {
    const p = path.join(projectTargetRoot(storage, "skill"), "script.ts");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, SCRIPT, "utf8");

    const result = applyEvolveDelta(
      delta({ target: "skill", path: p, span: "Error envelope", before_hash: sha256("x") }),
      ctx(),
    );

    expect(result.applied).toBe(false);
    expect(result.next_need).toBe("operator");
    expect(result.detail).toMatch(/domain_ts class|executable/);
    expect(fs.readFileSync(p, "utf8")).toBe(SCRIPT);
  });

  it("classifies by extension, not by directory", () => {
    for (const [file, cls] of [
      ["/r/.guild/skills/a.ts", "domain_ts"],
      ["/r/.guild/skills/a.js", "domain_ts"],
      ["/r/.guild/skills/a.mjs", "domain_ts"],
      ["/r/.guild/skills/a.cjs", "domain_ts"],
      ["/r/.guild/skills/a.json", "domain_ts"],
      ["/r/.guild/skills/a.sh", "learn_script"],
    ] as const) {
      const v = classifyFileClass(file);
      expect(v.writable).toBe(false);
      expect(v.reclassified_as).toBe(cls);
    }
    expect(classifyFileClass("/r/.guild/skills/SKILL.md").writable).toBe(true);
    expect(classifyFileClass("/r/.guild/playbooks/p.md").writable).toBe(true);
  });

  it("a file whose first bytes are not text is refused", () => {
    const v = classifyFileClass("/r/.guild/playbooks/p.md", " binary");
    expect(v.writable).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r1 #3 — before_hash required, automatic add refused, curator wired
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r1 #3 — the cheap-curator contract is enforced by apply", () => {
  it("an apply with NO before_hash is refused and writes nothing", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    const d = delta({ path: p });
    delete (d as { before_hash?: string }).before_hash;
    expect(() => applyEvolveDelta(d, ctx())).toThrow(/before_hash is required/);
    expect(fs.readFileSync(p, "utf8")).toBe(PLAYBOOK);
  });

  it("an automatic `add` is refused — auto is span REPLACE only", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    expect(() =>
      applyEvolveDelta(
        delta({
          path: p,
          op: "add",
          span: "Retries",
          replacement: renderCuratorSpan({
            rejected: "retry blindly",
            preferred: "retry with a budget",
            decision_id: "d-retries",
          }),
          before_hash: sha256(PLAYBOOK),
          proposer: "curator",
        }),
        ctx({ auto: true }),
      ),
    ).toThrow(/replaces a named span/);
    expect(fs.readFileSync(p, "utf8")).toBe(PLAYBOOK);
  });

  it("a curator span with an LLM-rewrite shape is refused; the template is accepted", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    const prose =
      "After reflecting on the trade-offs here, I think the cleanest approach is to " +
      "return a richer envelope, which also improves observability downstream.";
    expect(isCuratorSpan(prose)).toBe(false);
    expect(() =>
      applyEvolveDelta(delta({ path: p, replacement: prose, proposer: "curator" }), ctx({ auto: true })),
    ).toThrow(/deterministic redirect template/);
    expect(fs.readFileSync(p, "utf8")).toBe(PLAYBOOK);

    const templated = renderCuratorSpan({
      rejected: "return a bare string",
      preferred: "return a typed problem+json envelope",
      decision_id: "d-error-envelope",
    });
    expect(isCuratorSpan(templated)).toBe(true);
    const ok = applyEvolveDelta(
      delta({ path: p, replacement: templated, proposer: "curator" }),
      ctx({ auto: true }),
    );
    expect(ok.applied).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toContain("Do not return a bare string.");
  });

  it("assertCheapCurator refuses a non-auto-path target, a non-replace op, and a missing hash", () => {
    const base = {
      schema_version: "guild.evolve_delta.v1" as const,
      path: "p.md",
      span: "S",
      replacement: renderCuratorSpan({ rejected: "a", preferred: "b", decision_id: "d-1" }),
      proposer: "curator" as const,
      before_hash: "deadbeef",
    };
    expect(() => assertCheapCurator({ ...base, target: "hook", op: "replace" })).toThrow(/KTD63/);
    expect(() => assertCheapCurator({ ...base, target: "playbook", op: "remove" })).toThrow(
      /replaces a named span/,
    );
    expect(() =>
      assertCheapCurator({ ...base, target: "playbook", op: "replace", before_hash: undefined }),
    ).toThrow(/before_hash/);
    expect(() =>
      assertCheapCurator({ ...base, target: "playbook", op: "replace" }),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r1 #4 / #5 — candidates land under the PLUGIN root, and never collide
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r1 #4 — machinery candidates go to the plugin root", () => {
  it("with separate roots, the candidate is under the plugin and the consumer gets nothing", () => {
    const result = applyEvolveDelta(
      delta({ target: "hook", path: path.join(pluginRoot, "hooks/h.ts") }),
      ctx(),
    );
    expect(result.candidate_path!.startsWith(path.resolve(pluginRoot))).toBe(true);
    expect(findByName(repoRoot, "candidates")).toEqual([]);
    expect(findByName(pluginRoot, "candidates")).toHaveLength(1);
  });
});

describe("codex r1 #5 — two candidates in one tick are two files", () => {
  it("does not overwrite a candidate written in the same second", () => {
    const frozen = () => new Date("2026-09-16T12:00:00.000Z");
    const a = applyEvolveDelta(
      delta({ target: "hook", path: path.join(pluginRoot, "hooks/a.ts"), replacement: "First." }),
      ctx({ now: frozen }),
    );
    const b = applyEvolveDelta(
      delta({ target: "hook", path: path.join(pluginRoot, "hooks/b.ts"), replacement: "Second." }),
      ctx({ now: frozen }),
    );
    expect(a.candidate_path).not.toBe(b.candidate_path);
    expect(fs.existsSync(a.candidate_path!)).toBe(true);
    expect(fs.existsSync(b.candidate_path!)).toBe(true);
    const dir = path.dirname(a.candidate_path!);
    expect(fs.readdirSync(dir)).toHaveLength(2);
  });

  it("two byte-identical proposals in one tick still produce two files", () => {
    const frozen = () => new Date("2026-09-16T12:00:00.000Z");
    const d = delta({ target: "hook", path: path.join(pluginRoot, "hooks/same.ts") });
    const a = applyEvolveDelta(d, ctx({ now: frozen }));
    const b = applyEvolveDelta(d, ctx({ now: frozen }));
    expect(a.candidate_path).not.toBe(b.candidate_path);
    expect(fs.readdirSync(path.dirname(a.candidate_path!))).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D5 — the target token is still refused
// ─────────────────────────────────────────────────────────────────────────────

describe("D5 poison fixture — a proposed permission edit cannot promote", () => {
  it("refuses the permission target on every spelling, through the apply gate", () => {
    for (const spelling of ["permission", "permissions", "Permission", " D5 "]) {
      expect(() => assertNotPermissionEdit(spelling)).toThrow(/proposal-only/);
      expect(() =>
        applyEvolveDelta(delta({ target: spelling as never, path: "x.md" }), ctx()),
      ).toThrow(/proposal-only/);
    }
  });

  it("`permission` is not in the enum, so it has no home to resolve to", () => {
    expect(isEvolveTarget("permission")).toBe(false);
    expect(() => evolveHome("permission" as never)).toThrow(/enum is closed/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R49 — latest-only
// ─────────────────────────────────────────────────────────────────────────────

describe("R49 — context files are latest-only", () => {
  it('a replacement carrying "Update (2026-…):" is refused by the curator lint', () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    const bad = delta({
      path: p,
      replacement: "Return problem+json.\n\n**Update (2026-09-16):** superseded the bare string.",
    });
    expect(lintReplacement(bad)).toMatch(/latest-only|Update/);
    expect(() => applyEvolveDelta(bad, ctx())).toThrow(/latest-only/);
    expect(fs.readFileSync(p, "utf8")).toBe(PLAYBOOK);
  });

  it("`add` is for a genuinely new heading, never a stacked second copy", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    expect(() =>
      applyEvolveDelta(
        delta({ path: p, op: "add", before_hash: sha256(PLAYBOOK) }),
        ctx(),
      ),
    ).toThrow(/already exists/);
  });
});

describe("codex r1 #10 — the latest-only lint catches every spelling", () => {
  it("flags lowercase, uppercase, bold and Setext forms", () => {
    const cases = [
      "## update (2026-09-16): superseded",
      "## UPDATE (2026-09-16)",
      "## **Changelog**",
      "### Change log",
      "Changelog\n=========",
      "Changelog\n---------",
      "## changelog",
      "## Updates",
      "Update (2026/09) — the bare string is gone",
      "#### History",
    ];
    for (const c of cases) {
      expect(findLatestOnlyViolation(c)).not.toBeNull();
    }
  });

  it("does NOT flag the word update inside a body sentence", () => {
    const clean = [
      "Update the cache before you read it.",
      "Run the update script, then verify.",
      "## Error envelope\n\nReturn problem+json; this supersedes the bare string.",
      "The changelog lives in the wiki, not here.",
    ];
    for (const c of clean) {
      expect(findLatestOnlyViolation(c)).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// before_hash
// ─────────────────────────────────────────────────────────────────────────────

describe("guild.evolve_delta.v1 — before_hash refuses on mismatch", () => {
  it("a stale before_hash refuses and writes nothing", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    expect(() =>
      applyEvolveDelta(delta({ path: p, before_hash: sha256("something else") }), ctx()),
    ).toThrow(/before_hash mismatch/);
    expect(fs.readFileSync(p, "utf8")).toBe(PLAYBOOK);
  });

  it("a missing span refuses rather than appending", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    expect(() =>
      applyEvolveDelta(delta({ path: p, span: "Retries", before_hash: sha256("x") }), ctx()),
    ).toThrow(/not in/);
    expect(fs.readFileSync(p, "utf8")).toBe(PLAYBOOK);
  });

  it("the cheap curator never rewrites the rest of the file", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(
      delta({
        path: p,
        proposer: "curator",
        replacement: renderCuratorSpan({
          rejected: "return a bare string",
          preferred: "return problem+json",
          decision_id: "d-env",
        }),
      }),
      ctx({ auto: true }),
    );
    const text = fs.readFileSync(p, "utf8");
    expect(text.startsWith("# backend-api-contract")).toBe(true);
    expect(text).toContain("## Pagination\n\nCursor, never offset.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R60 — compact history replaces the version tree
// ─────────────────────────────────────────────────────────────────────────────

describe("R60 — compact history and span-scoped rollback", () => {
  it("an applied delta records the inverse span, both hashes, and the offset", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    const result = applyEvolveDelta(delta({ path: p }), ctx({ historyKey: "backend-api-contract" }));

    const history = readCompactHistory("backend-api-contract", { cwd: repoRoot, storage });
    expect(history.entries).toHaveLength(1);
    const entry = history.entries[0];
    expect(entry.inverse_span).toContain("Return a bare string");
    expect(entry.before_hash).toBe(result.history!.before_hash);
    expect(sha256(entry.applied_span)).toBe(entry.after_hash);
    expect(entry.offset).toBeGreaterThan(0);
    expect(compactHistoryPath(storage, "backend-api-contract")).not.toContain("skill-versions");
  });

  it("rollback restores the inverse span and pops the entry", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(delta({ path: p }), ctx({ historyKey: "backend-api-contract" }));
    expect(fs.readFileSync(p, "utf8")).toContain("problem+json");

    const rolled = rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot });
    expect(rolled.status).toBe("restored");
    expect(fs.readFileSync(p, "utf8")).toBe(PLAYBOOK);
    expect(readCompactHistory("backend-api-contract", { cwd: repoRoot, storage }).entries).toHaveLength(0);
  });

  it("a drifted span is blocked_confirm — never a whole-file rewrite", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(delta({ path: p }), ctx({ historyKey: "backend-api-contract" }));
    const drifted = fs.readFileSync(p, "utf8").replace("problem+json", "problem+json (RFC 9457)");
    fs.writeFileSync(p, drifted, "utf8");

    const rolled = rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot });
    expect(rolled.status).toBe("blocked_confirm");
    expect(rolled.steps[0].question).toMatch(/changed after this evolve/);
    expect(fs.readFileSync(p, "utf8")).toBe(drifted);
  });

  it("rollback n walks back n entries, newest first", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(
      delta({ path: p, replacement: "First rewrite." }),
      ctx({ historyKey: "backend-api-contract" }),
    );
    applyEvolveDelta(
      delta({ path: p, replacement: "Second rewrite." }),
      ctx({ historyKey: "backend-api-contract" }),
    );
    expect(fs.readFileSync(p, "utf8")).toContain("Second rewrite.");

    const rolled = rollbackEvolve("backend-api-contract", 2, { cwd: repoRoot, storage, pluginRoot });
    expect(rolled.status).toBe("restored");
    expect(rolled.restored).toHaveLength(2);
    expect(fs.readFileSync(p, "utf8")).toBe(PLAYBOOK);
  });

  it("no evolve write creates a .guild/skill-versions/ tree", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(delta({ path: p }), ctx({ historyKey: "backend-api-contract" }));
    applyEvolveDelta(delta({ target: "hook", path: path.join(pluginRoot, "hooks/x.ts") }), ctx());
    rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot });
    expect(findByName(sandbox, "skill-versions")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// codex r1 #6 / #7 / #8 / #9 — history integrity and exact inverses
// ─────────────────────────────────────────────────────────────────────────────

describe("codex r1 #6 — unreadable compact history fails closed", () => {
  it("a truncated history refuses the next apply and is not overwritten", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(delta({ path: p }), ctx({ historyKey: "backend-api-contract" }));
    const hp = compactHistoryPath(storage, "backend-api-contract");
    const truncated = fs.readFileSync(hp, "utf8").slice(0, 40);
    fs.writeFileSync(hp, truncated, "utf8");

    const live = fs.readFileSync(p, "utf8");
    expect(() =>
      applyEvolveDelta(
        delta({ path: p, replacement: "Another rewrite." }),
        ctx({ historyKey: "backend-api-contract" }),
      ),
    ).toThrow(/will not parse|refusing/);
    expect(fs.readFileSync(hp, "utf8")).toBe(truncated);
    expect(fs.readFileSync(p, "utf8")).toBe(live);
  });

  it("rollback on unreadable history refuses rather than reporting noop", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(delta({ path: p }), ctx({ historyKey: "backend-api-contract" }));
    const hp = compactHistoryPath(storage, "backend-api-contract");
    fs.writeFileSync(hp, "{not json", "utf8");
    expect(() => rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot })).toThrow(
      /refusing|will not parse/,
    );
  });

  it("an ABSENT history is still an empty stack, not an error", () => {
    expect(readCompactHistory("never-evolved", { cwd: repoRoot, storage }).entries).toEqual([]);
  });
});

describe("codex r1 #7 — a duplicate anchor blocks rather than restoring the wrong span", () => {
  it("blocked_confirm, both spans unchanged, history untouched", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(delta({ path: p }), ctx({ historyKey: "backend-api-contract" }));

    // A second heading with the SAME anchor line and the same applied bytes.
    const applied = readCompactHistory("backend-api-contract", { cwd: repoRoot, storage })
      .entries[0].applied_span;
    const withDuplicate = fs.readFileSync(p, "utf8") + "\n" + applied;
    fs.writeFileSync(p, withDuplicate, "utf8");

    const rolled = rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot });
    expect(rolled.status).toBe("blocked_confirm");
    expect(rolled.steps[0].detail).toMatch(/appears 2 times|no longer identifies/);
    expect(fs.readFileSync(p, "utf8")).toBe(withDuplicate);
    expect(
      readCompactHistory("backend-api-contract", { cwd: repoRoot, storage }).entries,
    ).toHaveLength(1);
  });
});

describe("codex r1 #8 — a removal's inverse is self-sufficient", () => {
  it("apply remove → rollback restores the file byte-for-byte", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    const result = applyEvolveDelta(
      delta({ path: p, op: "remove", replacement: "" }),
      ctx({ historyKey: "backend-api-contract" }),
    );
    expect(result.applied).toBe(true);
    const removed = fs.readFileSync(p, "utf8");
    expect(removed).not.toContain("Return a bare string");
    expect(removed).toContain("## Pagination");

    const rolled = rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot });
    expect(rolled.status).toBe("restored");
    expect(fs.readFileSync(p, "utf8")).toBe(PLAYBOOK);
  });
});

describe("codex r2 #2 — rollback verifies the SPAN, not the whole file", () => {
  it("unrelated edits elsewhere in the file do not block a rollback, and survive it", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(delta({ path: p }), ctx({ historyKey: "backend-api-contract" }));

    // An operator edits the intro AND a later section — neither is the evolved span.
    const edited = fs
      .readFileSync(p, "utf8")
      .replace("# backend-api-contract\n", "# backend-api-contract\n\nThis playbook is owned by the API guild.\n")
      .replace("Cursor, never offset.", "Cursor, never offset. Page size caps at 100.");
    fs.writeFileSync(p, edited, "utf8");

    const rolled = rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot });
    expect(rolled.status).toBe("restored");

    const after = fs.readFileSync(p, "utf8");
    // the span is back...
    expect(after).toContain("Return a bare string in the body.");
    expect(after).not.toContain("problem+json");
    // ...and both unrelated edits are still there.
    expect(after).toContain("This playbook is owned by the API guild.");
    expect(after).toContain("Page size caps at 100.");
  });

  it("a removal still round-trips after an unrelated edit elsewhere", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(
      delta({ path: p, op: "remove", replacement: "" }),
      ctx({ historyKey: "backend-api-contract" }),
    );
    const edited = fs.readFileSync(p, "utf8").replace(
      "Cursor, never offset.",
      "Cursor, never offset. Page size caps at 100.",
    );
    fs.writeFileSync(p, edited, "utf8");

    const rolled = rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot });
    expect(rolled.status).toBe("restored");
    const after = fs.readFileSync(p, "utf8");
    expect(after).toContain("Return a bare string in the body.");
    expect(after).toContain("Page size caps at 100.");
  });

  it("an edit INSIDE the span still blocks", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(delta({ path: p }), ctx({ historyKey: "backend-api-contract" }));
    const drifted = fs.readFileSync(p, "utf8").replace("problem+json", "problem+json (RFC 9457)");
    fs.writeFileSync(p, drifted, "utf8");

    const rolled = rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot });
    expect(rolled.status).toBe("blocked_confirm");
    expect(fs.readFileSync(p, "utf8")).toBe(drifted);
  });
});

describe("codex r3 #2 — rollback blocks on an ambiguous re-insertion point", () => {
  it("removal → duplicate the file body → rollback blocks, history untouched", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(
      delta({ path: p, op: "remove", replacement: "" }),
      ctx({ historyKey: "backend-api-contract" }),
    );
    // Prepend a copy of what is left: every recorded context now matches twice, and
    // the duplicate sits at the OLD offset.
    const removed = fs.readFileSync(p, "utf8");
    const doubled = removed + removed;
    fs.writeFileSync(p, doubled, "utf8");

    const rolled = rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot });
    expect(rolled.status).toBe("blocked_confirm");
    expect(rolled.steps[0].detail).toMatch(/ambiguous|appears \d+ times/);
    expect(fs.readFileSync(p, "utf8")).toBe(doubled);
    expect(
      readCompactHistory("backend-api-contract", { cwd: repoRoot, storage }).entries,
    ).toHaveLength(1);
  });

  it("removal → unrelated edit far away → rollback restores exactly", () => {
    const long = PLAYBOOK + "\n## Appendix\n\n" + "Filler paragraph.\n\n".repeat(20);
    const p = projectPlaybook("backend-api-contract.md", long);
    applyEvolveDelta(
      delta({ path: p, op: "remove", replacement: "" }),
      ctx({ historyKey: "backend-api-contract" }),
    );
    const edited = fs.readFileSync(p, "utf8").replace(
      "## Appendix",
      "## Appendix\n\nAdded long after the removal.",
    );
    fs.writeFileSync(p, edited, "utf8");

    const rolled = rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot });
    expect(rolled.status).toBe("restored");
    const after = fs.readFileSync(p, "utf8");
    expect(after).toContain("Return a bare string in the body.");
    expect(after).toContain("Added long after the removal.");
  });

  it("replace → duplicate the span elsewhere → rollback blocks", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(delta({ path: p }), ctx({ historyKey: "backend-api-contract" }));
    const applied = readCompactHistory("backend-api-contract", { cwd: repoRoot, storage })
      .entries[0].applied_span;
    // The same anchor line again, far from the recorded offset.
    const withDuplicate = fs.readFileSync(p, "utf8") + "\n## Appendix\n\nfiller\n\n" + applied;
    fs.writeFileSync(p, withDuplicate, "utf8");

    const rolled = rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot });
    expect(rolled.status).toBe("blocked_confirm");
    expect(rolled.steps[0].detail).toMatch(/appears 2 times/);
    expect(fs.readFileSync(p, "utf8")).toBe(withDuplicate);
  });

  it("a removal whose surrounding text vanished blocks rather than guessing", () => {
    const p = projectPlaybook("backend-api-contract.md", PLAYBOOK);
    applyEvolveDelta(
      delta({ path: p, op: "remove", replacement: "" }),
      ctx({ historyKey: "backend-api-contract" }),
    );
    fs.writeFileSync(p, "# something else entirely\n", "utf8");

    const rolled = rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot });
    expect(rolled.status).toBe("blocked_confirm");
    expect(fs.readFileSync(p, "utf8")).toBe("# something else entirely\n");
  });
});

describe("codex r1 #9 — add at EOF on a file with no trailing newline", () => {
  it("apply → rollback is byte-identical", () => {
    const noNewline = "# p\n\n## Error envelope\n\nBare string.";
    const p = projectPlaybook("backend-api-contract.md", noNewline);
    applyEvolveDelta(
      delta({
        path: p,
        op: "add",
        span: "Retries",
        replacement: "Retry with a budget.",
        before_hash: sha256(noNewline),
      }),
      ctx({ historyKey: "backend-api-contract" }),
    );
    expect(fs.readFileSync(p, "utf8")).toContain("## Retries");

    const rolled = rollbackEvolve("backend-api-contract", 1, { cwd: repoRoot, storage, pluginRoot });
    expect(rolled.status).toBe("restored");
    expect(fs.readFileSync(p, "utf8")).toBe(noNewline);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// KTD57 — checkpoint verdict → evolve target
// ─────────────────────────────────────────────────────────────────────────────

describe("KTD57 — the 5-way verdict maps onto evolve targets", () => {
  it("maps each verdict to exactly one route", () => {
    expect(routeCheckpointVerdict("decision")).toEqual({ route: "harvest" });
    expect(routeCheckpointVerdict("playbook_span")).toEqual({ route: "curator", target: "playbook" });
    expect(routeCheckpointVerdict("skill_def")).toEqual({ route: "curator", target: "skill" });
    expect(routeCheckpointVerdict("reflect")).toEqual({ route: "human-queue" });
    expect(routeCheckpointVerdict("none")).toEqual({ route: "no-op" });
  });

  it("an unrecognized verdict is the human queue, never a write", () => {
    expect(routeCheckpointVerdict("something-new")).toEqual({ route: "human-queue" });
  });

  it("a real checkpoint verdict routes through the map", () => {
    const verdict = learningCheckpoint({
      run_id: RUN_ID,
      phase: "build",
      signals: { playbook_span_stale: true },
    });
    expect(verdict.verdict).toBe("playbook_span");
    expect(routeCheckpointVerdict(verdict.verdict)).toEqual({ route: "curator", target: "playbook" });
    expect(classifyAutoPath("playbook").allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// plan-level guards
// ─────────────────────────────────────────────────────────────────────────────

describe("planEvolveDelta records an exact, invertible region", () => {
  it("head + after_span + tail reconstructs the file it writes", () => {
    const plan = planEvolveDelta(
      {
        schema_version: "guild.evolve_delta.v1",
        target: "playbook",
        path: "p.md",
        span: "Error envelope",
        op: "replace",
        replacement: "Typed envelope.",
        proposer: "operator",
        before_hash: sha256(locatePlaybookSpan(PLAYBOOK, "Error envelope")!.text),
      },
      PLAYBOOK,
    );
    expect(plan.next).toBe(plan.head + plan.after_span + plan.tail);
    expect(plan.offset).toBe(plan.head.length);
    expect(sha256(plan.head)).toBe(plan.head_hash);
    expect(sha256(plan.tail)).toBe(plan.tail_hash);
    expect(plan.next.slice(plan.offset, plan.offset + plan.after_span.length)).toBe(plan.after_span);
  });
});
