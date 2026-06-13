/**
 * scripts/__tests__/cloud-task-packet.test.ts
 *
 * guild.cloud_task_packet.v1 — focused test suite.
 *
 * Covers:
 *   - Happy path: makeCloudTaskPacket builds a valid packet with all required fields.
 *   - Schema version is exactly "guild.cloud_task_packet.v1".
 *   - Cloud opt-in guard: CloudOptInRequired thrown when egressApproved=false.
 *   - Cloud opt-in guard: CloudOptInRequired thrown when cloud_opt_in missing.
 *   - CANONICAL_EXCLUDED_PATHS are always present in the packet.
 *   - Extra excluded paths are merged and deduplicated.
 *   - Quarantined inputs: empty array default when none provided.
 *   - Expected outputs: defaults to ["handoff_receipt", "pr_or_patch", "evidence"].
 *   - return_contract: hardwired to canonical + codex-cloud.
 *   - Validator: validates a built packet as valid.
 *   - Validator: catches a malformed/edge-case packet with correct error messages.
 *   - cloudTaskPacketPath: canonical disk path.
 *   - Determinism: no Date.now() or Math.random() inside the builder (tested by
 *     calling it twice with the same args and comparing output structurally).
 *
 * Real-path note: this module is pure — no filesystem writes from the lib
 * functions themselves (cloudTaskPacketPath returns a pure string). The temp-dir
 * coverage below verifies the returned path is a valid fs path string only.
 */

import * as path from "path";
import * as os from "os";
import * as fs from "fs";

import {
  makeCloudTaskPacket,
  validateCloudTaskPacket,
  isValidCloudTaskPacket,
  cloudTaskPacketPath,
  CloudOptInRequired,
  CLOUD_TASK_PACKET_SCHEMA,
  CANONICAL_EXCLUDED_PATHS,
  ORIGIN_HOSTS,
  EXPECTED_OUTPUT_KINDS,
  QUARANTINE_KINDS,
  type CloudTaskPacketParams,
  type ConsentBlock,
} from "../lib/cloud-task-packet";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const APPROVED_CONSENT: ConsentBlock = {
  cloud_opt_in: true,
  approved_by: "user",
  approved_at: "2026-06-13T10:00:00Z",
};

const BASE_PARAMS: CloudTaskPacketParams = {
  consent: APPROVED_CONSENT,
  egressApproved: true,
  packet_id: "cpkt-abc123",
  source_task_run_ref: "trun-001",
  run_id: "run-2026-06-13-001",
  task_id: "backend-api-001",
  origin_host: "claude-code",
  objective: "Implement POST /auth with argon2id",
  included_artifacts: [
    {
      path: ".guild/spec/alpha.redacted.md",
      sha256: "abc123def456",
    },
    {
      path: ".guild/plan/alpha.redacted.md",
      sha256: "def456abc123",
    },
  ],
  quarantined_inputs: [],
  expected_outputs: ["handoff_receipt", "pr_or_patch", "evidence"],
  capability_requirements: {
    needs_pr: true,
    isolation: "cloud_container",
  },
  budget: { max_turns: 20, max_tokens: 80000 },
};

// Helper: assert validation failed and return the errors array.
function assertInvalid(packet: unknown): string[] {
  const result = validateCloudTaskPacket(packet);
  expect(result.valid).toBe(false);
  return (result as { valid: false; errors: string[] }).errors;
}

// ── Happy path ────────────────────────────────────────────────────────────────

