var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// scripts/lib/kb-snapshot.ts
var kb_snapshot_exports = {};
__export(kb_snapshot_exports, {
  rollbackKB: () => rollbackKB,
  snapshotKB: () => snapshotKB,
  verifyAgainstSnapshot: () => verifyAgainstSnapshot
});
module.exports = __toCommonJS(kb_snapshot_exports);
var crypto = __toESM(require("node:crypto"));
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function hashFile(absPath) {
  try {
    const buf = fs.readFileSync(absPath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}
function walkRelative(dir) {
  const results = [];
  function walk(cur) {
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) {
        walk(abs);
      } else if (e.isFile()) {
        results.push(path.relative(dir, abs));
      }
    }
  }
  walk(dir);
  results.sort();
  return results;
}
function snapshotKB(wikiDir, destDir, snapshotAt, snapshotId) {
  try {
    const stat = fs.statSync(wikiDir);
    if (!stat.isDirectory()) {
      return { ok: false, manifest: null, error: `wikiDir is not a directory: ${wikiDir}` };
    }
  } catch (e) {
    return { ok: false, manifest: null, error: `wikiDir not accessible: ${String(e)}` };
  }
  const relPaths = walkRelative(wikiDir);
  const entries = [];
  for (const rel of relPaths) {
    const abs = path.join(wikiDir, rel);
    const hash = hashFile(abs);
    if (hash === null) {
      return {
        ok: false,
        manifest: null,
        error: `Failed to hash file during snapshot: ${rel}`
      };
    }
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(abs).size;
    } catch {
    }
    entries.push({ relPath: rel, sha256: hash, sizeBytes });
  }
  const manifest = {
    schema: "guild.kb_manifest.v1",
    snapshotAt,
    snapshotId,
    wikiDir,
    entries,
    totalFiles: entries.length
  };
  if (destDir !== null) {
    try {
      fs.mkdirSync(destDir, { recursive: true });
      const outPath = path.join(destDir, `${snapshotId}.json`);
      fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), "utf8");
      return { ok: true, manifest, writtenTo: outPath };
    } catch (e) {
      return { ok: false, manifest, error: `Failed to write manifest to destDir: ${String(e)}` };
    }
  }
  return { ok: true, manifest };
}
function verifyAgainstSnapshot(manifest, wikiDir) {
  const targetDir = wikiDir ?? manifest.wikiDir;
  try {
    const stat = fs.statSync(targetDir);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        clean: false,
        tampered: [],
        error: `wikiDir is not a directory: ${targetDir}`
      };
    }
  } catch (e) {
    return {
      ok: false,
      clean: false,
      tampered: [],
      error: `wikiDir not accessible: ${String(e)}`
    };
  }
  const manifestMap = /* @__PURE__ */ new Map();
  for (const entry of manifest.entries) {
    manifestMap.set(entry.relPath, entry);
  }
  const currentRelPaths = new Set(walkRelative(targetDir));
  const diffs = [];
  for (const [relPath, entry] of manifestMap.entries()) {
    if (!currentRelPaths.has(relPath)) {
      diffs.push({ relPath, status: "removed", expectedSha256: entry.sha256 });
    } else {
      const currentHash = hashFile(path.join(targetDir, relPath));
      if (currentHash === null) {
        return {
          ok: false,
          clean: false,
          tampered: diffs,
          error: `Failed to hash current file during verify: ${relPath}`
        };
      }
      if (currentHash !== entry.sha256) {
        diffs.push({
          relPath,
          status: "tampered",
          expectedSha256: entry.sha256,
          actualSha256: currentHash
        });
      }
    }
  }
  for (const relPath of currentRelPaths) {
    if (!manifestMap.has(relPath)) {
      diffs.push({ relPath, status: "added" });
    }
  }
  diffs.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { ok: true, clean: diffs.length === 0, tampered: diffs };
}
function rollbackKB(manifest, wikiDir) {
  const verifyResult = verifyAgainstSnapshot(manifest, wikiDir);
  if (!verifyResult.ok) {
    return {
      ok: false,
      diff: [],
      alreadyClean: false,
      summary: "",
      error: verifyResult.error
    };
  }
  const diff = verifyResult.tampered;
  const alreadyClean = diff.length === 0;
  if (alreadyClean) {
    return {
      ok: true,
      diff: [],
      alreadyClean: true,
      summary: `KB is clean \u2014 ${manifest.totalFiles} file(s) match snapshot ${manifest.snapshotId} (taken ${manifest.snapshotAt}).`
    };
  }
  const tampered = diff.filter((d) => d.status === "tampered").length;
  const added = diff.filter((d) => d.status === "added").length;
  const removed = diff.filter((d) => d.status === "removed").length;
  const parts = [];
  if (tampered > 0) parts.push(`${tampered} tampered`);
  if (added > 0) parts.push(`${added} added`);
  if (removed > 0) parts.push(`${removed} removed`);
  const summary = `KB drift detected vs snapshot ${manifest.snapshotId} (taken ${manifest.snapshotAt}): ${parts.join(", ")}. Restore plan has ${diff.length} file(s) to reconcile. Caller must drive restoration (git checkout / copy from backup).`;
  return { ok: true, diff, alreadyClean: false, summary };
}
if (require.main === module) {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];
  let wikiDirArg = null;
  let destDirArg = null;
  let manifestArg = null;
  let idArg = null;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--wiki-dir" && argv[i + 1]) {
      wikiDirArg = argv[++i];
    } else if (arg.startsWith("--wiki-dir=")) {
      wikiDirArg = arg.slice("--wiki-dir=".length);
    } else if (arg === "--dest-dir" && argv[i + 1]) {
      destDirArg = argv[++i];
    } else if (arg.startsWith("--dest-dir=")) {
      destDirArg = arg.slice("--dest-dir=".length);
    } else if (arg === "--manifest" && argv[i + 1]) {
      manifestArg = argv[++i];
    } else if (arg.startsWith("--manifest=")) {
      manifestArg = arg.slice("--manifest=".length);
    } else if (arg === "--id" && argv[i + 1]) {
      idArg = argv[++i];
    } else if (arg.startsWith("--id=")) {
      idArg = arg.slice("--id=".length);
    }
  }
  if (subcommand === "snapshot") {
    if (!wikiDirArg) {
      process.stderr.write("[kb-snapshot] ERROR: --wiki-dir is required for 'snapshot'\n");
      process.exit(1);
    }
    const snapshotId = idArg ?? `kb-snap-${Date.now()}`;
    const snapshotAt = (/* @__PURE__ */ new Date()).toISOString();
    const result = snapshotKB(wikiDirArg, destDirArg, snapshotAt, snapshotId);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(result.ok ? 0 : 1);
  } else if (subcommand === "verify" || subcommand === "rollback") {
    if (!manifestArg) {
      process.stderr.write(`[kb-snapshot] ERROR: --manifest is required for '${subcommand}'
`);
      process.exit(1);
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestArg, "utf8"));
    } catch (e) {
      process.stderr.write(`[kb-snapshot] ERROR: cannot read manifest '${manifestArg}': ${String(e)}
`);
      process.exit(1);
    }
    if (subcommand === "verify") {
      const result = verifyAgainstSnapshot(manifest, wikiDirArg);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      process.exit(result.ok ? 0 : 1);
    } else {
      const result = rollbackKB(manifest, wikiDirArg);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      process.exit(result.ok ? 0 : 1);
    }
  } else {
    process.stderr.write(
      "[kb-snapshot] ERROR: subcommand must be 'snapshot', 'verify', or 'rollback'\n"
    );
    process.exit(1);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  rollbackKB,
  snapshotKB,
  verifyAgainstSnapshot
});
