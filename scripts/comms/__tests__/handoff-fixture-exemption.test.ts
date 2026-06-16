/**
 * Pins the check-a SCOPE exemption for intentional handoff TEST FIXTURES
 * (comms-format-yaml-migration L1, scope (c)).
 *
 * `tests/**\/fixtures/**\/handoffs/*.md` are deliberately-malformed receipts and
 * must NOT trip check (a). The exemption is path-scoped (both `/fixtures/` and
 * `/handoffs/` segments) so it can never silence a REAL runtime receipt under
 * `.guild/runs/<id>/handoffs/`.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { lintCommsFormat } from "../comms-format-lint";

// A receipt body with NO embedded guild.handoff.v2 block — the canonical check-a trigger.
const MALFORMED_RECEIPT = "# handoff\n\nno envelope here at all\n";

function writeTemp(relPath: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-exempt-"));
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, MALFORMED_RECEIPT, "utf8");
  return abs;
}

describe("check-a handoff-fixture exemption", () => {
  it("does NOT flag a malformed receipt under a fixtures/**/handoffs/ path", () => {
    const fixture = writeTemp("tests/dot-guild/fixtures/x/.guild/runs/r/handoffs/receipt.md");
    const findings = lintCommsFormat({ paths: [fixture] });
    expect(findings.filter((f) => f.check === "a")).toHaveLength(0);
  });

  it("STILL flags the same malformed receipt under a real (non-fixture) runs/ handoffs path", () => {
    const real = writeTemp(".guild/runs/run-real/handoffs/receipt.md");
    const findings = lintCommsFormat({ paths: [real] });
    // No /fixtures/ segment → exemption must NOT apply → check-a fires.
    expect(findings.filter((f) => f.check === "a").length).toBeGreaterThanOrEqual(1);
  });

  it("requires BOTH /fixtures/ and /handoffs/ — a fixture file outside handoffs/ is not check-a-exempt anyway (it isn't a receipt)", () => {
    // A fixtures file that is NOT under handoffs/ and has no receipt type is not a
    // receipt, so check-a never applies — exemption breadth is irrelevant here.
    const nonReceipt = writeTemp("tests/dot-guild/fixtures/x/notes.md");
    const findings = lintCommsFormat({ paths: [nonReceipt] });
    expect(findings.filter((f) => f.check === "a")).toHaveLength(0);
  });
});
