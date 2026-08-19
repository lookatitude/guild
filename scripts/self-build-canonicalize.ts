#!/usr/bin/env -S npx tsx
import {
  canonicalizeSelfBuildDefinitions,
  federateSelfBuildDefinitions,
  prepareSelfBuildRollbackBundle,
  runSelfBuildRollbackDrill,
} from "./lib/capability/self-build-canonicalize";

function value(args: string[], name: string): string | null { const i = args.indexOf(name); return i >= 0 && typeof args[i + 1] === "string" ? args[i + 1] : null; }
export function main(args: string[]): number {
  const action = args[0]?.startsWith("--") || args[0] === undefined ? "canonicalize" : args[0];
  const flags = action === "canonicalize" ? args : args.slice(1);
  const projectRoot = value(flags, "--project-root") ?? process.cwd();
  const projectId = value(flags, "--project-id") ?? "plugin";
  const roles = (value(flags, "--roles") ?? "command-builder,docs-writer,eval-engineer,hook-engineer,plugin-architect,research-digester,security-auditor,skill-author,specialist-agent-writer,tooling-engineer").split(",").filter(Boolean);
  if (action === "federate") {
    const pluginRoot = value(flags, "--plugin-root");
    const legacySourceRoot = value(flags, "--legacy-source-root");
    const historicalRoot = value(flags, "--historical-root") ?? projectRoot;
    const runId = value(flags, "--run-id");
    const authorizedBy = value(flags, "--authorized-by");
    const adoptedAt = value(flags, "--adopted-at");
    const workspaceProjectId = value(flags, "--workspace-project-id") ?? "umbrella";
    if (!pluginRoot || !legacySourceRoot || !runId || !authorizedBy || !adoptedAt) {
      process.stderr.write("required: --plugin-root --legacy-source-root --run-id --authorized-by --adopted-at\n");
      return 1;
    }
    const result = federateSelfBuildDefinitions({ workspaceRoot: projectRoot, workspaceProjectId, pluginRoot, pluginProjectId: projectId, legacySourceRoot, historicalRoot, runId, authorizedBy, adoptedAt, roles });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === "prepared" ? 0 : 2;
  }
  if (action === "prepare-rollback") {
    const legacySourceRoot = value(flags, "--legacy-source-root");
    if (!legacySourceRoot) { process.stderr.write("required: --legacy-source-root\n"); return 1; }
    const result = prepareSelfBuildRollbackBundle({ projectRoot, projectId, legacySourceRoot, roles });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === "prepared" ? 0 : 2;
  }
  if (action === "drill") {
    const runId = value(flags, "--run-id");
    const actor = value(flags, "--actor");
    const rolledBackAt = value(flags, "--rolled-back-at");
    const rolledForwardAt = value(flags, "--rolled-forward-at");
    if (!runId || !actor || !rolledBackAt || !rolledForwardAt) { process.stderr.write("required: --run-id --actor --rolled-back-at --rolled-forward-at\n"); return 1; }
    const result = runSelfBuildRollbackDrill({ projectRoot, projectId, runId, actor, rolledBackAt, rolledForwardAt, roles });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === "passed" ? 0 : 2;
  }
  if (action !== "canonicalize") { process.stderr.write(`unknown action: ${action}\n`); return 1; }
  const runId = value(flags, "--run-id"); const authorizedBy = value(flags, "--authorized-by"); const adoptedAt = value(flags, "--adopted-at");
  if (!runId || !authorizedBy || !adoptedAt) { process.stderr.write("required: --run-id --authorized-by --adopted-at\n"); return 1; }
  const result = canonicalizeSelfBuildDefinitions({ projectRoot, projectId, runId, authorizedBy, adoptedAt, roles });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === "prepared" ? 0 : 2;
}
if (require.main === module) process.exit(main(process.argv.slice(2)));
