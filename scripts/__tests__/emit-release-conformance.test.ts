/**
 * scripts/__tests__/emit-release-conformance.test.ts
 *
 * RELEASE-CONFORMANCE EMITTER — FIC-91 / REL-P0, reconciled to A21-X
 * (FIC-156): the emitter now consumes the FULL integration/assembly seam
 * (`evaluateTransportedReleaseConformance`), so a record may name 31/31 only
 * when all 31 scenarios were genuinely evaluated and assembled AND the
 * production decision promotes.
 *
 * WHAT THAT MEANS FOR THIS SUITE. The historical honest-5/31 evaluator
 * package is no longer an emittable release claim: it refuses at the
 * full-suite coverage check and writes nothing. A structurally complete but
 * FABRICATED 31/31 package reaches the production decision and is refused
 * there (the decision's own reason, never this suite's judgement). And since
 * the repository holds no production attestor material, NO in-repo package
 * can reach a promotable decision — every emission path fails closed by
 * construction, which is exactly the A21-X posture.
 *
 * PRESERVED CONTROLS. Every pre-decision fail-closed control keeps its exact
 * code: frozen-suite hash pin, malformed/missing inputs, source-commit
 * binding, generated-at provenance, promotion-option validation, and the
 * append-only output pre-flight. The atomic paired-emission transaction
 * (staging, EEXIST race, rollback, truthful error classification) is
 * exercised through its exported seam `publishReleaseRecordsAllOrNothing` —
 * the exact code path `emitReleaseConformance` publishes through — because no
 * in-repo package can reach publication any more.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";

import {
  emitReleaseConformance,
  main as emitterMain,
  publishReleaseRecordsAllOrNothing,
} from "../emit-release-conformance";
import {
  FROZEN_SCENARIO_CONTRACT_SHA256,
  FROZEN_SCENARIO_CONTRACT_COUNT,
  FROZEN_SCENARIO_CONTRACT_IDS,
} from "../check-channel-integrity";

const FIXTURES = path.join(__dirname, "fixtures", "release-conformance");
const SUITE = path.join(FIXTURES, "conformance-scenarios.v1.json");
const PACKAGE = path.join(FIXTURES, "evaluator-package.json");
const SOURCE_COMMIT = "b871c8d973bd8258c25ce5e87a89f68f2e63a516";
/** Truthful, caller-supplied generation time (FIC-92 blocker 2). */
const GENERATED_AT = "2026-08-18T06:30:00.000Z";

function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "emit-rc-"));
}

function emitTo(dir: string, patch: Partial<Parameters<typeof emitReleaseConformance>[0]> = {}) {
  return emitReleaseConformance({
    suitePath: SUITE,
    packagePath: PACKAGE,
    sourceCommit: SOURCE_COMMIT,
    outPath: path.join(dir, "conformance.json"),
    generatedAt: GENERATED_AT,
    ...patch,
  });
}

/** Any staging temp files left visible in a directory (cleanup control). */
function tempLeftovers(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.includes(".tmp-")) : [];
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

function loadPackage(): { evidence: Record<string, unknown>; authority: Record<string, unknown> } {
  return JSON.parse(fs.readFileSync(PACKAGE, "utf8"));
}

/**
 * A structurally complete but substantively unbacked full-suite package: the
 * five signed MH-02 results extended with 26 invented ones over the SAME
 * identity, transported with the genuine fixture authority. The exact forgery
 * the emitter must refuse on decision substance — never accept on its count.
 */
function fabricated31Package(
  mutate: (pkg: { evidence: Record<string, unknown>; authority: Record<string, unknown> }) => void = () => {}
): { evidence: Record<string, unknown>; authority: Record<string, unknown> } {
  const pkg = loadPackage();
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
      receipt_ref: `guild.receipt_ref.v1:jrn-emit-fabricated#${sequence}@nec1:${hex}`,
      evidence_identity: JSON.parse(JSON.stringify(identity)) as Record<string, unknown>,
      evidence_freshness: "fresh",
    };
  });
  const fabricated = {
    evidence: {
      suite_id: pkg.evidence.suite_id,
      suite_version: pkg.evidence.suite_version,
      required_scenario_ids: [...FROZEN_SCENARIO_CONTRACT_IDS],
      activated_runtime: identity,
      results,
      claimant_id: pkg.evidence.claimant_id,
    },
    authority: pkg.authority,
  };
  mutate(fabricated);
  return fabricated;
}

