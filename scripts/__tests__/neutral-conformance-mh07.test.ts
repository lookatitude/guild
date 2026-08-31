/**
 * __tests__/neutral-conformance-mh07.test.ts
 *
 * FIC-116 / A21-7 (RED-FIRST) — the executable contract for the not-yet-written
 * production module
 * `src/modules/lifecycle/workflows/module-boundary-conformance-evaluator.ts`.
 *
 * WHAT THIS BINDS
 *   `guild.conformance_scenarios.v1` assigns exactly FOUR of its 31 scenarios to
 *   the `W4/MH-07` module-boundary owner: `MHRC-MOD-001`, `MHRC-MOD-002`,
 *   `MHRC-MOD-003`, and `MHRC-MOD-004`. A21-S (already accepted — review packet
 *   `FIC-112-A21-SPINE-BLOCKERS-GREEN`, verdict `satisfied`, receipt SHA-256
 *   `5bdb319ded97b0d083c31173c45807655c9c2366c0a2d69db34148b40b5cdcfe`) built the
 *   ASSEMBLY spine that joins one packet per owner. It deliberately evaluates
 *   nothing, and its bounded verdict is NOT an implementation of these four
 *   scenarios. This file states what the MH-07 owner's EVALUATOR must be before
 *   its packet is allowed to mean anything.
 *
 *   The only thing that makes such a packet honest is that its four results are
 *   DERIVED from the real module system — the real `module.manifest.json` files
 *   read through `module-manifest.ts`, the production ownership/boundary/health
 *   validators, the production token-based dependency-edge extractor, and the
 *   production neutral-core closure evaluator over registered source bytes —
 *   rather than authored. So the contract is written twice: once as ordinary
 *   obligations, and once as a CONTROL BATTERY run against a disposable
 *   conforming ORACLE (must pass), against planted REPOSITORY mutants (each must
 *   flip exactly its scenario), and against planted EVALUATOR mutants (each must
 *   fail a NAMED control). A battery the mutants survive proves nothing.
 *
 * WHY THE MODULE LIVES IN `lifecycle`
 *   The four scenarios are statements about the module system, whose validators
 *   live in `kernel`. An evaluator placed in `kernel` would have to import the
 *   neutral core from `lifecycle` to emit `guild.boundary_outcome.v1` results and
 *   an assembler-compatible packet — and `lifecycle` already declares
 *   `depends_on: [… kernel …]`, so that edge would be a module-graph CYCLE, which
 *   is precisely what MH-07 exists to forbid. The evaluator therefore sits beside
 *   the neutral core and reaches the validators through `src/modules/kernel`'s
 *   PUBLIC index, in the one direction the manifests already declare.
 *
 * WHAT IT DELIBERATELY DOES NOT BIND
 *   No promotion decision, no signature or attestation verification, no release
 *   or channel decision, and no assembly. `evaluateNeutralConformanceDecision`
 *   (MH-02) still owns promotion; `assembleNeutralConformanceEvidence` (A21-S)
 *   still owns the join. This module only EVALUATES four scenarios and hands over
 *   one packet. §"the evaluator stays inside its boundary" scans the real source
 *   and re-digests the scanned tree to prove it.
 *
 * TWO HONEST GAPS THIS CONTRACT OPENS ON PURPOSE
 *   1. UNRESOLVABLE EDGE ON THE REAL TREE. MOD-001 requires that every
 *      destination be classified and that an edge the scanner cannot resolve be a
 *      FAILURE, never a silent "no edge". On this base the module tree
 *      (`src/modules/**`, generated `resources/` mirrors excluded — see
 *      `MH07_GRAPH_SCOPE`) contains exactly one such dependency edge, a computed
 *      `require(require.resolve("js-yaml", …))` in
 *      `src/modules/kernel/workflows/yaml-loader.ts`. The implementing lane must
 *      resolve it or MOD-001 is honestly failed. This suite does not repair it:
 *      production repair is a separate lane.
 *   2. TYPED TRANSPORT ERRORS. MOD-003's third assertion ("transport errors
 *      return typed outcomes") is bound here by PORT REACH — a transport module
 *      must actually depend on the public typed-outcome surface — not by
 *      exception-flow analysis, which a lexical scanner cannot decide. The weaker
 *      binding is stated rather than hidden, and the `transport-port-detached`
 *      repository mutant proves the binding is not vacuous.
 *
 * RED EXPECTATION AT AUTHORING TIME
 *   Every `it` under §"the production MH-07 evaluator" fails with
 *   "A21-7 RED: production module not implemented yet", because the module does
 *   not exist. It must fail for that reason and no other. The anti-vacuity block
 *   (§"the control battery distinguishes good from bad") is GREEN from the first
 *   run: it exercises the same controls against a test-owned oracle, planted
 *   repositories, and planted evaluator mutants, which is what makes the RED half
 *   a real gate rather than a placeholder.
 *
 * This file reads real repository bytes and builds disposable repositories under
 * the OS temp directory. It writes nowhere else, and it never mutates the plugin
 * tree — §MH07-C12 re-digests the scanned tree to prove it.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  NEUTRAL_DISPOSITIONS,
  NEUTRAL_OUTCOME_TYPES,
  NEUTRAL_REASON_CODES,
  neutralCanonicalJson,
  neutralFreeze,
  neutralOutcome,
} from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";
import type { NeutralOutcome } from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";
import {
  NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_EVIDENCE_PROFILES,
  NEUTRAL_RECOGNIZED_HOST_IDS,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
  validateNeutralScenarioRegistry,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import type {
  NeutralEvidenceIdentity,
  NeutralScenarioDefinition,
  NeutralScenarioResult,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import {
  NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
  assembleNeutralConformanceEvidence,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-assembly";

// The REAL production boundary this owner evaluates. Imported for two distinct
// purposes: to drive the disposable oracle over genuinely production behaviour,
// and to prove by IDENTITY (`===`) that the evaluator's declared production port
// holds these exact functions rather than look-alikes.
import {
  NEUTRAL_CORE_MEMBERS,
  evaluateNeutralCoreBoundary,
  extractNeutralImportEdges,
  tokenizeNeutralSource,
} from "../../src/modules/lifecycle/workflows/neutral-core-boundary";
import type { NeutralImportEdge } from "../../src/modules/lifecycle/workflows/neutral-core-boundary";
import {
  loadModuleManifests,
  validateModuleBoundaries,
  validateModuleHealth,
  validateModuleOwnership,
} from "../../src/modules/kernel/workflows/module-manifest";
import type {
  ModuleBoundaryViolation,
  ModuleManifest,
} from "../../src/modules/kernel/workflows/module-manifest";
import { buildInventory } from "../../src/modules/distribution/workflows/build-inventory";

// ---------------------------------------------------------------------------
// The module under contract
// ---------------------------------------------------------------------------

/** The ONE pinned production module path. See §"WHY THE MODULE LIVES IN lifecycle". */
const EVALUATOR_REQUEST =
  "../../src/modules/lifecycle/workflows/module-boundary-conformance-evaluator";
const EVALUATOR_SOURCE_PATH = path.resolve(
  __dirname,
  "../../src/modules/lifecycle/workflows/module-boundary-conformance-evaluator.ts"
);

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

const RED = "A21-7 RED: production module not implemented yet";

let evaluatorModuleCache: Record<string, unknown> | undefined;

/**
 * Load the module under contract, or fail with the one diagnostic this suite is
 * allowed to fail with while it is RED.
 *
 * Lazily, never at import time: a top-level import of a missing module collapses
 * the whole file into a single resolution error, which says nothing about WHICH
 * obligation is unmet. Every `it` below fails independently and names its own.
 */
function evaluatorModule(): Record<string, unknown> {
  if (evaluatorModuleCache === undefined) {
    if (!fs.existsSync(EVALUATOR_SOURCE_PATH)) {
      throw new Error(`${RED} — expected ${EVALUATOR_SOURCE_PATH}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    evaluatorModuleCache = require(EVALUATOR_REQUEST) as Record<string, unknown>;
  }
  return evaluatorModuleCache;
}

/** Read one required export, or fail naming the export rather than the module. */
function exported<T>(name: string): T {
  const value = evaluatorModule()[name];
  if (value === undefined) {
    throw new Error(
      `A21-7 RED: production module does not implement the contract — missing export ${name}`
    );
  }
  return value as T;
}

function evaluatorSource(): string {
  if (!fs.existsSync(EVALUATOR_SOURCE_PATH)) throw new Error(`${RED} — expected ${EVALUATOR_SOURCE_PATH}`);
  return fs.readFileSync(EVALUATOR_SOURCE_PATH, "utf8");
}

// ---------------------------------------------------------------------------
// The frozen contract, transcribed independently of production
// ---------------------------------------------------------------------------

const OWNER_KEY_MH07 = "W4/MH-07";

/** The four W4/MH-07 stable ids, in CANONICAL (whole-suite) order. */
const MH07_IDS: readonly string[] = ["MHRC-MOD-001", "MHRC-MOD-002", "MHRC-MOD-003", "MHRC-MOD-004"];

/**
 * The expected typed outcome of each MH-07 scenario, transcribed from the frozen
 * `guild.conformance_scenarios.v1` contract. Production must DERIVE the same
 * table from its own source-owned registry; two independent statements is the
 * point, so a drift between them is a finding rather than a shared mistake.
 *
 * All four are `guild.boundary_outcome.v1` / `succeeded`: a module boundary is a
 * universal claim, so there is no "expected refusal" row here — a scenario is
 * either proven over the whole graph or it is failed.
 */
const MH07_EXPECTED: Readonly<
  Record<string, { type: string; disposition: string; reason_code: string | null }>
> = {
  "MHRC-MOD-001": { type: "guild.boundary_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-MOD-002": { type: "guild.boundary_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-MOD-003": { type: "guild.boundary_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-MOD-004": { type: "guild.boundary_outcome.v1", disposition: "succeeded", reason_code: null },
};

/** The scenario category the frozen contract assigns all four ids. */
const MH07_CATEGORY = "module_boundary";

/** The evidence profile the frozen contract requires for all four. */
const MH07_EVIDENCE_PROFILE = "E-BOUNDARY";

/** The whole 31-id tuple and its owner map — needed to feed the REAL assembler. */
const CANONICAL_SCENARIO_IDS: readonly string[] = [
  "MHRC-LIF-001", "MHRC-LIF-002", "MHRC-LIF-003", "MHRC-LIF-004",
  "MHRC-EVT-001", "MHRC-EVT-002",
  "MHRC-SUP-001", "MHRC-SUP-002", "MHRC-SUP-003", "MHRC-SUP-004", "MHRC-SUP-005", "MHRC-SUP-006",
  "MHRC-UNS-001", "MHRC-UNS-002", "MHRC-UNS-003",
  "MHRC-RCT-001", "MHRC-RCT-002", "MHRC-RCT-003", "MHRC-RCT-004", "MHRC-RCT-005",
  "MHRC-MOD-001", "MHRC-MOD-002", "MHRC-MOD-003", "MHRC-MOD-004",
  "MHRC-STR-001", "MHRC-STR-002", "MHRC-STR-003", "MHRC-STR-004",
  "MHRC-VER-001", "MHRC-VER-002", "MHRC-VER-003",
];

const CANONICAL_OWNER_KEYS: readonly string[] = [
  "W1/MH-02",
  "W2/MH-03",
  "W1/MH-06",
  OWNER_KEY_MH07,
  "W4/MH-08",
  "W5/MH-09",
];

const CANONICAL_OWNER_OF: Readonly<Record<string, string>> = {
  "MHRC-LIF-001": "W1/MH-02", "MHRC-LIF-002": "W1/MH-02", "MHRC-LIF-003": "W1/MH-02",
  "MHRC-LIF-004": "W1/MH-02", "MHRC-UNS-002": "W1/MH-02",
  "MHRC-EVT-001": "W2/MH-03", "MHRC-EVT-002": "W2/MH-03",
  "MHRC-UNS-001": "W2/MH-03", "MHRC-UNS-003": "W2/MH-03",
  "MHRC-RCT-001": "W1/MH-06", "MHRC-RCT-002": "W1/MH-06", "MHRC-RCT-003": "W1/MH-06",
  "MHRC-RCT-004": "W1/MH-06", "MHRC-RCT-005": "W1/MH-06",
  "MHRC-MOD-001": OWNER_KEY_MH07, "MHRC-MOD-002": OWNER_KEY_MH07,
  "MHRC-MOD-003": OWNER_KEY_MH07, "MHRC-MOD-004": OWNER_KEY_MH07,
  "MHRC-STR-001": "W4/MH-08", "MHRC-STR-002": "W4/MH-08", "MHRC-STR-003": "W4/MH-08",
  "MHRC-STR-004": "W4/MH-08",
  "MHRC-SUP-001": "W5/MH-09", "MHRC-SUP-002": "W5/MH-09", "MHRC-SUP-003": "W5/MH-09",
  "MHRC-SUP-004": "W5/MH-09", "MHRC-SUP-005": "W5/MH-09", "MHRC-SUP-006": "W5/MH-09",
  "MHRC-VER-001": "W5/MH-09", "MHRC-VER-002": "W5/MH-09", "MHRC-VER-003": "W5/MH-09",
};

function canonicalIdsFor(ownerKey: string): readonly string[] {
  return CANONICAL_SCENARIO_IDS.filter((id) => CANONICAL_OWNER_OF[id] === ownerKey);
}

/** The refusal discriminators the evaluator must place on `outcome.facts`. */
const REFUSAL_CONTROLS = {
  callerSuppliedIds: "caller_supplied_scenario_ids",
  callerSuppliedGraph: "caller_supplied_dependency_graph",
  callerSuppliedScope: "caller_supplied_module_scope",
  identityIncomplete: "evidence_identity_incomplete",
  evidenceBindingMissing: "evidence_binding_missing",
  sourceBindingIncomplete: "source_binding_incomplete",
} as const;

/**
 * The closed role vocabulary every module in the scanned tree must fall into.
 *
 * Classification is the precondition all four frozen scenarios open with ("core
 * public modules are classified", "adapter and lifecycle modules are
 * classified", "pane, tmux, remote, wrapper, and launcher transports are
 * classified", "…consumers are classified"). It is SOURCE-OWNED: a module the
 * registry does not name is an unclassified node and fails MOD-001, which is why
 * the registry cannot be supplied by a caller.
 */
const MH07_ROLES: readonly string[] = [
  "neutral_core",
  "substrate",
  "host_adapter",
  "execution_transport",
  "service",
];

/** The closed destination classes every resolved edge must fall into. */
const MH07_DESTINATION_CLASSES: readonly string[] = [
  "intra_module",
  "module_public_index",
  "module_private",
  "host_facing_mirror",
  "node_builtin",
  "external_package",
  "unclassified",
];

/**
 * The RESOLVED edge forms the production extractor tags, and therefore the forms
 * the graph must carry. `import()` and `export from` are named explicitly
 * because "dynamic and re-export edges are included" is a frozen MOD-001
 * assertion, and a scanner that sees only `import from` passes a narrower graph
 * while claiming the complete one.
 */
const MH07_EDGE_FORMS: readonly string[] = [
  "import",
  "import from",
  "export from",
  "import()",
  "require()",
];

/**
 * Generated resource mirrors are copies of host-facing scripts, not module
 * source, so the module dependency graph is the module SOURCE closure. This is a
 * source-owned scope rule; a CALLER-supplied scope is a refusal
 * (`caller_supplied_module_scope`), which is the distinction the
 * `caller-shrunk-scope` mutant exists to police.
 */
const MH07_GRAPH_SCOPE = { excluded_directories: ["resources"] } as const;

/** The public-API constant every service module's index must declare. */
const MODULE_PUBLIC_API_DECLARATION =
  'export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;';

/**
 * Symbols that name a LIFECYCLE DECISION. Only the module that owns lifecycle
 * policy may declare one; an adapter or a transport declaring one has taken
 * ownership of a decision it is supposed to consume (MOD-002, MOD-003).
 */
const MH07_LIFECYCLE_DECISION_SYMBOLS: readonly string[] = [
  "decideLifecycleSelection",
  "advanceLifecyclePhase",
  "evaluateGatePolicy",
];

/**
 * Symbols that bind a HOST-NATIVE event. The inverse rule: only an adapter may
 * declare one, because "native event binding remains adapter-owned" (MOD-002).
 */
const MH07_NATIVE_EVENT_BINDING_SYMBOLS: readonly string[] = ["bindNativeHostEvent"];

/** Node builtins, the closed list a bare specifier is classified against. */
const MH07_NODE_BUILTINS: readonly string[] = [
  "assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https", "net",
  "os", "path", "readline", "stream", "url", "util", "worker_threads", "zlib",
];

// ---------------------------------------------------------------------------
// The evaluator's contract shapes, stated test-side
// ---------------------------------------------------------------------------

/**
 * The production surface the evaluator drives.
 *
 * It is a PORT rather than a direct import list for one reason only: a control
 * has to be able to SABOTAGE the scanner and watch the verdict change. An
 * evaluator whose answer is the same whatever the scanner says is not
 * evaluating, and no amount of shape checking can tell the two apart.
 *
 * The seam is not a substitute for the real path, and this suite never lets it
 * become one: `MH07_PRODUCTION_SCANNER` must hold these exact function objects
 * by IDENTITY, the default (portless) evaluation runs over the real repository
 * root, and the source scan proves the real modules are what the evaluator
 * imports.
 */
interface Mh07ScannerPort {
  readonly loadModuleManifests: typeof loadModuleManifests;
  readonly validateModuleOwnership: typeof validateModuleOwnership;
  readonly validateModuleBoundaries: typeof validateModuleBoundaries;
  readonly validateModuleHealth: typeof validateModuleHealth;
  readonly evaluateNeutralCoreBoundary: typeof evaluateNeutralCoreBoundary;
  readonly extractNeutralImportEdges: typeof extractNeutralImportEdges;
  readonly tokenizeNeutralSource: typeof tokenizeNeutralSource;
  readonly buildInventory: typeof buildInventory;
}

const REAL_SCANNER: Mh07ScannerPort = {
  loadModuleManifests,
  validateModuleOwnership,
  validateModuleBoundaries,
  validateModuleHealth,
  evaluateNeutralCoreBoundary,
  extractNeutralImportEdges,
  tokenizeNeutralSource,
  buildInventory,
};

interface Mh07ConformanceRequest {
  readonly run_id: string;
  /** The repository root whose module system is evaluated. */
  readonly plugin_root: string;
  /** External consumer roots, by name. Declared-but-absent is a refusal. */
  readonly consumer_roots: Readonly<Record<string, string>>;
  /** Identity ONLY: the caller names the source it claims, never the findings. */
  readonly evidence_identity: NeutralEvidenceIdentity;
  /** `stable_id` -> committed receipt reference. MH-06 owns the journal itself. */
  readonly receipt_refs: Readonly<Record<string, string>>;
  /** `stable_id` -> typed freshness verdict. `unknown` is not a soft `fresh`. */
  readonly evidence_freshness: Readonly<Record<string, string>>;
  /** Defaults to `MH07_PRODUCTION_SCANNER`. Present so a control can sabotage it. */
  readonly scanner?: Mh07ScannerPort;
  /** Present only in a malformed request; its presence is itself the refusal. */
  readonly stable_ids?: readonly string[];
  /** Ditto: a caller-authored graph is never the graph. */
  readonly dependency_graph?: unknown;
  /** Ditto: a caller-shrunk module scope is never the scope. */
  readonly module_scope?: readonly string[];
}

interface Mh07OwnerPacket {
  readonly schema_version: string;
  readonly suite_id: string;
  readonly suite_version: string;
  readonly owner_key: string;
  readonly evidence_identity: NeutralEvidenceIdentity;
  readonly stable_ids: readonly string[];
  readonly results: readonly NeutralScenarioResult[];
}

interface Mh07ConformanceResult {
  readonly outcome: NeutralOutcome;
  /** The owner packet, or `null` whenever the request itself was refused. */
  readonly packet: Mh07OwnerPacket | null;
}

type Mh07EvaluateFn = (request: Mh07ConformanceRequest) => Mh07ConformanceResult;

/** One scenario's observation record, carried on `outcome.facts.evidence`. */
interface Mh07ScenarioEvidence {
  readonly stable_id: string;
  readonly satisfied: boolean;
  readonly observed: Readonly<Record<string, unknown>>;
}

/** One dependency edge of the module graph. */
interface Mh07GraphEdge {
  readonly importer: string;
  readonly specifier: string;
  readonly form: string;
  readonly imported: string | null;
  readonly destination_class: string;
  readonly from_module: string;
  readonly to_module: string | null;
}

interface Mh07DependencyGraph {
  readonly node_count: number;
  readonly edge_count: number;
  readonly nodes: readonly string[];
  readonly edges: readonly Mh07GraphEdge[];
  /** Edges the scanner could not resolve: never "no edge", always a finding. */
  readonly unresolved: readonly { importer: string; form: string; detail: string }[];
  /** Ambient `require`-as-value uses. Not module references; recorded, not edges. */
  readonly ambient_uses: readonly { importer: string; detail: string }[];
}

type Mh07ScanGraphFn = (root: string) => Mh07DependencyGraph;

// ---------------------------------------------------------------------------
// Test-owned fixtures
// ---------------------------------------------------------------------------

const IDENTITY: NeutralEvidenceIdentity = {
  source_commit: "b17e5da0c9f34281e6047b5c2d938af10e6b7c25",
  package_hash: `sha256:${"4".repeat(64)}`,
  runtime_version: "guild-2.5.0",
  adapter_version: "guild.host_adapter.v1.0.0",
  host_id: "claude-code-cli",
  host_version: "2.5.0",
  platform: "darwin-arm64",
  contract_version: 1,
  scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
  scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
  release_id: "rel-2026-08-18-a21-mh07",
};

const CLAIMANT_ID = "guild.release-emitter";
const RUN_ID = "run-a21-mh07-contract";

function receiptRefFor(stableId: string): string {
  const sequence = CANONICAL_SCENARIO_IDS.indexOf(stableId) + 1;
  const commitment = `nec1:${sequence.toString(16).padStart(16, "0")}`;
  return `guild.receipt_ref.v1:a21-mh07-journal#${sequence}@${commitment}`;
}

function receiptRefs(): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const id of MH07_IDS) refs[id] = receiptRefFor(id);
  return refs;
}

function freshnessMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const id of MH07_IDS) map[id] = "fresh";
  return map;
}

