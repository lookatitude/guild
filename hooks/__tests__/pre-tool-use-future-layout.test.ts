/**
 * hooks/__tests__/pre-tool-use-future-layout.test.ts
 *
 * KTD23 (T16 D6): PreToolUse on a FUTURE .guild/ layout denies the tool call
 * (fail closed) and writes nothing into that .guild/. The current layout is the
 * control: the layout gate stays silent there.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { hermeticEnv } from "../test-support/hermetic-env";
import { CURRENT_LAYOUT_VERSION } from "../../scripts/lib/state/ensure-storage-layout";

const SOURCE = path.resolve(__dirname, "../pre-tool-use.ts");
const BUNDLE = path.resolve(__dirname, "../dist/pre-tool-use.js");

function run(cmd: string[], tmp: string, payload: object): { stdout: string; exitCode: number } {
  const r = spawnSync(cmd[0], cmd.slice(1), {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...hermeticEnv(), GUILD_CWD: tmp },
    timeout: 20000,
  });
  return { stdout: r.stdout ?? "", exitCode: r.status ?? 1 };
}

function listTree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      out.push(path.relative(dir, p));
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out.sort();
}

function writeMarker(tmp: string, version: number): void {
  fs.mkdirSync(path.join(tmp, ".guild", "runs"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".guild", "storage-layout.json"),
    JSON.stringify({ storage_layout_version: version }),
  );
  fs.writeFileSync(path.join(tmp, ".guild", "guild.yaml"), "schema: guild.root.v1\nkind: project\n");
}

const PAYLOAD = (tmp: string) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Write",
  tool_input: { file_path: path.join(tmp, "src", "a.ts"), content: "x" },
  cwd: tmp,
});

describe("pre-tool-use on a future layout", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-ptu-layout-")));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  for (const [label, cmd] of [
    ["source", ["npx", "tsx", SOURCE]],
    ["compiled bundle", ["node", BUNDLE]],
  ] as const) {
    it(`${label}: denies the tool call and writes no receipt`, () => {
      writeMarker(tmp, CURRENT_LAYOUT_VERSION + 1);
      const before = listTree(path.join(tmp, ".guild"));
      const r = run([...cmd], tmp, PAYLOAD(tmp));
      const out = JSON.parse(r.stdout);
      expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(out.hookSpecificOutput.permissionDecisionReason).toContain("never down-migrated");
      expect(listTree(path.join(tmp, ".guild"))).toEqual(before);
    });

    it(`${label}: control — the current layout is not denied by the layout gate`, () => {
      writeMarker(tmp, CURRENT_LAYOUT_VERSION);
      const r = run([...cmd], tmp, PAYLOAD(tmp));
      expect(r.stdout).not.toContain("never down-migrated");
    });
  }
});
