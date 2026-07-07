#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Proposal classification lives in src/modules/initiatives so the reorg can
 * move internals without breaking existing script paths.
 */
import { runClassifyProposalCli } from "../src/modules/initiatives/workflows/classify-proposal";

export * from "../src/modules/initiatives/workflows/classify-proposal";

if (require.main === module) runClassifyProposalCli();