// ---------------------------------------------------------------------------
// The disposable repositories
// ---------------------------------------------------------------------------

const TEMP_ROOTS: string[] = [];

function tempBase(label: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `guild-mh07-${label}-`));
  TEMP_ROOTS.push(base);
  return base;
}

/**
 * A module manifest and a module-resources manifest, assembled through COMPUTED
 * KEYS rather than object literals.
 *
 * The shape produced is identical either way; writing the schema header as a
 * literal would make this test file itself look like a Guild-signed artifact to
 * the workspace write guard. The MH-03 sibling suite uses the same construction
 * for the same reason.
 */
function manifestJson(
  id: string,
  kind: string,
  description: string,
  dependsOn?: readonly string[]
): string {
  const manifest: Record<string, unknown> = {};
  manifest["schema_version"] = "guild.module_manifest.v1";
  manifest["id"] = id;
  manifest["title"] = id;
  manifest["kind"] = kind;
  manifest["implementation_mode"] = "workflow-backed";
  manifest["description"] = description;
  if (dependsOn !== undefined) manifest["depends_on"] = [...dependsOn];
  manifest["owns"] = {};
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function resourcesJson(moduleId: string): string {
  const resources: Record<string, unknown> = {};
  resources["schema_version"] = "guild.module_resources.v1";
  resources["module_id"] = moduleId;
  resources["generated_from"] = "guild.inventory.v1";
  resources["entries"] = [];
  return `${JSON.stringify(resources, null, 2)}\n`;
}

interface FixtureModule {
  readonly id: string;
  readonly kind: string;
  readonly depends_on?: readonly string[];
  readonly index: string;
  readonly workflows: Readonly<Record<string, string>>;
}

/** The role each fixture module is classified into. Test-side transcription. */
const FIXTURE_MODULE_ROLES: Readonly<Record<string, string>> = {
  lifecycle: "neutral_core",
  kernel: "substrate",
  "host-runtime": "host_adapter",
  dispatch: "execution_transport",
  documents: "service",
};

/**
 * The conforming module tree, as a path -> content map.
 *
 * A MAP rather than direct writes so a mutant is a small, legible transform of
 * the conforming repository rather than a second hand-authored tree that could
 * differ in ways the mutation never intended.
 *
 * The `lifecycle` module's core members are the REAL bytes, copied from this
 * repository: the production closure evaluator demands exactly
 * `NEUTRAL_CORE_MEMBERS`, and a hand-written stand-in would prove the fixture
 * closed rather than the core.
 */
function conformingFiles(): Record<string, string> {
  const files: Record<string, string> = {};

  files["plugin/.claude-plugin/plugin.json"] = `${JSON.stringify(
    { name: "guild-mh07-fixture", version: "0.0.0" },
    null,
    2
  )}\n`;

  const coreDir = path.join(PLUGIN_ROOT, "src", "modules", "lifecycle", "workflows");
  const coreWorkflows: Record<string, string> = {};
  for (const member of NEUTRAL_CORE_MEMBERS) {
    coreWorkflows[member] = fs.readFileSync(path.join(coreDir, member), "utf8");
  }
  coreWorkflows["lifecycle-ports.ts"] = [
    'export const LIFECYCLE_PORT_VERSION = "guild.lifecycle.ports.v1" as const;',
    "",
    "/** A lifecycle DECISION. Only this module may own one (MOD-002, MOD-003). */",
    "export function decideLifecycleSelection(candidate: string): string {",
    "  return candidate;",
    "}",
    "",
  ].join("\n");

  const modules: FixtureModule[] = [
    {
      id: "lifecycle",
      kind: "capability",
      depends_on: ["kernel"],
      index: [
        MODULE_PUBLIC_API_DECLARATION,
        ...NEUTRAL_CORE_MEMBERS.map(
          (member) => `export * from "./workflows/${member.replace(/\.ts$/, "")}";`
        ),
        'export * from "./workflows/lifecycle-ports";',
        "",
      ].join("\n"),
      workflows: coreWorkflows,
    },
    {
      id: "kernel",
      kind: "substrate",
      index: [MODULE_PUBLIC_API_DECLARATION, 'export * from "./workflows/module-contracts";', ""].join("\n"),
      workflows: {
        "module-contracts.ts": [
          'export const MODULE_CONTRACT_VERSION = "guild.module.v1" as const;',
          "",
        ].join("\n"),
      },
    },
    {
      id: "host-runtime",
      kind: "capability",
      depends_on: ["lifecycle"],
      index: [MODULE_PUBLIC_API_DECLARATION, 'export * from "./workflows/adapter";', ""].join("\n"),
      workflows: {
        "adapter.ts": [
          'import { LIFECYCLE_PORT_VERSION } from "../../lifecycle";',
          "",
          "/** Native event binding stays ADAPTER-owned (MOD-002). */",
          "export function bindNativeHostEvent(nativeEvent: string): string {",
          "  return `${LIFECYCLE_PORT_VERSION}:${nativeEvent}`;",
          "}",
          "",
        ].join("\n"),
      },
    },
    {
      id: "dispatch",
      kind: "capability",
      depends_on: ["lifecycle"],
      index: [MODULE_PUBLIC_API_DECLARATION, 'export * from "./workflows/transport";', ""].join("\n"),
      workflows: {
        "transport.ts": [
          'import { LIFECYCLE_PORT_VERSION } from "../../lifecycle";',
          "",
          "// A RE-EXPORT edge and a DYNAMIC edge, so the graph scan is provably",
          "// complete rather than static-import shaped (MOD-001).",
          'export * from "./transport-errors";',
          "",
          "export async function runTransport(command: string): Promise<string> {",
          '  const errors = await import("./transport-errors");',
          "  return `${LIFECYCLE_PORT_VERSION}:${errors.TRANSPORT_ERROR_TYPE}:${command}`;",
          "}",
          "",
        ].join("\n"),
        "transport-errors.ts": [
          'export const TRANSPORT_ERROR_TYPE = "guild.transport_outcome.v1" as const;',
          "",
        ].join("\n"),
      },
    },
    {
      id: "documents",
      kind: "capability",
      depends_on: ["lifecycle"],
      index: [MODULE_PUBLIC_API_DECLARATION, 'export * from "./workflows/service";', ""].join("\n"),
      workflows: {
        "service.ts": [
          'import { LIFECYCLE_PORT_VERSION } from "../../lifecycle";',
          "",
          "export function renderDocument(body: string): string {",
          "  return `${LIFECYCLE_PORT_VERSION}:${body}`;",
          "}",
          "",
        ].join("\n"),
      },
    },
  ];

  for (const module of modules) {
    const base = `plugin/src/modules/${module.id}`;
    files[`${base}/module.manifest.json`] = manifestJson(
      module.id,
      module.kind,
      `MH-07 fixture module ${module.id}`,
      module.depends_on
    );
    files[`${base}/index.ts`] = module.index;
    files[`${base}/resources/.generated-by-guild-module-resources`] = "generated by the MH-07 fixture\n";
    files[`${base}/resources/module-resources.json`] = resourcesJson(module.id);
    for (const [name, source] of Object.entries(module.workflows)) {
      files[`${base}/workflows/${name}`] = source;
    }
  }

  files["website/src/render.ts"] = [
    'export const WEBSITE_CONTRACT_VERSION = "guild.website.contract.v1" as const;',
    "",
  ].join("\n");
  files["benchmark/src/run.ts"] = [
    'export const BENCHMARK_CONTRACT_VERSION = "guild.benchmark.contract.v1" as const;',
    "",
  ].join("\n");

  return files;
}

/** Every planted REPOSITORY mutation, as a transform of the conforming map. */
const REPOSITORY_MUTATIONS: Readonly<Record<string, (files: Record<string, string>) => void>> = {
  "core-forbidden-edge": (files) => {
    const key = "plugin/src/modules/lifecycle/workflows/neutral-gate-policy.ts";
    files[key] = `${files[key]}\nimport * as nodeFs from "fs";\nexport const leaked = nodeFs;\n`;
  },
  "core-unclassified-edge": (files) => {
    const key = "plugin/src/modules/lifecycle/workflows/neutral-gate-policy.ts";
    files[key] = `${files[key]}\nimport thing from "some-npm-package";\nexport const leaked = thing;\n`;
  },
  "unclassified-module": (files) => {
    const base = "plugin/src/modules/invented-module";
    files[`${base}/module.manifest.json`] = manifestJson(
      "invented-module",
      "capability",
      "a module no role registry names"
    );
    files[`${base}/index.ts`] = 'export * from "./workflows/invented";\n';
    files[`${base}/workflows/invented.ts`] = "export const invented = 1;\n";
    files[`${base}/resources/.generated-by-guild-module-resources`] = "generated\n";
    files[`${base}/resources/module-resources.json`] = resourcesJson("invented-module");
  },
  "unresolvable-edge": (files) => {
    const key = "plugin/src/modules/documents/workflows/service.ts";
    files[key] = `${files[key]}\nconst chosen = String(process.env.MODE);\nexport const late = require(chosen);\n`;
  },
  "adapter-policy-owner": (files) => {
    const key = "plugin/src/modules/host-runtime/workflows/adapter.ts";
    files[key] =
      `${files[key]}\nexport function decideLifecycleSelection(candidate: string): string {\n  return candidate;\n}\n`;
  },
  "adapter-private-import": (files) => {
    const key = "plugin/src/modules/host-runtime/workflows/adapter.ts";
    files[key] =
      `import { decideLifecycleSelection } from "../../lifecycle/workflows/lifecycle-ports";\nexport const reached = decideLifecycleSelection;\n${files[key]}`;
  },
  "transport-lifecycle-decision": (files) => {
    const key = "plugin/src/modules/dispatch/workflows/transport.ts";
    files[key] = `${files[key]}\nexport function advanceLifecyclePhase(phase: string): string {\n  return phase;\n}\n`;
  },
  "transport-host-branching": (files) => {
    const key = "plugin/src/modules/dispatch/workflows/transport.ts";
    files[key] = [
      files[key],
      "export function routeByHost(hostId: string): string {",
      "  switch (hostId) {",
      '    case "claude-code-cli":',
      '      return "native";',
      "    default:",
      '      return "wrapped";',
      "  }",
      "}",
      "",
    ].join("\n");
  },
  "transport-port-detached": (files) => {
    const key = "plugin/src/modules/dispatch/workflows/transport.ts";
    files[key] = files[key]
      .replace('import { LIFECYCLE_PORT_VERSION } from "../../lifecycle";\n', "")
      .replace(/\$\{LIFECYCLE_PORT_VERSION\}/g, "transport");
  },
  "native-binding-outside-adapter": (files) => {
    const key = "plugin/src/modules/dispatch/workflows/transport.ts";
    files[key] = `${files[key]}\nexport function bindNativeHostEvent(nativeEvent: string): string {\n  return nativeEvent;\n}\n`;
  },
  "service-host-internal-import": (files) => {
    const key = "plugin/src/modules/documents/workflows/service.ts";
    files[key] =
      `import { scrubbedWrite } from "../../../../hooks/lib/security/scrubbed-write";\nexport const reached = scrubbedWrite;\n${files[key]}`;
  },
  "service-dynamic-host-import": (files) => {
    const key = "plugin/src/modules/documents/workflows/service.ts";
    files[key] =
      `${files[key]}\nexport async function late(): Promise<unknown> {\n  return import("../../../../hooks/lib/run-state");\n}\n`;
  },
  "service-reexport-host-import": (files) => {
    const key = "plugin/src/modules/documents/workflows/service.ts";
    files[key] = `${files[key]}\nexport * from "../../../../scripts/lib/roster";\n`;
  },
  "service-missing-contract-version": (files) => {
    const key = "plugin/src/modules/documents/index.ts";
    files[key] = files[key].replace(`${MODULE_PUBLIC_API_DECLARATION}\n`, "");
  },
  "consumer-imports-plugin-source": (files) => {
    files["website/src/render.ts"] = [
      'import { LIFECYCLE_PORT_VERSION } from "../../plugin/src/modules/lifecycle/workflows/lifecycle-ports";',
      "export const reached = LIFECYCLE_PORT_VERSION;",
      "",
      files["website/src/render.ts"],
    ].join("\n");
  },
};

const REPOSITORY_MUTATION_IDS: readonly string[] = Object.keys(REPOSITORY_MUTATIONS);

/**
 * The scenario each planted repository must leave UNSATISFIED.
 *
 * `flipsOn` below accepts a typed refusal as an answer to a broken tree, which
 * is correct for a future evaluator that legitimately refuses one — but it is
 * also an escape hatch that could let a mutation pass without ever biting. This
 * map is the single statement of what each mutation targets, and
 * §"flips a scenario rather than escaping through a refusal" holds the ORACLE to
 * the strict reading: a real packet, with that scenario unsatisfied.
 */
const MUTATION_TARGET: Readonly<Record<string, string>> = {
  "core-forbidden-edge": "MHRC-MOD-001",
  "core-unclassified-edge": "MHRC-MOD-001",
  "unclassified-module": "MHRC-MOD-001",
  "unresolvable-edge": "MHRC-MOD-001",
  "adapter-policy-owner": "MHRC-MOD-002",
  "adapter-private-import": "MHRC-MOD-002",
  "native-binding-outside-adapter": "MHRC-MOD-002",
  "transport-lifecycle-decision": "MHRC-MOD-003",
  "transport-host-branching": "MHRC-MOD-003",
  "transport-port-detached": "MHRC-MOD-003",
  "service-host-internal-import": "MHRC-MOD-004",
  "service-dynamic-host-import": "MHRC-MOD-004",
  "service-reexport-host-import": "MHRC-MOD-004",
  "service-missing-contract-version": "MHRC-MOD-004",
  "consumer-imports-plugin-source": "MHRC-MOD-004",
};

interface FixtureRepository {
  readonly base: string;
  readonly plugin_root: string;
  readonly consumer_roots: Readonly<Record<string, string>>;
}

function materialize(base: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(base, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

const repositoryCache = new Map<string, FixtureRepository>();

/** The conforming repository, or one planted mutation of it. Memoized. */
function repository(mutation: string | null): FixtureRepository {
  const key = mutation ?? "conforming";
  const cached = repositoryCache.get(key);
  if (cached !== undefined) return cached;
  const files = conformingFiles();
  if (mutation !== null) {
    const mutate = REPOSITORY_MUTATIONS[mutation];
    if (mutate === undefined) throw new Error(`unknown repository mutation ${mutation}`);
    mutate(files);
  }
  const base = tempBase(key);
  materialize(base, files);
  const built: FixtureRepository = {
    base,
    plugin_root: path.join(base, "plugin"),
    consumer_roots: { website: path.join(base, "website"), benchmark: path.join(base, "benchmark") },
  };
  repositoryCache.set(key, built);
  return built;
}

function baseRequest(overrides: Record<string, unknown> = {}): Mh07ConformanceRequest {
  const repo = repository(null);
  return {
    run_id: RUN_ID,
    plugin_root: repo.plugin_root,
    consumer_roots: repo.consumer_roots,
    evidence_identity: IDENTITY,
    receipt_refs: receiptRefs(),
    evidence_freshness: freshnessMap(),
    ...overrides,
  } as Mh07ConformanceRequest;
}

function requestFor(mutation: string, overrides: Record<string, unknown> = {}): Mh07ConformanceRequest {
  const repo = repository(mutation);
  return baseRequest({
    plugin_root: repo.plugin_root,
    consumer_roots: repo.consumer_roots,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Independent analysis over the REAL production primitives
// ---------------------------------------------------------------------------

function walkTs(dir: string, excluded: readonly string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excluded.indexOf(entry.name) !== -1) continue;
      found.push(...walkTs(full, excluded));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found.sort();
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function relativeTo(root: string, target: string): string {
  return toPosix(path.relative(root, target));
}

/** The `.ts` resolution the module boundary rail itself uses. */
function resolveRelative(importer: string, specifier: string): string {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [base, `${base}.ts`, path.join(base, "index.ts")];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? base;
}

function moduleIdOfPath(root: string, target: string, moduleIds: readonly string[]): string | null {
  const rel = relativeTo(path.join(root, "src", "modules"), target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const [head] = rel.split("/");
  return moduleIds.indexOf(head) === -1 ? null : head;
}

/**
 * The destination class of one edge, from the closed vocabulary.
 *
 * `unclassified` is reserved for a destination that leaves the repository or
 * lands nowhere the vocabulary names. It is a FAILURE, never a pass — that is
 * the whole of MOD-001's third assertion.
 */
function classifyDestination(
  root: string,
  importer: string,
  specifier: string,
  fromModule: string,
  moduleIds: readonly string[]
): { destination_class: string; imported: string | null; to_module: string | null } {
  if (!specifier.startsWith(".")) {
    const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
    const isBuiltin = specifier.startsWith("node:") || MH07_NODE_BUILTINS.indexOf(bare) !== -1;
    return {
      destination_class: isBuiltin ? "node_builtin" : "external_package",
      imported: null,
      to_module: null,
    };
  }
  const resolved = resolveRelative(importer, specifier);
  const rel = relativeTo(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { destination_class: "unclassified", imported: rel, to_module: null };
  }
  const [head] = rel.split("/");
  if (head === "hooks" || head === "scripts") {
    return { destination_class: "host_facing_mirror", imported: rel, to_module: head };
  }
  const toModule = moduleIdOfPath(root, resolved, moduleIds);
  if (toModule === null) {
    return { destination_class: "unclassified", imported: rel, to_module: null };
  }
  if (toModule === fromModule) {
    return { destination_class: "intra_module", imported: rel, to_module: toModule };
  }
  const publicIndex = path.join(root, "src", "modules", toModule, "index.ts");
  const isPublic = path.resolve(resolved) === path.resolve(publicIndex);
  return {
    destination_class: isPublic ? "module_public_index" : "module_private",
    imported: rel,
    to_module: toModule,
  };
}

/**
 * The complete top-level dependency graph of a module tree.
 *
 * Edges come from the PRODUCTION token-based extractor, so `import()`,
 * `require()`, `export … from`, bare `import "s"`, and type-only imports are all
 * present, and a comment or a string cannot invent one. A regex over static
 * imports would silently produce a smaller graph and call it complete.
 */
function scanDependencyGraph(
  root: string,
  extract: typeof extractNeutralImportEdges = extractNeutralImportEdges,
  moduleIdsOverride?: readonly string[]
): Mh07DependencyGraph {
  const modulesDir = path.join(root, "src", "modules");
  const moduleIds =
    moduleIdsOverride ??
    (fs.existsSync(modulesDir)
      ? fs
          .readdirSync(modulesDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()
      : []);
  const files = walkTs(modulesDir, MH07_GRAPH_SCOPE.excluded_directories);
  const nodes: string[] = [];
  const edges: Mh07GraphEdge[] = [];
  const unresolved: { importer: string; form: string; detail: string }[] = [];
  const ambient: { importer: string; detail: string }[] = [];

  for (const file of files) {
    const rel = relativeTo(root, file);
    nodes.push(rel);
    const fromModule = moduleIdOfPath(root, file, moduleIds);
    if (fromModule === null) continue;
    const extracted: readonly NeutralImportEdge[] = extract(fs.readFileSync(file, "utf8"));
    for (const edge of extracted) {
      if (edge.kind === "unresolved") {
        const detail = edge.detail ?? "";
        // `require.main`/`require.resolve` are member accesses on the ambient
        // binding, not module references. Recorded so nothing is dropped, but
        // they are not dependency edges and do not fail the graph.
        if (edge.form === "require" && detail.indexOf("require used as a value") === 0) {
          ambient.push({ importer: rel, detail });
        } else {
          unresolved.push({ importer: rel, form: edge.form, detail });
        }
        continue;
      }
      const specifier = edge.specifier ?? "";
      const classified = classifyDestination(root, file, specifier, fromModule, moduleIds);
      edges.push({
        importer: rel,
        specifier,
        form: edge.form,
        imported: classified.imported,
        destination_class: classified.destination_class,
        from_module: fromModule,
        to_module: classified.to_module,
      });
    }
  }

  return neutralFreeze({
    node_count: nodes.length,
    edge_count: edges.length,
    nodes,
    edges,
    unresolved,
    ambient_uses: ambient,
  }) as unknown as Mh07DependencyGraph;
}

/** The names a source file EXPORTS, read through the production tokenizer. */
function declaredExportNames(
  source: string,
  tokenize: typeof tokenizeNeutralSource = tokenizeNeutralSource
): string[] {
  const tokens = tokenize(source);
  const names: string[] = [];
  const declarationHeads = ["function", "const", "let", "var", "class", "async", "interface", "type", "enum"];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "ident" || token.value !== "export") continue;
    let cursor = index + 1;
    while (
      cursor < tokens.length &&
      tokens[cursor].kind === "ident" &&
      declarationHeads.indexOf(tokens[cursor].value) !== -1
    ) {
      cursor += 1;
    }
    const candidate = tokens[cursor];
    if (candidate !== undefined && candidate.kind === "ident" && names.indexOf(candidate.value) === -1) {
      names.push(candidate.value);
    }
    // `export { a, b }` — every ident up to the closing brace is exported.
    if (tokens[index + 1]?.kind === "punct" && tokens[index + 1]?.value === "{") {
      for (let scan = index + 2; scan < tokens.length; scan += 1) {
        const entry = tokens[scan];
        if (entry.kind === "punct" && entry.value === "}") break;
        if (entry.kind === "ident" && names.indexOf(entry.value) === -1) names.push(entry.value);
      }
    }
  }
  return names;
}

/**
 * Does this source branch on a host identity?
 *
 * `case "<recognized host id>"` and nothing looser: a module that merely NAMES a
 * host (the core's own recognized-host table does) is not branching on one, and
 * a rule that could not tell the two apart would fire on the real core.
 */
function branchesOnHostId(
  source: string,
  hostIds: readonly string[],
  tokenize: typeof tokenizeNeutralSource = tokenizeNeutralSource
): string[] {
  const tokens = tokenize(source);
  const found: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token.kind !== "ident" || token.value !== "case") continue;
    if (next.kind !== "string") continue;
    if (hostIds.indexOf(next.value) !== -1 && found.indexOf(next.value) === -1) found.push(next.value);
  }
  return found;
}

function sha256Of(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(neutralCanonicalJson(value)).digest("hex")}`;
}

/** A content digest of a whole tree — the no-write proof's before/after value. */
function treeDigest(root: string): string {
  const entries: { path: string; sha: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        entries.push({
          path: relativeTo(root, full),
          sha: crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex"),
        });
      }
    }
  };
  walk(root);
  return sha256Of(entries);
}

// ---------------------------------------------------------------------------
// The evidence profile the frozen contract assigns all four scenarios
// ---------------------------------------------------------------------------

const MH07_EVIDENCE_PROFILE_ID = MH07_EVIDENCE_PROFILE;

/**
 * `E-BOUNDARY`, transcribed from the frozen contract.
 *
 * HONEST GAP #3: the core's `NEUTRAL_EVIDENCE_PROFILES` declares only
 * `E-LIFECYCLE` and `E-REFUSAL`, so `validateNeutralScenarioRegistry` cannot yet
 * accept a registry that names the profile the frozen contract assigns to all
 * four MH-07 scenarios. The implementing lane must add this exact entry to the
 * core table; this suite requires it (§"the production MH-07 evaluator") and
 * does NOT edit the core to provide it.
 */
const MH07_EVIDENCE_PROFILE_DEFINITION = {
  required_kinds: ["dependency_graph", "boundary_verdict"],
  required_bindings: ["scenario_id", "source_commit", "module_manifest_version"],
} as const;

/**
 * Does a registry satisfy the core's frozen `scenario_field_contract`?
 *
 * It tolerates EXACTLY ONE deviation, and only while that deviation is real: an
 * `unknown evidence profile` error naming a profile the core genuinely does not
 * declare. Every other error is a failure, and once the core declares the
 * profile the verdict simply succeeds — so this helper cannot rot into a blanket
 * exemption.
 */
function registrySatisfiesFieldContract(
  scenarios: readonly NeutralScenarioDefinition[],
  profileId: string
): { ok: boolean; detail: string } {
  const verdict = validateNeutralScenarioRegistry(scenarios);
  if (verdict.disposition === "succeeded") return { ok: true, detail: "" };
  const errors = ((verdict.facts as Record<string, unknown>).errors ?? []) as readonly string[];
  const profileDeclared = (NEUTRAL_EVIDENCE_PROFILES as Record<string, unknown>)[profileId] !== undefined;
  const expected = `unknown evidence profile ${JSON.stringify(profileId)}`;
  const unexpected = errors.filter((error) => error.indexOf(expected) === -1);
  if (!profileDeclared && errors.length > 0 && unexpected.length === 0) {
    return { ok: true, detail: `tolerated named gap: the core does not declare ${profileId}` };
  }
  return { ok: false, detail: neutralCanonicalJson(errors) };
}

/** Every edge a consumer root declares into the plugin's own source tree. */
function consumerSourceReaches(
  consumerRoot: string,
  pluginRoot: string,
  extract: typeof extractNeutralImportEdges = extractNeutralImportEdges
): { consumer_file: string; specifier: string; imported: string }[] {
  const found: { consumer_file: string; specifier: string; imported: string }[] = [];
  const pluginSource = path.resolve(path.join(pluginRoot, "src"));
  for (const file of walkTs(consumerRoot, [])) {
    for (const edge of extract(fs.readFileSync(file, "utf8"))) {
      if (edge.kind !== "resolved" || edge.specifier === undefined) continue;
      if (!edge.specifier.startsWith(".")) continue;
      const resolved = path.resolve(resolveRelative(file, edge.specifier));
      if (resolved === pluginSource || resolved.startsWith(`${pluginSource}${path.sep}`)) {
        found.push({
          consumer_file: relativeTo(consumerRoot, file),
          specifier: edge.specifier,
          imported: relativeTo(pluginRoot, resolved),
        });
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// The subject under test — the real evaluator or a disposable stand-in
// ---------------------------------------------------------------------------

interface Mh07Subject {
  readonly label: string;
  readonly evaluate: Mh07EvaluateFn;
  readonly scanGraph: Mh07ScanGraphFn;
  readonly scenarioIds: readonly string[];
  readonly ownerKey: string;
  readonly packetSchema: string;
  readonly scenarios: readonly NeutralScenarioDefinition[];
  readonly moduleRoles: Readonly<Record<string, string>>;
  readonly roles: readonly string[];
  readonly destinationClasses: readonly string[];
  readonly edgeForms: readonly string[];
  readonly lifecycleDecisionSymbols: readonly string[];
  readonly nativeEventBindingSymbols: readonly string[];
  readonly evidenceProfileId: string;
  readonly evaluatorVersion: string;
  readonly scannerVersion: string;
  readonly graphScope: { readonly excluded_directories: readonly string[] };
}

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

function evidenceOf(result: Mh07ConformanceResult): readonly Mh07ScenarioEvidence[] {
  const evidence = (result.outcome.facts as Record<string, unknown>).evidence;
  assert(Array.isArray(evidence), "outcome.facts.evidence must be an ordered array of scenario observations");
  return evidence as readonly Mh07ScenarioEvidence[];
}

function evidenceFor(result: Mh07ConformanceResult, stableId: string): Mh07ScenarioEvidence {
  const found = evidenceOf(result).find((entry) => entry && entry.stable_id === stableId);
  assert(found !== undefined, `outcome.facts.evidence carries no observation for ${stableId}`);
  return found as Mh07ScenarioEvidence;
}

function sourceBindingOf(result: Mh07ConformanceResult): Record<string, unknown> {
  const binding = (result.outcome.facts as Record<string, unknown>).source_binding;
  assert(
    binding !== null && typeof binding === "object" && !Array.isArray(binding),
    "outcome.facts.source_binding must be a record binding the packet to the source it was produced from"
  );
  return binding as Record<string, unknown>;
}

function resultFor(packet: Mh07OwnerPacket | null, stableId: string): NeutralScenarioResult {
  assert(packet !== null, `expected a packet carrying ${stableId}, got null`);
  const found = (packet as Mh07OwnerPacket).results.find((entry) => entry && entry.stable_id === stableId);
  assert(found !== undefined, `the packet carries no result for ${stableId}`);
  return found as NeutralScenarioResult;
}

function accepted(
  subject: Mh07Subject,
  request: Mh07ConformanceRequest = baseRequest()
): Mh07ConformanceResult {
  const result = subject.evaluate(request);
  assert(result !== null && typeof result === "object", "the evaluator must return a result record");
  assert(result.packet !== null, "a well-formed request must produce a packet");
  return result;
}

/** A frozen value: a write attempt either throws or changes nothing. */
function isImmutable(container: unknown, key: string | number, value: unknown): boolean {
  const target = container as Record<string | number, unknown>;
  const before = target[key];
  try {
    target[key] = value;
  } catch {
    return true;
  }
  return target[key] === before;
}

/**
 * A conforming packet for an owner this lane does not own.
 *
 * DISPOSABLE and test-local: it exists only so the real assembler has its other
 * five inputs. It claims nothing about those owners' evaluators — none of which
 * exist yet either.
 */
function disposablePacketFor(ownerKey: string): Mh07OwnerPacket {
  const ids = canonicalIdsFor(ownerKey);
  const packet: Record<string, unknown> = {};
  packet["schema_version"] = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;
  packet["suite_id"] = NEUTRAL_SCENARIO_SUITE_ID;
  packet["suite_version"] = NEUTRAL_SCENARIO_SUITE_VERSION;
  packet["owner_key"] = ownerKey;
  packet["evidence_identity"] = IDENTITY;
  packet["stable_ids"] = [...ids];
  packet["results"] = ids.map((stableId) => ({
    stable_id: stableId,
    outcome_type: "guild.lifecycle_outcome.v1",
    disposition: "succeeded",
    reason_code: null,
    receipt_ref: receiptRefFor(stableId),
    evidence_identity: IDENTITY,
    evidence_freshness: "fresh",
  }));
  return packet as unknown as Mh07OwnerPacket;
}

// ---------------------------------------------------------------------------
// The disposable conforming oracle
// ---------------------------------------------------------------------------

/**
 * A test-owned implementation that satisfies every control by driving the REAL
 * module-system primitives over a disposable repository.
 *
 * It exists for two reasons and neither is "reference implementation". First,
 * anti-vacuity: a battery no implementation can pass proves nothing, and a
 * battery every implementation passes proves less. Second, SATISFIABILITY: a RED
 * contract nobody can meet is a bad contract, and this oracle demonstrates that
 * all four MH-07 scenarios are genuinely evaluable against production primitives
 * as they stand today.
 *
 * It is DISPOSABLE. It is not the shape production must take, only evidence that
 * the shape production must take exists.
 */
const ORACLE_SCENARIO_IDS: readonly string[] = Object.freeze([...MH07_IDS]);
const ORACLE_EVALUATOR_VERSION = "guild.module_boundary_evaluator.v1";
const ORACLE_SCANNER_VERSION = "guild.module_boundary_scanner.v1";

const MH07_SCENARIO_BOUNDARY_INPUT: Readonly<Record<string, string>> = {
  "MHRC-MOD-001": "core_to_concrete",
  "MHRC-MOD-002": "adapter_policy_ownership",
  "MHRC-MOD-003": "transport_policy_ownership",
  "MHRC-MOD-004": "consumer_to_internal",
};

const MH07_SCENARIO_TITLES: Readonly<Record<string, string>> = {
  "MHRC-MOD-001": "Host-neutral core imports no concrete host or transport implementation",
  "MHRC-MOD-002": "Host adapters do not own lifecycle policy",
  "MHRC-MOD-003": "Execution transports do not decide lifecycle policy",
  "MHRC-MOD-004": "Services and consumers use public contracts only",
};

const MH07_SCENARIO_PRECONDITIONS: Readonly<Record<string, readonly string[]>> = {
  "MHRC-MOD-001": [
    "the complete top-level dependency graph is available",
    "core public modules are classified",
    "host adapters, hooks, wrappers, launchers, and transports are classified",
  ],
  "MHRC-MOD-002": [
    "adapter and lifecycle modules are classified",
    "normalized-event and capability ports are declared",
  ],
  "MHRC-MOD-003": [
    "pane, tmux, remote, wrapper, and launcher transports are classified",
    "transport ports are declared",
  ],
  "MHRC-MOD-004": [
    "artifact, document, knowledge, benchmark, and website consumers are classified",
    "public contract bundle exports are declared",
  ],
};

const MH07_SCENARIO_ASSERTIONS: Readonly<Record<string, readonly string[]>> = {
  "MHRC-MOD-001": [
    "no core-to-concrete dependency edge exists",
    "dynamic and re-export edges are included",
    "unclassified destinations fail the verdict",
  ],
  "MHRC-MOD-002": [
    "adapters depend on public lifecycle ports only",
    "adapter modules contain no lifecycle decision ownership",
    "native event binding remains adapter-owned",
  ],
  "MHRC-MOD-003": [
    "transports implement execution ports only",
    "host branching is absent from core and generic launchers",
    "transport errors return typed outcomes",
  ],
  "MHRC-MOD-004": [
    "services import no host internals",
    "external consumers import no plugin source",
    "consumer contract versions are explicit",
  ],
};

function oracleScenarios(): readonly NeutralScenarioDefinition[] {
  return Object.freeze(
    MH07_IDS.map((stableId) => {
      const expected = MH07_EXPECTED[stableId];
      return {
        stable_id: stableId,
        category: MH07_CATEGORY,
        title: MH07_SCENARIO_TITLES[stableId],
        preconditions: [...MH07_SCENARIO_PRECONDITIONS[stableId]],
        action_event: { name: "runtime.verify", input: { boundary: MH07_SCENARIO_BOUNDARY_INPUT[stableId] } },
        expected_typed_outcome: {
          type: expected.type,
          disposition: expected.disposition,
          assertions: [...MH07_SCENARIO_ASSERTIONS[stableId]],
        },
        evidence_requirements: [
          {
            profile: MH07_EVIDENCE_PROFILE_ID,
            assertions: [
              "full graph node and edge counts are recorded",
              "the verdict is bound to the source it was produced from",
            ],
          },
        ],
        implementation_wave_owner: { wave_id: "W4", work_item_id: "MH-07", key: OWNER_KEY_MH07 },
      } as unknown as NeutralScenarioDefinition;
    })
  );
}

function refuseEvaluation(
  control: string,
  reasonCode: string,
  assertions: readonly string[],
  facts: Record<string, unknown> = {}
): Mh07ConformanceResult {
  const merged: Record<string, unknown> = { ...facts };
  merged.refusal_control = control;
  merged.owner_key = OWNER_KEY_MH07;
  merged.evidence = [];
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "refused",
      reason_code: reasonCode as never,
      assertions: [...assertions],
      facts: merged,
    }),
    packet: null,
  };
}

function identityIsComplete(identity: unknown): boolean {
  if (identity === null || typeof identity !== "object") return false;
  const record = identity as Record<string, unknown>;
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    const value = record[field];
    if (field === "contract_version") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}

/** The role registry the oracle classifies with. Source-owned, never requested. */
const ORACLE_MODULE_ROLES: Readonly<Record<string, string>> = FIXTURE_MODULE_ROLES;

function oracleEvaluate(request: Mh07ConformanceRequest): Mh07ConformanceResult {
  // -- 1. channels a caller may not open ------------------------------------
  const asRecord = (request ?? {}) as unknown as Record<string, unknown>;
  if ("stable_ids" in asRecord) {
    return refuseEvaluation(REFUSAL_CONTROLS.callerSuppliedIds, "scenario_required_set_mismatch", [
      "the covered scenario set has exactly one source, and it is this module",
      "an agreeing caller-supplied set is refused too, because accepting a matching copy accepts the channel",
    ]);
  }
  if ("dependency_graph" in asRecord) {
    return refuseEvaluation(REFUSAL_CONTROLS.callerSuppliedGraph, "scenario_evidence_incomplete", [
      "the graph is SCANNED from source bytes, never supplied",
      "a caller-authored graph is a claim about the boundary, not evidence of it",
    ]);
  }
  if ("module_scope" in asRecord) {
    return refuseEvaluation(REFUSAL_CONTROLS.callerSuppliedScope, "scenario_evidence_incomplete", [
      "the scanned scope is source-owned, so a caller cannot shrink the graph it is judged on",
    ]);
  }

  // -- 2. the identity and the evidence bindings ----------------------------
  if (!identityIsComplete(request.evidence_identity)) {
    return refuseEvaluation(REFUSAL_CONTROLS.identityIncomplete, "scenario_evidence_incomplete", [
      "evidence that names no complete identity is bound to no runtime",
    ]);
  }
  for (const stableId of ORACLE_SCENARIO_IDS) {
    const receiptRef = request.receipt_refs?.[stableId];
    const freshness = request.evidence_freshness?.[stableId];
    if (typeof receiptRef !== "string" || receiptRef.length === 0) {
      return refuseEvaluation(REFUSAL_CONTROLS.evidenceBindingMissing, "scenario_receipt_reference_missing", [
        "every scenario result commits to a receipt reference",
      ]);
    }
    if (NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS.indexOf(freshness as never) === -1) {
      return refuseEvaluation(REFUSAL_CONTROLS.evidenceBindingMissing, "scenario_evidence_incomplete", [
        "every scenario result carries a typed freshness verdict",
      ]);
    }
  }
  const consumerRoots = request.consumer_roots ?? {};
  for (const [name, root] of Object.entries(consumerRoots)) {
    if (typeof root !== "string" || !fs.existsSync(root)) {
      return refuseEvaluation(REFUSAL_CONTROLS.evidenceBindingMissing, "scenario_evidence_incomplete", [
        "a declared consumer root that is not present was not scanned, and an unscanned consumer proves nothing",
      ], { consumer_root: name });
    }
  }

  // -- 3. the real production primitives ------------------------------------
  const port = request.scanner ?? REAL_SCANNER;
  const root = request.plugin_root;
  let manifests: ModuleManifest[];
  try {
    manifests = port.loadModuleManifests(root) as ModuleManifest[];
  } catch (error) {
    return refuseEvaluation(REFUSAL_CONTROLS.sourceBindingIncomplete, "scenario_evidence_incomplete", [
      "a module tree whose manifests do not load cannot be bound to a verdict",
    ], { load_error: String((error as Error)?.message ?? error) });
  }
  if (manifests.length === 0) {
    return refuseEvaluation(REFUSAL_CONTROLS.sourceBindingIncomplete, "scenario_evidence_incomplete", [
      "an empty module set is not a proof of an empty violation set",
    ], { manifest_count: 0 });
  }
  let inventory: ReturnType<typeof buildInventory>;
  try {
    inventory = port.buildInventory(root);
  } catch (error) {
    return refuseEvaluation(REFUSAL_CONTROLS.sourceBindingIncomplete, "scenario_evidence_incomplete", [
      "the ownership rail needs the real inventory of the tree being judged",
    ], { inventory_error: String((error as Error)?.message ?? error) });
  }

  const ownership = port.validateModuleOwnership(inventory, manifests);
  const boundaries = port.validateModuleBoundaries(root, manifests);
  const health = port.validateModuleHealth(root, manifests);
  const moduleIds = manifests.map((manifest) => manifest.id).sort();
  const graph = scanDependencyGraph(root, port.extractNeutralImportEdges, moduleIds);

  const coreDir = path.join(root, "src", "modules", "lifecycle", "workflows");
  const coreFiles: { path: string; source: string }[] = [];
  const missingCoreMembers: string[] = [];
  for (const member of NEUTRAL_CORE_MEMBERS) {
    const memberPath = path.join(coreDir, member);
    if (!fs.existsSync(memberPath)) {
      missingCoreMembers.push(member);
      continue;
    }
    coreFiles.push({ path: member, source: fs.readFileSync(memberPath, "utf8") });
  }
  const coreVerdict =
    missingCoreMembers.length > 0 ? null : port.evaluateNeutralCoreBoundary(coreFiles);

  // -- 4. classification, the precondition every scenario opens with --------
  const roleOf = (moduleId: string | null): string | null =>
    moduleId === null ? null : ORACLE_MODULE_ROLES[moduleId] ?? null;
  const unclassifiedModules = moduleIds.filter((id) => roleOf(id) === null);
  const modulesWithRole = (role: string): string[] => moduleIds.filter((id) => roleOf(id) === role);

  const sourcesOf = (moduleId: string): { path: string; source: string }[] =>
    walkTs(path.join(root, "src", "modules", moduleId), MH07_GRAPH_SCOPE.excluded_directories).map(
      (file) => ({ path: relativeTo(root, file), source: fs.readFileSync(file, "utf8") })
    );

  const declaredSymbolFindings = (
    moduleIdsToScan: readonly string[],
    symbols: readonly string[]
  ): { module_id: string; file: string; symbol: string }[] => {
    const findings: { module_id: string; file: string; symbol: string }[] = [];
    for (const moduleId of moduleIdsToScan) {
      for (const entry of sourcesOf(moduleId)) {
        for (const name of declaredExportNames(entry.source, port.tokenizeNeutralSource)) {
          if (symbols.indexOf(name) !== -1) {
            findings.push({ module_id: moduleId, file: entry.path, symbol: name });
          }
        }
      }
    }
    return findings;
  };

  const violationsFrom = (moduleIdsToScan: readonly string[]): ModuleBoundaryViolation[] =>
    boundaries.violations.filter((violation) => moduleIdsToScan.indexOf(violation.from_module) !== -1);

  const adapterModules = modulesWithRole("host_adapter");
  const transportModules = modulesWithRole("execution_transport");
  const serviceModules = modulesWithRole("service");
  const coreModules = modulesWithRole("neutral_core");
  const nonAdapterModules = moduleIds.filter((id) => roleOf(id) !== "host_adapter");

  // -- MHRC-MOD-001 ---------------------------------------------------------
  const unclassifiedEdges = graph.edges.filter((edge) => edge.destination_class === "unclassified");
  const mod001Satisfied =
    coreVerdict !== null &&
    coreVerdict.disposition === "succeeded" &&
    unclassifiedModules.length === 0 &&
    unclassifiedEdges.length === 0 &&
    graph.unresolved.length === 0 &&
    graph.node_count > 0 &&
    graph.edge_count > 0 &&
    health.ok;

  // -- MHRC-MOD-002 ---------------------------------------------------------
  const adapterViolations = violationsFrom(adapterModules);
  const adapterPolicyOwners = declaredSymbolFindings(adapterModules, MH07_LIFECYCLE_DECISION_SYMBOLS);
  const strayNativeBindings = declaredSymbolFindings(
    nonAdapterModules,
    MH07_NATIVE_EVENT_BINDING_SYMBOLS
  );
  const mod002Satisfied =
    adapterModules.length > 0 &&
    adapterViolations.length === 0 &&
    adapterPolicyOwners.length === 0 &&
    strayNativeBindings.length === 0 &&
    ownership.ok;

  // -- MHRC-MOD-003 ---------------------------------------------------------
  const transportViolations = violationsFrom(transportModules);
  const transportPolicyOwners = declaredSymbolFindings(
    transportModules,
    MH07_LIFECYCLE_DECISION_SYMBOLS
  );
  const hostBranchingFindings: { module_id: string; file: string; host_id: string }[] = [];
  for (const moduleId of [...coreModules, ...transportModules]) {
    for (const entry of sourcesOf(moduleId)) {
      for (const hostId of branchesOnHostId(entry.source, NEUTRAL_RECOGNIZED_HOST_IDS, port.tokenizeNeutralSource)) {
        hostBranchingFindings.push({ module_id: moduleId, file: entry.path, host_id: hostId });
      }
    }
  }
  const transportsWithoutPortReach = transportModules.filter(
    (moduleId) =>
      !graph.edges.some(
        (edge) =>
          edge.from_module === moduleId &&
          edge.destination_class === "module_public_index" &&
          roleOf(edge.to_module) === "neutral_core"
      )
  );
  const mod003Satisfied =
    transportModules.length > 0 &&
    transportViolations.length === 0 &&
    transportPolicyOwners.length === 0 &&
    hostBranchingFindings.length === 0 &&
    transportsWithoutPortReach.length === 0;

  // -- MHRC-MOD-004 ---------------------------------------------------------
  const serviceViolations = violationsFrom(serviceModules);
  const servicesWithoutContractVersion = serviceModules.filter((moduleId) => {
    const indexPath = path.join(root, "src", "modules", moduleId, "index.ts");
    if (!fs.existsSync(indexPath)) return true;
    return fs.readFileSync(indexPath, "utf8").indexOf(MODULE_PUBLIC_API_DECLARATION) === -1;
  });
  const consumerReaches: { consumer: string; consumer_file: string; specifier: string; imported: string }[] = [];
  for (const [name, consumerRoot] of Object.entries(consumerRoots)) {
    for (const reach of consumerSourceReaches(consumerRoot, root, port.extractNeutralImportEdges)) {
      consumerReaches.push({ consumer: name, ...reach });
    }
  }
  const mod004Satisfied =
    serviceModules.length > 0 &&
    serviceViolations.length === 0 &&
    servicesWithoutContractVersion.length === 0 &&
    consumerReaches.length === 0;

  // -- 5. the source binding ------------------------------------------------
  const identity = request.evidence_identity as unknown as Record<string, unknown>;
  const manifestSchemaVersions = manifests
    .map((manifest) => manifest.schema_version as string)
    .filter((version, index, all) => all.indexOf(version) === index)
    .sort();
  const sourceBinding: Record<string, unknown> = {
    source_commit: identity.source_commit,
    module_ids: moduleIds,
    manifest_count: manifests.length,
    manifest_schema_versions: manifestSchemaVersions,
    manifest_digest: sha256Of(manifests),
    graph_digest: sha256Of({ nodes: graph.nodes, edges: graph.edges }),
    node_count: graph.node_count,
    edge_count: graph.edge_count,
    scanner_version: ORACLE_SCANNER_VERSION,
    evaluator_version: ORACLE_EVALUATOR_VERSION,
    graph_scope_excluded_directories: [...MH07_GRAPH_SCOPE.excluded_directories],
    consumer_roots_scanned: Object.keys(consumerRoots).sort(),
    core_members: [...NEUTRAL_CORE_MEMBERS],
  };

  const observations: Record<string, Record<string, unknown>> = {
    "MHRC-MOD-001": {
      core_disposition: coreVerdict === null ? null : coreVerdict.disposition,
      core_reason_code: coreVerdict === null ? null : coreVerdict.reason_code,
      missing_core_members: missingCoreMembers,
      forbidden_edges: coreVerdict === null ? null : coreVerdict.facts.forbidden_edges,
      unclassified_modules: unclassifiedModules,
      unclassified_edges: unclassifiedEdges,
      unresolved_edges: graph.unresolved,
      ambient_uses: graph.ambient_uses,
      node_count: graph.node_count,
      edge_count: graph.edge_count,
      health_ok: health.ok,
    },
    "MHRC-MOD-002": {
      adapter_modules: adapterModules,
      adapter_boundary_violations: adapterViolations,
      policy_owner_findings: adapterPolicyOwners,
      native_binding_outside_adapter: strayNativeBindings,
      ownership_ok: ownership.ok,
    },
    "MHRC-MOD-003": {
      transport_modules: transportModules,
      transport_boundary_violations: transportViolations,
      lifecycle_decision_findings: transportPolicyOwners,
      host_branching_findings: hostBranchingFindings,
      transports_without_port_reach: transportsWithoutPortReach,
    },
    "MHRC-MOD-004": {
      service_modules: serviceModules,
      service_boundary_violations: serviceViolations,
      services_without_contract_version: servicesWithoutContractVersion,
      consumer_source_reaches: consumerReaches,
    },
  };

  const satisfaction: Record<string, boolean> = {
    "MHRC-MOD-001": mod001Satisfied,
    "MHRC-MOD-002": mod002Satisfied,
    "MHRC-MOD-003": mod003Satisfied,
    "MHRC-MOD-004": mod004Satisfied,
  };

  const evidence = ORACLE_SCENARIO_IDS.map((stableId) => ({
    stable_id: stableId,
    satisfied: satisfaction[stableId],
    observed: observations[stableId],
  }));

  const results = ORACLE_SCENARIO_IDS.map((stableId) => {
    const expected = MH07_EXPECTED[stableId];
    const satisfied = satisfaction[stableId];
    return {
      stable_id: stableId,
      outcome_type: expected.type,
      disposition: satisfied ? expected.disposition : "failed",
      reason_code: satisfied ? expected.reason_code : "scenario_result_mismatch",
      receipt_ref: request.receipt_refs[stableId],
      evidence_identity: { ...identity },
      evidence_freshness: request.evidence_freshness[stableId],
    };
  });

  const allSatisfied = ORACLE_SCENARIO_IDS.every((stableId) => satisfaction[stableId]);
  const packetRecord: Record<string, unknown> = {};
  packetRecord["schema_version"] = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;
  packetRecord["suite_id"] = NEUTRAL_SCENARIO_SUITE_ID;
  packetRecord["suite_version"] = NEUTRAL_SCENARIO_SUITE_VERSION;
  packetRecord["owner_key"] = OWNER_KEY_MH07;
  packetRecord["evidence_identity"] = { ...identity };
  packetRecord["stable_ids"] = [...ORACLE_SCENARIO_IDS];
  packetRecord["results"] = results;

  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: allSatisfied ? "succeeded" : "failed",
      reason_code: allSatisfied ? null : ("scenario_result_mismatch" as never),
      assertions: [
        "each of the four W4/MH-07 scenarios was evaluated against the real module manifests and boundary scanners",
        "the dependency graph is scanned from source bytes, dynamic and re-export edges included",
        "an unclassified module, an unclassified destination, and an unresolvable edge all fail the verdict",
        "no promotion decision, release decision, or signature verification happens here",
      ],
      facts: {
        owner_key: OWNER_KEY_MH07,
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        evidence,
        source_binding: sourceBinding,
      },
    }),
    packet: neutralFreeze(packetRecord) as unknown as Mh07OwnerPacket,
  };
}

const HEX_DIGEST = /^sha256:[0-9a-f]{64}$/;

const ORACLE_SUBJECT: Mh07Subject = {
  label: "disposable conforming oracle",
  evaluate: oracleEvaluate,
  scanGraph: (root: string) => scanDependencyGraph(root),
  scenarioIds: ORACLE_SCENARIO_IDS,
  ownerKey: OWNER_KEY_MH07,
  packetSchema: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
  scenarios: oracleScenarios(),
  moduleRoles: ORACLE_MODULE_ROLES,
  roles: MH07_ROLES,
  destinationClasses: MH07_DESTINATION_CLASSES,
  edgeForms: MH07_EDGE_FORMS,
  lifecycleDecisionSymbols: MH07_LIFECYCLE_DECISION_SYMBOLS,
  nativeEventBindingSymbols: MH07_NATIVE_EVENT_BINDING_SYMBOLS,
  evidenceProfileId: MH07_EVIDENCE_PROFILE_ID,
  evaluatorVersion: ORACLE_EVALUATOR_VERSION,
  scannerVersion: ORACLE_SCANNER_VERSION,
  graphScope: MH07_GRAPH_SCOPE,
};

// ---------------------------------------------------------------------------
// The control battery — test-owned, executable, and run against every subject
// ---------------------------------------------------------------------------

interface Mh07Control {
  readonly id: string;
  readonly title: string;
  readonly run: (subject: Mh07Subject) => void;
}

/** A scenario the subject must report SATISFIED on the conforming repository. */
function satisfiedOnConforming(subject: Mh07Subject, stableId: string): void {
  const result = accepted(subject);
  assert(
    evidenceFor(result, stableId).satisfied === true,
    `${stableId} must be satisfied on the conforming repository, or every flip below is vacuous`
  );
}

/** A scenario the subject must report UNSATISFIED on one planted repository. */
function flipsOn(subject: Mh07Subject, mutation: string, stableId: string): void {
  const result = subject.evaluate(requestFor(mutation));
  if (result.packet === null) {
    // A typed refusal is an acceptable answer to a broken tree: what is NOT
    // acceptable is reporting the scenario satisfied.
    assert(
      result.outcome.disposition === "refused",
      `the ${mutation} repository must not produce a non-refusal without a packet`
    );
    return;
  }
  assert(
    evidenceFor(result, stableId).satisfied === false,
    `the ${mutation} repository must leave ${stableId} unsatisfied — the verdict is not derived from the tree`
  );
  const entry = resultFor(result.packet, stableId);
  assert(
    entry.disposition !== "succeeded",
    `the ${mutation} repository must not report ${stableId} succeeded`
  );
  assert(
    result.outcome.disposition !== "succeeded",
    `an evaluation with an unsatisfied scenario must not report succeeded (${mutation})`
  );
}

/** A scanner that sees ONLY static `import … from` edges — the regex-shaped view. */
const STATIC_ONLY_SCANNER: Mh07ScannerPort = {
  ...REAL_SCANNER,
  extractNeutralImportEdges: ((source: string) =>
    extractNeutralImportEdges(source).filter(
      (edge) => edge.kind === "resolved" && edge.form === "import from"
    )) as typeof extractNeutralImportEdges,
};

const CONTROLS: readonly Mh07Control[] = [
  {
    id: "MH07-C01-scenario-registry-source-owned",
    title: "the four ids, their order, their owner, their category and their expected outcomes come from source",
    run: (subject) => {
      assert(subject.ownerKey === OWNER_KEY_MH07, `owner key must be ${OWNER_KEY_MH07}, got ${subject.ownerKey}`);
      assert(
        neutralCanonicalJson([...subject.scenarioIds]) === neutralCanonicalJson([...MH07_IDS]),
        `the scenario tuple must be exactly ${MH07_IDS.join(", ")} in canonical order`
      );
      assert(Object.isFrozen(subject.scenarioIds), "the scenario tuple must be frozen");
      assert(subject.scenarios.length === MH07_IDS.length, "the registry must declare exactly four scenarios");
      const verdict = registrySatisfiesFieldContract(subject.scenarios, subject.evidenceProfileId);
      assert(verdict.ok, `the registry must satisfy the core's scenario_field_contract: ${verdict.detail}`);
      assert(
        subject.evidenceProfileId === MH07_EVIDENCE_PROFILE,
        `the frozen contract assigns ${MH07_EVIDENCE_PROFILE} to all four scenarios`
      );
      for (let index = 0; index < MH07_IDS.length; index += 1) {
        const scenario = subject.scenarios[index];
        const stableId = MH07_IDS[index];
        assert(scenario.stable_id === stableId, `registry position ${index} must declare ${stableId}`);
        assert(
          scenario.implementation_wave_owner.key === OWNER_KEY_MH07,
          `${stableId} must be owned by ${OWNER_KEY_MH07}`
        );
        assert(scenario.category === MH07_CATEGORY, `${stableId} category drifted from the frozen contract`);
        assert(
          scenario.action_event.name === "runtime.verify",
          `${stableId} must be driven by the frozen runtime.verify event`
        );
        assert(
          (scenario.action_event.input as Record<string, unknown>).boundary ===
            MH07_SCENARIO_BOUNDARY_INPUT[stableId],
          `${stableId} must name its frozen boundary input`
        );
        const expected = MH07_EXPECTED[stableId];
        assert(
          scenario.expected_typed_outcome.type === expected.type,
          `${stableId} expected outcome type drifted from the frozen contract`
        );
        assert(
          scenario.expected_typed_outcome.disposition === expected.disposition,
          `${stableId} expected disposition drifted from the frozen contract`
        );
        assert(
          scenario.evidence_requirements.every(
            (requirement) => requirement.profile === subject.evidenceProfileId
          ),
          `${stableId} must require the ${subject.evidenceProfileId} evidence profile`
        );
      }
      // The closed vocabularies the rules read against are source-owned too.
      for (const role of ["neutral_core", "host_adapter", "execution_transport", "service"]) {
        assert(subject.roles.indexOf(role) !== -1, `the role vocabulary must declare ${role}`);
      }
      for (const form of ["import()", "export from"]) {
        assert(subject.edgeForms.indexOf(form) !== -1, `the edge-form vocabulary must declare ${form}`);
      }
      assert(
        subject.destinationClasses.indexOf("unclassified") !== -1,
        "the destination vocabulary must be able to say `unclassified`, or nothing ever fails for it"
      );
      assert(
        subject.packetSchema === NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
        `the packet schema must be ${NEUTRAL_ASSEMBLY_PACKET_SCHEMA}`
      );
    },
  },
  {
    id: "MH07-C02-packet-shape-and-order",
    title: "one owner packet, four ordered results, each satisfying the runtime result contract",
    run: (subject) => {
      const result = accepted(subject);
      const packet = result.packet as Mh07OwnerPacket;
      assert(packet.schema_version === NEUTRAL_ASSEMBLY_PACKET_SCHEMA, "packet schema drifted");
      assert(packet.suite_id === NEUTRAL_SCENARIO_SUITE_ID, "packet suite id drifted");
      assert(packet.suite_version === NEUTRAL_SCENARIO_SUITE_VERSION, "packet suite version drifted");
      assert(packet.owner_key === OWNER_KEY_MH07, "packet owner key drifted");
      assert(
        neutralCanonicalJson([...packet.stable_ids]) === neutralCanonicalJson([...MH07_IDS]),
        "the packet must declare the four ids in canonical order"
      );
      assert(packet.results.length === MH07_IDS.length, "the packet must carry exactly four results");
      assert(
        neutralCanonicalJson(packet.evidence_identity) === neutralCanonicalJson(IDENTITY),
        "the packet identity must be the identity the request named"
      );
      const refs = receiptRefs();
      for (let index = 0; index < MH07_IDS.length; index += 1) {
        const stableId = MH07_IDS[index];
        const entry = packet.results[index];
        assert(entry.stable_id === stableId, `results[${index}] must answer ${stableId}`);
        assert(
          NEUTRAL_OUTCOME_TYPES.indexOf(entry.outcome_type as never) !== -1,
          `${stableId}: outcome_type outside the closed envelope vocabulary`
        );
        assert(
          NEUTRAL_DISPOSITIONS.indexOf(entry.disposition as never) !== -1,
          `${stableId}: disposition outside the closed vocabulary`
        );
        if (entry.disposition === "succeeded") {
          assert(entry.reason_code === null, `${stableId}: a succeeded result carries no reason code`);
        } else {
          assert(
            typeof entry.reason_code === "string" &&
              NEUTRAL_REASON_CODES.indexOf(entry.reason_code as never) !== -1,
            `${stableId}: a non-succeeded result carries exactly one recognized reason code`
          );
        }
        assert(entry.receipt_ref === refs[stableId], `${stableId}: the committed receipt reference was not carried`);
        assert(
          NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS.indexOf(entry.evidence_freshness as never) !== -1,
          `${stableId}: evidence_freshness outside the exported vocabulary`
        );
        assert(
          neutralCanonicalJson(entry.evidence_identity) === neutralCanonicalJson(IDENTITY),
          `${stableId}: the result identity must equal the packet identity`
        );
        const observation = evidenceFor(result, stableId);
        if (observation.satisfied) {
          const expected = MH07_EXPECTED[stableId];
          assert(
            entry.outcome_type === expected.type,
            `${stableId}: a satisfied scenario reports its frozen outcome type`
          );
          assert(
            entry.disposition === expected.disposition,
            `${stableId}: a satisfied scenario reports its frozen disposition, got ${String(entry.disposition)}`
          );
          assert(
            entry.reason_code === expected.reason_code,
            `${stableId}: a satisfied scenario reports its frozen reason code, got ${String(entry.reason_code)}`
          );
        }
      }
      // On the CONFORMING repository all four must be satisfied: a battery whose
      // positive case never happens cannot distinguish a flip from a constant.
      for (const stableId of MH07_IDS) satisfiedOnConforming(subject, stableId);
    },
  },
  {
    id: "MH07-C03-caller-supplies-no-scenario-set-graph-or-scope",
    title: "the covered ids, the graph, and the scanned scope each have exactly one source, and it is not the caller",
    run: (subject) => {
      const channels: [string, Record<string, unknown>, string][] = [
        ["stable_ids", { stable_ids: ["MHRC-MOD-001"] }, REFUSAL_CONTROLS.callerSuppliedIds],
        ["agreeing stable_ids", { stable_ids: [...MH07_IDS] }, REFUSAL_CONTROLS.callerSuppliedIds],
        [
          "dependency_graph",
          { dependency_graph: { node_count: 0, edge_count: 0, nodes: [], edges: [] } },
          REFUSAL_CONTROLS.callerSuppliedGraph,
        ],
        ["module_scope", { module_scope: ["lifecycle"] }, REFUSAL_CONTROLS.callerSuppliedScope],
      ];
      for (const [label, override, control] of channels) {
        const refused = subject.evaluate(baseRequest(override));
        assert(refused.packet === null, `a caller-supplied ${label} must be refused, not honoured`);
        assert(
          refused.outcome.disposition === "refused",
          `a caller-supplied ${label} must be a typed refusal, got ${String(refused.outcome.disposition)}`
        );
        assert(
          (refused.outcome.facts as Record<string, unknown>).refusal_control === control,
          `the ${label} refusal must name ${control}`
        );
      }
    },
  },
  {
    id: "MH07-C04-output-immutable-and-json-safe",
    title: "the packet is deeply frozen, JSON-safe, and not aliased to the caller's inputs",
    run: (subject) => {
      const result = accepted(subject);
      const packet = result.packet as Mh07OwnerPacket;
      assert(Object.isFrozen(packet), "the packet must be frozen");
      assert(Object.isFrozen(packet.results), "the packet results must be frozen");
      assert(Object.isFrozen(packet.stable_ids), "the packet ids must be frozen");
      assert(Object.isFrozen(packet.results[0]), "every result must be frozen");
      assert(Object.isFrozen(packet.results[0].evidence_identity), "every result identity must be frozen");
      assert(isImmutable(packet, "owner_key", "W9/MH-99"), "the packet owner key must not be writable");
      assert(isImmutable(packet.results as unknown as unknown[], 0, null), "the results array must not be writable");
      assert(
        neutralCanonicalJson(JSON.parse(JSON.stringify(packet))) === neutralCanonicalJson(packet),
        "the packet must be JSON-safe: no function, undefined, or cycle survives a round trip"
      );
      assert(
        neutralCanonicalJson(JSON.parse(JSON.stringify(result.outcome.facts))) ===
          neutralCanonicalJson(result.outcome.facts),
        "the evaluation facts must be JSON-safe too, or the evidence cannot be journaled"
      );
    },
  },
  {
    id: "MH07-C05-deterministic-and-clock-free",
    title: "two evaluations over the same tree are byte-equivalent",
    run: (subject) => {
      const first = accepted(subject);
      const second = accepted(subject);
      assert(
        neutralCanonicalJson(first.packet) === neutralCanonicalJson(second.packet),
        "two evaluations over the same tree must produce byte-equivalent packets"
      );
      assert(
        neutralCanonicalJson(first.outcome.facts) === neutralCanonicalJson(second.outcome.facts),
        "two evaluations over the same tree must produce byte-equivalent facts"
      );
    },
  },
  {
    id: "MH07-C06-source-identity-bound",
    title: "the packet binds manifest versions, scanner/evaluator versions, node/edge counts and deterministic digests",
    run: (subject) => {
      const binding = sourceBindingOf(accepted(subject));
      assert(binding.source_commit === IDENTITY.source_commit, "the binding must carry the claimed source commit");
      assert(
        typeof binding.manifest_count === "number" && (binding.manifest_count as number) > 0,
        "the binding must count the manifests it read"
      );
      assert(
        Array.isArray(binding.manifest_schema_versions) &&
          (binding.manifest_schema_versions as unknown[]).length > 0,
        "the binding must name the manifest schema versions it read"
      );
      assert(
        typeof binding.scanner_version === "string" && (binding.scanner_version as string).length > 0,
        "the binding must name the scanner version"
      );
      assert(
        binding.scanner_version === subject.scannerVersion,
        "the binding's scanner version must be the module's own declared version"
      );
      assert(
        binding.evaluator_version === subject.evaluatorVersion,
        "the binding's evaluator version must be the module's own declared version"
      );
      assert(
        typeof binding.node_count === "number" && (binding.node_count as number) > 0,
        "the binding must count the graph's nodes"
      );
      assert(
        typeof binding.edge_count === "number" && (binding.edge_count as number) > 0,
        "the binding must count the graph's edges"
      );
      assert(
        typeof binding.graph_digest === "string" && HEX_DIGEST.test(binding.graph_digest as string),
        "the binding must carry a sha256 graph digest"
      );
      assert(
        typeof binding.manifest_digest === "string" && HEX_DIGEST.test(binding.manifest_digest as string),
        "the binding must carry a sha256 manifest digest"
      );

      // The caller's commit is IDENTITY ONLY: naming a different commit may not
      // move a single derived fact.
      const relabelled = sourceBindingOf(
        accepted(
          subject,
          baseRequest({
            evidence_identity: { ...IDENTITY, source_commit: "0".repeat(40) },
          })
        )
      );
      assert(relabelled.source_commit === "0".repeat(40), "the relabelled run must carry the relabelled commit");
      for (const derived of ["graph_digest", "manifest_digest", "node_count", "edge_count"]) {
        assert(
          neutralCanonicalJson(relabelled[derived]) === neutralCanonicalJson(binding[derived]),
          `${derived} is DERIVED from the tree: renaming the claimed commit must not move it`
        );
      }

      // A different tree must move the digest, or the digest binds nothing.
      const mutated = subject.evaluate(requestFor("unclassified-module"));
      if (mutated.packet !== null) {
        const mutatedBinding = sourceBindingOf(mutated);
        assert(
          mutatedBinding.graph_digest !== binding.graph_digest,
          "a tree with an extra module must produce a different graph digest"
        );
        assert(
          mutatedBinding.manifest_digest !== binding.manifest_digest,
          "a tree with an extra manifest must produce a different manifest digest"
        );
      }
    },
  },
  {
    id: "MH07-C07-core-closure-and-classification-derived",
    title: "MHRC-MOD-001 follows the real closure evaluator, the classification, and the unresolved-edge rule",
    run: (subject) => {
      satisfiedOnConforming(subject, "MHRC-MOD-001");
      const observed = evidenceFor(accepted(subject), "MHRC-MOD-001").observed;
      assert(observed.core_disposition === "succeeded", "the conforming core must be reported closed");
      assert(
        Array.isArray(observed.unclassified_modules) && (observed.unclassified_modules as unknown[]).length === 0,
        "the conforming tree must classify every module"
      );
      assert(
        Array.isArray(observed.unclassified_edges) && (observed.unclassified_edges as unknown[]).length === 0,
        "the conforming tree must classify every destination"
      );
      assert(
        Array.isArray(observed.unresolved_edges) && (observed.unresolved_edges as unknown[]).length === 0,
        "the conforming tree must leave no unresolvable edge"
      );
      assert(
        typeof observed.node_count === "number" && (observed.node_count as number) > 0,
        "MHRC-MOD-001 must record the graph node count"
      );
      assert(
        typeof observed.edge_count === "number" && (observed.edge_count as number) > 0,
        "MHRC-MOD-001 must record the graph edge count"
      );
      for (const mutation of [
        "core-forbidden-edge",
        "core-unclassified-edge",
        "unclassified-module",
        "unresolvable-edge",
      ]) {
        flipsOn(subject, mutation, "MHRC-MOD-001");
      }
    },
  },
  {
    id: "MH07-C08-adapter-policy-ownership-derived",
    title: "MHRC-MOD-002 catches an adapter that owns lifecycle policy or reaches a private lifecycle path",
    run: (subject) => {
      satisfiedOnConforming(subject, "MHRC-MOD-002");
      const observed = evidenceFor(accepted(subject), "MHRC-MOD-002").observed;
      assert(
        Array.isArray(observed.adapter_modules) && (observed.adapter_modules as unknown[]).length > 0,
        "MHRC-MOD-002 must name the adapter modules it judged, or it judged nothing"
      );
      for (const mutation of [
        "adapter-policy-owner",
        "adapter-private-import",
        "native-binding-outside-adapter",
      ]) {
        flipsOn(subject, mutation, "MHRC-MOD-002");
      }
    },
  },
  {
    id: "MH07-C09-transport-policy-ownership-derived",
    title: "MHRC-MOD-003 catches a transport that decides lifecycle, branches on a host, or leaves its port",
    run: (subject) => {
      satisfiedOnConforming(subject, "MHRC-MOD-003");
      const observed = evidenceFor(accepted(subject), "MHRC-MOD-003").observed;
      assert(
        Array.isArray(observed.transport_modules) && (observed.transport_modules as unknown[]).length > 0,
        "MHRC-MOD-003 must name the transport modules it judged, or it judged nothing"
      );
      for (const mutation of [
        "transport-lifecycle-decision",
        "transport-host-branching",
        "transport-port-detached",
      ]) {
        flipsOn(subject, mutation, "MHRC-MOD-003");
      }
    },
  },
  {
    id: "MH07-C10-consumer-public-contracts-derived",
    title: "MHRC-MOD-004 catches a service reaching a host internal, a missing contract version, and a consumer reaching plugin source",
    run: (subject) => {
      satisfiedOnConforming(subject, "MHRC-MOD-004");
      const observed = evidenceFor(accepted(subject), "MHRC-MOD-004").observed;
      assert(
        Array.isArray(observed.service_modules) && (observed.service_modules as unknown[]).length > 0,
        "MHRC-MOD-004 must name the service modules it judged, or it judged nothing"
      );
      assert(
        Array.isArray(observed.consumer_source_reaches),
        "MHRC-MOD-004 must record what the external consumers reached"
      );
      for (const mutation of [
        "service-host-internal-import",
        "service-missing-contract-version",
        "consumer-imports-plugin-source",
      ]) {
        flipsOn(subject, mutation, "MHRC-MOD-004");
      }
    },
  },
  {
    id: "MH07-C11-complete-graph-not-a-static-subset",
    title: "the graph carries dynamic and re-export edges, refuses an empty tree, and moves when the scanner does",
    run: (subject) => {
      const conforming = repository(null);
      const graph = subject.scanGraph(conforming.plugin_root);
      assert(graph.node_count === graph.nodes.length, "node_count must be the graph's own node count");
      assert(graph.edge_count === graph.edges.length, "edge_count must be the graph's own edge count");
      assert(graph.node_count > 0 && graph.edge_count > 0, "the conforming tree is not an empty graph");
      for (const edge of graph.edges) {
        assert(
          subject.edgeForms.indexOf(edge.form) !== -1,
          `edge form ${edge.form} is outside the declared form vocabulary`
        );
        assert(
          subject.destinationClasses.indexOf(edge.destination_class) !== -1,
          `destination class ${edge.destination_class} is outside the declared vocabulary`
        );
      }
      const transportEdges = graph.edges.filter(
        (edge) =>
          edge.importer === "src/modules/dispatch/workflows/transport.ts" &&
          edge.specifier === "./transport-errors"
      );
      assert(
        transportEdges.some((edge) => edge.form === "import()"),
        "the DYNAMIC edge in the conforming tree must be in the graph — a static-only scan is not the complete graph"
      );
      assert(
        transportEdges.some((edge) => edge.form === "export from"),
        "the RE-EXPORT edge in the conforming tree must be in the graph"
      );

      // A dynamic and a re-export edge must each be able to FAIL a scenario, not
      // merely appear in a listing.
      flipsOn(subject, "service-dynamic-host-import", "MHRC-MOD-004");
      flipsOn(subject, "service-reexport-host-import", "MHRC-MOD-004");

      // An empty tree is refused, never reported as an empty violation set.
      const emptyRoot = tempBase("empty");
      fs.mkdirSync(path.join(emptyRoot, "src", "modules"), { recursive: true });
      const empty = subject.evaluate(baseRequest({ plugin_root: emptyRoot, consumer_roots: {} }));
      assert(empty.packet === null, "an empty module tree must not produce a packet");
      assert(empty.outcome.disposition === "refused", "an empty module tree must be a typed refusal");
      assert(
        (empty.outcome.facts as Record<string, unknown>).refusal_control ===
          REFUSAL_CONTROLS.sourceBindingIncomplete,
        `the empty-tree refusal must name ${REFUSAL_CONTROLS.sourceBindingIncomplete}`
      );

      // The reported counts must come FROM the scanner: a narrower scanner must
      // produce a narrower graph, or the counts are decoration.
      const narrowed = subject.evaluate(baseRequest({ scanner: STATIC_ONLY_SCANNER }));
      assert(narrowed.packet !== null, "a narrower scanner is still a well-formed request");
      const narrowedCount = sourceBindingOf(narrowed).edge_count as number;
      const honestCount = sourceBindingOf(accepted(subject)).edge_count as number;
      assert(
        narrowedCount < honestCount,
        `a static-only scanner must yield fewer edges (${narrowedCount}) than the real one (${honestCount})`
      );
    },
  },
  {
    id: "MH07-C12-stays-inside-its-boundary",
    title: "no promotion verdict, no off-contract result field, and not one byte written to the scanned tree",
    run: (subject) => {
      const conforming = repository(null);
      const before = treeDigest(conforming.base);
      const result = accepted(subject);
      const after = treeDigest(conforming.base);
      assert(before === after, "evaluation must not write to the tree it is judging");

      const packet = result.packet as Mh07OwnerPacket;
      const contractKeys = [
        "disposition",
        "evidence_freshness",
        "evidence_identity",
        "outcome_type",
        "reason_code",
        "receipt_ref",
        "stable_id",
      ];
      for (const entry of packet.results) {
        assert(
          neutralCanonicalJson(Object.keys(entry).slice().sort()) === neutralCanonicalJson(contractKeys),
          `a result carries exactly the contract fields, got ${Object.keys(entry).slice().sort().join(",")}`
        );
      }
      const forbidden = [
        "conformant",
        "promoted",
        "signature",
        "attestations",
        "authority",
        "gate",
        "phase",
        "release",
      ];
      const packetKeys = Object.keys(packet);
      const factKeys = Object.keys(result.outcome.facts as Record<string, unknown>);
      for (const key of forbidden) {
        assert(packetKeys.indexOf(key) === -1, `the packet must not carry ${key}`);
        assert(factKeys.indexOf(key) === -1, `the evaluation facts must not carry ${key}`);
      }
    },
  },
  {
    id: "MH07-C13-packet-consumable-by-the-real-assembler",
    title: "the real A21-S assembler accepts the packet and places its results in canonical slots",
    run: (subject) => {
      const packet = accepted(subject).packet as Mh07OwnerPacket;
      const packets = CANONICAL_OWNER_KEYS.map((ownerKey) =>
        ownerKey === OWNER_KEY_MH07 ? packet : disposablePacketFor(ownerKey)
      );
      // FIC-131: the assembler's request boundary is ONE canonical JSON text.
      // This control owns its packet set, so encoding it here is the caller doing
      // what every real owner boundary does — and it additionally proves this
      // evaluator's packet survives a canonical round trip intact.
      const assembled = assembleNeutralConformanceEvidence(
        neutralCanonicalJson({
          packets,
          claim: { claimant_id: CLAIMANT_ID, activated_runtime: IDENTITY },
        })
      );
      assert(
        assembled.outcome.disposition === "succeeded",
        `the real assembler refused the packet: ${String(assembled.outcome.reason_code)} / ${String(
          (assembled.outcome.facts as Record<string, unknown>).refusal_control
        )}`
      );
      assert(assembled.evidence !== null, "an accepted assembly carries the aggregate");
      const aggregate = assembled.evidence as { results: readonly NeutralScenarioResult[] };
      for (const stableId of MH07_IDS) {
        const slot = CANONICAL_SCENARIO_IDS.indexOf(stableId);
        const placed = aggregate.results[slot];
        assert(placed.stable_id === stableId, `${stableId} must land in its canonical slot ${slot}`);
        const own = resultFor(packet, stableId);
        assert(
          placed.disposition === own.disposition && placed.reason_code === own.reason_code,
          `${stableId} must survive assembly unchanged`
        );
      }
    },
  },
];

/** The control ids, in declaration order. Stated once, asserted as a closed set. */
const CONTROL_IDS: readonly string[] = [
  "MH07-C01-scenario-registry-source-owned",
  "MH07-C02-packet-shape-and-order",
  "MH07-C03-caller-supplies-no-scenario-set-graph-or-scope",
  "MH07-C04-output-immutable-and-json-safe",
  "MH07-C05-deterministic-and-clock-free",
  "MH07-C06-source-identity-bound",
  "MH07-C07-core-closure-and-classification-derived",
  "MH07-C08-adapter-policy-ownership-derived",
  "MH07-C09-transport-policy-ownership-derived",
  "MH07-C10-consumer-public-contracts-derived",
  "MH07-C11-complete-graph-not-a-static-subset",
  "MH07-C12-stays-inside-its-boundary",
  "MH07-C13-packet-consumable-by-the-real-assembler",
];

interface ControlReport {
  readonly passed: boolean;
  readonly failed_ids: readonly string[];
  readonly diagnostics: Readonly<Record<string, string>>;
}

function runControls(subject: Mh07Subject): ControlReport {
  const failed: string[] = [];
  const diagnostics: Record<string, string> = {};
  for (const control of CONTROLS) {
    try {
      control.run(subject);
    } catch (error) {
      failed.push(control.id);
      diagnostics[control.id] = String((error as Error)?.message ?? error);
    }
  }
  return { passed: failed.length === 0, failed_ids: failed, diagnostics };
}

// ---------------------------------------------------------------------------
// Planted EVALUATOR mutants (anti-vacuity for the battery itself)
// ---------------------------------------------------------------------------

function mutantSubject(label: string, evaluate: Mh07EvaluateFn): Mh07Subject {
  return { ...ORACLE_SUBJECT, label, evaluate };
}

/** Re-emit an evaluation with one scenario forced to `satisfied`. */
function forceSatisfied(base: Mh07ConformanceResult, stableId: string): Mh07ConformanceResult {
  if (base.packet === null) return base;
  const packet = base.packet;
  const evidence = evidenceOf(base).map((entry) =>
    entry.stable_id === stableId ? { ...entry, satisfied: true } : entry
  );
  const expected = MH07_EXPECTED[stableId];
  const results = packet.results.map((entry) =>
    entry.stable_id === stableId
      ? { ...entry, disposition: expected.disposition, reason_code: expected.reason_code }
      : entry
  );
  const allSatisfied = evidence.every((entry) => entry.satisfied);
  const facts: Record<string, unknown> = { ...(base.outcome.facts as Record<string, unknown>) };
  facts.evidence = evidence;
  const rebuilt: Record<string, unknown> = { ...(packet as unknown as Record<string, unknown>) };
  rebuilt.results = results;
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: allSatisfied ? "succeeded" : "failed",
      reason_code: allSatisfied ? null : ("scenario_result_mismatch" as never),
      assertions: [...base.outcome.assertions],
      facts,
    }),
    packet: neutralFreeze(rebuilt) as unknown as Mh07OwnerPacket,
  };
}

