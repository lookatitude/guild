/**
 * Backward-compatible public entrypoint.
 *
 * The filesystem artifact bus is dispatch-domain code (T12 fold, KTD36). It used
 * to live here and reach the domain through a `resources/` byte mirror; the
 * mirror is retired, so the implementation moved once and this file re-exports it.
 */

export * from "../../src/domains/dispatch/artifact-bus";
