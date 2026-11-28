import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isUnderGuildManagedRoot } from "../lib/guild-managed";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "guild-managed-"));

describe("isUnderGuildManagedRoot", () => {
  it("is true under a .guild ancestor or the plugin root, false elsewhere", () => {
    const repo = tmp();
    fs.mkdirSync(path.join(repo, ".guild"));
    const plugin = tmp();
    expect(isUnderGuildManagedRoot(path.join(repo, "a", "b.md"), null)).toBe(true);
    expect(isUnderGuildManagedRoot(path.join(plugin, "skills", "x.md"), plugin)).toBe(true);
    expect(isUnderGuildManagedRoot(path.join(tmp(), "x.md"), plugin)).toBe(false);
  });
});
