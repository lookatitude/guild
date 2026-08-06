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
    path2.resolve(__dirname, "..", "..", "..", "..", "scripts"),
    // Bundled hook layout: hooks/dist -> plugin/scripts.
    path2.resolve(__dirname, "..", "..", "scripts"),
    // Bundled agent-team hook layout: hooks/agent-team/dist -> plugin/scripts.
    path2.resolve(__dirname, "..", "..", "..", "scripts")
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
  const cwdRoot = path2.resolve(process.cwd(), "scripts");
  tried.push(cwdRoot);
  const api = tryScriptsRoot(cwdRoot);
  if (api) return api;
  throw new Error(
    `Guild needs the js-yaml package and could not resolve it. Fix: npm install --prefix <plugin-root>/scripts (roots tried: ${tried.join(", ")})`
  );
}
var path2;
var init_yaml_loader = __esm({
  "../src/modules/kernel/workflows/yaml-loader.ts"() {
    path2 = __toESM(require("node:path"));
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
function isRefused(r) {
  return "code" in r;
}
function escapes(rel) {
  return rel === ".." || rel.startsWith(`..${path3.sep}`) || path3.isAbsolute(rel);
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
  const rel = path3.relative(parent, child);
  return rel === "" || !escapes(rel);
}
function checkContained(root, target, options = {}) {
  const policy = options.policy ?? "resolve";
  let realRoot;
  try {
    realRoot = fs2.realpathSync(path3.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }
  if (hasParentSegment(target)) {
    return refuse(
      "parent-traversal",
      `refusing a path spelled with a ".." segment (${target}) \u2014 parent traversal cannot be resolved before symlinks`
    );
  }
  const abs = path3.isAbsolute(target) ? path3.resolve(target) : path3.resolve(realRoot, target);
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
  const rel = path3.relative(realRoot, realProbe);
  if (rel !== "" && escapes(rel)) {
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
      const segRel = path3.relative(realRoot, segReal);
      const strictlyInside = segRel !== "" && !escapes(segRel);
      if (strictlyInside) {
        return refuse("physical-symlink", `refusing \u2014 symlinked path segment: ${walk}`);
      }
    }
  }
  const tail = path3.relative(probe, abs);
  const realPath = tail === "" ? realProbe : path3.join(realProbe, tail);
  return Object.freeze({ contained: true, realRoot, realPath });
}
var fs2, path3, CONTAINMENT_REFUSAL_CODES;
var init_path_containment = __esm({
  "../src/modules/kernel/workflows/path-containment.ts"() {
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

// ../src/modules/lifecycle/workflows/event-log-schema.ts
var TOOL_CALL_TOOL_VALUES, HOOK_EVENT_NAMES, EVENT_TYPES;
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

// ../src/modules/state/workflows/plugin-install-guard.ts
var init_plugin_install_guard = __esm({
  "../src/modules/state/workflows/plugin-install-guard.ts"() {
  }
});

// ../src/modules/state/workflows/atomic-write.ts
var init_atomic_write = __esm({
  "../src/modules/state/workflows/atomic-write.ts"() {
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
  const resolvedStart = path4.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs3.existsSync(path4.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path4.join(current, ".guild");
      try {
        if (fs3.existsSync(guildDir) && fs3.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
      }
    }
    const parent = path4.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}
var fs3, path4;
var init_guild_root = __esm({
  "../src/modules/state/workflows/guild-root.ts"() {
    fs3 = __toESM(require("node:fs"));
    path4 = __toESM(require("node:path"));
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
    const abs = path5.isAbsolute(raw) ? raw : path5.resolve(cwd, raw);
    const root = path5.dirname(abs);
    if (fs4.existsSync(root)) return root;
  } catch {
  }
  return path5.resolve(cwd);
}
function runMigrations(dbPath) {
  let db;
  let fromVersion = 0;
  try {
    fs4.mkdirSync(path5.dirname(dbPath), { recursive: true });
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
    dbPath = path5.join(guildRoot, ".guild", "index.sqlite");
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
var import_node_child_process, fs4, path5, CURRENT_SCHEMA_VERSION, MIGRATIONS;
var init_index_migrate = __esm({
  "../src/modules/migrations/workflows/index-migrate.ts"() {
    import_node_child_process = require("node:child_process");
    fs4 = __toESM(require("node:fs"));
    path5 = __toESM(require("node:path"));
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
  const settingsPath = path6.join(resolveGuildRoot2(cwd), ".guild", "settings.json");
  let raw;
  try {
    raw = fs5.readFileSync(settingsPath, "utf8");
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
var fs5, path6;
var init_config = __esm({
  "../src/modules/security/workflows/config.ts"() {
    fs5 = __toESM(require("node:fs"));
    path6 = __toESM(require("node:path"));
    init_state();
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
    const logsDir = path7.join(runDir2, "logs");
    fs6.mkdirSync(logsDir, { recursive: true });
    fs6.appendFileSync(path7.join(logsDir, "security-events.jsonl"), JSON.stringify(record) + "\n", "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [security-events] write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}
var fs6, path7, SECURITY_EVENT_SCHEMA_VERSION, KNOWN_GUILD_HOST_KINDS, KNOWN_GUILD_HOST_ID_SET, LEGACY_HOST_ALIASES;
var init_events = __esm({
  "../src/modules/security/workflows/events.ts"() {
    fs6 = __toESM(require("node:fs"));
    path7 = __toESM(require("node:path"));
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

// ../src/modules/security/workflows/scrubbed-write.ts
function guildRootFromRunDir(runDir2) {
  return path8.resolve(runDir2, "../../..");
}
function writeScrubApprovalRequest(runDir2, runId, surface, outPath, laneId) {
  try {
    const approvalDir = path8.join(runDir2, "agent-bus", "approvals");
    fs7.mkdirSync(approvalDir, { recursive: true });
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    const safeTs = ts.replace(/[:.]/g, "-");
    const fileName = `${safeTs}-scrub-blocked.json`;
    const record = {
      schema_version: "guild.approval_request.v1",
      ts,
      run_id: runId,
      tool: "scrubbedWrite",
      reason: `Secret scrub failed for durable surface "${surface}" \u2014 write blocked. Human review required. Path: ${path8.basename(outPath)}`,
      permission_mode: "blocked",
      surface
    };
    if (laneId) record["lane_id"] = laneId;
    const rawContent = JSON.stringify(record, null, 2) + "\n";
    let content = rawContent;
    try {
      const secConfig = readSecurityConfig(guildRootFromRunDir(runDir2));
      const scrubResult = applySecretsPolicy(rawContent, secConfig.secrets_policy, { noTruncate: true });
      content = scrubResult.value;
    } catch {
    }
    fs7.writeFileSync(path8.join(approvalDir, fileName), content, "utf8");
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
      fs7.mkdirSync(path8.dirname(outPath), { recursive: true });
      fs7.writeFileSync(outPath, scrubResult.value, "utf8");
    } catch (err) {
      process.stderr.write(
        `[scrubbed-write] ERROR: write failed for surface "${opts.surface}" at ${outPath}: ${err instanceof Error ? err.message : String(err)}
`
      );
      return { written: false, blocked: false };
    }
    const result = { written: true, blocked: false };
    if (opts.surface === "bus") {
      result.sha256 = crypto.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
    }
    return result;
  }
  if (failMode === "open") {
    process.stderr.write(
      `[scrubbed-write] WARN: secret scrub custom-pattern failure for surface "${opts.surface}" at ${path8.basename(outPath)} \u2014 writing built-in-redacted content (fail-open). Failures: ${scrubResult.failures.join("; ")}
`
    );
    try {
      fs7.mkdirSync(path8.dirname(outPath), { recursive: true });
      fs7.writeFileSync(outPath, scrubResult.value, "utf8");
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
        detail: `Secret scrub custom-pattern failure (fail-open) for surface "${opts.surface}" at ${path8.basename(outPath)}. Built-in-redacted content written.`,
        permission_mode: "degraded"
      });
      appendSecurityEvent(opts.runDir, evt);
    } catch {
    }
    const result = { written: true, blocked: false };
    if (opts.surface === "bus") {
      result.sha256 = crypto.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
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
      detail: `Secret scrub failed for durable surface "${opts.surface}" at ${path8.basename(outPath)} \u2014 write blocked (fail-closed).`,
      permission_mode: "blocked"
    });
    appendSecurityEvent(opts.runDir, evt);
  } catch {
  }
  writeScrubApprovalRequest(opts.runDir, opts.runId, opts.surface, outPath, opts.laneId);
  return { written: false, blocked: true };
}
var fs7, path8, crypto;
var init_scrubbed_write = __esm({
  "../src/modules/security/workflows/scrubbed-write.ts"() {
    fs7 = __toESM(require("node:fs"));
    path8 = __toESM(require("node:path"));
    crypto = __toESM(require("node:crypto"));
    init_secrets();
    init_config();
    init_events();
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

// ../src/modules/lifecycle/workflows/stable-lock.ts
var init_stable_lock = __esm({
  "../src/modules/lifecycle/workflows/stable-lock.ts"() {
  }
});

// ../src/modules/lifecycle/workflows/trace-v2.ts
var SIDECAR_MAX_BYTES;
var init_trace_v2 = __esm({
  "../src/modules/lifecycle/workflows/trace-v2.ts"() {
    SIDECAR_MAX_BYTES = 16 * 1024;
  }
});

// ../src/modules/lifecycle/workflows/event-log-writer.ts
var ROTATION_THRESHOLD_BYTES;
var init_event_log_writer = __esm({
  "../src/modules/lifecycle/workflows/event-log-writer.ts"() {
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
var GUILD_TRACE_SCHEMA_VERSIONS;
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
  }
});

// ../src/modules/telemetry/workflows/guild-trace-emit.ts
var init_guild_trace_emit = __esm({
  "../src/modules/telemetry/workflows/guild-trace-emit.ts"() {
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

// ../src/modules/lifecycle/workflows/run-binding.ts
var init_run_binding = __esm({
  "../src/modules/lifecycle/workflows/run-binding.ts"() {
  }
});

// ../src/modules/lifecycle/workflows/run-lifecycle.ts
function runDir(root, runId) {
  return path9.join(root, ".guild", "runs", runId);
}
function resolvedSettingsPath(root, runId) {
  return path9.join(runDir(root, runId), "resolved-settings.json");
}
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
function assertContained(target, cwd, label) {
  const r = checkContained(cwd, target, { policy: "physical" });
  if (isRefused(r)) {
    throw new Error(
      `[run-lifecycle] ${label}: resolved path "${path9.resolve(target)}" escapes the project root "${path9.resolve(cwd)}" [${r.code}] \u2014 ${r.detail}`
    );
  }
  const runsBase = path9.resolve(cwd, ".guild", "runs");
  const resolvedTarget = path9.resolve(target);
  if (resolvedTarget === runsBase || !isWithin(resolvedTarget, runsBase)) {
    throw new Error(
      `[run-lifecycle] ${label}: resolved path "${resolvedTarget}" is not a strict subdirectory of the runs base "${runsBase}"`
    );
  }
}
function realProvenanceFsSeam() {
  return {
    writeFile(absPath, contents) {
      fsNode.mkdirSync(path9.dirname(absPath), { recursive: true });
      fsNode.writeFileSync(absPath, contents, "utf8");
    },
    readFile(absPath) {
      try {
        return fsNode.readFileSync(absPath, "utf8");
      } catch {
        return null;
      }
    },
    // HK-06: real scrubbed write wired for resolved-settings.json (fail-CLOSED).
    scrubbedWriteDurable(outPath, contents, surface, runDir2, runId) {
      return scrubbedWrite(outPath, contents, { surface, runDir: runDir2, runId });
    }
  };
}
function readResolvedSettingsSnapshot(runId, opts) {
  if (!validateRunId(runId)) return null;
  const { cwd, fs: fsSeam } = opts;
  const fs9 = fsSeam ?? realProvenanceFsSeam();
  const filePath = resolvedSettingsPath(cwd, runId);
  const runsBase = path9.resolve(cwd, ".guild", "runs");
  try {
    assertContained(filePath, cwd, "readResolvedSettingsSnapshot");
  } catch {
    return null;
  }
  const raw = fs9.readFile(filePath);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
var fsNode, path9, CANONICAL_PHASES;
var init_run_lifecycle = __esm({
  "../src/modules/lifecycle/workflows/run-lifecycle.ts"() {
    fsNode = __toESM(require("fs"));
    path9 = __toESM(require("path"));
    init_kernel();
    init_host_runtime();
    init_config2();
    init_state();
    init_run_binding();
    init_security();
    CANONICAL_PHASES = Object.freeze(["init", "ideate", "plan", "build", "qa", "ops"]);
  }
});

// session-reanchor.ts
var session_reanchor_exports = {};
__export(session_reanchor_exports, {
  main: () => main
});
module.exports = __toCommonJS(session_reanchor_exports);

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

// lib/v1.4/log-jsonl.ts
init_event_log();

// lib/lane-attribution.ts
function isWorkerInvocation(env = process.env) {
  const laneId = env["GUILD_LANE_ID"];
  const taskId = env["GUILD_TASK_ID"];
  return typeof laneId === "string" && laneId.length > 0 || typeof taskId === "string" && taskId.length > 0;
}

// lib/reanchor.ts
var fs8 = __toESM(require("node:fs"));
init_sealed_collections();
var path10 = __toESM(require("node:path"));
var yaml2 = __toESM(require_js_yaml());

// ../scripts/lib/run-lifecycle.ts
init_run_lifecycle();

// lib/reanchor.ts
var REANCHOR_MARKER = "[GUILD RE-ANCHOR]";
var SAFE_IDENT = /^[A-Za-z0-9._-]{1,120}$/;
var KNOWN_AGENT_MODES = /* @__PURE__ */ new Set(["team", "agent", "subagent", "auto"]);
function safeIdent(value) {
  if (value === null) return null;
  return SAFE_IDENT.test(value) ? value : null;
}
function safeAgentMode(value) {
  return value !== null && KNOWN_AGENT_MODES.has(value) ? value : "unknown";
}
function safePhase(value) {
  return safeIdent(value);
}
var DIRECTIVE_PHRASES = [
  "ignoreall",
  "ignoreprevious",
  "ignoreabove",
  "ignorethe",
  "disregard",
  "overrideprevious",
  "overrideall",
  "previousinstructions",
  "priorinstructions",
  "newinstructions",
  "allinstructions",
  "systemprompt",
  "revealthe",
  "revealsystem",
  "forgetprevious",
  "forgeteverything",
  "forgetall",
  "exfiltrate",
  "jailbreak"
];
function nonDirectiveScalar(value) {
  if (value === null) return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return DIRECTIVE_PHRASES.some((phrase) => normalized.includes(phrase)) ? null : value;
}
var PASSED_GATE_OUTCOMES = /* @__PURE__ */ new Set(["pass", "passed", "success", "succeeded"]);
function isPassedGateRecord(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return false;
  const outcome = record["outcome"];
  if (typeof outcome !== "string") return false;
  return PASSED_GATE_OUTCOMES.has(outcome.trim().toLowerCase());
}
var REANCHOR_SESSION_SOURCES = sealSet(["compact", "resume"], "REANCHOR_SESSION_SOURCES");
function resolveActiveRunId(guildRoot) {
  const envRunId = process.env["GUILD_RUN_ID"];
  if (typeof envRunId === "string" && envRunId.trim().length > 0) {
    return envRunId.trim();
  }
  const sentinel = path10.join(guildRoot, ".guild", "runs", "current-run-id");
  try {
    const value = fs8.readFileSync(sentinel, "utf8").trim();
    return value.length > 0 ? value : void 0;
  } catch {
    return void 0;
  }
}
function readRunYamlFacts(guildRoot, runId) {
  const runYamlPath = path10.join(guildRoot, ".guild", "runs", runId, "run.yaml");
  let raw;
  try {
    raw = fs8.readFileSync(runYamlPath, "utf8");
  } catch {
    return null;
  }
  let doc;
  try {
    doc = yaml2.load(raw);
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const obj = doc;
  const str = (v) => typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  let settingsRefBackend = null;
  const sref = obj["settings_ref"];
  if (sref !== null && typeof sref === "object" && !Array.isArray(sref)) {
    settingsRefBackend = str(sref["effective_backend"]);
  }
  const passedGates = /* @__PURE__ */ new Set();
  const gates = obj["gates"];
  if (gates !== null && typeof gates === "object" && !Array.isArray(gates)) {
    for (const [key, record] of Object.entries(gates)) {
      if (isPassedGateRecord(record)) passedGates.add(key);
    }
  }
  return {
    runId: str(obj["run_id"]),
    status: str(obj["status"]),
    phase: str(obj["phase"]),
    initiative: str(obj["initiative_attachment"]),
    settingsRefBackend,
    passedGates
  };
}
var GATE_SEQUENCE_BY_PHASE = {
  init: ["ideate"],
  ideate: ["plan"],
  plan: ["build"],
  build: ["review", "verify-done"],
  qa: ["verify-done", "ops"],
  ops: ["close"]
};
function deriveNextGate(phase, passedGates) {
  const seq = phase ? GATE_SEQUENCE_BY_PHASE[phase] : void 0;
  if (!seq || seq.length === 0) return null;
  for (const gate of seq) {
    if (!passedGates.has(gate)) return gate;
  }
  return seq[seq.length - 1];
}
var LIVE_RUN_STATUSES = /* @__PURE__ */ new Set(["open", "resumable"]);
var DEFAULT_REANCHOR_GRACE_MS = 3 * 60 * 60 * 1e3;
function reanchorGraceMs() {
  const raw = process.env["GUILD_REANCHOR_GRACE_MS"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_REANCHOR_GRACE_MS;
}
function newestRunSignalMs(guildRoot, runId) {
  const dir = path10.join(guildRoot, ".guild", "runs", runId);
  const candidates = [
    path10.join(dir, "run.yaml"),
    path10.join(dir, "events.ndjson"),
    path10.join(dir, "provenance.json")
  ];
  for (const sub of ["logs", "handoffs", "in-progress"]) {
    try {
      for (const name of fs8.readdirSync(path10.join(dir, sub))) {
        candidates.push(path10.join(dir, sub, name));
      }
    } catch {
    }
  }
  let newest = 0;
  for (const p of candidates) {
    try {
      newest = Math.max(newest, fs8.statSync(p).mtimeMs);
    } catch {
    }
  }
  return newest;
}
function isRunActive(guildRoot, runId, status, nowMs = Date.now()) {
  if (status === null) return false;
  if (LIVE_RUN_STATUSES.has(status)) return true;
  const newest = newestRunSignalMs(guildRoot, runId);
  if (newest === 0) return false;
  return nowMs - newest <= reanchorGraceMs();
}
function renderReanchorHeader(f) {
  const isTeam = f.agentMode === "team";
  const backendClause = isTeam ? "dispatch each lane as its NAMED specialist via the agent-team launcher / visible panes \u2014 NOT in-session general-purpose Agents" : "dispatch each lane as its NAMED specialist via the resolved backend \u2014 NOT inline, NOT bare general-purpose Agents";
  const initLine = f.initiative ? `initiative=${f.initiative}; ` : "";
  return [
    `${REANCHOR_MARKER} active run ${f.runId} \u2014 you are the lean LEAD, not a lane worker.`,
    `- ${initLine}agent_mode=${f.agentMode}; phase=${f.phase ?? "unknown"}.`,
    `- Backend: ${backendClause}.`,
    "- The Agent `model` param is REQUIRED on every dispatch per tier resolution (default cheap; powerful must be justified).",
    "- Do NOT do lane work inline. Re-enter the gated lifecycle via guild:resume.",
    f.nextGate === null ? "- Next pending gate: unknown for this phase \u2014 run /guild:status before proceeding." : `- Next pending gate: ${f.nextGate}.`
  ].join("\n");
}
function resolveReanchorFacts(guildRoot) {
  const runId = resolveActiveRunId(guildRoot);
  if (!runId) return null;
  if (!validateRunId(runId)) return null;
  const safeRunId = safeIdent(runId);
  if (safeRunId === null) return null;
  if (nonDirectiveScalar(safeRunId) === null) return null;
  const facts = readRunYamlFacts(guildRoot, safeRunId);
  if (!facts) return null;
  if (!isRunActive(guildRoot, safeRunId, facts.status)) return null;
  if (facts.runId !== safeRunId) return null;
  let agentMode = null;
  try {
    const snapshot = readResolvedSettingsSnapshot(safeRunId, { cwd: guildRoot });
    if (snapshot && snapshot.effective && typeof snapshot.effective.agent_mode === "string") {
      agentMode = snapshot.effective.agent_mode;
    }
  } catch {
  }
  if (!agentMode) agentMode = facts.settingsRefBackend;
  const safeMode = safeAgentMode(agentMode);
  const safePhaseValue = nonDirectiveScalar(safePhase(facts.phase));
  const safeInitiative = nonDirectiveScalar(safeIdent(facts.initiative));
  const nextGate = deriveNextGate(safePhaseValue, facts.passedGates);
  return {
    runId: safeRunId,
    agentMode: safeMode,
    phase: safePhaseValue,
    initiative: safeInitiative,
    nextGate
  };
}
function buildReanchorHeader(guildRoot) {
  const facts = resolveReanchorFacts(guildRoot);
  return facts === null ? null : renderReanchorHeader(facts);
}
function buildAdditionalContextEnvelope(hookEventName, header) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName,
      additionalContext: header
    }
  });
}

// session-reanchor.ts
async function readStdin() {
  return new Promise((resolve8) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve8(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve8(""));
  });
}
async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    if (raw.trim().length > 0) {
      const parsed = JSON.parse(raw.trim());
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return;
      }
      payload = parsed;
    }
  } catch {
    return;
  }
  const source = typeof payload.source === "string" ? payload.source : "";
  if (!REANCHOR_SESSION_SOURCES.has(source)) {
    return;
  }
  if (isWorkerInvocation()) return;
  const payloadCwd = typeof payload.cwd === "string" ? payload.cwd : void 0;
  const cwd = process.env["GUILD_CWD"] ?? payloadCwd ?? process.cwd();
  const guildRoot = resolveGuildRoot(cwd);
  const header = buildReanchorHeader(guildRoot);
  if (header === null) return;
  process.stdout.write(buildAdditionalContextEnvelope("SessionStart", header));
}
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(
      `[session-reanchor] FATAL: ${err instanceof Error ? err.message : String(err)}
`
    );
    process.exit(0);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
