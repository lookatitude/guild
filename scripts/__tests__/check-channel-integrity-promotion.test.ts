/**
 * scripts/__tests__/check-channel-integrity-promotion.test.ts
 *
 * STABLE-PROMOTION GATE — FIC-91 / REL-P0, reconciled to A21-X (FIC-156).
 * Guards the `promotion` mode of `scripts/check-channel-integrity.ts`: the
 * hash-bound release-branch invariant that `branch-policy.yml` enforces on
 * every PR into `main`.
 *
 * WHAT THE GATE REQUIRES, end to end: a well-shaped `release/vX.Y.Z` branch, a
 * `guild.release_promotion.v1` record, the EXACT bytes of its referenced
 * `guild.release_conformance.v1` record (SHA-256-bound), the frozen 31-scenario
 * contract pin, a COMPLETE 31/31 coverage statement (A21-X: the historical
 * honest 5/31 shape no longer promotes), a single source-commit binding across
 * all four records, ancestry of that source commit, an EXACT allowed diff —
 * and LAST, the substance: a re-run of the FULL integration/assembly decision
 * (`evaluateTransportedReleaseConformance`) over the transported evidence and
 * authority. The gate never trusts a claimed verdict or a claimed count.
 *
 * TESTING HONESTY. The emitter itself now refuses every in-repo package (the
 * 5/31 fixture is incomplete; a fabricated 31/31 fails the production
 * decision; the repository can mint no attestor authority), so the records
 * these tests transport are HAND-AUTHORED claimed-31/31 pairs in the exact
 * emitted shape. That is the point: every structural, hash, binding, ancestry,
 * and diff gate must pass over such a record — and the FINAL decision re-run
 * must still refuse it on substance (`conformance_decision_not_promotable`),
 * which is simultaneously the proof that `promotable` is unreachable by
 * fabrication and that every earlier gate genuinely ran. REAL-git tests (temp
 * repos, real `git` subprocesses) exercise the CLI and every record-level gate
 * and terminate at `source_commit_unknown` — the honest verdict for a checkout
 * that does not contain the evidence commit.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import * as yaml from "js-yaml";

import {
  checkStablePromotion,
  main as cliMain,
  promotionAllowedPaths,
  realPromotionGitOps,
  FROZEN_SCENARIO_CONTRACT_SHA256,
  FROZEN_SCENARIO_CONTRACT_COUNT,
  FROZEN_SCENARIO_CONTRACT_IDS,
  RELEASE_CONFORMANCE_SCHEMA,
  RELEASE_PROMOTION_SCHEMA,
  MANIFEST_PATH,
  type PromotionGitOps,
} from "../check-channel-integrity";

const FIXTURES = path.join(__dirname, "fixtures", "release-conformance");
const SUITE = path.join(FIXTURES, "conformance-scenarios.v1.json");
const PACKAGE = path.join(FIXTURES, "evaluator-package.json");
const BETA_PACKAGE = path.join(FIXTURES, "evaluator-package-beta.json");
const SOURCE_COMMIT = "b871c8d973bd8258c25ce5e87a89f68f2e63a516";
const HEAD_SHA = "1234567890abcdef1234567890abcdef12345678";
const VERSION = "2.2.0";
const MARKETPLACE_PATH = ".claude-plugin/marketplace.json";
const GENERATED_AT = "2026-08-18T06:30:00.000Z";

function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

interface FixtureResult {
  stable_id: string;
  outcome_type: string;
  disposition: string;
  reason_code: string | null;
  receipt_ref: string;
  evidence_identity: Record<string, unknown>;
  evidence_freshness: string;
}

/**
 * The five signed results extended to a structurally complete full-suite
 * evidence over the same identity — the fabrication the final decision re-run
 * exists to refuse.
 */
function fabricated31Evidence(pkg: {
  evidence: Record<string, unknown>;
}): Record<string, unknown> {
  const identity = pkg.evidence.activated_runtime as Record<string, unknown>;
  const realResults = pkg.evidence.results as FixtureResult[];
  const realById = new Map(realResults.map((result) => [result.stable_id, result] as const));
  const results = FROZEN_SCENARIO_CONTRACT_IDS.map((stableId, index) => {
    const real = realById.get(stableId);
    if (real !== undefined) return JSON.parse(JSON.stringify(real)) as FixtureResult;
    const sequence = index + 1;
    let hex = sequence.toString(16);
    while (hex.length < 16) hex = `0${hex}`;
    return {
      stable_id: stableId,
      outcome_type: "guild.lifecycle_outcome.v1",
      disposition: "succeeded",
      reason_code: null,
      receipt_ref: `guild.receipt_ref.v1:jrn-gate-fabricated#${sequence}@nec1:${hex}`,
      evidence_identity: JSON.parse(JSON.stringify(identity)) as Record<string, unknown>,
      evidence_freshness: "fresh",
    };
  });
  return {
    suite_id: pkg.evidence.suite_id,
    suite_version: pkg.evidence.suite_version,
    required_scenario_ids: [...FROZEN_SCENARIO_CONTRACT_IDS],
    activated_runtime: identity,
    results,
    claimant_id: pkg.evidence.claimant_id,
  };
}