describe("makeCloudTaskPacket — happy path", () => {
  it("returns an object with schema_version = guild.cloud_task_packet.v1", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    expect(packet.schema_version).toBe(CLOUD_TASK_PACKET_SCHEMA);
    expect(packet.schema_version).toBe("guild.cloud_task_packet.v1");
  });

  it("carries all required top-level ids", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    expect(packet.packet_id).toBe("cpkt-abc123");
    expect(packet.source_task_run_ref).toBe("trun-001");
    expect(packet.run_id).toBe("run-2026-06-13-001");
    expect(packet.task_id).toBe("backend-api-001");
    expect(packet.origin_host).toBe("claude-code");
  });

  it("carries the consent block verbatim", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    expect(packet.consent.cloud_opt_in).toBe(true);
    expect(packet.consent.approved_by).toBe("user");
    expect(packet.consent.approved_at).toBe("2026-06-13T10:00:00Z");
  });

  it("carries the sanitized objective", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    expect(packet.objective).toBe("Implement POST /auth with argon2id");
  });

  it("carries included_artifacts with paths and sha256s", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    expect(packet.included_artifacts).toHaveLength(2);
    expect(packet.included_artifacts[0].path).toBe(".guild/spec/alpha.redacted.md");
    expect(packet.included_artifacts[0].sha256).toBe("abc123def456");
    expect(packet.included_artifacts[1].path).toBe(".guild/plan/alpha.redacted.md");
    expect(packet.included_artifacts[1].sha256).toBe("def456abc123");
  });

  it("has the fixed redaction_policy string", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    expect(packet.redaction_policy).toBe(
      "path-category-only for secrets; secret-looking content hashed; no raw provider prompts; no creator transcript"
    );
  });

  it("return_contract is hardwired: canonical + codex-cloud", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    expect(packet.return_contract.handoff_receipt).toBe("canonical");
    expect(packet.return_contract.trace_host).toBe("codex-cloud");
  });

  it("budget is preserved", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    expect(packet.budget.max_turns).toBe(20);
    expect(packet.budget.max_tokens).toBe(80000);
  });

  it("capability_requirements is preserved", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    expect(packet.capability_requirements.needs_pr).toBe(true);
    expect(packet.capability_requirements.isolation).toBe("cloud_container");
  });

  it("expected_outputs defaults to all three canonical values when not provided", () => {
    const { expected_outputs: _, ...rest } = BASE_PARAMS;
    const packet = makeCloudTaskPacket({ ...rest });
    expect(packet.expected_outputs).toEqual([
      "handoff_receipt",
      "pr_or_patch",
      "evidence",
    ]);
  });

  it("expected_outputs is preserved when provided", () => {
    const packet = makeCloudTaskPacket({
      ...BASE_PARAMS,
      expected_outputs: ["handoff_receipt"],
    });
    expect(packet.expected_outputs).toEqual(["handoff_receipt"]);
  });

  it("quarantined_inputs defaults to empty array when not provided", () => {
    const { quarantined_inputs: _, ...rest } = BASE_PARAMS;
    const packet = makeCloudTaskPacket({ ...rest });
    expect(packet.quarantined_inputs).toEqual([]);
  });

  it("quarantined_inputs are preserved when provided", () => {
    const packet = makeCloudTaskPacket({
      ...BASE_PARAMS,
      quarantined_inputs: [
        {
          kind: "web",
          ref: ".guild/raw/sources/ext-doc/original.html",
          sha256: "deadbeef",
          handling: "summary-only, marked untrusted, NOT executed as instructions",
        },
      ],
    });
    expect(packet.quarantined_inputs).toHaveLength(1);
    expect(packet.quarantined_inputs[0].kind).toBe("web");
    expect(packet.quarantined_inputs[0].sha256).toBe("deadbeef");
  });
});

// ── CANONICAL_EXCLUDED_PATHS contract ────────────────────────────────────────

describe("makeCloudTaskPacket — CANONICAL_EXCLUDED_PATHS", () => {
  it("every canonical excluded path appears in the packet", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    for (const ep of CANONICAL_EXCLUDED_PATHS) {
      expect(packet.excluded_paths).toContain(ep);
    }
  });

  it(".guild/runs/cloud-packets pattern is always excluded (rule 1 — no re-sync loop)", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const hasIt = packet.excluded_paths.some((ep) => ep.includes("cloud-packets"));
    expect(hasIt).toBe(true);
  });

  it(".env is always excluded (secret protection)", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    expect(packet.excluded_paths).toContain(".env");
  });

  it("extra_excluded_paths are merged and deduped", () => {
    // Provide one path that overlaps with canonical and one that is new.
    const extra = [".env", ".guild/custom/sensitive/"];
    const packet = makeCloudTaskPacket({
      ...BASE_PARAMS,
      extra_excluded_paths: extra,
    });
    // No duplicates
    const deduped = new Set(packet.excluded_paths);
    expect(deduped.size).toBe(packet.excluded_paths.length);
    // New path is present
    expect(packet.excluded_paths).toContain(".guild/custom/sensitive/");
    // Canonical overlap is still present exactly once
    expect(packet.excluded_paths.filter((ep) => ep === ".env")).toHaveLength(1);
  });
});

// ── Cloud opt-in guard ────────────────────────────────────────────────────────

