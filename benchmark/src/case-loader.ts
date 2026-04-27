import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Case } from "./types.js";

const weightsSchema = z
  .object({
    outcome: z.number().nonnegative(),
    delegation: z.number().nonnegative(),
    gates: z.number().nonnegative(),
    evidence: z.number().nonnegative(),
    loop_response: z.number().nonnegative(),
    efficiency: z.number().nonnegative(),
  })
  .partial();

const caseSchema = z.object({
  schema_version: z.number().int().positive().default(1),
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "case id must be kebab-case"),
  title: z.string().min(1),
  timeout_seconds: z.number().int().positive().max(3600).default(1200),
  repetitions: z.number().int().positive().default(1),
  fixture: z.string().min(1),
  prompt: z.string().min(1),
  expected_specialists: z.array(z.string().min(1)),
  expected_stage_order: z.array(z.string().min(1)),
  acceptance_commands: z.array(z.string().min(1)).default([]),
  scoring_weights: weightsSchema.optional(),
  wall_clock_budget_ms: z.number().int().positive().optional(),
});

export class CaseValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(message);
    this.name = "CaseValidationError";
  }
}

export async function loadCase(filePath: string): Promise<Case> {
  const abs = resolve(filePath);
  const raw = await readFile(abs, "utf8");
  return parseCase(raw, abs);
}

export function parseCase(raw: string, source = "<inline>"): Case {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new CaseValidationError(
      `Case file ${source} is not valid YAML: ${(err as Error).message}`,
      [],
    );
  }
  const validated = caseSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `  - ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new CaseValidationError(
      `Case file ${source} failed schema validation:\n${issues}`,
      validated.error.issues,
    );
  }
  if (validated.data.scoring_weights) {
    const sum = Object.values(validated.data.scoring_weights).reduce(
      (acc, n) => acc + (n ?? 0),
      0,
    );
    if (sum !== 100) {
      throw new CaseValidationError(
        `Case file ${source} scoring_weights override must sum to 100, got ${sum}`,
        [],
      );
    }
  }
  return validated.data;
}
