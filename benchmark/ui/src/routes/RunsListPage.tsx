import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { RunsListResponse, RunsListRow } from "../../../src/types";
import { useFetch } from "../hooks/useFetch";
import { api } from "../lib/api";
import { StatusPill } from "../components/StatusPill";

type SortKey = keyof Pick<
  RunsListRow,
  "started_at" | "guild_score" | "case_slug" | "status" | "run_id" | "plugin_ref"
>;

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

function sortRows(rows: RunsListRow[], sort: SortState): RunsListRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    if (av === bv) return 0;
    const cmp = av > bv ? 1 : -1;
    return sort.dir === "asc" ? cmp : -cmp;
  });
  return out;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "run_id", label: "Run id" },
  { key: "case_slug", label: "Case" },
  { key: "plugin_ref", label: "Plugin ref" },
  { key: "status", label: "Status" },
  { key: "guild_score", label: "Score" },
  { key: "started_at", label: "Started" },
];

export default function RunsListPage() {
  const { data, error, status, refetch } = useFetch<RunsListResponse>(api.runs());
  const [sort, setSort] = useState<SortState>({ key: "started_at", dir: "desc" });
  const [searchParams] = useSearchParams();
  // F4 (v1.3): forensic-only display filter. URL-driven only — sourced from
  // the 7-char prefix badge on RunDetailPage. No <input> by design (the
  // forensic-only contract forbids arbitrary-text search over the field).
  const authPrefix = (searchParams.get("auth") ?? "").trim();

  return (
    <section>
      <header className="row" style={{ justifyContent: "space-between" }}>
        <h1>Runs</h1>
        <button onClick={refetch} aria-label="Refresh runs">
          Refresh
        </button>
      </header>
      {status === "loading" ? <div className="loading">Loading runs…</div> : null}
      {status === "error" ? (
        <div className="error" role="alert">
          {error?.message ?? "failed to load runs"}
        </div>
      ) : null}
      {status === "success" && data ? (
        data.runs.length === 0 ? (
          <div className="empty">
            No runs found. Score a run with{" "}
            <code>npm run benchmark -- score --run-id &lt;id&gt;</code>.
          </div>
        ) : (
          (() => {
            const filteredRows = authPrefix
              ? data.runs.filter((r) =>
                  (r.auth_identity_hash ?? "").startsWith(authPrefix),
                )
              : data.runs;
            const visibleRows = sortRows(filteredRows, sort);
            // Empty-state-with-filter: data has runs but none match the
            // active prefix. Distinct from the global "No runs found" state.
            if (authPrefix && filteredRows.length === 0) {
              return (
                <>
                  <p className="muted" data-testid="runs-filter-indicator">
                    Showing 0 of {data.total} run{data.total === 1 ? "" : "s"}{" "}
                    (filtered by auth=<code>{authPrefix}</code>) ·{" "}
                    <Link to="/runs">clear</Link>
                  </p>
                  <div className="empty">
                    No runs match auth=<code>{authPrefix}</code>.{" "}
                    <Link to="/runs">Clear filter</Link>.
                  </div>
                </>
              );
            }
            return (
              <>
                {authPrefix ? (
                  <p className="muted" data-testid="runs-filter-indicator">
                    Showing {filteredRows.length} of {data.total} run
                    {data.total === 1 ? "" : "s"} (filtered by auth=
                    <code>{authPrefix}</code>) · <Link to="/runs">clear</Link>
                  </p>
                ) : (
                  <p className="muted">
                    Showing {data.total} run{data.total === 1 ? "" : "s"} (no
                    status filter — pass / fail / timeout / errored all
                    listed).
                  </p>
                )}
                <table>
                  <thead>
                    <tr>
                      {COLUMNS.map((col) => (
                        <th
                          key={col.key}
                          aria-sort={
                            sort.key === col.key
                              ? sort.dir === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            style={{ background: "none", border: 0, padding: 0, fontWeight: 600 }}
                            onClick={() =>
                              setSort((s) =>
                                s.key === col.key
                                  ? { key: col.key, dir: s.dir === "asc" ? "desc" : "asc" }
                                  : { key: col.key, dir: "desc" },
                              )
                            }
                          >
                            {col.label}
                            {sort.key === col.key
                              ? sort.dir === "asc"
                                ? " ▲"
                                : " ▼"
                              : ""}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.run_id}>
                        <td>
                          <Link to={`/runs/${encodeURIComponent(row.run_id)}`}>
                            <code>{row.run_id}</code>
                          </Link>
                        </td>
                        <td>{row.case_slug}</td>
                        <td>
                          <code>{row.plugin_ref}</code>
                        </td>
                        <td>
                          <StatusPill status={row.status} />
                        </td>
                        <td className="score-num">
                          <strong>{row.guild_score.toFixed(2)}</strong>
                        </td>
                        <td className="muted">{row.started_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            );
          })()
        )
      ) : null}
    </section>
  );
}
