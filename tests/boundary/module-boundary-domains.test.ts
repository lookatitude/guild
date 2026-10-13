/**
 * tests/boundary/module-boundary-domains.test.ts
 *
 * Pins the MH-07 evaluator's POST-FOLD (domains-shape) tree model — the model
 * the activated-host captures judge, which the FIC-116 battery's pre-fold
 * fixtures cannot reach. Each mutant plants one defect in a disposable
 * domains-shape repository and must flip exactly its scenario; the conforming
 * fixture must pass all four. The real-tree assertions close the seam the
 * beta.3 captures exposed: MHRC-MOD-001/003 reported `failed` on both hosts
 * because the evaluator still judged the retired `src/modules` layout.
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  MH07_DOMAIN_GRAPH_SCOPE,
  MH07_DOMAIN_TREE_ROLES,
  MH07_MODULE_FOLD_INDEX,
  MH07_SCENARIO_IDS,
  NEUTRAL_CORE_MEMBERS,
  evaluateNeutralModuleBoundaries,
  mh07ScanDependencyGraph,
  mh07UnclassifiedSources,
} from "../../src/domains/lifecycle";
import type { Mh07ConformanceResult } from "../../src/domains/lifecycle";
import { MODULE_PUBLIC_API_VERSION as EVOLVE_API_VERSION } from "../../src/domains/evolve";
import { MODULE_PUBLIC_API_VERSION as TELEMETRY_API_VERSION } from "../../src/domains/telemetry";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const API_DECLARATION =
  'export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;';

const IDENTITY = {
  source_commit: "0a1232f8152e62b807e4bae84b07b4fb5227beb1",
  package_hash: `sha256:${"0".repeat(64)}`,
  runtime_version: "guild-3.0.0-beta.3",
  adapter_version: "guild.host_adapter.v1.0.0",
  host_id: "claude-code-cli",
  host_version: "2.1.296",
  platform: "darwin-arm64",
  contract_version: 1,
  scenario_suite_id: "guild.conformance_scenarios.v1",
  scenario_suite_version: "1.0.0",
  release_id: "rel-domains-shape-test",
} as const;

function receiptRefs(): Record<string, string> {
  const refs: Record<string, string> = {};
  MH07_SCENARIO_IDS.forEach((id, at) => {
    refs[id] = `guild.receipt_ref.v1:domains-test-journal#${at}@nec1:0123456789abcdef`;
  });
  return refs;
}

function freshnessMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const id of MH07_SCENARIO_IDS) map[id] = "fresh";
  return map;
}

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

interface Workspace {
  readonly plugin: string;
  readonly consumers: Record<string, string>;
}

/** A minimal CONFORMING post-fold workspace: plugin + sibling consumers. */
function domainsWorkspace(label: string): Workspace {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `guild-mh07-domains-${label}-`));
  tempRoots.push(base);
  const plugin = path.join(base, "plugin");
  const write = (rel: string, body: string): void => {
    const full = path.join(plugin, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };

  // Real manifests, verbatim: the fold-index health rule is judged over them.
  for (const tree of ["src/adapters/modules", ...fs.readdirSync(path.join(PLUGIN_ROOT, "src", "domains")).map((d) => `src/domains/${d}/modules`)]) {
    const dir = path.join(PLUGIN_ROOT, tree);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".manifest.json")) continue;
      write(path.join(tree, name), fs.readFileSync(path.join(dir, name), "utf8"));
    }
  }

  // The REAL core member bytes: the core verdict is production behaviour.
  for (const member of NEUTRAL_CORE_MEMBERS) {
    write(
      `src/domains/lifecycle/${member}`,
      fs.readFileSync(path.join(PLUGIN_ROOT, "src", "domains", "lifecycle", member), "utf8")
    );
  }

  // Every fold-index target exists; contract-consumer services also bind the
  // lifecycle public index and state the public-API contract version.
  const indexes = new Set(Object.values(MH07_MODULE_FOLD_INDEX));
  for (const indexRel of indexes) {
    const unit = path.dirname(indexRel).split(path.sep).join("/");
    const isService = ["src/domains/distribution", "src/domains/evolve", "src/domains/knowledge", "src/domains/review", "src/domains/telemetry"].indexOf(unit) !== -1;
    const isLifecycle = unit === "src/domains/lifecycle";
    const lines: string[] = [API_DECLARATION];
    if (isLifecycle) lines.push('export const LIFECYCLE_PORT = "port" as const;');
    else if (isService) lines.push('import { LIFECYCLE_PORT } from "../lifecycle/index";', "export const SERVICE_USES = LIFECYCLE_PORT;");
    else if (unit === "src/domains/dispatch") lines.push('import { LIFECYCLE_PORT } from "../lifecycle/index";', "export const TRANSPORT_PORT = LIFECYCLE_PORT;");
    else if (unit === "src/adapters") lines.push('import { LIFECYCLE_PORT } from "../domains/lifecycle/index";', "export const ADAPTER_BINDING = LIFECYCLE_PORT;");
    else lines.push(`export const UNIT_MARKER = ${JSON.stringify(unit)};`);
    write(indexRel, `${lines.join("\n")}\n`);
  }
  write("src/runtime/index.ts", 'import { ADAPTER_BINDING } from "../adapters/index";\nexport const RUNTIME_BINDING = ADAPTER_BINDING;\n');

  const consumers: Record<string, string> = {};
  for (const name of ["website", "benchmark"]) {
    const root = path.join(base, name);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "main.ts"), "export const consumer = true;\n");
    consumers[name] = root;
  }
  return { plugin, consumers };
}

