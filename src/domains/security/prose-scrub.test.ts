/**
 * src/domains/security/prose-scrub.test.ts
 *
 * #108 / D2: prose surfaces are never rewritten in place. A real credential shape
 * refuses the write and names the span; the length-entropy group never applies.
 */

import { describe, expect, test, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  classifyGuildScrubSurface,
  describeProseRefusal,
  evaluateProseContent,
  isProseScrubTarget,
  priorFromToolResponse,
  proposedWriteContent,
  proseTargetSurface,
  PROSE_CREDENTIAL_PATTERNS,
  proseSnapshotKey,
  recordProseSnapshot,
  restoreProseSnapshot,
  takeProseSnapshot,
  redactField,
  scrubbedWrite,
} from "./index";

const POLICY = {
  env_allowlist: [],
  redaction_patterns: [] as string[],
  fail_mode_durable: "closed" as const,
  fail_mode_telemetry: "open" as const,
};

// The issue's seven-line probe, verbatim.
const PROBE = [
  "1 path: app/Http/Middleware/EnforceSessionMaxDuration.php",
  "2 bare: PollExternalWebhookJournalJobTest",
  "3 short: ApiPerformanceMonitor",
  "4 header: Authorization: Bearer abc123",
  "5 home: ~/.claude/settings.json",
  "6 safe: config/queue.php",
  "7 hash: 816654c",
  "",
].join("\n");

// Assembled in pieces so this fixture never carries a scannable secret.
const GHP = `ghp_${"A1b2".repeat(9)}`;
const SK = `sk-ant-${"Zq9x".repeat(6)}`;

const tmps: string[] = [];
function tmpdir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-prose-scrub-"));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("evaluateProseContent", () => {
  test("the issue probe is clean (the log redactors would have rewritten 5 of 7 lines)", () => {
    // Anti-vacuity: the log policy still fires on this exact text.
    expect(redactField(PROBE, Number.POSITIVE_INFINITY)).not.toBe(PROBE);
    const verdict = evaluateProseContent(PROBE, POLICY);
    expect(verdict.ok).toBe(true);
    expect(verdict.spans).toEqual([]);
  });

  test("ordinary long identifiers and source paths never trip the prose policy", () => {
    const text = "See `PollExternalWebhookJournalJobTest` in tests/Feature/PollExternalWebhookJournalJobTest.php and token: abc, password: see vault.\n";
    expect(evaluateProseContent(text, POLICY).ok).toBe(true);
  });

  test("a real credential shape refuses and names line, column and category", () => {
    const text = `# Page\n\nUse ${GHP} for the probe.\n`;
    const verdict = evaluateProseContent(text, POLICY);
    expect(verdict.ok).toBe(false);
    expect(verdict.spans).toHaveLength(1);
    expect(verdict.spans[0]).toMatchObject({ line: 3, column: 5, length: GHP.length, category: "GitHub personal access token" });
    const message = describeProseRefusal(verdict, ".guild/wiki/page.md");
    expect(message).toContain("line 3, column 5");
    expect(message).toContain("GitHub personal access token");
    expect(message).not.toContain(GHP);
  });

  test("provider keys, JWTs and PEM blocks are credential shapes", () => {
    const jwt = `eyJ${"a".repeat(10)}.${"b".repeat(10)}.${"c".repeat(10)}`;
    for (const secret of [SK, jwt, "-----BEGIN RSA PRIVATE KEY-----", `Bearer ${"Q7w".repeat(8)}`]) {
      expect(evaluateProseContent(`x ${secret}\n`, POLICY).ok).toBe(false);
    }
  });

  test("operator redaction_patterns refuse instead of rewriting; an invalid pattern fails closed", () => {
    const custom = evaluateProseContent("ticket ACME-1234 here\n", { ...POLICY, redaction_patterns: ["ACME-\\d+"] });
    expect(custom.ok).toBe(false);
    expect(custom.spans[0]).toMatchObject({ line: 1, column: 8, category: "secrets_policy.redaction_patterns[0]" });

    const broken = evaluateProseContent("clean\n", { ...POLICY, redaction_patterns: ["("] });
    expect(broken.ok).toBe(false);
    expect(broken.failures).toHaveLength(1);
    // The engine's error text echoes the pattern; a credential in it never reaches the refusal.
    const planted = `(${"Q9v"}r2Lu8secret`;
    const echoed = evaluateProseContent("clean\n", { ...POLICY, redaction_patterns: [planted] });
    expect(echoed.ok).toBe(false);
    expect(describeProseRefusal(echoed, "p.md")).not.toContain(planted);
  });

  test("password assignments are caught in any case; a prose mention of the word is not", () => {
    for (const line of ["password=Q9v!r2L@u8", "PASSWORD=Q9v!r2L@u8", "Password = Q9v!r2L@u8"]) {
      expect(evaluateProseContent(`${line}\n`, POLICY).spans[0]?.category).toBe("password-assignment");
    }
    expect(evaluateProseContent("Rotate the PASSWORD monthly.\n", POLICY).ok).toBe(true);
  });

  test("an empty-matching operator pattern cannot spin or refuse clean prose", () => {
    expect(evaluateProseContent("clean prose\n", { ...POLICY, redaction_patterns: ["q*"] }).ok).toBe(true);
  });

  test("the prose pattern set is frozen and excludes the entropy, home-dir and bare key:value groups", () => {
    expect(Object.isFrozen(PROSE_CREDENTIAL_PATTERNS)).toBe(true);
    const sources = PROSE_CREDENTIAL_PATTERNS.map(([re]) => re.source);
    expect(sources.some((s) => s.includes("{20,}") && s.startsWith("[A-Za-z0-9+/=]"))).toBe(false);
    expect(sources.some((s) => s.includes("\\.claude"))).toBe(false);
    expect(PROSE_CREDENTIAL_PATTERNS.length).toBeGreaterThanOrEqual(15);
  });
});

