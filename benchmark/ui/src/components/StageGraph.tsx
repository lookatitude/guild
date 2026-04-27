import type { MetricsJson, Stage, StageName } from "../../../src/types";
import { EXPECTED_GATES } from "../../../src/types";

interface Props {
  metrics: MetricsJson;
  selected?: string;
  onSelect?: (stage: string) => void;
}

interface RenderedStage {
  name: StageName;
  status: Stage["status"];
  duration_ms?: number;
  reason?: string;
}

function buildStages(metrics: MetricsJson): RenderedStage[] {
  const byName = new Map(metrics.stages.map((s) => [s.name, s]));
  return EXPECTED_GATES.map((name) => {
    const found = byName.get(name);
    if (!found) {
      return { name, status: "missing" as const };
    }
    return {
      name,
      status: found.status,
      duration_ms: found.duration_ms,
      reason: found.reason,
    };
  });
}

function fmtDuration(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function StageGraph({ metrics, selected, onSelect }: Props) {
  const stages = buildStages(metrics);
  return (
    <ol className="stage-list" aria-label="Stage graph">
      {stages.map((stage) => {
        const isClickable = !!onSelect;
        const isSelected = selected === stage.name;
        return (
          <li
            key={stage.name}
            className="stage-pill"
            data-status={stage.status}
            data-selected={isSelected ? "true" : undefined}
            tabIndex={isClickable ? 0 : -1}
            role={isClickable ? "button" : undefined}
            onClick={isClickable ? () => onSelect?.(stage.name) : undefined}
            onKeyDown={
              isClickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect?.(stage.name);
                    }
                  }
                : undefined
            }
          >
            <span className="name">{stage.name}</span>
            <span className="meta">
              {stage.status} · {fmtDuration(stage.duration_ms)}
              {stage.reason ? ` · ${stage.reason}` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