function tolerantMutant(stableId: string): Mh07EvaluateFn {
  return (request) => forceSatisfied(oracleEvaluate(request), stableId);
}

/** A packet that never looked at a tree: well-formed, complete, and worthless. */
const hardCodedPacketMutant: Mh07EvaluateFn = (request) => {
  const results = MH07_IDS.map((stableId) => ({
    stable_id: stableId,
    outcome_type: MH07_EXPECTED[stableId].type,
    disposition: "succeeded",
    reason_code: null,
    receipt_ref: request.receipt_refs[stableId],
    evidence_identity: { ...(request.evidence_identity as unknown as Record<string, unknown>) },
    evidence_freshness: request.evidence_freshness[stableId],
  }));
  const packet: Record<string, unknown> = {};
  packet["schema_version"] = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;
  packet["suite_id"] = NEUTRAL_SCENARIO_SUITE_ID;
  packet["suite_version"] = NEUTRAL_SCENARIO_SUITE_VERSION;
  packet["owner_key"] = OWNER_KEY_MH07;
  packet["evidence_identity"] = { ...(request.evidence_identity as unknown as Record<string, unknown>) };
  packet["stable_ids"] = [...MH07_IDS];
  packet["results"] = results;
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "succeeded",
      assertions: ["asserted four boundary scenarios without scanning anything"],
      facts: {
        owner_key: OWNER_KEY_MH07,
        evidence: MH07_IDS.map((stableId) => ({ stable_id: stableId, satisfied: true, observed: {} })),
        source_binding: {
          source_commit: (request.evidence_identity as unknown as Record<string, unknown>).source_commit,
          module_ids: [],
          manifest_count: 1,
          manifest_schema_versions: ["guild.module_manifest.v1"],
          manifest_digest: `sha256:${"0".repeat(64)}`,
          graph_digest: `sha256:${"0".repeat(64)}`,
          node_count: 1,
          edge_count: 1,
          scanner_version: ORACLE_SCANNER_VERSION,
          evaluator_version: ORACLE_EVALUATOR_VERSION,
          graph_scope_excluded_directories: [...MH07_GRAPH_SCOPE.excluded_directories],
          consumer_roots_scanned: [],
          core_members: [...NEUTRAL_CORE_MEMBERS],
        },
      },
    }),
    packet: neutralFreeze(packet) as unknown as Mh07OwnerPacket,
  };
};