describe("surface classification", () => {
  test("wiki, review and handoff markdown are prose; provenance and non-markdown are not", () => {
    const root = "/r";
    const wiki = path.join(root, ".guild", "wiki", "a", "b.md");
    const review = path.join(root, ".guild", "runs", "run-1", "review", "r.md");
    const handoff = path.join(root, ".guild", "runs", "run-1", "handoffs", "h.md");
    const prov = path.join(root, ".guild", "runs", "run-1", "provenance.json");
    const wikiJson = path.join(root, ".guild", "wiki", "index.json");
    expect(isProseScrubTarget(classifyGuildScrubSurface(wiki, root), wiki)).toBe(true);
    expect(isProseScrubTarget(classifyGuildScrubSurface(review, root), review)).toBe(true);
    expect(isProseScrubTarget(classifyGuildScrubSurface(handoff, root), handoff)).toBe(true);
    expect(classifyGuildScrubSurface(prov, root)).toBe("provenance");
    expect(isProseScrubTarget("provenance", prov)).toBe(false);
    expect(isProseScrubTarget(classifyGuildScrubSurface(wikiJson, root), wikiJson)).toBe(false);
    expect(classifyGuildScrubSurface(path.join(root, "src", "a.md"), root)).toBeNull();
    for (const name of ["summary.md", "verify.md", "review.md"]) {
      const f = path.join(root, ".guild", "runs", "run-1", name);
      expect(isProseScrubTarget(classifyGuildScrubSurface(f, root), f)).toBe(true);
    }
    expect(classifyGuildScrubSurface(path.join(root, ".guild", "runs", "run-1", "run.yaml"), root)).toBeNull();
    expect(classifyGuildScrubSurface(path.join(root, ".guild", "runs", "run-1", "notes.md"), root)).toBeNull();
    const nested = path.join(root, ".guild", "runs", "run-1", "quality", "summary.md");
    expect(isProseScrubTarget(classifyGuildScrubSurface(nested, root), nested)).toBe(true);
    expect(classifyGuildScrubSurface(path.join(root, ".guild", "runs", "run-1", "quality", "notes.md"), root)).toBeNull();
  });
});

describe("proposedWriteContent", () => {
  test("Write uses content; Edit applies the first or every replacement; unknown shapes return null", () => {
    expect(proposedWriteContent("Write", { content: "new" }, "old")).toBe("new");
    expect(proposedWriteContent("Edit", { old_string: "a", new_string: "$&b" }, "a a")).toBe("$&b a");
    expect(proposedWriteContent("Edit", { old_string: "a", new_string: "c", replace_all: true }, "a a")).toBe("c c");
    expect(proposedWriteContent("Edit", { old_string: "zz", new_string: "c" }, "a a")).toBeNull();
    expect(proposedWriteContent("Edit", { old_string: "a", new_string: "c" }, null)).toBeNull();
    expect(proposedWriteContent("NotebookEdit", { new_source: "a" }, "a")).toBeNull();
  });

  test("MultiEdit applies its edits in order; any unplaceable edit makes the result unknown", () => {
    const edits = [{ old_string: "a", new_string: "b" }, { old_string: "b b", new_string: "c" }];
    expect(proposedWriteContent("MultiEdit", { edits }, "a b")).toBe("c");
    expect(proposedWriteContent("MultiEdit", { edits: [{ old_string: "zz", new_string: "c" }] }, "a")).toBeNull();
    expect(proposedWriteContent("MultiEdit", { edits: "nope" }, "a")).toBeNull();
    expect(proposedWriteContent("MultiEdit", { edits }, null)).toBeNull();
  });
});

describe("prior bytes from the host tool result", () => {
  test("originalFile is the prior; a create with no original means the file was absent; anything else is unknown", () => {
    expect(priorFromToolResponse({ type: "update", originalFile: "old" })).toEqual({ found: true, prior: "old" });
    expect(priorFromToolResponse({ type: "create", originalFile: null })).toEqual({ found: true, prior: null });
    expect(priorFromToolResponse({ success: true })).toEqual({ found: false, prior: null });
    expect(priorFromToolResponse("done")).toEqual({ found: false, prior: null });
  });
});

