# Storage

Storage is the final stage. Events are stored append-only: a validated event
is written exactly once and never mutated, which keeps the log replayable.
