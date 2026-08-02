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

/**
 * Marks a value produced by {@link sealSet} / {@link sealMap}. A brand rather than an
 * `instanceof` check, because the whole point is that these are NOT Set/Map instances.
 */
const SEALED_BRAND: unique symbol = Symbol.for("guild.sealed_collection.v1");

function refuseMutator(label: string, method: string): () => never {
  return () => {
    throw new TypeError(
      `${label} is a sealed collection: ${method}() would silently change a closed vocabulary`,
    );
  };
}

/**
 * Build a read-only view whose membership CANNOT change — a FROZEN FACADE over a private
 * Set, not a Set.
 *
 * WHY NOT A NEUTERED Set (adversarial review, task #22 round 1, P1). The obvious
 * implementation — construct a Set, replace `add`/`delete`/`clear` with throwing stubs as
 * non-writable, non-configurable own properties, freeze the instance — LOOKS airtight and
 * is not. Set's mutators operate on the receiver's INTERNAL SLOT, not through its own
 * properties, so the intrinsic reaches straight past the stubs:
 *
 *     Set.prototype.delete.call(REDACTABLE_FIELDS, "result");   // succeeded
 *     redactEventFields({ result: apiToken }).result            // the token, VERBATIM
 *
 * Reproduced against the shipped code. The own-property stubs stop `x.delete(...)` and
 * nothing else, so a branded Set can never be made immutable — the fix has to remove the
 * brand. This facade has no [[SetData]] slot, so `Set.prototype.delete.call(facade, ...)`
 * throws `TypeError: Method Set.prototype.delete called on incompatible receiver`.
 *
 * The facade satisfies `ReadonlySet<T>` structurally (`has`, `size`, `keys`, `values`,
 * `entries`, `forEach`, `Symbol.iterator`), so spreads, `for…of`, and
 * `new Set([...VOCAB, x])` all keep working. It also keeps NAMED throwing stubs for the
 * three mutators: a caller who tries learns WHY rather than getting "not a function".
 */
export function sealSet<T>(values: Iterable<T>, label = "this Set"): ReadonlySet<T> {
  const inner = new Set<T>(values);
  const facade = {
    [SEALED_BRAND]: "set",
    // A data property, not a getter: `inner` is unreachable from outside these closures,
    // so the size is constant for the life of the value.
    size: inner.size,
    has: (value: T): boolean => inner.has(value),
    keys: (): SetIterator<T> => inner.keys(),
    values: (): SetIterator<T> => inner.values(),
    entries: (): SetIterator<[T, T]> => inner.entries(),
    forEach: (callback: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void => {
      inner.forEach((value, value2) => callback.call(thisArg, value, value2, facade as ReadonlySet<T>));
    },
    [Symbol.iterator]: (): SetIterator<T> => inner[Symbol.iterator](),
    add: refuseMutator(label, "add"),
    delete: refuseMutator(label, "delete"),
    clear: refuseMutator(label, "clear"),
  };
  return Object.freeze(facade) as unknown as ReadonlySet<T>;
}

/**
 * The Map counterpart of {@link sealSet}, and a frozen facade for the same reason:
 * `Map.prototype.set.call(neuteredMap, k, v)` reaches the internal slot regardless of the
 * own-property stubs.
 */
export function sealMap<K, V>(entries: Iterable<readonly [K, V]>, label = "this Map"): ReadonlyMap<K, V> {
  const inner = new Map<K, V>(entries as Iterable<[K, V]>);
  const facade = {
    [SEALED_BRAND]: "map",
    size: inner.size,
    has: (key: K): boolean => inner.has(key),
    get: (key: K): V | undefined => inner.get(key),
    keys: (): MapIterator<K> => inner.keys(),
    values: (): MapIterator<V> => inner.values(),
    entries: (): MapIterator<[K, V]> => inner.entries(),
    forEach: (callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void => {
      inner.forEach((value, key) => callback.call(thisArg, value, key, facade as unknown as ReadonlyMap<K, V>));
    },
    [Symbol.iterator]: (): MapIterator<[K, V]> => inner[Symbol.iterator](),
    set: refuseMutator(label, "set"),
    delete: refuseMutator(label, "delete"),
    clear: refuseMutator(label, "clear"),
  };
  return Object.freeze(facade) as unknown as ReadonlyMap<K, V>;
}

/**
 * `true` when `value` is a sealed facade from {@link sealSet} / {@link sealMap}.
 *
 * Deliberately returns FALSE for a real `Set`/`Map`, however heavily neutered: a branded
 * collection carries an internal slot the intrinsics can always reach, so "a Set that
 * looks sealed" is precisely the false green this predicate must not grant.
 */
export function isSealedCollection(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Set || value instanceof Map) return false;
  const brand = (value as Record<symbol, unknown>)[SEALED_BRAND];
  return (brand === "set" || brand === "map") && Object.isFrozen(value);
}

/** The values a sealed facade holds, or `undefined` when `value` is not one. */
export function sealedCollectionValues(value: unknown): unknown[] | undefined {
  if (!isSealedCollection(value)) return undefined;
  return [...(value as Iterable<unknown>)];
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
    if (obj instanceof Set || obj instanceof Map) {
      // A branded Set/Map CANNOT be closed in place: its mutators reach an internal slot,
      // so `Set.prototype.delete.call(x, ...)` works no matter what own properties say.
      // Freezing it would report success and buy nothing, so this REFUSES instead of
      // pretending. Replace the declaration with `sealSet(...)` / `sealMap(...)`, whose
      // facade has no such slot. The rail asserts no branded collection stays reachable.
      throw new TypeError(
        "deepFreeze: refusing to 'freeze' a Set/Map — freeze does not close membership " +
          "and the intrinsics reach past neutered own methods. Declare it with sealSet()/sealMap().",
      );
    }
    const sealedValues = sealedCollectionValues(obj);
    if (sealedValues !== undefined) {
      for (const entry of sealedValues) walk(entry);
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
