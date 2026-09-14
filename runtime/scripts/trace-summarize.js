#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/trace-summarize.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));

// scripts/lib/run-events.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var CANONICAL_EVENTS_RELPATH = path.join("logs", "v1.4-events.jsonl");
var LEGACY_EVENTS_RELPATH = "events.ndjson";
function resolveRunEventsFile(runDir) {
  const canonical = path.join(runDir, CANONICAL_EVENTS_RELPATH);
  const legacy = path.join(runDir, LEGACY_EVENTS_RELPATH);
  if (fs.existsSync(canonical)) return { filePath: canonical, source: "canonical" };
  if (fs.existsSync(legacy)) return { filePath: legacy, source: "legacy" };
  return { filePath: canonical, source: "none" };
}
function parseRunEventsJsonl(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return { events: [], parseErrors: 0 };
  }
  const events = [];
  let parseErrors = 0;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      parseErrors++;
    }
  }
  return { events, parseErrors };
}
function loadRunEvents(runDir) {
  const { filePath, source } = resolveRunEventsFile(runDir);
  if (source === "none") {
    return { events: [], source, filePath, parseErrors: 0 };
  }
  const { events, parseErrors } = parseRunEventsJsonl(filePath);
  return { events, source, filePath, parseErrors };
}
if (require.main === module) {
  const runDir = process.argv[2];
  if (!runDir) {
    process.stderr.write("Usage: npx tsx scripts/lib/run-events.ts <runDir>\n");
    process.exit(1);
  }
  const result = loadRunEvents(path.resolve(runDir));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.source === "none" ? 1 : 0);
}

