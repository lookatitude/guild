import type { ReflectionApplied } from "../../../src/types";

interface Props {
  reflection: ReflectionApplied;
}

function shortRef(ref: string): string {
  return ref.length > 8 ? ref.slice(0, 7) : ref;
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}

export function ReflectionBadge({ reflection }: Props) {
  const {
    proposal_id,
    source_path,
    applied_at,
    plugin_ref_before,
    plugin_ref_after,
    kept,
    delta_summary,
  } = reflection;

  return (
    <section
      className="reflection-card"
      data-testid="reflection-badge"
      aria-label="Reflection applied"
    >
      <div className="reflection-header">
        <h3>Reflection applied</h3>
        <span
          className={kept ? "badge-kept" : "badge-discarded"}
          data-testid="keep-discard-badge"
          data-kept={kept}
        >
          {kept ? "kept" : "discarded"}
        </span>
      </div>
      <dl className="kv-grid">
        <dt>Proposal</dt>
        <dd>
          <code>{proposal_id}</code>
        </dd>
        <dt>Source</dt>
        <dd>
          <code>{source_path}</code>
        </dd>
        <dt>Applied</dt>
        <dd>{applied_at}</dd>
        <dt>Plugin</dt>
        <dd data-testid="plugin-ref-delta">
          <code>{shortRef(plugin_ref_before)}</code>{" "}
          <span aria-hidden="true">→</span>{" "}
          <code>{shortRef(plugin_ref_after)}</code>
        </dd>
      </dl>
      {!kept ? (
        <p className="reflection-discard-reason muted">
          Discarded — <code>{delta_summary.worst_component}</code> regressed by{" "}
          {delta_summary.worst_component_delta.toFixed(2)} pts (Δ guild_score{" "}
          {signed(delta_summary.guild_score_delta)}).
        </p>
      ) : null}
    </section>
  );
}
