/**
 * hooks/test-support/jest-env-setup.ts — jest setupFiles hook (T3b).
 *
 * Strips every GUILD_* key from the test runner's own process.env before any
 * suite loads. When the runner executes inside a Guild lane (a dispatched
 * specialist session exports GUILD_RUN_ID, GUILD_TASK_ID, GUILD_CAPABILITY_SCOPE,
 * GUILD_RUN_BINDING_REF, …), those values otherwise leak into
 *   - in-process lib calls that default to process.env (settings resolver,
 *     run-id resolution), and
 *   - spawned hook subprocesses built from `{ ...process.env, ... }`,
 * silently rebinding fixture writes to the OUTER lane's run. Tests that need a
 * Guild identity set it explicitly per-call; none may inherit the runner's.
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GUILD_")) delete process.env[key];
}
