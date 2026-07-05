import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDesktopAppSmokeReceipt,
  writeDesktopAppSmokeReceipt,
} from "../desktop-app-smoke";
import { verifyDesktopAppSmokeReceipts } from "../verify-desktop-app-smoke";

describe("verify-desktop-app-smoke", () => {
  function withTmp<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), "guild-verify-desktop-smoke-"));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("passes with no receipts unless hosts are explicitly required", () => {
    withTmp((dir) => {
      const result = verifyDesktopAppSmokeReceipts({ evidenceRoot: dir });
      expect(result.ok).toBe(true);
      expect(result.summaries).toEqual([
        { host: "claude-code-app", status: "missing", receiptCount: 0, latestResult: null },
        { host: "codex-app", status: "missing", receiptCount: 0, latestResult: null },
      ]);
    });
  });

  it("fails when a required desktop host has no receipt", () => {
    withTmp((dir) => {
      const result = verifyDesktopAppSmokeReceipts({ evidenceRoot: dir, requireHosts: ["codex-app"] });
      expect(result.ok).toBe(false);
      expect(result.errors).toContain("codex-app: required desktop app smoke receipt missing");
    });
  });

  it("summarizes passed and fallback desktop receipts", () => {
    withTmp((dir) => {
      writeDesktopAppSmokeReceipt(
        buildDesktopAppSmokeReceipt({
          host: "codex-app",
          result: "codex-slash-rejected-fallback-ok",
          boxId: "codex-box",
          capturedAt: "2026-07-05",
          evidence: ["@guild skill fallback worked"],
        }),
        dir,
      );
      writeDesktopAppSmokeReceipt(
        buildDesktopAppSmokeReceipt({
          host: "claude-code-app",
          result: "claude-native-slash-ok",
          boxId: "claude-box",
          capturedAt: "2026-07-05",
          evidence: ["/guild:guild dispatched"],
        }),
        dir,
      );

      const result = verifyDesktopAppSmokeReceipts({
        evidenceRoot: dir,
        requireHosts: ["codex-app", "claude-code-app"],
      });
      expect(result.ok).toBe(true);
      expect(result.summaries).toEqual([
        { host: "claude-code-app", status: "passed", receiptCount: 1, latestResult: "claude-native-slash-ok" },
        { host: "codex-app", status: "fallback", receiptCount: 1, latestResult: "codex-slash-rejected-fallback-ok" },
      ]);
    });
  });

  it("rejects malformed or support-promoting receipts", () => {
    withTmp((dir) => {
      mkdirSync(join(dir, "codex-app"), { recursive: true });
      writeFileSync(
        join(dir, "codex-app", "bad.json"),
        JSON.stringify({
          schema_version: "guild.desktop_app_smoke.v1",
          host_id: "codex-app",
          app_bundle_id: "com.openai.codex",
          box_id: "bad",
          captured_at: "2026-07-05",
          result: "codex-slash-forwarded",
          public_state_effect: "verified_wrapped",
          command_probe: {},
          checks: [{ name: "e", state: "passed", evidence: "bad promotion" }],
          notes: null,
        }),
      );
      const result = verifyDesktopAppSmokeReceipts({ evidenceRoot: dir });
      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toContain("desktop app receipt must not affect public state");
    });
  });

  it("fails required hosts when the only receipt is blocked or failed", () => {
    withTmp((dir) => {
      writeDesktopAppSmokeReceipt(
        buildDesktopAppSmokeReceipt({
          host: "claude-code-app",
          result: "failed",
          boxId: "claude-failed",
          capturedAt: "2026-07-05",
          evidence: ["/guild appeared as plain text and no fallback was proven"],
        }),
        dir,
      );

      const result = verifyDesktopAppSmokeReceipts({
        evidenceRoot: dir,
        requireHosts: ["claude-code-app"],
      });
      expect(result.ok).toBe(false);
      expect(result.errors).toContain(
        "claude-code-app: required desktop app smoke receipt does not prove usability (status=failed)",
      );
    });
  });
});
