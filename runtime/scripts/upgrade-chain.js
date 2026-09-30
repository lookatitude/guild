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

// src/domains/state/plugin-install-guard.ts
function assertNotUnderPluginInstall(absPath, pluginInstallRoot) {
  const root = pluginInstallRoot ?? process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"] ?? process.env["CODEX_PLUGIN_ROOT"];
  if (!root) return;
  const resolvedRoot = path.resolve(root);
  const rel3 = path.relative(resolvedRoot, path.resolve(absPath));
  if (rel3 === "" || !rel3.startsWith("..") && !path.isAbsolute(rel3)) {
    const underOwnDotGuild = rel3 === ".guild" || rel3.startsWith(`.guild${path.sep}`);
    if (underOwnDotGuild && fs.existsSync(path.join(resolvedRoot, ".git"))) return;
    throw new Error(`project-created Guild artifact would be written under plugin install dir: ${absPath}`);
  }
}
var fs, path;
var init_plugin_install_guard = __esm({
  "src/domains/state/plugin-install-guard.ts"() {
    fs = __toESM(require("node:fs"));
    path = __toESM(require("node:path"));
  }
});

// src/domains/state/atomic-write.ts
function atomicWrite(targetPath, content, pluginInstallRoot) {
  writeThroughTemp(targetPath, content, false, pluginInstallRoot);
}
function writeThroughTemp(targetPath, content, durable, pluginInstallRoot) {
  assertNotUnderPluginInstall(targetPath, pluginInstallRoot);
  const dir = path2.dirname(targetPath);
  fs2.mkdirSync(dir, { recursive: true });
  const unique = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const tmpPath = path2.join(dir, `.${path2.basename(targetPath)}.tmp-${unique}`);
  if (durable) {
    const fd = fs2.openSync(tmpPath, "w");
    try {
      fs2.writeFileSync(fd, content, "utf8");
      fs2.fsyncSync(fd);
    } finally {
      fs2.closeSync(fd);
    }
  } else {
    fs2.writeFileSync(tmpPath, content, "utf8");
  }
  try {
    fs2.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      fs2.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
var fs2, path2, crypto;
var init_atomic_write = __esm({
  "src/domains/state/atomic-write.ts"() {
    fs2 = __toESM(require("fs"));
    path2 = __toESM(require("path"));
    crypto = __toESM(require("crypto"));
    init_plugin_install_guard();
  }
});

// src/domains/kernel/module-manifest.ts
var OWNED_INVENTORY_CATEGORIES;
var init_module_manifest = __esm({
  "src/domains/kernel/module-manifest.ts"() {
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

// src/domains/kernel/plugin-root.ts
function findPluginRoot(fromDir) {
  let dir = path3.resolve(fromDir);
  for (; ; ) {
    if (fs3.existsSync(path3.join(dir, PLUGIN_ROOT_MARKER))) return dir;
    const parent = path3.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
var fs3, path3, PLUGIN_ROOT_MARKER;
var init_plugin_root = __esm({
  "src/domains/kernel/plugin-root.ts"() {
    fs3 = __toESM(require("node:fs"));
    path3 = __toESM(require("node:path"));
    PLUGIN_ROOT_MARKER = path3.join("runtime", "guild-mcp.js");
  }
});

// scripts/node_modules/js-yaml/lib/common.js
var require_common = __commonJS({
  "scripts/node_modules/js-yaml/lib/common.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/exception.js
var require_exception = __commonJS({
  "scripts/node_modules/js-yaml/lib/exception.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/snippet.js
var require_snippet = __commonJS({
  "scripts/node_modules/js-yaml/lib/snippet.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/type.js
var require_type = __commonJS({
  "scripts/node_modules/js-yaml/lib/type.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/schema.js
var require_schema = __commonJS({
  "scripts/node_modules/js-yaml/lib/schema.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/type/str.js
var require_str = __commonJS({
  "scripts/node_modules/js-yaml/lib/type/str.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/type/seq.js
var require_seq = __commonJS({
  "scripts/node_modules/js-yaml/lib/type/seq.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/type/map.js
var require_map = __commonJS({
  "scripts/node_modules/js-yaml/lib/type/map.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/schema/failsafe.js
var require_failsafe = __commonJS({
  "scripts/node_modules/js-yaml/lib/schema/failsafe.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/type/null.js
var require_null = __commonJS({
  "scripts/node_modules/js-yaml/lib/type/null.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/type/bool.js
var require_bool = __commonJS({
  "scripts/node_modules/js-yaml/lib/type/bool.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/type/int.js
var require_int = __commonJS({
  "scripts/node_modules/js-yaml/lib/type/int.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/type/float.js
var require_float = __commonJS({
  "scripts/node_modules/js-yaml/lib/type/float.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/schema/json.js
var require_json = __commonJS({
  "scripts/node_modules/js-yaml/lib/schema/json.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/schema/core.js
var require_core = __commonJS({
  "scripts/node_modules/js-yaml/lib/schema/core.js"(exports2, module2) {
    "use strict";
    module2.exports = require_json();
  }
});

// scripts/node_modules/js-yaml/lib/type/timestamp.js
var require_timestamp = __commonJS({
  "scripts/node_modules/js-yaml/lib/type/timestamp.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/type/merge.js
var require_merge = __commonJS({
  "scripts/node_modules/js-yaml/lib/type/merge.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/type/binary.js
var require_binary = __commonJS({
  "scripts/node_modules/js-yaml/lib/type/binary.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/type/omap.js
var require_omap = __commonJS({
  "scripts/node_modules/js-yaml/lib/type/omap.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/type/pairs.js
var require_pairs = __commonJS({
  "scripts/node_modules/js-yaml/lib/type/pairs.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/type/set.js
var require_set = __commonJS({
  "scripts/node_modules/js-yaml/lib/type/set.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/schema/default.js
var require_default = __commonJS({
  "scripts/node_modules/js-yaml/lib/schema/default.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/lib/loader.js
var require_loader = __commonJS({
  "scripts/node_modules/js-yaml/lib/loader.js"(exports2, module2) {
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
    function restoreState(state, snapshot2) {
      state.position = snapshot2.position;
      state.line = snapshot2.line;
      state.lineStart = snapshot2.lineStart;
      state.lineIndent = snapshot2.lineIndent;
      state.firstTabInLine = snapshot2.firstTabInLine;
      state.tag = snapshot2.tag;
      state.anchor = snapshot2.anchor;
      state.kind = snapshot2.kind;
      state.result = snapshot2.result;
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

// scripts/node_modules/js-yaml/lib/dumper.js
var require_dumper = __commonJS({
  "scripts/node_modules/js-yaml/lib/dumper.js"(exports2, module2) {
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

// scripts/node_modules/js-yaml/index.js
var require_js_yaml = __commonJS({
  "scripts/node_modules/js-yaml/index.js"(exports2, module2) {
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

// src/domains/kernel/yaml-loader.ts
function pluginLocalScriptsRoots() {
  const own = findPluginRoot(__dirname);
  return [
    // The package this code shipped in, whatever the bundle depth (runtime/scripts).
    ...own === null ? [] : [path4.join(own, "scripts")],
    // Source TS layout (src/domains/<id>) and the bundled agent-team hook layout
    // (hooks/agent-team/dist) both sit three levels under plugin/.
    path4.resolve(__dirname, "..", "..", "..", "scripts"),
    // Bundled hook layout (hooks/dist) and src/adapters both sit two levels under.
    path4.resolve(__dirname, "..", "..", "scripts"),
    // src/adapters/model-discovery and any deeper nesting.
    path4.resolve(__dirname, "..", "..", "..", "..", "scripts")
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
  const cwdRoot = path4.resolve(process.cwd(), "scripts");
  tried.push(cwdRoot);
  const api = tryScriptsRoot(cwdRoot);
  if (api) return api;
  throw new Error(
    `Guild needs the js-yaml package and could not resolve it. Fix: npm install --prefix <plugin-root>/scripts (roots tried: ${tried.join(", ")})`
  );
}
var path4;
var init_yaml_loader = __esm({
  "src/domains/kernel/yaml-loader.ts"() {
    path4 = __toESM(require("node:path"));
    init_plugin_root();
  }
});

// src/domains/kernel/identifier-tokenize.ts
var init_identifier_tokenize = __esm({
  "src/domains/kernel/identifier-tokenize.ts"() {
  }
});

// src/domains/kernel/sealed-collections.ts
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
  const walk2 = (node) => {
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
      for (const entry of sealedValues) walk2(entry);
      return;
    }
    Object.freeze(obj);
    for (const key of Reflect.ownKeys(obj)) {
      const descriptor = Object.getOwnPropertyDescriptor(obj, key);
      if (!descriptor || !("value" in descriptor)) continue;
      walk2(descriptor.value);
    }
  };
  walk2(value);
  return value;
}
function frozenList(items, options = {}) {
  return deepFreeze(items.slice(), options);
}
var SEALED_BRAND;
var init_sealed_collections = __esm({
  "src/domains/kernel/sealed-collections.ts"() {
    SEALED_BRAND = /* @__PURE__ */ Symbol.for("guild.sealed_collection.v1");
  }
});

// src/domains/kernel/path-containment.ts
function isRefused(r) {
  return "code" in r;
}
function escapes(rel3) {
  return rel3 === ".." || rel3.startsWith(`..${path5.sep}`) || path5.isAbsolute(rel3);
}
function refuse(code, detail) {
  return Object.freeze({ contained: false, code, detail });
}
function hasParentSegment(p) {
  return p.split(/[\\/]/).includes("..");
}
function lstatOrNull(p) {
  try {
    return fs4.lstatSync(p);
  } catch {
    return null;
  }
}
function isWithin(child, parent) {
  const rel3 = path5.relative(parent, child);
  return rel3 === "" || !escapes(rel3);
}
function checkContained(root, target, options = {}) {
  const policy = options.policy ?? "resolve";
  let realRoot;
  try {
    realRoot = fs4.realpathSync(path5.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }
  if (hasParentSegment(target)) {
    return refuse(
      "parent-traversal",
      `refusing a path spelled with a ".." segment (${target}) \u2014 parent traversal cannot be resolved before symlinks`
    );
  }
  const abs = path5.isAbsolute(target) ? path5.resolve(target) : path5.resolve(realRoot, target);
  let probe = abs;
  let probeStat = null;
  for (; ; ) {
    probeStat = lstatOrNull(probe);
    if (probeStat !== null) break;
    const parent = path5.dirname(probe);
    if (parent === probe) {
      return refuse("no-existing-ancestor", `no existing ancestor of ${abs}`);
    }
    probe = parent;
  }
  if (options.requireRegularFileLeaf && probe === abs && !probeStat.isFile()) {
    const what = probeStat.isSymbolicLink() ? "symlink" : probeStat.isDirectory() ? "directory" : "special file";
    return refuse(
      "leaf-not-regular-file",
      `${abs} exists and is not a regular file (${what}); refusing to write through it`
    );
  }
  let realProbe;
  try {
    realProbe = fs4.realpathSync(probe);
  } catch {
    return refuse(
      "dangling-symlink",
      `${probe} is a symlink that does not resolve; refusing to write through it`
    );
  }
  const rel3 = path5.relative(realRoot, realProbe);
  if (rel3 !== "" && escapes(rel3)) {
    return refuse("outside-root", `${abs} resolves outside the project root (${realProbe})`);
  }
  if (policy === "physical") {
    const parsed = path5.parse(abs);
    let walk2 = parsed.root;
    for (const seg of abs.slice(parsed.root.length).split(path5.sep)) {
      if (seg === "" || seg === ".") continue;
      walk2 = path5.join(walk2, seg);
      const st = lstatOrNull(walk2);
      if (st === null || !st.isSymbolicLink()) continue;
      let segReal;
      try {
        segReal = fs4.realpathSync(walk2);
      } catch {
        return refuse("dangling-symlink", `${walk2} is a symlink that does not resolve`);
      }
      const segRel = path5.relative(realRoot, segReal);
      const strictlyInside = segRel !== "" && !escapes(segRel);
      if (strictlyInside) {
        return refuse("physical-symlink", `refusing \u2014 symlinked path segment: ${walk2}`);
      }
    }
  }
  const tail = path5.relative(probe, abs);
  const realPath = tail === "" ? realProbe : path5.join(realProbe, tail);
  return Object.freeze({ contained: true, realRoot, realPath });
}
function prepareContainedWrite(root, target, options = {}) {
  if (hasParentSegment(target)) {
    return refuse(
      "parent-traversal",
      `refusing a path spelled with a ".." segment (${target}) \u2014 parent traversal cannot be resolved before symlinks`
    );
  }
  let canonRoot;
  try {
    canonRoot = fs4.realpathSync(path5.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }
  const abs = path5.isAbsolute(target) ? path5.resolve(target) : path5.resolve(canonRoot, target);
  const dir = path5.dirname(abs);
  const pre = checkContained(root, dir, { policy: options.policy });
  if (isRefused(pre)) return pre;
  try {
    fs4.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return refuse("mkdir-failed", `could not create ${dir}: ${err?.message ?? "unknown"}`);
  }
  const post = checkContained(root, abs, options);
  if (isRefused(post)) return post;
  let realDir;
  try {
    realDir = fs4.realpathSync(dir);
  } catch {
    return refuse("dangling-symlink", `${dir} stopped resolving between the check and the write`);
  }
  return Object.freeze({
    contained: true,
    realRoot: post.realRoot,
    realPath: post.realPath,
    realDir
  });
}
var fs4, path5, CONTAINMENT_REFUSAL_CODES;
var init_path_containment = __esm({
  "src/domains/kernel/path-containment.ts"() {
    fs4 = __toESM(require("node:fs"));
    path5 = __toESM(require("node:path"));
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

// src/domains/kernel/runtime-tree-guard.ts
var RUNTIME_SUBTREE_SEGMENTS;
var init_runtime_tree_guard = __esm({
  "src/domains/kernel/runtime-tree-guard.ts"() {
    init_path_containment();
    init_sealed_collections();
    RUNTIME_SUBTREE_SEGMENTS = sealSet(
      [
        "skills",
        "agents",
        "commands",
        "hooks",
        ".claude-plugin",
        "dist",
        "src",
        "templates"
      ],
      "RUNTIME_SUBTREE_SEGMENTS"
    );
  }
});

// src/domains/kernel/tier-bus.ts
var BUS_TIERS, LEAD_ROLE_IDS, TIER_BUS_CONTRACT;
var init_tier_bus = __esm({
  "src/domains/kernel/tier-bus.ts"() {
    init_sealed_collections();
    BUS_TIERS = frozenList(["T0", "T1", "T2"]);
    LEAD_ROLE_IDS = frozenList(["team-lead", "lead", "orchestrator"]);
    TIER_BUS_CONTRACT = deepFreeze({
      tiers: BUS_TIERS,
      upward_envelopes: { T2: "guild.handoff.v2", T1: "guild.goal_status.v1" },
      lead_roles: LEAD_ROLE_IDS,
      tier_source: "the attempt record on disk, or the run's minted binding_ref \u2014 never the payload"
    });
  }
});

// src/domains/kernel/canonical-hash.ts
var init_canonical_hash = __esm({
  "src/domains/kernel/canonical-hash.ts"() {
  }
});

// src/domains/kernel/index.ts
var init_kernel = __esm({
  "src/domains/kernel/index.ts"() {
    init_module_manifest();
    init_yaml_loader();
    init_identifier_tokenize();
    init_sealed_collections();
    init_path_containment();
    init_runtime_tree_guard();
    init_tier_bus();
    init_plugin_root();
    init_canonical_hash();
  }
});

// src/domains/state/dependency-graph-schema.ts
var DEPENDENCY_GRAPH_SCHEMA_VERSION, DEPENDENCY_GRAPH_V1_EXAMPLE;
var init_dependency_graph_schema = __esm({
  "src/domains/state/dependency-graph-schema.ts"() {
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

// src/domains/state/storage-roots.ts
function platformStateRoot(platform, env, home) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    return local ? path6.join(local, "Guild", "state") : path6.join(home, "AppData", "Local", "Guild", "state");
  }
  if (platform === "darwin") {
    return path6.join(home, "Library", "Application Support", "Guild", "state");
  }
  const xdg = env.XDG_STATE_HOME;
  return xdg ? path6.join(xdg, GUILD_NAMESPACE) : path6.join(home, ".local", "state", GUILD_NAMESPACE);
}
function platformCacheRoot(platform, env, home) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    return local ? path6.join(local, "Guild", "cache") : path6.join(home, "AppData", "Local", "Guild", "cache");
  }
  if (platform === "darwin") {
    return path6.join(home, "Library", "Caches", "Guild");
  }
  const xdg = env.XDG_CACHE_HOME;
  return xdg ? path6.join(xdg, GUILD_NAMESPACE) : path6.join(home, ".cache", GUILD_NAMESPACE);
}
function guildRootId(activeRoot) {
  const abs = path6.resolve(activeRoot);
  const digest = crypto2.createHash("sha256").update(abs).digest("hex").slice(0, 12);
  const base = path6.basename(abs).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "root";
  return `${base}-${digest}`;
}
function durableGuildDir(activeRoot) {
  return path6.join(activeRoot, ".guild");
}
function resolveStorageRoots(opts) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.homedir ?? os.homedir();
  const tmp = opts.tmpdir ?? os.tmpdir();
  const activeRoot = path6.resolve(opts.activeRoot);
  const override = (key) => {
    const raw = env[OVERRIDE_KEYS[key]];
    return raw && raw.trim() ? path6.resolve(raw.trim()) : null;
  };
  const state = override("state") ?? platformStateRoot(platform, env, home);
  const cache = override("cache") ?? platformCacheRoot(platform, env, home);
  return {
    durable: durableGuildDir(activeRoot),
    state,
    cache,
    worktrees: override("worktrees") ?? path6.join(cache, "worktrees"),
    temp: override("temp") ?? path6.join(tmp, GUILD_NAMESPACE)
  };
}
var crypto2, os, path6, OVERRIDE_KEYS, GUILD_NAMESPACE;
var init_storage_roots = __esm({
  "src/domains/state/storage-roots.ts"() {
    crypto2 = __toESM(require("node:crypto"));
    os = __toESM(require("node:os"));
    path6 = __toESM(require("node:path"));
    OVERRIDE_KEYS = {
      state: "GUILD_STATE_HOME",
      cache: "GUILD_CACHE_HOME",
      worktrees: "GUILD_WORKTREE_HOME",
      temp: "GUILD_TEMP_HOME"
    };
    GUILD_NAMESPACE = "guild";
  }
});

// src/domains/state/dependency-graph-reader.ts
var init_dependency_graph_reader = __esm({
  "src/domains/state/dependency-graph-reader.ts"() {
    init_dependency_graph_schema();
    init_storage_roots();
  }
});

// src/domains/state/frontmatter.ts
function yamlApi() {
  if (loadedYaml === null) loadedYaml = loadYamlApi();
  return loadedYaml;
}
function parseYaml(text, opts = {}) {
  try {
    const yaml3 = yamlApi();
    const value = yaml3.load(text, { schema: opts.schema ?? yaml3.JSON_SCHEMA });
    return value === void 0 ? null : value;
  } catch {
    return null;
  }
}
var loadedYaml;
var init_frontmatter = __esm({
  "src/domains/state/frontmatter.ts"() {
    init_kernel();
    loadedYaml = null;
  }
});

// src/domains/state/guild-root.ts
function resolveGuildRoot(startDir) {
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
  "src/domains/state/guild-root.ts"() {
    fs5 = __toESM(require("node:fs"));
    path7 = __toESM(require("node:path"));
  }
});

// src/domains/state/guild-discovery.ts
function readJson(file) {
  try {
    return JSON.parse(fs6.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function resolveRepoRootPreferGit(startCwd) {
  let current = path8.resolve(startCwd);
  let firstGuildRoot = null;
  for (; ; ) {
    if (fs6.existsSync(path8.join(current, ".git"))) return current;
    const guildDir = path8.join(current, ".guild");
    if (firstGuildRoot === null && fs6.existsSync(guildDir)) {
      try {
        if (fs6.statSync(guildDir).isDirectory()) firstGuildRoot = current;
      } catch {
      }
    }
    const parent = path8.dirname(current);
    if (parent === current) return firstGuildRoot ?? resolveGuildRoot(startCwd);
    current = parent;
  }
}
function readWorkspaceMode(root) {
  const raw = readJson(path8.join(root, ".guild", "settings.json"));
  if (!raw || typeof raw !== "object") return "auto";
  const workspace = raw["workspace"];
  if (!workspace || typeof workspace !== "object") return "auto";
  const mode = workspace["mode"];
  return mode === "on" || mode === "off" || mode === "auto" ? mode : "auto";
}
function readWorkspaceManifest(root) {
  const raw = readJson(path8.join(root, ".guild", "workspace.json"));
  if (!raw || typeof raw !== "object") return null;
  const obj = raw;
  if (obj["schema_version"] !== "guild.workspace.v1") return null;
  return raw;
}
function immediateMarkedChildren(root) {
  let entries = [];
  try {
    entries = fs6.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const children = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const childRoot = path8.join(root, ent.name);
    const hasGit = fs6.existsSync(path8.join(childRoot, ".git"));
    const hasGuild = fs6.existsSync(path8.join(childRoot, ".guild"));
    if (!hasGit && !hasGuild) continue;
    children.push({
      name: ent.name,
      path: ent.name,
      kind: hasGuild ? "sub-guild" : "sub-project",
      has_wiki: fs6.existsSync(path8.join(childRoot, ".guild", "wiki")),
      has_indexes: fs6.existsSync(path8.join(childRoot, ".guild", "indexes"))
    });
  }
  return children;
}
function workspaceEntries(root) {
  const manifest = readWorkspaceManifest(root);
  if (manifest?.is_workspace && Array.isArray(manifest.sub_guilds)) {
    return manifest.sub_guilds.filter((sg) => typeof sg.name === "string" && typeof sg.path === "string");
  }
  return immediateMarkedChildren(root);
}
function isRegisteredChildOfParentWorkspace(root) {
  return findParentWorkspace(root) !== null;
}
function isWorkspaceRoot(root) {
  const mode = readWorkspaceMode(root);
  if (mode === "on") return true;
  if (mode === "off") return false;
  const manifest = readWorkspaceManifest(root);
  if (manifest?.is_workspace === true) return true;
  if (isRegisteredChildOfParentWorkspace(root)) return false;
  return immediateMarkedChildren(root).length > 0;
}
function findParentWorkspace(activeRoot) {
  const parent = path8.dirname(activeRoot);
  if (parent === activeRoot) return null;
  const activeResolved = path8.resolve(activeRoot);
  for (const entry of workspaceEntries(parent)) {
    const childRoot = path8.resolve(parent, entry.path);
    if (childRoot === activeResolved) return { root: parent, entry };
  }
  return null;
}
function canonicalMemory(activeRoot) {
  return {
    wiki: path8.join(activeRoot, ".guild", "wiki"),
    raw: path8.join(activeRoot, ".guild", "raw"),
    indexes: path8.join(activeRoot, ".guild", "indexes"),
    indexSqlite: path8.join(activeRoot, ".guild", "index.sqlite")
  };
}
function discoverGuild(startCwd) {
  const activeRoot = resolveRepoRootPreferGit(startCwd);
  const parentWorkspace = findParentWorkspace(activeRoot);
  const level = isWorkspaceRoot(activeRoot) ? "workspace" : "project";
  return {
    startCwd: path8.resolve(startCwd),
    activeRoot,
    guildDir: path8.join(activeRoot, ".guild"),
    level,
    workspaceRoot: level === "workspace" ? activeRoot : parentWorkspace?.root ?? null,
    registeredName: parentWorkspace?.entry.name ?? null,
    federationDepth: level === "workspace" ? 0 : parentWorkspace ? 1 : 0,
    canonicalMemory: canonicalMemory(activeRoot)
  };
}
var fs6, path8;
var init_guild_discovery = __esm({
  "src/domains/state/guild-discovery.ts"() {
    fs6 = __toESM(require("node:fs"));
    path8 = __toESM(require("node:path"));
    init_guild_root();
  }
});

// src/domains/state/index-migrate.ts
function openDatabase(dbPath) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
function resolveGuildRoot2(cwd) {
  try {
    const raw = (0, import_node_child_process.execFileSync)("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const abs = path9.isAbsolute(raw) ? raw : path9.resolve(cwd, raw);
    const root = path9.dirname(abs);
    if (fs7.existsSync(root)) return root;
  } catch {
  }
  return path9.resolve(cwd);
}
function runMigrations(dbPath) {
  let db;
  let fromVersion = 0;
  try {
    fs7.mkdirSync(path9.dirname(dbPath), { recursive: true });
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
    const guildRoot = resolveGuildRoot2(cwd);
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
var import_node_child_process, fs7, path9, CURRENT_SCHEMA_VERSION, MIGRATIONS;
var init_index_migrate = __esm({
  "src/domains/state/index-migrate.ts"() {
    import_node_child_process = require("node:child_process");
    fs7 = __toESM(require("node:fs"));
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

// src/domains/state/index-cache.ts
var init_index_cache = __esm({
  "src/domains/state/index-cache.ts"() {
    init_index_migrate();
    init_kernel();
    init_storage_roots();
  }
});

// src/domains/state/storage-policy.ts
function isUnderDurable(abs, guildDir) {
  const rel3 = path10.relative(path10.resolve(guildDir), path10.resolve(abs));
  return rel3 === "" || !rel3.startsWith("..") && !path10.isAbsolute(rel3);
}
function assertClassPlacement(storageClass, absPath, guildDir) {
  const under = isUnderDurable(absPath, guildDir);
  if (NON_DURABLE_CLASSES.has(storageClass)) {
    if (!under) return;
    throw new StoragePlacementError(
      storageClass,
      absPath,
      `guild storage: a '${storageClass}' artifact may not resolve beneath .guild/ (${absPath}). Rebuildable state belongs in the cache/state/temp root (KTD15).`
    );
  }
  if (!under) {
    throw new StoragePlacementError(
      storageClass,
      absPath,
      `guild storage: a '${storageClass}' artifact must resolve beneath .guild/ (${absPath}). Truth is never written outside the repo (KTD15).`
    );
  }
}
function assertSafeSegments(segments) {
  for (const raw of segments) {
    if (typeof raw !== "string" || raw.trim() === "") {
      throw new Error("guild storage: empty path segment");
    }
    if (path10.isAbsolute(raw) || /^[A-Za-z]:/.test(raw) || raw.startsWith("\\\\")) {
      throw new Error(`guild storage: absolute path segment is refused: ${raw}`);
    }
    if (raw.includes("\0")) {
      throw new Error("guild storage: NUL byte in a path segment");
    }
    for (const part of raw.split(/[\\/]/)) {
      if (part === "..") throw new Error(`guild storage: traversal segment is refused: ${raw}`);
      if (part === ".") throw new Error(`guild storage: dot segment is refused: ${raw}`);
    }
  }
}
var path10, NON_DURABLE_CLASSES, DURABLE_CLASSES, KTD16_FROZEN_PREFIXES, StoragePlacementError, DURABLE_SUBTREES;
var init_storage_policy = __esm({
  "src/domains/state/storage-policy.ts"() {
    path10 = __toESM(require("node:path"));
    init_kernel();
    NON_DURABLE_CLASSES = sealSet(
      ["runtime", "cache", "managed-resource", "temporary"],
      "NON_DURABLE_CLASSES"
    );
    DURABLE_CLASSES = sealSet(
      ["canonical", "durable-record"],
      "DURABLE_CLASSES"
    );
    KTD16_FROZEN_PREFIXES = deepFreeze([
      "runs",
      "analysis",
      "recommendations"
    ]);
    StoragePlacementError = class extends Error {
      constructor(storageClass, resolvedPath, detail) {
        super(detail);
        this.storageClass = storageClass;
        this.resolvedPath = resolvedPath;
        this.name = "StoragePlacementError";
      }
      storageClass;
      resolvedPath;
    };
    DURABLE_SUBTREES = deepFreeze({
      /** Canonical knowledge (KTD35/KTD70). */
      knowledge: "wiki",
      /**
       * The definition tree root is `.guild/` itself: `agents/`, `skills/` and `teams/`
       * already sit there (KTD20).
       */
      definitionsRoot: "",
      /**
       * `definition("sources", id)` — the one logical name that maps elsewhere, onto
       * the durable sources tree that already exists, so R59 does not invent a third home.
       */
      sources: path10.join("knowledge", "sources"),
      initiatives: "initiatives",
      /** KTD16 freeze. */
      runs: "runs",
      artifacts: "artifacts"
    });
  }
});

// src/domains/state/storage-artifact-registry.ts
var STORAGE_ARTIFACT_REGISTRY, BY_ID;
var init_storage_artifact_registry = __esm({
  "src/domains/state/storage-artifact-registry.ts"() {
    init_kernel();
    init_storage_policy();
    STORAGE_ARTIFACT_REGISTRY = deepFreeze([
      // ── canonical: the knowledge a user would mourn ───────────────────────────
      {
        id: "root-identity",
        storageClass: "canonical",
        scope: "project",
        shareable: true,
        rebuildable: false,
        retention: { kind: "permanent" },
        cleanupOwner: "never",
        description: ".guild/guild.yaml \u2014 root identity (workspace or project)."
      },
      {
        id: "project-config",
        storageClass: "canonical",
        scope: "project",
        shareable: true,
        rebuildable: false,
        retention: { kind: "permanent" },
        cleanupOwner: "never",
        description: ".guild/config/{project,workspace}.json \u2014 policy-only durable config; host/model identity is refused here (KTD22)."
      },
      {
        id: "wiki-page",
        storageClass: "canonical",
        scope: "project",
        shareable: true,
        rebuildable: false,
        retention: { kind: "permanent" },
        cleanupOwner: "never",
        description: ".guild/wiki/** \u2014 synthesized knowledge, decisions, standards, glossary."
      },
      {
        id: "definition-agent",
        storageClass: "canonical",
        scope: "project",
        shareable: true,
        rebuildable: false,
        retention: { kind: "permanent" },
        cleanupOwner: "never",
        description: ".guild/agents/*.md \u2014 minted specialist profiles (KTD20); never overwritten by feedstock."
      },
      {
        id: "definition-skill",
        storageClass: "canonical",
        scope: "project",
        shareable: true,
        rebuildable: false,
        retention: { kind: "permanent" },
        cleanupOwner: "never",
        description: ".guild/skills/<name>/SKILL.md \u2014 project-authored skills (KTD20)."
      },
      {
        id: "definition-source",
        storageClass: "durable-record",
        scope: "project",
        shareable: false,
        rebuildable: false,
        retention: { kind: "permanent" },
        cleanupOwner: "never",
        description: 'definition("sources", <id>) \u2014 ingested blobs kept as durable sources (KTD47/R59). Replaces the retired raw sources tree.'
      },
      {
        id: "initiative-record",
        storageClass: "durable-record",
        scope: "project",
        shareable: true,
        rebuildable: false,
        retention: { kind: "until-archive" },
        cleanupOwner: "initiative-archive",
        description: ".guild/initiatives/{active,archived}/** \u2014 durable work records."
      },
      {
        id: "run-record",
        storageClass: "durable-record",
        scope: "project",
        shareable: true,
        rebuildable: false,
        retention: { kind: "until-archive" },
        cleanupOwner: "initiative-archive",
        description: ".guild/runs/<run-id>/** \u2014 the KTD16 frozen run record the benchmark reads (logs/v1.4-events.jsonl)."
      },
      {
        id: "analysis-artifact",
        storageClass: "durable-record",
        scope: "project",
        shareable: true,
        rebuildable: true,
        retention: { kind: "until-archive" },
        cleanupOwner: "initiative-archive",
        description: ".guild/analysis/** and .guild/recommendations/** \u2014 KTD16 producer outputs."
      },
      // ── runtime: needed while something runs, not truth afterwards ────────────
      {
        id: "layout-journal",
        storageClass: "runtime",
        scope: "local",
        shareable: false,
        rebuildable: false,
        retention: { kind: "ttl", ttl_hours: 24 * 30 },
        cleanupOwner: "cache-gc",
        description: "<state>/roots/<root-id>/journal/** \u2014 the layout-upgrade journal, deliberately OUTSIDE .guild (KTD23; T07 writes it)."
      },
      {
        id: "evolve-compact-history",
        storageClass: "runtime",
        scope: "local",
        shareable: false,
        rebuildable: false,
        retention: { kind: "ttl", ttl_hours: 24 * 90 },
        cleanupOwner: "cache-gc",
        description: "<state>/roots/<root-id>/evolve-history/<key>.json \u2014 guild.evolve_history.v1: the inverse span + before/after hash of each applied evolve delta. Replaces the retired per-version snapshot tree (KTD48/R60); NOT run-scoped, because rollback must work in a later session."
      },
      {
        id: "run-lease",
        storageClass: "runtime",
        scope: "local",
        shareable: false,
        rebuildable: false,
        retention: { kind: "run-scoped" },
        cleanupOwner: "run-close",
        description: "<state>/roots/<root-id>/runs/<run-id>/** \u2014 leases and live execution state."
      },
      // ── cache: derived, rebuildable, off the repo ─────────────────────────────
      {
        id: "index-sqlite",
        storageClass: "cache",
        scope: "local",
        shareable: false,
        rebuildable: true,
        retention: { kind: "ttl", ttl_hours: 24 * 30 },
        cleanupOwner: "cache-gc",
        description: "BM25/recall SQLite index \u2014 rebuildable from the wiki (was .guild/index.sqlite)."
      },
      {
        id: "codebase-map",
        storageClass: "cache",
        scope: "local",
        shareable: false,
        rebuildable: true,
        retention: { kind: "ttl", ttl_hours: 24 * 14 },
        cleanupOwner: "cache-gc",
        description: "CodebaseMap cheap-scan output \u2014 rebuildable by learn-map."
      },
      {
        id: "knowledge-graph",
        storageClass: "cache",
        scope: "local",
        shareable: false,
        rebuildable: true,
        retention: { kind: "ttl", ttl_hours: 24 * 30 },
        cleanupOwner: "cache-gc",
        description: "KnowledgeGraph + knowledge-links recall projection \u2014 rebuildable by learn-graph."
      },
      {
        id: "model-catalog",
        storageClass: "cache",
        scope: "local",
        shareable: false,
        rebuildable: true,
        retention: { kind: "ttl", ttl_hours: 24 * 7 },
        cleanupOwner: "cache-gc",
        description: "Provider/model catalog \u2014 refetched on miss; never durable truth (KTD22)."
      },
      // ── managed resources: things with an owner and a reaper ──────────────────
      {
        id: "lane-worktree",
        storageClass: "managed-resource",
        scope: "local",
        shareable: false,
        rebuildable: true,
        retention: { kind: "run-scoped" },
        cleanupOwner: "resource-reaper",
        description: "<worktrees>/<root-id>/<run-id>/<lane-id> \u2014 managed lane worktree; dirty trees are preserved."
      },
      // ── temporary: scratch, deleted on close ──────────────────────────────────
      {
        id: "run-scratch",
        storageClass: "temporary",
        scope: "local",
        shareable: false,
        rebuildable: true,
        retention: { kind: "run-scoped" },
        cleanupOwner: "run-close",
        description: "temporary(<run-id>) \u2014 research/experiment working files (KTD34/R51). Never a durable tree; deleted by closeRun."
      },
      {
        id: "session-scratch",
        storageClass: "temporary",
        scope: "local",
        shareable: false,
        rebuildable: true,
        retention: { kind: "ttl", ttl_hours: 24 },
        cleanupOwner: "scratch-janitor",
        description: "temporary() with no run \u2014 swept by the 24h janitor after a crash or reboot."
      }
    ]);
    BY_ID = new Map(STORAGE_ARTIFACT_REGISTRY.map((p) => [p.id, p]));
  }
});

// src/domains/state/storage-fs.ts
function lstatSafe(p) {
  try {
    return fs8.lstatSync(p);
  } catch {
    return null;
  }
}
function readdirSafe(dir) {
  try {
    return fs8.readdirSync(dir);
  } catch {
    return [];
  }
}
function resolveContainedRealDir(abs, root) {
  const st = lstatSafe(abs);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) return null;
  let real;
  let realRoot;
  try {
    real = fs8.realpathSync(abs);
    realRoot = fs8.realpathSync(root);
  } catch {
    return null;
  }
  const rel3 = path11.relative(realRoot, real);
  if (rel3 === "" || rel3.startsWith("..") || path11.isAbsolute(rel3)) return null;
  return real;
}
function isContainedRealDir(abs, root) {
  return resolveContainedRealDir(abs, root) !== null;
}
function removeContainedTree(abs, root) {
  const real = resolveContainedRealDir(abs, root);
  if (!real) return null;
  fs8.rmSync(real, { recursive: true, force: true });
  return real;
}
function removeContainedEmptyDir(abs, root) {
  const real = resolveContainedRealDir(abs, root);
  if (!real) return false;
  try {
    fs8.rmdirSync(real);
    return true;
  } catch {
    return false;
  }
}
var fs8, path11;
var init_storage_fs = __esm({
  "src/domains/state/storage-fs.ts"() {
    fs8 = __toESM(require("node:fs"));
    path11 = __toESM(require("node:path"));
  }
});

// src/domains/state/storage-layout.ts
function scopedPaths(guildDir, _scope, configFile) {
  const durable = (cls, ...segments) => {
    const parts = segments.filter((s) => s !== "");
    assertSafeSegments(parts);
    const abs = path12.join(guildDir, ...parts);
    assertClassPlacement(cls, abs, guildDir);
    return abs;
  };
  return {
    config: () => durable("canonical", configFile),
    knowledge: (...segments) => durable("canonical", DURABLE_SUBTREES.knowledge, ...segments),
    definitions: (...segments) => {
      assertSafeSegments(segments);
      const parts = segments.flatMap((seg) => seg.split(/[\\/]+/)).filter((p) => p !== "");
      const [head, ...rest] = parts;
      if (head === "sources") return durable("durable-record", DURABLE_SUBTREES.sources, ...rest);
      return durable("canonical", DURABLE_SUBTREES.definitionsRoot, ...parts);
    },
    initiative: (status, id) => durable("durable-record", DURABLE_SUBTREES.initiatives, status, id),
    runRecord: (runId, ...segments) => durable("durable-record", DURABLE_SUBTREES.runs, runId, ...segments),
    artifact: (...segments) => durable("durable-record", DURABLE_SUBTREES.artifacts, ...segments)
  };
}
function detectProfile(cwd, activeRoot) {
  const d = discoverGuild(cwd);
  if (d.level === "workspace") {
    const own = path12.join(activeRoot, ".guild", DURABLE_SUBTREES.knowledge);
    return fs9.existsSync(own) ? "hybrid" : "workspace-only";
  }
  return d.workspaceRoot ? "child" : "standalone";
}
function createGuildStorage(cwd = process.cwd(), opts = {}) {
  const activeRoot = path12.resolve(opts.activeRoot ?? discoverGuild(cwd).activeRoot);
  const roots = resolveStorageRoots({
    activeRoot,
    platform: opts.platform,
    env: opts.env,
    homedir: opts.homedir,
    tmpdir: opts.tmpdir
  });
  const guildDir = roots.durable;
  const rootId = guildRootId(activeRoot);
  const profile = opts.profile ?? detectProfile(cwd, activeRoot);
  const external = (cls, base, ...segments) => {
    assertSafeSegments(segments);
    const abs = path12.join(base, ...segments);
    assertClassPlacement(cls, abs, guildDir);
    return abs;
  };
  const project = profile === "workspace-only" ? void 0 : scopedPaths(guildDir, "project", POLICY_CONFIG_FILES.project);
  const workspace = profile === "workspace-only" || profile === "hybrid" ? scopedPaths(guildDir, "workspace", POLICY_CONFIG_FILES.workspace) : void 0;
  const activeScope = project ?? workspace;
  const runtimeBase = path12.join(roots.state, "roots", rootId);
  const cacheBase = path12.join(roots.cache, "roots", rootId);
  const tempBase = path12.join(roots.temp, rootId);
  const storage = {
    activeRoot,
    rootId,
    profile,
    root: roots,
    project,
    workspace,
    definition: (...segments) => activeScope.definitions(...segments),
    runtime: (...segments) => external("runtime", runtimeBase, ...segments),
    cache: (...segments) => external("cache", cacheBase, ...segments),
    worktree: (runId, laneId) => {
      assertSafeSegments([runId, laneId]);
      return external("managed-resource", roots.worktrees, rootId, runId, laneId);
    },
    temporary: (runId, ...segments) => {
      if (runId === void 0) return external("temporary", tempBase, "session", ...segments);
      assertSafeSegments([runId]);
      return external("temporary", tempBase, "runs", runId, ...segments);
    },
    ensureDir(absPath) {
      fs9.mkdirSync(absPath, { recursive: true });
      return absPath;
    },
    closeRun(runId) {
      assertSafeSegments([runId]);
      const removed = [];
      const preserved = [];
      for (const [dir, owningRoot] of [
        [storage.temporary(runId), tempBase],
        [external("runtime", runtimeBase, "runs", runId), runtimeBase]
      ]) {
        const gone = removeContainedTree(dir, owningRoot);
        if (gone) removed.push(dir);
      }
      const worktreeRoot = path12.join(roots.worktrees, rootId);
      const runWorktrees = path12.join(worktreeRoot, runId);
      if (isContainedRealDir(runWorktrees, worktreeRoot)) {
        for (const lane of readdirSafe(runWorktrees)) {
          const laneDir = path12.join(runWorktrees, lane);
          if (!isContainedRealDir(laneDir, runWorktrees)) {
            preserved.push({ path: laneDir, reason: "not a real directory Guild owns (symlink or special file)" });
            continue;
          }
          if (readdirSafe(laneDir).length > 0) {
            preserved.push({
              path: laneDir,
              reason: "non-empty managed worktree \u2014 reclaimed by the resource reaper, never by close"
            });
            continue;
          }
          if (removeContainedEmptyDir(laneDir, runWorktrees)) removed.push(laneDir);
          else preserved.push({ path: laneDir, reason: "became non-empty during close" });
        }
        removeContainedEmptyDir(runWorktrees, worktreeRoot);
      }
      return { runId, removed, preserved };
    }
  };
  return storage;
}
var fs9, path12, POLICY_CONFIG_FILES;
var init_storage_layout = __esm({
  "src/domains/state/storage-layout.ts"() {
    fs9 = __toESM(require("node:fs"));
    path12 = __toESM(require("node:path"));
    init_guild_discovery();
    init_storage_fs();
    init_storage_policy();
    init_storage_roots();
    POLICY_CONFIG_FILES = Object.freeze({
      project: "config/project.json",
      workspace: "config/workspace.json"
    });
  }
});

// src/domains/state/storage-janitor.ts
var init_storage_janitor = __esm({
  "src/domains/state/storage-janitor.ts"() {
    init_storage_layout();
    init_storage_fs();
  }
});

// src/domains/state/upgrade-glossary.ts
var GLOSSARY_FEEDSTOCK;
var init_upgrade_glossary = __esm({
  "src/domains/state/upgrade-glossary.ts"() {
    GLOSSARY_FEEDSTOCK = `---
schema_version: guild.glossary.v1
title: Glossary
description: Guild operating terms. Add this project's own terms below; Guild never overwrites this file.
---

# Glossary

Terms the Guild machinery uses. The context-manager attaches matching entries to a
specialist bundle on demand \u2014 this file is never loaded whole into the always-on
prefix (KTD70).

## Guild terms

- **root** \u2014 a directory with a \`.guild/\` tree. Guild has exactly two levels: an
  umbrella workspace root and its immediate project roots.
- **durable** \u2014 content under \`.guild/\` that you would lose by deleting it. Caches,
  scratch and runtime state are NOT durable and live off the repo.
- **run** \u2014 one lifecycle execution, recorded under \`.guild/runs/<run-id>/\`.
- **lane** \u2014 one specialist's slice of a plan, dispatched as its own task cell.
- **handoff** \u2014 the compact envelope a specialist returns. The parent reads the
  envelope, never the specialist's transcript.
- **tier** \u2014 \`cheap\` | \`mid\` | \`powerful\`. A selector, never a model name; the
  host adapter maps a tier to a model at dispatch.
- **session binding** \u2014 the host and models resolved for ONE run. Session state,
  never durable config.
- **harvest** \u2014 the automatic capture of a decision into this root's wiki. The
  only unattended writer there is; everything else goes through a human.
- **class** \u2014 which of the five graphs a run follows: \`product\`, \`research\`,
  \`debug\`, \`ops\`, \`init\`. Bound once at intake, by a typed verb, or by
  \`--class=\`.
- **cursor** \u2014 where a run currently sits on its class graph. Read on crash resume.
- **working set** \u2014 the small card a phase reads first: pinned decision ids, open
  questions, and a fingerprint that says whether any of it can have changed.
- **lane bundle** \u2014 the \u22641200-token citation list a parent sees. Parents get
  citations; only the specialist reads the sources.
- **recall** \u2014 looking something up before doing it. Cheap and mandatory; research
  is what happens when recall misses.
- **redirect** \u2014 an operator correction that made the orchestrator change course.
  Three on the same agent and topic in one run fire a harvest.
- **layout version** \u2014 the integer in \`.guild/storage-layout.json\` saying which
  storage layout this root is on. Guild upgrades a root on activation.

## Project terms

Add yours here. This file is yours once it exists.
`;
  }
});

// src/domains/state/upgrade-journal.ts
function upgradeJournalPath(runtime) {
  return runtime("journal", "upgrade", "layout.json");
}
function upgradeLockPath(runtime) {
  return runtime("journal", "upgrade", "layout.lock");
}
function ensureParent(file) {
  fs10.mkdirSync(path13.dirname(file), { recursive: true });
}
function loadJournal(file) {
  let text;
  try {
    text = fs10.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed?.schema_version !== UPGRADE_JOURNAL_SCHEMA) return null;
    if (!Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}
function saveJournal(file, journal) {
  ensureParent(file);
  const tmp = `${file}.tmp-${process.pid}`;
  fs10.writeFileSync(tmp, `${JSON.stringify(journal, null, 2)}
`, "utf8");
  fs10.renameSync(tmp, file);
}
function newJournal(opts) {
  return {
    schema_version: UPGRADE_JOURNAL_SCHEMA,
    root_id: opts.rootId,
    root: opts.root,
    from_version: opts.fromVersion,
    to_version: opts.toVersion,
    state: "planned",
    started_at: opts.now,
    updated_at: opts.now,
    dirty_paths: [],
    entries: []
  };
}
function settledSteps(journal) {
  const out = /* @__PURE__ */ new Set();
  for (const e of journal.entries) {
    if (e.status === "completed" || e.status === "skipped") out.add(e.step_id);
  }
  return out;
}
function recordStep(journal, entry) {
  const entries = journal.entries.filter((e) => e.step_id !== entry.step_id);
  entries.push(entry);
  return { ...journal, entries, updated_at: entry.at };
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function acquireLock(file, nowMs) {
  ensureParent(file);
  const payload = `${JSON.stringify({ pid: process.pid, at: nowMs })}
`;
  const claim = () => {
    try {
      fs10.writeFileSync(file, payload, { encoding: "utf8", flag: "wx" });
      return {
        path: file,
        release: () => {
          try {
            const held2 = JSON.parse(fs10.readFileSync(file, "utf8"));
            if (held2.pid === process.pid) fs10.rmSync(file, { force: true });
          } catch {
          }
        }
      };
    } catch {
      return null;
    }
  };
  const first = claim();
  if (first) return first;
  let held;
  try {
    held = JSON.parse(fs10.readFileSync(file, "utf8"));
  } catch {
    held = {};
  }
  const stale = typeof held.pid !== "number" || !pidAlive(held.pid) || typeof held.at !== "number" || nowMs - held.at > LOCK_STALE_MS;
  if (!stale) return null;
  fs10.rmSync(file, { force: true });
  return claim();
}
var fs10, path13, UPGRADE_JOURNAL_SCHEMA, LOCK_STALE_MS;
var init_upgrade_journal = __esm({
  "src/domains/state/upgrade-journal.ts"() {
    fs10 = __toESM(require("node:fs"));
    path13 = __toESM(require("node:path"));
    UPGRADE_JOURNAL_SCHEMA = "guild.upgrade_journal.v1";
    LOCK_STALE_MS = 15 * 60 * 1e3;
  }
});

// src/domains/state/upgrade-steps.ts
function classifyPath(relToGuild) {
  const rel3 = relToGuild.split(path14.sep).join("/");
  return DERIVED_PATTERNS.some((re) => re.test(rel3)) ? "derived" : "durable";
}
function rel(ctx, abs) {
  return path14.relative(ctx.root, abs).split(path14.sep).join("/");
}
function knowledgeDir(ctx, ...segments) {
  const scope = ctx.storage.project ?? ctx.storage.workspace;
  if (!scope) throw new Error("root owns no durable scope: cannot name the knowledge tree");
  return scope.knowledge(...segments);
}
function readIfFile(abs) {
  const st = lstatSafe(abs);
  if (!st || !st.isFile()) return null;
  try {
    return fs11.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}
function writeFile(ctx, abs, text) {
  if (ctx.dryRun) return;
  fs11.mkdirSync(path14.dirname(abs), { recursive: true });
  fs11.writeFileSync(abs, text, "utf8");
}
function sha256(text) {
  return crypto3.createHash("sha256").update(text).digest("hex");
}
function filesUnder(dir, out = []) {
  for (const name of readdirSafe(dir)) {
    const abs = path14.join(dir, name);
    const st = lstatSafe(abs);
    if (!st) continue;
    if (st.isDirectory()) filesUnder(abs, out);
    else if (st.isFile()) out.push(abs);
  }
  return out;
}
function setByPath(target, dotted, value) {
  const parts = dotted.split(".");
  let node = target;
  for (const seg of parts.slice(0, -1)) {
    const next = node[seg];
    if (typeof next !== "object" || next === null || Array.isArray(next)) node[seg] = {};
    node = node[seg];
  }
  node[parts[parts.length - 1]] = value;
}
function getByPath(source, dotted) {
  let node = source;
  for (const seg of dotted.split(".")) {
    if (typeof node !== "object" || node === null) return void 0;
    node = node[seg];
  }
  return node;
}
function flatten(value, prefix = "", out = {}) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    if (prefix) out[prefix] = value;
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}
function isPlainScalar(v) {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}
function isIdentityEntry(key, raw, parsed, cfg) {
  const isDate = parsed instanceof Date || raw !== void 0 && TIMESTAMP_RE.test(raw);
  const text = raw !== void 0 ? raw : isPlainScalar(parsed) ? String(parsed) : void 0;
  const scalar = raw !== void 0 ? raw !== "" : isPlainScalar(parsed) && String(parsed) !== "";
  if (!scalar) return false;
  if (text !== void 0 && text.includes("\n")) return false;
  if (PINNED_KEYS.test(key)) return true;
  if (isDate || text === void 0) return cfg.findHostIdentity(key, "") !== null;
  return cfg.findHostIdentity(key, text) !== null;
}
function expectedAfterStrip(node, cfg) {
  if (Array.isArray(node)) {
    const out2 = [];
    for (const item of node) {
      const wasNonEmptyMapping = isPlainObject(item) && Object.keys(item).length > 0;
      const next = expectedAfterStrip(item, cfg);
      if (wasNonEmptyMapping && isPlainObject(next) && Object.keys(next).length === 0) continue;
      out2.push(next);
    }
    return out2;
  }
  if (!isPlainObject(node)) return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (isIdentityEntry(key, void 0, value, cfg)) continue;
    out[key] = expectedAfterStrip(value, cfg);
  }
  return out;
}
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}
function sameData(a, b) {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameData(item, b[i]));
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k) => kb.includes(k) && sameData(a[k], b[k])
    );
  }
  return a === b;
}
function splitInlineValue(rawValue) {
  if (rawValue.trimStart().startsWith("#")) return { value: "", comment: rawValue.trim() };
  const quote = /^["']/.exec(rawValue.trimStart());
  if (quote) {
    const text = rawValue.trimStart();
    const q = text[0];
    let i = 1;
    while (i < text.length) {
      if (q === '"' && text[i] === "\\") i += 2;
      else if (q === "'" && text[i] === "'" && text[i + 1] === "'") i += 2;
      else if (text[i] === q) break;
      else i += 1;
    }
    const rest = text.slice(i + 1).trim();
    return { value: text.slice(1, i), comment: rest.startsWith("#") ? rest : null };
  }
  const hash = rawValue.search(/[ \t]#/);
  if (hash >= 0) return { value: rawValue.slice(0, hash).trim(), comment: rawValue.slice(hash + 1).trim() };
  return { value: rawValue.trim(), comment: null };
}
function scanLines(lines) {
  const scan = [];
  const protectedLines = /* @__PURE__ */ new Set();
  let pending = null;
  let contentIndent = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const blank = line.trim() === "";
    const indent = line.length - line.trimStart().length;
    if (pending !== null || contentIndent !== null) {
      if (blank) {
        protectedLines.add(i);
        continue;
      }
      if (contentIndent === null) {
        const base = pending.base;
        const resolved = pending.explicit !== null ? base + pending.explicit : indent;
        if (resolved <= base) {
          pending = null;
        } else {
          contentIndent = resolved;
          pending = null;
          if (indent >= contentIndent) {
            protectedLines.add(i);
            continue;
          }
          contentIndent = null;
        }
      } else if (indent >= contentIndent) {
        protectedLines.add(i);
        continue;
      } else {
        contentIndent = null;
      }
    }
    if (blank || /^\s*#/.test(line)) continue;
    const m = MAP_ENTRY.exec(line);
    if (!m) continue;
    const [, pad, dash, dashGap, key, , rawValue] = m;
    const keyCol = pad.length + (dash ? 1 + (dashGap ?? "").length : 0);
    const header = BLOCK_SCALAR.exec(line);
    if (header) {
      pending = { base: keyCol, explicit: header[1] === "" ? null : Number(header[1]) };
      contentIndent = null;
    }
    const split = rawValue === void 0 ? null : splitInlineValue(rawValue);
    scan.push({
      idx: i,
      indent: pad.length,
      dash: dash === "-",
      keyCol,
      key: key.replace(/^["'](.*)["']$/, "$1"),
      value: split === null ? void 0 : split.value,
      comment: split === null ? null : split.comment,
      rawValue: rawValue ?? ""
    });
  }
  return { scan, protectedLines };
}
function commentsIn(text) {
  const lines = text.split("\n");
  const { protectedLines } = scanLines(lines);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (protectedLines.has(i)) continue;
    const line = lines[i];
    if (/^\s*#/.test(line)) {
      out.push(line.trim());
      continue;
    }
    const m = MAP_ENTRY.exec(line);
    if (!m) continue;
    const rawValue = m[6];
    if (rawValue === void 0) continue;
    const { comment } = splitInlineValue(rawValue);
    if (comment !== null) out.push(comment);
  }
  return out.sort();
}
function stripHostIdentityFromYaml(text, cfg, commentsOf = commentsIn) {
  const yaml3 = loadYamlApi();
  let doc;
  try {
    doc = yaml3.load(text);
  } catch (e) {
    return { next: text, removed: [], parseError: e.message };
  }
  if (doc === null || doc === void 0 || typeof doc !== "object") {
    return { next: text, removed: [] };
  }
  const lines = text.split("\n");
  const { scan, protectedLines } = scanLines(lines);
  const removed = [];
  const deleted = /* @__PURE__ */ new Set();
  const rewritten = /* @__PURE__ */ new Map();
  const promotedItems = /* @__PURE__ */ new Set();
  const keptComments = /* @__PURE__ */ new Map();
  const block = (reason, line) => ({
    next: text,
    removed: [],
    blockReason: reason,
    blockLine: line === void 0 ? void 0 : line + 1
  });
  for (let n = 0; n < scan.length; n += 1) {
    const node = scan[n];
    if (node.key === null || node.value === void 0) continue;
    const flow = /^[[{]/.test(node.rawValue.trim());
    if (flow) {
      const pairs = node.rawValue.matchAll(/([A-Za-z_][\w.-]*)\s*:\s*([^,{}[\]]+)/g);
      for (const [, k, v] of pairs) {
        if (isIdentityEntry(k, v.trim(), void 0, cfg)) {
          return block(`flow-style mapping carries host/model identity (${k}: ${v.trim()})`, node.idx);
        }
      }
      continue;
    }
    if (!isIdentityEntry(node.key, node.value, void 0, cfg)) continue;
    if (/^\t| \t/.test(lines[node.idx]) || lines.some((l, i) => !protectedLines.has(i) && /^\t/.test(l))) {
      return block("tab-indented YAML cannot be edited by line", node.idx);
    }
    if (lines.some((l, i) => i > 0 && !protectedLines.has(i) && /^(---|\.\.\.)\s*$/.test(l))) {
      return block("multi-document YAML", node.idx);
    }
    const anchorAt = lines.findIndex((l, i) => !protectedLines.has(i) && /(^|\s)(<<:|[&*][A-Za-z_])/.test(l));
    if (anchorAt >= 0) return block("anchor or alias in the document", anchorAt);
    removed.push(`${node.key}: ${node.value}`);
    if (node.comment !== null) keptComments.set(node.idx, { indent: node.indent, text: node.comment });
    if (!node.dash) {
      deleted.add(node.idx);
      continue;
    }
    const body = [];
    for (let k = n + 1; k < scan.length; k += 1) {
      if (scan[k].indent <= node.indent) break;
      if (scan[k].indent === node.keyCol) body.push(scan[k].idx);
    }
    if (body.length === 0) {
      deleted.add(node.idx);
      continue;
    }
    const promote = body[0];
    promotedItems.add(node.idx);
    const promoted = lines[promote];
    if (promoted.length - promoted.trimStart().length !== node.keyCol) {
      return block("sequence item continuation is not at the key column", promote);
    }
    const dashGap = " ".repeat(node.keyCol - node.indent - 1);
    deleted.add(node.idx);
    rewritten.set(promote, `${" ".repeat(node.indent)}-${dashGap}${promoted.trimStart()}`);
  }
  if (removed.length === 0) return { next: text, removed: [] };
  for (let n = 0; n < scan.length; n += 1) {
    const parent = scan[n];
    if (parent.key === null || parent.value !== void 0 && parent.value !== "") continue;
    if (deleted.has(parent.idx) || rewritten.has(parent.idx)) continue;
    const direct = [];
    let childIndent = null;
    for (let k = n + 1; k < scan.length; k += 1) {
      const c = scan[k];
      if (c.indent < parent.indent) break;
      if (c.indent === parent.indent && !c.dash) break;
      if (childIndent === null) childIndent = c.indent;
      if (c.indent < childIndent) break;
      if (c.indent === childIndent) direct.push(c);
    }
    if (direct.length === 0) continue;
    if (!direct.every((c) => deleted.has(c.idx) && !promotedItems.has(c.idx))) continue;
    const empty = direct[0].dash ? "[]" : "{}";
    const moved = [];
    for (const child of direct) {
      const kept = keptComments.get(child.idx);
      if (kept === void 0) continue;
      moved.push(`${" ".repeat(parent.indent)}${kept.text}`);
      keptComments.delete(child.idx);
    }
    const parentLine = lines[parent.idx];
    const parentComment = parent.comment;
    const upToComment = parentComment === null ? "" : parentLine.slice(0, parentLine.lastIndexOf(parentComment));
    const head = parentComment === null ? parentLine.replace(/:\s*$/, "") : upToComment.replace(/[:\s]*$/, "");
    const tail = parentComment === null ? "" : `${/(\s*)$/.exec(upToComment)?.[1] ?? " "}${parentComment}`;
    rewritten.set(parent.idx, [...moved, `${head}: ${empty}${tail}`].join("\n"));
  }
  const next = lines.map((line, i) => {
    if (!deleted.has(i)) return rewritten.get(i) ?? line;
    const kept = keptComments.get(i);
    return kept === void 0 ? null : `${" ".repeat(kept.indent)}${kept.text}`;
  }).filter((line) => line !== null).join("\n");
  let after;
  try {
    after = yaml3.load(next);
  } catch (e) {
    return block(`the line edit produced unparseable YAML (${e.message})`);
  }
  if (!sameData(after, expectedAfterStrip(doc, cfg))) {
    return block("the line edit would change data other than the host/model identity");
  }
  const before = commentsOf(text);
  const afterComments = commentsOf(next);
  const pool = [...afterComments];
  const lost = [];
  for (const comment of before) {
    const at = pool.indexOf(comment);
    if (at < 0) lost.push(comment);
    else pool.splice(at, 1);
  }
  if (lost.length > 0) return { next: text, removed: [], lostComments: lost };
  return { next, removed };
}
function terminalRunStatus(runYaml) {
  let doc;
  try {
    doc = loadYamlApi().load(runYaml);
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const value = doc["status"];
  if (typeof value !== "string") return null;
  const status = value.trim().toLowerCase();
  return TERMINAL_STATUSES.includes(status) ? status : null;
}
var crypto3, fs11, path14, KNOWLEDGE_PREFIX, DERIVED_PATTERNS, v1Content, settingsPolicySplit, PINNED_KEYS, TIMESTAMP_RE, BLOCK_SCALAR, MAP_ENTRY, ktd22Strip, CACHE_TARGETS, cachesOut, TERMINAL_STATUSES, closedRunReceipts, currentRunIdRetire, LEGACY_VERSION_TREE, skillVersionsDelete, AUTHORED_REGISTRIES, DERIVED_REGISTRIES, registryYamlRetire, glossaryCreate, UPGRADE_STEPS, UPGRADE_STEP_IDS;
var init_upgrade_steps = __esm({
  "src/domains/state/upgrade-steps.ts"() {
    crypto3 = __toESM(require("node:crypto"));
    fs11 = __toESM(require("node:fs"));
    path14 = __toESM(require("node:path"));
    init_upgrade_glossary();
    init_storage_fs();
    init_storage_policy();
    init_kernel();
    KNOWLEDGE_PREFIX = `.guild/${DURABLE_SUBTREES.knowledge}`;
    DERIVED_PATTERNS = Object.freeze([
      /^indexes(\/|$)/,
      /^index\.sqlite$/,
      /^hosts(\/|$)/,
      /^current-run-id$/,
      /^agents\/registry\.yaml$/,
      /^skills\/registry\.yaml$/,
      /^bus\/\.lock$/,
      /(^|\/)\.tmp-[^/]+$/
    ]);
    v1Content = {
      id: "v1-content",
      cls: "durable",
      source: "proposal \xA721.7",
      affects: [".guild"],
      apply(ctx) {
        if (!ctx.v1) {
          return {
            status: "skipped",
            detail: "no v1 converter provided by this entry point; legacy content left untouched",
            paths: []
          };
        }
        const r = ctx.v1({ root: ctx.root, dryRun: ctx.dryRun });
        const complaints = [r.error, ...r.warnings ?? []].filter((m) => typeof m === "string" && m !== "");
        if (complaints.length > 0 || r.action === "error" || r.action === "corrupt-blocked") {
          return {
            status: "failed",
            detail: `v1 converter reported ${complaints.length || 1} problem(s): ${complaints.join("; ") || r.action}`,
            paths: []
          };
        }
        if (r.classification === "v2" || r.classification === "none" || r.action === "v2-noop" || r.action === "none") {
          return { status: "skipped", detail: `v1 converter: ${r.classification}/${r.action} \u2014 nothing to convert`, paths: [] };
        }
        return {
          status: "completed",
          detail: `v1 converter: ${r.classification}/${r.action}, ${r.changed} artifact(s)`,
          paths: [".guild"]
        };
      }
    };
    settingsPolicySplit = {
      id: "settings-policy-split",
      cls: "durable",
      source: "proposal \xA721.6",
      affects: [".guild/settings.json", ".guild/config"],
      apply(ctx) {
        const legacy = readIfFile(path14.join(ctx.guildDir, "settings.json"));
        if (legacy === null) return { status: "skipped", detail: "no .guild/settings.json to split", paths: [] };
        let parsed;
        try {
          parsed = JSON.parse(legacy);
        } catch {
          return { status: "skipped", detail: ".guild/settings.json is not parseable JSON \u2014 preserved, not split", paths: [] };
        }
        if (!ctx.policy) {
          return { status: "skipped", detail: "no policy classifier injected; settings.json left unsplit", paths: [] };
        }
        const cfg = ctx.policy;
        const flat = flatten(parsed);
        const policy = {};
        let dropped = 0;
        for (const [key, value] of Object.entries(flat)) {
          const canonical = cfg.canonicalPolicyKey(key);
          if (!cfg.isPolicyKey(canonical)) {
            dropped += 1;
            continue;
          }
          if (cfg.findHostIdentity(canonical, value) !== null) {
            dropped += 1;
            continue;
          }
          setByPath(policy, canonical, value);
        }
        const targets = [];
        if (ctx.storage.project) targets.push(ctx.storage.project.config());
        if (ctx.storage.workspace) targets.push(ctx.storage.workspace.config());
        if (targets.length === 0) return { status: "skipped", detail: "root owns no durable config scope", paths: [] };
        const written = [];
        for (const target of targets) {
          const existing = readIfFile(target);
          let base = {};
          if (existing !== null) {
            try {
              const value = JSON.parse(existing);
              if (value === null || typeof value !== "object" || Array.isArray(value)) {
                throw new Error("top level is not a JSON object");
              }
              base = value;
            } catch (e) {
              const where = rel(ctx, target);
              return {
                status: "blocked_confirm",
                detail: `${where} is not parseable JSON (${e.message}) \u2014 left byte-identical, not replaced`,
                paths: [where],
                question: `settings-policy-split cannot read ${where}: ${e.message}. Fix or remove that file, then re-run the upgrade. Replace it with a fresh policy file?`
              };
            }
          }
          let added = 0;
          for (const [key, value] of Object.entries(flatten(policy))) {
            if (getByPath(base, key) !== void 0) continue;
            setByPath(base, key, value);
            added += 1;
          }
          if (added === 0) continue;
          writeFile(ctx, target, `${JSON.stringify(base, null, 2)}
`);
          written.push(rel(ctx, target));
        }
        if (written.length === 0) {
          return { status: "skipped", detail: "policy keys already present in every scoped config file", paths: [] };
        }
        return {
          status: "completed",
          detail: `split ${Object.keys(flatten(policy)).length} policy key(s) into ${written.join(" + ")}` + (dropped > 0 ? `; ${dropped} non-policy/inventory key(s) not transferred (KTD22)` : "") + (written.length === 2 ? "; hybrid root \u2014 the legacy dual-role file was split into both scopes" : ""),
          paths: written
        };
      }
    };
    PINNED_KEYS = /^(host|host_id|host_family|model|model_id|model_name|models)$/;
    TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}([Tt ].*)?$/;
    BLOCK_SCALAR = /:\s*[|>]([0-9]?)[+-]?\s*(#.*)?$/;
    MAP_ENTRY = /^(\s*)(?:(-)(\s+))?("[^"]*"|'[^']*'|[^\s#][^:]*?):(?:(\s+)(.*))?$/;
    ktd22Strip = {
      id: "ktd22-host-identity-strip",
      cls: "durable",
      source: "KTD22 / R38",
      affects: [".guild/initiatives", ".guild/team", ".guild/teams"],
      apply(ctx) {
        if (!ctx.policy) {
          return { status: "skipped", detail: "no policy classifier injected; host/model pins left in place", paths: [] };
        }
        const cfg = ctx.policy;
        const roots = ["initiatives", "team", "teams"].map((d) => path14.join(ctx.guildDir, d));
        const touched = [];
        let removedTotal = 0;
        for (const dir of roots) {
          if (!isContainedRealDir(dir, ctx.guildDir)) continue;
          for (const abs of filesUnder(dir)) {
            if (!/\.ya?ml$/.test(abs)) continue;
            const text = readIfFile(abs);
            if (text === null) continue;
            const { next, removed, parseError, blockReason, blockLine, lostComments } = stripHostIdentityFromYaml(text, cfg);
            if (parseError !== void 0) {
              const where = rel(ctx, abs);
              return {
                status: "blocked_confirm",
                detail: `${where} is not parseable YAML (${parseError}) \u2014 left byte-identical, not rewritten`,
                paths: [where],
                question: `ktd22-host-identity-strip cannot parse ${where}: ${parseError}. Fix that file, then re-run the upgrade. Skip it and continue?`
              };
            }
            if (lostComments !== void 0 && lostComments.length > 0) {
              return {
                status: "failed",
                detail: `${rel(ctx, abs)}: the strip would drop ${lostComments.length} comment(s) (${lostComments.join(" / ")}) \u2014 nothing was written`,
                paths: [rel(ctx, abs)]
              };
            }
            if (blockReason !== void 0) {
              const where = blockLine === void 0 ? rel(ctx, abs) : `${rel(ctx, abs)}:${blockLine}`;
              return {
                status: "blocked_confirm",
                detail: `${where} carries host/model identity this step cannot remove by line (${blockReason}) \u2014 left byte-identical`,
                paths: [rel(ctx, abs)],
                question: `ktd22-host-identity-strip cannot safely edit ${where}: ${blockReason}. Remove the host/model identity there by hand, then re-run the upgrade. Skip it and continue?`
              };
            }
            if (removed.length === 0) continue;
            writeFile(ctx, abs, next);
            touched.push(rel(ctx, abs));
            removedTotal += removed.length;
          }
        }
        if (touched.length === 0) {
          return { status: "skipped", detail: "no host or model identity pinned in durable initiative/team files", paths: [] };
        }
        return {
          status: "completed",
          detail: `stripped ${removedTotal} host/model pin(s) from ${touched.length} durable file(s)`,
          paths: touched
        };
      }
    };
    CACHE_TARGETS = Object.freeze(["indexes", "index.sqlite", "hosts"]);
    cachesOut = {
      id: "caches-out",
      cls: "safe-local",
      source: "proposal \xA721.11",
      affects: [],
      apply(ctx) {
        const removed = [];
        for (const name of CACHE_TARGETS) {
          const abs = path14.join(ctx.guildDir, name);
          const st = lstatSafe(abs);
          if (!st) continue;
          if (classifyPath(name) !== "derived") {
            return {
              status: "blocked_confirm",
              detail: `refusing to remove non-derived path .guild/${name}`,
              paths: [rel(ctx, abs)],
              question: `caches-out wants to delete .guild/${name}, which is not classified derived. Delete it?`
            };
          }
          if (ctx.dryRun) {
            removed.push(rel(ctx, abs));
            continue;
          }
          if (st.isDirectory()) {
            if (removeContainedTree(abs, ctx.guildDir) !== null) removed.push(rel(ctx, abs));
          } else {
            fs11.rmSync(abs, { force: true });
            removed.push(rel(ctx, abs));
          }
        }
        if (removed.length === 0) return { status: "skipped", detail: "no derived cache left under .guild", paths: [] };
        return {
          status: "completed",
          detail: `removed ${removed.length} derived cache path(s); V2 rebuilds them on the platform cache root`,
          paths: removed
        };
      }
    };
    TERMINAL_STATUSES = Object.freeze([
      "closed",
      "complete",
      "completed",
      "done",
      "failed",
      "aborted",
      "cancelled",
      "canceled"
    ]);
    closedRunReceipts = {
      id: "closed-run-receipts",
      cls: "durable",
      source: "proposal \xA721.10",
      affects: [".guild/runs"],
      apply(ctx) {
        const runsDir = path14.join(ctx.guildDir, "runs");
        if (!isContainedRealDir(runsDir, ctx.guildDir)) {
          return { status: "skipped", detail: "no .guild/runs tree", paths: [] };
        }
        const written = [];
        let open = 0;
        for (const name of readdirSafe(runsDir)) {
          if (name.startsWith("_")) continue;
          const runDir = path14.join(runsDir, name);
          if (!isContainedRealDir(runDir, ctx.guildDir)) continue;
          const receipt = path14.join(runDir, "receipt.json");
          if (lstatSafe(receipt)) continue;
          const runYaml = readIfFile(path14.join(runDir, "run.yaml"));
          if (runYaml === null) continue;
          const status = terminalRunStatus(runYaml);
          if (status === null) {
            open += 1;
            continue;
          }
          writeFile(
            ctx,
            receipt,
            `${JSON.stringify(
              {
                schema_version: "guild.run_receipt.v1",
                run_id: name,
                status,
                source: "layout-upgrade",
                generated_at: ctx.now()
              },
              null,
              2
            )}
`
          );
          written.push(rel(ctx, receipt));
        }
        if (written.length === 0) {
          return {
            status: "skipped",
            detail: `every legacy run already has a receipt or is not terminal (${open} left open)`,
            paths: []
          };
        }
        return {
          status: "completed",
          detail: `wrote ${written.length} run receipt(s); ${open} non-terminal run(s) left untouched (never falsely closed)`,
          paths: written
        };
      }
    };
    currentRunIdRetire = {
      id: "current-run-id-retire",
      cls: "safe-local",
      source: "proposal \xA721.10",
      affects: [],
      apply(ctx) {
        const abs = path14.join(ctx.guildDir, "current-run-id");
        const text = readIfFile(abs);
        if (text === null) return { status: "skipped", detail: "no current-run-id sentinel", paths: [] };
        const captured = text.trim();
        if (classifyPath("current-run-id") !== "derived") {
          return {
            status: "blocked_confirm",
            detail: "current-run-id is not classified derived",
            paths: [rel(ctx, abs)],
            question: "current-run-id-retire wants to delete .guild/current-run-id. Delete it?"
          };
        }
        if (!ctx.dryRun) fs11.rmSync(abs, { force: true });
        return {
          status: "completed",
          detail: `captured run binding "${captured}" and retired the singleton sentinel; V2 writers never recreate it`,
          paths: [rel(ctx, abs)]
        };
      }
    };
    LEGACY_VERSION_TREE = "skill-versions";
    skillVersionsDelete = {
      id: "skill-versions-delete",
      cls: "safe-local",
      source: "proposal \xA721.12 / R60",
      affects: [],
      apply(ctx) {
        const dir = path14.join(ctx.guildDir, LEGACY_VERSION_TREE);
        if (!isContainedRealDir(dir, ctx.guildDir)) {
          return { status: "skipped", detail: `no leftover ${LEGACY_VERSION_TREE} tree`, paths: [] };
        }
        const snapshots = filesUnder(dir);
        if (snapshots.length === 0) {
          if (!ctx.dryRun) removeContainedTree(dir, ctx.guildDir);
          return { status: "completed", detail: `removed the empty ${LEGACY_VERSION_TREE} tree`, paths: [rel(ctx, dir)] };
        }
        const live = /* @__PURE__ */ new Set();
        const skillsDir = path14.join(ctx.guildDir, "skills");
        if (isContainedRealDir(skillsDir, ctx.guildDir)) {
          for (const abs of filesUnder(skillsDir)) {
            const text = readIfFile(abs);
            if (text !== null) live.add(sha256(text));
          }
        }
        const unique = snapshots.filter((abs) => {
          const text = readIfFile(abs);
          return text === null || !live.has(sha256(text));
        });
        if (unique.length > 0) {
          return {
            status: "blocked_confirm",
            detail: `${unique.length} legacy snapshot(s) carry content no live skill body has`,
            paths: unique.slice(0, 10).map((abs) => rel(ctx, abs)),
            question: `skill-versions-delete found ${unique.length} snapshot(s) under .guild/${LEGACY_VERSION_TREE}/ whose content is NOT in any live .guild/skills/** body, so they are not derived. Review them and either keep the tree or remove it yourself, then re-run \`config migrate --mode=migrate\`.`
          };
        }
        if (!ctx.dryRun) removeContainedTree(dir, ctx.guildDir);
        return {
          status: "completed",
          detail: `removed ${snapshots.length} redundant snapshot(s); every one matched a live skill body`,
          paths: [rel(ctx, dir)]
        };
      }
    };
    AUTHORED_REGISTRIES = Object.freeze(["loops/registry.yaml", "workflows/registry.yaml"]);
    DERIVED_REGISTRIES = Object.freeze(["agents/registry.yaml", "skills/registry.yaml"]);
    registryYamlRetire = {
      id: "registry-yaml-retire",
      cls: "durable",
      source: "KTD56 / R68",
      affects: [".guild/loops", ".guild/workflows", ".guild/agents/registry.yaml", ".guild/skills/registry.yaml"],
      apply(ctx) {
        const changed = [];
        for (const relPath of DERIVED_REGISTRIES) {
          const abs = path14.join(ctx.guildDir, relPath);
          if (!lstatSafe(abs)) continue;
          if (classifyPath(relPath) !== "derived") continue;
          if (!ctx.dryRun) fs11.rmSync(abs, { force: true });
          changed.push(rel(ctx, abs));
        }
        for (const relPath of AUTHORED_REGISTRIES) {
          const abs = path14.join(ctx.guildDir, relPath);
          const text = readIfFile(abs);
          if (text === null) continue;
          const target = path14.join(ctx.guildDir, "artifacts", "legacy", relPath.replace("/", "-"));
          if (lstatSafe(target)) continue;
          writeFile(ctx, target, text);
          if (!ctx.dryRun) fs11.rmSync(abs, { force: true });
          changed.push(`${rel(ctx, abs)} \u2192 ${rel(ctx, target)}`);
        }
        if (changed.length === 0) {
          return { status: "skipped", detail: "no registry YAML left to retire", paths: [] };
        }
        return {
          status: "completed",
          detail: `retired ${changed.length} registry file(s); authored ones were preserved under artifacts/legacy/, not deleted`,
          paths: changed
        };
      }
    };
    glossaryCreate = {
      id: "glossary-create",
      cls: "durable",
      source: "R80 / KTD70",
      // The KNOWLEDGE TREE, not just the file: a durable step must not write into a
      // tree whose tracked pages are dirty, even when its own target does not exist yet.
      affects: [KNOWLEDGE_PREFIX],
      apply(ctx) {
        const abs = knowledgeDir(ctx, "glossary.md");
        if (lstatSafe(abs)) {
          return {
            status: "skipped",
            detail: "project glossary already exists \u2014 feedstock never replaces it (R80)",
            paths: []
          };
        }
        writeFile(ctx, abs, GLOSSARY_FEEDSTOCK);
        return { status: "completed", detail: "created the root glossary page from plugin feedstock", paths: [rel(ctx, abs)] };
      }
    };
    UPGRADE_STEPS = deepFreeze([
      v1Content,
      settingsPolicySplit,
      ktd22Strip,
      cachesOut,
      closedRunReceipts,
      currentRunIdRetire,
      skillVersionsDelete,
      registryYamlRetire,
      glossaryCreate
    ]);
    UPGRADE_STEP_IDS = Object.freeze(UPGRADE_STEPS.map((s) => s.id));
  }
});

// src/domains/state/upgrade-runner.ts
function defaultDirtyProbe(root) {
  if (!fs12.existsSync(path15.join(root, ".git"))) return [];
  let out;
  try {
    const { execFileSync: execFileSync2 } = require("node:child_process");
    out = execFileSync2("git", ["status", "--porcelain", "--", ".guild"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return null;
  }
  return out.split("\n").filter((line) => line.length > 3 && !line.startsWith("??")).map((line) => line.slice(3).trim()).map((p) => p.includes(" -> ") ? p.split(" -> ")[1] : p).map((p) => p.replace(/^"|"$/g, "").replace(/\/+$/, "")).filter((p) => p.length > 0);
}
function markerFile(storage) {
  return path15.join(storage.root.durable, "storage-layout.json");
}
function agentProfiles(guildDir) {
  const out = /* @__PURE__ */ new Map();
  const dir = path15.join(guildDir, "agents");
  for (const name of readdirSafe(dir)) {
    if (!name.endsWith(".md")) continue;
    const abs = path15.join(dir, name);
    const st = lstatSafe(abs);
    if (!st?.isFile()) continue;
    try {
      out.set(name, fs12.readFileSync(abs, "utf8"));
    } catch {
    }
  }
  return out;
}
function validateUpgrade(guildDir, before, knowledgeDir2 = path15.join(guildDir, DURABLE_SUBTREES.knowledge), steps = []) {
  const errors = [];
  for (const step of steps) {
    if (step.status === "completed" || step.status === "skipped") continue;
    errors.push(`step ${step.step_id} did not complete (${step.status}) \u2014 refusing to stamp the marker`);
  }
  const after = agentProfiles(guildDir);
  for (const [name, body] of before.profiles) {
    const now = after.get(name);
    if (now === void 0) errors.push(`agents/${name} disappeared during upgrade`);
    else if (now !== body) errors.push(`agents/${name} was rewritten during upgrade (feedstock must never replace it)`);
  }
  const pagesNow = countKnowledgePages(knowledgeDir2);
  if (pagesNow < before.knowledgePages) {
    errors.push(`knowledge page count fell from ${before.knowledgePages} to ${pagesNow} \u2014 knowledge was lost`);
  }
  for (const leftover of ["indexes", "index.sqlite"]) {
    if (lstatSafe(path15.join(guildDir, leftover))) errors.push(`.guild/${leftover} still present after caches-out`);
  }
  return errors;
}
function countKnowledgePages(dir, seen = 0) {
  let n = seen;
  for (const name of readdirSafe(dir)) {
    const abs = path15.join(dir, name);
    const st = lstatSafe(abs);
    if (!st) continue;
    if (st.isDirectory()) n = countKnowledgePages(abs, n);
    else if (st.isFile() && name.endsWith(".md")) n += 1;
  }
  return n;
}
function runUpgrade(opts) {
  const storage = opts.storage ?? createGuildStorage(opts.cwd);
  const root = storage.activeRoot;
  const guildDir = storage.root.durable;
  const dryRun = opts.dryRun === true;
  const now = opts.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  const nowMs = opts.nowMs ?? (() => Date.now());
  const journalFile = upgradeJournalPath((...s) => storage.runtime(...s));
  const lockFile = upgradeLockPath((...s) => storage.runtime(...s));
  const base = (state, journal2, extra = {}) => ({
    root,
    state,
    from_version: opts.fromVersion,
    to_version: opts.toVersion,
    marker_written: false,
    journal_path: journalFile,
    journal: { ...journal2, state },
    dirty_paths: journal2.dirty_paths,
    question: null,
    validation_errors: [],
    ...extra
  });
  let journal = loadJournal(journalFile) ?? newJournal({ rootId: guildRootId(root), root, fromVersion: opts.fromVersion, toVersion: opts.toVersion, now: now() });
  if (journal.to_version !== opts.toVersion) {
    journal = newJournal({
      rootId: guildRootId(root),
      root,
      fromVersion: opts.fromVersion,
      toVersion: opts.toVersion,
      now: now()
    });
  }
  const lock = dryRun ? null : acquireLock(lockFile, nowMs());
  if (!dryRun && !lock) {
    return base("running", journal);
  }
  try {
    const dirtyRaw = (opts.dirtyProbe ?? defaultDirtyProbe)(root);
    const dirty = dirtyRaw ?? [".guild"];
    journal = { ...journal, dirty_paths: dirty, state: "running" };
    const knowledgeDir2 = (storage.project ?? storage.workspace).knowledge();
    const before = { profiles: agentProfiles(guildDir), knowledgePages: countKnowledgePages(knowledgeDir2) };
    const settled = settledSteps(journal);
    const ctx = { root, guildDir, storage, dryRun, now, v1: opts.v1, policy: opts.policy };
    let blockedDirty = false;
    for (const step of UPGRADE_STEPS) {
      if (settled.has(step.id)) continue;
      if (step.cls === "durable") {
        const hits = dirty.filter((p) => step.affects.some((a) => p === a || p.startsWith(`${a}/`) || a.startsWith(p)));
        if (hits.length > 0) {
          blockedDirty = true;
          journal = recordStep(journal, {
            step_id: step.id,
            status: "blocked_dirty",
            cls: step.cls,
            detail: `durable step blocked by uncommitted tracked changes: ${hits.join(", ")}`,
            paths: hits,
            at: now()
          });
          continue;
        }
      }
      let result;
      try {
        result = step.apply(ctx);
      } catch (e) {
        journal = recordStep(journal, {
          step_id: step.id,
          status: "failed",
          cls: step.cls,
          detail: e.message,
          paths: [],
          at: now()
        });
        if (!dryRun) saveJournal(journalFile, { ...journal, state: "failed" });
        return base("failed", journal);
      }
      journal = recordStep(journal, {
        step_id: step.id,
        status: result.status === "blocked_confirm" ? "blocked_confirm" : result.status,
        cls: step.cls,
        detail: result.detail,
        paths: result.paths,
        question: result.question,
        at: now()
      });
      if (result.status === "blocked_confirm") {
        if (!dryRun) saveJournal(journalFile, { ...journal, state: "blocked_confirm" });
        return base("blocked_confirm", journal, { question: result.question ?? null });
      }
      if (result.status === "failed") {
        if (!dryRun) saveJournal(journalFile, { ...journal, state: "failed" });
        return base("failed", journal);
      }
    }
    if (blockedDirty) {
      if (!dryRun) saveJournal(journalFile, { ...journal, state: "blocked_dirty_durable" });
      return base("blocked_dirty_durable", journal, { dirty_paths: dirty });
    }
    journal = { ...journal, state: "validating", updated_at: now() };
    if (!dryRun) saveJournal(journalFile, journal);
    const errors = dryRun ? [] : validateUpgrade(guildDir, before, knowledgeDir2, journal.entries);
    if (errors.length > 0) {
      if (!dryRun) saveJournal(journalFile, { ...journal, state: "failed" });
      return base("failed", journal, { validation_errors: errors });
    }
    if (dryRun) return base("planned", journal);
    fs12.mkdirSync(guildDir, { recursive: true });
    fs12.writeFileSync(
      markerFile(storage),
      `${JSON.stringify({ storage_layout_version: opts.toVersion, upgraded_at: now() }, null, 2)}
`,
      "utf8"
    );
    journal = { ...journal, state: "committed", updated_at: now() };
    saveJournal(journalFile, journal);
    return base("committed", journal, { marker_written: true });
  } finally {
    lock?.release();
  }
}
function formatUpgradeReport(result) {
  const lines = [
    `layout upgrade ${result.from_version ?? "unmarked"} \u2192 ${result.to_version} \xB7 ${result.state} \xB7 ${result.root}`
  ];
  for (const e of result.journal.entries) {
    lines.push(`  [${e.status}] ${e.step_id} (${e.cls}) \u2014 ${e.detail}`);
  }
  if (result.state === "blocked_dirty_durable") {
    lines.push("  durable steps blocked by uncommitted tracked changes under .guild/:");
    for (const p of result.dirty_paths) lines.push(`    ${p}`);
    lines.push("  commit or stash those paths, then: guild config migrate --mode=migrate");
  }
  if (result.question) lines.push(`  CONFIRM NEEDED: ${result.question}`);
  for (const e of result.validation_errors) lines.push(`  VALIDATION: ${e}`);
  if (result.marker_written) {
    lines.push("  marker stamped. Review the git diff and commit the upgrade as one change (Guild never commits).");
  }
  return lines.join("\n");
}
var fs12, path15;
var init_upgrade_runner = __esm({
  "src/domains/state/upgrade-runner.ts"() {
    fs12 = __toESM(require("node:fs"));
    path15 = __toESM(require("node:path"));
    init_storage_layout();
    init_storage_roots();
    init_storage_fs();
    init_storage_policy();
    init_upgrade_journal();
    init_upgrade_steps();
  }
});

// src/domains/state/wiki-importance.ts
var STRUCTURAL_BASENAMES;
var init_wiki_importance = __esm({
  "src/domains/state/wiki-importance.ts"() {
    init_kernel();
    init_frontmatter();
    STRUCTURAL_BASENAMES = sealSet([
      "index.md",
      "readme.md",
      "log.md",
      "query.md",
      "transfer-manifest.md"
    ], "STRUCTURAL_BASENAMES");
  }
});

// src/domains/state/detect.ts
var init_detect = __esm({
  "src/domains/state/detect.ts"() {
    init_storage_roots();
  }
});

// src/domains/state/federated-query.ts
function federatedQuery(root, query, scope) {
  const manifestPath = path16.join(durableGuildDir(root), "workspace.json");
  if (!fs13.existsSync(manifestPath)) {
    throw new Error(`workspace.json not found at ${manifestPath}`);
  }
  const manifest = JSON.parse(fs13.readFileSync(manifestPath, "utf8"));
  let candidates = manifest.sub_guilds.filter((sg) => sg.has_wiki);
  if (scope !== void 0) {
    const named = candidates.find((sg) => sg.name === scope);
    if (!named) {
      process.stderr.write(
        `[workspace/federated-query] WARN: scope "${scope}" not found or has no wiki \u2014 0 query steps
`
      );
      candidates = [];
    } else {
      candidates = [named];
    }
  }
  if (candidates.length === 0 && scope === void 0) {
    process.stderr.write(
      `[workspace/federated-query] WARN: no sub_guilds with has_wiki=true \u2014 0 query steps
`
    );
  }
  const steps = [];
  for (const sg of candidates) {
    const subAbsPath = path16.resolve(root, sg.path);
    steps.push({
      type: "query",
      sub_guild: sg.name,
      tool: "wiki_search",
      cwd: subAbsPath,
      query
    });
  }
  steps.push({
    type: "merge_and_tag",
    description: "Merge results from all query steps; tag each result hit with its source sub_guild name. Deduplicate by page path if the same page appears via multiple guild-memory calls. Present to the user with [sub_guild: <name>] provenance."
  });
  return { query, steps };
}
function parseArgs(argv) {
  let cwd;
  let query;
  let scope;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && argv[i + 1]) cwd = argv[++i];
    else if (arg === "--query" && argv[i + 1]) query = argv[++i];
    else if (arg === "--scope" && argv[i + 1]) scope = argv[++i];
  }
  return { cwd, query, scope };
}
function runFederatedQueryCli(argv = process.argv.slice(2)) {
  const { cwd: cwdArg, query, scope } = parseArgs(argv);
  const cwd = cwdArg ?? process.env["GUILD_CWD"] ?? process.cwd();
  if (!query) {
    process.stderr.write(`[workspace/federated-query] ERROR: --query is required
`);
    process.exit(1);
  }
  if (!fs13.existsSync(path16.join(durableGuildDir(cwd), "workspace.json"))) {
    process.stderr.write(
      `[workspace/federated-query] ERROR: no workspace.json at ${path16.join(durableGuildDir(cwd), "workspace.json")}
`
    );
    process.exit(1);
  }
  try {
    const plan = federatedQuery(cwd, query, scope);
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
  } catch (e) {
    process.stderr.write(`[workspace/federated-query] ERROR: ${e.message}
`);
    process.exit(2);
  }
}
var fs13, path16;
var init_federated_query = __esm({
  "src/domains/state/federated-query.ts"() {
    fs13 = __toESM(require("fs"));
    path16 = __toESM(require("path"));
    init_storage_roots();
    if (typeof module !== "undefined" && require.main === module && /^federated-query\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
      runFederatedQueryCli();
    }
  }
});

// src/domains/state/promote-upstream.ts
function validateRunId(runId) {
  if (!runId || !runId.trim()) return false;
  if (runId.includes("\0")) return false;
  if (runId.startsWith("/") || runId.startsWith("\\")) return false;
  if (runId.includes("/") || runId.includes("\\")) return false;
  if (runId === ".") return false;
  if (runId === ".." || runId.startsWith("..")) return false;
  if (runId.includes("..")) return false;
  return true;
}
function isCrossCutting(candidate) {
  if (candidate.upstream === true) return true;
  if (Array.isArray(candidate.applies_to) && candidate.applies_to.length > 1) return true;
  return false;
}
function readSubGuilds(workspaceRoot2) {
  const manifestPath = path17.join(durableGuildDir(workspaceRoot2), "workspace.json");
  if (!fs14.existsSync(manifestPath)) return [];
  try {
    const raw = JSON.parse(fs14.readFileSync(manifestPath, "utf8"));
    const sgs = raw["sub_guilds"];
    if (!Array.isArray(sgs)) return [];
    return sgs.map((sg) => ({
      name: String(sg["name"] ?? ""),
      path: String(sg["path"] ?? sg["name"] ?? "")
    }));
  } catch {
    return [];
  }
}
function findHarvestFiles(childDir) {
  const runsDir = path17.join(durableGuildDir(childDir), "runs");
  if (!fs14.existsSync(runsDir)) return [];
  const results = [];
  try {
    const runIds = fs14.readdirSync(runsDir);
    for (const runId of runIds) {
      const candidate = path17.join(runsDir, runId, "learn", "harvest-candidates.json");
      if (fs14.existsSync(candidate)) {
        results.push(candidate);
      }
    }
  } catch {
  }
  return results;
}
function extractFromHarvestFile(harvestPath, childName, workspaceRoot2) {
  let raw;
  try {
    raw = JSON.parse(fs14.readFileSync(harvestPath, "utf8"));
  } catch {
    return [];
  }
  const sourcePath = path17.relative(workspaceRoot2, harvestPath);
  const staged = [];
  const wikiCandidates = Array.isArray(raw.wiki_candidates) ? raw.wiki_candidates : [];
  const decisionCandidates = Array.isArray(raw.decision_candidates) ? raw.decision_candidates : [];
  for (const wc of wikiCandidates) {
    if (!isCrossCutting(wc)) continue;
    const candidate = {
      kind: "wiki",
      id_or_title: wc.title ?? "(untitled)",
      source_repo: childName,
      source_path: sourcePath,
      source_refs: wc.source_refs ?? [],
      promotion_gate: wc.promotion_gate ?? "guild:wiki-ingest"
    };
    if (Array.isArray(wc.applies_to)) candidate.applies_to = wc.applies_to;
    if (wc.upstream === true) candidate.upstream = true;
    staged.push(candidate);
  }
  for (const dc of decisionCandidates) {
    if (!isCrossCutting(dc)) continue;
    const candidate = {
      kind: "decision",
      id_or_title: dc.decision ?? "(untitled decision)",
      source_repo: childName,
      source_path: sourcePath,
      source_refs: dc.source_refs ?? [],
      promotion_gate: dc.promotion_gate ?? "guild:decisions"
    };
    if (Array.isArray(dc.applies_to)) candidate.applies_to = dc.applies_to;
    if (dc.upstream === true) candidate.upstream = true;
    staged.push(candidate);
  }
  return staged;
}
function collectUpstreamCandidates(opts) {
  const { workspaceRoot: workspaceRoot2 } = opts;
  let children;
  if (opts.child) {
    const all2 = readSubGuilds(workspaceRoot2);
    const found = all2.find((sg) => sg.name === opts.child);
    children = found ? [found] : [{ name: opts.child, path: opts.child }];
  } else {
    children = readSubGuilds(workspaceRoot2);
  }
  const all = [];
  for (const child of children) {
    const childDir = path17.join(workspaceRoot2, child.path);
    const harvestFiles = findHarvestFiles(childDir);
    for (const hf of harvestFiles) {
      const from = extractFromHarvestFile(hf, child.name, workspaceRoot2);
      all.push(...from);
    }
  }
  return all;
}
function parseArgs2(argv) {
  let workspaceRoot2;
  let child;
  let runId;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--workspace-root" && argv[i + 1]) {
      workspaceRoot2 = argv[++i];
    } else if (arg === "--child" && argv[i + 1]) {
      child = argv[++i];
    } else if (arg === "--run-id" && argv[i + 1]) {
      runId = argv[++i];
    } else if (arg.startsWith("--workspace-root=")) {
      workspaceRoot2 = arg.slice("--workspace-root=".length);
    } else if (arg.startsWith("--child=")) {
      child = arg.slice("--child=".length);
    } else if (arg.startsWith("--run-id=")) {
      runId = arg.slice("--run-id=".length);
    }
  }
  return { workspaceRoot: workspaceRoot2, child, runId };
}
function runPromoteUpstreamCli(argv = process.argv.slice(2)) {
  const { workspaceRoot: rootArg, child, runId: runIdArg } = parseArgs2(argv);
  const workspaceRoot2 = rootArg ?? process.env["GUILD_CWD"] ?? process.cwd();
  if (!fs14.existsSync(workspaceRoot2) || !fs14.statSync(workspaceRoot2).isDirectory()) {
    process.stderr.write(
      `[promote-upstream] ERROR: --workspace-root "${workspaceRoot2}" is not a directory
`
    );
    process.exit(1);
  }
  const runId = runIdArg ?? `upstream-${child ?? "all"}`;
  if (!validateRunId(runId)) {
    process.stderr.write(
      `[promote-upstream] ERROR: invalid run-id "${runId}" \u2014 path traversal or separator detected
`
    );
    process.exit(1);
  }
  try {
    const candidates = collectUpstreamCandidates({ workspaceRoot: workspaceRoot2, child });
    const runsBase = path17.resolve(durableGuildDir(workspaceRoot2), "runs");
    const runsDir = path17.join(runsBase, runId);
    const manifestPath = path17.join(runsDir, "upstream-candidates.json");
    const resolvedRunsDir = path17.resolve(runsDir);
    if (!isWithin(resolvedRunsDir, runsBase) || resolvedRunsDir === runsBase) {
      process.stderr.write(
        `[promote-upstream] ERROR: resolved run dir "${resolvedRunsDir}" is not a strict subdirectory of the runs base
`
      );
      process.exit(1);
    }
    const prepared = prepareContainedWrite(workspaceRoot2, manifestPath, {
      policy: "physical"
    });
    if (isRefused(prepared)) {
      process.stderr.write(
        `[promote-upstream] ERROR: resolved run dir "${resolvedRunsDir}" escapes runs base [${prepared.code}] \u2014 ${prepared.detail}
`
      );
      process.exit(1);
    }
    const subGuilds = child ? [{ name: child, path: child }] : readSubGuilds(workspaceRoot2);
    const childrenScanned = subGuilds.map((sg) => sg.name);
    const manifest = {
      schema_version: "guild.upstream_candidates.v1",
      generated_at: (/* @__PURE__ */ new Date()).toISOString(),
      workspace_root: workspaceRoot2,
      children_scanned: childrenScanned,
      candidates
    };
    atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const byRepo = /* @__PURE__ */ new Map();
    for (const c of candidates) {
      byRepo.set(c.source_repo, (byRepo.get(c.source_repo) ?? 0) + 1);
    }
    process.stdout.write(`[promote-upstream] Scanned: ${childrenScanned.join(", ") || "(none)"}
`);
    process.stdout.write(`[promote-upstream] Staged candidates: ${candidates.length}
`);
    for (const [repo, count] of byRepo) {
      process.stdout.write(`  ${repo}: ${count}
`);
    }
    process.stdout.write(
      `[promote-upstream] GATE REMINDER: Promotion to docs/knowledge/ happens ONLY via guild:wiki-ingest (human gate). This manifest is by-reference only.
`
    );
    process.stdout.write(`[promote-upstream] Manifest: ${manifestPath}
`);
  } catch (e) {
    process.stderr.write(`[promote-upstream] ERROR: ${e.message}
`);
    process.exit(2);
  }
}
var fs14, path17;
var init_promote_upstream = __esm({
  "src/domains/state/promote-upstream.ts"() {
    fs14 = __toESM(require("fs"));
    path17 = __toESM(require("path"));
    init_atomic_write();
    init_kernel();
    init_storage_roots();
    if (typeof module !== "undefined" && require.main === module && /^promote-upstream\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
      runPromoteUpstreamCli();
    }
  }
});

// src/domains/state/write-manifest.ts
var init_write_manifest = __esm({
  "src/domains/state/write-manifest.ts"() {
    init_detect();
    init_atomic_write();
    init_storage_roots();
  }
});

// src/domains/state/index.ts
var init_state = __esm({
  "src/domains/state/index.ts"() {
    init_atomic_write();
    init_dependency_graph_reader();
    init_dependency_graph_schema();
    init_frontmatter();
    init_guild_discovery();
    init_guild_root();
    init_index_cache();
    init_storage_artifact_registry();
    init_storage_fs();
    init_storage_janitor();
    init_storage_layout();
    init_storage_policy();
    init_storage_roots();
    init_upgrade_glossary();
    init_upgrade_journal();
    init_upgrade_runner();
    init_upgrade_steps();
    init_index_migrate();
    init_wiki_importance();
    init_detect();
    init_federated_query();
    init_promote_upstream();
    init_write_manifest();
    init_plugin_install_guard();
  }
});

// src/domains/config/host-capabilities-schema.ts
var UPDATE_COMMANDS, INJECTION_SUPPORT, INJECTION_SUPPORT_SET, CLAUDE_CAPABILITIES, CODEX_CAPABILITIES, NO_HOOKS, AGENTS_FILE_CAPABILITIES, REQUIRED_HOOK_EVENTS;
var init_host_capabilities_schema = __esm({
  "src/domains/config/host-capabilities-schema.ts"() {
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

// src/domains/config/host-registry-schema.ts
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
  "src/domains/config/host-registry-schema.ts"() {
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

// src/domains/config/host-id-namespace.ts
var HOST_ID_SET2;
var init_host_id_namespace = __esm({
  "src/domains/config/host-id-namespace.ts"() {
    init_host_registry_schema();
    HOST_ID_SET2 = new Set(HOST_IDS);
  }
});

// src/domains/config/adapter-fallback-ladders.ts
var RUNGS, ADAPTER_SURFACES, INFERRED_HOSTS, RUNG_SET, SURFACE_SET;
var init_adapter_fallback_ladders = __esm({
  "src/domains/config/adapter-fallback-ladders.ts"() {
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

// src/domains/config/host-profiles-validate.ts
var KNOWN_HOST_IDS, VALID_HOST_PROFILE_ENTRY_KEYS, VALID_HOST_PROFILE_MODEL_KEYS;
var init_host_profiles_validate = __esm({
  "src/domains/config/host-profiles-validate.ts"() {
    init_host_registry_schema();
    init_kernel();
    init_host_id_namespace();
    KNOWN_HOST_IDS = new Set(HOST_IDS);
    VALID_HOST_PROFILE_ENTRY_KEYS = sealSet(["models", "enabled"], "VALID_HOST_PROFILE_ENTRY_KEYS");
    VALID_HOST_PROFILE_MODEL_KEYS = sealSet(["cheap", "mid", "powerful"], "VALID_HOST_PROFILE_MODEL_KEYS");
  }
});

// src/domains/config/host-registry.ts
function deriveCapabilityRow(row) {
  return row.capabilities;
}
function resultAdapterForFamily(family) {
  return FAMILY_TO_ROW[family]?.result_adapter ?? false;
}
var DERIVED_HOST_CAPABILITY_ROWS, FAMILY_TO_ROW;
var init_host_registry = __esm({
  "src/domains/config/host-registry.ts"() {
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

// src/domains/config/host-adapter-contract.ts
var HOST_ADAPTER_OPERATIONS;
var init_host_adapter_contract = __esm({
  "src/domains/config/host-adapter-contract.ts"() {
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

// src/domains/config/provider-detect.ts
var PROVIDER_REGISTRY;
var init_provider_detect = __esm({
  "src/domains/config/provider-detect.ts"() {
    init_host_registry();
    init_state();
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

// src/domains/config/session-context.ts
var init_session_context = __esm({
  "src/domains/config/session-context.ts"() {
    init_provider_detect();
    init_state();
  }
});

// src/domains/config/model-discovery-contract.ts
var FAILURE_REASONS;
var init_model_discovery_contract = __esm({
  "src/domains/config/model-discovery-contract.ts"() {
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
  }
});

// src/domains/config/config-defaults.ts
var DEFAULT_ESCALATION_MARKERS, NON_INHERITABLE_KEYS, LOG_ROTATION_THRESHOLD_BYTES, SIDECAR_MAX_BYTES, CAPABILITY_RESOLVER_MODES, CAPABILITY_AUTO_CREATE_POLICIES, CAPABILITY_RESOLVER_MODE_AFTER_F7, CAPABILITY_RESOLVER_MODE_DEFAULT, DEFAULTS;
var init_config_defaults = __esm({
  "src/domains/config/config-defaults.ts"() {
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
        // roster (host-registry-schema.ts) enumerated by hand; a test
        // (scripts/lib/config-defaults-tiers-host-ids.test.ts) asserts the two
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
        wiki: { share_mode: "team", autopromote: true },
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

// src/domains/config/policy-keys.ts
function canonicalPolicyKey(dotted) {
  return POLICY_KEY_ALIASES[dotted] ?? dotted;
}
function isPolicyKey(dotted) {
  return BY_KEY.has(canonicalPolicyKey(dotted));
}
function matchesHostFamily(text) {
  for (const fam of HOST_FAMILY_TOKENS) {
    if (new RegExp(`(^|[^a-z0-9])${fam}([^a-z0-9]|$)`, "i").test(text)) return fam;
  }
  return null;
}
function matchesModelName(text) {
  for (const re of MODEL_NAME_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}
function findHostIdentity(key, value, knownHostIds = []) {
  for (const re of INVENTORY_KEY_PATTERNS) {
    if (re.test(key)) return { kind: "model-inventory", key, token: key };
  }
  const segments = key.split(".");
  for (const seg of segments) {
    if (MODEL_FAMILY_TOKENS.includes(seg.toLowerCase())) continue;
    const fam = matchesHostFamily(seg);
    if (fam) return { kind: "host-family", key, token: fam };
    if (knownHostIds.some((h) => h.toLowerCase() === seg.toLowerCase())) {
      return { kind: "host-id", key, token: seg };
    }
    const model = matchesModelName(seg);
    if (model) return { kind: "model-name", key, token: model };
  }
  if (typeof value === "string") {
    const model = matchesModelName(value);
    if (model) return { kind: "model-name", key, token: model };
    if (knownHostIds.some((h) => h.toLowerCase() === value.toLowerCase())) {
      return { kind: "host-id", key, token: value };
    }
    if (!MODEL_FAMILY_TOKENS.includes(value.toLowerCase())) {
      const fam = matchesHostFamily(value);
      if (fam) return { kind: "host-family", key, token: fam };
    }
  }
  return null;
}
var POLICY_KEYS, BY_KEY, POLICY_KEY_ALIASES, HOST_FAMILY_TOKENS, MODEL_FAMILY_TOKENS, MODEL_NAME_PATTERNS, INVENTORY_KEY_PATTERNS;
var init_policy_keys = __esm({
  "src/domains/config/policy-keys.ts"() {
    init_kernel();
    POLICY_KEYS = deepFreeze([
      // Tier SELECTORS — which tier a lane starts at, never which model serves it.
      {
        key: "tiers.default",
        type: "enum",
        values: ["cheap", "mid", "powerful"],
        default: "mid",
        note: "tier a lane starts at when its score names none; the adapter maps tier\u2192model at dispatch"
      },
      // Score floors — the complexity score at which a lane is promoted a tier.
      {
        key: "tiers.floors.mid",
        type: "number",
        min: 0,
        max: 10,
        default: 3,
        note: "complexity-score floor at which a lane resolves to the mid tier"
      },
      {
        key: "tiers.floors.powerful",
        type: "number",
        min: 0,
        max: 10,
        default: 6,
        note: "complexity-score floor at which a lane resolves to the powerful tier"
      },
      {
        key: "advisorRounds",
        type: "integer",
        min: 0,
        max: 10,
        default: 2,
        note: "advisor escalation rounds a cell may spend before it blocks with next_need: budget (R72)"
      },
      {
        key: "budget.tokens",
        type: "integer",
        min: 0,
        default: null,
        note: "optional per-run token cap; null = uncapped. D-PROBE and inner verify do not decrement it"
      },
      {
        key: "budget.usd",
        type: "number",
        min: 0,
        default: null,
        note: "optional per-run spend cap in USD; null = uncapped"
      },
      {
        key: "team.compose_scope",
        type: "enum",
        values: ["phase", "goal"],
        default: "phase",
        note: "whether team-compose mints per phase or slices a roster per goal (KTD62)"
      },
      {
        key: "recall.backend",
        type: "enum",
        values: ["bm25", "hybrid"],
        default: "bm25",
        note: "recall backend; embeddings are cache only and a missing model fails open to bm25 (KTD67)"
      },
      {
        key: "recall.thresholds.min_score",
        type: "number",
        min: 0,
        max: 1,
        default: 0.2,
        note: "minimum BM25 score a recall hit needs to enter a bundle"
      },
      {
        key: "recall.thresholds.max_hits",
        type: "integer",
        min: 1,
        max: 100,
        default: 8,
        note: "maximum recall hits a lane bundle may carry"
      },
      {
        key: "review.critic",
        type: "enum",
        values: ["off", "advisor"],
        default: "advisor",
        note: "who plays critic; `advisor` is the machinery agent, never a new model family (KTD68)"
      },
      {
        key: "review.independence",
        type: "boolean",
        default: true,
        note: "a Team Lead may not review its own cell (KTD58); false only for single-agent local runs"
      },
      {
        key: "wiki.autopromote",
        type: "boolean",
        default: true,
        note: "harvest auto-promotes decisions on this cwd; false = candidates-only (KTD35)"
      },
      {
        key: "agent_mode",
        type: "enum",
        values: ["auto", "team", "agent", "subagent"],
        default: "auto",
        note: "dispatch backend PREFERENCE only; never a statement about which host is running"
      },
      {
        key: "dispatch.max_instances",
        type: "integer",
        min: 1,
        max: 32,
        default: 4,
        note: "live worker instances one run may hold at once; CONCURRENCY, not a roster cap (R46/KTD30)"
      }
    ]);
    BY_KEY = new Map(POLICY_KEYS.map((s) => [s.key, s]));
    POLICY_KEY_ALIASES = Object.freeze({
      "defaults.wiki.autopromote": "wiki.autopromote",
      "defaults.agent_mode": "agent_mode",
      "defaults.team.compose_scope": "team.compose_scope",
      "defaults.recall.backend": "recall.backend",
      "defaults.review.critic": "review.critic",
      "defaults.advisorRounds": "advisorRounds"
    });
    HOST_FAMILY_TOKENS = Object.freeze([
      "claude",
      "codex",
      "cursor",
      "gemini",
      "copilot",
      "windsurf",
      "aider",
      "antigravity",
      "pi",
      "cline",
      "continue",
      "zed"
    ]);
    MODEL_FAMILY_TOKENS = Object.freeze([
      "anthropic",
      "openai",
      "google"
    ]);
    MODEL_NAME_PATTERNS = Object.freeze([
      /\bopus\b/i,
      /\bsonnet\b/i,
      /\bhaiku\b/i,
      /\bfable\b/i,
      /\bgpt-?[0-9]/i,
      /\bo[1-9](?:-(?:mini|pro|preview))?\b/i,
      /\bgemini-[0-9]/i,
      /\bclaude-[a-z0-9]/i,
      /\bllama-?[0-9]/i,
      /\bmistral\b/i,
      /\bgrok-?[0-9]/i,
      /\bdeepseek\b/i,
      /\bqwen\b/i
    ]);
    INVENTORY_KEY_PATTERNS = Object.freeze([
      /^models(\.|$)/,
      /^defaults\.models(\.|$)/,
      /^host_profiles(\.|$)/,
      /^defaults\.host_profiles(\.|$)/,
      /^host(\.|$)/,
      /^defaults\.host(\.|$)/,
      /^roles\.[^.]+\.host(\.|$)/,
      /^defaults\.cross_host(\.|$)/
    ]);
  }
});

// src/domains/config/policy-resolver.ts
var POLICY_FILES, ALIASES_BY_CANONICAL;
var init_policy_resolver = __esm({
  "src/domains/config/policy-resolver.ts"() {
    init_policy_keys();
    init_state();
    POLICY_FILES = Object.freeze({
      project: "config/project.json",
      projectLocal: "config/project.local.json",
      workspace: "config/workspace.json",
      workspaceLocal: "config/workspace.local.json"
    });
    ALIASES_BY_CANONICAL = (() => {
      const m = /* @__PURE__ */ new Map();
      for (const [legacy, target] of Object.entries(POLICY_KEY_ALIASES)) {
        m.set(target, [...m.get(target) ?? [], legacy]);
      }
      return m;
    })();
  }
});

// src/domains/config/session-binding.ts
var HOST_TO_MODEL_FAMILY, ENV_SIGNALS, KNOWN_FAMILIES;
var init_session_binding = __esm({
  "src/domains/config/session-binding.ts"() {
    HOST_TO_MODEL_FAMILY = Object.freeze({
      claude: "anthropic",
      codex: "openai",
      copilot: "openai",
      cursor: "openai",
      gemini: "google",
      antigravity: "google"
    });
    ENV_SIGNALS = Object.freeze([
      { env: "GUILD_HOST_FAMILY", fromValue: true },
      { env: "CLAUDE_PLUGIN_ROOT", family: "claude" },
      { env: "CLAUDECODE", family: "claude" },
      { env: "CODEX_HOME", family: "codex" },
      { env: "CODEX_SANDBOX", family: "codex" },
      { env: "CURSOR_TRACE_ID", family: "cursor" },
      { env: "GEMINI_CLI", family: "gemini" }
    ]);
    KNOWN_FAMILIES = /* @__PURE__ */ new Set([...Object.keys(HOST_TO_MODEL_FAMILY), "cline", "zed", "aider", "windsurf", "pi"]);
  }
});

// src/domains/config/config-validation.ts
var init_config_validation = __esm({
  "src/domains/config/config-validation.ts"() {
    init_host_id_namespace();
  }
});

// src/domains/security/safe-object.ts
var PROTO_POISON_KEYS;
var init_safe_object = __esm({
  "src/domains/security/safe-object.ts"() {
    init_kernel();
    PROTO_POISON_KEYS = sealSet(["__proto__", "prototype", "constructor"], "PROTO_POISON_KEYS");
  }
});

// src/domains/security/injection-guard.ts
var init_injection_guard = __esm({
  "src/domains/security/injection-guard.ts"() {
  }
});

// src/domains/security/redact-log.ts
var FIELD_SIZE_CAP_BYTES, TOKEN_SHAPE_PATTERNS, SENSITIVE_HOME_DIRS, REDACTABLE_FIELD_NAMES, REDACTABLE_FIELDS;
var init_redact_log = __esm({
  "src/domains/security/redact-log.ts"() {
    init_kernel();
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

// src/domains/security/secrets.ts
var init_secrets = __esm({
  "src/domains/security/secrets.ts"() {
    init_redact_log();
  }
});

// src/domains/security/config.ts
var init_config = __esm({
  "src/domains/security/config.ts"() {
    init_state();
    init_state();
  }
});

// src/domains/security/events.ts
var SECURITY_EVENT_TYPES, KNOWN_GUILD_HOST_KINDS, KNOWN_GUILD_HOST_ID_SET;
var init_events = __esm({
  "src/domains/security/events.ts"() {
    init_state();
    init_redact_log();
    init_state();
    SECURITY_EVENT_TYPES = Object.freeze([
      "capability_scope_violation",
      "capability_scope_degrade",
      "bypass_permission_allowed",
      "mcp_description_mismatch",
      "mcp_description_unverifiable",
      "mcp_description_unpinned",
      "secret_scrub_failure",
      "injection_attempt_detected",
      "secret_scrub_blocked",
      "recall_quarantine",
      "dispatch_attribution_missing",
      "backend_degradation",
      "tier_dispatch_untiered",
      "harvest_promoted",
      "harvest_refused",
      "playbook_auto_replace",
      "wiki_cas_conflict",
      "harvest_reverted",
      "lane_wiki_write_refused",
      "queue_drain_refused"
    ]);
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

// src/domains/security/scrubbed-write.ts
var init_scrubbed_write = __esm({
  "src/domains/security/scrubbed-write.ts"() {
    init_secrets();
    init_config();
    init_events();
  }
});

// src/domains/security/share-set.ts
var path18, SHARED_SCRUBBED_NAMES, CANONICAL_RUN_LOG;
var init_share_set = __esm({
  "src/domains/security/share-set.ts"() {
    path18 = __toESM(require("path"));
    init_kernel();
    SHARED_SCRUBBED_NAMES = sealSet([
      "verify.md",
      "review.md",
      "provenance.json",
      "summary.md",
      "run.yaml",
      "run-state.json"
    ], "SHARED_SCRUBBED_NAMES");
    CANONICAL_RUN_LOG = path18.join("logs", "v1.4-events.jsonl");
  }
});

// src/domains/security/secret-patterns.ts
var SECRET_PATTERNS;
var init_secret_patterns = __esm({
  "src/domains/security/secret-patterns.ts"() {
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

// src/domains/security/scrub-redact.ts
var init_scrub_redact = __esm({
  "src/domains/security/scrub-redact.ts"() {
    init_secret_patterns();
    init_state();
  }
});

// src/domains/security/d5-permission-content.ts
var init_d5_permission_content = __esm({
  "src/domains/security/d5-permission-content.ts"() {
  }
});

// src/domains/security/ingest-pause.ts
var init_ingest_pause = __esm({
  "src/domains/security/ingest-pause.ts"() {
    init_state();
  }
});

// src/domains/security/index.ts
var init_security = __esm({
  "src/domains/security/index.ts"() {
    init_safe_object();
    init_injection_guard();
    init_scrubbed_write();
    init_redact_log();
    init_share_set();
    init_scrub_redact();
    init_secret_patterns();
    init_events();
    init_d5_permission_content();
    init_ingest_pause();
    init_config();
    init_secrets();
  }
});

// src/domains/config/model-policy.ts
var POLICY_PURPOSES, REVIEW_CLASS_PURPOSES, COMPLEXITIES, CONDITION_KINDS, INDEPENDENCE_LEVELS, POLICY_TIERS, OPERATOR_BASELINE_POLICY;
var init_model_policy = __esm({
  "src/domains/config/model-policy.ts"() {
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

// src/domains/config/workspace-manifest.ts
var init_workspace_manifest = __esm({
  "src/domains/config/workspace-manifest.ts"() {
    init_state();
  }
});

// src/domains/config/settings-reader.ts
var yaml, VALID_TIER_HOST_KEYS, KNOWN_HOST_IDS2, DISPATCH_HOST_IDS, RESOLVER_TIER1_KEYS;
var init_settings_reader = __esm({
  "src/domains/config/settings-reader.ts"() {
    init_host_registry_schema();
    init_host_id_namespace();
    init_host_profiles_validate();
    init_security();
    init_config_defaults();
    init_model_policy();
    init_kernel();
    init_workspace_manifest();
    init_state();
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

// src/domains/telemetry/receipt-journal.ts
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
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
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
  return { ...body, record_hash: sha2562(canonicalJson(body)) };
}
function verifyReceiptRecord(record) {
  const { record_hash, ...body } = record;
  return typeof record_hash === "string" && sha2562(canonicalJson(body)) === record_hash;
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
function openLockPublication(lockPath) {
  const frame = { lockPath, outer: ACTIVE_LOCK_PUBLICATION, grant: null, open: true };
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
    written += fs15.writeSync(fd, buf, written, buf.length - written);
  }
}
function readAllSync(fd) {
  const size = fs15.fstatSync(fd).size;
  if (size === 0) return "";
  const buf = Buffer.allocUnsafe(size);
  let read = 0;
  while (read < size) {
    const n = fs15.readSync(fd, buf, read, size - read, read);
    if (n <= 0) break;
    read += n;
  }
  return buf.subarray(0, read).toString("utf8");
}
function realpathOrNull(target) {
  try {
    return (fs15.realpathSync.native ?? fs15.realpathSync)(target);
  } catch {
    return null;
  }
}
function readlinkOrNull(target) {
  try {
    return fs15.readlinkSync(target);
  } catch {
    return null;
  }
}
function canonicalJournalPath(journalPath) {
  let current = path19.resolve(journalPath);
  for (let hop = 0; hop < CANONICAL_PATH_MAX_LINK_HOPS; hop += 1) {
    const real = realpathOrNull(current);
    if (real !== null) return real;
    const link = readlinkOrNull(current);
    if (link !== null) {
      const next = path19.resolve(path19.dirname(current), link);
      if (next === current) return current;
      current = next;
      continue;
    }
    const parent = path19.dirname(current);
    if (parent === current) return current;
    return path19.join(canonicalJournalPath(parent), path19.basename(current));
  }
  return current;
}
function lstatOrNull2(target) {
  try {
    return fs15.lstatSync(target);
  } catch {
    return null;
  }
}
function resolveJournalIdentity(journalPath) {
  const refuse2 = (code, message) => ({
    ok: false,
    identity: null,
    failure: { code, message }
  });
  const canonical = canonicalJournalPath(journalPath);
  if (canonicalJournalPath(canonical) !== canonical) {
    return refuse2(
      "journal_identity_unstable",
      `journal path "${journalPath}" canonicalizes to "${canonical}", which itself resolves further \u2014 the name is moving and cannot be bound to a lock`
    );
  }
  const stat = lstatOrNull2(canonical);
  if (stat === null) {
    return { ok: true, identity: { path: canonical, lock: `${canonical}.lock`, device: null, inode: null, links: null }, failure: null };
  }
  if (stat.isSymbolicLink()) {
    return refuse2(
      "journal_identity_unstable",
      `a symlink appeared at the canonical journal name "${canonical}" after it was resolved`
    );
  }
  if (!stat.isFile()) {
    return refuse2(
      "journal_identity_unstable",
      `canonical journal name "${canonical}" does not name a regular file`
    );
  }
  if (stat.nlink > 1) {
    return refuse2(
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
function asLockGrant(value, lockPath) {
  if (typeof value !== "object" || value === null) return null;
  const claim = value;
  if (claim.path !== lockPath) return null;
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
function acquireJournalLockHeld(lockPath, io, options) {
  const acquire = io.acquireLock ?? defaultJournalIo.acquireLock;
  const attempts = Math.max(1, options.lock_max_attempts ?? JOURNAL_LOCK_MAX_ATTEMPTS);
  const wait = Math.max(0, options.lock_wait_ms ?? JOURNAL_LOCK_WAIT_MS);
  for (let i = 0; i < attempts; i += 1) {
    const publication = openLockPublication(lockPath);
    let got;
    try {
      got = acquire(lockPath);
    } catch (err) {
      discardLockGrant(closeLockPublication(publication));
      return lockRefusal(
        "journal_lock_failed",
        `journal lock could not be evaluated at ${lockPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const published = closeLockPublication(publication);
    if (got) {
      const returned = asLockGrant(got, lockPath);
      if (published !== null) {
        if (returned !== null && !sameLockObject(returned, published)) {
          discardDuplicateGrant(returned, published);
          discardLockGrant(published);
          return lockRefusal(
            "journal_lock_failed",
            `the acquisition of the journal lock at ${lockPath} returned a lock object that is not the one its own primitive created for this call \u2014 refusing to hold an exclusion whose identity the acquisition disputes`
          );
        }
        discardDuplicateGrant(returned, published);
        return { grant: published, failure: null };
      }
      if (returned !== null) return { grant: returned, failure: null };
      return lockRefusal(
        "journal_lock_failed",
        `the journal lock at ${lockPath} was reported as taken by an acquisition that named no lock object \u2014 refusing to mutate under an exclusion this writer cannot identify, and leaving that lock in place rather than deleting an object it cannot recognise as its own`
      );
    }
    discardLockGrant(published);
    if (i < attempts - 1) sleepSync(wait);
  }
  return lockRefusal(
    "journal_lock_unavailable",
    `journal lock at ${lockPath} is held by another writer after ${attempts} attempts \u2014 refusing to append without exclusive access (remove the lock only after confirming no writer is live)`
  );
}
function acquireJournalLock(lockPath, io = defaultJournalIo, options = {}) {
  const held = acquireJournalLockHeld(lockPath, io, options);
  discardLockGrant(held.grant);
  return held.failure;
}
function releaseJournalLock(lockPath, io = defaultJournalIo) {
  const release = io.releaseLock ?? defaultJournalIo.releaseLock;
  try {
    release(lockPath);
  } catch {
  }
}
function statOrNull(target) {
  try {
    return fs15.statSync(target);
  } catch {
    return null;
  }
}
function fstatOrNull(fd) {
  try {
    return fs15.fstatSync(fd);
  } catch {
    return null;
  }
}
function closeQuietly(fd) {
  try {
    fs15.closeSync(fd);
  } catch {
  }
}
function acquireJournalAuthority(journalPath, io = defaultJournalIo, lockOptions = {}, access = "read", checkpointPath = null) {
  const resolved = resolveJournalIdentity(journalPath);
  if (!resolved.ok) return { ok: false, authority: null, identity: null, failure: resolved.failure };
  const identity = resolved.identity;
  const acquisition = acquireJournalLockHeld(identity.lock, io, lockOptions);
  if (acquisition.failure !== null) return { ok: false, authority: null, identity, failure: acquisition.failure };
  const grant = acquisition.grant;
  const journalParent = path19.dirname(identity.path);
  const parentStat = statOrNull(journalParent);
  const parentDevice = parentStat !== null ? parentStat.dev : null;
  const parentInode = parentStat !== null ? parentStat.ino : null;
  const checkpointParentPath = checkpointPath === null ? null : canonicalJournalPath(path19.dirname(checkpointPath));
  const checkpointCanonical = checkpointParentPath === null || checkpointPath === null ? null : path19.join(checkpointParentPath, path19.basename(checkpointPath));
  const checkpointParent = checkpointParentPath === null || checkpointParentPath === journalParent ? null : checkpointParentPath;
  let checkpointParentPin = null;
  let handle = null;
  let released = false;
  const unstable = (message) => ({ code: "journal_identity_unstable", message });
  const ambiguous = (message) => ({ code: "journal_identity_ambiguous", message });
  const pin = () => {
    const present = lstatOrNull2(identity.path);
    if (present === null) return null;
    if (present.isSymbolicLink() || !present.isFile()) {
      return unstable(`canonical journal name "${identity.path}" no longer names a regular file`);
    }
    let fd = null;
    let writable = false;
    try {
      fd = fs15.openSync(identity.path, JOURNAL_ACCESS_FLAGS[access]);
      writable = access !== "read";
    } catch {
      fd = null;
    }
    if (fd === null) {
      try {
        fd = fs15.openSync(identity.path, "r");
        writable = false;
      } catch (err) {
        return unstable(
          `the journal at "${identity.path}" could not be opened for ${access}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    const st = fstatOrNull(fd);
    if (st === null || st.dev !== present.dev || st.ino !== present.ino) {
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
      fd = fs15.openSync(checkpointParent, "r");
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
    const named = lstatOrNull2(identity.path);
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
      const parentNow = statOrNull(path19.dirname(identity.path));
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
    const lockNow = lstatOrNull2(identity.lock);
    if (lockNow === null || !lockNow.isDirectory() || lockNow.dev !== grant.device || lockNow.ino !== grant.inode) {
      return unstable(
        `the lock this writer acquired is no longer the lock at "${identity.lock}" ${stage} \u2014 another holder now owns that exclusion, so this operation is refused`
      );
    }
    const current = resolveJournalIdentity(journalPath);
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
      const parentNamedNow = canonicalJournalPath(path19.dirname(checkpointPath));
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
    const lockNow = lstatOrNull2(identity.lock);
    const stillOurs = lockNow !== null && lockNow.isDirectory() && lockNow.dev === grant.device && lockNow.ino === grant.inode;
    discardLockGrant(grant);
    if (stillOurs) {
      releaseJournalLock(identity.lock, io);
      return;
    }
  };
  const failClosed = (failure) => {
    release();
    return { ok: false, authority: null, identity, failure };
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
        const failure = verify(stage);
        if (failure) throw new JournalAuthorityDetachedError(failure);
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
function scanReceiptJournal(journalPath, io = defaultJournalIo) {
  const raw = io.readAll(journalPath);
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
var fs15, path19, crypto4, RECEIPT_CONTRACT_VERSION, RECEIPT_DISPOSITIONS, OBSERVATION_STATES, RECEIPT_EVENT_NAMES, RECEIPT_OUTCOME_TYPES, UNPINNED_FD, JournalAuthorityDetachedError, ACTIVE_LOCK_PUBLICATION, defaultJournalIo, CANONICAL_PATH_MAX_LINK_HOPS, JournalIdentityError, JOURNAL_LOCK_MAX_ATTEMPTS, JOURNAL_LOCK_WAIT_MS, JOURNAL_ACCESS_FLAGS, REQUIRED_STRING_FIELDS;
var init_receipt_journal = __esm({
  "src/domains/telemetry/receipt-journal.ts"() {
    fs15 = __toESM(require("node:fs"));
    path19 = __toESM(require("node:path"));
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
      constructor(failure) {
        super(failure.message);
        this.name = "JournalAuthorityDetachedError";
        this.failure = failure;
      }
    };
    ACTIVE_LOCK_PUBLICATION = null;
    defaultJournalIo = {
      appendLine(journalPath, text, bound) {
        bound?.guard?.("immediately before the append syscall");
        if (bound && bound.writable && bound.fd >= 0) {
          writeAllSync(bound.fd, text);
          fs15.fsyncSync(bound.fd);
          return;
        }
        fs15.mkdirSync(path19.dirname(journalPath), { recursive: true });
        const fd = fs15.openSync(journalPath, "a");
        try {
          fs15.writeSync(fd, text, null, "utf8");
          fs15.fsyncSync(fd);
        } finally {
          fs15.closeSync(fd);
        }
      },
      readAll(journalPath, bound) {
        if (bound && bound.fd >= 0) {
          try {
            return readAllSync(bound.fd);
          } catch {
            return null;
          }
        }
        try {
          return fs15.readFileSync(journalPath, "utf8");
        } catch {
          return null;
        }
      },
      writeCheckpoint(checkpointPath, content, bound) {
        bound?.guard?.("immediately before the checkpoint replacement");
        atomicWrite(checkpointPath, content);
      },
      truncate(journalPath, size, bound) {
        bound?.guard?.("immediately before the truncation syscall");
        if (bound && bound.writable && bound.fd >= 0) {
          fs15.ftruncateSync(bound.fd, size);
          return;
        }
        fs15.truncateSync(journalPath, size);
      },
      // `mkdir` is the portable atomic test-and-set: it either creates the
      // directory or fails EEXIST, with no window in between. `open(O_CREAT|O_EXCL)`
      // has the same guarantee locally but is famously unreliable over NFS, and
      // Guild journals can live on a shared volume.
      acquireLock(lockPath) {
        fs15.mkdirSync(path19.dirname(lockPath), { recursive: true });
        try {
          fs15.mkdirSync(lockPath);
        } catch (err) {
          if (err.code === "EEXIST") return false;
          throw err;
        }
        let fd = null;
        try {
          fd = fs15.openSync(lockPath, "r");
        } catch {
          fd = null;
        }
        const stat = fd !== null ? fstatOrNull(fd) : lstatOrNull2(lockPath);
        if (stat === null || !stat.isDirectory()) {
          if (fd !== null) closeQuietly(fd);
          throw new Error(
            `journal lock at ${lockPath} could not be identified immediately after it was created \u2014 refusing to hold an exclusion this writer cannot name`
          );
        }
        return publishLockGrant({ path: lockPath, device: stat.dev, inode: stat.ino, fd });
      },
      releaseLock(lockPath) {
        try {
          fs15.rmdirSync(lockPath);
        } catch {
        }
      }
    };
    CANONICAL_PATH_MAX_LINK_HOPS = 32;
    JournalIdentityError = class extends Error {
      code;
      constructor(failure) {
        super(failure.message);
        this.name = "JournalIdentityError";
        this.code = failure.code;
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

// src/domains/telemetry/receipt-reconcile.ts
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
function identityDenial(failure) {
  return {
    code: failure.code === "journal_identity_ambiguous" ? "repair_identity_ambiguous" : "repair_identity_unstable",
    message: failure.message
  };
}
function accessDenial(failure) {
  if (failure.code === "journal_lock_unavailable") return { code: "repair_lock_unavailable", message: failure.message };
  if (failure.code === "journal_lock_failed") return { code: "repair_lock_failed", message: failure.message };
  return identityDenial({ code: failure.code, message: failure.message });
}
function reconcileWithin(opts, io, denial, journalPath, authority) {
  const journalIo = authority !== null ? authority.bind(io) : io;
  const scan = scanReceiptJournal(journalPath, journalIo);
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
    const refusal = denial ?? identityDenial(lostAuthority);
    checkpoint_repair.failure = { code: refusal.code, message: refusal.message };
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
        const currentScan = scanReceiptJournal(journalPath, journalIo);
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
  "src/domains/telemetry/receipt-reconcile.ts"() {
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

// src/domains/telemetry/debug-bundle.ts
var DEBUG_BUNDLE_SECTION_KINDS;
var init_debug_bundle = __esm({
  "src/domains/telemetry/debug-bundle.ts"() {
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

// src/domains/telemetry/receipt-journal-conformance-evaluator.ts
function freezeDeep(value) {
  const seen = /* @__PURE__ */ new Set();
  const walk2 = (node) => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    Object.freeze(node);
    for (const key of Object.keys(node)) {
      walk2(node[key]);
    }
  };
  walk2(value);
  return value;
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
  const dir = path20.join(parent, name);
  fs16.mkdirSync(dir, { recursive: true });
  return { dir, journal: path20.join(dir, JOURNAL_LEAF), checkpoint: path20.join(dir, CHECKPOINT_LEAF) };
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
    appendLine(journalPath, text, bound) {
      realIo.appendLine(journalPath, text.slice(0, cutAfterBytes), bound);
      throw new Error("receipt persistence was interrupted before the record was complete");
    }
  };
}
function layDownSealedJournal(port, paths, records, runId) {
  fs16.writeFileSync(paths.journal, `${records.map((record) => JSON.stringify(record)).join("\n")}
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
  fs16.writeFileSync(paths.checkpoint, `${JSON.stringify(checkpoint, null, 2)}
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
  const lockPath = port.journalLockPath(paths);
  const lockFailure = port.acquireJournalLock(lockPath, port.defaultJournalIo, {
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
      if (lockFailure === null) port.releaseJournalLock(lockPath, port.defaultJournalIo);
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
var fs16, path20, MH06_OWNER_KEY, MH06_SCENARIO_IDS, MH06_CATEGORY, MH06_EVIDENCE_PROFILE, MH06_EXPECTED_OUTCOMES, EVIDENCE_FRESHNESS_VERDICTS, EVIDENCE_IDENTITY_FIELDS, MH06_WAVE_OWNER, MH06_SCENARIOS, MH06_PRODUCTION_JOURNAL, MH06_REFUSAL_CONTROLS, MH06_SOURCE_VERSION, PROBE_RECORDED_AT, PROBE_RECONCILED_AT, TORN_APPEND_CUT_BYTES, PROBE_DIRS, JOURNAL_LEAF, CHECKPOINT_LEAF, CHECKPOINT_SCHEMA, PROBES;
var init_receipt_journal_conformance_evaluator = __esm({
  "src/domains/telemetry/receipt-journal-conformance-evaluator.ts"() {
    fs16 = __toESM(require("node:fs"));
    path20 = __toESM(require("node:path"));
    init_receipt_journal();
    init_receipt_reconcile();
    MH06_OWNER_KEY = "W1/MH-06";
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

// src/domains/telemetry/guild-trace-events.ts
var ANALYSIS_EVENT_CLASSES, GUILD_TRACE_SCHEMA_VERSIONS;
var init_guild_trace_events = __esm({
  "src/domains/telemetry/guild-trace-events.ts"() {
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
  }
});

// src/domains/telemetry/guild-trace-emit.ts
var init_guild_trace_emit = __esm({
  "src/domains/telemetry/guild-trace-emit.ts"() {
    init_guild_trace_events();
  }
});

// src/domains/telemetry/task-cell-telemetry.ts
var TASK_CELL_LIFECYCLE_EVENTS, EVENT_NAMES;
var init_task_cell_telemetry = __esm({
  "src/domains/telemetry/task-cell-telemetry.ts"() {
    init_kernel();
    init_state();
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

// src/domains/telemetry/run-analysis.ts
var REQUIRED_COVERAGE, COMPLETENESS_REQUIREMENTS, EVENT_CLASS_CATEGORY;
var init_run_analysis = __esm({
  "src/domains/telemetry/run-analysis.ts"() {
    init_state();
    init_guild_trace_events();
    init_state();
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

// src/domains/telemetry/index.ts
var init_telemetry = __esm({
  "src/domains/telemetry/index.ts"() {
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

// src/domains/config/settings-resolver.ts
var init_settings_resolver = __esm({
  "src/domains/config/settings-resolver.ts"() {
    init_settings_reader();
    init_settings_reader();
    init_telemetry();
    init_telemetry();
    init_state();
  }
});

// src/domains/config/workspace-mode.ts
var init_workspace_mode = __esm({
  "src/domains/config/workspace-mode.ts"() {
    init_settings_resolver();
  }
});

// src/domains/config/tier-model.ts
var init_tier_model = __esm({
  "src/domains/config/tier-model.ts"() {
    init_host_id_namespace();
  }
});

// src/domains/config/catalog-cache.ts
var MODEL_CATALOG_CACHE_DIRNAME, MODEL_CATALOG_CACHE_REL_SEGMENTS, MODEL_CATALOG_CACHE_REL, CACHE_KEY_COMPONENTS;
var init_catalog_cache = __esm({
  "src/domains/config/catalog-cache.ts"() {
    init_state();
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

// src/domains/config/compatibility-usage.ts
var COMPATIBILITY_ASSET_KINDS, COMPATIBILITY_READ_REASONS, BENIGN_COMPATIBILITY_READ_REASONS, DEPENDENCE_COMPATIBILITY_READ_REASONS, BENIGN_REASON_SET, READ_REASON_SET, ASSET_KIND_SET, RESOLVER_MODE_SET;
var init_compatibility_usage = __esm({
  "src/domains/config/compatibility-usage.ts"() {
    init_config_defaults();
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

// src/domains/config/resolver-mode.ts
var RESOLVER_AUTHORITIES, CAPABILITY_RESOLUTION_INTENTS, MODE_POLICIES, RESOLVER_MODE_POLICIES, MODE_RANK, RESOLVER_MODE_FAILURES, RESOLVER_MODE_FAILURE_SET, MODE_TRANSITION_DIRECTIONS;
var init_resolver_mode = __esm({
  "src/domains/config/resolver-mode.ts"() {
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

// src/domains/config/compatibility-catalog.ts
var SHIPPED_TEMPLATE_COUNT, SHIPPED_DOMAIN_SKILL_IDS, SHIPPED_DOMAIN_SKILL_COUNT, SHIPPED_COMPATIBILITY_ASSET_COUNT, COMPATIBILITY_ASSET_ROOTS, COMPATIBILITY_DEPRECATION_STATES, DEPRECATION_STATE_SET;
var init_compatibility_catalog = __esm({
  "src/domains/config/compatibility-catalog.ts"() {
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

// src/domains/config/confirmation-arbiter.ts
var CONFIRMATION_KEY_COMPONENTS;
var init_confirmation_arbiter = __esm({
  "src/domains/config/confirmation-arbiter.ts"() {
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

// src/domains/config/independence-predicates.ts
var init_independence_predicates = __esm({
  "src/domains/config/independence-predicates.ts"() {
  }
});

// src/domains/config/independence-record.ts
var init_independence_record = __esm({
  "src/domains/config/independence-record.ts"() {
    init_independence_predicates();
    init_state();
  }
});

// src/domains/config/model-catalog.ts
var EVIDENCE_STATES, NO_LISTING_GROUNDING, LISTING_AUTHORITY, LEGAL_EVIDENCE_TRANSITIONS;
var init_model_catalog = __esm({
  "src/domains/config/model-catalog.ts"() {
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

// src/domains/config/model-resolver.ts
var FALLBACK_FAILURE_TAXONOMY, RESOLUTION_STATUSES;
var init_model_resolver = __esm({
  "src/domains/config/model-resolver.ts"() {
    init_kernel();
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

// src/domains/config/model-inspect.ts
var init_model_inspect = __esm({
  "src/domains/config/model-inspect.ts"() {
    init_model_resolver();
    init_independence_predicates();
  }
});

// src/domains/config/inspection-persist.ts
var init_inspection_persist = __esm({
  "src/domains/config/inspection-persist.ts"() {
    init_model_inspect();
    init_state();
  }
});

// src/domains/config/routing-rollout.ts
var ROUTING_FLAG_KEYS, ROUTING_FLAG_DEFAULTS, FLAG_GROUPS;
var init_routing_rollout = __esm({
  "src/domains/config/routing-rollout.ts"() {
    init_kernel();
    init_state();
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

// src/domains/config/models-command.ts
var MODELS_COMMAND_USAGE;
var init_models_command = __esm({
  "src/domains/config/models-command.ts"() {
    init_session_context();
    init_security();
    init_catalog_cache();
    init_model_inspect();
    init_session_binding();
    init_routing_rollout();
    init_state();
    init_state();
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

// src/domains/config/inspection-record.ts
var init_inspection_record = __esm({
  "src/domains/config/inspection-record.ts"() {
    init_model_inspect();
    init_inspection_persist();
    init_models_command();
  }
});

// src/domains/config/policy-migration.ts
var LEGACY_FILLABLE_PURPOSES;
var init_policy_migration = __esm({
  "src/domains/config/policy-migration.ts"() {
    init_model_policy();
    init_state();
    LEGACY_FILLABLE_PURPOSES = Object.freeze(["general", "implementation"]);
  }
});

// src/domains/config/purpose-provenance.ts
var AUTHORITATIVE_PURPOSE_SOURCES;
var init_purpose_provenance = __esm({
  "src/domains/config/purpose-provenance.ts"() {
    init_model_policy();
    AUTHORITATIVE_PURPOSE_SOURCES = Object.freeze([
      "skill_metadata",
      "registry_metadata",
      "lane_lock",
      "broker_gate"
    ]);
  }
});

// src/domains/config/tier-defaults.ts
var init_tier_defaults = __esm({
  "src/domains/config/tier-defaults.ts"() {
    init_host_registry_schema();
    init_host_id_namespace();
  }
});

// src/domains/config/rank.ts
var init_rank = __esm({
  "src/domains/config/rank.ts"() {
    init_host_id_namespace();
    init_tier_defaults();
  }
});

// src/domains/config/role-model-schema.ts
var ROLES, ROLE_STRENGTHS, ROLE_SET, STRENGTH_SET, HOST_ID_SET3;
var init_role_model_schema = __esm({
  "src/domains/config/role-model-schema.ts"() {
    init_host_registry_schema();
    ROLES = Object.freeze(["host", "advisory", "adversarial"]);
    ROLE_STRENGTHS = Object.freeze(["strong", "weak"]);
    ROLE_SET = new Set(ROLES);
    STRENGTH_SET = new Set(ROLE_STRENGTHS);
    HOST_ID_SET3 = new Set(HOST_IDS);
  }
});

// src/domains/config/role-resolver.ts
var ADVISORY_SUBSTRATES;
var init_role_resolver = __esm({
  "src/domains/config/role-resolver.ts"() {
    init_host_registry_schema();
    init_role_model_schema();
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
  }
});

// src/domains/config/tiebreak.ts
var init_tiebreak = __esm({
  "src/domains/config/tiebreak.ts"() {
    init_rank();
  }
});

// src/domains/config/router.ts
var init_router = __esm({
  "src/domains/config/router.ts"() {
    init_tier_model();
    init_rank();
    init_tiebreak();
  }
});

// src/domains/config/compose-prompt.ts
var MODEL_FAMILIES, HOST_FAMILY_TOKENS_PROMPT, HOST_FAMILY_RE, YOU_ARE_HOST_RE, USING_GUILD_BASE_RELS;
var init_compose_prompt = __esm({
  "src/domains/config/compose-prompt.ts"() {
    MODEL_FAMILIES = Object.freeze(["anthropic", "openai", "google"]);
    HOST_FAMILY_TOKENS_PROMPT = Object.freeze([
      "claude",
      "codex",
      "cursor",
      "gemini",
      "copilot",
      "windsurf",
      "aider",
      "antigravity",
      "cline",
      "zed"
    ]);
    HOST_FAMILY_RE = new RegExp(`\\b(${HOST_FAMILY_TOKENS_PROMPT.join("|")})\\b`, "i");
    YOU_ARE_HOST_RE = new RegExp(
      `\\byou(?:'re| are)\\s+(?:an?\\s+)?(${HOST_FAMILY_TOKENS_PROMPT.join("|")})\\b`,
      "i"
    );
    USING_GUILD_BASE_RELS = Object.freeze([
      "skills/meta/using-guild/SKILL.md",
      "skills/meta/using-guild/SKILL.src.md"
    ]);
  }
});

// src/domains/config/team-prompt.ts
var init_team_prompt = __esm({
  "src/domains/config/team-prompt.ts"() {
    init_host_id_namespace();
  }
});

// src/domains/config/init-scaffold-manifest.ts
var STANDARD_ROOT_FLOOR, WORKSPACE_EXTRAS, singleProject, workspaceRoot, repairRequired;
var init_init_scaffold_manifest = __esm({
  "src/domains/config/init-scaffold-manifest.ts"() {
    init_kernel();
    STANDARD_ROOT_FLOOR = deepFreeze([
      {
        path: ".guild/guild.yaml",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: true,
        version: "guild.root.v1",
        description: "Guild root identity and kind (workspace or project)."
      },
      {
        path: ".guild/agents/registry.yaml",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: false,
        version: "guild.agents_registry.v1",
        lazy: true,
        description: "Project/workspace-shared specialist agent registry."
      },
      {
        path: ".guild/skills/registry.yaml",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: false,
        version: "guild.skills_registry.v1",
        lazy: true,
        description: "Project/workspace-shared skill registry."
      },
      {
        path: ".guild/workflows/registry.yaml",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: false,
        version: "guild.workflows_registry.v1",
        lazy: true,
        description: "Repeatable project/workspace workflow registry."
      },
      {
        path: ".guild/loops/registry.yaml",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: false,
        version: "guild.loops_registry.v1",
        lazy: true,
        description: "Custom loop registry."
      },
      {
        path: ".guild/init/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Holds per-run init records (.guild/init/<slug>.md). The dir is the requirement; the slug file is per-run."
      },
      {
        path: ".guild/wiki/index.md",
        kind: "file",
        source: "template",
        clobber: "never",
        repair_required: false,
        version: "guild.wiki_index.v1",
        lazy: true,
        description: "Wiki entrypoint; user-authored knowledge accretes here."
      },
      {
        path: ".guild/knowledge/sources/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: 'Ingested source blobs \u2014 GuildStorage.definition("sources", <id>) (KTD47/R59). Replaces the retired raw tree.'
      },
      {
        path: ".guild/config/project.json",
        kind: "file",
        source: "generated",
        clobber: "reconcile-only",
        repair_required: true,
        version: "guild.policy_config.v1",
        description: "Project POLICY config \u2014 the closed key set only (KTD22). Host family, host id, and concrete model names are refused here at write AND at read; they are session state on the run record."
      },
      {
        path: ".guild/settings.json",
        kind: "file",
        source: "generated",
        clobber: "reconcile-only",
        repair_required: true,
        version: "guild.settings.v2",
        description: "Project settings. ONLY config reconcile/sync/repair + scoped write APIs may change it (never init/repair wholesale)."
      },
      {
        path: ".guild/knowledge/graph/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Structured knowledge graph artifacts."
      },
      {
        path: ".guild/knowledge/indexes/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Structured knowledge indexes."
      },
      {
        path: ".guild/knowledge/candidates/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Human-gated knowledge promotion candidates."
      },
      {
        path: ".guild/memory/summaries/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Durable summarized memory promoted from runs."
      },
      {
        path: ".guild/memory/lessons/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Reusable lessons promoted from reflections and run analysis."
      },
      {
        path: ".guild/memory/recall-index.json",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: false,
        version: "guild.recall_index.v1",
        lazy: true,
        description: "Project/workspace recall index placeholder."
      },
      {
        path: ".guild/initiatives/active/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Active initiative records."
      },
      {
        path: ".guild/initiatives/archived/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Archived initiative records."
      },
      {
        path: ".guild/initiatives/registry.yaml",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: false,
        version: "guild.initiatives_registry.v1",
        lazy: true,
        description: "Initiative registry for this Guild root."
      },
      {
        path: ".guild/runs/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Run records and replay evidence."
      },
      {
        path: ".guild/teams/registry.yaml",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: false,
        version: "guild.teams_registry.v1",
        lazy: true,
        description: "Reusable team composition registry."
      },
      {
        path: ".guild/artifacts/reports/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Shared reports not yet promoted to wiki/memory."
      },
      {
        path: ".guild/artifacts/audits/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Shared audit outputs."
      },
      {
        path: ".guild/artifacts/handoffs/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Shared handoff artifacts."
      },
      {
        path: ".guild/artifacts/generated/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Generated artifacts reviewed for sharing."
      },
      {
        path: ".guild/workspace/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Workspace relationship files; inert for standalone projects."
      },
      {
        path: ".guild/hosts/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Host-local capability state. Usually ignored unless explicitly shared."
      },
      {
        path: ".guild/indexes/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Compatibility home for existing Guild index artifacts."
      },
      {
        path: ".guild/indexes/codebase-map.json",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: false,
        version: "guild.codebase_map.v1",
        lazy: true,
        description: "Cheap-scan CodebaseMap produced by init/learn-map."
      },
      {
        path: ".guild/indexes/architecture-map.md",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: false,
        version: "guild.architecture_map.v1",
        lazy: true,
        description: "Brownfield-only architecture-map stub. Seeded for brownfield init; absence is not a broken install."
      }
    ]);
    WORKSPACE_EXTRAS = deepFreeze([
      {
        path: ".guild/config/workspace.json",
        kind: "file",
        source: "generated",
        clobber: "reconcile-only",
        repair_required: true,
        version: "guild.policy_config.v1",
        description: "Workspace POLICY config \u2014 the closed key set only (KTD22), inherited by children. Host and model identity are refused here; they are bound per session on the run record."
      },
      {
        path: ".guild/workspace.json",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: true,
        version: "guild.workspace.v1",
        description: "Workspace federation manifest. Its presence + is_workspace:true is what makes this root a workspace_root."
      },
      {
        path: ".guild/workspace/workspace.yaml",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: true,
        version: "guild.workspace_root.v1",
        description: "Human-readable workspace root descriptor."
      },
      {
        path: ".guild/workspace/children.yaml",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: false,
        version: "guild.workspace_children.v1",
        lazy: true,
        description: "Workspace child project registry."
      },
      {
        path: ".guild/workspace/relationships.yaml",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: false,
        version: "guild.workspace_relationships.v1",
        lazy: true,
        description: "Cross-project relationship and release-coupling registry."
      },
      {
        path: ".guild/workspace-knowledge/",
        kind: "dir",
        source: "empty-dir",
        clobber: "never",
        repair_required: false,
        lazy: true,
        description: "Cross-project coordination knowledge (workspace-only)."
      },
      {
        path: ".guild/indexes/initiatives-registry.yaml",
        kind: "file",
        source: "generated",
        clobber: "never",
        repair_required: false,
        version: "guild.initiatives_registry.v1",
        lazy: true,
        description: "Workspace initiative registry (scope resolution for initiative_default inheritance)."
      }
    ]);
    singleProject = Object.freeze([...STANDARD_ROOT_FLOOR]);
    workspaceRoot = Object.freeze([...STANDARD_ROOT_FLOOR, ...WORKSPACE_EXTRAS]);
    repairRequired = Object.freeze(
      STANDARD_ROOT_FLOOR.filter((e) => e.repair_required)
    );
  }
});

// src/domains/config/init-config-copy.ts
var init_init_config_copy = __esm({
  "src/domains/config/init-config-copy.ts"() {
  }
});

// src/domains/config/host-open-preflight.ts
var CLI_NATIVE_HOSTS;
var init_host_open_preflight = __esm({
  "src/domains/config/host-open-preflight.ts"() {
    init_kernel();
    init_init_scaffold_manifest();
    init_workspace_manifest();
    init_init_config_copy();
    init_state();
    CLI_NATIVE_HOSTS = sealSet([
      "claude-code-cli",
      "codex-cli",
      "pi-cli",
      "antigravity-cli",
      "agents-file",
      // verified-multi-host new-CLI hosts
      "cursor",
      "github-copilot",
      "opencode",
      "rovo-dev",
      // verified-multi-host new-IDE hosts (file surface, agents-file bound)
      "kiro",
      "qoder",
      "trae"
    ], "CLI_NATIVE_HOSTS");
  }
});

// src/domains/config/index.ts
var init_config2 = __esm({
  "src/domains/config/index.ts"() {
    init_host_id_namespace();
    init_adapter_fallback_ladders();
    init_host_profiles_validate();
    init_host_registry();
    init_host_registry_schema();
    init_host_adapter_contract();
    init_provider_detect();
    init_session_context();
    init_model_discovery_contract();
    init_config_defaults();
    init_policy_keys();
    init_policy_resolver();
    init_session_binding();
    init_config_validation();
    init_settings_resolver();
    init_workspace_mode();
    init_tier_model();
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
    init_compose_prompt();
    init_team_prompt();
    init_adapter_fallback_ladders();
    init_host_adapter_contract();
    init_host_capabilities_schema();
    init_host_id_namespace();
    init_host_open_preflight();
    init_host_profiles_validate();
    init_host_registry_schema();
    init_host_registry();
    init_init_scaffold_manifest();
    init_models_command();
    init_settings_reader();
  }
});

// scripts/lib/state/upgrade-chain.ts
var upgrade_chain_exports = {};
__export(upgrade_chain_exports, {
  runLayoutUpgrade: () => runLayoutUpgrade
});
module.exports = __toCommonJS(upgrade_chain_exports);
init_state();
init_config2();

// scripts/dot-guild/convert/index.ts
var path26 = __toESM(require("path"));

// scripts/dot-guild/convert/seams.ts
var fs17 = __toESM(require("fs"));
var crypto5 = __toESM(require("crypto"));
var path21 = __toESM(require("path"));
var yaml2 = require_js_yaml();
var realFs = {
  existsSync: (p) => fs17.existsSync(p),
  readFileSync: (p) => fs17.readFileSync(p, "utf8"),
  readBytes: (p) => fs17.readFileSync(p),
  writeFileSync: (p, data) => {
    fs17.mkdirSync(path21.dirname(p), { recursive: true });
    fs17.writeFileSync(p, data, "utf8");
  },
  writeBytes: (p, data) => {
    fs17.mkdirSync(path21.dirname(p), { recursive: true });
    fs17.writeFileSync(p, data);
  },
  mkdirSync: (p, opts) => {
    fs17.mkdirSync(p, opts.recursive ? { recursive: true } : void 0);
  },
  rmFileSync: (p) => fs17.rmSync(p, { force: true }),
  readdirSync: (p) => fs17.readdirSync(p, { withFileTypes: true }).map((e) => ({
    name: e.name,
    isDirectory: e.isDirectory(),
    isFile: e.isFile()
  })),
  isSymlink: (p) => {
    try {
      return fs17.lstatSync(p).isSymbolicLink();
    } catch {
      return false;
    }
  },
  sha256: (p) => crypto5.createHash("sha256").update(fs17.readFileSync(p)).digest("hex")
};
var realClock = {
  stamp: () => isoToStamp((/* @__PURE__ */ new Date()).toISOString()),
  iso: () => (/* @__PURE__ */ new Date()).toISOString()
};
function isoToStamp(iso) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return iso.replace(/[^0-9A-Za-z]/g, "");
  const [, y, mo, d, h, mi, s] = m;
  return `${y}${mo}${d}T${h}${mi}${s}Z`;
}
function parseJson(content) {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
function parseYaml2(content) {
  try {
    const value = yaml2.load(content);
    return { ok: true, value: value === void 0 ? null : value };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
function extractSchemaVersion(head) {
  const m = head.match(/schema_version["'\s]*[:=]\s*["']?([A-Za-z0-9_.]+)/);
  return m ? m[1] : null;
}

// scripts/dot-guild/convert/detect.ts
var path22 = __toESM(require("path"));
var SCHEMA_STAMP_RE = /^guild\.[a-z0-9_]+\.v\d+$/;
var P10_SCAN_RE = /schema_version["':\s]+guild\.[a-z0-9_]+\.v\d+/;
var V2_STAMPS = /* @__PURE__ */ new Set([
  "guild.run.v1",
  "guild.provenance.v1",
  "guild.initiatives_registry.v1",
  "guild.workspace.v1",
  "guild.host_capability.v1",
  "guild.reflection.v1"
]);
var P10_HEAD_BYTES = 4096;
var P10_EXTS = /* @__PURE__ */ new Set([".json", ".yaml", ".yml", ".md"]);
function isBackupDir(name) {
  return name.startsWith(".backup-v1-");
}
function isReportFile(name) {
  return name.startsWith(".migration-report-");
}
var WALK_MAX_DEPTH = 25;
var WALK_MAX_NODES = 2e4;
function walk(fs18, dir, excludeDir, base, _depth = 0, _budget = { nodes: 0 }) {
  if (_depth > WALK_MAX_DEPTH) return [];
  if (_budget.nodes >= WALK_MAX_NODES) return [];
  if (!fs18.existsSync(dir)) return [];
  const out = [];
  let entries;
  try {
    entries = fs18.readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (_budget.nodes >= WALK_MAX_NODES) break;
    _budget.nodes += 1;
    const full = path22.join(dir, e.name);
    if (e.isDirectory) {
      if (excludeDir(e.name)) continue;
      const sub = walk(fs18, full, excludeDir, base, _depth + 1, _budget);
      out.push(...sub);
    } else if (e.isFile) {
      out.push(full);
    }
  }
  return out;
}
function v1KeysIn(obj) {
  if (!obj || typeof obj !== "object") return [];
  const rec = obj;
  const hits = [];
  if ("codex_review" in rec) hits.push("codex_review");
  if (typeof rec["auto_approve"] === "string") hits.push("auto_approve");
  const defaults = rec["defaults"];
  if (defaults && typeof defaults === "object" && "agent_team" in defaults) {
    hits.push("defaults.agent_team");
  }
  return hits;
}
function relTo(guildDir, p) {
  return path22.relative(guildDir, p);
}
function readParsed(pr, p, kind, authoritative) {
  if (!pr.fs.existsSync(p)) return void 0;
  let content;
  try {
    content = pr.fs.readFileSync(p);
  } catch {
    pr.unparseable.push({ path: relTo(pr.guildDir, p), authoritative });
    return void 0;
  }
  const res = kind === "json" ? parseJson(content) : parseYaml2(content);
  if (!res.ok) {
    pr.unparseable.push({ path: relTo(pr.guildDir, p), authoritative });
    return void 0;
  }
  return res.value;
}
function detect2(fs18, guildDir) {
  const evidence = [];
  const unparseable = [];
  const pr = { fs: fs18, guildDir, evidence, unparseable };
  const addM1 = (p, marker, note) => evidence.push({ path: relTo(guildDir, p), marker, contributes: "M1", note });
  const addM2 = (p, marker, note) => evidence.push({ path: relTo(guildDir, p), marker, contributes: "M2", note });
  if (!fs18.existsSync(guildDir)) {
    return { classification: "none", m1: false, m2: false, hasUnparseable: false, evidence, unparseable };
  }
  const topFiles = walk(fs18, guildDir, (name) => isBackupDir(name), guildDir);
  if (topFiles.length === 0) {
    return { classification: "none", m1: false, m2: false, hasUnparseable: false, evidence, unparseable };
  }
  const j = (rel3) => path22.join(guildDir, rel3);
  {
    const p = j("settings.json");
    if (fs18.existsSync(p)) {
      addM2(p, "P1", "settings.json exists (v2-only file)");
      const parsed = readParsed(pr, p, "json", true);
      for (const k of v1KeysIn(parsed)) addM1(p, "P1", `v1-only key: ${k}`);
    }
  }
  {
    const p = j("settings.local.json");
    if (fs18.existsSync(p)) {
      addM2(p, "P9", "settings.local.json exists (v2-era surface \u2014 F2)");
      const parsed = readParsed(pr, p, "json", true);
      for (const k of v1KeysIn(parsed)) addM1(p, "P9", `local-only v1 key: ${k}`);
    }
  }
  {
    const p = j("config.yml");
    if (fs18.existsSync(p)) {
      addM1(p, "P2", "config.yml exists (v1-only file)");
      readParsed(pr, p, "yaml", true);
    }
  }
  {
    const p = j(path22.join("indexes", "initiatives-registry.yaml"));
    const parsed = readParsed(pr, p, "yaml", true);
    const sv = svOf(parsed);
    if (sv) {
      if (V2_STAMPS.has(sv) || SCHEMA_STAMP_RE.test(sv)) addM2(p, "P3", `schema_version: ${sv}`);
    }
  }
  {
    const p = j("workspace.json");
    const parsed = readParsed(pr, p, "json", true);
    const sv = svOf(parsed);
    if (sv && (sv === "guild.workspace.v1" || SCHEMA_STAMP_RE.test(sv))) addM2(p, "P4", `schema_version: ${sv}`);
  }
  {
    const runsDir = j("runs");
    if (fs18.existsSync(runsDir)) {
      let runEntries;
      try {
        runEntries = fs18.readdirSync(runsDir);
      } catch {
        runEntries = [];
      }
      for (const e of runEntries) {
        if (!e.isDirectory) continue;
        const runDir = path22.join(runsDir, e.name);
        const runYaml = path22.join(runDir, "run.yaml");
        const meta = path22.join(runDir, "metadata.json");
        const hasRunYaml = fs18.existsSync(runYaml);
        if (hasRunYaml) {
          const parsed = readParsed(pr, runYaml, "yaml", true);
          const sv = svOf(parsed);
          if (sv === "guild.run.v1" || sv && SCHEMA_STAMP_RE.test(sv)) addM2(runYaml, "P5", `schema_version: ${sv}`);
          else addM2(runYaml, "P5", "run.yaml present (v2 run manifest)");
        }
        if (fs18.existsSync(meta) && !hasRunYaml) {
          addM1(meta, "P6", "metadata.json without sibling run.yaml (v1 run record)");
          readParsed(pr, meta, "json", true);
        }
      }
    }
  }
  {
    const hostsDir = j("hosts");
    if (fs18.existsSync(hostsDir)) {
      let hostEntries;
      try {
        hostEntries = fs18.readdirSync(hostsDir);
      } catch {
        hostEntries = [];
      }
      for (const e of hostEntries) {
        if (!e.isDirectory) continue;
        const cap = path22.join(hostsDir, e.name, "capability.json");
        const parsed = readParsed(pr, cap, "json", false);
        const sv = svOf(parsed);
        if (sv && (sv === "guild.host_capability.v1" || SCHEMA_STAMP_RE.test(sv))) addM2(cap, "P7", `schema_version: ${sv}`);
      }
    }
  }
  {
    const refDir = j("reflections");
    if (fs18.existsSync(refDir)) {
      let refEntries;
      try {
        refEntries = fs18.readdirSync(refDir);
      } catch {
        refEntries = [];
      }
      for (const e of refEntries) {
        if (!e.isFile || !e.name.endsWith(".md")) continue;
        const p = path22.join(refDir, e.name);
        let head = "";
        try {
          head = fs18.readFileSync(p).slice(0, P10_HEAD_BYTES);
        } catch {
          continue;
        }
        const sv = extractSchemaVersion(head);
        if (sv && (sv === "guild.reflection.v1" || SCHEMA_STAMP_RE.test(sv))) addM2(p, "P8", `schema_version: ${sv}`);
      }
    }
  }
  {
    const p = j("project.yaml");
    const parsed = readParsed(pr, p, "yaml", true);
    if (hasWikiShareMode(parsed)) addM1(p, "P11", "project.yaml wiki.share_mode (v1 key \u2014 RF1)");
  }
  {
    const files = walk(
      fs18,
      guildDir,
      (name) => isBackupDir(name),
      guildDir
    );
    for (const f of files) {
      const base = path22.basename(f);
      const ext = path22.extname(f).toLowerCase();
      if (isBackupDir(base) || isReportFile(base)) continue;
      if (base === "events.ndjson" || f.includes(`${path22.sep}logs${path22.sep}`) || ext === ".jsonl") continue;
      if (!P10_EXTS.has(ext)) continue;
      let head = "";
      try {
        head = fs18.readFileSync(f).slice(0, P10_HEAD_BYTES);
      } catch {
        continue;
      }
      if (P10_SCAN_RE.test(head)) {
        const sv = extractSchemaVersion(head) ?? "guild.*.vN";
        addM2(f, "P10", `generic scan hit: ${sv}`);
      }
    }
  }
  const hasUnparseable = unparseable.some((u) => u.authoritative);
  if (hasUnparseable) {
    return { classification: "corrupt", m1: false, m2: false, hasUnparseable: true, evidence, unparseable };
  }
  const m1 = evidence.some((e) => e.contributes === "M1");
  const m2 = evidence.some((e) => e.contributes === "M2");
  let classification;
  if (m2 && !m1) classification = "v2";
  else if (m1 && !m2) classification = "v1";
  else if (m1 && m2) classification = "mixed";
  else classification = "none";
  return { classification, m1, m2, hasUnparseable: false, evidence, unparseable };
}
function svOf(parsed) {
  if (parsed && typeof parsed === "object" && "schema_version" in parsed) {
    const v = parsed["schema_version"];
    return typeof v === "string" ? v : null;
  }
  return null;
}
function hasWikiShareMode(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  const rec = parsed;
  const wiki = rec["wiki"];
  if (wiki && typeof wiki === "object" && "share_mode" in wiki) return true;
  if ("wiki.share_mode" in rec) return true;
  return false;
}

// scripts/dot-guild/convert/snapshot.ts
var path23 = __toESM(require("path"));
var BACKUP_PREFIX = ".backup-v1-";
var REPORT_PREFIX = ".migration-report-";
function walkExcluding(fs18, guildDir, destAbs) {
  const out = [];
  const recur = (dir) => {
    let entries;
    try {
      entries = fs18.readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path23.join(dir, e.name);
      if (full === destAbs) continue;
      if (e.isDirectory) {
        if (e.name.startsWith(BACKUP_PREFIX)) continue;
        recur(full);
      } else if (e.isFile) {
        if (e.name.startsWith(REPORT_PREFIX) && dir === guildDir) continue;
        out.push(full);
      }
    }
  };
  recur(guildDir);
  return out;
}
function claimDest(fs18, guildDir, stamp) {
  const base = path23.join(guildDir, `${BACKUP_PREFIX}${stamp}`);
  let dest = base;
  let n = 1;
  for (let attempts = 0; attempts < 64; attempts++) {
    try {
      fs18.mkdirSync(dest, { recursive: false });
      return dest;
    } catch {
      if (n <= 16) {
        dest = `${base}-${n++}`;
      } else {
        const rand = Math.random().toString(36).slice(2, 8);
        dest = `${base}-${rand}`;
      }
    }
  }
  throw new Error(`snapshot: could not claim a unique backup dir under ${guildDir}`);
}
function snapshot(fs18, clock, guildDir) {
  const dest = claimDest(fs18, guildDir, clock.stamp());
  const destAbs = dest;
  const destRel = path23.basename(dest);
  const files = walkExcluding(fs18, guildDir, destAbs);
  let mismatch;
  let copied = 0;
  for (const srcFile of files) {
    const rel3 = path23.relative(guildDir, srcFile);
    const dstFile = path23.join(dest, rel3);
    const srcHash = fs18.sha256(srcFile);
    const bytes = fs18.readBytes(srcFile);
    fs18.writeBytes(dstFile, bytes);
    const dstHash = fs18.sha256(dstFile);
    if (srcHash !== dstHash) {
      mismatch = rel3;
      break;
    }
    copied++;
  }
  return {
    dest: destAbs,
    destRel,
    verified: mismatch === void 0,
    fileCount: copied,
    mismatch
  };
}

// scripts/dot-guild/convert/convert.ts
var path25 = __toESM(require("path"));

// scripts/dot-guild/convert/wiki-importance.ts
var path24 = __toESM(require("path"));
init_kernel();

// scripts/lib/frontmatter.ts
init_state();
var parseYaml3 = parseYaml;

// scripts/dot-guild/convert/wiki-importance.ts
var GRADED_BY_STAMP = "guild-migrate";
var STRUCTURAL_BASENAMES2 = sealSet(["index.md", "readme.md", "log.md", "query.md", "transfer-manifest.md"], "STRUCTURAL_BASENAMES");
var PROVENANCE_SEGMENTS = /* @__PURE__ */ new Set(["research", "ideation", "sources"]);
var PROVENANCE_FM_VALUES = /* @__PURE__ */ new Set(["provenance", "exploratory", "research", "ideation", "source"]);
function splitFrontmatter3(content) {
  if (content.slice(0, 3) !== "---") return { fmLines: null, body: content };
  const lines = content.split("\n");
  if (lines[0].trim() !== "---") return { fmLines: null, body: content };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return { fmLines: lines.slice(1, i), body: lines.slice(i + 1).join("\n") };
    }
  }
  return { fmLines: null, body: content };
}
function fmValue2(fmLines, key) {
  if (!fmLines) return null;
  const doc = parseYaml3(fmLines.join("\n"));
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const v = doc[key];
  return v === void 0 || v === null ? null : String(v);
}
function isProvenance2(relInWiki, fmLines) {
  const segments = relInWiki.split(path24.sep).slice(0, -1).map((s) => s.toLowerCase());
  if (segments.some((s) => PROVENANCE_SEGMENTS.has(s))) return true;
  for (const key of ["type", "category"]) {
    const v = fmValue2(fmLines, key)?.toLowerCase();
    if (v && PROVENANCE_FM_VALUES.has(v)) return true;
  }
  return false;
}
function draftGrade(relInWiki, fmLines) {
  const first = relInWiki.split(path24.sep)[0].toLowerCase();
  const base = path24.basename(relInWiki).toLowerCase();
  if (first === "standards") return { grade: "high", rule: "standards/** \u2192 high" };
  if (base === "architecture-map.md" || relInWiki.toLowerCase().includes("architecture-map"))
    return { grade: "high", rule: "architecture-map \u2192 high" };
  if (first === "decisions") return { grade: "high", rule: "decisions/** \u2192 high" };
  if (fmValue2(fmLines, "type")?.toLowerCase() === "decision")
    return { grade: "high", rule: "type: decision \u2192 high" };
  return { grade: "medium", rule: "default \u2192 medium" };
}
function walkWiki(fs18, wikiDir) {
  const out = [];
  const recur = (dir) => {
    let entries;
    try {
      entries = fs18.readdirSync(dir);
    } catch {
      return;
    }
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path24.join(dir, e.name);
      if (e.isDirectory) recur(full);
      else if (e.isFile && e.name.endsWith(".md")) out.push(full);
    }
  };
  recur(wikiDir);
  return out.sort();
}
function isStructural(basename11) {
  const b = basename11.toLowerCase();
  return STRUCTURAL_BASENAMES2.has(b) || b.startsWith("lint-");
}
function backfillWikiImportance(fs18, guildDir, dryRun) {
  const wikiDir = path24.join(guildDir, "wiki");
  const records = [];
  if (!fs18.existsSync(wikiDir)) return records;
  for (const p of walkWiki(fs18, wikiDir)) {
    const rel3 = path24.relative(guildDir, p);
    const relInWiki = path24.relative(wikiDir, p);
    if (isStructural(path24.basename(p))) {
      records.push({ rel: rel3, action: "skipped-structural", rule: "index/README/log/lint-* \u2192 skip" });
      continue;
    }
    const content = fs18.readFileSync(p);
    const { fmLines } = splitFrontmatter3(content);
    if (fmValue2(fmLines, "importance") !== null) {
      records.push({ rel: rel3, action: "skipped-already-graded", rule: "importance: present \u2192 never touch" });
      continue;
    }
    if (isProvenance2(relInWiki, fmLines)) {
      records.push({
        rel: rel3,
        action: "skipped-provenance",
        rule: "provenance/exploratory \u2192 confidence-graded only, never importance"
      });
      continue;
    }
    const { grade, rule } = draftGrade(relInWiki, fmLines);
    const draftLines = [`importance: ${grade}`, `importance_draft: true`, `graded_by: ${GRADED_BY_STAMP}`];
    if (!dryRun) {
      let next;
      if (fmLines === null) {
        next = `---
${draftLines.join("\n")}
---
${content}`;
      } else {
        const { body } = splitFrontmatter3(content);
        next = `---
${[...fmLines, ...draftLines].join("\n")}
---
${body}`;
      }
      fs18.writeFileSync(p, next);
    }
    records.push({ rel: rel3, action: "graded", grade, rule, createdFrontmatter: fmLines === null });
  }
  return records;
}

// scripts/dot-guild/convert/keymap.ts
var UNMIGRATED_STAMP = "guild.unmigrated.v1";
function mapV1Key(v1Key, value) {
  switch (v1Key) {
    case "codex_review":
      return { v1Key, v2Key: "review", v2Value: value === true ? "cross" : "local" };
    case "auto_approve":
      if (typeof value === "string") {
        return { v1Key, v2Key: "auto_approve", v2Value: autoApproveToArray(value) };
      }
      return null;
    case "defaults.agent_team":
      return { v1Key, v2Key: "agent_mode", v2Value: agentTeamToMode(value) };
    case "wiki.share_mode":
      return { v1Key, v2Key: "defaults.wiki.share_mode", v2Value: value };
    default:
      return null;
  }
}
function autoApproveToArray(s) {
  switch (s) {
    case "none":
      return [];
    case "spec-and-plan":
      return ["spec", "plan"];
    case "implementation":
      return ["build"];
    case "all":
      return ["all"];
    default:
      return [];
  }
}
function agentTeamToMode(value) {
  if (value === true || value === "on") return "team";
  if (value === false || value === "off") return "subagent";
  return "auto";
}
function getPath(obj, dotted) {
  if (!obj) return void 0;
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = cur[p];
    } else {
      return void 0;
    }
  }
  return cur;
}
function setPath(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}
function valueEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function classifyKey(v1Key, value, v2Target, inPlace = false) {
  const mapped = mapV1Key(v1Key, value);
  if (!mapped) {
    return {
      outcome: { key: v1Key, case: "C2", detail: `relocated verbatim (value=${JSON.stringify(value)})` },
      relocate: { key: v1Key, value }
    };
  }
  if (mapped.v1Key === mapped.v2Key && inPlace) {
    if (valueEqual(value, mapped.v2Value)) {
      return {
        outcome: {
          key: v1Key,
          case: "C3",
          detail: `${v1Key} already in v2 form ${JSON.stringify(value)}; redundant`
        }
      };
    }
    return {
      outcome: {
        key: v1Key,
        case: "C1",
        detail: `${v1Key} transformed in-place \u2192 ${JSON.stringify(mapped.v2Value)}`
      },
      write: mapped
    };
  }
  const existing = getPath(v2Target, mapped.v2Key);
  if (existing === void 0) {
    return {
      outcome: {
        key: v1Key,
        case: "C1",
        detail: `${v1Key} \u2192 ${mapped.v2Key}=${JSON.stringify(mapped.v2Value)}`
      },
      write: mapped
    };
  }
  if (valueEqual(existing, mapped.v2Value)) {
    return {
      outcome: {
        key: v1Key,
        case: "C3",
        detail: `redundant: ${mapped.v2Key} already = ${JSON.stringify(existing)}; v1 key dropped`
      }
    };
  }
  return {
    outcome: {
      key: v1Key,
      case: "C4",
      detail: `CONFLICT: ${mapped.v2Key}=${JSON.stringify(existing)} vs v1 ${v1Key}=${JSON.stringify(
        value
      )} \u2192 kept LIVE, unresolved`
    }
  };
}
function buildUnmigratedDoc(createdAt, snapshotRef, entries) {
  const doc = {
    schema_version: UNMIGRATED_STAMP,
    created_at: createdAt,
    snapshot_ref: snapshotRef,
    entries
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

// scripts/dot-guild/convert/convert.ts
function rel2(guildDir, p) {
  return path25.relative(guildDir, p);
}
function readSettings(fs18, p) {
  if (!fs18.existsSync(p)) return {};
  const res = parseJson(fs18.readFileSync(p));
  return res.ok && res.value && typeof res.value === "object" ? res.value : {};
}
function readKeyValue(parsed, dotted) {
  if (dotted in parsed) return parsed[dotted];
  return getPath(parsed, dotted);
}
function stripKey(obj, dotted) {
  if (dotted in obj) delete obj[dotted];
  const parts = dotted.split(".");
  if (parts.length === 1) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur && typeof cur === "object" && parts[i] in cur) {
      cur = cur[parts[i]];
    } else {
      return;
    }
  }
  if (cur && typeof cur === "object") delete cur[parts[parts.length - 1]];
}
function convert(fs18, clock, guildDir, dryRun, snapshotRef) {
  const out = { artifacts: [], relocated: [], conflicts: [], removed: [], generated: [], grades: [] };
  const ctx = { fs: fs18, clock, guildDir, dryRun, snapshotRef, out };
  const j = (r) => path25.join(guildDir, r);
  const deferredRemovals = [];
  const settingsPath = j("settings.json");
  const v2Settings = readSettings(fs18, settingsPath);
  let settingsMutated = false;
  convertV2SurfaceInPlace(ctx, settingsPath, v2Settings, (mut) => {
    if (mut) settingsMutated = true;
  });
  convertSettingsLocal(ctx, j, guildDir, out);
  {
    const p = j("config.yml");
    if (fs18.existsSync(p)) {
      const res = parseYaml2(fs18.readFileSync(p));
      if (!res.ok || !res.value || typeof res.value !== "object") {
        out.artifacts.push({
          rel: rel2(guildDir, p),
          disposition: "preserve+flag",
          note: "config.yml unparseable at convert time \u2014 preserved"
        });
      } else {
        const parsed = res.value;
        const v1Keys = v1KeysIn(parsed);
        const carryKeys = ["loops", "loop_cap", "codex_cap"].filter((k) => k in parsed);
        const allKeys = [.../* @__PURE__ */ new Set([...v1Keys, ...carryKeys])];
        const { outcomes, mutated } = convertSurfaceWithCarry(
          ctx,
          rel2(guildDir, p),
          parsed,
          v2Settings,
          allKeys
        );
        if (mutated) settingsMutated = true;
        for (const k of Object.keys(parsed)) {
          if (allKeys.includes(k)) continue;
          const handledChildren = allKeys.filter((hk) => hk.startsWith(k + "."));
          if (handledChildren.length === 0) {
            const cls = classifyKey(k, parsed[k], v2Settings);
            outcomes.push(cls.outcome);
            if (cls.write) {
              setPath(v2Settings, cls.write.v2Key, cls.write.v2Value);
              settingsMutated = true;
            }
            if (cls.relocate)
              out.relocated.push({ source: rel2(guildDir, p), key: k, value: parsed[k], reason: "unmapped" });
            if (cls.outcome.case === "C4") out.conflicts.push(cls.outcome);
          } else {
            const remainder = stripHandledLeaves(parsed[k], k, allKeys);
            if (remainder !== void 0) {
              out.relocated.push({ source: rel2(guildDir, p), key: k, value: remainder, reason: "unmapped" });
              outcomes.push({ key: k, case: "C2", detail: `partial parent: unhandled sub-keys relocated (handled: ${handledChildren.join(", ")})` });
            }
          }
        }
        const anyC4 = outcomes.some((o) => o.case === "C4");
        const sourceRemovable = !anyC4;
        out.artifacts.push({
          rel: rel2(guildDir, p),
          disposition: anyC4 ? "preserve+flag" : "convert",
          target: "settings.json",
          keys: outcomes,
          note: anyC4 ? "C4 conflict \u2014 config.yml kept LIVE, tree stays mixed, re-surface next open" : "converted to settings.json; removed from live (snapshot holds original)",
          removed: sourceRemovable
        });
        if (sourceRemovable) {
          if (!dryRun) deferredRemovals.push(p);
          out.removed.push(rel2(guildDir, p));
        }
      }
    }
  }
  {
    const p = j("project.yaml");
    if (fs18.existsSync(p)) {
      const res = parseYaml2(fs18.readFileSync(p));
      if (res.ok && res.value && typeof res.value === "object") {
        const parsed = res.value;
        const shareVal = readKeyValue(parsed, "wiki.share_mode");
        if (shareVal !== void 0) {
          const cls = classifyKey("wiki.share_mode", shareVal, v2Settings);
          const outcomes = [cls.outcome];
          if (cls.write) {
            setPath(v2Settings, cls.write.v2Key, cls.write.v2Value);
            settingsMutated = true;
          }
          const isC4 = cls.outcome.case === "C4";
          if (isC4) out.conflicts.push(cls.outcome);
          if (!isC4 && !dryRun) {
            stripKey(parsed, "wiki.share_mode");
            fs18.writeFileSync(p, serializeYaml(parsed));
          }
          out.artifacts.push({
            rel: rel2(guildDir, p),
            disposition: isC4 ? "preserve+flag" : "convert",
            target: "settings.json:defaults.wiki.share_mode",
            keys: outcomes,
            note: isC4 ? "C4 share_mode conflict \u2014 wiki.share_mode kept LIVE in project.yaml, settings.json NOT clobbered, re-surface" : cls.outcome.case === "C3" ? "redundant share_mode dropped from project.yaml (settings.json authoritative)" : "wiki.share_mode moved to settings.json; key removed from project.yaml",
            removed: false
          });
        }
      }
    }
  }
  convertLegacyRuns(ctx);
  out.grades = backfillWikiImportance(fs18, guildDir, dryRun);
  {
    const graded = out.grades.filter((g) => g.action === "graded");
    if (graded.length > 0) {
      out.artifacts.push({
        rel: "wiki/",
        disposition: "convert",
        target: "wiki/ (importance backfill \u2014 drafted grades)",
        note: `${graded.length} page(s) drafted an importance: grade (importance_draft: true) \u2014 REVIEW, then --accept-grades`,
        removed: false
      });
    }
  }
  if (settingsMutated && !dryRun) {
    const settingsIsNew = !fs18.existsSync(settingsPath);
    fs18.writeFileSync(settingsPath, JSON.stringify(v2Settings, null, 2) + "\n");
    if (settingsIsNew) out.generated.push(rel2(guildDir, settingsPath));
  }
  if (out.relocated.length > 0 && !dryRun) {
    const unmigratedPath = j(".unmigrated-v1.json");
    const isNew = !fs18.existsSync(unmigratedPath);
    let mergedEntries = [];
    if (!isNew) {
      const existing = parseJson(fs18.readFileSync(unmigratedPath));
      if (existing.ok && existing.value && typeof existing.value === "object") {
        const prior = existing.value["entries"];
        if (Array.isArray(prior)) mergedEntries = prior;
      }
    }
    const indexMap = new Map(mergedEntries.map((e, i) => [`${e.source}\0${e.key}`, i]));
    for (const entry of out.relocated) {
      const id = `${entry.source}\0${entry.key}`;
      const existing = indexMap.get(id);
      if (existing !== void 0) {
        mergedEntries[existing] = entry;
      } else {
        indexMap.set(id, mergedEntries.length);
        mergedEntries.push(entry);
      }
    }
    const doc = buildUnmigratedDoc(clock.iso(), snapshotRef, mergedEntries);
    fs18.writeFileSync(unmigratedPath, doc);
    if (isNew) out.generated.push(rel2(guildDir, unmigratedPath));
  }
  for (const p of deferredRemovals) {
    fs18.rmFileSync(p);
  }
  return out;
}
function convertSurfaceWithCarry(ctx, sourceRel, parsed, v2Target, keys) {
  const outcomes = [];
  let mutated = false;
  for (const k of keys) {
    const value = readKeyValue(parsed, k);
    if (k === "loops" || k === "loop_cap" || k === "codex_cap") {
      const existing = getPath(v2Target, k);
      if (existing === void 0) {
        setPath(v2Target, k, normalizeCarry(k, value));
        mutated = true;
        outcomes.push({ key: k, case: "C1", detail: `${k}=${JSON.stringify(normalizeCarry(k, value))}` });
      } else if (valueEqual(existing, normalizeCarry(k, value))) {
        outcomes.push({ key: k, case: "C3", detail: `${k} redundant (already ${JSON.stringify(existing)})` });
      } else {
        outcomes.push({ key: k, case: "C4", detail: `${k} conflict: v2=${JSON.stringify(existing)} vs v1=${JSON.stringify(value)}` });
        ctx.out.conflicts.push(outcomes[outcomes.length - 1]);
      }
      continue;
    }
    const cls = classifyKey(k, value, v2Target);
    outcomes.push(cls.outcome);
    if (cls.write) {
      setPath(v2Target, cls.write.v2Key, cls.write.v2Value);
      mutated = true;
    }
    if (cls.relocate)
      ctx.out.relocated.push({ source: sourceRel, key: cls.relocate.key, value: cls.relocate.value, reason: "unmapped" });
    if (cls.outcome.case === "C4") {
      ctx.out.conflicts.push(cls.outcome);
    }
  }
  return { outcomes, mutated };
}
function normalizeCarry(k, v) {
  if (k === "loop_cap" && typeof v === "number") return Math.min(256, Math.max(1, v));
  if (k === "codex_cap" && typeof v === "number") return Math.min(10, Math.max(1, v));
  return v;
}
function convertSettingsLocal(ctx, j, guildDir, out) {
  const { fs: fs18, dryRun } = ctx;
  const p = j("settings.local.json");
  if (!fs18.existsSync(p)) return;
  const res = parseJson(fs18.readFileSync(p));
  if (!res.ok || !res.value || typeof res.value !== "object") return;
  const parsed = res.value;
  const v1Keys = v1KeysIn(parsed);
  if (v1Keys.length === 0) return;
  const outcomes = [];
  let anyC4 = false;
  let localMutated = false;
  for (const k of v1Keys) {
    const value = readKeyValue(parsed, k);
    const cls = classifyKey(
      k,
      value,
      parsed,
      /*inPlace=*/
      true
    );
    outcomes.push(cls.outcome);
    if (cls.write) {
      setPath(parsed, cls.write.v2Key, cls.write.v2Value);
      if (cls.write.v1Key !== cls.write.v2Key) stripKey(parsed, k);
      localMutated = true;
    } else if (cls.relocate) {
      out.relocated.push({ source: rel2(guildDir, p), key: k, value, reason: "unmapped" });
      stripKey(parsed, k);
      localMutated = true;
    } else if (cls.outcome.case === "C3") {
      stripKey(parsed, k);
      localMutated = true;
    } else if (cls.outcome.case === "C4") {
      anyC4 = true;
      out.conflicts.push(cls.outcome);
    }
  }
  if (localMutated && !dryRun) fs18.writeFileSync(p, JSON.stringify(parsed, null, 2) + "\n");
  out.artifacts.push({
    rel: rel2(guildDir, p),
    disposition: anyC4 ? "preserve+flag" : "convert",
    keys: outcomes,
    note: anyC4 ? "C4 conflict \u2014 deprecated alias kept LIVE in settings.local.json, re-surface" : "v1 keys migrated in place (file is a v2 surface; stays)",
    removed: false
  });
}
function convertV2SurfaceInPlace(ctx, p, v2Obj, onMutate) {
  if (!ctx.fs.existsSync(p)) return;
  const v1Keys = v1KeysIn(v2Obj);
  if (v1Keys.length === 0) return;
  const outcomes = [];
  let anyC4 = false;
  let mutated = false;
  for (const k of v1Keys) {
    const value = readKeyValue(v2Obj, k);
    const mapped = mapV1Key(k, value);
    if (!mapped) {
      ctx.out.relocated.push({ source: rel2(ctx.guildDir, p), key: k, value, reason: "unmapped" });
      stripKey(v2Obj, k);
      mutated = true;
      outcomes.push({ key: k, case: "C2", detail: `relocated verbatim (${JSON.stringify(value)})` });
      continue;
    }
    if (mapped.v1Key === mapped.v2Key) {
      if (valueEqual(value, mapped.v2Value)) {
        outcomes.push({ key: k, case: "C3", detail: `${k} already in v2 form ${JSON.stringify(value)}` });
      } else {
        setPath(v2Obj, mapped.v2Key, mapped.v2Value);
        mutated = true;
        outcomes.push({ key: k, case: "C1", detail: `${k} transformed in-place \u2192 ${JSON.stringify(mapped.v2Value)}` });
      }
      continue;
    }
    const existing = getPath(v2Obj, mapped.v2Key);
    if (existing === void 0) {
      setPath(v2Obj, mapped.v2Key, mapped.v2Value);
      stripKey(v2Obj, k);
      mutated = true;
      outcomes.push({ key: k, case: "C1", detail: `${k} \u2192 ${mapped.v2Key}=${JSON.stringify(mapped.v2Value)}` });
    } else if (valueEqual(existing, mapped.v2Value)) {
      stripKey(v2Obj, k);
      mutated = true;
      outcomes.push({ key: k, case: "C3", detail: `redundant: ${mapped.v2Key} already ${JSON.stringify(existing)}` });
    } else {
      anyC4 = true;
      outcomes.push({
        key: k,
        case: "C4",
        detail: `CONFLICT: ${mapped.v2Key}=${JSON.stringify(existing)} vs v1 ${k}=${JSON.stringify(value)} \u2192 kept LIVE`
      });
      ctx.out.conflicts.push(outcomes[outcomes.length - 1]);
    }
  }
  onMutate(mutated);
  ctx.out.artifacts.push({
    rel: rel2(ctx.guildDir, p),
    disposition: anyC4 ? "preserve+flag" : "convert",
    keys: outcomes,
    note: anyC4 ? "C4 stray-key conflict \u2014 v1 key kept LIVE in settings.json, re-surface" : "stray v1 key(s) rewritten in place to v2 form",
    removed: false
  });
}
function convertLegacyRuns(ctx) {
  const { fs: fs18, guildDir, dryRun } = ctx;
  const runsDir = path25.join(guildDir, "runs");
  if (!fs18.existsSync(runsDir)) return;
  let entries;
  try {
    entries = fs18.readdirSync(runsDir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory) continue;
    const runDir = path25.join(runsDir, e.name);
    const meta = path25.join(runDir, "metadata.json");
    const runYaml = path25.join(runDir, "run.yaml");
    if (!fs18.existsSync(meta) || fs18.existsSync(runYaml)) continue;
    const res = parseJson(fs18.readFileSync(meta));
    if (!res.ok || !res.value || typeof res.value !== "object") {
      ctx.out.artifacts.push({
        rel: rel2(guildDir, meta),
        disposition: "preserve+flag",
        note: "metadata.json unparseable \u2014 preserved",
        removed: false
      });
      continue;
    }
    const m = res.value;
    const runId = m["run_id"] ?? m["id"] ?? e.name;
    const startedAt = m["started_at"] ?? m["created_at"];
    if (!runId || !startedAt) {
      ctx.out.artifacts.push({
        rel: rel2(guildDir, meta),
        disposition: "preserve+flag",
        note: "insufficient fields to reconstruct a faithful run.yaml \u2014 preserved (NOT fabricated)",
        removed: false
      });
      continue;
    }
    const initiativeAttachment = m["initiative_attachment"] ?? m["initiative"] ?? null;
    const provPath = path25.join(runDir, "provenance.json");
    const provExists = fs18.existsSync(provPath);
    const runStatus = m["status"] ?? "closed";
    const runDoc = `schema_version: guild.run.v1
run_id: ${runId}
started_at: ${startedAt}
` + (initiativeAttachment ? `initiative_attachment: ${initiativeAttachment}
` : `initiative_attachment: null
`) + `status: ${runStatus}
`;
    if (provExists) {
      ctx.out.artifacts.push({
        rel: rel2(guildDir, meta),
        disposition: "preserve+flag",
        note: `run-level conflict: provenance.json already exists \u2014 metadata.json kept LIVE, run.yaml NOT written, re-surface next open`,
        removed: false
      });
      continue;
    }
    const provDoc = {
      schema_version: "guild.provenance.v1",
      run_id: runId,
      initiative: initiativeAttachment,
      started_at: startedAt,
      reconstructed_from: "metadata.json",
      status: runStatus
    };
    if (!dryRun) {
      fs18.writeFileSync(runYaml, runDoc);
      fs18.writeFileSync(provPath, JSON.stringify(provDoc, null, 2) + "\n");
      ctx.out.generated.push(rel2(guildDir, runYaml));
      ctx.out.generated.push(rel2(guildDir, provPath));
      fs18.rmFileSync(meta);
    }
    ctx.out.removed.push(rel2(guildDir, meta));
    ctx.out.artifacts.push({
      rel: rel2(guildDir, meta),
      disposition: "convert",
      target: `runs/${e.name}/run.yaml + provenance.json`,
      note: "legacy metadata.json \u2192 run.yaml/provenance reconstructed; metadata.json moved to snapshot",
      removed: true
    });
  }
}
function stripHandledLeaves(obj, prefix, handledKeys) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return obj;
  }
  const rec = obj;
  const result = {};
  for (const [k, v] of Object.entries(rec)) {
    const dotted = `${prefix}.${k}`;
    if (handledKeys.includes(dotted)) continue;
    const handledBelow = handledKeys.filter((hk) => hk.startsWith(dotted + "."));
    if (handledBelow.length > 0) {
      const sub = stripHandledLeaves(v, dotted, handledKeys);
      if (sub !== void 0) result[k] = sub;
    } else {
      result[k] = v;
    }
  }
  return Object.keys(result).length === 0 ? void 0 : result;
}
function serializeYaml(obj) {
  const yaml3 = require_js_yaml();
  return yaml3.dump(obj);
}

// scripts/dot-guild/convert/report.ts
function reportFileName(stamp) {
  return `${REPORT_PREFIX}${stamp}.md`;
}
function detectSummary(d) {
  const m1 = d.evidence.filter((e) => e.contributes === "M1");
  const m2 = d.evidence.filter((e) => e.contributes === "M2");
  const lines = [];
  lines.push(`- **classification:** \`${d.classification}\` (M1=${d.m1}, M2=${d.m2})`);
  if (d.hasUnparseable) {
    lines.push(`- **corrupt:** an authoritative artifact failed to parse \u2014 ALL in-place writes blocked.`);
  }
  if (m1.length) {
    lines.push(`- **v1 evidence (M1):**`);
    for (const e of m1) lines.push(`  - \`${e.path}\` (${e.marker})${e.note ? ` \u2014 ${e.note}` : ""}`);
  }
  if (m2.length) {
    lines.push(`- **v2 evidence (M2):**`);
    for (const e of m2.slice(0, 24)) lines.push(`  - \`${e.path}\` (${e.marker})${e.note ? ` \u2014 ${e.note}` : ""}`);
    if (m2.length > 24) lines.push(`  - \u2026 and ${m2.length - 24} more`);
  }
  if (d.unparseable.length) {
    lines.push(`- **unparseable:**`);
    for (const u of d.unparseable)
      lines.push(`  - \`${u.path}\`${u.authoritative ? " (AUTHORITATIVE \u2014 forces corrupt)" : " (non-authoritative \u2014 preserved)"}`);
  }
  return lines.join("\n");
}
function renderReport(child, mode, iso) {
  const d = child.detect;
  let out = "";
  out += `---
type: artifact
artifact: migration-report
initiative: cleanup-consolidation
`;
  out += `mode: ${mode}
classification: ${d.classification}
created_at: ${iso}
---

`;
  out += `# v1 \u2192 v2 \`.guild\` migration report

`;
  out += `Root: \`${child.root}\`

Mode: **${mode}**${mode === "dry-run" ? " \u2014 NOTHING was written." : ""}

`;
  out += `## Detection

${detectSummary(d)}

`;
  if (d.classification === "corrupt") {
    out += `## Action: BLOCKED (corrupt dominates)

`;
    out += `No migration occurred. An authoritative artifact is unparseable, so the tree's
`;
    out += `state is untrustworthy and ALL in-place writes are refused (\xA71.3 precedence).
`;
    out += `Recommended: run \`--dry-run\`, repair/remove the corrupt file(s) above, re-open.
`;
    if (child.snapshot) out += `
A verified snapshot was still taken at \`${child.snapshot.destRel}\`.
`;
    return out + "\n";
  }
  if (d.classification === "v2" || d.classification === "none") {
    out += `## Action: ${child.action}

`;
    if (child.conflicts.length || child.artifacts.length) {
      out += `Advisory: a v2 tree carried a deprecated alias \u2014 flagged below (no mutation).

`;
    } else {
      out += `No v1 markers \u2014 nothing to migrate.
`;
      return out + "\n";
    }
  }
  if (child.snapshot) {
    out += `## Snapshot (SC-3)

`;
    out += `- dest: \`${child.snapshot.destRel}\` (${child.snapshot.fileCount} file(s), `;
    out += child.snapshot.verified ? `sha256-verified)
` : `**VERIFY FAILED** at \`${child.snapshot.mismatch}\` \u2014 conversion aborted)
`;
    if (child.restoreCommand) out += `- restore: \`${child.restoreCommand}\`
`;
    out += `
`;
  }
  out += `## Per-artifact disposition

`;
  if (child.artifacts.length === 0) {
    out += `_No convert/preserve artifacts (carry-forward artifacts are left untouched and not listed)._

`;
  } else {
    out += `| Artifact | Disposition | v2 target | Removed from live | Note |
|---|---|---|---|---|
`;
    for (const a of child.artifacts) {
      out += `| \`${a.rel}\` | ${a.disposition} | ${a.target ? `\`${a.target}\`` : "\u2014"} | ${a.removed ? "yes" : "no"} | ${a.note ?? ""} |
`;
    }
    out += `
`;
    for (const a of child.artifacts) {
      if (a.keys && a.keys.length) {
        out += `### Keys \u2014 \`${a.rel}\`

`;
        out += `| Key | Case | Detail |
|---|---|---|
`;
        for (const k of a.keys) out += `| \`${k.key}\` | ${k.case} | ${k.detail} |
`;
        out += `
`;
      }
    }
  }
  if (child.relocated.length) {
    out += `## Relocated to \`.unmigrated-v1.json\` (C2 \u2014 unmapped, preserved live + in snapshot)

`;
    out += `| Source | Key | Value | Reason |
|---|---|---|---|
`;
    for (const r of child.relocated)
      out += `| \`${r.source}\` | \`${r.key}\` | \`${JSON.stringify(r.value)}\` | ${r.reason} |
`;
    out += `
`;
  }
  if (child.conflicts.length) {
    out += `## Conflicts \u2014 REVIEW (C4 \u2014 kept LIVE, re-surfaced every open until resolved)

`;
    for (const c of child.conflicts) out += `- \`${c.key}\` \u2014 ${c.detail}
`;
    out += `
The tree intentionally stays \`mixed\` until you resolve these. The converter
`;
    out += `will NOT auto-pick a winner, clobber the v2 value, or remove the v1 source.

`;
  }
  out += renderGradesSection(child, mode);
  return out + "\n";
}
function renderGradesSection(child, mode) {
  const graded = child.grades.filter((g) => g.action === "graded");
  if (graded.length === 0) return "";
  const skipped = child.grades.filter((g) => g.action !== "graded");
  const count = (a) => skipped.filter((g) => g.action === a).length;
  let out = `## Drafted wiki importance grades \u2014 REVIEW REQUIRED (human gate)

`;
  out += mode === "dry-run" ? `${graded.length} wiki page(s) WOULD be drafted a v2 \`importance:\` grade (dry-run \u2014 nothing was written):

` : `${graded.length} wiki page(s) were drafted a v2 \`importance:\` grade by deterministic heuristics.
Each is marked \`importance_draft: true\` + \`graded_by: guild-migrate\` until you accept it:

`;
  out += `| Page | Drafted grade | Rule |
|---|---|---|
`;
  for (const g of graded) {
    out += `| \`${g.rel}\` | ${g.grade}${g.createdFrontmatter ? " (frontmatter created)" : ""} | ${g.rule} |
`;
  }
  out += `
Skipped: ${count("skipped-already-graded")} already graded (never touched), `;
  out += `${count("skipped-provenance")} provenance/exploratory (confidence-graded only, never importance), `;
  out += `${count("skipped-structural")} structural (index/README/log/lint).

`;
  out += `**Next step (the gate):** review each drafted grade \u2014 edit the \`importance:\` value
`;
  out += `in place where the heuristic is wrong \u2014 then accept:

`;
  out += `\`\`\`bash
npx tsx plugin/scripts/dot-guild/migrate-guild.ts --accept-grades --root=${child.root}
\`\`\`

`;
  out += `\`--accept-grades\` strips the \`importance_draft\`/\`graded_by\` markers and keeps the
`;
  out += `grade. Until accepted, wiki lint flags these pages as a pending-review item.
`;
  return out;
}

// scripts/dot-guild/convert/index.ts
function runMigration(opts) {
  const fs18 = opts.fs ?? realFs;
  const clock = opts.clock ?? realClock;
  const mode = opts.mode;
  const emitReport = opts.emitReport !== false;
  const units = discoverUnits(fs18, opts.root, opts.workspace);
  const children = [];
  for (const root of units.roots) {
    try {
      children.push(processChild(fs18, clock, root, mode, emitReport));
    } catch (e) {
      const guildDir = path26.join(root, ".guild");
      children.push({
        root,
        guildDir,
        detect: { classification: "none", m1: false, m2: false, hasUnparseable: false, evidence: [], unparseable: [] },
        action: "error",
        artifacts: [],
        relocated: [],
        conflicts: [],
        grades: [],
        reportPath: path26.join(guildDir, reportFileName(clock.stamp())),
        reportBody: "",
        error: e.message
      });
    }
  }
  return { children, workspace: units.workspace };
}
function planMigration(opts) {
  return runMigration({ ...opts, mode: "dry-run", emitReport: false });
}
function validateImmediateChild(fs18, root, childRel) {
  if (path26.isAbsolute(childRel)) return null;
  const resolved = path26.resolve(root, childRel);
  const resolvedRoot = path26.resolve(root);
  if (path26.dirname(resolved) !== resolvedRoot) return null;
  const base = path26.basename(resolved);
  if (base === "." || base === "..") return null;
  if (fs18.isSymlink(resolved)) return null;
  return resolved;
}
function discoverUnits(fs18, root, forceWorkspace) {
  const rootGuild = path26.join(root, ".guild");
  const workspaceJson = path26.join(rootGuild, "workspace.json");
  if (forceWorkspace === false) {
    return { roots: [root], workspace: false };
  }
  let childRoots = [];
  let isWorkspace = forceWorkspace === true;
  if (fs18.existsSync(workspaceJson)) {
    const res = parseJson(fs18.readFileSync(workspaceJson));
    if (res.ok && res.value && typeof res.value === "object") {
      const sub = res.value["sub_guilds"];
      if (Array.isArray(sub) && sub.length > 0) {
        isWorkspace = true;
        for (const s of sub) {
          const childRel = typeof s === "string" ? s : s?.["path"];
          if (typeof childRel === "string") {
            const validated = validateImmediateChild(fs18, root, childRel);
            if (validated) childRoots.push(validated);
          }
        }
      }
    }
  }
  if (childRoots.length === 0) {
    if (fs18.existsSync(root)) {
      let entries;
      try {
        entries = fs18.readdirSync(root);
      } catch {
        entries = [];
      }
      for (const e of entries) {
        if (!e.isDirectory) continue;
        const childRoot = path26.join(root, e.name);
        if (fs18.isSymlink(childRoot)) continue;
        if (fs18.existsSync(path26.join(childRoot, ".guild")) || fs18.existsSync(path26.join(childRoot, ".git"))) {
          childRoots.push(childRoot);
        }
      }
      if (childRoots.length > 0) isWorkspace = true;
    }
  }
  const roots = isWorkspace ? [root, ...childRoots] : [root];
  const seen = /* @__PURE__ */ new Set();
  const uniqueRoots = roots.filter((r) => seen.has(r) ? false : (seen.add(r), true));
  return { roots: uniqueRoots, workspace: isWorkspace };
}
function processChild(fs18, clock, root, mode, emitReport) {
  const guildDir = path26.join(root, ".guild");
  const det = detect2(fs18, guildDir);
  const stamp = clock.stamp();
  const reportPath = path26.join(guildDir, reportFileName(stamp));
  const base = {
    root,
    guildDir,
    detect: det,
    action: "none",
    artifacts: [],
    relocated: [],
    conflicts: [],
    grades: [],
    reportPath,
    reportBody: ""
  };
  if (det.classification === "none") {
    base.action = "none";
    base.reportBody = renderReport(base, mode, clock.iso());
    return base;
  }
  if (det.classification === "corrupt") {
    base.action = "corrupt-blocked";
    if (mode === "migrate") {
      const snap2 = snapshot(fs18, clock, guildDir);
      base.snapshot = snap2;
    }
    base.reportBody = renderReport(base, mode, clock.iso());
    writeReport(fs18, base, emitReport);
    return base;
  }
  if (det.classification === "v2") {
    base.action = "v2-noop";
    base.reportBody = renderReport(base, mode, clock.iso());
    return base;
  }
  if (mode === "skip") {
    base.action = "skip";
    base.reportBody = renderReport(base, mode, clock.iso());
    writeReport(fs18, base, emitReport);
    return base;
  }
  if (mode === "dry-run") {
    base.action = "dry-run";
    const out2 = convert(
      fs18,
      clock,
      guildDir,
      /*dryRun*/
      true,
      "(dry-run \u2014 no snapshot)"
    );
    base.artifacts = out2.artifacts;
    base.relocated = out2.relocated;
    base.conflicts = out2.conflicts;
    base.grades = out2.grades;
    base.reportBody = renderReport(base, mode, clock.iso());
    writeReport(fs18, base, emitReport);
    return base;
  }
  base.action = "migrate";
  const snap = snapshot(fs18, clock, guildDir);
  base.snapshot = snap;
  if (!snap.verified) {
    base.error = `snapshot verify failed at ${snap.mismatch} \u2014 conversion aborted (snapshot left for inspection)`;
    base.reportBody = renderReport(base, mode, clock.iso());
    writeReport(fs18, base, emitReport);
    return base;
  }
  const out = convert(
    fs18,
    clock,
    guildDir,
    /*dryRun*/
    false,
    snap.destRel
  );
  base.artifacts = out.artifacts;
  base.relocated = out.relocated;
  base.conflicts = out.conflicts;
  base.grades = out.grades;
  base.restoreCommand = buildRestore(snap.destRel, out.removed, out.generated);
  base.reportBody = renderReport(base, mode, clock.iso());
  writeReport(fs18, base, emitReport);
  return base;
}
function buildRestore(destRel, removed, generated) {
  const toDelete = [...removed, ...generated];
  const rmPart = toDelete.length ? `rm -f ${toDelete.map((p) => `.guild/${p}`).join(" ")} && ` : "";
  return `${rmPart}cp -R .guild/${destRel}/. .guild/`;
}
function writeReport(fs18, child, emitReport) {
  if (!emitReport) return;
  if (child.detect.classification === "none" || child.action === "v2-noop") return;
  fs18.writeFileSync(child.reportPath, child.reportBody);
}

// scripts/lib/state/upgrade-chain.ts
function v1Converter(opts) {
  const result = opts.dryRun ? planMigration({ root: opts.root, workspace: false }) : runMigration({ root: opts.root, mode: "migrate", workspace: false });
  const child = result.children[0];
  if (!child) return { classification: "none", action: "none", changed: 0 };
  return {
    classification: child.detect.classification,
    action: child.action,
    changed: child.artifacts.length,
    reportPath: child.reportPath,
    // Carried, never swallowed. A snapshot-verify abort or a corrupt block is a
    // STEP FAILURE upstream; dropping it here would let the marker be stamped over
    // a tree the converter refused to touch.
    error: child.error
  };
}
function runLayoutUpgrade(opts) {
  const result = runUpgrade({
    cwd: opts.root,
    fromVersion: opts.fromVersion,
    toVersion: opts.toVersion,
    dryRun: opts.dryRun === true,
    v1: v1Converter,
    policy: { canonicalPolicyKey, isPolicyKey, findHostIdentity }
  });
  return {
    state: result.state,
    marker_written: result.marker_written,
    dirty_paths: result.dirty_paths,
    question: result.question,
    report: formatUpgradeReport(result)
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runLayoutUpgrade
});
