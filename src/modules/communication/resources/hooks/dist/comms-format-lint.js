#!/usr/bin/env -S npx tsx
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// comms-format-lint.ts
var path3 = __toESM(require("path"));

// ../src/modules/communication/workflows/comms-format-lint.ts
var fs = __toESM(require("fs"));
var path2 = __toESM(require("path"));

// ../src/modules/kernel/workflows/yaml-loader.ts
var path = __toESM(require("node:path"));
function candidateScriptsRoots() {
  return [
    // Source/runtime TS layout: src/modules/kernel/workflows -> plugin/scripts.
    path.resolve(__dirname, "..", "..", "..", "..", "scripts"),
    // Bundled hook layout: hooks/dist -> plugin/scripts.
    path.resolve(__dirname, "..", "..", "scripts"),
    // Bundled agent-team hook layout: hooks/agent-team/dist -> plugin/scripts.
    path.resolve(__dirname, "..", "..", "..", "scripts"),
    path.resolve(process.cwd(), "scripts")
  ];
}
function loadYamlApi() {
  const tried = [];
  for (const scriptsRoot of candidateScriptsRoots()) {
    tried.push(scriptsRoot);
    try {
      return require(require.resolve("js-yaml", { paths: [scriptsRoot] }));
    } catch {
    }
  }
  throw new Error(`Cannot resolve js-yaml from plugin scripts roots: ${tried.join(", ")}`);
}

