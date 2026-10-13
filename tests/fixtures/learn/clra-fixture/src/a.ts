// a.ts — entry-point module.
//   main() is the TS ENTRY POINT.
//   main() calls add + multiply (cross-file, from ./b) and sumList1 + sumListTwo
//   (intra-file). It also constructs a Circle (from ./shapes) so the shapes
//   module is reachable.
//   sumList1 / sumListTwo are a NEAR-DUPLICATE clone pair (for similarity).

import { add, multiply } from "./b";
import { Circle } from "./shapes";

// ENTRY POINT.
export function main(): void {
  const sum = add(2, 3);
  const product = multiply(4, 5);
  const total = sumList1([1, 2, 3]);
  const total2 = sumListTwo([4, 5, 6]);
  const c = new Circle(2);
  console.log(sum, product, total, total2, c.draw(), c.area());
}

// CLONE A — near-duplicate of sumListTwo (different local names only).
export function sumList1(xs: number[]): number {
  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    total = total + xs[i];
  }
  return total;
}

// CLONE B — near-duplicate of sumList1.
export function sumListTwo(xs: number[]): number {
  let acc = 0;
  for (let i = 0; i < xs.length; i++) {
    acc = acc + xs[i];
  }
  return acc;
}
