/**
 * src/modules/lifecycle/workflows/module-boundary-conformance-evaluator.ts
 *
 * A21-7 / W4/MH-07 — the module-boundary owner's EVALUATOR.
 *
 * `guild.conformance_scenarios.v1` assigns exactly four of its 31 scenarios to
 * `W4/MH-07`: `MHRC-MOD-001` … `MHRC-MOD-004`. This module evaluates those four
 * against the REAL module system and hands the A21-S assembler one
 * `guild.conformance_owner_packet.v1`. It decides nothing else.
 *
 * WHAT MAKES THE PACKET HONEST
 *   Every result is DERIVED, never authored. The manifests come from
 *   `loadModuleManifests`, the ownership/boundary/health verdicts from the
 *   kernel's production rails, the dependency graph from the production
 *   token-based edge extractor (so `import()`, `require()`, `export … from` and
 *   bare `import "s"` are all in it), and the core-closure verdict from
 *   `evaluateNeutralCoreBoundary` over the registered core bytes. The covered
 *   scenario set, the scanned scope, and the role registry are SOURCE-OWNED: a
 *   caller that supplies any of them is refused, because accepting the channel
 *   is accepting a claim in place of evidence.
 *
 * WHY IT LIVES IN `lifecycle`
 *   The scenarios are statements about the module system, whose validators live
 *   in `kernel`. An evaluator placed in `kernel` would have to import the
 *   neutral core from `lifecycle` to emit `guild.boundary_outcome.v1` results —
 *   and `lifecycle` already declares `depends_on: [… kernel …]`, so that edge
 *   would be a module-graph CYCLE, exactly what MH-07 forbids. It therefore sits
 *   beside the neutral core and reaches the validators through `kernel`'s PUBLIC
 *   index, in the one direction the manifests already declare.
 *
 * IT IS NOT A NEUTRAL-CORE MEMBER
 *   `NEUTRAL_CORE_MEMBERS` is unchanged and this file is deliberately absent
 *   from it: the core is import-closed, and this evaluator reads the filesystem
 *   and imports another module. It sits NEXT TO the core, consumes it, and is
 *   judged by the same graph it produces.
 *
 * THREE BOUNDARIES STATED RATHER THAN HIDDEN
 *   1. INVENTORY COVERAGE. `validateModuleOwnership` has two halves: a manifest
 *      self-consistency half (duplicate ids, dependencies on unknown modules)
 *      that needs no inventory, and a coverage half that needs the live
 *      inventory built by `buildInventory` — which lives in the `distribution`
 *      module. `lifecycle` does not declare `distribution` as a dependency, so
 *      importing it would create precisely the undeclared cross-module edge this
 *      evaluator exists to forbid. The rail is therefore driven with an EMPTY
 *      inventory, the reachable half is enforced, and
 *      `inventory_coverage_checked: false` is recorded on the evidence rather
 *      than papered over.
 *   2. TYPED TRANSPORT ERRORS. MOD-003's third assertion is bound by PORT REACH
 *      — a transport must actually depend on a neutral-core public index — not
 *      by exception-flow analysis, which a lexical scanner cannot decide.
 *   3. CONTRACT-VERSION SCOPE. MOD-004's third assertion is enforced over the
 *      SERVICE modules that consume a host-facing contract (a `neutral_core`,
 *      `host_adapter`, or `execution_transport` public index). A service that
 *      binds only to `substrate` utilities publishes no host-facing contract and
 *      is not asked to version one. Both the full service set and the checked
 *      subset are recorded, so the narrowness is visible in the evidence.
 *
 * DELIBERATELY OUT OF SCOPE
 *   No promotion decision, no channel or release decision, no signature or
 *   attestation verification, and no assembly.
 *   `evaluateNeutralConformanceDecision` (MH-02) still owns promotion;
 *   `assembleNeutralConformanceEvidence` (A21-S) still owns the join.
 *
 * PURITY
 *   Reads source bytes; writes nothing. No clock, no network, no environment, no
 *   randomness — two evaluations over the same tree are byte-equivalent.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  OWNED_INVENTORY_CATEGORIES,
  loadModuleManifests,
  validateModuleBoundaries,
  validateModuleHealth,
  validateModuleOwnership,
} from "../../kernel";
import type {
  ModuleBoundaryViolation,
  ModuleInventory,
  ModuleManifest,
  OwnedInventoryCategory,
} from "../../kernel";

import { NEUTRAL_ASSEMBLY_PACKET_SCHEMA } from "./neutral-conformance-assembly";
import {
  NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_RECOGNIZED_HOST_IDS,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
} from "./neutral-conformance-core";
import type {
  NeutralEvidenceIdentity,
  NeutralScenarioDefinition,
  NeutralScenarioResult,
} from "./neutral-conformance-core";
import {
  NEUTRAL_CORE_MEMBERS,
  evaluateNeutralCoreBoundary,
  extractNeutralImportEdges,
  tokenizeNeutralSource,
} from "./neutral-core-boundary";
import type { NeutralImportEdge } from "./neutral-core-boundary";
import { neutralCanonicalDigest, neutralFreeze, neutralOutcome } from "./neutral-runtime-contracts";
import type { NeutralOutcome } from "./neutral-runtime-contracts";

// ---------------------------------------------------------------------------
// Identity of this owner and of this evaluator
// ---------------------------------------------------------------------------

/** The frozen contract's owner key for the four module-boundary scenarios. */
export const MH07_OWNER_KEY = "W4/MH-07";

/** The four stable ids, in CANONICAL (whole-suite) order. Source-owned. */
export const MH07_SCENARIO_IDS: readonly string[] = Object.freeze([
  "MHRC-MOD-001",
  "MHRC-MOD-002",
  "MHRC-MOD-003",
  "MHRC-MOD-004",
]);

/** The packet shape the A21-S assembler joins. */
export const MH07_PACKET_SCHEMA = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;

/** The evidence profile the frozen contract assigns all four scenarios. */
export const MH07_EVIDENCE_PROFILE_ID = "E-BOUNDARY";

