import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDesktopAppSmokeReceipt,
  writeDesktopAppSmokeReceipt,
} from "../desktop-app-smoke";

describe("desktop-app-smoke receipts", () => {
  it("records Codex App /guild bridge evidence without promoting public state", () => {
    const receipt = buildDesktopAppSmokeReceipt({
      host: "codex-app",
      result: "codex-slash-forwarded",
      boxId: "local-box",
      capturedAt: "2026-07-05",
      appVersion: "Codex 1.2.3",
      evidence: ["Submitted /guild:status and observed UserPromptSubmit bridge output"],
    });
    expect(receipt).toMatchObject({
      schema_version: "guild.desktop_app_smoke.v1",
      host_id: "codex-app",
      app_bundle_id: "com.openai.codex",
      result: "codex-slash-forwarded",
      public_state_effect: "none",
      command_probe: {
        attempted_input: "/guild:status",
        expected_bridge: "Codex plugin UserPromptSubmit hook receives /guild text from Codex App",
        fallback: "Invoke the installed Guild plugin or bundled guild skill explicitly with @.",
      },
    });
  });

  it("records Codex App slash rejection as a verified fallback path", () => {
    const receipt = buildDesktopAppSmokeReceipt({
      host: "codex-app",
      result: "codex-slash-rejected-fallback-ok",
      boxId: "local-box",
      capturedAt: "2026-07-05",
      evidence: ["Codex App rejected /guild before hooks; @guild skill invocation succeeded"],
    });
    expect(receipt.command_probe.observed_behavior).toContain("explicit plugin/skill fallback worked");
    expect(receipt.checks[0]).toMatchObject({ state: "passed" });
  });

  it("records Claude desktop native slash evidence and CLI fallback", () => {
    const receipt = buildDesktopAppSmokeReceipt({
      host: "claude-code-app",
      result: "claude-native-slash-ok",
      boxId: "local-box",
      capturedAt: "2026-07-05",
      evidence: ["Fresh Claude desktop session showed /guild:guild and dispatched"],
    });
    expect(receipt).toMatchObject({
      host_id: "claude-code-app",
      app_bundle_id: "com.anthropic.claudefordesktop",
      command_probe: {
        attempted_input: '/guild:guild "desktop smoke"',
        fallback: "Use the Claude Code CLI Guild plugin install or paste the manual Guild instruction packet.",
      },
    });
  });

  it("writes canonical receipt files to the desktop evidence tree", () => {
    const tmp = mkdtempSync(join(tmpdir(), "guild-desktop-app-smoke-"));
    try {
      const receipt = buildDesktopAppSmokeReceipt({
        host: "codex-app",
        result: "blocked",
        boxId: "blocked-box",
        capturedAt: "2026-07-05",
        evidence: ["Computer Use was blocked from inspecting com.openai.codex"],
      });
      const written = writeDesktopAppSmokeReceipt(receipt, tmp);
      expect(written).toBe(join(tmp, "codex-app", "blocked-box.json"));
      const parsed = JSON.parse(readFileSync(written, "utf8"));
      expect(parsed.public_state_effect).toBe("none");
      expect(parsed.checks[0].state).toBe("blocked");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