/** An empty tree is normalized into an empty violation set. */
const emptyGraphTolerantMutant: Mh07EvaluateFn = (request) => {
  const honest = oracleEvaluate(request);
  if (
    honest.packet === null &&
    (honest.outcome.facts as Record<string, unknown>).refusal_control ===
      REFUSAL_CONTROLS.sourceBindingIncomplete
  ) {
    return hardCodedPacketMutant(request);
  }
  return honest;
};

/** The regex-shaped scan: static imports only, dynamic and re-export edges lost. */
const staticOnlyScannerMutant: Mh07EvaluateFn = (request) =>
  oracleEvaluate({ ...request, scanner: STATIC_ONLY_SCANNER } as Mh07ConformanceRequest);

/** The caller is allowed to name the covered set, the graph, and the scope. */
const callerHonouringMutant: Mh07EvaluateFn = (request) => {
  const clean: Record<string, unknown> = { ...(request as unknown as Record<string, unknown>) };
  const requested = request.stable_ids;
  delete clean.stable_ids;
  delete clean.dependency_graph;
  delete clean.module_scope;
  const honest = oracleEvaluate(clean as unknown as Mh07ConformanceRequest);
  if (requested === undefined || honest.packet === null) return honest;
  const packet = honest.packet;
  const shrunk: Record<string, unknown> = { ...(packet as unknown as Record<string, unknown>) };
  shrunk["stable_ids"] = [...requested];
  shrunk["results"] = packet.results.filter((entry) => requested.indexOf(entry.stable_id) !== -1);
  return { outcome: honest.outcome, packet: neutralFreeze(shrunk) as unknown as Mh07OwnerPacket };
};