/**
 * The versions the packet binds itself to. They move when the RULES move, so a
 * verdict can never be mistaken for one produced by a different evaluator.
 */
export const MH07_EVALUATOR_VERSION = "guild.module_boundary_evaluator.v1";
export const MH07_SCANNER_VERSION = "guild.module_boundary_scanner.v1";

/**
 * The module SOURCE closure is the graph.
 *
 * `resources/` holds generated mirrors of host-facing scripts — copies, not
 * module source — so scanning them would count the same logic twice and attach
 * edges to files no module authors. This is a SOURCE-OWNED scope rule; a caller
 * that supplies a scope is refused (`caller_supplied_module_scope`).
 */
export const MH07_GRAPH_SCOPE: { readonly excluded_directories: readonly string[] } = Object.freeze({
  excluded_directories: Object.freeze(["resources"]) as readonly string[],
});

// ---------------------------------------------------------------------------
// The closed vocabularies the rules read against
// ---------------------------------------------------------------------------

/**
 * The role vocabulary. Classification is the precondition all four scenarios
 * open with, so a module the registry does not name is an UNCLASSIFIED node and
 * fails MOD-001 — it is never silently ignored.
 */
export const MH07_ROLES: readonly string[] = Object.freeze([
  "neutral_core",
  "substrate",
  "host_adapter",
  "execution_transport",
  "service",
]);

/**
 * The destination class of every resolved edge. `unclassified` is a FAILURE, not
 * a pass: a destination the vocabulary cannot name is a hole in the closure
 * argument, which is the whole of MOD-001's third assertion.
 */
export const MH07_DESTINATION_CLASSES: readonly string[] = Object.freeze([
  "intra_module",
  "module_public_index",
  "module_private",
  "host_facing_mirror",
  "node_builtin",
  "external_package",
  "unclassified",
]);

/**
 * The edge forms the production extractor tags. `import()` and `export from` are
 * named explicitly because "dynamic and re-export edges are included" is a
 * frozen MOD-001 assertion, and a scanner that sees only `import … from` passes
 * a NARROWER graph while claiming the complete one.
 */
export const MH07_EDGE_FORMS: readonly string[] = Object.freeze([
  "import",
  "import from",
  "export from",
  "import()",
  "require()",
]);

/**
 * Symbols that NAME a lifecycle decision. Only the module that owns lifecycle
 * policy may declare one; an adapter or a transport declaring one has taken
 * ownership of a decision it is supposed to consume (MOD-002, MOD-003).
 */
export const MH07_LIFECYCLE_DECISION_SYMBOLS: readonly string[] = Object.freeze([
  "decideLifecycleSelection",
  "advanceLifecyclePhase",
  "evaluateGatePolicy",
]);

/**
 * Symbols that bind a HOST-NATIVE event. The inverse rule: only an adapter may
 * declare one, because "native event binding remains adapter-owned" (MOD-002).
 */
export const MH07_NATIVE_EVENT_BINDING_SYMBOLS: readonly string[] = Object.freeze([
  "bindNativeHostEvent",
]);

/** Node builtins — the closed list a bare specifier is classified against. */
const MH07_NODE_BUILTINS: readonly string[] = Object.freeze([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "http",
  "https",
  "net",
  "os",
  "path",
  "readline",
  "stream",
  "url",
  "util",
  "worker_threads",
  "zlib",
]);

/** Top-level trees that MIRROR module logic for one host rather than owning it. */
const MH07_HOST_FACING_ROOTS: readonly string[] = Object.freeze(["hooks", "scripts"]);

/** The public-API constant a service module's public index must declare. */
const MODULE_PUBLIC_API_DECLARATION =
  'export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;';

/**
 * Roles whose public index carries a HOST-FACING contract. A service that binds
 * to one of these is a contract consumer and must state the public-API contract
 * version it was built against (MOD-004, third assertion). A service that binds
 * only to `substrate` utilities publishes no such contract — see the header's
 * boundary #3.
 */
const MH07_HOST_FACING_CONTRACT_ROLES: readonly string[] = Object.freeze([
  "neutral_core",
  "host_adapter",
  "execution_transport",
]);

/**
 * The module role registry — SOURCE-OWNED, never requested.
 *
 * `neutral_core` is the module that HOLDS the host-neutral core; `substrate` are
 * the shared foundations that publish no host-facing contract; `host_adapter`
 * owns native→normalized binding; `execution_transport` owns lane and pane
 * execution; `service` is everything that composes those into a product surface.
 * A module absent from this table is unclassified and fails MOD-001, which is
 * exactly what makes an invented module visible instead of silently tolerated.
 */
export const MH07_MODULE_ROLES: Readonly<Record<string, string>> = Object.freeze({
  lifecycle: "neutral_core",

  "host-runtime": "host_adapter",

  dispatch: "execution_transport",

  capability: "substrate",
  communication: "substrate",
  config: "substrate",
  context: "substrate",
  kernel: "substrate",
  loops: "substrate",
  prompting: "substrate",
  security: "substrate",
  state: "substrate",
  teams: "substrate",
  templates: "substrate",
  workspace: "substrate",

  dashboard: "service",
  distribution: "service",
  "docs-sync": "service",
  documents: "service",
  evals: "service",
  evolution: "service",
  initiatives: "service",
  intake: "service",
  knowledge: "service",
  learning: "service",
  migrations: "service",
  operations: "service",
  quality: "service",
  review: "service",
  specialists: "service",
  telemetry: "service",
});

// ---------------------------------------------------------------------------
// The scenario registry
// ---------------------------------------------------------------------------

const MH07_WAVE_OWNER = Object.freeze({
  wave_id: "W4",
  work_item_id: "MH-07",
  key: MH07_OWNER_KEY,
});

/**
 * The four scenarios, AUTHORED against the frozen contract rather than imported
 * from it — the same discipline `NEUTRAL_CORE_SCENARIOS` follows. All four are
 * `guild.boundary_outcome.v1` / `succeeded`: a module boundary is a universal
 * claim, so there is no "expected refusal" row — a scenario is either proven
 * over the whole graph or it is failed.
 */
