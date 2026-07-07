/**
 * hooks/__tests__/security-secrets.test.ts
 *
 * Unit tests for the secrets-policy redaction extension
 * (hooks/lib/security/secrets.ts).
 */

import {
  applySecretsPolicy,
  resolveTelemetryField,
  type ScrubResult,
} from "../lib/security/secrets";
import type { SecretsPolicy } from "../lib/security/config";

const policy = (over: Partial<SecretsPolicy> = {}): SecretsPolicy => ({
  env_allowlist: [],
  redaction_patterns: [],
  fail_mode_durable: "closed",
  fail_mode_telemetry: "open",
  ...over,
});

describe("applySecretsPolicy", () => {
  it("always runs the built-in redaction (token shapes) even with no custom patterns", () => {
    const r = applySecretsPolicy("token=sk-ant-abcdefghijklmnopqrstuvwxyz0123", policy());
    expect(r.value).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz0123");
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("applies operator custom redaction_patterns on top of built-ins", () => {
    const r = applySecretsPolicy("internal-code ACME-1234 here", policy({ redaction_patterns: ["ACME-\\d+"] }));
    expect(r.value).toContain("[REDACTED]");
    expect(r.value).not.toContain("ACME-1234");
    expect(r.ok).toBe(true);
  });

  it("records a failure (ok=false) for an invalid custom regex but does not throw", () => {
    const r = applySecretsPolicy("safe text", policy({ redaction_patterns: ["("] }));
    expect(r.ok).toBe(false);
    expect(r.failures.length).toBe(1);
    // built-in scrub still produced a value
    expect(typeof r.value).toBe("string");
  });

  it("coerces non-string input without throwing", () => {
    const r = applySecretsPolicy(42 as unknown, policy());
    expect(r.ok).toBe(true);
  });
});

describe("resolveTelemetryField", () => {
  const okScrub: ScrubResult = { value: "clean", ok: true, failures: [] };
  const failScrub: ScrubResult = { value: "best-effort", ok: false, failures: ["bad"] };

  it("emits the scrubbed value with no warn when ok", () => {
    expect(resolveTelemetryField(okScrub, policy())).toEqual({ value: "clean", warn: false });
  });

  it("fail_mode_telemetry=open ⇒ emit best-effort value + warn", () => {
    expect(resolveTelemetryField(failScrub, policy({ fail_mode_telemetry: "open" }))).toEqual({
      value: "best-effort",
      warn: true,
    });
  });

  it("fail_mode_telemetry=closed ⇒ suppress the field + warn", () => {
    expect(resolveTelemetryField(failScrub, policy({ fail_mode_telemetry: "closed" }))).toEqual({
      value: undefined,
      warn: true,
    });
  });
});
