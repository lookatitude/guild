#!/usr/bin/env -S npx tsx
/**
 * scripts/write-run-manifest.ts
 *
 * RE-6 — multi-wave program run-manifest writer.
 *
 * Contract (BY POINTER): ADR: v2-runtime-and-execution-model (workspace wiki)
 *   §RE-6 (run-manifest). Schema: guild.run_manifest.v1. Consumed by
 *   /guild:resume (skills/meta) to continue a multi-wave program across
 *   sessions — this writer NEVER reads/dispatches; it only records state.
 *
 * Writes <cwd>/.guild/programs/<slug>/manifest.json. A "program" is a
 * multi-wave body of work (each wave is one /guild lifecycle run, identified by
 * its run-id). The manifest tracks the wave list + each wave's status + the
 * program-level status so a later session can pick up at the next pending wave.
 *
 * Operations (composable in one invocation; applied in this order):
 *   --init                 ensure the manifest exists (idempotent — never
 *                          clobbers existing wave progress).
 *   --wave <n> ...         upsert a wave (merge fields onto wave #n, or append).
 *                          started_at/completed_at auto-stamp on active/terminal
 *                          transitions unless explicitly provided.
 *   --status <s>           set the program-level status.
 *   --show                 print the resolved manifest JSON to stdout.
 *
 * Usage:
 *   npx tsx scripts/write-run-manifest.ts --cwd <root> --slug <slug> --init [--title <t>]
 *   npx tsx scripts/write-run-manifest.ts --cwd <root> --slug <slug> \
 *       --wave 1 --wave-name "foundation" --wave-status completed --run-id run-...
 *   npx tsx scripts/write-run-manifest.ts --cwd <root> --slug <slug> --status completed
 *
 * Stdout:  written manifest path (or full JSON with --show).
 * Stderr:  diagnostics.
 * Exit:    0 success · 1 bad input · 2 internal error.
 *
 * Invariant: never writes to .guild/wiki/. Writes only under .guild/programs/.
 */

import * as fs from "fs";
import * as path from "path";
import { atomicWrite } from "../../state";

// ── Schema (guild.run_manifest.v1) ───────────────────────────────────────────

export type WaveStatus = "pending" | "active" | "completed" | "failed";
export type ProgramStatus = "active" | "completed" | "paused" | "aborted";

export interface Wave {
  /** TE-04 canonical rename: `wave_index` (was `wave`). Reader: ARCH-8. */
  wave_index: number;
  name: string;
  status: WaveStatus;
  run_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  /** Optional narrative handed off at wave boundary (skills/meta writes this). */
  handoff_summary?: string | null;
}

export interface RunManifest {
  schema_version: "guild.run_manifest.v1";
  slug: string;
  title: string | null;
  status: ProgramStatus;
  created_at: string;
  updated_at: string;
  /** Lowest non-completed wave number (the resume point); null if no waves. */
  current_wave: number | null;
  waves: Wave[];
}

/** Partial wave update accepted by upsertWave (only `wave_index` is required). */
export interface WavePatch {
  wave_index: number;
  name?: string;
  status?: WaveStatus;
  run_id?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  handoff_summary?: string | null;
}

// ── Paths ──────────────────────────────────────────────────────────────────────

export function manifestPathFor(cwd: string, slug: string): string {
  return path.join(cwd, ".guild", "programs", slug, "manifest.json");
}

// ── Read / write ────────────────────────────────────────────────────────────────

export function readRunManifest(cwd: string, slug: string): RunManifest | null {
  try {
    const raw = fs.readFileSync(manifestPathFor(cwd, slug), "utf8");
    return JSON.parse(raw) as RunManifest;
  } catch {
    return null;
  }
}

