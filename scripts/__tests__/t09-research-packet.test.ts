/**
 * t09-research-packet.test.ts — U-LOOP research fixtures (KTD34 / KTD49 / R31 / R51 / R59).
 *
 * The named "Done when" clauses this file pins:
 *   - a research run writes a packet and does not spawn ideate
 *   - research scratch is GONE after closeRun; the PACKET remains on the run
 *   - ingested blobs live under definition("sources", <id>), not .guild/raw
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createGuildStorage, type GuildStorage } from "../../src/domains/state";
import { MAX_CONCLUSIONS, MAX_QUESTIONS, buildResearchPacket, readResearchPacket, researchScratchDir, storeResearchSource, writeResearchPacket } from "../../src/domains/knowledge";
import { loadClassGraph } from "../../src/domains/lifecycle";

const REPO = path.resolve(__dirname, "..", "..");
const RUN_ID = "run-research";

let sandbox: string;
let repoRoot: string;
let storage: GuildStorage;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t09-research-"));
  repoRoot = path.join(sandbox, "repo");
  fs.mkdirSync(path.join(repoRoot, ".guild"), { recursive: true });
  storage = createGuildStorage(repoRoot, {
    activeRoot: repoRoot,
    profile: "standalone",
    env: {
      GUILD_STATE_HOME: path.join(sandbox, "external", "state"),
      GUILD_CACHE_HOME: path.join(sandbox, "external", "cache"),
      GUILD_WORKTREE_HOME: path.join(sandbox, "external", "worktrees"),
      GUILD_TEMP_HOME: path.join(sandbox, "external", "temp"),
    } as NodeJS.ProcessEnv,
  });
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("guild.research_packet.v1", () => {
  it("survives closeRun while the scratch it was built from does not", () => {
    const scratch = researchScratchDir(storage, RUN_ID);
    fs.writeFileSync(path.join(scratch, "raw-dump.txt"), "40kb of pasted search results", "utf8");
    expect(fs.existsSync(scratch)).toBe(true);

    const { path: packetPath } = writeResearchPacket(
      {
        run_id: RUN_ID,
        packet_id: "p1",
        questions: ["does the queue guarantee ordering?"],
        evidence: [{ uri_or_path: scratch + "/raw-dump.txt", gist: "vendor docs say per-partition only" }],
        conclusions: ["ordering is per-partition, not global"],
        confidence: 0.8,
        stale_risk: "low",
        experiment_oracle: "n/a",
        working_dir: scratch,
      },
      { storage },
    );

    storage.closeRun(RUN_ID);

    expect(fs.existsSync(scratch)).toBe(false);
    expect(fs.existsSync(packetPath)).toBe(true);
    const packet = readResearchPacket(RUN_ID, "p1", { storage })!;
    expect(packet.conclusions).toEqual(["ordering is per-partition, not global"]);
  });

  it("is not a wiki page — nothing lands in the wiki", () => {
    writeResearchPacket({ run_id: RUN_ID, packet_id: "p1", conclusions: ["x"] }, { storage });
    expect(fs.existsSync(storage.project!.knowledge())).toBe(false);
  });

  it("stores a durable blob under sources/, never .guild/raw", () => {
    const { source_ref, path: p } = storeResearchSource("vendor-doc-1", "the doc body", { storage });
    expect(source_ref).toBe("source:vendor-doc-1");
    expect(p).toContain(path.join(".guild", "knowledge", "sources"));
    expect(p).not.toContain(path.join(".guild", "raw"));
    expect(fs.readFileSync(p, "utf8")).toBe("the doc body");
  });

  it("trims over-long lists to the contract caps rather than accepting them", () => {
    const packet = buildResearchPacket({
      run_id: RUN_ID,
      packet_id: "p2",
      questions: Array.from({ length: 30 }, (_, i) => `q${i}`),
      conclusions: Array.from({ length: 30 }, (_, i) => `c${i}`),
      confidence: 5,
    });
    expect(packet.questions).toHaveLength(MAX_QUESTIONS);
    expect(packet.conclusions).toHaveLength(MAX_CONCLUSIONS);
    expect(packet.confidence).toBe(1);
  });

  it("a research run reaches a packet node and never an ideate node", () => {
    const research = loadClassGraph("research", { pluginRoot: REPO, ignoreOverlay: true }).graph;
    const ids = (research.nodes ?? []).map((n) => n.id);
    expect(ids).toContain("packet");
    expect(ids).not.toContain("ideate");
    expect(ids).not.toContain("product.explore");
  });
});