describe("makeCloudTaskPacket — CloudOptInRequired guard", () => {
  it("throws CloudOptInRequired when egressApproved=false", () => {
    expect(() =>
      makeCloudTaskPacket({ ...BASE_PARAMS, egressApproved: false })
    ).toThrow(CloudOptInRequired);
  });

  it("throws with reason 'egress_checkpoint_not_approved' when egressApproved=false", () => {
    let caught: unknown;
    try {
      makeCloudTaskPacket({ ...BASE_PARAMS, egressApproved: false });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CloudOptInRequired);
    expect((caught as CloudOptInRequired).reason).toBe("egress_checkpoint_not_approved");
  });

  it("egress gate fires BEFORE consent check — throws egress error even if consent is also bad", () => {
    const badConsent = {
      cloud_opt_in: false as unknown as true,
      approved_by: "user" as const,
      approved_at: "2026-06-13T10:00:00Z",
    };
    let caught: unknown;
    try {
      makeCloudTaskPacket({
        ...BASE_PARAMS,
        egressApproved: false,
        consent: badConsent,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CloudOptInRequired);
    expect((caught as CloudOptInRequired).reason).toBe("egress_checkpoint_not_approved");
  });

  it("throws with reason 'missing_cloud_opt_in' when egressApproved=true but cloud_opt_in is false", () => {
    const badConsent = {
      cloud_opt_in: false as unknown as true,
      approved_by: "user" as const,
      approved_at: "2026-06-13T10:00:00Z",
    };
    let caught: unknown;
    try {
      makeCloudTaskPacket({
        ...BASE_PARAMS,
        egressApproved: true,
        consent: badConsent,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CloudOptInRequired);
    expect((caught as CloudOptInRequired).reason).toBe("missing_cloud_opt_in");
  });

  it("CloudOptInRequired has name 'CloudOptInRequired'", () => {
    let caught: unknown;
    try {
      makeCloudTaskPacket({ ...BASE_PARAMS, egressApproved: false });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).name).toBe("CloudOptInRequired");
  });
});

// ── Determinism ───────────────────────────────────────────────────────────────

describe("makeCloudTaskPacket — determinism", () => {
  it("produces structurally identical output on two calls with same params", () => {
    const packet1 = makeCloudTaskPacket(BASE_PARAMS);
    const packet2 = makeCloudTaskPacket(BASE_PARAMS);
    expect(JSON.stringify(packet1)).toBe(JSON.stringify(packet2));
  });

  it("different packet_id produces different packet", () => {
    const p1 = makeCloudTaskPacket(BASE_PARAMS);
    const p2 = makeCloudTaskPacket({ ...BASE_PARAMS, packet_id: "cpkt-other" });
    expect(p1.packet_id).not.toBe(p2.packet_id);
  });
});

// ── Validator: valid packet ───────────────────────────────────────────────────

describe("validateCloudTaskPacket — valid packet", () => {
  it("returns { valid: true } for a packet built by makeCloudTaskPacket", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const result = validateCloudTaskPacket(packet);
    expect(result.valid).toBe(true);
  });

  it("isValidCloudTaskPacket returns true for a built packet", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    expect(isValidCloudTaskPacket(packet)).toBe(true);
  });
});

// ── Validator: malformed / edge cases ────────────────────────────────────────

describe("validateCloudTaskPacket — malformed input", () => {
  it("rejects null", () => {
    const errors = assertInvalid(null);
    expect(errors[0]).toMatch(/non-null object/);
  });

  it("rejects a string", () => {
    const result = validateCloudTaskPacket("not-a-packet");
    expect(result.valid).toBe(false);
  });

  it("rejects wrong schema_version", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const bad = { ...packet, schema_version: "guild.cloud_task_packet.v99" };
    const errors = assertInvalid(bad);
    expect(errors.some((e) => e.includes("schema_version"))).toBe(true);
  });

  it("rejects empty packet_id", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const bad = { ...packet, packet_id: "" };
    const errors = assertInvalid(bad);
    expect(errors.some((e) => e.includes("packet_id"))).toBe(true);
  });

  it("rejects invalid origin_host", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const bad = { ...packet, origin_host: "unknown-host" };
    const errors = assertInvalid(bad);
    expect(errors.some((e) => e.includes("origin_host"))).toBe(true);
  });

  it("rejects consent.cloud_opt_in !== true", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const bad = {
      ...packet,
      consent: { ...packet.consent, cloud_opt_in: false },
    };
    const errors = assertInvalid(bad);
    expect(errors.some((e) => e.includes("cloud_opt_in"))).toBe(true);
  });

  it("rejects empty consent.approved_at", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const bad = {
      ...packet,
      consent: { ...packet.consent, approved_at: "" },
    };
    assertInvalid(bad);
  });

  it("rejects excluded_paths missing cloud-packets pattern", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const badExcluded = packet.excluded_paths.filter(
      (ep) => !ep.includes("cloud-packets")
    );
    const bad = { ...packet, excluded_paths: badExcluded };
    const errors = assertInvalid(bad);
    expect(errors.some((e) => e.includes("cloud-packets"))).toBe(true);
  });

  it("rejects wrong redaction_policy", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const bad = { ...packet, redaction_policy: "something else" };
    const errors = assertInvalid(bad);
    expect(errors.some((e) => e.includes("redaction_policy"))).toBe(true);
  });

  it("rejects invalid quarantined_inputs[i].kind", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const bad = {
      ...packet,
      quarantined_inputs: [
        {
          kind: "pdf-doc", // not in QUARANTINE_KINDS
          ref: ".guild/raw/sources/ext-doc/original.html",
          sha256: "deadbeef",
          handling:
            "summary-only, marked untrusted, NOT executed as instructions",
        },
      ],
    };
    const errors = assertInvalid(bad);
    expect(errors.some((e) => e.includes("quarantined_inputs"))).toBe(true);
  });

  it("rejects invalid expected_outputs[i] value", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const bad = { ...packet, expected_outputs: ["handoff_receipt", "unknown_output"] };
    const errors = assertInvalid(bad);
    expect(errors.some((e) => e.includes("expected_outputs"))).toBe(true);
  });

  it("rejects missing budget", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const asRecord = packet as unknown as Record<string, unknown>;
    const { budget: _b, ...bad } = asRecord;
    assertInvalid(bad);
  });

  it("rejects budget.max_turns < 1", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const bad = { ...packet, budget: { max_turns: 0, max_tokens: 80000 } };
    const errors = assertInvalid(bad);
    expect(errors.some((e) => e.includes("max_turns"))).toBe(true);
  });

  it("rejects wrong return_contract.trace_host", () => {
    const packet = makeCloudTaskPacket(BASE_PARAMS);
    const bad = {
      ...packet,
      return_contract: { ...packet.return_contract, trace_host: "codex-local" },
    };
    const errors = assertInvalid(bad);
    expect(errors.some((e) => e.includes("trace_host"))).toBe(true);
  });

  it("accumulates multiple errors", () => {
    const bad = {
      schema_version: "wrong",
      packet_id: "",
      // missing most required fields
    };
    const errors = assertInvalid(bad);
    expect(errors.length).toBeGreaterThan(2);
  });
});