/** The packet is emitted without the versions, counts, and digests that bind it. */
const unboundPacketMutant: Mh07EvaluateFn = (request) => {
  const honest = oracleEvaluate(request);
  if (honest.packet === null) return honest;
  const facts: Record<string, unknown> = { ...(honest.outcome.facts as Record<string, unknown>) };
  const binding: Record<string, unknown> = { ...(facts.source_binding as Record<string, unknown>) };
  delete binding.graph_digest;
  delete binding.manifest_digest;
  delete binding.manifest_schema_versions;
  facts.source_binding = binding;
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: honest.outcome.disposition,
      reason_code: honest.outcome.reason_code,
      assertions: [...honest.outcome.assertions],
      facts,
    }),
    packet: honest.packet,
  };
};

/** The packet is handed back mutable. */
const mutableOutputMutant: Mh07EvaluateFn = (request) => {
  const honest = oracleEvaluate(request);
  if (honest.packet === null) return honest;
  const loose: Record<string, unknown> = { ...(honest.packet as unknown as Record<string, unknown>) };
  loose.results = (honest.packet.results as readonly NeutralScenarioResult[]).map((entry) => ({ ...entry }));
  return { outcome: honest.outcome, packet: loose as unknown as Mh07OwnerPacket };
};

/** The evaluator quietly takes a promotion decision it does not own. */
const promotionAddingMutant: Mh07EvaluateFn = (request) => {
  const honest = oracleEvaluate(request);
  if (honest.packet === null) return honest;
  const facts: Record<string, unknown> = { ...(honest.outcome.facts as Record<string, unknown>) };
  facts.promoted = honest.outcome.disposition === "succeeded";
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: honest.outcome.disposition,
      reason_code: honest.outcome.reason_code,
      assertions: [...honest.outcome.assertions],
      facts,
    }),
    packet: honest.packet,
  };
};

