/**
 * The ONE creation seam for `.guild/agents/<role>.md` (KTD55 / R67).
 *
 * Every writer that can bring a specialist profile into existence calls
 * `gateProfileCreation` first: the roster mint, capability adoption, and project
 * RSI. The gate is `resolveMintScope` on the run's bound class, so a debug,
 * research, or ops run cannot grow the roster through a side door. A writer that
 * cannot name the class passes `null` and is refused: an unknown class never
 * defaults to a minting one.
 *
 * `profile-create.test.ts` scans the tree for any other `.guild/agents` writer
 * that does not call this function.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createGuildStorage, readScalarField, splitFrontmatter } from "../state";
import { resolveMintScope, sliceRosterForGoal, type RosterMember, type RosterSliceResult } from "./compose-scope";
import { WORKFLOW_CLASSES, type GoalV1, type WorkflowClass } from "./goal-contract";

export type ProfileCreationGate =
  | { ok: true; role: string; workflow_class: WorkflowClass }
  | { ok: false; role: string; reason: string; next_need: "operator" };

/**
 * Decide whether `writer` may CREATE the profile for `role` on a run bound to
 * `workflow_class`. Re-using an existing profile is not creation and does not
 * need this gate.
 */
export function gateProfileCreation(input: {
  workflow_class: WorkflowClass | string | null | undefined;
  role: string;
  /** Who is asking, for the refusal text: "roster.mint", "capability.adopt", ... */
  writer: string;
}): ProfileCreationGate {
  const cls = input.workflow_class;
  if (typeof cls !== "string" || !(WORKFLOW_CLASSES as readonly string[]).includes(cls)) {
    return {
      ok: false,
      role: input.role,
      next_need: "operator",
      reason:
        `${input.writer}: no workflow class bound${cls ? ` ('${String(cls)}' is not a class)` : ""} — ` +
        `creating .guild/agents/${input.role}.md is class-scoped (R67)`,
    };
  }
  const scope = resolveMintScope({ workflow_class: cls as WorkflowClass });
  if (!scope.may_mint) {
    return { ok: false, role: input.role, next_need: "operator", reason: `${input.writer}: ${scope.reason}` };
  }
  return { ok: true, role: input.role, workflow_class: cls as WorkflowClass };
}

// ── The per-goal slice over MINTED profiles (KTD62 / R73) ────────────────────

/** A minted profile: a regular `.guild/agents/*.md` file in this project. */
export interface MintedProfile extends RosterMember {
  source: "project";
  file: string;
}

/**
 * The project's minted profiles, keyed by frontmatter `name:` (file basename when
 * absent). Symlinks and non-files are skipped: a slice never selects a profile it
 * cannot prove is this project's own file.
 */
export function readMintedProfiles(projectRoot: string): MintedProfile[] {
  const root = path.resolve(projectRoot);
  const dir = createGuildStorage(root, { activeRoot: root, profile: "standalone" }).definition("agents");
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
  } catch {
    return [];
  }
  const out: MintedProfile[] = [];
  for (const n of names) {
    const file = path.join(dir, n);
    let text: string;
    try {
      if (!fs.lstatSync(file).isFile()) continue;
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Shared frontmatter reader (OD-3): the key is matched by the reader, only the
    // VALUE shape is checked here.
    const { frontmatter } = splitFrontmatter(text);
    const rawName = frontmatter === null ? undefined : readScalarField(frontmatter, "name");
    const named = rawName !== undefined && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(rawName) ? [rawName, rawName] : null;
    out.push({ name: named ? named[1] : n.slice(0, -3), source: "project", file });
  }
  return out;
}

/** Slice a goal's roster from the profiles this project already minted. Never mints. */
export function sliceMintedRosterForGoal(input: {
  projectRoot: string;
  goal: Pick<GoalV1, "roster_role_ids">;
}): RosterSliceResult<MintedProfile> {
  return sliceRosterForGoal({
    scope: "goal",
    phase_roster: readMintedProfiles(input.projectRoot),
    goal: input.goal,
  });
}
