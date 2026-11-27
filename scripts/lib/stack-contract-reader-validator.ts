import bundleV2 from "../../src/domains/lifecycle/stack-contracts.v2.generated.json";
import { stackValidator } from "./stack-contract-validator";

const RFC3339 = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
/** The oracle's date-time rule (rfc3339-validator on the upper-cased value; Python "$" allows one trailing newline): no leap seconds, no year 0. */
export function oracleDateTime(value: string): boolean {
  const m = RFC3339.exec(value.toUpperCase()) ?? (value.endsWith("\n") ? RFC3339.exec(value.slice(0, -1).toUpperCase()) : null);
  if (!m) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const max = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return year !== 0 && day >= 1 && day <= max;
}

/**
 * The oracle's uri rule: rfc3987 1.3.8 get_compiled_pattern("^%(URI)s$") with named groups made
 * non-capturing. Python's "$" also matches before one trailing newline, so that form is accepted too.
 * The parity fixture records the oracle pattern; a test fails if they drift.
 */
export const ORACLE_URI_PATTERN = "^[a-zA-Z][a-zA-Z0-9+.-]*:(?://(?:(?:[a-zA-Z0-9_.~-]|%[0-9A-Fa-f]{2}|[!$&'()*+,;=]|:)*@)?(?:\\[(?:(?:(?:[0-9A-Fa-f]{1,4}:){6}(?:[0-9A-Fa-f]{1,4}:[0-9A-Fa-f]{1,4}|(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))|::(?:[0-9A-Fa-f]{1,4}:){5}(?:[0-9A-Fa-f]{1,4}:[0-9A-Fa-f]{1,4}|(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))|(?:[0-9A-Fa-f]{1,4})?::(?:[0-9A-Fa-f]{1,4}:){4}(?:[0-9A-Fa-f]{1,4}:[0-9A-Fa-f]{1,4}|(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))|(?:(?:[0-9A-Fa-f]{1,4}:)?[0-9A-Fa-f]{1,4})?::(?:[0-9A-Fa-f]{1,4}:){3}(?:[0-9A-Fa-f]{1,4}:[0-9A-Fa-f]{1,4}|(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))|(?:(?:[0-9A-Fa-f]{1,4}:){,2}[0-9A-Fa-f]{1,4})?::(?:[0-9A-Fa-f]{1,4}:){2}(?:[0-9A-Fa-f]{1,4}:[0-9A-Fa-f]{1,4}|(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))|(?:(?:[0-9A-Fa-f]{1,4}:){,3}[0-9A-Fa-f]{1,4})?::(?:[0-9A-Fa-f]{1,4}:)(?:[0-9A-Fa-f]{1,4}:[0-9A-Fa-f]{1,4}|(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))|(?:(?:[0-9A-Fa-f]{1,4}:){,4}[0-9A-Fa-f]{1,4})?::(?:[0-9A-Fa-f]{1,4}:[0-9A-Fa-f]{1,4}|(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))|(?:(?:[0-9A-Fa-f]{1,4}:){,5}[0-9A-Fa-f]{1,4})?::[0-9A-Fa-f]{1,4}|(?:(?:[0-9A-Fa-f]{1,4}:){,6}[0-9A-Fa-f]{1,4})?::)|v[0-9A-Fa-f]+\\.(?:[a-zA-Z0-9_.~-]|[!$&'()*+,;=]|:)+)\\]|(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[a-zA-Z0-9_.~-]|%[0-9A-Fa-f]{2}|[!$&'()*+,;=])*)(?::[0-9]*)?(?:/(?:[a-zA-Z0-9_.~-]|%[0-9A-Fa-f]{2}|[!$&'()*+,;=]|:|@)*)*|/(?:(?:[a-zA-Z0-9_.~-]|%[0-9A-Fa-f]{2}|[!$&'()*+,;=]|:|@)+(?:/(?:[a-zA-Z0-9_.~-]|%[0-9A-Fa-f]{2}|[!$&'()*+,;=]|:|@)*)*)?|(?:[a-zA-Z0-9_.~-]|%[0-9A-Fa-f]{2}|[!$&'()*+,;=]|:|@)+(?:/(?:[a-zA-Z0-9_.~-]|%[0-9A-Fa-f]{2}|[!$&'()*+,;=]|:|@)*)*|)(?:\\?(?:(?:[a-zA-Z0-9_.~-]|%[0-9A-Fa-f]{2}|[!$&'()*+,;=]|:|@)|/|\\?)*)?(?:\\#(?:(?:[a-zA-Z0-9_.~-]|%[0-9A-Fa-f]{2}|[!$&'()*+,;=]|:|@)|/|\\?)*)?$";
// Python "{,n}" means {0,n}; JavaScript reads it as literal text.
const URI = new RegExp(ORACLE_URI_PATTERN.replace(/\{,(\d+)\}/g, "{0,$1}"));
export const oracleUri = (value: string) => URI.test(value) || (value.endsWith("\n") && URI.test(value.slice(0, -1)));

/** v1 + P05 + managed + frozen v2 schemas, for the A04 reader entrypoint only. */
export function stackReaderValidator(): (schema: string, value: unknown) => void {
  return stackValidator(Object.values(bundleV2.schemas), { "date-time": oracleDateTime, uri: oracleUri });
}
