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
 * hack between them. This module canonicalizes the union and widens it to
 * the 9-host set documented in docs/knowledge/decisions/host-adapter-contract.md.
 */

/**
 * The 9 hosts Guild's host-adapter contract supports.
 *
 * Contract: docs/knowledge/decisions/host-adapter-contract.md
 *           (8 contract surfaces; the per-host adapter pages live at
 *            docs/knowledge/team-and-routing/<host>-adapter.md).
 *
 * Adding a new host means: (a) extend this union, (b) add the per-host
 * adapter page, (c) extend the default model-tier registry in host-router.ts.
 */
// PHASE-1-DISPATCH-WAVE-1: canonical HostKind owner; replaces the prior
// duplication between write-host-capability.ts and team-backend.ts.
export type HostKind =
  | "claude"               // Claude Code (current default; reference impl)
  | "codex"                // OpenAI Codex CLI
  | "gemini"               // Google Gemini CLI
  | "pi"                   // Pi (Inflection AI)
  | "antigravity-2"        // Antigravity 2.0
  | "claude-code-desktop"  // Claude Code Desktop app
  | "claude-code-web"      // Claude Code Web (cloud VM)
  | "codex-app"            // Codex desktop app
  | "claude-ai-connector"; // claude.ai connector (remote MCP control plane)
