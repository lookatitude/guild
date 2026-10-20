import { describe, expect, it } from "bun:test";

import { main } from "./pane-send";
import type { ExecutionRunFn } from "../src/domains/dispatch";

function fakeTmux(screens: string[]): { run: ExecutionRunFn; verbs: string[] } {
  const verbs: string[] = [];
  let sent = false;
  const pending = [...screens];
  return {
    verbs,
    run: (_cmd, args) => {
      verbs.push(args[0]);
      if (args[0] === "send-keys") {
        sent = true;
        return { status: 0, stdout: "", stderr: "" };
      }
      const screen = sent ? "> go\n⠋" : pending.length > 1 ? pending.shift()! : pending[0];
      return { status: 0, stdout: screen, stderr: "" };
    },
  };
}

describe("pane-send CLI (#179)", () => {
  it("exits 0 only after an idle gate and a confirmed delivery", () => {
    const tmux = fakeTmux(["⠋ busy", "> ", "> "]);
    const code = main(["--target", "guild:lane.1", "--message", "go", "--settle-ms", "0"], tmux.run);
    expect(code).toBe(0);
    expect(tmux.verbs.indexOf("send-keys")).toBe(3);
  });

  it("exits 1 and sends nothing while the pane stays busy", () => {
    const tmux = fakeTmux(Array.from({ length: 10 }, (_, i) => `⠋ ${i}`));
    const code = main(
      ["--target", "guild:lane.1", "--message", "go", "--settle-ms", "0", "--poll-limit", "4"],
      tmux.run,
    );
    expect(code).toBe(1);
    expect(tmux.verbs).not.toContain("send-keys");
  });

  it("exits 2 on a usage error", () => {
    expect(main(["--target", "x"], fakeTmux(["> "]).run)).toBe(2);
  });
});
