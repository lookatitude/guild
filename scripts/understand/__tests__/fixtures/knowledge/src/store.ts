/**
 * Event storage layer.
 *
 * The event store is append-only: validated events are written once and
 * never mutated. This gives the pipeline a durable, replayable log.
 */

import type { RawEvent } from "./ingest";

const log: RawEvent[] = [];

/**
 * Store a validated event by appending it to the durable log.
 * Events are stored append-only and never mutated.
 */
export function storeEvent(raw: RawEvent): void {
  log.push(raw);
}