/** Recompute the resume point: lowest wave_index not yet completed. */
function computeCurrentWave(waves: Wave[]): number | null {
  if (waves.length === 0) return null;
  const sorted = [...waves].sort((a, b) => a.wave_index - b.wave_index);
  const pending = sorted.find((w) => w.status !== "completed");
  // All complete → point at the last wave (nothing left to resume, but stable).
  return pending ? pending.wave_index : sorted[sorted.length - 1]!.wave_index;
}

export function writeRunManifest(cwd: string, manifest: RunManifest): string {
  // Keep waves sorted + current_wave consistent on every write.
  manifest.waves.sort((a, b) => a.wave_index - b.wave_index);
  manifest.current_wave = computeCurrentWave(manifest.waves);
  const out = manifestPathFor(cwd, manifest.slug);
  // EXDEV fix: atomicWrite writes its temp file in the SAME directory as
  // `out` (never os.tmpdir()), so the rename is always same-filesystem.
  atomicWrite(out, JSON.stringify(manifest, null, 2) + "\n");
  return out;
}

// ── Operations ───────────────────────────────────────────────────────────────

/**
 * Ensure a manifest exists. Idempotent: if one is already present it is returned
 * unchanged (wave progress is never clobbered). `title` only applies on create.
 */
export function initRunManifest(
  cwd: string,
  slug: string,
  opts: { title?: string } = {}
): RunManifest {
  const existing = readRunManifest(cwd, slug);
  if (existing) return existing;
  const now = new Date().toISOString();
  const manifest: RunManifest = {
    schema_version: "guild.run_manifest.v1",
    slug,
    title: opts.title ?? null,
    status: "active",
    created_at: now,
    updated_at: now,
    current_wave: null,
    waves: [],
  };
  writeRunManifest(cwd, manifest);
  return manifest;
}

/**
 * Upsert wave #patch.wave. Merges provided fields onto an existing wave or
 * appends a new one. Auto-stamps started_at when a wave first becomes active and
 * completed_at when it first reaches a terminal state, unless explicitly given.
 */
export function upsertWave(cwd: string, slug: string, patch: WavePatch): RunManifest {
  const manifest = readRunManifest(cwd, slug) ?? initRunManifest(cwd, slug);
  const now = new Date().toISOString();
  let wave = manifest.waves.find((w) => w.wave_index === patch.wave_index);
  if (!wave) {
    wave = {
      wave_index: patch.wave_index,
      name: patch.name ?? `wave-${patch.wave_index}`,
      status: patch.status ?? "pending",
      run_id: patch.run_id ?? null,
      started_at: patch.started_at ?? null,
      completed_at: patch.completed_at ?? null,
      handoff_summary: patch.handoff_summary ?? null,
    };
    manifest.waves.push(wave);
  } else {
    if (patch.name !== undefined) wave.name = patch.name;
    if (patch.status !== undefined) wave.status = patch.status;
    if (patch.run_id !== undefined) wave.run_id = patch.run_id;
    if (patch.started_at !== undefined) wave.started_at = patch.started_at;
    if (patch.completed_at !== undefined) wave.completed_at = patch.completed_at;
    if (patch.handoff_summary !== undefined) wave.handoff_summary = patch.handoff_summary;
  }

  // Auto-stamp lifecycle timestamps (only when not explicitly supplied).
  if (wave.status === "active" && wave.started_at === null && patch.started_at === undefined) {
    wave.started_at = now;
  }
  if (
    (wave.status === "completed" || wave.status === "failed") &&
    wave.completed_at === null &&
    patch.completed_at === undefined
  ) {
    wave.completed_at = now;
  }

  manifest.updated_at = now;
  writeRunManifest(cwd, manifest);
  return manifest;
}

