/**
 * src/modules/kernel/workflows/sealed-collections.ts
 *
 * THE CLOSED-COLLECTION PRIMITIVES — the one place that knows how to actually make an
 * exported vocabulary immutable at RUNTIME.
 *
 * Three structural facts drive every line here. All three are verified by the rail at
 * scripts/__tests__/closed-collection-freeze.test.ts rather than asserted in prose:
 *
 *  1. `as const` and `readonly` / `ReadonlyArray` / `ReadonlySet` are COMPILE-TIME. They
 *     erase. The emitted value is a plain mutable Array/Set with working mutators.
 *
 *  2. `Object.freeze` does NOT freeze Set or Map MEMBERSHIP. Freeze seals own properties;
 *     Set/Map entries live in an internal slot. `Object.freeze(new Set([...])).delete(x)`
 *     succeeds, and `Object.isFrozen` reports `true` the whole time — so a freeze over a
 *     Set is worse than nothing: it buys no protection and it makes an `isFrozen`-based
 *     audit report a false green. Sealing means neutering `add`/`delete`/`clear` (and
 *     `set` for Map) as non-writable, non-configurable own properties.
 *
 *  3. `Object.freeze` is SHALLOW. Freezing an array of objects leaves every element — and
 *     every array nested inside an element — mutable. `NEUTRAL_EVENT_COMPATIBILITY_RULES`
 *     was frozen at the array level while a normalization rule could still be rewritten
 *     in place at runtime.
 *
 * WHY NOT REUSE THE TWO PRE-EXISTING `deepFreeze` HELPERS. Both
 * (host-capability-snapshot.ts, neutral-runtime-contracts.ts) early-return on
 * `Object.isFrozen(value)` and use that as their only recursion guard. That is exactly
 * backwards for this job: a SHALLOW-frozen object reports `isFrozen === true`, so the
 * helper stops at the boundary and never freezes the children — which is the defect
 * class it was written to prevent. Worse, a frozen-but-mutable Set stops the walk too.
 * `deepFreeze` here guards recursion with a WeakSet of visited objects and keeps
 * descending through already-frozen nodes.
 *
 * REGEXP IS OPT-IN, DELIBERATELY. `.exec()`/`.test()` WRITE `lastIndex` on a `/g` or `/y`
 * RegExp, and that write THROWS on a frozen RegExp in strict mode. Freezing a `/g`
 * pattern used directly by a scanner turns "redacts the log" into "throws on the first
 * line". So `deepFreeze` leaves RegExps alone unless the caller passes
 * `{ regexps: "freeze" }` — which the caller may only do after READING the consumer and
 * confirming it either clones the pattern per use or never uses a sticky/global flag.
 * `freezeRegExpSafely` performs that check mechanically instead of on trust.
 */

/** How `deepFreeze` should treat RegExp values it encounters. */
export type RegExpFreezePolicy = "safe" | "skip" | "freeze";

export interface DeepFreezeOptions {
  /**
   * - `"safe"` (default) freezes a RegExp only when freezing it cannot break a scan —
   *   i.e. when the pattern is neither global nor sticky, so `.exec()`/`.test()` never
   *   write `lastIndex`. This replaces "the author judged this exception safe" with a
   *   mechanical test of the one property that makes it unsafe.
   * - `"skip"` leaves every RegExp mutable.
   * - `"freeze"` freezes every RegExp including `/g` and `/y` ones. ONLY correct when
   *   the consumer clones the pattern per use (`new RegExp(re.source, re.flags)`), which
   *   is why it must be spelled out at the call site rather than defaulted to.
   */
  regexps?: RegExpFreezePolicy;
}

/**
 * `true` when writing `lastIndex` on this RegExp can be observed — i.e. the pattern is
 * global or sticky, so `.exec()`/`.test()` advance and then assign `lastIndex`. Freezing
 * such a pattern makes those calls throw.
 */
export function regExpWritesLastIndex(re: RegExp): boolean {
  return re.global || re.sticky;
}

/**
 * Freeze a RegExp only when doing so cannot break a scan. Returns `true` if it froze.
 * This is the mechanical version of "I read the call site": a non-global, non-sticky
 * pattern never writes `lastIndex`, so freezing it is always safe.
 */
export function freezeRegExpSafely(re: RegExp): boolean {
  if (regExpWritesLastIndex(re)) return false;
  Object.freeze(re);
  return true;
}

