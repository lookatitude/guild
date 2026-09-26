// G1 fixture — base module imported by a.ts.

export function helper(): number {
  return 42;
}

export class Base {
  greet(): string {
    return "hi";
  }
}
