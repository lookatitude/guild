/**
 * tests/workspace/detection-matrix.test.ts
 *
 * Cross-cutting deliverable 1 — DETECTION MATRIX (SC-1, SC-5, spec §1).
 *
 * Drives scripts/workspace/detect.ts END-TO-END as a subprocess over synthetic
 * mkdtemp fixture trees. Distinct layer from Lane B's in-process unit tests.
 *
 * Matrix rows asserted:
 *   - regular repo (no qualifying children)            → kind=regular, 0 subs
 *   - workspace-by-.git (child has .git, no .guild)    → kind=workspace, sub-project
 *   - workspace-by-.guild (child has .guild)           → kind=workspace, sub-guild
 *   - mixed (.git child + .guild child + plain dir)    → both detected, plain ignored
 *   - plain-dirs-ignored (docs/-only child)            → kind=regular, 0 subs
 *   - mode: on forces workspace                        → kind=workspace even with no subs
 *   - mode: off forces regular                         → kind=regular even with subs
 *   - settings.json workspace.mode honored (no flag)   → on/off via settings
 *   - depth-1 invariant: detection.depth === 1 ALWAYS
 *   - NO recursion: a depth-2 nested repo is NOT detected
 *
 * Spec anchors: §1 "Detect repo kind"; D-OQ1 depth-1-hard; risk
 * "false-positive workspace detection" mitigated by mode override.
 */

import {
  DETECT,
  runScript,
  parseJsonStdout,
  makeTempRoot,
  rmTree,
  plantSubProject,
  plantSubGuild,
  plantPlainDir,
  plantNestedDepth2,
  writeSettings,
} from "./_fixtures";

interface DetectOut {
  kind: "regular" | "workspace";
  detection: { depth: number; rule: string; mode: "auto" | "on" | "off" };
  sub_guilds: Array<{
    name: string;
    path: string;
    kind: "sub-guild" | "sub-project";
    has_wiki: boolean;
    has_indexes: boolean;
  }>;
}

function detect(root: string, mode?: "auto" | "on" | "off"): DetectOut {
  const args = ["--cwd", root];
  if (mode) args.push("--mode", mode);
  const res = runScript(DETECT, args);
  expect(res.exitCode).toBe(0);
  return parseJsonStdout<DetectOut>(res, "detect.ts");
}

const names = (o: DetectOut) => o.sub_guilds.map((s) => s.name).sort();

