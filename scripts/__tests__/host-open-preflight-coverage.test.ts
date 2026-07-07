/**
 * scripts/__tests__/host-open-preflight-coverage.test.ts
 *
 * V2 (init-config-goal §V line 257) — EVERY generated host adapter must wire the
 * session-open `preflight(request?: PreflightRequest)` surface (the contract member
 * `HostAdapter.preflight`, mandatory per host-adapter-contract.ts). This is the
 * coverage gate that keeps a future generated adapter from silently shipping
 * without it.
 *
 * Anti-vacuity (mutate-and-confirm) — the gate is proven non-vacuous two ways:
 *   1. Including the broken fixture (fixtures/host-open/no-preflight-host/, which
 *      OMITS the preflight method) makes the SAME check FAIL.
 *   2. Stripping the preflight method out of a REAL adapter's source (in memory)
 *      makes the check FAIL — i.e. it would catch a removed preflight call.
 */
import * as fs from "fs";
import * as path from "path";

const ADAPTERS_DIR = path.join(__dirname, "..", "lib", "host-adapters");
const BROKEN_FIXTURE = path.join(
  __dirname,
  "fixtures",
  "host-open",
  "no-preflight-host",
  "no-preflight-host.ts",
);

/**
 * The session-open preflight surface a generated adapter must declare. Keys on the
 * contract signature `preflight(request?: PreflightRequest)` — lowercase method name
 * so it never matches the `PreflightRequest` type import or `hostOpenPreflight(...)`.
 */
function hasPreflightWiring(source: string): boolean {
  return /\bpreflight\s*\(\s*request\?:\s*PreflightRequest\b/.test(source);
}

function realAdapterFiles(): string[] {
  return fs
    .readdirSync(ADAPTERS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .map((f) => path.join(ADAPTERS_DIR, f));
}

describe("host-open preflight coverage — every generated adapter wires preflight (V2)", () => {
  it("the adapter set is non-empty (the scan has something to cover)", () => {
    expect(realAdapterFiles().length).toBeGreaterThanOrEqual(5);
  });

  it.each(realAdapterFiles())("%s declares the preflight(request?: PreflightRequest) surface", (file) => {
    const source = fs.readFileSync(file, "utf8");
    expect(hasPreflightWiring(source)).toBe(true);
  });
});

describe("host-open preflight coverage — anti-vacuity (V2)", () => {
  it("FAILS when the broken no-preflight-host fixture is included in the scan", () => {
    const set = [...realAdapterFiles(), BROKEN_FIXTURE];
    const missing = set.filter((f) => !hasPreflightWiring(fs.readFileSync(f, "utf8")));
    // The fixture omits preflight → exactly it must be flagged. A green scan here
    // would mean the gate cannot see a missing preflight call.
    expect(missing).toEqual([BROKEN_FIXTURE]);
  });

  it("the broken fixture genuinely omits the preflight surface (probe is real)", () => {
    expect(hasPreflightWiring(fs.readFileSync(BROKEN_FIXTURE, "utf8"))).toBe(false);
  });

  it("FAILS if a REAL adapter's preflight call is removed (mutate-and-confirm)", () => {
    const real = realAdapterFiles();
    const victim = real.find((f) => f.endsWith("claude-code-cli.ts")) ?? real[0];
    const source = fs.readFileSync(victim, "utf8");
    expect(hasPreflightWiring(source)).toBe(true); // present as shipped
    // Excise the preflight method body and re-run the SAME check.
    const stripped = source.replace(
      /preflight\s*\(\s*request\?:\s*PreflightRequest\s*\)[^{]*\{/,
      "/* preflight removed */ {",
    );
    expect(stripped).not.toBe(source); // the mutation actually changed something
    expect(hasPreflightWiring(stripped)).toBe(false); // gate would catch the removal
  });
});
