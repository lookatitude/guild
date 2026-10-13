# FU04 trust-root rotation — custody record

- **Rotation id:** `fu04-rotation-20261013`
- **Generation host:** the operator's macOS workstation (Darwin, `/Users/miguelp`), 2026-10-13.
- **Generator:** one-off script kept off-repository under the operator's custody root (`~/.guild-attestor/tools/`). It derives roots with the exact `scripts/sign-release-attestation.ts` `deriveTree`/`chainToTip` construction and, before drawing any production seed, round-trips a deterministic mh09-style fixture tree through the real signer (fixture mode), which independently re-derives the declared root and self-verifies against the accepted core verifier. Sanity result: PASS (round-trip root `0d7687e84c95c28345a6d244822558ec8627e8b1addc39923a1a2f11231819c1`).
- **Seeds:** `crypto.randomBytes(32)` per chain start; 16 leaves x 67 chains per attestor.

## Custody deviation (recorded verbatim)

Operator direction (2026-10-13): the operator is the sole external attestor and
directed key generation on this machine. That DEVIATES from PCL-FU-04's "two
independently custodied principals" — record the deviation verbatim in every
custody document; never claim independence or external custody.
`external_custody_verified` and `authorizes_rotation` stay false in every
artifact that carries them (the schema forces this).

## Material locations

Private material (master seeds, per-key material `material-k0.json` /
`material-k1.json`, used-one-time-key registries, admission proofs) lives only
under the operator's custody roots `~/.guild-attestor/<attestor-id>/`
(mode 0700 directories, 0600 files, current-user owned). Nothing private is
committed; this directory carries only the public candidate manifest and the
verified admission bundle.

## Backup statement

No off-host backup exists as of 2026-10-13. The single copy is the operator's
workstation custody root. Loss of that directory forfeits the remaining
one-time keys and forces a fresh FU04-style rotation; it cannot forge or
replay signatures already published.

## Key-index budget and destruction policy

- `key_index 0` per attestor: CONSUMED by the `fu04-rotation-20261013`
  root-admission possession proofs (reserved in each custody root's
  `used-one-time-keys.json`).
- `key_index 1` per attestor: reserved for the v3.0.0 release signatures
  (`--mode production --material-path <custody>/material-k1.json`).
- `key_index 2` and `key_index 3`: CONSUMED regenerating the repo's embedded
  honest-bundle attestation fixtures under the rotated roots (k2 = bundle A
  digests for all three attestors; k3 = bundle B digests for
  guild.release-attestor and guild.host-conformance-witness), signed through
  the production signer so each index signed exactly one message.
- Indices 4–15: unassigned.
- Destruction: a superseded key index (consumed, or retired by a later
  rotation) must never be re-signed; on the next rotation that lands a new
  trust table, the operator deletes the superseded custody roots after the
  release that depends on them ships. The used-key registries are retained
  indefinitely as the consumption record.
