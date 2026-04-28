// verify-codex-review-trail.test.ts — SC11 validator pinning.
//
// The validator script (`scripts/verify-codex-review-trail.ts`) walks
// `.guild/runs/<run-id>/codex-review/*.md` and asserts every file has a
// frontmatter `final_status:` set to either `satisfied` or
// `skipped-codex-unavailable`. This test pins the validator behaviour
// against three fixtures:
//
//   1. all-satisfied trail        → exits 0; valid count == total.
//   2. missing-status trail       → exits 1; offending file listed.
//   3. wrong-status trail         → exits 1; offending file listed.
//
// PURE: synthesises trail files in tmpdirs; never mutates any real
// `.guild/` directory.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ALLOWED_FINAL_STATUS,
  extractFrontmatter,
  readFinalStatus,
  verifyCodexReviewTrail,
  verifyOneFile,
} from "../../scripts/verify-codex-review-trail.js";

const VALIDATOR_SCRIPT = resolve(
  __dirname,
  "..",
  "..",
  "scripts",
  "verify-codex-review-trail.ts",
);

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-codex-trail-validator-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

const SATISFIED = `---
gate: lane
artifact: T1-architect (architect lane)
lane: T1-architect
rounds: 3
final_status: satisfied
started_at: 2026-04-27T08:00:00Z
ended_at: 2026-04-27T08:45:00Z
---

# Body
`;

const SKIPPED = `---
gate: lane
artifact: T2-x (x lane)
lane: T2-x
rounds: 0
final_status: skipped-codex-unavailable
started_at: 2026-04-27T09:00:00Z
ended_at: 2026-04-27T09:00:01Z
---

# Body
`;

const MISSING_FINAL_STATUS = `---
gate: lane
artifact: T3-y (y lane)
lane: T3-y
rounds: 1
started_at: 2026-04-27T10:00:00Z
ended_at: 2026-04-27T10:05:00Z
---

# Body
`;

const WRONG_STATUS = `---
gate: lane
artifact: T4-z (z lane)
lane: T4-z
rounds: 4
final_status: in-progress
started_at: 2026-04-27T11:00:00Z
ended_at: 2026-04-27T11:30:00Z
---

# Body
`;

const NO_FRONTMATTER = `# T5-no-frontmatter

This file has no frontmatter at all.
`;

// ──────────────────────────────────────────────────────────────────────────
// Module-level invariants
// ──────────────────────────────────────────────────────────────────────────

