/**
 * scripts/sign-release-attestation.ts
 *
 * A21-9 / W5/MH-09 — the EXTERNAL one-time attestation signer.
 *
 * Issues one WOTS+/Merkle attestation signature (`guild.wots_merkle.v1`, the
 * exact scheme the accepted `neutralVerifyAttestationSignature` core verifies)
 * from EXTERNALLY PROVISIONED one-time signing material. The repository never
 * contains, generates, or commits private chain material: the material file is
 * an input the operator supplies, and this tool's whole job is to consume ONE
 * one-time key from it, durably record that consumption, and emit the signature
 * — refusing everything else.
 *
 * WHAT IT REFUSES, AND WHY EACH REFUSAL IS STRUCTURAL
 *   - UNRECOGNIZED PRODUCTION AUTHORITY: release signing accepts only the
 *     dedicated production material schema and only when its re-derived root
 *     equals the source-pinned root for its attestor id. The separate FU04
 *     root-admission action may sign only an `nra1:` possession challenge for a
 *     complete three-root replacement manifest that excludes every currently
 *     pinned fixture-era root. Its output cannot verify custody or authorize a
 *     trust-root change; changing the source-pinned table remains a reviewed
 *     code change.
 *   - UNTRUSTED PRODUCTION CUSTODY: production requires an explicit current-user
 *     custody root at mode 0700. Material, registry, output, and both locks must
 *     remain strictly beneath it through real, current-user 0700 directories.
 *     Material must be a direct child of that root, and the production registry
 *     is fixed at `<custody-root>/used-one-time-keys.json`, so callers cannot
 *     partition either the custody lock or the one-time-key history.
 *     One custody-wide O_EXCL lock is held across admission, reservation, and
 *     publication; the opened root descriptor and the final named root must
 *     retain the admitted protection and device/inode identity.
 *   - STATICALLY VISIBLE SYMLINKS, at the leaf AND at any intermediate parent,
 *     for the material, registry, output, and lock positions: a link is a
 *     redirect wearing the required name, and a signer that follows one signs
 *     into (or reads out of) a tree nobody audited. The material leaf is also
 *     descriptor-bound against replacement while it is read.
 *   - UNPROTECTED PRODUCTION MATERIAL: production material is opened once with
 *     O_NOFOLLOW, verified through that descriptor as a private regular file
 *     owned by the current process user, and read through the same descriptor.
 *     The path must still name the opened inode after the read; replacement is
 *     a refusal, never an invitation to parse attacker-controlled bytes.
 *   - KEY REUSE: the {attestor_id, verification_root, key_index} tuple is
 *     reserved in the durable used-key registry BEFORE any output exists, under
 *     an exclusive lock at exactly `<registry>.lock`. Production binds that
 *     registry to the deterministic custody-root path. A reservation survives a
 *     later output failure — a one-time key that MAY have produced a signature
 *     is a consumed key, because "the write failed" is not evidence the
 *     signature never left the process.
 *   - MATERIAL THAT DOES NOT PROVE ITSELF: before signing, the declared
 *     verification root is RE-DERIVED from the supplied chain starts through
 *     the full WOTS+/Merkle construction; material that is well-formed but does
 *     not derive its own declared root is refused.
 *
 * PRODUCTION CUSTODY BOUNDARY
 *   This tool implements the separately reviewed trusted single-user boundary,
 *   not an openat-style atomic directory-handle namespace. The custody lock
 *   coordinates cooperating signer processes. It does not defend against an
 *   arbitrary concurrent process running as the same OS user that swaps a path
 *   and restores it between rechecks. External custodians MUST exclude that
 *   actor by dedicating the account/session and serializing custody-root access.
 *
 * WHAT THE OUTPUT NEVER CONTAINS
 *   The output and the registry are written atomically (temp + rename) at mode
 *   0600, and neither ever carries raw chain-start material. One subtlety is
 *   inherent to WOTS+: a code-word symbol of 0 means the revealed chain value
 *   for that chain IS the step-0 chain start. The signature must reveal it (the
 *   accepted verifier walks from exactly that value), but the durable output
 *   file encodes every string with JSON `\uXXXX` escapes, so no chain-derived
 *   hex value — chain start or otherwise — ever appears as a scannable
 *   substring of anything this tool writes to disk. `JSON.parse` recovers the
 *   exact signature; a grep over the bytes recovers nothing.
 *
 * CLI
 *   npx tsx sign-release-attestation.ts \
 *     --material-path <p> --digest <d> --output-path <p> \
 *     --mode <fixture|production> --used-key-registry-path <p> \
 *     [--custody-root-path <p>]  # required when --mode production
 *
 *   npx tsx sign-release-attestation.ts root-admission-prove \
 *     --candidate-manifest-path <p> --material-path <p> --output-path <p> \
 *     --used-key-registry-path <p> --custody-root-path <p>
 *
 *   npx tsx sign-release-attestation.ts root-admission-verify \
 *     --candidate-manifest-path <p> --proof-a-path <p> --proof-b-path <p> \
 *     --proof-c-path <p> --output-path <p>
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  NEUTRAL_ATTESTATION_CHAINS,
  NEUTRAL_ATTESTATION_CHAIN_LENGTH,
  NEUTRAL_ATTESTATION_CHECKSUM_CHAINS,
  NEUTRAL_ATTESTATION_MESSAGE_CHAINS,
  NEUTRAL_ATTESTATION_SCHEME,
  NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN,
  NEUTRAL_ATTESTATION_TREE_HEIGHT,
  neutralAttestorVerificationKey,
  neutralVerifyAttestationSignature,
} from "../src/modules/lifecycle/workflows/neutral-conformance-core";
import {
  neutralCanonicalJson,
  neutralSha256Hex,
} from "../src/modules/lifecycle/workflows/neutral-runtime-contracts";

// ---------------------------------------------------------------------------
// Contract surface
// ---------------------------------------------------------------------------

export const SIGNER_MODES = Object.freeze(["production", "fixture"] as const);

/** The legacy test-only signing-material schema accepted in fixture mode. */
export const SIGNER_FIXTURE_MATERIAL_SCHEMA = "guild.mh09_fixture_signing_material.v1";
/**
 * The distinct schema required for externally provisioned production material.
 * The signer is deliberately generic across the core's distinct journal
 * attestors: the final decision requires a quorum, so each independently
 * custodied principal must be able to sign through the same audited algorithm.
 */
export const SIGNER_PRODUCTION_MATERIAL_SCHEMA = "guild.journal_attestor_signing_material.v1";
/** Backwards-compatible fixture-schema export. */
export const SIGNER_MATERIAL_SCHEMA = SIGNER_FIXTURE_MATERIAL_SCHEMA;

export const SIGNER_OUTPUT_SCHEMA = "guild.release_attestation.v1";
export const SIGNER_REGISTRY_SCHEMA = "guild.used_one_time_keys.v1";
export const ROOT_ADMISSION_CANDIDATE_SCHEMA = "guild.journal_attestor_root_candidate.v1";
export const ROOT_ADMISSION_PROOF_SCHEMA = "guild.journal_attestor_root_possession_proof.v1";
export const ROOT_ADMISSION_BUNDLE_SCHEMA = "guild.journal_attestor_root_admission.v1";
export const ROOT_ADMISSION_DOMAIN = "guild.journal_attestor_root_admission.v1/possession/1";

/** The deterministic lock-path contract: `<registry>.lock`, never anywhere else. */
export function lockPathFor(registryPath: string): string {
  return `${registryPath}.lock`;
}

