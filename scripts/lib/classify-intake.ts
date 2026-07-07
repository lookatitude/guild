#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible public entrypoint.
 *
 * Intake classification lives in src/modules/intake so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
import { runClassifyIntakeCli } from "../../src/modules/intake/workflows/classify-intake";

export * from "../../src/modules/intake/workflows/classify-intake";

if (require.main === module) runClassifyIntakeCli();
