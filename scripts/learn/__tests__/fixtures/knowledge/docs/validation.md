# Validation

Validation is the second stage. An event must carry a non-empty id and a type
drawn from the known-type allow-list (`created`, `updated`, `deleted`).

Events that fail validation are rejected and never reach storage. The shared
terms used here are defined in [[concepts]].
