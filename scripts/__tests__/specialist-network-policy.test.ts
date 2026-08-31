import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parseFrontmatter } from "../lib/frontmatter";
import { CANONICAL_ROLE_CAPABILITY_SCOPES } from "../lib/core/contracts/team-backend";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const NETWORK_TOOLS = new Set(["WebFetch", "WebSearch"]);
const RESEARCHER_TEMPLATE = path.join("templates", "specialists", "researcher.md");

interface SpecialistDefinition {
  readonly file: string;
  readonly name: string;
  readonly tools: readonly string[];
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readShippedDefinitions(pluginRoot: string = PLUGIN_ROOT): SpecialistDefinition[] {
  const surfaces = ["agents", path.join("templates", "specialists")];
  const definitions: SpecialistDefinition[] = [];
  for (const surface of surfaces) {
    const directory = path.join(pluginRoot, surface);
    for (const file of fs.readdirSync(directory).filter((entry) => entry.endsWith(".md")).sort()) {
      const relative = path.join(surface, file);
      const frontmatter = parseFrontmatter(fs.readFileSync(path.join(pluginRoot, relative), "utf8"));
      if (frontmatter === null) {
        throw new Error(`unparseable specialist frontmatter: ${relative}`);
      }
      if (!Object.prototype.hasOwnProperty.call(frontmatter, "tools")) {
        throw new Error(`specialist has no explicit tools boundary: ${relative}`);
      }
      const tools = stringList(frontmatter["tools"]);
      if (tools.length === 0) {
        throw new Error(`specialist has an empty or malformed tools boundary: ${relative}`);
      }
      definitions.push({
        file: relative,
        name: String(frontmatter["name"] ?? file.replace(/\.md$/, "")),
        tools,
      });
    }
  }
  return definitions;
}

function unapprovedNetworkDefaults(definitions: readonly SpecialistDefinition[]): string[] {
  return definitions
    .filter(
      (definition) =>
        definition.file !== RESEARCHER_TEMPLATE &&
        definition.tools.some((tool) => NETWORK_TOOLS.has(tool))
    )
    .map((definition) => definition.file)
    .sort();
}

function networkScopeDefaultRows(markdown: string): string[] {
  const section = markdown.match(/## Capability scope defaults([\s\S]*?)Self-build dev-team lanes/);
  if (section === null) throw new Error("team-compose capability-scope section is missing");
  return section[1]
    .split("\n")
    .filter((line) => /^\| `/.test(line) && /WebFetch|WebSearch/.test(line))
    .map((line) => line.split("|")[1].trim());
}

describe("specialist default network policy", () => {
  it("permits network-capable tools only on the researcher default", () => {
    expect(unapprovedNetworkDefaults(readShippedDefinitions())).toEqual([]);
  });

  it("planted on-disk control rejects an SEO template spoofing the researcher name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-network-policy-"));
    try {
      fs.mkdirSync(path.join(root, "agents"), { recursive: true });
      fs.mkdirSync(path.join(root, "templates", "specialists"), { recursive: true });
      fs.writeFileSync(
        path.join(root, RESEARCHER_TEMPLATE),
        "---\nname: seo\ntools: [WebFetch]\n---\n"
      );
      fs.writeFileSync(
        path.join(root, "templates", "specialists", "seo.md"),
        "---\nname: researcher\ntools: [Read, WebSearch]\n---\n"
      );
      expect(unapprovedNetworkDefaults(readShippedDefinitions(root))).toEqual([
        path.join("templates", "specialists", "seo.md"),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when a shipped definition omits its tools boundary", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-network-policy-"));
    try {
      fs.mkdirSync(path.join(root, "agents"), { recursive: true });
      fs.mkdirSync(path.join(root, "templates", "specialists"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "templates", "specialists", "seo.md"),
        "---\nname: seo\n---\n"
      );
      expect(() => readShippedDefinitions(root)).toThrow(
        "specialist has no explicit tools boundary: templates/specialists/seo.md"
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("pins team-compose defaults and worked examples to the same policy", () => {
    const teamCompose = fs.readFileSync(path.join(PLUGIN_ROOT, "skills", "meta", "team-compose", "SKILL.md"), "utf8");
    const gapHandling = fs.readFileSync(
      path.join(PLUGIN_ROOT, "skills", "meta", "team-compose", "gap-handling.md"),
      "utf8"
    );
    expect(networkScopeDefaultRows(teamCompose)).toEqual(["`researcher`"]);
    expect(gapHandling).not.toMatch(/WebFetch|WebSearch/);

    const planted = "## Capability scope defaults\n| Role group | Default |\n|---|---|\n| `seo` | `[\\\"WebFetch\\\"]` |\nSelf-build dev-team lanes";
    expect(networkScopeDefaultRows(planted)).toEqual(["`seo`"]);
  });

  it("pins the runtime-materialized canonical scopes to the same researcher-only native-web default", () => {
    expect(Object.keys(CANONICAL_ROLE_CAPABILITY_SCOPES)).toHaveLength(15);
    expect(
      Object.entries(CANONICAL_ROLE_CAPABILITY_SCOPES)
        .filter(([, tools]) => tools.some((tool) => NETWORK_TOOLS.has(tool)))
        .map(([role]) => role)
    ).toEqual(["researcher"]);

    const securityPolicy = fs.readFileSync(path.join(PLUGIN_ROOT, "SECURITY.md"), "utf8");
    expect(securityPolicy).toContain("No host-native web tool is granted by default outside the `researcher` role");
    expect(securityPolicy).not.toContain("No network access is made by default");
  });
});