function evaluate(workspace: Workspace): Mh07ConformanceResult {
  return evaluateNeutralModuleBoundaries({
    run_id: "run-domains-shape-test",
    plugin_root: workspace.plugin,
    consumer_roots: workspace.consumers,
    evidence_identity: IDENTITY as never,
    receipt_refs: receiptRefs(),
    evidence_freshness: freshnessMap(),
  } as never);
}

function dispositions(result: Mh07ConformanceResult): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of result.packet?.results ?? []) {
    out[(entry as { stable_id: string }).stable_id] = (entry as { disposition: string }).disposition;
  }
  return out;
}

describe("MH-07 domains-shape — the conforming fixture", () => {
  it("reports all four scenarios succeeded and binds the domains tree model", () => {
    const result = evaluate(domainsWorkspace("green"));
    expect(dispositions(result)).toEqual({
      "MHRC-MOD-001": "succeeded",
      "MHRC-MOD-002": "succeeded",
      "MHRC-MOD-003": "succeeded",
      "MHRC-MOD-004": "succeeded",
    });
    const binding = (result.outcome.facts as { source_binding: Record<string, unknown> }).source_binding;
    expect(binding.tree_model).toBe("domains");
  });
});

describe("MH-07 domains-shape — each planted defect flips exactly its scenario", () => {
  const flip = (label: string, plant: (plugin: string) => void, flipped: string): void => {
    it(`${label} fails ${flipped} and only ${flipped}`, () => {
      const workspace = domainsWorkspace(label.replace(/[^a-z0-9]+/gi, "-"));
      plant(workspace.plugin);
      const got = dispositions(evaluate(workspace));
      for (const id of MH07_SCENARIO_IDS) {
        expect([id, got[id]]).toEqual([id, id === flipped ? "failed" : "succeeded"]);
      }
    });
  };

  flip(
    "TypeScript left in the retired src/modules tree",
    (plugin) => {
      fs.mkdirSync(path.join(plugin, "src", "modules", "ghost"), { recursive: true });
      fs.writeFileSync(path.join(plugin, "src", "modules", "ghost", "ghost.ts"), "export const ghost = 1;\n");
    },
    "MHRC-MOD-001"
  );

  flip(
    "a source tree the registry does not name",
    (plugin) => {
      fs.mkdirSync(path.join(plugin, "src", "invented"), { recursive: true });
      fs.writeFileSync(path.join(plugin, "src", "invented", "stray.ts"), "export const stray = 1;\n");
    },
    "MHRC-MOD-001"
  );

  flip(
    "an unresolvable computed require in a domain",
    (plugin) => {
      fs.writeFileSync(
        path.join(plugin, "src", "domains", "kernel", "computed.ts"),
        'const name = "js" + "-yaml";\n// eslint-disable-next-line\nexport const api = require(name);\n'
      );
    },
    "MHRC-MOD-001"
  );

  flip(
    "production importing scope-excluded test code",
    (plugin) => {
      fs.writeFileSync(
        path.join(plugin, "src", "domains", "kernel", "smuggled.test.ts"),
        'export const payload = 1;\n'
      );
      fs.writeFileSync(
        path.join(plugin, "src", "domains", "kernel", "carrier.ts"),
        'import { payload } from "./smuggled.test";\nexport const carried = payload;\n'
      );
    },
    "MHRC-MOD-001"
  );

  flip(
    "production re-exporting a source extension the scanner never reads",
    (plugin) => {
      fs.writeFileSync(
        path.join(plugin, "src", "domains", "dispatch", "hidden.tsx"),
        'export function pick(host: string): number {\n  switch (host) {\n    case "claude-code-cli":\n      return 1;\n    default:\n      return 0;\n  }\n}\n'
      );
      fs.writeFileSync(
        path.join(plugin, "src", "domains", "dispatch", "carrier.ts"),
        'export { pick } from "./hidden.tsx";\n'
      );
    },
    "MHRC-MOD-001"
  );

  flip(
    "production re-exporting through a symlink into excluded test code",
    (plugin) => {
      fs.mkdirSync(path.join(plugin, "src", "domains", "dispatch", "__tests__"), { recursive: true });
      fs.writeFileSync(
        path.join(plugin, "src", "domains", "dispatch", "__tests__", "payload.ts"),
        'export function pick(host: string): number {\n  switch (host) {\n    case "claude-code-cli":\n      return 1;\n    default:\n      return 0;\n  }\n}\n'
      );
      fs.symlinkSync(
        path.join("__tests__", "payload.ts"),
        path.join(plugin, "src", "domains", "dispatch", "hidden.ts")
      );
      fs.writeFileSync(
        path.join(plugin, "src", "domains", "dispatch", "carrier.ts"),
        'export { pick } from "./hidden";\n'
      );
    },
    "MHRC-MOD-001"
  );

  flip(
    "an adapter deep-importing a domain private file",
    (plugin) => {
      fs.writeFileSync(path.join(plugin, "src", "domains", "lifecycle", "internal.ts"), "export const secret = 1;\n");
      fs.writeFileSync(
        path.join(plugin, "src", "adapters", "deep.ts"),
        'import { secret } from "../domains/lifecycle/internal";\nexport const leak = secret;\n'
      );
    },
    "MHRC-MOD-002"
  );

  flip(
    "a transport deep-importing a domain private file",
    (plugin) => {
      fs.writeFileSync(path.join(plugin, "src", "domains", "lifecycle", "internal.ts"), "export const secret = 1;\n");
      fs.writeFileSync(
        path.join(plugin, "src", "domains", "dispatch", "deep.ts"),
        'import { secret } from "../lifecycle/internal";\nexport const leak = secret;\n'
      );
    },
    "MHRC-MOD-003"
  );

  flip(
    "a transport declaring a lifecycle decision symbol",
    (plugin) => {
      fs.writeFileSync(
        path.join(plugin, "src", "domains", "dispatch", "policy.ts"),
        "export function evaluateGatePolicy(): string {\n  return \"decided-in-transport\";\n}\n"
      );
    },
    "MHRC-MOD-003"
  );

  flip(
    "a transport branching on a recognized host id",
    (plugin) => {
      fs.writeFileSync(
        path.join(plugin, "src", "domains", "dispatch", "branch.ts"),
        'export function pick(host: string): number {\n  switch (host) {\n    case "claude-code-cli":\n      return 1;\n    default:\n      return 0;\n  }\n}\n'
      );
    },
    "MHRC-MOD-003"
  );

  flip(
    "a transport detached from the core public port",
    (plugin) => {
      fs.writeFileSync(
        path.join(plugin, "src", "domains", "dispatch", "index.ts"),
        'export const TRANSPORT_PORT = "detached";\n'
      );
    },
    "MHRC-MOD-003"
  );

  flip(
    "a contract-consumer service without the public-API declaration",
    (plugin) => {
      fs.writeFileSync(
        path.join(plugin, "src", "domains", "telemetry", "index.ts"),
        'import { LIFECYCLE_PORT } from "../lifecycle/index";\nexport const SERVICE_USES = LIFECYCLE_PORT;\n'
      );
    },
    "MHRC-MOD-004"
  );

  flip(
    "a consumer importing plugin source",
    (plugin) => {
      const workspaceRoot = path.dirname(plugin);
      fs.writeFileSync(
        path.join(workspaceRoot, "benchmark", "src", "reach.ts"),
        'import { LIFECYCLE_PORT } from "../../plugin/src/domains/lifecycle/index";\nexport const reach = LIFECYCLE_PORT;\n'
      );
    },
    "MHRC-MOD-004"
  );
});

