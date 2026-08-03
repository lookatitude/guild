#!/usr/bin/env -S npx tsx
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
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

// ../src/modules/lifecycle/workflows/run-binding.ts
function realBindingFs() {
  return {
    mkdirp: (p) => fsReal.mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => fsReal.writeFileSync(p, c, "utf8"),
    readFile: (p) => fsReal.existsSync(p) ? fsReal.readFileSync(p, "utf8") : null,
    exists: (p) => fsReal.existsSync(p)
  };
}
function runBindingPath(root, runId) {
  return path2.join(root, ".guild", "runs", runId, "binding.json");
}
function validateRunBindingRecord(parsed, expectedRunId) {
  if (parsed === null || typeof parsed !== "object") return null;
  const o = parsed;
  if (o["schema_version"] !== "guild.run_binding.v1") return null;
  if (typeof o["run_id"] !== "string" || o["run_id"] !== expectedRunId) return null;
  const ref = o["binding_ref"];
  if (typeof ref !== "string" || !/^rb-[A-Za-z0-9_-]+$/.test(ref)) return null;
  if (o["state"] !== "open" && o["state"] !== "closed") return null;
  return {
    schema_version: "guild.run_binding.v1",
    run_id: o["run_id"],
    binding_ref: ref,
    state: o["state"]
  };
}
function readRunBindingRecord(opts) {
  const fs22 = opts.fs ?? realBindingFs();
  const raw = fs22.readFile(runBindingPath(opts.root, opts.run_id));
  if (raw === null) return { status: "absent" };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "malformed" };
  }
  const record = validateRunBindingRecord(parsed, opts.run_id);
  if (record === null) return { status: "malformed" };
  return { status: "ok", record };
}
function verifyRunBinding(input) {
  const reject2 = (reason) => ({
    ok: false,
    diagnostic: "binding_rejected",
    reason
  });
  if (!input.run_id || !input.binding_ref) return reject2("binding_absent");
  if (!input.root) return reject2("binding_unverifiable");
  const read = readRunBindingRecord({ root: input.root, run_id: input.run_id, fs: input.fs });
  if (read.status === "absent") return reject2("binding_not_minted");
  if (read.status === "malformed") return reject2("binding_malformed");
  const record = read.record;
  if (record.state === "closed") return reject2("binding_closed");
  if (record.binding_ref !== input.binding_ref || record.run_id !== input.run_id) {
    return reject2("binding_mismatch");
  }
  return { ok: true, binding: record };
}
function readHookBindingEnvelope(env) {
  const run_id = env[HOOK_BINDING_ENV_RUN_ID]?.trim();
  const binding_ref = env[HOOK_BINDING_ENV_BINDING_REF]?.trim();
  if (!run_id || !binding_ref) return null;
  return { run_id, binding_ref };
}
var fsReal, path2, HOOK_BINDING_ENV_RUN_ID, HOOK_BINDING_ENV_BINDING_REF;
var init_run_binding = __esm({
  "../src/modules/lifecycle/workflows/run-binding.ts"() {
    fsReal = __toESM(require("fs"));
    path2 = __toESM(require("path"));
    HOOK_BINDING_ENV_RUN_ID = "GUILD_RUN_ID";
    HOOK_BINDING_ENV_BINDING_REF = "GUILD_RUN_BINDING_REF";
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

// ../src/modules/kernel/workflows/module-manifest.ts
var OWNED_INVENTORY_CATEGORIES;
var init_module_manifest = __esm({
  "../src/modules/kernel/workflows/module-manifest.ts"() {
    OWNED_INVENTORY_CATEGORIES = Object.freeze([
      "commands",
      "skills",
      "agents",
      "hooks",
      "mcp_servers",
      "scripts"
    ]);
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
      const objectKeys = [];
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
        if (objectKeys.indexOf(pairKey) === -1) objectKeys.push(pairKey);
        else return false;
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
    function load2(input, options) {
      const documents = loadDocuments(input, options);
      if (documents.length === 0) {
        return void 0;
      } else if (documents.length === 1) {
        return documents[0];
      }
      throw new YAMLException("expected a single document in the stream, but found more");
    }
    module2.exports.loadAll = loadAll;
    module2.exports.load = load2;
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
    function dump2(input, options) {
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
    module2.exports.dump = dump2;
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

// ../src/modules/state/workflows/frontmatter.ts
function readScalarField(content, key) {
  const prefix = key + ":";
  for (const ln of content.split("\n")) {
    const c0 = ln.charCodeAt(0);
    if (c0 === 32 || c0 === 9) continue;
    if (!ln.startsWith(prefix)) continue;
    let v = ln.slice(prefix.length).trim();
    if (v === "") continue;
    if (v.length >= 2 && (v[0] === '"' && v[v.length - 1] === '"' || v[0] === "'" && v[v.length - 1] === "'")) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return void 0;
}
var init_frontmatter = __esm({
  "../src/modules/state/workflows/frontmatter.ts"() {
    init_kernel();
  }
});

// ../src/modules/lifecycle/workflows/stable-lock.ts
function stableLockPath(runDir2) {
  return (0, import_node_path.join)(runDir2, "logs", ".lock");
}
function exclusionSentinelPath(runDir2) {
  return (0, import_node_path.join)(runDir2, "logs", ".lock.exclusion");
}
function initStableLockfile(runDir2) {
  const path26 = stableLockPath(runDir2);
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
function withStableLock(runDir2, fn, opts = {}) {
  initStableLockfile(runDir2);
  const sentinel = exclusionSentinelPath(runDir2);
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

// ../src/modules/state/workflows/plugin-install-guard.ts
function assertNotUnderPluginInstall(absPath, pluginInstallRoot) {
  const root = pluginInstallRoot ?? process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"] ?? process.env["CODEX_PLUGIN_ROOT"];
  if (!root) return;
  const resolvedRoot = path5.resolve(root);
  const rel = path5.relative(resolvedRoot, path5.resolve(absPath));
  if (rel === "" || !rel.startsWith("..") && !path5.isAbsolute(rel)) {
    const underOwnDotGuild = rel === ".guild" || rel.startsWith(`.guild${path5.sep}`);
    if (underOwnDotGuild && fs3.existsSync(path5.join(resolvedRoot, ".git"))) return;
    throw new Error(`project-created Guild artifact would be written under plugin install dir: ${absPath}`);
  }
}
var fs3, path5;
var init_plugin_install_guard = __esm({
  "../src/modules/state/workflows/plugin-install-guard.ts"() {
    fs3 = __toESM(require("node:fs"));
    path5 = __toESM(require("node:path"));
  }
});

// ../src/modules/state/workflows/atomic-write.ts
function atomicWrite(targetPath, content, pluginInstallRoot) {
  assertNotUnderPluginInstall(targetPath, pluginInstallRoot);
  const dir = path6.dirname(targetPath);
  fs4.mkdirSync(dir, { recursive: true });
  const unique = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const tmpPath = path6.join(dir, `.${path6.basename(targetPath)}.tmp-${unique}`);
  fs4.writeFileSync(tmpPath, content, "utf8");
  try {
    fs4.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      fs4.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
var fs4, path6, crypto;
var init_atomic_write = __esm({
  "../src/modules/state/workflows/atomic-write.ts"() {
    fs4 = __toESM(require("fs"));
    path6 = __toESM(require("path"));
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

// ../src/modules/state/workflows/guild-root.ts
function resolveGuildRoot2(startDir) {
  const resolvedStart = path7.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs5.existsSync(path7.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path7.join(current, ".guild");
      try {
        if (fs5.existsSync(guildDir) && fs5.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
      }
    }
    const parent = path7.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}
var fs5, path7;
var init_guild_root = __esm({
  "../src/modules/state/workflows/guild-root.ts"() {
    fs5 = __toESM(require("node:fs"));
    path7 = __toESM(require("node:path"));
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
    const abs = path8.isAbsolute(raw) ? raw : path8.resolve(cwd, raw);
    const root = path8.dirname(abs);
    if (fs6.existsSync(root)) return root;
  } catch {
  }
  return path8.resolve(cwd);
}
function runMigrations(dbPath) {
  let db;
  let fromVersion = 0;
  try {
    fs6.mkdirSync(path8.dirname(dbPath), { recursive: true });
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
    dbPath = path8.join(guildRoot, ".guild", "index.sqlite");
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
var import_node_child_process, fs6, path8, CURRENT_SCHEMA_VERSION, MIGRATIONS;
var init_index_migrate = __esm({
  "../src/modules/migrations/workflows/index-migrate.ts"() {
    import_node_child_process = require("node:child_process");
    fs6 = __toESM(require("node:fs"));
    path8 = __toESM(require("node:path"));
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

// ../src/modules/migrations/index.ts
var init_migrations = __esm({
  "../src/modules/migrations/index.ts"() {
    init_index_migrate();
    init_wiki_importance();
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

// ../src/modules/lifecycle/workflows/run-state.ts
function runStatePath(runDir2) {
  return path9.join(runDir2, "run-state.json");
}
function loadRunState(runDir2) {
  let raw;
  try {
    raw = fs7.readFileSync(runStatePath(runDir2), "utf8");
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
function writeRunStateAtomic(runDir2, state) {
  fs7.mkdirSync(runDir2, { recursive: true });
  const finalPath = runStatePath(runDir2);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs7.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  try {
    fs7.renameSync(tmpPath, finalPath);
  } catch (err) {
    try {
      fs7.unlinkSync(tmpPath);
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
function markLaneInProgress(runDir2, init2, laneId2, opts = {}) {
  return upsertLane(runDir2, init2, laneId2, {
    status: "in_progress",
    tier: opts.tier,
    attempt: opts.attempt,
    depends_on: opts.depends_on
  });
}
function laneResumeCheckpointPath(runDir2, laneId2) {
  return path9.join(runDir2, "lanes", laneId2, "resume.json");
}
function readResumeEnabled(cwd) {
  const settingsPath = path9.join(resolveGuildRoot2(cwd), ".guild", "settings.json");
  try {
    const raw = fs7.readFileSync(settingsPath, "utf8");
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
function loadLaneResumeCheckpoint(runDir2, laneId2) {
  try {
    const raw = fs7.readFileSync(laneResumeCheckpointPath(runDir2, laneId2), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.schema_version !== LANE_RESUME_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}
function markLaneDead(runDir2, init2, laneId2, signal, cwd) {
  const state = upsertLane(runDir2, init2, laneId2, {
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
    const checkpointPath = laneResumeCheckpointPath(runDir2, laneId2);
    fs7.mkdirSync(path9.dirname(checkpointPath), { recursive: true });
    fs7.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2) + "\n", "utf8");
  }
  return state;
}
var fs7, path9, RUN_STATE_SCHEMA_VERSION, LANE_RESUME_SCHEMA_VERSION;
var init_run_state = __esm({
  "../src/modules/lifecycle/workflows/run-state.ts"() {
    fs7 = __toESM(require("node:fs"));
    path9 = __toESM(require("node:path"));
    init_stable_lock();
    init_state();
    RUN_STATE_SCHEMA_VERSION = "guild.run_state.v1";
    LANE_RESUME_SCHEMA_VERSION = "guild.lane_resume.v1";
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
    (_match, key, sep2) => `${key}${sep2}${KV_REDACTED}`
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
  if (!PATH_SHAPE.test(token)) return false;
  const slashCount = token.split("/").length - 1;
  if (slashCount < 2 && !PATH_EXTENSION.test(token)) return false;
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
var TOKEN_REDACTED, PATH_REDACTED, KV_REDACTED, HIGH_ENTROPY_REDACTED, TRUNCATION_SUFFIX, FIELD_SIZE_CAP_BYTES, TOKEN_SHAPE_PATTERNS, SENSITIVE_HOME_DIRS, HOME_DIR_PATTERN, KV_SECRET_PATTERN, PATH_TOKEN_CHAR, PATH_SHAPE, PATH_EXTENSION, MAX_PATH_TOKEN_LEN, HIGH_ENTROPY_PATTERN, REDACTABLE_FIELD_NAMES, REDACTABLE_FIELDS;
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

// ../src/modules/security/workflows/events.ts
function normalizeSecurityHostId(value) {
  const s = value.trim();
  if (KNOWN_GUILD_HOST_ID_SET.has(s)) return s;
  return LEGACY_HOST_ALIASES[s] ?? null;
}
function resolveHostResolution(env) {
  const explicit = (env["GUILD_HOST_ID"] ?? "").trim();
  if (explicit.length > 0) return { id: explicit, degraded: false, rawUnknown: "" };
  const rawHost = (env["GUILD_HOST"] ?? "").trim().toLowerCase();
  if (rawHost.length === 0) return { id: "claude-code-cli", degraded: false, rawUnknown: "" };
  const normalized = normalizeSecurityHostId(rawHost);
  if (normalized) return { id: normalized, degraded: false, rawUnknown: "" };
  return { id: rawHost, degraded: true, rawUnknown: rawHost };
}
function resolveHostId() {
  return resolveHostResolution(process.env).id;
}
function buildSecurityEvent(input) {
  const rec = {
    schema_version: SECURITY_EVENT_SCHEMA_VERSION,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    run_id: input.run_id,
    event_type: input.event_type,
    decision: input.decision,
    tool: input.tool,
    detail: redactField(input.detail ?? ""),
    host: typeof input.host === "string" && input.host.length > 0 ? input.host : resolveHostId()
  };
  if (typeof input.lane_id === "string" && input.lane_id.length > 0) rec.lane_id = input.lane_id;
  if (input.policy !== void 0) rec.policy = input.policy;
  if (typeof input.permission_mode === "string" && input.permission_mode.length > 0) {
    rec.permission_mode = input.permission_mode;
  }
  if (typeof input.dispatch_rung === "string" && input.dispatch_rung.length > 0) {
    rec.dispatch_rung = input.dispatch_rung;
  }
  return rec;
}
function appendSecurityEvent(runDir2, record) {
  try {
    const logsDir = path10.join(runDir2, "logs");
    fs8.mkdirSync(logsDir, { recursive: true });
    fs8.appendFileSync(path10.join(logsDir, "security-events.jsonl"), JSON.stringify(record) + "\n", "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [security-events] write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}
var fs8, path10, SECURITY_EVENT_SCHEMA_VERSION, KNOWN_GUILD_HOST_KINDS, KNOWN_GUILD_HOST_ID_SET, LEGACY_HOST_ALIASES;
var init_events = __esm({
  "../src/modules/security/workflows/events.ts"() {
    fs8 = __toESM(require("node:fs"));
    path10 = __toESM(require("node:path"));
    init_state();
    init_redact_log();
    SECURITY_EVENT_SCHEMA_VERSION = "guild.security_event.v1";
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

// ../src/modules/security/workflows/secrets.ts
function applySecretsPolicy(value, policy, opts) {
  if (typeof value !== "string") {
    return { value: typeof value === "string" ? value : String(value ?? ""), ok: true, failures: [] };
  }
  let out = redactField(value, opts?.noTruncate ? Number.POSITIVE_INFINITY : void 0);
  const failures = [];
  for (const pat of policy.redaction_patterns) {
    let re;
    try {
      re = new RegExp(pat, "g");
    } catch (err) {
      failures.push(`${pat}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    try {
      out = out.replace(re, "[REDACTED]");
    } catch (err) {
      failures.push(`${pat}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { value: out, ok: failures.length === 0, failures };
}
var init_secrets = __esm({
  "../src/modules/security/workflows/secrets.ts"() {
    init_redact_log();
  }
});

// ../src/modules/security/workflows/config.ts
function securityDefaults() {
  return {
    bypass_permissions_policy: "audit",
    secrets_policy: {
      env_allowlist: [],
      redaction_patterns: [],
      fail_mode_durable: "closed",
      fail_mode_telemetry: "open"
    },
    tool_description_hashes: {},
    mcp_availability: {
      stdio_available: true,
      http_available: false,
      bridge_package: null
    },
    allowed_tools: []
  };
}
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function parseSecurityConfig(parsed) {
  const out = securityDefaults();
  if (!isPlainObject(parsed)) return out;
  if (isPlainObject(parsed["security"])) {
    const bpp = parsed["security"]["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") {
      out.bypass_permissions_policy = bpp;
    }
  }
  if (isPlainObject(parsed["secrets_policy"])) {
    const sp = parsed["secrets_policy"];
    if (isStringArray(sp["env_allowlist"])) out.secrets_policy.env_allowlist = sp["env_allowlist"];
    if (isStringArray(sp["redaction_patterns"])) {
      out.secrets_policy.redaction_patterns = sp["redaction_patterns"];
    }
    if (sp["fail_mode_durable"] === "closed" || sp["fail_mode_durable"] === "open") {
      out.secrets_policy.fail_mode_durable = sp["fail_mode_durable"];
    }
    if (sp["fail_mode_telemetry"] === "open" || sp["fail_mode_telemetry"] === "closed") {
      out.secrets_policy.fail_mode_telemetry = sp["fail_mode_telemetry"];
    }
  }
  if (isPlainObject(parsed["defaults"])) {
    const defs = parsed["defaults"];
    if (isStringArray(defs["allowed_tools"])) {
      out.allowed_tools = defs["allowed_tools"];
    }
  }
  if (isPlainObject(parsed["mcp"])) {
    const mcp = parsed["mcp"];
    if (isPlainObject(mcp["tool_description_hashes"])) {
      const hashes = {};
      for (const [k, v] of Object.entries(mcp["tool_description_hashes"])) {
        if (typeof v === "string") hashes[k] = v;
      }
      out.tool_description_hashes = hashes;
    }
    if (typeof mcp["stdio_available"] === "boolean") {
      out.mcp_availability.stdio_available = mcp["stdio_available"];
    }
    if (typeof mcp["http_available"] === "boolean") {
      out.mcp_availability.http_available = mcp["http_available"];
    }
    if (mcp["bridge_package"] === null || typeof mcp["bridge_package"] === "string") {
      out.mcp_availability.bridge_package = mcp["bridge_package"];
    }
  }
  return out;
}
function readSecurityConfig(cwd) {
  const settingsPath = path11.join(resolveGuildRoot2(cwd), ".guild", "settings.json");
  let raw;
  try {
    raw = fs9.readFileSync(settingsPath, "utf8");
  } catch {
    return securityDefaults();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return securityDefaults();
  }
  return parseSecurityConfig(parsed);
}
var fs9, path11;
var init_config = __esm({
  "../src/modules/security/workflows/config.ts"() {
    fs9 = __toESM(require("node:fs"));
    path11 = __toESM(require("node:path"));
    init_state();
  }
});

// ../src/modules/security/workflows/scrubbed-write.ts
function guildRootFromRunDir(runDir2) {
  return path12.resolve(runDir2, "../../..");
}
function writeScrubApprovalRequest(runDir2, runId, surface, outPath, laneId2) {
  try {
    const approvalDir = path12.join(runDir2, "agent-bus", "approvals");
    fs10.mkdirSync(approvalDir, { recursive: true });
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    const safeTs = ts.replace(/[:.]/g, "-");
    const fileName = `${safeTs}-scrub-blocked.json`;
    const record = {
      schema_version: "guild.approval_request.v1",
      ts,
      run_id: runId,
      tool: "scrubbedWrite",
      reason: `Secret scrub failed for durable surface "${surface}" \u2014 write blocked. Human review required. Path: ${path12.basename(outPath)}`,
      permission_mode: "blocked",
      surface
    };
    if (laneId2) record["lane_id"] = laneId2;
    const rawContent = JSON.stringify(record, null, 2) + "\n";
    let content = rawContent;
    try {
      const secConfig = readSecurityConfig(guildRootFromRunDir(runDir2));
      const scrubResult = applySecretsPolicy(rawContent, secConfig.secrets_policy, { noTruncate: true });
      content = scrubResult.value;
    } catch {
    }
    fs10.writeFileSync(path12.join(approvalDir, fileName), content, "utf8");
  } catch {
  }
}
function scrubbedWrite(outPath, content, opts) {
  const guildRoot = guildRootFromRunDir(opts.runDir);
  let policy;
  try {
    const secConfig = readSecurityConfig(guildRoot);
    policy = secConfig.secrets_policy;
  } catch {
    policy = {
      env_allowlist: [],
      redaction_patterns: [],
      fail_mode_durable: "closed",
      fail_mode_telemetry: "open"
    };
  }
  const scrubResult = applySecretsPolicy(content, policy, { noTruncate: true });
  const failMode = opts.surface === "telemetry" ? policy.fail_mode_telemetry : policy.fail_mode_durable;
  if (scrubResult.ok) {
    try {
      fs10.mkdirSync(path12.dirname(outPath), { recursive: true });
      fs10.writeFileSync(outPath, scrubResult.value, "utf8");
    } catch (err) {
      process.stderr.write(
        `[scrubbed-write] ERROR: write failed for surface "${opts.surface}" at ${outPath}: ${err instanceof Error ? err.message : String(err)}
`
      );
      return { written: false, blocked: false };
    }
    const result = { written: true, blocked: false };
    if (opts.surface === "bus") {
      result.sha256 = crypto2.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
    }
    return result;
  }
  if (failMode === "open") {
    process.stderr.write(
      `[scrubbed-write] WARN: secret scrub custom-pattern failure for surface "${opts.surface}" at ${path12.basename(outPath)} \u2014 writing built-in-redacted content (fail-open). Failures: ${scrubResult.failures.join("; ")}
`
    );
    try {
      fs10.mkdirSync(path12.dirname(outPath), { recursive: true });
      fs10.writeFileSync(outPath, scrubResult.value, "utf8");
    } catch (err) {
      process.stderr.write(
        `[scrubbed-write] ERROR: fail-open write failed: ${err instanceof Error ? err.message : String(err)}
`
      );
      return { written: false, blocked: false };
    }
    try {
      const evt = buildSecurityEvent({
        run_id: opts.runId,
        lane_id: opts.laneId,
        event_type: "secret_scrub_blocked",
        decision: "degraded",
        tool: "scrubbedWrite",
        detail: `Secret scrub custom-pattern failure (fail-open) for surface "${opts.surface}" at ${path12.basename(outPath)}. Built-in-redacted content written.`,
        permission_mode: "degraded"
      });
      appendSecurityEvent(opts.runDir, evt);
    } catch {
    }
    const result = { written: true, blocked: false };
    if (opts.surface === "bus") {
      result.sha256 = crypto2.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
    }
    return result;
  }
  process.stderr.write(
    `[scrubbed-write] BLOCKED: secret scrub failed for durable surface "${opts.surface}" at ${outPath} \u2014 file NOT written. Failures: ${scrubResult.failures.join("; ")}
`
  );
  try {
    const evt = buildSecurityEvent({
      run_id: opts.runId,
      lane_id: opts.laneId,
      event_type: "secret_scrub_blocked",
      decision: "blocked",
      tool: "scrubbedWrite",
      detail: `Secret scrub failed for durable surface "${opts.surface}" at ${path12.basename(outPath)} \u2014 write blocked (fail-closed).`,
      permission_mode: "blocked"
    });
    appendSecurityEvent(opts.runDir, evt);
  } catch {
  }
  writeScrubApprovalRequest(opts.runDir, opts.runId, opts.surface, outPath, opts.laneId);
  return { written: false, blocked: true };
}
var fs10, path12, crypto2;
var init_scrubbed_write = __esm({
  "../src/modules/security/workflows/scrubbed-write.ts"() {
    fs10 = __toESM(require("node:fs"));
    path12 = __toESM(require("node:path"));
    crypto2 = __toESM(require("node:crypto"));
    init_secrets();
    init_config();
    init_events();
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
        // INFERRED (Codex CLI approval model). Confirm on-box at L3.
        deny: false,
        ask: true,
        // Codex prompts for approval by default.
        ask_mode: null,
        // No pre_tool_use layer; approval is interactive.
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
          bypass_all: ["--dangerously-bypass-approvals-and-sandbox"]
          // INFERRED flag name — verify on-box (AC19).
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
  return LEGACY_HOST_ALIASES2[s] ?? null;
}
var HOST_ID_SET2, LEGACY_HOST_ALIASES2;
var init_host_id_namespace = __esm({
  "../src/modules/host-runtime/workflows/host-id-namespace.ts"() {
    init_host_registry_schema();
    HOST_ID_SET2 = new Set(HOST_IDS);
    LEGACY_HOST_ALIASES2 = {
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
var HOST_EVENT_NORMALIZATION_SCHEMA, CLAUDE_NATIVE_EVENT_BINDINGS, WRAPPER_NATIVE_EVENT_BINDINGS, NATIVE_BINDINGS_BY_FAMILY, NO_SOURCE;
var init_host_event_normalizer = __esm({
  "../src/modules/host-runtime/workflows/host-event-normalizer.ts"() {
    init_host_id_namespace();
    init_host_registry_schema();
    HOST_EVENT_NORMALIZATION_SCHEMA = "guild.host_event_normalization.v1";
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
var HOST_ADAPTER_BOUNDARY_SCHEMA, HOST_ENTRY_POINT_SCHEMA, HOST_ADAPTER_OWNERSHIP_SCHEMA, HOST_ADAPTER_REASON_CODES, HOST_ADAPTER_OWNED_CONCERNS, HOST_ADAPTER_NOT_OWNED_CONCERNS, CONCERN_OWNERS, OWNERSHIP, DEFAULT_INSTRUCTION_FILE, HOST_ENTRY_POINTS, BOUNDARY_STORE;
var init_host_adapter_boundary = __esm({
  "../src/modules/host-runtime/workflows/host-adapter-boundary.ts"() {
    init_host_adapter_contract();
    init_host_id_namespace();
    init_host_registry_schema();
    init_host_capability_snapshot();
    init_host_event_normalizer();
    HOST_ADAPTER_BOUNDARY_SCHEMA = "guild.host_adapter_boundary.v1";
    HOST_ENTRY_POINT_SCHEMA = "guild.host_entry_point.v1";
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
  }
});

// ../src/modules/config/workflows/config-defaults.ts
var DEFAULT_ESCALATION_MARKERS, NON_INHERITABLE_KEYS, LOG_ROTATION_THRESHOLD_BYTES, SIDECAR_MAX_BYTES, CAPABILITY_RESOLVER_MODES, CAPABILITY_AUTO_CREATE_POLICIES, CAPABILITY_RESOLVER_MODE_AFTER_F7, CAPABILITY_RESOLVER_MODE_DEFAULT, DEFAULTS;
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
    SIDECAR_MAX_BYTES = 1024 * 1024;
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
        lifecycle_gate: { enabled: true, adhoc_activity_threshold: 20 }
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

// ../src/modules/security/workflows/share-set.ts
var SHARED_SCRUBBED_NAMES;
var init_share_set = __esm({
  "../src/modules/security/workflows/share-set.ts"() {
    init_kernel();
    SHARED_SCRUBBED_NAMES = sealSet([
      "verify.md",
      "review.md",
      "provenance.json",
      "summary.md",
      "run.yaml",
      "run-state.json"
    ], "SHARED_SCRUBBED_NAMES");
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
      // High-entropy string heuristic: 40+ hex chars (SHA-like)
      Object.freeze([Object.freeze(/\b[0-9a-f]{40,}\b/), "high-entropy hex string (potential secret)"])
    ]);
  }
});

// ../src/modules/security/workflows/scrub-redact.ts
var init_scrub_redact = __esm({
  "../src/modules/security/workflows/scrub-redact.ts"() {
    init_secret_patterns();
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

// ../src/modules/config/workflows/workspace-manifest.ts
var init_workspace_manifest = __esm({
  "../src/modules/config/workflows/workspace-manifest.ts"() {
  }
});

// ../src/modules/config/workflows/settings-reader.ts
var yaml, VALID_TIER_HOST_KEYS, KNOWN_HOST_IDS2, DISPATCH_HOST_IDS, RESOLVER_TIER1_KEYS;
var init_settings_reader = __esm({
  "../src/modules/config/workflows/settings-reader.ts"() {
    init_host_runtime();
    init_host_runtime();
    init_host_runtime();
    init_security();
    init_config_defaults();
    init_kernel();
    init_workspace_manifest();
    yaml = loadYamlApi();
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
function validateGuildTraceEvent(ev) {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: "event must be a non-null object" };
  }
  const sv = ev["schema_version"];
  switch (sv) {
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
var GUILD_TRACE_SCHEMA_VERSIONS, DISPATCH_BACKENDS, RECALL_BRANCHES, SECURITY_OUTCOMES, DEGRADATION_SURFACES, LANE_OUTCOMES;
var init_guild_trace_events = __esm({
  "../src/modules/telemetry/workflows/guild-trace-events.ts"() {
    GUILD_TRACE_SCHEMA_VERSIONS = Object.freeze([
      "guild.trace.dispatch.v1",
      "guild.trace.recall.v1",
      "guild.trace.recall_decision.v1",
      "guild.trace.config_resolution.v1",
      "guild.trace.security_decision.v1",
      "guild.trace.degradation.v1",
      "guild.trace.model_inspection.v1"
    ]);
    DISPATCH_BACKENDS = ["agent", "tmux", "remote", "unknown"];
    RECALL_BRANCHES = ["sqlite", "file-bm25", "fs-scan", "kg-query", "structural", "combined", "empty"];
    SECURITY_OUTCOMES = ["allow", "ask", "deny", "audit", "pass-through"];
    DEGRADATION_SURFACES = ["dispatch", "recall", "config", "hook", "host-capability", "other"];
    LANE_OUTCOMES = ["success", "failure", "unknown"];
  }
});

// ../src/modules/telemetry/workflows/guild-trace-emit.ts
function liveLogPath(runDir2) {
  return path14.join(runDir2, "logs", "v1.4-events.jsonl");
}
function emitTraceEvent(event, runDir2) {
  if (!runDir2) return false;
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
    const live = liveLogPath(runDir2);
    const dir = path14.dirname(live);
    fs12.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(event) + "\n";
    fs12.appendFileSync(live, line, "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `[guild-trace-emit] WARN: could not write trace event to ${runDir2}/logs/v1.4-events.jsonl: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}
var fs12, path14;
var init_guild_trace_emit = __esm({
  "../src/modules/telemetry/workflows/guild-trace-emit.ts"() {
    fs12 = __toESM(require("node:fs"));
    path14 = __toESM(require("node:path"));
    init_guild_trace_events();
  }
});

// ../src/modules/telemetry/workflows/receipt-journal.ts
var RECEIPT_DISPOSITIONS, OBSERVATION_STATES, RECEIPT_EVENT_NAMES, RECEIPT_OUTCOME_TYPES;
var init_receipt_journal = __esm({
  "../src/modules/telemetry/workflows/receipt-journal.ts"() {
    init_state();
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
  }
});

// ../src/modules/telemetry/workflows/receipt-reconcile.ts
var init_receipt_reconcile = __esm({
  "../src/modules/telemetry/workflows/receipt-reconcile.ts"() {
    init_receipt_journal();
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

// ../src/modules/telemetry/index.ts
var init_telemetry = __esm({
  "../src/modules/telemetry/index.ts"() {
    init_guild_trace_emit();
    init_guild_trace_events();
    init_receipt_journal();
    init_receipt_reconcile();
    init_debug_bundle();
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

// ../src/modules/lifecycle/workflows/run-lifecycle.ts
var CANONICAL_PHASES;
var init_run_lifecycle = __esm({
  "../src/modules/lifecycle/workflows/run-lifecycle.ts"() {
    init_kernel();
    init_host_runtime();
    init_config2();
    init_state();
    init_run_binding();
    init_security();
    CANONICAL_PHASES = Object.freeze(["init", "ideate", "plan", "build", "qa", "ops"]);
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
var RESOLVER_AUTHORITIES, CAPABILITY_RESOLUTION_INTENTS, MODE_POLICIES, RESOLVER_MODE_POLICIES, MODE_RANK, RESOLVER_MODE_FAILURES, RESOLVER_MODE_FAILURE_SET, READ_REASON_SET2, MODE_TRANSITION_DIRECTIONS;
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
    READ_REASON_SET2 = new Set(COMPATIBILITY_READ_REASONS);
    MODE_TRANSITION_DIRECTIONS = Object.freeze(["advance", "regress"]);
  }
});

// ../src/modules/capability/workflows/compatibility-catalog.ts
var SHIPPED_TEMPLATE_COUNT, SHIPPED_DOMAIN_SKILL_COUNT, SHIPPED_COMPATIBILITY_ASSET_COUNT, COMPATIBILITY_ASSET_ROOTS, COMPATIBILITY_DEPRECATION_STATES, DEPRECATION_STATE_SET;
var init_compatibility_catalog = __esm({
  "../src/modules/capability/workflows/compatibility-catalog.ts"() {
    init_compatibility_usage();
    init_resolver_mode();
    SHIPPED_TEMPLATE_COUNT = 15;
    SHIPPED_DOMAIN_SKILL_COUNT = 58;
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
    const failed = record.body.checks.filter((check) => check.result === "fail").map((check) => check.id);
    if (record.body.outcome === "pass" && failed.length > 0) {
      return {
        disposition: "failed",
        signals: ["outcome_demoted_by_failed_check", ...failed]
      };
    }
    if (record.body.outcome === "pass") return { disposition: "succeeded", signals: [] };
    if (record.body.outcome === "fail") return { disposition: "failed", signals: failed };
    return { disposition: "unknown", signals: failed };
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
function bindingFor(core) {
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
  return deepFreeze2({ ...core, binding: bindingFor(core) });
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
    const yaml3 = loadYamlApi();
    parsed = yaml3.load(frontmatter, { schema: yaml3.JSON_SCHEMA });
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
  return { ok: true, fields };
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
    if (info !== "" && info !== "json" && info !== "jsonc") continue;
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
function parseReceiptDocument(input) {
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
    const authorId = firstField(fields, ["agent", "specialist"]);
    const authorFamily = firstField(fields, ["model_family", "family"]);
    const hostId = firstField(fields, ["host"]);
    const createdAt = firstField(fields, ["generated_at"]);
    if (authorId === null) {
      pushIssue(errors, "$.frontmatter.agent", "missing_provenance", "frontmatter agent/specialist is required");
    }
    if (authorFamily === null) {
      pushIssue(errors, "$.frontmatter.model_family", "missing_provenance", "frontmatter model_family/family is required");
    }
    if (hostId === null) {
      pushIssue(errors, "$.frontmatter.host", "missing_provenance", "frontmatter host is required");
    }
    if (createdAt === null) {
      pushIssue(errors, "$.frontmatter.generated_at", "missing_provenance", "frontmatter generated_at is required");
    }
    const taskIdRead = safeGet(block.block, "task_id");
    const taskId = taskIdRead.ok && typeof taskIdRead.value === "string" ? taskIdRead.value : null;
    if (taskId === null) {
      pushIssue(errors, "$.machine_block.task_id", "missing_field", "task_id must be a string");
    }
    const statusRead = safeGet(block.block, "status");
    const rawStatus = statusRead.ok && typeof statusRead.value === "string" ? statusRead.value : null;
    const mappedStatus = rawStatus !== null && Object.prototype.hasOwnProperty.call(RECEIPT_STATUS_MAP, rawStatus) ? RECEIPT_STATUS_MAP[rawStatus] : void 0;
    if (mappedStatus === void 0) {
      pushIssue(
        errors,
        "$.machine_block.status",
        "unknown_receipt_status",
        `status must be one of ${Object.keys(RECEIPT_STATUS_MAP).sort().join("|")}`
      );
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
    const titleField = firstField(fields, ["task", "title"]);
    const candidate = {
      schema_version: DOCUMENT_SCHEMA_VERSION,
      kind: "handoff",
      id: recordId,
      title: titleField ?? taskId,
      provenance: {
        author_id: authorId,
        author_family: authorFamily,
        host_id: hostId,
        created_at: createdAt,
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
var RECEIPT_MACHINE_SCHEMA_VERSION, RECEIPT_FRONTMATTER_SCHEMA_VERSION, RECEIPT_PARSE_BOUNDS, RECEIPT_FRONTMATTER_BLOCK, RECEIPT_STATUS_MAP, RECEIPT_REFUSAL_BY_ERROR_CODE;
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
    RECEIPT_STATUS_MAP = Object.freeze({
      complete: "completed",
      completed: "completed",
      done: "completed",
      partial: "partial",
      blocked: "blocked",
      failed: "failed"
    });
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
    raw = fs13.readFileSync(p, "utf8");
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
function readRunStateLanes(runDir2) {
  const obj = readJsonObject(path15.join(runDir2, "run-state.json"));
  if (obj === null) return null;
  const lanes = obj["lanes"];
  if (typeof lanes !== "object" || lanes === null || Array.isArray(lanes)) {
    return {};
  }
  return lanes;
}
function readHeartbeatAges(runDir2, now = Date.now()) {
  const ages = /* @__PURE__ */ new Map();
  const dir = path15.join(runDir2, "in-progress");
  let names;
  try {
    names = fs13.readdirSync(dir);
  } catch {
    return ages;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const stem = name.slice(0, -".json".length);
    const filePath = path15.join(dir, name);
    const obj = readJsonObject(filePath);
    const ts = obj !== null && typeof obj["timestamp"] === "string" ? Date.parse(obj["timestamp"]) : NaN;
    if (!Number.isNaN(ts)) {
      ages.set(stem, Math.max(0, now - ts));
      continue;
    }
    try {
      const stat = fs13.statSync(filePath);
      ages.set(stem, Math.max(0, now - stat.mtimeMs));
    } catch {
    }
  }
  return ages;
}
function readReceiptEvidence(runDir2) {
  const dir = path15.join(runDir2, "handoffs");
  let names;
  try {
    names = fs13.readdirSync(dir);
  } catch {
    return [];
  }
  const evidence = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    const stem = name.slice(0, -".md".length);
    const filePath = path15.join(dir, name);
    let text = null;
    try {
      if (fs13.statSync(filePath).size <= MAX_RECEIPT_BYTES) {
        text = fs13.readFileSync(filePath, "utf8");
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
function sweepLaneLiveness(runDir2, timeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS, now = Date.now()) {
  const lanes = readRunStateLanes(runDir2);
  const heartbeats = readHeartbeatAges(runDir2, now);
  const receiptEvidence = readReceiptEvidence(runDir2);
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
    run_dir: runDir2,
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
  let runDir2;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run-dir" && argv[i + 1] !== void 0) {
      runDir2 = argv[++i];
    } else if (arg.startsWith("--run-dir=")) {
      runDir2 = arg.slice("--run-dir=".length);
    } else {
      process.stderr.write(`unknown argument: ${arg}
${USAGE}
`);
      return 1;
    }
  }
  if (!runDir2) {
    process.stderr.write(USAGE + "\n");
    return 1;
  }
  const report = sweepLaneLiveness(runDir2, resolveTimeoutMs());
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return 0;
}
var fs13, path15, DEFAULT_HEARTBEAT_TIMEOUT_MS, TERMINAL_STATUSES, MAX_RECEIPT_BYTES, NO_RECEIPT, USAGE;
var init_check_lane_liveness = __esm({
  "../src/modules/lifecycle/workflows/check-lane-liveness.ts"() {
    fs13 = __toESM(require("node:fs"));
    path15 = __toESM(require("node:path"));
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

// ../src/modules/lifecycle/workflows/trace-v2.ts
function pruneUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== void 0) out[k] = v;
  }
  return out;
}
var SIDECAR_MAX_BYTES2;
var init_trace_v2 = __esm({
  "../src/modules/lifecycle/workflows/trace-v2.ts"() {
    SIDECAR_MAX_BYTES2 = 16 * 1024;
  }
});

// ../src/modules/lifecycle/workflows/event-log-writer.ts
function liveLogPath2(runDir2) {
  return (0, import_node_path2.join)(runDir2, "logs", "v1.4-events.jsonl");
}
function archiveDir(runDir2) {
  return (0, import_node_path2.join)(runDir2, "logs", "archive");
}
function archivePath(runDir2, n) {
  return (0, import_node_path2.join)(archiveDir(runDir2), `v1.4-events.${n}.jsonl.gz`);
}
function laneFallbackPath(runDir2, laneId2) {
  if (!isSafeLaneId(laneId2)) {
    throw new Error(`log-jsonl: invalid lane_id ${JSON.stringify(laneId2)}`);
  }
  return (0, import_node_path2.join)(runDir2, "logs", `lane-${laneId2}-events.jsonl`);
}
function appendEvent(runDir2, event, opts = {}) {
  validateEventIds(event);
  const cap = opts.fieldCap;
  const redacted = redactEventFields(event, cap);
  const withV2 = opts.traceV2 !== void 0 ? { ...redacted, ...pruneUndefined(opts.traceV2) } : redacted;
  const line = JSON.stringify(withV2) + "\n";
  if (opts.forceFallback || process.platform === "win32") {
    const laneId2 = opts.laneId ?? "global";
    const path26 = laneFallbackPath(runDir2, laneId2);
    (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(path26), { recursive: true });
    const fd = (0, import_node_fs2.openSync)(path26, "a");
    try {
      (0, import_node_fs2.writeSync)(fd, line);
    } finally {
      (0, import_node_fs2.closeSync)(fd);
    }
    return;
  }
  const live = liveLogPath2(runDir2);
  (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(live), { recursive: true });
  withStableLock(runDir2, () => {
    const fd = (0, import_node_fs2.openSync)(live, "a");
    try {
      (0, import_node_fs2.writeSync)(fd, line);
    } finally {
      (0, import_node_fs2.closeSync)(fd);
    }
    maybeRotateLocked(runDir2, opts.rotationThresholdBytes ?? ROTATION_THRESHOLD_BYTES);
  });
}
function nextRotationIndex(runDir2) {
  const dir = archiveDir(runDir2);
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
function maybeRotateLocked(runDir2, thresholdBytes) {
  const live = liveLogPath2(runDir2);
  if (!(0, import_node_fs2.existsSync)(live)) return;
  const size = (0, import_node_fs2.statSync)(live).size;
  if (size < thresholdBytes) return;
  rotateLocked(runDir2);
}
function rotateLocked(runDir2) {
  const live = liveLogPath2(runDir2);
  const archive = archiveDir(runDir2);
  (0, import_node_fs2.mkdirSync)(archive, { recursive: true });
  const n = nextRotationIndex(runDir2);
  const stagingPath = (0, import_node_path2.join)(archive, `v1.4-events.${n}.jsonl`);
  const finalArchive = archivePath(runDir2, n);
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
var SIDECAR_MAX_BYTES3;
var init_event_log_sidecar = __esm({
  "../src/modules/lifecycle/workflows/event-log-sidecar.ts"() {
    init_security();
    init_stable_lock();
    init_event_log_schema();
    init_event_log_writer();
    SIDECAR_MAX_BYTES3 = 1024 * 1024;
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
  const sentinelPath = path16.join(cwd, ".guild", "runs", "current-run-id");
  try {
    const value = fs14.readFileSync(sentinelPath, "utf8").trim();
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
    appendEvent(path16.join(cwd, ".guild", "runs", runId), event);
  } catch (err) {
    process.stderr.write(
      `[emit-loop-event] ERROR: could not write event: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
var fs14, path16, VALID_EVENTS, VALID_LAYERS, VALID_TERMINATED;
var init_emit_loop_event = __esm({
  "../src/modules/lifecycle/workflows/emit-loop-event.ts"() {
    fs14 = __toESM(require("fs"));
    path16 = __toESM(require("path"));
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
  const [runDir2, laneId2] = positionals;
  if (!runDir2 || !laneId2) {
    return {
      error: "usage: mark-lane-dead.ts <runDir> <laneId> --attempts <n> [--last-error <s>] [--run-id <s>] [--plan-slug <s>] [--program-id <s>] [--wave-index <n>] [--cwd <p>]"
    };
  }
  if (attempts === void 0 || !Number.isFinite(attempts) || attempts < 1) {
    return { error: `--attempts <n> is required and must be an integer \u2265 1 (got ${argv.join(" ")})` };
  }
  return {
    runDir: runDir2,
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
function repoRootFromRunDir(runDir2) {
  return path17.resolve(runDir2, "..", "..", "..");
}
function markLaneDeadFromArgs(args) {
  const cwd = args.cwd ?? repoRootFromRunDir(args.runDir);
  const runId = args.runId ?? path17.basename(args.runDir);
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
var path17;
var init_mark_lane_dead = __esm({
  "../src/modules/lifecycle/workflows/mark-lane-dead.ts"() {
    path17 = __toESM(require("path"));
    init_run_state();
    if (require.main === module && new RegExp("[\\\\/]mark-lane-dead\\.[cm]?[jt]s$").test(process.argv[1] ?? "")) {
      runMarkLaneDeadCli();
    }
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
  const [runDir2] = positionals;
  if (!runDir2) {
    return { error: "usage: resume-lanes.ts <runDir> [--json] [--cwd <repo-root>] [--slug <slug>]" };
  }
  return { runDir: runDir2, json, cwd, slug };
}
function repoRootFromRunDir2(runDir2) {
  return path18.resolve(runDir2, "..", "..", "..");
}
function scanResumableLanes(runDir2, cwd, slug) {
  const repoRoot = cwd ?? repoRootFromRunDir2(runDir2);
  if (!readResumeEnabled(repoRoot)) {
    return [];
  }
  const lanesDir = path18.join(runDir2, "lanes");
  let entries;
  try {
    entries = fs15.readdirSync(lanesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const runState = loadRunState(runDir2);
  const planSlug = slug ?? runState?.plan_slug ?? null;
  const planTaskIds = planSlug ? readPlanTaskIdSet(repoRoot, planSlug) : /* @__PURE__ */ new Set();
  const validateAgainstPlan = planTaskIds.size > 0;
  const omittedOrphans = [];
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const laneId2 = entry.name;
    const cp = loadLaneResumeCheckpoint(runDir2, laneId2);
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
function renderHuman(runDir2, lanes) {
  if (lanes.length === 0) {
    return `[resume-lanes] no resumable dead lanes in ${runDir2}
`;
  }
  const rows = [
    `[resume-lanes] ${lanes.length} resumable dead lane(s) in ${runDir2}:`,
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
var fs15, path18;
var init_resume_lanes = __esm({
  "../src/modules/lifecycle/workflows/resume-lanes.ts"() {
    fs15 = __toESM(require("fs"));
    path18 = __toESM(require("path"));
    init_run_state();
    init_teams();
    if (require.main === module && new RegExp("[\\\\/]resume-lanes\\.[cm]?[jt]s$").test(process.argv[1] ?? "")) {
      runResumeLanesCli();
    }
  }
});

// ../src/modules/lifecycle/workflows/retry-lane.ts
var init_retry_lane = __esm({
  "../src/modules/lifecycle/workflows/retry-lane.ts"() {
    init_config2();
  }
});

// ../src/modules/lifecycle/workflows/write-run-manifest.ts
function manifestPathFor(cwd, slug) {
  return path19.join(cwd, ".guild", "programs", slug, "manifest.json");
}
function readRunManifest(cwd, slug) {
  try {
    const raw = fs16.readFileSync(manifestPathFor(cwd, slug), "utf8");
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
  if (!fs16.existsSync(args.cwd) || !fs16.statSync(args.cwd).isDirectory()) {
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
var fs16, path19, WAVE_STATUSES, PROGRAM_STATUSES;
var init_write_run_manifest = __esm({
  "../src/modules/lifecycle/workflows/write-run-manifest.ts"() {
    fs16 = __toESM(require("fs"));
    path19 = __toESM(require("path"));
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

// ../src/modules/lifecycle/workflows/write-task-run.ts
function taskRunPath(cwd, runId, taskId) {
  return path20.join(cwd, ".guild", "runs", runId, "task-runs", `${taskId}.yaml`);
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
    const _traceRunDir = path20.join(cwd, ".guild", "runs", runId);
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
var path20;
var init_write_task_run = __esm({
  "../src/modules/lifecycle/workflows/write-task-run.ts"() {
    path20 = __toESM(require("path"));
    init_telemetry();
    init_kernel();
    init_state();
    if (require.main === module && new RegExp("[\\\\/]write-task-run\\.[cm]?[jt]s$").test(process.argv[1] ?? "")) {
      runWriteTaskRunCli();
    }
  }
});

// ../src/modules/lifecycle/workflows/neutral-runtime-contracts.ts
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
var NEUTRAL_LIFECYCLE_PHASES, NEUTRAL_DISPOSITIONS, NEUTRAL_OBSERVATION_STATES, NEUTRAL_OUTCOME_TYPES, NEUTRAL_EVENT_NAMES, NEUTRAL_SUPPORT_STATES, NEUTRAL_SUPPORT_STATUS_VALUES, NEUTRAL_SCENARIO_CATEGORIES, NEUTRAL_REASON_CODES, NEUTRAL_EVENT_COMPATIBILITY_KINDS, NEUTRAL_EVENT_COMPATIBILITY_RULES, NEUTRAL_SUPERSEDED_EVENT_NAMES_V1, NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2, NEUTRAL_NORMALIZED_EVENT_VOCABULARY;
var init_neutral_runtime_contracts = __esm({
  "../src/modules/lifecycle/workflows/neutral-runtime-contracts.ts"() {
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
      "boundary_capability_alias"
    ]);
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
var init_neutral_gate_policy = __esm({
  "../src/modules/lifecycle/workflows/neutral-gate-policy.ts"() {
    init_neutral_runtime_contracts();
  }
});

// ../src/modules/lifecycle/workflows/neutral-lifecycle-machine.ts
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
var NEUTRAL_CORE_WAVE_OWNER, NEUTRAL_EVIDENCE_PROFILES, NEUTRAL_CORE_SCENARIOS, NEUTRAL_UNEVALUATED_SUPPORT, NEUTRAL_SUPPORT_TRANSITIONS, NEUTRAL_REQUIRED_CORE_SCENARIO_IDS, NEUTRAL_RECEIPT_REF_PATTERN, NEUTRAL_RUNTIME_VERSION_PATTERN, NEUTRAL_RECOGNIZED_PLATFORMS, NEUTRAL_RECOGNIZED_HOST_IDS, NEUTRAL_SOURCE_COMMIT_PATTERN, NEUTRAL_PACKAGE_HASH_PATTERN, NEUTRAL_ADAPTER_VERSION_PATTERN, NEUTRAL_RELEASE_ID_PATTERN, NEUTRAL_SEMVER_PATTERN, NEUTRAL_JOURNAL_ID_PATTERN, NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS, NEUTRAL_ATTESTATION_MESSAGE_CHAINS, NEUTRAL_ATTESTATION_CHECKSUM_CHAINS, NEUTRAL_ATTESTATION_CHAINS, NEUTRAL_ATTESTATION_TREE_HEIGHT, NEUTRAL_ATTESTOR_TRUST_ROOT, NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS, NEUTRAL_ATTESTATION_REF_PATTERN, NEUTRAL_ATTESTATION_SIGNATURE_PATTERN, NEUTRAL_COMMITMENT_PATTERN, NEUTRAL_CLAIMANT_ID_PATTERN, NEUTRAL_EVIDENCE_IDENTITY_FIELDS, NEUTRAL_SHA256_HEX_PATTERN;
var init_neutral_conformance_core = __esm({
  "../src/modules/lifecycle/workflows/neutral-conformance-core.ts"() {
    init_neutral_runtime_contracts();
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
    NEUTRAL_RECEIPT_REF_PATTERN = new RegExp(
      "^guild\\.receipt_ref\\.v1:([A-Za-z0-9][A-Za-z0-9._-]{2,})#(0|[1-9][0-9]*)@(nec1:[0-9a-f]{16})$"
    );
    NEUTRAL_RUNTIME_VERSION_PATTERN = new RegExp(
      "^guild-(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$"
    );
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
    NEUTRAL_RELEASE_ID_PATTERN = new RegExp("^rel-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-z]{1,16}$");
    NEUTRAL_SEMVER_PATTERN = new RegExp(
      "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$"
    );
    NEUTRAL_JOURNAL_ID_PATTERN = new RegExp("^[A-Za-z0-9][A-Za-z0-9._-]{2,}$");
    NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS = Object.freeze(["fresh", "stale", "unknown"]);
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
    NEUTRAL_SHA256_HEX_PATTERN = new RegExp("^[0-9a-f]{64}$");
  }
});

// ../src/modules/lifecycle/workflows/neutral-core-boundary.ts
var NEUTRAL_CORE_MEMBERS, NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS, DEPENDENCY_WORD, NEUTRAL_PURE_INTRINSIC_ROOTS, NEUTRAL_LANGUAGE_WORDS, NEUTRAL_PROTOTYPE_CHAIN_PROPERTIES, NEUTRAL_REFLECTION_METHOD_NAMES;
var init_neutral_core_boundary = __esm({
  "../src/modules/lifecycle/workflows/neutral-core-boundary.ts"() {
    init_neutral_runtime_contracts();
    NEUTRAL_CORE_MEMBERS = Object.freeze([
      "neutral-runtime-contracts.ts",
      "neutral-gate-policy.ts",
      "neutral-lifecycle-machine.ts",
      "neutral-conformance-core.ts",
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

// ../src/modules/lifecycle/index.ts
var init_lifecycle = __esm({
  "../src/modules/lifecycle/index.ts"() {
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
    init_neutral_runtime_contracts();
    init_neutral_gate_policy();
    init_neutral_lifecycle_machine();
    init_neutral_conformance_core();
    init_neutral_core_boundary();
  }
});

// ../src/modules/teams/workflows/team-file.ts
function readPlanOwnerTaskIds(guildRoot, slug) {
  const map = /* @__PURE__ */ new Map();
  let raw;
  try {
    raw = fs17.readFileSync(path21.join(guildRoot, ".guild", "plan", `${slug}.md`), "utf8");
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
var fs17, path21;
var init_team_file = __esm({
  "../src/modules/teams/workflows/team-file.ts"() {
    fs17 = __toESM(require("fs"));
    path21 = __toESM(require("path"));
    init_lifecycle();
    init_state();
  }
});

// ../src/modules/teams/workflows/canonical-hash.ts
var init_canonical_hash = __esm({
  "../src/modules/teams/workflows/canonical-hash.ts"() {
  }
});

// ../src/modules/teams/index.ts
var init_teams = __esm({
  "../src/modules/teams/index.ts"() {
    init_team_file();
    init_canonical_hash();
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
function makeAdvisoryRecord(input) {
  const rec = {
    schema_version: ADVISORY_RECORD_SCHEMA,
    id: input.id,
    run_id: input.run_id ?? null,
    initiative_id: input.initiative_id ?? null,
    phase: input.phase,
    backend: input.backend,
    question: input.question,
    // Shallow-copy arrays so the caller's originals are not mutated.
    advisors: input.advisors.map((a) => ({ ...a })),
    recommendations: input.recommendations.map((r) => ({ ...r })),
    synthesis: input.synthesis,
    unresolved_questions: (input.unresolved_questions ?? []).slice(),
    confidence: input.confidence,
    recorded_at: input.recorded_at
  };
  if (input.decision_link !== void 0) {
    rec.decision_link = input.decision_link;
  }
  if (input.substrate !== void 0) {
    rec.substrate = input.substrate;
  }
  return rec;
}
var ADVISORY_RECORD_SCHEMA, ADVISORY_BACKENDS, ADVISORY_SUBSTRATES, ADVISORY_CONFIDENCE, ADVISORY_PHASES, BACKEND_SET, CONFIDENCE_SET, SUBSTRATE_SET;
var init_advisory_record = __esm({
  "../src/modules/review/resources/scripts/lib/advisory-record.ts"() {
    ADVISORY_RECORD_SCHEMA = "guild.advisory.v1";
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
    if (require.main === module && /^advisory-record\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
      const now = (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
      const skeleton = makeAdvisoryRecord({
        id: `advisory-example-001`,
        recorded_at: now,
        phase: "ideation",
        backend: "single_agent",
        question: "Which architecture path should this initiative take?",
        advisors: [
          { role: "product", model_tier: "cheap" },
          { role: "architecture", model_tier: "mid" }
        ],
        recommendations: [
          { role: "product", recommendation: "Prefer the simpler layered approach.", confidence: "medium" },
          { role: "architecture", recommendation: "Event-driven boundary fits better for scale.", confidence: "high" }
        ],
        synthesis: "Use event-driven boundaries at service edges; keep internal domain logic layered.",
        confidence: "high",
        unresolved_questions: []
      });
      process.stdout.write(JSON.stringify(skeleton, null, 2) + "\n");
    }
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

// agent-team/task-completed.ts
var fs21 = __toESM(require("fs"));
var path25 = __toESM(require("path"));
var readline = __toESM(require("readline"));

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

// ../scripts/lib/run-binding.ts
init_run_binding();

// lib/hook-binding.ts
function reject(reason, run_id) {
  return { ok: false, diagnostic: "binding_rejected", reason, run_id };
}
function authorizeHookWrite(root, opts = {}) {
  const env = opts.env ?? process.env;
  const envelope = readHookBindingEnvelope(env);
  const envRunId = env["GUILD_RUN_ID"]?.trim();
  const runId = opts.runId ?? envelope?.run_id ?? (envRunId || void 0);
  if (!runId) return reject("binding_absent", null);
  const ref = opts.bindingRef ?? (envelope && envelope.run_id === runId ? envelope.binding_ref : void 0);
  if (ref === void 0 || ref.trim().length === 0) {
    return reject("binding_absent", runId);
  }
  const verdict = verifyRunBinding({ root, run_id: runId, binding_ref: ref });
  if (verdict.ok === false) return reject(verdict.reason, runId);
  return { ok: true, run_id: runId, binding_ref: verdict.binding.binding_ref };
}
function formatBindingRejected(hook, auth) {
  if (auth.ok !== false) return "";
  return `[${hook}] binding_rejected (${auth.reason}) for run ${auth.run_id ?? "<unresolved>"} \u2014 no write performed (session_context \xA75: writers fail closed; sentinels are intake-only).
`;
}

// lib/handoff-v2.ts
init_sealed_collections();
var SUMMARY_MAX_CHARS = 600;
var NOTES_MAX_CHARS = 200;
var ALLOWED_INJECTION_CLEAN_VALUES = sealSet([
  "clean",
  "flagged",
  "unverified"
], "ALLOWED_INJECTION_CLEAN_VALUES");
var VALID_TIERS = /* @__PURE__ */ new Set(["cheap", "mid", "powerful"]);
var VALID_STATUSES = /* @__PURE__ */ new Set(["done", "blocked", "escalate"]);
var ALLOWED_TOP_LEVEL_KEYS = sealSet([
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
  // HK-08 additive-optional
], "ALLOWED_TOP_LEVEL_KEYS");
function validateHandoffV2(value) {
  const errors = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["envelope must be a non-null object"] };
  }
  const obj = value;
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(k)) {
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
  if (typeof obj["tier"] !== "string" || !VALID_TIERS.has(obj["tier"])) {
    errors.push(`tier must be one of cheap|mid|powerful; got ${JSON.stringify(obj["tier"])}`);
  }
  if (typeof obj["status"] !== "string" || !VALID_STATUSES.has(obj["status"])) {
    errors.push(
      `status must be one of done|blocked|escalate; got ${JSON.stringify(obj["status"])}`
    );
  }
  if (typeof obj["summary"] !== "string") {
    errors.push("summary must be a string");
  } else if (obj["summary"].trim() === "") {
    errors.push("summary must not be empty");
  } else if (obj["summary"].length > SUMMARY_MAX_CHARS) {
    errors.push(
      `summary exceeds ${SUMMARY_MAX_CHARS} char cap (bloat rejection SC-7): got ${obj["summary"].length} chars`
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
    } else if (obj["notes"].length > NOTES_MAX_CHARS) {
      errors.push(
        `notes exceeds ${NOTES_MAX_CHARS} char cap (O-4 binding resolution): got ${obj["notes"].length} chars`
      );
    }
  }
  if (obj["injection_clean"] !== void 0) {
    if (!ALLOWED_INJECTION_CLEAN_VALUES.has(obj["injection_clean"])) {
      errors.push(
        `injection_clean must be one of clean|flagged|unverified; got ${JSON.stringify(obj["injection_clean"])}`
      );
    }
  }
  return { valid: errors.length === 0, errors };
}
function extractHandoffEnvelope(content) {
  const pattern = /```guild\.handoff\.v2\s*\n([\s\S]*?)```/;
  const match = pattern.exec(content);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

// lib/run-date.ts
var fs2 = __toESM(require("fs"));
var path4 = __toESM(require("path"));

// ../scripts/lib/frontmatter.ts
init_frontmatter();
var readScalarField2 = readScalarField;

// lib/run-date.ts
var POLICY_EFFECTIVE_DATE = /* @__PURE__ */ new Date("2026-06-03T00:00:00Z");
function readRunStartedAt(runDir2) {
  const runYamlPath = path4.join(runDir2, "run.yaml");
  try {
    if (!fs2.existsSync(runYamlPath)) return null;
    const raw = fs2.readFileSync(runYamlPath, "utf8");
    const value = readScalarField2(raw, "started_at");
    if (value === void 0) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
function isRunInScope(runDir2, taskId) {
  const runDate = readRunStartedAt(runDir2);
  if (runDate === null) {
    return {
      inscope: false,
      reason: "indeterminate",
      warn: `[task-completed] WARN: cannot determine run date for task "${taskId}" (no run.yaml or missing/unparseable started_at at ${runDir2}/run.yaml) \u2014 fail-open to lenient (envelope optional for indeterminate-date runs).`
    };
  }
  if (runDate >= POLICY_EFFECTIVE_DATE) {
    return { inscope: true };
  }
  return { inscope: false, reason: "grandfathered" };
}

// lib/run-state.ts
init_run_state();

// lib/security/injection-guard.ts
var DIRECTIVE_PATTERNS = [
  // ── Classic "ignore previous / all / above" ───────────────────────────────
  // Broad form: "ignore [optional modifiers] instructions/prompt/context/directives"
  // Handles: "ignore instructions", "ignore previous instructions",
  //          "ignore above instructions", "ignore all previous directives", etc.
  {
    name: "ignore-previous-instructions",
    re: /\bignore\b(?:\s+\w+){0,3}\s+\b(instructions?|prompt|context|directives?)\b/i
  },
  {
    name: "disregard-previous-instructions",
    re: /\bdisregard\b(?:\s+\w+){0,3}\s+\b(instructions?|prompt|context)\b/i
  },
  // "forget [your/my/all] [previous/prior/past] instructions/context"
  {
    name: "forget-previous-instructions",
    re: /\bforget\b(?:\s+(?:your|my|all|previous|prior|past|earlier)){1,3}\s+\b(instructions?|prompt|context|rules?)\b/i
  },
  {
    name: "override-previous-instructions",
    re: /\boverride\b(?:\s+\w+){0,3}\s+\b(instructions?|context|prompt)\b/i
  },
  // ── Role-reassignment: "you are now / act as / pretend" ──────────────────
  {
    name: "you-are-now",
    re: /you\s+are\s+now\s+(a|an|the|going|able|authorized|required)/i
  },
  {
    name: "act-as-if",
    re: /act\s+as\s+(if|though|a|an|the)\b/i
  },
  {
    name: "pretend-you-are",
    re: /pretend\s+(you\s+are|to\s+be)\b/i
  },
  {
    name: "your-new-instructions",
    re: /your\s+(new|updated|actual|real|true)\s+(instructions?|persona|role|identity|task)/i
  },
  // ── System / context injection ────────────────────────────────────────────
  {
    name: "system-prompt",
    re: /system\s+prompt/i
  },
  {
    name: "markdown-system-block",
    re: /```\s*system\b/i
  },
  // Anthropic conversation-format injection (\n\nHuman: / \n\nAssistant:)
  {
    name: "anthropic-format-human",
    re: /\n\s*human\s*:/i
  },
  {
    name: "anthropic-format-assistant",
    re: /\n\s*assistant\s*:/i
  },
  // HTML comment injection
  {
    name: "html-comment-injection",
    re: /<!--\s*(ignore|override|instruction|system|disregard)/i
  },
  // ── Jailbreak keywords ────────────────────────────────────────────────────
  {
    name: "jailbreak",
    re: /\bjailbreak\b/i
  }
];
function sanitizeForInjection(text) {
  const matchedPatterns = [];
  for (const { name, re } of DIRECTIVE_PATTERNS) {
    if (re.test(text)) {
      matchedPatterns.push(name);
    }
  }
  return {
    result: matchedPatterns.length > 0 ? "flagged" : "clean",
    sanitized: text,
    matchedPatterns
  };
}
function classifyEnvelope(envelope) {
  const existing = envelope["injection_clean"];
  if (existing === "clean") return "clean";
  if (existing === "flagged") return "flagged";
  const summary = typeof envelope["summary"] === "string" ? envelope["summary"] : "";
  const notes = typeof envelope["notes"] === "string" ? envelope["notes"] : "";
  const combined = [summary, notes].filter(Boolean).join("\n");
  const r = sanitizeForInjection(combined);
  return r.result;
}

// lib/security/events.ts
init_events();

// lib/security/scrubbed-write.ts
init_scrubbed_write();

// lib/security/secrets.ts
init_secrets();

// lib/security/config.ts
init_config();

// lib/bus-emit.ts
var fs11 = __toESM(require("node:fs"));
var path13 = __toESM(require("node:path"));
var BUS_EVENT_SCHEMA_VERSION = "guild.agent_bus_event.v1";
function buildBusEvent(input) {
  const rec = {
    schema_version: BUS_EVENT_SCHEMA_VERSION,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    run_id: input.run_id,
    event: input.event
  };
  if (typeof input.lane_id === "string" && input.lane_id.length > 0) rec.lane_id = input.lane_id;
  if (typeof input.task_id === "string" && input.task_id.length > 0) rec.task_id = input.task_id;
  if (typeof input.team_name === "string" && input.team_name.length > 0) {
    rec.team_name = input.team_name;
  }
  if (typeof input.detail === "string" && input.detail.length > 0) rec.detail = input.detail;
  return rec;
}
function emitBusEvent(runDir2, input) {
  try {
    const busDir2 = path13.join(runDir2, "agent-bus");
    fs11.mkdirSync(busDir2, { recursive: true });
    const record = buildBusEvent(input);
    fs11.appendFileSync(
      path13.join(busDir2, "events.ndjson"),
      JSON.stringify(record) + "\n",
      "utf8"
    );
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [bus-emit] write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}

// ../scripts/lib/run-lifecycle.ts
init_run_lifecycle();

// ../scripts/lib/runstart-preflight.ts
init_runstart_preflight();

// emit-learning-checkpoint.ts
var fs18 = __toESM(require("fs"));
var path22 = __toESM(require("path"));

// ../src/modules/initiatives/workflows/classify-proposal.ts
function classifyProposal(input) {
  const target = input.target ?? "skill";
  const subject = input.subject ?? "<skill>";
  const countGate = input.distinct_subject_count >= 3 || input.distinct_subject_count >= 2 && input.same_run === true;
  const systemic = countGate && input.same_signature === true && input.user_approved === true;
  const perInstance = `${target}_def: proposal:${subject}`;
  const outputs = [perInstance];
  if (systemic) {
    outputs.push(`${target}_template: systemic-proposal`);
  }
  return { verdict: systemic ? "systemic" : "specific", outputs };
}
function parseFlag(argv, name) {
  const eq = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
    if (argv[i].startsWith(eq)) return argv[i].slice(eq.length);
  }
  return void 0;
}
function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}
function runClassifyProposalCli(argv = process.argv.slice(2)) {
  const distinct = parseInt(parseFlag(argv, "distinct") ?? "0", 10);
  const target = parseFlag(argv, "target") ?? "skill";
  const subject = parseFlag(argv, "subject");
  const res = classifyProposal({
    distinct_subject_count: Number.isFinite(distinct) ? distinct : 0,
    same_run: hasFlag(argv, "same-run"),
    same_signature: hasFlag(argv, "same-signature"),
    user_approved: hasFlag(argv, "user-approved"),
    target: target === "agent" ? "agent" : "skill",
    ...subject ? { subject } : {}
  });
  process.stdout.write(JSON.stringify(res, null, 2) + "\n");
}
if (require.main === module && /^classify-proposal\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  runClassifyProposalCli();
}

// ../src/modules/initiatives/workflows/initiative.ts
var DEFINITION_STATUS = Object.freeze(["incomplete", "assumed", "complete"]);
var EXECUTION_STATUS = Object.freeze(["not_started", "active", "blocked", "done"]);
var RELEASE_STATUS = Object.freeze(["not_released", "release_candidate", "released", "rollback_required"]);
var DOCUMENTATION_STATUS = Object.freeze(["not_assessed", "no_update_required", "update_required", "updated", "stale"]);
var DERIVED_STATUS = Object.freeze([
  "proposed",
  "defining",
  "ready",
  "in_progress",
  "review",
  "release_ready",
  "released",
  "docs_update_pending",
  "closed",
  "paused",
  "cancelled"
]);
var DEFINITION_CATEGORIES = Object.freeze([
  "goal",
  "outcome",
  "scope",
  "non_goal",
  "acceptance",
  "constraint",
  "risk",
  "assumption",
  "open_question"
]);
var DEFINITION_ITEM_STATUS = Object.freeze(["defined", "needs_definition", "assumed", "superseded"]);

// ../src/modules/initiatives/workflows/initiative-activity.ts
var ACTIVITY_EVENTS = Object.freeze([
  "created",
  "status_change",
  "definition_updated",
  "work_item_added",
  "work_item_closed",
  "run_attached",
  "summary_updated",
  "released",
  "closed",
  "archived",
  "note"
]);
var SET = new Set(ACTIVITY_EVENTS);

// ../src/modules/initiatives/workflows/initiative-workitems.ts
var WORK_ITEM_TYPES = Object.freeze([
  "research",
  "design",
  "implementation",
  "review",
  "validation",
  "docs",
  "release",
  "cleanup"
]);
var WORK_ITEM_STATUS = Object.freeze([
  "proposed",
  "ready",
  "in_progress",
  "blocked",
  "done",
  "deferred",
  "cancelled"
]);
var TYPES = new Set(WORK_ITEM_TYPES);
var STATUS = new Set(WORK_ITEM_STATUS);

// ../src/modules/evolution/workflows/learning-signatures.ts
function allLearnings(artifacts) {
  const out = [];
  for (const block of artifacts.handoffBlocks ?? []) {
    for (const l of block.learnings ?? []) {
      if (l) out.push(l);
    }
  }
  return out;
}
function allFollowups(artifacts) {
  const out = [];
  for (const block of artifacts.handoffBlocks ?? []) {
    for (const f of block.followups ?? []) {
      if (f) out.push(f);
    }
  }
  return out;
}
function bestRef(artifacts) {
  const wiki = artifacts.provenanceTouched?.wiki ?? [];
  if (wiki.length > 0) return wiki[0];
  return artifacts.evidenceRef ?? artifacts.runId;
}
function filesInclude(artifacts, patterns) {
  const files = [
    ...artifacts.changedFiles ?? [],
    ...artifacts.provenanceTouched?.files ?? []
  ];
  return files.some((f) => patterns.some((p) => p.test(f)));
}
function learningsReferenceSkill(artifacts) {
  const learnings = allLearnings(artifacts);
  const followups = allFollowups(artifacts);
  const all = [...learnings, ...followups];
  for (const text of all) {
    const match = text.match(/\b(?:skill[:\s]+|guild:)([\w:-]+)/i);
    if (match) return match[1] ?? "unknown-skill";
    if (/skill[\s_-](?:improvement|gap|defect|change|update|refactor)/i.test(text)) {
      return "unknown-skill";
    }
  }
  return null;
}
function learningsReferenceAgent(artifacts) {
  const learnings = allLearnings(artifacts);
  const followups = allFollowups(artifacts);
  const all = [...learnings, ...followups];
  for (const text of all) {
    const match = text.match(/\b(?:agent[:\s]+|guild:)([\w:-]+(?:engineer|writer|author|architect|specialist|reviewer|planner|developer|auditor))/i);
    if (match) return match[1] ?? "unknown-agent";
    if (/agent[\s_-](?:improvement|gap|defect|change|update|refactor)/i.test(text)) {
      return "unknown-agent";
    }
  }
  return null;
}
function classifyMemory(artifacts) {
  try {
    const decisions = artifacts.provenanceTouched?.decisions ?? [];
    if (decisions.length > 0) {
      const ref = decisions[0];
      return `candidate:${ref}`;
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyWiki(artifacts) {
  try {
    const wikiTouched = artifacts.provenanceTouched?.wiki ?? [];
    if (wikiTouched.length > 0) {
      return `candidate:${wikiTouched[0]}`;
    }
    const followups = allFollowups(artifacts);
    if (followups.some(
      (f) => /\b(?:wiki[\s_-]?ingest|wiki[\s_-]?page|decisions?[\s_-]?capture|guild:decisions|guild:wiki)/i.test(f)
    )) {
      return `candidate:${bestRef(artifacts)}`;
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyKnowledgeGraph(artifacts) {
  try {
    const initiatives = artifacts.provenanceTouched?.initiatives ?? [];
    if (initiatives.length > 0) {
      return "refresh:initiative-touched";
    }
    if (filesInclude(artifacts, [
      /\.guild\/wiki\//,
      /\.guild\/raw\/sources\//,
      /\.guild\/initiatives\//,
      /\.guild\/reflections\//,
      /\.guild\/evolve\//,
      /\.guild\/indexes\/harvest-/
    ])) {
      return "refresh:stale";
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyDomainModel(artifacts) {
  try {
    if (filesInclude(artifacts, [
      /\.guild\/indexes\/domain-graph\.json/
    ])) {
      return "re-derive";
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyAgentDef(artifacts) {
  try {
    const agentRef = learningsReferenceAgent(artifacts);
    if (agentRef !== null) {
      return `proposal:${agentRef}`;
    }
    const all = [...allLearnings(artifacts), ...allFollowups(artifacts)];
    for (const text of all) {
      const match = text.match(/proposal:([a-z][\w:-]+)/i);
      if (match && /agent/i.test(match[1] ?? "")) {
        return `proposal:${match[1]}`;
      }
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifySkillDef(artifacts) {
  try {
    const skillRef = learningsReferenceSkill(artifacts);
    if (skillRef !== null) {
      return `proposal:${skillRef}`;
    }
    const all = [...allLearnings(artifacts), ...allFollowups(artifacts)];
    for (const text of all) {
      const match = text.match(/proposal:([\w:-]+)/i);
      if (match && /skill/i.test(text)) {
        return `proposal:${match[1]}`;
      }
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyAgentTemplate(artifacts) {
  try {
    const input = artifacts.classifyProposalInput;
    if (!input) return "none";
    const result = classifyProposal({ ...input, target: "agent" });
    return result.verdict === "systemic" ? "systemic-proposal" : "none";
  } catch {
    return "none";
  }
}
function classifySkillTemplate(artifacts) {
  try {
    const input = artifacts.classifyProposalInput;
    if (!input) return "none";
    const result = classifyProposal({ ...input, target: "skill" });
    return result.verdict === "systemic" ? "systemic-proposal" : "none";
  } catch {
    return "none";
  }
}
function classifyConfig(artifacts) {
  try {
    const configKeys = artifacts.provenanceTouched?.config_keys ?? [];
    if (configKeys.length > 0) {
      return `proposal:${configKeys[0]}`;
    }
    const settingsFiles = [
      ...artifacts.changedFiles ?? [],
      ...artifacts.provenanceTouched?.files ?? []
    ].filter(
      (f) => /(?:settings\.json|settings\.local\.json|\.claude-plugin\/|guild\.json|\.guild\/settings|guildstack\.pen)/i.test(f)
    );
    if (settingsFiles.length > 0) {
      const f = settingsFiles[0];
      const keyMatch = f.match(/([^/]+)\.json$/);
      return `proposal:${keyMatch ? keyMatch[1] : "settings"}`;
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyTaskTracking(artifacts) {
  try {
    const tasks = artifacts.provenanceTouched?.tasks ?? [];
    if (tasks.length > 0) {
      const anyDone = (artifacts.handoffBlocks ?? []).some(
        (b) => b.status === "done" || b.status === "shipped"
      );
      if (anyDone || artifacts.handoffBlocks === void 0) {
        return `update:${tasks[0]}`;
      }
    }
    const runs = artifacts.provenanceTouched?.runs ?? [];
    if (runs.length > 0) {
      const anyDone = (artifacts.handoffBlocks ?? []).some(
        (b) => b.status === "done" || b.status === "shipped"
      );
      if (anyDone) {
        return `update:run:${runs[0]}`;
      }
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyWorkflowRules(artifacts) {
  try {
    const decisions = artifacts.provenanceTouched?.decisions ?? [];
    for (const d of decisions) {
      if (/^(?:workflow[\s_-]exception|gate[\s_-]skip|phase[\s_-]override|workflow[\s_-]override)/i.test(d)) {
        return `proposal:${d}`;
      }
    }
    const issues = (artifacts.handoffBlocks ?? []).flatMap((b) => b.issues ?? []);
    for (const text of issues) {
      if (/\b(?:gate[\s_-]skip(?:ped)?|phase[\s_-]order[\s_-]deviation|workflow[\s_-]override|force[\s_-]gate|gate[\s_-]force[d]?)\b/i.test(text)) {
        const ruleMatch = text.match(/(?:gate[\s_-]skip|phase[\s_-]override|workflow[\s_-]override)[:\s]+([\w-]+)/i);
        return `proposal:${ruleMatch ? ruleMatch[1] : "workflow-exception"}`;
      }
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyReviewPolicy(artifacts) {
  try {
    const all = [
      ...allLearnings(artifacts),
      ...allFollowups(artifacts),
      ...(artifacts.handoffBlocks ?? []).flatMap((b) => b.issues ?? []),
      ...(artifacts.handoffBlocks ?? []).map((b) => b.notes ?? ""),
      ...(artifacts.handoffBlocks ?? []).map((b) => b.summary ?? "")
    ];
    for (const text of all) {
      if (/\b(?:BLOCK|block[\s_-]override|owner[\s_-]accepted[\s_-]risk|gate[\s_-]override|releasegate|review[\s_-]gate[\s_-]fail)\b/.test(text)) {
        const gateMatch = text.match(/(?:G[-_]?(\w+)|gate[\s:]+([\w-]+)|releasegate)/i);
        const gate = gateMatch ? gateMatch[1] ?? gateMatch[2] ?? "releasegate" : "releasegate";
        return `proposal:${gate}`;
      }
      if (/\bcap[\s_-]exceeded\b|rounds[\s_-]cap[\s_-]hit\b|codex[\s_-]cap\b/i.test(text)) {
        return "proposal:codex-cap";
      }
    }
    const decisions = artifacts.provenanceTouched?.decisions ?? [];
    if (decisions.some((d) => /review[\s_-]?policy|gate[\s_-]?policy/i.test(d))) {
      return `proposal:${decisions.find((d) => /review|gate/i.test(d))}`;
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyPhase(artifacts) {
  return {
    memory: classifyMemory(artifacts),
    wiki: classifyWiki(artifacts),
    knowledge_graph: classifyKnowledgeGraph(artifacts),
    domain_model: classifyDomainModel(artifacts),
    agent_def: classifyAgentDef(artifacts),
    skill_def: classifySkillDef(artifacts),
    agent_template: classifyAgentTemplate(artifacts),
    skill_template: classifySkillTemplate(artifacts),
    config: classifyConfig(artifacts),
    task_tracking: classifyTaskTracking(artifacts),
    workflow_rules: classifyWorkflowRules(artifacts),
    review_policy: classifyReviewPolicy(artifacts)
  };
}

// emit-learning-checkpoint.ts
var SCHEMA_VERSION = "guild.learning_checkpoint.v1";
var VALID_PHASES = Object.freeze([
  "init",
  "ideation",
  "planning",
  "development",
  "quality",
  "operations",
  "reflection"
]);
var DECISION_TARGETS = Object.freeze([
  "memory",
  "wiki",
  "knowledge_graph",
  "domain_model",
  "agent_def",
  "skill_def",
  "agent_template",
  "skill_template",
  "config",
  "task_tracking",
  "workflow_rules",
  "review_policy"
]);
var ALL_NONE_DECISIONS = Object.fromEntries(
  DECISION_TARGETS.map((k) => [k, "none"])
);
var VALID_EDGE_TYPES = Object.freeze([
  "decided_by",
  "used_for",
  "produced",
  "touches",
  "supersedes",
  "learned_from",
  "constrains",
  "opens_question",
  "resolves"
]);
var ALLOWED_NODE_PREFIXES = Object.freeze([
  "task:",
  "run:",
  "decision:",
  "skill:",
  "agent:",
  "feature:"
]);
var FORBIDDEN_NODE_PREFIXES = Object.freeze([
  "wiki:",
  "file:",
  "domain:",
  "component:"
]);
function assertPhase(phase) {
  if (!VALID_PHASES.includes(phase)) {
    throw new Error(
      `[emit-learning-checkpoint] invalid phase: "${phase}". Expected one of: ${VALID_PHASES.join(", ")}`
    );
  }
}
function assertEdgeTypes(links) {
  for (const link of links) {
    if (!VALID_EDGE_TYPES.includes(link.type)) {
      throw new Error(
        `[emit-learning-checkpoint] invalid edge type: "${link.type}". Expected one of: ${VALID_EDGE_TYPES.join(", ")}`
      );
    }
  }
}
function assertNodePrefixes(links) {
  for (const link of links) {
    for (const node of [link.from, link.to]) {
      const allowed = ALLOWED_NODE_PREFIXES.some(
        (p) => node.startsWith(p)
      );
      if (!allowed) {
        const matchedForbidden = FORBIDDEN_NODE_PREFIXES.find(
          (p) => node.startsWith(p)
        );
        const detail = matchedForbidden ? `uses the cross-space prefix "${matchedForbidden}" (code/wiki/domain space)` : `uses an unknown or no-prefix node id "${node}"`;
        throw new Error(
          `[emit-learning-checkpoint] invalid node in edge (from: "${link.from}", to: "${link.to}") \u2014 ${detail}. Node ids must start with an allowed work/decision-space prefix: ${ALLOWED_NODE_PREFIXES.join(", ")}.`
        );
      }
    }
  }
}
function yamlValue(v) {
  if (v === "none") return "none";
  if (/: /.test(v) || // colon-space → would be a mapping
  /:$/.test(v) || // trailing colon
  v.trim() !== v || // leading/trailing whitespace
  v === "" || // empty
  /^[{[\]}&*#?|<>=!%@`'"]/.test(v)) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return v;
}
function buildYaml(opts) {
  const lines = [
    `# ${SCHEMA_VERSION}`,
    "learning_checkpoint:",
    `  version: ${SCHEMA_VERSION}`,
    `  phase: ${opts.phase}`,
    `  run_id: ${opts.runId}`
  ];
  if (opts.observed.length === 0) {
    lines.push("  observed: []");
  } else {
    lines.push("  observed:");
    for (const fact of opts.observed) {
      lines.push(`    - ${yamlValue(fact)}`);
    }
  }
  lines.push("  decisions:");
  for (const key of DECISION_TARGETS) {
    lines.push(`    ${key}: ${yamlValue(opts.decisions[key] ?? "none")}`);
  }
  if (opts.knowledgeLinksBatch.length === 0) {
    lines.push("  knowledge_links_batch: []");
  } else {
    lines.push("  knowledge_links_batch:");
    for (const link of opts.knowledgeLinksBatch) {
      lines.push(
        `    - from: ${yamlValue(link.from)}`,
        `      to: ${yamlValue(link.to)}`,
        `      type: ${link.type}`,
        `      run_id: ${link.run_id}`
      );
    }
  }
  lines.push(`  routed_to: ${yamlValue(opts.reflectionsPath)}`);
  lines.push(`  evidence_ref: ${yamlValue(opts.evidenceRef)}`);
  if (opts.backstop === true) {
    lines.push("  backstop: true");
  }
  return lines.join("\n") + "\n";
}
function appendKnowledgeLinksIndex(guildRoot, links) {
  if (links.length === 0) return;
  const indexDir = path22.join(guildRoot, ".guild", "indexes");
  const indexPath = path22.join(indexDir, "knowledge-links.json");
  let existing = [];
  if (fs18.existsSync(indexPath)) {
    try {
      const raw = fs18.readFileSync(indexPath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed["links"])) {
        existing = parsed["links"];
      }
    } catch (e) {
      process.stderr.write(
        `[emit-learning-checkpoint] WARN: could not parse knowledge-links.json \u2014 starting fresh: ${String(e)}
`
      );
      existing = [];
    }
  }
  const existingKeys = new Set(
    existing.map((l) => `${l.from}\0${l.to}\0${l.type}`)
  );
  const novel = links.filter(
    (l) => !existingKeys.has(`${l.from}\0${l.to}\0${l.type}`)
  );
  if (novel.length === 0) return;
  const merged = [...existing, ...novel];
  try {
    fs18.mkdirSync(indexDir, { recursive: true });
    fs18.writeFileSync(
      indexPath,
      JSON.stringify(
        { schema_version: "guild.knowledge_links.v1", links: merged },
        null,
        2
      ) + "\n",
      "utf8"
    );
  } catch (e) {
    process.stderr.write(
      `[emit-learning-checkpoint] WARN: could not write knowledge-links.json: ${String(e)}
`
    );
  }
}
function appendReflections(guildRoot, runId, phase, decisions) {
  const nonNone = DECISION_TARGETS.filter((k) => decisions[k] !== "none");
  if (nonNone.length === 0) return;
  const reflectionsDir = path22.join(guildRoot, ".guild", "reflections");
  fs18.mkdirSync(reflectionsDir, { recursive: true });
  const reflPath = path22.join(reflectionsDir, `${runId}.md`);
  const entry = `
## Phase: ${phase} (${runId})

` + nonNone.map((k) => `- ${k}: ${decisions[k]}`).join("\n") + "\n";
  fs18.appendFileSync(reflPath, entry, "utf8");
}
function writeCheckpoint(opts) {
  assertPhase(opts.phase);
  const links = opts.knowledgeLinksBatch ?? [];
  assertEdgeTypes(links);
  assertNodePrefixes(links);
  const guildRoot = opts.guildRoot ?? process.cwd();
  const decisions = opts.decisions ?? { ...ALL_NONE_DECISIONS };
  const learningDir = path22.join(guildRoot, ".guild", "runs", opts.runId, "learning");
  fs18.mkdirSync(learningDir, { recursive: true });
  const checkpointFile = path22.join(learningDir, `${opts.phase}-${opts.runId}.yaml`);
  const reflectionsRelPath = `.guild/reflections/${opts.runId}.md`;
  const reflectionsAbsPath = path22.join(guildRoot, ".guild", "reflections", `${opts.runId}.md`);
  const observed = opts.observed ?? [];
  const yaml3 = buildYaml({
    runId: opts.runId,
    phase: opts.phase,
    evidenceRef: opts.evidenceRef,
    decisions,
    observed,
    reflectionsPath: reflectionsRelPath,
    knowledgeLinksBatch: links,
    ...opts.backstop === true ? { backstop: true } : {}
  });
  fs18.writeFileSync(checkpointFile, yaml3, "utf8");
  appendReflections(guildRoot, opts.runId, opts.phase, decisions);
  appendKnowledgeLinksIndex(guildRoot, links);
  void reflectionsAbsPath;
  return checkpointFile;
}
function main() {
  const runId = process.env["GUILD_RUN_ID"];
  const phase = process.env["GUILD_PHASE"];
  const evidenceRef = process.env["GUILD_EVIDENCE_REF"] ?? "none";
  const guildRoot = process.env["GUILD_CWD"] ?? process.cwd();
  const verdictPath = process.env["GUILD_CHECKPOINT_VERDICT"];
  const linksPath = process.env["GUILD_CHECKPOINT_LINKS"];
  if (!runId) {
    process.stderr.write("[emit-learning-checkpoint] ERROR: GUILD_RUN_ID not set\n");
    process.exit(1);
  }
  if (!phase) {
    process.stderr.write("[emit-learning-checkpoint] ERROR: GUILD_PHASE not set\n");
    process.exit(1);
  }
  const artifactsJsonPath = process.env["GUILD_CHECKPOINT_ARTIFACTS_JSON"];
  let decisions;
  if (verdictPath) {
    try {
      const raw = fs18.readFileSync(verdictPath, "utf8");
      decisions = JSON.parse(raw);
    } catch (e) {
      process.stderr.write(
        `[emit-learning-checkpoint] WARN: could not read GUILD_CHECKPOINT_VERDICT (${verdictPath}): ${String(e)}
`
      );
    }
  }
  if (decisions === void 0 && artifactsJsonPath) {
    try {
      const rawArtifacts = fs18.readFileSync(artifactsJsonPath, "utf8");
      const artifacts = JSON.parse(rawArtifacts);
      if (!artifacts.runId) artifacts.runId = runId;
      if (!artifacts.phase) artifacts.phase = phase ?? void 0;
      if (!artifacts.evidenceRef) artifacts.evidenceRef = evidenceRef !== "none" ? evidenceRef : void 0;
      const verdict = classifyPhase(artifacts);
      decisions = verdict;
      process.stderr.write(
        `[emit-learning-checkpoint] INFO: classified artifacts \u2192 non-none: ${Object.entries(verdict).filter(([, v]) => v !== "none").map(([k]) => k).join(", ") || "none"}
`
      );
    } catch (e) {
      process.stderr.write(
        `[emit-learning-checkpoint] WARN: could not classify GUILD_CHECKPOINT_ARTIFACTS_JSON (${artifactsJsonPath}): ${String(e)}
`
      );
    }
  }
  let knowledgeLinksBatch = [];
  if (linksPath) {
    try {
      const raw = fs18.readFileSync(linksPath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        knowledgeLinksBatch = parsed;
      } else {
        process.stderr.write(
          `[emit-learning-checkpoint] WARN: GUILD_CHECKPOINT_LINKS JSON is not an array \u2014 ignoring (${linksPath})
`
        );
      }
    } catch (e) {
      process.stderr.write(
        `[emit-learning-checkpoint] WARN: could not read GUILD_CHECKPOINT_LINKS (${linksPath}): ${String(e)}
`
      );
    }
  }
  try {
    const written = writeCheckpoint({
      runId,
      phase,
      evidenceRef,
      guildRoot,
      decisions,
      knowledgeLinksBatch
      // populated from GUILD_CHECKPOINT_LINKS (was deferred [] in Wave 1)
    });
    process.stdout.write(written + "\n");
  } catch (e) {
    process.stderr.write(`[emit-learning-checkpoint] ERROR: ${String(e)}
`);
    process.exit(1);
  }
}
if (process.argv[1] !== void 0 && (process.argv[1].endsWith("emit-learning-checkpoint.ts") || process.argv[1].endsWith("emit-learning-checkpoint.js"))) {
  main();
}

// lib/heartbeat.ts
var DEFAULT_HEARTBEAT_TIMEOUT_MS2 = 10 * 60 * 1e3;

// lib/run-trace.ts
function resolveRunIdForTrace(_root, env) {
  const fromEnv = env.GUILD_RUN_ID;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  return null;
}

// ../scripts/lib/artifact-bus.ts
var fs19 = __toESM(require("fs"));
var path23 = __toESM(require("path"));
var import_crypto = require("crypto");
var yaml2 = __toESM(require_js_yaml());
var BUS_EVENT_SCHEMA = "guild.bus_event.v1";
var BUS_SUBSCRIBER_SCHEMA = "guild.bus_subscriber.v1";
var TOPIC_TYPES = Object.freeze([
  "handoff",
  "status",
  "context",
  "review",
  "approval",
  "heartbeat"
]);
var BUS_EVENT_KINDS = Object.freeze([
  "artifact.published",
  "artifact.streaming",
  "artifact.closed",
  "artifact.retracted"
]);
function busDir(runDir2) {
  return path23.join(runDir2, "bus");
}
function busLogPath(runDir2) {
  return path23.join(busDir(runDir2), "log.jsonl");
}
function sha256(content) {
  return (0, import_crypto.createHash)("sha256").update(content).digest("hex");
}
function isValidTopic(topic) {
  const parts = topic.split("/");
  if (parts.length < 3) return false;
  if (!TOPIC_TYPES.includes(parts[0])) return false;
  return parts.every((p) => p.length > 0);
}
function matchTopic(pattern, topic) {
  const pp = pattern.split("/");
  const tp = topic.split("/");
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === "**") return i === pp.length - 1;
    if (i >= tp.length) return false;
    if (pp[i] === "*") continue;
    if (pp[i] !== tp[i]) return false;
  }
  return pp.length === tp.length;
}
function isPublisher(v) {
  return !!v && typeof v === "object" && typeof v.host_id === "string" && typeof v.role === "string";
}
function validateBusEventV1(obj) {
  if (!obj || typeof obj !== "object") return null;
  const o = obj;
  if (o.schema_version !== BUS_EVENT_SCHEMA) return null;
  if (typeof o.seq !== "number" || !Number.isInteger(o.seq) || o.seq < 0) return null;
  if (typeof o.topic !== "string" || !isValidTopic(o.topic)) return null;
  if (!BUS_EVENT_KINDS.includes(o.event)) return null;
  if (typeof o.artifact_id !== "string" || o.artifact_id.length === 0) return null;
  if (!(o.sha256 === null || typeof o.sha256 === "string")) return null;
  if (!(o.path === null || typeof o.path === "string")) return null;
  if (!(o.byte_offset === null || typeof o.byte_offset === "number")) return null;
  if (!isPublisher(o.publisher)) return null;
  if (typeof o.ts !== "string" || o.ts.length === 0) return null;
  return {
    schema_version: BUS_EVENT_SCHEMA,
    seq: o.seq,
    topic: o.topic,
    event: o.event,
    artifact_id: o.artifact_id,
    sha256: o.sha256 ?? null,
    path: o.path ?? null,
    byte_offset: o.byte_offset ?? null,
    publisher: o.publisher,
    ts: o.ts
  };
}
function validateBusSubscriberV1(obj) {
  if (!obj || typeof obj !== "object") return null;
  const o = obj;
  if (o.schema_version !== BUS_SUBSCRIBER_SCHEMA) return null;
  if (typeof o.subscriber_id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(o.subscriber_id)) return null;
  if (typeof o.host_id !== "string" || o.host_id.length === 0) return null;
  if (!Array.isArray(o.topics) || o.topics.length === 0 || !o.topics.every((t) => typeof t === "string" && t.length > 0)) {
    return null;
  }
  if (!["hook", "poll", "webhook-url"].includes(o.callback)) return null;
  if (typeof o.created_at !== "string" || o.created_at.length === 0) return null;
  return {
    schema_version: BUS_SUBSCRIBER_SCHEMA,
    subscriber_id: o.subscriber_id,
    host_id: o.host_id,
    topics: o.topics,
    callback: o.callback,
    created_at: o.created_at
  };
}
function atomicWrite2(target, data) {
  fs19.mkdirSync(path23.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${sha256(target + data).slice(0, 8)}`;
  fs19.writeFileSync(tmp, data);
  fs19.renameSync(tmp, target);
}
var BusLockTimeout = class extends Error {
  constructor(runDir2) {
    super(`artifact-bus: could not acquire ${path23.join(busDir(runDir2), ".lock")} within timeout`);
    this.name = "BusLockTimeout";
  }
};
function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
  }
}
function withLock(runDir2, fn) {
  const lock = path23.join(busDir(runDir2), ".lock");
  fs19.mkdirSync(busDir(runDir2), { recursive: true });
  const deadline = Date.now() + 5e3;
  let fd = null;
  for (; ; ) {
    try {
      fd = fs19.openSync(lock, "wx");
      fs19.writeSync(fd, String(process.pid));
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (Date.now() > deadline) throw new BusLockTimeout(runDir2);
      sleepMs(2);
    }
  }
  try {
    return fn();
  } finally {
    try {
      if (fd !== null) fs19.closeSync(fd);
      fs19.unlinkSync(lock);
    } catch {
    }
  }
}
function readBusLog(runDir2) {
  let raw;
  try {
    raw = fs19.readFileSync(busLogPath(runDir2), "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = validateBusEventV1(JSON.parse(line));
      if (ev) out.push(ev);
    } catch {
    }
  }
  return out;
}
function readSubscribers(runDir2) {
  const dir = path23.join(busDir(runDir2), "subscribers");
  let entries;
  try {
    entries = fs19.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith(".yaml")) continue;
    try {
      const sub = validateBusSubscriberV1(yaml2.load(fs19.readFileSync(path23.join(dir, name), "utf8")));
      if (sub) out.push(sub);
    } catch {
    }
  }
  return out;
}
function fanout(runDir2, event) {
  const matched = readSubscribers(runDir2).filter(
    (s) => s.topics.some((pat) => matchTopic(pat, event.topic))
  );
  return {
    hook: matched.filter((s) => s.callback === "hook"),
    poll: matched.filter((s) => s.callback === "poll"),
    webhook: matched.filter((s) => s.callback === "webhook-url")
  };
}
var FANOUT_CURSOR = ".fanout-cursor";
var FANOUT_LOG = "fanout.jsonl";
function processFanout(runDir2, now) {
  if (!fs19.existsSync(busLogPath(runDir2))) return { processed: 0, delivered: 0, deferred: 0 };
  try {
    return withLock(runDir2, () => {
      const cursorPath = path23.join(busDir(runDir2), FANOUT_CURSOR);
      let cursor = -1;
      try {
        cursor = Number(fs19.readFileSync(cursorPath, "utf8").trim());
        if (!Number.isFinite(cursor)) cursor = -1;
      } catch {
      }
      const fresh = readBusLog(runDir2).filter((e) => e.seq > cursor);
      let delivered = 0;
      let deferred = 0;
      let maxSeq = cursor;
      const lines = [];
      for (const ev of fresh) {
        maxSeq = Math.max(maxSeq, ev.seq);
        const out = fanout(runDir2, ev);
        for (const s of out.hook) {
          lines.push(JSON.stringify({ seq: ev.seq, topic: ev.topic, subscriber_id: s.subscriber_id, callback: "hook", status: "delivered", ts: now() }));
          delivered += 1;
        }
        for (const s of out.webhook) {
          lines.push(JSON.stringify({ seq: ev.seq, topic: ev.topic, subscriber_id: s.subscriber_id, callback: "webhook-url", status: "deferred", ts: now() }));
          deferred += 1;
        }
      }
      if (lines.length > 0) fs19.appendFileSync(path23.join(busDir(runDir2), FANOUT_LOG), lines.join("\n") + "\n");
      if (maxSeq > cursor) atomicWrite2(cursorPath, String(maxSeq));
      return { processed: fresh.length, delivered, deferred };
    });
  } catch (err) {
    if (err instanceof BusLockTimeout) return { processed: 0, delivered: 0, deferred: 0 };
    throw err;
  }
}

// lib/context-compliance.ts
var fs20 = __toESM(require("node:fs"));
var path24 = __toESM(require("node:path"));

// lib/v1.4/log-jsonl.ts
init_event_log();

// lib/context-compliance.ts
var CONTEXT_COMPLIANCE_SCHEMA = "guild.context_compliance.v1";
function bundleRelPath(runId, specialist, taskId) {
  return path24.join(".guild", "context", runId, `${specialist}-${taskId}.md`);
}
function bundleAbsPath(guildRoot, runId, specialist, taskId) {
  return path24.join(guildRoot, bundleRelPath(runId, specialist, taskId));
}
function dispatchTraceAbsPath(runDir2) {
  return path24.join(runDir2, "dispatch-trace.md");
}
var FILE_TOKEN_RE = /\b[\w@~+./-]*[\w@~+-]\.[A-Za-z][A-Za-z0-9]{0,8}\b/;
function laneTokens(specialist, taskId) {
  const tokens = /* @__PURE__ */ new Set();
  const t = taskId.trim().toLowerCase();
  const s = specialist.trim().toLowerCase();
  if (t) tokens.add(t);
  if (s && t) tokens.add(`${s}-${t}`);
  return Array.from(tokens);
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function traceLineMentionsLane(line, specialist, taskId) {
  const hay = line.toLowerCase();
  return laneTokens(specialist, taskId).some(
    (tok) => new RegExp(`(^|[^\\w-])${escapeRegExp(tok)}([^\\w-]|$)`).test(hay)
  );
}
function hasInlineTraceEntry(content, specialist, taskId) {
  if (!content) return false;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!traceLineMentionsLane(lines[i], specialist, taskId)) continue;
    let block = lines[i];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === "") break;
      if (/^#{1,6}\s/.test(l)) break;
      block += "\n" + l;
    }
    if (FILE_TOKEN_RE.test(block)) return true;
  }
  return false;
}
function classifyContextMode(opts) {
  const tracePresent = opts.traceContent !== null;
  if (opts.bundleExists) {
    return {
      context_mode: "assemble",
      bundle_present: true,
      trace_present: tracePresent,
      trace_entry_found: false,
      bundle_path: "",
      reason: "context-assemble bundle present",
      gap: false
    };
  }
  const entryFound = tracePresent && hasInlineTraceEntry(opts.traceContent, opts.specialist, opts.taskId);
  if (entryFound) {
    return {
      context_mode: "inline",
      bundle_present: false,
      trace_present: true,
      trace_entry_found: true,
      bundle_path: "",
      reason: "no context-assemble bundle, but a dispatch-trace.md entry names this lane with a file-listed working set",
      gap: false
    };
  }
  const reason = !tracePresent ? "no context-assemble bundle and no dispatch-trace.md in the run" : "no context-assemble bundle and no dispatch-trace.md entry names this lane with a file-listed working set";
  return {
    context_mode: "MISSING",
    bundle_present: false,
    trace_present: tracePresent,
    trace_entry_found: false,
    bundle_path: "",
    reason,
    gap: true
  };
}
function evaluateContextCompliance(opts) {
  const { guildRoot, runDir: runDir2, runId, specialist, taskId } = opts;
  let bundleExists = false;
  try {
    const abs = bundleAbsPath(guildRoot, runId, specialist, taskId);
    bundleExists = fs20.existsSync(abs) && fs20.statSync(abs).size > 0;
  } catch {
    bundleExists = false;
  }
  let traceContent = null;
  try {
    const tracePath = dispatchTraceAbsPath(runDir2);
    if (fs20.existsSync(tracePath)) traceContent = fs20.readFileSync(tracePath, "utf8");
  } catch {
    traceContent = null;
  }
  const result = classifyContextMode({ bundleExists, traceContent, specialist, taskId });
  result.bundle_path = bundleRelPath(runId, specialist, taskId);
  return result;
}
function appendComplianceLog(runDir2, runId, specialist, taskId, result) {
  try {
    fs20.mkdirSync(runDir2, { recursive: true });
    const rec = {
      schema_version: CONTEXT_COMPLIANCE_SCHEMA,
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      run_id: runId,
      lane_id: taskId,
      specialist,
      task_id: taskId,
      context_mode: result.context_mode,
      bundle_present: result.bundle_present,
      trace_present: result.trace_present,
      trace_entry_found: result.trace_entry_found,
      bundle_path: result.bundle_path,
      gap: result.gap,
      reason: result.reason
    };
    fs20.appendFileSync(
      path24.join(runDir2, "context-compliance.jsonl"),
      JSON.stringify(rec) + "\n",
      "utf8"
    );
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [context-compliance] compliance-log write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}
function emitContextModeEvent(runDir2, runId, specialist, taskId, result) {
  try {
    if (!isSafeRunId(runId)) return false;
    const laneSafe = isSafeLaneId(taskId);
    appendEvent(runDir2, {
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      event: "hook_event",
      run_id: runId,
      ...laneSafe ? { lane_id: taskId } : {},
      hook_name: "TaskCompleted",
      payload_excerpt_redacted: `context_mode=${result.context_mode} specialist=${specialist} task=${taskId}`,
      latency_ms: 0,
      status: result.context_mode === "MISSING" ? "err" : "ok"
    });
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [context-compliance] v1.4 hook_event emit failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}
function recordContextCompliance(runDir2, runId, specialist, taskId, result) {
  appendComplianceLog(runDir2, runId, specialist, taskId, result);
  emitContextModeEvent(runDir2, runId, specialist, taskId, result);
}

// agent-team/task-completed.ts
var REQUIRED_FIELDS = [
  "changed_files",
  "opens_for",
  "assumptions",
  "evidence",
  "followups"
];
function die(reason) {
  process.stderr.write(`[task-completed] BLOCKED: ${reason}
`);
  process.exit(1);
}
function deriveRunId(sessionId, guildRoot) {
  return resolveRunIdForTrace(guildRoot, { GUILD_RUN_ID: process.env["GUILD_RUN_ID"] }) ?? `run-${sessionId}`;
}
function receiptPath(guildRoot, runId, specialist, taskId) {
  return path25.join(guildRoot, ".guild", "runs", runId, "handoffs", `${specialist}-${taskId}.md`);
}
function learningsPath(guildRoot, runId, specialist, taskId) {
  return path25.join(guildRoot, ".guild", "runs", runId, "learnings", `${specialist}-${taskId}.json`);
}
function missingFields(content) {
  return REQUIRED_FIELDS.filter((field) => {
    const pattern = new RegExp(`(?:^##?\\s+${field}\\b|^${field}\\s*:)`, "im");
    return !pattern.test(content);
  });
}
function persistLearnings(envelope, outPath, specialist, taskId, runDir2, runId) {
  if (!envelope.learnings || envelope.learnings.length === 0) return;
  const record = {
    schema_version: "guild.learnings.v1",
    task_id: taskId,
    specialist,
    tier: envelope.tier,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    learnings: envelope.learnings
  };
  const content = JSON.stringify(record, null, 2) + "\n";
  const writeResult = scrubbedWrite(outPath, content, {
    surface: "learnings",
    runDir: runDir2,
    runId,
    laneId: specialist
  });
  if (writeResult.written) {
    process.stderr.write(`[task-completed] learnings persisted to ${outPath}
`);
  } else if (writeResult.blocked) {
    process.stderr.write(
      `[task-completed] WARN: learnings write BLOCKED by secret scrub (fail-CLOSED) for specialist "${specialist}" task "${taskId}". Security event emitted.
`
    );
  }
}
function extractDependsOn(text) {
  const matches = text.matchAll(/depends[\s-]on:\s*([^\s,;]+)/gi);
  return Array.from(matches, (m) => m[1].trim());
}
function laneStatusFor(envelopeStatus) {
  if (envelopeStatus === null) return "done";
  return envelopeStatus === "done" ? "done" : "failed";
}
function deriveRunStateInit(runId) {
  const planSlug = process.env["GUILD_PLAN_SLUG"];
  const programId = process.env["GUILD_PROGRAM_ID"];
  const waveRaw = process.env["GUILD_WAVE_INDEX"];
  const waveIndex = waveRaw !== void 0 ? Number.parseInt(waveRaw, 10) : NaN;
  return {
    runId,
    planSlug: planSlug && planSlug.trim() !== "" ? planSlug : void 0,
    programId: programId && programId.trim() !== "" ? programId : null,
    waveIndex: Number.isFinite(waveIndex) ? waveIndex : void 0
  };
}
function persistRunState(runDir2, runId, specialist, taskId, status, tier, dependsOn) {
  try {
    const patch2 = {
      status,
      receipt_ref: path25.join("handoffs", `${specialist}-${taskId}.md`)
    };
    if (tier !== void 0) patch2.tier = tier;
    if (dependsOn.length > 0) patch2.depends_on = dependsOn;
    upsertLane(runDir2, deriveRunStateInit(runId), taskId, patch2);
    process.stderr.write(
      `[task-completed] run-state checkpoint updated: lane "${taskId}" \u2192 ${status} (${runStatePathHint(runDir2)}).
`
    );
  } catch (err) {
    process.stderr.write(
      `[task-completed] WARN: run-state checkpoint write failed (non-fatal, rebuildable cache): ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
function runStatePathHint(runDir2) {
  return path25.join(runDir2, "run-state.json");
}
function scrubHandoffReceipt(rPath, content, guildRoot, runDir2, runId, specialist, taskId) {
  const sec = readSecurityConfig(guildRoot);
  const scrubResult = applySecretsPolicy(content, sec.secrets_policy, { noTruncate: true });
  if (scrubResult.ok) {
    let rewriteOk = false;
    try {
      fs21.writeFileSync(rPath, scrubResult.value, "utf8");
      rewriteOk = true;
    } catch (err) {
      process.stderr.write(
        `[task-completed] WARN: handoff scrub rewrite failed \u2014 raw receipt still at canonical path, falling into fail-CLOSED ladder: ${err instanceof Error ? err.message : String(err)}
`
      );
    }
    if (rewriteOk) {
      return { content: scrubResult.value, blocked: false };
    }
  }
  const quarantinePath = rPath + ".quarantined";
  let quarantineDone = false;
  try {
    fs21.renameSync(rPath, quarantinePath);
    quarantineDone = true;
  } catch (err) {
    process.stderr.write(
      `[task-completed] WARN: handoff quarantine rename failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
  if (!quarantineDone) {
    let canonicalRemoved = false;
    try {
      fs21.writeFileSync(
        rPath,
        "[SCRUB-BLOCKED: handoff receipt removed by Guild HK-06 secret scrub \u2014 original content quarantine failed, raw destroyed at canonical path]\n",
        "utf8"
      );
      canonicalRemoved = true;
    } catch {
      try {
        fs21.unlinkSync(rPath);
        canonicalRemoved = true;
      } catch {
      }
    }
    if (!canonicalRemoved) {
      try {
        const evt = buildSecurityEvent({
          run_id: runId,
          lane_id: specialist,
          event_type: "secret_scrub_blocked",
          decision: "blocked",
          tool: "task-completed/handoff-scrub",
          detail: `CRITICAL: Cannot remove raw handoff receipt "${path25.basename(rPath)}" from canonical path \u2014 quarantine AND overwrite/unlink both failed. Raw secret may persist. Lane blocked. Manual remediation required.`,
          permission_mode: "blocked"
        });
        appendSecurityEvent(runDir2, evt);
      } catch {
      }
      die(
        `CRITICAL HK-06 hard failure \u2014 raw handoff receipt from "${specialist}" (task "${taskId}") cannot be removed from canonical path (quarantine AND overwrite/unlink both failed). Raw secret may persist at ${rPath}. Manual remediation required.`
      );
    }
    process.stderr.write(
      `[task-completed] WARN: HK-06: quarantine rename failed but canonical path overwritten/unlinked for ${path25.basename(rPath)}.
`
    );
  }
  try {
    const evt = buildSecurityEvent({
      run_id: runId,
      lane_id: specialist,
      event_type: "secret_scrub_blocked",
      decision: "blocked",
      tool: "task-completed/handoff-scrub",
      detail: `Secret scrub failed for handoff receipt from "${specialist}" (task: "${taskId}") \u2014 receipt quarantined/removed, lane blocked.`,
      permission_mode: "blocked"
    });
    appendSecurityEvent(runDir2, evt);
  } catch {
  }
  writeScrubApprovalRequest(runDir2, runId, "handoff", rPath, specialist);
  return { content: "", blocked: true };
}
function persistInjectionAudit(runDir2, taskId, specialist, injectionClean) {
  try {
    const logsDir = path25.join(runDir2, "logs");
    fs21.mkdirSync(logsDir, { recursive: true });
    const record = {
      schema_version: "guild.injection_audit.v1",
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      task_id: taskId,
      specialist,
      injection_clean: injectionClean
    };
    fs21.appendFileSync(
      path25.join(logsDir, "injection-audit.jsonl"),
      JSON.stringify(record) + "\n",
      "utf8"
    );
  } catch (err) {
    process.stderr.write(
      `[task-completed] WARN: injection-audit write failed (non-fatal): ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
async function main2() {
  const agentTeamEnabled = process.env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] === "1";
  if (!agentTeamEnabled) {
    process.exit(0);
  }
  const rl = readline.createInterface({ input: process.stdin });
  const lines = [];
  for await (const line of rl) {
    lines.push(line);
  }
  const raw = lines.join("\n").trim();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    die(`Invalid JSON on stdin: ${raw.slice(0, 120)}`);
  }
  const sessionId = payload.session_id ?? "unknown";
  const taskId = payload.task_id ?? "(unknown)";
  const specialist = (payload.teammate_name ?? "").trim() || "unknown";
  const cwd = payload.cwd ?? process.cwd();
  const guildRoot = resolveGuildRoot(cwd);
  const runId = deriveRunId(sessionId, guildRoot);
  const runDir2 = path25.join(guildRoot, ".guild", "runs", runId);
  const rPath = receiptPath(guildRoot, runId, specialist, taskId);
  const writeAuth = authorizeHookWrite(guildRoot, { runId });
  if (writeAuth.ok === false) {
    process.stderr.write(formatBindingRejected("task-completed", writeAuth));
  }
  if (!fs21.existsSync(rPath)) {
    die(
      `Task "${taskId}" (specialist: "${specialist}") has no handoff receipt. Expected at: ${rPath}
Write the receipt with sections: ${REQUIRED_FIELDS.join(", ")} before marking complete.`
    );
  }
  const content = fs21.readFileSync(rPath, "utf8");
  const missing = missingFields(content);
  if (missing.length > 0) {
    die(
      `Task "${taskId}" receipt at "${rPath}" is missing required \xA78.2 fields: [${missing.join(", ")}]. Add the missing sections before marking complete.`
    );
  }
  const rawEnvelope = extractHandoffEnvelope(content);
  let envelopeStatus = null;
  let laneTier;
  if (rawEnvelope !== null) {
    const { valid, errors } = validateHandoffV2(rawEnvelope);
    if (!valid) {
      die(
        `Task "${taskId}" receipt at "${rPath}" contains an invalid guild.handoff.v2 envelope.
Validation errors (SC-7 lint):
` + errors.map((e) => `  - ${e}`).join("\n")
      );
    }
    {
      const { blocked: handoffBlocked } = scrubHandoffReceipt(
        rPath,
        content,
        guildRoot,
        runDir2,
        runId,
        specialist,
        taskId
      );
      if (handoffBlocked) {
        die(
          `Task "${taskId}" handoff receipt from "${specialist}" failed secret scrub (fail-CLOSED) \u2014 receipt quarantined to ${rPath}.quarantined. Security event emitted. Remove secrets from the receipt and re-submit.`
        );
      }
    }
    const envelope = rawEnvelope;
    envelopeStatus = envelope.status;
    laneTier = envelope.tier;
    if (writeAuth.ok) {
      const lPath = learningsPath(guildRoot, runId, specialist, taskId);
      persistLearnings(envelope, lPath, specialist, taskId, runDir2, runId);
    } else {
      process.stderr.write(
        `[task-completed] NOTE: learnings extraction skipped for task "${taskId}" \u2014 binding_rejected (no verified run binding; \xA75 fail-closed).
`
      );
    }
    const rawObj = rawEnvelope;
    const injectionClean = classifyEnvelope(rawObj);
    if (writeAuth.ok) persistInjectionAudit(runDir2, taskId, specialist, injectionClean);
    if (injectionClean === "flagged") {
      if (writeAuth.ok) {
        const secEvt = buildSecurityEvent({
          run_id: runId,
          lane_id: specialist,
          event_type: "injection_attempt_detected",
          decision: "pass",
          // advisory — we record and continue, not deny
          tool: "",
          detail: `Directive language detected in guild.handoff.v2 summary/notes from "${specialist}" (task: "${taskId}")`,
          permission_mode: "advisory"
        });
        appendSecurityEvent(runDir2, secEvt);
      }
      process.stderr.write(
        `[task-completed] SECURITY: injection patterns detected in summary from specialist "${specialist}" (task: "${taskId}"). Recorded in injection-audit.jsonl.
`
      );
    }
    process.stderr.write(
      `[task-completed] OK: task "${taskId}" envelope validated (tier: ${envelope.tier}, status: ${envelope.status}).
`
    );
  } else {
    const disc = isRunInScope(runDir2, taskId);
    if (disc.inscope) {
      die(
        `Task "${taskId}" receipt at "${rPath}" is missing a guild.handoff.v2 envelope.
This run is in-scope for enforcement (run started_at >= policy_effective_date ${POLICY_EFFECTIVE_DATE.toISOString().slice(0, 10)}).
Add a fenced \`\`\`guild.handoff.v2 { ... } \`\`\` JSON block to the receipt before marking complete. A frontmatter-only receipt is not a valid machine receipt (communication-format-policy.md \xA7"Handoff contract", OD-2).`
      );
    } else if (disc.reason === "indeterminate") {
      process.stderr.write(disc.warn + "\n");
      process.stderr.write(
        `[task-completed] NOTE: no guild.handoff.v2 envelope found in receipt for task "${taskId}" \u2014 validation skipped (envelope optional for indeterminate-date runs).
`
      );
    } else {
      process.stderr.write(
        `[task-completed] NOTE: no guild.handoff.v2 envelope found in receipt for task "${taskId}" \u2014 validation skipped (grandfathered legacy receipt, run pre-dates policy_effective_date ${POLICY_EFFECTIVE_DATE.toISOString().slice(0, 10)}).
`
      );
    }
  }
  const laneStatus = laneStatusFor(envelopeStatus);
  const dependsOn = extractDependsOn(`${payload.task_subject ?? ""} ${payload.task_description ?? ""}`);
  persistRunState(runDir2, runId, specialist, taskId, laneStatus, laneTier, dependsOn);
  emitBusEvent(runDir2, {
    run_id: runId,
    event: laneStatus === "done" ? "completed" : "errored",
    lane_id: specialist,
    task_id: taskId,
    team_name: (payload.team_name ?? "").trim() || void 0,
    detail: laneStatus === "done" ? void 0 : `lane status: ${laneStatus}`
  });
  try {
    processFanout(runDir2, () => (/* @__PURE__ */ new Date()).toISOString());
  } catch (err) {
    process.stderr.write(
      `[task-completed] WARN: artifact-bus fan-out failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
  try {
    const compliance = evaluateContextCompliance({
      guildRoot,
      runDir: runDir2,
      runId,
      specialist,
      taskId
    });
    recordContextCompliance(runDir2, runId, specialist, taskId, compliance);
    if (compliance.context_mode === "MISSING") {
      process.stderr.write(
        `[task-completed] \u26A0 CONTEXT-COMPLIANCE VIOLATION: lane "${taskId}" (specialist "${specialist}") completed with NEITHER a context-assemble bundle (${compliance.bundle_path}) NOR an inline dispatch-trace.md entry naming the lane with a file-listed working set. ${compliance.reason}. Recorded context_mode=MISSING in telemetry \u2014 the inline-shortcut audit trail is MANDATORY even under --auto-approve=all (guild:execute-plan \xA7"Audit trail when inlining").
`
      );
    } else {
      process.stderr.write(
        `[task-completed] context-compliance OK: lane "${taskId}" context_mode=${compliance.context_mode}.
`
      );
    }
  } catch (err) {
    process.stderr.write(
      `[task-completed] WARN: context-compliance check failed (non-fatal): ${err instanceof Error ? err.message : String(err)}
`
    );
  }
  process.stderr.write(
    `[task-completed] OK: task "${taskId}" receipt verified at "${rPath}" (handoff_submitted). Termination is acceptance-gated \u2014 a durable guild.handoff_acceptance.v1 authorizes it and the launcher performs the confirmed teardown; this hook does not dismiss the pane.
`
  );
  process.exit(0);
}
main2().catch((err) => {
  process.stderr.write(
    `[task-completed] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(1);
});
