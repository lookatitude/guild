import { Link, useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ComponentKey,
  RunDetailResponse,
  RunsListResponse,
  Score,
} from "../../../src/types";
import { COMPONENT_KEYS } from "../../../src/types";
import { useFetch } from "../hooks/useFetch";
import { api } from "../lib/api";
import { ScoreCard } from "../components/ScoreCard";

interface DemoBarRow {
  component: ComponentKey;
  weighted: number;
  raw: number;
}

function buildBars(score: Score): DemoBarRow[] {
  return COMPONENT_KEYS.map((k) => ({
    component: k,
    weighted: score.components[k].weighted,
    raw: score.components[k].raw_subscore,
  }));
}

export default function DemoPage() {
  const params = useParams<{ case_slug?: string }>();
  const caseSlug = params.case_slug;

  // Curated headline run = first row in the runs listing for this case (the
  // server sorts most-recent first).
  const runsUrl = caseSlug ? api.runs(caseSlug) : api.runs();
  const runs = useFetch<RunsListResponse>(runsUrl);
  const headlineId = runs.data?.runs[0]?.run_id ?? null;
  const detail = useFetch<RunDetailResponse>(
    headlineId ? api.runDetail(headlineId) : null,
  );

  return (
    <section>
      <h1>
        Demo
        {caseSlug ? (
          <>
            {" "}— <code>{caseSlug}</code>
          </>
        ) : null}
      </h1>
      <p className="muted">
        Curated single-case summary. Pick a case from the runs table to deep-link
        — <code>/demo/&lt;case_slug&gt;</code>.
      </p>

      {!caseSlug ? (
        <div className="empty">
          No case selected. Try{" "}
          <Link to="/demo/demo-url-shortener-build">
            /demo/demo-url-shortener-build
          </Link>
          .
        </div>
      ) : null}

      {runs.status === "loading" ? <div className="loading">Loading runs…</div> : null}
      {runs.status === "error" ? (
        <div className="error" role="alert">
          {runs.error?.message ?? "failed to load runs"}
        </div>
      ) : null}

      {runs.status === "success" && runs.data && runs.data.runs.length === 0 ? (
        <div className="empty">No runs for this case yet.</div>
      ) : null}

      {detail.status === "loading" ? <div className="loading">Loading detail…</div> : null}
      {detail.status === "error" ? (
        <div className="error" role="alert">
          {detail.error?.message ?? "failed to load run detail"}
        </div>
      ) : null}

      {detail.status === "success" && detail.data ? (
        <>
          <ScoreCard score={detail.data.score} caption="Headline run" />
          <section>
            <h2>Component breakdown (weighted)</h2>
            <div role="img" aria-label="Demo component chart" style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buildBars(detail.data.score)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="component" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="weighted" fill="#0a58ca" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <p>
            <Link to={`/runs/${encodeURIComponent(detail.data.run.run_id)}`}>
              See full run detail →
            </Link>
          </p>
        </>
      ) : null}
    </section>
  );
}
