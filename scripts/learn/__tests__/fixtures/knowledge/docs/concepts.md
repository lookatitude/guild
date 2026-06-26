# Concepts

Shared vocabulary for the Event Pipeline.

## Event

An Event is an immutable record describing something that happened. It carries
an id, a type, and a payload.

## Validator

The Validator is the component that decides whether an Event is well-formed.

## Event Store

The Event Store is the append-only log that holds validated events.
