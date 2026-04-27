import type { ComponentKey, Comparison } from "../../../src/types";
import { COMPONENT_KEYS } from "../../../src/types";

interface Props {
  comparison: Comparison;
}

const REGRESSION_THRESHOLD = 1; // ≥ 1 weighted point per spec §Success P2.

interface Row {
  component: ComponentKey;
  baseline: number;
  candidate: number;
  delta: number;
  classification: "regression" | "fix" | "neutral";
}

function classify(component: ComponentKey, delta: number, baseline: number): Row["classification"] {
  // Regressions: negative delta on outcome or delegation ≥ 1 weighted point.
  if ((component === "outcome" || component === "delegation") && delta <= -REGRESSION_THRESHOLD) {
    return "regression";
  }
  // Fixes: positive delta on a previously-failing component (baseline 0).
  if (delta > 0 && baseline === 0) {
    return "fix";
  }
  return "neutral";
}

export function DeltaTable({ comparison }: Props) {
  const rows: Row[] = COMPONENT_KEYS.map((key) => {
    const d = comparison.per_component_delta[key];
    return {
      component: key,
      baseline: d.baseline,
      candidate: d.candidate,
      delta: d.delta,
      classification: classify(key, d.delta, d.baseline),
    };
  });

  return (
    <table aria-label="Per-component deltas">
      <thead>
        <tr>
          <th>Component</th>
          <th>Baseline</th>
          <th>Candidate</th>
          <th>Δ</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.component} data-classification={row.classification}>
            <td>{row.component}</td>
            <td className="score-num">{row.baseline.toFixed(2)}</td>
            <td className="score-num">{row.candidate.toFixed(2)}</td>
            <td
              className="score-num"
              style={{
                color:
                  row.delta > 0
                    ? "var(--status-pass-fg)"
                    : row.delta < 0
                      ? "var(--status-fail-fg)"
                      : undefined,
              }}
            >
              {row.delta >= 0 ? "+" : ""}
              {row.delta.toFixed(2)}
            </td>
            <td>
              {row.classification === "regression" ? (
                <span className="zero-reason">regression</span>
              ) : row.classification === "fix" ? (
                <span className="pill" data-status="pass">
                  fix
                </span>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
