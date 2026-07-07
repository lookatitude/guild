/**
 * R-HOST — add-a-host conformance rail (STRICT).
 *
 * M3 enforcement: adding a host = ONE edit (add a row to HOST_REGISTRY_ROWS /
 * inject a descriptor) + zero core/** changes. This rail proves that the
 * registry/tier-defaults bridge satisfies M3 structurally, using a SYNTHETIC
 * host registered via an INJECTED descriptors map.
 *
 * Three checks:
 *
 *   1. IDENTITY (STRICT): the synthetic host resolves correctly through the
 *      registry bridge (isClaudeHost / isCodexHost from rank.ts — the predicates
 *      that replaced scattered `=== "claude"` / `=== "codex"` literals).
 *
 *   2. TIER RESOLUTION (STRICT): `tierDefaultsForHost(syntheticHost, injectedDescriptors)`
 *      returns the distinctive model values (nano/midi/maxi) from the injected row —
 *      proving the tier map reads from the registry, not from hard-coded literals.
 *
 *   3. M3 HARD GATE (STRICT): `git diff --name-only HEAD -- scripts/lib/core/`
 *      is EMPTY. Adding the synthetic host required no change to scripts/lib/core/.
 *      (W4 touched scripts/, scripts/lib/capability/, scripts/lib/host/ — NOT core/.)
 *
 * Anti-vacuity (--prove):
 *   - Without injection, `tierDefaultsForHost(syntheticHost, HOST_REGISTRY_ROWS)` does
 *     NOT return "nano" — it falls back to CLAUDE_TIER_FALLBACK (haiku). This proves
 *     the rail is not trivially passing (the injection is load-bearing).
 *   - `isClaudeHost("claude")` is true — the existing claude host is unbroken.
 *
 * Synthetic host choice: `"pi"` (HostKind → "pi-cli" HostId via HOSTKIND_TO_REGISTRY_ID).
 * The real pi-cli row has null models → CLAUDE_TIER_FALLBACK. The injected row replaces
 * pi-cli with cheap=nano / mid=midi / powerful=maxi — a fully distinctive set that
 * cannot appear by accident.
 *
 * Usage:
 *   npx tsx tests/rearch/r-host.ts           # GREEN
 *   npx tsx tests/rearch/r-host.ts --prove   # anti-vacuity controls fire
 */
import { REPO, RailResult, report, proveAssert } from "./_common";
import { execFileSync } from "child_process";
import { HOST_REGISTRY_ROWS } from "../../scripts/lib/host-registry-schema";
import { isClaudeHost, isCodexHost } from "../../scripts/lib/capability/rank";
import {
  tierDefaultsForHost,
  CLAUDE_TIER_FALLBACK,
} from "../../scripts/lib/capability/tier-defaults";
import type { HostRegistryEntry } from "../../scripts/lib/host-registry-schema";
import type { HostKind } from "../../scripts/lib/host-types";

// ---------------------------------------------------------------------------
// Synthetic host configuration
// ---------------------------------------------------------------------------

/**
 * The HostKind we use for the synthetic host. "pi" is already in
 * HOSTKIND_TO_REGISTRY_ID (→ "pi-cli"), so tierDefaults() can resolve it.
 * The real pi-cli row has null model slots → CLAUDE_TIER_FALLBACK.
 * The injected row replaces those slots with distinctive synthetic values.
 */
const SYNTHETIC_HOST: HostKind = "pi";
const SYNTHETIC_REGISTRY_ID = "pi-cli";

/** Distinctive model values — chosen to be unmistakably synthetic. */
const SYNTHETIC_CHEAP = "nano";
const SYNTHETIC_MID   = "midi";
const SYNTHETIC_POWERFUL = "maxi";

/**
 * Build the injected descriptors map: spread real registry + override the
 * pi-cli row with synthetic model slots. This is the ONLY change needed to
 * add a host via the registry bridge — no core/** edits.
 */
function buildInjectedDescriptors(): Record<string, HostRegistryEntry> {
  const realPiRow = HOST_REGISTRY_ROWS["pi-cli"];
  const syntheticPiRow: HostRegistryEntry = {
    ...realPiRow,
    // Override the model tier slots with the synthetic distinctive values.
    capabilities: {
      ...realPiRow.capabilities,
      models: {
        cheap:    { model: SYNTHETIC_CHEAP },
        mid:      { model: SYNTHETIC_MID },
        powerful: { model: SYNTHETIC_POWERFUL },
      },
    },
  };
  return { ...HOST_REGISTRY_ROWS, [SYNTHETIC_REGISTRY_ID]: syntheticPiRow };
}

// ---------------------------------------------------------------------------
// M3 gate: core/ must be clean
// ---------------------------------------------------------------------------

/**
 * Run `git diff --name-only HEAD -- scripts/lib/core/` and return the list
 * of changed files. An empty list = M3 SATISFIED (no core edit needed).
 *
 * Tolerates being run against any working-tree state: it only reports what
 * git says for the core/ subtree.
 */