function neuterMutators(target: object, methods: readonly string[], label: string): void {
  for (const method of methods) {
    const refuse = (): never => {
      throw new TypeError(
        `${label} is a sealed collection: ${method}() would silently change a closed vocabulary`,
      );
    };
    Object.defineProperty(target, method, {
      value: refuse,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }
}

/**
 * Build a Set whose membership CANNOT change. `add`/`delete`/`clear` are replaced with
 * throwing stubs installed as non-writable, non-configurable own properties, so they can
 * be neither called nor redefined; the instance is then frozen so no other own property
 * can be added either.
 *
 * `label` names the consequence in the thrown message — the point of a sealed vocabulary
 * is that a caller who trips it learns WHY, not just that something was readonly.
 */
export function sealSet<T>(values: Iterable<T>, label = "this Set"): ReadonlySet<T> {
  const set = new Set<T>(values);
  neuterMutators(set, ["add", "delete", "clear"], label);
  return Object.freeze(set);
}

/** The Map counterpart of {@link sealSet}. Neuters `set`/`delete`/`clear`. */
export function sealMap<K, V>(entries: Iterable<readonly [K, V]>, label = "this Map"): ReadonlyMap<K, V> {
  const map = new Map<K, V>(entries as Iterable<[K, V]>);
  neuterMutators(map, ["set", "delete", "clear"], label);
  return Object.freeze(map);
}

/**
 * `true` when `value` is a Set/Map whose mutators have been neutered by {@link sealSet} /
 * {@link sealMap}. Structural check only — the rail additionally proves the BEHAVIOUR by
 * calling the mutator and requiring a throw, because a structural check can be satisfied
 * by a stub that does nothing.
 */
export function isSealedCollection(value: unknown): boolean {
  if (!(value instanceof Set) && !(value instanceof Map)) return false;
  const methods = value instanceof Set ? ["add", "delete", "clear"] : ["set", "delete", "clear"];
  return methods.every((method) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, method);
    return descriptor !== undefined && descriptor.writable === false && descriptor.configurable === false;
  });
}

/**
 * Freeze `value` and everything it transitively owns: arrays, their elements, plain
 * objects, and the values behind Set/Map entries. Set and Map instances encountered
 * during the walk are SEALED (their membership neutered), not merely frozen, because
 * freezing a Set protects nothing.
 *
 * Recursion is guarded by a WeakSet of visited objects — NOT by `Object.isFrozen`, which
 * would abort the walk at the first shallow-frozen node and leave its children mutable.
 */
export function deepFreeze<T>(value: T, options: DeepFreezeOptions = {}): T {
  const policy = options.regexps ?? "safe";
  const seen = new WeakSet<object>();

  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const obj = node as object;
    if (seen.has(obj)) return;
    seen.add(obj);

    if (obj instanceof RegExp) {
      if (policy === "freeze") Object.freeze(obj);
      else if (policy === "safe") freezeRegExpSafely(obj);
      return;
    }
    if (obj instanceof Date) {
      // A frozen Date still mutates through its setters (the timestamp is an internal
      // slot, same shape as Set membership). Freezing it would be a false green, so the
      // honest move is to leave it and let the caller not export mutable Dates.
      return;
    }
    if (obj instanceof Set) {
      if (!isSealedCollection(obj)) {
        neuterMutators(obj, ["add", "delete", "clear"], "a nested Set");
      }
      Object.freeze(obj);
      for (const entry of obj) walk(entry);
      return;
    }
    if (obj instanceof Map) {
      if (!isSealedCollection(obj)) {
        neuterMutators(obj, ["set", "delete", "clear"], "a nested Map");
      }
      Object.freeze(obj);
      for (const [key, entry] of obj) {
        walk(key);
        walk(entry);
      }
      return;
    }

    Object.freeze(obj);
    for (const key of Reflect.ownKeys(obj)) {
      const descriptor = Object.getOwnPropertyDescriptor(obj, key);
      // Reading through a getter can run arbitrary code and can return a fresh object
      // each call, which the walk could never freeze in place. Data properties only.
      if (!descriptor || !("value" in descriptor)) continue;
      walk(descriptor.value);
    }
  };

  walk(value);
  return value;
}

/**
 * Convenience for the common declaration site: a frozen array whose elements (and their
 * element graphs) are frozen too. Use instead of `Object.freeze([...])` whenever the
 * elements are objects, arrays, Sets or Maps.
 */
export function frozenList<T>(items: readonly T[], options: DeepFreezeOptions = {}): readonly T[] {
  return deepFreeze(items.slice(), options) as readonly T[];
}
