/**
 * MH-08 — pinned historical fixture replay for claude-code-cli in-process launch.
 *
 * Historical implementation bytes are extracted from the exact pre-MH-04 Git
 * tree into an OS temporary directory, executed there, and deleted by afterAll.
 * They are never imported by production code or offered as a runtime fallback.
 */

import { createHash } from "crypto";
import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const REPO = path.resolve(__dirname, "../..");
const SCRIPTS = path.join(REPO, "scripts");
const TSX = path.join(SCRIPTS, "node_modules", ".bin", "tsx");
const CURRENT_LAUNCHER = path.join(SCRIPTS, "agent-team-launcher.ts");

const MH04 = "6bfac1668e914eed9c6e9d07c933915f25ec274d";
const ORACLE_COMMIT = "fe07587e420c51fbc864225c69a984c71a0b89c8";
const CURRENT_BASE = "1ad54903684f59eb3b87895a7c2becd69e799a47";
const SEEDED_DESCENDANT = "59de1654337e017f544f80ca86884ea203096dd0";
const PINS = [
  {
    path: "scripts/agent-team-launcher.ts",
    blob: "52732fdfa058eb3db73759d9d6c7b285a0728108",
    sha256: "6b65f5616748f5b179c69643490bc5558f7499f72a2147aea0b3d08864e5b74f",
  },
  {
    path: "scripts/lib/team-backend.ts",
    blob: "cf5ce08f918704390694cdb2f56931938dbbe1d3",
    sha256: "2aea429a4ca2b43b35b959964ea271ea772c991eb964b64294dc9846e4ddea70",
  },
] as const;

type GateMode = "gate-off" | "shadow/replay" | "gate-on/current" | "rollback";

interface LaunchReceipt {
  backend: string;
  reason: string;
  slug: string;
  ok: boolean;
  dispatchPlan: Array<Record<string, unknown>>;
  orchestratorPaneId: string | null;
  teammatePaneIds: Record<string, string>;
  notes: string[];
}

interface ReplayResult {
  raw: Buffer;
  receipt: LaunchReceipt;
}

let oracleRoot = "";
const workRoots: string[] = [];

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

function descendsFromCurrentBase(commit: string): boolean {
  return spawnSync(
    "git",
    ["merge-base", "--is-ancestor", CURRENT_BASE, commit],
    { cwd: REPO }
  ).status === 0;
}

function createForeignCommitObject(): string {
  const emptyTree = git("mktree");
  return execFileSync("git", ["commit-tree", emptyTree], {
    cwd: REPO,
    encoding: "utf8",
    input: "MH-08 unrelated ancestry control\n",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "MH-08 ancestry control",
      GIT_AUTHOR_EMAIL: "mh-08-ancestry-control@example.invalid",
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
      GIT_COMMITTER_NAME: "MH-08 ancestry control",
      GIT_COMMITTER_EMAIL: "mh-08-ancestry-control@example.invalid",
      GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    },
  }).trim();
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeTeam(root: string, lifecycleVersion: string): string {
  const team = path.join(root, "team.yaml");
  fs.writeFileSync(
    team,
    [
      "backend: agent-team",
      "specialists:",
      "  - name: quality",
      "    task-id: MH-08",
      `    scope: lifecycle-${lifecycleVersion}`,
      "",
    ].join("\n")
  );
  return team;
}

function executeLauncher(
  launcher: string,
  scriptsDir: string,
  lifecycleVersion: string,
  effectCounter: { count: number }
): ReplayResult {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mh08-launch-"));
  workRoots.push(cwd);
  const team = writeTeam(cwd, lifecycleVersion);
  effectCounter.count += 1;
  const run = spawnSync(
    TSX,
    [
      launcher,
      "--team",
      team,
      "--cwd",
      cwd,
      "--agent-mode=agent",
      "--run-id",
      `run-mh08-lifecycle-${lifecycleVersion.replace(/\./g, "-")}`,
      "--dry-run",
    ],
    {
      cwd: scriptsDir,
      encoding: null,
      env: {
        ...process.env,
        GUILD_HOST_ID: "claude-code-cli",
        GUILD_RUNTIME_VERSION: lifecycleVersion,
      },
    }
  );
  if (run.status !== 0) {
    throw new Error(
      `launcher failed (${run.status}): ${Buffer.from(run.stderr ?? "").toString("utf8")}`
    );
  }
  const raw = Buffer.from(run.stdout ?? "");
  const receipt = JSON.parse(raw.toString("utf8")) as LaunchReceipt;
  // Test-only anti-vacuity switch. The red command in the MH-08 receipt sets
  // this while running the CURRENT tree; the pinned oracle bytes stay untouched.
  if (
    process.env.GUILD_MH08_INJECT_DRIFT === "1" &&
    path.resolve(launcher) === path.resolve(CURRENT_LAUNCHER)
  ) {
    receipt.ok = false;
  }
  return { raw, receipt };
}