// ../src/modules/communication/workflows/comms-format-lint.ts
var yaml = loadYamlApi();
var POLICY_EFFECTIVE_DATE = /* @__PURE__ */ new Date("2026-06-03T00:00:00Z");
function normalisePath(p) {
  return path2.normalize(p).replace(/\\/g, "/");
}
function loadInventoryAllowList() {
  const inventoryPath = path2.resolve(
    __dirname,
    // workflows/ → communication/ → modules/ → src/ → plugin/ → guild-root/
    "../../../../..",
    ".guild/initiatives/active/communication-format-standardization/yaml-reader-inventory.json"
  );
  try {
    if (!fs.existsSync(inventoryPath)) return /* @__PURE__ */ new Set();
    const raw = fs.readFileSync(inventoryPath, "utf8");
    const data = JSON.parse(raw);
    const files = /* @__PURE__ */ new Set();
    for (const reader of data.readers ?? []) {
      if (reader.file) {
        files.add(normalisePath(reader.file));
      }
    }
    return files;
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function isLegacyExempt(filePath) {
  const normalised = normalisePath(filePath);
  return normalised.includes("legacy-example") || normalised.includes("fixtures/legacy-example");
}
function isBuildArtifactExempt(filePath) {
  return normalisePath(filePath).includes("/dist/");
}
function isHandoffFixtureExempt(filePath) {
  const normalised = normalisePath(filePath);
  return normalised.includes("/fixtures/") && normalised.includes("/handoffs/");
}
function extractAllHandoffEnvelopes(content) {
  const results = [];
  const pattern = /```guild\.handoff\.v2\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    if (match[1]) {
      try {
        results.push(JSON.parse(match[1].trim()));
      } catch {
        results.push(null);
      }
    }
  }
  return results;
}
var ALLOWED_ENVELOPE_KEYS = /* @__PURE__ */ new Set([
  "schema_version",
  "task_id",
  "tier",
  "status",
  "summary",
  "artifacts",
  "issues",
  "escalate_reason",
  "learnings",
  "notes"
]);
var VALID_ENVELOPE_TIERS = /* @__PURE__ */ new Set(["cheap", "mid", "powerful"]);
var VALID_ENVELOPE_STATUSES = /* @__PURE__ */ new Set(["done", "blocked", "escalate"]);
var ENVELOPE_SUMMARY_MAX = 600;
var ENVELOPE_NOTES_MAX = 200;
function envelopeShapeErrors(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["envelope must be a non-null object"];
  }
  const obj = value;
  const errors = [];
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_ENVELOPE_KEYS.has(k)) {
      errors.push(
        `unknown key "${k}" \u2014 strict guild.handoff.v2 rejects extra/misspelled keys`
      );
    }
  }
  if (obj["schema_version"] !== "guild.handoff.v2") {
    errors.push(
      `schema_version must be "guild.handoff.v2"; got ${JSON.stringify(obj["schema_version"])}`
    );
  }
  if (typeof obj["task_id"] !== "string" || obj["task_id"].trim() === "") {
    errors.push("task_id must be a non-empty string");
  }
  if (typeof obj["tier"] !== "string" || !VALID_ENVELOPE_TIERS.has(obj["tier"])) {
    errors.push(`tier must be one of cheap|mid|powerful; got ${JSON.stringify(obj["tier"])}`);
  }
  if (typeof obj["status"] !== "string" || !VALID_ENVELOPE_STATUSES.has(obj["status"])) {
    errors.push(
      `status must be one of done|blocked|escalate; got ${JSON.stringify(obj["status"])}`
    );
  }
  if (typeof obj["summary"] !== "string") {
    errors.push("summary must be a string");
  } else if (obj["summary"].trim() === "") {
    errors.push("summary must not be empty");
  } else if (obj["summary"].length > ENVELOPE_SUMMARY_MAX) {
    errors.push(
      `summary exceeds ${ENVELOPE_SUMMARY_MAX} char cap (bloat rejection SC-7): got ${obj["summary"].length} chars`
    );
  }
  if (!Array.isArray(obj["artifacts"])) {
    errors.push("artifacts must be an array (may be empty)");
  } else {
    for (let i = 0; i < obj["artifacts"].length; i++) {
      if (typeof obj["artifacts"][i] !== "string") {
        errors.push(`artifacts[${i}] must be a string`);
      }
    }
  }
  if (!Array.isArray(obj["issues"])) {
    errors.push("issues must be an array (may be empty)");
  } else {
    for (let i = 0; i < obj["issues"].length; i++) {
      if (typeof obj["issues"][i] !== "string") {
        errors.push(`issues[${i}] must be a string`);
      }
    }
  }
  if (obj["status"] === "escalate") {
    if (obj["escalate_reason"] === void 0 || obj["escalate_reason"] === null || typeof obj["escalate_reason"] === "string" && obj["escalate_reason"].trim() === "") {
      errors.push("escalate_reason is required and must be non-empty when status is 'escalate'");
    }
  }
  if (obj["escalate_reason"] !== void 0 && typeof obj["escalate_reason"] !== "string") {
    errors.push("escalate_reason must be a string when provided");
  }
  if (obj["learnings"] !== void 0) {
    if (!Array.isArray(obj["learnings"])) {
      errors.push("learnings must be an array when provided");
    } else {
      for (let i = 0; i < obj["learnings"].length; i++) {
        if (typeof obj["learnings"][i] !== "string") {
          errors.push(`learnings[${i}] must be a string`);
        }
      }
    }
  }
  if (obj["notes"] !== void 0) {
    if (typeof obj["notes"] !== "string") {
      errors.push("notes must be a string when provided");
    } else if (obj["notes"].length > ENVELOPE_NOTES_MAX) {
      errors.push(
        `notes exceeds ${ENVELOPE_NOTES_MAX} char cap (O-4 binding resolution): got ${obj["notes"].length} chars`
      );
    }
  }
  return errors;
}
function looksLikeReceipt(filePath, content) {
  if (!filePath.endsWith(".md")) return false;
  const normalised = normalisePath(filePath);
  if (normalised.includes("/handoffs/") || normalised.includes("/receipts/")) return true;
  if (/^type:\s*handoff_receipt\s*$/m.test(content)) return true;
  return false;
}
function checkAmbiguousReceipt(filePath, content) {
  if (!looksLikeReceipt(filePath, content)) return [];
  const envelopes = extractAllHandoffEnvelopes(content);
  if (envelopes.length === 0) {
    return [
      {
        check: "a",
        severity: "warn",
        file: filePath,
        message: "handoff receipt has no embedded `guild.handoff.v2` block \u2014 a valid receipt must embed exactly one (OD-2, communication-format-policy \xA77)"
      }
    ];
  }
  if (envelopes.length >= 2) {
    return [
      {
        check: "a",
        severity: "warn",
        file: filePath,
        message: `handoff receipt has ${envelopes.length} embedded \`guild.handoff.v2\` blocks (duplicate) \u2014 exactly one is required (OD-2)`
      }
    ];
  }
  const envelope = envelopes[0];
  if (envelope === null) {
    return [
      {
        check: "a",
        severity: "warn",
        file: filePath,
        message: "handoff receipt's embedded `guild.handoff.v2` block is not valid JSON (strict v2 requires parseable JSON)"
      }
    ];
  }
  const shapeErrors = envelopeShapeErrors(envelope);
  if (shapeErrors.length > 0) {
    return [
      {
        check: "a",
        severity: "warn",
        file: filePath,
        message: `handoff receipt's embedded \`guild.handoff.v2\` block fails shape validation: ` + shapeErrors.join("; ")
      }
    ];
  }
  return [];
}
var HAND_ROLLED_PATTERN_SOURCES = [
  // (1) content split on triple-dash delimiter
  {
    src: String.raw`\.split\s*\(\s*['` + "`" + String.raw`"']---['` + "`" + String.raw`"']\s*\)`,
    label: "frontmatter delimiter split (hand-rolled frontmatter splitter)"
  },
  // (2) startsWith triple-dash
  {
    src: String.raw`\.startsWith\s*\(\s*['` + "`" + String.raw`"']---['` + "`" + String.raw`"']\s*\)`,
    label: "frontmatter boundary check via startsWith (hand-rolled)"
  },
  // (3) regex literal of form /^yamlIdentifier: in source code.
  //     Catches YAML key-extraction regex literals anchored at line start.
  //     Excludes known URL scheme identifiers (https/http/ftp/file/ws/wss/data/mailto)
  //     via a named lookahead — distinguishes /^status:\s*/ (warn) from /^https?:\/\//
  //     (no warn) by checking the identifier itself, not the chars after the colon
  //     (which are ambiguous because both :\s* and :\/\/ start with : in source).
  {
    src: String.raw`/\^(?!(?:https?|ftp|file|wss?|data|mailto)[:/])[A-Za-z_][A-Za-z0-9_-]*:`,
    label: "line-anchored YAML key regex literal (hand-rolled field extractor)"
  },
  // (4a) dynamic per-field extractor — quoted-string caret then string concat:
  //      new RegExp('^' + key + ':\\s*(.*)$', 'm')
  //      The quoted-caret then close-quote then plus-sign is the discriminator.
  {
    src: String.raw`new\s+RegExp\s*\(\s*['` + "`" + String.raw`"']\^['` + "`" + String.raw`"']\s*\+`,
    label: "dynamic RegExp('^'+key+...) string-concat (hand-rolled YAML field extractor)"
  },
  // (4b) dynamic per-field extractor — template-literal caret form:
  //      new RegExp(`^${key}:\\s*(.*)$`, 'm')
  //      The backtick-open then caret is the discriminator.
  {
    src: String.raw`new\s+RegExp\s*\(\s*` + "`" + String.raw`\^(?!(?:https?|ftp|file|wss?|data|mailto|tel|urn|blob):)[^` + "`" + String.raw`]*:`,
    label: "dynamic RegExp(`^${key}:...) template-literal (hand-rolled YAML field extractor)"
  },
  // (4c) per-field extractor — single quoted string carrying the whole anchored
  //      key pattern: new RegExp('^status:\\s*(.*)$', 'm'). The discriminator is a
  //      quoted caret immediately followed by a YAML identifier + colon. Excludes
  //      known URL scheme identifiers with the same named lookahead as pattern (3).
  {
    src: String.raw`new\s+RegExp\s*\(\s*['` + '"' + String.raw`]\^(?!(?:https?|ftp|file|wss?|data|mailto):)[A-Za-z_][A-Za-z0-9_-]*:`,
    label: "single-string RegExp('^key:...) anchored key (hand-rolled YAML field extractor)"
  },
  // (5) matchAll with a YAML-key pattern — catches BOTH anchored (/^key:/) and
  //     UNANCHORED (/key:/) forms, mirroring inventory reader #19 (knowledge-links-builder
  //     collectReflectionEdges uses unanchored matchAll(/source_ref[s]?:\s*(.+)/g)).
  //     URL schemes excluded two ways: (1) a NAMED-scheme negative lookahead
  //     (?!(?:https?|ftp|file|wss?|data|mailto):) rejects non-slash schemes like
  //     mailto:/data: (same mechanism as patterns 3/4c); (2) :(?!\\*\/) rejects any
  //     remaining slash-scheme (scheme://, incl. source-escaped :\\/\\/).
  {
    src: String.raw`matchAll\s*\(\s*/\^?(?!(?:https?|ftp|file|wss?|data|mailto):)([A-Za-z_][A-Za-z0-9_\[\]?-]*):(?!\\*\/)`,
    label: "matchAll with YAML key pattern anchored or unanchored (hand-rolled multi-value extractor)"
  },
  // (6) YAML line-scanner: a variable named 'line' calls indexOf or split with
  //     a colon as the sole argument — the pattern used in frontmatter key:value loops.
  {
    src: String.raw`\bline\b.{0,30}\.(?:indexOf|split)\s*\(\s*['` + "`" + String.raw`"']:['` + "`" + String.raw`"']\s*\)`,
    label: "line.indexOf/split on colon \u2014 YAML line scanner (hand-rolled)"
  }
];
var HAND_ROLLED_PATTERNS = HAND_ROLLED_PATTERN_SOURCES.map(({ src, label }) => ({
  pattern: new RegExp(src),
  label
}));
var SELF_EXEMPT_SUFFIXES = [
  "src/modules/communication/workflows/comms-format-lint.ts",
  "scripts/comms/comms-format-lint.ts",
  "scripts/comms/__tests__/comms-format-lint.test.ts"
];
function checkNewHandRolledYaml(filePath, content, allowList) {
  const ext = path2.extname(filePath).toLowerCase();
  if (![".ts", ".js", ".tsx", ".jsx"].includes(ext)) return [];
  const normalised = normalisePath(filePath);
  if (SELF_EXEMPT_SUFFIXES.some((s) => normalised.endsWith(s))) return [];
  for (const inventoried of allowList) {
    if (normalised.endsWith(inventoried) || normalised.includes(inventoried)) return [];
  }
  const YAML_SURFACE_SIGNAL = /\.ya?ml\b|run\.yaml|frontmatter|\.md\b|['"`]---['"`]/i;
  if (!YAML_SURFACE_SIGNAL.test(content)) return [];
  const findings = [];
  for (const { pattern, label } of HAND_ROLLED_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        check: "b",
        severity: "warn",
        file: filePath,
        message: `new hand-rolled YAML reader detected (${label}) \u2014 use shared js-yaml parser instead (OD-3, communication-format-policy \xA7"New artifact must declare its category")`
      });
      break;
    }
  }
  return findings;
}
var COMM_ARTIFACT_TYPES = /* @__PURE__ */ new Set([
  "handoff_receipt",
  "run_manifest",
  "team_manifest",
  "review_packet",
  "learning_checkpoint",
  "trace_event"
]);
function isHumanKnowledgeDoc(filePath) {
  const normalised = normalisePath(filePath);
  return normalised.includes("/docs/knowledge/") || normalised.includes("/.guild/wiki/");
}
function checkUndeclaredCategory(filePath, content) {
  if (!filePath.endsWith(".md") && !filePath.endsWith(".yaml") && !filePath.endsWith(".yml")) {
    return [];
  }
  if (isHumanKnowledgeDoc(filePath)) return [];
  const fmStart = content.indexOf("---");
  if (fmStart !== 0 && fmStart !== -1) return [];
  if (fmStart === -1) return [];
  const fmEnd = content.indexOf("\n---", fmStart + 3);
  if (fmEnd === -1) return [];
  const rawFrontmatter = content.slice(fmStart + 3, fmEnd).trim();
  if (!rawFrontmatter) return [];
  let fm;
  try {
    fm = yaml.load(rawFrontmatter);
  } catch {
    return [];
  }
  if (typeof fm !== "object" || fm === null || Array.isArray(fm)) return [];
  const fmObj = fm;
  const artifactType = typeof fmObj["type"] === "string" ? fmObj["type"].trim() : null;
  if (!artifactType || !COMM_ARTIFACT_TYPES.has(artifactType)) return [];
  if (fmObj["artifact_category"] !== void 0 && fmObj["artifact_category"] !== null && fmObj["artifact_category"] !== "") {
    return [];
  }
  return [
    {
      check: "c",
      severity: "warn",
      file: filePath,
      message: `communication artifact of type "${artifactType}" does not declare \`artifact_category:\` \u2014 every new communication artifact must state its category before choosing a format (communication-format-policy \xA7"New artifact must declare its category")`
    }
  ];
}
function readRunStartedAt(runDir) {
  const runYamlPath = path2.join(runDir, "run.yaml");
  try {
    if (!fs.existsSync(runYamlPath)) return null;
    const raw = fs.readFileSync(runYamlPath, "utf8");
    const m = raw.match(/^started_at:[ \t]*(.*)$/m);
    if (!m || !m[1] || m[1].trim() === "") return null;
    const d = new Date(m[1].trim());
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
function isRunInScope(runDir) {
  const d = readRunStartedAt(runDir);
  if (d === null) return false;
  return d >= POLICY_EFFECTIVE_DATE;
}
function resolvePathsFromDiffRange(diffRange) {
  try {
    const { execSync } = require("child_process");
    const output = execSync(`git diff --name-only ${diffRange}`, {
      encoding: "utf8",
      timeout: 1e4
    });
    return output.trim().split("\n").filter(Boolean).map((p) => path2.resolve(p));
  } catch {
    return [];
  }
}
function lintCommsFormat(opts = {}) {
  const findings = [];
  const allowList = loadInventoryAllowList();
  const inScopePaths = new Set(opts.paths ?? []);
  if (opts.diffRange) {
    for (const p of resolvePathsFromDiffRange(opts.diffRange)) {
      inScopePaths.add(p);
    }
  }
  for (const filePath of inScopePaths) {
    if (isLegacyExempt(filePath)) continue;
    if (isBuildArtifactExempt(filePath)) continue;
    let content;
    try {
      if (!fs.existsSync(filePath)) continue;
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (!isHandoffFixtureExempt(filePath)) {
      findings.push(...checkAmbiguousReceipt(filePath, content));
    }
    findings.push(...checkNewHandRolledYaml(filePath, content, allowList));
    findings.push(...checkUndeclaredCategory(filePath, content));
  }
  if (opts.runsDir) {
    try {
      if (!fs.existsSync(opts.runsDir)) return findings;
      const runDirs = fs.readdirSync(opts.runsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path2.join(opts.runsDir, d.name));
      for (const runDir of runDirs) {
        if (!isRunInScope(runDir)) continue;
        const handoffsDir = path2.join(runDir, "handoffs");
        if (!fs.existsSync(handoffsDir)) continue;
        const receiptFiles = fs.readdirSync(handoffsDir, { withFileTypes: true }).filter((f) => f.isFile() && f.name.endsWith(".md")).map((f) => path2.join(handoffsDir, f.name));
        for (const receiptPath of receiptFiles) {
          if (isLegacyExempt(receiptPath)) continue;
          if (inScopePaths.has(receiptPath)) continue;
          let content;
          try {
            content = fs.readFileSync(receiptPath, "utf8");
          } catch {
            continue;
          }
          if (!isHandoffFixtureExempt(receiptPath)) {
            findings.push(...checkAmbiguousReceipt(receiptPath, content));
          }
        }
      }
    } catch {
    }
  }
  return findings;
}

// comms-format-lint.ts
async function readStdin() {
  return new Promise((resolve4) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve4(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve4(""));
  });
}
function isEnforceEnabled() {
  return process.env["GUILD_COMMS_FORMAT_ENFORCE"] === "1";
}
function printFindings(findings, enforceMode) {
  if (findings.length === 0) {
    return false;
  }
  let hasCheckA = false;
  for (const f of findings) {
    const loc = f.line !== void 0 ? `:${f.line}` : "";
    process.stderr.write(
      `[comms-format-lint] WARN [check-${f.check}] ${f.file}${loc}: ${f.message}
`
    );
    if (f.check === "a") {
      hasCheckA = true;
    }
  }
  if (enforceMode && hasCheckA) {
    const checkAFindings = findings.filter((f) => f.check === "a");
    process.stderr.write(
      `[comms-format-lint] BLOCK: enforce mode active (GUILD_COMMS_FORMAT_ENFORCE=1) \u2014 ${checkAFindings.length} check-a violation(s) detected.
  Receipts must embed exactly ONE valid \`guild.handoff.v2\` JSON block (communication-format-policy \xA7"Handoff contract", OD-2).
  To suppress this block, fix the receipt or set GUILD_COMMS_FORMAT_ENFORCE=0.
`
    );
    return true;
  }
  const mode = enforceMode ? "enforce mode (check-b/c advisory only)" : "U5a warn mode";
  process.stderr.write(
    `[comms-format-lint] ${findings.length} warning(s) \u2014 non-blocking (${mode})
`
  );
  return false;
}
async function main() {
  const enforceMode = isEnforceEnabled();
  const raw = await readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw.trim());
  } catch {
    process.exit(0);
  }
  const toolName = payload.tool_name ?? "";
  if (toolName !== "Write" && toolName !== "Edit") {
    process.exit(0);
  }
  const filePath = payload.tool_input?.file_path;
  if (typeof filePath !== "string" || filePath.trim() === "") {
    process.exit(0);
  }
  const absolutePath = path3.isAbsolute(filePath) ? filePath : path3.resolve(process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd(), filePath);
  let findings = [];
  try {
    findings = lintCommsFormat({ paths: [absolutePath], enforce: enforceMode });
  } catch (err) {
    process.stderr.write(
      `[comms-format-lint] WARN: lint core threw \u2014 ${err instanceof Error ? err.message : String(err)}
`
    );
    process.exit(0);
  }
  const shouldBlock = printFindings(findings, enforceMode);
  if (shouldBlock) {
    process.exit(2);
  }
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(
    `[comms-format-lint] WARN: unexpected error \u2014 ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(0);
});
