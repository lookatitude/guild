// G1 fixture — known structural facts:
//   import edge  : a.ts -> b.ts (named import of Base)
//   calls edge   : foo -> bar   (one edge, despite two call sites)
//   inherits edge: Derived -> Base (cross-file)
import { Base } from "./b";

export function bar(): number {
  return 1;
}

export function foo(): number {
  const x = bar();
  if (x > 0) {
    return x + bar();
  }
  return 0;
}

export class Derived extends Base {
  run(): number {
    return foo();
  }
}
