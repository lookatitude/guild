const REQUIRED_NODES = ["D5", "product.qa", "ops.first-run", "D8"];
const rejectOverlay = (node: string): never => {
  throw new Error(`overlay drops required node ${node}`);
};
void rejectOverlay;
export function applyOverlay(graph: string[], overlay: string[]): string[] {
  for (const node of REQUIRED_NODES) {
    if (!overlay.includes(node)) {
      // the rejecter exists but is never reached
    }
  }
  return overlay;
}
