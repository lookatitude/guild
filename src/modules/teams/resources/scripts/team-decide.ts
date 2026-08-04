#!/usr/bin/env -S npx tsx
/**
 * scripts/team-decide.ts
 *
 * Stable CLI shim for the REUSABLE pre-dispatch team-decision interaction
 * (lane T6b). Implementation:
 * src/modules/teams/workflows/team-decision-surface.ts.
 *
 * Every phase that can dispatch runs `gate` FIRST and stops on a non-zero exit:
 *
 *   review      npx tsx scripts/team-decide.ts review  --proposal <f.yaml|f.json>
 *                   [--previous <f>] [--schedule <f>] [--decision <f>] [--json]
 *   restructure npx tsx scripts/team-decide.ts restructure --proposal <f> --edits <f.json>
 *                   --decided-by <user|operator>[:<id>] --channel <interactive_prompt|terminal_prompt|file_gate> [--json]
 *   gate        npx tsx scripts/team-decide.ts gate --proposal <f>
 *                   --cwd <repo-root> [--run-id <id>] [--phase <p>] [--json]
 *   persist     npx tsx scripts/team-decide.ts persist --proposal <f> --cwd <root>
 *   record      npx tsx scripts/team-decide.ts record --proposal <f> --cwd <root>
 *                   --decision <approve|reject> --decided-by <user|operator>[:<id>]
 *                   --channel <interactive_prompt|terminal_prompt|file_gate> [--decided-at <ts>]
 *
 * `gate` reads the PERSISTED decision trail under
 * `.guild/runs/<run-id>/team-plan/` - an in-memory or caller-supplied approval
 * is never accepted. Exit 0 = dispatch authorized; exit 3 = refused (fails
 * closed); exit 1 = usage/argument error; exit 2 = unreadable artifact.
 *
 * ── T7R-R1-B1: WHY `persist` AND `record` EXIST ─────────────────────────────
 * The approve-before-dispatch gate is now MANDATORY on the real launcher path,
 * so the trail it reads must actually be WRITTEN by production composition.
 * Before this, `writeProposal` / `writeDecision` had no non-test callers at all
 * - composition was skill prose, and prose is not a security step. These two
 * verbs are the deterministic code that lands the trail:
 *
 *   persist  writes the composed guild.team_proposal.v2 into the run trail
 *            (immutable; a changed roster is a NEW version, never an edit).
 *            Persisting a PROPOSAL is not an approval and authorizes nothing.
 *   record   routes the user's decision through `recordDecision` -> the frozen
 *            §4 user-actor allowlist - and persists it via `writeDecision`.
 *
 * `record` still cannot manufacture an approval: `recordDecision` refuses any
 * actor kind outside {user, operator} (every agent-side identity included) and
 * any channel outside the closed provenance enum, and `writeDecision` refuses an
 * artifact whose self-referential decision_hash does not recompute. The verb is
 * the CONFIRMATION PATH's recording step, not a substitute for the confirmation.
 */

import * as fs from "fs";
import * as path from "path";

import { parseYaml } from "../src/modules/state";
import {
  buildProposalReview,
  loadPersistedDecisions,
  planRestructure,
  preDispatchGate,
  renderProposalReview,
  renderRestructurePlan,
  type LoadedDecision,
} from "../src/modules/teams/workflows/team-decision-surface";
import { writeProposal, type TeamProposalV2 } from "../src/modules/teams/workflows/team-proposal";
import type { TeamScheduleV1 } from "../src/modules/teams/workflows/team-schedule";
import {
  recordDecision,
  writeDecision,
  type TeamDecisionV1,
} from "../src/modules/teams/workflows/team-decision";

const USAGE = [
  "usage: team-decide.ts <review|restructure|gate|persist|record> [flags]",
  "  review      --proposal <f> [--previous <f>] [--schedule <f>] [--decision <f>] [--json]",
  "  restructure --proposal <f> --edits <f.json> --decided-by <actor> --channel <c> [--json]",
  "  gate        --proposal <f> --cwd <root> [--run-id <id>] [--phase <p>] [--json]",
  "  persist     --proposal <f> --cwd <root> [--json]",
  "  record      --proposal <f> --cwd <root> --decision <approve|reject> --decided-by <actor>",
  "              --channel <c> [--decided-at <rfc3339>] [--json]",
].join("\n");

