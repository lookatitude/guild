#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible public entrypoint.
 *
 * Dashboard projection lives in src/modules/dashboard so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
import { runDashboardProjectorCli } from "../../src/modules/dashboard/workflows/dashboard-projector";

export * from "../../src/modules/dashboard/workflows/dashboard-projector";

if (require.main === module) runDashboardProjectorCli();
