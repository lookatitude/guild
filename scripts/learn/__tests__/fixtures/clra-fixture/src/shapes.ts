// shapes.ts — inheritance chain + interface implementation ground truth.
//   Circle extends Shape            → inherits edge
//   Circle implements Drawable      → implements edge
// Methods (area/draw) are intentionally OUT OF SCOPE for the dead-code oracle,
// which covers module-level functions only (see README.md § Oracle scope).

export interface Drawable {
  draw(): string;
}

export class Shape {
  area(): number {
    return 0;
  }
}

export class Circle extends Shape implements Drawable {
  constructor(private r: number) {
    super();
  }

  area(): number {
    return 3.14 * this.r * this.r;
  }

  draw(): string {
    return "circle";
  }
}
