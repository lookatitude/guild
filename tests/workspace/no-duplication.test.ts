/**
 * tests/workspace/no-duplication.test.ts
 *
 * Cross-cutting deliverable 4 — NO-DUPLICATION REGRESSION (SC-3, RELEASE-BLOCKING).
 *
 * The whole point of federation is "query, don't duplicate." This suite is the
 * release gate that catches any regression where workspace tooling copies a
 * sub-guild's wiki pages up into the workspace .guild/, or where the read-only
 * recall helper writes anything at all.
 *
 * Asserts:
 *   - write-manifest.ts creates NO .guild/wiki/** at the workspace root
 *   - the workspace .guild/ contains ONLY workspace.json (+ any pre-existing
 *     unrelated state), never a copy of a sub-guild's page
 *   - the sub-guild's own wiki + its sentinel page are left byte-identical
 *     (read-only on sub-guilds — boundary DH-3 / CR-D)
 *   - no SUBGUILD-SENTINEL marker leaks into the workspace tree
 *   - federated-query.ts writes ZERO files anywhere (full-tree snapshot diff)
 *   - re-running write-manifest does not clobber unrelated workspace .guild/ state
 *
 * Spec anchors: SC-3 (no duplication), SC-6 (sub-guild independence preserved),
 * Constraints "all writes land under the workspace's .guild/; never writes into
 * a sub-guild's .guild/ … read-only on sub-guilds."
 */

import * as fs from "fs";
import * as path from "path";
import {
  WRITE_MANIFEST,
  FEDERATED_QUERY,
  runScript,
  makeTempRoot,
  rmTree,
  plantSubGuild,
  plantSubProject,
  walkFiles,
} from "./_fixtures";

const SENTINEL = "SUBGUILD-SENTINEL";

/** All files under <root>/.guild/wiki (the forbidden copy-up target). Empty = good. */
function workspaceWikiFiles(root: string): string[] {
  const wikiDir = path.join(root, ".guild", "wiki");
  if (!fs.existsSync(wikiDir)) return [];
  return walkFiles(wikiDir);
}

/** Search the whole workspace .guild/ for any file carrying the sub-guild sentinel. */
function sentinelLeaksInWorkspaceGuild(root: string): string[] {
  const guildDir = path.join(root, ".guild");
  const leaks: string[] = [];
  for (const rel of walkFiles(guildDir)) {
    const full = path.join(guildDir, rel);
    try {
      if (fs.readFileSync(full, "utf8").includes(SENTINEL)) leaks.push(rel);
    } catch {
      // binary / unreadable — ignore
    }
  }
  return leaks;
}

