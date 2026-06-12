/**
 * __tests__/cost-gate.test.ts — TDD-first tests for SC-15 cost-gate.ts
 *
 * RED: import fails until understand/cost-gate.ts is created.
 *
 * Tests cover pure-function units (no FS) and a minimal FS smoke-check.
 * All SC-15 acceptance criteria exercised:
 *   - gate:"pass"|"confirm"|"abort" with correct transition thresholds
 *   - estimate.{files,tokens_est} always present
 *   - reason always present; "within budget" on pass
 *   - exit-code contract encoded in gateExitCode helper test
 */

import * as os from "os";
import * as fs from "fs";
import * as path from "path";

import {
  AVG_TOKENS_PER_FILE,
  CONFIRM_RATIO,
  computeTokensEstimate,
  gateDecision,
  gateExitCode,
  runCostGate,
  scanCorpusFiles,
} from "../understand/cost-gate";

import type { CostGateEstimate, CostGateResult } from "../understand/cost-gate";

// ---------------------------------------------------------------------------
// Fixture config — matches KNOWLEDGE_CONFIG_DEFAULTS
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = { maxFiles: 3000, maxTokens: 1_000_000 };

// For confirm boundary: tokens_est > maxTokens * CONFIRM_RATIO
// With AVG_TOKENS_PER_FILE=300, CONFIRM_RATIO=0.7:
//   confirm_token_threshold = 700_000
//   confirm_files_threshold = 700_000 / 300 = 2333.33 → 2334 files cross into confirm
const CONFIRM_TOKEN_THRESHOLD = Math.floor(DEFAULT_CONFIG.maxTokens * CONFIRM_RATIO);

// ---------------------------------------------------------------------------
// Section A — computeTokensEstimate (pure, no FS)
// ---------------------------------------------------------------------------

