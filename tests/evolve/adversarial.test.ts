/**
 * tests/evolve/adversarial.test.ts
 *
 * Poisoned/adversarial eval fixtures (docs/v2/factory-evolution.md
 * §eval-corpus integrity + docs/v2/security.md §governance): the eval
 * corpus MUST keep adversarial fixtures, and they must FAIL-SAFE — every
 * test asserts the REAL probe/guard catches the poisoned content.
 *
 * Real-path discipline (no injected seams):
 *   - The poisoned wiki-page candidate runs through the ACTUAL ingest gate
 *     CLI (`scripts/lib/ingest-similarity.ts`) exactly as guild:wiki-ingest
 *     invokes it (`npx tsx … --cwd … --category … --title … --content-file …`)
 *     and must come back `should_pause: true` / `probe_hit: true` (D-PROBE
 *     ingest side, fail-closed).
 *   - The poisoned skill-edit eval case runs through the ACTUAL directive
 *     detector (`hooks/lib/security/injection-guard.ts`) the recall/handoff
 *     paths use, and must be flagged.
 *   - The poisoned guild.handoff.v2 envelope runs through the ACTUAL
 *     `classifyEnvelope` seam task-completed.ts uses, and must be flagged.
 *   - A benign control asserts the guards do NOT fail-everything.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  classifyEnvelope,
  sanitizeForInjection,
} from "../../hooks/lib/security/injection-guard";

const INGEST_CLI = path.resolve(__dirname, "../../scripts/lib/ingest-similarity.ts");
const FIXTURES = path.resolve(__dirname, "fixtures/adversarial");

interface IngestVerdict {
  top_score: number;
  top_path: string | null;
  gate: number;
  should_pause: boolean;
  probe_hit: boolean;
  probe_patterns: string[];
  pause_reason: "similarity" | "directive_probe" | "both" | null;
}

/** Invoke the ingest gate CLI exactly as the wiki-ingest skill does. */
function runIngestGate(cwd: string, title: string, contentFile: string): IngestVerdict {
  const r = spawnSync(
    "npx",
    [
      "tsx",
      INGEST_CLI,
      "--cwd",
      cwd,
      "--category",
      "concepts",
      "--title",
      title,
      "--content-file",
      contentFile,
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  expect(r.status).toBe(0); // gate decision rides the JSON, never the exit code
  return JSON.parse(r.stdout.trim()) as IngestVerdict;
}

describe("adversarial fixtures — poisoned wiki-page candidate (D-PROBE ingest gate)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-adv-ingest-"));
    fs.mkdirSync(path.join(tmpDir, ".guild", "wiki", "concepts"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fails closed: directive-laden candidate is blocked (should_pause + probe_hit) even in an empty category", () => {
    const verdict = runIngestGate(
      tmpDir,
      "Deployment notes for the payments service",
      path.join(FIXTURES, "poisoned-wiki-page.md"),
    );
    // No similar pages exist (empty category) — ONLY the probe can block here.
    expect(verdict.probe_hit).toBe(true);
    expect(verdict.should_pause).toBe(true);
    expect(verdict.pause_reason).toBe("directive_probe");
    expect(verdict.probe_patterns.length).toBeGreaterThan(0);
  });

  it("control: a benign candidate passes (no pause, no probe hit)", () => {
    const benign = path.join(tmpDir, "benign-candidate.md");
    fs.writeFileSync(
      benign,
      "# Caching strategy\n\nThe service uses a two-tier cache: an in-process LRU " +
        "in front of a shared redis cluster. Entries expire after ten minutes.\n",
      "utf8",
    );
    const verdict = runIngestGate(tmpDir, "Caching strategy", benign);
    expect(verdict.probe_hit).toBe(false);
    expect(verdict.should_pause).toBe(false);
    expect(verdict.pause_reason).toBeNull();
  });
});

describe("adversarial fixtures — poisoned skill-edit eval case (directive detector)", () => {
  it("flags the embedded instruction injection in a proposed skill body", () => {
    const body = fs.readFileSync(path.join(FIXTURES, "poisoned-skill-edit.md"), "utf8");
    const r = sanitizeForInjection(body);
    expect(r.result).toBe("flagged");
    expect(r.matchedPatterns.length).toBeGreaterThan(0);
  });

  it("control: a clean skill body is not flagged", () => {
    const clean =
      "---\nname: release-helper\ndescription: Compose release notes.\n---\n\n" +
      "# Release helper\n\nCollect merged PR titles and group them by prefix.\n";
    expect(sanitizeForInjection(clean).result).toBe("clean");
  });
});

describe("adversarial fixtures — poisoned guild.handoff.v2 envelope (classifyEnvelope)", () => {
  it("flags directive language smuggled into summary/notes", () => {
    const envelope = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, "poisoned-handoff-summary.json"), "utf8"),
    ) as Record<string, unknown>;
    // The fixture carries no injection_clean key → the real sanitizer runs.
    expect(envelope["injection_clean"]).toBeUndefined();
    expect(classifyEnvelope(envelope)).toBe("flagged");
  });

  it("control: a clean envelope classifies clean", () => {
    expect(
      classifyEnvelope({
        schema_version: "guild.handoff.v2",
        summary: "Implemented the data layer; all tests green.",
        notes: "Two follow-ups recorded in the receipt.",
      }),
    ).toBe("clean");
  });
});
