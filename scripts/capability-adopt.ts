#!/usr/bin/env -S npx tsx
/**
 * scripts/capability-adopt.ts
 *
 * THE ADOPTION MIGRATION COMMAND (gap D6) — the user-facing surface over
 * `src/modules/capability/workflows/adoption-migrate.ts`.
 *
 * Generalizes `roster-resolve.ts migrate-team-roster` from roles-only and
 * script-internal into a four-verb operator command covering roles AND skills:
 *
 *   report    READ-ONLY inventory + conflicts + exact source hashes. Writes
 *             nothing. This is the first pass, and it is the default verb — a
 *             bare invocation can never mutate a repo.
 *   catalog   the read-only compatibility catalog (15 templates + 58 domain
 *             skills) with deprecation markers.
 *   adopt     apply an operator-approved decisions file. `--dry-run` runs every
 *             check without writing.
 *   rollback  one command; appends `rolled_back` entries and removes the copies
 *             it made. Never deletes history.
 *
 * EXIT CODES
 *   0  success
 *   1  usage error
 *   2  refused (a conflict, a validation failure, a changed source hash)
 *
 * The decisions file is JSON: `{"decisions":[{"kind":"agent","id":"qa",
 * "disposition":"adopt_as_is"}, …]}`. It is a FILE rather than flags on purpose —
 * a migration plan is reviewable, diffable, and re-runnable; a shell line is not.
 */

import * as fs from "fs";
import * as path from "path";

import {
  applyAdoptionPlan,
  buildAdoptionReport,
  readAdoptionManifest,
  rollbackAdoption,
  ADOPTION_DISPOSITIONS,
} from "./lib/capability/adoption-migrate";
import {
  buildCompatibilityCatalog,
  requiredAssetIdsForG5,
} from "./lib/capability/compatibility-catalog";
import { evaluateG5 } from "./lib/capability/compatibility-usage";
import { collectCompatibilityUsageWindow, writeFrozenCompatibilityCatalog } from "./lib/capability/compatibility-loader";
import { createMigrationObservation, writeMigrationObservation } from "./lib/capability/migration-evidence";
import { MIGRATION_TRANSITION_RELPATH, MIGRATION_WINDOW_RELPATH, advanceMigrationWindow, legacyRemovalEligibility, readMigrationWindow, recordMigrationRelease, startMigrationWindow } from "./lib/capability/migration-window";

const USAGE = `
capability-adopt — project capability adoption migration (D6)

  capability-adopt report   --project-id <id> [--project-root <p>] [--plugin-root <p>] [--json]
  capability-adopt catalog  [--plugin-root <p>] [--project-root <p>] [--freeze] [--json]
  capability-adopt g5       --windows <file> --project-local-default <semver> --current-version <semver> [--project-root <p>] [--plugin-root <p>] [--json]
  capability-adopt window   evidence --boundary <boundary.json> --project-id <id> --runtime-host <claude-code-cli|codex-cli> --mode <observe|shadow> --run-ids <id,id> [--plugin-root <package>] [--out-dir <dir>]
  capability-adopt window   start --boundary <boundary.json> [--to observe] [--actor <id>]
  capability-adopt window   record --boundary <boundary.json> --observation <observation.json>
  capability-adopt window   advance --boundary <boundary.json> --to <mode> [--actor <id>]
  capability-adopt window   status [--project-root <p>]
  capability-adopt adopt    --project-id <id> --decisions <file> --run-id <id> \\
                            --authorized-by <decision-record> --adopted-at <rfc3339> [--dry-run]
  capability-adopt rollback --project-id <id> --run-id <id> --authorized-by <record> \\
                            --adopted-at <rfc3339> --reason <text> [--sequences 3,4] [--dry-run]

Dispositions: ${ADOPTION_DISPOSITIONS.join(" | ")}

\`report\` and \`catalog\` are READ-ONLY and never write to the project.
`.trim();

/** Parse `--k v` / `--k=v` / `--flag` into a flat map. Unknown keys are the caller's problem. */
function parseArgs(argv: readonly string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = Object.create(null);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i++;
    } else {
      out[a.slice(2)] = true;
    }
  }
  return out;
}

