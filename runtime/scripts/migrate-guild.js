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

// scripts/dot-guild/migrate-guild.ts
var path8 = __toESM(require("path"));

// scripts/dot-guild/convert/index.ts
var path7 = __toESM(require("path"));

// scripts/dot-guild/convert/seams.ts
var fs = __toESM(require("fs"));
var crypto = __toESM(require("crypto"));
var path = __toESM(require("path"));
var yaml = require_js_yaml();
var realFs = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p) => fs.readFileSync(p, "utf8"),
  readBytes: (p) => fs.readFileSync(p),
  writeFileSync: (p, data) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data, "utf8");
  },
  writeBytes: (p, data) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  },
  mkdirSync: (p, opts) => {
    fs.mkdirSync(p, opts.recursive ? { recursive: true } : void 0);
  },
  rmFileSync: (p) => fs.rmSync(p, { force: true }),
  readdirSync: (p) => fs.readdirSync(p, { withFileTypes: true }).map((e) => ({
    name: e.name,
    isDirectory: e.isDirectory(),
    isFile: e.isFile()
  })),
  isSymlink: (p) => {
    try {
      return fs.lstatSync(p).isSymbolicLink();
    } catch {
      return false;
    }
  },
  sha256: (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")
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
function parseYaml(content) {
  try {
    const value = yaml.load(content);
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
var path2 = __toESM(require("path"));
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
function walk(fs2, dir, excludeDir, base, _depth = 0, _budget = { nodes: 0 }) {
  if (_depth > WALK_MAX_DEPTH) return [];
  if (_budget.nodes >= WALK_MAX_NODES) return [];
  if (!fs2.existsSync(dir)) return [];
  const out = [];
  let entries;
  try {
    entries = fs2.readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (_budget.nodes >= WALK_MAX_NODES) break;
    _budget.nodes += 1;
    const full = path2.join(dir, e.name);
    if (e.isDirectory) {
      if (excludeDir(e.name)) continue;
      const sub = walk(fs2, full, excludeDir, base, _depth + 1, _budget);
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
  return path2.relative(guildDir, p);
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
  const res = kind === "json" ? parseJson(content) : parseYaml(content);
  if (!res.ok) {
    pr.unparseable.push({ path: relTo(pr.guildDir, p), authoritative });
    return void 0;
  }
  return res.value;
}
function detect(fs2, guildDir) {
  const evidence = [];
  const unparseable = [];
  const pr = { fs: fs2, guildDir, evidence, unparseable };
  const addM1 = (p, marker, note) => evidence.push({ path: relTo(guildDir, p), marker, contributes: "M1", note });
  const addM2 = (p, marker, note) => evidence.push({ path: relTo(guildDir, p), marker, contributes: "M2", note });
  if (!fs2.existsSync(guildDir)) {
    return { classification: "none", m1: false, m2: false, hasUnparseable: false, evidence, unparseable };
  }
  const topFiles = walk(fs2, guildDir, (name) => isBackupDir(name), guildDir);
  if (topFiles.length === 0) {
    return { classification: "none", m1: false, m2: false, hasUnparseable: false, evidence, unparseable };
  }
  const j = (rel2) => path2.join(guildDir, rel2);
  {
    const p = j("settings.json");
    if (fs2.existsSync(p)) {
      addM2(p, "P1", "settings.json exists (v2-only file)");
      const parsed = readParsed(pr, p, "json", true);
      for (const k of v1KeysIn(parsed)) addM1(p, "P1", `v1-only key: ${k}`);
    }
  }
  {
    const p = j("settings.local.json");
    if (fs2.existsSync(p)) {
      addM2(p, "P9", "settings.local.json exists (v2-era surface \u2014 F2)");
      const parsed = readParsed(pr, p, "json", true);
      for (const k of v1KeysIn(parsed)) addM1(p, "P9", `local-only v1 key: ${k}`);
    }
  }
  {
    const p = j("config.yml");
    if (fs2.existsSync(p)) {
      addM1(p, "P2", "config.yml exists (v1-only file)");
      readParsed(pr, p, "yaml", true);
    }
  }
  {
    const p = j(path2.join("indexes", "initiatives-registry.yaml"));
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
    if (fs2.existsSync(runsDir)) {
      let runEntries;
      try {
        runEntries = fs2.readdirSync(runsDir);
      } catch {
        runEntries = [];
      }
      for (const e of runEntries) {
        if (!e.isDirectory) continue;
        const runDir = path2.join(runsDir, e.name);
        const runYaml = path2.join(runDir, "run.yaml");
        const meta = path2.join(runDir, "metadata.json");
        const hasRunYaml = fs2.existsSync(runYaml);
        if (hasRunYaml) {
          const parsed = readParsed(pr, runYaml, "yaml", true);
          const sv = svOf(parsed);
          if (sv === "guild.run.v1" || sv && SCHEMA_STAMP_RE.test(sv)) addM2(runYaml, "P5", `schema_version: ${sv}`);
          else addM2(runYaml, "P5", "run.yaml present (v2 run manifest)");
        }
        if (fs2.existsSync(meta) && !hasRunYaml) {
          addM1(meta, "P6", "metadata.json without sibling run.yaml (v1 run record)");
          readParsed(pr, meta, "json", true);
        }
      }
    }
  }
  {
    const hostsDir = j("hosts");
    if (fs2.existsSync(hostsDir)) {
      let hostEntries;
      try {
        hostEntries = fs2.readdirSync(hostsDir);
      } catch {
        hostEntries = [];
      }
      for (const e of hostEntries) {
        if (!e.isDirectory) continue;
        const cap = path2.join(hostsDir, e.name, "capability.json");
        const parsed = readParsed(pr, cap, "json", false);
        const sv = svOf(parsed);
        if (sv && (sv === "guild.host_capability.v1" || SCHEMA_STAMP_RE.test(sv))) addM2(cap, "P7", `schema_version: ${sv}`);
      }
    }
  }
  {
    const refDir = j("reflections");
    if (fs2.existsSync(refDir)) {
      let refEntries;
      try {
        refEntries = fs2.readdirSync(refDir);
      } catch {
        refEntries = [];
      }
      for (const e of refEntries) {
        if (!e.isFile || !e.name.endsWith(".md")) continue;
        const p = path2.join(refDir, e.name);
        let head = "";
        try {
          head = fs2.readFileSync(p).slice(0, P10_HEAD_BYTES);
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
      fs2,
      guildDir,
      (name) => isBackupDir(name),
      guildDir
    );
    for (const f of files) {
      const base = path2.basename(f);
      const ext = path2.extname(f).toLowerCase();
      if (isBackupDir(base) || isReportFile(base)) continue;
      if (base === "events.ndjson" || f.includes(`${path2.sep}logs${path2.sep}`) || ext === ".jsonl") continue;
      if (!P10_EXTS.has(ext)) continue;
      let head = "";
      try {
        head = fs2.readFileSync(f).slice(0, P10_HEAD_BYTES);
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
var path3 = __toESM(require("path"));
var BACKUP_PREFIX = ".backup-v1-";
var REPORT_PREFIX = ".migration-report-";
function walkExcluding(fs2, guildDir, destAbs) {
  const out = [];
  const recur = (dir) => {
    let entries;
    try {
      entries = fs2.readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path3.join(dir, e.name);
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
function claimDest(fs2, guildDir, stamp) {
  const base = path3.join(guildDir, `${BACKUP_PREFIX}${stamp}`);
  let dest = base;
  let n = 1;
  for (let attempts = 0; attempts < 64; attempts++) {
    try {
      fs2.mkdirSync(dest, { recursive: false });
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
function snapshot(fs2, clock, guildDir) {
  const dest = claimDest(fs2, guildDir, clock.stamp());
  const destAbs = dest;
  const destRel = path3.basename(dest);
  const files = walkExcluding(fs2, guildDir, destAbs);
  let mismatch;
  let copied = 0;
  for (const srcFile of files) {
    const rel2 = path3.relative(guildDir, srcFile);
    const dstFile = path3.join(dest, rel2);
    const srcHash = fs2.sha256(srcFile);
    const bytes = fs2.readBytes(srcFile);
    fs2.writeBytes(dstFile, bytes);
    const dstHash = fs2.sha256(dstFile);
    if (srcHash !== dstHash) {
      mismatch = rel2;
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
var path6 = __toESM(require("path"));

// scripts/dot-guild/convert/wiki-importance.ts
var path5 = __toESM(require("path"));

// src/modules/kernel/workflows/sealed-collections.ts
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

// src/modules/kernel/workflows/module-manifest.ts
var OWNED_INVENTORY_CATEGORIES = Object.freeze([
  "commands",
  "skills",
  "agents",
  "hooks",
  "mcp_servers",
  "scripts"
]);

// src/modules/kernel/workflows/yaml-loader.ts
var path4 = __toESM(require("node:path"));
function pluginLocalScriptsRoots() {
  return [
    // Source/runtime TS layout: src/modules/kernel/workflows -> plugin/scripts.
    path4.resolve(__dirname, "..", "..", "..", "..", "scripts"),
    // Bundled hook layout: hooks/dist -> plugin/scripts.
    path4.resolve(__dirname, "..", "..", "scripts"),
    // Bundled agent-team hook layout: hooks/agent-team/dist -> plugin/scripts.
    path4.resolve(__dirname, "..", "..", "..", "scripts")
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

// src/modules/kernel/workflows/path-containment.ts
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

// src/modules/state/workflows/frontmatter.ts
var loadedYaml = null;
function yamlApi() {
  if (loadedYaml === null) loadedYaml = loadYamlApi();
  return loadedYaml;
}
function parseYaml2(text, opts = {}) {
  try {
    const yaml2 = yamlApi();
    const value = yaml2.load(text, { schema: opts.schema ?? yaml2.JSON_SCHEMA });
    return value === void 0 ? null : value;
  } catch {
    return null;
  }
}

// scripts/lib/frontmatter.ts
var parseYaml3 = parseYaml2;

// scripts/dot-guild/convert/wiki-importance.ts
var GRADED_BY_STAMP = "guild-migrate";
var STRUCTURAL_BASENAMES = sealSet(["index.md", "readme.md", "log.md", "query.md", "transfer-manifest.md"], "STRUCTURAL_BASENAMES");
var PROVENANCE_SEGMENTS = /* @__PURE__ */ new Set(["research", "ideation", "sources"]);
var PROVENANCE_FM_VALUES = /* @__PURE__ */ new Set(["provenance", "exploratory", "research", "ideation", "source"]);
function splitFrontmatter2(content) {
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
function fmValue(fmLines, key) {
  if (!fmLines) return null;
  const doc = parseYaml3(fmLines.join("\n"));
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const v = doc[key];
  return v === void 0 || v === null ? null : String(v);
}
function isProvenance(relInWiki, fmLines) {
  const segments = relInWiki.split(path5.sep).slice(0, -1).map((s) => s.toLowerCase());
  if (segments.some((s) => PROVENANCE_SEGMENTS.has(s))) return true;
  for (const key of ["type", "category"]) {
    const v = fmValue(fmLines, key)?.toLowerCase();
    if (v && PROVENANCE_FM_VALUES.has(v)) return true;
  }
  return false;
}
function draftGrade(relInWiki, fmLines) {
  const first = relInWiki.split(path5.sep)[0].toLowerCase();
  const base = path5.basename(relInWiki).toLowerCase();
  if (first === "standards") return { grade: "high", rule: "standards/** \u2192 high" };
  if (base === "architecture-map.md" || relInWiki.toLowerCase().includes("architecture-map"))
    return { grade: "high", rule: "architecture-map \u2192 high" };
  if (first === "decisions") return { grade: "high", rule: "decisions/** \u2192 high" };
  if (fmValue(fmLines, "type")?.toLowerCase() === "decision")
    return { grade: "high", rule: "type: decision \u2192 high" };
  return { grade: "medium", rule: "default \u2192 medium" };
}
function walkWiki(fs2, wikiDir) {
  const out = [];
  const recur = (dir) => {
    let entries;
    try {
      entries = fs2.readdirSync(dir);
    } catch {
      return;
    }
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path5.join(dir, e.name);
      if (e.isDirectory) recur(full);
      else if (e.isFile && e.name.endsWith(".md")) out.push(full);
    }
  };
  recur(wikiDir);
  return out.sort();
}
function isStructural(basename5) {
  const b = basename5.toLowerCase();
  return STRUCTURAL_BASENAMES.has(b) || b.startsWith("lint-");
}
function backfillWikiImportance(fs2, guildDir, dryRun) {
  const wikiDir = path5.join(guildDir, "wiki");
  const records = [];
  if (!fs2.existsSync(wikiDir)) return records;
  for (const p of walkWiki(fs2, wikiDir)) {
    const rel2 = path5.relative(guildDir, p);
    const relInWiki = path5.relative(wikiDir, p);
    if (isStructural(path5.basename(p))) {
      records.push({ rel: rel2, action: "skipped-structural", rule: "index/README/log/lint-* \u2192 skip" });
      continue;
    }
    const content = fs2.readFileSync(p);
    const { fmLines } = splitFrontmatter2(content);
    if (fmValue(fmLines, "importance") !== null) {
      records.push({ rel: rel2, action: "skipped-already-graded", rule: "importance: present \u2192 never touch" });
      continue;
    }
    if (isProvenance(relInWiki, fmLines)) {
      records.push({
        rel: rel2,
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
        const { body } = splitFrontmatter2(content);
        next = `---
${[...fmLines, ...draftLines].join("\n")}
---
${body}`;
      }
      fs2.writeFileSync(p, next);
    }
    records.push({ rel: rel2, action: "graded", grade, rule, createdFrontmatter: fmLines === null });
  }
  return records;
}
function acceptGrades(fs2, guildDir) {
  const wikiDir = path5.join(guildDir, "wiki");
  const accepted = [];
  if (!fs2.existsSync(wikiDir)) return accepted;
  for (const p of walkWiki(fs2, wikiDir)) {
    const content = fs2.readFileSync(p);
    const { fmLines, body } = splitFrontmatter2(content);
    if (fmLines === null) continue;
    if (fmValue(fmLines, "importance_draft") !== "true") continue;
    const kept = fmLines.filter(
      (l) => !/^importance_draft\s*:/.test(l) && !/^graded_by\s*:/.test(l)
    );
    fs2.writeFileSync(p, `---
${kept.join("\n")}
---
${body}`);
    accepted.push({
      rel: path5.relative(guildDir, p),
      grade: fmValue(fmLines, "importance") ?? "(none)"
    });
  }
  return accepted;
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
function rel(guildDir, p) {
  return path6.relative(guildDir, p);
}
function readSettings(fs2, p) {
  if (!fs2.existsSync(p)) return {};
  const res = parseJson(fs2.readFileSync(p));
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
function convert(fs2, clock, guildDir, dryRun, snapshotRef) {
  const out = { artifacts: [], relocated: [], conflicts: [], removed: [], generated: [], grades: [] };
  const ctx = { fs: fs2, clock, guildDir, dryRun, snapshotRef, out };
  const j = (r) => path6.join(guildDir, r);
  const deferredRemovals = [];
  const settingsPath = j("settings.json");
  const v2Settings = readSettings(fs2, settingsPath);
  let settingsMutated = false;
  convertV2SurfaceInPlace(ctx, settingsPath, v2Settings, (mut) => {
    if (mut) settingsMutated = true;
  });
  convertSettingsLocal(ctx, j, guildDir, out);
  {
    const p = j("config.yml");
    if (fs2.existsSync(p)) {
      const res = parseYaml(fs2.readFileSync(p));
      if (!res.ok || !res.value || typeof res.value !== "object") {
        out.artifacts.push({
          rel: rel(guildDir, p),
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
          rel(guildDir, p),
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
              out.relocated.push({ source: rel(guildDir, p), key: k, value: parsed[k], reason: "unmapped" });
            if (cls.outcome.case === "C4") out.conflicts.push(cls.outcome);
          } else {
            const remainder = stripHandledLeaves(parsed[k], k, allKeys);
            if (remainder !== void 0) {
              out.relocated.push({ source: rel(guildDir, p), key: k, value: remainder, reason: "unmapped" });
              outcomes.push({ key: k, case: "C2", detail: `partial parent: unhandled sub-keys relocated (handled: ${handledChildren.join(", ")})` });
            }
          }
        }
        const anyC4 = outcomes.some((o) => o.case === "C4");
        const sourceRemovable = !anyC4;
        out.artifacts.push({
          rel: rel(guildDir, p),
          disposition: anyC4 ? "preserve+flag" : "convert",
          target: "settings.json",
          keys: outcomes,
          note: anyC4 ? "C4 conflict \u2014 config.yml kept LIVE, tree stays mixed, re-surface next open" : "converted to settings.json; removed from live (snapshot holds original)",
          removed: sourceRemovable
        });
        if (sourceRemovable) {
          if (!dryRun) deferredRemovals.push(p);
          out.removed.push(rel(guildDir, p));
        }
      }
    }
  }
  {
    const p = j("project.yaml");
    if (fs2.existsSync(p)) {
      const res = parseYaml(fs2.readFileSync(p));
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
            fs2.writeFileSync(p, serializeYaml(parsed));
          }
          out.artifacts.push({
            rel: rel(guildDir, p),
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
  out.grades = backfillWikiImportance(fs2, guildDir, dryRun);
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
    const settingsIsNew = !fs2.existsSync(settingsPath);
    fs2.writeFileSync(settingsPath, JSON.stringify(v2Settings, null, 2) + "\n");
    if (settingsIsNew) out.generated.push(rel(guildDir, settingsPath));
  }
  if (out.relocated.length > 0 && !dryRun) {
    const unmigratedPath = j(".unmigrated-v1.json");
    const isNew = !fs2.existsSync(unmigratedPath);
    let mergedEntries = [];
    if (!isNew) {
      const existing = parseJson(fs2.readFileSync(unmigratedPath));
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
    fs2.writeFileSync(unmigratedPath, doc);
    if (isNew) out.generated.push(rel(guildDir, unmigratedPath));
  }
  for (const p of deferredRemovals) {
    fs2.rmFileSync(p);
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
  const { fs: fs2, dryRun } = ctx;
  const p = j("settings.local.json");
  if (!fs2.existsSync(p)) return;
  const res = parseJson(fs2.readFileSync(p));
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
      out.relocated.push({ source: rel(guildDir, p), key: k, value, reason: "unmapped" });
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
  if (localMutated && !dryRun) fs2.writeFileSync(p, JSON.stringify(parsed, null, 2) + "\n");
  out.artifacts.push({
    rel: rel(guildDir, p),
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
      ctx.out.relocated.push({ source: rel(ctx.guildDir, p), key: k, value, reason: "unmapped" });
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
    rel: rel(ctx.guildDir, p),
    disposition: anyC4 ? "preserve+flag" : "convert",
    keys: outcomes,
    note: anyC4 ? "C4 stray-key conflict \u2014 v1 key kept LIVE in settings.json, re-surface" : "stray v1 key(s) rewritten in place to v2 form",
    removed: false
  });
}
function convertLegacyRuns(ctx) {
  const { fs: fs2, guildDir, dryRun } = ctx;
  const runsDir = path6.join(guildDir, "runs");
  if (!fs2.existsSync(runsDir)) return;
  let entries;
  try {
    entries = fs2.readdirSync(runsDir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory) continue;
    const runDir = path6.join(runsDir, e.name);
    const meta = path6.join(runDir, "metadata.json");
    const runYaml = path6.join(runDir, "run.yaml");
    if (!fs2.existsSync(meta) || fs2.existsSync(runYaml)) continue;
    const res = parseJson(fs2.readFileSync(meta));
    if (!res.ok || !res.value || typeof res.value !== "object") {
      ctx.out.artifacts.push({
        rel: rel(guildDir, meta),
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
        rel: rel(guildDir, meta),
        disposition: "preserve+flag",
        note: "insufficient fields to reconstruct a faithful run.yaml \u2014 preserved (NOT fabricated)",
        removed: false
      });
      continue;
    }
    const initiativeAttachment = m["initiative_attachment"] ?? m["initiative"] ?? null;
    const provPath = path6.join(runDir, "provenance.json");
    const provExists = fs2.existsSync(provPath);
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
        rel: rel(guildDir, meta),
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
      fs2.writeFileSync(runYaml, runDoc);
      fs2.writeFileSync(provPath, JSON.stringify(provDoc, null, 2) + "\n");
      ctx.out.generated.push(rel(guildDir, runYaml));
      ctx.out.generated.push(rel(guildDir, provPath));
      fs2.rmFileSync(meta);
    }
    ctx.out.removed.push(rel(guildDir, meta));
    ctx.out.artifacts.push({
      rel: rel(guildDir, meta),
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
  const yaml2 = require_js_yaml();
  return yaml2.dump(obj);
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
  const fs2 = opts.fs ?? realFs;
  const clock = opts.clock ?? realClock;
  const mode = opts.mode;
  const units = discoverUnits(fs2, opts.root, opts.workspace);
  const children = [];
  for (const root of units.roots) {
    try {
      children.push(processChild(fs2, clock, root, mode));
    } catch (e) {
      const guildDir = path7.join(root, ".guild");
      children.push({
        root,
        guildDir,
        detect: { classification: "none", m1: false, m2: false, hasUnparseable: false, evidence: [], unparseable: [] },
        action: "error",
        artifacts: [],
        relocated: [],
        conflicts: [],
        grades: [],
        reportPath: path7.join(guildDir, reportFileName(clock.stamp())),
        reportBody: "",
        error: e.message
      });
    }
  }
  return { children, workspace: units.workspace };
}
function validateImmediateChild(fs2, root, childRel) {
  if (path7.isAbsolute(childRel)) return null;
  const resolved = path7.resolve(root, childRel);
  const resolvedRoot = path7.resolve(root);
  if (path7.dirname(resolved) !== resolvedRoot) return null;
  const base = path7.basename(resolved);
  if (base === "." || base === "..") return null;
  if (fs2.isSymlink(resolved)) return null;
  return resolved;
}
function discoverUnits(fs2, root, forceWorkspace) {
  const rootGuild = path7.join(root, ".guild");
  const workspaceJson = path7.join(rootGuild, "workspace.json");
  if (forceWorkspace === false) {
    return { roots: [root], workspace: false };
  }
  let childRoots = [];
  let isWorkspace = forceWorkspace === true;
  if (fs2.existsSync(workspaceJson)) {
    const res = parseJson(fs2.readFileSync(workspaceJson));
    if (res.ok && res.value && typeof res.value === "object") {
      const sub = res.value["sub_guilds"];
      if (Array.isArray(sub) && sub.length > 0) {
        isWorkspace = true;
        for (const s of sub) {
          const childRel = typeof s === "string" ? s : s?.["path"];
          if (typeof childRel === "string") {
            const validated = validateImmediateChild(fs2, root, childRel);
            if (validated) childRoots.push(validated);
          }
        }
      }
    }
  }
  if (childRoots.length === 0) {
    if (fs2.existsSync(root)) {
      let entries;
      try {
        entries = fs2.readdirSync(root);
      } catch {
        entries = [];
      }
      for (const e of entries) {
        if (!e.isDirectory) continue;
        const childRoot = path7.join(root, e.name);
        if (fs2.isSymlink(childRoot)) continue;
        if (fs2.existsSync(path7.join(childRoot, ".guild")) || fs2.existsSync(path7.join(childRoot, ".git"))) {
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
function processChild(fs2, clock, root, mode) {
  const guildDir = path7.join(root, ".guild");
  const det = detect(fs2, guildDir);
  const stamp = clock.stamp();
  const reportPath = path7.join(guildDir, reportFileName(stamp));
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
      const snap2 = snapshot(fs2, clock, guildDir);
      base.snapshot = snap2;
    }
    base.reportBody = renderReport(base, mode, clock.iso());
    writeReport(fs2, base);
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
    writeReport(fs2, base);
    return base;
  }
  if (mode === "dry-run") {
    base.action = "dry-run";
    const out2 = convert(
      fs2,
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
    writeReport(fs2, base);
    return base;
  }
  base.action = "migrate";
  const snap = snapshot(fs2, clock, guildDir);
  base.snapshot = snap;
  if (!snap.verified) {
    base.error = `snapshot verify failed at ${snap.mismatch} \u2014 conversion aborted (snapshot left for inspection)`;
    base.reportBody = renderReport(base, mode, clock.iso());
    writeReport(fs2, base);
    return base;
  }
  const out = convert(
    fs2,
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
  writeReport(fs2, base);
  return base;
}
function buildRestore(destRel, removed, generated) {
  const toDelete = [...removed, ...generated];
  const rmPart = toDelete.length ? `rm -f ${toDelete.map((p) => `.guild/${p}`).join(" ")} && ` : "";
  return `${rmPart}cp -R .guild/${destRel}/. .guild/`;
}
function writeReport(fs2, child) {
  if (child.detect.classification === "none" || child.action === "v2-noop") return;
  fs2.writeFileSync(child.reportPath, child.reportBody);
}

// scripts/dot-guild/migrate-guild.ts
function main() {
  const args = process.argv.slice(2);
  const rootArg = args.find((a) => a.startsWith("--root="));
  const modeArg = args.find((a) => a.startsWith("--mode="));
  const workspace = args.includes("--workspace");
  const root = rootArg ? path8.resolve(rootArg.split("=").slice(1).join("=")) : process.cwd();
  if (args.includes("--accept-grades")) {
    const accepted = acceptGrades(realFs, path8.join(root, ".guild"));
    if (accepted.length === 0) {
      process.stdout.write(`No drafted wiki importance grades pending \u2014 nothing to accept.
`);
    } else {
      for (const a of accepted) {
        process.stdout.write(`accepted: ${a.rel} (importance: ${a.grade})
`);
      }
      process.stdout.write(`Accepted ${accepted.length} drafted grade(s) \u2014 importance_draft/graded_by stripped, grades kept.
`);
    }
    process.exit(0);
  }
  const rawMode = modeArg ? modeArg.split("=").slice(1).join("=") : "dry-run";
  if (rawMode !== "migrate" && rawMode !== "dry-run" && rawMode !== "skip") {
    process.stderr.write(`[migrate-guild] invalid --mode=${rawMode} (migrate|dry-run|skip)
`);
    process.exit(1);
  }
  const mode = rawMode;
  const result = runMigration({ root, mode, workspace: workspace ? true : void 0 });
  let exit = 0;
  for (const child of result.children) {
    const tag = result.workspace ? `[${child.root}] ` : "";
    process.stdout.write(`${tag}classification=${child.detect.classification} action=${child.action}
`);
    if (child.snapshot) {
      process.stdout.write(
        `${tag}  snapshot: ${child.snapshot.destRel} (${child.snapshot.fileCount} file(s), ${child.snapshot.verified ? "verified" : "VERIFY-FAILED"})
`
      );
    }
    for (const a of child.artifacts) {
      process.stdout.write(`${tag}  ${a.disposition}: ${a.rel}${a.target ? ` \u2192 ${a.target}` : ""}
`);
    }
    if (child.relocated.length)
      process.stdout.write(`${tag}  relocated ${child.relocated.length} key(s) \u2192 .unmigrated-v1.json
`);
    if (child.conflicts.length)
      process.stdout.write(`${tag}  CONFLICTS (C4, kept LIVE): ${child.conflicts.map((c) => c.key).join(", ")}
`);
    {
      const graded = child.grades.filter((g) => g.action === "graded");
      if (graded.length)
        process.stdout.write(
          `${tag}  drafted ${graded.length} wiki importance grade(s) \u2014 review the report table, then: --accept-grades
`
        );
    }
    if (child.restoreCommand) process.stdout.write(`${tag}  restore: ${child.restoreCommand}
`);
    if (child.action !== "none" && child.action !== "v2-noop")
      process.stdout.write(`${tag}  report: ${child.reportPath}
`);
    if (child.error) {
      process.stderr.write(`${tag}  ERROR: ${child.error}
`);
      exit = 1;
    }
  }
  if (result.children.every((c) => c.detect.classification === "none")) {
    process.stdout.write(`No .guild/ artifacts found \u2014 nothing to migrate.
`);
  }
  process.exit(exit);
}
main();