describe("no-duplication regression (SC-3, release-blocking)", () => {
  let root: string;
  afterEach(() => {
    if (root) rmTree(root);
  });

  test("write-manifest creates NO .guild/wiki/** at the workspace root", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true, indexes: true });
    plantSubGuild(root, "tools", { wiki: true });

    const res = runScript(WRITE_MANIFEST, ["--cwd", root]);
    expect(res.exitCode).toBe(0);

    expect(workspaceWikiFiles(root)).toEqual([]);
    expect(fs.existsSync(path.join(root, ".guild", "wiki"))).toBe(false);
  });

  test("workspace .guild/ holds only workspace.json — no copied sub-guild page", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    plantSubGuild(root, "tools", { wiki: true });

    runScript(WRITE_MANIFEST, ["--cwd", root]);

    const guildFiles = walkFiles(path.join(root, ".guild"));
    expect(guildFiles).toEqual(["workspace.json"]);
  });

  test("no SUBGUILD-SENTINEL marker leaks into the workspace .guild/", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    plantSubGuild(root, "tools", { wiki: true });

    runScript(WRITE_MANIFEST, ["--cwd", root]);

    expect(sentinelLeaksInWorkspaceGuild(root)).toEqual([]);
  });

  test("sub-guild wiki pages are left byte-identical (read-only on sub-guilds)", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    plantSubGuild(root, "tools", { wiki: true });

    const pluginPage = path.join(root, "plugin", ".guild", "wiki", "page.md");
    const toolsPage = path.join(root, "tools", ".guild", "wiki", "page.md");
    const beforePlugin = fs.readFileSync(pluginPage, "utf8");
    const beforeTools = fs.readFileSync(toolsPage, "utf8");

    runScript(WRITE_MANIFEST, ["--cwd", root]);

    expect(fs.readFileSync(pluginPage, "utf8")).toBe(beforePlugin);
    expect(fs.readFileSync(toolsPage, "utf8")).toBe(beforeTools);
  });

  test("write-manifest does not add/remove files inside any sub-guild .guild/", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true, indexes: true });

    const subGuildDir = path.join(root, "plugin", ".guild");
    const before = walkFiles(subGuildDir);

    runScript(WRITE_MANIFEST, ["--cwd", root]);

    const after = walkFiles(subGuildDir);
    expect(after).toEqual(before);
  });

  test("federated-query writes ZERO files anywhere (full-tree snapshot diff)", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    plantSubGuild(root, "tools", { wiki: true });
    runScript(WRITE_MANIFEST, ["--cwd", root]);

    const before = walkFiles(root);
    const res = runScript(FEDERATED_QUERY, ["--cwd", root, "--query", "auth flow"]);
    expect(res.exitCode).toBe(0);
    const after = walkFiles(root);

    // read-only recall helper: the on-disk tree is unchanged
    expect(after).toEqual(before);
  });

  test("federated-query --scope also writes nothing", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    plantSubGuild(root, "tools", { wiki: true });
    runScript(WRITE_MANIFEST, ["--cwd", root]);

    const before = walkFiles(root);
    runScript(FEDERATED_QUERY, ["--cwd", root, "--query", "q", "--scope", "plugin"]);
    expect(walkFiles(root)).toEqual(before);
  });

  test("re-running write-manifest is idempotent + preserves unrelated .guild/ state", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });

    // pre-existing unrelated workspace state under .guild/ (e.g. runs/ + settings)
    const runsDir = path.join(root, ".guild", "runs", "run-keepme");
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, "events.ndjson"), "KEEP-ME\n", "utf8");
    fs.writeFileSync(
      path.join(root, ".guild", "settings.json"),
      JSON.stringify({ workspace: { mode: "auto" } }, null, 2),
      "utf8"
    );

    runScript(WRITE_MANIFEST, ["--cwd", root]);
    const firstManifest = fs.readFileSync(
      path.join(root, ".guild", "workspace.json"),
      "utf8"
    );
    runScript(WRITE_MANIFEST, ["--cwd", root]);

    // unrelated state survives both runs
    expect(fs.readFileSync(path.join(runsDir, "events.ndjson"), "utf8")).toBe("KEEP-ME\n");
    expect(fs.existsSync(path.join(root, ".guild", "settings.json"))).toBe(true);
    // sub_guilds projection is stable across re-runs (idempotent shape)
    const secondManifest = JSON.parse(
      fs.readFileSync(path.join(root, ".guild", "workspace.json"), "utf8")
    );
    const firstParsed = JSON.parse(firstManifest);
    expect(secondManifest.sub_guilds).toEqual(firstParsed.sub_guilds);
    expect(secondManifest.is_workspace).toBe(firstParsed.is_workspace);
    expect(secondManifest.schema_version).toBe(firstParsed.schema_version);

    // and STILL no wiki copy-up
    expect(workspaceWikiFiles(root)).toEqual([]);
  });

  test("a sub-PROJECT (no .guild yet) is registered but its tree is untouched", () => {
    root = makeTempRoot();
    plantSubProject(root, "svc-api"); // .git only
    plantSubGuild(root, "plugin", { wiki: true });

    const svcBefore = walkFiles(path.join(root, "svc-api"));
    runScript(WRITE_MANIFEST, ["--cwd", root]);
    const svcAfter = walkFiles(path.join(root, "svc-api"));

    expect(svcAfter).toEqual(svcBefore);
    // no .guild/ was created inside the sub-project by the workspace tooling
    expect(fs.existsSync(path.join(root, "svc-api", ".guild"))).toBe(false);
  });
});
