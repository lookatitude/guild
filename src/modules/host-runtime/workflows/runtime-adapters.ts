/**
 * src/modules/host-runtime/workflows/runtime-adapters.ts
 *
 * P1-L11 - the four runtime adapter surfaces behind the registry:
 *   interaction, session, semantic_tool, browser
 *
 * CONTRACT: pure resolution + an injectable recorder sink (default: in-memory).
 * No direct I/O in the resolution path; never throws.
 */

import {
  ADAPTER_SURFACES,
  resolveRung,
  type AdapterSurface,
  type DegradationReceipt,
  type Rung,
} from "./adapter-fallback-ladders";
import type { HostId } from "./host-registry-schema";

// ---------------------------------------------------------------------------
// Per-surface, per-rung strategy descriptors
// ---------------------------------------------------------------------------

const STRATEGY: Record<AdapterSurface, Record<Rung, string | null>> = {
  interaction: {
    native: "AskUserQuestion (native question UI)",
    wrapped: "host CLI prompt (e.g. terminal stdin)",
    bridged: "Guild file-bus question (.guild/runs/<id>/questions/)",
    emulated: "inline prompt embedded in the agent turn",
    degraded: "no interactive channel — proceed on safe defaults + record",
  },
  session: {
    native: "host session id / resume-by-id",
    wrapped: "run-dir state snapshot (resume from .guild/runs/<id>/state)",
    bridged: "external session store mapping",
    emulated: "re-bootstrap from the instruction file each turn",
    degraded: "stateless — no continuity (record loss)",
  },
  semantic_tool: {
    native: "native tool names (Read/Edit/Bash/…)",
    wrapped: "thin tool-name alias layer",
    bridged: "tool-name map to the host's equivalents",
    emulated: "shell-equivalent emulation of the tool",
    degraded: "tool unavailable — record + skip",
  },
  browser: {
    native: "native host browser control",
    wrapped: "wrapped browser CLI",
    bridged: "chrome-devtools MCP bridge",
    emulated: "headless fetch emulation",
    degraded: "no browser capability — record + skip",
  },
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/** The result of resolving an adapter surface for a host. */
export interface AdapterResolution {
  surface: AdapterSurface;
  host: HostId | string;
  rung: Rung;
  /** The concrete strategy the rung maps to for this surface. */
  strategy: string | null;
  receipt: DegradationReceipt;
}

/** A runtime adapter for one surface. Pure resolution; records via the sink. */
export interface RuntimeAdapter {
  readonly surface: AdapterSurface;
  /** Resolve the host to a rung + strategy + receipt, and record the receipt. */
  resolve(host: HostId | string, recorder?: DegradationRecorder): AdapterResolution;
}

function makeAdapter(surface: AdapterSurface): RuntimeAdapter {
  return {
    surface,
    resolve(host, recorder) {
      const receipt = resolveRung(surface, host);
      const strategy = STRATEGY[surface][receipt.rung];
      recorder?.record(receipt);
      return { surface, host, rung: receipt.rung, strategy, receipt };
    },
  };
}

/** The four runtime adapters, keyed by surface. */
export const RUNTIME_ADAPTERS: Record<AdapterSurface, RuntimeAdapter> = {
  interaction: makeAdapter("interaction"),
  session: makeAdapter("session"),
  semantic_tool: makeAdapter("semantic_tool"),
  browser: makeAdapter("browser"),
};

/** Resolve any surface for a host (convenience over RUNTIME_ADAPTERS). */
export function resolveAdapter(
  surface: AdapterSurface,
  host: HostId | string,
  recorder?: DegradationRecorder
): AdapterResolution {
  return RUNTIME_ADAPTERS[surface].resolve(host, recorder);
}

/** Resolve ALL four surfaces for a host (the per-run adapter profile). */
export function resolveAllAdapters(
  host: HostId | string,
  recorder?: DegradationRecorder
): Record<AdapterSurface, AdapterResolution> {
  const out = {} as Record<AdapterSurface, AdapterResolution>;
  for (const surface of ADAPTER_SURFACES) out[surface] = resolveAdapter(surface, host, recorder);
  return out;
}

// ---------------------------------------------------------------------------
// Degradation recorder
// ---------------------------------------------------------------------------

export class DegradationRecorder {
  private readonly receipts: DegradationReceipt[] = [];
  record(receipt: DegradationReceipt): void {
    this.receipts.push(receipt);
  }
  /** All recorded receipts, in record order. */
  all(): DegradationReceipt[] {
    return this.receipts.slice();
  }
  /** Only the receipts that recorded loss (rung below native). */
  degraded(): DegradationReceipt[] {
    return this.receipts.filter((r) => r.degraded);
  }
  /** Only the INFERRED (off-box) receipts - the ones to re-verify on a live host. */
  inferred(): DegradationReceipt[] {
    return this.receipts.filter((r) => r.inferred);
  }
}
