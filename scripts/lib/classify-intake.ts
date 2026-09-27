#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible public entrypoint.
 *
 * Intake classification lives in src/modules/intake so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
import { runClassifyIntakeCli } from "../../src/domains/lifecycle/classify-intake";

export * from "../../src/domains/lifecycle/classify-intake";

// The domain module carries the compiled-bundle CLI gate. This one fires only
// for a direct TypeScript run, so a bundle never runs the CLI twice.
if (require.main === module && /\.[cm]?ts$/.test(process.argv[1] ?? "")) runClassifyIntakeCli();
