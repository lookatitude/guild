#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Proposal classification lives in src/modules/initiatives so the reorg can
 * move internals without breaking existing script paths.
 */
import { runClassifyProposalCli } from "../src/domains/lifecycle";

export {
  classifyProposal,
  runClassifyProposalCli,
  type ClassifierTarget,
  type ClassifyProposalInput,
  type ClassifyProposalResult,
} from "../src/domains/lifecycle";

if (require.main === module) runClassifyProposalCli();