describe("proseTargetSurface", () => {
  test("a symlink outside .guild that resolves into the wiki is a wiki target; a plain file is not", () => {
    const root = fs.realpathSync(tmpdir());
    const page = path.join(root, ".guild", "wiki", "p.md");
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(page, "x", "utf8");
    const link = path.join(root, "link.md");
    fs.symlinkSync(page, link);
    expect(proseTargetSurface(link, root)).toBe("wiki");
    expect(proseTargetSurface(page, root)).toBe("wiki");
    expect(proseTargetSurface(path.join(root, ".guild", "wiki", "new", "q.md"), root)).toBe("wiki");
    const dangling = path.join(root, "dangling.md");
    fs.symlinkSync(path.join(root, ".guild", "wiki", "later", "new.md"), dangling);
    expect(proseTargetSurface(dangling, root)).toBe("wiki");
    // A dangling DIRECTORY link in front of the page is followed too.
    const dirAlias = path.join(root, "alias");
    fs.symlinkSync(path.join(root, ".guild", "wiki", "missing"), dirAlias);
    expect(proseTargetSurface(path.join(dirAlias, "page.md"), root)).toBe("wiki");
    expect(proseTargetSurface(path.join(root, "plain.md"), root)).toBeNull();
    expect(proseTargetSurface(path.join(root, ".guild", "wiki", "i.json"), root)).toBeNull();
  });
});

describe("prose snapshots", () => {
  test("record → take restores prior bytes, or removes a file that did not exist", () => {
    const dir = tmpdir();
    const file = path.join(dir, "page.md");
    const key = proseSnapshotKey("sess", "toolu_1", file);

    fs.writeFileSync(file, PROBE, "utf8");
    recordProseSnapshot(dir, key, PROBE);
    fs.writeFileSync(file, `leak ${GHP}\n`, "utf8");
    const snap = takeProseSnapshot(dir, key);
    expect(snap).toEqual({ found: true, prior: PROBE });
    restoreProseSnapshot(file, snap.prior);
    expect(fs.readFileSync(file, "utf8")).toBe(PROBE);
    // Consumed: a second take finds nothing.
    expect(takeProseSnapshot(dir, key).found).toBe(false);

    const fresh = path.join(dir, "fresh.md");
    const k2 = proseSnapshotKey("sess", "toolu_1", fresh);
    recordProseSnapshot(dir, k2, null);
    fs.writeFileSync(fresh, `leak ${GHP}\n`, "utf8");
    const s2 = takeProseSnapshot(dir, k2);
    expect(s2).toEqual({ found: true, prior: null });
    restoreProseSnapshot(fresh, s2.prior);
    expect(fs.existsSync(fresh)).toBe(false);
  });

  test("keys differ per session and per path", () => {
    expect(proseSnapshotKey("a", "t", "/x.md")).not.toBe(proseSnapshotKey("b", "t", "/x.md"));
    expect(proseSnapshotKey("a", "t", "/x.md")).not.toBe(proseSnapshotKey("a", "t", "/y.md"));
    expect(proseSnapshotKey("a", "t1", "/x.md")).not.toBe(proseSnapshotKey("a", "t2", "/x.md"));
  });
});

describe("scrubbedWrite on prose surfaces", () => {
  function runDirIn(root: string): string {
    const runDir = path.join(root, ".guild", "runs", "run-prose");
    fs.mkdirSync(runDir, { recursive: true });
    return runDir;
  }

  test("clean prose lands byte-identical (no entropy rewrite)", () => {
    const root = tmpdir();
    const runDir = runDirIn(root);
    const out = path.join(root, ".guild", "wiki", "probe.md");
    expect(scrubbedWrite(out, PROBE, { surface: "wiki", runDir, runId: "run-prose" })).toEqual({ written: true, blocked: false });
    expect(fs.readFileSync(out, "utf8")).toBe(PROBE);
  });

  test("a credential refuses the write, keeps the prior bytes, and names the span in the event", () => {
    const root = tmpdir();
    const runDir = runDirIn(root);
    const out = path.join(root, ".guild", "wiki", "page.md");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, "prior\n", "utf8");
    const result = scrubbedWrite(out, `new\n${SK}\n`, { surface: "wiki", runDir, runId: "run-prose" });
    expect(result).toMatchObject({ written: false, blocked: true });
    expect(result.refusal).toContain("line 2, column 1");
    expect(fs.readFileSync(out, "utf8")).toBe("prior\n");
    const events = fs.readFileSync(path.join(runDir, "logs", "security-events.jsonl"), "utf8");
    expect(events).toContain("secret_scrub_blocked");
    expect(events).toContain("line 2, column 1");
    expect(events).not.toContain(SK);
  });

  test("non-markdown durable surfaces keep the log redactors", () => {
    const root = tmpdir();
    const runDir = runDirIn(root);
    const out = path.join(runDir, "provenance.json");
    scrubbedWrite(out, `{"k":"${SK}"}`, { surface: "provenance", runDir, runId: "run-prose" });
    const stored = fs.readFileSync(out, "utf8");
    expect(stored).not.toContain(SK);
    expect(stored).toContain("[REDACTED_TOKEN]");
  });
});
