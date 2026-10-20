/**
 * src/domains/lifecycle/h2-snapshot-digest.test.ts
 *
 * #146 — whole-file integrity binding for `resolved-settings.json`.
 *
 *   [x] the run-start write records a digest sidecar of the exact bytes on disk
 *   [x] a scrub-blocked write leaves no snapshot AND no sidecar
 *   [x] the reader returns the snapshot when the digest verifies
 *   [x] the reader keeps pre-#146 behaviour when there is no sidecar (legacy)
 *   [x] the reader FAILS CLOSED (throws) when the snapshot bytes were edited
 *   [x] the reader FAILS CLOSED on a malformed sidecar
 *   [x] the pure verdict helper: verified / legacy / mismatch
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  readResolvedSettingsSnapshot,
  ResolvedSettingsIntegrityError,
  writeResolvedSettingsSnapshot,
  type ProvenanceFsSeam,
} from "./run-lifecycle";
import type { ResolvedSettingsSnapshot } from "./runstart-preflight";
import {
  RESOLVED_SETTINGS_DIGEST_FILE,
  resolvedSettingsDigest,
  verifyResolvedSettingsDigest,
} from "../state";

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-h2-digest-")));
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function snapshot(agentMode = "team"): ResolvedSettingsSnapshot {
  return {
    schema_version: "guild.resolved_settings.v1",
    source_chain: {},
    effective: { agent_mode: agentMode, block_unmarked_lanes: true },
    providers: { authorHost: "claude", authorTrust: "verified", detected: [], recommended: null },
    roles: {},
    dispatch: { backend: "tmux", reason: "fixture", facts: {} },
    resolved_at_ref: null,
  } as unknown as ResolvedSettingsSnapshot;
}

/** A real-disk seam with a configurable scrub outcome. */
function seam(blocked = false): ProvenanceFsSeam {
  return {
    writeFile(p, c) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, c, "utf8");
    },
    readFile(p) {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    scrubbedWriteDurable(outPath, contents) {
      if (blocked) return { blocked: true } as never;
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      // The scrubber may rewrite content; the digest must cover what LANDED.
      fs.writeFileSync(outPath, contents.replace('"fixture"', '"[scrubbed]"'), "utf8");
      return { blocked: false } as never;
    },
  };
}

const runDir = (id: string) => path.join(ROOT, ".guild", "runs", id);
const snapPath = (id: string) => path.join(runDir(id), "resolved-settings.json");
const sidecarPath = (id: string) => path.join(runDir(id), RESOLVED_SETTINGS_DIGEST_FILE);

describe("#146 — run start records a whole-file digest", () => {
  it("writes a sidecar whose digest equals the bytes actually on disk", () => {
    writeResolvedSettingsSnapshot("run-h2-write", snapshot(), { cwd: ROOT, fs: seam() });
    const raw = fs.readFileSync(snapPath("run-h2-write"), "utf8");
    expect(raw).toContain("[scrubbed]");
    expect(fs.readFileSync(sidecarPath("run-h2-write"), "utf8").trim()).toBe(
      resolvedSettingsDigest(raw),
    );
  });

  it("a scrub-blocked write leaves neither the snapshot nor a sidecar", () => {
    writeResolvedSettingsSnapshot("run-h2-blocked", snapshot(), { cwd: ROOT, fs: seam(true) });
    expect(fs.existsSync(snapPath("run-h2-blocked"))).toBe(false);
    expect(fs.existsSync(sidecarPath("run-h2-blocked"))).toBe(false);
  });
});