function normalize(receipt: LaunchReceipt): unknown {
  return {
    backend: receipt.backend,
    reason: receipt.reason,
    slug: receipt.slug,
    ok: receipt.ok,
    dispatch_plan: receipt.dispatchPlan,
    orchestrator_pane_id: receipt.orchestratorPaneId,
    teammate_pane_ids: receipt.teammatePaneIds,
    notes: receipt.notes,
  };
}

function orderedReceiptSequence(receipt: LaunchReceipt): readonly string[] {
  return [
    `launch:${receipt.backend}:${receipt.reason}:${receipt.slug}`,
    ...receipt.dispatchPlan.map(
      (descriptor, index) => `dispatch:${index}:${JSON.stringify(descriptor)}`
    ),
    `terminal:${receipt.ok}:${JSON.stringify(receipt.notes)}`,
  ];
}

function replayMode(
  mode: GateMode,
  lifecycleVersion: string,
  oracle: ReplayResult
): {
  current: ReplayResult;
  comparison: "disabled" | "equivalent";
  effects: number;
} {
  const currentEffects = { count: 0 };
  const current = executeLauncher(
    CURRENT_LAUNCHER,
    SCRIPTS,
    lifecycleVersion,
    currentEffects
  );

  // MH-08 owns comparison behavior only. Gate-off and rollback retain the
  // pre-MH-08 current-runtime default. Shadow compares against a result already
  // produced by the isolated oracle; it never executes an extra lifecycle effect.
  if (mode === "shadow/replay" || mode === "gate-on/current") {
    expect(normalize(current.receipt)).toEqual(normalize(oracle.receipt));
    expect(orderedReceiptSequence(current.receipt)).toEqual(
      orderedReceiptSequence(oracle.receipt)
    );
    return { current, comparison: "equivalent", effects: currentEffects.count };
  }
  return { current, comparison: "disabled", effects: currentEffects.count };
}

beforeAll(() => {
  expect(git("rev-parse", `${MH04}^`)).toBe(ORACLE_COMMIT);
  expect(descendsFromCurrentBase(git("rev-parse", "HEAD"))).toBe(true);
  for (const pin of PINS) {
    expect(git("rev-parse", `${ORACLE_COMMIT}:${pin.path}`)).toBe(pin.blob);
    const bytes = execFileSync("git", ["show", `${ORACLE_COMMIT}:${pin.path}`], {
      cwd: REPO,
      encoding: null,
    });
    expect(sha256(bytes)).toBe(pin.sha256);
  }

  oracleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mh08-oracle-"));
  const archive = path.join(oracleRoot, "oracle.tar");
  execFileSync("git", ["archive", "--format=tar", `--output=${archive}`, ORACLE_COMMIT], {
    cwd: REPO,
  });
  execFileSync("tar", ["-xf", archive, "-C", oracleRoot]);
  fs.unlinkSync(archive);
  fs.symlinkSync(path.join(SCRIPTS, "node_modules"), path.join(oracleRoot, "scripts", "node_modules"));
});

afterAll(() => {
  for (const root of workRoots) fs.rmSync(root, { recursive: true, force: true });
  if (oracleRoot) fs.rmSync(oracleRoot, { recursive: true, force: true });
});

