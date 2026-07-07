/**
 * scripts/__tests__/artifact-bus.test.ts
 *
 * The generalized artifact bus (v2-review-broker-and-artifact-bus.md §Group 1,
 * D-BUS-1..3): bus_event.v1 publish/read, cas_meta.v1 content addressing, and
 * bus_subscriber.v1 registration + topic-glob fan-out.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  BUS_EVENT_SCHEMA,
  CAS_META_SCHEMA,
  BUS_SUBSCRIBER_SCHEMA,
  busLogPath,
  casGet,
  casMetaPath,
  casPut,
  casVerify,
  fanout,
  isValidTopic,
  matchTopic,
  processFanout,
  publish,
  readBusLog,
  readSubscribers,
  refCount,
  registerSubscriber,
  sha256,
  tailBusLog,
  topicType,
  validateBusEventV1,
  validateBusSubscriberV1,
  validateCasMetaV1,
} from "../lib/artifact-bus";

const NOW = () => "2026-06-27T00:00:00.000Z";
const PUB = { host_id: "claude-local", role: "backend" };

function tmpRunDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-bus-"));
  return path.join(d, ".guild", "runs", "run-x");
}

describe("topic helpers", () => {
  it("isValidTopic requires a known type + 3 non-empty segments", () => {
    expect(isValidTopic("handoff/backend/T2")).toBe(true);
    expect(isValidTopic("review/G-plan/pkt-7")).toBe(true);
    expect(isValidTopic("bogus/backend/T2")).toBe(false); // unknown type
    expect(isValidTopic("handoff/backend")).toBe(false); // too few segments
    expect(isValidTopic("handoff//T2")).toBe(false); // empty segment
  });
  it("topicType returns the first segment when known", () => {
    expect(topicType("status/qa/T3")).toBe("status");
    expect(topicType("nope/x/y")).toBeNull();
  });
  it("matchTopic does segment wildcards + trailing **", () => {
    expect(matchTopic("handoff/backend/*", "handoff/backend/T2")).toBe(true);
    expect(matchTopic("handoff/*/T2", "handoff/backend/T2")).toBe(true);
    expect(matchTopic("handoff/backend/*", "handoff/qa/T2")).toBe(false);
    expect(matchTopic("handoff/**", "handoff/backend/T2")).toBe(true);
    expect(matchTopic("review/**", "handoff/backend/T2")).toBe(false);
    expect(matchTopic("handoff/backend/T2", "handoff/backend/T2")).toBe(true);
    expect(matchTopic("handoff/backend", "handoff/backend/T2")).toBe(false); // length mismatch
  });
});

describe("CAS — cas_meta.v1 (D-BUS-3)", () => {
  it("casPut writes content-addressed meta at bus/cas/<aa>/<sha>.meta.yaml", () => {
    const runDir = tmpRunDir();
    const content = "the handoff body";
    const hash = casPut(runDir, content, { type: "handoff", topic: "handoff/backend/T2", runId: "run-x", writer: PUB, path: ".guild/runs/run-x/handoffs/backend-T2.md", now: NOW });
    expect(hash).toBe(sha256(content));
    expect(fs.existsSync(casMetaPath(runDir, hash))).toBe(true);
    const meta = casGet(runDir, hash)!;
    expect(meta.schema_version).toBe(CAS_META_SCHEMA);
    expect(meta.sha256).toBe(hash);
    expect(meta.type).toBe("handoff");
    expect(meta.ref_count).toBe(1);
  });

  it("casPut is idempotent (skip-if-present, race-free) — one CAS entry per content", () => {
    const runDir = tmpRunDir();
    const c = "dup body";
    const h1 = casPut(runDir, c, { type: "context", topic: "context/architect/T1", runId: "run-x", writer: PUB, path: null, now: NOW });
    const h2 = casPut(runDir, c, { type: "context", topic: "context/architect/T1", runId: "run-x", writer: PUB, path: null, now: NOW });
    expect(h1).toBe(h2);
    // The stored entry is never mutated on a repeat (no read-modify-write race).
    expect(casGet(runDir, h1)!.ref_count).toBe(1);
  });

  it("refCount derives from non-retracted bus events citing the sha (GC hint, drift-free)", () => {
    const runDir = tmpRunDir();
    const body = "shared bundle";
    // Two lanes publish the identical bundle → one CAS entry, two bus refs.
    const a = publish(runDir, { runId: "run-x", topic: "context/architect/T1", content: body, publisher: PUB, now: NOW })!;
    publish(runDir, { runId: "run-x", topic: "context/backend/T2", content: body, publisher: PUB, now: NOW });
    expect(refCount(runDir, a.sha256!)).toBe(2);
  });

  it("casVerify detects a hash/content match and rejects tampering", () => {
    const runDir = tmpRunDir();
    const h = casPut(runDir, "real", { type: "status", topic: "status/qa/T3", runId: "run-x", writer: PUB, path: null, now: NOW });
    expect(casVerify(runDir, h, "real")).toBe(true);
    expect(casVerify(runDir, h, "tampered")).toBe(false);
  });
});

