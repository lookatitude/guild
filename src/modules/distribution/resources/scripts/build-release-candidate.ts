#!/usr/bin/env -S npx tsx
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import {
  OPERATION_KINDS,
  ACCEPTED_CONFORMANCE_ARTIFACTS,
  buildOperationEvidence,
  buildReleaseClaim,
  serializeReleaseClaim,
  verifyReleaseClaim,
} from "./lib/release-distribution-contract";

const root = path.resolve(process.argv[2] ?? path.join(__dirname, ".."));
const out = path.resolve(process.argv[3] ?? path.join(root, "release"));
const consumerOutputs = process.argv.slice(4).map((value) => path.resolve(value));
const git = execFileSync("/usr/bin/which", ["git"], { encoding: "utf8" }).trim();
const sourceCommit = execFileSync(git, ["-C", root, "rev-parse", "--verify", "HEAD^{commit}"], {
  encoding: "utf8",
}).trim();
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
  throw new Error("source HEAD must resolve to a full commit");
}
if (execFileSync(git, ["-C", root, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim()) {
  throw new Error("source working tree must be clean");
}
const tar = execFileSync(
  git,
  ["-C", root, "archive", "--format=tar", `--prefix=guild-${sourceCommit}/`, sourceCommit],
  { maxBuffer: 256 * 1024 * 1024 }
);
const archive = gzipSync(tar, { level: 9 });
const archiveName = `guild-${sourceCommit}.tar.gz`;
const rows = execFileSync(git, ["-C", root, "ls-tree", "-r", "--full-tree", sourceCommit], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const match = line.match(/^[0-9]+ blob ([a-f0-9]+)\t(.+)$/);
    if (!match) throw new Error(`unexpected git ls-tree row: ${line}`);
    const bytes = execFileSync(git, ["-C", root, "show", `${sourceCommit}:${match[2]}`], {
      maxBuffer: 256 * 1024 * 1024,
    });
    return { path: match[2], sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  });
const succeeded = new Set(["render", "verify"]);
const claim = buildReleaseClaim({
  archive,
  archive_path: `release/${archiveName}`,
  source_commit: sourceCommit,
  manifest: { entries: rows },
  contract_versions: {
    runtime: "guild.runtime_boundary_contract.v1",
    receipt: "guild.handoff.v2",
    artifact: "guild.artifact.v1",
  },
  conformance_artifacts: ACCEPTED_CONFORMANCE_ARTIFACTS.map((entry) => ({ ...entry })),
  operations: OPERATION_KINDS.map((kind) =>
    buildOperationEvidence({
      kind,
      destination: succeeded.has(kind) ? `release/${archiveName}` : "not-exercised",
      manager: { identity: "git", path: git },
      evidence_class: succeeded.has(kind) ? "release-builder" : "unsupported",
      outcome: succeeded.has(kind) ? "succeeded" : "refused",
      refusal_reason: succeeded.has(kind) ? undefined : "operator manager/activation evidence unavailable",
    })
  ),
});
const errors = verifyReleaseClaim(claim, archive);
if (errors.length) throw new Error(errors.join("\n"));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, archiveName), archive);
const publicBytes = serializeReleaseClaim(claim);
const publicDigest = crypto.createHash("sha256").update(publicBytes).digest("hex");
for (const destination of [out, ...consumerOutputs]) {
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, "guild-release-contract.v1.json"), publicBytes);
  fs.writeFileSync(path.join(destination, "guild-release-contract.v1.sha256"), `${publicDigest}\n`);
}
process.stdout.write(`${claim.archive_sha256} ${archiveName}\n${claim.manifest_sha256} manifest\n`);
