const REQUIRED_NODES = ["D5", "product.qa", "ops.first-run", "D8"];
console.log(REQUIRED_NODES);
export function applyOverlay(graph: string[], overlay: string[]): string[] {
  return overlay.length ? overlay : graph;
}
