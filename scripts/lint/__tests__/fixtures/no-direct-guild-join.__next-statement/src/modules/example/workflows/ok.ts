import * as path from "node:path";

/**
 * Negative control (codex G-lane r3 P2): the scan must not run past the closing
 * paren of one call and match a `.guild` string in the NEXT statement.
 */
export function names(root: string): string[] {
  const base = path.join(root)
  const parts = [base, ".guild"]
  return parts
}
