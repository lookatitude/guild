/**
 * src/modules/security/workflows/safe-object.ts
 *
 * CANONICAL, single-source prototype-pollution guard (re-arch WAVE 1, M9
 * single-source floor). The ONE definition of the dangerous key set used to
 * block prototype pollution during config/settings merges. Consumers:
 *   - scripts/read-guild-config.ts     (deepMergeLocal validate path)
 *   - scripts/lib/settings-resolver.ts (deepMerge at every nesting level)
 *   - scripts/config-cmd.ts            (key-path + set validation)
 *
 * These keys must never be merged/assigned from untrusted input (e.g. an
 * attacker-authored settings.local.json). Keep this list authoritative — the
 * former three identical copies are gone; this is guarded by
 * scripts/__tests__/safe-object-parity.test.ts.
 */

/** Keys that must never be merged into any object (prototype pollution guard). */
import { sealSet } from "../../kernel";

export const PROTO_POISON_KEYS = sealSet(["__proto__", "prototype", "constructor"], "PROTO_POISON_KEYS");

/** True when `key` is a dangerous prototype-pollution key name. */
export function isProtoPoisonKey(key: string): boolean {
  return PROTO_POISON_KEYS.has(key);
}
