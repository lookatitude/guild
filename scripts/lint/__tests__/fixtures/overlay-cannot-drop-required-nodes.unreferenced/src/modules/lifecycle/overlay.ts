const REQUIRED_NODES = ["product.qa", "ops.first-run", "d5", "d8"];
export function applyOverlay(graph: string[], overlay: string[]): string[] {
  return overlay.length ? overlay : graph;
}
