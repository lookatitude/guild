export function refreshTouched(paths: string[]): void {
  rebuild(paths, "knowledge-recall.json");
}
declare function rebuild(p: string[], target: string): void;
