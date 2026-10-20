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
  let dir = path.resolve(fromDir);
  for (; ; ) {
    if (fs.existsSync(path.join(dir, PLUGIN_ROOT_MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
var fs, path, PLUGIN_ROOT_MARKER;
var init_plugin_root = __esm({
  "src/domains/kernel/plugin-root.ts"() {
    fs = __toESM(require("node:fs"));
    path = __toESM(require("node:path"));
    PLUGIN_ROOT_MARKER = path.join("runtime", "guild-mcp.js");
  }
});

// hooks/node_modules/js-yaml/lib/common.js
var require_common = __commonJS({
  "hooks/node_modules/js-yaml/lib/common.js"(exports2, module2) {
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
      let result2 = "";
      for (let cycle = 0; cycle < count; cycle += 1) {
        result2 += string;
      }
      return result2;
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

// hooks/node_modules/js-yaml/lib/exception.js
var require_exception = __commonJS({
  "hooks/node_modules/js-yaml/lib/exception.js"(exports2, module2) {
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

// hooks/node_modules/js-yaml/lib/snippet.js
var require_snippet = __commonJS({
  "hooks/node_modules/js-yaml/lib/snippet.js"(exports2, module2) {
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
      let result2 = "";
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
        result2 = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + "\n" + result2;
      }
      const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
      result2 += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
      result2 += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
      for (let i = 1; i <= options.linesAfter; i++) {
        if (foundLineNo + i >= lineEnds.length) break;
        const line2 = getLine(
          mark.buffer,
          lineStarts[foundLineNo + i],
          lineEnds[foundLineNo + i],
          mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
          maxLineLength
        );
        result2 += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + "\n";
      }
      return result2.replace(/\n$/, "");
    }
    module2.exports = makeSnippet;
  }
});

// hooks/node_modules/js-yaml/lib/type.js
var require_type = __commonJS({
  "hooks/node_modules/js-yaml/lib/type.js"(exports2, module2) {
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
      const result2 = {};
      if (map !== null) {
        Object.keys(map).forEach(function(style) {
          map[style].forEach(function(alias) {
            result2[String(alias)] = style;
          });
        });
      }
      return result2;
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

// hooks/node_modules/js-yaml/lib/schema.js
var require_schema = __commonJS({
  "hooks/node_modules/js-yaml/lib/schema.js"(exports2, module2) {
    "use strict";
    var YAMLException = require_exception();
    var Type = require_type();
    function compileList(schema, name) {
      const result2 = [];
      schema[name].forEach(function(currentType) {
        let newIndex = result2.length;
        result2.forEach(function(previousType, previousIndex) {
          if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
            newIndex = previousIndex;
          }
        });
        result2[newIndex] = currentType;
      });
      return result2;
    }
    function compileMap() {
      const result2 = {
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
          result2.multi[type.kind].push(type);
          result2.multi["fallback"].push(type);
        } else {
          result2[type.kind][type.tag] = result2["fallback"][type.tag] = type;
        }
      }
      for (let index = 0, length = arguments.length; index < length; index += 1) {
        arguments[index].forEach(collectType);
      }
      return result2;
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
      const result2 = Object.create(Schema.prototype);
      result2.implicit = (this.implicit || []).concat(implicit);
      result2.explicit = (this.explicit || []).concat(explicit);
      result2.compiledImplicit = compileList(result2, "implicit");
      result2.compiledExplicit = compileList(result2, "explicit");
      result2.compiledTypeMap = compileMap(result2.compiledImplicit, result2.compiledExplicit);
      return result2;
    };
    module2.exports = Schema;
  }
});

// hooks/node_modules/js-yaml/lib/type/str.js
var require_str = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/str.js"(exports2, module2) {
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

// hooks/node_modules/js-yaml/lib/type/seq.js
var require_seq = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/seq.js"(exports2, module2) {
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

// hooks/node_modules/js-yaml/lib/type/map.js
var require_map = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/map.js"(exports2, module2) {
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

// hooks/node_modules/js-yaml/lib/schema/failsafe.js
var require_failsafe = __commonJS({
  "hooks/node_modules/js-yaml/lib/schema/failsafe.js"(exports2, module2) {
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

// hooks/node_modules/js-yaml/lib/type/null.js
var require_null = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/null.js"(exports2, module2) {
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
    function isNull(object2) {
      return object2 === null;
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

// hooks/node_modules/js-yaml/lib/type/bool.js
var require_bool = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/bool.js"(exports2, module2) {
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
    function isBoolean(object2) {
      return Object.prototype.toString.call(object2) === "[object Boolean]";
    }
    module2.exports = new Type("tag:yaml.org,2002:bool", {
      kind: "scalar",
      resolve: resolveYamlBoolean,
      construct: constructYamlBoolean,
      predicate: isBoolean,
      represent: {
        lowercase: function(object2) {
          return object2 ? "true" : "false";
        },
        uppercase: function(object2) {
          return object2 ? "TRUE" : "FALSE";
        },
        camelcase: function(object2) {
          return object2 ? "True" : "False";
        }
      },
      defaultStyle: "lowercase"
    });
  }
});

// hooks/node_modules/js-yaml/lib/type/int.js
var require_int = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/int.js"(exports2, module2) {
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
    function isInteger(object2) {
      return Object.prototype.toString.call(object2) === "[object Number]" && (object2 % 1 === 0 && !common.isNegativeZero(object2));
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

// hooks/node_modules/js-yaml/lib/type/float.js
var require_float = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/float.js"(exports2, module2) {
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
    function representYamlFloat(object2, style) {
      if (isNaN(object2)) {
        switch (style) {
          case "lowercase":
            return ".nan";
          case "uppercase":
            return ".NAN";
          case "camelcase":
            return ".NaN";
        }
      } else if (Number.POSITIVE_INFINITY === object2) {
        switch (style) {
          case "lowercase":
            return ".inf";
          case "uppercase":
            return ".INF";
          case "camelcase":
            return ".Inf";
        }
      } else if (Number.NEGATIVE_INFINITY === object2) {
        switch (style) {
          case "lowercase":
            return "-.inf";
          case "uppercase":
            return "-.INF";
          case "camelcase":
            return "-.Inf";
        }
      } else if (common.isNegativeZero(object2)) {
        return "-0.0";
      }
      const res = object2.toString(10);
      return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
    }
    function isFloat(object2) {
      return Object.prototype.toString.call(object2) === "[object Number]" && (object2 % 1 !== 0 || common.isNegativeZero(object2));
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

// hooks/node_modules/js-yaml/lib/schema/json.js
var require_json = __commonJS({
  "hooks/node_modules/js-yaml/lib/schema/json.js"(exports2, module2) {
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

// hooks/node_modules/js-yaml/lib/schema/core.js
var require_core = __commonJS({
  "hooks/node_modules/js-yaml/lib/schema/core.js"(exports2, module2) {
    "use strict";
    module2.exports = require_json();
  }
});

// hooks/node_modules/js-yaml/lib/type/timestamp.js
var require_timestamp = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/timestamp.js"(exports2, module2) {
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
    function representYamlTimestamp(object2) {
      return object2.toISOString();
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

// hooks/node_modules/js-yaml/lib/type/merge.js
var require_merge = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/merge.js"(exports2, module2) {
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

// hooks/node_modules/js-yaml/lib/type/binary.js
var require_binary = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/binary.js"(exports2, module2) {
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
      const result2 = [];
      for (let idx = 0; idx < max; idx++) {
        if (idx % 4 === 0 && idx) {
          result2.push(bits >> 16 & 255);
          result2.push(bits >> 8 & 255);
          result2.push(bits & 255);
        }
        bits = bits << 6 | map.indexOf(input.charAt(idx));
      }
      const tailbits = max % 4 * 6;
      if (tailbits === 0) {
        result2.push(bits >> 16 & 255);
        result2.push(bits >> 8 & 255);
        result2.push(bits & 255);
      } else if (tailbits === 18) {
        result2.push(bits >> 10 & 255);
        result2.push(bits >> 2 & 255);
      } else if (tailbits === 12) {
        result2.push(bits >> 4 & 255);
      }
      return new Uint8Array(result2);
    }
    function representYamlBinary(object2) {
      let result2 = "";
      let bits = 0;
      const max = object2.length;
      const map = BASE64_MAP;
      for (let idx = 0; idx < max; idx++) {
        if (idx % 3 === 0 && idx) {
          result2 += map[bits >> 18 & 63];
          result2 += map[bits >> 12 & 63];
          result2 += map[bits >> 6 & 63];
          result2 += map[bits & 63];
        }
        bits = (bits << 8) + object2[idx];
      }
      const tail = max % 3;
      if (tail === 0) {
        result2 += map[bits >> 18 & 63];
        result2 += map[bits >> 12 & 63];
        result2 += map[bits >> 6 & 63];
        result2 += map[bits & 63];
      } else if (tail === 2) {
        result2 += map[bits >> 10 & 63];
        result2 += map[bits >> 4 & 63];
        result2 += map[bits << 2 & 63];
        result2 += map[64];
      } else if (tail === 1) {
        result2 += map[bits >> 2 & 63];
        result2 += map[bits << 4 & 63];
        result2 += map[64];
        result2 += map[64];
      }
      return result2;
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

// hooks/node_modules/js-yaml/lib/type/omap.js
var require_omap = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/omap.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var _toString = Object.prototype.toString;
    function resolveYamlOmap(data) {
      if (data === null) return true;
      const objectKeys = {};
      const object2 = data;
      for (let index = 0, length = object2.length; index < length; index += 1) {
        const pair = object2[index];
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

// hooks/node_modules/js-yaml/lib/type/pairs.js
var require_pairs = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/pairs.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _toString = Object.prototype.toString;
    function resolveYamlPairs(data) {
      if (data === null) return true;
      const object2 = data;
      const result2 = new Array(object2.length);
      for (let index = 0, length = object2.length; index < length; index += 1) {
        const pair = object2[index];
        if (_toString.call(pair) !== "[object Object]") return false;
        const keys = Object.keys(pair);
        if (keys.length !== 1) return false;
        result2[index] = [keys[0], pair[keys[0]]];
      }
      return true;
    }
    function constructYamlPairs(data) {
      if (data === null) return [];
      const object2 = data;
      const result2 = new Array(object2.length);
      for (let index = 0, length = object2.length; index < length; index += 1) {
        const pair = object2[index];
        const keys = Object.keys(pair);
        result2[index] = [keys[0], pair[keys[0]]];
      }
      return result2;
    }
    module2.exports = new Type("tag:yaml.org,2002:pairs", {
      kind: "sequence",
      resolve: resolveYamlPairs,
      construct: constructYamlPairs
    });
  }
});

// hooks/node_modules/js-yaml/lib/type/set.js
var require_set = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/set.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    function resolveYamlSet(data) {
      if (data === null) return true;
      const object2 = data;
      for (const key in object2) {
        if (_hasOwnProperty.call(object2, key)) {
          if (object2[key] !== null) return false;
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

// hooks/node_modules/js-yaml/lib/schema/default.js
var require_default = __commonJS({
  "hooks/node_modules/js-yaml/lib/schema/default.js"(exports2, module2) {
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

// hooks/node_modules/js-yaml/lib/loader.js
var require_loader = __commonJS({
  "hooks/node_modules/js-yaml/lib/loader.js"(exports2, module2) {
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
    function setProperty(object2, key, value) {
      if (key === "__proto__") {
        Object.defineProperty(object2, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value
        });
      } else {
        object2[key] = value;
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
    function chargeMergeWork(state) {
      state.totalMergeKeys++;
      if (state.maxTotalMergeKeys !== -1 && state.totalMergeKeys > state.maxTotalMergeKeys) {
        throwError(state, "merge keys exceeded maxTotalMergeKeys (" + state.maxTotalMergeKeys + ")");
      }
    }
    function mergeMappings(state, destination, source, overridableKeys) {
      if (!common.isObject(source)) {
        throwError(state, "cannot merge mappings; the provided source object is unacceptable");
      }
      chargeMergeWork(state);
      const sourceKeys = Object.keys(source);
      for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
        const key = sourceKeys[index];
        chargeMergeWork(state);
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
          if (valueNode.length > 100) {
            throwError(state, "abnormal merge sequence size");
          }
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

// hooks/node_modules/js-yaml/lib/dumper.js
var require_dumper = __commonJS({
  "hooks/node_modules/js-yaml/lib/dumper.js"(exports2, module2) {
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
      const result2 = {};
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
        result2[tag] = style;
      }
      return result2;
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
      let result2 = "";
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
        if (line.length && line !== "\n") result2 += ind;
        result2 += line;
      }
      return result2;
    }
    function generateNextLine(state, level) {
      return "\n" + common.repeat(" ", state.indent * level);
    }
    function testImplicitResolving(state, str2) {
      for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) {
        const type = state.implicitTypes[index];
        if (type.resolve(str2)) {
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
    function isPlainSafe2(c, prev, inblock) {
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
          plain = plain && isPlainSafe2(char, prevChar, inblock);
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
          plain = plain && isPlainSafe2(char, prevChar, inblock);
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
      let result2 = (function() {
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
        result2 += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
        prevMoreIndented = moreIndented;
      }
      return result2;
    }
    function foldLine(line, width) {
      if (line === "" || line[0] === " ") return line;
      const breakRe = / [^ ]/g;
      let match;
      let start = 0;
      let end;
      let curr = 0;
      let next = 0;
      let result2 = "";
      while (match = breakRe.exec(line)) {
        next = match.index;
        if (next - start > width) {
          end = curr > start ? curr : next;
          result2 += "\n" + line.slice(start, end);
          start = end + 1;
        }
        curr = next;
      }
      result2 += "\n";
      if (line.length - start > width && curr > start) {
        result2 += line.slice(start, curr) + "\n" + line.slice(curr + 1);
      } else {
        result2 += line.slice(start);
      }
      return result2.slice(1);
    }
    function escapeString(string) {
      let result2 = "";
      let char = 0;
      for (let i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        const escapeSeq = ESCAPE_SEQUENCES[char];
        if (!escapeSeq && isPrintable(char)) {
          result2 += string[i];
          if (char >= 65536) result2 += string[i + 1];
        } else {
          result2 += escapeSeq || encodeHex(char);
        }
      }
      return result2;
    }
    function writeFlowSequence(state, level, object2) {
      let _result = "";
      const _tag = state.tag;
      for (let index = 0, length = object2.length; index < length; index += 1) {
        let value = object2[index];
        if (state.replacer) {
          value = state.replacer.call(object2, String(index), value);
        }
        if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
          if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
          _result += state.dump;
        }
      }
      state.tag = _tag;
      state.dump = "[" + _result + "]";
    }
    function writeBlockSequence(state, level, object2, compact) {
      let _result = "";
      const _tag = state.tag;
      for (let index = 0, length = object2.length; index < length; index += 1) {
        let value = object2[index];
        if (state.replacer) {
          value = state.replacer.call(object2, String(index), value);
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
    function writeFlowMapping(state, level, object2) {
      let _result = "";
      const _tag = state.tag;
      const objectKeyList = Object.keys(object2);
      for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
        let pairBuffer = "";
        if (_result !== "") pairBuffer += ", ";
        if (state.condenseFlow) pairBuffer += '"';
        const objectKey = objectKeyList[index];
        let objectValue = object2[objectKey];
        if (state.replacer) {
          objectValue = state.replacer.call(object2, objectKey, objectValue);
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
    function writeBlockMapping(state, level, object2, compact) {
      let _result = "";
      const _tag = state.tag;
      const objectKeyList = Object.keys(object2);
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
        let objectValue = object2[objectKey];
        if (state.replacer) {
          objectValue = state.replacer.call(object2, objectKey, objectValue);
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
    function detectType(state, object2, explicit) {
      const typeList = explicit ? state.explicitTypes : state.implicitTypes;
      for (let index = 0, length = typeList.length; index < length; index += 1) {
        const type = typeList[index];
        if ((type.instanceOf || type.predicate) && (!type.instanceOf || typeof object2 === "object" && object2 instanceof type.instanceOf) && (!type.predicate || type.predicate(object2))) {
          if (explicit) {
            if (type.multi && type.representName) {
              state.tag = type.representName(object2);
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
              _result = type.represent(object2, style);
            } else if (_hasOwnProperty.call(type.represent, style)) {
              _result = type.represent[style](object2, style);
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
    function writeNode(state, level, object2, block, compact, iskey, isblockseq) {
      state.tag = null;
      state.dump = object2;
      if (!detectType(state, object2, false)) {
        detectType(state, object2, true);
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
        duplicateIndex = state.duplicates.indexOf(object2);
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
    function getDuplicateReferences(object2, state) {
      const objects = [];
      const duplicatesIndexes = [];
      inspectNode(object2, objects, duplicatesIndexes);
      const length = duplicatesIndexes.length;
      for (let index = 0; index < length; index += 1) {
        state.duplicates.push(objects[duplicatesIndexes[index]]);
      }
      state.usedDuplicates = new Array(length);
    }
    function inspectNode(object2, objects, duplicatesIndexes) {
      if (object2 !== null && typeof object2 === "object") {
        const index = objects.indexOf(object2);
        if (index !== -1) {
          if (duplicatesIndexes.indexOf(index) === -1) {
            duplicatesIndexes.push(index);
          }
        } else {
          objects.push(object2);
          if (Array.isArray(object2)) {
            for (let i = 0, length = object2.length; i < length; i += 1) {
              inspectNode(object2[i], objects, duplicatesIndexes);
            }
          } else {
            const objectKeyList = Object.keys(object2);
            for (let i = 0, length = objectKeyList.length; i < length; i += 1) {
              inspectNode(object2[objectKeyList[i]], objects, duplicatesIndexes);
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

// hooks/node_modules/js-yaml/index.js
var require_js_yaml = __commonJS({
  "hooks/node_modules/js-yaml/index.js"(exports2, module2) {
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
    ...own === null ? [] : [path2.join(own, "scripts")],
    // Source TS layout (src/domains/<id>) and the bundled agent-team hook layout
    // (hooks/agent-team/dist) both sit three levels under plugin/.
    path2.resolve(__dirname, "..", "..", "..", "scripts"),
    // Bundled hook layout (hooks/dist) and src/adapters both sit two levels under.
    path2.resolve(__dirname, "..", "..", "scripts"),
    // src/adapters/model-discovery and any deeper nesting.
    path2.resolve(__dirname, "..", "..", "..", "..", "scripts")
  ];
}
function tryScriptsRoot(scriptsRoot) {
  try {
    const requireFrom = (0, import_node_module.createRequire)(path2.join(scriptsRoot, "package.json"));
    return requireFrom("js-yaml");
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
  const cwdRoot = path2.resolve(process.cwd(), "scripts");
  tried.push(cwdRoot);
  const api = tryScriptsRoot(cwdRoot);
  if (api) return api;
  throw new Error(
    `Guild needs the js-yaml package and could not resolve it. Fix: npm install --prefix <plugin-root>/scripts (roots tried: ${tried.join(", ")})`
  );
}
var import_node_module, path2;
var init_yaml_loader = __esm({
  "src/domains/kernel/yaml-loader.ts"() {
    import_node_module = require("node:module");
    path2 = __toESM(require("node:path"));
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
function escapes(rel2) {
  return rel2 === ".." || rel2.startsWith(`..${path3.sep}`) || path3.isAbsolute(rel2);
}
function refuse(code, detail) {
  return Object.freeze({ contained: false, code, detail });
}
function hasParentSegment(p) {
  return p.split(/[\\/]/).includes("..");
}
function lstatOrNull(p) {
  try {
    return fs2.lstatSync(p);
  } catch {
    return null;
  }
}
function isWithin(child, parent) {
  const rel2 = path3.relative(parent, child);
  return rel2 === "" || !escapes(rel2);
}
function checkContained(root, target, options = {}) {
  const policy = options.policy ?? "resolve";
  let realRoot2;
  try {
    realRoot2 = fs2.realpathSync(path3.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }
  if (hasParentSegment(target)) {
    return refuse(
      "parent-traversal",
      `refusing a path spelled with a ".." segment (${target}) \u2014 parent traversal cannot be resolved before symlinks`
    );
  }
  const abs = path3.isAbsolute(target) ? path3.resolve(target) : path3.resolve(realRoot2, target);
  let probe = abs;
  let probeStat = null;
  for (; ; ) {
    probeStat = lstatOrNull(probe);
    if (probeStat !== null) break;
    const parent = path3.dirname(probe);
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
    realProbe = fs2.realpathSync(probe);
  } catch {
    return refuse(
      "dangling-symlink",
      `${probe} is a symlink that does not resolve; refusing to write through it`
    );
  }
  const rel2 = path3.relative(realRoot2, realProbe);
  if (rel2 !== "" && escapes(rel2)) {
    return refuse("outside-root", `${abs} resolves outside the project root (${realProbe})`);
  }
  if (policy === "physical") {
    const parsed = path3.parse(abs);
    let walk = parsed.root;
    for (const seg of abs.slice(parsed.root.length).split(path3.sep)) {
      if (seg === "" || seg === ".") continue;
      walk = path3.join(walk, seg);
      const st = lstatOrNull(walk);
      if (st === null || !st.isSymbolicLink()) continue;
      let segReal;
      try {
        segReal = fs2.realpathSync(walk);
      } catch {
        return refuse("dangling-symlink", `${walk} is a symlink that does not resolve`);
      }
      const segRel = path3.relative(realRoot2, segReal);
      const strictlyInside = segRel !== "" && !escapes(segRel);
      if (strictlyInside) {
        return refuse("physical-symlink", `refusing \u2014 symlinked path segment: ${walk}`);
      }
    }
  }
  const tail = path3.relative(probe, abs);
  const realPath = tail === "" ? realProbe : path3.join(realProbe, tail);
  return Object.freeze({ contained: true, realRoot: realRoot2, realPath });
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
    canonRoot = fs2.realpathSync(path3.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }
  const abs = path3.isAbsolute(target) ? path3.resolve(target) : path3.resolve(canonRoot, target);
  const dir = path3.dirname(abs);
  const pre = checkContained(root, dir, { policy: options.policy });
  if (isRefused(pre)) return pre;
  try {
    fs2.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return refuse("mkdir-failed", `could not create ${dir}: ${err?.message ?? "unknown"}`);
  }
  const post = checkContained(root, abs, options);
  if (isRefused(post)) return post;
  let realDir;
  try {
    realDir = fs2.realpathSync(dir);
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
var fs2, path3, CONTAINMENT_REFUSAL_CODES;
var init_path_containment = __esm({
  "src/domains/kernel/path-containment.ts"() {
    fs2 = __toESM(require("node:fs"));
    path3 = __toESM(require("node:path"));
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
function codePointCompare(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i);
    const cb = b.codePointAt(j);
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 65535 ? 2 : 1;
    j += cb > 65535 ? 2 : 1;
  }
  if (i < a.length) return 1;
  if (j < b.length) return -1;
  return 0;
}
function isPrintableCodePoint(c) {
  return c >= 32 && c <= 126 || c >= 160 && c <= 55295 || c >= 57344 && c <= 65533 || c >= 65536 && c <= 1114111;
}
function isPlainSafe(s) {
  if (s.length === 0) return false;
  for (const ch of s) {
    if (!isPrintableCodePoint(ch.codePointAt(0))) return false;
  }
  if (s.startsWith(" ") || s.endsWith(" ")) return false;
  if (LEADING_INDICATORS.includes(s[0])) return false;
  if (s.includes(": ") || s.endsWith(":")) return false;
  if (s.includes(" #")) return false;
  for (const re of AMBIGUOUS_SCALAR_PATTERNS) {
    if (re.test(s)) return false;
  }
  return true;
}
function hex(n, width) {
  return n.toString(16).toUpperCase().padStart(width, "0");
}
function doubleQuoted(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const named = DQ_ESCAPES[c];
    if (named !== void 0) out += named;
    else if (isPrintableCodePoint(c)) out += ch;
    else if (c <= 255) out += `\\x${hex(c, 2)}`;
    else if (c <= 65535) out += `\\u${hex(c, 4)}`;
    else out += `\\U${hex(c, 8)}`;
  }
  return out + '"';
}
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function scalarToken(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new Error(`canonical-hash: refusing to serialize non-finite number ${String(v)} (\xA71 artifacts are plain data)`);
    }
    return String(v);
  }
  if (typeof v === "string") return isPlainSafe(v) ? v : doubleQuoted(v);
  throw new Error(
    `canonical-hash: refusing to serialize a ${typeof v} value \u2014 \xA71 artifacts carry only null/boolean/number/string/array/object`
  );
}
function isScalar(v) {
  return v === null || ["boolean", "number", "string"].includes(typeof v);
}
function renderMap(obj, indent) {
  const keys = Object.keys(obj).sort(codePointCompare);
  let out = "";
  for (const k of keys) {
    const v = obj[k];
    if (v === void 0) {
      throw new Error(`canonical-hash: refusing to serialize undefined at key ${JSON.stringify(k)} \u2014 omit the key instead`);
    }
    const keyTok = scalarToken(k);
    if (isScalar(v)) {
      out += `${indent}${keyTok}: ${scalarToken(v)}
`;
    } else if (Array.isArray(v)) {
      out += v.length === 0 ? `${indent}${keyTok}: []
` : `${indent}${keyTok}:
${renderSeq(v, indent + "  ")}`;
    } else if (isPlainObject(v)) {
      out += Object.keys(v).length === 0 ? `${indent}${keyTok}: {}
` : `${indent}${keyTok}:
${renderMap(v, indent + "  ")}`;
    } else {
      throw new Error(`canonical-hash: unrepresentable value at key ${JSON.stringify(k)}`);
    }
  }
  return out;
}
function seqItemOf(childBlock, indent) {
  return `${indent}- ${childBlock.slice(indent.length + 2)}`;
}
function renderSeq(arr, indent) {
  let out = "";
  for (const item of arr) {
    if (item === void 0) {
      throw new Error("canonical-hash: refusing to serialize undefined inside an array");
    }
    if (isScalar(item)) {
      out += `${indent}- ${scalarToken(item)}
`;
    } else if (Array.isArray(item)) {
      out += item.length === 0 ? `${indent}- []
` : seqItemOf(renderSeq(item, indent + "  "), indent);
    } else if (isPlainObject(item)) {
      out += Object.keys(item).length === 0 ? `${indent}- {}
` : seqItemOf(renderMap(item, indent + "  "), indent);
    } else {
      throw new Error("canonical-hash: unrepresentable value inside an array");
    }
  }
  return out;
}
function canonicalYaml(value) {
  if (value === void 0) {
    throw new Error("canonical-hash: refusing to serialize undefined as a document");
  }
  if (isScalar(value)) return `${scalarToken(value)}
`;
  if (Array.isArray(value)) return value.length === 0 ? "[]\n" : renderSeq(value, "");
  if (isPlainObject(value)) return Object.keys(value).length === 0 ? "{}\n" : renderMap(value, "");
  throw new Error("canonical-hash: unrepresentable document value");
}
function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
function selfReferentialHash(artifact, hashField) {
  const clone = { ...artifact };
  delete clone[hashField];
  return sha256Hex(canonicalYaml(clone));
}
var crypto, AMBIGUOUS_SCALAR_PATTERNS, LEADING_INDICATORS, DQ_ESCAPES;
var init_canonical_hash = __esm({
  "src/domains/kernel/canonical-hash.ts"() {
    crypto = __toESM(require("crypto"));
    AMBIGUOUS_SCALAR_PATTERNS = [
      /^(?:null|Null|NULL|~)$/,
      /^(?:true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/,
      /^[-+]?(?:\d[\d_]*)$/,
      // decimal int (incl. leading zeros / underscores)
      /^[-+]?0[xX][0-9a-fA-F_]+$/,
      // hex
      /^[-+]?0[oO]?[0-7_]+$/,
      // octal (both 0o17 and legacy 017)
      /^[-+]?0[bB][01_]+$/,
      // binary
      /^[-+]?(?:\d[\d_]*\.[\d_]*|\.\d[\d_]*)(?:[eE][-+]?\d+)?$/,
      // float
      /^[-+]?\d[\d_]*(?:[eE][-+]?\d+)$/,
      // int-mantissa exponent float
      /^[-+]?\.(?:inf|Inf|INF)$/,
      /^\.(?:nan|NaN|NAN)$/,
      /^[-+]?\d[\d_]*(?::[0-5]?\d)+(?:\.[\d_]*)?$/,
      // sexagesimal
      /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt\s].*)?$/
      // date / timestamp
    ];
    LEADING_INDICATORS = "-?:,[]{}#&*!|>'\"%@` ";
    DQ_ESCAPES = {
      0: "\\0",
      7: "\\a",
      8: "\\b",
      9: "\\t",
      10: "\\n",
      11: "\\v",
      12: "\\f",
      13: "\\r",
      27: "\\e",
      34: '\\"',
      92: "\\\\"
    };
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

// src/domains/config/host-capabilities-schema.ts
function validateHostCapabilitiesV1(value) {
  const errors = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["capability row must be a non-null object"] };
  }
  const o = value;
  if (o["schema_version"] !== "guild.host_capabilities.v1") {
    errors.push(
      `schema_version must be "guild.host_capabilities.v1"; got ${JSON.stringify(o["schema_version"])}`
    );
  }
  for (const k of ["host_kind", "family", "surface_kind"]) {
    if (typeof o[k] !== "string" || o[k].trim() === "") {
      errors.push(`${k} must be a non-empty string`);
    }
  }
  const requiredBlocks = [
    "package",
    "bootstrap",
    "commands",
    "skills",
    "agents",
    "hooks",
    "permissions",
    "dispatch",
    "interaction",
    "sessions",
    "structured_output",
    "artifacts",
    "tools",
    "mcp",
    "models"
  ];
  for (const b of requiredBlocks) {
    const block = o[b];
    if (typeof block !== "object" || block === null || Array.isArray(block)) {
      errors.push(`${b} must be a present object`);
    }
  }
  const tools = o["tools"];
  if (typeof tools === "object" && tools !== null && !Array.isArray(tools)) {
    for (const [tk, tv] of Object.entries(tools)) {
      if (typeof tv !== "string" || !TOOL_STRENGTHS.has(tv)) {
        errors.push(`tools.${tk} must be one of native|bridge|emulated|none; got ${JSON.stringify(tv)}`);
      }
    }
  }
  {
    const inj = value["injection"];
    if (typeof inj !== "object" || inj === null || Array.isArray(inj)) {
      errors.push("injection must be an object");
    } else {
      const i = inj;
      const pairs = [
        ["definition_injection", "definition_injection_support"],
        ["skill_bundle_injection", "skill_bundle_injection_support"],
        ["dynamic_registration", "dynamic_registration_support"]
      ];
      for (const [boolKey, supportKey] of pairs) {
        const b = i[boolKey];
        const sup = i[supportKey];
        if (typeof b !== "boolean") {
          errors.push(`injection.${boolKey} must be boolean; got ${JSON.stringify(b)}`);
        }
        if (typeof sup !== "string" || !INJECTION_SUPPORT_SET.has(sup)) {
          errors.push(
            `injection.${supportKey} must be one of verified|target|absent; got ${JSON.stringify(sup)}`
          );
        }
        if (b === true && sup !== "verified") {
          errors.push(
            `injection.${boolKey} is true but ${supportKey} is ${JSON.stringify(sup)} \u2014 only a "verified" support value may carry a true capability`
          );
        }
        if (sup === "verified" && b !== true) {
          errors.push(
            `injection.${supportKey} is "verified" but ${boolKey} is ${JSON.stringify(b)} \u2014 "verified" means a probe proved the capability PRESENT; use "absent" for a probe that found it missing, or "target" for an unprobed mechanism`
          );
        }
      }
      for (const [boolKey, supportKey] of pairs) {
        const citeKey = `${boolKey}_verified_by`;
        const cite = i[citeKey];
        if (i[supportKey] === "verified") {
          if (typeof cite !== "string" || !PROBE_RECEIPT_PATH_RE.test(cite)) {
            errors.push(
              `injection.${supportKey} is "verified" but ${citeKey} is ${JSON.stringify(cite)} \u2014 a verified capability must cite its own probe receipt at evidence/host-smoke/<host-id>/<box-id>.json`
            );
          }
        } else if (cite !== null) {
          errors.push(
            `injection.${citeKey} must be null when ${supportKey} is not "verified"; got ${JSON.stringify(cite)}`
          );
        }
      }
      const fb = i["fallback"];
      if (fb !== "prompt_text" && fb !== "none") {
        errors.push(`injection.fallback must be prompt_text|none; got ${JSON.stringify(fb)}`);
      }
    }
  }
  const hooks = o["hooks"];
  if (typeof hooks === "object" && hooks !== null && !Array.isArray(hooks)) {
    const h = hooks;
    for (const ev of REQUIRED_HOOK_EVENTS) {
      if (typeof h[ev] !== "boolean") {
        errors.push(`hooks.${ev} must be present and boolean (probed rows must advertise every event); got ${JSON.stringify(h[ev])}`);
      }
    }
  }
  const pkg = o["package"];
  if (typeof pkg === "object" && pkg !== null && !Array.isArray(pkg)) {
    const inst = pkg["installability"];
    if (inst !== "verified" && inst !== "target") {
      errors.push(`package.installability must be "verified" or "target"; got ${JSON.stringify(inst)}`);
    }
    if (typeof pkg["installable"] !== "boolean") {
      errors.push("package.installable must be a boolean");
    }
    const upd = pkg["update"];
    if (typeof upd !== "object" || upd === null || Array.isArray(upd)) {
      errors.push("package.update is required (AC-7 update capability row)");
    } else {
      const u = upd;
      if (u["check"] !== "marketplace_clone" && u["check"] !== "receipt" && u["check"] !== "none") {
        errors.push(`package.update.check must be "marketplace_clone" | "receipt" | "none"; got ${JSON.stringify(u["check"])}`);
      }
      const apply = u["apply"];
      if (apply !== "marketplace_cli" && apply !== "self_update" && apply !== "reinstall_command" && apply !== "none") {
        errors.push(`package.update.apply must be "marketplace_cli" | "self_update" | "reinstall_command" | "none"; got ${JSON.stringify(apply)}`);
      }
      if (apply === "none") {
        if (u["command"] !== null) errors.push('package.update.command must be null when apply is "none"');
        if (u["auto_capable"] !== false) errors.push('package.update.auto_capable must be false when apply is "none"');
        if (u["check"] !== "none") errors.push('package.update.check must be "none" when apply is "none"');
      } else if (typeof u["command"] !== "string" || u["command"].length === 0) {
        errors.push("package.update.command must be a non-empty string when an apply path exists");
      }
      if (typeof u["auto_capable"] !== "boolean") {
        errors.push("package.update.auto_capable must be a boolean");
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
function isHostCapabilitiesV1(value) {
  return validateHostCapabilitiesV1(value).valid;
}
var UPDATE_COMMANDS, PROBE_RECEIPT_PATH_RE, INJECTION_SUPPORT, INJECTION_SUPPORT_SET, CLAUDE_CAPABILITIES, CODEX_CAPABILITIES, NO_HOOKS, AGENTS_FILE_CAPABILITIES, TOOL_STRENGTHS, REQUIRED_HOOK_EVENTS;
var init_host_capabilities_schema = __esm({
  "src/domains/config/host-capabilities-schema.ts"() {
    UPDATE_COMMANDS = {
      marketplace_cli: "claude plugin marketplace update guild && claude plugin update guild@guild",
      self_update: "guild-run update",
      reinstall_command: "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update"
    };
    PROBE_RECEIPT_PATH_RE = /^evidence\/host-smoke\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*\.json$/;
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
    TOOL_STRENGTHS = /* @__PURE__ */ new Set(["native", "bridge", "emulated", "none"]);
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
function validateHostRegistryEntry(value) {
  const errors = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["host registry entry must be a non-null object"] };
  }
  const o = value;
  if (o["schema_version"] !== "guild.host_registry.v1") {
    errors.push(
      `schema_version must be "guild.host_registry.v1"; got ${JSON.stringify(o["schema_version"])}`
    );
  }
  if (typeof o["host_id"] !== "string" || !HOST_ID_SET.has(o["host_id"])) {
    errors.push(`host_id must be one of ${HOST_IDS.join("|")}; got ${JSON.stringify(o["host_id"])}`);
  }
  if (typeof o["family"] !== "string" || !FAMILY_SET.has(o["family"])) {
    errors.push(`family must be one of ${HOST_FAMILIES.join("|")}; got ${JSON.stringify(o["family"])}`);
  }
  if (typeof o["surface_kind"] !== "string" || !SURFACE_SET.has(o["surface_kind"])) {
    errors.push(`surface_kind must be cli|app|file; got ${JSON.stringify(o["surface_kind"])}`);
  }
  const det = o["detection"];
  if (typeof det !== "object" || det === null || Array.isArray(det)) {
    errors.push("detection must be a present object");
  } else {
    const d = det;
    if (!(d["bin"] === null || typeof d["bin"] === "string")) {
      errors.push("detection.bin must be a string or null");
    }
    if (typeof d["requires_auth"] !== "boolean") {
      errors.push("detection.requires_auth must be a boolean");
    }
    if (typeof d["auth_probe"] !== "string" || !AUTH_PROBE_SET.has(d["auth_probe"])) {
      errors.push(`detection.auth_probe must be one of ${[...AUTH_PROBE_SET].join("|")}; got ${JSON.stringify(d["auth_probe"])}`);
    }
    if ("subcommand" in d && !(d["subcommand"] === null || typeof d["subcommand"] === "string")) {
      errors.push("detection.subcommand must be a string or null when present");
    }
    if ("marker" in d && d["marker"] !== null && d["marker"] !== void 0) {
      const m = d["marker"];
      if (typeof m !== "object" || Array.isArray(m)) {
        errors.push("detection.marker must be an object or null");
      } else {
        const mo = m;
        if (typeof mo["config_dir"] !== "string" || mo["config_dir"].length === 0) {
          errors.push("detection.marker.config_dir must be a non-empty string");
        }
        if (typeof mo["scope"] !== "string" || !MARKER_SCOPE_SET.has(mo["scope"])) {
          errors.push(`detection.marker.scope must be project|home|either; got ${JSON.stringify(mo["scope"])}`);
        }
        if (typeof mo["agents_placement"] !== "string" || mo["agents_placement"].length === 0) {
          errors.push("detection.marker.agents_placement must be a non-empty string");
        }
      }
    }
  }
  if (typeof o["installability"] !== "string" || !INSTALLABILITY_SET.has(o["installability"])) {
    errors.push(`installability must be native|target|none; got ${JSON.stringify(o["installability"])}`);
  }
  if (typeof o["result_adapter"] !== "boolean") {
    errors.push(`result_adapter must be a boolean (independent column); got ${JSON.stringify(o["result_adapter"])}`);
  }
  if (typeof o["dispatch_selectable"] !== "boolean") {
    errors.push(`dispatch_selectable must be a boolean (independent column); got ${JSON.stringify(o["dispatch_selectable"])}`);
  }
  if (o["provenance"] !== "verified" && o["provenance"] !== "inferred") {
    errors.push(`provenance must be "verified" or "inferred"; got ${JSON.stringify(o["provenance"])}`);
  }
  const binding = o["adapter_binding"];
  if (typeof binding !== "string" || !ADAPTER_BINDING_SET.has(binding)) {
    errors.push(`adapter_binding must be self|agents-file; got ${JSON.stringify(binding)}`);
  } else if (binding === "agents-file") {
    if (o["surface_kind"] !== "file") {
      errors.push(
        `adapter_binding "agents-file" requires surface_kind "file"; got ${JSON.stringify(o["surface_kind"])}`
      );
    }
    if (typeof det === "object" && det !== null && !Array.isArray(det)) {
      const d = det;
      if (d["bin"] !== null) {
        errors.push(`adapter_binding "agents-file" requires detection.bin null (file surface); got ${JSON.stringify(d["bin"])}`);
      }
      if (d["marker"] === null || d["marker"] === void 0) {
        errors.push('adapter_binding "agents-file" requires a detection.marker recipe (how the IDE is detected)');
      }
    }
    if (o["result_adapter"] !== false) {
      errors.push('adapter_binding "agents-file" must not carry a per-host result_adapter (AC-REG-4 / R2)');
    }
  }
  const caps = o["capabilities"];
  const capsResult = validateHostCapabilitiesV1(caps);
  if (!capsResult.valid) {
    for (const e of capsResult.errors) errors.push(`capabilities.${e}`);
  }
  if (typeof caps === "object" && caps !== null && !Array.isArray(caps) && typeof o["surface_kind"] === "string") {
    const capsSurface = caps["surface_kind"];
    if (capsSurface !== o["surface_kind"]) {
      errors.push(
        `surface_kind mismatch: top-level ${JSON.stringify(o["surface_kind"])} !== capabilities.surface_kind ${JSON.stringify(capsSurface)}`
      );
    }
  }
  {
    const caps2 = o["capabilities"];
    const selectable = o["dispatch_selectable"];
    if (typeof selectable === "boolean" && typeof caps2 === "object" && caps2 !== null && !Array.isArray(caps2)) {
      const inj = caps2["injection"];
      if (typeof inj === "object" && inj !== null && !Array.isArray(inj)) {
        const i = inj;
        const supports = [
          "definition_injection_support",
          "skill_bundle_injection_support",
          "dynamic_registration_support"
        ];
        if (!selectable) {
          for (const k of supports) {
            if (i[k] !== "absent") {
              errors.push(
                `dispatch_selectable is false but injection.${k} is ${JSON.stringify(i[k])} \u2014 a host with no dispatch surface has nothing to inject into (must be "absent")`
              );
            }
          }
          if (i["fallback"] !== "none") {
            errors.push(
              `dispatch_selectable is false but injection.fallback is ${JSON.stringify(i["fallback"])} \u2014 there is no lane to fall back to (must be "none")`
            );
          }
        } else if (i["definition_injection_support"] === "absent") {
          errors.push(
            'dispatch_selectable is true but injection.definition_injection_support is "absent" \u2014 a dispatchable surface is never structurally absent'
          );
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
function isHostRegistryEntry(value) {
  return validateHostRegistryEntry(value).valid;
}
var HOST_IDS, HOST_FAMILIES, AUTH_PROBES, CLAUDE_ENTRY, CODEX_ENTRY, AGENTS_FILE_ENTRY, PI_ENTRY, ANTIGRAVITY_ENTRY, CLAUDE_APP_ENTRY, CLAUDE_WEB_ENTRY, CODEX_APP_ENTRY, CLAUDE_AI_CONNECTOR_ENTRY, CURSOR_ENTRY, GITHUB_COPILOT_ENTRY, OPENCODE_ENTRY, ROVO_DEV_ENTRY, KIRO_ENTRY, QODER_ENTRY, TRAE_ENTRY, HOST_REGISTRY_ROWS, HOST_ID_SET, FAMILY_SET, INSTALLABILITY_SET, SURFACE_SET, AUTH_PROBE_SET, ADAPTER_BINDING_SET, MARKER_SCOPE_SET;
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
    INSTALLABILITY_SET = /* @__PURE__ */ new Set(["native", "target", "none"]);
    SURFACE_SET = /* @__PURE__ */ new Set(["cli", "app", "file"]);
    AUTH_PROBE_SET = new Set(AUTH_PROBES);
    ADAPTER_BINDING_SET = /* @__PURE__ */ new Set(["self", "agents-file"]);
    MARKER_SCOPE_SET = /* @__PURE__ */ new Set(["project", "home", "either"]);
  }
});

// src/domains/config/host-id-namespace.ts
function hostKindToRegistryId(hk) {
  if (hk in HOSTKIND_TO_REGISTRY_ID) {
    return HOSTKIND_TO_REGISTRY_ID[hk];
  }
  const s = String(hk);
  const normalized = normalizeHostId(s);
  if (normalized) return normalized;
  for (const { prefix, id } of PREFIX_COLLAPSE) {
    if (s.startsWith(prefix)) return id;
  }
  return null;
}
function normalizeHostId(value) {
  const s = value.trim();
  if (HOST_ID_SET2.has(s)) return s;
  return LEGACY_HOST_ALIASES[s] ?? null;
}
function registryIdToCanonicalHostKind(id) {
  switch (id) {
    case "claude-code-cli":
      return "claude";
    case "codex-cli":
      return "codex";
    case "pi-cli":
      return "pi";
    case "antigravity-cli":
      return "antigravity-2";
    // registry `antigravity` => canonical legacy id `antigravity-2`
    case "claude-code-app":
      return "claude-code-desktop";
    case "claude-code-web":
      return "claude-code-web";
    case "codex-app":
      return "codex-app";
    case "claude-ai-connector":
      return "claude-ai-connector";
    // G4b — the 4 wrapped-CLI hosts: identity mapping (registry id == HostKind literal).
    case "cursor":
      return "cursor";
    case "github-copilot":
      return "github-copilot";
    case "opencode":
      return "opencode";
    case "rovo-dev":
      return "rovo-dev";
    case "agents-file":
    case "kiro":
    case "qoder":
    case "trae":
      return null;
    // agents-file surfaces (own + the 3 IDE dereferences) - no HostKind, never a pane
    default:
      return null;
  }
}
function isDroppedHostKind(hk) {
  return hostKindToRegistryId(hk) === null && String(hk).startsWith("gemini");
}
var HOSTKIND_TO_REGISTRY_ID, HOST_ID_SET2, LEGACY_HOST_ALIASES, PREFIX_COLLAPSE;
var init_host_id_namespace = __esm({
  "src/domains/config/host-id-namespace.ts"() {
    init_host_registry_schema();
    HOSTKIND_TO_REGISTRY_ID = {
      claude: "claude-code-cli",
      "claude-code-desktop": "claude-code-app",
      // legacy desktop alias
      "claude-code-web": "claude-code-web",
      "claude-ai-connector": "claude-ai-connector",
      // remote MCP control plane
      codex: "codex-cli",
      "codex-app": "codex-app",
      pi: "pi-cli",
      "antigravity-2": "antigravity-cli",
      // G4b (host-reachability): identity mapping — the wrapped-CLI HostKind
      // literals ARE their registry host_id, so no alias translation is needed.
      cursor: "cursor",
      "github-copilot": "github-copilot",
      opencode: "opencode",
      "rovo-dev": "rovo-dev"
    };
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
    PREFIX_COLLAPSE = [
      { prefix: "antigravity", id: "antigravity-cli" },
      { prefix: "claude", id: "claude-code-cli" },
      { prefix: "codex", id: "codex-cli" }
    ];
  }
});

// src/domains/config/adapter-fallback-ladders.ts
function rungLoss(r) {
  return RUNGS.indexOf(r);
}
function isHostInferred(host) {
  return INFERRED_HOSTS.has(host);
}
function resolveRung(surface, host) {
  const known2 = HOST_IDS.includes(host);
  if (!known2) {
    return {
      schema_version: "guild.degradation_receipt.v1",
      surface,
      host,
      rung: "degraded",
      degraded: true,
      inferred: false,
      reason: `unknown host "${host}" - no ladder entry; degraded + recorded (minimum-loss rule)`
    };
  }
  const hid = host;
  const rung = FALLBACK_LADDER_TABLE[surface][hid];
  const inferred = isHostInferred(hid);
  return {
    schema_version: "guild.degradation_receipt.v1",
    surface,
    host: hid,
    rung,
    degraded: rungLoss(rung) > 0,
    inferred,
    reason: `${surface}@${hid} resolves to "${rung}"${inferred ? " (INFERRED - verify at live-host availability)" : ""}`
  };
}
function validateDegradationReceipt(value) {
  const errors = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["degradation receipt must be a non-null object"] };
  }
  const o = value;
  if (o["schema_version"] !== "guild.degradation_receipt.v1") {
    errors.push(`schema_version must be "guild.degradation_receipt.v1"; got ${JSON.stringify(o["schema_version"])}`);
  }
  if (typeof o["surface"] !== "string" || !SURFACE_SET2.has(o["surface"])) {
    errors.push(`surface must be one of ${ADAPTER_SURFACES.join("|")}; got ${JSON.stringify(o["surface"])}`);
  }
  if (typeof o["host"] !== "string" || o["host"].trim() === "") {
    errors.push("host must be a non-empty string");
  }
  if (typeof o["rung"] !== "string" || !RUNG_SET.has(o["rung"])) {
    errors.push(`rung must be one of ${RUNGS.join("|")}; got ${JSON.stringify(o["rung"])}`);
  }
  if (typeof o["degraded"] !== "boolean") errors.push("degraded must be a boolean");
  if (typeof o["inferred"] !== "boolean") errors.push("inferred must be a boolean");
  if (typeof o["reason"] !== "string" || o["reason"].trim() === "") {
    errors.push("reason must be a non-empty string");
  }
  return { valid: errors.length === 0, errors };
}
function validateLadderTableComplete() {
  const errors = [];
  for (const surface of ADAPTER_SURFACES) {
    const row = FALLBACK_LADDER_TABLE[surface];
    if (!row) {
      errors.push(`missing surface row ${surface}`);
      continue;
    }
    for (const host of HOST_IDS) {
      const rung = row[host];
      if (!rung || !RUNG_SET.has(rung)) {
        errors.push(`ladder[${surface}][${host}] must be a valid rung; got ${JSON.stringify(rung)}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
var RUNGS, ADAPTER_SURFACES, FALLBACK_LADDER_TABLE, INFERRED_HOSTS, RUNG_SET, SURFACE_SET2;
var init_adapter_fallback_ladders = __esm({
  "src/domains/config/adapter-fallback-ladders.ts"() {
    init_host_registry_schema();
    init_kernel();
    RUNGS = Object.freeze(["native", "wrapped", "bridged", "emulated", "degraded"]);
    ADAPTER_SURFACES = Object.freeze(["interaction", "session", "semantic_tool", "browser"]);
    FALLBACK_LADDER_TABLE = {
      interaction: {
        "claude-code-cli": "native",
        // AskUserQuestion
        "codex-cli": "wrapped",
        // CLI prompt
        "agents-file": "bridged",
        // file-bus / instruction file
        "pi-cli": "wrapped",
        // VERIFIED on-host 2026-06-16: print mode
        "antigravity-cli": "wrapped",
        // VERIFIED on-host 2026-06-16: print mode
        "claude-code-app": "degraded",
        "claude-code-web": "degraded",
        "codex-app": "degraded",
        "claude-ai-connector": "degraded",
        // new-CLI (INFERRED) — wrapper CLI prompt
        cursor: "wrapped",
        "github-copilot": "wrapped",
        opencode: "wrapped",
        "rovo-dev": "wrapped",
        // new-IDE (INFERRED) — dereference agents-file (bridged file-bus / instruction file)
        kiro: "bridged",
        qoder: "bridged",
        trae: "bridged"
      },
      session: {
        "claude-code-cli": "native",
        // session id/resume
        "codex-cli": "wrapped",
        // run-dir state
        "agents-file": "emulated",
        // re-bootstrap through instruction file
        "pi-cli": "native",
        // VERIFIED on-host 2026-06-16: --resume/-r + --session-id + --fork
        "antigravity-cli": "wrapped",
        // VERIFIED on-host 2026-06-16: --continue/-c + --conversation <id>
        "claude-code-app": "degraded",
        "claude-code-web": "degraded",
        "codex-app": "degraded",
        "claude-ai-connector": "degraded",
        // new-CLI (INFERRED) — no native session in the inferred caps row; re-bootstrap
        cursor: "emulated",
        "github-copilot": "emulated",
        opencode: "emulated",
        "rovo-dev": "emulated",
        // new-IDE (INFERRED) — mirror agents-file (re-bootstrap through the instruction file)
        kiro: "emulated",
        qoder: "emulated",
        trae: "emulated"
      },
      semantic_tool: {
        "claude-code-cli": "native",
        // tool names
        "codex-cli": "bridged",
        // name map
        "agents-file": "bridged",
        // instruction/file-bus name map
        "pi-cli": "bridged",
        // VERIFIED on-host 2026-06-16: read/bash/edit/write + --tools allowlist
        "antigravity-cli": "bridged",
        "claude-code-app": "degraded",
        "claude-code-web": "degraded",
        "codex-app": "degraded",
        "claude-ai-connector": "degraded",
        // new-CLI (INFERRED) — tool-name map over the wrapper
        cursor: "bridged",
        "github-copilot": "bridged",
        opencode: "bridged",
        "rovo-dev": "bridged",
        // new-IDE (INFERRED) — mirror agents-file (instruction/file-bus name map)
        kiro: "bridged",
        qoder: "bridged",
        trae: "bridged"
      },
      browser: {
        "claude-code-cli": "bridged",
        // chrome-devtools MCP
        "codex-cli": "bridged",
        // MCP
        "agents-file": "degraded",
        // none
        "pi-cli": "degraded",
        // VERIFIED on-host 2026-06-16: no browser tool in help output
        "antigravity-cli": "native",
        // host browser control - still inferred until live-host confirmation
        "claude-code-app": "degraded",
        "claude-code-web": "degraded",
        "codex-app": "degraded",
        "claude-ai-connector": "degraded",
        // new-CLI (INFERRED) — inferred caps row has no browser tool
        cursor: "degraded",
        "github-copilot": "degraded",
        opencode: "degraded",
        "rovo-dev": "degraded",
        // new-IDE (INFERRED) — mirror agents-file (none)
        kiro: "degraded",
        qoder: "degraded",
        trae: "degraded"
      }
    };
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
    SURFACE_SET2 = new Set(ADAPTER_SURFACES);
  }
});

// src/domains/config/host-profiles-validate.ts
function isPlainObject2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function validateHostProfiles(hp) {
  const rejects = [];
  for (const [hostId, entry] of Object.entries(hp)) {
    const canonicalHostId = normalizeHostId(hostId);
    if (!canonicalHostId) {
      rejects.push(
        `unknown host_profiles host_id "${hostId}" (closed key set \u2014 valid: ${[...KNOWN_HOST_IDS].join("|")})`
      );
      continue;
    }
    if (!isPlainObject2(entry)) {
      rejects.push(`host_profiles["${hostId}"] must be an object { models?, enabled? }`);
      continue;
    }
    const e = entry;
    for (const ek of Object.keys(e)) {
      if (!VALID_HOST_PROFILE_ENTRY_KEYS.has(ek)) {
        rejects.push(
          `unknown host_profiles["${hostId}"] key "${ek}" (closed entry shape \u2014 only models, enabled)`
        );
      }
    }
    if (e["enabled"] !== void 0 && typeof e["enabled"] !== "boolean") {
      rejects.push(`host_profiles["${hostId}"].enabled must be a boolean (got ${JSON.stringify(e["enabled"])})`);
    }
    if (e["models"] !== void 0) {
      if (!isPlainObject2(e["models"])) {
        rejects.push(`host_profiles["${hostId}"].models must be an object { cheap?, mid?, powerful? }`);
      } else {
        const m = e["models"];
        for (const mk of Object.keys(m)) {
          if (!VALID_HOST_PROFILE_MODEL_KEYS.has(mk)) {
            rejects.push(
              `unknown host_profiles["${hostId}"].models key "${mk}" (closed key set \u2014 only cheap, mid, powerful)`
            );
          } else if (typeof m[mk] !== "string" || !m[mk].trim()) {
            rejects.push(`host_profiles["${hostId}"].models.${mk} must be a non-empty string (got ${JSON.stringify(m[mk])})`);
          }
        }
      }
    }
  }
  return rejects;
}
function filterHostProfiles(raw) {
  const out = {};
  for (const [hostId, entry] of Object.entries(raw)) {
    if (validateHostProfiles({ [hostId]: entry }).length === 0) {
      const canonicalHostId = normalizeHostId(hostId);
      if (canonicalHostId) out[canonicalHostId] = entry;
    }
  }
  return out;
}
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
function getRegistryEntry(id) {
  return HOST_REGISTRY_ROWS[id] ?? null;
}
function getRegistryEntryForHostKind(hk) {
  const id = hostKindToRegistryId(hk);
  return id === null ? null : getRegistryEntry(id);
}
function resultAdapterForFamily(family) {
  return FAMILY_TO_ROW[family]?.result_adapter ?? false;
}
function resultAdapterForHostId(id) {
  return getRegistryEntry(id)?.result_adapter ?? false;
}
function resultAdapterForHostKind(hk) {
  return getRegistryEntryForHostKind(hk)?.result_adapter ?? false;
}
function dispatchSelectableForHostId(id) {
  return getRegistryEntry(id)?.dispatch_selectable ?? false;
}
function installabilityForHostId(id) {
  return getRegistryEntry(id)?.installability ?? "none";
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
function receipt(host, operation, status, reason, degradationReceipt) {
  return {
    schema_version: "guild.host_adapter_receipt.v1",
    host,
    operation,
    status,
    reason,
    ...degradationReceipt ? { degradation_receipt: degradationReceipt } : {}
  };
}
function result(host, operation, status, reason, value, degradationReceipt) {
  return {
    schema_version: "guild.host_adapter_result.v1",
    host,
    operation,
    status,
    value,
    receipt: receipt(host, operation, status, reason, degradationReceipt)
  };
}
function runtimeReceipts(host) {
  return {
    interaction: resolveRung("interaction", host),
    session: resolveRung("session", host),
    semantic_tool: resolveRung("semantic_tool", host),
    browser: resolveRung("browser", host)
  };
}
function operationReceipt(host, operation) {
  const surface = OPERATION_TO_RUNTIME_SURFACE[operation];
  return surface ? resolveRung(surface, host) : void 0;
}
function packageStatus(entry) {
  if (entry.installability === "native") return "ok";
  if (entry.installability === "target") return "degraded";
  return "unavailable";
}
function bootstrapStatus(entry) {
  const caps = entry.capabilities.bootstrap;
  return caps.context_injection || caps.wrapper_injection || caps.prompt_transform ? "degraded" : "unavailable";
}
function commandStatus(entry) {
  const caps = entry.capabilities.commands;
  if (caps.slash_commands || caps.command_files !== "none") return "ok";
  return entry.surface_kind === "app" ? "unavailable" : "degraded";
}
function permissionStatus(entry) {
  const caps = entry.capabilities.permissions;
  if (caps.deny || caps.ask || caps.permission_prompt_layer) return "ok";
  return "degraded";
}
function memoryStatus(entry) {
  const mcp = entry.capabilities.mcp;
  return mcp.stdio || mcp.http || entry.capabilities.artifacts.file_bus || entry.capabilities.artifacts.direct_filesystem ? "degraded" : "unavailable";
}
function modelParams(entry, request) {
  const configured = request.params && typeof request.params === "object" ? request.params : {};
  const registryModel = entry.capabilities.models[request.tier]?.model ?? null;
  const model = typeof configured["model"] === "string" ? configured["model"] : registryModel;
  if (!model) return null;
  return { ...configured, model };
}
function unsupportedModelParamKeys(params, supportedKeys) {
  const supported = new Set(supportedKeys);
  return Object.keys(params).filter((key) => !supported.has(key));
}
function unavailableOperations(entry) {
  const operations = [];
  if (bootstrapStatus(entry) === "unavailable") operations.push("bootstrap");
  if (!entry.dispatch_selectable) operations.push("dispatch");
  if (commandStatus(entry) === "unavailable") operations.push("renderCommandSurface");
  if (packageStatus(entry) === "unavailable") operations.push("renderPackage");
  if (memoryStatus(entry) === "unavailable") operations.push("memory");
  return operations;
}
function createHostAdapter(host) {
  const hostId = normalizeHostId(host);
  const entry = hostId ? HOST_REGISTRY_ROWS[hostId] : null;
  const adapterHost = hostId ?? host;
  function unavailable(operation) {
    const degradationReceipt = operationReceipt(adapterHost, operation);
    return result(
      adapterHost,
      operation,
      "unavailable",
      `unknown host "${host}" \u2014 no HostAdapter registry entry; fail-closed to unavailable`,
      null,
      degradationReceipt
    );
  }
  function contractOnly(operation, status, reason, value = null) {
    return result(adapterHost, operation, status, reason, value, operationReceipt(adapterHost, operation));
  }
  return {
    host: adapterHost,
    hostId,
    capabilities() {
      const receipts = runtimeReceipts(adapterHost);
      if (!entry || !hostId) {
        return {
          schema_version: "guild.host_adapter_capabilities.v1",
          host: adapterHost,
          host_id: null,
          known: false,
          family: null,
          surface_kind: null,
          installability: "unknown",
          result_adapter: false,
          dispatch_selectable: false,
          provenance: "unknown",
          runtime_surfaces: receipts,
          unavailable_operations: HOST_ADAPTER_OPERATIONS.filter((op) => op !== "capabilities")
        };
      }
      return {
        schema_version: "guild.host_adapter_capabilities.v1",
        host: adapterHost,
        host_id: hostId,
        known: true,
        family: entry.family,
        surface_kind: entry.surface_kind,
        installability: entry.installability,
        result_adapter: entry.result_adapter,
        dispatch_selectable: entry.dispatch_selectable,
        provenance: entry.provenance,
        runtime_surfaces: receipts,
        unavailable_operations: unavailableOperations(entry)
      };
    },
    bootstrap(request) {
      if (!entry) return unavailable("bootstrap");
      const status = bootstrapStatus(entry);
      return contractOnly(
        "bootstrap",
        status,
        status === "degraded" ? "bootstrap primitive exists, but concrete host bootstrap is wired in later adapter runs" : "host advertises no bootstrap primitive",
        request ?? {}
      );
    },
    preflight(request) {
      if (!entry) return unavailable("preflight");
      const hooks = entry.capabilities.hooks;
      const hasNativeHook = Object.values(hooks).some(Boolean);
      const reason = hasNativeHook ? "native hook is advertised; concrete hook binding remains host-adapter runtime work" : "no native hook advertised; preflight must use fallback ladder and record degradation";
      return contractOnly(
        "preflight",
        "degraded",
        reason,
        request ?? {}
      );
    },
    dispatch(request) {
      if (!entry) return unavailable("dispatch");
      if (!entry.dispatch_selectable) {
        return contractOnly("dispatch", "unavailable", "host is known but not dispatch-selectable", request);
      }
      return contractOnly("dispatch", "degraded", "dispatch contract accepted; concrete execution adapter is wired in later runs", request);
    },
    collect(request) {
      if (!entry) return unavailable("collect");
      return contractOnly("collect", "degraded", "collection uses file-bus/session fallback until concrete adapter collect is wired", request ?? {});
    },
    renderCommandSurface(request) {
      if (!entry) return unavailable("renderCommandSurface");
      return contractOnly(
        "renderCommandSurface",
        commandStatus(entry),
        commandStatus(entry) === "ok" ? "host advertises a command surface" : "host lacks native command surface; use instructions/file-bus",
        request ?? {}
      );
    },
    renderPackage(request) {
      if (!entry) return unavailable("renderPackage");
      const status = packageStatus(entry);
      return result(
        adapterHost,
        "renderPackage",
        status,
        status === "ok" ? "host has a verified native package install path" : status === "degraded" ? "package renderer/target exists but install is not verified" : "host has no installable package surface",
        { installability: entry.installability, request: request ?? {} },
        operationReceipt(adapterHost, "renderPackage")
      );
    },
    renderPermissionDecision(request) {
      if (!entry) return unavailable("renderPermissionDecision");
      return contractOnly(
        "renderPermissionDecision",
        permissionStatus(entry),
        permissionStatus(entry) === "ok" ? "host advertises a permission decision primitive" : "permission decision must be recorded as degraded",
        request
      );
    },
    resolveModelParams(request) {
      if (!entry) return unavailable("resolveModelParams");
      const params = modelParams(entry, request);
      if (!params) {
        return result(
          adapterHost,
          "resolveModelParams",
          "degraded",
          `no model configured for ${request.tier} on ${adapterHost}; later dispatch must record unsupported model params`,
          null,
          operationReceipt(adapterHost, "resolveModelParams")
        );
      }
      const unsupported = unsupportedModelParamKeys(params, ["model"]);
      if (unsupported.length > 0) {
        return result(
          adapterHost,
          "resolveModelParams",
          "degraded",
          `model params resolved, but ${adapterHost} default adapter cannot enforce unsupported key(s): ${unsupported.join(", ")}`,
          {
            modelParams: params,
            unsupported_model_params: unsupported
          },
          operationReceipt(adapterHost, "resolveModelParams")
        );
      }
      return result(
        adapterHost,
        "resolveModelParams",
        "ok",
        "model parameter dictionary resolved with registry/default model only",
        { modelParams: params },
        operationReceipt(adapterHost, "resolveModelParams")
      );
    },
    memory(request) {
      if (!entry) return unavailable("memory");
      const status = memoryStatus(entry);
      return contractOnly(
        "memory",
        status,
        status === "degraded" ? "memory access must route through MCP, bridge, filesystem, or file-bus fallback in later memory adapter run" : "host advertises no memory transport",
        request
      );
    }
  };
}
function createAllHostAdapters() {
  const out = {};
  for (const hostId of HOST_IDS) out[hostId] = createHostAdapter(hostId);
  return out;
}
var HOST_ADAPTER_CONTRACT_VERSION, HOST_ADAPTER_OPERATIONS, OPERATION_TO_RUNTIME_SURFACE;
var init_host_adapter_contract = __esm({
  "src/domains/config/host-adapter-contract.ts"() {
    init_host_registry_schema();
    init_host_id_namespace();
    init_adapter_fallback_ladders();
    HOST_ADAPTER_CONTRACT_VERSION = "guild.host_adapter.v1.0.0";
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
    OPERATION_TO_RUNTIME_SURFACE = {
      bootstrap: "session",
      preflight: "session",
      dispatch: "semantic_tool",
      collect: "session",
      renderCommandSurface: "semantic_tool",
      renderPermissionDecision: "semantic_tool",
      resolveModelParams: "semantic_tool",
      memory: "semantic_tool"
    };
  }
});

// src/domains/state/plugin-install-guard.ts
function assertNotUnderPluginInstall(absPath, pluginInstallRoot) {
  const root = pluginInstallRoot ?? process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"] ?? process.env["CODEX_PLUGIN_ROOT"];
  if (!root) return;
  const resolvedRoot = path4.resolve(root);
  const rel2 = path4.relative(resolvedRoot, path4.resolve(absPath));
  if (rel2 === "" || !rel2.startsWith("..") && !path4.isAbsolute(rel2)) {
    const underOwnDotGuild = rel2 === ".guild" || rel2.startsWith(`.guild${path4.sep}`);
    if (underOwnDotGuild && fs3.existsSync(path4.join(resolvedRoot, ".git"))) return;
    throw new Error(`project-created Guild artifact would be written under plugin install dir: ${absPath}`);
  }
}
var fs3, path4;
var init_plugin_install_guard = __esm({
  "src/domains/state/plugin-install-guard.ts"() {
    fs3 = __toESM(require("node:fs"));
    path4 = __toESM(require("node:path"));
  }
});

// src/domains/state/atomic-write.ts
function atomicWrite(targetPath, content, pluginInstallRoot) {
  writeThroughTemp(targetPath, content, false, pluginInstallRoot);
}
function writeThroughTemp(targetPath, content, durable, pluginInstallRoot) {
  assertNotUnderPluginInstall(targetPath, pluginInstallRoot);
  const dir = path5.dirname(targetPath);
  fs4.mkdirSync(dir, { recursive: true });
  const unique = `${process.pid}-${Date.now()}-${crypto2.randomBytes(4).toString("hex")}`;
  const tmpPath = path5.join(dir, `.${path5.basename(targetPath)}.tmp-${unique}`);
  if (durable) {
    const fd = fs4.openSync(tmpPath, "w");
    try {
      fs4.writeFileSync(fd, content, "utf8");
      fs4.fsyncSync(fd);
    } finally {
      fs4.closeSync(fd);
    }
  } else {
    fs4.writeFileSync(tmpPath, content, "utf8");
  }
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
var fs4, path5, crypto2;
var init_atomic_write = __esm({
  "src/domains/state/atomic-write.ts"() {
    fs4 = __toESM(require("fs"));
    path5 = __toESM(require("path"));
    crypto2 = __toESM(require("crypto"));
    init_plugin_install_guard();
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
  const digest = crypto3.createHash("sha256").update(abs).digest("hex").slice(0, 12);
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
var crypto3, os, path6, OVERRIDE_KEYS, GUILD_NAMESPACE;
var init_storage_roots = __esm({
  "src/domains/state/storage-roots.ts"() {
    crypto3 = __toESM(require("node:crypto"));
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
var init_frontmatter = __esm({
  "src/domains/state/frontmatter.ts"() {
    init_kernel();
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
  const manifest = readWorkspaceManifest(parent);
  if (manifest?.is_workspace && Array.isArray(manifest.sub_guilds)) {
    for (const entry of manifest.sub_guilds) {
      if (typeof entry.name !== "string" || typeof entry.path !== "string") continue;
      const childRoot = path8.resolve(parent, entry.path);
      if (childRoot === activeResolved) return { root: parent, entry };
    }
    return null;
  }
  try {
    if (!fs6.lstatSync(activeResolved).isDirectory()) return null;
  } catch {
    return null;
  }
  const hasGit = fs6.existsSync(path8.join(activeRoot, ".git"));
  const hasGuild = fs6.existsSync(path8.join(activeRoot, ".guild"));
  if (!hasGit && !hasGuild) return null;
  const name = path8.basename(activeResolved);
  return {
    root: parent,
    entry: {
      name,
      path: name,
      kind: hasGuild ? "sub-guild" : "sub-project",
      has_wiki: fs6.existsSync(path8.join(activeRoot, ".guild", "wiki")),
      has_indexes: fs6.existsSync(path8.join(activeRoot, ".guild", "indexes"))
    }
  };
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

// src/domains/state/snapshot-digest.ts
var init_snapshot_digest = __esm({
  "src/domains/state/snapshot-digest.ts"() {
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
  const result2 = runMigrations(dbPath);
  if (result2.ok) {
    process.stdout.write(
      `[index-migrate] OK: schema v${result2.fromVersion}\u2192v${result2.toVersion} at ${result2.dbPath}
`
    );
  } else {
    process.stderr.write(`[index-migrate] WARN: ${result2.message}
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
  const rel2 = path10.relative(path10.resolve(guildDir), path10.resolve(abs));
  return rel2 === "" || !rel2.startsWith("..") && !path10.isAbsolute(rel2);
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
  let realRoot2;
  try {
    real = fs8.realpathSync(abs);
    realRoot2 = fs8.realpathSync(root);
  } catch {
    return null;
  }
  const rel2 = path11.relative(realRoot2, real);
  if (rel2 === "" || rel2.startsWith("..") || path11.isAbsolute(rel2)) return null;
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
function hostCapabilityCacheDir(cwd, hostId) {
  const storage = createGuildStorage(realRoot(cwd));
  return hostId === void 0 ? storage.cache("hosts") : storage.cache("hosts", hostId);
}
function realRoot(cwd) {
  try {
    return fs9.realpathSync(cwd);
  } catch {
    return cwd;
  }
}
function modelCatalogCacheHome(cwd) {
  return createGuildStorage(realRoot(cwd)).cache("model-catalog");
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
var LOCK_STALE_MS;
var init_upgrade_journal = __esm({
  "src/domains/state/upgrade-journal.ts"() {
    LOCK_STALE_MS = 15 * 60 * 1e3;
  }
});

// src/domains/state/upgrade-steps.ts
function classifyPath(relToGuild) {
  const rel2 = relToGuild.split(path13.sep).join("/");
  return DERIVED_PATTERNS.some((re) => re.test(rel2)) ? "derived" : "durable";
}
function rel(ctx, abs) {
  return path13.relative(ctx.root, abs).split(path13.sep).join("/");
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
    return fs10.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}
function writeFile(ctx, abs, text) {
  if (ctx.dryRun) return;
  fs10.mkdirSync(path13.dirname(abs), { recursive: true });
  fs10.writeFileSync(abs, text, "utf8");
}
function sha256(text) {
  return crypto4.createHash("sha256").update(text).digest("hex");
}
function filesUnder(dir, out = []) {
  for (const name of readdirSafe(dir)) {
    const abs = path13.join(dir, name);
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
      const wasNonEmptyMapping = isPlainObject3(item) && Object.keys(item).length > 0;
      const next = expectedAfterStrip(item, cfg);
      if (wasNonEmptyMapping && isPlainObject3(next) && Object.keys(next).length === 0) continue;
      out2.push(next);
    }
    return out2;
  }
  if (!isPlainObject3(node)) return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (isIdentityEntry(key, void 0, value, cfg)) continue;
    out[key] = expectedAfterStrip(value, cfg);
  }
  return out;
}
function isPlainObject3(v) {
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
  if (isPlainObject3(a) || isPlainObject3(b)) {
    if (!isPlainObject3(a) || !isPlainObject3(b)) return false;
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
  const yaml2 = loadYamlApi();
  let doc;
  try {
    doc = yaml2.load(text);
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
    after = yaml2.load(next);
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
var crypto4, fs10, path13, KNOWLEDGE_PREFIX, DERIVED_PATTERNS, v1Content, settingsPolicySplit, PINNED_KEYS, TIMESTAMP_RE, BLOCK_SCALAR, MAP_ENTRY, ktd22Strip, CACHE_TARGETS, cachesOut, TERMINAL_STATUSES, closedRunReceipts, currentRunIdRetire, LEGACY_VERSION_TREE, skillVersionsDelete, AUTHORED_REGISTRIES, DERIVED_REGISTRIES, registryYamlRetire, glossaryCreate, UPGRADE_STEPS, UPGRADE_STEP_IDS;
var init_upgrade_steps = __esm({
  "src/domains/state/upgrade-steps.ts"() {
    crypto4 = __toESM(require("node:crypto"));
    fs10 = __toESM(require("node:fs"));
    path13 = __toESM(require("node:path"));
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
        const legacy = readIfFile(path13.join(ctx.guildDir, "settings.json"));
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
        const roots = ["initiatives", "team", "teams"].map((d) => path13.join(ctx.guildDir, d));
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
          const abs = path13.join(ctx.guildDir, name);
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
            fs10.rmSync(abs, { force: true });
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
        const runsDir = path13.join(ctx.guildDir, "runs");
        if (!isContainedRealDir(runsDir, ctx.guildDir)) {
          return { status: "skipped", detail: "no .guild/runs tree", paths: [] };
        }
        const written = [];
        let open = 0;
        for (const name of readdirSafe(runsDir)) {
          if (name.startsWith("_")) continue;
          const runDir = path13.join(runsDir, name);
          if (!isContainedRealDir(runDir, ctx.guildDir)) continue;
          const receipt2 = path13.join(runDir, "receipt.json");
          if (lstatSafe(receipt2)) continue;
          const runYaml = readIfFile(path13.join(runDir, "run.yaml"));
          if (runYaml === null) continue;
          const status = terminalRunStatus(runYaml);
          if (status === null) {
            open += 1;
            continue;
          }
          writeFile(
            ctx,
            receipt2,
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
          written.push(rel(ctx, receipt2));
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
        const abs = path13.join(ctx.guildDir, "current-run-id");
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
        if (!ctx.dryRun) fs10.rmSync(abs, { force: true });
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
        const dir = path13.join(ctx.guildDir, LEGACY_VERSION_TREE);
        if (!isContainedRealDir(dir, ctx.guildDir)) {
          return { status: "skipped", detail: `no leftover ${LEGACY_VERSION_TREE} tree`, paths: [] };
        }
        const snapshots = filesUnder(dir);
        if (snapshots.length === 0) {
          if (!ctx.dryRun) removeContainedTree(dir, ctx.guildDir);
          return { status: "completed", detail: `removed the empty ${LEGACY_VERSION_TREE} tree`, paths: [rel(ctx, dir)] };
        }
        const live = /* @__PURE__ */ new Set();
        const skillsDir = path13.join(ctx.guildDir, "skills");
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
          const abs = path13.join(ctx.guildDir, relPath);
          if (!lstatSafe(abs)) continue;
          if (classifyPath(relPath) !== "derived") continue;
          if (!ctx.dryRun) fs10.rmSync(abs, { force: true });
          changed.push(rel(ctx, abs));
        }
        for (const relPath of AUTHORED_REGISTRIES) {
          const abs = path13.join(ctx.guildDir, relPath);
          const text = readIfFile(abs);
          if (text === null) continue;
          const target = path13.join(ctx.guildDir, "artifacts", "legacy", relPath.replace("/", "-"));
          if (lstatSafe(target)) continue;
          writeFile(ctx, target, text);
          if (!ctx.dryRun) fs10.rmSync(abs, { force: true });
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
var init_upgrade_runner = __esm({
  "src/domains/state/upgrade-runner.ts"() {
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
  const manifestPath = path14.join(durableGuildDir(root), "workspace.json");
  if (!fs11.existsSync(manifestPath)) {
    throw new Error(`workspace.json not found at ${manifestPath}`);
  }
  const manifest = JSON.parse(fs11.readFileSync(manifestPath, "utf8"));
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
    const subAbsPath = path14.resolve(root, sg.path);
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
  if (!fs11.existsSync(path14.join(durableGuildDir(cwd), "workspace.json"))) {
    process.stderr.write(
      `[workspace/federated-query] ERROR: no workspace.json at ${path14.join(durableGuildDir(cwd), "workspace.json")}
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
var fs11, path14;
var init_federated_query = __esm({
  "src/domains/state/federated-query.ts"() {
    fs11 = __toESM(require("fs"));
    path14 = __toESM(require("path"));
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
  const manifestPath = path15.join(durableGuildDir(workspaceRoot2), "workspace.json");
  if (!fs12.existsSync(manifestPath)) return [];
  try {
    const raw = JSON.parse(fs12.readFileSync(manifestPath, "utf8"));
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
  const runsDir = path15.join(durableGuildDir(childDir), "runs");
  if (!fs12.existsSync(runsDir)) return [];
  const results = [];
  try {
    const runIds = fs12.readdirSync(runsDir);
    for (const runId of runIds) {
      const candidate = path15.join(runsDir, runId, "learn", "harvest-candidates.json");
      if (fs12.existsSync(candidate)) {
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
    raw = JSON.parse(fs12.readFileSync(harvestPath, "utf8"));
  } catch {
    return [];
  }
  const sourcePath = path15.relative(workspaceRoot2, harvestPath);
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
    const childDir = path15.join(workspaceRoot2, child.path);
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
  if (!fs12.existsSync(workspaceRoot2) || !fs12.statSync(workspaceRoot2).isDirectory()) {
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
    const runsBase = path15.resolve(durableGuildDir(workspaceRoot2), "runs");
    const runsDir = path15.join(runsBase, runId);
    const manifestPath = path15.join(runsDir, "upstream-candidates.json");
    const resolvedRunsDir = path15.resolve(runsDir);
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
var fs12, path15;
var init_promote_upstream = __esm({
  "src/domains/state/promote-upstream.ts"() {
    fs12 = __toESM(require("fs"));
    path15 = __toESM(require("path"));
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
    init_snapshot_digest();
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

// src/domains/config/provider-detect.ts
function resolveAuthorHost(host) {
  if (host === void 0 || host === "auto" || host === "") return "unknown";
  if (host.startsWith("antigravity")) return "antigravity";
  if (host.startsWith("claude")) return "claude";
  if (host.startsWith("codex")) return "codex";
  if (KNOWN_FAMILIES.has(host)) return host;
  return "unknown";
}
function probeAuth(spec, probe) {
  switch (spec.family) {
    case "codex":
      return probe.readStoredCodexAuth() || !!probe.readEnv("OPENAI_API_KEY");
    // (The `gemini` auth case was removed when Gemini was sunset 2026-06-14.)
    default:
      return false;
  }
}
function detectProviders(opts) {
  const probe = opts.probe ?? defaultProbeEnv(opts.cwd);
  const authorHost = resolveAuthorHost(opts.host);
  const declared = new Set(safe(() => probe.readCapabilityProviders(), []));
  const providers = PROVIDER_REGISTRY.map((spec) => {
    if (spec.kind === "host") {
      return {
        id: spec.id,
        kind: spec.kind,
        family: spec.family,
        detected: true,
        authed: false,
        // not an auth concept for the host itself
        selectable: false,
        // never a CROSS reviewer for a same-family author
        detail: "current author host"
      };
    }
    const byPlugin = spec.kind === "plugin-adapter" && safe(() => probe.readPluginAdapter(spec.id), false);
    const onPath = !!spec.bin && safe(() => probe.commandOnPath(spec.bin), false);
    const versionOk = onPath && safe(() => probe.probeVersion(spec.bin), false);
    const byManifest = declared.has(spec.id) || declared.has(spec.family);
    const detected = spec.kind === "plugin-adapter" ? byPlugin || byManifest : versionOk || byManifest;
    const authed = detected ? safe(() => probeAuth(spec, probe), false) : false;
    const selectable = spec.hasAdapter && detected && (!spec.requiresAuth || authed);
    const detail = describe(spec, { onPath, versionOk, byManifest, byPlugin, authed, selectable });
    return {
      id: spec.id,
      kind: spec.kind,
      family: spec.family,
      detected,
      authed,
      selectable,
      detail
    };
  });
  return {
    authorHost,
    // R3-F1: the field is NEVER dropped. The type requires `trust`, but a
    // plain-JS caller can still omit it — normalize that to "asserted" so an
    // omitted trust can never read as more trustworthy than a stated one.
    authorTrust: opts.trust ?? "asserted",
    providers
  };
}
function describe(spec, s) {
  const bits = [];
  if (s.byPlugin) bits.push(`native plugin adapter '${spec.id}' installed`);
  if (s.versionOk) bits.push(`${spec.bin} on PATH (version ok)`);
  else if (s.onPath) bits.push(`${spec.bin} on PATH (version probe failed)`);
  if (s.byManifest) bits.push("declared by capability.json manifest");
  if (!bits.length) bits.push("not detected");
  if (s.authed) bits.push("authed");
  if (!spec.hasAdapter) bits.push("detect-only (no adapter yet \u2014 not selectable)");
  else if (!s.selectable) bits.push("adapter present but not yet usable (detection/auth incomplete)");
  return bits.join("; ");
}
function recommendProvider(detection, resolvedReview) {
  if (resolvedReview.mode !== "cross") {
    return {
      recommended: null,
      reason: `review.mode=${resolvedReview.mode} \u2014 no cross-family recommendation needed`
    };
  }
  if (detection.authorHost === "unknown") {
    return {
      recommended: null,
      reason: "author host family is 'unknown' \u2014 cannot prove cross-family independence; identify the author host before recommending a cross-family reviewer"
    };
  }
  if (detection.authorTrust !== "verified") {
    return {
      recommended: null,
      reason: `author host identity '${detection.authorHost}' is not verified (trust: ${detection.authorTrust ?? "absent"}) \u2014 an asserted-only/unverified identity cannot prove cross-family independence until a native adapter/handshake verifies it`
    };
  }
  const ranked = rankReviewers(detection);
  if (ranked.length === 0) {
    return {
      recommended: null,
      reason: `no selectable different-family reviewer available for a ${detection.authorHost} author (pi/antigravity are detect-only until their adapters ship)`
    };
  }
  const top = ranked[0];
  const claudePref = detection.authorHost === "claude" && top.id === "codex-plugin" ? "claude author prefers the native Codex plugin adapter (codex:codex-rescue); " : "";
  return {
    recommended: top.id,
    reason: `${claudePref}recommended '${top.id}' \u2014 highest-ranked selectable ${top.family}-family reviewer`
  };
}
function selectReviewer(detection, resolvedReview) {
  if (resolvedReview.mode === "off") {
    return { provider: null, status: "skipped", reason: "review.mode=off \u2014 no review requested" };
  }
  if (resolvedReview.mode === "local") {
    return {
      provider: null,
      status: "degraded-local",
      reason: "review.mode=local \u2014 same-host review only (not adversarial cross-family)"
    };
  }
  const { authorHost } = detection;
  if (authorHost === "unknown") {
    const unknownReason = "author host family is 'unknown' \u2014 cannot prove cross-family independence; identify the author host to enable review=cross";
    const anyDetected = detection.providers.some((p) => p.kind !== "host" && p.detected);
    return {
      provider: null,
      status: anyDetected ? "degraded-local" : "skipped",
      reason: unknownReason
    };
  }
  if (detection.authorTrust !== "verified") {
    const assertedReason = `author host identity '${authorHost}' is not verified (trust: ${detection.authorTrust ?? "absent"}) \u2014 an asserted-only/unverified identity cannot prove cross-family independence; verify the author identity (native adapter/handshake) to enable review=cross`;
    const anyDetected = detection.providers.some((p) => p.kind !== "host" && p.detected);
    return {
      provider: null,
      status: anyDetected ? "degraded-local" : "skipped",
      reason: assertedReason
    };
  }
  if (resolvedReview.provider !== "auto") {
    const pinned = detection.providers.find((p) => p.id === resolvedReview.provider);
    if (!pinned) {
      return {
        provider: null,
        status: "skipped",
        reason: `pinned provider '${resolvedReview.provider}' is unknown \u2014 not selectable for review=cross`
      };
    }
    if (pinned.family === authorHost) {
      return {
        provider: null,
        status: "skipped",
        reason: `pinned provider '${pinned.id}' is the same family (${pinned.family}) as the author host \u2014 a same-family reviewer cannot satisfy review=cross (self-review)`
      };
    }
    if (!pinned.selectable) {
      return {
        provider: null,
        status: "skipped",
        reason: `pinned provider '${pinned.id}' is detected but NOT selectable for review=cross (no usable adapter yet / auth incomplete) \u2014 refusing to silently substitute another provider`
      };
    }
    return {
      provider: pinned.id,
      status: "selected",
      reason: `operator-pinned '${pinned.id}' (${pinned.family} family \u2260 ${authorHost} author) selected`
    };
  }
  const ranked = rankReviewers(detection);
  if (ranked.length > 0) {
    const top = ranked[0];
    return {
      provider: top.id,
      status: "selected",
      reason: `auto-selected '${top.id}' \u2014 highest-ranked selectable ${top.family}-family reviewer`
    };
  }
  const anyOther = detection.providers.some(
    (p) => p.kind !== "host" && (p.detected || p.authed)
  );
  if (anyOther) {
    return {
      provider: null,
      status: "degraded-local",
      reason: `no DIFFERENT-family selectable reviewer for a ${authorHost} author \u2014 only same-family or detect-only providers present; degrading to weak/local review (NOT adversarial)`
    };
  }
  return {
    provider: null,
    status: "skipped",
    reason: `no reviewer available and review=cross \u2014 skipped with reason (NOT a sign-off). Install/authenticate a different-family reviewer (e.g. the Codex plugin) to satisfy the cross gate`
  };
}
function rankReviewers(detection) {
  const candidates = detection.providers.filter(
    (p) => p.selectable && p.family !== detection.authorHost
  );
  const kindRank = { "plugin-adapter": 0, cli: 1, host: 2 };
  const regOrder = new Map(PROVIDER_REGISTRY.map((s, i) => [s.id, i]));
  return candidates.sort((a, b) => {
    const k = kindRank[a.kind] - kindRank[b.kind];
    if (k !== 0) return k;
    return (regOrder.get(a.id) ?? 99) - (regOrder.get(b.id) ?? 99);
  });
}
function defaultProbeEnv(cwd) {
  return {
    commandOnPath: (bin) => safe(() => {
      (0, import_child_process.execSync)(`command -v ${shellSafe(bin)}`, { stdio: "ignore" });
      return true;
    }, false),
    probeVersion: (bin) => safe(() => {
      (0, import_child_process.execSync)(`${shellSafe(bin)} --version`, { stdio: "ignore", timeout: 5e3 });
      return true;
    }, false),
    readStoredCodexAuth: () => safe(() => {
      const home = process.env["CODEX_HOME"] || path16.join(os2.homedir(), ".codex");
      const authFile = path16.join(home, "auth.json");
      const st = fs13.statSync(authFile);
      return st.isFile() && st.size > 0;
    }, false),
    readEnv: (name) => process.env[name],
    readCapabilityProviders: () => safe(() => readCapabilityManifests(cwd), []),
    readPluginAdapter: (adapterId) => (
      // The reference codex-plugin adapter (`codex:codex-rescue`) dispatches
      // through the codex binary, so in production its presence tracks the codex
      // CLI being installed. A future host could expose a richer plugin-registry
      // probe; this default is the best signal available without one.
      adapterId === "codex-plugin" ? safe(() => {
        (0, import_child_process.execSync)(`command -v codex`, { stdio: "ignore" });
        return true;
      }, false) : false
    )
  };
}
function readCapabilityManifests(cwd) {
  const hostsDir = hostCapabilityCacheDir(cwd);
  if (!fs13.existsSync(hostsDir)) return [];
  const out = /* @__PURE__ */ new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs13.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path16.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name === "capability.json") {
        try {
          const m = JSON.parse(fs13.readFileSync(full, "utf8"));
          for (const key of ["provider", "id", "family"]) {
            if (typeof m[key] === "string") out.add(m[key]);
          }
          if (Array.isArray(m["providers"])) {
            for (const p of m["providers"]) if (typeof p === "string") out.add(p);
          }
        } catch {
        }
      }
    }
  };
  walk(hostsDir);
  return Array.from(out);
}
function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
function shellSafe(bin) {
  if (!/^[A-Za-z0-9._-]+$/.test(bin)) {
    throw new Error(`refusing to probe unsafe binary name: ${bin}`);
  }
  return bin;
}
var import_child_process, fs13, os2, path16, PROVIDER_REGISTRY, KNOWN_FAMILIES;
var init_provider_detect = __esm({
  "src/domains/config/provider-detect.ts"() {
    import_child_process = require("child_process");
    fs13 = __toESM(require("fs"));
    os2 = __toESM(require("os"));
    path16 = __toESM(require("path"));
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
    KNOWN_FAMILIES = /* @__PURE__ */ new Set([
      "claude",
      "codex",
      "pi",
      "antigravity"
    ]);
  }
});

// src/domains/config/session-context.ts
function buildSessionContext(input) {
  const asserted = input.envelope_host !== void 0 && input.envelope_host !== "" ? { value: input.envelope_host, source: "invocation_envelope" } : input.env?.["GUILD_HOST_ID"] ? { value: input.env["GUILD_HOST_ID"], source: "env_guild_host_id" } : null;
  const verified2 = input.native_adapter ? { id: input.native_adapter, source: "native_adapter" } : input.handshake ? { id: input.handshake, source: "host_handshake" } : null;
  let host;
  let identity;
  if (asserted) {
    const assertedFamily = resolveAuthorHost(asserted.value);
    if (verified2 && verified2.id.family !== assertedFamily) {
      host = blockFromVerified(verified2.id);
      identity = {
        source: verified2.source,
        trust: "verified",
        confidence: "high",
        evidence: `${verified2.id.evidence}; asserted host "${asserted.value}" (${asserted.source}) REJECTED: contradicted by ${verified2.source} evidence`
      };
    } else if (verified2) {
      host = blockFromVerified(verified2.id);
      identity = {
        source: verified2.source,
        trust: "verified",
        confidence: "high",
        evidence: `${verified2.id.evidence}; confirms asserted host "${asserted.value}" (${asserted.source})`
      };
    } else {
      host = {
        family: assertedFamily,
        surface: "unknown",
        adapter_id: "unknown",
        adapter_version: "unknown"
      };
      identity = {
        source: asserted.source,
        trust: "asserted",
        confidence: assertedFamily === "unknown" ? "low" : "medium",
        evidence: `caller-asserted host "${asserted.value}" via ${asserted.source}; unverified`
      };
    }
  } else if (verified2) {
    host = blockFromVerified(verified2.id);
    identity = {
      source: verified2.source,
      trust: "verified",
      confidence: "high",
      evidence: verified2.id.evidence
    };
  } else {
    host = { family: "unknown", surface: "unknown", adapter_id: "unknown", adapter_version: "unknown" };
    identity = {
      source: "none",
      trust: "asserted",
      confidence: "low",
      evidence: "no identity source present (envelope, env, adapter, handshake all absent)"
    };
  }
  return {
    schema_version: "guild.session_context.v1",
    run_id: input.run_id,
    started_at: input.started_at,
    host,
    identity,
    execution_target: { ...UNKNOWN_TARGET, ...input.execution_target ?? {} },
    active_model: input.active_model ?? null,
    run_binding: { ...input.run_binding }
  };
}
function blockFromVerified(id) {
  const asAdapter = id;
  return {
    family: id.family,
    surface: id.surface ?? "unknown",
    adapter_id: asAdapter.adapter_id ?? "unknown",
    adapter_version: asAdapter.adapter_version ?? "unknown"
  };
}
function makeFingerprint(raw, salt) {
  return "fp-" + crypto5.createHash("sha256").update(`${salt}
${raw}`, "utf8").digest("hex");
}
function loadOrCreateFingerprintSalt(root) {
  const p = path17.join(durableGuildDir(root), "indexes", "model-catalog", ".fp-salt");
  if (fsReal.existsSync(p)) return fsReal.readFileSync(p, "utf8").trim();
  const salt = crypto5.randomBytes(32).toString("hex");
  fsReal.mkdirSync(path17.dirname(p), { recursive: true });
  fsReal.writeFileSync(p, salt + "\n", { encoding: "utf8", mode: 384 });
  return salt;
}
function realFs() {
  return {
    mkdirp: (p) => fsReal.mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => fsReal.writeFileSync(p, c, "utf8"),
    readFile: (p) => fsReal.existsSync(p) ? fsReal.readFileSync(p, "utf8") : null,
    exists: (p) => fsReal.existsSync(p)
  };
}
function sessionContextPath(root, runId) {
  return path17.join(durableGuildDir(root), "runs", runId, "session-context.json");
}
function writeSessionContext(root, ctx, fs32) {
  const f = fs32 ?? realFs();
  const p = sessionContextPath(root, ctx.run_id);
  const serialized = JSON.stringify(ctx, null, 2) + "\n";
  const existing = f.readFile(p);
  if (existing !== null) {
    if (existing === serialized) return;
    throw new Error(
      `session-context: refusing to overwrite the frozen record for ${ctx.run_id} \u2014 session_context is written once at run start and never mutated`
    );
  }
  f.mkdirp(path17.dirname(p));
  f.writeFile(p, serialized);
}
function loadSessionContext(root, runId, fs32) {
  const f = fs32 ?? realFs();
  const raw = f.readFile(sessionContextPath(root, runId));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.schema_version !== "guild.session_context.v1") return null;
    if (parsed.run_id !== runId) return null;
    return parsed;
  } catch {
    return null;
  }
}
function restoreSessionContext(root, runId, fs32) {
  const ctx = loadSessionContext(root, runId, fs32);
  if (ctx === null) {
    throw new Error(
      `session-context: no frozen record for ${runId} \u2014 resume restores the run's own snapshot; it never re-detects into an existing run`
    );
  }
  return ctx;
}
var crypto5, fsReal, path17, UNKNOWN_TARGET;
var init_session_context = __esm({
  "src/domains/config/session-context.ts"() {
    crypto5 = __toESM(require("crypto"));
    fsReal = __toESM(require("fs"));
    path17 = __toESM(require("path"));
    init_provider_detect();
    init_state();
    UNKNOWN_TARGET = {
      target_id: "unknown",
      provider_kind: "unknown",
      auth_mode: "unknown",
      account_fingerprint: "unknown",
      endpoint_fingerprint: "unknown",
      org_fingerprint: "unknown",
      tool_version: "unknown"
    };
  }
});

// src/domains/config/model-discovery-contract.ts
function isFailureReason(value) {
  return typeof value === "string" && FAILURE_REASONS.includes(value);
}
function nullIo(nowIso = "1970-01-01T00:00:00Z") {
  return { nowIso: () => nowIso, monotonicMs: () => 0 };
}
async function withBudget(work, budgetMs) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject2) => {
        timer = setTimeout(() => reject2(new DiscoveryBudgetExceeded()), budgetMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function compareVersions(a, b) {
  const pa = a.replace(/^[^0-9]*/, "").split(".").map((s) => parseInt(s, 10) || 0);
  const pb = b.replace(/^[^0-9]*/, "").split(".").map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
function toolVersionInRange(toolVersion, range) {
  if (!range) return true;
  if (!toolVersion) return false;
  return compareVersions(toolVersion, range.min) >= 0 && compareVersions(toolVersion, range.maxExclusive) < 0;
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
async function runAdapter(adapter, io, opts = {}) {
  const budgetMs = opts.budgetMs ?? DEFAULT_DISCOVERY_BUDGET_MS;
  const started = io.monotonicMs();
  const elapsed = () => Math.max(0, io.monotonicMs() - started);
  if (!toolVersionInRange(opts.toolVersion, adapter.tool_versions)) {
    return failureResult(adapter, "unsupported", "tool_version_out_of_range", elapsed(), adapter.adapter_id);
  }
  try {
    return await withBudget(adapter.discover(io, { ...opts, budgetMs }), budgetMs);
  } catch (err) {
    if (err instanceof DiscoveryBudgetExceeded) {
      return failureResult(adapter, "timeout", "timeout_budget_exceeded", elapsed(), adapter.adapter_id);
    }
    if (err instanceof DiscoveryParseRejected) {
      return failureResult(adapter, "error", "parse_rejected", elapsed(), adapter.adapter_id);
    }
    return failureResult(adapter, "error", "subprocess_failed", elapsed(), adapter.adapter_id);
  }
}
function fingerprintOrUnknown(raw, salt) {
  if (raw == null || raw === "") return "unknown";
  return makeFingerprint(raw, salt);
}
var FAILURE_REASONS, DiscoveryBudgetExceeded, DiscoveryParseRejected, DEFAULT_DISCOVERY_BUDGET_MS;
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
    DiscoveryBudgetExceeded = class extends Error {
      constructor() {
        super("discovery budget exceeded");
        this.name = "DiscoveryBudgetExceeded";
      }
    };
    DiscoveryParseRejected = class extends Error {
      constructor(detail) {
        super(`provider output rejected by schema validation: ${detail}`);
        this.name = "DiscoveryParseRejected";
      }
    };
    DEFAULT_DISCOVERY_BUDGET_MS = 3e3;
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

// src/domains/security/prose-scrub.ts
var PROSE_SECRET_LABELS, TOKEN_SHAPE_EXTRAS, PROSE_CREDENTIAL_PATTERNS;
var init_prose_scrub = __esm({
  "src/domains/security/prose-scrub.ts"() {
    init_kernel();
    init_secret_patterns();
    init_redact_log();
    init_share_set();
    PROSE_SECRET_LABELS = /* @__PURE__ */ new Set([
      "password-assignment",
      "api_key-assignment",
      "secret-assignment",
      "AWS access key",
      "GCP API key",
      "GitHub personal access token",
      "GitHub server token",
      "PEM private key block",
      "bearer-token",
      "provider-api-key",
      "Slack token",
      "GitHub token",
      "GitLab personal access token",
      "npm token",
      "HuggingFace token"
    ]);
    TOKEN_SHAPE_EXTRAS = [
      ["\\bgithub_pat_", "GitHub fine-grained token"],
      ["\\beyJ", "JWT"]
    ];
    PROSE_CREDENTIAL_PATTERNS = Object.freeze([
      // The canonical password form is case-sensitive; prose also catches `PASSWORD=`.
      ...SECRET_PATTERNS.filter(([, label]) => PROSE_SECRET_LABELS.has(label)).map(
        ([re, label]) => re.flags.includes("i") ? [re, label] : Object.freeze([new RegExp(re.source, re.flags + "i"), label])
      ),
      ...TOKEN_SHAPE_EXTRAS.flatMap(
        ([prefix, label]) => TOKEN_SHAPE_PATTERNS.filter((re) => re.source.startsWith(prefix)).map(
          (re) => Object.freeze([re, label])
        )
      )
    ]);
  }
});

// src/domains/security/scrubbed-write.ts
var init_scrubbed_write = __esm({
  "src/domains/security/scrubbed-write.ts"() {
    init_secrets();
    init_config();
    init_events();
    init_prose_scrub();
  }
});

// src/domains/security/scrub-redact.ts
function redact(content) {
  let opPaths = 0;
  let out = content.replace(OPERATOR_PATH_RE, () => {
    opPaths++;
    return WORKSPACE_ROOT_MARKER;
  });
  out = out.replace(TILDE_CLAUDE_PROJECT_RE, () => {
    opPaths++;
    return OPERATOR_MEMORY_ROOT_MARKER;
  });
  out = out.replace(PRIVATE_HOME_PATH_RE, () => {
    opPaths++;
    return PRIVATE_HOME_MARKER;
  });
  const secrets = [];
  const lines = out.split("\n");
  out = lines.map((line, i) => {
    let l = line;
    for (const [re, label] of SECRET_PATTERNS) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      if (g.test(l)) {
        secrets.push({ category: label, line: i + 1 });
        l = l.replace(
          new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"),
          `<SECRET-REDACTED:${label}>`
        );
      }
    }
    return l;
  }).join("\n");
  return { out, opPaths, secrets };
}
var OPERATOR_PATH_RE, WORKSPACE_ROOT_MARKER, TILDE_CLAUDE_PROJECT_RE, OPERATOR_MEMORY_ROOT_MARKER, PRIVATE_HOME_PATH_RE, PRIVATE_HOME_MARKER;
var init_scrub_redact = __esm({
  "src/domains/security/scrub-redact.ts"() {
    init_secret_patterns();
    init_state();
    OPERATOR_PATH_RE = /\/Users\/[^/\s]+\/Projects\/[^/\s]+/g;
    WORKSPACE_ROOT_MARKER = "<workspace-root>";
    TILDE_CLAUDE_PROJECT_RE = /~\/\.claude\/projects\/-Users-[^/\s]+-Projects-[^/\s]+/g;
    OPERATOR_MEMORY_ROOT_MARKER = "<operator-memory-root>";
    PRIVATE_HOME_PATH_RE = /\/(?:Users|home)\/[A-Za-z0-9._-]+(?=[/\s"',:;)\]}]|$)/g;
    PRIVATE_HOME_MARKER = "<private-home>";
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
    init_prose_scrub();
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

// src/domains/config/native-config-parser.ts
function skipInlineWs(c) {
  while (c.peek() === " " || c.peek() === "	") c.pos++;
}
function skipComment(c) {
  c.pos++;
  while (!c.eof() && c.peek() !== "\n") {
    const ch = c.peek();
    if (ch === "\r") {
      if (c.peek(1) === "\n") return;
      c.fail("lone carriage return in comment");
    }
    if (isForbiddenStringChar(ch)) c.fail("control character in comment");
    c.pos++;
  }
}
function skipTrivia(c, acrossNewlines) {
  for (; ; ) {
    skipInlineWs(c);
    if (c.peek() === "#") {
      skipComment(c);
      continue;
    }
    if (acrossNewlines && c.peek() === "\r" && c.peek(1) === "\n") {
      c.pos += 2;
      continue;
    }
    if (acrossNewlines && c.peek() === "\n") {
      c.pos++;
      continue;
    }
    return;
  }
}
function expectLineEnd(c) {
  skipInlineWs(c);
  if (c.peek() === "#") skipComment(c);
  if (c.eof()) return;
  if (c.peek() === "\r") c.pos++;
  if (c.peek() === "\n") {
    c.pos++;
    return;
  }
  c.fail("expected end of line");
}
function isForbiddenStringChar(ch) {
  const code = ch.charCodeAt(0);
  return code < 32 && ch !== "	" || code === 127;
}
function parseBasicString(c) {
  if (c.peek() === '"' && c.peek(1) === '"') c.fail("multi-line strings are outside the supported grammar");
  let out = "";
  for (; ; ) {
    if (c.eof()) c.fail("unterminated string");
    const ch = c.next();
    if (ch === '"') return out;
    if (ch === "\n") c.fail("newline in single-line string");
    if (isForbiddenStringChar(ch)) c.fail("control character in string");
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const esc = c.next();
    switch (esc) {
      case "b":
        out += "\b";
        break;
      case "t":
        out += "	";
        break;
      case "n":
        out += "\n";
        break;
      case "f":
        out += "\f";
        break;
      case "r":
        out += "\r";
        break;
      case '"':
        out += '"';
        break;
      case "\\":
        out += "\\";
        break;
      case "u":
      case "U": {
        const len = esc === "u" ? 4 : 8;
        const hex2 = c.src.slice(c.pos, c.pos + len);
        if (!new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(hex2)) c.fail(`invalid \\${esc} escape`);
        c.pos += len;
        const cp = parseInt(hex2, 16);
        if (cp >= 55296 && cp <= 57343 || cp > 1114111) c.fail(`non-scalar \\${esc} escape`);
        out += String.fromCodePoint(cp);
        break;
      }
      default:
        c.fail(`unknown escape \\${esc}`);
    }
  }
}
function parseLiteralString(c) {
  if (c.peek() === "'" && c.peek(1) === "'") c.fail("multi-line strings are outside the supported grammar");
  let out = "";
  for (; ; ) {
    if (c.eof()) c.fail("unterminated literal string");
    const ch = c.next();
    if (ch === "'") return out;
    if (ch === "\n") c.fail("newline in single-line string");
    if (isForbiddenStringChar(ch)) c.fail("control character in string");
    out += ch;
  }
}
function parseKeyPath(c) {
  const segments = [];
  for (; ; ) {
    skipInlineWs(c);
    let seg;
    if (c.peek() === '"') {
      c.pos++;
      seg = parseBasicString(c);
    } else if (c.peek() === "'") {
      c.pos++;
      seg = parseLiteralString(c);
    } else {
      let bare = "";
      while (BARE_KEY_RE.test(c.peek())) bare += c.next();
      if (bare === "") c.fail("expected a key");
      seg = bare;
    }
    if (UNSAFE_KEYS.has(seg)) {
      throw new NativeConfigParseError("toml-unsafe-key", `refusing unsafe key "${seg}"`);
    }
    segments.push(seg);
    skipInlineWs(c);
    if (c.peek() === ".") {
      c.pos++;
      continue;
    }
    return segments;
  }
}
function parseScalarToken(c) {
  let tok = "";
  while (!c.eof() && !/[\s,\]}#]/.test(c.peek())) tok += c.next();
  if (tok === "true") return true;
  if (tok === "false") return false;
  const dt = DATETIME_RE.exec(tok);
  if (dt) {
    const [y, mo, d] = tok.slice(0, 10).split("-").map(Number);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const dateOk = mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth[mo - 1];
    const time = dt[1] ? tok.slice(11, 19).split(":").map(Number) : null;
    const timeOk = !time || time[0] < 24 && time[1] < 60 && time[2] <= 60;
    const offset = /[+-](\d{2}):(\d{2})$/.exec(tok.slice(10));
    const offsetOk = !offset || Number(offset[1]) < 24 && Number(offset[2]) < 60;
    if (dateOk && timeOk && offsetOk) return tok;
    c.fail(`invalid date/time "${tok}"`);
  }
  if (/^[+-]?(inf|nan)$/.test(tok)) {
    return tok.endsWith("nan") ? NaN : tok.startsWith("-") ? -Infinity : Infinity;
  }
  if (HEX_RE.test(tok) || OCT_RE.test(tok) || BIN_RE.test(tok)) {
    return Number(tok.replace(/_/g, ""));
  }
  if (INT_RE.test(tok) || FLOAT_RE.test(tok)) {
    return Number(tok.replace(/_/g, ""));
  }
  c.fail(`unrecognized value token "${tok}"`);
}
function parseValue(c, ctx) {
  skipInlineWs(c);
  const ch = c.peek();
  if (ch === '"') {
    c.pos++;
    return parseBasicString(c);
  }
  if (ch === "'") {
    c.pos++;
    return parseLiteralString(c);
  }
  if (ch === "[") {
    c.pos++;
    const arr = [];
    ctx.closedToHeaders.add(arr);
    for (; ; ) {
      skipTrivia(c, true);
      if (c.peek() === "]") {
        c.pos++;
        return arr;
      }
      arr.push(parseValue(c, ctx));
      skipTrivia(c, true);
      if (c.peek() === ",") {
        c.pos++;
        continue;
      }
      if (c.peek() === "]") {
        c.pos++;
        return arr;
      }
      c.fail("expected ',' or ']' in array");
    }
  }
  if (ch === "{") {
    c.pos++;
    const table = newTable();
    ctx.closedInline.add(table);
    skipInlineWs(c);
    if (c.peek() === "}") {
      c.pos++;
      return table;
    }
    for (; ; ) {
      const keyPath = parseKeyPath(c);
      skipInlineWs(c);
      if (c.next() !== "=") c.fail("expected '=' in inline table");
      const value = parseValue(c, ctx);
      assignKey(table, keyPath, value, ctx, { insideClosed: true });
      skipInlineWs(c);
      const sep11 = c.next();
      if (sep11 === ",") {
        skipInlineWs(c);
        continue;
      }
      if (sep11 === "}") return table;
      c.fail("expected ',' or '}' in inline table");
    }
  }
  return parseScalarToken(c);
}
function newTable() {
  return /* @__PURE__ */ Object.create(null);
}
function isTable(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function descend(table, segments, ctx, mode) {
  let current = table;
  for (const seg of segments) {
    const existing = current[seg];
    if (existing === void 0) {
      const child = newTable();
      if (mode === "keyval") ctx.closedToHeaders.add(child);
      current[seg] = child;
      current = child;
    } else if (isTable(existing)) {
      if (ctx.closedInline.has(existing)) {
        throw new NativeConfigParseError(
          "toml-duplicate-key",
          `inline table "${seg}" is closed and cannot be extended`
        );
      }
      if (mode === "header" && ctx.closedToHeaders.has(existing)) {
        throw new NativeConfigParseError(
          "toml-duplicate-key",
          `key "${seg}" was defined in a key/value position and cannot be reopened by a table header`
        );
      }
      current = existing;
    } else if (Array.isArray(existing)) {
      if (ctx.closedToHeaders.has(existing)) {
        throw new NativeConfigParseError("toml-duplicate-key", `key "${seg}" already holds a value array`);
      }
      const last = existing[existing.length - 1];
      if (!isTable(last)) {
        throw new NativeConfigParseError("toml-duplicate-key", `key "${seg}" is not a table`);
      }
      current = last;
    } else {
      throw new NativeConfigParseError("toml-duplicate-key", `key "${seg}" already holds a value`);
    }
  }
  return current;
}
function assignKey(table, keyPath, value, ctx, opts = {}) {
  const parent = descend(table, keyPath.slice(0, -1), ctx, "keyval");
  const leaf = keyPath[keyPath.length - 1];
  if (leaf in parent) {
    throw new NativeConfigParseError("toml-duplicate-key", `duplicate key "${leaf}"`);
  }
  if (opts.insideClosed && isTable(value)) ctx.closedInline.add(value);
  parent[leaf] = value;
}
function parseNativeToml(raw) {
  const root = newTable();
  const ctx = { closedInline: /* @__PURE__ */ new WeakSet(), closedToHeaders: /* @__PURE__ */ new WeakSet() };
  const c = new Cursor(raw);
  let currentTable = root;
  const explicitHeaders = /* @__PURE__ */ new Set();
  for (; ; ) {
    skipTrivia(c, true);
    if (c.eof()) return root;
    if (c.peek() === "[") {
      c.pos++;
      const isArrayOfTables = c.peek() === "[";
      if (isArrayOfTables) c.pos++;
      const keyPath2 = parseKeyPath(c);
      skipInlineWs(c);
      if (c.next() !== "]") c.fail("expected ']' closing table header");
      if (isArrayOfTables && c.next() !== "]") c.fail("expected ']]' closing array-of-tables header");
      expectLineEnd(c);
      if (isArrayOfTables) {
        const parent = descend(root, keyPath2.slice(0, -1), ctx, "header");
        const leaf = keyPath2[keyPath2.length - 1];
        const existing = parent[leaf];
        if (existing === void 0) {
          const arr = [];
          parent[leaf] = arr;
          const t = newTable();
          arr.push(t);
          currentTable = t;
        } else if (Array.isArray(existing) && !ctx.closedToHeaders.has(existing)) {
          const t = newTable();
          existing.push(t);
          currentTable = t;
        } else {
          throw new NativeConfigParseError("toml-duplicate-key", `key "${leaf}" already holds a value`);
        }
      } else {
        const headerId = keyPath2.join("\0");
        if (explicitHeaders.has(headerId)) {
          throw new NativeConfigParseError("toml-duplicate-key", `table [${keyPath2.join(".")}] defined twice`);
        }
        explicitHeaders.add(headerId);
        const parent = descend(root, keyPath2.slice(0, -1), ctx, "header");
        const leaf = keyPath2[keyPath2.length - 1];
        const existing = parent[leaf];
        if (existing === void 0) {
          const t = newTable();
          parent[leaf] = t;
          currentTable = t;
        } else if (isTable(existing)) {
          if (ctx.closedInline.has(existing) || ctx.closedToHeaders.has(existing)) {
            throw new NativeConfigParseError(
              "toml-duplicate-key",
              `key "${leaf}" cannot be reopened by a table header`
            );
          }
          currentTable = existing;
        } else {
          throw new NativeConfigParseError("toml-duplicate-key", `key "${leaf}" already holds a value`);
        }
      }
      continue;
    }
    const keyPath = parseKeyPath(c);
    skipInlineWs(c);
    if (c.next() !== "=") c.fail("expected '=' after key");
    const value = parseValue(c, ctx);
    assignKey(currentTable, keyPath, value, ctx);
    expectLineEnd(c);
  }
}
function claudeConfigRoots(opts) {
  const join35 = opts.joiner ?? ((...parts) => parts.join("/"));
  const roots = [];
  const override = opts.claudeConfigDir?.trim();
  if (override) roots.push(override);
  roots.push(join35(opts.homedir, ".claude"), join35(opts.homedir, ".config", "claude"));
  return roots;
}
function codexConfigHome(opts) {
  const join35 = opts.joiner ?? ((...parts) => parts.join("/"));
  const override = opts.codexHome?.trim();
  return override ? override : join35(opts.homedir, ".codex");
}
function classifyEntry(alias, entry) {
  let present = 0;
  let matching = 0;
  let foreign = 0;
  let malformed = 0;
  for (const field of SOURCE_FIELDS) {
    if (!(field in entry)) continue;
    present++;
    const v = entry[field];
    if (typeof v !== "string") malformed++;
    else if (GUILD_SOURCE_RE.test(v.trim())) matching++;
    else foreign++;
  }
  const namesGuild = alias === "guild" || matching > 0;
  if (!namesGuild) return { kind: "no" };
  if (malformed > 0) {
    return { kind: "refuse", detail: `alias "${alias}": a source field is not a string` };
  }
  if (matching > 0 && foreign > 0) {
    return { kind: "refuse", detail: `alias "${alias}": source fields disagree about the origin` };
  }
  if (matching === 0 && foreign > 0) return { kind: "no" };
  void present;
  return { kind: "match" };
}
function selectCodexMarketplaceIdentity(raw) {
  let parsed;
  try {
    parsed = parseNativeToml(raw);
  } catch (err) {
    if (err instanceof NativeConfigParseError) {
      return { status: "refused", reason: "parse-error", code: err.code, detail: err.message };
    }
    return { status: "refused", reason: "parse-error", detail: String(err) };
  }
  const marketplaces = parsed["marketplaces"];
  if (!isTable(marketplaces)) return { status: "absent" };
  const matches = [];
  for (const alias of Object.keys(marketplaces)) {
    const entry = marketplaces[alias];
    if (!isTable(entry)) continue;
    const cls = classifyEntry(alias, entry);
    if (cls.kind === "refuse") {
      return { status: "refused", reason: "invalid-identity", detail: cls.detail };
    }
    if (cls.kind === "no") continue;
    const ref = entry["ref"];
    const commit = entry["last_revision"];
    if (ref !== "main" && ref !== "next") {
      return {
        status: "refused",
        reason: "invalid-identity",
        detail: `alias "${alias}": ref ${JSON.stringify(ref ?? null)} is not a known channel branch`
      };
    }
    if (typeof commit !== "string" || !SHA40_RE.test(commit)) {
      return {
        status: "refused",
        reason: "invalid-identity",
        detail: `alias "${alias}": last_revision is not a 40-hex SHA`
      };
    }
    matches.push({
      alias,
      identity: { channel: ref === "next" ? "beta" : "stable", commit }
    });
  }
  if (matches.length === 0) return { status: "absent" };
  const first = matches[0];
  for (const m of matches.slice(1)) {
    if (m.identity.channel !== first.identity.channel || m.identity.commit !== first.identity.commit) {
      return {
        status: "refused",
        reason: "conflicting-aliases",
        detail: `aliases "${first.alias}" and "${m.alias}" disagree on the installed identity`
      };
    }
  }
  return {
    status: "selected",
    identity: first.identity,
    alias: first.alias,
    aliases: matches.map((m) => m.alias)
  };
}
var NativeConfigParseError, UNSAFE_KEYS, BARE_KEY_RE, SHA40_RE, DATETIME_RE, INT_RE, HEX_RE, OCT_RE, BIN_RE, FLOAT_RE, Cursor, GUILD_SOURCE_RE, SOURCE_FIELDS;
var init_native_config_parser = __esm({
  "src/domains/config/native-config-parser.ts"() {
    init_security();
    NativeConfigParseError = class extends Error {
      code;
      constructor(code, message) {
        super(`${code}: ${message}`);
        this.name = "NativeConfigParseError";
        this.code = code;
      }
    };
    UNSAFE_KEYS = PROTO_POISON_KEYS;
    BARE_KEY_RE = /^[A-Za-z0-9_-]+$/;
    SHA40_RE = /^[0-9a-f]{40}$/;
    DATETIME_RE = /^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?)?$/;
    INT_RE = /^[+-]?(0|[1-9]\d*(_\d+)*)$/;
    HEX_RE = /^0x[0-9A-Fa-f]+(_[0-9A-Fa-f]+)*$/;
    OCT_RE = /^0o[0-7]+(_[0-7]+)*$/;
    BIN_RE = /^0b[01]+(_[01]+)*$/;
    FLOAT_RE = /^[+-]?(0|[1-9]\d*(_\d+)*)(\.\d+(_\d+)*)?([eE][+-]?\d+(_\d+)*)?$/;
    Cursor = class {
      constructor(src) {
        this.src = src;
      }
      src;
      pos = 0;
      peek(offset = 0) {
        return this.src[this.pos + offset] ?? "";
      }
      next() {
        return this.src[this.pos++] ?? "";
      }
      eof() {
        return this.pos >= this.src.length;
      }
      fail(why) {
        const line = this.src.slice(0, this.pos).split("\n").length;
        throw new NativeConfigParseError("toml-syntax", `${why} (line ${line})`);
      }
    };
    GUILD_SOURCE_RE = /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)lookatitude\/guild(?:\.git)?\/?$/;
    SOURCE_FIELDS = ["url", "repo", "repository"];
  }
});

// src/domains/config/config-defaults.ts
function isCanonicalRoleSlug(v) {
  return typeof v === "string" && v.length > 0 && v.length <= CAPABILITY_ROLE_SLUG_MAX_LEN && !CONTROL_CHARS.test(v) && ROLE_SLUG.test(v);
}
function roleSlugDedupKey(slug) {
  return slug.toLowerCase();
}
function isValidCapabilityValue(key, value) {
  switch (key) {
    case "capability.resolver_mode":
      return CAPABILITY_RESOLVER_MODES.includes(value);
    case "capability.auto_create_policy":
      return CAPABILITY_AUTO_CREATE_POLICIES.includes(value);
    case "capability.suggestion_budget":
      return typeof value === "number" && Number.isInteger(value) && value >= CAPABILITY_SUGGESTION_BUDGET_MIN && value <= CAPABILITY_SUGGESTION_BUDGET_MAX;
    case "capability.starter_roles": {
      if (!Array.isArray(value)) return false;
      const seen = /* @__PURE__ */ new Set();
      for (const entry of value) {
        if (!isCanonicalRoleSlug(entry)) return false;
        const key2 = roleSlugDedupKey(entry);
        if (seen.has(key2)) return false;
        seen.add(key2);
      }
      return true;
    }
    default:
      return void 0;
  }
}
var DEFAULT_ESCALATION_MARKERS, NON_INHERITABLE_KEYS, LOG_ROTATION_THRESHOLD_BYTES, SIDECAR_MAX_BYTES, CAPABILITY_RESOLVER_MODES, CAPABILITY_AUTO_CREATE_POLICIES, CAPABILITY_RESOLVER_MODE_AFTER_F7, CAPABILITY_RESOLVER_MODE_DEFAULT, CAPABILITY_SUGGESTION_BUDGET_MIN, CAPABILITY_SUGGESTION_BUDGET_MAX, CAPABILITY_ROLE_SLUG_MAX_LEN, ROLE_SLUG, CONTROL_CHARS, DEFAULTS;
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
    CAPABILITY_SUGGESTION_BUDGET_MIN = 0;
    CAPABILITY_SUGGESTION_BUDGET_MAX = 4;
    CAPABILITY_ROLE_SLUG_MAX_LEN = 64;
    ROLE_SLUG = /^[a-z0-9][a-z0-9._-]*$/;
    CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
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
         * `Agent()` drift shape) becomes BLOCKABLE instead of merely recorded. It
         * also denies, in every agent_mode, a lane whose env carries lane carriers
         * but no `GUILD_DISPATCH_PRODUCER` marker (`carrier_only`, #144).
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
function policyKeySpec(dotted) {
  return BY_KEY.get(canonicalPolicyKey(dotted));
}
function policyDefaults() {
  const out = {};
  for (const spec of POLICY_KEYS) setByPath2(out, spec.key, spec.default);
  return out;
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
function scanHostIdentity(obj, knownHostIds = [], prefix = "") {
  const out = [];
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      out.push(...scanHostIdentity(item, knownHostIds, `${prefix}[${i}]`));
    });
    return out;
  }
  if (obj === null || typeof obj !== "object") {
    const hit = findHostIdentity(prefix, obj, knownHostIds);
    if (hit) out.push(hit);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const dotted = prefix === "" ? k : `${prefix}.${k}`;
    const keyHit = findHostIdentity(dotted, void 0, knownHostIds);
    if (keyHit) {
      out.push(keyHit);
      continue;
    }
    out.push(...scanHostIdentity(v, knownHostIds, dotted));
  }
  return out;
}
function findModelNameInText(text) {
  return matchesModelName(text);
}
function identityMessage(hit, where) {
  const what = hit.kind === "model-inventory" ? `'${hit.key}' persists per-host model inventory` : hit.kind === "host-family" ? `'${hit.key}' carries the host family '${hit.token}'` : hit.kind === "host-id" ? `'${hit.key}' carries the host id '${hit.token}'` : `'${hit.key}' carries the concrete model name '${hit.token}'`;
  return `${where}: ${what}. Durable config is policy only (KTD22) \u2014 host and models are bound per session on the run record (guild.session_binding.v1). Run \`guild config models\` to inspect this session's binding.`;
}
function assertPolicyWrite(key, value, opts = {}) {
  const where = opts.where ?? "config set";
  const hit = findHostIdentity(key, value, opts.knownHostIds ?? []);
  if (hit) throw new PolicyRejectedError(hit.kind, key, identityMessage(hit, where));
  const canonical = canonicalPolicyKey(key);
  const spec = BY_KEY.get(canonical);
  if (!spec) {
    throw new PolicyRejectedError(
      "not-policy",
      key,
      `${where}: '${key}' is not a policy key. Durable config holds the closed policy set only (KTD22): ${POLICY_KEYS.map((s) => s.key).join(", ")}.`
    );
  }
  const valueErr = validatePolicyValue(spec, value);
  if (valueErr) throw new PolicyRejectedError("not-policy", key, `${where}: ${valueErr}`);
  return canonical;
}
function validatePolicyValue(spec, value) {
  if (value === null) {
    return spec.default === null ? null : `'${spec.key}' does not accept null`;
  }
  switch (spec.type) {
    case "enum":
      return typeof value === "string" && spec.values.includes(value) ? null : `'${spec.key}' must be one of: ${spec.values.join(" | ")}`;
    case "boolean":
      return typeof value === "boolean" ? null : `'${spec.key}' must be true or false`;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return `'${spec.key}' must be an integer`;
      }
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `'${spec.key}' must be a number`;
      }
      break;
  }
  const n = value;
  if (spec.min !== void 0 && n < spec.min) return `'${spec.key}' must be >= ${spec.min}`;
  if (spec.max !== void 0 && n > spec.max) return `'${spec.key}' must be <= ${spec.max}`;
  return null;
}
function setByPath2(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    const next = cur[p];
    if (next === void 0 || next === null || typeof next !== "object" || Array.isArray(next)) {
      cur[p] = {};
    }
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}
function getByPath2(obj, dotted) {
  let cur = obj;
  for (const p of dotted.split(".")) {
    if (cur === null || typeof cur !== "object") return void 0;
    cur = cur[p];
  }
  return cur;
}
var POLICY_KEYS, BY_KEY, POLICY_KEY_ALIASES, HOST_FAMILY_TOKENS, MODEL_FAMILY_TOKENS, MODEL_NAME_PATTERNS, INVENTORY_KEY_PATTERNS, PolicyRejectedError;
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
    PolicyRejectedError = class extends Error {
      constructor(reason, key, message) {
        super(message);
        this.reason = reason;
        this.key = key;
        this.name = "PolicyRejectedError";
      }
      reason;
      key;
    };
  }
});

// src/domains/config/policy-resolver.ts
function hasDanglingLink(file) {
  let p = path19.resolve(file);
  for (; ; ) {
    let isLink = false;
    try {
      isLink = fs14.lstatSync(p).isSymbolicLink();
    } catch {
    }
    if (isLink && !fs14.existsSync(p)) return true;
    const parent = path19.dirname(p);
    if (parent === p) return false;
    p = parent;
  }
}
function readJsonFile(file) {
  let raw;
  try {
    raw = fs14.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT" && !hasDanglingLink(file)) return null;
    throw new PolicyRejectedError("not-policy", file, `policy config: ${file} is unreadable (${e.message}).`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new PolicyRejectedError(
      "not-policy",
      file,
      `policy config: ${file} is not valid JSON (${e.message}). Refusing to resolve policy from a file Guild cannot parse.`
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PolicyRejectedError("not-policy", file, `policy config: ${file} must be a JSON object`);
  }
  return parsed;
}
function readLayer(file, layer, knownHostIds) {
  const parsed = readJsonFile(file);
  if (parsed === null) return null;
  const identity = scanHostIdentity(parsed, knownHostIds);
  if (identity.length > 0) {
    const hit = identity[0];
    throw new PolicyRejectedError(
      hit.kind,
      hit.key,
      `policy config (${layer}, ${file}): key '${hit.key}' carries ${hit.kind === "model-inventory" ? "per-host model inventory" : `'${hit.token}'`}. Durable config is policy only (KTD22); host and model are bound per session on the run record. Remove the key, or inspect the session with \`guild config models\`.`
    );
  }
  const out = /* @__PURE__ */ new Map();
  const aliases = [];
  for (const spec of POLICY_KEYS) {
    const canonical = getByPath2(parsed, spec.key);
    if (canonical !== void 0) {
      const err = validatePolicyValue(spec, canonical);
      if (err) {
        throw new PolicyRejectedError("not-policy", spec.key, `policy config (${layer}, ${file}): ${err}`);
      }
      out.set(spec.key, canonical);
    }
    for (const legacy of aliasesFor(spec.key)) {
      const v = getByPath2(parsed, legacy);
      if (v === void 0) continue;
      const err = validatePolicyValue(spec, v);
      if (err) {
        throw new PolicyRejectedError("not-policy", spec.key, `policy config (${layer}, ${file}): ${err}`);
      }
      const shadowed = out.has(spec.key);
      if (!shadowed) out.set(spec.key, v);
      aliases.push({ key: spec.key, legacy, layer, file, shadowed });
    }
  }
  const known2 = /* @__PURE__ */ new Set();
  for (const spec of POLICY_KEYS) {
    known2.add(spec.key);
    for (const a of aliasesFor(spec.key)) known2.add(a);
  }
  for (const dotted of leafPaths(parsed)) {
    if (known2.has(dotted)) continue;
    if ([...known2].some((k) => k.startsWith(`${dotted}.`))) {
      const v = getByPath2(parsed, dotted);
      if (v !== null && typeof v === "object" && !Array.isArray(v)) continue;
      throw new PolicyRejectedError(
        "not-policy",
        dotted,
        `policy config (${layer}, ${file}): '${dotted}' must be an object of policy keys.`
      );
    }
    throw new PolicyRejectedError(
      "not-policy",
      dotted,
      `policy config (${layer}, ${file}): '${dotted}' is not a policy key. The closed set is: ${POLICY_KEYS.map((s) => s.key).join(", ")}.`
    );
  }
  return { values: out, aliases };
}
function aliasesFor(canonical) {
  return ALIASES_BY_CANONICAL.get(canonical) ?? [];
}
function leafPaths(obj, prefix = "", out = []) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    if (prefix !== "") out.push(prefix);
    return out;
  }
  const entries = Object.entries(obj);
  if (entries.length === 0 && prefix !== "") out.push(prefix);
  for (const [k, v] of entries) {
    if (k === "" || k.includes(".")) {
      throw new PolicyRejectedError("not-policy", k, `policy config: key '${k}' is empty or contains a '.'; use nested non-empty keys.`);
    }
    leafPaths(v, prefix === "" ? k : `${prefix}.${k}`, out);
  }
  return out;
}
function policyFilesFor(root, scope) {
  const storage = createGuildStorage(root, {
    profile: scope === "workspace" ? "workspace-only" : "standalone"
  });
  const scoped = scope === "workspace" ? storage.workspace : storage.project;
  if (!scoped) return null;
  const config = scoped.config();
  return { config, local: config.replace(/\.json$/, ".local.json") };
}
function policyOverlayFile(cwd) {
  try {
    return createGuildStorage(cwd).runtime(POLICY_OVERLAY_FILE);
  } catch {
    return null;
  }
}
function resolvePolicy(opts) {
  const knownHostIds = opts.knownHostIds ?? [];
  const policy = policyDefaults();
  const sources = {};
  for (const spec of POLICY_KEYS) sources[spec.key] = "builtin";
  const files = [];
  const legacyAliases = [];
  const layers = [];
  if (opts.workspaceRoot) {
    const ws = policyFilesFor(opts.workspaceRoot, "workspace");
    if (ws) {
      layers.push({ layer: "workspace", file: ws.config });
      layers.push({ layer: "workspace-local", file: ws.local });
    }
  }
  const project = policyFilesFor(opts.cwd, "project");
  if (project) {
    layers.push({ layer: "project", file: project.config });
    layers.push({ layer: "project-local", file: project.local });
  }
  const overlay = opts.overlayFile === void 0 ? policyOverlayFile(opts.cwd) : opts.overlayFile;
  if (overlay) layers.push({ layer: "overlay", file: overlay });
  for (const { layer, file } of layers) {
    const sparse = readLayer(file, layer, knownHostIds);
    if (sparse === null) continue;
    files.push({ layer, file });
    legacyAliases.push(...sparse.aliases);
    for (const [key, value] of sparse.values) {
      setByPath2(policy, key, value);
      sources[key] = layer;
    }
  }
  for (const [key, value] of Object.entries(opts.rigor ?? {})) {
    const spec = policyKeySpec(key);
    if (!spec) continue;
    setByPath2(policy, spec.key, value);
    sources[spec.key] = "rigor";
  }
  for (const [key, value] of Object.entries(opts.flags ?? {})) {
    if (value === void 0) continue;
    const canonical = canonicalPolicyKey(key);
    const spec = policyKeySpec(canonical);
    if (!spec) continue;
    const err = validatePolicyValue(spec, value);
    if (err) throw new PolicyRejectedError("not-policy", canonical, `policy config (cli): ${err}`);
    setByPath2(policy, spec.key, value);
    sources[spec.key] = "cli";
  }
  return { policy, sources, files, legacyAliases };
}
function policyValue(resolved, dotted) {
  return getByPath2(resolved.policy, canonicalPolicyKey(dotted));
}
function writePolicyOverlay(overlayFile, key, value, knownHostIds = []) {
  const canonical = assertPolicyWrite(key, value, { where: "policy overlay", knownHostIds });
  let existing = {};
  const parsed = readJsonFile(overlayFile);
  if (parsed !== null) existing = parsed;
  setByPath2(existing, canonical, value);
  fs14.mkdirSync(path19.dirname(overlayFile), { recursive: true });
  const tmp = `${overlayFile}.tmp`;
  fs14.writeFileSync(tmp, `${JSON.stringify(existing, null, 2)}
`, "utf8");
  fs14.renameSync(tmp, overlayFile);
}
var fs14, path19, POLICY_FILES, POLICY_OVERLAY_FILE, ALIASES_BY_CANONICAL;
var init_policy_resolver = __esm({
  "src/domains/config/policy-resolver.ts"() {
    fs14 = __toESM(require("node:fs"));
    path19 = __toESM(require("node:path"));
    init_policy_keys();
    init_state();
    POLICY_FILES = Object.freeze({
      project: "config/project.json",
      projectLocal: "config/project.local.json",
      workspace: "config/workspace.json",
      workspaceLocal: "config/workspace.local.json"
    });
    POLICY_OVERLAY_FILE = "policy-overlay.json";
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
function detectSession(env = process.env) {
  for (const sig of ENV_SIGNALS) {
    const raw = env[sig.env];
    if (raw === void 0 || raw === "") continue;
    const family = sig.fromValue ? raw.trim().toLowerCase() : sig.family;
    if (sig.fromValue && !KNOWN_FAMILIES2.has(family)) {
      return unknownSession(`${sig.env}=${raw} (unrecognised family)`);
    }
    return {
      host_family: family,
      surface: env["GUILD_HOST_SURFACE"]?.trim() || family,
      model_family: HOST_TO_MODEL_FAMILY[family] ?? UNKNOWN_MODEL_FAMILY,
      // Family detection alone is `advertised`: the host says what it is. A live
      // catalog probe is what upgrades a tier to `available` (capability domain).
      evidence: { cheap: "advertised", mid: "advertised", powerful: "advertised" },
      signal: sig.env
    };
  }
  return unknownSession("none");
}
function unknownSession(signal) {
  return {
    host_family: UNKNOWN_HOST_FAMILY,
    surface: UNKNOWN_HOST_FAMILY,
    model_family: UNKNOWN_MODEL_FAMILY,
    evidence: { cheap: "unknown", mid: "unknown", powerful: "unknown" },
    signal
  };
}
function isUnknownHost(d) {
  return d.host_family === UNKNOWN_HOST_FAMILY;
}
function sessionBindingPath(runDir) {
  return path20.join(runDir, SESSION_BINDING_FILE);
}
function readSessionBinding(runDir) {
  try {
    const parsed = JSON.parse(fs15.readFileSync(sessionBindingPath(runDir), "utf8"));
    return parsed?.schema_version === "guild.session_binding.v1" ? parsed : null;
  } catch {
    return null;
  }
}
function refusal(existing, thisHost) {
  return `run ${existing.run_id} is bound to host family '${existing.host_family}'; this session is '${thisHost}'. Guild does not rebind a run in flight \u2014 in-flight assignments already named a host.
  Continue as a NEW run on this host:  guild resume --new-run
  Or return to the original host ('${existing.host_family}') and resume this run.`;
}
function bindSession(opts) {
  const existing = readSessionBinding(opts.runDir);
  if (existing) {
    if (existing.host_family !== opts.detected.host_family) {
      return {
        ok: false,
        reason: "host_changed_mid_run",
        existing,
        message: refusal(existing, opts.detected.host_family)
      };
    }
    return { ok: true, binding: existing, created: false };
  }
  const now = (opts.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  const binding = {
    schema_version: "guild.session_binding.v1",
    run_id: opts.runId,
    host_family: opts.detected.host_family,
    surface: opts.detected.surface,
    detected_at: now,
    // An unknown host gets NO tier map. An empty map is a blocked dispatch; a
    // guessed map is a wrong one.
    models: isUnknownHost(opts.detected) ? {} : opts.models ?? {},
    model_family: opts.detected.model_family,
    prompt_compose: opts.promptCompose,
    evidence: opts.detected.evidence
  };
  fs15.mkdirSync(opts.runDir, { recursive: true });
  const created = createExclusive(sessionBindingPath(opts.runDir), binding);
  if (created) return { ok: true, binding, created: true };
  const winner = readSessionBinding(opts.runDir);
  if (winner === null) {
    return {
      ok: false,
      reason: "host_changed_mid_run",
      existing: binding,
      message: `run ${opts.runId} already has a session binding that cannot be read. Guild will not overwrite it. Inspect ${sessionBindingPath(opts.runDir)}, or continue as a NEW run on this host: guild resume --new-run`
    };
  }
  if (winner.host_family !== opts.detected.host_family) {
    return { ok: false, reason: "host_changed_mid_run", existing: winner, message: refusal(winner, opts.detected.host_family) };
  }
  return { ok: true, binding: winner, created: false };
}
function createExclusive(file, binding) {
  try {
    fs15.writeFileSync(file, `${JSON.stringify(binding, null, 2)}
`, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (e) {
    if (e.code === "EEXIST") return false;
    throw e;
  }
}
function bindSessionForRun(opts) {
  const detected = detectSession(opts.env ?? process.env);
  const promptCompose = opts.promptCompose ?? { dialect_id: "dialect:none", overlay_ids: [], hash: "" };
  const seam = opts.fs;
  if (seam === void 0) {
    return bindSession({ runDir: opts.runDir, runId: opts.runId, detected, promptCompose, models: opts.models });
  }
  const file = sessionBindingPath(opts.runDir);
  if (seam.exists(file)) {
    const raw = seam.readFile?.(file) ?? null;
    let existing = null;
    try {
      const parsed = raw === null ? null : JSON.parse(raw);
      existing = parsed?.schema_version === "guild.session_binding.v1" ? parsed : null;
    } catch {
      existing = null;
    }
    if (existing && existing.host_family !== detected.host_family) {
      return { ok: false, reason: "host_changed_mid_run", existing, message: refusal(existing, detected.host_family) };
    }
    if (existing) return { ok: true, binding: existing, created: false };
  }
  const binding = {
    schema_version: "guild.session_binding.v1",
    run_id: opts.runId,
    host_family: detected.host_family,
    surface: detected.surface,
    detected_at: (/* @__PURE__ */ new Date()).toISOString(),
    models: isUnknownHost(detected) ? {} : opts.models ?? {},
    model_family: detected.model_family,
    prompt_compose: promptCompose,
    evidence: detected.evidence
  };
  seam.writeFile(file, `${JSON.stringify(binding, null, 2)}
`);
  return { ok: true, binding, created: true };
}
var fs15, path20, SESSION_BINDING_FILE, UNKNOWN_HOST_FAMILY, UNKNOWN_MODEL_FAMILY, HOST_TO_MODEL_FAMILY, ENV_SIGNALS, KNOWN_FAMILIES2;
var init_session_binding = __esm({
  "src/domains/config/session-binding.ts"() {
    fs15 = __toESM(require("node:fs"));
    path20 = __toESM(require("node:path"));
    SESSION_BINDING_FILE = "session-binding.json";
    UNKNOWN_HOST_FAMILY = "unknown";
    UNKNOWN_MODEL_FAMILY = "unknown";
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
    KNOWN_FAMILIES2 = /* @__PURE__ */ new Set([...Object.keys(HOST_TO_MODEL_FAMILY), "cline", "zed", "aider", "windsurf", "pi"]);
  }
});

// src/domains/config/config-validation.ts
function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function rejectUnknown(value, allowed, label) {
  return Object.keys(value).filter((key) => !allowed.has(key)).map((key) => `unknown ${label} key "${key}" (closed key set)`);
}
function validateModels(models) {
  const rejects = rejectUnknown(models, MODEL_KEYS, "models");
  const tiers = models["tiers"];
  if (object(tiers)) {
    const tierKeys = /* @__PURE__ */ new Set(["cheap", "mid", "powerful"]);
    const specKeys = /* @__PURE__ */ new Set(["model", "effort", "reasoning", "thinking", "verbosity"]);
    for (const [tier, rawHosts] of Object.entries(tiers)) {
      if (!tierKeys.has(tier)) {
        rejects.push(`unknown models.tiers key "${tier}" (valid: cheap|mid|powerful)`);
        continue;
      }
      if (!object(rawHosts)) continue;
      const canonical = /* @__PURE__ */ new Map();
      for (const [host, value] of Object.entries(rawHosts)) {
        const hostId = normalizeHostId(host);
        if (!hostId) {
          rejects.push(`unknown models.tiers.${tier} host key "${host}" (closed key set)`);
          continue;
        }
        const prior = canonical.get(hostId);
        if (prior && prior !== host) {
          rejects.push(
            `duplicate models.tiers.${tier} host keys "${prior}" and "${host}" both normalize to "${hostId}"`
          );
          continue;
        }
        canonical.set(hostId, host);
        if (value === null || typeof value === "string") continue;
        if (!object(value)) {
          rejects.push(
            `models.tiers.${tier}.${host} must be a string, null, or {model, effort?, reasoning?, thinking?, verbosity?}`
          );
          continue;
        }
        for (const key of Object.keys(value)) {
          if (!specKeys.has(key)) {
            rejects.push(`unknown models.tiers.${tier}.${host} key "${key}" (object form is a closed key set)`);
          }
        }
        if (typeof value["model"] !== "string" || !value["model"].trim()) {
          rejects.push(`models.tiers.${tier}.${host}.model is required and must be a non-empty string in the object form`);
        }
        for (const key of ["effort", "reasoning", "thinking", "verbosity"]) {
          if (value[key] !== void 0 && typeof value[key] !== "string") {
            rejects.push(`models.tiers.${tier}.${host}.${key} must be a string (got ${JSON.stringify(value[key])})`);
          }
        }
      }
    }
  }
  if (object(models["thresholds"])) {
    for (const key of Object.keys(models["thresholds"])) {
      if (key !== "mid" && key !== "powerful") rejects.push(`unknown models.thresholds key "${key}" \u2014 only mid and powerful are valid`);
    }
  }
  if (object(models["cacheTTL"])) {
    const ttl = models["cacheTTL"];
    for (const key of Object.keys(ttl)) {
      if (key !== "coordinator" && key !== "leaf") rejects.push(`unknown models.cacheTTL key "${key}" \u2014 only coordinator and leaf are valid`);
    }
    for (const key of ["coordinator", "leaf"]) {
      if (ttl[key] !== void 0 && !["1h", "5m", "off"].includes(String(ttl[key]))) {
        rejects.push(`models.cacheTTL.${key} "${ttl[key]}" is invalid \u2014 valid: 1h|5m|off`);
      }
    }
  }
  const integerRange = (key, min, max) => {
    const value = models[key];
    if (value !== void 0 && (typeof value !== "number" || !Number.isInteger(value) || value < min || max !== void 0 && value > max)) {
      rejects.push(`models.${key} must be an integer ${min}${max === void 0 ? "+" : `\u2013${max}`} (got ${JSON.stringify(value)})`);
    }
  };
  integerRange("importanceGate", 1, 5);
  integerRange("advisorRounds", 1);
  for (const key of ["compositeRecall", "importanceAtIngest"]) {
    if (models[key] !== void 0 && typeof models[key] !== "boolean") {
      rejects.push(`models.${key} must be a boolean (got ${JSON.stringify(models[key])})`);
    }
  }
  for (const key of ["recallScoreThreshold", "ingestSimilarityGate"]) {
    const value = models[key];
    if (value !== void 0 && (typeof value !== "number" || value < 0 || value > 1)) {
      rejects.push(`models.${key} must be a float 0\u20131 (got ${JSON.stringify(value)})`);
    }
  }
  return rejects;
}
function validateSecurity(value) {
  const rejects = rejectUnknown(value, SECURITY_KEYS, "security");
  const policy = value["bypass_permissions_policy"];
  if (policy !== void 0 && !["deny", "audit", "allow"].includes(String(policy))) {
    rejects.push(`security.bypass_permissions_policy "${policy}" is invalid \u2014 valid: deny|audit|allow`);
  }
  return rejects;
}
function validateSecretsPolicy(value) {
  const rejects = rejectUnknown(value, SECRETS_KEYS, "secrets_policy");
  for (const key of ["fail_mode_durable", "fail_mode_telemetry"]) {
    if (value[key] !== void 0 && value[key] !== "closed" && value[key] !== "open") {
      rejects.push(`secrets_policy.${key} "${value[key]}" is invalid \u2014 valid: closed|open`);
    }
  }
  for (const key of ["env_allowlist", "redaction_patterns"]) {
    if (value[key] !== void 0 && !Array.isArray(value[key])) rejects.push(`secrets_policy.${key} must be an array`);
  }
  return rejects;
}
function validateMcp(value) {
  const rejects = rejectUnknown(value, MCP_KEYS, "mcp");
  if (value["tool_description_hashes"] !== void 0 && !object(value["tool_description_hashes"])) {
    rejects.push("mcp.tool_description_hashes must be an object (tool-name \u2192 SHA-256 hash)");
  }
  for (const key of ["stdio_available", "http_available"]) {
    if (value[key] !== void 0 && typeof value[key] !== "boolean") rejects.push(`mcp.${key} must be a boolean (got ${JSON.stringify(value[key])})`);
  }
  if (value["bridge_package"] !== void 0 && value["bridge_package"] !== null && typeof value["bridge_package"] !== "string") {
    rejects.push(`mcp.bridge_package must be a string or null (got ${JSON.stringify(value["bridge_package"])})`);
  }
  return rejects;
}
function validateCrossHostBlock(value) {
  const rejects = rejectUnknown(value, /* @__PURE__ */ new Set(["enabled", "hosts", "fallback_to_claude"]), "defaults.cross_host");
  for (const key of ["enabled", "fallback_to_claude"]) {
    if (value[key] !== void 0 && typeof value[key] !== "boolean") rejects.push(`defaults.cross_host.${key} must be a boolean (got ${JSON.stringify(value[key])})`);
  }
  if (value["hosts"] !== void 0 && !object(value["hosts"])) {
    rejects.push("defaults.cross_host.hosts must be an object { host_id: { address, port?, user? } }");
  } else if (object(value["hosts"])) {
    for (const [host, raw] of Object.entries(value["hosts"])) {
      if (!object(raw)) {
        rejects.push(`defaults.cross_host.hosts["${host}"] must be an object { address, port?, user? }`);
        continue;
      }
      for (const key of Object.keys(raw)) {
        if (!["address", "port", "user", "login_shell"].includes(key)) rejects.push(`unknown defaults.cross_host.hosts["${host}"] key "${key}" (closed key set)`);
      }
      if (!raw["address"] || typeof raw["address"] !== "string") rejects.push(`defaults.cross_host.hosts["${host}"].address is required and must be a string`);
      const port = raw["port"];
      if (port !== void 0 && (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)) rejects.push(`defaults.cross_host.hosts["${host}"].port must be an integer 1\u201365535 (got ${JSON.stringify(port)})`);
      for (const key of ["user", "login_shell"]) {
        if (raw[key] !== void 0 && typeof raw[key] !== "string") rejects.push(`defaults.cross_host.hosts["${host}"].${key} must be a string (got ${JSON.stringify(raw[key])})`);
      }
    }
  }
  return rejects;
}
function validateDefaults(value, selfBuild) {
  const rejects = rejectUnknown(value, DEFAULT_KEYS, "defaults");
  if (value["adversarial"] === "off" && selfBuild) rejects.push("defaults.adversarial: off is REJECTED for Guild self-build");
  if (object(value["wiki"]) && value["wiki"]["autopromote"] !== void 0 && typeof value["wiki"]["autopromote"] !== "boolean") rejects.push(`defaults.wiki.autopromote must be true or false (got ${JSON.stringify(value["wiki"]["autopromote"])})`);
  if (object(value["cross_host"])) rejects.push(...validateCrossHostBlock(value["cross_host"]));
  if (object(value["quality"]) && object(value["quality"]["budget"])) {
    for (const key of Object.keys(value["quality"]["budget"])) {
      if (!["per_class_minutes", "total_minutes"].includes(key)) rejects.push(`unknown defaults.quality.budget key "${key}"`);
    }
  }
  if (object(value["retry"])) {
    const retry = value["retry"];
    rejects.push(...rejectUnknown(retry, /* @__PURE__ */ new Set(["max_attempts", "backoff"]), "defaults.retry"));
    if (retry["max_attempts"] !== void 0 && (typeof retry["max_attempts"] !== "number" || !Number.isInteger(retry["max_attempts"]) || retry["max_attempts"] < 1)) rejects.push(`defaults.retry.max_attempts must be an integer \u2265 1 (got ${JSON.stringify(retry["max_attempts"])})`);
    if (retry["backoff"] !== void 0 && !["immediate", "linear", "exponential"].includes(String(retry["backoff"]))) rejects.push(`defaults.retry.backoff must be "immediate"|"linear"|"exponential" (got ${JSON.stringify(retry["backoff"])})`);
  }
  if (object(value["resume"])) {
    rejects.push(...rejectUnknown(value["resume"], /* @__PURE__ */ new Set(["enabled"]), "defaults.resume"));
    if (value["resume"]["enabled"] !== void 0 && typeof value["resume"]["enabled"] !== "boolean") rejects.push(`defaults.resume.enabled must be a boolean (got ${JSON.stringify(value["resume"]["enabled"])})`);
  }
  for (const key of ["heartbeat_timeout_ms", "capability_manifest_ttl_s"]) {
    const number = value[key];
    if (number !== void 0 && (typeof number !== "number" || number <= 0 || key === "heartbeat_timeout_ms" && !Number.isInteger(number))) rejects.push(`defaults.${key} must be a positive ${key === "heartbeat_timeout_ms" ? "integer" : "number"} (got ${JSON.stringify(number)})`);
  }
  if (value["allowed_tools"] !== void 0 && !Array.isArray(value["allowed_tools"])) rejects.push("defaults.allowed_tools must be an array of strings");
  if (value["lean_lead"] !== void 0 && !object(value["lean_lead"])) {
    rejects.push(`defaults.lean_lead must be an object { enabled?, hands_on_edit_threshold? } (got ${JSON.stringify(value["lean_lead"])})`);
  } else if (object(value["lean_lead"])) {
    const leanLead = value["lean_lead"];
    rejects.push(...rejectUnknown(leanLead, /* @__PURE__ */ new Set(["enabled", "hands_on_edit_threshold"]), "defaults.lean_lead"));
    if (leanLead["enabled"] !== void 0 && typeof leanLead["enabled"] !== "boolean") {
      rejects.push(`defaults.lean_lead.enabled must be a boolean (got ${JSON.stringify(leanLead["enabled"])})`);
    }
    const threshold = leanLead["hands_on_edit_threshold"];
    if (threshold !== void 0 && (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 1)) {
      rejects.push(`defaults.lean_lead.hands_on_edit_threshold must be a positive integer (got ${JSON.stringify(threshold)})`);
    }
  }
  if (value["lifecycle_gate"] !== void 0 && !object(value["lifecycle_gate"])) {
    rejects.push(`defaults.lifecycle_gate must be an object { enabled?, adhoc_activity_threshold? } (got ${JSON.stringify(value["lifecycle_gate"])})`);
  } else if (object(value["lifecycle_gate"])) {
    const lifecycleGate = value["lifecycle_gate"];
    rejects.push(...rejectUnknown(lifecycleGate, /* @__PURE__ */ new Set(["enabled", "adhoc_activity_threshold"]), "defaults.lifecycle_gate"));
    if (lifecycleGate["enabled"] !== void 0 && typeof lifecycleGate["enabled"] !== "boolean") {
      rejects.push(`defaults.lifecycle_gate.enabled must be a boolean (got ${JSON.stringify(lifecycleGate["enabled"])})`);
    }
    const threshold = lifecycleGate["adhoc_activity_threshold"];
    if (threshold !== void 0 && (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 1)) {
      rejects.push(`defaults.lifecycle_gate.adhoc_activity_threshold must be a positive integer (got ${JSON.stringify(threshold)})`);
    }
  }
  if (value["dispatch"] !== void 0 && !object(value["dispatch"])) {
    rejects.push(`defaults.dispatch must be an object { block_unmarked_lanes? } (got ${JSON.stringify(value["dispatch"])})`);
  } else if (object(value["dispatch"])) {
    const dispatch = value["dispatch"];
    rejects.push(...rejectUnknown(dispatch, /* @__PURE__ */ new Set(["block_unmarked_lanes"]), "defaults.dispatch"));
    if (dispatch["block_unmarked_lanes"] !== void 0 && typeof dispatch["block_unmarked_lanes"] !== "boolean") {
      rejects.push(`defaults.dispatch.block_unmarked_lanes must be a boolean (got ${JSON.stringify(dispatch["block_unmarked_lanes"])})`);
    }
  }
  if (object(value["update"])) {
    const update = value["update"];
    rejects.push(...rejectUnknown(update, /* @__PURE__ */ new Set(["mode", "cadence_hours"]), "defaults.update"));
    if (update["mode"] !== void 0 && !["auto", "notify", "off"].includes(String(update["mode"]))) rejects.push(`defaults.update.mode must be "auto" | "notify" | "off" (got ${JSON.stringify(update["mode"])})`);
    if (update["cadence_hours"] !== void 0 && (typeof update["cadence_hours"] !== "number" || update["cadence_hours"] <= 0)) rejects.push(`defaults.update.cadence_hours must be a positive number of hours (got ${JSON.stringify(update["cadence_hours"])})`);
  } else if (value["update"] !== void 0) {
    rejects.push(`defaults.update must be an object { mode, cadence_hours } (got ${JSON.stringify(value["update"])})`);
  }
  if (object(value["index"])) {
    const index = value["index"];
    rejects.push(...rejectUnknown(index, INDEX_KEYS, "defaults.index"));
    if (index["enabled"] !== void 0 && typeof index["enabled"] !== "boolean") rejects.push(`defaults.index.enabled must be a boolean (got ${JSON.stringify(index["enabled"])})`);
    for (const key of ["kg_node_threshold", "links_edge_threshold", "runs_threshold", "wiki_file_threshold"]) {
      const number = index[key];
      if (number !== void 0 && (typeof number !== "number" || !Number.isInteger(number) || number < 1)) rejects.push(`defaults.index.${key} must be a positive integer (got ${JSON.stringify(number)})`);
    }
    const size = index["kg_size_threshold_mb"];
    if (size !== void 0 && (typeof size !== "number" || size <= 0)) rejects.push(`defaults.index.kg_size_threshold_mb must be a positive number (got ${JSON.stringify(size)})`);
  }
  return rejects;
}
var MODEL_KEYS, SECURITY_KEYS, SECRETS_KEYS, MCP_KEYS, DEFAULT_KEYS, INDEX_KEYS;
var init_config_validation = __esm({
  "src/domains/config/config-validation.ts"() {
    init_host_id_namespace();
    MODEL_KEYS = /* @__PURE__ */ new Set([
      "enabled",
      "tiers",
      "scoreWeights",
      "thresholds",
      "advisorRounds",
      "escalationMarkers",
      "recallBeforeRead",
      "recallScoreThreshold",
      "structuredOutputRequired",
      "cacheTTL",
      "importanceGate",
      "compositeRecall",
      "importanceAtIngest",
      "ingestSimilarityGate",
      "shortOutputThreshold",
      "knowledge"
    ]);
    SECURITY_KEYS = /* @__PURE__ */ new Set(["bypass_permissions_policy"]);
    SECRETS_KEYS = /* @__PURE__ */ new Set([
      "env_allowlist",
      "redaction_patterns",
      "fail_mode_durable",
      "fail_mode_telemetry"
    ]);
    MCP_KEYS = /* @__PURE__ */ new Set([
      "tool_description_hashes",
      "stdio_available",
      "http_available",
      "bridge_package"
    ]);
    DEFAULT_KEYS = /* @__PURE__ */ new Set([
      "auto_learn",
      "adversarial",
      "team",
      "review_workflow",
      "skill_policy",
      "gates",
      "wiki",
      "quality",
      "reporting",
      "index",
      "cross_host",
      "retry",
      "resume",
      "heartbeat_timeout_ms",
      "capability_manifest_ttl_s",
      "update",
      "allowed_tools",
      "lean_lead",
      "lifecycle_gate",
      "dispatch"
    ]);
    INDEX_KEYS = /* @__PURE__ */ new Set([
      "enabled",
      "kg_node_threshold",
      "kg_size_threshold_mb",
      "links_edge_threshold",
      "runs_threshold",
      "wiki_file_threshold"
    ]);
  }
});

// src/domains/config/model-policy.ts
function isReviewClassPurpose(p) {
  return REVIEW_CLASS_PURPOSES.includes(p);
}
function parseSelector(raw) {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(`selector_malformed: empty or non-string selector`);
  }
  if (raw.startsWith("id:")) {
    const id = raw.slice(3);
    if (!id) throw new Error(`selector_malformed: "id:" needs a canonical_id (got "${raw}")`);
    return { form: "id", canonical_id: id };
  }
  if (raw.startsWith("alias:")) {
    const alias = raw.slice(6);
    if (!alias) throw new Error(`selector_malformed: "alias:" needs an alias (got "${raw}")`);
    return { form: "alias", alias };
  }
  if (raw.startsWith("expr:")) {
    const body = raw.slice(5);
    if (!body) throw new Error(`selector_malformed: "expr:" needs conjuncts (got "${raw}")`);
    const out = {};
    for (const conjunct of body.split(";")) {
      const eq = conjunct.indexOf("=");
      if (eq <= 0) throw new Error(`selector_malformed: bad conjunct "${conjunct}" in "${raw}"`);
      const key = conjunct.slice(0, eq);
      const value = conjunct.slice(eq + 1);
      if (key === "model_family") {
        if (out.model_family !== void 0)
          throw new Error(`selector_malformed: duplicate conjunct key "model_family" in "${raw}"`);
        if (!value) throw new Error(`selector_malformed: empty model_family in "${raw}"`);
        out.model_family = value;
      } else if (key === "tier") {
        if (out.tier !== void 0)
          throw new Error(`selector_malformed: duplicate conjunct key "tier" in "${raw}"`);
        if (!POLICY_TIERS.includes(value)) {
          throw new Error(
            `selector_malformed: tier "${value}" invalid in "${raw}" (cheap|mid|powerful; tier=unknown is invalid)`
          );
        }
        out.tier = value;
      } else {
        throw new Error(`selector_malformed: unknown expr key "${key}" in "${raw}" (closed: model_family, tier)`);
      }
    }
    if (out.model_family === void 0 && out.tier === void 0) {
      throw new Error(`selector_malformed: expr needs at least one conjunct ("${raw}")`);
    }
    return { form: "expr", ...out };
  }
  throw new Error(
    `selector_malformed: "${raw}" is not id:/alias:/expr: (bare strings and unknown prefixes are rejected)`
  );
}
function maxComplexity(a, b) {
  return COMPLEXITY_ORDER[a] >= COMPLEXITY_ORDER[b] ? a : b;
}
function purposeComplexityFloor(purpose) {
  return purpose === "research" ? "hard" : "easy";
}
function purposeTierFloor(purpose) {
  if (purpose === "research" || isReviewClassPurpose(purpose)) return "powerful";
  return null;
}
function tierForComplexity(c) {
  return c === "easy" ? "cheap" : c === "medium" ? "mid" : "powerful";
}
function reachableComplexities(purpose, minEffectiveComplexity) {
  const floor = maxComplexity(purposeComplexityFloor(purpose), minEffectiveComplexity);
  return COMPLEXITIES.filter((c) => COMPLEXITY_ORDER[c] >= COMPLEXITY_ORDER[floor]);
}
function isPlainObject4(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function rejectUnknownKeys(obj, allowed, where, rejects) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      rejects.push(`${where}: unknown key "${k}" (closed key set: ${allowed.join(", ")})`);
    }
  }
}
function validateSelectorEntry(entry, where, rejects) {
  if (!isPlainObject4(entry)) {
    rejects.push(`${where}: selector entry must be an object with a "selector" key`);
    return;
  }
  rejectUnknownKeys(entry, ["selector", "effort", "capabilities"], where, rejects);
  if (typeof entry["selector"] !== "string") {
    rejects.push(`${where}: "selector" must be a string (bare/missing selectors are rejected)`);
  } else {
    try {
      parseSelector(entry["selector"]);
    } catch (e) {
      rejects.push(`${where}: ${e.message}`);
    }
  }
  if (entry["effort"] !== void 0 && entry["effort"] !== null && typeof entry["effort"] !== "string") {
    rejects.push(`${where}: "effort" must be a string or null`);
  }
  if (entry["capabilities"] !== void 0) {
    const caps = entry["capabilities"];
    if (!Array.isArray(caps) || caps.some((c) => typeof c !== "string")) {
      rejects.push(`${where}: "capabilities" must be an array of capability-key strings`);
    }
  }
}
function validateModelPolicy(input, opts) {
  const rejects = [];
  if (!isPlainObject4(input)) {
    return [`model_policy: must be an object (guild.model_policy.v2)`];
  }
  rejectUnknownKeys(input, ["version", "allow_advertised_attempt", "purposes"], "model_policy", rejects);
  if (input["version"] !== 2) {
    rejects.push(`model_policy.version: must be 2 (got ${JSON.stringify(input["version"])})`);
  }
  if (input["allow_advertised_attempt"] !== void 0 && typeof input["allow_advertised_attempt"] !== "boolean") {
    rejects.push(`model_policy.allow_advertised_attempt: must be a boolean (default false)`);
  }
  const purposes = input["purposes"];
  if (!isPlainObject4(purposes)) {
    rejects.push(`model_policy.purposes: must be an object keyed by the closed purpose enum`);
    return rejects;
  }
  for (const [purposeKey, rawPurpose] of Object.entries(purposes)) {
    const where = `model_policy.purposes.${purposeKey}`;
    if (!POLICY_PURPOSES.includes(purposeKey)) {
      rejects.push(`${where}: unknown purpose (closed enum: ${POLICY_PURPOSES.join(", ")})`);
      continue;
    }
    const purpose = purposeKey;
    if (!isPlainObject4(rawPurpose)) {
      rejects.push(`${where}: must be an object`);
      continue;
    }
    rejectUnknownKeys(
      rawPurpose,
      ["min_effective_complexity", "independence", "confirm_on_degradation", "routes"],
      where,
      rejects
    );
    const minC = rawPurpose["min_effective_complexity"];
    if (!COMPLEXITIES.includes(minC)) {
      rejects.push(`${where}.min_effective_complexity: must be easy|medium|hard`);
    }
    if (purpose === "research" && minC !== "hard") {
      rejects.push(
        `${where}.min_effective_complexity: research is ALWAYS hard/powerful (research_always_hard); "${String(minC)}" lowers the non-downgradable floor`
      );
    }
    const independence = rawPurpose["independence"];
    if (!INDEPENDENCE_LEVELS.includes(independence)) {
      rejects.push(`${where}.independence: must be none|prefer_cross_family|require_cross_family`);
    }
    if (typeof rawPurpose["confirm_on_degradation"] !== "boolean") {
      rejects.push(`${where}.confirm_on_degradation: must be a boolean`);
    }
    if (independence === "require_cross_family" && rawPurpose["confirm_on_degradation"] === false) {
      rejects.push(
        `${where}: independence require_cross_family requires confirm_on_degradation:true (a same-family fallback must take the explicit weak-degradation labelling path, never silent)`
      );
    }
    const routes = rawPurpose["routes"];
    if (!Array.isArray(routes) || routes.length === 0) {
      rejects.push(`${where}.routes: must be a non-empty array (closed route table, \xA71b)`);
      continue;
    }
    routes.forEach((rawRoute, i) => {
      const rWhere = `${where}.routes[${i}]`;
      if (!isPlainObject4(rawRoute)) {
        rejects.push(`${rWhere}: must be an object`);
        return;
      }
      rejectUnknownKeys(
        rawRoute,
        ["complexity", "condition", "preferred", "fallbacks", "provider_default"],
        rWhere,
        rejects
      );
      const complexity = rawRoute["complexity"];
      if (complexity !== "any" && !COMPLEXITIES.includes(complexity)) {
        rejects.push(`${rWhere}.complexity: must be easy|medium|hard|any`);
      }
      const condition = rawRoute["condition"];
      if (condition !== void 0) {
        if (!isPlainObject4(condition)) {
          rejects.push(`${rWhere}.condition: must be an object {kind, model_family}`);
        } else {
          rejectUnknownKeys(condition, ["kind", "model_family"], `${rWhere}.condition`, rejects);
          const kind = condition["kind"];
          if (!CONDITION_KINDS.includes(kind)) {
            rejects.push(`${rWhere}.condition.kind: must be always|producer_model_family_is|producer_model_family_is_not`);
          } else if (kind === "always") {
            if (condition["model_family"] !== null && condition["model_family"] !== void 0) {
              rejects.push(`${rWhere}.condition.model_family: MUST be null when kind = always`);
            }
          } else {
            if (typeof condition["model_family"] !== "string" || condition["model_family"].length === 0) {
              rejects.push(`${rWhere}.condition.model_family: REQUIRED (non-empty string) when kind \u2260 always`);
            }
            if (!isReviewClassPurpose(purpose)) {
              rejects.push(
                `${rWhere}.condition: non-always conditions are valid ONLY on review-class purposes (advisory, adversarial, security, adversarial-security) \u2014 "${purpose}" has no producer`
              );
            }
          }
        }
      }
      const preferred = rawRoute["preferred"];
      if (!Array.isArray(preferred) || preferred.length === 0) {
        rejects.push(`${rWhere}.preferred: must be a non-empty ordered selector list`);
      } else {
        preferred.forEach((entry, j) => validateSelectorEntry(entry, `${rWhere}.preferred[${j}]`, rejects));
        if (purpose === "security") {
          preferred.forEach((entry, j) => {
            if (isPlainObject4(entry) && typeof entry["selector"] === "string" && !entry["selector"].startsWith("id:")) {
              rejects.push(
                `${rWhere}.preferred[${j}]: security-purpose preferred selectors must be pinned "id:" selectors (got "${entry["selector"]}")`
              );
            }
          });
        }
      }
      const fallbacks = rawRoute["fallbacks"];
      if (!Array.isArray(fallbacks)) {
        rejects.push(`${rWhere}.fallbacks: must be an array (may be empty)`);
      } else {
        fallbacks.forEach((entry, j) => validateSelectorEntry(entry, `${rWhere}.fallbacks[${j}]`, rejects));
      }
      const tierFloor = purposeTierFloor(purpose);
      if (tierFloor !== null) {
        const checkSelectorFloor = (entry, sWhere) => {
          if (!isPlainObject4(entry) || typeof entry["selector"] !== "string") return;
          let parsed;
          try {
            parsed = parseSelector(entry["selector"]);
          } catch {
            return;
          }
          if (parsed.form === "expr" && parsed.tier !== void 0 && parsed.tier !== tierFloor) {
            rejects.push(
              `${sWhere}: "${entry["selector"]}" names tier "${parsed.tier}" on a "${purpose}" route \u2014 the \xA73 purpose tier floor is "${tierFloor}" (non-downgradable)`
            );
            return;
          }
          const catalog = opts?.catalog_models;
          if (!catalog) return;
          for (const m of catalog) {
            const matches = parsed.form === "id" ? m.canonical_id === parsed.canonical_id : parsed.form === "alias" ? Array.isArray(m.aliases) && m.aliases.includes(parsed.alias) : (parsed.model_family === void 0 || m.model_family === parsed.model_family) && (parsed.tier === void 0 || m.tier === parsed.tier);
            if (matches && m.tier !== tierFloor) {
              rejects.push(
                `${sWhere}: "${entry["selector"]}" resolves to catalog model "${String(m.canonical_id)}" at tier "${m.tier ?? "unknown"}" \u2014 "${purpose}" routes must stay at the "${tierFloor}" floor (\xA73; research_always_hard forces hard AND powerful)`
              );
            }
          }
        };
        if (Array.isArray(preferred)) {
          preferred.forEach((entry, j) => checkSelectorFloor(entry, `${rWhere}.preferred[${j}]`));
        }
        if (Array.isArray(fallbacks)) {
          fallbacks.forEach((entry, j) => checkSelectorFloor(entry, `${rWhere}.fallbacks[${j}]`));
        }
      }
      const providerDefault = rawRoute["provider_default"];
      if (providerDefault !== void 0 && providerDefault !== "forbid" && providerDefault !== "allow_last_resort") {
        rejects.push(`${rWhere}.provider_default: must be forbid|allow_last_resort (default forbid)`);
      }
      if (providerDefault === "allow_last_resort" && (purpose === "research" || isReviewClassPurpose(purpose))) {
        rejects.push(
          `${rWhere}.provider_default: allow_last_resort is rejected on "${purpose}" routes (research and review-class purposes must be forbid)`
        );
      }
    });
    if (COMPLEXITIES.includes(minC)) {
      const reachable = reachableComplexities(purpose, minC);
      for (const c of reachable) {
        const covered = routes.some((r) => {
          if (!isPlainObject4(r)) return false;
          const rc = r["complexity"];
          const cond = r["condition"];
          const isAlways = cond === void 0 || isPlainObject4(cond) && cond["kind"] === "always";
          return (rc === c || rc === "any") && isAlways;
        });
        if (!covered) {
          rejects.push(
            `${where}.routes: route_incomplete \u2014 reachable effective_complexity "${c}" has no matching always-condition row (\xA71b coverage)`
          );
        }
      }
    }
  }
  return rejects;
}
var POLICY_PURPOSES, REVIEW_CLASS_PURPOSES, COMPLEXITIES, CONDITION_KINDS, INDEPENDENCE_LEVELS, POLICY_TIERS, COMPLEXITY_ORDER, OPERATOR_BASELINE_POLICY;
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
    COMPLEXITY_ORDER = { easy: 0, medium: 1, hard: 2 };
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
function parseWorkspaceManifest(manifestPath) {
  let raw;
  try {
    if (!fs16.existsSync(manifestPath)) return { status: "absent" };
    raw = fs16.readFileSync(manifestPath, "utf8");
  } catch (e) {
    return { status: "parse_error", error: e instanceof Error ? e.message : String(e) };
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    return { status: "parse_error", error: e instanceof Error ? e.message : String(e) };
  }
  if (manifest && manifest.is_workspace === true) {
    return { status: "workspace", manifest };
  }
  return { status: "not_workspace" };
}
function discoverWorkspace(startDir) {
  let current = path21.dirname(startDir);
  const fsRoot = path21.parse(current).root;
  while (current !== fsRoot) {
    const manifestPath = path21.join(durableGuildDir(current), "workspace.json");
    const parsed = parseWorkspaceManifest(manifestPath);
    if (parsed.status === "workspace") {
      return { rootDir: current, manifest: parsed.manifest };
    }
    if (parsed.status === "not_workspace") {
      return null;
    }
    const parent = path21.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
var fs16, path21;
var init_workspace_manifest = __esm({
  "src/domains/config/workspace-manifest.ts"() {
    fs16 = __toESM(require("fs"));
    path21 = __toESM(require("path"));
    init_state();
  }
});

// src/domains/config/settings-reader.ts
function sparseRoles(raw) {
  const out = {};
  for (const k of ["host", "advisory", "adversarial"]) {
    const v = raw[k];
    if (v === null) out[k] = null;
    else if (typeof v === "string") {
      const normalized = normalizeHostId(v);
      if (normalized) out[k] = normalized;
    }
  }
  return out;
}
function sparseHostProfiles(raw) {
  return filterHostProfiles(raw);
}
function sparseTierHostMap(raw) {
  const out = {};
  for (const hk of Object.keys(raw)) {
    const canonicalHostId = normalizeHostId(hk);
    if (canonicalHostId) out[canonicalHostId] = raw[hk];
  }
  return out;
}
function normalizeDispatchHostId(value) {
  const normalized = normalizeHostId(value);
  return normalized && DISPATCH_HOST_IDS.has(normalized) ? normalized : null;
}
function coerceCapability(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw;
  if (CAPABILITY_RESOLVER_MODES.includes(r["resolver_mode"])) {
    out.resolver_mode = r["resolver_mode"];
  }
  if (CAPABILITY_AUTO_CREATE_POLICIES.includes(r["auto_create_policy"])) {
    out.auto_create_policy = r["auto_create_policy"];
  }
  const b = r["suggestion_budget"];
  if (typeof b === "number" && Number.isFinite(b)) {
    out.suggestion_budget = Math.min(
      CAPABILITY_SUGGESTION_BUDGET_MAX,
      Math.max(CAPABILITY_SUGGESTION_BUDGET_MIN, Math.trunc(b))
    );
  }
  const roles = r["starter_roles"];
  if (Array.isArray(roles)) {
    const seen = /* @__PURE__ */ new Set();
    const acc = [];
    for (const entry of roles) {
      if (!isCanonicalRoleSlug(entry)) continue;
      const key = roleSlugDedupKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      acc.push(entry);
    }
    out.starter_roles = acc;
  }
  return out;
}
function isPlainObject5(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function deepMerge(base, overlay) {
  const result2 = Object.assign(/* @__PURE__ */ Object.create(null), base);
  for (const [k, v] of Object.entries(overlay)) {
    if (PROTO_POISON_KEYS.has(k)) continue;
    if (Array.isArray(v)) {
      result2[k] = v;
    } else if (isPlainObject5(v) && isPlainObject5(result2[k])) {
      result2[k] = deepMerge(
        result2[k],
        v
      );
    } else {
      result2[k] = v;
    }
  }
  return { ...result2 };
}
function stampLayer(sources, obj, layer, prefix = "") {
  for (const [k, v] of Object.entries(obj)) {
    if (PROTO_POISON_KEYS.has(k) || v === void 0) continue;
    const full = prefix ? `${prefix}.${k}` : k;
    sources[full] = layer;
    if (isPlainObject5(v)) {
      stampLayer(sources, v, layer, full);
    } else {
      const below = `${full}.`;
      for (const s of Object.keys(sources)) if (s.startsWith(below)) delete sources[s];
    }
  }
}
function collectKeyPaths(obj, prefix = "") {
  const paths = /* @__PURE__ */ new Set();
  for (const [k, v] of Object.entries(obj)) {
    if (PROTO_POISON_KEYS.has(k)) continue;
    const full = prefix ? `${prefix}.${k}` : k;
    paths.add(full);
    if (isPlainObject5(v)) {
      for (const sub of collectKeyPaths(v, full)) {
        paths.add(sub);
      }
    }
  }
  return paths;
}
function validateLocalKeysOrThrow(localObj, baseObj) {
  const basePaths = collectKeyPaths(baseObj);
  for (const key of Object.keys(localObj)) {
    if (PROTO_POISON_KEYS.has(key)) {
      throw new Error(
        `share-dot-guild: settings.local.json key '${key}' is a dangerous prototype key \u2014 rejected.`
      );
    }
    if (key.startsWith("_")) continue;
    if (!basePaths.has(key)) {
      throw new Error(
        `share-dot-guild: settings.local.json key '${key}' not in settings.json schema \u2014 refusing to silently extend. Declare it in settings.json first (with the team default) or remove it from settings.local.json.`
      );
    }
  }
}
function rigorProfile(rigor) {
  switch (rigor) {
    case "quick":
      return { loops: "none", loop_cap: null, review: "off" };
    case "deep":
      return { loops: "all", loop_cap: 16, review: "cross" };
    case "standard":
    default:
      return { loops: "spec,plan", loop_cap: 16, review: "local" };
  }
}
function parseSettingsFile(filePath) {
  if (!fs17.existsSync(filePath)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs17.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
  return parseSettingsFile_fromParsed(parsed);
}
function parseLocalFile(guildDir) {
  const localPath = path22.join(guildDir, "settings.local.json");
  if (!fs17.existsSync(localPath)) return {};
  let localParsed;
  try {
    localParsed = JSON.parse(fs17.readFileSync(localPath, "utf8"));
  } catch {
    return {};
  }
  validateLocalKeysOrThrow(localParsed, DEFAULTS2);
  return parseSettingsFile_fromParsed(localParsed);
}
function parseSettingsFile_fromParsed(parsed) {
  const out = {};
  if (VALID_RIGOR.has(parsed["rigor"]))
    out.rigor = parsed["rigor"];
  if (Array.isArray(parsed["auto_approve"]))
    out.auto_approve = parsed["auto_approve"];
  if (VALID_REVIEW.has(parsed["review"]))
    out.review = parsed["review"];
  if (parsed["host"] === "auto") out.host = "auto";
  else if (typeof parsed["host"] === "string") {
    const normalized = normalizeDispatchHostId(parsed["host"]);
    if (normalized) out.host = normalized;
  }
  if (parsed["host_mode"] === null) out.host_mode = null;
  else if (typeof parsed["host_mode"] === "string" && HOST_MODES.includes(parsed["host_mode"]))
    out.host_mode = parsed["host_mode"];
  if (isPlainObject5(parsed["roles"]))
    out.roles = sparseRoles(parsed["roles"]);
  if (isPlainObject5(parsed["host_profiles"]))
    out.host_profiles = sparseHostProfiles(parsed["host_profiles"]);
  if (parsed["initiative_default"] === null || typeof parsed["initiative_default"] === "string")
    out.initiative_default = parsed["initiative_default"];
  if (parsed["index"] === "auto" || parsed["index"] === "off")
    out.index = parsed["index"];
  if (typeof parsed["record_status_runs"] === "boolean")
    out.record_status_runs = parsed["record_status_runs"];
  if (parsed["codex_skip_enforcement"] === "warn" || parsed["codex_skip_enforcement"] === "block")
    out.codex_skip_enforcement = parsed["codex_skip_enforcement"];
  if (VALID_AGENT_MODE.has(parsed["agent_mode"]))
    out.agent_mode = parsed["agent_mode"];
  if (isPlainObject5(parsed["workspace"])) {
    const ws = parsed["workspace"];
    const wsMode = ws["mode"];
    if (wsMode === "auto" || wsMode === "on" || wsMode === "off") {
      out.workspace = { mode: wsMode };
    }
  }
  if (parsed["model_policy"] === null) out.model_policy = null;
  else if (isPlainObject5(parsed["model_policy"]) && validateModelPolicy(parsed["model_policy"]).length === 0)
    out.model_policy = parsed["model_policy"];
  if (isPlainObject5(parsed["models"])) {
    const rawModels = parsed["models"];
    const sparse = {};
    if (typeof rawModels["enabled"] === "boolean") sparse.enabled = rawModels["enabled"];
    if (isPlainObject5(rawModels["tiers"])) {
      const rt = rawModels["tiers"];
      const sparseTiers = {};
      for (const tier of ["cheap", "mid", "powerful"]) {
        if (isPlainObject5(rt[tier])) sparseTiers[tier] = sparseTierHostMap(rt[tier]);
      }
      sparse.tiers = sparseTiers;
    }
    if (isPlainObject5(rawModels["scoreWeights"])) sparse.scoreWeights = rawModels["scoreWeights"];
    if (isPlainObject5(rawModels["thresholds"])) sparse.thresholds = rawModels["thresholds"];
    if (typeof rawModels["advisorRounds"] === "number" && rawModels["advisorRounds"] >= 1)
      sparse.advisorRounds = Math.floor(rawModels["advisorRounds"]);
    if (Array.isArray(rawModels["escalationMarkers"])) sparse.escalationMarkers = rawModels["escalationMarkers"];
    if (typeof rawModels["recallBeforeRead"] === "boolean") sparse.recallBeforeRead = rawModels["recallBeforeRead"];
    if (typeof rawModels["recallScoreThreshold"] === "number") sparse.recallScoreThreshold = rawModels["recallScoreThreshold"];
    if (typeof rawModels["structuredOutputRequired"] === "boolean") sparse.structuredOutputRequired = rawModels["structuredOutputRequired"];
    if (isPlainObject5(rawModels["cacheTTL"])) {
      const rttl = rawModels["cacheTTL"];
      const newTTL = {};
      if (VALID_CACHE_TTL.has(rttl["coordinator"])) newTTL.coordinator = rttl["coordinator"];
      if (VALID_CACHE_TTL.has(rttl["leaf"])) newTTL.leaf = rttl["leaf"];
      sparse.cacheTTL = newTTL;
    }
    if (typeof rawModels["importanceGate"] === "number" && rawModels["importanceGate"] >= 1 && rawModels["importanceGate"] <= 5)
      sparse.importanceGate = Math.floor(rawModels["importanceGate"]);
    if (typeof rawModels["compositeRecall"] === "boolean")
      sparse.compositeRecall = rawModels["compositeRecall"];
    if (typeof rawModels["importanceAtIngest"] === "boolean")
      sparse.importanceAtIngest = rawModels["importanceAtIngest"];
    if (typeof rawModels["ingestSimilarityGate"] === "number" && rawModels["ingestSimilarityGate"] >= 0 && rawModels["ingestSimilarityGate"] <= 1)
      sparse.ingestSimilarityGate = rawModels["ingestSimilarityGate"];
    if (isPlainObject5(rawModels["shortOutputThreshold"])) {
      const sot = rawModels["shortOutputThreshold"];
      const sotMerged = {};
      for (const taskType of Object.keys(sot)) {
        if (!isPlainObject5(sot[taskType])) continue;
        const innerRaw = sot[taskType];
        const innerMerged = {};
        for (const tier of Object.keys(innerRaw)) {
          if (typeof innerRaw[tier] === "number") innerMerged[tier] = innerRaw[tier];
        }
        if (Object.keys(innerMerged).length > 0) sotMerged[taskType] = innerMerged;
      }
      sparse.shortOutputThreshold = sotMerged;
    }
    if (isPlainObject5(rawModels["knowledge"])) {
      const rawK = rawModels["knowledge"];
      const sparseK = {};
      if (typeof rawK["maxDepth"] === "number" && rawK["maxDepth"] >= 1)
        sparseK.maxDepth = Math.floor(rawK["maxDepth"]);
      if (typeof rawK["maxBranching"] === "number" && rawK["maxBranching"] >= 1)
        sparseK.maxBranching = Math.floor(rawK["maxBranching"]);
      if (typeof rawK["minTopicImportance"] === "number" && rawK["minTopicImportance"] >= 0 && rawK["minTopicImportance"] <= 1)
        sparseK.minTopicImportance = rawK["minTopicImportance"];
      if (typeof rawK["relMinConf"] === "number" && rawK["relMinConf"] >= 0 && rawK["relMinConf"] <= 1)
        sparseK.relMinConf = rawK["relMinConf"];
      if (typeof rawK["maxFiles"] === "number" && rawK["maxFiles"] >= 1)
        sparseK.maxFiles = Math.floor(rawK["maxFiles"]);
      if (typeof rawK["maxTokens"] === "number" && rawK["maxTokens"] >= 1)
        sparseK.maxTokens = Math.floor(rawK["maxTokens"]);
      if (typeof rawK["batchSize"] === "number" && rawK["batchSize"] >= 1)
        sparseK.batchSize = Math.floor(rawK["batchSize"]);
      sparse.knowledge = sparseK;
    }
    out.models = sparse;
  }
  if (isPlainObject5(parsed["security"])) {
    const rawSec = parsed["security"];
    const sparseSec = {};
    const bpp = rawSec["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") sparseSec.bypass_permissions_policy = bpp;
    out.security = sparseSec;
  }
  if (isPlainObject5(parsed["secrets_policy"])) {
    const rawSp = parsed["secrets_policy"];
    const sparseSp = {};
    if (Array.isArray(rawSp["env_allowlist"])) sparseSp.env_allowlist = rawSp["env_allowlist"];
    if (Array.isArray(rawSp["redaction_patterns"])) sparseSp.redaction_patterns = rawSp["redaction_patterns"];
    if (rawSp["fail_mode_durable"] === "closed" || rawSp["fail_mode_durable"] === "open") sparseSp.fail_mode_durable = rawSp["fail_mode_durable"];
    if (rawSp["fail_mode_telemetry"] === "open" || rawSp["fail_mode_telemetry"] === "closed") sparseSp.fail_mode_telemetry = rawSp["fail_mode_telemetry"];
    out.secrets_policy = sparseSp;
  }
  if (isPlainObject5(parsed["mcp"])) {
    const rawMcp = parsed["mcp"];
    const sparseMcp = {};
    if (isPlainObject5(rawMcp["tool_description_hashes"]))
      sparseMcp.tool_description_hashes = rawMcp["tool_description_hashes"];
    if (typeof rawMcp["stdio_available"] === "boolean") sparseMcp.stdio_available = rawMcp["stdio_available"];
    if (typeof rawMcp["http_available"] === "boolean") sparseMcp.http_available = rawMcp["http_available"];
    if (rawMcp["bridge_package"] === null || typeof rawMcp["bridge_package"] === "string")
      sparseMcp.bridge_package = rawMcp["bridge_package"];
    out.mcp = sparseMcp;
  }
  if (isPlainObject5(parsed["capability"])) {
    const rawCapability = parsed["capability"];
    const known2 = {};
    for (const k of Object.keys(rawCapability)) {
      if (VALID_CAPABILITY_KEYS.has(k)) known2[k] = rawCapability[k];
    }
    out.capability = coerceCapability(known2);
  }
  if (typeof parsed["statusline"] === "boolean") out.statusline = parsed["statusline"];
  if (typeof parsed["adversarial_review_provider"] === "string") {
    out.adversarial_review_provider = parsed["adversarial_review_provider"];
  }
  if (typeof parsed["loops"] === "string" || parsed["loops"] === null)
    out.loops = parsed["loops"];
  if (typeof parsed["loop_cap"] === "number")
    out.loop_cap = Math.min(256, Math.max(1, parsed["loop_cap"]));
  if (typeof parsed["codex_cap"] === "number")
    out.codex_cap = Math.min(10, Math.max(1, parsed["codex_cap"]));
  if (isPlainObject5(parsed["defaults"])) {
    const rawDefaults = parsed["defaults"];
    const sparseDefaults = {};
    for (const k of Object.keys(rawDefaults)) {
      if (DEFAULTS_ALLOWED_KEYS.has(k)) sparseDefaults[k] = rawDefaults[k];
    }
    out.defaults = sparseDefaults;
  }
  return out;
}
function assembleLayers(layers, flagsLayer) {
  let accumulated = deepMerge(/* @__PURE__ */ Object.create(null), DEFAULTS2);
  for (const layer of layers) {
    if (Object.keys(layer).length === 0) continue;
    accumulated = deepMerge(accumulated, layer);
  }
  if (Object.keys(flagsLayer).length > 0) {
    accumulated = deepMerge(accumulated, flagsLayer);
  }
  return accumulated;
}
function crossHostAvailable() {
  const v = process.env["GUILD_CROSS_HOST_AVAILABLE"];
  if (v === void 0) return true;
  const s = v.trim().toLowerCase();
  return !(s === "0" || s === "false" || s === "no" || s === "off");
}
function isValidInitiativeId(id) {
  if (!id || !id.trim()) return false;
  if (id.includes("\0")) return false;
  if (id.startsWith("/") || id.startsWith("\\")) return false;
  if (id.includes("/") || id.includes("\\")) return false;
  if (id === ".") return false;
  if (id === ".." || id.startsWith("..")) return false;
  if (id.includes("..")) return false;
  return true;
}
function isContainedIn(candidatePath, baseDir) {
  const resolved = path22.resolve(candidatePath);
  const resolvedBase = path22.resolve(baseDir);
  return resolved.startsWith(resolvedBase + path22.sep);
}
function initiativeIsWorkspaceScoped(workspaceRoot2, id) {
  try {
    if (!isValidInitiativeId(id)) return false;
    const registryPath = path22.join(
      durableGuildDir(workspaceRoot2),
      "indexes",
      "initiatives-registry.yaml"
    );
    if (fs17.existsSync(registryPath)) {
      try {
        const raw = fs17.readFileSync(registryPath, "utf8");
        const parsed = yaml.load(raw);
        if (isPlainObject5(parsed)) {
          const list = parsed["initiatives"];
          if (Array.isArray(list)) {
            for (const entry of list) {
              if (!isPlainObject5(entry)) continue;
              const rec = entry;
              if (rec["id"] === id) {
                return rec["scope"] === "workspace";
              }
            }
          }
        }
      } catch {
        return false;
      }
    }
    const initiativesBase = path22.join(durableGuildDir(workspaceRoot2), "initiatives");
    const activePath = path22.join(
      initiativesBase,
      "active",
      id,
      "initiative.yaml"
    );
    const archivedPath = path22.join(
      initiativesBase,
      "archived",
      id,
      "initiative.yaml"
    );
    const activeBase = path22.join(initiativesBase, "active");
    const archivedBase = path22.join(initiativesBase, "archived");
    if (!isContainedIn(activePath, activeBase) && !isContainedIn(archivedPath, archivedBase)) {
      return false;
    }
    let yamlPath = null;
    if (isContainedIn(activePath, activeBase) && fs17.existsSync(activePath)) {
      yamlPath = activePath;
    } else if (isContainedIn(archivedPath, archivedBase) && fs17.existsSync(archivedPath)) {
      yamlPath = archivedPath;
    }
    if (yamlPath !== null) {
      try {
        const raw = fs17.readFileSync(yamlPath, "utf8");
        const parsed = yaml.load(raw);
        if (isPlainObject5(parsed)) {
          const doc = parsed["initiative"];
          if (isPlainObject5(doc)) {
            return doc["scope"] === "workspace";
          }
        }
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }
  return false;
}
function wasExplicitlySet(key, ...layers) {
  return layers.some((layer) => key in layer && layer[key] !== void 0);
}
function resolveSettings(opts) {
  const { cwd, flags = {} } = opts;
  const ws = discoverWorkspace(cwd);
  const sources = {};
  stampLayer(sources, DEFAULTS2, "builtin");
  sources["workspace.mode"] = "builtin";
  let wsSettings = {};
  let wsLocalSettings = {};
  if (ws !== null) {
    const wsGuildDir = durableGuildDir(ws.rootDir);
    const rawWsSettings = parseSettingsFile(path22.join(wsGuildDir, "settings.json"));
    const wsInheritable = {};
    for (const [k, v] of Object.entries(rawWsSettings)) {
      const key = k;
      if (!NON_INHERITABLE_KEYS.has(key)) {
        wsInheritable[key] = v;
      } else if (key === "initiative_default" && typeof v === "string" && v !== null) {
        if (initiativeIsWorkspaceScoped(ws.rootDir, v)) {
          wsInheritable[key] = v;
        }
      }
    }
    wsSettings = wsInheritable;
    const { workspace: _wsMode, ...wsStamp } = wsSettings;
    stampLayer(sources, wsStamp, "workspace");
    try {
      const rawWsLocal = parseLocalFile(wsGuildDir);
      const wsLocalInheritable = {};
      for (const [k, v] of Object.entries(rawWsLocal)) {
        const key = k;
        if (!NON_INHERITABLE_KEYS.has(key)) {
          wsLocalInheritable[key] = v;
        } else if (key === "initiative_default" && typeof v === "string" && v !== null) {
          if (initiativeIsWorkspaceScoped(ws.rootDir, v)) {
            wsLocalInheritable[key] = v;
          }
        }
      }
      wsLocalSettings = wsLocalInheritable;
      const { workspace: _wsLocalMode, ...wsLocalStamp } = wsLocalSettings;
      stampLayer(sources, wsLocalStamp, "workspace-local");
    } catch {
    }
  }
  const projectGuildDir = durableGuildDir(cwd);
  const projectSettings = parseSettingsFile(path22.join(projectGuildDir, "settings.json"));
  stampLayer(sources, projectSettings, "project");
  let projectLocalSettings = {};
  try {
    projectLocalSettings = parseLocalFile(projectGuildDir);
    stampLayer(sources, projectLocalSettings, "project-local");
  } catch {
  }
  stampLayer(sources, flags, "cli");
  const assembled = assembleLayers(
    [wsSettings, wsLocalSettings, projectSettings, projectLocalSettings],
    flags
  );
  const resolvedWorkspaceMode = {
    ...DEFAULTS2.workspace,
    ...projectSettings.workspace ?? {},
    ...projectLocalSettings.workspace ?? {},
    // FIX F2: project-local workspace now included
    ...flags.workspace ?? {}
  };
  assembled.workspace = resolvedWorkspaceMode;
  sources["workspace"] = sources["workspace.mode"];
  const loopsExplicit = wasExplicitlySet(
    "loops",
    wsSettings,
    wsLocalSettings,
    projectSettings,
    projectLocalSettings,
    flags
  ) && assembled.loops !== null;
  const loopCapExplicit = wasExplicitlySet(
    "loop_cap",
    wsSettings,
    wsLocalSettings,
    projectSettings,
    projectLocalSettings,
    flags
  );
  const reviewExplicit = wasExplicitlySet(
    "review",
    wsSettings,
    wsLocalSettings,
    projectSettings,
    projectLocalSettings,
    flags
  );
  if (assembled.loops) {
    for (const v of assembled.loops.split(",").map((s) => s.trim())) {
      if (!VALID_LOOPS.has(v)) {
        assembled.loops = null;
        break;
      }
    }
  }
  const loopsIsExplicit = loopsExplicit && assembled.loops !== null;
  const profile = rigorProfile(assembled.rigor);
  const applied = [];
  const overridden = [];
  let derivedReview = profile.review;
  let reviewFallback = false;
  let fallbackNote;
  if (assembled.rigor === "deep" && derivedReview === "cross" && !crossHostAvailable()) {
    derivedReview = "local";
    reviewFallback = true;
    fallbackNote = "rigor=deep implies review=cross, but the cross-host (Codex) is unavailable \u2014 fell back to review=local with a weak-independence caveat. Not a hard failure.";
  }
  if (loopsIsExplicit) {
    overridden.push("loops");
  } else {
    assembled.loops = profile.loops;
    applied.push("loops");
    if (sources.rigor !== "builtin") sources.loops = "rigor";
  }
  if (profile.loop_cap !== null) {
    if (loopCapExplicit) {
      overridden.push("loop_cap");
    } else {
      assembled.loop_cap = profile.loop_cap;
      applied.push("loop_cap");
      if (sources.rigor !== "builtin") sources.loop_cap = "rigor";
    }
  }
  if (reviewExplicit) {
    overridden.push("review");
  } else {
    assembled.review = derivedReview;
    applied.push("review");
    if (sources.rigor !== "builtin") sources.review = "rigor";
  }
  const rigorExpanded = {
    rigor: assembled.rigor,
    loops: profile.loops,
    loop_cap: profile.loop_cap,
    review: derivedReview,
    applied,
    overridden_by_explicit: overridden
  };
  if (assembled.rigor === "deep") rigorExpanded.review_implied = "cross";
  if (reviewFallback) {
    rigorExpanded.review_fallback = true;
    rigorExpanded.note = fallbackNote;
  }
  assembled._rigorExpanded = rigorExpanded;
  if (assembled.index === "off" && assembled.defaults.index.enabled !== false) {
    assembled.defaults = {
      ...assembled.defaults,
      index: { ...assembled.defaults.index, enabled: false }
    };
    sources["defaults.index.enabled"] = sources.index;
  }
  return { config: assembled, sources };
}
var fs17, path22, yaml, HOST_MODES, DEFAULTS2, VALID_TIER_HOST_KEYS, KNOWN_HOST_IDS2, VALID_LOOPS, VALID_RIGOR, VALID_REVIEW, DISPATCH_HOST_IDS, VALID_AGENT_MODE, VALID_CACHE_TTL, DEFAULTS_ALLOWED_KEYS, RESOLVER_TIER1_KEYS, VALID_CAPABILITY_KEYS;
var init_settings_reader = __esm({
  "src/domains/config/settings-reader.ts"() {
    fs17 = __toESM(require("fs"));
    path22 = __toESM(require("path"));
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
    HOST_MODES = ["read_only", "ask", "accept_edits", "auto", "bypass_all"];
    DEFAULTS2 = DEFAULTS;
    VALID_TIER_HOST_KEYS = new Set(HOST_IDS);
    KNOWN_HOST_IDS2 = new Set(HOST_IDS);
    VALID_LOOPS = /* @__PURE__ */ new Set(["none", "spec", "plan", "implementation", "all"]);
    VALID_RIGOR = /* @__PURE__ */ new Set(["quick", "standard", "deep"]);
    VALID_REVIEW = /* @__PURE__ */ new Set(["local", "cross", "off"]);
    DISPATCH_HOST_IDS = new Set(
      HOST_IDS.filter((id) => HOST_REGISTRY_ROWS[id].dispatch_selectable === true)
    );
    VALID_AGENT_MODE = /* @__PURE__ */ new Set(["team", "agent", "subagent", "auto"]);
    VALID_CACHE_TTL = /* @__PURE__ */ new Set(["1h", "5m", "off"]);
    DEFAULTS_ALLOWED_KEYS = /* @__PURE__ */ new Set([
      "auto_learn",
      "adversarial",
      "team",
      "review_workflow",
      "skill_policy",
      "gates",
      "wiki",
      "quality",
      "reporting",
      "index",
      "cross_host",
      "retry",
      "resume",
      // R-016
      "heartbeat_timeout_ms",
      // R-017
      "capability_manifest_ttl_s",
      // R-018
      "allowed_tools",
      // R-020
      "update",
      // plugin-update-lifecycle AC-6
      "lean_lead",
      "lifecycle_gate",
      // rf-wi-01 (G1)
      "dispatch"
      // #93: { block_unmarked_lanes: bool }
    ]);
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
    VALID_CAPABILITY_KEYS = /* @__PURE__ */ new Set([
      "resolver_mode",
      "suggestion_budget",
      "starter_roles",
      "auto_create_policy"
    ]);
  }
});

// src/domains/config/settings-resolver.ts
function telemetryApi() {
  if (_telemetryApi !== null) return _telemetryApi;
  if (__filename.endsWith(".ts")) {
    const sourceBarrel = path23.join(__dirname, "..", "telemetry");
    _telemetryApi = require(sourceBarrel);
    return _telemetryApi;
  }
  const sibling = path23.join(__dirname, "telemetry-api.js");
  if (fs18.existsSync(sibling)) {
    _telemetryApi = require(sibling);
    return _telemetryApi;
  }
  for (let dir = path23.dirname(__dirname); ; ) {
    const isPackageRoot = fs18.existsSync(path23.join(dir, "runtime")) || fs18.existsSync(path23.join(dir, ".claude-plugin")) || fs18.existsSync(path23.join(dir, ".codex-plugin")) || fs18.existsSync(path23.join(dir, "guild.inventory.json"));
    if (isPackageRoot) {
      const chunk = path23.join(dir, "runtime", "scripts", "telemetry-api.js");
      if (!fs18.existsSync(chunk)) {
        throw new Error(
          `guild: runtime/scripts/telemetry-api.js missing from package root ${dir} \u2014 incomplete package; run \`bun run compile\` (KTD10 fail-closed)`
        );
      }
      _telemetryApi = require(chunk);
      return _telemetryApi;
    }
    const parent = path23.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `guild: no package root found above ${__dirname} for telemetry-api.js (KTD10 fail-closed)`
  );
}
function resolveSettings2(opts) {
  const t0 = Date.now();
  const result2 = resolveSettings(opts);
  const { cwd, flags = {} } = opts;
  const _traceRunId = process.env["GUILD_RUN_ID"] ?? "";
  const _traceRunDir = _traceRunId && cwd ? path23.join(durableGuildDir(cwd), "runs", _traceRunId) : void 0;
  const _telemetry = _traceRunDir ? telemetryApi() : null;
  try {
    const assembled = result2.config;
    if (_traceRunDir && _telemetry) {
      const _fingerprint = crypto6.createHash("sha256").update(JSON.stringify(assembled)).digest("hex").slice(0, 16);
      const sources = result2.sources;
      _telemetry.emitTraceEvent(
        _telemetry.makeConfigResolutionEvent({
          ts: (/* @__PURE__ */ new Date()).toISOString(),
          run_id: _traceRunId,
          lane_id: process.env["GUILD_LANE_ID"] ?? "",
          rigor: String(assembled.rigor ?? "standard"),
          agent_mode: String(assembled.agent_mode ?? "default"),
          layers: {
            workspace: Object.values(sources).some((s) => s === "workspace"),
            workspace_local: Object.values(sources).some((s) => s === "workspace-local"),
            project: Object.values(sources).some((s) => s === "project"),
            project_local: Object.values(sources).some((s) => s === "project-local"),
            rigor: assembled._rigorExpanded?.rigor ?? null,
            cli: Object.keys(flags).length > 0
          },
          duration_ms: Date.now() - t0,
          config_fingerprint: _fingerprint
        }),
        _traceRunDir
      );
    }
  } catch {
  }
  return result2;
}
var fs18, path23, crypto6, _telemetryApi;
var init_settings_resolver = __esm({
  "src/domains/config/settings-resolver.ts"() {
    fs18 = __toESM(require("fs"));
    path23 = __toESM(require("path"));
    crypto6 = __toESM(require("crypto"));
    init_settings_reader();
    init_settings_reader();
    init_state();
    _telemetryApi = null;
  }
});

// src/domains/config/workspace-mode.ts
function resolveWorkspaceMode(root) {
  try {
    return resolveSettings2({ cwd: root }).config.workspace.mode;
  } catch {
    return "auto";
  }
}
var init_workspace_mode = __esm({
  "src/domains/config/workspace-mode.ts"() {
    init_settings_resolver();
  }
});

// src/domains/config/tier-model.ts
function normalizeTierValue(v) {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? { model: t } : { model: null };
  }
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const o = v;
    if (typeof o["model"] === "string" && o["model"].trim()) {
      const out = { model: o["model"].trim() };
      if (typeof o["effort"] === "string") out.effort = o["effort"];
      if (typeof o["reasoning"] === "string") out.reasoning = o["reasoning"];
      if (typeof o["thinking"] === "string") out.thinking = o["thinking"];
      if (typeof o["verbosity"] === "string") out.verbosity = o["verbosity"];
      return out;
    }
  }
  return { model: null };
}
function resolveTierModel(tiers, tier, host) {
  if (typeof tiers !== "object" || tiers === null || Array.isArray(tiers)) {
    return { model: null };
  }
  const entry = tiers[tier];
  if (entry === null || entry === void 0) return { model: null };
  if (typeof entry === "string") return normalizeTierValue(entry);
  if (typeof entry !== "object" || Array.isArray(entry)) return { model: null };
  const hostMap = entry;
  const canonical = normalizeHostId(host);
  if (canonical && canonical in hostMap) return normalizeTierValue(hostMap[canonical]);
  return normalizeTierValue(hostMap[host]);
}
var init_tier_model = __esm({
  "src/domains/config/tier-model.ts"() {
    init_host_id_namespace();
  }
});

// src/domains/config/catalog-cache.ts
function modelCatalogCacheDir(workspaceRoot2) {
  return modelCatalogCacheHome(workspaceRoot2);
}
function legacyModelCatalogCacheDir(workspaceRoot2) {
  return path24.join(workspaceRoot2, ...MODEL_CATALOG_CACHE_REL_SEGMENTS);
}
function isModelCatalogCachePath(rel2) {
  const norm = rel2.split(path24.sep).join("/");
  return norm === MODEL_CATALOG_CACHE_REL || norm.startsWith(`${MODEL_CATALOG_CACHE_REL}/`);
}
function needsQuote(value) {
  if (value.length === 0) return true;
  if (YAML_KEYWORD.test(value) || YAML_NUMBER.test(value) || YAML_SEXAGESIMAL.test(value)) return true;
  if (/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true;
  if (/\s$/.test(value)) return true;
  if (value.includes(": ") || value.endsWith(":")) return true;
  if (value.includes(" #")) return true;
  if (/[\n\t\x00-\x1f\x7f-\x9f\u00a0\u2028\u2029]/.test(value)) return true;
  return false;
}
function yamlScalar(value) {
  if (!needsQuote(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}
function canonicalYamlFlat(map) {
  const keys = Object.keys(map).sort();
  return keys.map((k) => `${k}: ${yamlScalar(map[k])}
`).join("");
}
function sha256Hex2(text) {
  return crypto7.createHash("sha256").update(text, "utf8").digest("hex");
}
function runScopeFor(input) {
  if (orgIsUnknown(input.org_fingerprint ?? void 0)) return input.run_id;
  return "shared";
}
function orgIsUnknown(org) {
  return org == null || org === "" || org === "unknown";
}
function isReusableCacheKey(key) {
  return MINTED_KEYS.has(key) && key.kind === "reusable";
}
function isRunLocalCacheKey(key) {
  return MINTED_KEYS.has(key) && key.kind === "run_local";
}
function assertMintedKey(key) {
  if (key == null || typeof key !== "object" || !MINTED_KEYS.has(key)) {
    throw new Error(
      "catalog-cache: not a minted CatalogCacheKey \u2014 keys are constructed ONLY by createCacheKey (T4-R2-002); raw strings, structural clones, and casts are rejected"
    );
  }
}
function snapshotIdentity(identity) {
  const snap = {};
  for (const component of CACHE_KEY_COMPONENTS) {
    if (component === "run_scope") continue;
    const desc = Object.getOwnPropertyDescriptor(identity, component);
    if (desc !== void 0 && (desc.get !== void 0 || desc.set !== void 0)) {
      throw new UnknownOrgQuarantineViolation(
        `identity component ${JSON.stringify(component)} is accessor-backed \u2014 a cache identity must be plain data so classification and hashing cannot observe different values`
      );
    }
    const value = identity[component];
    if (value == null || value === "") {
      snap[component] = "unknown";
      continue;
    }
    if (typeof value !== "string") {
      throw new UnknownOrgQuarantineViolation(
        `identity component ${JSON.stringify(component)} must be a plain string`
      );
    }
    snap[component] = value;
  }
  return Object.freeze(snap);
}
function hashKeyTuple(snapshot, runScope) {
  const hashed = { v: MODEL_CATALOG_SCHEMA_VERSION };
  for (const component of CACHE_KEY_COMPONENTS) {
    hashed[component] = component === "run_scope" ? runScope : snapshot[component];
  }
  return sha256Hex2(canonicalYamlFlat(hashed));
}
function createCacheKey(identity, runId) {
  for (const smuggled of NON_IDENTITY_KEYS) {
    const value = identity[smuggled];
    if (value != null && value !== "") {
      throw new UnknownOrgQuarantineViolation(
        `${JSON.stringify(smuggled)} is not an identity component \u2014 run_scope is derived internally (literal \`shared\` for a known org; the run id under quarantine) and can never be caller-supplied`
      );
    }
  }
  const snapshot = snapshotIdentity(identity);
  if (snapshot.org_fingerprint === "unknown") {
    if (runId == null || runId === "") {
      throw new UnknownOrgQuarantineViolation("an unknown-org identity requires a non-empty run_id");
    }
    const key2 = Object.freeze({
      kind: "run_local",
      hash: hashKeyTuple(snapshot, runId),
      run_scope: runId,
      [CATALOG_CACHE_KEY_BRAND]: true
    });
    MINTED_KEYS.add(key2);
    return key2;
  }
  const key = Object.freeze({
    kind: "reusable",
    hash: hashKeyTuple(snapshot, "shared"),
    run_scope: "shared",
    [CATALOG_CACHE_KEY_BRAND]: true
  });
  MINTED_KEYS.add(key);
  return key;
}
function createStore(rootDir, opts) {
  return rootDir ? new FileStore(rootDir, opts) : new MemoryStore();
}
function stampScope(key, snapshot) {
  const meta = snapshot.cache_meta;
  return { ...snapshot, cache_meta: { ...meta ?? {}, run_scope: key.run_scope } };
}
function publishSnapshot(store, key, snapshot) {
  assertMintedKey(key);
  return store.casPublish(key.hash, stampScope(key, snapshot));
}
function readSnapshot(store, key) {
  assertMintedKey(key);
  return store.read(key.hash);
}
function nextGeneration(store, key) {
  assertMintedKey(key);
  const current = store.read(key.hash);
  return (current?.generation ?? 0) + 1;
}
function singleflight(store, key, discoverers) {
  assertMintedKey(key);
  if (discoverers.length === 0) return [];
  const existing = store.read(key.hash);
  if (existing) return discoverers.map(() => existing);
  if (!store.tryLock(key.hash)) {
    const degraded = degradedRead(store, key.hash);
    return discoverers.map(() => degraded);
  }
  try {
    const recheck = store.read(key.hash);
    if (recheck) return discoverers.map(() => recheck);
    const discovered = discoverers[0]();
    store.casPublish(key.hash, stampScope(key, discovered));
    const shared = store.read(key.hash) ?? discovered;
    return discoverers.map(() => shared);
  } finally {
    store.unlock(key.hash);
  }
}
async function singleflightDiscover(store, key, discover, opts = {}) {
  assertMintedKey(key);
  const hash = key.hash;
  const lockWaitMs = opts.lockWaitMs ?? UNCACHED_DISCOVERY_BUDGET_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? 25;
  const isFresh = opts.isFresh ?? (() => true);
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const fresh = () => {
    const snap = store.read(hash);
    return snap && isFresh(snap) ? snap : null;
  };
  const cached = fresh();
  if (cached) return { snapshot: cached, role: "cached", discovery_ran: false };
  const deadline = now() + lockWaitMs;
  let locked = store.tryLock(hash);
  while (!locked) {
    const published = fresh();
    if (published) return { snapshot: published, role: "coalesced", discovery_ran: false };
    if (now() >= deadline) return { snapshot: degradedRead(store, hash), role: "degraded", discovery_ran: false };
    await sleep(pollIntervalMs);
    locked = store.tryLock(hash);
  }
  try {
    const published = fresh();
    if (published) return { snapshot: published, role: "coalesced", discovery_ran: false };
    const discovered = await discover();
    const current = store.read(hash);
    const snapshot = stampScope(key, {
      ...discovered,
      generation: (current?.generation ?? 0) + 1
    });
    store.casPublish(hash, snapshot);
    const shared = store.read(hash) ?? snapshot;
    return { snapshot: shared, role: "winner", discovery_ran: true };
  } finally {
    store.unlock(hash);
  }
}
function degradedRead(store, hash) {
  const cached = store.read(hash);
  if (cached) return { ...cached, degraded: true, probe_issued: false };
  return { degraded: true, probe_issued: false, evidence_state: "unknown" };
}
function readUnderLockTimeout(store, key) {
  assertMintedKey(key);
  return degradedRead(store, key.hash);
}
function isSnapshotStale(snapshot, nowIso) {
  const at = snapshot.discovery?.discovered_at;
  if (!at) return true;
  const discoveredMs = Date.parse(at);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(discoveredMs) || !Number.isFinite(nowMs)) return true;
  const ttl = (snapshot.discovery?.ttl_seconds ?? DEFAULT_CATALOG_TTL_SECONDS) * 1e3;
  return nowMs - discoveredMs > ttl;
}
function invalidateKey(store, key) {
  assertMintedKey(key);
  store.remove(key.hash);
}
function purgeRunLocalEntries(store, runId) {
  let purged = 0;
  for (const key of store.listKeys()) {
    const snap = store.read(key);
    const scope = snap?.cache_meta?.run_scope;
    if (scope === runId) {
      store.remove(key);
      purged += 1;
    }
  }
  return purged;
}
var crypto7, fs19, path24, MODEL_CATALOG_SCHEMA_VERSION, DEFAULT_CATALOG_TTL_SECONDS, UNCACHED_DISCOVERY_BUDGET_MS, CACHED_INSPECTION_BUDGET_MS, MODEL_CATALOG_CACHE_DIRNAME, MODEL_CATALOG_CACHE_REL_SEGMENTS, MODEL_CATALOG_CACHE_REL, YAML_KEYWORD, YAML_NUMBER, YAML_SEXAGESIMAL, CACHE_KEY_COMPONENTS, UnknownOrgQuarantineViolation, CATALOG_CACHE_KEY_BRAND, MINTED_KEYS, NON_IDENTITY_KEYS, MemoryStore, tmpSequence, SAFE_KEY, FileStore, defaultSleep;
var init_catalog_cache = __esm({
  "src/domains/config/catalog-cache.ts"() {
    crypto7 = __toESM(require("crypto"));
    fs19 = __toESM(require("fs"));
    path24 = __toESM(require("path"));
    init_state();
    MODEL_CATALOG_SCHEMA_VERSION = "guild.model_catalog.v1";
    DEFAULT_CATALOG_TTL_SECONDS = 600;
    UNCACHED_DISCOVERY_BUDGET_MS = 3e3;
    CACHED_INSPECTION_BUDGET_MS = 500;
    MODEL_CATALOG_CACHE_DIRNAME = "model-catalog";
    MODEL_CATALOG_CACHE_REL_SEGMENTS = Object.freeze([".guild", "indexes", MODEL_CATALOG_CACHE_DIRNAME]);
    MODEL_CATALOG_CACHE_REL = MODEL_CATALOG_CACHE_REL_SEGMENTS.join("/");
    YAML_KEYWORD = /^(?:null|Null|NULL|~|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/;
    YAML_NUMBER = /^[-+]?(?:0b[0-1_]+|0o[0-7_]+|0x[0-9a-fA-F_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\.[0-9_]+(?:[eE][-+]?[0-9]+)?|\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
    YAML_SEXAGESIMAL = /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+(?:\.[0-9_]*)?$/;
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
    UnknownOrgQuarantineViolation = class extends Error {
      constructor(detail) {
        super(
          `catalog-cache: unknown-org quarantine (\xA77) \u2014 ${detail}. An unknown org_fingerprint must never participate in a reusable cache identity; supply run_id so the key is run-local.`
        );
        this.name = "UnknownOrgQuarantineViolation";
      }
    };
    CATALOG_CACHE_KEY_BRAND = /* @__PURE__ */ Symbol("guild.catalog-cache.key");
    MINTED_KEYS = /* @__PURE__ */ new WeakSet();
    NON_IDENTITY_KEYS = ["run_scope", "run_id", "v"];
    MemoryStore = class {
      kind = "memory";
      entries = /* @__PURE__ */ new Map();
      locked = /* @__PURE__ */ new Set();
      read(key) {
        return this.entries.get(key) ?? null;
      }
      casPublish(key, snapshot) {
        if (typeof snapshot?.generation !== "number" || !Number.isFinite(snapshot.generation)) {
          return { published: false, reason: "invalid_snapshot" };
        }
        const current = this.entries.get(key);
        if (current && current.generation >= snapshot.generation) {
          return { published: false, reason: "stale_writer" };
        }
        this.entries.set(key, snapshot);
        return { published: true };
      }
      remove(key) {
        this.entries.delete(key);
      }
      listKeys() {
        return [...this.entries.keys()];
      }
      tryLock(key) {
        if (this.locked.has(key)) return false;
        this.locked.add(key);
        return true;
      }
      unlock(key) {
        this.locked.delete(key);
      }
    };
    tmpSequence = 0;
    SAFE_KEY = /^[A-Za-z0-9._-]+$/;
    FileStore = class {
      constructor(rootDir, opts = {}) {
        this.rootDir = rootDir;
        this.lockStealAgeMs = opts.lockStealAgeMs ?? 3e4;
        this.now = opts.now ?? Date.now;
        fs19.mkdirSync(rootDir, { recursive: true });
      }
      rootDir;
      kind = "file";
      lockStealAgeMs;
      now;
      /** Keys whose cross-process lock THIS instance currently holds. */
      held = /* @__PURE__ */ new Set();
      entryPath(key) {
        if (!SAFE_KEY.test(key)) throw new Error(`catalog-cache: unsafe cache key ${JSON.stringify(key)}`);
        return path24.join(this.rootDir, `${key}.json`);
      }
      lockPath(key) {
        return `${this.entryPath(key)}.lock`;
      }
      tryLock(key) {
        if (this.held.has(key)) return false;
        const lock = this.lockPath(key);
        try {
          fs19.mkdirSync(lock);
          this.held.add(key);
          return true;
        } catch {
          try {
            const age = this.now() - fs19.statSync(lock).mtimeMs;
            if (age > this.lockStealAgeMs) {
              fs19.rmdirSync(lock);
              fs19.mkdirSync(lock);
              this.held.add(key);
              return true;
            }
          } catch {
            try {
              fs19.mkdirSync(lock);
              this.held.add(key);
              return true;
            } catch {
              return false;
            }
          }
          return false;
        }
      }
      unlock(key) {
        if (!this.held.has(key)) return;
        this.held.delete(key);
        try {
          fs19.rmdirSync(this.lockPath(key));
        } catch {
        }
      }
      read(key) {
        try {
          const raw = fs19.readFileSync(this.entryPath(key), "utf8");
          const parsed = JSON.parse(raw);
          if (typeof parsed?.generation !== "number") return null;
          return parsed;
        } catch {
          return null;
        }
      }
      casPublish(key, snapshot) {
        if (typeof snapshot?.generation !== "number" || !Number.isFinite(snapshot.generation)) {
          return { published: false, reason: "invalid_snapshot" };
        }
        const alreadyHeld = this.held.has(key);
        if (!alreadyHeld && !this.tryLock(key)) return { published: false, reason: "lock_timeout" };
        try {
          const current = this.read(key);
          if (current && current.generation >= snapshot.generation) {
            return { published: false, reason: "stale_writer" };
          }
          tmpSequence += 1;
          const tmp = path24.join(this.rootDir, `.tmp-${process.pid}-${tmpSequence}-${key}`);
          fs19.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}
`, "utf8");
          fs19.renameSync(tmp, this.entryPath(key));
          return { published: true };
        } finally {
          if (!alreadyHeld) this.unlock(key);
        }
      }
      remove(key) {
        try {
          fs19.rmSync(this.entryPath(key), { force: true });
        } catch {
        }
      }
      listKeys() {
        try {
          return fs19.readdirSync(this.rootDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
        } catch {
          return [];
        }
      }
    };
    defaultSleep = (ms) => new Promise((resolve20) => setTimeout(resolve20, ms));
  }
});

// src/domains/config/compatibility-usage.ts
function isCanonicalRelPath(v) {
  if (v.length === 0 || v.length > MAX_SCALAR_LEN) return false;
  if (CONTROL_CHARS2.test(v)) return false;
  if (v.includes("\\")) return false;
  if (v.startsWith("/")) return false;
  if (v.includes("//")) return false;
  const segs = v.split("/");
  return segs.every((seg) => seg !== "" && seg !== "." && seg !== "..");
}
function isBoundedStr(v) {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_SCALAR_LEN && !CONTROL_CHARS2.test(v);
}
function isCanonicalId(v) {
  return isBoundedStr(v) && SLUG.test(v);
}
function readOptions(value, allowedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (import_util.types.isProxy(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const out = /* @__PURE__ */ Object.create(null);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowedKeys.includes(key)) return null;
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !("value" in desc)) return null;
    out[key] = desc.value;
  }
  return out;
}
function readArray(value) {
  if (!Array.isArray(value) || import_util.types.isProxy(value)) return null;
  const lenDesc = Object.getOwnPropertyDescriptor(value, "length");
  if (!lenDesc || !("value" in lenDesc) || !isCount(lenDesc.value)) return null;
  const out = [];
  for (let i = 0; i < lenDesc.value; i++) {
    const d = Object.getOwnPropertyDescriptor(value, i);
    if (!d || !("value" in d)) return null;
    out.push(d.value);
  }
  return out;
}
function isCount(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}
function isPlainDataObject(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  if (import_util.types.isProxy(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function ownDataProp(o, key) {
  const desc = Object.getOwnPropertyDescriptor(o, key);
  if (!desc) return { kind: "absent" };
  if (!("value" in desc)) return { kind: "accessor" };
  return { kind: "data", value: desc.value };
}
function ownValue(o, key) {
  const p = ownDataProp(o, key);
  return p.kind === "data" ? p.value : void 0;
}
function parseCompatibilityUsageV1(value) {
  try {
    if (!isPlainDataObject(value)) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    for (const key of Object.getOwnPropertyNames(value)) {
      if (!COMPATIBILITY_USAGE_KEYS.includes(key)) return null;
    }
    if (ownValue(value, "schema_version") !== COMPATIBILITY_USAGE_SCHEMA) return null;
    const assetKind = ownValue(value, "asset_kind");
    if (typeof assetKind !== "string" || !ASSET_KIND_SET.has(assetKind)) return null;
    const assetId = ownValue(value, "asset_id");
    if (!isCanonicalId(assetId)) return null;
    const assetPath = ownValue(value, "asset_path");
    if (!isBoundedStr(assetPath) || !isCanonicalRelPath(assetPath)) return null;
    const contentHash = ownValue(value, "content_hash");
    if (!isNonEmptyStr(contentHash) || !SHA256_HEX.test(contentHash)) return null;
    const reason = ownValue(value, "reason");
    if (typeof reason !== "string" || !READ_REASON_SET.has(reason)) return null;
    const resolverMode = ownValue(value, "resolver_mode");
    if (typeof resolverMode !== "string" || !RESOLVER_MODE_SET.has(resolverMode)) return null;
    const synthetic = ownValue(value, "synthetic");
    if (typeof synthetic !== "boolean") return null;
    const specialistIdRaw = ownValue(value, "specialist_id");
    let specialistId;
    if (specialistIdRaw === null) specialistId = null;
    else if (isCanonicalId(specialistIdRaw)) specialistId = specialistIdRaw;
    else return null;
    return Object.freeze({
      schema_version: COMPATIBILITY_USAGE_SCHEMA,
      asset_kind: assetKind,
      asset_id: assetId,
      asset_path: assetPath,
      content_hash: contentHash,
      reason,
      resolver_mode: resolverMode,
      synthetic,
      specialist_id: specialistId
    });
  } catch {
    return null;
  }
}
function isCompatibilityUsageV1(value) {
  return parseCompatibilityUsageV1(value) !== null;
}
function isDependenceRead(record) {
  if (record.synthetic) return false;
  return !BENIGN_REASON_SET.has(record.reason);
}
function unusableRollup(reason) {
  return Object.freeze({
    window_start_release: "",
    window_end_release: "",
    by_asset: Object.freeze({}),
    // NaN, deliberately: an unusable rollup must never read as "zero dependence".
    // evaluateG5 rejects a non-count and blocks, so this cannot become a false clean.
    total_dependence_reads: Number.NaN,
    observed_asset_ids: Object.freeze([]),
    removable: Object.freeze([]),
    unreadable: Number.NaN,
    unusable_reason: reason
  });
}
function rollupCompatibilityUsage(input) {
  const opts = readOptions(input, ROLLUP_INPUT_KEYS);
  if (opts === null) return unusableRollup("options object rejected (proxy/accessor/unknown key)");
  const startRelease = opts["window_start_release"];
  const endRelease = opts["window_end_release"];
  if (!isBoundedStr(startRelease) || !isBoundedStr(endRelease)) {
    return unusableRollup("window release identifiers must be bounded plain strings");
  }
  const unreadable = opts["unreadable"];
  if (!isCount(unreadable)) return unusableRollup("unreadable must be a non-negative safe integer");
  const knownIds = readArray(opts["known_asset_ids"]);
  if (knownIds === null) return unusableRollup("known_asset_ids must be a dense plain array");
  const seenKnown = /* @__PURE__ */ new Set();
  for (const id of knownIds) {
    if (!isCanonicalId(id)) return unusableRollup(`known_asset_ids entry is not a canonical id: ${String(id)}`);
    if (seenKnown.has(id)) return unusableRollup(`known_asset_ids contains duplicate id: ${id}`);
    seenKnown.add(id);
  }
  const records = readArray(opts["records"]);
  if (records === null) return unusableRollup("records must be a dense plain array");
  const byAsset = {};
  for (const id of seenKnown) byAsset[id] = 0;
  const observed = /* @__PURE__ */ new Set();
  let total = 0;
  for (const raw of records) {
    const record = parseCompatibilityUsageV1(raw);
    if (record === null) return unusableRollup("records contains an entry that is not a valid guild.compatibility_usage.v1");
    observed.add(record.asset_id);
    if (!isDependenceRead(record)) continue;
    byAsset[record.asset_id] = (byAsset[record.asset_id] ?? 0) + 1;
    total += 1;
  }
  const removable = [...seenKnown].filter((id) => (byAsset[id] ?? 0) === 0).sort();
  return Object.freeze({
    window_start_release: startRelease,
    window_end_release: endRelease,
    by_asset: Object.freeze(byAsset),
    total_dependence_reads: total,
    observed_asset_ids: Object.freeze([...observed].sort()),
    removable: Object.freeze(removable),
    unreadable
  });
}
function evaluateG5(input) {
  const blockers = [];
  const blocked = (reason) => Object.freeze({ passed: false, blockers: Object.freeze([reason]), removable: Object.freeze([]) });
  const opts = readOptions(input, G5_INPUT_KEYS);
  if (opts === null) return blocked("G5 input rejected (proxy/accessor/unknown key)");
  const requiredRaw = readArray(opts["required_asset_ids"]);
  if (requiredRaw === null) return blocked("required_asset_ids must be a dense plain array");
  const required = [];
  const seenRequired = /* @__PURE__ */ new Set();
  for (const id of requiredRaw) {
    if (!isCanonicalId(id)) return blocked(`required_asset_ids entry is not a canonical id: ${String(id)}`);
    if (seenRequired.has(id)) return blocked(`required_asset_ids contains duplicate id: ${id}`);
    seenRequired.add(id);
    required.push(id);
  }
  if (required.length === 0) {
    blockers.push("empty required_asset_ids \u2014 a removal gate over zero assets cannot pass");
  }
  const rollupsRaw = readArray(opts["rollups"]);
  if (rollupsRaw === null) return blocked("rollups must be a dense plain array");
  const snapshots = [];
  for (const raw of rollupsRaw) {
    const r = readOptions(raw, ROLLUP_KEYS);
    if (r === null) return blocked("a rollup was rejected (proxy/accessor/unknown key)");
    const start = r["window_start_release"];
    const end = r["window_end_release"];
    if (typeof start !== "string" || typeof end !== "string") {
      return blocked("a rollup carries a non-string release identifier");
    }
    const byAssetRaw = r["by_asset"];
    const byAsset = readOptionsAsCounts(byAssetRaw);
    snapshots.push({
      label: `${start}..${end}`,
      unreadable: r["unreadable"],
      total: r["total_dependence_reads"],
      byAsset,
      observed: readArray(r["observed_asset_ids"]),
      unusable: r["unusable_reason"]
    });
  }
  if (snapshots.length < G5_MIN_CLEAN_RELEASES) {
    blockers.push(
      `insufficient window: ${snapshots.length} release(s) of evidence, need >= ${G5_MIN_CLEAN_RELEASES}`
    );
  }
  const labels = snapshots.map((s) => s.label);
  if (new Set(labels).size !== labels.length) {
    blockers.push("duplicate release windows \u2014 the same evidence submitted twice is one release, not two");
  }
  for (const snap of snapshots) {
    if (typeof snap.unusable === "string") {
      blockers.push(`release ${snap.label}: rollup is unusable \u2014 ${snap.unusable}`);
    }
    if (!isCount(snap.unreadable)) {
      blockers.push(`release ${snap.label}: unreadable is not a valid count (${String(snap.unreadable)})`);
    } else if (snap.unreadable > 0) {
      blockers.push(
        `release ${snap.label}: ${snap.unreadable} unreadable record(s) \u2014 a partially-readable journal is not evidence of zero usage`
      );
    }
    if (snap.byAsset === null) {
      blockers.push(`release ${snap.label}: by_asset is not a plain own-data object`);
    } else {
      let derived = 0;
      for (const [assetId, count] of Object.entries(snap.byAsset)) {
        if (!isCount(count)) {
          blockers.push(`release ${snap.label}: by_asset[${assetId}] is not a valid count (${String(count)})`);
          continue;
        }
        derived += count;
      }
      if (!isCount(snap.total)) {
        blockers.push(
          `release ${snap.label}: total_dependence_reads is not a valid count (${String(snap.total)})`
        );
      } else if (snap.total !== derived) {
        blockers.push(
          `release ${snap.label}: total_dependence_reads ${snap.total} disagrees with by_asset sum ${derived}`
        );
      }
      if (derived > 0) blockers.push(`release ${snap.label}: ${derived} dependence read(s)`);
    }
    if (snap.observed === null) {
      blockers.push(`release ${snap.label}: observed_asset_ids is not a dense plain array`);
    }
  }
  const observed = /* @__PURE__ */ new Set();
  for (const snap of snapshots) {
    for (const id of snap.observed ?? []) if (typeof id === "string") observed.add(id);
  }
  const uninstrumented = required.filter((id) => !observed.has(id)).sort();
  if (uninstrumented.length > 0) {
    blockers.push(
      `${uninstrumented.length} required asset(s) never instrumented (a false zero): ${uninstrumented.join(", ")}`
    );
  }
  const passed = blockers.length === 0;
  const removable = passed ? [...required].sort() : [];
  return Object.freeze({
    passed,
    blockers: Object.freeze(blockers),
    removable: Object.freeze(removable)
  });
}
function readOptionsAsCounts(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (import_util.types.isProxy(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const out = /* @__PURE__ */ Object.create(null);
  for (const key of Object.getOwnPropertyNames(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !("value" in desc)) return null;
    out[key] = desc.value;
  }
  return out;
}
var import_util, COMPATIBILITY_USAGE_SCHEMA, COMPATIBILITY_USAGE_EVENT_NAME, COMPATIBILITY_USAGE_OUTCOME_TYPE, COMPATIBILITY_USAGE_DISPOSITION, COMPATIBILITY_ASSET_KINDS, COMPATIBILITY_READ_REASONS, BENIGN_COMPATIBILITY_READ_REASONS, DEPENDENCE_COMPATIBILITY_READ_REASONS, BENIGN_REASON_SET, READ_REASON_SET, ASSET_KIND_SET, RESOLVER_MODE_SET, SHA256_HEX, MAX_SCALAR_LEN, CONTROL_CHARS2, SLUG, isNonEmptyStr, COMPATIBILITY_USAGE_KEYS, ROLLUP_INPUT_KEYS, G5_MIN_CLEAN_RELEASES, G5_INPUT_KEYS, ROLLUP_KEYS;
var init_compatibility_usage = __esm({
  "src/domains/config/compatibility-usage.ts"() {
    import_util = require("util");
    init_config_defaults();
    COMPATIBILITY_USAGE_SCHEMA = "guild.compatibility_usage.v1";
    COMPATIBILITY_USAGE_EVENT_NAME = "task.dispatch";
    COMPATIBILITY_USAGE_OUTCOME_TYPE = "guild.capability_outcome.v1";
    COMPATIBILITY_USAGE_DISPOSITION = "degraded";
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
    SHA256_HEX = /^[0-9a-f]{64}$/;
    MAX_SCALAR_LEN = 512;
    CONTROL_CHARS2 = /[\u0000-\u001f\u007f]/;
    SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
    isNonEmptyStr = (v) => typeof v === "string" && v.length > 0;
    COMPATIBILITY_USAGE_KEYS = [
      "schema_version",
      "asset_kind",
      "asset_id",
      "asset_path",
      "content_hash",
      "reason",
      "resolver_mode",
      "synthetic",
      "specialist_id"
    ];
    ROLLUP_INPUT_KEYS = [
      "window_start_release",
      "window_end_release",
      "records",
      "known_asset_ids",
      "unreadable"
    ];
    G5_MIN_CLEAN_RELEASES = 2;
    G5_INPUT_KEYS = ["rollups", "required_asset_ids"];
    ROLLUP_KEYS = [
      "window_start_release",
      "window_end_release",
      "by_asset",
      "total_dependence_reads",
      "observed_asset_ids",
      "removable",
      "unreadable",
      "unusable_reason"
    ];
  }
});

// src/domains/config/resolver-mode.ts
function describe2(v) {
  try {
    if (typeof v === "bigint") return `${v}n`;
    if (typeof v === "string") return v.length > 120 ? `"${v.slice(0, 117)}..."` : `"${v}"`;
    if (typeof v === "symbol") return "Symbol()";
    if (typeof v === "function") return "[function]";
    if (v === null) return "null";
    if (typeof v === "object") return Array.isArray(v) ? "[array]" : "[object]";
    return String(v);
  } catch {
    return "[unprintable]";
  }
}
function isCanonicalId2(v) {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LEN && !CONTROL_CHARS3.test(v) && CANONICAL_ID.test(v);
}
function isCanonicalRelPath2(v) {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_SCALAR_LEN2) return false;
  if (CONTROL_CHARS3.test(v)) return false;
  if (v.includes("\\")) return false;
  if (/^[A-Za-z]:/.test(v)) return false;
  if (v.startsWith("/")) return false;
  if (v.endsWith("/")) return false;
  for (const seg of v.split("/")) {
    if (seg.length === 0) return false;
    if (seg === "." || seg === "..") return false;
    if (/[. ]$/.test(seg)) return false;
  }
  return true;
}
function readOptions2(value, allowedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (import_util2.types.isProxy(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const out = /* @__PURE__ */ Object.create(null);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowedKeys.includes(key)) return null;
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !("value" in desc)) return null;
    out[key] = desc.value;
  }
  return out;
}
function resolverModePolicy(mode) {
  if (typeof mode !== "string") return null;
  return MODE_POLICIES.get(mode) ?? null;
}
function resolverModeRank(mode) {
  if (typeof mode !== "string") return -1;
  return MODE_RANK.get(mode) ?? -1;
}
function isResolverModeFailure(v) {
  return typeof v === "string" && RESOLVER_MODE_FAILURE_SET.has(v);
}
function isCompatibilityReadReason(value) {
  return COMPATIBILITY_READ_REASONS.indexOf(value) !== -1;
}
function classifyCompatibilityRead(request) {
  const opts = readOptions2(request, ["mode", "intent"]);
  if (opts === null) {
    return {
      status: "refused",
      failure: "invalid_request",
      detail: "classification request rejected (proxy/accessor/symbol/unknown key)"
    };
  }
  const policy = resolverModePolicy(opts["mode"]);
  if (policy === null) {
    return {
      status: "refused",
      failure: "unknown_mode",
      detail: `not a resolver mode: ${describe2(opts["mode"])}`
    };
  }
  const intent = opts["intent"];
  if (typeof intent !== "string" || !CAPABILITY_RESOLUTION_INTENTS.includes(intent)) {
    return {
      status: "refused",
      failure: "invalid_request",
      detail: `not a resolution intent: ${describe2(intent)}`
    };
  }
  const typedIntent = intent;
  if (!policy.compatibility_available) {
    return {
      status: "refused",
      failure: "compatibility_unavailable_in_mode",
      detail: `mode ${policy.mode} has no compatibility surface`
    };
  }
  if (!policy.compatibility_intents.includes(typedIntent)) {
    return {
      status: "refused",
      failure: "intent_not_permitted_in_mode",
      detail: `mode ${policy.mode} does not permit a compatibility read for intent ${typedIntent}`
    };
  }
  if (typedIntent === "mint" && !policy.capability_writes_permitted) {
    return {
      status: "refused",
      failure: "write_not_permitted_in_mode",
      detail: `mode ${policy.mode} does not permit capability writes, so a "mint" read cannot occur`
    };
  }
  let reason = INTENT_REASON.get(typedIntent);
  if (reason === void 0) {
    reason = policy.authority === "legacy" ? "explicit_legacy_mode" : "no_project_definition";
  }
  if (!isCompatibilityReadReason(reason)) {
    return {
      status: "refused",
      failure: "invalid_request",
      detail: `classified reason ${describe2(reason)} is not a guild.compatibility_usage.v1 reason`
    };
  }
  return Object.freeze({
    status: "classified",
    reason,
    counts_as_dependence: !BENIGN_REASONS.has(reason)
  });
}
function unresolved(failure, detail, ctx) {
  return Object.freeze({
    schema_version: RESOLVER_MODE_OUTCOME_SCHEMA,
    status: "unresolved",
    mode: ctx?.mode ?? null,
    kind: ctx?.kind ?? null,
    capability_id: ctx?.capability_id ?? null,
    failure,
    detail
  });
}
function resolveCapability(request) {
  const opts = readOptions2(request, RESOLUTION_REQUEST_KEYS);
  if (opts === null) {
    return unresolved(
      "invalid_request",
      "resolution request rejected (proxy/accessor/symbol/unknown key)"
    );
  }
  const policy = resolverModePolicy(opts["mode"]);
  if (policy === null) {
    return unresolved("unknown_mode", `not a resolver mode: ${describe2(opts["mode"])}`);
  }
  const mode = policy.mode;
  const kindRaw = opts["kind"];
  if (kindRaw !== "agent" && kindRaw !== "skill") {
    return unresolved("invalid_request", `kind must be "agent" or "skill"`, { mode });
  }
  const kind = kindRaw;
  const capabilityId = opts["capability_id"];
  if (!isCanonicalId2(capabilityId)) {
    return unresolved(
      "invalid_request",
      `capability_id is not a canonical id: ${describe2(capabilityId)}`,
      { mode, kind }
    );
  }
  const intentRaw = opts["intent"];
  if (typeof intentRaw !== "string" || !CAPABILITY_RESOLUTION_INTENTS.includes(intentRaw)) {
    return unresolved("invalid_request", `not a resolution intent: ${describe2(intentRaw)}`, {
      mode,
      kind,
      capability_id: capabilityId
    });
  }
  const intent = intentRaw;
  const projectDefRaw = opts["project_definition"];
  let projectDef;
  if (projectDefRaw === null) projectDef = null;
  else if (isCanonicalRelPath2(projectDefRaw)) projectDef = projectDefRaw;
  else {
    return unresolved(
      "invalid_request",
      `project_definition is not a canonical relative path: ${describe2(projectDefRaw)}`,
      { mode, kind, capability_id: capabilityId }
    );
  }
  const compatRaw = opts["compatibility_asset"];
  let compatAsset;
  if (compatRaw === null) compatAsset = null;
  else if (isCanonicalRelPath2(compatRaw)) compatAsset = compatRaw;
  else {
    return unresolved(
      "invalid_request",
      `compatibility_asset is not a canonical relative path: ${describe2(compatRaw)}`,
      { mode, kind, capability_id: capabilityId }
    );
  }
  const ctx = { mode, kind, capability_id: capabilityId };
  if (intent === "mint" && !policy.capability_writes_permitted) {
    return unresolved(
      "write_not_permitted_in_mode",
      `mode ${mode} does not permit capability writes, so intent "mint" cannot be served`,
      ctx
    );
  }
  if (policy.project_resolver_runs && projectDef !== null && intent !== "shadow_compare") {
    return Object.freeze({
      schema_version: RESOLVER_MODE_OUTCOME_SCHEMA,
      status: "resolved",
      mode,
      kind,
      capability_id: capabilityId,
      source: "project",
      path: projectDef,
      authority: policy.authority,
      // In shadow, the project side may not originate a side effect even when it
      // has the better answer. That is the phase's whole safety property.
      side_effects_permitted: policy.project_side_effects_permitted,
      compatibility_read: null
    });
  }
  if (compatAsset === null) {
    return unresolved(
      projectDef === null ? "no_definition_anywhere" : "no_project_definition",
      projectDef === null ? `no project definition and no compatibility asset for ${kind} "${capabilityId}"` : `mode ${mode} did not consult the project definition for intent "${intent}", and no compatibility asset was supplied`,
      ctx
    );
  }
  const classification = classifyCompatibilityRead({ mode, intent });
  if (classification.status === "refused") {
    return unresolved(classification.failure, classification.detail, ctx);
  }
  return Object.freeze({
    schema_version: RESOLVER_MODE_OUTCOME_SCHEMA,
    status: "resolved",
    mode,
    kind,
    capability_id: capabilityId,
    source: "compatibility",
    path: compatAsset,
    authority: policy.authority,
    // CODEX #11: derived from authority ALONE, this returned `true` for a
    // `shadow_compare` read — a comparison-only answer a caller could act on,
    // which is exactly the side effect shadow mode exists to withhold. A
    // comparison never authorizes action, in any mode.
    side_effects_permitted: intent !== "shadow_compare" && policy.authority === "legacy",
    compatibility_read: Object.freeze({
      reason: classification.reason,
      counts_as_dependence: classification.counts_as_dependence
    })
  });
}
function rejectedTransition(failure, detail, from, to) {
  return Object.freeze({
    schema_version: RESOLVER_MODE_OUTCOME_SCHEMA,
    status: "rejected",
    from,
    to,
    failure,
    detail
  });
}
function planModeTransition(request) {
  const opts = readOptions2(request, TRANSITION_KEYS);
  if (opts === null) {
    return rejectedTransition(
      "invalid_request",
      "transition request rejected (proxy/accessor/symbol/unknown key)",
      null,
      null
    );
  }
  const fromPolicy = resolverModePolicy(opts["from"]);
  if (fromPolicy === null) {
    return rejectedTransition(
      "unknown_mode",
      `"from" is not a resolver mode: ${describe2(opts["from"])}`,
      null,
      null
    );
  }
  const toPolicy = resolverModePolicy(opts["to"]);
  if (toPolicy === null) {
    return rejectedTransition(
      "unknown_mode",
      `"to" is not a resolver mode: ${describe2(opts["to"])}`,
      fromPolicy.mode,
      null
    );
  }
  const from = fromPolicy.mode;
  const to = toPolicy.mode;
  const reasonRaw = opts["reason"];
  if (typeof reasonRaw !== "string" || reasonRaw.length === 0 || reasonRaw.length > MAX_SCALAR_LEN2 || CONTROL_CHARS3.test(reasonRaw)) {
    return rejectedTransition(
      "invalid_request",
      "reason must be a non-empty, control-character-free string within bounds",
      from,
      to
    );
  }
  const reason = reasonRaw;
  const allowSkipRaw = opts["allow_skip"];
  if (allowSkipRaw !== void 0 && typeof allowSkipRaw !== "boolean") {
    return rejectedTransition("invalid_request", "allow_skip must be a boolean", from, to);
  }
  const allowSkip = allowSkipRaw === true;
  const fromRank = resolverModeRank(from);
  const toRank = resolverModeRank(to);
  if (fromRank === toRank) {
    return rejectedTransition(
      "transition_is_noop",
      `already in mode ${from} \u2014 a no-op change must not be recorded as a migration step`,
      from,
      to
    );
  }
  const direction = toRank > fromRank ? "advance" : "regress";
  const rungs = Math.abs(toRank - fromRank);
  if (direction === "advance" && rungs > 1 && !allowSkip) {
    return rejectedTransition(
      "transition_skips_rungs",
      `${from} \u2192 ${to} skips ${rungs - 1} rung(s); pass allow_skip: true to acknowledge that the skipped phase's evidence will not exist`,
      from,
      to
    );
  }
  return Object.freeze({
    schema_version: RESOLVER_MODE_OUTCOME_SCHEMA,
    status: "allowed",
    from,
    to,
    direction,
    rungs,
    reason
  });
}
var import_util2, RESOLVER_MODE_OUTCOME_SCHEMA, MAX_SCALAR_LEN2, CONTROL_CHARS3, CANONICAL_ID, MAX_ID_LEN, RESOLVER_AUTHORITIES, CAPABILITY_RESOLUTION_INTENTS, MODE_POLICIES, RESOLVER_MODE_POLICIES, MODE_RANK, RESOLVER_MODE_FAILURES, RESOLVER_MODE_FAILURE_SET, INTENT_REASON, BENIGN_REASONS, RESOLUTION_REQUEST_KEYS, MODE_TRANSITION_DIRECTIONS, TRANSITION_KEYS;
var init_resolver_mode = __esm({
  "src/domains/config/resolver-mode.ts"() {
    import_util2 = require("util");
    init_compatibility_usage();
    RESOLVER_MODE_OUTCOME_SCHEMA = "guild.resolver_mode_outcome.v1";
    MAX_SCALAR_LEN2 = 1024;
    CONTROL_CHARS3 = /[\u0000-\u001f\u007f]/;
    CANONICAL_ID = /^[a-z0-9][a-z0-9._-]*$/;
    MAX_ID_LEN = 128;
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
    INTENT_REASON = /* @__PURE__ */ new Map([
      ["mint", "mint_source"],
      ["shadow_compare", "shadow_comparison"],
      ["rollback", "rollback"],
      ["replay", "explicit_legacy_mode"]
    ]);
    BENIGN_REASONS = /* @__PURE__ */ new Set([
      "mint_source",
      "shadow_comparison"
    ]);
    RESOLUTION_REQUEST_KEYS = [
      "mode",
      "kind",
      "capability_id",
      "project_definition",
      "compatibility_asset",
      "intent"
    ];
    MODE_TRANSITION_DIRECTIONS = Object.freeze(["advance", "regress"]);
    TRANSITION_KEYS = ["from", "to", "reason", "allow_skip"];
  }
});

// src/domains/config/compatibility-catalog.ts
function isCanonicalId3(v) {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LEN2 && !CONTROL_CHARS4.test(v) && CANONICAL_ID2.test(v);
}
function readOptions3(value, allowedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (import_util3.types.isProxy(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const out = /* @__PURE__ */ Object.create(null);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowedKeys.includes(key)) return null;
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !("value" in desc)) return null;
    out[key] = desc.value;
  }
  return out;
}
function readArray2(value) {
  if (!Array.isArray(value) || import_util3.types.isProxy(value)) return null;
  const lenDesc = Object.getOwnPropertyDescriptor(value, "length");
  if (!lenDesc || !("value" in lenDesc) || typeof lenDesc.value !== "number" || !Number.isSafeInteger(lenDesc.value) || lenDesc.value < 0) {
    return null;
  }
  const out = [];
  for (let i = 0; i < lenDesc.value; i++) {
    const d = Object.getOwnPropertyDescriptor(value, i);
    if (!d || !("value" in d)) return null;
    out.push(d.value);
  }
  return out;
}
function toCanonicalRelPath(absPath, root) {
  const rel2 = path25.relative(root, absPath);
  if (rel2.length === 0 || rel2.startsWith("..") || path25.isAbsolute(rel2)) return null;
  const posix = rel2.split(path25.sep).join("/");
  if (posix.length > MAX_SCALAR_LEN3 || CONTROL_CHARS4.test(posix)) return null;
  for (const seg of posix.split("/")) {
    if (seg.length === 0 || seg === "." || seg === "..") return null;
  }
  return posix;
}
function describe3(v) {
  try {
    if (typeof v === "bigint") return `${v}n`;
    if (typeof v === "string") return v.length > 120 ? `"${v.slice(0, 117)}..."` : `"${v}"`;
    if (typeof v === "symbol") return "Symbol()";
    if (typeof v === "function") return "[function]";
    if (v === null) return "null";
    if (typeof v === "object") return Array.isArray(v) ? "[array]" : "[object]";
    return String(v);
  } catch {
    return "[unprintable]";
  }
}
function emptyCatalog(problem) {
  return Object.freeze({
    schema_version: COMPATIBILITY_CATALOG_SCHEMA,
    entries: Object.freeze([]),
    template_count: 0,
    domain_skill_count: 0,
    census_matches: false,
    problems: Object.freeze([problem])
  });
}
function buildCompatibilityCatalog(opts) {
  const o = readOptions3(opts, BUILD_KEYS);
  if (o === null) {
    return emptyCatalog("options object rejected (proxy/accessor/symbol/unknown key)");
  }
  const pluginRoot = o["pluginRoot"];
  if (typeof pluginRoot !== "string" || pluginRoot.length === 0 || CONTROL_CHARS4.test(pluginRoot)) {
    return emptyCatalog("pluginRoot must be a non-empty, control-character-free path");
  }
  const deprecationRaw = o["deprecation"] ?? "active";
  if (typeof deprecationRaw !== "string" || !DEPRECATION_STATE_SET.has(deprecationRaw)) {
    return emptyCatalog(`not a deprecation state: ${describe3(deprecationRaw)}`);
  }
  const deprecation = deprecationRaw;
  const deprecatedByRaw = o["deprecatedBy"] ?? null;
  if (deprecatedByRaw !== null && (typeof deprecatedByRaw !== "string" || deprecatedByRaw.length === 0 || deprecatedByRaw.length > MAX_ID_LEN2 || CONTROL_CHARS4.test(deprecatedByRaw))) {
    return emptyCatalog("deprecatedBy must be null or a bounded, control-character-free token");
  }
  if (deprecation !== "active" && deprecatedByRaw === null) {
    return emptyCatalog(`deprecation "${deprecation}" requires a deprecatedBy decision record`);
  }
  const deprecatedBy = deprecatedByRaw;
  const root = path25.resolve(pluginRoot);
  const problems = [];
  const entries = [];
  const push = (kind, id, abs) => {
    const rel2 = toCanonicalRelPath(abs, root);
    if (rel2 === null) {
      problems.push(`${kind} "${id}": path is not canonical plugin-relative (${abs})`);
      return;
    }
    let bytes;
    try {
      const st = fs20.lstatSync(abs);
      if (st.isSymbolicLink()) {
        problems.push(`${kind} "${id}": symlink, refusing to catalog`);
        return;
      }
      if (!st.isFile()) {
        problems.push(`${kind} "${id}": not a regular file`);
        return;
      }
      bytes = fs20.readFileSync(abs);
    } catch (err) {
      problems.push(`${kind} "${id}": unreadable (${err.message})`);
      return;
    }
    entries.push(
      Object.freeze({
        kind,
        id,
        path: rel2,
        content_hash: crypto8.createHash("sha256").update(bytes).digest("hex"),
        deprecation,
        deprecated_by: deprecatedBy
      })
    );
  };
  const templateDir = path25.join(root, COMPATIBILITY_ASSET_ROOTS.shipped_template);
  try {
    for (const e of fs20.readdirSync(templateDir, { withFileTypes: true }).sort(
      (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const id = e.name.slice(0, -3);
      if (!isCanonicalId3(id)) {
        problems.push(`shipped_template "${e.name}": file stem is not a canonical id`);
        continue;
      }
      push("shipped_template", id, path25.join(templateDir, e.name));
    }
  } catch (err) {
    problems.push(`templates/specialists unreadable (${err.message})`);
  }
  const skillDir = path25.join(root, COMPATIBILITY_ASSET_ROOTS.shipped_domain_skill);
  try {
    for (const e of fs20.readdirSync(skillDir, { withFileTypes: true }).sort(
      (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )) {
      if (!e.isDirectory()) continue;
      if (!isCanonicalId3(e.name)) {
        problems.push(`shipped_domain_skill "${e.name}": directory name is not a canonical id`);
        continue;
      }
      push("shipped_domain_skill", e.name, path25.join(skillDir, e.name, "SKILL.md"));
    }
  } catch (err) {
    problems.push(`skills/specialists unreadable (${err.message})`);
  }
  entries.sort(
    (a, b) => a.kind !== b.kind ? a.kind < b.kind ? -1 : 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
  const templateCount = entries.filter((e) => e.kind === "shipped_template").length;
  const skillIds = entries.filter((e) => e.kind === "shipped_domain_skill").map((e) => e.id);
  const skillCount = skillIds.length;
  const frozenSkillIds = new Set(SHIPPED_DOMAIN_SKILL_IDS);
  const missingSkillIds = SHIPPED_DOMAIN_SKILL_IDS.filter((id) => !skillIds.includes(id));
  const unexpectedSkillIds = skillIds.filter((id) => !frozenSkillIds.has(id));
  if (missingSkillIds.length > 0) {
    problems.push(`shipped_domain_skill census missing frozen id(s): ${missingSkillIds.join(", ")}`);
  }
  if (unexpectedSkillIds.length > 0) {
    problems.push(`shipped_domain_skill census has unexpected id(s): ${unexpectedSkillIds.join(", ")}`);
  }
  return Object.freeze({
    schema_version: COMPATIBILITY_CATALOG_SCHEMA,
    entries: Object.freeze(entries),
    template_count: templateCount,
    domain_skill_count: skillCount,
    census_matches: problems.length === 0 && templateCount === SHIPPED_TEMPLATE_COUNT && skillCount === SHIPPED_DOMAIN_SKILL_COUNT,
    problems: Object.freeze(problems)
  });
}
function readCatalogEntry(raw) {
  const e = readOptions3(raw, ENTRY_KEYS);
  if (e === null) return null;
  const kind = e["kind"];
  if (kind !== "shipped_template" && kind !== "shipped_domain_skill") return null;
  const id = e["id"];
  if (!isCanonicalId3(id)) return null;
  const p = e["path"];
  if (typeof p !== "string" || !isCanonicalCatalogPath(p)) return null;
  const hash = e["content_hash"];
  if (typeof hash !== "string" || !SHA256_HEX2.test(hash)) return null;
  const dep = e["deprecation"];
  if (typeof dep !== "string" || !DEPRECATION_STATE_SET.has(dep)) return null;
  const by = e["deprecated_by"];
  if (by !== null && (typeof by !== "string" || by.length === 0 || by.length > MAX_ID_LEN2 || CONTROL_CHARS4.test(by))) {
    return null;
  }
  if (dep !== "active" && by === null) return null;
  return Object.freeze({
    kind,
    id,
    path: p,
    content_hash: hash,
    deprecation: dep,
    deprecated_by: by
  });
}
function isCanonicalCatalogPath(v) {
  if (v.length === 0 || v.length > MAX_SCALAR_LEN3) return false;
  if (CONTROL_CHARS4.test(v)) return false;
  if (v.includes("\\")) return false;
  if (/^[A-Za-z]:/.test(v)) return false;
  if (v.startsWith("/")) return false;
  if (v.endsWith("/")) return false;
  for (const seg of v.split("/")) {
    if (seg.length === 0) return false;
    if (seg === "." || seg === "..") return false;
    if (/[. ]$/.test(seg)) return false;
  }
  return true;
}
function suggestableAssets(request) {
  const o = readOptions3(request, SUGGESTABLE_KEYS);
  if (o === null) {
    return {
      status: "refused",
      failure: "invalid_request",
      detail: "request rejected (proxy/accessor/symbol/unknown key)"
    };
  }
  const migrated = o["project_migrated"];
  if (typeof migrated !== "boolean") {
    return {
      status: "refused",
      failure: "invalid_request",
      // Not defaulted to `false`: a missing flag reading as "not migrated" would
      // silently re-open the menu on exactly the projects the rule protects.
      detail: "project_migrated must be an explicit boolean"
    };
  }
  const catalog = o["catalog"];
  const catalogOpts = readOptions3(catalog, [
    "schema_version",
    "entries",
    "template_count",
    "domain_skill_count",
    "census_matches",
    "problems"
  ]);
  if (catalogOpts === null || catalogOpts["schema_version"] !== COMPATIBILITY_CATALOG_SCHEMA) {
    return { status: "refused", failure: "invalid_request", detail: "catalog is not a guild.compatibility_catalog.v1" };
  }
  const rawEntries = readArray2(catalogOpts["entries"]);
  if (rawEntries === null) {
    return { status: "refused", failure: "invalid_request", detail: "catalog.entries is not a dense plain array" };
  }
  if (migrated) return { status: "ok", entries: Object.freeze([]) };
  const out = [];
  for (const raw of rawEntries) {
    const entry = readCatalogEntry(raw);
    if (entry === null) {
      return {
        status: "refused",
        failure: "invalid_request",
        detail: "catalog contains an entry that is not a well-formed guild.compatibility_catalog.v1 entry"
      };
    }
    if (entry.deprecation !== "active") continue;
    out.push(entry);
  }
  return { status: "ok", entries: Object.freeze(out) };
}
function compatibilityUsageForRead(request) {
  const o = readOptions3(request, EMISSION_KEYS);
  if (o === null) {
    return {
      status: "refused",
      failure: "invalid_request",
      detail: "emission request rejected (proxy/accessor/symbol/unknown key)"
    };
  }
  const entry = readCatalogEntry(o["entry"]);
  if (entry === null) {
    return {
      status: "refused",
      failure: "invalid_request",
      detail: "entry is not a well-formed guild.compatibility_catalog.v1 entry"
    };
  }
  const synthetic = o["synthetic"];
  if (typeof synthetic !== "boolean") {
    return {
      status: "refused",
      failure: "invalid_request",
      // Never defaulted: "missing" reading as "not synthetic" would pull tooling
      // reads into the dependence count and make the gate unreachable.
      detail: "synthetic must be an explicit boolean set at the emission point"
    };
  }
  const specialistIdRaw = o["specialist_id"] ?? null;
  if (specialistIdRaw !== null && !isCanonicalId3(specialistIdRaw)) {
    return { status: "refused", failure: "invalid_request", detail: "specialist_id must be null or a canonical id" };
  }
  const classification = classifyCompatibilityRead({
    mode: o["mode"],
    intent: o["intent"]
  });
  if (classification.status === "refused") {
    return { status: "refused", failure: classification.failure, detail: classification.detail };
  }
  const candidate = {
    schema_version: COMPATIBILITY_USAGE_SCHEMA,
    asset_kind: entry.kind,
    asset_id: entry.id,
    asset_path: entry.path,
    content_hash: entry.content_hash,
    reason: classification.reason,
    resolver_mode: o["mode"],
    synthetic,
    specialist_id: specialistIdRaw
  };
  const payload = parseCompatibilityUsageV1(candidate);
  if (payload === null) {
    return {
      status: "refused",
      failure: "invalid_request",
      detail: "constructed payload failed guild.compatibility_usage.v1 validation (check entry id/path/content_hash)"
    };
  }
  return { status: "ok", payload };
}
function requiredAssetIdsForG5(catalog, opts) {
  const o = readOptions3(opts, ["pluginRoot"]);
  if (o === null) {
    return { status: "refused", detail: "options rejected (proxy/accessor/symbol/unknown key)" };
  }
  const pluginRoot = o["pluginRoot"];
  if (typeof pluginRoot !== "string" || pluginRoot.length === 0 || CONTROL_CHARS4.test(pluginRoot)) {
    return {
      status: "refused",
      detail: "pluginRoot is required \u2014 a G5 required set must be verified against the real shipped tree"
    };
  }
  const c = readOptions3(catalog, [
    "schema_version",
    "entries",
    "template_count",
    "domain_skill_count",
    "census_matches",
    "problems"
  ]);
  if (c === null || c["schema_version"] !== COMPATIBILITY_CATALOG_SCHEMA) {
    return { status: "refused", detail: "not a guild.compatibility_catalog.v1" };
  }
  const raw = readArray2(c["entries"]);
  if (raw === null) return { status: "refused", detail: "entries is not a dense plain array" };
  const ids = [];
  const seen = /* @__PURE__ */ new Set();
  const byId = /* @__PURE__ */ new Map();
  let templates = 0;
  let skills = 0;
  for (const item of raw) {
    const e = readCatalogEntry(item);
    if (e === null) {
      return {
        status: "refused",
        detail: "catalog contains an entry that is not a well-formed catalog entry"
      };
    }
    if (seen.has(e.id)) {
      return { status: "refused", detail: `catalog contains a duplicate asset id: ${e.id}` };
    }
    seen.add(e.id);
    byId.set(e.id, e);
    ids.push(e.id);
    if (e.kind === "shipped_template") templates += 1;
    else skills += 1;
  }
  if (templates !== SHIPPED_TEMPLATE_COUNT || skills !== SHIPPED_DOMAIN_SKILL_COUNT) {
    return {
      status: "refused",
      detail: `catalog holds ${templates} template(s) and ${skills} domain skill(s); the shipped surface is ${SHIPPED_TEMPLATE_COUNT} and ${SHIPPED_DOMAIN_SKILL_COUNT} \u2014 refusing to derive a G5 required set from an incomplete enumeration`
    };
  }
  if (c["template_count"] !== templates || c["domain_skill_count"] !== skills) {
    return { status: "refused", detail: "catalog declares counts that disagree with its own entries" };
  }
  const problems = readArray2(c["problems"]);
  if (problems === null) return { status: "refused", detail: "problems is not a dense plain array" };
  if (problems.length > 0) {
    return {
      status: "refused",
      detail: `catalog reported ${problems.length} problem(s); an incomplete scan is not an accountability set`
    };
  }
  if (c["census_matches"] !== true) {
    return { status: "refused", detail: "catalog does not claim a matching census" };
  }
  const truth = buildCompatibilityCatalog({ pluginRoot });
  if (!truth.census_matches) {
    return {
      status: "refused",
      detail: `the shipped tree at ${pluginRoot} does not itself enumerate cleanly (${truth.problems.length} problem(s)); a G5 required set cannot be anchored to it`
    };
  }
  const truthById = new Map(truth.entries.map((e) => [e.id, e]));
  for (const [id, entry] of byId) {
    const real = truthById.get(id);
    if (real === void 0) {
      return { status: "refused", detail: `catalog names "${id}", which the shipped tree does not contain` };
    }
    if (real.content_hash !== entry.content_hash || real.path !== entry.path || real.kind !== entry.kind) {
      return {
        status: "refused",
        detail: `catalog entry "${id}" does not match the shipped asset (path/kind/content_hash disagree)`
      };
    }
  }
  for (const id of truthById.keys()) {
    if (!byId.has(id)) {
      return { status: "refused", detail: `the shipped tree contains "${id}", which the catalog omits` };
    }
  }
  ids.sort();
  return { status: "ok", ids: Object.freeze(ids) };
}
var crypto8, fs20, path25, import_util3, COMPATIBILITY_CATALOG_SCHEMA, SHIPPED_TEMPLATE_COUNT, SHIPPED_DOMAIN_SKILL_IDS, SHIPPED_DOMAIN_SKILL_COUNT, SHIPPED_COMPATIBILITY_ASSET_COUNT, COMPATIBILITY_ASSET_ROOTS, COMPATIBILITY_DEPRECATION_STATES, DEPRECATION_STATE_SET, MAX_SCALAR_LEN3, MAX_ID_LEN2, CONTROL_CHARS4, CANONICAL_ID2, SHA256_HEX2, BUILD_KEYS, ENTRY_KEYS, SUGGESTABLE_KEYS, EMISSION_KEYS;
var init_compatibility_catalog = __esm({
  "src/domains/config/compatibility-catalog.ts"() {
    crypto8 = __toESM(require("crypto"));
    fs20 = __toESM(require("fs"));
    path25 = __toESM(require("path"));
    import_util3 = require("util");
    init_compatibility_usage();
    init_resolver_mode();
    COMPATIBILITY_CATALOG_SCHEMA = "guild.compatibility_catalog.v1";
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
    MAX_SCALAR_LEN3 = 1024;
    MAX_ID_LEN2 = 128;
    CONTROL_CHARS4 = /[\u0000-\u001f\u007f]/;
    CANONICAL_ID2 = /^[a-z0-9][a-z0-9._-]*$/;
    SHA256_HEX2 = /^[0-9a-f]{64}$/;
    BUILD_KEYS = ["pluginRoot", "deprecation", "deprecatedBy"];
    ENTRY_KEYS = [
      "kind",
      "id",
      "path",
      "content_hash",
      "deprecation",
      "deprecated_by"
    ];
    SUGGESTABLE_KEYS = ["catalog", "project_migrated"];
    EMISSION_KEYS = ["entry", "mode", "intent", "synthetic", "specialist_id"];
  }
});

// src/domains/config/confirmation-arbiter.ts
function canonicalKey(key) {
  const parts = [];
  for (const component of CONFIRMATION_KEY_COMPONENTS) {
    const v = key?.[component];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(
        `confirmation_key_incomplete: component "${component}" is required \u2014 a partial key can never claim a confirmation (\xA76 exact-key rule)`
      );
    }
    parts.push(`${component}=${v.length}:${v}`);
  }
  return parts.join("|");
}
function createRunLocalState(runId) {
  if (typeof runId !== "string" || runId.length === 0) {
    throw new Error("confirmation state requires a run_id (run-local, \xA76)");
  }
  return { run_id: runId, prompts: /* @__PURE__ */ new Map(), decisions: /* @__PURE__ */ new Map(), next_prompt_id: 0 };
}
function claimPrompt(state, key) {
  const ck = canonicalKey(key);
  if (!state.prompts.has(ck)) {
    state.prompts.set(ck, state.next_prompt_id);
    state.next_prompt_id += 1;
  }
  return {
    prompt_id: state.prompts.get(ck),
    already_decided: state.decisions.has(ck)
  };
}
function recordDecision(state, key, decision) {
  const ck = canonicalKey(key);
  const existing = state.decisions.get(ck);
  if (existing) {
    if (existing.decision !== decision.decision) {
      throw new Error(
        `contradictory_decision: key already decided "${existing.decision}" \u2014 refusing "${decision.decision}" (one key, one decision; \xA76)`
      );
    }
    return existing;
  }
  const record = {
    key: { ...key },
    decision: decision.decision,
    at: decision.at ?? null
  };
  state.decisions.set(ck, record);
  return record;
}
function decisionFor(state, key) {
  return state.decisions.get(canonicalKey(key)) ?? null;
}
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
function finalServed(p) {
  return p.finalized === true && (p.status === "served" || p.status === "fallback_served");
}
function boundActual(p) {
  return finalServed(p) && known(p.served_model);
}
function verified(p) {
  return p.host_trust === "verified";
}
function adjudicateIndependence(input) {
  const p = input?.producer ?? {};
  const r = input?.reviewer ?? {};
  const terms = [
    { name: "bound_actual(producer)", pass: boundActual(p) },
    { name: "bound_actual(reviewer)", pass: boundActual(r) },
    { name: "verified(host(producer))", pass: verified(p) },
    { name: "verified(host(reviewer))", pass: verified(r) },
    { name: "known(host_family(producer))", pass: known(p.host_family) },
    { name: "known(host_family(reviewer))", pass: known(r.host_family) },
    {
      name: "host_family(producer) != host_family(reviewer)",
      pass: known(p.host_family) && known(r.host_family) && p.host_family !== r.host_family
    },
    { name: "known(served_family(producer))", pass: known(p.served_model_family) },
    { name: "known(served_family(reviewer))", pass: known(r.served_model_family) },
    {
      name: "served_family(producer) != served_family(reviewer)",
      pass: known(p.served_model_family) && known(r.served_model_family) && p.served_model_family !== r.served_model_family
    }
  ];
  const allPass = terms.every((t) => t.pass);
  const trace = terms.map((t) => `${t.name}=${t.pass ? "PASS" : "FAIL"}`).join("; ");
  return {
    independence: allPass ? "strong" : "weak",
    predicate_trace: `${trace} => ${allPass ? "strong" : "weak"}`,
    producer_served_model: known(p.served_model) ? p.served_model : "unknown",
    reviewer_served_model: known(r.served_model) ? r.served_model : "unknown",
    producer_model_family: known(p.served_model_family) ? p.served_model_family : "unknown",
    reviewer_model_family: known(r.served_model_family) ? r.served_model_family : "unknown"
  };
}
function asAdjudicationRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
}
function validateAdjudicationRef(v) {
  const o = asAdjudicationRecord(v);
  if (!o) return null;
  const dispatch_id = o["dispatch_id"];
  const receipt_hash = o["receipt_hash"];
  if (typeof dispatch_id !== "string" || dispatch_id.length === 0) return null;
  if (typeof receipt_hash !== "string" || !ADJUDICATION_SHA256_HEX.test(receipt_hash)) return null;
  return { dispatch_id, receipt_hash };
}
function validateWrittenAdjudication(v) {
  const o = asAdjudicationRecord(v);
  if (!o) return null;
  const producer_ref = validateAdjudicationRef(o["producer_ref"]);
  const reviewer_ref = validateAdjudicationRef(o["reviewer_ref"]);
  if (!producer_ref || !reviewer_ref) return null;
  const independence = o["independence"];
  if (independence !== "strong" && independence !== "weak") return null;
  const predicate_trace = o["predicate_trace"];
  if (typeof predicate_trace !== "string" || predicate_trace.length === 0) return null;
  return { producer_ref, reviewer_ref, independence, predicate_trace };
}
function buildIndependenceAdjudication(input) {
  if (!input.producer.finalized || !input.reviewer.finalized) {
    throw new Error(
      "adjudication_premature: the \xA77a block is written ONLY after BOTH receipts are finalized"
    );
  }
  const verdict = adjudicateIndependence({ producer: input.producer, reviewer: input.reviewer });
  return {
    producer_ref: input.producer_ref,
    reviewer_ref: input.reviewer_ref,
    producer_served_model: verdict.producer_served_model,
    reviewer_served_model: verdict.reviewer_served_model,
    producer_model_family: verdict.producer_model_family,
    reviewer_model_family: verdict.reviewer_model_family,
    requested_independence: input.requested_independence,
    independence: verdict.independence,
    predicate_trace: verdict.predicate_trace
  };
}
var known, ADJUDICATION_SHA256_HEX;
var init_independence_predicates = __esm({
  "src/domains/config/independence-predicates.ts"() {
    known = (x) => typeof x === "string" && x.length > 0 && x !== "unknown";
    ADJUDICATION_SHA256_HEX = /^[0-9a-f]{64}$/;
  }
});

// src/domains/config/independence-record.ts
function lifecycleApi() {
  if (__filename.endsWith(".ts")) {
    return require(path26.join(__dirname, "..", "lifecycle"));
  }
  const sibling = path26.join(__dirname, "lifecycle-api.js");
  if (fs21.existsSync(sibling)) return require(sibling);
  for (let dir = path26.dirname(__dirname); ; ) {
    const isPackageRoot = fs21.existsSync(path26.join(dir, "runtime")) || fs21.existsSync(path26.join(dir, ".claude-plugin")) || fs21.existsSync(path26.join(dir, ".codex-plugin")) || fs21.existsSync(path26.join(dir, "guild.inventory.json"));
    if (isPackageRoot) {
      const chunk = path26.join(dir, "runtime", "scripts", "lifecycle-api.js");
      if (!fs21.existsSync(chunk)) {
        throw new Error(
          `guild: runtime/scripts/lifecycle-api.js missing from package root ${dir} \u2014 incomplete package; run \`bun run compile\` (KTD10 fail-closed)`
        );
      }
      return require(chunk);
    }
    const parent = path26.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `guild: no package root found above ${__dirname} for lifecycle-api.js (KTD10 fail-closed)`
  );
}
function independenceDirForRunDir(runDir) {
  return path26.join(runDir, INDEPENDENCE_DIR);
}
function loadWrittenAdjudications(runDir) {
  const dir = independenceDirForRunDir(runDir);
  let names;
  try {
    names = fs21.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    let parsed;
    try {
      parsed = JSON.parse(fs21.readFileSync(path26.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    const block = validateWrittenAdjudication(parsed);
    if (block) out.push(block);
  }
  return out;
}
function validateIndependenceBinding(v) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v;
  const lane_id = o["lane_id"];
  if (typeof lane_id !== "string" || lane_id.length === 0) return null;
  const producer_ref = validateAdjudicationRef(o["producer_ref"]);
  const reviewer_ref = validateAdjudicationRef(o["reviewer_ref"]);
  if (!producer_ref || !reviewer_ref) return null;
  return { lane_id, producer_ref, reviewer_ref };
}
function sameRef(a, b) {
  return a.dispatch_id === b.dispatch_id && a.receipt_hash === b.receipt_hash;
}
function findBoundAdjudications(runDir, binding) {
  return loadWrittenAdjudications(runDir).filter(
    (b) => sameRef(b.producer_ref, binding.producer_ref) && sameRef(b.reviewer_ref, binding.reviewer_ref)
  );
}
function assertPersistableIndependence(runDir, independence, context, binding) {
  if (independence !== "strong") return;
  const where = independenceDirForRunDir(runDir);
  const bound = validateIndependenceBinding(binding);
  if (!bound) {
    throw new Error(
      `independence_binding_missing: refusing to persist independence:"strong" for ${context} \u2014 the record declares no valid \xA77a binding {lane_id, producer_ref:{dispatch_id,receipt_hash}, reviewer_ref:{dispatch_id,receipt_hash}} (receipt hashes must be sha256 hex). A strong verdict is persistable only as a claim ON a specific adjudication, never as a bare string. Record the adjudication first (persistIndependenceAdjudication) or persist "weak".`
    );
  }
  if (bound.producer_ref.dispatch_id !== bound.lane_id) {
    throw new Error(
      `independence_binding_lane_mismatch: refusing to persist independence:"strong" for ${context} \u2014 the declared adjudication's producer dispatch is "${bound.producer_ref.dispatch_id}" but the record being written is lane "${bound.lane_id}". An adjudication of ANOTHER lane's dispatch never authorizes this one, however valid it is. Adjudicate THIS lane's own producer/reviewer receipts or persist "weak".`
    );
  }
  const matches = findBoundAdjudications(runDir, bound);
  if (matches.length === 0) {
    throw new Error(
      `independence_not_adjudicated: refusing to persist independence:"strong" for ${context} \u2014 no WRITTEN, hash-bound guild.model_resolution.v1 \xA77a independence_adjudication block under ${where} matches this record's binding (producer ${bound.producer_ref.dispatch_id}@${bound.producer_ref.receipt_hash.slice(0, 12)}\u2026, reviewer ${bound.reviewer_ref.dispatch_id}@${bound.reviewer_ref.receipt_hash.slice(0, 12)}\u2026). \xA77a admits NO provisional strong: a strong review verdict exists only as an adjudicated block binding BOTH parties' finalized receipts. Record the adjudication first (persistIndependenceAdjudication) or persist "weak".`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `independence_adjudication_ambiguous: refusing to persist independence:"strong" for ${context} \u2014 ${matches.length} written \xA77a blocks under ${where} bind the SAME producer/reviewer receipt pair. Which verdict applies is ambiguous, and filename order never decides. Resolve the duplicate blocks and re-adjudicate.`
    );
  }
  if (matches[0].independence !== "strong") {
    throw new Error(
      `independence_not_adjudicated: refusing to persist independence:"strong" for ${context} \u2014 the \xA77a block bound to this record adjudicated "${matches[0].independence}", not "strong" (${matches[0].predicate_trace}). The persisted value must be the ADJUDICATED one; a caller never upgrades a verdict.`
    );
  }
}
function persistIndependenceAdjudication(input) {
  const { root, binding, label } = input;
  if (!SAFE_LABEL.test(label)) {
    throw new Error(`adjudication label "${label}" is not a safe path segment \u2014 refusing`);
  }
  const block = buildIndependenceAdjudication({
    producer_ref: input.producer_ref,
    reviewer_ref: input.reviewer_ref,
    producer: input.producer,
    reviewer: input.reviewer,
    requested_independence: input.requested_independence
  });
  const validated = validateWrittenAdjudication(block);
  if (!validated) {
    throw new Error(
      "adjudication_shape_invalid: buildIndependenceAdjudication produced a block that does not validate as a written \xA77a adjudication \u2014 refusing to persist"
    );
  }
  const verified2 = lifecycleApi().assertWritableBinding({
    root,
    run_id: binding.run_id,
    binding_ref: binding.binding_ref
  });
  const dir = path26.join(durableGuildDir(root), "runs", verified2.run_id, INDEPENDENCE_DIR);
  fs21.mkdirSync(dir, { recursive: true });
  const target = path26.join(dir, `${label}.json`);
  const tmp = `${target}.tmp-${process.pid}`;
  fs21.writeFileSync(tmp, JSON.stringify(block, null, 2) + "\n", "utf8");
  fs21.renameSync(tmp, target);
  return {
    absPath: target,
    ref: path26.join(INDEPENDENCE_DIR, `${label}.json`),
    independence: validated.independence
  };
}
var fs21, path26, INDEPENDENCE_DIR, SAFE_LABEL;
var init_independence_record = __esm({
  "src/domains/config/independence-record.ts"() {
    fs21 = __toESM(require("fs"));
    path26 = __toESM(require("path"));
    init_independence_predicates();
    init_state();
    INDEPENDENCE_DIR = "independence";
    SAFE_LABEL = /^[A-Za-z0-9_.-]+$/;
  }
});

// src/domains/config/model-catalog.ts
function purposeClassFor(purpose) {
  if (purpose === "research") return "research";
  if (["advisory", "adversarial", "security", "adversarial-security", "review"].includes(purpose)) {
    return "review";
  }
  return "general";
}
function eligibleForPurpose(input) {
  if (input.evidence_state === "available") return true;
  if (input.evidence_state === "advertised") {
    return purposeClassFor(input.purpose_class) === "general" && input.allow_advertised_attempt === true;
  }
  return false;
}
function listingAuthorityFor(targetId) {
  if (targetId === void 0) return NO_LISTING_GROUNDING;
  return LISTING_AUTHORITY[targetId] ?? NO_LISTING_GROUNDING;
}
function isPresent(value) {
  return typeof value === "string" && value.length > 0;
}
function listingCanGroundAvailable(input) {
  const grounding = listingAuthorityFor(input.target_id).available_grounding;
  if (!grounding) return false;
  return grounding.source === input.source && grounding.adapter_id === input.adapter_id;
}
function evidenceStateForListing(input) {
  if (!isPresent(input.source) || !isPresent(input.target_id) || !isPresent(input.adapter_id)) {
    throw new Error(
      "model-catalog: evidenceStateForListing requires the complete (target_id, adapter_id, source) authority triple \u2014 the bare source-only form was removed (T4-R2-001)"
    );
  }
  if (METADATA_ONLY_SOURCES.has(input.source)) return "advertised";
  if (!AUTHENTICATED_LISTING_SOURCES.has(input.source)) return "advertised";
  if (input.contract_states_availability !== true) return "advertised";
  return listingCanGroundAvailable({
    target_id: input.target_id,
    adapter_id: input.adapter_id,
    source: input.source
  }) ? "available" : "advertised";
}
function confidenceForListing(source) {
  return AUTHENTICATED_LISTING_SOURCES.has(source) ? "high" : "low";
}
function dispatchUpgrade(input) {
  const served = input.actual_model;
  if (input.result !== "served" || served == null || served === "" || served === "unknown") {
    return { upgrades: false, model: null };
  }
  return { upgrades: true, model: served };
}
function deepFreeze2(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze2(value[key]);
    }
  }
  return value;
}
function freezeSnapshot(snapshot) {
  const log = [];
  const frozen = { ...snapshot, target_log: log };
  for (const key of Object.keys(snapshot)) {
    deepFreeze2(frozen[key]);
  }
  Object.freeze(frozen);
  return frozen;
}
function appendEvidenceEvent(log, event) {
  if (!Array.isArray(log)) throw new Error("model-catalog: target_log is not an array");
  if (!LEGAL_EVIDENCE_TRANSITIONS.has(event.transition)) {
    throw new Error(`model-catalog: illegal evidence transition ${JSON.stringify(event.transition)}`);
  }
  if (event.transition.endsWith("->available")) {
    const source = event.source;
    const targetId = event.target_id;
    const adapterId = event.adapter_id;
    if (!isPresent(source)) {
      throw new Error(
        "model-catalog: ->available requires grounding evidence \u2014 a sourceless promotion is illegal (T4-R2-001)"
      );
    }
    if (!isPresent(targetId)) {
      throw new Error(
        `model-catalog: ->available is target-row-scoped \u2014 event source ${JSON.stringify(source)} carries no target_id (T4-R2-001)`
      );
    }
    if (source !== "dispatch_receipt") {
      if (!isPresent(adapterId)) {
        throw new Error(
          `model-catalog: a listing-sourced ->available requires the complete (target_id, adapter_id, source) authority triple \u2014 ${JSON.stringify(source)} for target ${JSON.stringify(targetId)} carries no adapter_id (T4-R2-001); only a dispatch receipt or the row's contract-availability listing grounds available`
        );
      }
      if (!listingCanGroundAvailable({ target_id: targetId, adapter_id: adapterId, source })) {
        throw new Error(
          `model-catalog: ->available requires a dispatch receipt or the target row's contract-availability listing, got ${JSON.stringify(source)} via adapter ${JSON.stringify(adapterId)} for target ${JSON.stringify(targetId)}`
        );
      }
    }
  }
  log.push(event);
  return log;
}
function projectionAllowed(input) {
  return input.from_target === input.to_target;
}
function defaultEvidenceStateForTarget(_targetId) {
  return "unknown";
}
function tierForCanonicalId(canonicalId) {
  for (const row of TIER_MAP) {
    if (canonicalId.startsWith(row.prefix)) return row.tier;
  }
  return "unknown";
}
function normalizeModel(raw, index, asOf, row) {
  const state = evidenceStateForListing({
    source: raw.evidence_source,
    contract_states_availability: raw.contract_states_availability,
    target_id: row.target_id,
    adapter_id: row.adapter_id
  });
  return {
    canonical_id: raw.canonical_id,
    aliases: raw.aliases ?? [],
    model_family: raw.model_family ?? "unknown",
    capabilities: raw.capabilities ?? {},
    reasoning_efforts: raw.reasoning_efforts ?? [],
    // provider order VERBATIM
    default_effort: raw.default_effort ?? null,
    tier: tierForCanonicalId(raw.canonical_id),
    provider_priority: raw.provider_priority ?? null,
    catalog_index: index,
    // 0-based provider listing position, as returned
    provider_default: raw.provider_default === true,
    visibility: raw.visibility ?? "listed",
    deprecation: raw.deprecation ?? { upgrade_to: null, migration_note: null },
    evidence: {
      state,
      source: raw.evidence_source,
      confidence: confidenceForListing(raw.evidence_source),
      as_of: asOf
    },
    dispatch_evidence: null
  };
}
function normalizeDiscovery(raw, opts) {
  if (raw.target_id !== opts.target.target_id) {
    throw new Error(
      `model-catalog: discovery target ${JSON.stringify(raw.target_id)} does not match snapshot target ${JSON.stringify(opts.target.target_id)}`
    );
  }
  return {
    schema_version: MODEL_CATALOG_SCHEMA_VERSION,
    target: {
      ...opts.target,
      adapter_id: raw.adapter_id,
      adapter_version: raw.adapter_version
    },
    discovery: {
      method: raw.method,
      source_ref: raw.source_ref,
      discovered_at: opts.discoveredAt,
      ttl_seconds: opts.ttlSeconds ?? DEFAULT_CATALOG_TTL_SECONDS,
      status: raw.status,
      latency_ms: raw.latency_ms,
      failure_reason: raw.failure_reason
    },
    generation: opts.generation,
    models: raw.models.map(
      (m, i) => normalizeModel(m, i, opts.discoveredAt, {
        target_id: opts.target.target_id,
        adapter_id: raw.adapter_id
      })
    )
  };
}
var EVIDENCE_STATES, AUTHENTICATED_LISTING_SOURCES, METADATA_ONLY_SOURCES, NO_LISTING_GROUNDING, LISTING_AUTHORITY, LEGAL_EVIDENCE_TRANSITIONS, TIER_MAPPING_VERSION, TIER_MAP;
var init_model_catalog = __esm({
  "src/domains/config/model-catalog.ts"() {
    init_catalog_cache();
    init_kernel();
    EVIDENCE_STATES = Object.freeze(["available", "advertised", "unknown", "unavailable"]);
    AUTHENTICATED_LISTING_SOURCES = /* @__PURE__ */ new Set(["contract_api_list", "native_list", "debug_catalog", "picker"]);
    METADATA_ONLY_SOURCES = /* @__PURE__ */ new Set(["static_hint", "public_doc", "unauthenticated_list"]);
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
    TIER_MAPPING_VERSION = "tier-map-v1-2026-07-30";
    TIER_MAP = [
      { prefix: "claude-haiku-", tier: "cheap" },
      { prefix: "claude-sonnet-", tier: "mid" },
      { prefix: "claude-opus-", tier: "powerful" },
      { prefix: "claude-fable-", tier: "powerful" },
      { prefix: "claude-fable", tier: "powerful" },
      { prefix: "gpt-5.6-sol", tier: "powerful" },
      { prefix: "gpt-5.6-terra", tier: "mid" },
      { prefix: "gpt-5.6-luna", tier: "cheap" },
      { prefix: "gpt-5.5", tier: "powerful" },
      { prefix: "gpt-5.4-mini", tier: "cheap" },
      { prefix: "gpt-5.4", tier: "mid" },
      { prefix: "gpt-5.3-codex-spark", tier: "cheap" }
    ];
  }
});

// src/domains/config/model-resolver.ts
function totalCatalogOrder(models) {
  return [...models].sort((a, b) => {
    const pa = a.provider_priority ?? null;
    const pb = b.provider_priority ?? null;
    if (pa !== pb) {
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa - pb;
    }
    const ia = a.catalog_index ?? Number.MAX_SAFE_INTEGER;
    const ib = b.catalog_index ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return codePointCompare(a.canonical_id ?? "", b.canonical_id ?? "");
  });
}
function expandSelector(parsed, orderedModels) {
  if (parsed.form === "id") {
    return orderedModels.filter((m) => m.canonical_id === parsed.canonical_id);
  }
  if (parsed.form === "alias") {
    return orderedModels.filter((m) => Array.isArray(m.aliases) && m.aliases.includes(parsed.alias));
  }
  return orderedModels.filter((m) => {
    if (parsed.model_family !== void 0 && m.model_family !== parsed.model_family) return false;
    if (parsed.tier !== void 0 && m.tier !== parsed.tier) return false;
    return true;
  });
}
function evaluateCondition(condition, producerModelFamily) {
  if (!condition || condition.kind === "always") return true;
  if (producerModelFamily === void 0 || producerModelFamily === null || producerModelFamily === "unknown") {
    return false;
  }
  if (condition.kind === "producer_model_family_is") {
    return producerModelFamily === condition.model_family;
  }
  if (condition.kind === "producer_model_family_is_not") {
    return producerModelFamily !== condition.model_family;
  }
  return false;
}
function selectRoute(input) {
  const evaluations = [];
  const conditionInput = input.producer_model_family === void 0 ? null : input.producer_model_family;
  for (let i = 0; i < input.routes.length; i++) {
    const row = input.routes[i];
    const complexityMatch = row.complexity === "any" || row.complexity === input.effective_complexity;
    const conditionResult = evaluateCondition(
      row.condition,
      input.producer_model_family
    );
    evaluations.push({ index: i, complexity_match: complexityMatch, condition_result: conditionResult });
    if (complexityMatch && conditionResult) {
      return { index: i, route: row, evaluations, condition_input: conditionInput };
    }
  }
  throw new Error(
    `route_unbound: no route row matches effective_complexity "${input.effective_complexity}" (fail closed \u2014 a validator-accepted policy cannot reach this; contract violation)`
  );
}
function simulateCatalogChange(change) {
  if (change.remove) liveCatalog.delete(change.remove);
  if (change.upsert) liveCatalog.set(change.upsert.canonical_id, change.upsert);
}
function fallbackHash(fallbacks) {
  return sha256Hex(canonicalYaml(fallbacks));
}
function freezeChain(input) {
  const frozenFallbacks = JSON.parse(JSON.stringify(input.fallbacks ?? []));
  const receipt2 = {
    ...input,
    fallbacks: frozenFallbacks,
    fallback_hash: fallbackHash(frozenFallbacks),
    outcome: { attempted: [] },
    finalized_at: null,
    receipt_hash: null
  };
  Object.freeze(receipt2.fallbacks);
  receipt2.fallbacks.forEach((f) => Object.freeze(f));
  return receipt2;
}
function chainModels(receipt2) {
  const models = /* @__PURE__ */ new Set();
  const sel = receipt2.selection;
  if (sel && typeof sel.model === "string") models.add(sel.model);
  for (const f of receipt2.fallbacks ?? []) models.add(f.model);
  return models;
}
function assertNotFinalized(receipt2, action) {
  if (receipt2.finalized_at) {
    throw new Error(`receipt is finalized and immutable \u2014 cannot ${action} (\xA78 lifecycle)`);
  }
}
function advanceChain(receipt2, failure) {
  const advances = FALLBACK_FAILURE_TAXONOMY[failure.failure_class];
  if (advances === void 0) {
    throw new Error(
      `failure_class "${failure.failure_class}" is outside the closed \xA74 taxonomy \u2014 fail closed`
    );
  }
  const attemptedModels = new Set((receipt2.outcome?.attempted ?? []).map((a) => a.model));
  const chain = receipt2.fallbacks ?? [];
  const next = advances ? chain.find((f) => !attemptedModels.has(f.model)) ?? null : null;
  return {
    advanced: advances,
    failure_class: failure.failure_class,
    next_model: next ? next.model : null
  };
}
function assertServedTripleConsistent(attempt, where) {
  const cls = attempt.substitution_class;
  if (cls === void 0 || cls === null) {
    throw new Error(
      `${where}: served attempt for "${attempt.model}" has no substitution_class \u2014 every served attempt carries exactly one closed \xA75 class (${SUBSTITUTION_CLASSES.join("|")}); an unreported substitution is provider_silent, never an omitted field`
    );
  }
  if (!SUBSTITUTION_CLASSES.includes(cls)) {
    throw new Error(`${where}: substitution_class "${String(cls)}" is outside the closed \xA75 set`);
  }
  const actual = attempt.actual_model ?? "unknown";
  if (cls === "none" && actual !== attempt.model) {
    throw new Error(
      `${where}: substitution_class "none" asserts actual_model === requested ("${attempt.model}") but actual_model is "${actual}" \u2014 a substitution the provider did not report is provider_silent with actual_model "unknown" (\xA75)`
    );
  }
  if (cls === "provider_silent" && actual !== "unknown") {
    throw new Error(
      `${where}: provider_silent means the provider did not report the served model \u2014 actual_model must be the literal "unknown", got "${actual}" (\xA75)`
    );
  }
  if ((cls === "provider_content_fallback" || cls === "provider_server_fallback") && (actual === "unknown" || actual === attempt.model)) {
    throw new Error(
      `${where}: ${cls} requires a provider-reported actual_model differing from the requested "${attempt.model}" (got "${actual}") \u2014 unreported is provider_silent, unchanged is none (\xA75)`
    );
  }
}
function recordAttempt(receipt2, attempt) {
  assertNotFinalized(receipt2, "record an attempt");
  if (!chainModels(receipt2).has(attempt.model)) {
    throw new Error(
      `out-of-receipt substitution: model "${attempt.model}" is not in the frozen fallback chain \u2014 any model change must advance the frozen chain or be a recorded provider-side substitution (\xA73)`
    );
  }
  if (attempt.result !== "served" && attempt.result !== "failed") {
    throw new Error(`attempt.result must be served|failed (got "${String(attempt.result)}")`);
  }
  if (attempt.result === "failed") {
    const fc = attempt.failure_class;
    if (!fc || FALLBACK_FAILURE_TAXONOMY[fc] === void 0) {
      throw new Error(`failed attempts REQUIRE a closed \xA74 failure_class (got "${String(fc)}")`);
    }
  }
  const entry = {
    model: attempt.model,
    effort: attempt.effort ?? null,
    result: attempt.result,
    failure_class: attempt.result === "failed" ? attempt.failure_class : null,
    substitution_class: attempt.result === "served" ? attempt.substitution_class ?? null : null,
    actual_model: attempt.result === "served" ? attempt.actual_model ?? "unknown" : null
  };
  if (entry.result === "served") {
    assertServedTripleConsistent(entry, "recordAttempt");
  }
  receipt2.outcome.attempted.push(entry);
  return receipt2;
}
function classifyServedAttempt(input) {
  const reported = input.provider_reported_model;
  if (reported === null || reported === void 0 || reported === "") {
    return {
      requested_model: input.requested_model,
      substitution_class: "provider_silent",
      actual_model: "unknown"
    };
  }
  if (reported === input.requested_model) {
    return { requested_model: input.requested_model, substitution_class: "none", actual_model: reported };
  }
  const mechanism = input.mechanism ?? "";
  const cls = mechanism === "content_classifier" ? "provider_content_fallback" : mechanism === "fallbacks_param" || mechanism === "server_fallback" ? "provider_server_fallback" : (
    // A reported substitution with no stated mechanism is still a
    // provider-side substitution; classify by the conservative content
    // class so it is never masked as `none`.
    "provider_content_fallback"
  );
  return { requested_model: input.requested_model, substitution_class: cls, actual_model: reported };
}
function finalizeReceipt(receipt2, opts) {
  if (receipt2.finalized_at) {
    throw new Error("receipt already finalized \u2014 finalization happens exactly once (\xA78)");
  }
  if (!RESOLUTION_STATUSES.includes(opts.status)) {
    throw new Error(`outcome.status "${String(opts.status)}" outside the closed union`);
  }
  (receipt2.outcome.attempted ?? []).forEach((a, i) => {
    if (a.result === "served") {
      assertServedTripleConsistent(a, `finalizeReceipt: outcome.attempted[${i}]`);
    }
  });
  receipt2.outcome.status = opts.status;
  const served = [...receipt2.outcome.attempted].reverse().find((a) => a.result === "served");
  if (served && receipt2.outcome.actual_model === void 0) {
    receipt2.outcome.actual_model = served.actual_model ?? "unknown";
  }
  receipt2.finalized_at = opts.at ?? (/* @__PURE__ */ new Date()).toISOString();
  receipt2.receipt_hash_algorithm = "sha256";
  receipt2.receipt_hash_scope = "canonical_yaml_with_receipt_hash_field_omitted";
  delete receipt2["receipt_hash"];
  receipt2.receipt_hash = selfReferentialHash(
    receipt2,
    "receipt_hash"
  );
  return receipt2;
}
function finalizeInterrupted(receipt2, opts) {
  return finalizeReceipt(receipt2, { status: "interrupted", at: opts?.at });
}
function verifyResolutionReceipt(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "not_an_object" };
  }
  const r = value;
  if (r.schema_version !== "guild.model_resolution.v1") {
    return { ok: false, reason: "schema_version_mismatch" };
  }
  if (typeof r.resolution_core_hash !== "string" || r.resolution_core_hash.length === 0) {
    return { ok: false, reason: "core_hash_absent" };
  }
  if (coreHash(r) !== r.resolution_core_hash) {
    return { ok: false, reason: "core_hash_mismatch" };
  }
  const finalizedAt = r.finalized_at;
  const receiptHash = r.receipt_hash;
  const claimsFinalization = finalizedAt !== null && finalizedAt !== void 0 || receiptHash !== null && receiptHash !== void 0;
  if (!claimsFinalization) return { ok: true, receipt: r, finalized: false };
  if (typeof finalizedAt !== "string" || typeof receiptHash !== "string") {
    return { ok: false, reason: "finalization_partial" };
  }
  const recomputed = selfReferentialHash(
    r,
    "receipt_hash"
  );
  if (recomputed !== receiptHash) return { ok: false, reason: "receipt_hash_mismatch" };
  return { ok: true, receipt: r, finalized: true };
}
function contentRef(name, value) {
  const bytes = typeof value === "string" ? value : canonicalYaml(value);
  return { path_or_id: `inline:${name}`, sha256: sha256Hex(bytes) };
}
function asObject(value) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}
function coreHash(receipt2) {
  const core = {};
  for (const [k, v] of Object.entries(receipt2)) {
    if (k === "outcome" || k === "finalized_at" || k === "receipt_hash" || k === "receipt_hash_algorithm" || k === "receipt_hash_scope" || k === "resolution_core_hash")
      continue;
    if (v === void 0) continue;
    core[k] = v;
  }
  return sha256Hex(canonicalYaml(core));
}
function failClosedCore(inputs, reason, rulePath) {
  const receipt2 = {
    schema_version: "guild.model_resolution.v1",
    run_id: inputs.run_id ?? "unbound",
    dispatch_id: inputs.dispatch_id ?? "unbound",
    refs: {
      session_context: contentRef("session_context", inputs.session_context),
      catalog_snapshot: contentRef("catalog_snapshot", inputs.catalog_snapshot),
      policy: contentRef("policy", inputs.policy)
    },
    request: null,
    selection: null,
    fallbacks: [],
    fallback_hash: fallbackHash([]),
    rejections: [],
    rule_path: [...rulePath, `fail_closed:${reason}`],
    failed_closed: reason,
    outcome: { attempted: [] },
    finalized_at: null,
    receipt_hash: null
  };
  receipt2.resolution_core_hash_algorithm = "sha256";
  receipt2.resolution_core_hash_scope = "canonical_yaml_with_resolution_core_hash_field_omitted";
  receipt2.resolution_core_hash = coreHash(receipt2);
  return receipt2;
}
function resolve16(inputs) {
  const rulePath = [];
  const policyObj = asObject(inputs.policy);
  if (policyObj === null) {
    return failClosedCore(inputs, "policy_unparsable", rulePath);
  }
  const policyRejects = validateModelPolicy(policyObj);
  if (policyRejects.length > 0) {
    return failClosedCore(inputs, "policy_invalid", [
      ...rulePath,
      ...policyRejects.slice(0, 5).map((r) => `policy_reject:${r}`)
    ]);
  }
  const policy = policyObj;
  const request = inputs.request;
  if (!request || typeof request.purpose !== "string") {
    return failClosedCore(inputs, "purpose_unbound", rulePath);
  }
  const purposePolicy = policy.purposes[request.purpose];
  if (!purposePolicy) {
    return failClosedCore(inputs, `purpose_unconfigured:${request.purpose}`, rulePath);
  }
  const catalogObj = asObject(inputs.catalog_snapshot);
  const models = Array.isArray(catalogObj?.["models"]) ? catalogObj["models"] : null;
  if (!models) {
    return failClosedCore(inputs, "catalog_snapshot_unparsable", rulePath);
  }
  const catalogRejects = validateModelPolicy(policyObj, { catalog_models: models });
  if (catalogRejects.length > 0) {
    return failClosedCore(inputs, "policy_invalid", [
      ...rulePath,
      ...catalogRejects.slice(0, 5).map((r) => `policy_reject:${r}`)
    ]);
  }
  const requested = request.requested_complexity ?? "easy";
  const effective = maxComplexity(
    maxComplexity(requested, purposeComplexityFloor(request.purpose)),
    purposePolicy.min_effective_complexity
  );
  const producerFamily = inputs.producer?.model_family ?? (isReviewClassPurpose(request.purpose) ? "unknown" : void 0);
  let routeSel;
  try {
    routeSel = selectRoute({
      routes: purposePolicy.routes,
      effective_complexity: effective,
      producer_model_family: producerFamily
    });
  } catch (e) {
    return failClosedCore(inputs, "route_unbound", [
      ...rulePath,
      `route_selection:${e.message}`
    ]);
  }
  for (const ev of routeSel.evaluations) {
    rulePath.push(
      `route[${ev.index}]:complexity_match=${ev.complexity_match},condition=${ev.condition_result}`
    );
  }
  rulePath.push(`route_selected:${routeSel.index}`);
  const route2 = routeSel.route;
  const ordered = totalCatalogOrder(models);
  const candidates = [];
  const expandList = (entries, source) => {
    entries.forEach((sel, idx) => {
      const parsed = parseSelector(sel.selector);
      const matches = expandSelector(parsed, ordered);
      rulePath.push(`${source}[${idx}]:${sel.selector}->${matches.length}`);
      for (const m of matches) {
        candidates.push({
          entry: m,
          source,
          selectorIndex: idx,
          selectorEffort: sel.effort ?? null,
          requiredCapabilities: sel.capabilities ?? []
        });
      }
    });
  };
  expandList(route2.preferred ?? [], "preferred");
  expandList(route2.fallbacks ?? [], "fallback");
  if ((route2.provider_default ?? "forbid") === "allow_last_resort") {
    const pd = ordered.find((m) => m.provider_default === true);
    if (pd) {
      rulePath.push(`provider_default:${pd.canonical_id}`);
      candidates.push({
        entry: pd,
        source: "provider_default",
        selectorIndex: -1,
        selectorEffort: null,
        requiredCapabilities: []
      });
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const deduped = candidates.filter((c) => {
    if (seen.has(c.entry.canonical_id)) return false;
    seen.add(c.entry.canonical_id);
    return true;
  });
  const rejections = [];
  const survivors = [];
  const tierFloor = purposeTierFloor(request.purpose);
  for (const c of deduped) {
    if (tierFloor !== null && c.entry.tier !== tierFloor) {
      rejections.push({ model: c.entry.canonical_id, reason: "policy" });
      continue;
    }
    const caps = c.entry.capabilities ?? {};
    const missingCap = c.requiredCapabilities.find((k) => !caps[k]);
    if (missingCap !== void 0) {
      rejections.push({ model: c.entry.canonical_id, reason: "capability" });
      continue;
    }
    const evidenceState = c.entry.evidence?.state ?? "unknown";
    const eligible = eligibleForPurpose({
      evidence_state: evidenceState,
      purpose_class: request.purpose,
      allow_advertised_attempt: policy.allow_advertised_attempt === true
    });
    if (!eligible) {
      rejections.push({ model: c.entry.canonical_id, reason: "evidence" });
      continue;
    }
    survivors.push(c);
  }
  if (survivors.length === 0) {
    return failClosedCore(inputs, "no_eligible_candidate", [
      ...rulePath,
      ...rejections.map((r) => `reject:${r.model}:${r.reason}`)
    ]);
  }
  const first = survivors[0];
  const efforts = first.entry.reasoning_efforts ?? [];
  let effort;
  let effortDegraded = false;
  if (first.selectorEffort && efforts.includes(first.selectorEffort)) {
    effort = first.selectorEffort;
  } else if (first.selectorEffort) {
    effort = first.entry.default_effort ?? null;
    effortDegraded = true;
  } else {
    effort = first.entry.default_effort ?? null;
  }
  const independenceNote = (candidateFamily) => {
    if (!isReviewClassPurpose(request.purpose)) return null;
    const fam = candidateFamily ?? "unknown";
    if (producerFamily === void 0 || producerFamily === null || producerFamily === "unknown" || fam === "unknown") {
      return "producer_or_candidate_family_unknown:weak";
    }
    return fam === producerFamily ? "same_family_as_producer:weak" : "cross_family";
  };
  const frozenFallbacks = survivors.slice(1).map((c) => ({
    model: c.entry.canonical_id,
    effort: c.selectorEffort && (c.entry.reasoning_efforts ?? []).includes(c.selectorEffort) ? c.selectorEffort : c.entry.default_effort ?? null,
    evidence_state: c.entry.evidence?.state ?? "unknown",
    source: c.source,
    independence_note: independenceNote(c.entry.model_family)
  }));
  const receipt2 = {
    schema_version: "guild.model_resolution.v1",
    run_id: inputs.run_id ?? "unbound",
    dispatch_id: inputs.dispatch_id ?? "unbound",
    refs: {
      session_context: contentRef("session_context", inputs.session_context),
      catalog_snapshot: contentRef("catalog_snapshot", inputs.catalog_snapshot),
      policy: contentRef("policy", inputs.policy)
    },
    request: {
      purpose: request.purpose,
      purpose_origin: request.purpose_origin ?? "unbound",
      dispatch_ancestry: request.dispatch_ancestry ?? [],
      rejected_labels: request.rejected_labels ?? [],
      requested_complexity: requested,
      effective_complexity: effective,
      forced_floor_reason: request.forced_floor_reason ?? null
    },
    selection: {
      target_id: asObject(inputs.session_context)?.["target_id"] ?? "unknown",
      model: first.entry.canonical_id,
      effort,
      evidence_state: first.entry.evidence?.state ?? "unknown",
      route: {
        index: routeSel.index,
        complexity: route2.complexity,
        condition_kind: route2.condition?.kind ?? "always",
        condition_model_family: route2.condition?.model_family ?? null,
        condition_input: routeSel.condition_input
      },
      source: first.source
    },
    fallbacks: frozenFallbacks,
    fallback_hash: fallbackHash(frozenFallbacks),
    rejections,
    rule_path: [
      ...rulePath,
      `selected:${first.entry.canonical_id}:${first.source}[${first.selectorIndex}]`
    ],
    outcome: { attempted: [] },
    finalized_at: null,
    receipt_hash: null
  };
  if (isReviewClassPurpose(request.purpose)) {
    receipt2.review = {
      requested_independence: purposePolicy.independence,
      producer: {
        host_family: inputs.producer?.host_family ?? "unknown",
        host_family_trust: inputs.producer?.host_family_trust ?? "asserted",
        model_family: inputs.producer?.model_family ?? "unknown",
        model_family_source: inputs.producer?.model_family_source ?? "unknown",
        resolution_ref: inputs.producer?.resolution_ref ?? null
      }
    };
  }
  if (effortDegraded) {
    receipt2.outcome.degradation = {
      kind: "effort",
      note: `selector effort "${first.selectorEffort}" not in entry reasoning_efforts; used default`
    };
  }
  Object.freeze(receipt2.fallbacks);
  receipt2.fallbacks.forEach((f) => Object.freeze(f));
  receipt2.resolution_core_hash_algorithm = "sha256";
  receipt2.resolution_core_hash_scope = "canonical_yaml_with_resolution_core_hash_field_omitted";
  receipt2.resolution_core_hash = coreHash(receipt2);
  return receipt2;
}
function persistResolutionReceipt(runDir, receipt2) {
  const runId = path27.basename(runDir);
  if (!receipt2.run_id || receipt2.run_id !== runId) {
    throw new Error(
      `run_binding_mismatch: receipt.run_id "${String(receipt2.run_id)}" does not match the bound run dir "${runId}" \u2014 refusing to write`
    );
  }
  if (!receipt2.dispatch_id || receipt2.dispatch_id === "unbound") {
    throw new Error("run_binding_mismatch: receipt has no dispatch_id \u2014 refusing to write");
  }
  const dir = path27.join(runDir, "resolution");
  fs22.mkdirSync(dir, { recursive: true });
  const target = path27.join(dir, `${receipt2.dispatch_id}.receipt.yaml`);
  const tmp = `${target}.tmp-${process.pid}`;
  fs22.writeFileSync(tmp, canonicalYaml(receipt2), "utf8");
  fs22.renameSync(tmp, target);
  return target;
}
var fs22, path27, FALLBACK_FAILURE_TAXONOMY, RESOLUTION_STATUSES, liveCatalog, SUBSTITUTION_CLASSES;
var init_model_resolver = __esm({
  "src/domains/config/model-resolver.ts"() {
    fs22 = __toESM(require("fs"));
    path27 = __toESM(require("path"));
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
    liveCatalog = /* @__PURE__ */ new Map();
    SUBSTITUTION_CLASSES = [
      "none",
      "provider_content_fallback",
      "provider_server_fallback",
      "provider_silent"
    ];
  }
});

// src/domains/config/model-inspect.ts
function asRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
}
function str(v, fallback) {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}
function deepFreeze3(value) {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze3(v);
    Object.freeze(value);
  }
  return value;
}
function parseRfc3339Seconds(s) {
  if (typeof s !== "string") return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1e3) : null;
}
function buildModelInspection(input) {
  const unknowns = [];
  const flags = { ...input.flags };
  const sc = asRecord(input.session_context) ?? {};
  const runId = str(sc["run_id"], "unknown");
  if (runId === "unknown") unknowns.push("run_id");
  const hostBlock = asRecord(sc["host"]);
  const host = {
    family: str(hostBlock?.["family"], "unknown"),
    surface: str(hostBlock?.["surface"], "unknown")
  };
  if (host.family === "unknown") unknowns.push("host");
  const idBlock = asRecord(sc["identity"]);
  const identity = {
    source: str(idBlock?.["source"], "none"),
    // Unknown-safe: absent trust degrades to asserted, never upgrades (T3).
    trust: idBlock?.["trust"] === "verified" ? "verified" : "asserted",
    confidence: str(idBlock?.["confidence"], "low"),
    evidence: str(idBlock?.["evidence"], "unknown")
  };
  if (!idBlock) unknowns.push("identity");
  const targetBlock = asRecord(sc["execution_target"]);
  const target = {
    target_id: str(targetBlock?.["target_id"], "unknown"),
    provider_kind: str(targetBlock?.["provider_kind"], "unknown"),
    auth_mode: str(targetBlock?.["auth_mode"], "unknown")
  };
  if (target.target_id === "unknown") unknowns.push("target");
  const inspectOff = flags["model_routing.inspect"] !== "on";
  if (inspectOff) {
    return deepFreeze3({
      schema_version: MODEL_INSPECTION_SCHEMA,
      state: "inspect_disabled",
      generated_at: input.now,
      run_id: runId,
      host,
      identity,
      target,
      catalog: {
        state: "inspect_disabled",
        target_id: null,
        discovered_at: null,
        age_seconds: null,
        ttl_seconds: null,
        stale: null,
        generation: null,
        models: null
      },
      policy: { present: false, policy_hash: null, rule_path: null },
      selection: null,
      fallbacks: null,
      outcome: { finalized: false, status: "not_inspected", actual_model: "unknown" },
      independence: {
        adjudicated: false,
        independence: null,
        note: "inspection disabled (model_routing.inspect off)"
      },
      degradation: null,
      flags,
      unknowns: ["inspection_disabled"]
    });
  }
  let catalog;
  const snapshot = asRecord(input.catalog_snapshot);
  if (flags["model_routing.discovery"] !== "on") {
    catalog = {
      state: "discovery_disabled",
      target_id: null,
      discovered_at: null,
      age_seconds: null,
      ttl_seconds: null,
      stale: null,
      generation: null,
      models: null
    };
    unknowns.push("catalog");
  } else if (!snapshot) {
    catalog = {
      state: "absent",
      target_id: null,
      discovered_at: null,
      age_seconds: null,
      ttl_seconds: null,
      stale: null,
      generation: null,
      models: null
    };
    unknowns.push("catalog");
  } else {
    const discovery = asRecord(snapshot["discovery"]);
    const discoveredAt = typeof discovery?.["discovered_at"] === "string" ? discovery["discovered_at"] : null;
    const ttl = typeof discovery?.["ttl_seconds"] === "number" ? discovery["ttl_seconds"] : null;
    const nowS = parseRfc3339Seconds(input.now);
    const thenS = parseRfc3339Seconds(discoveredAt);
    const age = nowS !== null && thenS !== null ? nowS - thenS : null;
    if (age === null) unknowns.push("catalog_age");
    const models = Array.isArray(snapshot["models"]) ? snapshot["models"].map((m) => {
      const row = asRecord(m) ?? {};
      const evidence = asRecord(row["evidence"]);
      return {
        canonical_id: str(row["canonical_id"], "unknown"),
        tier: str(row["tier"], "unknown"),
        evidence_state: str(evidence?.["state"], "unknown")
      };
    }) : null;
    catalog = {
      state: "ok",
      target_id: str(asRecord(snapshot["target"])?.["target_id"], "unknown"),
      discovered_at: discoveredAt,
      age_seconds: age,
      ttl_seconds: ttl,
      stale: age !== null && ttl !== null ? age > ttl : null,
      generation: typeof snapshot["generation"] === "number" ? snapshot["generation"] : null,
      models
    };
  }
  let receipt2 = null;
  let receiptFinalized = false;
  let verifiedReceiptHash = null;
  if (input.receipt !== null && input.receipt !== void 0) {
    const verdict = verifyResolutionReceipt(input.receipt);
    if (verdict.ok === true) {
      receipt2 = verdict.receipt;
      receiptFinalized = verdict.finalized;
      verifiedReceiptHash = verdict.finalized ? verdict.receipt.receipt_hash : null;
    } else {
      const rejected = verdict;
      unknowns.push(`receipt_unverified:${rejected.reason}`);
    }
  }
  const refs = asRecord(receipt2?.["refs"]);
  const policyRef = asRecord(refs?.["policy"]);
  const policyPresent = input.policy !== null && input.policy !== void 0;
  const policy = {
    present: policyPresent,
    policy_hash: str(policyRef?.["sha256"], "") || null,
    rule_path: Array.isArray(receipt2?.["rule_path"]) ? receipt2["rule_path"] : null
  };
  if (!policyPresent) unknowns.push("policy");
  const selectionBlock = asRecord(receipt2?.["selection"]);
  const selection = selectionBlock ? {
    model: str(selectionBlock["model"], "unknown"),
    effort: typeof selectionBlock["effort"] === "string" ? selectionBlock["effort"] : null,
    evidence_state: str(selectionBlock["evidence_state"], "unknown")
  } : null;
  if (!selection) unknowns.push("selection");
  const fallbacks = receipt2 && Array.isArray(receipt2["fallbacks"]) && typeof receipt2["fallback_hash"] === "string" ? { chain: receipt2["fallbacks"], fallback_hash: receipt2["fallback_hash"] } : null;
  const outcomeBlock = asRecord(receipt2?.["outcome"]);
  const outcome = receiptFinalized ? {
    finalized: true,
    status: str(outcomeBlock?.["status"], "unknown"),
    actual_model: str(outcomeBlock?.["actual_model"], "unknown")
  } : { finalized: false, status: "pending", actual_model: "unknown" };
  if (outcome.actual_model === "unknown") unknowns.push("actual_model");
  const adjudicationBlock = validateAdjudicationBlock(input.adjudication);
  let independence;
  if (input.adjudication === null || input.adjudication === void 0) {
    independence = {
      adjudicated: false,
      independence: null,
      note: "no adjudication block written \u2014 no independence value exists (\xA77a: never provisional)"
    };
  } else if (!adjudicationBlock) {
    independence = {
      adjudicated: false,
      independence: null,
      note: "supplied independence value rejected: not a written \xA77a adjudication block (closed shape with producer_ref/reviewer_ref receipt hashes + predicate_trace)"
    };
  } else if (verifiedReceiptHash === null) {
    independence = {
      adjudicated: false,
      independence: null,
      note: "adjudication block rejected: no verified finalized receipt to bind it to (\xA77a blocks are written only after both receipts verify as finalized)"
    };
  } else if (adjudicationBlock.producer_ref.receipt_hash !== verifiedReceiptHash && adjudicationBlock.reviewer_ref.receipt_hash !== verifiedReceiptHash) {
    independence = {
      adjudicated: false,
      independence: null,
      note: "adjudication block rejected: neither backward ref matches this dispatch's verified receipt_hash (hash-bound \xA77a adjudication required)"
    };
  } else {
    independence = {
      adjudicated: true,
      independence: adjudicationBlock.independence,
      note: adjudicationBlock.predicate_trace
    };
  }
  if (!independence.adjudicated) unknowns.push("independence");
  const degradationBlock = asRecord(outcomeBlock?.["degradation"]);
  const degradation = receiptFinalized && degradationBlock ? { kind: str(degradationBlock["kind"], "unknown"), note: str(degradationBlock["note"], "") } : null;
  return deepFreeze3({
    schema_version: MODEL_INSPECTION_SCHEMA,
    state: "ok",
    generated_at: input.now,
    run_id: runId,
    host,
    identity,
    target,
    catalog,
    policy,
    selection,
    fallbacks,
    outcome,
    independence,
    degradation,
    flags,
    unknowns
  });
}
var MODEL_INSPECTION_SCHEMA, validateAdjudicationBlock;
var init_model_inspect = __esm({
  "src/domains/config/model-inspect.ts"() {
    init_model_resolver();
    init_independence_predicates();
    MODEL_INSPECTION_SCHEMA = "guild.model_inspection.v1";
    validateAdjudicationBlock = validateWrittenAdjudication;
  }
});

// src/domains/config/inspection-persist.ts
function lifecycleApi2() {
  if (__filename.endsWith(".ts")) {
    return require(path28.join(__dirname, "..", "lifecycle"));
  }
  const sibling = path28.join(__dirname, "lifecycle-api.js");
  if (fs23.existsSync(sibling)) return require(sibling);
  for (let dir = path28.dirname(__dirname); ; ) {
    const isPackageRoot = fs23.existsSync(path28.join(dir, "runtime")) || fs23.existsSync(path28.join(dir, ".claude-plugin")) || fs23.existsSync(path28.join(dir, ".codex-plugin")) || fs23.existsSync(path28.join(dir, "guild.inventory.json"));
    if (isPackageRoot) {
      const chunk = path28.join(dir, "runtime", "scripts", "lifecycle-api.js");
      if (!fs23.existsSync(chunk)) {
        throw new Error(
          `guild: runtime/scripts/lifecycle-api.js missing from package root ${dir} \u2014 incomplete package; run \`bun run compile\` (KTD10 fail-closed)`
        );
      }
      return require(chunk);
    }
    const parent = path28.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `guild: no package root found above ${__dirname} for lifecycle-api.js (KTD10 fail-closed)`
  );
}
function persistInspectionReport(input) {
  const { root, report, binding, label } = input;
  if (report.schema_version !== MODEL_INSPECTION_SCHEMA) {
    throw new Error(
      "refusing to persist a non-guild.model_inspection.v1 object as inspection evidence"
    );
  }
  if (!SAFE_LABEL2.test(label)) {
    throw new Error(`inspection label "${label}" is not a safe path segment \u2014 refusing`);
  }
  if (report.run_id !== binding.run_id) {
    throw new Error(
      `run_binding_mismatch: inspection report for run "${report.run_id}" cannot be persisted under run "${binding.run_id}" \u2014 refusing`
    );
  }
  const verified2 = lifecycleApi2().assertWritableBinding({
    root,
    run_id: binding.run_id,
    binding_ref: binding.binding_ref
  });
  const dir = path28.join(durableGuildDir(root), "runs", verified2.run_id, "inspection");
  fs23.mkdirSync(dir, { recursive: true });
  const target = path28.join(dir, `${label}.json`);
  const tmp = `${target}.tmp-${process.pid}`;
  fs23.writeFileSync(tmp, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs23.renameSync(tmp, target);
  return { absPath: target, ref: path28.join("inspection", `${label}.json`) };
}
var fs23, path28, SAFE_LABEL2;
var init_inspection_persist = __esm({
  "src/domains/config/inspection-persist.ts"() {
    fs23 = __toESM(require("fs"));
    path28 = __toESM(require("path"));
    init_model_inspect();
    init_state();
    SAFE_LABEL2 = /^[A-Za-z0-9_.-]+$/;
  }
});

// src/domains/config/routing-rollout.ts
function lifecycleApi3() {
  if (__filename.endsWith(".ts")) {
    return require(path29.join(__dirname, "..", "lifecycle"));
  }
  const sibling = path29.join(__dirname, "lifecycle-api.js");
  if (fs24.existsSync(sibling)) return require(sibling);
  for (let dir = path29.dirname(__dirname); ; ) {
    const isPackageRoot = fs24.existsSync(path29.join(dir, "runtime")) || fs24.existsSync(path29.join(dir, ".claude-plugin")) || fs24.existsSync(path29.join(dir, ".codex-plugin")) || fs24.existsSync(path29.join(dir, "guild.inventory.json"));
    if (isPackageRoot) {
      const chunk = path29.join(dir, "runtime", "scripts", "lifecycle-api.js");
      if (!fs24.existsSync(chunk)) {
        throw new Error(
          `guild: runtime/scripts/lifecycle-api.js missing from package root ${dir} \u2014 incomplete package; run \`bun run compile\` (KTD10 fail-closed)`
        );
      }
      return require(chunk);
    }
    const parent = path29.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `guild: no package root found above ${__dirname} for lifecycle-api.js (KTD10 fail-closed)`
  );
}
function readRoutingFlags(settings) {
  const flags = { ...ROUTING_FLAG_DEFAULTS };
  const rejects = [];
  if (settings !== void 0 && settings !== null && (typeof settings !== "object" || Array.isArray(settings))) {
    rejects.push("settings root is not an object \u2014 using ADR defaults for every rollout flag");
    return { flags, rejects };
  }
  const root = settings ?? {};
  for (const [group, keys] of Object.entries(FLAG_GROUPS)) {
    const groupValue = root[group];
    if (groupValue === void 0 || groupValue === null) continue;
    if (typeof groupValue !== "object" || Array.isArray(groupValue)) {
      rejects.push(`settings.${group} is not an object \u2014 ${group}.* flags keep their defaults`);
      continue;
    }
    const groupObj = groupValue;
    for (const [k, v] of Object.entries(groupObj)) {
      if (!keys.includes(k)) {
        if (group === "model_routing") {
          rejects.push(`unknown key under closed group: ${group}.${k}`);
        }
        continue;
      }
      const flagKey = `${group}.${k}`;
      if (v === "on" || v === "off") {
        flags[flagKey] = v;
      } else {
        rejects.push(
          `${flagKey}: expected "on" | "off", got ${JSON.stringify(v)} \u2014 keeping default "${ROUTING_FLAG_DEFAULTS[flagKey]}"`
        );
      }
    }
  }
  return { flags, rejects };
}
function resolveInRunDir(runDir, ref) {
  const abs = path29.resolve(runDir, ref);
  return abs === runDir || abs.startsWith(runDir + path29.sep) ? abs : null;
}
function loadJson(absPath) {
  try {
    const parsed = JSON.parse(fs24.readFileSync(absPath, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function loadVerifiedM0Reports(evidence) {
  if (!evidence || typeof evidence.root !== "string" || typeof evidence.run_id !== "string") {
    return [];
  }
  const binding = lifecycleApi3().readRunBindingRecord({ root: evidence.root, run_id: evidence.run_id });
  if (binding.status !== "ok") return [];
  const runDir = path29.resolve(durableGuildDir(evidence.root), "runs", evidence.run_id);
  const refs = Array.isArray(evidence.m0?.inspection_report_refs) ? evidence.m0.inspection_report_refs : [];
  const out = [];
  for (const ref of refs) {
    if (typeof ref !== "string") continue;
    const abs = resolveInRunDir(runDir, ref);
    if (!abs) continue;
    const report = loadJson(abs);
    if (!report) continue;
    if (report["schema_version"] !== "guild.model_inspection.v1") continue;
    if (report["state"] !== "ok") continue;
    if (report["run_id"] !== evidence.run_id) continue;
    out.push(report);
  }
  return out;
}
function gateM2(flags, evidence) {
  if (flags["model_routing.enabled"] !== "on") {
    return { active: false, reason: "model_routing.enabled is off (M2 is opt-in)" };
  }
  if (!evidence || typeof evidence.root !== "string" || typeof evidence.run_id !== "string") {
    return {
      active: false,
      reason: "M0 not evidenced: no evidence refs supplied \u2014 v2 routing stays off"
    };
  }
  const binding = lifecycleApi3().readRunBindingRecord({ root: evidence.root, run_id: evidence.run_id });
  if (binding.status !== "ok") {
    return {
      active: false,
      reason: `run binding ${binding.status} for ${evidence.run_id}: evidence in an unbound run tree proves nothing \u2014 v2 routing stays off`
    };
  }
  const runDir = path29.resolve(durableGuildDir(evidence.root), "runs", evidence.run_id);
  const m0Refs = Array.isArray(evidence.m0?.inspection_report_refs) ? evidence.m0.inspection_report_refs : [];
  const m0Valid = loadVerifiedM0Reports(evidence).length;
  if (m0Valid === 0) {
    return {
      active: false,
      reason: `M0 not evidenced: 0 of ${m0Refs.length} inspection ref(s) loaded as a valid guild.model_inspection.v1 report bound to ${evidence.run_id} \u2014 v2 routing stays off`
    };
  }
  const m1Refs = Array.isArray(evidence.m1?.shadow_comparison_refs) ? evidence.m1.shadow_comparison_refs : [];
  let m1Valid = 0;
  for (const ref of m1Refs) {
    if (typeof ref !== "string") continue;
    const abs = resolveInRunDir(runDir, ref);
    if (!abs) continue;
    const cmp = loadJson(abs);
    if (!cmp) continue;
    if (cmp["schema_version"] !== "guild.shadow_comparison.v1") continue;
    if (cmp["run_id"] !== evidence.run_id) continue;
    if (cmp["comparable"] !== true) continue;
    const storedHash = cmp["comparison_hash"];
    if (typeof storedHash !== "string" || !/^[0-9a-f]{64}$/.test(storedHash)) continue;
    if (selfReferentialHash(cmp, "comparison_hash") !== storedHash) continue;
    m1Valid += 1;
  }
  if (m1Valid === 0) {
    return {
      active: false,
      reason: `M1 not evidenced: 0 of ${m1Refs.length} shadow-comparison ref(s) loaded as a comparable, hash-verified guild.shadow_comparison.v1 record bound to ${evidence.run_id} \u2014 v2 routing stays off`
    };
  }
  return {
    active: true,
    reason: `M2 active: opt-in flag on; M0 evidenced (${m0Valid} verified inspection report(s)); M1 evidenced (${m1Valid} verified comparable shadow comparison(s))`
  };
}
function rollbackV2Routing(flags) {
  return { ...flags, "model_routing.shadow": "off", "model_routing.enabled": "off" };
}
var fs24, path29, ROUTING_FLAG_KEYS, ROUTING_FLAG_DEFAULTS, FLAG_GROUPS;
var init_routing_rollout = __esm({
  "src/domains/config/routing-rollout.ts"() {
    fs24 = __toESM(require("fs"));
    path29 = __toESM(require("path"));
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
function resolveDeps(d) {
  return {
    candidateRunId: d.candidateRunId ?? (() => null),
    stdout: d.stdout ?? ((s) => process.stdout.write(s)),
    stderr: d.stderr ?? ((s) => process.stderr.write(s)),
    now: d.now ?? (() => (/* @__PURE__ */ new Date()).toISOString())
  };
}
function parseModelsArgs(argv) {
  if (argv.length === 0) return { error: "missing sub-verb" };
  const verb = argv[0];
  if (verb !== "inspect") {
    return {
      error: 'unknown sub-verb "' + verb + '" - `guild models` exposes exactly one READ-ONLY sub-verb (inspect); adding another public verb is a requires-confirmation change'
    };
  }
  let cwd = process.cwd();
  let runId = null;
  let json = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--cwd" && argv[i + 1] !== void 0) cwd = path30.resolve(argv[++i]);
    else if (a.startsWith("--cwd=")) cwd = path30.resolve(a.slice("--cwd=".length));
    else if (a === "--run-id" && argv[i + 1] !== void 0) runId = argv[++i];
    else if (a.startsWith("--run-id=")) runId = a.slice("--run-id=".length);
    else return { error: "unknown argument: " + a };
  }
  if (runId !== null && !/^[A-Za-z0-9._-]+$/.test(runId)) {
    return { error: "unsafe --run-id value: " + runId };
  }
  return { verb: "inspect", cwd, runId, json };
}
function readJson2(p) {
  try {
    if (!fs25.existsSync(p)) return null;
    return JSON.parse(fs25.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
function loadPersistedInspections(root, runId) {
  const dir = path30.join(durableGuildDir(root), "runs", runId, "inspection");
  if (!fs25.existsSync(dir)) return [];
  const out = [];
  for (const name of fs25.readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const p = path30.join(dir, name);
    const parsed = readJson2(p);
    const label = name.replace(/\.json$/, "");
    if (parsed === null || typeof parsed !== "object") {
      out.push({
        label,
        source_path: p,
        claims: {},
        bound: false,
        binding_reason: "unreadable or non-object inspection artifact"
      });
      continue;
    }
    if (parsed.schema_version !== MODEL_INSPECTION_SCHEMA) {
      out.push({
        label,
        source_path: p,
        claims: {},
        bound: false,
        binding_reason: "not a " + MODEL_INSPECTION_SCHEMA + " artifact"
      });
      continue;
    }
    if (parsed.run_id !== runId) {
      out.push({
        label,
        source_path: p,
        claims: {},
        bound: false,
        binding_reason: "run-binding mismatch: the artifact names a different run than the one inspected"
      });
      continue;
    }
    out.push({
      label,
      source_path: p,
      claims: parsed,
      bound: true,
      binding_reason: "schema + run binding hold (contents still untrusted)"
    });
  }
  return out;
}
function loadVerifiedCatalogSnapshot(root, runId, sessionContext) {
  const sc = sessionContext;
  const target = sc?.["execution_target"];
  const host = sc?.["host"];
  if (!target || !host) {
    return { snapshot: null, note: "no execution target on the session context - catalog unbound" };
  }
  let key;
  try {
    key = createCacheKey(
      {
        target_id: String(target.target_id ?? "unknown"),
        family: String(host.family ?? "unknown"),
        surface: String(host.surface ?? "unknown"),
        provider_kind: String(target.provider_kind ?? "unknown"),
        auth_mode: String(target.auth_mode ?? "unknown"),
        account_fingerprint: String(target.account_fingerprint ?? "unknown"),
        endpoint_fingerprint: String(target.endpoint_fingerprint ?? "unknown"),
        org_fingerprint: String(target.org_fingerprint ?? "unknown"),
        tool_version: String(target.tool_version ?? "unknown"),
        adapter_id: String(host.adapter_id ?? "unknown"),
        adapter_version: String(host.adapter_version ?? "unknown")
      },
      runId
    );
  } catch (err) {
    return {
      snapshot: null,
      note: "catalog cache identity could not be constructed: " + err.message
    };
  }
  const entry = readJson2(path30.join(modelCatalogCacheDir(root), key.hash + ".json"));
  if (entry === null) {
    return { snapshot: null, note: "no catalog cache entry for this run's target identity" };
  }
  if (entry["schema_version"] !== MODEL_CATALOG_SCHEMA_VERSION) {
    return {
      snapshot: null,
      note: "catalog cache entry is not a " + MODEL_CATALOG_SCHEMA_VERSION + " snapshot - ignored"
    };
  }
  return { snapshot: entry, note: null };
}
function loadVerifiedSources(root, runId) {
  const notes = [];
  const session_context = loadSessionContext(root, runId);
  if (session_context === null) {
    notes.push(
      "no verified guild.session_context.v1 record for this run - identity, host and target are honest unknowns"
    );
  }
  const { snapshot, note } = loadVerifiedCatalogSnapshot(root, runId, session_context);
  if (note !== null) notes.push(note);
  notes.push(
    "policy / resolution receipt / \xA77a adjudication have no verified reader in this module yet - they are rendered as honest unknowns rather than copied from a persisted report"
  );
  return { session_context, catalog_snapshot: snapshot, notes };
}
function loadRoutingFlags(root) {
  const p = path30.join(durableGuildDir(root), "settings.json");
  const settings = readJson2(p);
  if (settings === null) {
    const { flags: flags2, rejects: rejects2 } = readRoutingFlags(null);
    return { flags: flags2, source: "defaults (no .guild/settings.json)", rejects: rejects2 };
  }
  const { flags, rejects } = readRoutingFlags(settings);
  return { flags, source: ".guild/settings.json", rejects };
}
function shortHash(h) {
  return typeof h === "string" && h.length >= 12 ? h.slice(0, 12) : "unknown";
}
function fingerprint(value) {
  return crypto9.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}
function reject(rejections, field, category, value) {
  rejections.push({ field, category });
  return "<REJECTED:" + category + ":" + fingerprint(value) + ">";
}
function safeToken(v, field, rejections) {
  if (v === null || v === void 0 || v === "") return "unknown";
  if (typeof v !== "string") return reject(rejections, field, "non-string", String(v));
  if (!DISPLAY_TOKEN_RE.test(v)) return reject(rejections, field, "not-a-display-token", v);
  return v;
}
function safeIdentity(v, field, rejections) {
  if (v === null || v === void 0 || v === "") return "unknown";
  if (typeof v !== "string") return reject(rejections, field, "non-string", String(v));
  if (!DISPLAY_TOKEN_RE.test(v)) return reject(rejections, field, "not-a-display-token", v);
  if (REVERSIBLE_IDENTITY_RE.test(v)) {
    return reject(rejections, field, "reversible-identity", v);
  }
  return v;
}
function safeText(v, field, rejections) {
  if (v === null || v === void 0 || v === "") return "unknown";
  if (typeof v !== "string") return reject(rejections, field, "non-string", String(v));
  if (v.length > FREE_TEXT_MAX) return reject(rejections, field, "oversized", v);
  if (CONTROL_CHAR_RE.test(v)) return reject(rejections, field, "control-characters", v);
  const scan = redact(v);
  if (scan.secrets.length > 0) {
    return reject(rejections, field, scan.secrets[0].category.replace(/\s+/g, "-"), v);
  }
  if (scan.opPaths > 0) return reject(rejections, field, "private-path", v);
  return v;
}
function safeBool(v) {
  return v === true;
}
function safeNumeric(v, field, rejections) {
  if (v === null || v === void 0) return "unknown";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return String(v);
  return reject(rejections, field, "non-numeric", String(v));
}
function buildEntryView(report, origin, label) {
  const cat = report.catalog;
  const r = [];
  const f = (name) => label + "." + name;
  const entry = {
    origin,
    label: safeToken(label, "label", r),
    untrusted_divergence: [],
    run_id: safeToken(report.run_id, f("run_id"), r),
    host: {
      family: safeToken(report.host?.family, f("host.family"), r),
      surface: safeToken(report.host?.surface, f("host.surface"), r)
    },
    identity: {
      source: safeToken(report.identity?.source, f("identity.source"), r),
      trust: safeToken(report.identity?.trust, f("identity.trust"), r),
      confidence: safeToken(report.identity?.confidence, f("identity.confidence"), r),
      evidence: safeText(report.identity?.evidence, f("identity.evidence"), r)
    },
    target: {
      target_id: safeIdentity(report.target?.target_id, f("target.target_id"), r),
      provider_kind: safeToken(report.target?.provider_kind, f("target.provider_kind"), r),
      auth_mode: safeToken(report.target?.auth_mode, f("target.auth_mode"), r)
    },
    catalog: {
      state: safeToken(cat?.state, f("catalog.state"), r),
      target_id: safeIdentity(cat?.target_id, f("catalog.target_id"), r),
      discovered_at: safeToken(cat?.discovered_at, f("catalog.discovered_at"), r),
      age_seconds: safeNumeric(cat?.age_seconds, f("catalog.age_seconds"), r),
      ttl_seconds: safeNumeric(cat?.ttl_seconds, f("catalog.ttl_seconds"), r),
      stale: safeNumeric(cat?.stale, f("catalog.stale"), r),
      generation: safeNumeric(cat?.generation, f("catalog.generation"), r),
      models: (cat?.models ?? []).map((m, i) => ({
        canonical_id: safeToken(m?.canonical_id, f("catalog.models[" + i + "].canonical_id"), r),
        tier: safeToken(m?.tier, f("catalog.models[" + i + "].tier"), r),
        evidence_state: safeToken(
          m?.evidence_state,
          f("catalog.models[" + i + "].evidence_state"),
          r
        )
      }))
    },
    policy: {
      present: safeBool(report.policy?.present),
      policy_hash_short: shortHash(report.policy?.policy_hash),
      rule_path: report.policy?.rule_path === null || report.policy?.rule_path === void 0 ? "unknown" : report.policy.rule_path.map((step, i) => safeToken(step, f("policy.rule_path[" + i + "]"), r)).join(" > ") || "none"
    },
    selection: {
      model: safeToken(report.selection?.model, f("selection.model"), r),
      effort: safeToken(report.selection?.effort, f("selection.effort"), r),
      evidence_state: safeToken(report.selection?.evidence_state, f("selection.evidence_state"), r)
    },
    fallbacks: {
      chain_length: report.fallbacks === null || report.fallbacks === void 0 ? "unknown" : String(report.fallbacks.chain.length),
      fallback_hash_short: shortHash(report.fallbacks?.fallback_hash)
    },
    outcome: {
      finalized: safeBool(report.outcome?.finalized),
      status: safeToken(report.outcome?.status, f("outcome.status"), r),
      actual_model: safeToken(report.outcome?.actual_model, f("outcome.actual_model"), r)
    },
    independence: {
      adjudicated: safeBool(report.independence?.adjudicated),
      independence: safeToken(report.independence?.independence, f("independence.verdict"), r),
      note: safeText(report.independence?.note, f("independence.note"), r)
    },
    degradation: {
      kind: safeToken(report.degradation?.kind, f("degradation.kind"), r),
      note: safeText(report.degradation?.note, f("degradation.note"), r)
    },
    unknowns: (report.unknowns ?? []).map((u, i) => safeToken(u, f("unknowns[" + i + "]"), r))
  };
  return { entry, rejected: r };
}
function divergentClaims(claims, rebuilt) {
  const out = [];
  const cmp = (field, a, b) => {
    if (a === void 0) return;
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push(field);
  };
  cmp("identity.trust", claims.identity?.trust, rebuilt.identity.trust);
  cmp("target.target_id", claims.target?.target_id, rebuilt.target.target_id);
  cmp("catalog.state", claims.catalog?.state, rebuilt.catalog.state);
  cmp("selection.model", claims.selection?.model ?? void 0, rebuilt.selection?.model);
  cmp("outcome.finalized", claims.outcome?.finalized, rebuilt.outcome.finalized);
  cmp("outcome.actual_model", claims.outcome?.actual_model, rebuilt.outcome.actual_model);
  cmp(
    "independence.adjudicated",
    claims.independence?.adjudicated,
    rebuilt.independence.adjudicated
  );
  cmp(
    "independence.verdict",
    claims.independence?.independence,
    rebuilt.independence.independence
  );
  return out;
}
function renderInspectView(view) {
  const L = [];
  L.push("guild models inspect - READ-ONLY (no artifact was written)");
  L.push("run: " + view.run_id + " (run id resolved from: " + view.run_id_source + ")");
  L.push("");
  const sb = view.session_binding;
  L.push("SESSION BINDING  (guild.session_binding.v1 - the authority for this run)");
  if (sb === null) {
    L.push("  not bound - this run has no session binding on record.");
    L.push("  Guild does not fall back to a default host: start a /guild session to bind one.");
  } else {
    L.push("  host_family=" + sb.host_family + " model_family=" + sb.model_family + " surface=" + sb.surface);
    L.push("  detected_at=" + sb.detected_at);
    L.push("  prompt_compose  " + sb.dialect_id + " hash=" + sb.prompt_compose_hash.slice(0, 16));
    L.push(
      "  tiers           " + (Object.keys(sb.models).length === 0 ? "(none - no tier map was bound; an unknown host gets none by design, never Claude defaults)" : Object.entries(sb.models).map(([t, m]) => t + "=" + m).join(" "))
    );
    L.push(
      "  evidence        cheap=" + sb.evidence.cheap + " mid=" + sb.evidence.mid + " powerful=" + sb.evidence.powerful
    );
  }
  L.push("");
  L.push("ROLLOUT FLAGS  source=" + view.flags.source);
  for (const f of view.flags.values) L.push("  " + f.key + " = " + f.value);
  for (const r of view.flags.rejects) L.push("  REJECTED: " + r);
  for (const n of view.notes) L.push("note: " + n);
  for (const e of view.entries) {
    L.push("");
    L.push("--- " + e.label + "  (" + e.origin + ")");
    if (e.untrusted_divergence.length > 0) {
      L.push(
        "  UNTRUSTED CLAIM(S) NOT SUPPORTED BY VERIFIED ARTIFACTS: " + e.untrusted_divergence.join(", ")
      );
      L.push(
        "              (the persisted report asserted these; the rows below are the REBUILT truth)"
      );
    }
    L.push("  host        family=" + e.host.family + " surface=" + e.host.surface);
    L.push(
      "  identity    source=" + e.identity.source + " trust=" + e.identity.trust + " confidence=" + e.identity.confidence
    );
    L.push("              evidence: " + e.identity.evidence);
    L.push(
      "  target      " + e.target.target_id + " provider_kind=" + e.target.provider_kind + " auth_mode=" + e.target.auth_mode
    );
    L.push(
      "  catalog     state=" + e.catalog.state + " target=" + e.catalog.target_id + " age_s=" + e.catalog.age_seconds + " ttl_s=" + e.catalog.ttl_seconds + " stale=" + e.catalog.stale + " generation=" + e.catalog.generation
    );
    if (e.catalog.models.length === 0) {
      L.push("              models: none on record");
    } else {
      for (const m of e.catalog.models) {
        L.push(
          "              model " + m.canonical_id + " tier=" + m.tier + " evidence=" + m.evidence_state
        );
      }
    }
    L.push(
      "  policy      present=" + e.policy.present + " hash=" + e.policy.policy_hash_short + " rule_path=" + e.policy.rule_path
    );
    L.push(
      "  selection   model=" + e.selection.model + " effort=" + e.selection.effort + " evidence=" + e.selection.evidence_state
    );
    L.push(
      "  fallbacks   chain=" + e.fallbacks.chain_length + " hash=" + e.fallbacks.fallback_hash_short
    );
    L.push(
      "  outcome     finalized=" + e.outcome.finalized + " status=" + e.outcome.status + " actual_model=" + e.outcome.actual_model
    );
    L.push(
      "  independence adjudicated=" + e.independence.adjudicated + " verdict=" + e.independence.independence
    );
    L.push("              " + e.independence.note);
    L.push("  degradation kind=" + e.degradation.kind + " - " + e.degradation.note);
    L.push(
      "  UNKNOWNS    " + (e.unknowns.length === 0 ? "none" : e.unknowns.join(", "))
    );
  }
  if (view.display_rejections.length > 0) {
    L.push("");
    L.push("DISPLAY VALIDATOR REFUSED " + view.display_rejections.length + " FIELD(S)");
    for (const d of view.display_rejections) {
      L.push("  " + d.field + ": " + d.category);
    }
    L.push("  (the value itself was never printed - only a one-way fingerprint marks its place)");
  }
  L.push("");
  L.push("Honest-unknown contract: a field printed as `unknown` was NOT bindable from evidence.");
  L.push("Every row above is REBUILT from self-verifying artifacts; a persisted inspection report");
  L.push("is an untrusted pointer, never a source of claims. No secret is ever displayed.");
  return L.join("\n") + "\n";
}
function safeEmit(rendered) {
  const result2 = redact(rendered);
  const findings = [
    ...result2.secrets.map((s) => "secret-pattern " + s.category + " at line " + s.line),
    ...result2.opPaths > 0 ? ["operator path x" + result2.opPaths] : []
  ];
  return { out: result2.out, clean: findings.length === 0, findings };
}
function readBindingView(cwd, runId) {
  const storage = createGuildStorage(cwd);
  const scoped = storage.project ?? storage.workspace;
  if (!scoped) return null;
  const b = readSessionBinding(scoped.runRecord(runId));
  if (b === null) return null;
  return {
    host_family: b.host_family,
    model_family: b.model_family,
    surface: b.surface,
    detected_at: b.detected_at,
    prompt_compose_hash: b.prompt_compose?.hash ?? "",
    dialect_id: b.prompt_compose?.dialect_id ?? "dialect:none",
    evidence: b.evidence,
    models: Object.fromEntries(
      Object.entries(b.models ?? {}).filter(([, v]) => typeof v === "string")
    )
  };
}
function runModelsCommand(argv, deps = {}) {
  const d = resolveDeps(deps);
  const parsed = parseModelsArgs(argv);
  if ("error" in parsed) {
    d.stderr(parsed.error + "\n" + MODELS_COMMAND_USAGE + "\n");
    return 1;
  }
  const { cwd, runId: explicitRunId, json } = parsed;
  let runId = explicitRunId;
  let runIdSource = "--run-id (explicit)";
  if (runId === null) {
    const candidate = d.candidateRunId(cwd);
    if (candidate === null) {
      d.stderr(
        "cannot resolve a run to inspect: no --run-id was given and no intake candidate run id is on record. Pass --run-id <id>.\n"
      );
      return 2;
    }
    runId = candidate.run_id;
    runIdSource = "intake candidate (" + candidate.source + ") - confirm it is the run you mean";
  }
  const notes = [];
  const { flags, source: flagSource, rejects } = loadRoutingFlags(cwd);
  const sources = loadVerifiedSources(cwd, runId);
  notes.push(...sources.notes);
  const now = d.now();
  const rebuild = () => buildModelInspection({
    session_context: sources.session_context,
    catalog_snapshot: sources.catalog_snapshot,
    policy: null,
    receipt: null,
    adjudication: null,
    flags,
    now
  });
  const persisted = loadPersistedInspections(cwd, runId);
  const entries = [];
  const display_rejections = [];
  if (persisted.length > 0) {
    for (const p of persisted) {
      if (!p.bound) {
        notes.push(
          'persisted inspection artifact for label "' + p.label + '" was NOT accepted as a pointer (' + p.binding_reason + ") - no row is shown for it"
        );
        continue;
      }
      const report = rebuild();
      const { entry, rejected } = buildEntryView(
        report,
        "REBUILT from verified artifacts (persisted report untrusted)",
        p.label
      );
      entry.untrusted_divergence = divergentClaims(p.claims, report);
      if (entry.untrusted_divergence.length > 0) {
        notes.push(
          'persisted report "' + p.label + '" asserts claim(s) the verified artifacts do not support: ' + entry.untrusted_divergence.join(", ") + " - the rebuilt values are shown"
        );
      }
      entries.push(entry);
      display_rejections.push(...rejected);
    }
  }
  if (entries.length === 0) {
    notes.push(
      "no usable persisted M0 inspection pointer under .guild/runs/" + runId + "/inspection/ - built a single live report from the run's verified artifacts"
    );
    const { entry, rejected } = buildEntryView(
      rebuild(),
      "live (inspect-only; nothing persisted)",
      "live"
    );
    entries.push(entry);
    display_rejections.push(...rejected);
  }
  const view = {
    schema_version: "guild.model_inspection_view.v1",
    generated_at: d.now(),
    cwd,
    run_id: runId,
    run_id_source: runIdSource,
    flags: {
      source: flagSource,
      values: ROUTING_FLAG_KEYS.map((k) => ({ key: k, value: flags[k] })),
      rejects
    },
    entries,
    notes,
    display_rejections,
    session_binding: readBindingView(cwd, runId)
  };
  const rendered = json ? JSON.stringify(view, null, 2) + "\n" : renderInspectView(view);
  const emit = safeEmit(rendered);
  d.stdout(emit.out);
  if (display_rejections.length > 0) {
    d.stderr(
      "models inspect FAILED CLOSED: the display validator refused " + display_rejections.length + " field(s) - " + display_rejections.map((x) => x.field + " (" + x.category + ")").join("; ") + "\n"
    );
    return 3;
  }
  if (!emit.clean) {
    d.stderr(
      "models inspect FAILED CLOSED: the rendered report tripped the canonical redaction applier and the REDACTED form was printed - " + emit.findings.join("; ") + "\n"
    );
    return 3;
  }
  return 0;
}
var crypto9, fs25, path30, MODELS_COMMAND_USAGE, DISPLAY_TOKEN_RE, REVERSIBLE_IDENTITY_RE, CONTROL_CHAR_RE, FREE_TEXT_MAX;
var init_models_command = __esm({
  "src/domains/config/models-command.ts"() {
    crypto9 = __toESM(require("crypto"));
    fs25 = __toESM(require("fs"));
    path30 = __toESM(require("path"));
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
    DISPLAY_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/;
    REVERSIBLE_IDENTITY_RE = /:\/\/|@|\b\d{1,3}(?:\.\d{1,3}){3}\b|\.(?:com|net|org|io|ai|dev|app|cloud|internal|local)\b/i;
    CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/;
    FREE_TEXT_MAX = 240;
  }
});

// src/domains/config/inspection-record.ts
function recordRunInspectionEvidence(input) {
  const { root, binding, now } = input;
  const label = input.label ?? DEFAULT_INSPECTION_LABEL;
  const { flags } = loadRoutingFlags(root);
  const v2OptedIn = flags["model_routing.shadow"] === "on" || flags["model_routing.enabled"] === "on";
  if (!v2OptedIn) {
    return {
      recorded: false,
      ref: null,
      absPath: null,
      reason: "v2 routing is not opted in (model_routing.shadow and model_routing.enabled are both off) \u2014 M0 defaults record no inspection evidence and the dispatch path is unchanged",
      notes: []
    };
  }
  if (flags["model_routing.inspect"] !== "on") {
    return {
      recorded: false,
      ref: null,
      absPath: null,
      reason: "model_routing.inspect is off \u2014 the inspection surface is rolled back, so no report is built or recorded",
      notes: []
    };
  }
  const sources = loadVerifiedSources(root, binding.run_id);
  if (sources.session_context === null) {
    return {
      recorded: false,
      ref: null,
      absPath: null,
      reason: `no verified guild.session_context.v1 record for run ${binding.run_id} \u2014 refusing to record an inspection report with an unknown identity`,
      notes: sources.notes
    };
  }
  const report = buildModelInspection({
    session_context: sources.session_context,
    catalog_snapshot: sources.catalog_snapshot,
    // Policy / receipt / §7a adjudication have no verified reader in this
    // module (see loadVerifiedSources) — they stay honest unknowns rather than
    // being copied from anywhere untrusted.
    policy: null,
    receipt: null,
    adjudication: null,
    flags,
    now
  });
  if (report.state !== "ok") {
    return {
      recorded: false,
      ref: null,
      absPath: null,
      reason: `inspection report came back state "${report.state}" \u2014 not recorded as evidence`,
      notes: sources.notes
    };
  }
  const written = persistInspectionReport({ root, report, binding, label });
  return {
    recorded: true,
    ref: written.ref,
    absPath: written.absPath,
    reason: `recorded M0 inspection evidence for run ${binding.run_id} under label "${label}" (catalog ${report.catalog.state})`,
    notes: sources.notes
  };
}
var DEFAULT_INSPECTION_LABEL;
var init_inspection_record = __esm({
  "src/domains/config/inspection-record.ts"() {
    init_model_inspect();
    init_inspection_persist();
    init_models_command();
    DEFAULT_INSPECTION_LABEL = "dispatch";
  }
});

// src/domains/config/policy-migration.ts
function legacyModelFor(legacyTiers, tier) {
  const v = legacyTiers?.[tier];
  if (typeof v === "string" && v.length > 0) return v;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const hostValue of Object.values(v)) {
      if (typeof hostValue === "string" && hostValue.length > 0) return hostValue;
    }
  }
  return null;
}
function findRoute(policy, purpose, complexity) {
  const routes = policy?.purposes?.[purpose]?.routes;
  if (!Array.isArray(routes)) return null;
  for (const r of routes) {
    if (r && (r.complexity === complexity || r.complexity === "any")) return r;
  }
  return null;
}
function resolveWithLegacy(input) {
  const { purpose, effective_complexity } = input;
  const tier = tierForComplexity(effective_complexity);
  const legacyModel = legacyModelFor(input.legacy_tiers, tier);
  const conflicts = [];
  const guidance = [];
  const v2Route = findRoute(input.v2_policy, purpose, effective_complexity);
  if (v2Route) {
    if (legacyModel) {
      conflicts.push({
        purpose,
        effective_complexity,
        tier,
        v2_selectors: (v2Route.preferred ?? []).map((s) => s.selector),
        legacy_model: legacyModel
      });
      guidance.push(
        `legacy models.tiers.${tier} ("${legacyModel}") is shadowed by the explicit v2 model_policy for ${purpose}/${effective_complexity}; remove the legacy key before the migration window closes`
      );
    }
    return { source: "v2_policy", route: v2Route, conflicts, guidance };
  }
  const isGeneric = LEGACY_FILLABLE_PURPOSES.includes(purpose);
  if (isGeneric && legacyModel) {
    guidance.push(
      `legacy models.tiers.${tier} fills the unset generic ${purpose}/${effective_complexity} preference for the migration window only; migrate it to model_policy.purposes.${purpose}`
    );
    return {
      source: "legacy",
      route: {
        complexity: effective_complexity,
        preferred: [{ selector: `id:${legacyModel}`, effort: null, capabilities: [] }],
        fallbacks: [],
        provider_default: "forbid"
      },
      conflicts,
      guidance
    };
  }
  if (!isGeneric && legacyModel) {
    guidance.push(
      `legacy models.tiers.${tier} is IGNORED for ${purpose} \u2014 legacy maps never bind research/review/security purposes (\xA76)`
    );
  }
  const baselineRoute = findRoute(OPERATOR_BASELINE_POLICY, purpose, effective_complexity);
  return { source: "baseline_default", route: baselineRoute, conflicts, guidance };
}
function migrationPreview(input) {
  const settingsPath = path31.join(durableGuildDir(input.root), "settings.json");
  let parsed = {};
  if (fs26.existsSync(settingsPath)) {
    try {
      const raw = JSON.parse(fs26.readFileSync(settingsPath, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        parsed = raw;
      }
    } catch {
      parsed = {};
    }
  }
  const models = parsed["models"];
  const legacyTiers = models && typeof models === "object" && !Array.isArray(models) ? models["tiers"] : void 0;
  const v2Policy = parsed["model_policy"];
  const conflicts = [];
  const guidance = [];
  const proposed = JSON.parse(
    JSON.stringify(OPERATOR_BASELINE_POLICY)
  );
  for (const purpose of LEGACY_FILLABLE_PURPOSES) {
    for (const complexity of ["easy", "medium", "hard"]) {
      const resolved = resolveWithLegacy({
        v2_policy: v2Policy,
        legacy_tiers: legacyTiers,
        purpose,
        effective_complexity: complexity
      });
      conflicts.push(...resolved.conflicts);
      guidance.push(...resolved.guidance);
      if (resolved.source === "legacy" && resolved.route) {
        const purposeBlock = proposed.purposes[purpose];
        if (purposeBlock) {
          const idx = purposeBlock.routes.findIndex(
            (r) => r.complexity === complexity || r.complexity === "any"
          );
          if (idx >= 0) purposeBlock.routes[idx] = resolved.route;
        }
      }
    }
  }
  return {
    proposed_model_policy: proposed,
    legacy_sources: legacyTiers ? { "models.tiers": legacyTiers } : {},
    conflicts,
    guidance,
    writes_performed: false
  };
}
var fs26, path31, LEGACY_FILLABLE_PURPOSES;
var init_policy_migration = __esm({
  "src/domains/config/policy-migration.ts"() {
    fs26 = __toESM(require("fs"));
    path31 = __toESM(require("path"));
    init_model_policy();
    init_state();
    LEGACY_FILLABLE_PURPOSES = Object.freeze(["general", "implementation"]);
  }
});

// src/domains/config/purpose-provenance.ts
function isComplexity(v) {
  return COMPLEXITIES.includes(v);
}
function purposeForWorkClass(workClass) {
  return POLICY_PURPOSES.includes(workClass) ? workClass : null;
}
function resolveEffectivePurpose(input) {
  const events = input?.events;
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("purpose_unbound: empty dispatch chain \u2014 no authoritative purpose metadata");
  }
  const root = events[0];
  if (root.kind !== "dispatch") {
    throw new Error(
      `purpose_unbound: chain root must be an authoritative dispatch (got kind "${root.kind}")`
    );
  }
  const source = typeof root.source === "string" ? root.source : "";
  if (!AUTHORITATIVE_PURPOSE_SOURCES.includes(source)) {
    throw new Error(
      `purpose_unbound: dispatch source "${source || "<absent>"}" is not an authoritative purpose source (${AUTHORITATIVE_PURPOSE_SOURCES.join(", ")}) \u2014 refusing to default to general work`
    );
  }
  const boundLabel = typeof root.work_class === "string" ? root.work_class : typeof root.purpose === "string" ? root.purpose : null;
  if (boundLabel === null) {
    throw new Error(
      `purpose_unbound: authoritative source "${source}" carries no work_class/purpose binding`
    );
  }
  const purpose = purposeForWorkClass(boundLabel);
  if (purpose === null) {
    throw new Error(
      `purpose_unbound: work_class "${boundLabel}" is outside the closed purpose enum \u2014 fail closed`
    );
  }
  const requested = isComplexity(root.complexity) ? root.complexity : "easy";
  let floor = maxComplexity(requested, purposeComplexityFloor(purpose));
  const rejected = [];
  const ancestry = [`dispatch:0:${source}`];
  for (let i = 1; i < events.length; i++) {
    const ev = events[i];
    ancestry.push(`${ev.kind}:${i}`);
    if (isComplexity(ev.raises_floor)) {
      floor = maxComplexity(floor, ev.raises_floor);
    }
    if (typeof ev.declared_purpose === "string" && ev.declared_purpose !== purpose) {
      rejected.push({
        source: `${ev.kind}:${i}`,
        label: `purpose=${ev.declared_purpose}`,
        reason: "inherited_purpose_non_downgradable"
      });
    }
    const label = ev.caller_label;
    if (label && typeof label === "object") {
      const labelPurpose = label["purpose"];
      if (typeof labelPurpose === "string" && labelPurpose !== purpose) {
        rejected.push({
          source: `${ev.kind}:${i}`,
          label: `purpose=${labelPurpose}`,
          reason: "inherited_purpose_non_downgradable"
        });
      }
      const labelComplexity = label["complexity"];
      if (isComplexity(labelComplexity)) {
        if (COMPLEXITY_RANK[labelComplexity] < COMPLEXITY_RANK[floor]) {
          rejected.push({
            source: `${ev.kind}:${i}`,
            label: `complexity=${labelComplexity}`,
            reason: "floor_non_downgradable"
          });
        } else {
          floor = maxComplexity(floor, labelComplexity);
        }
      }
    }
  }
  const effective = floor;
  const tierFloor = purposeTierFloor(purpose);
  const tier = tierFloor === "powerful" ? "powerful" : tierForComplexity(effective);
  const forcedFloorReason = purpose === "research" ? "research_always_hard" : isReviewClassPurpose(purpose) ? "purpose_floor_powerful" : null;
  return {
    purpose,
    requested_complexity: requested,
    effective_complexity: effective,
    tier,
    forced_floor_reason: forcedFloorReason,
    purpose_origin: source,
    dispatch_ancestry: ancestry,
    rejected_labels: rejected
  };
}
var AUTHORITATIVE_PURPOSE_SOURCES, COMPLEXITY_RANK;
var init_purpose_provenance = __esm({
  "src/domains/config/purpose-provenance.ts"() {
    init_model_policy();
    AUTHORITATIVE_PURPOSE_SOURCES = Object.freeze([
      "skill_metadata",
      "registry_metadata",
      "lane_lock",
      "broker_gate"
    ]);
    COMPLEXITY_RANK = { easy: 0, medium: 1, hard: 2 };
  }
});

// src/domains/config/tier-defaults.ts
function tierForModel(model) {
  if (!model) return null;
  const m = model.toLowerCase();
  for (const tier of ["powerful", "mid", "cheap"]) {
    if (m.includes(CLAUDE_TIER_FALLBACK[tier])) return tier;
  }
  return null;
}
function tierDefaults(descriptors = HOST_REGISTRY_ROWS) {
  const result2 = {};
  for (const [hk, registryId] of Object.entries(HOSTKIND_TO_REGISTRY_ID)) {
    const row = registryId !== null ? descriptors[registryId] : void 0;
    if (!row) {
      result2[hk] = { ...CLAUDE_TIER_FALLBACK };
      continue;
    }
    result2[hk] = {
      cheap: row.capabilities?.models?.cheap?.model ?? null,
      mid: row.capabilities?.models?.mid?.model ?? null,
      powerful: row.capabilities?.models?.powerful?.model ?? null
    };
  }
  return result2;
}
function tierDefaultsForHost(host, descriptors = HOST_REGISTRY_ROWS) {
  const computed = tierDefaults(descriptors);
  return computed[host] ?? { ...CLAUDE_TIER_FALLBACK };
}
function defaultTierModels(descriptors = HOST_REGISTRY_ROWS) {
  const row = descriptors["claude-code-cli"];
  return {
    cheap: row?.capabilities?.models?.cheap?.model ?? CLAUDE_TIER_FALLBACK.cheap,
    mid: row?.capabilities?.models?.mid?.model ?? CLAUDE_TIER_FALLBACK.mid,
    powerful: row?.capabilities?.models?.powerful?.model ?? CLAUDE_TIER_FALLBACK.powerful
  };
}
function defaultTiersMap(descriptors = HOST_REGISTRY_ROWS) {
  const hostMap = Object.entries(HOSTKIND_TO_REGISTRY_ID);
  const tiers = ["cheap", "mid", "powerful"];
  const result2 = {};
  for (const tier of tiers) {
    result2[tier] = {};
    for (const [hk, registryId] of hostMap) {
      const row = registryId !== null ? descriptors[registryId] : void 0;
      const model = row?.capabilities?.models?.[tier]?.model ?? null;
      result2[tier][hk] = model;
    }
  }
  return result2;
}
var CLAUDE_TIER_FALLBACK;
var init_tier_defaults = __esm({
  "src/domains/config/tier-defaults.ts"() {
    init_host_registry_schema();
    init_host_id_namespace();
    CLAUDE_TIER_FALLBACK = {
      cheap: "haiku",
      mid: "sonnet",
      powerful: "opus"
    };
  }
});

// src/domains/config/rank.ts
function isClaudeHost(hostKind) {
  return hostKindToRegistryId(hostKind)?.startsWith("claude-") ?? false;
}
function isCodexHost(hostKind) {
  return hostKindToRegistryId(hostKind)?.startsWith("codex-") ?? false;
}
function isClaudeCli(hostKind) {
  return hostKindToRegistryId(hostKind) === "claude-code-cli";
}
function isCodexCli(hostKind) {
  return hostKindToRegistryId(hostKind) === "codex-cli";
}
function isPiCli(hostKind) {
  return hostKindToRegistryId(hostKind) === "pi-cli";
}
function isAntigravityCli(hostKind) {
  return hostKindToRegistryId(hostKind) === "antigravity-cli";
}
function affinityBoost(workType, hostKind) {
  switch (workType) {
    case "interactive_lifecycle":
      return isClaudeHost(hostKind) ? AFFINITY_BOOST : 0;
    case "adversarial_review":
      return !isClaudeHost(hostKind) ? AFFINITY_BOOST : 0;
    case "background_implementation":
      return isCodexHost(hostKind) ? AFFINITY_BOOST : 0;
    case "parallel_local_lanes":
      return isClaudeHost(hostKind) ? AFFINITY_BOOST : 0;
    case "graph_extraction":
    case void 0:
    default:
      return 0;
  }
}
function rankScore(host, lane) {
  let s = 0;
  if (lane.preferredHostKind && host.host_kind === lane.preferredHostKind) s += 100;
  s += affinityBoost(lane.workType, host.host_kind);
  return s;
}
function backendForMode(mode) {
  switch (mode) {
    case "team":
      return "agent_team";
    case "agent":
      return "independent_agents";
    case "subagent":
      return "subagent";
    case "auto":
    default:
      return null;
  }
}
function getDefaultModelTierMap(host) {
  return tierDefaultsForHost(host);
}
var AFFINITY_BOOST;
var init_rank = __esm({
  "src/domains/config/rank.ts"() {
    init_host_id_namespace();
    init_tier_defaults();
    AFFINITY_BOOST = 10;
  }
});

// src/domains/config/role-model-schema.ts
function isHostCapable(e) {
  return e.installability !== "none" && e.dispatch_selectable;
}
function resolveRoles(input) {
  const avail = input.available;
  const hostEntry = avail.find(isHostCapable) ?? null;
  const host = hostEntry ? {
    role: "host",
    substrate: hostEntry.host_id,
    strength: "strong",
    reason: `strongest installable+dispatch_selectable substrate (${hostEntry.host_id})`
  } : {
    role: "host",
    substrate: null,
    strength: "weak",
    reason: "no installable+dispatch_selectable substrate available"
  };
  const advisoryEntry = avail.find((e) => e.dispatch_selectable) ?? hostEntry;
  const advisory = advisoryEntry ? {
    role: "advisory",
    substrate: advisoryEntry.host_id,
    strength: "strong",
    reason: advisoryEntry === hostEntry ? `advisory defaults to the host substrate (${advisoryEntry.host_id}, local advisor)` : `strongest dispatch_selectable advisory substrate (${advisoryEntry.host_id})`
  } : {
    role: "advisory",
    substrate: null,
    strength: "weak",
    reason: "no dispatch_selectable advisory substrate available"
  };
  const hostFamily = hostEntry?.family ?? null;
  const diffFamily = avail.find((e) => e.result_adapter && e.family !== hostFamily) ?? null;
  const sameFamily = avail.find((e) => e.result_adapter && e.family === hostFamily) ?? null;
  let adversarial;
  if (diffFamily) {
    adversarial = {
      role: "adversarial",
      substrate: diffFamily.host_id,
      strength: "strong",
      reason: `different-family result_adapter substrate (${diffFamily.host_id}) \u2014 cross-host independence`
    };
  } else if (sameFamily) {
    adversarial = {
      role: "adversarial",
      substrate: sameFamily.host_id,
      strength: "weak",
      reason: `only a same-family result_adapter (${sameFamily.host_id}) \u2014 independence lost (weak)`
    };
  } else {
    adversarial = {
      role: "adversarial",
      substrate: null,
      strength: "weak",
      reason: "no result_adapter substrate available \u2014 adversarial review degrades"
    };
  }
  return {
    schema_version: "guild.role_resolution.v1",
    host,
    advisory,
    adversarial
  };
}
function validateRoleResolution(x, expectedRole, errors) {
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    errors.push(`${expectedRole} must be a present object`);
    return;
  }
  const r = x;
  if (r["role"] !== expectedRole || !ROLE_SET.has(r["role"])) {
    errors.push(`${expectedRole}.role must be "${expectedRole}"; got ${JSON.stringify(r["role"])}`);
  }
  if (!(r["substrate"] === null || typeof r["substrate"] === "string" && HOST_ID_SET3.has(r["substrate"]))) {
    errors.push(
      `${expectedRole}.substrate must be one of ${HOST_IDS.join("|")} or null; got ${JSON.stringify(r["substrate"])}`
    );
  }
  if (typeof r["strength"] !== "string" || !STRENGTH_SET.has(r["strength"])) {
    errors.push(`${expectedRole}.strength must be strong|weak; got ${JSON.stringify(r["strength"])}`);
  }
  if (typeof r["reason"] !== "string" || r["reason"].trim() === "") {
    errors.push(`${expectedRole}.reason must be a non-empty string`);
  }
}
function validateRoleResolutionSet(value) {
  const errors = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["role resolution set must be a non-null object"] };
  }
  const o = value;
  if (o["schema_version"] !== "guild.role_resolution.v1") {
    errors.push(
      `schema_version must be "guild.role_resolution.v1"; got ${JSON.stringify(o["schema_version"])}`
    );
  }
  validateRoleResolution(o["host"], "host", errors);
  validateRoleResolution(o["advisory"], "advisory", errors);
  validateRoleResolution(o["adversarial"], "adversarial", errors);
  return { valid: errors.length === 0, errors };
}
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
function availableRegistryRows(detection) {
  const families = /* @__PURE__ */ new Set();
  if (detection.authorHost && detection.authorHost !== "unknown") {
    families.add(detection.authorHost);
  }
  for (const p of detection.providers) {
    if (p.selectable || p.detected && p.kind !== "host") families.add(p.family);
  }
  return HOST_IDS.map((id) => HOST_REGISTRY_ROWS[id]).filter((row) => families.has(row.family));
}
function resolveRolesForRun(detection) {
  const roles = resolveRoles({ available: availableRegistryRows(detection) });
  if (detection.authorTrust !== "verified" && roles.adversarial.strength === "strong") {
    return {
      ...roles,
      adversarial: {
        ...roles.adversarial,
        strength: "weak",
        reason: `${roles.adversarial.reason}; DOWNGRADED to weak \u2014 author host identity is not verified (trust: ${detection.authorTrust ?? "absent"}), so cross-family independence is unprovable (session_context \xA73: asserted \u21D2 weak)`
      }
    };
  }
  return roles;
}
function advisorySubstrateFromRoles(roles) {
  const s = roles.advisory.substrate;
  if (s !== null && ADVISORY_SUBSTRATES.includes(s)) {
    return s;
  }
  return void 0;
}
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
function hostKindRank(hostKind) {
  return isClaudeHost(hostKind) ? 0 : 1;
}
var init_tiebreak = __esm({
  "src/domains/config/tiebreak.ts"() {
    init_rank();
  }
});

// src/domains/config/router.ts
function manifestTimestamp(host) {
  const raw = host.advertised_at ?? host.detected_at;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}
function isStale(host, now, ttlS) {
  const ts = manifestTimestamp(host);
  if (ts === null) return true;
  return now - ts > ttlS * 1e3;
}
function supportsTier(host, tier) {
  if (Array.isArray(host.supported_tiers)) {
    return host.supported_tiers.includes(tier);
  }
  const model = host.tier_models?.[tier] ?? host.tiers?.[tier];
  return typeof model === "string" && model.trim().length > 0;
}
function toolGap(host, requiredTools) {
  if (!requiredTools || requiredTools.length === 0) return [];
  if (!Array.isArray(host.tool_permissions)) return [];
  const allow = new Set(host.tool_permissions);
  return requiredTools.filter((t) => !allow.has(t));
}
function capabilityGap(host, reqs) {
  if (!reqs) return [];
  const gaps = [];
  const cs = host.capability_set;
  if (reqs.needs_parallel === true) {
    const canParallel = cs?.needs_parallel ?? Boolean(host.tool_support?.agent_team || host.tool_support?.independent_agents);
    if (!canParallel) gaps.push("needs_parallel");
  }
  if (cs) {
    if (reqs.needs_pr === true && !cs.needs_pr) gaps.push("needs_pr");
    if (reqs.needs_network === true && !cs.needs_network) gaps.push("needs_network");
    if (reqs.isolation === "worktree" && cs.isolation !== "worktree") {
      gaps.push("isolation:worktree");
    }
  }
  return gaps;
}
function toModelParams(resolved) {
  if (resolved.model === null) return null;
  const params = { model: resolved.model };
  if (resolved.effort !== void 0) params.effort = resolved.effort;
  if (resolved.reasoning !== void 0) params.reasoning = resolved.reasoning;
  if (resolved.thinking !== void 0) params.thinking = resolved.thinking;
  if (resolved.verbosity !== void 0) params.verbosity = resolved.verbosity;
  return params;
}
function resolveModel(tier, host, settingsOverride) {
  return resolveModelParams(tier, host, settingsOverride).model ?? null;
}
function resolveModelParams(tier, host, settingsOverride) {
  const overrideResolved = resolveTierModel(settingsOverride, tier, host.host_kind);
  const overrideParams = toModelParams(overrideResolved);
  if (overrideParams !== null) return overrideParams;
  const fromManifest = host.tier_models?.[tier] ?? host.tiers?.[tier];
  if (typeof fromManifest === "string" && fromManifest.trim()) return { model: fromManifest.trim() };
  const builtIn = getDefaultModelTierMap(host.host_kind)[tier];
  return builtIn === null ? {} : { model: builtIn };
}
function hostDiversityOf(preferred, selected) {
  if (preferred === void 0) return "unknown";
  return preferred === selected ? "same" : "distinct";
}
function route(lane, hosts, opts = {}) {
  const now = opts.now ?? Date.now();
  const ttlS = opts.manifestTtlS ?? DEFAULT_TTL_S;
  const crossHostEnabled = opts.crossHostEnabled ?? false;
  const fallbackToClaude = opts.fallbackToClaude ?? true;
  const requiredBackend = lane.requiredBackend ?? backendForMode(lane.mode);
  const rejected = [];
  const policyEligible = [];
  const qualifying = [];
  for (const host of hosts) {
    const tag = (reason) => rejected.push({ hostId: host.host_id, hostKind: host.host_kind, reason });
    if (!crossHostEnabled && !isClaudeHost(host.host_kind)) {
      tag("cross-host disabled (defaults.cross_host.enabled=false)");
      continue;
    }
    if (isStale(host, now, ttlS)) {
      tag(`stale manifest (older than ${ttlS}s TTL)`);
      continue;
    }
    policyEligible.push(host);
    if (!supportsTier(host, lane.tier)) {
      tag(`tier "${lane.tier}" not supported`);
      continue;
    }
    if (requiredBackend && !host.tool_support?.[requiredBackend]) {
      tag(`backend "${requiredBackend}" not supported`);
      continue;
    }
    const gap = toolGap(host, lane.requiredTools);
    if (gap.length > 0) {
      tag(`missing required tools: ${gap.join(", ")}`);
      continue;
    }
    const capGap = capabilityGap(host, lane.capabilityRequirements);
    if (capGap.length > 0) {
      tag(`capability requirements not met: ${capGap.join(", ")}`);
      continue;
    }
    qualifying.push(host);
  }
  if (qualifying.length === 0) {
    if (policyEligible.length === 0) {
      throw new RouteError(lane.taskId, rejected);
    }
    const leastBad = [...policyEligible].sort((a, b) => {
      const sa = rankScore(a, lane);
      const sb = rankScore(b, lane);
      if (sb !== sa) return sb - sa;
      const ka = hostKindRank(a.host_kind);
      const kb = hostKindRank(b.host_kind);
      if (ka !== kb) return ka - kb;
      return a.host_id < b.host_id ? -1 : a.host_id > b.host_id ? 1 : 0;
    })[0];
    const degradedDecision = {
      taskId: lane.taskId,
      host: leastBad.host_id,
      hostKind: leastBad.host_kind,
      tier: lane.tier,
      model: resolveModel(lane.tier, leastBad, opts.settingsOverride),
      modelParams: resolveModelParams(lane.tier, leastBad, opts.settingsOverride),
      fallbackChain: [],
      affinityScore: rankScore(leastBad, lane),
      degraded: true,
      independence: "weak",
      hostDiversity: hostDiversityOf(lane.preferredHostKind, leastBad.host_kind),
      reason: `DEGRADED: no host fully qualified for task "${lane.taskId}"; routed to least-bad candidate ${leastBad.host_id}(${leastBad.host_kind}); ${rejected.length} rejection(s) recorded; backend=${requiredBackend ?? "any"}; workType=${lane.workType ?? "none"}`,
      rejected,
      notes: [
        "budget-cap deferred (oc-budget-cap, CR-6); spend recorded via telemetry stub",
        "degraded: true \u2014 no fully-qualifying host found; weak-independence recorded (doc 08 \xA72, TE-02/TE-03)"
      ]
    };
    opts.onDecision?.(degradedDecision);
    return degradedDecision;
  }
  const ranked = [...qualifying].sort((a, b) => {
    const sa = rankScore(a, lane);
    const sb = rankScore(b, lane);
    if (sb !== sa) return sb - sa;
    const ka = hostKindRank(a.host_kind);
    const kb = hostKindRank(b.host_kind);
    if (ka !== kb) return ka - kb;
    return a.host_id < b.host_id ? -1 : a.host_id > b.host_id ? 1 : 0;
  });
  const toTarget = (h) => ({
    host: h.host_id,
    hostKind: h.host_kind,
    tier: lane.tier,
    // SAME tier across the whole chain — CR-3 no silent downgrade
    model: resolveModel(lane.tier, h, opts.settingsOverride),
    modelParams: resolveModelParams(lane.tier, h, opts.settingsOverride)
  });
  const primaryHost = ranked[0];
  const primary = toTarget(primaryHost);
  const rest = ranked.slice(1);
  let fallbackChain = rest.map(toTarget);
  if (fallbackToClaude) {
    const claudeIdx = fallbackChain.findIndex((t) => isClaudeHost(t.hostKind));
    if (claudeIdx >= 0) {
      const [claudeLast] = fallbackChain.splice(claudeIdx, 1);
      fallbackChain.push(claudeLast);
    }
  }
  const decision = {
    taskId: lane.taskId,
    host: primary.host,
    hostKind: primary.hostKind,
    tier: primary.tier,
    model: primary.model,
    modelParams: primary.modelParams,
    fallbackChain,
    affinityScore: rankScore(primaryHost, lane),
    degraded: false,
    // T7-H2: NEVER "strong" here. Finding a fully-qualifying host is not a
    // review-independence verdict; only a written §7a adjudication is.
    independence: "weak",
    hostDiversity: hostDiversityOf(lane.preferredHostKind, primary.hostKind),
    reason: `primary=${primary.host}(${primary.hostKind}) tier=${primary.tier} model=${primary.model ?? "(host default \u2014 no Guild-mapped model)"}; ${fallbackChain.length} fallback(s); backend=${requiredBackend ?? "any"}; workType=${lane.workType ?? "none"}`,
    rejected,
    notes: [
      "budget-cap deferred (oc-budget-cap, CR-6); spend recorded via telemetry stub",
      "independence is ALWAYS weak from the router (T7-H2): finding a fully-qualifying host is a host-selection fact (see hostDiversity), never a review verdict; strong exists only as a written \xA77a independence_adjudication block over both parties' finalized receipts"
    ]
  };
  opts.onDecision?.(decision);
  return decision;
}
function planTeamRouting(specialists, hosts, opts) {
  const { localHostId, tier = "mid", mode = "auto", ...routeOpts } = opts;
  return specialists.map((s) => {
    const laneTier = s.tier ?? tier;
    const decision = route(
      {
        taskId: s.name,
        tier: laneTier,
        mode,
        preferredHostKind: s.host_kind,
        capabilityRequirements: s.capabilityRequirements
      },
      hosts,
      routeOpts
    );
    return {
      specialist: s.name,
      hostKind: decision.hostKind,
      decision,
      backend: decision.host === localHostId ? "tmux" : "remote"
    };
  });
}
var RouteError, DEFAULT_TTL_S;
var init_router = __esm({
  "src/domains/config/router.ts"() {
    init_tier_model();
    init_rank();
    init_tiebreak();
    RouteError = class extends Error {
      taskId;
      rejected;
      constructor(taskId, rejected) {
        const detail = rejected.length ? rejected.map((r) => `${r.hostId} (${r.hostKind}): ${r.reason}`).join("; ") : "no host manifests supplied";
        super(`No host can route task "${taskId}" \u2014 ${detail}`);
        this.name = "RouteError";
        this.taskId = taskId;
        this.rejected = rejected;
      }
    };
    DEFAULT_TTL_S = 3600;
  }
});

// src/domains/config/compose-prompt.ts
function approxTokens(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(Math.max(words * 1.3, text.length / 4));
}
function concreteModelNameIn(text) {
  const m = MODEL_NAME_RE.exec(text);
  return m ? m[0] : null;
}
function skipReasonFor(hit) {
  return hit.kind === "model-name" ? "concrete-model-name" : "host-identity";
}
function promptIdentityIn(text) {
  const prose = YOU_ARE_HOST_RE.exec(text);
  if (prose) return { kind: "you-are-host", token: prose[0] };
  const model = MODEL_NAME_RE.exec(text);
  if (model) return { kind: "model-name", token: model[0] };
  const fam = HOST_FAMILY_RE.exec(text);
  if (fam) return { kind: "host-family", token: fam[0] };
  return null;
}
function composePrompt(base, extensions, host_family, model_family) {
  const skipped = [];
  const parts = [{ id: "base:using-guild", text: base }];
  const byId = /* @__PURE__ */ new Map();
  for (const f of extensions.workspace ?? []) byId.set(f.id, f);
  for (const f of extensions.project ?? []) byId.set(f.id, f);
  for (const f of byId.values()) {
    const hit = promptIdentityIn(f.text);
    if (hit) {
      skipped.push({ id: f.id, reason: skipReasonFor(hit) });
      continue;
    }
    parts.push(f);
  }
  if (extensions.hostOverlay) {
    const o = extensions.hostOverlay;
    if (concreteModelNameIn(o.text)) skipped.push({ id: o.id, reason: "concrete-model-name" });
    else parts.push(o);
  }
  let dialect_id = "dialect:none";
  const d = extensions.dialect;
  if (d) {
    const declared = d.id.replace(/^dialect:/, "");
    if (MODEL_FAMILIES.includes(declared) && declared !== model_family) {
      skipped.push({ id: d.id, reason: "wrong-family" });
    } else if (promptIdentityIn(d.text)) {
      skipped.push({ id: d.id, reason: skipReasonFor(promptIdentityIn(d.text)) });
    } else if (approxTokens(d.text) > DIALECT_TOKEN_BUDGET) {
      skipped.push({ id: d.id, reason: "dialect-over-budget" });
    } else {
      parts.push(d);
      dialect_id = `dialect:${model_family}`;
    }
  }
  const text = parts.map((p) => p.text.trimEnd()).join("\n\n");
  const hash = crypto10.createHash("sha256").update(`${host_family}\0${model_family}\0${text}`).digest("hex");
  return { text, dialect_id, overlay_ids: parts.map((p) => p.id), hash, skipped };
}
function loadPromptExtensions(guildDir, model_family) {
  const dir = path32.join(guildDir, PROMPTS_DIRNAME);
  const overlays = [];
  let dialect = null;
  const overlayFile = path32.join(dir, USING_GUILD_OVERLAY);
  const overlayText = readIfFile2(overlayFile);
  if (overlayText !== null) {
    assertNoModelName(overlayFile, overlayText);
    overlays.push({ id: `overlay:${USING_GUILD_OVERLAY}`, text: overlayText });
  }
  if (MODEL_FAMILIES.includes(model_family)) {
    const dialectFile = path32.join(dir, DIALECTS_DIRNAME, `${model_family}.md`);
    const dialectText = readIfFile2(dialectFile);
    if (dialectText !== null) {
      assertNoModelName(dialectFile, dialectText);
      dialect = { id: `dialect:${model_family}`, text: dialectText };
    }
  }
  return { overlays, dialect };
}
function readIfFile2(file) {
  try {
    return fs27.statSync(file).isFile() ? fs27.readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
}
function assertNoModelName(file, text) {
  const hit = promptIdentityIn(text);
  if (hit === null) return;
  const what = hit.kind === "you-are-host" ? `says '${hit.token}'` : hit.kind === "model-name" ? `names the concrete model '${hit.token}'` : `names the host family '${hit.token}'`;
  throw new PromptRejectedError(
    file,
    hit.token,
    `prompt extension ${file} ${what}. Prompt overlays and dialects key on a model FAMILY (${MODEL_FAMILIES.join(" \xB7 ")}) and never name a host or a product \u2014 host and model are bound per session on the run record (KTD22/KTD31).`
  );
}
function composeSessionPrompt(input) {
  let base = "";
  if (input.pluginRoot) {
    for (const rel2 of USING_GUILD_BASE_RELS) {
      const text = readIfFile2(path32.join(input.pluginRoot, rel2));
      if (text !== null) {
        base = text;
        break;
      }
    }
  }
  const project = input.guildDir ? loadPromptExtensions(input.guildDir, input.model_family) : null;
  let dialect = project?.dialect ?? null;
  if (dialect === null && input.pluginRoot && MODEL_FAMILIES.includes(input.model_family)) {
    const shipped = readIfFile2(
      path32.join(input.pluginRoot, PLUGIN_DIALECTS_REL, `${input.model_family}.md`)
    );
    if (shipped !== null) dialect = { id: `dialect:${input.model_family}`, text: shipped };
  }
  return composePrompt(
    base,
    { project: project?.overlays ?? [], dialect },
    input.host_family,
    input.model_family
  );
}
var crypto10, fs27, path32, DIALECT_TOKEN_BUDGET, MODEL_NAME_RE, MODEL_FAMILIES, HOST_FAMILY_TOKENS_PROMPT, HOST_FAMILY_RE, YOU_ARE_HOST_RE, PromptRejectedError, PROMPTS_DIRNAME, USING_GUILD_OVERLAY, DIALECTS_DIRNAME, USING_GUILD_BASE_RELS, PLUGIN_DIALECTS_REL;
var init_compose_prompt = __esm({
  "src/domains/config/compose-prompt.ts"() {
    crypto10 = __toESM(require("node:crypto"));
    fs27 = __toESM(require("node:fs"));
    path32 = __toESM(require("node:path"));
    DIALECT_TOKEN_BUDGET = 200;
    MODEL_NAME_RE = /\b(opus|sonnet|haiku|fable|gpt-?[0-9][^\s]*|o[1-9](?:-(?:mini|pro|preview))?|gemini-[0-9][^\s]*|claude-[a-z0-9][^\s]*|llama-?[0-9][^\s]*|mistral|grok-?[0-9][^\s]*|deepseek|qwen)\b/i;
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
    PromptRejectedError = class extends Error {
      constructor(file, token, message) {
        super(message);
        this.file = file;
        this.token = token;
        this.name = "PromptRejectedError";
      }
      file;
      token;
    };
    PROMPTS_DIRNAME = "prompts";
    USING_GUILD_OVERLAY = "using-guild.overlay.md";
    DIALECTS_DIRNAME = "dialects";
    USING_GUILD_BASE_RELS = Object.freeze([
      "skills/meta/using-guild/SKILL.md",
      "skills/meta/using-guild/SKILL.src.md"
    ]);
    PLUGIN_DIALECTS_REL = "src/surfaces/prompts/dialects";
  }
});

// src/domains/config/team-prompt.ts
function isClaudeCli2(hostKind) {
  return hostKindToRegistryId(hostKind) === "claude-code-cli";
}
function producerMarkerLine(role) {
  return `${DISPATCH_PRODUCER_ENV}=${DISPATCH_PRODUCER_TOKEN} role=${role}
`;
}
function buildPrompt(slug, runId, specialist, teamPath, paneHostKind = "claude") {
  if (!specialist) {
    const teamRef = teamPath ?? `.guild/team/${slug}.yaml`;
    const coordination = isClaudeCli2(paneHostKind) ? `Dispatch specialists via TaskCreated events when their plan dependencies clear, then aggregate handoffs and invoke guild:review \u2192 guild:verify-done \u2192 guild:reflect.` : `Dispatch specialists through the file-based agent bus when their plan dependencies clear; write dispatch/brief records under \`.guild/runs/${runId}/agent-bus/\`, then aggregate handoffs and invoke guild:review \u2192 guild:verify-done \u2192 guild:reflect.`;
    return producerMarkerLine("orchestrator") + `You are the Team Lead for team \`${slug}\`, run-id \`${runId}\`. The spec is at \`.guild/spec/${slug}.md\`, the team at \`${teamRef}\`, and the approved plan at \`.guild/plan/${slug}.md\`. Per-specialist context bundles are under \`.guild/context/${runId}/<specialist>-<task-id>.md\` (build them via guild:context-assemble before dispatch). Teammate handoff receipts will land at \`.guild/runs/${runId}/handoffs/<specialist>-<task-id>.md\`. ` + coordination;
  }
  const waitInstruction = isClaudeCli2(paneHostKind) ? `Wait for a \`TaskCreated\` event from the orchestrator before starting.` : `Watch the file-based agent bus at \`.guild/runs/${runId}/agent-bus/\` for your dispatch/brief record before starting; do not wait for host-native event callbacks.`;
  const readAckInstruction = `Before doing any work, read your assignment file at \`$GUILD_TASK_ASSIGNMENT\` and validate it (guild.task_assignment schema, fail-closed). If it is missing or malformed, STOP and report a hard dispatch failure \u2014 do not start. Otherwise write your acknowledgment beside it (an \`assignment-ack.json\` marker in the instance directory) and only then begin your lane: you enter \`running\` only after the assignment is acknowledged (D5). `;
  const definitionPath = typeof specialist.definition === "string" ? specialist.definition.trim() : void 0;
  const definitionInstruction = specialist.definition_source === "project" && definitionPath ? `Your role definition is at \`${definitionPath}\` \u2014 read it FIRST and adopt it fully (persona, boundaries, TRIGGER / DO NOT TRIGGER limits). For each skill listed in its frontmatter \`skills:\`, load the project-local instance at \`.guild/skills/<skill>/SKILL.md\` when it exists before starting your lane. ` : "";
  const isProjectSpecialist = specialist.definition_source === "project" && Boolean(definitionPath);
  const definitionMarker = isProjectSpecialist ? `GUILD_AGENT_DEFINITION=${definitionPath}
` : "";
  const line1Marker = isProjectSpecialist ? definitionMarker : producerMarkerLine(specialist.name);
  return line1Marker + `You are the \`${specialist.name}\` teammate for run-id \`${runId}\`. ` + definitionInstruction + `Your lane scope: \`${specialist.scope}\`. Read the exact \`context_bundle_id\` named by your assignment \u2014 it is authoritative; privilege it over any ambient CLAUDE.md / auto-memory (\xA79.1). When you finish, write your \xA78.2 handoff receipt with all 5 fields (changed_files, opens_for, assumptions, evidence, followups) to the canonical lane receipt path \`.guild/runs/${runId}/handoffs/<worker_role>-<logical_task_id>.md\`, using the values in your assignment. Do not write the assignment's \`handoff_path\`; TaskCompleted publishes the separate \`handoff_path\` pointer after validating and hashing the canonical receipt. ` + readAckInstruction + waitInstruction;
}
var DISPATCH_PRODUCER_ENV, DISPATCH_PRODUCER_TOKEN;
var init_team_prompt = __esm({
  "src/domains/config/team-prompt.ts"() {
    init_host_id_namespace();
    DISPATCH_PRODUCER_ENV = "GUILD_DISPATCH_PRODUCER";
    DISPATCH_PRODUCER_TOKEN = "guild.dispatch.v1";
  }
});

// src/domains/config/init-scaffold-manifest.ts
function scaffoldFor(mode) {
  return mode === "workspace_root" ? workspaceRoot : singleProject;
}
function eagerEntriesFor(mode) {
  const base = mode === "workspace_root" ? workspaceRoot : singleProject;
  return base.filter((e) => e.lazy !== true);
}
function lazyEntriesFor(mode) {
  const base = mode === "workspace_root" ? workspaceRoot : singleProject;
  return base.filter((e) => e.lazy === true);
}
function requiredEntriesFor(mode) {
  const base = mode === "workspace_root" ? workspaceRoot : singleProject;
  return base.filter((e) => e.repair_required);
}
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
function advisoryMessage(code) {
  return INIT_CONFIG_COPY[code];
}
var INIT_CONFIG_COPY;
var init_init_config_copy = __esm({
  "src/domains/config/init-config-copy.ts"() {
    INIT_CONFIG_COPY = {
      ready: "Guild is initialized here. Lifecycle commands and settings management are available.",
      not_installed: "Guild is not initialized in this folder. Initialize Guild to enable lifecycle commands and settings management.",
      needs_repair: "Guild is installed here but incomplete or malformed. Repair the install to restore the required Guild structure; lifecycle commands are unavailable until repair completes.",
      host_unsupported: "This host has no native Guild config surface yet. Settings management is unavailable here; use a supported CLI host to initialize, repair, or edit Guild settings."
    };
  }
});

// src/domains/config/host-open-preflight.ts
function detectGuildState(cwd) {
  const evidence = [];
  const guildDir = durableGuildDir(cwd);
  const guildDirPresent = safeIsDir(guildDir);
  evidence.push({ kind: "guild_dir", path: guildDir, present: guildDirPresent });
  const cwdManifestPath = path33.join(guildDir, "workspace.json");
  const cwdParsed = parseWorkspaceManifest(cwdManifestPath);
  if (cwdParsed.status === "parse_error") {
    evidence.push({
      kind: "workspace_json",
      path: cwdManifestPath,
      present: true,
      detail: `JSON parse error: ${cwdParsed.error}`
    });
    return repairResult(
      cwd,
      "workspace_root",
      { problem: "malformed_workspace_json", path: cwdManifestPath, detail: cwdParsed.error },
      evidence
    );
  }
  if (cwdParsed.status === "not_workspace") {
    evidence.push({
      kind: "workspace_json",
      path: cwdManifestPath,
      present: true,
      detail: "present but is_workspace !== true"
    });
    return repairResult(
      cwd,
      "workspace_root",
      {
        problem: "malformed_workspace_json",
        path: cwdManifestPath,
        detail: "workspace.json present but is_workspace !== true"
      },
      evidence
    );
  }
  if (cwdParsed.status === "workspace") {
    evidence.push({
      kind: "workspace_json",
      path: cwdManifestPath,
      present: true,
      detail: "is_workspace:true"
    });
    return verifyFloor(cwd, "workspace_root", cwd, evidence);
  }
  evidence.push({ kind: "workspace_json", path: cwdManifestPath, present: false });
  const ancestor = discoverWorkspace(cwd);
  if (ancestor) {
    const ancestorManifestPath = path33.join(durableGuildDir(ancestor.rootDir), "workspace.json");
    evidence.push({
      kind: "ancestor_workspace",
      path: ancestorManifestPath,
      present: true,
      detail: "is_workspace:true"
    });
    if (guildDirPresent) {
      return verifyFloor(cwd, "workspace_child", ancestor.rootDir, evidence);
    }
    return notInstalledResult(cwd, ancestor.rootDir, evidence);
  }
  if (guildDirPresent) {
    return verifyFloor(cwd, "single_project", null, evidence);
  }
  return notInstalledResult(cwd, null, evidence);
}
function safeStat(p) {
  try {
    return fs28.statSync(p);
  } catch {
    return null;
  }
}
function safeIsDir(p) {
  const s = safeStat(p);
  return s !== null && s.isDirectory();
}
function safeExistsForEntry(absPath, kind) {
  const s = safeStat(absPath);
  if (s === null) return false;
  return kind === "dir" ? s.isDirectory() : s.isFile();
}
function resolveEntryPath(root, entry) {
  const segments = entry.path.replace(/\/+$/, "").split("/");
  return path33.join(root, ...segments);
}
function verifyFloor(cwd, mode, workspaceRoot2, evidence) {
  const checkedRequired = requiredEntriesFor(mode);
  let firstMissing = null;
  for (const entry of checkedRequired) {
    const abs = resolveEntryPath(cwd, entry);
    const present = safeExistsForEntry(abs, entry.kind);
    evidence.push({ kind: "manifest_entry", path: abs, present, detail: entry.path });
    if (!present && firstMissing === null) firstMissing = entry;
  }
  if (firstMissing !== null) {
    const missingAbs = resolveEntryPath(cwd, firstMissing);
    return {
      schema_version: GUILD_STATE_SCHEMA_VERSION,
      state: "installed_needs_repair",
      cwd,
      projectRoot: cwd,
      workspaceRoot: workspaceRoot2,
      checkedRequired,
      evidence,
      problem: {
        problem: "missing_required_manifest_entry",
        path: missingAbs,
        detail: `required ${firstMissing.kind} '${firstMissing.path}' is missing`
      }
    };
  }
  const state = mode;
  return {
    schema_version: GUILD_STATE_SCHEMA_VERSION,
    state,
    cwd,
    projectRoot: cwd,
    workspaceRoot: workspaceRoot2,
    checkedRequired,
    evidence,
    problem: null
  };
}
function repairResult(cwd, mode, problem, evidence) {
  return {
    schema_version: GUILD_STATE_SCHEMA_VERSION,
    state: "installed_needs_repair",
    cwd,
    projectRoot: cwd,
    workspaceRoot: mode === "workspace_root" ? cwd : null,
    checkedRequired: requiredEntriesFor(mode),
    evidence,
    problem
  };
}
function notInstalledResult(cwd, workspaceRoot2, evidence) {
  return {
    schema_version: GUILD_STATE_SCHEMA_VERSION,
    state: "not_installed",
    cwd,
    projectRoot: null,
    workspaceRoot: workspaceRoot2,
    checkedRequired: [],
    evidence,
    problem: null
  };
}
function detectChildGitRepos(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > CHILD_SCAN_MAX_DEPTH) return;
    let entries;
    try {
      entries = fs28.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || CHILD_SCAN_SKIP_DIRS.has(ent.name)) continue;
      const childDir = path33.join(dir, ent.name);
      if (safeStat(path33.join(childDir, ".git")) !== null) {
        out.push(childDir);
      } else {
        walk(childDir, depth + 1);
      }
    }
  };
  walk(root, 1);
  return out.sort();
}
function rootIsEmpty(root) {
  let entries;
  try {
    entries = fs28.readdirSync(root);
  } catch {
    return false;
  }
  return entries.filter((e) => !EMPTY_ROOT_IGNORED.has(e)).length === 0;
}
function suggestWorkspaceMode(root) {
  const childRepos = detectChildGitRepos(root);
  const branches = ["single_project", "multiple_repo_workspace", "skip"];
  if (childRepos.length > 0) {
    return {
      root_kind: "has_child_repos",
      recommended_mode: "workspace",
      child_git_repos: childRepos,
      branches
    };
  }
  if (rootIsEmpty(root)) {
    return {
      root_kind: "empty",
      recommended_mode: "single_project",
      child_git_repos: [],
      branches
    };
  }
  return {
    root_kind: "non_empty_no_child_repos",
    recommended_mode: "single_project",
    child_git_repos: [],
    branches
  };
}
function hostOpenPreflight(cwd, host) {
  const detection = detectGuildState(cwd);
  if (!CLI_NATIVE_HOSTS.has(host)) {
    return {
      schema_version: HOST_OPEN_PREFLIGHT_SCHEMA_VERSION,
      host,
      cwd,
      detection,
      action: "blocked",
      lifecycle_available: false,
      advisory: { code: "host_unsupported", message: advisoryMessage("host_unsupported") },
      init_prompt: null,
      repair_hint: null,
      cache_fingerprint: null
    };
  }
  switch (detection.state) {
    case "not_installed": {
      const suggestion = suggestWorkspaceMode(cwd);
      return {
        schema_version: HOST_OPEN_PREFLIGHT_SCHEMA_VERSION,
        host,
        cwd,
        detection,
        action: "offer_init",
        lifecycle_available: false,
        advisory: { code: "not_installed", message: advisoryMessage("not_installed") },
        init_prompt: {
          recommended_mode: suggestion.recommended_mode,
          root_kind: suggestion.root_kind,
          child_git_repos: suggestion.child_git_repos,
          branches: suggestion.branches
        },
        repair_hint: null,
        cache_fingerprint: null
      };
    }
    case "installed_needs_repair":
      return {
        schema_version: HOST_OPEN_PREFLIGHT_SCHEMA_VERSION,
        host,
        cwd,
        detection,
        action: "offer_repair",
        lifecycle_available: false,
        advisory: { code: "needs_repair", message: advisoryMessage("needs_repair") },
        init_prompt: null,
        repair_hint: detection.problem,
        cache_fingerprint: null
      };
    case "single_project":
    case "workspace_root":
    case "workspace_child":
    default:
      return {
        schema_version: HOST_OPEN_PREFLIGHT_SCHEMA_VERSION,
        host,
        cwd,
        detection,
        action: "proceed",
        lifecycle_available: true,
        advisory: { code: "ready", message: advisoryMessage("ready") },
        init_prompt: null,
        repair_hint: null,
        cache_fingerprint: null
      };
  }
}
var fs28, path33, GUILD_STATE_SCHEMA_VERSION, CHILD_SCAN_SKIP_DIRS, CHILD_SCAN_MAX_DEPTH, EMPTY_ROOT_IGNORED, HOST_OPEN_PREFLIGHT_SCHEMA_VERSION, CLI_NATIVE_HOSTS;
var init_host_open_preflight = __esm({
  "src/domains/config/host-open-preflight.ts"() {
    fs28 = __toESM(require("fs"));
    init_kernel();
    path33 = __toESM(require("path"));
    init_init_scaffold_manifest();
    init_workspace_manifest();
    init_init_config_copy();
    init_state();
    GUILD_STATE_SCHEMA_VERSION = "guild.guild_state.v1";
    CHILD_SCAN_SKIP_DIRS = /* @__PURE__ */ new Set([".git", ".guild", "node_modules", ".hg", ".svn"]);
    CHILD_SCAN_MAX_DEPTH = 6;
    EMPTY_ROOT_IGNORED = /* @__PURE__ */ new Set([
      ".git",
      ".gitignore",
      ".gitattributes",
      ".DS_Store",
      ".vscode",
      ".idea",
      ".editorconfig",
      "Thumbs.db"
    ]);
    HOST_OPEN_PREFLIGHT_SCHEMA_VERSION = "guild.host_open_preflight.v1";
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
var config_exports = {};
__export(config_exports, {
  ADAPTER_SURFACES: () => ADAPTER_SURFACES,
  ADVISORY_SUBSTRATES: () => ADVISORY_SUBSTRATES,
  AGENTS_FILE_CAPABILITIES: () => AGENTS_FILE_CAPABILITIES,
  AUTHORITATIVE_PURPOSE_SOURCES: () => AUTHORITATIVE_PURPOSE_SOURCES,
  AUTH_PROBES: () => AUTH_PROBES,
  BENIGN_COMPATIBILITY_READ_REASONS: () => BENIGN_COMPATIBILITY_READ_REASONS,
  CACHED_INSPECTION_BUDGET_MS: () => CACHED_INSPECTION_BUDGET_MS,
  CACHE_KEY_COMPONENTS: () => CACHE_KEY_COMPONENTS,
  CAPABILITY_AUTO_CREATE_POLICIES: () => CAPABILITY_AUTO_CREATE_POLICIES,
  CAPABILITY_RESOLUTION_INTENTS: () => CAPABILITY_RESOLUTION_INTENTS,
  CAPABILITY_RESOLVER_MODES: () => CAPABILITY_RESOLVER_MODES,
  CAPABILITY_RESOLVER_MODE_AFTER_F7: () => CAPABILITY_RESOLVER_MODE_AFTER_F7,
  CAPABILITY_RESOLVER_MODE_DEFAULT: () => CAPABILITY_RESOLVER_MODE_DEFAULT,
  CAPABILITY_ROLE_SLUG_MAX_LEN: () => CAPABILITY_ROLE_SLUG_MAX_LEN,
  CAPABILITY_SUGGESTION_BUDGET_MAX: () => CAPABILITY_SUGGESTION_BUDGET_MAX,
  CAPABILITY_SUGGESTION_BUDGET_MIN: () => CAPABILITY_SUGGESTION_BUDGET_MIN,
  CLAUDE_CAPABILITIES: () => CLAUDE_CAPABILITIES,
  CLAUDE_TIER_FALLBACK: () => CLAUDE_TIER_FALLBACK,
  CLI_NATIVE_HOSTS: () => CLI_NATIVE_HOSTS,
  CODEX_CAPABILITIES: () => CODEX_CAPABILITIES,
  COMPATIBILITY_ASSET_KINDS: () => COMPATIBILITY_ASSET_KINDS,
  COMPATIBILITY_ASSET_ROOTS: () => COMPATIBILITY_ASSET_ROOTS,
  COMPATIBILITY_CATALOG_SCHEMA: () => COMPATIBILITY_CATALOG_SCHEMA,
  COMPATIBILITY_DEPRECATION_STATES: () => COMPATIBILITY_DEPRECATION_STATES,
  COMPATIBILITY_READ_REASONS: () => COMPATIBILITY_READ_REASONS,
  COMPATIBILITY_USAGE_DISPOSITION: () => COMPATIBILITY_USAGE_DISPOSITION,
  COMPATIBILITY_USAGE_EVENT_NAME: () => COMPATIBILITY_USAGE_EVENT_NAME,
  COMPATIBILITY_USAGE_OUTCOME_TYPE: () => COMPATIBILITY_USAGE_OUTCOME_TYPE,
  COMPATIBILITY_USAGE_SCHEMA: () => COMPATIBILITY_USAGE_SCHEMA,
  COMPLEXITIES: () => COMPLEXITIES,
  CONDITION_KINDS: () => CONDITION_KINDS,
  CONFIRMATION_KEY_COMPONENTS: () => CONFIRMATION_KEY_COMPONENTS,
  DEFAULTS: () => DEFAULTS,
  DEFAULT_CATALOG_TTL_SECONDS: () => DEFAULT_CATALOG_TTL_SECONDS,
  DEFAULT_DISCOVERY_BUDGET_MS: () => DEFAULT_DISCOVERY_BUDGET_MS,
  DEFAULT_ESCALATION_MARKERS: () => DEFAULT_ESCALATION_MARKERS,
  DEFAULT_INSPECTION_LABEL: () => DEFAULT_INSPECTION_LABEL,
  DEPENDENCE_COMPATIBILITY_READ_REASONS: () => DEPENDENCE_COMPATIBILITY_READ_REASONS,
  DERIVED_HOST_CAPABILITY_ROWS: () => DERIVED_HOST_CAPABILITY_ROWS,
  DIALECTS_DIRNAME: () => DIALECTS_DIRNAME,
  DIALECT_TOKEN_BUDGET: () => DIALECT_TOKEN_BUDGET,
  DiscoveryBudgetExceeded: () => DiscoveryBudgetExceeded,
  DiscoveryParseRejected: () => DiscoveryParseRejected,
  EVIDENCE_STATES: () => EVIDENCE_STATES,
  FAILURE_REASONS: () => FAILURE_REASONS,
  FALLBACK_FAILURE_TAXONOMY: () => FALLBACK_FAILURE_TAXONOMY,
  FALLBACK_LADDER_TABLE: () => FALLBACK_LADDER_TABLE,
  G5_MIN_CLEAN_RELEASES: () => G5_MIN_CLEAN_RELEASES,
  GUILD_STATE_SCHEMA_VERSION: () => GUILD_STATE_SCHEMA_VERSION,
  HOSTKIND_TO_REGISTRY_ID: () => HOSTKIND_TO_REGISTRY_ID,
  HOST_ADAPTER_CONTRACT_VERSION: () => HOST_ADAPTER_CONTRACT_VERSION,
  HOST_ADAPTER_OPERATIONS: () => HOST_ADAPTER_OPERATIONS,
  HOST_FAMILIES: () => HOST_FAMILIES,
  HOST_FAMILY_TOKENS: () => HOST_FAMILY_TOKENS,
  HOST_IDS: () => HOST_IDS,
  HOST_OPEN_PREFLIGHT_SCHEMA_VERSION: () => HOST_OPEN_PREFLIGHT_SCHEMA_VERSION,
  HOST_REGISTRY_ROWS: () => HOST_REGISTRY_ROWS,
  INDEPENDENCE_DIR: () => INDEPENDENCE_DIR,
  INDEPENDENCE_LEVELS: () => INDEPENDENCE_LEVELS,
  INFERRED_HOSTS: () => INFERRED_HOSTS,
  INJECTION_SUPPORT: () => INJECTION_SUPPORT,
  LEGACY_FILLABLE_PURPOSES: () => LEGACY_FILLABLE_PURPOSES,
  LEGACY_HOST_ALIASES: () => LEGACY_HOST_ALIASES,
  LEGAL_EVIDENCE_TRANSITIONS: () => LEGAL_EVIDENCE_TRANSITIONS,
  LISTING_AUTHORITY: () => LISTING_AUTHORITY,
  LOG_ROTATION_THRESHOLD_BYTES: () => LOG_ROTATION_THRESHOLD_BYTES,
  MODEL_CATALOG_CACHE_DIRNAME: () => MODEL_CATALOG_CACHE_DIRNAME,
  MODEL_CATALOG_CACHE_REL: () => MODEL_CATALOG_CACHE_REL,
  MODEL_CATALOG_CACHE_REL_SEGMENTS: () => MODEL_CATALOG_CACHE_REL_SEGMENTS,
  MODEL_CATALOG_SCHEMA_VERSION: () => MODEL_CATALOG_SCHEMA_VERSION,
  MODEL_FAMILIES: () => MODEL_FAMILIES,
  MODEL_FAMILY_TOKENS: () => MODEL_FAMILY_TOKENS,
  MODEL_INSPECTION_SCHEMA: () => MODEL_INSPECTION_SCHEMA,
  MODE_TRANSITION_DIRECTIONS: () => MODE_TRANSITION_DIRECTIONS,
  MODULE_PUBLIC_API_VERSION: () => MODULE_PUBLIC_API_VERSION,
  NON_INHERITABLE_KEYS: () => NON_INHERITABLE_KEYS,
  NativeConfigParseError: () => NativeConfigParseError,
  OPERATOR_BASELINE_POLICY: () => OPERATOR_BASELINE_POLICY,
  PLUGIN_DIALECTS_REL: () => PLUGIN_DIALECTS_REL,
  POLICY_FILES: () => POLICY_FILES,
  POLICY_KEYS: () => POLICY_KEYS,
  POLICY_KEY_ALIASES: () => POLICY_KEY_ALIASES,
  POLICY_OVERLAY_FILE: () => POLICY_OVERLAY_FILE,
  POLICY_PURPOSES: () => POLICY_PURPOSES,
  POLICY_TIERS: () => POLICY_TIERS,
  PROBE_RECEIPT_PATH_RE: () => PROBE_RECEIPT_PATH_RE,
  PROMPTS_DIRNAME: () => PROMPTS_DIRNAME,
  PolicyRejectedError: () => PolicyRejectedError,
  PromptRejectedError: () => PromptRejectedError,
  REQUIRED_HOOK_EVENTS: () => REQUIRED_HOOK_EVENTS,
  RESOLUTION_STATUSES: () => RESOLUTION_STATUSES,
  RESOLVER_AUTHORITIES: () => RESOLVER_AUTHORITIES,
  RESOLVER_MODE_FAILURES: () => RESOLVER_MODE_FAILURES,
  RESOLVER_MODE_OUTCOME_SCHEMA: () => RESOLVER_MODE_OUTCOME_SCHEMA,
  RESOLVER_MODE_POLICIES: () => RESOLVER_MODE_POLICIES,
  RESOLVER_TIER1_KEYS: () => RESOLVER_TIER1_KEYS,
  REVIEW_CLASS_PURPOSES: () => REVIEW_CLASS_PURPOSES,
  ROLES: () => ROLES,
  ROLE_STRENGTHS: () => ROLE_STRENGTHS,
  ROUTING_FLAG_DEFAULTS: () => ROUTING_FLAG_DEFAULTS,
  ROUTING_FLAG_KEYS: () => ROUTING_FLAG_KEYS,
  RUNGS: () => RUNGS,
  RouteError: () => RouteError,
  SESSION_BINDING_FILE: () => SESSION_BINDING_FILE,
  SHIPPED_COMPATIBILITY_ASSET_COUNT: () => SHIPPED_COMPATIBILITY_ASSET_COUNT,
  SHIPPED_DOMAIN_SKILL_COUNT: () => SHIPPED_DOMAIN_SKILL_COUNT,
  SHIPPED_DOMAIN_SKILL_IDS: () => SHIPPED_DOMAIN_SKILL_IDS,
  SHIPPED_TEMPLATE_COUNT: () => SHIPPED_TEMPLATE_COUNT,
  SIDECAR_MAX_BYTES: () => SIDECAR_MAX_BYTES,
  TIER_MAPPING_VERSION: () => TIER_MAPPING_VERSION,
  UNCACHED_DISCOVERY_BUDGET_MS: () => UNCACHED_DISCOVERY_BUDGET_MS,
  UNKNOWN_HOST_FAMILY: () => UNKNOWN_HOST_FAMILY,
  UNKNOWN_MODEL_FAMILY: () => UNKNOWN_MODEL_FAMILY,
  UPDATE_COMMANDS: () => UPDATE_COMMANDS,
  USING_GUILD_BASE_RELS: () => USING_GUILD_BASE_RELS,
  USING_GUILD_OVERLAY: () => USING_GUILD_OVERLAY,
  UnknownOrgQuarantineViolation: () => UnknownOrgQuarantineViolation,
  VALID_HOST_PROFILE_ENTRY_KEYS: () => VALID_HOST_PROFILE_ENTRY_KEYS,
  VALID_HOST_PROFILE_MODEL_KEYS: () => VALID_HOST_PROFILE_MODEL_KEYS,
  adjudicateIndependence: () => adjudicateIndependence,
  advanceChain: () => advanceChain,
  advisorySubstrateFromRoles: () => advisorySubstrateFromRoles,
  affinityBoost: () => affinityBoost,
  appendEvidenceEvent: () => appendEvidenceEvent,
  approxTokens: () => approxTokens,
  assertPersistableIndependence: () => assertPersistableIndependence,
  assertPolicyWrite: () => assertPolicyWrite,
  availableRegistryRows: () => availableRegistryRows,
  backendForMode: () => backendForMode,
  bindSession: () => bindSession,
  bindSessionForRun: () => bindSessionForRun,
  buildCompatibilityCatalog: () => buildCompatibilityCatalog,
  buildIndependenceAdjudication: () => buildIndependenceAdjudication,
  buildModelInspection: () => buildModelInspection,
  buildPrompt: () => buildPrompt,
  buildSessionContext: () => buildSessionContext,
  canonicalPolicyKey: () => canonicalPolicyKey,
  canonicalYamlFlat: () => canonicalYamlFlat,
  claimPrompt: () => claimPrompt,
  classifyCompatibilityRead: () => classifyCompatibilityRead,
  classifyServedAttempt: () => classifyServedAttempt,
  claudeConfigRoots: () => claudeConfigRoots,
  codexConfigHome: () => codexConfigHome,
  compareVersions: () => compareVersions,
  compatibilityUsageForRead: () => compatibilityUsageForRead,
  composePrompt: () => composePrompt,
  composeSessionPrompt: () => composeSessionPrompt,
  concreteModelNameIn: () => concreteModelNameIn,
  confidenceForListing: () => confidenceForListing,
  createAllHostAdapters: () => createAllHostAdapters,
  createCacheKey: () => createCacheKey,
  createHostAdapter: () => createHostAdapter,
  createRunLocalState: () => createRunLocalState,
  createStore: () => createStore,
  decisionFor: () => decisionFor,
  deepMerge: () => deepMerge,
  defaultEvidenceStateForTarget: () => defaultEvidenceStateForTarget,
  defaultProbeEnv: () => defaultProbeEnv,
  defaultTierModels: () => defaultTierModels,
  defaultTiersMap: () => defaultTiersMap,
  deriveCapabilityRow: () => deriveCapabilityRow,
  detectChildGitRepos: () => detectChildGitRepos,
  detectGuildState: () => detectGuildState,
  detectProviders: () => detectProviders,
  detectSession: () => detectSession,
  dispatchSelectableForHostId: () => dispatchSelectableForHostId,
  dispatchUpgrade: () => dispatchUpgrade,
  eagerEntriesFor: () => eagerEntriesFor,
  eligibleForPurpose: () => eligibleForPurpose,
  evaluateG5: () => evaluateG5,
  evidenceStateForListing: () => evidenceStateForListing,
  expandSelector: () => expandSelector,
  failureResult: () => failureResult,
  fallbackHash: () => fallbackHash,
  filterHostProfiles: () => filterHostProfiles,
  finalizeInterrupted: () => finalizeInterrupted,
  finalizeReceipt: () => finalizeReceipt,
  findBoundAdjudications: () => findBoundAdjudications,
  findHostIdentity: () => findHostIdentity,
  findModelNameInText: () => findModelNameInText,
  fingerprintOrUnknown: () => fingerprintOrUnknown,
  freezeChain: () => freezeChain,
  freezeSnapshot: () => freezeSnapshot,
  gateM2: () => gateM2,
  getByPath: () => getByPath2,
  getDefaultModelTierMap: () => getDefaultModelTierMap,
  getRegistryEntry: () => getRegistryEntry,
  getRegistryEntryForHostKind: () => getRegistryEntryForHostKind,
  hostKindRank: () => hostKindRank,
  hostKindToRegistryId: () => hostKindToRegistryId,
  hostOpenPreflight: () => hostOpenPreflight,
  independenceDirForRunDir: () => independenceDirForRunDir,
  initiativeIsWorkspaceScoped: () => initiativeIsWorkspaceScoped,
  installabilityForHostId: () => installabilityForHostId,
  invalidateKey: () => invalidateKey,
  isAntigravityCli: () => isAntigravityCli,
  isCanonicalRoleSlug: () => isCanonicalRoleSlug,
  isClaudeCli: () => isClaudeCli,
  isClaudeHost: () => isClaudeHost,
  isCodexCli: () => isCodexCli,
  isCodexHost: () => isCodexHost,
  isCompatibilityUsageV1: () => isCompatibilityUsageV1,
  isDependenceRead: () => isDependenceRead,
  isDroppedHostKind: () => isDroppedHostKind,
  isFailureReason: () => isFailureReason,
  isHostCapabilitiesV1: () => isHostCapabilitiesV1,
  isHostInferred: () => isHostInferred,
  isHostRegistryEntry: () => isHostRegistryEntry,
  isModelCatalogCachePath: () => isModelCatalogCachePath,
  isPiCli: () => isPiCli,
  isPlainObject: () => isPlainObject5,
  isPolicyKey: () => isPolicyKey,
  isResolverModeFailure: () => isResolverModeFailure,
  isReusableCacheKey: () => isReusableCacheKey,
  isReviewClassPurpose: () => isReviewClassPurpose,
  isRunLocalCacheKey: () => isRunLocalCacheKey,
  isSnapshotStale: () => isSnapshotStale,
  isUnknownHost: () => isUnknownHost,
  isValidCapabilityValue: () => isValidCapabilityValue,
  lazyEntriesFor: () => lazyEntriesFor,
  legacyModelCatalogCacheDir: () => legacyModelCatalogCacheDir,
  listingAuthorityFor: () => listingAuthorityFor,
  loadOrCreateFingerprintSalt: () => loadOrCreateFingerprintSalt,
  loadPromptExtensions: () => loadPromptExtensions,
  loadSessionContext: () => loadSessionContext,
  loadVerifiedM0Reports: () => loadVerifiedM0Reports,
  loadWrittenAdjudications: () => loadWrittenAdjudications,
  makeFingerprint: () => makeFingerprint,
  maxComplexity: () => maxComplexity,
  migrationPreview: () => migrationPreview,
  modelCatalogCacheDir: () => modelCatalogCacheDir,
  nextGeneration: () => nextGeneration,
  normalizeDiscovery: () => normalizeDiscovery,
  normalizeHostId: () => normalizeHostId,
  nullIo: () => nullIo,
  parseCompatibilityUsageV1: () => parseCompatibilityUsageV1,
  parseModelsArgs: () => parseModelsArgs,
  parseNativeToml: () => parseNativeToml,
  parseSelector: () => parseSelector,
  persistIndependenceAdjudication: () => persistIndependenceAdjudication,
  persistInspectionReport: () => persistInspectionReport,
  persistResolutionReceipt: () => persistResolutionReceipt,
  planModeTransition: () => planModeTransition,
  planTeamRouting: () => planTeamRouting,
  policyDefaults: () => policyDefaults,
  policyFilesFor: () => policyFilesFor,
  policyKeySpec: () => policyKeySpec,
  policyOverlayFile: () => policyOverlayFile,
  policyValue: () => policyValue,
  projectionAllowed: () => projectionAllowed,
  promptIdentityIn: () => promptIdentityIn,
  publishSnapshot: () => publishSnapshot,
  purgeRunLocalEntries: () => purgeRunLocalEntries,
  purposeClassFor: () => purposeClassFor,
  purposeComplexityFloor: () => purposeComplexityFloor,
  purposeTierFloor: () => purposeTierFloor,
  rankScore: () => rankScore,
  reachableComplexities: () => reachableComplexities,
  readCatalogEntry: () => readCatalogEntry,
  readRoutingFlags: () => readRoutingFlags,
  readSessionBinding: () => readSessionBinding,
  readSnapshot: () => readSnapshot,
  readUnderLockTimeout: () => readUnderLockTimeout,
  recommendProvider: () => recommendProvider,
  recordAttempt: () => recordAttempt,
  recordDecision: () => recordDecision,
  recordRunInspectionEvidence: () => recordRunInspectionEvidence,
  registryIdToCanonicalHostKind: () => registryIdToCanonicalHostKind,
  requiredAssetIdsForG5: () => requiredAssetIdsForG5,
  requiredEntriesFor: () => requiredEntriesFor,
  resolve: () => resolve16,
  resolveAuthorHost: () => resolveAuthorHost,
  resolveCapability: () => resolveCapability,
  resolveEffectivePurpose: () => resolveEffectivePurpose,
  resolveModel: () => resolveModel,
  resolveModelParams: () => resolveModelParams,
  resolvePolicy: () => resolvePolicy,
  resolveRoles: () => resolveRoles,
  resolveRolesForRun: () => resolveRolesForRun,
  resolveRung: () => resolveRung,
  resolveSettings: () => resolveSettings2,
  resolveSettingsUntraced: () => resolveSettings,
  resolveTierModel: () => resolveTierModel,
  resolveWithLegacy: () => resolveWithLegacy,
  resolveWorkspaceMode: () => resolveWorkspaceMode,
  resolverModePolicy: () => resolverModePolicy,
  resolverModeRank: () => resolverModeRank,
  restoreSessionContext: () => restoreSessionContext,
  resultAdapterForFamily: () => resultAdapterForFamily,
  resultAdapterForHostId: () => resultAdapterForHostId,
  resultAdapterForHostKind: () => resultAdapterForHostKind,
  rigorProfile: () => rigorProfile,
  roleSlugDedupKey: () => roleSlugDedupKey,
  rollbackV2Routing: () => rollbackV2Routing,
  rollupCompatibilityUsage: () => rollupCompatibilityUsage,
  route: () => route,
  runAdapter: () => runAdapter,
  runModelsCommand: () => runModelsCommand,
  runScopeFor: () => runScopeFor,
  rungLoss: () => rungLoss,
  scaffoldFor: () => scaffoldFor,
  scanHostIdentity: () => scanHostIdentity,
  selectCodexMarketplaceIdentity: () => selectCodexMarketplaceIdentity,
  selectReviewer: () => selectReviewer,
  selectRoute: () => selectRoute,
  sessionBindingPath: () => sessionBindingPath,
  sessionContextPath: () => sessionContextPath,
  setByPath: () => setByPath2,
  sha256Hex: () => sha256Hex2,
  simulateCatalogChange: () => simulateCatalogChange,
  singleflight: () => singleflight,
  singleflightDiscover: () => singleflightDiscover,
  suggestWorkspaceMode: () => suggestWorkspaceMode,
  suggestableAssets: () => suggestableAssets,
  tierDefaults: () => tierDefaults,
  tierDefaultsForHost: () => tierDefaultsForHost,
  tierForCanonicalId: () => tierForCanonicalId,
  tierForComplexity: () => tierForComplexity,
  tierForModel: () => tierForModel,
  toolVersionInRange: () => toolVersionInRange,
  totalCatalogOrder: () => totalCatalogOrder,
  validateAdjudicationRef: () => validateAdjudicationRef,
  validateCrossHostBlock: () => validateCrossHostBlock,
  validateDefaults: () => validateDefaults,
  validateDegradationReceipt: () => validateDegradationReceipt,
  validateHostCapabilitiesV1: () => validateHostCapabilitiesV1,
  validateHostProfiles: () => validateHostProfiles,
  validateHostRegistryEntry: () => validateHostRegistryEntry,
  validateIndependenceBinding: () => validateIndependenceBinding,
  validateLadderTableComplete: () => validateLadderTableComplete,
  validateMcp: () => validateMcp,
  validateModelPolicy: () => validateModelPolicy,
  validateModels: () => validateModels,
  validatePolicyValue: () => validatePolicyValue,
  validateRoleResolutionSet: () => validateRoleResolutionSet,
  validateSecretsPolicy: () => validateSecretsPolicy,
  validateSecurity: () => validateSecurity,
  validateWrittenAdjudication: () => validateWrittenAdjudication,
  verifyResolutionReceipt: () => verifyResolutionReceipt,
  withBudget: () => withBudget,
  writePolicyOverlay: () => writePolicyOverlay,
  writeSessionContext: () => writeSessionContext
});
var MODULE_PUBLIC_API_VERSION;
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
    init_native_config_parser();
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
    MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1";
  }
});

// hooks/update-check.ts
var fs31 = __toESM(require("fs"));
var os4 = __toESM(require("os"));
var path36 = __toESM(require("path"));
var import_child_process3 = require("child_process");

// scripts/lib/update-check.ts
var fs29 = __toESM(require("fs"));
var os3 = __toESM(require("os"));
var path34 = __toESM(require("path"));
var import_child_process2 = require("child_process");
init_config2();

// scripts/lib/state/storage.ts
init_state();

// scripts/lib/update-check.ts
var SOURCE_REPO_DEFAULT = "https://github.com/lookatitude/guild.git";
var CACHE_SCHEMA = "guild.update_check_cache.v1";
var RECEIPT_SCHEMA = "guild.install_receipt.v1";
var RECEIPT_BASENAME = "guild-install-receipt.json";
function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}
function parseComparable(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
  if (!m) return null;
  return {
    triple: [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)],
    prerelease: m[4] ? m[4].split(".") : []
  };
}
function comparePrereleaseIds(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Number(a) - Number(b);
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function semverLt(a, b) {
  const pa = parseComparable(a);
  const pb = parseComparable(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa.triple[i] !== pb.triple[i]) return pa.triple[i] < pb.triple[i];
  }
  if (pa.prerelease.length === 0 || pb.prerelease.length === 0) {
    return pa.prerelease.length > 0 && pb.prerelease.length === 0;
  }
  const shared = Math.min(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < shared; i++) {
    const cmp = comparePrereleaseIds(pa.prerelease[i], pb.prerelease[i]);
    if (cmp !== 0) return cmp < 0;
  }
  return pa.prerelease.length < pb.prerelease.length;
}
function latestStableTag(tags) {
  let best = null;
  for (const t of tags) {
    if (!parseSemver(t)) continue;
    if (best === null || semverLt(best, t)) best = t;
  }
  return best;
}
function parseLsRemote(raw) {
  const tags = [];
  let next = null;
  let main2 = null;
  for (const line of raw.split("\n")) {
    const m = /^([0-9a-f]{40})\s+(\S+)$/.exec(line.trim());
    if (!m) continue;
    const [, sha, ref] = m;
    if (ref === "refs/heads/next") next = sha;
    else if (ref === "refs/heads/main") main2 = sha;
    else if (ref.startsWith("refs/tags/v") && !ref.endsWith("^{}")) {
      tags.push(ref.slice("refs/tags/".length));
    }
  }
  return { latest_tag: latestStableTag(tags), next_head_sha: next, main_head_sha: main2 };
}
function readNativeHostIdentity(hostId, pluginRoot, opts = {}) {
  const fsi = opts.fsi ?? fs29;
  const home = opts.homedir ?? os3.homedir();
  const realPath = (value) => {
    try {
      return fsi.realpathSync(value);
    } catch {
      return value;
    }
  };
  const isSha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
  if (hostId === "claude-code-cli" || hostId === "claude-code-app" || hostId === "claude-code-web") {
    const roots = claudeConfigRoots({
      homedir: home,
      claudeConfigDir: opts.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR,
      joiner: path34.join
    });
    for (const configRoot of roots) {
      try {
        const installed = JSON.parse(
          fsi.readFileSync(path34.join(configRoot, "plugins", "installed_plugins.json"), "utf8")
        );
        const plugins = installed.plugins ?? {};
        const matches = [];
        let malformedMatch = false;
        for (const aliasKey of Object.keys(plugins)) {
          const rawEntries = plugins[aliasKey];
          const entries = Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : [];
          for (const candidate of entries) {
            if (typeof candidate !== "object" || candidate === null) continue;
            const { installPath, gitCommitSha } = candidate;
            if (typeof installPath !== "string" || realPath(installPath) !== realPath(pluginRoot)) continue;
            if (!isSha(gitCommitSha)) {
              malformedMatch = true;
              continue;
            }
            const at = aliasKey.lastIndexOf("@");
            matches.push({
              marketplace: at > 0 ? aliasKey.slice(at + 1) : aliasKey,
              commit: gitCommitSha
            });
          }
        }
        if (malformedMatch) return null;
        if (matches.length === 0) continue;
        const first = matches[0];
        if (matches.some((m) => m.commit !== first.commit || m.marketplace !== first.marketplace)) {
          return null;
        }
        const known2 = JSON.parse(
          fsi.readFileSync(path34.join(configRoot, "plugins", "known_marketplaces.json"), "utf8")
        );
        const installLocation = known2[first.marketplace]?.installLocation;
        if (typeof installLocation !== "string") continue;
        const gitDir = resolveGitDir(path34.join(realPath(installLocation), ".git"), fsi);
        if (!gitDir) continue;
        const branch = readGitHead(gitDir, fsi).branch;
        if (branch !== "main" && branch !== "next") return null;
        return { channel: branch === "next" ? "beta" : "stable", commit: first.commit };
      } catch {
      }
    }
    return null;
  }
  if (hostId === "codex-cli" || hostId === "codex-app") {
    try {
      const configuredCodexHome = codexConfigHome({
        homedir: home,
        codexHome: opts.codexHome ?? process.env.CODEX_HOME,
        joiner: path34.join
      });
      const realCodexHome = realPath(configuredCodexHome);
      const realRoot2 = realPath(pluginRoot);
      if (realRoot2 !== realCodexHome && !realRoot2.startsWith(realCodexHome + path34.sep)) {
        return null;
      }
      const raw = fsi.readFileSync(path34.join(configuredCodexHome, "config.toml"), "utf8");
      const selection = selectCodexMarketplaceIdentity(raw);
      if (selection.status !== "selected") return null;
      let sawAliasDir = false;
      for (const alias of selection.aliases) {
        if (alias === "." || alias === ".." || /[/\\]/.test(alias)) continue;
        const aliasDir = path34.join(configuredCodexHome, "marketplaces", alias);
        try {
          if (!fsi.statSync(aliasDir).isDirectory()) continue;
        } catch {
          continue;
        }
        sawAliasDir = true;
        const realAliasDir = realPath(aliasDir);
        if (realRoot2 === realAliasDir || realRoot2.startsWith(realAliasDir + path34.sep)) {
          return selection.identity;
        }
      }
      return sawAliasDir ? null : selection.identity;
    } catch {
      return null;
    }
  }
  return null;
}
function resolveGitDir(gitPath, fsi = fs29) {
  try {
    const st = fsi.statSync(gitPath);
    if (st.isDirectory()) return gitPath;
    if (st.isFile()) {
      const m = /^gitdir:\s*(.+)\s*$/m.exec(fsi.readFileSync(gitPath, "utf8"));
      if (!m) return null;
      const target = m[1].trim();
      return path34.isAbsolute(target) ? target : path34.resolve(path34.dirname(gitPath), target);
    }
  } catch {
  }
  return null;
}
function readGitHead(gitDir, fsi = fs29) {
  const headPath = path34.join(gitDir, "HEAD");
  if (!fsi.existsSync(headPath)) return { branch: null, sha: null };
  const head = fsi.readFileSync(headPath, "utf8").trim();
  const refMatch = /^ref:\s*refs\/heads\/(\S+)$/.exec(head);
  if (!refMatch) {
    return { branch: null, sha: /^[0-9a-f]{40}$/.test(head) ? head : null };
  }
  const branch = refMatch[1];
  const refRoots = [gitDir];
  const commondirFile = path34.join(gitDir, "commondir");
  if (fsi.existsSync(commondirFile)) {
    const common = fsi.readFileSync(commondirFile, "utf8").trim();
    refRoots.push(path34.isAbsolute(common) ? common : path34.resolve(gitDir, common));
  }
  for (const root of refRoots) {
    const looseRef = path34.join(root, "refs", "heads", branch);
    if (fsi.existsSync(looseRef)) {
      const sha = fsi.readFileSync(looseRef, "utf8").trim();
      return { branch, sha: /^[0-9a-f]{40}$/.test(sha) ? sha : null };
    }
    const packed = path34.join(root, "packed-refs");
    if (fsi.existsSync(packed)) {
      for (const line of fsi.readFileSync(packed, "utf8").split("\n")) {
        const m = /^([0-9a-f]{40})\s+refs\/heads\/(\S+)$/.exec(line.trim());
        if (m && m[2] === branch) return { branch, sha: m[1] };
      }
    }
  }
  return { branch, sha: null };
}
function branchToChannel(branch) {
  if (branch === "next") return "beta";
  return "stable";
}
function resolveInstallState(pluginRoot, opts = {}) {
  const fsi = opts.fsi ?? fs29;
  const home = opts.homedir ?? os3.homedir();
  const real = (() => {
    try {
      return fsi.realpathSync(pluginRoot);
    } catch {
      return pluginRoot;
    }
  })();
  const version = readInstalledVersion(pluginRoot, fsi);
  const managedRoots = claudeConfigRoots({
    homedir: home,
    claudeConfigDir: opts.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR,
    joiner: path34.join
  }).map((root) => path34.join(root, "plugins")).map((m) => {
    try {
      return fsi.realpathSync(m);
    } catch {
      return m;
    }
  });
  const isManaged = managedRoots.some(
    (m) => real === m || real.startsWith(m + path34.sep)
  );
  const gitDir = resolveGitDir(path34.join(real, ".git"), fsi);
  if (gitDir) {
    const { branch, sha } = readGitHead(gitDir, fsi);
    if (!isManaged) {
      return { channel: "dev", version, commit: sha, source: "dev-checkout" };
    }
    return {
      channel: branchToChannel(branch),
      version,
      commit: sha,
      source: "marketplace-clone"
    };
  }
  const receiptPath = path34.join(real, RECEIPT_BASENAME);
  if (fsi.existsSync(receiptPath)) {
    try {
      const r = JSON.parse(fsi.readFileSync(receiptPath, "utf8"));
      if (r.schema_version === RECEIPT_SCHEMA) {
        return {
          channel: r.channel === "beta" ? "beta" : "stable",
          version: r.version ?? version,
          commit: r.commit ?? null,
          source: "receipt"
        };
      }
    } catch {
    }
  }
  if (opts.nativeIdentity) {
    return {
      channel: opts.nativeIdentity.channel,
      version,
      commit: opts.nativeIdentity.commit,
      source: "host-registry"
    };
  }
  return { channel: "stable", version, commit: null, source: "default" };
}
var PLUGIN_MANIFEST_CANDIDATES = [
  [".claude-plugin", "plugin.json"],
  [".codex-plugin", "plugin.json"]
];
function readInstalledVersion(pluginRoot, fsi = fs29) {
  for (const [dir, file] of PLUGIN_MANIFEST_CANDIDATES) {
    try {
      const manifest = JSON.parse(fsi.readFileSync(path34.join(pluginRoot, dir, file), "utf8"));
      if (typeof manifest.version === "string" && manifest.version.length > 0) return manifest.version;
    } catch {
    }
  }
  return null;
}
function cachePath(homedir5 = os3.homedir()) {
  return path34.join(durableGuildDir(homedir5), "update-check.json");
}
function readCache(file, fsi = fs29) {
  try {
    const c = JSON.parse(fsi.readFileSync(file, "utf8"));
    return c.schema_version === CACHE_SCHEMA ? c : null;
  } catch {
    return null;
  }
}
function cacheIsFresh(cache, ttlHours, now) {
  if (!cache) return false;
  const age = now.getTime() - Date.parse(cache.checked_at);
  return Number.isFinite(age) && age >= 0 && age < ttlHours * 36e5;
}
function refreshCache(opts) {
  const repo = opts.repo ?? SOURCE_REPO_DEFAULT;
  const file = opts.file ?? cachePath();
  const fsi = opts.fsi ?? fs29;
  const run = opts.runner ?? ((cmd, args) => (0, import_child_process2.execFileSync)(cmd, args, { encoding: "utf8", timeout: 15e3 }));
  try {
    const raw = run("git", ["ls-remote", "--tags", "--heads", repo]);
    const cache = {
      schema_version: CACHE_SCHEMA,
      checked_at: (opts.now ?? /* @__PURE__ */ new Date()).toISOString(),
      source_repo: repo,
      remote: parseLsRemote(raw)
    };
    fsi.mkdirSync(path34.dirname(file), { recursive: true });
    fsi.writeFileSync(file, JSON.stringify(cache, null, 2) + "\n", "utf8");
    return cache;
  } catch {
    return null;
  }
}
function updateCapsForHost(hostId) {
  if (!hostId) return null;
  const row = HOST_REGISTRY_ROWS[hostId];
  return row ? row.capabilities.package.update : null;
}
function computeSignal(opts) {
  const { state, cache } = opts;
  const short = (sha) => sha ? sha.slice(0, 7) : "unknown";
  const installedLabel = state.channel === "beta" ? short(state.commit) : state.version ?? "unknown";
  const base = {
    channel: state.channel,
    installed: installedLabel,
    available: null,
    command: null
  };
  if (state.channel === "dev") {
    return { ...base, update_available: false, reason: "dev-install" };
  }
  if (!cache) {
    return { ...base, update_available: false, reason: "no-cache" };
  }
  const rowCaps = updateCapsForHost(opts.hostId);
  const command = opts.hostId !== void 0 ? rowCaps ? rowCaps.command : null : opts.hostKind === "wrapper" ? "guild-run update" : opts.hostKind === "agents-file" ? "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update" : "claude plugin marketplace update guild && claude plugin update guild@guild";
  if (state.channel === "beta") {
    const remoteSha2 = cache.remote.next_head_sha;
    if (remoteSha2 && state.commit && remoteSha2 !== state.commit) {
      return {
        ...base,
        update_available: true,
        available: short(remoteSha2),
        command,
        reason: "beta-new-commit"
      };
    }
    return { ...base, update_available: false, reason: "up-to-date" };
  }
  const latest = cache.remote.latest_tag;
  const remoteSha = cache.remote.main_head_sha;
  if (remoteSha && state.commit) {
    if (remoteSha !== state.commit) {
      return {
        ...base,
        update_available: true,
        available: latest ? latest.replace(/^v/, "") : short(remoteSha),
        command,
        reason: "stable-new-commit"
      };
    }
    return { ...base, update_available: false, reason: "up-to-date" };
  }
  if (latest && state.version) {
    const installed = parseComparable(state.version);
    const published = parseComparable(latest);
    if (installed && published && /^\d+\.\d+\.\d+-beta\.(?:0|[1-9]\d*)$/.test(state.version) && installed.prerelease.length > 0 && published.prerelease.length === 0 && installed.triple.every((part, index) => part === published.triple[index])) {
      return { ...base, update_available: false, reason: "up-to-date" };
    }
  }
  if (latest && state.version && semverLt(state.version, latest)) {
    return {
      ...base,
      update_available: true,
      // The cache stores the tag verbatim ("v2.4.0"); the signal compares and
      // renders VERSIONS, so strip the tag prefix — "2.2.0 → v2.4.0" mixed the
      // two vocabularies (observed live in the v2.4.0 validation pass).
      available: latest.replace(/^v/, ""),
      command,
      reason: "stable-newer-tag"
    };
  }
  return { ...base, update_available: false, reason: "up-to-date" };
}
function renderSignalLine(sig) {
  if (!sig.update_available || !sig.available) return null;
  const channelLabel = sig.channel === "beta" ? "beta (next)" : "stable";
  return `Guild update available on ${channelLabel}: ${sig.installed} \u2192 ${sig.available}` + (sig.command ? ` \u2014 run: ${sig.command}` : "");
}

// hooks/update-check.ts
init_state();

// scripts/lib/state/ensure-storage-layout.ts
var fs30 = __toESM(require("node:fs"));
var path35 = __toESM(require("node:path"));

// scripts/lib/guild-root.ts
init_guild_root();

// scripts/lib/state/ensure-storage-layout.ts
var CURRENT_LAYOUT_VERSION = 2;
function markerPath(root) {
  return path35.join(root, ".guild", "storage-layout.json");
}
function detect2(cwd = process.cwd()) {
  const root = resolveGuildRoot(cwd);
  const marker = markerPath(root);
  if (!fs30.existsSync(path35.join(root, ".guild"))) {
    return { state: "absent", version: null, root, marker };
  }
  let version = null;
  try {
    const parsed = JSON.parse(fs30.readFileSync(marker, "utf8"));
    if (typeof parsed.storage_layout_version === "number") version = parsed.storage_layout_version;
  } catch {
    version = null;
  }
  if (version === null) return { state: "unmarked", version, root, marker };
  if (version === CURRENT_LAYOUT_VERSION) return { state: "current", version, root, marker };
  return { state: version > CURRENT_LAYOUT_VERSION ? "future" : "stale", version, root, marker };
}
var upgradeChunk = null;
function upgradeChain() {
  if (upgradeChunk === null) {
    const candidates = [
      path35.join(__dirname, "upgrade-chain.js"),
      path35.join(__dirname, "lib", "state", "upgrade-chain"),
      path35.join(__dirname, "upgrade-chain")
    ];
    const spec = candidates.find((c) => fs30.existsSync(c) || fs30.existsSync(`${c}.ts`)) ?? candidates[2];
    upgradeChunk = require(spec);
  }
  return upgradeChunk;
}
function ensureStorageLayout(cwd = process.cwd(), opts = {}) {
  const status = detect2(cwd);
  if (status.state === "current") return status;
  if (status.state === "future") {
    throw new Error(
      `guild: .guild/ is layout ${status.version}, this build understands ${CURRENT_LAYOUT_VERSION}. Upgrade Guild; a newer layout is never down-migrated (${status.marker}).`
    );
  }
  if (status.state === "absent" || opts.detectOnly === true) return status;
  const chain = upgradeChain();
  const result2 = chain.runLayoutUpgrade({
    root: status.root,
    fromVersion: status.version,
    toVersion: CURRENT_LAYOUT_VERSION,
    dryRun: opts.dryRun === true
  });
  const after = detect2(cwd);
  return { ...after, upgrade: result2 };
}
function isProcessEntry() {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry === "") return false;
  return /(^|[\\/])ensure-storage-layout(\.[cm]?[jt]s)?$/.test(entry);
}
if (isProcessEntry()) {
  const cwdArg = process.argv.find((a) => a.startsWith("--cwd="));
  const cwd = cwdArg ? cwdArg.slice("--cwd=".length) : process.cwd();
  try {
    const status = ensureStorageLayout(cwd, {
      dryRun: process.argv.includes("--dry-run"),
      detectOnly: process.argv.includes("--detect-only")
    });
    if (process.argv.includes("--print")) {
      process.stdout.write(JSON.stringify(status) + "\n");
    } else if (status.upgrade && status.upgrade.state !== "committed") {
      process.stderr.write(`${status.upgrade.report}
`);
    }
    process.exit(0);
  } catch (e) {
    process.stderr.write(`${e.message}
`);
    process.exit(1);
  }
}

// hooks/update-check.ts
function readUpdateConfig(cwd) {
  const defaults = { mode: "notify", cadenceHours: 24 };
  try {
    const { resolveSettings: resolveSettings3 } = (init_config2(), __toCommonJS(config_exports));
    const parsed = resolveSettings3({ cwd }).config;
    const u = parsed.defaults?.update ?? {};
    const mode = u.mode === "auto" || u.mode === "notify" || u.mode === "off" ? u.mode : defaults.mode;
    const cadenceHours = typeof u.cadence_hours === "number" && u.cadence_hours > 0 ? u.cadence_hours : defaults.cadenceHours;
    return { mode, cadenceHours };
  } catch {
    return defaults;
  }
}
function stagedMarkerPath() {
  return path36.join(durableGuildDir(os4.homedir()), "update-staged.json");
}
function alreadyStaged(target) {
  try {
    const m = JSON.parse(fs31.readFileSync(stagedMarkerPath(), "utf8"));
    return m.target === target;
  } catch {
    return false;
  }
}
function markStaged(target) {
  try {
    fs31.mkdirSync(path36.dirname(stagedMarkerPath()), { recursive: true });
    fs31.writeFileSync(
      stagedMarkerPath(),
      JSON.stringify({ target, staged_at: (/* @__PURE__ */ new Date()).toISOString() }) + "\n",
      "utf8"
    );
  } catch {
  }
}
function spawnDetached(cmd, args) {
  try {
    const child = (0, import_child_process3.spawn)(cmd, args, {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch {
  }
}
function main() {
  if (process.argv.includes("--refresh")) {
    refreshCache({});
    return;
  }
  const pluginRoot = process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"];
  if (!pluginRoot) return;
  try {
    ensureStorageLayout(process.cwd(), { detectOnly: true });
  } catch {
    return;
  }
  const { mode, cadenceHours } = readUpdateConfig(process.cwd());
  if (mode === "off") return;
  const hostArg = process.argv.indexOf("--host");
  let hostId = "claude-code-cli";
  if (hostArg !== -1) {
    const raw = process.argv[hostArg + 1];
    hostId = raw === void 0 || raw.startsWith("-") || raw === "" ? "unknown-host" : raw;
  }
  const caps = updateCapsForHost(hostId);
  const hostKind = caps?.apply === "marketplace_cli" ? "claude" : caps?.apply === "self_update" ? "wrapper" : "agents-file";
  const nativeIdentity = readNativeHostIdentity(hostId, pluginRoot);
  let state = resolveInstallState(pluginRoot, { nativeIdentity });
  if (state.channel === "dev") return;
  const cacheFile = cachePath();
  const cache = readCache(cacheFile);
  const versionDerivedBeta = state.version !== null && /^\d+\.\d+\.\d+-beta\.(?:0|[1-9]\d*)$/.test(state.version);
  const launcherDeclaredBeta = versionDerivedBeta && process.env["GUILD_ACTIVATION_CHANNEL"] === "beta";
  if (state.source === "default" && versionDerivedBeta && !launcherDeclaredBeta) {
    if (!cacheIsFresh(cache, cadenceHours, /* @__PURE__ */ new Date())) {
      spawnDetached(process.execPath, [__filename, "--refresh"]);
    }
    process.stdout.write(
      `[guild-update] channel undetermined: installed version ${state.version} is candidate-shaped but no host registry identity was found \u2014 update checks are paused for this install until its channel is known.
`
    );
    return;
  }
  if (state.source === "default" && state.version && (!versionDerivedBeta || launcherDeclaredBeta)) {
    try {
      const receiptPath = path36.join(pluginRoot, RECEIPT_BASENAME);
      const receiptChannel = launcherDeclaredBeta ? "beta" : state.channel;
      const descriptor = fs31.openSync(
        receiptPath,
        fs31.constants.O_WRONLY | fs31.constants.O_CREAT | fs31.constants.O_EXCL | fs31.constants.O_NOFOLLOW,
        384
      );
      try {
        if (!fs31.fstatSync(descriptor).isFile()) throw new Error("receipt target is not a regular file");
        fs31.writeFileSync(
          descriptor,
          JSON.stringify(
            {
              schema_version: RECEIPT_SCHEMA,
              host: hostId,
              channel: receiptChannel,
              ref: receiptChannel === "beta" ? "next" : "main",
              commit: null,
              version: state.version,
              installed_at: (/* @__PURE__ */ new Date()).toISOString(),
              minted_by: "update-check-session-start",
              // Honesty marker: only an unambiguous stable/main DEFAULT or a
              // launcher-declared beta reaches this branch. Other
              // candidate-shaped packages without host identity mint nothing.
              // Nothing may clone from this receipt: codex-cli's capability
              // row is reinstall_command (never self_update), so the receipt
              // is identification-only.
              managed_by: "host-native",
              channel_confidence: launcherDeclaredBeta ? "launcher-declared" : "assumed-default"
            },
            null,
            2
          ) + "\n"
        );
        fs31.fsyncSync(descriptor);
      } finally {
        fs31.closeSync(descriptor);
      }
    } catch {
    }
  }
  if (launcherDeclaredBeta && state.source === "default") {
    state = { ...state, channel: "beta" };
  }
  if (!cacheIsFresh(cache, cadenceHours, /* @__PURE__ */ new Date())) {
    spawnDetached(process.execPath, [__filename, "--refresh"]);
  }
  const signal = computeSignal({ state, cache, hostKind, hostId });
  const line = renderSignalLine(signal);
  if (!line) return;
  if (mode === "auto" && caps?.auto_capable !== true) {
    const followUp = signal.command ? "run the command above." : "and no update command is known for this host \u2014 see the Guild docs.";
    process.stdout.write(`${line}
[guild-update] auto mode: ${hostId} cannot auto-apply \u2014 ${followUp}
`);
    return;
  }
  if (mode === "auto") {
    const target = `${hostId}@${signal.available ?? ""}`;
    if (!alreadyStaged(target)) {
      spawnDetached("/bin/sh", ["-c", caps.command]);
      markStaged(target);
      process.stdout.write(
        `${line}
[guild-update] auto mode: update staged \u2014 it takes effect next session.
`
      );
      return;
    }
    process.stdout.write(
      `${line}
[guild-update] auto mode: already staged \u2014 restart to apply.
`
    );
    return;
  }
  process.stdout.write(`${line}
`);
}
try {
  main();
} catch {
}
process.exit(0);
