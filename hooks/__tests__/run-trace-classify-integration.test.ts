/**
 * run-trace-classify-integration.test.ts — the no-loss CRUX.
 *
 * Proves the DETERMINISTIC path classifies: recordPhase() → emitPhaseCheckpoint() →
 * buildPhaseArtifacts() (reads the run's handoffs + provenance) → classifyPhase() →
 * a checkpoint carrying a REAL non-none verdict, with NO model / CLI involvement.
 * Without this wire the loop is covered (a checkpoint exists) but empty (all-none) —
 * so the POSITIVE assertion (a signal classifies) is the one that matters, plus a
 * NEGATIVE control (no signal → all-none) so the test is non-vacuous.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { startRunOnly, recordPhase } from "../lib/run-trace";

// host-neutral resolveHost stub (mirrors run-trace.test.ts)
const resolveHost = (requested: string) => ({
  requested,
  resolved: (requested === "auto" ? "claude" : requested) as never,
});

function readCheckpoint(root: string, runId: string, phase: string): string {
  return fs.readFileSync(
    path.join(root, ".guild", "runs", runId, "learning", `${phase}-${runId}.yaml`),
    "utf8",
  );
}

describe("run-trace deterministic classify integration (no-loss crux)", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rtci-"));
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("POSITIVE: a phase whose provenance touched a decision classifies memory != none", () => {
    const runId = startRunOnly(root, resolveHost, { command: "/guild:build" }) as string;
    expect(runId).not.toBeNull();
    // seed a real signal: provenance.touched.decisions (drives classifyMemory → candidate)
    fs.writeFileSync(
      path.join(root, ".guild", "runs", runId, "provenance.json"),
      JSON.stringify({ touched: { decisions: ["decision:adr-001-auth"] } }),
    );

    recordPhase(root, "build", { runId });
    const yaml = readCheckpoint(root, runId, "development");
    expect(yaml).toMatch(/memory:\s*candidate:/); // a REAL verdict, not all-none
    expect(yaml).not.toMatch(/backstop:\s*true/);  // a real emit, not a backstop fallback
  });

  it("NEGATIVE control: a phase with no signal classifies all-none (non-vacuous)", () => {
    const runId = startRunOnly(root, resolveHost, { command: "/guild:build" }) as string;
    recordPhase(root, "build", { runId }); // no provenance signal, no handoffs → all none
    const yaml = readCheckpoint(root, runId, "development");
    expect(yaml).toMatch(/memory:\s*none/); // proves the POSITIVE isn't trivially always-classifying
  });
});
