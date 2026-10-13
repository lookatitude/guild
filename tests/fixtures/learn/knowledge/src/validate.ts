/**
 * Event validation rules.
 *
 * The validator enforces that every event carries a non-empty id and a
 * known type. Invalid events are rejected and never reach storage.
 */

import type { RawEvent } from "./ingest";

const KNOWN_TYPES = new Set(["created", "updated", "deleted"]);

/**
 * Validate a raw event against the known-type allow-list.
 * Returns true when the event is well-formed and of a known type.
 */
export function validateEvent(raw: RawEvent): boolean {
  if (!raw.id || raw.id.length === 0) return false;
  if (!KNOWN_TYPES.has(raw.type)) return false;
  return true;
}
