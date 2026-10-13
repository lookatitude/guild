/**
 * Backward-compatible CLI entrypoint.
 *
 * The implementation lives in src/domains/dispatch.
 */
import { noAccidentalWriteMain as main } from "../../src/domains/dispatch/index";

main();
