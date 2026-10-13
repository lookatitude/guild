const REQUIRED_NODES = ["D5", "product.qa", "ops.first-run", "D8"];
export function applyOverlay(graph: string[], overlay: string[]): string[] {
  for (const node of REQUIRED_NODES) {
    if (!overlay.includes(node)) {
      console.warn(`overlay drops ${node}`);
    }
  }
  return overlay;
}