describe("verify-codex-review-trail / surface", () => {
  it("ALLOWED_FINAL_STATUS is exactly [satisfied, skipped-codex-unavailable] in order", () => {
    expect(ALLOWED_FINAL_STATUS).toEqual([
      "satisfied",
      "skipped-codex-unavailable",
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

describe("verify-codex-review-trail / extractFrontmatter", () => {
  it("returns the frontmatter block when delimited by ---", () => {
    const fm = extractFrontmatter(SATISFIED);
    expect(fm).not.toBeNull();
    expect(fm).toContain("final_status: satisfied");
  });

  it("returns null when no frontmatter is present", () => {
    expect(extractFrontmatter(NO_FRONTMATTER)).toBeNull();
  });

  it("returns null when --- is missing the closing delimiter", () => {
    const open = "---\nkey: value\nno close here\n";
    expect(extractFrontmatter(open)).toBeNull();
  });
});

describe("verify-codex-review-trail / readFinalStatus", () => {
  it("reads `satisfied` from a normal frontmatter line", () => {
    const fm = "gate: lane\nfinal_status: satisfied\n";
    expect(readFinalStatus(fm)).toBe("satisfied");
  });

  it("reads `skipped-codex-unavailable` when present", () => {
    const fm = "gate: lane\nfinal_status: skipped-codex-unavailable\n";
    expect(readFinalStatus(fm)).toBe("skipped-codex-unavailable");
  });

  it("returns null when key is absent", () => {
    const fm = "gate: lane\nartifact: foo\n";
    expect(readFinalStatus(fm)).toBeNull();
  });

  it("strips quotes around the value", () => {
    expect(readFinalStatus(`final_status: "satisfied"\n`)).toBe("satisfied");
    expect(readFinalStatus(`final_status: 'satisfied'\n`)).toBe("satisfied");
  });

  it("tolerates leading whitespace before the key", () => {
    expect(readFinalStatus(`  final_status: satisfied\n`)).toBe("satisfied");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// verifyOneFile
// ──────────────────────────────────────────────────────────────────────────

describe("verify-codex-review-trail / verifyOneFile", () => {
  it("returns ok=true for a satisfied frontmatter", async () => {
    const p = join(tmpRoot, "lane-T1.md");
    await writeFile(p, SATISFIED, "utf8");
    expect(verifyOneFile(p)).toMatchObject({
      ok: true,
      finalStatus: "satisfied",
      reason: null,
    });
  });

  it("returns ok=true for skipped-codex-unavailable", async () => {
    const p = join(tmpRoot, "lane-T2.md");
    await writeFile(p, SKIPPED, "utf8");
    expect(verifyOneFile(p)).toMatchObject({
      ok: true,
      finalStatus: "skipped-codex-unavailable",
    });
  });

  it("returns ok=false when final_status is missing", async () => {
    const p = join(tmpRoot, "lane-T3.md");
    await writeFile(p, MISSING_FINAL_STATUS, "utf8");
    const r = verifyOneFile(p);
    expect(r.ok).toBe(false);
    expect(r.finalStatus).toBeNull();
    expect(r.reason).toContain("missing");
  });

  it("returns ok=false when final_status has a wrong value", async () => {
    const p = join(tmpRoot, "lane-T4.md");
    await writeFile(p, WRONG_STATUS, "utf8");
    const r = verifyOneFile(p);
    expect(r.ok).toBe(false);
    expect(r.finalStatus).toBe("in-progress");
    expect(r.reason).toContain("not in allowed set");
  });

  it("returns ok=false when no frontmatter exists", async () => {
    const p = join(tmpRoot, "lane-T5.md");
    await writeFile(p, NO_FRONTMATTER, "utf8");
    const r = verifyOneFile(p);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("no YAML frontmatter");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// verifyCodexReviewTrail (directory walker)
// ──────────────────────────────────────────────────────────────────────────

describe("verify-codex-review-trail / verifyCodexReviewTrail (passing trail)", () => {
  it("ok=true when every file has an allowed final_status", async () => {
    await writeFile(join(tmpRoot, "spec.md"), SATISFIED, "utf8");
    await writeFile(join(tmpRoot, "plan.md"), SATISFIED, "utf8");
    await writeFile(join(tmpRoot, "lane-T1-x.md"), SATISFIED, "utf8");
    await writeFile(join(tmpRoot, "lane-T2-y.md"), SKIPPED, "utf8");

    const r = verifyCodexReviewTrail(tmpRoot);
    expect(r.ok).toBe(true);
    expect(r.totalFiles).toBe(4);
    expect(r.validFiles).toBe(4);
    expect(r.invalidFiles).toBe(0);
  });

  it("non-md files are ignored by the walker", async () => {
    await writeFile(join(tmpRoot, "lane-T1.md"), SATISFIED, "utf8");
    await writeFile(join(tmpRoot, "README.txt"), "ignore me\n", "utf8");
    await writeFile(join(tmpRoot, "notes"), "no extension\n", "utf8");

    const r = verifyCodexReviewTrail(tmpRoot);
    expect(r.totalFiles).toBe(1);
    expect(r.ok).toBe(true);
  });
});

describe("verify-codex-review-trail / verifyCodexReviewTrail (missing-status trail)", () => {
  it("ok=false when one file is missing final_status; offender listed", async () => {
    await writeFile(join(tmpRoot, "spec.md"), SATISFIED, "utf8");
    await writeFile(join(tmpRoot, "lane-T1.md"), MISSING_FINAL_STATUS, "utf8");

    const r = verifyCodexReviewTrail(tmpRoot);
    expect(r.ok).toBe(false);
    expect(r.totalFiles).toBe(2);
    expect(r.invalidFiles).toBe(1);
    const offender = r.perFile.find((f) => !f.ok);
    expect(offender).toBeDefined();
    expect(offender!.path.endsWith("lane-T1.md")).toBe(true);
    expect(offender!.reason).toContain("missing");
  });
});

describe("verify-codex-review-trail / verifyCodexReviewTrail (wrong-status trail)", () => {
  it("ok=false when one file has an unrecognised final_status; offender listed", async () => {
    await writeFile(join(tmpRoot, "spec.md"), SATISFIED, "utf8");
    await writeFile(join(tmpRoot, "lane-T2.md"), WRONG_STATUS, "utf8");

    const r = verifyCodexReviewTrail(tmpRoot);
    expect(r.ok).toBe(false);
    expect(r.totalFiles).toBe(2);
    expect(r.invalidFiles).toBe(1);
    const offender = r.perFile.find((f) => !f.ok);
    expect(offender).toBeDefined();
    expect(offender!.finalStatus).toBe("in-progress");
    expect(offender!.reason).toContain("not in allowed set");
  });
});

describe("verify-codex-review-trail / verifyCodexReviewTrail (missing directory)", () => {
  it("ok=false when the directory does not exist; non-zero invalidFiles", () => {
    const missing = join(tmpRoot, "nope");
    const r = verifyCodexReviewTrail(missing);
    expect(r.ok).toBe(false);
    expect(r.totalFiles).toBe(0);
    expect(r.perFile.length).toBe(1);
    expect(r.perFile[0].reason).toContain("directory does not exist");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// CLI smoke tests — exit codes + stdout/stderr shape.
// ──────────────────────────────────────────────────────────────────────────

describe("verify-codex-review-trail / CLI exit codes", () => {
  it("exits 0 with summary on stdout for an all-passing trail", async () => {
    await writeFile(join(tmpRoot, "spec.md"), SATISFIED, "utf8");
    await writeFile(join(tmpRoot, "plan.md"), SATISFIED, "utf8");
    await writeFile(join(tmpRoot, "lane-T1.md"), SKIPPED, "utf8");

    const result = spawnSync(
      "npx",
      ["tsx", VALIDATOR_SCRIPT, tmpRoot],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("verify-codex-review-trail: OK");
    expect(result.stdout).toContain("3/3");
  });

  it("exits 1 with offender on stderr when a file has a missing final_status", async () => {
    await writeFile(join(tmpRoot, "spec.md"), SATISFIED, "utf8");
    await writeFile(join(tmpRoot, "lane-T1.md"), MISSING_FINAL_STATUS, "utf8");

    const result = spawnSync(
      "npx",
      ["tsx", VALIDATOR_SCRIPT, tmpRoot],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("verify-codex-review-trail: FAIL");
    expect(result.stderr).toContain("lane-T1.md");
    expect(result.stderr).toContain("missing");
  });

  it("exits 1 with offender on stderr when a file has a wrong final_status", async () => {
    await writeFile(join(tmpRoot, "spec.md"), SATISFIED, "utf8");
    await writeFile(join(tmpRoot, "lane-T2.md"), WRONG_STATUS, "utf8");

    const result = spawnSync(
      "npx",
      ["tsx", VALIDATOR_SCRIPT, tmpRoot],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("verify-codex-review-trail: FAIL");
    expect(result.stderr).toContain("lane-T2.md");
    expect(result.stderr).toContain("not in allowed set");
  });

  it("exits 2 with usage stderr when no directory argument is given", () => {
    const result = spawnSync("npx", ["tsx", VALIDATOR_SCRIPT], {
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage:");
  });

  it("exits 2 when the directory does not exist", () => {
    const result = spawnSync(
      "npx",
      ["tsx", VALIDATOR_SCRIPT, join(tmpRoot, "nope")],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("directory does not exist");
  });
});