/**
 * A claimed-31/31 record pair in the exact emitted shape: full frozen-contract
 * naming, complete coverage statement, transported evidence + authority, a
 * self-declared promotable decision block, and a promotion record hash-bound
 * to the conformance bytes. Everything BEFORE the decision re-run must accept
 * it; the decision re-run must refuse it.
 */
function buildRecordPair(
  packagePath: string,
  version: string
): { conformance: Buffer; promotion: Buffer } {
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const suite = JSON.parse(fs.readFileSync(SUITE, "utf8"));
  const evidence = fabricated31Evidence(pkg);
  const record = {
    schema_version: RELEASE_CONFORMANCE_SCHEMA,
    generated_at: GENERATED_AT,
    source_commit: SOURCE_COMMIT,
    scenario_contract_sha256: FROZEN_SCENARIO_CONTRACT_SHA256,
    scenario_contract: {
      schema_version: suite.schema_version,
      contract_id: suite.contract_id,
      contract_version: suite.contract_version,
      sha256: FROZEN_SCENARIO_CONTRACT_SHA256,
      scenario_count: FROZEN_SCENARIO_CONTRACT_COUNT,
      scenario_ids: [...FROZEN_SCENARIO_CONTRACT_IDS],
    },
    scenario_coverage: {
      evaluator: "claimed full-suite integration (hand-authored gate fixture)",
      evaluated_scenario_ids: [...FROZEN_SCENARIO_CONTRACT_IDS],
      evaluated_scenario_count: FROZEN_SCENARIO_CONTRACT_COUNT,
      unevaluated_scenario_count: 0,
      statement: "All 31 scenarios claimed executed and assembled.",
    },
    activated_runtime: evidence.activated_runtime,
    evidence,
    authority: pkg.authority,
    decision: {
      type: "guild.support_transition_outcome.v1",
      disposition: "succeeded",
      reason_code: null,
      may_promote_conformant: true,
      assertions: [],
    },
  };
  const conformance = Buffer.from(JSON.stringify(record, null, 2) + "\n");
  const promotion = {
    schema_version: RELEASE_PROMOTION_SCHEMA,
    version,
    source_commit: SOURCE_COMMIT,
    evidence_sha256: sha256(conformance),
    decision: "conformance_pass",
  };
  return { conformance, promotion: Buffer.from(JSON.stringify(promotion, null, 2) + "\n") };
}

let CONFORMANCE_BYTES: Buffer;
let PROMOTION_BYTES: Buffer;
let BETA_CONFORMANCE_BYTES: Buffer;
let BETA_PROMOTION_BYTES: Buffer;

beforeAll(() => {
  const standard = buildRecordPair(PACKAGE, VERSION);
  CONFORMANCE_BYTES = standard.conformance;
  PROMOTION_BYTES = standard.promotion;
  // Bundle B: the SAME journal signed for runtime guild-2.3.0-beta.1 — the
  // FIC-74 shape, where evidence is produced at a beta-versioned SHA-T on
  // `next` and only release metadata changes afterwards.
  const beta = buildRecordPair(BETA_PACKAGE, "2.3.0");
  BETA_CONFORMANCE_BYTES = beta.conformance;
  BETA_PROMOTION_BYTES = beta.promotion;
});

interface FakeRepo {
  refs: Record<string, string>;
  files: Map<string, Buffer>; // `${sha}:${path}` -> bytes
  ancestries: Set<string>; // `${ancestor}..${descendant}`
  diffs: Map<string, string[]>; // `${from}..${to}` -> changed paths
}

function fakeGit(repo: FakeRepo): PromotionGitOps {
  return {
    resolveCommit: (ref) => repo.refs[ref] ?? null,
    showBytes: (ref, filePath) => repo.files.get(`${ref}:${filePath}`) ?? null,
    isAncestor: (ancestor, descendant) => repo.ancestries.has(`${ancestor}..${descendant}`),
    changedPaths: (from, to) => repo.diffs.get(`${from}..${to}`) ?? [],
  };
}