export function setProgramStatus(
  cwd: string,
  slug: string,
  status: ProgramStatus
): RunManifest {
  const manifest = readRunManifest(cwd, slug) ?? initRunManifest(cwd, slug);
  manifest.status = status;
  manifest.updated_at = new Date().toISOString();
  writeRunManifest(cwd, manifest);
  return manifest;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const WAVE_STATUSES = new Set<WaveStatus>(["pending", "active", "completed", "failed"]);
const PROGRAM_STATUSES = new Set<ProgramStatus>(["active", "completed", "paused", "aborted"]);

interface CliArgs {
  cwd: string;
  slug: string | null;
  init: boolean;
  title?: string;
  /** Parsed from `--wave <n>`; stored as the `wave_index` value in the manifest. */
  wave?: number;
  waveName?: string;
  waveStatus?: WaveStatus;
  runId?: string;
  handoffSummary?: string;
  status?: ProgramStatus;
  show: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    cwd: process.env["GUILD_CWD"] ?? process.cwd(),
    slug: null,
    init: false,
    show: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cwd" && argv[i + 1]) out.cwd = argv[++i];
    else if (a === "--slug" && argv[i + 1]) out.slug = argv[++i];
    else if (a === "--init") out.init = true;
    else if (a === "--title" && argv[i + 1]) out.title = argv[++i];
    else if (a === "--wave" && argv[i + 1]) {
      const n = Number.parseInt(argv[++i], 10);
      if (Number.isFinite(n)) out.wave = n;
    } else if (a === "--wave-name" && argv[i + 1]) out.waveName = argv[++i];
    else if (a === "--wave-status" && argv[i + 1]) {
      const v = argv[++i];
      if (WAVE_STATUSES.has(v as WaveStatus)) out.waveStatus = v as WaveStatus;
    } else if (a === "--run-id" && argv[i + 1]) out.runId = argv[++i];
    else if (a === "--handoff-summary" && argv[i + 1]) out.handoffSummary = argv[++i];
    else if (a === "--status" && argv[i + 1]) {
      const v = argv[++i];
      if (PROGRAM_STATUSES.has(v as ProgramStatus)) out.status = v as ProgramStatus;
    } else if (a === "--show") out.show = true;
  }
  return out;
}

export function runWriteRunManifestCli(argv: string[] = process.argv.slice(2)): void {
  const args = parseArgs(argv);

  if (!args.slug) {
    process.stderr.write("[write-run-manifest] ERROR: --slug <slug> is required.\n");
    process.exit(1);
  }
  if (!fs.existsSync(args.cwd) || !fs.statSync(args.cwd).isDirectory()) {
    process.stderr.write(`[write-run-manifest] ERROR: --cwd "${args.cwd}" is not a directory\n`);
    process.exit(1);
  }

  try {
    let manifest: RunManifest | null = null;

    if (args.init) {
      manifest = initRunManifest(args.cwd, args.slug, { title: args.title });
    }
    if (args.wave !== undefined) {
      manifest = upsertWave(args.cwd, args.slug, {
        wave_index: args.wave,
        name: args.waveName,
        status: args.waveStatus,
        run_id: args.runId,
        handoff_summary: args.handoffSummary,
      });
    }
    if (args.status !== undefined) {
      manifest = setProgramStatus(args.cwd, args.slug, args.status);
    }

    // No mutating op given → read (or treat --show alone as a read).
    if (!args.init && args.wave === undefined && args.status === undefined) {
      manifest = readRunManifest(args.cwd, args.slug);
      if (!manifest) {
        process.stderr.write(
          `[write-run-manifest] ERROR: no manifest for slug "${args.slug}" ` +
            `(pass --init to create one).\n`
        );
        process.exit(1);
      }
    }

    if (args.show) {
      process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
    } else {
      process.stdout.write(manifestPathFor(args.cwd, args.slug) + "\n");
    }
  } catch (e) {
    process.stderr.write(`[write-run-manifest] ERROR: ${(e as Error).message}\n`);
    process.exit(2);
  }
}

if (
  require.main === module &&
  new RegExp("[\\\\/]write-run-manifest\\.[cm]?[jt]s$").test(process.argv[1] ?? "")
) {
  runWriteRunManifestCli();
}