interface PlantedMutant {
  readonly label: string;
  readonly evaluate: Mh07EvaluateFn;
  /** The controls this mutant MUST fail. A mutant that survives one is a defect in the control. */
  readonly mustFail: readonly string[];
}

const PLANTED_MUTANTS: readonly PlantedMutant[] = [
  {
    label: "hard-coded packet output",
    evaluate: hardCodedPacketMutant,
    mustFail: [
      "MH07-C03-caller-supplies-no-scenario-set-graph-or-scope",
      "MH07-C06-source-identity-bound",
      "MH07-C07-core-closure-and-classification-derived",
      "MH07-C08-adapter-policy-ownership-derived",
      "MH07-C09-transport-policy-ownership-derived",
      "MH07-C10-consumer-public-contracts-derived",
      "MH07-C11-complete-graph-not-a-static-subset",
    ],
  },
  {
    label: "empty / hand-authored graph tolerated",
    evaluate: emptyGraphTolerantMutant,
    mustFail: ["MH07-C11-complete-graph-not-a-static-subset"],
  },
  {
    label: "static-only scanner (dynamic and re-export edges missed)",
    evaluate: staticOnlyScannerMutant,
    mustFail: ["MH07-C11-complete-graph-not-a-static-subset"],
  },
  {
    label: "unclassified module / destination tolerated",
    evaluate: tolerantMutant("MHRC-MOD-001"),
    mustFail: ["MH07-C07-core-closure-and-classification-derived"],
  },
  {
    label: "adapter policy owner tolerated",
    evaluate: tolerantMutant("MHRC-MOD-002"),
    mustFail: ["MH07-C08-adapter-policy-ownership-derived"],
  },
  {
    label: "transport lifecycle decision tolerated",
    evaluate: tolerantMutant("MHRC-MOD-003"),
    mustFail: ["MH07-C09-transport-policy-ownership-derived"],
  },
  {
    label: "service and consumer internal imports tolerated",
    evaluate: tolerantMutant("MHRC-MOD-004"),
    mustFail: ["MH07-C10-consumer-public-contracts-derived"],
  },
  {
    label: "caller-shrunk scenario set and graph scope honoured",
    evaluate: callerHonouringMutant,
    mustFail: ["MH07-C03-caller-supplies-no-scenario-set-graph-or-scope"],
  },
  {
    label: "missing version / count / digest binding",
    evaluate: unboundPacketMutant,
    mustFail: ["MH07-C06-source-identity-bound"],
  },
  {
    label: "mutable packet output",
    evaluate: mutableOutputMutant,
    mustFail: ["MH07-C04-output-immutable-and-json-safe"],
  },
  {
    label: "promotion decision added",
    evaluate: promotionAddingMutant,
    mustFail: ["MH07-C12-stays-inside-its-boundary"],
  },
];

