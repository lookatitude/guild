/**
 * Event ingestion entry point.
 *
 * The webhook adapter receives a raw event payload and hands it to the
 * pipeline. Every incoming event is validated before it is persisted.
 */

import { validateEvent } from "./validate";
import { storeEvent } from "./store";

export interface RawEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Ingest a single raw event: validate it, then store it.
 * This is the front door of the event pipeline.
 */
export function ingestEvent(raw: RawEvent): { stored: boolean } {
  const valid = validateEvent(raw);
  if (!valid) return { stored: false };
  storeEvent(raw);
  return { stored: true };
}
