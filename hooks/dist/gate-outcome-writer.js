#!/usr/bin/env -S npx tsx
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
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

// ../src/modules/kernel/workflows/module-manifest.ts
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}
function validateManifest(value, relPath) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: [`${relPath}: manifest must be an object`] };
  }
  if (value.schema_version !== MODULE_MANIFEST_SCHEMA_VERSION) {
    errors.push(`${relPath}: schema_version must be ${MODULE_MANIFEST_SCHEMA_VERSION}`);
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    errors.push(`${relPath}: id must be a non-empty string`);
  }
  if (typeof value.title !== "string" || value.title.trim() === "") {
    errors.push(`${relPath}: title must be a non-empty string`);
  }
  if (!["capability", "substrate", "operator", "build"].includes(String(value.kind))) {
    errors.push(`${relPath}: kind must be capability|substrate|operator|build`);
  }
  if (!["workflow-backed", "resource-only"].includes(String(value.implementation_mode))) {
    errors.push(`${relPath}: implementation_mode must be workflow-backed|resource-only`);
  }
  if (typeof value.description !== "string" || value.description.trim() === "") {
    errors.push(`${relPath}: description must be a non-empty string`);
  }
  if (value.depends_on !== void 0 && !isStringArray(value.depends_on)) {
    errors.push(`${relPath}: depends_on must be a string array when present`);
  }
  if (value.lifecycle_slots !== void 0 && !isStringArray(value.lifecycle_slots)) {
    errors.push(`${relPath}: lifecycle_slots must be a string array when present`);
  }
  if (value.resource_projection_entrypoints !== void 0 && !isStringArray(value.resource_projection_entrypoints)) {
    errors.push(`${relPath}: resource_projection_entrypoints must be a string array when present`);
  }
  if (!isPlainObject(value.owns)) {
    errors.push(`${relPath}: owns must be an object`);
  } else {
    const allowed = new Set(Object.values(CATEGORY_KEYS).flatMap((keys) => [keys.ids, keys.prefixes]));
    for (const key of Object.keys(value.owns)) {
      if (!allowed.has(key)) {
        errors.push(`${relPath}: owns.${key} is not a supported ownership selector`);
      } else if (!isStringArray(value.owns[key])) {
        errors.push(`${relPath}: owns.${key} must be a string array`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
function loadModuleManifests(root) {
  const modulesDir = path2.join(root, "src", "modules");
  const manifests = [];
  if (!fs2.existsSync(modulesDir)) return manifests;
  for (const name of fs2.readdirSync(modulesDir).sort()) {
    const manifestPath = path2.join(modulesDir, name, "module.manifest.json");
    if (!fs2.existsSync(manifestPath)) continue;
    const relPath = path2.relative(root, manifestPath).split(path2.sep).join("/");
    let parsed;
    try {
      parsed = JSON.parse(fs2.readFileSync(manifestPath, "utf8"));
    } catch (err) {
      throw new Error(`${relPath}: cannot parse JSON: ${String(err)}`);
    }
    const validation = validateManifest(parsed, relPath);
    if (!validation.ok) {
      throw new Error(validation.errors.join("\n"));
    }
    manifests.push(parsed);
  }
  return manifests;
}
function ownsId(manifest, category, id) {
  const keys = CATEGORY_KEYS[category];
  const exact = manifest.owns[keys.ids] ?? [];
  const prefixes = manifest.owns[keys.prefixes] ?? [];
  return exact.includes(id) || prefixes.some((prefix) => id.startsWith(prefix));
}
function ownersFor(manifests, category, id) {
  return manifests.filter((manifest) => ownsId(manifest, category, id)).map((manifest) => manifest.id);
}
function entriesFor(inventory, category) {
  return inventory[category];
}
function validateModuleOwnership(inventory, manifests) {
  const errors = [];
  const missing = [];
  const duplicate = [];
  const ids = /* @__PURE__ */ new Set();
  for (const manifest of manifests) {
    if (ids.has(manifest.id)) errors.push(`duplicate module id ${JSON.stringify(manifest.id)}`);
    ids.add(manifest.id);
    for (const dep of manifest.depends_on ?? []) {
      if (!ids.has(dep) && !manifests.some((candidate) => candidate.id === dep)) {
        errors.push(`module ${manifest.id} depends on unknown module ${dep}`);
      }
    }
  }
  for (const category of OWNED_INVENTORY_CATEGORIES) {
    for (const entry of entriesFor(inventory, category)) {
      const owners = ownersFor(manifests, category, entry.id);
      const finding = {
        category,
        id: entry.id,
        source_path: entry.source_path,
        owners
      };
      if (owners.length === 0) missing.push(finding);
      if (owners.length > 1) duplicate.push(finding);
    }
  }
  return {
    ok: errors.length === 0 && missing.length === 0 && duplicate.length === 0,
    missing,
    duplicate,
    errors
  };
}
function walkTsFiles(dir) {
  if (!fs2.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs2.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path2.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkTsFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(fullPath);
  }
  return files.sort();
}
function countWorkflowFiles(moduleDir) {
  const workflowsDir = path2.join(moduleDir, "workflows");
  return walkTsFiles(workflowsDir).length;
}
function countModuleResources(root, moduleId) {
  const manifestAbs = path2.join(root, "src", "modules", moduleId, "resources", "module-resources.json");
  if (!fs2.existsSync(manifestAbs)) return 0;
  try {
    const parsed = JSON.parse(fs2.readFileSync(manifestAbs, "utf8"));
    return Array.isArray(parsed.entries) ? parsed.entries.length : 0;
  } catch {
    return 0;
  }
}
function validateModuleHealth(root, manifests) {
  const findings = [];
  const modules = [];
  const modulesDir = path2.join(root, "src", "modules");
  for (const manifest of manifests) {
    const moduleDir = path2.join(modulesDir, manifest.id);
    const relModuleDir = `src/modules/${manifest.id}`;
    if (!fs2.existsSync(moduleDir) || !fs2.statSync(moduleDir).isDirectory()) {
      findings.push({ module_id: manifest.id, reason: "missing_module_directory", path: relModuleDir });
      modules.push({
        module_id: manifest.id,
        kind: manifest.kind,
        implementation_mode: manifest.implementation_mode,
        resources: 0,
        workflows: 0,
        has_public_index: false
      });
      continue;
    }
    const resourcesManifest = path2.join(moduleDir, "resources", "module-resources.json");
    const resourcesMarker = path2.join(moduleDir, "resources", ".generated-by-guild-module-resources");
    const indexPath = path2.join(moduleDir, "index.ts");
    const workflows = countWorkflowFiles(moduleDir);
    const hasPublicIndex = fs2.existsSync(indexPath) && fs2.statSync(indexPath).isFile();
    if (!fs2.existsSync(resourcesManifest) || !fs2.statSync(resourcesManifest).isFile()) {
      findings.push({
        module_id: manifest.id,
        reason: "missing_resources_manifest",
        path: `${relModuleDir}/resources/module-resources.json`
      });
    }
    if (!fs2.existsSync(resourcesMarker) || !fs2.statSync(resourcesMarker).isFile()) {
      findings.push({
        module_id: manifest.id,
        reason: "missing_resources_marker",
        path: `${relModuleDir}/resources/.generated-by-guild-module-resources`
      });
    }
    if (workflows > 0 && !hasPublicIndex) {
      findings.push({
        module_id: manifest.id,
        reason: "workflow_module_missing_public_index",
        path: `${relModuleDir}/index.ts`
      });
    }
    if (manifest.implementation_mode === "resource-only" && workflows > 0) {
      findings.push({
        module_id: manifest.id,
        reason: "resource_only_module_has_workflows",
        path: `${relModuleDir}/workflows`
      });
    }
    if (manifest.implementation_mode === "workflow-backed" && workflows === 0) {
      findings.push({
        module_id: manifest.id,
        reason: "workflow_backed_module_has_no_workflows",
        path: `${relModuleDir}/workflows`
      });
    }
    modules.push({
      module_id: manifest.id,
      kind: manifest.kind,
      implementation_mode: manifest.implementation_mode,
      resources: countModuleResources(root, manifest.id),
      workflows,
      has_public_index: hasPublicIndex
    });
  }
  return { ok: findings.length === 0, modules, findings };
}
function resolveTsImport(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path2.resolve(path2.dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    path2.join(base, "index.ts")
  ];
  return candidates.find((candidate) => fs2.existsSync(candidate) && fs2.statSync(candidate).isFile()) ?? base;
}
function moduleIdForPath(modulesDir, filePath, moduleIds) {
  const rel = path2.relative(modulesDir, filePath);
  if (rel.startsWith("..") || path2.isAbsolute(rel)) return null;
  const [moduleId] = rel.split(path2.sep);
  return moduleIds.has(moduleId) ? moduleId : null;
}
function dependencyTokens(source) {
  const tokens = [];
  let index = 0;
  let lineBreakBefore = false;
  const push = (kind, value) => {
    tokens.push({ kind, value, lineBreakBefore });
    lineBreakBefore = false;
  };
  const regexMayStart = () => {
    const previous = tokens[tokens.length - 1];
    if (!previous) return true;
    if (previous.kind === "number" || previous.kind === "string") return false;
    if (previous.kind === "word") {
      return ["case", "delete", "else", "in", "instanceof", "new", "return", "throw", "typeof", "void", "yield"].includes(
        previous.value
      );
    }
    return ![")", "]", "}"].includes(previous.value);
  };
  const scanCode = (stopAtInterpolationEnd) => {
    let braceDepth = 0;
    while (index < source.length) {
      const char = source[index];
      const next = source[index + 1];
      if (/\s/.test(char)) {
        if (char === "\n" || char === "\r") lineBreakBefore = true;
        index += 1;
        continue;
      }
      if (char === "/" && next === "/") {
        index += 2;
        while (index < source.length && source[index] !== "\n") index += 1;
        continue;
      }
      if (char === "/" && next === "*") {
        index += 2;
        while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
          index += 1;
        }
        index = Math.min(source.length, index + 2);
        continue;
      }
      if (char === "/" && regexMayStart()) {
        index += 1;
        let inCharacterClass = false;
        while (index < source.length) {
          if (source[index] === "\\") {
            index += 2;
          } else if (source[index] === "[") {
            inCharacterClass = true;
            index += 1;
          } else if (source[index] === "]") {
            inCharacterClass = false;
            index += 1;
          } else if (source[index] === "/" && !inCharacterClass) {
            index += 1;
            while (index < source.length && /[A-Za-z]/.test(source[index])) index += 1;
            break;
          } else {
            index += 1;
          }
        }
        continue;
      }
      if (char === "`") {
        index += 1;
        while (index < source.length) {
          if (source[index] === "\\") {
            index += 2;
          } else if (source[index] === "$" && source[index + 1] === "{") {
            index += 2;
            scanCode(true);
          } else if (source[index] === "`") {
            index += 1;
            break;
          } else {
            index += 1;
          }
        }
        continue;
      }
      if (stopAtInterpolationEnd && char === "}" && braceDepth === 0) {
        index += 1;
        return;
      }
      if (char === '"' || char === "'") {
        const quote = char;
        let value = "";
        index += 1;
        while (index < source.length) {
          if (source[index] === "\\") {
            value += source[index];
            if (index + 1 < source.length) value += source[index + 1];
            index += 2;
          } else if (source[index] === quote) {
            index += 1;
            break;
          } else {
            value += source[index];
            index += 1;
          }
        }
        push("string", value);
        continue;
      }
      if (/[A-Za-z_$]/.test(char)) {
        const start = index;
        index += 1;
        while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
        push("word", source.slice(start, index));
        continue;
      }
      if (/[0-9]/.test(char)) {
        const numeric = source.slice(index).match(
          /^(?:0[xX][0-9A-Fa-f_]+|0[bB][01_]+|0[oO][0-7_]+|(?:[0-9][0-9_]*(?:\.[0-9_]*)?)(?:[eE][+-]?[0-9_]+)?)[n]?/
        );
        if (numeric) {
          push("number", numeric[0]);
          index += numeric[0].length;
          continue;
        }
      }
      if (stopAtInterpolationEnd && char === "{") braceDepth += 1;
      if (stopAtInterpolationEnd && char === "}" && braceDepth > 0) braceDepth -= 1;
      push("punctuation", char);
      index += 1;
    }
  };
  scanCode(false);
  return tokens;
}
function literalRelativeDependencySpecifiers(source) {
  const tokens = dependencyTokens(source);
  const specifiers = [];
  const addString = (token) => {
    if (token?.kind === "string" && token.value.startsWith(".")) specifiers.push(token.value);
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "word") continue;
    const previous = tokens[index - 1];
    const isMember = previous?.value === "." || previous?.value === "?.";
    if (token.value === "require" && !isMember && tokens[index + 1]?.value === "(") {
      addString(tokens[index + 2]);
      continue;
    }
    if (token.value !== "import" && token.value !== "export") continue;
    if (token.value === "import" && !isMember && tokens[index + 1]?.value === "(") {
      addString(tokens[index + 2]);
      continue;
    }
    if (token.value === "import" && tokens[index + 1]?.kind === "string") {
      addString(tokens[index + 1]);
      continue;
    }
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const candidate = tokens[cursor];
      if (candidate.value === ";") break;
      if (candidate.lineBreakBefore && candidate.kind === "word" && ["const", "let", "var", "function", "class", "return", "throw"].includes(candidate.value)) {
        break;
      }
      if (candidate.kind === "word" && (candidate.value === "import" || candidate.value === "export")) {
        break;
      }
      if (candidate.kind === "word" && candidate.value === "from") {
        addString(tokens[cursor + 1]);
        break;
      }
    }
  }
  return specifiers;
}
function hostFacingRootFor(root, filePath) {
  const rel = path2.relative(root, filePath);
  if (rel.startsWith("..") || path2.isAbsolute(rel)) return null;
  const [top] = rel.split(path2.sep);
  return HOST_FACING_ROOTS.includes(top) ? top : null;
}
function validateModuleBoundaries(root, manifests) {
  const errors = [];
  const violations = [];
  const modulesDir = path2.join(root, "src", "modules");
  const moduleIds = new Set(manifests.map((manifest) => manifest.id));
  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const seenImporterSpecifiers = /* @__PURE__ */ new Set();
  for (const manifest of manifests) {
    const moduleDir = path2.join(modulesDir, manifest.id);
    if (!fs2.existsSync(moduleDir)) {
      errors.push(`module ${manifest.id} has no src/modules/${manifest.id} directory`);
    }
  }
  for (const importer of walkTsFiles(modulesDir)) {
    const fromModule = moduleIdForPath(modulesDir, importer, moduleIds);
    if (!fromModule) continue;
    const text = fs2.readFileSync(importer, "utf8");
    for (const specifier of literalRelativeDependencySpecifiers(text)) {
      const importerSpecifier = `${importer}\0${specifier}`;
      if (seenImporterSpecifiers.has(importerSpecifier)) continue;
      seenImporterSpecifiers.add(importerSpecifier);
      const importedPath = resolveTsImport(importer, specifier);
      if (!importedPath) continue;
      const toModule = moduleIdForPath(modulesDir, importedPath, moduleIds);
      if (!toModule) {
        const hostRoot = hostFacingRootFor(root, importedPath);
        if (hostRoot) {
          violations.push({
            importer: path2.relative(root, importer).split(path2.sep).join("/"),
            imported: path2.relative(root, importedPath).split(path2.sep).join("/"),
            from_module: fromModule,
            to_module: hostRoot,
            specifier,
            reason: "host_facing_import"
          });
        }
        continue;
      }
      if (toModule === fromModule) continue;
      const dependsOn = manifestById.get(fromModule)?.depends_on ?? [];
      if (!dependsOn.includes(toModule)) {
        violations.push({
          importer: path2.relative(root, importer).split(path2.sep).join("/"),
          imported: path2.relative(root, importedPath).split(path2.sep).join("/"),
          from_module: fromModule,
          to_module: toModule,
          specifier,
          reason: "undeclared_dependency"
        });
        continue;
      }
      const publicEntrypoint = path2.join(modulesDir, toModule, "index.ts");
      if (path2.resolve(importedPath) !== path2.resolve(publicEntrypoint)) {
        violations.push({
          importer: path2.relative(root, importer).split(path2.sep).join("/"),
          imported: path2.relative(root, importedPath).split(path2.sep).join("/"),
          from_module: fromModule,
          to_module: toModule,
          specifier,
          reason: "private_import"
        });
      }
    }
  }
  return {
    ok: errors.length === 0 && violations.length === 0,
    violations,
    errors
  };
}
var fs2, path2, MODULE_MANIFEST_SCHEMA_VERSION, OWNED_INVENTORY_CATEGORIES, CATEGORY_KEYS, HOST_FACING_ROOTS;
var init_module_manifest = __esm({
  "../src/modules/kernel/workflows/module-manifest.ts"() {
    fs2 = __toESM(require("node:fs"));
    path2 = __toESM(require("node:path"));
    MODULE_MANIFEST_SCHEMA_VERSION = "guild.module_manifest.v1";
    OWNED_INVENTORY_CATEGORIES = Object.freeze([
      "commands",
      "skills",
      "agents",
      "hooks",
      "mcp_servers",
      "scripts"
    ]);
    CATEGORY_KEYS = {
      commands: { ids: "commands", prefixes: "command_id_prefixes" },
      skills: { ids: "skills", prefixes: "skill_id_prefixes" },
      agents: { ids: "agents", prefixes: "agent_id_prefixes" },
      hooks: { ids: "hooks", prefixes: "hook_id_prefixes" },
      mcp_servers: { ids: "mcp_servers", prefixes: "mcp_server_id_prefixes" },
      scripts: { ids: "scripts", prefixes: "script_id_prefixes" }
    };
    HOST_FACING_ROOTS = ["hooks", "scripts"];
  }
});

// node_modules/js-yaml/lib/common.js
var require_common = __commonJS({
  "node_modules/js-yaml/lib/common.js"(exports2, module2) {
    "use strict";
    function isNothing(subject) {
      return typeof subject === "undefined" || subject === null;
    }
    function isObject(subject) {
      return typeof subject === "object" && subject !== null;
    }
    function toArray(sequence) {
      if (Array.isArray(sequence)) return sequence;
      else if (isNothing(sequence)) return [];
      return [sequence];
    }
    function extend(target, source) {
      if (source) {
        const sourceKeys = Object.keys(source);
        for (let index = 0, length = sourceKeys.length; index < length; index += 1) {
          const key = sourceKeys[index];
          target[key] = source[key];
        }
      }
      return target;
    }
    function repeat(string, count) {
      let result = "";
      for (let cycle = 0; cycle < count; cycle += 1) {
        result += string;
      }
      return result;
    }
    function isNegativeZero(number) {
      return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
    }
    module2.exports.isNothing = isNothing;
    module2.exports.isObject = isObject;
    module2.exports.toArray = toArray;
    module2.exports.repeat = repeat;
    module2.exports.isNegativeZero = isNegativeZero;
    module2.exports.extend = extend;
  }
});

// node_modules/js-yaml/lib/exception.js
var require_exception = __commonJS({
  "node_modules/js-yaml/lib/exception.js"(exports2, module2) {
    "use strict";
    function formatError(exception, compact) {
      let where = "";
      const message = exception.reason || "(unknown reason)";
      if (!exception.mark) return message;
      if (exception.mark.name) {
        where += 'in "' + exception.mark.name + '" ';
      }
      where += "(" + (exception.mark.line + 1) + ":" + (exception.mark.column + 1) + ")";
      if (!compact && exception.mark.snippet) {
        where += "\n\n" + exception.mark.snippet;
      }
      return message + " " + where;
    }
    function YAMLException(reason, mark) {
      Error.call(this);
      this.name = "YAMLException";
      this.reason = reason;
      this.mark = mark;
      this.message = formatError(this, false);
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, this.constructor);
      } else {
        this.stack = new Error().stack || "";
      }
    }
    YAMLException.prototype = Object.create(Error.prototype);
    YAMLException.prototype.constructor = YAMLException;
    YAMLException.prototype.toString = function toString(compact) {
      return this.name + ": " + formatError(this, compact);
    };
    module2.exports = YAMLException;
  }
});

// node_modules/js-yaml/lib/snippet.js
var require_snippet = __commonJS({
  "node_modules/js-yaml/lib/snippet.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
      let head = "";
      let tail = "";
      const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
      if (position - lineStart > maxHalfLength) {
        head = " ... ";
        lineStart = position - maxHalfLength + head.length;
      }
      if (lineEnd - position > maxHalfLength) {
        tail = " ...";
        lineEnd = position + maxHalfLength - tail.length;
      }
      return {
        str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
        pos: position - lineStart + head.length
        // relative position
      };
    }
    function padStart(string, max) {
      return common.repeat(" ", max - string.length) + string;
    }
    function makeSnippet(mark, options) {
      options = Object.create(options || null);
      if (!mark.buffer) return null;
      if (!options.maxLength) options.maxLength = 79;
      if (typeof options.indent !== "number") options.indent = 1;
      if (typeof options.linesBefore !== "number") options.linesBefore = 3;
      if (typeof options.linesAfter !== "number") options.linesAfter = 2;
      const re = /\r?\n|\r|\0/g;
      const lineStarts = [0];
      const lineEnds = [];
      let match;
      let foundLineNo = -1;
      while (match = re.exec(mark.buffer)) {
        lineEnds.push(match.index);
        lineStarts.push(match.index + match[0].length);
        if (mark.position <= match.index && foundLineNo < 0) {
          foundLineNo = lineStarts.length - 2;
        }
      }
      if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
      let result = "";
      const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
      const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
      for (let i = 1; i <= options.linesBefore; i++) {
        if (foundLineNo - i < 0) break;
        const line2 = getLine(
          mark.buffer,
          lineStarts[foundLineNo - i],
          lineEnds[foundLineNo - i],
          mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]),
          maxLineLength
        );
        result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + "\n" + result;
      }
      const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
      result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
      result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
      for (let i = 1; i <= options.linesAfter; i++) {
        if (foundLineNo + i >= lineEnds.length) break;
        const line2 = getLine(
          mark.buffer,
          lineStarts[foundLineNo + i],
          lineEnds[foundLineNo + i],
          mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
          maxLineLength
        );
        result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + "\n";
      }
      return result.replace(/\n$/, "");
    }
    module2.exports = makeSnippet;
  }
});

// node_modules/js-yaml/lib/type.js
var require_type = __commonJS({
  "node_modules/js-yaml/lib/type.js"(exports2, module2) {
    "use strict";
    var YAMLException = require_exception();
    var TYPE_CONSTRUCTOR_OPTIONS = [
      "kind",
      "multi",
      "resolve",
      "construct",
      "instanceOf",
      "predicate",
      "represent",
      "representName",
      "defaultStyle",
      "styleAliases"
    ];
    var YAML_NODE_KINDS = [
      "scalar",
      "sequence",
      "mapping"
    ];
    function compileStyleAliases(map) {
      const result = {};
      if (map !== null) {
        Object.keys(map).forEach(function(style) {
          map[style].forEach(function(alias) {
            result[String(alias)] = style;
          });
        });
      }
      return result;
    }
    function Type(tag, options) {
      options = options || {};
      Object.keys(options).forEach(function(name) {
        if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
          throw new YAMLException('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
        }
      });
      this.options = options;
      this.tag = tag;
      this.kind = options["kind"] || null;
      this.resolve = options["resolve"] || function() {
        return true;
      };
      this.construct = options["construct"] || function(data) {
        return data;
      };
      this.instanceOf = options["instanceOf"] || null;
      this.predicate = options["predicate"] || null;
      this.represent = options["represent"] || null;
      this.representName = options["representName"] || null;
      this.defaultStyle = options["defaultStyle"] || null;
      this.multi = options["multi"] || false;
      this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
      if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
        throw new YAMLException('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
      }
    }
    module2.exports = Type;
  }
});

// node_modules/js-yaml/lib/schema.js
var require_schema = __commonJS({
  "node_modules/js-yaml/lib/schema.js"(exports2, module2) {
    "use strict";
    var YAMLException = require_exception();
    var Type = require_type();
    function compileList(schema, name) {
      const result = [];
      schema[name].forEach(function(currentType) {
        let newIndex = result.length;
        result.forEach(function(previousType, previousIndex) {
          if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
            newIndex = previousIndex;
          }
        });
        result[newIndex] = currentType;
      });
      return result;
    }
    function compileMap() {
      const result = {
        scalar: {},
        sequence: {},
        mapping: {},
        fallback: {},
        multi: {
          scalar: [],
          sequence: [],
          mapping: [],
          fallback: []
        }
      };
      function collectType(type) {
        if (type.multi) {
          result.multi[type.kind].push(type);
          result.multi["fallback"].push(type);
        } else {
          result[type.kind][type.tag] = result["fallback"][type.tag] = type;
        }
      }
      for (let index = 0, length = arguments.length; index < length; index += 1) {
        arguments[index].forEach(collectType);
      }
      return result;
    }
    function Schema(definition) {
      return this.extend(definition);
    }
    Schema.prototype.extend = function extend(definition) {
      let implicit = [];
      let explicit = [];
      if (definition instanceof Type) {
        explicit.push(definition);
      } else if (Array.isArray(definition)) {
        explicit = explicit.concat(definition);
      } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
        if (definition.implicit) implicit = implicit.concat(definition.implicit);
        if (definition.explicit) explicit = explicit.concat(definition.explicit);
      } else {
        throw new YAMLException("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
      }
      implicit.forEach(function(type) {
        if (!(type instanceof Type)) {
          throw new YAMLException("Specified list of YAML types (or a single Type object) contains a non-Type object.");
        }
        if (type.loadKind && type.loadKind !== "scalar") {
          throw new YAMLException("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
        }
        if (type.multi) {
          throw new YAMLException("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
        }
      });
      explicit.forEach(function(type) {
        if (!(type instanceof Type)) {
          throw new YAMLException("Specified list of YAML types (or a single Type object) contains a non-Type object.");
        }
      });
      const result = Object.create(Schema.prototype);
      result.implicit = (this.implicit || []).concat(implicit);
      result.explicit = (this.explicit || []).concat(explicit);
      result.compiledImplicit = compileList(result, "implicit");
      result.compiledExplicit = compileList(result, "explicit");
      result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
      return result;
    };
    module2.exports = Schema;
  }
});

// node_modules/js-yaml/lib/type/str.js
var require_str = __commonJS({
  "node_modules/js-yaml/lib/type/str.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    module2.exports = new Type("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function(data) {
        return data !== null ? data : "";
      }
    });
  }
});

// node_modules/js-yaml/lib/type/seq.js
var require_seq = __commonJS({
  "node_modules/js-yaml/lib/type/seq.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    module2.exports = new Type("tag:yaml.org,2002:seq", {
      kind: "sequence",
      construct: function(data) {
        return data !== null ? data : [];
      }
    });
  }
});

// node_modules/js-yaml/lib/type/map.js
var require_map = __commonJS({
  "node_modules/js-yaml/lib/type/map.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    module2.exports = new Type("tag:yaml.org,2002:map", {
      kind: "mapping",
      construct: function(data) {
        return data !== null ? data : {};
      }
    });
  }
});

// node_modules/js-yaml/lib/schema/failsafe.js
var require_failsafe = __commonJS({
  "node_modules/js-yaml/lib/schema/failsafe.js"(exports2, module2) {
    "use strict";
    var Schema = require_schema();
    module2.exports = new Schema({
      explicit: [
        require_str(),
        require_seq(),
        require_map()
      ]
    });
  }
});

// node_modules/js-yaml/lib/type/null.js
var require_null = __commonJS({
  "node_modules/js-yaml/lib/type/null.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveYamlNull(data) {
      if (data === null) return true;
      const max = data.length;
      return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
    }
    function constructYamlNull() {
      return null;
    }
    function isNull(object) {
      return object === null;
    }
    module2.exports = new Type("tag:yaml.org,2002:null", {
      kind: "scalar",
      resolve: resolveYamlNull,
      construct: constructYamlNull,
      predicate: isNull,
      represent: {
        canonical: function() {
          return "~";
        },
        lowercase: function() {
          return "null";
        },
        uppercase: function() {
          return "NULL";
        },
        camelcase: function() {
          return "Null";
        },
        empty: function() {
          return "";
        }
      },
      defaultStyle: "lowercase"
    });
  }
});

// node_modules/js-yaml/lib/type/bool.js
var require_bool = __commonJS({
  "node_modules/js-yaml/lib/type/bool.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveYamlBoolean(data) {
      if (data === null) return false;
      const max = data.length;
      return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
    }
    function constructYamlBoolean(data) {
      return data === "true" || data === "True" || data === "TRUE";
    }
    function isBoolean(object) {
      return Object.prototype.toString.call(object) === "[object Boolean]";
    }
    module2.exports = new Type("tag:yaml.org,2002:bool", {
      kind: "scalar",
      resolve: resolveYamlBoolean,
      construct: constructYamlBoolean,
      predicate: isBoolean,
      represent: {
        lowercase: function(object) {
          return object ? "true" : "false";
        },
        uppercase: function(object) {
          return object ? "TRUE" : "FALSE";
        },
        camelcase: function(object) {
          return object ? "True" : "False";
        }
      },
      defaultStyle: "lowercase"
    });
  }
});

// node_modules/js-yaml/lib/type/int.js
var require_int = __commonJS({
  "node_modules/js-yaml/lib/type/int.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var Type = require_type();
    function isHexCode(c) {
      return c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
    }
    function isOctCode(c) {
      return c >= 48 && c <= 55;
    }
    function isDecCode(c) {
      return c >= 48 && c <= 57;
    }
    function resolveYamlInteger(data) {
      if (data === null) return false;
      const max = data.length;
      let index = 0;
      let hasDigits = false;
      if (!max) return false;
      let ch = data[index];
      if (ch === "-" || ch === "+") {
        ch = data[++index];
      }
      if (ch === "0") {
        if (index + 1 === max) return true;
        ch = data[++index];
        if (ch === "b") {
          index++;
          for (; index < max; index++) {
            ch = data[index];
            if (ch !== "0" && ch !== "1") return false;
            hasDigits = true;
          }
          return hasDigits && isFinite(parseYamlInteger(data));
        }
        if (ch === "x") {
          index++;
          for (; index < max; index++) {
            if (!isHexCode(data.charCodeAt(index))) return false;
            hasDigits = true;
          }
          return hasDigits && isFinite(parseYamlInteger(data));
        }
        if (ch === "o") {
          index++;
          for (; index < max; index++) {
            if (!isOctCode(data.charCodeAt(index))) return false;
            hasDigits = true;
          }
          return hasDigits && isFinite(parseYamlInteger(data));
        }
      }
      for (; index < max; index++) {
        if (!isDecCode(data.charCodeAt(index))) {
          return false;
        }
        hasDigits = true;
      }
      if (!hasDigits) return false;
      return isFinite(parseYamlInteger(data));
    }
    function parseYamlInteger(data) {
      let value = data;
      let sign = 1;
      let ch = value[0];
      if (ch === "-" || ch === "+") {
        if (ch === "-") sign = -1;
        value = value.slice(1);
        ch = value[0];
      }
      if (value === "0") return 0;
      if (ch === "0") {
        if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
        if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
        if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
      }
      return sign * parseInt(value, 10);
    }
    function constructYamlInteger(data) {
      return parseYamlInteger(data);
    }
    function isInteger(object) {
      return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common.isNegativeZero(object));
    }
    module2.exports = new Type("tag:yaml.org,2002:int", {
      kind: "scalar",
      resolve: resolveYamlInteger,
      construct: constructYamlInteger,
      predicate: isInteger,
      represent: {
        binary: function(obj) {
          return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
        },
        octal: function(obj) {
          return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
        },
        decimal: function(obj) {
          return obj.toString(10);
        },
        hexadecimal: function(obj) {
          return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
        }
      },
      defaultStyle: "decimal",
      styleAliases: {
        binary: [2, "bin"],
        octal: [8, "oct"],
        decimal: [10, "dec"],
        hexadecimal: [16, "hex"]
      }
    });
  }
});

// node_modules/js-yaml/lib/type/float.js
var require_float = __commonJS({
  "node_modules/js-yaml/lib/type/float.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var Type = require_type();
    var YAML_FLOAT_PATTERN = new RegExp(
      // 2.5e4, 2.5 and integers
      "^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
    );
    var YAML_FLOAT_SPECIAL_PATTERN = new RegExp(
      "^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
    );
    function resolveYamlFloat(data) {
      if (data === null) return false;
      if (!YAML_FLOAT_PATTERN.test(data)) {
        return false;
      }
      if (isFinite(parseFloat(data, 10))) {
        return true;
      }
      return YAML_FLOAT_SPECIAL_PATTERN.test(data);
    }
    function constructYamlFloat(data) {
      let value = data.toLowerCase();
      const sign = value[0] === "-" ? -1 : 1;
      if ("+-".indexOf(value[0]) >= 0) {
        value = value.slice(1);
      }
      if (value === ".inf") {
        return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      } else if (value === ".nan") {
        return NaN;
      }
      return sign * parseFloat(value, 10);
    }
    var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
    function representYamlFloat(object, style) {
      if (isNaN(object)) {
        switch (style) {
          case "lowercase":
            return ".nan";
          case "uppercase":
            return ".NAN";
          case "camelcase":
            return ".NaN";
        }
      } else if (Number.POSITIVE_INFINITY === object) {
        switch (style) {
          case "lowercase":
            return ".inf";
          case "uppercase":
            return ".INF";
          case "camelcase":
            return ".Inf";
        }
      } else if (Number.NEGATIVE_INFINITY === object) {
        switch (style) {
          case "lowercase":
            return "-.inf";
          case "uppercase":
            return "-.INF";
          case "camelcase":
            return "-.Inf";
        }
      } else if (common.isNegativeZero(object)) {
        return "-0.0";
      }
      const res = object.toString(10);
      return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
    }
    function isFloat(object) {
      return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
    }
    module2.exports = new Type("tag:yaml.org,2002:float", {
      kind: "scalar",
      resolve: resolveYamlFloat,
      construct: constructYamlFloat,
      predicate: isFloat,
      represent: representYamlFloat,
      defaultStyle: "lowercase"
    });
  }
});

// node_modules/js-yaml/lib/schema/json.js
var require_json = __commonJS({
  "node_modules/js-yaml/lib/schema/json.js"(exports2, module2) {
    "use strict";
    module2.exports = require_failsafe().extend({
      implicit: [
        require_null(),
        require_bool(),
        require_int(),
        require_float()
      ]
    });
  }
});

// node_modules/js-yaml/lib/schema/core.js
var require_core = __commonJS({
  "node_modules/js-yaml/lib/schema/core.js"(exports2, module2) {
    "use strict";
    module2.exports = require_json();
  }
});

// node_modules/js-yaml/lib/type/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/js-yaml/lib/type/timestamp.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var YAML_DATE_REGEXP = new RegExp(
      "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
    );
    var YAML_TIMESTAMP_REGEXP = new RegExp(
      "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
    );
    function resolveYamlTimestamp(data) {
      if (data === null) return false;
      if (YAML_DATE_REGEXP.exec(data) !== null) return true;
      if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
      return false;
    }
    function constructYamlTimestamp(data) {
      let fraction = 0;
      let delta = null;
      let match = YAML_DATE_REGEXP.exec(data);
      if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
      if (match === null) throw new Error("Date resolve error");
      const year = +match[1];
      const month = +match[2] - 1;
      const day = +match[3];
      if (!match[4]) {
        return new Date(Date.UTC(year, month, day));
      }
      const hour = +match[4];
      const minute = +match[5];
      const second = +match[6];
      if (match[7]) {
        fraction = match[7].slice(0, 3);
        while (fraction.length < 3) {
          fraction += "0";
        }
        fraction = +fraction;
      }
      if (match[9]) {
        const tzHour = +match[10];
        const tzMinute = +(match[11] || 0);
        delta = (tzHour * 60 + tzMinute) * 6e4;
        if (match[9] === "-") delta = -delta;
      }
      const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
      if (delta) date.setTime(date.getTime() - delta);
      return date;
    }
    function representYamlTimestamp(object) {
      return object.toISOString();
    }
    module2.exports = new Type("tag:yaml.org,2002:timestamp", {
      kind: "scalar",
      resolve: resolveYamlTimestamp,
      construct: constructYamlTimestamp,
      instanceOf: Date,
      represent: representYamlTimestamp
    });
  }
});

// node_modules/js-yaml/lib/type/merge.js
var require_merge = __commonJS({
  "node_modules/js-yaml/lib/type/merge.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveYamlMerge(data) {
      return data === "<<" || data === null;
    }
    module2.exports = new Type("tag:yaml.org,2002:merge", {
      kind: "scalar",
      resolve: resolveYamlMerge
    });
  }
});

// node_modules/js-yaml/lib/type/binary.js
var require_binary = __commonJS({
  "node_modules/js-yaml/lib/type/binary.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
    function resolveYamlBinary(data) {
      if (data === null) return false;
      let bitlen = 0;
      const max = data.length;
      const map = BASE64_MAP;
      for (let idx = 0; idx < max; idx++) {
        const code = map.indexOf(data.charAt(idx));
        if (code > 64) continue;
        if (code < 0) return false;
        bitlen += 6;
      }
      return bitlen % 8 === 0;
    }
    function constructYamlBinary(data) {
      const input = data.replace(/[\r\n=]/g, "");
      const max = input.length;
      const map = BASE64_MAP;
      let bits = 0;
      const result = [];
      for (let idx = 0; idx < max; idx++) {
        if (idx % 4 === 0 && idx) {
          result.push(bits >> 16 & 255);
          result.push(bits >> 8 & 255);
          result.push(bits & 255);
        }
        bits = bits << 6 | map.indexOf(input.charAt(idx));
      }
      const tailbits = max % 4 * 6;
      if (tailbits === 0) {
        result.push(bits >> 16 & 255);
        result.push(bits >> 8 & 255);
        result.push(bits & 255);
      } else if (tailbits === 18) {
        result.push(bits >> 10 & 255);
        result.push(bits >> 2 & 255);
      } else if (tailbits === 12) {
        result.push(bits >> 4 & 255);
      }
      return new Uint8Array(result);
    }
    function representYamlBinary(object) {
      let result = "";
      let bits = 0;
      const max = object.length;
      const map = BASE64_MAP;
      for (let idx = 0; idx < max; idx++) {
        if (idx % 3 === 0 && idx) {
          result += map[bits >> 18 & 63];
          result += map[bits >> 12 & 63];
          result += map[bits >> 6 & 63];
          result += map[bits & 63];
        }
        bits = (bits << 8) + object[idx];
      }
      const tail = max % 3;
      if (tail === 0) {
        result += map[bits >> 18 & 63];
        result += map[bits >> 12 & 63];
        result += map[bits >> 6 & 63];
        result += map[bits & 63];
      } else if (tail === 2) {
        result += map[bits >> 10 & 63];
        result += map[bits >> 4 & 63];
        result += map[bits << 2 & 63];
        result += map[64];
      } else if (tail === 1) {
        result += map[bits >> 2 & 63];
        result += map[bits << 4 & 63];
        result += map[64];
        result += map[64];
      }
      return result;
    }
    function isBinary(obj) {
      return Object.prototype.toString.call(obj) === "[object Uint8Array]";
    }
    module2.exports = new Type("tag:yaml.org,2002:binary", {
      kind: "scalar",
      resolve: resolveYamlBinary,
      construct: constructYamlBinary,
      predicate: isBinary,
      represent: representYamlBinary
    });
  }
});

// node_modules/js-yaml/lib/type/omap.js
var require_omap = __commonJS({
  "node_modules/js-yaml/lib/type/omap.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var _toString = Object.prototype.toString;
    function resolveYamlOmap(data) {
      if (data === null) return true;
      const objectKeys = {};
      const object = data;
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
        let pairHasKey = false;
        if (_toString.call(pair) !== "[object Object]") return false;
        let pairKey;
        for (pairKey in pair) {
          if (_hasOwnProperty.call(pair, pairKey)) {
            if (!pairHasKey) pairHasKey = true;
            else return false;
          }
        }
        if (!pairHasKey) return false;
        if (_hasOwnProperty.call(objectKeys, pairKey)) return false;
        Object.defineProperty(objectKeys, pairKey, { value: true });
      }
      return true;
    }
    function constructYamlOmap(data) {
      return data !== null ? data : [];
    }
    module2.exports = new Type("tag:yaml.org,2002:omap", {
      kind: "sequence",
      resolve: resolveYamlOmap,
      construct: constructYamlOmap
    });
  }
});

// node_modules/js-yaml/lib/type/pairs.js
var require_pairs = __commonJS({
  "node_modules/js-yaml/lib/type/pairs.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _toString = Object.prototype.toString;
    function resolveYamlPairs(data) {
      if (data === null) return true;
      const object = data;
      const result = new Array(object.length);
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
        if (_toString.call(pair) !== "[object Object]") return false;
        const keys = Object.keys(pair);
        if (keys.length !== 1) return false;
        result[index] = [keys[0], pair[keys[0]]];
      }
      return true;
    }
    function constructYamlPairs(data) {
      if (data === null) return [];
      const object = data;
      const result = new Array(object.length);
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
        const keys = Object.keys(pair);
        result[index] = [keys[0], pair[keys[0]]];
      }
      return result;
    }
    module2.exports = new Type("tag:yaml.org,2002:pairs", {
      kind: "sequence",
      resolve: resolveYamlPairs,
      construct: constructYamlPairs
    });
  }
});

// node_modules/js-yaml/lib/type/set.js
var require_set = __commonJS({
  "node_modules/js-yaml/lib/type/set.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    function resolveYamlSet(data) {
      if (data === null) return true;
      const object = data;
      for (const key in object) {
        if (_hasOwnProperty.call(object, key)) {
          if (object[key] !== null) return false;
        }
      }
      return true;
    }
    function constructYamlSet(data) {
      return data !== null ? data : {};
    }
    module2.exports = new Type("tag:yaml.org,2002:set", {
      kind: "mapping",
      resolve: resolveYamlSet,
      construct: constructYamlSet
    });
  }
});

// node_modules/js-yaml/lib/schema/default.js
var require_default = __commonJS({
  "node_modules/js-yaml/lib/schema/default.js"(exports2, module2) {
    "use strict";
    module2.exports = require_core().extend({
      implicit: [
        require_timestamp(),
        require_merge()
      ],
      explicit: [
        require_binary(),
        require_omap(),
        require_pairs(),
        require_set()
      ]
    });
  }
});

// node_modules/js-yaml/lib/loader.js
var require_loader = __commonJS({
  "node_modules/js-yaml/lib/loader.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var YAMLException = require_exception();
    var makeSnippet = require_snippet();
    var DEFAULT_SCHEMA = require_default();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var CONTEXT_FLOW_IN = 1;
    var CONTEXT_FLOW_OUT = 2;
    var CONTEXT_BLOCK_IN = 3;
    var CONTEXT_BLOCK_OUT = 4;
    var CHOMPING_CLIP = 1;
    var CHOMPING_STRIP = 2;
    var CHOMPING_KEEP = 3;
    var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
    var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
    var PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
    var PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
    var PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
    function _class(obj) {
      return Object.prototype.toString.call(obj);
    }
    function isEol(c) {
      return c === 10 || c === 13;
    }
    function isWhiteSpace(c) {
      return c === 9 || c === 32;
    }
    function isWsOrEol(c) {
      return c === 9 || c === 32 || c === 10 || c === 13;
    }
    function isFlowIndicator(c) {
      return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
    }
    function fromHexCode(c) {
      if (c >= 48 && c <= 57) {
        return c - 48;
      }
      const lc = c | 32;
      if (lc >= 97 && lc <= 102) {
        return lc - 97 + 10;
      }
      return -1;
    }
    function escapedHexLen(c) {
      if (c === 120) {
        return 2;
      }
      if (c === 117) {
        return 4;
      }
      if (c === 85) {
        return 8;
      }
      return 0;
    }
    function fromDecimalCode(c) {
      if (c >= 48 && c <= 57) {
        return c - 48;
      }
      return -1;
    }
    function simpleEscapeSequence(c) {
      switch (c) {
        case 48:
          return "\0";
        case 97:
          return "\x07";
        case 98:
          return "\b";
        case 116:
          return "	";
        case 9:
          return "	";
        case 110:
          return "\n";
        case 118:
          return "\v";
        case 102:
          return "\f";
        case 114:
          return "\r";
        case 101:
          return "\x1B";
        case 32:
          return " ";
        case 34:
          return '"';
        case 47:
          return "/";
        case 92:
          return "\\";
        case 78:
          return "\x85";
        case 95:
          return "\xA0";
        case 76:
          return "\u2028";
        case 80:
          return "\u2029";
        default:
          return "";
      }
    }
    function charFromCodepoint(c) {
      if (c <= 65535) {
        return String.fromCharCode(c);
      }
      return String.fromCharCode(
        (c - 65536 >> 10) + 55296,
        (c - 65536 & 1023) + 56320
      );
    }
    function setProperty(object, key, value) {
      if (key === "__proto__") {
        Object.defineProperty(object, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value
        });
      } else {
        object[key] = value;
      }
    }
    var simpleEscapeCheck = new Array(256);
    var simpleEscapeMap = new Array(256);
    for (let i = 0; i < 256; i++) {
      simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
      simpleEscapeMap[i] = simpleEscapeSequence(i);
    }
    function State(input, options) {
      this.input = input;
      this.filename = options["filename"] || null;
      this.schema = options["schema"] || DEFAULT_SCHEMA;
      this.onWarning = options["onWarning"] || null;
      this.legacy = options["legacy"] || false;
      this.json = options["json"] || false;
      this.listener = options["listener"] || null;
      this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
      this.maxTotalMergeKeys = typeof options["maxTotalMergeKeys"] === "number" ? options["maxTotalMergeKeys"] : 1e4;
      this.implicitTypes = this.schema.compiledImplicit;
      this.typeMap = this.schema.compiledTypeMap;
      this.length = input.length;
      this.position = 0;
      this.line = 0;
      this.lineStart = 0;
      this.lineIndent = 0;
      this.depth = 0;
      this.totalMergeKeys = 0;
      this.firstTabInLine = -1;
      this.documents = [];
      this.anchorMapTransactions = [];
    }
    function generateError(state, message) {
      const mark = {
        name: state.filename,
        buffer: state.input.slice(0, -1),
        // omit trailing \0
        position: state.position,
        line: state.line,
        column: state.position - state.lineStart
      };
      mark.snippet = makeSnippet(mark);
      return new YAMLException(message, mark);
    }
    function throwError(state, message) {
      throw generateError(state, message);
    }
    function throwWarning(state, message) {
      if (state.onWarning) {
        state.onWarning.call(null, generateError(state, message));
      }
    }
    function storeAnchor(state, name, value) {
      const transactions = state.anchorMapTransactions;
      if (transactions.length !== 0) {
        const transaction = transactions[transactions.length - 1];
        if (!_hasOwnProperty.call(transaction, name)) {
          transaction[name] = {
            existed: _hasOwnProperty.call(state.anchorMap, name),
            value: state.anchorMap[name]
          };
        }
      }
      state.anchorMap[name] = value;
    }
    function beginAnchorTransaction(state) {
      state.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
    }
    function commitAnchorTransaction(state) {
      const transaction = state.anchorMapTransactions.pop();
      const transactions = state.anchorMapTransactions;
      if (transactions.length === 0) return;
      const parent = transactions[transactions.length - 1];
      const names = Object.keys(transaction);
      for (let index = 0, length = names.length; index < length; index += 1) {
        const name = names[index];
        if (!_hasOwnProperty.call(parent, name)) {
          parent[name] = transaction[name];
        }
      }
    }
    function rollbackAnchorTransaction(state) {
      const transaction = state.anchorMapTransactions.pop();
      const names = Object.keys(transaction);
      for (let index = names.length - 1; index >= 0; index -= 1) {
        const entry = transaction[names[index]];
        if (entry.existed) {
          state.anchorMap[names[index]] = entry.value;
        } else {
          delete state.anchorMap[names[index]];
        }
      }
    }
    function snapshotState(state) {
      return {
        position: state.position,
        line: state.line,
        lineStart: state.lineStart,
        lineIndent: state.lineIndent,
        firstTabInLine: state.firstTabInLine,
        tag: state.tag,
        anchor: state.anchor,
        kind: state.kind,
        result: state.result
      };
    }
    function restoreState(state, snapshot) {
      state.position = snapshot.position;
      state.line = snapshot.line;
      state.lineStart = snapshot.lineStart;
      state.lineIndent = snapshot.lineIndent;
      state.firstTabInLine = snapshot.firstTabInLine;
      state.tag = snapshot.tag;
      state.anchor = snapshot.anchor;
      state.kind = snapshot.kind;
      state.result = snapshot.result;
    }
    var directiveHandlers = {
      YAML: function handleYamlDirective(state, name, args) {
        if (state.version !== null) {
          throwError(state, "duplication of %YAML directive");
        }
        if (args.length !== 1) {
          throwError(state, "YAML directive accepts exactly one argument");
        }
        const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
        if (match === null) {
          throwError(state, "ill-formed argument of the YAML directive");
        }
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        if (major !== 1) {
          throwError(state, "unacceptable YAML version of the document");
        }
        state.version = args[0];
        state.checkLineBreaks = minor < 2;
        if (minor !== 1 && minor !== 2) {
          throwWarning(state, "unsupported YAML version of the document");
        }
      },
      TAG: function handleTagDirective(state, name, args) {
        let prefix;
        if (args.length !== 2) {
          throwError(state, "TAG directive accepts exactly two arguments");
        }
        const handle = args[0];
        prefix = args[1];
        if (!PATTERN_TAG_HANDLE.test(handle)) {
          throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
        }
        if (_hasOwnProperty.call(state.tagMap, handle)) {
          throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
        }
        if (!PATTERN_TAG_URI.test(prefix)) {
          throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
        }
        try {
          prefix = decodeURIComponent(prefix);
        } catch (err) {
          throwError(state, "tag prefix is malformed: " + prefix);
        }
        state.tagMap[handle] = prefix;
      }
    };
    function captureSegment(state, start, end, checkJson) {
      if (start < end) {
        const _result = state.input.slice(start, end);
        if (checkJson) {
          for (let _position = 0, _length = _result.length; _position < _length; _position += 1) {
            const _character = _result.charCodeAt(_position);
            if (!(_character === 9 || _character >= 32 && _character <= 1114111)) {
              throwError(state, "expected valid JSON character");
            }
          }
        } else if (PATTERN_NON_PRINTABLE.test(_result)) {
          throwError(state, "the stream contains non-printable characters");
        }
        state.result += _result;
      }
    }
    function mergeMappings(state, destination, source, overridableKeys) {
      if (!common.isObject(source)) {
        throwError(state, "cannot merge mappings; the provided source object is unacceptable");
      }
      const sourceKeys = Object.keys(source);
      for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
        const key = sourceKeys[index];
        if (state.maxTotalMergeKeys !== -1 && ++state.totalMergeKeys > state.maxTotalMergeKeys) {
          throwError(state, "merge keys exceeded maxTotalMergeKeys (" + state.maxTotalMergeKeys + ")");
        }
        if (!_hasOwnProperty.call(destination, key)) {
          setProperty(destination, key, source[key]);
          overridableKeys[key] = true;
        }
      }
    }
    function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
      if (Array.isArray(keyNode)) {
        keyNode = Array.prototype.slice.call(keyNode);
        for (let index = 0, quantity = keyNode.length; index < quantity; index += 1) {
          if (Array.isArray(keyNode[index])) {
            throwError(state, "nested arrays are not supported inside keys");
          }
          if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
            keyNode[index] = "[object Object]";
          }
        }
      }
      if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
        keyNode = "[object Object]";
      }
      keyNode = String(keyNode);
      if (_result === null) {
        _result = {};
      }
      if (keyTag === "tag:yaml.org,2002:merge") {
        if (Array.isArray(valueNode)) {
          for (let index = 0, quantity = valueNode.length; index < quantity; index += 1) {
            mergeMappings(state, _result, valueNode[index], overridableKeys);
          }
        } else {
          mergeMappings(state, _result, valueNode, overridableKeys);
        }
      } else {
        if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
          state.line = startLine || state.line;
          state.lineStart = startLineStart || state.lineStart;
          state.position = startPos || state.position;
          throwError(state, "duplicated mapping key");
        }
        setProperty(_result, keyNode, valueNode);
        delete overridableKeys[keyNode];
      }
      return _result;
    }
    function readLineBreak(state) {
      const ch = state.input.charCodeAt(state.position);
      if (ch === 10) {
        state.position++;
      } else if (ch === 13) {
        state.position++;
        if (state.input.charCodeAt(state.position) === 10) {
          state.position++;
        }
      } else {
        throwError(state, "a line break is expected");
      }
      state.line += 1;
      state.lineStart = state.position;
      state.firstTabInLine = -1;
    }
    function skipSeparationSpace(state, allowComments, checkIndent) {
      let lineBreaks = 0;
      let ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        while (isWhiteSpace(ch)) {
          if (ch === 9 && state.firstTabInLine === -1) {
            state.firstTabInLine = state.position;
          }
          ch = state.input.charCodeAt(++state.position);
        }
        if (allowComments && ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (ch !== 10 && ch !== 13 && ch !== 0);
        }
        if (isEol(ch)) {
          readLineBreak(state);
          ch = state.input.charCodeAt(state.position);
          lineBreaks++;
          state.lineIndent = 0;
          while (ch === 32) {
            state.lineIndent++;
            ch = state.input.charCodeAt(++state.position);
          }
        } else {
          break;
        }
      }
      if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
        throwWarning(state, "deficient indentation");
      }
      return lineBreaks;
    }
    function testDocumentSeparator(state) {
      let _position = state.position;
      let ch = state.input.charCodeAt(_position);
      if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
        _position += 3;
        ch = state.input.charCodeAt(_position);
        if (ch === 0 || isWsOrEol(ch)) {
          return true;
        }
      }
      return false;
    }
    function writeFoldedLines(state, count) {
      if (count === 1) {
        state.result += " ";
      } else if (count > 1) {
        state.result += common.repeat("\n", count - 1);
      }
    }
    function readPlainScalar(state, nodeIndent, withinFlowCollection) {
      let captureStart;
      let captureEnd;
      let hasPendingContent;
      let _line;
      let _lineStart;
      let _lineIndent;
      const _kind = state.kind;
      const _result = state.result;
      let ch = state.input.charCodeAt(state.position);
      if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
        return false;
      }
      if (ch === 63 || ch === 45) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
          return false;
        }
      }
      state.kind = "scalar";
      state.result = "";
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
      while (ch !== 0) {
        if (ch === 58) {
          const following = state.input.charCodeAt(state.position + 1);
          if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
            break;
          }
        } else if (ch === 35) {
          const preceding = state.input.charCodeAt(state.position - 1);
          if (isWsOrEol(preceding)) {
            break;
          }
        } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch)) {
          break;
        } else if (isEol(ch)) {
          _line = state.line;
          _lineStart = state.lineStart;
          _lineIndent = state.lineIndent;
          skipSeparationSpace(state, false, -1);
          if (state.lineIndent >= nodeIndent) {
            hasPendingContent = true;
            ch = state.input.charCodeAt(state.position);
            continue;
          } else {
            state.position = captureEnd;
            state.line = _line;
            state.lineStart = _lineStart;
            state.lineIndent = _lineIndent;
            break;
          }
        }
        if (hasPendingContent) {
          captureSegment(state, captureStart, captureEnd, false);
          writeFoldedLines(state, state.line - _line);
          captureStart = captureEnd = state.position;
          hasPendingContent = false;
        }
        if (!isWhiteSpace(ch)) {
          captureEnd = state.position + 1;
        }
        ch = state.input.charCodeAt(++state.position);
      }
      captureSegment(state, captureStart, captureEnd, false);
      if (state.result) {
        return true;
      }
      state.kind = _kind;
      state.result = _result;
      return false;
    }
    function readSingleQuotedScalar(state, nodeIndent) {
      let captureStart;
      let captureEnd;
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 39) {
        return false;
      }
      state.kind = "scalar";
      state.result = "";
      state.position++;
      captureStart = captureEnd = state.position;
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        if (ch === 39) {
          captureSegment(state, captureStart, state.position, true);
          ch = state.input.charCodeAt(++state.position);
          if (ch === 39) {
            captureStart = state.position;
            state.position++;
            captureEnd = state.position;
          } else {
            return true;
          }
        } else if (isEol(ch)) {
          captureSegment(state, captureStart, captureEnd, true);
          writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
          captureStart = captureEnd = state.position;
        } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
          throwError(state, "unexpected end of the document within a single quoted scalar");
        } else {
          state.position++;
          if (!isWhiteSpace(ch)) {
            captureEnd = state.position;
          }
        }
      }
      throwError(state, "unexpected end of the stream within a single quoted scalar");
    }
    function readDoubleQuotedScalar(state, nodeIndent) {
      let captureStart;
      let captureEnd;
      let tmp;
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 34) {
        return false;
      }
      state.kind = "scalar";
      state.result = "";
      state.position++;
      captureStart = captureEnd = state.position;
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        if (ch === 34) {
          captureSegment(state, captureStart, state.position, true);
          state.position++;
          return true;
        } else if (ch === 92) {
          captureSegment(state, captureStart, state.position, true);
          ch = state.input.charCodeAt(++state.position);
          if (isEol(ch)) {
            skipSeparationSpace(state, false, nodeIndent);
          } else if (ch < 256 && simpleEscapeCheck[ch]) {
            state.result += simpleEscapeMap[ch];
            state.position++;
          } else if ((tmp = escapedHexLen(ch)) > 0) {
            let hexLength = tmp;
            let hexResult = 0;
            for (; hexLength > 0; hexLength--) {
              ch = state.input.charCodeAt(++state.position);
              if ((tmp = fromHexCode(ch)) >= 0) {
                hexResult = (hexResult << 4) + tmp;
              } else {
                throwError(state, "expected hexadecimal character");
              }
            }
            state.result += charFromCodepoint(hexResult);
            state.position++;
          } else {
            throwError(state, "unknown escape sequence");
          }
          captureStart = captureEnd = state.position;
        } else if (isEol(ch)) {
          captureSegment(state, captureStart, captureEnd, true);
          writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
          captureStart = captureEnd = state.position;
        } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
          throwError(state, "unexpected end of the document within a double quoted scalar");
        } else {
          state.position++;
          if (!isWhiteSpace(ch)) {
            captureEnd = state.position;
          }
        }
      }
      throwError(state, "unexpected end of the stream within a double quoted scalar");
    }
    function readFlowCollection(state, nodeIndent) {
      let readNext = true;
      let _line;
      let _lineStart;
      let _pos;
      const _tag = state.tag;
      let _result;
      const _anchor = state.anchor;
      let terminator;
      let isPair;
      let isExplicitPair;
      let isMapping;
      const overridableKeys = /* @__PURE__ */ Object.create(null);
      let keyNode;
      let keyTag;
      let valueNode;
      let ch = state.input.charCodeAt(state.position);
      if (ch === 91) {
        terminator = 93;
        isMapping = false;
        _result = [];
      } else if (ch === 123) {
        terminator = 125;
        isMapping = true;
        _result = {};
      } else {
        return false;
      }
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, _result);
      }
      ch = state.input.charCodeAt(++state.position);
      while (ch !== 0) {
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if (ch === terminator) {
          state.position++;
          state.tag = _tag;
          state.anchor = _anchor;
          state.kind = isMapping ? "mapping" : "sequence";
          state.result = _result;
          return true;
        } else if (!readNext) {
          throwError(state, "missed comma between flow collection entries");
        } else if (ch === 44) {
          throwError(state, "expected the node content, but found ','");
        }
        keyTag = keyNode = valueNode = null;
        isPair = isExplicitPair = false;
        if (ch === 63) {
          const following = state.input.charCodeAt(state.position + 1);
          if (isWsOrEol(following)) {
            isPair = isExplicitPair = true;
            state.position++;
            skipSeparationSpace(state, true, nodeIndent);
          }
        }
        _line = state.line;
        _lineStart = state.lineStart;
        _pos = state.position;
        composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
        keyTag = state.tag;
        keyNode = state.result;
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if ((isExplicitPair || state.line === _line) && ch === 58) {
          isPair = true;
          ch = state.input.charCodeAt(++state.position);
          skipSeparationSpace(state, true, nodeIndent);
          composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
          valueNode = state.result;
        }
        if (isMapping) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
        } else if (isPair) {
          _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
        } else {
          _result.push(keyNode);
        }
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if (ch === 44) {
          readNext = true;
          ch = state.input.charCodeAt(++state.position);
        } else {
          readNext = false;
        }
      }
      throwError(state, "unexpected end of the stream within a flow collection");
    }
    function readBlockScalar(state, nodeIndent) {
      let folding;
      let chomping = CHOMPING_CLIP;
      let didReadContent = false;
      let detectedIndent = false;
      let textIndent = nodeIndent;
      let emptyLines = 0;
      let atMoreIndented = false;
      let tmp;
      let ch = state.input.charCodeAt(state.position);
      if (ch === 124) {
        folding = false;
      } else if (ch === 62) {
        folding = true;
      } else {
        return false;
      }
      state.kind = "scalar";
      state.result = "";
      while (ch !== 0) {
        ch = state.input.charCodeAt(++state.position);
        if (ch === 43 || ch === 45) {
          if (CHOMPING_CLIP === chomping) {
            chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
          } else {
            throwError(state, "repeat of a chomping mode identifier");
          }
        } else if ((tmp = fromDecimalCode(ch)) >= 0) {
          if (tmp === 0) {
            throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
          } else if (!detectedIndent) {
            textIndent = nodeIndent + tmp - 1;
            detectedIndent = true;
          } else {
            throwError(state, "repeat of an indentation width identifier");
          }
        } else {
          break;
        }
      }
      if (isWhiteSpace(ch)) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (isWhiteSpace(ch));
        if (ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (!isEol(ch) && ch !== 0);
        }
      }
      while (ch !== 0) {
        readLineBreak(state);
        state.lineIndent = 0;
        ch = state.input.charCodeAt(state.position);
        while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
          state.lineIndent++;
          ch = state.input.charCodeAt(++state.position);
        }
        if (!detectedIndent && state.lineIndent > textIndent) {
          textIndent = state.lineIndent;
        }
        if (isEol(ch)) {
          emptyLines++;
          continue;
        }
        if (!detectedIndent && textIndent === 0) {
          throwError(state, "missing indentation for block scalar");
        }
        if (state.lineIndent < textIndent) {
          if (chomping === CHOMPING_KEEP) {
            state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
          } else if (chomping === CHOMPING_CLIP) {
            if (didReadContent) {
              state.result += "\n";
            }
          }
          break;
        }
        if (folding) {
          if (isWhiteSpace(ch)) {
            atMoreIndented = true;
            state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
          } else if (atMoreIndented) {
            atMoreIndented = false;
            state.result += common.repeat("\n", emptyLines + 1);
          } else if (emptyLines === 0) {
            if (didReadContent) {
              state.result += " ";
            }
          } else {
            state.result += common.repeat("\n", emptyLines);
          }
        } else {
          state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        }
        didReadContent = true;
        detectedIndent = true;
        emptyLines = 0;
        const captureStart = state.position;
        while (!isEol(ch) && ch !== 0) {
          ch = state.input.charCodeAt(++state.position);
        }
        captureSegment(state, captureStart, state.position, false);
      }
      return true;
    }
    function readBlockSequence(state, nodeIndent) {
      const _tag = state.tag;
      const _anchor = state.anchor;
      const _result = [];
      let detected = false;
      if (state.firstTabInLine !== -1) return false;
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, _result);
      }
      let ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        if (state.firstTabInLine !== -1) {
          state.position = state.firstTabInLine;
          throwError(state, "tab characters must not be used in indentation");
        }
        if (ch !== 45) {
          break;
        }
        const following = state.input.charCodeAt(state.position + 1);
        if (!isWsOrEol(following)) {
          break;
        }
        detected = true;
        state.position++;
        if (skipSeparationSpace(state, true, -1)) {
          if (state.lineIndent <= nodeIndent) {
            _result.push(null);
            ch = state.input.charCodeAt(state.position);
            continue;
          }
        }
        const _line = state.line;
        composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
        _result.push(state.result);
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
        if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
          throwError(state, "bad indentation of a sequence entry");
        } else if (state.lineIndent < nodeIndent) {
          break;
        }
      }
      if (detected) {
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = "sequence";
        state.result = _result;
        return true;
      }
      return false;
    }
    function readBlockMapping(state, nodeIndent, flowIndent) {
      let allowCompact;
      let _keyLine;
      let _keyLineStart;
      let _keyPos;
      const _tag = state.tag;
      const _anchor = state.anchor;
      const _result = {};
      const overridableKeys = /* @__PURE__ */ Object.create(null);
      let keyTag = null;
      let keyNode = null;
      let valueNode = null;
      let atExplicitKey = false;
      let detected = false;
      if (state.firstTabInLine !== -1) return false;
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, _result);
      }
      let ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        if (!atExplicitKey && state.firstTabInLine !== -1) {
          state.position = state.firstTabInLine;
          throwError(state, "tab characters must not be used in indentation");
        }
        const following = state.input.charCodeAt(state.position + 1);
        const _line = state.line;
        if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
          if (ch === 63) {
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
              keyTag = keyNode = valueNode = null;
            }
            detected = true;
            atExplicitKey = true;
            allowCompact = true;
          } else if (atExplicitKey) {
            atExplicitKey = false;
            allowCompact = true;
          } else {
            throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
          }
          state.position += 1;
          ch = following;
        } else {
          _keyLine = state.line;
          _keyLineStart = state.lineStart;
          _keyPos = state.position;
          if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
            break;
          }
          if (state.line === _line) {
            ch = state.input.charCodeAt(state.position);
            while (isWhiteSpace(ch)) {
              ch = state.input.charCodeAt(++state.position);
            }
            if (ch === 58) {
              ch = state.input.charCodeAt(++state.position);
              if (!isWsOrEol(ch)) {
                throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
              }
              if (atExplicitKey) {
                storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
                keyTag = keyNode = valueNode = null;
              }
              detected = true;
              atExplicitKey = false;
              allowCompact = false;
              keyTag = state.tag;
              keyNode = state.result;
            } else if (detected) {
              throwError(state, "can not read an implicit mapping pair; a colon is missed");
            } else {
              state.tag = _tag;
              state.anchor = _anchor;
              return true;
            }
          } else if (detected) {
            throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
          } else {
            state.tag = _tag;
            state.anchor = _anchor;
            return true;
          }
        }
        if (state.line === _line || state.lineIndent > nodeIndent) {
          if (atExplicitKey) {
            _keyLine = state.line;
            _keyLineStart = state.lineStart;
            _keyPos = state.position;
          }
          if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
            if (atExplicitKey) {
              keyNode = state.result;
            } else {
              valueNode = state.result;
            }
          }
          if (!atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          skipSeparationSpace(state, true, -1);
          ch = state.input.charCodeAt(state.position);
        }
        if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
          throwError(state, "bad indentation of a mapping entry");
        } else if (state.lineIndent < nodeIndent) {
          break;
        }
      }
      if (atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
      }
      if (detected) {
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = "mapping";
        state.result = _result;
      }
      return detected;
    }
    function readTagProperty(state) {
      let isVerbatim = false;
      let isNamed = false;
      let tagHandle;
      let tagName;
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 33) return false;
      if (state.tag !== null) {
        throwError(state, "duplication of a tag property");
      }
      ch = state.input.charCodeAt(++state.position);
      if (ch === 60) {
        isVerbatim = true;
        ch = state.input.charCodeAt(++state.position);
      } else if (ch === 33) {
        isNamed = true;
        tagHandle = "!!";
        ch = state.input.charCodeAt(++state.position);
      } else {
        tagHandle = "!";
      }
      let _position = state.position;
      if (isVerbatim) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 0 && ch !== 62);
        if (state.position < state.length) {
          tagName = state.input.slice(_position, state.position);
          ch = state.input.charCodeAt(++state.position);
        } else {
          throwError(state, "unexpected end of the stream within a verbatim tag");
        }
      } else {
        while (ch !== 0 && !isWsOrEol(ch)) {
          if (ch === 33) {
            if (!isNamed) {
              tagHandle = state.input.slice(_position - 1, state.position + 1);
              if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
                throwError(state, "named tag handle cannot contain such characters");
              }
              isNamed = true;
              _position = state.position + 1;
            } else {
              throwError(state, "tag suffix cannot contain exclamation marks");
            }
          }
          ch = state.input.charCodeAt(++state.position);
        }
        tagName = state.input.slice(_position, state.position);
        if (PATTERN_FLOW_INDICATORS.test(tagName)) {
          throwError(state, "tag suffix cannot contain flow indicator characters");
        }
      }
      if (tagName && !PATTERN_TAG_URI.test(tagName)) {
        throwError(state, "tag name cannot contain such characters: " + tagName);
      }
      try {
        tagName = decodeURIComponent(tagName);
      } catch (err) {
        throwError(state, "tag name is malformed: " + tagName);
      }
      if (isVerbatim) {
        state.tag = tagName;
      } else if (_hasOwnProperty.call(state.tagMap, tagHandle)) {
        state.tag = state.tagMap[tagHandle] + tagName;
      } else if (tagHandle === "!") {
        state.tag = "!" + tagName;
      } else if (tagHandle === "!!") {
        state.tag = "tag:yaml.org,2002:" + tagName;
      } else {
        throwError(state, 'undeclared tag handle "' + tagHandle + '"');
      }
      return true;
    }
    function readAnchorProperty(state) {
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 38) return false;
      if (state.anchor !== null) {
        throwError(state, "duplication of an anchor property");
      }
      ch = state.input.charCodeAt(++state.position);
      const _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (state.position === _position) {
        throwError(state, "name of an anchor node must contain at least one character");
      }
      state.anchor = state.input.slice(_position, state.position);
      return true;
    }
    function readAlias(state) {
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 42) return false;
      ch = state.input.charCodeAt(++state.position);
      const _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (state.position === _position) {
        throwError(state, "name of an alias node must contain at least one character");
      }
      const alias = state.input.slice(_position, state.position);
      if (!_hasOwnProperty.call(state.anchorMap, alias)) {
        throwError(state, 'unidentified alias "' + alias + '"');
      }
      state.result = state.anchorMap[alias];
      skipSeparationSpace(state, true, -1);
      return true;
    }
    function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
      const fallbackState = snapshotState(state);
      beginAnchorTransaction(state);
      restoreState(state, propertyStart);
      state.tag = null;
      state.anchor = null;
      state.kind = null;
      state.result = null;
      if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
        commitAnchorTransaction(state);
        return true;
      }
      rollbackAnchorTransaction(state);
      restoreState(state, fallbackState);
      return false;
    }
    function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
      let allowBlockScalars;
      let allowBlockCollections;
      let indentStatus = 1;
      let atNewLine = false;
      let hasContent = false;
      let propertyStart = null;
      let type;
      let flowIndent;
      let blockIndent;
      if (state.depth >= state.maxDepth) {
        throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
      }
      state.depth += 1;
      if (state.listener !== null) {
        state.listener("open", state);
      }
      state.tag = null;
      state.anchor = null;
      state.kind = null;
      state.result = null;
      const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
      if (allowToSeek) {
        if (skipSeparationSpace(state, true, -1)) {
          atNewLine = true;
          if (state.lineIndent > parentIndent) {
            indentStatus = 1;
          } else if (state.lineIndent === parentIndent) {
            indentStatus = 0;
          } else if (state.lineIndent < parentIndent) {
            indentStatus = -1;
          }
        }
      }
      if (indentStatus === 1) {
        while (true) {
          const ch = state.input.charCodeAt(state.position);
          const propertyState = snapshotState(state);
          if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null)) {
            break;
          }
          if (!readTagProperty(state) && !readAnchorProperty(state)) {
            break;
          }
          if (propertyStart === null) {
            propertyStart = propertyState;
          }
          if (skipSeparationSpace(state, true, -1)) {
            atNewLine = true;
            allowBlockCollections = allowBlockStyles;
            if (state.lineIndent > parentIndent) {
              indentStatus = 1;
            } else if (state.lineIndent === parentIndent) {
              indentStatus = 0;
            } else if (state.lineIndent < parentIndent) {
              indentStatus = -1;
            }
          } else {
            allowBlockCollections = false;
          }
        }
      }
      if (allowBlockCollections) {
        allowBlockCollections = atNewLine || allowCompact;
      }
      if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
        if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
          flowIndent = parentIndent;
        } else {
          flowIndent = parentIndent + 1;
        }
        blockIndent = state.position - state.lineStart;
        if (indentStatus === 1) {
          if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
            hasContent = true;
          } else {
            const ch = state.input.charCodeAt(state.position);
            if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(
              state,
              propertyStart,
              propertyStart.position - propertyStart.lineStart,
              flowIndent
            )) {
              hasContent = true;
            } else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
              hasContent = true;
            } else if (readAlias(state)) {
              hasContent = true;
              if (state.tag !== null || state.anchor !== null) {
                throwError(state, "alias node should not have any properties");
              }
            } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
              hasContent = true;
              if (state.tag === null) {
                state.tag = "?";
              }
            }
            if (state.anchor !== null) {
              storeAnchor(state, state.anchor, state.result);
            }
          }
        } else if (indentStatus === 0) {
          hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
        }
      }
      if (state.tag === null) {
        if (state.anchor !== null) {
          storeAnchor(state, state.anchor, state.result);
        }
      } else if (state.tag === "?") {
        if (state.result !== null && state.kind !== "scalar") {
          throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
        }
        for (let typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
          type = state.implicitTypes[typeIndex];
          if (type.resolve(state.result)) {
            state.result = type.construct(state.result);
            state.tag = type.tag;
            if (state.anchor !== null) {
              storeAnchor(state, state.anchor, state.result);
            }
            break;
          }
        }
      } else if (state.tag !== "!") {
        if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) {
          type = state.typeMap[state.kind || "fallback"][state.tag];
        } else {
          type = null;
          const typeList = state.typeMap.multi[state.kind || "fallback"];
          for (let typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
            if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
              type = typeList[typeIndex];
              break;
            }
          }
        }
        if (!type) {
          throwError(state, "unknown tag !<" + state.tag + ">");
        }
        if (state.result !== null && type.kind !== state.kind) {
          throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type.kind + '", not "' + state.kind + '"');
        }
        if (!type.resolve(state.result, state.tag)) {
          throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
        } else {
          state.result = type.construct(state.result, state.tag);
          if (state.anchor !== null) {
            storeAnchor(state, state.anchor, state.result);
          }
        }
      }
      if (state.listener !== null) {
        state.listener("close", state);
      }
      state.depth -= 1;
      return state.tag !== null || state.anchor !== null || hasContent;
    }
    function readDocument(state) {
      const documentStart = state.position;
      let hasDirectives = false;
      let ch;
      state.version = null;
      state.checkLineBreaks = state.legacy;
      state.tagMap = /* @__PURE__ */ Object.create(null);
      state.anchorMap = /* @__PURE__ */ Object.create(null);
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
        if (state.lineIndent > 0 || ch !== 37) {
          break;
        }
        hasDirectives = true;
        ch = state.input.charCodeAt(++state.position);
        let _position = state.position;
        while (ch !== 0 && !isWsOrEol(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        const directiveName = state.input.slice(_position, state.position);
        const directiveArgs = [];
        if (directiveName.length < 1) {
          throwError(state, "directive name must not be less than one character in length");
        }
        while (ch !== 0) {
          while (isWhiteSpace(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          if (ch === 35) {
            do {
              ch = state.input.charCodeAt(++state.position);
            } while (ch !== 0 && !isEol(ch));
            break;
          }
          if (isEol(ch)) break;
          _position = state.position;
          while (ch !== 0 && !isWsOrEol(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          directiveArgs.push(state.input.slice(_position, state.position));
        }
        if (ch !== 0) readLineBreak(state);
        if (_hasOwnProperty.call(directiveHandlers, directiveName)) {
          directiveHandlers[directiveName](state, directiveName, directiveArgs);
        } else {
          throwWarning(state, 'unknown document directive "' + directiveName + '"');
        }
      }
      skipSeparationSpace(state, true, -1);
      if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
        state.position += 3;
        skipSeparationSpace(state, true, -1);
      } else if (hasDirectives) {
        throwError(state, "directives end mark is expected");
      }
      composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
      skipSeparationSpace(state, true, -1);
      if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
        throwWarning(state, "non-ASCII line breaks are interpreted as content");
      }
      state.documents.push(state.result);
      if (state.position === state.lineStart && testDocumentSeparator(state)) {
        if (state.input.charCodeAt(state.position) === 46) {
          state.position += 3;
          skipSeparationSpace(state, true, -1);
        }
        return;
      }
      if (state.position < state.length - 1) {
        throwError(state, "end of the stream or a document separator is expected");
      }
    }
    function loadDocuments(input, options) {
      input = String(input);
      options = options || {};
      if (input.length !== 0) {
        if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
          input += "\n";
        }
        if (input.charCodeAt(0) === 65279) {
          input = input.slice(1);
        }
      }
      const state = new State(input, options);
      const nullpos = input.indexOf("\0");
      if (nullpos !== -1) {
        state.position = nullpos;
        throwError(state, "null byte is not allowed in input");
      }
      state.input += "\0";
      while (state.input.charCodeAt(state.position) === 32) {
        state.lineIndent += 1;
        state.position += 1;
      }
      while (state.position < state.length - 1) {
        readDocument(state);
      }
      return state.documents;
    }
    function loadAll(input, iterator, options) {
      if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
        options = iterator;
        iterator = null;
      }
      const documents = loadDocuments(input, options);
      if (typeof iterator !== "function") {
        return documents;
      }
      for (let index = 0, length = documents.length; index < length; index += 1) {
        iterator(documents[index]);
      }
    }
    function load(input, options) {
      const documents = loadDocuments(input, options);
      if (documents.length === 0) {
        return void 0;
      } else if (documents.length === 1) {
        return documents[0];
      }
      throw new YAMLException("expected a single document in the stream, but found more");
    }
    module2.exports.loadAll = loadAll;
    module2.exports.load = load;
  }
});

// node_modules/js-yaml/lib/dumper.js
var require_dumper = __commonJS({
  "node_modules/js-yaml/lib/dumper.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var YAMLException = require_exception();
    var DEFAULT_SCHEMA = require_default();
    var _toString = Object.prototype.toString;
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var CHAR_BOM = 65279;
    var CHAR_TAB = 9;
    var CHAR_LINE_FEED = 10;
    var CHAR_CARRIAGE_RETURN = 13;
    var CHAR_SPACE = 32;
    var CHAR_EXCLAMATION = 33;
    var CHAR_DOUBLE_QUOTE = 34;
    var CHAR_SHARP = 35;
    var CHAR_PERCENT = 37;
    var CHAR_AMPERSAND = 38;
    var CHAR_SINGLE_QUOTE = 39;
    var CHAR_ASTERISK = 42;
    var CHAR_COMMA = 44;
    var CHAR_MINUS = 45;
    var CHAR_COLON = 58;
    var CHAR_EQUALS = 61;
    var CHAR_GREATER_THAN = 62;
    var CHAR_QUESTION = 63;
    var CHAR_COMMERCIAL_AT = 64;
    var CHAR_LEFT_SQUARE_BRACKET = 91;
    var CHAR_RIGHT_SQUARE_BRACKET = 93;
    var CHAR_GRAVE_ACCENT = 96;
    var CHAR_LEFT_CURLY_BRACKET = 123;
    var CHAR_VERTICAL_LINE = 124;
    var CHAR_RIGHT_CURLY_BRACKET = 125;
    var ESCAPE_SEQUENCES = {};
    ESCAPE_SEQUENCES[0] = "\\0";
    ESCAPE_SEQUENCES[7] = "\\a";
    ESCAPE_SEQUENCES[8] = "\\b";
    ESCAPE_SEQUENCES[9] = "\\t";
    ESCAPE_SEQUENCES[10] = "\\n";
    ESCAPE_SEQUENCES[11] = "\\v";
    ESCAPE_SEQUENCES[12] = "\\f";
    ESCAPE_SEQUENCES[13] = "\\r";
    ESCAPE_SEQUENCES[27] = "\\e";
    ESCAPE_SEQUENCES[34] = '\\"';
    ESCAPE_SEQUENCES[92] = "\\\\";
    ESCAPE_SEQUENCES[133] = "\\N";
    ESCAPE_SEQUENCES[160] = "\\_";
    ESCAPE_SEQUENCES[8232] = "\\L";
    ESCAPE_SEQUENCES[8233] = "\\P";
    var DEPRECATED_BOOLEANS_SYNTAX = [
      "y",
      "Y",
      "yes",
      "Yes",
      "YES",
      "on",
      "On",
      "ON",
      "n",
      "N",
      "no",
      "No",
      "NO",
      "off",
      "Off",
      "OFF"
    ];
    var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
    function compileStyleMap(schema, map) {
      if (map === null) return {};
      const result = {};
      const keys = Object.keys(map);
      for (let index = 0, length = keys.length; index < length; index += 1) {
        let tag = keys[index];
        let style = String(map[tag]);
        if (tag.slice(0, 2) === "!!") {
          tag = "tag:yaml.org,2002:" + tag.slice(2);
        }
        const type = schema.compiledTypeMap["fallback"][tag];
        if (type && _hasOwnProperty.call(type.styleAliases, style)) {
          style = type.styleAliases[style];
        }
        result[tag] = style;
      }
      return result;
    }
    function encodeHex(character) {
      let handle;
      let length;
      const string = character.toString(16).toUpperCase();
      if (character <= 255) {
        handle = "x";
        length = 2;
      } else if (character <= 65535) {
        handle = "u";
        length = 4;
      } else if (character <= 4294967295) {
        handle = "U";
        length = 8;
      } else {
        throw new YAMLException("code point within a string may not be greater than 0xFFFFFFFF");
      }
      return "\\" + handle + common.repeat("0", length - string.length) + string;
    }
    var QUOTING_TYPE_SINGLE = 1;
    var QUOTING_TYPE_DOUBLE = 2;
    function State(options) {
      this.schema = options["schema"] || DEFAULT_SCHEMA;
      this.indent = Math.max(1, options["indent"] || 2);
      this.noArrayIndent = options["noArrayIndent"] || false;
      this.skipInvalid = options["skipInvalid"] || false;
      this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
      this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
      this.sortKeys = options["sortKeys"] || false;
      this.lineWidth = options["lineWidth"] || 80;
      this.noRefs = options["noRefs"] || false;
      this.noCompatMode = options["noCompatMode"] || false;
      this.condenseFlow = options["condenseFlow"] || false;
      this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
      this.forceQuotes = options["forceQuotes"] || false;
      this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
      this.implicitTypes = this.schema.compiledImplicit;
      this.explicitTypes = this.schema.compiledExplicit;
      this.tag = null;
      this.result = "";
      this.duplicates = [];
      this.usedDuplicates = null;
    }
    function indentString(string, spaces) {
      const ind = common.repeat(" ", spaces);
      let position = 0;
      let result = "";
      const length = string.length;
      while (position < length) {
        let line;
        const next = string.indexOf("\n", position);
        if (next === -1) {
          line = string.slice(position);
          position = length;
        } else {
          line = string.slice(position, next + 1);
          position = next + 1;
        }
        if (line.length && line !== "\n") result += ind;
        result += line;
      }
      return result;
    }
    function generateNextLine(state, level) {
      return "\n" + common.repeat(" ", state.indent * level);
    }
    function testImplicitResolving(state, str) {
      for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) {
        const type = state.implicitTypes[index];
        if (type.resolve(str)) {
          return true;
        }
      }
      return false;
    }
    function isWhitespace(c) {
      return c === CHAR_SPACE || c === CHAR_TAB;
    }
    function isPrintable(c) {
      return c >= 32 && c <= 126 || c >= 161 && c <= 55295 && c !== 8232 && c !== 8233 || c >= 57344 && c <= 65533 && c !== CHAR_BOM || c >= 65536 && c <= 1114111;
    }
    function isNsCharOrWhitespace(c) {
      return isPrintable(c) && c !== CHAR_BOM && // - b-char
      c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
    }
    function isPlainSafe(c, prev, inblock) {
      const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
      const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
      return (
        // ns-plain-safe
        (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && // - c-flow-indicator
        c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && // ns-plain-char
        c !== CHAR_SHARP && // false on '#'
        !(prev === CHAR_COLON && !cIsNsChar) || // false on ': '
        isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || // change to true on '[^ ]#'
        prev === CHAR_COLON && cIsNsChar
      );
    }
    function isPlainSafeFirst(c) {
      return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && // - s-white
      // - (c-indicator ::=
      // “-” | “?” | “:” | “,” | “[” | “]” | “{” | “}”
      c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && // | “#” | “&” | “*” | “!” | “|” | “=” | “>” | “'” | “"”
      c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && // | “%” | “@” | “`”)
      c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
    }
    function isPlainSafeLast(c) {
      return !isWhitespace(c) && c !== CHAR_COLON;
    }
    function codePointAt(string, pos) {
      const first = string.charCodeAt(pos);
      let second;
      if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
        second = string.charCodeAt(pos + 1);
        if (second >= 56320 && second <= 57343) {
          return (first - 55296) * 1024 + second - 56320 + 65536;
        }
      }
      return first;
    }
    function needIndentIndicator(string) {
      const leadingSpaceRe = /^\n* /;
      return leadingSpaceRe.test(string);
    }
    var STYLE_PLAIN = 1;
    var STYLE_SINGLE = 2;
    var STYLE_LITERAL = 3;
    var STYLE_FOLDED = 4;
    var STYLE_DOUBLE = 5;
    function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
      let i;
      let char = 0;
      let prevChar = null;
      let hasLineBreak = false;
      let hasFoldableLine = false;
      const shouldTrackWidth = lineWidth !== -1;
      let previousLineBreak = -1;
      let plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
      if (singleLineOnly || forceQuotes) {
        for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
          char = codePointAt(string, i);
          if (!isPrintable(char)) {
            return STYLE_DOUBLE;
          }
          plain = plain && isPlainSafe(char, prevChar, inblock);
          prevChar = char;
        }
      } else {
        for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
          char = codePointAt(string, i);
          if (char === CHAR_LINE_FEED) {
            hasLineBreak = true;
            if (shouldTrackWidth) {
              hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
              i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
              previousLineBreak = i;
            }
          } else if (!isPrintable(char)) {
            return STYLE_DOUBLE;
          }
          plain = plain && isPlainSafe(char, prevChar, inblock);
          prevChar = char;
        }
        hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
      }
      if (!hasLineBreak && !hasFoldableLine) {
        if (plain && !forceQuotes && !testAmbiguousType(string)) {
          return STYLE_PLAIN;
        }
        return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
      }
      if (indentPerLevel > 9 && needIndentIndicator(string)) {
        return STYLE_DOUBLE;
      }
      if (!forceQuotes) {
        return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
      }
      return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
    }
    function writeScalar(state, string, level, iskey, inblock) {
      state.dump = (function() {
        if (string.length === 0) {
          return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
        }
        if (!state.noCompatMode) {
          if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
            return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
          }
        }
        const indent = state.indent * Math.max(1, level);
        const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
        const singleLineOnly = iskey || // No block styles in flow mode.
        state.flowLevel > -1 && level >= state.flowLevel;
        function testAmbiguity(string2) {
          return testImplicitResolving(state, string2);
        }
        switch (chooseScalarStyle(
          string,
          singleLineOnly,
          state.indent,
          lineWidth,
          testAmbiguity,
          state.quotingType,
          state.forceQuotes && !iskey,
          inblock
        )) {
          case STYLE_PLAIN:
            return string;
          case STYLE_SINGLE:
            return "'" + string.replace(/'/g, "''") + "'";
          case STYLE_LITERAL:
            return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
          case STYLE_FOLDED:
            return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
          case STYLE_DOUBLE:
            return '"' + escapeString(string, lineWidth) + '"';
          default:
            throw new YAMLException("impossible error: invalid scalar style");
        }
      })();
    }
    function blockHeader(string, indentPerLevel) {
      const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
      const clip = string[string.length - 1] === "\n";
      const keep = clip && (string[string.length - 2] === "\n" || string === "\n");
      const chomp = keep ? "+" : clip ? "" : "-";
      return indentIndicator + chomp + "\n";
    }
    function dropEndingNewline(string) {
      return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
    }
    function foldString(string, width) {
      const lineRe = /(\n+)([^\n]*)/g;
      let result = (function() {
        let nextLF = string.indexOf("\n");
        nextLF = nextLF !== -1 ? nextLF : string.length;
        lineRe.lastIndex = nextLF;
        return foldLine(string.slice(0, nextLF), width);
      })();
      let prevMoreIndented = string[0] === "\n" || string[0] === " ";
      let moreIndented;
      let match;
      while (match = lineRe.exec(string)) {
        const prefix = match[1];
        const line = match[2];
        moreIndented = line[0] === " ";
        result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
        prevMoreIndented = moreIndented;
      }
      return result;
    }
    function foldLine(line, width) {
      if (line === "" || line[0] === " ") return line;
      const breakRe = / [^ ]/g;
      let match;
      let start = 0;
      let end;
      let curr = 0;
      let next = 0;
      let result = "";
      while (match = breakRe.exec(line)) {
        next = match.index;
        if (next - start > width) {
          end = curr > start ? curr : next;
          result += "\n" + line.slice(start, end);
          start = end + 1;
        }
        curr = next;
      }
      result += "\n";
      if (line.length - start > width && curr > start) {
        result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
      } else {
        result += line.slice(start);
      }
      return result.slice(1);
    }
    function escapeString(string) {
      let result = "";
      let char = 0;
      for (let i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        const escapeSeq = ESCAPE_SEQUENCES[char];
        if (!escapeSeq && isPrintable(char)) {
          result += string[i];
          if (char >= 65536) result += string[i + 1];
        } else {
          result += escapeSeq || encodeHex(char);
        }
      }
      return result;
    }
    function writeFlowSequence(state, level, object) {
      let _result = "";
      const _tag = state.tag;
      for (let index = 0, length = object.length; index < length; index += 1) {
        let value = object[index];
        if (state.replacer) {
          value = state.replacer.call(object, String(index), value);
        }
        if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
          if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
          _result += state.dump;
        }
      }
      state.tag = _tag;
      state.dump = "[" + _result + "]";
    }
    function writeBlockSequence(state, level, object, compact) {
      let _result = "";
      const _tag = state.tag;
      for (let index = 0, length = object.length; index < length; index += 1) {
        let value = object[index];
        if (state.replacer) {
          value = state.replacer.call(object, String(index), value);
        }
        if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
          if (!compact || _result !== "") {
            _result += generateNextLine(state, level);
          }
          if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
            _result += "-";
          } else {
            _result += "- ";
          }
          _result += state.dump;
        }
      }
      state.tag = _tag;
      state.dump = _result || "[]";
    }
    function writeFlowMapping(state, level, object) {
      let _result = "";
      const _tag = state.tag;
      const objectKeyList = Object.keys(object);
      for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
        let pairBuffer = "";
        if (_result !== "") pairBuffer += ", ";
        if (state.condenseFlow) pairBuffer += '"';
        const objectKey = objectKeyList[index];
        let objectValue = object[objectKey];
        if (state.replacer) {
          objectValue = state.replacer.call(object, objectKey, objectValue);
        }
        if (!writeNode(state, level, objectKey, false, false)) {
          continue;
        }
        if (state.dump.length > 1024) pairBuffer += "? ";
        pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
        if (!writeNode(state, level, objectValue, false, false)) {
          continue;
        }
        pairBuffer += state.dump;
        _result += pairBuffer;
      }
      state.tag = _tag;
      state.dump = "{" + _result + "}";
    }
    function writeBlockMapping(state, level, object, compact) {
      let _result = "";
      const _tag = state.tag;
      const objectKeyList = Object.keys(object);
      if (state.sortKeys === true) {
        objectKeyList.sort();
      } else if (typeof state.sortKeys === "function") {
        objectKeyList.sort(state.sortKeys);
      } else if (state.sortKeys) {
        throw new YAMLException("sortKeys must be a boolean or a function");
      }
      for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
        let pairBuffer = "";
        if (!compact || _result !== "") {
          pairBuffer += generateNextLine(state, level);
        }
        const objectKey = objectKeyList[index];
        let objectValue = object[objectKey];
        if (state.replacer) {
          objectValue = state.replacer.call(object, objectKey, objectValue);
        }
        if (!writeNode(state, level + 1, objectKey, true, true, true)) {
          continue;
        }
        const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
        if (explicitPair) {
          if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
            pairBuffer += "?";
          } else {
            pairBuffer += "? ";
          }
        }
        pairBuffer += state.dump;
        if (explicitPair) {
          pairBuffer += generateNextLine(state, level);
        }
        if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
          continue;
        }
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          pairBuffer += ":";
        } else {
          pairBuffer += ": ";
        }
        pairBuffer += state.dump;
        _result += pairBuffer;
      }
      state.tag = _tag;
      state.dump = _result || "{}";
    }
    function detectType(state, object, explicit) {
      const typeList = explicit ? state.explicitTypes : state.implicitTypes;
      for (let index = 0, length = typeList.length; index < length; index += 1) {
        const type = typeList[index];
        if ((type.instanceOf || type.predicate) && (!type.instanceOf || typeof object === "object" && object instanceof type.instanceOf) && (!type.predicate || type.predicate(object))) {
          if (explicit) {
            if (type.multi && type.representName) {
              state.tag = type.representName(object);
            } else {
              state.tag = type.tag;
            }
          } else {
            state.tag = "?";
          }
          if (type.represent) {
            const style = state.styleMap[type.tag] || type.defaultStyle;
            let _result;
            if (_toString.call(type.represent) === "[object Function]") {
              _result = type.represent(object, style);
            } else if (_hasOwnProperty.call(type.represent, style)) {
              _result = type.represent[style](object, style);
            } else {
              throw new YAMLException("!<" + type.tag + '> tag resolver accepts not "' + style + '" style');
            }
            state.dump = _result;
          }
          return true;
        }
      }
      return false;
    }
    function writeNode(state, level, object, block, compact, iskey, isblockseq) {
      state.tag = null;
      state.dump = object;
      if (!detectType(state, object, false)) {
        detectType(state, object, true);
      }
      const type = _toString.call(state.dump);
      const inblock = block;
      if (block) {
        block = state.flowLevel < 0 || state.flowLevel > level;
      }
      const objectOrArray = type === "[object Object]" || type === "[object Array]";
      let duplicateIndex;
      let duplicate;
      if (objectOrArray) {
        duplicateIndex = state.duplicates.indexOf(object);
        duplicate = duplicateIndex !== -1;
      }
      if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
        compact = false;
      }
      if (duplicate && state.usedDuplicates[duplicateIndex]) {
        state.dump = "*ref_" + duplicateIndex;
      } else {
        if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
          state.usedDuplicates[duplicateIndex] = true;
        }
        if (type === "[object Object]") {
          if (block && Object.keys(state.dump).length !== 0) {
            writeBlockMapping(state, level, state.dump, compact);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + state.dump;
            }
          } else {
            writeFlowMapping(state, level, state.dump);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + " " + state.dump;
            }
          }
        } else if (type === "[object Array]") {
          if (block && state.dump.length !== 0) {
            if (state.noArrayIndent && !isblockseq && level > 0) {
              writeBlockSequence(state, level - 1, state.dump, compact);
            } else {
              writeBlockSequence(state, level, state.dump, compact);
            }
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + state.dump;
            }
          } else {
            writeFlowSequence(state, level, state.dump);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + " " + state.dump;
            }
          }
        } else if (type === "[object String]") {
          if (state.tag !== "?") {
            writeScalar(state, state.dump, level, iskey, inblock);
          }
        } else if (type === "[object Undefined]") {
          return false;
        } else {
          if (state.skipInvalid) return false;
          throw new YAMLException("unacceptable kind of an object to dump " + type);
        }
        if (state.tag !== null && state.tag !== "?") {
          let tagStr = encodeURI(
            state.tag[0] === "!" ? state.tag.slice(1) : state.tag
          ).replace(/!/g, "%21");
          if (state.tag[0] === "!") {
            tagStr = "!" + tagStr;
          } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
            tagStr = "!!" + tagStr.slice(18);
          } else {
            tagStr = "!<" + tagStr + ">";
          }
          state.dump = tagStr + " " + state.dump;
        }
      }
      return true;
    }
    function getDuplicateReferences(object, state) {
      const objects = [];
      const duplicatesIndexes = [];
      inspectNode(object, objects, duplicatesIndexes);
      const length = duplicatesIndexes.length;
      for (let index = 0; index < length; index += 1) {
        state.duplicates.push(objects[duplicatesIndexes[index]]);
      }
      state.usedDuplicates = new Array(length);
    }
    function inspectNode(object, objects, duplicatesIndexes) {
      if (object !== null && typeof object === "object") {
        const index = objects.indexOf(object);
        if (index !== -1) {
          if (duplicatesIndexes.indexOf(index) === -1) {
            duplicatesIndexes.push(index);
          }
        } else {
          objects.push(object);
          if (Array.isArray(object)) {
            for (let i = 0, length = object.length; i < length; i += 1) {
              inspectNode(object[i], objects, duplicatesIndexes);
            }
          } else {
            const objectKeyList = Object.keys(object);
            for (let i = 0, length = objectKeyList.length; i < length; i += 1) {
              inspectNode(object[objectKeyList[i]], objects, duplicatesIndexes);
            }
          }
        }
      }
    }
    function dump(input, options) {
      options = options || {};
      const state = new State(options);
      if (!state.noRefs) getDuplicateReferences(input, state);
      let value = input;
      if (state.replacer) {
        value = state.replacer.call({ "": value }, "", value);
      }
      if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
      return "";
    }
    module2.exports.dump = dump;
  }
});

// node_modules/js-yaml/index.js
var require_js_yaml = __commonJS({
  "node_modules/js-yaml/index.js"(exports2, module2) {
    "use strict";
    var loader = require_loader();
    var dumper = require_dumper();
    function renamed(from, to) {
      return function() {
        throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
      };
    }
    module2.exports.Type = require_type();
    module2.exports.Schema = require_schema();
    module2.exports.FAILSAFE_SCHEMA = require_failsafe();
    module2.exports.JSON_SCHEMA = require_json();
    module2.exports.CORE_SCHEMA = require_core();
    module2.exports.DEFAULT_SCHEMA = require_default();
    module2.exports.load = loader.load;
    module2.exports.loadAll = loader.loadAll;
    module2.exports.dump = dumper.dump;
    module2.exports.YAMLException = require_exception();
    module2.exports.types = {
      binary: require_binary(),
      float: require_float(),
      map: require_map(),
      null: require_null(),
      pairs: require_pairs(),
      set: require_set(),
      timestamp: require_timestamp(),
      bool: require_bool(),
      int: require_int(),
      merge: require_merge(),
      omap: require_omap(),
      seq: require_seq(),
      str: require_str()
    };
    module2.exports.safeLoad = renamed("safeLoad", "load");
    module2.exports.safeLoadAll = renamed("safeLoadAll", "loadAll");
    module2.exports.safeDump = renamed("safeDump", "dump");
  }
});

// ../src/modules/kernel/workflows/yaml-loader.ts
function pluginLocalScriptsRoots() {
  return [
    // Source/runtime TS layout: src/modules/kernel/workflows -> plugin/scripts.
    path3.resolve(__dirname, "..", "..", "..", "..", "scripts"),
    // Bundled hook layout: hooks/dist -> plugin/scripts.
    path3.resolve(__dirname, "..", "..", "scripts"),
    // Bundled agent-team hook layout: hooks/agent-team/dist -> plugin/scripts.
    path3.resolve(__dirname, "..", "..", "..", "scripts")
  ];
}
function tryScriptsRoot(scriptsRoot) {
  try {
    return require(require.resolve("js-yaml", { paths: [scriptsRoot] }));
  } catch {
    return null;
  }
}
function loadYamlApi() {
  const tried = [];
  for (const scriptsRoot of pluginLocalScriptsRoots()) {
    tried.push(scriptsRoot);
    const api2 = tryScriptsRoot(scriptsRoot);
    if (api2) return api2;
  }
  try {
    return require_js_yaml();
  } catch {
  }
  const cwdRoot = path3.resolve(process.cwd(), "scripts");
  tried.push(cwdRoot);
  const api = tryScriptsRoot(cwdRoot);
  if (api) return api;
  throw new Error(
    `Guild needs the js-yaml package and could not resolve it. Fix: npm install --prefix <plugin-root>/scripts (roots tried: ${tried.join(", ")})`
  );
}
var path3;
var init_yaml_loader = __esm({
  "../src/modules/kernel/workflows/yaml-loader.ts"() {
    path3 = __toESM(require("node:path"));
  }
});

// ../src/modules/kernel/workflows/identifier-tokenize.ts
var init_identifier_tokenize = __esm({
  "../src/modules/kernel/workflows/identifier-tokenize.ts"() {
  }
});

// ../src/modules/kernel/workflows/sealed-collections.ts
function regExpWritesLastIndex(re) {
  return re.global || re.sticky;
}
function freezeRegExpSafely(re) {
  if (regExpWritesLastIndex(re)) return false;
  Object.freeze(re);
  return true;
}
function refuseMutator(label, method) {
  return () => {
    throw new TypeError(
      `${label} is a sealed collection: ${method}() would silently change a closed vocabulary`
    );
  };
}
function sealSet(values, label = "this Set") {
  const inner = new Set(values);
  const facade = {
    [SEALED_BRAND]: "set",
    // A data property, not a getter: `inner` is unreachable from outside these closures,
    // so the size is constant for the life of the value.
    size: inner.size,
    has: (value) => inner.has(value),
    keys: () => inner.keys(),
    values: () => inner.values(),
    entries: () => inner.entries(),
    forEach: (callback, thisArg) => {
      inner.forEach((value, value2) => callback.call(thisArg, value, value2, facade));
    },
    [Symbol.iterator]: () => inner[Symbol.iterator](),
    add: refuseMutator(label, "add"),
    delete: refuseMutator(label, "delete"),
    clear: refuseMutator(label, "clear")
  };
  return Object.freeze(facade);
}
function isSealedCollection(value) {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Set || value instanceof Map) return false;
  const brand = value[SEALED_BRAND];
  return (brand === "set" || brand === "map") && Object.isFrozen(value);
}
function sealedCollectionValues(value) {
  if (!isSealedCollection(value)) return void 0;
  return [...value];
}
function deepFreeze(value, options = {}) {
  const policy = options.regexps ?? "safe";
  const seen = /* @__PURE__ */ new WeakSet();
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    const obj = node;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (obj instanceof RegExp) {
      if (policy === "freeze") Object.freeze(obj);
      else if (policy === "safe") freezeRegExpSafely(obj);
      return;
    }
    if (obj instanceof Date) {
      return;
    }
    if (obj instanceof Set || obj instanceof Map) {
      throw new TypeError(
        "deepFreeze: refusing to 'freeze' a Set/Map \u2014 freeze does not close membership and the intrinsics reach past neutered own methods. Declare it with sealSet()/sealMap()."
      );
    }
    const sealedValues = sealedCollectionValues(obj);
    if (sealedValues !== void 0) {
      for (const entry of sealedValues) walk(entry);
      return;
    }
    Object.freeze(obj);
    for (const key of Reflect.ownKeys(obj)) {
      const descriptor = Object.getOwnPropertyDescriptor(obj, key);
      if (!descriptor || !("value" in descriptor)) continue;
      walk(descriptor.value);
    }
  };
  walk(value);
  return value;
}
var SEALED_BRAND;
var init_sealed_collections = __esm({
  "../src/modules/kernel/workflows/sealed-collections.ts"() {
    SEALED_BRAND = /* @__PURE__ */ Symbol.for("guild.sealed_collection.v1");
  }
});

// ../src/modules/kernel/workflows/path-containment.ts
var CONTAINMENT_REFUSAL_CODES;
var init_path_containment = __esm({
  "../src/modules/kernel/workflows/path-containment.ts"() {
    CONTAINMENT_REFUSAL_CODES = Object.freeze([
      "root-unresolvable",
      "no-existing-ancestor",
      "dangling-symlink",
      "physical-symlink",
      "outside-root",
      "leaf-not-regular-file",
      "mkdir-failed",
      "parent-traversal",
      "destination-moved"
    ]);
  }
});

// ../src/modules/kernel/index.ts
var init_kernel = __esm({
  "../src/modules/kernel/index.ts"() {
    init_module_manifest();
    init_yaml_loader();
    init_identifier_tokenize();
    init_sealed_collections();
    init_path_containment();
  }
});

// ../src/modules/host-runtime/workflows/host-capabilities-schema.ts
var UPDATE_COMMANDS, INJECTION_SUPPORT, INJECTION_SUPPORT_SET, CLAUDE_CAPABILITIES, CODEX_CAPABILITIES, NO_HOOKS, AGENTS_FILE_CAPABILITIES, REQUIRED_HOOK_EVENTS;
var init_host_capabilities_schema = __esm({
  "../src/modules/host-runtime/workflows/host-capabilities-schema.ts"() {
    UPDATE_COMMANDS = {
      marketplace_cli: "claude plugin marketplace update guild && claude plugin update guild@guild",
      self_update: "guild-run update",
      reinstall_command: "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update"
    };
    INJECTION_SUPPORT = Object.freeze(["verified", "target", "absent"]);
    INJECTION_SUPPORT_SET = new Set(INJECTION_SUPPORT);
    CLAUDE_CAPABILITIES = {
      schema_version: "guild.host_capabilities.v1",
      host_kind: "claude",
      family: "claude",
      surface_kind: "cli",
      package: {
        installable: true,
        installability: "verified",
        manifest_format: "claude-plugin",
        update: { check: "marketplace_clone", apply: "marketplace_cli", command: UPDATE_COMMANDS.marketplace_cli, auto_capable: true }
      },
      bootstrap: {
        context_injection: "hookSpecificOutput.additionalContext",
        skill_autoload: true,
        prompt_transform: false,
        wrapper_injection: true
      },
      commands: { slash_commands: true, command_files: "markdown" },
      skills: { native_skills: true, skill_dir: ".claude/skills" },
      agents: { native_agents: true, agent_format: "claude-md" },
      injection: {
        // No injection probe has EVER run on any host — the capability is unbuilt (S7
        // landed the transport half only). A dispatch surface exists, so "target".
        definition_injection: false,
        definition_injection_support: "target",
        skill_bundle_injection: false,
        skill_bundle_injection_support: "target",
        dynamic_registration: false,
        dynamic_registration_support: "target",
        fallback: "prompt_text",
        definition_injection_verified_by: null,
        skill_bundle_injection_verified_by: null,
        dynamic_registration_verified_by: null
      },
      hooks: {
        // All ten events are bound in the live hooks/hooks.json (verified).
        session_start: true,
        user_prompt_submit: true,
        pre_tool_use: true,
        post_tool_use: true,
        stop: true,
        pre_compact: true,
        subagent_stop: true,
        task_created: true,
        task_completed: true,
        teammate_idle: true
      },
      permissions: {
        deny: true,
        ask: true,
        ask_mode: "pre_tool_use",
        accept_edits_without_prompt: true,
        auto_approve_tools: true,
        bypass_prompts: true,
        bypass_sandbox: false,
        permission_prompt_layer: true,
        launch_modes: {
          read_only: ["--tools", "Read,Grep,Glob"],
          ask: ["--permission-mode", "default"],
          accept_edits: ["--permission-mode", "acceptEdits"],
          auto: ["--permission-mode", "auto"],
          bypass_all: ["--permission-mode", "bypassPermissions"]
        }
      },
      dispatch: {
        tmux_processes: true,
        plain_processes: true,
        independent_agents: true,
        subagents: true,
        inline: true
      },
      interaction: {
        native_questions: true,
        terminal_prompt: true,
        file_bus_questions: true
      },
      sessions: { continue: true, resume_by_id: true, fork: true },
      structured_output: {
        native_json: true,
        schema_validation: true,
        repair_prompt: true
      },
      artifacts: { direct_filesystem: true, file_bus: true, app_upload: false },
      tools: {
        read: "native",
        search: "native",
        shell: "native",
        edit: "native",
        write: "native",
        browser: "bridge",
        web: "native",
        mcp: "native"
      },
      mcp: { stdio: true, http: false },
      models: {
        cheap: { model: "haiku" },
        mid: { model: "sonnet" },
        powerful: { model: "opus" }
      }
    };
    CODEX_CAPABILITIES = {
      schema_version: "guild.host_capabilities.v1",
      host_kind: "codex",
      family: "codex",
      surface_kind: "cli",
      // installable:false is the honest MACHINE state — the Codex renderer exists but
      // per-host-packaging.ts marks it DORMANT; a non-Claude render must not be treated
      // as installable until proven. installability:"target" records that the renderer
      // exists; both flip to verified/true at SC-3 (real Codex install + bootstrap).
      package: {
        installable: false,
        installability: "target",
        manifest_format: "codex-plugin",
        // NOT self_update (operator decision, initiative cross-host-release-
        // distribution, 2026-07-26). Codex OWNS the installed cache: `codex plugin
        // list` tracks the registered marketplace source, so a Guild-side staged
        // swap of the cache mutates manager state behind Codex's back and the next
        // `codex plugin add` reinstalls the old payload. A minted receipt also
        // cannot know a native install's channel, so a self-update could silently
        // re-clone the wrong ref. `install.sh --update` is coherent for BOTH
        // populations: receipted installs re-render properly; host-native installs
        // are detected and told the precise codex command for their registered
        // source type (git → marketplace upgrade + plugin add; local → reinstall).
        update: { check: "receipt", apply: "reinstall_command", command: UPDATE_COMMANDS.reinstall_command, auto_capable: false }
      },
      bootstrap: {
        // Codex has no hookSpecificOutput injection; bootstrap rides an instruction
        // file (AGENTS.md) / the generated wrapper (ADR P0: Codex "plugin-or-skill").
        context_injection: "instruction_file",
        skill_autoload: false,
        // Verified: Codex has no native skill dir (per-host-packaging flags skills unsupported).
        prompt_transform: false,
        // INFERRED
        wrapper_injection: true
        // The generated guild-run wrapper injects bootstrap.
      },
      commands: {
        // Verified: Codex has no .md slash-command format; commands render as workflow descriptors.
        slash_commands: false,
        command_files: "none"
      },
      skills: { native_skills: false, skill_dir: null },
      // Verified (per-host-packaging).
      agents: { native_agents: false, agent_format: null },
      // Verified (per-host-packaging flags agents unsupported).
      injection: {
        // No injection probe has EVER run on any host — the capability is unbuilt (S7
        // landed the transport half only). A dispatch surface exists, so "target".
        definition_injection: false,
        definition_injection_support: "target",
        skill_bundle_injection: false,
        skill_bundle_injection_support: "target",
        dynamic_registration: false,
        dynamic_registration_support: "absent",
        fallback: "prompt_text",
        definition_injection_verified_by: null,
        skill_bundle_injection_verified_by: null,
        dynamic_registration_verified_by: null
      },
      hooks: {
        // CORRECTED (wi-04 close-out, 2026-07-26): the old "no native
        // Claude-equivalent hooks" claim was empirically false. Codex accepts a
        // Claude-shaped hooks manifest and fires both events the generated
        // codex-hooks.json registers — UserPromptSubmit has carried the prompt
        // bridge since the package existed, and SessionStart now carries the
        // update-check signal, LIVE-VERIFIED in a real codex session (the model
        // quoted the injected line verbatim). Remaining events stay false until
        // individually verified.
        session_start: true,
        user_prompt_submit: true,
        // CONFIRMED ON-BOX (issue #94, codex-cli 0.146.0, isolated CODEX_HOME).
        // A PreToolUse hook emitting the Claude-shaped
        // {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"}}
        // BLOCKS the tool call:
        //     hook: PreToolUse Blocked
        //     ERROR codex_core::tools::router: error=Command blocked by PreToolUse hook: …
        // and the model stops. CONTROL (same config, non-matching command) reached
        // `hook: PreToolUse Completed` and executed — so the deny, not the sandbox,
        // is causal. This retires the old INFERRED `false` (never verified).
        //
        // CAVEAT THAT DOES NOT BELONG IN THIS BOOLEAN, but governs how it may be
        // consumed: codex gates hooks behind PERSISTED HOOK TRUST. With the same
        // hooks.json but no trust, the hook SILENTLY never runs (no warning, tool
        // executes). So "codex supports PreToolUse deny" (this row) must never be
        // read as "enforcement is live on this box" — that needs a probe of actual
        // execution (probeCodexPreToolUseEnforcement, scripts/lib/pane-adapter.ts),
        // which is what the codex-pane bypass flag is gated on.
        pre_tool_use: true,
        post_tool_use: false,
        stop: false,
        pre_compact: false,
        subagent_stop: false,
        task_created: false,
        task_completed: false,
        teammate_idle: false
      },
      permissions: {
        // `deny` CONFIRMED ON-BOX (issue #94) — see hooks.pre_tool_use above: a
        // PreToolUse hook decision of "deny" is honoured and blocks the call.
        deny: true,
        ask: true,
        // Codex prompts for approval by default.
        // STILL NULL, DELIBERATELY. Codex has a PreToolUse DENY layer but no
        // PreToolUse ASK primitive (`permissionDecision:"ask"` is not an accepted
        // codex decision). Guild's own enforcement already handles this: the
        // manifest written by write-host-capability.ts carries
        // `tool_support.pre_tool_use_ask: false` for every non-Claude-CLI host, and
        // hooks/pre-tool-use.ts's HK-07 gate degrades ask -> file-bus
        // approval_request + `deny`. VERIFIED end-to-end for codex in issue #94.
        // Flipping this to "pre_tool_use" would re-enable an ask codex rejects.
        ask_mode: null,
        accept_edits_without_prompt: false,
        // INFERRED
        auto_approve_tools: false,
        // INFERRED
        bypass_prompts: true,
        // Codex YOLO / --dangerously-bypass exists (AC19).
        bypass_sandbox: true,
        // INFERRED — YOLO bypasses the sandbox.
        permission_prompt_layer: false,
        // INFERRED
        launch_modes: {
          // INFERRED — only bypass_all has a well-known Codex flag today. ask/auto/
          // accept_edits/read_only recipes are confirmed at L3; OMITTED here rather
          // than guessed, so their absence reads as "degrade/record", not "supported".
          // CONFIRMED ON-BOX (issue #94, codex-cli 0.146.0): the flag exists and
          // takes effect. Note what it does NOT do — a PreToolUse hook deny still
          // blocked the tool call under this flag, so the bypass suppresses codex's
          // own approval/sandbox layer and leaves Guild's gate intact.
          bypass_all: ["--dangerously-bypass-approvals-and-sandbox"]
        }
      },
      dispatch: {
        tmux_processes: true,
        // Codex is a CLI process — tmux panes work.
        plain_processes: true,
        independent_agents: false,
        // INFERRED — no native agent-team primitive.
        subagents: false,
        // INFERRED
        inline: true
      },
      interaction: {
        native_questions: false,
        // INFERRED — no AskUserQuestion equivalent; use terminal/file-bus.
        terminal_prompt: true,
        file_bus_questions: true
        // Guild file-bus approval works on any FS host.
      },
      sessions: {
        continue: true,
        // INFERRED — Codex has session continuation.
        resume_by_id: true,
        // INFERRED
        fork: false
        // INFERRED
      },
      structured_output: {
        native_json: false,
        // INFERRED — no guaranteed native JSON mode; use fenced-block + repair.
        schema_validation: false,
        // Guild-side validation (validateHandoffV2) instead.
        repair_prompt: true
        // Bounded repair prompt is the fallback (ADR §Result contracts).
      },
      artifacts: { direct_filesystem: true, file_bus: true, app_upload: false },
      tools: {
        read: "native",
        search: "native",
        shell: "native",
        edit: "native",
        write: "native",
        browser: "none",
        // INFERRED — no native browser; record fallback (AC29).
        web: "emulated",
        // INFERRED
        mcp: "native"
        // Codex supports stdio MCP.
      },
      mcp: { stdio: true, http: false },
      // Verified: Codex supports stdio MCP only (per-host-packaging flags HTTP unsupported).
      models: {
        // Codex model ids are host-specific and not pinned in this repo yet; null =
        // "no Guild-mapped model at this tier" (settings models.tiers.codex is null today).
        cheap: { model: null },
        mid: { model: null },
        powerful: { model: null }
      }
    };
    NO_HOOKS = {
      session_start: false,
      user_prompt_submit: false,
      pre_tool_use: false,
      post_tool_use: false,
      stop: false,
      pre_compact: false,
      subagent_stop: false,
      task_created: false,
      task_completed: false,
      teammate_idle: false
    };
    AGENTS_FILE_CAPABILITIES = {
      schema_version: "guild.host_capabilities.v1",
      host_kind: "agents-file",
      family: "agents",
      surface_kind: "file",
      package: {
        installable: false,
        installability: "target",
        manifest_format: "agents-file",
        update: { check: "receipt", apply: "reinstall_command", command: UPDATE_COMMANDS.reinstall_command, auto_capable: false }
      },
      bootstrap: {
        context_injection: "instruction_file",
        skill_autoload: false,
        prompt_transform: false,
        wrapper_injection: true
      },
      commands: { slash_commands: false, command_files: "none" },
      skills: { native_skills: false, skill_dir: ".agents/skills/guild" },
      agents: { native_agents: false, agent_format: null },
      injection: {
        // No dispatch surface ⇒ nothing to inject INTO. Structural, not pessimistic.
        definition_injection: false,
        definition_injection_support: "absent",
        skill_bundle_injection: false,
        skill_bundle_injection_support: "absent",
        dynamic_registration: false,
        dynamic_registration_support: "absent",
        fallback: "none",
        definition_injection_verified_by: null,
        skill_bundle_injection_verified_by: null,
        dynamic_registration_verified_by: null
      },
      hooks: NO_HOOKS,
      permissions: {
        deny: false,
        ask: true,
        ask_mode: null,
        accept_edits_without_prompt: false,
        auto_approve_tools: false,
        bypass_prompts: false,
        bypass_sandbox: false,
        permission_prompt_layer: false,
        launch_modes: {}
      },
      dispatch: {
        tmux_processes: false,
        plain_processes: false,
        independent_agents: false,
        subagents: false,
        inline: false
      },
      interaction: {
        native_questions: false,
        terminal_prompt: false,
        file_bus_questions: true
      },
      sessions: { continue: false, resume_by_id: false, fork: false },
      structured_output: {
        native_json: false,
        schema_validation: false,
        repair_prompt: true
      },
      artifacts: { direct_filesystem: true, file_bus: true, app_upload: false },
      tools: {
        read: "native",
        search: "native",
        shell: "native",
        edit: "native",
        write: "native",
        browser: "none",
        web: "emulated",
        mcp: "none"
      },
      mcp: { stdio: false, http: false },
      models: {
        cheap: { model: null },
        mid: { model: null },
        powerful: { model: null }
      }
    };
    REQUIRED_HOOK_EVENTS = Object.freeze([
      "session_start",
      "user_prompt_submit",
      "pre_tool_use",
      "post_tool_use",
      "stop",
      "pre_compact",
      "subagent_stop",
      "task_created",
      "task_completed",
      "teammate_idle"
    ]);
  }
});

// ../src/modules/host-runtime/workflows/host-registry-schema.ts
function inferredCaps(host_kind, family, surface_kind = "cli", dispatch_selectable = surface_kind === "cli") {
  return {
    schema_version: "guild.host_capabilities.v1",
    host_kind,
    family,
    // Must equal the registry entry's top-level surface_kind (cross-field invariant,
    // enforced by validateHostRegistryEntry). `.agents` is a file surface, not cli.
    surface_kind,
    package: {
      installable: false,
      installability: "target",
      manifest_format: `${host_kind}-package`,
      // AC-7 by surface: cli = Guild-owned wrapper packages → guild-run
      // self-update; file = AGENTS-file packages → reinstall command (notify +
      // one command, no daemon); app = refused install surfaces → no check, no
      // apply (degrades to notify-only prose; the recorded loss IS this row).
      update: surface_kind === "cli" ? { check: "receipt", apply: "self_update", command: UPDATE_COMMANDS.self_update, auto_capable: false } : surface_kind === "file" ? { check: "receipt", apply: "reinstall_command", command: UPDATE_COMMANDS.reinstall_command, auto_capable: false } : { check: "none", apply: "none", command: null, auto_capable: false }
    },
    bootstrap: {
      context_injection: "instruction_file",
      skill_autoload: false,
      prompt_transform: false,
      wrapper_injection: true
    },
    commands: { slash_commands: false, command_files: "none" },
    skills: { native_skills: false, skill_dir: null },
    agents: { native_agents: false, agent_format: null },
    // cap-loc-D11 — injection facts derived STRUCTURALLY from the surface kind.
    // A `cli` surface has somewhere to dispatch a lane, so injection is an
    // unproven TARGET. An `app` or `file` surface has no pane to dispatch into
    // (see the AGENTS_FILE / kiro / qoder / trae rows: `dispatch_selectable:
    // false`), so there is nothing to inject INTO — `absent`, and nothing to
    // degrade to either. That is a structural fact, not pessimism.
    //
    // NO ROW STARTS `verified`: injection is unbuilt, so no probe of it has ever
    // run on any host. A row flips only on a real probe receipt (E3 / cap-loc-D12).
    injection: dispatch_selectable ? {
      definition_injection: false,
      definition_injection_support: "target",
      skill_bundle_injection: false,
      skill_bundle_injection_support: "target",
      dynamic_registration: false,
      dynamic_registration_support: "absent",
      fallback: "prompt_text",
      definition_injection_verified_by: null,
      skill_bundle_injection_verified_by: null,
      dynamic_registration_verified_by: null
    } : {
      definition_injection: false,
      definition_injection_support: "absent",
      skill_bundle_injection: false,
      skill_bundle_injection_support: "absent",
      dynamic_registration: false,
      dynamic_registration_support: "absent",
      fallback: "none",
      definition_injection_verified_by: null,
      skill_bundle_injection_verified_by: null,
      dynamic_registration_verified_by: null
    },
    hooks: {
      session_start: false,
      user_prompt_submit: false,
      pre_tool_use: false,
      post_tool_use: false,
      stop: false,
      pre_compact: false,
      subagent_stop: false,
      task_created: false,
      task_completed: false,
      teammate_idle: false
    },
    permissions: {
      deny: false,
      ask: true,
      ask_mode: null,
      accept_edits_without_prompt: false,
      auto_approve_tools: false,
      bypass_prompts: false,
      bypass_sandbox: false,
      permission_prompt_layer: false,
      launch_modes: {}
    },
    dispatch: {
      tmux_processes: true,
      plain_processes: true,
      independent_agents: false,
      subagents: false,
      inline: true
    },
    interaction: { native_questions: false, terminal_prompt: true, file_bus_questions: true },
    sessions: { continue: false, resume_by_id: false, fork: false },
    structured_output: { native_json: false, schema_validation: false, repair_prompt: true },
    artifacts: { direct_filesystem: true, file_bus: true, app_upload: false },
    tools: {
      read: "native",
      search: "native",
      shell: "native",
      edit: "native",
      write: "native",
      browser: "none",
      web: "emulated",
      mcp: "none"
    },
    mcp: { stdio: false, http: false },
    models: { cheap: { model: null }, mid: { model: null }, powerful: { model: null } }
  };
}
var HOST_IDS, HOST_FAMILIES, AUTH_PROBES, CLAUDE_ENTRY, CODEX_ENTRY, AGENTS_FILE_ENTRY, PI_ENTRY, ANTIGRAVITY_ENTRY, CLAUDE_APP_ENTRY, CLAUDE_WEB_ENTRY, CODEX_APP_ENTRY, CLAUDE_AI_CONNECTOR_ENTRY, CURSOR_ENTRY, GITHUB_COPILOT_ENTRY, OPENCODE_ENTRY, ROVO_DEV_ENTRY, KIRO_ENTRY, QODER_ENTRY, TRAE_ENTRY, HOST_REGISTRY_ROWS, HOST_ID_SET, FAMILY_SET, AUTH_PROBE_SET;
var init_host_registry_schema = __esm({
  "../src/modules/host-runtime/workflows/host-registry-schema.ts"() {
    init_kernel();
    init_host_capabilities_schema();
    HOST_IDS = Object.freeze([
      // keep CLI/file (5)
      "claude-code-cli",
      "codex-cli",
      "pi-cli",
      "antigravity-cli",
      "agents-file",
      // keep-as-refuse (4) — RETAINED verbatim
      "claude-code-app",
      "claude-code-web",
      "codex-app",
      "claude-ai-connector",
      // new CLI-with-binary (4) — verified_multi_host L0 ADR §2.1
      "cursor",
      "github-copilot",
      "opencode",
      "rovo-dev",
      // new IDE-embedded (3) — bind the universal agents-file adapter (adapter_binding: "agents-file").
      // `trae-cn` is NOT distinct — it folds into `trae` (L0 ADR §9). host id set = 16.
      "kiro",
      "qoder",
      "trae"
    ]);
    HOST_FAMILIES = Object.freeze([
      "claude",
      "codex",
      "agents",
      "pi",
      "antigravity",
      "cursor",
      "copilot",
      "opencode",
      "rovo"
    ]);
    AUTH_PROBES = Object.freeze([
      "codex_stored_or_env",
      "none",
      "cursor_stored",
      "gh_auth",
      "opencode_stored_or_env",
      "acli_stored"
    ]);
    CLAUDE_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "claude-code-cli",
      family: "claude",
      adapter_binding: "self",
      surface_kind: "cli",
      detection: { bin: "claude", requires_auth: false, auth_probe: "none" },
      installability: "native",
      result_adapter: false,
      // Claude is the reference author host, not a cross reviewer for itself.
      dispatch_selectable: true,
      capabilities: CLAUDE_CAPABILITIES,
      provenance: "verified"
    };
    CODEX_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "codex-cli",
      family: "codex",
      adapter_binding: "self",
      surface_kind: "cli",
      detection: { bin: "codex", requires_auth: true, auth_probe: "codex_stored_or_env" },
      // installability:"target" mirrors the P0 capability row (renderer exists, install unproven).
      installability: "target",
      result_adapter: true,
      // The only selectable cross reviewer today (provider-detect codex-plugin/codex-cli).
      dispatch_selectable: true,
      capabilities: CODEX_CAPABILITIES,
      provenance: "verified"
      // columns verified from plugin facts; the embedded caps row carries its own INFERRED notes.
    };
    AGENTS_FILE_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "agents-file",
      family: "agents",
      // "self": agents-file is the universal AGENTS.md adapter/renderer ITSELF (the IDE rows
      // dereference it via adapter_binding: "agents-file"; this row is the target of that binding).
      adapter_binding: "self",
      // `agents-file` is the universal AGENTS.md package target — a FILE surface, not a CLI.
      surface_kind: "file",
      detection: { bin: null, requires_auth: false, auth_probe: "none" },
      installability: "target",
      result_adapter: false,
      // INFERRED — no cross-review adapter; verify at live-host availability.
      // FLIPPED from `true` (gap-audit C-agents-file), applying the SAME G4b
      // host-reachability rule that flipped kiro/qoder/trae — see KIRO_ENTRY's comment.
      // The prior value was annotated INFERRED with the rationale "a host consuming
      // AGENTS.md can run a lane". That is a true statement about the CLASS of consuming
      // hosts, but `dispatch_selectable` is read per-ROW as "a lane can be dispatched into
      // THIS row", and under that reading it is false by construction:
      //   - `agents-file` is not a member of the `HostKind` union (host-types.ts), so no
      //     TeamBackend/pane path can name it;
      //   - the generic pane adapter requires `surface_kind:"cli"` (pane-adapter.ts), and
      //     this row is `surface_kind:"file"` — no PaneAdapter exists or can exist;
      //   - guild-run-wrapper.ts takes a `HostKind`, so it cannot wrap this row either;
      //   - decisively, THIS ROW'S OWN ADAPTER refuses: createAgentsFileAdapter().dispatch()
      //     returns `status:"degraded"`, `command:null`, "agents-file is an instruction
      //     package target, not a process launcher".
      // The G4b lane carved this row out as a documented exception rather than flipping it.
      // That carve-out is superseded here because the field has REAL per-row consumers that
      // read it as selectability: config-cli.ts builds the operator-pinnable host set from
      // `dispatch_selectable === true`, and role-model-schema.ts picks the host/advisory
      // substrate from `installability !== "none" && dispatch_selectable`. With `true` and
      // `installability:"target"`, Guild could select `agents-file` as a run's host substrate
      // and then dispatch into an adapter that returns `command: null`. A concrete
      // AGENTS.md-consuming host carries its OWN row (kiro/qoder/trae dereference this one);
      // this row is the render TARGET, never a dispatch destination.
      dispatch_selectable: false,
      capabilities: AGENTS_FILE_CAPABILITIES,
      // file surface — matches top-level surface_kind.
      provenance: "inferred"
    };
    PI_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "pi-cli",
      family: "pi",
      adapter_binding: "self",
      surface_kind: "cli",
      detection: { bin: "pi", requires_auth: false, auth_probe: "none" },
      // VERIFIED on-host 2026-06-16: `pi` 0.79.3 at /opt/homebrew/bin/pi.
      installability: "target",
      // VERIFIED-as-target: CLI present; Guild-package install into pi unproven.
      result_adapter: false,
      // VERIFIED: no Guild cross-review adapter ships for pi (detect-only, provider-detect.ts:206).
      dispatch_selectable: true,
      // VERIFIED: pi is a CLI process a lane can run on.
      capabilities: {
        ...inferredCaps("pi-cli", "pi"),
        // VERIFIED on-host (pi --help, 0.79.3):
        sessions: { continue: true, resume_by_id: true, fork: true },
        // --continue/-c, --resume/-r + --session-id, --fork
        structured_output: { native_json: true, schema_validation: false, repair_prompt: true },
        // --mode json
        permissions: {
          ...inferredCaps("pi-cli", "pi").permissions,
          // G4b: carries forward the Phase-1 hand-authored host-capabilities-schema.ts
          // PI_CAPABILITIES.permissions.deny value (a field the inferredCaps() default
          // left false) — pi's --tools allowlist lets an invocation deny specific tools,
          // so `deny:true` is the correct capability. Recorded here (not just in the
          // now-superseded PI_CAPABILITIES row) so the registry stays the single source.
          deny: true
        }
      },
      provenance: "verified"
      // 3 columns + detection live-checked; browser rung still INFERRED (adapter-fallback-ladders INFERRED_HOSTS).
    };
    ANTIGRAVITY_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "antigravity-cli",
      family: "antigravity",
      adapter_binding: "self",
      surface_kind: "cli",
      // VERIFIED on-host 2026-06-16: the CLI is `agy` 1.0.8 (~/.local/bin/agy) — NOT `antigravity`. Detection bin corrected.
      detection: { bin: "agy", requires_auth: false, auth_probe: "none" },
      installability: "target",
      // VERIFIED-as-target: CLI present; Guild-package install unproven.
      result_adapter: false,
      // VERIFIED: no Guild cross-review adapter ships for antigravity (detect-only, provider-detect.ts:207).
      dispatch_selectable: true,
      // VERIFIED: agy is a CLI process a lane can run on.
      capabilities: {
        ...inferredCaps("antigravity-cli", "antigravity"),
        // VERIFIED on-host (agy --help, 1.0.8):
        sessions: { continue: true, resume_by_id: true, fork: false },
        // --continue/-c, --conversation <id>; no fork flag
        permissions: {
          ...inferredCaps("antigravity-cli", "antigravity").permissions,
          bypass_prompts: true,
          // --dangerously-skip-permissions auto-approves all tool-permission prompts (agy also has a separate --sandbox restrict toggle)
          launch_modes: { bypass_all: ["--dangerously-skip-permissions"] },
          // G4b: carries forward two Phase-1 hand-authored host-capabilities-schema.ts
          // ANTIGRAVITY_CAPABILITIES fields the inferredCaps() default did not set —
          // `deny` (agy can refuse a tool) and `bypass_sandbox` (the same
          // --dangerously-skip-permissions flag that sets bypass_prompts above also lifts
          // the sandbox restriction agy's separate --sandbox toggle would otherwise apply).
          // Recorded here so the registry — not a second hand-authored row — is the one
          // source of truth (closes the "two diverged capability truths" audit finding).
          deny: true,
          bypass_sandbox: true
        }
      },
      provenance: "verified"
      // 3 columns + detection live-checked; browser rung still INFERRED (adapter-fallback-ladders INFERRED_HOSTS).
    };
    CLAUDE_APP_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "claude-code-app",
      family: "claude",
      adapter_binding: "self",
      surface_kind: "app",
      detection: { bin: null, requires_auth: false, auth_probe: "none" },
      installability: "none",
      result_adapter: false,
      dispatch_selectable: false,
      capabilities: inferredCaps("claude-code-app", "claude", "app"),
      provenance: "inferred"
    };
    CLAUDE_WEB_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "claude-code-web",
      family: "claude",
      adapter_binding: "self",
      surface_kind: "app",
      detection: { bin: null, requires_auth: false, auth_probe: "none" },
      installability: "none",
      result_adapter: false,
      dispatch_selectable: false,
      capabilities: inferredCaps("claude-code-web", "claude", "app"),
      provenance: "inferred"
    };
    CODEX_APP_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "codex-app",
      family: "codex",
      adapter_binding: "self",
      surface_kind: "app",
      detection: { bin: null, requires_auth: false, auth_probe: "none" },
      installability: "none",
      result_adapter: false,
      dispatch_selectable: false,
      capabilities: inferredCaps("codex-app", "codex", "app"),
      provenance: "inferred"
    };
    CLAUDE_AI_CONNECTOR_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "claude-ai-connector",
      family: "claude",
      adapter_binding: "self",
      surface_kind: "app",
      detection: { bin: null, requires_auth: false, auth_probe: "none" },
      installability: "none",
      result_adapter: false,
      dispatch_selectable: false,
      capabilities: inferredCaps("claude-ai-connector", "claude", "app"),
      provenance: "inferred"
    };
    CURSOR_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "cursor",
      family: "cursor",
      adapter_binding: "self",
      surface_kind: "cli",
      detection: { bin: "cursor-agent", requires_auth: true, auth_probe: "cursor_stored", subcommand: null, marker: null },
      installability: "target",
      result_adapter: false,
      dispatch_selectable: true,
      capabilities: inferredCaps("cursor", "cursor", "cli"),
      // STAYS inferred (issue #110): detection bin + `-p` flag shape + requires_auth
      // were live-checked 2026-07-30, but no authenticated completion has run —
      // partial verification does not flip the row.
      provenance: "inferred"
    };
    GITHUB_COPILOT_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "github-copilot",
      family: "copilot",
      adapter_binding: "self",
      surface_kind: "cli",
      // capability is a subcommand of the shared `gh` bin (`gh copilot`).
      detection: { bin: "gh", requires_auth: true, auth_probe: "gh_auth", subcommand: "copilot", marker: null },
      installability: "target",
      result_adapter: false,
      dispatch_selectable: true,
      capabilities: inferredCaps("github-copilot", "copilot", "cli"),
      // Columns + detection live-checked 2026-07-30 (issue #104/#110): `gh copilot -p`
      // real completion end to end through guild-run; per-host receipt + live
      // self-update swap. Capability RUNGS stay INFERRED (adapter-fallback-ladders
      // INFERRED_HOSTS) until all cells are live-verified.
      provenance: "verified"
    };
    OPENCODE_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "opencode",
      family: "opencode",
      adapter_binding: "self",
      surface_kind: "cli",
      detection: { bin: "opencode", requires_auth: true, auth_probe: "opencode_stored_or_env", subcommand: null, marker: null },
      installability: "target",
      result_adapter: false,
      dispatch_selectable: true,
      capabilities: inferredCaps("opencode", "opencode", "cli"),
      // Columns + detection live-checked 2026-07-30 (issue #104/#110): real completion
      // via `opencode run` (the `-p` shape was refuted and corrected, PR #109);
      // per-host receipt + live self-update swap. Capability RUNGS stay INFERRED
      // (adapter-fallback-ladders INFERRED_HOSTS) until all cells are live-verified.
      provenance: "verified"
    };
    ROVO_DEV_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "rovo-dev",
      family: "rovo",
      adapter_binding: "self",
      surface_kind: "cli",
      // capability is a subcommand of the shared `acli` bin (`acli rovodev`).
      detection: { bin: "acli", requires_auth: true, auth_probe: "acli_stored", subcommand: "rovodev", marker: null },
      installability: "target",
      result_adapter: false,
      dispatch_selectable: true,
      capabilities: inferredCaps("rovo-dev", "rovo", "cli"),
      provenance: "inferred"
    };
    KIRO_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "kiro",
      family: "agents",
      adapter_binding: "agents-file",
      surface_kind: "file",
      detection: {
        bin: null,
        requires_auth: false,
        auth_probe: "none",
        subcommand: null,
        marker: { config_dir: ".kiro", scope: "project", agents_placement: "AGENTS.md" }
      },
      installability: "target",
      result_adapter: false,
      // G4b (host-reachability audit): FLIPPED from true — an agents-file surface is a
      // FILE the host reads (root AGENTS.md), never a pane a lane can be dispatched into.
      // `dispatch_selectable:true` was a lie: no HostKind member, no PaneAdapter, no
      // legacy hand-authored HOST_CAPABILITY_ROWS row ever backed it (confirmed
      // unreachable through EVERY dispatch surface; the registry-DERIVED map now carries
      // a row per registry id, but a capability row is not a dispatch surface). The
      // honest column for a pane-less file surface is false.
      dispatch_selectable: false,
      capabilities: inferredCaps("kiro", "agents", "file"),
      provenance: "inferred"
    };
    QODER_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "qoder",
      family: "agents",
      adapter_binding: "agents-file",
      surface_kind: "file",
      detection: {
        bin: null,
        requires_auth: false,
        auth_probe: "none",
        subcommand: null,
        marker: { config_dir: ".qoder", scope: "project", agents_placement: "AGENTS.md" }
      },
      installability: "target",
      result_adapter: false,
      // G4b: FLIPPED from true (see KIRO_ENTRY comment — agents-file is a file surface,
      // never a pane; dispatch_selectable:true was unreachable-through-every-surface).
      dispatch_selectable: false,
      capabilities: inferredCaps("qoder", "agents", "file"),
      provenance: "inferred"
    };
    TRAE_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "trae",
      family: "agents",
      adapter_binding: "agents-file",
      surface_kind: "file",
      detection: {
        bin: null,
        requires_auth: false,
        auth_probe: "none",
        subcommand: null,
        marker: { config_dir: ".trae", scope: "project", agents_placement: "AGENTS.md" }
      },
      installability: "target",
      result_adapter: false,
      // G4b: FLIPPED from true (see KIRO_ENTRY comment — agents-file is a file surface,
      // never a pane; dispatch_selectable:true was unreachable-through-every-surface).
      dispatch_selectable: false,
      capabilities: inferredCaps("trae", "agents", "file"),
      provenance: "inferred"
    };
    HOST_REGISTRY_ROWS = deepFreeze({
      "claude-code-cli": CLAUDE_ENTRY,
      "codex-cli": CODEX_ENTRY,
      "pi-cli": PI_ENTRY,
      "antigravity-cli": ANTIGRAVITY_ENTRY,
      "agents-file": AGENTS_FILE_ENTRY,
      "claude-code-app": CLAUDE_APP_ENTRY,
      "claude-code-web": CLAUDE_WEB_ENTRY,
      "codex-app": CODEX_APP_ENTRY,
      "claude-ai-connector": CLAUDE_AI_CONNECTOR_ENTRY,
      cursor: CURSOR_ENTRY,
      "github-copilot": GITHUB_COPILOT_ENTRY,
      opencode: OPENCODE_ENTRY,
      "rovo-dev": ROVO_DEV_ENTRY,
      kiro: KIRO_ENTRY,
      qoder: QODER_ENTRY,
      trae: TRAE_ENTRY
    });
    HOST_ID_SET = new Set(HOST_IDS);
    FAMILY_SET = new Set(HOST_FAMILIES);
    AUTH_PROBE_SET = new Set(AUTH_PROBES);
  }
});

// ../src/modules/host-runtime/workflows/host-id-namespace.ts
function normalizeHostId(value) {
  const s = value.trim();
  if (HOST_ID_SET2.has(s)) return s;
  return LEGACY_HOST_ALIASES[s] ?? null;
}
var HOST_ID_SET2, LEGACY_HOST_ALIASES;
var init_host_id_namespace = __esm({
  "../src/modules/host-runtime/workflows/host-id-namespace.ts"() {
    init_host_registry_schema();
    HOST_ID_SET2 = new Set(HOST_IDS);
    LEGACY_HOST_ALIASES = {
      claude: "claude-code-cli",
      "claude-code-desktop": "claude-code-app",
      codex: "codex-cli",
      "codex-plugin": "codex-cli",
      agents: "agents-file",
      ".agents": "agents-file",
      pi: "pi-cli",
      antigravity: "antigravity-cli",
      "antigravity-2": "antigravity-cli"
    };
  }
});

// ../src/modules/host-runtime/workflows/adapter-fallback-ladders.ts
var RUNGS, ADAPTER_SURFACES, INFERRED_HOSTS, RUNG_SET, SURFACE_SET;
var init_adapter_fallback_ladders = __esm({
  "../src/modules/host-runtime/workflows/adapter-fallback-ladders.ts"() {
    init_host_registry_schema();
    init_kernel();
    RUNGS = Object.freeze(["native", "wrapped", "bridged", "emulated", "degraded"]);
    ADAPTER_SURFACES = Object.freeze(["interaction", "session", "semantic_tool", "browser"]);
    INFERRED_HOSTS = sealSet([
      "agents-file",
      "pi-cli",
      "antigravity-cli",
      "claude-code-app",
      "claude-code-web",
      "codex-app",
      "claude-ai-connector",
      // verified-multi-host new hosts — off-box target rows, no live-host verification yet.
      "cursor",
      "github-copilot",
      "opencode",
      "rovo-dev",
      "kiro",
      "qoder",
      "trae"
    ], "INFERRED_HOSTS");
    RUNG_SET = new Set(RUNGS);
    SURFACE_SET = new Set(ADAPTER_SURFACES);
  }
});

// ../src/modules/host-runtime/workflows/host-profiles-validate.ts
var KNOWN_HOST_IDS, VALID_HOST_PROFILE_ENTRY_KEYS, VALID_HOST_PROFILE_MODEL_KEYS;
var init_host_profiles_validate = __esm({
  "../src/modules/host-runtime/workflows/host-profiles-validate.ts"() {
    init_host_registry_schema();
    init_kernel();
    init_host_id_namespace();
    KNOWN_HOST_IDS = new Set(HOST_IDS);
    VALID_HOST_PROFILE_ENTRY_KEYS = sealSet(["models", "enabled"], "VALID_HOST_PROFILE_ENTRY_KEYS");
    VALID_HOST_PROFILE_MODEL_KEYS = sealSet(["cheap", "mid", "powerful"], "VALID_HOST_PROFILE_MODEL_KEYS");
  }
});

// ../src/modules/host-runtime/workflows/host-registry.ts
function deriveCapabilityRow(row) {
  return row.capabilities;
}
function resultAdapterForFamily(family) {
  return FAMILY_TO_ROW[family]?.result_adapter ?? false;
}
var DERIVED_HOST_CAPABILITY_ROWS, FAMILY_TO_ROW;
var init_host_registry = __esm({
  "../src/modules/host-runtime/workflows/host-registry.ts"() {
    init_host_registry_schema();
    init_host_id_namespace();
    DERIVED_HOST_CAPABILITY_ROWS = (() => {
      const out = {};
      for (const id of HOST_IDS) {
        out[id] = deriveCapabilityRow(HOST_REGISTRY_ROWS[id]);
      }
      out["claude"] = out["claude-code-cli"];
      out["codex"] = out["codex-cli"];
      out["pi"] = out["pi-cli"];
      out["antigravity"] = out["antigravity-cli"];
      out["antigravity-2"] = out["antigravity-cli"];
      return out;
    })();
    FAMILY_TO_ROW = (() => {
      const out = {};
      for (const id of HOST_IDS) {
        const row = HOST_REGISTRY_ROWS[id];
        const existing = out[row.family];
        if (!existing || !existing.result_adapter && row.result_adapter) {
          out[row.family] = row;
        }
      }
      return out;
    })();
  }
});

// ../src/modules/host-runtime/workflows/provider-detect.ts
var PROVIDER_REGISTRY;
var init_provider_detect = __esm({
  "../src/modules/host-runtime/workflows/provider-detect.ts"() {
    init_host_registry();
    PROVIDER_REGISTRY = [
      // The author host itself — always "detected on the host", never a cross reviewer
      // for a same-family author (the AC-8 guard handles that).
      { id: "claude", kind: "host", family: "claude", hasAdapter: resultAdapterForFamily("claude"), requiresAuth: false },
      // Codex reference adapters (the only selectable cross reviewers today).
      { id: "codex-plugin", kind: "plugin-adapter", family: "codex", bin: "codex", hasAdapter: resultAdapterForFamily("codex"), requiresAuth: true },
      { id: "codex-cli", kind: "cli", family: "codex", bin: "codex", hasAdapter: resultAdapterForFamily("codex"), requiresAuth: true },
      // Detect-only until adapters ship (OD-6) — pi/antigravity rows carry result_adapter:false.
      // (The former `gemini-cli` provider was removed when Gemini was sunset 2026-06-14.)
      { id: "pi", kind: "cli", family: "pi", bin: "pi", hasAdapter: resultAdapterForFamily("pi"), requiresAuth: false },
      // VERIFIED on-host 2026-06-16: the Antigravity CLI is `agy` (1.0.8), not `antigravity` — detection must probe `agy` or it never finds the host.
      { id: "antigravity", kind: "cli", family: "antigravity", bin: "agy", hasAdapter: resultAdapterForFamily("antigravity"), requiresAuth: false }
    ];
  }
});

// ../src/modules/host-runtime/workflows/session-context.ts
var init_session_context = __esm({
  "../src/modules/host-runtime/workflows/session-context.ts"() {
    init_provider_detect();
  }
});

// ../src/modules/host-runtime/workflows/model-discovery/adapter-contract.ts
function isFailureReason(value) {
  return typeof value === "string" && FAILURE_REASONS.includes(value);
}
function failureResult(adapter, status, failureReason, latencyMs, sourceRef) {
  if (!isFailureReason(failureReason)) throw new Error("failure_reason outside the closed vocabulary");
  return {
    adapter_id: adapter.adapter_id,
    adapter_version: adapter.adapter_version,
    target_id: adapter.target_id,
    method: adapter.method,
    source_ref: sourceRef,
    status,
    latency_ms: latencyMs,
    failure_reason: failureReason,
    models: []
  };
}
var FAILURE_REASONS, DiscoveryParseRejected;
var init_adapter_contract = __esm({
  "../src/modules/host-runtime/workflows/model-discovery/adapter-contract.ts"() {
    init_session_context();
    FAILURE_REASONS = Object.freeze([
      "timeout_budget_exceeded",
      "parse_rejected",
      "io_unavailable",
      "tool_version_out_of_range",
      "subprocess_failed",
      "http_error",
      "auth_unavailable",
      "surface_absent"
    ]);
    DiscoveryParseRejected = class extends Error {
      constructor(detail) {
        super(`provider output rejected by schema validation: ${detail}`);
        this.name = "DiscoveryParseRejected";
      }
    };
  }
});

// ../src/modules/host-runtime/workflows/model-discovery/claude-api.ts
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function parseClaudeModelsPage(raw) {
  if (!isRecord(raw)) throw new DiscoveryParseRejected("response is not an object");
  if (!Array.isArray(raw.data)) throw new DiscoveryParseRejected("response.data is not an array");
  const models = [];
  raw.data.forEach((entry, i) => {
    if (!isRecord(entry)) throw new DiscoveryParseRejected(`data[${i}] is not an object`);
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      throw new DiscoveryParseRejected(`data[${i}].id is not a non-empty string`);
    }
    if (entry.capabilities !== void 0 && !isRecord(entry.capabilities)) {
      throw new DiscoveryParseRejected(`data[${i}].capabilities is not an object`);
    }
    models.push(entry);
  });
  return {
    models,
    hasMore: raw.has_more === true,
    lastId: typeof raw.last_id === "string" ? raw.last_id : null
  };
}
function effortsFromCapabilities(capabilities) {
  const effort = capabilities?.effort;
  if (!isRecord(effort)) return [];
  return CLAUDE_EFFORT_LEVELS.filter((level) => effort[level] === true);
}
function normalizeClaudeApiModels(models) {
  return models.map((m) => ({
    canonical_id: m.id,
    display_name: typeof m.display_name === "string" ? m.display_name : void 0,
    model_family: "claude",
    // this authenticated first-party catalog lists Claude models
    reasoning_efforts: effortsFromCapabilities(m.capabilities),
    default_effort: null,
    // the listing carries support flags, not a default
    provider_priority: null,
    provider_default: false,
    visibility: "listed",
    deprecation: { upgrade_to: null, migration_note: null },
    capabilities: isRecord(m.capabilities) ? m.capabilities : {},
    evidence_source: "contract_api_list",
    // The one row whose contract states availability for the requesting target.
    contract_states_availability: true
  }));
}
var CLAUDE_API_ADAPTER_ID, CLAUDE_API_ADAPTER_VERSION, CLAUDE_API_MODELS_URL, CLAUDE_API_VERSION_HEADER, CLAUDE_API_MAX_PAGES, CLAUDE_EFFORT_LEVELS, claudeApiAdapter;
var init_claude_api = __esm({
  "../src/modules/host-runtime/workflows/model-discovery/claude-api.ts"() {
    init_adapter_contract();
    CLAUDE_API_ADAPTER_ID = "claude-api-models";
    CLAUDE_API_ADAPTER_VERSION = "1.0.0";
    CLAUDE_API_MODELS_URL = "https://api.anthropic.com/v1/models";
    CLAUDE_API_VERSION_HEADER = "2023-06-01";
    CLAUDE_API_MAX_PAGES = 5;
    CLAUDE_EFFORT_LEVELS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
    claudeApiAdapter = {
      adapter_id: CLAUDE_API_ADAPTER_ID,
      adapter_version: CLAUDE_API_ADAPTER_VERSION,
      target_id: "claude-api",
      method: "contract_api_list",
      tool_versions: null,
      // versioned REST surface; gated by anthropic-version header, not CLI version
      async discover(io) {
        const started = io.monotonicMs();
        const elapsed = () => Math.max(0, io.monotonicMs() - started);
        if (!io.httpGetJson) {
          return failureResult(this, "unsupported", "io_unavailable", elapsed(), CLAUDE_API_ADAPTER_ID);
        }
        const all = [];
        let url = `${CLAUDE_API_MODELS_URL}?limit=1000`;
        for (let page = 0; page < CLAUDE_API_MAX_PAGES; page += 1) {
          const raw = await io.httpGetJson(url, { "anthropic-version": CLAUDE_API_VERSION_HEADER });
          const { models, hasMore, lastId } = parseClaudeModelsPage(raw);
          all.push(...normalizeClaudeApiModels(models));
          if (!hasMore || !lastId) {
            return {
              adapter_id: CLAUDE_API_ADAPTER_ID,
              adapter_version: CLAUDE_API_ADAPTER_VERSION,
              target_id: "claude-api",
              method: "contract_api_list",
              source_ref: "claude-api GET /v1/models",
              status: "ok",
              latency_ms: elapsed(),
              failure_reason: null,
              models: all
            };
          }
          url = `${CLAUDE_API_MODELS_URL}?limit=1000&after_id=${encodeURIComponent(lastId)}`;
        }
        return {
          adapter_id: CLAUDE_API_ADAPTER_ID,
          adapter_version: CLAUDE_API_ADAPTER_VERSION,
          target_id: "claude-api",
          method: "contract_api_list",
          source_ref: "claude-api GET /v1/models",
          status: "partial",
          latency_ms: elapsed(),
          failure_reason: null,
          models: all
        };
      }
    };
  }
});

// ../src/modules/host-runtime/workflows/model-discovery/codex-app-server.ts
function isRecord2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function parseModelListResult(raw) {
  if (!isRecord2(raw)) throw new DiscoveryParseRejected("result is not an object");
  const data = raw.data;
  if (!Array.isArray(data)) throw new DiscoveryParseRejected("result.data is not an array");
  const models = [];
  data.forEach((entry, i) => {
    if (!isRecord2(entry)) throw new DiscoveryParseRejected(`data[${i}] is not an object`);
    if (typeof entry.model !== "string" || entry.model.length === 0) {
      throw new DiscoveryParseRejected(`data[${i}].model is not a non-empty string`);
    }
    if (entry.supportedReasoningEfforts !== void 0) {
      if (!Array.isArray(entry.supportedReasoningEfforts)) {
        throw new DiscoveryParseRejected(`data[${i}].supportedReasoningEfforts is not an array`);
      }
      for (const [j, eff] of entry.supportedReasoningEfforts.entries()) {
        if (!isRecord2(eff) || typeof eff.reasoningEffort !== "string") {
          throw new DiscoveryParseRejected(`data[${i}].supportedReasoningEfforts[${j}].reasoningEffort missing`);
        }
      }
    }
    if (entry.hidden !== void 0 && typeof entry.hidden !== "boolean") {
      throw new DiscoveryParseRejected(`data[${i}].hidden is not a boolean`);
    }
    models.push(entry);
  });
  return models;
}
function normalizeAppServerModels(models) {
  return models.map((m) => ({
    canonical_id: m.model,
    display_name: typeof m.displayName === "string" ? m.displayName : void 0,
    // No family field is provider-stated on this surface.
    reasoning_efforts: (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
    default_effort: typeof m.defaultReasoningEffort === "string" ? m.defaultReasoningEffort : null,
    provider_priority: null,
    // app-server exposes order, not a numeric priority field
    provider_default: m.isDefault === true,
    visibility: m.hidden === true ? "hidden" : "listed",
    deprecation: {
      upgrade_to: typeof m.upgrade === "string" ? m.upgrade : null,
      migration_note: typeof m.upgradeInfo?.migrationMarkdown === "string" ? m.upgradeInfo.migrationMarkdown : null
    },
    capabilities: {
      image_input: Array.isArray(m.inputModalities) ? m.inputModalities.includes("image") : void 0,
      // Superset-schema extensions preserved from the provider listing:
      service_tiers: Array.isArray(m.serviceTiers) ? m.serviceTiers.map((t) => t.id) : [],
      additional_speed_tiers: Array.isArray(m.additionalSpeedTiers) ? m.additionalSpeedTiers : [],
      default_service_tier: typeof m.defaultServiceTier === "string" ? m.defaultServiceTier : null
    },
    evidence_source: "native_list",
    contract_states_availability: false
    // entitlement semantics contractually undefined
  }));
}
var CODEX_APP_SERVER_ADAPTER_ID, CODEX_APP_SERVER_ADAPTER_VERSION, CODEX_APP_SERVER_TOOL_VERSIONS, codexAppServerAdapter;
var init_codex_app_server = __esm({
  "../src/modules/host-runtime/workflows/model-discovery/codex-app-server.ts"() {
    init_adapter_contract();
    CODEX_APP_SERVER_ADAPTER_ID = "codex-app-server-model-list";
    CODEX_APP_SERVER_ADAPTER_VERSION = "1.0.0";
    CODEX_APP_SERVER_TOOL_VERSIONS = { min: "0.144.0", maxExclusive: "2.0.0" };
    codexAppServerAdapter = {
      adapter_id: CODEX_APP_SERVER_ADAPTER_ID,
      adapter_version: CODEX_APP_SERVER_ADAPTER_VERSION,
      target_id: "codex-app-server",
      method: "native_list",
      tool_versions: CODEX_APP_SERVER_TOOL_VERSIONS,
      async discover(io, opts = {}) {
        const started = io.monotonicMs();
        const elapsed = () => Math.max(0, io.monotonicMs() - started);
        if (!io.jsonRpcCall) {
          return failureResult(this, "unsupported", "io_unavailable", elapsed(), CODEX_APP_SERVER_ADAPTER_ID);
        }
        const includeHidden = opts.includeHidden === true;
        const result = await io.jsonRpcCall("model/list", includeHidden ? { includeHidden: true } : {});
        const models = normalizeAppServerModels(parseModelListResult(result));
        return {
          adapter_id: CODEX_APP_SERVER_ADAPTER_ID,
          adapter_version: CODEX_APP_SERVER_ADAPTER_VERSION,
          target_id: "codex-app-server",
          method: "native_list",
          source_ref: "codex-app-server model/list",
          status: "ok",
          latency_ms: elapsed(),
          failure_reason: null,
          models
        };
      }
    };
  }
});

// ../src/modules/host-runtime/workflows/model-discovery/codex-debug-models.ts
function isRecord3(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function parseDebugModelsOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new DiscoveryParseRejected("stdout is not valid JSON");
  }
  if (!isRecord3(parsed) || !Array.isArray(parsed.models)) {
    throw new DiscoveryParseRejected("payload.models is not an array");
  }
  const entries = [];
  parsed.models.forEach((entry, i) => {
    if (!isRecord3(entry)) throw new DiscoveryParseRejected(`models[${i}] is not an object`);
    if (typeof entry.slug !== "string" || entry.slug.length === 0) {
      throw new DiscoveryParseRejected(`models[${i}].slug is not a non-empty string`);
    }
    if (entry.supported_reasoning_levels !== void 0) {
      if (!Array.isArray(entry.supported_reasoning_levels)) {
        throw new DiscoveryParseRejected(`models[${i}].supported_reasoning_levels is not an array`);
      }
      for (const [j, lvl] of entry.supported_reasoning_levels.entries()) {
        if (!isRecord3(lvl) || typeof lvl.effort !== "string") {
          throw new DiscoveryParseRejected(`models[${i}].supported_reasoning_levels[${j}].effort missing`);
        }
      }
    }
    entries.push(entry);
  });
  return entries;
}
function normalizeDebugModels(entries) {
  return entries.map((m) => ({
    canonical_id: m.slug,
    display_name: typeof m.display_name === "string" ? m.display_name : void 0,
    reasoning_efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort),
    default_effort: typeof m.default_reasoning_level === "string" ? m.default_reasoning_level : null,
    provider_priority: typeof m.priority === "number" ? m.priority : null,
    provider_default: false,
    // the debug catalog carries no default flag
    visibility: m.visibility === "hide" ? "hidden" : "listed",
    deprecation: { upgrade_to: null, migration_note: null },
    capabilities: {
      // Advertised subscription-catalog metadata about the API target (F5):
      // preserved verbatim as metadata, never treated as dispatch evidence.
      supported_in_api: typeof m.supported_in_api === "boolean" ? m.supported_in_api : void 0,
      service_tiers: Array.isArray(m.service_tiers) ? m.service_tiers.map((t) => t.id) : [],
      additional_speed_tiers: Array.isArray(m.additional_speed_tiers) ? m.additional_speed_tiers : []
    },
    evidence_source: "debug_catalog",
    contract_states_availability: false
  }));
}
var CODEX_DEBUG_MODELS_ADAPTER_ID, CODEX_DEBUG_MODELS_ADAPTER_VERSION, CODEX_DEBUG_MODELS_TOOL_VERSIONS, codexDebugModelsAdapter;
var init_codex_debug_models = __esm({
  "../src/modules/host-runtime/workflows/model-discovery/codex-debug-models.ts"() {
    init_adapter_contract();
    CODEX_DEBUG_MODELS_ADAPTER_ID = "codex-debug-models";
    CODEX_DEBUG_MODELS_ADAPTER_VERSION = "1.0.0";
    CODEX_DEBUG_MODELS_TOOL_VERSIONS = { min: "0.144.0", maxExclusive: "0.147.0" };
    codexDebugModelsAdapter = {
      adapter_id: CODEX_DEBUG_MODELS_ADAPTER_ID,
      adapter_version: CODEX_DEBUG_MODELS_ADAPTER_VERSION,
      target_id: "codex-cli-chatgpt",
      method: "debug_catalog",
      tool_versions: CODEX_DEBUG_MODELS_TOOL_VERSIONS,
      async discover(io) {
        const started = io.monotonicMs();
        const elapsed = () => Math.max(0, io.monotonicMs() - started);
        if (!io.execCapture) {
          return failureResult(this, "unsupported", "io_unavailable", elapsed(), CODEX_DEBUG_MODELS_ADAPTER_ID);
        }
        const { stdout } = await io.execCapture(["codex", "debug", "models"]);
        const models = normalizeDebugModels(parseDebugModelsOutput(stdout));
        return {
          adapter_id: CODEX_DEBUG_MODELS_ADAPTER_ID,
          adapter_version: CODEX_DEBUG_MODELS_ADAPTER_VERSION,
          target_id: "codex-cli-chatgpt",
          method: "debug_catalog",
          source_ref: "codex debug models",
          status: "ok",
          latency_ms: elapsed(),
          failure_reason: null,
          models
        };
      }
    };
  }
});

// ../src/modules/host-runtime/workflows/model-discovery/openai-api.ts
function isRecord4(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function openAiFamilyFor(id) {
  if (id.startsWith("gpt-")) return "gpt";
  return "unknown";
}
function parseOpenAiModelsResponse(raw) {
  if (!isRecord4(raw)) throw new DiscoveryParseRejected("response is not an object");
  if (!Array.isArray(raw.data)) throw new DiscoveryParseRejected("response.data is not an array");
  const models = [];
  raw.data.forEach((entry, i) => {
    if (!isRecord4(entry)) throw new DiscoveryParseRejected(`data[${i}] is not an object`);
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      throw new DiscoveryParseRejected(`data[${i}].id is not a non-empty string`);
    }
    models.push(entry);
  });
  return models;
}
function normalizeOpenAiModels(models) {
  return models.map((m) => ({
    canonical_id: m.id,
    model_family: openAiFamilyFor(m.id),
    reasoning_efforts: [],
    // not stated on this surface — never copied from other targets
    default_effort: null,
    provider_priority: null,
    provider_default: false,
    visibility: "listed",
    deprecation: { upgrade_to: null, migration_note: null },
    capabilities: {},
    evidence_source: "native_list",
    contract_states_availability: false
    // scope-ambiguous contract ⇒ advertised at most
  }));
}
var OPENAI_API_ADAPTER_ID, OPENAI_API_ADAPTER_VERSION, OPENAI_API_MODELS_URL, openAiApiAdapter;
var init_openai_api = __esm({
  "../src/modules/host-runtime/workflows/model-discovery/openai-api.ts"() {
    init_adapter_contract();
    OPENAI_API_ADAPTER_ID = "openai-api-models";
    OPENAI_API_ADAPTER_VERSION = "1.0.0";
    OPENAI_API_MODELS_URL = "https://api.openai.com/v1/models";
    openAiApiAdapter = {
      adapter_id: OPENAI_API_ADAPTER_ID,
      adapter_version: OPENAI_API_ADAPTER_VERSION,
      target_id: "openai-api",
      method: "native_list",
      tool_versions: null,
      async discover(io) {
        const started = io.monotonicMs();
        const elapsed = () => Math.max(0, io.monotonicMs() - started);
        if (!io.httpGetJson) {
          return failureResult(this, "unsupported", "io_unavailable", elapsed(), OPENAI_API_ADAPTER_ID);
        }
        const raw = await io.httpGetJson(OPENAI_API_MODELS_URL, {});
        const models = normalizeOpenAiModels(parseOpenAiModelsResponse(raw));
        return {
          adapter_id: OPENAI_API_ADAPTER_ID,
          adapter_version: OPENAI_API_ADAPTER_VERSION,
          target_id: "openai-api",
          method: "native_list",
          source_ref: "openai-api GET /v1/models",
          status: "ok",
          latency_ms: elapsed(),
          failure_reason: null,
          models
        };
      }
    };
  }
});

// ../src/modules/host-runtime/workflows/model-discovery/honest-unknown.ts
function staticHintEntries(hints) {
  return hints.map((h) => ({
    canonical_id: h.canonical_id,
    display_name: h.display_name,
    aliases: h.aliases,
    model_family: h.model_family,
    reasoning_efforts: [],
    default_effort: null,
    provider_priority: null,
    provider_default: false,
    visibility: "listed",
    deprecation: { upgrade_to: null, migration_note: null },
    capabilities: {},
    evidence_source: "static_hint",
    contract_states_availability: false
  }));
}
function makeHonestUnknownAdapter(targetId, opts = {}) {
  const hints = opts.staticHints ?? [];
  const adapterId = `honest-unknown-${targetId}`;
  return {
    adapter_id: adapterId,
    adapter_version: HONEST_UNKNOWN_ADAPTER_VERSION,
    target_id: targetId,
    method: hints.length > 0 ? "static_hint" : "none",
    tool_versions: null,
    async discover(io) {
      const started = io.monotonicMs();
      return {
        adapter_id: adapterId,
        adapter_version: HONEST_UNKNOWN_ADAPTER_VERSION,
        target_id: targetId,
        method: hints.length > 0 ? "static_hint" : "none",
        source_ref: opts.surfaceNote ?? "no evidenced availability-listing surface",
        // The receipt itself is honest: no listing surface exists for this
        // target, so discovery is `unsupported` and the target-level evidence
        // state stays `unknown` (static hints only fill model metadata).
        status: "unsupported",
        latency_ms: Math.max(0, io.monotonicMs() - started),
        failure_reason: "surface_absent",
        models: staticHintEntries(hints)
      };
    }
  };
}
var HONEST_UNKNOWN_ADAPTER_VERSION, claudeCliSubscriptionAdapter, claudeAppAdapter, claudeWebAdapter, claudeGatewayBedrockAdapter, claudeGatewayVertexAdapter, claudeGatewayFoundryAdapter, codexCliApiKeyAdapter;
var init_honest_unknown = __esm({
  "../src/modules/host-runtime/workflows/model-discovery/honest-unknown.ts"() {
    HONEST_UNKNOWN_ADAPTER_VERSION = "1.0.0";
    claudeCliSubscriptionAdapter = makeHonestUnknownAdapter("claude-cli-subscription", {
      surfaceNote: "picker is interactive-only; headless entitlement unprovable pre-dispatch"
    });
    claudeAppAdapter = makeHonestUnknownAdapter("claude-app", {
      surfaceNote: "no programmatic discovery surface exists"
    });
    claudeWebAdapter = makeHonestUnknownAdapter("claude-web", {
      surfaceNote: "no programmatic discovery surface exists"
    });
    claudeGatewayBedrockAdapter = makeHonestUnknownAdapter("claude-gateway-bedrock", {
      surfaceNote: "gateway-native evidence only; no availability listing evidenced"
    });
    claudeGatewayVertexAdapter = makeHonestUnknownAdapter("claude-gateway-vertex", {
      surfaceNote: "gateway-native evidence only; no availability listing evidenced"
    });
    claudeGatewayFoundryAdapter = makeHonestUnknownAdapter("claude-gateway-foundry", {
      surfaceNote: "gateway-native evidence only; no availability listing evidenced"
    });
    codexCliApiKeyAdapter = makeHonestUnknownAdapter("codex-cli-api-key", {
      surfaceNote: "no listing evidenced under API-key auth (distinct target from codex-cli-chatgpt)"
    });
  }
});

// ../src/modules/host-runtime/workflows/model-discovery/index.ts
var DISCOVERY_ADAPTER_REGISTRY, CODEX_SEAM_PREFERENCE, CODEX_SEAM_ADAPTERS;
var init_model_discovery = __esm({
  "../src/modules/host-runtime/workflows/model-discovery/index.ts"() {
    init_adapter_contract();
    init_claude_api();
    init_codex_app_server();
    init_codex_debug_models();
    init_openai_api();
    init_honest_unknown();
    init_adapter_contract();
    init_codex_app_server();
    init_codex_debug_models();
    init_claude_api();
    init_openai_api();
    init_honest_unknown();
    DISCOVERY_ADAPTER_REGISTRY = Object.freeze({
      "claude-cli-subscription": claudeCliSubscriptionAdapter,
      "claude-app": claudeAppAdapter,
      "claude-web": claudeWebAdapter,
      "claude-api": claudeApiAdapter,
      "claude-gateway-bedrock": claudeGatewayBedrockAdapter,
      "claude-gateway-vertex": claudeGatewayVertexAdapter,
      "claude-gateway-foundry": claudeGatewayFoundryAdapter,
      "codex-cli-chatgpt": codexDebugModelsAdapter,
      "codex-app-server": codexAppServerAdapter,
      "codex-cli-api-key": codexCliApiKeyAdapter,
      "openai-api": openAiApiAdapter
    });
    CODEX_SEAM_PREFERENCE = Object.freeze(["app-server", "debug-models"]);
    CODEX_SEAM_ADAPTERS = Object.freeze({
      "app-server": codexAppServerAdapter,
      "debug-models": codexDebugModelsAdapter
    });
  }
});

// ../src/modules/host-runtime/workflows/host-adapter-contract.ts
var HOST_ADAPTER_OPERATIONS;
var init_host_adapter_contract = __esm({
  "../src/modules/host-runtime/workflows/host-adapter-contract.ts"() {
    init_host_registry_schema();
    init_host_id_namespace();
    init_adapter_fallback_ladders();
    HOST_ADAPTER_OPERATIONS = Object.freeze([
      "capabilities",
      "bootstrap",
      "preflight",
      "dispatch",
      "collect",
      "renderCommandSurface",
      "renderPackage",
      "renderPermissionDecision",
      "resolveModelParams",
      "memory"
    ]);
  }
});

// ../src/modules/host-runtime/workflows/host-capability-snapshot.ts
function canonicalJson(value) {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (kind === "boolean" || kind === "string") return JSON.stringify(value);
  if (kind === "undefined" || kind === "function" || kind === "symbol") return "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value;
  const parts = [];
  for (const key of Object.keys(record).sort()) {
    if (record[key] === void 0) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  }
  return `{${parts.join(",")}}`;
}
function snapshotHash(hostId, hostVersion, facts) {
  const digest = (0, import_node_crypto.createHash)("sha256").update(
    canonicalJson({
      schema_version: HOST_CAPABILITY_SNAPSHOT_SCHEMA,
      host_id: hostId,
      host_version: hostVersion,
      capabilities: facts.map((fact) => ({
        capability_id: fact.capability_id,
        supported: fact.supported,
        authenticated: fact.authenticated
      }))
    })
  ).digest("hex");
  return `sha256:${digest}`;
}
function authenticatedFor(entry, supported, observation) {
  if (!supported) return false;
  if (observation === "unauthenticated") return false;
  if (!entry.detection.requires_auth) return true;
  return observation === "authenticated";
}
function buildFacts(entry, observation) {
  return HOST_CAPABILITY_IDS.map((capabilityId) => {
    const supported = CAPABILITY_READERS[capabilityId](entry);
    return {
      capability_id: capabilityId,
      supported,
      authenticated: authenticatedFor(entry, supported, observation)
    };
  });
}
function unsupportedResult(request) {
  return deepFreeze({
    schema_version: HOST_CAPABILITY_SNAPSHOT_RESULT_SCHEMA,
    disposition: "unsupported",
    reason_code: "capability_absent",
    host: request.host,
    host_id: null,
    run_id: request.runId,
    snapshot: null,
    unsupported_capability_ids: [...HOST_CAPABILITY_IDS],
    assertions: [
      "an unrecognized host has no capability truth to snapshot",
      "no snapshot is minted and no capability is assumed present",
      "no fallback is implied and no side effect occurs"
    ]
  });
}
function createHostCapabilitySnapshotStore() {
  const minted = /* @__PURE__ */ new Map();
  function keyFor(runId, hostId) {
    return `${runId}\0${hostId}`;
  }
  return {
    capture(request) {
      const hostId = normalizeHostId(String(request.host ?? ""));
      const entry = hostId ? HOST_REGISTRY_ROWS[hostId] : void 0;
      if (!hostId || !entry) return unsupportedResult(request);
      const hostVersion = request.hostVersion ?? UNKNOWN_HOST_VERSION;
      const observation = request.authentication ?? "not_observed";
      const inputHash = canonicalJson({ host_id: hostId, host_version: hostVersion, authentication: observation });
      const key = keyFor(request.runId, hostId);
      const existing = minted.get(key);
      if (existing !== void 0) {
        if (existing.inputHash === inputHash) return existing.result;
        return deepFreeze({
          schema_version: HOST_CAPABILITY_SNAPSHOT_RESULT_SCHEMA,
          disposition: "refused",
          reason_code: "capability_snapshot_mismatch",
          host: request.host,
          host_id: hostId,
          run_id: request.runId,
          snapshot: null,
          unsupported_capability_ids: [],
          assertions: [
            "exactly one capability snapshot binds a run",
            "the bound snapshot is returned unchanged and is not replaced",
            "no second snapshot is minted and no side effect occurs"
          ]
        });
      }
      const facts = buildFacts(entry, observation);
      const snapshot = deepFreeze({
        schema_version: HOST_CAPABILITY_SNAPSHOT_SCHEMA,
        snapshot_hash: snapshotHash(hostId, hostVersion, facts),
        host_id: hostId,
        host_version: hostVersion,
        capabilities: facts
      });
      const result = deepFreeze({
        schema_version: HOST_CAPABILITY_SNAPSHOT_RESULT_SCHEMA,
        disposition: "succeeded",
        reason_code: null,
        host: request.host,
        host_id: hostId,
        run_id: request.runId,
        snapshot,
        unsupported_capability_ids: facts.filter((fact) => !fact.supported).map((fact) => fact.capability_id),
        assertions: [
          "every declared capability id carries an explicit fact",
          "an unsupported capability is reported, never defaulted to supported",
          "the snapshot is immutable and bound to exactly one host and run"
        ]
      });
      minted.set(key, { result, inputHash });
      return result;
    },
    release(runId) {
      const prefix = `${runId}\0`;
      const doomed = [];
      minted.forEach((_stored, key) => {
        if (key.startsWith(prefix)) doomed.push(key);
      });
      doomed.forEach((key) => minted.delete(key));
    },
    size() {
      return minted.size;
    }
  };
}
var import_node_crypto, HOST_CAPABILITY_SNAPSHOT_SCHEMA, HOST_CAPABILITY_SNAPSHOT_RESULT_SCHEMA, HOST_CAPABILITY_IDS, CAPABILITY_READERS, UNKNOWN_HOST_VERSION, DEFAULT_STORE;
var init_host_capability_snapshot = __esm({
  "../src/modules/host-runtime/workflows/host-capability-snapshot.ts"() {
    import_node_crypto = require("node:crypto");
    init_kernel();
    init_host_id_namespace();
    init_host_registry_schema();
    HOST_CAPABILITY_SNAPSHOT_SCHEMA = "guild.host_capability_snapshot.v1";
    HOST_CAPABILITY_SNAPSHOT_RESULT_SCHEMA = "guild.host_capability_snapshot_result.v1";
    HOST_CAPABILITY_IDS = Object.freeze([
      "host.artifacts.direct_filesystem",
      "host.artifacts.file_bus",
      "host.bootstrap.context_injection",
      "host.bootstrap.skill_autoload",
      "host.bootstrap.wrapper_injection",
      "host.commands.command_files",
      "host.commands.slash_commands",
      "host.dispatch.selectable",
      "host.hooks.post_tool_use",
      "host.hooks.pre_compact",
      "host.hooks.pre_tool_use",
      "host.hooks.session_start",
      "host.hooks.stop",
      "host.hooks.subagent_stop",
      "host.hooks.task_completed",
      "host.hooks.task_created",
      "host.hooks.teammate_idle",
      "host.hooks.user_prompt_submit",
      "host.interaction.native_questions",
      "host.mcp.http",
      "host.mcp.stdio",
      "host.models.tier_map",
      "host.package.install",
      "host.package.render",
      "host.package.update",
      "host.permissions.ask",
      "host.permissions.deny",
      "host.result_adapter",
      "host.sessions.resume_by_id",
      "host.structured_output.native_json"
    ]);
    CAPABILITY_READERS = {
      "host.artifacts.direct_filesystem": (entry) => entry.capabilities.artifacts.direct_filesystem,
      "host.artifacts.file_bus": (entry) => entry.capabilities.artifacts.file_bus,
      "host.bootstrap.context_injection": (entry) => {
        const injection = entry.capabilities.bootstrap.context_injection;
        return typeof injection === "string" && injection.length > 0 && injection !== "none";
      },
      "host.bootstrap.skill_autoload": (entry) => entry.capabilities.bootstrap.skill_autoload,
      "host.bootstrap.wrapper_injection": (entry) => entry.capabilities.bootstrap.wrapper_injection,
      "host.commands.command_files": (entry) => entry.capabilities.commands.command_files !== "none",
      "host.commands.slash_commands": (entry) => entry.capabilities.commands.slash_commands,
      "host.dispatch.selectable": (entry) => entry.dispatch_selectable,
      "host.hooks.post_tool_use": (entry) => entry.capabilities.hooks.post_tool_use,
      "host.hooks.pre_compact": (entry) => entry.capabilities.hooks.pre_compact,
      "host.hooks.pre_tool_use": (entry) => entry.capabilities.hooks.pre_tool_use,
      "host.hooks.session_start": (entry) => entry.capabilities.hooks.session_start,
      "host.hooks.stop": (entry) => entry.capabilities.hooks.stop,
      "host.hooks.subagent_stop": (entry) => entry.capabilities.hooks.subagent_stop,
      "host.hooks.task_completed": (entry) => entry.capabilities.hooks.task_completed,
      "host.hooks.task_created": (entry) => entry.capabilities.hooks.task_created,
      "host.hooks.teammate_idle": (entry) => entry.capabilities.hooks.teammate_idle,
      "host.hooks.user_prompt_submit": (entry) => entry.capabilities.hooks.user_prompt_submit,
      "host.interaction.native_questions": (entry) => entry.capabilities.interaction.native_questions,
      "host.mcp.http": (entry) => entry.capabilities.mcp.http,
      "host.mcp.stdio": (entry) => entry.capabilities.mcp.stdio,
      "host.models.tier_map": (entry) => {
        const models = entry.capabilities.models;
        return Boolean(models.cheap.model || models.mid.model || models.powerful.model);
      },
      // `installability` is the REGISTRY column, and it is the one that decides
      // whether an install is proven. A renderer that exists but was never installed
      // is `target`, which is render-capable and install-INCAPABLE — collapsing the
      // two is precisely the optimistic default this snapshot exists to prevent.
      "host.package.install": (entry) => entry.installability === "native" && entry.capabilities.package.installable,
      "host.package.render": (entry) => entry.installability !== "none",
      "host.package.update": (entry) => entry.capabilities.package.update.apply !== "none",
      "host.permissions.ask": (entry) => entry.capabilities.permissions.ask,
      "host.permissions.deny": (entry) => entry.capabilities.permissions.deny,
      "host.result_adapter": (entry) => entry.result_adapter,
      "host.sessions.resume_by_id": (entry) => entry.capabilities.sessions.resume_by_id,
      "host.structured_output.native_json": (entry) => entry.capabilities.structured_output.native_json
    };
    UNKNOWN_HOST_VERSION = "unknown";
    DEFAULT_STORE = createHostCapabilitySnapshotStore();
  }
});

// ../src/modules/host-runtime/workflows/host-event-normalizer.ts
function advertisesNativeHooks(entry) {
  return Object.values(entry.capabilities.hooks).some(Boolean);
}
function hostEventSource(host) {
  const hostId = normalizeHostId(String(host ?? ""));
  const entry = hostId ? HOST_REGISTRY_ROWS[hostId] : void 0;
  if (!hostId || !entry) return NO_SOURCE;
  const familyBindings = NATIVE_BINDINGS_BY_FAMILY[entry.family];
  if (advertisesNativeHooks(entry) && familyBindings !== void 0) {
    return Object.freeze({
      schema_version: HOST_EVENT_NORMALIZATION_SCHEMA,
      host_id: hostId,
      kind: "native_hooks",
      bindings: familyBindings
    });
  }
  if (entry.surface_kind === "app") {
    return Object.freeze({
      schema_version: HOST_EVENT_NORMALIZATION_SCHEMA,
      host_id: hostId,
      kind: "none",
      bindings: Object.freeze([])
    });
  }
  if (entry.surface_kind === "file" || entry.adapter_binding === "agents-file") {
    return Object.freeze({
      schema_version: HOST_EVENT_NORMALIZATION_SCHEMA,
      host_id: hostId,
      kind: "instruction_file",
      bindings: Object.freeze([])
    });
  }
  return Object.freeze({
    schema_version: HOST_EVENT_NORMALIZATION_SCHEMA,
    host_id: hostId,
    kind: "wrapper",
    bindings: WRAPPER_NATIVE_EVENT_BINDINGS
  });
}
function refusal(hostId, nativeEvent, sourceKind, disposition, reasonCode, assertions) {
  return Object.freeze({
    schema_version: HOST_EVENT_NORMALIZATION_RESULT_SCHEMA,
    disposition,
    reason_code: reasonCode,
    host_id: hostId,
    native_event: nativeEvent,
    source_kind: sourceKind,
    event: null,
    candidates: Object.freeze([]),
    assertions: Object.freeze([...assertions])
  });
}
function normalizeHostEvent(host, nativeEvent) {
  const native = String(nativeEvent ?? "");
  const source = hostEventSource(host);
  if (source.host_id === null) {
    return refusal(null, native, source.kind, "unsupported", "capability_absent", [
      "an unrecognized host advertises no event surface",
      "no normalized event is produced and none is inferred"
    ]);
  }
  if (source.kind === "none" || source.kind === "instruction_file") {
    return refusal(source.host_id, native, source.kind, "unsupported", "capability_absent", [
      "the host exposes no runtime event surface for Guild to bind",
      "the absence is reported, not filled with a default event"
    ]);
  }
  const binding = source.bindings.find((candidate) => candidate.native_event === native);
  if (binding === void 0) {
    return refusal(source.host_id, native, source.kind, "refused", "unknown_event", [
      "the host-native event vocabulary is closed",
      "an unrecognized native event is refused, never silently dropped",
      "no normative name is chosen by resemblance"
    ]);
  }
  if (binding.normalized_event === null) {
    return refusal(source.host_id, native, source.kind, "refused", "unknown_event", [
      "the native event is DECLARED to have no normative image",
      "no substitute normative name is offered"
    ]);
  }
  return Object.freeze({
    schema_version: HOST_EVENT_NORMALIZATION_RESULT_SCHEMA,
    disposition: "succeeded",
    reason_code: null,
    host_id: source.host_id,
    native_event: native,
    source_kind: source.kind,
    event: Object.freeze({
      schema_version: NORMALIZED_HOST_EVENT_SCHEMA,
      name: binding.normalized_event,
      vocabulary_version: NORMALIZED_EVENT_VOCABULARY_VERSION,
      host_native: Object.freeze({
        host_id: source.host_id,
        native_event: native,
        source_kind: source.kind
      })
    }),
    candidates: Object.freeze([]),
    assertions: Object.freeze([
      "the normalized name is a member of the normative vocabulary",
      "host-native provenance travels beside the normalized name, never inside it"
    ])
  });
}
var HOST_EVENT_NORMALIZATION_SCHEMA, HOST_EVENT_NORMALIZATION_RESULT_SCHEMA, NORMALIZED_HOST_EVENT_SCHEMA, NORMALIZED_EVENT_VOCABULARY_VERSION, CLAUDE_NATIVE_EVENT_BINDINGS, WRAPPER_NATIVE_EVENT_BINDINGS, NATIVE_BINDINGS_BY_FAMILY, NO_SOURCE;
var init_host_event_normalizer = __esm({
  "../src/modules/host-runtime/workflows/host-event-normalizer.ts"() {
    init_host_id_namespace();
    init_host_registry_schema();
    HOST_EVENT_NORMALIZATION_SCHEMA = "guild.host_event_normalization.v1";
    HOST_EVENT_NORMALIZATION_RESULT_SCHEMA = "guild.host_event_normalization_result.v1";
    NORMALIZED_HOST_EVENT_SCHEMA = "guild.normalized_host_event.v1";
    NORMALIZED_EVENT_VOCABULARY_VERSION = "guild.normalized_event.v2";
    CLAUDE_NATIVE_EVENT_BINDINGS = Object.freeze([
      Object.freeze({
        native_event: "PostToolUse",
        normalized_event: "tool.after",
        rationale: "fires after a tool call completes"
      }),
      Object.freeze({
        native_event: "PreCompact",
        normalized_event: "context.compact",
        rationale: "fires before the host compacts its context window"
      }),
      Object.freeze({
        native_event: "PreToolUse",
        normalized_event: "tool.before",
        rationale: "fires before a tool call is admitted"
      }),
      Object.freeze({
        native_event: "SessionStart",
        normalized_event: "session.start",
        rationale: "fires once when the host session opens"
      }),
      Object.freeze({
        native_event: "Stop",
        normalized_event: "run.stop",
        rationale: "Guild's state model is run-centric, so the host's session stop is the run stop the core names"
      }),
      Object.freeze({
        native_event: "SubagentStop",
        normalized_event: null,
        rationale: "a subagent finishing is not a task collection: the normative vocabulary has no subagent lifecycle name, and reusing the task-collection name would report a collection that never happened. Declared unmapped rather than approximated."
      }),
      Object.freeze({
        native_event: "TaskCompleted",
        normalized_event: "task.collect",
        rationale: "the shipped task-completion producer the normative vocabulary was chosen to keep distinct"
      }),
      Object.freeze({
        native_event: "TaskCreated",
        normalized_event: "task.dispatch",
        rationale: "the shipped task-creation producer the normative vocabulary was chosen to keep distinct"
      }),
      Object.freeze({
        native_event: "TeammateIdle",
        normalized_event: null,
        rationale: "teammate idleness is a scheduling signal, not a lifecycle transition; the normative vocabulary declares no image for it. Declared unmapped rather than approximated."
      }),
      Object.freeze({
        native_event: "UserPromptSubmit",
        normalized_event: "prompt.submit",
        rationale: "fires when the operator submits a prompt"
      })
    ]);
    WRAPPER_NATIVE_EVENT_BINDINGS = Object.freeze([
      Object.freeze({
        native_event: "guild.wrapper.context_compact",
        normalized_event: "context.compact",
        rationale: "the wrapper reports a context reduction it performed on the host's behalf"
      }),
      Object.freeze({
        native_event: "guild.wrapper.prompt_submit",
        normalized_event: "prompt.submit",
        rationale: "the wrapper hands the host an operator prompt"
      }),
      Object.freeze({
        native_event: "guild.wrapper.run_resume",
        normalized_event: "run.resume",
        rationale: "the wrapper re-enters an existing run"
      }),
      Object.freeze({
        native_event: "guild.wrapper.run_stop",
        normalized_event: "run.stop",
        rationale: "the wrapper observes the host process closing the run"
      }),
      Object.freeze({
        native_event: "guild.wrapper.session_start",
        normalized_event: "session.start",
        rationale: "the wrapper opens the host process for this run"
      }),
      Object.freeze({
        native_event: "guild.wrapper.task_collect",
        normalized_event: "task.collect",
        rationale: "the wrapper collects a finished task run"
      }),
      Object.freeze({
        native_event: "guild.wrapper.task_dispatch",
        normalized_event: "task.dispatch",
        rationale: "the wrapper dispatches a task run onto the host"
      }),
      Object.freeze({
        native_event: "guild.wrapper.tool_after",
        normalized_event: "tool.after",
        rationale: "the wrapper observes a completed tool call"
      }),
      Object.freeze({
        native_event: "guild.wrapper.tool_before",
        normalized_event: "tool.before",
        rationale: "the wrapper observes a tool call about to run"
      })
    ]);
    NATIVE_BINDINGS_BY_FAMILY = Object.freeze({
      claude: CLAUDE_NATIVE_EVENT_BINDINGS
    });
    NO_SOURCE = Object.freeze({
      schema_version: HOST_EVENT_NORMALIZATION_SCHEMA,
      host_id: null,
      kind: "none",
      bindings: Object.freeze([])
    });
  }
});

// ../src/modules/host-runtime/workflows/host-adapter-boundary.ts
function entryPointFor(hostId) {
  const row = HOST_REGISTRY_ROWS[hostId];
  const subcommand = row.detection.subcommand ?? null;
  const kind = row.surface_kind === "app" ? "app_surface" : row.surface_kind === "file" || row.adapter_binding === "agents-file" ? "instruction_file" : subcommand ? "cli_subcommand" : "cli_binary";
  return Object.freeze({
    schema_version: HOST_ENTRY_POINT_SCHEMA,
    host_id: hostId,
    kind,
    surface_kind: row.surface_kind,
    adapter_binding: row.adapter_binding,
    bin: row.detection.bin,
    subcommand,
    instruction_file: row.detection.marker?.agents_placement ?? (kind === "instruction_file" ? DEFAULT_INSTRUCTION_FILE : null),
    requires_auth: row.detection.requires_auth,
    auth_probe: row.detection.auth_probe,
    event_source: hostEventSource(hostId).kind,
    dispatch_selectable: row.dispatch_selectable
  });
}
function bindingFailure(host, disposition, reasonCode, assertions, facts) {
  return Object.freeze({
    schema_version: HOST_RUNTIME_BINDING_RESULT_SCHEMA,
    disposition,
    reason_code: reasonCode,
    host,
    binding: null,
    assertions: Object.freeze([...assertions]),
    facts: Object.freeze({ ...facts })
  });
}
function expectedAdapterHostId(hostId) {
  return HOST_REGISTRY_ROWS[hostId].adapter_binding === "agents-file" ? "agents-file" : hostId;
}
function ownDataProperty(candidate, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
    if (descriptor === void 0) return { present: false, value: void 0 };
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      return { present: false, value: void 0 };
    }
    return { present: true, value: descriptor.value };
  } catch {
    return { present: false, value: void 0 };
  }
}
function inspectAdapterShape(candidate) {
  try {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { valid: false, invalidMembers: Object.freeze([SHAPE_NOT_AN_OBJECT]), hostId: null };
    }
    const invalid = [];
    const host = ownDataProperty(candidate, "host");
    if (!host.present || typeof host.value !== "string" || host.value.length === 0) invalid.push("host");
    const declaredId = ownDataProperty(candidate, "hostId");
    const hostIdWellFormed = declaredId.present && (typeof declaredId.value === "string" || declaredId.value === null);
    if (!hostIdWellFormed) invalid.push("hostId");
    for (const operation of HOST_ADAPTER_OPERATIONS) {
      const member = ownDataProperty(candidate, operation);
      if (!member.present || typeof member.value !== "function") invalid.push(operation);
    }
    return {
      valid: invalid.length === 0,
      invalidMembers: Object.freeze([...invalid]),
      hostId: typeof declaredId.value === "string" ? declaredId.value : null
    };
  } catch {
    return { valid: false, invalidMembers: Object.freeze([SHAPE_UNINSPECTABLE]), hostId: null };
  }
}
function bindHostRuntimeAdapter(request) {
  const host = String(request.host ?? "");
  const hostId = normalizeHostId(host);
  if (hostId === null || HOST_REGISTRY_ROWS[hostId] === void 0) {
    return bindingFailure(
      host,
      "unsupported",
      "capability_absent",
      [
        "the host is not a member of the adapter registry",
        "no entry point is bound and no capability is assumed",
        "no fallback is implied and no side effect occurs"
      ],
      { requested_host: host, host_id: null }
    );
  }
  const store = request.snapshots ?? BOUNDARY_STORE;
  const captured = store.capture({
    host: hostId,
    runId: request.runId,
    hostVersion: request.hostVersion,
    authentication: request.authentication
  });
  if (captured.disposition !== "succeeded" || captured.snapshot === null) {
    return bindingFailure(
      host,
      captured.disposition === "refused" ? "refused" : "unsupported",
      captured.reason_code ?? "capability_absent",
      [
        "a binding requires the run's one capability snapshot",
        "no adapter is reached when the snapshot cannot be established"
      ],
      { requested_host: host, host_id: hostId, snapshot_disposition: captured.disposition }
    );
  }
  let adapter;
  try {
    adapter = request.provider(host);
  } catch (error) {
    return bindingFailure(
      host,
      "failed",
      "execution_failed",
      [
        "the adapter provider raised rather than returning an adapter",
        "the failure is reported as failed, never as unsupported",
        "no partial binding is returned"
      ],
      {
        requested_host: host,
        host_id: hostId,
        provider_error: error instanceof Error ? error.message : String(error)
      }
    );
  }
  const shape = inspectAdapterShape(adapter);
  if (!shape.valid) {
    return bindingFailure(
      host,
      "refused",
      "boundary_membership_mismatch",
      [
        "the provider returned a value that does not implement the public HostAdapter interface",
        "the interface was proven by inspection only: no adapter operation ran and no accessor was read",
        "no partial binding is returned and no side effect occurs"
      ],
      {
        requested_host: host,
        host_id: hostId,
        adapter_shape_valid: false,
        invalid_adapter_members: shape.invalidMembers
      }
    );
  }
  const boundHostId = shape.hostId === null ? null : normalizeHostId(shape.hostId);
  const expected = expectedAdapterHostId(hostId);
  if (boundHostId === null || boundHostId !== expected) {
    return bindingFailure(
      host,
      "refused",
      "boundary_membership_mismatch",
      [
        "the adapter returned by the provider is not this host's adapter",
        "an adapter is bound only when its own identity matches the declared binding",
        "no side effect occurs"
      ],
      {
        requested_host: host,
        expected_host_id: expected,
        bound_host_id: boundHostId
      }
    );
  }
  const entryPoint = HOST_ENTRY_POINTS[hostId];
  const binding = Object.freeze({
    schema_version: HOST_RUNTIME_BINDING_SCHEMA,
    boundary_version: HOST_ADAPTER_BOUNDARY_SCHEMA,
    adapter_contract_version: HOST_ADAPTER_CONTRACT_VERSION,
    host_id: hostId,
    run_id: request.runId,
    entry_point: entryPoint,
    adapter,
    snapshot: captured.snapshot,
    event_source: entryPoint.event_source,
    normalizeEvent(nativeEvent) {
      return normalizeHostEvent(hostId, nativeEvent);
    }
  });
  return Object.freeze({
    schema_version: HOST_RUNTIME_BINDING_RESULT_SCHEMA,
    disposition: "succeeded",
    reason_code: null,
    host,
    binding,
    assertions: Object.freeze([
      "the bound adapter implements every member of the public HostAdapter interface",
      "the bound adapter's own identity matches the requested host's declared binding",
      "the binding carries exactly one immutable capability snapshot for this run",
      "the entry point is the registry's declared host surface, not an inferred one"
    ]),
    facts: Object.freeze({
      requested_host: host,
      host_id: hostId,
      bound_host_id: expected,
      adapter_shape_valid: true,
      entry_point_kind: entryPoint.kind,
      capability_snapshot_hash: captured.snapshot.snapshot_hash
    })
  });
}
var HOST_ADAPTER_BOUNDARY_SCHEMA, HOST_ADAPTER_CONTRACT_VERSION, HOST_ENTRY_POINT_SCHEMA, HOST_RUNTIME_BINDING_SCHEMA, HOST_RUNTIME_BINDING_RESULT_SCHEMA, HOST_ADAPTER_OWNERSHIP_SCHEMA, HOST_ADAPTER_REASON_CODES, HOST_ADAPTER_OWNED_CONCERNS, HOST_ADAPTER_NOT_OWNED_CONCERNS, CONCERN_OWNERS, OWNERSHIP, DEFAULT_INSTRUCTION_FILE, HOST_ENTRY_POINTS, BOUNDARY_STORE, SHAPE_NOT_AN_OBJECT, SHAPE_UNINSPECTABLE;
var init_host_adapter_boundary = __esm({
  "../src/modules/host-runtime/workflows/host-adapter-boundary.ts"() {
    init_host_adapter_contract();
    init_host_id_namespace();
    init_host_registry_schema();
    init_host_capability_snapshot();
    init_host_event_normalizer();
    HOST_ADAPTER_BOUNDARY_SCHEMA = "guild.host_adapter_boundary.v1";
    HOST_ADAPTER_CONTRACT_VERSION = "guild.host_adapter.v1.0.0";
    HOST_ENTRY_POINT_SCHEMA = "guild.host_entry_point.v1";
    HOST_RUNTIME_BINDING_SCHEMA = "guild.host_runtime_binding.v1";
    HOST_RUNTIME_BINDING_RESULT_SCHEMA = "guild.host_runtime_binding_result.v1";
    HOST_ADAPTER_OWNERSHIP_SCHEMA = "guild.host_adapter_ownership.v1";
    HOST_ADAPTER_REASON_CODES = Object.freeze([
      "boundary_membership_mismatch",
      "capability_absent",
      "capability_snapshot_mismatch",
      "execution_failed",
      "unknown_event"
    ]);
    HOST_ADAPTER_OWNED_CONCERNS = Object.freeze([
      "host_identity_resolution",
      "host_entry_point_binding",
      "host_capability_snapshot",
      "host_native_event_normalization"
    ]);
    HOST_ADAPTER_NOT_OWNED_CONCERNS = Object.freeze([
      "lifecycle_state",
      "gate_policy",
      "artifact_semantics",
      "document_rendering",
      "transport_execution"
    ]);
    CONCERN_OWNERS = Object.freeze({
      host_identity_resolution: "host-adapters",
      host_entry_point_binding: "host-adapters",
      host_capability_snapshot: "host-adapters",
      host_native_event_normalization: "host-adapters",
      lifecycle_state: "host-neutral-core",
      gate_policy: "host-neutral-core",
      artifact_semantics: "artifact-document-services",
      document_rendering: "artifact-document-services",
      transport_execution: "execution-transports"
    });
    OWNERSHIP = Object.freeze({
      schema_version: HOST_ADAPTER_OWNERSHIP_SCHEMA,
      boundary_version: HOST_ADAPTER_BOUNDARY_SCHEMA,
      owned: Object.freeze([...HOST_ADAPTER_OWNED_CONCERNS]),
      not_owned: Object.freeze([...HOST_ADAPTER_NOT_OWNED_CONCERNS]),
      owners: CONCERN_OWNERS
    });
    DEFAULT_INSTRUCTION_FILE = "AGENTS.md";
    HOST_ENTRY_POINTS = Object.freeze(
      HOST_IDS.reduce(
        (accumulator, hostId) => {
          accumulator[hostId] = entryPointFor(hostId);
          return accumulator;
        },
        {}
      )
    );
    BOUNDARY_STORE = createHostCapabilitySnapshotStore();
    SHAPE_NOT_AN_OBJECT = "<not an adapter object>";
    SHAPE_UNINSPECTABLE = "<adapter shape could not be inspected>";
  }
});

// ../src/modules/lifecycle/workflows/neutral-runtime-contracts.ts
function includes(list, value) {
  return typeof value === "string" && list.indexOf(value) !== -1;
}
function isNeutralLifecyclePhase(value) {
  return includes(NEUTRAL_LIFECYCLE_PHASES, value);
}
function isNeutralDisposition(value) {
  return includes(NEUTRAL_DISPOSITIONS, value);
}
function isNeutralObservationState(value) {
  return includes(NEUTRAL_OBSERVATION_STATES, value);
}
function isNeutralOutcomeType(value) {
  return includes(NEUTRAL_OUTCOME_TYPES, value);
}
function isNeutralEventName(value) {
  return includes(NEUTRAL_EVENT_NAMES, value);
}
function isNeutralSupportStatus(value) {
  return includes(NEUTRAL_SUPPORT_STATUS_VALUES, value);
}
function isNeutralReasonCode(value) {
  return includes(NEUTRAL_REASON_CODES, value);
}
function isNeutralCleanObservation(value) {
  return value === "checked_clean" || value === "not_applicable";
}
function neutralCanonicalJson(value) {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (kind === "boolean" || kind === "string") return JSON.stringify(value);
  if (kind === "undefined" || kind === "function" || kind === "symbol") return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => neutralCanonicalJson(item)).join(",")}]`;
  }
  const record = value;
  const parts = [];
  for (const key of Object.keys(record).sort()) {
    if (record[key] === void 0) continue;
    parts.push(`${JSON.stringify(key)}:${neutralCanonicalJson(record[key])}`);
  }
  return `{${parts.join(",")}}`;
}
function fnv1a32(input, seed) {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash ^ input.charCodeAt(i)) >>> 0;
    hash = (hash << 1 >>> 0) + (hash << 4 >>> 0) + (hash << 7 >>> 0) + (hash << 8 >>> 0) + (hash << 24 >>> 0) + hash >>> 0;
  }
  return hash >>> 0;
}
function hex8(value) {
  let out = (value >>> 0).toString(16);
  while (out.length < 8) out = `0${out}`;
  return out;
}
function neutralFingerprint(value) {
  const canonical = neutralCanonicalJson(value);
  return `nfp1:${hex8(fnv1a32(canonical, 2166136261))}${hex8(fnv1a32(canonical, 16777619))}`;
}
function rotr32(value, bits) {
  return (value >>> bits | value << 32 - bits) >>> 0;
}
function utf8Bytes(input) {
  const bytes = [];
  for (let index = 0; index < input.length; index += 1) {
    let code = input.charCodeAt(index);
    if (code >= 55296 && code <= 56319 && index + 1 < input.length) {
      const low = input.charCodeAt(index + 1);
      if (low >= 56320 && low <= 57343) {
        code = 65536 + (code - 55296) * 1024 + (low - 56320);
        index += 1;
      }
    }
    if (code < 128) {
      bytes.push(code);
    } else if (code < 2048) {
      bytes.push(192 | code >>> 6, 128 | code & 63);
    } else if (code < 65536) {
      bytes.push(224 | code >>> 12, 128 | code >>> 6 & 63, 128 | code & 63);
    } else {
      bytes.push(
        240 | code >>> 18,
        128 | code >>> 12 & 63,
        128 | code >>> 6 & 63,
        128 | code & 63
      );
    }
  }
  return bytes;
}
function neutralSha256Hex(input) {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 4294967296);
  const low = bitLength >>> 0;
  bytes.push(
    high >>> 24 & 255,
    high >>> 16 & 255,
    high >>> 8 & 255,
    high & 255,
    low >>> 24 & 255,
    low >>> 16 & 255,
    low >>> 8 & 255,
    low & 255
  );
  const state = [...NEUTRAL_SHA256_INIT];
  const schedule = [];
  for (let block = 0; block < bytes.length; block += 64) {
    for (let word = 0; word < 16; word += 1) {
      const at = block + word * 4;
      schedule[word] = (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0;
    }
    for (let word = 16; word < 64; word += 1) {
      const s0 = (rotr32(schedule[word - 15], 7) ^ rotr32(schedule[word - 15], 18) ^ schedule[word - 15] >>> 3) >>> 0;
      const s1 = (rotr32(schedule[word - 2], 17) ^ rotr32(schedule[word - 2], 19) ^ schedule[word - 2] >>> 10) >>> 0;
      schedule[word] = schedule[word - 16] + s0 + schedule[word - 7] + s1 >>> 0;
    }
    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];
    for (let round = 0; round < 64; round += 1) {
      const S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = (e & f ^ ~e & g) >>> 0;
      const temp1 = h + S1 + ch + NEUTRAL_SHA256_K[round] + schedule[round] >>> 0;
      const S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = (a & b ^ a & c ^ b & c) >>> 0;
      const temp2 = S0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + temp1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 >>> 0;
    }
    state[0] = state[0] + a >>> 0;
    state[1] = state[1] + b >>> 0;
    state[2] = state[2] + c >>> 0;
    state[3] = state[3] + d >>> 0;
    state[4] = state[4] + e >>> 0;
    state[5] = state[5] + f >>> 0;
    state[6] = state[6] + g >>> 0;
    state[7] = state[7] + h >>> 0;
  }
  return state.map((word) => hex8(word)).join("");
}
function neutralCanonicalDigest(value) {
  return neutralSha256Hex(neutralCanonicalJson(value));
}
function neutralFreeze(value) {
  const seen = /* @__PURE__ */ new Set();
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (node instanceof RegExp) {
      if (!node.global && !node.sticky) Object.freeze(node);
      return;
    }
    if (node instanceof Set || node instanceof Map) {
      throw new TypeError(
        "neutralFreeze: refusing to 'freeze' a Set/Map \u2014 freeze does not close membership, and the neutral core cannot build a sealed facade. Pass a frozen array or a plain record instead (outside the core, use sealSet()/sealMap())."
      );
    }
    Object.freeze(node);
    for (const key of Object.keys(node)) {
      walk(node[key]);
    }
  };
  walk(value);
  return value;
}
function neutralOutcome(input) {
  if (!isNeutralOutcomeType(input.type)) {
    throw new Error(`neutralOutcome: unknown outcome type ${JSON.stringify(input.type)}`);
  }
  if (!isNeutralDisposition(input.disposition)) {
    throw new Error(`neutralOutcome: unknown disposition ${JSON.stringify(input.disposition)}`);
  }
  const reason = input.reason_code === void 0 ? null : input.reason_code;
  if (input.disposition === "succeeded") {
    if (reason !== null) {
      throw new Error(
        `neutralOutcome: disposition "succeeded" must not carry a reason_code (got ${JSON.stringify(reason)})`
      );
    }
  } else {
    if (reason === null) {
      throw new Error(
        `neutralOutcome: disposition ${JSON.stringify(input.disposition)} requires a reason_code`
      );
    }
    if (!isNeutralReasonCode(reason)) {
      throw new Error(`neutralOutcome: unknown reason code ${JSON.stringify(reason)}`);
    }
  }
  return neutralFreeze({
    schema_version: NEUTRAL_CONTRACTS_SCHEMA_VERSION,
    type: input.type,
    disposition: input.disposition,
    reason_code: reason,
    assertions: [...input.assertions ?? []],
    binding: {
      ...input.binding ?? {},
      contract_version: input.binding?.contract_version ?? NEUTRAL_CONTRACT_VERSION
    },
    facts: { ...input.facts ?? {} }
  });
}
function mapLegacyNeutralEventName(name) {
  if (isNeutralEventName(name)) {
    return neutralOutcome({
      type: "guild.version_compatibility_outcome.v1",
      disposition: "succeeded",
      assertions: ["the submitted name is already a normative event name"],
      facts: {
        submitted_event_name: name,
        normative_version: "guild.normalized_event.v2",
        normative_event_name: name,
        candidates: [],
        compatibility_kind: "unchanged"
      }
    });
  }
  const rule = NEUTRAL_EVENT_COMPATIBILITY_RULES.find((candidate) => candidate.from === name);
  if (rule === void 0) {
    return neutralOutcome({
      type: "guild.version_compatibility_outcome.v1",
      disposition: "refused",
      reason_code: "unknown_event",
      assertions: [
        "the normalized event vocabulary is closed",
        "the event is not silently skipped"
      ],
      facts: {
        submitted_event_name: name ?? null,
        normative_version: "guild.normalized_event.v2",
        in_normative_vocabulary: isNeutralEventName(name)
      }
    });
  }
  if (rule.kind === "ambiguous_split") {
    return neutralOutcome({
      type: "guild.version_compatibility_outcome.v1",
      disposition: "refused",
      reason_code: "event_vocabulary_ambiguous",
      assertions: [
        "a superseded name with two normative images has no lossless mapping",
        "the core refuses rather than choosing a replacement"
      ],
      facts: {
        submitted_event_name: rule.from,
        superseded_version: "guild.normalized_event.v1",
        normative_version: "guild.normalized_event.v2",
        normative_event_name: null,
        candidates: [...rule.candidates],
        compatibility_kind: rule.kind
      }
    });
  }
  return neutralOutcome({
    type: "guild.version_compatibility_outcome.v1",
    disposition: "refused",
    reason_code: "event_vocabulary_superseded",
    assertions: [
      "the submitted name belongs to a superseded vocabulary version",
      "its single normative replacement is named, and no substitution is performed"
    ],
    facts: {
      submitted_event_name: rule.from,
      superseded_version: "guild.normalized_event.v1",
      normative_version: "guild.normalized_event.v2",
      normative_event_name: rule.to,
      candidates: [],
      compatibility_kind: rule.kind
    }
  });
}
var NEUTRAL_CONTRACTS_SCHEMA_VERSION, NEUTRAL_CONTRACT_VERSION, NEUTRAL_LIFECYCLE_PHASES, NEUTRAL_DISPOSITIONS, NEUTRAL_OBSERVATION_STATES, NEUTRAL_OUTCOME_TYPES, NEUTRAL_EVENT_NAMES, NEUTRAL_SUPPORT_STATES, NEUTRAL_SUPPORT_STATUS_VALUES, NEUTRAL_SCENARIO_CATEGORIES, NEUTRAL_REASON_CODES, NEUTRAL_SHA256_K, NEUTRAL_SHA256_INIT, NEUTRAL_EVENT_COMPATIBILITY_KINDS, NEUTRAL_EVENT_COMPATIBILITY_RULES, NEUTRAL_SUPERSEDED_EVENT_NAMES_V1, NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2, NEUTRAL_NORMALIZED_EVENT_VOCABULARY;
var init_neutral_runtime_contracts = __esm({
  "../src/modules/lifecycle/workflows/neutral-runtime-contracts.ts"() {
    NEUTRAL_CONTRACTS_SCHEMA_VERSION = "guild.runtime.contracts.v1";
    NEUTRAL_CONTRACT_VERSION = 1;
    NEUTRAL_LIFECYCLE_PHASES = Object.freeze(["init", "ideate", "plan", "build", "qa", "ops"]);
    NEUTRAL_DISPOSITIONS = Object.freeze([
      "succeeded",
      "refused",
      "unsupported",
      "failed",
      "degraded"
    ]);
    NEUTRAL_OBSERVATION_STATES = Object.freeze([
      "checked_clean",
      "not_applicable",
      "not_observed",
      "observation_failed"
    ]);
    NEUTRAL_OUTCOME_TYPES = Object.freeze([
      "guild.lifecycle_outcome.v1",
      "guild.normalized_event_outcome.v1",
      "guild.support_transition_outcome.v1",
      "guild.capability_outcome.v1",
      "guild.policy_outcome.v1",
      "guild.receipt_outcome.v1",
      "guild.reconciliation_outcome.v1",
      "guild.boundary_outcome.v1",
      "guild.migration_outcome.v1",
      "guild.version_compatibility_outcome.v1"
    ]);
    NEUTRAL_EVENT_NAMES = Object.freeze([
      "session.start",
      "prompt.submit",
      "tool.before",
      "tool.after",
      "context.compact",
      "task.dispatch",
      "task.collect",
      "run.resume",
      "run.stop",
      "package.render",
      "package.install",
      "package.activate",
      "package.update",
      "runtime.verify",
      "receipt.append",
      "receipt.reconcile",
      "migration.shadow",
      "migration.cutover",
      "migration.rollback"
    ]);
    NEUTRAL_SUPPORT_STATES = Object.freeze([
      "recognized",
      "rendered",
      "installed",
      "activated",
      "updated",
      "conformant"
    ]);
    NEUTRAL_SUPPORT_STATUS_VALUES = Object.freeze([
      "not_evaluated",
      "unsupported",
      "failed",
      "satisfied"
    ]);
    NEUTRAL_SCENARIO_CATEGORIES = Object.freeze([
      "lifecycle",
      "normalized_event",
      "support_state",
      "unsupported_refusal",
      "receipt_integrity",
      "module_boundary",
      "strangler_migration",
      "version_drift"
    ]);
    NEUTRAL_REASON_CODES = Object.freeze([
      // lifecycle + gate
      "gate_unsatisfied",
      "unknown_event",
      "unknown_phase",
      "unknown_observation_state",
      "unknown_terminal_state",
      "run_already_closed",
      "capability_snapshot_mismatch",
      "required_observation_missing",
      "required_observation_failed",
      "required_gate_outcome_missing",
      // capability + policy
      "capability_absent",
      "authentication_failed",
      "policy_denied",
      "approval_required",
      // admission (MH-02-R1-B01): the lifecycle path decides, it never trusts a verdict
      "admission_context_missing",
      // one-snapshot-per-run (MH-02-R2-B01): the snapshot a decision is EVALUATED
      // against and the snapshot the run is BOUND to must be the same snapshot, or
      // no outcome from that run can be attributed to a capability truth at all.
      "admission_context_snapshot_mismatch",
      "execution_failed",
      // not-applicable rule binding (MH-02-R1-B02)
      "not_applicable_rule_missing",
      "not_applicable_rule_unknown",
      "not_applicable_rule_mismatch",
      // normalized-event vocabulary compatibility (MH-02-R1-B05)
      "event_vocabulary_superseded",
      "event_vocabulary_ambiguous",
      // support + conformance
      "support_precondition_unproven",
      "support_operation_failed",
      "scenario_evidence_incomplete",
      "scenario_result_mismatch",
      "scenario_registry_invalid",
      // conformance evidence binding (MH-02-R1-B04)
      "scenario_suite_version_mismatch",
      "scenario_required_set_mismatch",
      "scenario_results_unordered",
      "scenario_receipt_reference_missing",
      "scenario_runtime_binding_mismatch",
      "scenario_evidence_stale",
      // conformance evidence integrity (MH-02-R2-B03): nominal metadata is not
      // evidence. Each code names exactly which forgery the decision caught.
      "scenario_reason_code_unrecognized",
      "scenario_receipt_reference_ambiguous",
      "scenario_contract_version_unrecognized",
      "scenario_runtime_version_unrecognized",
      // source-bound conformance evidence (MH-02-R3-B02): a self-consistent bundle
      // of caller-authored labels is not evidence of anything. Promotion requires an
      // AUTHORITATIVE input the claimant does not author, identities the core
      // RECOGNIZES rather than merely parses, and receipt references BOUND by a
      // commitment to that authority instead of merely shaped like references. The
      // commitment is a deterministic UNKEYED digest, NOT a cryptographic MAC — see
      // `neutralReceiptReference`, which states that limit where the code is.
      "scenario_evidence_authority_missing",
      "scenario_identity_binding_mismatch",
      "scenario_source_identity_unrecognized",
      "scenario_host_identity_unrecognized",
      "scenario_receipt_binding_unverified",
      // journal-bound conformance evidence (MH-02-R4-B02): round 4's authority
      // carried an identity, a journal NAME, and a numeric range — no entries. So the
      // decision recomputed every commitment from the claimant's own package and two
      // caller-authored objects agreeing promoted `conformant=true`. Promotion now
      // requires a chain-linked, gap-free journal whose per-entry commitments are
      // TRANSPORTED and compared against the package, a quorum of distinct recognized
      // attestors over its root, and a claimant that is none of them.
      "scenario_journal_chain_unverified",
      "scenario_journal_attestation_insufficient",
      "scenario_claimant_not_independent",
      // independently anchored conformance authority (MH-02-R5-B01): rounds 3, 4 and
      // 5 all bound the evidence to itself more tightly and all left the same hole —
      // every value the decision compared was derivable from public data, so one
      // party supplying the package, the journal, the commitments, the attestor
      // names, and the authority still promoted. An attestation is now a SIGNATURE
      // verified against a verification key pinned in this core, which is the one
      // input a claimant cannot author. This code names a quorum that failed that
      // verification, as distinct from one that was merely malformed.
      "scenario_attestation_signature_unverified",
      // core boundary
      "boundary_forbidden_edge",
      "boundary_unclassified_edge",
      "boundary_membership_mismatch",
      // import closure fails closed (MH-02-R2-B02): an edge whose destination
      // cannot be RESOLVED, and a source whose lexing is ambiguous in a way that
      // could hide an edge, are both "closure unproven" — never "closure proven".
      "boundary_unresolved_edge",
      "boundary_ambiguous_source",
      // capability closure (MH-02-R3-B01): module edges are not the only way out of
      // the core. A call the scan cannot reduce to a named destination, and a
      // reference to an ambient binding the core neither declares nor imports, each
      // reach code the closure argument never covered.
      "boundary_indirect_callee",
      "boundary_ambient_capability",
      // capability PROVENANCE (MH-02-R4-B01): recognizing a call SHAPE is not
      // recognizing a capability. Round 4 rejected `x["k"](…)` only when the `]` was
      // immediately followed by the call parenthesis, so binding the same computed
      // value to a local first — `const load = module["require"].bind(module)` — and
      // calling the local passed with zero findings. Two codes close that: a REACH is
      // the point where a capability enters the file (a computed access whose base is
      // not a clean local or pure intrinsic, or a walk up the prototype chain), and an
      // ALIAS is any later use of a value that flowed from one.
      "boundary_capability_reach",
      "boundary_capability_alias",
      // strangler-migration cutover (A21-8 / W4/MH-08): a shadow record whose
      // candidate outcome diverges from legacy is a typed refusal, never a
      // selection change — this is the one code that names that refusal.
      "migration_shadow_divergence",
      // release/version-drift evidence (A21-9 / W5/MH-09): the three typed
      // version-drift outcomes the frozen contract requires for MHRC-VER-001..003.
      // Drift in any bound evidence-identity field invalidates a prior verdict
      // (refused), a pinned consumer on a different contract major is unsupported
      // rather than silently downgraded, and an expected package/runtime that
      // disagrees with independent runtime discovery is a typed failure.
      "evidence_version_drift",
      "contract_major_mismatch",
      "package_runtime_mismatch"
    ]);
    NEUTRAL_SHA256_K = [
      1116352408,
      1899447441,
      3049323471,
      3921009573,
      961987163,
      1508970993,
      2453635748,
      2870763221,
      3624381080,
      310598401,
      607225278,
      1426881987,
      1925078388,
      2162078206,
      2614888103,
      3248222580,
      3835390401,
      4022224774,
      264347078,
      604807628,
      770255983,
      1249150122,
      1555081692,
      1996064986,
      2554220882,
      2821834349,
      2952996808,
      3210313671,
      3336571891,
      3584528711,
      113926993,
      338241895,
      666307205,
      773529912,
      1294757372,
      1396182291,
      1695183700,
      1986661051,
      2177026350,
      2456956037,
      2730485921,
      2820302411,
      3259730800,
      3345764771,
      3516065817,
      3600352804,
      4094571909,
      275423344,
      430227734,
      506948616,
      659060556,
      883997877,
      958139571,
      1322822218,
      1537002063,
      1747873779,
      1955562222,
      2024104815,
      2227730452,
      2361852424,
      2428436474,
      2756734187,
      3204031479,
      3329325298
    ];
    NEUTRAL_SHA256_INIT = [
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ];
    NEUTRAL_EVENT_COMPATIBILITY_KINDS = Object.freeze([
      "unchanged",
      "renamed",
      "ambiguous_split"
    ]);
    NEUTRAL_EVENT_COMPATIBILITY_RULES = neutralFreeze([
      { from: "session.start", to: "session.start", kind: "unchanged", candidates: [] },
      { from: "prompt.submit", to: "prompt.submit", kind: "unchanged", candidates: [] },
      { from: "context.compact", to: "context.compact", kind: "unchanged", candidates: [] },
      { from: "session.resume", to: "run.resume", kind: "renamed", candidates: [] },
      { from: "tool.pre", to: "tool.before", kind: "renamed", candidates: [] },
      { from: "tool.post", to: "tool.after", kind: "renamed", candidates: [] },
      { from: "session.stop", to: "run.stop", kind: "renamed", candidates: [] },
      {
        from: "task.transition",
        to: null,
        kind: "ambiguous_split",
        candidates: ["task.dispatch", "task.collect"]
      }
    ]);
    NEUTRAL_SUPERSEDED_EVENT_NAMES_V1 = Object.freeze([
      "session.start",
      "session.resume",
      "prompt.submit",
      "tool.pre",
      "tool.post",
      "context.compact",
      "task.transition",
      "session.stop"
    ]);
    NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2 = Object.freeze(NEUTRAL_EVENT_NAMES.filter(
      (name) => !NEUTRAL_EVENT_COMPATIBILITY_RULES.some(
        (rule) => rule.to === name || rule.candidates.indexOf(name) !== -1
      )
    ));
    NEUTRAL_NORMALIZED_EVENT_VOCABULARY = neutralFreeze({
      block_id: "guild.normalized_event_vocabulary.v1",
      normative_version: "guild.normalized_event.v2",
      reconciles: "MH-02-R1-B05",
      vocabulary_owner: "host-neutral-core",
      native_mapping_owner: "host-adapters",
      transport_fact_owner: "execution-transports",
      consumer: "host-neutral-core",
      normative_event_names: [...NEUTRAL_EVENT_NAMES],
      superseded_versions: [
        {
          version: "guild.normalized_event.v1",
          status: "superseded",
          superseded_by: "guild.normalized_event.v2",
          event_types: [...NEUTRAL_SUPERSEDED_EVENT_NAMES_V1]
        }
      ],
      compatibility: {
        policy: "explicit_typed_mapping",
        mapping_totality: "partial",
        superseded_disposition: "refused",
        superseded_reason_code: "event_vocabulary_superseded",
        ambiguous_disposition: "refused",
        ambiguous_reason_code: "event_vocabulary_ambiguous",
        unmapped_disposition: "refused",
        unmapped_reason_code: "unknown_event",
        rules: NEUTRAL_EVENT_COMPATIBILITY_RULES.map((rule) => ({
          from: rule.from,
          to: rule.to,
          kind: rule.kind,
          candidates: [...rule.candidates]
        })),
        introduced_in_v2: [...NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2]
      }
    });
  }
});

// ../src/modules/lifecycle/workflows/neutral-gate-policy.ts
function freezeNeutralCapabilitySnapshot(input) {
  if (!input.snapshot_hash) throw new Error("capability snapshot requires a snapshot_hash");
  if (!input.host_id) throw new Error("capability snapshot requires a host_id");
  return neutralFreeze({
    schema_version: "guild.host_capability_snapshot.v1",
    snapshot_hash: input.snapshot_hash,
    host_id: input.host_id,
    host_version: input.host_version,
    capabilities: input.capabilities.map((fact) => ({
      capability_id: fact.capability_id,
      supported: fact.supported,
      authenticated: fact.authenticated
    }))
  });
}
function neutralCapabilitySnapshotHash(snapshot) {
  const semantic = snapshot.capabilities.map((fact) => ({
    capability_id: fact.capability_id,
    supported: fact.supported,
    authenticated: fact.authenticated
  })).sort((a, b) => a.capability_id < b.capability_id ? -1 : a.capability_id > b.capability_id ? 1 : 0);
  return neutralFingerprint(semantic);
}
function findFact(snapshot, capabilityId) {
  return snapshot.capabilities.find((fact) => fact.capability_id === capabilityId);
}
function bindingFor(request, snapshot) {
  return {
    operation_id: request.operation_id,
    host_id: snapshot?.host_id,
    host_version: snapshot?.host_version,
    capability_snapshot_hash: snapshot?.snapshot_hash,
    contract_version: NEUTRAL_CONTRACT_VERSION
  };
}
function evaluateNeutralCapability(request, snapshot) {
  const fact = findFact(snapshot, request.required_capability);
  const binding = bindingFor(request, snapshot);
  if (fact === void 0 || !fact.supported) {
    return neutralOutcome({
      type: "guild.capability_outcome.v1",
      disposition: "unsupported",
      reason_code: "capability_absent",
      assertions: [
        "reason code and capability id are present",
        "no fallback is implied",
        "no side effect occurs"
      ],
      binding,
      facts: {
        capability_id: request.required_capability,
        capability_supported: false,
        capability_declared: fact !== void 0,
        fallback_implied: false,
        side_effect: false
      }
    });
  }
  if (!fact.authenticated) {
    return neutralOutcome({
      type: "guild.capability_outcome.v1",
      disposition: "failed",
      reason_code: "authentication_failed",
      assertions: [
        "reason code identifies authentication failure",
        "the outcome is not reported as unsupported",
        "silent fallback is prohibited"
      ],
      binding,
      facts: {
        capability_id: request.required_capability,
        capability_supported: true,
        silent_fallback_permitted: false,
        side_effect: false
      }
    });
  }
  return neutralOutcome({
    type: "guild.capability_outcome.v1",
    disposition: "succeeded",
    assertions: ["capability is present and authenticated"],
    binding,
    facts: {
      capability_id: request.required_capability,
      capability_supported: true
    }
  });
}
function evaluateNeutralPolicy(request, policy, snapshot) {
  const binding = bindingFor(request, snapshot);
  const decisionInputs = {
    operation: request.operation,
    operation_class: request.operation_class,
    approval_supplied: request.approval_supplied
  };
  if (policy.denied_operations.indexOf(request.operation) !== -1) {
    return neutralOutcome({
      type: "guild.policy_outcome.v1",
      disposition: "refused",
      reason_code: "policy_denied",
      assertions: [
        "reason code identifies policy denial",
        "no operation side effect occurs"
      ],
      binding,
      facts: {
        operation: request.operation,
        policy_version: policy.policy_version,
        decision_inputs: decisionInputs,
        side_effect: false
      }
    });
  }
  if (policy.approval_required_operations.indexOf(request.operation) !== -1 && !request.approval_supplied) {
    return neutralOutcome({
      type: "guild.policy_outcome.v1",
      disposition: "refused",
      reason_code: "approval_required",
      assertions: [
        "reason code identifies a missing required approval",
        "no operation side effect occurs"
      ],
      binding,
      facts: {
        operation: request.operation,
        policy_version: policy.policy_version,
        decision_inputs: decisionInputs,
        side_effect: false
      }
    });
  }
  return neutralOutcome({
    type: "guild.policy_outcome.v1",
    disposition: "succeeded",
    assertions: ["policy permits the requested operation"],
    binding,
    facts: {
      operation: request.operation,
      policy_version: policy.policy_version,
      decision_inputs: decisionInputs
    }
  });
}
function evaluateNeutralGate(gate, request, snapshot) {
  const binding = bindingFor(request, snapshot);
  const unsatisfied = gate.required_conditions.filter(
    (condition) => request.satisfied_conditions.indexOf(condition) === -1
  );
  if (unsatisfied.length > 0) {
    return neutralOutcome({
      type: "guild.lifecycle_outcome.v1",
      disposition: "refused",
      reason_code: "gate_unsatisfied",
      assertions: [
        "the prior lifecycle state is preserved",
        "the same refusal reason code is returned for the same gate violation",
        "no tool side effect occurs"
      ],
      binding,
      facts: {
        gate_id: gate.gate_id,
        gate_phase: gate.phase,
        operation_class: request.operation_class,
        unsatisfied_conditions: unsatisfied,
        side_effect: false
      }
    });
  }
  return neutralOutcome({
    type: "guild.lifecycle_outcome.v1",
    disposition: "succeeded",
    assertions: ["every required gate condition is satisfied"],
    binding,
    facts: {
      gate_id: gate.gate_id,
      gate_phase: gate.phase,
      operation_class: request.operation_class
    }
  });
}
function evaluateNeutralAdmission(input) {
  const capability2 = evaluateNeutralCapability(input.request, input.snapshot);
  if (capability2.disposition !== "succeeded") return capability2;
  const policy = evaluateNeutralPolicy(input.request, input.policy, input.snapshot);
  if (policy.disposition !== "succeeded") {
    return neutralOutcome({
      type: policy.type,
      disposition: policy.disposition,
      reason_code: policy.reason_code,
      assertions: [...policy.assertions, "capability remains supported"],
      binding: policy.binding,
      facts: { ...policy.facts, capability_supported: true }
    });
  }
  return evaluateNeutralGate(input.gate, input.request, input.snapshot);
}
var init_neutral_gate_policy = __esm({
  "../src/modules/lifecycle/workflows/neutral-gate-policy.ts"() {
    init_neutral_runtime_contracts();
  }
});

// ../src/modules/lifecycle/workflows/neutral-lifecycle-machine.ts
function neutralAdmissionContextSnapshotHash(context) {
  const carried = context?.snapshot?.snapshot_hash;
  return typeof carried === "string" && carried.length > 0 ? carried : void 0;
}
function neutralInitialLifecycleState(input) {
  if (!input.run_id) {
    throw new Error("neutralInitialLifecycleState: run_id must be a non-empty string");
  }
  if (!input.capability_snapshot_hash) {
    throw new Error(
      "neutralInitialLifecycleState: capability_snapshot_hash must be a non-empty string"
    );
  }
  if (!isNeutralLifecyclePhase(input.phase)) {
    throw new Error(
      `neutralInitialLifecycleState: unknown lifecycle phase ${JSON.stringify(input.phase)}`
    );
  }
  for (const rule of input.not_applicable_rules ?? []) {
    if (!rule.rule_id || !rule.applies_to_observation) {
      throw new Error(
        "neutralInitialLifecycleState: every not_applicable rule needs a rule_id and an applies_to_observation"
      );
    }
  }
  if (input.admission_context !== void 0) {
    const contextHash = neutralAdmissionContextSnapshotHash(input.admission_context);
    if (contextHash !== input.capability_snapshot_hash) {
      throw new Error(
        `neutralInitialLifecycleState: admission_context.snapshot.snapshot_hash ${JSON.stringify(contextHash ?? null)} must equal capability_snapshot_hash ${JSON.stringify(input.capability_snapshot_hash)} \u2014 exactly one snapshot binds a run`
      );
    }
  }
  return neutralFreeze({
    schema_version: "guild.lifecycle_state.v1",
    run_id: input.run_id,
    capability_snapshot_hash: input.capability_snapshot_hash,
    phase: input.phase,
    status: "open",
    applied_transitions: [],
    checkpoint_sequence: 0,
    gate_outcomes: {},
    observations: {},
    required_gate_ids: [...input.required_gate_ids ?? []],
    required_observations: [...input.required_observations ?? []],
    admission_context: input.admission_context ?? null,
    not_applicable_rules: [...input.not_applicable_rules ?? []]
  });
}
function neutralLifecycleSemanticView(state) {
  return {
    run_id: state.run_id,
    capability_snapshot_hash: state.capability_snapshot_hash,
    phase: state.phase,
    status: state.status,
    applied_transitions: [...state.applied_transitions],
    checkpoint_sequence: state.checkpoint_sequence,
    gate_outcomes: { ...state.gate_outcomes },
    observations: neutralObservationLedgerView(state),
    required_gate_ids: [...state.required_gate_ids],
    required_observations: [...state.required_observations],
    admission_context: neutralAdmissionContextSemanticView(state.admission_context),
    not_applicable_rules: state.not_applicable_rules.map((rule) => ({
      rule_id: rule.rule_id,
      applies_to_observation: rule.applies_to_observation,
      rationale: rule.rationale
    }))
  };
}
function neutralObservationLedgerView(state) {
  const view = {};
  for (const key of Object.keys(state.observations).sort()) {
    const record = state.observations[key];
    view[key] = {
      state: record.state,
      not_applicable_rule_id: record.not_applicable_rule_id
    };
  }
  return view;
}
function neutralAdmissionContextSemanticView(context) {
  if (context === null) return null;
  return {
    capability_facts_hash: neutralCapabilitySnapshotHash(context.snapshot),
    policy_version: context.policy.policy_version,
    denied_operations: [...context.policy.denied_operations].sort(),
    approval_required_operations: [...context.policy.approval_required_operations].sort(),
    gates: context.gates.map((gate) => ({
      gate_id: gate.gate_id,
      phase: gate.phase,
      operation_class: gate.operation_class,
      required_conditions: [...gate.required_conditions]
    })).sort((a, b) => a.gate_id < b.gate_id ? -1 : a.gate_id > b.gate_id ? 1 : 0)
  };
}
function neutralLifecycleFingerprint(state) {
  return neutralFingerprint(neutralLifecycleSemanticView(state));
}
function neutralLifecycleEquivalent(left, right) {
  return neutralLifecycleFingerprint(left) === neutralLifecycleFingerprint(right);
}
function bindingFor2(state, event) {
  return {
    run_id: state.run_id,
    operation_id: event.transition_id,
    capability_snapshot_hash: state.capability_snapshot_hash,
    contract_version: NEUTRAL_CONTRACT_VERSION
  };
}
function refuse(state, event, reason, facts, assertions) {
  return neutralFreeze({
    state,
    state_changed: false,
    outcome: neutralOutcome({
      type: "guild.lifecycle_outcome.v1",
      disposition: "refused",
      reason_code: reason,
      assertions: [...assertions],
      binding: bindingFor2(state, event),
      facts: { event_name: event.name, side_effect: false, ...facts }
    })
  });
}
function unchanged(state, event, facts, assertions) {
  return neutralFreeze({
    state,
    state_changed: false,
    outcome: neutralOutcome({
      type: "guild.lifecycle_outcome.v1",
      disposition: "succeeded",
      assertions: [...assertions],
      binding: bindingFor2(state, event),
      facts: { event_name: event.name, ...facts }
    })
  });
}
function advance(state, event, patch2, facts, assertions, bindingOverride) {
  const next = neutralFreeze({
    ...state,
    ...patch2,
    applied_transitions: [...state.applied_transitions, event.transition_id]
  });
  return neutralFreeze({
    state: next,
    state_changed: true,
    outcome: neutralOutcome({
      type: "guild.lifecycle_outcome.v1",
      disposition: "succeeded",
      assertions: [...assertions],
      binding: { ...bindingFor2(next, event), ...bindingOverride ?? {} },
      facts: { event_name: event.name, ...facts }
    })
  });
}
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function handlePromptSubmit(state, event) {
  if (event.input.semantic_intent !== "enter_phase") {
    return unchanged(state, event, { no_op: true }, ["core takes no lifecycle decision"]);
  }
  const phase = event.input.phase;
  if (!isNeutralLifecyclePhase(phase)) {
    return refuse(
      state,
      event,
      "unknown_phase",
      { requested_phase: phase },
      ["the prior state is preserved", "the phase matrix is closed"]
    );
  }
  return advance(
    state,
    event,
    { phase },
    { semantic_intent: "enter_phase", phase, lifecycle_decision: "phase_entered" },
    [
      "host pairs reach the same semantic phase state",
      "host pairs emit the same lifecycle decision code",
      "host-native fields are excluded from equivalence comparison"
    ]
  );
}
function handleToolBefore(state, event) {
  const suppliedVerdict = event.input.gate_condition;
  const gateId = asString(event.input.gate_id);
  if (state.admission_context === null) {
    return refuse(
      state,
      event,
      "admission_context_missing",
      {
        gate_id: gateId ?? null,
        supplied_gate_condition: suppliedVerdict ?? null,
        caller_supplied_verdict_ignored: suppliedVerdict !== void 0
      },
      [
        "a lifecycle admission decision requires a run-bound capability snapshot, policy, and gate",
        "a caller-supplied gate verdict is never trusted",
        "no tool side effect occurs"
      ]
    );
  }
  const context = state.admission_context;
  const evaluatedSnapshotHash = neutralAdmissionContextSnapshotHash(context);
  const gate = context.gates.find((candidate) => candidate.gate_id === gateId);
  if (gateId === void 0 || gate === void 0) {
    return refuse(
      state,
      event,
      "gate_unsatisfied",
      {
        gate_id: gateId ?? null,
        supplied_gate_condition: suppliedVerdict ?? null,
        caller_supplied_verdict_ignored: suppliedVerdict !== void 0,
        declared_gate_ids: context.gates.map((candidate) => candidate.gate_id)
      },
      [
        "an undeclared gate cannot be proven satisfied",
        "both hosts preserve the prior state",
        "no tool side effect occurs"
      ]
    );
  }
  const request = {
    operation_id: event.transition_id,
    operation: asString(event.input.operation) ?? "",
    required_capability: asString(event.input.required_capability) ?? "",
    operation_class: asString(event.input.operation_class) ?? gate.operation_class,
    satisfied_conditions: Array.isArray(event.input.satisfied_conditions) ? event.input.satisfied_conditions.filter(
      (value) => typeof value === "string"
    ) : [],
    approval_supplied: event.input.approval_supplied === true
  };
  const admission = evaluateNeutralAdmission({
    request,
    snapshot: context.snapshot,
    policy: context.policy,
    gate
  });
  const sharedFacts = {
    gate_id: gate.gate_id,
    operation: request.operation,
    operation_class: request.operation_class,
    caller_supplied_verdict_ignored: suppliedVerdict !== void 0,
    admission_outcome_type: admission.type,
    admission_disposition: admission.disposition,
    admission_reason_code: admission.reason_code,
    // Stated in the facts as well as the binding, so a receipt reader can see
    // WHICH snapshot produced the answer without trusting the binding merge.
    evaluated_capability_snapshot_hash: evaluatedSnapshotHash ?? null,
    run_bound_capability_snapshot_hash: state.capability_snapshot_hash
  };
  const evaluatedBinding = { capability_snapshot_hash: evaluatedSnapshotHash };
  if (admission.disposition !== "succeeded") {
    return neutralFreeze({
      state,
      state_changed: false,
      outcome: neutralOutcome({
        type: admission.type,
        disposition: admission.disposition,
        reason_code: admission.reason_code,
        assertions: [
          ...admission.assertions,
          "the outcome names the capability snapshot that was evaluated"
        ],
        // Order matters: `bindingFor` supplies the run/operation identity, and
        // `evaluatedBinding` then RE-asserts the evaluated snapshot hash so the
        // state's own field can never overwrite it (that overwrite was the
        // defect — the claimed hash won over the evaluated one).
        binding: { ...admission.binding, ...bindingFor2(state, event), ...evaluatedBinding },
        facts: {
          event_name: event.name,
          side_effect: false,
          ...admission.facts,
          ...sharedFacts
        }
      })
    });
  }
  return advance(
    state,
    event,
    { gate_outcomes: { ...state.gate_outcomes, [gate.gate_id]: "succeeded" } },
    { ...sharedFacts, lifecycle_decision: "gate_satisfied" },
    [
      "the gate produced a typed satisfied outcome",
      "capability, authentication, policy, approval, and gate were all decided by the core",
      "the outcome names the capability snapshot that was evaluated"
    ],
    evaluatedBinding
  );
}
function handleToolAfter(state, event) {
  const gateId = asString(event.input.gate_id);
  const status = asString(event.input.execution_status);
  if (gateId === void 0 || status === void 0) {
    return unchanged(state, event, { no_op: true }, [
      "no gate-bound execution result was supplied"
    ]);
  }
  if (state.gate_outcomes[gateId] === void 0) {
    return refuse(
      state,
      event,
      "required_gate_outcome_missing",
      { gate_id: gateId, execution_status: status },
      ["an execution result cannot be recorded for a gate that was never admitted"]
    );
  }
  if (status === "succeeded") {
    return advance(
      state,
      event,
      {},
      { gate_id: gateId, execution_status: status, lifecycle_decision: "execution_succeeded" },
      ["the admitted operation completed and the gate remains satisfied"]
    );
  }
  return neutralFreeze({
    state: neutralFreeze({
      ...state,
      gate_outcomes: { ...state.gate_outcomes, [gateId]: "failed" },
      applied_transitions: [...state.applied_transitions, event.transition_id]
    }),
    state_changed: true,
    outcome: neutralOutcome({
      type: "guild.lifecycle_outcome.v1",
      disposition: "failed",
      reason_code: "execution_failed",
      assertions: [
        "an execution failure is distinct from a refusal and from a success",
        "a failed execution downgrades its gate so it cannot back a clean close"
      ],
      binding: bindingFor2(state, event),
      facts: {
        event_name: event.name,
        gate_id: gateId,
        execution_status: status,
        lifecycle_decision: "execution_failed"
      }
    })
  });
}
function handleCheckpoint(state, event) {
  return advance(
    state,
    event,
    { checkpoint_sequence: state.checkpoint_sequence + 1 },
    {
      lifecycle_decision: event.name === "context.compact" ? "compacted" : "resumed",
      checkpoint_sequence: state.checkpoint_sequence + 1
    },
    [
      "run_id and capability snapshot hash are unchanged",
      "resume continues from the last durable lifecycle state",
      "already-applied transitions are not repeated"
    ]
  );
}
function resolveNotApplicableRule(state, observation, ruleId) {
  if (ruleId === null || ruleId.length === 0) return { reason: "not_applicable_rule_missing" };
  const rule = state.not_applicable_rules.find((candidate) => candidate.rule_id === ruleId);
  if (rule === void 0) return { reason: "not_applicable_rule_unknown" };
  if (rule.applies_to_observation !== observation) return { reason: "not_applicable_rule_mismatch" };
  return { rule };
}
function handleObservation(state, event) {
  const observation = asString(event.input.observation);
  const observationState = event.input.observation_state;
  if (observation === void 0) {
    return unchanged(state, event, { no_op: true }, ["no observation id was supplied"]);
  }
  if (!isNeutralObservationState(observationState)) {
    return refuse(
      state,
      event,
      "unknown_observation_state",
      { observation, observation_state: observationState ?? null },
      ["the observation vocabulary is closed"]
    );
  }
  const suppliedRuleId = asString(event.input.not_applicable_rule_id) ?? null;
  if (observationState === "not_applicable") {
    const resolved = resolveNotApplicableRule(state, observation, suppliedRuleId);
    if (resolved.reason !== void 0) {
      return refuse(
        state,
        event,
        resolved.reason,
        {
          observation,
          observation_state: observationState,
          supplied_not_applicable_rule_id: suppliedRuleId,
          declared_rule_ids: state.not_applicable_rules.map((rule) => rule.rule_id)
        },
        [
          "not_applicable asserts inapplicability under an explicit typed rule",
          "an unsubstantiated not_applicable is refused, not recorded"
        ]
      );
    }
    return advance(
      state,
      event,
      {
        observations: {
          ...state.observations,
          [observation]: { state: observationState, not_applicable_rule_id: suppliedRuleId }
        }
      },
      {
        observation,
        observation_state: observationState,
        not_applicable_rule_id: suppliedRuleId,
        not_applicable_rationale: resolved.rule?.rationale ?? null,
        lifecycle_decision: "observation_recorded"
      },
      [
        "the observation state is recorded as a lifecycle decision input",
        "the typed inapplicability rule is recorded with the operation"
      ]
    );
  }
  if (suppliedRuleId !== null) {
    return refuse(
      state,
      event,
      "not_applicable_rule_mismatch",
      {
        observation,
        observation_state: observationState,
        supplied_not_applicable_rule_id: suppliedRuleId
      },
      ["a not_applicable rule may only bind a not_applicable observation"]
    );
  }
  return advance(
    state,
    event,
    {
      observations: {
        ...state.observations,
        [observation]: { state: observationState, not_applicable_rule_id: null }
      }
    },
    { observation, observation_state: observationState, lifecycle_decision: "observation_recorded" },
    ["the observation state is recorded as a lifecycle decision input"]
  );
}
function handleRunStop(state, event) {
  const requested = event.input.requested_terminal_state ?? "completed";
  if (requested === "aborted") {
    return advance(
      state,
      event,
      { status: "aborted" },
      { terminal_state: "aborted", lifecycle_decision: "run_aborted" },
      ["an aborted run makes no completion claim"]
    );
  }
  if (requested !== "completed") {
    return refuse(
      state,
      event,
      "unknown_terminal_state",
      { requested_terminal_state: requested },
      ["the terminal-state vocabulary is closed"]
    );
  }
  const closeAssertions = [
    "both hosts reach the same terminal state",
    "completion is refused if any required observation is missing or failed",
    "terminal receipt is last in logical order"
  ];
  const missingObservations = state.required_observations.filter(
    (id) => state.observations[id] === void 0
  );
  if (missingObservations.length > 0) {
    return refuse(
      state,
      event,
      "required_observation_missing",
      { missing_observations: missingObservations, requested_terminal_state: "completed" },
      closeAssertions
    );
  }
  const failedObservations = state.required_observations.filter(
    (id) => !isNeutralCleanObservation(state.observations[id]?.state)
  );
  if (failedObservations.length > 0) {
    return refuse(
      state,
      event,
      "required_observation_failed",
      { failed_observations: failedObservations, requested_terminal_state: "completed" },
      closeAssertions
    );
  }
  const unruled = [];
  for (const id of state.required_observations) {
    const record = state.observations[id];
    if (record === void 0 || record.state !== "not_applicable") continue;
    const resolved = resolveNotApplicableRule(state, id, record.not_applicable_rule_id);
    if (resolved.reason !== void 0) {
      unruled.push({ observation: id, reason: resolved.reason, rule_id: record.not_applicable_rule_id });
    }
  }
  if (unruled.length > 0) {
    return refuse(
      state,
      event,
      unruled[0].reason,
      {
        unruled_not_applicable_observations: unruled,
        requested_terminal_state: "completed"
      },
      [
        ...closeAssertions,
        "every not_applicable observation resolves to a declared typed rule bound to that observation"
      ]
    );
  }
  const missingGateIds = state.required_gate_ids.filter(
    (id) => state.gate_outcomes[id] !== "succeeded"
  );
  if (missingGateIds.length > 0) {
    return refuse(
      state,
      event,
      "required_gate_outcome_missing",
      { missing_gate_ids: missingGateIds, requested_terminal_state: "completed" },
      closeAssertions
    );
  }
  return advance(
    state,
    event,
    { status: "completed" },
    {
      terminal_state: "completed",
      lifecycle_decision: "run_completed",
      gate_outcome_set_complete: true
    },
    closeAssertions
  );
}
function applyNeutralLifecycleEvent(state, event) {
  if (event.capability_snapshot_hash !== state.capability_snapshot_hash) {
    return refuse(
      state,
      event,
      "capability_snapshot_mismatch",
      {
        expected_capability_snapshot_hash: state.capability_snapshot_hash,
        observed_capability_snapshot_hash: event.capability_snapshot_hash
      },
      ["no capability snapshot mutation is permitted", "exactly one snapshot binds a run"]
    );
  }
  if (state.admission_context !== null) {
    const contextHash = neutralAdmissionContextSnapshotHash(state.admission_context);
    if (contextHash !== state.capability_snapshot_hash) {
      return refuse(
        state,
        event,
        "admission_context_snapshot_mismatch",
        {
          run_bound_capability_snapshot_hash: state.capability_snapshot_hash,
          admission_context_snapshot_hash: contextHash ?? null,
          side_effect: false
        },
        [
          "exactly one snapshot binds a run",
          "a decision is never evaluated against a snapshot the run is not bound to",
          "an outcome never names a capability snapshot that was not evaluated",
          "no tool side effect occurs"
        ]
      );
    }
  }
  if (!isNeutralEventName(event.name)) {
    const compatibility = mapLegacyNeutralEventName(event.name);
    return refuse(
      state,
      event,
      compatibility.reason_code ?? "unknown_event",
      {
        observed_event_name: event.name,
        ...compatibility.facts,
        compatibility_outcome_type: compatibility.type
      },
      [
        "the normalized event vocabulary is closed",
        "the event is not silently skipped",
        ...compatibility.assertions
      ]
    );
  }
  if (state.applied_transitions.indexOf(event.transition_id) !== -1) {
    return unchanged(state, event, { idempotent_replay: true }, [
      "already-applied transitions are not repeated"
    ]);
  }
  if (NEUTRAL_TERMINAL_RUN_STATUSES.indexOf(state.status) !== -1) {
    return refuse(
      state,
      event,
      "run_already_closed",
      { status: state.status },
      ["a terminal run accepts no further lifecycle transition"]
    );
  }
  switch (event.name) {
    case "prompt.submit":
      return handlePromptSubmit(state, event);
    case "tool.before":
      return handleToolBefore(state, event);
    case "tool.after":
      return handleToolAfter(state, event);
    case "context.compact":
    case "run.resume":
      return handleCheckpoint(state, event);
    case "receipt.append":
      return handleObservation(state, event);
    case "run.stop":
      return handleRunStop(state, event);
    default:
      return unchanged(state, event, { no_op: true }, ["core takes no lifecycle decision"]);
  }
}
var NEUTRAL_RUN_STATUSES, NEUTRAL_TERMINAL_RUN_STATUSES;
var init_neutral_lifecycle_machine = __esm({
  "../src/modules/lifecycle/workflows/neutral-lifecycle-machine.ts"() {
    init_neutral_runtime_contracts();
    init_neutral_gate_policy();
    NEUTRAL_RUN_STATUSES = Object.freeze(["open", "completed", "aborted"]);
    NEUTRAL_TERMINAL_RUN_STATUSES = Object.freeze(["completed", "aborted"]);
  }
});

// ../src/modules/lifecycle/workflows/neutral-conformance-core.ts
function applyNeutralSupportTransition(record, operation, result) {
  const rule = NEUTRAL_SUPPORT_TRANSITIONS.find((candidate) => candidate.operation === operation);
  if (rule === void 0) {
    throw new Error(`applyNeutralSupportTransition: unknown support operation ${JSON.stringify(operation)}`);
  }
  const unmet = rule.requires.filter((requirement) => {
    const [state, status] = requirement.split(":");
    return record[state] !== status;
  });
  if (unmet.length > 0) {
    return {
      record,
      outcome: neutralOutcome({
        type: "guild.support_transition_outcome.v1",
        disposition: "refused",
        reason_code: "support_precondition_unproven",
        assertions: ["an unproven precondition cannot promote the next dimension"],
        facts: { operation, unmet_requirements: unmet, may_satisfy: rule.may_satisfy }
      })
    };
  }
  const next = { ...record };
  next[rule.may_satisfy] = result.satisfied ? "satisfied" : "failed";
  if (result.satisfied) {
    for (const reset of rule.resets) next[reset] = "not_evaluated";
  }
  const frozen = neutralFreeze(next);
  return {
    record: frozen,
    outcome: result.satisfied ? neutralOutcome({
      type: "guild.support_transition_outcome.v1",
      disposition: "succeeded",
      assertions: [
        `${rule.may_satisfy} is proven for this operation only`,
        "no later dimension is implied"
      ],
      facts: { operation, satisfied: rule.may_satisfy, reset: [...rule.resets] }
    }) : neutralOutcome({
      type: "guild.support_transition_outcome.v1",
      disposition: "failed",
      reason_code: "support_operation_failed",
      assertions: ["a failed operation records failure and promotes nothing"],
      facts: { operation, failed: rule.may_satisfy }
    })
  };
}
function deriveNeutralSupportClaim(record) {
  for (const state of NEUTRAL_SUPPORT_STATES) {
    if (!isNeutralSupportStatus(record[state])) {
      throw new Error(
        `deriveNeutralSupportClaim: ${state} has invalid status ${JSON.stringify(record[state])}`
      );
    }
  }
  const proven = NEUTRAL_SUPPORT_STATES.filter((state) => record[state] === "satisfied");
  const unproven = NEUTRAL_SUPPORT_STATES.filter((state) => record[state] !== "satisfied");
  return neutralFreeze({
    states: { ...record },
    collapsed: false,
    proven: [...proven],
    unproven: [...unproven]
  });
}
function identityComplete(identity) {
  if (identity === void 0 || identity === null || typeof identity !== "object") return false;
  if (typeof identity.contract_version !== "number") return false;
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    if (field === "contract_version") continue;
    const value = identity[field];
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}
function sameIdentity(a, b) {
  return NEUTRAL_EVIDENCE_IDENTITY_FIELDS.every(
    (field) => a[field] === b[field]
  );
}
function differingIdentityFields(a, b) {
  return NEUTRAL_EVIDENCE_IDENTITY_FIELDS.filter(
    (field) => a[field] !== b[field]
  );
}
function isNeutralRecognizedRuntimeVersion(value) {
  if (typeof value !== "string" || !NEUTRAL_RUNTIME_VERSION_PATTERN.test(value)) return false;
  const major = NEUTRAL_RUNTIME_VERSION_PATTERN.exec(value);
  return major !== null && major[1] === `${NEUTRAL_RECOGNIZED_RUNTIME_MAJOR}`;
}
function unrecognizedNeutralIdentityFields(identity) {
  const offenders = [];
  const note = (field) => {
    offenders.push({ field, value: identity[field] ?? null });
  };
  if (!NEUTRAL_SOURCE_COMMIT_PATTERN.test(identity.source_commit)) note("source_commit");
  if (!NEUTRAL_PACKAGE_HASH_PATTERN.test(identity.package_hash)) note("package_hash");
  const adapter = NEUTRAL_ADAPTER_VERSION_PATTERN.exec(identity.adapter_version ?? "");
  if (adapter === null || adapter[1] !== `${NEUTRAL_RECOGNIZED_ADAPTER_MAJOR}`) note("adapter_version");
  if (NEUTRAL_RECOGNIZED_PLATFORMS.indexOf(identity.platform) === -1) note("platform");
  if (!NEUTRAL_RELEASE_ID_PATTERN.test(identity.release_id)) note("release_id");
  if (identity.scenario_suite_id !== NEUTRAL_SCENARIO_SUITE_ID) note("scenario_suite_id");
  if (identity.scenario_suite_version !== NEUTRAL_SCENARIO_SUITE_VERSION) {
    note("scenario_suite_version");
  }
  return offenders;
}
function unrecognizedNeutralHostFields(identity) {
  const offenders = [];
  if (NEUTRAL_RECOGNIZED_HOST_IDS.indexOf(identity.host_id) === -1) {
    offenders.push({ field: "host_id", value: identity.host_id ?? null });
  }
  if (!NEUTRAL_SEMVER_PATTERN.test(identity.host_version)) {
    offenders.push({ field: "host_version", value: identity.host_version ?? null });
  }
  return offenders;
}
function neutralJournalGenesis(authority) {
  const canonical = {
    schema: NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA,
    anchor: "journal_genesis",
    journal: authority.receipt_journal_id,
    first_sequence: authority.receipt_sequence_range?.first ?? null
  };
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    canonical[field] = authority.identity[field] ?? null;
  }
  return `nec1:${neutralFingerprint(canonical).slice("nfp1:".length)}`;
}
function neutralJournalEntryCommitment(authority, previous, entry) {
  const canonical = {
    schema: NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA,
    anchor: "journal_entry",
    journal: authority.receipt_journal_id,
    previous,
    sequence: entry.sequence,
    scenario_id: entry.scenario_id,
    outcome_type: entry.outcome_type,
    disposition: entry.disposition,
    reason_code: entry.reason_code ?? null
  };
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    canonical[field] = authority.identity[field] ?? null;
  }
  return `nec1:${neutralFingerprint(canonical).slice("nfp1:".length)}`;
}
function neutralAttestationDigest(authority, attestation) {
  const canonical = {
    schema: NEUTRAL_ATTESTATION_REF_SCHEMA,
    attestor: attestation.attestor_id,
    journal: authority.receipt_journal_id,
    root: attestation.attested_journal_root,
    entry_count: attestation.attested_entry_count,
    first_sequence: authority.receipt_sequence_range?.first ?? null,
    last_sequence: authority.receipt_sequence_range?.last ?? null
  };
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    canonical[field] = authority.identity[field] ?? null;
  }
  return `nad1:${neutralCanonicalDigest(canonical)}`;
}
function neutralAttestationReference(authority, attestation) {
  return `${NEUTRAL_ATTESTATION_REF_SCHEMA}:${attestation.attestor_id}@${neutralAttestationDigest(authority, attestation)}`;
}
function neutralAttestorVerificationKey(attestorId) {
  const pinned = NEUTRAL_ATTESTOR_TRUST_ROOT.find((key) => key.attestor_id === attestorId);
  return pinned === void 0 ? null : pinned.verification_root;
}
function chainStep(value, chain, step) {
  return neutralSha256Hex(
    `${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|F|${chain}|${step}|${value}`
  );
}
function chainTo(value, chain, step) {
  let current = value;
  for (let at = step; at < NEUTRAL_ATTESTATION_CHAIN_LENGTH - 1; at += 1) {
    current = chainStep(current, chain, at);
  }
  return current;
}
function codeWord(message) {
  if (message.length !== NEUTRAL_ATTESTATION_MESSAGE_CHAINS) return null;
  const symbols = [];
  let checksum = 0;
  for (let index = 0; index < message.length; index += 1) {
    const symbol = NEUTRAL_HEX_ALPHABET.indexOf(message.charAt(index));
    if (symbol === -1) return null;
    symbols.push(symbol);
    checksum += NEUTRAL_ATTESTATION_CHAIN_LENGTH - 1 - symbol;
  }
  for (let index = NEUTRAL_ATTESTATION_CHECKSUM_CHAINS - 1; index >= 0; index -= 1) {
    const shift = Math.pow(NEUTRAL_ATTESTATION_CHAIN_LENGTH, index);
    symbols.push(Math.floor(checksum / shift) % NEUTRAL_ATTESTATION_CHAIN_LENGTH);
  }
  return symbols;
}
function hexWords(value, count) {
  const words = [];
  for (let index = 0; index < count; index += 1) {
    words.push(value.slice(index * 64, index * 64 + 64));
  }
  return words;
}
function neutralVerifyAttestationSignature(verificationRoot, digest, signature) {
  if (typeof verificationRoot !== "string") return false;
  if (!NEUTRAL_SHA256_HEX_PATTERN.test(verificationRoot)) return false;
  if (typeof digest !== "string" || typeof signature !== "string") return false;
  const parsed = NEUTRAL_ATTESTATION_SIGNATURE_PATTERN.exec(signature);
  if (parsed === null) return false;
  const keyIndex = parseInt(parsed[1], 16);
  const chains = hexWords(parsed[2], NEUTRAL_ATTESTATION_CHAINS);
  const authPath = hexWords(parsed[3], NEUTRAL_ATTESTATION_TREE_HEIGHT);
  if (!Number.isInteger(keyIndex) || keyIndex < 0) return false;
  if (keyIndex >= Math.pow(2, NEUTRAL_ATTESTATION_TREE_HEIGHT)) return false;
  const symbols = codeWord(
    neutralSha256Hex(
      `${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|M|${verificationRoot}|${keyIndex}|${digest}`
    )
  );
  if (symbols === null || symbols.length !== NEUTRAL_ATTESTATION_CHAINS) return false;
  const tips = [];
  for (let index = 0; index < NEUTRAL_ATTESTATION_CHAINS; index += 1) {
    tips.push(chainTo(chains[index], index, symbols[index]));
  }
  const oneTimeKey = neutralSha256Hex(
    `${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|PK|${tips.join("|")}`
  );
  let node = neutralSha256Hex(
    `${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|LEAF|${keyIndex}|${oneTimeKey}`
  );
  for (let level = 0; level < NEUTRAL_ATTESTATION_TREE_HEIGHT; level += 1) {
    const sibling = authPath[level];
    const onTheLeft = Math.floor(keyIndex / Math.pow(2, level)) % 2 === 0;
    const left = onTheLeft ? node : sibling;
    const right = onTheLeft ? sibling : node;
    node = neutralSha256Hex(`${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|NODE|${level}|${left}|${right}`);
  }
  return node === verificationRoot;
}
function neutralAttestationVerifies(authority, attestation) {
  const publicKey = neutralAttestorVerificationKey(attestation?.attestor_id);
  if (publicKey === null) return false;
  return neutralVerifyAttestationSignature(
    publicKey,
    neutralAttestationDigest(authority, attestation),
    attestation?.attestation_signature
  );
}
function isCommitmentShaped(value) {
  return typeof value === "string" && NEUTRAL_COMMITMENT_PATTERN.test(value);
}
function entryWellFormed(entry) {
  if (entry === void 0 || entry === null || typeof entry !== "object") return false;
  if (typeof entry.sequence !== "number" || !Number.isInteger(entry.sequence)) return false;
  if (typeof entry.scenario_id !== "string" || entry.scenario_id.length === 0) return false;
  if (!isNeutralOutcomeType(entry.outcome_type)) return false;
  if (!isNeutralDisposition(entry.disposition)) return false;
  if (entry.reason_code !== null && typeof entry.reason_code !== "string") return false;
  return isCommitmentShaped(entry.entry_commitment) && isCommitmentShaped(entry.previous_commitment);
}
function attestationWellFormed(attestation) {
  if (attestation === void 0 || attestation === null || typeof attestation !== "object") return false;
  if (typeof attestation.attestor_id !== "string") return false;
  if (!isCommitmentShaped(attestation.attested_journal_root)) return false;
  if (typeof attestation.attested_entry_count !== "number" || !Number.isInteger(attestation.attested_entry_count)) {
    return false;
  }
  if (typeof attestation.attestation_signature !== "string" || !NEUTRAL_ATTESTATION_SIGNATURE_PATTERN.test(attestation.attestation_signature)) {
    return false;
  }
  return typeof attestation.attestation_ref === "string" && NEUTRAL_ATTESTATION_REF_PATTERN.test(attestation.attestation_ref);
}
function authorityWellFormed(authority) {
  if (authority === void 0 || authority === null || typeof authority !== "object") return false;
  if (authority.schema_version !== NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA) return false;
  if (!identityComplete(authority.identity)) return false;
  if (typeof authority.receipt_journal_id !== "string" || !NEUTRAL_JOURNAL_ID_PATTERN.test(authority.receipt_journal_id)) {
    return false;
  }
  const range = authority.receipt_sequence_range;
  if (range === void 0 || range === null || typeof range !== "object") return false;
  if (typeof range.first !== "number" || typeof range.last !== "number") return false;
  if (!Number.isInteger(range.first) || !Number.isInteger(range.last)) return false;
  if (range.first < 0 || range.last < range.first) return false;
  const entries = authority.observed_entries;
  if (!Array.isArray(entries) || entries.length === 0) return false;
  if (!entries.every((entry) => entryWellFormed(entry))) return false;
  const attestations = authority.attestations;
  if (!Array.isArray(attestations) || attestations.length === 0) return false;
  return attestations.every((attestation) => attestationWellFormed(attestation));
}
function refuseConformance(reason, assertions, facts) {
  return neutralOutcome({
    type: "guild.support_transition_outcome.v1",
    disposition: "refused",
    reason_code: reason,
    assertions: [...assertions],
    facts: { ...facts, may_promote_conformant: false }
  });
}
function evaluateNeutralConformanceDecision(evidence, authority) {
  const scenarios = NEUTRAL_CORE_SCENARIOS;
  const required = evidence?.required_scenario_ids ?? [];
  const results = evidence?.results ?? [];
  const expectedRequired = NEUTRAL_REQUIRED_CORE_SCENARIO_IDS;
  const baseFacts = {
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    submitted_suite_id: evidence?.suite_id ?? null,
    submitted_suite_version: evidence?.suite_version ?? null,
    required_count: required.length,
    result_count: results.length
  };
  if (!authorityWellFormed(authority)) {
    return refuseConformance(
      "scenario_evidence_authority_missing",
      [
        "a promotion decision is verified against an authoritative input the claimant does not author",
        "a bundle that agrees only with itself proves consistency, never conformance",
        `an authority declares ${NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA}, one complete identity, one journal id, and one observed sequence range`
      ],
      { ...baseFacts, submitted_authority_schema: authority?.schema_version ?? null }
    );
  }
  const authorityUnrecognized = unrecognizedNeutralIdentityFields(authority.identity);
  if (authorityUnrecognized.length > 0) {
    return refuseConformance(
      "scenario_source_identity_unrecognized",
      [
        "the authoritative identity must name a source revision, package digest, adapter, platform, and suite the core recognizes",
        "a label the core cannot recognize cannot be the exact identity the frozen support_claim rule binds to"
      ],
      { ...baseFacts, scope: "authority", unrecognized_identity_fields: authorityUnrecognized }
    );
  }
  const authorityHostUnrecognized = unrecognizedNeutralHostFields(authority.identity);
  if (authorityHostUnrecognized.length > 0) {
    return refuseConformance(
      "scenario_host_identity_unrecognized",
      [
        "a conformance claim names a host identity the core recognizes and a real host version",
        "an unrecognized host cannot be the exact host the claim is bound to"
      ],
      {
        ...baseFacts,
        scope: "authority",
        recognized_host_ids: [...NEUTRAL_RECOGNIZED_HOST_IDS],
        unrecognized_host_fields: authorityHostUnrecognized
      }
    );
  }
  if (authority.identity.contract_version !== NEUTRAL_CONTRACT_VERSION) {
    return refuseConformance(
      "scenario_contract_version_unrecognized",
      [
        `a conformance claim binds to contract version ${NEUTRAL_CONTRACT_VERSION}, the one this core implements`,
        "a consumer pinned to a different contract major refuses rather than downgrades"
      ],
      {
        ...baseFacts,
        scope: "authority",
        recognized_contract_version: NEUTRAL_CONTRACT_VERSION,
        unrecognized_contract_versions: [
          { scope: "authority", contract_version: authority.identity.contract_version ?? null }
        ]
      }
    );
  }
  if (!isNeutralRecognizedRuntimeVersion(authority.identity.runtime_version)) {
    return refuseConformance(
      "scenario_runtime_version_unrecognized",
      [
        "a conformance claim names a runtime identity the core recognizes",
        `the core recognizes runtime major ${NEUTRAL_RECOGNIZED_RUNTIME_MAJOR}; a parseable version from an unknown major is not recognized`
      ],
      {
        ...baseFacts,
        scope: "authority",
        recognized_runtime_major: NEUTRAL_RECOGNIZED_RUNTIME_MAJOR,
        unrecognized_runtime_versions: [
          { scope: "authority", runtime_version: authority.identity.runtime_version ?? null }
        ]
      }
    );
  }
  const entries = authority.observed_entries;
  const range = authority.receipt_sequence_range;
  const expectedEntryCount = range.last - range.first + 1;
  const coverageFaults = [];
  if (entries.length !== expectedEntryCount) {
    coverageFaults.push({
      reason: "entry_count_does_not_cover_range",
      expected_entry_count: expectedEntryCount,
      observed_entry_count: entries.length
    });
  }
  for (let index = 0; index < entries.length; index += 1) {
    const expectedSequence = range.first + index;
    if (entries[index].sequence !== expectedSequence) {
      coverageFaults.push({
        reason: "sequence_gap_or_reorder",
        position: index,
        expected_sequence: expectedSequence,
        observed_sequence: entries[index].sequence
      });
    }
  }
  let previousCommitment = neutralJournalGenesis(authority);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.previous_commitment !== previousCommitment) {
      coverageFaults.push({
        reason: "chain_link_broken",
        position: index,
        sequence: entry.sequence,
        expected_previous_commitment: previousCommitment,
        observed_previous_commitment: entry.previous_commitment
      });
      break;
    }
    const expectedCommitment = neutralJournalEntryCommitment(authority, previousCommitment, entry);
    if (entry.entry_commitment !== expectedCommitment) {
      coverageFaults.push({
        reason: "entry_commitment_mismatch",
        position: index,
        sequence: entry.sequence,
        expected_entry_commitment: expectedCommitment,
        observed_entry_commitment: entry.entry_commitment
      });
      break;
    }
    previousCommitment = entry.entry_commitment;
  }
  if (coverageFaults.length > 0) {
    return refuseConformance(
      "scenario_journal_chain_unverified",
      [
        "an authority carries the journal entries it observed, contiguously covering the range it declares",
        "each entry commits to its predecessor, so an entry cannot be inserted, removed, re-ordered, or edited in isolation",
        "a named range with no verifiable entries in it is a claim about a journal, never a journal"
      ],
      {
        ...baseFacts,
        authority_journal_id: authority.receipt_journal_id,
        authority_sequence_range: range,
        journal_genesis: neutralJournalGenesis(authority),
        journal_chain_faults: coverageFaults
      }
    );
  }
  const journalRoot = previousCommitment;
  const attestationFaults = [];
  const acceptedAttestors = [];
  for (const attestation of authority.attestations) {
    if (NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS.indexOf(attestation.attestor_id) === -1) {
      attestationFaults.push({ attestor_id: attestation.attestor_id, reason: "attestor_unrecognized" });
      continue;
    }
    if (acceptedAttestors.indexOf(attestation.attestor_id) !== -1) {
      attestationFaults.push({ attestor_id: attestation.attestor_id, reason: "duplicate_attestor" });
      continue;
    }
    if (attestation.attested_journal_root !== journalRoot) {
      attestationFaults.push({
        attestor_id: attestation.attestor_id,
        reason: "attested_root_mismatch",
        expected_journal_root: journalRoot,
        attested_journal_root: attestation.attested_journal_root
      });
      continue;
    }
    if (attestation.attested_entry_count !== entries.length) {
      attestationFaults.push({
        attestor_id: attestation.attestor_id,
        reason: "attested_entry_count_mismatch",
        expected_entry_count: entries.length,
        attested_entry_count: attestation.attested_entry_count
      });
      continue;
    }
    const expectedRef = neutralAttestationReference(authority, attestation);
    if (attestation.attestation_ref !== expectedRef) {
      attestationFaults.push({
        attestor_id: attestation.attestor_id,
        reason: "attestation_reference_unbound",
        expected_attestation_ref: expectedRef,
        submitted_attestation_ref: attestation.attestation_ref
      });
      continue;
    }
    acceptedAttestors.push(attestation.attestor_id);
  }
  if (acceptedAttestors.length < NEUTRAL_MINIMUM_ATTESTOR_QUORUM) {
    return refuseConformance(
      "scenario_journal_attestation_insufficient",
      [
        `a journal root is admitted only on a quorum of ${NEUTRAL_MINIMUM_ATTESTOR_QUORUM} distinct recognized attestors`,
        "an attestation binds one attestor to one root, entry count, range, and identity, so it cannot be moved between journals or releases",
        "an unrecognized, duplicated, or unbound attestation counts for nothing"
      ],
      {
        ...baseFacts,
        required_attestor_quorum: NEUTRAL_MINIMUM_ATTESTOR_QUORUM,
        recognized_journal_attestors: [...NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS],
        journal_root: journalRoot,
        accepted_attestors: acceptedAttestors,
        attestation_faults: attestationFaults
      }
    );
  }
  const claimantId = evidence?.claimant_id;
  const claimantNamed = typeof claimantId === "string" && NEUTRAL_CLAIMANT_ID_PATTERN.test(claimantId);
  const claimantIsAttestor = claimantNamed && (authority.attestations.some((attestation) => attestation.attestor_id === claimantId) || NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS.indexOf(claimantId) !== -1);
  if (!claimantNamed || claimantIsAttestor) {
    return refuseConformance(
      "scenario_claimant_not_independent",
      [
        "the party asking to be promoted must name itself",
        "the claimant may not be one of the attestors of the journal it is judged against",
        "an anonymous claim cannot be checked for independence at all"
      ],
      {
        ...baseFacts,
        submitted_claimant_id: claimantId ?? null,
        attesting_parties: authority.attestations.map((attestation) => attestation.attestor_id),
        claimant_is_attestor: claimantIsAttestor
      }
    );
  }
  if (evidence?.suite_id !== NEUTRAL_SCENARIO_SUITE_ID || evidence?.suite_version !== NEUTRAL_SCENARIO_SUITE_VERSION) {
    return refuseConformance(
      "scenario_suite_version_mismatch",
      [
        "a conformance claim is bound to one exact suite id and version",
        "a claim against an unpinned suite proves nothing"
      ],
      baseFacts
    );
  }
  const missingRequired = expectedRequired.filter((id) => required.indexOf(id) === -1);
  const extraRequired = required.filter((id) => expectedRequired.indexOf(id) === -1);
  const tupleMisordered = required.length === expectedRequired.length && missingRequired.length === 0 && extraRequired.length === 0 && expectedRequired.some((id, index) => required[index] !== id);
  if (required.length !== expectedRequired.length || missingRequired.length > 0 || extraRequired.length > 0 || tupleMisordered) {
    return refuseConformance(
      "scenario_required_set_mismatch",
      [
        "the required scenario tuple is declared by the core for this suite version",
        "an empty, narrowed, inflated, or re-ordered required tuple cannot back a conformance claim"
      ],
      {
        ...baseFacts,
        declared_required_scenario_ids: [...expectedRequired],
        submitted_required_scenario_ids: [...required],
        omitted_required_scenarios: missingRequired,
        undeclared_scenarios: extraRequired,
        tuple_misordered: tupleMisordered
      }
    );
  }
  if (results.length !== required.length) {
    return refuseConformance(
      "scenario_evidence_incomplete",
      [
        "every required scenario needs exactly one result",
        "absence of evidence is never success"
      ],
      { ...baseFacts, declared_required_scenario_ids: [...expectedRequired] }
    );
  }
  const outOfOrder = required.map((id, index) => ({ index, expected: id, observed: results[index]?.stable_id ?? null })).filter((entry) => entry.expected !== entry.observed);
  if (outOfOrder.length > 0) {
    return refuseConformance(
      "scenario_results_unordered",
      [
        "ordered results are what makes a result attributable to its scenario",
        "an unordered result set cannot be attributed"
      ],
      { ...baseFacts, out_of_order: outOfOrder }
    );
  }
  const untyped = [];
  const invented = [];
  const receiptless = [];
  for (const result of results) {
    const typedOk = isNeutralOutcomeType(result.outcome_type) && isNeutralDisposition(result.disposition) && (result.disposition === "succeeded" ? result.reason_code === null || result.reason_code === void 0 : typeof result.reason_code === "string" && result.reason_code.length > 0);
    if (!typedOk) {
      untyped.push({
        stable_id: result.stable_id,
        outcome_type: result.outcome_type ?? null,
        disposition: result.disposition ?? null,
        reason_code: result.reason_code ?? null
      });
      continue;
    }
    if (result.disposition !== "succeeded" && !isNeutralReasonCode(result.reason_code)) {
      invented.push({ stable_id: result.stable_id, reason_code: result.reason_code ?? null });
    }
    if (typeof result.receipt_ref !== "string" || !NEUTRAL_RECEIPT_REF_PATTERN.test(result.receipt_ref)) {
      receiptless.push({
        stable_id: result.stable_id,
        receipt_ref: result.receipt_ref ?? null
      });
    }
  }
  if (untyped.length > 0) {
    return refuseConformance(
      "scenario_evidence_incomplete",
      [
        "a scenario result is a typed outcome, not a bare disposition string",
        "a succeeded result carries no reason code and a non-succeeded result must carry one"
      ],
      { ...baseFacts, untyped_results: untyped }
    );
  }
  if (invented.length > 0) {
    return refuseConformance(
      "scenario_reason_code_unrecognized",
      [
        "every non-succeeded result names one reason code from the closed vocabulary",
        "an invented reason code cannot be compared across hosts and proves nothing"
      ],
      { ...baseFacts, unrecognized_reason_codes: invented }
    );
  }
  const mistyped = results.map((result) => {
    const definition = scenarios.find((scenario) => scenario.stable_id === result.stable_id);
    return {
      stable_id: result.stable_id,
      expected_outcome_type: definition?.expected_typed_outcome.type ?? null,
      observed_outcome_type: result.outcome_type
    };
  }).filter((entry) => entry.expected_outcome_type !== entry.observed_outcome_type);
  if (mistyped.length > 0) {
    return neutralOutcome({
      type: "guild.support_transition_outcome.v1",
      disposition: "failed",
      reason_code: "scenario_result_mismatch",
      assertions: [
        "each result carries the typed outcome envelope its scenario declares",
        "a closed but wrong outcome type is not the scenario's expected outcome"
      ],
      facts: { ...baseFacts, mistyped_scenarios: mistyped, may_promote_conformant: false }
    });
  }
  if (receiptless.length > 0) {
    return refuseConformance(
      "scenario_receipt_reference_missing",
      [
        "every scenario result cites the receipt that records it",
        `a receipt reference has the canonical form ${NEUTRAL_RECEIPT_REF_SCHEMA}:<journal>#<sequence>`,
        "a result whose receipt reference resolves to nothing is unverifiable"
      ],
      { ...baseFacts, results_without_receipt_reference: receiptless }
    );
  }
  const duplicateReceipts = results.map((result, index) => ({ stable_id: result.stable_id, receipt_ref: result.receipt_ref, index })).filter(
    (entry) => results.findIndex((other) => other.receipt_ref === entry.receipt_ref) !== entry.index
  ).map((entry) => ({ stable_id: entry.stable_id, receipt_ref: entry.receipt_ref }));
  if (duplicateReceipts.length > 0) {
    return refuseConformance(
      "scenario_receipt_reference_ambiguous",
      [
        "each scenario result cites its own receipt entry",
        "one receipt entry cited by two scenarios attributes neither"
      ],
      { ...baseFacts, duplicate_receipt_references: duplicateReceipts }
    );
  }
  const activatedContractVersion = evidence.activated_runtime?.contract_version;
  const contractOffenders = [
    ...activatedContractVersion === NEUTRAL_CONTRACT_VERSION ? [] : [{ scope: "activated_runtime", contract_version: activatedContractVersion ?? null }],
    ...results.filter((result) => result.evidence_identity?.contract_version !== NEUTRAL_CONTRACT_VERSION).map((result) => ({
      scope: result.stable_id,
      contract_version: result.evidence_identity?.contract_version ?? null
    }))
  ];
  if (contractOffenders.length > 0) {
    return refuseConformance(
      "scenario_contract_version_unrecognized",
      [
        `a conformance claim binds to contract version ${NEUTRAL_CONTRACT_VERSION}, the one this core implements`,
        "a consumer pinned to a different contract major refuses rather than downgrades"
      ],
      {
        ...baseFacts,
        recognized_contract_version: NEUTRAL_CONTRACT_VERSION,
        unrecognized_contract_versions: contractOffenders
      }
    );
  }
  const runtimeOffenders = [
    ...isNeutralRecognizedRuntimeVersion(evidence.activated_runtime?.runtime_version) ? [] : [
      {
        scope: "activated_runtime",
        runtime_version: evidence.activated_runtime?.runtime_version ?? null
      }
    ],
    ...results.filter((result) => !isNeutralRecognizedRuntimeVersion(result.evidence_identity?.runtime_version)).map((result) => ({
      scope: result.stable_id,
      runtime_version: result.evidence_identity?.runtime_version ?? null
    }))
  ];
  if (runtimeOffenders.length > 0) {
    return refuseConformance(
      "scenario_runtime_version_unrecognized",
      [
        "a conformance claim names a runtime identity the core recognizes",
        `the core recognizes runtime major ${NEUTRAL_RECOGNIZED_RUNTIME_MAJOR}; a parseable version from an unknown major is not recognized`
      ],
      {
        ...baseFacts,
        recognized_runtime_major: NEUTRAL_RECOGNIZED_RUNTIME_MAJOR,
        unrecognized_runtime_versions: runtimeOffenders
      }
    );
  }
  const incomplete = [
    ...identityComplete(evidence.activated_runtime) ? [] : ["activated_runtime"],
    ...results.filter((result) => !identityComplete(result.evidence_identity)).map((result) => result.stable_id)
  ];
  if (incomplete.length > 0) {
    return refuseConformance(
      "scenario_runtime_binding_mismatch",
      [
        "a conformance claim names the exact source, package, runtime, adapter, host, platform, contract, and scenario-suite identity",
        "an incomplete identity cannot be compared, and an absent field is never a satisfied one"
      ],
      {
        ...baseFacts,
        required_identity_fields: [...NEUTRAL_EVIDENCE_IDENTITY_FIELDS],
        incomplete_identities: incomplete,
        activated_runtime: evidence.activated_runtime ?? null
      }
    );
  }
  const unrecognizedIdentity = [
    ...unrecognizedNeutralIdentityFields(evidence.activated_runtime).map((entry) => ({
      scope: "activated_runtime",
      ...entry
    })),
    ...results.flatMap(
      (result) => unrecognizedNeutralIdentityFields(result.evidence_identity).map((entry) => ({
        scope: result.stable_id,
        ...entry
      }))
    )
  ];
  if (unrecognizedIdentity.length > 0) {
    return refuseConformance(
      "scenario_source_identity_unrecognized",
      [
        "source and package identities must name one immutable artifact, not a label",
        "adapter, platform, and scenario-suite identities must be ones the core recognizes"
      ],
      { ...baseFacts, unrecognized_identity_fields: unrecognizedIdentity }
    );
  }
  const unrecognizedHost = [
    ...unrecognizedNeutralHostFields(evidence.activated_runtime).map((entry) => ({
      scope: "activated_runtime",
      ...entry
    })),
    ...results.flatMap(
      (result) => unrecognizedNeutralHostFields(result.evidence_identity).map((entry) => ({
        scope: result.stable_id,
        ...entry
      }))
    )
  ];
  if (unrecognizedHost.length > 0) {
    return refuseConformance(
      "scenario_host_identity_unrecognized",
      [
        "a conformance claim names a host identity the core recognizes and a real host version",
        "an unrecognized host cannot be the exact host the claim is bound to"
      ],
      {
        ...baseFacts,
        recognized_host_ids: [...NEUTRAL_RECOGNIZED_HOST_IDS],
        unrecognized_host_fields: unrecognizedHost
      }
    );
  }
  const bundleDrift = differingIdentityFields(evidence.activated_runtime, authority.identity);
  if (bundleDrift.length > 0) {
    return refuseConformance(
      "scenario_identity_binding_mismatch",
      [
        "the claimed activated identity must equal the identity the verifier observed",
        "a self-asserted identity is not evidence of the release it names"
      ],
      {
        ...baseFacts,
        authority_identity: authority.identity,
        claimed_identity: evidence.activated_runtime,
        differing_identity_fields: [...bundleDrift]
      }
    );
  }
  const misbound = results.filter((result) => !sameIdentity(result.evidence_identity, authority.identity)).map((result) => ({
    stable_id: result.stable_id,
    differing_identity_fields: [
      ...differingIdentityFields(result.evidence_identity, authority.identity)
    ]
  }));
  if (misbound.length > 0) {
    return refuseConformance(
      "scenario_identity_binding_mismatch",
      [
        "every result must have been produced under the exact authoritative identity",
        "evidence from another source revision, package, release, or runtime cannot be reused"
      ],
      { ...baseFacts, authority_identity: authority.identity, misbound_results: misbound }
    );
  }
  const unbound = [];
  let previousSequence = -1;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const parsed = NEUTRAL_RECEIPT_REF_PATTERN.exec(result.receipt_ref);
    if (parsed === null) {
      unbound.push({ stable_id: result.stable_id, reason: "unparseable_reference" });
      continue;
    }
    const journal = parsed[1];
    const sequence = parseInt(parsed[2], 10);
    const commitment = parsed[3];
    if (journal !== authority.receipt_journal_id) {
      unbound.push({ stable_id: result.stable_id, reason: "foreign_journal", journal });
      continue;
    }
    if (sequence < authority.receipt_sequence_range.first || sequence > authority.receipt_sequence_range.last) {
      unbound.push({ stable_id: result.stable_id, reason: "sequence_outside_observed_range", sequence });
      continue;
    }
    if (sequence <= previousSequence) {
      unbound.push({ stable_id: result.stable_id, reason: "sequence_not_increasing", sequence });
      continue;
    }
    previousSequence = sequence;
    const entry = entries.find((candidate) => candidate.sequence === sequence);
    if (entry === void 0) {
      unbound.push({ stable_id: result.stable_id, reason: "no_journal_entry_at_sequence", sequence });
      continue;
    }
    if (commitment !== entry.entry_commitment) {
      unbound.push({
        stable_id: result.stable_id,
        reason: "commitment_is_not_the_journal_entry_commitment",
        submitted_commitment: commitment,
        journal_entry_commitment: entry.entry_commitment
      });
      continue;
    }
    const recorded = [];
    if (entry.scenario_id !== result.stable_id) {
      recorded.push({ field: "scenario_id", journal: entry.scenario_id, claimed: result.stable_id });
    }
    if (entry.outcome_type !== result.outcome_type) {
      recorded.push({ field: "outcome_type", journal: entry.outcome_type, claimed: result.outcome_type });
    }
    if (entry.disposition !== result.disposition) {
      recorded.push({ field: "disposition", journal: entry.disposition, claimed: result.disposition });
    }
    if ((entry.reason_code ?? null) !== (result.reason_code ?? null)) {
      recorded.push({
        field: "reason_code",
        journal: entry.reason_code ?? null,
        claimed: result.reason_code ?? null
      });
    }
    if (recorded.length > 0) {
      unbound.push({
        stable_id: result.stable_id,
        reason: "claimed_result_contradicts_the_journal_entry",
        sequence,
        contradictions: recorded
      });
    }
  }
  if (unbound.length > 0) {
    return refuseConformance(
      "scenario_receipt_binding_unverified",
      [
        "a receipt reference resolves to an entry the journal actually carries, and cites that entry's own commitment",
        "the journal's record of the outcome is what counts; a claimed result that contradicts its entry is refused",
        "a reference that merely has the canonical shape addresses nothing",
        "receipt sequences increase with the required tuple, so a receipt cannot precede the result it records"
      ],
      {
        ...baseFacts,
        authority_journal_id: authority.receipt_journal_id,
        authority_sequence_range: authority.receipt_sequence_range,
        journal_root: journalRoot,
        unbound_receipt_references: unbound
      }
    );
  }
  const notFresh = results.filter((result) => result.evidence_freshness !== "fresh").map((result) => ({ stable_id: result.stable_id, evidence_freshness: result.evidence_freshness ?? null }));
  if (notFresh.length > 0) {
    return refuseConformance(
      "scenario_evidence_stale",
      [
        "every required scenario needs an explicit fresh evidence verdict",
        "stale or unknown freshness is never read as fresh"
      ],
      { ...baseFacts, non_fresh_results: notFresh }
    );
  }
  const mismatched = results.map((result) => {
    const definition = scenarios.find((scenario) => scenario.stable_id === result.stable_id);
    const expected = definition?.expected_typed_outcome.disposition;
    return { stable_id: result.stable_id, expected: expected ?? null, observed: result.disposition };
  }).filter((entry) => entry.expected !== entry.observed);
  if (mismatched.length > 0) {
    return neutralOutcome({
      type: "guild.support_transition_outcome.v1",
      disposition: "failed",
      reason_code: "scenario_result_mismatch",
      assertions: ["any required failed scenario prevents promotion"],
      facts: { ...baseFacts, mismatched_scenarios: mismatched, may_promote_conformant: false }
    });
  }
  const signatureFaults = [];
  const verifiedAttestors = [];
  for (const attestation of authority.attestations) {
    if (acceptedAttestors.indexOf(attestation.attestor_id) === -1) continue;
    if (verifiedAttestors.indexOf(attestation.attestor_id) !== -1) continue;
    if (neutralAttestationVerifies(authority, attestation)) {
      verifiedAttestors.push(attestation.attestor_id);
      continue;
    }
    signatureFaults.push({
      attestor_id: attestation.attestor_id,
      reason: "attestation_signature_did_not_verify",
      signed_digest: neutralAttestationDigest(authority, attestation)
    });
  }
  if (verifiedAttestors.length < NEUTRAL_MINIMUM_ATTESTOR_QUORUM) {
    return refuseConformance(
      "scenario_attestation_signature_unverified",
      [
        `promotion requires ${NEUTRAL_MINIMUM_ATTESTOR_QUORUM} attestations that VERIFY under the keys this core pins`,
        "the verification keys are core-pinned, so the trust root is not an input the claimant supplies",
        "a structurally perfect attestation that no recognized attestor signed is not evidence of anything",
        "a signature is bound to one attestor, journal, root, entry count, range, and identity, so it cannot be replayed onto another bundle"
      ],
      {
        ...baseFacts,
        attestation_scheme: NEUTRAL_ATTESTATION_SCHEME,
        required_attestor_quorum: NEUTRAL_MINIMUM_ATTESTOR_QUORUM,
        trust_root_attestors: [...NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS],
        journal_root: journalRoot,
        structurally_accepted_attestors: acceptedAttestors,
        verified_attestors: verifiedAttestors,
        signature_faults: signatureFaults
      }
    );
  }
  return neutralOutcome({
    type: "guild.support_transition_outcome.v1",
    disposition: "succeeded",
    assertions: [
      "conformant may be promoted only for the exact evidence-bound version tuple",
      "constructed adapter smoke cannot satisfy lifecycle conformance",
      "every required scenario passed or explicitly refused under fresh, receipt-bound evidence",
      "every identity field the frozen support_claim rule names is present, recognized, and equal to the authority's",
      "the observed journal covers the declared range contiguously and its commitment chain verifies to a single root",
      "that root carries a quorum of distinct recognized attestations bound to this exact identity and range",
      "each attestation in that quorum carries a signature that VERIFIES under a verification key pinned in this core",
      "the trust root is pinned by the core, so no input the claimant supplies can stand in for it",
      "every receipt reference cites the journal entry's OWN commitment, and no claimed result contradicts its entry",
      "the claimant named itself and is none of the attesting parties"
    ],
    facts: {
      ...baseFacts,
      activated_runtime: evidence.activated_runtime,
      authority_identity: authority.identity,
      authority_journal_id: authority.receipt_journal_id,
      claimant_id: evidence.claimant_id,
      journal_root: journalRoot,
      journal_entry_count: entries.length,
      attesting_parties: acceptedAttestors,
      verified_attestors: verifiedAttestors,
      attestation_scheme: NEUTRAL_ATTESTATION_SCHEME,
      evaluated_scenarios: results.map((result) => ({
        stable_id: result.stable_id,
        disposition: result.disposition,
        receipt_ref: result.receipt_ref
      })),
      may_promote_conformant: true
    }
  });
}
var NEUTRAL_SCENARIO_SUITE_ID, NEUTRAL_SCENARIO_SUITE_VERSION, NEUTRAL_CORE_WAVE_OWNER, NEUTRAL_EVIDENCE_PROFILES, NEUTRAL_CORE_SCENARIOS, NEUTRAL_UNEVALUATED_SUPPORT, NEUTRAL_SUPPORT_TRANSITIONS, NEUTRAL_REQUIRED_CORE_SCENARIO_IDS, NEUTRAL_RECEIPT_REF_SCHEMA, NEUTRAL_RECEIPT_REF_PATTERN, NEUTRAL_RUNTIME_VERSION_PATTERN, NEUTRAL_RECOGNIZED_RUNTIME_MAJOR, NEUTRAL_RECOGNIZED_PLATFORMS, NEUTRAL_RECOGNIZED_HOST_IDS, NEUTRAL_SOURCE_COMMIT_PATTERN, NEUTRAL_PACKAGE_HASH_PATTERN, NEUTRAL_ADAPTER_VERSION_PATTERN, NEUTRAL_RECOGNIZED_ADAPTER_MAJOR, NEUTRAL_RELEASE_ID_PATTERN, NEUTRAL_SEMVER_PATTERN, NEUTRAL_JOURNAL_ID_PATTERN, NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS, NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA, NEUTRAL_ATTESTATION_REF_SCHEMA, NEUTRAL_ATTESTATION_SCHEME, NEUTRAL_ATTESTATION_CHAIN_LENGTH, NEUTRAL_ATTESTATION_MESSAGE_CHAINS, NEUTRAL_ATTESTATION_CHECKSUM_CHAINS, NEUTRAL_ATTESTATION_CHAINS, NEUTRAL_ATTESTATION_TREE_HEIGHT, NEUTRAL_ATTESTOR_TRUST_ROOT, NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS, NEUTRAL_MINIMUM_ATTESTOR_QUORUM, NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN, NEUTRAL_ATTESTATION_REF_PATTERN, NEUTRAL_ATTESTATION_SIGNATURE_PATTERN, NEUTRAL_COMMITMENT_PATTERN, NEUTRAL_CLAIMANT_ID_PATTERN, NEUTRAL_EVIDENCE_IDENTITY_FIELDS, NEUTRAL_HEX_ALPHABET, NEUTRAL_SHA256_HEX_PATTERN;
var init_neutral_conformance_core = __esm({
  "../src/modules/lifecycle/workflows/neutral-conformance-core.ts"() {
    init_neutral_runtime_contracts();
    NEUTRAL_SCENARIO_SUITE_ID = "guild.conformance_scenarios.v1";
    NEUTRAL_SCENARIO_SUITE_VERSION = "1.0.0";
    NEUTRAL_CORE_WAVE_OWNER = neutralFreeze({
      wave_id: "W1",
      work_item_id: "MH-02",
      key: "W1/MH-02"
    });
    NEUTRAL_EVIDENCE_PROFILES = neutralFreeze({
      "E-LIFECYCLE": {
        required_kinds: ["capability_snapshot", "normalized_event_log", "typed_outcome", "receipt_journal"],
        required_bindings: [
          "run_id",
          "operation_id",
          "scenario_id",
          "host_id",
          "host_version",
          "runtime_version",
          "contract_version"
        ]
      },
      "E-REFUSAL": {
        required_kinds: ["capability_snapshot", "typed_outcome", "receipt_journal"],
        required_bindings: ["scenario_id", "operation_id", "reason_code", "host_id", "runtime_version"]
      },
      "E-RECEIPT": {
        required_kinds: ["receipt_journal", "typed_outcome"],
        required_bindings: [
          "scenario_id",
          "run_id",
          "operation_id",
          "correlation_id",
          "sequence",
          "source_version",
          "runtime_version"
        ]
      },
      "E-BOUNDARY": {
        required_kinds: ["dependency_graph", "boundary_verdict"],
        required_bindings: ["scenario_id", "source_commit", "module_manifest_version"]
      },
      "E-MIGRATION": {
        required_kinds: ["legacy_outcome", "candidate_outcome", "comparison_verdict", "receipt_journal"],
        required_bindings: [
          "scenario_id",
          "operation_id",
          "feature_gate",
          "legacy_version",
          "candidate_version",
          "runtime_version"
        ]
      },
      // A21-9 / W5/MH-09: the frozen contract's profiles for the release-owner
      // scenarios. `E-SUPPORT` binds the five support-state proofs
      // (MHRC-SUP-001..005); `E-VERSION` binds the exact-version lifecycle proof
      // (MHRC-SUP-006) and the three version-drift scenarios (MHRC-VER-001..003).
      "E-SUPPORT": {
        required_kinds: ["operation_receipt", "artifact_hash", "typed_outcome"],
        required_bindings: [
          "scenario_id",
          "source_commit",
          "package_hash",
          "runtime_version",
          "host_id",
          "host_version",
          "platform"
        ]
      },
      "E-VERSION": {
        required_kinds: ["compatibility_verdict", "release_manifest", "artifact_hash"],
        required_bindings: [
          "scenario_id",
          "source_commit",
          "package_hash",
          "runtime_version",
          "adapter_version",
          "host_version",
          "contract_version",
          "scenario_suite_version",
          "platform"
        ]
      }
    });
    NEUTRAL_CORE_SCENARIOS = neutralFreeze([
      {
        stable_id: "MHRC-LIF-001",
        category: "lifecycle",
        title: "Equivalent phase entry produces equivalent lifecycle state",
        preconditions: [
          "two hosts expose the required phase-entry capability",
          "both runs use byte-identical immutable capability snapshots",
          "both runs start in the same lifecycle state"
        ],
        action_event: {
          name: "prompt.submit",
          input: {
            semantic_intent: "enter_phase",
            phase_matrix: ["init", "ideate", "plan", "build", "qa", "ops"]
          }
        },
        expected_typed_outcome: {
          type: "guild.lifecycle_outcome.v1",
          disposition: "succeeded",
          assertions: [
            "host pairs reach the same semantic phase state",
            "host pairs emit the same lifecycle decision code",
            "host-native fields are excluded from equivalence comparison"
          ]
        },
        evidence_requirements: [
          {
            profile: "E-LIFECYCLE",
            assertions: [
              "one event/outcome pair per host and phase",
              "capability snapshot hash is constant within each run"
            ]
          }
        ],
        implementation_wave_owner: NEUTRAL_CORE_WAVE_OWNER
      },
      {
        stable_id: "MHRC-LIF-002",
        category: "lifecycle",
        title: "Equivalent gate violation produces equivalent refusal",
        preconditions: [
          "two hosts support the normalized pre-tool event",
          "the same policy and lifecycle state apply",
          "the proposed operation violates the same gate"
        ],
        action_event: {
          name: "tool.before",
          input: { operation_class: "mutating", gate_condition: "unsatisfied" }
        },
        expected_typed_outcome: {
          type: "guild.lifecycle_outcome.v1",
          disposition: "refused",
          assertions: [
            "both hosts preserve the prior state",
            "both hosts return the same refusal reason code",
            "no tool side effect occurs"
          ]
        },
        evidence_requirements: [
          {
            profile: "E-LIFECYCLE",
            assertions: [
              "pre-state and post-state hashes match",
              "refusal receipt precedes any terminal run receipt"
            ]
          }
        ],
        implementation_wave_owner: NEUTRAL_CORE_WAVE_OWNER
      },
      {
        stable_id: "MHRC-LIF-003",
        category: "lifecycle",
        title: "Compaction and resume preserve lifecycle identity",
        preconditions: [
          "an open run has durable state and receipts",
          "the host supports compact or resume observation",
          "no capability snapshot mutation is permitted"
        ],
        action_event: { name: "context.compact", input: { then: "run.resume" } },
        expected_typed_outcome: {
          type: "guild.lifecycle_outcome.v1",
          disposition: "succeeded",
          assertions: [
            "run_id and capability snapshot hash are unchanged",
            "resume continues from the last durable lifecycle state",
            "already-applied transitions are not repeated"
          ]
        },
        evidence_requirements: [
          {
            profile: "E-LIFECYCLE",
            assertions: [
              "pre-compact checkpoint links to post-resume event",
              "receipt sequences remain monotonic"
            ]
          }
        ],
        implementation_wave_owner: NEUTRAL_CORE_WAVE_OWNER
      },
      {
        stable_id: "MHRC-LIF-004",
        category: "lifecycle",
        title: "Run close requires equivalent terminal evidence",
        preconditions: [
          "two runs have equivalent normalized histories",
          "all required gates have typed outcomes",
          "receipt reconciliation is complete"
        ],
        action_event: { name: "run.stop", input: { requested_terminal_state: "completed" } },
        expected_typed_outcome: {
          type: "guild.lifecycle_outcome.v1",
          disposition: "succeeded",
          assertions: [
            "both hosts reach the same terminal state",
            "completion is refused if any required observation is missing or failed",
            "terminal receipt is last in logical order"
          ]
        },
        evidence_requirements: [
          {
            profile: "E-LIFECYCLE",
            assertions: [
              "gate-outcome set is complete",
              "reconciliation checkpoint covers the terminal sequence"
            ]
          }
        ],
        implementation_wave_owner: NEUTRAL_CORE_WAVE_OWNER
      },
      {
        stable_id: "MHRC-UNS-002",
        category: "unsupported_refusal",
        title: "Policy refusal is distinct from unsupported capability",
        preconditions: [
          "the capability exists",
          "policy denies the requested operation",
          "the caller has not supplied required approval"
        ],
        action_event: { name: "tool.before", input: { policy_decision: "deny" } },
        expected_typed_outcome: {
          type: "guild.policy_outcome.v1",
          disposition: "refused",
          assertions: [
            "reason code identifies policy denial",
            "capability remains supported",
            "no operation side effect occurs"
          ]
        },
        evidence_requirements: [
          {
            profile: "E-REFUSAL",
            assertions: [
              "policy version and decision inputs are bound",
              "receipt distinguishes refused from unsupported"
            ]
          }
        ],
        implementation_wave_owner: NEUTRAL_CORE_WAVE_OWNER
      }
    ]);
    NEUTRAL_UNEVALUATED_SUPPORT = neutralFreeze({
      recognized: "not_evaluated",
      rendered: "not_evaluated",
      installed: "not_evaluated",
      activated: "not_evaluated",
      updated: "not_evaluated",
      conformant: "not_evaluated"
    });
    NEUTRAL_SUPPORT_TRANSITIONS = neutralFreeze([
      { operation: "render", requires: ["recognized:satisfied"], may_satisfy: "rendered", resets: [] },
      { operation: "install", requires: ["rendered:satisfied"], may_satisfy: "installed", resets: [] },
      { operation: "activate", requires: ["installed:satisfied"], may_satisfy: "activated", resets: [] },
      {
        operation: "update",
        requires: ["installed:satisfied"],
        may_satisfy: "updated",
        // An update invalidates any prior activation and conformance proof: the bytes
        // that were verified are no longer the bytes that are installed.
        resets: ["activated", "conformant"]
      },
      { operation: "verify", requires: ["activated:satisfied"], may_satisfy: "conformant", resets: [] }
    ]);
    NEUTRAL_REQUIRED_CORE_SCENARIO_IDS = neutralFreeze(
      NEUTRAL_CORE_SCENARIOS.map((scenario) => scenario.stable_id)
    );
    NEUTRAL_RECEIPT_REF_SCHEMA = "guild.receipt_ref.v1";
    NEUTRAL_RECEIPT_REF_PATTERN = new RegExp(
      "^guild\\.receipt_ref\\.v1:([A-Za-z0-9][A-Za-z0-9._-]{2,})#(0|[1-9][0-9]*)@(nec1:[0-9a-f]{16})$"
    );
    NEUTRAL_RUNTIME_VERSION_PATTERN = new RegExp(
      "^guild-(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$"
    );
    NEUTRAL_RECOGNIZED_RUNTIME_MAJOR = 2;
    NEUTRAL_RECOGNIZED_PLATFORMS = neutralFreeze([
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
      "win32-x64"
    ]);
    NEUTRAL_RECOGNIZED_HOST_IDS = neutralFreeze([
      "claude-code-cli",
      "codex-cli",
      "pi-cli",
      "antigravity"
    ]);
    NEUTRAL_SOURCE_COMMIT_PATTERN = new RegExp("^[0-9a-f]{40}$");
    NEUTRAL_PACKAGE_HASH_PATTERN = new RegExp("^sha256:[0-9a-f]{64}$");
    NEUTRAL_ADAPTER_VERSION_PATTERN = new RegExp(
      "^guild\\.host_adapter\\.v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$"
    );
    NEUTRAL_RECOGNIZED_ADAPTER_MAJOR = 1;
    NEUTRAL_RELEASE_ID_PATTERN = new RegExp("^rel-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-z]{1,16}$");
    NEUTRAL_SEMVER_PATTERN = new RegExp(
      "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$"
    );
    NEUTRAL_JOURNAL_ID_PATTERN = new RegExp("^[A-Za-z0-9][A-Za-z0-9._-]{2,}$");
    NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS = Object.freeze(["fresh", "stale", "unknown"]);
    NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA = "guild.conformance_authority.v1";
    NEUTRAL_ATTESTATION_REF_SCHEMA = "guild.journal_attestation.v1";
    NEUTRAL_ATTESTATION_SCHEME = "guild.wots_merkle.v1";
    NEUTRAL_ATTESTATION_CHAIN_LENGTH = 16;
    NEUTRAL_ATTESTATION_MESSAGE_CHAINS = 64;
    NEUTRAL_ATTESTATION_CHECKSUM_CHAINS = 3;
    NEUTRAL_ATTESTATION_CHAINS = NEUTRAL_ATTESTATION_MESSAGE_CHAINS + NEUTRAL_ATTESTATION_CHECKSUM_CHAINS;
    NEUTRAL_ATTESTATION_TREE_HEIGHT = 4;
    NEUTRAL_ATTESTOR_TRUST_ROOT = neutralFreeze([
      {
        attestor_id: "guild.release-attestor",
        verification_root: "2cd0a7a8986e79ec2cb25b5752d5a85a80d10c4d133d6590b91417bf976f3539"
      },
      {
        attestor_id: "guild.host-conformance-witness",
        verification_root: "584d8e28a2a5c109a2b892b627a3154fef9da46efc45eb79d042611bf09d09ef"
      },
      {
        attestor_id: "guild.distribution-notary",
        verification_root: "4dd9eb1f20a5194d38c6ac9cf308dac017ceebac0e85bcd7fbfa26fc43945f37"
      }
    ]);
    NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS = neutralFreeze(
      NEUTRAL_ATTESTOR_TRUST_ROOT.map((key) => key.attestor_id)
    );
    NEUTRAL_MINIMUM_ATTESTOR_QUORUM = 2;
    NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN = "guild.journal_attestation.v1/wots_merkle/1";
    NEUTRAL_ATTESTATION_REF_PATTERN = new RegExp(
      "^guild\\.journal_attestation\\.v1:([A-Za-z0-9][A-Za-z0-9._-]{2,})@(nad1:[0-9a-f]{64})$"
    );
    NEUTRAL_ATTESTATION_SIGNATURE_PATTERN = new RegExp(
      `^nws1:([0-9a-f]{2}):([0-9a-f]{${NEUTRAL_ATTESTATION_CHAINS * 64}}):([0-9a-f]{${NEUTRAL_ATTESTATION_TREE_HEIGHT * 64}})$`
    );
    NEUTRAL_COMMITMENT_PATTERN = new RegExp("^nec1:[0-9a-f]{16}$");
    NEUTRAL_CLAIMANT_ID_PATTERN = new RegExp("^[A-Za-z0-9][A-Za-z0-9._-]{2,}$");
    NEUTRAL_EVIDENCE_IDENTITY_FIELDS = neutralFreeze([
      "source_commit",
      "package_hash",
      "runtime_version",
      "adapter_version",
      "host_id",
      "host_version",
      "platform",
      "contract_version",
      "scenario_suite_id",
      "scenario_suite_version",
      "release_id"
    ]);
    NEUTRAL_HEX_ALPHABET = "0123456789abcdef";
    NEUTRAL_SHA256_HEX_PATTERN = new RegExp("^[0-9a-f]{64}$");
  }
});

// ../src/modules/lifecycle/workflows/neutral-core-boundary.ts
function isIdentStart(ch) {
  return ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z" || ch === "_" || ch === "$";
}
function isIdentPart(ch) {
  return isIdentStart(ch) || ch >= "0" && ch <= "9";
}
function isHexDigit(ch) {
  return ch >= "0" && ch <= "9" || ch >= "a" && ch <= "f" || ch >= "A" && ch <= "F";
}
function readIdentifierEscape(source, start) {
  if (source.charAt(start) !== "\\" || source.charAt(start + 1) !== "u") return void 0;
  if (source.charAt(start + 2) === "{") {
    let j = start + 3;
    let hex2 = "";
    while (j < source.length && isHexDigit(source.charAt(j))) {
      hex2 += source.charAt(j);
      j += 1;
    }
    if (hex2.length === 0 || source.charAt(j) !== "}") return void 0;
    const code = parseInt(hex2, 16);
    if (!Number.isFinite(code) || code > 1114111) return void 0;
    return { char: String.fromCodePoint(code), end: j + 1 };
  }
  const hex = source.slice(start + 2, start + 6);
  if (hex.length < 4) return void 0;
  for (let k = 0; k < 4; k += 1) {
    if (!isHexDigit(hex.charAt(k))) return void 0;
  }
  return { char: String.fromCharCode(parseInt(hex, 16)), end: start + 6 };
}
function isSpace(ch) {
  return ch === " " || ch === "	" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v";
}
function readSlashAs(previous, beforePrevious) {
  if (previous === void 0) return "regex";
  if (previous.kind === "string") return "division";
  if (previous.kind === "ident") {
    const keyword = previous.value === "return" || previous.value === "typeof" || previous.value === "instanceof" || previous.value === "in" || previous.value === "of" || previous.value === "new" || previous.value === "delete" || previous.value === "void" || previous.value === "case" || previous.value === "do" || previous.value === "else" || previous.value === "yield" || previous.value === "await";
    return keyword ? "regex" : "division";
  }
  if (previous.value === ")" || previous.value === "}") return "ambiguous_division";
  if (previous.value === "]") return "division";
  const doubled = beforePrevious !== void 0 && beforePrevious.kind === "punct" && beforePrevious.value === previous.value;
  if (doubled && (previous.value === "+" || previous.value === "-")) return "ambiguous_division";
  return "regex";
}
function scanRegexLiteral(source, start) {
  let j = start + 1;
  let inClass = false;
  while (j < source.length) {
    const c = source.charAt(j);
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "\n") return { closed: false, end: j };
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      j += 1;
      while (j < source.length && isIdentPart(source.charAt(j))) j += 1;
      return { closed: true, end: j };
    }
    j += 1;
  }
  return { closed: false, end: j };
}
function tokenizeNeutralSource(source) {
  return tokenizeNeutralSourceWithDiagnostics(source).tokens;
}
function tokenizeNeutralSourceWithDiagnostics(source) {
  const tokens = [];
  const ambiguities = [];
  const templateDepths = [];
  let braceDepth = 0;
  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (isSpace(ch)) {
      i += 1;
      continue;
    }
    if (ch === "/" && source.charAt(i + 1) === "/") {
      while (i < source.length && source.charAt(i) !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && source.charAt(i + 1) === "*") {
      i += 2;
      while (i < source.length && !(source.charAt(i) === "*" && source.charAt(i + 1) === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === "/") {
      const reading = readSlashAs(tokens[tokens.length - 1], tokens[tokens.length - 2]);
      if (reading === "regex") {
        const scan = scanRegexLiteral(source, i);
        if (scan.closed) {
          i = scan.end;
          continue;
        }
      } else if (reading === "ambiguous_division") {
        const scan = scanRegexLiteral(source, i);
        if (scan.closed) {
          const hidden = source.slice(i, scan.end);
          if (DEPENDENCY_WORD.test(hidden)) {
            ambiguities.push({
              kind: "regex_or_division",
              hidden_text: hidden.length > 120 ? `${hidden.slice(0, 117)}...` : hidden
            });
          }
        }
      }
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let body = "";
      while (j < source.length) {
        const c = source.charAt(j);
        if (c === "\\") {
          body += source.charAt(j + 1);
          j += 2;
          continue;
        }
        if (c === ch || c === "\n") break;
        body += c;
        j += 1;
      }
      tokens.push({ kind: "string", value: body });
      i = j + 1;
      continue;
    }
    if (ch === "`") {
      let j = i + 1;
      let body = "";
      let opened = false;
      while (j < source.length) {
        const c = source.charAt(j);
        if (c === "\\") {
          body += source.charAt(j + 1);
          j += 2;
          continue;
        }
        if (c === "$" && source.charAt(j + 1) === "{") {
          opened = true;
          break;
        }
        if (c === "`") break;
        body += c;
        j += 1;
      }
      tokens.push({ kind: "string", value: body });
      if (opened) {
        templateDepths.push(braceDepth);
        braceDepth += 1;
        tokens.push({ kind: "punct", value: "{" });
        i = j + 2;
      } else {
        i = j + 1;
      }
      continue;
    }
    if (isIdentStart(ch) || ch === "\\" && readIdentifierEscape(source, i) !== void 0) {
      let j = i;
      let value = "";
      let escaped = false;
      while (j < source.length) {
        const c = source.charAt(j);
        if (c === "\\") {
          const decoded = readIdentifierEscape(source, j);
          if (decoded === void 0) break;
          value += decoded.char;
          escaped = true;
          j = decoded.end;
          continue;
        }
        if (!isIdentPart(c)) break;
        value += c;
        j += 1;
      }
      if (escaped) {
        ambiguities.push({
          kind: "escaped_identifier",
          hidden_text: `${source.slice(i, j)} decodes to ${value}`
        });
      }
      tokens.push({ kind: "ident", value });
      i = j;
      continue;
    }
    if (ch === "\\") {
      ambiguities.push({
        kind: "undecodable_escape",
        hidden_text: source.slice(i, Math.min(i + 12, source.length))
      });
      tokens.push({ kind: "punct", value: ch });
      i += 1;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < source.length && (isIdentPart(source.charAt(j)) || source.charAt(j) === ".")) j += 1;
      tokens.push({ kind: "ident", value: "0" });
      i = j;
      continue;
    }
    if (ch === "{") braceDepth += 1;
    if (ch === "}") {
      braceDepth -= 1;
      if (templateDepths.length > 0 && templateDepths[templateDepths.length - 1] === braceDepth) {
        templateDepths.pop();
        tokens.push({ kind: "punct", value: "}" });
        let j = i + 1;
        let body = "";
        let reopened = false;
        while (j < source.length) {
          const c = source.charAt(j);
          if (c === "\\") {
            body += source.charAt(j + 1);
            j += 2;
            continue;
          }
          if (c === "$" && source.charAt(j + 1) === "{") {
            reopened = true;
            break;
          }
          if (c === "`") break;
          body += c;
          j += 1;
        }
        tokens.push({ kind: "string", value: body });
        if (reopened) {
          templateDepths.push(braceDepth);
          braceDepth += 1;
          tokens.push({ kind: "punct", value: "{" });
          i = j + 2;
        } else {
          i = j + 1;
        }
        continue;
      }
    }
    tokens.push({ kind: "punct", value: ch });
    i += 1;
  }
  return { tokens, ambiguities };
}
function bracketDelta(token) {
  if (token.kind !== "punct") return 0;
  if (OPENERS.indexOf(token.value) !== -1) return 1;
  if (CLOSERS.indexOf(token.value) !== -1) return -1;
  return 0;
}
function firstArgumentTokens(tokens, openIndex) {
  const collected = [];
  let depth = 1;
  for (let j = openIndex + 1; j < tokens.length; j += 1) {
    const token = tokens[j];
    const delta = bracketDelta(token);
    if (delta > 0) depth += 1;
    else if (delta < 0) {
      depth -= 1;
      if (depth === 0) return collected;
    }
    if (depth === 1 && token.kind === "punct" && token.value === ",") return collected;
    collected.push(token);
  }
  return void 0;
}
function describeTokens(tokens) {
  const rendered = tokens.map((token) => token.kind === "string" ? `"${token.value}"` : token.value).join(" ");
  return rendered.length > 80 ? `${rendered.slice(0, 77)}...` : rendered;
}
function extractNeutralImportEdges(source) {
  const tokens = tokenizeNeutralSource(source);
  const edges = [];
  const seen = [];
  const push = (edge) => {
    const key = `${edge.kind}|${edge.specifier ?? ""}|${edge.form}|${edge.detail ?? ""}`;
    if (seen.indexOf(key) !== -1) return;
    seen.push(key);
    edges.push(edge);
  };
  const add = (specifier, form) => {
    if (specifier.length > 0) push({ kind: "resolved", specifier, form });
    else push({ kind: "unresolved", form, detail: "empty specifier" });
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "ident") continue;
    const isImport = token.value === "import";
    const isExport = token.value === "export";
    const isRequire = token.value === "require";
    if (!isImport && !isExport && !isRequire) continue;
    const next = tokens[index + 1];
    if (next === void 0) {
      if (isRequire) push({ kind: "unresolved", form: "require", detail: "require used as a value" });
      continue;
    }
    const optional = next.kind === "punct" && next.value === "?" && tokens[index + 2]?.kind === "punct" && tokens[index + 2]?.value === "." && tokens[index + 3]?.kind === "punct" && tokens[index + 3]?.value === "(";
    const plainCall = next.kind === "punct" && next.value === "(";
    if ((isImport || isRequire) && (plainCall || optional)) {
      const callee = isImport ? "import" : "require";
      const form = optional ? `${callee}${OPTIONAL_CALL}` : `${callee}()`;
      const openIndex = optional ? index + 3 : index + 1;
      const argument = firstArgumentTokens(tokens, openIndex);
      if (argument === void 0) {
        push({ kind: "unresolved", form, detail: "unterminated call" });
      } else if (argument.length === 0) {
        push({ kind: "unresolved", form, detail: "no argument" });
      } else if (argument.length === 1 && argument[0].kind === "string") {
        add(argument[0].value, form);
      } else {
        push({
          kind: "unresolved",
          form,
          detail: `non-literal specifier: ${describeTokens(argument)}`
        });
      }
      continue;
    }
    if (isRequire) {
      push({
        kind: "unresolved",
        form: "require",
        detail: `require used as a value (followed by ${describeTokens([next])})`
      });
      continue;
    }
    if (isImport && next.kind === "punct" && next.value === ".") continue;
    if (isImport && next.kind === "string") {
      add(next.value, "import");
      continue;
    }
    let depth = 0;
    for (let j = index + 1; j < tokens.length; j += 1) {
      const candidate = tokens[j];
      const delta = bracketDelta(candidate);
      if (delta < 0 && depth === 0) break;
      depth += delta;
      if (depth > 0) continue;
      if (candidate.kind === "punct" && candidate.value === ";") break;
      if (candidate.kind === "ident" && (candidate.value === "import" || candidate.value === "export")) {
        break;
      }
      if (candidate.kind === "ident" && candidate.value === "from") {
        const specifier = tokens[j + 1];
        if (specifier !== void 0 && specifier.kind === "string") {
          add(specifier.value, isExport ? "export from" : "import from");
        }
        break;
      }
    }
  }
  return edges;
}
function isNeutralLanguageWord(name) {
  return NEUTRAL_LANGUAGE_WORDS.indexOf(name) !== -1;
}
function isNumericToken(token) {
  const first = token.value.charAt(0);
  return first >= "0" && first <= "9";
}
function isTypeDeclarationHead(tokens, index) {
  const token = tokens[index];
  if (token === void 0 || token.kind !== "ident" || token.value !== "module") return false;
  const previous = tokens[index - 1];
  if (previous !== void 0 && previous.kind === "ident" && previous.value === "declare") return true;
  const next = tokens[index + 1];
  return next !== void 0 && next.kind === "string";
}
function matchingCloseIndex(tokens, openIndex) {
  let depth = 0;
  for (let j = openIndex; j < tokens.length; j += 1) {
    const delta = bracketDelta(tokens[j]);
    if (delta > 0) depth += 1;
    else if (delta < 0) {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}
function isPunct(token, value) {
  return token !== void 0 && token.kind === "punct" && token.value === value;
}
function isParameterList(tokens, openIndex) {
  const close = matchingCloseIndex(tokens, openIndex);
  if (close === -1) return false;
  const previous = tokens[openIndex - 1];
  const beforePrevious = tokens[openIndex - 2];
  if (previous !== void 0 && previous.kind === "ident" && previous.value === "function") return true;
  if (previous !== void 0 && previous.kind === "ident" && beforePrevious !== void 0 && beforePrevious.kind === "ident" && beforePrevious.value === "function") {
    return true;
  }
  const atValueStart = previous === void 0 || previous.kind === "punct" && NEUTRAL_VALUE_START_PUNCT.indexOf(previous.value) !== -1;
  if (!atValueStart) return false;
  const arrow = isPunct(tokens[close + 1], "=") && isPunct(tokens[close + 2], ">");
  const annotated = isPunct(tokens[close + 1], ":");
  return arrow || annotated;
}
function pushUnique(list, value) {
  if (value.length > 0 && list.indexOf(value) === -1) list.push(value);
}
function collectParameterNames(tokens, openIndex, close, into) {
  let expectBinding = true;
  for (let j = openIndex + 1; j < close; j += 1) {
    const token = tokens[j];
    if (token.kind === "punct") {
      if (token.value === ",") expectBinding = true;
      else if (token.value === ":" || token.value === "=" || token.value === ".") expectBinding = false;
      continue;
    }
    if (token.kind === "string") {
      expectBinding = false;
      continue;
    }
    if (expectBinding && !isNeutralLanguageWord(token.value)) {
      pushUnique(into, token.value);
      expectBinding = false;
    }
  }
}
function collectTypeParameterNames(tokens, openIndex, into) {
  let depth = 0;
  let expectBinding = true;
  for (let j = openIndex; j < tokens.length; j += 1) {
    const token = tokens[j];
    if (token.kind === "punct") {
      if (token.value === "<") depth += 1;
      else if (token.value === ">") {
        depth -= 1;
        if (depth === 0) return;
      } else if (token.value === "," && depth === 1) expectBinding = true;
      else if (token.value === "(" || token.value === "{" || token.value === ";") return;
      continue;
    }
    if (token.kind !== "ident") continue;
    if (expectBinding && !isNeutralLanguageWord(token.value)) {
      pushUnique(into, token.value);
      expectBinding = false;
    }
  }
}
function collectImportBindings(tokens, importIndex, into) {
  for (let j = importIndex + 1; j < tokens.length; j += 1) {
    const token = tokens[j];
    if (token.kind === "string") return;
    if (token.kind === "punct" && (token.value === ";" || token.value === "(")) return;
    if (token.kind !== "ident") continue;
    if (token.value === "from") return;
    if (!isNeutralLanguageWord(token.value)) pushUnique(into, token.value);
  }
}
function collectDeclaratorNames(tokens, keywordIndex, into) {
  let depth = 0;
  let annotating = false;
  for (let j = keywordIndex + 1; j < tokens.length; j += 1) {
    const token = tokens[j];
    const delta = bracketDelta(token);
    if (delta < 0 && depth === 0) return;
    if (token.kind === "punct") {
      if (depth === 0 && (token.value === ";" || token.value === "=")) return;
      if (depth === 0 && token.value === ":") annotating = true;
      if (depth === 0 && token.value === ",") annotating = false;
      depth += delta;
      continue;
    }
    if (token.kind === "string") continue;
    if (token.value === "of" || token.value === "in") return;
    if (!annotating && !isNeutralLanguageWord(token.value)) pushUnique(into, token.value);
  }
}
function collectNeutralBoundNames(tokens) {
  const bound = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind === "punct") {
      if (token.value === "(" && isParameterList(tokens, i)) {
        collectParameterNames(tokens, i, matchingCloseIndex(tokens, i), bound);
      }
      continue;
    }
    if (token.kind !== "ident") continue;
    if (isPunct(tokens[i + 1], "=") && isPunct(tokens[i + 2], ">") && !isNeutralLanguageWord(token.value)) {
      pushUnique(bound, token.value);
    }
    if (token.value === "import") {
      collectImportBindings(tokens, i, bound);
      continue;
    }
    if (token.value === "function" || token.value === "class" || token.value === "interface" || token.value === "type" || token.value === "enum" || token.value === "namespace") {
      const name = tokens[i + 1];
      if (name !== void 0 && name.kind === "ident") {
        pushUnique(bound, name.value);
        if (isPunct(tokens[i + 2], "<")) collectTypeParameterNames(tokens, i + 2, bound);
      }
      continue;
    }
    if (token.value === "catch" && isPunct(tokens[i + 1], "(")) {
      const binding = tokens[i + 2];
      if (binding !== void 0 && binding.kind === "ident") pushUnique(bound, binding.value);
      continue;
    }
    if (token.value === "const" || token.value === "let" || token.value === "var") {
      collectDeclaratorNames(tokens, i, bound);
      continue;
    }
  }
  return bound;
}
function describeCallee(tokens, openIndex) {
  const from = openIndex - 6 < 0 ? 0 : openIndex - 6;
  return describeTokens(tokens.slice(from, openIndex + 1));
}
function matchingOpenIndex(tokens, closeIndex) {
  let depth = 0;
  for (let j = closeIndex; j >= 0; j -= 1) {
    const delta = bracketDelta(tokens[j]);
    if (delta < 0) depth += 1;
    else if (delta > 0) {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}
function isMemberAccessBracket(tokens, openIndex) {
  if (isPunct(tokens[openIndex + 1], "]")) return false;
  const previous = tokens[openIndex - 1];
  if (previous === void 0) return false;
  if (previous.kind === "string") return true;
  if (previous.kind === "punct") {
    if (previous.value === "]" || previous.value === ")") return true;
    return previous.value === "." && isPunct(tokens[openIndex - 2], "?");
  }
  return !isNeutralLanguageWord(previous.value);
}
function baseEndIndex(tokens, at) {
  if (isPunct(tokens[at - 1], ".") && isPunct(tokens[at - 2], "?")) return at - 3;
  return at - 1;
}
function resolveBaseRoot(tokens, endIndex, classify) {
  if (endIndex < 0) return { kind: "unresolvable", detail: "no base expression" };
  const token = tokens[endIndex];
  if (token === void 0) return { kind: "unresolvable", detail: "no base expression" };
  if (token.kind === "string") {
    return { kind: "unresolvable", detail: "string literal base" };
  }
  if (token.kind === "ident") {
    if (isNumericToken(token)) return { kind: "unresolvable", detail: "numeric literal base" };
    if (isPunct(tokens[endIndex - 1], ".")) {
      const objectEnd = isPunct(tokens[endIndex - 2], "?") ? endIndex - 3 : endIndex - 2;
      return resolveBaseRoot(tokens, objectEnd, classify);
    }
    if (isNeutralLanguageWord(token.value)) {
      return { kind: "unresolvable", detail: `keyword base ${token.value}` };
    }
    return classify(token.value);
  }
  if (token.value === "]") {
    const open = matchingOpenIndex(tokens, endIndex);
    if (open <= 0) return { kind: "unresolvable", detail: "unbalanced bracket base" };
    if (isMemberAccessBracket(tokens, open)) {
      return resolveBaseRoot(tokens, baseEndIndex(tokens, open), classify);
    }
    return { kind: "unresolvable", detail: "array literal base" };
  }
  if (token.value === ")") {
    const open = matchingOpenIndex(tokens, endIndex);
    if (open <= 0) return { kind: "unresolvable", detail: "unbalanced parenthesis base" };
    const before = tokens[open - 1];
    if (before !== void 0 && before.kind === "ident" && !isNumericToken(before) && NEUTRAL_NON_CALLEE_WORDS.indexOf(before.value) === -1 && !isNeutralLanguageWord(before.value)) {
      return resolveBaseRoot(tokens, open - 1, classify);
    }
    if (before !== void 0 && before.kind === "punct" && (before.value === ")" || before.value === "]")) {
      return { kind: "unresolvable", detail: "call on an unresolvable callee" };
    }
    const first = tokens[open + 1];
    if (first === void 0) return { kind: "unresolvable", detail: "empty group base" };
    if (first.kind === "ident" && first.value === "typeof") return { kind: "type_position" };
    if (first.kind === "ident" && first.value === "new") {
      return { kind: "unresolvable", detail: "constructed-value base" };
    }
    if (first.kind === "ident" && !isNumericToken(first) && !isNeutralLanguageWord(first.value)) {
      return classify(first.value);
    }
    return { kind: "unresolvable", detail: "literal or computed group base" };
  }
  return { kind: "unresolvable", detail: `base token ${token.value}` };
}
function usageAt(tokens, index) {
  const next = tokens[index + 1];
  if (next === void 0 || next.kind !== "punct") return "reference";
  if (next.value === "(") return "call";
  if (next.value === ".") return "member";
  if (next.value === "[") return "computed_member";
  if (next.value === "?" && (isPunct(tokens[index + 2], ".") || isPunct(tokens[index + 2], "("))) {
    return "optional_member";
  }
  return "reference";
}
function isAssignmentEquals(tokens, index) {
  const token = tokens[index];
  if (token === void 0 || token.kind !== "punct" || token.value !== "=") return false;
  if (isPunct(tokens[index + 1], "=") || isPunct(tokens[index + 1], ">")) return false;
  const previous = tokens[index - 1];
  if (previous !== void 0 && previous.kind === "punct") {
    return "=!<>+-*/%&|^".indexOf(previous.value) === -1;
  }
  return true;
}
function findAssignmentEquals(tokens, start) {
  let depth = 0;
  for (let j = start; j < tokens.length; j += 1) {
    const delta = bracketDelta(tokens[j]);
    if (delta < 0 && depth === 0) return -1;
    depth += delta;
    if (depth !== 0) continue;
    if (isPunct(tokens[j], ";")) return -1;
    if (isAssignmentEquals(tokens, j)) return j;
  }
  return -1;
}
function statementEnd(tokens, start) {
  let depth = 0;
  for (let j = start; j < tokens.length; j += 1) {
    const delta = bracketDelta(tokens[j]);
    if (delta < 0 && depth === 0) return j;
    depth += delta;
    if (depth === 0 && isPunct(tokens[j], ";")) return j;
  }
  return tokens.length;
}
function findFunctionBodyOpen(tokens, start) {
  let j = start;
  while (j < tokens.length) {
    if (isPunct(tokens[j], ";")) return -1;
    if (isPunct(tokens[j], "(")) {
      const close = matchingCloseIndex(tokens, j);
      if (close === -1) return -1;
      j = close + 1;
      break;
    }
    j += 1;
  }
  while (j < tokens.length) {
    if (isPunct(tokens[j], ";")) return -1;
    if (isPunct(tokens[j], "{")) {
      const close = matchingCloseIndex(tokens, j);
      if (close === -1) return -1;
      const after = tokens[close + 1];
      const annotation = after !== void 0 && after.kind === "punct" && (after.value === "{" || after.value === "|" || after.value === "&");
      if (!annotation) return j;
      j = close + 1;
      continue;
    }
    j += 1;
  }
  return -1;
}
function collectBindingInitializers(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind !== "ident") continue;
    if (token.value === "const" || token.value === "let" || token.value === "var") {
      const names = [];
      collectDeclaratorNames(tokens, i, names);
      const equals = findAssignmentEquals(tokens, i + 1);
      if (equals !== -1 && names.length > 0) {
        out.push({ names, from: equals + 1, to: statementEnd(tokens, equals + 1) });
      }
      continue;
    }
    if (token.value === "function") {
      const name = tokens[i + 1];
      if (name !== void 0 && name.kind === "ident" && !isNeutralLanguageWord(name.value)) {
        const open = findFunctionBodyOpen(tokens, i + 2);
        const close = open === -1 ? -1 : matchingCloseIndex(tokens, open);
        if (open !== -1 && close !== -1) out.push({ names: [name.value], from: open + 1, to: close });
      }
      continue;
    }
    if (isNeutralLanguageWord(token.value) || isNumericToken(token)) continue;
    if (isPunct(tokens[i - 1], ".")) continue;
    if (!isAssignmentEquals(tokens, i + 1)) continue;
    out.push({ names: [token.value], from: i + 2, to: statementEnd(tokens, i + 2) });
  }
  return out;
}
function rangeReferencesDerived(tokens, from, to, derived) {
  for (let j = from; j < to && j < tokens.length; j += 1) {
    const token = tokens[j];
    if (token.kind !== "ident") continue;
    if (isPunct(tokens[j - 1], ".")) continue;
    if (isPunct(tokens[j + 1], ":")) continue;
    if (derived.indexOf(token.value) !== -1) return token.value;
  }
  return void 0;
}
function capabilityOrigins(tokens, bound, classify) {
  const origins = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind === "punct" && token.value === "(" && !isParameterList(tokens, i)) {
      const optional = isPunct(tokens[i - 1], ".") && isPunct(tokens[i - 2], "?");
      const previous = optional ? tokens[i - 3] : tokens[i - 1];
      if (previous !== void 0) {
        const form = previous.kind === "punct" && previous.value === "]" ? "computed_member_call" : previous.kind === "punct" && previous.value === ")" ? "call_result_call" : previous.kind === "string" ? "literal_call" : "";
        if (form.length > 0) {
          origins.push({
            index: i,
            kind: "indirect",
            form,
            detail: describeCallee(tokens, i),
            name: form,
            usage: "call"
          });
        }
      }
    }
    if (token.kind === "punct" && token.value === "[" && isMemberAccessBracket(tokens, i)) {
      const root = resolveBaseRoot(tokens, baseEndIndex(tokens, i), classify);
      if (root.kind === "unresolvable") {
        origins.push({
          index: i,
          kind: "reach",
          form: "computed_member_reach",
          detail: `${describeCallee(tokens, i)} \u2014 ${root.detail}`,
          name: root.detail,
          usage: "computed_member"
        });
      }
    }
    if (token.kind !== "ident") continue;
    if (isPunct(tokens[i - 1], ".") && NEUTRAL_PROTOTYPE_CHAIN_PROPERTIES.indexOf(token.value) !== -1) {
      origins.push({
        index: i,
        kind: "reach",
        form: "prototype_chain_reach",
        detail: describeCallee(tokens, i),
        name: token.value,
        usage: "member"
      });
      continue;
    }
    if (NEUTRAL_REFLECTION_METHOD_NAMES.indexOf(token.value) !== -1 && isPunct(tokens[i + 1], "(")) {
      origins.push({
        index: i,
        kind: "reach",
        form: "reflection_call_reach",
        detail: describeCallee(tokens, i + 1),
        name: token.value,
        usage: "call"
      });
      continue;
    }
    if (isPunct(tokens[i - 1], ".")) continue;
    if (isPunct(tokens[i + 1], ":")) continue;
    if (isPunct(tokens[i + 1], "?") && isPunct(tokens[i + 2], ":")) continue;
    if (isNumericToken(token)) continue;
    if (isNeutralLanguageWord(token.value)) continue;
    if (isTypeDeclarationHead(tokens, i)) continue;
    if (NEUTRAL_PURE_INTRINSIC_ROOTS.indexOf(token.value) !== -1) continue;
    if (bound.indexOf(token.value) !== -1) continue;
    origins.push({
      index: i,
      kind: "ambient",
      form: "ambient_reference",
      detail: token.value,
      name: token.value,
      usage: usageAt(tokens, i)
    });
  }
  return origins;
}
function analyzeNeutralCapabilityUse(source) {
  const tokens = tokenizeNeutralSource(source);
  const bound = collectNeutralBoundNames(tokens);
  const initializers = collectBindingInitializers(tokens);
  const derived = [];
  const classify = (name) => {
    if (derived.indexOf(name) !== -1) {
      return { kind: "unresolvable", detail: `capability-derived binding ${name}` };
    }
    if (bound.indexOf(name) !== -1) return { kind: "local", name };
    if (NEUTRAL_PURE_INTRINSIC_ROOTS.indexOf(name) !== -1) return { kind: "intrinsic", name };
    return { kind: "unresolvable", detail: `ambient binding ${name}` };
  };
  const originOf = [];
  let origins = capabilityOrigins(tokens, bound, classify);
  for (let pass = 0; pass <= initializers.length; pass += 1) {
    let changed = false;
    for (const initializer of initializers) {
      const carried = origins.find(
        (origin) => origin.index >= initializer.from && origin.index < initializer.to
      );
      const alias = rangeReferencesDerived(tokens, initializer.from, initializer.to, derived);
      if (carried === void 0 && alias === void 0) continue;
      const reason = carried !== void 0 ? `${carried.form}: ${carried.detail}` : `alias of ${alias ?? ""}`;
      for (const name of initializer.names) {
        if (derived.indexOf(name) !== -1) continue;
        derived.push(name);
        originOf.push(reason);
        changed = true;
      }
    }
    if (!changed) break;
    origins = capabilityOrigins(tokens, bound, classify);
  }
  const indirect = [];
  const ambient = [];
  const reaches = [];
  const seen = [];
  for (const origin of origins) {
    const key = `${origin.kind}|${origin.form}|${origin.detail}|${origin.usage}`;
    if (seen.indexOf(key) !== -1) continue;
    seen.push(key);
    if (origin.kind === "indirect") {
      indirect.push({ form: origin.form, detail: origin.detail });
    } else if (origin.kind === "ambient") {
      ambient.push({ name: origin.name, usage: origin.usage });
    } else {
      reaches.push({ form: origin.form, detail: origin.detail });
    }
  }
  const aliases = [];
  const seenAlias = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind !== "ident") continue;
    if (isPunct(tokens[i - 1], ".")) continue;
    if (isPunct(tokens[i + 1], ":")) continue;
    const at = derived.indexOf(token.value);
    if (at === -1) continue;
    const usage = usageAt(tokens, i);
    if (usage === "reference") continue;
    const key = `${token.value}|${usage}`;
    if (seenAlias.indexOf(key) !== -1) continue;
    seenAlias.push(key);
    aliases.push({ name: token.value, usage, origin: originOf[at] ?? "capability-derived" });
  }
  return { indirect, ambient, reaches, aliases };
}
function isIntraCoreSpecifier(specifier) {
  if (specifier.charAt(0) !== ".") return false;
  const tail = specifier.replace(/^\.\//, "");
  if (tail.indexOf("/") !== -1) return false;
  const withExtension = tail.endsWith(".ts") ? tail : `${tail}.ts`;
  return NEUTRAL_CORE_MEMBERS.indexOf(withExtension) !== -1;
}
function evaluateNeutralCoreBoundary(files) {
  const declared = NEUTRAL_CORE_MEMBERS;
  const suppliedPaths = files.map((file) => file.path);
  const missingMembers = declared.filter((member) => suppliedPaths.indexOf(member) === -1);
  const undeclaredFiles = suppliedPaths.filter((supplied) => declared.indexOf(supplied) === -1);
  const forbidden = [];
  const unclassified = [];
  const intraCore = [];
  const unresolved = [];
  const ambiguous = [];
  const indirectCallees = [];
  const ambientCapabilities = [];
  const capabilityReaches = [];
  const capabilityAliases = [];
  for (const file of files) {
    for (const ambiguity of tokenizeNeutralSourceWithDiagnostics(file.source).ambiguities) {
      ambiguous.push({
        importer: file.path,
        kind: ambiguity.kind,
        hidden_text: ambiguity.hidden_text
      });
    }
    const capability2 = analyzeNeutralCapabilityUse(file.source);
    for (const callee of capability2.indirect) {
      indirectCallees.push({ importer: file.path, form: callee.form, detail: callee.detail });
    }
    for (const reference of capability2.ambient) {
      ambientCapabilities.push({
        importer: file.path,
        name: reference.name,
        usage: reference.usage
      });
    }
    for (const reach of capability2.reaches) {
      capabilityReaches.push({ importer: file.path, form: reach.form, detail: reach.detail });
    }
    for (const alias of capability2.aliases) {
      capabilityAliases.push({
        importer: file.path,
        name: alias.name,
        usage: alias.usage,
        origin: alias.origin
      });
    }
    for (const edge of extractNeutralImportEdges(file.source)) {
      if (edge.kind === "unresolved" || edge.specifier === void 0) {
        unresolved.push({
          importer: file.path,
          form: edge.form,
          detail: edge.detail ?? "unresolved specifier"
        });
        continue;
      }
      const specifier = edge.specifier;
      const matcher = NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS.find(
        (candidate) => candidate.pattern.test(specifier)
      );
      if (matcher !== void 0) {
        forbidden.push({
          importer: file.path,
          specifier,
          matcher_id: matcher.id,
          boundary: matcher.boundary
        });
        continue;
      }
      if (isIntraCoreSpecifier(specifier)) {
        intraCore.push({ importer: file.path, specifier });
        continue;
      }
      unclassified.push({ importer: file.path, specifier });
    }
  }
  const edgeCount = forbidden.length + unclassified.length + intraCore.length + unresolved.length;
  const facts = {
    declared_members: [...declared],
    missing_members: missingMembers,
    undeclared_files: undeclaredFiles,
    node_count: suppliedPaths.length,
    edge_count: edgeCount,
    intra_core_edges: intraCore,
    forbidden_edges: forbidden,
    unclassified_edges: unclassified,
    unresolved_edges: unresolved,
    source_ambiguities: ambiguous,
    indirect_callees: indirectCallees,
    ambient_capabilities: ambientCapabilities,
    capability_reaches: capabilityReaches,
    capability_aliases: capabilityAliases,
    pure_intrinsic_roots: [...NEUTRAL_PURE_INTRINSIC_ROOTS],
    prototype_chain_properties: [...NEUTRAL_PROTOTYPE_CHAIN_PROPERTIES],
    reflection_method_names: [...NEUTRAL_REFLECTION_METHOD_NAMES]
  };
  if (missingMembers.length > 0 || undeclaredFiles.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_membership_mismatch",
      assertions: [
        "the scanned file set must equal the declared core membership",
        "a partial scan cannot prove closure"
      ],
      facts
    });
  }
  if (forbidden.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_forbidden_edge",
      assertions: [
        "no core-to-concrete dependency edge exists",
        "dynamic and re-export edges are included"
      ],
      facts
    });
  }
  if (unresolved.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_unresolved_edge",
      assertions: [
        "every dependency edge must resolve to a destination the scan can classify",
        "a runtime-computed specifier cannot be proven to stay inside the core",
        "an unresolvable edge is closure unproven, never closure proven"
      ],
      facts
    });
  }
  if (ambientCapabilities.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_ambient_capability",
      assertions: [
        "a core member may reference only what it declares, imports, or draws from the pure-intrinsic allowlist",
        "an ambient binding is a capability the closure argument never covered",
        "the allowlist is closed, so an unanticipated intrinsic fails rather than passes"
      ],
      facts
    });
  }
  if (capabilityReaches.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_capability_reach",
      assertions: [
        "a computed member access must hang off a base the scan can name as a local binding or a pure intrinsic",
        "the prototype chain is a capability: constructor, prototype, and __proto__ reach the Function evaluator from any object",
        "getPrototypeOf, getOwnPropertyDescriptor, bind, call, and apply hand back a prototype, a descriptor, or a re-bound function",
        "a capability the scan cannot name is a capability it cannot bound"
      ],
      facts
    });
  }
  if (indirectCallees.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_indirect_callee",
      assertions: [
        "every call must have a callee the scan can reduce to a named destination",
        "a computed-member, call-result, or literal callee is decided at runtime and cannot be proven to stay inside the core",
        "an unresolvable callee is closure unproven, never closure proven"
      ],
      facts
    });
  }
  if (capabilityAliases.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_capability_alias",
      assertions: [
        "a value that flowed from a capability reach stays a capability however many bindings it passes through",
        "binding a computed loader or an evaluator to a local name before calling it is not a different act",
        "provenance is followed to a fixpoint through declaration, destructuring, assignment, and local-function return"
      ],
      facts
    });
  }
  if (ambiguous.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_ambiguous_source",
      assertions: [
        "the source must lex unambiguously wherever the reading could hide an edge",
        "a regex-versus-division ambiguity spanning an import or require is not resolved by guess",
        "an escaped identifier decodes, and is still reported: escaping a name in a core member exists only to defeat a recognizer"
      ],
      facts
    });
  }
  if (unclassified.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_unclassified_edge",
      assertions: [
        "unclassified destinations fail the verdict",
        "the core is closed under import: only declared members are reachable"
      ],
      facts
    });
  }
  return neutralOutcome({
    type: "guild.boundary_outcome.v1",
    disposition: "succeeded",
    assertions: [
      "no core-to-concrete dependency edge exists",
      "dynamic and re-export edges are included",
      "every edge resolved to a declared core member",
      "no lexical ambiguity could have hidden an edge",
      "every callee reduced to a declared, imported, or pure-intrinsic root",
      "no ambient binding is reached, so no host handle, clock, or evaluator is available",
      "every computed member access hangs off a base the scan named, and no prototype chain is walked",
      "no binding carries capability provenance, so no alias of a reach exists to call",
      "the core is closed under import AND capability, so no transitive escape exists"
    ],
    facts
  });
}
var NEUTRAL_CORE_MEMBERS, NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS, DEPENDENCY_WORD, OPENERS, CLOSERS, OPTIONAL_CALL, NEUTRAL_PURE_INTRINSIC_ROOTS, NEUTRAL_LANGUAGE_WORDS, NEUTRAL_VALUE_START_PUNCT, NEUTRAL_NON_CALLEE_WORDS, NEUTRAL_PROTOTYPE_CHAIN_PROPERTIES, NEUTRAL_REFLECTION_METHOD_NAMES;
var init_neutral_core_boundary = __esm({
  "../src/modules/lifecycle/workflows/neutral-core-boundary.ts"() {
    init_neutral_runtime_contracts();
    NEUTRAL_CORE_MEMBERS = Object.freeze([
      "neutral-runtime-contracts.ts",
      "neutral-gate-policy.ts",
      "neutral-lifecycle-machine.ts",
      "neutral-conformance-core.ts",
      "neutral-conformance-assembly.ts",
      "neutral-core-boundary.ts"
    ]);
    NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS = neutralFreeze([
      {
        id: "host_adapter",
        boundary: "host-adapters",
        pattern: new RegExp("(^|/)(host-runtime|host-adapter|host-adapters|[a-z0-9-]+-host-adapter)(/|$)")
      },
      {
        id: "hook_implementation",
        boundary: "compatibility-shims",
        pattern: new RegExp("(^|/)hooks(/|$)")
      },
      {
        id: "wrapper_or_launcher",
        boundary: "execution-transports",
        pattern: new RegExp("(launcher|wrapper|guild-run|agent-team|agent-bus)")
      },
      {
        id: "execution_transport",
        boundary: "execution-transports",
        pattern: new RegExp("(pane-adapter|pane|tmux|remote-exec|process-exec|transport|dispatch)")
      },
      {
        id: "benchmark_internals",
        boundary: "benchmark-internals",
        pattern: new RegExp("(^|/)(benchmark|benchmarks|evals)(/|$)")
      },
      {
        id: "website_internals",
        boundary: "website-internals",
        pattern: new RegExp("(^|/)(website|site|docs-site)(/|$)")
      },
      {
        id: "generated_mirror",
        boundary: "generated-projections",
        pattern: new RegExp("(^|/)(resources|dist)(/|$)")
      },
      {
        id: "compatibility_shim",
        boundary: "compatibility-shims",
        pattern: new RegExp("(^|/)(scripts|shim|shims|compat)(/|$)")
      },
      {
        id: "node_io_builtin",
        boundary: "node-runtime",
        pattern: new RegExp(
          "^(node:)?(fs|path|os|child_process|crypto|net|http|https|process|worker_threads|readline|tty|zlib|stream|url|util|module|vm|dns|cluster)$"
        )
      }
    ]);
    DEPENDENCY_WORD = new RegExp("(^|[^A-Za-z0-9_$])(import|require)([^A-Za-z0-9_$]|$)");
    OPENERS = "([{";
    CLOSERS = ")]}";
    OPTIONAL_CALL = "optional_call";
    NEUTRAL_PURE_INTRINSIC_ROOTS = neutralFreeze([
      "Object",
      "Array",
      "String",
      "Number",
      "Boolean",
      "Math",
      "JSON",
      "RegExp",
      "Error",
      "TypeError",
      "RangeError",
      "SyntaxError",
      "Map",
      "Set",
      "Symbol",
      "isNaN",
      "isFinite",
      "parseInt",
      "parseFloat",
      "NaN",
      "Infinity",
      "undefined"
    ]);
    NEUTRAL_LANGUAGE_WORDS = neutralFreeze([
      // statement + expression keywords
      "import",
      "export",
      "from",
      "as",
      "default",
      "const",
      "let",
      "var",
      "function",
      "class",
      "extends",
      "implements",
      "return",
      "if",
      "else",
      "for",
      "while",
      "do",
      "switch",
      "case",
      "break",
      "continue",
      "new",
      "delete",
      "typeof",
      "instanceof",
      "in",
      "of",
      "void",
      "null",
      "true",
      "false",
      "throw",
      "try",
      "catch",
      "finally",
      "yield",
      "await",
      "async",
      "static",
      "public",
      "private",
      "protected",
      "readonly",
      "abstract",
      "declare",
      "namespace",
      "enum",
      "get",
      "set",
      "with",
      "debugger",
      "label",
      // type-level vocabulary (erased at runtime)
      "type",
      "interface",
      "keyof",
      "infer",
      "is",
      "asserts",
      "satisfies",
      "unique",
      "out",
      "override",
      "accessor",
      "using",
      "string",
      "number",
      "boolean",
      "unknown",
      "any",
      "never",
      "object",
      "symbol",
      "bigint",
      "Record",
      "Readonly",
      "Partial",
      "Required",
      "Pick",
      "Omit",
      "Exclude",
      "Extract",
      "ReturnType",
      "Parameters",
      "NonNullable",
      "Awaited"
    ]);
    NEUTRAL_VALUE_START_PUNCT = "=,([:;{}|&?>!+-*/%<~^";
    NEUTRAL_NON_CALLEE_WORDS = [
      "if",
      "while",
      "for",
      "switch",
      "catch",
      "do",
      "with",
      "return",
      "typeof",
      "instanceof",
      "in",
      "of",
      "void",
      "delete",
      "new",
      "yield",
      "await",
      "case",
      "else",
      "throw",
      "function",
      "import",
      "export",
      "as",
      "satisfies"
    ];
    NEUTRAL_PROTOTYPE_CHAIN_PROPERTIES = neutralFreeze([
      "constructor",
      "prototype",
      "__proto__"
    ]);
    NEUTRAL_REFLECTION_METHOD_NAMES = neutralFreeze([
      "getPrototypeOf",
      "setPrototypeOf",
      "getOwnPropertyDescriptor",
      "getOwnPropertyDescriptors",
      "getOwnPropertyNames",
      "getOwnPropertySymbols",
      "defineProperty",
      "bind",
      "call",
      "apply"
    ]);
  }
});

// ../src/modules/lifecycle/workflows/neutral-conformance-assembly.ts
function ownerKeyOfScenario(stableId) {
  if (typeof stableId !== "string") return void 0;
  const at = NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.indexOf(stableId);
  if (at === -1) return void 0;
  return OWNER_KEY_OF_SCENARIO[at];
}
function assertSourceOwnedRegistry() {
  if (NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length !== NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT) {
    throw new Error(
      `neutral-conformance-assembly: the suite tuple holds ${NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length} ids, expected ${NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT}`
    );
  }
  const seen = [];
  for (const stableId of NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS) {
    if (seen.indexOf(stableId) !== -1) {
      throw new Error(`neutral-conformance-assembly: duplicate stable id ${stableId} in the suite tuple`);
    }
    seen.push(stableId);
  }
  let total = 0;
  for (const ownerKey of NEUTRAL_CONFORMANCE_OWNER_KEYS) {
    total += NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[ownerKey];
  }
  if (total !== NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT) {
    throw new Error(
      `neutral-conformance-assembly: owner counts sum to ${total}, expected ${NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT}`
    );
  }
  const coreDeclared = NEUTRAL_CORE_SCENARIOS.map((scenario) => scenario.stable_id).slice().sort().join("|");
  const spineIds = NEUTRAL_OWNER_SCENARIO_IDS[OWNER_MH02];
  const spineDeclared = spineIds.slice().sort().join("|");
  if (coreDeclared !== spineDeclared) {
    throw new Error(
      `neutral-conformance-assembly: the ${OWNER_MH02} ids disagree with the core scenario registry (${spineDeclared} vs ${coreDeclared})`
    );
  }
}
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readOwnField(value, field) {
  if (!isRecord5(value)) return FIELD_ABSENT;
  const record = value;
  if (Object.keys(record).indexOf(field) === -1) return FIELD_ABSENT;
  return { present: true, value: record[field] };
}
function fieldOf(value, field) {
  return readOwnField(value, field).value;
}
function reportable(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}
function invalidResultField(result) {
  const outcomeType = fieldOf(result, "outcome_type");
  if (typeof outcomeType !== "string" || OUTCOME_TYPE_VOCABULARY.indexOf(outcomeType) === -1) {
    return "outcome_type";
  }
  const disposition = fieldOf(result, "disposition");
  if (typeof disposition !== "string" || DISPOSITION_VOCABULARY.indexOf(disposition) === -1) {
    return "disposition";
  }
  const reason = fieldOf(result, "reason_code");
  if (disposition === "succeeded") {
    if (reason !== null && reason !== void 0) return "reason_code";
  } else if (typeof reason !== "string" || REASON_CODE_VOCABULARY.indexOf(reason) === -1) {
    return "reason_code";
  }
  const receiptRef = fieldOf(result, "receipt_ref");
  if (typeof receiptRef !== "string" || receiptRef.length === 0) return "receipt_ref";
  const freshness = fieldOf(result, "evidence_freshness");
  if (typeof freshness !== "string" || FRESHNESS_VOCABULARY.indexOf(freshness) === -1) {
    return "evidence_freshness";
  }
  return null;
}
function identityIsComplete(identity) {
  if (!isRecord5(identity)) return false;
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    const value = fieldOf(identity, field);
    if (field === "contract_version") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}
function identityDifferences(left, right) {
  const offenders = [];
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    if (fieldOf(left, field) !== fieldOf(right, field)) offenders.push(field);
  }
  return offenders;
}
function copyIdentity(identity) {
  const copy = {};
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    copy[field] = fieldOf(identity, field);
  }
  return copy;
}
function copyResult(result) {
  const reason = fieldOf(result, "reason_code");
  return {
    stable_id: fieldOf(result, "stable_id"),
    outcome_type: fieldOf(result, "outcome_type"),
    disposition: fieldOf(result, "disposition"),
    reason_code: reason === void 0 ? null : reason,
    receipt_ref: fieldOf(result, "receipt_ref"),
    evidence_identity: copyIdentity(fieldOf(result, "evidence_identity")),
    evidence_freshness: fieldOf(result, "evidence_freshness")
  };
}
function decodeAssemblyRequest(request) {
  if (typeof request !== "string") {
    return { claim: void 0, packets: [], detail: "the request must be one canonical JSON text" };
  }
  let parsed;
  try {
    parsed = JSON.parse(request);
  } catch {
    return { claim: void 0, packets: [], detail: "the request text is not well-formed JSON" };
  }
  if (!isRecord5(parsed)) {
    return { claim: void 0, packets: [], detail: "the request text must decode to a JSON object" };
  }
  let recanonicalized;
  try {
    recanonicalized = neutralCanonicalJson(parsed);
  } catch {
    return {
      claim: void 0,
      packets: [],
      detail: "the request text could not be re-canonicalized for comparison"
    };
  }
  if (recanonicalized !== request) {
    return {
      claim: void 0,
      packets: [],
      detail: "the request text is not the canonical form of what it decodes to"
    };
  }
  const members = Object.keys(parsed).slice().sort();
  if (members.join("|") !== NEUTRAL_ASSEMBLY_REQUEST_MEMBERS.join("|")) {
    return {
      claim: void 0,
      packets: [],
      detail: "the request declares exactly the packet set and the claim, and nothing else"
    };
  }
  const packets = fieldOf(parsed, "packets");
  if (!Array.isArray(packets)) {
    return { claim: void 0, packets: [], detail: "the request's packet set must be a JSON array" };
  }
  return { claim: fieldOf(parsed, "claim"), packets, detail: null };
}
function refuse2(control, reasonCode, assertions, facts) {
  const merged = {};
  for (const key of Object.keys(facts)) merged[key] = facts[key];
  merged.refusal_control = control;
  merged.packet_schema = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;
  merged.suite_id = NEUTRAL_SCENARIO_SUITE_ID;
  merged.suite_version = NEUTRAL_SCENARIO_SUITE_VERSION;
  merged.required_scenario_count = NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT;
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "refused",
      reason_code: reasonCode,
      assertions: [...assertions],
      binding: { contract_version: NEUTRAL_CONTRACT_VERSION },
      facts: merged
    }),
    evidence: null
  };
}
function assembleNeutralConformanceEvidence(request) {
  const decoded = decodeAssemblyRequest(request);
  if (decoded.detail !== null) {
    return refuse2(
      CONTROL_REQUEST_NOT_TEXT,
      "scenario_contract_version_unrecognized",
      [
        "the assembly request is one canonical JSON text carrying exactly the packet set and the claim",
        "a direct object, array, proxy, or accessor-bearing input is refused without being inspected: no key is enumerated, no property is read or written, no descriptor is requested",
        "a text that is not the canonical form of what it decodes to is refused, so the validated snapshot is the transmitted one"
      ],
      // `typeof` answers for a proxy without reaching a trap, and the detail is
      // this module's own phrase — no fragment of the request is echoed back.
      { request_kind: typeof request, request_detail: decoded.detail }
    );
  }
  const claim = decoded.claim;
  if (!isRecord5(claim)) {
    return refuse2(
      CONTROL_IDENTITY_INCOMPLETE,
      "scenario_evidence_incomplete",
      ["an aggregate needs a claim that names its claimant and its activated runtime"],
      { incomplete_field: "claim" }
    );
  }
  if (readOwnField(claim, "required_scenario_ids").present) {
    return refuse2(
      CONTROL_CALLER_REQUIRED_SET,
      "scenario_required_set_mismatch",
      [
        "the required scenario tuple has exactly one source, and it is this module",
        "a caller-supplied tuple is refused even when it agrees, because accepting a matching copy accepts the channel that can differ"
      ],
      { claimant_id: reportable(fieldOf(claim, "claimant_id")) }
    );
  }
  const claimantId = fieldOf(claim, "claimant_id");
  if (typeof claimantId !== "string" || claimantId.length === 0) {
    return refuse2(
      CONTROL_IDENTITY_INCOMPLETE,
      "scenario_evidence_incomplete",
      ["an anonymous claim cannot be checked against anything downstream"],
      { incomplete_field: "claimant_id" }
    );
  }
  const claimIdentity = copyIdentity(fieldOf(claim, "activated_runtime"));
  if (!identityIsComplete(claimIdentity)) {
    return refuse2(
      CONTROL_IDENTITY_INCOMPLETE,
      "scenario_evidence_incomplete",
      ["the claimed activated runtime must name every field of the identity tuple"],
      { incomplete_source: "claim.activated_runtime", claimant_id: claimantId }
    );
  }
  const supplied = [];
  for (let index = 0; index < decoded.packets.length; index += 1) {
    const packet = decoded.packets[index];
    if (!isRecord5(packet) || fieldOf(packet, "schema_version") !== NEUTRAL_ASSEMBLY_PACKET_SCHEMA) {
      return refuse2(
        CONTROL_PACKET_SCHEMA,
        "scenario_contract_version_unrecognized",
        ["a packet whose schema this module does not implement cannot be interpreted"],
        {
          packet_index: index,
          declared_schema_version: reportable(fieldOf(packet, "schema_version")),
          owner_key: reportable(fieldOf(packet, "owner_key"))
        }
      );
    }
    supplied.push(packet);
  }
  const packetsByOwner = NEUTRAL_CONFORMANCE_OWNER_KEYS.map(() => []);
  const unattributable = [];
  for (const packet of supplied) {
    const ownerKey = fieldOf(packet, "owner_key");
    const at = typeof ownerKey === "string" ? NEUTRAL_CONFORMANCE_OWNER_KEYS.indexOf(ownerKey) : -1;
    if (at === -1) {
      unattributable.push(reportable(ownerKey));
      continue;
    }
    packetsByOwner[at].push(packet);
  }
  for (let ownerIndex = 0; ownerIndex < NEUTRAL_CONFORMANCE_OWNER_KEYS.length; ownerIndex += 1) {
    const ownerKey = NEUTRAL_CONFORMANCE_OWNER_KEYS[ownerIndex];
    for (const packet of packetsByOwner[ownerIndex]) {
      const suiteId = fieldOf(packet, "suite_id");
      const suiteVersion = fieldOf(packet, "suite_version");
      if (suiteId !== NEUTRAL_SCENARIO_SUITE_ID || suiteVersion !== NEUTRAL_SCENARIO_SUITE_VERSION) {
        return refuse2(
          CONTROL_SUITE_DRIFT,
          "scenario_suite_version_mismatch",
          ["a packet evaluated against another suite revision proves nothing about this one"],
          {
            owner_key: ownerKey,
            declared_suite_id: reportable(suiteId),
            declared_suite_version: reportable(suiteVersion)
          }
        );
      }
    }
  }
  const duplicated = [];
  const missing = [];
  for (let ownerIndex = 0; ownerIndex < NEUTRAL_CONFORMANCE_OWNER_KEYS.length; ownerIndex += 1) {
    const supplyCount = packetsByOwner[ownerIndex].length;
    if (supplyCount > 1) duplicated.push(NEUTRAL_CONFORMANCE_OWNER_KEYS[ownerIndex]);
    if (supplyCount === 0) missing.push(NEUTRAL_CONFORMANCE_OWNER_KEYS[ownerIndex]);
  }
  if (duplicated.length > 0) {
    return refuse2(
      CONTROL_OWNER_DUPLICATED,
      "scenario_required_set_mismatch",
      [
        "each owner speaks once",
        "two packets for one owner leave the aggregate free to pick the more convenient of them"
      ],
      { duplicated_owner_keys: [...duplicated], supplied_packet_count: supplied.length }
    );
  }
  if (missing.length > 0 || unattributable.length > 0) {
    return refuse2(
      CONTROL_OWNER_MISSING,
      "scenario_evidence_incomplete",
      [
        "the aggregate covers the whole suite or it covers nothing",
        "a packet attributable to no declared owner cannot stand in for one"
      ],
      {
        missing_owner_keys: [...missing],
        unattributable_owner_keys: [...unattributable],
        supplied_packet_count: supplied.length
      }
    );
  }
  for (let ownerIndex = 0; ownerIndex < NEUTRAL_CONFORMANCE_OWNER_KEYS.length; ownerIndex += 1) {
    const ownerKey = NEUTRAL_CONFORMANCE_OWNER_KEYS[ownerIndex];
    const packet = packetsByOwner[ownerIndex][0];
    const expectedCount = NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[ownerKey];
    const declaredIdsValue = fieldOf(packet, "stable_ids");
    const resultsValue = fieldOf(packet, "results");
    const declaredIds = Array.isArray(declaredIdsValue) ? declaredIdsValue : [];
    const results = Array.isArray(resultsValue) ? resultsValue : [];
    if (declaredIds.length !== expectedCount || results.length !== expectedCount) {
      return refuse2(
        CONTROL_OWNER_COUNT,
        "scenario_required_set_mismatch",
        ["an owner covers exactly the scenarios the closed table assigns it"],
        {
          owner_key: ownerKey,
          expected_scenario_count: expectedCount,
          declared_id_count: declaredIds.length,
          declared_result_count: results.length
        }
      );
    }
    const seenInPacket = [];
    for (let position = 0; position < declaredIds.length; position += 1) {
      const stableId = declaredIds[position];
      if (typeof stableId === "string" && seenInPacket.indexOf(stableId) !== -1) {
        return refuse2(
          CONTROL_ID_DUPLICATED,
          "scenario_required_set_mismatch",
          ["a repeated id pads coverage without evaluating anything"],
          { owner_key: ownerKey, stable_id: stableId, position }
        );
      }
      if (typeof stableId === "string") seenInPacket.push(stableId);
      const declaredOwner = ownerKeyOfScenario(stableId);
      if (declaredOwner === void 0) {
        return refuse2(
          CONTROL_ID_FOREIGN,
          "scenario_required_set_mismatch",
          ["the suite tuple is closed, so an id it does not contain is not a scenario"],
          { owner_key: ownerKey, stable_id: reportable(stableId), position }
        );
      }
      if (declaredOwner !== ownerKey) {
        return refuse2(
          CONTROL_ID_OWNER_MISMATCH,
          "scenario_required_set_mismatch",
          [
            "each scenario has exactly one owner",
            "an owner claiming another owner's id would let one boundary vouch for a boundary it never ran"
          ],
          { owner_key: ownerKey, stable_id: stableId, declared_owner_key: declaredOwner, position }
        );
      }
      const resultId = fieldOf(results[position], "stable_id");
      if (resultId !== stableId) {
        return refuse2(
          CONTROL_RESULT_ORDER,
          "scenario_results_unordered",
          [
            "results are ordered against the ids they answer",
            "an unordered pairing attributes an outcome to a scenario that did not produce it"
          ],
          {
            owner_key: ownerKey,
            position,
            expected_stable_id: stableId,
            result_stable_id: reportable(resultId)
          }
        );
      }
    }
  }
  for (let ownerIndex = 0; ownerIndex < NEUTRAL_CONFORMANCE_OWNER_KEYS.length; ownerIndex += 1) {
    const ownerKey = NEUTRAL_CONFORMANCE_OWNER_KEYS[ownerIndex];
    const packet = packetsByOwner[ownerIndex][0];
    const results = fieldOf(packet, "results");
    for (let position = 0; position < results.length; position += 1) {
      const invalidField = invalidResultField(results[position]);
      if (invalidField !== null) {
        return refuse2(
          CONTROL_RESULT_CONTRACT,
          "scenario_result_mismatch",
          [
            "every assembled result satisfies the runtime result contract before it is copied",
            "outcome type, disposition, reason-code coupling, receipt reference, and freshness are read against the vocabularies the core exports",
            "the refusal names the offending field, so the owner whose evaluator produced it is actionable"
          ],
          {
            owner_key: ownerKey,
            position,
            stable_id: reportable(fieldOf(results[position], "stable_id")),
            invalid_field: invalidField
          }
        );
      }
    }
  }
  for (let ownerIndex = 0; ownerIndex < NEUTRAL_CONFORMANCE_OWNER_KEYS.length; ownerIndex += 1) {
    const ownerKey = NEUTRAL_CONFORMANCE_OWNER_KEYS[ownerIndex];
    const packet = packetsByOwner[ownerIndex][0];
    const packetIdentity = fieldOf(packet, "evidence_identity");
    if (!identityIsComplete(packetIdentity)) {
      return refuse2(
        CONTROL_IDENTITY_INCOMPLETE,
        "scenario_evidence_incomplete",
        ["a packet that does not name the whole identity tuple is not bound to any runtime"],
        { owner_key: ownerKey, incomplete_source: "packet.evidence_identity" }
      );
    }
    const results = fieldOf(packet, "results");
    for (let position = 0; position < results.length; position += 1) {
      if (!identityIsComplete(fieldOf(results[position], "evidence_identity"))) {
        return refuse2(
          CONTROL_IDENTITY_INCOMPLETE,
          "scenario_evidence_incomplete",
          ["every single result names the whole identity tuple it was produced under"],
          {
            owner_key: ownerKey,
            position,
            stable_id: reportable(fieldOf(results[position], "stable_id")),
            incomplete_source: "result.evidence_identity"
          }
        );
      }
    }
    const packetDifferences = identityDifferences(packetIdentity, claimIdentity);
    if (packetDifferences.length > 0) {
      return refuse2(
        CONTROL_IDENTITY_MISMATCH,
        "scenario_identity_binding_mismatch",
        ["an aggregate assembled across two runtimes is evidence about neither"],
        {
          owner_key: ownerKey,
          differing_fields: packetDifferences,
          source: "packet.evidence_identity"
        }
      );
    }
    for (let position = 0; position < results.length; position += 1) {
      const differences = identityDifferences(
        fieldOf(results[position], "evidence_identity"),
        claimIdentity
      );
      if (differences.length > 0) {
        return refuse2(
          CONTROL_IDENTITY_MISMATCH,
          "scenario_identity_binding_mismatch",
          ["one result produced under a different identity contaminates the whole aggregate"],
          {
            owner_key: ownerKey,
            position,
            stable_id: reportable(fieldOf(results[position], "stable_id")),
            differing_fields: differences,
            source: "result.evidence_identity"
          }
        );
      }
    }
  }
  const orderedResults = [];
  for (let index = 0; index < NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length; index += 1) {
    const stableId = NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[index];
    const ownerKey = OWNER_KEY_OF_SCENARIO[index];
    const ownerIndex = NEUTRAL_CONFORMANCE_OWNER_KEYS.indexOf(ownerKey);
    const packet = packetsByOwner[ownerIndex][0];
    const declaredIds = fieldOf(packet, "stable_ids");
    const results = fieldOf(packet, "results");
    const position = declaredIds.indexOf(stableId);
    if (position === -1) {
      return refuse2(
        CONTROL_ID_FOREIGN,
        "scenario_required_set_mismatch",
        ["a required scenario has no result in its owner's packet"],
        { owner_key: ownerKey, stable_id: stableId }
      );
    }
    orderedResults.push(copyResult(results[position]));
  }
  const evidence = neutralFreeze({
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    required_scenario_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS],
    activated_runtime: copyIdentity(claimIdentity),
    results: orderedResults,
    claimant_id: claimantId
  });
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "succeeded",
      assertions: [
        "one packet per declared owner, each covering exactly its assigned scenarios",
        "the required tuple and its order are source-owned, and the aggregate follows it",
        "every assembled result satisfies the runtime result contract",
        "one identity binds every packet, every result, and the claim",
        "the request arrived as one canonical JSON text, so nothing inherited, accessor-backed, or proxied could enter and no caller code ran",
        "assembly takes no promotion decision and verifies no signature"
      ],
      binding: { contract_version: NEUTRAL_CONTRACT_VERSION },
      facts: {
        packet_count: NEUTRAL_CONFORMANCE_OWNER_KEYS.length,
        result_count: orderedResults.length,
        required_scenario_count: NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT,
        owner_keys: [...NEUTRAL_CONFORMANCE_OWNER_KEYS],
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        packet_schema: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
        claimant_id: claimantId
      }
    }),
    evidence
  };
}
function controlIdentityWith(overrides) {
  const copy = {};
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    copy[field] = fieldOf(CONTROL_IDENTITY, field);
  }
  for (const key of Object.keys(overrides)) copy[key] = overrides[key];
  return copy;
}
function controlCommitment(sequence) {
  let hex = (sequence >>> 0).toString(16);
  while (hex.length < 16) hex = `0${hex}`;
  return `nec1:${hex}`;
}
function controlResultFor(stableId, overrides = {}) {
  const sequence = NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.indexOf(stableId) + 1;
  const result = {
    stable_id: stableId,
    outcome_type: "guild.lifecycle_outcome.v1",
    disposition: "succeeded",
    reason_code: null,
    receipt_ref: `guild.receipt_ref.v1:a21s-control#${sequence}@${controlCommitment(sequence)}`,
    evidence_identity: CONTROL_IDENTITY,
    evidence_freshness: "fresh"
  };
  for (const key of Object.keys(overrides)) result[key] = overrides[key];
  return result;
}
function controlPacketFor(ownerKey, overrides = {}) {
  const declared = NEUTRAL_OWNER_SCENARIO_IDS[ownerKey];
  const ids = declared === void 0 ? [] : declared;
  const packet = {
    schema_version: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    owner_key: ownerKey,
    evidence_identity: CONTROL_IDENTITY,
    stable_ids: ids.slice(),
    results: ids.map((stableId) => controlResultFor(stableId))
  };
  for (const key of Object.keys(overrides)) packet[key] = overrides[key];
  return packet;
}
function controlPackets() {
  return NEUTRAL_CONFORMANCE_OWNER_KEYS.map((ownerKey) => controlPacketFor(ownerKey));
}
function controlPacketsWith(ownerKey, replacement) {
  const packets = [];
  for (const key of NEUTRAL_CONFORMANCE_OWNER_KEYS) {
    if (key !== ownerKey) {
      packets.push(controlPacketFor(key));
      continue;
    }
    if (replacement !== null) packets.push(replacement);
  }
  return packets;
}
function controlIdsFor(ownerKey) {
  return NEUTRAL_OWNER_SCENARIO_IDS[ownerKey];
}
function controlPacketWithResultAt(ownerKey, position, replacement) {
  const ids = controlIdsFor(ownerKey);
  const results = ids.map((stableId) => controlResultFor(stableId));
  results[position] = replacement;
  return controlPacketFor(ownerKey, { results });
}
function controlThroughPrototype(value) {
  return Object.create(value);
}
function controlRequestText(packets, claim) {
  return neutralCanonicalJson({ packets, claim });
}
function refusesRawWith(implementation, request, control) {
  let result;
  try {
    result = implementation(request);
  } catch {
    return false;
  }
  if (!isRecord5(result) || result.evidence !== null) return false;
  const outcome = result.outcome;
  if (!isRecord5(outcome) || outcome.disposition !== "refused") return false;
  return fieldOf(outcome.facts, "refusal_control") === control;
}
function refusesWith(implementation, packets, claim, control) {
  let result;
  try {
    result = implementation(controlRequestText(packets, claim));
  } catch {
    return false;
  }
  if (!isRecord5(result) || result.evidence !== null) return false;
  const outcome = result.outcome;
  if (!isRecord5(outcome) || outcome.disposition !== "refused") return false;
  return fieldOf(outcome.facts, "refusal_control") === control;
}
function refusesSafely(implementation, packets, claim) {
  let result;
  try {
    result = implementation(controlRequestText(packets, claim));
  } catch {
    return false;
  }
  if (!isRecord5(result) || result.evidence !== null) return false;
  const outcome = result.outcome;
  if (!isRecord5(outcome) || outcome.disposition !== "refused") return false;
  const control = fieldOf(outcome.facts, "refusal_control");
  if (typeof control !== "string") return false;
  return NEUTRAL_ASSEMBLY_REFUSAL_CONTROLS.indexOf(control) !== -1;
}
function acceptedEvidence(implementation, packets, claim) {
  let result;
  try {
    result = implementation(controlRequestText(packets, claim));
  } catch {
    return null;
  }
  if (!isRecord5(result) || !isRecord5(result.outcome)) return null;
  if (result.outcome.disposition !== "succeeded") return null;
  return isRecord5(result.evidence) ? result.evidence : null;
}
function sameIdList(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) return false;
  }
  return true;
}
var OWNER_MH02, OWNER_MH03, OWNER_MH06, OWNER_MH07, OWNER_MH08, OWNER_MH09, NEUTRAL_SUITE_SCENARIO_OWNERSHIP, NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT, NEUTRAL_CONFORMANCE_OWNER_KEYS, NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS, OWNER_KEY_OF_SCENARIO, ownerScenarioIds, NEUTRAL_OWNER_SCENARIO_IDS, ownerScenarioCounts, NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS, NEUTRAL_ASSEMBLY_PACKET_SCHEMA, NEUTRAL_ASSEMBLY_REQUEST_MEMBERS, CONTROL_OWNER_MISSING, CONTROL_OWNER_DUPLICATED, CONTROL_OWNER_COUNT, CONTROL_ID_DUPLICATED, CONTROL_ID_FOREIGN, CONTROL_ID_OWNER_MISMATCH, CONTROL_RESULT_ORDER, CONTROL_SUITE_DRIFT, CONTROL_IDENTITY_MISMATCH, CONTROL_CALLER_REQUIRED_SET, CONTROL_PACKET_SCHEMA, CONTROL_IDENTITY_INCOMPLETE, CONTROL_RESULT_CONTRACT, CONTROL_REQUEST_NOT_TEXT, NEUTRAL_ASSEMBLY_REFUSAL_CONTROLS, FIELD_ABSENT, OUTCOME_TYPE_VOCABULARY, DISPOSITION_VOCABULARY, REASON_CODE_VOCABULARY, FRESHNESS_VOCABULARY, CONTROL_IDENTITY, CONTROL_OTHER_IDENTITY, CONTROL_CLAIMANT_ID, CONTROL_FORGED_OWNER_KEYS, CONTROL_CLAIM, NEUTRAL_ASSEMBLY_CONTROL_BATTERY, NEUTRAL_ASSEMBLY_CONTROLS;
var init_neutral_conformance_assembly = __esm({
  "../src/modules/lifecycle/workflows/neutral-conformance-assembly.ts"() {
    init_neutral_runtime_contracts();
    init_neutral_conformance_core();
    OWNER_MH02 = NEUTRAL_CORE_WAVE_OWNER.key;
    OWNER_MH03 = "W2/MH-03";
    OWNER_MH06 = "W1/MH-06";
    OWNER_MH07 = "W4/MH-07";
    OWNER_MH08 = "W4/MH-08";
    OWNER_MH09 = "W5/MH-09";
    NEUTRAL_SUITE_SCENARIO_OWNERSHIP = neutralFreeze([
      { stable_id: "MHRC-LIF-001", owner_key: OWNER_MH02 },
      { stable_id: "MHRC-LIF-002", owner_key: OWNER_MH02 },
      { stable_id: "MHRC-LIF-003", owner_key: OWNER_MH02 },
      { stable_id: "MHRC-LIF-004", owner_key: OWNER_MH02 },
      { stable_id: "MHRC-EVT-001", owner_key: OWNER_MH03 },
      { stable_id: "MHRC-EVT-002", owner_key: OWNER_MH03 },
      { stable_id: "MHRC-SUP-001", owner_key: OWNER_MH09 },
      { stable_id: "MHRC-SUP-002", owner_key: OWNER_MH09 },
      { stable_id: "MHRC-SUP-003", owner_key: OWNER_MH09 },
      { stable_id: "MHRC-SUP-004", owner_key: OWNER_MH09 },
      { stable_id: "MHRC-SUP-005", owner_key: OWNER_MH09 },
      { stable_id: "MHRC-SUP-006", owner_key: OWNER_MH09 },
      { stable_id: "MHRC-UNS-001", owner_key: OWNER_MH03 },
      { stable_id: "MHRC-UNS-002", owner_key: OWNER_MH02 },
      { stable_id: "MHRC-UNS-003", owner_key: OWNER_MH03 },
      { stable_id: "MHRC-RCT-001", owner_key: OWNER_MH06 },
      { stable_id: "MHRC-RCT-002", owner_key: OWNER_MH06 },
      { stable_id: "MHRC-RCT-003", owner_key: OWNER_MH06 },
      { stable_id: "MHRC-RCT-004", owner_key: OWNER_MH06 },
      { stable_id: "MHRC-RCT-005", owner_key: OWNER_MH06 },
      { stable_id: "MHRC-MOD-001", owner_key: OWNER_MH07 },
      { stable_id: "MHRC-MOD-002", owner_key: OWNER_MH07 },
      { stable_id: "MHRC-MOD-003", owner_key: OWNER_MH07 },
      { stable_id: "MHRC-MOD-004", owner_key: OWNER_MH07 },
      { stable_id: "MHRC-STR-001", owner_key: OWNER_MH08 },
      { stable_id: "MHRC-STR-002", owner_key: OWNER_MH08 },
      { stable_id: "MHRC-STR-003", owner_key: OWNER_MH08 },
      { stable_id: "MHRC-STR-004", owner_key: OWNER_MH08 },
      { stable_id: "MHRC-VER-001", owner_key: OWNER_MH09 },
      { stable_id: "MHRC-VER-002", owner_key: OWNER_MH09 },
      { stable_id: "MHRC-VER-003", owner_key: OWNER_MH09 }
    ]);
    NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT = 31;
    NEUTRAL_CONFORMANCE_OWNER_KEYS = neutralFreeze([
      OWNER_MH02,
      OWNER_MH03,
      OWNER_MH06,
      OWNER_MH07,
      OWNER_MH08,
      OWNER_MH09
    ]);
    NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS = neutralFreeze(
      NEUTRAL_SUITE_SCENARIO_OWNERSHIP.map((registration) => registration.stable_id)
    );
    OWNER_KEY_OF_SCENARIO = neutralFreeze(
      NEUTRAL_SUITE_SCENARIO_OWNERSHIP.map((registration) => registration.owner_key)
    );
    ownerScenarioIds = {};
    for (const ownerKey of NEUTRAL_CONFORMANCE_OWNER_KEYS) ownerScenarioIds[ownerKey] = [];
    for (const registration of NEUTRAL_SUITE_SCENARIO_OWNERSHIP) {
      const bucket = ownerScenarioIds[registration.owner_key];
      if (bucket === void 0) {
        throw new Error(
          `neutral-conformance-assembly: ${registration.stable_id} names owner ${registration.owner_key}, which is not a declared owner`
        );
      }
      bucket.push(registration.stable_id);
    }
    NEUTRAL_OWNER_SCENARIO_IDS = neutralFreeze(ownerScenarioIds);
    ownerScenarioCounts = {};
    for (const ownerKey of NEUTRAL_CONFORMANCE_OWNER_KEYS) {
      ownerScenarioCounts[ownerKey] = ownerScenarioIds[ownerKey].length;
    }
    NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS = neutralFreeze(ownerScenarioCounts);
    assertSourceOwnedRegistry();
    NEUTRAL_ASSEMBLY_PACKET_SCHEMA = "guild.conformance_owner_packet.v1";
    NEUTRAL_ASSEMBLY_REQUEST_MEMBERS = neutralFreeze(["claim", "packets"]);
    CONTROL_OWNER_MISSING = "owner_packet_missing";
    CONTROL_OWNER_DUPLICATED = "owner_packet_duplicated";
    CONTROL_OWNER_COUNT = "owner_scenario_count_mismatch";
    CONTROL_ID_DUPLICATED = "stable_id_duplicated";
    CONTROL_ID_FOREIGN = "stable_id_foreign";
    CONTROL_ID_OWNER_MISMATCH = "stable_id_owner_mismatch";
    CONTROL_RESULT_ORDER = "result_order_mismatch";
    CONTROL_SUITE_DRIFT = "suite_identity_drift";
    CONTROL_IDENTITY_MISMATCH = "evidence_identity_mismatch";
    CONTROL_CALLER_REQUIRED_SET = "caller_supplied_required_set";
    CONTROL_PACKET_SCHEMA = "packet_schema_unrecognized";
    CONTROL_IDENTITY_INCOMPLETE = "evidence_identity_incomplete";
    CONTROL_RESULT_CONTRACT = "result_contract_invalid";
    CONTROL_REQUEST_NOT_TEXT = "assembly_request_not_canonical_text";
    NEUTRAL_ASSEMBLY_REFUSAL_CONTROLS = neutralFreeze([
      CONTROL_OWNER_MISSING,
      CONTROL_OWNER_DUPLICATED,
      CONTROL_OWNER_COUNT,
      CONTROL_ID_DUPLICATED,
      CONTROL_ID_FOREIGN,
      CONTROL_ID_OWNER_MISMATCH,
      CONTROL_RESULT_ORDER,
      CONTROL_SUITE_DRIFT,
      CONTROL_IDENTITY_MISMATCH,
      CONTROL_CALLER_REQUIRED_SET,
      CONTROL_PACKET_SCHEMA,
      CONTROL_IDENTITY_INCOMPLETE,
      CONTROL_RESULT_CONTRACT,
      CONTROL_REQUEST_NOT_TEXT
    ]);
    FIELD_ABSENT = neutralFreeze({
      present: false,
      value: void 0
    });
    OUTCOME_TYPE_VOCABULARY = NEUTRAL_OUTCOME_TYPES;
    DISPOSITION_VOCABULARY = NEUTRAL_DISPOSITIONS;
    REASON_CODE_VOCABULARY = NEUTRAL_REASON_CODES;
    FRESHNESS_VOCABULARY = NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS;
    CONTROL_IDENTITY = {
      source_commit: "7d1f0c6a4b93e28517ac6f30d5b8291e4c07ab63",
      package_hash: "sha256:3f9c1d8e2a640b57ef03c9d41a86b5720ed3f814c62a09bd57e1403f8ca92b6d",
      runtime_version: "guild-2.5.0",
      adapter_version: "guild.host_adapter.v1.0.0",
      host_id: "claude-code-cli",
      host_version: "2.5.0",
      platform: "darwin-arm64",
      contract_version: NEUTRAL_CONTRACT_VERSION,
      scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      release_id: "rel-2026-08-18-a21s"
    };
    CONTROL_OTHER_IDENTITY = controlIdentityWith({
      source_commit: "2b840ce15fa9376d0c4e8b21af5730d96e1c48a7"
    });
    CONTROL_CLAIMANT_ID = "guild.release-emitter";
    CONTROL_FORGED_OWNER_KEYS = neutralFreeze([
      "__proto__",
      "constructor"
    ]);
    CONTROL_CLAIM = {
      claimant_id: CONTROL_CLAIMANT_ID,
      activated_runtime: CONTROL_IDENTITY
    };
    NEUTRAL_ASSEMBLY_CONTROL_BATTERY = [
      {
        id: "A21S-C01-canonical-order",
        title: "six valid packets assemble into the 31 required ids, in contract order",
        check: (implementation) => {
          const shuffled = controlPackets().reverse();
          const evidence = acceptedEvidence(implementation, shuffled, CONTROL_CLAIM);
          if (evidence === null) return false;
          return sameIdList(
            evidence.results.map((result) => result.stable_id),
            NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS
          ) && sameIdList(evidence.required_scenario_ids, NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS);
        }
      },
      {
        id: "A21S-C02-owner-packet-missing",
        title: "an absent owner packet is refused, never treated as zero scenarios",
        check: (implementation) => refusesWith(
          implementation,
          controlPacketsWith(OWNER_MH08, null),
          CONTROL_CLAIM,
          CONTROL_OWNER_MISSING
        )
      },
      {
        id: "A21S-C03-owner-packet-duplicated",
        title: "two packets for one owner are refused",
        check: (implementation) => {
          const packets = controlPackets();
          packets.push(controlPacketFor(OWNER_MH06));
          return refusesWith(implementation, packets, CONTROL_CLAIM, CONTROL_OWNER_DUPLICATED);
        }
      },
      {
        id: "A21S-C04-owner-scenario-count",
        title: "an owner covering fewer scenarios than the closed table assigns it is refused",
        check: (implementation) => {
          const ids = controlIdsFor(OWNER_MH09);
          const short = ids.slice(0, ids.length - 1);
          const trimmed = controlPacketFor(OWNER_MH09, {
            stable_ids: short,
            results: short.map((stableId) => controlResultFor(stableId))
          });
          return refusesWith(
            implementation,
            controlPacketsWith(OWNER_MH09, trimmed),
            CONTROL_CLAIM,
            CONTROL_OWNER_COUNT
          );
        }
      },
      {
        id: "A21S-C05-stable-id-duplicated",
        title: "a repeated stable id is refused, not counted twice",
        check: (implementation) => {
          const ids = controlIdsFor(OWNER_MH07);
          const repeated = [ids[0], ids[0], ids[2], ids[3]];
          const duplicated = controlPacketFor(OWNER_MH07, {
            stable_ids: repeated,
            results: repeated.map((stableId) => controlResultFor(stableId))
          });
          return refusesWith(
            implementation,
            controlPacketsWith(OWNER_MH07, duplicated),
            CONTROL_CLAIM,
            CONTROL_ID_DUPLICATED
          );
        }
      },
      {
        id: "A21S-C06-stable-id-foreign",
        title: "an id outside the closed suite tuple is refused",
        check: (implementation) => {
          const ids = controlIdsFor(OWNER_MH03);
          const invented = [ids[0], ids[1], ids[2], "MHRC-CONTROL-FORGED-001"];
          const foreign = controlPacketFor(OWNER_MH03, {
            stable_ids: invented,
            results: invented.map((stableId) => controlResultFor(stableId))
          });
          return refusesWith(
            implementation,
            controlPacketsWith(OWNER_MH03, foreign),
            CONTROL_CLAIM,
            CONTROL_ID_FOREIGN
          );
        }
      },
      {
        id: "A21S-C07-stable-id-owner-mismatch",
        title: "an owner claiming another owner's id is refused",
        check: (implementation) => {
          const ids = controlIdsFor(OWNER_MH03);
          const poached = [ids[0], ids[1], ids[2], controlIdsFor(OWNER_MH06)[0]];
          const packet = controlPacketFor(OWNER_MH03, {
            stable_ids: poached,
            results: poached.map((stableId) => controlResultFor(stableId))
          });
          return refusesWith(
            implementation,
            controlPacketsWith(OWNER_MH03, packet),
            CONTROL_CLAIM,
            CONTROL_ID_OWNER_MISMATCH
          );
        }
      },
      {
        id: "A21S-C08-result-order-mismatch",
        title: "results not ordered against the packet's ids are refused",
        check: (implementation) => {
          const ids = controlIdsFor(OWNER_MH02);
          const misordered = [ids[1], ids[0], ...ids.slice(2)];
          const packet = controlPacketFor(OWNER_MH02, {
            results: misordered.map((stableId) => controlResultFor(stableId))
          });
          return refusesWith(
            implementation,
            controlPacketsWith(OWNER_MH02, packet),
            CONTROL_CLAIM,
            CONTROL_RESULT_ORDER
          );
        }
      },
      {
        id: "A21S-C09-suite-identity-drift",
        title: "a packet evaluated against another suite revision is refused",
        check: (implementation) => {
          const drifted = controlPacketFor(OWNER_MH08, { suite_version: "9.9.9" });
          return refusesWith(
            implementation,
            controlPacketsWith(OWNER_MH08, drifted),
            CONTROL_CLAIM,
            CONTROL_SUITE_DRIFT
          );
        }
      },
      {
        id: "A21S-C10-evidence-identity-mismatch",
        title: "an identity that disagrees across packets or with the claim is refused",
        check: (implementation) => {
          const other = controlPacketFor(OWNER_MH06, { evidence_identity: CONTROL_OTHER_IDENTITY });
          return refusesWith(
            implementation,
            controlPacketsWith(OWNER_MH06, other),
            CONTROL_CLAIM,
            CONTROL_IDENTITY_MISMATCH
          );
        }
      },
      {
        id: "A21S-C11-caller-required-set",
        title: "a caller that supplies its own required set is refused, even when it agrees",
        check: (implementation) => refusesWith(
          implementation,
          controlPackets(),
          {
            claimant_id: CONTROL_CLAIMANT_ID,
            activated_runtime: CONTROL_IDENTITY,
            required_scenario_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS]
          },
          CONTROL_CALLER_REQUIRED_SET
        )
      },
      {
        id: "A21S-C12-packet-input-order-independence",
        title: "the aggregate is byte-identical whatever order the packets arrive in",
        check: (implementation) => {
          const first = acceptedEvidence(implementation, controlPackets(), CONTROL_CLAIM);
          const rotatedPackets = controlPackets();
          rotatedPackets.push(rotatedPackets.shift());
          const rotated = acceptedEvidence(implementation, rotatedPackets, CONTROL_CLAIM);
          if (first === null || rotated === null) return false;
          return neutralCanonicalJson(first) === neutralCanonicalJson(rotated);
        }
      },
      {
        id: "A21S-C13-output-immutability",
        title: "the aggregate is deeply frozen, so no consumer can edit it after the fact",
        check: (implementation) => {
          const evidence = acceptedEvidence(implementation, controlPackets(), CONTROL_CLAIM);
          if (evidence === null) return false;
          if (!Object.isFrozen(evidence)) return false;
          if (!Object.isFrozen(evidence.results)) return false;
          if (!Object.isFrozen(evidence.required_scenario_ids)) return false;
          if (!Object.isFrozen(evidence.activated_runtime)) return false;
          for (const result of evidence.results) {
            if (!Object.isFrozen(result)) return false;
            if (!Object.isFrozen(result.evidence_identity)) return false;
          }
          return true;
        }
      },
      {
        id: "A21S-C14-packet-schema-versioned",
        title: "a packet that does not declare the pinned packet schema is refused",
        check: (implementation) => {
          const drifted = controlPacketFor(OWNER_MH06, {
            schema_version: "guild.conformance_owner_packet.v99"
          });
          return refusesWith(
            implementation,
            controlPacketsWith(OWNER_MH06, drifted),
            CONTROL_CLAIM,
            CONTROL_PACKET_SCHEMA
          );
        }
      },
      {
        id: "A21S-C15-evidence-identity-complete",
        title: "an identity missing any field of the tuple is refused",
        check: (implementation) => {
          const incomplete = {};
          for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
            if (field === "platform") continue;
            incomplete[field] = fieldOf(CONTROL_IDENTITY, field);
          }
          const packet = controlPacketFor(OWNER_MH09, { evidence_identity: incomplete });
          return refusesWith(
            implementation,
            controlPacketsWith(OWNER_MH09, packet),
            CONTROL_CLAIM,
            CONTROL_IDENTITY_INCOMPLETE
          );
        }
      },
      {
        id: "A21S-C16-result-contract-validated",
        title: "a result violating the runtime result contract is refused, never copied into the aggregate",
        check: (implementation) => {
          const malformed = [
            controlPacketWithResultAt(
              OWNER_MH02,
              0,
              controlResultFor(controlIdsFor(OWNER_MH02)[0], { outcome_type: "guild.invented.v9" })
            ),
            controlPacketWithResultAt(
              OWNER_MH03,
              1,
              controlResultFor(controlIdsFor(OWNER_MH03)[1], { disposition: 42 })
            ),
            controlPacketWithResultAt(
              OWNER_MH06,
              2,
              controlResultFor(controlIdsFor(OWNER_MH06)[2], {
                disposition: "refused",
                reason_code: "invented_reason"
              })
            ),
            controlPacketWithResultAt(
              OWNER_MH07,
              3,
              controlResultFor(controlIdsFor(OWNER_MH07)[3], { receipt_ref: null })
            ),
            controlPacketWithResultAt(
              OWNER_MH08,
              0,
              controlResultFor(controlIdsFor(OWNER_MH08)[0], { evidence_freshness: "invented" })
            ),
            controlPacketWithResultAt(
              OWNER_MH09,
              8,
              controlResultFor(controlIdsFor(OWNER_MH09)[8], {
                disposition: "succeeded",
                reason_code: "policy_denied"
              })
            )
          ];
          for (let index = 0; index < malformed.length; index += 1) {
            const ownerKey = NEUTRAL_CONFORMANCE_OWNER_KEYS[index];
            const packets = controlPacketsWith(ownerKey, malformed[index]);
            if (!refusesWith(implementation, packets, CONTROL_CLAIM, CONTROL_RESULT_CONTRACT)) {
              return false;
            }
          }
          for (const verdict of FRESHNESS_VOCABULARY) {
            const ids = controlIdsFor(OWNER_MH08);
            const fresh = controlPacketFor(OWNER_MH08, {
              results: ids.map((stableId) => controlResultFor(stableId, { evidence_freshness: verdict }))
            });
            const packets = controlPacketsWith(OWNER_MH08, fresh);
            if (acceptedEvidence(implementation, packets, CONTROL_CLAIM) === null) return false;
          }
          const failing = controlPacketWithResultAt(
            OWNER_MH03,
            0,
            controlResultFor(controlIdsFor(OWNER_MH03)[0], {
              disposition: "failed",
              reason_code: "execution_failed"
            })
          );
          const accepted = acceptedEvidence(
            implementation,
            controlPacketsWith(OWNER_MH03, failing),
            CONTROL_CLAIM
          );
          return accepted !== null;
        }
      },
      {
        id: "A21S-C17-untrusted-shape-safe-reads",
        title: "prototype-supplied object requests and prototype-named owner keys refuse, never throw or pass",
        check: (implementation) => {
          const inheritedSet = controlThroughPrototype({
            required_scenario_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS]
          });
          inheritedSet.claimant_id = CONTROL_CLAIMANT_ID;
          inheritedSet.activated_runtime = CONTROL_IDENTITY;
          const inheritedClaim = controlThroughPrototype(CONTROL_CLAIM);
          const inheritedPackets = controlPackets().map((packet) => controlThroughPrototype(packet));
          const objectRequests = [
            { packets: controlPackets(), claim: inheritedSet },
            { packets: controlPackets(), claim: inheritedClaim },
            { packets: inheritedPackets, claim: CONTROL_CLAIM }
          ];
          for (const objectRequest of objectRequests) {
            if (!refusesRawWith(implementation, objectRequest, CONTROL_REQUEST_NOT_TEXT)) return false;
          }
          const ownSetClaim = {
            claimant_id: CONTROL_CLAIMANT_ID,
            activated_runtime: CONTROL_IDENTITY,
            required_scenario_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS]
          };
          if (!refusesWith(
            implementation,
            controlPackets(),
            ownSetClaim,
            CONTROL_CALLER_REQUIRED_SET
          )) {
            return false;
          }
          for (const forgedKey of CONTROL_FORGED_OWNER_KEYS) {
            const extra = controlPackets();
            extra.push(controlPacketFor(OWNER_MH02, { owner_key: forgedKey }));
            if (!refusesWith(implementation, extra, CONTROL_CLAIM, CONTROL_OWNER_MISSING)) return false;
            const impostor = controlPacketFor(OWNER_MH07, { owner_key: forgedKey });
            const replaced = controlPacketsWith(OWNER_MH07, impostor);
            if (!refusesWith(implementation, replaced, CONTROL_CLAIM, CONTROL_OWNER_MISSING)) {
              return false;
            }
          }
          return acceptedEvidence(implementation, controlPackets(), CONTROL_CLAIM) !== null;
        }
      },
      {
        id: "A21S-C18-canonical-text-request",
        title: "the request is one canonical JSON text: a non-string request, malformed text, or non-canonical text is refused, and only the canonical form assembles",
        check: (implementation) => {
          const nonText = [
            controlPackets(),
            { packets: controlPackets(), claim: CONTROL_CLAIM },
            CONTROL_CLAIM,
            null,
            void 0,
            7,
            true
          ];
          for (const candidate of nonText) {
            if (!refusesRawWith(implementation, candidate, CONTROL_REQUEST_NOT_TEXT)) return false;
          }
          const canonical = controlRequestText(controlPackets(), CONTROL_CLAIM);
          const malformed = [
            "",
            "{",
            "not json at all",
            "[]",
            '"a string is valid JSON, and is not a request"',
            // Valid JSON with the right members in the WRONG order: identical once
            // decoded, different bytes, so it is not the canonical form.
            `{"packets":[],"claim":{}}`,
            // The canonical text with insignificant padding — same decode, different
            // bytes.
            ` ${canonical}`,
            // An undeclared top-level member is a channel this contract does not have.
            neutralCanonicalJson({ packets: controlPackets(), claim: CONTROL_CLAIM, mode: "lenient" }),
            // The packet set must be a JSON array, not an object holding packets.
            neutralCanonicalJson({ packets: { first: controlPacketFor(OWNER_MH02) }, claim: CONTROL_CLAIM })
          ];
          for (const candidate of malformed) {
            if (!refusesRawWith(implementation, candidate, CONTROL_REQUEST_NOT_TEXT)) return false;
          }
          if (!refusesSafely(implementation, controlPacketsWith(OWNER_MH08, null), CONTROL_CLAIM)) {
            return false;
          }
          const evidence = acceptedEvidence(implementation, controlPackets(), CONTROL_CLAIM);
          if (evidence === null) return false;
          return sameIdList(
            evidence.results.map((result) => result.stable_id),
            NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS
          );
        }
      }
    ];
    NEUTRAL_ASSEMBLY_CONTROLS = neutralFreeze(
      NEUTRAL_ASSEMBLY_CONTROL_BATTERY.map((control) => ({ id: control.id, title: control.title }))
    );
  }
});

// ../src/modules/lifecycle/workflows/module-boundary-conformance-evaluator.ts
function mh07RequiredConsumerRoots(pluginRoot) {
  const workspace = path4.dirname(path4.resolve(pluginRoot));
  const roots = {};
  for (const name of MH07_REQUIRED_CONSUMERS) roots[name] = path4.join(workspace, name);
  return roots;
}
function walkTypeScript(dir, excluded) {
  if (!fs3.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs3.readdirSync(dir, { withFileTypes: true })) {
    const full = path4.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excluded.indexOf(entry.name) !== -1) continue;
      found.push(...walkTypeScript(full, excluded));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found.sort();
}
function toPosix(value) {
  return value.split(path4.sep).join("/");
}
function relativeTo(root, target) {
  return toPosix(path4.relative(root, target));
}
function resolveRelative(importer, specifier) {
  const base = path4.resolve(path4.dirname(importer), specifier);
  const candidates = [base, `${base}.ts`, path4.join(base, "index.ts")];
  return candidates.find((candidate) => fs3.existsSync(candidate) && fs3.statSync(candidate).isFile()) ?? base;
}
function moduleIdOfPath(root, target, moduleIds) {
  const rel = relativeTo(path4.join(root, "src", "modules"), target);
  if (rel.indexOf("..") === 0 || path4.isAbsolute(rel)) return null;
  const head = rel.split("/")[0];
  return moduleIds.indexOf(head) === -1 ? null : head;
}
function moduleIdsOf(manifests) {
  return manifests.map((manifest) => manifest.id).sort();
}
function classifyDestination(root, importer, specifier, fromModule, moduleIds) {
  if (specifier.indexOf(".") !== 0) {
    const bare = specifier.indexOf("node:") === 0 ? specifier.slice("node:".length) : specifier;
    const isBuiltin = specifier.indexOf("node:") === 0 || MH07_NODE_BUILTINS.indexOf(bare) !== -1;
    return {
      destination_class: isBuiltin ? "node_builtin" : "external_package",
      imported: null,
      to_module: null
    };
  }
  const resolved = resolveRelative(importer, specifier);
  const rel = relativeTo(root, resolved);
  if (rel.indexOf("..") === 0 || path4.isAbsolute(rel)) {
    return { destination_class: "unclassified", imported: rel, to_module: null };
  }
  const head = rel.split("/")[0];
  if (MH07_HOST_FACING_ROOTS.indexOf(head) !== -1) {
    return { destination_class: "host_facing_mirror", imported: rel, to_module: head };
  }
  const toModule = moduleIdOfPath(root, resolved, moduleIds);
  if (toModule === null) {
    return { destination_class: "unclassified", imported: rel, to_module: null };
  }
  if (toModule === fromModule) {
    return { destination_class: "intra_module", imported: rel, to_module: toModule };
  }
  const publicIndex = path4.join(root, "src", "modules", toModule, "index.ts");
  const isPublic = path4.resolve(resolved) === path4.resolve(publicIndex);
  return {
    destination_class: isPublic ? "module_public_index" : "module_private",
    imported: rel,
    to_module: toModule
  };
}
function mh07ScanDependencyGraph(root, extract = extractNeutralImportEdges, moduleIdsOverride) {
  const modulesDir = path4.join(root, "src", "modules");
  const moduleIds = moduleIdsOverride ?? (fs3.existsSync(modulesDir) ? fs3.readdirSync(modulesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() : []);
  const files = walkTypeScript(modulesDir, MH07_GRAPH_SCOPE.excluded_directories);
  const nodes = [];
  const edges = [];
  const unresolved = [];
  const ambient = [];
  for (const file of files) {
    const rel = relativeTo(root, file);
    nodes.push(rel);
    const fromModule = moduleIdOfPath(root, file, moduleIds);
    if (fromModule === null) continue;
    const extracted = extract(fs3.readFileSync(file, "utf8"));
    for (const edge of extracted) {
      if (edge.kind === "unresolved") {
        const detail = edge.detail ?? "";
        if (edge.form === "require" && detail.indexOf("require used as a value") === 0) {
          ambient.push({ importer: rel, detail });
        } else {
          unresolved.push({ importer: rel, form: edge.form, detail });
        }
        continue;
      }
      const specifier = edge.specifier ?? "";
      const classified = classifyDestination(root, file, specifier, fromModule, moduleIds);
      edges.push({
        importer: rel,
        specifier,
        form: edge.form,
        imported: classified.imported,
        destination_class: classified.destination_class,
        from_module: fromModule,
        to_module: classified.to_module
      });
    }
  }
  return neutralFreeze({
    node_count: nodes.length,
    edge_count: edges.length,
    nodes,
    edges,
    unresolved,
    ambient_uses: ambient
  });
}
function declaredExportNames(source, tokenize) {
  const tokens = tokenize(source);
  const names = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "ident" || token.value !== "export") continue;
    let cursor = index + 1;
    while (cursor < tokens.length && tokens[cursor].kind === "ident" && DECLARATION_HEADS.indexOf(tokens[cursor].value) !== -1) {
      cursor += 1;
    }
    const candidate = tokens[cursor];
    if (candidate !== void 0 && candidate.kind === "ident" && names.indexOf(candidate.value) === -1) {
      names.push(candidate.value);
    }
    const next = tokens[index + 1];
    if (next !== void 0 && next.kind === "punct" && next.value === "{") {
      for (let scan = index + 2; scan < tokens.length; scan += 1) {
        const entry = tokens[scan];
        if (entry.kind === "punct" && entry.value === "}") break;
        if (entry.kind === "ident" && names.indexOf(entry.value) === -1) names.push(entry.value);
      }
    }
  }
  return names;
}
function branchesOnHostId(source, tokenize) {
  const tokens = tokenize(source);
  const found = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token.kind !== "ident" || token.value !== "case") continue;
    if (next.kind !== "string") continue;
    if (NEUTRAL_RECOGNIZED_HOST_IDS.indexOf(next.value) !== -1 && found.indexOf(next.value) === -1) {
      found.push(next.value);
    }
  }
  return found;
}
function consumerSourceReaches(consumerRoot, pluginRoot, extract) {
  const found = [];
  const pluginSource = path4.resolve(path4.join(pluginRoot, "src"));
  for (const file of walkTypeScript(consumerRoot, MH07_CONSUMER_SCAN_EXCLUDED_DIRECTORIES)) {
    for (const edge of extract(fs3.readFileSync(file, "utf8"))) {
      if (edge.kind !== "resolved" || edge.specifier === void 0) continue;
      if (edge.specifier.indexOf(".") !== 0) continue;
      const resolved = path4.resolve(resolveRelative(file, edge.specifier));
      if (resolved === pluginSource || resolved.indexOf(`${pluginSource}${path4.sep}`) === 0) {
        found.push({
          consumer_file: relativeTo(consumerRoot, file),
          specifier: edge.specifier,
          imported: relativeTo(pluginRoot, resolved)
        });
      }
    }
  }
  return found;
}
function refuse3(control, reasonCode, assertions, runId, facts = {}) {
  const merged = { ...facts };
  merged.refusal_control = control;
  merged.owner_key = MH07_OWNER_KEY;
  merged.suite_id = NEUTRAL_SCENARIO_SUITE_ID;
  merged.suite_version = NEUTRAL_SCENARIO_SUITE_VERSION;
  merged.evidence = [];
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "refused",
      reason_code: reasonCode,
      assertions: [...assertions],
      binding: { run_id: runId },
      facts: merged
    }),
    packet: null
  };
}
function identityIsComplete2(identity) {
  if (identity === null || typeof identity !== "object") return false;
  const record = identity;
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    const value = record[field];
    if (field === "contract_version") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}
function emptyModuleInventory() {
  const inventory = {};
  for (const category of OWNED_INVENTORY_CATEGORIES) {
    inventory[category] = [];
  }
  return inventory;
}
function digestOf(value) {
  return `sha256:${neutralCanonicalDigest(value)}`;
}
function evaluateNeutralModuleBoundaries(request) {
  const asRecord = request ?? {};
  const runId = typeof asRecord.run_id === "string" ? asRecord.run_id : "";
  if ("stable_ids" in asRecord) {
    return refuse3(
      MH07_REFUSAL_CONTROLS.callerSuppliedIds,
      "scenario_required_set_mismatch",
      [
        "the covered scenario set has exactly one source, and it is this module",
        "an agreeing caller-supplied set is refused too, because accepting a matching copy accepts the channel"
      ],
      runId
    );
  }
  if ("dependency_graph" in asRecord) {
    return refuse3(
      MH07_REFUSAL_CONTROLS.callerSuppliedGraph,
      "scenario_evidence_incomplete",
      [
        "the graph is SCANNED from source bytes, never supplied",
        "a caller-authored graph is a claim about the boundary, not evidence of it"
      ],
      runId
    );
  }
  if ("module_scope" in asRecord) {
    return refuse3(
      MH07_REFUSAL_CONTROLS.callerSuppliedScope,
      "scenario_evidence_incomplete",
      ["the scanned scope is source-owned, so a caller cannot shrink the graph it is judged on"],
      runId
    );
  }
  if ("required_consumers" in asRecord) {
    return refuse3(
      MH07_REFUSAL_CONTROLS.callerSuppliedScope,
      "scenario_evidence_incomplete",
      [
        "the external consumers `MHRC-MOD-004` names are source-owned, so the request may not name the set it is judged against",
        "there is no mode and no override: a caller-supplied required set is refused even when it agrees"
      ],
      runId,
      { required_consumers: [...MH07_REQUIRED_CONSUMERS] }
    );
  }
  if (!identityIsComplete2(request.evidence_identity)) {
    return refuse3(
      MH07_REFUSAL_CONTROLS.identityIncomplete,
      "scenario_evidence_incomplete",
      ["evidence that names no complete identity is bound to no runtime"],
      runId
    );
  }
  for (const stableId of MH07_SCENARIO_IDS) {
    const receiptRef = request.receipt_refs?.[stableId];
    if (typeof receiptRef !== "string" || receiptRef.length === 0) {
      return refuse3(
        MH07_REFUSAL_CONTROLS.evidenceBindingMissing,
        "scenario_receipt_reference_missing",
        ["every scenario result commits to a receipt reference"],
        runId,
        { unbound_scenario: stableId }
      );
    }
    const freshness = request.evidence_freshness?.[stableId];
    if (NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS.indexOf(freshness) === -1) {
      return refuse3(
        MH07_REFUSAL_CONTROLS.evidenceBindingMissing,
        "scenario_evidence_incomplete",
        ["every scenario result carries a typed freshness verdict, and `unknown` is not a soft `fresh`"],
        runId,
        { unbound_scenario: stableId }
      );
    }
  }
  const consumerRoots = request.consumer_roots ?? {};
  const consumerNames = Object.keys(consumerRoots).sort();
  for (const name of consumerNames) {
    const consumerRoot = consumerRoots[name];
    if (typeof consumerRoot !== "string" || !fs3.existsSync(consumerRoot)) {
      return refuse3(
        MH07_REFUSAL_CONTROLS.evidenceBindingMissing,
        "scenario_evidence_incomplete",
        ["a declared consumer root that is not present was not scanned, and an unscanned consumer proves nothing"],
        runId,
        { consumer_root: name }
      );
    }
  }
  const port = request.scanner ?? MH07_PRODUCTION_SCANNER;
  const root = request.plugin_root;
  let manifests;
  try {
    manifests = port.loadModuleManifests(root);
  } catch (error) {
    return refuse3(
      MH07_REFUSAL_CONTROLS.sourceBindingIncomplete,
      "scenario_evidence_incomplete",
      ["a module tree whose manifests do not load cannot be bound to a verdict"],
      runId,
      { load_error: String(error?.message ?? error) }
    );
  }
  if (manifests.length === 0) {
    return refuse3(
      MH07_REFUSAL_CONTROLS.sourceBindingIncomplete,
      "scenario_evidence_incomplete",
      ["an empty module set is not a proof of an empty violation set"],
      runId,
      { manifest_count: 0 }
    );
  }
  const requiredConsumerRoots = mh07RequiredConsumerRoots(root);
  for (const name of MH07_REQUIRED_CONSUMERS) {
    const suppliedRoot = consumerRoots[name];
    const requiredRoot = requiredConsumerRoots[name];
    const bound = typeof suppliedRoot === "string" && path4.resolve(suppliedRoot) === path4.resolve(requiredRoot);
    if (!bound) {
      return refuse3(
        MH07_REFUSAL_CONTROLS.evidenceBindingMissing,
        "scenario_evidence_incomplete",
        [
          "`MHRC-MOD-004` names its external consumers, so the scope it is judged on is source-owned",
          "an omitted, partial, or redirected consumer scope is absence of inspection, not proof that a consumer imports no plugin source"
        ],
        runId,
        {
          required_consumers: [...MH07_REQUIRED_CONSUMERS],
          unbound_consumer: name,
          required_consumer_root: requiredRoot,
          supplied_consumer_root: typeof suppliedRoot === "string" ? suppliedRoot : null
        }
      );
    }
    let position = null;
    let positionError = null;
    try {
      position = fs3.lstatSync(suppliedRoot);
    } catch (error) {
      positionError = String(error?.message ?? error);
    }
    if (position === null || position.isSymbolicLink() || !position.isDirectory()) {
      return refuse3(
        MH07_REFUSAL_CONTROLS.evidenceBindingMissing,
        "scenario_evidence_incomplete",
        [
          "a required consumer root is a real directory at that exact position, never a link standing in for one",
          "a redirected position is absence of inspection wearing the required name: the tree that was walked is not the consumer the scenario names"
        ],
        runId,
        {
          required_consumers: [...MH07_REQUIRED_CONSUMERS],
          unbound_consumer: name,
          required_consumer_root: requiredRoot,
          supplied_consumer_root: suppliedRoot,
          consumer_position_is_symbolic_link: position !== null && position.isSymbolicLink(),
          consumer_position_is_directory: position !== null && position.isDirectory(),
          consumer_position_error: positionError
        }
      );
    }
  }
  const moduleIds = moduleIdsOf(manifests);
  const ownership = port.validateModuleOwnership(emptyModuleInventory(), manifests);
  const boundaries = port.validateModuleBoundaries(root, manifests);
  const health = port.validateModuleHealth(root, manifests);
  const graph = mh07ScanDependencyGraph(root, port.extractNeutralImportEdges, moduleIds);
  const roleOf = (moduleId) => moduleId === null ? null : MH07_MODULE_ROLES[moduleId] ?? null;
  const unclassifiedModules = moduleIds.filter((id) => roleOf(id) === null);
  const modulesWithRole = (role) => moduleIds.filter((id) => roleOf(id) === role);
  const coreModules = modulesWithRole("neutral_core");
  const adapterModules = modulesWithRole("host_adapter");
  const transportModules = modulesWithRole("execution_transport");
  const serviceModules = modulesWithRole("service");
  const nonAdapterModules = moduleIds.filter((id) => roleOf(id) !== "host_adapter");
  const sourcesOf = (moduleId) => walkTypeScript(
    path4.join(root, "src", "modules", moduleId),
    MH07_GRAPH_SCOPE.excluded_directories
  ).map((file) => ({ path: relativeTo(root, file), source: fs3.readFileSync(file, "utf8") }));
  const declaredSymbolFindings = (moduleIdsToScan, symbols) => {
    const findings = [];
    for (const moduleId of moduleIdsToScan) {
      for (const entry of sourcesOf(moduleId)) {
        for (const name of declaredExportNames(entry.source, port.tokenizeNeutralSource)) {
          if (symbols.indexOf(name) !== -1) {
            findings.push({ module_id: moduleId, file: entry.path, symbol: name });
          }
        }
      }
    }
    return findings;
  };
  const violationsFrom = (moduleIdsToScan) => boundaries.violations.filter(
    (violation) => moduleIdsToScan.indexOf(violation.from_module) !== -1
  );
  const hostFacingEdgesFrom = (moduleIdsToScan) => graph.edges.filter(
    (edge) => edge.destination_class === "host_facing_mirror" && moduleIdsToScan.indexOf(edge.from_module) !== -1
  );
  const coreHostModule = coreModules.length === 1 ? coreModules[0] : null;
  const coreFiles = [];
  const missingCoreMembers = [];
  for (const member of NEUTRAL_CORE_MEMBERS) {
    const memberPath = coreHostModule === null ? null : path4.join(root, "src", "modules", coreHostModule, "workflows", member);
    if (memberPath === null || !fs3.existsSync(memberPath)) {
      missingCoreMembers.push(member);
      continue;
    }
    coreFiles.push({ path: member, source: fs3.readFileSync(memberPath, "utf8") });
  }
  const coreVerdict = missingCoreMembers.length > 0 ? null : port.evaluateNeutralCoreBoundary(coreFiles);
  const unclassifiedEdges = graph.edges.filter(
    (edge) => edge.destination_class === "unclassified"
  );
  const mod001Satisfied = coreVerdict !== null && coreVerdict.disposition === "succeeded" && unclassifiedModules.length === 0 && unclassifiedEdges.length === 0 && graph.unresolved.length === 0 && graph.node_count > 0 && graph.edge_count > 0 && health.ok && ownership.ok;
  const adapterViolations = violationsFrom(adapterModules);
  const adapterPolicyOwners = declaredSymbolFindings(
    adapterModules,
    MH07_LIFECYCLE_DECISION_SYMBOLS
  );
  const strayNativeBindings = declaredSymbolFindings(
    nonAdapterModules,
    MH07_NATIVE_EVENT_BINDING_SYMBOLS
  );
  const mod002Satisfied = adapterModules.length > 0 && adapterViolations.length === 0 && adapterPolicyOwners.length === 0 && strayNativeBindings.length === 0;
  const transportViolations = violationsFrom(transportModules);
  const transportPolicyOwners = declaredSymbolFindings(
    transportModules,
    MH07_LIFECYCLE_DECISION_SYMBOLS
  );
  const hostBranchingFindings = [];
  for (const moduleId of [...coreModules, ...transportModules]) {
    for (const entry of sourcesOf(moduleId)) {
      for (const hostId of branchesOnHostId(entry.source, port.tokenizeNeutralSource)) {
        hostBranchingFindings.push({ module_id: moduleId, file: entry.path, host_id: hostId });
      }
    }
  }
  const transportsWithoutPortReach = transportModules.filter(
    (moduleId) => !graph.edges.some(
      (edge) => edge.from_module === moduleId && edge.destination_class === "module_public_index" && roleOf(edge.to_module) === "neutral_core"
    )
  );
  const mod003Satisfied = transportModules.length > 0 && transportViolations.length === 0 && transportPolicyOwners.length === 0 && hostBranchingFindings.length === 0 && transportsWithoutPortReach.length === 0;
  const serviceViolations = violationsFrom(serviceModules);
  const serviceHostFacingEdges = hostFacingEdgesFrom(serviceModules);
  const contractConsumerServices = serviceModules.filter(
    (moduleId) => graph.edges.some(
      (edge) => edge.from_module === moduleId && edge.destination_class === "module_public_index" && MH07_HOST_FACING_CONTRACT_ROLES.indexOf(roleOf(edge.to_module) ?? "") !== -1
    )
  );
  const contractConsumersWithoutVersion = contractConsumerServices.filter((moduleId) => {
    const indexPath = path4.join(root, "src", "modules", moduleId, "index.ts");
    if (!fs3.existsSync(indexPath)) return true;
    return fs3.readFileSync(indexPath, "utf8").indexOf(MODULE_PUBLIC_API_DECLARATION) === -1;
  });
  const consumerReaches = [];
  for (const name of consumerNames) {
    for (const reach of consumerSourceReaches(
      consumerRoots[name],
      root,
      port.extractNeutralImportEdges
    )) {
      consumerReaches.push({ consumer: name, ...reach });
    }
  }
  const requiredConsumersScanned = MH07_REQUIRED_CONSUMERS.filter(
    (name) => consumerNames.indexOf(name) !== -1
  );
  const mod004Satisfied = requiredConsumersScanned.length === MH07_REQUIRED_CONSUMERS.length && serviceModules.length > 0 && serviceViolations.length === 0 && serviceHostFacingEdges.length === 0 && contractConsumersWithoutVersion.length === 0 && consumerReaches.length === 0;
  const identity = request.evidence_identity;
  const manifestSchemaVersions = manifests.map((manifest) => manifest.schema_version).filter((version, index, all) => all.indexOf(version) === index).sort();
  const sourceBinding = {
    source_commit: identity.source_commit,
    module_ids: moduleIds,
    manifest_count: manifests.length,
    manifest_schema_versions: manifestSchemaVersions,
    manifest_digest: digestOf(manifests),
    graph_digest: digestOf({ nodes: graph.nodes, edges: graph.edges }),
    node_count: graph.node_count,
    edge_count: graph.edge_count,
    scanner_version: MH07_SCANNER_VERSION,
    evaluator_version: MH07_EVALUATOR_VERSION,
    graph_scope_excluded_directories: [...MH07_GRAPH_SCOPE.excluded_directories],
    consumer_scope_excluded_directories: [...MH07_CONSUMER_SCAN_EXCLUDED_DIRECTORIES],
    consumer_roots_scanned: consumerNames,
    core_members: [...NEUTRAL_CORE_MEMBERS],
    core_host_module: coreHostModule,
    role_registry_digest: digestOf(MH07_MODULE_ROLES)
  };
  const observations = {
    "MHRC-MOD-001": {
      core_host_module: coreHostModule,
      core_disposition: coreVerdict === null ? null : coreVerdict.disposition,
      core_reason_code: coreVerdict === null ? null : coreVerdict.reason_code,
      missing_core_members: missingCoreMembers,
      forbidden_edges: coreVerdict === null ? null : coreVerdict.facts.forbidden_edges,
      unclassified_modules: unclassifiedModules,
      unclassified_edges: unclassifiedEdges,
      unresolved_edges: graph.unresolved,
      ambient_uses: graph.ambient_uses,
      node_count: graph.node_count,
      edge_count: graph.edge_count,
      health_ok: health.ok,
      health_findings: health.findings,
      ownership_ok: ownership.ok,
      ownership_errors: ownership.errors,
      inventory_coverage_checked: false
    },
    "MHRC-MOD-002": {
      adapter_modules: adapterModules,
      adapter_boundary_violations: adapterViolations,
      policy_owner_findings: adapterPolicyOwners,
      native_binding_outside_adapter: strayNativeBindings
    },
    "MHRC-MOD-003": {
      transport_modules: transportModules,
      transport_boundary_violations: transportViolations,
      lifecycle_decision_findings: transportPolicyOwners,
      host_branching_findings: hostBranchingFindings,
      transports_without_port_reach: transportsWithoutPortReach,
      host_branching_scanned_modules: [...coreModules, ...transportModules]
    },
    "MHRC-MOD-004": {
      service_modules: serviceModules,
      service_boundary_violations: serviceViolations,
      service_host_facing_edges: serviceHostFacingEdges,
      contract_consumer_services: contractConsumerServices,
      services_without_contract_version: contractConsumersWithoutVersion,
      consumer_source_reaches: consumerReaches,
      required_consumers: [...MH07_REQUIRED_CONSUMERS],
      required_consumers_scanned: requiredConsumersScanned
    }
  };
  const satisfaction = {
    "MHRC-MOD-001": mod001Satisfied,
    "MHRC-MOD-002": mod002Satisfied,
    "MHRC-MOD-003": mod003Satisfied,
    "MHRC-MOD-004": mod004Satisfied
  };
  const evidence = MH07_SCENARIO_IDS.map((stableId) => ({
    stable_id: stableId,
    satisfied: satisfaction[stableId],
    observed: observations[stableId]
  }));
  const results = MH07_SCENARIO_IDS.map((stableId) => {
    const expected = MH07_EXPECTED_OUTCOME[stableId];
    const satisfied = satisfaction[stableId];
    return {
      stable_id: stableId,
      outcome_type: expected.type,
      disposition: satisfied ? expected.disposition : "failed",
      reason_code: satisfied ? expected.reason_code : "scenario_result_mismatch",
      receipt_ref: request.receipt_refs[stableId],
      evidence_identity: { ...identity },
      evidence_freshness: request.evidence_freshness[stableId]
    };
  });
  const allSatisfied = MH07_SCENARIO_IDS.every((stableId) => satisfaction[stableId]);
  const packetRecord = {};
  packetRecord.schema_version = MH07_PACKET_SCHEMA;
  packetRecord.suite_id = NEUTRAL_SCENARIO_SUITE_ID;
  packetRecord.suite_version = NEUTRAL_SCENARIO_SUITE_VERSION;
  packetRecord.owner_key = MH07_OWNER_KEY;
  packetRecord.evidence_identity = { ...identity };
  packetRecord.stable_ids = [...MH07_SCENARIO_IDS];
  packetRecord.results = results;
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: allSatisfied ? "succeeded" : "failed",
      reason_code: allSatisfied ? null : "scenario_result_mismatch",
      assertions: [
        "each of the four W4/MH-07 scenarios was evaluated against the real module manifests and boundary scanners",
        "the dependency graph is scanned from source bytes, dynamic and re-export edges included",
        "an unclassified module, an unclassified destination, and an unresolvable edge all fail the verdict",
        "no promotion decision, release decision, or signature verification happens here"
      ],
      binding: { run_id: runId },
      facts: {
        owner_key: MH07_OWNER_KEY,
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        evidence,
        source_binding: sourceBinding
      }
    }),
    packet: neutralFreeze(packetRecord)
  };
}
var fs3, path4, MH07_OWNER_KEY, MH07_SCENARIO_IDS, MH07_PACKET_SCHEMA, MH07_EVIDENCE_PROFILE_ID, MH07_EVALUATOR_VERSION, MH07_SCANNER_VERSION, MH07_GRAPH_SCOPE, MH07_ROLES, MH07_DESTINATION_CLASSES, MH07_EDGE_FORMS, MH07_LIFECYCLE_DECISION_SYMBOLS, MH07_NATIVE_EVENT_BINDING_SYMBOLS, MH07_NODE_BUILTINS, MH07_HOST_FACING_ROOTS, MODULE_PUBLIC_API_DECLARATION, MH07_HOST_FACING_CONTRACT_ROLES, MH07_MODULE_ROLES, MH07_WAVE_OWNER, MH07_SCENARIOS, MH07_EXPECTED_OUTCOME, MH07_PRODUCTION_SCANNER, MH07_REFUSAL_CONTROLS, MH07_REQUIRED_CONSUMERS, MH07_CONSUMER_SCAN_EXCLUDED_DIRECTORIES, DECLARATION_HEADS;
var init_module_boundary_conformance_evaluator = __esm({
  "../src/modules/lifecycle/workflows/module-boundary-conformance-evaluator.ts"() {
    fs3 = __toESM(require("node:fs"));
    path4 = __toESM(require("node:path"));
    init_kernel();
    init_neutral_conformance_assembly();
    init_neutral_conformance_core();
    init_neutral_core_boundary();
    init_neutral_runtime_contracts();
    MH07_OWNER_KEY = "W4/MH-07";
    MH07_SCENARIO_IDS = Object.freeze([
      "MHRC-MOD-001",
      "MHRC-MOD-002",
      "MHRC-MOD-003",
      "MHRC-MOD-004"
    ]);
    MH07_PACKET_SCHEMA = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;
    MH07_EVIDENCE_PROFILE_ID = "E-BOUNDARY";
    MH07_EVALUATOR_VERSION = "guild.module_boundary_evaluator.v1";
    MH07_SCANNER_VERSION = "guild.module_boundary_scanner.v1";
    MH07_GRAPH_SCOPE = Object.freeze({
      excluded_directories: Object.freeze(["resources"])
    });
    MH07_ROLES = Object.freeze([
      "neutral_core",
      "substrate",
      "host_adapter",
      "execution_transport",
      "service"
    ]);
    MH07_DESTINATION_CLASSES = Object.freeze([
      "intra_module",
      "module_public_index",
      "module_private",
      "host_facing_mirror",
      "node_builtin",
      "external_package",
      "unclassified"
    ]);
    MH07_EDGE_FORMS = Object.freeze([
      "import",
      "import from",
      "export from",
      "import()",
      "require()"
    ]);
    MH07_LIFECYCLE_DECISION_SYMBOLS = Object.freeze([
      "decideLifecycleSelection",
      "advanceLifecyclePhase",
      "evaluateGatePolicy"
    ]);
    MH07_NATIVE_EVENT_BINDING_SYMBOLS = Object.freeze([
      "bindNativeHostEvent"
    ]);
    MH07_NODE_BUILTINS = Object.freeze([
      "assert",
      "buffer",
      "child_process",
      "crypto",
      "events",
      "fs",
      "http",
      "https",
      "net",
      "os",
      "path",
      "readline",
      "stream",
      "url",
      "util",
      "worker_threads",
      "zlib"
    ]);
    MH07_HOST_FACING_ROOTS = Object.freeze(["hooks", "scripts"]);
    MODULE_PUBLIC_API_DECLARATION = 'export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;';
    MH07_HOST_FACING_CONTRACT_ROLES = Object.freeze([
      "neutral_core",
      "host_adapter",
      "execution_transport"
    ]);
    MH07_MODULE_ROLES = Object.freeze({
      lifecycle: "neutral_core",
      "host-runtime": "host_adapter",
      dispatch: "execution_transport",
      capability: "substrate",
      communication: "substrate",
      config: "substrate",
      context: "substrate",
      kernel: "substrate",
      loops: "substrate",
      prompting: "substrate",
      security: "substrate",
      state: "substrate",
      teams: "substrate",
      templates: "substrate",
      workspace: "substrate",
      dashboard: "service",
      distribution: "service",
      "docs-sync": "service",
      documents: "service",
      evals: "service",
      evolution: "service",
      initiatives: "service",
      intake: "service",
      knowledge: "service",
      learning: "service",
      migrations: "service",
      operations: "service",
      quality: "service",
      review: "service",
      specialists: "service",
      telemetry: "service"
    });
    MH07_WAVE_OWNER = Object.freeze({
      wave_id: "W4",
      work_item_id: "MH-07",
      key: MH07_OWNER_KEY
    });
    MH07_SCENARIOS = neutralFreeze([
      {
        stable_id: "MHRC-MOD-001",
        category: "module_boundary",
        title: "Host-neutral core imports no concrete host or transport implementation",
        preconditions: [
          "the complete top-level dependency graph is available",
          "core public modules are classified",
          "host adapters, hooks, wrappers, launchers, and transports are classified"
        ],
        action_event: { name: "runtime.verify", input: { boundary: "core_to_concrete" } },
        expected_typed_outcome: {
          type: "guild.boundary_outcome.v1",
          disposition: "succeeded",
          assertions: [
            "no core-to-concrete dependency edge exists",
            "dynamic and re-export edges are included",
            "unclassified destinations fail the verdict"
          ]
        },
        evidence_requirements: [
          {
            profile: MH07_EVIDENCE_PROFILE_ID,
            assertions: [
              "full graph node and edge counts are recorded",
              "the verdict is bound to the source it was produced from"
            ]
          }
        ],
        implementation_wave_owner: MH07_WAVE_OWNER
      },
      {
        stable_id: "MHRC-MOD-002",
        category: "module_boundary",
        title: "Host adapters do not own lifecycle policy",
        preconditions: [
          "adapter and lifecycle modules are classified",
          "normalized-event and capability ports are declared"
        ],
        action_event: { name: "runtime.verify", input: { boundary: "adapter_policy_ownership" } },
        expected_typed_outcome: {
          type: "guild.boundary_outcome.v1",
          disposition: "succeeded",
          assertions: [
            "adapters depend on public lifecycle ports only",
            "adapter modules contain no lifecycle decision ownership",
            "native event binding remains adapter-owned"
          ]
        },
        evidence_requirements: [
          {
            profile: MH07_EVIDENCE_PROFILE_ID,
            assertions: [
              "full graph node and edge counts are recorded",
              "the verdict is bound to the source it was produced from"
            ]
          }
        ],
        implementation_wave_owner: MH07_WAVE_OWNER
      },
      {
        stable_id: "MHRC-MOD-003",
        category: "module_boundary",
        title: "Execution transports do not decide lifecycle policy",
        preconditions: [
          "pane, tmux, remote, wrapper, and launcher transports are classified",
          "transport ports are declared"
        ],
        action_event: { name: "runtime.verify", input: { boundary: "transport_policy_ownership" } },
        expected_typed_outcome: {
          type: "guild.boundary_outcome.v1",
          disposition: "succeeded",
          assertions: [
            "transports implement execution ports only",
            "host branching is absent from core and generic launchers",
            "transport errors return typed outcomes"
          ]
        },
        evidence_requirements: [
          {
            profile: MH07_EVIDENCE_PROFILE_ID,
            assertions: [
              "full graph node and edge counts are recorded",
              "the verdict is bound to the source it was produced from"
            ]
          }
        ],
        implementation_wave_owner: MH07_WAVE_OWNER
      },
      {
        stable_id: "MHRC-MOD-004",
        category: "module_boundary",
        title: "Services and consumers use public contracts only",
        preconditions: [
          "artifact, document, knowledge, benchmark, and website consumers are classified",
          "public contract bundle exports are declared"
        ],
        action_event: { name: "runtime.verify", input: { boundary: "consumer_to_internal" } },
        expected_typed_outcome: {
          type: "guild.boundary_outcome.v1",
          disposition: "succeeded",
          assertions: [
            "services import no host internals",
            "external consumers import no plugin source",
            "consumer contract versions are explicit"
          ]
        },
        evidence_requirements: [
          {
            profile: MH07_EVIDENCE_PROFILE_ID,
            assertions: [
              "full graph node and edge counts are recorded",
              "the verdict is bound to the source it was produced from"
            ]
          }
        ],
        implementation_wave_owner: MH07_WAVE_OWNER
      }
    ]);
    MH07_EXPECTED_OUTCOME = Object.freeze({
      "MHRC-MOD-001": { type: "guild.boundary_outcome.v1", disposition: "succeeded", reason_code: null },
      "MHRC-MOD-002": { type: "guild.boundary_outcome.v1", disposition: "succeeded", reason_code: null },
      "MHRC-MOD-003": { type: "guild.boundary_outcome.v1", disposition: "succeeded", reason_code: null },
      "MHRC-MOD-004": { type: "guild.boundary_outcome.v1", disposition: "succeeded", reason_code: null }
    });
    MH07_PRODUCTION_SCANNER = Object.freeze({
      loadModuleManifests,
      validateModuleOwnership,
      validateModuleBoundaries,
      validateModuleHealth,
      evaluateNeutralCoreBoundary,
      extractNeutralImportEdges,
      tokenizeNeutralSource
    });
    MH07_REFUSAL_CONTROLS = Object.freeze({
      callerSuppliedIds: "caller_supplied_scenario_ids",
      callerSuppliedGraph: "caller_supplied_dependency_graph",
      callerSuppliedScope: "caller_supplied_module_scope",
      identityIncomplete: "evidence_identity_incomplete",
      evidenceBindingMissing: "evidence_binding_missing",
      sourceBindingIncomplete: "source_binding_incomplete"
    });
    MH07_REQUIRED_CONSUMERS = Object.freeze(["benchmark", "website"]);
    MH07_CONSUMER_SCAN_EXCLUDED_DIRECTORIES = Object.freeze([
      ".astro",
      ".cache",
      ".git",
      ".next",
      "build",
      "coverage",
      "dist",
      "node_modules"
    ]);
    DECLARATION_HEADS = Object.freeze([
      "function",
      "const",
      "let",
      "var",
      "class",
      "async",
      "interface",
      "type",
      "enum"
    ]);
  }
});

// ../src/modules/documents/workflows/document-safe.ts
function safeGet(target, key) {
  try {
    return { ok: true, value: target[key] };
  } catch {
    return { ok: false, reason: "property read threw" };
  }
}
function safeOwnKeys(target) {
  try {
    return { ok: true, keys: Object.keys(target) };
  } catch {
    return { ok: false, reason: "own-key enumeration threw" };
  }
}
function safeHasOwn(target, key) {
  try {
    return Object.prototype.hasOwnProperty.call(target, key);
  } catch {
    return false;
  }
}
function safeIsArray(value) {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}
function safeArrayLength(value) {
  const read = safeGet(value, "length");
  if (read.ok === false) return { ok: false, reason: read.reason };
  const length = read.value;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
    return { ok: false, reason: "array length is not a non-negative integer" };
  }
  return { ok: true, length };
}
function isObjectLike(value) {
  return typeof value === "object" && value !== null && !safeIsArray(value);
}
function issue(path26, code, message) {
  return { path: path26, code, message: `${DOCUMENTS_ERROR_NAMESPACE}: ${message}` };
}
function pushIssue(issues, path26, code, message) {
  if (issues.length >= MAX_ISSUES) return;
  issues.push(issue(path26, code, message));
}
function sortIssues(issues) {
  return [...issues].sort(
    (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0)
  );
}
function canonicalDocumentJson(value) {
  const errors = [];
  const active = /* @__PURE__ */ new Set();
  let nodes = 0;
  const walk = (node, path26, depth) => {
    if (errors.length >= MAX_ISSUES) return null;
    if (depth > MAX_CANONICAL_DEPTH) {
      pushIssue(errors, path26, "depth_exceeded", `value nests deeper than ${MAX_CANONICAL_DEPTH}`);
      return null;
    }
    nodes += 1;
    if (nodes > MAX_CANONICAL_NODES) {
      pushIssue(errors, path26, "size_exceeded", `value exceeds ${MAX_CANONICAL_NODES} nodes`);
      return null;
    }
    if (node === null) return "null";
    const kind = typeof node;
    if (kind === "boolean") return node === true ? "true" : "false";
    if (kind === "string") {
      const text = node;
      if (text.length > MAX_STRING_LENGTH) {
        pushIssue(errors, path26, "string_too_long", `string exceeds ${MAX_STRING_LENGTH} characters`);
        return null;
      }
      return JSON.stringify(text);
    }
    if (kind === "number") {
      const num = node;
      if (!Number.isFinite(num)) {
        pushIssue(errors, path26, "non_finite_number", "numbers must be finite");
        return null;
      }
      return Object.is(num, -0) ? "0" : String(num);
    }
    if (kind !== "object") {
      pushIssue(errors, path26, "unsupported_type", `${kind} has no canonical JSON form`);
      return null;
    }
    if (active.has(node)) {
      pushIssue(errors, path26, "cycle_detected", "value contains a cycle");
      return null;
    }
    active.add(node);
    try {
      if (safeIsArray(node)) {
        const length = safeArrayLength(node);
        if (length.ok === false) {
          pushIssue(errors, path26, "array_length_unreadable", length.reason);
          return null;
        }
        if (length.length > MAX_ARRAY_ITEMS) {
          pushIssue(errors, path26, "array_too_long", `array exceeds ${MAX_ARRAY_ITEMS} items`);
          return null;
        }
        const parts2 = [];
        for (let index = 0; index < length.length; index += 1) {
          const key = String(index);
          if (!safeHasOwn(node, key)) {
            pushIssue(errors, `${path26}[${index}]`, "sparse_array_hole", "array holes have no canonical JSON form");
            return null;
          }
          const read = safeGet(node, key);
          if (read.ok === false) {
            pushIssue(errors, `${path26}[${index}]`, "property_read_threw", read.reason);
            return null;
          }
          const encoded = walk(read.value, `${path26}[${index}]`, depth + 1);
          if (encoded === null) return null;
          parts2.push(encoded);
        }
        return `[${parts2.join(",")}]`;
      }
      const keys = safeOwnKeys(node);
      if (keys.ok === false) {
        pushIssue(errors, path26, "own_keys_threw", keys.reason);
        return null;
      }
      if (keys.keys.length > MAX_OBJECT_KEYS) {
        pushIssue(errors, path26, "object_too_wide", `object exceeds ${MAX_OBJECT_KEYS} keys`);
        return null;
      }
      const sorted = [...keys.keys].sort();
      const parts = [];
      for (const key of sorted) {
        const read = safeGet(node, key);
        if (read.ok === false) {
          pushIssue(errors, `${path26}.${key}`, "property_read_threw", read.reason);
          return null;
        }
        if (read.value === void 0) {
          pushIssue(errors, `${path26}.${key}`, "undefined_value", "undefined has no canonical JSON form");
          return null;
        }
        const encoded = walk(read.value, `${path26}.${key}`, depth + 1);
        if (encoded === null) return null;
        parts.push(`${JSON.stringify(key)}:${encoded}`);
      }
      return `{${parts.join(",")}}`;
    } finally {
      active.delete(node);
    }
  };
  let json;
  try {
    json = walk(value, "$", 0);
  } catch {
    pushIssue(errors, "$", "internal_guard", "canonical JSON walk was interrupted");
    json = null;
  }
  if (json === null) {
    if (errors.length === 0) {
      pushIssue(errors, "$", "internal_guard", "canonical JSON walk produced no output");
    }
    return { ok: false, errors: sortIssues(errors) };
  }
  return { ok: true, json };
}
function sha256Of(text) {
  return `sha256:${(0, import_node_crypto2.createHash)("sha256").update(text, "utf8").digest("hex")}`;
}
function hashCanonicalValue(value) {
  const canonical = canonicalDocumentJson(value);
  if (canonical.ok === false) return { ok: false, errors: canonical.errors };
  return { ok: true, hash: sha256Of(canonical.json) };
}
function deepFreeze2(value) {
  if (typeof value !== "object" || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze2(value[key]);
  }
  return value;
}
var import_node_crypto2, DOCUMENTS_ERROR_NAMESPACE, MAX_CANONICAL_DEPTH, MAX_CANONICAL_NODES, MAX_ARRAY_ITEMS, MAX_OBJECT_KEYS, MAX_STRING_LENGTH, MAX_ISSUES;
var init_document_safe = __esm({
  "../src/modules/documents/workflows/document-safe.ts"() {
    import_node_crypto2 = require("node:crypto");
    DOCUMENTS_ERROR_NAMESPACE = "guild.documents";
    MAX_CANONICAL_DEPTH = 32;
    MAX_CANONICAL_NODES = 2e4;
    MAX_ARRAY_ITEMS = 512;
    MAX_OBJECT_KEYS = 128;
    MAX_STRING_LENGTH = 2e4;
    MAX_ISSUES = 64;
  }
});

// ../src/modules/documents/workflows/document-records.ts
function readShape(issues, value, path26, allowed) {
  if (value === null || typeof value !== "object") {
    pushIssue(issues, path26, "not_an_object", `${path26} must be an object`);
    return false;
  }
  if (safeIsArray(value)) {
    pushIssue(issues, path26, "not_an_object", `${path26} must be an object, not an array`);
    return false;
  }
  const keys = safeOwnKeys(value);
  if (keys.ok === false) {
    pushIssue(issues, path26, "own_keys_threw", `${path26}: ${keys.reason}`);
    return false;
  }
  const allowedSet = new Set(allowed);
  let ok = true;
  for (const key of [...keys.keys].sort()) {
    if (!allowedSet.has(key)) {
      pushIssue(issues, `${path26}.${key}`, "unexpected_key", `${path26}.${key} is not part of the closed schema`);
      ok = false;
    }
  }
  for (const key of allowed) {
    if (!safeHasOwn(value, key)) {
      pushIssue(issues, `${path26}.${key}`, "missing_field", `${path26}.${key} is required`);
      ok = false;
    }
  }
  return ok;
}
function readString(issues, parent, path26, key, options = {}) {
  const fieldPath = `${path26}.${key}`;
  const read = safeGet(parent, key);
  if (read.ok === false) {
    pushIssue(issues, fieldPath, "property_read_threw", `${fieldPath}: property read threw`);
    return null;
  }
  const value = read.value;
  if (typeof value !== "string") {
    pushIssue(issues, fieldPath, "not_a_string", `${fieldPath} must be a string`);
    return null;
  }
  if (!options.allowEmpty && value.length === 0) {
    pushIssue(issues, fieldPath, "empty_string", `${fieldPath} must not be empty`);
    return null;
  }
  const maxLength = options.maxLength ?? MAX_STRING_LENGTH;
  if (value.length > maxLength) {
    pushIssue(issues, fieldPath, "string_too_long", `${fieldPath} exceeds ${maxLength} characters`);
    return null;
  }
  if (options.enumOf !== void 0 && !options.enumOf.includes(value)) {
    pushIssue(
      issues,
      fieldPath,
      "value_not_in_vocabulary",
      `${fieldPath} must be one of ${options.enumOf.join("|")}`
    );
    return null;
  }
  if (options.pattern !== void 0 && !options.pattern.test(value)) {
    pushIssue(issues, fieldPath, "pattern_mismatch", `${fieldPath} does not match ${String(options.pattern)}`);
    return null;
  }
  return value;
}
function readArray(issues, parent, path26, key, options = {}) {
  const fieldPath = `${path26}.${key}`;
  const read = safeGet(parent, key);
  if (read.ok === false) {
    pushIssue(issues, fieldPath, "property_read_threw", `${fieldPath}: property read threw`);
    return null;
  }
  if (!safeIsArray(read.value)) {
    pushIssue(issues, fieldPath, "not_an_array", `${fieldPath} must be an array`);
    return null;
  }
  const length = safeArrayLength(read.value);
  if (length.ok === false) {
    pushIssue(issues, fieldPath, "array_length_unreadable", `${fieldPath}: ${length.reason}`);
    return null;
  }
  const max = options.max ?? MAX_ARRAY_ITEMS;
  if (length.length > max) {
    pushIssue(issues, fieldPath, "array_too_long", `${fieldPath} exceeds ${max} items`);
    return null;
  }
  if (options.min !== void 0 && length.length < options.min) {
    pushIssue(issues, fieldPath, "array_too_short", `${fieldPath} requires at least ${options.min} items`);
    return null;
  }
  const items = [];
  let ok = true;
  for (let index = 0; index < length.length; index += 1) {
    const indexKey = String(index);
    if (!safeHasOwn(read.value, indexKey)) {
      pushIssue(issues, `${fieldPath}[${index}]`, "sparse_array_hole", `${fieldPath}[${index}] is an array hole`);
      ok = false;
      continue;
    }
    const item = safeGet(read.value, indexKey);
    if (item.ok === false) {
      pushIssue(issues, `${fieldPath}[${index}]`, "property_read_threw", `${fieldPath}[${index}]: property read threw`);
      ok = false;
      continue;
    }
    items.push(item.value);
  }
  return ok ? items : null;
}
function readStringArray(issues, parent, path26, key, options = {}) {
  const items = readArray(issues, parent, path26, key, options);
  if (items === null) return null;
  const fieldPath = `${path26}.${key}`;
  const out = [];
  let ok = true;
  for (let index = 0; index < items.length; index += 1) {
    const value = items[index];
    const itemPath = `${fieldPath}[${index}]`;
    if (typeof value !== "string") {
      pushIssue(issues, itemPath, "not_a_string", `${itemPath} must be a string`);
      ok = false;
      continue;
    }
    if (value.length === 0) {
      pushIssue(issues, itemPath, "empty_string", `${itemPath} must not be empty`);
      ok = false;
      continue;
    }
    const itemMax = options.itemMaxLength ?? MAX_STRING_LENGTH;
    if (value.length > itemMax) {
      pushIssue(issues, itemPath, "string_too_long", `${itemPath} exceeds ${itemMax} characters`);
      ok = false;
      continue;
    }
    out.push(value);
  }
  return ok ? out : null;
}
function readItemArray(issues, parent, path26, key, options, readItem) {
  const items = readArray(issues, parent, path26, key, options);
  if (items === null) return null;
  const fieldPath = `${path26}.${key}`;
  const out = [];
  const firstIndexById = /* @__PURE__ */ new Map();
  let ok = true;
  for (let index = 0; index < items.length; index += 1) {
    const itemPath = `${fieldPath}[${index}]`;
    const parsed = readItem(issues, items[index], itemPath);
    if (parsed === null) {
      ok = false;
      continue;
    }
    const firstIndex = firstIndexById.get(parsed.id);
    if (firstIndex !== void 0) {
      pushIssue(
        issues,
        `${itemPath}.id`,
        "duplicate_item_id",
        `${itemPath}.id duplicates ${fieldPath}[${firstIndex}].id (${parsed.id})`
      );
      ok = false;
      continue;
    }
    firstIndexById.set(parsed.id, index);
    out.push(parsed);
  }
  return ok ? out : null;
}
function readProvenance(issues, parent, path26) {
  const read = safeGet(parent, "provenance");
  if (read.ok === false) {
    pushIssue(issues, `${path26}.provenance`, "property_read_threw", `${path26}.provenance: property read threw`);
    return null;
  }
  const provenancePath = `${path26}.provenance`;
  if (!readShape(issues, read.value, provenancePath, PROVENANCE_KEYS)) return null;
  const source = read.value;
  const authorId = readString(issues, source, provenancePath, "author_id", {
    pattern: DOCUMENT_ID_PATTERN
  });
  const authorFamily = readString(issues, source, provenancePath, "author_family", {
    pattern: DOCUMENT_ID_PATTERN
  });
  const hostId = readString(issues, source, provenancePath, "host_id", {
    pattern: DOCUMENT_ID_PATTERN
  });
  const createdAt = readString(issues, source, provenancePath, "created_at", {
    pattern: DOCUMENT_TIMESTAMP_PATTERN
  });
  const provenanceSource = readString(issues, source, provenancePath, "source", {
    enumOf: DOCUMENT_PROVENANCE_SOURCES
  });
  if (createdAt !== null) {
    const parsed = Date.parse(createdAt);
    if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== createdAt) {
      pushIssue(
        issues,
        `${provenancePath}.created_at`,
        "not_a_real_instant",
        `${provenancePath}.created_at is not a real UTC instant`
      );
      return null;
    }
  }
  if (authorId === null || authorFamily === null || hostId === null || createdAt === null || provenanceSource === null) {
    return null;
  }
  return {
    author_id: authorId,
    author_family: authorFamily,
    host_id: hostId,
    created_at: createdAt,
    source: provenanceSource
  };
}
function readPlanBody(issues, body, path26) {
  if (!readShape(issues, body, path26, ["objectives", "steps"])) return null;
  const objectives = readStringArray(issues, body, path26, "objectives", { min: 1, max: 64, itemMaxLength: 500 });
  const steps = readItemArray(issues, body, path26, "steps", { min: 1, max: 256 }, (itemIssues, item, itemPath) => {
    if (!readShape(itemIssues, item, itemPath, ["id", "title", "status"])) return null;
    const id = readString(itemIssues, item, itemPath, "id", { pattern: DOCUMENT_ITEM_ID_PATTERN });
    const title = readString(itemIssues, item, itemPath, "title", { maxLength: 500 });
    const status = readString(itemIssues, item, itemPath, "status", { enumOf: PLAN_STEP_STATUSES });
    if (id === null || title === null || status === null) return null;
    return { id, title, status };
  });
  if (objectives === null || steps === null) return null;
  return { objectives, steps };
}
function readSpecBody(issues, body, path26) {
  if (!readShape(issues, body, path26, ["requirements"])) return null;
  const requirements = readItemArray(
    issues,
    body,
    path26,
    "requirements",
    { min: 1, max: 256 },
    (itemIssues, item, itemPath) => {
      if (!readShape(itemIssues, item, itemPath, ["id", "statement", "priority"])) return null;
      const id = readString(itemIssues, item, itemPath, "id", { pattern: DOCUMENT_ITEM_ID_PATTERN });
      const statement = readString(itemIssues, item, itemPath, "statement", { maxLength: 2e3 });
      const priority = readString(itemIssues, item, itemPath, "priority", {
        enumOf: SPEC_REQUIREMENT_PRIORITIES
      });
      if (id === null || statement === null || priority === null) return null;
      return { id, statement, priority };
    }
  );
  if (requirements === null) return null;
  return { requirements };
}
function readHandoffBody(issues, body, path26) {
  if (!readShape(issues, body, path26, ["task_id", "status", "artifacts", "issues"])) return null;
  const taskId = readString(issues, body, path26, "task_id", { pattern: DOCUMENT_ITEM_ID_PATTERN });
  const status = readString(issues, body, path26, "status", { enumOf: HANDOFF_STATUSES });
  const artifacts = readStringArray(issues, body, path26, "artifacts", { max: 256, itemMaxLength: 1e3 });
  const handoffIssues = readStringArray(issues, body, path26, "issues", { max: 256, itemMaxLength: 1e3 });
  if (taskId === null || status === null || artifacts === null || handoffIssues === null) return null;
  return { task_id: taskId, status, artifacts, issues: handoffIssues };
}
function readReviewBody(issues, body, path26) {
  if (!readShape(issues, body, path26, ["verdict", "findings"])) return null;
  const verdict = readString(issues, body, path26, "verdict", { enumOf: REVIEW_VERDICTS });
  const findings = readItemArray(
    issues,
    body,
    path26,
    "findings",
    { max: 256 },
    (itemIssues, item, itemPath) => {
      if (!readShape(itemIssues, item, itemPath, ["id", "severity", "statement"])) return null;
      const id = readString(itemIssues, item, itemPath, "id", { pattern: DOCUMENT_ITEM_ID_PATTERN });
      const severity = readString(itemIssues, item, itemPath, "severity", { enumOf: REVIEW_SEVERITIES });
      const statement = readString(itemIssues, item, itemPath, "statement", { maxLength: 2e3 });
      if (id === null || severity === null || statement === null) return null;
      return { id, severity, statement };
    }
  );
  if (verdict === null || findings === null) return null;
  return { verdict, findings };
}
function readVerifyBody(issues, body, path26) {
  if (!readShape(issues, body, path26, ["outcome", "checks"])) return null;
  const outcome = readString(issues, body, path26, "outcome", { enumOf: VERIFY_OUTCOMES });
  const checks = readItemArray(
    issues,
    body,
    path26,
    "checks",
    { min: 1, max: 256 },
    (itemIssues, item, itemPath) => {
      if (!readShape(itemIssues, item, itemPath, ["id", "name", "result"])) return null;
      const id = readString(itemIssues, item, itemPath, "id", { pattern: DOCUMENT_ITEM_ID_PATTERN });
      const name = readString(itemIssues, item, itemPath, "name", { maxLength: 500 });
      const result = readString(itemIssues, item, itemPath, "result", { enumOf: VERIFY_CHECK_RESULTS });
      if (id === null || name === null || result === null) return null;
      return { id, name, result };
    }
  );
  if (outcome === null || checks === null) return null;
  return { outcome, checks };
}
function failure(errors) {
  return { valid: false, errors: sortIssues(errors), record: null };
}
function validateDocumentRecord(input) {
  const errors = [];
  try {
    if (!isObjectLike(input)) {
      pushIssue(errors, "$", "not_an_object", "document record must be an object");
      return failure(errors);
    }
    if (!readShape(errors, input, "$", TOP_LEVEL_KEYS)) return failure(errors);
    const schemaVersion = readString(errors, input, "$", "schema_version", {
      enumOf: [DOCUMENT_SCHEMA_VERSION]
    });
    const kind = readString(errors, input, "$", "kind", { enumOf: DOCUMENT_KINDS });
    const id = readString(errors, input, "$", "id", { pattern: DOCUMENT_ID_PATTERN });
    const title = readString(errors, input, "$", "title", { maxLength: 500 });
    const provenance = readProvenance(errors, input, "$");
    const bodyRead = safeGet(input, "body");
    if (bodyRead.ok === false) {
      pushIssue(errors, "$.body", "property_read_threw", "$.body: property read threw");
      return failure(errors);
    }
    if (schemaVersion === null || kind === null || id === null || title === null || provenance === null) {
      return failure(errors);
    }
    const base = { schema_version: DOCUMENT_SCHEMA_VERSION, id, title, provenance };
    let record = null;
    if (kind === "plan") {
      const body = readPlanBody(errors, bodyRead.value, "$.body");
      if (body !== null) record = { ...base, kind: "plan", body };
    } else if (kind === "spec") {
      const body = readSpecBody(errors, bodyRead.value, "$.body");
      if (body !== null) record = { ...base, kind: "spec", body };
    } else if (kind === "handoff") {
      const body = readHandoffBody(errors, bodyRead.value, "$.body");
      if (body !== null) record = { ...base, kind: "handoff", body };
    } else if (kind === "review") {
      const body = readReviewBody(errors, bodyRead.value, "$.body");
      if (body !== null) record = { ...base, kind: "review", body };
    } else if (kind === "verify") {
      const body = readVerifyBody(errors, bodyRead.value, "$.body");
      if (body !== null) record = { ...base, kind: "verify", body };
    }
    if (record === null || errors.length > 0) return failure(errors);
    return { valid: true, errors: [], record: deepFreeze2(record) };
  } catch {
    pushIssue(errors, "$", "internal_guard", "validation was interrupted");
    return failure(errors);
  }
}
var DOCUMENT_SCHEMA_VERSION, DOCUMENT_KINDS, DOCUMENT_PROVENANCE_SOURCES, PLAN_STEP_STATUSES, SPEC_REQUIREMENT_PRIORITIES, HANDOFF_STATUSES, REVIEW_VERDICTS, REVIEW_SEVERITIES, VERIFY_OUTCOMES, VERIFY_CHECK_RESULTS, DOCUMENT_ID_PATTERN, DOCUMENT_ITEM_ID_PATTERN, DOCUMENT_TIMESTAMP_PATTERN, TOP_LEVEL_KEYS, PROVENANCE_KEYS;
var init_document_records = __esm({
  "../src/modules/documents/workflows/document-records.ts"() {
    init_document_safe();
    DOCUMENT_SCHEMA_VERSION = "guild.document.v1";
    DOCUMENT_KINDS = Object.freeze([
      "plan",
      "spec",
      "handoff",
      "review",
      "verify"
    ]);
    DOCUMENT_PROVENANCE_SOURCES = Object.freeze([
      "authored",
      "imported",
      "migrated"
    ]);
    PLAN_STEP_STATUSES = Object.freeze([
      "pending",
      "active",
      "done",
      "blocked"
    ]);
    SPEC_REQUIREMENT_PRIORITIES = Object.freeze(["must", "should", "may"]);
    HANDOFF_STATUSES = Object.freeze([
      "completed",
      "partial",
      "blocked",
      "failed"
    ]);
    REVIEW_VERDICTS = Object.freeze(["approved", "issues", "rejected"]);
    REVIEW_SEVERITIES = Object.freeze([
      "blocking",
      "major",
      "minor",
      "note"
    ]);
    VERIFY_OUTCOMES = Object.freeze(["pass", "fail", "inconclusive"]);
    VERIFY_CHECK_RESULTS = Object.freeze(["pass", "fail", "skip"]);
    DOCUMENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
    DOCUMENT_ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
    DOCUMENT_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    TOP_LEVEL_KEYS = Object.freeze([
      "schema_version",
      "kind",
      "id",
      "title",
      "provenance",
      "body"
    ]);
    PROVENANCE_KEYS = Object.freeze([
      "author_id",
      "author_family",
      "host_id",
      "created_at",
      "source"
    ]);
  }
});

// ../src/modules/documents/workflows/document-hash.ts
function hashDocumentRecord(record) {
  const hashed = hashCanonicalValue(record);
  if (hashed.ok) return hashed.hash;
  return "sha256:unhashable";
}
var init_document_hash = __esm({
  "../src/modules/documents/workflows/document-hash.ts"() {
    init_document_safe();
    init_document_records();
  }
});

// ../src/modules/documents/workflows/document-projection.ts
function deriveDisposition(record) {
  if (record.kind === "verify") {
    const failed2 = record.body.checks.filter((check) => check.result === "fail").map((check) => check.id);
    if (record.body.outcome === "pass" && failed2.length > 0) {
      return {
        disposition: "failed",
        signals: ["outcome_demoted_by_failed_check", ...failed2]
      };
    }
    if (record.body.outcome === "pass") return { disposition: "succeeded", signals: [] };
    if (record.body.outcome === "fail") return { disposition: "failed", signals: failed2 };
    return { disposition: "unknown", signals: failed2 };
  }
  if (record.kind === "review") {
    const blocking = record.body.findings.filter((finding) => finding.severity === "blocking").map((finding) => finding.id);
    if (record.body.verdict === "approved" && blocking.length > 0) {
      return {
        disposition: "in_review",
        signals: ["verdict_demoted_by_blocking_findings", ...blocking]
      };
    }
    if (record.body.verdict === "approved") return { disposition: "succeeded", signals: [] };
    if (record.body.verdict === "rejected") return { disposition: "failed", signals: blocking };
    return { disposition: "in_review", signals: blocking };
  }
  if (record.kind === "handoff") {
    const openIssues = record.body.issues;
    if (record.body.status === "completed" && openIssues.length > 0) {
      return {
        disposition: "in_review",
        signals: ["status_demoted_by_open_issues"]
      };
    }
    if (record.body.status === "completed") return { disposition: "succeeded", signals: [] };
    if (record.body.status === "failed") return { disposition: "failed", signals: [] };
    if (record.body.status === "blocked") return { disposition: "blocked", signals: [] };
    return { disposition: "in_review", signals: [] };
  }
  if (record.kind === "plan") {
    const blocked = record.body.steps.filter((step) => step.status === "blocked").map((step) => step.id);
    if (blocked.length > 0) return { disposition: "blocked", signals: blocked };
    const allDone = record.body.steps.every((step) => step.status === "done");
    return { disposition: allDone ? "succeeded" : "planned", signals: [] };
  }
  const musts = record.body.requirements.filter((requirement) => requirement.priority === "must").map((requirement) => requirement.id);
  return { disposition: "planned", signals: musts };
}
function bindingFor3(core) {
  const hashed = hashCanonicalValue(core);
  return hashed.ok ? hashed.hash : "sha256:unbindable";
}
function projectValidatedRecord(record) {
  const derived = deriveDisposition(record);
  const core = {
    schema_version: DOCUMENT_PROJECTION_SCHEMA_VERSION,
    record_id: record.id,
    record_kind: record.kind,
    record_schema_version: DOCUMENT_SCHEMA_VERSION,
    content_hash: hashDocumentRecord(record),
    disposition: derived.disposition,
    signals: derived.signals
  };
  return deepFreeze2({ ...core, binding: bindingFor3(core) });
}
function validateDocumentProjection(input) {
  const errors = [];
  try {
    if (!isObjectLike(input)) {
      pushIssue(errors, "$", "not_an_object", "projection must be an object");
      return { valid: false, errors: sortIssues(errors) };
    }
    const asRecord = input;
    for (const key of PROJECTION_KEYS) {
      let value;
      try {
        value = asRecord[key];
      } catch {
        pushIssue(errors, `$.${key}`, "property_read_threw", `$.${key}: property read threw`);
        continue;
      }
      if (value === void 0) {
        pushIssue(errors, `$.${key}`, "missing_field", `$.${key} is required`);
      }
    }
    return { valid: errors.length === 0, errors: sortIssues(errors) };
  } catch {
    pushIssue(errors, "$", "internal_guard", "projection validation was interrupted");
    return { valid: false, errors: sortIssues(errors) };
  }
}
function verifyProjectionAgainstRecord(claimed, record) {
  const mismatches = [];
  const expected = projectValidatedRecord(record);
  const shape = validateDocumentProjection(claimed);
  if (!shape.valid) return ["projection_malformed"];
  const claimedRecord = claimed;
  const read = (key) => {
    try {
      return claimedRecord[key];
    } catch {
      return void 0;
    }
  };
  if (read("schema_version") !== DOCUMENT_PROJECTION_SCHEMA_VERSION) {
    mismatches.push("projection_schema_version_mismatch");
  }
  if (read("record_id") !== expected.record_id) mismatches.push("projection_record_id_mismatch");
  if (read("record_kind") !== expected.record_kind) mismatches.push("projection_record_kind_mismatch");
  if (read("record_schema_version") !== expected.record_schema_version) {
    mismatches.push("projection_record_schema_version_mismatch");
  }
  if (read("content_hash") !== expected.content_hash) mismatches.push("projection_stale");
  if (read("disposition") !== expected.disposition) mismatches.push("projection_disposition_mismatch");
  const claimedSignals = read("signals");
  const signalsHash = hashCanonicalValue(claimedSignals);
  const expectedSignalsHash = hashCanonicalValue(expected.signals);
  if (!signalsHash.ok || !expectedSignalsHash.ok || signalsHash.hash !== expectedSignalsHash.hash) {
    mismatches.push("projection_signals_mismatch");
  }
  if (read("binding") !== expected.binding) mismatches.push("projection_binding_mismatch");
  return [...new Set(mismatches)].sort();
}
var DOCUMENT_PROJECTION_SCHEMA_VERSION, DOCUMENT_DISPOSITIONS, PROJECTION_KEYS;
var init_document_projection = __esm({
  "../src/modules/documents/workflows/document-projection.ts"() {
    init_document_safe();
    init_document_hash();
    init_document_records();
    DOCUMENT_PROJECTION_SCHEMA_VERSION = "guild.document_projection.v1";
    DOCUMENT_DISPOSITIONS = Object.freeze([
      "succeeded",
      "failed",
      "blocked",
      "in_review",
      "planned",
      "unknown"
    ]);
    PROJECTION_KEYS = Object.freeze([
      "schema_version",
      "record_id",
      "record_kind",
      "record_schema_version",
      "content_hash",
      "disposition",
      "signals",
      "binding"
    ]);
  }
});

// ../src/modules/documents/workflows/document-html.ts
var ALLOWED_ELEMENTS, ALLOWED_ATTRIBUTES, ENTITY_VALUES, META_KEYS;
var init_document_html = __esm({
  "../src/modules/documents/workflows/document-html.ts"() {
    init_document_safe();
    init_kernel();
    init_document_hash();
    init_document_records();
    init_document_projection();
    ALLOWED_ELEMENTS = Object.freeze(
      /* @__PURE__ */ new Set([
        "html",
        "head",
        "meta",
        "title",
        "body",
        "article",
        "section",
        "header",
        "h1",
        "h2",
        "dl",
        "dt",
        "dd",
        "ul",
        "li",
        "p",
        "span",
        "time",
        "footer"
      ])
    );
    ALLOWED_ATTRIBUTES = Object.freeze(
      /* @__PURE__ */ new Set(["lang", "charset", "name", "content", "class", "id"])
    );
    ENTITY_VALUES = Object.freeze({
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      "#39": "'"
    });
    META_KEYS = deepFreeze([
      ["record_id", "guild.record_id"],
      ["record_kind", "guild.record_kind"],
      ["schema_version", "guild.schema_version"],
      ["content_hash", "guild.content_hash"],
      ["projection_binding", "guild.projection_binding"]
    ]);
  }
});

// ../src/modules/documents/workflows/document-legacy-import.ts
var LEGACY_IMPORT_BOUNDS, KIND_HINTS;
var init_document_legacy_import = __esm({
  "../src/modules/documents/workflows/document-legacy-import.ts"() {
    init_document_safe();
    init_kernel();
    init_document_records();
    LEGACY_IMPORT_BOUNDS = Object.freeze({
      max_characters: 65536,
      max_lines: 2e3,
      max_sections: 64,
      max_section_characters: 4e3
    });
    KIND_HINTS = deepFreeze([
      [/\bplan\b/i, "plan"],
      [/\bspec(?:ification)?\b/i, "spec"],
      [/\b(?:handoff|receipt)\b/i, "handoff"],
      [/\breview\b/i, "review"],
      [/\bverif(?:y|ication)\b/i, "verify"]
    ]);
  }
});

// ../src/modules/documents/workflows/document-versioning.ts
var SUPPORTED_DOCUMENT_SCHEMA_VERSIONS, MIGRATABLE_DOCUMENT_SCHEMA_VERSIONS;
var init_document_versioning = __esm({
  "../src/modules/documents/workflows/document-versioning.ts"() {
    init_document_safe();
    init_document_hash();
    init_document_records();
    init_document_safe();
    init_document_html();
    init_document_projection();
    SUPPORTED_DOCUMENT_SCHEMA_VERSIONS = Object.freeze([
      DOCUMENT_SCHEMA_VERSION
    ]);
    MIGRATABLE_DOCUMENT_SCHEMA_VERSIONS = Object.freeze([
      "guild.document.v0"
    ]);
  }
});

// ../src/modules/documents/workflows/document-decisions.ts
function present(value) {
  return value !== void 0 && value !== null;
}
function resolveDocumentAuthority(sources) {
  const refusals = [];
  const evidence = [];
  try {
    if (sources === null || typeof sources !== "object") {
      return { authority: "none", record: null, refusals: ["sources_not_an_object"], evidence: [] };
    }
    const read = {};
    let unreadable = false;
    for (const key of SOURCE_KEYS) {
      const value = safeGet(sources, key);
      if (value.ok === false) {
        unreadable = true;
        continue;
      }
      read[key] = value.value;
    }
    if (unreadable) refusals.push("source_unreadable");
    const recordSource = read["record"];
    const projectionSource = read["projection"];
    if (present(recordSource)) {
      const validation = validateDocumentRecord(recordSource);
      if (!validation.valid || validation.record === null) {
        refusals.push("record_invalid");
        evidence.push(...validation.errors);
        return {
          authority: "none",
          record: null,
          refusals: [...new Set(refusals)].sort(),
          evidence: sortIssues(evidence)
        };
      }
      if (present(projectionSource)) {
        const mismatches = verifyProjectionAgainstRecord(projectionSource, validation.record);
        refusals.push(...mismatches);
      }
      return {
        authority: "canonical_record",
        record: validation.record,
        refusals: [...new Set(refusals)].sort(),
        evidence: sortIssues(evidence)
      };
    }
    if (present(projectionSource)) {
      refusals.push("projection_unbound_no_canonical_record");
      const shape = validateDocumentProjection(projectionSource);
      if (!shape.valid) {
        refusals.push("projection_malformed");
        evidence.push(...shape.errors);
      }
    }
    if (present(read["legacy_record"])) refusals.push("legacy_record_is_not_canonical");
    if (present(read["html"])) refusals.push("html_is_not_machine_authority");
    if (present(read["markdown"])) refusals.push("markdown_is_not_machine_authority");
    if (refusals.length === 0) refusals.push("no_document_source");
    return {
      authority: "none",
      record: null,
      refusals: [...new Set(refusals)].sort(),
      evidence: sortIssues(evidence)
    };
  } catch {
    return { authority: "none", record: null, refusals: ["internal_guard"], evidence: [] };
  }
}
function decideFromDocumentSources(sources) {
  try {
    const resolution = resolveDocumentAuthority(sources);
    if (resolution.authority !== "canonical_record" || resolution.record === null) {
      return { ...REFUSED, authority: resolution.authority, refusals: resolution.refusals, evidence: resolution.evidence };
    }
    if (resolution.refusals.length > 0) {
      return {
        ...REFUSED,
        authority: resolution.authority,
        refusals: resolution.refusals,
        evidence: resolution.evidence
      };
    }
    const projection = projectValidatedRecord(resolution.record);
    return {
      authority: "canonical_record",
      gate_signal: projection.disposition === "succeeded" ? "advance" : "hold",
      disposition: projection.disposition,
      content_hash: hashDocumentRecord(resolution.record),
      projection,
      refusals: [],
      evidence: []
    };
  } catch {
    return { ...REFUSED, authority: "none", refusals: ["internal_guard"], evidence: [] };
  }
}
var SOURCE_KEYS, REFUSED;
var init_document_decisions = __esm({
  "../src/modules/documents/workflows/document-decisions.ts"() {
    init_document_safe();
    init_document_hash();
    init_document_records();
    init_document_projection();
    SOURCE_KEYS = Object.freeze([
      "record",
      "projection",
      "legacy_record",
      "html",
      "markdown"
    ]);
    REFUSED = {
      gate_signal: "refuse",
      disposition: "unknown",
      content_hash: null,
      projection: null
    };
  }
});

// ../src/modules/documents/workflows/document-receipts.ts
function validateReceiptMachineBlock(block, errors) {
  for (const key of Object.keys(block)) {
    if (!RECEIPT_MACHINE_KEYS.has(key)) pushIssue(errors, `$.machine_block.${key}`, "unknown_key", `guild.handoff.v2 rejects unknown key ${key}`);
  }
  if (typeof block.task_id !== "string" || block.task_id.trim() === "") pushIssue(errors, "$.machine_block.task_id", "missing_field", "task_id must be a non-empty string");
  if (block.tier !== "cheap" && block.tier !== "mid" && block.tier !== "powerful") pushIssue(errors, "$.machine_block.tier", "unknown_value", "tier must be cheap, mid, or powerful");
  if (block.status !== "done" && block.status !== "blocked" && block.status !== "escalate") pushIssue(errors, "$.machine_block.status", "unknown_receipt_status", "status must be done, blocked, or escalate");
  if (typeof block.summary !== "string" || block.summary.trim() === "" || block.summary.length > 600) pushIssue(errors, "$.machine_block.summary", "invalid_summary", "summary must be a non-empty string of at most 600 characters");
  for (const key of ["artifacts", "issues"]) {
    if (!Array.isArray(block[key]) || !block[key].every((value) => typeof value === "string")) pushIssue(errors, `$.machine_block.${key}`, "wrong_type", `${key} must be an array of strings`);
  }
  if (block.learnings !== void 0 && (!Array.isArray(block.learnings) || !block.learnings.every((value) => typeof value === "string"))) pushIssue(errors, "$.machine_block.learnings", "wrong_type", "learnings must be an array of strings when provided");
  if (block.status === "escalate" && (typeof block.escalate_reason !== "string" || block.escalate_reason.trim() === "")) pushIssue(errors, "$.machine_block.escalate_reason", "missing_field", "escalate_reason is required for escalate status");
  if (block.escalate_reason !== void 0 && typeof block.escalate_reason !== "string") pushIssue(errors, "$.machine_block.escalate_reason", "wrong_type", "escalate_reason must be a string when provided");
  if (block.notes !== void 0 && (typeof block.notes !== "string" || block.notes.length > 200)) pushIssue(errors, "$.machine_block.notes", "wrong_type", "notes must be a string of at most 200 characters");
  if (block.injection_clean !== void 0 && !["clean", "flagged", "unverified"].includes(String(block.injection_clean))) pushIssue(errors, "$.machine_block.injection_clean", "unknown_value", "injection_clean must be clean, flagged, or unverified");
}
function readReceiptFrontmatter(text) {
  const match = RECEIPT_FRONTMATTER_BLOCK.exec(text);
  if (match === null) {
    return { ok: false, reason: "receipt frontmatter is missing or unterminated" };
  }
  const frontmatter = match[1] ?? "";
  if (frontmatter.split("\n").length + 2 > RECEIPT_PARSE_BOUNDS.max_frontmatter_lines) {
    return { ok: false, reason: "frontmatter exceeds the line bound" };
  }
  let parsed;
  try {
    const yaml4 = loadYamlApi();
    parsed = yaml4.load(frontmatter, { schema: yaml4.JSON_SCHEMA });
  } catch {
    return { ok: false, reason: "frontmatter is not a valid YAML mapping" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "frontmatter is not a valid YAML mapping" };
  }
  const fields = /* @__PURE__ */ Object.create(null);
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      continue;
    }
    const scalar = String(value);
    if (scalar !== "") fields[key] = scalar;
  }
  return { ok: true, fields, document: parsed };
}
function readReceiptMachineBlock(text) {
  const fence = /^```([^\n]*)\n([\s\S]*?)\n```[ \t]*$/gm;
  const candidates = [];
  let match;
  let seen = 0;
  while ((match = fence.exec(text)) !== null) {
    seen += 1;
    if (seen > RECEIPT_PARSE_BOUNDS.max_json_blocks) {
      return { ok: false, reason: "receipt exceeds the fenced-block scan bound" };
    }
    const info = (match[1] ?? "").trim().toLowerCase();
    if (info !== "" && info !== "json" && info !== "jsonc" && info !== RECEIPT_MACHINE_SCHEMA_VERSION) continue;
    let parsed;
    try {
      parsed = JSON.parse(match[2] ?? "");
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const version = safeGet(parsed, "schema_version");
    if (version.ok && version.value === RECEIPT_MACHINE_SCHEMA_VERSION) {
      candidates.push(parsed);
    }
  }
  if (candidates.length === 0) {
    return { ok: false, reason: `no ${RECEIPT_MACHINE_SCHEMA_VERSION} block found` };
  }
  if (candidates.length > 1) {
    return { ok: false, reason: `receipt contains ${candidates.length} ${RECEIPT_MACHINE_SCHEMA_VERSION} blocks` };
  }
  return { ok: true, block: candidates[0] };
}
function firstField(fields, keys) {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}
function aliasesAgree(fields, keys) {
  const declared = keys.map((key) => fields[key]).filter((value) => typeof value === "string" && value !== "");
  return new Set(declared).size <= 1;
}
function plainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function requiredRecord(errors, parent, key) {
  const value = plainRecord(parent[key]);
  if (value === null) {
    pushIssue(errors, `$.frontmatter.${key}`, "missing_field", `${key} must be a mapping`);
  }
  return value;
}
function requiredString(errors, parent, path26, key) {
  const value = parent[key];
  if (typeof value !== "string" || value.length === 0) {
    pushIssue(errors, `${path26}.${key}`, "missing_field", `${key} must be a non-empty string`);
    return null;
  }
  return value;
}
function requiredArray(errors, parent, key) {
  const value = parent[key];
  if (!Array.isArray(value)) {
    pushIssue(errors, `$.frontmatter.${key}`, "missing_field", `${key} must be an array`);
    return null;
  }
  return value;
}
function validateStringArray(errors, values, path26) {
  if (values === null) return;
  values.forEach((value, index) => {
    if (typeof value !== "string" || value.length === 0) {
      pushIssue(errors, `${path26}[${index}]`, "wrong_type", `${path26} entries must be non-empty strings`);
    }
  });
}
function canonicalReceiptInstant(errors, value, path26) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    pushIssue(errors, path26, "invalid_timestamp", `${path26} must be an ISO-8601 timestamp`);
    return null;
  }
  const parsed = Date.parse(value);
  const expectedCanonical = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== expectedCanonical) {
    pushIssue(errors, path26, "invalid_timestamp", `${path26} must name a real UTC calendar instant`);
    return null;
  }
  return expectedCanonical;
}
function receiptProvenance(document, fields, errors) {
  if (plainRecord(document.host) === null) {
    const authorId2 = firstField(fields, ["agent", "specialist"]);
    const authorFamily = firstField(fields, ["model_family", "family"]);
    const hostId2 = firstField(fields, ["host"]);
    const createdAt2 = firstField(fields, ["generated_at"]);
    if (!aliasesAgree(fields, ["agent", "specialist"])) {
      pushIssue(errors, "$.frontmatter.agent", "conflicting_provenance", "frontmatter agent and specialist must agree when both are present");
    }
    if (!aliasesAgree(fields, ["model_family", "family"])) {
      pushIssue(errors, "$.frontmatter.model_family", "conflicting_provenance", "frontmatter model_family and family must agree when both are present");
    }
    if (authorId2 === null) pushIssue(errors, "$.frontmatter.agent", "missing_provenance", "frontmatter agent/specialist is required");
    if (authorFamily === null) pushIssue(errors, "$.frontmatter.model_family", "missing_provenance", "frontmatter model_family/family is required");
    if (hostId2 === null) pushIssue(errors, "$.frontmatter.host", "missing_provenance", "frontmatter legacy scalar host is required");
    if (createdAt2 === null) pushIssue(errors, "$.frontmatter.generated_at", "missing_provenance", "frontmatter generated_at is required for a legacy receipt");
    return {
      shape: "legacy",
      authorId: authorId2,
      authorFamily,
      hostId: hostId2,
      createdAt: createdAt2,
      taskId: firstField(fields, ["task_id"]),
      title: firstField(fields, ["task", "title"]),
      status: null
    };
  }
  const ids = requiredRecord(errors, document, "ids");
  const host = requiredRecord(errors, document, "host");
  const scope = requiredRecord(errors, document, "scope");
  const authorId = requiredString(errors, document, "$.frontmatter", "specialist");
  const taskId = ids === null ? null : requiredString(errors, ids, "$.frontmatter.ids", "task_id");
  if (ids !== null) {
    requiredString(errors, ids, "$.frontmatter.ids", "run_id");
    requiredString(errors, ids, "$.frontmatter.ids", "task_run_id");
    if (!Object.prototype.hasOwnProperty.call(ids, "initiative_id")) {
      pushIssue(errors, "$.frontmatter.ids.initiative_id", "missing_field", "initiative_id is required and may be null");
    } else if (ids.initiative_id !== null && (typeof ids.initiative_id !== "string" || ids.initiative_id.length === 0)) {
      pushIssue(errors, "$.frontmatter.ids.initiative_id", "wrong_type", "initiative_id must be null or a non-empty string");
    }
  }
  const hostId = host === null ? null : requiredString(errors, host, "$.frontmatter.host", "selected");
  if (host !== null) {
    if (typeof host.degraded !== "boolean") pushIssue(errors, "$.frontmatter.host.degraded", "wrong_type", "degraded must be boolean");
    if (host.native_ref !== null && typeof host.native_ref !== "string") pushIssue(errors, "$.frontmatter.host.native_ref", "wrong_type", "native_ref must be null or a string");
    if (host.independence !== "strong" && host.independence !== "weak") {
      pushIssue(errors, "$.frontmatter.host.independence", "unknown_value", "independence must be strong or weak");
    }
  }
  const title = scope === null ? null : requiredString(errors, scope, "$.frontmatter.scope", "objective");
  if (scope !== null) {
    validateStringArray(errors, Array.isArray(scope.in_scope) ? scope.in_scope : null, "$.frontmatter.scope.in_scope");
    validateStringArray(errors, Array.isArray(scope.out_of_scope_touched) ? scope.out_of_scope_touched : null, "$.frontmatter.scope.out_of_scope_touched");
    if (!Array.isArray(scope.in_scope)) pushIssue(errors, "$.frontmatter.scope.in_scope", "missing_field", "in_scope must be an array");
    if (!Array.isArray(scope.out_of_scope_touched)) pushIssue(errors, "$.frontmatter.scope.out_of_scope_touched", "missing_field", "out_of_scope_touched must be an array");
  }
  const statusValue = document.status;
  const status = typeof statusValue === "string" && ["completed", "partial", "blocked", "failed"].includes(statusValue) ? statusValue : null;
  if (status === null) pushIssue(errors, "$.frontmatter.status", "unknown_receipt_status", "status must be completed, partial, blocked, or failed");
  const changedFiles = requiredArray(errors, document, "changed_files");
  changedFiles?.forEach((value, index) => {
    const entry = plainRecord(value);
    const base = `$.frontmatter.changed_files[${index}]`;
    if (entry === null) {
      pushIssue(errors, base, "wrong_type", "changed_files entries must be mappings");
      return;
    }
    requiredString(errors, entry, base, "path");
    if (!["created", "modified", "deleted", "renamed"].includes(String(entry.change))) {
      pushIssue(errors, `${base}.change`, "unknown_value", "change must be created, modified, deleted, or renamed");
    }
    if (entry.sha256_after !== null && (typeof entry.sha256_after !== "string" || !/^(?:sha256:)?[a-f0-9]{64}$/i.test(entry.sha256_after))) {
      pushIssue(errors, `${base}.sha256_after`, "invalid_hash", "sha256_after must be null or a SHA-256 digest");
    }
  });
  const evidence = requiredArray(errors, document, "evidence");
  evidence?.forEach((value, index) => {
    const entry = plainRecord(value);
    const base = `$.frontmatter.evidence[${index}]`;
    if (entry === null) {
      pushIssue(errors, base, "wrong_type", "evidence entries must be mappings");
      return;
    }
    if (!["test", "command", "log", "artifact", "screenshot", "url"].includes(String(entry.kind))) pushIssue(errors, `${base}.kind`, "unknown_value", "evidence kind is invalid");
    requiredString(errors, entry, base, "ref");
    if (!["pass", "fail", "n/a"].includes(String(entry.result))) pushIssue(errors, `${base}.result`, "unknown_value", "evidence result is invalid");
  });
  const assumptions = requiredArray(errors, document, "assumptions");
  assumptions?.forEach((value, index) => {
    const entry = plainRecord(value);
    const base = `$.frontmatter.assumptions[${index}]`;
    if (entry === null) {
      pushIssue(errors, base, "wrong_type", "assumption entries must be mappings");
      return;
    }
    requiredString(errors, entry, base, "statement");
    if (!["low", "medium", "high"].includes(String(entry.risk_if_wrong))) pushIssue(errors, `${base}.risk_if_wrong`, "unknown_value", "risk_if_wrong is invalid");
  });
  const openRisks = requiredArray(errors, document, "open_risks");
  openRisks?.forEach((value, index) => {
    const entry = plainRecord(value);
    const base = `$.frontmatter.open_risks[${index}]`;
    if (entry === null) {
      pushIssue(errors, base, "wrong_type", "open_risks entries must be mappings");
      return;
    }
    requiredString(errors, entry, base, "statement");
    if (!["low", "medium", "high", "critical"].includes(String(entry.severity))) pushIssue(errors, `${base}.severity`, "unknown_value", "severity is invalid");
    if (typeof entry.owner_accepted !== "boolean") pushIssue(errors, `${base}.owner_accepted`, "wrong_type", "owner_accepted must be boolean");
  });
  const followups = requiredArray(errors, document, "followups");
  followups?.forEach((value, index) => {
    const entry = plainRecord(value);
    const base = `$.frontmatter.followups[${index}]`;
    if (entry === null) {
      pushIssue(errors, base, "wrong_type", "followup entries must be mappings");
      return;
    }
    requiredString(errors, entry, base, "statement");
    if (typeof entry.blocking !== "boolean") pushIssue(errors, `${base}.blocking`, "wrong_type", "blocking must be boolean");
    if (entry.ref !== null && entry.ref !== void 0 && typeof entry.ref !== "string") pushIssue(errors, `${base}.ref`, "wrong_type", "ref must be null or a string");
    if (status === "completed" && entry.blocking === true) pushIssue(errors, `${base}.blocking`, "blocking_followup", "a completed receipt cannot retain a blocking followup");
  });
  const createdAt = canonicalReceiptInstant(errors, document.produced_at, "$.frontmatter.produced_at");
  return {
    shape: "frozen",
    authorId,
    authorFamily: firstField(fields, ["model_family", "family"]) ?? hostId,
    hostId,
    createdAt,
    taskId,
    title,
    status
  };
}
function parseReceiptDocumentInternal(input, requireFrozen) {
  const errors = [];
  try {
    if (typeof input !== "string") {
      pushIssue(errors, "$", "not_a_string", "receipt document must be a string");
      return { status: "unparsable", record: null, errors: sortIssues(errors) };
    }
    if (input.length > RECEIPT_PARSE_BOUNDS.max_characters) {
      pushIssue(errors, "$", "receipt_too_large", "receipt exceeds the parse bound");
      return { status: "unparsable", record: null, errors: sortIssues(errors) };
    }
    const frontmatter = readReceiptFrontmatter(input);
    if (frontmatter.ok === false) {
      pushIssue(errors, "$.frontmatter", "frontmatter_unreadable", frontmatter.reason);
      return { status: "unparsable", record: null, errors: sortIssues(errors) };
    }
    const block = readReceiptMachineBlock(input);
    if (block.ok === false) {
      pushIssue(errors, "$.machine_block", "machine_block_unreadable", block.reason);
      return { status: "unparsable", record: null, errors: sortIssues(errors) };
    }
    const fields = frontmatter.fields;
    const declaredEnvelope = firstField(fields, ["schema_version"]);
    if (declaredEnvelope === null) {
      pushIssue(
        errors,
        "$.frontmatter.schema_version",
        "missing_frontmatter_schema",
        `frontmatter schema_version is required and must be ${RECEIPT_FRONTMATTER_SCHEMA_VERSION}`
      );
    } else if (declaredEnvelope !== RECEIPT_FRONTMATTER_SCHEMA_VERSION) {
      pushIssue(
        errors,
        "$.frontmatter.schema_version",
        "wrong_frontmatter_schema",
        `frontmatter schema_version must be ${RECEIPT_FRONTMATTER_SCHEMA_VERSION}`
      );
    }
    const provenance = receiptProvenance(frontmatter.document, fields, errors);
    if (requireFrozen && provenance.shape !== "frozen") {
      pushIssue(
        errors,
        "$.frontmatter.host",
        "legacy_receipt_transition",
        "a frozen-contract gate requires the structured host mapping"
      );
    }
    if (provenance.shape === "frozen") validateReceiptMachineBlock(block.block, errors);
    const taskIdRead = safeGet(block.block, "task_id");
    const taskId = taskIdRead.ok && typeof taskIdRead.value === "string" ? taskIdRead.value : null;
    if (taskId === null) {
      pushIssue(errors, "$.machine_block.task_id", "missing_field", "task_id must be a string");
    }
    const statusRead = safeGet(block.block, "status");
    const rawStatus = statusRead.ok && typeof statusRead.value === "string" ? statusRead.value : null;
    const statusMap = provenance.shape === "frozen" ? FROZEN_RECEIPT_STATUS_MAP : LEGACY_RECEIPT_STATUS_MAP;
    const mappedStatus = rawStatus !== null && Object.prototype.hasOwnProperty.call(statusMap, rawStatus) ? statusMap[rawStatus] : void 0;
    if (mappedStatus === void 0) {
      pushIssue(
        errors,
        "$.machine_block.status",
        "unknown_receipt_status",
        `status must be one of ${Object.keys(statusMap).sort().join("|")}`
      );
    }
    if (provenance.shape === "frozen" && provenance.taskId !== taskId) {
      pushIssue(errors, "$.frontmatter.ids.task_id", "conflicting_identity", "ids.task_id must match the embedded handoff task_id");
    }
    if (provenance.shape === "frozen" && mappedStatus !== void 0 && provenance.status !== mappedStatus) {
      pushIssue(errors, "$.frontmatter.status", "conflicting_status", "frontmatter status must match the embedded handoff status");
    }
    if (errors.length > 0 || taskId === null) {
      return { status: "unparsable", record: null, errors: sortIssues(errors) };
    }
    const recordId = `doc-handoff-${taskId.toLowerCase()}`;
    if (!DOCUMENT_ID_PATTERN.test(recordId)) {
      pushIssue(
        errors,
        "$.machine_block.task_id",
        "derived_id_invalid",
        `task_id does not yield a stable record id (${recordId})`
      );
      return { status: "unparsable", record: null, errors: sortIssues(errors) };
    }
    const artifactsRead = safeGet(block.block, "artifacts");
    const issuesRead = safeGet(block.block, "issues");
    const titleField = provenance.title;
    const candidate = {
      schema_version: DOCUMENT_SCHEMA_VERSION,
      kind: "handoff",
      id: recordId,
      title: titleField ?? taskId,
      provenance: {
        author_id: provenance.authorId,
        author_family: provenance.authorFamily,
        host_id: provenance.hostId,
        created_at: provenance.createdAt,
        // The record is derived from a receipt document, not authored as a
        // canonical record — say so rather than claiming authorship.
        source: "imported"
      },
      body: {
        task_id: taskId,
        status: mappedStatus,
        artifacts: artifactsRead.ok ? artifactsRead.value : void 0,
        issues: issuesRead.ok ? issuesRead.value : void 0
      }
    };
    const validation = validateDocumentRecord(candidate);
    if (!validation.valid || validation.record === null || validation.record.kind !== "handoff") {
      return { status: "unparsable", record: null, errors: validation.errors };
    }
    return { status: "parsed", record: validation.record, errors: [] };
  } catch {
    pushIssue(errors, "$", "internal_guard", "receipt parse was interrupted");
    return { status: "unparsable", record: null, errors: sortIssues(errors) };
  }
}
function parseReceiptDocument(input) {
  return parseReceiptDocumentInternal(input, false);
}
function decideFromReceiptDocument(input) {
  const parsed = parseReceiptDocument(input);
  if (parsed.status !== "parsed" || parsed.record === null) {
    const refusals = /* @__PURE__ */ new Set(["receipt_not_structured"]);
    for (const error of parsed.errors) {
      if (Object.prototype.hasOwnProperty.call(RECEIPT_REFUSAL_BY_ERROR_CODE, error.code)) {
        refusals.add(RECEIPT_REFUSAL_BY_ERROR_CODE[error.code]);
      }
    }
    return {
      authority: "none",
      gate_signal: "refuse",
      disposition: "unknown",
      content_hash: null,
      projection: null,
      refusals: [...refusals].sort(),
      evidence: parsed.errors
    };
  }
  return decideFromDocumentSources({ record: parsed.record });
}
var RECEIPT_MACHINE_SCHEMA_VERSION, RECEIPT_FRONTMATTER_SCHEMA_VERSION, RECEIPT_PARSE_BOUNDS, RECEIPT_FRONTMATTER_BLOCK, FROZEN_RECEIPT_STATUS_MAP, LEGACY_RECEIPT_STATUS_MAP, RECEIPT_MACHINE_KEYS, CANONICAL_RECEIPT_SECTIONS, RECEIPT_REFUSAL_BY_ERROR_CODE;
var init_document_receipts = __esm({
  "../src/modules/documents/workflows/document-receipts.ts"() {
    init_kernel();
    init_document_safe();
    init_document_records();
    init_document_decisions();
    RECEIPT_MACHINE_SCHEMA_VERSION = "guild.handoff.v2";
    RECEIPT_FRONTMATTER_SCHEMA_VERSION = "guild.handoff_receipt.v1";
    RECEIPT_PARSE_BOUNDS = Object.freeze({
      max_characters: 524288,
      max_frontmatter_lines: 200,
      max_json_blocks: 20
    });
    RECEIPT_FRONTMATTER_BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
    FROZEN_RECEIPT_STATUS_MAP = Object.freeze({
      done: "completed",
      blocked: "blocked",
      escalate: "blocked"
    });
    LEGACY_RECEIPT_STATUS_MAP = Object.freeze({
      complete: "completed",
      completed: "completed",
      done: "completed",
      partial: "partial",
      blocked: "blocked",
      failed: "failed"
    });
    RECEIPT_MACHINE_KEYS = /* @__PURE__ */ new Set([
      "schema_version",
      "task_id",
      "tier",
      "status",
      "summary",
      "artifacts",
      "issues",
      "escalate_reason",
      "learnings",
      "notes",
      "injection_clean"
    ]);
    CANONICAL_RECEIPT_SECTIONS = Object.freeze([
      "changed_files",
      "opens_for",
      "assumptions",
      "evidence",
      "followups"
    ]);
    RECEIPT_REFUSAL_BY_ERROR_CODE = Object.freeze({
      missing_frontmatter_schema: "receipt_envelope_schema_unsupported",
      wrong_frontmatter_schema: "receipt_envelope_schema_unsupported"
    });
  }
});

// ../src/modules/documents/workflows/document-service-boundary.ts
var DOCUMENTS_ALLOWED_MODULE_DEPENDENCIES, DOCUMENTS_ALLOWED_EXTERNAL_PACKAGES, REGEX_PRECEDING, DOCUMENTS_MODULE_SOURCE_FILES;
var init_document_service_boundary = __esm({
  "../src/modules/documents/workflows/document-service-boundary.ts"() {
    DOCUMENTS_ALLOWED_MODULE_DEPENDENCIES = Object.freeze([
      "kernel",
      "lifecycle",
      "telemetry"
    ]);
    DOCUMENTS_ALLOWED_EXTERNAL_PACKAGES = Object.freeze([]);
    REGEX_PRECEDING = new Set("=(,:[!&|?{};+-*%~^<>".split(""));
    DOCUMENTS_MODULE_SOURCE_FILES = Object.freeze([
      "src/modules/documents/index.ts",
      "src/modules/documents/workflows/document-safe.ts",
      "src/modules/documents/workflows/document-records.ts",
      "src/modules/documents/workflows/document-hash.ts",
      "src/modules/documents/workflows/document-projection.ts",
      "src/modules/documents/workflows/document-html.ts",
      "src/modules/documents/workflows/document-legacy-import.ts",
      "src/modules/documents/workflows/document-versioning.ts",
      "src/modules/documents/workflows/document-decisions.ts",
      "src/modules/documents/workflows/document-receipts.ts",
      "src/modules/documents/workflows/document-service-boundary.ts"
    ]);
  }
});

// ../src/modules/documents/index.ts
var init_documents = __esm({
  "../src/modules/documents/index.ts"() {
    init_document_safe();
    init_document_records();
    init_document_hash();
    init_document_projection();
    init_document_html();
    init_document_legacy_import();
    init_document_versioning();
    init_document_decisions();
    init_document_receipts();
    init_document_service_boundary();
  }
});

// ../src/modules/lifecycle/workflows/check-lane-liveness.ts
function readJsonObject(p) {
  let raw;
  try {
    raw = fs4.readFileSync(p, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  return null;
}
function readRunStateLanes(runDir3) {
  const obj = readJsonObject(path5.join(runDir3, "run-state.json"));
  if (obj === null) return null;
  const lanes = obj["lanes"];
  if (typeof lanes !== "object" || lanes === null || Array.isArray(lanes)) {
    return {};
  }
  return lanes;
}
function readHeartbeatAges(runDir3, now = Date.now()) {
  const ages = /* @__PURE__ */ new Map();
  const dir = path5.join(runDir3, "in-progress");
  let names;
  try {
    names = fs4.readdirSync(dir);
  } catch {
    return ages;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const stem = name.slice(0, -".json".length);
    const filePath = path5.join(dir, name);
    const obj = readJsonObject(filePath);
    const ts = obj !== null && typeof obj["timestamp"] === "string" ? Date.parse(obj["timestamp"]) : NaN;
    if (!Number.isNaN(ts)) {
      ages.set(stem, Math.max(0, now - ts));
      continue;
    }
    try {
      const stat = fs4.statSync(filePath);
      ages.set(stem, Math.max(0, now - stat.mtimeMs));
    } catch {
    }
  }
  return ages;
}
function readReceiptEvidence(runDir3) {
  const dir = path5.join(runDir3, "handoffs");
  let names;
  try {
    names = fs4.readdirSync(dir);
  } catch {
    return [];
  }
  const evidence = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    const stem = name.slice(0, -".md".length);
    const filePath = path5.join(dir, name);
    let text = null;
    try {
      if (fs4.statSync(filePath).size <= MAX_RECEIPT_BYTES) {
        text = fs4.readFileSync(filePath, "utf8");
      }
    } catch {
      text = null;
    }
    const decision = decideFromReceiptDocument(text);
    evidence.push({
      stem,
      authority: decision.authority,
      disposition: decision.disposition,
      refusals: decision.refusals,
      trusted: decision.authority === "canonical_record" && decision.gate_signal !== "refuse"
    });
  }
  return evidence;
}
function isStalled(status, receiptClearsStall, signalAgeMs, timeoutMs) {
  if (receiptClearsStall) return false;
  if (TERMINAL_STATUSES.has(status)) return false;
  if (status === "pending" && signalAgeMs === null) return false;
  if (status === "in_progress") {
    return signalAgeMs === null || signalAgeMs >= timeoutMs;
  }
  return signalAgeMs !== null && signalAgeMs >= timeoutMs;
}
function sweepLaneLiveness(runDir3, timeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS, now = Date.now()) {
  const lanes = readRunStateLanes(runDir3);
  const heartbeats = readHeartbeatAges(runDir3, now);
  const receiptEvidence = readReceiptEvidence(runDir3);
  const receipts = receiptEvidence.map((entry) => entry.stem);
  const evidenceByStem = new Map(receiptEvidence.map((entry) => [entry.stem, entry]));
  const consumedHeartbeats = /* @__PURE__ */ new Set();
  const rows = [];
  if (lanes !== null) {
    for (const [laneId2, lane] of Object.entries(lanes)) {
      const status = typeof lane.status === "string" ? lane.status : "unknown";
      const receiptStem = receipts.find((s) => s.endsWith(`-${laneId2}`));
      const receiptPresent = receiptStem !== void 0 || typeof lane.receipt_ref === "string" && lane.receipt_ref.length > 0;
      const evidence = receiptStem !== void 0 ? evidenceByStem.get(receiptStem) ?? NO_RECEIPT : NO_RECEIPT;
      let hbKey;
      if (heartbeats.has(laneId2)) {
        hbKey = laneId2;
      } else {
        hbKey = [...heartbeats.keys()].find((k) => k.endsWith(`-${laneId2}`));
        if (hbKey === void 0 && receiptStem !== void 0) {
          const specialist = receiptStem.slice(
            0,
            receiptStem.length - laneId2.length - 1
          );
          if (heartbeats.has(specialist)) hbKey = specialist;
        }
      }
      const heartbeatAgeMs = hbKey !== void 0 ? heartbeats.get(hbKey) : null;
      if (hbKey !== void 0) consumedHeartbeats.add(hbKey);
      let signalAgeMs = heartbeatAgeMs;
      if (signalAgeMs === null && typeof lane.updated_at === "string") {
        const ts = Date.parse(lane.updated_at);
        if (!Number.isNaN(ts)) signalAgeMs = Math.max(0, now - ts);
      }
      rows.push({
        lane: laneId2,
        status,
        receipt_present: receiptPresent,
        receipt_authority: evidence.authority,
        receipt_disposition: evidence.disposition,
        receipt_refusals: evidence.refusals,
        heartbeat_age_ms: heartbeatAgeMs,
        stalled: isStalled(status, evidence.trusted, signalAgeMs, timeoutMs)
      });
    }
  } else {
    for (const entry of receiptEvidence) {
      const stem = entry.stem;
      const hbKey = [...heartbeats.keys()].find(
        (k) => k === stem || stem.startsWith(`${k}-`)
      );
      const heartbeatAgeMs = hbKey !== void 0 ? heartbeats.get(hbKey) : null;
      if (hbKey !== void 0) consumedHeartbeats.add(hbKey);
      rows.push({
        lane: stem,
        status: "unknown",
        receipt_present: true,
        receipt_authority: entry.authority,
        receipt_disposition: entry.disposition,
        receipt_refusals: entry.refusals,
        heartbeat_age_ms: heartbeatAgeMs,
        stalled: isStalled("unknown", entry.trusted, heartbeatAgeMs, timeoutMs)
      });
    }
  }
  for (const [stem, ageMs] of heartbeats) {
    if (consumedHeartbeats.has(stem)) continue;
    const matchedStem = receipts.find((s) => s === stem || s.startsWith(`${stem}-`));
    const evidence = matchedStem !== void 0 ? evidenceByStem.get(matchedStem) ?? NO_RECEIPT : NO_RECEIPT;
    rows.push({
      lane: stem,
      status: "unknown",
      receipt_present: matchedStem !== void 0,
      receipt_authority: evidence.authority,
      receipt_disposition: evidence.disposition,
      receipt_refusals: evidence.refusals,
      heartbeat_age_ms: ageMs,
      stalled: isStalled("unknown", evidence.trusted, ageMs, timeoutMs)
    });
  }
  return {
    run_dir: runDir3,
    run_state_present: lanes !== null,
    timeout_ms: timeoutMs,
    generated_at: new Date(now).toISOString(),
    lanes: rows
  };
}
function resolveTimeoutMs(env = process.env) {
  const raw = env["GUILD_HEARTBEAT_TIMEOUT_MS"];
  if (raw === void 0) return DEFAULT_HEARTBEAT_TIMEOUT_MS;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_HEARTBEAT_TIMEOUT_MS;
}
function runCheckLaneLivenessCli(argv = process.argv.slice(2)) {
  let runDir3;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run-dir" && argv[i + 1] !== void 0) {
      runDir3 = argv[++i];
    } else if (arg.startsWith("--run-dir=")) {
      runDir3 = arg.slice("--run-dir=".length);
    } else {
      process.stderr.write(`unknown argument: ${arg}
${USAGE}
`);
      return 1;
    }
  }
  if (!runDir3) {
    process.stderr.write(USAGE + "\n");
    return 1;
  }
  const report = sweepLaneLiveness(runDir3, resolveTimeoutMs());
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return 0;
}
var fs4, path5, DEFAULT_HEARTBEAT_TIMEOUT_MS, TERMINAL_STATUSES, MAX_RECEIPT_BYTES, NO_RECEIPT, USAGE;
var init_check_lane_liveness = __esm({
  "../src/modules/lifecycle/workflows/check-lane-liveness.ts"() {
    fs4 = __toESM(require("node:fs"));
    path5 = __toESM(require("node:path"));
    init_documents();
    DEFAULT_HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1e3;
    TERMINAL_STATUSES = /* @__PURE__ */ new Set(["done", "skipped", "dead", "failed"]);
    MAX_RECEIPT_BYTES = 512 * 1024;
    NO_RECEIPT = {
      authority: "none",
      disposition: "unknown",
      refusals: [],
      trusted: false
    };
    USAGE = "usage: check-lane-liveness.ts --run-dir <abs .guild/runs/<id>>";
    if (require.main === module && new RegExp("[\\\\/]check-lane-liveness\\.[cm]?[jt]s$").test(process.argv[1] ?? "")) {
      process.exit(runCheckLaneLivenessCli());
    }
  }
});

// ../src/modules/lifecycle/workflows/event-log-schema.ts
function isSafeRunId(id) {
  return RUN_ID_RE.test(id) && id !== "." && id !== "..";
}
function isSafeLaneId(id) {
  return LANE_ID_RE.test(id) && id !== "." && id !== "..";
}
function assertSafeRunId(id) {
  if (!isSafeRunId(id)) {
    throw new Error(`log-jsonl: invalid run_id ${JSON.stringify(id)}`);
  }
}
function assertSafeLaneId(id) {
  if (!isSafeLaneId(id)) {
    throw new Error(`log-jsonl: invalid lane_id ${JSON.stringify(id)}`);
  }
}
function validateEventIds(event) {
  assertSafeRunId(event.run_id);
  if ("lane_id" in event && event.lane_id !== void 0) {
    assertSafeLaneId(event.lane_id);
  }
}
var TOOL_CALL_TOOL_VALUES, HOOK_EVENT_NAMES, EVENT_TYPES, RUN_ID_RE, LANE_ID_RE;
var init_event_log_schema = __esm({
  "../src/modules/lifecycle/workflows/event-log-schema.ts"() {
    init_kernel();
    TOOL_CALL_TOOL_VALUES = Object.freeze([
      "Read",
      "Write",
      "Edit",
      "Grep",
      "Glob",
      "Bash",
      "Agent",
      "Skill",
      "AskUserQuestion",
      "TaskCreate",
      "TaskUpdate",
      "TaskList",
      "WebFetch",
      "WebSearch",
      "NotebookEdit",
      "BashOutput",
      "KillShell"
    ]);
    HOOK_EVENT_NAMES = Object.freeze([
      "SessionStart",
      "SessionEnd",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "Notification",
      "Stop",
      "SubagentStop",
      "PreCompact",
      "TaskCreated",
      "TaskCompleted",
      "TeammateIdle"
    ]);
    EVENT_TYPES = sealSet([
      "phase_start",
      "phase_end",
      "specialist_dispatch",
      "specialist_receipt",
      "loop_round_start",
      "loop_round_end",
      "tool_call",
      "hook_event",
      "gate_decision",
      "assumption_logged",
      "escalation",
      "codex_review_round"
    ], "EVENT_TYPES");
    RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
    LANE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  }
});

// ../src/modules/security/workflows/safe-object.ts
var PROTO_POISON_KEYS;
var init_safe_object = __esm({
  "../src/modules/security/workflows/safe-object.ts"() {
    init_kernel();
    PROTO_POISON_KEYS = sealSet(["__proto__", "prototype", "constructor"], "PROTO_POISON_KEYS");
  }
});

// ../src/modules/security/workflows/injection-guard.ts
var init_injection_guard = __esm({
  "../src/modules/security/workflows/injection-guard.ts"() {
  }
});

// ../src/modules/security/workflows/redact-log.ts
function redactTokenShapes(input) {
  let out = input;
  for (const re of TOKEN_SHAPE_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags), TOKEN_REDACTED);
  }
  return out;
}
function redactHomeDirPaths(input) {
  return input.replace(HOME_DIR_PATTERN, (_match, root, dir) => {
    return `${root}/${dir}/${PATH_REDACTED}`;
  });
}
function redactKeyValueSecrets(input) {
  return input.replace(
    KV_SECRET_PATTERN,
    (_match, key, sep7) => `${key}${sep7}${KV_REDACTED}`
  );
}
function allWordsWordish(words) {
  let opaqueBudget = 1;
  for (const word of words) {
    if (word.length === 0 || word.length >= 20) return false;
    let upper = 0;
    let lower = 0;
    let digits = 0;
    for (const ch of word) {
      if (ch >= "a" && ch <= "z") lower++;
      else if (ch >= "A" && ch <= "Z") upper++;
      else digits++;
    }
    if (lower === 0) {
      if (word.length > 8) return false;
      if (word.length > 2 && --opaqueBudget < 0) return false;
    } else if (upper > 3 || digits > 4) {
      return false;
    }
  }
  return true;
}
function isSafeDotGuildToken(token) {
  const normalized = token.replace(/^(?:\.{1,2}\/)?\.guild\//, "");
  const root = normalized.split("/", 1)[0] ?? "";
  if (!DOT_GUILD_ROOTS.has(root)) return false;
  const runNormalized = normalized.replace(
    /(^|\/)run-\d{8}-\d{6}-/g,
    "$1run-"
  );
  const words = runNormalized.split(/[/._-]+/).filter(Boolean);
  let opaqueBudget = 1;
  let numericWords = 0;
  for (const word of words) {
    if (word.length === 0 || word.length >= 20) return false;
    if (/^[a-z][a-z0-9]*$/.test(word)) continue;
    if (/^\d+$/.test(word)) {
      numericWords += 1;
      if (numericWords > 3) return false;
      if (word.length > 2 && --opaqueBudget < 0) return false;
      continue;
    }
    if (/^[A-Z][A-Z0-9]{0,7}$/.test(word)) {
      if (word.length > 2 && --opaqueBudget < 0) return false;
      continue;
    }
    return false;
  }
  return true;
}
function isRelativePathToken(candidate, fullInput, matchIndex) {
  if (candidate.includes("+") || candidate.includes("=")) return false;
  let start = matchIndex;
  const startFloor = Math.max(0, matchIndex - MAX_PATH_TOKEN_LEN);
  while (start > startFloor && PATH_TOKEN_CHAR.test(fullInput[start - 1])) start--;
  if (start === startFloor && start > 0 && PATH_TOKEN_CHAR.test(fullInput[start - 1])) {
    return false;
  }
  let end = matchIndex + candidate.length;
  const endCeil = Math.min(fullInput.length, end + MAX_PATH_TOKEN_LEN);
  while (end < endCeil && PATH_TOKEN_CHAR.test(fullInput[end])) end++;
  if (end === endCeil && end < fullInput.length && PATH_TOKEN_CHAR.test(fullInput[end])) {
    return false;
  }
  const token = fullInput.slice(start, end);
  if (token.length > MAX_PATH_TOKEN_LEN) return false;
  const isDotGuildPath = DOT_GUILD_PATH_SHAPE.test(token);
  if (!PATH_SHAPE.test(token) && !isDotGuildPath) return false;
  const slashCount = token.split("/").length - 1;
  if (slashCount < 2 && !PATH_EXTENSION.test(token)) return false;
  if (isDotGuildPath) return isSafeDotGuildToken(token);
  return allWordsWordish(token.split(/[/._-]+/).filter(Boolean));
}
function isWhitelistedHighEntropy(candidate, fullInput, matchIndex) {
  if (matchIndex >= 4 && fullInput.slice(matchIndex - 4, matchIndex) === "run-") {
    return true;
  }
  const lookBackStart = Math.max(0, matchIndex - 16);
  const before = fullInput.slice(lookBackStart, matchIndex).toLowerCase();
  if (/\b(commit|sha|tree|parent|head|merge|object|branch)\s*[:=]?\s*$/.test(before)) {
    return true;
  }
  if (/^[0-9a-f]{40}$/.test(candidate) || /^[0-9a-f]{64}$/.test(candidate)) {
    return true;
  }
  if (isRelativePathToken(candidate, fullInput, matchIndex)) {
    return true;
  }
  return false;
}
function redactHighEntropy(input) {
  return input.replace(HIGH_ENTROPY_PATTERN, (match, offset) => {
    if (isWhitelistedHighEntropy(match, input, offset)) {
      return match;
    }
    return HIGH_ENTROPY_REDACTED;
  });
}
function truncateToCap(input, cap = FIELD_SIZE_CAP_BYTES) {
  const byteLen = Buffer.byteLength(input, "utf8");
  if (byteLen <= cap) return input;
  const buf = Buffer.from(input, "utf8");
  const truncated = buf.slice(0, cap).toString("utf8");
  const cleaned = truncated.replace(/\uFFFD+$/u, "");
  return cleaned + TRUNCATION_SUFFIX;
}
function redactField(input, cap = FIELD_SIZE_CAP_BYTES) {
  if (typeof input !== "string") return input;
  let out = redactTokenShapes(input);
  out = redactHomeDirPaths(out);
  out = redactKeyValueSecrets(out);
  out = redactHighEntropy(out);
  out = truncateToCap(out, cap);
  return out;
}
function redactEventFields(event, cap = FIELD_SIZE_CAP_BYTES) {
  const out = { ...event };
  for (const [k, v] of Object.entries(out)) {
    if (REDACTABLE_FIELDS.has(k) && typeof v === "string") {
      out[k] = redactField(v, cap);
    }
  }
  return out;
}
var TOKEN_REDACTED, PATH_REDACTED, KV_REDACTED, HIGH_ENTROPY_REDACTED, TRUNCATION_SUFFIX, FIELD_SIZE_CAP_BYTES, TOKEN_SHAPE_PATTERNS, SENSITIVE_HOME_DIRS, HOME_DIR_PATTERN, KV_SECRET_PATTERN, PATH_TOKEN_CHAR, PATH_SHAPE, DOT_GUILD_PATH_SHAPE, DOT_GUILD_ROOTS, PATH_EXTENSION, MAX_PATH_TOKEN_LEN, HIGH_ENTROPY_PATTERN, REDACTABLE_FIELD_NAMES, REDACTABLE_FIELDS;
var init_redact_log = __esm({
  "../src/modules/security/workflows/redact-log.ts"() {
    init_kernel();
    TOKEN_REDACTED = "[REDACTED_TOKEN]";
    PATH_REDACTED = "[REDACTED]";
    KV_REDACTED = "[REDACTED]";
    HIGH_ENTROPY_REDACTED = "<HIGH_ENTROPY_REDACTED>";
    TRUNCATION_SUFFIX = "... [TRUNCATED]";
    FIELD_SIZE_CAP_BYTES = 4 * 1024;
    TOKEN_SHAPE_PATTERNS = Object.freeze([
      Object.freeze(/Authorization:\s*Bearer\s+[A-Za-z0-9._\-+/=]+/g),
      Object.freeze(/\bBearer\s+[A-Za-z0-9._\-+/=]{16,}/g),
      Object.freeze(/\bsk-(ant-)?[A-Za-z0-9_-]{20,}/g),
      Object.freeze(/\bghp_[A-Za-z0-9]{36}\b/g),
      Object.freeze(/\bgh[suor]_[A-Za-z0-9]{36}\b/g),
      Object.freeze(/\bgithub_pat_[A-Za-z0-9_]{82}\b/g),
      Object.freeze(/\bxox[bp]-[A-Za-z0-9-]{10,}/g),
      Object.freeze(/\bAKIA[0-9A-Z]{16}\b/g),
      Object.freeze(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)
    ]);
    SENSITIVE_HOME_DIRS = Object.freeze([
      ".claude",
      ".codex",
      ".ssh",
      ".aws",
      ".gnupg"
    ]);
    HOME_DIR_PATTERN = /(~|\/Users\/[^/\s]+|\/home\/[^/\s]+)\/(\.claude|\.codex|\.ssh|\.aws|\.gnupg)\/[^\s'"]+/g;
    KV_SECRET_PATTERN = /\b(password|token|api[_-]?key|secret|authorization|bearer)(\s*[:=]\s*)(\S+)/gi;
    PATH_TOKEN_CHAR = /[A-Za-z0-9._/-]/;
    PATH_SHAPE = /^(?:\.{1,2}\/)?[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/;
    DOT_GUILD_PATH_SHAPE = /^(?:\.{1,2}\/)?\.guild(?:\/[A-Za-z0-9._-]+)+$/;
    DOT_GUILD_ROOTS = /* @__PURE__ */ new Set([
      "agents",
      "artifacts",
      "context",
      "evolve",
      "indexes",
      "init",
      "initiatives",
      "knowledge",
      "loops",
      "memory",
      "plan",
      "prd",
      "raw",
      "reflections",
      "runs",
      "skills",
      "spec",
      "team",
      "teams",
      "wiki",
      "workflows",
      "workspace",
      "workspace-knowledge"
    ]);
    PATH_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
    MAX_PATH_TOKEN_LEN = 512;
    HIGH_ENTROPY_PATTERN = /[A-Za-z0-9+/=]{20,}/g;
    REDACTABLE_FIELD_NAMES = Object.freeze([
      "command_redacted",
      "result_excerpt_redacted",
      "payload_excerpt_redacted",
      "prompt_excerpt",
      "assumption_text",
      "result"
    ]);
    REDACTABLE_FIELDS = sealSet(REDACTABLE_FIELD_NAMES, "REDACTABLE_FIELDS");
  }
});

// ../src/modules/security/workflows/secrets.ts
var init_secrets = __esm({
  "../src/modules/security/workflows/secrets.ts"() {
    init_redact_log();
  }
});

// ../src/modules/state/workflows/plugin-install-guard.ts
function assertNotUnderPluginInstall(absPath, pluginInstallRoot) {
  const root = pluginInstallRoot ?? process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"] ?? process.env["CODEX_PLUGIN_ROOT"];
  if (!root) return;
  const resolvedRoot = path6.resolve(root);
  const rel = path6.relative(resolvedRoot, path6.resolve(absPath));
  if (rel === "" || !rel.startsWith("..") && !path6.isAbsolute(rel)) {
    const underOwnDotGuild = rel === ".guild" || rel.startsWith(`.guild${path6.sep}`);
    if (underOwnDotGuild && fs5.existsSync(path6.join(resolvedRoot, ".git"))) return;
    throw new Error(`project-created Guild artifact would be written under plugin install dir: ${absPath}`);
  }
}
var fs5, path6;
var init_plugin_install_guard = __esm({
  "../src/modules/state/workflows/plugin-install-guard.ts"() {
    fs5 = __toESM(require("node:fs"));
    path6 = __toESM(require("node:path"));
  }
});

// ../src/modules/state/workflows/atomic-write.ts
function atomicWrite(targetPath, content, pluginInstallRoot) {
  assertNotUnderPluginInstall(targetPath, pluginInstallRoot);
  const dir = path7.dirname(targetPath);
  fs6.mkdirSync(dir, { recursive: true });
  const unique = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const tmpPath = path7.join(dir, `.${path7.basename(targetPath)}.tmp-${unique}`);
  fs6.writeFileSync(tmpPath, content, "utf8");
  try {
    fs6.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      fs6.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
var fs6, path7, crypto;
var init_atomic_write = __esm({
  "../src/modules/state/workflows/atomic-write.ts"() {
    fs6 = __toESM(require("fs"));
    path7 = __toESM(require("path"));
    crypto = __toESM(require("crypto"));
    init_plugin_install_guard();
  }
});

// ../src/modules/state/workflows/dependency-graph-schema.ts
var DEPENDENCY_GRAPH_SCHEMA_VERSION, DEPENDENCY_GRAPH_V1_EXAMPLE;
var init_dependency_graph_schema = __esm({
  "../src/modules/state/workflows/dependency-graph-schema.ts"() {
    init_kernel();
    DEPENDENCY_GRAPH_SCHEMA_VERSION = "guild.dependency_graph.v1";
    DEPENDENCY_GRAPH_V1_EXAMPLE = deepFreeze({
      schema_version: DEPENDENCY_GRAPH_SCHEMA_VERSION,
      nodes: [
        { id: "guild-plugin", path: "plugin" },
        { id: "guild-website", path: "website" },
        { id: "guild-benchmark", path: "benchmark" }
      ],
      edges: [
        { from: "guild-website", to: "guild-plugin", reason: "docs the plugin surface" },
        { from: "guild-benchmark", to: "guild-plugin", reason: "evals the plugin behavior" }
      ]
    });
  }
});

// ../src/modules/state/workflows/dependency-graph-reader.ts
var init_dependency_graph_reader = __esm({
  "../src/modules/state/workflows/dependency-graph-reader.ts"() {
    init_dependency_graph_schema();
  }
});

// ../src/modules/state/workflows/frontmatter.ts
var init_frontmatter = __esm({
  "../src/modules/state/workflows/frontmatter.ts"() {
    init_kernel();
  }
});

// ../src/modules/state/workflows/guild-root.ts
function resolveGuildRoot2(startDir) {
  const resolvedStart = path8.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs7.existsSync(path8.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path8.join(current, ".guild");
      try {
        if (fs7.existsSync(guildDir) && fs7.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
      }
    }
    const parent = path8.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}
var fs7, path8;
var init_guild_root = __esm({
  "../src/modules/state/workflows/guild-root.ts"() {
    fs7 = __toESM(require("node:fs"));
    path8 = __toESM(require("node:path"));
  }
});

// ../src/modules/state/workflows/guild-discovery.ts
var init_guild_discovery = __esm({
  "../src/modules/state/workflows/guild-discovery.ts"() {
    init_guild_root();
  }
});

// ../src/modules/migrations/workflows/index-migrate.ts
function openDatabase(dbPath) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
function resolveGuildRoot3(cwd) {
  try {
    const raw = (0, import_node_child_process.execFileSync)("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const abs = path9.isAbsolute(raw) ? raw : path9.resolve(cwd, raw);
    const root = path9.dirname(abs);
    if (fs8.existsSync(root)) return root;
  } catch {
  }
  return path9.resolve(cwd);
}
function runMigrations(dbPath) {
  let db;
  let fromVersion = 0;
  try {
    fs8.mkdirSync(path9.dirname(dbPath), { recursive: true });
    db = openDatabase(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    fromVersion = db.prepare("PRAGMA user_version").get().user_version;
    for (const mig of MIGRATIONS) {
      if (mig.version <= fromVersion) continue;
      try {
        db.exec("BEGIN IMMEDIATE");
        mig.up(db);
        db.exec(`PRAGMA user_version = ${mig.version}`);
        db.exec("COMMIT");
        fromVersion = mig.version;
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
        }
        for (const tbl of mig.tables) {
          try {
            db.exec(`DROP TABLE IF EXISTS ${tbl}`);
          } catch {
          }
        }
        db.close();
        return {
          ok: false,
          fromVersion,
          toVersion: fromVersion,
          dbPath,
          message: `migration to v${mig.version} failed: ${err.message}`
        };
      }
    }
    db.close();
    return {
      ok: true,
      fromVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      dbPath
    };
  } catch (err) {
    try {
      db?.close();
    } catch {
    }
    return {
      ok: false,
      fromVersion,
      toVersion: fromVersion,
      dbPath,
      message: `migration runner error: ${err.message}`
    };
  }
}
function runIndexMigrateCli() {
  const argv = process.argv.slice(2);
  let cwd = process.env["GUILD_CWD"] ?? process.cwd();
  let dbPath;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cwd" && argv[i + 1]) cwd = argv[++i];
    if (argv[i] === "--db-path" && argv[i + 1]) dbPath = argv[++i];
  }
  if (!dbPath) {
    const guildRoot = resolveGuildRoot3(cwd);
    dbPath = path9.join(guildRoot, ".guild", "index.sqlite");
  }
  const result = runMigrations(dbPath);
  if (result.ok) {
    process.stdout.write(
      `[index-migrate] OK: schema v${result.fromVersion}\u2192v${result.toVersion} at ${result.dbPath}
`
    );
  } else {
    process.stderr.write(`[index-migrate] WARN: ${result.message}
`);
    process.exit(1);
  }
}
var import_node_child_process, fs8, path9, CURRENT_SCHEMA_VERSION, MIGRATIONS;
var init_index_migrate = __esm({
  "../src/modules/migrations/workflows/index-migrate.ts"() {
    import_node_child_process = require("node:child_process");
    fs8 = __toESM(require("node:fs"));
    path9 = __toESM(require("node:path"));
    CURRENT_SCHEMA_VERSION = 3;
    MIGRATIONS = [
      // ── v1: core tables ───────────────────────────────────────────────────────
      {
        version: 1,
        tables: ["kg_nodes", "kg_edges", "kl_edges", "run_provenance", "wiki_fts", "_fingerprints"],
        up(db) {
          db.exec(`
        DROP TABLE IF EXISTS kg_nodes;
        DROP TABLE IF EXISTS kg_edges;
        DROP TABLE IF EXISTS kl_edges;
        DROP TABLE IF EXISTS run_provenance;
        DROP TABLE IF EXISTS wiki_fts;
        DROP TABLE IF EXISTS _fingerprints;
      `);
          db.exec(`
        CREATE TABLE kg_nodes (
          id         TEXT NOT NULL PRIMARY KEY,
          type       TEXT,
          name       TEXT,
          source_refs TEXT,
          confidence TEXT,
          layer      TEXT,
          data       TEXT
        );

        CREATE TABLE kg_edges (
          id        INTEGER PRIMARY KEY,
          source    TEXT NOT NULL,
          target    TEXT NOT NULL,
          type      TEXT,
          direction TEXT,
          weight    REAL,
          data      TEXT
        );

        CREATE TABLE kl_edges (
          id        INTEGER PRIMARY KEY,
          from_node TEXT NOT NULL,
          to_node   TEXT NOT NULL,
          type      TEXT,
          run_id    TEXT,
          data      TEXT
        );

        CREATE TABLE run_provenance (
          run_id TEXT NOT NULL PRIMARY KEY,
          ts     TEXT,
          data   TEXT
        );

        CREATE TABLE _fingerprints (
          table_name   TEXT NOT NULL PRIMARY KEY,
          source_path  TEXT NOT NULL,
          sha256       TEXT NOT NULL,
          populated_at TEXT NOT NULL
        );
      `);
          try {
            db.exec(`
          CREATE VIRTUAL TABLE wiki_fts USING fts5(
            path      UNINDEXED,
            title,
            content,
            tokenize='porter ascii'
          );
        `);
          } catch {
            db.exec(`
          CREATE TABLE wiki_fts (
            path    TEXT,
            title   TEXT,
            content TEXT
          );
        `);
          }
        }
      },
      // ── v2: federation_wiki_cache (TE-14) ────────────────────────────────────
      //
      // Stores a flat BM25-ready snapshot of each federated sub-guild's wiki.
      // Primary key is (sub_guild_root, path) — one row per page per sub-guild.
      // Fingerprint key in _fingerprints: "federation_wiki_cache:<sub_guild_root>".
      //
      // BOUNDARY: this table ONLY lives in the workspace-root index.sqlite; no
      // production code writes to sub_guild_root/.guild/. NOTE: the populate/
      // invalidate function (ensureFederationWikiCache) was removed in
      // plugin-audit-remediation G5a (2026-07) as zero-consumer dead code — this
      // schema migration is retained (harmless empty table) since altering the
      // migration ladder is a separate, out-of-scope decision.
      {
        version: 2,
        tables: ["federation_wiki_cache"],
        up(db) {
          db.exec(`DROP TABLE IF EXISTS federation_wiki_cache;`);
          db.exec(`
        CREATE TABLE federation_wiki_cache (
          sub_guild_root TEXT NOT NULL,
          path           TEXT NOT NULL,
          title          TEXT,
          snippet        TEXT,
          PRIMARY KEY (sub_guild_root, path)
        );
      `);
        }
      },
      // ── v3: optional structural projection (T5.1 / G5) ───────────────────────
      //
      // Two OPTIONAL acceleration tables projected from the canonical, file-first
      // knowledge-graph.json (goals.md §G5). Both are pure, threshold-gated,
      // fingerprinted, fully-rebuildable caches: deleting index.sqlite loses
      // nothing, and `index: off` (in-process JSON BFS via lib/graph-query.ts)
      // remains the source of truth that returns IDENTICAL answers.
      //
      //   kg_calls       — denormalized `calls` edges (source, target, confidence),
      //                    indexed on source AND target so the call-graph BFS
      //                    (kgTrace / kgDeadCode) is fetched without parsing the
      //                    whole JSON graph.
      //   kg_symbols_fts — FTS5 over the camel/snake-split tokens of each named
      //                    node, so identifier search (`process_order` →
      //                    `processOrder`) is an index lookup, not a full node scan.
      //                    Tokens are PRE-SPLIT with the shared identifier-aware
      //                    tokenizer (bm25.ts:tokenizeIdentifierAware) on BOTH the
      //                    document and query side, so the FTS built-in tokenizer
      //                    only has to whitespace-split — the camel/snake behaviour
      //                    lives in the (deterministic, model-free) projection feed.
      {
        version: 3,
        tables: ["kg_calls", "kg_symbols_fts"],
        up(db) {
          db.exec(`
        DROP TABLE IF EXISTS kg_calls;
        DROP TABLE IF EXISTS kg_symbols_fts;
      `);
          db.exec(`
        CREATE TABLE kg_calls (
          id         INTEGER PRIMARY KEY,
          source     TEXT NOT NULL,
          target     TEXT NOT NULL,
          confidence TEXT
        );
        CREATE INDEX kg_calls_source ON kg_calls (source);
        CREATE INDEX kg_calls_target ON kg_calls (target);
      `);
          try {
            db.exec(`
          CREATE VIRTUAL TABLE kg_symbols_fts USING fts5(
            node_id UNINDEXED,
            name_tokens,
            tokenize='ascii'
          );
        `);
          } catch {
            db.exec(`
          CREATE TABLE kg_symbols_fts (
            node_id     TEXT,
            name_tokens TEXT
          );
        `);
          }
        }
      }
    ];
    if (typeof module !== "undefined" && require.main === module && /^index-migrate\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
      runIndexMigrateCli();
    }
  }
});

// ../src/modules/migrations/workflows/wiki-importance.ts
var STRUCTURAL_BASENAMES;
var init_wiki_importance = __esm({
  "../src/modules/migrations/workflows/wiki-importance.ts"() {
    init_kernel();
    init_state();
    STRUCTURAL_BASENAMES = sealSet([
      "index.md",
      "readme.md",
      "log.md",
      "query.md",
      "transfer-manifest.md"
    ], "STRUCTURAL_BASENAMES");
  }
});

// ../src/modules/migrations/workflows/host-cutover-controller.ts
function authenticateJournalHandle(handle) {
  if (handle === null || typeof handle !== "object" && typeof handle !== "function" || !AUTHENTICATED_JOURNAL_HANDLES.has(handle)) {
    throw new Error(
      "journal handle was not returned by openMigrationJournal (unauthorized/unopened handle refused)"
    );
  }
}
function flattenRecord(value, prefix = "") {
  const out = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return out;
  for (const key of Object.keys(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    const val = value[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      Object.assign(out, flattenRecord(val, full));
    } else {
      out[full] = val;
    }
  }
  return out;
}
function assertBoundedComparisonComplexity(text, label) {
  if (text.length > MH08_COMPARISON_MAX_TEXT_LENGTH) {
    throw new Error(
      `compareMigrationOutcomes: ${label} exceeds the maximum comparison text size (materially complex comparison text refused)`
    );
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      depth += 1;
      if (depth > MH08_COMPARISON_MAX_DEPTH) {
        throw new Error(
          `compareMigrationOutcomes: ${label} exceeds the maximum comparison nesting depth (materially deep comparison text refused)`
        );
      }
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
    }
  }
}
function parseCanonicalComparisonText(text, label) {
  assertBoundedComparisonComplexity(text, label);
  let parsed;
  let canonical;
  try {
    parsed = JSON.parse(text);
    canonical = neutralCanonicalJson(parsed);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error(
        `compareMigrationOutcomes: ${label} exceeds the maximum comparison depth/complexity (materially deep or complex comparison text refused)`
      );
    }
    throw new Error(`compareMigrationOutcomes: ${label} is not valid JSON (malformed comparison text refused)`);
  }
  if (canonical !== text) {
    throw new Error(
      `compareMigrationOutcomes: ${label} is not canonical JSON text (must exact-round-trip through the neutral canonical encoder)`
    );
  }
  return parsed;
}
function compareMigrationOutcomes(legacyText, candidateText) {
  if (typeof legacyText !== "string" || typeof candidateText !== "string") {
    throw new Error(
      "compareMigrationOutcomes: comparison admission requires canonical JSON text (a string), not a live object"
    );
  }
  const legacy = parseCanonicalComparisonText(legacyText, "legacyText");
  const candidate = parseCanonicalComparisonText(candidateText, "candidateText");
  const flatLegacy = flattenRecord(legacy);
  const flatCandidate = flattenRecord(candidate);
  const fields = Array.from(/* @__PURE__ */ new Set([...Object.keys(flatLegacy), ...Object.keys(flatCandidate)])).sort();
  const differences = [];
  for (const field of fields) {
    if (MH08_PROVENANCE_ALLOWLIST.indexOf(field) !== -1) continue;
    const a = neutralCanonicalJson(flatLegacy[field] ?? null);
    const b = neutralCanonicalJson(flatCandidate[field] ?? null);
    if (a !== b) {
      differences.push({ field, legacy: flatLegacy[field] ?? null, candidate: flatCandidate[field] ?? null });
    }
  }
  return neutralFreeze({
    equivalent: differences.length === 0,
    compared_fields: fields,
    differences,
    allowlisted_fields: [...MH08_PROVENANCE_ALLOWLIST]
  });
}
function journalPath(root) {
  return path10.join(root, "journal.ndjson");
}
function assertNoSymlinkComponents(base, resolved) {
  const rel = path10.relative(base, resolved);
  if (rel.length === 0) return;
  let current = base;
  for (const segment of rel.split(path10.sep)) {
    if (segment.length === 0) continue;
    current = path10.join(current, segment);
    const stat = fs9.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`journal root path contains a symlink component: ${current}`);
    }
  }
}
function nearestProjectRoot(startDir) {
  const resolvedStart = path10.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs9.existsSync(path10.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path10.join(current, ".guild");
      try {
        if (fs9.existsSync(guildDir) && fs9.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
      }
    }
    const parent = path10.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}
function trustedDurableBases() {
  const bases = /* @__PURE__ */ new Set();
  bases.add(path10.resolve(nearestProjectRoot(process.cwd()), ".guild", "runs"));
  const guildCwd = process.env["GUILD_CWD"];
  if (typeof guildCwd === "string" && guildCwd.length > 0) {
    bases.add(path10.resolve(nearestProjectRoot(guildCwd), ".guild", "runs"));
  }
  return [...bases];
}
function matchTrustedBase(resolved) {
  const tmpBase = path10.resolve(os.tmpdir());
  if (resolved === tmpBase || resolved.indexOf(tmpBase + path10.sep) === 0) {
    return tmpBase;
  }
  for (const durableBase of trustedDurableBases()) {
    if (resolved === durableBase || resolved.indexOf(durableBase + path10.sep) === 0) {
      return durableBase;
    }
  }
  return null;
}
function openMigrationJournal(root) {
  if (typeof root !== "string" || root.length === 0) {
    throw new Error("openMigrationJournal: journal root must be a non-empty string");
  }
  const resolved = path10.resolve(root);
  let stat;
  try {
    stat = fs9.lstatSync(resolved);
  } catch {
    throw new Error(
      `openMigrationJournal: journal root does not exist or escapes the controller-owned containment boundary (traversal refused): ${resolved}`
    );
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`openMigrationJournal: journal root is a symlink, not a contained directory: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`openMigrationJournal: journal root is not a directory (non-directory preimage): ${resolved}`);
  }
  const matchedBase = matchTrustedBase(resolved);
  if (matchedBase === null) {
    throw new Error(
      `openMigrationJournal: journal root escapes the controller-owned containment boundary (untrusted root, traversal refused): ${resolved}`
    );
  }
  assertNoSymlinkComponents(matchedBase, resolved);
  const handle = neutralFreeze({ root: resolved });
  AUTHENTICATED_JOURNAL_HANDLES.add(handle);
  return handle;
}
function computeRecordHash(input) {
  return `sha256:${crypto2.createHash("sha256").update(neutralCanonicalJson(input)).digest("hex")}`;
}
function readMigrationJournal(handle) {
  authenticateJournalHandle(handle);
  const root = handle.root;
  const entries = fs9.existsSync(root) ? fs9.readdirSync(root) : [];
  const partialWrites = entries.filter((name) => /^journal\.ndjson\.\d+\.tmp$/.test(name));
  if (partialWrites.length > 0) {
    throw new Error(
      `readMigrationJournal: refusing a partial/incomplete journal write: ${partialWrites.join(", ")}`
    );
  }
  const file = journalPath(root);
  let fileStat;
  try {
    fileStat = fs9.lstatSync(file);
  } catch {
    return neutralFreeze([]);
  }
  if (fileStat.isSymbolicLink()) {
    throw new Error(`readMigrationJournal: journal.ndjson is a symlink, not a contained regular file: ${file}`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`readMigrationJournal: journal.ndjson is not a regular file: ${file}`);
  }
  const noFollow = typeof fs9.constants.O_NOFOLLOW === "number" ? fs9.constants.O_NOFOLLOW : 0;
  const fd = fs9.openSync(file, fs9.constants.O_RDONLY | noFollow);
  let content;
  try {
    content = fs9.readFileSync(fd, "utf8");
  } finally {
    fs9.closeSync(fd);
  }
  const lines = content.split("\n").filter((line) => line.length > 0);
  const records = lines.map((line) => JSON.parse(line));
  let previous = "sha256:genesis";
  let expectedSequence = 1;
  for (const record of records) {
    if (record.sequence !== expectedSequence) {
      throw new Error(
        `readMigrationJournal: journal sequence gap \u2014 expected ${expectedSequence}, found ${record.sequence}`
      );
    }
    if (record.previous_hash !== previous) {
      throw new Error(`readMigrationJournal: journal hash drift at sequence ${record.sequence}`);
    }
    const recomputed = computeRecordHash({
      sequence: record.sequence,
      operation_id: record.operation_id,
      mode: record.mode,
      scope: record.scope,
      disposition: record.disposition,
      reason_code: record.reason_code,
      comparison: record.comparison,
      previous_hash: record.previous_hash
    });
    if (recomputed !== record.record_hash) {
      throw new Error(`readMigrationJournal: journal record hash mismatch at sequence ${record.sequence}`);
    }
    previous = record.record_hash;
    expectedSequence += 1;
  }
  return neutralFreeze(records);
}
function appendMigrationDecision(handle, input) {
  authenticateJournalHandle(handle);
  if (MH08_MODES.indexOf(input.mode) === -1) {
    throw new Error(
      `appendMigrationDecision: mode ${JSON.stringify(input.mode)} is not in the closed vocabulary legacy | shadow | current | rollback`
    );
  }
  const file = journalPath(handle.root);
  const lockPath2 = `${file}.lock`;
  let lockFd;
  try {
    lockFd = fs9.openSync(lockPath2, "wx");
  } catch {
    throw new Error(
      `appendMigrationDecision: concurrent journal write in progress on this root, refusing (fail-closed): ${handle.root}`
    );
  }
  try {
    const existing = readMigrationJournal(handle);
    const reasonCode = input.reason_code ?? null;
    const comparison = input.comparison ?? null;
    const prior = existing.find((record2) => record2.operation_id === input.operation_id);
    if (prior !== void 0) {
      const sameEffect = prior.mode === input.mode && prior.disposition === input.disposition && prior.reason_code === reasonCode && neutralCanonicalJson(prior.scope) === neutralCanonicalJson(input.scope) && neutralCanonicalJson(prior.comparison) === neutralCanonicalJson(comparison);
      if (!sameEffect) {
        throw new Error(
          `appendMigrationDecision: operation id ${input.operation_id} reused with divergent content`
        );
      }
      return prior;
    }
    const previousHash = existing.length > 0 ? existing[existing.length - 1].record_hash : "sha256:genesis";
    const sequence = existing.length + 1;
    const scope = { host_id: input.scope.host_id, capability_id: input.scope.capability_id, host_version: input.scope.host_version };
    const base = {
      sequence,
      operation_id: input.operation_id,
      mode: input.mode,
      scope,
      disposition: input.disposition,
      reason_code: reasonCode,
      comparison,
      previous_hash: previousHash
    };
    const hash = computeRecordHash(base);
    const record = neutralFreeze({
      schema_version: MH08_DECISION_SCHEMA,
      ...base,
      record_hash: hash
    });
    const tmp = `${file}.${sequence}.tmp`;
    const priorContent = fs9.existsSync(file) ? fs9.readFileSync(file, "utf8") : "";
    fs9.writeFileSync(tmp, `${priorContent}${JSON.stringify(record)}
`);
    fs9.renameSync(tmp, file);
    return record;
  } finally {
    fs9.closeSync(lockFd);
    fs9.rmSync(lockPath2, { force: true });
  }
}
function sameScope(a, b) {
  return a.host_id === b.host_id && a.capability_id === b.capability_id && a.host_version === b.host_version;
}
function resolveEffectiveSelection(records, scope) {
  const forScope = (records ?? []).filter((record) => sameScope(record.scope, scope));
  if (forScope.length === 0) return "legacy";
  const last = forScope[forScope.length - 1];
  if (last.disposition !== "succeeded") return "legacy";
  if (last.mode === "current") return "current";
  return "legacy";
}
function scenarioScope(base, stableId) {
  return { host_id: base.host_id, capability_id: `${base.capability_id}#${stableId}`, host_version: base.host_version };
}
function scenarioEvidenceFor(request, stableId) {
  const map = request.scenario_evidence ?? {};
  const raw = map[stableId];
  if (raw === null || typeof raw !== "object") return null;
  const entry = raw;
  if (typeof entry.legacy_outcome !== "string" || typeof entry.candidate_outcome !== "string") return null;
  return {
    legacy_outcome: entry.legacy_outcome,
    candidate_outcome: entry.candidate_outcome,
    side_effect_authority: entry.side_effect_authority
  };
}
function sideEffectAuthorityProvesNoCandidateCommit(value) {
  if (value === null || typeof value !== "object") return false;
  const record = value;
  if (typeof record.legacy_commits !== "number" || typeof record.candidate_commits !== "number") return false;
  return record.legacy_commits > 0 && record.candidate_commits === 0;
}
function hasSideEffectAuthorityShape(value) {
  if (value === null || typeof value !== "object") return false;
  const record = value;
  return typeof record.legacy_commits === "number" && typeof record.candidate_commits === "number";
}
function runMh08Scenario(handle, runId, baseScope, stableId, request) {
  const scope = scenarioScope(baseScope, stableId);
  const evidence = scenarioEvidenceFor(request, stableId);
  if (evidence === null) {
    return { disposition: "refused", reason_code: MH08_EVIDENCE_INCOMPLETE_REASON_CODE };
  }
  if (stableId === "MHRC-STR-001") {
    if (!hasSideEffectAuthorityShape(evidence.side_effect_authority)) {
      return { disposition: "refused", reason_code: MH08_EVIDENCE_INCOMPLETE_REASON_CODE };
    }
    const comparison2 = compareMigrationOutcomes(evidence.legacy_outcome, evidence.candidate_outcome);
    appendMigrationDecision(handle, {
      operation_id: `${runId}:${stableId}:shadow`,
      mode: "shadow",
      scope,
      disposition: comparison2.equivalent ? "succeeded" : "refused",
      reason_code: comparison2.equivalent ? null : MH08_DIVERGENCE_REASON_CODE,
      comparison: comparison2
    });
    if (!comparison2.equivalent) {
      return { disposition: "refused", reason_code: MH08_DIVERGENCE_REASON_CODE };
    }
    const authorityOk = sideEffectAuthorityProvesNoCandidateCommit(evidence.side_effect_authority);
    return authorityOk ? { disposition: "succeeded", reason_code: null } : { disposition: "refused", reason_code: MH08_RESULT_MISMATCH_REASON_CODE };
  }
  if (stableId === "MHRC-STR-002") {
    const comparison2 = compareMigrationOutcomes(evidence.legacy_outcome, evidence.candidate_outcome);
    appendMigrationDecision(handle, {
      operation_id: `${runId}:${stableId}:shadow`,
      mode: "shadow",
      scope,
      disposition: comparison2.equivalent ? "succeeded" : "refused",
      reason_code: comparison2.equivalent ? null : MH08_DIVERGENCE_REASON_CODE,
      comparison: comparison2
    });
    if (!comparison2.equivalent) {
      return { disposition: "refused", reason_code: MH08_DIVERGENCE_REASON_CODE };
    }
    appendMigrationDecision(handle, {
      operation_id: `${runId}:${stableId}:current`,
      mode: "current",
      scope,
      disposition: "succeeded",
      reason_code: null,
      comparison: null
    });
    const records = readMigrationJournal(handle);
    const inScope = resolveEffectiveSelection(records, scope);
    const outOfScope = resolveEffectiveSelection(records, { ...scope, host_id: `${scope.host_id}-control-out-of-scope` });
    const ok = inScope === "current" && outOfScope === "legacy";
    return { disposition: ok ? "succeeded" : "refused", reason_code: ok ? null : MH08_RESULT_MISMATCH_REASON_CODE };
  }
  if (stableId === "MHRC-STR-003") {
    const comparison2 = compareMigrationOutcomes(evidence.legacy_outcome, evidence.candidate_outcome);
    appendMigrationDecision(handle, {
      operation_id: `${runId}:${stableId}:shadow`,
      mode: "shadow",
      scope,
      disposition: comparison2.equivalent ? "succeeded" : "refused",
      reason_code: comparison2.equivalent ? null : MH08_DIVERGENCE_REASON_CODE,
      comparison: comparison2
    });
    if (!comparison2.equivalent) {
      return { disposition: "refused", reason_code: MH08_DIVERGENCE_REASON_CODE };
    }
    appendMigrationDecision(handle, {
      operation_id: `${runId}:${stableId}:current`,
      mode: "current",
      scope,
      disposition: "succeeded",
      reason_code: null,
      comparison: null
    });
    appendMigrationDecision(handle, {
      operation_id: `${runId}:${stableId}:rollback`,
      mode: "rollback",
      scope,
      disposition: "succeeded",
      reason_code: null,
      comparison: null
    });
    const records = readMigrationJournal(handle);
    const effective = resolveEffectiveSelection(records, scope);
    const scenarioRecordCount = records.filter((record) => sameScope(record.scope, scope)).length;
    const ok = effective === "legacy" && scenarioRecordCount === 3;
    return { disposition: ok ? "succeeded" : "refused", reason_code: ok ? null : MH08_RESULT_MISMATCH_REASON_CODE };
  }
  const comparison = compareMigrationOutcomes(evidence.legacy_outcome, evidence.candidate_outcome);
  appendMigrationDecision(handle, {
    operation_id: `${runId}:${stableId}:shadow`,
    mode: "shadow",
    scope,
    disposition: comparison.equivalent ? "succeeded" : "refused",
    reason_code: comparison.equivalent ? null : MH08_DIVERGENCE_REASON_CODE,
    comparison
  });
  return comparison.equivalent ? { disposition: "refused", reason_code: MH08_RESULT_MISMATCH_REASON_CODE } : { disposition: "refused", reason_code: MH08_DIVERGENCE_REASON_CODE };
}
function asScope(value) {
  if (value === null || typeof value !== "object") return MH08_DEFAULT_SCOPE;
  const record = value;
  return {
    host_id: typeof record.host_id === "string" ? record.host_id : MH08_DEFAULT_SCOPE.host_id,
    capability_id: typeof record.capability_id === "string" ? record.capability_id : MH08_DEFAULT_SCOPE.capability_id,
    host_version: typeof record.host_version === "string" ? record.host_version : MH08_DEFAULT_SCOPE.host_version
  };
}
function evaluateHostCutoverConformance(request) {
  const req = request ?? {};
  const runId = typeof req.run_id === "string" ? req.run_id : "";
  const evidenceIdentity = req.evidence_identity ?? {};
  const receiptRefs = req.receipt_refs ?? {};
  const evidenceFreshness = req.evidence_freshness ?? {};
  const baseScope = asScope(req.scope);
  const handle = openMigrationJournal(req.journal_root);
  if (typeof req.mode === "string") {
    const mode = req.mode;
    const operationId = typeof req.operation_id === "string" && req.operation_id.length > 0 ? req.operation_id : `${runId}:${mode}:${neutralCanonicalJson(baseScope)}`;
    let disposition = "succeeded";
    let reasonCode = null;
    let comparison = null;
    if (mode === "current") {
      const records = readMigrationJournal(handle);
      const priorEquivalentShadow = records.some(
        (record2) => record2.mode === "shadow" && record2.disposition === "succeeded" && record2.comparison !== null && record2.comparison.equivalent === true && sameScope(record2.scope, baseScope)
      );
      if (!priorEquivalentShadow) {
        disposition = "refused";
        reasonCode = "scenario_result_mismatch";
      }
    } else if (mode === "shadow" && req.legacy_outcome !== void 0 && req.candidate_outcome !== void 0) {
      comparison = compareMigrationOutcomes(req.legacy_outcome, req.candidate_outcome);
      if (!comparison.equivalent) {
        disposition = "refused";
        reasonCode = MH08_DIVERGENCE_REASON_CODE;
      }
    }
    const record = appendMigrationDecision(handle, {
      operation_id: operationId,
      mode,
      scope: baseScope,
      disposition,
      reason_code: reasonCode,
      comparison
    });
    return {
      outcome: { type: "guild.migration_outcome.v1", disposition: record.disposition, reason_code: record.reason_code },
      packet: null
    };
  }
  const results = MH08_SCENARIO_IDS.map((stableId) => {
    const verdict = runMh08Scenario(handle, runId, baseScope, stableId, req);
    return {
      stable_id: stableId,
      outcome_type: "guild.migration_outcome.v1",
      disposition: verdict.disposition,
      reason_code: verdict.reason_code,
      receipt_ref: receiptRefs[stableId],
      evidence_identity: { ...evidenceIdentity },
      evidence_freshness: evidenceFreshness[stableId]
    };
  });
  const packet = neutralFreeze({
    schema_version: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    owner_key: MH08_OWNER_KEY,
    evidence_identity: { ...evidenceIdentity },
    stable_ids: [...MH08_SCENARIO_IDS],
    results
  });
  const requiredSucceeded = ["MHRC-STR-001", "MHRC-STR-002", "MHRC-STR-003"].every(
    (stableId) => results.find((r) => r.stable_id === stableId)?.disposition === "succeeded"
  );
  const str004Result = results.find((r) => r.stable_id === "MHRC-STR-004");
  const str004ExpectedDivergence = str004Result?.disposition === "refused" && str004Result?.reason_code === MH08_DIVERGENCE_REASON_CODE;
  const topLevelSucceeded = requiredSucceeded && str004ExpectedDivergence;
  let topLevelReasonCode = null;
  if (!topLevelSucceeded) {
    const anyEvidenceIncomplete = results.some((r) => r.reason_code === MH08_EVIDENCE_INCOMPLETE_REASON_CODE);
    topLevelReasonCode = anyEvidenceIncomplete ? MH08_EVIDENCE_INCOMPLETE_REASON_CODE : MH08_RESULT_MISMATCH_REASON_CODE;
  }
  return {
    outcome: {
      type: "guild.migration_outcome.v1",
      disposition: topLevelSucceeded ? "succeeded" : "refused",
      reason_code: topLevelReasonCode
    },
    packet
  };
}
var crypto2, fs9, os, path10, MH08_OWNER_KEY, MH08_SCENARIO_IDS, MH08_DECISION_SCHEMA, MH08_DIVERGENCE_REASON_CODE, MH08_MODES, MH08_SCOPE_FIELDS, AUTHENTICATED_JOURNAL_HANDLES, MH08_PROVENANCE_ALLOWLIST, MH08_DEFAULT_SCOPE, MH08_COMPARISON_MAX_TEXT_LENGTH, MH08_COMPARISON_MAX_DEPTH, MH08_EVIDENCE_INCOMPLETE_REASON_CODE, MH08_RESULT_MISMATCH_REASON_CODE;
var init_host_cutover_controller = __esm({
  "../src/modules/migrations/workflows/host-cutover-controller.ts"() {
    crypto2 = __toESM(require("node:crypto"));
    fs9 = __toESM(require("node:fs"));
    os = __toESM(require("node:os"));
    path10 = __toESM(require("node:path"));
    init_lifecycle();
    MH08_OWNER_KEY = "W4/MH-08";
    MH08_SCENARIO_IDS = Object.freeze([
      "MHRC-STR-001",
      "MHRC-STR-002",
      "MHRC-STR-003",
      "MHRC-STR-004"
    ]);
    MH08_DECISION_SCHEMA = "guild.migration_decision.v1";
    MH08_DIVERGENCE_REASON_CODE = "migration_shadow_divergence";
    MH08_MODES = Object.freeze(["legacy", "shadow", "current", "rollback"]);
    MH08_SCOPE_FIELDS = Object.freeze(["host_id", "capability_id", "host_version"]);
    AUTHENTICATED_JOURNAL_HANDLES = /* @__PURE__ */ new WeakSet();
    MH08_PROVENANCE_ALLOWLIST = neutralFreeze([
      "binding.run_id",
      "binding.operation_id",
      "binding.correlation_id"
    ]);
    MH08_DEFAULT_SCOPE = neutralFreeze({
      host_id: "guild-runtime",
      capability_id: "cap.host-cutover",
      host_version: "0.0.0"
    });
    MH08_COMPARISON_MAX_TEXT_LENGTH = 262144;
    MH08_COMPARISON_MAX_DEPTH = 256;
    MH08_EVIDENCE_INCOMPLETE_REASON_CODE = "scenario_evidence_incomplete";
    MH08_RESULT_MISMATCH_REASON_CODE = "scenario_result_mismatch";
  }
});

// ../src/modules/migrations/index.ts
var init_migrations = __esm({
  "../src/modules/migrations/index.ts"() {
    init_index_migrate();
    init_wiki_importance();
    init_host_cutover_controller();
  }
});

// ../src/modules/state/workflows/index-cache.ts
var init_index_cache = __esm({
  "../src/modules/state/workflows/index-cache.ts"() {
    init_migrations();
    init_kernel();
  }
});

// ../src/modules/state/index.ts
var init_state = __esm({
  "../src/modules/state/index.ts"() {
    init_atomic_write();
    init_dependency_graph_reader();
    init_dependency_graph_schema();
    init_frontmatter();
    init_guild_discovery();
    init_guild_root();
    init_index_cache();
  }
});

// ../src/modules/security/workflows/config.ts
var init_config = __esm({
  "../src/modules/security/workflows/config.ts"() {
    init_state();
  }
});

// ../src/modules/security/workflows/events.ts
var KNOWN_GUILD_HOST_KINDS, KNOWN_GUILD_HOST_ID_SET;
var init_events = __esm({
  "../src/modules/security/workflows/events.ts"() {
    init_state();
    init_redact_log();
    KNOWN_GUILD_HOST_KINDS = Object.freeze([
      "claude-code-cli",
      "codex-cli",
      "pi-cli",
      "antigravity-cli",
      "agents-file",
      "claude-code-app",
      "claude-code-web",
      "codex-app",
      "claude-ai-connector"
    ]);
    KNOWN_GUILD_HOST_ID_SET = new Set(KNOWN_GUILD_HOST_KINDS);
  }
});

// ../src/modules/security/workflows/scrubbed-write.ts
var init_scrubbed_write = __esm({
  "../src/modules/security/workflows/scrubbed-write.ts"() {
    init_secrets();
    init_config();
    init_events();
  }
});

// ../src/modules/security/workflows/share-set.ts
var path11, SHARED_SCRUBBED_NAMES, CANONICAL_RUN_LOG;
var init_share_set = __esm({
  "../src/modules/security/workflows/share-set.ts"() {
    path11 = __toESM(require("path"));
    init_kernel();
    SHARED_SCRUBBED_NAMES = sealSet([
      "verify.md",
      "review.md",
      "provenance.json",
      "summary.md",
      "run.yaml",
      "run-state.json"
    ], "SHARED_SCRUBBED_NAMES");
    CANONICAL_RUN_LOG = path11.join("logs", "v1.4-events.jsonl");
  }
});

// ../src/modules/security/workflows/secret-patterns.ts
var SECRET_PATTERNS;
var init_secret_patterns = __esm({
  "../src/modules/security/workflows/secret-patterns.ts"() {
    SECRET_PATTERNS = Object.freeze([
      // NOTE: labels deliberately drop the `=` so the redaction replacement
      // (e.g. `<REDACTED:password-assignment>`) cannot itself re-match the pattern
      // on a subsequent scrub pass. Idempotency depends on this — every label below
      // is checked against every pattern above it, and none re-matches.
      Object.freeze([Object.freeze(/password\s*=\s*["']?[^\s"']{6,}/), "password-assignment"]),
      Object.freeze([Object.freeze(/api_key\s*=\s*["']?[^\s"']{6,}/i), "api_key-assignment"]),
      Object.freeze([Object.freeze(/secret\s*=\s*["']?[^\s"']{8,}/i), "secret-assignment"]),
      Object.freeze([Object.freeze(/AKIA[0-9A-Z]{16}/), "AWS access key"]),
      Object.freeze([Object.freeze(/AIza[0-9A-Za-z_-]{35}/), "GCP API key"]),
      Object.freeze([Object.freeze(/ghp_[0-9A-Za-z]{36}/), "GitHub personal access token"]),
      Object.freeze([Object.freeze(/ghs_[0-9A-Za-z]{36}/), "GitHub server token"]),
      Object.freeze([Object.freeze(/-----BEGIN (?:RSA |EC )?PRIVATE KEY/), "PEM private key block"]),
      // ── Provider credential / bearer-token forms (T6B-R1-B1) ─────────────────
      // Round-1 review proved the list above blind to the shapes an inspection
      // surface is most likely to echo out of a persisted artifact: an
      // `Authorization: Bearer …` header, a `sk-…` provider key, and the
      // `<something>_token = …` assignment family. A display surface that renders
      // a persisted evidence string verbatim leaked all three past the applier.
      //
      // Every pattern is anchored on the CREDENTIAL PREFIX (not on entropy) so it
      // stays specific, and each replacement label is inert against every pattern
      // in this list (no whitespace/`:`/`=` follows the trigger word in a label),
      // which is what keeps `redact` idempotent.
      Object.freeze([Object.freeze(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i), "bearer-token"]),
      Object.freeze([Object.freeze(/\bauthorization\s*:\s*["']?[A-Za-z0-9._~+/=-]{12,}/i), "authorization-header"]),
      Object.freeze([Object.freeze(/\b(?:auth|access|refresh|id|api|bearer|session)[-_]?token\s*[:=]\s*["']?[^\s"',]{8,}/i), "token-assignment"]),
      // OpenAI/Anthropic-style provider keys: sk-…, sk-proj-…, sk-ant-….
      Object.freeze([Object.freeze(/\bsk-[A-Za-z0-9_-]{12,}/), "provider-api-key"]),
      Object.freeze([Object.freeze(/\bxox[abprs]-[A-Za-z0-9-]{10,}/), "Slack token"]),
      Object.freeze([Object.freeze(/\bgh[uor]_[0-9A-Za-z]{36}/), "GitHub token"]),
      Object.freeze([Object.freeze(/\bglpat-[0-9A-Za-z_-]{20}/), "GitLab personal access token"]),
      Object.freeze([Object.freeze(/\bnpm_[0-9A-Za-z]{36}/), "npm token"]),
      Object.freeze([Object.freeze(/\bhf_[0-9A-Za-z]{34}/), "HuggingFace token"]),
      // ── Personally identifying forms retained by public evidence projections ─
      // Task objectives and handoff prose are operator-authored and can contain
      // direct contact details or tenant identifiers. Those artifacts are copied
      // into migration evidence, so the share scrubber must recognize them before
      // publication. Keep the patterns prefix-shaped and their labels inert so the
      // redaction remains deterministic and idempotent.
      Object.freeze([Object.freeze(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i), "email-address"]),
      Object.freeze([Object.freeze(/\b(?:acct|cus|cust|usr)_[A-Za-z0-9][A-Za-z0-9_-]{4,}\b/i), "customer-identifier"]),
      Object.freeze([Object.freeze(/\b(?:customer|account|user)[_-]?id\s*[:=]\s*["']?[A-Za-z0-9][A-Za-z0-9._-]{3,}/i), "customer-identifier"]),
      // High-entropy string heuristic: 40+ hex chars (SHA-like)
      Object.freeze([Object.freeze(/\b[0-9a-f]{40,}\b/), "high-entropy hex string (potential secret)"])
    ]);
  }
});

// ../src/modules/security/workflows/scrub-redact.ts
var init_scrub_redact = __esm({
  "../src/modules/security/workflows/scrub-redact.ts"() {
    init_secret_patterns();
    init_state();
  }
});

// ../src/modules/security/index.ts
var init_security = __esm({
  "../src/modules/security/index.ts"() {
    init_safe_object();
    init_injection_guard();
    init_scrubbed_write();
    init_redact_log();
    init_share_set();
    init_scrub_redact();
    init_secret_patterns();
  }
});

// ../src/modules/lifecycle/workflows/stable-lock.ts
function stableLockPath(runDir3) {
  return (0, import_node_path.join)(runDir3, "logs", ".lock");
}
function exclusionSentinelPath(runDir3) {
  return (0, import_node_path.join)(runDir3, "logs", ".lock.exclusion");
}
function initStableLockfile(runDir3) {
  const path26 = stableLockPath(runDir3);
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path26), { recursive: true });
  if ((0, import_node_fs.existsSync)(path26)) return;
  try {
    const fd = (0, import_node_fs.openSync)(path26, "wx");
    (0, import_node_fs.closeSync)(fd);
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
  }
}
function sleepSyncMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
  }
}
function withStableLock(runDir3, fn, opts = {}) {
  initStableLockfile(runDir3);
  const sentinel = exclusionSentinelPath(runDir3);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const start = Date.now();
  let attempt = 0;
  for (; ; ) {
    try {
      const fd = (0, import_node_fs.openSync)(sentinel, "wx");
      try {
        (0, import_node_fs.writeSync)(fd, `${process.pid}
`);
      } catch {
      }
      (0, import_node_fs.closeSync)(fd);
      try {
        return fn();
      } finally {
        try {
          (0, import_node_fs.unlinkSync)(sentinel);
        } catch {
        }
      }
    } catch (err) {
      const code = err?.code;
      if (code !== "EEXIST") throw err;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `v1.4-lock: timed out waiting for ${sentinel} (${timeoutMs}ms). Stale lock? Remove the file if you are sure no other process holds it.`
        );
      }
      const idx = Math.min(attempt, backoff.length - 1);
      sleepSyncMs(backoff[idx]);
      attempt += 1;
    }
  }
}
var import_node_fs, import_node_path, DEFAULT_BACKOFF_MS, DEFAULT_TIMEOUT_MS;
var init_stable_lock = __esm({
  "../src/modules/lifecycle/workflows/stable-lock.ts"() {
    import_node_fs = require("node:fs");
    import_node_path = require("node:path");
    DEFAULT_BACKOFF_MS = [2, 5, 10, 25, 50, 100, 200];
    DEFAULT_TIMEOUT_MS = 5e3;
  }
});

// ../src/modules/lifecycle/workflows/trace-v2.ts
function pruneUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== void 0) out[k] = v;
  }
  return out;
}
var SIDECAR_MAX_BYTES;
var init_trace_v2 = __esm({
  "../src/modules/lifecycle/workflows/trace-v2.ts"() {
    SIDECAR_MAX_BYTES = 16 * 1024;
  }
});

// ../src/modules/lifecycle/workflows/event-log-writer.ts
function liveLogPath(runDir3) {
  return (0, import_node_path2.join)(runDir3, "logs", "v1.4-events.jsonl");
}
function archiveDir(runDir3) {
  return (0, import_node_path2.join)(runDir3, "logs", "archive");
}
function archivePath(runDir3, n) {
  return (0, import_node_path2.join)(archiveDir(runDir3), `v1.4-events.${n}.jsonl.gz`);
}
function laneFallbackPath(runDir3, laneId2) {
  if (!isSafeLaneId(laneId2)) {
    throw new Error(`log-jsonl: invalid lane_id ${JSON.stringify(laneId2)}`);
  }
  return (0, import_node_path2.join)(runDir3, "logs", `lane-${laneId2}-events.jsonl`);
}
function appendEvent(runDir3, event, opts = {}) {
  validateEventIds(event);
  const cap = opts.fieldCap;
  const redacted = redactEventFields(event, cap);
  const withV2 = opts.traceV2 !== void 0 ? { ...redacted, ...pruneUndefined(opts.traceV2) } : redacted;
  const line = JSON.stringify(withV2) + "\n";
  if (opts.forceFallback || process.platform === "win32") {
    const laneId2 = opts.laneId ?? "global";
    const path26 = laneFallbackPath(runDir3, laneId2);
    (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(path26), { recursive: true });
    const fd = (0, import_node_fs2.openSync)(path26, "a");
    try {
      (0, import_node_fs2.writeSync)(fd, line);
    } finally {
      (0, import_node_fs2.closeSync)(fd);
    }
    return;
  }
  const live = liveLogPath(runDir3);
  (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(live), { recursive: true });
  withStableLock(runDir3, () => {
    const fd = (0, import_node_fs2.openSync)(live, "a");
    try {
      (0, import_node_fs2.writeSync)(fd, line);
    } finally {
      (0, import_node_fs2.closeSync)(fd);
    }
    maybeRotateLocked(runDir3, opts.rotationThresholdBytes ?? ROTATION_THRESHOLD_BYTES);
  });
}
function nextRotationIndex(runDir3) {
  const dir = archiveDir(runDir3);
  if (!(0, import_node_fs2.existsSync)(dir)) return 1;
  let max = 0;
  for (const entry of (0, import_node_fs2.readdirSync)(dir)) {
    const m = /^v1\.4-events\.(\d+)\.jsonl\.gz$/.exec(entry);
    if (m && m[1] !== void 0) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max + 1;
}
function maybeRotateLocked(runDir3, thresholdBytes) {
  const live = liveLogPath(runDir3);
  if (!(0, import_node_fs2.existsSync)(live)) return;
  const size = (0, import_node_fs2.statSync)(live).size;
  if (size < thresholdBytes) return;
  rotateLocked(runDir3);
}
function rotateLocked(runDir3) {
  const live = liveLogPath(runDir3);
  const archive = archiveDir(runDir3);
  (0, import_node_fs2.mkdirSync)(archive, { recursive: true });
  const n = nextRotationIndex(runDir3);
  const stagingPath = (0, import_node_path2.join)(archive, `v1.4-events.${n}.jsonl`);
  const finalArchive = archivePath(runDir3, n);
  (0, import_node_fs2.renameSync)(live, stagingPath);
  const raw = (0, import_node_fs2.readFileSync)(stagingPath);
  const gzipped = (0, import_node_zlib.gzipSync)(raw);
  (0, import_node_fs2.writeFileSync)(finalArchive, gzipped);
  (0, import_node_fs2.unlinkSync)(stagingPath);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fd = (0, import_node_fs2.openSync)(live, "wx");
      (0, import_node_fs2.closeSync)(fd);
      return;
    } catch (err) {
      const code = err?.code;
      if (code !== "EEXIST") throw err;
      try {
        (0, import_node_fs2.unlinkSync)(live);
      } catch {
      }
    }
  }
  throw new Error(
    `log-jsonl: failed to recreate live log at ${live} with O_EXCL after 5 retries`
  );
}
var import_node_fs2, import_node_path2, import_node_zlib, ROTATION_THRESHOLD_BYTES;
var init_event_log_writer = __esm({
  "../src/modules/lifecycle/workflows/event-log-writer.ts"() {
    import_node_fs2 = require("node:fs");
    import_node_path2 = require("node:path");
    import_node_zlib = require("node:zlib");
    init_security();
    init_stable_lock();
    init_trace_v2();
    init_event_log_schema();
    ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;
  }
});

// ../src/modules/lifecycle/workflows/event-log-sidecar.ts
var SIDECAR_MAX_BYTES2;
var init_event_log_sidecar = __esm({
  "../src/modules/lifecycle/workflows/event-log-sidecar.ts"() {
    init_security();
    init_stable_lock();
    init_event_log_schema();
    init_event_log_writer();
    SIDECAR_MAX_BYTES2 = 1024 * 1024;
  }
});

// ../src/modules/lifecycle/workflows/event-log.ts
var init_event_log = __esm({
  "../src/modules/lifecycle/workflows/event-log.ts"() {
    init_event_log_schema();
    init_event_log_writer();
    init_event_log_sidecar();
  }
});

// ../src/modules/lifecycle/workflows/emit-loop-event.ts
function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--event" && argv[i + 1]) result.event = argv[++i];
    else if (arg === "--layer" && argv[i + 1]) result.layer = argv[++i];
    else if (arg === "--lane" && argv[i + 1]) result.lane = argv[++i];
    else if (arg === "--round" && argv[i + 1]) result.round = parseInt(argv[++i], 10);
    else if (arg === "--cap" && argv[i + 1]) result.cap = parseInt(argv[++i], 10);
    else if (arg === "--gate" && argv[i + 1]) result.gate = argv[++i];
    else if (arg === "--terminated" && argv[i + 1]) result.terminated = argv[++i];
    else if (arg === "--terminator" && argv[i + 1]) result.terminator = argv[++i];
    else if (arg === "--run-id" && argv[i + 1]) result.runId = argv[++i];
    else if (arg === "--cwd" && argv[i + 1]) result.cwd = argv[++i];
  }
  return result;
}
function readSentinel(cwd) {
  const sentinelPath = path12.join(cwd, ".guild", "runs", "current-run-id");
  try {
    const value = fs10.readFileSync(sentinelPath, "utf8").trim();
    return value.length > 0 ? value : void 0;
  } catch {
    return void 0;
  }
}
function runEmitLoopEventCli() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = resolveGuildRoot2(args.cwd ?? process.env["GUILD_CWD"] ?? process.cwd());
  if (!args.event || !VALID_EVENTS.has(args.event)) {
    process.stderr.write(
      `[emit-loop-event] ERROR: --event must be one of: ${[...VALID_EVENTS].join(", ")}
`
    );
    process.exit(0);
  }
  const envRunId = process.env["GUILD_RUN_ID"];
  const runId = args.runId ?? (typeof envRunId === "string" && envRunId.length > 0 ? envRunId : void 0) ?? readSentinel(cwd) ?? `run-session-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`;
  if (!isSafeRunId(runId)) {
    process.stderr.write("[emit-loop-event] ERROR: resolved run id is invalid\n");
    process.exit(0);
  }
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  let event;
  if (args.event === "loop_round_start" || args.event === "loop_round_end") {
    if (!args.layer || !VALID_LAYERS.has(args.layer)) {
      process.stderr.write("[emit-loop-event] ERROR: --layer is required for loop round events\n");
      process.exit(0);
    }
    if (!args.lane || !isSafeLaneId(args.lane)) {
      process.stderr.write("[emit-loop-event] ERROR: --lane is required and must be safe\n");
      process.exit(0);
    }
    if (typeof args.round !== "number" || !Number.isInteger(args.round) || args.round < 1) {
      process.stderr.write("[emit-loop-event] ERROR: --round must be a positive integer\n");
      process.exit(0);
    }
    if (args.event === "loop_round_start") {
      if (typeof args.cap !== "number" || !Number.isInteger(args.cap) || args.cap < 1) {
        process.stderr.write(
          "[emit-loop-event] ERROR: --cap must be a positive integer for loop_round_start\n"
        );
        process.exit(0);
      }
      event = {
        ts,
        event: "loop_round_start",
        run_id: runId,
        lane_id: args.lane,
        loop_layer: args.layer,
        round_number: args.round,
        cap: args.cap
      };
    } else {
      if (!args.terminated || !VALID_TERMINATED.has(args.terminated)) {
        process.stderr.write(
          `[emit-loop-event] ERROR: --terminated must be one of: ${[...VALID_TERMINATED].join(", ")}
`
        );
        process.exit(0);
      }
      event = {
        ts,
        event: "loop_round_end",
        run_id: runId,
        lane_id: args.lane,
        loop_layer: args.layer,
        round_number: args.round,
        terminated: args.terminated,
        terminator: args.terminator ?? ""
      };
    }
  } else {
    if (!args.gate) {
      process.stderr.write("[emit-loop-event] ERROR: --gate is required for codex_review_round\n");
      process.exit(0);
    }
    if (typeof args.round !== "number" || !Number.isInteger(args.round) || args.round < 1) {
      process.stderr.write("[emit-loop-event] ERROR: --round must be a positive integer\n");
      process.exit(0);
    }
    event = {
      ts,
      event: "codex_review_round",
      run_id: runId,
      gate: args.gate,
      round_number: args.round,
      terminated_by_satisfied: args.terminated === "satisfied" || args.terminated === "true"
    };
  }
  try {
    appendEvent(path12.join(cwd, ".guild", "runs", runId), event);
  } catch (err) {
    process.stderr.write(
      `[emit-loop-event] ERROR: could not write event: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
var fs10, path12, VALID_EVENTS, VALID_LAYERS, VALID_TERMINATED;
var init_emit_loop_event = __esm({
  "../src/modules/lifecycle/workflows/emit-loop-event.ts"() {
    fs10 = __toESM(require("fs"));
    path12 = __toESM(require("path"));
    init_event_log();
    init_state();
    VALID_EVENTS = /* @__PURE__ */ new Set(["loop_round_start", "loop_round_end", "codex_review_round"]);
    VALID_LAYERS = /* @__PURE__ */ new Set(["L1", "L2", "L3", "L4", "security-review"]);
    VALID_TERMINATED = /* @__PURE__ */ new Set([
      "satisfied",
      "malformed_termination",
      "cap_hit",
      "escalation",
      "error"
    ]);
    if (require.main === module && new RegExp("[\\\\/]emit-loop-event\\.[cm]?[jt]s$").test(process.argv[1] ?? "")) {
      runEmitLoopEventCli();
    }
  }
});

// ../src/modules/lifecycle/workflows/run-state.ts
function runStatePath(runDir3) {
  return path13.join(runDir3, "run-state.json");
}
function loadRunState(runDir3) {
  let raw;
  try {
    raw = fs11.readFileSync(runStatePath(runDir3), "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || parsed["schema_version"] !== RUN_STATE_SCHEMA_VERSION) {
    return null;
  }
  return parsed;
}
function writeRunStateAtomic(runDir3, state) {
  fs11.mkdirSync(runDir3, { recursive: true });
  const finalPath = runStatePath(runDir3);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs11.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  try {
    fs11.renameSync(tmpPath, finalPath);
  } catch (err) {
    try {
      fs11.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
function newCheckpoint(init2, now) {
  return {
    schema_version: RUN_STATE_SCHEMA_VERSION,
    run_id: init2.runId,
    plan_slug: init2.planSlug ?? init2.runId,
    program_id: init2.programId ?? null,
    wave_index: init2.waveIndex ?? 0,
    lanes: {},
    last_checkpoint_at: now
  };
}
function upsertLane(runDir, init, laneId, patch) {
  if (patch.host?.independence === "strong") {
    const capability = eval("require")("../../capability");
    capability.assertPersistableIndependence(
      runDir,
      patch.host?.independence,
      `run-state lane "${laneId}"`,
      {
        lane_id: laneId,
        producer_ref: patch.host?.independence_ref?.producer_ref,
        reviewer_ref: patch.host?.independence_ref?.reviewer_ref
      }
    );
  }
  return withStableLock(runDir, () => {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const state = loadRunState(runDir) ?? newCheckpoint(init, now);
    const prev = state.lanes[laneId];
    const merged = {
      status: patch.status ?? prev?.status ?? "pending",
      attempt: patch.attempt ?? prev?.attempt ?? 1,
      depends_on: patch.depends_on ?? prev?.depends_on ?? [],
      receipt_ref: patch.receipt_ref !== void 0 ? patch.receipt_ref : prev?.receipt_ref ?? null,
      updated_at: now
    };
    const tier = patch.tier ?? prev?.tier;
    if (tier !== void 0) merged.tier = tier;
    const host = patch.host ?? prev?.host;
    if (host !== void 0) merged.host = host;
    state.lanes[laneId] = merged;
    state.last_checkpoint_at = now;
    writeRunStateAtomic(runDir, state);
    return state;
  });
}
function markLaneInProgress(runDir3, init2, laneId2, opts = {}) {
  return upsertLane(runDir3, init2, laneId2, {
    status: "in_progress",
    tier: opts.tier,
    attempt: opts.attempt,
    depends_on: opts.depends_on
  });
}
function laneResumeCheckpointPath(runDir3, laneId2) {
  return path13.join(runDir3, "lanes", laneId2, "resume.json");
}
function readResumeEnabled(cwd) {
  const settingsPath = path13.join(resolveGuildRoot2(cwd), ".guild", "settings.json");
  try {
    const raw = fs11.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    const defs = parsed["defaults"];
    if (typeof defs === "object" && defs !== null && !Array.isArray(defs)) {
      const resume = defs["resume"];
      if (typeof resume === "object" && resume !== null && !Array.isArray(resume)) {
        const enabled = resume["enabled"];
        if (typeof enabled === "boolean") return enabled;
      }
    }
  } catch {
  }
  return true;
}
function loadLaneResumeCheckpoint(runDir3, laneId2) {
  try {
    const raw = fs11.readFileSync(laneResumeCheckpointPath(runDir3, laneId2), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.schema_version !== LANE_RESUME_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}
function markLaneDead(runDir3, init2, laneId2, signal, cwd) {
  const state = upsertLane(runDir3, init2, laneId2, {
    status: "dead",
    attempt: signal.attempts
  });
  if (readResumeEnabled(cwd)) {
    const checkpoint = {
      schema_version: LANE_RESUME_SCHEMA_VERSION,
      lane_id: laneId2,
      run_id: init2.runId,
      attempts: signal.attempts,
      last_attempt_at: signal.lastAttemptAt,
      resumable_at: (/* @__PURE__ */ new Date()).toISOString(),
      ...typeof signal.lastError === "string" ? { last_error: signal.lastError } : {}
    };
    const checkpointPath = laneResumeCheckpointPath(runDir3, laneId2);
    fs11.mkdirSync(path13.dirname(checkpointPath), { recursive: true });
    fs11.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2) + "\n", "utf8");
  }
  return state;
}
var fs11, path13, RUN_STATE_SCHEMA_VERSION, LANE_RESUME_SCHEMA_VERSION;
var init_run_state = __esm({
  "../src/modules/lifecycle/workflows/run-state.ts"() {
    fs11 = __toESM(require("node:fs"));
    path13 = __toESM(require("node:path"));
    init_stable_lock();
    init_state();
    RUN_STATE_SCHEMA_VERSION = "guild.run_state.v1";
    LANE_RESUME_SCHEMA_VERSION = "guild.lane_resume.v1";
  }
});

// ../src/modules/lifecycle/workflows/mark-lane-dead.ts
function parseMarkLaneDeadArgs(argv) {
  const positionals = [];
  let attempts;
  let lastError;
  let runId;
  let planSlug;
  let programId;
  let waveIndex;
  let cwd;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--attempts" && argv[i + 1] !== void 0) {
      attempts = Number(argv[++i]);
    } else if (arg.startsWith("--attempts=")) {
      attempts = Number(arg.slice("--attempts=".length));
    } else if (arg === "--last-error" && argv[i + 1] !== void 0) {
      lastError = argv[++i];
    } else if (arg.startsWith("--last-error=")) {
      lastError = arg.slice("--last-error=".length);
    } else if (arg === "--run-id" && argv[i + 1] !== void 0) {
      runId = argv[++i];
    } else if (arg.startsWith("--run-id=")) {
      runId = arg.slice("--run-id=".length);
    } else if (arg === "--plan-slug" && argv[i + 1] !== void 0) {
      planSlug = argv[++i];
    } else if (arg.startsWith("--plan-slug=")) {
      planSlug = arg.slice("--plan-slug=".length);
    } else if (arg === "--program-id" && argv[i + 1] !== void 0) {
      programId = argv[++i];
    } else if (arg.startsWith("--program-id=")) {
      programId = arg.slice("--program-id=".length);
    } else if (arg === "--wave-index" && argv[i + 1] !== void 0) {
      waveIndex = Number(argv[++i]);
    } else if (arg.startsWith("--wave-index=")) {
      waveIndex = Number(arg.slice("--wave-index=".length));
    } else if (arg === "--cwd" && argv[i + 1] !== void 0) {
      cwd = argv[++i];
    } else if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length);
    } else if (!arg.startsWith("--")) {
      positionals.push(arg);
    }
  }
  const [runDir3, laneId2] = positionals;
  if (!runDir3 || !laneId2) {
    return {
      error: "usage: mark-lane-dead.ts <runDir> <laneId> --attempts <n> [--last-error <s>] [--run-id <s>] [--plan-slug <s>] [--program-id <s>] [--wave-index <n>] [--cwd <p>]"
    };
  }
  if (attempts === void 0 || !Number.isFinite(attempts) || attempts < 1) {
    return { error: `--attempts <n> is required and must be an integer \u2265 1 (got ${argv.join(" ")})` };
  }
  return {
    runDir: runDir3,
    laneId: laneId2,
    attempts: Math.floor(attempts),
    lastError,
    runId,
    planSlug,
    programId,
    waveIndex: waveIndex !== void 0 && Number.isFinite(waveIndex) ? Math.floor(waveIndex) : void 0,
    cwd
  };
}
function repoRootFromRunDir(runDir3) {
  return path14.resolve(runDir3, "..", "..", "..");
}
function markLaneDeadFromArgs(args) {
  const cwd = args.cwd ?? repoRootFromRunDir(args.runDir);
  const runId = args.runId ?? path14.basename(args.runDir);
  const init2 = {
    runId,
    planSlug: args.planSlug,
    programId: args.programId ?? null,
    waveIndex: args.waveIndex
  };
  const signal = {
    attempts: args.attempts,
    lastAttemptAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastError: args.lastError
  };
  try {
    markLaneDead(args.runDir, init2, args.laneId, signal, cwd);
    return 0;
  } catch (e) {
    process.stderr.write(`[mark-lane-dead] ERROR: ${e.message}
`);
    return 1;
  }
}
function runMarkLaneDeadCli() {
  const parsed = parseMarkLaneDeadArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`[mark-lane-dead] ${parsed.error}
`);
    process.exit(1);
  }
  const code = markLaneDeadFromArgs(parsed);
  if (code === 0) {
    process.stdout.write(
      `[mark-lane-dead] lane "${parsed.laneId}" marked dead (attempts=${parsed.attempts}) in ${parsed.runDir}
`
    );
  }
  process.exit(code);
}
var path14;
var init_mark_lane_dead = __esm({
  "../src/modules/lifecycle/workflows/mark-lane-dead.ts"() {
    path14 = __toESM(require("path"));
    init_run_state();
    if (require.main === module && new RegExp("[\\\\/]mark-lane-dead\\.[cm]?[jt]s$").test(process.argv[1] ?? "")) {
      runMarkLaneDeadCli();
    }
  }
});

// ../src/modules/teams/workflows/team-file.ts
function readPlanOwnerTaskIds(guildRoot, slug) {
  const map = /* @__PURE__ */ new Map();
  let raw;
  try {
    raw = fs12.readFileSync(path15.join(guildRoot, ".guild", "plan", `${slug}.md`), "utf8");
  } catch {
    return map;
  }
  const lines = raw.split("\n");
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (/^\s*##\s+Lane:/.test(line)) {
      current = [];
      blocks.push(current);
      continue;
    }
    if (current) current.push(line);
  }
  for (const block of blocks) {
    let taskId = null;
    let owner = null;
    for (const line of block) {
      if (taskId === null) {
        const m = line.match(/^\s*-\s*task-id:\s*(\S+)/);
        if (m) {
          taskId = m[1];
          continue;
        }
      }
      if (owner === null) {
        const m = line.match(/^\s*-\s*owner:\s*(\S+)/);
        if (m) {
          owner = m[1];
          continue;
        }
      }
      if (taskId !== null && owner !== null) break;
    }
    if (taskId && owner) {
      const arr = map.get(owner) ?? [];
      arr.push(taskId);
      map.set(owner, arr);
    }
  }
  return map;
}
function readPlanTaskIdSet(guildRoot, slug) {
  const ids = /* @__PURE__ */ new Set();
  for (const taskIds of readPlanOwnerTaskIds(guildRoot, slug).values()) {
    for (const id of taskIds) ids.add(id);
  }
  return ids;
}
var fs12, path15;
var init_team_file = __esm({
  "../src/modules/teams/workflows/team-file.ts"() {
    fs12 = __toESM(require("fs"));
    path15 = __toESM(require("path"));
    init_lifecycle();
    init_state();
  }
});

// ../src/modules/teams/workflows/canonical-hash.ts
var init_canonical_hash = __esm({
  "../src/modules/teams/workflows/canonical-hash.ts"() {
  }
});

// ../src/modules/teams/workflows/station-composer.ts
var STATIONS, STATION_SET, DISCIPLINE_SIGNALS, FANOUT_RANK, DOC, IMPLIED_RULES, DEFAULTS_ANCHOR, EMPTY_ADVISORY_PANEL, QA_ADVISORY_PANEL, OPS_ADVISORY_PANEL, STATION_POLICY, IMPLIED_RULE_IDS;
var init_station_composer = __esm({
  "../src/modules/teams/workflows/station-composer.ts"() {
    init_kernel();
    STATIONS = Object.freeze([
      "init",
      "ideate",
      "plan",
      "build",
      "qa",
      "ops",
      "research",
      "definition",
      "learn"
    ]);
    STATION_SET = new Set(STATIONS);
    DISCIPLINE_SIGNALS = Object.freeze([
      "multi_component",
      "auth_touched",
      "backend_present",
      "user_facing_ui",
      "public_docs",
      "search_discoverability"
    ]);
    FANOUT_RANK = Object.freeze({
      lead_only: 0,
      lead_plus_one: 1,
      lead_plus_many: 2
    });
    DOC = ".guild/wiki/entities/team-composition.md";
    IMPLIED_RULES = deepFreeze([
      {
        id: "multi_component",
        signal: "multi_component",
        adds: Object.freeze(["architect"]),
        reason: "Component boundaries and dependencies need ownership.",
        doc_ref: `${DOC}#implied-specialist-rules`
      },
      {
        id: "auth_touched",
        signal: "auth_touched",
        adds: Object.freeze(["security"]),
        reason: "Threats and trust boundaries must be explicit.",
        doc_ref: `${DOC}#implied-specialist-rules`
      },
      {
        id: "backend_present",
        signal: "backend_present",
        adds: Object.freeze(["qa"]),
        reason: "Server-side work needs integration and regression evidence.",
        doc_ref: `${DOC}#implied-specialist-rules`
      },
      {
        id: "user_facing_ui",
        signal: "user_facing_ui",
        // Doc: "frontend and often qa" — both are added; qa dedupes against the
        // backend_present rule when both fire.
        adds: Object.freeze(["frontend", "qa"]),
        reason: "Accessibility, responsive behavior, and interaction state need coverage.",
        doc_ref: `${DOC}#implied-specialist-rules`
      },
      {
        id: "public_docs",
        signal: "public_docs",
        adds: Object.freeze(["technical-writer"]),
        reason: "Durable docs need task-focused structure and maintenance boundaries.",
        doc_ref: `${DOC}#implied-specialist-rules`
      },
      {
        id: "search_discoverability",
        signal: "search_discoverability",
        adds: Object.freeze(["seo"]),
        reason: "SEO owns metadata, crawlability, and keyword strategy.",
        doc_ref: `${DOC}#implied-specialist-rules`
      }
    ]);
    DEFAULTS_ANCHOR = `${DOC}#phase-team-defaults`;
    EMPTY_ADVISORY_PANEL = Object.freeze({
      producer: null,
      challengers: Object.freeze([])
    });
    QA_ADVISORY_PANEL = Object.freeze({
      producer: "qa-test-strategy",
      challengers: Object.freeze([
        Object.freeze({ role: "security" }),
        Object.freeze({ role: "architect", signal: "multi_component" })
      ])
    });
    OPS_ADVISORY_PANEL = Object.freeze({
      producer: null,
      challengers: Object.freeze([
        Object.freeze({ role: "security" }),
        Object.freeze({ role: "architect", signal: "multi_component" })
      ])
    });
    STATION_POLICY = deepFreeze({
      init: {
        station: "init",
        default_roster: Object.freeze(["researcher", "technical-writer"]),
        // Doc: "optional architect" — only when component boundaries are in play.
        conditional_roster: Object.freeze({ architect: "multi_component" }),
        plan_driven_slots: Object.freeze([]),
        advisory_memory: true,
        advisory_panel: EMPTY_ADVISORY_PANEL,
        default_fanout: "lead_only",
        extends_doc: false,
        doc_ref: DEFAULTS_ANCHOR
      },
      ideate: {
        station: "ideate",
        default_roster: Object.freeze(["architect", "researcher"]),
        conditional_roster: Object.freeze({}),
        // Doc: "optional product/content/domain specialists" — no signal encodes these
        // concrete roles; the plan/spec supplies them (G6b).
        plan_driven_slots: Object.freeze(["product", "content", "domain"]),
        advisory_memory: true,
        advisory_panel: EMPTY_ADVISORY_PANEL,
        default_fanout: "lead_only",
        extends_doc: false,
        doc_ref: DEFAULTS_ANCHOR
      },
      plan: {
        station: "plan",
        default_roster: Object.freeze(["architect", "technical-writer", "qa"]),
        // Doc: "security when needed" → gated on auth/secrets signal.
        conditional_roster: Object.freeze({ security: "auth_touched" }),
        plan_driven_slots: Object.freeze([]),
        advisory_memory: true,
        advisory_panel: EMPTY_ADVISORY_PANEL,
        default_fanout: "lead_only",
        extends_doc: false,
        doc_ref: DEFAULTS_ANCHOR
      },
      build: {
        station: "build",
        // Doc: "task owners selected by plan, qa, security, architect/tech lead when
        // boundaries change". Always-present reviewers are the default; architect is
        // boundary-change (multi_component) gated; task-owner implementers are plan-driven.
        default_roster: Object.freeze(["qa", "security"]),
        conditional_roster: Object.freeze({ architect: "multi_component" }),
        plan_driven_slots: Object.freeze(["task-owner-implementers"]),
        advisory_memory: true,
        advisory_panel: EMPTY_ADVISORY_PANEL,
        default_fanout: "lead_only",
        extends_doc: false,
        doc_ref: DEFAULTS_ANCHOR
      },
      qa: {
        station: "qa",
        default_roster: Object.freeze(["qa"]),
        // Doc: "devops, security when needed" — security gated on auth_touched; devops
        // "when needed" has no signal (release/deploy context) → plan-driven. Doc also
        // names "relevant implementers" → plan-driven.
        conditional_roster: Object.freeze({ security: "auth_touched" }),
        plan_driven_slots: Object.freeze(["devops", "relevant-implementers"]),
        advisory_memory: true,
        advisory_panel: QA_ADVISORY_PANEL,
        default_fanout: "lead_only",
        extends_doc: false,
        doc_ref: DEFAULTS_ANCHOR
      },
      ops: {
        station: "ops",
        default_roster: Object.freeze(["devops", "security", "qa"]),
        conditional_roster: Object.freeze({}),
        // Doc: "relevant implementers" → plan-driven.
        plan_driven_slots: Object.freeze(["relevant-implementers"]),
        advisory_memory: true,
        advisory_panel: OPS_ADVISORY_PANEL,
        default_fanout: "lead_only",
        extends_doc: false,
        doc_ref: DEFAULTS_ANCHOR
      },
      // ── Extended stations (doc §Phase Team Defaults omits these) ──
      research: {
        station: "research",
        default_roster: Object.freeze(["researcher"]),
        conditional_roster: Object.freeze({ architect: "multi_component" }),
        plan_driven_slots: Object.freeze([]),
        advisory_memory: true,
        advisory_panel: EMPTY_ADVISORY_PANEL,
        default_fanout: "lead_only",
        extends_doc: true,
        note: "EXTENDS doc: research station (product-explore / researcher deliverables); doc \xA7Phase Team Defaults omits it \u2014 reconcile in G6b.",
        doc_ref: DEFAULTS_ANCHOR
      },
      definition: {
        station: "definition",
        default_roster: Object.freeze(["architect", "technical-writer"]),
        conditional_roster: Object.freeze({ qa: "backend_present" }),
        plan_driven_slots: Object.freeze([]),
        advisory_memory: true,
        advisory_panel: EMPTY_ADVISORY_PANEL,
        default_fanout: "lead_only",
        extends_doc: true,
        note: "EXTENDS doc: definition station (product-define / PRD nucleus); mirrors Planning minus security-by-default \u2014 reconcile in G6b.",
        doc_ref: DEFAULTS_ANCHOR
      },
      learn: {
        station: "learn",
        default_roster: Object.freeze(["researcher"]),
        conditional_roster: Object.freeze({ architect: "multi_component", "technical-writer": "public_docs" }),
        plan_driven_slots: Object.freeze([]),
        advisory_memory: true,
        advisory_panel: EMPTY_ADVISORY_PANEL,
        default_fanout: "lead_only",
        extends_doc: true,
        note: "EXTENDS doc: learn station (learn-* knowledge pipeline; analysis reuses researcher/architect per team-composition.md \xA7No new analysis specialist); doc \xA7Phase Team Defaults omits it \u2014 reconcile in G6b.",
        doc_ref: DEFAULTS_ANCHOR
      }
    });
    IMPLIED_RULE_IDS = new Set(IMPLIED_RULES.map((r) => r.id));
  }
});

// ../src/modules/distribution/workflows/inventory-schema.ts
var INVENTORY_CATEGORIES, ALLOWED_INVENTORY_KEYS;
var init_inventory_schema = __esm({
  "../src/modules/distribution/workflows/inventory-schema.ts"() {
    init_kernel();
    INVENTORY_CATEGORIES = Object.freeze([
      "commands",
      "skills",
      "agents",
      "hooks",
      "mcp_servers",
      "scripts",
      "schemas",
      "docs"
    ]);
    ALLOWED_INVENTORY_KEYS = sealSet([
      "schema_version",
      "generated_at",
      "plugin_version",
      "manifest",
      ...INVENTORY_CATEGORIES
    ], "ALLOWED_INVENTORY_KEYS");
  }
});

// ../src/modules/distribution/workflows/parity-contract.ts
var DISCOVERY_RULES, COVERAGE_ENFORCED_CATEGORIES;
var init_parity_contract = __esm({
  "../src/modules/distribution/workflows/parity-contract.ts"() {
    init_kernel();
    init_inventory_schema();
    DISCOVERY_RULES = deepFreeze([
      {
        category: "commands",
        globs: ["commands/*.md"],
        id_rule: "basename without .md (commands/plan.md \u2192 'plan')",
        enforced: true
      },
      {
        category: "agents",
        globs: ["agents/*.md"],
        id_rule: "basename without .md (agents/architect.md \u2192 'architect')",
        enforced: true
      },
      {
        category: "skills",
        globs: ["skills/**/SKILL.md", "skills/**/SKILL.src.md"],
        id_rule: "the skill's `name:` frontmatter value (e.g. 'guild:review'). SKILL.src.md and its generated SKILL.md share one id (the src is the authored source).",
        enforced: true,
        note: "A SKILL.src.md (e.g. using-guild) is the authored source; if both SKILL.src.md and a generated SKILL.md exist they collapse to ONE id \u2014 discovery must dedupe by name, not by file."
      },
      {
        category: "hooks",
        globs: ["hooks/hooks.json"],
        id_rule: "one entry per (event, script) binding parsed from hooks.json; id = '<event>:<script-basename>'",
        enforced: true,
        note: "Discovery parses hooks.json, it does not glob script files \u2014 the binding (not the script) is the surface."
      },
      {
        category: "mcp_servers",
        globs: [".mcp.json"],
        id_rule: "each key under .mcp.json `mcpServers` (e.g. 'guild-memory')",
        enforced: true,
        note: "Discovery parses .mcp.json; MCP is NOT inline in plugin.json (verified)."
      },
      {
        category: "scripts",
        globs: ["scripts/**/*.ts"],
        id_rule: "repo-relative path under scripts/ without the .ts extension (scripts/build-inventory.ts \u2192 'build-inventory'; scripts/lib/x.ts \u2192 'lib/x')",
        enforced: true,
        note: "Exclude __tests__/** and *.test.ts (test files are not shipped surfaces). The L6 fail-fixture adds a non-test script and requires failure."
      },
      {
        category: "schemas",
        globs: [],
        id_rule: "the curated result-contract registry (result-contracts.ts RESULT_CONTRACTS); id = wire_schema_version",
        enforced: false,
        note: "Schemas are a CURATED registry, not a filesystem glob. Coverage here = the inventory's schemas[] equals result-contracts.ts RESULT_CONTRACTS (checked by L6 against the registry, not a scan)."
      },
      {
        category: "docs",
        globs: ["docs/**/*.md"],
        id_rule: "doc slug = repo-relative path without .md (unique across the full docs/ tree)",
        enforced: false,
        note: "Full docs/ tree is inventoried (FU-5). Still non-enforced: docs are a coverage/curation surface, not a load-bearing package input, so a missing doc is not an SC-7 fail-fixture."
      }
    ]);
    COVERAGE_ENFORCED_CATEGORIES = Object.freeze(DISCOVERY_RULES.filter(
      (r) => r.enforced
    ).map((r) => r.category));
  }
});

// ../src/modules/distribution/workflows/handoff-v2.ts
var ALLOWED_INJECTION_CLEAN_VALUES, ALLOWED_TOP_LEVEL_KEYS;
var init_handoff_v2 = __esm({
  "../src/modules/distribution/workflows/handoff-v2.ts"() {
    init_kernel();
    ALLOWED_INJECTION_CLEAN_VALUES = sealSet(["clean", "flagged", "unverified"], "ALLOWED_INJECTION_CLEAN_VALUES");
    ALLOWED_TOP_LEVEL_KEYS = sealSet([
      "schema_version",
      "task_id",
      "tier",
      "status",
      "summary",
      "artifacts",
      "issues",
      "escalate_reason",
      "learnings",
      "notes",
      "injection_clean"
    ], "ALLOWED_TOP_LEVEL_KEYS");
  }
});

// ../src/modules/distribution/workflows/review-result.ts
var init_review_result = __esm({
  "../src/modules/distribution/workflows/review-result.ts"() {
  }
});

// ../src/modules/distribution/workflows/result-contracts-v2.ts
var init_result_contracts_v2 = __esm({
  "../src/modules/distribution/workflows/result-contracts-v2.ts"() {
  }
});

// ../src/modules/distribution/workflows/result-contracts.ts
var EXISTING_CONTRACTS, DEFERRED_CONTRACTS, RESULT_CONTRACTS, PHASE1_NORMALIZER_TARGETS;
var init_result_contracts = __esm({
  "../src/modules/distribution/workflows/result-contracts.ts"() {
    init_handoff_v2();
    init_kernel();
    init_review_result();
    init_result_contracts_v2();
    EXISTING_CONTRACTS = deepFreeze([
      {
        wire_schema_version: "guild.handoff.v2",
        status: "exists",
        validator_kind: "strict",
        source_path: "plugin/hooks/lib/handoff-v2.ts",
        purpose: "Specialist lane result (dispatch envelope)."
      },
      {
        wire_schema_version: "review_result.v1",
        // NOTE: no `guild.` prefix (correction #1).
        status: "exists",
        validator_kind: "lenient",
        source_path: "plugin/scripts/verify-gate-pass.ts",
        // correction #2.
        purpose: "Advisory/adversarial review result (gate-pass binding)."
      },
      {
        wire_schema_version: "guild.phase_result.v1",
        status: "exists",
        validator_kind: "strict",
        source_path: "plugin/src/modules/distribution/workflows/result-contracts-v2.ts",
        purpose: "Phase close summary and gate predicate."
      },
      {
        wire_schema_version: "guild.permission_receipt.v1",
        status: "exists",
        validator_kind: "strict",
        source_path: "plugin/src/modules/distribution/workflows/result-contracts-v2.ts",
        purpose: "Requested/selected host mode and gate policy."
      },
      {
        wire_schema_version: "guild.host_event.v1",
        status: "exists",
        validator_kind: "strict",
        source_path: "plugin/src/modules/distribution/workflows/result-contracts-v2.ts",
        purpose: "Normalized hook/tool/session event."
      },
      {
        wire_schema_version: "guild.qa_result.v1",
        status: "exists",
        validator_kind: "strict",
        source_path: "plugin/src/modules/distribution/workflows/result-contracts-v2.ts",
        purpose: "Test matrix execution, gaps, failures, release predicate."
      }
    ]);
    DEFERRED_CONTRACTS = Object.freeze([]);
    RESULT_CONTRACTS = Object.freeze([
      ...EXISTING_CONTRACTS,
      ...DEFERRED_CONTRACTS
    ]);
    PHASE1_NORMALIZER_TARGETS = sealSet(EXISTING_CONTRACTS.map((c) => c.wire_schema_version), "PHASE1_NORMALIZER_TARGETS");
  }
});

// ../src/modules/distribution/workflows/build-inventory.ts
var path16, PLUGIN_ROOT;
var init_build_inventory = __esm({
  "../src/modules/distribution/workflows/build-inventory.ts"() {
    path16 = __toESM(require("node:path"));
    init_inventory_schema();
    init_state();
    init_parity_contract();
    init_result_contracts();
    PLUGIN_ROOT = path16.resolve(__dirname, "../../../..");
  }
});

// ../src/modules/distribution/workflows/check-module-ownership.ts
var init_check_module_ownership = __esm({
  "../src/modules/distribution/workflows/check-module-ownership.ts"() {
    init_build_inventory();
    init_kernel();
  }
});

// ../src/modules/distribution/workflows/equivalence-contract.ts
var EQUIVALENCE_SURFACES, INTENTIONAL_EXCLUSIONS, PROVENANCE_FIELDS, SORTED_MANIFEST_ARRAYS;
var init_equivalence_contract = __esm({
  "../src/modules/distribution/workflows/equivalence-contract.ts"() {
    init_kernel();
    EQUIVALENCE_SURFACES = Object.freeze([
      "manifest",
      "commands",
      "skills",
      "agents",
      "hooks_json",
      "bootstrap_sh",
      "mcp_json",
      "script_refs"
    ]);
    INTENTIONAL_EXCLUSIONS = deepFreeze([
      {
        path: "hooks_json.SessionStart (using-guild additionalContext injection)",
        reason: "L5b deliberately changes Claude SessionStart from bootstrap.sh plain-stdout banners to hookSpecificOutput.additionalContext injection \u2014 a chosen format change, NOT zero-delta (spec SC-8).",
        verified_by: "L5b golden test (NOT this equivalence check)."
      },
      {
        path: "*._rendered_at, *._source_version, generated_at",
        reason: "Render-provenance fields are build metadata the committed package does not carry; they are normalized OUT before comparison, never compared.",
        verified_by: "normalizeJson() strips them (PROVENANCE_FIELDS)."
      },
      {
        path: "manifest.skills, manifest.commands, manifest.agents (glob ordering)",
        reason: "The generated manifest's skill/command/agent path globs derive from the inventory in a canonical order; ordering is not semantically meaningful.",
        verified_by: "normalizeJson() sorts arrays of path-strings for these manifest fields (see SORTED_MANIFEST_ARRAYS) so order deltas are not failures."
      }
    ]);
    PROVENANCE_FIELDS = sealSet([
      "_rendered_at",
      "_source_version",
      "generated_at"
    ], "PROVENANCE_FIELDS");
    SORTED_MANIFEST_ARRAYS = sealSet(["skills", "commands", "agents"], "SORTED_MANIFEST_ARRAYS");
  }
});

// ../src/modules/distribution/workflows/module-resources.ts
var init_module_resources = __esm({
  "../src/modules/distribution/workflows/module-resources.ts"() {
    init_build_inventory();
    init_kernel();
  }
});

// ../src/modules/distribution/workflows/per-host-packaging.ts
var init_per_host_packaging = __esm({
  "../src/modules/distribution/workflows/per-host-packaging.ts"() {
  }
});

// ../src/modules/distribution/workflows/release-distribution-contract.ts
function sha256(value) {
  return crypto3.createHash("sha256").update(value).digest("hex");
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function verifyReleaseClaim(claim, archive) {
  const errors = [];
  if (claim.schema_version !== RELEASE_CLAIM_SCHEMA) errors.push("release contract-version mismatch");
  if (claim.archive_sha256 !== sha256(archive) || claim.archive_size !== archive.length) {
    errors.push("archive checksum/size mismatch");
  }
  if (claim.manifest_sha256 !== sha256(stableJson(claim.manifest)) || claim.manifest.entries.length === 0) {
    errors.push("manifest mismatch");
  }
  if (!/^[a-f0-9]{40}$/.test(claim.source_commit) || claim.archive_path !== `release/guild-${claim.source_commit}.tar.gz`) {
    errors.push("source-commit mismatch");
  }
  if (claim.contract_versions.runtime !== "guild.runtime_boundary_contract.v1" || claim.contract_versions.receipt !== "guild.handoff.v2" || claim.contract_versions.artifact !== "guild.artifact.v1") {
    errors.push("contract-version mismatch");
  }
  if (stableJson(claim.conformance_artifacts) !== stableJson(ACCEPTED_CONFORMANCE_ARTIFACTS)) {
    errors.push("conformance-artifact hash mismatch");
  }
  if (claim.operations.length !== OPERATION_KINDS.length || claim.operations.some((row, index) => row.kind !== OPERATION_KINDS[index]) || new Set(claim.operations.map((row) => row.kind)).size !== OPERATION_KINDS.length) {
    errors.push("operation kinds must be complete and distinct");
  }
  for (const row of claim.operations) {
    if (!row.destination || !row.manager.identity || !row.manager.path.startsWith("/")) {
      errors.push(`${row.kind}: destination and observed manager identity/path required`);
    }
    if (row.outcome === "refused" && !row.refusal_reason) errors.push(`${row.kind}: refusal reason required`);
    if (row.kind === "activate" && row.evidence_class !== "operator" && row.outcome !== "refused") {
      errors.push("activation requires operator evidence");
    }
  }
  if (claim.host_support.supported !== false) errors.push("unsupported host cannot be promoted");
  return errors;
}
var crypto3, RELEASE_CLAIM_SCHEMA, OPERATION_KINDS, ACCEPTED_CONFORMANCE_ARTIFACTS;
var init_release_distribution_contract = __esm({
  "../src/modules/distribution/workflows/release-distribution-contract.ts"() {
    crypto3 = __toESM(require("node:crypto"));
    RELEASE_CLAIM_SCHEMA = "guild.release_claim.v1";
    OPERATION_KINDS = Object.freeze(["render", "install", "activate", "update", "uninstall", "verify"]);
    ACCEPTED_CONFORMANCE_ARTIFACTS = Object.freeze([
      Object.freeze({ path: "handoffs/tooling-engineer-MH-08.md", sha256: "6168cd3381edd6a8f4cb234e4cb1c714147c65ea11c92cd9210c6429663fcdb1" }),
      Object.freeze({ path: "validation/mh-08-r12-done-lead-validation.json", sha256: "23dee57b587426ef56fbbc60e38d0008eb8c972890d1ceb3cbe0ddde3bcebb85" }),
      Object.freeze({ path: "review/G-lane:MH-08/result-12-r2.json", sha256: "5141b2b45caee0e47ca21dd853db22f8d885161935b19049c2392036710d0bd4" }),
      Object.freeze({ path: "validation/mh-08-r12-review-r2-lead-validation.json", sha256: "0f8054585bd4aeae1780e49c67cf6e65efe7023aeafceeed6fe336090c0fc27e" })
    ]);
  }
});

// ../src/modules/distribution/workflows/release-conformance-evaluator.ts
function refuseAdmission(detail) {
  throw new Error(`release-conformance-evaluator: ${detail}`);
}
function textBracketDepth(text) {
  let depth = 0;
  let max = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text.charAt(index);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") {
      depth += 1;
      if (depth > max) max = depth;
    } else if (ch === "}" || ch === "]") depth -= 1;
  }
  return max;
}
function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function identityComplete2(value) {
  if (!isPlainRecord(value)) return false;
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    const member = value[field];
    if (field === "contract_version") {
      if (typeof member !== "number" || !Number.isFinite(member)) return false;
      continue;
    }
    if (typeof member !== "string" || member.length === 0) return false;
  }
  return true;
}
function admitRequest(requestText) {
  if (typeof requestText !== "string") {
    refuseAdmission("the request must be canonical JSON text, never a live object");
  }
  if (requestText.length > MH09_MAX_REQUEST_CHARS) {
    refuseAdmission(`request text exceeds the ${MH09_MAX_REQUEST_CHARS}-character admission bound`);
  }
  if (textBracketDepth(requestText) > MH09_MAX_REQUEST_DEPTH) {
    refuseAdmission(`request text exceeds the depth-${MH09_MAX_REQUEST_DEPTH} admission bound`);
  }
  let parsed;
  try {
    parsed = JSON.parse(requestText);
  } catch {
    refuseAdmission("request text is not valid JSON");
  }
  if (!isPlainRecord(parsed)) {
    refuseAdmission("request text must decode to a single JSON object");
  }
  if (neutralCanonicalJson(parsed) !== requestText) {
    refuseAdmission("request text is not in canonical form");
  }
  for (const key of Object.keys(parsed)) {
    if (MH09_REQUEST_MEMBERS.indexOf(key) === -1) {
      refuseAdmission(
        `request member ${JSON.stringify(key)} is outside the closed vocabulary \u2014 the covered scenario set, trust roots, and packet labels are source-owned, never supplied`
      );
    }
  }
  const runId = parsed.run_id;
  const claimantId = parsed.claimant_id;
  const mode = parsed.mode;
  if (typeof runId !== "string" || runId.length === 0) refuseAdmission("run_id must be a non-empty string");
  if (typeof claimantId !== "string" || claimantId.length === 0) {
    refuseAdmission("claimant_id must be a non-empty string");
  }
  if (typeof mode !== "string" || MH09_MODES.indexOf(mode) === -1) {
    refuseAdmission("mode must be one of the closed evaluation modes");
  }
  if (!identityComplete2(parsed.evidence_identity)) {
    refuseAdmission("evidence_identity must carry every bound identity field");
  }
  const receiptRefs = parsed.receipt_refs;
  if (!isPlainRecord(receiptRefs)) refuseAdmission("receipt_refs must be a record");
  const freshness = parsed.evidence_freshness;
  if (!isPlainRecord(freshness)) refuseAdmission("evidence_freshness must be a record");
  for (const stableId of MH09_STABLE_IDS) {
    const ref = receiptRefs[stableId];
    if (typeof ref !== "string" || ref.length === 0) {
      refuseAdmission(`receipt_refs must bind every owner scenario; ${stableId} is unbound`);
    }
    const verdict = freshness[stableId];
    if (NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS.indexOf(verdict) === -1) {
      refuseAdmission(`evidence_freshness must carry a typed verdict for ${stableId}`);
    }
  }
  const scenarioEvidence = parsed.scenario_evidence;
  if (!isPlainRecord(scenarioEvidence)) refuseAdmission("scenario_evidence must be a record");
  for (const key of Object.keys(scenarioEvidence)) {
    if (MH09_STABLE_IDS.indexOf(key) === -1) {
      refuseAdmission(`scenario_evidence names ${JSON.stringify(key)}, which is not an owner scenario`);
    }
  }
  const scenario = parsed.scenario;
  if (scenario !== void 0 && (typeof scenario !== "string" || MH09_STABLE_IDS.indexOf(scenario) === -1)) {
    refuseAdmission("scenario, when present, must name one owner scenario");
  }
  return parsed;
}
function undemonstrated(observed) {
  return { disposition: "failed", reason_code: "scenario_result_mismatch", observed };
}
function stringOf(record, key) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}
function recordOf(record, key) {
  const value = record[key];
  return isPlainRecord(value) ? value : null;
}
function operationObserved(value, kind) {
  if (!isPlainRecord(value)) return false;
  if (value.kind !== kind || value.outcome !== "succeeded") return false;
  if (typeof value.destination !== "string" || value.destination.length === 0) return false;
  const manager = value.manager;
  if (!isPlainRecord(manager)) return false;
  return typeof manager.identity === "string" && manager.identity.length > 0 && typeof manager.path === "string" && manager.path.length > 0;
}
function releaseClaimVerifies(evidence, identity) {
  const claim = evidence.release_claim;
  const archiveBase64 = evidence.release_archive_base64;
  if (!isPlainRecord(claim) || typeof archiveBase64 !== "string" || archiveBase64.length === 0) {
    return { ok: false, errors: ["release claim or archive bytes absent"] };
  }
  let archive;
  try {
    archive = import_node_buffer.Buffer.from(archiveBase64, "base64");
  } catch {
    return { ok: false, errors: ["archive bytes are not decodable"] };
  }
  let errors;
  try {
    errors = verifyReleaseClaim(claim, archive);
  } catch (error) {
    return { ok: false, errors: [String(error?.message ?? error)] };
  }
  if (errors.length > 0) return { ok: false, errors };
  const claimRecord = claim;
  if (`sha256:${String(claimRecord.archive_sha256)}` !== identity.package_hash) {
    return { ok: false, errors: ["claim archive digest disagrees with the bound package hash"] };
  }
  if (claimRecord.source_commit !== identity.source_commit) {
    return { ok: false, errors: ["claim source commit disagrees with the bound identity"] };
  }
  return { ok: true, errors: [] };
}
function seededSupport(satisfied) {
  const record = { ...NEUTRAL_UNEVALUATED_SUPPORT };
  for (const state of satisfied) record[state] = "satisfied";
  return record;
}
function fromTransition(transition, observed) {
  return {
    disposition: transition.outcome.disposition,
    reason_code: transition.outcome.reason_code,
    observed: { ...observed, support_record: { ...transition.record } }
  };
}
function deriveSup001(evidence, identity) {
  const hostRecognized = evidence.host_recognized === true && NEUTRAL_RECOGNIZED_HOST_IDS.indexOf(identity.host_id) !== -1;
  const sourceBound = evidence.source_commit === identity.source_commit;
  const noArtifact = evidence.package_artifact_exists === false;
  const record = seededSupport(hostRecognized && sourceBound ? ["recognized"] : []);
  const claim = deriveNeutralSupportClaim(record);
  const observed = {
    host_recognized: hostRecognized,
    source_bound: sourceBound,
    package_artifact_exists: !noArtifact,
    proven: [...claim.proven],
    unproven: [...claim.unproven]
  };
  if (hostRecognized && sourceBound && noArtifact && claim.proven.length === 1 && claim.proven[0] === "recognized") {
    return { disposition: "succeeded", reason_code: null, observed };
  }
  return { disposition: "failed", reason_code: "support_operation_failed", observed };
}
function deriveSup002(evidence, identity) {
  const recognized = evidence.host_recognized === true && evidence.source_commit === identity.source_commit && NEUTRAL_RECOGNIZED_HOST_IDS.indexOf(identity.host_id) !== -1;
  const renderProven = evidence.package_hash === identity.package_hash && evidence.manifest_deterministic === true && evidence.manager_or_destination_mutated === false;
  const transition = applyNeutralSupportTransition(seededSupport(recognized ? ["recognized"] : []), "render", {
    satisfied: renderProven
  });
  if (transition.outcome.disposition === "succeeded" && transition.record.installed !== "not_evaluated") {
    return undemonstrated({ render_promoted_beyond_itself: true });
  }
  return fromTransition(transition, { recognized, render_proven: renderProven });
}
function deriveSup003(evidence, identity) {
  const renderBound = evidence.rendered_package_hash === identity.package_hash;
  const claimVerdict = releaseClaimVerifies(evidence, identity);
  const installObserved = operationObserved(evidence.install_operation, "install");
  const postWriteBound = evidence.post_write_hash === identity.package_hash;
  const installProven = claimVerdict.ok && installObserved && postWriteBound;
  const transition = applyNeutralSupportTransition(
    seededSupport(renderBound ? ["recognized", "rendered"] : ["recognized"]),
    "install",
    { satisfied: installProven }
  );
  return fromTransition(transition, {
    rendered_package_bound: renderBound,
    install_operation_observed: installObserved,
    post_write_bound: postWriteBound,
    release_claim_verified: claimVerdict.ok,
    release_claim_errors: [...claimVerdict.errors]
  });
}
function deriveSup004(evidence, identity) {
  const installedBound = evidence.installed_package_hash === identity.package_hash;
  const claimVerdict = releaseClaimVerifies(evidence, identity);
  const activateOp = evidence.activate_operation;
  const activateObserved = operationObserved(activateOp, "activate") && isPlainRecord(activateOp) && activateOp.evidence_class === "operator";
  const discovery = recordOf(evidence, "runtime_discovery");
  const discoveryBound = discovery !== null && discovery.active_version === identity.runtime_version && discovery.active_package_hash === identity.package_hash;
  const requiredSurfaces = evidence.required_entry_surfaces;
  const discoveredSurfaces = discovery === null ? null : discovery.entry_surfaces;
  const surfacesBound = Array.isArray(requiredSurfaces) && requiredSurfaces.length > 0 && Array.isArray(discoveredSurfaces) && requiredSurfaces.every((surface) => discoveredSurfaces.indexOf(surface) !== -1);
  const activateProven = claimVerdict.ok && activateObserved && discoveryBound && surfacesBound;
  const transition = applyNeutralSupportTransition(
    seededSupport(installedBound ? ["recognized", "rendered", "installed"] : ["recognized", "rendered"]),
    "activate",
    { satisfied: activateProven }
  );
  return fromTransition(transition, {
    installed_package_bound: installedBound,
    activate_operator_observed: activateObserved,
    runtime_discovery_bound: discoveryBound,
    entry_surfaces_bound: surfacesBound,
    release_claim_verified: claimVerdict.ok,
    release_claim_errors: [...claimVerdict.errors]
  });
}
function deriveSup005(evidence, identity) {
  const before = recordOf(evidence, "before_discovery");
  const after = recordOf(evidence, "after_discovery");
  const beforeObserved = before !== null && typeof before.active_version === "string" && typeof before.active_package_hash === "string";
  const afterObserved = after !== null && typeof after.active_version === "string" && typeof after.active_package_hash === "string";
  const changed = beforeObserved && afterObserved && (before?.active_version !== after?.active_version || before?.active_package_hash !== after?.active_package_hash);
  const afterBound = afterObserved && after?.active_version === identity.runtime_version && after?.active_package_hash === identity.package_hash;
  const claimVerdict = releaseClaimVerifies(evidence, identity);
  const updateObserved = operationObserved(evidence.update_operation, "update");
  const destinationStable = evidence.destination_unchanged === true;
  const updateProven = beforeObserved && afterObserved && changed && afterBound && claimVerdict.ok && updateObserved && destinationStable;
  const transition = applyNeutralSupportTransition(
    seededSupport(beforeObserved ? ["recognized", "rendered", "installed"] : ["recognized", "rendered"]),
    "update",
    { satisfied: updateProven }
  );
  return fromTransition(transition, {
    before_discovery_observed: beforeObserved,
    after_discovery_observed: afterObserved,
    version_changed: changed,
    after_bound_to_identity: afterBound,
    update_operation_observed: updateObserved,
    destination_unchanged: destinationStable,
    release_claim_verified: claimVerdict.ok,
    release_claim_errors: [...claimVerdict.errors]
  });
}
function deriveSup006(evidence, identity) {
  const activated = evidence.activated_identity;
  const identityExact = identityComplete2(activated) && NEUTRAL_EVIDENCE_IDENTITY_FIELDS.every(
    (field) => activated[field] === identity[field]
  );
  const manifestComplete = evidence.scenario_verdict_manifest_complete === true;
  const hashesResolve = evidence.all_evidence_hashes_resolve === true;
  const verifyProven = identityExact && manifestComplete && hashesResolve;
  const transition = applyNeutralSupportTransition(
    seededSupport(
      identityExact ? ["recognized", "rendered", "installed", "activated"] : ["recognized", "rendered", "installed"]
    ),
    "verify",
    { satisfied: verifyProven }
  );
  return fromTransition(transition, {
    activated_identity_exact: identityExact,
    scenario_verdict_manifest_complete: manifestComplete,
    all_evidence_hashes_resolve: hashesResolve
  });
}
function deriveVer001(evidence) {
  const prior = evidence.prior_verdict_identity;
  const current = evidence.current_identity;
  if (!identityComplete2(prior) || !identityComplete2(current)) {
    return EVIDENCE_MISSING;
  }
  const changed = NEUTRAL_EVIDENCE_IDENTITY_FIELDS.filter(
    (field) => prior[field] !== current[field]
  );
  if (changed.length > 0) {
    return {
      disposition: "refused",
      reason_code: "evidence_version_drift",
      observed: { changed_fields: changed, field_count: changed.length }
    };
  }
  return undemonstrated({ changed_fields: [], age_ignored: true });
}
function deriveVer002(evidence) {
  const consumer = evidence.consumer_pinned_major;
  const producer = evidence.producer_contract_major;
  if (typeof consumer !== "number" || !Number.isInteger(consumer) || typeof producer !== "number" || !Number.isInteger(producer)) {
    return EVIDENCE_MISSING;
  }
  if (consumer !== producer) {
    return {
      disposition: "unsupported",
      reason_code: "contract_major_mismatch",
      observed: {
        consumer_pinned_major: consumer,
        producer_contract_major: producer,
        bundle_parsed: false,
        bundle_hash: stringOf(evidence, "bundle_hash")
      }
    };
  }
  return undemonstrated({ consumer_pinned_major: consumer, producer_contract_major: producer });
}
function deriveVer003(evidence) {
  const expected = recordOf(evidence, "expected");
  const observedDiscovery = recordOf(evidence, "observed_runtime_discovery");
  if (expected === null || observedDiscovery === null) return EVIDENCE_MISSING;
  const comparisons = [
    { field: "package_hash", expected: expected.package_hash, observed: observedDiscovery.active_package_hash },
    { field: "runtime_version", expected: expected.runtime_version, observed: observedDiscovery.active_version },
    { field: "destination", expected: expected.destination, observed: observedDiscovery.destination }
  ];
  const mismatched = comparisons.filter((row) => row.expected !== row.observed);
  if (mismatched.length > 0) {
    return {
      disposition: "failed",
      reason_code: "package_runtime_mismatch",
      observed: { mismatched, expected, observed_runtime_discovery: observedDiscovery }
    };
  }
  return undemonstrated({ mismatched: [] });
}
function deriveScenario(stableId, evidence, identity) {
  if (!isPlainRecord(evidence)) return EVIDENCE_MISSING;
  switch (stableId) {
    case "MHRC-SUP-001":
      return deriveSup001(evidence, identity);
    case "MHRC-SUP-002":
      return deriveSup002(evidence, identity);
    case "MHRC-SUP-003":
      return deriveSup003(evidence, identity);
    case "MHRC-SUP-004":
      return deriveSup004(evidence, identity);
    case "MHRC-SUP-005":
      return deriveSup005(evidence, identity);
    case "MHRC-SUP-006":
      return deriveSup006(evidence, identity);
    case "MHRC-VER-001":
      return deriveVer001(evidence);
    case "MHRC-VER-002":
      return deriveVer002(evidence);
    case "MHRC-VER-003":
      return deriveVer003(evidence);
    default:
      return EVIDENCE_MISSING;
  }
}
function evaluateReleaseConformance(requestText) {
  const request = admitRequest(requestText);
  const identity = request.evidence_identity;
  const derivations = {};
  for (const stableId of MH09_STABLE_IDS) {
    derivations[stableId] = deriveScenario(stableId, request.scenario_evidence[stableId], identity);
  }
  const results = MH09_STABLE_IDS.map((stableId) => {
    const derived = derivations[stableId];
    return {
      stable_id: stableId,
      outcome_type: MH09_EXPECTED[stableId].type,
      disposition: derived.disposition,
      reason_code: derived.reason_code,
      receipt_ref: request.receipt_refs[stableId],
      evidence_identity: { ...identity },
      evidence_freshness: request.evidence_freshness[stableId]
    };
  });
  const matchesExpected = MH09_STABLE_IDS.every((stableId) => {
    const derived = derivations[stableId];
    const expected = MH09_EXPECTED[stableId];
    return derived.disposition === expected.disposition && derived.reason_code === expected.reason_code;
  });
  const anyEvidenceIncomplete = MH09_STABLE_IDS.some(
    (stableId) => derivations[stableId].reason_code === "scenario_evidence_incomplete"
  );
  const packet = neutralFreeze({
    schema_version: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    owner_key: MH09_OWNER_KEY,
    evidence_identity: { ...identity },
    stable_ids: [...MH09_STABLE_IDS],
    results
  });
  const evidenceFacts = MH09_STABLE_IDS.map((stableId) => ({
    stable_id: stableId,
    disposition: derivations[stableId].disposition,
    reason_code: derivations[stableId].reason_code,
    observed: derivations[stableId].observed
  }));
  const outcome = neutralOutcome({
    type: "guild.version_compatibility_outcome.v1",
    disposition: matchesExpected ? "succeeded" : anyEvidenceIncomplete ? "refused" : "failed",
    reason_code: matchesExpected ? null : anyEvidenceIncomplete ? "scenario_evidence_incomplete" : "scenario_result_mismatch",
    assertions: [
      "each of the nine W5/MH-09 scenarios was evaluated against the real support-state and release-distribution cores",
      "install/activate/update proofs drive the real verifyReleaseClaim over the bound claim and archive bytes",
      "version drift is compared over the complete bound identity tuple; age never substitutes for identity",
      request.mode === "fixture" ? "a fixture-mode packet proves mechanics only and is never promotable" : "a production-mode owner packet still cannot promote without downstream quorum authority"
    ],
    binding: { run_id: request.run_id },
    facts: {
      owner_key: MH09_OWNER_KEY,
      suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      evaluator_version: MH09_EVALUATOR_VERSION,
      mode: request.mode,
      claimant_id: request.claimant_id,
      focused_scenario: request.scenario ?? null,
      evidence: evidenceFacts
    }
  });
  return neutralFreeze({
    outcome,
    packet,
    promotable: false,
    mode: request.mode
  });
}
var import_node_buffer, MH09_OWNER_KEY, MH09_STABLE_IDS, MH09_MODES, MH09_REQUEST_MEMBERS, MH09_EVALUATOR_VERSION, MH09_MAX_REQUEST_CHARS, MH09_MAX_REQUEST_DEPTH, MH09_EXPECTED, EVIDENCE_MISSING;
var init_release_conformance_evaluator = __esm({
  "../src/modules/distribution/workflows/release-conformance-evaluator.ts"() {
    import_node_buffer = require("node:buffer");
    init_lifecycle();
    init_release_distribution_contract();
    MH09_OWNER_KEY = "W5/MH-09";
    MH09_STABLE_IDS = neutralFreeze([
      ...NEUTRAL_OWNER_SCENARIO_IDS[MH09_OWNER_KEY]
    ]);
    MH09_MODES = neutralFreeze(["production", "fixture"]);
    MH09_REQUEST_MEMBERS = neutralFreeze([
      "run_id",
      "claimant_id",
      "mode",
      "evidence_identity",
      "receipt_refs",
      "evidence_freshness",
      "scenario_evidence",
      "scenario"
    ]);
    MH09_EVALUATOR_VERSION = "guild.release_conformance_evaluator.v1";
    MH09_MAX_REQUEST_CHARS = 1e6;
    MH09_MAX_REQUEST_DEPTH = 64;
    MH09_EXPECTED = neutralFreeze({
      "MHRC-SUP-001": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", reason_code: null },
      "MHRC-SUP-002": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", reason_code: null },
      "MHRC-SUP-003": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", reason_code: null },
      "MHRC-SUP-004": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", reason_code: null },
      "MHRC-SUP-005": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", reason_code: null },
      "MHRC-SUP-006": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", reason_code: null },
      "MHRC-VER-001": { type: "guild.version_compatibility_outcome.v1", disposition: "refused", reason_code: "evidence_version_drift" },
      "MHRC-VER-002": { type: "guild.version_compatibility_outcome.v1", disposition: "unsupported", reason_code: "contract_major_mismatch" },
      "MHRC-VER-003": { type: "guild.version_compatibility_outcome.v1", disposition: "failed", reason_code: "package_runtime_mismatch" }
    });
    EVIDENCE_MISSING = neutralFreeze({
      disposition: "refused",
      reason_code: "scenario_evidence_incomplete",
      observed: { evidence_present: false }
    });
  }
});

// ../src/modules/telemetry/workflows/receipt-journal.ts
function makeReceiptInput(input) {
  return {
    run_id: input.run_id,
    operation_id: input.operation_id,
    correlation_id: input.correlation_id,
    event_id: input.event_id,
    causation_id: input.causation_id ?? null,
    scenario_id: input.scenario_id ?? null,
    event_name: input.event_name,
    outcome_type: input.outcome_type,
    disposition: input.disposition,
    observation_state: input.observation_state,
    input_hash: input.input_hash,
    output_hash: input.output_hash ?? null,
    terminal: input.terminal,
    recorded_at: input.recorded_at,
    observed_at: input.observed_at ?? null,
    versions: input.versions,
    affected_event_range: input.affected_event_range ?? null
  };
}
function canonicalJson2(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson2).join(",")}]`;
  const obj = value;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson2(obj[k])}`).join(",")}}`;
}
function sha2562(text) {
  return `sha256:${crypto4.createHash("sha256").update(text, "utf8").digest("hex")}`;
}
function sealReceiptRecord(input) {
  const body = {
    ...makeReceiptInput(input),
    schema_version: "guild.receipt_record.v1",
    sequence: input.sequence
  };
  return { ...body, record_hash: sha2562(canonicalJson2(body)) };
}
function verifyReceiptRecord(record) {
  const { record_hash, ...body } = record;
  return typeof record_hash === "string" && sha2562(canonicalJson2(body)) === record_hash;
}
function isValidCheckpointShape(value) {
  if (!value || typeof value !== "object") return false;
  const c = value;
  if (c.schema_version !== "guild.receipt_checkpoint.v1") return false;
  if (typeof c.run_id !== "string" || c.run_id.length === 0) return false;
  if (typeof c.last_sequence !== "number" || !Number.isInteger(c.last_sequence) || c.last_sequence < 0) return false;
  if (typeof c.record_count !== "number" || !Number.isInteger(c.record_count) || c.record_count < 0) return false;
  if (c.last_event_id !== null && (typeof c.last_event_id !== "string" || c.last_event_id.length === 0)) return false;
  if (typeof c.updated_at !== "string" || c.updated_at.length === 0) return false;
  if (typeof c.contract_version !== "string" || c.contract_version.length === 0) return false;
  return true;
}
function readCheckpointState(checkpointPath, io = defaultJournalIo) {
  const raw = io.readAll(checkpointPath);
  if (raw === null) return { state: "absent", checkpoint: null };
  if (raw.trim().length === 0) return { state: "malformed", checkpoint: null };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "malformed", checkpoint: null };
  }
  if (!isValidCheckpointShape(parsed)) return { state: "malformed", checkpoint: null };
  return { state: "present", checkpoint: parsed };
}
function checkpointsIdentical(a, b) {
  return a.schema_version === b.schema_version && a.run_id === b.run_id && a.last_sequence === b.last_sequence && a.last_event_id === b.last_event_id && a.record_count === b.record_count && a.updated_at === b.updated_at && a.contract_version === b.contract_version;
}
function highestSequenceRecord(records) {
  let best = null;
  for (const r of records) if (!best || r.sequence >= best.sequence) best = r;
  return best;
}
function compareCheckpointToJournal(read, scan, run_id) {
  const journalLast = highestSequenceRecord(scan.records);
  if (read.state === "malformed") {
    return [{ code: "checkpoint_malformed", expected: run_id, actual: null }];
  }
  if (read.state === "absent" || read.checkpoint === null) {
    if (scan.record_count === 0) return [];
    return [{ code: "checkpoint_missing", expected: scan.last_sequence, actual: null }];
  }
  const cp = read.checkpoint;
  const out = [];
  if (cp.run_id !== run_id) out.push({ code: "checkpoint_run_mismatch", expected: run_id, actual: cp.run_id });
  if (cp.contract_version !== RECEIPT_CONTRACT_VERSION) {
    out.push({ code: "checkpoint_contract_mismatch", expected: RECEIPT_CONTRACT_VERSION, actual: cp.contract_version });
  }
  if (cp.last_sequence !== scan.last_sequence) {
    out.push({ code: "checkpoint_sequence_mismatch", expected: scan.last_sequence, actual: cp.last_sequence });
  }
  if (cp.record_count !== scan.record_count) {
    out.push({ code: "checkpoint_count_mismatch", expected: scan.record_count, actual: cp.record_count });
  }
  if (cp.last_event_id !== (journalLast?.event_id ?? null)) {
    out.push({ code: "checkpoint_event_mismatch", expected: journalLast?.event_id ?? null, actual: cp.last_event_id });
  }
  if (journalLast && cp.updated_at !== journalLast.recorded_at) {
    out.push({ code: "checkpoint_timestamp_mismatch", expected: journalLast.recorded_at, actual: cp.updated_at });
  }
  return out;
}
function openLockPublication(lockPath2) {
  const frame = { lockPath: lockPath2, outer: ACTIVE_LOCK_PUBLICATION, grant: null, open: true };
  ACTIVE_LOCK_PUBLICATION = frame;
  return frame;
}
function closeLockPublication(frame) {
  frame.open = false;
  ACTIVE_LOCK_PUBLICATION = frame.outer;
  const grant = frame.grant;
  frame.grant = null;
  return grant;
}
function publishLockGrant(grant) {
  const frame = ACTIVE_LOCK_PUBLICATION;
  if (frame === null || !frame.open || frame.lockPath !== grant.path) return grant;
  const earlier = frame.grant;
  if (earlier !== null && earlier.fd !== null && earlier.fd !== grant.fd) closeQuietly(earlier.fd);
  frame.grant = grant;
  return grant;
}
function writeAllSync(fd, text) {
  const buf = Buffer.from(text, "utf8");
  let written = 0;
  while (written < buf.length) {
    written += fs13.writeSync(fd, buf, written, buf.length - written);
  }
}
function readAllSync(fd) {
  const size = fs13.fstatSync(fd).size;
  if (size === 0) return "";
  const buf = Buffer.allocUnsafe(size);
  let read = 0;
  while (read < size) {
    const n = fs13.readSync(fd, buf, read, size - read, read);
    if (n <= 0) break;
    read += n;
  }
  return buf.subarray(0, read).toString("utf8");
}
function realpathOrNull(target) {
  try {
    return (fs13.realpathSync.native ?? fs13.realpathSync)(target);
  } catch {
    return null;
  }
}
function readlinkOrNull(target) {
  try {
    return fs13.readlinkSync(target);
  } catch {
    return null;
  }
}
function canonicalJournalPath(journalPath2) {
  let current = path17.resolve(journalPath2);
  for (let hop = 0; hop < CANONICAL_PATH_MAX_LINK_HOPS; hop += 1) {
    const real = realpathOrNull(current);
    if (real !== null) return real;
    const link = readlinkOrNull(current);
    if (link !== null) {
      const next = path17.resolve(path17.dirname(current), link);
      if (next === current) return current;
      current = next;
      continue;
    }
    const parent = path17.dirname(current);
    if (parent === current) return current;
    return path17.join(canonicalJournalPath(parent), path17.basename(current));
  }
  return current;
}
function lstatOrNull(target) {
  try {
    return fs13.lstatSync(target);
  } catch {
    return null;
  }
}
function resolveJournalIdentity(journalPath2) {
  const refuse4 = (code, message) => ({
    ok: false,
    identity: null,
    failure: { code, message }
  });
  const canonical = canonicalJournalPath(journalPath2);
  if (canonicalJournalPath(canonical) !== canonical) {
    return refuse4(
      "journal_identity_unstable",
      `journal path "${journalPath2}" canonicalizes to "${canonical}", which itself resolves further \u2014 the name is moving and cannot be bound to a lock`
    );
  }
  const stat = lstatOrNull(canonical);
  if (stat === null) {
    return { ok: true, identity: { path: canonical, lock: `${canonical}.lock`, device: null, inode: null, links: null }, failure: null };
  }
  if (stat.isSymbolicLink()) {
    return refuse4(
      "journal_identity_unstable",
      `a symlink appeared at the canonical journal name "${canonical}" after it was resolved`
    );
  }
  if (!stat.isFile()) {
    return refuse4(
      "journal_identity_unstable",
      `canonical journal name "${canonical}" does not name a regular file`
    );
  }
  if (stat.nlink > 1) {
    return refuse4(
      "journal_identity_ambiguous",
      `journal at "${canonical}" is one physical file with ${stat.nlink} names (hard links) \u2014 a path-keyed lock cannot serialise writers that name it differently, so this operation is refused (remove the extra link, or give each producer its own journal)`
    );
  }
  return {
    ok: true,
    identity: { path: canonical, lock: `${canonical}.lock`, device: stat.dev, inode: stat.ino, links: stat.nlink },
    failure: null
  };
}
function journalIdentityDrift(locked, current) {
  if (current.path !== locked.path) {
    return `the journal path now resolves to "${current.path}" while the lock is held on "${locked.path}" \u2014 refusing to write to a destination this writer does not hold`;
  }
  if (locked.inode !== null && (current.inode !== locked.inode || current.device !== locked.device)) {
    return `the journal at "${locked.path}" was replaced under the lock (device/inode ${locked.device}/${locked.inode} \u2192 ${current.device}/${current.inode})`;
  }
  return null;
}
function journalLockPath(paths) {
  const resolved = resolveJournalIdentity(paths.journal);
  if (!resolved.ok) throw new JournalIdentityError(resolved.failure);
  return resolved.identity.lock;
}
function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function discardLockGrant(grant) {
  if (grant && grant.fd !== null) closeQuietly(grant.fd);
}
function lockRefusal(code, message) {
  return { grant: null, failure: { code, message } };
}
function asLockGrant(value, lockPath2) {
  if (typeof value !== "object" || value === null) return null;
  const claim = value;
  if (claim.path !== lockPath2) return null;
  if (typeof claim.device !== "number" || !Number.isFinite(claim.device)) return null;
  if (typeof claim.inode !== "number" || !Number.isFinite(claim.inode)) return null;
  if (claim.fd !== null && (typeof claim.fd !== "number" || !Number.isInteger(claim.fd) || claim.fd < 0)) return null;
  return {
    path: claim.path,
    device: claim.device,
    inode: claim.inode,
    fd: typeof claim.fd === "number" ? claim.fd : null
  };
}
function sameLockObject(a, b) {
  return a === b || a.path === b.path && a.device === b.device && a.inode === b.inode;
}
function discardDuplicateGrant(candidate, retained) {
  if (candidate === null || candidate === retained) return;
  if (candidate.fd !== null && candidate.fd !== retained.fd) closeQuietly(candidate.fd);
}
function acquireJournalLockHeld(lockPath2, io, options) {
  const acquire = io.acquireLock ?? defaultJournalIo.acquireLock;
  const attempts = Math.max(1, options.lock_max_attempts ?? JOURNAL_LOCK_MAX_ATTEMPTS);
  const wait = Math.max(0, options.lock_wait_ms ?? JOURNAL_LOCK_WAIT_MS);
  for (let i = 0; i < attempts; i += 1) {
    const publication = openLockPublication(lockPath2);
    let got;
    try {
      got = acquire(lockPath2);
    } catch (err) {
      discardLockGrant(closeLockPublication(publication));
      return lockRefusal(
        "journal_lock_failed",
        `journal lock could not be evaluated at ${lockPath2}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const published = closeLockPublication(publication);
    if (got) {
      const returned = asLockGrant(got, lockPath2);
      if (published !== null) {
        if (returned !== null && !sameLockObject(returned, published)) {
          discardDuplicateGrant(returned, published);
          discardLockGrant(published);
          return lockRefusal(
            "journal_lock_failed",
            `the acquisition of the journal lock at ${lockPath2} returned a lock object that is not the one its own primitive created for this call \u2014 refusing to hold an exclusion whose identity the acquisition disputes`
          );
        }
        discardDuplicateGrant(returned, published);
        return { grant: published, failure: null };
      }
      if (returned !== null) return { grant: returned, failure: null };
      return lockRefusal(
        "journal_lock_failed",
        `the journal lock at ${lockPath2} was reported as taken by an acquisition that named no lock object \u2014 refusing to mutate under an exclusion this writer cannot identify, and leaving that lock in place rather than deleting an object it cannot recognise as its own`
      );
    }
    discardLockGrant(published);
    if (i < attempts - 1) sleepSync(wait);
  }
  return lockRefusal(
    "journal_lock_unavailable",
    `journal lock at ${lockPath2} is held by another writer after ${attempts} attempts \u2014 refusing to append without exclusive access (remove the lock only after confirming no writer is live)`
  );
}
function acquireJournalLock(lockPath2, io = defaultJournalIo, options = {}) {
  const held = acquireJournalLockHeld(lockPath2, io, options);
  discardLockGrant(held.grant);
  return held.failure;
}
function releaseJournalLock(lockPath2, io = defaultJournalIo) {
  const release = io.releaseLock ?? defaultJournalIo.releaseLock;
  try {
    release(lockPath2);
  } catch {
  }
}
function statOrNull(target) {
  try {
    return fs13.statSync(target);
  } catch {
    return null;
  }
}
function fstatOrNull(fd) {
  try {
    return fs13.fstatSync(fd);
  } catch {
    return null;
  }
}
function closeQuietly(fd) {
  try {
    fs13.closeSync(fd);
  } catch {
  }
}
function acquireJournalAuthority(journalPath2, io = defaultJournalIo, lockOptions = {}, access = "read", checkpointPath = null) {
  const resolved = resolveJournalIdentity(journalPath2);
  if (!resolved.ok) return { ok: false, authority: null, identity: null, failure: resolved.failure };
  const identity = resolved.identity;
  const acquisition = acquireJournalLockHeld(identity.lock, io, lockOptions);
  if (acquisition.failure !== null) return { ok: false, authority: null, identity, failure: acquisition.failure };
  const grant = acquisition.grant;
  const journalParent = path17.dirname(identity.path);
  const parentStat = statOrNull(journalParent);
  const parentDevice = parentStat !== null ? parentStat.dev : null;
  const parentInode = parentStat !== null ? parentStat.ino : null;
  const checkpointParentPath = checkpointPath === null ? null : canonicalJournalPath(path17.dirname(checkpointPath));
  const checkpointCanonical = checkpointParentPath === null || checkpointPath === null ? null : path17.join(checkpointParentPath, path17.basename(checkpointPath));
  const checkpointParent = checkpointParentPath === null || checkpointParentPath === journalParent ? null : checkpointParentPath;
  let checkpointParentPin = null;
  let handle = null;
  let released = false;
  const unstable = (message) => ({ code: "journal_identity_unstable", message });
  const ambiguous = (message) => ({ code: "journal_identity_ambiguous", message });
  const pin = () => {
    const present2 = lstatOrNull(identity.path);
    if (present2 === null) return null;
    if (present2.isSymbolicLink() || !present2.isFile()) {
      return unstable(`canonical journal name "${identity.path}" no longer names a regular file`);
    }
    let fd = null;
    let writable = false;
    try {
      fd = fs13.openSync(identity.path, JOURNAL_ACCESS_FLAGS[access]);
      writable = access !== "read";
    } catch {
      fd = null;
    }
    if (fd === null) {
      try {
        fd = fs13.openSync(identity.path, "r");
        writable = false;
      } catch (err) {
        return unstable(
          `the journal at "${identity.path}" could not be opened for ${access}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    const st = fstatOrNull(fd);
    if (st === null || st.dev !== present2.dev || st.ino !== present2.ino) {
      closeQuietly(fd);
      return unstable(`the journal at "${identity.path}" was replaced while it was being opened`);
    }
    if (st.nlink > 1) {
      closeQuietly(fd);
      return ambiguous(
        `journal at "${identity.path}" is one physical file with ${st.nlink} names (hard links) \u2014 a path-keyed lock cannot serialise writers that name it differently, so this operation is refused`
      );
    }
    handle = { path: identity.path, fd, device: st.dev, inode: st.ino, writable };
    return null;
  };
  const pinCheckpointParent = () => {
    if (checkpointParent === null || checkpointParentPin !== null) return;
    let fd = null;
    try {
      fd = fs13.openSync(checkpointParent, "r");
    } catch {
      fd = null;
    }
    const st = fd !== null ? fstatOrNull(fd) : statOrNull(checkpointParent);
    if (st === null || !st.isDirectory()) {
      if (fd !== null) closeQuietly(fd);
      return;
    }
    checkpointParentPin = { device: st.dev, inode: st.ino, fd };
  };
  const verify = (stage) => {
    if (handle !== null) {
      const st = fstatOrNull(handle.fd);
      if (st === null) {
        return unstable(`the retained handle on "${identity.path}" can no longer be inspected ${stage}`);
      }
      if (st.dev !== handle.device || st.ino !== handle.inode) {
        return unstable(`the retained handle on "${identity.path}" no longer names the locked file ${stage}`);
      }
      if (st.nlink > 1) {
        return ambiguous(
          `the journal this writer holds gained a second name (${st.nlink} hard links) ${stage} \u2014 a path-keyed lock cannot serialise writers that name it differently, so this operation is refused (remove the extra link, or give each producer its own journal)`
        );
      }
      if (st.nlink < 1) {
        return unstable(`the journal this writer holds was unlinked ${stage} \u2014 its canonical name is gone`);
      }
    }
    const named = lstatOrNull(identity.path);
    if (handle !== null) {
      if (named === null) return unstable(`canonical journal name "${identity.path}" disappeared ${stage}`);
      if (named.isSymbolicLink() || !named.isFile()) {
        return unstable(`canonical journal name "${identity.path}" no longer names a regular file ${stage}`);
      }
      if (named.dev !== handle.device || named.ino !== handle.inode) {
        return unstable(
          `canonical journal name "${identity.path}" now names a different physical file ${stage} (device/inode ${handle.device}/${handle.inode} \u2192 ${named.dev}/${named.ino})`
        );
      }
    } else if (named !== null) {
      if (named.isSymbolicLink() || !named.isFile()) {
        return unstable(`canonical journal name "${identity.path}" no longer names a regular file ${stage}`);
      }
      if (named.nlink > 1) {
        return ambiguous(
          `the journal at "${identity.path}" has ${named.nlink} names ${stage} \u2014 a path-keyed lock cannot serialise writers that name it differently, so this operation is refused`
        );
      }
    }
    if (parentInode !== null && parentDevice !== null) {
      const parentNow = statOrNull(path17.dirname(identity.path));
      if (parentNow === null || parentNow.dev !== parentDevice || parentNow.ino !== parentInode) {
        return unstable(
          `the directory holding "${identity.path}" and its lock was replaced ${stage} \u2014 this writer's exclusion moved with the old directory and no longer covers this path`
        );
      }
    }
    if (grant.fd !== null) {
      const heldLock = fstatOrNull(grant.fd);
      if (heldLock === null || heldLock.dev !== grant.device || heldLock.ino !== grant.inode) {
        return unstable(
          `the lock object this writer acquired at "${identity.lock}" can no longer be inspected ${stage}`
        );
      }
    }
    const lockNow = lstatOrNull(identity.lock);
    if (lockNow === null || !lockNow.isDirectory() || lockNow.dev !== grant.device || lockNow.ino !== grant.inode) {
      return unstable(
        `the lock this writer acquired is no longer the lock at "${identity.lock}" ${stage} \u2014 another holder now owns that exclusion, so this operation is refused`
      );
    }
    const current = resolveJournalIdentity(journalPath2);
    if (!current.ok) return current.failure;
    const drift = journalIdentityDrift(identity, current.identity);
    if (drift) return unstable(`${drift} (${stage})`);
    if (checkpointPath !== null) {
      pinCheckpointParent();
      const pinned2 = checkpointParentPin;
      if (checkpointParent !== null && pinned2 !== null) {
        if (pinned2.fd !== null) {
          const heldDir = fstatOrNull(pinned2.fd);
          if (heldDir === null || heldDir.dev !== pinned2.device || heldDir.ino !== pinned2.inode) {
            return unstable(
              `the directory holding the checkpoint "${checkpointCanonical}" can no longer be inspected ${stage}`
            );
          }
        }
        const parentNow = statOrNull(checkpointParent);
        if (parentNow === null || parentNow.dev !== pinned2.device || parentNow.ino !== pinned2.inode) {
          return unstable(
            `the directory holding the checkpoint "${checkpointCanonical}" was replaced ${stage} \u2014 this writer's exclusion does not cover the checkpoint it was about to write`
          );
        }
      }
      const parentNamedNow = canonicalJournalPath(path17.dirname(checkpointPath));
      if (parentNamedNow !== checkpointParentPath) {
        return unstable(
          `the checkpoint "${checkpointPath}" now resolves into "${parentNamedNow}" rather than "${checkpointParentPath}" ${stage} \u2014 this writer holds the directory it was granted, not that one`
        );
      }
    }
    return null;
  };
  const release = () => {
    if (released) return;
    released = true;
    if (handle !== null) {
      closeQuietly(handle.fd);
      handle = null;
    }
    const pinnedCheckpointParent = checkpointParentPin;
    if (pinnedCheckpointParent !== null && pinnedCheckpointParent.fd !== null) {
      closeQuietly(pinnedCheckpointParent.fd);
      checkpointParentPin = { ...pinnedCheckpointParent, fd: null };
    }
    const lockNow = lstatOrNull(identity.lock);
    const stillOurs = lockNow !== null && lockNow.isDirectory() && lockNow.dev === grant.device && lockNow.ino === grant.inode;
    discardLockGrant(grant);
    if (stillOurs) {
      releaseJournalLock(identity.lock, io);
      return;
    }
  };
  const failClosed = (failure2) => {
    release();
    return { ok: false, authority: null, identity, failure: failure2 };
  };
  const pinned = pin();
  if (pinned) return failClosed(pinned);
  const held = verify("when the lock was taken");
  if (held) return failClosed(held);
  const authority = {
    identity,
    get handle() {
      return handle;
    },
    bind(target) {
      const gate = (stage) => {
        const failure2 = verify(stage);
        if (failure2) throw new JournalAuthorityDetachedError(failure2);
      };
      const forPath = (p) => {
        if (p !== identity.path) return null;
        if (handle !== null) return { ...handle, guard: gate };
        return { path: identity.path, fd: UNPINNED_FD, device: -1, inode: -1, writable: false, guard: gate };
      };
      const checkpointBinding = {
        path: checkpointCanonical ?? identity.path,
        fd: UNPINNED_FD,
        device: -1,
        inode: -1,
        writable: false,
        guard: gate
      };
      return {
        ...target,
        readAll: (p) => target.readAll(p, forPath(p)),
        appendLine: (p, text) => target.appendLine(p, text, forPath(p)),
        truncate: (p, size) => target.truncate(p, size, forPath(p)),
        writeCheckpoint: (p, content) => target.writeCheckpoint(p, content, checkpointBinding)
      };
    },
    verify,
    adopt(stage) {
      if (handle === null) {
        const opened = pin();
        if (opened) return opened;
      }
      return verify(stage);
    },
    release
  };
  return { ok: true, authority, identity, failure: null };
}
function analyzeReceiptRecords(records) {
  const seen = /* @__PURE__ */ new Map();
  const duplicate_sequences = [];
  const regressing_sequences = [];
  let prev = 0;
  for (const r of records) {
    seen.set(r.sequence, (seen.get(r.sequence) ?? 0) + 1);
    if ((seen.get(r.sequence) ?? 0) === 2) duplicate_sequences.push(r.sequence);
    if (r.sequence <= prev) regressing_sequences.push(r.sequence);
    prev = Math.max(prev, r.sequence);
  }
  const eventCounts = /* @__PURE__ */ new Map();
  const duplicate_event_ids = [];
  for (const r of records) {
    const n = (eventCounts.get(r.event_id) ?? 0) + 1;
    eventCounts.set(r.event_id, n);
    if (n === 2) duplicate_event_ids.push(r.event_id);
  }
  const bySequence = /* @__PURE__ */ new Map();
  for (const r of records) if (!bySequence.has(r.event_id)) bySequence.set(r.event_id, r.sequence);
  const order_violations = [];
  for (const r of records) {
    if (!r.causation_id) continue;
    const causeSeq = bySequence.get(r.causation_id) ?? null;
    if (causeSeq === null) {
      order_violations.push({
        event_id: r.event_id,
        sequence: r.sequence,
        reason: "cause_missing",
        causation_id: r.causation_id,
        cause_sequence: null
      });
    } else if (causeSeq >= r.sequence) {
      order_violations.push({
        event_id: r.event_id,
        sequence: r.sequence,
        reason: "cause_not_before_effect",
        causation_id: r.causation_id,
        cause_sequence: causeSeq
      });
    }
  }
  const lineageMap = /* @__PURE__ */ new Map();
  const run_ids = [];
  for (const r of records) {
    if (!run_ids.includes(r.run_id)) run_ids.push(r.run_id);
    let l = lineageMap.get(r.correlation_id);
    if (!l) {
      l = { correlation_id: r.correlation_id, operation_ids: [], event_ids: [] };
      lineageMap.set(r.correlation_id, l);
    }
    if (!l.operation_ids.includes(r.operation_id)) l.operation_ids.push(r.operation_id);
    l.event_ids.push(r.event_id);
  }
  const lineages = [...lineageMap.values()];
  const split_lineages = lineages.filter((l) => l.operation_ids.length > 1).map((l) => l.correlation_id);
  let structural_integrity = "intact";
  if (order_violations.length > 0 || duplicate_sequences.length > 0 || regressing_sequences.length > 0) {
    structural_integrity = "order_violation";
  } else if (split_lineages.length > 0 || run_ids.length > 1 || duplicate_event_ids.length > 0) {
    structural_integrity = "lineage_violation";
  }
  let observation_state = "checked_clean";
  if (records.length === 0) observation_state = "not_observed";
  else if (records.some((r) => r.observation_state === "observation_failed")) observation_state = "observation_failed";
  else if (records.some((r) => r.observation_state === "not_observed")) observation_state = "not_observed";
  return {
    duplicate_sequences,
    regressing_sequences,
    duplicate_event_ids,
    order_violations,
    lineages,
    split_lineages,
    run_ids,
    structural_integrity,
    observation_state
  };
}
function isValidReceiptRecordShape(value) {
  if (!value || typeof value !== "object") return false;
  const r = value;
  if (r.schema_version !== "guild.receipt_record.v1") return false;
  if (typeof r.sequence !== "number" || !Number.isInteger(r.sequence) || r.sequence < 1) return false;
  for (const f of REQUIRED_STRING_FIELDS) {
    if (typeof r[f] !== "string" || r[f].length === 0) return false;
  }
  if (!RECEIPT_DISPOSITIONS.includes(r.disposition)) return false;
  if (!OBSERVATION_STATES.includes(r.observation_state)) return false;
  if (!RECEIPT_EVENT_NAMES.includes(r.event_name)) return false;
  if (!RECEIPT_OUTCOME_TYPES.includes(r.outcome_type)) return false;
  const v = r.versions;
  if (!v || typeof v !== "object") return false;
  for (const f of ["host_id", "host_version", "runtime_version", "source_version", "contract_version"]) {
    if (typeof v[f] !== "string" || v[f].length === 0) return false;
  }
  return true;
}
function scanReceiptJournal(journalPath2, io = defaultJournalIo) {
  const raw = io.readAll(journalPath2);
  const empty = (integrity2) => ({
    schema_version: "guild.receipt_scan.v1",
    records: [],
    rejected: [],
    integrity: integrity2,
    observation_state: "not_observed",
    blocks_clean_close: true,
    last_sequence: 0,
    record_count: 0,
    duplicate_sequences: [],
    regressing_sequences: [],
    duplicate_event_ids: [],
    order_violations: [],
    lineages: [],
    split_lineages: [],
    run_ids: []
  });
  if (raw === null) return empty("absent");
  if (raw.length === 0) return empty("absent");
  const endsWithNewline = raw.endsWith("\n");
  const lines = raw.split("\n");
  if (endsWithNewline) lines.pop();
  const records = [];
  const rejected = [];
  lines.forEach((line, i) => {
    const lineNumber = i + 1;
    const isLast = i === lines.length - 1;
    const isTornTail = isLast && !endsWithNewline;
    if (line.length === 0) {
      if (!isTornTail) rejected.push({ line_number: lineNumber, reason: "unparsable" });
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      rejected.push({ line_number: lineNumber, reason: isTornTail ? "truncated" : "unparsable" });
      return;
    }
    if (!isValidReceiptRecordShape(parsed)) {
      rejected.push({ line_number: lineNumber, reason: isTornTail ? "truncated" : "schema_invalid" });
      return;
    }
    if (!verifyReceiptRecord(parsed)) {
      rejected.push({ line_number: lineNumber, reason: isTornTail ? "truncated" : "hash_mismatch" });
      return;
    }
    records.push(parsed);
  });
  const analysis = analyzeReceiptRecords(records);
  let integrity = analysis.structural_integrity;
  if (rejected.some((r) => r.reason === "hash_mismatch" || r.reason === "unparsable" || r.reason === "schema_invalid")) {
    integrity = "corrupt";
  } else if (rejected.some((r) => r.reason === "truncated")) {
    integrity = "truncated_tail";
  }
  const observation_state = analysis.observation_state === "checked_clean" && integrity !== "intact" ? "not_observed" : analysis.observation_state;
  return {
    schema_version: "guild.receipt_scan.v1",
    records,
    rejected,
    integrity,
    observation_state,
    blocks_clean_close: observation_state !== "checked_clean" || integrity !== "intact",
    last_sequence: records.reduce((m, r) => Math.max(m, r.sequence), 0),
    record_count: records.length,
    duplicate_sequences: analysis.duplicate_sequences,
    regressing_sequences: analysis.regressing_sequences,
    duplicate_event_ids: analysis.duplicate_event_ids,
    order_violations: analysis.order_violations,
    lineages: analysis.lineages,
    split_lineages: analysis.split_lineages,
    run_ids: analysis.run_ids
  };
}
function validateInput(input) {
  for (const f of REQUIRED_STRING_FIELDS) {
    const v = input[f];
    if (typeof v !== "string" || v.length === 0) return `missing or empty field: ${f}`;
  }
  if (!RECEIPT_DISPOSITIONS.includes(input.disposition)) return `disposition outside closed vocabulary: ${String(input.disposition)}`;
  if (!OBSERVATION_STATES.includes(input.observation_state)) return `observation_state outside closed vocabulary: ${String(input.observation_state)}`;
  if (!RECEIPT_EVENT_NAMES.includes(input.event_name)) return `event_name outside closed vocabulary: ${String(input.event_name)}`;
  if (!RECEIPT_OUTCOME_TYPES.includes(input.outcome_type)) return `outcome_type outside closed vocabulary: ${String(input.outcome_type)}`;
  if (!input.versions || typeof input.versions !== "object") return "missing versions";
  for (const f of ["host_id", "host_version", "runtime_version", "source_version", "contract_version"]) {
    if (typeof input.versions[f] !== "string" || input.versions[f].length === 0) return `missing or empty versions.${f}`;
  }
  return null;
}
function failed(input, code, message, disposition = "failed") {
  return {
    schema_version: "guild.receipt_outcome.v1",
    type: "guild.receipt_outcome.v1",
    disposition,
    event_id: input.event_id,
    operation_id: input.operation_id,
    sequence: null,
    observation_state: "observation_failed",
    durable: false,
    blocks_dependent_completion: true,
    checkpoint: null,
    record: null,
    failure: { code, message }
  };
}
function appendReceipt(paths, input, io = defaultJournalIo, lockOptions = {}, options = {}) {
  const invalid = validateInput(input);
  if (invalid) return failed(input, "invalid_record", invalid);
  const acquired = acquireJournalAuthority(paths.journal, io, lockOptions, "append", paths.checkpoint);
  if (!acquired.ok) return failed(input, acquired.failure.code, acquired.failure.message);
  const authority = acquired.authority;
  try {
    return appendLocked({ journal: authority.identity.path, checkpoint: paths.checkpoint }, input, io, authority, options);
  } finally {
    authority.release();
  }
}
function appendLocked(paths, input, io, authority, options) {
  const bound = authority.bind(io);
  const scan = scanReceiptJournal(paths.journal, bound);
  if (scan.integrity !== "intact" && scan.integrity !== "absent") {
    return failed(
      input,
      "journal_not_reconciled",
      `journal integrity is "${scan.integrity}" \u2014 reconcile before appending`
    );
  }
  if (scan.records.some((r) => r.event_id === input.event_id)) {
    return {
      ...failed(input, "duplicate_event_id", `event_id already present: ${input.event_id}`, "refused"),
      observation_state: input.observation_state,
      blocks_dependent_completion: false
    };
  }
  if (options.uniqueOperation && scan.records.some((r) => r.operation_id === input.operation_id)) {
    return {
      ...failed(input, "duplicate_operation_id", `operation_id already present: ${input.operation_id}`, "refused"),
      observation_state: input.observation_state,
      blocks_dependent_completion: false
    };
  }
  if (input.causation_id && !scan.records.some((r) => r.event_id === input.causation_id)) {
    return failed(input, "unknown_causation", `causation_id not present in journal: ${input.causation_id}`);
  }
  const foreignRun = scan.records.find((r) => r.run_id !== input.run_id);
  if (foreignRun) {
    return failed(
      input,
      "foreign_run_id",
      `journal belongs to run "${foreignRun.run_id}" \u2014 refusing to append run "${input.run_id}"`
    );
  }
  const otherOperation = scan.records.find(
    (r) => r.correlation_id === input.correlation_id && r.operation_id !== input.operation_id
  );
  if (otherOperation) {
    return failed(
      input,
      "correlation_lineage_split",
      `correlation_id "${input.correlation_id}" already resolves to operation "${otherOperation.operation_id}" \u2014 refusing to split it across "${input.operation_id}"`
    );
  }
  const record = sealReceiptRecord({ ...input, sequence: scan.last_sequence + 1 });
  const beforeAppend = authority.verify("before the append");
  if (beforeAppend) return failed(input, beforeAppend.code, beforeAppend.message);
  try {
    bound.appendLine(paths.journal, `${JSON.stringify(record)}
`);
  } catch (err) {
    if (err instanceof JournalAuthorityDetachedError) {
      return failed(input, err.failure.code, err.failure.message);
    }
    return failed(input, "journal_append_failed", err instanceof Error ? err.message : String(err));
  }
  const afterAppend = authority.adopt("after the append");
  if (afterAppend) return failed(input, afterAppend.code, afterAppend.message);
  const after = scanReceiptJournal(paths.journal, bound);
  const landed = after.records.find((r) => r.sequence === record.sequence && r.event_id === record.event_id);
  if (!landed || landed.record_hash !== record.record_hash) {
    return failed(
      input,
      "journal_append_unverified",
      `journal does not hold the sealed record for sequence ${record.sequence} after the append`
    );
  }
  if (after.integrity !== "intact" || after.record_count !== scan.record_count + 1) {
    return failed(
      input,
      "journal_append_unverified",
      `journal reads "${after.integrity}" with ${after.record_count} records after appending sequence ${record.sequence} (expected "intact" with ${scan.record_count + 1})`
    );
  }
  const checkpoint = {
    schema_version: "guild.receipt_checkpoint.v1",
    run_id: record.run_id,
    last_sequence: record.sequence,
    last_event_id: record.event_id,
    record_count: scan.record_count + 1,
    updated_at: record.recorded_at,
    contract_version: RECEIPT_CONTRACT_VERSION
  };
  const beforeCheckpoint = authority.verify("before the checkpoint replacement");
  if (beforeCheckpoint) return failed(input, beforeCheckpoint.code, beforeCheckpoint.message);
  try {
    bound.writeCheckpoint(paths.checkpoint, `${JSON.stringify(checkpoint, null, 2)}
`);
  } catch (err) {
    if (err instanceof JournalAuthorityDetachedError) {
      return failed(input, err.failure.code, err.failure.message);
    }
    return failed(input, "checkpoint_write_failed", err instanceof Error ? err.message : String(err));
  }
  const persisted = readCheckpointState(paths.checkpoint, io);
  if (persisted.state !== "present" || !checkpointsIdentical(persisted.checkpoint, checkpoint)) {
    return failed(
      input,
      "checkpoint_write_unverified",
      `checkpoint on disk reads "${persisted.state}" and does not match the checkpoint written for sequence ${record.sequence}`
    );
  }
  const beforeClaim = authority.verify("before the durable claim");
  if (beforeClaim) return failed(input, beforeClaim.code, beforeClaim.message);
  const blocked = input.observation_state === "not_observed" || input.observation_state === "observation_failed";
  return {
    schema_version: "guild.receipt_outcome.v1",
    type: "guild.receipt_outcome.v1",
    disposition: input.disposition,
    event_id: record.event_id,
    operation_id: record.operation_id,
    sequence: record.sequence,
    observation_state: record.observation_state,
    durable: true,
    blocks_dependent_completion: blocked,
    checkpoint,
    record,
    failure: null
  };
}
var fs13, path17, crypto4, RECEIPT_CONTRACT_VERSION, RECEIPT_DISPOSITIONS, OBSERVATION_STATES, RECEIPT_EVENT_NAMES, RECEIPT_OUTCOME_TYPES, UNPINNED_FD, JournalAuthorityDetachedError, ACTIVE_LOCK_PUBLICATION, defaultJournalIo, CANONICAL_PATH_MAX_LINK_HOPS, JournalIdentityError, JOURNAL_LOCK_MAX_ATTEMPTS, JOURNAL_LOCK_WAIT_MS, JOURNAL_ACCESS_FLAGS, REQUIRED_STRING_FIELDS;
var init_receipt_journal = __esm({
  "../src/modules/telemetry/workflows/receipt-journal.ts"() {
    fs13 = __toESM(require("node:fs"));
    path17 = __toESM(require("node:path"));
    crypto4 = __toESM(require("node:crypto"));
    init_state();
    RECEIPT_CONTRACT_VERSION = "guild.observability.v1";
    RECEIPT_DISPOSITIONS = Object.freeze([
      "succeeded",
      "refused",
      "unsupported",
      "failed",
      "degraded"
    ]);
    OBSERVATION_STATES = Object.freeze([
      "checked_clean",
      "not_applicable",
      "not_observed",
      "observation_failed"
    ]);
    RECEIPT_EVENT_NAMES = Object.freeze([
      "session.start",
      "prompt.submit",
      "tool.before",
      "tool.after",
      "context.compact",
      "task.dispatch",
      "task.collect",
      "run.resume",
      "run.stop",
      "package.render",
      "package.install",
      "package.activate",
      "package.update",
      "runtime.verify",
      "receipt.append",
      "receipt.reconcile",
      "migration.shadow",
      "migration.cutover",
      "migration.rollback"
    ]);
    RECEIPT_OUTCOME_TYPES = Object.freeze([
      "guild.lifecycle_outcome.v1",
      "guild.normalized_event_outcome.v1",
      "guild.support_transition_outcome.v1",
      "guild.capability_outcome.v1",
      "guild.policy_outcome.v1",
      "guild.receipt_outcome.v1",
      "guild.reconciliation_outcome.v1",
      "guild.boundary_outcome.v1",
      "guild.migration_outcome.v1",
      "guild.version_compatibility_outcome.v1"
    ]);
    UNPINNED_FD = -1;
    JournalAuthorityDetachedError = class extends Error {
      failure;
      constructor(failure2) {
        super(failure2.message);
        this.name = "JournalAuthorityDetachedError";
        this.failure = failure2;
      }
    };
    ACTIVE_LOCK_PUBLICATION = null;
    defaultJournalIo = {
      appendLine(journalPath2, text, bound) {
        bound?.guard?.("immediately before the append syscall");
        if (bound && bound.writable && bound.fd >= 0) {
          writeAllSync(bound.fd, text);
          fs13.fsyncSync(bound.fd);
          return;
        }
        fs13.mkdirSync(path17.dirname(journalPath2), { recursive: true });
        const fd = fs13.openSync(journalPath2, "a");
        try {
          fs13.writeSync(fd, text, null, "utf8");
          fs13.fsyncSync(fd);
        } finally {
          fs13.closeSync(fd);
        }
      },
      readAll(journalPath2, bound) {
        if (bound && bound.fd >= 0) {
          try {
            return readAllSync(bound.fd);
          } catch {
            return null;
          }
        }
        try {
          return fs13.readFileSync(journalPath2, "utf8");
        } catch {
          return null;
        }
      },
      writeCheckpoint(checkpointPath, content, bound) {
        bound?.guard?.("immediately before the checkpoint replacement");
        atomicWrite(checkpointPath, content);
      },
      truncate(journalPath2, size, bound) {
        bound?.guard?.("immediately before the truncation syscall");
        if (bound && bound.writable && bound.fd >= 0) {
          fs13.ftruncateSync(bound.fd, size);
          return;
        }
        fs13.truncateSync(journalPath2, size);
      },
      // `mkdir` is the portable atomic test-and-set: it either creates the
      // directory or fails EEXIST, with no window in between. `open(O_CREAT|O_EXCL)`
      // has the same guarantee locally but is famously unreliable over NFS, and
      // Guild journals can live on a shared volume.
      acquireLock(lockPath2) {
        fs13.mkdirSync(path17.dirname(lockPath2), { recursive: true });
        try {
          fs13.mkdirSync(lockPath2);
        } catch (err) {
          if (err.code === "EEXIST") return false;
          throw err;
        }
        let fd = null;
        try {
          fd = fs13.openSync(lockPath2, "r");
        } catch {
          fd = null;
        }
        const stat = fd !== null ? fstatOrNull(fd) : lstatOrNull(lockPath2);
        if (stat === null || !stat.isDirectory()) {
          if (fd !== null) closeQuietly(fd);
          throw new Error(
            `journal lock at ${lockPath2} could not be identified immediately after it was created \u2014 refusing to hold an exclusion this writer cannot name`
          );
        }
        return publishLockGrant({ path: lockPath2, device: stat.dev, inode: stat.ino, fd });
      },
      releaseLock(lockPath2) {
        try {
          fs13.rmdirSync(lockPath2);
        } catch {
        }
      }
    };
    CANONICAL_PATH_MAX_LINK_HOPS = 32;
    JournalIdentityError = class extends Error {
      code;
      constructor(failure2) {
        super(failure2.message);
        this.name = "JournalIdentityError";
        this.code = failure2.code;
      }
    };
    JOURNAL_LOCK_MAX_ATTEMPTS = 600;
    JOURNAL_LOCK_WAIT_MS = 20;
    JOURNAL_ACCESS_FLAGS = {
      append: "a+",
      truncate: "r+",
      read: "r"
    };
    REQUIRED_STRING_FIELDS = [
      "run_id",
      "operation_id",
      "correlation_id",
      "event_id",
      "input_hash",
      "recorded_at"
    ];
  }
});

// ../src/modules/telemetry/workflows/receipt-reconcile.ts
function payloadHash(record) {
  return `${record.input_hash}|${record.output_hash ?? "null"}`;
}
function toRuns(missing) {
  const runs = [];
  for (const n of missing) {
    const last = runs[runs.length - 1];
    if (last && n === last.to + 1) last.to = n;
    else runs.push({ from: n, to: n });
  }
  return runs;
}
function candidateSortKey(rec) {
  const anyRec = rec;
  const seq = typeof anyRec.sequence === "number" && Number.isFinite(anyRec.sequence) ? anyRec.sequence : Number.MAX_SAFE_INTEGER;
  const eventId = typeof anyRec.event_id === "string" ? anyRec.event_id : "";
  const recordHash = typeof anyRec.record_hash === "string" ? anyRec.record_hash : "";
  return [seq, eventId, recordHash];
}
function compareCandidates(a, b) {
  const [as, ae, ah] = candidateSortKey(a);
  const [bs, be, bh] = candidateSortKey(b);
  if (as !== bs) return as - bs;
  if (ae !== be) return ae < be ? -1 : 1;
  if (ah !== bh) return ah < bh ? -1 : 1;
  return 0;
}
function structuralRejection(rec, ctx) {
  if (!isValidReceiptRecordShape(rec)) return "schema_invalid";
  if (!verifyReceiptRecord(rec)) return "hash_mismatch";
  if (rec.run_id !== ctx.run_id) return "foreign_run";
  if (!ctx.missing.has(rec.sequence)) return "outside_declared_gap";
  return null;
}
function cleanlinessRejection(rec) {
  if (rec.observation_state !== "checked_clean" && rec.observation_state !== "not_applicable") {
    return "unclean_observation";
  }
  if (rec.disposition === "failed" || rec.disposition === "degraded") return "unclean_disposition";
  return null;
}
function vetRecoveries(offered, ctx) {
  const rejected = [];
  const reject = (rec, reason) => {
    const anyRec = rec;
    rejected.push({
      sequence: typeof anyRec?.sequence === "number" ? anyRec.sequence : 0,
      event_id: typeof anyRec?.event_id === "string" ? anyRec.event_id : "",
      reason
    });
  };
  const ordered = [...offered].sort(compareCandidates);
  let alive = [];
  for (const rec of ordered) {
    const reason = structuralRejection(rec, ctx);
    if (reason) reject(rec, reason);
    else alive.push(rec);
  }
  const journalSequences = new Set(ctx.journal.map((r) => r.sequence));
  const journalEventIds = new Set(ctx.journal.map((r) => r.event_id));
  const claimedSequences = new Set(journalSequences);
  const claimedEventIds = new Set(journalEventIds);
  let next = [];
  for (const rec of alive) {
    if (claimedSequences.has(rec.sequence)) {
      reject(rec, "duplicate_sequence");
      continue;
    }
    if (claimedEventIds.has(rec.event_id)) {
      reject(rec, "duplicate_event_id");
      continue;
    }
    claimedSequences.add(rec.sequence);
    claimedEventIds.add(rec.event_id);
    next.push(rec);
  }
  alive = next;
  const unclean = [];
  next = [];
  for (const rec of alive) {
    const reason = cleanlinessRejection(rec);
    if (reason) unclean.push({ rec, reason });
    else next.push(rec);
  }
  alive = next;
  const frame = /* @__PURE__ */ new Map();
  for (const r of ctx.journal) if (!frame.has(r.event_id)) frame.set(r.event_id, r.sequence);
  for (const r of alive) frame.set(r.event_id, r.sequence);
  const causalRejection = (rec) => {
    if (!rec.causation_id) return null;
    const causeSeq = frame.get(rec.causation_id);
    if (causeSeq === void 0) return "unknown_causation";
    if (causeSeq >= rec.sequence) return "cause_not_before_effect";
    return null;
  };
  for (; ; ) {
    let changed = false;
    next = [];
    for (const rec of alive) {
      const reason = causalRejection(rec);
      if (reason) {
        reject(rec, reason);
        frame.delete(rec.event_id);
        changed = true;
        continue;
      }
      next.push(rec);
    }
    alive = next;
    if (!changed) break;
  }
  for (const { rec, reason } of unclean) reject(rec, causalRejection(rec) ?? reason);
  rejected.sort((a, b) => a.sequence - b.sequence || (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0) || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
  return { accepted: alive, rejected };
}
function reconcileReceiptJournal(opts) {
  const io = opts.io ?? defaultJournalIo;
  if (opts.repair_checkpoint !== true) return reconcileWithin(opts, io, null, opts.journalPath, null);
  const acquired = acquireJournalAuthority(
    opts.journalPath,
    io,
    { lock_max_attempts: opts.lock_max_attempts, lock_wait_ms: opts.lock_wait_ms },
    "read",
    // The checkpoint this repair may MUTATE, named at acquisition so its own
    // directory is part of the domain when it is not the journal's (MH-06-R6-B3).
    opts.checkpointPath
  );
  if (!acquired.ok) {
    return reconcileWithin(
      opts,
      io,
      accessDenial(acquired.failure),
      acquired.identity?.path ?? opts.journalPath,
      null
    );
  }
  const authority = acquired.authority;
  try {
    return reconcileWithin(opts, io, null, authority.identity.path, authority);
  } finally {
    authority.release();
  }
}
function identityDenial(failure2) {
  return {
    code: failure2.code === "journal_identity_ambiguous" ? "repair_identity_ambiguous" : "repair_identity_unstable",
    message: failure2.message
  };
}
function accessDenial(failure2) {
  if (failure2.code === "journal_lock_unavailable") return { code: "repair_lock_unavailable", message: failure2.message };
  if (failure2.code === "journal_lock_failed") return { code: "repair_lock_failed", message: failure2.message };
  return identityDenial({ code: failure2.code, message: failure2.message });
}
function reconcileWithin(opts, io, denial, journalPath2, authority) {
  const journalIo = authority !== null ? authority.bind(io) : io;
  const scan = scanReceiptJournal(journalPath2, journalIo);
  const checkpointRead = readCheckpointState(opts.checkpointPath, io);
  const checkpoint_before = checkpointRead.checkpoint;
  const observed = new Set(scan.records.map((r) => r.sequence));
  const expectedMax = Math.max(opts.producerCheckpoint.last_sequence, scan.last_sequence);
  const missing = [];
  for (let s = 1; s <= expectedMax; s += 1) if (!observed.has(s)) missing.push(s);
  const gapRuns = toRuns(missing);
  const missingSet = new Set(missing);
  const { accepted: acceptedRecoveries, rejected: rejected_recoveries } = vetRecoveries(opts.recovered ?? [], {
    run_id: opts.run_id,
    missing: missingSet,
    journal: scan.records
  });
  const claimed = new Set(acceptedRecoveries.map((r) => r.sequence));
  const recovered_sequences = acceptedRecoveries.map((r) => r.sequence).sort((a, b) => a - b);
  const unresolved_sequences = missing.filter((s) => !claimed.has(s));
  const gaps = gapRuns.map((run) => {
    let recovered = true;
    for (let s = run.from; s <= run.to; s += 1) if (!claimed.has(s)) recovered = false;
    return {
      from: run.from,
      to: run.to,
      recovered,
      observation_state: recovered ? "checked_clean" : "not_observed"
    };
  });
  const merged = [...scan.records, ...acceptedRecoveries].sort((a, b) => a.sequence - b.sequence);
  const mergedAnalysis = analyzeReceiptRecords(merged);
  const byOperation = /* @__PURE__ */ new Map();
  for (const r of merged) {
    const list = byOperation.get(r.operation_id);
    if (list) list.push(r);
    else byOperation.set(r.operation_id, [r]);
  }
  const byEventId = /* @__PURE__ */ new Map();
  for (const r of merged) {
    const list = byEventId.get(r.event_id);
    if (list) list.push(r);
    else byEventId.set(r.event_id, [r]);
  }
  const event_identity_conflicts = [];
  for (const [event_id, group] of byEventId) {
    if (group.length < 2) continue;
    event_identity_conflicts.push({
      event_id,
      sequences: group.map((r) => r.sequence),
      operation_ids: [...new Set(group.map((r) => r.operation_id))]
    });
  }
  const duplicates = [];
  const conflicts = [];
  for (const [operation_id, group] of byOperation) {
    if (group.length < 2) continue;
    const hashes = group.map(payloadHash);
    const allEqual = hashes.every((h) => h === hashes[0]);
    if (allEqual) {
      duplicates.push({
        operation_id,
        event_ids: group.map((r) => r.event_id),
        authoritative_event_id: group[0].event_id,
        // lowest sequence is authoritative
        payload_hash: hashes[0],
        effects_applied: 1
      });
    } else {
      conflicts.push({
        operation_id,
        event_ids: group.map((r) => r.event_id),
        payload_hashes: hashes,
        reason: "payload_hash_mismatch"
      });
    }
  }
  const mergedLast = highest(merged);
  const checkpoint_after = {
    schema_version: "guild.receipt_checkpoint.v1",
    run_id: opts.run_id,
    last_sequence: mergedLast?.sequence ?? 0,
    last_event_id: mergedLast?.event_id ?? null,
    record_count: merged.length,
    updated_at: mergedLast?.recorded_at ?? opts.reconciled_at,
    contract_version: RECEIPT_CONTRACT_VERSION
  };
  const checkpoint_disagreements = [
    ...compareCheckpointToJournal(checkpointRead, scan, opts.run_id)
  ];
  const journalLast = highest(scan.records);
  if (checkpointRead.state === "absent" && scan.record_count === 0 && (opts.producerCheckpoint.record_count > 0 || opts.producerCheckpoint.last_sequence > 0)) {
    checkpoint_disagreements.push({
      code: "checkpoint_missing",
      expected: opts.producerCheckpoint.last_sequence,
      actual: null
    });
  }
  if (opts.producerCheckpoint.last_sequence !== checkpoint_after.last_sequence) {
    checkpoint_disagreements.push({
      code: "producer_sequence_mismatch",
      expected: checkpoint_after.last_sequence,
      actual: opts.producerCheckpoint.last_sequence
    });
  }
  if (opts.producerCheckpoint.record_count !== checkpoint_after.record_count) {
    checkpoint_disagreements.push({
      code: "producer_count_mismatch",
      expected: checkpoint_after.record_count,
      actual: opts.producerCheckpoint.record_count
    });
  }
  const foreignRun = mergedAnalysis.run_ids.find((id) => id !== opts.run_id);
  if (foreignRun !== void 0) {
    checkpoint_disagreements.push({
      code: "merged_run_identity_mismatch",
      expected: opts.run_id,
      actual: foreignRun
    });
  }
  for (const conflict of event_identity_conflicts) {
    checkpoint_disagreements.push({
      code: "merged_event_identity_conflict",
      expected: conflict.event_id,
      actual: conflict.sequences.join(",")
    });
  }
  const tailDamaged = scan.integrity === "truncated_tail" || scan.integrity === "corrupt" || scan.integrity === "order_violation" || scan.integrity === "lineage_violation";
  const invalidRecovery = rejected_recoveries.some((r) => INVALID_RECOVERY_REASONS.has(r.reason));
  const hardFailure = conflicts.length > 0 || invalidRecovery || event_identity_conflicts.length > 0;
  const mergedIncoherent = mergedAnalysis.structural_integrity !== "intact";
  const observationUnclean = mergedAnalysis.observation_state !== "checked_clean";
  const checkpoint_repair = {
    requested: opts.repair_checkpoint === true,
    attempted: false,
    persisted: false,
    verified: false,
    residual_disagreements: [],
    failure: null
  };
  const lostAuthority = checkpoint_repair.requested && !denial && authority !== null ? authority.verify("before the checkpoint repair") : null;
  if (checkpoint_repair.requested && (denial || lostAuthority)) {
    const refusal2 = denial ?? identityDenial(lostAuthority);
    checkpoint_repair.failure = { code: refusal2.code, message: refusal2.message };
  } else if (checkpoint_repair.requested) {
    const blockers = [];
    if (hardFailure) blockers.push("conflicting or invalid records");
    if (unresolved_sequences.length > 0) blockers.push(`unresolved sequences ${unresolved_sequences.join(",")}`);
    if (tailDamaged) blockers.push(`journal integrity is "${scan.integrity}"`);
    if (mergedIncoherent) blockers.push(`merged lineage is "${mergedAnalysis.structural_integrity}"`);
    if (observationUnclean) blockers.push(`merged observation state is "${mergedAnalysis.observation_state}"`);
    if (foreignRun !== void 0) {
      blockers.push(`journal belongs to run "${foreignRun}", not "${opts.run_id}"`);
    }
    if (acceptedRecoveries.length > 0) {
      blockers.push(
        `${acceptedRecoveries.length} recovered record(s) are not durable in the journal \u2014 the checkpoint may only describe durable content`
      );
    }
    if (opts.producerCheckpoint.last_sequence !== checkpoint_after.last_sequence || opts.producerCheckpoint.record_count !== checkpoint_after.record_count) {
      blockers.push("producer checkpoint does not describe the merged view");
    }
    const stillHeldToWrite = blockers.length === 0 && authority !== null ? authority.verify("before the repair write") : null;
    if (blockers.length > 0) {
      checkpoint_repair.failure = {
        code: "repair_not_permitted",
        message: `checkpoint repair refused: ${blockers.join("; ")}`
      };
    } else if (stillHeldToWrite) {
      checkpoint_repair.failure = identityDenial(stillHeldToWrite);
    } else {
      checkpoint_repair.attempted = true;
      try {
        journalIo.writeCheckpoint(opts.checkpointPath, `${JSON.stringify(checkpoint_after, null, 2)}
`);
        checkpoint_repair.persisted = true;
      } catch (err) {
        if (err instanceof JournalAuthorityDetachedError) {
          checkpoint_repair.attempted = false;
          checkpoint_repair.failure = identityDenial(err.failure);
        } else {
          checkpoint_repair.failure = {
            code: "repair_write_failed",
            message: err instanceof Error ? err.message : String(err)
          };
        }
      }
      if (checkpoint_repair.persisted) {
        const currentScan = scanReceiptJournal(journalPath2, journalIo);
        const reread = readCheckpointState(opts.checkpointPath, io);
        const identical = reread.checkpoint !== null && checkpointsIdentical(reread.checkpoint, checkpoint_after);
        checkpoint_repair.residual_disagreements = compareCheckpointToJournal(reread, currentScan, opts.run_id);
        const stillHeld = authority !== null ? authority.verify("before the repair is reported verified") : null;
        checkpoint_repair.verified = identical && checkpoint_repair.residual_disagreements.length === 0 && stillHeld === null;
        if (!checkpoint_repair.verified) {
          checkpoint_repair.failure = stillHeld ? identityDenial(stillHeld) : {
            code: "repair_verify_failed",
            message: identical ? `checkpoint was written but still disagrees with the journal: ${checkpoint_repair.residual_disagreements.map((d) => d.code).join(", ")}` : "checkpoint on disk does not match the reconciled checkpoint after write"
          };
        }
      }
    }
  }
  const repairAccessDenied = checkpoint_repair.requested && checkpoint_repair.failure !== null && REPAIR_ACCESS_DENIALS.has(checkpoint_repair.failure.code);
  const repairFailed = (checkpoint_repair.attempted || repairAccessDenied) && !checkpoint_repair.verified;
  const checkpointUnresolved = checkpoint_disagreements.length > 0 && !checkpoint_repair.verified;
  let disposition = "succeeded";
  if (hardFailure || mergedIncoherent || repairFailed) disposition = "failed";
  else if (gaps.length > 0 || tailDamaged || observationUnclean || checkpointUnresolved) {
    disposition = "degraded";
  }
  const blocks_clean_close = hardFailure || mergedIncoherent || repairFailed || rejected_recoveries.length > 0 || unresolved_sequences.length > 0 || tailDamaged || observationUnclean || checkpointUnresolved;
  return {
    schema_version: "guild.reconciliation_outcome.v1",
    type: "guild.reconciliation_outcome.v1",
    disposition,
    run_id: opts.run_id,
    journal_integrity: scan.integrity,
    journal_observation_state: scan.observation_state,
    merged_observation_state: mergedAnalysis.observation_state,
    merged_integrity: mergedAnalysis.structural_integrity,
    gaps,
    recovered_sequences,
    unresolved_sequences,
    rejected_recoveries,
    duplicates,
    conflicts,
    event_identity_conflicts,
    authoritative_effect_count: byOperation.size,
    reconciled_order: merged.map((r) => ({ sequence: r.sequence, event_id: r.event_id })),
    checkpoint_before,
    checkpoint_before_state: checkpointRead.state,
    checkpoint_after,
    checkpoint_disagreements,
    checkpoint_repair,
    blocks_clean_close,
    contract_version: RECEIPT_CONTRACT_VERSION,
    reconciled_at: opts.reconciled_at
  };
}
var INVALID_RECOVERY_REASONS, REPAIR_ACCESS_DENIALS, highest;
var init_receipt_reconcile = __esm({
  "../src/modules/telemetry/workflows/receipt-reconcile.ts"() {
    init_receipt_journal();
    INVALID_RECOVERY_REASONS = /* @__PURE__ */ new Set([
      "schema_invalid",
      "hash_mismatch",
      "foreign_run",
      "outside_declared_gap",
      "duplicate_sequence",
      "duplicate_event_id",
      "unknown_causation",
      "cause_not_before_effect"
    ]);
    REPAIR_ACCESS_DENIALS = /* @__PURE__ */ new Set([
      "repair_lock_unavailable",
      "repair_lock_failed",
      "repair_identity_ambiguous",
      "repair_identity_unstable"
    ]);
    highest = highestSequenceRecord;
  }
});

// ../src/modules/telemetry/workflows/debug-bundle.ts
var DEBUG_BUNDLE_SECTION_KINDS;
var init_debug_bundle = __esm({
  "../src/modules/telemetry/workflows/debug-bundle.ts"() {
    init_receipt_journal();
    DEBUG_BUNDLE_SECTION_KINDS = Object.freeze([
      "capability_snapshot",
      "normalized_event",
      "policy_decision",
      "transport_attempt",
      "artifact",
      "conformance"
    ]);
  }
});

// ../src/modules/telemetry/workflows/receipt-journal-conformance-evaluator.ts
function freezeDeep(value) {
  const seen = /* @__PURE__ */ new Set();
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    Object.freeze(node);
    for (const key of Object.keys(node)) {
      walk(node[key]);
    }
  };
  walk(value);
  return value;
}
function evaluationOutcome(input) {
  const reason = input.reason_code === void 0 ? null : input.reason_code;
  if (input.disposition === "succeeded" && reason !== null) {
    throw new Error('MH-06 evaluator: disposition "succeeded" must not carry a reason code');
  }
  if (input.disposition !== "succeeded" && reason === null) {
    throw new Error(`MH-06 evaluator: disposition "${input.disposition}" requires a reason code`);
  }
  return freezeDeep({
    schema_version: OUTCOME_ENVELOPE_SCHEMA,
    type: input.type,
    disposition: input.disposition,
    reason_code: reason,
    assertions: [...input.assertions],
    binding: { contract_version: OUTCOME_CONTRACT_VERSION },
    facts: { ...input.facts }
  });
}
function defineScenario(stableId, title, eventName, preconditions, outcomeAssertions, evidenceAssertions) {
  const expected = MH06_EXPECTED_OUTCOMES[stableId];
  return {
    stable_id: stableId,
    category: MH06_CATEGORY,
    title,
    preconditions: [...preconditions],
    action_event: { name: eventName, input: {} },
    expected_typed_outcome: {
      type: expected.type,
      disposition: expected.disposition,
      assertions: [...outcomeAssertions]
    },
    evidence_requirements: [{ profile: MH06_EVIDENCE_PROFILE, assertions: [...evidenceAssertions] }],
    implementation_wave_owner: MH06_WAVE_OWNER
  };
}
function makeProbePaths(parent, name) {
  const dir = path18.join(parent, name);
  fs14.mkdirSync(dir, { recursive: true });
  return { dir, journal: path18.join(dir, JOURNAL_LEAF), checkpoint: path18.join(dir, CHECKPOINT_LEAF) };
}
function probeInput(identity, runId, over) {
  const base = makeReceiptInput({
    run_id: runId,
    operation_id: "op-1",
    correlation_id: "corr-op-1",
    event_id: "evt-1",
    event_name: "receipt.append",
    outcome_type: "guild.receipt_outcome.v1",
    disposition: "succeeded",
    observation_state: "checked_clean",
    input_hash: `sha256:${"1".repeat(64)}`,
    output_hash: `sha256:${"2".repeat(64)}`,
    terminal: false,
    recorded_at: PROBE_RECORDED_AT,
    observed_at: PROBE_RECORDED_AT,
    versions: {
      host_id: identity.host_id,
      host_version: identity.host_version,
      runtime_version: identity.runtime_version,
      source_version: MH06_SOURCE_VERSION,
      contract_version: RECEIPT_CONTRACT_VERSION
    }
  });
  return { ...base, ...over };
}
function evidenceBindings(identity, runId, stableId, record) {
  return {
    scenario_id: stableId,
    run_id: runId,
    operation_id: record.operation_id,
    correlation_id: record.correlation_id,
    sequence: record.sequence,
    source_version: MH06_SOURCE_VERSION,
    runtime_version: identity.runtime_version,
    record_hash: record.record_hash
  };
}
function tornAppendIo(realIo, cutAfterBytes) {
  return {
    // Name every required method explicitly. Besides making the sabotage seam
    // honest under transpilers that do not preserve enumerable method
    // descriptors through object spread, this prevents a missing method from
    // surfacing later as an unrelated journal-authority failure.
    readAll: realIo.readAll,
    writeCheckpoint: realIo.writeCheckpoint,
    truncate: realIo.truncate,
    acquireLock: realIo.acquireLock,
    releaseLock: realIo.releaseLock,
    appendLine(journalPath2, text, bound) {
      realIo.appendLine(journalPath2, text.slice(0, cutAfterBytes), bound);
      throw new Error("receipt persistence was interrupted before the record was complete");
    }
  };
}
function layDownSealedJournal(port, paths, records, runId) {
  fs14.writeFileSync(paths.journal, `${records.map((record) => JSON.stringify(record)).join("\n")}
`, "utf8");
  const last = records[records.length - 1];
  const checkpoint = {};
  checkpoint["schema_version"] = CHECKPOINT_SCHEMA;
  checkpoint["run_id"] = runId;
  checkpoint["last_sequence"] = last.sequence;
  checkpoint["last_event_id"] = last.event_id;
  checkpoint["record_count"] = records.length;
  checkpoint["updated_at"] = last.recorded_at;
  checkpoint["contract_version"] = RECEIPT_CONTRACT_VERSION;
  fs14.writeFileSync(paths.checkpoint, `${JSON.stringify(checkpoint, null, 2)}
`, "utf8");
  const read = port.readCheckpointState(paths.checkpoint);
  if (read.state !== "present") {
    throw new Error(`the laid-down checkpoint reads "${read.state}" through the production reader`);
  }
}
function strictlyIncreasing(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) return false;
  }
  return true;
}
function allDistinct(values) {
  const seen = [];
  for (const value of values) {
    if (seen.indexOf(value) !== -1) return false;
    seen.push(value);
  }
  return true;
}
function probeAppendOrder(port, workspace, identity, runId) {
  const paths = makeProbePaths(workspace, PROBE_DIRS["MHRC-RCT-001"]);
  const appends = [1, 2, 3].map(
    (n) => port.appendReceipt(
      paths,
      probeInput(identity, runId, {
        scenario_id: "MHRC-RCT-001",
        operation_id: `op-${n}`,
        correlation_id: `corr-op-${n}`,
        event_id: `evt-${n}`,
        causation_id: n === 1 ? null : `evt-${n - 1}`
      })
    )
  );
  const lockPath2 = port.journalLockPath(paths);
  const lockFailure = port.acquireJournalLock(lockPath2, port.defaultJournalIo, {
    lock_max_attempts: 1,
    lock_wait_ms: 0
  });
  const contention = (() => {
    try {
      const attempted = port.appendReceipt(
        paths,
        probeInput(identity, runId, {
          scenario_id: "MHRC-RCT-001",
          operation_id: "op-4",
          correlation_id: "corr-op-4",
          event_id: "evt-4",
          causation_id: "evt-3"
        }),
        port.defaultJournalIo,
        { lock_max_attempts: 2, lock_wait_ms: 0 }
      );
      return { contended: attempted, underContention: port.scanReceiptJournal(paths.journal) };
    } finally {
      if (lockFailure === null) port.releaseJournalLock(lockPath2, port.defaultJournalIo);
    }
  })();
  const contended = contention.contended;
  const scan = port.scanReceiptJournal(paths.journal);
  const firstSequenceOf = {};
  for (const record of scan.records) {
    if (firstSequenceOf[record.event_id] === void 0) firstSequenceOf[record.event_id] = record.sequence;
  }
  const durable = appends.filter((outcome) => outcome.durable && outcome.record !== null);
  const sequences = durable.map((outcome) => outcome.sequence);
  const operations = durable.map((outcome) => outcome.operation_id);
  const causalOrder = scan.records.map((record) => ({
    event_id: record.event_id,
    sequence: record.sequence,
    causation_id: record.causation_id,
    cause_sequence: record.causation_id === null ? null : firstSequenceOf[record.causation_id] ?? null
  }));
  const last = durable.length === 0 ? null : durable[durable.length - 1];
  const lastRecord = last === null ? null : last.record;
  const observed = {
    ...evidenceBindings(identity, runId, "MHRC-RCT-001", {
      operation_id: last === null ? "" : last.operation_id,
      correlation_id: lastRecord === null ? "" : lastRecord.correlation_id,
      sequence: last === null || last.sequence === null ? 0 : last.sequence,
      record_hash: lastRecord === null ? "" : lastRecord.record_hash
    }),
    lock_acquired_by_competitor: lockFailure === null,
    durable_sequences: [...sequences],
    durable_operation_ids: [...operations],
    causal_order: causalOrder,
    journal_integrity: scan.integrity,
    record_count: scan.record_count,
    last_sequence: scan.last_sequence,
    duplicate_sequences: [...scan.duplicate_sequences],
    regressing_sequences: [...scan.regressing_sequences],
    order_violations: scan.order_violations.length,
    split_lineages: [...scan.split_lineages],
    run_ids: [...scan.run_ids],
    contended_append: {
      disposition: contended.disposition,
      durable: contended.durable,
      sequence: contended.sequence,
      failure_code: contended.failure === null ? null : contended.failure.code
    },
    record_count_after_contention: contention.underContention.record_count
  };
  const satisfied = sequences.length >= 3 && sequences[0] === 1 && strictlyIncreasing(sequences) && allDistinct(operations) && scan.duplicate_sequences.length === 0 && scan.regressing_sequences.length === 0 && scan.order_violations.length === 0 && scan.integrity === "intact" && scan.split_lineages.length === 0 && scan.run_ids.length === 1 && lockFailure === null && contended.disposition !== "succeeded" && contended.durable === false && contended.sequence === null && contended.failure !== null && contention.underContention.record_count === scan.record_count && causalOrder.every(
    (entry) => entry.causation_id === null || entry.cause_sequence !== null && entry.cause_sequence < entry.sequence
  );
  return { satisfied, observed };
}
function probeInterruptedAppend(port, workspace, identity, runId) {
  const paths = makeProbePaths(workspace, PROBE_DIRS["MHRC-RCT-002"]);
  const prior = port.appendReceipt(
    paths,
    probeInput(identity, runId, {
      scenario_id: "MHRC-RCT-002",
      operation_id: "op-1",
      correlation_id: "corr-op-1",
      event_id: "evt-1"
    })
  );
  const interrupted = port.appendReceipt(
    paths,
    probeInput(identity, runId, {
      scenario_id: "MHRC-RCT-002",
      operation_id: "op-2",
      correlation_id: "corr-op-2",
      event_id: "evt-2",
      causation_id: "evt-1"
    }),
    tornAppendIo(port.defaultJournalIo, TORN_APPEND_CUT_BYTES)
  );
  const post = port.scanReceiptJournal(paths.journal);
  const checkpoint = port.readCheckpointState(paths.checkpoint);
  const subsequent = port.appendReceipt(
    paths,
    probeInput(identity, runId, {
      scenario_id: "MHRC-RCT-002",
      operation_id: "op-3",
      correlation_id: "corr-op-3",
      event_id: "evt-3"
    })
  );
  const priorRecord = prior.record;
  const observed = {
    ...evidenceBindings(identity, runId, "MHRC-RCT-002", {
      operation_id: prior.operation_id,
      correlation_id: priorRecord === null ? "" : priorRecord.correlation_id,
      sequence: prior.sequence === null ? 0 : prior.sequence,
      record_hash: priorRecord === null ? "" : priorRecord.record_hash
    }),
    prior: { disposition: prior.disposition, durable: prior.durable, sequence: prior.sequence },
    interrupted: {
      disposition: interrupted.disposition,
      durable: interrupted.durable,
      sequence: interrupted.sequence,
      failure_code: interrupted.failure === null ? null : interrupted.failure.code,
      observation_state: interrupted.observation_state,
      blocks_dependent_completion: interrupted.blocks_dependent_completion
    },
    post_fault: {
      integrity: post.integrity,
      record_count: post.record_count,
      last_sequence: post.last_sequence,
      rejected: post.rejected.map((entry) => ({ line_number: entry.line_number, reason: entry.reason })),
      observation_state: post.observation_state,
      blocks_clean_close: post.blocks_clean_close
    },
    checkpoint_after_fault: {
      state: checkpoint.state,
      last_sequence: checkpoint.checkpoint === null ? null : checkpoint.checkpoint.last_sequence,
      record_count: checkpoint.checkpoint === null ? null : checkpoint.checkpoint.record_count,
      last_event_id: checkpoint.checkpoint === null ? null : checkpoint.checkpoint.last_event_id
    },
    subsequent_append: {
      disposition: subsequent.disposition,
      durable: subsequent.durable,
      failure_code: subsequent.failure === null ? null : subsequent.failure.code
    }
  };
  const satisfied = prior.durable === true && interrupted.disposition !== "succeeded" && interrupted.durable === false && interrupted.sequence === null && interrupted.failure !== null && post.record_count === 1 && post.last_sequence === prior.sequence && post.rejected.length >= 1 && post.integrity !== "intact" && post.blocks_clean_close === true && checkpoint.state === "present" && checkpoint.checkpoint !== null && checkpoint.checkpoint.last_sequence === prior.sequence && checkpoint.checkpoint.record_count === 1 && subsequent.disposition !== "succeeded" && subsequent.durable === false;
  return { satisfied, observed };
}
function probeObservationLoss(port, workspace, identity, runId) {
  const paths = makeProbePaths(workspace, PROBE_DIRS["MHRC-RCT-003"]);
  const absent = port.scanReceiptJournal(paths.journal);
  const recorded = port.appendReceipt(
    paths,
    probeInput(identity, runId, {
      scenario_id: "MHRC-RCT-003",
      operation_id: "op-observation-loss",
      correlation_id: "corr-op-observation-loss",
      event_id: "evt-observation-loss",
      disposition: "failed",
      observation_state: "observation_failed",
      affected_event_range: { from: 2, to: 4 },
      output_hash: null,
      observed_at: null
    })
  );
  const post = port.scanReceiptJournal(paths.journal);
  const record = recorded.record;
  const observed = {
    ...evidenceBindings(identity, runId, "MHRC-RCT-003", {
      operation_id: recorded.operation_id,
      correlation_id: record === null ? "" : record.correlation_id,
      sequence: recorded.sequence === null ? 0 : recorded.sequence,
      record_hash: record === null ? "" : record.record_hash
    }),
    absent_journal: {
      integrity: absent.integrity,
      observation_state: absent.observation_state,
      blocks_clean_close: absent.blocks_clean_close,
      record_count: absent.record_count
    },
    recorded: {
      disposition: recorded.disposition,
      durable: recorded.durable,
      observation_state: recorded.observation_state,
      blocks_dependent_completion: recorded.blocks_dependent_completion,
      affected_event_range: record === null ? null : record.affected_event_range
    },
    post: {
      integrity: post.integrity,
      observation_state: post.observation_state,
      blocks_clean_close: post.blocks_clean_close,
      record_count: post.record_count
    }
  };
  const range = record === null ? null : record.affected_event_range;
  const satisfied = absent.observation_state === "not_observed" && absent.blocks_clean_close === true && recorded.durable === true && recorded.disposition !== "succeeded" && recorded.observation_state === "observation_failed" && recorded.blocks_dependent_completion === true && range !== null && Number.isInteger(range.from) && Number.isInteger(range.to) && range.from >= 1 && range.from <= range.to && post.observation_state === "observation_failed" && post.blocks_clean_close === true;
  return { satisfied, observed };
}
function probeSequenceGaps(port, workspace, identity, runId) {
  const paths = makeProbePaths(workspace, PROBE_DIRS["MHRC-RCT-004"]);
  const seal = (sequence) => port.sealReceiptRecord({
    ...probeInput(identity, runId, {
      scenario_id: "MHRC-RCT-004",
      operation_id: `op-${sequence}`,
      correlation_id: `corr-op-${sequence}`,
      event_id: `evt-${sequence}`
    }),
    sequence
  });
  layDownSealedJournal(port, paths, [seal(1), seal(3), seal(5)], runId);
  const offered = seal(2);
  const out = port.reconcileReceiptJournal({
    journalPath: paths.journal,
    checkpointPath: paths.checkpoint,
    run_id: runId,
    producerCheckpoint: { last_sequence: 5, record_count: 5 },
    reconciled_at: PROBE_RECONCILED_AT,
    recovered: [offered]
  });
  const placed = out.reconciled_order.find((entry) => entry.sequence === offered.sequence);
  const offeredIdentity = {
    sequence: offered.sequence,
    event_id: offered.event_id,
    operation_id: offered.operation_id,
    correlation_id: offered.correlation_id
  };
  const recoveredIdentity = placed === void 0 ? null : {
    sequence: placed.sequence,
    event_id: placed.event_id,
    operation_id: placed.event_id === offered.event_id ? offered.operation_id : null,
    correlation_id: placed.event_id === offered.event_id ? offered.correlation_id : null
  };
  const observed = {
    ...evidenceBindings(identity, runId, "MHRC-RCT-004", {
      operation_id: offered.operation_id,
      correlation_id: offered.correlation_id,
      sequence: offered.sequence,
      record_hash: offered.record_hash
    }),
    disposition: out.disposition,
    gaps: out.gaps.map((gap) => ({
      from: gap.from,
      to: gap.to,
      recovered: gap.recovered,
      observation_state: gap.observation_state
    })),
    recovered_sequences: [...out.recovered_sequences],
    unresolved_sequences: [...out.unresolved_sequences],
    rejected_recoveries: out.rejected_recoveries.map((entry) => ({
      sequence: entry.sequence,
      event_id: entry.event_id,
      reason: entry.reason
    })),
    reconciled_order: out.reconciled_order.map((entry) => ({ sequence: entry.sequence, event_id: entry.event_id })),
    offered_identity: offeredIdentity,
    recovered_identity: recoveredIdentity,
    checkpoint_before: {
      state: out.checkpoint_before_state,
      last_sequence: out.checkpoint_before === null ? null : out.checkpoint_before.last_sequence,
      record_count: out.checkpoint_before === null ? null : out.checkpoint_before.record_count,
      last_event_id: out.checkpoint_before === null ? null : out.checkpoint_before.last_event_id
    },
    checkpoint_after: {
      last_sequence: out.checkpoint_after.last_sequence,
      record_count: out.checkpoint_after.record_count,
      last_event_id: out.checkpoint_after.last_event_id
    },
    checkpoint_disagreements: out.checkpoint_disagreements.map((entry) => ({
      code: entry.code,
      expected: entry.expected,
      actual: entry.actual
    })),
    blocks_clean_close: out.blocks_clean_close,
    merged_observation_state: out.merged_observation_state,
    merged_integrity: out.merged_integrity
  };
  const inGap = (sequence, recovered) => out.gaps.some((gap) => gap.recovered === recovered && sequence >= gap.from && sequence <= gap.to);
  const satisfied = out.disposition === "degraded" && out.gaps.length >= 1 && out.gaps.every((gap) => Number.isInteger(gap.from) && Number.isInteger(gap.to) && gap.from <= gap.to) && out.gaps.every((gap) => gap.recovered === true || gap.observation_state === "not_observed") && out.recovered_sequences.length >= 1 && out.unresolved_sequences.length >= 1 && out.recovered_sequences.every((sequence) => out.unresolved_sequences.indexOf(sequence) === -1) && out.recovered_sequences.every((sequence) => inGap(sequence, true)) && out.unresolved_sequences.every((sequence) => inGap(sequence, false)) && out.rejected_recoveries.length === 0 && strictlyIncreasing(out.reconciled_order.map((entry) => entry.sequence)) && out.recovered_sequences.every(
    (sequence) => out.reconciled_order.some((entry) => entry.sequence === sequence)
  ) && recoveredIdentity !== null && recoveredIdentity.event_id === offeredIdentity.event_id && recoveredIdentity.sequence === offeredIdentity.sequence && recoveredIdentity.operation_id === offeredIdentity.operation_id && recoveredIdentity.correlation_id === offeredIdentity.correlation_id && out.checkpoint_before_state === "present" && out.checkpoint_before !== null && out.checkpoint_after.record_count > out.checkpoint_before.record_count && out.blocks_clean_close === true;
  return { satisfied, observed };
}
function probeDuplicateDelivery(port, workspace, identity, runId) {
  const paths = makeProbePaths(workspace, PROBE_DIRS["MHRC-RCT-005"]);
  const seal = (sequence, eventId, over = {}) => port.sealReceiptRecord({
    ...probeInput(identity, runId, {
      scenario_id: "MHRC-RCT-005",
      operation_id: "op-duplicated",
      correlation_id: "corr-op-duplicated",
      event_id: eventId,
      ...over
    }),
    sequence
  });
  const first = seal(1, "evt-delivery-a");
  const second = seal(2, "evt-delivery-b");
  layDownSealedJournal(port, paths, [first, second], runId);
  const out = port.reconcileReceiptJournal({
    journalPath: paths.journal,
    checkpointPath: paths.checkpoint,
    run_id: runId,
    producerCheckpoint: { last_sequence: 2, record_count: 2 },
    reconciled_at: PROBE_RECONCILED_AT
  });
  const mismatchPaths = makeProbePaths(paths.dir, "payload-mismatch");
  const conflicting = seal(2, "evt-delivery-c", { input_hash: `sha256:${"3".repeat(64)}` });
  layDownSealedJournal(port, mismatchPaths, [first, conflicting], runId);
  const mismatch = port.reconcileReceiptJournal({
    journalPath: mismatchPaths.journal,
    checkpointPath: mismatchPaths.checkpoint,
    run_id: runId,
    producerCheckpoint: { last_sequence: 2, record_count: 2 },
    reconciled_at: PROBE_RECONCILED_AT
  });
  const observed = {
    ...evidenceBindings(identity, runId, "MHRC-RCT-005", {
      operation_id: first.operation_id,
      correlation_id: first.correlation_id,
      sequence: first.sequence,
      record_hash: first.record_hash
    }),
    disposition: out.disposition,
    duplicates: out.duplicates.map((group) => ({
      operation_id: group.operation_id,
      event_ids: [...group.event_ids],
      authoritative_event_id: group.authoritative_event_id,
      payload_hash: group.payload_hash,
      effects_applied: group.effects_applied
    })),
    conflicts: out.conflicts.map((group) => ({
      operation_id: group.operation_id,
      payload_hashes: [...group.payload_hashes],
      reason: group.reason
    })),
    event_identity_conflicts: out.event_identity_conflicts.map((entry) => ({
      event_id: entry.event_id,
      sequences: [...entry.sequences]
    })),
    authoritative_effect_count: out.authoritative_effect_count,
    blocks_clean_close: out.blocks_clean_close,
    mismatch_probe: {
      disposition: mismatch.disposition,
      duplicates: mismatch.duplicates.length,
      conflicts: mismatch.conflicts.map((group) => ({
        operation_id: group.operation_id,
        payload_hashes: [...group.payload_hashes],
        reason: group.reason
      })),
      blocks_clean_close: mismatch.blocks_clean_close
    }
  };
  const satisfied = out.disposition === "succeeded" && out.duplicates.length === 1 && out.duplicates.every(
    (group) => group.operation_id.length > 0 && group.payload_hash.length > 0 && group.event_ids.length >= 2 && allDistinct(group.event_ids) && group.event_ids.indexOf(group.authoritative_event_id) !== -1 && group.effects_applied === 1
  ) && out.authoritative_effect_count === 1 && out.conflicts.length === 0 && out.event_identity_conflicts.length === 0 && out.blocks_clean_close === false && mismatch.disposition !== "succeeded" && mismatch.conflicts.length >= 1 && mismatch.conflicts.every(
    (group) => group.reason === "payload_hash_mismatch" && group.payload_hashes.length >= 2 && allDistinct(group.payload_hashes)
  ) && mismatch.blocks_clean_close === true;
  return { satisfied, observed };
}
function refuseEvaluation(control, reasonCode, assertions) {
  return {
    outcome: evaluationOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "refused",
      reason_code: reasonCode,
      assertions,
      facts: {
        refusal_control: control,
        owner_key: MH06_OWNER_KEY,
        suite_id: MH06_SUITE_ID,
        suite_version: MH06_SUITE_VERSION,
        evidence: []
      }
    }),
    packet: null
  };
}
function identityIsComplete3(identity) {
  if (identity === null || typeof identity !== "object") return false;
  const record = identity;
  for (const field of EVIDENCE_IDENTITY_FIELDS) {
    const value = record[field];
    if (field === "contract_version") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}
function isExistingDirectory(target) {
  try {
    return fs14.statSync(target).isDirectory();
  } catch {
    return false;
  }
}
function removeQuietly(target) {
  try {
    fs14.rmSync(target, { recursive: true, force: true });
  } catch {
  }
}
function evaluateReceiptJournalConformance(request) {
  if (request === null || typeof request !== "object") {
    return refuseEvaluation(MH06_REFUSAL_CONTROLS.journalRootUnusable, "scenario_evidence_incomplete", [
      "a request that is not a record names no journal root, and evaluation writes journals"
    ]);
  }
  if ("stable_ids" in request) {
    return refuseEvaluation(MH06_REFUSAL_CONTROLS.callerSuppliedIds, "scenario_required_set_mismatch", [
      "the covered scenario set has exactly one source, and it is this module",
      "an agreeing caller-supplied set is refused too, because accepting a matching copy accepts the channel"
    ]);
  }
  if ("results" in request) {
    return refuseEvaluation(MH06_REFUSAL_CONTROLS.callerSuppliedResults, SCENARIO_RESULT_MISMATCH, [
      "result truth is produced by executing the journal, never accepted from the caller",
      "a fixture package offered in place of execution is the false-conformance shortcut this refusal exists for"
    ]);
  }
  if (!identityIsComplete3(request.evidence_identity)) {
    return refuseEvaluation(MH06_REFUSAL_CONTROLS.identityIncomplete, "scenario_evidence_incomplete", [
      "evidence that names no complete identity is bound to no runtime"
    ]);
  }
  for (const stableId of MH06_SCENARIO_IDS) {
    const receiptRef = request.receipt_refs === void 0 ? void 0 : request.receipt_refs[stableId];
    const freshness = request.evidence_freshness === void 0 ? void 0 : request.evidence_freshness[stableId];
    if (typeof receiptRef !== "string" || receiptRef.length === 0) {
      return refuseEvaluation(
        MH06_REFUSAL_CONTROLS.evidenceBindingMissing,
        "scenario_receipt_reference_missing",
        ["every scenario result commits to a receipt reference"]
      );
    }
    if (typeof freshness !== "string" || EVIDENCE_FRESHNESS_VERDICTS.indexOf(freshness) === -1) {
      return refuseEvaluation(MH06_REFUSAL_CONTROLS.evidenceBindingMissing, "scenario_evidence_incomplete", [
        "every scenario result carries a typed freshness verdict"
      ]);
    }
  }
  const root = request.journal_root;
  const usableRoot = typeof root === "string" && root.length > 0 && path18.isAbsolute(root) && isExistingDirectory(root);
  if (!usableRoot) {
    return refuseEvaluation(MH06_REFUSAL_CONTROLS.journalRootUnusable, "scenario_evidence_incomplete", [
      "conformance evaluation writes journals, so it requires an absolute, existing, disposable root",
      "it never falls back to a directory of its own choosing"
    ]);
  }
  const port = request.journal === void 0 ? MH06_PRODUCTION_JOURNAL : request.journal;
  const identity = request.evidence_identity;
  const workspace = fs14.mkdtempSync(path18.join(root, PROBE_WORKSPACE_PREFIX));
  const verdicts = {};
  try {
    for (const stableId of MH06_SCENARIO_IDS) {
      verdicts[stableId] = PROBES[stableId](port, workspace, identity, request.run_id);
    }
  } finally {
    removeQuietly(workspace);
  }
  const evidence = MH06_SCENARIO_IDS.map((stableId) => ({
    stable_id: stableId,
    satisfied: verdicts[stableId].satisfied,
    observed: verdicts[stableId].observed
  }));
  const results = MH06_SCENARIO_IDS.map((stableId) => {
    const expected = MH06_EXPECTED_OUTCOMES[stableId];
    const satisfied = verdicts[stableId].satisfied;
    return {
      stable_id: stableId,
      outcome_type: expected.type,
      disposition: satisfied ? expected.disposition : "failed",
      reason_code: satisfied ? expected.reason_code : SCENARIO_RESULT_MISMATCH,
      receipt_ref: request.receipt_refs[stableId],
      evidence_identity: { ...identity },
      evidence_freshness: request.evidence_freshness[stableId]
    };
  });
  const allSatisfied = MH06_SCENARIO_IDS.every((stableId) => verdicts[stableId].satisfied);
  const packet = {
    schema_version: MH06_PACKET_SCHEMA,
    suite_id: MH06_SUITE_ID,
    suite_version: MH06_SUITE_VERSION,
    owner_key: MH06_OWNER_KEY,
    evidence_identity: { ...identity },
    stable_ids: [...MH06_SCENARIO_IDS],
    results
  };
  return {
    outcome: evaluationOutcome({
      type: "guild.receipt_outcome.v1",
      disposition: allSatisfied ? "succeeded" : "failed",
      reason_code: allSatisfied ? null : SCENARIO_RESULT_MISMATCH,
      assertions: [
        "each of the five W1/MH-06 scenarios was evaluated by executing the real receipt journal",
        "an interrupted append never reports durable success, and a torn tail is never parsed as a record",
        "a missing observation is never checked_clean, and every gap is bounded and classified",
        "one operation id and payload hash remains one logical receipt with one effect",
        "no promotion, release, signature, or policy decision happens here"
      ],
      facts: {
        owner_key: MH06_OWNER_KEY,
        suite_id: MH06_SUITE_ID,
        suite_version: MH06_SUITE_VERSION,
        evidence
      }
    }),
    packet: freezeDeep(packet)
  };
}
var fs14, path18, OUTCOME_ENVELOPE_SCHEMA, OUTCOME_CONTRACT_VERSION, MH06_SUITE_ID, MH06_SUITE_VERSION, MH06_OWNER_KEY, MH06_PACKET_SCHEMA, MH06_SCENARIO_IDS, MH06_CATEGORY, MH06_EVIDENCE_PROFILE, MH06_EXPECTED_OUTCOMES, SCENARIO_RESULT_MISMATCH, EVIDENCE_FRESHNESS_VERDICTS, EVIDENCE_IDENTITY_FIELDS, MH06_WAVE_OWNER, MH06_SCENARIOS, MH06_PRODUCTION_JOURNAL, MH06_REFUSAL_CONTROLS, MH06_SOURCE_VERSION, PROBE_RECORDED_AT, PROBE_RECONCILED_AT, PROBE_WORKSPACE_PREFIX, TORN_APPEND_CUT_BYTES, PROBE_DIRS, JOURNAL_LEAF, CHECKPOINT_LEAF, CHECKPOINT_SCHEMA, PROBES;
var init_receipt_journal_conformance_evaluator = __esm({
  "../src/modules/telemetry/workflows/receipt-journal-conformance-evaluator.ts"() {
    fs14 = __toESM(require("node:fs"));
    path18 = __toESM(require("node:path"));
    init_receipt_journal();
    init_receipt_reconcile();
    OUTCOME_ENVELOPE_SCHEMA = "guild.runtime.contracts.v1";
    OUTCOME_CONTRACT_VERSION = 1;
    MH06_SUITE_ID = "guild.conformance_scenarios.v1";
    MH06_SUITE_VERSION = "1.0.0";
    MH06_OWNER_KEY = "W1/MH-06";
    MH06_PACKET_SCHEMA = "guild.conformance_owner_packet.v1";
    MH06_SCENARIO_IDS = Object.freeze([
      "MHRC-RCT-001",
      "MHRC-RCT-002",
      "MHRC-RCT-003",
      "MHRC-RCT-004",
      "MHRC-RCT-005"
    ]);
    MH06_CATEGORY = "receipt_integrity";
    MH06_EVIDENCE_PROFILE = "E-RECEIPT";
    MH06_EXPECTED_OUTCOMES = Object.freeze({
      "MHRC-RCT-001": { type: "guild.receipt_outcome.v1", disposition: "succeeded", reason_code: null },
      "MHRC-RCT-002": { type: "guild.receipt_outcome.v1", disposition: "failed", reason_code: "execution_failed" },
      "MHRC-RCT-003": {
        type: "guild.receipt_outcome.v1",
        disposition: "failed",
        reason_code: "required_observation_failed"
      },
      "MHRC-RCT-004": {
        type: "guild.reconciliation_outcome.v1",
        disposition: "degraded",
        reason_code: "required_observation_missing"
      },
      "MHRC-RCT-005": { type: "guild.reconciliation_outcome.v1", disposition: "succeeded", reason_code: null }
    });
    SCENARIO_RESULT_MISMATCH = "scenario_result_mismatch";
    EVIDENCE_FRESHNESS_VERDICTS = Object.freeze(["fresh", "stale", "unknown"]);
    EVIDENCE_IDENTITY_FIELDS = Object.freeze([
      "source_commit",
      "package_hash",
      "runtime_version",
      "adapter_version",
      "host_id",
      "host_version",
      "platform",
      "contract_version",
      "scenario_suite_id",
      "scenario_suite_version",
      "release_id"
    ]);
    MH06_WAVE_OWNER = Object.freeze({ wave_id: "W1", work_item_id: "MH-06", key: MH06_OWNER_KEY });
    MH06_SCENARIOS = Object.freeze(freezeDeep([
      defineScenario(
        "MHRC-RCT-001",
        "Receipt journal preserves total logical order",
        "receipt.append",
        [
          "one run emits multiple operations",
          "each operation has stable operation and correlation ids",
          "the journal starts from a known checkpoint"
        ],
        [
          "every durable append takes a unique, strictly increasing sequence",
          "cause precedes effect in the recovered logical order",
          "a writer without exclusive access claims no sequence at all"
        ],
        ["every observation is bound to the durable journal entry it was taken from"]
      ),
      defineScenario(
        "MHRC-RCT-002",
        "Interrupted append never produces a valid partial receipt",
        "receipt.append",
        ["a prior valid journal checkpoint exists", "receipt persistence is interrupted before atomic replacement"],
        [
          "an interrupted append reports no durable evidence and no sequence",
          "the torn bytes are rejected, never parsed into a record",
          "the checkpoint still describes exactly the prior durable state"
        ],
        ["the rejected line and the surviving checkpoint are both cited"]
      ),
      defineScenario(
        "MHRC-RCT-003",
        "Observation loss is explicit",
        "receipt.append",
        ["a required event source becomes unavailable", "the lifecycle decision depends on that observation"],
        [
          "an unobserved journal is never read as checked_clean",
          "the loss is durably recorded and blocks dependent completion",
          "the affected sequence range is bounded, not alluded to"
        ],
        ["the durable observation-failure record and its affected range are cited"]
      ),
      defineScenario(
        "MHRC-RCT-004",
        "Reconciliation detects and classifies sequence gaps",
        "receipt.reconcile",
        [
          "the journal and producer checkpoint disagree",
          "the expected sequence range is known",
          "operation identities are stable"
        ],
        [
          "every gap is bounded and classified recovered or unresolved",
          "a recovered entry keeps the identity it was offered under",
          "an unresolved gap blocks a clean close"
        ],
        ["the checkpoint pair either side of reconciliation is cited"]
      ),
      defineScenario(
        "MHRC-RCT-005",
        "Duplicate delivery is idempotent",
        "receipt.reconcile",
        ["the same operation receipt is delivered more than once", "operation id and payload hash are identical"],
        [
          "one operation id and payload hash stays one logical receipt with one effect",
          "the dedup cites the operation id and the payload hash it grouped on",
          "the same id carrying a different payload is a conflict, never a duplicate"
        ],
        ["the duplicate group and the payload-mismatch probe are both cited"]
      )
    ]));
    MH06_PRODUCTION_JOURNAL = Object.freeze({
      get appendReceipt() {
        return appendReceipt;
      },
      get scanReceiptJournal() {
        return scanReceiptJournal;
      },
      get reconcileReceiptJournal() {
        return reconcileReceiptJournal;
      },
      get sealReceiptRecord() {
        return sealReceiptRecord;
      },
      get readCheckpointState() {
        return readCheckpointState;
      },
      get journalLockPath() {
        return journalLockPath;
      },
      get acquireJournalLock() {
        return acquireJournalLock;
      },
      get releaseJournalLock() {
        return releaseJournalLock;
      },
      get defaultJournalIo() {
        return defaultJournalIo;
      }
    });
    MH06_REFUSAL_CONTROLS = Object.freeze({
      callerSuppliedIds: "caller_supplied_scenario_ids",
      callerSuppliedResults: "caller_supplied_results",
      identityIncomplete: "evidence_identity_incomplete",
      evidenceBindingMissing: "evidence_binding_missing",
      journalRootUnusable: "journal_root_unusable"
    });
    MH06_SOURCE_VERSION = "guild.mh06.receipt-conformance.v1";
    PROBE_RECORDED_AT = "2026-01-01T00:00:00.000Z";
    PROBE_RECONCILED_AT = "2026-01-01T00:00:05.000Z";
    PROBE_WORKSPACE_PREFIX = "mh06-eval-";
    TORN_APPEND_CUT_BYTES = 40;
    PROBE_DIRS = Object.freeze({
      "MHRC-RCT-001": "rct001",
      "MHRC-RCT-002": "rct002",
      "MHRC-RCT-003": "rct003",
      "MHRC-RCT-004": "rct004",
      "MHRC-RCT-005": "rct005"
    });
    JOURNAL_LEAF = "journal-lines";
    CHECKPOINT_LEAF = "checkpoint-state";
    CHECKPOINT_SCHEMA = "guild.receipt_checkpoint.v1";
    PROBES = Object.freeze({
      "MHRC-RCT-001": probeAppendOrder,
      "MHRC-RCT-002": probeInterruptedAppend,
      "MHRC-RCT-003": probeObservationLoss,
      "MHRC-RCT-004": probeSequenceGaps,
      "MHRC-RCT-005": probeDuplicateDelivery
    });
  }
});

// ../src/modules/telemetry/workflows/guild-trace-events.ts
function validateBase(ev) {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: "event must be a non-null object" };
  }
  const e = ev;
  if (typeof e["schema_version"] !== "string" || e["schema_version"] === "") {
    return { ok: false, reason: "schema_version must be a non-empty string" };
  }
  if (!GUILD_TRACE_SCHEMA_VERSIONS.includes(e["schema_version"])) {
    return { ok: false, reason: `unknown schema_version: ${e["schema_version"]}` };
  }
  if (typeof e["ts"] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(e["ts"])) {
    return { ok: false, reason: "ts must be an ISO-8601 timestamp string" };
  }
  if (typeof e["run_id"] !== "string" || e["run_id"] === "") {
    return { ok: false, reason: "run_id must be a non-empty string" };
  }
  if (typeof e["lane_id"] !== "string") {
    return { ok: false, reason: "lane_id must be a string (empty string for lead session)" };
  }
  return { ok: true };
}
function validateDispatchEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.dispatch.v1") {
    return { ok: false, reason: `wrong schema_version for dispatch: ${e["schema_version"]}` };
  }
  if (typeof e["specialist"] !== "string" || e["specialist"] === "") {
    return { ok: false, reason: "specialist must be a non-empty string" };
  }
  if (typeof e["phase"] !== "string" || e["phase"] === "") {
    return { ok: false, reason: "phase must be a non-empty string" };
  }
  if (typeof e["task_id"] !== "string" || e["task_id"] === "") {
    return { ok: false, reason: "task_id must be a non-empty string" };
  }
  if (!DISPATCH_BACKENDS.includes(e["backend"])) {
    return { ok: false, reason: `backend must be one of: ${DISPATCH_BACKENDS.join(", ")}` };
  }
  if (typeof e["backend_rung"] !== "number" || e["backend_rung"] < 0 || e["backend_rung"] > 4) {
    return { ok: false, reason: "backend_rung must be a number 0-4" };
  }
  if (typeof e["dispatched_at"] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(e["dispatched_at"])) {
    return { ok: false, reason: "dispatched_at must be an ISO-8601 timestamp string" };
  }
  for (const optKey of ["attribution_specialist", "pane_id", "pane_target", "pane_backend"]) {
    if (e[optKey] === void 0) continue;
    if (typeof e[optKey] !== "string" || e[optKey] === "") {
      return { ok: false, reason: `${optKey}, when present, must be a non-empty string` };
    }
  }
  if (e["pane_backend"] !== void 0) {
    if (e["backend"] !== "unknown") {
      return {
        ok: false,
        reason: `pane_backend is only for a surface the backend enum cannot name; it must not accompany backend "${e["backend"]}"`
      };
    }
    if (e["backend_rung"] < 1) {
      return {
        ok: false,
        reason: "pane_backend marks a CONFIRMED dispatch, so backend_rung must be >= 1"
      };
    }
  }
  return { ok: true };
}
function validateRecallEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.recall.v1") {
    return { ok: false, reason: `wrong schema_version for recall: ${e["schema_version"]}` };
  }
  if (typeof e["query"] !== "string" || e["query"] === "") {
    return { ok: false, reason: "query must be a non-empty string" };
  }
  if (!RECALL_BRANCHES.includes(e["branch"])) {
    return { ok: false, reason: `branch must be one of: ${RECALL_BRANCHES.join(", ")}` };
  }
  if (typeof e["chunk_count"] !== "number" || e["chunk_count"] < 0) {
    return { ok: false, reason: "chunk_count must be a non-negative number" };
  }
  if (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0) {
    return { ok: false, reason: "duration_ms must be a non-negative number" };
  }
  if (typeof e["had_quarantine"] !== "boolean") {
    return { ok: false, reason: "had_quarantine must be a boolean" };
  }
  if (typeof e["cwd_redacted"] !== "string") {
    return { ok: false, reason: "cwd_redacted must be a string" };
  }
  return { ok: true };
}
function validateRecallDecisionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.recall_decision.v1") {
    return { ok: false, reason: `wrong schema_version for recall_decision: ${e["schema_version"]}` };
  }
  if (typeof e["query_hash"] !== "string" || !/^[0-9a-f]{16}$/.test(e["query_hash"])) {
    return { ok: false, reason: "query_hash must be exactly 16 lowercase hex chars (sha256[:16])" };
  }
  if (typeof e["query_preview"] !== "string") {
    return { ok: false, reason: "query_preview must be a string (may be empty)" };
  }
  if (e["query_preview"].length > 60) {
    return { ok: false, reason: "query_preview must be <= 60 chars (no raw-query leak)" };
  }
  if (!RECALL_BRANCHES.includes(e["branch"])) {
    return { ok: false, reason: `branch must be one of: ${RECALL_BRANCHES.join(", ")}` };
  }
  if (typeof e["top_score"] !== "number" || e["top_score"] < 0 || !isFinite(e["top_score"])) {
    return { ok: false, reason: "top_score must be a finite number >= 0" };
  }
  if (typeof e["threshold"] !== "number" || e["threshold"] < 0 || !isFinite(e["threshold"])) {
    return { ok: false, reason: "threshold must be a finite number >= 0" };
  }
  if (typeof e["read_skip_fired"] !== "boolean") {
    return { ok: false, reason: "read_skip_fired must be a boolean" };
  }
  if (typeof e["chunk_count"] !== "number" || e["chunk_count"] < 0) {
    return { ok: false, reason: "chunk_count must be a non-negative number" };
  }
  if (typeof e["scored"] !== "boolean") {
    return { ok: false, reason: "scored must be a boolean" };
  }
  if (!LANE_OUTCOMES.includes(e["lane_outcome"])) {
    return { ok: false, reason: `lane_outcome must be one of: ${LANE_OUTCOMES.join(", ")}` };
  }
  return { ok: true };
}
function validateConfigResolutionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.config_resolution.v1") {
    return { ok: false, reason: `wrong schema_version for config_resolution: ${e["schema_version"]}` };
  }
  if (typeof e["rigor"] !== "string" || e["rigor"] === "") {
    return { ok: false, reason: "rigor must be a non-empty string" };
  }
  if (typeof e["agent_mode"] !== "string" || e["agent_mode"] === "") {
    return { ok: false, reason: "agent_mode must be a non-empty string" };
  }
  if (typeof e["layers"] !== "object" || e["layers"] === null) {
    return { ok: false, reason: "layers must be an object" };
  }
  const layers = e["layers"];
  for (const boolKey of ["workspace", "workspace_local", "project", "project_local", "cli"]) {
    if (typeof layers[boolKey] !== "boolean") {
      return { ok: false, reason: `layers.${boolKey} must be a boolean` };
    }
  }
  if (layers["rigor"] !== null && typeof layers["rigor"] !== "string") {
    return { ok: false, reason: "layers.rigor must be a string or null" };
  }
  if (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0) {
    return { ok: false, reason: "duration_ms must be a non-negative number" };
  }
  if (typeof e["config_fingerprint"] !== "string" || e["config_fingerprint"] === "") {
    return { ok: false, reason: "config_fingerprint must be a non-empty string" };
  }
  return { ok: true };
}
function validateSecurityDecisionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.security_decision.v1") {
    return { ok: false, reason: `wrong schema_version for security_decision: ${e["schema_version"]}` };
  }
  if (typeof e["tool_name"] !== "string" || e["tool_name"] === "") {
    return { ok: false, reason: "tool_name must be a non-empty string" };
  }
  if (!SECURITY_OUTCOMES.includes(e["decision"])) {
    return { ok: false, reason: `decision must be one of: ${SECURITY_OUTCOMES.join(", ")}` };
  }
  if (typeof e["bypass_mode"] !== "boolean") {
    return { ok: false, reason: "bypass_mode must be a boolean" };
  }
  if (typeof e["policy_forced"] !== "boolean") {
    return { ok: false, reason: "policy_forced must be a boolean" };
  }
  if (typeof e["autonomy_mode"] !== "string" || e["autonomy_mode"] === "") {
    return { ok: false, reason: "autonomy_mode must be a non-empty string" };
  }
  if (!["env", "file", "none"].includes(e["scope_source"])) {
    return { ok: false, reason: "scope_source must be 'env', 'file', or 'none'" };
  }
  return { ok: true };
}
function validateDegradationEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.degradation.v1") {
    return { ok: false, reason: `wrong schema_version for degradation: ${e["schema_version"]}` };
  }
  if (!DEGRADATION_SURFACES.includes(e["surface"])) {
    return { ok: false, reason: `surface must be one of: ${DEGRADATION_SURFACES.join(", ")}` };
  }
  if (typeof e["reason"] !== "string" || e["reason"] === "") {
    return { ok: false, reason: "reason must be a non-empty string" };
  }
  if (typeof e["attempted"] !== "string" || e["attempted"] === "") {
    return { ok: false, reason: "attempted must be a non-empty string" };
  }
  if (typeof e["fallback"] !== "string" || e["fallback"] === "") {
    return { ok: false, reason: "fallback must be a non-empty string" };
  }
  if (!["warn", "error"].includes(e["severity"])) {
    return { ok: false, reason: "severity must be 'warn' or 'error'" };
  }
  return { ok: true };
}
function validateModelInspectionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.model_inspection.v1") {
    return { ok: false, reason: `wrong schema_version for model_inspection: ${e["schema_version"]}` };
  }
  for (const key of ["host_family", "host_surface", "identity_trust", "catalog_state", "actual_model", "independence"]) {
    if (typeof e[key] !== "string" || e[key] === "") {
      return { ok: false, reason: `${key} must be a non-empty string` };
    }
  }
  if (e["selection_model"] !== null && (typeof e["selection_model"] !== "string" || e["selection_model"] === "")) {
    return { ok: false, reason: "selection_model must be a non-empty string or null" };
  }
  if (typeof e["unknowns_count"] !== "number" || e["unknowns_count"] < 0 || !Number.isInteger(e["unknowns_count"])) {
    return { ok: false, reason: "unknowns_count must be a non-negative integer" };
  }
  return { ok: true };
}
function validateAnalysisTraceEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.analysis.v2") {
    return { ok: false, reason: `wrong schema_version for analysis trace: ${e["schema_version"]}` };
  }
  if (!ANALYSIS_EVENT_CLASSES.includes(e["event_class"])) {
    return { ok: false, reason: `unknown analysis event_class: ${e["event_class"]}` };
  }
  if (!["lead", "agent", "user", "tool", "system"].includes(e["actor_type"])) {
    return { ok: false, reason: "actor_type must be lead|agent|user|tool|system" };
  }
  if (typeof e["actor_id"] !== "string" || e["actor_id"] === "") {
    return { ok: false, reason: "actor_id must be a non-empty string" };
  }
  if (!["ok", "error", "denied", "incomplete", "unknown"].includes(e["status"])) {
    return { ok: false, reason: "status must be ok|error|denied|incomplete|unknown" };
  }
  const allowedKeys = /* @__PURE__ */ new Set([
    "schema_version",
    "ts",
    "run_id",
    "lane_id",
    "event_class",
    "actor_type",
    "actor_id",
    "status",
    "span_id",
    "parent_span_id",
    "phase",
    "task_id",
    "initiative_id",
    "run_scope",
    "prompt_hash",
    "payload_ref",
    "redaction",
    "duration_ms",
    "tokens",
    "config_snapshot_ref",
    "signature"
  ]);
  for (const key of Object.keys(e)) {
    if (!allowedKeys.has(key)) return { ok: false, reason: `unknown analysis field: ${key}` };
  }
  if (e["run_scope"] !== void 0 && !["initiative", "independent"].includes(e["run_scope"])) {
    return { ok: false, reason: "run_scope must be initiative|independent when present" };
  }
  if (e["duration_ms"] !== void 0 && (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0)) {
    return { ok: false, reason: "duration_ms must be a non-negative number when present" };
  }
  for (const key of ["span_id", "parent_span_id", "phase", "task_id", "initiative_id", "prompt_hash", "payload_ref", "config_snapshot_ref", "signature"]) {
    if (e[key] !== void 0 && (typeof e[key] !== "string" || e[key] === "")) {
      return { ok: false, reason: `${key} must be a non-empty string when present` };
    }
  }
  if (e["redaction"] !== void 0 && !["none", "redacted", "omitted"].includes(e["redaction"])) {
    return { ok: false, reason: "redaction must be none|redacted|omitted when present" };
  }
  if (e["tokens"] !== void 0) {
    if (typeof e["tokens"] !== "object" || e["tokens"] === null || Array.isArray(e["tokens"])) {
      return { ok: false, reason: "tokens must be an object when present" };
    }
    for (const [key, value] of Object.entries(e["tokens"])) {
      if (!["input", "output", "cached", "cost_usd"].includes(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return { ok: false, reason: `tokens.${key} must be a non-negative finite number` };
      }
    }
  }
  const eventClass = e["event_class"];
  if (eventClass === "run_started" && e["run_scope"] === void 0) {
    return { ok: false, reason: "run_started requires run_scope" };
  }
  if (eventClass === "run_attachment_resolved" && (e["run_scope"] === void 0 || e["signature"] === void 0)) {
    return { ok: false, reason: "run_attachment_resolved requires run_scope and signature" };
  }
  if (eventClass === "config_snapshot_written" && e["config_snapshot_ref"] === void 0 && e["payload_ref"] === void 0) {
    return { ok: false, reason: "config_snapshot_written requires config_snapshot_ref or payload_ref" };
  }
  const promptClasses = ["prompt_received", "prompt_normalized", "clarifying_question_asked", "agent_prompt_sent"];
  if (promptClasses.includes(eventClass) && (e["prompt_hash"] === void 0 || e["redaction"] === void 0 || e["span_id"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires prompt_hash, redaction, and span_id` };
  }
  if ((eventClass.startsWith("knowledge_lookup_") || eventClass.startsWith("memory_lookup_")) && (e["span_id"] === void 0 || e["prompt_hash"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and prompt_hash` };
  }
  if (eventClass.startsWith("tool_call_") && e["span_id"] === void 0) {
    return { ok: false, reason: `${eventClass} requires span_id` };
  }
  if (["tool_call_finished", "tool_call_failed"].includes(eventClass) && e["duration_ms"] === void 0) {
    return { ok: false, reason: `${eventClass} requires duration_ms` };
  }
  if (["agent_dispatched", "agent_prompt_sent", "agent_handoff_written"].includes(eventClass) && (e["task_id"] === void 0 || e["span_id"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires task_id and span_id` };
  }
  if (eventClass === "agent_handoff_written" && e["payload_ref"] === void 0) {
    return { ok: false, reason: "agent_handoff_written requires payload_ref" };
  }
  if (eventClass === "agent_response_received" && e["span_id"] === void 0) {
    return { ok: false, reason: "agent_response_received requires span_id" };
  }
  if (eventClass.startsWith("loop_") && (e["span_id"] === void 0 || e["signature"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and signature` };
  }
  if (eventClass.startsWith("phase_") && (e["span_id"] === void 0 || e["phase"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and phase` };
  }
  if (eventClass.startsWith("gate_") && (e["span_id"] === void 0 || e["signature"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and signature` };
  }
  const evidenceClasses = [
    "instruction_violation_detected",
    "user_steering_received",
    "correction_applied",
    "repeated_failure_detected",
    "recommendation_created",
    "recommendation_routed",
    "bug_report_prompted"
  ];
  if (evidenceClasses.includes(eventClass) && (e["span_id"] === void 0 || e["signature"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and signature` };
  }
  return { ok: true };
}
function validateGuildTraceEvent(ev) {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: "event must be a non-null object" };
  }
  const sv = ev["schema_version"];
  switch (sv) {
    case "guild.trace.analysis.v2":
      return validateAnalysisTraceEvent(ev);
    case "guild.trace.model_inspection.v1":
      return validateModelInspectionEvent(ev);
    case "guild.trace.dispatch.v1":
      return validateDispatchEvent(ev);
    case "guild.trace.recall.v1":
      return validateRecallEvent(ev);
    case "guild.trace.recall_decision.v1":
      return validateRecallDecisionEvent(ev);
    case "guild.trace.config_resolution.v1":
      return validateConfigResolutionEvent(ev);
    case "guild.trace.security_decision.v1":
      return validateSecurityDecisionEvent(ev);
    case "guild.trace.degradation.v1":
      return validateDegradationEvent(ev);
    default:
      return { ok: false, reason: `unknown schema_version: ${sv}` };
  }
}
function makeDispatchEvent(fields) {
  return { schema_version: "guild.trace.dispatch.v1", ...fields };
}
var ANALYSIS_EVENT_CLASSES, GUILD_TRACE_SCHEMA_VERSIONS, DISPATCH_BACKENDS, RECALL_BRANCHES, SECURITY_OUTCOMES, DEGRADATION_SURFACES, LANE_OUTCOMES;
var init_guild_trace_events = __esm({
  "../src/modules/telemetry/workflows/guild-trace-events.ts"() {
    ANALYSIS_EVENT_CLASSES = Object.freeze([
      "run_started",
      "run_closed",
      "run_attachment_resolved",
      "config_snapshot_written",
      "prompt_received",
      "prompt_normalized",
      "clarifying_question_asked",
      "implementation_authorized",
      "agent_dispatched",
      "agent_prompt_sent",
      "agent_response_received",
      "agent_handoff_written",
      "knowledge_lookup_started",
      "knowledge_lookup_result",
      "memory_lookup_started",
      "memory_lookup_result",
      "tool_call_started",
      "tool_call_finished",
      "tool_call_denied",
      "tool_call_failed",
      "loop_entered",
      "loop_iteration",
      "loop_exited",
      "loop_cap_hit",
      "phase_entered",
      "phase_concluded",
      "gate_started",
      "gate_concluded",
      "instruction_violation_detected",
      "user_steering_received",
      "correction_applied",
      "repeated_failure_detected",
      "recommendation_created",
      "recommendation_routed",
      "bug_report_prompted"
    ]);
    GUILD_TRACE_SCHEMA_VERSIONS = Object.freeze([
      "guild.trace.dispatch.v1",
      "guild.trace.recall.v1",
      "guild.trace.recall_decision.v1",
      "guild.trace.config_resolution.v1",
      "guild.trace.security_decision.v1",
      "guild.trace.degradation.v1",
      "guild.trace.model_inspection.v1",
      "guild.trace.analysis.v2"
    ]);
    DISPATCH_BACKENDS = ["agent", "cmux", "tmux", "remote", "unknown"];
    RECALL_BRANCHES = ["sqlite", "file-bm25", "fs-scan", "kg-query", "structural", "combined", "empty"];
    SECURITY_OUTCOMES = ["allow", "ask", "deny", "audit", "pass-through"];
    DEGRADATION_SURFACES = ["dispatch", "recall", "config", "hook", "host-capability", "other"];
    LANE_OUTCOMES = ["success", "failure", "unknown"];
  }
});

// ../src/modules/telemetry/workflows/guild-trace-emit.ts
function liveLogPath2(runDir3) {
  return path19.join(runDir3, "logs", "v1.4-events.jsonl");
}
function emitTraceEvent(event, runDir3) {
  if (!runDir3) return false;
  const validationResult = validateGuildTraceEvent(event);
  if (!validationResult.ok) {
    const schemaVersion = event["schema_version"];
    const failResult = validationResult;
    process.stderr.write(
      `[guild-trace-emit] WARN: dropping invalid trace event (${schemaVersion}): ${failResult.reason}
`
    );
    return false;
  }
  try {
    const live = liveLogPath2(runDir3);
    const dir = path19.dirname(live);
    fs15.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(event) + "\n";
    fs15.appendFileSync(live, line, "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `[guild-trace-emit] WARN: could not write trace event to ${runDir3}/logs/v1.4-events.jsonl: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}
var fs15, path19;
var init_guild_trace_emit = __esm({
  "../src/modules/telemetry/workflows/guild-trace-emit.ts"() {
    fs15 = __toESM(require("node:fs"));
    path19 = __toESM(require("node:path"));
    init_guild_trace_events();
  }
});

// ../src/modules/telemetry/workflows/task-cell-telemetry.ts
var TASK_CELL_LIFECYCLE_EVENTS, EVENT_NAMES;
var init_task_cell_telemetry = __esm({
  "../src/modules/telemetry/workflows/task-cell-telemetry.ts"() {
    init_kernel();
    TASK_CELL_LIFECYCLE_EVENTS = Object.freeze([
      "spawn_started",
      "spawned",
      "ready",
      "assignment_delivered",
      "assignment_acknowledged",
      "running",
      "handoff_submitted",
      "handoff_validated",
      "handoff_accepted",
      "termination_started",
      "terminated",
      "failed",
      "cancelled",
      "timed_out",
      "rejected",
      "orphaned",
      "reaped"
    ]);
    EVENT_NAMES = new Set(TASK_CELL_LIFECYCLE_EVENTS);
  }
});

// ../src/modules/telemetry/workflows/run-analysis.ts
var REQUIRED_COVERAGE, COMPLETENESS_REQUIREMENTS, EVENT_CLASS_CATEGORY;
var init_run_analysis = __esm({
  "../src/modules/telemetry/workflows/run-analysis.ts"() {
    init_state();
    init_guild_trace_events();
    REQUIRED_COVERAGE = Object.freeze(["prompt", "agent", "tool", "phase", "loop", "gate", "close"]);
    COMPLETENESS_REQUIREMENTS = Object.freeze(["run identity", "plugin-config-snapshot.json", "trace parseability", "trace validity", ...REQUIRED_COVERAGE]);
    EVENT_CLASS_CATEGORY = Object.freeze({
      run_started: null,
      run_closed: "close",
      run_attachment_resolved: null,
      config_snapshot_written: null,
      prompt_received: "prompt",
      prompt_normalized: "prompt",
      clarifying_question_asked: "prompt",
      implementation_authorized: "gate",
      agent_dispatched: "agent",
      agent_prompt_sent: "agent",
      agent_response_received: "agent",
      agent_handoff_written: "agent",
      knowledge_lookup_started: "knowledge",
      knowledge_lookup_result: "knowledge",
      memory_lookup_started: "memory",
      memory_lookup_result: "memory",
      tool_call_started: "tool",
      tool_call_finished: "tool",
      tool_call_denied: "tool",
      tool_call_failed: "tool",
      loop_entered: "loop",
      loop_iteration: "loop",
      loop_exited: "loop",
      loop_cap_hit: "loop",
      phase_entered: "phase",
      phase_concluded: "phase",
      gate_started: "gate",
      gate_concluded: "gate",
      instruction_violation_detected: "steering",
      user_steering_received: "steering",
      correction_applied: "correction",
      repeated_failure_detected: "correction",
      recommendation_created: null,
      recommendation_routed: null,
      bug_report_prompted: null
    });
  }
});

// ../src/modules/telemetry/index.ts
var init_telemetry = __esm({
  "../src/modules/telemetry/index.ts"() {
    init_receipt_journal();
    init_receipt_reconcile();
    init_debug_bundle();
    init_receipt_journal_conformance_evaluator();
    init_guild_trace_emit();
    init_guild_trace_events();
    init_task_cell_telemetry();
    init_run_analysis();
  }
});

// ../src/modules/distribution/workflows/release-conformance-integration.ts
function isRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function ownField(value, field) {
  if (!isRecord6(value)) return void 0;
  if (Object.keys(value).indexOf(field) === -1) return void 0;
  return value[field];
}
function identityIsComplete4(identity) {
  if (!isRecord6(identity)) return false;
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    const value = ownField(identity, field);
    if (field === "contract_version") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}
function copyIdentity2(identity) {
  const copy = {};
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) copy[field] = ownField(identity, field);
  return copy;
}
function copyStringMap(value) {
  const copy = {};
  if (!isRecord6(value)) return copy;
  for (const key of Object.keys(value)) {
    const entry = value[key];
    if (typeof entry === "string") copy[key] = entry;
  }
  return copy;
}
function mh02Snapshot(probe) {
  return freezeNeutralCapabilitySnapshot({
    snapshot_hash: MH02_SNAPSHOT_HASH,
    host_id: probe.host_id,
    host_version: probe.host_version,
    capabilities: [
      { capability_id: MH02_SUPPORTED_CAPABILITY, supported: true, authenticated: true }
    ]
  });
}
function mh02State(probe, runId, overrides = {}) {
  return neutralInitialLifecycleState({
    run_id: runId,
    capability_snapshot_hash: MH02_SNAPSHOT_HASH,
    phase: "init",
    required_gate_ids: overrides.required_gate_ids,
    required_observations: overrides.required_observations,
    admission_context: { snapshot: mh02Snapshot(probe), policy: MH02_POLICY, gates: MH02_GATES }
  });
}
function mh02Event(probe, name, transitionId, input) {
  return {
    name,
    transition_id: transitionId,
    capability_snapshot_hash: MH02_SNAPSHOT_HASH,
    input,
    host_native: { host_id: probe.host_id, host_version: probe.host_version }
  };
}
function mh02ProbePhaseEquivalence(runId) {
  const phases = ["ideate", "plan", "build", "qa", "ops"];
  const finals = [];
  let lastOutcome = null;
  for (const probe of MH02_HOST_PROBES) {
    let state = mh02State(probe, runId);
    for (const phase of phases) {
      const transition = applyNeutralLifecycleEvent(
        state,
        mh02Event(probe, "prompt.submit", `a21x-lif001-${phase}`, {
          semantic_intent: "enter_phase",
          phase
        })
      );
      if (transition.outcome.disposition !== "succeeded") return null;
      if (transition.outcome.facts?.lifecycle_decision !== "phase_entered") return null;
      state = transition.state;
      lastOutcome = transition.outcome;
    }
    finals.push(state);
  }
  if (finals.length !== 2 || !neutralLifecycleEquivalent(finals[0], finals[1])) return null;
  if (lastOutcome === null || lastOutcome.type !== "guild.lifecycle_outcome.v1") return null;
  return { outcome_type: lastOutcome.type, disposition: "succeeded", reason_code: null };
}
function mh02ProbeGateRefusal(runId) {
  const observed = [];
  for (const probe of MH02_HOST_PROBES) {
    const state = mh02State(probe, runId);
    const before = neutralLifecycleFingerprint(state);
    const transition = applyNeutralLifecycleEvent(
      state,
      mh02Event(probe, "tool.before", "a21x-lif002-violation", {
        gate_id: MH02_CONDITION_GATE,
        operation: MH02_ALLOWED_OPERATION,
        required_capability: MH02_SUPPORTED_CAPABILITY,
        operation_class: "mutating",
        satisfied_conditions: []
      })
    );
    if (transition.state_changed) return null;
    if (neutralLifecycleFingerprint(transition.state) !== before) return null;
    if (transition.outcome.disposition !== "refused") return null;
    if (transition.outcome.type !== "guild.lifecycle_outcome.v1") return null;
    observed.push({
      outcome_type: transition.outcome.type,
      disposition: transition.outcome.disposition,
      reason_code: transition.outcome.reason_code ?? null
    });
  }
  if (observed.length !== 2) return null;
  if (observed[0].reason_code !== observed[1].reason_code) return null;
  if (observed[0].reason_code !== "gate_unsatisfied") return null;
  return observed[0];
}
function mh02ProbeCompactResume(runId) {
  const probe = MH02_HOST_PROBES[0];
  let state = mh02State(probe, runId);
  const enter = applyNeutralLifecycleEvent(
    state,
    mh02Event(probe, "prompt.submit", "a21x-lif003-enter", { semantic_intent: "enter_phase", phase: "plan" })
  );
  if (enter.outcome.disposition !== "succeeded") return null;
  state = enter.state;
  const compact = applyNeutralLifecycleEvent(
    state,
    mh02Event(probe, "context.compact", "a21x-lif003-compact", { then: "run.resume" })
  );
  if (compact.outcome.disposition !== "succeeded") return null;
  const resume = applyNeutralLifecycleEvent(
    compact.state,
    mh02Event(probe, "run.resume", "a21x-lif003-resume", {})
  );
  if (resume.outcome.disposition !== "succeeded") return null;
  const resumed = resume.state;
  if (resumed.run_id !== state.run_id) return null;
  if (resumed.capability_snapshot_hash !== state.capability_snapshot_hash) return null;
  if (resumed.phase !== state.phase) return null;
  if (resumed.checkpoint_sequence !== state.checkpoint_sequence + 2) return null;
  const replay = applyNeutralLifecycleEvent(
    resumed,
    mh02Event(probe, "prompt.submit", "a21x-lif003-enter", { semantic_intent: "enter_phase", phase: "plan" })
  );
  if (replay.state_changed || replay.outcome.disposition !== "succeeded") return null;
  if (replay.outcome.facts?.idempotent_replay !== true) return null;
  if (resume.outcome.type !== "guild.lifecycle_outcome.v1") return null;
  return { outcome_type: resume.outcome.type, disposition: "succeeded", reason_code: null };
}
function mh02ProbeEvidenceGatedClose(runId) {
  const terminalOutcomes = [];
  for (const probe of MH02_HOST_PROBES) {
    let state = mh02State(probe, runId, {
      required_gate_ids: [MH02_OPEN_GATE],
      required_observations: [MH02_OBSERVATION]
    });
    const premature = applyNeutralLifecycleEvent(
      state,
      mh02Event(probe, "run.stop", "a21x-lif004-premature", { requested_terminal_state: "completed" })
    );
    if (premature.state_changed || premature.outcome.disposition !== "refused") return null;
    if (premature.outcome.reason_code !== "required_observation_missing") return null;
    const observe = applyNeutralLifecycleEvent(
      state,
      mh02Event(probe, "receipt.append", "a21x-lif004-observe", {
        observation: MH02_OBSERVATION,
        observation_state: "checked_clean"
      })
    );
    if (observe.outcome.disposition !== "succeeded") return null;
    state = observe.state;
    const admit = applyNeutralLifecycleEvent(
      state,
      mh02Event(probe, "tool.before", "a21x-lif004-admit", {
        gate_id: MH02_OPEN_GATE,
        operation: MH02_ALLOWED_OPERATION,
        required_capability: MH02_SUPPORTED_CAPABILITY,
        operation_class: "mutating",
        satisfied_conditions: []
      })
    );
    if (admit.outcome.disposition !== "succeeded") return null;
    state = admit.state;
    const close = applyNeutralLifecycleEvent(
      state,
      mh02Event(probe, "run.stop", "a21x-lif004-close", { requested_terminal_state: "completed" })
    );
    if (close.outcome.disposition !== "succeeded") return null;
    if (close.state.status !== "completed") return null;
    terminalOutcomes.push(close.outcome);
  }
  if (terminalOutcomes.length !== 2) return null;
  if (terminalOutcomes[0].type !== "guild.lifecycle_outcome.v1") return null;
  if (terminalOutcomes[0].reason_code !== terminalOutcomes[1].reason_code) return null;
  return { outcome_type: terminalOutcomes[0].type, disposition: "succeeded", reason_code: null };
}
function mh02ProbePolicyDistinction(runId) {
  const probe = MH02_HOST_PROBES[0];
  const state = mh02State(probe, runId);
  const denied = applyNeutralLifecycleEvent(
    state,
    mh02Event(probe, "tool.before", "a21x-uns002-denied", {
      gate_id: MH02_OPEN_GATE,
      operation: MH02_DENIED_OPERATION,
      required_capability: MH02_SUPPORTED_CAPABILITY,
      operation_class: "mutating",
      satisfied_conditions: []
    })
  );
  if (denied.state_changed) return null;
  if (denied.outcome.type !== "guild.policy_outcome.v1") return null;
  if (denied.outcome.disposition !== "refused") return null;
  if (denied.outcome.reason_code !== "policy_denied") return null;
  if (denied.outcome.facts?.capability_supported !== true) return null;
  const absent = applyNeutralLifecycleEvent(
    state,
    mh02Event(probe, "tool.before", "a21x-uns002-absent", {
      gate_id: MH02_OPEN_GATE,
      operation: MH02_ALLOWED_OPERATION,
      required_capability: MH02_ABSENT_CAPABILITY,
      operation_class: "mutating",
      satisfied_conditions: []
    })
  );
  if (absent.outcome.type !== "guild.capability_outcome.v1") return null;
  if (absent.outcome.disposition !== "unsupported") return null;
  return {
    outcome_type: denied.outcome.type,
    disposition: denied.outcome.disposition,
    reason_code: denied.outcome.reason_code ?? null
  };
}
function evaluateMh02CoreConformance(runId, identity, receiptRefs, freshness) {
  const ownerKey = NEUTRAL_CONFORMANCE_OWNER_KEYS[0];
  const ownerIds = NEUTRAL_OWNER_SCENARIO_IDS[ownerKey];
  const registryIds = NEUTRAL_CORE_SCENARIOS.map((scenario) => scenario.stable_id);
  if (ownerIds.length !== MH02_PROBES.length || registryIds.join("|") !== ownerIds.join("|")) {
    return { packet: null, detail: "core scenario registry and owner slice disagree" };
  }
  const results = [];
  for (let index = 0; index < ownerIds.length; index += 1) {
    const stableId = ownerIds[index];
    const expected = NEUTRAL_CORE_SCENARIOS[index].expected_typed_outcome;
    const receiptRef = receiptRefs[stableId];
    const freshnessVerdict = freshness[stableId];
    if (typeof receiptRef !== "string" || receiptRef.length === 0) {
      return { packet: null, detail: "a scenario has no receipt reference binding" };
    }
    if (typeof freshnessVerdict !== "string" || freshnessVerdict.length === 0) {
      return { packet: null, detail: "a scenario has no freshness verdict binding" };
    }
    const observed = MH02_PROBES[index](runId);
    if (observed === null) {
      return { packet: null, detail: "a core scenario probe did not demonstrate its expected behavior" };
    }
    if (observed.outcome_type !== expected.type || observed.disposition !== expected.disposition) {
      return { packet: null, detail: "a core scenario's observed outcome is not its declared expected outcome" };
    }
    results.push({
      stable_id: stableId,
      outcome_type: observed.outcome_type,
      disposition: observed.disposition,
      reason_code: observed.reason_code,
      receipt_ref: receiptRef,
      evidence_identity: copyIdentity2(identity),
      evidence_freshness: freshnessVerdict
    });
  }
  const packet = neutralFreeze({
    schema_version: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    owner_key: ownerKey,
    evidence_identity: copyIdentity2(identity),
    stable_ids: [...ownerIds],
    results
  });
  return { packet, detail: null };
}
function mh03InertAdapterProvider(host) {
  const adapter = { host: String(host), hostId: String(host) };
  for (const operation of HOST_ADAPTER_OPERATIONS) {
    adapter[operation] = () => {
      throw new Error(`A21-X conformance evaluation must not execute adapter operation ${operation}`);
    };
  }
  return adapter;
}
function packetOrDetail(result, refusedDetail) {
  const packet = result.packet;
  if (!isRecord6(packet)) return { packet: null, detail: refusedDetail };
  return { packet, detail: null };
}
function evaluateOwner(ownerKey, inputs) {
  const { runId, claimantId, identity, receiptRefs, freshness, ownerInputs } = inputs;
  try {
    if (ownerKey === NEUTRAL_CONFORMANCE_OWNER_KEYS[0]) {
      return evaluateMh02CoreConformance(runId, identity, receiptRefs, freshness);
    }
    if (ownerKey === NEUTRAL_CONFORMANCE_OWNER_KEYS[1]) {
      const result2 = evaluateMh03HostAdapterConformance({
        run_id: runId,
        evidence_identity: identity,
        receipt_refs: receiptRefs,
        evidence_freshness: freshness,
        adapter_provider: mh03InertAdapterProvider
      });
      return packetOrDetail(result2, "the host-adapter owner evaluation refused its request");
    }
    if (ownerKey === NEUTRAL_CONFORMANCE_OWNER_KEYS[2]) {
      const journalRoot = ownField(ownerInputs, "journal_root");
      const result2 = evaluateReceiptJournalConformance({
        run_id: runId,
        evidence_identity: identity,
        receipt_refs: receiptRefs,
        evidence_freshness: freshness,
        journal_root: typeof journalRoot === "string" ? journalRoot : ""
      });
      return packetOrDetail(result2, "the receipt-journal owner evaluation refused its request");
    }
    if (ownerKey === NEUTRAL_CONFORMANCE_OWNER_KEYS[3]) {
      const pluginRoot = ownField(ownerInputs, "plugin_root");
      const consumerRoots = ownField(ownerInputs, "consumer_roots");
      const result2 = evaluateNeutralModuleBoundaries({
        run_id: runId,
        plugin_root: typeof pluginRoot === "string" ? pluginRoot : "",
        consumer_roots: copyStringMap(consumerRoots),
        evidence_identity: identity,
        receipt_refs: receiptRefs,
        evidence_freshness: freshness
      });
      return packetOrDetail(
        result2,
        "the module-boundary owner evaluation refused its request"
      );
    }
    if (ownerKey === NEUTRAL_CONFORMANCE_OWNER_KEYS[4]) {
      const migrationRoot = ownField(ownerInputs, "migration_journal_root");
      const scenarioEvidence = ownField(ownerInputs, "migration_scenario_evidence");
      const scope = ownField(ownerInputs, "migration_scope");
      const result2 = evaluateHostCutoverConformance({
        run_id: runId,
        journal_root: typeof migrationRoot === "string" ? migrationRoot : "",
        evidence_identity: identity,
        receipt_refs: receiptRefs,
        evidence_freshness: freshness,
        scenario_evidence: isRecord6(scenarioEvidence) ? scenarioEvidence : {},
        scope: isRecord6(scope) ? scope : void 0
      });
      return packetOrDetail(result2, "the host-cutover owner evaluation refused its request");
    }
    const releaseMode = ownField(ownerInputs, "release_mode");
    const releaseEvidence = ownField(ownerInputs, "release_scenario_evidence");
    const requestText = neutralCanonicalJson({
      run_id: runId,
      claimant_id: claimantId,
      mode: typeof releaseMode === "string" ? releaseMode : "fixture",
      evidence_identity: identity,
      receipt_refs: receiptRefs,
      evidence_freshness: freshness,
      scenario_evidence: isRecord6(releaseEvidence) ? releaseEvidence : {}
    });
    const result = evaluateReleaseConformance(requestText);
    return packetOrDetail(result, "the release owner evaluation refused its request");
  } catch {
    return { packet: null, detail: "the owner evaluation raised instead of answering" };
  }
}
function transportedRefusal(stage, detail) {
  return { promotable: false, stage, detail, outcome: null };
}
function copyTransportedResult(result) {
  const reason = ownField(result, "reason_code");
  return {
    stable_id: ownField(result, "stable_id"),
    outcome_type: ownField(result, "outcome_type"),
    disposition: ownField(result, "disposition"),
    reason_code: reason === void 0 ? null : reason,
    receipt_ref: ownField(result, "receipt_ref"),
    evidence_identity: copyIdentity2(ownField(result, "evidence_identity")),
    evidence_freshness: ownField(result, "evidence_freshness")
  };
}
function evaluateTransportedReleaseConformance(evidence, authority) {
  if (!isRecord6(evidence)) {
    return transportedRefusal("coverage", "the transported evidence is not a record");
  }
  const required = ownField(evidence, "required_scenario_ids");
  const results = ownField(evidence, "results");
  const canonical = NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS;
  if (!Array.isArray(required) || required.length !== canonical.length) {
    return transportedRefusal(
      "coverage",
      "the evidence does not cover the full frozen suite: the required tuple is not the 31-id canonical tuple"
    );
  }
  for (let index = 0; index < canonical.length; index += 1) {
    if (required[index] !== canonical[index]) {
      return transportedRefusal(
        "coverage",
        "the evidence does not cover the full frozen suite: the required tuple is not the 31-id canonical tuple"
      );
    }
  }
  if (!Array.isArray(results) || results.length !== canonical.length) {
    return transportedRefusal(
      "coverage",
      "the evidence does not carry exactly one result per required scenario"
    );
  }
  for (let index = 0; index < canonical.length; index += 1) {
    if (ownField(results[index], "stable_id") !== canonical[index]) {
      return transportedRefusal(
        "coverage",
        "the evidence results are not ordered against the canonical required tuple"
      );
    }
  }
  const claimantId = ownField(evidence, "claimant_id");
  if (typeof claimantId !== "string" || claimantId.length === 0) {
    return transportedRefusal("coverage", "the evidence names no claimant");
  }
  const identity = copyIdentity2(ownField(evidence, "activated_runtime"));
  if (!identityIsComplete4(identity)) {
    return transportedRefusal("coverage", "the evidence names no complete activated-runtime identity");
  }
  const packets = [];
  for (const ownerKey of NEUTRAL_CONFORMANCE_OWNER_KEYS) {
    const ownerIds = NEUTRAL_OWNER_SCENARIO_IDS[ownerKey];
    const ownerResults = [];
    for (const stableId of ownerIds) {
      const at = canonical.indexOf(stableId);
      ownerResults.push(copyTransportedResult(results[at]));
    }
    packets.push({
      schema_version: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
      suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      owner_key: ownerKey,
      evidence_identity: copyIdentity2(identity),
      stable_ids: [...ownerIds],
      results: ownerResults
    });
  }
  const assembled = assembleNeutralConformanceEvidence(
    neutralCanonicalJson({ packets, claim: { claimant_id: claimantId, activated_runtime: identity } })
  );
  if (assembled.evidence === null) {
    const control = assembled.outcome.facts?.refusal_control;
    return transportedRefusal(
      "assembly",
      `the real assembler refused the re-derived packets (${typeof control === "string" ? control : "unnamed control"})`
    );
  }
  const outcome = evaluateNeutralConformanceDecision(assembled.evidence, authority);
  const promotable = outcome.disposition === "succeeded" && outcome.facts?.may_promote_conformant === true;
  return {
    promotable,
    stage: "decision",
    detail: promotable ? "the production decision promoted the re-assembled full-suite evidence" : `the production decision refused: disposition=${outcome.disposition}, reason_code=${String(outcome.reason_code ?? "none")}`,
    outcome
  };
}
function batteryManifestJson(id, kind, dependsOn) {
  const manifest = {};
  manifest["schema_version"] = ["guild", "module_manifest", "v1"].join(".");
  manifest["id"] = id;
  manifest["title"] = id;
  manifest["kind"] = kind;
  manifest["implementation_mode"] = "workflow-backed";
  manifest["description"] = `A21-X battery fixture module ${id}`;
  if (dependsOn !== void 0) manifest["depends_on"] = [...dependsOn];
  manifest["owns"] = {};
  return `${JSON.stringify(manifest, null, 2)}
`;
}
function batteryResourcesJson(moduleId) {
  const resources = {};
  resources["schema_version"] = ["guild", "module_resources", "v1"].join(".");
  resources["module_id"] = moduleId;
  resources["generated_from"] = ["guild", "inventory", "v1"].join(".");
  resources["entries"] = [];
  return `${JSON.stringify(resources, null, 2)}
`;
}
function buildBatteryModuleWorkspace(base) {
  const files = {};
  files["plugin/.claude-plugin/plugin.json"] = `${JSON.stringify(
    { name: "guild-a21x-battery-fixture", version: "0.0.0" },
    null,
    2
  )}
`;
  const coreDir = path20.resolve(__dirname, "../../lifecycle/workflows");
  const coreWorkflows = {};
  for (const member of NEUTRAL_CORE_MEMBERS) {
    coreWorkflows[member] = fs16.readFileSync(path20.join(coreDir, member), "utf8");
  }
  coreWorkflows["lifecycle-ports.ts"] = [
    'export const LIFECYCLE_PORT_VERSION = "guild.lifecycle.ports.v1" as const;',
    "",
    "export function decideLifecycleSelection(candidate: string): string {",
    "  return candidate;",
    "}",
    ""
  ].join("\n");
  const modules = [
    {
      id: "lifecycle",
      kind: "capability",
      depends_on: ["kernel"],
      index: [
        BATTERY_MODULE_PUBLIC_API,
        ...NEUTRAL_CORE_MEMBERS.map(
          (member) => `export * from "./workflows/${member.replace(/\.ts$/, "")}";`
        ),
        'export * from "./workflows/lifecycle-ports";',
        ""
      ].join("\n"),
      workflows: coreWorkflows
    },
    {
      id: "kernel",
      kind: "substrate",
      index: [BATTERY_MODULE_PUBLIC_API, 'export * from "./workflows/module-contracts";', ""].join("\n"),
      workflows: {
        "module-contracts.ts": ['export const MODULE_CONTRACT_VERSION = "guild.module.v1" as const;', ""].join(
          "\n"
        )
      }
    },
    {
      id: "host-runtime",
      kind: "capability",
      depends_on: ["lifecycle"],
      index: [BATTERY_MODULE_PUBLIC_API, 'export * from "./workflows/adapter";', ""].join("\n"),
      workflows: {
        "adapter.ts": [
          'import { LIFECYCLE_PORT_VERSION } from "../../lifecycle";',
          "",
          "export function bindNativeHostEvent(nativeEvent: string): string {",
          "  return `${LIFECYCLE_PORT_VERSION}:${nativeEvent}`;",
          "}",
          ""
        ].join("\n")
      }
    },
    {
      id: "dispatch",
      kind: "capability",
      depends_on: ["lifecycle"],
      index: [BATTERY_MODULE_PUBLIC_API, 'export * from "./workflows/transport";', ""].join("\n"),
      workflows: {
        "transport.ts": [
          'import { LIFECYCLE_PORT_VERSION } from "../../lifecycle";',
          "",
          'export * from "./transport-errors";',
          "",
          "export async function runTransport(command: string): Promise<string> {",
          '  const errors = await import("./transport-errors");',
          "  return `${LIFECYCLE_PORT_VERSION}:${errors.TRANSPORT_ERROR_TYPE}:${command}`;",
          "}",
          ""
        ].join("\n"),
        "transport-errors.ts": [
          'export const TRANSPORT_ERROR_TYPE = "guild.transport_outcome.v1" as const;',
          ""
        ].join("\n")
      }
    },
    {
      id: "documents",
      kind: "capability",
      depends_on: ["lifecycle"],
      index: [BATTERY_MODULE_PUBLIC_API, 'export * from "./workflows/service";', ""].join("\n"),
      workflows: {
        "service.ts": [
          'import { LIFECYCLE_PORT_VERSION } from "../../lifecycle";',
          "",
          "export function renderDocument(body: string): string {",
          "  return `${LIFECYCLE_PORT_VERSION}:${body}`;",
          "}",
          ""
        ].join("\n")
      }
    }
  ];
  for (const module2 of modules) {
    const moduleBase = `plugin/src/modules/${module2.id}`;
    files[`${moduleBase}/module.manifest.json`] = batteryManifestJson(module2.id, module2.kind, module2.depends_on);
    files[`${moduleBase}/index.ts`] = module2.index;
    files[`${moduleBase}/resources/.generated-by-guild-module-resources`] = "generated by the A21-X battery\n";
    files[`${moduleBase}/resources/module-resources.json`] = batteryResourcesJson(module2.id);
    for (const [name, source] of Object.entries(module2.workflows)) {
      files[`${moduleBase}/workflows/${name}`] = source;
    }
  }
  files["website/src/render.ts"] = [
    'export const WEBSITE_CONTRACT_VERSION = "guild.website.contract.v1" as const;',
    ""
  ].join("\n");
  files["benchmark/src/run.ts"] = [
    'export const BENCHMARK_CONTRACT_VERSION = "guild.benchmark.contract.v1" as const;',
    ""
  ].join("\n");
  for (const [rel, content] of Object.entries(files)) {
    const target = path20.join(base, rel);
    fs16.mkdirSync(path20.dirname(target), { recursive: true });
    fs16.writeFileSync(target, content);
  }
}
function batteryWorkspace() {
  if (batteryWorkspaceSingleton !== null) return batteryWorkspaceSingleton;
  const base = fs16.mkdtempSync(path20.join(os2.tmpdir(), "a21x-integration-battery-"));
  const journalRoot = path20.join(base, "journal-root");
  const migrationJournalRoot = path20.join(base, "migration-journal-root");
  fs16.mkdirSync(journalRoot, { recursive: true });
  fs16.mkdirSync(migrationJournalRoot, { recursive: true });
  const moduleBase = path20.join(base, "module-workspace");
  buildBatteryModuleWorkspace(moduleBase);
  batteryWorkspaceSingleton = {
    journalRoot,
    migrationJournalRoot,
    pluginRoot: path20.join(moduleBase, "plugin"),
    consumerRoots: {
      website: path20.join(moduleBase, "website"),
      benchmark: path20.join(moduleBase, "benchmark")
    }
  };
  return batteryWorkspaceSingleton;
}
function batteryCommitment(sequence) {
  let hex = (sequence >>> 0).toString(16);
  while (hex.length < 16) hex = `0${hex}`;
  return `nec1:${hex}`;
}
function batteryReceiptRefs() {
  const refs = {};
  for (let index = 0; index < NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length; index += 1) {
    const sequence = index + 1;
    refs[NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[index]] = `guild.receipt_ref.v1:a21x-integration#${sequence}@${batteryCommitment(sequence)}`;
  }
  return refs;
}
function batteryAuthorityBelowQuorum(results) {
  const base = {
    schema_version: "guild.conformance_authority.v1",
    identity: BATTERY_IDENTITY,
    receipt_journal_id: "jrn-a21x-battery",
    receipt_sequence_range: { first: 1, last: results.length },
    observed_entries: [],
    attestations: []
  };
  const entries = [];
  let previous = neutralJournalGenesis(base);
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const draft = {
      sequence: index + 1,
      scenario_id: result.stable_id,
      outcome_type: result.outcome_type,
      disposition: result.disposition,
      reason_code: result.reason_code ?? null,
      entry_commitment: "",
      previous_commitment: previous
    };
    const committed = {
      ...draft,
      entry_commitment: neutralJournalEntryCommitment(base, previous, draft)
    };
    entries.push(committed);
    previous = committed.entry_commitment;
  }
  const authorityWithJournal = {
    ...base,
    observed_entries: entries
  };
  const draftAttestation = {
    attestor_id: "guild.release-attestor",
    attested_journal_root: previous,
    attested_entry_count: entries.length,
    attestation_ref: "",
    // Structurally valid but deliberately not a real signature. The decision
    // must stop at quorum=1 before signature verification; no private material
    // is present in the control battery.
    attestation_signature: `nws1:00:${"11".repeat(32 * NEUTRAL_ATTESTATION_CHAINS)}:${"22".repeat(
      32 * NEUTRAL_ATTESTATION_TREE_HEIGHT
    )}`
  };
  return {
    ...authorityWithJournal,
    attestations: [
      {
        ...draftAttestation,
        attestation_ref: neutralAttestationReference(
          authorityWithJournal,
          draftAttestation
        )
      }
    ]
  };
}
function batteryFreshness() {
  const map = {};
  for (const stableId of NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS) map[stableId] = "fresh";
  return map;
}
function batteryOwnerInputs(overrides = {}) {
  const workspace = batteryWorkspace();
  const inputs = {
    run_id: BATTERY_RUN_ID,
    receipt_refs: batteryReceiptRefs(),
    evidence_freshness: batteryFreshness(),
    journal_root: workspace.journalRoot,
    migration_journal_root: workspace.migrationJournalRoot,
    migration_scenario_evidence: {},
    plugin_root: workspace.pluginRoot,
    consumer_roots: workspace.consumerRoots,
    release_mode: "fixture",
    release_scenario_evidence: {}
  };
  for (const key of Object.keys(overrides)) {
    if (overrides[key] === void 0) delete inputs[key];
    else inputs[key] = overrides[key];
  }
  return inputs;
}
function batteryRequestText(claim = BATTERY_CLAIM, ownerInputs = batteryOwnerInputs()) {
  return neutralCanonicalJson({ claim, owner_inputs: ownerInputs });
}
function batterySmuggledPackets() {
  return NEUTRAL_CONFORMANCE_OWNER_KEYS.map((ownerKey) => {
    const ids = NEUTRAL_OWNER_SCENARIO_IDS[ownerKey];
    const refs = batteryReceiptRefs();
    return {
      schema_version: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
      suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      owner_key: ownerKey,
      evidence_identity: BATTERY_IDENTITY,
      stable_ids: [...ids],
      results: ids.map((stableId) => ({
        stable_id: stableId,
        outcome_type: "guild.lifecycle_outcome.v1",
        disposition: "succeeded",
        reason_code: null,
        receipt_ref: refs[stableId],
        evidence_identity: BATTERY_IDENTITY,
        evidence_freshness: "fresh"
      }))
    };
  });
}
function batteryRecomputedPackets() {
  if (batteryRecomputedPacketsSingleton !== null) return batteryRecomputedPacketsSingleton;
  const inputs = {
    runId: BATTERY_RUN_ID,
    claimantId: BATTERY_CLAIMANT,
    identity: copyIdentity2(BATTERY_IDENTITY),
    receiptRefs: batteryReceiptRefs(),
    freshness: batteryFreshness(),
    ownerInputs: batteryOwnerInputs()
  };
  const packets = [];
  for (const ownerKey of NEUTRAL_CONFORMANCE_OWNER_KEYS) {
    const evaluation = evaluateOwner(ownerKey, inputs);
    if (evaluation.packet === null) {
      throw new Error(`battery recomputation failed for ${ownerKey}: ${String(evaluation.detail)}`);
    }
    packets.push(evaluation.packet);
  }
  batteryRecomputedPacketsSingleton = packets;
  return packets;
}
function evaluateOnce(cache, implementation) {
  const cached = cache.get("valid");
  if (cached !== void 0) return cached.result;
  let result;
  try {
    const produced = implementation(batteryRequestText());
    result = isRecord6(produced) && isRecord6(produced.outcome) && produced.outcome.disposition === "succeeded" ? produced : null;
  } catch {
    result = null;
  }
  cache.set("valid", { result });
  return result;
}
function refusesWithControl(implementation, request, control) {
  let result;
  try {
    result = implementation(request);
  } catch {
    return false;
  }
  if (!isRecord6(result) || result.evidence !== null || result.packets !== null) return false;
  if (!isRecord6(result.outcome) || result.outcome.disposition !== "refused") return false;
  return ownField(result.outcome.facts, "refusal_control") === control;
}
var fs16, os2, path20, RELEASE_INTEGRATION_REQUEST_MEMBERS, RELEASE_INTEGRATION_OWNER_BOUNDARIES, CONTROL_NOT_TEXT, CONTROL_CALLER_PACKETS, CONTROL_CALLER_REQUIRED_SET2, CONTROL_CALLER_OUTCOMES, CONTROL_OWNER_FAILED, CONTROL_CLAIM_INCOMPLETE, CONTROL_ASSEMBLY_REFUSED, RELEASE_INTEGRATION_REFUSAL_CONTROLS, RELEASE_INTEGRATION_OWNER_INPUT_MEMBERS, FORBIDDEN_OWNER_INPUT_KEYS, MH02_SNAPSHOT_HASH, MH02_SUPPORTED_CAPABILITY, MH02_ABSENT_CAPABILITY, MH02_DENIED_OPERATION, MH02_ALLOWED_OPERATION, MH02_CONDITION_GATE, MH02_OPEN_GATE, MH02_OBSERVATION, MH02_POLICY, MH02_GATES, MH02_HOST_PROBES, MH02_PROBES, batteryWorkspaceSingleton, BATTERY_MODULE_PUBLIC_API, BATTERY_IDENTITY, BATTERY_CLAIMANT, BATTERY_RUN_ID, BATTERY_CLAIM, batteryRecomputedPacketsSingleton, RELEASE_INTEGRATION_CONTROL_BATTERY, RELEASE_INTEGRATION_CONTROLS;
var init_release_conformance_integration = __esm({
  "../src/modules/distribution/workflows/release-conformance-integration.ts"() {
    fs16 = __toESM(require("node:fs"));
    os2 = __toESM(require("node:os"));
    path20 = __toESM(require("node:path"));
    init_lifecycle();
    init_host_runtime();
    init_telemetry();
    init_migrations();
    init_release_conformance_evaluator();
    RELEASE_INTEGRATION_REQUEST_MEMBERS = neutralFreeze([
      "claim",
      "owner_inputs"
    ]);
    RELEASE_INTEGRATION_OWNER_BOUNDARIES = neutralFreeze([
      "neutral-conformance-core",
      "host-adapter-conformance-evaluator",
      "receipt-journal-conformance-evaluator",
      "module-boundary-conformance-evaluator",
      "host-cutover-controller",
      "release-conformance-evaluator",
      "neutral-conformance-assembly"
    ]);
    CONTROL_NOT_TEXT = "integration_request_not_canonical_text";
    CONTROL_CALLER_PACKETS = "caller_supplied_packets";
    CONTROL_CALLER_REQUIRED_SET2 = "caller_supplied_required_set";
    CONTROL_CALLER_OUTCOMES = "caller_supplied_outcomes";
    CONTROL_OWNER_FAILED = "owner_evaluation_failed";
    CONTROL_CLAIM_INCOMPLETE = "integration_claim_incomplete";
    CONTROL_ASSEMBLY_REFUSED = "integration_assembly_refused";
    RELEASE_INTEGRATION_REFUSAL_CONTROLS = neutralFreeze([
      CONTROL_NOT_TEXT,
      CONTROL_CALLER_PACKETS,
      CONTROL_CALLER_REQUIRED_SET2,
      CONTROL_CALLER_OUTCOMES,
      CONTROL_OWNER_FAILED,
      CONTROL_CLAIM_INCOMPLETE,
      CONTROL_ASSEMBLY_REFUSED
    ]);
    RELEASE_INTEGRATION_OWNER_INPUT_MEMBERS = neutralFreeze([
      "run_id",
      "receipt_refs",
      "evidence_freshness",
      "journal_root",
      "migration_journal_root",
      "migration_scenario_evidence",
      "migration_scope",
      "plugin_root",
      "consumer_roots",
      "release_mode",
      "release_scenario_evidence"
    ]);
    FORBIDDEN_OWNER_INPUT_KEYS = neutralFreeze([
      "results",
      "stable_ids",
      "outcomes",
      "outcome",
      "disposition",
      "reason_code",
      "receipt_ref",
      "packets",
      "required_scenario_ids"
    ]);
    MH02_SNAPSHOT_HASH = "sha256:a21x-mh02-probe-capability-snapshot";
    MH02_SUPPORTED_CAPABILITY = "guild.tool.write";
    MH02_ABSENT_CAPABILITY = "guild.a21x.absent.capability";
    MH02_DENIED_OPERATION = "a21x.policy.denied.operation";
    MH02_ALLOWED_OPERATION = "a21x.policy.allowed.operation";
    MH02_CONDITION_GATE = "a21x-conditioned-gate";
    MH02_OPEN_GATE = "a21x-open-gate";
    MH02_OBSERVATION = "a21x-required-observation";
    MH02_POLICY = neutralFreeze({
      policy_version: "guild.a21x.probe-policy.v1",
      denied_operations: [MH02_DENIED_OPERATION],
      approval_required_operations: []
    });
    MH02_GATES = neutralFreeze([
      {
        gate_id: MH02_CONDITION_GATE,
        phase: "build",
        operation_class: "mutating",
        required_conditions: ["approval_recorded"]
      },
      {
        gate_id: MH02_OPEN_GATE,
        phase: "build",
        operation_class: "mutating",
        required_conditions: []
      }
    ]);
    MH02_HOST_PROBES = neutralFreeze([
      { host_id: "claude-code-cli", host_version: "0.0.0-a21x-probe" },
      { host_id: "codex-cli", host_version: "0.0.0-a21x-probe" }
    ]);
    MH02_PROBES = [
      mh02ProbePhaseEquivalence,
      mh02ProbeGateRefusal,
      mh02ProbeCompactResume,
      mh02ProbeEvidenceGatedClose,
      mh02ProbePolicyDistinction
    ];
    batteryWorkspaceSingleton = null;
    BATTERY_MODULE_PUBLIC_API = 'export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;';
    BATTERY_IDENTITY = {
      source_commit: "9c2f4b7d1e85a0361fc48ad92b57e610c3d8f2a4",
      package_hash: "sha256:5b8e02c7d4a1f9636e80cb15d2a7943f0c6e18db5a29f47031ce86bd94a25e70",
      runtime_version: "guild-2.5.0",
      adapter_version: "guild.host_adapter.v1.0.0",
      host_id: "claude-code-cli",
      host_version: "2.5.0",
      platform: "darwin-arm64",
      contract_version: NEUTRAL_CONTRACT_VERSION,
      scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      release_id: "rel-2026-08-19-a21xbattery"
    };
    BATTERY_CLAIMANT = "guild.release-emitter";
    BATTERY_RUN_ID = "run-a21x-integration-battery";
    BATTERY_CLAIM = { claimant_id: BATTERY_CLAIMANT, activated_runtime: BATTERY_IDENTITY };
    batteryRecomputedPacketsSingleton = null;
    RELEASE_INTEGRATION_CONTROL_BATTERY = [
      {
        id: "A21X-C01-full-suite-assembly",
        title: "a valid raw-input request assembles all 31 required ids, in contract order",
        check: (implementation, cache) => {
          const result = evaluateOnce(cache, implementation);
          if (result === null || result.evidence === null || result.packets === null) return false;
          if (result.packets.length !== NEUTRAL_CONFORMANCE_OWNER_KEYS.length) return false;
          const ids = result.evidence.results.map((entry) => entry.stable_id);
          if (ids.length !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length) return false;
          for (let index = 0; index < ids.length; index += 1) {
            if (ids[index] !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[index]) return false;
          }
          const required = result.evidence.required_scenario_ids;
          if (required.length !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length) return false;
          for (let index = 0; index < required.length; index += 1) {
            if (required[index] !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[index]) return false;
          }
          return true;
        }
      },
      {
        id: "A21X-C02-owner-counts",
        title: "the six packets and the aggregate carry exactly the closed per-owner counts",
        check: (implementation, cache) => {
          const result = evaluateOnce(cache, implementation);
          if (result === null || result.evidence === null || result.packets === null) return false;
          const seenOwners = [];
          for (const packet of result.packets) {
            const ownerKey = String(ownField(packet, "owner_key"));
            if (seenOwners.indexOf(ownerKey) !== -1) return false;
            seenOwners.push(ownerKey);
            const expected = NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[ownerKey];
            if (expected === void 0) return false;
            const stableIds = ownField(packet, "stable_ids");
            const results = ownField(packet, "results");
            if (!Array.isArray(stableIds) || stableIds.length !== expected) return false;
            if (!Array.isArray(results) || results.length !== expected) return false;
          }
          if (seenOwners.length !== NEUTRAL_CONFORMANCE_OWNER_KEYS.length) return false;
          for (const ownerKey of NEUTRAL_CONFORMANCE_OWNER_KEYS) {
            const ownerIds = NEUTRAL_OWNER_SCENARIO_IDS[ownerKey];
            const covered = result.evidence.results.filter(
              (entry) => ownerIds.indexOf(entry.stable_id) !== -1
            ).length;
            if (covered !== NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[ownerKey]) return false;
          }
          return true;
        }
      },
      {
        id: "A21X-C03-real-owner-evaluators",
        title: "the returned packets are byte-identical to an independent drive of the six real evaluators",
        check: (implementation, cache) => {
          const result = evaluateOnce(cache, implementation);
          if (result === null || result.packets === null) return false;
          const recomputed = batteryRecomputedPackets();
          if (result.packets.length !== recomputed.length) return false;
          for (let index = 0; index < recomputed.length; index += 1) {
            if (neutralCanonicalJson(result.packets[index]) !== neutralCanonicalJson(recomputed[index])) {
              return false;
            }
          }
          return true;
        }
      },
      {
        id: "A21X-C04-canonical-text-boundary",
        title: "non-text, malformed, padded, and undeclared-member requests refuse unread",
        check: (implementation, cache) => {
          let trapCount = 0;
          const bump = (value) => {
            trapCount += 1;
            return value;
          };
          const trapProxy = Reflect.construct(Proxy, [
            {},
            {
              get: () => bump(void 0),
              has: () => bump(false),
              ownKeys: () => bump([]),
              getOwnPropertyDescriptor: () => bump(void 0),
              getPrototypeOf: () => bump(null)
            }
          ]);
          if (!refusesWithControl(implementation, trapProxy, CONTROL_NOT_TEXT)) return false;
          if (trapCount !== 0) return false;
          const canonical = batteryRequestText();
          const nonText = [
            { claim: BATTERY_CLAIM, owner_inputs: batteryOwnerInputs() },
            [BATTERY_CLAIM],
            null,
            void 0,
            17,
            true
          ];
          for (const candidate of nonText) {
            if (!refusesWithControl(implementation, candidate, CONTROL_NOT_TEXT)) return false;
          }
          const malformed = [
            "",
            "{",
            "not json",
            "[]",
            '"a JSON string is not a request"',
            ` ${canonical}`,
            neutralCanonicalJson({ claim: BATTERY_CLAIM, owner_inputs: batteryOwnerInputs(), mode: "lenient" }),
            neutralCanonicalJson({ claim: BATTERY_CLAIM })
          ];
          for (const candidate of malformed) {
            if (!refusesWithControl(implementation, candidate, CONTROL_NOT_TEXT)) return false;
          }
          return evaluateOnce(cache, implementation) !== null;
        }
      },
      {
        id: "A21X-C05-caller-channel-closed",
        title: "supplied packets, a supplied required set, and supplied outcomes each refuse by name",
        check: (implementation) => {
          const smuggledPackets = neutralCanonicalJson({
            claim: BATTERY_CLAIM,
            owner_inputs: batteryOwnerInputs(),
            packets: batterySmuggledPackets()
          });
          if (!refusesWithControl(implementation, smuggledPackets, CONTROL_CALLER_PACKETS)) return false;
          const suppliedRequiredSet = batteryRequestText({
            ...BATTERY_CLAIM,
            required_scenario_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS]
          });
          if (!refusesWithControl(implementation, suppliedRequiredSet, CONTROL_CALLER_REQUIRED_SET2)) {
            return false;
          }
          const outcomeRows = [
            batteryOwnerInputs({ results: [] }),
            batteryOwnerInputs({ stable_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS] }),
            batteryOwnerInputs({ outcomes: {} }),
            { ...batteryOwnerInputs(), mh06: { journal_root: batteryWorkspace().journalRoot, results: [] } }
          ];
          for (const ownerInputs of outcomeRows) {
            if (!refusesWithControl(
              implementation,
              batteryRequestText(BATTERY_CLAIM, ownerInputs),
              CONTROL_CALLER_OUTCOMES
            )) {
              return false;
            }
          }
          return true;
        }
      },
      {
        id: "A21X-C06-single-evidence-identity",
        title: "one exact identity binds the claim, every packet, and every result; an incomplete one refuses",
        check: (implementation, cache) => {
          const result = evaluateOnce(cache, implementation);
          if (result === null || result.evidence === null || result.packets === null) return false;
          const claimed = copyIdentity2(BATTERY_IDENTITY);
          for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
            if (ownField(result.evidence.activated_runtime, field) !== ownField(claimed, field)) return false;
          }
          for (const packet of result.packets) {
            for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
              if (ownField(ownField(packet, "evidence_identity"), field) !== ownField(claimed, field)) {
                return false;
              }
            }
          }
          for (const entry of result.evidence.results) {
            for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
              if (ownField(entry.evidence_identity, field) !== ownField(claimed, field)) return false;
            }
          }
          const incomplete = {};
          for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
            if (field === "platform") continue;
            incomplete[field] = ownField(BATTERY_IDENTITY, field);
          }
          return refusesWithControl(
            implementation,
            batteryRequestText({ claimant_id: BATTERY_CLAIMANT, activated_runtime: incomplete }),
            CONTROL_CLAIM_INCOMPLETE
          );
        }
      },
      {
        id: "A21X-C07-receipt-liveness",
        title: "every result carries the transported receipt reference for its scenario, all distinct; a missing binding refuses",
        check: (implementation, cache) => {
          const result = evaluateOnce(cache, implementation);
          if (result === null || result.evidence === null) return false;
          const expected = batteryReceiptRefs();
          const seen = [];
          for (const entry of result.evidence.results) {
            if (entry.receipt_ref !== expected[entry.stable_id]) return false;
            if (seen.indexOf(entry.receipt_ref) !== -1) return false;
            seen.push(entry.receipt_ref);
          }
          if (seen.length !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length) return false;
          const partialRefs = batteryReceiptRefs();
          delete partialRefs[NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[0]];
          return refusesWithControl(
            implementation,
            batteryRequestText(BATTERY_CLAIM, batteryOwnerInputs({ receipt_refs: partialRefs })),
            CONTROL_OWNER_FAILED
          );
        }
      },
      {
        id: "A21X-C08-determinism",
        title: "identical request text yields byte-identical successes and byte-identical refusals",
        check: (implementation, cache) => {
          const first = evaluateOnce(cache, implementation);
          if (first === null || first.evidence === null) return false;
          let second;
          try {
            second = implementation(batteryRequestText());
          } catch {
            return false;
          }
          if (!isRecord6(second) || second.evidence === null) return false;
          if (neutralCanonicalJson(first.evidence) !== neutralCanonicalJson(second.evidence)) return false;
          if (neutralCanonicalJson(first.outcome) !== neutralCanonicalJson(second.outcome)) return false;
          const refusingText = batteryRequestText({
            ...BATTERY_CLAIM,
            required_scenario_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS]
          });
          let refusalA;
          let refusalB;
          try {
            refusalA = implementation(refusingText);
            refusalB = implementation(refusingText);
          } catch {
            return false;
          }
          return neutralCanonicalJson(refusalA.outcome) === neutralCanonicalJson(refusalB.outcome);
        }
      },
      {
        id: "A21X-C09-output-immutability",
        title: "the aggregate, its results, the packet set, and every packet are frozen",
        check: (implementation, cache) => {
          const result = evaluateOnce(cache, implementation);
          if (result === null || result.evidence === null || result.packets === null) return false;
          if (!Object.isFrozen(result.evidence)) return false;
          if (!Object.isFrozen(result.evidence.results)) return false;
          if (!Object.isFrozen(result.evidence.required_scenario_ids)) return false;
          if (!Object.isFrozen(result.evidence.activated_runtime)) return false;
          for (const entry of result.evidence.results) {
            if (!Object.isFrozen(entry) || !Object.isFrozen(entry.evidence_identity)) return false;
          }
          if (!Object.isFrozen(result.packets)) return false;
          for (const packet of result.packets) {
            if (!Object.isFrozen(packet)) return false;
          }
          return true;
        }
      },
      {
        id: "A21X-C10-weakened-owner-refuses",
        title: "a raw-input set that starves one owner refuses closed, naming the owner",
        check: (implementation) => {
          const starved = batteryRequestText(BATTERY_CLAIM, batteryOwnerInputs({ journal_root: void 0 }));
          let result;
          try {
            result = implementation(starved);
          } catch {
            return false;
          }
          if (!isRecord6(result) || result.evidence !== null || result.packets !== null) return false;
          if (!isRecord6(result.outcome) || result.outcome.disposition !== "refused") return false;
          if (ownField(result.outcome.facts, "refusal_control") !== CONTROL_OWNER_FAILED) return false;
          return ownField(result.outcome.facts, "owner_key") === NEUTRAL_CONFORMANCE_OWNER_KEYS[2];
        }
      },
      {
        id: "A21X-C11-fixture-provisioning-not-promotable",
        title: "fixture authority never promotes, while the production owner path executes without bypassing final authority",
        check: (implementation, cache) => {
          const result = evaluateOnce(cache, implementation);
          if (result === null || result.evidence === null) return false;
          const batteryAuthority = batteryAuthorityBelowQuorum(result.evidence.results);
          const decision = evaluateTransportedReleaseConformance(result.evidence, batteryAuthority);
          if (decision.promotable !== false || decision.stage !== "decision" || decision.outcome?.reason_code !== "scenario_journal_attestation_insufficient") {
            return false;
          }
          const productionText = batteryRequestText(
            BATTERY_CLAIM,
            batteryOwnerInputs({ release_mode: "production" })
          );
          let production;
          try {
            production = implementation(productionText);
          } catch {
            return false;
          }
          if (production.evidence === null || production.packets === null) return false;
          const productionAuthority = batteryAuthorityBelowQuorum(production.evidence.results);
          const productionDecision = evaluateTransportedReleaseConformance(
            production.evidence,
            productionAuthority
          );
          const productionPasses = productionDecision.promotable === false && productionDecision.stage === "decision" && productionDecision.outcome?.reason_code === "scenario_journal_attestation_insufficient";
          return productionPasses;
        }
      }
    ];
    RELEASE_INTEGRATION_CONTROLS = neutralFreeze(
      RELEASE_INTEGRATION_CONTROL_BATTERY.map((control) => ({ id: control.id, title: control.title }))
    );
  }
});

// ../src/modules/distribution/workflows/surface-manifest.ts
var SURFACE_KINDS;
var init_surface_manifest = __esm({
  "../src/modules/distribution/workflows/surface-manifest.ts"() {
    SURFACE_KINDS = Object.freeze(["skill", "command", "agent"]);
  }
});

// ../src/modules/distribution/workflows/verify-host-packages.ts
var init_verify_host_packages = __esm({
  "../src/modules/distribution/workflows/verify-host-packages.ts"() {
    init_build_inventory();
    init_host_runtime();
  }
});

// ../src/modules/distribution/workflows/verify-installer.ts
var BUILD_ONCE_SNIPPET, INSTALLER_HOST_EXPECTATIONS;
var init_verify_installer = __esm({
  "../src/modules/distribution/workflows/verify-installer.ts"() {
    init_kernel();
    init_build_inventory();
    BUILD_ONCE_SNIPPET = "would run: npx tsx scripts/build-host-packages.ts --root . --out dist --generated-at <generated-at>";
    INSTALLER_HOST_EXPECTATIONS = deepFreeze([
      // ── keep/CLI+file ───────────────────────────────────────────────────────────
      {
        host: "claude-code-cli",
        snippets: [
          BUILD_ONCE_SNIPPET,
          "would run: claude plugin validate dist/claude-code",
          "would run: claude plugin marketplace add dist/claude-code",
          "would run: claude plugin marketplace update guild",
          "would run: claude plugin install guild@guild",
          "Guild installed into Claude Code."
        ]
      },
      {
        host: "codex-cli",
        snippets: [
          BUILD_ONCE_SNIPPET,
          "would run: codex plugin marketplace remove guild || true",
          "would run: codex plugin marketplace add ",
          "/dist/codex-marketplace",
          "would run: codex plugin add guild@guild",
          "Package bootstrap: AGENTS.md plus .agents/skills/guild.",
          "Codex App local plugin link:",
          "codex://plugins/guild?marketplacePath=",
          "/dist/codex-marketplace/.agents/plugins/marketplace.json",
          "After installing/enabling Guild in Codex App, try /guild:status.",
          "If the app slash parser rejects /guild before hooks run"
        ]
      },
      {
        host: "pi-cli",
        snippets: [
          BUILD_ONCE_SNIPPET,
          "would run: pi install dist/pi",
          "pi-manifest.json",
          "guild-run --host pi"
        ]
      },
      {
        host: "antigravity-cli",
        snippets: [
          BUILD_ONCE_SNIPPET,
          "would run: agy plugin validate dist/antigravity",
          "would run: agy plugin install dist/antigravity",
          "plugin.json",
          "antigravity-manifest.json",
          "guild-run --host antigravity"
        ]
      },
      {
        host: "agents-file",
        snippets: [
          BUILD_ONCE_SNIPPET,
          "Universal AGENTS.md package rendered at:",
          "dist/agents/AGENTS.md",
          "dist/agents/.agents/skills/guild"
        ]
      },
      // ── new-CLI (installability: target — package tree is the deliverable; ADR §4) ─
      {
        host: "cursor",
        snippets: [
          BUILD_ONCE_SNIPPET,
          "cursor (new-CLI)",
          "would prepare package tree: dist/cursor",
          "would wire launcher: dist/cursor/bin/guild-run --host cursor",
          "Guild package prepared for cursor.",
          "cursor-manifest.json (installability: target).",
          "dist/cursor/bin/guild-run --host cursor --prompt"
        ]
      },
      {
        host: "github-copilot",
        snippets: [
          BUILD_ONCE_SNIPPET,
          "github-copilot (new-CLI)",
          "would prepare package tree: dist/github-copilot",
          "would wire launcher: dist/github-copilot/bin/guild-run --host github-copilot",
          "Guild package prepared for github-copilot.",
          "github-copilot-manifest.json (installability: target).",
          "dist/github-copilot/bin/guild-run --host github-copilot --prompt"
        ]
      },
      {
        host: "opencode",
        snippets: [
          BUILD_ONCE_SNIPPET,
          "opencode (new-CLI)",
          "would prepare package tree: dist/opencode",
          "would wire launcher: dist/opencode/bin/guild-run --host opencode",
          "Guild package prepared for opencode.",
          "opencode-manifest.json (installability: target).",
          "dist/opencode/bin/guild-run --host opencode --prompt"
        ]
      },
      {
        host: "rovo-dev",
        snippets: [
          BUILD_ONCE_SNIPPET,
          "rovo-dev (new-CLI)",
          "would prepare package tree: dist/rovo-dev",
          "would wire launcher: dist/rovo-dev/bin/guild-run --host rovo-dev",
          "Guild package prepared for rovo-dev.",
          "rovo-dev-manifest.json (installability: target).",
          "dist/rovo-dev/bin/guild-run --host rovo-dev --prompt"
        ]
      },
      // ── new-IDE (adapter_binding: agents-file — REUSE dist/agents; ADR §3.1) ───────
      {
        host: "kiro",
        snippets: [
          BUILD_ONCE_SNIPPET,
          "kiro (new-IDE, agents-file binding)",
          "Guild package for kiro is the universal AGENTS.md package (adapter_binding: agents-file):",
          "dist/agents/AGENTS.md",
          "dist/agents/.agents/skills/guild",
          "Copy it into your kiro project root (marker: .kiro/). kiro reads root AGENTS.md."
        ]
      },
      {
        host: "qoder",
        snippets: [
          BUILD_ONCE_SNIPPET,
          "qoder (new-IDE, agents-file binding)",
          "Guild package for qoder is the universal AGENTS.md package (adapter_binding: agents-file):",
          "dist/agents/AGENTS.md",
          "dist/agents/.agents/skills/guild",
          "Copy it into your qoder project root (marker: .qoder/). qoder reads root AGENTS.md."
        ]
      },
      {
        host: "trae",
        snippets: [
          BUILD_ONCE_SNIPPET,
          "trae (new-IDE, agents-file binding)",
          "Guild package for trae is the universal AGENTS.md package (adapter_binding: agents-file):",
          "dist/agents/AGENTS.md",
          "dist/agents/.agents/skills/guild",
          "Copy it into your trae project root (marker: .trae/). trae reads root AGENTS.md."
        ]
      }
    ]);
  }
});

// ../src/modules/distribution/index.ts
var init_distribution = __esm({
  "../src/modules/distribution/index.ts"() {
    init_build_inventory();
    init_check_module_ownership();
    init_equivalence_contract();
    init_handoff_v2();
    init_inventory_schema();
    init_module_resources();
    init_parity_contract();
    init_per_host_packaging();
    init_release_conformance_evaluator();
    init_release_conformance_integration();
    init_result_contracts();
    init_review_result();
    init_release_distribution_contract();
    init_surface_manifest();
    init_verify_host_packages();
    init_verify_installer();
  }
});

// ../src/modules/communication/workflows/comms-format-lint.ts
var yaml, HAND_ROLLED_PATTERN_SOURCES, HAND_ROLLED_PATTERNS;
var init_comms_format_lint = __esm({
  "../src/modules/communication/workflows/comms-format-lint.ts"() {
    init_distribution();
    init_kernel();
    yaml = loadYamlApi();
    HAND_ROLLED_PATTERN_SOURCES = [
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
      //
      //     DIGEST-LITERAL EXCLUSION (second lookahead). `sha256:<hex>` is a
      //     content-address scheme in exactly the sense `data:` and `mailto:` are
      //     schemes, so a regex that VALIDATES ONE — /^sha256:[0-9a-f]{64}$/ — is a
      //     value shape check, not a field extractor. It was flagged in
      //     scripts/lib/capability/adoption-migrate.ts (and its test), a file that
      //     reads its YAML through the shared parseFrontmatter; the report was the
      //     same false-positive class as the '.md' Markdown case, whose lesson was
      //     recorded above: do NOT force an idiom-dodging rewrite of a correct check.
      //
      //     The exclusion is deliberately NOT "any identifier named sha256". It fires
      //     only when the algorithm name is followed by `:` and a HEX CHARACTER CLASS
      //     ([0-9a-f], [0-9a-fA-F], [a-f0-9], …) — i.e. the digest-validator idiom. A
      //     genuine hand-rolled extractor for a frontmatter key that happens to be
      //     named `sha256` spells the colon differently (/^sha256:\s*(.*)$/), does not
      //     match the lookahead, and is still flagged. A class with a non-hex letter
      //     ([A-Za-z]) is not a hex class and does not qualify either.
      {
        src: String.raw`/\^(?!(?:https?|ftp|file|wss?|data|mailto)[:/])` + String.raw`(?!(?:sha(?:1|224|256|384|512)|md5|blake2[bs]|blake3):\[[0-9a-fA-F-]{3,}\])` + String.raw`[A-Za-z_][A-Za-z0-9_-]*:`,
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
    HAND_ROLLED_PATTERNS = HAND_ROLLED_PATTERN_SOURCES.map(({ src, label }) => ({
      pattern: new RegExp(src),
      label
    }));
  }
});

// ../src/modules/communication/workflows/no-accidental-write.ts
var yaml2, SETTINGS_JSON_REQUIRED_KEYS, SETTINGS_JSON_KNOWN_KEYS, WORKSPACE_JSON_REQUIRED_KEYS, PROVENANCE_JSON_REQUIRED_KEYS, TRACE_JSONL_REQUIRED_KEYS, DOCS_KNOWLEDGE_FRONTMATTER_REQUIRED_KEYS;
var init_no_accidental_write = __esm({
  "../src/modules/communication/workflows/no-accidental-write.ts"() {
    init_kernel();
    yaml2 = loadYamlApi();
    SETTINGS_JSON_REQUIRED_KEYS = Object.freeze([
      "rigor",
      "auto_approve",
      "review",
      "host",
      "agent_mode",
      "defaults"
    ]);
    SETTINGS_JSON_KNOWN_KEYS = sealSet([
      "rigor",
      "auto_approve",
      "review",
      "host",
      "host_mode",
      "roles",
      "host_profiles",
      "initiative_default",
      "index",
      "record_status_runs",
      "codex_skip_enforcement",
      "agent_mode",
      "workspace",
      "models",
      "security",
      "secrets_policy",
      "mcp",
      "capability",
      "statusline",
      "adversarial_review_provider",
      "loops",
      "loop_cap",
      "codex_cap",
      "defaults",
      "model_policy"
    ], "SETTINGS_JSON_KNOWN_KEYS");
    WORKSPACE_JSON_REQUIRED_KEYS = Object.freeze([
      "schema_version"
    ]);
    PROVENANCE_JSON_REQUIRED_KEYS = Object.freeze([
      "schema_version",
      "run_id"
    ]);
    TRACE_JSONL_REQUIRED_KEYS = Object.freeze([
      "ts",
      "event"
    ]);
    DOCS_KNOWLEDGE_FRONTMATTER_REQUIRED_KEYS = Object.freeze([
      "type",
      "owner",
      "created_at",
      "updated_at",
      "sensitivity"
    ]);
  }
});

// ../src/modules/communication/resources/scripts/lib/artifact-bus.ts
var TOPIC_TYPES, BUS_EVENT_KINDS;
var init_artifact_bus = __esm({
  "../src/modules/communication/resources/scripts/lib/artifact-bus.ts"() {
    TOPIC_TYPES = Object.freeze([
      "handoff",
      "status",
      "context",
      "review",
      "approval",
      "heartbeat"
    ]);
    BUS_EVENT_KINDS = Object.freeze([
      "artifact.published",
      "artifact.streaming",
      "artifact.closed",
      "artifact.retracted"
    ]);
  }
});

// ../src/modules/communication/workflows/artifact-bus.ts
var init_artifact_bus2 = __esm({
  "../src/modules/communication/workflows/artifact-bus.ts"() {
    init_artifact_bus();
  }
});

// ../src/modules/communication/index.ts
var init_communication = __esm({
  "../src/modules/communication/index.ts"() {
    init_comms_format_lint();
    init_no_accidental_write();
    init_artifact_bus2();
  }
});

// ../src/modules/teams/workflows/station-signals.ts
var STATION_SIGNAL_KEYS, SIGNAL_KEY_SET;
var init_station_signals = __esm({
  "../src/modules/teams/workflows/station-signals.ts"() {
    init_communication();
    init_kernel();
    init_station_composer();
    STATION_SIGNAL_KEYS = Object.freeze([
      "multi_component",
      "auth_touched",
      "backend_present",
      "user_facing_ui",
      "public_docs",
      "search_discoverability"
    ]);
    SIGNAL_KEY_SET = new Set(STATION_SIGNAL_KEYS);
  }
});

// ../src/modules/teams/index.ts
var init_teams = __esm({
  "../src/modules/teams/index.ts"() {
    init_team_file();
    init_canonical_hash();
    init_station_composer();
    init_station_signals();
  }
});

// ../src/modules/lifecycle/workflows/resume-lanes.ts
function parseResumeLanesArgs(argv) {
  const positionals = [];
  let json = false;
  let cwd;
  let slug;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (arg === "--cwd" && argv[i + 1] !== void 0) cwd = argv[++i];
    else if (arg.startsWith("--cwd=")) cwd = arg.slice("--cwd=".length);
    else if (arg === "--slug" && argv[i + 1] !== void 0) slug = argv[++i];
    else if (arg.startsWith("--slug=")) slug = arg.slice("--slug=".length);
    else if (!arg.startsWith("--")) positionals.push(arg);
  }
  const [runDir3] = positionals;
  if (!runDir3) {
    return { error: "usage: resume-lanes.ts <runDir> [--json] [--cwd <repo-root>] [--slug <slug>]" };
  }
  return { runDir: runDir3, json, cwd, slug };
}
function repoRootFromRunDir2(runDir3) {
  return path21.resolve(runDir3, "..", "..", "..");
}
function scanResumableLanes(runDir3, cwd, slug) {
  const repoRoot = cwd ?? repoRootFromRunDir2(runDir3);
  if (!readResumeEnabled(repoRoot)) {
    return [];
  }
  const lanesDir = path21.join(runDir3, "lanes");
  let entries;
  try {
    entries = fs17.readdirSync(lanesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const runState = loadRunState(runDir3);
  const planSlug = slug ?? runState?.plan_slug ?? null;
  const planTaskIds = planSlug ? readPlanTaskIdSet(repoRoot, planSlug) : /* @__PURE__ */ new Set();
  const validateAgainstPlan = planTaskIds.size > 0;
  const omittedOrphans = [];
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const laneId2 = entry.name;
    const cp = loadLaneResumeCheckpoint(runDir3, laneId2);
    if (!cp) continue;
    if (validateAgainstPlan && !planTaskIds.has(cp.lane_id)) {
      omittedOrphans.push(cp.lane_id);
      continue;
    }
    const tier = runState?.lanes?.[laneId2]?.tier;
    out.push(tier !== void 0 ? { ...cp, tier } : { ...cp });
  }
  if (omittedOrphans.length > 0) {
    process.stderr.write(
      `[resume-lanes] WARN: omitted ${omittedOrphans.length} non-resumable checkpoint(s) whose lane_id is not a plan task-id (orphan/fallback/name-keyed): ${omittedOrphans.join(", ")} \u2014 these cannot be auto-mapped to a plan lane (plan slug: ${planSlug}).
`
    );
  }
  out.sort((a, b) => a.lane_id.localeCompare(b.lane_id));
  return out;
}
function renderHuman(runDir3, lanes) {
  if (lanes.length === 0) {
    return `[resume-lanes] no resumable dead lanes in ${runDir3}
`;
  }
  const rows = [
    `[resume-lanes] ${lanes.length} resumable dead lane(s) in ${runDir3}:`,
    `  ${"LANE".padEnd(28)} ${"TIER".padEnd(9)} ${"ATTEMPTS".padEnd(9)} LAST_ERROR`,
    `  ${"\u2500".repeat(28)} ${"\u2500".repeat(9)} ${"\u2500".repeat(9)} ${"\u2500".repeat(40)}`
  ];
  for (const c of lanes) {
    const err = (c.last_error ?? "").slice(0, 60).replace(/\n/g, " ");
    rows.push(
      `  ${c.lane_id.padEnd(28)} ${(c.tier ?? "\u2014").padEnd(9)} ${String(c.attempts).padEnd(9)} ${err}`
    );
  }
  return rows.join("\n") + "\n";
}
function runResumeLanesCli() {
  const parsed = parseResumeLanesArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`[resume-lanes] ${parsed.error}
`);
    process.exit(1);
  }
  const lanes = scanResumableLanes(parsed.runDir, parsed.cwd, parsed.slug);
  if (parsed.json) {
    process.stdout.write(JSON.stringify(lanes, null, 2) + "\n");
  } else {
    process.stdout.write(renderHuman(parsed.runDir, lanes));
  }
  process.exit(0);
}
var fs17, path21;
var init_resume_lanes = __esm({
  "../src/modules/lifecycle/workflows/resume-lanes.ts"() {
    fs17 = __toESM(require("fs"));
    path21 = __toESM(require("path"));
    init_run_state();
    init_teams();
    if (require.main === module && new RegExp("[\\\\/]resume-lanes\\.[cm]?[jt]s$").test(process.argv[1] ?? "")) {
      runResumeLanesCli();
    }
  }
});

// ../src/modules/config/workflows/config-defaults.ts
var DEFAULT_ESCALATION_MARKERS, NON_INHERITABLE_KEYS, LOG_ROTATION_THRESHOLD_BYTES, SIDECAR_MAX_BYTES3, CAPABILITY_RESOLVER_MODES, CAPABILITY_AUTO_CREATE_POLICIES, CAPABILITY_RESOLVER_MODE_AFTER_F7, CAPABILITY_RESOLVER_MODE_DEFAULT, DEFAULTS;
var init_config_defaults = __esm({
  "../src/modules/config/workflows/config-defaults.ts"() {
    init_kernel();
    DEFAULT_ESCALATION_MARKERS = Object.freeze([
      "I'm not sure",
      "unclear",
      "cannot determine",
      "I don't know",
      "ambiguous",
      "uncertain",
      "not enough information"
    ]);
    NON_INHERITABLE_KEYS = sealSet([
      "initiative_default",
      // OD-1: attach-to-wrong-initiative risk
      "workspace"
      // workspace.mode is root-detection-only
    ], "NON_INHERITABLE_KEYS");
    LOG_ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;
    SIDECAR_MAX_BYTES3 = 1024 * 1024;
    CAPABILITY_RESOLVER_MODES = Object.freeze([
      "legacy",
      "observe",
      "shadow",
      "project-local",
      "strict"
    ]);
    CAPABILITY_AUTO_CREATE_POLICIES = Object.freeze(["never", "on_approval"]);
    CAPABILITY_RESOLVER_MODE_AFTER_F7 = "observe";
    CAPABILITY_RESOLVER_MODE_DEFAULT = CAPABILITY_RESOLVER_MODE_AFTER_F7;
    DEFAULTS = deepFreeze({
      rigor: "standard",
      auto_approve: [],
      review: "local",
      host: "auto",
      /**
       * rf-wi-01 (v23x-deferred-followups G1) — the sanctioned P1-L10 host-autonomy
       * override (host_mode × guild_gates orthogonality invariant, permission-policy-schema.ts).
       * null (default) = no override; the host's own default ("ask", lifted to "bypass_all" for
       * unattended team panes per issue #54) applies. NOT under `security.` — the #54 lane
       * explicitly reverted an ad-hoc `security.host_mode` key because it bypassed this schema;
       * this top-level placement (sibling of the `host` dispatch selector) is the registered
       * replacement. One of only three keys ever legitimately null-typed at the top level.
       */
      host_mode: null,
      roles: { host: null, advisory: null, adversarial: null },
      host_profiles: {},
      initiative_default: null,
      index: "auto",
      record_status_runs: true,
      codex_skip_enforcement: "warn",
      agent_mode: "auto",
      workspace: { mode: "auto" },
      models: {
        enabled: true,
        // G4b (host-reachability): every host in the registry's HOST_IDS gets an
        // explicit tier slot — NOT generated by importing HOST_IDS here (this file's
        // own contract, stated in the module doc comment above, is to stay free of
        // internal runtime imports so core settings code can load it before the
        // host-runtime layer). The literal key set below IS the full 16-id HOST_IDS
        // roster (host-registry-schema.ts) enumerated by hand; a jest test
        // (scripts/__tests__/config-defaults-tiers-host-ids.test.ts) asserts the two
        // stay in sync so this can never silently drift again the way it had (7 of
        // 16 hosts were missing a slot before this fix). Only claude-code-cli has a
        // non-null model — every other host's registry row carries `models.<tier>.model:
        // null` (no Guild-mapped model), so `null` here is the HONEST default, not a
        // gap (see tier-defaults.ts's `tierDefaults()` for the runtime-computed
        // equivalent this static scaffold mirrors).
        tiers: {
          cheap: { "claude-code-cli": "haiku", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null, cursor: null, "github-copilot": null, opencode: null, "rovo-dev": null, kiro: null, qoder: null, trae: null },
          mid: { "claude-code-cli": "sonnet", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null, cursor: null, "github-copilot": null, opencode: null, "rovo-dev": null, kiro: null, qoder: null, trae: null },
          powerful: { "claude-code-cli": "opus", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null, cursor: null, "github-copilot": null, opencode: null, "rovo-dev": null, kiro: null, qoder: null, trae: null }
        },
        scoreWeights: {
          workType: 0,
          blastRadius: 1,
          dependsOn: 1,
          security: 1,
          priorEscalation: 1
        },
        thresholds: { mid: 1, powerful: 3 },
        advisorRounds: 2,
        escalationMarkers: DEFAULT_ESCALATION_MARKERS,
        recallBeforeRead: true,
        recallScoreThreshold: 0.4,
        structuredOutputRequired: true,
        cacheTTL: { coordinator: "1h", leaf: "5m" },
        importanceGate: 3,
        compositeRecall: true,
        importanceAtIngest: true,
        ingestSimilarityGate: 0.8,
        shortOutputThreshold: {},
        knowledge: {
          maxDepth: 8,
          maxBranching: 12,
          minTopicImportance: 0.4,
          relMinConf: 0.5,
          maxFiles: 3e3,
          maxTokens: 1e6,
          batchSize: 20
        }
      },
      security: {
        bypass_permissions_policy: "audit"
      },
      secrets_policy: {
        env_allowlist: [],
        redaction_patterns: [],
        fail_mode_durable: "closed",
        fail_mode_telemetry: "open"
      },
      mcp: {
        tool_description_hashes: {},
        stdio_available: true,
        http_available: false,
        bridge_package: null
      },
      /**
       * Project-capability localization (spec S5; decisions cap-loc-D04 new-install
       * policy, cap-loc-D03 migration window). Closes audit gaps D12 (no config keys
       * existed), F3 (resolver-mode ownership undefined) and F10 (budget "3–4").
       *
       * These keys select WHICH DEFINITIONS RESOLVE — they are deliberately NOT
       * security-sensitive (`isSecuritySensitiveKey` matches none of them, correctly).
       * What a lane may DO stays with `capability_scope` and the permission keys.
       *
       * Scope is `project` for all four, which is what the CONFIG_SCHEMA generator
       * already emits unconditionally — capability ownership is per project by
       * definition (the umbrella and each child answer "what roles do I need"
       * independently, and D03 has the four repos migrating at different rates). Per
       * S5 spec-call #2, per-key `scope` is NOT introduced here: the right values fall
       * out with zero generator change, and adding it would touch every existing key.
       */
      capability: {
        /**
         * Which resolver mode this project is in on D03's migration ladder. Config
         * records WHERE WE ARE, never WHETHER WE MAY MOVE — advance conditions are
         * gate criteria the initiative evaluates, and a mode change is a deliberate
         * write.
         *
         * DEFAULT IS `observe` (D04), unlocked by F7 landing — see
         * CAPABILITY_RESOLVER_MODE_DEFAULT above for what would revert it. Never
         * silently defaulted: an unset value resolves with provenance `default`, so
         * `config show --sources` shows it was never chosen.
         */
        resolver_mode: CAPABILITY_RESOLVER_MODE_DEFAULT,
        /**
         * Max capability proposals surfaced per project (D04/F10: fixed at 4, not
         * "3–4"). Range [0, 4] — the same ceiling S1's profile validator enforces, so
         * the two cannot disagree. 0 is legal: "profile but never propose".
         */
        suggestion_budget: 4,
        /**
         * Roles a new install starts with. EMPTY BY DESIGN — a non-empty default would
         * ship a roster, which is precisely what localization exists to stop. Empty ⇒
         * Learn proposes.
         */
        starter_roles: [],
        /** Whether an approved proposal may auto-advance the resolver mode (D04). */
        auto_create_policy: "on_approval"
      },
      statusline: false,
      adversarial_review_provider: "auto",
      loops: null,
      loop_cap: 16,
      codex_cap: 5,
      // guild.model_policy.v2 (dynamic-host-model-routing T5): durable operator model
      // routing intent. null = not configured — v2 routing stays off and the legacy
      // tier maps drive generic preferences for the §6 migration window. When set, the
      // object must pass the §5 closed-key validator (config-cli validateModelPolicy).
      model_policy: null,
      defaults: {
        auto_learn: false,
        adversarial: "on",
        team: { size: null, always_include: [] },
        review_workflow: "standard",
        skill_policy: "standard",
        gates: { auto_approve: [] },
        wiki: { share_mode: "team", autopromote: false },
        quality: { budget: { per_class_minutes: 10, total_minutes: 30 } },
        reporting: "standard",
        index: {
          enabled: true,
          kg_node_threshold: 2e3,
          kg_size_threshold_mb: 1,
          links_edge_threshold: 2e3,
          runs_threshold: 20,
          wiki_file_threshold: 500
        },
        cross_host: { enabled: false, hosts: {}, fallback_to_claude: true },
        retry: { max_attempts: 1, backoff: "exponential" },
        resume: { enabled: true },
        heartbeat_timeout_ms: 6e5,
        capability_manifest_ttl_s: 3600,
        // plugin-update-lifecycle G1 AC-6: update-signal behavior. `notify` prints
        // the SessionStart signal; `auto` additionally stages the host apply path;
        // `off` silences everything. cadence_hours bounds the ls-remote cache TTL.
        update: { mode: "notify", cadence_hours: 24 },
        allowed_tools: [],
        /**
         * rf-wi-01 (G1) — registers the guard hooks/lib/lean-lead-guard.ts already reads
         * tolerantly. enabled: advisory master toggle. hands_on_edit_threshold: direct lead
         * Edit/Write ops before the inline-shortcut-expired advisory fires (SKILL.md
         * "Inline shortcut under high autonomy").
         */
        lean_lead: { enabled: true, hands_on_edit_threshold: 8 },
        /**
         * rf-wi-01 (G1) — registers the guard hooks/lib/lifecycle-gate.ts already reads
         * tolerantly. enabled: master toggle. adhoc_activity_threshold: ad-hoc (non-skill)
         * activity count before the lifecycle gate advisory fires.
         */
        lifecycle_gate: { enabled: true, adhoc_activity_threshold: 20 },
        /**
         * Issue #93 — dispatch-safety knobs for the #56 backend-degradation guard
         * (hooks/lib/backend-degradation.ts).
         *
         * `block_unmarked_lanes` engages STRICT mode: a Guild lane dispatch carrying
         * NO structured producer marker (`prompt_only` evidence — the hand-rolled
         * `Agent()` drift shape) becomes BLOCKABLE instead of merely recorded.
         *
         * DEFAULT IS `false` ON PURPOSE, and that is load-bearing rather than
         * timidity. `classifyLaneEvidence` grades a fully-substituted lane brief that
         * was merely QUOTED in a prompt as `prompt_only` too — by text it is
         * indistinguishable from the real dispatch (backend-degradation.ts's
         * lane-brief signature note, adversarial review round 3). So strict mode
         * trades the no-false-positive-on-a-quoted-brief invariant for tighter drift
         * coverage, which is an operator's call to make, never a shipped default.
         *
         * PR #85 (G3) shipped this rung as the env flag `GUILD_BLOCK_UNMARKED_LANES`
         * only, deliberately deferring schema registration to avoid colliding with
         * rf-wi-01's closed-schema work. That work landed (PR #87), so this is the
         * promised followup: the key is now discoverable and validated, and the env
         * var survives as a per-session OVERRIDE (both directions) on top of it.
         */
        dispatch: { block_unmarked_lanes: false }
      }
    });
  }
});

// ../src/modules/config/workflows/config-validation.ts
var init_config_validation = __esm({
  "../src/modules/config/workflows/config-validation.ts"() {
    init_host_runtime();
  }
});

// ../src/modules/config/workflows/workspace-manifest.ts
var init_workspace_manifest = __esm({
  "../src/modules/config/workflows/workspace-manifest.ts"() {
  }
});

// ../src/modules/config/workflows/settings-reader.ts
var yaml3, VALID_TIER_HOST_KEYS, KNOWN_HOST_IDS2, DISPATCH_HOST_IDS, RESOLVER_TIER1_KEYS;
var init_settings_reader = __esm({
  "../src/modules/config/workflows/settings-reader.ts"() {
    init_host_runtime();
    init_host_runtime();
    init_host_runtime();
    init_security();
    init_config_defaults();
    init_kernel();
    init_workspace_manifest();
    yaml3 = loadYamlApi();
    VALID_TIER_HOST_KEYS = new Set(HOST_IDS);
    KNOWN_HOST_IDS2 = new Set(HOST_IDS);
    DISPATCH_HOST_IDS = new Set(
      HOST_IDS.filter((id) => HOST_REGISTRY_ROWS[id].dispatch_selectable === true)
    );
    RESOLVER_TIER1_KEYS = sealSet([
      "rigor",
      "auto_approve",
      "review",
      "host",
      "host_mode",
      "roles",
      "host_profiles",
      "initiative_default",
      "index",
      "record_status_runs",
      "codex_skip_enforcement",
      "agent_mode",
      "workspace",
      "models",
      "security",
      "secrets_policy",
      "mcp",
      "capability",
      // S5 (cap-loc-D04) — capability localization policy
      "statusline",
      // R-009
      "adversarial_review_provider",
      // R-008
      "loops",
      "loop_cap",
      "codex_cap",
      "defaults",
      "model_policy"
      // T5 dynamic-host-model-routing: guild.model_policy.v2 (optional closed key)
    ], "RESOLVER_TIER1_KEYS");
  }
});

// ../src/modules/config/workflows/settings-resolver.ts
var init_settings_resolver = __esm({
  "../src/modules/config/workflows/settings-resolver.ts"() {
    init_settings_reader();
    init_settings_reader();
    init_telemetry();
    init_telemetry();
  }
});

// ../src/modules/config/workflows/tier-model.ts
var init_tier_model = __esm({
  "../src/modules/config/workflows/tier-model.ts"() {
    init_host_runtime();
  }
});

// ../src/modules/config/index.ts
var init_config2 = __esm({
  "../src/modules/config/index.ts"() {
    init_config_defaults();
    init_config_validation();
    init_settings_resolver();
    init_tier_model();
  }
});

// ../src/modules/lifecycle/workflows/retry-lane.ts
var init_retry_lane = __esm({
  "../src/modules/lifecycle/workflows/retry-lane.ts"() {
    init_config2();
  }
});

// ../src/modules/lifecycle/workflows/run-binding.ts
var init_run_binding = __esm({
  "../src/modules/lifecycle/workflows/run-binding.ts"() {
    init_kernel();
    init_stable_lock();
  }
});

// ../src/modules/lifecycle/workflows/write-run-manifest.ts
function manifestPathFor(cwd, slug) {
  return path22.join(cwd, ".guild", "programs", slug, "manifest.json");
}
function readRunManifest(cwd, slug) {
  try {
    const raw = fs18.readFileSync(manifestPathFor(cwd, slug), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function computeCurrentWave(waves) {
  if (waves.length === 0) return null;
  const sorted = [...waves].sort((a, b) => a.wave_index - b.wave_index);
  const pending = sorted.find((w) => w.status !== "completed");
  return pending ? pending.wave_index : sorted[sorted.length - 1].wave_index;
}
function writeRunManifest(cwd, manifest) {
  manifest.waves.sort((a, b) => a.wave_index - b.wave_index);
  manifest.current_wave = computeCurrentWave(manifest.waves);
  const out = manifestPathFor(cwd, manifest.slug);
  atomicWrite(out, JSON.stringify(manifest, null, 2) + "\n");
  return out;
}
function initRunManifest(cwd, slug, opts = {}) {
  const existing = readRunManifest(cwd, slug);
  if (existing) return existing;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const manifest = {
    schema_version: "guild.run_manifest.v1",
    slug,
    title: opts.title ?? null,
    status: "active",
    created_at: now,
    updated_at: now,
    current_wave: null,
    waves: []
  };
  writeRunManifest(cwd, manifest);
  return manifest;
}
function upsertWave(cwd, slug, patch2) {
  const manifest = readRunManifest(cwd, slug) ?? initRunManifest(cwd, slug);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let wave = manifest.waves.find((w) => w.wave_index === patch2.wave_index);
  if (!wave) {
    wave = {
      wave_index: patch2.wave_index,
      name: patch2.name ?? `wave-${patch2.wave_index}`,
      status: patch2.status ?? "pending",
      run_id: patch2.run_id ?? null,
      started_at: patch2.started_at ?? null,
      completed_at: patch2.completed_at ?? null,
      handoff_summary: patch2.handoff_summary ?? null
    };
    manifest.waves.push(wave);
  } else {
    if (patch2.name !== void 0) wave.name = patch2.name;
    if (patch2.status !== void 0) wave.status = patch2.status;
    if (patch2.run_id !== void 0) wave.run_id = patch2.run_id;
    if (patch2.started_at !== void 0) wave.started_at = patch2.started_at;
    if (patch2.completed_at !== void 0) wave.completed_at = patch2.completed_at;
    if (patch2.handoff_summary !== void 0) wave.handoff_summary = patch2.handoff_summary;
  }
  if (wave.status === "active" && wave.started_at === null && patch2.started_at === void 0) {
    wave.started_at = now;
  }
  if ((wave.status === "completed" || wave.status === "failed") && wave.completed_at === null && patch2.completed_at === void 0) {
    wave.completed_at = now;
  }
  manifest.updated_at = now;
  writeRunManifest(cwd, manifest);
  return manifest;
}
function setProgramStatus(cwd, slug, status) {
  const manifest = readRunManifest(cwd, slug) ?? initRunManifest(cwd, slug);
  manifest.status = status;
  manifest.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  writeRunManifest(cwd, manifest);
  return manifest;
}
function parseArgs2(argv) {
  const out = {
    cwd: process.env["GUILD_CWD"] ?? process.cwd(),
    slug: null,
    init: false,
    show: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cwd" && argv[i + 1]) out.cwd = argv[++i];
    else if (a === "--slug" && argv[i + 1]) out.slug = argv[++i];
    else if (a === "--init") out.init = true;
    else if (a === "--title" && argv[i + 1]) out.title = argv[++i];
    else if (a === "--wave" && argv[i + 1]) {
      const n = Number.parseInt(argv[++i], 10);
      if (Number.isFinite(n)) out.wave = n;
    } else if (a === "--wave-name" && argv[i + 1]) out.waveName = argv[++i];
    else if (a === "--wave-status" && argv[i + 1]) {
      const v = argv[++i];
      if (WAVE_STATUSES.has(v)) out.waveStatus = v;
    } else if (a === "--run-id" && argv[i + 1]) out.runId = argv[++i];
    else if (a === "--handoff-summary" && argv[i + 1]) out.handoffSummary = argv[++i];
    else if (a === "--status" && argv[i + 1]) {
      const v = argv[++i];
      if (PROGRAM_STATUSES.has(v)) out.status = v;
    } else if (a === "--show") out.show = true;
  }
  return out;
}
function runWriteRunManifestCli(argv = process.argv.slice(2)) {
  const args = parseArgs2(argv);
  if (!args.slug) {
    process.stderr.write("[write-run-manifest] ERROR: --slug <slug> is required.\n");
    process.exit(1);
  }
  if (!fs18.existsSync(args.cwd) || !fs18.statSync(args.cwd).isDirectory()) {
    process.stderr.write(`[write-run-manifest] ERROR: --cwd "${args.cwd}" is not a directory
`);
    process.exit(1);
  }
  try {
    let manifest = null;
    if (args.init) {
      manifest = initRunManifest(args.cwd, args.slug, { title: args.title });
    }
    if (args.wave !== void 0) {
      manifest = upsertWave(args.cwd, args.slug, {
        wave_index: args.wave,
        name: args.waveName,
        status: args.waveStatus,
        run_id: args.runId,
        handoff_summary: args.handoffSummary
      });
    }
    if (args.status !== void 0) {
      manifest = setProgramStatus(args.cwd, args.slug, args.status);
    }
    if (!args.init && args.wave === void 0 && args.status === void 0) {
      manifest = readRunManifest(args.cwd, args.slug);
      if (!manifest) {
        process.stderr.write(
          `[write-run-manifest] ERROR: no manifest for slug "${args.slug}" (pass --init to create one).
`
        );
        process.exit(1);
      }
    }
    if (args.show) {
      process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
    } else {
      process.stdout.write(manifestPathFor(args.cwd, args.slug) + "\n");
    }
  } catch (e) {
    process.stderr.write(`[write-run-manifest] ERROR: ${e.message}
`);
    process.exit(2);
  }
}
var fs18, path22, WAVE_STATUSES, PROGRAM_STATUSES;
var init_write_run_manifest = __esm({
  "../src/modules/lifecycle/workflows/write-run-manifest.ts"() {
    fs18 = __toESM(require("fs"));
    path22 = __toESM(require("path"));
    init_state();
    WAVE_STATUSES = /* @__PURE__ */ new Set(["pending", "active", "completed", "failed"]);
    PROGRAM_STATUSES = /* @__PURE__ */ new Set(["active", "completed", "paused", "aborted"]);
    if (require.main === module && new RegExp("[\\\\/]write-run-manifest\\.[cm]?[jt]s$").test(process.argv[1] ?? "")) {
      runWriteRunManifestCli();
    }
  }
});

// ../src/modules/lifecycle/workflows/run-manifest-wiring.ts
function validateRunManifest(raw) {
  const errors = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["manifest must be a non-null object"] };
  }
  const obj = raw;
  if (obj["schema_version"] !== "guild.run_manifest.v1") {
    errors.push(
      `schema_version must be "guild.run_manifest.v1"; got ${JSON.stringify(obj["schema_version"])}`
    );
  }
  for (const k of MANIFEST_REQUIRED_KEYS) {
    if (k === "schema_version") continue;
    if (!(k in obj)) {
      errors.push(`missing required key: ${k}`);
    }
  }
  if ("status" in obj) {
    const s = obj["status"];
    if (!PROGRAM_STATUSES2.includes(s)) {
      errors.push(
        `status must be one of ${PROGRAM_STATUSES2.join("|")}; got ${JSON.stringify(s)}`
      );
    }
  }
  if ("current_wave" in obj) {
    const cw = obj["current_wave"];
    if (cw !== null && typeof cw !== "number") {
      errors.push(`current_wave must be a number or null; got ${JSON.stringify(cw)}`);
    }
  }
  if ("waves" in obj) {
    if (!Array.isArray(obj["waves"])) {
      errors.push("waves must be an array");
    } else {
      const waves = obj["waves"];
      waves.forEach((w, i) => {
        if (w === null || typeof w !== "object" || Array.isArray(w)) {
          errors.push(`waves[${i}] must be an object`);
          return;
        }
        const wObj = w;
        for (const k of WAVE_REQUIRED_KEYS) {
          if (!(k in wObj)) {
            errors.push(`waves[${i}] missing required key: ${k}`);
          }
        }
        if ("wave_index" in wObj) {
          const wi = wObj["wave_index"];
          if (typeof wi !== "number" || !Number.isInteger(wi) || wi < 0) {
            errors.push(
              `waves[${i}].wave_index must be a non-negative integer; got ${JSON.stringify(wi)}`
            );
          }
        }
        if ("status" in wObj) {
          const ws = wObj["status"];
          const allWaveStatuses = [...WAVE_STATUSES2, "active", "pending"];
          if (!allWaveStatuses.includes(ws)) {
            errors.push(
              `waves[${i}].status must be one of ${allWaveStatuses.join("|")}; got ${JSON.stringify(ws)}`
            );
          }
        }
      });
    }
  }
  return { valid: errors.length === 0, errors };
}
function wireRunManifest(opts) {
  const { cwd, slug, now, title, wave, programStatus } = opts;
  let manifest = readRunManifest(cwd, slug);
  if (!manifest) {
    manifest = _buildInitialManifest(slug, title ?? null, now);
    writeRunManifest(cwd, manifest);
  }
  if (wave !== void 0) {
    manifest = _upsertWaveWithNow(cwd, slug, wave, now);
  }
  if (programStatus !== void 0) {
    manifest = _setProgramStatusWithNow(cwd, slug, programStatus, now);
  }
  const onDisk = readRunManifest(cwd, slug);
  if (!onDisk) {
    throw new Error(
      `[run-manifest-wiring] wireRunManifest: manifest not found on disk after write (cwd=${cwd}, slug=${slug})`
    );
  }
  const manifestPath = manifestPathFor(cwd, slug);
  const validation = validateRunManifest(onDisk);
  return { manifest: onDisk, manifestPath, validation };
}
function _buildInitialManifest(slug, title, now) {
  return {
    schema_version: "guild.run_manifest.v1",
    slug,
    title,
    status: "active",
    created_at: now,
    updated_at: now,
    current_wave: null,
    waves: []
  };
}
function _upsertWaveWithNow(cwd, slug, wave, now) {
  const manifest = upsertWave(cwd, slug, wave);
  manifest.updated_at = now;
  writeRunManifest(cwd, manifest);
  return manifest;
}
function _setProgramStatusWithNow(cwd, slug, status, now) {
  const manifest = setProgramStatus(cwd, slug, status);
  manifest.updated_at = now;
  writeRunManifest(cwd, manifest);
  return manifest;
}
function runRunManifestWiringCli(args = process.argv.slice(2)) {
  function getArg(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : void 0;
  }
  const cwd = getArg("--cwd") ?? process.env["GUILD_CWD"] ?? process.cwd();
  const slug = getArg("--slug");
  const now = getArg("--now") ?? (/* @__PURE__ */ new Date()).toISOString();
  const title = getArg("--title");
  const waveIndexRaw = getArg("--wave");
  const waveStatus = getArg("--wave-status");
  const runId = getArg("--run-id");
  const handoffSummary = getArg("--handoff-summary");
  const programStatus = getArg("--status");
  if (!slug) {
    process.stderr.write("[run-manifest-wiring] ERROR: --slug <slug> is required.\n");
    process.exit(1);
  }
  const wave = waveIndexRaw !== void 0 ? {
    wave_index: parseInt(waveIndexRaw, 10),
    status: waveStatus,
    run_id: runId ?? null,
    handoff_summary: handoffSummary ?? null
  } : void 0;
  try {
    const result = wireRunManifest({
      cwd,
      slug,
      title,
      now,
      wave,
      programStatus
    });
    if (!result.validation.valid) {
      process.stderr.write(
        `[run-manifest-wiring] WARN: validation errors after write:
` + result.validation.errors.map((e) => `  - ${e}`).join("\n") + "\n"
      );
    }
    process.stdout.write(result.manifestPath + "\n");
  } catch (e) {
    process.stderr.write(`[run-manifest-wiring] ERROR: ${e.message}
`);
    process.exit(2);
  }
}
var PROGRAM_STATUSES2, WAVE_STATUSES2, MANIFEST_REQUIRED_KEYS, WAVE_REQUIRED_KEYS;
var init_run_manifest_wiring = __esm({
  "../src/modules/lifecycle/workflows/run-manifest-wiring.ts"() {
    init_write_run_manifest();
    PROGRAM_STATUSES2 = Object.freeze(["active", "completed", "paused", "aborted"]);
    WAVE_STATUSES2 = Object.freeze(["pending", "active", "completed", "failed"]);
    MANIFEST_REQUIRED_KEYS = Object.freeze([
      "schema_version",
      "slug",
      "status",
      "created_at",
      "updated_at",
      "current_wave",
      "waves"
    ]);
    WAVE_REQUIRED_KEYS = Object.freeze([
      "wave_index",
      "status",
      "run_id",
      "started_at",
      "completed_at"
    ]);
    if (require.main === module && new RegExp("[\\\\/]run-manifest-wiring\\.[cm]?[jt]s$").test(process.argv[1] ?? "")) {
      runRunManifestWiringCli();
    }
  }
});

// ../src/modules/capability/workflows/catalog-cache.ts
var MODEL_CATALOG_CACHE_DIRNAME, MODEL_CATALOG_CACHE_REL_SEGMENTS, MODEL_CATALOG_CACHE_REL, CACHE_KEY_COMPONENTS;
var init_catalog_cache = __esm({
  "../src/modules/capability/workflows/catalog-cache.ts"() {
    MODEL_CATALOG_CACHE_DIRNAME = "model-catalog";
    MODEL_CATALOG_CACHE_REL_SEGMENTS = Object.freeze([".guild", "indexes", MODEL_CATALOG_CACHE_DIRNAME]);
    MODEL_CATALOG_CACHE_REL = MODEL_CATALOG_CACHE_REL_SEGMENTS.join("/");
    CACHE_KEY_COMPONENTS = Object.freeze([
      "target_id",
      "family",
      "surface",
      "provider_kind",
      "auth_mode",
      "account_fingerprint",
      "endpoint_fingerprint",
      "org_fingerprint",
      "tool_version",
      "adapter_id",
      "adapter_version",
      "run_scope"
    ]);
  }
});

// ../src/modules/capability/workflows/compatibility-usage.ts
var COMPATIBILITY_ASSET_KINDS, COMPATIBILITY_READ_REASONS, BENIGN_COMPATIBILITY_READ_REASONS, DEPENDENCE_COMPATIBILITY_READ_REASONS, BENIGN_REASON_SET, READ_REASON_SET, ASSET_KIND_SET, RESOLVER_MODE_SET;
var init_compatibility_usage = __esm({
  "../src/modules/capability/workflows/compatibility-usage.ts"() {
    init_config2();
    COMPATIBILITY_ASSET_KINDS = Object.freeze([
      "shipped_template",
      "shipped_domain_skill"
    ]);
    COMPATIBILITY_READ_REASONS = Object.freeze([
      "no_project_definition",
      "explicit_legacy_mode",
      "rollback",
      "mint_source",
      "shadow_comparison"
    ]);
    BENIGN_COMPATIBILITY_READ_REASONS = Object.freeze(["mint_source", "shadow_comparison"]);
    DEPENDENCE_COMPATIBILITY_READ_REASONS = Object.freeze(
      COMPATIBILITY_READ_REASONS.filter(
        (r) => !BENIGN_COMPATIBILITY_READ_REASONS.includes(r)
      )
    );
    BENIGN_REASON_SET = new Set(BENIGN_COMPATIBILITY_READ_REASONS);
    READ_REASON_SET = new Set(COMPATIBILITY_READ_REASONS);
    ASSET_KIND_SET = new Set(COMPATIBILITY_ASSET_KINDS);
    RESOLVER_MODE_SET = new Set(CAPABILITY_RESOLVER_MODES);
  }
});

// ../src/modules/capability/workflows/resolver-mode.ts
var RESOLVER_AUTHORITIES, CAPABILITY_RESOLUTION_INTENTS, MODE_POLICIES, RESOLVER_MODE_POLICIES, MODE_RANK, RESOLVER_MODE_FAILURES, RESOLVER_MODE_FAILURE_SET, MODE_TRANSITION_DIRECTIONS;
var init_resolver_mode = __esm({
  "../src/modules/capability/workflows/resolver-mode.ts"() {
    init_compatibility_usage();
    RESOLVER_AUTHORITIES = Object.freeze(["legacy", "project-local"]);
    CAPABILITY_RESOLUTION_INTENTS = Object.freeze([
      /** A live lane needs this definition to run. */
      "dispatch",
      /** Minting a project-local role FROM a shipped template. The migration WORKING. */
      "mint",
      /** The A-side of a shadow comparison. Also the migration working. */
      "shadow_compare",
      /** Replaying a historical run record against the compatibility surface. */
      "replay",
      /** A deliberate return to the legacy path after a failed adoption. */
      "rollback"
    ]);
    MODE_POLICIES = /* @__PURE__ */ new Map([
      [
        "legacy",
        Object.freeze({
          mode: "legacy",
          authority: "legacy",
          project_resolver_runs: false,
          capability_writes_permitted: false,
          project_side_effects_permitted: false,
          compatibility_available: true,
          compatibility_intents: Object.freeze([
            "dispatch",
            "mint",
            "replay",
            "rollback"
          ]),
          local_creation_permitted: false,
          profiles_emitted: false
        })
      ],
      [
        "observe",
        Object.freeze({
          mode: "observe",
          authority: "legacy",
          project_resolver_runs: true,
          // THE defining constraint of observe. D03's advance condition is a
          // before/after tree hash proving zero live writes; a policy that permitted
          // writes here would make that condition unprovable by construction.
          capability_writes_permitted: false,
          project_side_effects_permitted: false,
          compatibility_available: true,
          compatibility_intents: Object.freeze([
            "dispatch",
            "mint",
            "replay",
            "rollback"
          ]),
          local_creation_permitted: false,
          profiles_emitted: true
        })
      ],
      [
        "shadow",
        Object.freeze({
          mode: "shadow",
          authority: "legacy",
          project_resolver_runs: true,
          // Local creation is a HUMAN authority event, so it is permitted; but the
          // project-local RESOLVER still may not originate a mint or a dispatch. The
          // two are deliberately separate flags: collapsing them would either block
          // the approvals the phase exists to collect, or let the shadow side act.
          capability_writes_permitted: true,
          project_side_effects_permitted: false,
          compatibility_available: true,
          compatibility_intents: Object.freeze([
            "dispatch",
            "mint",
            "shadow_compare",
            "replay",
            "rollback"
          ]),
          local_creation_permitted: true,
          profiles_emitted: true
        })
      ],
      [
        "project-local",
        Object.freeze({
          mode: "project-local",
          authority: "project-local",
          project_resolver_runs: true,
          capability_writes_permitted: true,
          project_side_effects_permitted: true,
          compatibility_available: true,
          // NOT `dispatch`. A live dispatch with no project definition must FAIL
          // TYPED, not quietly read a shipped template — that silent read is the
          // exact behaviour the mode exists to end.
          compatibility_intents: Object.freeze(["replay", "rollback", "mint"]),
          local_creation_permitted: true,
          profiles_emitted: true
        })
      ],
      [
        "strict",
        Object.freeze({
          mode: "strict",
          authority: "project-local",
          project_resolver_runs: true,
          capability_writes_permitted: true,
          project_side_effects_permitted: true,
          // The end state: the surface is gone. No intent reaches it, including
          // replay — a strict project that still needs to replay history must step
          // back down the ladder deliberately, which is a recorded mode change.
          compatibility_available: false,
          compatibility_intents: Object.freeze([]),
          local_creation_permitted: true,
          profiles_emitted: true
        })
      ]
    ]);
    RESOLVER_MODE_POLICIES = Object.freeze(
      // Built from the PRIVATE policy map's own keys, NOT from the mutable exported
      // ladder — same reasoning as MODE_RANK below (CODEX #8).
      Object.fromEntries([...MODE_POLICIES].map(([m, p]) => [m, p]))
    );
    MODE_RANK = new Map(
      [...MODE_POLICIES.keys()].map((m, i) => [m, i])
    );
    RESOLVER_MODE_FAILURES = Object.freeze([
      /** The request itself was malformed (proxy, accessor, unknown key, bad scalar). */
      "invalid_request",
      /** `mode` is not a member of the ladder. NEVER coerced to the default. */
      "unknown_mode",
      /** No project-local definition exists, and the mode does not permit a compatibility read. */
      "no_project_definition",
      /** The mode has no compatibility surface at all (strict). */
      "compatibility_unavailable_in_mode",
      /** The surface exists, but not for this intent (e.g. `dispatch` under project-local). */
      "intent_not_permitted_in_mode",
      /** Neither a project definition nor a compatibility asset was supplied. */
      "no_definition_anywhere",
      /** The mode forbids the write this request would require. */
      "write_not_permitted_in_mode",
      /** A mode transition that skips rungs without an explicit acknowledgement. */
      "transition_skips_rungs",
      /** A downward transition without a recorded reason. */
      "transition_regresses_without_reason",
      /** Source and target are the same rung. */
      "transition_is_noop"
    ]);
    RESOLVER_MODE_FAILURE_SET = new Set(RESOLVER_MODE_FAILURES);
    MODE_TRANSITION_DIRECTIONS = Object.freeze(["advance", "regress"]);
  }
});

// ../src/modules/capability/workflows/compatibility-catalog.ts
var SHIPPED_TEMPLATE_COUNT, SHIPPED_DOMAIN_SKILL_IDS, SHIPPED_DOMAIN_SKILL_COUNT, SHIPPED_COMPATIBILITY_ASSET_COUNT, COMPATIBILITY_ASSET_ROOTS, COMPATIBILITY_DEPRECATION_STATES, DEPRECATION_STATE_SET;
var init_compatibility_catalog = __esm({
  "../src/modules/capability/workflows/compatibility-catalog.ts"() {
    init_compatibility_usage();
    init_resolver_mode();
    SHIPPED_TEMPLATE_COUNT = 15;
    SHIPPED_DOMAIN_SKILL_IDS = Object.freeze([
      "architect-adr-writer",
      "architect-systems-design",
      "architect-tradeoff-matrix",
      "backend-api-contract",
      "backend-data-layer",
      "backend-migration-writer",
      "backend-service-integration",
      "copywriter-email-sequences",
      "copywriter-long-form",
      "copywriter-product-microcopy",
      "copywriter-voice-guide",
      "devops-ci-cd-pipeline",
      "devops-incident-runbook",
      "devops-infrastructure-as-code",
      "devops-observability-setup",
      "doc-writer-doc-site",
      "doc-writer-onboarding-doc",
      "doc-writer-product-guide",
      "doc-writer-readme",
      "frontend-a11y",
      "frontend-bundler-config",
      "frontend-react",
      "frontend-state-management",
      "marketing-ab-copy-variants",
      "marketing-campaign-brief",
      "marketing-launch-plan",
      "marketing-positioning",
      "mobile-android-kotlin",
      "mobile-ios-swift",
      "mobile-performance-tuning",
      "mobile-react-native",
      "qa-flaky-test-hunter",
      "qa-property-based-tests",
      "qa-snapshot-tests",
      "qa-test-strategy",
      "researcher-comparison-table",
      "researcher-deep-dive",
      "researcher-paper-digest",
      "sales-cold-outreach",
      "sales-discovery-framework",
      "sales-follow-up-sequence",
      "sales-proposal-writer",
      "security-auth-flow-review",
      "security-dependency-audit",
      "security-secrets-scan",
      "security-threat-modeling",
      "seo-internal-linking",
      "seo-keyword-research",
      "seo-on-page-optimization",
      "seo-technical-audit",
      "social-media-content-calendar",
      "social-media-engagement-templates",
      "social-media-platform-post",
      "social-media-thread",
      "technical-writer-api-docs",
      "technical-writer-release-notes",
      "technical-writer-tutorial",
      "technical-writer-user-manual"
    ]);
    SHIPPED_DOMAIN_SKILL_COUNT = SHIPPED_DOMAIN_SKILL_IDS.length;
    SHIPPED_COMPATIBILITY_ASSET_COUNT = SHIPPED_TEMPLATE_COUNT + SHIPPED_DOMAIN_SKILL_COUNT;
    COMPATIBILITY_ASSET_ROOTS = Object.freeze({
      shipped_template: "templates/specialists",
      shipped_domain_skill: "skills/specialists"
    });
    COMPATIBILITY_DEPRECATION_STATES = Object.freeze([
      "active",
      "deprecated",
      "removal_cleared"
    ]);
    DEPRECATION_STATE_SET = new Set(COMPATIBILITY_DEPRECATION_STATES);
  }
});

// ../src/modules/capability/workflows/confirmation-arbiter.ts
var CONFIRMATION_KEY_COMPONENTS;
var init_confirmation_arbiter = __esm({
  "../src/modules/capability/workflows/confirmation-arbiter.ts"() {
    CONFIRMATION_KEY_COMPONENTS = Object.freeze([
      "run_id",
      "purpose",
      "target_id",
      "policy_hash",
      "catalog_hash",
      "fallback_hash"
    ]);
  }
});

// ../src/modules/capability/workflows/independence-predicates.ts
var init_independence_predicates = __esm({
  "../src/modules/capability/workflows/independence-predicates.ts"() {
  }
});

// ../src/modules/capability/workflows/independence-record.ts
var init_independence_record = __esm({
  "../src/modules/capability/workflows/independence-record.ts"() {
    init_independence_predicates();
  }
});

// ../src/modules/capability/workflows/model-catalog.ts
var EVIDENCE_STATES, NO_LISTING_GROUNDING, LISTING_AUTHORITY, LEGAL_EVIDENCE_TRANSITIONS;
var init_model_catalog = __esm({
  "../src/modules/capability/workflows/model-catalog.ts"() {
    init_catalog_cache();
    init_kernel();
    EVIDENCE_STATES = Object.freeze(["available", "advertised", "unknown", "unavailable"]);
    NO_LISTING_GROUNDING = Object.freeze({
      ceiling: "advertised",
      available_grounding: null
    });
    LISTING_AUTHORITY = Object.freeze({
      // The ONLY row carrying the /v1/models availability contract (matrix §3 [C2]).
      "claude-api": Object.freeze({
        ceiling: "available",
        available_grounding: Object.freeze({ adapter_id: "claude-api-models", source: "contract_api_list" })
      }),
      // Interactive-only picker; honest-unknown row — a picker listing can NEVER ground available.
      "claude-cli-subscription": NO_LISTING_GROUNDING,
      "claude-app": NO_LISTING_GROUNDING,
      "claude-web": NO_LISTING_GROUNDING,
      // Gateways: gateway-NATIVE evidence only, none evidenced today (§6 gateway rule) —
      // a listing caps at static-hint/native advertised; only §4 dispatch evidence upgrades.
      "claude-gateway-bedrock": NO_LISTING_GROUNDING,
      "claude-gateway-vertex": NO_LISTING_GROUNDING,
      "claude-gateway-foundry": NO_LISTING_GROUNDING,
      // Codex auth-list surfaces: entitlement semantics contractually undefined.
      "codex-app-server": NO_LISTING_GROUNDING,
      "codex-cli-chatgpt": NO_LISTING_GROUNDING,
      "codex-cli-api-key": NO_LISTING_GROUNDING,
      "openai-api": NO_LISTING_GROUNDING
    });
    LEGAL_EVIDENCE_TRANSITIONS = sealSet([
      "unknown->advertised",
      "unknown->available",
      "advertised->available",
      "advertised->unavailable",
      "available->unavailable",
      "advertised->unknown",
      "available->unknown",
      "unavailable->unknown"
    ]);
  }
});

// ../src/modules/capability/workflows/model-policy.ts
var POLICY_PURPOSES, REVIEW_CLASS_PURPOSES, COMPLEXITIES, CONDITION_KINDS, INDEPENDENCE_LEVELS, POLICY_TIERS, OPERATOR_BASELINE_POLICY;
var init_model_policy = __esm({
  "../src/modules/capability/workflows/model-policy.ts"() {
    init_kernel();
    POLICY_PURPOSES = Object.freeze([
      "general",
      "implementation",
      "planning",
      "research",
      "advisory",
      "adversarial",
      "security",
      "adversarial-security"
    ]);
    REVIEW_CLASS_PURPOSES = Object.freeze([
      "advisory",
      "adversarial",
      "security",
      "adversarial-security"
    ]);
    COMPLEXITIES = Object.freeze(["easy", "medium", "hard"]);
    CONDITION_KINDS = Object.freeze([
      "always",
      "producer_model_family_is",
      "producer_model_family_is_not"
    ]);
    INDEPENDENCE_LEVELS = Object.freeze(["none", "prefer_cross_family", "require_cross_family"]);
    POLICY_TIERS = Object.freeze(["cheap", "mid", "powerful"]);
    OPERATOR_BASELINE_POLICY = deepFreeze({
      version: 2,
      allow_advertised_attempt: false,
      purposes: {
        general: {
          min_effective_complexity: "easy",
          independence: "none",
          confirm_on_degradation: true,
          routes: [
            {
              complexity: "easy",
              preferred: [{ selector: "alias:haiku", effort: null, capabilities: [] }],
              fallbacks: [{ selector: "expr:tier=cheap" }],
              provider_default: "allow_last_resort"
            },
            {
              complexity: "medium",
              preferred: [{ selector: "alias:sonnet", effort: null, capabilities: [] }],
              fallbacks: [{ selector: "expr:tier=mid" }],
              provider_default: "allow_last_resort"
            },
            {
              complexity: "hard",
              preferred: [{ selector: "id:claude-fable-5", effort: null, capabilities: [] }],
              fallbacks: [{ selector: "id:claude-opus-4-8" }, { selector: "expr:tier=powerful" }],
              provider_default: "allow_last_resort"
            }
          ]
        },
        implementation: {
          min_effective_complexity: "easy",
          independence: "none",
          confirm_on_degradation: true,
          routes: [
            {
              complexity: "easy",
              preferred: [{ selector: "alias:haiku", effort: null, capabilities: [] }],
              fallbacks: [{ selector: "expr:tier=cheap" }],
              provider_default: "allow_last_resort"
            },
            {
              complexity: "medium",
              preferred: [{ selector: "alias:sonnet", effort: null, capabilities: [] }],
              fallbacks: [{ selector: "expr:tier=mid" }],
              provider_default: "allow_last_resort"
            },
            {
              complexity: "hard",
              preferred: [{ selector: "id:claude-fable-5", effort: null, capabilities: [] }],
              fallbacks: [{ selector: "id:claude-opus-4-8" }, { selector: "expr:tier=powerful" }],
              provider_default: "allow_last_resort"
            }
          ]
        },
        planning: {
          min_effective_complexity: "easy",
          independence: "none",
          confirm_on_degradation: true,
          routes: [
            {
              complexity: "easy",
              preferred: [{ selector: "alias:haiku", effort: null, capabilities: [] }],
              fallbacks: [{ selector: "expr:tier=cheap" }],
              provider_default: "allow_last_resort"
            },
            {
              complexity: "medium",
              preferred: [{ selector: "alias:sonnet", effort: null, capabilities: [] }],
              fallbacks: [{ selector: "expr:tier=mid" }],
              provider_default: "allow_last_resort"
            },
            {
              complexity: "hard",
              preferred: [{ selector: "id:claude-fable-5", effort: null, capabilities: [] }],
              fallbacks: [{ selector: "id:claude-opus-4-8" }, { selector: "expr:tier=powerful" }],
              provider_default: "allow_last_resort"
            }
          ]
        },
        research: {
          // Redundant with the §3 forced floor; stated for closure.
          min_effective_complexity: "hard",
          independence: "none",
          confirm_on_degradation: true,
          routes: [
            {
              complexity: "hard",
              // the ONLY reachable value (research_always_hard, §3)
              preferred: [{ selector: "id:claude-fable-5", effort: null, capabilities: [] }],
              fallbacks: [{ selector: "id:claude-opus-4-8" }, { selector: "expr:tier=powerful" }],
              provider_default: "forbid"
            }
          ]
        },
        advisory: {
          min_effective_complexity: "easy",
          independence: "prefer_cross_family",
          confirm_on_degradation: true,
          routes: [
            {
              complexity: "any",
              preferred: [{ selector: "id:gpt-5.6-sol", effort: "xhigh", capabilities: [] }],
              fallbacks: [{ selector: "expr:model_family=gpt;tier=powerful" }],
              provider_default: "forbid"
            }
          ]
        },
        adversarial: {
          min_effective_complexity: "easy",
          // Same-family fallback allowed but ALWAYS weak-labelled (resolution §7a).
          independence: "prefer_cross_family",
          confirm_on_degradation: true,
          routes: [
            {
              // Producer is not gpt-family → gpt reviewer is cross-family.
              complexity: "any",
              condition: { kind: "producer_model_family_is_not", model_family: "gpt" },
              preferred: [{ selector: "id:gpt-5.6-sol", effort: "xhigh", capabilities: [] }],
              fallbacks: [{ selector: "id:claude-opus-4-8" }],
              // may be same-family as producer ⇒ weak, labelled
              provider_default: "forbid"
            },
            {
              // Producer IS gpt-family → claude reviewer restores independence.
              complexity: "any",
              condition: { kind: "producer_model_family_is", model_family: "gpt" },
              preferred: [{ selector: "id:claude-opus-4-8", effort: null, capabilities: [] }],
              fallbacks: [{ selector: "expr:model_family=claude;tier=powerful" }],
              provider_default: "forbid"
            },
            {
              // Producer family unknown → weak either way (resolution §7a); review still runs.
              complexity: "any",
              preferred: [{ selector: "id:gpt-5.6-sol", effort: "xhigh", capabilities: [] }],
              fallbacks: [{ selector: "id:claude-opus-4-8" }],
              provider_default: "forbid"
            }
          ]
        },
        security: {
          min_effective_complexity: "easy",
          independence: "none",
          // same-family claude is deliberate (pinned-model rationale)
          confirm_on_degradation: true,
          routes: [
            {
              complexity: "any",
              preferred: [{ selector: "id:claude-opus-4-8", effort: null, capabilities: [] }],
              // pinned id REQUIRED (§5)
              fallbacks: [{ selector: "expr:model_family=claude;tier=powerful" }],
              provider_default: "forbid"
            }
          ]
        },
        "adversarial-security": {
          min_effective_complexity: "easy",
          independence: "require_cross_family",
          // adjudicated weak ⇒ NO strong sign-off (resolution §7a)
          confirm_on_degradation: true,
          routes: [
            {
              // Producer not gpt-family → gpt reviewer is cross-family.
              complexity: "any",
              condition: { kind: "producer_model_family_is_not", model_family: "gpt" },
              preferred: [{ selector: "id:gpt-5.6-sol", effort: "xhigh", capabilities: [] }],
              // Cannot restore independence on this branch ⇒ weak ⇒ NO strong sign-off.
              fallbacks: [{ selector: "id:claude-opus-4-8" }],
              provider_default: "forbid"
            },
            {
              // Producer IS gpt-family → claude restores family independence.
              complexity: "any",
              condition: { kind: "producer_model_family_is", model_family: "gpt" },
              preferred: [{ selector: "id:claude-opus-4-8", effort: null, capabilities: [] }],
              fallbacks: [],
              // nothing further — beyond this there is NO strong sign-off
              provider_default: "forbid"
            },
            {
              // Producer family unknown → weak regardless; NO strong sign-off.
              complexity: "any",
              preferred: [{ selector: "id:gpt-5.6-sol", effort: "xhigh", capabilities: [] }],
              fallbacks: [{ selector: "id:claude-opus-4-8" }],
              provider_default: "forbid"
            }
          ]
        }
      }
    });
  }
});

// ../src/modules/capability/workflows/model-resolver.ts
var FALLBACK_FAILURE_TAXONOMY, RESOLUTION_STATUSES;
var init_model_resolver = __esm({
  "../src/modules/capability/workflows/model-resolver.ts"() {
    init_teams();
    init_model_catalog();
    init_model_policy();
    FALLBACK_FAILURE_TAXONOMY = Object.freeze({
      model_overloaded: true,
      model_unavailable: true,
      server_nonretryable: true,
      auth_error: false,
      billing_error: false,
      rate_limited: false,
      request_invalid: false,
      transport_error: false,
      policy_refusal: false
    });
    RESOLUTION_STATUSES = Object.freeze([
      "served",
      "fallback_served",
      "exhausted",
      "user_declined",
      "failed_closed",
      "interrupted"
    ]);
  }
});

// ../src/modules/capability/workflows/model-inspect.ts
var init_model_inspect = __esm({
  "../src/modules/capability/workflows/model-inspect.ts"() {
    init_model_resolver();
    init_independence_predicates();
  }
});

// ../src/modules/capability/workflows/inspection-persist.ts
var init_inspection_persist = __esm({
  "../src/modules/capability/workflows/inspection-persist.ts"() {
    init_model_inspect();
  }
});

// ../src/modules/capability/workflows/routing-rollout.ts
var ROUTING_FLAG_KEYS, ROUTING_FLAG_DEFAULTS, FLAG_GROUPS;
var init_routing_rollout = __esm({
  "../src/modules/capability/workflows/routing-rollout.ts"() {
    init_teams();
    ROUTING_FLAG_KEYS = Object.freeze([
      "model_routing.identity_v2",
      "model_routing.binding_enforce",
      "model_routing.discovery",
      "model_routing.inspect",
      "model_routing.shadow",
      "model_routing.enabled",
      "teams.proposal_v2"
    ]);
    ROUTING_FLAG_DEFAULTS = Object.freeze({
      "model_routing.identity_v2": "on",
      "model_routing.binding_enforce": "on",
      "model_routing.discovery": "on",
      "model_routing.inspect": "on",
      "model_routing.shadow": "off",
      "model_routing.enabled": "off",
      "teams.proposal_v2": "on"
    });
    FLAG_GROUPS = Object.freeze({
      model_routing: [
        "identity_v2",
        "binding_enforce",
        "discovery",
        "inspect",
        "shadow",
        "enabled"
      ],
      teams: ["proposal_v2"]
    });
  }
});

// ../src/modules/capability/workflows/models-command.ts
var MODELS_COMMAND_USAGE;
var init_models_command = __esm({
  "../src/modules/capability/workflows/models-command.ts"() {
    init_host_runtime();
    init_security();
    init_catalog_cache();
    init_model_inspect();
    init_routing_rollout();
    MODELS_COMMAND_USAGE = [
      "usage: guild models inspect [--cwd <repo-root>] [--run-id <id>] [--json]",
      "",
      "  inspect   READ-ONLY view of this run's model routing: identity trust, target",
      "            evidence, catalog age, policy path, selection, fallbacks, actual",
      "            model, independence and degradation - with honest unknowns.",
      "",
      "  --cwd     repo root that owns .guild/ (default: process cwd)",
      "  --run-id  inspect this run (default: the intake candidate run, labeled)",
      "  --json    emit the same view model as JSON instead of text"
    ].join("\n");
  }
});

// ../src/modules/capability/workflows/inspection-record.ts
var init_inspection_record = __esm({
  "../src/modules/capability/workflows/inspection-record.ts"() {
    init_model_inspect();
    init_inspection_persist();
    init_models_command();
  }
});

// ../src/modules/capability/workflows/policy-migration.ts
var LEGACY_FILLABLE_PURPOSES;
var init_policy_migration = __esm({
  "../src/modules/capability/workflows/policy-migration.ts"() {
    init_model_policy();
    LEGACY_FILLABLE_PURPOSES = Object.freeze(["general", "implementation"]);
  }
});

// ../src/modules/capability/workflows/purpose-provenance.ts
var AUTHORITATIVE_PURPOSE_SOURCES;
var init_purpose_provenance = __esm({
  "../src/modules/capability/workflows/purpose-provenance.ts"() {
    init_model_policy();
    AUTHORITATIVE_PURPOSE_SOURCES = Object.freeze([
      "skill_metadata",
      "registry_metadata",
      "lane_lock",
      "broker_gate"
    ]);
  }
});

// ../src/modules/capability/workflows/tier-defaults.ts
var init_tier_defaults = __esm({
  "../src/modules/capability/workflows/tier-defaults.ts"() {
    init_host_runtime();
    init_host_runtime();
  }
});

// ../src/modules/capability/workflows/rank.ts
var init_rank = __esm({
  "../src/modules/capability/workflows/rank.ts"() {
    init_host_runtime();
    init_tier_defaults();
  }
});

// ../src/modules/capability/workflows/role-model-schema.ts
var ROLES, ROLE_STRENGTHS, ROLE_SET, STRENGTH_SET, HOST_ID_SET3;
var init_role_model_schema = __esm({
  "../src/modules/capability/workflows/role-model-schema.ts"() {
    init_host_runtime();
    ROLES = Object.freeze(["host", "advisory", "adversarial"]);
    ROLE_STRENGTHS = Object.freeze(["strong", "weak"]);
    ROLE_SET = new Set(ROLES);
    STRENGTH_SET = new Set(ROLE_STRENGTHS);
    HOST_ID_SET3 = new Set(HOST_IDS);
  }
});

// ../src/modules/review/workflows/review-progress.ts
var REVIEW_PROGRESS_STATES, STATE_SET;
var init_review_progress = __esm({
  "../src/modules/review/workflows/review-progress.ts"() {
    REVIEW_PROGRESS_STATES = Object.freeze([
      "launched",
      "running",
      "heartbeat",
      "activity",
      "no_output",
      "reviewer_error",
      "tool_error",
      "cancelled",
      "skipped",
      "succeeded"
    ]);
    STATE_SET = new Set(REVIEW_PROGRESS_STATES);
  }
});

// ../src/modules/review/workflows/review-pairing.ts
var init_review_pairing = __esm({
  "../src/modules/review/workflows/review-pairing.ts"() {
    init_capability();
    init_host_runtime();
    init_review_progress();
  }
});

// ../src/modules/review/resources/scripts/lib/advisory-record.ts
var ADVISORY_BACKENDS, ADVISORY_SUBSTRATES, ADVISORY_CONFIDENCE, ADVISORY_PHASES, BACKEND_SET, CONFIDENCE_SET, SUBSTRATE_SET;
var init_advisory_record = __esm({
  "../src/modules/review/resources/scripts/lib/advisory-record.ts"() {
    ADVISORY_BACKENDS = Object.freeze([
      "tmux_team",
      "host_subagents",
      "single_agent"
    ]);
    ADVISORY_SUBSTRATES = Object.freeze([
      "claude-code-cli",
      "codex-cli",
      "pi-cli",
      "antigravity-cli",
      "agents-file",
      "claude-code-app",
      "claude-code-web",
      "codex-app",
      "claude-ai-connector",
      // Legacy substrate labels accepted for older records.
      "claude",
      "codex",
      ".agents",
      "pi",
      "antigravity"
    ]);
    ADVISORY_CONFIDENCE = Object.freeze(["high", "medium", "low"]);
    ADVISORY_PHASES = Object.freeze([
      "init",
      "ideation",
      "planning",
      "execution",
      "review",
      "ops",
      "reflect"
    ]);
    BACKEND_SET = new Set(ADVISORY_BACKENDS);
    CONFIDENCE_SET = new Set(ADVISORY_CONFIDENCE);
    SUBSTRATE_SET = new Set(ADVISORY_SUBSTRATES);
  }
});

// ../src/modules/review/workflows/advisory-contract.ts
var init_advisory_contract = __esm({
  "../src/modules/review/workflows/advisory-contract.ts"() {
    init_advisory_record();
  }
});

// ../src/modules/review/index.ts
var init_review = __esm({
  "../src/modules/review/index.ts"() {
    init_review_pairing();
    init_review_progress();
    init_advisory_contract();
  }
});

// ../src/modules/capability/workflows/role-resolver.ts
var init_role_resolver = __esm({
  "../src/modules/capability/workflows/role-resolver.ts"() {
    init_host_runtime();
    init_role_model_schema();
    init_review();
  }
});

// ../src/modules/capability/workflows/tiebreak.ts
var init_tiebreak = __esm({
  "../src/modules/capability/workflows/tiebreak.ts"() {
    init_rank();
  }
});

// ../src/modules/capability/workflows/router.ts
var init_router = __esm({
  "../src/modules/capability/workflows/router.ts"() {
    init_config2();
    init_rank();
    init_tiebreak();
  }
});

// ../src/modules/capability/index.ts
var init_capability = __esm({
  "../src/modules/capability/index.ts"() {
    init_catalog_cache();
    init_compatibility_catalog();
    init_compatibility_usage();
    init_confirmation_arbiter();
    init_independence_predicates();
    init_independence_record();
    init_inspection_persist();
    init_inspection_record();
    init_model_catalog();
    init_model_inspect();
    init_model_policy();
    init_model_resolver();
    init_policy_migration();
    init_purpose_provenance();
    init_resolver_mode();
    init_rank();
    init_role_model_schema();
    init_routing_rollout();
    init_role_resolver();
    init_router();
    init_tiebreak();
    init_tier_defaults();
  }
});

// ../src/modules/lifecycle/workflows/runstart-preflight.ts
var init_runstart_preflight = __esm({
  "../src/modules/lifecycle/workflows/runstart-preflight.ts"() {
    init_config2();
    init_host_runtime();
    init_capability();
    init_config2();
  }
});

// ../src/modules/lifecycle/workflows/write-task-run.ts
function taskRunPath(cwd, runId, taskId) {
  return path23.join(cwd, ".guild", "runs", runId, "task-runs", `${taskId}.yaml`);
}
function writeTaskRun(cwd, runId, taskId, params) {
  const {
    initiativeId = null,
    taskRunId = "trun-001",
    specialist = "unknown",
    objective = "",
    contextBundle = "",
    phase = "execute",
    inputs = [],
    expectedOutputs = [],
    dependsOn = [],
    permissions = {},
    budget = {},
    autonomyPolicy = "autonomous_after_plan_approval",
    loopsApplicable = "none",
    host = {}
  } = params;
  const capReqs = host.capabilityRequirements ?? {};
  const eventsRef = `.guild/runs/${runId}/logs/v1.4-events.jsonl`;
  const taskRun = {
    schema_version: "guild.task_run.v1",
    ids: {
      initiative_id: initiativeId,
      run_id: runId,
      task_id: taskId,
      task_run_id: taskRunId
    },
    specialist,
    objective,
    context_bundle: contextBundle,
    inputs,
    expected_outputs: expectedOutputs,
    depends_on: dependsOn,
    permissions: {
      read: permissions.read ?? ["repo"],
      write: permissions.write ?? ["assigned_worktree"],
      network: permissions.network ?? "disabled_by_default",
      shell: permissions.shell ?? "approval_required",
      destructive: permissions.destructive ?? "approval_required"
    },
    budget: {
      max_turns: budget.maxTurns ?? 20,
      max_tokens: budget.maxTokens ?? 8e4
    },
    autonomy_policy: autonomyPolicy,
    loops_applicable: loopsApplicable,
    host: {
      requested: host.requested ?? "any",
      selected: null,
      capability_requirements: {
        needs_pr: capReqs.needsPr ?? false,
        needs_parallel: capReqs.needsParallel ?? false,
        needs_network: capReqs.needsNetwork ?? false,
        isolation: capReqs.isolation ?? "worktree"
      },
      model_params: host.modelParams ?? null
    },
    trace: {
      events_ref: eventsRef
    }
  };
  const doc = { task_run: taskRun };
  const outPath = taskRunPath(cwd, runId, taskId);
  const yamlStr = loadYamlApi().dump(doc, {
    indent: 2,
    lineWidth: -1,
    // no forced line wraps
    quotingType: '"',
    forceQuotes: false
  });
  atomicWrite(outPath, yamlStr);
  try {
    const _traceRunDir = path23.join(cwd, ".guild", "runs", runId);
    const _traceTs = (/* @__PURE__ */ new Date()).toISOString();
    const _traceBackend = "unknown";
    emitTraceEvent(
      makeDispatchEvent({
        ts: _traceTs,
        run_id: runId,
        lane_id: taskId,
        specialist,
        phase,
        task_id: taskId,
        backend: _traceBackend,
        backend_rung: 0,
        // not yet determined at write-task-run time
        dispatched_at: _traceTs
      }),
      _traceRunDir
    );
  } catch {
  }
  return outPath;
}
function parseArgs3(argv) {
  let cwd = "";
  let runId = "";
  let taskId = "";
  let taskRunId = "trun-001";
  let specialist = "unknown";
  let objective = "";
  let contextBundle = "";
  let initiativeId = null;
  let phase = "execute";
  let dependsOnRaw = "";
  let autonomyPolicy = "autonomous_after_plan_approval";
  let loopsApplicable = "none";
  let maxTurns = 20;
  let maxTokens = 8e4;
  let hostRequested = "any";
  let needsPr = false;
  let needsParallel = false;
  let needsNetwork = false;
  let isolation = "worktree";
  let modelParams = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--cwd":
        cwd = next;
        i++;
        break;
      case "--run-id":
        runId = next;
        i++;
        break;
      case "--task-id":
        taskId = next;
        i++;
        break;
      case "--task-run-id":
        taskRunId = next;
        i++;
        break;
      case "--specialist":
        specialist = next;
        i++;
        break;
      case "--objective":
        objective = next;
        i++;
        break;
      case "--context-bundle":
        contextBundle = next;
        i++;
        break;
      case "--initiative-id":
        initiativeId = next;
        i++;
        break;
      case "--phase":
        phase = next;
        i++;
        break;
      case "--depends-on":
        dependsOnRaw = next;
        i++;
        break;
      case "--autonomy-policy":
        autonomyPolicy = next;
        i++;
        break;
      case "--loops-applicable":
        loopsApplicable = next;
        i++;
        break;
      case "--host-requested":
        hostRequested = next;
        i++;
        break;
      case "--max-turns":
        maxTurns = parseInt(next, 10);
        i++;
        break;
      case "--max-tokens":
        maxTokens = parseInt(next, 10);
        i++;
        break;
      case "--needs-pr":
        needsPr = true;
        break;
      case "--needs-parallel":
        needsParallel = true;
        break;
      case "--needs-network":
        needsNetwork = true;
        break;
      case "--isolation":
        isolation = next;
        i++;
        break;
      case "--model-params": {
        try {
          const parsed = JSON.parse(next);
          if (parsed && typeof parsed.model === "string" && parsed.model.trim()) {
            modelParams = parsed;
          }
        } catch {
          return { error: "--model-params must be JSON with a non-empty model string" };
        }
        i++;
        break;
      }
    }
  }
  if (!cwd) return { error: "--cwd is required" };
  if (!runId) return { error: "--run-id is required" };
  if (!taskId) return { error: "--task-id is required" };
  const dependsOn = dependsOnRaw ? dependsOnRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return {
    cwd,
    runId,
    taskId,
    params: {
      initiativeId,
      taskRunId,
      specialist,
      objective,
      contextBundle,
      phase,
      dependsOn,
      autonomyPolicy,
      loopsApplicable,
      budget: { maxTurns, maxTokens },
      host: {
        requested: hostRequested,
        capabilityRequirements: { needsPr, needsParallel, needsNetwork, isolation },
        modelParams
      }
    }
  };
}
function runWriteTaskRunCli(argv = process.argv.slice(2)) {
  const parsed = parseArgs3(argv);
  if ("error" in parsed) {
    process.stderr.write(`[write-task-run] ${parsed.error}
`);
    process.exit(1);
  }
  try {
    const outPath = writeTaskRun(parsed.cwd, parsed.runId, parsed.taskId, parsed.params);
    process.stdout.write(outPath + "\n");
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[write-task-run] Error: ${err}
`);
    process.exit(2);
  }
}
var path23;
var init_write_task_run = __esm({
  "../src/modules/lifecycle/workflows/write-task-run.ts"() {
    path23 = __toESM(require("path"));
    init_telemetry();
    init_kernel();
    init_state();
    if (require.main === module && new RegExp("[\\\\/]write-task-run\\.[cm]?[jt]s$").test(process.argv[1] ?? "")) {
      runWriteTaskRunCli();
    }
  }
});

// ../src/modules/lifecycle/index.ts
var init_lifecycle = __esm({
  "../src/modules/lifecycle/index.ts"() {
    init_neutral_runtime_contracts();
    init_neutral_gate_policy();
    init_neutral_lifecycle_machine();
    init_neutral_conformance_core();
    init_neutral_core_boundary();
    init_neutral_conformance_assembly();
    init_module_boundary_conformance_evaluator();
    init_check_lane_liveness();
    init_emit_loop_event();
    init_mark_lane_dead();
    init_resume_lanes();
    init_retry_lane();
    init_run_binding();
    init_run_lifecycle();
    init_run_manifest_wiring();
    init_runstart_preflight();
    init_write_run_manifest();
    init_write_task_run();
  }
});

// ../src/modules/host-runtime/workflows/host-adapter-conformance-evaluator.ts
function declaresCallerScenarioSet(request) {
  if (request === null || typeof request !== "object") return false;
  if (!("stable_ids" in request)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(request, "stable_ids");
  if (descriptor === void 0) return true;
  if (descriptor.get !== void 0 || descriptor.set !== void 0) return true;
  return descriptor.value !== void 0;
}
function identityIsComplete5(identity) {
  if (identity === null || typeof identity !== "object") return false;
  const record = identity;
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    const value = record[field];
    if (field === "contract_version") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}
function copyIdentity3(identity) {
  const source = identity;
  const copy = {};
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) copy[field] = source[field];
  return copy;
}
function refuseEvaluation2(control, reasonCode, assertions) {
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "refused",
      reason_code: reasonCode,
      assertions: [...assertions],
      facts: {
        refusal_control: control,
        owner_key: MH03_CONFORMANCE_OWNER_KEY,
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        evidence: []
      }
    }),
    packet: null
  };
}
function bindProbe(port, store, runId, provider, probe) {
  const result = port.bindHostRuntimeAdapter({
    host: probe.host_id,
    runId,
    provider,
    hostVersion: probe.host_version,
    authentication: probe.authentication,
    snapshots: store
  });
  const binding = result.disposition === "succeeded" ? result.binding : null;
  return { probe, result, binding };
}
function normalizeThrough(bound, nativeEvent) {
  return bound.binding === null ? null : bound.binding.normalizeEvent(nativeEvent);
}
function snapshotOf(bound) {
  return bound.binding === null ? null : bound.binding.snapshot;
}
function factOf(snapshot, capabilityId) {
  if (snapshot === null) return null;
  const found = snapshot.capabilities.find((fact) => fact.capability_id === capabilityId);
  return found === void 0 ? null : found;
}
function hostIdOf(bound) {
  return bound.binding === null ? bound.probe.host_id : bound.binding.host_id;
}
function hostVersionOf(bound) {
  const snapshot = snapshotOf(bound);
  return snapshot === null ? bound.probe.host_version : snapshot.host_version;
}
function requiresAuth(bound) {
  return bound.binding === null ? false : bound.binding.entry_point.requires_auth === true;
}
function evaluateMh03HostAdapterConformance(request) {
  if (declaresCallerScenarioSet(request)) {
    return refuseEvaluation2(
      MH03_REFUSAL_CONTROL_CALLER_SUPPLIED_IDS,
      "scenario_required_set_mismatch",
      [
        "the covered scenario set has exactly one source, and it is this module",
        "an agreeing caller-supplied set is refused too, because accepting a matching copy accepts the channel"
      ]
    );
  }
  if (!identityIsComplete5(request.evidence_identity)) {
    return refuseEvaluation2(MH03_REFUSAL_CONTROL_IDENTITY_INCOMPLETE, "scenario_evidence_incomplete", [
      "evidence that names no complete identity is bound to no runtime"
    ]);
  }
  for (const stableId of MH03_CONFORMANCE_SCENARIO_IDS) {
    const receiptRef = request.receipt_refs === void 0 ? void 0 : request.receipt_refs[stableId];
    const freshness = request.evidence_freshness === void 0 ? void 0 : request.evidence_freshness[stableId];
    if (typeof receiptRef !== "string" || receiptRef.length === 0) {
      return refuseEvaluation2(MH03_REFUSAL_CONTROL_EVIDENCE_BINDING_MISSING, "scenario_receipt_reference_missing", [
        "every scenario result commits to a receipt reference"
      ]);
    }
    if (NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS.indexOf(freshness) === -1) {
      return refuseEvaluation2(MH03_REFUSAL_CONTROL_EVIDENCE_BINDING_MISSING, "scenario_evidence_incomplete", [
        "every scenario result carries a typed freshness verdict"
      ]);
    }
  }
  const port = request.boundary === void 0 ? MH03_PRODUCTION_BOUNDARY : request.boundary;
  const runId = String(request.run_id === void 0 || request.run_id === null ? "" : request.run_id);
  const store = port.createHostCapabilitySnapshotStore();
  const nativeHookHost = bindProbe(port, store, runId, request.adapter_provider, MH03_NATIVE_HOOK_PROBE);
  const wrapperHost = bindProbe(port, store, runId, request.adapter_provider, MH03_WRAPPER_PROBE);
  const boundFor = (probe) => probe === MH03_WRAPPER_PROBE ? wrapperHost : nativeHookHost;
  const evt001Bindings = MH03_EVENT_BINDING_PROBES.map((probe) => {
    const bound = boundFor(probe.host);
    const normalized = normalizeThrough(bound, probe.native_event);
    const event = normalized === null ? null : normalized.event;
    return {
      host_id: hostIdOf(bound),
      native_event: probe.native_event,
      source_kind: normalized === null ? "none" : normalized.source_kind,
      normalized_event: event === null || event === void 0 ? null : event.name,
      succeeded: normalized !== null && normalized.disposition === "succeeded",
      provenance_host_id: event === null || event === void 0 ? null : event.host_native.host_id,
      provenance_native_event: event === null || event === void 0 ? null : event.host_native.native_event
    };
  });
  const evt001SourceKinds = evt001Bindings.map((entry) => entry.source_kind).filter((kind, index, all) => all.indexOf(kind) === index);
  const evt001Satisfied = evt001Bindings.length >= 2 && evt001SourceKinds.length >= 2 && evt001Bindings.every(
    (entry) => entry.succeeded && entry.normalized_event === MH03_SHARED_SEMANTIC_EVENT && entry.provenance_host_id === entry.host_id && entry.provenance_native_event === entry.native_event
  );
  const evt002Normalized = normalizeThrough(nativeHookHost, MH03_UNREGISTERED_NATIVE_EVENT);
  const evt002Event = evt002Normalized === null ? null : evt002Normalized.event;
  const evt002ReasonCode = evt002Normalized === null ? null : evt002Normalized.reason_code;
  const evt002Satisfied = evt002Normalized !== null && evt002Normalized.disposition !== "succeeded" && evt002ReasonCode === MH03_SATISFIED_REASON_CODES["MHRC-EVT-002"] && (evt002Event === null || evt002Event === void 0);
  const uns001Snapshot = snapshotOf(nativeHookHost);
  const uns001Fact = factOf(uns001Snapshot, MH03_ABSENT_CAPABILITY_ID);
  const uns001Satisfied = uns001Fact !== null && uns001Fact.supported === false;
  const uns003Snapshot = snapshotOf(wrapperHost);
  const uns003Fact = factOf(uns003Snapshot, MH03_CREDENTIALED_CAPABILITY_ID);
  const uns003RequiresAuth = requiresAuth(wrapperHost);
  const uns003Satisfied = uns003Fact !== null && uns003Fact.supported === true && uns003Fact.authenticated === false && uns003RequiresAuth;
  const observations = {
    "MHRC-EVT-001": {
      normalized_event: evt001Satisfied ? MH03_SHARED_SEMANTIC_EVENT : null,
      bindings: evt001Bindings.map((entry) => ({
        host_id: entry.host_id,
        native_event: entry.native_event,
        source_kind: entry.source_kind,
        normalized_event: entry.normalized_event,
        provenance_host_id: entry.provenance_host_id,
        provenance_native_event: entry.provenance_native_event
      })),
      source_kinds: [...evt001SourceKinds]
    },
    "MHRC-EVT-002": {
      host_id: hostIdOf(nativeHookHost),
      native_event: MH03_UNREGISTERED_NATIVE_EVENT,
      normalized_event: evt002Event === null || evt002Event === void 0 ? null : evt002Event.name,
      boundary_disposition: evt002Normalized === null ? null : evt002Normalized.disposition,
      boundary_reason_code: evt002ReasonCode
    },
    "MHRC-UNS-001": {
      host_id: hostIdOf(nativeHookHost),
      host_version: hostVersionOf(nativeHookHost),
      authentication: nativeHookHost.probe.authentication,
      capability_id: MH03_ABSENT_CAPABILITY_ID,
      supported: uns001Fact === null ? null : uns001Fact.supported,
      authenticated: uns001Fact === null ? null : uns001Fact.authenticated,
      snapshot_hash: uns001Snapshot === null ? null : uns001Snapshot.snapshot_hash,
      fallback_selected: false
    },
    "MHRC-UNS-003": {
      host_id: hostIdOf(wrapperHost),
      host_version: hostVersionOf(wrapperHost),
      authentication: wrapperHost.probe.authentication,
      capability_id: MH03_CREDENTIALED_CAPABILITY_ID,
      supported: uns003Fact === null ? null : uns003Fact.supported,
      authenticated: uns003Fact === null ? null : uns003Fact.authenticated,
      requires_auth: uns003RequiresAuth,
      snapshot_hash: uns003Snapshot === null ? null : uns003Snapshot.snapshot_hash,
      fallback_selected: false
    }
  };
  const satisfaction = {
    "MHRC-EVT-001": evt001Satisfied,
    "MHRC-EVT-002": evt002Satisfied,
    "MHRC-UNS-001": uns001Satisfied,
    "MHRC-UNS-003": uns003Satisfied
  };
  const evidence = MH03_CONFORMANCE_SCENARIO_IDS.map((stableId) => ({
    stable_id: stableId,
    satisfied: satisfaction[stableId] === true,
    observed: observations[stableId]
  }));
  const results = MH03_CONFORMANCE_SCENARIOS.map((scenario) => {
    const stableId = scenario.stable_id;
    const satisfied = satisfaction[stableId] === true;
    return {
      stable_id: stableId,
      outcome_type: scenario.expected_typed_outcome.type,
      disposition: satisfied ? scenario.expected_typed_outcome.disposition : "failed",
      reason_code: satisfied ? MH03_SATISFIED_REASON_CODES[stableId] : MH03_UNSATISFIED_REASON_CODE,
      receipt_ref: request.receipt_refs[stableId],
      evidence_identity: copyIdentity3(request.evidence_identity),
      evidence_freshness: request.evidence_freshness[stableId]
    };
  });
  const allSatisfied = evidence.every((entry) => entry.satisfied);
  const packet = {
    schema_version: MH03_CONFORMANCE_PACKET_SCHEMA,
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    owner_key: MH03_CONFORMANCE_OWNER_KEY,
    evidence_identity: copyIdentity3(request.evidence_identity),
    stable_ids: [...MH03_CONFORMANCE_SCENARIO_IDS],
    results
  };
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: allSatisfied ? "succeeded" : "failed",
      reason_code: allSatisfied ? null : MH03_UNSATISFIED_REASON_CODE,
      assertions: [
        "each of the four W2/MH-03 scenarios was evaluated against the real host-adapter boundary",
        "two host-native producers were normalized through their own bindings, provenance retained",
        "an unregistered native event is reported unsupported and synthesizes no success event",
        "an unusable credential on a supported capability is failed, never unsupported",
        "no lifecycle policy, promotion decision, assembly, or signature verification happens here"
      ],
      binding: { run_id: runId },
      facts: {
        owner_key: MH03_CONFORMANCE_OWNER_KEY,
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        evidence,
        evaluated_hosts: [hostIdOf(nativeHookHost), hostIdOf(wrapperHost)],
        binding_dispositions: {
          [hostIdOf(nativeHookHost)]: nativeHookHost.result.disposition,
          [hostIdOf(wrapperHost)]: wrapperHost.result.disposition
        }
      }
    }),
    packet: neutralFreeze(packet)
  };
}
var MH03_CONFORMANCE_OWNER_KEY, MH03_CONFORMANCE_PACKET_SCHEMA, MH03_AUTHENTICATION_FAILURE_REASON_CODE, MH03_UNSATISFIED_REASON_CODE, MH03_REFUSAL_CONTROL_CALLER_SUPPLIED_IDS, MH03_REFUSAL_CONTROL_IDENTITY_INCOMPLETE, MH03_REFUSAL_CONTROL_EVIDENCE_BINDING_MISSING, MH03_WAVE_OWNER, MH03_CONFORMANCE_SCENARIOS, MH03_CONFORMANCE_SCENARIO_IDS, MH03_SATISFIED_REASON_CODES, MH03_PRODUCTION_BOUNDARY, MH03_PROBE_HOST_VERSION, MH03_NATIVE_HOOK_PROBE, MH03_WRAPPER_PROBE, MH03_SHARED_SEMANTIC_EVENT, MH03_EVENT_BINDING_PROBES, MH03_UNREGISTERED_NATIVE_EVENT, MH03_ABSENT_CAPABILITY_ID, MH03_CREDENTIALED_CAPABILITY_ID;
var init_host_adapter_conformance_evaluator = __esm({
  "../src/modules/host-runtime/workflows/host-adapter-conformance-evaluator.ts"() {
    init_host_adapter_boundary();
    init_host_capability_snapshot();
    init_host_event_normalizer();
    init_lifecycle();
    MH03_CONFORMANCE_OWNER_KEY = "W2/MH-03";
    MH03_CONFORMANCE_PACKET_SCHEMA = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;
    MH03_AUTHENTICATION_FAILURE_REASON_CODE = "authentication_failed";
    MH03_UNSATISFIED_REASON_CODE = "scenario_result_mismatch";
    MH03_REFUSAL_CONTROL_CALLER_SUPPLIED_IDS = "caller_supplied_scenario_ids";
    MH03_REFUSAL_CONTROL_IDENTITY_INCOMPLETE = "evidence_identity_incomplete";
    MH03_REFUSAL_CONTROL_EVIDENCE_BINDING_MISSING = "evidence_binding_missing";
    MH03_WAVE_OWNER = Object.freeze({
      wave_id: "W2",
      work_item_id: "MH-03",
      key: MH03_CONFORMANCE_OWNER_KEY
    });
    MH03_CONFORMANCE_SCENARIOS = neutralFreeze([
      {
        stable_id: "MHRC-EVT-001",
        category: "normalized_event",
        title: "Host-native events normalize to the same semantic event",
        preconditions: [
          "two adapter bindings declare the same semantic event coverage",
          "native payloads represent the same operator action",
          "adapter versions are recorded"
        ],
        action_event: { name: "prompt.submit", input: { native_event_matrix: "host-specific equivalent payloads" } },
        expected_typed_outcome: {
          type: "guild.normalized_event_outcome.v1",
          disposition: "succeeded",
          assertions: [
            "normalized event name and semantic payload are equal",
            "host-native provenance remains attributable",
            "normalization does not add lifecycle policy"
          ]
        },
        evidence_requirements: [
          {
            profile: "E-LIFECYCLE",
            assertions: [
              "native-input hash and normalized-output hash recorded per host",
              "semantic comparison excludes declared provenance fields only"
            ]
          }
        ],
        implementation_wave_owner: MH03_WAVE_OWNER
      },
      {
        stable_id: "MHRC-EVT-002",
        category: "normalized_event",
        title: "Unknown native event is explicit and non-mutating",
        preconditions: [
          "the adapter receives an unregistered native event",
          "the immutable capability snapshot does not declare a mapping"
        ],
        action_event: { name: "tool.after", input: { native_event: "unmapped" } },
        expected_typed_outcome: {
          type: "guild.normalized_event_outcome.v1",
          disposition: "unsupported",
          assertions: [
            "reason code identifies unmapped_event",
            "lifecycle state is unchanged",
            "unsupported observation is durably recorded"
          ]
        },
        evidence_requirements: [
          {
            profile: "E-REFUSAL",
            assertions: ["native event provenance is retained", "no synthesized success event exists"]
          }
        ],
        implementation_wave_owner: MH03_WAVE_OWNER
      },
      {
        stable_id: "MHRC-UNS-001",
        category: "unsupported_refusal",
        title: "Unsupported capability returns a typed outcome",
        preconditions: [
          "the immutable capability snapshot marks the operation unsupported",
          "the caller requests that operation"
        ],
        action_event: { name: "task.dispatch", input: { required_capability: "absent" } },
        expected_typed_outcome: {
          type: "guild.capability_outcome.v1",
          disposition: "unsupported",
          assertions: ["reason code and capability id are present", "no fallback is implied", "no side effect occurs"]
        },
        evidence_requirements: [
          {
            profile: "E-REFUSAL",
            assertions: ["snapshot hash proves capability absence", "unsupported receipt is durable"]
          }
        ],
        implementation_wave_owner: MH03_WAVE_OWNER
      },
      {
        stable_id: "MHRC-UNS-003",
        category: "unsupported_refusal",
        title: "Authentication failure is explicit and non-degrading by default",
        preconditions: [
          "the capability exists",
          "host authentication is unavailable or invalid",
          "no approved fallback host is selected"
        ],
        action_event: { name: "task.dispatch", input: { auth_state: "invalid" } },
        expected_typed_outcome: {
          type: "guild.capability_outcome.v1",
          disposition: "failed",
          assertions: [
            "reason code identifies authentication failure",
            "the outcome is not reported as unsupported",
            "silent fallback is prohibited"
          ]
        },
        evidence_requirements: [
          {
            profile: "E-REFUSAL",
            assertions: [
              "sensitive credentials are redacted",
              "failure receipt records selected host and no side effect"
            ]
          }
        ],
        implementation_wave_owner: MH03_WAVE_OWNER
      }
    ]);
    MH03_CONFORMANCE_SCENARIO_IDS = Object.freeze(
      MH03_CONFORMANCE_SCENARIOS.map((scenario) => scenario.stable_id)
    );
    MH03_SATISFIED_REASON_CODES = Object.freeze({
      "MHRC-EVT-001": null,
      "MHRC-EVT-002": "unknown_event",
      "MHRC-UNS-001": "capability_absent",
      "MHRC-UNS-003": MH03_AUTHENTICATION_FAILURE_REASON_CODE
    });
    MH03_PRODUCTION_BOUNDARY = Object.freeze({
      bindHostRuntimeAdapter,
      createHostCapabilitySnapshotStore,
      normalizeHostEvent
    });
    MH03_PROBE_HOST_VERSION = "0.0.0-mh03-probe";
    MH03_NATIVE_HOOK_PROBE = Object.freeze({
      host_id: "claude-code-cli",
      host_version: MH03_PROBE_HOST_VERSION,
      authentication: "not_observed"
    });
    MH03_WRAPPER_PROBE = Object.freeze({
      host_id: "codex-cli",
      host_version: MH03_PROBE_HOST_VERSION,
      authentication: "unauthenticated"
    });
    MH03_SHARED_SEMANTIC_EVENT = "prompt.submit";
    MH03_EVENT_BINDING_PROBES = Object.freeze([
      Object.freeze({ host: MH03_NATIVE_HOOK_PROBE, native_event: "UserPromptSubmit" }),
      Object.freeze({ host: MH03_WRAPPER_PROBE, native_event: "guild.wrapper.prompt_submit" })
    ]);
    MH03_UNREGISTERED_NATIVE_EVENT = "guild.mh03.probe.unregistered-native-event";
    MH03_ABSENT_CAPABILITY_ID = "host.mcp.http";
    MH03_CREDENTIALED_CAPABILITY_ID = "host.dispatch.selectable";
  }
});

// ../src/modules/host-runtime/index.ts
var init_host_runtime = __esm({
  "../src/modules/host-runtime/index.ts"() {
    init_host_id_namespace();
    init_adapter_fallback_ladders();
    init_host_profiles_validate();
    init_host_registry();
    init_host_registry_schema();
    init_provider_detect();
    init_session_context();
    init_model_discovery();
    init_host_adapter_contract();
    init_host_adapter_boundary();
    init_host_capability_snapshot();
    init_host_event_normalizer();
    init_host_adapter_conformance_evaluator();
  }
});

// ../src/modules/lifecycle/workflows/run-lifecycle.ts
function runDir2(root, runId) {
  return path24.join(root, ".guild", "runs", runId);
}
function runYamlPath(root, runId) {
  return path24.join(runDir2(root, runId), "run.yaml");
}
function yamlScalar(v) {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (v === "") return '""';
  if (/^[\w./:@+-]+$/.test(v) && !/^\d{4}-\d{2}/.test(v)) return v;
  if (/^[^\s#:][^#]*$/.test(v) && !v.includes(": ") && !/[:#]$/.test(v)) return v;
  return JSON.stringify(v);
}
function writeGateBlock(raw, gate, rec) {
  const lines = raw.split("\n");
  const idx = lines.findIndex((l) => l.startsWith("gates:"));
  if (idx === -1) return null;
  const entryLines = [
    `    posture: ${yamlScalar(rec.posture)}`,
    `    outcome: ${yamlScalar(rec.outcome)}`,
    `    codex_review: ${yamlScalar(rec.codex_review)}`
  ];
  const gateKeyLine = `  ${gate}:`;
  if (lines[idx].slice("gates:".length).trim() === "{}") {
    lines.splice(idx, 1, "gates:", gateKeyLine, ...entryLines);
    return lines.join("\n");
  }
  let end = idx + 1;
  while (end < lines.length && /^\s/.test(lines[end]) && lines[end].trim() !== "") {
    end++;
  }
  const gateIdx = lines.findIndex((l, i) => i > idx && i < end && l === gateKeyLine);
  if (gateIdx !== -1) {
    let bodyEnd = gateIdx + 1;
    while (bodyEnd < end && /^\s{4,}/.test(lines[bodyEnd])) bodyEnd++;
    lines.splice(gateIdx, bodyEnd - gateIdx, gateKeyLine, ...entryLines);
    return lines.join("\n");
  }
  lines.splice(end, 0, gateKeyLine, ...entryLines);
  return lines.join("\n");
}
function appendGateOutcome(fs20, root, runId, gate, record) {
  if (!GATE_TOKEN.test(gate)) return false;
  const p = runYamlPath(root, runId);
  const raw = fs20.readFile(p);
  if (raw === null) return false;
  const next = writeGateBlock(raw, gate, record);
  if (next === null) return false;
  fs20.writeFile(p, next);
  return true;
}
var path24, CANONICAL_PHASES, GATE_TOKEN;
var init_run_lifecycle = __esm({
  "../src/modules/lifecycle/workflows/run-lifecycle.ts"() {
    path24 = __toESM(require("path"));
    init_kernel();
    init_host_runtime();
    init_config2();
    init_state();
    init_run_binding();
    init_security();
    init_telemetry();
    CANONICAL_PHASES = Object.freeze(["init", "ideate", "plan", "build", "qa", "ops"]);
    GATE_TOKEN = /^[a-z][a-z0-9-]{0,63}$/;
  }
});

// gate-outcome-writer.ts
var gate_outcome_writer_exports = {};
__export(gate_outcome_writer_exports, {
  main: () => main,
  parseGateOutcome: () => parseGateOutcome
});
module.exports = __toCommonJS(gate_outcome_writer_exports);
var fs19 = __toESM(require("node:fs"));
var path25 = __toESM(require("node:path"));

// lib/guild-root.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function resolveGuildRoot(startCwd) {
  const resolvedStart = path.resolve(startCwd);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    if (nearestGuildDir === null) {
      const guildDir = path.join(current, ".guild");
      if (fs.existsSync(guildDir)) {
        try {
          if (fs.statSync(guildDir).isDirectory()) {
            nearestGuildDir = current;
          }
        } catch {
        }
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return nearestGuildDir ?? resolvedStart;
    }
    current = parent;
  }
}

// gate-outcome-writer.ts
init_run_lifecycle();
function readCurrentRunId(cwd) {
  const sentinelPath = path25.join(resolveGuildRoot(cwd), ".guild", "runs", "current-run-id");
  try {
    const value = fs19.readFileSync(sentinelPath, "utf8").trim();
    return value.length > 0 ? value : void 0;
  } catch {
    return void 0;
  }
}
function resolveRunId(cwd) {
  const envRunId = process.env["GUILD_RUN_ID"];
  if (typeof envRunId === "string" && envRunId.length > 0) return envRunId;
  return readCurrentRunId(cwd);
}
var GATE_REPORTS = {
  "review.md": "review",
  "verify.md": "verify-done"
};
function parseGateOutcome(gate, content) {
  if (gate === "verify-done") {
    const m = content.match(/overall\s*status\b[\s\S]{0,40}?\b(pass|fail)\b/i);
    if (m) return m[1].toLowerCase();
  }
  if (content.includes("\u2717")) return "fail";
  if (content.includes("\u2713")) return "pass";
  return null;
}
var realFs = {
  readFile(p) {
    try {
      return fs19.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
  writeFile(p, contents) {
    fs19.writeFileSync(p, contents, "utf8");
  }
};
async function readStdin() {
  return new Promise((resolve16) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve16(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve16(""));
  });
}
async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    if (raw.trim().length > 0) {
      const parsed = JSON.parse(raw.trim());
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed;
      }
    }
  } catch {
    process.stderr.write("warn: [gate-outcome-writer] invalid JSON on stdin; skipping.\n");
    return;
  }
  const toolName = payload.tool_name;
  if (toolName !== "Write" && toolName !== "Edit") return;
  const filePath = payload.tool_input?.file_path;
  if (typeof filePath !== "string" || filePath.length === 0) return;
  const basename7 = path25.basename(filePath);
  const gate = GATE_REPORTS[basename7];
  if (gate === void 0) return;
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const runId = resolveRunId(cwd);
  if (typeof runId !== "string" || runId.length === 0) return;
  const root = resolveGuildRoot(cwd);
  const expectedDir = path25.join(root, ".guild", "runs", runId);
  const abs = path25.isAbsolute(filePath) ? filePath : path25.resolve(cwd, filePath);
  if (path25.dirname(abs) !== expectedDir) return;
  let content;
  try {
    content = fs19.readFileSync(abs, "utf8");
  } catch (err) {
    process.stderr.write(
      `warn: [gate-outcome-writer] could not read ${abs}: ${err instanceof Error ? err.message : String(err)}
`
    );
    return;
  }
  const outcome = parseGateOutcome(gate, content);
  if (outcome === null) {
    process.stderr.write(
      `[gate-outcome-writer] ${basename7}: no unambiguous pass/fail signal \u2014 gates: left unrecorded.
`
    );
    return;
  }
  try {
    const recorded = appendGateOutcome(realFs, root, runId, gate, {
      posture: "auto",
      outcome,
      codex_review: "unknown"
    });
    if (!recorded) {
      process.stderr.write(
        "warn: [gate-outcome-writer] appendGateOutcome did not record (missing/invalid run.yaml?).\n"
      );
    }
  } catch (err) {
    process.stderr.write(
      `warn: [gate-outcome-writer] write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
if (process.argv[1] !== void 0 && (process.argv[1].endsWith("gate-outcome-writer.ts") || process.argv[1].endsWith("gate-outcome-writer.js"))) {
  main().catch((err) => {
    process.stderr.write(
      `fatal: [gate-outcome-writer] ${err instanceof Error ? err.message : String(err)}
`
    );
    process.exit(0);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main,
  parseGateOutcome
});