// ---------------------------------------------------------------------------
// GREEN — the battery distinguishes good from bad
// ---------------------------------------------------------------------------

afterAll(() => {
  for (const root of TEMP_ROOTS) fs.rmSync(root, { recursive: true, force: true });
});

describe("A21-7 MH-07 — the control battery distinguishes good from bad", () => {
  it("declares a closed, unique control id set", () => {
    expect(CONTROLS.map((control) => control.id)).toEqual([...CONTROL_IDS]);
    expect(new Set(CONTROL_IDS).size).toBe(CONTROL_IDS.length);
    expect(CONTROL_IDS.length).toBeGreaterThanOrEqual(13);
  });

  it("builds a conforming repository the REAL production validators accept", () => {
    const conforming = repository(null);
    const manifests = loadModuleManifests(conforming.plugin_root);
    expect(manifests.map((manifest) => manifest.id).sort()).toEqual(
      Object.keys(FIXTURE_MODULE_ROLES).sort()
    );
    expect(validateModuleBoundaries(conforming.plugin_root, manifests)).toEqual({
      ok: true,
      violations: [],
      errors: [],
    });
    const health = validateModuleHealth(conforming.plugin_root, manifests);
    expect(health.findings).toEqual([]);
    expect(health.ok).toBe(true);
    const coreDir = path.join(conforming.plugin_root, "src", "modules", "lifecycle", "workflows");
    const closure = evaluateNeutralCoreBoundary(
      NEUTRAL_CORE_MEMBERS.map((member) => ({
        path: member,
        source: fs.readFileSync(path.join(coreDir, member), "utf8"),
      }))
    );
    expect(closure.disposition).toBe("succeeded");
  });

  it.each(REPOSITORY_MUTATION_IDS.map((id) => [id] as const))(
    "materializes the %s repository as a real, different tree",
    (mutation) => {
      expect(treeDigest(repository(mutation).base)).not.toBe(treeDigest(repository(null).base));
    }
  );

  it("targets every planted repository at exactly one scenario", () => {
    expect(Object.keys(MUTATION_TARGET).sort()).toEqual([...REPOSITORY_MUTATION_IDS].sort());
    for (const stableId of Object.values(MUTATION_TARGET)) expect(MH07_IDS).toContain(stableId);
    for (const stableId of MH07_IDS) {
      expect(Object.values(MUTATION_TARGET)).toContain(stableId);
    }
  });

  it.each(REPOSITORY_MUTATION_IDS.map((id) => [id, MUTATION_TARGET[id]] as const))(
    "flips %s on a real packet rather than escaping through a refusal",
    (mutation, stableId) => {
      // `flipsOn` tolerates a typed refusal; the ORACLE may not use that door, so
      // no mutation can pass the battery without actually biting.
      const result = oracleEvaluate(requestFor(mutation));
      expect(result.packet).not.toBeNull();
      expect([mutation, evidenceFor(result, stableId).satisfied]).toEqual([mutation, false]);
      expect(resultFor(result.packet, stableId).disposition).toBe("failed");
      // …and nothing ELSE moved: a mutation that fails every scenario would make
      // the per-scenario controls indistinguishable from one another.
      for (const other of MH07_IDS.filter((id) => id !== stableId)) {
        expect([mutation, other, evidenceFor(result, other).satisfied]).toEqual([mutation, other, true]);
      }
    }
  );

  it("passes every control against the disposable conforming oracle", () => {
    const report = runControls(ORACLE_SUBJECT);
    expect({ failed: report.failed_ids, why: report.diagnostics }).toEqual({ failed: [], why: {} });
  });

  it.each(PLANTED_MUTANTS.map((mutant) => [mutant.label, mutant] as const))(
    "fails the %s mutant at its named controls",
    (label, mutant) => {
      const report = runControls(mutantSubject(label, mutant.evaluate));
      for (const controlId of mutant.mustFail) {
        expect(CONTROL_IDS).toContain(controlId);
        expect([controlId, report.failed_ids.indexOf(controlId) !== -1]).toEqual([controlId, true]);
      }
    }
  );
});

// ---------------------------------------------------------------------------
// RED — the production evaluator
// ---------------------------------------------------------------------------

/** Sibling consumer roots, when this checkout has them (plugin CI does not). */
function realConsumerRoots(): Record<string, string> {
  const workspace = path.resolve(PLUGIN_ROOT, "..");
  const roots: Record<string, string> = {};
  for (const name of ["website", "benchmark"]) {
    const candidate = path.join(workspace, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) roots[name] = candidate;
  }
  return roots;
}

function productionSubject(): Mh07Subject {
  return {
    label: "production module-boundary evaluator",
    evaluate: exported<Mh07EvaluateFn>("evaluateNeutralModuleBoundaries"),
    scanGraph: exported<Mh07ScanGraphFn>("mh07ScanDependencyGraph"),
    scenarioIds: exported<readonly string[]>("MH07_SCENARIO_IDS"),
    ownerKey: exported<string>("MH07_OWNER_KEY"),
    packetSchema: exported<string>("MH07_PACKET_SCHEMA"),
    scenarios: exported<readonly NeutralScenarioDefinition[]>("MH07_SCENARIOS"),
    moduleRoles: exported<Readonly<Record<string, string>>>("MH07_MODULE_ROLES"),
    roles: exported<readonly string[]>("MH07_ROLES"),
    destinationClasses: exported<readonly string[]>("MH07_DESTINATION_CLASSES"),
    edgeForms: exported<readonly string[]>("MH07_EDGE_FORMS"),
    lifecycleDecisionSymbols: exported<readonly string[]>("MH07_LIFECYCLE_DECISION_SYMBOLS"),
    nativeEventBindingSymbols: exported<readonly string[]>("MH07_NATIVE_EVENT_BINDING_SYMBOLS"),
    evidenceProfileId: exported<string>("MH07_EVIDENCE_PROFILE_ID"),
    evaluatorVersion: exported<string>("MH07_EVALUATOR_VERSION"),
    scannerVersion: exported<string>("MH07_SCANNER_VERSION"),
    graphScope: exported<{ readonly excluded_directories: readonly string[] }>("MH07_GRAPH_SCOPE"),
  };
}

