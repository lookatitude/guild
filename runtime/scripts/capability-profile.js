#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// scripts/capability-profile.ts
var capability_profile_exports = {};
__export(capability_profile_exports, {
  layoutRow: () => layoutRow,
  renderLayoutRow: () => renderLayoutRow
});
module.exports = __toCommonJS(capability_profile_exports);
var fs17 = __toESM(require("fs"));
var path19 = __toESM(require("path"));

// scripts/lib/capability/candidate-surface.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_util3 = require("util");

// scripts/lib/core/contracts/project-capability-profile.ts
var import_util2 = require("util");

// scripts/lib/core/contracts/project-definition-ref.ts
var import_util = require("util");
var PROJECT_DEFINITION_REF_SCHEMA = "guild.project_definition_ref.v1";
var DEFINITION_KINDS = Object.freeze(["agent", "skill"]);
var DEFINITION_KIND_SET = new Set(DEFINITION_KINDS);
var DEFINITION_LAYERS = Object.freeze([
  "plugin-shipped",
  "dot-claude-agents",
  "project-guild",
  "umbrella-guild"
]);
var DEFINITION_LAYER_SET = new Set(DEFINITION_LAYERS);
function layerAgreesWithPath(layer, path20) {
  const segments = path20.split("/");
  const hasClaude = segments.includes(".claude");
  const hasGuild = segments.includes(".guild");
  if (hasClaude && hasGuild) return false;
  if (hasClaude) return layer === "dot-claude-agents";
  if (hasGuild) return layer === "project-guild" || layer === "umbrella-guild";
  return true;
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
function hasExactKeys(o, keys) {
  if (Object.getOwnPropertySymbols(o).length > 0) return false;
  const own = Object.getOwnPropertyNames(o);
  if (own.length !== keys.length) return false;
  for (const k of keys) if (!own.includes(k)) return false;
  return true;
}
var MAX_SKILLS = 256;
var MAX_PROJECT_ID = 128;
var MAX_DEFINITION_ID = 128;
var MAX_RELATIVE_PATH = 1024;
var SOURCE_COMMIT_RE = /^[0-9a-f]{7,64}$/;
var CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
function isBoundedScalar(v, max) {
  if (typeof v !== "string" || v.length === 0) return false;
  if (CONTROL_RE.test(v)) return false;
  return Buffer.byteLength(v, "utf8") <= max;
}
var IDENTITY_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function isIdentityToken(v, max) {
  return isBoundedScalar(v, max) && IDENTITY_TOKEN_RE.test(v);
}
var SKILL_BODY_FILENAME = "SKILL.md";
var CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/;
function isValidContentHash(v) {
  return typeof v === "string" && CONTENT_HASH_RE.test(v);
}
function isProjectRelativePath(v) {
  if (!isBoundedScalar(v, MAX_RELATIVE_PATH)) return false;
  if (v.includes("\\")) return false;
  if (v.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(v)) return false;
  if (v.endsWith("/")) return false;
  const segments = v.split("/");
  for (const seg of segments) {
    if (seg.length === 0) return false;
    if (seg === ".") return false;
    if (seg === "..") return false;
  }
  return true;
}
var PINNED_SKILL_KEYS = ["id", "relative_path", "content_hash"];
var REF_KEYS = [
  "schema_version",
  "project_id",
  "layer",
  "kind",
  "id",
  "relative_path",
  "content_hash",
  "source_commit",
  "specialist_profile_hash",
  "specialist_type_hash",
  "skills"
];
function validatePinnedSkillRefInner(obj) {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, PINNED_SKILL_KEYS)) return null;
  const idProp = ownDataProp(obj, "id");
  const pathProp = ownDataProp(obj, "relative_path");
  const hashProp = ownDataProp(obj, "content_hash");
  if (idProp.kind !== "data" || pathProp.kind !== "data" || hashProp.kind !== "data") return null;
  if (!isIdentityToken(idProp.value, MAX_DEFINITION_ID)) return null;
  if (!isProjectRelativePath(pathProp.value)) return null;
  if (!isValidContentHash(hashProp.value)) return null;
  const segments = pathProp.value.split("/");
  if (segments.length < 2) return null;
  if (segments[segments.length - 1] !== SKILL_BODY_FILENAME) return null;
  if (segments[segments.length - 2] !== idProp.value) return null;
  const underProjectSkills = segments[0] === ".guild" && segments[1] === "skills";
  const underPluginSkills = segments[0] === "skills";
  if (!underProjectSkills && !underPluginSkills) return null;
  return {
    id: idProp.value,
    relative_path: pathProp.value,
    content_hash: hashProp.value
  };
}
function sanitizeSkillArr(v) {
  if (!Array.isArray(v)) return null;
  if (import_util.types.isProxy(v)) return null;
  if (Object.getPrototypeOf(v) !== Array.prototype) return null;
  const lenDesc = Object.getOwnPropertyDescriptor(v, "length");
  if (!lenDesc || !("value" in lenDesc) || typeof lenDesc.value !== "number" || !Number.isInteger(lenDesc.value) || lenDesc.value < 0) {
    return null;
  }
  if (lenDesc.value > MAX_SKILLS) return null;
  if (Object.getOwnPropertySymbols(v).length > 0) return null;
  const ownNames = Object.getOwnPropertyNames(v);
  if (ownNames.length > MAX_SKILLS + 1) return null;
  for (const k of ownNames) {
    if (k === "length") continue;
    const n = Number(k);
    if (!Number.isInteger(n) || n < 0 || String(n) !== k) return null;
    if (n >= lenDesc.value) return null;
  }
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < lenDesc.value; i++) {
    const desc = Object.getOwnPropertyDescriptor(v, i);
    if (!desc || !("value" in desc)) return null;
    const skill = validatePinnedSkillRefInner(desc.value);
    if (skill === null) return null;
    if (seen.has(skill.id)) return null;
    seen.add(skill.id);
    out.push(skill);
  }
  return out;
}
function validateProjectDefinitionRefV1Inner(obj) {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, REF_KEYS)) return null;
  const schemaProp = ownDataProp(obj, "schema_version");
  if (schemaProp.kind !== "data" || schemaProp.value !== PROJECT_DEFINITION_REF_SCHEMA) return null;
  const projectProp = ownDataProp(obj, "project_id");
  const layerProp = ownDataProp(obj, "layer");
  const kindProp = ownDataProp(obj, "kind");
  const idProp = ownDataProp(obj, "id");
  const pathProp = ownDataProp(obj, "relative_path");
  const hashProp = ownDataProp(obj, "content_hash");
  const commitProp = ownDataProp(obj, "source_commit");
  const profileHashProp = ownDataProp(obj, "specialist_profile_hash");
  const typeHashProp = ownDataProp(obj, "specialist_type_hash");
  const skillsProp = ownDataProp(obj, "skills");
  if (projectProp.kind !== "data") return null;
  if (layerProp.kind !== "data") return null;
  if (kindProp.kind !== "data") return null;
  if (idProp.kind !== "data") return null;
  if (pathProp.kind !== "data") return null;
  if (hashProp.kind !== "data") return null;
  if (commitProp.kind !== "data") return null;
  if (profileHashProp.kind !== "data") return null;
  if (typeHashProp.kind !== "data") return null;
  if (skillsProp.kind !== "data") return null;
  if (!isIdentityToken(projectProp.value, MAX_PROJECT_ID)) return null;
  if (typeof layerProp.value !== "string" || !DEFINITION_LAYER_SET.has(layerProp.value)) {
    return null;
  }
  if (typeof kindProp.value !== "string" || !DEFINITION_KIND_SET.has(kindProp.value)) return null;
  const kind = kindProp.value;
  if (!isIdentityToken(idProp.value, MAX_DEFINITION_ID)) return null;
  if (!isProjectRelativePath(pathProp.value)) return null;
  if (!isValidContentHash(hashProp.value)) return null;
  if (commitProp.value !== null) {
    if (typeof commitProp.value !== "string") return null;
    if (!SOURCE_COMMIT_RE.test(commitProp.value)) return null;
  }
  const isIdentityHash = (x) => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
  if (kind === "agent") {
    if (!isIdentityHash(profileHashProp.value)) return null;
    if (!isIdentityHash(typeHashProp.value)) return null;
  } else {
    if (profileHashProp.value !== null) return null;
    if (typeHashProp.value !== null) return null;
  }
  if (!layerAgreesWithPath(layerProp.value, pathProp.value)) return null;
  const skills = sanitizeSkillArr(skillsProp.value);
  if (skills === null) return null;
  return {
    schema_version: PROJECT_DEFINITION_REF_SCHEMA,
    project_id: projectProp.value,
    layer: layerProp.value,
    kind,
    id: idProp.value,
    relative_path: pathProp.value,
    content_hash: hashProp.value,
    source_commit: commitProp.value,
    specialist_profile_hash: kind === "agent" ? profileHashProp.value : null,
    specialist_type_hash: kind === "agent" ? typeHashProp.value : null,
    skills
  };
}
function validateProjectDefinitionRefV1(obj) {
  try {
    return validateProjectDefinitionRefV1Inner(obj);
  } catch {
    return null;
  }
}
var REF_VERIFICATION_FAILURES = Object.freeze([
  /** The ref itself is malformed → transport `invalid_request`. */
  "invalid_ref",
  /** Bytes were supplied but their hash does not match → transport `invalid_request`. */
  "hash_mismatch",
  /** The definition could not be read at `relative_path` → transport `capability_absent`. */
  "bytes_absent"
]);

