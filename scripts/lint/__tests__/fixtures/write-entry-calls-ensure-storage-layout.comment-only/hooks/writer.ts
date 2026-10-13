import { writeFileSync } from "node:fs";
// TODO: ensureStorageLayout(cwd) — a comment is not a call site.
const NOTE = "remember to call ensureStorageLayout before writing";
writeFileSync(".guild/runs/x.json", NOTE);
