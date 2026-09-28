/**
 * Backward-compatible public entrypoint.
 *
 * guild.session_context.v1 (immutable per-run identity) lives in
 * src/modules/host-runtime so the reorg can move internals without breaking
 * imports from scripts/lib/*.
 */
export {
  buildSessionContext,
  makeFingerprint,
  loadOrCreateFingerprintSalt,
  sessionContextPath,
  writeSessionContext,
  loadSessionContext,
  restoreSessionContext,
  type SessionHostFamily,
  type HostSurface,
  type IdentitySource,
  type IdentityTrust,
  type IdentityConfidence,
  type TargetProviderKind,
  type AuthMode,
  type SessionHostBlock,
  type SessionIdentityBlock,
  type ExecutionTargetBlock,
  type GuildSessionContextV1,
  type NativeAdapterIdentity,
  type HostHandshakeIdentity,
  type BuildSessionContextInput,
  type SessionContextFs,
} from "../../src/domains/config/index";
export { type RunBindingRecord } from "../../src/domains/lifecycle/index";
