// vitest global setup — runs once before any test file.
// v1.1: opts in to live runner execution at the test layer. Tests use
// `vi.mock("node:child_process")` to swap `spawn` for a FakeChild stand-in
// that exits synchronously, so this opt-in does NOT spawn real `claude` —
// it satisfies the runner's GUILD_BENCHMARK_LIVE gate the same way an
// operator would. Tests that explicitly want to exercise the gate's
// negative path delete the env var inside their own `beforeEach`.
process.env.GUILD_BENCHMARK_LIVE = "1";
