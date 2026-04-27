import { defineConfig } from "vitest/config";

// qa T3 — coverage gate per `.guild/plan/benchmark-factory.md` lane T3-qa:
// ≥ 80 % lines + branches on `benchmark/src/*.ts`. `types.ts` is pure type
// definitions (no runtime code) and is excluded from the include set.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // v1.1 — opt in to the runner's GUILD_BENCHMARK_LIVE gate at the test
    // layer. Tests still mock `node:child_process.spawn`, so this does not
    // spawn real `claude`; it just satisfies the runner's pre-spawn gate
    // the same way an operator would. Tests that exercise the gate's
    // negative path delete the env var inside their own beforeEach.
    setupFiles: ["./tests/_setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/types.ts",
        // src/cli.ts is the binary entrypoint. It's exercised end-to-end by
        // tests/cli.test.ts + tests/cli.loop.test.ts via tsx + spawnSync,
        // but v8 coverage cannot instrument child processes. The CLI's
        // behavior is locked down behaviorally (argv parsing, exit-code
        // map, dry-run output) — covering it via in-process imports would
        // duplicate the assertions without adding signal.
        "src/cli.ts",
        "tests/**",
        "fixtures/**",
        "node_modules/**",
        "coverage/**",
        "dist/**",
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