/** A fully bound in-memory release checkout for `release/v2.2.0`. */
function standardRepo(overrides: {
  version?: string;
  conformance?: Buffer;
  promotion?: Buffer;
  manifestVersion?: string;
  marketplaceVersion?: string;
  /** plugin.json version AT THE EVIDENCE SOURCE COMMIT (SHA-T). */
  sourceManifestVersion?: string;
} = {}): FakeRepo {
  const version = overrides.version ?? VERSION;
  const conformance = overrides.conformance ?? CONFORMANCE_BYTES;
  const promotion = overrides.promotion ?? PROMOTION_BYTES;
  const dir = `.guild/artifacts/release/v${version}`;
  const files = new Map<string, Buffer>();
  const put = (p: string, bytes: Buffer | string) =>
    files.set(`${HEAD_SHA}:${p}`, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  put(MANIFEST_PATH, JSON.stringify({ name: "guild", version: overrides.manifestVersion ?? version }));
  put(
    MARKETPLACE_PATH,
    JSON.stringify({
      name: "guild",
      plugins: [{ name: "guild", source: "./", version: overrides.marketplaceVersion ?? version }],
    })
  );
  put(`${dir}/promotion.json`, promotion);
  put(`${dir}/conformance.json`, conformance);
  files.set(
    `${SOURCE_COMMIT}:${MANIFEST_PATH}`,
    Buffer.from(JSON.stringify({ name: "guild", version: overrides.sourceManifestVersion ?? VERSION }))
  );
  return {
    refs: { HEAD: HEAD_SHA, [HEAD_SHA]: HEAD_SHA, [SOURCE_COMMIT]: SOURCE_COMMIT },
    files,
    ancestries: new Set([`${SOURCE_COMMIT}..${HEAD_SHA}`]),
    diffs: new Map([[`${SOURCE_COMMIT}..${HEAD_SHA}`, promotionAllowedPaths(version)]]),
  };
}

function check(repo: FakeRepo, releaseBranch = `release/v${VERSION}`, headRef = "HEAD") {
  return checkStablePromotion({ releaseBranch, headRef }, fakeGit(repo));
}

/** Mutate the conformance record and RE-BIND the promotion hash to the mutated
 *  bytes, so the tampering reaches the gate BEHIND the hash binding. */
function tamperedPair(
  mutate: (record: any) => void,
  base: { conformance: Buffer; promotion: Buffer } = { conformance: CONFORMANCE_BYTES, promotion: PROMOTION_BYTES }
): { conformance: Buffer; promotion: Buffer } {
  const record = JSON.parse(base.conformance.toString("utf8"));
  mutate(record);
  const conformance = Buffer.from(JSON.stringify(record, null, 2) + "\n");
  const promotion = JSON.parse(base.promotion.toString("utf8"));
  promotion.evidence_sha256 = sha256(conformance);
  return { conformance, promotion: Buffer.from(JSON.stringify(promotion, null, 2) + "\n") };
}

function tamperedPromotion(mutate: (record: any) => void): Buffer {
  const record = JSON.parse(PROMOTION_BYTES.toString("utf8"));
  mutate(record);
  return Buffer.from(JSON.stringify(record, null, 2) + "\n");
}

describe("promotion allowed-diff set", () => {
  it("admits EXACTLY the six release paths and nothing broader", () => {
    expect(promotionAllowedPaths("2.2.0").sort()).toEqual(
      [
        ".guild/artifacts/release/v2.2.0/promotion.json",
        ".guild/artifacts/release/v2.2.0/conformance.json",
        ".claude-plugin/plugin.json",
        ".claude-plugin/marketplace.json",
        "guild.inventory.json",
        "CHANGELOG.md",
      ].sort()
    );
  });

  it("pins the frozen 31-ID canonical tuple to the hash-verified contract bytes", () => {
    // The constant is what the gate compares against; this proves it IS the
    // frozen contract's scenario set, in canonical file order, no duplicates.
    const suite = JSON.parse(fs.readFileSync(SUITE, "utf8"));
    const fromContract = suite.scenarios.map((s: any) => s.stable_id);
    expect(sha256(fs.readFileSync(SUITE))).toBe(FROZEN_SCENARIO_CONTRACT_SHA256);
    expect(FROZEN_SCENARIO_CONTRACT_IDS).toEqual(fromContract);
    expect(FROZEN_SCENARIO_CONTRACT_IDS).toHaveLength(31);
    expect(new Set(FROZEN_SCENARIO_CONTRACT_IDS).size).toBe(31);
  });

  it("admits marketplace.json only alongside the generated-consistency check", () => {
    // marketplace.json is in the allowed set ONLY because its bytes are
    // generated from plugin.json. Two enforcement layers must both hold: the
    // in-gate version-consistency check (tested below as
    // marketplace_version_drift) and the byte-level `check:claude-install`
    // invariant, which the REQUIRED promotion-evidence job itself must
    // execute (asserted in the CI-wiring block) and which stays chained in
    // check:module-source-of-truth.
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    expect(pkg.scripts["check:module-source-of-truth"]).toContain("check:claude-install");
  });
});

describe("checkStablePromotion — every structural gate passes, the FINAL decision re-run refuses (A21-X)", () => {
  it("a fully bound claimed-31/31 checkout reaches ONLY the decision re-run, which refuses on substance", () => {
    // Every gate before the decision — branch, manifests, promotion record,
    // hash binding, frozen contract, complete coverage, split view, source
    // binding, ancestry, diff — accepts this checkout; the verdict is the
    // decision's own, never a count-shape complaint.
    const result = check(standardRepo());
    expect(result.ok).toBe(false);
    expect(result.code).toBe("conformance_decision_not_promotable");
    expect(result.reason).toMatch(/stage=decision/);
    // The refused reason is the production decision's own (the core's
    // required-set gate still pins the recognized 5-tuple — the documented
    // A21-X seam that keeps fabricated full-suite bundles unpromotable).
    expect(result.reason).toMatch(/scenario_required_set_mismatch/);
  });

  it("still reaches the decision when the diff is a SUBSET of the allowed set", () => {
    const repo = standardRepo();
    repo.diffs.set(`${SOURCE_COMMIT}..${HEAD_SHA}`, [
      `.guild/artifacts/release/v${VERSION}/promotion.json`,
      `.guild/artifacts/release/v${VERSION}/conformance.json`,
    ]);
    expect(check(repo).code).toBe("conformance_decision_not_promotable");
  });

  it("the FIC-74 shape stays structurally admissible: beta-versioned evidence at SHA-T reaches the decision", () => {
    // REL-P1 emits evidence at the `next` tip, whose plugin.json carries the
    // beta shape (here 2.3.0-beta.1); the release branch then bumps ONLY
    // metadata to the bare triple. Every binding gate must accept exactly
    // this; the decision re-run is then the only refusal left.
    const version = "2.3.0";
    const repo = standardRepo({
      version,
      conformance: BETA_CONFORMANCE_BYTES,
      promotion: BETA_PROMOTION_BYTES,
      sourceManifestVersion: "2.3.0-beta.1",
    });
    const result = check(repo, `release/v${version}`);
    expect(result.reason).not.toMatch(/runtime/);
    expect(result.code).toBe("conformance_decision_not_promotable");
  });

  it("a claimed-31/31 record transporting the honest 5-result evidence refuses on decision substance, not on its claimed count", () => {
    const pair = tamperedPair((r) => {
      const pkg = JSON.parse(fs.readFileSync(PACKAGE, "utf8"));
      r.evidence = pkg.evidence;
      r.activated_runtime = pkg.evidence.activated_runtime;
    });
    const result = check(standardRepo(pair));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("conformance_decision_not_promotable");
    expect(result.reason).toMatch(/stage=coverage/);
  });
});

describe("checkStablePromotion — branch and manifest gates", () => {
  it("refuses a malformed release branch name", () => {
    const result = check(standardRepo(), "release/2.2.0");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("release_branch_malformed");
  });

  it("refuses a prerelease release branch (stable promotion needs a bare triple)", () => {
    const result = check(standardRepo(), "release/v2.2.0-beta.1");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("release_version_not_bare");
  });

  it("refuses an unresolvable head", () => {
    const repo = standardRepo();
    delete repo.refs.HEAD;
    const result = check(repo);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("head_unresolvable");
  });

  it("refuses a missing manifest at head", () => {
    const repo = standardRepo();
    repo.files.delete(`${HEAD_SHA}:${MANIFEST_PATH}`);
    expect(check(repo).code).toBe("manifest_missing");
  });

  it("refuses a manifest version that disagrees with the branch version", () => {
    const result = check(standardRepo({ manifestVersion: "2.3.0" }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("manifest_version_mismatch");
  });

  it("refuses generated-marketplace drift from the canonical version field", () => {
    const result = check(standardRepo({ marketplaceVersion: "2.1.0" }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("marketplace_version_drift");
  });
});

describe("checkStablePromotion — promotion record gates", () => {
  it("refuses a missing promotion record", () => {
    const repo = standardRepo();
    repo.files.delete(`${HEAD_SHA}:.guild/artifacts/release/v${VERSION}/promotion.json`);
    expect(check(repo).code).toBe("promotion_record_missing");
  });

  it("refuses an unparseable promotion record", () => {
    const repo = standardRepo({ promotion: Buffer.from("{nope") });
    expect(check(repo).code).toBe("promotion_record_malformed");
  });

  it("refuses an unrecognized promotion schema", () => {
    const promotion = tamperedPromotion((r) => (r.schema_version = "guild.release_promotion.v2"));
    expect(check(standardRepo({ promotion })).code).toBe("promotion_schema_unrecognized");
  });

  it("refuses a promotion version that disagrees with the branch", () => {
    const promotion = tamperedPromotion((r) => (r.version = "2.3.0"));
    expect(check(standardRepo({ promotion })).code).toBe("promotion_version_mismatch");
  });

  it("refuses a malformed promotion source commit", () => {
    const promotion = tamperedPromotion((r) => (r.source_commit = "HEAD"));
    expect(check(standardRepo({ promotion })).code).toBe("promotion_source_commit_malformed");
  });

  it("refuses a malformed evidence hash", () => {
    const promotion = tamperedPromotion((r) => (r.evidence_sha256 = "deadbeef"));
    expect(check(standardRepo({ promotion })).code).toBe("promotion_evidence_hash_malformed");
  });

  it("refuses an accepted-override decision — no override path exists in this gate", () => {
    const promotion = tamperedPromotion((r) => (r.decision = "accepted_override"));
    const result = check(standardRepo({ promotion }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("promotion_override_unsupported");
    expect(result.reason).toMatch(/conformance_pass/);
  });

  it("refuses any other unrecognized decision", () => {
    const promotion = tamperedPromotion((r) => (r.decision = "trust_me"));
    expect(check(standardRepo({ promotion })).code).toBe("promotion_decision_unrecognized");
  });
});

describe("checkStablePromotion — conformance record gates", () => {
  it("refuses a missing conformance record", () => {
    const repo = standardRepo();
    repo.files.delete(`${HEAD_SHA}:.guild/artifacts/release/v${VERSION}/conformance.json`);
    expect(check(repo).code).toBe("conformance_record_missing");
  });

  it("refuses when the conformance bytes do not hash to the promotion's evidence_sha256", () => {
    const conformance = Buffer.concat([CONFORMANCE_BYTES, Buffer.from(" ")]);
    const result = check(standardRepo({ conformance }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("evidence_hash_mismatch");
  });

  it("refuses an unrecognized conformance schema (behind a re-bound hash)", () => {
    const pair = tamperedPair((r) => (r.schema_version = "guild.release_conformance.v2"));
    expect(check(standardRepo(pair)).code).toBe("conformance_schema_unrecognized");
  });

  it("refuses a scenario-contract hash that is not the frozen 31-scenario pin", () => {
    const pair = tamperedPair((r) => {
      r.scenario_contract_sha256 = "ab".repeat(32);
      r.scenario_contract.sha256 = "ab".repeat(32);
    });
    const result = check(standardRepo(pair));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("scenario_contract_hash_mismatch");
    expect(result.reason).toContain(FROZEN_SCENARIO_CONTRACT_SHA256);
  });

  it("A21-X: refuses the historical honest 5/31 coverage shape — incomplete coverage no longer promotes", () => {
    const pair = tamperedPair((r) => {
      r.scenario_coverage.evaluated_scenario_ids = r.scenario_coverage.evaluated_scenario_ids.slice(0, 5);
      r.scenario_coverage.evaluated_scenario_count = 5;
      r.scenario_coverage.unevaluated_scenario_count = 26;
    });
    const result = check(standardRepo(pair));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("scenario_coverage_incomplete");
  });

  it("refuses a narrowed evaluated-scenario tuple even at a near-full count", () => {
    const pair = tamperedPair((r) => {
      r.scenario_coverage.evaluated_scenario_ids = r.scenario_coverage.evaluated_scenario_ids.slice(0, 30);
      r.scenario_coverage.evaluated_scenario_count = 30;
      r.scenario_coverage.unevaluated_scenario_count = 1;
    });
    expect(check(standardRepo(pair)).code).toBe("scenario_coverage_incomplete");
  });

  it("refuses a coverage block whose counts contradict its own full id tuple", () => {
    const pair = tamperedPair((r) => {
      r.scenario_coverage.evaluated_scenario_count = 30;
    });
    expect(check(standardRepo(pair)).code).toBe("scenario_coverage_incomplete");
  });

  it("refuses a contract naming that OMITS a frozen scenario id", () => {
    const pair = tamperedPair((r) => r.scenario_contract.scenario_ids.splice(7, 1));
    expect(check(standardRepo(pair)).code).toBe("scenario_contract_ids_mismatch");
  });

  it("refuses a contract naming that SUBSTITUTES a frozen scenario id", () => {
    const pair = tamperedPair((r) => (r.scenario_contract.scenario_ids[10] = "MHRC-FAKE-001"));
    expect(check(standardRepo(pair)).code).toBe("scenario_contract_ids_mismatch");
  });

  it("refuses a REORDERED contract naming (canonical order is part of the contract)", () => {
    const pair = tamperedPair((r) => {
      const ids = r.scenario_contract.scenario_ids;
      [ids[0], ids[1]] = [ids[1], ids[0]];
    });
    expect(check(standardRepo(pair)).code).toBe("scenario_contract_ids_mismatch");
  });

  it("refuses a DUPLICATED contract id even at the correct count", () => {
    const pair = tamperedPair((r) => (r.scenario_contract.scenario_ids[3] = r.scenario_contract.scenario_ids[2]));
    expect(check(standardRepo(pair)).code).toBe("scenario_contract_ids_mismatch");
  });

  it("refuses a record that names no scenario_ids at all (count/hash alone are not the set)", () => {
    const pair = tamperedPair((r) => delete r.scenario_contract.scenario_ids);
    expect(check(standardRepo(pair)).code).toBe("scenario_contract_ids_mismatch");
  });

  it("SPLIT VIEW: refuses a top-level activated_runtime summary that diverges from the evaluator input", () => {
    const pair = tamperedPair((r) => {
      r.activated_runtime = { ...r.activated_runtime, runtime_version: "guild-2.9.9" };
    });
    const result = check(standardRepo(pair));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("activated_runtime_summary_mismatch");
  });

  it("SPLIT VIEW: a summary forged to match the source manifest cannot launder beta evidence", () => {
    // The attack the summary-equality gate closes: transport evaluator-shaped
    // bundle-B evidence (guild-2.3.0-beta.1) while the top-level summary
    // claims the runtime the source commit builds (guild-2.2.0).
    const pair = tamperedPair(
      (r) => {
        r.activated_runtime = { ...r.activated_runtime, runtime_version: "guild-2.2.0" };
      },
      { conformance: BETA_CONFORMANCE_BYTES, promotion: PROMOTION_BYTES }
    );
    const result = check(standardRepo(pair));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("activated_runtime_summary_mismatch");
  });

  it("refuses a record missing its transported evaluator inputs", () => {
    const pair = tamperedPair((r) => delete r.authority);
    expect(check(standardRepo(pair)).code).toBe("conformance_record_malformed");
  });

  it("refuses a recorded decision that disagrees with itself", () => {
    const pair = tamperedPair((r) => (r.decision.may_promote_conformant = false));
    expect(check(standardRepo(pair)).code).toBe("conformance_record_decision_mismatch");
  });

  it("RE-RUNS the decision: a tampered journal entry never promotes, whatever the record claims", () => {
    const pair = tamperedPair((r) => {
      r.authority.observed_entries[0].disposition = "failed";
    });
    const result = check(standardRepo(pair));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("conformance_decision_not_promotable");
  });

  it("RE-RUNS the decision: a tampered attestation signature never promotes", () => {
    const pair = tamperedPair((r) => {
      const sig: string = r.authority.attestations[0].attestation_signature;
      r.authority.attestations[0].attestation_signature =
        sig.slice(0, 20) + (sig[20] === "0" ? "1" : "0") + sig.slice(21);
    });
    expect(check(standardRepo(pair)).code).toBe("conformance_decision_not_promotable");
  });
});

describe("checkStablePromotion — source-commit binding and diff gates", () => {
  it("refuses when the promotion and conformance source commits diverge", () => {
    const promotion = tamperedPromotion((r) => (r.source_commit = "a".repeat(40)));
    const result = check(standardRepo({ promotion }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("source_commit_binding_mismatch");
  });

  it("refuses evidence whose runtime does not name the SOURCE COMMIT's manifest version", () => {
    // Evidence for guild-2.2.0 presented from a source commit whose manifest
    // says 2.9.9 is evidence of a runtime that source commit does not build.
    const repo = standardRepo({ sourceManifestVersion: "2.9.9" });
    const result = check(repo);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("runtime_version_source_mismatch");
    expect(result.reason).toContain("guild-2.9.9");
  });

  it("binds the source-runtime check to the EVALUATOR input: consistent beta evidence from a bare source refuses", () => {
    // Evidence and summary consistently name guild-2.3.0-beta.1 (bundle B) but
    // the source commit's manifest builds 2.2.0 — the gate must read the
    // EVIDENCE runtime and refuse on the source binding.
    const version = "2.3.0";
    const repo = standardRepo({
      version,
      conformance: BETA_CONFORMANCE_BYTES,
      promotion: BETA_PROMOTION_BYTES,
      sourceManifestVersion: "2.2.0",
    });
    const result = check(repo, `release/v${version}`);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("runtime_version_source_mismatch");
    expect(result.reason).toContain("guild-2.3.0-beta.1");
    expect(result.reason).toContain("guild-2.2.0");
  });

  it("RELEASE-IDENTITY: refuses a metadata-only version jump — source core triple must equal the release triple", () => {
    // Structurally valid 2.2.0 evidence (runtime matches its source manifest
    // exactly) must NOT authorize promoting release/v9.0.0 where only release
    // metadata changed. The source manifest's SemVer core must equal the
    // release branch triple (2.7.0-beta.N -> 2.7.0 stays allowed).
    const version = "9.0.0";
    const promotion = JSON.parse(PROMOTION_BYTES.toString("utf8"));
    promotion.version = version;
    const repo = standardRepo({
      version,
      promotion: Buffer.from(JSON.stringify(promotion, null, 2) + "\n"),
      sourceManifestVersion: "2.2.0",
    });
    const result = check(repo, `release/v${version}`);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("source_version_core_mismatch");
    expect(result.reason).toContain("2.2.0");
    expect(result.reason).toContain("9.0.0");
  });

  it("refuses a source commit whose manifest cannot be read (fail closed)", () => {
    const repo = standardRepo();
    repo.files.delete(`${SOURCE_COMMIT}:${MANIFEST_PATH}`);
    const result = check(repo);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("source_manifest_missing");
  });

  it("refuses an unknown source commit", () => {
    const repo = standardRepo();
    delete repo.refs[SOURCE_COMMIT];
    const result = check(repo);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("source_commit_unknown");
  });

  it("refuses a source commit that is not an ancestor of the checked head", () => {
    const repo = standardRepo();
    repo.ancestries.clear();
    const result = check(repo);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("source_commit_not_ancestor");
  });

  it("refuses ANY changed path outside the allowed set, and names it", () => {
    const repo = standardRepo();
    repo.diffs.get(`${SOURCE_COMMIT}..${HEAD_SHA}`)!.push("src/modules/kernel/index.ts");
    const result = check(repo);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("disallowed_path_changed");
    expect(result.reason).toContain("src/modules/kernel/index.ts");
  });
});

describe("promotion mode — real git path (temp repository)", () => {
  function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
  }

  function makeReleaseRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "promo-real-"));
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "test@example.invalid");
    git(repo, "config", "user.name", "test");
    fs.mkdirSync(path.join(repo, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(path.join(repo, `.guild/artifacts/release/v${VERSION}`), { recursive: true });
    fs.writeFileSync(path.join(repo, MANIFEST_PATH), JSON.stringify({ name: "guild", version: VERSION }));
    fs.writeFileSync(
      path.join(repo, MARKETPLACE_PATH),
      JSON.stringify({ name: "guild", plugins: [{ name: "guild", source: "./", version: VERSION }] })
    );
    fs.writeFileSync(path.join(repo, "CHANGELOG.md"), "# changelog\n");
    fs.writeFileSync(path.join(repo, "guild.inventory.json"), "{}\n");
    fs.writeFileSync(path.join(repo, `.guild/artifacts/release/v${VERSION}/promotion.json`), PROMOTION_BYTES);
    fs.writeFileSync(path.join(repo, `.guild/artifacts/release/v${VERSION}/conformance.json`), CONFORMANCE_BYTES);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "release checkout");
    git(repo, "checkout", "-q", "-b", `release/v${VERSION}`);
    return repo;
  }

  it("walks every record gate over real `git show` and stops HONESTLY at the absent evidence commit", () => {
    // The evidence names source commit b871c8d9…, which no test repo can
    // contain. Everything before the ancestry gates — real git resolution,
    // real byte reads, hash binding, schema checks, the complete-coverage
    // check — must pass for the verdict to be EXACTLY source_commit_unknown
    // (the decision re-run sits even later and is never reached here).
    const repo = makeReleaseRepo();
    const result = checkStablePromotion(
      { releaseBranch: `release/v${VERSION}`, headRef: "HEAD" },
      realPromotionGitOps(repo)
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("source_commit_unknown");
    expect(result.reason).toContain(SOURCE_COMMIT);
  });

  it("real-path negative control: a missing promotion record refuses at the record gate", () => {
    const repo = makeReleaseRepo();
    git(repo, "rm", "-q", `.guild/artifacts/release/v${VERSION}/promotion.json`);
    git(repo, "commit", "-q", "-m", "drop promotion record");
    const result = checkStablePromotion(
      { releaseBranch: `release/v${VERSION}`, headRef: "HEAD" },
      realPromotionGitOps(repo)
    );
    expect(result.code).toBe("promotion_record_missing");
  });

  it("real-path negative control: hash binding is over the EXACT stored bytes", () => {
    const repo = makeReleaseRepo();
    const p = path.join(repo, `.guild/artifacts/release/v${VERSION}/conformance.json`);
    fs.writeFileSync(p, CONFORMANCE_BYTES.toString("utf8") + "\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "tamper one byte");
    const result = checkStablePromotion(
      { releaseBranch: `release/v${VERSION}`, headRef: "HEAD" },
      realPromotionGitOps(repo)
    );
    expect(result.code).toBe("evidence_hash_mismatch");
  });

  it("CLI: promotion mode exits 2 on refusal and 1 on usage errors; ordinary mode is untouched", () => {
    const repo = makeReleaseRepo();
    expect(
      cliMain(["promotion", "--release-branch", `release/v${VERSION}`, "--head", "HEAD", "--root", repo])
    ).toBe(2);
    expect(cliMain(["promotion"])).toBe(1); // missing --release-branch
    expect(cliMain(["promotion", "--release-branch", `release/v${VERSION}`, "--bogus"])).toBe(1);
    // Ordinary channel mode: unknown arguments still refuse exactly as before.
    expect(cliMain(["--bogus"])).toBe(1);
  });

  it("CLI: DIRECT script execution reaches the gate (no load-order crash)", () => {
    // Guards the real `npx tsx … promotion` path CI runs — an import-based CLI
    // test cannot catch a module-evaluation-order defect (e.g. the dispatch
    // guard running before promotion-mode constants initialize).
    const repo = makeReleaseRepo();
    const script = path.join(__dirname, "..", "check-channel-integrity.ts");
    let status = 0;
    let stderr = "";
    try {
      execFileSync(
        process.execPath,
        [
          path.join(__dirname, "..", "node_modules", "tsx", "dist", "cli.mjs"),
          script,
          "promotion",
          "--release-branch",
          `release/v${VERSION}`,
          "--head",
          "HEAD",
          "--root",
          repo,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch (err: any) {
      status = err.status;
      stderr = String(err.stderr ?? "");
    }
    expect(status).toBe(2);
    expect(stderr).toContain("source_commit_unknown");
  });
});

describe("CI wiring — branch-policy.yml and the untouched ordinary mode", () => {
  const workflows = path.join(__dirname, "..", "..", ".github", "workflows");

  it("branch-policy.yml carries the hash-bound stable-promotion evidence job", () => {
    const doc = yaml.load(fs.readFileSync(path.join(workflows, "branch-policy.yml"), "utf8")) as any;
    const jobs = doc.jobs ?? {};
    const promotionJob = Object.values(jobs).find((job: any) =>
      String(job?.name ?? "").match(/hash-bound stable-promotion evidence/i)
    ) as any;
    expect(promotionJob).toBeDefined();
    const steps: any[] = promotionJob.steps ?? [];
    const checkout = steps.find((s) => String(s.uses ?? "").startsWith("actions/checkout"));
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
    const runs = steps.map((s) => String(s.run ?? ""));
    const gate = runs.join("\n");
    expect(gate).toMatch(/check-channel-integrity\.ts promotion/);
    expect(gate).toMatch(/--release-branch/);
    // The byte-level generated-manifest invariant must be EXECUTED by this
    // required job, before the promotion command — the gate's safety argument
    // for admitting marketplace.json depends on it actually running here.
    const claudeInstallAt = runs.findIndex((r) => /check:claude-install/.test(r));
    const promotionAt = runs.findIndex((r) => /check-channel-integrity\.ts promotion/.test(r));
    expect(claudeInstallAt).toBeGreaterThanOrEqual(0);
    expect(promotionAt).toBeGreaterThan(claudeInstallAt);
    // Fail-closed dependency install: npm ci only, never an npm install fallback.
    const installRun = runs.find((r) => /npm ci/.test(r)) ?? "";
    expect(installRun).not.toMatch(/npm install/);
  });

  it("branch-policy.yml keeps the same-repo release/v* head-shape job intact", () => {
    const raw = fs.readFileSync(path.join(workflows, "branch-policy.yml"), "utf8");
    expect(raw).toMatch(/release\/v\[0-9\]\+/);
    expect(raw).toMatch(/must come from a same-repo release\/v\* branch/);
  });

  it("release.yml re-runs promotion mode using only CLI-supported arguments", () => {
    const raw = fs.readFileSync(path.join(workflows, "release.yml"), "utf8");
    expect(raw).toMatch(/check:channel-integrity -- promotion/);
    expect(raw).toMatch(/--release-branch/);
    expect(raw).toMatch(/--head/);
    expect(raw).not.toMatch(/--labels-json|LABELS_JSON/);

    // A pull-request branch is untrusted input. Keep the expression out of the
    // inline shell program so GitHub passes the exact bytes through env before
    // the release/vX.Y.Z validator evaluates them.
    const doc = yaml.load(raw) as any;
    const steps = Object.values(doc.jobs ?? {}).flatMap((job: any) => job.steps ?? []);
    const deriveVersion = steps.find((step: any) => step.id === "ver") as any;
    expect(deriveVersion).toBeDefined();
    expect(deriveVersion.env?.RELEASE_BRANCH).toBe("${{ github.event.pull_request.head.ref }}");
    expect(String(deriveVersion.run ?? "")).toContain('BRANCH="$RELEASE_BRANCH"');
    expect(String(deriveVersion.run ?? "")).not.toContain("${{ github.event.pull_request.head.ref }}");
  });

  it("the live-required branch-policy context is transitively BLOCKED on promotion evidence", () => {
    // FIC-92 blocker 3: live GitHub protection requires only the
    // `branch-policy` context, so a merely-present promotion job is not a
    // publication blocker. Without mutating any GitHub setting, the required
    // job must depend on promotion-evidence AND still RUN (never skip — GitHub
    // treats a skipped required check as satisfied) and FAIL when the
    // dependency did not succeed.
    const doc = yaml.load(fs.readFileSync(path.join(workflows, "branch-policy.yml"), "utf8")) as any;
    const job = doc.jobs?.["branch-policy"];
    expect(job).toBeDefined();
    const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
    expect(needs).toContain("promotion-evidence");
    // `if: always()` is what prevents the skip-equals-success hole.
    expect(String(job.if ?? "")).toMatch(/always\(\)/);
    const steps: any[] = job.steps ?? [];
    const guard = steps[0];
    const guardText = JSON.stringify(guard ?? {});
    expect(guardText).toContain("needs.promotion-evidence.result");
    expect(String(guard?.run ?? "")).toMatch(/exit 1/);
    // The head-shape enforcement must remain a later step of the SAME job.
    const headShape = steps.map((s) => String(s.run ?? "")).join("\n");
    expect(headShape).toMatch(/release\/v\[0-9\]\+/);
  });

  it("channel-integrity.yml still runs ONLY the ordinary channel mode", () => {
    const raw = fs.readFileSync(path.join(workflows, "channel-integrity.yml"), "utf8");
    expect(raw).toMatch(/check.channel.integrity/);
    expect(raw).not.toMatch(/promotion/);
  });
});