interface Flags {
  [k: string]: string | boolean | undefined;
}

function parseFlags(argv: string[]): Flags | { error: string } {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) return { error: "unexpected positional argument: " + a };
    const eq = a.indexOf("=");
    const key = (eq === -1 ? a.slice(2) : a.slice(2, eq)).replace(/-/g, "_");
    if (eq !== -1) out[key] = a.slice(eq + 1);
    else if (a === "--json") out[key] = true;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

/** Read a proposal/decision/schedule artifact (YAML or JSON) - read-only. */
function readArtifact(p: unknown): any {
  if (typeof p !== "string" || p.length === 0) throw new Error("missing file argument");
  const abs = path.resolve(p);
  const raw = fs.readFileSync(abs, "utf8");
  return abs.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const verb = argv[0];
  const parsed = parseFlags(argv.slice(1));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n" + USAGE + "\n");
    return 1;
  }
  const f = parsed as Flags;
  const json = f["json"] === true;

  try {
    if (verb === "review") {
      const proposal = readArtifact(f["proposal"]) as TeamProposalV2;
      const previous = f["previous"] ? (readArtifact(f["previous"]) as TeamProposalV2) : null;
      const schedule = f["schedule"] ? (readArtifact(f["schedule"]) as TeamScheduleV1) : null;
      const decision = f["decision"] ? (readArtifact(f["decision"]) as TeamDecisionV1) : null;
      const view = buildProposalReview({ proposal, previous, schedule, decision });
      process.stdout.write(json ? JSON.stringify(view, null, 2) + "\n" : renderProposalReview(view));
      return 0;
    }

    if (verb === "restructure") {
      const proposal = readArtifact(f["proposal"]) as TeamProposalV2;
      const edits = readArtifact(f["edits"]);
      if (!Array.isArray(edits)) {
        process.stderr.write("--edits must be a JSON array of restructure edits\n");
        return 1;
      }
      const decidedBy = f["decided_by"];
      const channel = f["channel"];
      if (typeof decidedBy !== "string" || typeof channel !== "string") {
        process.stderr.write(
          "--decided-by and --channel are required: a restructure is a USER act and is " +
            "recorded with its confirmation provenance\n"
        );
        return 1;
      }
      // `--decided-by <kind>[:<id>]` is parsed into the TYPED §4 actor object;
      // the validator in team-decision.ts owns which kinds/ids are allowed, so
      // an agent-side identity is refused there, not here.
      const [actorKind, actorId] = decidedBy.split(":");
      const actor = actorId === undefined ? { kind: actorKind } : { kind: actorKind, id: actorId };
      const plan = planRestructure(proposal, {
        decision: "restructure",
        restructure_edits: edits,
        decided_by: actor,
        decision_channel: channel,
      } as any);
      // T6B-R1-B4: a CONVERGED iteration mints nothing - `plan.result` is null,
      // `plan.proposal` is the untouched current proposal, and the JSON says so
      // with explicit nulls rather than echoing a freshly-minted version.
      process.stdout.write(
        json
          ? JSON.stringify(
              {
                converged: plan.converged,
                proposal: plan.proposal,
                new_proposal: plan.result?.new_proposal ?? null,
                restructure_decision: plan.result?.restructure_decision ?? null,
                new_decision_state: plan.result?.new_decision_state ?? null,
                lost_obligations: plan.result?.lost_obligations ?? [],
                no_op_edits: plan.no_op_edits,
                uncited_roster_delta: plan.uncited_roster_delta,
                cap_reintroduction: plan.cap_reintroduction,
                valid: plan.valid,
              },
              null,
              2
            ) + "\n"
          : renderRestructurePlan(plan) +
              renderProposalReview(
                buildProposalReview({
                  proposal: plan.proposal,
                  previous: plan.converged ? null : proposal,
                  lost_obligations: plan.result?.lost_obligations ?? [],
                })
              )
      );
      return plan.valid ? 0 : 3;
    }

    if (verb === "gate") {
      const proposal = readArtifact(f["proposal"]) as TeamProposalV2;
      const cwd = typeof f["cwd"] === "string" ? path.resolve(f["cwd"]) : process.cwd();
      const runId = typeof f["run_id"] === "string" ? f["run_id"] : proposal.run_id;
      const phase = typeof f["phase"] === "string" ? f["phase"] : proposal.phase;
      const decisions: LoadedDecision[] = loadPersistedDecisions(cwd, runId, phase);
      const verdict = preDispatchGate(proposal, decisions);
      const view = buildProposalReview({ proposal, gate: verdict });
      process.stdout.write(
        json
          ? JSON.stringify({ verdict, view }, null, 2) + "\n"
          : renderProposalReview(view) +
              "\nTRAIL (" +
              decisions.length +
              " persisted decision artifact(s) considered)\n" +
              verdict.considered.map((c) => "  " + c.source_path + ": " + c.verdict).join("\n") +
              "\n"
      );
      if (!verdict.allowed) {
        process.stderr.write(
          "DISPATCH BLOCKED (" + verdict.refusal + "): " + verdict.reason + "\n"
        );
        return 3;
      }
      return 0;
    }

    if (verb === "persist") {
      // T7R-R1-B1: the composition-side writer. Persisting a PROPOSAL is not an
      // approval - it only puts the exact bytes the user is asked about into the
      // immutable §1 trail so the mandatory dispatch gate has something to bind.
      const proposal = readArtifact(f["proposal"]) as TeamProposalV2;
      const cwd = typeof f["cwd"] === "string" ? path.resolve(f["cwd"]) : process.cwd();
      const written = writeProposal(cwd, proposal);
      process.stdout.write(
        json
          ? JSON.stringify({ proposal_path: written, proposal_hash: proposal.proposal_hash }, null, 2) + "\n"
          : "persisted proposal: " + written + "\n"
      );
      return 0;
    }

    if (verb === "record") {
      // The user's decision, recorded through the canonical builder. Every
      // refusal that matters lives in recordDecision/writeDecision: the §4
      // user-actor allowlist (no agent identity can ever decide), the closed
      // channel enum, and the recomputed decision_hash. Nothing is decided here.
      const proposal = readArtifact(f["proposal"]) as TeamProposalV2;
      const cwd = typeof f["cwd"] === "string" ? path.resolve(f["cwd"]) : process.cwd();
      const decision = f["decision"];
      const decidedBy = f["decided_by"];
      const channel = f["channel"];
      if (
        typeof decision !== "string" ||
        typeof decidedBy !== "string" ||
        typeof channel !== "string"
      ) {
        process.stderr.write(
          "--decision, --decided-by and --channel are required: a team decision is a USER act " +
            "and is recorded with its confirmation provenance\n"
        );
        return 1;
      }
      const [actorKind, actorId] = decidedBy.split(":");
      const actor = actorId === undefined ? { kind: actorKind } : { kind: actorKind, id: actorId };
      const built = recordDecision(proposal, {
        decision,
        decided_by: actor,
        decision_channel: channel,
        ...(typeof f["decided_at"] === "string" ? { decided_at: f["decided_at"] } : {}),
      } as any);
      const written = writeDecision(cwd, built);
      process.stdout.write(
        json
          ? JSON.stringify({ decision_path: written, decision: built }, null, 2) + "\n"
          : "recorded " +
              built.decision +
              " by " +
              built.decided_by +
              "\npersisted decision: " +
              written +
              "\n"
      );
      return 0;
    }

    process.stderr.write("unknown sub-verb: " + String(verb) + "\n" + USAGE + "\n");
    return 1;
  } catch (err) {
    process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
    return 2;
  }
}

if (require.main === module) {
  process.exit(main());
}
