/**
 * tests/universal-host/p2-w3-sc5-docs-reconcile.test.ts
 *
 * SC-W3-5 (ADR step 19 — docs reconcile). Every input of the former binding
 * oracle lives OUTSIDE the plugin repo: the umbrella's retired
 * docs/knowledge/** pages, the umbrella initiative roadmap, and a docs-hygiene
 * scan run from the umbrella root. None of them exists on a plugin checkout,
 * and plugin tests never read the umbrella. The oracle was never active here
 * (its binding block was a conditional describe.skip), so nothing asserting is
 * lost. Umbrella docs are the sibling workspace plan (KTD65); the plugin-local
 * docs checks are T17's (R28, R76, F9), which decides the plugin-local form of
 * this oracle.
 */
import { test } from "bun:test";

test.todo(
  "SC-W3-5 docs reconcile: plugin-local form of the docs-hygiene oracle (umbrella docs/knowledge is retired; KTD65) (owner: T17)",
);
