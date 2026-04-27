import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CaseSummary, CasesListResponse } from "../../../src/types";
import { useFetch } from "../hooks/useFetch";
import { api, postRun, PostRunError } from "../lib/api";

// Per-button state machine for the live-run POST flow:
//   idle          — case selected, ready to POST
//   submitting    — request in flight; button disabled, no error
//   error-409     — backend reports a run already in flight; button re-enabled
//   error-400     — backend rejected the body shape; button re-enabled
//   error-network — fetch threw before HTTP status; button re-enabled
type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error-409"; currentRunId: string | undefined; message: string }
  | { kind: "error-400"; message: string }
  | { kind: "error-network"; message: string };

const IDLE: SubmitState = { kind: "idle" };

export default function TriggerPanelPage() {
  const { data, error, status } = useFetch<CasesListResponse>(api.cases());
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [submit, setSubmit] = useState<SubmitState>(IDLE);
  const navigate = useNavigate();

  const selected: CaseSummary | undefined = data?.cases.find(
    (c) => c.id === selectedId,
  );

  // Reset any prior submit error when the operator picks a different case;
  // stale "run in flight: <id>" messaging would confuse the next attempt.
  function chooseCase(id: string) {
    setSelectedId(id);
    setSubmit(IDLE);
  }

  async function onRun() {
    if (!selected) return;
    setSubmit({ kind: "submitting" });
    try {
      const res = await postRun({ case_slug: selected.id });
      navigate(`/runs/${encodeURIComponent(res.run_id)}`);
    } catch (e) {
      if (e instanceof PostRunError) {
        if (e.status === 409) {
          const currentRunId =
            typeof e.body.current_run_id === "string"
              ? e.body.current_run_id
              : undefined;
          setSubmit({
            kind: "error-409",
            currentRunId,
            message: e.message || "another run is already in flight",
          });
          return;
        }
        if (e.status === 400) {
          setSubmit({ kind: "error-400", message: e.message });
          return;
        }
        // Any other HTTP status — surface the body's message generically.
        setSubmit({
          kind: "error-network",
          message: `server returned ${e.status}: ${e.message}`,
        });
        return;
      }
      const msg =
        e instanceof Error ? e.message : "couldn't reach server";
      setSubmit({ kind: "error-network", message: msg });
    }
  }

  const submitting = submit.kind === "submitting";

  return (
    <section>
      <h1>Trigger panel</h1>
      <p className="muted">
        Select a case and click <strong>Run</strong> — POSTs{" "}
        <code>/api/runs</code>; the UI navigates to the run detail page and
        polls until the run reaches a terminal state.
      </p>

      {status === "loading" ? <div className="loading">Loading cases…</div> : null}
      {status === "error" ? (
        <div className="error" role="alert">
          {error?.message ?? "failed to load cases"}
        </div>
      ) : null}

      {status === "success" && data ? (
        <div className="row" style={{ alignItems: "flex-start", gap: 24 }}>
          <div style={{ flex: "1 1 280px", minWidth: 240 }}>
            <h2>Cases</h2>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {data.cases.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => chooseCase(c.id)}
                    aria-pressed={selectedId === c.id}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      marginBottom: 4,
                      background:
                        selectedId === c.id
                          ? "var(--color-link)"
                          : "var(--color-surface)",
                      color:
                        selectedId === c.id ? "white" : "var(--color-fg)",
                    }}
                  >
                    <strong>{c.id}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {c.title}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div style={{ flex: "2 1 360px" }}>
            {selected ? (
              <div className="card">
                <h2>{selected.title}</h2>
                <dl className="kv-grid">
                  <dt>Case id</dt>
                  <dd>
                    <code>{selected.id}</code>
                  </dd>
                  <dt>Expected specialists</dt>
                  <dd>{selected.expected_specialists.join(", ")}</dd>
                  <dt>Expected stage order</dt>
                  <dd>
                    <code>{selected.expected_stage_order.join(" → ")}</code>
                  </dd>
                </dl>
                <div style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    onClick={onRun}
                    disabled={submitting}
                    aria-busy={submitting || undefined}
                    data-testid="run-button"
                  >
                    {submitting ? "Starting…" : "Run"}
                  </button>
                </div>
                {submit.kind === "error-409" ? (
                  <div
                    className="error"
                    role="alert"
                    style={{ marginTop: 12 }}
                    data-testid="run-error-409"
                  >
                    A run is already in flight
                    {submit.currentRunId ? (
                      <>
                        :{" "}
                        <Link to={`/runs/${encodeURIComponent(submit.currentRunId)}`}>
                          <code>{submit.currentRunId}</code>
                        </Link>
                      </>
                    ) : (
                      "."
                    )}
                  </div>
                ) : null}
                {submit.kind === "error-400" ? (
                  <div
                    className="error"
                    role="alert"
                    style={{ marginTop: 12 }}
                    data-testid="run-error-400"
                  >
                    {submit.message}
                  </div>
                ) : null}
                {submit.kind === "error-network" ? (
                  <div
                    className="error"
                    role="alert"
                    style={{ marginTop: 12 }}
                    data-testid="run-error-network"
                  >
                    Couldn't reach server: {submit.message}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty">Select a case from the list.</div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
