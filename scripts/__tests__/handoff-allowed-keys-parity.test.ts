/**
 * Mechanical parity gate for strict guild.handoff.v2 unknown-key rejection.
 *
 * Each consumer must expose the exact set it uses at runtime so schema changes
 * cannot silently leave a hand-maintained validator mirror behind.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ALLOWED_TOP_LEVEL_KEYS,
  validateHandoffV2,
} from "../../hooks/lib/handoff-v2";
import {
  ALLOWED_ENVELOPE_KEYS as REAPING_ALLOWED_ENVELOPE_KEYS,
  checkReceipt,
} from "../lib/reaping";
import {
  ALLOWED_ENVELOPE_KEYS as COMMS_ALLOWED_ENVELOPE_KEYS,
  lintCommsFormat,
} from "../comms/comms-format-lint";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function envelope(injectionClean?: unknown): Record<string, unknown> {
  const value: Record<string, unknown> = {
    schema_version: "guild.handoff.v2",
    task_id: "task-injection-clean-parity",
    tier: "mid",
    status: "done",
    summary: "Validated through every real consumer path.",
    artifacts: [],
    issues: [],
  };
  if (injectionClean !== undefined) value.injection_clean = injectionClean;
  return value;
}

function writeReceipt(value: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-injection-clean-"));
  tempDirs.push(dir);
  const receiptPath = path.join(dir, "handoffs", "receipt.md");
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(
    receiptPath,
    [
      "# Handoff",
      "",
      "## changed_files",
      "- none",
      "",
      "## opens_for",
      "- none",
      "",
      "## assumptions",
      "- none",
      "",
      "## evidence",
      "- validator parity test",
      "",
      "## followups",
      "- none",
      "",
      "```guild.handoff.v2",
      JSON.stringify(value, null, 2),
      "```",
      "",
    ].join("\n"),
    "utf8"
  );
  return receiptPath;
}

function expectAcceptedByAll(value: Record<string, unknown>): void {
  const receiptPath = writeReceipt(value);

  expect(validateHandoffV2(value)).toEqual({ valid: true, errors: [] });
  expect(checkReceipt(receiptPath)).toMatchObject({
    exists: true,
    hasRequiredFields: true,
    envelopeValid: true,
    errors: [],
  });
  expect(lintCommsFormat({ paths: [receiptPath] }).filter((finding) => finding.check === "a"))
    .toEqual([]);
}

function expectExactKeyParity(name: string, value: unknown): void {
  expect(value).toBeInstanceOf(Set);

  const mirror = value as ReadonlySet<string>;
  const missing = [...ALLOWED_TOP_LEVEL_KEYS].filter((key) => !mirror.has(key));
  const extra = [...mirror].filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key));

  expect({ name, missing, extra }).toEqual({ name, missing: [], extra: [] });
}

describe("guild.handoff.v2 allowed-key parity", () => {
  it("keeps reaping's effective allowed-key set equal to the canonical set", () => {
    expectExactKeyParity(
      "scripts/lib/reaping.ts",
      REAPING_ALLOWED_ENVELOPE_KEYS
    );
  });

  it("keeps comms-format-lint's effective allowed-key set equal to the canonical set", () => {
    expectExactKeyParity(
      "src/modules/communication/workflows/comms-format-lint.ts",
      COMMS_ALLOWED_ENVELOPE_KEYS
    );
  });
});

describe("guild.handoff.v2 injection_clean real-path parity", () => {
  it.each(["clean", "flagged", "unverified"])(
    "accepts injection_clean=%s through canonical, reaping, and comms validators",
    (value) => {
      expectAcceptedByAll(envelope(value));
    }
  );

  it("rejects an invalid injection_clean through canonical, reaping, and comms validators", () => {
    const value = envelope("bogus");
    const receiptPath = writeReceipt(value);

    const canonical = validateHandoffV2(value);
    expect(canonical.valid).toBe(false);
    expect(canonical.errors.some((error) => error.includes("injection_clean"))).toBe(true);

    const reaping = checkReceipt(receiptPath);
    expect(reaping.envelopeValid).toBe(false);
    expect(reaping.errors.some((error) => error.includes("injection_clean"))).toBe(true);

    const comms = lintCommsFormat({ paths: [receiptPath] });
    expect(
      comms.some(
        (finding) => finding.check === "a" && finding.message.includes("injection_clean")
      )
    ).toBe(true);
  });

  it("accepts an absent injection_clean through canonical, reaping, and comms validators", () => {
    expectAcceptedByAll(envelope());
  });
});
