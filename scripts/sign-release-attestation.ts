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
 *   - UNRECOGNIZED PRODUCTION AUTHORITY: production signing accepts only the
 *     dedicated production material schema and only when its re-derived root
 *     equals the source-pinned root for its attestor id. Provisioning remains
 *     outside this repository; no caller-supplied root can extend trust.
 *   - SYMLINKS, at the leaf AND at any intermediate parent, for the material,
 *     registry, output, and lock positions: a link is a redirect wearing the
 *     required name, and a signer that follows one signs into (or reads out of)
 *     a tree nobody audited.
 *   - KEY REUSE: the {attestor_id, verification_root, key_index} tuple is
 *     reserved in the durable used-key registry BEFORE any output exists, under
 *     an exclusive lock at exactly `<registry>.lock`. A reservation survives a
 *     later output failure — a one-time key that MAY have produced a signature
 *     is a consumed key, because "the write failed" is not evidence the
 *     signature never left the process.
 *   - MATERIAL THAT DOES NOT PROVE ITSELF: before signing, the declared
 *     verification root is RE-DERIVED from the supplied chain starts through
 *     the full WOTS+/Merkle construction; material that is well-formed but does
 *     not derive its own declared root is refused.
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
 *     --mode <fixture|production> --used-key-registry-path <p>
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
import { neutralSha256Hex } from "../src/modules/lifecycle/workflows/neutral-runtime-contracts";

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

/** The deterministic lock-path contract: `<registry>.lock`, never anywhere else. */
export function lockPathFor(registryPath: string): string {
  return `${registryPath}.lock`;
}

export interface SignReleaseAttestationOptions {
  readonly material_path: string;
  readonly digest: string;
  readonly output_path: string;
  readonly mode: string;
  readonly used_key_registry_path: string;
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

const OPTION_KEYS: readonly string[] = Object.freeze([
  "material_path",
  "digest",
  "output_path",
  "mode",
  "used_key_registry_path",
]);

const DIGEST_PATTERN = /^nad1:[0-9a-f]{64}$/;
const HEX64_PATTERN = /^[0-9a-f]{64}$/;

function refuse(detail: string): never {
  throw new Error(`sign-release-attestation: ${detail}`);
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

function admitMaterial(materialPath: string, mode: string): AdmittedMaterial {
  let text: string;
  try {
    text = fs.readFileSync(materialPath, "utf8");
  } catch {
    refuse("signing material is not readable");
  }
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

/** Write atomically (same-directory temp + rename) and force mode 0600. */
function writeAtomic0600(finalPath: string, text: string): void {
  const directory = path.dirname(finalPath);
  const tempPath = path.join(directory, `.${path.basename(finalPath)}.${process.pid}.tmp`);
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

export function signReleaseAttestation(options: unknown): SignReleaseAttestationOutput {
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
  for (const key of OPTION_KEYS) {
    if (typeof record[key] !== "string" || (record[key] as string).length === 0) {
      refuse(`option ${key} must be a non-empty string`);
    }
  }
  const opts = record as unknown as SignReleaseAttestationOptions;
  if (SIGNER_MODES.indexOf(opts.mode as never) === -1) {
    refuse("mode must be one of the closed signing modes");
  }
  if (!DIGEST_PATTERN.test(opts.digest)) {
    refuse("digest must be a canonical nad1 attestation digest");
  }

  const registryPath = path.resolve(opts.used_key_registry_path);
  const outputPath = path.resolve(opts.output_path);
  const materialPath = path.resolve(opts.material_path);
  const lockPath = lockPathFor(registryPath);

  // Every durable role must occupy a distinct resolved path. In particular,
  // publishing an attestation over the used-key registry would erase the
  // reservation that makes the one-time signature safe to use. Keeping the
  // material and lock positions distinct also prevents a successful signing
  // operation from corrupting its own inputs or synchronization primitive.
  const durablePositions = [materialPath, registryPath, outputPath, lockPath];
  if (new Set(durablePositions).size !== durablePositions.length) {
    refuse("material, used-key registry, output, and lock paths must resolve to distinct positions");
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

  // Admit and PROVE the material: the declared root must be re-derivable from
  // the supplied chain starts through the full construction.
  const material = admitMaterial(materialPath, opts.mode);
  const tree = deriveTree(material.leaves);
  if (tree.root !== material.verification_root) {
    refuse("signing material does not derive its declared verification root");
  }
  if (
    opts.mode === "production" &&
    !productionAttestorAuthorityRecognized(material.attestor_id, material.verification_root)
  ) {
    refuse(
      "production signing material does not match the source-pinned authority for its attestor"
    );
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

    const output: SignReleaseAttestationOutput = {
      schema_version: SIGNER_OUTPUT_SCHEMA,
      scheme: NEUTRAL_ATTESTATION_SCHEME,
      attestor_id: material.attestor_id,
      verification_root: tree.root,
      key_index: material.key_index,
      digest: opts.digest,
      signature,
      mode: opts.mode,
    };
    writeAtomic0600(outputPath, `${hexSafeJson(output)}\n`);
    return Object.freeze(output);
  } finally {
    fs.closeSync(lockDescriptor);
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* the lock is already gone */
    }
  }
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
});

const USAGE =
  "usage: sign-release-attestation.ts --material-path <p> --digest <nad1:…> " +
  "--output-path <p> --mode <fixture|production> --used-key-registry-path <p>\n";

export function runSignerCli(argv: readonly string[]): number {
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
