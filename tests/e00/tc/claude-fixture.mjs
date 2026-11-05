#!/usr/bin/env node
/**
 * tests/e00/tc/claude-fixture.mjs — test-owned stand-in for `claude` in a
 * test-owned tmux pane (E00-L worker-port checks). Not a host and not a model.
 *
 * It records ONLY digests, booleans and allowlisted public specialist metadata to
 * <root>/.claude-fixture.json (root = its cwd): never argv, env values or binding
 * material. Mode comes from <root>/.claude-fixture-mode: "exit" returns after 1s,
 * otherwise it idles as the pane's foreground process until torn down.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const root = process.cwd();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const argv = process.argv.slice(2);
const i = argv.indexOf("--append-system-prompt-file");
const file = i >= 0 ? argv[i + 1] : null;
let fileSha = null;
try { if (file) fileSha = sha(fs.readFileSync(file)); } catch { fileSha = null; }
let refPublic = null;
let refContentHash = null;
try {
  const ref = JSON.parse(process.env.GUILD_DEFINITION_REF ?? "null");
  if (ref) {
    refContentHash = ref.content_hash;
    refPublic = { kind: ref.kind, id: ref.id, specialist_profile_hash: ref.specialist_profile_hash, specialist_type_hash: ref.specialist_type_hash };
  }
} catch { /* not JSON */ }
const assignment = process.env.GUILD_TASK_ASSIGNMENT ?? "";
fs.writeFileSync(path.join(root, ".claude-fixture.json"), JSON.stringify({
  schema_version: "guild.e00_claude_fixture_record.v1",
  append_system_prompt_file_present: file !== null,
  append_system_prompt_file_absolute: file !== null && path.isAbsolute(file),
  append_system_prompt_file_path: file,
  append_system_prompt_file_sha256: fileSha,
  definition_ref_env_content_hash: refContentHash,
  definition_ref_env_public: refPublic,
  assignment_env_absolute: path.isAbsolute(assignment),
  assignment_env_matches_expected_sha: assignment ? sha(assignment) : null,
  cwd_realpath_sha: sha(fs.realpathSync(root)),
  binding_ref_keys_present: Object.keys(process.env).filter((k) => /BINDING_REF$/.test(k)).length,
}) + "\n");
const mode = (() => { try { return fs.readFileSync(path.join(root, ".claude-fixture-mode"), "utf8").trim(); } catch { return "normal"; } })();
// "exit" lingers 1s so the spawn can capture the pane identity first (a fast host races it on Linux).
if (mode !== "exit") setInterval(() => {}, 1 << 30);
else setTimeout(() => {}, 1000);