export const MH07_SCENARIOS: readonly NeutralScenarioDefinition[] = neutralFreeze([
  {
    stable_id: "MHRC-MOD-001",
    category: "module_boundary",
    title: "Host-neutral core imports no concrete host or transport implementation",
    preconditions: [
      "the complete top-level dependency graph is available",
      "core public modules are classified",
      "host adapters, hooks, wrappers, launchers, and transports are classified",
    ],
    action_event: { name: "runtime.verify", input: { boundary: "core_to_concrete" } },
    expected_typed_outcome: {
      type: "guild.boundary_outcome.v1",
      disposition: "succeeded",
      assertions: [
        "no core-to-concrete dependency edge exists",
        "dynamic and re-export edges are included",
        "unclassified destinations fail the verdict",
      ],
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
    implementation_wave_owner: MH07_WAVE_OWNER,
  },
  {
    stable_id: "MHRC-MOD-002",
    category: "module_boundary",
    title: "Host adapters do not own lifecycle policy",
    preconditions: [
      "adapter and lifecycle modules are classified",
      "normalized-event and capability ports are declared",
    ],
    action_event: { name: "runtime.verify", input: { boundary: "adapter_policy_ownership" } },
    expected_typed_outcome: {
      type: "guild.boundary_outcome.v1",
      disposition: "succeeded",
      assertions: [
        "adapters depend on public lifecycle ports only",
        "adapter modules contain no lifecycle decision ownership",
        "native event binding remains adapter-owned",
      ],
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
    implementation_wave_owner: MH07_WAVE_OWNER,
  },
  {
    stable_id: "MHRC-MOD-003",
    category: "module_boundary",
    title: "Execution transports do not decide lifecycle policy",
    preconditions: [
      "pane, tmux, remote, wrapper, and launcher transports are classified",
      "transport ports are declared",
    ],
    action_event: { name: "runtime.verify", input: { boundary: "transport_policy_ownership" } },
    expected_typed_outcome: {
      type: "guild.boundary_outcome.v1",
      disposition: "succeeded",
      assertions: [
        "transports implement execution ports only",
        "host branching is absent from core and generic launchers",
        "transport errors return typed outcomes",
      ],
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
    implementation_wave_owner: MH07_WAVE_OWNER,
  },
  {
    stable_id: "MHRC-MOD-004",
    category: "module_boundary",
    title: "Services and consumers use public contracts only",
    preconditions: [
      "artifact, document, knowledge, benchmark, and website consumers are classified",
      "public contract bundle exports are declared",
    ],
    action_event: { name: "runtime.verify", input: { boundary: "consumer_to_internal" } },
    expected_typed_outcome: {
      type: "guild.boundary_outcome.v1",
      disposition: "succeeded",
      assertions: [
        "services import no host internals",
        "external consumers import no plugin source",
        "consumer contract versions are explicit",
      ],
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
    implementation_wave_owner: MH07_WAVE_OWNER,
  },
] as unknown as NeutralScenarioDefinition[]);

/** The typed outcome each scenario reports when it is SATISFIED. */
const MH07_EXPECTED_OUTCOME: Readonly<
  Record<string, { readonly type: string; readonly disposition: string; readonly reason_code: null }>
> = Object.freeze({
  "MHRC-MOD-001": { type: "guild.boundary_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-MOD-002": { type: "guild.boundary_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-MOD-003": { type: "guild.boundary_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-MOD-004": { type: "guild.boundary_outcome.v1", disposition: "succeeded", reason_code: null },
});

// ---------------------------------------------------------------------------
// The production port
// ---------------------------------------------------------------------------

/**
 * The production surface this evaluator drives.
 *
 * It is a PORT rather than a hard-wired call list for exactly one reason: a
 * control has to be able to SABOTAGE the scanner and watch the verdict change.
 * An evaluator whose answer is the same whatever the scanner says is not
 * evaluating anything, and no amount of shape checking can tell the two apart.
 * The seam is NOT a substitute for the real path — the default is
 * `MH07_PRODUCTION_SCANNER`, which holds the real functions by identity.
 */
export interface Mh07ScannerPort {
  readonly loadModuleManifests: typeof loadModuleManifests;
  readonly validateModuleOwnership: typeof validateModuleOwnership;
  readonly validateModuleBoundaries: typeof validateModuleBoundaries;
  readonly validateModuleHealth: typeof validateModuleHealth;
  readonly evaluateNeutralCoreBoundary: typeof evaluateNeutralCoreBoundary;
  readonly extractNeutralImportEdges: typeof extractNeutralImportEdges;
  readonly tokenizeNeutralSource: typeof tokenizeNeutralSource;
}

/** The real thing. Every member is the production function object itself. */
export const MH07_PRODUCTION_SCANNER: Mh07ScannerPort = Object.freeze({
  loadModuleManifests,
  validateModuleOwnership,
  validateModuleBoundaries,
  validateModuleHealth,
  evaluateNeutralCoreBoundary,
  extractNeutralImportEdges,
  tokenizeNeutralSource,
});

// ---------------------------------------------------------------------------
// Request / result shapes
// ---------------------------------------------------------------------------

export interface Mh07ConformanceRequest {
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
}

/** One dependency edge of the module graph. */
export interface Mh07GraphEdge {
  readonly importer: string;
  readonly specifier: string;
  readonly form: string;
  readonly imported: string | null;
  readonly destination_class: string;
  readonly from_module: string;
  readonly to_module: string | null;
}

export interface Mh07DependencyGraph {
  readonly node_count: number;
  readonly edge_count: number;
  readonly nodes: readonly string[];
  readonly edges: readonly Mh07GraphEdge[];
  /** Edges the scanner could not resolve: never "no edge", always a finding. */
  readonly unresolved: readonly { importer: string; form: string; detail: string }[];
  /** Ambient `require`-as-value uses. Not module references; recorded, not edges. */
  readonly ambient_uses: readonly { importer: string; detail: string }[];
}

export interface Mh07OwnerPacket {
  readonly schema_version: string;
  readonly suite_id: string;
  readonly suite_version: string;
  readonly owner_key: string;
  readonly evidence_identity: NeutralEvidenceIdentity;
  readonly stable_ids: readonly string[];
  readonly results: readonly NeutralScenarioResult[];
}

export interface Mh07ConformanceResult {
  readonly outcome: NeutralOutcome;
  /** The owner packet, or `null` whenever the request itself was refused. */
  readonly packet: Mh07OwnerPacket | null;
}

/** The refusal discriminators placed on `outcome.facts.refusal_control`. */
const MH07_REFUSAL_CONTROLS = Object.freeze({
  callerSuppliedIds: "caller_supplied_scenario_ids",
  callerSuppliedGraph: "caller_supplied_dependency_graph",
  callerSuppliedScope: "caller_supplied_module_scope",
  identityIncomplete: "evidence_identity_incomplete",
  evidenceBindingMissing: "evidence_binding_missing",
  sourceBindingIncomplete: "source_binding_incomplete",
});

// ---------------------------------------------------------------------------
// Filesystem reading — read-only, deterministic, scope-bounded
// ---------------------------------------------------------------------------

/**
 * The external consumers `MHRC-MOD-004` NAMES, and the only roots each may be
 * bound to (FIC124-B2).
 *
 * The scenario's precondition is that "…benchmark, and website consumers are
 * classified" and its assertion is that "external consumers import no plugin
 * source". Both are claims about a FIXED set, so the set cannot be whatever the
 * caller happened to pass: a request that omits one, supplies one, or aims a
 * required name at some other directory shrinks the scope MOD-004 is judged on,
 * and an empty `consumer_source_reaches` observation over an unscanned consumer
 * is ABSENCE OF INSPECTION rather than proof. FIC-124's probe rode exactly that
 * with `consumer_roots: {}` and got four succeeded results.
 *
 * The roots are DERIVED, not declared: each required consumer is the sibling of
 * `plugin_root` in the same workspace, which is the shape the module system
 * already lives in. That leaves the caller naming the repository under
 * evaluation and nothing else — the same rule that already governs the scenario
 * ids, the dependency graph, and the module scope.
 */
const MH07_REQUIRED_CONSUMERS: readonly string[] = Object.freeze(["benchmark", "website"]);

/** Each required consumer's ONLY admissible root: the sibling of `pluginRoot`. */
function mh07RequiredConsumerRoots(pluginRoot: string): Record<string, string> {
  const workspace = path.dirname(path.resolve(pluginRoot));
  const roots: Record<string, string> = {};
  for (const name of MH07_REQUIRED_CONSUMERS) roots[name] = path.join(workspace, name);
  return roots;
}

/**
 * Generated and vendored trees under a CONSUMER root. A consumer's own source is
 * what "external consumers import no plugin source" is about; its dependency
 * cache and its build output are neither authored by it nor part of its source
 * closure. The list is recorded on the evidence so the bound scope is visible.
 */
const MH07_CONSUMER_SCAN_EXCLUDED_DIRECTORIES: readonly string[] = Object.freeze([
  ".astro",
  ".cache",
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

/** Every `.ts` file under `dir`, sorted, skipping the named directory names. */
function walkTypeScript(dir: string, excluded: readonly string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excluded.indexOf(entry.name) !== -1) continue;
      found.push(...walkTypeScript(full, excluded));
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

/** The `.ts` resolution the module-boundary rail itself uses. */
function resolveRelative(importer: string, specifier: string): string {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [base, `${base}.ts`, path.join(base, "index.ts")];
  return (
    candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? base
  );
}

function moduleIdOfPath(root: string, target: string, moduleIds: readonly string[]): string | null {
  const rel = relativeTo(path.join(root, "src", "modules"), target);
  if (rel.indexOf("..") === 0 || path.isAbsolute(rel)) return null;
  const head = rel.split("/")[0];
  return moduleIds.indexOf(head) === -1 ? null : head;
}

function moduleIdsOf(manifests: readonly ModuleManifest[]): string[] {
  return manifests.map((manifest) => manifest.id).sort();
}

/**
 * The destination class of one edge, from the closed vocabulary.
 *
 * `unclassified` is reserved for a destination that leaves the repository or
 * lands nowhere the vocabulary names. It is a FAILURE, never a pass.
 */
function classifyDestination(
  root: string,
  importer: string,
  specifier: string,
  fromModule: string,
  moduleIds: readonly string[]
): { destination_class: string; imported: string | null; to_module: string | null } {
  if (specifier.indexOf(".") !== 0) {
    const bare = specifier.indexOf("node:") === 0 ? specifier.slice("node:".length) : specifier;
    const isBuiltin = specifier.indexOf("node:") === 0 || MH07_NODE_BUILTINS.indexOf(bare) !== -1;
    return {
      destination_class: isBuiltin ? "node_builtin" : "external_package",
      imported: null,
      to_module: null,
    };
  }
  const resolved = resolveRelative(importer, specifier);
  const rel = relativeTo(root, resolved);
  if (rel.indexOf("..") === 0 || path.isAbsolute(rel)) {
    return { destination_class: "unclassified", imported: rel, to_module: null };
  }
  const head = rel.split("/")[0];
  if (MH07_HOST_FACING_ROOTS.indexOf(head) !== -1) {
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
 * The COMPLETE top-level dependency graph of a module tree.
 *
 * Edges come from the PRODUCTION token-based extractor, so `import()`,
 * `require()`, `export … from`, bare `import "s"` and type-only imports are all
 * present, and a comment or a string cannot invent one. A regex over static
 * imports would silently produce a smaller graph and call it complete.
 *
 * An edge the extractor cannot resolve is recorded in `unresolved` and fails
 * MOD-001. `require` used as a VALUE (`require.resolve`, `require.main`) is a
 * member access on the ambient binding rather than a module reference, so it is
 * recorded separately in `ambient_uses` — nothing is dropped, and nothing that
 * is not an edge is counted as one.
 */
export function mh07ScanDependencyGraph(
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
  const files = walkTypeScript(modulesDir, MH07_GRAPH_SCOPE.excluded_directories);
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
  }) as Mh07DependencyGraph;
}

// ---------------------------------------------------------------------------
// Lexical analysis over the production tokenizer
// ---------------------------------------------------------------------------

const DECLARATION_HEADS: readonly string[] = Object.freeze([
  "function",
  "const",
  "let",
  "var",
  "class",
  "async",
  "interface",
  "type",
  "enum",
]);

/** The names a source file EXPORTS, read through the production tokenizer. */
function declaredExportNames(
  source: string,
  tokenize: typeof tokenizeNeutralSource
): string[] {
  const tokens = tokenize(source);
  const names: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "ident" || token.value !== "export") continue;
    let cursor = index + 1;
    while (
      cursor < tokens.length &&
      tokens[cursor].kind === "ident" &&
      DECLARATION_HEADS.indexOf(tokens[cursor].value) !== -1
    ) {
      cursor += 1;
    }
    const candidate = tokens[cursor];
    if (candidate !== undefined && candidate.kind === "ident" && names.indexOf(candidate.value) === -1) {
      names.push(candidate.value);
    }
    const next = tokens[index + 1];
    if (next !== undefined && next.kind === "punct" && next.value === "{") {
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
 * Does this source BRANCH on a host identity?
 *
 * `case "<recognized host id>"` and nothing looser: a module that merely NAMES a
 * host — the core's own recognized-host table does — is not branching on one,
 * and a rule that could not tell the two apart would fire on the real core.
 */
function branchesOnHostId(source: string, tokenize: typeof tokenizeNeutralSource): string[] {
  const tokens = tokenize(source);
  const found: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token.kind !== "ident" || token.value !== "case") continue;
    if (next.kind !== "string") continue;
    if (NEUTRAL_RECOGNIZED_HOST_IDS.indexOf(next.value) !== -1 && found.indexOf(next.value) === -1) {
      found.push(next.value);
    }
  }
  return found;
}

/** Every edge a CONSUMER root declares into the plugin's own source tree. */
function consumerSourceReaches(
  consumerRoot: string,
  pluginRoot: string,
  extract: typeof extractNeutralImportEdges
): { consumer_file: string; specifier: string; imported: string }[] {
  const found: { consumer_file: string; specifier: string; imported: string }[] = [];
  const pluginSource = path.resolve(path.join(pluginRoot, "src"));
  for (const file of walkTypeScript(consumerRoot, MH07_CONSUMER_SCAN_EXCLUDED_DIRECTORIES)) {
    for (const edge of extract(fs.readFileSync(file, "utf8"))) {
      if (edge.kind !== "resolved" || edge.specifier === undefined) continue;
      if (edge.specifier.indexOf(".") !== 0) continue;
      const resolved = path.resolve(resolveRelative(file, edge.specifier));
      if (resolved === pluginSource || resolved.indexOf(`${pluginSource}${path.sep}`) === 0) {
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
// Typed refusals
// ---------------------------------------------------------------------------

function refuse(
  control: string,
  reasonCode: string,
  assertions: readonly string[],
  runId: string,
  facts: Record<string, unknown> = {}
): Mh07ConformanceResult {
  const merged: Record<string, unknown> = { ...facts };
  merged.refusal_control = control;
  merged.owner_key = MH07_OWNER_KEY;
  merged.suite_id = NEUTRAL_SCENARIO_SUITE_ID;
  merged.suite_version = NEUTRAL_SCENARIO_SUITE_VERSION;
  merged.evidence = [];
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "refused",
      reason_code: reasonCode as never,
      assertions: [...assertions],
      binding: { run_id: runId },
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

/**
 * The manifest-consistency half of the ownership rail, driven with an EMPTY
 * inventory. See the header's boundary #1: the coverage half needs
 * `buildInventory` from `distribution`, and importing it from `lifecycle` would
 * be the undeclared cross-module edge MOD-002/003/004 exist to forbid.
 */
function emptyModuleInventory(): ModuleInventory {
  const inventory: Record<string, unknown> = {};
  for (const category of OWNED_INVENTORY_CATEGORIES as readonly OwnedInventoryCategory[]) {
    inventory[category] = [];
  }
  return inventory as unknown as ModuleInventory;
}

function digestOf(value: unknown): string {
  return `sha256:${neutralCanonicalDigest(value)}`;
}

// ---------------------------------------------------------------------------
// The evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate the four `W4/MH-07` scenarios against a real module tree.
 *
 * The order is deliberate and each step names its own control:
 *
 *   1. CHANNELS. A caller may name the source it claims and the receipts it
 *      committed — never the covered scenario set, the dependency graph, or the
 *      scanned scope. An AGREEING copy is refused too: accepting a matching set
 *      accepts the channel, and the next caller's set will not match.
 *   2. BINDINGS. An incomplete identity, a missing receipt reference, an
 *      unrecognized freshness verdict, and a declared-but-absent consumer root
 *      each mean the verdict would be bound to nothing.
 *   3. SOURCE. Manifests that do not load, and an empty module set, are refused
 *      rather than reported as an empty violation set — "nothing was found" and
 *      "nothing was looked at" are different answers.
 *   4. DERIVATION. Everything after that is read from the tree.
 */
export function evaluateNeutralModuleBoundaries(
  request: Mh07ConformanceRequest
): Mh07ConformanceResult {
  const asRecord = (request ?? {}) as unknown as Record<string, unknown>;
  const runId = typeof asRecord.run_id === "string" ? asRecord.run_id : "";

  // -- 1. channels a caller may not open ------------------------------------
  if ("stable_ids" in asRecord) {
    return refuse(
      MH07_REFUSAL_CONTROLS.callerSuppliedIds,
      "scenario_required_set_mismatch",
      [
        "the covered scenario set has exactly one source, and it is this module",
        "an agreeing caller-supplied set is refused too, because accepting a matching copy accepts the channel",
      ],
      runId
    );
  }
  if ("dependency_graph" in asRecord) {
    return refuse(
      MH07_REFUSAL_CONTROLS.callerSuppliedGraph,
      "scenario_evidence_incomplete",
      [
        "the graph is SCANNED from source bytes, never supplied",
        "a caller-authored graph is a claim about the boundary, not evidence of it",
      ],
      runId
    );
  }
  if ("module_scope" in asRecord) {
    return refuse(
      MH07_REFUSAL_CONTROLS.callerSuppliedScope,
      "scenario_evidence_incomplete",
      ["the scanned scope is source-owned, so a caller cannot shrink the graph it is judged on"],
      runId
    );
  }
  if ("required_consumers" in asRecord) {
    return refuse(
      MH07_REFUSAL_CONTROLS.callerSuppliedScope,
      "scenario_evidence_incomplete",
      [
        "the external consumers `MHRC-MOD-004` names are source-owned, so the request may not name the set it is judged against",
        "there is no mode and no override: a caller-supplied required set is refused even when it agrees",
      ],
      runId,
      { required_consumers: [...MH07_REQUIRED_CONSUMERS] }
    );
  }

  // -- 2. the identity and the evidence bindings ----------------------------
  if (!identityIsComplete(request.evidence_identity)) {
    return refuse(
      MH07_REFUSAL_CONTROLS.identityIncomplete,
      "scenario_evidence_incomplete",
      ["evidence that names no complete identity is bound to no runtime"],
      runId
    );
  }
  for (const stableId of MH07_SCENARIO_IDS) {
    const receiptRef = request.receipt_refs?.[stableId];
    if (typeof receiptRef !== "string" || receiptRef.length === 0) {
      return refuse(
        MH07_REFUSAL_CONTROLS.evidenceBindingMissing,
        "scenario_receipt_reference_missing",
        ["every scenario result commits to a receipt reference"],
        runId,
        { unbound_scenario: stableId }
      );
    }
    const freshness = request.evidence_freshness?.[stableId];
    if (NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS.indexOf(freshness as never) === -1) {
      return refuse(
        MH07_REFUSAL_CONTROLS.evidenceBindingMissing,
        "scenario_evidence_incomplete",
        ["every scenario result carries a typed freshness verdict, and `unknown` is not a soft `fresh`"],
        runId,
        { unbound_scenario: stableId }
      );
    }
  }
  const consumerRoots = request.consumer_roots ?? {};
  const consumerNames = Object.keys(consumerRoots).sort();
  for (const name of consumerNames) {
    const consumerRoot = consumerRoots[name];
    if (typeof consumerRoot !== "string" || !fs.existsSync(consumerRoot)) {
      return refuse(
        MH07_REFUSAL_CONTROLS.evidenceBindingMissing,
        "scenario_evidence_incomplete",
        ["a declared consumer root that is not present was not scanned, and an unscanned consumer proves nothing"],
        runId,
        { consumer_root: name }
      );
    }
  }

  // -- 3. the real production primitives ------------------------------------
  const port = request.scanner ?? MH07_PRODUCTION_SCANNER;
  const root = request.plugin_root;

  let manifests: ModuleManifest[];
  try {
    manifests = port.loadModuleManifests(root) as ModuleManifest[];
  } catch (error) {
    return refuse(
      MH07_REFUSAL_CONTROLS.sourceBindingIncomplete,
      "scenario_evidence_incomplete",
      ["a module tree whose manifests do not load cannot be bound to a verdict"],
      runId,
      { load_error: String((error as Error)?.message ?? error) }
    );
  }
  if (manifests.length === 0) {
    return refuse(
      MH07_REFUSAL_CONTROLS.sourceBindingIncomplete,
      "scenario_evidence_incomplete",
      ["an empty module set is not a proof of an empty violation set"],
      runId,
      { manifest_count: 0 }
    );
  }

  // -- 3b. the source-owned external-consumer scope (FIC124-B2) -------------
  //
  // ORDER IS LOAD-BEARING. The module source is loaded and validated FIRST, so
  // an invalid or empty plugin tree still refuses as `source_binding_incomplete`
  // rather than being masked by a consumer-scope complaint. Only a tree that
  // could back a verdict is then required to be bound to BOTH named consumers —
  // before any consumer byte is scanned and before MOD-004 can succeed.
  const requiredConsumerRoots = mh07RequiredConsumerRoots(root);
  for (const name of MH07_REQUIRED_CONSUMERS) {
    const suppliedRoot = consumerRoots[name];
    const requiredRoot = requiredConsumerRoots[name];
    const bound =
      typeof suppliedRoot === "string" && path.resolve(suppliedRoot) === path.resolve(requiredRoot);
    if (!bound) {
      return refuse(
        MH07_REFUSAL_CONTROLS.evidenceBindingMissing,
        "scenario_evidence_incomplete",
        [
          "`MHRC-MOD-004` names its external consumers, so the scope it is judged on is source-owned",
          "an omitted, partial, or redirected consumer scope is absence of inspection, not proof that a consumer imports no plugin source",
        ],
        runId,
        {
          required_consumers: [...MH07_REQUIRED_CONSUMERS],
          unbound_consumer: name,
          required_consumer_root: requiredRoot,
          supplied_consumer_root: typeof suppliedRoot === "string" ? suppliedRoot : null,
        }
      );
    }

    // The binding above is LEXICAL, and lexical is not enough (FIC129-B3). A
    // symbolic link NAMED `benchmark` satisfies `existsSync` and both
    // `path.resolve` strings exactly, while `readdirSync` — which every walk
    // below reaches through — FOLLOWS it to whatever tree it points at. A
    // canonical real-path comparison does not help either: the required root IS
    // the link, so both sides realpath to the same decoy. The POSITION itself
    // must therefore be a directory of its own.
    //
    // `lstat` is the check because it reports the entry rather than its target,
    // so a link is visible as a link. It runs BEFORE anything follows or walks
    // the root, and any stat error is fail-closed: a position this evaluator
    // cannot classify is a position it will not scan.
    let position: fs.Stats | null = null;
    let positionError: string | null = null;
    try {
      position = fs.lstatSync(suppliedRoot);
    } catch (error) {
      positionError = String((error as Error)?.message ?? error);
    }
    if (position === null || position.isSymbolicLink() || !position.isDirectory()) {
      return refuse(
        MH07_REFUSAL_CONTROLS.evidenceBindingMissing,
        "scenario_evidence_incomplete",
        [
          "a required consumer root is a real directory at that exact position, never a link standing in for one",
          "a redirected position is absence of inspection wearing the required name: the tree that was walked is not the consumer the scenario names",
        ],
        runId,
        {
          required_consumers: [...MH07_REQUIRED_CONSUMERS],
          unbound_consumer: name,
          required_consumer_root: requiredRoot,
          supplied_consumer_root: suppliedRoot,
          consumer_position_is_symbolic_link: position !== null && position.isSymbolicLink(),
          consumer_position_is_directory: position !== null && position.isDirectory(),
          consumer_position_error: positionError,
        }
      );
    }
  }

  const moduleIds = moduleIdsOf(manifests);
  const ownership = port.validateModuleOwnership(emptyModuleInventory(), manifests);
  const boundaries = port.validateModuleBoundaries(root, manifests);
  const health = port.validateModuleHealth(root, manifests);
  const graph = mh07ScanDependencyGraph(root, port.extractNeutralImportEdges, moduleIds);

  // -- 4. classification, the precondition every scenario opens with --------
  const roleOf = (moduleId: string | null): string | null =>
    moduleId === null ? null : MH07_MODULE_ROLES[moduleId] ?? null;
  const unclassifiedModules = moduleIds.filter((id) => roleOf(id) === null);
  const modulesWithRole = (role: string): string[] => moduleIds.filter((id) => roleOf(id) === role);

  const coreModules = modulesWithRole("neutral_core");
  const adapterModules = modulesWithRole("host_adapter");
  const transportModules = modulesWithRole("execution_transport");
  const serviceModules = modulesWithRole("service");
  const nonAdapterModules = moduleIds.filter((id) => roleOf(id) !== "host_adapter");

  const sourcesOf = (moduleId: string): { path: string; source: string }[] =>
    walkTypeScript(
      path.join(root, "src", "modules", moduleId),
      MH07_GRAPH_SCOPE.excluded_directories
    ).map((file) => ({ path: relativeTo(root, file), source: fs.readFileSync(file, "utf8") }));

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
    boundaries.violations.filter(
      (violation) => moduleIdsToScan.indexOf(violation.from_module) !== -1
    );

  const hostFacingEdgesFrom = (moduleIdsToScan: readonly string[]): Mh07GraphEdge[] =>
    graph.edges.filter(
      (edge) =>
        edge.destination_class === "host_facing_mirror" &&
        moduleIdsToScan.indexOf(edge.from_module) !== -1
    );

  // -- MHRC-MOD-001: the core is closed and the whole graph is classified ----
  //
  // The core's own closure verdict comes from the production evaluator over the
  // registered member bytes; the rest of the tree is judged by the graph. An
  // unclassified module, an unclassified destination, and an edge the scanner
  // could not resolve are three distinct holes in the same closure argument, and
  // each one fails — an unresolvable edge is never a silent "no edge".
  const coreHostModule = coreModules.length === 1 ? coreModules[0] : null;
  const coreFiles: { path: string; source: string }[] = [];
  const missingCoreMembers: string[] = [];
  for (const member of NEUTRAL_CORE_MEMBERS) {
    const memberPath =
      coreHostModule === null
        ? null
        : path.join(root, "src", "modules", coreHostModule, "workflows", member);
    if (memberPath === null || !fs.existsSync(memberPath)) {
      missingCoreMembers.push(member);
      continue;
    }
    coreFiles.push({ path: member, source: fs.readFileSync(memberPath, "utf8") });
  }
  const coreVerdict =
    missingCoreMembers.length > 0 ? null : port.evaluateNeutralCoreBoundary(coreFiles);

  const unclassifiedEdges = graph.edges.filter(
    (edge) => edge.destination_class === "unclassified"
  );
  const mod001Satisfied =
    coreVerdict !== null &&
    coreVerdict.disposition === "succeeded" &&
    unclassifiedModules.length === 0 &&
    unclassifiedEdges.length === 0 &&
    graph.unresolved.length === 0 &&
    graph.node_count > 0 &&
    graph.edge_count > 0 &&
    health.ok &&
    ownership.ok;

  // -- MHRC-MOD-002: adapters consume policy, they do not own it ------------
  const adapterViolations = violationsFrom(adapterModules);
  const adapterPolicyOwners = declaredSymbolFindings(
    adapterModules,
    MH07_LIFECYCLE_DECISION_SYMBOLS
  );
  const strayNativeBindings = declaredSymbolFindings(
    nonAdapterModules,
    MH07_NATIVE_EVENT_BINDING_SYMBOLS
  );
  const mod002Satisfied =
    adapterModules.length > 0 &&
    adapterViolations.length === 0 &&
    adapterPolicyOwners.length === 0 &&
    strayNativeBindings.length === 0;

  // -- MHRC-MOD-003: transports execute, they do not decide -----------------
  //
  // Host branching is judged over the CORE and the transports, not over
  // adapters: resolving a host identity is precisely what an adapter is for.
  const transportViolations = violationsFrom(transportModules);
  const transportPolicyOwners = declaredSymbolFindings(
    transportModules,
    MH07_LIFECYCLE_DECISION_SYMBOLS
  );
  const hostBranchingFindings: { module_id: string; file: string; host_id: string }[] = [];
  for (const moduleId of [...coreModules, ...transportModules]) {
    for (const entry of sourcesOf(moduleId)) {
      for (const hostId of branchesOnHostId(entry.source, port.tokenizeNeutralSource)) {
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

  // -- MHRC-MOD-004: services and consumers use public contracts only -------
  const serviceViolations = violationsFrom(serviceModules);
  const serviceHostFacingEdges = hostFacingEdgesFrom(serviceModules);
  const contractConsumerServices = serviceModules.filter((moduleId) =>
    graph.edges.some(
      (edge) =>
        edge.from_module === moduleId &&
        edge.destination_class === "module_public_index" &&
        MH07_HOST_FACING_CONTRACT_ROLES.indexOf(roleOf(edge.to_module) ?? "") !== -1
    )
  );
  const contractConsumersWithoutVersion = contractConsumerServices.filter((moduleId) => {
    const indexPath = path.join(root, "src", "modules", moduleId, "index.ts");
    if (!fs.existsSync(indexPath)) return true;
    return fs.readFileSync(indexPath, "utf8").indexOf(MODULE_PUBLIC_API_DECLARATION) === -1;
  });
  const consumerReaches: {
    consumer: string;
    consumer_file: string;
    specifier: string;
    imported: string;
  }[] = [];
  for (const name of consumerNames) {
    for (const reach of consumerSourceReaches(
      consumerRoots[name],
      root,
      port.extractNeutralImportEdges
    )) {
      consumerReaches.push({ consumer: name, ...reach });
    }
  }
  // Defence in depth behind the admission above: MOD-004 may not be satisfied
  // from a scope that does not INCLUDE every consumer the scenario names, so an
  // empty `consumer_source_reaches` can never again stand in for a clean
  // boundary over a consumer nothing looked at.
  const requiredConsumersScanned = MH07_REQUIRED_CONSUMERS.filter(
    (name) => consumerNames.indexOf(name) !== -1
  );
  const mod004Satisfied =
    requiredConsumersScanned.length === MH07_REQUIRED_CONSUMERS.length &&
    serviceModules.length > 0 &&
    serviceViolations.length === 0 &&
    serviceHostFacingEdges.length === 0 &&
    contractConsumersWithoutVersion.length === 0 &&
    consumerReaches.length === 0;

  // -- 5. the source binding ------------------------------------------------
  //
  // Every value here is DERIVED from the tree except `source_commit`, which is
  // the one thing the caller is allowed to name. Renaming it must not move a
  // single other field, which is what makes the digests a binding rather than a
  // decoration.
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
    manifest_digest: digestOf(manifests),
    graph_digest: digestOf({ nodes: graph.nodes, edges: graph.edges }),
    node_count: graph.node_count,
    edge_count: graph.edge_count,
    scanner_version: MH07_SCANNER_VERSION,
    evaluator_version: MH07_EVALUATOR_VERSION,
    graph_scope_excluded_directories: [...MH07_GRAPH_SCOPE.excluded_directories],
    consumer_scope_excluded_directories: [...MH07_CONSUMER_SCAN_EXCLUDED_DIRECTORIES],
    consumer_roots_scanned: consumerNames,
    core_members: [...NEUTRAL_CORE_MEMBERS],
    core_host_module: coreHostModule,
    role_registry_digest: digestOf(MH07_MODULE_ROLES),
  };

  const observations: Record<string, Record<string, unknown>> = {
    "MHRC-MOD-001": {
      core_host_module: coreHostModule,
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
      health_findings: health.findings,
      ownership_ok: ownership.ok,
      ownership_errors: ownership.errors,
      inventory_coverage_checked: false,
    },
    "MHRC-MOD-002": {
      adapter_modules: adapterModules,
      adapter_boundary_violations: adapterViolations,
      policy_owner_findings: adapterPolicyOwners,
      native_binding_outside_adapter: strayNativeBindings,
    },
    "MHRC-MOD-003": {
      transport_modules: transportModules,
      transport_boundary_violations: transportViolations,
      lifecycle_decision_findings: transportPolicyOwners,
      host_branching_findings: hostBranchingFindings,
      transports_without_port_reach: transportsWithoutPortReach,
      host_branching_scanned_modules: [...coreModules, ...transportModules],
    },
    "MHRC-MOD-004": {
      service_modules: serviceModules,
      service_boundary_violations: serviceViolations,
      service_host_facing_edges: serviceHostFacingEdges,
      contract_consumer_services: contractConsumerServices,
      services_without_contract_version: contractConsumersWithoutVersion,
      consumer_source_reaches: consumerReaches,
      required_consumers: [...MH07_REQUIRED_CONSUMERS],
      required_consumers_scanned: requiredConsumersScanned,
    },
  };

  const satisfaction: Record<string, boolean> = {
    "MHRC-MOD-001": mod001Satisfied,
    "MHRC-MOD-002": mod002Satisfied,
    "MHRC-MOD-003": mod003Satisfied,
    "MHRC-MOD-004": mod004Satisfied,
  };

  const evidence = MH07_SCENARIO_IDS.map((stableId) => ({
    stable_id: stableId,
    satisfied: satisfaction[stableId],
    observed: observations[stableId],
  }));

  const results = MH07_SCENARIO_IDS.map((stableId) => {
    const expected = MH07_EXPECTED_OUTCOME[stableId];
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

  const allSatisfied = MH07_SCENARIO_IDS.every((stableId) => satisfaction[stableId]);
  const packetRecord: Record<string, unknown> = {};
  packetRecord.schema_version = MH07_PACKET_SCHEMA;
  packetRecord.suite_id = NEUTRAL_SCENARIO_SUITE_ID;
  packetRecord.suite_version = NEUTRAL_SCENARIO_SUITE_VERSION;
  packetRecord.owner_key = MH07_OWNER_KEY;
  packetRecord.evidence_identity = { ...identity };
  packetRecord.stable_ids = [...MH07_SCENARIO_IDS];
  packetRecord.results = results;

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
      binding: { run_id: runId },
      facts: {
        owner_key: MH07_OWNER_KEY,
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        evidence,
        source_binding: sourceBinding,
      },
    }),
    packet: neutralFreeze(packetRecord) as unknown as Mh07OwnerPacket,
  };
}