function str(args: Record<string, string | boolean>, key: string): string | null {
  const v = args[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function fail(message: string, code: 1 | 2): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function main(argv: readonly string[]): number {
  const verb = argv[0] ?? "report";
  if (verb === "--help" || verb === "-h" || verb === "help") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const args = parseArgs(argv.slice(1));
  const json = args["json"] === true;

  // Default the plugin root to this file's repo, so the common case needs no flag.
  const pluginRoot = path.resolve(str(args, "plugin-root") ?? path.join(__dirname, ".."));
  const projectRoot = path.resolve(str(args, "project-root") ?? process.cwd());

  if (verb === "catalog") {
    const deprecation = str(args, "deprecation") ?? "deprecated";
    const deprecatedBy = str(args, "deprecated-by") ?? "cap-loc-D03";
    const catalog = buildCompatibilityCatalog({
      pluginRoot,
      deprecation,
      deprecatedBy,
    });
    if (json) {
      process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
    } else {
      process.stdout.write(
        `compatibility catalog: ${catalog.template_count} template(s), ${catalog.domain_skill_count} domain skill(s), census_matches=${catalog.census_matches}\n`,
      );
      for (const e of catalog.entries) {
        process.stdout.write(`  ${e.kind}\t${e.id}\t${e.deprecation}\t${e.content_hash.slice(0, 12)}…\n`);
      }
      const required = requiredAssetIdsForG5(catalog, { pluginRoot });
      process.stdout.write(
        required.status === "ok"
          ? `G5 required_asset_ids: ${required.ids.length}\n`
          : `G5 required set unavailable: ${required.detail}\n`,
      );
    }
    for (const p of catalog.problems) process.stderr.write(`problem: ${p}\n`);
    if (args["freeze"] === true && catalog.census_matches) {
      try { process.stderr.write(`frozen catalog: ${writeFrozenCompatibilityCatalog(projectRoot, catalog)}\n`); }
      catch (error) { process.stderr.write(`refused: ${(error as Error).message}\n`); return 2; }
    }
    // A catalog that does not match the shipped census is REPORTED as a failure
    // exit, because every downstream gate that consumes it would otherwise treat
    // a short enumeration as complete.
    return catalog.census_matches ? 0 : 2;
  }

  if (verb === "g5") {
    const windowsPath = str(args, "windows");
    if (windowsPath === null) fail("--windows <file> is required", 1);
    const projectLocalDefault = str(args, "project-local-default");
    const currentVersion = str(args, "current-version");
    if (projectLocalDefault === null || currentVersion === null) {
      fail("--project-local-default <semver> and --current-version <semver> are required", 1);
    }
    let windows: unknown;
    try { windows = JSON.parse(fs.readFileSync(path.resolve(windowsPath), "utf8"))?.windows; }
    catch (error) { fail(`could not read windows file: ${(error as Error).message}`, 1); }
    if (!Array.isArray(windows)) fail("windows file must contain a windows array", 1);
    const catalog = buildCompatibilityCatalog({ pluginRoot, deprecation: "deprecated", deprecatedBy: "cap-loc-D03" });
    const required = requiredAssetIdsForG5(catalog, { pluginRoot });
    if (required.status !== "ok") { process.stderr.write(`refused: ${required.detail}\n`); return 2; }
    const rollups = [];
    for (const raw of windows) {
      const window = raw as Record<string, unknown>;
      if (typeof window?.start_release !== "string" || typeof window?.end_release !== "string" || !Array.isArray(window?.run_ids) || window.run_ids.some((id) => typeof id !== "string")) {
        process.stderr.write("refused: each window requires start_release, end_release, and string run_ids[]\n");
        return 2;
      }
      rollups.push(collectCompatibilityUsageWindow({ projectRoot, runIds: window.run_ids as string[], windowStartRelease: window.start_release, windowEndRelease: window.end_release, knownAssetIds: required.ids }));
    }
    const telemetry = evaluateG5({ rollups, required_asset_ids: required.ids });
    const removal = legacyRemovalEligibility({
      projectLocalDefault,
      currentVersion,
      g5Passed: telemetry.passed,
    });
    const verdict = {
      passed: telemetry.passed && removal.passed,
      blockers: [...telemetry.blockers, ...removal.blockers],
      telemetry,
      removal_floor: removal,
    };
    process.stdout.write(json ? `${JSON.stringify({ verdict, rollups }, null, 2)}\n` : `${verdict.passed ? "PASS" : "BLOCKED"}: G5 compatibility removal (${verdict.blockers.join("; ") || `${telemetry.removable.length} assets cleared`})\n`);
    return verdict.passed ? 0 : 2;
  }

  if (verb === "window") {
    const action = argv[1] ?? "status";
    const windowArgs = parseArgs(argv.slice(2));
    const allowedByAction: Record<string, readonly string[]> = {
      status: ["project-root", "json"],
      evidence: ["project-root", "plugin-root", "boundary", "project-id", "runtime-host", "mode", "run-ids", "out-dir", "json"],
      start: ["project-root", "boundary", "to", "actor", "json"],
      record: ["project-root", "boundary", "observation", "json"],
      advance: ["project-root", "boundary", "to", "actor", "json"],
    };
    const allowed = allowedByAction[action];
    if (!allowed) { process.stderr.write(`${USAGE}\n`); return 1; }
    const unknown = Object.keys(windowArgs).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) fail(`unknown window option(s): ${unknown.map((key) => `--${key}`).join(", ")}`, 1);
    if (action === "status") {
      const state = readMigrationWindow(projectRoot);
      const unresolvedState = [MIGRATION_WINDOW_RELPATH, MIGRATION_TRANSITION_RELPATH].some((relativePath) => {
        try { fs.lstatSync(path.join(projectRoot, relativePath)); return true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
      });
      process.stdout.write(`${JSON.stringify(state ?? { status: unresolvedState ? "invalid_or_recovery_required" : "absent" }, null, 2)}\n`);
      return state ? 0 : 2;
    }
    const boundaryPath = str(windowArgs, "boundary");
    if (!boundaryPath) fail("window actions require --boundary <guild.capability_migration_boundary.v1.json>", 1);
    if (action === "evidence") {
      const projectId = str(windowArgs, "project-id");
      const runtimeHost = str(windowArgs, "runtime-host");
      const mode = str(windowArgs, "mode");
      const runIds = str(windowArgs, "run-ids")?.split(",").filter(Boolean) ?? [];
      if (!projectId || (runtimeHost !== "claude-code-cli" && runtimeHost !== "codex-cli") || (mode !== "observe" && mode !== "shadow") || runIds.length === 0) fail("window evidence requires --project-id <id> --runtime-host <claude-code-cli|codex-cli> --mode <observe|shadow> --run-ids <id,id>", 1);
      try {
        const observation = createMigrationObservation({ pluginRoot, runtimeHost, projectRoot, boundaryPath, projectId, mode, runIds });
        const out = writeMigrationObservation(str(windowArgs, "out-dir") ?? path.join(projectRoot, ".guild/artifacts/capability/observations"), observation);
        process.stdout.write(`${JSON.stringify({ status: "written", path: out, observation }, null, 2)}\n`);
        return 0;
      } catch (error) { process.stderr.write(`refused: ${(error as Error).message}\n`); return 2; }
    }
    const actor = str(windowArgs, "actor") ?? "operator";
    const observationPath = str(windowArgs, "observation");
    try {
      if (action === "start") {
        const mode = (str(windowArgs, "to") ?? "observe") as never;
        process.stdout.write(`${JSON.stringify(startMigrationWindow({ projectRoot, mode, boundaryPath, actor }), null, 2)}\n`);
        return 0;
      }
      if (action === "record") {
        if (!observationPath) fail("window record requires --observation <guild.capability_migration_observation.v1.json>", 1);
        process.stdout.write(`${JSON.stringify(recordMigrationRelease({ projectRoot, boundaryPath, observationPath }), null, 2)}\n`);
        return 0;
      }
      if (action === "advance") {
        const to = str(windowArgs, "to");
        if (!to) fail("window advance requires --to <mode>", 1);
        const result = advanceMigrationWindow({ projectRoot, to: to as never, boundaryPath, actor });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result.status === "advanced" ? 0 : 2;
      }
    } catch (error) { process.stderr.write(`refused: ${(error as Error).message}\n`); return 2; }
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }

  const projectId = str(args, "project-id");
  if (projectId === null) fail("--project-id is required", 1);

  if (verb === "report") {
    const report = buildAdoptionReport({ pluginRoot, projectRoot, projectId });
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(
        `adoption report for "${projectId}" — ${report.items.length} referenced legacy asset(s) [READ-ONLY, nothing written]\n`,
      );
      for (const item of report.items) {
        process.stdout.write(
          `  ${item.kind}\t${item.id}\tsuggest=${item.suggested_disposition}\trefs=${item.referenced_at.length}` +
            `${item.conflicts.length > 0 ? `\tconflicts=${item.conflicts.join(",")}` : ""}\n`,
        );
      }
      for (const id of report.unresolvable_references) {
        process.stderr.write(`unresolvable reference (no shipped asset): ${id}\n`);
      }
      for (const p of report.problems) process.stderr.write(`problem: ${p}\n`);
    }
    return 0;
  }

  if (verb === "adopt") {
    const decisionsPath = str(args, "decisions");
    const runId = str(args, "run-id");
    const authorizedBy = str(args, "authorized-by");
    const adoptedAt = str(args, "adopted-at");
    if (decisionsPath === null) fail("--decisions <file> is required", 1);
    if (runId === null) fail("--run-id is required", 1);
    if (authorizedBy === null) fail("--authorized-by <decision-record> is required", 1);
    // Caller-supplied, never `new Date()`: the contract has no clock, and a
    // deterministic timestamp is what lets a replay produce a byte-identical
    // manifest.
    if (adoptedAt === null) fail("--adopted-at <rfc3339> is required (the contract has no clock)", 1);

    let decisions: unknown;
    try {
      decisions = JSON.parse(fs.readFileSync(path.resolve(decisionsPath), "utf8"))?.decisions;
    } catch (err) {
      fail(`could not read decisions file: ${(err as Error).message}`, 1);
    }

    // The report is rebuilt here rather than read from a file: it carries the
    // source hashes the apply validates against, and a stale report would approve
    // bytes that no longer exist. `applyAdoptionPlan` re-checks each hash anyway.
    const report = buildAdoptionReport({ pluginRoot, projectRoot, projectId });
    const outcome = applyAdoptionPlan({
      pluginRoot,
      projectRoot,
      projectId,
      report,
      decisions,
      runId,
      authorizedBy,
      adoptedAt,
      dryRun: args["dry-run"] === true,
    });
    if (outcome.status === "refused") {
      process.stderr.write(`refused: ${outcome.reason}\n`);
      return 2;
    }
    process.stdout.write(
      json
        ? `${JSON.stringify(outcome, null, 2)}\n`
        : `${args["dry-run"] === true ? "[dry-run] " : ""}adopted ${outcome.entries_appended} entr(ies); wrote ${outcome.written.length} file(s); ` +
            `${outcome.compatibility_only.length} left on the compatibility surface\nmanifest: ${outcome.manifest_path}\ncommitment: ${outcome.manifest_digest}\n` +
            // D04: the resolver-mode auto-advance outcome is operator-visible on a
            // real apply (absent on dry-run, which writes nothing — config included).
            (outcome.resolver_advance === undefined
              ? ""
              : `resolver-mode advance: ${outcome.resolver_advance.advanced ? "advanced" : `skipped (${outcome.resolver_advance.reason})`}\n`),
    );
    return 0;
  }

  if (verb === "rollback") {
    const runId = str(args, "run-id");
    const authorizedBy = str(args, "authorized-by");
    const adoptedAt = str(args, "adopted-at");
    const reason = str(args, "reason");
    if (runId === null) fail("--run-id is required", 1);
    if (authorizedBy === null) fail("--authorized-by is required", 1);
    if (adoptedAt === null) fail("--adopted-at <rfc3339> is required", 1);
    if (reason === null) fail("--reason is required for a rollback", 1);

    const seqRaw = str(args, "sequences");
    const sequences =
      seqRaw === null ? undefined : seqRaw.split(",").map((s) => Number(s.trim()));

    const outcome = rollbackAdoption({
      // Required: a reversal entry must rebuild the ORIGINAL identity, which means
      // re-reading the shipped bytes. Omitting it here made the `rollback` verb
      // refuse every invocation — caught by an end-to-end adopt+rollback smoke that
      // the unit suites could not, because they call the library directly.
      pluginRoot,
      projectRoot,
      projectId,
      runId,
      authorizedBy,
      adoptedAt,
      reason,
      sequences,
      dryRun: args["dry-run"] === true,
    });
    if (outcome.status === "refused") {
      process.stderr.write(`refused: ${outcome.reason}\n`);
      return 2;
    }
    process.stdout.write(
      json
        ? `${JSON.stringify(outcome, null, 2)}\n`
        : `${args["dry-run"] === true ? "[dry-run] " : ""}rolled back ${outcome.entries_appended} entr(ies); removed ${outcome.removed.length} file(s)\n` +
            `restored to compatibility: ${outcome.restored_ids.join(", ") || "(none)"}\ncommitment: ${outcome.manifest_digest}\n`,
    );
    return 0;
  }

  if (verb === "status") {
    const manifest = readAdoptionManifest(projectRoot);
    if (manifest === null) {
      process.stdout.write("no valid adoption manifest in this project\n");
      return 0;
    }
    process.stdout.write(
      json
        ? `${JSON.stringify(manifest, null, 2)}\n`
        : `adoption manifest for "${manifest.project_id}": ${manifest.entries.length} entr(ies)\n`,
    );
    return 0;
  }

  process.stderr.write(`${USAGE}\n`);
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

export { main as capabilityAdoptMain };
