/**
 * E00-T0 · EAT05 / CD10 / CD21 — the packaged worker CLI task-cell-ack writes
 * ONLY outbox/<instance_id>/ack-claim.json (guild.assignment_ack_claim.v1
 * {run_id, instance_id, assignment_sha256, claimed_at}) from an absolute
 * assignment locator, whatever the worker's cwd. It never reads binding.json,
 * publishes to the bus, edits instance.json, or writes the controller's ack.
 *
 * Expected red: scripts/task-cell-ack.ts and the writeAckClaim facade are
 * absent. Fixture: a real delivered assignment from the existing runtime.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { readBusLog, taskCellPaths } from "../../src/domains/dispatch";
import { bindingPathOf, driveLane, makeRuntime, ownedTempDir, requireExport, requireFile, sha256, teardownOwned, tempRoot } from "./support/e00-harness";

afterEach(teardownOwned);

const CLI_REL = "scripts/task-cell-ack.ts";

async function delivered() {
  const root = tempRoot("guild-e00-ack-");
  const rt = makeRuntime(root);
  const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend", stopAfterDeliver: true });
  const ids = { run_id: root.runId, logical_task_id: "T1", attempt: 1, instance_id: d.instance.instance_id };
  const paths = taskCellPaths(ids);
  const assignmentAbs = path.join(root.cwd, paths.assignment_path);
  const claim = path.join(root.cwd, ".guild", "runs", root.runId, "outbox", d.instance.instance_id, "ack-claim.json");
  return { root, d, paths, assignmentAbs, claim };
}

function runAck(cwd: string, assignmentAbs: string, timeoutMs = 30000) {
  const cli = requireFile(CLI_REL);
  const r = spawnSync("npx", ["tsx", cli, "--assignment", assignmentAbs], { cwd, encoding: "utf8", timeout: timeoutMs, env: { ...process.env, GUILD_RUN_BINDING_REF: "" } });
  return { status: r.status, timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" };
}

function snapshot(f: string): string | null {
  return fs.existsSync(f) ? sha256(fs.readFileSync(f)) : null;
}

describe("EAT05 ack claim is cwd-independent (expected red)", () => {
  for (const where of ["subdirectory", "sibling repo"] as const) {
    it(`writes only the ack claim when the worker cwd is a ${where}`, async () => {
      const { root, paths, assignmentAbs, claim } = await delivered();
      const cwd = where === "subdirectory"
        ? path.join(root.cwd, "src", "api")
        : ownedTempDir("guild-e00-sibling-");
      fs.mkdirSync(cwd, { recursive: true });
      const instanceBefore = snapshot(path.join(root.cwd, paths.instance_path));
      const busBefore = readBusLog(path.join(root.cwd, ".guild", "runs", root.runId)).length;
      const projectionBefore = JSON.parse(fs.readFileSync(assignmentAbs, "utf8")).projection;
      const r = runAck(cwd, assignmentAbs);
      expect(r.status).toBe(0);
      const body = JSON.parse(fs.readFileSync(claim, "utf8"));
      expect(body).toMatchObject({
        schema_version: "guild.assignment_ack_claim.v1",
        run_id: root.runId,
        instance_id: path.basename(path.dirname(claim)),
        assignment_sha256: sha256(fs.readFileSync(assignmentAbs)),
      });
      expect(typeof body.claimed_at).toBe("string");
      expect(snapshot(path.join(root.cwd, paths.instance_path))).toBe(instanceBefore);
      expect(readBusLog(path.join(root.cwd, ".guild", "runs", root.runId)).length).toBe(busBefore);
      expect(fs.existsSync(path.join(root.cwd, paths.instance_dir, "assignment-ack.json"))).toBe(false);
      expect(JSON.parse(fs.readFileSync(assignmentAbs, "utf8")).projection).toEqual(projectionBefore);
      // The guild root is derived from the assignment path, never from cwd.
      expect(fs.existsSync(path.join(cwd, ".guild"))).toBe(false);
    });
  }

  it("never opens binding.json (FIFO trace)", async () => {
    const { root, assignmentAbs, claim } = await delivered();
    fs.rmSync(bindingPathOf(root));
    expect(spawnSync("mkfifo", [bindingPathOf(root)]).status).toBe(0);
    const r = runAck(path.join(root.cwd), assignmentAbs, 20000);
    expect(r.timedOut).toBe(false);
    expect(fs.existsSync(claim)).toBe(true);
  });

  it("the CLI source names no binding reader", () => {
    const src = fs.readFileSync(requireFile(CLI_REL), "utf8");
    for (const banned of ["binding.json", "runBindingPath", "loadRunBinding", "readRunBindingRecord", "GUILD_RUN_BINDING_REF"]) {
      expect(src.includes(banned)).toBe(false);
    }
  });

  it("writeAckClaim facade writes the same claim and nothing else", async () => {
    const write = await requireExport<(o: unknown) => unknown>("src/domains/dispatch/index.ts", "writeAckClaim");
    const { root, assignmentAbs, claim } = await delivered();
    const before = new Set(fs.readdirSync(path.join(root.cwd, ".guild", "runs", root.runId), { recursive: true }) as string[]);
    await write({ assignmentPath: assignmentAbs, now: () => "2026-10-26T13:00:01.000Z" });
    const after = (fs.readdirSync(path.join(root.cwd, ".guild", "runs", root.runId), { recursive: true }) as string[]).filter((p) => !before.has(p));
    expect(after.filter((p) => !p.endsWith("outbox") && !p.endsWith(path.basename(path.dirname(claim))))).toEqual([path.relative(path.join(root.cwd, ".guild", "runs", root.runId), claim)]);
  });
});
