import type { ComponentKey, ComponentScore, Score } from "../../../src/types";
import { COMPONENT_KEYS } from "../../../src/types";

interface Props {
  score: Score;
}

const LABEL: Record<ComponentKey, string> = {
  outcome: "Outcome",
  delegation: "Delegation",
  gates: "Gates",
  evidence: "Evidence",
  loop_response: "Loop response",
  efficiency: "Efficiency",
};

function pct(component: ComponentScore): number {
  if (component.max_subscore <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, (component.raw_subscore / component.max_subscore) * 100),
  );
}

export function MetricBreakdown({ score }: Props) {
  return (
    <div className="metric-breakdown" aria-label="Score components">
      {COMPONENT_KEYS.map((key) => {
        const c = score.components[key];
        const filled = pct(c);
        // Loud-zero contract: when a raw_subscore is 0, render the reason
        // (missing_artifact / timeout / errored) inline so the operator sees
        // why the component zeroed instead of staring at a silent gap.
        const isZero = c.raw_subscore === 0;
        return (
          <div key={key} className="metric-row">
            <div>
              <strong>{LABEL[key]}</strong>
              <div className="muted">weight {c.weight}</div>
            </div>
            <div
              className={`metric-bar ${isZero ? "zero" : ""}`}
              role="progressbar"
              aria-valuenow={c.raw_subscore}
              aria-valuemin={0}
              aria-valuemax={c.max_subscore}
              aria-label={`${LABEL[key]} score`}
            >
              <div className="fill" style={{ width: `${filled}%` }} />
            </div>
            <div className="score-num">
              <strong>
                {c.raw_subscore.toFixed(2)} / {c.max_subscore}
              </strong>
              <div className="muted">weighted {c.weighted.toFixed(2)}</div>
              {isZero && c.reason ? (
                <span className="zero-reason" aria-label="zero reason">
                  {c.reason}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
