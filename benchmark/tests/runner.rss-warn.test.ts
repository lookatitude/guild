// runner.rss-warn.test.ts
//
// v1.3 — ADR-007: runtime stderr WARN at 80% of operator-declared
// `GUILD_BENCHMARK_MAX_RSS_KB`. This file pins the §Decision §1–§7
// commitments:
//
//   §1  Env var contract (positive int → install; unset/zero/non-positive → no-op)
//   §2  Sampling cadence (1Hz; clears self once warned)
//   §3  Platform normalisation (macOS bytes → KB; Linux/Windows passthrough)
//   §4  WARN line format (fixed `warn: rss approaching declared cap …`)
//   §5  Once per run (warned boolean prevents repeat firing)
//   §6  Parent-process granularity (caveat documented; not testable)
//   §7  Tests — this file.
//
// We exercise the pure helper `installRssWarnSampler(maxKb, opts)` so the
// test does NOT need to mock `process.resourceUsage`, `setInterval`, or
// `process.platform` globally — the helper accepts injected versions of
// each via its options bag. Production callers pass nothing; tests pass
// fakes. This is the same pattern runner.security.test.ts uses for
// `spawn` (vi.mock at module boundary), but lighter-weight because RSS
// sampling has no async + no stream lifecycle.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENV_BENCHMARK_MAX_RSS_KB,
  RSS_WARN_SAMPLE_INTERVAL_MS,
  RSS_WARN_THRESHOLD_RATIO,
  installRssWarnSampler,
  maybeInstallRssWarnFromEnv,
} from "../src/runner.js";

describe("runner / installRssWarnSampler — ADR-007 §Decision §1–§5", () => {
  // Use vitest's fake timers so we can step setInterval ticks deterministically
  // without waiting real seconds.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("§1 — fires a single WARN line on first crossing of 80% threshold", () => {
    const writes: string[] = [];
    // Step a climbing maxRSS through 60% → 70% → 79% → 80% → 90%.
    // Cap is 1000 KB; threshold = 800 KB. Threshold should fire on tick 4.
    const sequence = [600, 700, 790, 800, 900];
    let i = 0;
    const stop = installRssWarnSampler(1000, {
      sampleMaxRss: () => sequence[i++] ?? sequence[sequence.length - 1]!,
      platform: "linux",
      writeWarn: (line) => writes.push(line),
    });
    // Tick 1: 600 (60%) — below; no warn.
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS);
    expect(writes).toHaveLength(0);
    // Tick 2: 700 (70%) — below; no warn.
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS);
    expect(writes).toHaveLength(0);
    // Tick 3: 790 (79%) — below; no warn.
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS);
    expect(writes).toHaveLength(0);
    // Tick 4: 800 (80%) — fires.
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain(
      "warn: rss approaching declared cap — observed 800 KB >= 80% of GUILD_BENCHMARK_MAX_RSS_KB=1000",
    );
    // Tick 5: 900 (90%) — already warned; §5 says no re-emit.
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS);
    expect(writes).toHaveLength(1);
    stop();
  });

  it("§5 — once warned, the interval clears itself (no further sampling)", () => {
    const writes: string[] = [];
    const sampler = vi.fn(() => 1000); // always over threshold
    const stop = installRssWarnSampler(500, {
      sampleMaxRss: sampler,
      platform: "linux",
      writeWarn: (line) => writes.push(line),
    });
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS);
    expect(writes).toHaveLength(1);
    const callsAfterFirstFire = sampler.mock.calls.length;
    // Advance several more ticks; sampler must not be called again
    // because the interval cleared itself in §5.
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS * 5);
    expect(sampler.mock.calls.length).toBe(callsAfterFirstFire);
    expect(writes).toHaveLength(1);
    stop();
  });

  it("§3 — macOS branch divides bytes by 1024 (1MiB ≈ 1024 KB)", () => {
    const writes: string[] = [];
    // Cap is 1000 KB; threshold = 800 KB.
    // macOS reports bytes; pass 819,200 bytes = 800 KB exactly.
    const stop = installRssWarnSampler(1000, {
      sampleMaxRss: () => 819_200,
      platform: "darwin",
      writeWarn: (line) => writes.push(line),
    });
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("observed 800 KB");
    stop();
  });

  it("§3 — linux branch passes maxRSS through unchanged (already KB)", () => {
    const writes: string[] = [];
    // Cap is 1000 KB; threshold = 800 KB. Pass 800 KB raw.
    const stop = installRssWarnSampler(1000, {
      sampleMaxRss: () => 800,
      platform: "linux",
      writeWarn: (line) => writes.push(line),
    });
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("observed 800 KB");
    stop();
  });

  it("§3 — win32 branch passes maxRSS through unchanged (already KB)", () => {
    const writes: string[] = [];
    const stop = installRssWarnSampler(1000, {
      sampleMaxRss: () => 800,
      platform: "win32",
      writeWarn: (line) => writes.push(line),
    });
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("observed 800 KB");
    stop();
  });

  it("§3 — macOS bytes BELOW threshold do not fire (819,199 bytes ≈ 799 KB)", () => {
    const writes: string[] = [];
    // 819,199 bytes / 1024 = 799.99... → Math.floor = 799 → < 800 threshold.
    const stop = installRssWarnSampler(1000, {
      sampleMaxRss: () => 819_199,
      platform: "darwin",
      writeWarn: (line) => writes.push(line),
    });
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS);
    expect(writes).toHaveLength(0);
    stop();
  });

  it("§1 — non-positive cap returns a no-op stop fn (no interval registered)", () => {
    const writes: string[] = [];
    // Cap of 0 — no sampler installed.
    const stop = installRssWarnSampler(0, {
      sampleMaxRss: () => 999_999,
      platform: "linux",
      writeWarn: (line) => writes.push(line),
    });
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS * 10);
    expect(writes).toHaveLength(0);
    stop(); // no throw
  });

  it("stop() clears the interval before warning fires", () => {
    const writes: string[] = [];
    const stop = installRssWarnSampler(1000, {
      sampleMaxRss: () => 800,
      platform: "linux",
      writeWarn: (line) => writes.push(line),
    });
    // Stop immediately; no tick has fired yet.
    stop();
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS * 10);
    expect(writes).toHaveLength(0);
  });

  it("§4 — WARN line format is fixed: prefix, observed kb, env var name, cap", () => {
    const writes: string[] = [];
    const stop = installRssWarnSampler(2_000, {
      sampleMaxRss: () => 1_700, // 85% of 2000 → over 80%
      platform: "linux",
      writeWarn: (line) => writes.push(line),
    });
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS);
    stop();
    expect(writes).toHaveLength(1);
    // Pin the exact shape — operators / ops dashboards may regex-match this.
    expect(writes[0]).toBe(
      `warn: rss approaching declared cap — observed 1700 KB >= 80% of ${ENV_BENCHMARK_MAX_RSS_KB}=2000\n`,
    );
  });

  it("threshold ratio is 0.80 (constant exported for caller verification)", () => {
    expect(RSS_WARN_THRESHOLD_RATIO).toBe(0.8);
  });
});

