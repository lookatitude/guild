/**
 * Backward-compatible public entrypoint.
 *
 * The result-contract registry lives in src/modules/distribution so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export {
  findContract,
  type ContractStatus,
  type ValidatorKind,
  type ResultContractEntry,
  EXISTING_CONTRACTS,
  DEFERRED_CONTRACTS,
  RESULT_CONTRACTS,
  PHASE1_NORMALIZER_TARGETS,
  CONTRACT_VALIDATORS,
} from "../../src/domains/distribution/index";
