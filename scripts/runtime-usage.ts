/**
 * scripts/runtime-usage.ts — the `--help` text of every `runtime/scripts/<id>.js`.
 *
 * `scripts/compile.ts` injects it as a banner that runs before any bundled module,
 * so `--help` / `-h` prints this and exits 0 with no side effect (#269). Every
 * runtime script target must have an entry; the compile refuses one without.
 * Each value is the argument synopsis after `node runtime/scripts/<id>.js`; a
 * library bundle (required by another bundle, never run) is marked LIBRARY.
 */

import { deepFreeze } from "../src/domains/kernel";

export const LIBRARY = "LIBRARY";

export const RUNTIME_USAGE: Readonly<Record<string, string>> = deepFreeze({
  "write-host-capability": "--cwd <root> [--host claude|codex] [--host-id <id>] [--source <label>]",
  "ensure-storage-layout": "[--cwd <root>] [--dry-run] [--detect-only] [--print]",
  "storage-gc": "[--cwd=<dir>] [--apply] [--ttl-hours=<n>] [--json]",
  "upgrade-chain": LIBRARY,
  "classify-intake": "[<prompt words...>]   (no words: the prompt is read from stdin)",
  "trace-summarize": "--run-id <id> [--cwd <path>] [--out <path>]",
  "wiki-revert": "<harvest_op_id> --run <run-id> [--cwd <dir>]\n       --list --run <run-id> [--cwd <dir>]",
  "wiki-promote": "<slug | candidate-path> [--run <run-id>] [--op <op-id>] [--cwd <dir>]",
  "rollback-walker": "--skill <slug> [--steps <n>] [--apply] [--cwd <path>]",
  "evolve-loop":
    "--skill <slug> --run-id <id> [--proposed-edit <path>] [--cwd <path>]\n       --apply <delta.json> [--run-id <id>] [--auto] [--cwd <path>]",
  "work-loop": "<bind|route|redirect|research-packet> --run-id <id> [--cwd <dir>]",
  "capability-adopt": "<verb> [flags]   (`help` lists the verbs)",
  "capability-profile":
    "hash-tree --cwd <root> [--json] [--for-run <run-id>]\n       baseline --cwd <root> --run-id <id>\n       emit --cwd <root> --run-id <id> --project-id <id> [--facts <file.json>]\n       candidates --cwd <root> --run-id <id>",
  "capability-profile-evidence": LIBRARY,
  "config-cmd":
    "<set|role|show|validate|providers|update-mcp-hashes|reconcile|ui|list|sources> [args] [--cwd <root>]",
  "dashboard-launch": "[--project-root <abs>] [--port <n>] [--dry-run] [--stop]",
  "migrate-guild": "[--root=<path>] [--mode=migrate|dry-run|skip] [--workspace]\n       --accept-grades [--root=<path>]",
  "initiative-gate": "<close-check|docs-workitems> --initiative <id> [--root <cwd>] [--exec-verified=true|false]",
  "config-ui-metadata": LIBRARY,
  "runstart-preflight": LIBRARY,
  "settings-resolver": LIBRARY,
  "models-cmd": "inspect [--cwd <repo-root>] [--run-id <id>] [--json]",
  "oq11-gate-check":
    "--gate=<phase> [--non-interactive|--interactive] [--auto-approve=spec,plan,build|all] [--named-phase]",
  "read-guild-config": "[--cwd <root>] [--rigor <profile>] [--host <id>] [--validate] [config overrides...]",
  "resume-lanes": "<runDir> [--json] [--cwd <repo-root>] [--slug <slug>]",
  "team-decide": "<review|restructure|gate|persist|record> [flags]",
  "agent-team-launcher": "--team <path> [--session-name <name>] [--cwd <path>] [--dry-run] [--run-id <id>]",
  "analyze-runs": "[--cwd <path>] [--min-runs <N>] [--out <path>] [--format text|json]",
  "analyze-structural": "[--cwd <path>] [--print]",
  "assign-layers": "[--cwd <path>] [--in <path>] [--print]",
  "audit-run-sinks": "--run-id <id> [--cwd <path>]",
  "build-tour": "[--cwd <path>] [--in <path>] [--print]",
  "check-handoff-receipts":
    "[--cwd <root>] --run-id <id>\n       --dir <handoffs-dir>\n       --receipt <file>",
  "check-lane-liveness": "--run-dir <abs .guild/runs/<id>> [flags]",
  "cost-gate": "[--cwd <path>] [--json]",
  "define-schema": LIBRARY,
  "definition-ref-for-dispatch":
    "--cwd <root> --name <id> --definition <relative-path> [--source project|shipped] [--tier T] [--default-tier T] [--capability-scope <s>]",
  "derive-domain": "[--cwd <path>] [--run-id <id>] [--in <path>] [--print]",
  "diff-learn": "[--cwd <path>] --base <sha> [--head <sha>] [--run-id <id>] [--print]",
  "emit-loop-event":
    "--event <name> --run-id <id> [--layer <l>] [--lane <id>] [--round <n>] [--gate <g>] [--cap <n>] [--cwd <root>]",
  "explore-schema": LIBRARY,
  "feedback-triage":
    "triage --run-id <id> --findings <findings.json> [--cwd <dir>]\n       file --run-id <id> --finding <finding-id> (--approve <operator> | --deny [reason]) [--cwd <dir>] [--dry-run]",
  "guild-run":
    "--host claude|codex [--mode <mode>] [--cwd <dir>] [--prompt <text> | --prompt-file <path>] [--contract <wire>] [--dry-run]",
  "ideation-min-build-cli": "[--cwd <root>] [--name <n>] [--description <d>] [--language <l>] [--now <iso>]",
  "ingest-similarity": "--category <category> --title <title> --content-file <path> [--cwd <root>]",
  "instantiate-template": "<template-id|path.json> [--slug=<s>] [--out-dir=<d>] [--cwd=<d>] [--stdout]",
  "k-stage-staleness": "[--cwd <path>] [--baseline] [--json]",
  "kb-snapshot":
    "snapshot --wiki-dir <abs> [--dest-dir <abs>] [--id <snapshot-id>]\n       verify --manifest <path> [--wiki-dir <abs>]\n       rollback --manifest <path> [--wiki-dir <abs>]",
  "knowledge-links-builder": "--root <project-root> [--dry-run]",
  "knowledge-links-traverse": "--cwd <repo-root> --task-id <id> [--json]",
  "knowledge-orchestrator": "--phase=round1|round2|finalize --cwd <repoRoot> [--run-id <id>] [--generated-at <iso>]",
  "learn-route": "--cwd <root> [-- <learn tokens...>]",
  "learn-scan": "[--cwd <path>] [--print] [--gen-ignore]",
  "learn-staleness": "[--cwd <path>] [--baseline] [--print]",
  "lifecycle-api": LIBRARY,
  "lint-context-bundle": "--bundle <file>",
  "mark-lane-dead": "<runDir> <laneId> --attempts <n> [--last-error <s>] [--run-id <id>] [--cwd <root>]",
  "lane-receipt-wait":
    "--cwd <repo> --run-id <run> --specialist <role> --task-id <id> [--timeout-ms <n>] [--poll-ms <n>] [--no-record]",
  "pane-send": "--target <tmux-target> --message <text> [--host <claude|codex>] [--settle-ms <ms>] [--poll-limit <n>]",
  "pane-dispatch-trace": "--cwd <root> --run-id <id> --target <pane> --backend <b> [--phase <p>] [--lane <id>]",
  "recall": "--query <text> [--cwd <root>] [--category <c>] [--limit <n>] [--run-id <id>]",
  "registry-rollup": "[--guild-dir <.guild>] [--write] [--json]",
  "resolve-specialist-capability-scope":
    "--team <path> --cwd <root> --run-id <id> --task-id <id> --role <role> [--team-sha256 <hex>]",
  "retention": "[--guild-dir <.guild>] [--apply] [--now <iso>]",
  "roster-resolve":
    "--cwd <projectRoot> [--plugin-root <dir>] [--write-registry] [--check] [--force] [--quiet]\n       mint <name> --class <workflowClass> [--host-native] --cwd <projectRoot>\n       migrate-team-roster --class <workflowClass> --cwd <projectRoot> [--dry-run]\n       --check-workspace-scopes --cwd <workspaceRoot>",
  "run-analysis":
    "run analyze <run-id> [--cwd <root>]\n       run compare <run-id> <run-id...> [--cwd <root>]\n       initiative analyze <initiative-id> [--cwd <root>]\n       artifact inspect <run|comparison> <source-id> [--cwd <root>]",
  "telemetry-api": LIBRARY,
  "adapters-api": LIBRARY,
  "run-lifecycle": LIBRARY,
  "score-tier": "--signals '<json>' [--cwd <root>] [--model-tier <pin>]",
  "stamp-recall-importance": "--cwd <repo> [--dry-run] [--force] [--no-config-gate]",
  "station-compose":
    "<station> [--signals <file.json | ->] [--cwd <root>] [--plugin-root <dir>] [--run-id <id> --emit]",
  "task-cell-audit": "--cwd <root> --run-id <id> [--open]",
  "task-cell-team-result": "--cwd <root> --run-id <id> --station <station>",
  "validate-graph": "[--cwd <path>] [--in <path>] [--dry] [--print] [--force]\n       --cwd <path> --stdin",
  "verify-gate-pass": "--result <result-round.json> --artifact <artifact-file> [--packet-id <id>] [--force-pass]",
  "wiki-lint-checks": "[--root <repo>] [--json]",
  "workspace-detect": "[--cwd <root>] [--mode <mode>]",
  "workspace-federated-query": "--query <text> [--scope <scope>] [--cwd <root>]",
  "workspace-promote-upstream": "--workspace-root <root> --child <path> [--run-id <id>]",
  "workspace-write-manifest": "[--cwd <root>] [--mode <mode>]",
  "write-knowledge-links": LIBRARY,
  "write-task-run": "--cwd <root> --run-id <id> --task-id <id> [task fields...]",
});
