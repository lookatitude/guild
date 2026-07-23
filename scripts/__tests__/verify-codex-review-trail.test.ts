/**
 * scripts/__tests__/verify-codex-review-trail.test.ts
 *
 * G6d — the codex-review cap contract names TWO clean cap terminal states
 * beyond the plain `satisfied` / `skipped-codex-unavailable`:
 *   (1) "cap + reasoned pushback recorded"  → final_status: cap-pushback-recorded
 *   (2) "verification-only round beyond cap" → final_status: cap-verification-only
 *
 * These are AUDITED capped terminals (the disagreement / the verification-only
 * round is on record), so the completeness validator accepts them — while a bare
 * `cap_hit` or an unaudited force-pass still DELIBERATELY fails, as before.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  ALLOWED_FINAL_STATUS,
  verifyOneFile,
} from "../verify-codex-review-trail";

function writeTrail(finalStatus: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-trail-"));
  const file = path.join(dir, "G-lane.md");
  fs.writeFileSync(
    file,
    `---\ngate: G-lane\nrun_id: run-x\nfinal_status: ${finalStatus}\nrounds: 5\n---\n\n## Round 5\n`,
  );
  return file;
}

describe("verify-codex-review-trail — G6d named cap terminal states", () => {
  it("names both cap terminal states in the allowed set", () => {
    expect(ALLOWED_FINAL_STATUS).toContain("cap-pushback-recorded");
    expect(ALLOWED_FINAL_STATUS).toContain("cap-verification-only");
  });

  it("ACCEPTS a trail terminating as cap + reasoned pushback recorded", () => {
    const r = verifyOneFile(writeTrail("cap-pushback-recorded"));
    expect(r.ok).toBe(true);
  });

  it("ACCEPTS a trail terminating as verification-only round beyond cap", () => {
    const r = verifyOneFile(writeTrail("cap-verification-only"));
    expect(r.ok).toBe(true);
  });

  it("still ACCEPTS the pre-existing clean terminals", () => {
    expect(verifyOneFile(writeTrail("satisfied")).ok).toBe(true);
    expect(verifyOneFile(writeTrail("skipped-codex-unavailable")).ok).toBe(true);
  });

  it("still REJECTS a bare cap_hit / unaudited disposition (audit exception)", () => {
    expect(verifyOneFile(writeTrail("cap_hit")).ok).toBe(false);
    expect(verifyOneFile(writeTrail("force_passed")).ok).toBe(false);
  });
});