describe("publish / read — bus_event.v1 (D-BUS-1)", () => {
  it("publish appends an event, CAS-indexes the body, and assigns monotonic seq", () => {
    const runDir = tmpRunDir();
    const e0 = publish(runDir, { runId: "run-x", topic: "handoff/backend/T2", content: "body0", artifactPath: ".guild/runs/run-x/handoffs/backend-T2.md", publisher: PUB, now: NOW })!;
    const e1 = publish(runDir, { runId: "run-x", topic: "status/qa/T3", content: "body1", publisher: PUB, now: NOW })!;
    expect(e0.schema_version).toBe(BUS_EVENT_SCHEMA);
    expect(e0.seq).toBe(0);
    expect(e1.seq).toBe(1);
    expect(e0.sha256).toBe(sha256("body0"));
    expect(e0.event).toBe("artifact.published");
    expect(fs.existsSync(busLogPath(runDir))).toBe(true);
    expect(casGet(runDir, e0.sha256!)).not.toBeNull();
  });

  it("readBusLog round-trips and tailBusLog returns events after a seq", () => {
    const runDir = tmpRunDir();
    publish(runDir, { runId: "run-x", topic: "handoff/backend/T1", content: "a", publisher: PUB, now: NOW });
    publish(runDir, { runId: "run-x", topic: "handoff/backend/T2", content: "b", publisher: PUB, now: NOW });
    publish(runDir, { runId: "run-x", topic: "handoff/backend/T3", content: "c", publisher: PUB, now: NOW });
    expect(readBusLog(runDir).map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(tailBusLog(runDir, 0).map((e) => e.seq)).toEqual([1, 2]);
  });

  it("publish rejects an invalid topic (fail-closed, writes nothing)", () => {
    const runDir = tmpRunDir();
    expect(publish(runDir, { runId: "run-x", topic: "bogus/x/y", content: "z", publisher: PUB, now: NOW })).toBeNull();
    expect(fs.existsSync(busLogPath(runDir))).toBe(false);
  });

  it("publish rejects an unknown event kind (fail-closed, writes nothing)", () => {
    const runDir = tmpRunDir();
    expect(publish(runDir, { runId: "run-x", topic: "handoff/backend/T2", event: "exploded" as never, content: "z", publisher: PUB, now: NOW })).toBeNull();
    expect(fs.existsSync(busLogPath(runDir))).toBe(false);
  });

  it("a retraction carries no CAS body", () => {
    const runDir = tmpRunDir();
    const e = publish(runDir, { runId: "run-x", topic: "handoff/backend/T2", event: "artifact.retracted", publisher: PUB, now: NOW })!;
    expect(e.event).toBe("artifact.retracted");
    expect(e.sha256).toBeNull();
  });
});

describe("subscribers + fan-out — bus_subscriber.v1 (D-BUS-2)", () => {
  it("registerSubscriber writes the registry yaml; readSubscribers returns it", () => {
    const runDir = tmpRunDir();
    const s = registerSubscriber(runDir, { subscriber_id: "orchestrator-T3-gate", host_id: "claude-local", topics: ["handoff/backend/*", "handoff/qa/*"], callback: "hook", now: NOW })!;
    expect(s.schema_version).toBe(BUS_SUBSCRIBER_SCHEMA);
    expect(readSubscribers(runDir).map((x) => x.subscriber_id)).toEqual(["orchestrator-T3-gate"]);
  });

  it("fanout matches by topic glob and partitions by callback kind", () => {
    const runDir = tmpRunDir();
    registerSubscriber(runDir, { subscriber_id: "hook-sub", host_id: "h", topics: ["handoff/backend/*"], callback: "hook", now: NOW });
    registerSubscriber(runDir, { subscriber_id: "poll-sub", host_id: "h", topics: ["handoff/**"], callback: "poll", now: NOW });
    registerSubscriber(runDir, { subscriber_id: "wh-sub", host_id: "h", topics: ["status/**"], callback: "webhook-url", now: NOW });
    const ev = publish(runDir, { runId: "run-x", topic: "handoff/backend/T2", content: "b", publisher: PUB, now: NOW })!;
    const out = fanout(runDir, ev);
    expect(out.hook.map((s) => s.subscriber_id)).toEqual(["hook-sub"]);
    expect(out.poll.map((s) => s.subscriber_id)).toEqual(["poll-sub"]);
    expect(out.webhook).toEqual([]); // status/** does not match a handoff topic
  });

  it("processFanout delivers to hook subscribers, defers webhooks, advances its cursor", () => {
    const runDir = tmpRunDir();
    registerSubscriber(runDir, { subscriber_id: "hook-sub", host_id: "h", topics: ["handoff/**"], callback: "hook", now: NOW });
    registerSubscriber(runDir, { subscriber_id: "wh-sub", host_id: "h", topics: ["handoff/**"], callback: "webhook-url", now: NOW });
    publish(runDir, { runId: "run-x", topic: "handoff/backend/T2", content: "b", publisher: PUB, now: NOW });

    const r1 = processFanout(runDir, NOW);
    expect(r1).toEqual({ processed: 1, delivered: 1, deferred: 1 });
    const fanoutLog = fs.readFileSync(path.join(runDir, "bus", "fanout.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(fanoutLog.find((x) => x.subscriber_id === "hook-sub").status).toBe("delivered");
    expect(fanoutLog.find((x) => x.subscriber_id === "wh-sub").status).toBe("deferred");

    // Cursor advanced: a second pass with no new events processes nothing (no double-delivery).
    expect(processFanout(runDir, NOW)).toEqual({ processed: 0, delivered: 0, deferred: 0 });
  });
});

describe("validators — fail-closed", () => {
  const validEvent = { schema_version: BUS_EVENT_SCHEMA, seq: 0, topic: "handoff/backend/T2", event: "artifact.published", artifact_id: "x", sha256: null, path: null, byte_offset: null, publisher: PUB, ts: "t" };
  it("bus_event: rejects bad schema / negative seq / bad topic / bad event", () => {
    expect(validateBusEventV1(validEvent)).not.toBeNull();
    expect(validateBusEventV1({ ...validEvent, schema_version: "x" })).toBeNull();
    expect(validateBusEventV1({ ...validEvent, seq: -1 })).toBeNull();
    expect(validateBusEventV1({ ...validEvent, topic: "bad/x" })).toBeNull();
    expect(validateBusEventV1({ ...validEvent, event: "exploded" })).toBeNull();
    expect(validateBusEventV1(null)).toBeNull();
  });
  it("cas_meta: rejects a non-64-hex sha + unknown type", () => {
    const v = { schema_version: CAS_META_SCHEMA, sha256: "a".repeat(64), type: "handoff", topic: "handoff/backend/T2", run_id: "r", writer: PUB, path: null, created_at: "t", ref_count: 1 };
    expect(validateCasMetaV1(v)).not.toBeNull();
    expect(validateCasMetaV1({ ...v, sha256: "tooshort" })).toBeNull();
    expect(validateCasMetaV1({ ...v, type: "bogus" })).toBeNull();
  });
  it("bus_subscriber: rejects empty topics + bad callback + unsafe id", () => {
    const v = { schema_version: BUS_SUBSCRIBER_SCHEMA, subscriber_id: "s1", host_id: "h", topics: ["handoff/**"], callback: "hook", created_at: "t" };
    expect(validateBusSubscriberV1(v)).not.toBeNull();
    expect(validateBusSubscriberV1({ ...v, topics: [] })).toBeNull();
    expect(validateBusSubscriberV1({ ...v, callback: "carrier-pigeon" })).toBeNull();
    expect(validateBusSubscriberV1({ ...v, subscriber_id: "a/b" })).toBeNull();
  });
});
