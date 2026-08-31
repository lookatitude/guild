import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveDefinitionArtifact } from "../lib/definition-artifact-resolver";

const hash = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

describe("definition artifact resolver", () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "guild-definition-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Guild Test"], { cwd: root });
    mkdirSync(join(root, ".guild/agents"), { recursive: true });
    mkdirSync(join(root, ".guild/skills/review"), { recursive: true });
    writeFileSync(join(root, ".guild/agents/architect.md"), "architect bytes\n");
    writeFileSync(join(root, ".guild/skills/review/SKILL.md"), "skill bytes\n");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const locator = {
      relative_path: ".guild/agents/architect.md",
      content_hash: hash("architect bytes\n"),
      source_commit: commit,
      skills: [{ id: "review", relative_path: ".guild/skills/review/SKILL.md", content_hash: hash("skill bytes\n") }],
    };
    return { root, locator };
  }

  it("returns exact verified definition and skill bytes", () => {
    const f = fixture();
    try {
      const result = resolveDefinitionArtifact(f.root, f.locator);
      expect(result.status).toBe("resolved");
      if (result.status === "resolved") {
        expect(result.definition.toString()).toBe("architect bytes\n");
        expect(result.skills.get("review")?.toString()).toBe("skill bytes\n");
      }
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it.each(["/tmp/architect.md", "../architect.md", ".guild/../architect.md"])("rejects unsafe path %s", (relative_path) => {
    const f = fixture();
    try { expect(resolveDefinitionArtifact(f.root, { ...f.locator, relative_path }).status).toBe("invalid_request"); }
    finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("rejects a symlinked artifact even when its target is inside the root", () => {
    const f = fixture();
    try {
      symlinkSync("architect.md", join(f.root, ".guild/agents/link.md"));
      expect(resolveDefinitionArtifact(f.root, { ...f.locator, relative_path: ".guild/agents/link.md" }).status).toBe("invalid_request");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("rejects live bytes that drift from the pinned hash", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.root, ".guild/agents/architect.md"), "tampered\n");
      expect(resolveDefinitionArtifact(f.root, f.locator).status).toBe("invalid_request");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("rejects a matching live hash when bytes differ from source_commit", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.root, ".guild/agents/architect.md"), "new bytes\n");
      expect(resolveDefinitionArtifact(f.root, { ...f.locator, content_hash: hash("new bytes\n") }).status).toBe("invalid_request");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});
