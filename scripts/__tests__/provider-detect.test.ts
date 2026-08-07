/**
 * scripts/__tests__/provider-detect.test.ts
 *
 * TDD suite for scripts/lib/provider-detect.ts (Unit 4 — review-provider
 * detection + broker wiring of the settings-control-and-tmux initiative).
 *
 * This is the SECURITY-SENSITIVE unit: the AC-8 hard rule (a same-family
 * reviewer NEVER satisfies review=cross) is the false-signoff guard and is
 * pinned by dedicated tests below.
 *
 * All probes are INJECTED — no test depends on a real codex/pi binary
 * being installed. The injectable `ProbeEnv` lets us simulate PATH presence,
 * version/auth probe results, env vars, and capability manifests deterministically.
 *
 * Coverage map:
 *  - detectProviders: author-host family resolution (claude / codex / unknown).
 *  - Tiered detection (OD-6): CLI-on-PATH + auth probe  vs  capability.json declare.
 *  - selectable gating (OD-6): codex-plugin & authed codex-cli selectable;
 *    pi/antigravity detect-only (never selectable until adapters ship).
 *  - recommendProvider (AC-7): Claude host + codex-plugin ⇒ recommend codex-plugin.
 *  - recommendProvider: provider=auto RE-DETECTS each call (OD-5), never persists.
 *  - selectReviewer (AC-8 HARD RULE): same-family reviewer ⇒ degraded-local/skipped,
 *    NEVER 'selected' for review=cross. No false signoff.
 *  - selectReviewer: no reviewer + review=cross ⇒ 'skipped' with reason.
 *  - selectReviewer: different-family ranker prefers native plugin adapter > authed CLI.
 *  - AC-9 (communication contract): provider choice does NOT carry/alter a comms
 *    field — the broker stays the single packet/result/trail contract.
 */

import {
  detectProviders,
  recommendProvider,
  selectReviewer,
  type DetectionResult,
  type DetectOptions,
  type ProbeEnv,
  type DetectedProvider,
  type HostFamily,
  type ResolvedReview,
} from "../lib/provider-detect";

const CWD = "/tmp/guild-provider-detect-fixture"; // never read — probes are injected

// ---------------------------------------------------------------------------
// Injectable probe builder — fully deterministic, no real binaries touched.
// ---------------------------------------------------------------------------

interface FakeWorld {
  /** binaries reported on PATH */
  onPath?: string[];
  /** binaries whose `--version` probe exits 0 */
  versionOk?: string[];
  /** codex stored-auth (~/.codex/auth.json non-empty) present */
  codexStoredAuth?: boolean;
  /** env vars visible to auth probes */
  env?: Record<string, string>;
  /** capability.json-declared provider ids under .guild/hosts/**  */
  capabilityProviders?: string[];
  /** native plugin adapter ids installed in the host (e.g. "codex-plugin") */
  pluginAdapters?: string[];
}

function makeProbe(world: FakeWorld): ProbeEnv {
  const onPath = new Set(world.onPath ?? []);
  const versionOk = new Set(world.versionOk ?? []);
  const plugins = new Set(world.pluginAdapters ?? []);
  const env = world.env ?? {};
  return {
    commandOnPath: (bin: string) => onPath.has(bin),
    probeVersion: (bin: string) => versionOk.has(bin),
    readStoredCodexAuth: () => world.codexStoredAuth === true,
    readEnv: (name: string) => env[name],
    readCapabilityProviders: () => world.capabilityProviders ?? [],
    readPluginAdapter: (id: string) => plugins.has(id),
  };
}

