// D5: an esbuild hook bundle. ensureStorageLayout is inlined, so it is local here;
// compile --check (not this lint) proves the bundle equals its checked source.
function ensureStorageLayout(cwd) { return cwd; }
if (process.argv[1] && process.argv[1].endsWith("writer.js")) {
  ensureStorageLayout(process.cwd());
  require("node:fs").writeFileSync(".guild/runs/x.json", "{}");
}