describe("Section A — computeTokensEstimate", () => {
  it("A1: zero files → 0 tokens", () => {
    expect(computeTokensEstimate(0)).toBe(0);
  });

  it("A2: tokens_est = files × AVG_TOKENS_PER_FILE", () => {
    expect(computeTokensEstimate(1)).toBe(AVG_TOKENS_PER_FILE);
    expect(computeTokensEstimate(100)).toBe(100 * AVG_TOKENS_PER_FILE);
  });

  it("A3: large corpus scales linearly", () => {
    const files = 3000;
    expect(computeTokensEstimate(files)).toBe(files * AVG_TOKENS_PER_FILE);
  });

  it("A4: returns a non-negative integer", () => {
    const result = computeTokensEstimate(42);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Section B — gateDecision: pass
// ---------------------------------------------------------------------------

describe("Section B — gateDecision: pass", () => {
  it("B1: small corpus (10 files) → pass, reason 'within budget'", () => {
    const estimate: CostGateEstimate = { files: 10, tokens_est: computeTokensEstimate(10) };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.gate).toBe("pass");
    expect(result.reason).toBe("within budget");
  });

  it("B2: empty corpus → pass", () => {
    const estimate: CostGateEstimate = { files: 0, tokens_est: 0 };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.gate).toBe("pass");
  });

  it("B3: tokens_est exactly at confirm threshold → pass (boundary — at, not over)", () => {
    const estimate: CostGateEstimate = {
      files: 100,
      tokens_est: CONFIRM_TOKEN_THRESHOLD, // exactly at boundary
    };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.gate).toBe("pass");
  });

  it("B4: estimate shape always present on pass", () => {
    const estimate: CostGateEstimate = { files: 50, tokens_est: 15_000 };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.estimate).toEqual(estimate);
    expect(result.estimate.files).toBe(50);
    expect(result.estimate.tokens_est).toBe(15_000);
  });

  it("B5: custom small maxTokens — pass when well below threshold", () => {
    const smallConfig = { maxFiles: 100, maxTokens: 50_000 };
    const estimate: CostGateEstimate = { files: 5, tokens_est: 1_500 };
    const result = gateDecision(estimate, smallConfig);
    expect(result.gate).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Section C — gateDecision: confirm
// ---------------------------------------------------------------------------

describe("Section C — gateDecision: confirm", () => {
  it("C1: tokens_est just over confirm threshold → confirm", () => {
    const estimate: CostGateEstimate = {
      files: 2400,
      tokens_est: CONFIRM_TOKEN_THRESHOLD + 1,
    };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.gate).toBe("confirm");
  });

  it("C2: tokens_est at maxTokens boundary → confirm (at max, not over)", () => {
    const estimate: CostGateEstimate = {
      files: 2500,
      tokens_est: DEFAULT_CONFIG.maxTokens, // exactly at limit
    };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.gate).toBe("confirm");
  });

  it("C3: reason field present on confirm", () => {
    const estimate: CostGateEstimate = {
      files: 2400,
      tokens_est: CONFIRM_TOKEN_THRESHOLD + 10_000,
    };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.reason).toBeDefined();
    expect(typeof result.reason).toBe("string");
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  it("C4: estimate correctly reflected in confirm result", () => {
    const estimate: CostGateEstimate = { files: 2600, tokens_est: 780_000 };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.estimate).toEqual(estimate);
  });

  it("C5: files at maxFiles with tokens in confirm range → confirm not abort", () => {
    // files == maxFiles (not >) with tokens_est in confirm zone
    const estimate: CostGateEstimate = {
      files: DEFAULT_CONFIG.maxFiles,
      tokens_est: DEFAULT_CONFIG.maxTokens * 0.9, // within max, above confirm threshold
    };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    // files === maxFiles is NOT > maxFiles, so no files-abort
    // tokens in confirm zone → confirm
    expect(result.gate).toBe("confirm");
  });
});

// ---------------------------------------------------------------------------
// Section D — gateDecision: abort
// ---------------------------------------------------------------------------

describe("Section D — gateDecision: abort", () => {
  it("D1: files > maxFiles → abort", () => {
    const estimate: CostGateEstimate = {
      files: DEFAULT_CONFIG.maxFiles + 1,
      tokens_est: computeTokensEstimate(DEFAULT_CONFIG.maxFiles + 1),
    };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.gate).toBe("abort");
  });

  it("D2: tokens_est > maxTokens → abort", () => {
    const estimate: CostGateEstimate = {
      files: 100,
      tokens_est: DEFAULT_CONFIG.maxTokens + 1,
    };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.gate).toBe("abort");
  });

  it("D3: reason present on files abort, mentions maxFiles", () => {
    const estimate: CostGateEstimate = {
      files: DEFAULT_CONFIG.maxFiles + 100,
      tokens_est: computeTokensEstimate(DEFAULT_CONFIG.maxFiles + 100),
    };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.reason).toBeDefined();
    expect(result.reason).toMatch(/maxFiles|file/i);
  });

  it("D4: reason present on tokens abort, mentions maxTokens", () => {
    const estimate: CostGateEstimate = {
      files: 100,
      tokens_est: DEFAULT_CONFIG.maxTokens + 500_000,
    };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.reason).toBeDefined();
    expect(result.reason).toMatch(/token/i);
  });

  it("D5: files > maxFiles aborts even if tokens would pass", () => {
    const estimate: CostGateEstimate = {
      files: DEFAULT_CONFIG.maxFiles + 1,
      tokens_est: 1_000, // tiny tokens
    };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.gate).toBe("abort");
  });

  it("D6: reason is always defined on abort", () => {
    const estimates: CostGateEstimate[] = [
      { files: DEFAULT_CONFIG.maxFiles + 1, tokens_est: 0 },
      { files: 1, tokens_est: DEFAULT_CONFIG.maxTokens + 1 },
    ];
    for (const est of estimates) {
      const result = gateDecision(est, DEFAULT_CONFIG);
      expect(result.reason).toBeDefined();
    }
  });

  it("D7: estimate shape always present on abort", () => {
    const estimate: CostGateEstimate = {
      files: DEFAULT_CONFIG.maxFiles + 1,
      tokens_est: 999_999_999,
    };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.estimate).toEqual(estimate);
  });
});

// ---------------------------------------------------------------------------
// Section E — output shape invariants
// ---------------------------------------------------------------------------

