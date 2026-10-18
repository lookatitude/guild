/**
 * src/domains/config/inspection-persist.ts
 *
 * Run-binding-verified persistence for M0 inspection reports (lane T6, rework
 * round 2 — T6-R1-F1/F3). Inspection itself is PURE (model-inspect.ts creates
 * no file); when a run wants an inspection report ON RECORD — the M0 evidence
 * leg the M2 gate loads — it lands through THIS writer, which:
 *
 *   - requires the caller-threaded T3/T3b binding envelope (run_id +
 *     binding_ref) and calls assertWritableBinding BEFORE any write — an
 *     absent/closed/mismatched/malformed binding THROWS BindingRejectedError
 *     and nothing reaches disk (guild.session_context.v1 §5);
 *
 * T7-M3 (injected-seam-masks-real-path). This writer used to accept an optional
 * `fs?: BindingFs` and hand it to `assertWritableBinding` while writing with
 * Node's REAL `fs` — authorization and effect acting on DIFFERENT filesystems.
 * A caller passing a permissive/in-memory `BindingFs` got a real, unguarded
 * on-disk write past a gate that had verified nothing about the real disk
 * (§5: "runtime writes fail closed when the binding … cannot be verified").
 * The seam is GONE: verification and the write are now the same real fs by
 * construction, so no caller-supplied object can separate them again. Do not
 * reintroduce an fs parameter here without routing the write through it —
 * `run-binding.ts` and `session-context.ts` both write through their seam; the
 * asymmetry was unique to this writer.
 *   - derives the target directory from the VERIFIED binding's run_id (never
 *     from a caller-matched basename);
 *   - writes atomically (temp + rename), run-local only:
 *     `<root>/.guild/runs/<run_id>/inspection/<label>.json`.
 */

import * as fs from "fs";
import * as path from "path";

// Lazy barrel access from the compiled lifecycle-api chunk — see
// independence-record.ts for the full rationale (C04/KTD29, KTD10 fail-closed).
function lifecycleApi(): typeof import("../lifecycle") {
  if (__filename.endsWith(".ts")) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(path.join(__dirname, "..", "lifecycle")) as typeof import("../lifecycle");
  }
  // Bounded to the owning package (codex C04 r1): sibling chunk first, else the
  // NEAREST package root must carry it — never a checkout's copy past that root.
  const sibling = path.join(__dirname, "lifecycle-api.js");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (fs.existsSync(sibling)) return require(sibling) as typeof import("../lifecycle");
  for (let dir = path.dirname(__dirname); ; ) {
    const isPackageRoot =
      fs.existsSync(path.join(dir, "runtime")) ||
      fs.existsSync(path.join(dir, ".claude-plugin")) ||
      fs.existsSync(path.join(dir, ".codex-plugin")) ||
      fs.existsSync(path.join(dir, "guild.inventory.json"));
    if (isPackageRoot) {
      const chunk = path.join(dir, "runtime", "scripts", "lifecycle-api.js");
      if (!fs.existsSync(chunk)) {
        throw new Error(
          `guild: runtime/scripts/lifecycle-api.js missing from package root ${dir} — incomplete package; run \`bun run compile\` (KTD10 fail-closed)`,
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(chunk) as typeof import("../lifecycle");
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `guild: no package root found above ${__dirname} for lifecycle-api.js (KTD10 fail-closed)`,
  );
}
import { MODEL_INSPECTION_SCHEMA, type ModelInspectionV1 } from "./model-inspect";
import { durableGuildDir } from "../state";

const SAFE_LABEL = /^[A-Za-z0-9_.-]+$/;

/**
 * Persist ONE inspection report as run-local M0 evidence. Returns the absolute
 * path written, plus the run-dir-relative ref the M2 gate consumes. Fail
 * closed: an unverifiable binding, a report bound to a different run than the
 * binding, or an unsafe label throws — never a partial or misrouted write.
 */
export function persistInspectionReport(input: {
  root: string;
  report: ModelInspectionV1;
  binding: { run_id: string; binding_ref: string };
  /** File label (e.g. the lane or dispatch id); one report per label. */
  label: string;
}): { absPath: string; ref: string } {
  const { root, report, binding, label } = input;
  if (report.schema_version !== MODEL_INSPECTION_SCHEMA) {
    throw new Error(
      "refusing to persist a non-guild.model_inspection.v1 object as inspection evidence"
    );
  }
  if (!SAFE_LABEL.test(label)) {
    throw new Error(`inspection label "${label}" is not a safe path segment — refusing`);
  }
  if (report.run_id !== binding.run_id) {
    throw new Error(
      `run_binding_mismatch: inspection report for run "${report.run_id}" cannot be ` +
        `persisted under run "${binding.run_id}" — refusing`
    );
  }
  // §5 fail-closed gate: no write without the run's verified open binding.
  // T7-M3: NO `fs` is threaded — `assertWritableBinding` falls through to its
  // real-fs default, which is the SAME filesystem the mkdir/write/rename below
  // touch. Verification and effect are structurally inseparable here.
  const verified = lifecycleApi().assertWritableBinding({
    root,
    run_id: binding.run_id,
    binding_ref: binding.binding_ref,
  });
  const dir = path.join(durableGuildDir(root), "runs", verified.run_id, "inspection");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${label}.json`);
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, target);
  return { absPath: target, ref: path.join("inspection", `${label}.json`) };
}