function byId(providers: DetectedProvider[], id: string): DetectedProvider {
  const p = providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider '${id}' not present in detection result`);
  return p;
}

// A small helper for the common "claude host" review config.
function review(partial: Partial<ResolvedReview> = {}): ResolvedReview {
  return { mode: "cross", provider: "auto", ...partial };
}

// ---------------------------------------------------------------------------
// 1. Author-host family resolution
// ---------------------------------------------------------------------------

describe("detectProviders — author host family", () => {
  it("resolves the author host to 'unknown' when host is unset/auto (session_context §3 — no claude default)", () => {
    // guild.session_context.v1 §3 (frozen 2026-07-30) retired the historical
    // "auto"/unset ⇒ claude default: identity comes from the §4 precedence
    // chain (explicit setting / native adapter), never a hardcoded family.
    const { authorHost } = detectProviders({ cwd: CWD, trust: "asserted", probe: makeProbe({}) });
    expect(authorHost).toBe<HostFamily>("unknown");
    const auto = detectProviders({ cwd: CWD, host: "auto", trust: "asserted", probe: makeProbe({}) });
    expect(auto.authorHost).toBe<HostFamily>("unknown");
  });

  it("honors an explicit host override and maps it to a family", () => {
    const { authorHost } = detectProviders({
      cwd: CWD,
      host: "codex",
      trust: "asserted",
      probe: makeProbe({}),
    });
    expect(authorHost).toBe<HostFamily>("codex");
  });

  it("maps an unknown host string to the 'unknown' family", () => {
    const { authorHost } = detectProviders({
      cwd: CWD,
      host: "weird-future-host",
      trust: "asserted",
      probe: makeProbe({}),
    });
    expect(authorHost).toBe<HostFamily>("unknown");
  });

  it("always reports claude as the host-kind provider, detected on the host", () => {
    const { providers } = detectProviders({ cwd: CWD, trust: "asserted", probe: makeProbe({}) });
    const claude = byId(providers, "claude");
    expect(claude.kind).toBe("host");
    expect(claude.detected).toBe(true);
    expect(claude.family).toBe<HostFamily>("claude");
  });
});

// ---------------------------------------------------------------------------
// 2. Claude host + codex-plugin available  (AC-7 reference path)
// ---------------------------------------------------------------------------

describe("Claude host + codex-plugin available", () => {
  // codex-plugin reference adapter: codex CLI present + authed (the codex:codex-rescue
  // dispatch path works today on this machine via stored auth).
  const world = makeProbe({
    onPath: ["codex"],
    versionOk: ["codex"],
    codexStoredAuth: true,
    pluginAdapters: ["codex-plugin"],
  });

  it("detects codex-plugin and marks it SELECTABLE", () => {
    const { providers } = detectProviders({ cwd: CWD, trust: "asserted", probe: world });
    const plugin = byId(providers, "codex-plugin");
    expect(plugin.kind).toBe("plugin-adapter");
    expect(plugin.detected).toBe(true);
    expect(plugin.authed).toBe(true);
    expect(plugin.selectable).toBe(true);
    expect(plugin.family).toBe<HostFamily>("codex");
  });

  it("recommends codex-plugin for a Claude author on provider=auto (AC-7)", () => {
    const detection = detectProviders({ cwd: CWD, host: "claude", trust: "verified", probe: world });
    const rec = recommendProvider(detection, review());
    expect(rec.recommended).toBe("codex-plugin");
    expect(rec.reason).toMatch(/claude/i);
  });

  it("selects codex-plugin (different family) for review=cross", () => {
    const detection = detectProviders({ cwd: CWD, host: "claude", trust: "verified", probe: world });
    const sel = selectReviewer(detection, review());
    expect(sel.status).toBe("selected");
    expect(sel.provider).toBe("codex-plugin");
  });
});

// ---------------------------------------------------------------------------
// 3. Claude host + codex-cli only (authed)  → selectable
// ---------------------------------------------------------------------------

describe("Claude host + codex-cli only (authed via OPENAI_API_KEY)", () => {
  // CLI present + version ok + env-var auth, but the plugin adapter is NOT the
  // reference path here — we simulate the cli being usable while distinguishing
  // it from the plugin adapter. The cli is selectable when its auth probe passes.
  const world = makeProbe({
    onPath: ["codex"],
    versionOk: ["codex"],
    env: { OPENAI_API_KEY: "sk-test" },
  });

  it("marks codex-cli detected + authed + selectable", () => {
    const { providers } = detectProviders({ cwd: CWD, trust: "asserted", probe: world });
    const cli = byId(providers, "codex-cli");
    expect(cli.kind).toBe("cli");
    expect(cli.detected).toBe(true);
    expect(cli.authed).toBe(true);
    expect(cli.selectable).toBe(true);
  });

  it("an UN-authed codex-cli is detected but NOT selectable (OD-6)", () => {
    const noAuth = makeProbe({ onPath: ["codex"], versionOk: ["codex"] });
    const { providers } = detectProviders({ cwd: CWD, trust: "asserted", probe: noAuth });
    const cli = byId(providers, "codex-cli");
    expect(cli.detected).toBe(true);
    expect(cli.authed).toBe(false);
    expect(cli.selectable).toBe(false);
  });

  it("selects a codex reviewer for review=cross when only the cli is available", () => {
    const detection = detectProviders({ cwd: CWD, host: "claude", trust: "verified", probe: world });
    const sel = selectReviewer(detection, review());
    expect(sel.status).toBe("selected");
    expect(sel.provider).toBe("codex-cli");
  });
});

// ---------------------------------------------------------------------------
// 5. AC-8 HARD RULE — same-family reviewer NEVER satisfies review=cross
// ---------------------------------------------------------------------------

describe("AC-8 hard rule — same-family reviewer never satisfies review=cross", () => {
  it("Codex author + only codex reviewer available ⇒ degraded-local, NEVER selected", () => {
    // Author host = codex. The only available reviewer is codex (same family) —
    // and it is a fully SELECTABLE codex-plugin. The guard must STILL refuse it.
    const world = makeProbe({
      onPath: ["codex"],
      versionOk: ["codex"],
      codexStoredAuth: true,
      pluginAdapters: ["codex-plugin"],
    });
    const detection = detectProviders({ cwd: CWD, host: "codex", trust: "verified", probe: world });
    const sel = selectReviewer(detection, review());

    expect(sel.status).not.toBe("selected"); // the false-signoff guard
    expect(["degraded-local", "skipped"]).toContain(sel.status);
    expect(sel.provider).toBeNull();
    expect(sel.reason).toMatch(/same.?family|different family|cross/i);
  });

  it("Claude author + ONLY a (hypothetical) claude-family reviewer ⇒ never selected", () => {
    // No different-family reviewer at all: only the host family is present.
    const world = makeProbe({}); // nothing on PATH; only host-family claude exists
    const detection = detectProviders({ cwd: CWD, host: "claude", trust: "verified", probe: world });
    const sel = selectReviewer(detection, review());
    expect(sel.status).not.toBe("selected");
    expect(["degraded-local", "skipped"]).toContain(sel.status);
  });

  it("a same-family reviewer is never returned even if the operator pins it", () => {
    const world = makeProbe({
      onPath: ["codex"],
      versionOk: ["codex"],
      codexStoredAuth: true,
      pluginAdapters: ["codex-plugin"],
    });
    // Author = codex, operator pins codex-plugin (same family) → must refuse.
    const detection = detectProviders({ cwd: CWD, host: "codex", trust: "verified", probe: world });
    const sel = selectReviewer(detection, review({ provider: "codex-plugin" }));
    expect(sel.status).not.toBe("selected");
    expect(sel.provider).toBeNull();
    expect(sel.reason).toMatch(/same.?family/i);
  });
});

// ---------------------------------------------------------------------------
// 6. No reviewer + review=cross ⇒ skipped with reason (no false signoff)
// ---------------------------------------------------------------------------

describe("no reviewer available + review=cross ⇒ skipped with reason", () => {
  it("returns skipped (not selected, not a signoff) with an explicit reason", () => {
    const detection = detectProviders({ cwd: CWD, host: "claude", trust: "verified", probe: makeProbe({}) });
    const sel = selectReviewer(detection, review());
    expect(sel.status).toBe("skipped");
    expect(sel.provider).toBeNull();
    expect(sel.reason).toMatch(/no .*reviewer|unavailable|cross/i);
  });

  it("recommendProvider returns null with a reason when nothing is recommendable", () => {
    const detection = detectProviders({ cwd: CWD, host: "claude", trust: "verified", probe: makeProbe({}) });
    const rec = recommendProvider(detection, review());
    expect(rec.recommended).toBeNull();
    expect(rec.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 7. review.mode != cross — selection short-circuits, no false signoff risk
// ---------------------------------------------------------------------------

describe("review modes other than cross", () => {
  it("review=local ⇒ degraded-local with reason (cross not requested)", () => {
    const detection = detectProviders({ cwd: CWD, trust: "asserted", probe: makeProbe({}) });
    const sel = selectReviewer(detection, review({ mode: "local" }));
    expect(sel.status).toBe("degraded-local");
    expect(sel.provider).toBeNull();
  });

  it("review=off ⇒ skipped, no provider", () => {
    const detection = detectProviders({ cwd: CWD, trust: "asserted", probe: makeProbe({}) });
    const sel = selectReviewer(detection, review({ mode: "off" }));
    expect(sel.status).toBe("skipped");
    expect(sel.provider).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. capability.json-declared provider is detected (OD-6 manifest tier)
// ---------------------------------------------------------------------------

describe("capability.json-declared provider detection (OD-6 manifest tier)", () => {
  it("detects an antigravity provider declared by a capability manifest (no CLI on PATH)", () => {
    const world = makeProbe({ capabilityProviders: ["antigravity"] });
    const { providers } = detectProviders({ cwd: CWD, trust: "asserted", probe: world });
    const ag = byId(providers, "antigravity");
    expect(ag.detected).toBe(true);
    expect(ag.detail).toMatch(/capability|manifest/i);
    // Still NOT selectable — no adapter ships yet (OD-6).
    expect(ag.selectable).toBe(false);
  });

  it("a provider with neither a PATH binary nor a manifest is not detected", () => {
    const { providers } = detectProviders({ cwd: CWD, trust: "asserted", probe: makeProbe({}) });
    const pi = byId(providers, "pi");
    expect(pi.detected).toBe(false);
    expect(pi.selectable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. Different-family ranker prefers native plugin adapter > authed CLI
// ---------------------------------------------------------------------------

describe("different-family ranker — native plugin adapter beats authed CLI", () => {
  it("prefers codex-plugin over codex-cli when both are selectable", () => {
    const world = makeProbe({
      onPath: ["codex"],
      versionOk: ["codex"],
      codexStoredAuth: true,
      pluginAdapters: ["codex-plugin"], // plugin adapter installed
      env: { OPENAI_API_KEY: "sk-test" }, // makes codex-cli selectable too
    });
    const detection = detectProviders({ cwd: CWD, host: "claude", trust: "verified", probe: world });
    expect(byId(detection.providers, "codex-plugin").selectable).toBe(true);
    expect(byId(detection.providers, "codex-cli").selectable).toBe(true);
    const sel = selectReviewer(detection, review());
    expect(sel.provider).toBe("codex-plugin"); // native plugin adapter wins
  });
});

// ---------------------------------------------------------------------------
// 10. OD-5 — provider=auto re-detects each call, never persists state
// ---------------------------------------------------------------------------

describe("OD-5 — provider=auto re-detects every call, no persistence", () => {
  it("a later call with a degraded world recommends nothing (no stale pin)", () => {
    const rich = makeProbe({
      onPath: ["codex"],
      versionOk: ["codex"],
      codexStoredAuth: true,
      pluginAdapters: ["codex-plugin"],
    });
    const rec1 = recommendProvider(
      detectProviders({ cwd: CWD, host: "claude", trust: "verified", probe: rich }),
      review()
    );
    expect(rec1.recommended).toBe("codex-plugin");

    // Now codex disappears — a fresh detection must NOT remember the prior pin.
    const poor = makeProbe({});
    const rec2 = recommendProvider(
      detectProviders({ cwd: CWD, host: "claude", trust: "verified", probe: poor }),
      review()
    );
    expect(rec2.recommended).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. AC-9 — communication contract is not forked by provider choice
// ---------------------------------------------------------------------------

describe("AC-9 — provider choice never carries a comms field (broker owns the contract)", () => {
  it("selectReviewer output picks WHO, not HOW (no comms/transport key leaks)", () => {
    const world = makeProbe({ onPath: ["codex"], versionOk: ["codex"], codexStoredAuth: true });
    const detection = detectProviders({ cwd: CWD, trust: "asserted", probe: world });
    const sel = selectReviewer(detection, review());
    // The result describes the chosen provider + status + reason only — never a
    // packet/result/transport channel. The broker (review-broker SKILL) owns comms.
    expect(Object.keys(sel).sort()).toEqual(["provider", "reason", "status"]);
  });
});

// ---------------------------------------------------------------------------
// 12. BLOCKER FIX — authorHost "unknown" can never satisfy review=cross
//
// An unknown author family means we cannot prove cross-family independence.
// selectReviewer MUST NOT return status:"selected" when authorHost === "unknown",
// regardless of whether a "selectable" provider exists. The ranker filters on
// `family !== authorHost`, which is true for "unknown" vs "codex" — but that
// inequality is meaningless when the author family itself is unverified.
//
// The fix: reject at the gate before any selection, not in the ranker.
// ---------------------------------------------------------------------------

describe("authorHost unknown — cannot prove independence, never selected", () => {
  it("unknown author + provider=auto + codex-plugin available ⇒ NOT selected", () => {
    const world = makeProbe({
      onPath: ["codex"],
      versionOk: ["codex"],
      codexStoredAuth: true,
      pluginAdapters: ["codex-plugin"],
    });
    // "weird-future-host" resolves to authorHost:"unknown" (see section 1 above).
    const detection = detectProviders({ cwd: CWD, host: "weird-future-host", trust: "verified", probe: world });
    expect(detection.authorHost).toBe<HostFamily>("unknown");

    const sel = selectReviewer(detection, review());
    // Cannot prove cross-family independence — must NOT be selected.
    expect(sel.status).not.toBe("selected");
    expect(["degraded-local", "skipped"]).toContain(sel.status);
    expect(sel.provider).toBeNull();
    expect(sel.reason).toMatch(/unknown|author.*family|cannot prove/i);
  });

  it("unknown author + explicit pin 'codex-plugin' ⇒ NOT selected", () => {
    const world = makeProbe({
      onPath: ["codex"],
      versionOk: ["codex"],
      codexStoredAuth: true,
      pluginAdapters: ["codex-plugin"],
    });
    const detection = detectProviders({ cwd: CWD, host: "weird-future-host", trust: "verified", probe: world });
    expect(detection.authorHost).toBe<HostFamily>("unknown");

    const sel = selectReviewer(detection, review({ provider: "codex-plugin" }));
    expect(sel.status).not.toBe("selected");
    expect(sel.provider).toBeNull();
    expect(sel.reason).toMatch(/unknown|author.*family|cannot prove/i);
  });

  it("unknown author + recommendProvider ⇒ null (cannot recommend without a known author)", () => {
    const world = makeProbe({
      onPath: ["codex"],
      versionOk: ["codex"],
      codexStoredAuth: true,
      pluginAdapters: ["codex-plugin"],
    });
    const detection = detectProviders({ cwd: CWD, host: "weird-future-host", trust: "verified", probe: world });
    const rec = recommendProvider(detection, review());
    expect(rec.recommended).toBeNull();
    expect(rec.reason).toMatch(/unknown|author.*family|cannot prove/i);
  });
});


// ── T3 rework F4 — asserted-trust gate (session_context §3: asserted ⇒ weak) ──

describe("T3 F4 — asserted author identity never satisfies review=cross", () => {
  const worldWithCodex = () =>
    makeProbe({
      onPath: ["codex"],
      versionOk: ["codex"],
      codexStoredAuth: true,
      pluginAdapters: ["codex-plugin"],
    });

  it("detectProviders threads trust through to DetectionResult.authorTrust (omitted ⇒ normalized 'asserted', never dropped)", () => {
    const asserted = detectProviders({ cwd: CWD, host: "claude", trust: "asserted", probe: worldWithCodex() });
    expect(asserted.authorTrust).toBe("asserted");
    const verified = detectProviders({ cwd: CWD, host: "claude", trust: "verified", probe: worldWithCodex() });
    expect(verified.authorTrust).toBe("verified");
    // R3-F1 CORRECTION: the pre-R3 expectation here (omitted ⇒ undefined)
    // encoded the fail-open trust hole — undefined bypassed every asserted
    // gate. `trust` is now required by the type; a plain-JS caller that still
    // omits it gets the fail-closed normalization: present, and "asserted".
    const omitted = detectProviders({ cwd: CWD, host: "claude", probe: worldWithCodex() } as unknown as DetectOptions);
    expect(omitted.authorTrust).toBe("asserted");
  });

  it("asserted author + selectable codex-plugin ⇒ NEVER selected (auto path)", () => {
    const detection = detectProviders({ cwd: CWD, host: "claude", trust: "asserted", probe: worldWithCodex() });
    const sel = selectReviewer(detection, review());
    expect(sel.status).not.toBe("selected");
    expect(sel.provider).toBeNull();
    expect(sel.status).toBe("degraded-local"); // a reviewer exists — degrade honestly, not silently
    expect(sel.reason).toMatch(/asserted-only|unverified/i);
  });

  it("asserted author + explicit pin ⇒ NEVER selected (pin path has no asserted bypass)", () => {
    const detection = detectProviders({ cwd: CWD, host: "claude", trust: "asserted", probe: worldWithCodex() });
    const sel = selectReviewer(detection, review({ provider: "codex-plugin" }));
    expect(sel.status).not.toBe("selected");
    expect(sel.provider).toBeNull();
    expect(sel.reason).toMatch(/asserted-only|unverified/i);
  });

  it("asserted author ⇒ no recommendation either", () => {
    const detection = detectProviders({ cwd: CWD, host: "claude", trust: "asserted", probe: worldWithCodex() });
    const rec = recommendProvider(detection, review());
    expect(rec.recommended).toBeNull();
    expect(rec.reason).toMatch(/asserted-only|unverified/i);
  });

  it("verified author keeps today's selection behavior (anti-vacuity)", () => {
    const detection = detectProviders({ cwd: CWD, host: "claude", trust: "verified", probe: worldWithCodex() });
    expect(selectReviewer(detection, review()).status).toBe("selected");
    expect(recommendProvider(detection, review()).recommended).toBe("codex-plugin");
  });
});


// ---------------------------------------------------------------------------
// T3 rework R3-F1 — OMITTED trust fails CLOSED (the round-2 fail-open hole).
//
// Round 2 gated only `authorTrust === "asserted"`, so an OMITTED/undefined
// trust bypassed every asserted-identity guard and let an unverified author
// obtain a selected cross reviewer. The corrected contract requires
// `authorTrust === "verified"` for any recommendation/selection; every other
// value — asserted, or absent on a rogue plain-JS caller — degrades.
// ---------------------------------------------------------------------------

describe("T3 R3-F1 — omitted trust fails closed (no recommendation, no selected reviewer)", () => {
  const worldWithCodex = () =>
    makeProbe({
      onPath: ["codex"],
      versionOk: ["codex"],
      codexStoredAuth: true,
      pluginAdapters: ["codex-plugin"],
    });
  // A plain-JS caller omitting the (type-required) trust field.
  const omittedDetection = () =>
    detectProviders({ cwd: CWD, host: "claude", probe: worldWithCodex() } as unknown as DetectOptions);

  it("omitted trust + selectable codex-plugin ⇒ NEVER selected (auto path degrades honestly)", () => {
    const sel = selectReviewer(omittedDetection(), review());
    expect(sel.status).not.toBe("selected");
    expect(sel.provider).toBeNull();
    expect(sel.status).toBe("degraded-local"); // a reviewer exists — degrade, don't silently skip
    expect(sel.reason).toMatch(/not verified|unverified/i);
  });

  it("omitted trust + explicit pin ⇒ NEVER selected (pin path has no omission bypass)", () => {
    const sel = selectReviewer(omittedDetection(), review({ provider: "codex-plugin" }));
    expect(sel.status).not.toBe("selected");
    expect(sel.provider).toBeNull();
    expect(sel.reason).toMatch(/not verified|unverified/i);
  });

  it("omitted trust ⇒ no recommendation", () => {
    const rec = recommendProvider(omittedDetection(), review());
    expect(rec.recommended).toBeNull();
    expect(rec.reason).toMatch(/not verified|unverified/i);
  });

  it("a hand-built DetectionResult with authorTrust STRIPPED still fails closed at both gates (runtime, not just types)", () => {
    // Bypasses detectProviders' normalization entirely — the gates themselves
    // must require "verified", not merely reject the literal "asserted".
    const det = omittedDetection();
    const stripped = { authorHost: det.authorHost, providers: det.providers } as unknown as DetectionResult;
    expect(selectReviewer(stripped, review()).status).not.toBe("selected");
    expect(selectReviewer(stripped, review()).provider).toBeNull();
    expect(recommendProvider(stripped, review()).recommended).toBeNull();
  });
});
