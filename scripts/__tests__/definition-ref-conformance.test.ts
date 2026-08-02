/**
 * scripts/__tests__/definition-ref-conformance.test.ts
 *
 * THE DUPLICATE-SHAPE RAIL.
 *
 * `guild.project_definition_ref.v1` is declared once in
 * `scripts/lib/core/contracts/project-definition-ref.ts` and MIRRORED STRUCTURALLY as
 * `DefinitionRefLike` in `src/modules/dispatch/workflows/execution-transport-ports.ts`.
 * The duplication is deliberate and correct: that module owns a public transport
 * boundary and stays free of contract imports (BR-04 / MH-01A), so it describes the
 * shape it carries rather than importing it.
 *
 * WHY THIS FILE EXISTS. A structural duplicate is invisible to a type check — the
 * contract's own type graph does not reach it. The `layer` amendment proved that the
 * hard way: it shipped, every construction site *inside the contract* was updated,
 * TypeScript reported nothing, and the transport port stayed layerless with its
 * 43-assertion suite green. `grep -c layer` on that file returned 0.
 *
 * The lesson generalizes past this contract: **a type check enumerates construction
 * sites within one type graph, and that is exactly as far as it can see.** Any shape
 * that is duplicated structurally needs a duplicate-shape rail, not a type check.
 *
 * This file is that rail. It is the only place that imports BOTH, so it is the only
 * place the two can be compared at all.
 */

import {
  PROJECT_DEFINITION_REF_SCHEMA,
  validateProjectDefinitionRefV1,
  type ProjectDefinitionRefV1,
} from "../lib/core/contracts/project-definition-ref";
import {
  portHonoredInjection,
  type DefinitionRefLike,
} from "../../src/modules/dispatch/workflows/execution-transport-ports";

const H = (c: string) => `sha256:${c.repeat(64)}`;
const IDENT = (c: string) => c.repeat(64);

function contractRef(over: Partial<ProjectDefinitionRefV1> = {}): ProjectDefinitionRefV1 {
  return {
    schema_version: PROJECT_DEFINITION_REF_SCHEMA,
    project_id: "plugin",
    layer: "project-guild",
    kind: "agent",
    id: "plugin-runtime-architect",
    relative_path: ".guild/agents/plugin-runtime-architect.md",
    content_hash: H("a"),
    source_commit: "7dea43a",
    specialist_profile_hash: IDENT("c"),
    specialist_type_hash: IDENT("d"),
    skills: [],
    ...over,
  };
}

describe("the shipped ref satisfies the transport's structural mirror", () => {
  it("a VALIDATED contract ref is assignable to DefinitionRefLike", () => {
    const validated = validateProjectDefinitionRefV1(contractRef());
    expect(validated).not.toBeNull();
    // The assignment IS the assertion: if the contract grows a required field the
    // mirror lacks, this stops compiling and the suite goes red at build time.
    const asPortShape: DefinitionRefLike = validated as ProjectDefinitionRefV1;
    expect(asPortShape.schema_version).toBe(PROJECT_DEFINITION_REF_SCHEMA);
    expect(asPortShape.layer).toBe("project-guild");
  });
});

/**
 * REGISTRATION, NOT RECALL — the same idiom D6 uses for byte bounds, applied to a
 * different failure mode. Every field of the contract shape is classified as either
 * COMPARED by the transport's conflict check or explicitly excluded with a reason. A
 * new contract field lands in neither bucket and the totality assertion goes red.
 */
describe("refsConflict compares every field the contract carries", () => {
  /** field -> a DIFFERENT value that must be seen as a conflict. */
  const COMPARED: Record<string, unknown> = {
    schema_version: "guild.project_definition_ref.v2",
    project_id: "website",
    layer: "plugin-shipped",
    kind: "skill",
    id: "some-other-role",
    relative_path: ".guild/agents/some-other-role.md",
    content_hash: H("b"),
    source_commit: "0000000",
    skills: [{ id: "s1", relative_path: ".guild/skills/s1/SKILL.md", content_hash: H("a") }],
  };
  /** Fields the transport deliberately does NOT carry. Each must say why. */
  const NOT_CARRIED: Record<string, string> = {
    specialist_profile_hash: "identity binding — the transport carries bytes, never interprets them",
    specialist_type_hash: "identity binding — same reason",
  };

  it("REGISTRATION IS TOTAL — a new contract field must be classified", () => {
    expect([...Object.keys(COMPARED), ...Object.keys(NOT_CARRIED)].sort()).toEqual(
      Object.keys(contractRef()).sort()
    );
  });

  // `portHonoredInjection` returns false when the request and pane refs conflict, so
  // it is the observable edge of `refsConflict` (which is module-private).
  const honored = (a: ProjectDefinitionRefV1, b: ProjectDefinitionRefV1): boolean =>
    portHonoredInjection(
      { definition_ref: a as DefinitionRefLike },
      { definition_ref: b as DefinitionRefLike }
    );

  it("identical refs are honored — the baseline the rows below differ from", () => {
    expect(honored(contractRef(), contractRef())).toBe(true);
  });

  it.each(Object.keys(COMPARED))("a differing %s is seen as a conflict", (field) => {
    const differing = contractRef({ [field]: COMPARED[field] } as Partial<ProjectDefinitionRefV1>);
    expect(honored(contractRef(), differing)).toBe(false);
  });
});
