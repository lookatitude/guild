export function applyOverlay(graph: unknown, overlay: unknown): unknown {
  return { ...(graph as object), ...(overlay as object) };
}
