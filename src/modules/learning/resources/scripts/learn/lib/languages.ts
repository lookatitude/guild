/**
 * learn/lib/languages.ts — deterministic language + framework detection.
 */

import * as path from "path";

const EXT_LANG: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust",
  ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".swift": "swift",
  ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".hpp": "cpp",
  ".cs": "csharp", ".php": "php", ".scala": "scala", ".clj": "clojure",
  ".ex": "elixir", ".exs": "elixir", ".dart": "dart", ".sh": "shell", ".bash": "shell",
  ".sql": "sql", ".graphql": "graphql", ".gql": "graphql", ".proto": "protobuf",
  ".tf": "terraform", ".yaml": "yaml", ".yml": "yaml", ".json": "json",
  ".md": "markdown", ".mdx": "markdown", ".toml": "toml", ".html": "html",
  ".css": "css", ".scss": "scss", ".vue": "vue", ".svelte": "svelte",
};

const BASENAME_LANG: Record<string, string> = {
  Dockerfile: "dockerfile",
  Makefile: "makefile",
  ".gitignore": "config",
};

export function detectLanguage(filePath: string): string {
  const base = path.basename(filePath);
  if (BASENAME_LANG[base]) return BASENAME_LANG[base];
  const ext = path.extname(filePath).toLowerCase();
  return EXT_LANG[ext] ?? "unknown";
}

/** True for languages whose structure we extract deterministically. */
export function isCodeLanguage(lang: string): boolean {
  return [
    "typescript", "javascript", "python", "ruby", "go", "rust", "java",
    "kotlin", "swift", "c", "cpp", "csharp", "php", "scala", "dart",
  ].includes(lang);
}

interface FrameworkSig {
  name: string;
  files?: string[];
  depKeys?: string[];
}

const FRAMEWORK_SIGS: FrameworkSig[] = [
  { name: "next.js", depKeys: ["next"] },
  { name: "react", depKeys: ["react"] },
  { name: "vue", depKeys: ["vue"] },
  { name: "svelte", depKeys: ["svelte"] },
  { name: "angular", depKeys: ["@angular/core"] },
  { name: "express", depKeys: ["express"] },
  { name: "nestjs", depKeys: ["@nestjs/core"] },
  { name: "fastify", depKeys: ["fastify"] },
  { name: "jest", depKeys: ["jest"] },
  { name: "vitest", depKeys: ["vitest"] },
  { name: "django", files: ["manage.py"] },
  { name: "flask", depKeys: ["flask"] },
  { name: "fastapi", depKeys: ["fastapi"] },
  { name: "rails", files: ["config/application.rb"] },
  { name: "spring", files: ["pom.xml", "build.gradle"] },
  { name: "terraform", files: ["main.tf"] },
  { name: "docker", files: ["Dockerfile", "docker-compose.yml"] },
];

/**
 * Detect frameworks from package.json deps + signature files.
 * `pkgJson` is the parsed package.json (or null); `relFiles` is the file list.
 */
export function detectFrameworks(
  pkgJson: Record<string, unknown> | null,
  relFiles: string[],
): string[] {
  const found = new Set<string>();
  const deps: Record<string, unknown> = {
    ...(pkgJson?.dependencies as object),
    ...(pkgJson?.devDependencies as object),
  };
  const fileSet = new Set(relFiles.map((f) => f.replace(/\\/g, "/")));
  for (const sig of FRAMEWORK_SIGS) {
    if (sig.depKeys?.some((k) => k in deps)) found.add(sig.name);
    if (sig.files?.some((f) => fileSet.has(f) || relFiles.some((r) => r.endsWith("/" + f)))) {
      found.add(sig.name);
    }
  }
  return [...found].sort();
}

const ENTRYPOINT_BASENAMES = new Set([
  "index.ts", "index.js", "main.ts", "main.js", "main.py", "main.go",
  "main.rs", "app.ts", "app.js", "app.py", "server.ts", "server.js",
  "cli.ts", "cli.js", "__main__.py", "Main.java", "Program.cs",
]);

export function isEntrypoint(relPath: string): boolean {
  const base = path.basename(relPath);
  if (ENTRYPOINT_BASENAMES.has(base)) return true;
  // Top-level bin/ scripts or files with a shebang-style name convention.
  return /^bin\//.test(relPath.replace(/\\/g, "/"));
}

/** First path segment as a coarse module label. */
export function moduleOf(relPath: string): string {
  const norm = relPath.replace(/\\/g, "/");
  const dir = path.dirname(norm);
  if (dir === "." || dir === "") return "(root)";
  return dir.split("/")[0];
}
