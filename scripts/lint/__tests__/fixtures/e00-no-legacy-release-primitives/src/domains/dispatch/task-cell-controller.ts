// Fixture: an E00 controller module that gates a downstream lane on the legacy
// release primitive instead of the qualified CD17b facade.
import { isDownstreamReleased } from "./legacy-release";

export function releaseGate(runId: string, task: string): boolean {
  return isDownstreamReleased(runId, task);
}
