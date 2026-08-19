#!/usr/bin/env -S npx tsx
/**
 * Dedicated advisory-record example CLI.
 *
 * This entrypoint is intentionally separate from lib/advisory-record.ts.
 * Hooks import the library, and esbuild must never pull example output into a
 * production hook bundle merely because it needs the record contract.
 */

import { makeAdvisoryRecord } from "./lib/advisory-record";

const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const skeleton = makeAdvisoryRecord({
  id: "advisory-example-001",
  recorded_at: now,
  phase: "ideation",
  backend: "single_agent",
  question: "Which architecture path should this initiative take?",
  advisors: [
    { role: "product", model_tier: "cheap" },
    { role: "architecture", model_tier: "mid" },
  ],
  recommendations: [
    {
      role: "product",
      recommendation: "Prefer the simpler layered approach.",
      confidence: "medium",
    },
    {
      role: "architecture",
      recommendation: "Event-driven boundary fits better for scale.",
      confidence: "high",
    },
  ],
  synthesis:
    "Use event-driven boundaries at service edges; keep internal domain logic layered.",
  confidence: "high",
  unresolved_questions: [],
});

process.stdout.write(JSON.stringify(skeleton, null, 2) + "\n");
