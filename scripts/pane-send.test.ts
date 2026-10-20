import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { main } from "./pane-send";
import type { ExecutionRunFn } from "../src/domains/dispatch";

const READY = "│ >   │\n  ? for shortcuts";
const BUSY = "⠋ Working (esc to interrupt)";

function fakeTmux(screens: string[], command = "claude"): { run: ExecutionRunFn; verbs: string[] } {
  const verbs: string[] = [];
  let sent = false;
  const pending = [...screens];
  return {
    verbs,
    run: (_cmd, args) => {
      verbs.push(args[0]);
      if (args[0] === "display-message") return { status: 0, stdout: `${command}\n`, stderr: "" };
      if (args[0] === "send-keys") {
        sent = true;
        return { status: 0, stdout: "", stderr: "" };
      }
      const screen = sent ? BUSY : pending.length > 1 ? pending.shift()! : pending[0];
      return { status: 0, stdout: screen, stderr: "" };
    },
  };
}

describe("pane-send CLI (#179)", () => {
  it("exits 0 only after an input-ready gate and a confirmed pickup", () => {
    const tmux = fakeTmux([BUSY, READY, READY, READY]);
    const code = main(["--target", "guild:lane.1", "--message", "go", "--settle-ms", "0"], tmux.run);
    expect(code).toBe(0);
    expect(tmux.verbs.indexOf("send-keys")).toBe(6);
  });

  it("exits 1 and sends nothing while the agent stays busy", () => {
    const tmux = fakeTmux([BUSY]);
    const code = main(
      ["--target", "guild:lane.1", "--message", "go", "--settle-ms", "0", "--poll-limit", "4"],
      tmux.run,
    );
    expect(code).toBe(1);
    expect(tmux.verbs).not.toContain("send-keys");
  });

  it("exits 2 on a usage error", () => {
    expect(main(["--target", "x"], fakeTmux([READY]).run)).toBe(2);
  });
});

// Real tmux. A fake agent CLI named `claude` (built with cc) draws the
// input-ready marker, and while it handles a line it shows the busy marker.
const haveTmux = spawnSync("tmux", ["-V"]).status === 0;
const haveCc = spawnSync("cc", ["--version"]).status === 0;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "guild-pane-send-"));
const sessions: string[] = [];
afterAll(() => {
  for (const s of sessions) spawnSync("tmux", ["kill-session", "-t", s]);
  fs.rmSync(scratch, { recursive: true, force: true });
});

const FAKE_AGENT_C = `
#include <stdio.h>
#include <string.h>
#include <unistd.h>
int main(void) {
  char line[512];
  setvbuf(stdout, NULL, _IONBF, 0);
  for (;;) {
    printf("\\033[2J\\033[H> \\n  ? for shortcuts\\n");
    if (!fgets(line, sizeof line, stdin)) return 0;
    printf("\\033[2J\\033[Hreceived: %s(esc to interrupt)\\n", line);
    sleep(3);
  }
}
`;

function startSession(name: string, command: string): string {
  const session = `guild-pane-send-${name}-${process.pid}`;
  sessions.push(session);
  expect(spawnSync("tmux", ["new-session", "-d", "-s", session, command]).status).toBe(0);
  return session;
}

function screen(session: string): string {
  return spawnSync("tmux", ["capture-pane", "-p", "-t", session], { encoding: "utf8" }).stdout ?? "";
}

function waitFor(session: string, text: string): void {
  for (let i = 0; i < 50 && !screen(session).includes(text); i++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

describe.skipIf(!haveTmux)("pane-send against real tmux (#179)", () => {
  it("a quiet busy pane (sleep) gets NO keys: not_agent_pane", () => {
    const session = startSession("sleep", "sleep 30");
    const writes: string[] = [];
    const out = process.stdout.write;
    process.stdout.write = ((chunk: string) => writes.push(String(chunk))) as typeof process.stdout.write;
    let code: number;
    try {
      code = main(["--target", session, "--message", "status?", "--settle-ms", "50", "--poll-limit", "5"]);
    } finally {
      process.stdout.write = out;
    }
    expect(code).toBe(1);
    expect(JSON.parse(writes.join("")).facts.reason).toBe("not_agent_pane");
    expect(screen(session)).not.toContain("status?");
  });

  it.skipIf(!haveCc)("holds a message while the agent is busy, then delivers it once picked up", () => {
    const bin = path.join(scratch, "claude");
    fs.writeFileSync(`${bin}.c`, FAKE_AGENT_C);
    expect(spawnSync("cc", ["-o", bin, `${bin}.c`]).status).toBe(0);
    const session = startSession("agent", bin);
    waitFor(session, "? for shortcuts");

    expect(main(["--target", session, "--message", "first", "--settle-ms", "100", "--poll-limit", "20"])).toBe(0);
    expect(screen(session)).toContain("received: first");

    // Mid-turn: the agent is busy for 3s; a short budget holds the message, no keys.
    expect(main(["--target", session, "--message", "second", "--settle-ms", "100", "--poll-limit", "5"])).toBe(1);
    expect(screen(session)).not.toContain("second");

    // The held message is delivered after the turn ends.
    expect(main(["--target", session, "--message", "second", "--settle-ms", "200", "--poll-limit", "40"])).toBe(0);
    expect(screen(session)).toContain("received: second");
  }, 30_000);
});
