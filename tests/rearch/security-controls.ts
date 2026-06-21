/**
 * tests/rearch/security-controls.ts
 *
 * R-SEC control-inventory manifest.
 *
 * Every security control in the Guild plugin expressed as a structured record.
 * The R-SEC rail (r-sec.ts) reads this manifest and asserts:
 *   - every enforcer_file EXISTS on disk
 *   - every hostile_test EXISTS on disk
 *   - (advisory) flags any control whose enforcer_kind is "prose-only"
 *
 * Sources audited:
 *   - hooks/lib/security/   (enforce, injection-guard, mcp-hash-pin, scrubbed-write, secrets, config, events)
 *   - scripts/lib/recall-protect.ts (D-RECALL exemplar)
 *   - scripts/lib/shared/safe-object.ts (proto-poison guard)
 *   - scripts/lib/shared/share-set.ts + scripts/dot-guild/scrub.ts (share-set redaction)
 *   - scripts/dot-guild/audit.ts (SC-7 scrub-coverage gap check)
 *   - scripts/instantiate-template.ts (AC37 write-guard)
 *
 * Assessment key:
 *   enforcer_kind:
 *     "code"        — enforcer is a deterministic TypeScript/JS function on the real path
 *     "prose-only"  — control described only in skill/doc prose; no code choke-point
 *
 * See: .guild/initiatives/active/plugin-rearchitecture/audit-findings.md §M8
 */

export interface SecurityControl {
  /** Short unique id for the control. */
  control_id: string;
  /** What security property this control defends. */
  what_it_protects: string;
  /**
   * The exact source file:function that ENFORCES this deterministically.
   * Path relative to the plugin repo root.
   * For prose-only controls this is "" (no real enforcer).
   */
  enforcer_file: string;
  enforcer_function: string;
  /** "code" = real enforcer; "prose-only" = skill/doc prose only. */
  enforcer_kind: "code" | "prose-only";
  /**
   * File that contains a hostile test for this control (a test that feeds
   * malicious input and asserts the control blocks/flags it).
   * Path relative to the plugin repo root.
   */
  hostile_test: string;
  /**
   * Brief description of how the anti-vacuity control proves the test can fail.
   * A "planted" bad input or a "--prove" mode that asserts the detector trips.
   */
  anti_vacuity_control: string;
  /**
   * Optional disposition of the control when it fires:
   *   "block"          — denies/aborts/quarantines the offending operation (default if omitted).
   *   "flag-and-audit" — code-enforced DETECTION that logs/flags but does not abort (advisory).
   * Recorded explicitly so the manifest cannot overclaim a flagging control as a hard block.
   */
  disposition?: "block" | "flag-and-audit";
  /** Optional notes. */
  notes?: string;
}

