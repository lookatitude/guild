/**
 * Lazy evidence chunk for `scripts/capability-profile.ts`.
 *
 * The `baseline` and `emit` subcommands need the migration-evidence chain;
 * `--help` and `hash-tree` — the cheap `status` path KTD29 budgets — do not.
 * esbuild inlines a dynamic `import()` into the same CJS bundle, so the ONLY
 * way to keep `documents`/`telemetry`/`lifecycle`/`dispatch` out of
 * `runtime/scripts/capability-profile.js` is a separate compiled chunk that the
 * entrypoint resolves by a run-time path. This file is that chunk's entry: a
 * pure re-export, so behaviour is byte-identical for every caller that reaches
 * the evidence chain.
 *
 * Trap: this is NOT a CLI. It is registered in `RUNTIME_SCRIPT_IDS` only so
 * `compile.ts` emits `runtime/scripts/capability-profile-evidence.js` next to
 * its loader; `node` on it does nothing.
 */
export {
  captureMigrationRunBaseline,
  profileBaselineFromMigrationRunBaseline,
  validateMigrationRunBaseline,
} from "./migration-evidence";