/** The production-wide single-user custody lock, fixed beneath the custody root. */
export function custodyLockPathFor(custodyRoot: string): string {
  return path.join(custodyRoot, ".guild-release-attestation-custody.lock");
}

/** The one production registry identity for a custody root. */
export function productionRegistryPathFor(custodyRoot: string): string {
  return path.join(custodyRoot, "used-one-time-keys.json");
}

export interface SignReleaseAttestationOptions {
  readonly material_path: string;
  readonly digest: string;
  readonly output_path: string;
  readonly mode: string;
  readonly used_key_registry_path: string;
  readonly custody_root_path?: string;
}

export interface SignReleaseAttestationOutput {
  readonly schema_version: string;
  readonly scheme: string;
  readonly attestor_id: string;
  readonly verification_root: string;
  readonly key_index: number;
  readonly digest: string;
  readonly signature: string;
  readonly mode: string;
}

export interface RootAdmissionCandidate {
  readonly attestor_id: string;
  readonly verification_root: string;
}

export interface RootAdmissionCandidateManifest {
  readonly schema_version: string;
  readonly rotation_id: string;
  readonly predecessor_trust_root_digest: string;
  readonly candidates: readonly RootAdmissionCandidate[];
  readonly external_custody_verified: false;
  readonly authorizes_rotation: false;
}

export interface SignRootAdmissionProofOptions {
  readonly candidate_manifest: unknown;
  readonly material_path: string;
  readonly output_path: string;
  readonly used_key_registry_path: string;
  readonly custody_root_path: string;
}

export interface RootAdmissionProof {
  readonly schema_version: string;
  readonly scheme: string;
  readonly rotation_id: string;
  readonly manifest_digest: string;
  readonly attestor_id: string;
  readonly verification_root: string;
  readonly key_index: number;
  readonly signature: string;
  readonly mode: "production";
  readonly external_custody_verified: false;
  readonly authorizes_rotation: false;
}

export interface RootAdmissionBundle {
  readonly schema_version: string;
  readonly candidate_manifest: RootAdmissionCandidateManifest;
  readonly manifest_digest: string;
  readonly proofs: readonly RootAdmissionProof[];
  readonly candidate_root_possession_verified: true;
  readonly external_custody_verified: false;
  readonly authorizes_rotation: false;
}

/**
 * The fixture-era trust table FU04 is replacing. This snapshot deliberately
 * does not alias the live decision-core table: after the reviewed source root
 * rotation, previously issued admission proofs must remain verifiable against
 * the predecessor they actually named.
 */
export const ROOT_ADMISSION_PREDECESSOR_TRUST_ROOT: readonly RootAdmissionCandidate[] =
  Object.freeze([
    Object.freeze({
      attestor_id: "guild.release-attestor",
      verification_root: "2cd0a7a8986e79ec2cb25b5752d5a85a80d10c4d133d6590b91417bf976f3539",
    }),
    Object.freeze({
      attestor_id: "guild.host-conformance-witness",
      verification_root: "584d8e28a2a5c109a2b892b627a3154fef9da46efc45eb79d042611bf09d09ef",
    }),
    Object.freeze({
      attestor_id: "guild.distribution-notary",
      verification_root: "4dd9eb1f20a5194d38c6ac9cf308dac017ceebac0e85bcd7fbfa26fc43945f37",
    }),
  ]);

const OPTION_KEYS: readonly string[] = Object.freeze([
  "material_path",
  "digest",
  "output_path",
  "mode",
  "used_key_registry_path",
  "custody_root_path",
]);

const REQUIRED_OPTION_KEYS: readonly string[] = Object.freeze([
  "material_path",
  "digest",
  "output_path",
  "mode",
  "used_key_registry_path",
]);

const DIGEST_PATTERN = /^nad1:[0-9a-f]{64}$/;
const ROOT_ADMISSION_DIGEST_PATTERN = /^nra1:[0-9a-f]{64}$/;
const HEX64_PATTERN = /^[0-9a-f]{64}$/;
const ROTATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;

function refuse(detail: string): never {
  throw new Error(`sign-release-attestation: ${detail}`);
}

