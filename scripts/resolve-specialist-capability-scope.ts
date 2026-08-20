#!/usr/bin/env -S npx tsx
/**
 * Deterministically resolve one execute-plan lane's capability scope.
 *
 * This CLI is the approval-bound scope resolver for code-backed dispatch and
 * the future direct-agent carrier seam: parse the actual team file, preserve an
 * explicit approved scope, otherwise materialize the canonical role default,
 * and return the exact env values. Current direct Agent rungs refuse any scoped
 * result until the host contract proves child-env carriage. No backend writes a
 * pathname backstop: the shared writer cannot close an ancestor-swap race
 * without an openat-style API.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { parseYaml } from "./agent-team-launcher";
import {
  checkContained,
  isRefused,
} from "../src/modules/kernel/workflows/path-containment";

export interface CliArgs {
  team: string;
  cwd: string;
  runId: string;
  taskId: string;
  role: string;
  teamSha256: string;
  autonomyContract?: string[];
}

export interface ScopeResolution {
  role: string;
  capability_scope: string[] | null;
  autonomy_contract: string[] | null;
  scope_path: string | null;
  env: Record<string, string>;
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseStringArray(raw: string, flag: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${flag} must be a JSON string array`);
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`${flag} must be a JSON string array`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  const values: Partial<CliArgs> = { cwd: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--team") values.team = requiredValue(argv, index++, flag);
    else if (flag === "--cwd") values.cwd = requiredValue(argv, index++, flag);
    else if (flag === "--run-id") values.runId = requiredValue(argv, index++, flag);
    else if (flag === "--task-id") values.taskId = requiredValue(argv, index++, flag);
    else if (flag === "--role") values.role = requiredValue(argv, index++, flag);
    else if (flag === "--team-sha256") values.teamSha256 = requiredValue(argv, index++, flag);
    else if (flag === "--autonomy-contract") {
      values.autonomyContract = parseStringArray(requiredValue(argv, index++, flag), flag);
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  for (const field of ["team", "cwd", "runId", "taskId", "role", "teamSha256"] as const) {
    if (!values[field]) throw new Error(`missing required --${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  }
  return values as CliArgs;
}

function safeId(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${label} must be a safe path segment`);
  }
  return value;
}

function readApprovalBoundTeam(cwd: string, teamPath: string, expectedSha256: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error("team-sha256 must be sha256:<64 lowercase hex>");
  }
  const teamRoot = path.join(cwd, ".guild", "team");
  const relativeTeamPath = path.relative(teamRoot, teamPath);
  if (
    relativeTeamPath === "" ||
    relativeTeamPath === ".." ||
    relativeTeamPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTeamPath)
  ) {
    throw new Error("team path is not a physical regular file under .guild/team [outside-root]");
  }
  // Root the physical check at the project, not at .guild/team. Physical
  // containment intentionally permits the root itself to be a symlink, so using
  // teamRoot here would bless '.guild/team -> /outside' as its own new root.
  const contained = checkContained(cwd, teamPath, {
    policy: "physical",
    requireRegularFileLeaf: true,
  });
  if (isRefused(contained)) {
    throw new Error(`team path is not a physical regular file under .guild/team [${contained.code}]`);
  }

  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(contained.realPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) throw new Error("team path is not a regular file");
    const bytes = fs.readFileSync(descriptor);
    const current = fs.statSync(contained.realPath);
    if (opened.dev !== current.dev || opened.ino !== current.ino) {
      throw new Error("team path changed while its approval binding was being verified");
    }
    const after = checkContained(cwd, contained.realPath, {
      policy: "physical",
      requireRegularFileLeaf: true,
    });
    if (isRefused(after)) {
      throw new Error(`team path escaped while its approval binding was being verified [${after.code}]`);
    }
    const actualSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (actualSha256 !== expectedSha256) {
      throw new Error("team bytes changed after the launcher approval check");
    }
    return bytes.toString("utf8");
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

export function resolveAndWriteSpecialistScope(args: CliArgs): ScopeResolution {
  const cwd = path.resolve(args.cwd);
  const teamPath = path.resolve(cwd, args.team);
  const team = parseYaml(readApprovalBoundTeam(cwd, teamPath, args.teamSha256));
  const matches = team.specialists.filter((specialist) => specialist.name === args.role);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `team has no specialist named ${args.role}`
        : `team has more than one specialist named ${args.role}`,
    );
  }

  const runId = safeId(args.runId, "run-id");
  const taskId = safeId(args.taskId, "task-id");
  const capabilityScope = matches[0].capability_scope;
  const autonomyContract = args.autonomyContract?.length ? [...args.autonomyContract] : null;
  const env: Record<string, string> = {
    GUILD_RUN_ID: runId,
    GUILD_TASK_ID: taskId,
  };

  if (capabilityScope !== undefined) {
    env.GUILD_CAPABILITY_SCOPE = JSON.stringify(capabilityScope);
  }
  if (autonomyContract !== null) {
    env.GUILD_AUTONOMY_CONTRACT = JSON.stringify(autonomyContract);
  }

  return {
    role: args.role,
    capability_scope: capabilityScope === undefined ? null : [...capabilityScope],
    autonomy_contract: autonomyContract,
    scope_path: null,
    env,
  };
}

export function main(argv: string[] = process.argv.slice(2)): number {
  try {
    process.stdout.write(`${JSON.stringify(resolveAndWriteSpecialistScope(parseArgs(argv)))}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`[resolve-specialist-capability-scope] ERROR: ${(error as Error).message}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main());
}
