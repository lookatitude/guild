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
    function representYamlBinary(object2) {
      let result = "";
      let bits = 0;
      const max = object2.length;
      const map = BASE64_MAP;
      for (let idx = 0; idx < max; idx++) {
        if (idx % 3 === 0 && idx) {
          result += map[bits >> 18 & 63];
          result += map[bits >> 12 & 63];
          result += map[bits >> 6 & 63];
          result += map[bits & 63];
        }
        bits = (bits << 8) + object2[idx];
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
      const object2 = data;
      const result = new Array(object2.length);
      for (let index = 0, length = object2.length; index < length; index += 1) {
        const pair = object2[index];
        if (_toString.call(pair) !== "[object Object]") return false;
        const keys = Object.keys(pair);
        if (keys.length !== 1) return false;
        result[index] = [keys[0], pair[keys[0]]];
      }
      return true;
    }
    function constructYamlPairs(data) {
      if (data === null) return [];
      const object2 = data;
      const result = new Array(object2.length);
      for (let index = 0, length = object2.length; index < length; index += 1) {
        const pair = object2[index];
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
      let hasContent2 = false;
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
            hasContent2 = true;
          } else {
            const ch = state.input.charCodeAt(state.position);
            if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(
              state,
              propertyStart,
              propertyStart.position - propertyStart.lineStart,
              flowIndent
            )) {
              hasContent2 = true;
            } else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
              hasContent2 = true;
            } else if (readAlias(state)) {
              hasContent2 = true;
              if (state.tag !== null || state.anchor !== null) {
                throwError(state, "alias node should not have any properties");
              }
            } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
              hasContent2 = true;
              if (state.tag === null) {
                state.tag = "?";
              }
            }
            if (state.anchor !== null) {
              storeAnchor(state, state.anchor, state.result);
            }
          }
        } else if (indentStatus === 0) {
          hasContent2 = allowBlockCollections && readBlockSequence(state, blockIndent);
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
      return state.tag !== null || state.anchor !== null || hasContent2;
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
    function testImplicitResolving(state, str3) {
      for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) {
        const type = state.implicitTypes[index];
        if (type.resolve(str3)) {
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
var HOSTKIND_TO_REGISTRY_ID, HOST_ID_SET2, LEGACY_HOST_ALIASES, PREFIX_COLLAPSE;
var init_host_id_namespace = __esm({
  "../src/modules/host-runtime/workflows/host-id-namespace.ts"() {
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
function isPlainObject(v) {
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
    if (!isPlainObject(entry)) {
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
      if (!isPlainObject(e["models"])) {
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
      const home = process.env["CODEX_HOME"] || path4.join(os.homedir(), ".codex");
      const authFile = path4.join(home, "auth.json");
      const st = fs3.statSync(authFile);
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
  const hostsDir = path4.join(cwd, ".guild", "hosts");
  if (!fs3.existsSync(hostsDir)) return [];
  const out = /* @__PURE__ */ new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs3.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path4.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name === "capability.json") {
        try {
          const m = JSON.parse(fs3.readFileSync(full, "utf8"));
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
var import_child_process, fs3, os, path4, PROVIDER_REGISTRY, KNOWN_FAMILIES;
var init_provider_detect = __esm({
  "../src/modules/host-runtime/workflows/provider-detect.ts"() {
    import_child_process = require("child_process");
    fs3 = __toESM(require("fs"));
    os = __toESM(require("os"));
    path4 = __toESM(require("path"));
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
    KNOWN_FAMILIES = /* @__PURE__ */ new Set([
      "claude",
      "codex",
      "pi",
      "antigravity"
    ]);
  }
});

// ../src/modules/host-runtime/workflows/session-context.ts
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
function realFs() {
  return {
    mkdirp: (p) => fsReal.mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => fsReal.writeFileSync(p, c, "utf8"),
    readFile: (p) => fsReal.existsSync(p) ? fsReal.readFileSync(p, "utf8") : null,
    exists: (p) => fsReal.existsSync(p)
  };
}
function sessionContextPath(root, runId) {
  return path5.join(root, ".guild", "runs", runId, "session-context.json");
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
  f.mkdirp(path5.dirname(p));
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
var fsReal, path5, UNKNOWN_TARGET;
var init_session_context = __esm({
  "../src/modules/host-runtime/workflows/session-context.ts"() {
    fsReal = __toESM(require("fs"));
    path5 = __toESM(require("path"));
    init_provider_detect();
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
function isCanonicalRoleSlug(v) {
  return typeof v === "string" && v.length > 0 && v.length <= CAPABILITY_ROLE_SLUG_MAX_LEN && !CONTROL_CHARS.test(v) && ROLE_SLUG.test(v);
}
function roleSlugDedupKey(slug) {
  return slug.toLowerCase();
}
var DEFAULT_ESCALATION_MARKERS, NON_INHERITABLE_KEYS, LOG_ROTATION_THRESHOLD_BYTES, SIDECAR_MAX_BYTES, CAPABILITY_RESOLVER_MODES, CAPABILITY_AUTO_CREATE_POLICIES, CAPABILITY_RESOLVER_MODE_AFTER_F7, CAPABILITY_RESOLVER_MODE_DEFAULT, CAPABILITY_SUGGESTION_BUDGET_MIN, CAPABILITY_SUGGESTION_BUDGET_MAX, CAPABILITY_ROLE_SLUG_MAX_LEN, ROLE_SLUG, CONTROL_CHARS, DEFAULTS;
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
  if (object(value["wiki"]) && value["wiki"]["autopromote"] === true) rejects.push("defaults.wiki.autopromote: true is REJECTED always (agents emit candidates only)");
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
  "../src/modules/config/workflows/config-validation.ts"() {
    init_host_runtime();
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
      "lifecycle_gate"
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
function assertNotUnderPluginInstall(absPath, pluginInstallRoot) {
  const root = pluginInstallRoot ?? process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"] ?? process.env["CODEX_PLUGIN_ROOT"];
  if (!root) return;
  const resolvedRoot = path6.resolve(root);
  const rel = path6.relative(resolvedRoot, path6.resolve(absPath));
  if (rel === "" || !rel.startsWith("..") && !path6.isAbsolute(rel)) {
    const underOwnDotGuild = rel === ".guild" || rel.startsWith(`.guild${path6.sep}`);
    if (underOwnDotGuild && fs4.existsSync(path6.join(resolvedRoot, ".git"))) return;
    throw new Error(`project-created Guild artifact would be written under plugin install dir: ${absPath}`);
  }
}
var fs4, path6;
var init_plugin_install_guard = __esm({
  "../src/modules/state/workflows/plugin-install-guard.ts"() {
    fs4 = __toESM(require("node:fs"));
    path6 = __toESM(require("node:path"));
  }
});

// ../src/modules/state/workflows/atomic-write.ts
function atomicWrite(targetPath, content, pluginInstallRoot) {
  assertNotUnderPluginInstall(targetPath, pluginInstallRoot);
  const dir = path7.dirname(targetPath);
  fs5.mkdirSync(dir, { recursive: true });
  const unique = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const tmpPath = path7.join(dir, `.${path7.basename(targetPath)}.tmp-${unique}`);
  fs5.writeFileSync(tmpPath, content, "utf8");
  try {
    fs5.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      fs5.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
var fs5, path7, crypto;
var init_atomic_write = __esm({
  "../src/modules/state/workflows/atomic-write.ts"() {
    fs5 = __toESM(require("fs"));
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
function topLevelKeyLineIndex(lines, key) {
  const prefix = key + ":";
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^[ \t]/.test(ln)) continue;
    if (ln.startsWith(prefix)) return i;
  }
  return -1;
}
function replaceTopLevelLine(text, key, replacementLine) {
  const lines = text.split("\n");
  const i = topLevelKeyLineIndex(lines, key);
  if (i === -1) return { text, replaced: false };
  const hadCr = lines[i].endsWith("\r");
  lines[i] = hadCr ? replacementLine + "\r" : replacementLine;
  return { text: lines.join("\n"), replaced: true };
}
var loadedYaml;
var init_frontmatter = __esm({
  "../src/modules/state/workflows/frontmatter.ts"() {
    init_kernel();
    loadedYaml = null;
  }
});

// ../src/modules/state/workflows/guild-root.ts
function resolveGuildRoot2(startDir) {
  const resolvedStart = path8.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs6.existsSync(path8.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path8.join(current, ".guild");
      try {
        if (fs6.existsSync(guildDir) && fs6.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
      }
    }
    const parent = path8.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}
var fs6, path8;
var init_guild_root = __esm({
  "../src/modules/state/workflows/guild-root.ts"() {
    fs6 = __toESM(require("node:fs"));
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
var import_node_child_process, fs7, path9, CURRENT_SCHEMA_VERSION, MIGRATIONS;
var init_index_migrate = __esm({
  "../src/modules/migrations/workflows/index-migrate.ts"() {
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
function isPlainObject2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function parseSecurityConfig(parsed) {
  const out = securityDefaults();
  if (!isPlainObject2(parsed)) return out;
  if (isPlainObject2(parsed["security"])) {
    const bpp = parsed["security"]["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") {
      out.bypass_permissions_policy = bpp;
    }
  }
  if (isPlainObject2(parsed["secrets_policy"])) {
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
  if (isPlainObject2(parsed["defaults"])) {
    const defs = parsed["defaults"];
    if (isStringArray(defs["allowed_tools"])) {
      out.allowed_tools = defs["allowed_tools"];
    }
  }
  if (isPlainObject2(parsed["mcp"])) {
    const mcp = parsed["mcp"];
    if (isPlainObject2(mcp["tool_description_hashes"])) {
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
  const settingsPath = path10.join(resolveGuildRoot2(cwd), ".guild", "settings.json");
  let raw;
  try {
    raw = fs8.readFileSync(settingsPath, "utf8");
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
var fs8, path10;
var init_config = __esm({
  "../src/modules/security/workflows/config.ts"() {
    fs8 = __toESM(require("node:fs"));
    path10 = __toESM(require("node:path"));
    init_state();
  }
});

// ../src/modules/security/workflows/events.ts
function normalizeSecurityHostId(value) {
  const s = value.trim();
  if (KNOWN_GUILD_HOST_ID_SET.has(s)) return s;
  return LEGACY_HOST_ALIASES2[s] ?? null;
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
function appendSecurityEvent(runDir3, record) {
  try {
    const logsDir2 = path11.join(runDir3, "logs");
    fs9.mkdirSync(logsDir2, { recursive: true });
    fs9.appendFileSync(path11.join(logsDir2, "security-events.jsonl"), JSON.stringify(record) + "\n", "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [security-events] write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}
var fs9, path11, SECURITY_EVENT_SCHEMA_VERSION, KNOWN_GUILD_HOST_KINDS, KNOWN_GUILD_HOST_ID_SET, LEGACY_HOST_ALIASES2;
var init_events = __esm({
  "../src/modules/security/workflows/events.ts"() {
    fs9 = __toESM(require("node:fs"));
    path11 = __toESM(require("node:path"));
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

// ../src/modules/security/workflows/scrubbed-write.ts
function guildRootFromRunDir(runDir3) {
  return path12.resolve(runDir3, "../../..");
}
function writeScrubApprovalRequest(runDir3, runId, surface, outPath, laneId2) {
  try {
    const approvalDir = path12.join(runDir3, "agent-bus", "approvals");
    fs10.mkdirSync(approvalDir, { recursive: true });
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    const safeTs2 = ts.replace(/[:.]/g, "-");
    const fileName = `${safeTs2}-scrub-blocked.json`;
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
      const secConfig = readSecurityConfig(guildRootFromRunDir(runDir3));
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
function parseWorkspaceManifest(manifestPath) {
  let raw;
  try {
    if (!fs11.existsSync(manifestPath)) return { status: "absent" };
    raw = fs11.readFileSync(manifestPath, "utf8");
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
  let current = path13.dirname(startDir);
  const fsRoot = path13.parse(current).root;
  while (current !== fsRoot) {
    const manifestPath = path13.join(current, ".guild", "workspace.json");
    const parsed = parseWorkspaceManifest(manifestPath);
    if (parsed.status === "workspace") {
      return { rootDir: current, manifest: parsed.manifest };
    }
    if (parsed.status === "not_workspace") {
      return null;
    }
    const parent = path13.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
var fs11, path13;
var init_workspace_manifest = __esm({
  "../src/modules/config/workflows/workspace-manifest.ts"() {
    fs11 = __toESM(require("fs"));
    path13 = __toESM(require("path"));
  }
});

// ../src/modules/capability/workflows/catalog-cache.ts
function modelCatalogCacheDir(workspaceRoot) {
  return path14.join(workspaceRoot, ...MODEL_CATALOG_CACHE_REL_SEGMENTS);
}
function isModelCatalogCachePath(rel) {
  const norm = rel.split(path14.sep).join("/");
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
function sha256Hex(text) {
  return crypto3.createHash("sha256").update(text, "utf8").digest("hex");
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
  return sha256Hex(canonicalYamlFlat(hashed));
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
var crypto3, fs12, path14, MODEL_CATALOG_SCHEMA_VERSION, DEFAULT_CATALOG_TTL_SECONDS, UNCACHED_DISCOVERY_BUDGET_MS, CACHED_INSPECTION_BUDGET_MS, MODEL_CATALOG_CACHE_DIRNAME, MODEL_CATALOG_CACHE_REL_SEGMENTS, MODEL_CATALOG_CACHE_REL, YAML_KEYWORD, YAML_NUMBER, YAML_SEXAGESIMAL, CACHE_KEY_COMPONENTS, UnknownOrgQuarantineViolation, CATALOG_CACHE_KEY_BRAND, MINTED_KEYS, NON_IDENTITY_KEYS, MemoryStore, tmpSequence, SAFE_KEY, FileStore, defaultSleep;
var init_catalog_cache = __esm({
  "../src/modules/capability/workflows/catalog-cache.ts"() {
    crypto3 = __toESM(require("crypto"));
    fs12 = __toESM(require("fs"));
    path14 = __toESM(require("path"));
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
        fs12.mkdirSync(rootDir, { recursive: true });
      }
      rootDir;
      kind = "file";
      lockStealAgeMs;
      now;
      /** Keys whose cross-process lock THIS instance currently holds. */
      held = /* @__PURE__ */ new Set();
      entryPath(key) {
        if (!SAFE_KEY.test(key)) throw new Error(`catalog-cache: unsafe cache key ${JSON.stringify(key)}`);
        return path14.join(this.rootDir, `${key}.json`);
      }
      lockPath(key) {
        return `${this.entryPath(key)}.lock`;
      }
      tryLock(key) {
        if (this.held.has(key)) return false;
        const lock = this.lockPath(key);
        try {
          fs12.mkdirSync(lock);
          this.held.add(key);
          return true;
        } catch {
          try {
            const age = this.now() - fs12.statSync(lock).mtimeMs;
            if (age > this.lockStealAgeMs) {
              fs12.rmdirSync(lock);
              fs12.mkdirSync(lock);
              this.held.add(key);
              return true;
            }
          } catch {
            try {
              fs12.mkdirSync(lock);
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
          fs12.rmdirSync(this.lockPath(key));
        } catch {
        }
      }
      read(key) {
        try {
          const raw = fs12.readFileSync(this.entryPath(key), "utf8");
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
          const tmp = path14.join(this.rootDir, `.tmp-${process.pid}-${tmpSequence}-${key}`);
          fs12.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}
`, "utf8");
          fs12.renameSync(tmp, this.entryPath(key));
          return { published: true };
        } finally {
          if (!alreadyHeld) this.unlock(key);
        }
      }
      remove(key) {
        try {
          fs12.rmSync(this.entryPath(key), { force: true });
        } catch {
        }
      }
      listKeys() {
        try {
          return fs12.readdirSync(this.rootDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
        } catch {
          return [];
        }
      }
    };
    defaultSleep = (ms) => new Promise((resolve17) => setTimeout(resolve17, ms));
  }
});

// ../src/modules/capability/workflows/compatibility-usage.ts
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
  "../src/modules/capability/workflows/compatibility-usage.ts"() {
    import_util = require("util");
    init_config2();
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

// ../src/modules/capability/workflows/resolver-mode.ts
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
  if (!READ_REASON_SET2.has(reason)) {
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
function unresolved(failure2, detail, ctx) {
  return Object.freeze({
    schema_version: RESOLVER_MODE_OUTCOME_SCHEMA,
    status: "unresolved",
    mode: ctx?.mode ?? null,
    kind: ctx?.kind ?? null,
    capability_id: ctx?.capability_id ?? null,
    failure: failure2,
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
function rejectedTransition(failure2, detail, from, to) {
  return Object.freeze({
    schema_version: RESOLVER_MODE_OUTCOME_SCHEMA,
    status: "rejected",
    from,
    to,
    failure: failure2,
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
var import_util2, RESOLVER_MODE_OUTCOME_SCHEMA, MAX_SCALAR_LEN2, CONTROL_CHARS3, CANONICAL_ID, MAX_ID_LEN, RESOLVER_AUTHORITIES, CAPABILITY_RESOLUTION_INTENTS, MODE_POLICIES, RESOLVER_MODE_POLICIES, MODE_RANK, RESOLVER_MODE_FAILURES, RESOLVER_MODE_FAILURE_SET, READ_REASON_SET2, INTENT_REASON, BENIGN_REASONS, RESOLUTION_REQUEST_KEYS, MODE_TRANSITION_DIRECTIONS, TRANSITION_KEYS;
var init_resolver_mode = __esm({
  "../src/modules/capability/workflows/resolver-mode.ts"() {
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
    READ_REASON_SET2 = new Set(COMPATIBILITY_READ_REASONS);
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

// ../src/modules/capability/workflows/compatibility-catalog.ts
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
  const rel = path15.relative(root, absPath);
  if (rel.length === 0 || rel.startsWith("..") || path15.isAbsolute(rel)) return null;
  const posix = rel.split(path15.sep).join("/");
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
  const root = path15.resolve(pluginRoot);
  const problems = [];
  const entries = [];
  const push = (kind, id, abs) => {
    const rel = toCanonicalRelPath(abs, root);
    if (rel === null) {
      problems.push(`${kind} "${id}": path is not canonical plugin-relative (${abs})`);
      return;
    }
    let bytes;
    try {
      const st = fs13.lstatSync(abs);
      if (st.isSymbolicLink()) {
        problems.push(`${kind} "${id}": symlink, refusing to catalog`);
        return;
      }
      if (!st.isFile()) {
        problems.push(`${kind} "${id}": not a regular file`);
        return;
      }
      bytes = fs13.readFileSync(abs);
    } catch (err) {
      problems.push(`${kind} "${id}": unreadable (${err.message})`);
      return;
    }
    entries.push(
      Object.freeze({
        kind,
        id,
        path: rel,
        content_hash: crypto4.createHash("sha256").update(bytes).digest("hex"),
        deprecation,
        deprecated_by: deprecatedBy
      })
    );
  };
  const templateDir = path15.join(root, COMPATIBILITY_ASSET_ROOTS.shipped_template);
  try {
    for (const e of fs13.readdirSync(templateDir, { withFileTypes: true }).sort(
      (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const id = e.name.slice(0, -3);
      if (!isCanonicalId3(id)) {
        problems.push(`shipped_template "${e.name}": file stem is not a canonical id`);
        continue;
      }
      push("shipped_template", id, path15.join(templateDir, e.name));
    }
  } catch (err) {
    problems.push(`templates/specialists unreadable (${err.message})`);
  }
  const skillDir = path15.join(root, COMPATIBILITY_ASSET_ROOTS.shipped_domain_skill);
  try {
    for (const e of fs13.readdirSync(skillDir, { withFileTypes: true }).sort(
      (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )) {
      if (!e.isDirectory()) continue;
      if (!isCanonicalId3(e.name)) {
        problems.push(`shipped_domain_skill "${e.name}": directory name is not a canonical id`);
        continue;
      }
      push("shipped_domain_skill", e.name, path15.join(skillDir, e.name, "SKILL.md"));
    }
  } catch (err) {
    problems.push(`skills/specialists unreadable (${err.message})`);
  }
  entries.sort(
    (a, b) => a.kind !== b.kind ? a.kind < b.kind ? -1 : 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
  const templateCount = entries.filter((e) => e.kind === "shipped_template").length;
  const skillCount = entries.filter((e) => e.kind === "shipped_domain_skill").length;
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
var crypto4, fs13, path15, import_util3, COMPATIBILITY_CATALOG_SCHEMA, SHIPPED_TEMPLATE_COUNT, SHIPPED_DOMAIN_SKILL_COUNT, SHIPPED_COMPATIBILITY_ASSET_COUNT, COMPATIBILITY_ASSET_ROOTS, COMPATIBILITY_DEPRECATION_STATES, DEPRECATION_STATE_SET, MAX_SCALAR_LEN3, MAX_ID_LEN2, CONTROL_CHARS4, CANONICAL_ID2, SHA256_HEX2, BUILD_KEYS, ENTRY_KEYS, SUGGESTABLE_KEYS, EMISSION_KEYS;
var init_compatibility_catalog = __esm({
  "../src/modules/capability/workflows/compatibility-catalog.ts"() {
    crypto4 = __toESM(require("crypto"));
    fs13 = __toESM(require("fs"));
    path15 = __toESM(require("path"));
    import_util3 = require("util");
    init_compatibility_usage();
    init_resolver_mode();
    COMPATIBILITY_CATALOG_SCHEMA = "guild.compatibility_catalog.v1";
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

// ../src/modules/capability/workflows/confirmation-arbiter.ts
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
  "../src/modules/capability/workflows/independence-predicates.ts"() {
    known = (x) => typeof x === "string" && x.length > 0 && x !== "unknown";
    ADJUDICATION_SHA256_HEX = /^[0-9a-f]{64}$/;
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
function issue(path38, code, message) {
  return { path: path38, code, message: `${DOCUMENTS_ERROR_NAMESPACE}: ${message}` };
}
function pushIssue(issues, path38, code, message) {
  if (issues.length >= MAX_ISSUES) return;
  issues.push(issue(path38, code, message));
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
  const walk = (node, path38, depth) => {
    if (errors.length >= MAX_ISSUES) return null;
    if (depth > MAX_CANONICAL_DEPTH) {
      pushIssue(errors, path38, "depth_exceeded", `value nests deeper than ${MAX_CANONICAL_DEPTH}`);
      return null;
    }
    nodes += 1;
    if (nodes > MAX_CANONICAL_NODES) {
      pushIssue(errors, path38, "size_exceeded", `value exceeds ${MAX_CANONICAL_NODES} nodes`);
      return null;
    }
    if (node === null) return "null";
    const kind = typeof node;
    if (kind === "boolean") return node === true ? "true" : "false";
    if (kind === "string") {
      const text = node;
      if (text.length > MAX_STRING_LENGTH) {
        pushIssue(errors, path38, "string_too_long", `string exceeds ${MAX_STRING_LENGTH} characters`);
        return null;
      }
      return JSON.stringify(text);
    }
    if (kind === "number") {
      const num = node;
      if (!Number.isFinite(num)) {
        pushIssue(errors, path38, "non_finite_number", "numbers must be finite");
        return null;
      }
      return Object.is(num, -0) ? "0" : String(num);
    }
    if (kind !== "object") {
      pushIssue(errors, path38, "unsupported_type", `${kind} has no canonical JSON form`);
      return null;
    }
    if (active.has(node)) {
      pushIssue(errors, path38, "cycle_detected", "value contains a cycle");
      return null;
    }
    active.add(node);
    try {
      if (safeIsArray(node)) {
        const length = safeArrayLength(node);
        if (length.ok === false) {
          pushIssue(errors, path38, "array_length_unreadable", length.reason);
          return null;
        }
        if (length.length > MAX_ARRAY_ITEMS) {
          pushIssue(errors, path38, "array_too_long", `array exceeds ${MAX_ARRAY_ITEMS} items`);
          return null;
        }
        const parts2 = [];
        for (let index = 0; index < length.length; index += 1) {
          const key = String(index);
          if (!safeHasOwn(node, key)) {
            pushIssue(errors, `${path38}[${index}]`, "sparse_array_hole", "array holes have no canonical JSON form");
            return null;
          }
          const read = safeGet(node, key);
          if (read.ok === false) {
            pushIssue(errors, `${path38}[${index}]`, "property_read_threw", read.reason);
            return null;
          }
          const encoded = walk(read.value, `${path38}[${index}]`, depth + 1);
          if (encoded === null) return null;
          parts2.push(encoded);
        }
        return `[${parts2.join(",")}]`;
      }
      const keys = safeOwnKeys(node);
      if (keys.ok === false) {
        pushIssue(errors, path38, "own_keys_threw", keys.reason);
        return null;
      }
      if (keys.keys.length > MAX_OBJECT_KEYS) {
        pushIssue(errors, path38, "object_too_wide", `object exceeds ${MAX_OBJECT_KEYS} keys`);
        return null;
      }
      const sorted = [...keys.keys].sort();
      const parts = [];
      for (const key of sorted) {
        const read = safeGet(node, key);
        if (read.ok === false) {
          pushIssue(errors, `${path38}.${key}`, "property_read_threw", read.reason);
          return null;
        }
        if (read.value === void 0) {
          pushIssue(errors, `${path38}.${key}`, "undefined_value", "undefined has no canonical JSON form");
          return null;
        }
        const encoded = walk(read.value, `${path38}.${key}`, depth + 1);
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
function readShape(issues, value, path38, allowed) {
  if (value === null || typeof value !== "object") {
    pushIssue(issues, path38, "not_an_object", `${path38} must be an object`);
    return false;
  }
  if (safeIsArray(value)) {
    pushIssue(issues, path38, "not_an_object", `${path38} must be an object, not an array`);
    return false;
  }
  const keys = safeOwnKeys(value);
  if (keys.ok === false) {
    pushIssue(issues, path38, "own_keys_threw", `${path38}: ${keys.reason}`);
    return false;
  }
  const allowedSet = new Set(allowed);
  let ok = true;
  for (const key of [...keys.keys].sort()) {
    if (!allowedSet.has(key)) {
      pushIssue(issues, `${path38}.${key}`, "unexpected_key", `${path38}.${key} is not part of the closed schema`);
      ok = false;
    }
  }
  for (const key of allowed) {
    if (!safeHasOwn(value, key)) {
      pushIssue(issues, `${path38}.${key}`, "missing_field", `${path38}.${key} is required`);
      ok = false;
    }
  }
  return ok;
}
function readString(issues, parent, path38, key, options = {}) {
  const fieldPath = `${path38}.${key}`;
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
function readArray3(issues, parent, path38, key, options = {}) {
  const fieldPath = `${path38}.${key}`;
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
function readStringArray(issues, parent, path38, key, options = {}) {
  const items = readArray3(issues, parent, path38, key, options);
  if (items === null) return null;
  const fieldPath = `${path38}.${key}`;
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
function readItemArray(issues, parent, path38, key, options, readItem) {
  const items = readArray3(issues, parent, path38, key, options);
  if (items === null) return null;
  const fieldPath = `${path38}.${key}`;
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
function readProvenance(issues, parent, path38) {
  const read = safeGet(parent, "provenance");
  if (read.ok === false) {
    pushIssue(issues, `${path38}.provenance`, "property_read_threw", `${path38}.provenance: property read threw`);
    return null;
  }
  const provenancePath2 = `${path38}.provenance`;
  if (!readShape(issues, read.value, provenancePath2, PROVENANCE_KEYS)) return null;
  const source = read.value;
  const authorId = readString(issues, source, provenancePath2, "author_id", {
    pattern: DOCUMENT_ID_PATTERN
  });
  const authorFamily = readString(issues, source, provenancePath2, "author_family", {
    pattern: DOCUMENT_ID_PATTERN
  });
  const hostId = readString(issues, source, provenancePath2, "host_id", {
    pattern: DOCUMENT_ID_PATTERN
  });
  const createdAt = readString(issues, source, provenancePath2, "created_at", {
    pattern: DOCUMENT_TIMESTAMP_PATTERN
  });
  const provenanceSource = readString(issues, source, provenancePath2, "source", {
    enumOf: DOCUMENT_PROVENANCE_SOURCES
  });
  if (createdAt !== null) {
    const parsed = Date.parse(createdAt);
    if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== createdAt) {
      pushIssue(
        issues,
        `${provenancePath2}.created_at`,
        "not_a_real_instant",
        `${provenancePath2}.created_at is not a real UTC instant`
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
function readPlanBody(issues, body, path38) {
  if (!readShape(issues, body, path38, ["objectives", "steps"])) return null;
  const objectives = readStringArray(issues, body, path38, "objectives", { min: 1, max: 64, itemMaxLength: 500 });
  const steps = readItemArray(issues, body, path38, "steps", { min: 1, max: 256 }, (itemIssues, item, itemPath) => {
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
function readSpecBody(issues, body, path38) {
  if (!readShape(issues, body, path38, ["requirements"])) return null;
  const requirements = readItemArray(
    issues,
    body,
    path38,
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
function readHandoffBody(issues, body, path38) {
  if (!readShape(issues, body, path38, ["task_id", "status", "artifacts", "issues"])) return null;
  const taskId = readString(issues, body, path38, "task_id", { pattern: DOCUMENT_ITEM_ID_PATTERN });
  const status = readString(issues, body, path38, "status", { enumOf: HANDOFF_STATUSES });
  const artifacts = readStringArray(issues, body, path38, "artifacts", { max: 256, itemMaxLength: 1e3 });
  const handoffIssues = readStringArray(issues, body, path38, "issues", { max: 256, itemMaxLength: 1e3 });
  if (taskId === null || status === null || artifacts === null || handoffIssues === null) return null;
  return { task_id: taskId, status, artifacts, issues: handoffIssues };
}
function readReviewBody(issues, body, path38) {
  if (!readShape(issues, body, path38, ["verdict", "findings"])) return null;
  const verdict = readString(issues, body, path38, "verdict", { enumOf: REVIEW_VERDICTS });
  const findings = readItemArray(
    issues,
    body,
    path38,
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
function readVerifyBody(issues, body, path38) {
  if (!readShape(issues, body, path38, ["outcome", "checks"])) return null;
  const outcome = readString(issues, body, path38, "outcome", { enumOf: VERIFY_OUTCOMES });
  const checks = readItemArray(
    issues,
    body,
    path38,
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
    const asRecord2 = input;
    for (const key of PROJECTION_KEYS) {
      let value;
      try {
        value = asRecord2[key];
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
    raw = fs14.readFileSync(p, "utf8");
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
  const obj = readJsonObject(path16.join(runDir3, "run-state.json"));
  if (obj === null) return null;
  const lanes = obj["lanes"];
  if (typeof lanes !== "object" || lanes === null || Array.isArray(lanes)) {
    return {};
  }
  return lanes;
}
function readHeartbeatAges(runDir3, now = Date.now()) {
  const ages = /* @__PURE__ */ new Map();
  const dir = path16.join(runDir3, "in-progress");
  let names;
  try {
    names = fs14.readdirSync(dir);
  } catch {
    return ages;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const stem = name.slice(0, -".json".length);
    const filePath = path16.join(dir, name);
    const obj = readJsonObject(filePath);
    const ts = obj !== null && typeof obj["timestamp"] === "string" ? Date.parse(obj["timestamp"]) : NaN;
    if (!Number.isNaN(ts)) {
      ages.set(stem, Math.max(0, now - ts));
      continue;
    }
    try {
      const stat = fs14.statSync(filePath);
      ages.set(stem, Math.max(0, now - stat.mtimeMs));
    } catch {
    }
  }
  return ages;
}
function readReceiptEvidence(runDir3) {
  const dir = path16.join(runDir3, "handoffs");
  let names;
  try {
    names = fs14.readdirSync(dir);
  } catch {
    return [];
  }
  const evidence = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    const stem = name.slice(0, -".md".length);
    const filePath = path16.join(dir, name);
    let text = null;
    try {
      if (fs14.statSync(filePath).size <= MAX_RECEIPT_BYTES) {
        text = fs14.readFileSync(filePath, "utf8");
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
function readReceiptStems(runDir3) {
  return readReceiptEvidence(runDir3).map((entry) => entry.stem);
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
var fs14, path16, DEFAULT_HEARTBEAT_TIMEOUT_MS, TERMINAL_STATUSES, MAX_RECEIPT_BYTES, NO_RECEIPT, USAGE;
var init_check_lane_liveness = __esm({
  "../src/modules/lifecycle/workflows/check-lane-liveness.ts"() {
    fs14 = __toESM(require("node:fs"));
    path16 = __toESM(require("node:path"));
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

// ../src/modules/lifecycle/workflows/stable-lock.ts
function stableLockPath(runDir3) {
  return (0, import_node_path.join)(runDir3, "logs", ".lock");
}
function exclusionSentinelPath(runDir3) {
  return (0, import_node_path.join)(runDir3, "logs", ".lock.exclusion");
}
function initStableLockfile(runDir3) {
  const path38 = stableLockPath(runDir3);
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path38), { recursive: true });
  if ((0, import_node_fs.existsSync)(path38)) return;
  try {
    const fd = (0, import_node_fs.openSync)(path38, "wx");
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
var SIDECAR_MAX_BYTES2;
var init_trace_v2 = __esm({
  "../src/modules/lifecycle/workflows/trace-v2.ts"() {
    SIDECAR_MAX_BYTES2 = 16 * 1024;
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
    const path38 = laneFallbackPath(runDir3, laneId2);
    (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(path38), { recursive: true });
    const fd = (0, import_node_fs2.openSync)(path38, "a");
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
function snapshotLiveLog(runDir3) {
  const live = liveLogPath(runDir3);
  if (!(0, import_node_fs2.existsSync)((0, import_node_path2.dirname)(live))) return "";
  return withStableLock(runDir3, () => {
    if (!(0, import_node_fs2.existsSync)(live)) return "";
    return (0, import_node_fs2.readFileSync)(live, "utf8");
  });
}
function listArchives(runDir3) {
  const dir = archiveDir(runDir3);
  if (!(0, import_node_fs2.existsSync)(dir)) return [];
  const entries = [];
  for (const entry of (0, import_node_fs2.readdirSync)(dir)) {
    const m = /^v1\.4-events\.(\d+)\.jsonl\.gz$/.exec(entry);
    if (m && m[1] !== void 0) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n)) entries.push({ n, path: (0, import_node_path2.join)(dir, entry) });
    }
  }
  entries.sort((a, b) => a.n - b.n);
  return entries.map((e) => e.path);
}
async function readArchive(path38) {
  const chunks = [];
  const src = (0, import_node_fs2.createReadStream)(path38);
  const gunzip = (0, import_node_zlib.createGunzip)();
  src.pipe(gunzip);
  for await (const chunk of gunzip) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function readAllEvents(runDir3, optsOrLegacyOnSkip) {
  let opts = {};
  if (typeof optsOrLegacyOnSkip === "function") {
    opts = {
      onSkip: optsOrLegacyOnSkip
    };
  } else if (optsOrLegacyOnSkip !== void 0) {
    opts = optsOrLegacyOnSkip;
  }
  const out = [];
  for (const archive of listArchives(runDir3)) {
    const text = await readArchive(archive);
    appendParsedLines(text, archive, out, opts);
  }
  const liveText = snapshotLiveLog(runDir3);
  appendParsedLines(liveText, liveLogPath(runDir3), out, opts);
  const logsDir2 = (0, import_node_path2.dirname)(liveLogPath(runDir3));
  if ((0, import_node_fs2.existsSync)(logsDir2)) {
    for (const entry of (0, import_node_fs2.readdirSync)(logsDir2).sort()) {
      const m = /^lane-.+-events\.jsonl$/.exec(entry);
      if (!m) continue;
      const text = (0, import_node_fs2.readFileSync)((0, import_node_path2.join)(logsDir2, entry), "utf8");
      appendParsedLines(text, (0, import_node_path2.join)(logsDir2, entry), out, opts);
    }
  }
  return out;
}
function appendParsedLines(text, source, out, opts) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === void 0 || raw.length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      opts.onSkip?.({
        source,
        line: i + 1,
        streamIndex: out.length,
        raw,
        reason: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`
      });
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || typeof parsed.event !== "string" || !EVENT_TYPES.has(parsed.event)) {
      opts.onSkip?.({
        source,
        line: i + 1,
        streamIndex: out.length,
        raw,
        reason: "unknown or missing event type"
      });
      continue;
    }
    if (opts.validate) {
      const result = opts.validate(parsed);
      if (!result.ok) {
        const reason = "reason" in result ? result.reason : "unknown";
        opts.onSkip?.({
          source,
          line: i + 1,
          streamIndex: out.length,
          raw,
          reason: `schema validation failed: ${reason}`
        });
        continue;
      }
    }
    out.push(parsed);
  }
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
var SIDECAR_MAX_BYTES3, ORPHAN_RESULT_EXCERPT;
var init_event_log_sidecar = __esm({
  "../src/modules/lifecycle/workflows/event-log-sidecar.ts"() {
    init_security();
    init_stable_lock();
    init_event_log_schema();
    init_event_log_writer();
    SIDECAR_MAX_BYTES3 = 1024 * 1024;
    ORPHAN_RESULT_EXCERPT = "<orphaned \u2014 pre/post pairing failed>";
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
  const sentinelPath2 = path17.join(cwd, ".guild", "runs", "current-run-id");
  try {
    const value = fs15.readFileSync(sentinelPath2, "utf8").trim();
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
    appendEvent(path17.join(cwd, ".guild", "runs", runId), event);
  } catch (err) {
    process.stderr.write(
      `[emit-loop-event] ERROR: could not write event: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
var fs15, path17, VALID_EVENTS, VALID_LAYERS, VALID_TERMINATED;
var init_emit_loop_event = __esm({
  "../src/modules/lifecycle/workflows/emit-loop-event.ts"() {
    fs15 = __toESM(require("fs"));
    path17 = __toESM(require("path"));
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
  return path18.join(runDir3, "run-state.json");
}
function loadRunState(runDir3) {
  let raw;
  try {
    raw = fs16.readFileSync(runStatePath(runDir3), "utf8");
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
  fs16.mkdirSync(runDir3, { recursive: true });
  const finalPath = runStatePath(runDir3);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs16.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  try {
    fs16.renameSync(tmpPath, finalPath);
  } catch (err) {
    try {
      fs16.unlinkSync(tmpPath);
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
  return path18.join(runDir3, "lanes", laneId2, "resume.json");
}
function readResumeEnabled(cwd) {
  const settingsPath = path18.join(resolveGuildRoot2(cwd), ".guild", "settings.json");
  try {
    const raw = fs16.readFileSync(settingsPath, "utf8");
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
    const raw = fs16.readFileSync(laneResumeCheckpointPath(runDir3, laneId2), "utf8");
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
    fs16.mkdirSync(path18.dirname(checkpointPath), { recursive: true });
    fs16.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2) + "\n", "utf8");
  }
  return state;
}
var fs16, path18, RUN_STATE_SCHEMA_VERSION, LANE_RESUME_SCHEMA_VERSION;
var init_run_state = __esm({
  "../src/modules/lifecycle/workflows/run-state.ts"() {
    fs16 = __toESM(require("node:fs"));
    path18 = __toESM(require("node:path"));
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
  return path19.resolve(runDir3, "..", "..", "..");
}
function markLaneDeadFromArgs(args) {
  const cwd = args.cwd ?? repoRootFromRunDir(args.runDir);
  const runId = args.runId ?? path19.basename(args.runDir);
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
var path19;
var init_mark_lane_dead = __esm({
  "../src/modules/lifecycle/workflows/mark-lane-dead.ts"() {
    path19 = __toESM(require("path"));
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
    raw = fs17.readFileSync(path20.join(guildRoot, ".guild", "plan", `${slug}.md`), "utf8");
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
var fs17, path20;
var init_team_file = __esm({
  "../src/modules/teams/workflows/team-file.ts"() {
    fs17 = __toESM(require("fs"));
    path20 = __toESM(require("path"));
    init_lifecycle();
    init_state();
  }
});

// ../src/modules/teams/workflows/canonical-hash.ts
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
function isPlainObject3(v) {
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
    } else if (isPlainObject3(v)) {
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
    } else if (isPlainObject3(item)) {
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
  if (isPlainObject3(value)) return Object.keys(value).length === 0 ? "{}\n" : renderMap(value, "");
  throw new Error("canonical-hash: unrepresentable document value");
}
function sha256Hex2(text) {
  return crypto5.createHash("sha256").update(text, "utf8").digest("hex");
}
function selfReferentialHash(artifact, hashField) {
  const clone = { ...artifact };
  delete clone[hashField];
  return sha256Hex2(canonicalYaml(clone));
}
var crypto5, AMBIGUOUS_SCALAR_PATTERNS, LEADING_INDICATORS, DQ_ESCAPES;
var init_canonical_hash = __esm({
  "../src/modules/teams/workflows/canonical-hash.ts"() {
    crypto5 = __toESM(require("crypto"));
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

// ../src/modules/teams/index.ts
var init_teams = __esm({
  "../src/modules/teams/index.ts"() {
    init_team_file();
    init_canonical_hash();
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
    entries = fs18.readdirSync(lanesDir, { withFileTypes: true });
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
var fs18, path21;
var init_resume_lanes = __esm({
  "../src/modules/lifecycle/workflows/resume-lanes.ts"() {
    fs18 = __toESM(require("fs"));
    path21 = __toESM(require("path"));
    init_run_state();
    init_teams();
    if (require.main === module && new RegExp("[\\\\/]resume-lanes\\.[cm]?[jt]s$").test(process.argv[1] ?? "")) {
      runResumeLanesCli();
    }
  }
});

// ../src/modules/lifecycle/workflows/retry-lane.ts
function calcDelayMs(attempt, strategy, baseMs) {
  switch (strategy) {
    case "immediate":
      return 0;
    case "linear":
      return baseMs * attempt;
    case "exponential":
      return baseMs * Math.pow(2, attempt - 1);
    default:
      return 0;
  }
}
function realSleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve17) => setTimeout(resolve17, ms));
}
async function runWithRetry(dispatchFn, opts) {
  const maxAttempts = Math.max(1, Math.floor(opts.maxAttempts));
  const baseMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = opts.sleep ?? realSleep;
  let lastError = new Error("runWithRetry: no attempt was made");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await dispatchFn();
      return { result, attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isFinalAttempt = attempt >= maxAttempts;
      if (isFinalAttempt) {
        const signal = {
          attempts: maxAttempts,
          lastAttemptAt: (/* @__PURE__ */ new Date()).toISOString(),
          lastError: lastError.message.slice(0, 500)
        };
        if (opts.onExhausted) {
          await opts.onExhausted(signal);
        }
        throw lastError;
      }
      if (opts.onAttemptFailed) {
        await opts.onAttemptFailed(attempt, lastError);
      }
      const delay = calcDelayMs(attempt, opts.backoff, baseMs);
      if (delay > 0) {
        await sleep(delay);
      }
    }
  }
  throw lastError;
}
function loadRetryOpts(cwd) {
  try {
    const { config } = resolveSettings({ cwd });
    const retry = config.defaults?.["retry"];
    let maxAttempts = 1;
    let backoff = "immediate";
    if (retry && typeof retry === "object") {
      const ma = retry["max_attempts"];
      if (typeof ma === "number" && Number.isFinite(ma)) {
        maxAttempts = Math.max(1, Math.floor(ma));
      }
      const bo = retry["backoff"];
      if (typeof bo === "string" && VALID_BACKOFF.has(bo)) {
        backoff = bo;
      }
    }
    return { maxAttempts, backoff };
  } catch {
    return { maxAttempts: 1, backoff: "immediate" };
  }
}
var DEFAULT_BASE_DELAY_MS, VALID_BACKOFF;
var init_retry_lane = __esm({
  "../src/modules/lifecycle/workflows/retry-lane.ts"() {
    init_config2();
    DEFAULT_BASE_DELAY_MS = 1e3;
    VALID_BACKOFF = /* @__PURE__ */ new Set(["immediate", "linear", "exponential"]);
  }
});

// ../src/modules/lifecycle/workflows/run-binding.ts
function realBindingFs() {
  return {
    mkdirp: (p) => fsReal2.mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => fsReal2.writeFileSync(p, c, "utf8"),
    readFile: (p) => fsReal2.existsSync(p) ? fsReal2.readFileSync(p, "utf8") : null,
    exists: (p) => fsReal2.existsSync(p)
  };
}
function runBindingPath(root, runId) {
  return path22.join(root, ".guild", "runs", runId, "binding.json");
}
function mintRunBinding(opts) {
  const fs32 = opts.fs ?? realBindingFs();
  const p = runBindingPath(opts.root, opts.run_id);
  if (fs32.exists(p)) {
    throw new Error(
      `run-binding: a binding for ${opts.run_id} is already minted \u2014 resume restores it (loadRunBinding); it is never re-minted`
    );
  }
  const record = {
    schema_version: "guild.run_binding.v1",
    run_id: opts.run_id,
    binding_ref: `rb-${crypto6.randomBytes(16).toString("hex")}`,
    state: "open"
  };
  fs32.mkdirp(path22.dirname(p));
  fs32.writeFile(p, JSON.stringify(record, null, 2) + "\n");
  return record;
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
  const fs32 = opts.fs ?? realBindingFs();
  const raw = fs32.readFile(runBindingPath(opts.root, opts.run_id));
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
function loadRunBinding(opts) {
  const read = readRunBindingRecord(opts);
  return read.status === "ok" ? read.record : null;
}
function closeRunBinding(opts) {
  const fs32 = opts.fs ?? realBindingFs();
  const record = loadRunBinding(opts);
  if (record === null || record.state === "closed") return;
  fs32.writeFile(
    runBindingPath(opts.root, opts.run_id),
    JSON.stringify({ ...record, state: "closed" }, null, 2) + "\n"
  );
}
function reopenRunBinding(opts, binding_ref) {
  const fs32 = opts.fs ?? realBindingFs();
  const read = readRunBindingRecord(opts);
  if (read.status === "absent") throw new BindingRejectedError("binding_not_minted", opts.run_id);
  if (read.status === "malformed") throw new BindingRejectedError("binding_malformed", opts.run_id);
  const record = read.record;
  if (record.binding_ref !== binding_ref) {
    throw new BindingRejectedError("binding_mismatch", opts.run_id);
  }
  if (record.state === "open") return record;
  const reopened = { ...record, state: "open" };
  fs32.writeFile(runBindingPath(opts.root, opts.run_id), JSON.stringify(reopened, null, 2) + "\n");
  return reopened;
}
function verifyRunBinding(input) {
  const reject = (reason) => ({
    ok: false,
    diagnostic: "binding_rejected",
    reason
  });
  if (!input.run_id || !input.binding_ref) return reject("binding_absent");
  if (!input.root) return reject("binding_unverifiable");
  const read = readRunBindingRecord({ root: input.root, run_id: input.run_id, fs: input.fs });
  if (read.status === "absent") return reject("binding_not_minted");
  if (read.status === "malformed") return reject("binding_malformed");
  const record = read.record;
  if (record.state === "closed") return reject("binding_closed");
  if (record.binding_ref !== input.binding_ref || record.run_id !== input.run_id) {
    return reject("binding_mismatch");
  }
  return { ok: true, binding: record };
}
function assertWritableBinding(input) {
  const verdict = verifyRunBinding(input);
  if (verdict.ok === false) throw new BindingRejectedError(verdict.reason, input.run_id);
  return verdict.binding;
}
function locateCandidateRunId(root, fs32) {
  const f = fs32 ?? realBindingFs();
  const candidates = [
    [path22.join(root, ".guild", "runs", "current-run-id"), "sentinel-legacy"],
    [path22.join(root, ".guild", "current-run-id"), "sentinel-b2"]
  ];
  for (const [p, source] of candidates) {
    const raw = f.readFile(p);
    const runId = raw?.trim();
    if (runId) return { run_id: runId, source, intake_only: true };
  }
  return null;
}
function readHookBindingEnvelope(env) {
  const run_id = env[HOOK_BINDING_ENV_RUN_ID]?.trim();
  const binding_ref = env[HOOK_BINDING_ENV_BINDING_REF]?.trim();
  if (!run_id || !binding_ref) return null;
  return { run_id, binding_ref };
}
var crypto6, fsReal2, path22, BindingRejectedError, HOOK_BINDING_ENV_RUN_ID, HOOK_BINDING_ENV_BINDING_REF;
var init_run_binding = __esm({
  "../src/modules/lifecycle/workflows/run-binding.ts"() {
    crypto6 = __toESM(require("crypto"));
    fsReal2 = __toESM(require("fs"));
    path22 = __toESM(require("path"));
    BindingRejectedError = class extends Error {
      constructor(reason, run_id) {
        super(`binding_rejected (${reason}) for run ${run_id ?? "<absent>"}`);
        this.reason = reason;
        this.run_id = run_id;
        this.name = "BindingRejectedError";
      }
      reason;
      run_id;
      diagnostic = "binding_rejected";
    };
    HOOK_BINDING_ENV_RUN_ID = "GUILD_RUN_ID";
    HOOK_BINDING_ENV_BINDING_REF = "GUILD_RUN_BINDING_REF";
  }
});

// ../src/modules/lifecycle/workflows/write-run-manifest.ts
function manifestPathFor(cwd, slug) {
  return path23.join(cwd, ".guild", "programs", slug, "manifest.json");
}
function readRunManifest(cwd, slug) {
  try {
    const raw = fs19.readFileSync(manifestPathFor(cwd, slug), "utf8");
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
  if (!fs19.existsSync(args.cwd) || !fs19.statSync(args.cwd).isDirectory()) {
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
var fs19, path23, WAVE_STATUSES, PROGRAM_STATUSES;
var init_write_run_manifest = __esm({
  "../src/modules/lifecycle/workflows/write-run-manifest.ts"() {
    fs19 = __toESM(require("fs"));
    path23 = __toESM(require("path"));
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
function buildMultiWaveProgram(opts) {
  const { cwd, slug, title, waves, now, programStatus } = opts;
  let result = null;
  for (const wave of waves) {
    result = wireRunManifest({ cwd, slug, title, now, wave });
  }
  if (programStatus !== void 0) {
    result = wireRunManifest({ cwd, slug, now, programStatus });
  }
  if (!result) {
    result = wireRunManifest({ cwd, slug, title, now });
  }
  return result;
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

// ../src/modules/lifecycle/workflows/runstart-preflight.ts
function persistTmuxTeamArgv(scope = "workspace") {
  return ["set", "agent_mode", "team", "--scope", scope];
}
function runStartPreflight(opts) {
  const { cwd, flags, probe: injectedProbe } = opts;
  const probe = injectedProbe ?? defaultPreflightProbe(cwd);
  const resolved = resolveSettings({ cwd, flags: flags ?? {} });
  const { config, sources } = resolved;
  const validationErrors = [];
  if (config.models) {
    validationErrors.push(
      ...validateModels(config.models)
    );
  }
  if (config.security) {
    validationErrors.push(
      ...validateSecurity(config.security)
    );
  }
  if (config.secrets_policy) {
    validationErrors.push(
      ...validateSecretsPolicy(config.secrets_policy)
    );
  }
  if (config.mcp) {
    validationErrors.push(
      ...validateMcp(config.mcp)
    );
  }
  if (config.defaults) {
    validationErrors.push(
      ...validateDefaults(config.defaults, false)
    );
  }
  const validation = {
    ok: validationErrors.length === 0,
    errors: validationErrors
  };
  const tmuxAvailable = safeProbe(() => probe.tmuxOnPath(), false);
  const agentModeIsTeam = config.agent_mode === "team";
  const tmux = {
    available: tmuxAvailable,
    inEffect: agentModeIsTeam
  };
  const needsTmuxPrompt = tmuxAvailable && !agentModeIsTeam;
  const tmuxPrompt = needsTmuxPrompt ? {
    question: "tmux is available on this machine. Update settings to use tmux agent teams for all Guild runs? (Recommended \u2014 gives you visible team panes and deterministic team dispatch.)",
    persistCommand: persistTmuxTeamArgv("workspace")
  } : null;
  const resolvedProvider = config.adversarial_review_provider !== "auto" ? config.adversarial_review_provider : "auto";
  const reviewProjection = {
    mode: config.review,
    provider: resolvedProvider
  };
  const explicitHost = config.host && config.host !== "auto" ? config.host : void 0;
  const nativeIdentity = probe.hostIdentity ? safeProbe(() => probe.hostIdentity(), null) : null;
  const identityHost = nativeIdentity ? nativeIdentity.family : explicitHost;
  const identityTrust = nativeIdentity ? "verified" : "asserted";
  const detection = safeProbe(
    () => detectProviders({
      cwd,
      host: identityHost,
      trust: identityTrust,
      probe: probe.providerProbe
    }),
    { authorHost: "unknown", authorTrust: "asserted", providers: [] }
  );
  const recResult = safeProbe(
    () => recommendProvider(detection, reviewProjection),
    { recommended: null, reason: "provider detection failed" }
  );
  const selResult = safeProbe(
    () => selectReviewer(detection, reviewProjection),
    { provider: null, status: "skipped", reason: "selectReviewer failed" }
  );
  const selectedProvider = selResult.status === "selected" ? selResult.provider ?? void 0 : void 0;
  const roles = safeProbe(
    () => resolveRolesForRun(detection),
    {
      schema_version: "guild.role_resolution.v1",
      host: { role: "host", substrate: null, strength: "weak", reason: "role resolution failed" },
      advisory: { role: "advisory", substrate: null, strength: "weak", reason: "role resolution failed" },
      adversarial: { role: "adversarial", substrate: null, strength: "weak", reason: "role resolution failed" }
    }
  );
  const providers = {
    authorHost: detection.authorHost,
    // R3-F1: authorTrust is non-optional on DetectionResult — always present.
    authorTrust: detection.authorTrust,
    detected: detection.providers,
    recommended: recResult.recommended,
    reason: recResult.reason,
    // R-008: populated when a provider is deterministically selected (explicit pin or auto).
    // undefined when degraded-local or skipped.
    ...selectedProvider !== void 0 ? { selected: selectedProvider } : {}
  };
  const snapshot = {
    schema_version: "guild.resolved_settings.v1",
    source_chain: sources,
    effective: {
      agent_mode: config.agent_mode,
      host: config.host,
      review: config.review,
      rigor: config.rigor,
      loops: config.loops,
      loop_cap: config.loop_cap
    },
    providers: {
      authorHost: detection.authorHost,
      authorTrust: detection.authorTrust,
      detected: detection.providers,
      recommended: recResult.recommended,
      // R-008: store the selectReviewer decision in the persisted snapshot so U6/hooks
      // can read the actual provider-to-dispatch from resolved-settings.json.
      ...selectedProvider !== void 0 ? { selected: selectedProvider } : {}
    },
    roles,
    communication_contract: "review_result.v1",
    resolved_at_ref: null
  };
  const incompleteHit = safeProbe(() => probe.incompleteRun(), null);
  const incompleteRun = incompleteHit ? {
    runId: incompleteHit.runId,
    runDir: incompleteHit.runDir,
    question: `Run ${incompleteHit.runId} is still open (no verify.md). Resume it, restart the phase, attach this work to it, or ignore and start fresh? [resume / restart / attach / ignore]`
  } : null;
  return {
    resolved,
    sources,
    // top-level convenience alias for resolved.sources (U6/U7 contract)
    validation,
    tmux,
    needsTmuxPrompt,
    tmuxPrompt,
    incompleteRun,
    providers,
    snapshot,
    session_identity: {
      ...explicitHost !== void 0 ? { envelope_host: explicitHost } : {},
      native_adapter: nativeIdentity
    }
  };
}
function defaultPreflightProbe(cwd) {
  return {
    tmuxOnPath: () => safeProbe(() => {
      (0, import_child_process2.execSync)("command -v tmux", { stdio: "ignore" });
      return true;
    }, false),
    providerProbe: defaultProbeEnv(cwd),
    incompleteRun: () => safeProbe(() => {
      const idFile = (0, import_path.join)(cwd, ".guild", "runs", "current-run-id");
      if (!(0, import_fs.existsSync)(idFile)) return null;
      const runId = (0, import_fs.readFileSync)(idFile, "utf8").trim();
      if (!runId) return null;
      const runDir3 = (0, import_path.join)(cwd, ".guild", "runs", runId);
      if (!(0, import_fs.existsSync)(runDir3)) return null;
      if ((0, import_fs.existsSync)((0, import_path.join)(runDir3, "verify.md"))) return null;
      return { runId, runDir: runDir3 };
    }, null),
    // T3 — session_context §4 step 2: the Claude Code host sets CLAUDECODE=1
    // (and a plugin-root env) in every process it spawns; that host-set marker
    // is native-adapter evidence for family "claude". No marker ⇒ null — the
    // caller then records the honest "unknown", never a defaulted family.
    hostIdentity: () => safeProbe(() => {
      const env = process.env;
      if (env["CLAUDECODE"] === "1" || env["CLAUDE_PLUGIN_ROOT"]) {
        return {
          family: "claude",
          surface: "cli",
          adapter_id: "claude-code-native",
          adapter_version: env["CLAUDE_CODE_VERSION"] ?? "unknown",
          evidence: "host-set process env marker (CLAUDECODE / CLAUDE_PLUGIN_ROOT) injected by the Claude Code host at spawn"
        };
      }
      return null;
    }, null)
  };
}
function safeProbe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
var import_child_process2, import_fs, import_path;
var init_runstart_preflight = __esm({
  "../src/modules/lifecycle/workflows/runstart-preflight.ts"() {
    init_config2();
    init_host_runtime();
    init_capability();
    init_config2();
    import_child_process2 = require("child_process");
    import_fs = require("fs");
    import_path = require("path");
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
function makeConfigResolutionEvent(fields) {
  return { schema_version: "guild.trace.config_resolution.v1", ...fields };
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
function liveLogPath2(runDir3) {
  return path24.join(runDir3, "logs", "v1.4-events.jsonl");
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
    const dir = path24.dirname(live);
    fs20.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(event) + "\n";
    fs20.appendFileSync(live, line, "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `[guild-trace-emit] WARN: could not write trace event to ${runDir3}/logs/v1.4-events.jsonl: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}
var fs20, path24;
var init_guild_trace_emit = __esm({
  "../src/modules/telemetry/workflows/guild-trace-emit.ts"() {
    fs20 = __toESM(require("node:fs"));
    path24 = __toESM(require("node:path"));
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

// ../src/modules/lifecycle/workflows/write-task-run.ts
function taskRunPath(cwd, runId, taskId) {
  return path25.join(cwd, ".guild", "runs", runId, "task-runs", `${taskId}.yaml`);
}
function readTaskRunCapReqs(cwd, runId, taskId) {
  try {
    const p = taskRunPath(cwd, runId, taskId);
    const raw = fs21.readFileSync(p, "utf8");
    const doc = loadYamlApi().load(raw);
    const cr = doc?.task_run?.host?.capability_requirements;
    if (!cr) return void 0;
    return {
      needs_pr: cr.needs_pr,
      needs_parallel: cr.needs_parallel,
      needs_network: cr.needs_network,
      isolation: cr.isolation
    };
  } catch {
    return void 0;
  }
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
    const _traceRunDir = path25.join(cwd, ".guild", "runs", runId);
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
var fs21, path25;
var init_write_task_run = __esm({
  "../src/modules/lifecycle/workflows/write-task-run.ts"() {
    fs21 = __toESM(require("fs"));
    path25 = __toESM(require("path"));
    init_telemetry();
    init_kernel();
    init_state();
    if (require.main === module && new RegExp("[\\\\/]write-task-run\\.[cm]?[jt]s$").test(process.argv[1] ?? "")) {
      runWriteTaskRunCli();
    }
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
function isNeutralSupportState(value) {
  return includes(NEUTRAL_SUPPORT_STATES, value);
}
function isNeutralSupportStatus(value) {
  return includes(NEUTRAL_SUPPORT_STATUS_VALUES, value);
}
function isNeutralScenarioCategory(value) {
  return includes(NEUTRAL_SCENARIO_CATEGORIES, value);
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
      "boundary_capability_alias"
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
function bindingFor2(request, snapshot) {
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
  const binding = bindingFor2(request, snapshot);
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
  const binding = bindingFor2(request, snapshot);
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
  const binding = bindingFor2(request, snapshot);
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
function bindingFor3(state, event) {
  return {
    run_id: state.run_id,
    operation_id: event.transition_id,
    capability_snapshot_hash: state.capability_snapshot_hash,
    contract_version: NEUTRAL_CONTRACT_VERSION
  };
}
function refuse2(state, event, reason, facts, assertions) {
  return neutralFreeze({
    state,
    state_changed: false,
    outcome: neutralOutcome({
      type: "guild.lifecycle_outcome.v1",
      disposition: "refused",
      reason_code: reason,
      assertions: [...assertions],
      binding: bindingFor3(state, event),
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
      binding: bindingFor3(state, event),
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
      binding: { ...bindingFor3(next, event), ...bindingOverride ?? {} },
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
    return refuse2(
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
    return refuse2(
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
    return refuse2(
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
        binding: { ...admission.binding, ...bindingFor3(state, event), ...evaluatedBinding },
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
    return refuse2(
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
      binding: bindingFor3(state, event),
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
    return refuse2(
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
      return refuse2(
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
    return refuse2(
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
    return refuse2(
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
    return refuse2(
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
    return refuse2(
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
    return refuse2(
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
    return refuse2(
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
    return refuse2(
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
      return refuse2(
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
    return refuse2(
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
    return refuse2(
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
function applyNeutralLifecycleEvents(state, events) {
  const results = [];
  let current = state;
  for (const event of events) {
    const result = applyNeutralLifecycleEvent(current, event);
    results.push(result);
    current = result.state;
  }
  return results;
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
function validateNeutralScenarioRegistry(scenarios = NEUTRAL_CORE_SCENARIOS) {
  const errors = [];
  const seen = /* @__PURE__ */ new Set();
  for (const scenario of scenarios) {
    const id = scenario.stable_id;
    if (typeof id !== "string" || id.length === 0) {
      errors.push("scenario is missing a stable_id");
      continue;
    }
    if (seen.has(id)) errors.push(`duplicate stable_id ${id}`);
    seen.add(id);
    if (!isNeutralScenarioCategory(scenario.category)) {
      errors.push(`scenario ${id}: unknown category ${JSON.stringify(scenario.category)}`);
    }
    if (typeof scenario.title !== "string" || scenario.title.length === 0) {
      errors.push(`scenario ${id}: title must be a non-empty string`);
    }
    if (!Array.isArray(scenario.preconditions) || scenario.preconditions.length === 0) {
      errors.push(`scenario ${id}: preconditions must be a non-empty array`);
    }
    if (!scenario.action_event || !isNeutralEventName(scenario.action_event.name)) {
      errors.push(
        `scenario ${id}: action_event.name ${JSON.stringify(scenario.action_event?.name)} is not a closed event name`
      );
    }
    const expected = scenario.expected_typed_outcome;
    if (!expected) {
      errors.push(`scenario ${id}: expected_typed_outcome is required`);
    } else {
      if (!isNeutralOutcomeType(expected.type)) {
        errors.push(`scenario ${id}: unknown outcome type ${JSON.stringify(expected.type)}`);
      }
      if (!isNeutralDisposition(expected.disposition)) {
        errors.push(`scenario ${id}: unknown disposition ${JSON.stringify(expected.disposition)}`);
      }
      if (!Array.isArray(expected.assertions) || expected.assertions.length === 0) {
        errors.push(`scenario ${id}: expected_typed_outcome.assertions must be non-empty`);
      }
    }
    if (!Array.isArray(scenario.evidence_requirements) || scenario.evidence_requirements.length === 0) {
      errors.push(`scenario ${id}: evidence_requirements must be a non-empty array`);
    } else {
      for (const requirement of scenario.evidence_requirements) {
        if (NEUTRAL_EVIDENCE_PROFILES[requirement.profile] === void 0) {
          errors.push(
            `scenario ${id}: unknown evidence profile ${JSON.stringify(requirement.profile)}`
          );
        }
        if (!Array.isArray(requirement.assertions) || requirement.assertions.length === 0) {
          errors.push(`scenario ${id}: evidence profile ${requirement.profile} needs assertions`);
        }
      }
    }
    const owner = scenario.implementation_wave_owner;
    if (!owner || !owner.wave_id || !owner.work_item_id) {
      errors.push(`scenario ${id}: implementation_wave_owner must name exactly one owner`);
    } else if (owner.key !== `${owner.wave_id}/${owner.work_item_id}`) {
      errors.push(`scenario ${id}: implementation_wave_owner.key disagrees with its parts`);
    }
  }
  const facts = {
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    scenario_count: scenarios.length,
    unique_stable_ids: seen.size,
    errors
  };
  return errors.length === 0 ? neutralOutcome({
    type: "guild.boundary_outcome.v1",
    disposition: "succeeded",
    assertions: ["every scenario satisfies the frozen scenario_field_contract"],
    facts
  }) : neutralOutcome({
    type: "guild.boundary_outcome.v1",
    disposition: "failed",
    reason_code: "scenario_registry_invalid",
    assertions: ["an invalid scenario registry cannot back a conformance claim"],
    facts
  });
}
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
function neutralReceiptReference(authority, entry) {
  return `${NEUTRAL_RECEIPT_REF_SCHEMA}:${authority.receipt_journal_id}#${entry.sequence}@${entry.entry_commitment}`;
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
    let hex3 = "";
    while (j < source.length && isHexDigit(source.charAt(j))) {
      hex3 += source.charAt(j);
      j += 1;
    }
    if (hex3.length === 0 || source.charAt(j) !== "}") return void 0;
    const code = parseInt(hex3, 16);
    if (!Number.isFinite(code) || code > 1114111) return void 0;
    return { char: String.fromCodePoint(code), end: j + 1 };
  }
  const hex2 = source.slice(start + 2, start + 6);
  if (hex2.length < 4) return void 0;
  for (let k = 0; k < 4; k += 1) {
    if (!isHexDigit(hex2.charAt(k))) return void 0;
  }
  return { char: String.fromCharCode(parseInt(hex2, 16)), end: start + 6 };
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
function extractNeutralImportSpecifiers(source) {
  const found = [];
  for (const edge of extractNeutralImportEdges(source)) {
    if (edge.kind !== "resolved" || edge.specifier === void 0) continue;
    if (found.indexOf(edge.specifier) === -1) found.push(edge.specifier);
  }
  return found;
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
  const unresolved2 = [];
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
        unresolved2.push({
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
  const edgeCount = forbidden.length + unclassified.length + intraCore.length + unresolved2.length;
  const facts = {
    declared_members: [...declared],
    missing_members: missingMembers,
    undeclared_files: undeclaredFiles,
    node_count: suppliedPaths.length,
    edge_count: edgeCount,
    intra_core_edges: intraCore,
    forbidden_edges: forbidden,
    unclassified_edges: unclassified,
    unresolved_edges: unresolved2,
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
  if (unresolved2.length > 0) {
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

// ../src/modules/lifecycle/index.ts
var lifecycle_exports = {};
__export(lifecycle_exports, {
  BindingRejectedError: () => BindingRejectedError,
  CANONICAL_PHASES: () => CANONICAL_PHASES,
  DEFAULT_HEARTBEAT_TIMEOUT_MS: () => DEFAULT_HEARTBEAT_TIMEOUT_MS,
  HOOK_BINDING_ENV_BINDING_REF: () => HOOK_BINDING_ENV_BINDING_REF,
  HOOK_BINDING_ENV_RUN_ID: () => HOOK_BINDING_ENV_RUN_ID,
  MANIFEST_REQUIRED_KEYS: () => MANIFEST_REQUIRED_KEYS,
  NEUTRAL_ATTESTATION_CHAINS: () => NEUTRAL_ATTESTATION_CHAINS,
  NEUTRAL_ATTESTATION_CHAIN_LENGTH: () => NEUTRAL_ATTESTATION_CHAIN_LENGTH,
  NEUTRAL_ATTESTATION_CHECKSUM_CHAINS: () => NEUTRAL_ATTESTATION_CHECKSUM_CHAINS,
  NEUTRAL_ATTESTATION_MESSAGE_CHAINS: () => NEUTRAL_ATTESTATION_MESSAGE_CHAINS,
  NEUTRAL_ATTESTATION_REF_SCHEMA: () => NEUTRAL_ATTESTATION_REF_SCHEMA,
  NEUTRAL_ATTESTATION_SCHEME: () => NEUTRAL_ATTESTATION_SCHEME,
  NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN: () => NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN,
  NEUTRAL_ATTESTATION_TREE_HEIGHT: () => NEUTRAL_ATTESTATION_TREE_HEIGHT,
  NEUTRAL_ATTESTOR_TRUST_ROOT: () => NEUTRAL_ATTESTOR_TRUST_ROOT,
  NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA: () => NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA,
  NEUTRAL_CONTRACTS_SCHEMA_VERSION: () => NEUTRAL_CONTRACTS_SCHEMA_VERSION,
  NEUTRAL_CONTRACT_VERSION: () => NEUTRAL_CONTRACT_VERSION,
  NEUTRAL_CORE_MEMBERS: () => NEUTRAL_CORE_MEMBERS,
  NEUTRAL_CORE_SCENARIOS: () => NEUTRAL_CORE_SCENARIOS,
  NEUTRAL_CORE_WAVE_OWNER: () => NEUTRAL_CORE_WAVE_OWNER,
  NEUTRAL_DISPOSITIONS: () => NEUTRAL_DISPOSITIONS,
  NEUTRAL_EVENT_COMPATIBILITY_KINDS: () => NEUTRAL_EVENT_COMPATIBILITY_KINDS,
  NEUTRAL_EVENT_COMPATIBILITY_RULES: () => NEUTRAL_EVENT_COMPATIBILITY_RULES,
  NEUTRAL_EVENT_NAMES: () => NEUTRAL_EVENT_NAMES,
  NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2: () => NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2,
  NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS: () => NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS: () => NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_EVIDENCE_PROFILES: () => NEUTRAL_EVIDENCE_PROFILES,
  NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS: () => NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS,
  NEUTRAL_LIFECYCLE_PHASES: () => NEUTRAL_LIFECYCLE_PHASES,
  NEUTRAL_MINIMUM_ATTESTOR_QUORUM: () => NEUTRAL_MINIMUM_ATTESTOR_QUORUM,
  NEUTRAL_NORMALIZED_EVENT_VOCABULARY: () => NEUTRAL_NORMALIZED_EVENT_VOCABULARY,
  NEUTRAL_OBSERVATION_STATES: () => NEUTRAL_OBSERVATION_STATES,
  NEUTRAL_OUTCOME_TYPES: () => NEUTRAL_OUTCOME_TYPES,
  NEUTRAL_PROTOTYPE_CHAIN_PROPERTIES: () => NEUTRAL_PROTOTYPE_CHAIN_PROPERTIES,
  NEUTRAL_PURE_INTRINSIC_ROOTS: () => NEUTRAL_PURE_INTRINSIC_ROOTS,
  NEUTRAL_REASON_CODES: () => NEUTRAL_REASON_CODES,
  NEUTRAL_RECEIPT_REF_SCHEMA: () => NEUTRAL_RECEIPT_REF_SCHEMA,
  NEUTRAL_RECOGNIZED_ADAPTER_MAJOR: () => NEUTRAL_RECOGNIZED_ADAPTER_MAJOR,
  NEUTRAL_RECOGNIZED_HOST_IDS: () => NEUTRAL_RECOGNIZED_HOST_IDS,
  NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS: () => NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS,
  NEUTRAL_RECOGNIZED_PLATFORMS: () => NEUTRAL_RECOGNIZED_PLATFORMS,
  NEUTRAL_RECOGNIZED_RUNTIME_MAJOR: () => NEUTRAL_RECOGNIZED_RUNTIME_MAJOR,
  NEUTRAL_REFLECTION_METHOD_NAMES: () => NEUTRAL_REFLECTION_METHOD_NAMES,
  NEUTRAL_REQUIRED_CORE_SCENARIO_IDS: () => NEUTRAL_REQUIRED_CORE_SCENARIO_IDS,
  NEUTRAL_RUN_STATUSES: () => NEUTRAL_RUN_STATUSES,
  NEUTRAL_SCENARIO_CATEGORIES: () => NEUTRAL_SCENARIO_CATEGORIES,
  NEUTRAL_SCENARIO_SUITE_ID: () => NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION: () => NEUTRAL_SCENARIO_SUITE_VERSION,
  NEUTRAL_SUPERSEDED_EVENT_NAMES_V1: () => NEUTRAL_SUPERSEDED_EVENT_NAMES_V1,
  NEUTRAL_SUPPORT_STATES: () => NEUTRAL_SUPPORT_STATES,
  NEUTRAL_SUPPORT_STATUS_VALUES: () => NEUTRAL_SUPPORT_STATUS_VALUES,
  NEUTRAL_SUPPORT_TRANSITIONS: () => NEUTRAL_SUPPORT_TRANSITIONS,
  NEUTRAL_TERMINAL_RUN_STATUSES: () => NEUTRAL_TERMINAL_RUN_STATUSES,
  NEUTRAL_UNEVALUATED_SUPPORT: () => NEUTRAL_UNEVALUATED_SUPPORT,
  PROGRAM_STATUSES: () => PROGRAM_STATUSES2,
  WAVE_REQUIRED_KEYS: () => WAVE_REQUIRED_KEYS,
  WAVE_STATUSES: () => WAVE_STATUSES2,
  analyzeNeutralCapabilityUse: () => analyzeNeutralCapabilityUse,
  appendGateOutcome: () => appendGateOutcome,
  appendPhase: () => appendPhase,
  applyNeutralLifecycleEvent: () => applyNeutralLifecycleEvent,
  applyNeutralLifecycleEvents: () => applyNeutralLifecycleEvents,
  applyNeutralSupportTransition: () => applyNeutralSupportTransition,
  assertWritableBinding: () => assertWritableBinding,
  buildMultiWaveProgram: () => buildMultiWaveProgram,
  calcDelayMs: () => calcDelayMs,
  closeRunBinding: () => closeRunBinding,
  collectNeutralBoundNames: () => collectNeutralBoundNames,
  createRealEnv: () => createRealEnv,
  createRunLifecycle: () => createRunLifecycle,
  defaultPreflightProbe: () => defaultPreflightProbe,
  deriveNeutralSupportClaim: () => deriveNeutralSupportClaim,
  evaluateNeutralAdmission: () => evaluateNeutralAdmission,
  evaluateNeutralCapability: () => evaluateNeutralCapability,
  evaluateNeutralConformanceDecision: () => evaluateNeutralConformanceDecision,
  evaluateNeutralCoreBoundary: () => evaluateNeutralCoreBoundary,
  evaluateNeutralGate: () => evaluateNeutralGate,
  evaluateNeutralPolicy: () => evaluateNeutralPolicy,
  extractNeutralImportEdges: () => extractNeutralImportEdges,
  extractNeutralImportSpecifiers: () => extractNeutralImportSpecifiers,
  freezeNeutralCapabilitySnapshot: () => freezeNeutralCapabilitySnapshot,
  initRunManifest: () => initRunManifest,
  isCanonicalPhase: () => isCanonicalPhase,
  isNeutralCleanObservation: () => isNeutralCleanObservation,
  isNeutralDisposition: () => isNeutralDisposition,
  isNeutralEventName: () => isNeutralEventName,
  isNeutralLifecyclePhase: () => isNeutralLifecyclePhase,
  isNeutralObservationState: () => isNeutralObservationState,
  isNeutralOutcomeType: () => isNeutralOutcomeType,
  isNeutralReasonCode: () => isNeutralReasonCode,
  isNeutralRecognizedRuntimeVersion: () => isNeutralRecognizedRuntimeVersion,
  isNeutralScenarioCategory: () => isNeutralScenarioCategory,
  isNeutralSupportState: () => isNeutralSupportState,
  isNeutralSupportStatus: () => isNeutralSupportStatus,
  isStalled: () => isStalled,
  loadRetryOpts: () => loadRetryOpts,
  loadRunBinding: () => loadRunBinding,
  locateCandidateRunId: () => locateCandidateRunId,
  manifestPathFor: () => manifestPathFor,
  mapLegacyNeutralEventName: () => mapLegacyNeutralEventName,
  markLaneDeadFromArgs: () => markLaneDeadFromArgs,
  mintRunBinding: () => mintRunBinding,
  neutralAdmissionContextSemanticView: () => neutralAdmissionContextSemanticView,
  neutralAdmissionContextSnapshotHash: () => neutralAdmissionContextSnapshotHash,
  neutralAttestationDigest: () => neutralAttestationDigest,
  neutralAttestationReference: () => neutralAttestationReference,
  neutralAttestationVerifies: () => neutralAttestationVerifies,
  neutralAttestorVerificationKey: () => neutralAttestorVerificationKey,
  neutralCanonicalDigest: () => neutralCanonicalDigest,
  neutralCanonicalJson: () => neutralCanonicalJson,
  neutralCapabilitySnapshotHash: () => neutralCapabilitySnapshotHash,
  neutralFingerprint: () => neutralFingerprint,
  neutralFreeze: () => neutralFreeze,
  neutralInitialLifecycleState: () => neutralInitialLifecycleState,
  neutralJournalEntryCommitment: () => neutralJournalEntryCommitment,
  neutralJournalGenesis: () => neutralJournalGenesis,
  neutralLifecycleEquivalent: () => neutralLifecycleEquivalent,
  neutralLifecycleFingerprint: () => neutralLifecycleFingerprint,
  neutralLifecycleSemanticView: () => neutralLifecycleSemanticView,
  neutralOutcome: () => neutralOutcome,
  neutralReceiptReference: () => neutralReceiptReference,
  neutralSha256Hex: () => neutralSha256Hex,
  neutralVerifyAttestationSignature: () => neutralVerifyAttestationSignature,
  parseMarkLaneDeadArgs: () => parseMarkLaneDeadArgs,
  parseResumeLanesArgs: () => parseResumeLanesArgs,
  persistTmuxTeamArgv: () => persistTmuxTeamArgv,
  readHeartbeatAges: () => readHeartbeatAges,
  readHookBindingEnvelope: () => readHookBindingEnvelope,
  readReceiptEvidence: () => readReceiptEvidence,
  readReceiptStems: () => readReceiptStems,
  readRecordStatusRuns: () => readRecordStatusRuns,
  readResolvedSettingsSnapshot: () => readResolvedSettingsSnapshot,
  readRunBindingRecord: () => readRunBindingRecord,
  readRunManifest: () => readRunManifest,
  readRunStartedAt: () => readRunStartedAt,
  readRunStateLanes: () => readRunStateLanes,
  readTaskRunCapReqs: () => readTaskRunCapReqs,
  readWorkspaceKnowledgeConfig: () => readWorkspaceKnowledgeConfig,
  reopenRunBinding: () => reopenRunBinding,
  resolveTimeoutMs: () => resolveTimeoutMs,
  runBindingPath: () => runBindingPath,
  runCheckLaneLivenessCli: () => runCheckLaneLivenessCli,
  runEmitLoopEventCli: () => runEmitLoopEventCli,
  runMarkLaneDeadCli: () => runMarkLaneDeadCli,
  runResumeLanesCli: () => runResumeLanesCli,
  runRunManifestWiringCli: () => runRunManifestWiringCli,
  runStartPreflight: () => runStartPreflight,
  runWithRetry: () => runWithRetry,
  runWriteRunManifestCli: () => runWriteRunManifestCli,
  runWriteTaskRunCli: () => runWriteTaskRunCli,
  scanResumableLanes: () => scanResumableLanes,
  setProgramStatus: () => setProgramStatus,
  sweepLaneLiveness: () => sweepLaneLiveness,
  taskRunPath: () => taskRunPath,
  tokenizeNeutralSource: () => tokenizeNeutralSource,
  tokenizeNeutralSourceWithDiagnostics: () => tokenizeNeutralSourceWithDiagnostics,
  unrecognizedNeutralHostFields: () => unrecognizedNeutralHostFields,
  unrecognizedNeutralIdentityFields: () => unrecognizedNeutralIdentityFields,
  upsertWave: () => upsertWave,
  validateNeutralScenarioRegistry: () => validateNeutralScenarioRegistry,
  validateRunBindingRecord: () => validateRunBindingRecord,
  validateRunId: () => validateRunId,
  validateRunManifest: () => validateRunManifest,
  verifyRunBinding: () => verifyRunBinding,
  wireRunManifest: () => wireRunManifest,
  writeResolvedSettingsSnapshot: () => writeResolvedSettingsSnapshot,
  writeRunManifest: () => writeRunManifest,
  writeTaskRun: () => writeTaskRun
});
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

// ../src/modules/capability/workflows/independence-record.ts
function lifecycleApi() {
  return init_lifecycle(), __toCommonJS(lifecycle_exports);
}
function independenceDirForRunDir(runDir3) {
  return path26.join(runDir3, INDEPENDENCE_DIR);
}
function loadWrittenAdjudications(runDir3) {
  const dir = independenceDirForRunDir(runDir3);
  let names;
  try {
    names = fs22.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    let parsed;
    try {
      parsed = JSON.parse(fs22.readFileSync(path26.join(dir, name), "utf8"));
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
function findBoundAdjudications(runDir3, binding) {
  return loadWrittenAdjudications(runDir3).filter(
    (b) => sameRef(b.producer_ref, binding.producer_ref) && sameRef(b.reviewer_ref, binding.reviewer_ref)
  );
}
function assertPersistableIndependence(runDir3, independence, context, binding) {
  if (independence !== "strong") return;
  const where = independenceDirForRunDir(runDir3);
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
  const matches = findBoundAdjudications(runDir3, bound);
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
  const dir = path26.join(root, ".guild", "runs", verified2.run_id, INDEPENDENCE_DIR);
  fs22.mkdirSync(dir, { recursive: true });
  const target = path26.join(dir, `${label}.json`);
  const tmp = `${target}.tmp-${process.pid}`;
  fs22.writeFileSync(tmp, JSON.stringify(block, null, 2) + "\n", "utf8");
  fs22.renameSync(tmp, target);
  return {
    absPath: target,
    ref: path26.join(INDEPENDENCE_DIR, `${label}.json`),
    independence: validated.independence
  };
}
var fs22, path26, INDEPENDENCE_DIR, SAFE_LABEL;
var init_independence_record = __esm({
  "../src/modules/capability/workflows/independence-record.ts"() {
    fs22 = __toESM(require("fs"));
    path26 = __toESM(require("path"));
    init_independence_predicates();
    INDEPENDENCE_DIR = "independence";
    SAFE_LABEL = /^[A-Za-z0-9_.-]+$/;
  }
});

// ../src/modules/capability/workflows/model-catalog.ts
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
function deepFreeze3(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze3(value[key]);
    }
  }
  return value;
}
function freezeSnapshot(snapshot) {
  const log = [];
  const frozen = { ...snapshot, target_log: log };
  for (const key of Object.keys(snapshot)) {
    deepFreeze3(frozen[key]);
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
  "../src/modules/capability/workflows/model-catalog.ts"() {
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

// ../src/modules/capability/workflows/model-policy.ts
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

// ../src/modules/capability/workflows/model-resolver.ts
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
  return sha256Hex2(canonicalYaml(fallbacks));
}
function freezeChain(input) {
  const frozenFallbacks = JSON.parse(JSON.stringify(input.fallbacks ?? []));
  const receipt = {
    ...input,
    fallbacks: frozenFallbacks,
    fallback_hash: fallbackHash(frozenFallbacks),
    outcome: { attempted: [] },
    finalized_at: null,
    receipt_hash: null
  };
  Object.freeze(receipt.fallbacks);
  receipt.fallbacks.forEach((f) => Object.freeze(f));
  return receipt;
}
function chainModels(receipt) {
  const models = /* @__PURE__ */ new Set();
  const sel = receipt.selection;
  if (sel && typeof sel.model === "string") models.add(sel.model);
  for (const f of receipt.fallbacks ?? []) models.add(f.model);
  return models;
}
function assertNotFinalized(receipt, action) {
  if (receipt.finalized_at) {
    throw new Error(`receipt is finalized and immutable \u2014 cannot ${action} (\xA78 lifecycle)`);
  }
}
function advanceChain(receipt, failure2) {
  const advances = FALLBACK_FAILURE_TAXONOMY[failure2.failure_class];
  if (advances === void 0) {
    throw new Error(
      `failure_class "${failure2.failure_class}" is outside the closed \xA74 taxonomy \u2014 fail closed`
    );
  }
  const attemptedModels = new Set((receipt.outcome?.attempted ?? []).map((a) => a.model));
  const chain = receipt.fallbacks ?? [];
  const next = advances ? chain.find((f) => !attemptedModels.has(f.model)) ?? null : null;
  return {
    advanced: advances,
    failure_class: failure2.failure_class,
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
function recordAttempt(receipt, attempt) {
  assertNotFinalized(receipt, "record an attempt");
  if (!chainModels(receipt).has(attempt.model)) {
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
  receipt.outcome.attempted.push(entry);
  return receipt;
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
function finalizeReceipt(receipt, opts) {
  if (receipt.finalized_at) {
    throw new Error("receipt already finalized \u2014 finalization happens exactly once (\xA78)");
  }
  if (!RESOLUTION_STATUSES.includes(opts.status)) {
    throw new Error(`outcome.status "${String(opts.status)}" outside the closed union`);
  }
  (receipt.outcome.attempted ?? []).forEach((a, i) => {
    if (a.result === "served") {
      assertServedTripleConsistent(a, `finalizeReceipt: outcome.attempted[${i}]`);
    }
  });
  receipt.outcome.status = opts.status;
  const served = [...receipt.outcome.attempted].reverse().find((a) => a.result === "served");
  if (served && receipt.outcome.actual_model === void 0) {
    receipt.outcome.actual_model = served.actual_model ?? "unknown";
  }
  receipt.finalized_at = opts.at ?? (/* @__PURE__ */ new Date()).toISOString();
  receipt.receipt_hash_algorithm = "sha256";
  receipt.receipt_hash_scope = "canonical_yaml_with_receipt_hash_field_omitted";
  delete receipt["receipt_hash"];
  receipt.receipt_hash = selfReferentialHash(
    receipt,
    "receipt_hash"
  );
  return receipt;
}
function finalizeInterrupted(receipt, opts) {
  return finalizeReceipt(receipt, { status: "interrupted", at: opts?.at });
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
  return { path_or_id: `inline:${name}`, sha256: sha256Hex2(bytes) };
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
function coreHash(receipt) {
  const core = {};
  for (const [k, v] of Object.entries(receipt)) {
    if (k === "outcome" || k === "finalized_at" || k === "receipt_hash" || k === "receipt_hash_algorithm" || k === "receipt_hash_scope" || k === "resolution_core_hash")
      continue;
    if (v === void 0) continue;
    core[k] = v;
  }
  return sha256Hex2(canonicalYaml(core));
}
function failClosedCore(inputs, reason, rulePath) {
  const receipt = {
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
  receipt.resolution_core_hash_algorithm = "sha256";
  receipt.resolution_core_hash_scope = "canonical_yaml_with_resolution_core_hash_field_omitted";
  receipt.resolution_core_hash = coreHash(receipt);
  return receipt;
}
function resolve11(inputs) {
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
  const receipt = {
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
    receipt.review = {
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
    receipt.outcome.degradation = {
      kind: "effort",
      note: `selector effort "${first.selectorEffort}" not in entry reasoning_efforts; used default`
    };
  }
  Object.freeze(receipt.fallbacks);
  receipt.fallbacks.forEach((f) => Object.freeze(f));
  receipt.resolution_core_hash_algorithm = "sha256";
  receipt.resolution_core_hash_scope = "canonical_yaml_with_resolution_core_hash_field_omitted";
  receipt.resolution_core_hash = coreHash(receipt);
  return receipt;
}
function persistResolutionReceipt(runDir3, receipt) {
  const runId = path27.basename(runDir3);
  if (!receipt.run_id || receipt.run_id !== runId) {
    throw new Error(
      `run_binding_mismatch: receipt.run_id "${String(receipt.run_id)}" does not match the bound run dir "${runId}" \u2014 refusing to write`
    );
  }
  if (!receipt.dispatch_id || receipt.dispatch_id === "unbound") {
    throw new Error("run_binding_mismatch: receipt has no dispatch_id \u2014 refusing to write");
  }
  const dir = path27.join(runDir3, "resolution");
  fs23.mkdirSync(dir, { recursive: true });
  const target = path27.join(dir, `${receipt.dispatch_id}.receipt.yaml`);
  const tmp = `${target}.tmp-${process.pid}`;
  fs23.writeFileSync(tmp, canonicalYaml(receipt), "utf8");
  fs23.renameSync(tmp, target);
  return target;
}
var fs23, path27, FALLBACK_FAILURE_TAXONOMY, RESOLUTION_STATUSES, liveCatalog, SUBSTITUTION_CLASSES;
var init_model_resolver = __esm({
  "../src/modules/capability/workflows/model-resolver.ts"() {
    fs23 = __toESM(require("fs"));
    path27 = __toESM(require("path"));
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
    liveCatalog = /* @__PURE__ */ new Map();
    SUBSTITUTION_CLASSES = [
      "none",
      "provider_content_fallback",
      "provider_server_fallback",
      "provider_silent"
    ];
  }
});

// ../src/modules/capability/workflows/model-inspect.ts
function asRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
}
function str(v, fallback) {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}
function deepFreeze4(value) {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze4(v);
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
    return deepFreeze4({
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
  let receipt = null;
  let receiptFinalized = false;
  let verifiedReceiptHash = null;
  if (input.receipt !== null && input.receipt !== void 0) {
    const verdict = verifyResolutionReceipt(input.receipt);
    if (verdict.ok === true) {
      receipt = verdict.receipt;
      receiptFinalized = verdict.finalized;
      verifiedReceiptHash = verdict.finalized ? verdict.receipt.receipt_hash : null;
    } else {
      const rejected = verdict;
      unknowns.push(`receipt_unverified:${rejected.reason}`);
    }
  }
  const refs = asRecord(receipt?.["refs"]);
  const policyRef = asRecord(refs?.["policy"]);
  const policyPresent = input.policy !== null && input.policy !== void 0;
  const policy = {
    present: policyPresent,
    policy_hash: str(policyRef?.["sha256"], "") || null,
    rule_path: Array.isArray(receipt?.["rule_path"]) ? receipt["rule_path"] : null
  };
  if (!policyPresent) unknowns.push("policy");
  const selectionBlock = asRecord(receipt?.["selection"]);
  const selection = selectionBlock ? {
    model: str(selectionBlock["model"], "unknown"),
    effort: typeof selectionBlock["effort"] === "string" ? selectionBlock["effort"] : null,
    evidence_state: str(selectionBlock["evidence_state"], "unknown")
  } : null;
  if (!selection) unknowns.push("selection");
  const fallbacks = receipt && Array.isArray(receipt["fallbacks"]) && typeof receipt["fallback_hash"] === "string" ? { chain: receipt["fallbacks"], fallback_hash: receipt["fallback_hash"] } : null;
  const outcomeBlock = asRecord(receipt?.["outcome"]);
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
  return deepFreeze4({
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
  "../src/modules/capability/workflows/model-inspect.ts"() {
    init_model_resolver();
    init_independence_predicates();
    MODEL_INSPECTION_SCHEMA = "guild.model_inspection.v1";
    validateAdjudicationBlock = validateWrittenAdjudication;
  }
});

// ../src/modules/capability/workflows/inspection-persist.ts
function lifecycleApi2() {
  return init_lifecycle(), __toCommonJS(lifecycle_exports);
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
  const dir = path28.join(root, ".guild", "runs", verified2.run_id, "inspection");
  fs24.mkdirSync(dir, { recursive: true });
  const target = path28.join(dir, `${label}.json`);
  const tmp = `${target}.tmp-${process.pid}`;
  fs24.writeFileSync(tmp, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs24.renameSync(tmp, target);
  return { absPath: target, ref: path28.join("inspection", `${label}.json`) };
}
var fs24, path28, SAFE_LABEL2;
var init_inspection_persist = __esm({
  "../src/modules/capability/workflows/inspection-persist.ts"() {
    fs24 = __toESM(require("fs"));
    path28 = __toESM(require("path"));
    init_model_inspect();
    SAFE_LABEL2 = /^[A-Za-z0-9_.-]+$/;
  }
});

// ../src/modules/capability/workflows/routing-rollout.ts
function lifecycleApi3() {
  return init_lifecycle(), __toCommonJS(lifecycle_exports);
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
function resolveInRunDir(runDir3, ref) {
  const abs = path29.resolve(runDir3, ref);
  return abs === runDir3 || abs.startsWith(runDir3 + path29.sep) ? abs : null;
}
function loadJson(absPath) {
  try {
    const parsed = JSON.parse(fs25.readFileSync(absPath, "utf8"));
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
  const runDir3 = path29.resolve(evidence.root, ".guild", "runs", evidence.run_id);
  const refs = Array.isArray(evidence.m0?.inspection_report_refs) ? evidence.m0.inspection_report_refs : [];
  const out = [];
  for (const ref of refs) {
    if (typeof ref !== "string") continue;
    const abs = resolveInRunDir(runDir3, ref);
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
  const runDir3 = path29.resolve(evidence.root, ".guild", "runs", evidence.run_id);
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
    const abs = resolveInRunDir(runDir3, ref);
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
var fs25, path29, ROUTING_FLAG_KEYS, ROUTING_FLAG_DEFAULTS, FLAG_GROUPS;
var init_routing_rollout = __esm({
  "../src/modules/capability/workflows/routing-rollout.ts"() {
    fs25 = __toESM(require("fs"));
    path29 = __toESM(require("path"));
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
function readJson(p) {
  try {
    if (!fs26.existsSync(p)) return null;
    return JSON.parse(fs26.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
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
  const entry = readJson(path30.join(modelCatalogCacheDir(root), key.hash + ".json"));
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
  const p = path30.join(root, ".guild", "settings.json");
  const settings = readJson(p);
  if (settings === null) {
    const { flags: flags2, rejects: rejects2 } = readRoutingFlags(null);
    return { flags: flags2, source: "defaults (no .guild/settings.json)", rejects: rejects2 };
  }
  const { flags, rejects } = readRoutingFlags(settings);
  return { flags, source: ".guild/settings.json", rejects };
}
var fs26, path30, MODELS_COMMAND_USAGE;
var init_models_command = __esm({
  "../src/modules/capability/workflows/models-command.ts"() {
    fs26 = __toESM(require("fs"));
    path30 = __toESM(require("path"));
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
  "../src/modules/capability/workflows/inspection-record.ts"() {
    init_model_inspect();
    init_inspection_persist();
    init_models_command();
    DEFAULT_INSPECTION_LABEL = "dispatch";
  }
});

// ../src/modules/capability/workflows/policy-migration.ts
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
  const settingsPath = path31.join(input.root, ".guild", "settings.json");
  let parsed = {};
  if (fs27.existsSync(settingsPath)) {
    try {
      const raw = JSON.parse(fs27.readFileSync(settingsPath, "utf8"));
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
var fs27, path31, LEGACY_FILLABLE_PURPOSES;
var init_policy_migration = __esm({
  "../src/modules/capability/workflows/policy-migration.ts"() {
    fs27 = __toESM(require("fs"));
    path31 = __toESM(require("path"));
    init_model_policy();
    LEGACY_FILLABLE_PURPOSES = Object.freeze(["general", "implementation"]);
  }
});

// ../src/modules/capability/workflows/purpose-provenance.ts
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
  "../src/modules/capability/workflows/purpose-provenance.ts"() {
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

// ../src/modules/capability/workflows/tier-defaults.ts
function tierDefaults(descriptors = HOST_REGISTRY_ROWS) {
  const result = {};
  for (const [hk, registryId] of Object.entries(HOSTKIND_TO_REGISTRY_ID)) {
    const row = registryId !== null ? descriptors[registryId] : void 0;
    if (!row) {
      result[hk] = { ...CLAUDE_TIER_FALLBACK };
      continue;
    }
    result[hk] = {
      cheap: row.capabilities?.models?.cheap?.model ?? null,
      mid: row.capabilities?.models?.mid?.model ?? null,
      powerful: row.capabilities?.models?.powerful?.model ?? null
    };
  }
  return result;
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
  const result = {};
  for (const tier of tiers) {
    result[tier] = {};
    for (const [hk, registryId] of hostMap) {
      const row = registryId !== null ? descriptors[registryId] : void 0;
      const model = row?.capabilities?.models?.[tier]?.model ?? null;
      result[tier][hk] = model;
    }
  }
  return result;
}
var CLAUDE_TIER_FALLBACK;
var init_tier_defaults = __esm({
  "../src/modules/capability/workflows/tier-defaults.ts"() {
    init_host_runtime();
    init_host_runtime();
    CLAUDE_TIER_FALLBACK = {
      cheap: "haiku",
      mid: "sonnet",
      powerful: "opus"
    };
  }
});

// ../src/modules/capability/workflows/rank.ts
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
  "../src/modules/capability/workflows/rank.ts"() {
    init_host_runtime();
    init_tier_defaults();
    AFFINITY_BOOST = 10;
  }
});

// ../src/modules/capability/workflows/role-model-schema.ts
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
var init_role_resolver = __esm({
  "../src/modules/capability/workflows/role-resolver.ts"() {
    init_host_runtime();
    init_role_model_schema();
    init_review();
  }
});

// ../src/modules/capability/workflows/tiebreak.ts
function hostKindRank(hostKind) {
  return isClaudeHost(hostKind) ? 0 : 1;
}
var init_tiebreak = __esm({
  "../src/modules/capability/workflows/tiebreak.ts"() {
    init_rank();
  }
});

// ../src/modules/capability/workflows/router.ts
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
  "../src/modules/capability/workflows/router.ts"() {
    init_config2();
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

// ../src/modules/capability/index.ts
var capability_exports = {};
__export(capability_exports, {
  AUTHORITATIVE_PURPOSE_SOURCES: () => AUTHORITATIVE_PURPOSE_SOURCES,
  BENIGN_COMPATIBILITY_READ_REASONS: () => BENIGN_COMPATIBILITY_READ_REASONS,
  CACHED_INSPECTION_BUDGET_MS: () => CACHED_INSPECTION_BUDGET_MS,
  CACHE_KEY_COMPONENTS: () => CACHE_KEY_COMPONENTS,
  CAPABILITY_RESOLUTION_INTENTS: () => CAPABILITY_RESOLUTION_INTENTS,
  CLAUDE_TIER_FALLBACK: () => CLAUDE_TIER_FALLBACK,
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
  DEFAULT_CATALOG_TTL_SECONDS: () => DEFAULT_CATALOG_TTL_SECONDS,
  DEFAULT_INSPECTION_LABEL: () => DEFAULT_INSPECTION_LABEL,
  DEPENDENCE_COMPATIBILITY_READ_REASONS: () => DEPENDENCE_COMPATIBILITY_READ_REASONS,
  EVIDENCE_STATES: () => EVIDENCE_STATES,
  FALLBACK_FAILURE_TAXONOMY: () => FALLBACK_FAILURE_TAXONOMY,
  G5_MIN_CLEAN_RELEASES: () => G5_MIN_CLEAN_RELEASES,
  INDEPENDENCE_DIR: () => INDEPENDENCE_DIR,
  INDEPENDENCE_LEVELS: () => INDEPENDENCE_LEVELS,
  LEGACY_FILLABLE_PURPOSES: () => LEGACY_FILLABLE_PURPOSES,
  LEGAL_EVIDENCE_TRANSITIONS: () => LEGAL_EVIDENCE_TRANSITIONS,
  LISTING_AUTHORITY: () => LISTING_AUTHORITY,
  MODEL_CATALOG_CACHE_DIRNAME: () => MODEL_CATALOG_CACHE_DIRNAME,
  MODEL_CATALOG_CACHE_REL: () => MODEL_CATALOG_CACHE_REL,
  MODEL_CATALOG_CACHE_REL_SEGMENTS: () => MODEL_CATALOG_CACHE_REL_SEGMENTS,
  MODEL_CATALOG_SCHEMA_VERSION: () => MODEL_CATALOG_SCHEMA_VERSION,
  MODEL_INSPECTION_SCHEMA: () => MODEL_INSPECTION_SCHEMA,
  MODE_TRANSITION_DIRECTIONS: () => MODE_TRANSITION_DIRECTIONS,
  OPERATOR_BASELINE_POLICY: () => OPERATOR_BASELINE_POLICY,
  POLICY_PURPOSES: () => POLICY_PURPOSES,
  POLICY_TIERS: () => POLICY_TIERS,
  RESOLUTION_STATUSES: () => RESOLUTION_STATUSES,
  RESOLVER_AUTHORITIES: () => RESOLVER_AUTHORITIES,
  RESOLVER_MODE_FAILURES: () => RESOLVER_MODE_FAILURES,
  RESOLVER_MODE_OUTCOME_SCHEMA: () => RESOLVER_MODE_OUTCOME_SCHEMA,
  RESOLVER_MODE_POLICIES: () => RESOLVER_MODE_POLICIES,
  REVIEW_CLASS_PURPOSES: () => REVIEW_CLASS_PURPOSES,
  ROLES: () => ROLES,
  ROLE_STRENGTHS: () => ROLE_STRENGTHS,
  ROUTING_FLAG_DEFAULTS: () => ROUTING_FLAG_DEFAULTS,
  ROUTING_FLAG_KEYS: () => ROUTING_FLAG_KEYS,
  RouteError: () => RouteError,
  SHIPPED_COMPATIBILITY_ASSET_COUNT: () => SHIPPED_COMPATIBILITY_ASSET_COUNT,
  SHIPPED_DOMAIN_SKILL_COUNT: () => SHIPPED_DOMAIN_SKILL_COUNT,
  SHIPPED_TEMPLATE_COUNT: () => SHIPPED_TEMPLATE_COUNT,
  TIER_MAPPING_VERSION: () => TIER_MAPPING_VERSION,
  UNCACHED_DISCOVERY_BUDGET_MS: () => UNCACHED_DISCOVERY_BUDGET_MS,
  UnknownOrgQuarantineViolation: () => UnknownOrgQuarantineViolation,
  adjudicateIndependence: () => adjudicateIndependence,
  advanceChain: () => advanceChain,
  advisorySubstrateFromRoles: () => advisorySubstrateFromRoles,
  affinityBoost: () => affinityBoost,
  appendEvidenceEvent: () => appendEvidenceEvent,
  assertPersistableIndependence: () => assertPersistableIndependence,
  availableRegistryRows: () => availableRegistryRows,
  backendForMode: () => backendForMode,
  buildCompatibilityCatalog: () => buildCompatibilityCatalog,
  buildIndependenceAdjudication: () => buildIndependenceAdjudication,
  buildModelInspection: () => buildModelInspection,
  canonicalYamlFlat: () => canonicalYamlFlat,
  claimPrompt: () => claimPrompt,
  classifyCompatibilityRead: () => classifyCompatibilityRead,
  classifyServedAttempt: () => classifyServedAttempt,
  compatibilityUsageForRead: () => compatibilityUsageForRead,
  confidenceForListing: () => confidenceForListing,
  createCacheKey: () => createCacheKey,
  createRunLocalState: () => createRunLocalState,
  createStore: () => createStore,
  decisionFor: () => decisionFor,
  defaultEvidenceStateForTarget: () => defaultEvidenceStateForTarget,
  defaultTierModels: () => defaultTierModels,
  defaultTiersMap: () => defaultTiersMap,
  dispatchUpgrade: () => dispatchUpgrade,
  eligibleForPurpose: () => eligibleForPurpose,
  evaluateG5: () => evaluateG5,
  evidenceStateForListing: () => evidenceStateForListing,
  expandSelector: () => expandSelector,
  fallbackHash: () => fallbackHash,
  finalizeInterrupted: () => finalizeInterrupted,
  finalizeReceipt: () => finalizeReceipt,
  findBoundAdjudications: () => findBoundAdjudications,
  freezeChain: () => freezeChain,
  freezeSnapshot: () => freezeSnapshot,
  gateM2: () => gateM2,
  getDefaultModelTierMap: () => getDefaultModelTierMap,
  hostKindRank: () => hostKindRank,
  independenceDirForRunDir: () => independenceDirForRunDir,
  invalidateKey: () => invalidateKey,
  isAntigravityCli: () => isAntigravityCli,
  isClaudeCli: () => isClaudeCli,
  isClaudeHost: () => isClaudeHost,
  isCodexCli: () => isCodexCli,
  isCodexHost: () => isCodexHost,
  isCompatibilityUsageV1: () => isCompatibilityUsageV1,
  isDependenceRead: () => isDependenceRead,
  isModelCatalogCachePath: () => isModelCatalogCachePath,
  isPiCli: () => isPiCli,
  isResolverModeFailure: () => isResolverModeFailure,
  isReusableCacheKey: () => isReusableCacheKey,
  isReviewClassPurpose: () => isReviewClassPurpose,
  isRunLocalCacheKey: () => isRunLocalCacheKey,
  isSnapshotStale: () => isSnapshotStale,
  listingAuthorityFor: () => listingAuthorityFor,
  loadVerifiedM0Reports: () => loadVerifiedM0Reports,
  loadWrittenAdjudications: () => loadWrittenAdjudications,
  maxComplexity: () => maxComplexity,
  migrationPreview: () => migrationPreview,
  modelCatalogCacheDir: () => modelCatalogCacheDir,
  nextGeneration: () => nextGeneration,
  normalizeDiscovery: () => normalizeDiscovery,
  parseCompatibilityUsageV1: () => parseCompatibilityUsageV1,
  parseSelector: () => parseSelector,
  persistIndependenceAdjudication: () => persistIndependenceAdjudication,
  persistInspectionReport: () => persistInspectionReport,
  persistResolutionReceipt: () => persistResolutionReceipt,
  planModeTransition: () => planModeTransition,
  planTeamRouting: () => planTeamRouting,
  projectionAllowed: () => projectionAllowed,
  publishSnapshot: () => publishSnapshot,
  purgeRunLocalEntries: () => purgeRunLocalEntries,
  purposeClassFor: () => purposeClassFor,
  purposeComplexityFloor: () => purposeComplexityFloor,
  purposeTierFloor: () => purposeTierFloor,
  rankScore: () => rankScore,
  reachableComplexities: () => reachableComplexities,
  readCatalogEntry: () => readCatalogEntry,
  readRoutingFlags: () => readRoutingFlags,
  readSnapshot: () => readSnapshot,
  readUnderLockTimeout: () => readUnderLockTimeout,
  recordAttempt: () => recordAttempt,
  recordDecision: () => recordDecision,
  recordRunInspectionEvidence: () => recordRunInspectionEvidence,
  requiredAssetIdsForG5: () => requiredAssetIdsForG5,
  resolve: () => resolve11,
  resolveCapability: () => resolveCapability,
  resolveEffectivePurpose: () => resolveEffectivePurpose,
  resolveModel: () => resolveModel,
  resolveModelParams: () => resolveModelParams,
  resolveRoles: () => resolveRoles,
  resolveRolesForRun: () => resolveRolesForRun,
  resolveWithLegacy: () => resolveWithLegacy,
  resolverModePolicy: () => resolverModePolicy,
  resolverModeRank: () => resolverModeRank,
  rollbackV2Routing: () => rollbackV2Routing,
  rollupCompatibilityUsage: () => rollupCompatibilityUsage,
  route: () => route,
  runScopeFor: () => runScopeFor,
  selectRoute: () => selectRoute,
  sha256Hex: () => sha256Hex,
  simulateCatalogChange: () => simulateCatalogChange,
  singleflight: () => singleflight,
  singleflightDiscover: () => singleflightDiscover,
  suggestableAssets: () => suggestableAssets,
  tierDefaults: () => tierDefaults,
  tierDefaultsForHost: () => tierDefaultsForHost,
  tierForCanonicalId: () => tierForCanonicalId,
  tierForComplexity: () => tierForComplexity,
  totalCatalogOrder: () => totalCatalogOrder,
  validateAdjudicationRef: () => validateAdjudicationRef,
  validateIndependenceBinding: () => validateIndependenceBinding,
  validateModelPolicy: () => validateModelPolicy,
  validateRoleResolutionSet: () => validateRoleResolutionSet,
  validateWrittenAdjudication: () => validateWrittenAdjudication,
  verifyResolutionReceipt: () => verifyResolutionReceipt
});
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

// ../src/modules/config/workflows/settings-reader.ts
function validateModelPolicy2(input) {
  const capability2 = (init_capability(), __toCommonJS(capability_exports));
  return capability2.validateModelPolicy(input);
}
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
  const base = DEFAULTS.capability;
  const out = {
    resolver_mode: base.resolver_mode,
    suggestion_budget: base.suggestion_budget,
    starter_roles: [...base.starter_roles],
    auto_create_policy: base.auto_create_policy
  };
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
  const result = Object.assign(/* @__PURE__ */ Object.create(null), base);
  for (const [k, v] of Object.entries(overlay)) {
    if (PROTO_POISON_KEYS.has(k)) continue;
    if (Array.isArray(v)) {
      result[k] = v;
    } else if (isPlainObject5(v) && isPlainObject5(result[k])) {
      result[k] = deepMerge(
        result[k],
        v
      );
    } else {
      result[k] = v;
    }
  }
  return { ...result };
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
  if (!fs28.existsSync(filePath)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs28.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
  return parseSettingsFile_fromParsed(parsed);
}
function parseLocalFile(guildDir) {
  const localPath = path32.join(guildDir, "settings.local.json");
  if (!fs28.existsSync(localPath)) return {};
  let localParsed;
  try {
    localParsed = JSON.parse(fs28.readFileSync(localPath, "utf8"));
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
  else if (isPlainObject5(parsed["model_policy"]) && validateModelPolicy2(parsed["model_policy"]).length === 0)
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
  const resolved = path32.resolve(candidatePath);
  const resolvedBase = path32.resolve(baseDir);
  return resolved.startsWith(resolvedBase + path32.sep);
}
function initiativeIsWorkspaceScoped(workspaceRoot, id) {
  try {
    if (!isValidInitiativeId(id)) return false;
    const registryPath = path32.join(
      workspaceRoot,
      ".guild",
      "indexes",
      "initiatives-registry.yaml"
    );
    if (fs28.existsSync(registryPath)) {
      try {
        const raw = fs28.readFileSync(registryPath, "utf8");
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
    const initiativesBase = path32.join(workspaceRoot, ".guild", "initiatives");
    const activePath = path32.join(
      initiativesBase,
      "active",
      id,
      "initiative.yaml"
    );
    const archivedPath = path32.join(
      initiativesBase,
      "archived",
      id,
      "initiative.yaml"
    );
    const activeBase = path32.join(initiativesBase, "active");
    const archivedBase = path32.join(initiativesBase, "archived");
    if (!isContainedIn(activePath, activeBase) && !isContainedIn(archivedPath, archivedBase)) {
      return false;
    }
    let yamlPath = null;
    if (isContainedIn(activePath, activeBase) && fs28.existsSync(activePath)) {
      yamlPath = activePath;
    } else if (isContainedIn(archivedPath, archivedBase) && fs28.existsSync(archivedPath)) {
      yamlPath = archivedPath;
    }
    if (yamlPath !== null) {
      try {
        const raw = fs28.readFileSync(yamlPath, "utf8");
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
function resolveSettings2(opts) {
  const { cwd, flags = {} } = opts;
  const ws = discoverWorkspace(cwd);
  const sources = {};
  for (const key of Object.keys(DEFAULTS2)) {
    sources[key] = "builtin";
  }
  sources["workspace.mode"] = "builtin";
  let wsSettings = {};
  let wsLocalSettings = {};
  if (ws !== null) {
    const wsGuildDir = path32.join(ws.rootDir, ".guild");
    const rawWsSettings = parseSettingsFile(path32.join(wsGuildDir, "settings.json"));
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
    for (const key of Object.keys(wsSettings)) {
      if (key !== "workspace") sources[key] = "workspace";
    }
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
      for (const key of Object.keys(wsLocalSettings)) {
        if (key !== "workspace") sources[key] = "workspace-local";
      }
    } catch {
    }
  }
  const projectGuildDir = path32.join(cwd, ".guild");
  const projectSettings = parseSettingsFile(path32.join(projectGuildDir, "settings.json"));
  for (const key of Object.keys(projectSettings)) {
    if (key === "workspace") {
      sources["workspace.mode"] = "project";
    } else {
      sources[key] = "project";
    }
  }
  let projectLocalSettings = {};
  try {
    projectLocalSettings = parseLocalFile(projectGuildDir);
    for (const key of Object.keys(projectLocalSettings)) {
      if (key === "workspace") {
        sources["workspace.mode"] = "project-local";
      } else {
        sources[key] = "project-local";
      }
    }
  } catch {
  }
  for (const key of Object.keys(flags)) {
    if (flags[key] !== void 0) {
      if (key === "workspace") {
        sources["workspace.mode"] = "cli";
      }
      sources[key] = "cli";
    }
  }
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
  }
  return { config: assembled, sources };
}
var fs28, path32, yaml, HOST_MODES, DEFAULTS2, VALID_TIER_HOST_KEYS, KNOWN_HOST_IDS2, VALID_LOOPS, VALID_RIGOR, VALID_REVIEW, DISPATCH_HOST_IDS, VALID_AGENT_MODE, VALID_CACHE_TTL, DEFAULTS_ALLOWED_KEYS, RESOLVER_TIER1_KEYS, VALID_CAPABILITY_KEYS;
var init_settings_reader = __esm({
  "../src/modules/config/workflows/settings-reader.ts"() {
    fs28 = __toESM(require("fs"));
    path32 = __toESM(require("path"));
    init_host_runtime();
    init_host_runtime();
    init_host_runtime();
    init_security();
    init_config_defaults();
    init_kernel();
    init_workspace_manifest();
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
      "lifecycle_gate"
      // rf-wi-01 (G1)
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

// ../src/modules/config/workflows/settings-resolver.ts
var settings_resolver_exports = {};
__export(settings_resolver_exports, {
  RESOLVER_TIER1_KEYS: () => RESOLVER_TIER1_KEYS,
  deepMerge: () => deepMerge,
  initiativeIsWorkspaceScoped: () => initiativeIsWorkspaceScoped,
  isPlainObject: () => isPlainObject5,
  resolveSettings: () => resolveSettings,
  rigorProfile: () => rigorProfile
});
function resolveSettings(opts) {
  const t0 = Date.now();
  const result = resolveSettings2(opts);
  try {
    const { cwd, flags = {} } = opts;
    const assembled = result.config;
    const _traceRunId = process.env["GUILD_RUN_ID"] ?? "";
    const _traceRunDir = _traceRunId && cwd ? path33.join(cwd, ".guild", "runs", _traceRunId) : void 0;
    if (_traceRunDir) {
      const _fingerprint = crypto7.createHash("sha256").update(JSON.stringify(assembled)).digest("hex").slice(0, 16);
      const sources = result.sources;
      emitTraceEvent(
        makeConfigResolutionEvent({
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
  return result;
}
var path33, crypto7;
var init_settings_resolver = __esm({
  "../src/modules/config/workflows/settings-resolver.ts"() {
    path33 = __toESM(require("path"));
    crypto7 = __toESM(require("crypto"));
    init_settings_reader();
    init_settings_reader();
    init_telemetry();
    init_telemetry();
  }
});

// ../src/modules/config/workflows/tier-model.ts
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
function runDir2(root, runId) {
  return path34.join(root, ".guild", "runs", runId);
}
function runYamlPath(root, runId) {
  return path34.join(runDir2(root, runId), "run.yaml");
}
function provenancePath(root, runId) {
  return path34.join(runDir2(root, runId), "provenance.json");
}
function logsDir(root, runId) {
  return path34.join(runDir2(root, runId), "logs");
}
function resolvedSettingsPath(root, runId) {
  return path34.join(runDir2(root, runId), "resolved-settings.json");
}
function sentinelPath(root) {
  return path34.join(root, ".guild", "runs", "current-run-id");
}
function logRefFor(runId) {
  return `.guild/runs/${runId}/logs/v1.4-events.jsonl`;
}
function utcCompact(nowIso) {
  const d = new Date(nowIso);
  const iso = Number.isNaN(d.getTime()) ? nowIso : d.toISOString();
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
  const digits = iso.replace(/\D/g, "");
  return `${digits.slice(0, 8)}-${digits.slice(8, 14)}`;
}
function makeRunId(initiative, nowIso) {
  if (initiative) return `run-${initiative}-${utcCompact(nowIso)}`;
  return `run-${crypto8.randomUUID()}`;
}
function yamlScalar2(v) {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (v === "") return '""';
  if (/^[\w./:@+-]+$/.test(v) && !/^\d{4}-\d{2}/.test(v)) return v;
  if (/^[^\s#:][^#]*$/.test(v) && !v.includes(": ") && !/[:#]$/.test(v)) return v;
  return JSON.stringify(v);
}
function serializeRunYaml(rec) {
  const lines = [];
  const emit = (obj, indent) => {
    const pad = "  ".repeat(indent);
    for (const [k, val] of Object.entries(obj)) {
      if (val === void 0) continue;
      if (Array.isArray(val)) {
        if (val.length === 0) {
          lines.push(`${pad}${k}: []`);
        } else if (val.every((x) => typeof x !== "object" || x === null)) {
          lines.push(`${pad}${k}: [${val.map((x) => yamlScalar2(x)).join(", ")}]`);
        } else {
          lines.push(`${pad}${k}:`);
          for (const item of val) {
            if (item && typeof item === "object") {
              const entries = Object.entries(item);
              entries.forEach(([ik, iv], i) => {
                const prefix = i === 0 ? `${pad}  - ` : `${pad}    `;
                lines.push(`${prefix}${ik}: ${yamlScalar2(iv)}`);
              });
            } else {
              lines.push(`${pad}  - ${yamlScalar2(item)}`);
            }
          }
        }
      } else if (val && typeof val === "object") {
        const entries = Object.entries(val);
        if (entries.length === 0) {
          lines.push(`${pad}${k}: {}`);
        } else {
          lines.push(`${pad}${k}:`);
          emit(val, indent + 1);
        }
      } else {
        lines.push(`${pad}${k}: ${yamlScalar2(val)}`);
      }
    }
  };
  emit(rec, 0);
  return lines.join("\n") + "\n";
}
function buildRunManifest(opts, runId, env) {
  const host = env.resolveHost(opts.host_requested);
  const runClass = opts.run_class ?? "full";
  const workspace = {
    is_workspace: opts.workspace.is_workspace,
    root: opts.workspace.root
  };
  if (opts.workspace.sub_guilds && opts.workspace.sub_guilds.length > 0) {
    workspace["sub_guilds"] = opts.workspace.sub_guilds;
  }
  const hostBlock = {
    requested: host.requested,
    resolved: host.resolved
  };
  if (host.capabilities_ref) hostBlock["capabilities_ref"] = host.capabilities_ref;
  const phase = opts.phase ?? null;
  const manifest = {
    schema_version: "guild.run.v1",
    run_id: runId,
    command: opts.command,
    arguments: opts.arguments,
    cwd: opts.cwd,
    target_kind: opts.target_kind,
    workspace,
    project: opts.project,
    host: hostBlock,
    model_tier_policy: opts.model_tier_policy,
    started_at: env.now(),
    ignore_policy: opts.ignore_policy,
    scan_policy: opts.scan_policy,
    initiative_attachment: opts.initiative,
    // NN#5: scalar record ONLY
    phase,
    run_class: runClass,
    gates: {},
    status: "open",
    phases_log: phase ? [{ phase, at: env.now() }] : []
  };
  if (opts.snapshot) {
    manifest["settings_ref"] = {
      path: "resolved-settings.json",
      schema_version: opts.snapshot.schema_version,
      effective_backend: opts.snapshot.effective.agent_mode,
      review: opts.snapshot.effective.review,
      recommended_provider: opts.snapshot.providers.recommended
    };
  }
  return manifest;
}
function emptyTouched() {
  return { tasks: [], agents: [], skills: [], decisions: [], features: [], files: [], runs: [] };
}
function mergeTouched(supplied) {
  const base = emptyTouched();
  if (!supplied) return base;
  for (const k of Object.keys(base)) {
    const v = supplied[k];
    if (Array.isArray(v)) base[k] = v;
  }
  return base;
}
function readStartFacts(env, root, runId) {
  const raw = env.fs.readFile(runYamlPath(root, runId));
  if (raw === null) {
    throw new Error(
      `[run-lifecycle] closeRun("${runId}"): no run.yaml at ${runYamlPath(root, runId)} \u2014 cannot close a run that was never started.`
    );
  }
  const doc = parseYaml(raw);
  const obj = doc !== null && typeof doc === "object" && !Array.isArray(doc) ? doc : {};
  const get = (key) => {
    const v = obj[key];
    return v === void 0 || v === null ? null : String(v);
  };
  const command = get("command") ?? "";
  const initRaw = get("initiative_attachment");
  const initiative = initRaw === null || initRaw === "null" || initRaw === "" ? null : initRaw;
  const runClassRaw = get("run_class");
  const run_class = runClassRaw === "lightweight" ? "lightweight" : "full";
  const started_at = get("started_at") ?? "";
  const self_build = obj["self_build"] === true;
  return { command, initiative, run_class, started_at, self_build };
}
function flipRunStatus(env, root, runId, status) {
  const p = runYamlPath(root, runId);
  const raw = env.fs.readFile(p);
  if (raw === null) return;
  const next = replaceTopLevelLine(raw, "status", `status: ${status}`).text;
  env.fs.writeFile(p, next);
}
function isCanonicalPhase(p) {
  return CANONICAL_PHASES.includes(p);
}
function appendPhase(env, root, runId, phase) {
  if (!isCanonicalPhase(phase)) return false;
  const p = runYamlPath(root, runId);
  const raw = env.fs.readFile(p);
  if (raw === null) return false;
  const at = env.now();
  let next = replaceTopLevelLine(raw, "phase", `phase: ${phase}`).text;
  next = appendToPhasesLog(next, phase, at);
  env.fs.writeFile(p, next);
  return true;
}
function appendToPhasesLog(raw, phase, at) {
  const lines = raw.split("\n");
  const itemLines = [`  - phase: ${phase}`, `    at: ${at}`];
  const idx = lines.findIndex((l) => l.startsWith("phases_log:"));
  if (idx === -1) {
    const insertAt = lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
    lines.splice(insertAt, 0, "phases_log:", ...itemLines);
    return lines.join("\n");
  }
  if (lines[idx].slice("phases_log:".length).trim() === "[]") {
    lines.splice(idx, 1, "phases_log:", ...itemLines);
    return lines.join("\n");
  }
  let end = idx + 1;
  while (end < lines.length && /^\s/.test(lines[end]) && lines[end].trim() !== "") {
    end++;
  }
  lines.splice(end, 0, ...itemLines);
  return lines.join("\n");
}
function createRunLifecycle(env) {
  return {
    startRun(opts) {
      const runId = makeRunId(opts.initiative, env.now());
      const root = opts.root;
      const binding = mintRunBinding({ root, run_id: runId, fs: env.fs });
      env.fs.mkdirp(logsDir(root, runId));
      if (opts.snapshot) {
        writeResolvedSettingsSnapshot(runId, opts.snapshot, {
          cwd: root,
          fs: env.fs,
          // Use the run-id as the resolved_at_ref (deterministic, no Date.now).
          resolvedAtRef: runId
        });
      }
      const manifest = buildRunManifest(opts, runId, env);
      env.fs.writeFile(runYamlPath(root, runId), serializeRunYaml(manifest));
      const identity = opts.session_identity ?? {};
      writeSessionContext(
        root,
        buildSessionContext({
          run_id: runId,
          started_at: env.now(),
          envelope_host: identity.envelope_host,
          env: identity.env,
          native_adapter: identity.native_adapter,
          handshake: identity.handshake,
          execution_target: identity.execution_target,
          active_model: identity.active_model,
          run_binding: { binding_ref: binding.binding_ref, state: binding.state }
        }),
        env.fs
      );
      env.fs.writeFile(sentinelPath(root), runId);
      return runId;
    },
    closeRun(runId, opts) {
      const root = resolveCloseRoot(env);
      assertWritableBinding({ root, run_id: runId, binding_ref: opts.binding_ref, fs: env.fs });
      const facts = readStartFacts(env, root, runId);
      const runClass = facts.run_class;
      const now = env.now();
      const finalCheckpoint = runClass === "lightweight" ? null : opts.final_learning_checkpoint ?? null;
      const terminalTraceEvent = {
        event_id: `evt-${crypto8.randomUUID()}`,
        event_name: "run_closed",
        at: now,
        log_ref: logRefFor(runId)
      };
      const provenance = {
        schema_version: "guild.provenance.v1",
        run_id: runId,
        command: facts.command,
        initiative: facts.initiative,
        retention_class: facts.initiative ? "until-archive" : "one-off-90d",
        started_at: facts.started_at,
        closed_at: now,
        status: opts.status,
        run_class: runClass,
        terminal_trace_event: terminalTraceEvent,
        final_learning_checkpoint: finalCheckpoint,
        gates: opts.gates ?? {},
        touched: mergeTouched(opts.touched),
        artifacts: opts.artifacts ?? {},
        benchmark_eligible: opts.status === "closed"
      };
      if (opts.coverage) provenance.coverage = opts.coverage;
      const provPath = provenancePath(root, runId);
      const provenanceContent = JSON.stringify(provenance, null, 2) + "\n";
      if (env.fs.scrubbedWriteDurable) {
        const runDir3 = path34.join(root, ".guild", "runs", runId);
        const result = env.fs.scrubbedWriteDurable(provPath, provenanceContent, "provenance", runDir3, runId);
        if (result.blocked) {
          process.stderr.write(
            `[run-lifecycle] WARN: provenance.json write BLOCKED by secret scrub (fail-CLOSED) for run ${runId}. Security event emitted.
`
          );
        }
      } else {
        env.fs.writeFile(provPath, provenanceContent);
      }
      flipRunStatus(env, root, runId, opts.status);
      closeRunBinding({ root, run_id: runId, fs: env.fs });
      const sp = sentinelPath(root);
      const currentSentinel = env.fs.readFile(sp);
      if (currentSentinel !== null && currentSentinel.trim() === runId) {
        env.fs.writeFile(sp, "");
      }
    }
  };
}
function resolveCloseRoot(env) {
  const hint = env.__rootHint;
  if (hint) return hint;
  return resolveGuildRoot2(process.cwd());
}
function createRealEnv(root, resolveHost) {
  const env = {
    now: () => (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    fs: {
      mkdirp(absPath) {
        fsNode.mkdirSync(absPath, { recursive: true });
      },
      writeFile(absPath, contents) {
        fsNode.mkdirSync(path34.dirname(absPath), { recursive: true });
        fsNode.writeFileSync(absPath, contents, "utf8");
      },
      readFile(absPath) {
        try {
          return fsNode.readFileSync(absPath, "utf8");
        } catch {
          return null;
        }
      },
      exists(absPath) {
        return fsNode.existsSync(absPath);
      },
      // HK-06: real scrubbedWrite wired for provenance.json (fail-CLOSED).
      scrubbedWriteDurable(outPath, contents, surface, runDir3, runId) {
        return scrubbedWrite(outPath, contents, { surface, runDir: runDir3, runId });
      }
    },
    resolveHost,
    __rootHint: root
  };
  return env;
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
      `[run-lifecycle] ${label}: resolved path "${path34.resolve(target)}" escapes the project root "${path34.resolve(cwd)}" [${r.code}] \u2014 ${r.detail}`
    );
  }
  const runsBase = path34.resolve(cwd, ".guild", "runs");
  const resolvedTarget = path34.resolve(target);
  if (resolvedTarget === runsBase || !isWithin(resolvedTarget, runsBase)) {
    throw new Error(
      `[run-lifecycle] ${label}: resolved path "${resolvedTarget}" is not a strict subdirectory of the runs base "${runsBase}"`
    );
  }
}
function realProvenanceFsSeam() {
  return {
    writeFile(absPath, contents) {
      fsNode.mkdirSync(path34.dirname(absPath), { recursive: true });
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
    scrubbedWriteDurable(outPath, contents, surface, runDir3, runId) {
      return scrubbedWrite(outPath, contents, { surface, runDir: runDir3, runId });
    }
  };
}
function writeResolvedSettingsSnapshot(runId, snapshot, opts) {
  if (!validateRunId(runId)) {
    throw new Error(
      `[run-lifecycle] writeResolvedSettingsSnapshot: invalid runId ${JSON.stringify(runId)} \u2014 must be a non-empty single path component with no separators, no "..", not ".", not absolute`
    );
  }
  const { cwd, fs: fsSeam, resolvedAtRef } = opts;
  const fs32 = fsSeam ?? realProvenanceFsSeam();
  const outPath = resolvedSettingsPath(cwd, runId);
  const runsBase = path34.resolve(cwd, ".guild", "runs");
  assertContained(outPath, cwd, "writeResolvedSettingsSnapshot");
  const onDisk = {
    ...snapshot,
    resolved_at_ref: resolvedAtRef ?? runId
  };
  const serialized = JSON.stringify(onDisk, null, 2) + "\n";
  if (fs32.scrubbedWriteDurable) {
    const runDir3 = path34.join(cwd, ".guild", "runs", runId);
    const result = fs32.scrubbedWriteDurable(outPath, serialized, "config", runDir3, runId);
    if (result.blocked) {
      process.stderr.write(
        `[run-lifecycle] WARN: resolved-settings.json write BLOCKED by secret scrub (fail-CLOSED) for run ${runId}. Security event emitted.
`
      );
    }
  } else {
    fs32.writeFile(outPath, serialized);
  }
  return outPath;
}
function readResolvedSettingsSnapshot(runId, opts) {
  if (!validateRunId(runId)) return null;
  const { cwd, fs: fsSeam } = opts;
  const fs32 = fsSeam ?? realProvenanceFsSeam();
  const filePath = resolvedSettingsPath(cwd, runId);
  const runsBase = path34.resolve(cwd, ".guild", "runs");
  try {
    assertContained(filePath, cwd, "readResolvedSettingsSnapshot");
  } catch {
    return null;
  }
  const raw = fs32.readFile(filePath);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function readWorkspaceKnowledgeConfig(root) {
  let parsed = {};
  try {
    const raw = fsNode.readFileSync(path34.join(root, ".guild", "workspace.json"), "utf8");
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") parsed = obj;
  } catch {
    return { ...WORKSPACE_KNOWLEDGE_DEFAULTS };
  }
  const rootWiki = typeof parsed["root_wiki"] === "boolean" ? parsed["root_wiki"] : WORKSPACE_KNOWLEDGE_DEFAULTS.root_wiki;
  const wsKnowledge = typeof parsed["workspace_knowledge"] === "boolean" ? parsed["workspace_knowledge"] : WORKSPACE_KNOWLEDGE_DEFAULTS.workspace_knowledge;
  const fanoutRaw = parsed["learn_fanout"];
  const learnFanout = fanoutRaw === "auto" || fanoutRaw === "plan-only" ? fanoutRaw : WORKSPACE_KNOWLEDGE_DEFAULTS.learn_fanout;
  return { root_wiki: rootWiki, workspace_knowledge: wsKnowledge, learn_fanout: learnFanout };
}
function readRecordStatusRuns(root) {
  try {
    const { config } = resolveSettings({ cwd: root });
    return config.record_status_runs;
  } catch {
    return true;
  }
}
function writeGateBlock(raw, gate, rec) {
  const lines = raw.split("\n");
  const idx = lines.findIndex((l) => l.startsWith("gates:"));
  if (idx === -1) return null;
  const entryLines = [
    `    posture: ${yamlScalar2(rec.posture)}`,
    `    outcome: ${yamlScalar2(rec.outcome)}`,
    `    codex_review: ${yamlScalar2(rec.codex_review)}`
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
function appendGateOutcome(fs32, root, runId, gate, record) {
  if (!GATE_TOKEN.test(gate)) return false;
  const p = runYamlPath(root, runId);
  const raw = fs32.readFile(p);
  if (raw === null) return false;
  const next = writeGateBlock(raw, gate, record);
  if (next === null) return false;
  fs32.writeFile(p, next);
  return true;
}
function readRunStartedAt(runDir3, readFile = (p) => {
  try {
    return fsNode.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}) {
  const p = path34.join(runDir3, "run.yaml");
  const raw = readFile(p);
  if (raw === null) return null;
  const doc = parseYaml(raw);
  const obj = doc !== null && typeof doc === "object" && !Array.isArray(doc) ? doc : {};
  const v = obj["started_at"];
  if (v === void 0 || v === null) return null;
  return String(v).trim() || null;
}
var crypto8, fsNode, path34, CANONICAL_PHASES, WORKSPACE_KNOWLEDGE_DEFAULTS, GATE_TOKEN;
var init_run_lifecycle = __esm({
  "../src/modules/lifecycle/workflows/run-lifecycle.ts"() {
    crypto8 = __toESM(require("crypto"));
    fsNode = __toESM(require("fs"));
    path34 = __toESM(require("path"));
    init_kernel();
    init_host_runtime();
    init_config2();
    init_state();
    init_run_binding();
    init_security();
    CANONICAL_PHASES = Object.freeze(["init", "ideate", "plan", "build", "qa", "ops"]);
    WORKSPACE_KNOWLEDGE_DEFAULTS = {
      root_wiki: false,
      workspace_knowledge: true,
      learn_fanout: "auto"
    };
    GATE_TOKEN = /^[a-z][a-z0-9-]{0,63}$/;
  }
});

// lifecycle-gate.ts
var lifecycle_gate_exports = {};
__export(lifecycle_gate_exports, {
  buildBlockEnvelope: () => buildBlockEnvelope,
  main: () => main2
});
module.exports = __toCommonJS(lifecycle_gate_exports);

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

// ../scripts/lib/run-lifecycle.ts
init_run_lifecycle();

// ../scripts/lib/runstart-preflight.ts
init_runstart_preflight();

// ../scripts/lib/run-binding.ts
init_run_binding();

// emit-learning-checkpoint.ts
var fs29 = __toESM(require("fs"));
var path35 = __toESM(require("path"));

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
  const indexDir = path35.join(guildRoot, ".guild", "indexes");
  const indexPath = path35.join(indexDir, "knowledge-links.json");
  let existing = [];
  if (fs29.existsSync(indexPath)) {
    try {
      const raw = fs29.readFileSync(indexPath, "utf8");
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
    fs29.mkdirSync(indexDir, { recursive: true });
    fs29.writeFileSync(
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
  const reflectionsDir = path35.join(guildRoot, ".guild", "reflections");
  fs29.mkdirSync(reflectionsDir, { recursive: true });
  const reflPath = path35.join(reflectionsDir, `${runId}.md`);
  const entry = `
## Phase: ${phase} (${runId})

` + nonNone.map((k) => `- ${k}: ${decisions[k]}`).join("\n") + "\n";
  fs29.appendFileSync(reflPath, entry, "utf8");
}
function writeCheckpoint(opts) {
  assertPhase(opts.phase);
  const links = opts.knowledgeLinksBatch ?? [];
  assertEdgeTypes(links);
  assertNodePrefixes(links);
  const guildRoot = opts.guildRoot ?? process.cwd();
  const decisions = opts.decisions ?? { ...ALL_NONE_DECISIONS };
  const learningDir = path35.join(guildRoot, ".guild", "runs", opts.runId, "learning");
  fs29.mkdirSync(learningDir, { recursive: true });
  const checkpointFile = path35.join(learningDir, `${opts.phase}-${opts.runId}.yaml`);
  const reflectionsRelPath = `.guild/reflections/${opts.runId}.md`;
  const reflectionsAbsPath = path35.join(guildRoot, ".guild", "reflections", `${opts.runId}.md`);
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
  fs29.writeFileSync(checkpointFile, yaml3, "utf8");
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
      const raw = fs29.readFileSync(verdictPath, "utf8");
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
      const rawArtifacts = fs29.readFileSync(artifactsJsonPath, "utf8");
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
      const raw = fs29.readFileSync(linksPath, "utf8");
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

// lib/run-state.ts
init_run_state();

// lib/heartbeat.ts
var DEFAULT_HEARTBEAT_TIMEOUT_MS2 = 10 * 60 * 1e3;

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

// lib/run-trace.ts
function resolveRunIdForTrace(_root, env) {
  const fromEnv = env.GUILD_RUN_ID;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  return null;
}

// lib/lifecycle-gate.ts
var fs31 = __toESM(require("node:fs"));
var path37 = __toESM(require("node:path"));

// lib/v1.4/v1.4-lock.ts
init_stable_lock();

// lib/v1.4/log-jsonl.ts
init_event_log();

// lib/reanchor.ts
var fs30 = __toESM(require("node:fs"));
init_sealed_collections();
var path36 = __toESM(require("node:path"));
var yaml2 = __toESM(require_js_yaml());
var SAFE_IDENT = /^[A-Za-z0-9._-]{1,120}$/;
function safeIdent(value) {
  if (value === null) return null;
  return SAFE_IDENT.test(value) ? value : null;
}
function safePhase(value) {
  return safeIdent(value);
}
var PASSED_GATE_OUTCOMES = /* @__PURE__ */ new Set(["pass", "passed", "success", "succeeded"]);
function isPassedGateRecord(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return false;
  const outcome = record["outcome"];
  if (typeof outcome !== "string") return false;
  return PASSED_GATE_OUTCOMES.has(outcome.trim().toLowerCase());
}
var REANCHOR_SESSION_SOURCES = sealSet(["compact", "resume"], "REANCHOR_SESSION_SOURCES");
function readRunYamlFacts(guildRoot, runId) {
  const runYamlPath2 = path36.join(guildRoot, ".guild", "runs", runId, "run.yaml");
  let raw;
  try {
    raw = fs30.readFileSync(runYamlPath2, "utf8");
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
  const str3 = (v) => typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  let settingsRefBackend = null;
  const sref = obj["settings_ref"];
  if (sref !== null && typeof sref === "object" && !Array.isArray(sref)) {
    settingsRefBackend = str3(sref["effective_backend"]);
  }
  const passedGates = /* @__PURE__ */ new Set();
  const gates = obj["gates"];
  if (gates !== null && typeof gates === "object" && !Array.isArray(gates)) {
    for (const [key, record] of Object.entries(gates)) {
      if (isPassedGateRecord(record)) passedGates.add(key);
    }
  }
  return {
    runId: str3(obj["run_id"]),
    status: str3(obj["status"]),
    phase: str3(obj["phase"]),
    initiative: str3(obj["initiative_attachment"]),
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
  const dir = path36.join(guildRoot, ".guild", "runs", runId);
  const candidates = [
    path36.join(dir, "run.yaml"),
    path36.join(dir, "events.ndjson"),
    path36.join(dir, "provenance.json")
  ];
  for (const sub of ["logs", "handoffs", "in-progress"]) {
    try {
      for (const name of fs30.readdirSync(path36.join(dir, sub))) {
        candidates.push(path36.join(dir, sub, name));
      }
    } catch {
    }
  }
  let newest = 0;
  for (const p of candidates) {
    try {
      newest = Math.max(newest, fs30.statSync(p).mtimeMs);
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
function buildAdditionalContextEnvelope(hookEventName, header, newCustomInstructions) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName,
      additionalContext: header,
      ...newCustomInstructions !== void 0 ? { newCustomInstructions } : {}
    }
  });
}

// lib/lane-attribution.ts
function isWorkerInvocation(env = process.env) {
  const laneId2 = env["GUILD_LANE_ID"];
  const taskId = env["GUILD_TASK_ID"];
  return typeof laneId2 === "string" && laneId2.length > 0 || typeof taskId === "string" && taskId.length > 0;
}

// ../scripts/v1.4-log-validator.ts
var import_node_fs3 = require("node:fs");
init_guild_trace_events();
var PHASE_VALUES = Object.freeze([
  "brainstorm",
  "team-compose",
  "plan",
  "context",
  "execute",
  "review",
  "verify",
  "reflect"
]);
var LOOP_LAYER_VALUES = Object.freeze([
  "L1",
  "L2",
  "L3",
  "L4",
  "security-review"
]);
var TOOL_CALL_TOOL_VALUES2 = Object.freeze([
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
var HOOK_EVENT_NAMES2 = Object.freeze([
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
var EVENT_TYPES2 = Object.freeze([
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
]);
var PHASE_END_STATUS = Object.freeze(["ok", "error", "escalated"]);
var LOOP_TERMINATED = Object.freeze([
  "satisfied",
  "malformed_termination",
  "cap_hit",
  "escalation",
  "error"
]);
var TOOL_CALL_STATUS = Object.freeze(["ok", "err", "n/a"]);
var HOOK_STATUS = Object.freeze(["ok", "err"]);
var GATE_DECISION = Object.freeze(["approved", "rejected", "deferred"]);
var GATE_SOURCE = Object.freeze(["user", "auto-approve-mode"]);
var ESCALATION_REASON = Object.freeze([
  "cap_hit",
  "malformed_termination_x2",
  "restart_cap_hit"
]);
var ESCALATION_LABELS = Object.freeze(["force-pass", "extend-cap", "rework"]);
var FIXED_GATES = Object.freeze(["gate-1-spec", "gate-2-team", "gate-3-plan"]);
var ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
var MID_EXEC_DECISION_RE = /^(?:mid-execution-decision):[a-z][a-z0-9-]{0,63}$/;
var G_LANE_RE = /^(?:G-lane):T[0-9]+[a-z]?-[a-z][a-z-]{0,32}$/;
function isString(v) {
  return typeof v === "string";
}
function isInt(v) {
  return typeof v === "number" && Number.isInteger(v) && Number.isFinite(v);
}
function isNonNegInt(v) {
  return isInt(v) && v >= 0;
}
function isPosInt(v) {
  return isInt(v) && v >= 1;
}
function isBool(v) {
  return typeof v === "boolean";
}
function isOneOf(v, values) {
  return typeof v === "string" && values.includes(v);
}
function checkEnvelope(obj, errs, expectedEvent) {
  if (!isString(obj.ts) || !ISO_TS_RE.test(obj.ts)) {
    errs.push(`ts: expected ISO-8601 millisecond UTC timestamp, got ${JSON.stringify(obj.ts)}`);
  }
  if (obj.event !== expectedEvent) {
    errs.push(`event: expected "${expectedEvent}", got ${JSON.stringify(obj.event)}`);
  }
  if (!isString(obj.run_id) || obj.run_id.length === 0) {
    errs.push(`run_id: expected non-empty string`);
  }
}
function checkOptionalString(obj, field, errs) {
  if (field in obj && !isString(obj[field])) {
    errs.push(`${field}: expected string when present, got ${typeof obj[field]}`);
  }
}
function checkRequiredString(obj, field, errs) {
  if (!isString(obj[field]) || obj[field].length === 0) {
    errs.push(`${field}: expected non-empty string`);
  }
}
function checkRequiredEnum(obj, field, values, errs) {
  if (!isOneOf(obj[field], values)) {
    errs.push(
      `${field}: expected one of ${JSON.stringify(values)}, got ${JSON.stringify(obj[field])}`
    );
  }
}
function validatePhaseStart(o, errs) {
  checkEnvelope(o, errs, "phase_start");
  checkRequiredEnum(o, "phase", PHASE_VALUES, errs);
}
function validatePhaseEnd(o, errs) {
  checkEnvelope(o, errs, "phase_end");
  checkRequiredEnum(o, "phase", PHASE_VALUES, errs);
  if (!isNonNegInt(o.duration_ms))
    errs.push(`duration_ms: expected non-negative integer`);
  checkRequiredEnum(o, "status", PHASE_END_STATUS, errs);
}
function validateSpecialistDispatch(o, errs) {
  checkEnvelope(o, errs, "specialist_dispatch");
  checkRequiredString(o, "lane_id", errs);
  checkRequiredString(o, "specialist", errs);
  checkRequiredString(o, "task_id", errs);
  checkRequiredString(o, "prompt_excerpt", errs);
}
function validateSpecialistReceipt(o, errs) {
  checkEnvelope(o, errs, "specialist_receipt");
  checkRequiredString(o, "lane_id", errs);
  checkRequiredString(o, "specialist", errs);
  checkRequiredString(o, "task_id", errs);
  checkRequiredString(o, "receipt_path", errs);
}
function validateLoopRoundStart(o, errs) {
  checkEnvelope(o, errs, "loop_round_start");
  checkRequiredString(o, "lane_id", errs);
  checkRequiredEnum(o, "loop_layer", LOOP_LAYER_VALUES, errs);
  if (!isPosInt(o.round_number)) errs.push(`round_number: expected integer \u2265 1`);
  if (!isPosInt(o.cap) || o.cap > 256)
    errs.push(`cap: expected integer in [1, 256]`);
}
function validateLoopRoundEnd(o, errs) {
  checkEnvelope(o, errs, "loop_round_end");
  checkRequiredString(o, "lane_id", errs);
  checkRequiredEnum(o, "loop_layer", LOOP_LAYER_VALUES, errs);
  if (!isPosInt(o.round_number)) errs.push(`round_number: expected integer \u2265 1`);
  checkRequiredEnum(o, "terminated", LOOP_TERMINATED, errs);
  checkRequiredString(o, "terminator", errs);
}
function validateToolCall(o, errs) {
  checkEnvelope(o, errs, "tool_call");
  checkOptionalString(o, "lane_id", errs);
  checkRequiredEnum(o, "tool", TOOL_CALL_TOOL_VALUES2, errs);
  if (!isString(o.command_redacted))
    errs.push(`command_redacted: expected string (may be empty)`);
  checkRequiredEnum(o, "status", TOOL_CALL_STATUS, errs);
  if (!isNonNegInt(o.latency_ms))
    errs.push(`latency_ms: expected non-negative integer`);
  if (!isString(o.result_excerpt_redacted))
    errs.push(`result_excerpt_redacted: expected string (may be empty)`);
  if ("tokens_in" in o && !isNonNegInt(o.tokens_in))
    errs.push(`tokens_in: when present, expected non-negative integer`);
  if ("tokens_out" in o && !isNonNegInt(o.tokens_out))
    errs.push(`tokens_out: when present, expected non-negative integer`);
}
function validateHookEvent(o, errs) {
  checkEnvelope(o, errs, "hook_event");
  checkOptionalString(o, "lane_id", errs);
  checkRequiredEnum(o, "hook_name", HOOK_EVENT_NAMES2, errs);
  if (!isString(o.payload_excerpt_redacted))
    errs.push(`payload_excerpt_redacted: expected string (may be empty)`);
  if (!isNonNegInt(o.latency_ms))
    errs.push(`latency_ms: expected non-negative integer`);
  checkRequiredEnum(o, "status", HOOK_STATUS, errs);
}
function validateGateDecision(o, errs) {
  checkEnvelope(o, errs, "gate_decision");
  if (!isString(o.gate)) {
    errs.push(`gate: expected string`);
  } else {
    const g = o.gate;
    const ok = FIXED_GATES.includes(g) || MID_EXEC_DECISION_RE.test(g);
    if (!ok)
      errs.push(
        `gate: expected one of ${JSON.stringify(FIXED_GATES)} or "mid-execution-decision:<slug>", got ${JSON.stringify(g)}`
      );
  }
  checkRequiredEnum(o, "decision", GATE_DECISION, errs);
  checkRequiredEnum(o, "source", GATE_SOURCE, errs);
}
function validateAssumptionLogged(o, errs) {
  checkEnvelope(o, errs, "assumption_logged");
  checkRequiredString(o, "lane_id", errs);
  checkRequiredString(o, "specialist", errs);
  checkRequiredString(o, "assumption_text", errs);
}
function validateEscalation(o, errs) {
  checkEnvelope(o, errs, "escalation");
  checkOptionalString(o, "lane_id", errs);
  checkRequiredEnum(o, "reason", ESCALATION_REASON, errs);
  const off = o.options_offered;
  if (!Array.isArray(off) || off.length !== ESCALATION_LABELS.length || !ESCALATION_LABELS.every((label, i) => off[i] === label)) {
    errs.push(
      `options_offered: expected exactly ${JSON.stringify(ESCALATION_LABELS)}`
    );
  }
  checkRequiredEnum(o, "user_choice", ESCALATION_LABELS, errs);
}
function validateCodexReviewRound(o, errs) {
  checkEnvelope(o, errs, "codex_review_round");
  if (!isString(o.gate)) {
    errs.push(`gate: expected string`);
  } else {
    const g = o.gate;
    const ok = g === "G-spec" || g === "G-plan" || g === "G-diagnose" || G_LANE_RE.test(g);
    if (!ok)
      errs.push(
        `gate: expected "G-spec" | "G-plan" | "G-diagnose" | "G-lane:<lane-id>", got ${JSON.stringify(g)}`
      );
  }
  if (!isPosInt(o.round_number) || o.round_number > 5)
    errs.push(`round_number: expected integer in [1, 5] (Codex cap = 5)`);
  if (!isBool(o.terminated_by_satisfied))
    errs.push(`terminated_by_satisfied: expected boolean`);
}
function isTraceTokens(v) {
  if (typeof v !== "object" || v === null) return false;
  const t = v;
  for (const k of ["input", "output", "cached", "cost_usd"]) {
    if (k in t && typeof t[k] !== "number") return false;
  }
  return true;
}
function validateHookMirrorEvent(o, errs) {
  if (!isString(o.ts) || !ISO_TS_RE.test(o.ts)) {
    errs.push(`ts: expected ISO-8601 millisecond UTC timestamp, got ${JSON.stringify(o.ts)}`);
  }
  if (!isString(o.tool)) errs.push(`tool: expected string (may be empty)`);
  if (!isString(o.specialist)) errs.push(`specialist: expected string (may be empty)`);
  if (!isString(o.payload_digest)) errs.push(`payload_digest: expected string`);
  if (!isBool(o.ok)) errs.push(`ok: expected boolean`);
  if (!isNonNegInt(o.ms)) errs.push(`ms: expected non-negative integer`);
  checkOptionalString(o, "model", errs);
  checkOptionalString(o, "prompt", errs);
  checkOptionalString(o, "loop_layer", errs);
  checkOptionalString(o, "loop_gate", errs);
  checkOptionalString(o, "span_id", errs);
  checkOptionalString(o, "parent_span_id", errs);
  checkOptionalString(o, "tier", errs);
  checkOptionalString(o, "payload_ref", errs);
  if ("loop_round" in o && !isInt(o.loop_round)) {
    errs.push(`loop_round: expected integer when present`);
  }
  if ("loop_terminated" in o && !isBool(o.loop_terminated)) {
    errs.push(`loop_terminated: expected boolean when present`);
  }
  if ("tokens" in o && !isTraceTokens(o.tokens)) {
    errs.push(`tokens: expected { input?, output?, cached?, cost_usd? } (all numbers) when present`);
  }
}
var VALIDATORS = {
  phase_start: validatePhaseStart,
  phase_end: validatePhaseEnd,
  specialist_dispatch: validateSpecialistDispatch,
  specialist_receipt: validateSpecialistReceipt,
  loop_round_start: validateLoopRoundStart,
  loop_round_end: validateLoopRoundEnd,
  tool_call: validateToolCall,
  hook_event: validateHookEvent,
  gate_decision: validateGateDecision,
  assumption_logged: validateAssumptionLogged,
  escalation: validateEscalation,
  codex_review_round: validateCodexReviewRound
};
function validateEvent(parsed) {
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, errors: ["event must be a JSON object"] };
  }
  const o = parsed;
  if (isString(o.schema_version) && o.schema_version.startsWith("guild.trace.")) {
    const result = validateGuildTraceEvent(o);
    if (result.ok) return { ok: true, errors: [] };
    return { ok: false, errors: [result.reason] };
  }
  if (!isString(o.event)) {
    return { ok: false, errors: ['envelope: "event" field missing or non-string'] };
  }
  const errors = [];
  if (HOOK_EVENT_NAMES2.includes(o.event)) {
    for (const [k, v] of Object.entries(o)) {
      if (v === null) errors.push(`${k}: null is not allowed (omit the field instead)`);
    }
    validateHookMirrorEvent(o, errors);
    return { ok: errors.length === 0, errors };
  }
  if (!EVENT_TYPES2.includes(o.event)) {
    return {
      ok: false,
      errors: [
        `event: unknown value ${JSON.stringify(o.event)}; expected one of ${JSON.stringify(EVENT_TYPES2)}, a guild.trace.*.v1 schema_version, or one of ${JSON.stringify(HOOK_EVENT_NAMES2)}`
      ]
    };
  }
  for (const [k, v] of Object.entries(o)) {
    if (v === null) errors.push(`${k}: null is not allowed (omit the field instead)`);
  }
  const validator = VALIDATORS[o.event];
  if (validator) validator(o, errors);
  return { ok: errors.length === 0, errors };
}
function validateText(text) {
  const lines = text.split("\n");
  const perLine = [];
  let valid = 0;
  let invalid = 0;
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === void 0 || raw.length === 0) continue;
    total += 1;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      invalid += 1;
      perLine.push({
        line: i + 1,
        result: {
          ok: false,
          errors: [`JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`]
        }
      });
      continue;
    }
    const result = validateEvent(parsed);
    if (result.ok) valid += 1;
    else invalid += 1;
    perLine.push({ line: i + 1, result });
  }
  return { total, valid, invalid, perLine };
}
function isMainModule() {
  const arg1 = process.argv[1];
  if (!arg1) return false;
  return /v1\.4-log-validator\.[tj]s$/.test(arg1);
}
function cliMain(argv) {
  const path38 = argv[2];
  if (!path38) {
    process.stderr.write("usage: v1.4-log-validator <jsonl-file>\n");
    return 2;
  }
  if (!(0, import_node_fs3.existsSync)(path38)) {
    process.stderr.write(`error: file not found: ${path38}
`);
    return 2;
  }
  const text = (0, import_node_fs3.readFileSync)(path38, "utf8");
  const summary = validateText(text);
  if (summary.invalid > 0) {
    for (const { line, result } of summary.perLine) {
      if (!result.ok) {
        for (const e of result.errors) {
          process.stderr.write(`${path38}:${line}: ${e}
`);
        }
      }
    }
    process.stderr.write(
      `validator: ${summary.invalid}/${summary.total} lines invalid
`
    );
    return 1;
  }
  process.stdout.write(`validator: ${summary.valid}/${summary.total} lines valid
`);
  return 0;
}
if (isMainModule()) {
  process.exit(cliMain(process.argv));
}

// ../scripts/lib/shared/config-defaults.ts
init_config_defaults();

// lib/lifecycle-gate.ts
var LIFECYCLE_GATE_MARKER = "[GUILD LIFECYCLE GATE]";
var CLOSE_GATE_MARKER = "[GUILD CLOSE GATE]";
var PROMPT_OVERRIDE_TOKEN = "[guild:gate-override]";
var ENV_OVERRIDE_VAR = "GUILD_LIFECYCLE_GATE_OVERRIDE";
var DEFAULT_ADHOC_THRESHOLD = DEFAULTS.defaults.lifecycle_gate.adhoc_activity_threshold;
var DEFAULT_LIFECYCLE_GATE_ENABLED = DEFAULTS.defaults.lifecycle_gate.enabled;
var ADHOC_TOOLS = /* @__PURE__ */ new Set(["Bash", "Edit", "Write", "NotebookEdit"]);
var MUTATING_TOOLS = /* @__PURE__ */ new Set(["Edit", "Write", "NotebookEdit"]);
var BUILD_OR_LATER_PHASES = /* @__PURE__ */ new Set(["build", "qa", "ops"]);
var EXECUTION_PHASES = /* @__PURE__ */ new Set(["execute", "review", "verify", "reflect"]);
var LIFECYCLE_SKILLS = Object.freeze([
  "guild:brainstorm",
  "guild:ideate",
  "guild:team-compose",
  "guild:plan",
  "guild:context-assemble",
  "guild:execute-plan",
  "guild:build",
  "guild:review",
  "guild:verify-done",
  "guild:qa",
  "guild:guild-quality",
  "guild:ops",
  "guild:guild-operations",
  "guild:reflect",
  "guild:resume"
]);
var LIFECYCLE_SKILL_SET = new Set(LIFECYCLE_SKILLS);
var SAFE_TS = /^[0-9TZ:.+-]{1,40}$/;
function safeTs(value) {
  if (value === null) return null;
  return SAFE_TS.test(value) ? value : null;
}
var GATE_STATE_SCHEMA = "guild.lifecycle_gate.v1";
var CLOSE_STATE_SCHEMA = "guild.lifecycle_close.v1";
function readLifecycleGateConfig(guildRoot) {
  try {
    const { resolveSettings: resolveSettings3 } = (init_settings_resolver(), __toCommonJS(settings_resolver_exports));
    const parsed = resolveSettings3({ cwd: guildRoot }).config;
    const g = parsed.defaults?.lifecycle_gate ?? {};
    const enabled = typeof g.enabled === "boolean" ? g.enabled : DEFAULT_LIFECYCLE_GATE_ENABLED;
    const threshold = typeof g.adhoc_activity_threshold === "number" && Number.isInteger(g.adhoc_activity_threshold) && g.adhoc_activity_threshold >= 1 ? g.adhoc_activity_threshold : DEFAULT_ADHOC_THRESHOLD;
    return { enabled, threshold };
  } catch {
    return { enabled: DEFAULT_LIFECYCLE_GATE_ENABLED, threshold: DEFAULT_ADHOC_THRESHOLD };
  }
}
function isOverridden(env = process.env, promptText = null) {
  if (env[ENV_OVERRIDE_VAR] === "1") return true;
  if (typeof promptText === "string" && promptText.length > 0) {
    return promptText.toLowerCase().includes(PROMPT_OVERRIDE_TOKEN);
  }
  return false;
}
function parseInvokedSkill(command) {
  const space = command.indexOf(" ");
  if (space === -1) return null;
  const payload = command.slice(space + 1).trim();
  if (payload.length === 0) return null;
  if (payload.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    for (const key of ["skill", "name", "command"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.length > 0) return value.trim();
    }
    return null;
  }
  return payload;
}
function isLifecycleSkillCall(command) {
  const skill = parseInvokedSkill(command);
  return skill !== null && LIFECYCLE_SKILL_SET.has(skill);
}
function str2(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
async function readTraceEvents(runDir3) {
  return readAllEvents(runDir3, {
    validate: (parsed) => {
      const result = validateEvent(parsed);
      return result.ok ? { ok: true } : { ok: false, reason: result.errors.join("; ") };
    }
  });
}
function isLifecycleTouch(event, runId) {
  if (event.run_id !== runId) return false;
  if (event.event === "specialist_dispatch") return true;
  if (event.event !== "tool_call" || event.tool !== "Skill") return false;
  if (event.lane_id !== void 0) return false;
  if (event.status !== "ok") return false;
  const command = str2(event.command_redacted);
  return command !== null && isLifecycleSkillCall(command);
}
function countAdHocActivityIn(events, runId, nowMs = Date.now()) {
  let anchorIndex = -1;
  let anchorSeq = 0;
  let anchorTs = null;
  let seen = 0;
  for (let i = 0; i < events.length; i++) {
    if (!isLifecycleTouch(events[i], runId)) continue;
    seen++;
    anchorIndex = i;
    anchorSeq = seen;
    anchorTs = str2(events[i].ts);
  }
  let total = 0;
  let mutations = 0;
  let latestTs = null;
  for (let i = anchorIndex + 1; i < events.length; i++) {
    const event = events[i];
    if (event.event !== "tool_call") continue;
    if (event.run_id !== runId) continue;
    if (!ADHOC_TOOLS.has(event.tool)) continue;
    if (event.lane_id !== void 0) continue;
    if (event.status === "err" && event.result_excerpt_redacted === ORPHAN_RESULT_EXCERPT) continue;
    total++;
    if (MUTATING_TOOLS.has(event.tool)) mutations++;
    const ts = str2(event.ts);
    if (ts === null) continue;
    const parsed = Date.parse(ts);
    if (!Number.isFinite(parsed) || parsed > nowMs) continue;
    if (latestTs === null || ts > latestTs) latestTs = ts;
  }
  return { total, mutations, anchorSeq, anchorTs, latestTs };
}
function isPastBuildStart(phase, events, laneCount = 0) {
  if (phase !== null && BUILD_OR_LATER_PHASES.has(phase)) return true;
  if (laneCount > 0) return true;
  for (const event of events) {
    if (event.event === "specialist_dispatch") return true;
    if ((event.event === "phase_start" || event.event === "phase_end") && typeof event.phase === "string" && EXECUTION_PHASES.has(event.phase)) {
      return true;
    }
  }
  return false;
}
var SHELL_ONLY_MULTIPLIER = 3;
function effectiveThreshold(activity, threshold) {
  return activity.mutations >= 1 ? threshold : threshold * SHELL_ONLY_MULTIPLIER;
}
var MAX_CLOSE_FIRES = 3;
function gateStatePath(runDir3) {
  return path37.join(runDir3, "lifecycle-gate-state.json");
}
function closeStatePath(runDir3) {
  return path37.join(runDir3, "lifecycle-close-state.json");
}
function loadGateState(runDir3) {
  try {
    const raw = fs31.readFileSync(gateStatePath(runDir3), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed["schema_version"] !== GATE_STATE_SCHEMA) return null;
    const lastFired = parsed["last_fired_at_count"];
    const anchorSeq = parsed["anchor_seq"];
    if (typeof lastFired !== "number" || !Number.isInteger(lastFired) || lastFired < 0) return null;
    if (typeof anchorSeq !== "number" || !Number.isInteger(anchorSeq) || anchorSeq < 0) return null;
    return {
      schema_version: GATE_STATE_SCHEMA,
      anchor_seq: anchorSeq,
      last_fired_at_count: lastFired,
      pending_correction: parsed["pending_correction"] === true
    };
  } catch {
    return null;
  }
}
function loadCloseState(runDir3) {
  const empty = {
    schema_version: CLOSE_STATE_SCHEMA,
    fired_for: [],
    fire_count: 0
  };
  try {
    const raw = fs31.readFileSync(closeStatePath(runDir3), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed["schema_version"] !== CLOSE_STATE_SCHEMA) return empty;
    const firedFor = parsed["fired_for"];
    if (!Array.isArray(firedFor) || firedFor.some((v) => typeof v !== "string")) return empty;
    const fireCount = parsed["fire_count"];
    return {
      schema_version: CLOSE_STATE_SCHEMA,
      fired_for: [...firedFor].sort(),
      fire_count: typeof fireCount === "number" && Number.isInteger(fireCount) && fireCount >= 0 ? fireCount : 0
    };
  } catch {
    return empty;
  }
}
var GATE_LOCK_TIMEOUT_MS = 1e3;
function withGateLock(runDir3, fn) {
  let entered = false;
  try {
    return withStableLock(
      runDir3,
      () => {
        entered = true;
        return fn();
      },
      { timeoutMs: GATE_LOCK_TIMEOUT_MS }
    );
  } catch (err) {
    if (entered) throw err;
    return fn();
  }
}
function writeJsonAtomic(finalPath, value) {
  fs31.mkdirSync(path37.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs31.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  try {
    fs31.renameSync(tmpPath, finalPath);
  } catch (err) {
    try {
      fs31.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
function writeGateState(runDir3, state) {
  writeJsonAtomic(gateStatePath(runDir3), state);
}
function writeCloseState(runDir3, state) {
  writeJsonAtomic(closeStatePath(runDir3), state);
}
function decideCrossing(count, threshold, anchorSeq, priorState) {
  const sameCycle = priorState !== null && priorState.anchor_seq === anchorSeq;
  const priorCount = sameCycle ? priorState.last_fired_at_count : 0;
  const pending = sameCycle ? priorState.pending_correction : false;
  const effectiveCount = Math.max(count, priorCount);
  const crossed = effectiveCount >= threshold && Math.floor(effectiveCount / threshold) > Math.floor(priorCount / threshold);
  return {
    shouldFire: crossed,
    nextState: {
      schema_version: GATE_STATE_SCHEMA,
      anchor_seq: anchorSeq,
      last_fired_at_count: crossed ? effectiveCount : priorCount,
      pending_correction: pending
    }
  };
}
function renderLifecycleGate(runId, activity, threshold, phase, nextGate) {
  const anchor = safeTs(activity.anchorTs);
  return [
    `${LIFECYCLE_GATE_MARKER} run ${runId} is ACTIVE (phase=${phase ?? "unknown"}) and this session has done ${activity.total} ad-hoc operations (${activity.mutations} Edit/Write, threshold ${effectiveThreshold(activity, threshold)}) without routing anything through a Guild skill.`,
    activity.anchorSeq === 0 ? "- No lifecycle skill has been invoked in this run's trace at all." : `- Last lifecycle touch: ${anchor ?? "unknown"}.`,
    nextGate === null ? "- Re-enter the gated lifecycle with guild:resume, then run /guild:status for the next gate." : `- Re-enter the gated lifecycle with guild:resume. Next pending gate: ${nextGate}.`,
    "- A build run must still pass guild:review + guild:verify-done before it can close.",
    `- Intentional? Re-send this prompt (the gate fires once per crossing), add ${PROMPT_OVERRIDE_TOKEN} to it, or export ${ENV_OVERRIDE_VAR}=1 for the session.`
  ].join("\n");
}
function renderCloseGate(runId, missing, laneCount, malformed = []) {
  const clauses = [];
  if (missing.length > 0) {
    clauses.push(
      `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} missing or empty`
    );
  }
  if (malformed.length > 0) {
    clauses.push(
      `lane receipt(s) ${malformed.join(", ")} carry a missing or malformed guild.handoff.v2 envelope`
    );
  }
  return [
    `${CLOSE_GATE_MARKER} run ${runId} completed all ${laneCount} lane(s) with receipts, but ${clauses.join("; and ")}.`,
    "- A build run must pass guild:review (writes review.md) AND guild:verify-done (writes verify.md) before close.",
    "- Every lane receipt must embed a valid guild.handoff.v2 envelope (status, changed_files, evidence, pr_url, codex).",
    "- Run the missing gate(s) / fix the receipt(s) now, or re-enter via guild:resume \u2014 do not close this run on receipts alone.",
    `- Intentional? Export ${ENV_OVERRIDE_VAR}=1 to dismiss for this session.`
  ].join("\n");
}
var OPEN_LANE_STATUSES = /* @__PURE__ */ new Set(["pending", "in_progress"]);
var COMPLETED_LANE_STATUS = "done";
var KNOWN_LANE_STATUSES = /* @__PURE__ */ new Set([
  "pending",
  "in_progress",
  "done",
  "failed",
  "dead",
  "skipped"
]);
function readValidatedRunState(runDir3, runId) {
  let state;
  try {
    state = loadRunState(runDir3);
  } catch {
    return null;
  }
  if (state === null) return null;
  if (str2(state.run_id) !== runId) return null;
  const lanes = state.lanes;
  if (lanes === null || typeof lanes !== "object" || Array.isArray(lanes)) return null;
  const laneStatuses = [];
  const receiptRefs = [];
  for (const lane of Object.values(lanes)) {
    if (lane === null || typeof lane !== "object" || Array.isArray(lane)) return null;
    const record = lane;
    const status = str2(record["status"]);
    if (status === null || !KNOWN_LANE_STATUSES.has(status)) return null;
    laneStatuses.push(status);
    const ref = record["receipt_ref"];
    if (ref !== null && ref !== void 0 && typeof ref !== "string") return null;
    receiptRefs.push(str2(ref));
  }
  return { laneStatuses, receiptRefs };
}
async function resolveGateContext(guildRoot, runId, env) {
  if (isWorkerInvocation(env)) return null;
  if (!validateRunId(runId)) return null;
  const safeRunId = safeIdent(runId);
  if (safeRunId === null) return null;
  const facts = readRunYamlFacts(guildRoot, safeRunId);
  if (facts === null) return null;
  if (facts.runId !== safeRunId) return null;
  if (!isRunActive(guildRoot, safeRunId, facts.status)) return null;
  const phase = safePhase(facts.phase);
  const runDir3 = env["GUILD_RUN_DIR"] ?? path37.join(guildRoot, ".guild", "runs", safeRunId);
  const runState = readValidatedRunState(runDir3, safeRunId);
  const events = await readTraceEvents(runDir3);
  if (!isPastBuildStart(phase, events, runState?.laneStatuses.length ?? 0)) return null;
  return { runDir: runDir3, safeRunId, phase, passedGates: facts.passedGates, events, runState };
}
var DEFAULT_DRIFT_RECENCY_MS = 30 * 60 * 1e3;
function driftRecencyMs(env) {
  const raw = env["GUILD_LIFECYCLE_GATE_RECENCY_MS"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_DRIFT_RECENCY_MS;
}
function isDriftCurrent(latestTs, env = process.env, nowMs = Date.now()) {
  if (latestTs === null) return false;
  const parsed = Date.parse(latestTs);
  if (!Number.isFinite(parsed)) return false;
  const age = nowMs - parsed;
  return age >= 0 && age <= driftRecencyMs(env);
}
async function evaluateLifecycleGate(guildRoot, runId, promptText, env = process.env) {
  const silent = { block: null, context: null };
  const config = readLifecycleGateConfig(guildRoot);
  if (!config.enabled) return silent;
  const ctx = await resolveGateContext(guildRoot, runId, env);
  if (ctx === null) return silent;
  const activity = countAdHocActivityIn(ctx.events, ctx.safeRunId);
  const threshold = effectiveThreshold(activity, config.threshold);
  const drifting = activity.total >= threshold && isDriftCurrent(activity.latestTs, env);
  const overridden = isOverridden(env, promptText);
  const render = () => renderLifecycleGate(
    ctx.safeRunId,
    activity,
    config.threshold,
    ctx.phase,
    deriveNextGate(ctx.phase, ctx.passedGates)
  );
  return withGateLock(ctx.runDir, () => {
    const priorState = loadGateState(ctx.runDir);
    const decision = decideCrossing(activity.total, threshold, activity.anchorSeq, priorState);
    const pending = decision.nextState.pending_correction;
    if (overridden) {
      if (decision.shouldFire || pending) {
        writeGateState(ctx.runDir, { ...decision.nextState, pending_correction: false });
      }
      return silent;
    }
    if (drifting && decision.shouldFire) {
      writeGateState(ctx.runDir, { ...decision.nextState, pending_correction: true });
      return { block: render(), context: null };
    }
    if (pending) {
      writeGateState(ctx.runDir, { ...decision.nextState, pending_correction: false });
      return { block: null, context: render() };
    }
    return silent;
  });
}
var REQUIRED_RECEIPT_ENVELOPE_KEYS = Object.freeze([
  "status",
  "changed_files",
  "evidence",
  "pr_url",
  "codex"
]);
function validateReceiptEnvelope(content) {
  let block;
  try {
    block = extractHandoffEnvelope(content);
  } catch {
    return { ok: false, reason: "guild.handoff.v2 envelope could not be read" };
  }
  if (block === null) {
    return {
      ok: false,
      reason: "no valid embedded guild.handoff.v2 JSON block (frontmatter-only or unparseable)"
    };
  }
  if (typeof block !== "object" || Array.isArray(block)) {
    return { ok: false, reason: "guild.handoff.v2 envelope is not a JSON object" };
  }
  if (validateHandoffV2(block).valid) return { ok: true, reason: null };
  const obj = block;
  const missing = REQUIRED_RECEIPT_ENVELOPE_KEYS.filter(
    (k) => obj[k] === void 0 || obj[k] === null
  );
  if (missing.length > 0) {
    return { ok: false, reason: `envelope missing required key(s): ${missing.join(", ")}` };
  }
  const typeErrors = [];
  if (typeof obj["status"] !== "string" || obj["status"].trim() === "") {
    typeErrors.push("status must be a non-empty string");
  }
  const stringArray = (v) => Array.isArray(v) && v.every((e) => typeof e === "string");
  if (!stringArray(obj["changed_files"])) typeErrors.push("changed_files must be a string[]");
  if (!stringArray(obj["evidence"])) typeErrors.push("evidence must be a string[]");
  if (typeof obj["pr_url"] !== "string" || obj["pr_url"].trim() === "") {
    typeErrors.push("pr_url must be a non-empty string");
  }
  const codex = obj["codex"];
  if (typeof codex !== "object" || codex === null || Array.isArray(codex)) {
    typeErrors.push("codex must be an object");
  } else {
    const c = codex;
    if (typeof c["verdict"] !== "string" || c["verdict"].trim() === "") {
      typeErrors.push("codex.verdict must be a non-empty string");
    }
    if (typeof c["rounds"] !== "number" || !Number.isFinite(c["rounds"])) {
      typeErrors.push("codex.rounds must be a number");
    }
  }
  if (typeErrors.length > 0) {
    return { ok: false, reason: `envelope shape invalid: ${typeErrors.join("; ")}` };
  }
  return { ok: true, reason: null };
}
function hasContent(filePath) {
  try {
    const st = fs31.lstatSync(filePath);
    if (!st.isFile()) return false;
    if (st.size === 0) return false;
    return fs31.readFileSync(filePath, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}
async function evaluateCloseGate(guildRoot, runId, env = process.env) {
  const silent = { advisory: null };
  const config = readLifecycleGateConfig(guildRoot);
  if (!config.enabled || isOverridden(env)) return silent;
  const ctx = await resolveGateContext(guildRoot, runId, env);
  if (ctx === null || ctx.runState === null) return silent;
  const lanes = ctx.runState.laneStatuses;
  if (lanes.length === 0) return silent;
  if (lanes.some((status) => OPEN_LANE_STATUSES.has(status))) return silent;
  if (!lanes.every((status) => status === COMPLETED_LANE_STATUS)) return silent;
  const handoffsDir = path37.resolve(ctx.runDir, "handoffs");
  const seenReceipts = /* @__PURE__ */ new Set();
  const malformed = [];
  for (const ref of ctx.runState.receiptRefs) {
    if (ref === null) return silent;
    const resolved = path37.resolve(ctx.runDir, ref);
    const rel = path37.relative(handoffsDir, resolved);
    if (rel === "" || rel.startsWith("..") || path37.isAbsolute(rel)) return silent;
    if (!resolved.endsWith(".md")) return silent;
    if (seenReceipts.has(resolved)) return silent;
    seenReceipts.add(resolved);
    let receiptText;
    try {
      const st = fs31.lstatSync(resolved);
      if (!st.isFile()) return silent;
      receiptText = fs31.readFileSync(resolved, "utf8");
    } catch {
      return silent;
    }
    if (!validateReceiptEnvelope(receiptText).ok) malformed.push(path37.basename(resolved));
  }
  malformed.sort();
  const missing = [];
  for (const artifact of ["review.md", "verify.md"]) {
    if (!hasContent(path37.join(ctx.runDir, artifact))) missing.push(artifact);
  }
  missing.sort();
  const problems = [...missing, ...malformed.map((m) => `envelope:${m}`)].sort();
  return withGateLock(ctx.runDir, () => {
    const prior = loadCloseState(ctx.runDir);
    const sameSet = prior.fired_for.length === problems.length && prior.fired_for.every((name, i) => name === problems[i]);
    if (problems.length === 0) {
      if (prior.fired_for.length > 0 || prior.fire_count > 0) {
        writeCloseState(ctx.runDir, {
          schema_version: CLOSE_STATE_SCHEMA,
          fired_for: [],
          fire_count: 0
        });
      }
      return silent;
    }
    if (sameSet || prior.fire_count >= MAX_CLOSE_FIRES) return silent;
    writeCloseState(ctx.runDir, {
      schema_version: CLOSE_STATE_SCHEMA,
      fired_for: problems,
      fire_count: prior.fire_count + 1
    });
    return { advisory: renderCloseGate(ctx.safeRunId, missing, lanes.length, malformed) };
  });
}

// lifecycle-gate.ts
async function readStdin() {
  return new Promise((resolve17) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve17(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve17(""));
  });
}
function buildBlockEnvelope(reason) {
  return JSON.stringify({ decision: "block", reason });
}
async function main2() {
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
  }
  const payloadCwd = typeof payload.cwd === "string" ? payload.cwd : void 0;
  const cwd = process.env["GUILD_CWD"] ?? payloadCwd ?? process.cwd();
  const guildRoot = resolveGuildRoot(cwd);
  const runId = resolveRunIdForTrace(guildRoot, { GUILD_RUN_ID: process.env["GUILD_RUN_ID"] }) ?? locateCandidateRunId(guildRoot)?.run_id ?? null;
  if (!runId) return;
  const isPromptEvent = payload.hook_event_name === "UserPromptSubmit" || payload.hook_event_name === void 0 && typeof payload.prompt === "string";
  try {
    if (isPromptEvent) {
      const promptText = typeof payload.prompt === "string" ? payload.prompt : null;
      const { block, context } = await evaluateLifecycleGate(
        guildRoot,
        runId,
        promptText,
        process.env
      );
      if (block !== null) {
        process.stdout.write(buildBlockEnvelope(block));
        process.stderr.write(block + "\n");
      } else if (context !== null) {
        process.stdout.write(buildAdditionalContextEnvelope("UserPromptSubmit", context));
      }
      return;
    }
    const { advisory } = await evaluateCloseGate(guildRoot, runId, process.env);
    if (advisory !== null) {
      process.stdout.write(buildBlockEnvelope(advisory));
      process.stderr.write(advisory + "\n");
    }
  } catch (err) {
    process.stderr.write(
      `warn: [lifecycle-gate] evaluation failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
if (require.main === module) {
  main2().catch((err) => {
    process.stderr.write(
      `[lifecycle-gate] FATAL: ${err instanceof Error ? err.message : String(err)}
`
    );
    process.exit(0);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildBlockEnvelope,
  main
});