function writePackage(dir: string, pkg: unknown): string {
  const packagePath = path.join(dir, "package.json");
  fs.writeFileSync(packagePath, JSON.stringify(pkg));
  return packagePath;
}

describe("frozen scenario contract fixture", () => {
  it("is byte-identical to the frozen 31-scenario contract (anti-drift pin)", () => {
    // The fixture is a COPY (the canonical file lives in the umbrella workspace,
    // which a plugin-only CI checkout does not have). The hash pin is what makes
    // the copy honest: any divergence from the frozen bytes fails here.
    expect(sha256(fs.readFileSync(SUITE))).toBe(FROZEN_SCENARIO_CONTRACT_SHA256);
    const suite = JSON.parse(fs.readFileSync(SUITE, "utf8"));
    expect(suite.scenarios).toHaveLength(FROZEN_SCENARIO_CONTRACT_COUNT);
    expect(suite.schema_version).toBe("guild.conformance_scenarios.v1");
  });
});

describe("emit-release-conformance — the A21-X fail-closed 31/31 truth", () => {
  it("refuses the historical honest 5/31 package at the full-suite coverage check and writes nothing", () => {
    const dir = tmpDir();
    const result = emitTo(dir);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("scenario_coverage_incomplete");
    expect(result.detail).toMatch(/full/);
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
    expect(tempLeftovers(dir)).toEqual([]);
  });

  it("the coverage refusal is deterministic and never partially writes, even with the promotion pair requested", () => {
    const dir = tmpDir();
    const first = emitTo(dir, { promotionOut: path.join(dir, "promotion.json"), version: "2.2.0" });
    const second = emitTo(dir, { promotionOut: path.join(dir, "promotion.json"), version: "2.2.0" });
    expect(first).toEqual(second);
    expect(first.code).toBe("scenario_coverage_incomplete");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("refuses a fabricated 31/31 package on DECISION substance, never accepts it on its count", () => {
    // Structurally complete: all 31 ids in canonical order, one identity, the
    // genuine signed authority. The coverage stage passes; the production
    // decision then refuses the substance (its own reason code travels in the
    // detail), and nothing is written.
    const dir = tmpDir();
    const result = emitTo(dir, { packagePath: writePackage(dir, fabricated31Package()) });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("evaluator_not_promotable");
    expect(result.detail).toMatch(/stage=decision/);
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
  });

  it("a tampered attestation signature on a 31/31 package still refuses at the decision and writes nothing", () => {
    // The production decision refuses this package before its signature stage
    // (the core's required-set gate still pins the five W1/MH-02 ids, so every
    // full-suite tuple refuses there first) — the emitter's obligation is that
    // NO non-promotable decision emits, whichever gate refused. The trust-root
    // signature verification itself stays live and is pinned where it is
    // reachable: the neutral-core suite and the A21-X integration suite's
    // fabrication controls exercise it over the recognized 5-evidence shape.
    const dir = tmpDir();
    const pkg = fabricated31Package((mutable) => {
      const attestations = (mutable.authority as { attestations: Array<Record<string, unknown>> })
        .attestations;
      const sig = String(attestations[0].attestation_signature);
      attestations[0].attestation_signature = sig.slice(0, 20) + (sig[20] === "0" ? "1" : "0") + sig.slice(21);
    });
    const result = emitTo(dir, { packagePath: writePackage(dir, pkg) });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("evaluator_not_promotable");
    expect(result.detail).toMatch(/stage=decision/);
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
  });

  it("refuses a package whose evidence shrinks, reorders, or misorders the full tuple at the coverage stage", () => {
    const dir = tmpDir();
    const shrunk = fabricated31Package((mutable) => {
      const evidence = mutable.evidence as { required_scenario_ids: string[]; results: unknown[] };
      evidence.required_scenario_ids = evidence.required_scenario_ids.slice(0, 30);
      evidence.results = evidence.results.slice(0, 30);
    });
    const shrunkResult = emitTo(dir, { packagePath: writePackage(dir, shrunk) });
    expect(shrunkResult.code).toBe("scenario_coverage_incomplete");
    const misordered = fabricated31Package((mutable) => {
      const evidence = mutable.evidence as { results: unknown[] };
      const [first, ...rest] = evidence.results;
      evidence.results = [...rest, first];
    });
    const misorderedResult = emitTo(dir, { packagePath: writePackage(dir, misordered) });
    expect(misorderedResult.code).toBe("scenario_coverage_incomplete");
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
  });
});

describe("emit-release-conformance — preserved fail-closed refusals", () => {
  it("refuses a scenario contract whose bytes do not hash to the frozen SHA-256", () => {
    const dir = tmpDir();
    const tampered = path.join(dir, "suite.json");
    fs.writeFileSync(tampered, fs.readFileSync(SUITE, "utf8") + "\n");
    const result = emitTo(dir, { suitePath: tampered });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("scenario_contract_hash_mismatch");
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
  });

  it("refuses a missing scenario contract file", () => {
    const dir = tmpDir();
    const result = emitTo(dir, { suitePath: path.join(dir, "absent.json") });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("scenario_contract_unreadable");
  });

  it("refuses a malformed evaluator package (missing authority)", () => {
    const dir = tmpDir();
    const pkg = JSON.parse(fs.readFileSync(PACKAGE, "utf8"));
    delete pkg.authority;
    const result = emitTo(dir, { packagePath: writePackage(dir, pkg) });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("package_malformed");
    expect(result.detail).toMatch(/authority/);
  });

  it("refuses an unparseable evaluator package", () => {
    const dir = tmpDir();
    const packagePath = path.join(dir, "package.json");
    fs.writeFileSync(packagePath, "{not json");
    const result = emitTo(dir, { packagePath });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("package_malformed");
  });

  it("refuses a requested source commit that is not bound by the evidence AND authority", () => {
    const dir = tmpDir();
    const result = emitTo(dir, { sourceCommit: "a".repeat(40) });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("source_commit_binding_mismatch");
    expect(result.detail).toContain(SOURCE_COMMIT);
  });

  it("refuses a malformed source commit", () => {
    const dir = tmpDir();
    const result = emitTo(dir, { sourceCommit: "not-a-sha" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("source_commit_malformed");
  });

  it("never overwrites an existing output record (append-only pre-flight, before any decision)", () => {
    const dir = tmpDir();
    const outPath = path.join(dir, "conformance.json");
    fs.writeFileSync(outPath, "occupied");
    const result = emitTo(dir);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("output_exists");
    expect(fs.readFileSync(outPath, "utf8")).toBe("occupied");
  });

  it("pre-flights the paired promotion destination too, before anything is written", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "promotion.json"), "occupied");
    const result = emitTo(dir, { promotionOut: path.join(dir, "promotion.json"), version: "2.2.0" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("output_exists");
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "promotion.json"), "utf8")).toBe("occupied");
    expect(tempLeftovers(dir)).toEqual([]);
  });

  it("refuses identical resolved conformance and promotion destinations, including under --force", () => {
    const dir = tmpDir();
    const sharedPath = path.join(dir, "shared.json");
    const result = emitTo(dir, {
      outPath: sharedPath,
      promotionOut: path.join(dir, ".", "shared.json"),
      version: "2.2.0",
      force: true,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("output_paths_overlap");
    expect(fs.existsSync(sharedPath)).toBe(false);
    expect(tempLeftovers(dir)).toEqual([]);
  });

  it("requires a bare-triple version for the paired promotion record", () => {
    const dir = tmpDir();
    const result = emitTo(dir, { promotionOut: path.join(dir, "promotion.json"), version: "2.2.0-beta.1" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("version_not_bare");
  });

  it("requires an explicit generation timestamp (no default, no epoch)", () => {
    const dir = tmpDir();
    const result = emitTo(dir, { generatedAt: undefined as unknown as string });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("generated_at_missing");
  });

  it("refuses a malformed or non-canonical generation timestamp", () => {
    const dir = tmpDir();
    for (const bad of ["2026-08-18 06:30:00", "2026-08-18T06:30:00+02:00", "2026-02-30T00:00:00.000Z", "epoch"]) {
      const result = emitTo(dir, { generatedAt: bad });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("generated_at_malformed");
    }
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
  });

  it("accepts whole-second UTC (canonicalized): the refusal moves PAST the timestamp gate", () => {
    // With no emittable package left in-repo, acceptance is observable as the
    // refusal landing at the later coverage stage rather than at the
    // timestamp gate.
    const dir = tmpDir();
    const result = emitTo(dir, { generatedAt: "2026-08-18T06:30:00Z" });
    expect(result.code).toBe("scenario_coverage_incomplete");
  });
});

describe("paired-emission transaction (exported publication seam)", () => {
  // `publishReleaseRecordsAllOrNothing` is the exact function
  // `emitReleaseConformance` publishes through; with every in-repo package
  // refusing before the write, this seam is what keeps the FIC-92 atomic
  // paired-emission controls exercised rather than vacuous. It accepts only
  // already-serialized bytes — no packet, outcome, authority, required set,
  // or verdict can be injected through it.
  function plan(dir: string, promotionPath?: string) {
    const entries = [{ finalPath: path.join(dir, "conformance.json"), bytes: Buffer.from("record-a\n") }];
    if (promotionPath !== undefined) entries.push({ finalPath: promotionPath, bytes: Buffer.from("record-b\n") });
    return entries;
  }

  it("publishes both records atomically on the clean path and leaves no temps", () => {
    const dir = tmpDir();
    const result = publishReleaseRecordsAllOrNothing(plan(dir, path.join(dir, "promotion.json")), false);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("emitted");
    expect(fs.readFileSync(path.join(dir, "conformance.json"), "utf8")).toBe("record-a\n");
    expect(fs.readFileSync(path.join(dir, "promotion.json"), "utf8")).toBe("record-b\n");
    expect(tempLeftovers(dir)).toEqual([]);
  });

  it("FIC-92 B1 reproduction: an unwritable second destination leaves NO partial pair", () => {
    // First destination writable, second in a nonexistent directory. The
    // refusal must be truthfully classified as an I/O error — not
    // output_exists — and neither final file nor any staging temp may remain.
    const dir = tmpDir();
    const result = publishReleaseRecordsAllOrNothing(
      plan(dir, path.join(dir, "no-such-dir", "promotion.json")),
      false
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("output_io_error");
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
    expect(tempLeftovers(dir)).toEqual([]);
  });

  it("race: a destination appearing AFTER staging rolls the published first final back", () => {
    // onStaged opens the race window the pre-flight check cannot see: the
    // collision is caught by the atomic link publication, the already-published
    // conformance final is rolled back, and the temps are cleaned.
    const dir = tmpDir();
    const promotionOut = path.join(dir, "promotion.json");
    const result = publishReleaseRecordsAllOrNothing(plan(dir, promotionOut), false, () =>
      fs.writeFileSync(promotionOut, "raced-in")
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("output_exists");
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
    expect(fs.readFileSync(promotionOut, "utf8")).toBe("raced-in");
    expect(tempLeftovers(dir)).toEqual([]);
  });

  it("race: a second-publication I/O failure rolls the published first final back", () => {
    const dir = tmpDir();
    const promoDir = path.join(dir, "promo");
    fs.mkdirSync(promoDir);
    const result = publishReleaseRecordsAllOrNothing(plan(dir, path.join(promoDir, "promotion.json")), false, () =>
      fs.rmSync(promoDir, { recursive: true, force: true })
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("output_io_error");
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
    expect(tempLeftovers(dir)).toEqual([]);
  });
});

describe("emit-release-conformance — CLI", () => {
  it("exits 2 on the fail-closed coverage refusal and on a tampered frozen suite", () => {
    const dir = tmpDir();
    expect(
      emitterMain([
        "--suite", SUITE,
        "--package", PACKAGE,
        "--source-commit", SOURCE_COMMIT,
        "--generated-at", GENERATED_AT,
        "--out", path.join(dir, "conformance.json"),
      ])
    ).toBe(2);
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
    const tampered = path.join(dir, "suite.json");
    fs.writeFileSync(tampered, fs.readFileSync(SUITE, "utf8") + "\n");
    expect(
      emitterMain([
        "--suite", tampered,
        "--package", PACKAGE,
        "--source-commit", SOURCE_COMMIT,
        "--generated-at", GENERATED_AT,
        "--out", path.join(dir, "conformance2.json"),
      ])
    ).toBe(2);
  });

  it("exits 1 on missing required arguments", () => {
    expect(emitterMain([])).toBe(1);
    expect(emitterMain(["--suite", SUITE])).toBe(1);
    // --generated-at is REQUIRED: provenance is never defaulted.
    expect(
      emitterMain([
        "--suite", SUITE,
        "--package", PACKAGE,
        "--source-commit", SOURCE_COMMIT,
        "--out", path.join(tmpDir(), "conformance.json"),
      ])
    ).toBe(1);
  });
});
