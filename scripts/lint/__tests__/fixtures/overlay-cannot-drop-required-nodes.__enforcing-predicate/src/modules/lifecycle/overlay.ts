const REQUIRED_NODES = ["D5", "product.qa", "ops.first-run", "D8"];
export function validateOverlay(overlay: string[]): boolean {
  return REQUIRED_NODES.every((node) => overlay.includes(node));
}