describe("detection matrix (e2e via detect.ts)", () => {
  let root: string;
  afterEach(() => {
    if (root) rmTree(root);
  });

  test("regular repo: no qualifying children → kind=regular, 0 sub_guilds", () => {
    root = makeTempRoot();
    plantPlainDir(root, "src");
    plantPlainDir(root, "node_modules");
    const out = detect(root);
    expect(out.kind).toBe("regular");
    expect(out.sub_guilds).toEqual([]);
    expect(out.detection.depth).toBe(1);
  });

  test("workspace-by-.git: child with .git only → workspace, kind=sub-project", () => {
    root = makeTempRoot();
    plantSubProject(root, "svc-api");
    const out = detect(root);
    expect(out.kind).toBe("workspace");
    expect(names(out)).toEqual(["svc-api"]);
    const sub = out.sub_guilds[0];
    expect(sub.kind).toBe("sub-project");
    expect(sub.has_wiki).toBe(false);
    expect(sub.path).toBe("svc-api"); // depth-1 → path === name
  });

  test("workspace-by-.guild: child with .guild → workspace, kind=sub-guild", () => {
    root = makeTempRoot();
    plantSubGuild(root, "lib-core", { wiki: true, indexes: true });
    const out = detect(root);
    expect(out.kind).toBe("workspace");
    expect(names(out)).toEqual(["lib-core"]);
    const sub = out.sub_guilds[0];
    expect(sub.kind).toBe("sub-guild");
    expect(sub.has_wiki).toBe(true);
    expect(sub.has_indexes).toBe(true);
  });

  test("mixed: .git child + .guild child detected, plain docs/ ignored", () => {
    root = makeTempRoot();
    plantSubProject(root, "svc-api"); // .git only
    plantSubGuild(root, "lib-core", { wiki: true }); // .guild
    plantPlainDir(root, "docs"); // neither → ignored
    const out = detect(root);
    expect(out.kind).toBe("workspace");
    expect(names(out)).toEqual(["lib-core", "svc-api"]);
    expect(names(out)).not.toContain("docs");
    const byName = Object.fromEntries(out.sub_guilds.map((s) => [s.name, s]));
    expect(byName["svc-api"].kind).toBe("sub-project");
    expect(byName["lib-core"].kind).toBe("sub-guild");
  });

  test("plain-dirs-ignored: a docs/-only child does NOT make a workspace", () => {
    root = makeTempRoot();
    plantPlainDir(root, "docs");
    const out = detect(root);
    expect(out.kind).toBe("regular");
    expect(out.sub_guilds).toEqual([]);
  });

  test("mode: on forces workspace even when no children qualify", () => {
    root = makeTempRoot();
    plantPlainDir(root, "docs"); // would be regular under auto
    const auto = detect(root, "auto");
    expect(auto.kind).toBe("regular");
    const on = detect(root, "on");
    expect(on.kind).toBe("workspace");
    expect(on.detection.mode).toBe("on");
  });

  test("mode: off forces regular even when children qualify (rollback path)", () => {
    root = makeTempRoot();
    plantSubGuild(root, "lib-core", { wiki: true });
    plantSubProject(root, "svc-api");
    const auto = detect(root, "auto");
    expect(auto.kind).toBe("workspace");
    const off = detect(root, "off");
    expect(off.kind).toBe("regular");
    expect(off.detection.mode).toBe("off");
    // force-regular suppresses the sub_guilds projection
    expect(off.sub_guilds).toEqual([]);
  });

  test("settings.json workspace.mode honored when no --mode flag is passed", () => {
    root = makeTempRoot();
    plantSubGuild(root, "lib-core", { wiki: true }); // qualifies under auto
    // settings forces OFF → regular without any CLI flag
    writeSettings(root, { workspace: { mode: "off" } });
    const fromSettings = detect(root); // no --mode
    expect(fromSettings.kind).toBe("regular");
    expect(fromSettings.detection.mode).toBe("off");
  });

  test("CLI --mode overrides settings.json workspace.mode", () => {
    root = makeTempRoot();
    plantSubGuild(root, "lib-core", { wiki: true });
    writeSettings(root, { workspace: { mode: "off" } });
    // CLI on must win over settings off
    const out = detect(root, "on");
    expect(out.kind).toBe("workspace");
    expect(out.detection.mode).toBe("on");
  });

  test("detection.depth === 1 ALWAYS (regular, workspace, on, off)", () => {
    root = makeTempRoot();
    plantSubGuild(root, "lib-core", { wiki: true });
    for (const m of ["auto", "on", "off"] as const) {
      expect(detect(root, m).detection.depth).toBe(1);
    }
  });

  test("NO recursion: a depth-2 nested repo is NOT detected (D-OQ1 hard)", () => {
    root = makeTempRoot();
    const { outer, inner } = plantNestedDepth2(root, "outer", "inner");
    const out = detect(root);
    expect(out.kind).toBe("workspace");
    // only the immediate child is detected; the nested inner repo is invisible
    expect(names(out)).toEqual([outer]);
    expect(names(out)).not.toContain(inner);
    expect(out.sub_guilds).toHaveLength(1);
    expect(out.detection.depth).toBe(1);
  });

  test("the detection rule string documents the depth-1 .git OR .guild rule", () => {
    root = makeTempRoot();
    plantSubProject(root, "svc-api");
    const out = detect(root);
    expect(out.detection.rule).toMatch(/\.git/);
    expect(out.detection.rule).toMatch(/\.guild/);
    expect(out.detection.rule.toLowerCase()).toContain("immediate child");
  });
});