describe("#146 — readers verify the digest and fail closed", () => {
  it("returns the snapshot when the digest verifies", () => {
    writeResolvedSettingsSnapshot("run-h2-ok", snapshot(), { cwd: ROOT, fs: seam() });
    const back = readResolvedSettingsSnapshot("run-h2-ok", { cwd: ROOT, fs: seam() });
    expect(back?.effective.agent_mode).toBe("team");
  });

  it("legacy run (no sidecar) reads exactly as before #146", () => {
    fs.mkdirSync(runDir("run-h2-legacy"), { recursive: true });
    fs.writeFileSync(snapPath("run-h2-legacy"), JSON.stringify(snapshot("auto")), "utf8");
    const back = readResolvedSettingsSnapshot("run-h2-legacy", { cwd: ROOT, fs: seam() });
    expect(back?.effective.agent_mode).toBe("auto");
  });

  it("an edited snapshot (agent_mode flipped) throws ResolvedSettingsIntegrityError", () => {
    writeResolvedSettingsSnapshot("run-h2-tamper", snapshot(), { cwd: ROOT, fs: seam() });
    const raw = fs.readFileSync(snapPath("run-h2-tamper"), "utf8");
    fs.writeFileSync(snapPath("run-h2-tamper"), raw.replace('"team"', '"agent"'), "utf8");
    expect(() =>
      readResolvedSettingsSnapshot("run-h2-tamper", { cwd: ROOT, fs: seam() }),
    ).toThrow(ResolvedSettingsIntegrityError);
  });

  it("a malformed sidecar fails closed too (never downgrades to legacy)", () => {
    writeResolvedSettingsSnapshot("run-h2-badside", snapshot(), { cwd: ROOT, fs: seam() });
    fs.writeFileSync(sidecarPath("run-h2-badside"), "not-a-digest\n", "utf8");
    expect(() =>
      readResolvedSettingsSnapshot("run-h2-badside", { cwd: ROOT, fs: seam() }),
    ).toThrow(ResolvedSettingsIntegrityError);
  });
});

describe("#146 — read errors fail closed (codex r1)", () => {
  // A directory in place of a file gives a portable EISDIR read failure.
  const swapForDir = (p: string): void => {
    fs.rmSync(p);
    fs.mkdirSync(p);
  };
  it("an unreadable sidecar with an edited snapshot throws (never reads as legacy)", () => {
    writeResolvedSettingsSnapshot("run-h2-eside", snapshot(), { cwd: ROOT, fs: seam() });
    const raw = fs.readFileSync(snapPath("run-h2-eside"), "utf8");
    fs.writeFileSync(snapPath("run-h2-eside"), raw.replace('"team"', '"agent"'), "utf8");
    swapForDir(sidecarPath("run-h2-eside"));
    expect(() => readResolvedSettingsSnapshot("run-h2-eside", { cwd: ROOT, fs: seam() })).toThrow(
      ResolvedSettingsIntegrityError,
    );
  });
  it("a bound snapshot that is deleted or unreadable throws (never reads as absent)", () => {
    writeResolvedSettingsSnapshot("run-h2-gone", snapshot(), { cwd: ROOT, fs: seam() });
    fs.rmSync(snapPath("run-h2-gone"));
    expect(() => readResolvedSettingsSnapshot("run-h2-gone", { cwd: ROOT, fs: seam() })).toThrow(
      ResolvedSettingsIntegrityError,
    );
    writeResolvedSettingsSnapshot("run-h2-esnap", snapshot(), { cwd: ROOT, fs: seam() });
    swapForDir(snapPath("run-h2-esnap"));
    expect(() => readResolvedSettingsSnapshot("run-h2-esnap", { cwd: ROOT, fs: seam() })).toThrow(
      ResolvedSettingsIntegrityError,
    );
  });
  it("control: no snapshot and no sidecar is still just null", () => {
    expect(readResolvedSettingsSnapshot("run-h2-never", { cwd: ROOT, fs: seam() })).toBeNull();
  });
});

describe("#146 — verifyResolvedSettingsDigest", () => {
  const raw = '{"a":1}\n';
  it("verified when the sidecar names the bytes' digest", () => {
    expect(verifyResolvedSettingsDigest(raw, resolvedSettingsDigest(raw) + "\n")).toBe("verified");
  });
  it("legacy when there is no sidecar", () => {
    expect(verifyResolvedSettingsDigest(raw, null)).toBe("legacy");
  });
  it("mismatch on different bytes, an empty sidecar, or a wrong algorithm", () => {
    expect(verifyResolvedSettingsDigest('{"a":2}\n', resolvedSettingsDigest(raw))).toBe("mismatch");
    expect(verifyResolvedSettingsDigest(raw, "")).toBe("mismatch");
    expect(
      verifyResolvedSettingsDigest(raw, resolvedSettingsDigest(raw).replace("sha256:", "md5:")),
    ).toBe("mismatch");
  });
});
