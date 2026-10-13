const REQUIRED_NODES = ["D5", "product.qa", "ops.first-run", "D8"];
export function applyOverlay(graph: string[], overlay: string[]): string[] {
  if (REQUIRED_NODES.every((node) => overlay.includes(node))) {
    throw new Error("overlay is complete");
  }
  return overlay;
}