// scripts/lib/core/contracts/project-capability-profile.ts
var PROJECT_CAPABILITY_PROFILE_SCHEMA = "guild.project_capability_profile.v1";
var DEFAULT_SUGGESTION_BUDGET = 4;
var RESOLVER_MODES = Object.freeze(["legacy", "observe", "shadow", "project-local", "strict"]);
var RESOLVER_MODE_SET = new Set(RESOLVER_MODES);
var CONFIDENCE_GRADES = Object.freeze(["high", "medium", "low"]);
var CONFIDENCE_SET = new Set(CONFIDENCE_GRADES);
var CANDIDATE_ACTIONS = Object.freeze(["propose", "observe", "defer"]);
var CANDIDATE_ACTION_SET = new Set(CANDIDATE_ACTIONS);
var CANDIDATE_KINDS = Object.freeze(["agent", "skill"]);
var CANDIDATE_KIND_SET = new Set(CANDIDATE_KINDS);
var EVIDENCE_SOURCES = Object.freeze([
  "codebase_map",
  "knowledge_graph",
  "run",
  "reflection",
  "roster"
]);
var EVIDENCE_SOURCE_SET = new Set(EVIDENCE_SOURCES);
var MUTATION_WINDOWS = Object.freeze(["run", "emission"]);
var MUTATION_WINDOW_SET = new Set(MUTATION_WINDOWS);
var HISTORICAL_EVIDENCE_SOURCES = Object.freeze(["run", "reflection"]);
var HISTORICAL_SOURCE_SET = new Set(HISTORICAL_EVIDENCE_SOURCES);
function isPlainDataObject2(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  if (import_util2.types.isProxy(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function ownDataProp2(o, key) {
  const desc = Object.getOwnPropertyDescriptor(o, key);
  if (!desc) return { kind: "absent" };
  if (!("value" in desc)) return { kind: "accessor" };
  return { kind: "data", value: desc.value };
}
var MAX_SLUG_LEN = 64;
var MAX_ID_LEN = 128;
var MAX_LABEL_LEN = 200;
var MAX_PROSE_LEN = 500;
var MAX_LOCATOR_LEN = 512;
var MAX_ANCHOR_LEN = 64;
var MAX_REF_LEN = 640;
var MAX_TIMESTAMP_LEN = 64;
var MAX_FACTS = 200;
var MAX_EVIDENCE_REFS = 64;
var MAX_COVERAGE_ENTRIES = 500;
var MAX_JUSTIFIED_BY = 32;
var MAX_ABSENT = 16;
var MAX_PROFILE_BYTES = 256 * 1024;
function measuredBytes(value, depth = 0) {
  if (depth > 8) return Number.POSITIVE_INFINITY;
  if (typeof value === "string") return value.length;
  if (value === null || typeof value !== "object") return 8;
  let total = 0;
  if (Array.isArray(value)) {
    for (const entry of value) total += measuredBytes(entry, depth + 1);
    return total;
  }
  for (const k of Object.getOwnPropertyNames(value)) {
    total += k.length + measuredBytes(value[k], depth + 1);
  }
  return total;
}
var CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
var SLUG_SHAPE = /^[a-z0-9][a-z0-9._-]*$/;
function isBoundedSlug(v) {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_SLUG_LEN && !CONTROL_CHARS.test(v) && SLUG_SHAPE.test(v);
}
function isBoundedNamespacedId(v) {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_ID_LEN) return false;
  if (CONTROL_CHARS.test(v)) return false;
  if (v.includes("\\")) return false;
  for (const seg of v.split("/")) {
    if (!SLUG_SHAPE.test(seg)) return false;
  }
  return true;
}
function isBoundedText(v, max) {
  return typeof v === "string" && v.length > 0 && v.length <= max && !CONTROL_CHARS.test(v);
}
var COMMITISH_RE = /^[0-9a-f]{7,64}$/;
var RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?([Zz]|[+-]\d{2}:\d{2})$/;
function isRfc3339(v) {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_TIMESTAMP_LEN) return false;
  const m = RFC3339_RE.exec(v);
  if (m === null) return false;
  const [mo, d, h, mi, sec] = [+m[2], +m[3], +m[4], +m[5], +m[6]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  if (h > 23 || mi > 59 || sec > 60) return false;
  const offset = m[8];
  if (offset.length > 1) {
    const [oh, om] = [+offset.slice(1, 3), +offset.slice(4, 6)];
    if (oh > 23 || om > 59) return false;
  }
  return true;
}
var isNonEmptyStr = (v) => typeof v === "string" && v.length > 0;
function hasExactKeys2(o, keys) {
  if (Object.getOwnPropertySymbols(o).length > 0) return false;
  const own = Object.getOwnPropertyNames(o);
  if (own.length !== keys.length) return false;
  for (const k of keys) if (!own.includes(k)) return false;
  return true;
}
function readDataArray(v, maxItems) {
  if (!Array.isArray(v)) return null;
  if (import_util2.types.isProxy(v)) return null;
  if (Object.getOwnPropertySymbols(v).length > 0) return null;
  if (Object.getPrototypeOf(v) !== Array.prototype) return null;
  const lenDesc = Object.getOwnPropertyDescriptor(v, "length");
  if (!lenDesc || !("value" in lenDesc) || typeof lenDesc.value !== "number" || !Number.isInteger(lenDesc.value) || lenDesc.value < 0) {
    return null;
  }
  if (maxItems !== void 0 && lenDesc.value > maxItems) return null;
  for (const k of Object.getOwnPropertyNames(v)) {
    if (k === "length") continue;
    const n = Number(k);
    if (!Number.isInteger(n) || n < 0 || String(n) !== k) return null;
    if (n >= lenDesc.value) return null;
  }
  const out = [];
  for (let i = 0; i < lenDesc.value; i++) {
    const desc = Object.getOwnPropertyDescriptor(v, i);
    if (!desc || !("value" in desc)) return null;
    out.push(desc.value);
  }
  return out;
}
function readStrArray(v, opts) {
  const raw = readDataArray(v, opts.maxItems);
  if (raw === null) return null;
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of raw) {
    if (opts.idKind === "slug") {
      if (!isBoundedSlug(entry)) return null;
    } else if (opts.idKind === "namespaced") {
      if (!isBoundedNamespacedId(entry)) return null;
    } else if (!isBoundedText(entry, opts.maxLen)) {
      return null;
    }
    if (opts.unique) {
      if (seen.has(entry)) return null;
      seen.add(entry);
    }
    out.push(entry);
  }
  return out;
}
var TREE_HASH_RE = /^[0-9a-f]{64}$/;
var PREFIXED_HASH_RE = /^sha256:[0-9a-f]{64}$/;
function isFeedstockHash(v) {
  return typeof v === "string" && (TREE_HASH_RE.test(v) || PREFIXED_HASH_RE.test(v));
}
function isTreeHash(v) {
  return typeof v === "string" && TREE_HASH_RE.test(v);
}
function parseEvidenceRef(v) {
  if (!isNonEmptyStr(v)) return null;
  if (v.length > MAX_REF_LEN) return null;
  if (CONTROL_CHARS.test(v)) return null;
  const colon = v.indexOf(":");
  if (colon <= 0) return null;
  const source = v.slice(0, colon);
  if (!EVIDENCE_SOURCE_SET.has(source)) return null;
  let rest = v.slice(colon + 1);
  if (rest.length === 0) return null;
  let anchor = null;
  const hash = rest.lastIndexOf("#");
  if (hash !== -1) {
    anchor = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
    if (anchor.length === 0) return null;
  }
  if (rest.length === 0 || rest.length > MAX_LOCATOR_LEN) return null;
  if (anchor !== null && anchor.length > MAX_ANCHOR_LEN) return null;
  if (!isCanonicalLocator(rest)) return null;
  return { source, locator: rest, anchor };
}
function isCanonicalLocator(v) {
  if (typeof v !== "string" || v.length === 0) return false;
  if (v.includes("\\")) return false;
  for (const seg of v.split("/")) {
    if (seg.length === 0) return false;
    if (seg === ".") return false;
    if (seg === "..") return false;
  }
  return true;
}
function readEvidenceRefArray(v, opts = {}) {
  const raw = readStrArray(v, { unique: true, maxItems: MAX_EVIDENCE_REFS, maxLen: MAX_REF_LEN });
  if (raw === null) return null;
  for (const entry of raw) {
    const parsed = parseEvidenceRef(entry);
    if (parsed === null) return null;
    if (opts.historicalOnly && !HISTORICAL_SOURCE_SET.has(parsed.source)) return null;
  }
  return raw;
}
var MUTATION_EVIDENCE_KEYS = [
  "agents_tree_hash_before",
  "agents_tree_hash_after",
  "skills_tree_hash_before",
  "skills_tree_hash_after",
  "registry_hash_before",
  "registry_hash_after"
];
function validateMutationEvidenceInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, MUTATION_EVIDENCE_KEYS)) return null;
  const values = {};
  for (const key of MUTATION_EVIDENCE_KEYS) {
    const prop = ownDataProp2(obj, key);
    if (prop.kind !== "data") return null;
    if (!isTreeHash(prop.value)) return null;
    values[key] = prop.value;
  }
  if (values.agents_tree_hash_before !== values.agents_tree_hash_after) return null;
  if (values.skills_tree_hash_before !== values.skills_tree_hash_after) return null;
  if (values.registry_hash_before !== values.registry_hash_after) return null;
  return {
    agents_tree_hash_before: values.agents_tree_hash_before,
    agents_tree_hash_after: values.agents_tree_hash_after,
    skills_tree_hash_before: values.skills_tree_hash_before,
    skills_tree_hash_after: values.skills_tree_hash_after,
    registry_hash_before: values.registry_hash_before,
    registry_hash_after: values.registry_hash_after
  };
}
var FEEDSTOCK_KEYS = [
  "codebase_map_hash",
  "knowledge_graph_hash",
  "roster_hash",
  "absent"
];
function validateFeedstockInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, FEEDSTOCK_KEYS)) return null;
  const cm = ownDataProp2(obj, "codebase_map_hash");
  const kg = ownDataProp2(obj, "knowledge_graph_hash");
  const roster = ownDataProp2(obj, "roster_hash");
  const absentProp = ownDataProp2(obj, "absent");
  if (cm.kind !== "data" || kg.kind !== "data") return null;
  if (roster.kind !== "data" || absentProp.kind !== "data") return null;
  if (cm.value !== null && !isFeedstockHash(cm.value)) return null;
  if (kg.value !== null && !isFeedstockHash(kg.value)) return null;
  if (roster.value !== null && !isFeedstockHash(roster.value)) return null;
  const absent = readStrArray(absentProp.value, {
    unique: true,
    maxItems: MAX_ABSENT,
    maxLen: MAX_ID_LEN,
    idKind: "slug"
  });
  if (absent === null) return null;
  const declared = [
    ["codebase_map", cm.value],
    ["knowledge_graph", kg.value],
    ["roster", roster.value]
  ];
  const names = new Set(declared.map(([n]) => n));
  for (const name of absent) if (!names.has(name)) return null;
  const absentSet = new Set(absent);
  for (const [name, hash] of declared) {
    if (hash === null !== absentSet.has(name)) return null;
  }
  return {
    codebase_map_hash: cm.value,
    knowledge_graph_hash: kg.value,
    roster_hash: roster.value,
    absent
  };
}
var DOMAIN_KEYS = ["id", "label", "evidence_refs", "confidence"];
var BOUNDARY_KEYS = ["id", "label", "rationale", "evidence_refs", "confidence"];
var METHOD_KEYS = ["id", "label", "occurrence_count", "evidence_refs", "confidence"];
function validateDomainFactInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, DOMAIN_KEYS)) return null;
  const id = ownDataProp2(obj, "id");
  const label = ownDataProp2(obj, "label");
  const refs = ownDataProp2(obj, "evidence_refs");
  const conf = ownDataProp2(obj, "confidence");
  if (id.kind !== "data" || label.kind !== "data") return null;
  if (refs.kind !== "data" || conf.kind !== "data") return null;
  if (!isBoundedNamespacedId(id.value) || !isBoundedText(label.value, MAX_LABEL_LEN)) return null;
  if (typeof conf.value !== "string" || !CONFIDENCE_SET.has(conf.value)) return null;
  const evidence2 = readEvidenceRefArray(refs.value);
  if (evidence2 === null || evidence2.length === 0) return null;
  return {
    id: id.value,
    label: label.value,
    evidence_refs: evidence2,
    confidence: conf.value
  };
}
function validateBoundaryFactInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, BOUNDARY_KEYS)) return null;
  const id = ownDataProp2(obj, "id");
  const label = ownDataProp2(obj, "label");
  const rationale = ownDataProp2(obj, "rationale");
  const refs = ownDataProp2(obj, "evidence_refs");
  const conf = ownDataProp2(obj, "confidence");
  if (id.kind !== "data" || label.kind !== "data" || rationale.kind !== "data") return null;
  if (refs.kind !== "data" || conf.kind !== "data") return null;
  if (!isBoundedNamespacedId(id.value) || !isBoundedText(label.value, MAX_LABEL_LEN)) return null;
  if (!isBoundedText(rationale.value, MAX_PROSE_LEN)) return null;
  if (typeof conf.value !== "string" || !CONFIDENCE_SET.has(conf.value)) return null;
  const evidence2 = readEvidenceRefArray(refs.value);
  if (evidence2 === null || evidence2.length === 0) return null;
  return {
    id: id.value,
    label: label.value,
    rationale: rationale.value,
    evidence_refs: evidence2,
    confidence: conf.value
  };
}
function validateMethodFactInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, METHOD_KEYS)) return null;
  const id = ownDataProp2(obj, "id");
  const label = ownDataProp2(obj, "label");
  const count = ownDataProp2(obj, "occurrence_count");
  const refs = ownDataProp2(obj, "evidence_refs");
  const conf = ownDataProp2(obj, "confidence");
  if (id.kind !== "data" || label.kind !== "data" || count.kind !== "data") return null;
  if (refs.kind !== "data" || conf.kind !== "data") return null;
  if (!isBoundedNamespacedId(id.value) || !isBoundedText(label.value, MAX_LABEL_LEN)) return null;
  if (typeof count.value !== "number" || !Number.isInteger(count.value) || count.value < 1) {
    return null;
  }
  if (count.value > MAX_EVIDENCE_REFS) return null;
  if (typeof conf.value !== "string" || !CONFIDENCE_SET.has(conf.value)) return null;
  const evidence2 = readEvidenceRefArray(refs.value, { historicalOnly: true });
  if (evidence2 === null) return null;
  if (evidence2.length !== count.value) return null;
  return {
    id: id.value,
    label: label.value,
    occurrence_count: count.value,
    evidence_refs: evidence2,
    confidence: conf.value
  };
}
var COVERED_ENTRY_KEYS = ["fact_id", "covered_by"];
function validateCoveredEntryInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, COVERED_ENTRY_KEYS)) return null;
  const factId = ownDataProp2(obj, "fact_id");
  const coveredBy = ownDataProp2(obj, "covered_by");
  if (factId.kind !== "data" || coveredBy.kind !== "data") return null;
  if (!isBoundedNamespacedId(factId.value)) return null;
  const ref = validateProjectDefinitionRefV1(coveredBy.value);
  if (ref === null) return null;
  return { fact_id: factId.value, covered_by: ref };
}
var COVERAGE_KEYS = ["covered", "uncovered", "unmatched_roles"];
function validateCoverageInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, COVERAGE_KEYS)) return null;
  const coveredProp = ownDataProp2(obj, "covered");
  const uncoveredProp = ownDataProp2(obj, "uncovered");
  const unmatchedProp = ownDataProp2(obj, "unmatched_roles");
  if (coveredProp.kind !== "data") return null;
  if (uncoveredProp.kind !== "data" || unmatchedProp.kind !== "data") return null;
  const rawCovered = readDataArray(coveredProp.value, MAX_COVERAGE_ENTRIES);
  if (rawCovered === null) return null;
  const covered = [];
  const seenFacts = /* @__PURE__ */ new Set();
  for (const entry of rawCovered) {
    const parsed = validateCoveredEntryInner(entry);
    if (parsed === null) return null;
    if (seenFacts.has(parsed.fact_id)) return null;
    seenFacts.add(parsed.fact_id);
    covered.push(parsed);
  }
  const uncovered = readStrArray(uncoveredProp.value, {
    unique: true,
    maxItems: MAX_COVERAGE_ENTRIES,
    maxLen: MAX_ID_LEN,
    idKind: "namespaced"
    // fact ids
  });
  if (uncovered === null) return null;
  const unmatchedRoles = readStrArray(unmatchedProp.value, {
    unique: true,
    maxItems: MAX_COVERAGE_ENTRIES,
    maxLen: MAX_ID_LEN,
    idKind: "slug"
    // role names become files
  });
  if (unmatchedRoles === null) return null;
  for (const factId of uncovered) if (seenFacts.has(factId)) return null;
  return { covered, uncovered, unmatched_roles: unmatchedRoles };
}
var CANDIDATE_KEYS = [
  "id",
  "kind",
  "proposed_id",
  "justified_by",
  "action",
  "defer_reason",
  "confidence",
  "owning_layer"
];
function validateCandidateInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, CANDIDATE_KEYS)) return null;
  const id = ownDataProp2(obj, "id");
  const kind = ownDataProp2(obj, "kind");
  const proposedId = ownDataProp2(obj, "proposed_id");
  const justifiedBy = ownDataProp2(obj, "justified_by");
  const action = ownDataProp2(obj, "action");
  const deferReason = ownDataProp2(obj, "defer_reason");
  const conf = ownDataProp2(obj, "confidence");
  const owningLayer = ownDataProp2(obj, "owning_layer");
  if (id.kind !== "data" || kind.kind !== "data" || proposedId.kind !== "data") return null;
  if (justifiedBy.kind !== "data" || action.kind !== "data") return null;
  if (deferReason.kind !== "data" || conf.kind !== "data" || owningLayer.kind !== "data") {
    return null;
  }
  if (!isBoundedNamespacedId(id.value) || !isBoundedSlug(proposedId.value)) return null;
  if (!isBoundedSlug(owningLayer.value)) return null;
  if (typeof kind.value !== "string" || !CANDIDATE_KIND_SET.has(kind.value)) return null;
  if (typeof action.value !== "string" || !CANDIDATE_ACTION_SET.has(action.value)) return null;
  if (typeof conf.value !== "string" || !CONFIDENCE_SET.has(conf.value)) return null;
  const actionValue = action.value;
  const confidence = conf.value;
  const justified = readStrArray(justifiedBy.value, {
    unique: true,
    maxItems: MAX_JUSTIFIED_BY,
    maxLen: MAX_ID_LEN,
    idKind: "namespaced"
    // cites fact ids
  });
  if (justified === null || justified.length === 0) return null;
  if (confidence === "low" && actionValue === "propose") return null;
  if (actionValue === "propose") {
    if (deferReason.value !== null) return null;
  } else {
    if (!isBoundedText(deferReason.value, MAX_PROSE_LEN)) return null;
  }
  return {
    id: id.value,
    kind: kind.value,
    proposed_id: proposedId.value,
    justified_by: justified,
    action: actionValue,
    defer_reason: actionValue === "propose" ? null : deferReason.value,
    confidence,
    owning_layer: owningLayer.value
  };
}
var PROFILE_KEYS = [
  "schema_version",
  "project_id",
  "run_id",
  "generated_at",
  "source_commit",
  "feedstock",
  "domains",
  "boundaries",
  "repeated_methods",
  "coverage",
  "candidates",
  "resolver_mode",
  "mutation_performed",
  "mutation_evidence",
  "mutation_window"
];
var PROFILE_OPTS_KEYS = ["suggestionBudget"];
function resolveSuggestionBudget(opts) {
  if (opts === void 0) return DEFAULT_SUGGESTION_BUDGET;
  if (!isPlainDataObject2(opts)) return null;
  if (Object.getOwnPropertySymbols(opts).length > 0) return null;
  if (Object.getOwnPropertyNames(opts).some((k) => !PROFILE_OPTS_KEYS.includes(k))) {
    return null;
  }
  const prop = ownDataProp2(opts, "suggestionBudget");
  if (prop.kind === "accessor") return null;
  if (prop.kind === "absent") return DEFAULT_SUGGESTION_BUDGET;
  if (prop.value === void 0) return DEFAULT_SUGGESTION_BUDGET;
  if (typeof prop.value !== "number") return null;
  if (!Number.isInteger(prop.value) || prop.value < 0) return null;
  return prop.value;
}
function validateProjectCapabilityProfileV1Inner(obj, opts) {
  const budget = resolveSuggestionBudget(opts);
  if (budget === null) return null;
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, PROFILE_KEYS)) return null;
  const schema = ownDataProp2(obj, "schema_version");
  if (schema.kind !== "data" || schema.value !== PROJECT_CAPABILITY_PROFILE_SCHEMA) return null;
  const projectId = ownDataProp2(obj, "project_id");
  const runId = ownDataProp2(obj, "run_id");
  const generatedAt = ownDataProp2(obj, "generated_at");
  const sourceCommit = ownDataProp2(obj, "source_commit");
  const feedstockProp = ownDataProp2(obj, "feedstock");
  const domainsProp = ownDataProp2(obj, "domains");
  const boundariesProp = ownDataProp2(obj, "boundaries");
  const methodsProp = ownDataProp2(obj, "repeated_methods");
  const coverageProp = ownDataProp2(obj, "coverage");
  const candidatesProp = ownDataProp2(obj, "candidates");
  const resolverModeProp = ownDataProp2(obj, "resolver_mode");
  const mutationPerformedProp = ownDataProp2(obj, "mutation_performed");
  const mutationEvidenceProp = ownDataProp2(obj, "mutation_evidence");
  const mutationWindowProp = ownDataProp2(obj, "mutation_window");
  if (projectId.kind !== "data" || runId.kind !== "data") return null;
  if (generatedAt.kind !== "data" || sourceCommit.kind !== "data") return null;
  if (feedstockProp.kind !== "data" || domainsProp.kind !== "data") return null;
  if (boundariesProp.kind !== "data" || methodsProp.kind !== "data") return null;
  if (coverageProp.kind !== "data" || candidatesProp.kind !== "data") return null;
  if (resolverModeProp.kind !== "data") return null;
  if (mutationPerformedProp.kind !== "data" || mutationEvidenceProp.kind !== "data") return null;
  if (mutationWindowProp.kind !== "data") return null;
  if (typeof mutationWindowProp.value !== "string" || !MUTATION_WINDOW_SET.has(mutationWindowProp.value)) {
    return null;
  }
  if (!isBoundedSlug(projectId.value)) return null;
  if (!isBoundedSlug(runId.value)) return null;
  if (!isRfc3339(generatedAt.value)) return null;
  if (sourceCommit.value !== null) {
    if (typeof sourceCommit.value !== "string") return null;
    if (!COMMITISH_RE.test(sourceCommit.value)) return null;
  }
  if (typeof resolverModeProp.value !== "string" || !RESOLVER_MODE_SET.has(resolverModeProp.value)) {
    return null;
  }
  if (mutationPerformedProp.value !== false) return null;
  const feedstock = validateFeedstockInner(feedstockProp.value);
  if (feedstock === null) return null;
  const mutationEvidence = validateMutationEvidenceInner(mutationEvidenceProp.value);
  if (mutationEvidence === null) return null;
  const rawDomains = readDataArray(domainsProp.value, MAX_FACTS);
  if (rawDomains === null) return null;
  const domains = [];
  const domainIds = /* @__PURE__ */ new Set();
  for (const entry of rawDomains) {
    const parsed = validateDomainFactInner(entry);
    if (parsed === null) return null;
    if (domainIds.has(parsed.id)) return null;
    domainIds.add(parsed.id);
    domains.push(parsed);
  }
  const rawBoundaries = readDataArray(boundariesProp.value, MAX_FACTS);
  if (rawBoundaries === null) return null;
  const boundaries = [];
  const boundaryIds = /* @__PURE__ */ new Set();
  for (const entry of rawBoundaries) {
    const parsed = validateBoundaryFactInner(entry);
    if (parsed === null) return null;
    if (boundaryIds.has(parsed.id)) return null;
    boundaryIds.add(parsed.id);
    boundaries.push(parsed);
  }
  const rawMethods = readDataArray(methodsProp.value, MAX_FACTS);
  if (rawMethods === null) return null;
  const repeatedMethods = [];
  const methodIds = /* @__PURE__ */ new Set();
  for (const entry of rawMethods) {
    const parsed = validateMethodFactInner(entry);
    if (parsed === null) return null;
    if (methodIds.has(parsed.id)) return null;
    methodIds.add(parsed.id);
    repeatedMethods.push(parsed);
  }
  const coverage = validateCoverageInner(coverageProp.value);
  if (coverage === null) return null;
  const rawCandidates = readDataArray(candidatesProp.value, budget);
  if (rawCandidates === null) return null;
  if (rawCandidates.length > budget) return null;
  const candidates = [];
  const candidateIds = /* @__PURE__ */ new Set();
  for (const entry of rawCandidates) {
    const parsed = validateCandidateInner(entry);
    if (parsed === null) return null;
    if (candidateIds.has(parsed.id)) return null;
    candidateIds.add(parsed.id);
    candidates.push(parsed);
  }
  const knownFactIds = /* @__PURE__ */ new Set([...domainIds, ...boundaryIds, ...methodIds]);
  for (const candidate of candidates) {
    for (const factId of candidate.justified_by) {
      if (!knownFactIds.has(factId)) return null;
    }
  }
  for (const entry of coverage.covered) {
    if (!knownFactIds.has(entry.fact_id)) return null;
  }
  for (const factId of coverage.uncovered) {
    if (!knownFactIds.has(factId)) return null;
  }
  const result = {
    schema_version: PROJECT_CAPABILITY_PROFILE_SCHEMA,
    project_id: projectId.value,
    run_id: runId.value,
    generated_at: generatedAt.value,
    source_commit: sourceCommit.value,
    feedstock,
    domains,
    boundaries,
    repeated_methods: repeatedMethods,
    coverage,
    candidates,
    resolver_mode: resolverModeProp.value,
    mutation_performed: false,
    mutation_evidence: mutationEvidence,
    mutation_window: mutationWindowProp.value
  };
  if (measuredBytes(result) > MAX_PROFILE_BYTES) return null;
  return result;
}
function validateProjectCapabilityProfileV1(obj, opts = {}) {
  try {
    return validateProjectCapabilityProfileV1Inner(obj, opts);
  } catch {
    return null;
  }
}

