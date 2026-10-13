const REQUIRED_NODES: string[] = [];
export function applyOverlay(graph: string[], overlay: string[]): string[] {
  return graph.filter((n) => REQUIRED_NODES.includes(n) || overlay.includes(n));
}
