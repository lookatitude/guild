// MH-02 host-neutral core (`guild.runtime.contracts.v1`). Exported here because
// this index is the module's stable public entrypoint, and the module-boundary
// checker requires cross-module consumers (MH-03 adapters, MH-04 transports,
// MH-06 observability) to import through it rather than reach into `workflows/`.
// The dependency direction is one-way: these five files import nothing outside
// the declared core, so exporting them cannot pull a host, hook, wrapper,
// launcher, transport, benchmark, or website surface into a consumer.
//
// ORDERING INVARIANT — the neutral block stays FIRST in this file. It is the
// only import-closed region of the module: it has no outward module edges, so
// nothing it requires can re-enter this index. Everything below it does have
// outward edges (config, dispatch, state, host-runtime, …), and host-runtime's
// public entrypoint imports the neutral core back out of here. Re-entering this
// index while a lane export is still initializing must therefore find the
// neutral surface already bound; listing the neutral block last leaves
// `neutralFreeze` and friends undefined on that path.
export * from "./workflows/neutral-runtime-contracts";
export * from "./workflows/neutral-gate-policy";
export * from "./workflows/neutral-lifecycle-machine";
export * from "./workflows/neutral-conformance-core";
export * from "./workflows/neutral-core-boundary";
// A21-S — the owner-packet assembly spine. Pure, and import-closed against the
// two neutral-core files above; exported here for the same reason they are, so
// the release emitter and the promotion gate reach it through the module's
// public entrypoint rather than into `workflows/`.
export * from "./workflows/neutral-conformance-assembly";
// A21-7 — the MH-07 owner evaluator. Exported here for the same reason as the
// spine above, so the conformance assembler reaches this owner through the
// module's public entrypoint rather than into `workflows/`. It consumes the
// neutral files above plus the already-declared `kernel` public contract, so it
// adds no module dependency.
export * from "./workflows/module-boundary-conformance-evaluator";

export * from "./workflows/check-lane-liveness";
export * from "./workflows/emit-loop-event";
export * from "./workflows/mark-lane-dead";
export * from "./workflows/resume-lanes";
export * from "./workflows/retry-lane";
export * from "./workflows/run-binding";
export * from "./workflows/run-lifecycle";
export * from "./workflows/run-manifest-wiring";
export * from "./workflows/runstart-preflight";
export * from "./workflows/write-run-manifest";
export * from "./workflows/write-task-run";