export const SECURITY_CONTROLS: SecurityControl[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // SEC-01: D-RECALL injection probe (the EXEMPLAR)
  // Prevents prompt-injection smuggled via wiki recall content.
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-01",
    what_it_protects:
      "Prompt-injection via recalled wiki content: a hostile wiki chunk carrying " +
      "directive language is quarantined before it reaches the agent context.",
    enforcer_file: "scripts/lib/recall-protect.ts",
    enforcer_function: "protectChunks",
    enforcer_kind: "code",
    hostile_test: "scripts/__tests__/recall-protect.test.ts",
    anti_vacuity_control:
      "Test 'quarantines a chunk with injection language' feeds INJECTION constant " +
      "('ignore all previous instructions…') and asserts rendered === '[QUARANTINED:…]'. " +
      "A clean chunk asserts rendered contains guild:recall wrapper — the two branches " +
      "prove the detector is not vacuous.",
    notes:
      "Three recall paths (SQLite wiki_fts, guild-memory MCP BM25, fsScan direct) ALL " +
      "route through protectChunks. sanitizeForInjection (injection-guard.ts) runs first on " +
      "EVERY path — M8=2 exemplary (audit-findings.md §A3).",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC-02: D-RECALL trust-tier classifier
  // Prevents trust-escalation forgery: a wiki page claiming 'owner: operator'
  // in its frontmatter is limited to "trusted" tier, never "operator" (unwrapped).
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-02",
    what_it_protects:
      "Trust-escalation forgery: a wiki page cannot grant itself unwrapped operator " +
      "tier via frontmatter `owner: operator` — only path-allowlist pages reach operator tier.",
    enforcer_file: "scripts/lib/recall-protect.ts",
    enforcer_function: "classifyTrustTier",
    enforcer_kind: "code",
    hostile_test: "scripts/__tests__/recall-protect.test.ts",
    anti_vacuity_control:
      "Test 'forged operator frontmatter is downgraded to trusted' uses FORGED_OPERATOR_CONTENT " +
      "with `owner: operator` on a non-operator path and asserts tier === 'trusted' " +
      "(NOT 'operator'). A real operator path on the same content asserts 'operator', " +
      "proving the path allowlist is the real gate.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC-03: HK-08 — Injection-guard on handoff free-text
  // Prevents prompt-injection via guild.handoff.v2 summary/notes fields.
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-03",
    what_it_protects:
      "Prompt-injection via handoff free-text (summary/notes): directive language " +
      "smuggled in a specialist's handoff is DETECTED and FLAGGED (advisory) for the lead " +
      "before it folds the handoff into rolling context. This is a code-enforced DETECTION/ " +
      "AUDIT control, NOT a hard block — by design, an injection signal flags + records " +
      "(decision logged) but does not abort task completion (avoids false-positive denial of " +
      "a legitimate handoff). The hard boundary against injected recall content is SEC-01 " +
      "(recall-protect quarantine), which DOES withhold the raw text.",
    enforcer_file: "hooks/lib/security/injection-guard.ts",
    enforcer_function: "sanitizeForInjection",
    enforcer_kind: "code", // deterministic regex detection; advisory disposition (flags, not blocks)
    disposition: "flag-and-audit", // NOT "block" — see what_it_protects
    hostile_test: "hooks/__tests__/injection-guard.test.ts",
    anti_vacuity_control:
      "injection-guard.test.ts feeds 'ignore all previous instructions …' and asserts " +
      "result === 'flagged' (the FLAG disposition); a clean text asserts 'clean'. The control's " +
      "guarantee is detection-and-flag, so the hostile test correctly asserts the flag, not a block. " +
      "Pattern set exercises a known-positive per major category (ignore-previous, role-reassignment, " +
      "system-prompt, jailbreak).",
    notes:
      "Pure regex — no I/O. Advisory by design: task-completed.ts logs decision and continues " +
      "(does not block completion). Also consumed by recall-protect.ts (SEC-01) as the probe step, " +
      "where the disposition IS blocking (quarantine).",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC-04: D-CAP capability-scope enforcement (per-lane tool allow-list)
  // Enforces that a dispatched specialist lane can only call tools in its
  // declared capability_scope, using an AND-mask with the autonomy_contract.
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-04",
    what_it_protects:
      "Capability-scope violation: a specialist lane calling a tool outside its " +
      "declared allow-list is gated (ask/deny) rather than silently permitted.",
    enforcer_file: "hooks/lib/security/enforce.ts",
    enforcer_function: "resolveScopeDecision",
    enforcer_kind: "code",
    hostile_test: "hooks/__tests__/security-enforce.test.ts",
    anti_vacuity_control:
      "Test 'out-of-scope tool → ask decision' sets GUILD_CAPABILITY_SCOPE=[\"Read\"] and " +
      "sends a Bash tool call; asserts gate=true, permissionDecision='ask'. " +
      "Companion test 'in-scope tool → pass' proves the allowlist works both ways.",
    notes:
      "Env primary (GUILD_CAPABILITY_SCOPE) + file fallback (scope/<taskId>.json). " +
      "Fail-closed: malformed scope → invalid=true → isInScope returns false. " +
      "D-BYPASS autonomy-mode forcing is a sub-control (SEC-05).",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC-05: D-BYPASS — bypass_permissions_policy + autonomy-mode forcing
  // Under non-interactive autonomy modes (auto_approve / autonomous_after_plan_approval)
  // the bypass_permissions_policy is FORCED to "deny" regardless of configured value.
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-05",
    what_it_protects:
      "Bypass-permission governance: an out-of-scope tool call cannot slip through " +
      "under bypassPermissions mode when the run is in a non-interactive autonomy posture.",
    enforcer_file: "hooks/lib/security/enforce.ts",
    enforcer_function: "effectiveBypassPolicy",
    enforcer_kind: "code",
    hostile_test: "hooks/__tests__/security-enforce.test.ts",
    anti_vacuity_control:
      "Test 'auto_approve forces bypass_permissions_policy to deny' asserts effectiveBypassPolicy " +
      "('audit', 'auto_approve').policy === 'deny' and .forced === true. " +
      "Control: interactive mode leaves policy='audit' and forced=false.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC-06: D-SECRETS — scrubbedWrite write-time choke-point (HIGH-RISK surfaces)
  // The HIGH-RISK durable surfaces (handoffs, learnings, provenance, wiki, review)
  // write through scrubbedWrite, which applies secrets redaction and fails CLOSED.
  // This is write-time defense-in-depth ON TOP OF the share-time scrub (SEC-08),
  // which redacts the ENTIRE run tree before any git share — NOT a claim that
  // every .guild/ write routes through scrubbedWrite (it does not, and need not).
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-06",
    what_it_protects:
      "Secret leakage to the HIGH-RISK durable .guild/ artifacts (handoffs, learnings, " +
      "provenance, wiki, review): these write through scrubbedWrite, which scrubs via built-in " +
      "+ custom redaction before disk and BLOCKS on scrub failure (fail-CLOSED). " +
      "SCOPE (codex W5-gate correction): this is the WRITE-TIME choke-point for those high-risk " +
      "surfaces, NOT 'every durable .guild/ write'. Lower-risk run metadata written raw " +
      "(run.yaml, current-run-id, agent-team session.json, scope/<id>.json, task-run YAML) does " +
      "NOT go through scrubbedWrite — it is covered by the SHARE-TIME scrubber SEC-08 (scrub.ts " +
      "walkDir redacts the full run tree before git share; run.yaml is in the SEC-10 share-set). " +
      "Defense-in-depth: write-time (SEC-06, high-risk surfaces) + share-time (SEC-08, whole tree).",
    enforcer_file: "hooks/lib/security/scrubbed-write.ts",
    enforcer_function: "scrubbedWrite",
    enforcer_kind: "code",
    disposition: "block",
    hostile_test: "hooks/__tests__/scrubbed-write.test.ts",
    anti_vacuity_control:
      "Test 'COVERAGE: handoff with secret-shaped token → redacted on disk' writes " +
      "FAKE_SECRET ('sk-ant-FAKESECRETVALUE1234567890') via scrubbedWrite and asserts " +
      "the on-disk file does NOT contain the secret. " +
      "Test 'FAIL-CLOSED: forced ok=false via invalid regex → file does NOT land' plants " +
      "a broken regex in redaction_patterns and asserts fs.existsSync(outPath) === false, " +
      "proving the gate is non-vacuous.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC-07: D-SECRETS — applySecretsPolicy (built-in redaction + custom patterns)
  // Underlying scrubber for both scrubbedWrite and telemetry writes.
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-07",
    what_it_protects:
      "Secret tokens/API keys in any scrubbed surface: 5-group built-in redaction " +
      "(token-shape, home-dir, key=value, high-entropy, truncation) always runs; " +
      "operator custom patterns are additive on top.",
    enforcer_file: "hooks/lib/security/secrets.ts",
    enforcer_function: "applySecretsPolicy",
    enforcer_kind: "code",
    hostile_test: "hooks/__tests__/security-secrets.test.ts",
    anti_vacuity_control:
      "Test 'always runs built-in redaction' feeds a real sk-ant-* token and asserts " +
      "it is not present in r.value. Test 'records failure (ok=false) for invalid regex' " +
      "plants '(' as a pattern and asserts ok=false + failures.length===1, proving both " +
      "the success and failure paths are exercised.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC-08: D-AUDIT / Share-set redaction (scrub.ts operator-path + secret-grep)
  // The share-dot-guild scrubber redacts operator absolute paths and secret
  // patterns from all files in the per-run share-set before git exposure.
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-08",
    what_it_protects:
      "Operator path leakage and secret exposure in shared .guild/runs/ artifacts: " +
      "OPERATOR_PATH_RE and TILDE_CLAUDE_PROJECT_RE replace absolute paths with " +
      "<workspace-root>; SECRET_PATTERNS (imported from docs-hygiene/scan.ts) " +
      "replace matched secrets with <SECRET-REDACTED:label>.",
    enforcer_file: "scripts/dot-guild/scrub.ts",
    enforcer_function: "redact",
    enforcer_kind: "code",
    hostile_test: "tests/dot-guild/scrub.test.ts",
    anti_vacuity_control:
      "scrub.test.ts feeds a content string containing a real operator path and asserts " +
      "the output contains <workspace-root> and does NOT contain the original path. " +
      "A secret-pattern match test asserts the <SECRET-REDACTED:…> placeholder appears.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC-09: SC-7 scrub-coverage gap check (audit.ts)
  // Detects git-trackable files in run dirs that scrub.ts has no coverage for
  // (files that would be committed/shared without redaction).
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-09",
    what_it_protects:
      "SC-7 blind spot: a git-trackable file in a run dir that scrub.ts does not " +
      "cover escapes redaction entirely — findScrubCoverageGaps catches these.",
    enforcer_file: "scripts/dot-guild/audit.ts",
    enforcer_function: "findScrubCoverageGaps",
    enforcer_kind: "code",
    hostile_test: "tests/dot-guild/scrub-coverage.test.ts",
    anti_vacuity_control:
      "scrub-coverage.test.ts plants a file outside the share-set under a synthetic run dir " +
      "and asserts the gap check flags it. A file inside the share-set asserts no gap, " +
      "proving the check is non-vacuous.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC-10: Share-set membership single-source (share-set.ts)
  // inShareSet() is the one canonical definition consulted by both scrub.ts
  // and audit.ts — prevents the former "keep in sync" dup where a drift would
  // let a file escape redaction in one path.
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-10",
    what_it_protects:
      "Share-set drift: if scrub.ts and audit.ts use different share-set definitions " +
      "a file could be audited-green but escape scrubbing (or vice versa). The " +
      "single-source inShareSet() makes them identical by construction.",
    enforcer_file: "scripts/lib/shared/share-set.ts",
    enforcer_function: "inShareSet",
    enforcer_kind: "code",
    hostile_test: "scripts/__tests__/share-set-parity.test.ts",
    anti_vacuity_control:
      "share-set-parity.test.ts asserts that exactly ONE source file exports inShareSet " +
      "and that both scrub.ts and audit.ts import from scripts/lib/shared/share-set, " +
      "not from a local copy. A planted local redefinition would fail the single-source check.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC-11: Proto-poison key blocking (safe-object.ts deepMerge consumers)
  // Prevents prototype-pollution attacks via attacker-authored settings.local.json
  // keys such as __proto__, prototype, constructor being merged into config objects.
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-11",
    what_it_protects:
      "Prototype-pollution via config merge: keys __proto__, prototype, and constructor " +
      "are blocked at every deepMerge call (settings-resolver, read-guild-config, config-cmd) " +
      "by consulting PROTO_POISON_KEYS from the single-source safe-object.ts.",
    enforcer_file: "scripts/lib/shared/safe-object.ts",
    enforcer_function: "isProtoPoisonKey",
    enforcer_kind: "code",
    hostile_test: "scripts/__tests__/safe-object-parity.test.ts",
    anti_vacuity_control:
      "Test '(B) anti-vacuity control: a set missing constructor disagrees' asserts that " +
      "a DIVERGENT set (missing 'constructor') differs from the canonical set on that key, " +
      "proving the parity test has teeth. Test '(A) parity: blocks exactly the reference " +
      "dangerous keys' proves all three keys are blocked.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC-12: D-MCP — MCP tool-description hash pinning
  // Detects a silent description mutation ("rug-pull") on a pinned MCP tool —
  // a compromised server could change the description to inject instructions.
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-12",
    what_it_protects:
      "MCP tool-description rug-pull / line-jumping prompt-injection: a malicious " +
      "MCP server that silently mutates a tool description after the operator pinned it " +
      "is detected by SHA-256 hash comparison (verifyMcpDescription).",
    enforcer_file: "hooks/lib/security/mcp-hash-pin.ts",
    enforcer_function: "verifyMcpDescription",
    enforcer_kind: "code",
    hostile_test: "hooks/__tests__/security-mcp-hash-pin.test.ts",
    anti_vacuity_control:
      "Test 'mismatch when live description differs from pin' feeds pinned=sha256('original') " +
      "but liveDescription='mutated description' and asserts status==='mismatch'. " +
      "Companion 'match when description is unchanged' proves the clean path passes.",
    notes:
      "Currently soft: 'unverifiable' (live description unavailable) does not block the " +
      "call by default — a tracked followup will upgrade this to fail-closed once the " +
      "description source is reliable in PreToolUse payloads.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC-13: AC37 write-guard (instantiate-template.ts assertNotRuntimeTree)
  // Prevents the template producer from writing into runtime plugin surfaces
  // (skills/, agents/, commands/, hooks/, .claude-plugin/, dist/) via a
  // symlink-resolved deny-list checked before any fs mutation.
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-13",
    what_it_protects:
      "Template producer self-edit (AC37): the instantiate-template CLI must never " +
      "write into runtime permission/skill/agent surfaces — even via a symlink escape, " +
      "path traversal in --slug, or a consuming-repo runtime tree via --out-dir.",
    enforcer_file: "scripts/instantiate-template.ts",
    enforcer_function: "assertNotRuntimeTree",
    enforcer_kind: "code",
    hostile_test: "scripts/__tests__/instantiate-template.test.ts",
    anti_vacuity_control:
      "Test feeds --out-dir=skills and asserts writeSkeletonPair throws with message " +
      "containing 'AC37'. A normal --out-dir=.guild target asserts no throw, proving " +
      "the allow-list is not vacuously rejecting everything.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC-14: Security event emission / audit trail (events.ts)
  // Every security decision (scope violation, scrub block, injection detection,
  // recall quarantine) is appended to security-events.jsonl for audit.
  // ─────────────────────────────────────────────────────────────────────────
  {
    control_id: "SEC-14",
    what_it_protects:
      "Audit trail integrity: every security decision (capability_scope_violation, " +
      "secret_scrub_blocked, injection_attempt_detected, recall_quarantine, etc.) is " +
      "appended as a guild.security_event.v1 record and the `detail` field is pre-scrubbed " +
      "(redactField) so a violation record can never itself leak a secret.",
    enforcer_file: "hooks/lib/security/events.ts",
    enforcer_function: "buildSecurityEvent",
    enforcer_kind: "code",
    hostile_test: "hooks/__tests__/security-events.test.ts",
    anti_vacuity_control:
      "Test 'buildSecurityEvent redacts detail before write' feeds a detail string " +
      "containing a sk-ant-* token and asserts the returned record.detail does not contain " +
      "the raw token. The audit-trail appendSecurityEvent test reads the JSONL file and " +
      "asserts the event was written (proves it is not a no-op).",
  },
];

// ─── Convenience helpers consumed by r-sec.ts ────────────────────────────────

/** Controls whose enforcer_kind is "prose-only" (the advisory gap class). */
export function proseOnlyControls(): SecurityControl[] {
  return SECURITY_CONTROLS.filter((c) => c.enforcer_kind === "prose-only");
}

/** Controls whose enforcer_kind is "code" (the deterministic enforcer class). */
export function codeEnforcedControls(): SecurityControl[] {
  return SECURITY_CONTROLS.filter((c) => c.enforcer_kind === "code");
}
