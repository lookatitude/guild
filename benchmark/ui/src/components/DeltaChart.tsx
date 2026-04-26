import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ComponentDelta, ComponentKey, Comparison } from "../../../src/types";
import { COMPONENT_KEYS } from "../../../src/types";

interface Props {
  comparison: Comparison;
  height?: number;
}

interface Row {
  component: ComponentKey;
  delta: number;
  baseline: number;
  candidate: number;
}

function buildRows(comparison: Comparison): Row[] {
  return COMPONENT_KEYS.map((key) => {
    const d: ComponentDelta = comparison.per_component_delta[key];
    return {
      component: key,
      delta: d.delta,
      baseline: d.baseline,
      candidate: d.candidate,
    };
  });
}

export function DeltaChart({ comparison, height = 240 }: Props) {
  const rows = buildRows(comparison);
  return (
    <div role="img" aria-label="Per-component delta chart" style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="component" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="delta">
            {rows.map((row) => (
              <Cell
                key={row.component}
                fill={row.delta >= 0 ? "#1e6e34" : "#a4243b"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