describe("runner / maybeInstallRssWarnFromEnv — ADR-007 §1 env var contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns no-op when GUILD_BENCHMARK_MAX_RSS_KB is unset (zero overhead — D4)", () => {
    vi.stubEnv(ENV_BENCHMARK_MAX_RSS_KB, "");
    const writes: string[] = [];
    const stop = maybeInstallRssWarnFromEnv({
      sampleMaxRss: () => 999_999,
      platform: "linux",
      writeWarn: (line) => writes.push(line),
    });
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS * 5);
    expect(writes).toHaveLength(0);
    stop();
  });

  it("returns no-op when env var is non-numeric (treated as unset)", () => {
    vi.stubEnv(ENV_BENCHMARK_MAX_RSS_KB, "not-a-number");
    const writes: string[] = [];
    const stop = maybeInstallRssWarnFromEnv({
      sampleMaxRss: () => 999_999,
      platform: "linux",
      writeWarn: (line) => writes.push(line),
    });
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS * 5);
    expect(writes).toHaveLength(0);
    stop();
  });

  it("returns no-op when env var is zero or negative (treated as unset)", () => {
    vi.stubEnv(ENV_BENCHMARK_MAX_RSS_KB, "0");
    const writes: string[] = [];
    const stop = maybeInstallRssWarnFromEnv({
      sampleMaxRss: () => 999_999,
      platform: "linux",
      writeWarn: (line) => writes.push(line),
    });
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS * 5);
    expect(writes).toHaveLength(0);
    stop();
  });

  it("installs sampler when env var is a positive integer (and crosses threshold)", () => {
    vi.stubEnv(ENV_BENCHMARK_MAX_RSS_KB, "1000");
    const writes: string[] = [];
    const stop = maybeInstallRssWarnFromEnv({
      sampleMaxRss: () => 850, // 85% of 1000
      platform: "linux",
      writeWarn: (line) => writes.push(line),
    });
    vi.advanceTimersByTime(RSS_WARN_SAMPLE_INTERVAL_MS);
    stop();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("observed 850 KB");
    expect(writes[0]).toContain("GUILD_BENCHMARK_MAX_RSS_KB=1000");
  });
});
