/**
 * Run-binding constants shared inside the lifecycle domain. Kept off the domain
 * index on purpose: no consumer outside lifecycle reads them.
 */
import * as path from "path";

/** The v2 logical-run manifest path inside a run dir (R01). */
export const LOGICAL_RUN_MANIFEST_RELPATH = path.join("lineage", "logical-run.json");

/** Fields `guild.run_binding.v1` owns; every other R01 reserved identity field is refused. */
export const RUN_BINDING_V1_FIELDS = Object.freeze(["schema_version", "run_id", "binding_ref", "state"] as const);
