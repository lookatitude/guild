import {
  emitAntigravityHookEvent,
  emitClaudeAiConnectorHookEvent,
  emitClaudeCodeAppHookEvent,
  emitClaudeCodeWebHookEvent,
  emitClaudeHookEvent,
  emitCodexAppHookEvent,
  emitPiHookEvent,
} from "../guild-hook-event";

describe("GuildHookEvent emitters", () => {
  it("Claude emitter preserves Claude field names and stamps host", () => {
    const event = emitClaudeHookEvent(JSON.stringify({
      session_id: "s1",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    }));
    expect(event).toMatchObject({
      host: "claude",
      session_id: "s1",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    });
  });

  it("Pi emitter normalizes host-native event, tool, and input fields before downstream hooks read them", () => {
    const event = emitPiHookEvent(JSON.stringify({
      sessionId: "pi-session",
      event: "pre_tool_use",
      tool: "bash",
      args: { command: "npm test" },
      result: { success: true },
      workspace: "/repo",
      model_id: "anthropic/opus-4.8",
    }));
    expect(event).toMatchObject({
      host: "pi",
      session_id: "pi-session",
      hook_event_name: "pre_tool_use",
      tool_name: "bash",
      tool_input: { command: "npm test" },
      tool_response: { success: true },
      cwd: "/repo",
      model: "anthropic/opus-4.8",
    });
  });

  it("Antigravity emitter normalizes conversation, event, field, and tool names", () => {
    const event = emitAntigravityHookEvent(JSON.stringify({
      conversation_id: "agy-session",
      eventName: "tool_call",
      toolName: "shell",
      arguments: { command: "npm test" },
      output: { success: false, error: "denied" },
      workspace_path: "/repo",
      model: "gemini-3-pro",
    }));
    expect(event).toMatchObject({
      host: "antigravity",
      session_id: "agy-session",
      hook_event_name: "tool_call",
      tool_name: "shell",
      tool_input: { command: "npm test" },
      tool_response: { success: false, error: "denied" },
      cwd: "/repo",
      model: "gemini-3-pro",
    });
  });

  it("app and connector emitters normalize thread/conversation events into the shared shape", () => {
    const payload = JSON.stringify({
      thread_id: "thread-1",
      eventName: "tool_call",
      toolName: "read_file",
      arguments: { path: "README.md" },
      workspace_path: "/repo",
      model: "frontier",
    });
    for (const [host, event] of [
      ["codex-app", emitCodexAppHookEvent(payload)],
      ["claude-code-app", emitClaudeCodeAppHookEvent(payload)],
      ["claude-code-web", emitClaudeCodeWebHookEvent(payload)],
      ["claude-ai-connector", emitClaudeAiConnectorHookEvent(payload)],
    ] as const) {
      expect(event).toMatchObject({
        host,
        hook_event_name: "tool_call",
        tool_name: "read_file",
        tool_input: { path: "README.md" },
        cwd: "/repo",
        model: "frontier",
      });
    }
  });
});