// scripts/lib/capability/candidate-surface.ts
var RUNS_DIR = ".guild/runs";
var PROFILE_LEAF = path.join("capability", "profile.json");
var RUN_DIR_RE = /^run-([0-9]{8})-([0-9]{6})-[a-z0-9][a-z0-9._-]*$/;
function isRealRunDir(name) {
  const m = RUN_DIR_RE.exec(name);
  if (m === null) return false;
  const [y, mo, d] = [+m[1].slice(0, 4), +m[1].slice(4, 6), +m[1].slice(6, 8)];
  const [h, mi, sec] = [+m[2].slice(0, 2), +m[2].slice(2, 4), +m[2].slice(4, 6)];
  if (y < 2e3 || y > 2999 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  if (h > 23 || mi > 59 || sec > 60) return false;
  return true;
}
var PROFILE_MAX_BYTES = 256 * 1024;
var RENDER_FIELD_MAX_LEN = 120;
var CANDIDATE_SCAN_LIMIT = 50;
var EMPTY_REASONS = Object.freeze([
  "no_runs_directory",
  "no_profile_found",
  "profile_invalid",
  "profile_too_large",
  "invalid_options",
  "profile_has_no_candidates",
  "all_candidates_satisfied"
]);
function safeReadDir(abs) {
  try {
    return fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
function readLiveRosterIds(projectRoot) {
  const agents = /* @__PURE__ */ new Set();
  const skills = /* @__PURE__ */ new Set();
  try {
    for (const e of fs.readdirSync(path.join(projectRoot, ".guild/agents"), {
      withFileTypes: true
    })) {
      if (e.isFile() && e.name.endsWith(".md")) agents.add(e.name.slice(0, -3));
    }
  } catch {
  }
  for (const name of safeReadDir(path.join(projectRoot, ".guild/skills"))) {
    if (fs.existsSync(path.join(projectRoot, ".guild/skills", name, "SKILL.md"))) skills.add(name);
  }
  return { agents, skills };
}
function listProfileRunIds(projectRoot) {
  const dirs = safeReadDir(path.join(projectRoot, RUNS_DIR)).filter(isRealRunDir).sort().reverse();
  const out = [];
  for (const d of dirs) {
    if (out.length >= CANDIDATE_SCAN_LIMIT) break;
    if (fs.existsSync(path.join(projectRoot, RUNS_DIR, d, PROFILE_LEAF))) out.push(d);
  }
  return out;
}
function resolveSurfaceBudget(opts) {
  if (opts === void 0) return DEFAULT_SUGGESTION_BUDGET;
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) return null;
  if (import_util3.types.isProxy(opts)) return null;
  const proto = Object.getPrototypeOf(opts);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(opts).length > 0) return null;
  for (const k of Object.getOwnPropertyNames(opts)) {
    if (k !== "suggestionBudget") return null;
  }
  const d = Object.getOwnPropertyDescriptor(opts, "suggestionBudget");
  if (!d) return DEFAULT_SUGGESTION_BUDGET;
  if (!("value" in d)) return null;
  if (d.value === void 0) return DEFAULT_SUGGESTION_BUDGET;
  if (typeof d.value !== "number" || !Number.isInteger(d.value) || d.value < 0) return null;
  return d.value;
}
function surfaceCapabilityCandidates(projectRoot, opts = {}) {
  const empty = (empty_reason, source_run_id = null) => ({
    source_run_id,
    pending: [],
    satisfied: [],
    empty_reason
  });
  try {
    const budget = resolveSurfaceBudget(opts);
    if (budget === null) return empty("invalid_options");
    if (!fs.existsSync(path.join(projectRoot, RUNS_DIR))) return empty("no_runs_directory");
    const runIds = listProfileRunIds(projectRoot);
    if (runIds.length === 0) return empty("no_profile_found");
    const runId = runIds[0];
    const profileAbs = path.join(projectRoot, RUNS_DIR, runId, PROFILE_LEAF);
    let bytes;
    try {
      bytes = fs.statSync(profileAbs).size;
    } catch {
      return empty("no_profile_found");
    }
    if (bytes > PROFILE_MAX_BYTES) return empty("profile_too_large", runId);
    let profile = null;
    try {
      const raw = JSON.parse(fs.readFileSync(profileAbs, "utf8"));
      profile = validateProjectCapabilityProfileV1(raw, { suggestionBudget: budget });
    } catch {
      profile = null;
    }
    if (profile === null) return empty("profile_invalid", runId);
    if (profile.candidates.length === 0) return empty("profile_has_no_candidates", runId);
    const roster = readLiveRosterIds(projectRoot);
    const pending = [];
    const satisfied = [];
    for (const candidate of profile.candidates) {
      const have = candidate.kind === "agent" ? roster.agents.has(candidate.proposed_id) : roster.skills.has(candidate.proposed_id);
      (have ? satisfied : pending).push({ run_id: runId, candidate });
    }
    if (pending.length === 0) {
      return { source_run_id: runId, pending, satisfied, empty_reason: "all_candidates_satisfied" };
    }
    return { source_run_id: runId, pending, satisfied, empty_reason: null };
  } catch {
    return empty("no_profile_found");
  }
}
var EMPTY_TEXT = Object.freeze({
  no_runs_directory: "no runs yet \u2014 capability profiling has not run",
  no_profile_found: "no capability profile emitted yet (run /guild:learn)",
  profile_invalid: "the newest capability profile FAILED validation \u2014 treat it as absent",
  profile_too_large: "the newest capability profile exceeds the size bound \u2014 not read",
  invalid_options: "the surfacing options were malformed \u2014 nothing was read",
  profile_has_no_candidates: "profiled, no candidates proposed",
  all_candidates_satisfied: "all proposed candidates already exist in the roster"
});
var RENDERABLE_ID = /^[A-Za-z0-9 ._,:/@+#=?!'\-]*$/;
var LINE_BREAKING = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
function renderId(value, field) {
  if (value.length > RENDER_FIELD_MAX_LEN) return `<${field}: over ${RENDER_FIELD_MAX_LEN} chars>`;
  if (!RENDERABLE_ID.test(value)) return `<${field}: unrenderable characters>`;
  return value;
}
function renderProse(value, field) {
  if (LINE_BREAKING.test(value)) return `<${field}: unrenderable characters>`;
  if (value.length > RENDER_FIELD_MAX_LEN) {
    return `${value.slice(0, RENDER_FIELD_MAX_LEN)}\u2026 (truncated)`;
  }
  return value;
}
function renderCandidateSection(surface) {
  const lines = ["Capability candidates (report-only \u2014 nothing is created without approval):"];
  if (surface.empty_reason !== null) {
    lines.push(`  ${EMPTY_TEXT[surface.empty_reason]}`);
    if (surface.satisfied.length > 0) {
      lines.push(`  (${surface.satisfied.length} already in the roster)`);
    }
    return lines.join("\n");
  }
  lines.push(`  from run ${surface.source_run_id ?? "(unknown)"}`);
  for (const { candidate } of surface.pending) {
    const why = candidate.defer_reason === null ? "" : ` \u2014 ${renderProse(candidate.defer_reason, "defer_reason")}`;
    lines.push(
      `  \u2022 [${candidate.action}] ${candidate.kind} "${renderId(candidate.proposed_id, "proposed_id")}" (confidence ${candidate.confidence}, owner ${renderId(candidate.owning_layer, "owning_layer")})${why}`
    );
  }
  if (surface.satisfied.length > 0) {
    lines.push(`  (${surface.satisfied.length} already in the roster)`);
  }
  lines.push("  Review with /guild:learn, or approve one via /guild:plan \u2014 never automatic.");
  return lines.join("\n");
}

// scripts/lib/state/ensure-storage-layout.ts
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));