function closedRecord(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    refuse(`${label} must be a single plain object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    refuse(`${label} must use exactly the closed member vocabulary: ${expected.join(", ")}`);
  }
  return record;
}

export function rootAdmissionPredecessorDigest(): string {
  return `nrt1:${neutralSha256Hex(
    `${ROOT_ADMISSION_DOMAIN}|PREDECESSOR|${neutralCanonicalJson(ROOT_ADMISSION_PREDECESSOR_TRUST_ROOT)}`
  )}`;
}

export function validateRootAdmissionCandidateManifest(
  value: unknown
): RootAdmissionCandidateManifest {
  const record = closedRecord(value, "root-admission candidate manifest", [
    "schema_version",
    "rotation_id",
    "predecessor_trust_root_digest",
    "candidates",
    "external_custody_verified",
    "authorizes_rotation",
  ]);
  if (record.schema_version !== ROOT_ADMISSION_CANDIDATE_SCHEMA) {
    refuse(`root-admission candidate manifest must declare ${ROOT_ADMISSION_CANDIDATE_SCHEMA}`);
  }
  if (typeof record.rotation_id !== "string" || !ROTATION_ID_PATTERN.test(record.rotation_id)) {
    refuse("root-admission candidate manifest names no admissible rotation_id");
  }
  if (record.predecessor_trust_root_digest !== rootAdmissionPredecessorDigest()) {
    refuse("root-admission candidate manifest is not bound to the current predecessor trust root");
  }
  if (record.external_custody_verified !== false || record.authorizes_rotation !== false) {
    refuse("root-admission candidate manifest cannot claim external custody or authorize rotation");
  }
  if (
    !Array.isArray(record.candidates) ||
    record.candidates.length !== ROOT_ADMISSION_PREDECESSOR_TRUST_ROOT.length
  ) {
    refuse(
      `root-admission candidate manifest must name exactly ${ROOT_ADMISSION_PREDECESSOR_TRUST_ROOT.length} replacement roots`
    );
  }

  const retiredRoots = new Set(
    ROOT_ADMISSION_PREDECESSOR_TRUST_ROOT.map((entry) => entry.verification_root)
  );
  const seenRoots = new Set<string>();
  const candidates: RootAdmissionCandidate[] = [];
  for (let index = 0; index < ROOT_ADMISSION_PREDECESSOR_TRUST_ROOT.length; index += 1) {
    const candidate = closedRecord(record.candidates[index], `root-admission candidate ${index}`, [
      "attestor_id",
      "verification_root",
    ]);
    const expectedId = ROOT_ADMISSION_PREDECESSOR_TRUST_ROOT[index].attestor_id;
    if (candidate.attestor_id !== expectedId) {
      refuse(`root-admission candidate ${index} must replace the source-owned attestor ${expectedId}`);
    }
    if (typeof candidate.verification_root !== "string" || !HEX64_PATTERN.test(candidate.verification_root)) {
      refuse(`root-admission candidate ${expectedId} has no well-formed verification root`);
    }
    if (retiredRoots.has(candidate.verification_root)) {
      refuse(`root-admission candidate ${expectedId} reuses a retired fixture-era root`);
    }
    if (seenRoots.has(candidate.verification_root)) {
      refuse("root-admission candidate roots must be distinct");
    }
    seenRoots.add(candidate.verification_root);
    candidates.push(
      Object.freeze({
        attestor_id: expectedId,
        verification_root: candidate.verification_root,
      })
    );
  }

  return Object.freeze({
    schema_version: ROOT_ADMISSION_CANDIDATE_SCHEMA,
    rotation_id: record.rotation_id,
    predecessor_trust_root_digest: record.predecessor_trust_root_digest as string,
    candidates: Object.freeze(candidates),
    external_custody_verified: false,
    authorizes_rotation: false,
  });
}

export function rootAdmissionManifestDigest(value: unknown): string {
  const manifest = validateRootAdmissionCandidateManifest(value);
  return `nra1:${neutralSha256Hex(
    `${ROOT_ADMISSION_DOMAIN}|MANIFEST|${neutralCanonicalJson(manifest)}`
  )}`;
}

// ---------------------------------------------------------------------------
// Path containment — leaf and intermediate-parent symlink refusal
// ---------------------------------------------------------------------------

/**
 * The system temp directory's canonical form is the ONE prefix rewrite this
 * check tolerates: on macOS `os.tmpdir()` itself lives behind the historical
 * `/var → /private/var` link, which is the platform's shape rather than a
 * caller's redirect. Everything below that prefix — and every component of a
 * non-temp path — must resolve to exactly itself.
 */
function canonicalExpectation(existingAncestor: string): string {
  const tmp = os.tmpdir();
  let realTmp: string;
  try {
    realTmp = fs.realpathSync(tmp);
  } catch {
    realTmp = tmp;
  }
  if (existingAncestor === tmp) return realTmp;
  if (existingAncestor.startsWith(`${tmp}${path.sep}`)) {
    return path.join(realTmp, existingAncestor.slice(tmp.length + 1));
  }
  return existingAncestor;
}

function deepestExistingAncestor(target: string): string | null {
  let current = path.dirname(path.resolve(target));
  for (;;) {
    try {
      fs.lstatSync(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

/**
 * Refuse a position whose leaf is a symlink, or whose parent chain resolves
 * anywhere other than where its path says it is — an intermediate-parent
 * symlink escape reaches a tree the caller never named.
 */
function assertContainedPosition(label: string, target: string): void {
  const resolved = path.resolve(target);
  let leaf: fs.Stats | null = null;
  try {
    leaf = fs.lstatSync(resolved);
  } catch {
    leaf = null;
  }
  if (leaf !== null && leaf.isSymbolicLink()) {
    refuse(`${label} position is a symlink — refusing a redirected position`);
  }
  const ancestor = deepestExistingAncestor(resolved);
  if (ancestor === null) return;
  let realAncestor: string;
  try {
    realAncestor = fs.realpathSync(ancestor);
  } catch {
    refuse(`${label} parent chain cannot be resolved — refusing an unverifiable containment`);
  }
  if (realAncestor !== canonicalExpectation(ancestor)) {
    refuse(`${label} parent chain escapes through a symlink — refusing a redirected position`);
  }
}

function assertProductionCustodyRootStats(stats: fs.Stats): void {
  if (!stats.isDirectory()) {
    refuse("production custody root must be a directory");
  }
  if (typeof process.getuid !== "function" || stats.uid !== process.getuid()) {
    refuse("production custody root must be owned by the current process user");
  }
  if ((stats.mode & 0o077) !== 0 || (stats.mode & 0o700) !== 0o700) {
    refuse("production custody root must be a private current-user directory with mode 0700");
  }
}

function openProductionCustodyRootDescriptor(custodyRoot: string): number {
  const noFollow = fs.constants.O_NOFOLLOW;
  const directoryOnly = fs.constants.O_DIRECTORY;
  if (typeof noFollow !== "number" || typeof directoryOnly !== "number") {
    refuse("production custody root cannot be opened without following links on this platform");
  }
  assertContainedPosition("custody root", custodyRoot);
  let descriptor: number;
  try {
    descriptor = fs.openSync(custodyRoot, fs.constants.O_RDONLY | noFollow | directoryOnly);
  } catch {
    refuse("production custody root must be an existing readable directory");
  }
  return descriptor;
}

function verifyProductionCustodyRoot(custodyRoot: string): void {
  const descriptor = openProductionCustodyRootDescriptor(custodyRoot);
  let operationError: unknown;
  try {
    let stats: fs.Stats;
    try {
      stats = fs.fstatSync(descriptor);
    } catch {
      refuse("production custody root descriptor cannot be verified");
    }
    assertProductionCustodyRootStats(stats);
  } catch (error) {
    operationError = error;
  }
  let closeFailed = false;
  try {
    fs.closeSync(descriptor);
  } catch {
    closeFailed = true;
  }
  if (operationError !== undefined) throw operationError;
  if (closeFailed) refuse("production custody root descriptor could not be closed");
}

function assertProductionPositionsWithinCustodyRoot(
  custodyRoot: string,
  positions: readonly string[],
): void {
  for (const position of positions) {
    const relative = path.relative(custodyRoot, position);
    if (
      relative.length === 0 ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      refuse("production material, registry, output, and lock positions must remain strictly beneath the custody root");
    }
  }
}

function assertPrivateProductionCustodyDirectories(
  custodyRoot: string,
  positions: readonly string[],
): void {
  const visited = new Set<string>();
  for (const position of positions) {
    let directory = path.dirname(position);
    for (;;) {
      if (!visited.has(directory)) {
        visited.add(directory);
        let stats: fs.Stats;
        try {
          stats = fs.lstatSync(directory);
        } catch {
          refuse("every production custody path must have an existing private parent directory");
        }
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          refuse("every production custody path parent must be a real directory, never a redirect");
        }
        if (typeof process.getuid !== "function" || stats.uid !== process.getuid()) {
          refuse("every production custody directory must be owned by the current process user");
        }
        if ((stats.mode & 0o077) !== 0 || (stats.mode & 0o700) !== 0o700) {
          refuse("every production custody directory must be private with mode 0700");
        }
        assertContainedPosition("production custody directory", directory);
      }
      if (directory === custodyRoot) break;
      const parent = path.dirname(directory);
      if (parent === directory) {
        refuse("production custody path did not terminate at the declared custody root");
      }
      directory = parent;
    }
  }
}

function assertProductionCustodyLockAvailable(custodyRoot: string): void {
  const custodyLockPath = custodyLockPathFor(custodyRoot);
  try {
    fs.lstatSync(custodyLockPath);
    refuse("production custody root lock is held — another custody signer may be active");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

interface ProductionCustodyLease {
  readonly rootPath: string;
  readonly rootDescriptor: number;
  readonly rootDevice: number;
  readonly rootInode: number;
  readonly lockPath: string;
  readonly lockDescriptor: number;
}

function acquireProductionCustodyLease(custodyRoot: string): ProductionCustodyLease {
  const custodyLockPath = custodyLockPathFor(custodyRoot);
  const rootDescriptor = openProductionCustodyRootDescriptor(custodyRoot);
  let rootStats: fs.Stats;
  try {
    rootStats = fs.fstatSync(rootDescriptor);
    assertProductionCustodyRootStats(rootStats);
  } catch (error) {
    try {
      fs.closeSync(rootDescriptor);
    } catch {
      /* the root-admission error remains primary */
    }
    throw error;
  }
  let lockDescriptor: number;
  try {
    lockDescriptor = fs.openSync(custodyLockPath, "wx", 0o600);
  } catch {
    try {
      fs.closeSync(rootDescriptor);
    } catch {
      /* lock refusal remains primary */
    }
    refuse("production custody root lock is held — another custody signer may be active");
  }
  try {
    fs.writeFileSync(lockDescriptor, `${process.pid}\n`);
    fs.fchmodSync(lockDescriptor, 0o600);
    fs.fsyncSync(lockDescriptor);
  } catch {
    try {
      fs.closeSync(lockDescriptor);
    } catch {
      /* cleanup continues to the lock leaf */
    }
    try {
      fs.unlinkSync(custodyLockPath);
    } catch {
      /* a failed lock acquisition remains a refusal */
    }
    try {
      fs.closeSync(rootDescriptor);
    } catch {
      /* a failed lock acquisition remains a refusal */
    }
    refuse("production custody root lock could not be made durable");
  }
  return {
    rootPath: custodyRoot,
    rootDescriptor,
    rootDevice: rootStats.dev,
    rootInode: rootStats.ino,
    lockPath: custodyLockPath,
    lockDescriptor,
  };
}

function releaseProductionCustodyLease(lease: ProductionCustodyLease): void {
  let revalidationError: unknown;
  let namedRootDescriptor: number | null = null;
  try {
    const heldStats = fs.fstatSync(lease.rootDescriptor);
    assertProductionCustodyRootStats(heldStats);
    try {
      namedRootDescriptor = fs.openSync(
        lease.rootPath,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY,
      );
    } catch {
      refuse("production custody root identity changed while signing");
    }
    const namedStats = fs.fstatSync(namedRootDescriptor);
    assertProductionCustodyRootStats(namedStats);
    if (namedStats.dev !== lease.rootDevice || namedStats.ino !== lease.rootInode) {
      refuse("production custody root identity changed while signing");
    }
  } catch (error) {
    revalidationError = error;
  }
  let namedRootCloseFailed = false;
  if (namedRootDescriptor !== null) {
    try {
      fs.closeSync(namedRootDescriptor);
    } catch {
      namedRootCloseFailed = true;
    }
  }
  let closeFailed = false;
  try {
    fs.closeSync(lease.lockDescriptor);
  } catch {
    closeFailed = true;
  }
  let unlinkFailed = false;
  try {
    fs.unlinkSync(lease.lockPath);
  } catch (error) {
    unlinkFailed = (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
  let rootCloseFailed = false;
  try {
    fs.closeSync(lease.rootDescriptor);
  } catch {
    rootCloseFailed = true;
  }
  if (revalidationError !== undefined) throw revalidationError;
  if (namedRootCloseFailed || closeFailed || unlinkFailed || rootCloseFailed) {
    refuse("production custody root lock could not be released cleanly");
  }
}

function releaseUsedKeyRegistryLock(descriptor: number, registryLockPath: string): void {
  let closeFailed = false;
  try {
    fs.closeSync(descriptor);
  } catch {
    closeFailed = true;
  }
  let unlinkFailed = false;
  try {
    fs.unlinkSync(registryLockPath);
  } catch (error) {
    unlinkFailed = (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
  if (closeFailed || unlinkFailed) {
    refuse("used-key registry lock could not be released cleanly");
  }
}

// ---------------------------------------------------------------------------
// WOTS+/Merkle over the accepted core's exact domain separation
// ---------------------------------------------------------------------------

const HEX_ALPHABET = "0123456789abcdef";

function chainStep(value: string, chain: number, step: number): string {
  return neutralSha256Hex(`${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|F|${chain}|${step}|${value}`);
}

function walkSteps(value: string, chain: number, steps: number): string {
  let current = value;
  for (let at = 0; at < steps; at += 1) current = chainStep(current, chain, at);
  return current;
}

function chainToTip(value: string, chain: number, fromStep: number): string {
  let current = value;
  for (let at = fromStep; at < NEUTRAL_ATTESTATION_CHAIN_LENGTH - 1; at += 1) {
    current = chainStep(current, chain, at);
  }
  return current;
}

function codeWord(message: string): number[] | null {
  if (message.length !== NEUTRAL_ATTESTATION_MESSAGE_CHAINS) return null;
  const symbols: number[] = [];
  let checksum = 0;
  for (let index = 0; index < message.length; index += 1) {
    const symbol = HEX_ALPHABET.indexOf(message.charAt(index));
    if (symbol === -1) return null;
    symbols.push(symbol);
    checksum += NEUTRAL_ATTESTATION_CHAIN_LENGTH - 1 - symbol;
  }
  for (let index = NEUTRAL_ATTESTATION_CHECKSUM_CHAINS - 1; index >= 0; index -= 1) {
    const shift = Math.pow(NEUTRAL_ATTESTATION_CHAIN_LENGTH, index);
    symbols.push(Math.floor(checksum / shift) % NEUTRAL_ATTESTATION_CHAIN_LENGTH);
  }
  return symbols;
}

interface DerivedTree {
  readonly root: string;
  readonly levels: readonly (readonly string[])[];
}

/** Re-derive every leaf public key and the Merkle root from the chain starts. */
function deriveTree(leaves: readonly (readonly string[])[]): DerivedTree {
  let level: string[] = leaves.map((starts, leafIndex) => {
    const tips: string[] = [];
    for (let chain = 0; chain < NEUTRAL_ATTESTATION_CHAINS; chain += 1) {
      tips.push(chainToTip(starts[chain], chain, 0));
    }
    const publicKey = neutralSha256Hex(`${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|PK|${tips.join("|")}`);
    return neutralSha256Hex(`${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|LEAF|${leafIndex}|${publicKey}`);
  });
  const levels: string[][] = [level];
  for (let treeLevel = 0; treeLevel < NEUTRAL_ATTESTATION_TREE_HEIGHT; treeLevel += 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(
        neutralSha256Hex(
          `${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|NODE|${treeLevel}|${level[index]}|${level[index + 1]}`
        )
      );
    }
    levels.push(next);
    level = next;
  }
  return { root: level[0], levels };
}

function authPath(tree: DerivedTree, keyIndex: number): string[] {
  const nodes: string[] = [];
  let index = keyIndex;
  for (let level = 0; level < NEUTRAL_ATTESTATION_TREE_HEIGHT; level += 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    nodes.push(tree.levels[level][siblingIndex]);
    index = Math.floor(index / 2);
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Material admission
// ---------------------------------------------------------------------------

interface AdmittedMaterial {
  readonly attestor_id: string;
  readonly verification_root: string;
  readonly key_index: number;
  readonly leaves: readonly (readonly string[])[];
}

function verifySigningMaterialProtection(stats: fs.Stats, mode: string): void {
  if (!stats.isFile()) {
    refuse("signing material must be a regular file");
  }
  if (mode !== "production") return;
  if (typeof process.getuid !== "function") {
    refuse("production signing material owner cannot be verified on this platform");
  }
  if (stats.uid !== process.getuid()) {
    refuse("production signing material must be owned by the current process user");
  }
  if ((stats.mode & 0o077) !== 0) {
    refuse("production signing material must use a private file mode with no group or other permissions");
  }
}

function readSigningMaterialText(materialPath: string, mode: string): string {
  const noFollow = fs.constants.O_NOFOLLOW;
  if (mode === "production" && typeof noFollow !== "number") {
    refuse("production signing material cannot be opened with O_NOFOLLOW on this platform");
  }

  let descriptor: number;
  try {
    descriptor = fs.openSync(
      materialPath,
      fs.constants.O_RDONLY | (typeof noFollow === "number" ? noFollow : 0)
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") {
      refuse("signing material position is a symlink — refusing a redirected position");
    }
    refuse("signing material is not readable");
  }

  let text: string | undefined;
  let operationError: unknown;
  try {
    let opened: fs.Stats;
    try {
      opened = fs.fstatSync(descriptor);
    } catch {
      refuse("signing material descriptor cannot be verified");
    }
    verifySigningMaterialProtection(opened, mode);

    try {
      text = fs.readFileSync(descriptor, "utf8");
    } catch {
      refuse("signing material is not readable");
    }

    let afterRead: fs.Stats;
    try {
      afterRead = fs.fstatSync(descriptor);
    } catch {
      refuse("signing material descriptor cannot be reverified after reading");
    }
    verifySigningMaterialProtection(afterRead, mode);

    // The descriptor fixes the bytes we consumed. Rechecking containment and
    // reopening the named leaf with O_NOFOLLOW proves that the leaf resolved
    // through the current parent chain is still a non-link naming the same
    // inode. It deliberately does not claim atomic ancestor-directory binding;
    // production custody must provide that boundary before real material is
    // admitted. A following stat would admit a leaf symlink to the already-
    // opened inode and is therefore intentionally not used.
    assertContainedPosition("material", materialPath);
    let namedDescriptor: number;
    try {
      namedDescriptor = fs.openSync(
        materialPath,
        fs.constants.O_RDONLY | (typeof noFollow === "number" ? noFollow : 0)
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ELOOP") {
        refuse("signing material position became a symlink while it was being read");
      }
      refuse("signing material position changed while it was being read");
    }

    let namedError: unknown;
    try {
      let named: fs.Stats;
      try {
        named = fs.fstatSync(namedDescriptor);
      } catch {
        refuse("signing material position cannot be verified after reading");
      }
      verifySigningMaterialProtection(named, mode);
      if (named.dev !== opened.dev || named.ino !== opened.ino) {
        refuse("signing material identity changed while it was being read");
      }
    } catch (error) {
      namedError = error;
    }
    let namedCloseFailed = false;
    try {
      fs.closeSync(namedDescriptor);
    } catch {
      namedCloseFailed = true;
    }
    if (namedError !== undefined) throw namedError;
    if (namedCloseFailed) {
      refuse("signing material verification descriptor could not be closed");
    }
  } catch (error) {
    operationError = error;
  }

  let closeFailed = false;
  try {
    fs.closeSync(descriptor);
  } catch {
    closeFailed = true;
  }
  if (operationError !== undefined) throw operationError;
  if (closeFailed) {
    refuse("signing material descriptor could not be closed");
  }
  return text as string;
}

function admitMaterial(materialPath: string, mode: string): AdmittedMaterial {
  const text = readSigningMaterialText(materialPath, mode);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    refuse("signing material is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    refuse("signing material must be a single JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const expectedSchema =
    mode === "production" ? SIGNER_PRODUCTION_MATERIAL_SCHEMA : SIGNER_FIXTURE_MATERIAL_SCHEMA;
  if (record.schema_version !== expectedSchema) {
    refuse(`signing material does not declare the required ${expectedSchema} schema`);
  }
  const attestorId = record.attestor_id;
  if (typeof attestorId !== "string" || attestorId.length === 0) {
    refuse("signing material names no attestor");
  }
  const declaredRoot = record.verification_root;
  if (typeof declaredRoot !== "string" || !HEX64_PATTERN.test(declaredRoot)) {
    refuse("signing material declares no well-formed verification root");
  }
  if (
    record.chain_length !== NEUTRAL_ATTESTATION_CHAIN_LENGTH ||
    record.message_chains !== NEUTRAL_ATTESTATION_MESSAGE_CHAINS ||
    record.checksum_chains !== NEUTRAL_ATTESTATION_CHECKSUM_CHAINS ||
    record.tree_height !== NEUTRAL_ATTESTATION_TREE_HEIGHT
  ) {
    refuse("signing material declares dimensions the pinned scheme does not use");
  }
  const leafCount = Math.pow(2, NEUTRAL_ATTESTATION_TREE_HEIGHT);
  const keyIndex = record.key_index;
  if (typeof keyIndex !== "number" || !Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= leafCount) {
    refuse("signing material names no admissible key index");
  }
  const leaves = record.leaves;
  if (!Array.isArray(leaves) || leaves.length !== leafCount) {
    refuse("signing material does not carry the full leaf set");
  }
  const admittedLeaves: (readonly string[])[] = [];
  for (const leaf of leaves) {
    if (leaf === null || typeof leaf !== "object" || Array.isArray(leaf)) {
      refuse("signing material carries a malformed leaf");
    }
    const starts = (leaf as Record<string, unknown>).private_seeds;
    if (!Array.isArray(starts) || starts.length !== NEUTRAL_ATTESTATION_CHAINS) {
      refuse("signing material carries a leaf without a complete chain-start set");
    }
    for (const start of starts) {
      if (typeof start !== "string" || !HEX64_PATTERN.test(start)) {
        refuse("signing material carries a malformed chain start");
      }
    }
    admittedLeaves.push(starts as string[]);
  }
  return {
    attestor_id: attestorId,
    verification_root: declaredRoot,
    key_index: keyIndex,
    leaves: admittedLeaves,
  };
}

// ---------------------------------------------------------------------------
// Durable writes — atomic, 0600, hex-safe encoding for the signature output
// ---------------------------------------------------------------------------

/**
 * Serialize with every string rendered as pure `\uXXXX` escapes. `JSON.parse`
 * recovers the exact value; the file bytes contain no hex substring of any
 * chain-derived value. See the header's non-leakage note for why this matters
 * for a WOTS+ signature specifically.
 */
function hexSafeJson(value: unknown): string {
  if (typeof value === "string") {
    let escaped = '"';
    for (let index = 0; index < value.length; index += 1) {
      escaped += `\\u${value.charCodeAt(index).toString(16).padStart(4, "0")}`;
    }
    return `${escaped}"`;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(hexSafeJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) continue;
    parts.push(`${hexSafeJson(key)}:${hexSafeJson(record[key])}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * Write atomically (same-directory temp + rename), force mode 0600, and make
 * the published directory entry crash-durable before returning. The held
 * directory descriptor ensures the fsync targets the directory in which the
 * temp file was staged, even if its pathname is renamed after admission.
 */
function writeAtomic0600(finalPath: string, text: string): void {
  const directory = path.dirname(finalPath);
  const tempPath = path.join(directory, `.${path.basename(finalPath)}.${process.pid}.tmp`);
  const directoryFlags =
    fs.constants.O_RDONLY |
    (fs.constants.O_DIRECTORY ?? 0) |
    (fs.constants.O_NOFOLLOW ?? 0);
  let directoryDescriptor: number | undefined;
  try {
    directoryDescriptor = fs.openSync(directory, directoryFlags);
    if (!fs.fstatSync(directoryDescriptor).isDirectory()) {
      refuse(`durable-write parent for ${path.basename(finalPath)} is not a directory`);
    }
  } catch (error) {
    if (directoryDescriptor !== undefined) {
      try {
        fs.closeSync(directoryDescriptor);
      } catch {
        /* the admission refusal below remains authoritative */
      }
    }
    refuse(`cannot bind durable-write parent for ${path.basename(finalPath)}: ${(error as Error).message}`);
  }

  try {
    let descriptor: number;
    try {
      descriptor = fs.openSync(tempPath, "wx", 0o600);
    } catch (error) {
      refuse(`cannot stage a durable write beside ${path.basename(finalPath)}: ${(error as Error).message}`);
    }
    try {
      fs.writeFileSync(descriptor, text);
      fs.fchmodSync(descriptor, 0o600);
      fs.fsyncSync(descriptor);
    } catch (error) {
      fs.closeSync(descriptor);
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* the staged temp is already gone */
      }
      refuse(`durable write failed for ${path.basename(finalPath)}: ${(error as Error).message}`);
    }
    fs.closeSync(descriptor);
    try {
      fs.renameSync(tempPath, finalPath);
    } catch (error) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* the staged temp is already gone */
      }
      refuse(`durable publish failed for ${path.basename(finalPath)}: ${(error as Error).message}`);
    }
    try {
      fs.fsyncSync(directoryDescriptor);
    } catch (error) {
      refuse(`durable directory publish failed for ${path.basename(finalPath)}: ${(error as Error).message}`);
    }
  } finally {
    try {
      fs.closeSync(directoryDescriptor);
    } catch (error) {
      refuse(`durable-write parent descriptor did not close cleanly for ${path.basename(finalPath)}: ${(error as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// The signer
// ---------------------------------------------------------------------------

/**
 * Does this public authority exactly match one distinct journal-attestor root
 * pinned by the production decision core? This is intentionally a two-argument
 * predicate, not an override channel: callers can query the source-owned trust
 * decision but cannot add to it. Principal separation is external custody of
 * each material/registry pair; the audited signing algorithm is shared.
 */
export function productionAttestorAuthorityRecognized(
  attestorId: unknown,
  verificationRoot: unknown
): boolean {
  if (typeof attestorId !== "string" || typeof verificationRoot !== "string") return false;
  const pinned = neutralAttestorVerificationKey(attestorId);
  return pinned !== null && pinned === verificationRoot;
}

interface ExternalSignatureFields {
  readonly attestor_id: string;
  readonly verification_root: string;
  readonly key_index: number;
  readonly digest: string;
  readonly signature: string;
  readonly mode: string;
}

interface ExternalSigningContract<TOutput extends object> {
  readonly digest_pattern: RegExp;
  readonly digest_refusal: string;
  readonly authority_recognized: (attestorId: string, verificationRoot: string) => boolean;
  readonly authority_refusal: string;
  readonly build_output: (fields: ExternalSignatureFields) => TOutput;
}

function signExternalAttestation<TOutput extends object>(
  options: unknown,
  contract: ExternalSigningContract<TOutput>
): TOutput {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    refuse("options must be a single plain object");
  }
  const record = options as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (OPTION_KEYS.indexOf(key) === -1) {
      refuse(
        `option ${JSON.stringify(key)} is outside the closed vocabulary — trust roots and signing scope are never caller-supplied`
      );
    }
  }
  for (const key of REQUIRED_OPTION_KEYS) {
    if (typeof record[key] !== "string" || (record[key] as string).length === 0) {
      refuse(`option ${key} must be a non-empty string`);
    }
  }
  const opts = record as unknown as SignReleaseAttestationOptions;
  if (SIGNER_MODES.indexOf(opts.mode as never) === -1) {
    refuse("mode must be one of the closed signing modes");
  }
  if (
    opts.mode === "production" &&
    (typeof opts.custody_root_path !== "string" || opts.custody_root_path.length === 0)
  ) {
    refuse("production mode requires a non-empty custody_root_path");
  }
  if (!contract.digest_pattern.test(opts.digest)) {
    refuse(contract.digest_refusal);
  }

  const registryPath = path.resolve(opts.used_key_registry_path);
  const outputPath = path.resolve(opts.output_path);
  const materialPath = path.resolve(opts.material_path);
  const lockPath = lockPathFor(registryPath);
  let custodyRoot: string | null = null;
  let custodyLeaseLockPath: string | null = null;
  if (opts.mode === "production") {
    custodyRoot = path.resolve(opts.custody_root_path as string);
    custodyLeaseLockPath = custodyLockPathFor(custodyRoot);
    verifyProductionCustodyRoot(custodyRoot);
    if (path.dirname(materialPath) !== custodyRoot) {
      refuse("production signing material must be a direct child of its canonical custody root");
    }
    if (registryPath !== productionRegistryPathFor(custodyRoot)) {
      refuse("production used-key registry must use the deterministic custody-root registry path");
    }
    assertProductionPositionsWithinCustodyRoot(custodyRoot, [
      materialPath,
      registryPath,
      outputPath,
      lockPath,
      custodyLeaseLockPath,
    ]);
    assertPrivateProductionCustodyDirectories(custodyRoot, [
      materialPath,
      registryPath,
      outputPath,
      lockPath,
      custodyLeaseLockPath,
    ]);
    assertProductionCustodyLockAvailable(custodyRoot);
  }

  // Every durable role must occupy a distinct resolved path. In particular,
  // publishing an attestation over the used-key registry would erase the
  // reservation that makes the one-time signature safe to use. Keeping the
  // material and lock positions distinct also prevents a successful signing
  // operation from corrupting its own inputs or synchronization primitive.
  const durablePositions = [materialPath, registryPath, outputPath, lockPath];
  if (custodyLeaseLockPath !== null) durablePositions.push(custodyLeaseLockPath);
  if (new Set(durablePositions).size !== durablePositions.length) {
    refuse("material, used-key registry, output, registry lock, and custody lock paths must resolve to distinct positions");
  }

  // Containment before any byte is read or written: leaf symlinks and
  // intermediate-parent escapes are refusals for every position, including the
  // deterministic lock position itself.
  assertContainedPosition("material", materialPath);
  assertContainedPosition("used-key registry", registryPath);
  assertContainedPosition("output", outputPath);
  let lockLeaf: fs.Stats | null = null;
  try {
    lockLeaf = fs.lstatSync(lockPath);
  } catch {
    lockLeaf = null;
  }
  if (lockLeaf !== null && lockLeaf.isSymbolicLink()) {
    refuse("lock position is a symlink — refusing a redirected lock");
  }

  const custodyLease = custodyRoot === null ? null : acquireProductionCustodyLease(custodyRoot);
  try {
    // Admit and PROVE the material: the declared root must be re-derivable from
    // the supplied chain starts through the full construction.
    const material = admitMaterial(materialPath, opts.mode);
    const tree = deriveTree(material.leaves);
    if (tree.root !== material.verification_root) {
      refuse("signing material does not derive its declared verification root");
    }
    if (
      opts.mode === "production" &&
      !contract.authority_recognized(material.attestor_id, material.verification_root)
    ) {
      refuse(contract.authority_refusal);
    }

    // Exclusive lock at exactly `<registry>.lock`. A held lock is an immediate
    // refusal, never a wait: two concurrent signers racing one registry must
    // resolve to exactly one winner.
    let lockDescriptor: number;
    try {
      lockDescriptor = fs.openSync(lockPath, "wx", 0o600);
    } catch {
      refuse("used-key registry lock is held — a concurrent signing is in progress, refusing");
    }

    try {
      // Read the durable registry under the lock.
      let registryText: string | null = null;
      try {
        registryText = fs.readFileSync(registryPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          refuse(`used-key registry is unreadable: ${(error as Error).message}`);
        }
      }

      let usedTokens: string[] = [];
      if (registryText !== null) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(registryText);
        } catch (error) {
          refuse(`used-key registry is unreadable: ${(error as Error).message}`);
        }
        if (
          parsed === null ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          (parsed as Record<string, unknown>).schema_version !== SIGNER_REGISTRY_SCHEMA ||
          !Array.isArray((parsed as Record<string, unknown>).used_keys) ||
          !(parsed as Record<string, unknown[]>).used_keys.every(
            (token) => typeof token === "string" && token.length > 0
          )
        ) {
          refuse(
            `used-key registry must be ${SIGNER_REGISTRY_SCHEMA} with a complete non-empty-string used_keys array`
          );
        }
        usedTokens = [...((parsed as { used_keys: string[] }).used_keys)];
      }

      const token = `${material.attestor_id}|${material.verification_root}|${material.key_index}`;
      if (usedTokens.indexOf(token) !== -1) {
        refuse(
          `one-time key ${material.key_index} for this attestor and root is already reserved/consumed — refusing reuse`
        );
      }

      // RESERVE BEFORE PUBLISHING. The reservation is durable the moment the
      // registry renames into place; an output failure after this point leaves
      // the key consumed, which is the safe direction.
      usedTokens.push(token);
      writeAtomic0600(
        registryPath,
        `${JSON.stringify({ schema_version: SIGNER_REGISTRY_SCHEMA, used_keys: usedTokens }, null, 2)}\n`
      );

      // Sign, then self-verify against the REAL accepted verifier before
      // anything is published.
      const symbols = codeWord(
        neutralSha256Hex(
          `${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|M|${tree.root}|${material.key_index}|${opts.digest}`
        )
      );
      if (symbols === null) {
        refuse("digest does not reduce to a signable code word");
      }
      const starts = material.leaves[material.key_index];
      const revealed = symbols.map((symbol, chain) => walkSteps(starts[chain], chain, symbol));
      const keyIndexHex = material.key_index.toString(16).padStart(2, "0");
      const signature = `nws1:${keyIndexHex}:${revealed.join("")}:${authPath(tree, material.key_index).join("")}`;
      if (!neutralVerifyAttestationSignature(tree.root, opts.digest, signature)) {
        refuse("produced signature does not verify against the accepted core verifier");
      }

      const output = contract.build_output({
        attestor_id: material.attestor_id,
        verification_root: tree.root,
        key_index: material.key_index,
        digest: opts.digest,
        signature,
        mode: opts.mode,
      });
      writeAtomic0600(outputPath, `${hexSafeJson(output)}\n`);
      return Object.freeze(output);
    } finally {
      releaseUsedKeyRegistryLock(lockDescriptor, lockPath);
    }
  } finally {
    if (custodyLease !== null) releaseProductionCustodyLease(custodyLease);
  }
}

export function signReleaseAttestation(options: unknown): SignReleaseAttestationOutput {
  return signExternalAttestation(options, {
    digest_pattern: DIGEST_PATTERN,
    digest_refusal: "digest must be a canonical nad1 attestation digest",
    authority_recognized: productionAttestorAuthorityRecognized,
    authority_refusal: "production signing material does not match the source-pinned authority for its attestor",
    build_output: (fields) => ({
      schema_version: SIGNER_OUTPUT_SCHEMA,
      scheme: NEUTRAL_ATTESTATION_SCHEME,
      attestor_id: fields.attestor_id,
      verification_root: fields.verification_root,
      key_index: fields.key_index,
      digest: fields.digest,
      signature: fields.signature,
      mode: fields.mode,
    }),
  });
}

export function signRootAdmissionProof(options: unknown): RootAdmissionProof {
  const record = closedRecord(options, "root-admission proof options", [
    "candidate_manifest",
    "material_path",
    "output_path",
    "used_key_registry_path",
    "custody_root_path",
  ]);
  for (const key of [
    "material_path",
    "output_path",
    "used_key_registry_path",
    "custody_root_path",
  ]) {
    if (typeof record[key] !== "string" || (record[key] as string).length === 0) {
      refuse(`root-admission proof option ${key} must be a non-empty string`);
    }
  }
  const manifest = validateRootAdmissionCandidateManifest(record.candidate_manifest);
  const manifestDigest = rootAdmissionManifestDigest(manifest);
  const candidates = new Map(
    manifest.candidates.map((candidate) => [candidate.attestor_id, candidate.verification_root])
  );

  return signExternalAttestation(
    {
      material_path: record.material_path,
      digest: manifestDigest,
      output_path: record.output_path,
      mode: "production",
      used_key_registry_path: record.used_key_registry_path,
      custody_root_path: record.custody_root_path,
    },
    {
      digest_pattern: ROOT_ADMISSION_DIGEST_PATTERN,
      digest_refusal: "root-admission digest must be a canonical nra1 manifest digest",
      authority_recognized: (attestorId, verificationRoot) =>
        candidates.get(attestorId) === verificationRoot,
      authority_refusal: "root-admission signing material does not match its candidate manifest root",
      build_output: (fields): RootAdmissionProof => ({
        schema_version: ROOT_ADMISSION_PROOF_SCHEMA,
        scheme: NEUTRAL_ATTESTATION_SCHEME,
        rotation_id: manifest.rotation_id,
        manifest_digest: fields.digest,
        attestor_id: fields.attestor_id,
        verification_root: fields.verification_root,
        key_index: fields.key_index,
        signature: fields.signature,
        mode: "production",
        external_custody_verified: false,
        authorizes_rotation: false,
      }),
    }
  );
}

function validateRootAdmissionProof(
  value: unknown,
  manifest: RootAdmissionCandidateManifest,
  manifestDigest: string
): RootAdmissionProof {
  const proof = closedRecord(value, "root-admission possession proof", [
    "schema_version",
    "scheme",
    "rotation_id",
    "manifest_digest",
    "attestor_id",
    "verification_root",
    "key_index",
    "signature",
    "mode",
    "external_custody_verified",
    "authorizes_rotation",
  ]);
  if (proof.schema_version !== ROOT_ADMISSION_PROOF_SCHEMA) {
    refuse(`root-admission possession proof must declare ${ROOT_ADMISSION_PROOF_SCHEMA}`);
  }
  if (proof.scheme !== NEUTRAL_ATTESTATION_SCHEME || proof.mode !== "production") {
    refuse("root-admission possession proof must use the production WOTS/Merkle signing path");
  }
  if (proof.rotation_id !== manifest.rotation_id || proof.manifest_digest !== manifestDigest) {
    refuse("root-admission possession proof is bound to a different candidate manifest");
  }
  if (proof.external_custody_verified !== false || proof.authorizes_rotation !== false) {
    refuse("root-admission possession proof cannot claim custody or authorize rotation");
  }
  if (typeof proof.attestor_id !== "string" || typeof proof.verification_root !== "string") {
    refuse("root-admission possession proof names no candidate authority");
  }
  const candidate = manifest.candidates.find((entry) => entry.attestor_id === proof.attestor_id);
  if (candidate === undefined || candidate.verification_root !== proof.verification_root) {
    refuse("root-admission possession proof does not match a candidate root");
  }
  const leafCount = Math.pow(2, NEUTRAL_ATTESTATION_TREE_HEIGHT);
  if (
    typeof proof.key_index !== "number" ||
    !Number.isInteger(proof.key_index) ||
    proof.key_index < 0 ||
    proof.key_index >= leafCount
  ) {
    refuse("root-admission possession proof names no admissible key index");
  }
  if (typeof proof.signature !== "string") {
    refuse("root-admission possession proof carries no signature");
  }
  const signatureIndex = /^nws1:([0-9a-f]{2}):/.exec(proof.signature);
  if (signatureIndex === null || parseInt(signatureIndex[1], 16) !== proof.key_index) {
    refuse("root-admission possession proof key index does not match its signature");
  }
  if (!neutralVerifyAttestationSignature(proof.verification_root, manifestDigest, proof.signature)) {
    refuse("root-admission possession proof signature does not verify");
  }

  return Object.freeze({
    schema_version: ROOT_ADMISSION_PROOF_SCHEMA,
    scheme: NEUTRAL_ATTESTATION_SCHEME,
    rotation_id: manifest.rotation_id,
    manifest_digest: manifestDigest,
    attestor_id: proof.attestor_id,
    verification_root: proof.verification_root,
    key_index: proof.key_index,
    signature: proof.signature,
    mode: "production",
    external_custody_verified: false,
    authorizes_rotation: false,
  });
}

export function verifyRootAdmissionBundle(
  candidateManifest: unknown,
  possessionProofs: unknown
): RootAdmissionBundle {
  const manifest = validateRootAdmissionCandidateManifest(candidateManifest);
  const manifestDigest = rootAdmissionManifestDigest(manifest);
  if (!Array.isArray(possessionProofs) || possessionProofs.length !== manifest.candidates.length) {
    refuse(`root-admission requires one complete set of exactly ${manifest.candidates.length} possession proofs`);
  }
  const proofs = possessionProofs.map((proof) =>
    validateRootAdmissionProof(proof, manifest, manifestDigest)
  );
  const ids = proofs.map((proof) => proof.attestor_id);
  if (new Set(ids).size !== ids.length) {
    refuse("root-admission possession proofs must come from distinct candidate attestors");
  }
  for (const candidate of manifest.candidates) {
    if (!proofs.some((proof) => proof.attestor_id === candidate.attestor_id)) {
      refuse(`root-admission is missing the possession proof for ${candidate.attestor_id}`);
    }
  }

  return Object.freeze({
    schema_version: ROOT_ADMISSION_BUNDLE_SCHEMA,
    candidate_manifest: manifest,
    manifest_digest: manifestDigest,
    proofs: Object.freeze(proofs),
    candidate_root_possession_verified: true,
    external_custody_verified: false,
    authorizes_rotation: false,
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const CLI_FLAGS: Readonly<Record<string, keyof SignReleaseAttestationOptions>> = Object.freeze({
  "--material-path": "material_path",
  "--digest": "digest",
  "--output-path": "output_path",
  "--mode": "mode",
  "--used-key-registry-path": "used_key_registry_path",
  "--custody-root-path": "custody_root_path",
});

const USAGE =
  "usage: sign-release-attestation.ts --material-path <p> --digest <nad1:…> " +
  "--output-path <p> --mode <fixture|production> --used-key-registry-path <p> " +
  "[--custody-root-path <p>]\n" +
  "       sign-release-attestation.ts root-admission-prove " +
  "--candidate-manifest-path <p> --material-path <p> --output-path <p> " +
  "--used-key-registry-path <p> --custody-root-path <p>\n" +
  "       sign-release-attestation.ts root-admission-verify " +
  "--candidate-manifest-path <p> --proof-a-path <p> --proof-b-path <p> " +
  "--proof-c-path <p> --output-path <p>\n";

function parseClosedCliFlags(
  argv: readonly string[],
  flags: Readonly<Record<string, string>>,
  action: string
): Record<string, string> {
  if (argv.length === 0 || argv.length % 2 !== 0) {
    refuse(`${action} requires complete flag/value pairs`);
  }
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    const key = flags[flag];
    if (key === undefined || value === undefined || value.length === 0 || parsed[key] !== undefined) {
      refuse(`${action} received an unrecognized, duplicate, or incomplete flag ${flag}`);
    }
    parsed[key] = value;
  }
  for (const required of Object.values(flags)) {
    if (parsed[required] === undefined) refuse(`${action} requires ${required}`);
  }
  return parsed;
}

function readPublicJsonFile(label: string, filePath: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(path.resolve(filePath), "utf8");
  } catch (error) {
    refuse(`${label} is unreadable: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    refuse(`${label} is not valid JSON: ${(error as Error).message}`);
  }
}

function runRootAdmissionProveCli(argv: readonly string[]): number {
  const parsed = parseClosedCliFlags(
    argv,
    {
      "--candidate-manifest-path": "candidate_manifest_path",
      "--material-path": "material_path",
      "--output-path": "output_path",
      "--used-key-registry-path": "used_key_registry_path",
      "--custody-root-path": "custody_root_path",
    },
    "root-admission-prove"
  );
  const candidateManifestPath = path.resolve(parsed.candidate_manifest_path);
  const materialPath = path.resolve(parsed.material_path);
  const outputPath = path.resolve(parsed.output_path);
  const registryPath = path.resolve(parsed.used_key_registry_path);
  const custodyRoot = path.resolve(parsed.custody_root_path);
  const positions = [
    candidateManifestPath,
    materialPath,
    outputPath,
    registryPath,
    lockPathFor(registryPath),
    custodyLockPathFor(custodyRoot),
  ];
  if (new Set(positions).size !== positions.length) {
    refuse(
      "root-admission candidate manifest, material, proof output, registry, registry lock, and custody lock must use distinct paths"
    );
  }
  assertContainedPosition("root-admission candidate manifest", candidateManifestPath);
  const proof = signRootAdmissionProof({
    candidate_manifest: readPublicJsonFile("root-admission candidate manifest", candidateManifestPath),
    material_path: materialPath,
    output_path: outputPath,
    used_key_registry_path: registryPath,
    custody_root_path: custodyRoot,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        schema_version: proof.schema_version,
        rotation_id: proof.rotation_id,
        manifest_digest: proof.manifest_digest,
        attestor_id: proof.attestor_id,
        verification_root: proof.verification_root,
        key_index: proof.key_index,
        external_custody_verified: false,
        authorizes_rotation: false,
      },
      null,
      2
    )}\n`
  );
  return 0;
}

function runRootAdmissionVerifyCli(argv: readonly string[]): number {
  const parsed = parseClosedCliFlags(
    argv,
    {
      "--candidate-manifest-path": "candidate_manifest_path",
      "--proof-a-path": "proof_a_path",
      "--proof-b-path": "proof_b_path",
      "--proof-c-path": "proof_c_path",
      "--output-path": "output_path",
    },
    "root-admission-verify"
  );
  const inputPaths = [
    parsed.candidate_manifest_path,
    parsed.proof_a_path,
    parsed.proof_b_path,
    parsed.proof_c_path,
  ].map((entry) => path.resolve(entry));
  const outputPath = path.resolve(parsed.output_path);
  if (new Set([...inputPaths, outputPath]).size !== inputPaths.length + 1) {
    refuse("root-admission verification inputs and output must use distinct paths");
  }
  for (const inputPath of inputPaths) assertContainedPosition("root-admission input", inputPath);
  assertContainedPosition("root-admission output", outputPath);
  const manifest = readPublicJsonFile("root-admission candidate manifest", inputPaths[0]);
  const proofs = inputPaths.slice(1).map((proofPath, index) =>
    readPublicJsonFile(`root-admission possession proof ${index + 1}`, proofPath)
  );
  const bundle = verifyRootAdmissionBundle(manifest, proofs);
  writeAtomic0600(outputPath, `${JSON.stringify(bundle, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        schema_version: bundle.schema_version,
        manifest_digest: bundle.manifest_digest,
        candidate_root_possession_verified: true,
        external_custody_verified: false,
        authorizes_rotation: false,
      },
      null,
      2
    )}\n`
  );
  return 0;
}

export function runSignerCli(argv: readonly string[]): number {
  try {
    if (argv[0] === "root-admission-prove") return runRootAdmissionProveCli(argv.slice(1));
    if (argv[0] === "root-admission-verify") return runRootAdmissionVerifyCli(argv.slice(1));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n${USAGE}`);
    return 1;
  }
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    const key = CLI_FLAGS[flag];
    if (key === undefined || value === undefined) {
      process.stderr.write(`sign-release-attestation: unrecognized or incomplete flag ${flag}\n${USAGE}`);
      return 1;
    }
    options[key] = value;
  }
  try {
    const output = signReleaseAttestation(options);
    process.stdout.write(
      `${JSON.stringify(
        {
          schema_version: output.schema_version,
          attestor_id: output.attestor_id,
          verification_root: output.verification_root,
          key_index: output.key_index,
          mode: output.mode,
        },
        null,
        2
      )}\n`
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(runSignerCli(process.argv.slice(2)));
}
