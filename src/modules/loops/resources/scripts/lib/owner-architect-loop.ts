#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible public entrypoint.
 *
 * Owner/architect loop control lives in src/modules/loops so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
import { runOwnerArchitectLoopCli } from "../../src/modules/loops/workflows/owner-architect-loop";

export * from "../../src/modules/loops/workflows/owner-architect-loop";

if (require.main === module) runOwnerArchitectLoopCli();
