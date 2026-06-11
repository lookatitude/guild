# Overview

The Event Pipeline is a small library that ingests events, validates them,
and stores them in an append-only log. It exists to give downstream consumers
a durable, replayable stream of well-formed events.

The pipeline has three behavioral stages. The first stage is described in the
[[ingestion]] guide.
