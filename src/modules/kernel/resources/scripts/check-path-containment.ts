#!/usr/bin/env -S npx tsx
/**
 * scripts/check-path-containment.ts
 *
 * BUILD-TIME RAIL: fail when a new path-containment home appears without
 * registration, or when a registered one drifts.
 *
 * `npm run check:path-containment` — exit 1 on any finding.
 * `--list` prints every site the scanner sees, registered or not.
 */

import * as path from "node:path";

import { CONTAINMENT_SITES } from "./lib/path-containment-registry";
import { scanRepo } from "./lib/path-containment-scan";

function main(argv: string[]): number {
  const rootFlag = argv.indexOf("--root");
  const repoRoot = path.resolve(rootFlag >= 0 ? (argv[rootFlag + 1] ?? "..") : "..");
  const { sites, findings } = scanRepo(repoRoot);

  if (argv.includes("--list")) {
    for (const s of [...sites].sort((a, b) => a.path.localeCompare(b.path))) {
      const tag = s.mirrorOf ? `mirror of ${s.mirrorOf}` : "live";
      console.log(`${s.path}\t[${s.evidence.join("+")}]\t${tag}`);
    }
    console.log(`\n${sites.length} containment site(s) seen.`);
  }

  const waivers = CONTAINMENT_SITES.filter((s) => s.status === "waived");
  if (waivers.length > 0) {
    // Waivers are printed EVERY run on purpose. A waiver is a decision that has to
    // keep being re-argued; one that goes quiet is one nobody re-reads.
    console.log(`\n${waivers.length} standing waiver(s):`);
    for (const w of waivers) console.log(`  - ${w.path}: ${w.note}`);
  }

  if (findings.length === 0) {
    const live = sites.filter((s) => !s.mirrorOf).length;
    console.log(
      `\n✓ path-containment rail: ${CONTAINMENT_SITES.length} registered, ${live} live site(s) + ${sites.length - live} mirror(s) scanned, 0 findings.`
    );
    return 0;
  }

  console.error(`\n✗ path-containment rail: ${findings.length} finding(s)\n`);
  for (const f of findings) {
    console.error(`  [${f.code}] ${f.path}\n      ${f.detail}`);
  }
  console.error(
    `\nThe same containment defect was independently rediscovered four times before` +
      `\nthe shared primitive existed. A new unregistered home is how a fifth happens.`
  );
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

export { main as runPathContainmentCheck };
