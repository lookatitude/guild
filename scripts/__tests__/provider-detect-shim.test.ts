import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/provider-detect";
import type { ProbeEnv } from "../lib/provider-detect";
import * as moduleImpl from "../../src/modules/host-runtime/workflows/provider-detect";

const CWD = "/tmp/guild-provider-detect-shim";

function makeProbe(opts: {
  codexPlugin?: boolean;
  codexCli?: boolean;
  storedAuth?: boolean;
  openaiKey?: boolean;
  manifests?: string[];
} = {}): ProbeEnv {
  return {
    commandOnPath: (bin) => (bin === "codex" ? !!opts.codexCli : false),
    probeVersion: (bin) => (bin === "codex" ? !!opts.codexCli : false),
    readStoredCodexAuth: () => !!opts.storedAuth,
    readEnv: (name) => (name === "OPENAI_API_KEY" && opts.openaiKey ? "sk-test" : undefined),
    readCapabilityProviders: () => opts.manifests ?? [],
    readPluginAdapter: (id) => id === "codex-plugin" && !!opts.codexPlugin,
  };
}

describe("provider-detect compatibility shim", () => {
  test("scripts/lib/provider-detect re-exports src/modules/host-runtime", () => {
    expect(shim.detectProviders).toBe(moduleImpl.detectProviders);
    expect(shim.recommendProvider).toBe(moduleImpl.recommendProvider);
    expect(shim.selectReviewer).toBe(moduleImpl.selectReviewer);
    expect(shim.resolveAuthorHost).toBe(moduleImpl.resolveAuthorHost);
    expect(shim.defaultProbeEnv).toBe(moduleImpl.defaultProbeEnv);
  });

  test("preserves cross-review selection behavior through the shim", () => {
    const detection = shim.detectProviders({
      cwd: CWD,
      host: "claude",
      probe: makeProbe({ codexPlugin: true, codexCli: true, storedAuth: true }),
    });

    expect(shim.recommendProvider(detection, { mode: "cross", provider: "auto" }).recommended).toBe("codex-plugin");
    expect(shim.selectReviewer(detection, { mode: "cross", provider: "auto" })).toMatchObject({
      provider: "codex-plugin",
      status: "selected",
    });

    const sameFamily = shim.detectProviders({
      cwd: CWD,
      host: "codex",
      probe: makeProbe({ codexPlugin: true, codexCli: true, storedAuth: true }),
    });
    expect(
      shim.selectReviewer(sameFamily, { mode: "cross", provider: "codex-plugin" })
    ).toMatchObject({
      provider: null,
      status: "skipped",
    });
  });

  test("only the module file defines provider detection", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/provider-detect.ts"), "utf8");
    const modulePath = fs.readFileSync(
      path.join(repoRoot, "src/modules/host-runtime/workflows/provider-detect.ts"),
      "utf8"
    );

    expect(oldPath).toMatch(
      /export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/host-runtime\/workflows\/provider-detect["']/
    );
    expect(oldPath).not.toMatch(/export\s+function\s+detectProviders/);
    expect(modulePath).toMatch(/export\s+function\s+detectProviders/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-registry["']/);
  });
});