describe("MH-08 pinned historical fixture replay", () => {
  const lifecycleVersions = ["1.0.0", "1.1.0"] as const;

  test.each(lifecycleVersions)(
    "normalized result and ordered launch-receipt sequence match for lifecycle %s",
    (lifecycleVersion) => {
      const oracleEffects = { count: 0 };
      const oracle = executeLauncher(
        path.join(oracleRoot, "scripts", "agent-team-launcher.ts"),
        path.join(oracleRoot, "scripts"),
        lifecycleVersion,
        oracleEffects
      );
      const historicalBytesBefore = Buffer.from(oracle.raw);
      const currentEffects = { count: 0 };
      const current = executeLauncher(
        CURRENT_LAUNCHER,
        SCRIPTS,
        lifecycleVersion,
        currentEffects
      );

      expect(normalize(current.receipt)).toEqual(normalize(oracle.receipt));
      expect(orderedReceiptSequence(current.receipt)).toEqual(
        orderedReceiptSequence(oracle.receipt)
      );
      expect(current.raw).toEqual(oracle.raw);
      expect(oracle.raw).toEqual(historicalBytesBefore);
      expect(oracleEffects.count).toBe(1);
      expect(currentEffects.count).toBe(1);
    }
  );

  test.each(lifecycleVersions.flatMap((version) =>
    (["gate-off", "shadow/replay", "gate-on/current", "rollback"] as const).map(
      (mode) => [version, mode] as const
    )
  ))(
    "mode %s / %s applies the current launch effect exactly once",
    (lifecycleVersion, mode) => {
      const oracle = executeLauncher(
        path.join(oracleRoot, "scripts", "agent-team-launcher.ts"),
        path.join(oracleRoot, "scripts"),
        lifecycleVersion,
        { count: 0 }
      );
      const result = replayMode(mode, lifecycleVersion, oracle);
      expect(result.effects).toBe(1);
      expect(result.current.receipt.ok).toBe(true);
      expect(result.comparison).toBe(
        mode === "shadow/replay" || mode === "gate-on/current"
          ? "equivalent"
          : "disabled"
      );
    }
  );

  it("has discriminating controls for normalized output and receipt order", () => {
    const foreignCommit = createForeignCommitObject();
    expect(descendsFromCurrentBase(CURRENT_BASE)).toBe(true);
    expect(descendsFromCurrentBase(SEEDED_DESCENDANT)).toBe(true);
    expect(descendsFromCurrentBase(foreignCommit)).toBe(false);

    const oracle = executeLauncher(
      path.join(oracleRoot, "scripts", "agent-team-launcher.ts"),
      path.join(oracleRoot, "scripts"),
      "1.0.0",
      { count: 0 }
    );
    const changed = structuredClone(oracle.receipt);
    changed.ok = false;
    expect(normalize(changed)).not.toEqual(normalize(oracle.receipt));

    const reordered = structuredClone(oracle.receipt);
    reordered.notes = ["injected receipt-order control", ...reordered.notes];
    expect(orderedReceiptSequence(reordered)).not.toEqual(
      orderedReceiptSequence(oracle.receipt)
    );
  });

  it("explicitly degrades unsupported claude-code-cli host-event coverage", () => {
    const unsupported = {
      schema_version: "guild.mh08_host_event_coverage.v1",
      host_id: "claude-code-cli",
      event: "package.update",
      disposition: "degraded",
      reason_code: "capability_absent",
      detail:
        "in-process agent-team launch has no package.update event surface; no lifecycle effect was attempted",
      lifecycle_effect_count: 0,
    } as const;
    expect(unsupported.disposition).toBe("degraded");
    expect(unsupported.reason_code).toBe("capability_absent");
    expect(unsupported.lifecycle_effect_count).toBe(0);
  });

  it("refuses a foreign execution contract version without fallback or launch", () => {
    const adapters = path.join(
      REPO,
      "src/modules/dispatch/workflows/execution-transport-adapters.ts"
    );
    const probe = [
      `import { createHostExecutionRuntime } from ${JSON.stringify(adapters)};`,
      "let effects = 0;",
      "const port = {",
      ' schema_version: "guild.execution.transports.v1", contract_version: 2,',
      ' transport_id: "in-process",',
      " supports: () => true,",
      " spawn: () => { effects += 1; throw new Error('must not spawn'); },",
      " send: () => { effects += 1; throw new Error('must not send'); },",
      " wait: () => { effects += 1; throw new Error('must not wait'); },",
      " terminate: () => { effects += 1; throw new Error('must not terminate'); },",
      "};",
      'const result = createHostExecutionRuntime({ transports: { "in-process": port as any } }).transportFor("in-process");',
      "process.stdout.write(JSON.stringify({ status: result.status, reason_code: result.reason_code, value: result.value, effects }));",
    ].join("\n");
    const raw = execFileSync(TSX, ["-e", probe], { cwd: SCRIPTS, encoding: "utf8" });
    expect(JSON.parse(raw)).toEqual({
      status: "unsupported",
      reason_code: "contract_version_unsupported",
      value: null,
      effects: 0,
    });
  });
});
