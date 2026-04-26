import { useSearchParams } from "react-router-dom";
import type { Comparison } from "../../../src/types";
import { useFetch } from "../hooks/useFetch";
import { api } from "../lib/api";
import { DeltaChart } from "../components/DeltaChart";
import { DeltaTable } from "../components/DeltaTable";
import { ReflectionBadge } from "../components/ReflectionBadge";

export default function ComparePage() {
  // Cross-route state lives in URL search params per p2-ui-architecture.md §3.3.
  const [params, setParams] = useSearchParams();
  const baseline = params.get("baseline") ?? "";
  const candidate = params.get("candidate") ?? "";

  const url =
    baseline && candidate ? api.comparison(baseline, candidate) : null;
  const { data, error, status } = useFetch<Comparison>(url);

  function update(field: "baseline" | "candidate", value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(field, value);
    else next.delete(field);
    setParams(next);
  }

  return (
    <section>
      <h1>Compare trial sets</h1>
      <form
        className="row"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Trial set selection"
        style={{ marginBottom: 16 }}
      >
        <label>
          Baseline set id{" "}
          <input
            value={baseline}
            onChange={(e) => update("baseline", e.target.value)}
            placeholder="e.g. demo-url-shortener-build-abcdef1-h0001"
            style={{ minWidth: 360 }}
          />
        </label>
        <label>
          Candidate set id{" "}
          <input
            value={candidate}
            onChange={(e) => update("candidate", e.target.value)}
            placeholder="e.g. demo-url-shortener-build-newcommit-h0001"
            style={{ minWidth: 360 }}
          />
        </label>
      </form>

      {!baseline || !candidate ? (
        <div className="empty">
          Enter a baseline and candidate set id. The comparison URL is
          deep-linkable —{" "}
          <code>/compare?baseline=&lt;id&gt;&amp;candidate=&lt;id&gt;</code>.
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="loading">Computing comparison…</div>
      ) : null}
      {status === "error" ? (
        <div className="error" role="alert">
          {error?.message ?? "failed to load comparison"}
        </div>
      ) : null}

      {status === "success" && data ? (
        <>
          <div className="card">
            <h2>Summary</h2>
            <div className="row" style={{ gap: 24 }}>
              <div>
                <div className="muted">Baseline mean</div>
                <div className="score-num" style={{ fontSize: 28, fontWeight: 700 }}>
                  {data.baseline.mean_guild_score.toFixed(2)}
                </div>
                <div className="muted">{data.baseline.run_count} runs</div>
              </div>
              <div>
                <div className="muted">Candidate mean</div>
                <div className="score-num" style={{ fontSize: 28, fontWeight: 700 }}>
                  {data.candidate.mean_guild_score.toFixed(2)}
                </div>
                <div className="muted">{data.candidate.run_count} runs</div>
              </div>
              <div>
                <div className="muted">Δ guild_score</div>
                <div
                  className="score-num"
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    color:
                      data.guild_score_delta.delta > 0
                        ? "var(--status-pass-fg)"
                        : data.guild_score_delta.delta < 0
                          ? "var(--status-fail-fg)"
                          : undefined,
                  }}
                >
                  {data.guild_score_delta.delta >= 0 ? "+" : ""}
                  {data.guild_score_delta.delta.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="muted">Status</div>
                <div>
                  <code>{data.status}</code>
                </div>
              </div>
            </div>
          </div>

          {data.reflection_applied ? (
            <ReflectionBadge reflection={data.reflection_applied} />
          ) : null}

          <section>
            <h2>Per-component delta</h2>
            <DeltaChart comparison={data} />
            <DeltaTable comparison={data} />
          </section>

          {data.excluded_runs.length > 0 ? (
            <section>
              <h2>Excluded runs</h2>
              <p className="muted">
                Runs filtered out for non-determinism (mismatched plugin_ref or
                model_ref).
              </p>
              <ul>
                {data.excluded_runs.map((er) => (
                  <li key={`${er.side}-${er.run_id}`}>
                    <code>{er.run_id}</code> ({er.side}) — {er.reason}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