describe("MH-07 domains-shape — the real repository", () => {
  it("classifies every real source file and keeps tests outside the closure", () => {
    expect(mh07UnclassifiedSources(PLUGIN_ROOT)).toEqual([]);
    expect([...MH07_DOMAIN_GRAPH_SCOPE.excluded_directories]).toEqual(["resources", "__tests__"]);
    expect([...MH07_DOMAIN_GRAPH_SCOPE.excluded_file_suffixes]).toEqual([".test.ts"]);
    for (const role of Object.values(MH07_DOMAIN_TREE_ROLES)) {
      expect(["neutral_core", "substrate", "host_adapter", "execution_transport", "service"]).toContain(role);
    }
  });

  it("scans the real tree as the domains model with zero unresolved edges", () => {
    const graph = mh07ScanDependencyGraph(PLUGIN_ROOT);
    expect(graph.node_count).toBeGreaterThan(100);
    expect(graph.edge_count).toBeGreaterThan(100);
    expect(graph.unresolved).toEqual([]);
    expect(graph.edges.filter((edge) => edge.destination_class === "unclassified")).toEqual([]);
    expect(graph.edges.filter((edge) => edge.destination_class === "module_private")).toEqual([]);
  });

  it("binds every contract-consumer domain index to the stated public-API version", () => {
    expect(EVOLVE_API_VERSION).toBe("guild.module.public-api.v1");
    expect(TELEMETRY_API_VERSION).toBe("guild.module.public-api.v1");
    for (const domain of ["distribution", "evolve", "knowledge", "telemetry"]) {
      const index = fs.readFileSync(path.join(PLUGIN_ROOT, "src", "domains", domain, "index.ts"), "utf8");
      expect([domain, index.indexOf(API_DECLARATION) !== -1]).toEqual([domain, true]);
    }
  });
});
