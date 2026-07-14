/**
 * src/modules/host-runtime/workflows/host-types.ts
 *
 * Canonical host-type definitions for the host-adapter contract.
 * Owned by plugin-architect; consumed by everything else.
 *
 * Phase-1 dispatch Wave-1 (2026-05-28) — see
 * .guild/initiatives/active/phase-1-dispatch/ for context.
 *
 * Prior to Wave-1, HostKind was duplicated in write-host-capability.ts
 * and team-backend.ts as "claude" | "codex" with a structural-assignability
 * hack between them. This module canonicalizes the union.
 *
 * G4b (verified-multi-host host-reachability, 2026-07): widened from 8 to 12
 * members — the "9-host set" this docblock previously claimed was already
 * stale before this edit (8 members shipped; `gemini` was purged 2026-06-14
 * without a comment update). Added the 4 wrapped-CLI hosts whose registry rows
 * (host-registry-schema.ts HOST_REGISTRY_ROWS) carry `dispatch_selectable:true`
 * but had NO HostKind member — the root cause of their pane-dispatch
 * unreachability. `kiro`/`qoder`/`trae` are `adapter_binding:"agents-file"`
 * (file surface, not a pane) and correctly have NO HostKind member.
 */

/**
 * The 12 pane-dispatchable hosts Guild's host-adapter contract supports.
 *
 * Contract: ADR: host-adapter-contract (workspace wiki)
 *           (8 contract surfaces; the per-host adapter pages live at
 *            docs/knowledge/team-and-routing/<host>-adapter.md).
 *           ADR: verified-multi-host-support (workspace wiki) (the 16-id
 *           HOST_IDS registry — this union covers every registry row EXCEPT the
 *           3 agents-file IDE rows, which are file surfaces, not panes).
 *
 * Adding a new PANE-dispatchable host means: (a) extend this union, (b) add a
 * row to HOST_REGISTRY_ROWS (host-registry-schema.ts), (c) either a bespoke
 * PaneAdapter or let the generic WrappedCliPaneAdapter cover it
 * (pane-adapter.ts), (d) a HOST_CAPABILITY_ROWS entry (host-capabilities-schema.ts).
 * A host whose `adapter_binding` is `"agents-file"` (a file surface) does NOT
 * get a HostKind member — it is never pane-dispatched.
 */
// PHASE-1-DISPATCH-WAVE-1: canonical HostKind owner; replaces the prior
// duplication between write-host-capability.ts and team-backend.ts.
// `gemini` (Google Gemini CLI) was a HostKind member; it was sunset 2026-06-14 in
// favour of Antigravity and is no longer a supported host (purged from the union).
export type HostKind =
  | "claude"               // Claude Code (current default; reference impl)
  | "codex"                // OpenAI Codex CLI
  | "pi"                   // Pi (Inflection AI)
  | "antigravity-2"        // Antigravity 2.0
  | "claude-code-desktop"  // Claude Code Desktop app
  | "claude-code-web"      // Claude Code Web (cloud VM)
  | "codex-app"            // Codex desktop app
  | "claude-ai-connector"  // claude.ai connector (remote MCP control plane)
  // G4b — the 4 wrapped-CLI hosts (verified-multi-host L0 ADR §2.3). Each is a
  // dispatch_selectable:true registry row whose canonical HostKind literal IS
  // its registry host_id (no aliasing needed — see host-id-namespace.ts).
  | "cursor"               // Cursor CLI (cursor-agent)
  | "github-copilot"       // GitHub Copilot CLI (`gh copilot`)
  | "opencode"              // opencode CLI
  | "rovo-dev";             // Atlassian Rovo Dev CLI (`acli rovodev`)
