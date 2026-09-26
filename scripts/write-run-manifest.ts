#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Run manifest writing lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing script paths.
 */

import { runWriteRunManifestCli } from "../src/domains/lifecycle";

export {
  manifestPathFor,
  readRunManifest,
  writeRunManifest,
  initRunManifest,
  upsertWave,
  setProgramStatus,
  runWriteRunManifestCli,
  type WaveStatus,
  type ProgramStatus,
  type Wave,
  type RunManifest,
  type WavePatch,
} from "../src/domains/lifecycle";

if (require.main === module) {
  runWriteRunManifestCli();
}
