import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareSets } from "../src/compare.js";
import { seedRun } from "./server.helpers.js";

// Pin for backend's P1 follow-up #2 — the warning regex for runs that have
// `run.json` but no `score.json`. T2 backend recommended:
//   /^compare: skipping .+ — no score\.json$/m
const STDERR_PIN = /^compare: skipping .+ — no score\.json$/m;

describe("compare / stderr warning regex pin", () => {
  let runsDir: string;
  let originalWrite: typeof process.stderr.write;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "qa-stderr-"));
    originalWrite = process.stderr.write.bind(process.stderr);
  });

  afterEach(async () => {
    process.stderr.write = originalWrite;
    await rm(runsDir, { recursive: true, force: true });
  });

  it("matches the warning emitted when a run is missing score.json", async () => {
    // Capture stderr writes for the duration of the call.
    const captured: string[] = [];
    // @ts-expect-error — override for capture; restore in afterEach.
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    };

    await seedRun(runsDir, "set-a-1", { withScore: false });
    await seedRun(runsDir, "set-b-1");

    await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
      write: false,
    });

    const text = captured.join("");
    expect(text).toMatch(STDERR_PIN);
    // Anchor confirmation: the line really starts at column 0 of its line.
    const lines = text.split("\n").filter(Boolean);
    expect(lines.some((l) => /^compare: skipping set-a-1 — no score\.json$/.test(l))).toBe(
      true,
    );
  });
});
