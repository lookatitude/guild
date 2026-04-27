import type { RunDetailResponse } from "../../../src/types";
import { api } from "../lib/api";

interface Props {
  detail: RunDetailResponse;
}

interface ArtifactEntry {
  label: string;
  href: string;
  hint?: string;
}

// The detail response carries metrics + score + events but not a directory
// listing. We surface the deterministic set of artifacts the runner produces
// (per benchmark/plans/01-architecture.md §3) plus any acceptance-command
// artifacts we can name from metrics.acceptance_commands.
function buildArtifacts(detail: RunDetailResponse): ArtifactEntry[] {
  const runId = detail.run.run_id;
  const out: ArtifactEntry[] = [
    {
      label: "review.md",
      href: api.artifact(runId, ".guild/runs/" + runId + "/review.md"),
      hint: "two-stage review prose",
    },
    {
      label: "verify.md",
      href: api.artifact(runId, ".guild/runs/" + runId + "/verify.md"),
      hint: "acceptance verification log",
    },
    {
      label: "reflection.md",
      href: api.artifact(runId, ".guild/runs/" + runId + "/reflection.md"),
      hint: "post-run reflection",
    },
  ];
  return out;
}

export function ArtifactList({ detail }: Props) {
  const items = buildArtifacts(detail);
  return (
    <ul className="artifact-list" aria-label="Artifacts">
      {items.map((item) => (
        <li key={item.href}>
          <a href={item.href} target="_blank" rel="noreferrer">
            {item.label}
          </a>
          {item.hint ? <span className="muted"> — {item.hint}</span> : null}
        </li>
      ))}
      {detail.metrics.acceptance_commands.length > 0 ? (
        <li>
          <strong>Acceptance commands</strong>
          <ul className="artifact-list">
            {detail.metrics.acceptance_commands.map((ac, idx) => (
              <li key={`${ac.command}-${idx}`}>
                <code>{ac.command}</code>{" "}
                <span className="muted">
                  — {ac.passed ? "passed" : "failed"}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ) : null}
    </ul>
  );
}