describe("Section E — output shape invariants", () => {
  const cases: Array<{ label: string; est: CostGateEstimate }> = [
    { label: "pass",    est: { files: 50, tokens_est: 15_000 } },
    { label: "confirm", est: { files: 2400, tokens_est: CONFIRM_TOKEN_THRESHOLD + 1 } },
    { label: "abort",   est: { files: DEFAULT_CONFIG.maxFiles + 1, tokens_est: 0 } },
  ];

  for (const { label, est } of cases) {
    it(`E-shape[${label}]: result always has gate + estimate`, () => {
      const result = gateDecision(est, DEFAULT_CONFIG);
      expect(result).toHaveProperty("gate");
      expect(result).toHaveProperty("estimate");
      expect(["pass", "confirm", "abort"]).toContain(result.gate);
    });

    it(`E-estimate[${label}]: estimate.files + estimate.tokens_est are non-negative integers`, () => {
      const result = gateDecision(est, DEFAULT_CONFIG);
      expect(Number.isInteger(result.estimate.files)).toBe(true);
      expect(Number.isInteger(result.estimate.tokens_est)).toBe(true);
      expect(result.estimate.files).toBeGreaterThanOrEqual(0);
      expect(result.estimate.tokens_est).toBeGreaterThanOrEqual(0);
    });
  }

  it("E-reason: pass result has reason 'within budget'", () => {
    const result = gateDecision({ files: 50, tokens_est: 15_000 }, DEFAULT_CONFIG);
    expect(result.reason).toBe("within budget");
  });
});

// ---------------------------------------------------------------------------
// Section F — gateExitCode (SC-15 exit-code contract)
// ---------------------------------------------------------------------------

describe("Section F — gateExitCode", () => {
  it("F1: pass → exit 0", () => {
    expect(gateExitCode("pass")).toBe(0);
  });

  it("F2: confirm → exit 0 (proceed with warning)", () => {
    expect(gateExitCode("confirm")).toBe(0);
  });

  it("F3: abort → exit 1", () => {
    expect(gateExitCode("abort")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Section G — runCostGate FS smoke-check
// ---------------------------------------------------------------------------

describe("Section G — runCostGate FS smoke", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cost-gate-test-"));
    // Create a tiny corpus (5 files)
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "// file a");
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "// file b");
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# readme");
    fs.writeFileSync(path.join(tmpDir, "c.ts"), "// file c");
    fs.writeFileSync(path.join(tmpDir, "d.md"), "## docs");
    // Guild dir (settings) — absent, so resolver uses KNOWLEDGE_CONFIG_DEFAULTS
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("G1: returns a valid CostGateResult shape", () => {
    const result = runCostGate(tmpDir);
    expect(result).toHaveProperty("gate");
    expect(result).toHaveProperty("estimate");
    expect(["pass", "confirm", "abort"]).toContain(result.gate);
  });

  it("G2: estimate.files is a non-negative integer", () => {
    const result = runCostGate(tmpDir);
    expect(Number.isInteger(result.estimate.files)).toBe(true);
    expect(result.estimate.files).toBeGreaterThanOrEqual(0);
  });

  it("G3: tiny corpus (5 files) → pass under default limits", () => {
    const result = runCostGate(tmpDir);
    expect(result.gate).toBe("pass");
  });

  it("G4: gateExitCode(result.gate) returns 0 for pass", () => {
    const result = runCostGate(tmpDir);
    expect(gateExitCode(result.gate)).toBe(0);
  });

  it("G5: corpus with file count > maxFiles → abort (SC-15 huge-repo gate)", () => {
    // tmpDir has 5 files (a.ts, b.ts, README.md, c.ts, d.md).
    // scanCorpusFiles(tmpDir, 3) calls walkRepo(tmpDir, 4) — stops at 4 files.
    // 4 > 3 (maxFiles=3) → gateDecision returns abort.
    const fileCount = scanCorpusFiles(tmpDir, 3);
    expect(fileCount).toBeGreaterThan(3); // confirms the limit was hit
    const estimate: CostGateEstimate = {
      files: fileCount,
      tokens_est: computeTokensEstimate(fileCount),
    };
    const result = gateDecision(estimate, { maxFiles: 3, maxTokens: 1_000_000 });
    expect(result.gate).toBe("abort");
  });
});

// ---------------------------------------------------------------------------
// Section H — B1/B2 blocker regression (codex G-lane hardening)
// ---------------------------------------------------------------------------

describe("Section H — codex blocker regression", () => {
  it("H1: pass result always includes reason field set to 'within budget'", () => {
    // Verifies that the pass branch of gateDecision emits reason, not undefined.
    // (B1 codex blocker: all three gate outcomes must carry a reason field.)
    const estimate: CostGateEstimate = { files: 1, tokens_est: AVG_TOKENS_PER_FILE };
    const result = gateDecision(estimate, DEFAULT_CONFIG);
    expect(result.gate).toBe("pass");
    expect(result).toHaveProperty("reason");
    expect(result.reason).toBe("within budget");
  });
});
