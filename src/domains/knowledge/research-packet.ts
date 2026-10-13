/**
 * research-packet.ts — `guild.research_packet.v1` (KTD49 / R31 / R51 / R59).
 *
 * Research is a MISS PATH, not a phase of its own. Recall runs first; when it
 * misses, the research class does the digging and leaves ONE durable artifact
 * behind: a packet on the run. What it deliberately does not leave behind is the
 * dig itself.
 *
 * That split is the whole design, and it has three homes:
 *
 *   - WORKING FILES → `GuildStorage.temporary(run_id)`. OS temp, deleted by
 *     `closeRun`, reclaimed by the 24h janitor if a process died first. Scratch is
 *     not durable knowledge and never becomes it by sitting somewhere durable long
 *     enough.
 *   - THE PACKET → the run record. Questions, evidence POINTERS, conclusions,
 *     confidence, stale risk, and the experiment oracle. It survives the run
 *     because it is what a later reader needs; the raw dump does not, because
 *     re-reading a dump is not cheaper than re-doing the search.
 *   - EVIDENCE THAT MUST OUTLIVE THE RUN → `definition("sources", <id>)`, cited
 *     from the packet by `source_ref`. Explicitly NOT the retired raw-sources tree
 *     (R59): promoting one of those blobs into a citing knowledge page stays human.
 *
 * The packet is not a knowledge page and does not become one automatically. A
 * DISTILLED decision drawn from it may auto-promote through harvest; the packet
 * body stays on the run.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { createGuildStorage, type GuildStorage } from "../state";

export const RESEARCH_PACKET_SCHEMA = "guild.research_packet.v1" as const;

/** Contract caps. Over-long lists are TRIMMED, never silently accepted. */
export const MAX_QUESTIONS = 12;
export const MAX_CONCLUSIONS = 8;

export interface ResearchEvidence {
  uri_or_path: string;
  gist: string;
  /** A `definition("sources", <id>)` id when the blob was made durable. */
  source_ref?: string;
}

export interface ResearchPacket {
  schema_version: typeof RESEARCH_PACKET_SCHEMA;
  run_id: string;
  packet_id: string;
  questions: string[];
  evidence: ResearchEvidence[];
  conclusions: string[];
  confidence: number;
  stale_risk: "low" | "medium" | "high";
  experiment_oracle: "pass" | "fail" | "n/a";
  /** `GuildStorage.temporary()`; deleted on close. */
  working_dir?: string;
}

export interface PacketOptions {
  cwd?: string;
  storage?: GuildStorage;
}

function storageFor(opts: PacketOptions): GuildStorage {
  return opts.storage ?? createGuildStorage(opts.cwd ?? process.cwd());
}

export function researchPacketPath(storage: GuildStorage, runId: string, packetId: string): string {
  const scope = storage.project ?? storage.workspace;
  if (!scope) throw new Error("this root owns no run record tree");
  return scope.runRecord(runId, "research", `${packetId}.json`);
}

/** The OS-temp working dir for one research run. Gone after `closeRun`. */
export function researchScratchDir(storage: GuildStorage, runId: string): string {
  return storage.ensureDir(storage.temporary(runId, "research"));
}

export interface WritePacketInput {
  run_id: string;
  packet_id: string;
  questions?: readonly string[];
  evidence?: readonly ResearchEvidence[];
  conclusions?: readonly string[];
  confidence?: number;
  stale_risk?: ResearchPacket["stale_risk"];
  experiment_oracle?: ResearchPacket["experiment_oracle"];
  /** Record the scratch dir on the packet. It will not exist after `closeRun`. */
  working_dir?: string;
}

function clamp01(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.min(1, Math.max(0, v));
}

export function buildResearchPacket(input: WritePacketInput): ResearchPacket {
  const packet: ResearchPacket = {
    schema_version: RESEARCH_PACKET_SCHEMA,
    run_id: input.run_id,
    packet_id: input.packet_id,
    questions: [...(input.questions ?? [])].slice(0, MAX_QUESTIONS),
    evidence: [...(input.evidence ?? [])],
    conclusions: [...(input.conclusions ?? [])].slice(0, MAX_CONCLUSIONS),
    confidence: clamp01(input.confidence),
    stale_risk: input.stale_risk ?? "medium",
    experiment_oracle: input.experiment_oracle ?? "n/a",
  };
  if (input.working_dir) packet.working_dir = input.working_dir;
  return packet;
}

/** Write the packet to the run record. */
export function writeResearchPacket(
  input: WritePacketInput,
  opts: PacketOptions = {},
): { packet: ResearchPacket; path: string } {
  const storage = storageFor(opts);
  const packet = buildResearchPacket(input);
  const p = researchPacketPath(storage, input.run_id, input.packet_id);
  storage.ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(packet, null, 2) + "\n", "utf8");
  return { packet, path: p };
}

export function readResearchPacket(
  runId: string,
  packetId: string,
  opts: PacketOptions = {},
): ResearchPacket | null {
  const storage = storageFor(opts);
  try {
    const p = researchPacketPath(storage, runId, packetId);
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as ResearchPacket;
    return parsed && parsed.schema_version === RESEARCH_PACKET_SCHEMA ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Make one piece of evidence durable under `definition("sources", <id>)`.
 *
 * Returns the `source_ref` the packet cites. The blob is durable; the knowledge
 * page that would cite it is not written here — that ingest stays human (R59).
 */
export function storeResearchSource(
  sourceId: string,
  content: string,
  opts: PacketOptions = {},
): { source_ref: string; path: string } {
  const storage = storageFor(opts);
  const p = storage.definition("sources", sourceId);
  storage.ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, "utf8");
  return { source_ref: `source:${sourceId}`, path: p };
}
