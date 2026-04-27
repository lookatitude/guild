import type { Score } from "../../../src/types";
import { StatusPill } from "./StatusPill";

interface Props {
  score: Score;
  caption?: string;
}

export function ScoreCard({ score, caption }: Props) {
  return (
    <div className="card score-card">
      {caption ? <h3>{caption}</h3> : null}
      <div className="row" style={{ alignItems: "baseline" }}>
        <div className="score-num" style={{ fontSize: 40, fontWeight: 700 }}>
          {score.guild_score.toFixed(2)}
        </div>
        <StatusPill status={score.status} />
        {score.partial ? (
          <span className="zero-reason" aria-label="partial run">
            partial
          </span>
        ) : null}
      </div>
      <dl className="kv-grid" style={{ marginTop: 12 }}>
        <dt>Run id</dt>
        <dd>
          <code>{score.run_id}</code>
        </dd>
        <dt>Case</dt>
        <dd>{score.case_slug}</dd>
        <dt>Plugin ref</dt>
        <dd>
          <code>{score.plugin_ref}</code>
        </dd>
        <dt>Scored at</dt>
        <dd>{score.scored_at}</dd>
        {score.missing_artifacts.length > 0 ? (
          <>
            <dt>Missing</dt>
            <dd>{score.missing_artifacts.join(", ")}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
