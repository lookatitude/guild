/**
 * #221: a shipped-agent lane on a fresh init (no adoption manifest) gets a
 * synthesized `plugin-shipped` definition ref, so its context bundle passes
 * lint-context-bundle. Project lanes and the linter stay strict.
 */
import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { validateProjectDefinitionRefV1 } from "../core/contracts/project-definition-ref";
import { lintBundle } from "../../lint-context-bundle";
import { definitionRefForDispatch } from "./definition-ref-for-dispatch";
import { main } from "../../definition-ref-for-dispatch";
import { inlineSpecialistIdentity } from "./inline-specialist-identity";

const pluginRoot = resolve(__dirname, "../../..");
const digest = (b: Buffer) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

function bundleWith(refLine: string | null): string {
  return [
    "---",
    "run_id: run-x",
    "specialist: developer",
    "task_id: lane-a",
    ...(refLine === null ? [] : [refLine]),
    "---",
    "",
    "## Universal",
    "body",
    "",
  ].join("\n");
}

describe("#221 shipped-agent definition ref", () => {
  it("fresh repo: shipped developer resolves a plugin-shipped ref that passes bundle lint", () => {
    const root = mkdtempSync(join(tmpdir(), "guild-221-"));
    try {
      const r = definitionRefForDispatch(
        root,
        { name: "developer", definition: "agents/developer.md", definition_source: "shipped" },
        { pluginRoot },
      );
      expect(r.status).toBe("resolved");
      if (r.status !== "resolved") return;
      expect(validateProjectDefinitionRefV1(r.ref)).toEqual(r.ref);
      expect(r.ref.layer).toBe("plugin-shipped");
      expect(r.ref.id).toBe("developer");
      expect(r.ref.relative_path).toBe("agents/developer.md");
      expect(r.ref.content_hash).toBe(digest(readFileSync(join(pluginRoot, "agents/developer.md"))));
      // Deterministic: same bytes, same ref.
      const again = definitionRefForDispatch(
        root,
        { name: "developer", definition: "agents/developer.md", definition_source: "shipped" },
        { pluginRoot },
      );
      expect(again).toEqual(r);
      const verdict = lintBundle(bundleWith(`definition_ref: ${JSON.stringify(r.ref)}`));
      expect(verdict.reasons).toEqual([]);
      expect(verdict.pass).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("linter is not relaxed: a bundle with no ref still fails", () => {
    expect(lintBundle(bundleWith(null)).pass).toBe(false);
  });

  it("project lanes on a fresh repo stay capability_absent", () => {
    const root = mkdtempSync(join(tmpdir(), "guild-221-"));
    try {
      const r = definitionRefForDispatch(root, { name: "architect", definition: ".guild/agents/architect.md" });
      expect(r.status).toBe("capability_absent");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shipped path must be the role-matched agents/<name>.md", () => {
    const root = mkdtempSync(join(tmpdir(), "guild-221-"));
    try {
      for (const definition of ["agents/advisor.md", "../agents/developer.md", "/abs/agents/developer.md", "templates/specialists/developer.md"]) {
        const r = definitionRefForDispatch(root, { name: "developer", definition, definition_source: "shipped" }, { pluginRoot });
        expect(r.status).toBe("invalid_request");
      }
      const missing = definitionRefForDispatch(
        root,
        { name: "no-such-agent", definition: "agents/no-such-agent.md", definition_source: "shipped" },
        { pluginRoot },
      );
      expect(missing.status).toBe("capability_absent");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("CLI --source shipped resolves on a fresh repo", () => {
    const root = mkdtempSync(join(tmpdir(), "guild-221-"));
    const prev = process.env.GUILD_PLUGIN_ROOT;
    process.env.GUILD_PLUGIN_ROOT = pluginRoot;
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as { write: unknown }).write = (s: string) => (writes.push(s), true);
    try {
      const code = main(["--cwd", root, "--name", "developer", "--definition", "agents/developer.md", "--source", "shipped"]);
      expect(code).toBe(0);
      expect(JSON.parse(writes.join("")).ref.layer).toBe("plugin-shipped");
    } finally {
      (process.stdout as { write: unknown }).write = orig;
      if (prev === undefined) delete process.env.GUILD_PLUGIN_ROOT;
      else process.env.GUILD_PLUGIN_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("#221 codex round 1", () => {
  it("F1: ref hashes equal the launcher's inline identity for the same lane", () => {
    const root = mkdtempSync(join(tmpdir(), "guild-221-"));
    try {
      const bytes = readFileSync(join(pluginRoot, "agents/developer.md"));
      for (const lane of [
        { name: "developer", definition: "agents/developer.md", definition_source: "shipped", default_tier: "mid" },
        { name: "developer", definition: "agents/developer.md", definition_source: "shipped", default_tier: "mid", tier: "powerful", capability_scope: ["fs.read"] },
      ]) {
        const r = definitionRefForDispatch(root, lane, { pluginRoot });
        if (r.status !== "resolved") throw new Error(r.detail);
        const id = inlineSpecialistIdentity(lane, bytes, [], null);
        expect(r.ref.specialist_type_hash).toBe(id.typeHash);
        expect(r.ref.specialist_profile_hash).toBe(id.profileHash);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("F3: a symlinked ancestor that leaves the plugin tree is refused", () => {
    const fake = mkdtempSync(join(tmpdir(), "guild-221-plugin-"));
    const outside = mkdtempSync(join(tmpdir(), "guild-221-out-"));
    try {
      writeFileSync(join(outside, "developer.md"), "---\nname: developer\nmodel: sonnet\n---\nevil\n");
      symlinkSync(outside, join(fake, "agents"));
      const r = definitionRefForDispatch(
        fake,
        { name: "developer", definition: "agents/developer.md", definition_source: "shipped" },
        { pluginRoot: fake },
      );
      expect(r.status).toBe("invalid_request");
    } finally {
      rmSync(fake, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("#221 codex round 2", () => {
  it("F1: with no tier fields, every shipped machinery agent matches the launcher fallback", () => {
    const root = mkdtempSync(join(tmpdir(), "guild-221-"));
    try {
      for (const name of ["advisor", "context-manager", "developer"]) {
        const lane = { name, definition: `agents/${name}.md`, definition_source: "shipped" };
        const r = definitionRefForDispatch(root, lane, { pluginRoot });
        if (r.status !== "resolved") throw new Error(r.detail);
        const id = inlineSpecialistIdentity(lane, readFileSync(join(pluginRoot, lane.definition)), [], null);
        expect(r.ref.specialist_type_hash).toBe(id.typeHash);
        expect(r.ref.specialist_profile_hash).toBe(id.profileHash);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
