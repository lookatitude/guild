// Negative control: the raw acceptance reader is used only inside the qualified
// CD17b wrapper, and no legacy release primitive is named.
import { findRunAcceptances } from "./acceptance";

export function findQualifiedRunAcceptances(cwd: string, runId: string) {
  return findRunAcceptances(cwd, runId).filter((a) => a.qualified_release === true);
}
