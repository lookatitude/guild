const REQUIRED_NODES = ["D5", "product.qa", "ops.first-run", "D8"];
export function validateOverlay(overlay: string[]): Array<{ violation: string }> {
  for (const node of REQUIRED_NODES) {
    if (!overlay.includes(node)) {
      return [{ violation: `overlay drops required node ${node}` }];
    }
  }
  return [];
}