// src/domains/state/guild-root.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
function resolveGuildRoot(startDir) {
  const resolvedStart = path2.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs2.existsSync(path2.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path2.join(current, ".guild");
      try {
        if (fs2.existsSync(guildDir) && fs2.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
      }
    }
    const parent = path2.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}

// scripts/lib/state/ensure-storage-layout.ts
var CURRENT_LAYOUT_VERSION = 2;
function markerPath(root) {
  return path3.join(root, ".guild", "storage-layout.json");
}
function detect(cwd = process.cwd()) {
  const root = resolveGuildRoot(cwd);
  const marker = markerPath(root);
  if (!fs3.existsSync(path3.join(root, ".guild"))) {
    return { state: "absent", version: null, root, marker };
  }
  let version = null;
  try {
    const parsed = JSON.parse(fs3.readFileSync(marker, "utf8"));
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
      path3.join(__dirname, "upgrade-chain.js"),
      path3.join(__dirname, "lib", "state", "upgrade-chain"),
      path3.join(__dirname, "upgrade-chain")
    ];
    const spec = candidates.find((c) => fs3.existsSync(c) || fs3.existsSync(`${c}.ts`)) ?? candidates[2];
    upgradeChunk = require(spec);
  }
  return upgradeChunk;
}
function ensureStorageLayout(cwd = process.cwd(), opts = {}) {
  const status = detect(cwd);
  if (status.state === "current") return status;
  if (status.state === "future") {
    throw new Error(
      `guild: .guild/ is layout ${status.version}, this build understands ${CURRENT_LAYOUT_VERSION}. Upgrade Guild; a newer layout is never down-migrated (${status.marker}).`
    );
  }
  if (status.state === "absent" || opts.detectOnly === true) return status;
  const chain = upgradeChain();
  const result = chain.runLayoutUpgrade({
    root: status.root,
    fromVersion: status.version,
    toVersion: CURRENT_LAYOUT_VERSION,
    dryRun: opts.dryRun === true
  });
  const after = detect(cwd);
  return { ...after, upgrade: result };
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

// src/domains/state/atomic-write.ts
var fs5 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
var crypto = __toESM(require("crypto"));

// src/domains/state/plugin-install-guard.ts
var fs4 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
function assertNotUnderPluginInstall(absPath, pluginInstallRoot) {
  const root = pluginInstallRoot ?? process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"] ?? process.env["CODEX_PLUGIN_ROOT"];
  if (!root) return;
  const resolvedRoot = path4.resolve(root);
  const rel2 = path4.relative(resolvedRoot, path4.resolve(absPath));
  if (rel2 === "" || !rel2.startsWith("..") && !path4.isAbsolute(rel2)) {
    const underOwnDotGuild = rel2 === ".guild" || rel2.startsWith(`.guild${path4.sep}`);
    if (underOwnDotGuild && fs4.existsSync(path4.join(resolvedRoot, ".git"))) return;
    throw new Error(`project-created Guild artifact would be written under plugin install dir: ${absPath}`);
  }
}

// src/domains/state/atomic-write.ts
function atomicWrite(targetPath, content, pluginInstallRoot) {
  writeThroughTemp(targetPath, content, false, pluginInstallRoot);
}
function writeThroughTemp(targetPath, content, durable, pluginInstallRoot) {
  assertNotUnderPluginInstall(targetPath, pluginInstallRoot);
  const dir = path5.dirname(targetPath);
  fs5.mkdirSync(dir, { recursive: true });
  const unique = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const tmpPath = path5.join(dir, `.${path5.basename(targetPath)}.tmp-${unique}`);
  if (durable) {
    const fd = fs5.openSync(tmpPath, "w");
    try {
      fs5.writeFileSync(fd, content, "utf8");
      fs5.fsyncSync(fd);
    } finally {
      fs5.closeSync(fd);
    }
  } else {
    fs5.writeFileSync(tmpPath, content, "utf8");
  }
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

// src/domains/kernel/module-manifest.ts
var OWNED_INVENTORY_CATEGORIES = Object.freeze([
  "commands",
  "skills",
  "agents",
  "hooks",
  "mcp_servers",
  "scripts"
]);

// src/domains/kernel/yaml-loader.ts
var path7 = __toESM(require("node:path"));

// src/domains/kernel/plugin-root.ts
var fs6 = __toESM(require("node:fs"));
var path6 = __toESM(require("node:path"));
var PLUGIN_ROOT_MARKER = path6.join("runtime", "guild-mcp.js");
function findPluginRoot(fromDir) {
  let dir = path6.resolve(fromDir);
  for (; ; ) {
    if (fs6.existsSync(path6.join(dir, PLUGIN_ROOT_MARKER))) return dir;
    const parent = path6.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// src/domains/kernel/yaml-loader.ts
function pluginLocalScriptsRoots() {
  const own = findPluginRoot(__dirname);
  return [
    // The package this code shipped in, whatever the bundle depth (runtime/scripts).
    ...own === null ? [] : [path7.join(own, "scripts")],
    // Source TS layout (src/domains/<id>) and the bundled agent-team hook layout
    // (hooks/agent-team/dist) both sit three levels under plugin/.
    path7.resolve(__dirname, "..", "..", "..", "scripts"),
    // Bundled hook layout (hooks/dist) and src/adapters both sit two levels under.
    path7.resolve(__dirname, "..", "..", "scripts"),
    // src/adapters/model-discovery and any deeper nesting.
    path7.resolve(__dirname, "..", "..", "..", "..", "scripts")
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
  const cwdRoot = path7.resolve(process.cwd(), "scripts");
  tried.push(cwdRoot);
  const api = tryScriptsRoot(cwdRoot);
  if (api) return api;
  throw new Error(
    `Guild needs the js-yaml package and could not resolve it. Fix: npm install --prefix <plugin-root>/scripts (roots tried: ${tried.join(", ")})`
  );
}

// src/domains/kernel/sealed-collections.ts
function regExpWritesLastIndex(re) {
  return re.global || re.sticky;
}
function freezeRegExpSafely(re) {
  if (regExpWritesLastIndex(re)) return false;
  Object.freeze(re);
  return true;
}
var SEALED_BRAND = /* @__PURE__ */ Symbol.for("guild.sealed_collection.v1");
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

// src/domains/kernel/path-containment.ts
var fs7 = __toESM(require("node:fs"));
var path8 = __toESM(require("node:path"));
var CONTAINMENT_REFUSAL_CODES = Object.freeze([
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
function isRefused(r) {
  return "code" in r;
}
function escapes(rel2) {
  return rel2 === ".." || rel2.startsWith(`..${path8.sep}`) || path8.isAbsolute(rel2);
}
function refuse(code, detail) {
  return Object.freeze({ contained: false, code, detail });
}
function hasParentSegment(p) {
  return p.split(/[\\/]/).includes("..");
}
function lstatOrNull(p) {
  try {
    return fs7.lstatSync(p);
  } catch {
    return null;
  }
}
function isWithin(child, parent) {
  const rel2 = path8.relative(parent, child);
  return rel2 === "" || !escapes(rel2);
}
function checkContained(root, target, options = {}) {
  const policy = options.policy ?? "resolve";
  let realRoot;
  try {
    realRoot = fs7.realpathSync(path8.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }
  if (hasParentSegment(target)) {
    return refuse(
      "parent-traversal",
      `refusing a path spelled with a ".." segment (${target}) \u2014 parent traversal cannot be resolved before symlinks`
    );
  }
  const abs = path8.isAbsolute(target) ? path8.resolve(target) : path8.resolve(realRoot, target);
  let probe = abs;
  let probeStat = null;
  for (; ; ) {
    probeStat = lstatOrNull(probe);
    if (probeStat !== null) break;
    const parent = path8.dirname(probe);
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
    realProbe = fs7.realpathSync(probe);
  } catch {
    return refuse(
      "dangling-symlink",
      `${probe} is a symlink that does not resolve; refusing to write through it`
    );
  }
  const rel2 = path8.relative(realRoot, realProbe);
  if (rel2 !== "" && escapes(rel2)) {
    return refuse("outside-root", `${abs} resolves outside the project root (${realProbe})`);
  }
  if (policy === "physical") {
    const parsed = path8.parse(abs);
    let walk = parsed.root;
    for (const seg of abs.slice(parsed.root.length).split(path8.sep)) {
      if (seg === "" || seg === ".") continue;
      walk = path8.join(walk, seg);
      const st = lstatOrNull(walk);
      if (st === null || !st.isSymbolicLink()) continue;
      let segReal;
      try {
        segReal = fs7.realpathSync(walk);
      } catch {
        return refuse("dangling-symlink", `${walk} is a symlink that does not resolve`);
      }
      const segRel = path8.relative(realRoot, segReal);
      const strictlyInside = segRel !== "" && !escapes(segRel);
      if (strictlyInside) {
        return refuse("physical-symlink", `refusing \u2014 symlinked path segment: ${walk}`);
      }
    }
  }
  const tail = path8.relative(probe, abs);
  const realPath = tail === "" ? realProbe : path8.join(realProbe, tail);
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
    canonRoot = fs7.realpathSync(path8.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }
  const abs = path8.isAbsolute(target) ? path8.resolve(target) : path8.resolve(canonRoot, target);
  const dir = path8.dirname(abs);
  const pre = checkContained(root, dir, { policy: options.policy });
  if (isRefused(pre)) return pre;
  try {
    fs7.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return refuse("mkdir-failed", `could not create ${dir}: ${err?.message ?? "unknown"}`);
  }
  const post = checkContained(root, abs, options);
  if (isRefused(post)) return post;
  let realDir;
  try {
    realDir = fs7.realpathSync(dir);
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

// src/domains/kernel/runtime-tree-guard.ts
var RUNTIME_SUBTREE_SEGMENTS = sealSet(
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

// src/domains/kernel/tier-bus.ts
var BUS_TIERS = frozenList(["T0", "T1", "T2"]);
var LEAD_ROLE_IDS = frozenList(["team-lead", "lead", "orchestrator"]);
var TIER_BUS_CONTRACT = deepFreeze({
  tiers: BUS_TIERS,
  upward_envelopes: { T2: "guild.handoff.v2", T1: "guild.goal_status.v1" },
  lead_roles: LEAD_ROLE_IDS,
  tier_source: "the attempt record on disk, or the run's minted binding_ref \u2014 never the payload"
});

// src/domains/state/dependency-graph-schema.ts
var DEPENDENCY_GRAPH_SCHEMA_VERSION = "guild.dependency_graph.v1";
var DEPENDENCY_GRAPH_V1_EXAMPLE = deepFreeze({
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

// src/domains/state/storage-roots.ts
var crypto2 = __toESM(require("node:crypto"));
var os = __toESM(require("node:os"));
var path9 = __toESM(require("node:path"));
var OVERRIDE_KEYS = {
  state: "GUILD_STATE_HOME",
  cache: "GUILD_CACHE_HOME",
  worktrees: "GUILD_WORKTREE_HOME",
  temp: "GUILD_TEMP_HOME"
};
var GUILD_NAMESPACE = "guild";
function platformStateRoot(platform, env, home) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    return local ? path9.join(local, "Guild", "state") : path9.join(home, "AppData", "Local", "Guild", "state");
  }
  if (platform === "darwin") {
    return path9.join(home, "Library", "Application Support", "Guild", "state");
  }
  const xdg = env.XDG_STATE_HOME;
  return xdg ? path9.join(xdg, GUILD_NAMESPACE) : path9.join(home, ".local", "state", GUILD_NAMESPACE);
}
function platformCacheRoot(platform, env, home) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    return local ? path9.join(local, "Guild", "cache") : path9.join(home, "AppData", "Local", "Guild", "cache");
  }
  if (platform === "darwin") {
    return path9.join(home, "Library", "Caches", "Guild");
  }
  const xdg = env.XDG_CACHE_HOME;
  return xdg ? path9.join(xdg, GUILD_NAMESPACE) : path9.join(home, ".cache", GUILD_NAMESPACE);
}
function guildRootId(activeRoot) {
  const abs = path9.resolve(activeRoot);
  const digest = crypto2.createHash("sha256").update(abs).digest("hex").slice(0, 12);
  const base = path9.basename(abs).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "root";
  return `${base}-${digest}`;
}
function durableGuildDir(activeRoot) {
  return path9.join(activeRoot, ".guild");
}
function resolveStorageRoots(opts) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.homedir ?? os.homedir();
  const tmp = opts.tmpdir ?? os.tmpdir();
  const activeRoot = path9.resolve(opts.activeRoot);
  const override = (key) => {
    const raw = env[OVERRIDE_KEYS[key]];
    return raw && raw.trim() ? path9.resolve(raw.trim()) : null;
  };
  const state = override("state") ?? platformStateRoot(platform, env, home);
  const cache = override("cache") ?? platformCacheRoot(platform, env, home);
  return {
    durable: durableGuildDir(activeRoot),
    state,
    cache,
    worktrees: override("worktrees") ?? path9.join(cache, "worktrees"),
    temp: override("temp") ?? path9.join(tmp, GUILD_NAMESPACE)
  };
}

// src/domains/state/guild-discovery.ts
var fs8 = __toESM(require("node:fs"));
var path10 = __toESM(require("node:path"));
function readJson(file) {
  try {
    return JSON.parse(fs8.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function resolveRepoRootPreferGit(startCwd) {
  let current = path10.resolve(startCwd);
  let firstGuildRoot = null;
  for (; ; ) {
    if (fs8.existsSync(path10.join(current, ".git"))) return current;
    const guildDir = path10.join(current, ".guild");
    if (firstGuildRoot === null && fs8.existsSync(guildDir)) {
      try {
        if (fs8.statSync(guildDir).isDirectory()) firstGuildRoot = current;
      } catch {
      }
    }
    const parent = path10.dirname(current);
    if (parent === current) return firstGuildRoot ?? resolveGuildRoot(startCwd);
    current = parent;
  }
}
function readWorkspaceMode(root) {
  const raw = readJson(path10.join(root, ".guild", "settings.json"));
  if (!raw || typeof raw !== "object") return "auto";
  const workspace = raw["workspace"];
  if (!workspace || typeof workspace !== "object") return "auto";
  const mode = workspace["mode"];
  return mode === "on" || mode === "off" || mode === "auto" ? mode : "auto";
}
function readWorkspaceManifest(root) {
  const raw = readJson(path10.join(root, ".guild", "workspace.json"));
  if (!raw || typeof raw !== "object") return null;
  const obj = raw;
  if (obj["schema_version"] !== "guild.workspace.v1") return null;
  return raw;
}
function immediateMarkedChildren(root) {
  let entries = [];
  try {
    entries = fs8.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const children = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const childRoot = path10.join(root, ent.name);
    const hasGit = fs8.existsSync(path10.join(childRoot, ".git"));
    const hasGuild = fs8.existsSync(path10.join(childRoot, ".guild"));
    if (!hasGit && !hasGuild) continue;
    children.push({
      name: ent.name,
      path: ent.name,
      kind: hasGuild ? "sub-guild" : "sub-project",
      has_wiki: fs8.existsSync(path10.join(childRoot, ".guild", "wiki")),
      has_indexes: fs8.existsSync(path10.join(childRoot, ".guild", "indexes"))
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
  const parent = path10.dirname(activeRoot);
  if (parent === activeRoot) return null;
  const activeResolved = path10.resolve(activeRoot);
  for (const entry of workspaceEntries(parent)) {
    const childRoot = path10.resolve(parent, entry.path);
    if (childRoot === activeResolved) return { root: parent, entry };
  }
  return null;
}
function canonicalMemory(activeRoot) {
  return {
    wiki: path10.join(activeRoot, ".guild", "wiki"),
    raw: path10.join(activeRoot, ".guild", "raw"),
    indexes: path10.join(activeRoot, ".guild", "indexes"),
    indexSqlite: path10.join(activeRoot, ".guild", "index.sqlite")
  };
}
function discoverGuild(startCwd) {
  const activeRoot = resolveRepoRootPreferGit(startCwd);
  const parentWorkspace = findParentWorkspace(activeRoot);
  const level = isWorkspaceRoot(activeRoot) ? "workspace" : "project";
  return {
    startCwd: path10.resolve(startCwd),
    activeRoot,
    guildDir: path10.join(activeRoot, ".guild"),
    level,
    workspaceRoot: level === "workspace" ? activeRoot : parentWorkspace?.root ?? null,
    registeredName: parentWorkspace?.entry.name ?? null,
    federationDepth: level === "workspace" ? 0 : parentWorkspace ? 1 : 0,
    canonicalMemory: canonicalMemory(activeRoot)
  };
}

// src/domains/state/index-migrate.ts
var import_node_child_process = require("node:child_process");
var fs9 = __toESM(require("node:fs"));
var path11 = __toESM(require("node:path"));
function openDatabase(dbPath) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
var CURRENT_SCHEMA_VERSION = 3;
function resolveGuildRoot2(cwd) {
  try {
    const raw = (0, import_node_child_process.execFileSync)("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const abs = path11.isAbsolute(raw) ? raw : path11.resolve(cwd, raw);
    const root = path11.dirname(abs);
    if (fs9.existsSync(root)) return root;
  } catch {
  }
  return path11.resolve(cwd);
}
var MIGRATIONS = [
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
function runMigrations(dbPath) {
  let db;
  let fromVersion = 0;
  try {
    fs9.mkdirSync(path11.dirname(dbPath), { recursive: true });
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
    dbPath = path11.join(guildRoot, ".guild", "index.sqlite");
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
if (typeof module !== "undefined" && require.main === module && /^index-migrate\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  runIndexMigrateCli();
}

// src/domains/state/storage-policy.ts
var path12 = __toESM(require("node:path"));
var NON_DURABLE_CLASSES = sealSet(
  ["runtime", "cache", "managed-resource", "temporary"],
  "NON_DURABLE_CLASSES"
);
var DURABLE_CLASSES = sealSet(
  ["canonical", "durable-record"],
  "DURABLE_CLASSES"
);
var KTD16_FROZEN_PREFIXES = deepFreeze([
  "runs",
  "analysis",
  "recommendations"
]);
function isUnderDurable(abs, guildDir) {
  const rel2 = path12.relative(path12.resolve(guildDir), path12.resolve(abs));
  return rel2 === "" || !rel2.startsWith("..") && !path12.isAbsolute(rel2);
}
var StoragePlacementError = class extends Error {
  constructor(storageClass, resolvedPath, detail) {
    super(detail);
    this.storageClass = storageClass;
    this.resolvedPath = resolvedPath;
    this.name = "StoragePlacementError";
  }
  storageClass;
  resolvedPath;
};
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
    if (path12.isAbsolute(raw) || /^[A-Za-z]:/.test(raw) || raw.startsWith("\\\\")) {
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
var DURABLE_SUBTREES = deepFreeze({
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
  sources: path12.join("knowledge", "sources"),
  initiatives: "initiatives",
  /** KTD16 freeze. */
  runs: "runs",
  artifacts: "artifacts"
});

// src/domains/state/storage-artifact-registry.ts
var STORAGE_ARTIFACT_REGISTRY = deepFreeze([
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
var BY_ID = new Map(STORAGE_ARTIFACT_REGISTRY.map((p) => [p.id, p]));

// src/domains/state/storage-fs.ts
var fs10 = __toESM(require("node:fs"));
var path13 = __toESM(require("node:path"));
function lstatSafe(p) {
  try {
    return fs10.lstatSync(p);
  } catch {
    return null;
  }
}
function readdirSafe(dir) {
  try {
    return fs10.readdirSync(dir);
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
    real = fs10.realpathSync(abs);
    realRoot = fs10.realpathSync(root);
  } catch {
    return null;
  }
  const rel2 = path13.relative(realRoot, real);
  if (rel2 === "" || rel2.startsWith("..") || path13.isAbsolute(rel2)) return null;
  return real;
}
function isContainedRealDir(abs, root) {
  return resolveContainedRealDir(abs, root) !== null;
}
function removeContainedTree(abs, root) {
  const real = resolveContainedRealDir(abs, root);
  if (!real) return null;
  fs10.rmSync(real, { recursive: true, force: true });
  return real;
}
function removeContainedEmptyDir(abs, root) {
  const real = resolveContainedRealDir(abs, root);
  if (!real) return false;
  try {
    fs10.rmdirSync(real);
    return true;
  } catch {
    return false;
  }
}

// src/domains/state/storage-layout.ts
var fs11 = __toESM(require("node:fs"));
var path14 = __toESM(require("node:path"));
var POLICY_CONFIG_FILES = Object.freeze({
  project: "config/project.json",
  workspace: "config/workspace.json"
});
function scopedPaths(guildDir, _scope, configFile) {
  const durable = (cls, ...segments) => {
    const parts = segments.filter((s) => s !== "");
    assertSafeSegments(parts);
    const abs = path14.join(guildDir, ...parts);
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
    const own = path14.join(activeRoot, ".guild", DURABLE_SUBTREES.knowledge);
    return fs11.existsSync(own) ? "hybrid" : "workspace-only";
  }
  return d.workspaceRoot ? "child" : "standalone";
}
function createGuildStorage(cwd = process.cwd(), opts = {}) {
  const activeRoot = path14.resolve(opts.activeRoot ?? discoverGuild(cwd).activeRoot);
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
    const abs = path14.join(base, ...segments);
    assertClassPlacement(cls, abs, guildDir);
    return abs;
  };
  const project = profile === "workspace-only" ? void 0 : scopedPaths(guildDir, "project", POLICY_CONFIG_FILES.project);
  const workspace = profile === "workspace-only" || profile === "hybrid" ? scopedPaths(guildDir, "workspace", POLICY_CONFIG_FILES.workspace) : void 0;
  const activeScope = project ?? workspace;
  const runtimeBase = path14.join(roots.state, "roots", rootId);
  const cacheBase = path14.join(roots.cache, "roots", rootId);
  const tempBase = path14.join(roots.temp, rootId);
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
      fs11.mkdirSync(absPath, { recursive: true });
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
      const worktreeRoot = path14.join(roots.worktrees, rootId);
      const runWorktrees = path14.join(worktreeRoot, runId);
      if (isContainedRealDir(runWorktrees, worktreeRoot)) {
        for (const lane of readdirSafe(runWorktrees)) {
          const laneDir = path14.join(runWorktrees, lane);
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

// src/domains/state/upgrade-glossary.ts
var GLOSSARY_FEEDSTOCK = `---
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

// src/domains/state/upgrade-journal.ts
var fs12 = __toESM(require("node:fs"));
var UPGRADE_JOURNAL_SCHEMA = "guild.upgrade_journal.v1";
function upgradeJournalPath(runtime) {
  return runtime("journal", "upgrade", "layout.json");
}
function loadJournal(file) {
  let text;
  try {
    text = fs12.readFileSync(file, "utf8");
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
var LOCK_STALE_MS = 15 * 60 * 1e3;

// src/domains/state/upgrade-steps.ts
var crypto3 = __toESM(require("node:crypto"));
var fs13 = __toESM(require("node:fs"));
var path15 = __toESM(require("node:path"));
var KNOWLEDGE_PREFIX = `.guild/${DURABLE_SUBTREES.knowledge}`;
var DERIVED_PATTERNS = Object.freeze([
  /^indexes(\/|$)/,
  /^index\.sqlite$/,
  /^hosts(\/|$)/,
  /^current-run-id$/,
  /^agents\/registry\.yaml$/,
  /^skills\/registry\.yaml$/,
  /^bus\/\.lock$/,
  /(^|\/)\.tmp-[^/]+$/
]);
function classifyPath(relToGuild) {
  const rel2 = relToGuild.split(path15.sep).join("/");
  return DERIVED_PATTERNS.some((re) => re.test(rel2)) ? "derived" : "durable";
}
function rel(ctx, abs) {
  return path15.relative(ctx.root, abs).split(path15.sep).join("/");
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
    return fs13.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}
function writeFile(ctx, abs, text) {
  if (ctx.dryRun) return;
  fs13.mkdirSync(path15.dirname(abs), { recursive: true });
  fs13.writeFileSync(abs, text, "utf8");
}
function sha256(text) {
  return crypto3.createHash("sha256").update(text).digest("hex");
}
function filesUnder(dir, out = []) {
  for (const name of readdirSafe(dir)) {
    const abs = path15.join(dir, name);
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
var v1Content = {
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
var settingsPolicySplit = {
  id: "settings-policy-split",
  cls: "durable",
  source: "proposal \xA721.6",
  affects: [".guild/settings.json", ".guild/config"],
  apply(ctx) {
    const legacy = readIfFile(path15.join(ctx.guildDir, "settings.json"));
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
var PINNED_KEYS = /^(host|host_id|host_family|model|model_id|model_name|models)$/;
var TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}([Tt ].*)?$/;
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
var BLOCK_SCALAR = /:\s*[|>]([0-9]?)[+-]?\s*(#.*)?$/;
var MAP_ENTRY = /^(\s*)(?:(-)(\s+))?("[^"]*"|'[^']*'|[^\s#][^:]*?):(?:(\s+)(.*))?$/;
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
  const yaml = loadYamlApi();
  let doc;
  try {
    doc = yaml.load(text);
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
    after = yaml.load(next);
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
var ktd22Strip = {
  id: "ktd22-host-identity-strip",
  cls: "durable",
  source: "KTD22 / R38",
  affects: [".guild/initiatives", ".guild/team", ".guild/teams"],
  apply(ctx) {
    if (!ctx.policy) {
      return { status: "skipped", detail: "no policy classifier injected; host/model pins left in place", paths: [] };
    }
    const cfg = ctx.policy;
    const roots = ["initiatives", "team", "teams"].map((d) => path15.join(ctx.guildDir, d));
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
var CACHE_TARGETS = Object.freeze(["indexes", "index.sqlite", "hosts"]);
var cachesOut = {
  id: "caches-out",
  cls: "safe-local",
  source: "proposal \xA721.11",
  affects: [],
  apply(ctx) {
    const removed = [];
    for (const name of CACHE_TARGETS) {
      const abs = path15.join(ctx.guildDir, name);
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
        fs13.rmSync(abs, { force: true });
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
var TERMINAL_STATUSES = Object.freeze([
  "closed",
  "complete",
  "completed",
  "done",
  "failed",
  "aborted",
  "cancelled",
  "canceled"
]);
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
var closedRunReceipts = {
  id: "closed-run-receipts",
  cls: "durable",
  source: "proposal \xA721.10",
  affects: [".guild/runs"],
  apply(ctx) {
    const runsDir = path15.join(ctx.guildDir, "runs");
    if (!isContainedRealDir(runsDir, ctx.guildDir)) {
      return { status: "skipped", detail: "no .guild/runs tree", paths: [] };
    }
    const written = [];
    let open = 0;
    for (const name of readdirSafe(runsDir)) {
      if (name.startsWith("_")) continue;
      const runDir = path15.join(runsDir, name);
      if (!isContainedRealDir(runDir, ctx.guildDir)) continue;
      const receipt = path15.join(runDir, "receipt.json");
      if (lstatSafe(receipt)) continue;
      const runYaml = readIfFile(path15.join(runDir, "run.yaml"));
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
var currentRunIdRetire = {
  id: "current-run-id-retire",
  cls: "safe-local",
  source: "proposal \xA721.10",
  affects: [],
  apply(ctx) {
    const abs = path15.join(ctx.guildDir, "current-run-id");
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
    if (!ctx.dryRun) fs13.rmSync(abs, { force: true });
    return {
      status: "completed",
      detail: `captured run binding "${captured}" and retired the singleton sentinel; V2 writers never recreate it`,
      paths: [rel(ctx, abs)]
    };
  }
};
var LEGACY_VERSION_TREE = "skill-versions";
var skillVersionsDelete = {
  id: "skill-versions-delete",
  cls: "safe-local",
  source: "proposal \xA721.12 / R60",
  affects: [],
  apply(ctx) {
    const dir = path15.join(ctx.guildDir, LEGACY_VERSION_TREE);
    if (!isContainedRealDir(dir, ctx.guildDir)) {
      return { status: "skipped", detail: `no leftover ${LEGACY_VERSION_TREE} tree`, paths: [] };
    }
    const snapshots = filesUnder(dir);
    if (snapshots.length === 0) {
      if (!ctx.dryRun) removeContainedTree(dir, ctx.guildDir);
      return { status: "completed", detail: `removed the empty ${LEGACY_VERSION_TREE} tree`, paths: [rel(ctx, dir)] };
    }
    const live = /* @__PURE__ */ new Set();
    const skillsDir = path15.join(ctx.guildDir, "skills");
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
var AUTHORED_REGISTRIES = Object.freeze(["loops/registry.yaml", "workflows/registry.yaml"]);
var DERIVED_REGISTRIES = Object.freeze(["agents/registry.yaml", "skills/registry.yaml"]);
var registryYamlRetire = {
  id: "registry-yaml-retire",
  cls: "durable",
  source: "KTD56 / R68",
  affects: [".guild/loops", ".guild/workflows", ".guild/agents/registry.yaml", ".guild/skills/registry.yaml"],
  apply(ctx) {
    const changed = [];
    for (const relPath of DERIVED_REGISTRIES) {
      const abs = path15.join(ctx.guildDir, relPath);
      if (!lstatSafe(abs)) continue;
      if (classifyPath(relPath) !== "derived") continue;
      if (!ctx.dryRun) fs13.rmSync(abs, { force: true });
      changed.push(rel(ctx, abs));
    }
    for (const relPath of AUTHORED_REGISTRIES) {
      const abs = path15.join(ctx.guildDir, relPath);
      const text = readIfFile(abs);
      if (text === null) continue;
      const target = path15.join(ctx.guildDir, "artifacts", "legacy", relPath.replace("/", "-"));
      if (lstatSafe(target)) continue;
      writeFile(ctx, target, text);
      if (!ctx.dryRun) fs13.rmSync(abs, { force: true });
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
var glossaryCreate = {
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
var UPGRADE_STEPS = deepFreeze([
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
var UPGRADE_STEP_IDS = Object.freeze(UPGRADE_STEPS.map((s) => s.id));

// src/domains/state/wiki-importance.ts
var STRUCTURAL_BASENAMES = sealSet([
  "index.md",
  "readme.md",
  "log.md",
  "query.md",
  "transfer-manifest.md"
], "STRUCTURAL_BASENAMES");

// src/domains/state/federated-query.ts
var fs14 = __toESM(require("fs"));
var path16 = __toESM(require("path"));
function federatedQuery(root, query, scope) {
  const manifestPath = path16.join(durableGuildDir(root), "workspace.json");
  if (!fs14.existsSync(manifestPath)) {
    throw new Error(`workspace.json not found at ${manifestPath}`);
  }
  const manifest = JSON.parse(fs14.readFileSync(manifestPath, "utf8"));
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
  if (!fs14.existsSync(path16.join(durableGuildDir(cwd), "workspace.json"))) {
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
if (typeof module !== "undefined" && require.main === module && /^federated-query\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  runFederatedQueryCli();
}

// src/domains/state/promote-upstream.ts
var fs15 = __toESM(require("fs"));
var path17 = __toESM(require("path"));
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
function readSubGuilds(workspaceRoot) {
  const manifestPath = path17.join(durableGuildDir(workspaceRoot), "workspace.json");
  if (!fs15.existsSync(manifestPath)) return [];
  try {
    const raw = JSON.parse(fs15.readFileSync(manifestPath, "utf8"));
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
  if (!fs15.existsSync(runsDir)) return [];
  const results = [];
  try {
    const runIds = fs15.readdirSync(runsDir);
    for (const runId of runIds) {
      const candidate = path17.join(runsDir, runId, "learn", "harvest-candidates.json");
      if (fs15.existsSync(candidate)) {
        results.push(candidate);
      }
    }
  } catch {
  }
  return results;
}
function extractFromHarvestFile(harvestPath, childName, workspaceRoot) {
  let raw;
  try {
    raw = JSON.parse(fs15.readFileSync(harvestPath, "utf8"));
  } catch {
    return [];
  }
  const sourcePath = path17.relative(workspaceRoot, harvestPath);
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
  const { workspaceRoot } = opts;
  let children;
  if (opts.child) {
    const all2 = readSubGuilds(workspaceRoot);
    const found = all2.find((sg) => sg.name === opts.child);
    children = found ? [found] : [{ name: opts.child, path: opts.child }];
  } else {
    children = readSubGuilds(workspaceRoot);
  }
  const all = [];
  for (const child of children) {
    const childDir = path17.join(workspaceRoot, child.path);
    const harvestFiles = findHarvestFiles(childDir);
    for (const hf of harvestFiles) {
      const from = extractFromHarvestFile(hf, child.name, workspaceRoot);
      all.push(...from);
    }
  }
  return all;
}
function parseArgs2(argv) {
  let workspaceRoot;
  let child;
  let runId;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--workspace-root" && argv[i + 1]) {
      workspaceRoot = argv[++i];
    } else if (arg === "--child" && argv[i + 1]) {
      child = argv[++i];
    } else if (arg === "--run-id" && argv[i + 1]) {
      runId = argv[++i];
    } else if (arg.startsWith("--workspace-root=")) {
      workspaceRoot = arg.slice("--workspace-root=".length);
    } else if (arg.startsWith("--child=")) {
      child = arg.slice("--child=".length);
    } else if (arg.startsWith("--run-id=")) {
      runId = arg.slice("--run-id=".length);
    }
  }
  return { workspaceRoot, child, runId };
}
function runPromoteUpstreamCli(argv = process.argv.slice(2)) {
  const { workspaceRoot: rootArg, child, runId: runIdArg } = parseArgs2(argv);
  const workspaceRoot = rootArg ?? process.env["GUILD_CWD"] ?? process.cwd();
  if (!fs15.existsSync(workspaceRoot) || !fs15.statSync(workspaceRoot).isDirectory()) {
    process.stderr.write(
      `[promote-upstream] ERROR: --workspace-root "${workspaceRoot}" is not a directory
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
    const candidates = collectUpstreamCandidates({ workspaceRoot, child });
    const runsBase = path17.resolve(durableGuildDir(workspaceRoot), "runs");
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
    const prepared = prepareContainedWrite(workspaceRoot, manifestPath, {
      policy: "physical"
    });
    if (isRefused(prepared)) {
      process.stderr.write(
        `[promote-upstream] ERROR: resolved run dir "${resolvedRunsDir}" escapes runs base [${prepared.code}] \u2014 ${prepared.detail}
`
      );
      process.exit(1);
    }
    const subGuilds = child ? [{ name: child, path: child }] : readSubGuilds(workspaceRoot);
    const childrenScanned = subGuilds.map((sg) => sg.name);
    const manifest = {
      schema_version: "guild.upstream_candidates.v1",
      generated_at: (/* @__PURE__ */ new Date()).toISOString(),
      workspace_root: workspaceRoot,
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
if (typeof module !== "undefined" && require.main === module && /^promote-upstream\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  runPromoteUpstreamCli();
}

// scripts/lib/capability/profile-emit.ts
var import_crypto = require("crypto");
var fs16 = __toESM(require("fs"));
var path18 = __toESM(require("path"));
var import_util4 = require("util");

// scripts/lib/capability/context-manager-contract.ts
var CONTEXT_MANAGER_TOOLS = Object.freeze([
  "Read",
  "Grep",
  "Glob",
  "Write",
  "Edit"
]);
var CONTEXT_MANAGER_WITHHELD_TOOLS = Object.freeze([
  "Bash",
  // a shell is a universal write primitive — it would void the path allowlist
  "Task",
  // spawning lanes is orchestration; this role assembles, it does not dispatch
  "WebFetch",
  // context comes from the project, not the internet
  "WebSearch"
]);
var CONTEXT_MANAGER_CAPABILITY_SCOPE = Object.freeze([
  "assemble_context_bundle",
  "summarize_for_bundle",
  "resolve_recall_query",
  "record_context_receipt",
  "emit_capability_profile"
]);
var CAPABILITY_SCOPE_SET = new Set(
  CONTEXT_MANAGER_CAPABILITY_SCOPE
);
var CONTEXT_MANAGER_FORBIDDEN_OPERATIONS = Object.freeze([
  "write_agent_definition",
  "write_skill_definition",
  "promote_knowledge",
  "register_capability",
  "approve_candidate",
  "decide_project_question",
  "advance_resolver_mode"
]);
var FORBIDDEN_OPERATION_SET = new Set(
  CONTEXT_MANAGER_FORBIDDEN_OPERATIONS
);
var CONTEXT_MANAGER_WRITE_ROOTS = Object.freeze([
  ".guild/context",
  ".guild/artifacts",
  ".guild/runs"
]);
var CONTEXT_MANAGER_FORBIDDEN_WRITE_ROOTS = Object.freeze([
  ".guild/agents",
  // may NOT write agent definitions
  ".guild/skills",
  // may NOT write skill definitions
  ".guild/wiki",
  // may NOT promote knowledge
  ".guild/knowledge",
  ".guild/memory",
  ".guild/teams",
  ".guild/initiatives",
  ".guild/settings.json",
  ".guild/guild.yaml",
  ".guild/workspace.json"
]);
var CONTEXT_MANAGER_READ_ROOTS = Object.freeze([
  ".guild",
  "docs",
  "src",
  "scripts"
]);
var CONTEXT_MANAGER_PATH_MAX_LEN = 512;
var CONTROL_CHARS2 = /[\u0000-\u001f\u007f]/;
function isCanonicalRelPath(v) {
  if (typeof v !== "string") return false;
  if (v.length === 0 || v.length > CONTEXT_MANAGER_PATH_MAX_LEN) return false;
  if (CONTROL_CHARS2.test(v)) return false;
  if (v.includes("\\")) return false;
  if (v.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(v)) return false;
  for (const seg of v.split("/")) {
    if (seg.length === 0) return false;
    if (seg === "." || seg === "..") return false;
    const stripped = seg.replace(/[. ]+$/, "");
    if (stripped === "." || stripped === "..") return false;
    if (stripped.length === 0) return false;
  }
  return true;
}
function isUnderRoot(path20, root) {
  if (path20 === root) return true;
  const p = path20.split("/");
  const r = root.split("/");
  if (p.length <= r.length) return false;
  for (let i = 0; i < r.length; i++) if (p[i] !== r[i]) return false;
  return true;
}
var CONTEXT_MANAGER_DENY_REASONS = Object.freeze([
  "malformed_path",
  "forbidden_root",
  "outside_write_roots"
]);
function classifyContextManagerWrite(relPath) {
  try {
    if (!isCanonicalRelPath(relPath)) return { allowed: false, reason: "malformed_path" };
    for (const forbidden of CONTEXT_MANAGER_FORBIDDEN_WRITE_ROOTS) {
      if (isUnderRoot(relPath, forbidden)) return { allowed: false, reason: "forbidden_root" };
    }
    for (const root of CONTEXT_MANAGER_WRITE_ROOTS) {
      if (relPath !== root && isUnderRoot(relPath, root)) return { allowed: true, root };
    }
    return { allowed: false, reason: "outside_write_roots" };
  } catch {
    return { allowed: false, reason: "malformed_path" };
  }
}

// scripts/lib/capability/profile-emit.ts
var TREE_HASH_RECIPE = 'sha256( concat( sorted( "<relpath>\\0" + (file ? sha256(bytes) : kind) + "\\n" ) ) )';
var HASHED_TREES = Object.freeze([
  ".guild/agents",
  ".guild/skills"
]);
var HASHED_REGISTRIES = Object.freeze([
  ".guild/agents/registry.yaml",
  ".guild/skills/registry.yaml"
]);
var TREE_HASH_RE2 = /^[0-9a-f]{64}$/;
var EMPTY_TREE_HASH = (0, import_crypto.createHash)("sha256").update("").digest("hex");
function sha256File(abs) {
  try {
    return (0, import_crypto.createHash)("sha256").update(fs16.readFileSync(abs)).digest("hex");
  } catch {
    return null;
  }
}
var MAX_TREE_DEPTH = 32;
function listTree(absRoot, rel2 = "", depth = 0) {
  if (depth > MAX_TREE_DEPTH) return null;
  let entries;
  try {
    entries = fs16.readdirSync(absRoot, { withFileTypes: true });
  } catch (e) {
    if (e?.code === "ENOENT") return [];
    return null;
  }
  const out = [];
  for (const e of entries) {
    const childRel = rel2 ? `${rel2}/${e.name}` : e.name;
    if (e.isSymbolicLink()) {
      out.push({ rel: childRel, kind: "symlink" });
    } else if (e.isDirectory()) {
      out.push({ rel: childRel, kind: "dir" });
      const child = listTree(path18.join(absRoot, e.name), childRel, depth + 1);
      if (child === null) return null;
      out.push(...child);
    } else if (e.isFile()) {
      out.push({ rel: childRel, kind: "file" });
    } else {
      out.push({ rel: childRel, kind: "symlink" });
    }
  }
  return out.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
}
function hashTree(projectRoot, relRoot) {
  const abs = path18.join(projectRoot, relRoot);
  try {
    const st = fs16.lstatSync(abs);
    if (st.isSymbolicLink()) return null;
    if (!st.isDirectory()) return null;
  } catch (e) {
    if (e?.code !== "ENOENT") return null;
    return EMPTY_TREE_HASH;
  }
  const entries = listTree(abs);
  if (entries === null) return null;
  if (entries.length === 0) return EMPTY_TREE_HASH;
  const h = (0, import_crypto.createHash)("sha256");
  for (const e of entries) {
    if (e.kind !== "file") {
      h.update(`${e.rel}\0${e.kind}
`);
      continue;
    }
    const fileHash = sha256File(path18.join(abs, e.rel));
    if (fileHash === null) return null;
    h.update(`${e.rel}\0${fileHash}
`);
  }
  return h.digest("hex");
}
function hashFileSet(projectRoot, relPaths) {
  const h = (0, import_crypto.createHash)("sha256");
  let any = false;
  for (const rel2 of [...relPaths].sort()) {
    const abs = path18.join(projectRoot, rel2);
    let exists;
    try {
      const st = fs16.lstatSync(abs);
      if (st.isSymbolicLink()) return null;
      exists = st.isFile();
    } catch (e) {
      if (e?.code !== "ENOENT") return null;
      exists = false;
    }
    if (!exists) continue;
    const fileHash = sha256File(abs);
    if (fileHash === null) return null;
    any = true;
    h.update(`${rel2}\0${fileHash}
`);
  }
  return any ? h.digest("hex") : EMPTY_TREE_HASH;
}
function baselineBinding(projectRoot) {
  try {
    return (0, import_crypto.createHash)("sha256").update(fs16.realpathSync(projectRoot)).digest("hex");
  } catch {
    return null;
  }
}
function snapshotTreeHashes(projectRoot) {
  const agents = hashTree(projectRoot, HASHED_TREES[0]);
  const skills = hashTree(projectRoot, HASHED_TREES[1]);
  const registries = hashFileSet(projectRoot, HASHED_REGISTRIES);
  if (agents === null || skills === null || registries === null) return null;
  return { agents, skills, registries };
}
function sameHashes(a, b) {
  return a.agents === b.agents && a.skills === b.skills && a.registries === b.registries;
}
var FEEDSTOCK_INPUTS = Object.freeze([
  Object.freeze({ name: "codebase_map", rel: ".guild/indexes/codebase-map.json" }),
  Object.freeze({ name: "knowledge_graph", rel: ".guild/indexes/knowledge-graph.json" }),
  Object.freeze({ name: "roster", rel: ".guild/agents/registry.yaml" })
]);
function snapshotFeedstock(projectRoot) {
  const absent = [];
  const hashes = {};
  for (const input of FEEDSTOCK_INPUTS) {
    const h = sha256File(path18.join(projectRoot, input.rel));
    if (h === null) absent.push(input.name);
    hashes[input.name] = h;
  }
  return {
    codebase_map_hash: hashes.codebase_map ?? null,
    knowledge_graph_hash: hashes.knowledge_graph ?? null,
    roster_hash: hashes.roster ?? null,
    absent
  };
}
function profileRelPath(runId) {
  return `.guild/runs/${runId}/capability/profile.json`;
}
var EMIT_REFUSAL_CODES = Object.freeze([
  "resolver_mode_disabled",
  "invalid_run_id",
  "invalid_project_id",
  "invalid_generated_at",
  "invalid_options",
  "invalid_baseline",
  "hash_incomplete",
  "escapes_project_root",
  "mutation_detected",
  "profile_invalid",
  "write_forbidden",
  "write_failed",
  "post_write_mutation"
]);
var RFC3339_RE2 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
var EMIT_OPTION_KEYS = [
  "projectRoot",
  "runId",
  "projectId",
  "generatedAt",
  "sourceCommit",
  "resolverMode",
  "suggestionBudget",
  "facts",
  "baselineHashes"
];
function captureEmitOptions(opts) {
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) return null;
  if (import_util4.types.isProxy(opts)) return null;
  const proto = Object.getPrototypeOf(opts);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(opts).length > 0) return null;
  for (const k of Object.getOwnPropertyNames(opts)) {
    if (!EMIT_OPTION_KEYS.includes(k)) return null;
  }
  const read = (k) => {
    const d = Object.getOwnPropertyDescriptor(opts, k);
    if (!d) return { present: false, value: void 0 };
    if (!("value" in d)) return null;
    return { present: true, value: d.value };
  };
  const fields = {};
  for (const k of EMIT_OPTION_KEYS) {
    const r = read(k);
    if (r === null) return null;
    fields[k] = r;
  }
  const projectRoot = fields.projectRoot.value;
  const runId = fields.runId.value;
  const projectId = fields.projectId.value;
  const generatedAt = fields.generatedAt.value;
  const sourceCommit = fields.sourceCommit.value;
  const resolverMode = fields.resolverMode.value;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) return null;
  if (typeof runId !== "string" || typeof projectId !== "string") return null;
  if (typeof generatedAt !== "string") return null;
  if (sourceCommit !== null && sourceCommit !== void 0 && typeof sourceCommit !== "string") {
    return null;
  }
  if (typeof resolverMode !== "string") return null;
  let budget = DEFAULT_SUGGESTION_BUDGET;
  if (fields.suggestionBudget.present && fields.suggestionBudget.value !== void 0) {
    const b = fields.suggestionBudget.value;
    if (typeof b !== "number" || !Number.isInteger(b) || b < 0) return null;
    budget = b;
  }
  return Object.freeze({
    projectRoot,
    runId,
    projectId,
    generatedAt,
    sourceCommit: sourceCommit ?? null,
    resolverMode,
    suggestionBudget: budget,
    facts: fields.facts.value,
    baselineHashes: fields.baselineHashes.value
  });
}
function isContainedRealPath(projectRoot, abs) {
  return !isRefused(checkContained(projectRoot, abs));
}
var MAX_PRIOR_PROFILE_BYTES = 256 * 1024;
function readPriorProfile(abs) {
  let st;
  try {
    st = fs16.lstatSync(abs);
  } catch (e) {
    if (e?.code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", why: "could not stat the existing profile" };
  }
  if (!st.isFile()) return { kind: "unreadable", why: "existing profile is not a regular file" };
  if (st.size > MAX_PRIOR_PROFILE_BYTES) {
    return { kind: "unreadable", why: "existing profile exceeds the size bound" };
  }
  try {
    return { kind: "bytes", bytes: fs16.readFileSync(abs) };
  } catch {
    return { kind: "unreadable", why: "existing profile could not be read" };
  }
}
function writeFileAtomicNoFollow(abs, bytes) {
  const tmp = `${abs}.tmp-${process.pid}`;
  let fd = null;
  let created = false;
  try {
    fd = fs16.openSync(
      tmp,
      fs16.constants.O_WRONLY | fs16.constants.O_CREAT | fs16.constants.O_EXCL | fs16.constants.O_NOFOLLOW,
      384
    );
    created = true;
    let off = 0;
    while (off < bytes.length) {
      const n = fs16.writeSync(fd, bytes, off, bytes.length - off);
      if (n <= 0) return false;
      off += n;
    }
    fs16.fsyncSync(fd);
    fs16.closeSync(fd);
    fd = null;
    fs16.renameSync(tmp, abs);
    created = false;
    return true;
  } catch {
    return false;
  } finally {
    try {
      if (fd !== null) fs16.closeSync(fd);
      if (created) fs16.rmSync(tmp, { force: true });
    } catch {
    }
  }
}
function resolveBaselineHashes(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (import_util4.types.isProxy(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const keys = ["agents", "skills", "registries", "bound_root", "bound_run_id"];
  const own = Object.getOwnPropertyNames(value);
  if (own.length !== keys.length) return null;
  for (const k of own) if (!keys.includes(k)) return null;
  const out = {};
  for (const k of keys) {
    const desc = Object.getOwnPropertyDescriptor(value, k);
    if (!desc || !("value" in desc)) return null;
    if (typeof desc.value !== "string") return null;
    if (k === "bound_run_id") {
      if (!isRealRunDir(desc.value)) return null;
    } else if (!TREE_HASH_RE2.test(desc.value)) {
      return null;
    }
    out[k] = desc.value;
  }
  return {
    agents: out.agents,
    skills: out.skills,
    registries: out.registries,
    bound_root: out.bound_root,
    bound_run_id: out.bound_run_id
  };
}
var PROFILE_EMITTING_MODES = Object.freeze([
  "observe",
  "shadow",
  "project-local",
  "strict"
]);
var EMITTING_MODE_SET = new Set(PROFILE_EMITTING_MODES);
var RUN_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
var ID_MAX_LEN = 128;
function isSafeId(v) {
  return typeof v === "string" && v.length > 0 && v.length <= ID_MAX_LEN && RUN_ID_RE.test(v);
}
function isSafeRunId(v) {
  return isSafeId(v) && isRealRunDir(v);
}
function emitCapabilityProfile(opts) {
  try {
    const o = captureEmitOptions(opts);
    if (o === null) {
      return {
        status: "refused",
        code: "invalid_options",
        detail: "options object is hostile or malformed (Proxy / accessor / unknown key / bad type)"
      };
    }
    if (!EMITTING_MODE_SET.has(o.resolverMode)) {
      return {
        status: "refused",
        code: "resolver_mode_disabled",
        detail: `resolver_mode "${o.resolverMode}" does not emit capability profiles`
      };
    }
    if (!isSafeRunId(o.runId)) {
      return {
        status: "refused",
        code: "invalid_run_id",
        detail: "run id is not a discoverable run-YYYYMMDD-HHMMSS-<slug>"
      };
    }
    if (!isSafeId(o.projectId)) {
      return {
        status: "refused",
        code: "invalid_project_id",
        detail: "project id is not a safe slug"
      };
    }
    if (o.generatedAt.length > 64 || !RFC3339_RE2.test(o.generatedAt)) {
      return {
        status: "refused",
        code: "invalid_generated_at",
        detail: "generated_at is not an RFC3339 timestamp"
      };
    }
    let baseline = null;
    if (o.baselineHashes !== void 0) {
      baseline = resolveBaselineHashes(o.baselineHashes);
      if (baseline === null) {
        return {
          status: "refused",
          code: "invalid_baseline",
          detail: "baselineHashes is not a bound baseline (3 tree hashes + bound_root + bound_run_id)"
        };
      }
      const binding = baselineBinding(o.projectRoot);
      if (binding === null || baseline.bound_root !== binding) {
        return {
          status: "refused",
          code: "invalid_baseline",
          detail: "baseline was captured against a different project root"
        };
      }
      if (baseline.bound_run_id !== o.runId) {
        return {
          status: "refused",
          code: "invalid_baseline",
          detail: `baseline was captured for run "${baseline.bound_run_id}", not "${o.runId}"`
        };
      }
    }
    const window = baseline === null ? "emission" : "run";
    const root = o.projectRoot;
    const before = baseline ?? snapshotTreeHashes(root);
    if (before === null) {
      return {
        status: "refused",
        code: "hash_incomplete",
        detail: "the agents/skills/registry trees could not be hashed completely"
      };
    }
    const feedstock = snapshotFeedstock(root);
    const after = snapshotTreeHashes(root);
    if (after === null) {
      return {
        status: "refused",
        code: "hash_incomplete",
        detail: "the agents/skills/registry trees could not be re-hashed completely"
      };
    }
    if (!sameHashes(before, after)) {
      return {
        status: "refused",
        code: "mutation_detected",
        detail: "agents/skills/registry tree changed during Learn \u2014 no profile emitted"
      };
    }
    const profile = {
      schema_version: PROJECT_CAPABILITY_PROFILE_SCHEMA,
      project_id: o.projectId,
      run_id: o.runId,
      generated_at: o.generatedAt,
      source_commit: o.sourceCommit,
      feedstock,
      domains: o.facts?.domains,
      boundaries: o.facts?.boundaries,
      repeated_methods: o.facts?.repeated_methods,
      coverage: o.facts?.coverage,
      candidates: o.facts?.candidates,
      resolver_mode: o.resolverMode,
      mutation_performed: false,
      mutation_window: window,
      mutation_evidence: {
        agents_tree_hash_before: before.agents,
        agents_tree_hash_after: after.agents,
        skills_tree_hash_before: before.skills,
        skills_tree_hash_after: after.skills,
        registry_hash_before: before.registries,
        registry_hash_after: after.registries
      }
    };
    const validated = validateProjectCapabilityProfileV1(profile, {
      suggestionBudget: o.suggestionBudget
    });
    if (validated === null) {
      return {
        status: "refused",
        code: "profile_invalid",
        detail: "assembled profile failed guild.project_capability_profile.v1 validation"
      };
    }
    const rel2 = profileRelPath(o.runId);
    const verdict = classifyContextManagerWrite(rel2);
    if (verdict.allowed !== true) {
      return {
        status: "refused",
        code: "write_forbidden",
        detail: `context-manager contract refused "${rel2}": ${verdict.reason}`
      };
    }
    const abs = path18.join(root, rel2);
    let prior = { kind: "absent" };
    try {
      if (!isContainedRealPath(root, path18.dirname(abs))) {
        return {
          status: "refused",
          code: "escapes_project_root",
          detail: `"${rel2}" has an ancestor that resolves outside the project root`
        };
      }
      fs16.mkdirSync(path18.dirname(abs), { recursive: true });
      if (!isContainedRealPath(root, abs)) {
        return {
          status: "refused",
          code: "escapes_project_root",
          detail: `"${rel2}" resolves outside the project root once symlinks are followed`
        };
      }
      prior = readPriorProfile(abs);
      if (prior.kind === "unreadable") {
        return {
          status: "refused",
          code: "write_failed",
          detail: `${prior.why} \u2014 refusing to overwrite what cannot be restored`
        };
      }
      if (!writeFileAtomicNoFollow(abs, Buffer.from(`${JSON.stringify(validated, null, 2)}
`, "utf8"))) {
        return { status: "refused", code: "write_failed", detail: `could not write "${rel2}"` };
      }
    } catch (e) {
      return { status: "refused", code: "write_failed", detail: String(e) };
    }
    const post = snapshotTreeHashes(root);
    if (post === null || !sameHashes(after, post)) {
      let rolledBack = false;
      if (isContainedRealPath(root, abs)) {
        try {
          if (prior.kind === "absent") {
            fs16.rmSync(abs, { force: true });
            rolledBack = true;
          } else if (prior.kind === "bytes") {
            rolledBack = writeFileAtomicNoFollow(abs, prior.bytes);
          }
        } catch {
          rolledBack = false;
        }
      }
      return {
        status: "refused",
        code: post === null ? "hash_incomplete" : "post_write_mutation",
        detail: `${post === null ? "post-write hashing was incomplete" : "profile emission itself changed a hashed tree"}${rolledBack ? " \u2014 profile rolled back" : " \u2014 ROLLBACK FAILED, the profile on disk may be stale"}`
      };
    }
    return { status: "emitted", rel_path: rel2, profile: validated, hashes: after, window };
  } catch (e) {
    return { status: "refused", code: "write_failed", detail: String(e) };
  }
}

// src/domains/config/config-defaults.ts
var DEFAULT_ESCALATION_MARKERS = Object.freeze([
  "I'm not sure",
  "unclear",
  "cannot determine",
  "I don't know",
  "ambiguous",
  "uncertain",
  "not enough information"
]);
var NON_INHERITABLE_KEYS = sealSet([
  "initiative_default",
  // OD-1: attach-to-wrong-initiative risk
  "workspace"
  // workspace.mode is root-detection-only
], "NON_INHERITABLE_KEYS");
var LOG_ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;
var SIDECAR_MAX_BYTES = 1024 * 1024;
var CAPABILITY_RESOLVER_MODES = Object.freeze([
  "legacy",
  "observe",
  "shadow",
  "project-local",
  "strict"
]);
var CAPABILITY_AUTO_CREATE_POLICIES = Object.freeze(["never", "on_approval"]);
var CAPABILITY_RESOLVER_MODE_AFTER_F7 = "observe";
var CAPABILITY_RESOLVER_MODE_DEFAULT = CAPABILITY_RESOLVER_MODE_AFTER_F7;
var DEFAULTS = deepFreeze({
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

// scripts/capability-profile.ts
var evidenceChunk = null;
function evidence() {
  if (evidenceChunk === null) {
    const candidates = [
      path19.join(__dirname, "capability-profile-evidence.js"),
      path19.join(__dirname, "lib", "capability", "capability-profile-evidence")
    ];
    const spec = candidates.find((c) => fs17.existsSync(c) || fs17.existsSync(`${c}.ts`)) ?? candidates[1];
    evidenceChunk = require(spec);
  }
  return evidenceChunk;
}
function readFlag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return { state: "absent" };
  if (i + 1 >= argv.length) return { state: "missing_value" };
  const value = argv[i + 1];
  if (value.startsWith("--")) return { state: "missing_value" };
  return { state: "value", value };
}
function flag(argv, name) {
  const r = readFlag(argv, name);
  if (r.state === "missing_value") fail("missing_value", `--${name} was given without a value`);
  return r.state === "value" ? r.value : null;
}
function parseCount(raw) {
  if (!/^(0|[1-9][0-9]{0,4})$/.test(raw)) return null;
  return Number(raw);
}
function has(argv, name) {
  return argv.includes(`--${name}`);
}
function fail(code, detail) {
  process.stderr.write(`capability-profile: ${code}: ${detail}
`);
  process.exit(1);
}
var EMPTY_FACTS = {
  domains: [],
  boundaries: [],
  repeated_methods: [],
  coverage: { covered: [], uncovered: [], unmatched_roles: [] },
  candidates: []
};
function readFacts(file) {
  if (file === null) return EMPTY_FACTS;
  let parsed;
  try {
    parsed = JSON.parse(fs17.readFileSync(file, "utf8"));
  } catch (e) {
    fail("bad_facts_file", `${file}: ${String(e)}`);
  }
  return parsed;
}
function cmdHashTree(argv) {
  const root = path19.resolve(flag(argv, "cwd") ?? process.cwd());
  const h = snapshotTreeHashes(root);
  if (h === null) fail("hash_incomplete", "the agents/skills/registry trees could not be hashed");
  if (has(argv, "json")) {
    const forRun = flag(argv, "for-run");
    const binding = baselineBinding(root);
    const payload = forRun === null || binding === null ? h : { ...h, bound_root: binding, bound_run_id: forRun };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}
`);
    return;
  }
  process.stdout.write(`recipe: ${TREE_HASH_RECIPE}
`);
  process.stdout.write(`${HASHED_TREES[0]}  ${h.agents}
`);
  process.stdout.write(`${HASHED_TREES[1]}  ${h.skills}
`);
  process.stdout.write(`${HASHED_REGISTRIES.join(" + ")}  ${h.registries}
`);
}
function cmdBaseline(argv) {
  if (has(argv, "captured-at")) fail("unknown_option", "--captured-at is forbidden; baseline capture time belongs to the lifecycle start transaction");
  const root = path19.resolve(flag(argv, "cwd") ?? process.cwd());
  const runId = flag(argv, "run-id");
  if (runId === null) fail("missing_arg", "--run-id is required");
  try {
    const baseline = evidence().captureMigrationRunBaseline({ projectRoot: root, runId });
    process.stdout.write(`${JSON.stringify({ status: "written", rel_path: `.guild/runs/${runId}/capability/run-start-baseline.json`, baseline }, null, 2)}
`);
  } catch (error) {
    fail("baseline_refused", error instanceof Error ? error.message : String(error));
  }
}
function cmdEmit(argv) {
  if (has(argv, "generated-at")) fail("unknown_option", "--generated-at is forbidden; profile emission time comes from the tool clock");
  const root = path19.resolve(flag(argv, "cwd") ?? process.cwd());
  const runId = flag(argv, "run-id");
  const projectId = flag(argv, "project-id");
  const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (runId === null) fail("missing_arg", "--run-id is required");
  if (projectId === null) fail("missing_arg", "--project-id is required");
  const modeRaw = flag(argv, "resolver-mode") ?? "observe";
  if (!CAPABILITY_RESOLVER_MODES.includes(modeRaw)) {
    fail("bad_resolver_mode", `"${modeRaw}" is not one of ${CAPABILITY_RESOLVER_MODES.join("|")}`);
  }
  const budgetRaw = flag(argv, "budget");
  const budget = budgetRaw === null ? DEFAULT_SUGGESTION_BUDGET : parseCount(budgetRaw);
  if (budget === null) fail("bad_budget", `"${budgetRaw}" is not a count`);
  const baselineFile = flag(argv, "baseline");
  let baselineHashes;
  if (baselineFile !== null) {
    try {
      const parsed = JSON.parse(fs17.readFileSync(baselineFile, "utf8"));
      const retained = evidence().validateMigrationRunBaseline(parsed);
      baselineHashes = retained ? evidence().profileBaselineFromMigrationRunBaseline(retained) : parsed;
    } catch (e) {
      fail("bad_baseline_file", `${baselineFile}: ${String(e)}`);
    }
  }
  const result = emitCapabilityProfile({
    projectRoot: root,
    runId,
    projectId,
    generatedAt,
    sourceCommit: flag(argv, "source-commit"),
    resolverMode: modeRaw,
    suggestionBudget: budget,
    facts: readFacts(flag(argv, "facts")),
    ...baselineFile === null ? {} : { baselineHashes }
  });
  if (result.status === "refused") {
    fail(result.code, result.detail);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "emitted",
        rel_path: result.rel_path,
        mutation_performed: result.profile.mutation_performed,
        mutation_window: result.profile.mutation_window,
        hashes: result.hashes,
        candidates: result.profile.candidates.length,
        feedstock_absent: result.profile.feedstock.absent
      },
      null,
      2
    )}
`
  );
}
function cmdCandidates(argv) {
  const root = path19.resolve(flag(argv, "cwd") ?? process.cwd());
  const budgetRaw = flag(argv, "budget");
  const budget = budgetRaw === null ? void 0 : parseCount(budgetRaw);
  if (budgetRaw !== null && budget === null) fail("bad_budget", `"${budgetRaw}" is not a count`);
  const surface = surfaceCapabilityCandidates(root, { suggestionBudget: budget ?? void 0 });
  const layout = layoutRow(root);
  if (has(argv, "json")) {
    process.stdout.write(`${JSON.stringify({ ...surface, storage_layout: layout }, null, 2)}
`);
    return;
  }
  process.stdout.write(`${renderLayoutRow(layout)}
`);
  process.stdout.write(`${renderCandidateSection(surface)}
`);
}
function layoutRow(root) {
  const status = detect(root);
  const row = {
    layout_version: status.version,
    layout_state: status.state,
    current_version: CURRENT_LAYOUT_VERSION,
    upgrade_state: null,
    blocked: false,
    dirty_paths: [],
    question: null
  };
  if (status.state === "absent") return row;
  try {
    const storage = createGuildStorage(root);
    const journal = loadJournal(upgradeJournalPath((...s) => storage.runtime(...s)));
    if (!journal) return row;
    row.upgrade_state = journal.state;
    row.blocked = journal.state === "blocked_dirty_durable" || journal.state === "blocked_confirm";
    row.dirty_paths = journal.dirty_paths;
    row.question = journal.entries.find((e) => e.question)?.question ?? null;
  } catch {
  }
  return row;
}
function renderLayoutRow(row) {
  const version = row.layout_version === null ? "unmarked" : String(row.layout_version);
  const head = `Storage layout: ${version} (this build: ${row.current_version}) \u2014 ${row.layout_state}`;
  if (!row.blocked) {
    return row.upgrade_state && row.upgrade_state !== "committed" ? `${head}; last upgrade ${row.upgrade_state}` : head;
  }
  const lines = [`${head}; upgrade ${row.upgrade_state} \u2014 this root is reading v1 content`];
  for (const p of row.dirty_paths) lines.push(`  dirty: ${p}`);
  if (row.question) lines.push(`  confirm: ${row.question}`);
  lines.push("  retry: guild config migrate --mode=migrate");
  return lines.join("\n");
}
function main() {
  ensureStorageLayout(process.cwd(), { detectOnly: true });
  const [, , sub, ...argv] = process.argv;
  switch (sub) {
    case "hash-tree":
      return cmdHashTree(argv);
    case "baseline":
      return cmdBaseline(argv);
    case "emit":
      return cmdEmit(argv);
    case "candidates":
      return cmdCandidates(argv);
    default:
      fail("unknown_subcommand", `expected hash-tree|baseline|emit|candidates, got "${sub ?? ""}"`);
  }
}
if (require.main === module) main();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  layoutRow,
  renderLayoutRow
});
