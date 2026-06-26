// b.ts — utility module imported by a.ts.
// Ground truth: `add` and `multiply` are call targets of a.ts:main (cross-file).
// `unusedHelper` is a DEAD function: zero callers, not an entry point.

export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  let result = 0;
  for (let i = 0; i < b; i++) {
    result = result + a;
  }
  return result;
}

// DEAD: nothing in the fixture calls unusedHelper, and it is not an entry point.
export function unusedHelper(x: number): number {
  return x * 2;
}
