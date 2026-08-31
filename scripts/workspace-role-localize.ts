#!/usr/bin/env -S npx tsx
import * as fs from "node:fs";
import * as path from "node:path";
import { applyWorkspaceRoleLocalization, type WorkspaceRoleLocalizationPlan } from "./lib/capability/workspace-role-localize";

let cwd = ".";
let planPath = "";
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--cwd" && process.argv[i + 1]) cwd = process.argv[++i];
  else if (process.argv[i] === "--plan" && process.argv[i + 1]) planPath = process.argv[++i];
  else { process.stderr.write(`[workspace-role-localize] unknown argument ${process.argv[i]}\n`); process.exit(1); }
}
if (!planPath) { process.stderr.write("[workspace-role-localize] --plan is required\n"); process.exit(1); }
const plan = JSON.parse(fs.readFileSync(path.resolve(planPath), "utf8")) as WorkspaceRoleLocalizationPlan;
const result = applyWorkspaceRoleLocalization(path.resolve(cwd), plan);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.status === "applied" ? 0 : 2);
