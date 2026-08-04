/**
 * hooks/test-support/hermetic-env.ts — test-only env sanitizer (T3b).
 *
 * Hook tests spawn the real hook entries with `{ ...process.env, ...overrides }`.
 * When the TEST RUNNER itself executes inside a Guild lane (a dispatched
 * specialist session exports GUILD_RUN_ID, GUILD_TASK_ID, GUILD_CAPABILITY_SCOPE,
 * GUILD_RUN_BINDING_REF, …), those outer values leak into the spawned hook and
 * silently change scope/binding resolution — a test that is green on a bare
 * operator shell flips red inside a lane (the "CI exposes operator-machine
 * literals" defect class, inverted). Spawning helpers therefore build their
 * base env from hermeticEnv(): process.env with every GUILD_* key removed, so
 * the ONLY Guild identity a spawned hook sees is what the test itself sets.
 */

/** process.env minus every GUILD_* key (PATH etc. preserved for npx/tsx). */
export function hermeticEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GUILD_")) delete env[key];
  }
  return env;
}
