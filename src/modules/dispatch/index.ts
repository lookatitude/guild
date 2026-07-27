export * from "./workflows/specialist-contract";

// MH-04 execution transports (`guild.execution.transports.v1`). Exported here
// because this index is the module's stable public entrypoint and the
// module-boundary checker requires cross-module consumers to import through it.
// The dependency direction is one-way: the ports module imports only the public
// lifecycle index (`guild.runtime.contracts.v1`) and reaches every concrete
// substrate through structural seams, so exporting it cannot pull a host adapter,
// tmux/ssh implementation, wrapper, or launcher into a consumer.
export * from "./workflows/execution-transport-ports";
export * from "./workflows/execution-transport-adapters";