// scripts/lib/run-sinks.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var BACKEND_DEGRADATION_SINK = "logs/backend-degradation.jsonl";
var TIER_DISPATCH_SINK = "logs/tier-dispatch.jsonl";
var BACKEND_DEGRADATION_SCHEMA = "guild.backend_degradation.v1";
var TIER_DISPATCH_SCHEMA = "guild.tier_dispatch.v1";
var UNTIERED_REASON = "missing_model";
function readSinkRaw(runDir, relPath, expectedSchema) {
  let content;
  try {
    content = fs2.readFileSync(path2.join(runDir, relPath), "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return { rows: [], anomalies: 0 };
    return { rows: [], anomalies: 1 };
  }
  const rows = [];
  let anomalies = 0;
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let v;
    try {
      v = JSON.parse(t);
    } catch {
      anomalies++;
      continue;
    }
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      anomalies++;
      continue;
    }
    if (expectedSchema !== void 0 && v.schema_version !== expectedSchema) {
      anomalies++;
      continue;
    }
    rows.push(v);
  }
  return { rows, anomalies };
}
function tally(values) {
  const m = /* @__PURE__ */ new Map();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return Array.from(m.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
function summarizeBackendDegradations(rows) {
  const receipts = rows.filter((r) => r.schema_version === BACKEND_DEGRADATION_SCHEMA);
  return {
    count: receipts.length,
    byReason: tally(receipts.map((r) => String(r.reason ?? "unknown"))).map((t) => ({
      reason: t.value,
      count: t.count
    })),
    byDecision: tally(receipts.map((r) => String(r.decision ?? "unknown"))).map((t) => ({
      decision: t.value,
      count: t.count
    })),
    receipts
  };
}
function summarizeTierDispatch(rows) {
  const receipts = rows.filter((r) => r.schema_version === TIER_DISPATCH_SCHEMA);
  const violations = receipts.filter((r) => String(r.decision) !== "pass");
  const untieredCount = receipts.filter((r) => String(r.reason) === UNTIERED_REASON).length;
  return {
    total: receipts.length,
    violationCount: violations.length,
    untieredCount,
    violations,
    byReason: tally(violations.map((r) => String(r.reason ?? "unknown"))).map((t) => ({
      reason: t.value,
      count: t.count
    })),
    byDecision: tally(violations.map((r) => String(r.decision ?? "unknown"))).map((t) => ({
      decision: t.value,
      count: t.count
    }))
  };
}
function loadRunSinks(runDir) {
  const deg = readSinkRaw(runDir, BACKEND_DEGRADATION_SINK, BACKEND_DEGRADATION_SCHEMA);
  const tier = readSinkRaw(runDir, TIER_DISPATCH_SINK, TIER_DISPATCH_SCHEMA);
  return {
    runDir,
    degradations: summarizeBackendDegradations(deg.rows),
    tier: summarizeTierDispatch(tier.rows),
    parseErrors: deg.anomalies + tier.anomalies
  };
}
function isRunSinkDirty(a) {
  return a.degradations.count > 0 || a.tier.violationCount > 0 || a.parseErrors > 0;
}
function sinkAuditFrontmatterLines(a) {
  return [
    `backend_degradations: ${a.degradations.count}`,
    `tier_violations: ${a.tier.violationCount}`,
    `untiered_dispatches: ${a.tier.untieredCount}`,
    `sink_parse_errors: ${a.parseErrors}`
  ];
}
function renderSinkAuditSection(a) {
  const { degradations: d, tier: t } = a;
  const body = [];
  if (!isRunSinkDirty(a)) {
    body.push(
      `Clean \u2014 no backend degradations, no tier-contract violations` + (t.total > 0 ? ` (${t.total} dispatch receipt(s), all compliant).` : ".")
    );
    return ["## Sink audit", "", body.join("\n")].join("\n");
  }
  if (d.count > 0) {
    body.push(`- **backend degradations: ${d.count}** \u2014 a lane ran on a downgraded backend.`);
    for (const r of d.byReason) body.push(`  - reason \`${r.reason}\`: ${r.count}`);
    for (const r of d.byDecision) body.push(`  - decision \`${r.decision}\`: ${r.count}`);
  }
  if (t.violationCount > 0) {
    body.push(
      `- **tier-contract violations: ${t.violationCount}** of ${t.total} dispatch receipt(s) \u2014 ${t.untieredCount} un-tiered (\`${UNTIERED_REASON}\`).`
    );
    for (const r of t.byReason) body.push(`  - reason \`${r.reason}\`: ${r.count}`);
    for (const r of t.byDecision) body.push(`  - decision \`${r.decision}\`: ${r.count}`);
  }
  if (a.parseErrors > 0) {
    body.push(
      `- **unverifiable sink records: ${a.parseErrors}** \u2014 treated as DIRTY (fail-closed): a corrupt/truncated line, a wrong-schema record, or an unreadable sink may hide a real degradation or tier violation. Inspect the raw jsonl.`
    );
  }
  return ["## Sink audit", "", body.join("\n")].join("\n");
}
function sinkAuditReflectionHint(a) {
  if (!isRunSinkDirty(a)) return null;
  const parts = [];
  if (a.degradations.count > 0) parts.push(`${a.degradations.count} backend degradation(s)`);
  if (a.tier.violationCount > 0)
    parts.push(
      `${a.tier.violationCount} tier-contract violation(s) (${a.tier.untieredCount} un-tiered)`
    );
  if (a.parseErrors > 0) parts.push(`${a.parseErrors} unverifiable sink record(s)`);
  return `- dispatch-integrity: ${parts.join(", ")} \u2014 see the Sink audit section; a downgraded/un-tiered run must not close clean.`;
}

// scripts/trace-summarize.ts
function normalizeEvent(raw) {
  const e = { ...raw };
  if (e.ok === void 0 && typeof e.status === "string") {
    if (e.status === "ok") e.ok = true;
    else if (e.status === "err" || e.status === "error") e.ok = false;
  }
  if (e.ms === void 0) {
    if (typeof e.latency_ms === "number" && e.latency_ms >= 0) e.ms = e.latency_ms;
    else if (typeof e.duration_ms === "number" && e.duration_ms >= 0) e.ms = e.duration_ms;
  }
  if (e.tool === void 0 && e.event === "hook_event" && typeof e.hook_name === "string") {
    e.tool = e.hook_name;
  }
  return e;
}
function isErrorEvent(e) {
  return e.ok === false;
}
function isSuccessEvent(e) {
  return e.ok === true;
}
function durationLabel(ms) {
  return typeof ms === "number" ? `${ms}ms` : "n/a";
}
function errorLabel(e) {
  return isErrorEvent(e) ? " \u26A0 ERROR" : "";
}
var MATCH_WINDOW_MS = 50;
function maxCardinalityMinCostMatch(sortedPosts, sortedCalls, tsOf, windowMs) {
  const n = sortedPosts.length;
  const m = sortedCalls.length;
  const count = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const betterThan = (aCount, aCost, bCount, bCost) => aCount > bCount || aCount === bCount && aCost < bCost;
  for (let i2 = 1; i2 <= n; i2++) {
    for (let j2 = 1; j2 <= m; j2++) {
      let bestCount = count[i2 - 1][j2];
      let bestCost = cost[i2 - 1][j2];
      if (betterThan(count[i2][j2 - 1], cost[i2][j2 - 1], bestCount, bestCost)) {
        bestCount = count[i2][j2 - 1];
        bestCost = cost[i2][j2 - 1];
      }
      const diff = Math.abs(tsOf(sortedPosts[i2 - 1]) - tsOf(sortedCalls[j2 - 1]));
      if (diff <= windowMs) {
        const matchCount = count[i2 - 1][j2 - 1] + 1;
        const matchCost = cost[i2 - 1][j2 - 1] + diff;
        if (betterThan(matchCount, matchCost, bestCount, bestCost)) {
          bestCount = matchCount;
          bestCost = matchCost;
        }
      }
      count[i2][j2] = bestCount;
      cost[i2][j2] = bestCost;
    }
  }
  const matches = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const diff = Math.abs(tsOf(sortedPosts[i - 1]) - tsOf(sortedCalls[j - 1]));
    if (diff <= windowMs && count[i - 1][j - 1] + 1 === count[i][j] && cost[i - 1][j - 1] + diff === cost[i][j]) {
      matches.push([sortedPosts[i - 1], sortedCalls[j - 1]]);
      i--;
      j--;
    } else if (count[i - 1][j] === count[i][j] && cost[i - 1][j] === cost[i][j]) {
      i--;
    } else {
      j--;
    }
  }
  return matches;
}
function reconcileToolCallEvents(events) {
  const posts = events.filter((e) => e.event === "PostToolUse");
  const calls = events.filter((e) => e.event === "tool_call");
  if (posts.length === 0 || calls.length === 0) {
    return posts.length > 0 ? posts : calls;
  }
  const byTool = /* @__PURE__ */ new Map();
  const bucket = (tool) => {
    const key = typeof tool === "string" ? tool : "";
    if (!byTool.has(key)) byTool.set(key, { posts: [], calls: [] });
    return byTool.get(key);
  };
  for (const e of posts) bucket(e.tool).posts.push(e);
  for (const e of calls) bucket(e.tool).calls.push(e);
  const tsOf = (e) => typeof e.ts === "string" ? Date.parse(e.ts) : Number.NaN;
  const byTs = (a, b) => tsOf(a) - tsOf(b);
  const reconciled = [];
  for (const { posts: toolPosts, calls: toolCalls } of byTool.values()) {
    const sortedPosts = [...toolPosts].sort(byTs);
    const sortedCalls = [...toolCalls].sort(byTs);
    const matches = maxCardinalityMinCostMatch(sortedPosts, sortedCalls, tsOf, MATCH_WINDOW_MS);
    const matchedPosts = new Set(matches.map(([post]) => post));
    const matchedCalls = new Set(matches.map(([, call]) => call));
    for (const [, call] of matches) reconciled.push(call);
    for (const post of sortedPosts) {
      if (!matchedPosts.has(post)) reconciled.push(post);
    }
    for (const call of sortedCalls) {
      if (!matchedCalls.has(call)) reconciled.push(call);
    }
  }
  return reconciled;
}
function isDispatchEvent(e) {
  return e.schema_version === "guild.trace.dispatch.v1";
}
function isConfirmedDispatch(e) {
  if (!isDispatchEvent(e)) return false;
  if (typeof e.pane_backend === "string" && e.pane_backend !== "") return true;
  return typeof e.backend === "string" && e.backend !== "" && e.backend !== "unknown";
}
function dispatchSurface(e) {
  if (typeof e.pane_backend === "string" && e.pane_backend) return e.pane_backend;
  return e.backend;
}
function parseArgs(argv) {
  let runId = null;
  let cwd = ".";
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run-id" && i + 1 < argv.length) {
      runId = argv[++i];
    } else if (argv[i] === "--cwd" && i + 1 < argv.length) {
      cwd = argv[++i];
    } else if (argv[i] === "--out" && i + 1 < argv.length) {
      out = argv[++i];
    }
  }
  return { runId, cwd, out };
}
function computeStats(runId, events) {
  if (events.length === 0) {
    return {
      runId,
      startedAt: "",
      endedAt: "",
      durationMs: 0,
      eventCount: 0,
      specialists: [],
      toolCounts: [],
      dispatchCounts: [],
      dispatchReceiptCounts: [],
      filesTouchedCount: 0,
      errors: 0,
      okRate: 1
    };
  }
  const eventTs = (e) => e.ts ?? e.at ?? "";
  const startedAt = eventTs(events[0]);
  const endedAt = eventTs(events[events.length - 1]);
  const durationMs = startedAt && endedAt ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : 0;
  const specialists = Array.from(
    new Set(events.map((e) => e.specialist).filter(Boolean))
  ).sort();
  const toolMap = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (!event.tool) continue;
    toolMap.set(event.tool, (toolMap.get(event.tool) ?? 0) + 1);
  }
  const toolCounts = Array.from(toolMap.entries()).map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));
  const dispatchLanes = /* @__PURE__ */ new Map();
  const receiptMap = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (!isConfirmedDispatch(event)) continue;
    const surface = dispatchSurface(event);
    receiptMap.set(surface, (receiptMap.get(surface) ?? 0) + 1);
    const lane = typeof event.task_id === "string" && event.task_id || typeof event.specialist === "string" && event.specialist || "";
    if (!lane) continue;
    if (!dispatchLanes.has(surface)) dispatchLanes.set(surface, /* @__PURE__ */ new Set());
    dispatchLanes.get(surface).add(lane);
  }
  const bySurface = (a, b) => b.count - a.count || a.backend.localeCompare(b.backend);
  const dispatchCounts = Array.from(dispatchLanes.entries()).map(([backend, lanes]) => ({ backend, count: lanes.size })).sort(bySurface);
  const dispatchReceiptCounts = Array.from(receiptMap.entries()).map(([backend, count]) => ({ backend, count })).sort(bySurface);
  const filesTouchedCount = events.filter(
    (e) => e.tool === "Write" || e.tool === "Edit"
  ).length;
  const errors = events.filter(isErrorEvent).length;
  const verdictBearing = events.filter((e) => isErrorEvent(e) || isSuccessEvent(e)).length;
  const okRate = verdictBearing > 0 ? (verdictBearing - errors) / verdictBearing : 1;
  return {
    runId,
    startedAt,
    endedAt,
    durationMs,
    eventCount: events.length,
    specialists,
    toolCounts,
    dispatchCounts,
    dispatchReceiptCounts,
    filesTouchedCount,
    errors,
    okRate: Math.round(okRate * 1e3) / 1e3
  };
}
function buildFrontmatter(stats, sinkAudit) {
  const toolsLine = stats.toolCounts.length > 0 ? stats.toolCounts.map(({ tool, count }) => `${tool}: ${count}`).join(", ") : "(none)";
  const specialistsLine = stats.specialists.length > 0 ? stats.specialists.join(", ") : "(none)";
  const surfaceLine = (rows) => rows.length > 0 ? rows.map(({ backend, count }) => `${backend}: ${count}`).join(", ") : "(none)";
  const dispatchedLanesLine = surfaceLine(stats.dispatchCounts);
  const dispatchReceiptsLine = surfaceLine(stats.dispatchReceiptCounts);
  const sinkLines = sinkAudit ? sinkAuditFrontmatterLines(sinkAudit) : [];
  return [
    "---",
    `run_id: ${stats.runId}`,
    `started_at: ${stats.startedAt || "(none)"}`,
    `ended_at: ${stats.endedAt || "(none)"}`,
    `duration_ms: ${stats.durationMs}`,
    `event_count: ${stats.eventCount}`,
    `specialists_dispatched: [${specialistsLine}]`,
    `dispatched_lanes: [${dispatchedLanesLine}]`,
    `dispatch_receipts: [${dispatchReceiptsLine}]`,
    `tools_used: [${toolsLine}]`,
    `files_touched_count: ${stats.filesTouchedCount}`,
    `errors: ${stats.errors}`,
    `ok_rate: ${stats.okRate}`,
    ...sinkLines,
    "---"
  ].join("\n");
}
function buildTimeline(events) {
  if (events.length === 0) return "No events recorded.";
  const lines = [];
  for (const event of events) {
    const ts = event.ts;
    if (event.event === "SubagentStop") {
      const spec = event.specialist || "(main session)";
      lines.push(`- \`${ts}\` \u2014 specialist **${spec}** completed (${durationLabel(event.ms)})`);
    } else if (event.tool === "Write" || event.tool === "Edit") {
      const spec = event.specialist ? ` [${event.specialist}]` : "";
      lines.push(`- \`${ts}\` \u2014 ${event.tool}${spec}${errorLabel(event)} (${durationLabel(event.ms)})`);
    } else if (event.tool) {
      const spec = event.specialist ? ` [${event.specialist}]` : "";
      lines.push(`- \`${ts}\` \u2014 ${event.tool}${spec}${errorLabel(event)} (${durationLabel(event.ms)})`);
    }
  }
  return lines.join("\n");
}
function buildSpecialistActivity(events) {
  if (events.length === 0) return "No specialist activity recorded.";
  const specialistMap = /* @__PURE__ */ new Map();
  const toolCallEvents = new Set(reconcileToolCallEvents(events));
  for (const event of events) {
    const key = event.specialist || "(main session)";
    if (!specialistMap.has(key)) {
      specialistMap.set(key, { toolCalls: 0, fileOps: 0, errors: 0, ok: 0 });
    }
    const s = specialistMap.get(key);
    if (toolCallEvents.has(event) && event.tool) {
      s.toolCalls++;
      if (event.tool === "Write" || event.tool === "Edit") s.fileOps++;
    }
    if (isErrorEvent(event)) s.errors++;
    else if (isSuccessEvent(event)) s.ok++;
  }
  const keys = Array.from(specialistMap.keys()).sort((a, b) => {
    if (a === "(main session)") return 1;
    if (b === "(main session)") return -1;
    return a.localeCompare(b);
  });
  const lines = [];
  for (const key of keys) {
    const s = specialistMap.get(key);
    lines.push(`### ${key}`);
    lines.push(`- Tool calls: ${s.toolCalls}`);
    lines.push(`- Files touched (Write/Edit): ${s.fileOps}`);
    lines.push(`- OK: ${s.ok}, Errors: ${s.errors}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
function errorDigest(e) {
  const digest = e.payload_digest ?? e.result_excerpt_redacted ?? e.payload_excerpt_redacted;
  if (typeof digest !== "string") return "";
  const collapsed = digest.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? ` \u2014 digest: ${collapsed}` : "";
}
function buildNotableEvents(events) {
  const notable = [];
  const errorEvents = events.filter(isErrorEvent);
  for (const e of errorEvents) {
    notable.push(
      `- ERROR at \`${e.ts}\`: tool **${e.tool || "(none)"}** by ${e.specialist || "(main session)"}${errorDigest(e)}`
    );
  }
  const toolCallEvents = new Set(reconcileToolCallEvents(events));
  const longCalls = events.filter(
    (e) => toolCallEvents.has(e) && typeof e.ms === "number" && e.ms > 2e3
  );
  for (const e of longCalls) {
    notable.push(
      `- SLOW at \`${e.ts}\`: tool **${e.tool}** by ${e.specialist || "(main session)"} took ${e.ms}ms`
    );
  }
  return notable.length > 0 ? notable.join("\n") : "No notable events.";
}
function buildReflectionHints(stats, events, sinkAudit) {
  const hints = [];
  const sinkHint = sinkAudit ? sinkAuditReflectionHint(sinkAudit) : null;
  if (sinkHint) hints.push(sinkHint);
  const specialistsWithErrors = Array.from(
    new Set(events.filter((e) => isErrorEvent(e) && e.specialist).map((e) => e.specialist))
  ).sort();
  if (specialistsWithErrors.length > 0) {
    hints.push(
      `- skill-improvement candidates: ${specialistsWithErrors.join(", ")} had errors \u2014 review tool-call patterns`
    );
  }
  const toolCallEvents = new Set(reconcileToolCallEvents(events));
  const mainSessionToolCalls = events.filter(
    (e) => toolCallEvents.has(e) && !e.specialist && e.tool
  );
  if (mainSessionToolCalls.length > 0) {
    hints.push(
      `- missing-specialist candidates: ${mainSessionToolCalls.length} tool call(s) ran in main session \u2014 consider routing to a specialist`
    );
  }
  const verySlowCalls = events.filter(
    (e) => toolCallEvents.has(e) && typeof e.ms === "number" && e.ms > 5e3
  );
  if (verySlowCalls.length > 0) {
    hints.push(
      `- context-bundle issues: ${verySlowCalls.length} tool call(s) exceeded 5000ms \u2014 possible large context or slow tool`
    );
  }
  if (stats.okRate < 1) {
    hints.push(
      `- ok_rate ${stats.okRate} \u2014 ${stats.errors} error(s) in ${stats.eventCount} event(s); review error events above`
    );
  }
  if (hints.length === 0) {
    hints.push("- No actionable hints detected.");
  }
  return hints.join("\n");
}
function buildSummary(runId, events, sinkAudit) {
  const stats = computeStats(runId, events);
  const sections = [
    buildFrontmatter(stats, sinkAudit),
    "",
    `# Run ${runId} summary`,
    "",
    "## Timeline",
    "",
    buildTimeline(events),
    "",
    "## Specialist activity",
    "",
    buildSpecialistActivity(events),
    "",
    "## Notable events",
    "",
    buildNotableEvents(events),
    "",
    // rf-wi-02: the dispatch-integrity sink consumers. reflect reads summary.md,
    // so surfacing degradations + un-tiered dispatches here wires the sinks into
    // the reflection path without reflect re-reading the raw jsonl.
    ...sinkAudit ? [renderSinkAuditSection(sinkAudit), ""] : [],
    "## Reflection hints",
    "",
    buildReflectionHints(stats, events, sinkAudit),
    ""
  ];
  return sections.join("\n");
}
function main() {
  const args = process.argv.slice(2);
  const { runId, cwd: cwdArg, out: outArg } = parseArgs(args);
  if (!runId) {
    process.stderr.write("[trace-summarize] ERROR: --run-id <id> is required\n");
    process.exit(1);
  }
  const cwd = path3.resolve(cwdArg);
  const runDir = path3.join(cwd, ".guild", "runs", runId);
  const defaultOut = path3.join(runDir, "summary.md");
  const outFile = outArg ? path3.resolve(outArg) : defaultOut;
  const { events, source, filePath, parseErrors } = loadRunEvents(runDir);
  if (source === "none") {
    process.stderr.write(
      `[trace-summarize] ERROR: no event log found for run ${runId} (looked for ${filePath} and ${path3.join(runDir, "events.ndjson")})
`
    );
    process.exit(1);
  }
  if (parseErrors > 0) {
    process.stderr.write(
      `[trace-summarize] WARN: ${parseErrors} line(s) failed to parse and were skipped
`
    );
  }
  const sinkAudit = loadRunSinks(runDir);
  const summary = buildSummary(runId, events.map(normalizeEvent), sinkAudit);
  const outDir = path3.dirname(outFile);
  fs3.mkdirSync(outDir, { recursive: true });
  fs3.writeFileSync(outFile, summary, "utf8");
  process.stderr.write(
    `[trace-summarize] wrote summary for run ${runId} \u2192 ${outFile}
`
  );
  process.exit(0);
}
main();