// ── cloudTaskPacketPath ───────────────────────────────────────────────────────

describe("cloudTaskPacketPath", () => {
  it("returns the canonical .guild/runs/<run-id>/cloud-packets/<task-run-id>.yaml path", () => {
    const p = cloudTaskPacketPath("/repo", "run-001", "trun-001");
    expect(p).toBe(
      path.join("/repo", ".guild", "runs", "run-001", "cloud-packets", "trun-001.yaml")
    );
  });

  it("is a pure path computation — does not create files on disk", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ctp-"));
    try {
      const p = cloudTaskPacketPath(tmpDir, "run-test", "trun-test");
      expect(fs.existsSync(p)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("different run-ids produce different paths", () => {
    const p1 = cloudTaskPacketPath("/repo", "run-001", "trun-001");
    const p2 = cloudTaskPacketPath("/repo", "run-002", "trun-001");
    expect(p1).not.toBe(p2);
  });
});

// ── Exported enums and constants ──────────────────────────────────────────────

describe("exported enums", () => {
  it("ORIGIN_HOSTS contains claude-code and codex-local", () => {
    expect(ORIGIN_HOSTS).toContain("claude-code");
    expect(ORIGIN_HOSTS).toContain("codex-local");
  });

  it("EXPECTED_OUTPUT_KINDS contains handoff_receipt, pr_or_patch, evidence", () => {
    expect(EXPECTED_OUTPUT_KINDS).toContain("handoff_receipt");
    expect(EXPECTED_OUTPUT_KINDS).toContain("pr_or_patch");
    expect(EXPECTED_OUTPUT_KINDS).toContain("evidence");
  });

  it("QUARANTINE_KINDS contains web, issue, external_doc", () => {
    expect(QUARANTINE_KINDS).toContain("web");
    expect(QUARANTINE_KINDS).toContain("issue");
    expect(QUARANTINE_KINDS).toContain("external_doc");
  });

  it("CANONICAL_EXCLUDED_PATHS is a non-empty readonly array", () => {
    expect(Array.isArray(CANONICAL_EXCLUDED_PATHS)).toBe(true);
    expect(CANONICAL_EXCLUDED_PATHS.length).toBeGreaterThan(0);
  });
});

// ── Inert-by-default contract ─────────────────────────────────────────────────

describe("cloud_task_packet.v1 inert-by-default contract", () => {
  it("makeCloudTaskPacket with no egressApproved never produces a packet silently", () => {
    // This test documents the invariant: no accidental cloud packet production.
    let produced = false;
    let caught: unknown;
    try {
      makeCloudTaskPacket({ ...BASE_PARAMS, egressApproved: false });
      produced = true;
    } catch (e) {
      caught = e;
    }
    expect(produced).toBe(false);
    expect(caught).toBeInstanceOf(CloudOptInRequired);
  });

  it("a codex-local origin host is valid (not only claude-code)", () => {
    const packet = makeCloudTaskPacket({
      ...BASE_PARAMS,
      origin_host: "codex-local",
    });
    expect(packet.origin_host).toBe("codex-local");
    expect(isValidCloudTaskPacket(packet)).toBe(true);
  });
});
