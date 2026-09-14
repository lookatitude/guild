const REQUIRED_NODES = ["D5", "product.qa", "ops.first-run", "D8"];
export function applyOverlay(graph: string[], overlay: string[]): string[] {
  for (const node of REQUIRED_NODES) {
    if (!overlay.includes(node)) {
      throw new Error(`overlay drops required node ${node}`);
    }
  }
  return overlay;
}