describe("A21-7 MH-07 — the production module-boundary evaluator", () => {
  it("exists at the one pinned production path", () => {
    expect(fs.existsSync(EVALUATOR_SOURCE_PATH)).toBe(true);
  });

  it("exports the whole owner contract", () => {
    const subject = productionSubject();
    expect(typeof subject.evaluate).toBe("function");
    expect(typeof subject.scanGraph).toBe("function");
    expect(subject.ownerKey).toBe(OWNER_KEY_MH07);
    expect([...subject.scenarioIds]).toEqual([...MH07_IDS]);
    expect(subject.packetSchema).toBe(NEUTRAL_ASSEMBLY_PACKET_SCHEMA);
  });

  it("holds the REAL production scanner by identity, not a look-alike", () => {
    const port = exported<Mh07ScannerPort>("MH07_PRODUCTION_SCANNER");
    expect(port.loadModuleManifests).toBe(loadModuleManifests);
    expect(port.validateModuleOwnership).toBe(validateModuleOwnership);
    expect(port.validateModuleBoundaries).toBe(validateModuleBoundaries);
    expect(port.validateModuleHealth).toBe(validateModuleHealth);
    expect(port.evaluateNeutralCoreBoundary).toBe(evaluateNeutralCoreBoundary);
    expect(port.extractNeutralImportEdges).toBe(extractNeutralImportEdges);
    expect(port.tokenizeNeutralSource).toBe(tokenizeNeutralSource);
  });

  it("names the frozen E-BOUNDARY profile, and the core declares it", () => {
    const profileId = exported<string>("MH07_EVIDENCE_PROFILE_ID");
    expect(profileId).toBe(MH07_EVIDENCE_PROFILE);
    // HONEST GAP #3: the core's profile table does not declare E-BOUNDARY today.
    // The implementing lane owns adding exactly this entry; this suite requires
    // it and does not edit the core to provide it.
    expect((NEUTRAL_EVIDENCE_PROFILES as Record<string, unknown>)[profileId]).toEqual(
      MH07_EVIDENCE_PROFILE_DEFINITION
    );
  });

  it("passes the whole control battery", () => {
    const report = runControls(productionSubject());
    expect({ failed: report.failed_ids, why: report.diagnostics }).toEqual({ failed: [], why: {} });
  });

  it("reports all four scenarios succeeded over the REAL plugin repository", () => {
    const subject = productionSubject();
    const real = realConsumerRoots();
    // AVAILABILITY GUARD, not a weakening: this assertion is about the REAL
    // workspace, and a plugin-only checkout has no sibling consumer trees to
    // bind. The fixture-workspace FIC124-B2 controls above cover the scope rule
    // in every checkout; here there is simply no real repository to observe.
    if (Object.keys(real).length !== 2) {
      expect(fs.existsSync(path.join(PLUGIN_ROOT, "src", "modules"))).toBe(true);
      return;
    }
    const result = subject.evaluate({
      run_id: `${RUN_ID}-real`,
      plugin_root: PLUGIN_ROOT,
      consumer_roots: real,
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    expect(result.packet).not.toBeNull();
    const packet = result.packet as Mh07OwnerPacket;
    expect(packet.results.map((entry) => entry.stable_id)).toEqual([...MH07_IDS]);
    for (const entry of packet.results) {
      expect([entry.stable_id, entry.disposition, entry.reason_code]).toEqual([
        entry.stable_id,
        "succeeded",
        null,
      ]);
    }
    expect(result.outcome.disposition).toBe("succeeded");
    const binding = sourceBindingOf(result);
    expect(binding.node_count as number).toBeGreaterThan(100);
    expect(HEX_DIGEST.test(binding.graph_digest as string)).toBe(true);
  });

  it("stays inside its boundary: no fixture import, no network, no clock, no environment", () => {
    const source = evaluatorSource();
    for (const edge of extractNeutralImportEdges(source)) {
      const specifier = edge.specifier ?? "";
      expect([specifier, /conformance-scenarios|__tests__|fixtures/.test(specifier)]).toEqual([
        specifier,
        false,
      ]);
      for (const forbidden of ["http", "https", "net", "tls", "dgram", "child_process", "node-fetch"]) {
        expect([specifier, specifier === forbidden || specifier === `node:${forbidden}`]).toEqual([
          specifier,
          false,
        ]);
      }
    }
    const tokens = tokenizeNeutralSource(source);
    const idents = tokens.filter((token) => token.kind === "ident").map((token) => token.value);
    for (const forbidden of [
      "Date",
      "fetch",
      "setTimeout",
      "setInterval",
      "eval",
      "writeFileSync",
      "appendFileSync",
      "mkdirSync",
      "rmSync",
      "unlinkSync",
      "renameSync",
      "cpSync",
      "createWriteStream",
      "openSync",
    ]) {
      expect([forbidden, idents.indexOf(forbidden) !== -1]).toEqual([forbidden, false]);
    }
    for (let index = 0; index < tokens.length - 2; index += 1) {
      const reachesEnv =
        tokens[index].kind === "ident" &&
        tokens[index].value === "process" &&
        tokens[index + 1].value === "." &&
        tokens[index + 2].value === "env";
      expect(reachesEnv).toBe(false);
    }
  });

  it("writes nothing to the repository it scans", () => {
    const subject = productionSubject();
    const conforming = repository(null);
    const before = treeDigest(conforming.base);
    subject.evaluate(baseRequest());
    expect(treeDigest(conforming.base)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// FIC124-B2 — the external-consumer scope is source-owned, not caller-shrinkable
// ---------------------------------------------------------------------------

/**
 * WHY THIS BLOCK EXISTS
 *
 * `MHRC-MOD-004` opens on the precondition that the "benchmark, and website
 * consumers are classified" and asserts that "external consumers import no
 * plugin source". Both are claims about a FIXED set of consumers — the contract
 * names them — yet `consumer_roots` is caller-authored, admission validates only
 * the roots that happen to have been supplied, and MOD-004's success predicate
 * never asks whether the required ones were among them.
 *
 * FIC-124's probe against the real plugin passed `consumer_roots: {}` and got an
 * overall succeeded outcome with four succeeded results — MOD-004 included —
 * while `source_binding.consumer_roots_scanned` read `[]`. The empty
 * `consumer_source_reaches` observation that satisfied the assertion was
 * therefore ABSENCE OF INSPECTION, not proof: the caller shrank the scope to
 * zero and the evaluator reported the emptiness as a clean boundary.
 *
 * WHAT IS REQUIRED
 *   The required consumer set is SOURCE-OWNED and derived from the workspace
 *   shape the module already lives in: exactly the siblings `benchmark` and
 *   `website` of `plugin_root`'s parent. An omitted required consumer, a partial
 *   map, and a required name aimed at some other existing directory are each a
 *   REFUSAL with no packet — not a narrower scan, not a soft warning, and not an
 *   optional mode or a caller override the request can switch on. The fixture
 *   workspace already has that exact shape, so the accepted case is unchanged.
 */

/** The external consumers `MHRC-MOD-004` names. Sorted, closed, test-owned. */
const MH07_REQUIRED_CONSUMERS: readonly string[] = ["benchmark", "website"];

/** Each required consumer's ONLY admissible root: the sibling of `plugin_root`. */
function siblingConsumerRoots(pluginRoot: string): Record<string, string> {
  const workspace = path.dirname(pluginRoot);
  const roots: Record<string, string> = {};
  for (const name of MH07_REQUIRED_CONSUMERS) roots[name] = path.join(workspace, name);
  return roots;
}

/** A refusal that is a RETURN VALUE, carrying no packet and naming its control. */
function expectScopeRefusal(consumerRoots: Record<string, string>): Mh07ConformanceResult {
  let result: Mh07ConformanceResult;
  try {
    result = productionSubject().evaluate(baseRequest({ consumer_roots: consumerRoots }));
  } catch (error) {
    throw new Error(
      `expected a typed refusal, but the evaluator threw: ${String((error as Error)?.message ?? error)}`
    );
  }
  expect(result.packet).toBeNull();
  expect(result.outcome.disposition).toBe("refused");
  expect(NEUTRAL_REASON_CODES.indexOf(result.outcome.reason_code as never)).toBeGreaterThanOrEqual(0);
  const control = (result.outcome.facts as Record<string, unknown>).refusal_control;
  expect(typeof control).toBe("string");
  expect(control).not.toBe("");
  return result;
}

describe("FIC124-B2 — the required external-consumer scope cannot be shrunk by the caller", () => {
  it("binds the fixture workspace to the source-owned sibling shape", () => {
    // The accepted fixture is not an arbitrary map: it is exactly the two
    // sibling roots the contract names, which is what makes the refusals below
    // about the SCOPE rather than about the fixture.
    const repo = repository(null);
    expect({ ...repo.consumer_roots }).toEqual(siblingConsumerRoots(repo.plugin_root));
  });

  it("refuses an empty consumer map and emits no packet", () => {
    const result = expectScopeRefusal({});
    const facts = JSON.stringify(result.outcome.facts);
    for (const name of MH07_REQUIRED_CONSUMERS) expect(facts).toContain(name);
  });

  it("does not satisfy MOD-004 from a consumer scope it never inspected", () => {
    const result = productionSubject().evaluate(baseRequest({ consumer_roots: {} }));
    if (result.packet !== null) {
      // The reviewed defect verbatim: a succeeded MOD-004 whose bound scope is
      // empty. An unscanned consumer proves nothing about what it imports.
      const scanned = [...(sourceBindingOf(result).consumer_roots_scanned as string[])].sort();
      expect(scanned).toEqual([...MH07_REQUIRED_CONSUMERS]);
      expect(evidenceFor(result, "MHRC-MOD-004").satisfied).toBe(false);
    }
    expect(result.packet).toBeNull();
  });

  it.each(MH07_REQUIRED_CONSUMERS.map((name) => [name] as const))(
    "refuses a partial map that supplies only %s",
    (supplied) => {
      const repo = repository(null);
      const roots = siblingConsumerRoots(repo.plugin_root);
      const result = expectScopeRefusal({ [supplied]: roots[supplied] });
      const omitted = MH07_REQUIRED_CONSUMERS.filter((name) => name !== supplied);
      for (const name of omitted) expect(JSON.stringify(result.outcome.facts)).toContain(name);
    }
  );

  it.each(MH07_REQUIRED_CONSUMERS.map((name) => [name] as const))(
    "refuses when %s is pointed at a different existing directory",
    (redirected) => {
      const repo = repository(null);
      const roots = siblingConsumerRoots(repo.plugin_root);
      const decoy = MH07_REQUIRED_CONSUMERS.filter((name) => name !== redirected)[0];
      // The decoy EXISTS and is a directory, so the present-and-readable check
      // the evaluator already runs passes: only a check against the required
      // name's own root catches it.
      expect(fs.existsSync(roots[decoy]) && fs.statSync(roots[decoy]).isDirectory()).toBe(true);
      const result = expectScopeRefusal({ ...roots, [redirected]: roots[decoy] });
      expect(JSON.stringify(result.outcome.facts)).toContain(redirected);
    }
  );

  it("refuses a caller-supplied required-consumer channel rather than honouring it", () => {
    // No optional mode and no override: the request may not name the set it is
    // judged against, exactly as it may not name the scenario ids, the graph, or
    // the module scope.
    let result: Mh07ConformanceResult;
    try {
      result = productionSubject().evaluate(
        baseRequest({ required_consumers: ["benchmark"] }) as Mh07ConformanceRequest
      );
    } catch (error) {
      throw new Error(
        `expected a typed refusal, but the evaluator threw: ${String((error as Error)?.message ?? error)}`
      );
    }
    expect(result.packet).toBeNull();
    expect(result.outcome.disposition).toBe("refused");
  });

  /**
   * NON-VACUITY — a fix that refused every scope would satisfy everything above.
   * The exact sibling map is the INTENDED accepted shape, and it must still
   * produce a packet whose MOD-004 result is satisfied over a scope that names
   * both required consumers.
   */
  it("still accepts the exact sibling map, scanning both required consumers", () => {
    const repo = repository(null);
    const result = productionSubject().evaluate(
      baseRequest({ consumer_roots: siblingConsumerRoots(repo.plugin_root) })
    );
    expect(result.packet).not.toBeNull();
    expect(result.outcome.disposition).toBe("succeeded");
    const scanned = [...(sourceBindingOf(result).consumer_roots_scanned as string[])].sort();
    expect(scanned).toEqual([...MH07_REQUIRED_CONSUMERS]);
    expect(evidenceFor(result, "MHRC-MOD-004").satisfied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FIC129-B3 — the required consumer position must be a real directory, not a
// symlink pointing somewhere else
// ---------------------------------------------------------------------------

/**
 * WHY THIS BLOCK EXISTS
 *
 * §"FIC124-B2" above made the external-consumer scope source-owned: both
 * required names must be supplied, and each must resolve to the sibling of
 * `plugin_root`. FIC-129 refused the correction packet because that binding is
 * LEXICAL only. Admission asks `fs.existsSync` and then compares
 * `path.resolve(supplied) === path.resolve(required)` — two string operations
 * that a symlink satisfies exactly. Nothing requires the position to be a
 * regular directory, nothing rejects a link, and nothing compares canonical real
 * paths.
 *
 * `consumerSourceReaches` then walks the supplied path and `walkTypeScript` uses
 * `readdirSync`, which FOLLOWS a directory symlink. So a required sibling named
 * `benchmark` or `website` may be a link to any tree the caller chooses while its
 * supplied string stays lexically identical to the required root — and both names
 * still land in `requiredConsumersScanned`. An empty or unrelated decoy then
 * reproduces exactly the absence-of-inspection success FIC124-B2 prohibited:
 * "external consumers import no plugin source", asserted over a directory that is
 * not the consumer.
 *
 * WHAT IS REQUIRED
 *   A required consumer position that is not a real directory of its own is an
 *   EXPLICIT BINDING REFUSAL — `scenario_evidence_incomplete`, no packet, a
 *   binding control naming the redirected consumer — and never a scan that counts
 *   the redirected tree as the consumer.
 *
 * NON-VACUITY is carried INSIDE each control: the identical freshly materialized
 * workspace WITHOUT the link must still be accepted with both consumers scanned,
 * so the refusal is attributable to the redirection and not to the fixture.
 */

/** The tree a redirected required consumer is aimed at. It exists, and it is not the consumer. */
const MH07_DECOY_CONSUMER_DIR = "decoy-consumer";

interface RedirectedRepository extends FixtureRepository {
  /** The real directory the required consumer position points at. */
  readonly decoy_root: string;
  /** The required consumer position that is a symlink rather than a directory. */
  readonly redirected_position: string;
}

/** A freshly materialized conforming workspace, unlinked. Memoized. */
let conformingTwinCache: FixtureRepository | undefined;
function conformingTwin(): FixtureRepository {
  if (conformingTwinCache === undefined) {
    const base = tempBase("symlink-twin");
    materialize(base, conformingFiles());
    const pluginRoot = path.join(base, "plugin");
    conformingTwinCache = {
      base,
      plugin_root: pluginRoot,
      consumer_roots: siblingConsumerRoots(pluginRoot),
    };
  }
  return conformingTwinCache;
}

/**
 * The same conforming workspace with ONE required consumer position replaced by
 * a symlink to a decoy tree that exists inside the same disposable base.
 *
 * Contained on purpose: the link, its target, and the workspace all live under a
 * single `tempBase`, so the existing `afterAll` removes the whole fixture.
 */
function repositoryWithRedirectedConsumer(name: string): RedirectedRepository {
  const base = tempBase(`symlinked-${name}`);
  materialize(base, conformingFiles());
  const decoyRoot = path.join(base, MH07_DECOY_CONSUMER_DIR);
  fs.mkdirSync(path.join(decoyRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(decoyRoot, "src", "decoy.ts"),
    `export const MH07_DECOY_CONTRACT_VERSION = "guild.decoy.contract.v1" as const;\n`
  );
  const pluginRoot = path.join(base, "plugin");
  const position = path.join(base, name);
  fs.rmSync(position, { recursive: true, force: true });
  fs.symlinkSync(decoyRoot, position, "dir");
  return {
    base,
    plugin_root: pluginRoot,
    consumer_roots: siblingConsumerRoots(pluginRoot),
    decoy_root: decoyRoot,
    redirected_position: position,
  };
}

/** The binding refusals this evaluator already declares for an unbound scope. */
const MH07_BINDING_REFUSAL_CONTROLS: readonly string[] = [
  REFUSAL_CONTROLS.evidenceBindingMissing,
  REFUSAL_CONTROLS.sourceBindingIncomplete,
];

describe("FIC129-B3 — a symlinked required consumer position is refused, not followed", () => {
  it.each(MH07_REQUIRED_CONSUMERS.map((name) => [name] as const))(
    "refuses when the required %s position is a symlink to an existing decoy tree",
    (name) => {
      // 1. NON-VACUITY, in the same control: a freshly materialized workspace of
      //    the same shape, with no link anywhere, is still ACCEPTED with both
      //    required consumers scanned. Whatever the refusal below is caused by,
      //    it is not the fixture being new.
      const twin = conformingTwin();
      const accepted = productionSubject().evaluate(
        baseRequest({ plugin_root: twin.plugin_root, consumer_roots: twin.consumer_roots })
      );
      expect(accepted.packet).not.toBeNull();
      expect(accepted.outcome.disposition).toBe("succeeded");
      expect([...(sourceBindingOf(accepted).consumer_roots_scanned as string[])].sort()).toEqual([
        ...MH07_REQUIRED_CONSUMERS,
      ]);

      // 2. The fixture is the reviewed shape: the position IS a symlink, it
      //    resolves to a real decoy directory that is not the consumer, and the
      //    string handed to the evaluator is LEXICALLY the required root — which
      //    is precisely why `existsSync` + `path.resolve` cannot see it.
      const repo = repositoryWithRedirectedConsumer(name);
      expect(fs.lstatSync(repo.redirected_position).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(repo.redirected_position)).toBe(fs.realpathSync(repo.decoy_root));
      expect(fs.statSync(repo.decoy_root).isDirectory()).toBe(true);
      expect(path.resolve(repo.consumer_roots[name])).toBe(
        path.resolve(siblingConsumerRoots(repo.plugin_root)[name])
      );

      // 3. The obligation: an explicit binding refusal, not a scan of the tree
      //    the link pointed at.
      let result: Mh07ConformanceResult;
      try {
        result = productionSubject().evaluate(
          baseRequest({ plugin_root: repo.plugin_root, consumer_roots: repo.consumer_roots })
        );
      } catch (error) {
        throw new Error(
          `expected a typed refusal, but the evaluator threw: ${String((error as Error)?.message ?? error)}`
        );
      }
      // The reviewed defect verbatim: the redirected name counts as scanned and
      // the decoy's emptiness is reported as a clean consumer boundary.
      expect(result.packet).toBeNull();
      expect(result.outcome.disposition).toBe("refused");
      expect(result.outcome.reason_code).toBe("scenario_evidence_incomplete");
      const control = (result.outcome.facts as Record<string, unknown>).refusal_control;
      expect(MH07_BINDING_REFUSAL_CONTROLS).toContain(control);
      expect(JSON.stringify(result.outcome.facts)).toContain(name);
    }
  );
});