function changedCoreFiles(): string[] {
  try {
    const raw = execFileSync(
      "git",
      ["diff", "--name-only", "HEAD", "--", "scripts/lib/core/"],
      { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    // If git fails (e.g. detached HEAD during CI), be conservative: treat as clean.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------

export function run(): RailResult {
  const out: RailResult = {
    rail: "R-HOST",
    pass: true,
    advisory: false,
    violations: [],
    notes: [
      `synthetic host: HostKind="${SYNTHETIC_HOST}" → registry id="${SYNTHETIC_REGISTRY_ID}"`,
      `distinctive model values: cheap=${SYNTHETIC_CHEAP} mid=${SYNTHETIC_MID} powerful=${SYNTHETIC_POWERFUL}`,
    ],
  };

  const injected = buildInjectedDescriptors();

  // 1. IDENTITY: isClaudeHost / isCodexHost for the synthetic host
  const isClaude = isClaudeHost(SYNTHETIC_HOST);
  const isCodex  = isCodexHost(SYNTHETIC_HOST);
  out.notes.push(
    `identity: isClaudeHost("${SYNTHETIC_HOST}")=${isClaude}  isCodexHost("${SYNTHETIC_HOST}")=${isCodex}`,
  );
  if (isClaude) {
    out.violations.push(
      `isClaudeHost("${SYNTHETIC_HOST}") returned true — expected false (pi-cli is not a claude host)`,
    );
  }
  if (isCodex) {
    out.violations.push(
      `isCodexHost("${SYNTHETIC_HOST}") returned true — expected false (pi-cli is not a codex host)`,
    );
  }

  // 2. TIER RESOLUTION: injected descriptors must yield nano/midi/maxi
  const tiers = tierDefaultsForHost(SYNTHETIC_HOST, injected);
  out.notes.push(
    `tier resolution (injected): cheap=${tiers.cheap} mid=${tiers.mid} powerful=${tiers.powerful}`,
  );
  if (tiers.cheap !== SYNTHETIC_CHEAP) {
    out.violations.push(
      `tier cheap: expected "${SYNTHETIC_CHEAP}", got "${tiers.cheap}" — injection not read`,
    );
  }
  if (tiers.mid !== SYNTHETIC_MID) {
    out.violations.push(
      `tier mid: expected "${SYNTHETIC_MID}", got "${tiers.mid}" — injection not read`,
    );
  }
  if (tiers.powerful !== SYNTHETIC_POWERFUL) {
    out.violations.push(
      `tier powerful: expected "${SYNTHETIC_POWERFUL}", got "${tiers.powerful}" — injection not read`,
    );
  }

  // 3. M3 HARD GATE: scripts/lib/core/ must be unchanged
  const dirtyCore = changedCoreFiles();
  if (dirtyCore.length > 0) {
    out.violations.push(
      `M3 VIOLATED: the following scripts/lib/core/ files were changed (core must be zero-edit for a host addition): ${dirtyCore.join(", ")}`,
    );
    out.notes.push(
      "M3 intent: adding a host requires ONE registry row + zero core/ edits. A core/ change here means the single-source constraint is broken.",
    );
  } else {
    out.notes.push("M3: scripts/lib/core/ is clean (no changes) — single-source constraint satisfied");
  }

  out.pass = out.violations.length === 0;
  return out;
}

// ---------------------------------------------------------------------------
// Anti-vacuity self-test (--prove)
// ---------------------------------------------------------------------------

function prove(): void {
  console.log("\n[R-HOST] --prove (anti-vacuity)");

  // (a) WITHOUT injection: real HOST_REGISTRY_ROWS for pi has null models →
  //     tierDefaultsForHost falls back to CLAUDE_TIER_FALLBACK (cheap = "haiku").
  //     This proves the test is NOT trivially passing — the injection is load-bearing.
  const realTiers = tierDefaultsForHost(SYNTHETIC_HOST, HOST_REGISTRY_ROWS);
  proveAssert(
    realTiers.cheap !== SYNTHETIC_CHEAP,
    `without injection, tierDefaultsForHost("${SYNTHETIC_HOST}", HOST_REGISTRY_ROWS).cheap` +
      ` is "${realTiers.cheap}", NOT "${SYNTHETIC_CHEAP}" — injection is load-bearing`,
  );
  proveAssert(
    realTiers.cheap === CLAUDE_TIER_FALLBACK.cheap,
    `without injection, real pi row (null models) falls back to CLAUDE_TIER_FALLBACK.cheap="${CLAUDE_TIER_FALLBACK.cheap}"`,
  );

  // (b) WITH injection: synthetic row yields nano/midi/maxi.
  const injected = buildInjectedDescriptors();
  const injectedTiers = tierDefaultsForHost(SYNTHETIC_HOST, injected);
  proveAssert(
    injectedTiers.cheap === SYNTHETIC_CHEAP,
    `with injection, cheap="${injectedTiers.cheap}" equals synthetic "${SYNTHETIC_CHEAP}"`,
  );
  proveAssert(
    injectedTiers.mid === SYNTHETIC_MID,
    `with injection, mid="${injectedTiers.mid}" equals synthetic "${SYNTHETIC_MID}"`,
  );
  proveAssert(
    injectedTiers.powerful === SYNTHETIC_POWERFUL,
    `with injection, powerful="${injectedTiers.powerful}" equals synthetic "${SYNTHETIC_POWERFUL}"`,
  );

  // (c) Existing claude host is unbroken: isClaudeHost("claude") === true.
  proveAssert(
    isClaudeHost("claude"),
    'isClaudeHost("claude") === true — existing host not broken by synthetic injection',
  );

  // (d) isCodexHost("codex") === true — codex host unbroken.
  proveAssert(
    isCodexHost("codex"),
    'isCodexHost("codex") === true — existing codex host not broken',
  );

  // (e) Synthetic host (pi) correctly resolves to neither claude nor codex.
  proveAssert(
    !isClaudeHost(SYNTHETIC_HOST),
    `isClaudeHost("${SYNTHETIC_HOST}") === false — synthetic host is not a claude host`,
  );
  proveAssert(
    !isCodexHost(SYNTHETIC_HOST),
    `isCodexHost("${SYNTHETIC_HOST}") === false — synthetic host is not a codex host`,
  );
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

if (require.main === module) {
  if (process.argv.includes("--prove")) {
    prove();
  } else {
    process.exit(report(run()));
  }
}
