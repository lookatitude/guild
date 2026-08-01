#!/usr/bin/env -S npx tsx
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// lib/run-trace.ts
var fs13 = __toESM(require("fs"));
var path16 = __toESM(require("path"));

// ../src/modules/lifecycle/workflows/run-lifecycle.ts
var crypto3 = __toESM(require("crypto"));
var fsNode = __toESM(require("fs"));
var path13 = __toESM(require("path"));

// ../src/modules/config/workflows/config-defaults.ts
var DEFAULT_ESCALATION_MARKERS = [
  "I'm not sure",
  "unclear",
  "cannot determine",
  "I don't know",
  "ambiguous",
  "uncertain",
  "not enough information"
];
var NON_INHERITABLE_KEYS = /* @__PURE__ */ new Set([
  "initiative_default",
  // OD-1: attach-to-wrong-initiative risk
  "workspace"
  // workspace.mode is root-detection-only
]);
var LOG_ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;
var SIDECAR_MAX_BYTES = 1024 * 1024;
var CAPABILITY_RESOLVER_MODES = [
  "legacy",
  "observe",
  "shadow",
  "project-local",
  "strict"
];
var CAPABILITY_AUTO_CREATE_POLICIES = ["never", "on_approval"];
var CAPABILITY_RESOLVER_MODE_DEFAULT = "legacy";
var CAPABILITY_SUGGESTION_BUDGET_MIN = 0;
var CAPABILITY_SUGGESTION_BUDGET_MAX = 4;
var DEFAULTS = {
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
     * DEFAULT IS `legacy`, NOT `observe` — see CAPABILITY_RESOLVER_MODE_DEFAULT in
     * capability-config.ts for the F7 precondition governing the flip to D04's
     * intended `observe`. Never silently defaulted: an unset value resolves with
     * provenance `default`, so `config show --sources` shows it was never chosen.
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
};

// ../src/modules/host-runtime/workflows/host-capabilities-schema.ts
var UPDATE_COMMANDS = {
  marketplace_cli: "claude plugin marketplace update guild && claude plugin update guild@guild",
  self_update: "guild-run update",
  reinstall_command: "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update"
};
var CLAUDE_CAPABILITIES = {
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
var CODEX_CAPABILITIES = {
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
var NO_HOOKS = {
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
var AGENTS_FILE_CAPABILITIES = {
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

// ../src/modules/host-runtime/workflows/host-registry-schema.ts
var HOST_IDS = [
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
];
var HOST_FAMILIES = [
  "claude",
  "codex",
  "agents",
  "pi",
  "antigravity",
  "cursor",
  "copilot",
  "opencode",
  "rovo"
];
var AUTH_PROBES = [
  "codex_stored_or_env",
  "none",
  "cursor_stored",
  "gh_auth",
  "opencode_stored_or_env",
  "acli_stored"
];
var CLAUDE_ENTRY = {
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
var CODEX_ENTRY = {
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
function inferredCaps(host_kind, family, surface_kind = "cli") {
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
var AGENTS_FILE_ENTRY = {
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
var PI_ENTRY = {
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
var ANTIGRAVITY_ENTRY = {
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
var CLAUDE_APP_ENTRY = {
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
var CLAUDE_WEB_ENTRY = {
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
var CODEX_APP_ENTRY = {
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
var CLAUDE_AI_CONNECTOR_ENTRY = {
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
var CURSOR_ENTRY = {
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
var GITHUB_COPILOT_ENTRY = {
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
var OPENCODE_ENTRY = {
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
var ROVO_DEV_ENTRY = {
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
var KIRO_ENTRY = {
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
var QODER_ENTRY = {
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
var TRAE_ENTRY = {
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
var HOST_REGISTRY_ROWS = {
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
};
var HOST_ID_SET = new Set(HOST_IDS);
var FAMILY_SET = new Set(HOST_FAMILIES);
var AUTH_PROBE_SET = new Set(AUTH_PROBES);

// ../src/modules/host-runtime/workflows/host-id-namespace.ts
var HOST_ID_SET2 = new Set(HOST_IDS);
var LEGACY_HOST_ALIASES = {
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
function normalizeHostId(value) {
  const s = value.trim();
  if (HOST_ID_SET2.has(s)) return s;
  return LEGACY_HOST_ALIASES[s] ?? null;
}

// ../src/modules/host-runtime/workflows/adapter-fallback-ladders.ts
var RUNGS = ["native", "wrapped", "bridged", "emulated", "degraded"];
var ADAPTER_SURFACES = ["interaction", "session", "semantic_tool", "browser"];
var RUNG_SET = new Set(RUNGS);
var SURFACE_SET = new Set(ADAPTER_SURFACES);

// ../src/modules/host-runtime/workflows/host-profiles-validate.ts
var KNOWN_HOST_IDS = new Set(HOST_IDS);
var VALID_HOST_PROFILE_ENTRY_KEYS = /* @__PURE__ */ new Set(["models", "enabled"]);
var VALID_HOST_PROFILE_MODEL_KEYS = /* @__PURE__ */ new Set(["cheap", "mid", "powerful"]);
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

// ../src/modules/host-runtime/workflows/host-registry.ts
function deriveCapabilityRow(row) {
  return row.capabilities;
}
var DERIVED_HOST_CAPABILITY_ROWS = (() => {
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
var FAMILY_TO_ROW = (() => {
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
function resultAdapterForFamily(family) {
  return FAMILY_TO_ROW[family]?.result_adapter ?? false;
}

// ../src/modules/host-runtime/workflows/provider-detect.ts
var import_child_process = require("child_process");
var fs2 = __toESM(require("fs"));
var os = __toESM(require("os"));
var path2 = __toESM(require("path"));
var PROVIDER_REGISTRY = [
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
var KNOWN_FAMILIES = /* @__PURE__ */ new Set([
  "claude",
  "codex",
  "pi",
  "antigravity"
]);
function resolveAuthorHost(host) {
  if (host === void 0 || host === "auto" || host === "") return "claude";
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
  return { authorHost, providers };
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
      const home = process.env["CODEX_HOME"] || path2.join(os.homedir(), ".codex");
      const authFile = path2.join(home, "auth.json");
      const st = fs2.statSync(authFile);
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
  const hostsDir = path2.join(cwd, ".guild", "hosts");
  if (!fs2.existsSync(hostsDir)) return [];
  const out = /* @__PURE__ */ new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs2.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path2.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name === "capability.json") {
        try {
          const m = JSON.parse(fs2.readFileSync(full, "utf8"));
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

// ../src/modules/host-runtime/workflows/host-capability-snapshot.ts
var import_node_crypto = require("node:crypto");
var HOST_CAPABILITY_SNAPSHOT_SCHEMA = "guild.host_capability_snapshot.v1";
var HOST_CAPABILITY_SNAPSHOT_RESULT_SCHEMA = "guild.host_capability_snapshot_result.v1";
var HOST_CAPABILITY_IDS = [
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
];
var CAPABILITY_READERS = {
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
var UNKNOWN_HOST_VERSION = "unknown";
function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return value;
}
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
var DEFAULT_STORE = createHostCapabilitySnapshotStore();

// ../src/modules/host-runtime/workflows/host-event-normalizer.ts
var HOST_EVENT_NORMALIZATION_SCHEMA = "guild.host_event_normalization.v1";
var CLAUDE_NATIVE_EVENT_BINDINGS = Object.freeze([
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
var WRAPPER_NATIVE_EVENT_BINDINGS = Object.freeze([
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
var NATIVE_BINDINGS_BY_FAMILY = Object.freeze({
  claude: CLAUDE_NATIVE_EVENT_BINDINGS
});
function advertisesNativeHooks(entry) {
  return Object.values(entry.capabilities.hooks).some(Boolean);
}
var NO_SOURCE = Object.freeze({
  schema_version: HOST_EVENT_NORMALIZATION_SCHEMA,
  host_id: null,
  kind: "none",
  bindings: Object.freeze([])
});
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

// ../src/modules/host-runtime/workflows/host-adapter-boundary.ts
var HOST_ADAPTER_BOUNDARY_SCHEMA = "guild.host_adapter_boundary.v1";
var HOST_ENTRY_POINT_SCHEMA = "guild.host_entry_point.v1";
var HOST_ADAPTER_OWNERSHIP_SCHEMA = "guild.host_adapter_ownership.v1";
var HOST_ADAPTER_REASON_CODES = Object.freeze([
  "boundary_membership_mismatch",
  "capability_absent",
  "capability_snapshot_mismatch",
  "execution_failed",
  "unknown_event"
]);
var HOST_ADAPTER_OWNED_CONCERNS = [
  "host_identity_resolution",
  "host_entry_point_binding",
  "host_capability_snapshot",
  "host_native_event_normalization"
];
var HOST_ADAPTER_NOT_OWNED_CONCERNS = [
  "lifecycle_state",
  "gate_policy",
  "artifact_semantics",
  "document_rendering",
  "transport_execution"
];
var CONCERN_OWNERS = Object.freeze({
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
var OWNERSHIP = Object.freeze({
  schema_version: HOST_ADAPTER_OWNERSHIP_SCHEMA,
  boundary_version: HOST_ADAPTER_BOUNDARY_SCHEMA,
  owned: Object.freeze([...HOST_ADAPTER_OWNED_CONCERNS]),
  not_owned: Object.freeze([...HOST_ADAPTER_NOT_OWNED_CONCERNS]),
  owners: CONCERN_OWNERS
});
var DEFAULT_INSTRUCTION_FILE = "AGENTS.md";
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
var HOST_ENTRY_POINTS = Object.freeze(
  HOST_IDS.reduce(
    (accumulator, hostId) => {
      accumulator[hostId] = entryPointFor(hostId);
      return accumulator;
    },
    {}
  )
);
var BOUNDARY_STORE = createHostCapabilitySnapshotStore();

// ../src/modules/config/workflows/config-validation.ts
var MODEL_KEYS = /* @__PURE__ */ new Set([
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
var SECURITY_KEYS = /* @__PURE__ */ new Set(["bypass_permissions_policy"]);
var SECRETS_KEYS = /* @__PURE__ */ new Set([
  "env_allowlist",
  "redaction_patterns",
  "fail_mode_durable",
  "fail_mode_telemetry"
]);
var MCP_KEYS = /* @__PURE__ */ new Set([
  "tool_description_hashes",
  "stdio_available",
  "http_available",
  "bridge_package"
]);
var DEFAULT_KEYS = /* @__PURE__ */ new Set([
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
var INDEX_KEYS = /* @__PURE__ */ new Set([
  "enabled",
  "kg_node_threshold",
  "kg_size_threshold_mb",
  "links_edge_threshold",
  "runs_threshold",
  "wiki_file_threshold"
]);
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

// ../src/modules/config/workflows/settings-resolver.ts
var path12 = __toESM(require("path"));
var crypto2 = __toESM(require("crypto"));

// ../src/modules/config/workflows/settings-reader.ts
var fs9 = __toESM(require("fs"));
var path10 = __toESM(require("path"));

// ../src/modules/security/workflows/safe-object.ts
var PROTO_POISON_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);

// ../src/modules/security/workflows/scrubbed-write.ts
var fs7 = __toESM(require("node:fs"));
var path8 = __toESM(require("node:path"));
var crypto = __toESM(require("node:crypto"));

// ../src/modules/security/workflows/redact-log.ts
var TOKEN_REDACTED = "[REDACTED_TOKEN]";
var PATH_REDACTED = "[REDACTED]";
var KV_REDACTED = "[REDACTED]";
var HIGH_ENTROPY_REDACTED = "<HIGH_ENTROPY_REDACTED>";
var TRUNCATION_SUFFIX = "... [TRUNCATED]";
var FIELD_SIZE_CAP_BYTES = 4 * 1024;
var TOKEN_SHAPE_PATTERNS = [
  /Authorization:\s*Bearer\s+[A-Za-z0-9._\-+/=]+/g,
  /\bBearer\s+[A-Za-z0-9._\-+/=]{16,}/g,
  /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/g,
  /\bghp_[A-Za-z0-9]{36}\b/g,
  /\bgh[suor]_[A-Za-z0-9]{36}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{82}\b/g,
  /\bxox[bp]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
];
function redactTokenShapes(input) {
  let out = input;
  for (const re of TOKEN_SHAPE_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags), TOKEN_REDACTED);
  }
  return out;
}
var HOME_DIR_PATTERN = /(~|\/Users\/[^/\s]+|\/home\/[^/\s]+)\/(\.claude|\.codex|\.ssh|\.aws|\.gnupg)\/[^\s'"]+/g;
function redactHomeDirPaths(input) {
  return input.replace(HOME_DIR_PATTERN, (_match, root, dir) => {
    return `${root}/${dir}/${PATH_REDACTED}`;
  });
}
var KV_SECRET_PATTERN = /\b(password|token|api[_-]?key|secret|authorization|bearer)(\s*[:=]\s*)(\S+)/gi;
function redactKeyValueSecrets(input) {
  return input.replace(
    KV_SECRET_PATTERN,
    (_match, key, sep3) => `${key}${sep3}${KV_REDACTED}`
  );
}
var PATH_TOKEN_CHAR = /[A-Za-z0-9._/-]/;
var PATH_SHAPE = /^(?:\.{1,2}\/)?[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/;
var PATH_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
var MAX_PATH_TOKEN_LEN = 512;
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
var HIGH_ENTROPY_PATTERN = /[A-Za-z0-9+/=]{20,}/g;
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

// ../src/modules/security/workflows/config.ts
var fs5 = __toESM(require("node:fs"));
var path6 = __toESM(require("node:path"));

// ../src/modules/kernel/workflows/yaml-loader.ts
var path3 = __toESM(require("node:path"));
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

// ../src/modules/state/workflows/frontmatter.ts
var loadedYaml = null;
function yamlApi() {
  if (loadedYaml === null) loadedYaml = loadYamlApi();
  return loadedYaml;
}
function parseYaml(text, opts = {}) {
  try {
    const yaml2 = yamlApi();
    const value = yaml2.load(text, { schema: opts.schema ?? yaml2.JSON_SCHEMA });
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

// ../src/modules/state/workflows/guild-root.ts
var fs3 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
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

// ../src/modules/migrations/workflows/index-migrate.ts
var import_node_child_process = require("node:child_process");
var fs4 = __toESM(require("node:fs"));
var path5 = __toESM(require("node:path"));
function openDatabase(dbPath) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
var CURRENT_SCHEMA_VERSION = 3;
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
if (typeof module !== "undefined" && require.main === module && /^index-migrate\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  runIndexMigrateCli();
}

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

// ../src/modules/security/workflows/events.ts
var fs6 = __toESM(require("node:fs"));
var path7 = __toESM(require("node:path"));
var SECURITY_EVENT_SCHEMA_VERSION = "guild.security_event.v1";
var KNOWN_GUILD_HOST_KINDS = [
  "claude-code-cli",
  "codex-cli",
  "pi-cli",
  "antigravity-cli",
  "agents-file",
  "claude-code-app",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector"
];
var KNOWN_GUILD_HOST_ID_SET = new Set(KNOWN_GUILD_HOST_KINDS);
var LEGACY_HOST_ALIASES2 = {
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
    const logsDir2 = path7.join(runDir3, "logs");
    fs6.mkdirSync(logsDir2, { recursive: true });
    fs6.appendFileSync(path7.join(logsDir2, "security-events.jsonl"), JSON.stringify(record) + "\n", "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [security-events] write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}

// ../src/modules/security/workflows/scrubbed-write.ts
function guildRootFromRunDir(runDir3) {
  return path8.resolve(runDir3, "../../..");
}
function writeScrubApprovalRequest(runDir3, runId, surface, outPath, laneId) {
  try {
    const approvalDir = path8.join(runDir3, "agent-bus", "approvals");
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
      const secConfig = readSecurityConfig(guildRootFromRunDir(runDir3));
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

// ../src/modules/config/workflows/workspace-manifest.ts
var fs8 = __toESM(require("fs"));
var path9 = __toESM(require("path"));
function parseWorkspaceManifest(manifestPath) {
  let raw;
  try {
    if (!fs8.existsSync(manifestPath)) return { status: "absent" };
    raw = fs8.readFileSync(manifestPath, "utf8");
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
  let current = path9.dirname(startDir);
  const fsRoot = path9.parse(current).root;
  while (current !== fsRoot) {
    const manifestPath = path9.join(current, ".guild", "workspace.json");
    const parsed = parseWorkspaceManifest(manifestPath);
    if (parsed.status === "workspace") {
      return { rootDir: current, manifest: parsed.manifest };
    }
    if (parsed.status === "not_workspace") {
      return null;
    }
    const parent = path9.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

// ../src/modules/config/workflows/settings-reader.ts
var yaml = loadYamlApi();
var HOST_MODES = ["read_only", "ask", "accept_edits", "auto", "bypass_all"];
var DEFAULTS2 = DEFAULTS;
var VALID_TIER_HOST_KEYS = new Set(HOST_IDS);
var KNOWN_HOST_IDS2 = new Set(HOST_IDS);
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
var VALID_LOOPS = /* @__PURE__ */ new Set(["none", "spec", "plan", "implementation", "all"]);
var VALID_RIGOR = /* @__PURE__ */ new Set(["quick", "standard", "deep"]);
var VALID_REVIEW = /* @__PURE__ */ new Set(["local", "cross", "off"]);
var DISPATCH_HOST_IDS = new Set(
  HOST_IDS.filter((id) => HOST_REGISTRY_ROWS[id].dispatch_selectable === true)
);
function normalizeDispatchHostId(value) {
  const normalized = normalizeHostId(value);
  return normalized && DISPATCH_HOST_IDS.has(normalized) ? normalized : null;
}
var VALID_AGENT_MODE = /* @__PURE__ */ new Set(["team", "agent", "subagent", "auto"]);
var VALID_CACHE_TTL = /* @__PURE__ */ new Set(["1h", "5m", "off"]);
var DEFAULTS_ALLOWED_KEYS = /* @__PURE__ */ new Set([
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
var VALID_CAPABILITY_KEYS = /* @__PURE__ */ new Set([
  "resolver_mode",
  "suggestion_budget",
  "starter_roles",
  "auto_create_policy"
]);
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
      if (typeof entry !== "string") continue;
      const slug = entry.trim();
      if (slug === "" || seen.has(slug)) continue;
      seen.add(slug);
      acc.push(slug);
    }
    out.starter_roles = acc;
  }
  return out;
}
function isPlainObject3(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function deepMerge(base, overlay) {
  const result = Object.assign(/* @__PURE__ */ Object.create(null), base);
  for (const [k, v] of Object.entries(overlay)) {
    if (PROTO_POISON_KEYS.has(k)) continue;
    if (Array.isArray(v)) {
      result[k] = v;
    } else if (isPlainObject3(v) && isPlainObject3(result[k])) {
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
    if (isPlainObject3(v)) {
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
  if (!fs9.existsSync(filePath)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs9.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
  return parseSettingsFile_fromParsed(parsed);
}
function parseLocalFile(guildDir) {
  const localPath = path10.join(guildDir, "settings.local.json");
  if (!fs9.existsSync(localPath)) return {};
  let localParsed;
  try {
    localParsed = JSON.parse(fs9.readFileSync(localPath, "utf8"));
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
  if (isPlainObject3(parsed["roles"]))
    out.roles = sparseRoles(parsed["roles"]);
  if (isPlainObject3(parsed["host_profiles"]))
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
  if (isPlainObject3(parsed["workspace"])) {
    const ws = parsed["workspace"];
    const wsMode = ws["mode"];
    if (wsMode === "auto" || wsMode === "on" || wsMode === "off") {
      out.workspace = { mode: wsMode };
    }
  }
  if (isPlainObject3(parsed["models"])) {
    const rawModels = parsed["models"];
    const sparse = {};
    if (typeof rawModels["enabled"] === "boolean") sparse.enabled = rawModels["enabled"];
    if (isPlainObject3(rawModels["tiers"])) {
      const rt = rawModels["tiers"];
      const sparseTiers = {};
      for (const tier of ["cheap", "mid", "powerful"]) {
        if (isPlainObject3(rt[tier])) sparseTiers[tier] = sparseTierHostMap(rt[tier]);
      }
      sparse.tiers = sparseTiers;
    }
    if (isPlainObject3(rawModels["scoreWeights"])) sparse.scoreWeights = rawModels["scoreWeights"];
    if (isPlainObject3(rawModels["thresholds"])) sparse.thresholds = rawModels["thresholds"];
    if (typeof rawModels["advisorRounds"] === "number" && rawModels["advisorRounds"] >= 1)
      sparse.advisorRounds = Math.floor(rawModels["advisorRounds"]);
    if (Array.isArray(rawModels["escalationMarkers"])) sparse.escalationMarkers = rawModels["escalationMarkers"];
    if (typeof rawModels["recallBeforeRead"] === "boolean") sparse.recallBeforeRead = rawModels["recallBeforeRead"];
    if (typeof rawModels["recallScoreThreshold"] === "number") sparse.recallScoreThreshold = rawModels["recallScoreThreshold"];
    if (typeof rawModels["structuredOutputRequired"] === "boolean") sparse.structuredOutputRequired = rawModels["structuredOutputRequired"];
    if (isPlainObject3(rawModels["cacheTTL"])) {
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
    if (isPlainObject3(rawModels["shortOutputThreshold"])) {
      const sot = rawModels["shortOutputThreshold"];
      const sotMerged = {};
      for (const taskType of Object.keys(sot)) {
        if (!isPlainObject3(sot[taskType])) continue;
        const innerRaw = sot[taskType];
        const innerMerged = {};
        for (const tier of Object.keys(innerRaw)) {
          if (typeof innerRaw[tier] === "number") innerMerged[tier] = innerRaw[tier];
        }
        if (Object.keys(innerMerged).length > 0) sotMerged[taskType] = innerMerged;
      }
      sparse.shortOutputThreshold = sotMerged;
    }
    if (isPlainObject3(rawModels["knowledge"])) {
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
  if (isPlainObject3(parsed["security"])) {
    const rawSec = parsed["security"];
    const sparseSec = {};
    const bpp = rawSec["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") sparseSec.bypass_permissions_policy = bpp;
    out.security = sparseSec;
  }
  if (isPlainObject3(parsed["secrets_policy"])) {
    const rawSp = parsed["secrets_policy"];
    const sparseSp = {};
    if (Array.isArray(rawSp["env_allowlist"])) sparseSp.env_allowlist = rawSp["env_allowlist"];
    if (Array.isArray(rawSp["redaction_patterns"])) sparseSp.redaction_patterns = rawSp["redaction_patterns"];
    if (rawSp["fail_mode_durable"] === "closed" || rawSp["fail_mode_durable"] === "open") sparseSp.fail_mode_durable = rawSp["fail_mode_durable"];
    if (rawSp["fail_mode_telemetry"] === "open" || rawSp["fail_mode_telemetry"] === "closed") sparseSp.fail_mode_telemetry = rawSp["fail_mode_telemetry"];
    out.secrets_policy = sparseSp;
  }
  if (isPlainObject3(parsed["mcp"])) {
    const rawMcp = parsed["mcp"];
    const sparseMcp = {};
    if (isPlainObject3(rawMcp["tool_description_hashes"]))
      sparseMcp.tool_description_hashes = rawMcp["tool_description_hashes"];
    if (typeof rawMcp["stdio_available"] === "boolean") sparseMcp.stdio_available = rawMcp["stdio_available"];
    if (typeof rawMcp["http_available"] === "boolean") sparseMcp.http_available = rawMcp["http_available"];
    if (rawMcp["bridge_package"] === null || typeof rawMcp["bridge_package"] === "string")
      sparseMcp.bridge_package = rawMcp["bridge_package"];
    out.mcp = sparseMcp;
  }
  if (isPlainObject3(parsed["capability"])) {
    const rawCapability = parsed["capability"];
    const known = {};
    for (const k of Object.keys(rawCapability)) {
      if (VALID_CAPABILITY_KEYS.has(k)) known[k] = rawCapability[k];
    }
    out.capability = coerceCapability(known);
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
  if (isPlainObject3(parsed["defaults"])) {
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
  let accumulated = DEFAULTS2;
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
  const resolved = path10.resolve(candidatePath);
  const resolvedBase = path10.resolve(baseDir);
  return resolved.startsWith(resolvedBase + path10.sep);
}
function initiativeIsWorkspaceScoped(workspaceRoot, id) {
  try {
    if (!isValidInitiativeId(id)) return false;
    const registryPath = path10.join(
      workspaceRoot,
      ".guild",
      "indexes",
      "initiatives-registry.yaml"
    );
    if (fs9.existsSync(registryPath)) {
      try {
        const raw = fs9.readFileSync(registryPath, "utf8");
        const parsed = yaml.load(raw);
        if (isPlainObject3(parsed)) {
          const list = parsed["initiatives"];
          if (Array.isArray(list)) {
            for (const entry of list) {
              if (!isPlainObject3(entry)) continue;
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
    const initiativesBase = path10.join(workspaceRoot, ".guild", "initiatives");
    const activePath = path10.join(
      initiativesBase,
      "active",
      id,
      "initiative.yaml"
    );
    const archivedPath = path10.join(
      initiativesBase,
      "archived",
      id,
      "initiative.yaml"
    );
    const activeBase = path10.join(initiativesBase, "active");
    const archivedBase = path10.join(initiativesBase, "archived");
    if (!isContainedIn(activePath, activeBase) && !isContainedIn(archivedPath, archivedBase)) {
      return false;
    }
    let yamlPath = null;
    if (isContainedIn(activePath, activeBase) && fs9.existsSync(activePath)) {
      yamlPath = activePath;
    } else if (isContainedIn(archivedPath, archivedBase) && fs9.existsSync(archivedPath)) {
      yamlPath = archivedPath;
    }
    if (yamlPath !== null) {
      try {
        const raw = fs9.readFileSync(yamlPath, "utf8");
        const parsed = yaml.load(raw);
        if (isPlainObject3(parsed)) {
          const doc = parsed["initiative"];
          if (isPlainObject3(doc)) {
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
  for (const key of Object.keys(DEFAULTS2)) {
    sources[key] = "builtin";
  }
  sources["workspace.mode"] = "builtin";
  let wsSettings = {};
  let wsLocalSettings = {};
  if (ws !== null) {
    const wsGuildDir = path10.join(ws.rootDir, ".guild");
    const rawWsSettings = parseSettingsFile(path10.join(wsGuildDir, "settings.json"));
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
  const projectGuildDir = path10.join(cwd, ".guild");
  const projectSettings = parseSettingsFile(path10.join(projectGuildDir, "settings.json"));
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

// ../src/modules/telemetry/workflows/guild-trace-emit.ts
var fs10 = __toESM(require("node:fs"));
var path11 = __toESM(require("node:path"));

// ../src/modules/telemetry/workflows/guild-trace-events.ts
var GUILD_TRACE_SCHEMA_VERSIONS = [
  "guild.trace.dispatch.v1",
  "guild.trace.recall.v1",
  "guild.trace.recall_decision.v1",
  "guild.trace.config_resolution.v1",
  "guild.trace.security_decision.v1",
  "guild.trace.degradation.v1"
];
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
var DISPATCH_BACKENDS = ["agent", "tmux", "remote", "unknown"];
var RECALL_BRANCHES = ["sqlite", "file-bm25", "fs-scan", "kg-query", "structural", "combined", "empty"];
var SECURITY_OUTCOMES = ["allow", "ask", "deny", "audit", "pass-through"];
var DEGRADATION_SURFACES = ["dispatch", "recall", "config", "hook", "host-capability", "other"];
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
var LANE_OUTCOMES = ["success", "failure", "unknown"];
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
function validateGuildTraceEvent(ev) {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: "event must be a non-null object" };
  }
  const sv = ev["schema_version"];
  switch (sv) {
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
function makeConfigResolutionEvent(fields) {
  return { schema_version: "guild.trace.config_resolution.v1", ...fields };
}

// ../src/modules/telemetry/workflows/guild-trace-emit.ts
function liveLogPath(runDir3) {
  return path11.join(runDir3, "logs", "v1.4-events.jsonl");
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
    const live = liveLogPath(runDir3);
    const dir = path11.dirname(live);
    fs10.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(event) + "\n";
    fs10.appendFileSync(live, line, "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `[guild-trace-emit] WARN: could not write trace event to ${runDir3}/logs/v1.4-events.jsonl: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}

// ../src/modules/config/workflows/settings-resolver.ts
function resolveSettings2(opts) {
  const t0 = Date.now();
  const result = resolveSettings(opts);
  try {
    const { cwd, flags = {} } = opts;
    const assembled = result.config;
    const _traceRunId = process.env["GUILD_RUN_ID"] ?? "";
    const _traceRunDir = _traceRunId && cwd ? path12.join(cwd, ".guild", "runs", _traceRunId) : void 0;
    if (_traceRunDir) {
      const _fingerprint = crypto2.createHash("sha256").update(JSON.stringify(assembled)).digest("hex").slice(0, 16);
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

// ../src/modules/lifecycle/workflows/run-lifecycle.ts
function runDir(root, runId) {
  return path13.join(root, ".guild", "runs", runId);
}
function runYamlPath(root, runId) {
  return path13.join(runDir(root, runId), "run.yaml");
}
function provenancePath(root, runId) {
  return path13.join(runDir(root, runId), "provenance.json");
}
function logsDir(root, runId) {
  return path13.join(runDir(root, runId), "logs");
}
function resolvedSettingsPath(root, runId) {
  return path13.join(runDir(root, runId), "resolved-settings.json");
}
function sentinelPath(root) {
  return path13.join(root, ".guild", "runs", "current-run-id");
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
  return `run-${crypto3.randomUUID()}`;
}
function yamlScalar(v) {
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
          lines.push(`${pad}${k}: [${val.map((x) => yamlScalar(x)).join(", ")}]`);
        } else {
          lines.push(`${pad}${k}:`);
          for (const item of val) {
            if (item && typeof item === "object") {
              const entries = Object.entries(item);
              entries.forEach(([ik, iv], i) => {
                const prefix = i === 0 ? `${pad}  - ` : `${pad}    `;
                lines.push(`${prefix}${ik}: ${yamlScalar(iv)}`);
              });
            } else {
              lines.push(`${pad}  - ${yamlScalar(item)}`);
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
        lines.push(`${pad}${k}: ${yamlScalar(val)}`);
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
var CANONICAL_PHASES = ["init", "ideate", "plan", "build", "qa", "ops"];
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
      env.fs.writeFile(sentinelPath(root), runId);
      return runId;
    },
    closeRun(runId, opts) {
      const root = resolveCloseRoot(env);
      const facts = readStartFacts(env, root, runId);
      const runClass = facts.run_class;
      const now = env.now();
      const finalCheckpoint = runClass === "lightweight" ? null : opts.final_learning_checkpoint ?? null;
      const terminalTraceEvent = {
        event_id: `evt-${crypto3.randomUUID()}`,
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
        const runDir3 = path13.join(root, ".guild", "runs", runId);
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
        fsNode.mkdirSync(path13.dirname(absPath), { recursive: true });
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
function assertContained(target, base, label) {
  const resolvedTarget = path13.resolve(target);
  const resolvedBase = path13.resolve(base);
  if (!resolvedTarget.startsWith(resolvedBase + path13.sep)) {
    throw new Error(
      `[run-lifecycle] ${label}: resolved path "${resolvedTarget}" escapes runs base "${resolvedBase}"`
    );
  }
}
function realProvenanceFsSeam() {
  return {
    writeFile(absPath, contents) {
      fsNode.mkdirSync(path13.dirname(absPath), { recursive: true });
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
  const fs14 = fsSeam ?? realProvenanceFsSeam();
  const outPath = resolvedSettingsPath(cwd, runId);
  const runsBase = path13.resolve(cwd, ".guild", "runs");
  assertContained(outPath, runsBase, "writeResolvedSettingsSnapshot");
  const onDisk = {
    ...snapshot,
    resolved_at_ref: resolvedAtRef ?? runId
  };
  const serialized = JSON.stringify(onDisk, null, 2) + "\n";
  if (fs14.scrubbedWriteDurable) {
    const runDir3 = path13.join(cwd, ".guild", "runs", runId);
    const result = fs14.scrubbedWriteDurable(outPath, serialized, "config", runDir3, runId);
    if (result.blocked) {
      process.stderr.write(
        `[run-lifecycle] WARN: resolved-settings.json write BLOCKED by secret scrub (fail-CLOSED) for run ${runId}. Security event emitted.
`
      );
    }
  } else {
    fs14.writeFile(outPath, serialized);
  }
  return outPath;
}
function readRecordStatusRuns(root) {
  try {
    const { config } = resolveSettings2({ cwd: root });
    return config.record_status_runs;
  } catch {
    return true;
  }
}

// ../src/modules/capability/workflows/compatibility-usage.ts
var COMPATIBILITY_READ_REASONS = [
  "no_project_definition",
  "explicit_legacy_mode",
  "rollback",
  "mint_source",
  "shadow_comparison"
];
var BENIGN_COMPATIBILITY_READ_REASONS = [
  "mint_source",
  "shadow_comparison"
];
var DEPENDENCE_COMPATIBILITY_READ_REASONS = COMPATIBILITY_READ_REASONS.filter((r) => !BENIGN_COMPATIBILITY_READ_REASONS.includes(r));

// ../src/modules/capability/workflows/role-model-schema.ts
var ROLES = ["host", "advisory", "adversarial"];
var ROLE_STRENGTHS = ["strong", "weak"];
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
var ROLE_SET = new Set(ROLES);
var STRENGTH_SET = new Set(ROLE_STRENGTHS);
var HOST_ID_SET3 = new Set(HOST_IDS);

// ../src/modules/review/workflows/review-progress.ts
var REVIEW_PROGRESS_STATES = [
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
];
var STATE_SET = new Set(REVIEW_PROGRESS_STATES);

// ../src/modules/review/resources/scripts/lib/advisory-record.ts
var ADVISORY_RECORD_SCHEMA = "guild.advisory.v1";
var ADVISORY_BACKENDS = [
  "tmux_team",
  "host_subagents",
  "single_agent"
];
var ADVISORY_SUBSTRATES = [
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
];
var ADVISORY_CONFIDENCE = ["high", "medium", "low"];
var BACKEND_SET = new Set(ADVISORY_BACKENDS);
var CONFIDENCE_SET = new Set(ADVISORY_CONFIDENCE);
var SUBSTRATE_SET = new Set(ADVISORY_SUBSTRATES);
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
  return resolveRoles({ available: availableRegistryRows(detection) });
}

// ../src/modules/lifecycle/workflows/runstart-preflight.ts
var import_child_process2 = require("child_process");
var import_fs = require("fs");
var import_path = require("path");
function persistTmuxTeamArgv(scope = "workspace") {
  return ["set", "agent_mode", "team", "--scope", scope];
}
function runStartPreflight(opts) {
  const { cwd, flags, probe: injectedProbe } = opts;
  const probe = injectedProbe ?? defaultPreflightProbe(cwd);
  const resolved = resolveSettings2({ cwd, flags: flags ?? {} });
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
  const detection = safeProbe(
    () => detectProviders({
      cwd,
      host: config.host,
      probe: probe.providerProbe
    }),
    { authorHost: "unknown", providers: [] }
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
    snapshot
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

// emit-learning-checkpoint.ts
var fs11 = __toESM(require("fs"));
var path14 = __toESM(require("path"));

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

// ../src/modules/initiatives/workflows/initiative-activity.ts
var ACTIVITY_EVENTS = [
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
];
var SET = new Set(ACTIVITY_EVENTS);

// ../src/modules/initiatives/workflows/initiative-workitems.ts
var WORK_ITEM_TYPES = [
  "research",
  "design",
  "implementation",
  "review",
  "validation",
  "docs",
  "release",
  "cleanup"
];
var WORK_ITEM_STATUS = [
  "proposed",
  "ready",
  "in_progress",
  "blocked",
  "done",
  "deferred",
  "cancelled"
];
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
var VALID_PHASES = [
  "init",
  "ideation",
  "planning",
  "development",
  "quality",
  "operations",
  "reflection"
];
var DECISION_TARGETS = [
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
];
var ALL_NONE_DECISIONS = Object.fromEntries(
  DECISION_TARGETS.map((k) => [k, "none"])
);
var VALID_EDGE_TYPES = [
  "decided_by",
  "used_for",
  "produced",
  "touches",
  "supersedes",
  "learned_from",
  "constrains",
  "opens_question",
  "resolves"
];
var ALLOWED_NODE_PREFIXES = [
  "task:",
  "run:",
  "decision:",
  "skill:",
  "agent:",
  "feature:"
];
var FORBIDDEN_NODE_PREFIXES = [
  "wiki:",
  "file:",
  "domain:",
  "component:"
];
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
  const indexDir = path14.join(guildRoot, ".guild", "indexes");
  const indexPath = path14.join(indexDir, "knowledge-links.json");
  let existing = [];
  if (fs11.existsSync(indexPath)) {
    try {
      const raw = fs11.readFileSync(indexPath, "utf8");
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
    fs11.mkdirSync(indexDir, { recursive: true });
    fs11.writeFileSync(
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
  const reflectionsDir = path14.join(guildRoot, ".guild", "reflections");
  fs11.mkdirSync(reflectionsDir, { recursive: true });
  const reflPath = path14.join(reflectionsDir, `${runId}.md`);
  const entry = `
## Phase: ${phase} (${runId})

` + nonNone.map((k) => `- ${k}: ${decisions[k]}`).join("\n") + "\n";
  fs11.appendFileSync(reflPath, entry, "utf8");
}
function writeCheckpoint(opts) {
  assertPhase(opts.phase);
  const links = opts.knowledgeLinksBatch ?? [];
  assertEdgeTypes(links);
  assertNodePrefixes(links);
  const guildRoot = opts.guildRoot ?? process.cwd();
  const decisions = opts.decisions ?? { ...ALL_NONE_DECISIONS };
  const learningDir = path14.join(guildRoot, ".guild", "runs", opts.runId, "learning");
  fs11.mkdirSync(learningDir, { recursive: true });
  const checkpointFile = path14.join(learningDir, `${opts.phase}-${opts.runId}.yaml`);
  const reflectionsRelPath = `.guild/reflections/${opts.runId}.md`;
  const reflectionsAbsPath = path14.join(guildRoot, ".guild", "reflections", `${opts.runId}.md`);
  const observed = opts.observed ?? [];
  const yaml2 = buildYaml({
    runId: opts.runId,
    phase: opts.phase,
    evidenceRef: opts.evidenceRef,
    decisions,
    observed,
    reflectionsPath: reflectionsRelPath,
    knowledgeLinksBatch: links,
    ...opts.backstop === true ? { backstop: true } : {}
  });
  fs11.writeFileSync(checkpointFile, yaml2, "utf8");
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
      const raw = fs11.readFileSync(verdictPath, "utf8");
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
      const rawArtifacts = fs11.readFileSync(artifactsJsonPath, "utf8");
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
      const raw = fs11.readFileSync(linksPath, "utf8");
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

// lib/learning-backstop.ts
var PHASE_TOKEN_TO_CHECKPOINT = {
  // canonical lifecycle tokens (CANONICAL_PHASES, scripts/lib/run-lifecycle.ts)
  init: "init",
  ideate: "ideation",
  plan: "planning",
  build: "development",
  qa: "quality",
  ops: "operations",
  // checkpoint-native tokens (VALID_PHASES) — identity pass-through
  ideation: "ideation",
  planning: "planning",
  development: "development",
  quality: "quality",
  operations: "operations",
  reflection: "reflection"
};

// lib/heartbeat.ts
var fs12 = __toESM(require("node:fs"));
var path15 = __toESM(require("node:path"));
var DEFAULT_HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1e3;
var TIER_HEARTBEAT_TIMEOUTS_MS = {
  cheap: 18e4,
  // 3 min
  mid: 6e5,
  // 10 min — equals DEFAULT_HEARTBEAT_TIMEOUT_MS
  powerful: 12e5
  // 20 min
};
function isLaneTier(t) {
  return t === "cheap" || t === "mid" || t === "powerful";
}
function readExplicitHeartbeatTimeoutMs(cwd) {
  const settingsPath = path15.join(resolveGuildRoot(cwd), ".guild", "settings.json");
  let raw;
  try {
    raw = fs12.readFileSync(settingsPath, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const defaults = parsed["defaults"];
  if (typeof defaults !== "object" || defaults === null || Array.isArray(defaults)) {
    return null;
  }
  const val = defaults["heartbeat_timeout_ms"];
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    return val;
  }
  return null;
}
function resolveHeartbeatTimeoutMs(cwd, tier) {
  const explicit = readExplicitHeartbeatTimeoutMs(cwd);
  if (explicit !== null) return explicit;
  return TIER_HEARTBEAT_TIMEOUTS_MS[isLaneTier(tier) ? tier : "mid"];
}

// lib/handoff-v2.ts
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
function runDir2(root, runId) {
  return path16.join(root, ".guild", "runs", runId);
}
function liveLogPath2(root, runId) {
  return path16.join(runDir2(root, runId), "logs", "v1.4-events.jsonl");
}
function provenancePath2(root, runId) {
  return path16.join(runDir2(root, runId), "provenance.json");
}
function skippedFilesPath(root, runId) {
  return path16.join(runDir2(root, runId), "learn", "skipped-files.json");
}
function resolveRunIdForTrace(root, env) {
  const fromEnv = env.GUILD_RUN_ID;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  const legacy = readSentinel(path16.join(root, ".guild", "runs", "current-run-id"));
  if (legacy) return legacy;
  const b2 = readSentinel(path16.join(root, ".guild", "current-run-id"));
  if (b2) return b2;
  return null;
}
function readSentinel(p) {
  try {
    const v = fs13.readFileSync(p, "utf8").trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}
var KNOWN_HOST_KINDS = [
  "claude",
  "codex",
  "pi",
  "antigravity-2",
  "claude-code-desktop",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector"
];
function defaultResolveHost(requested) {
  const raw = (process.env["GUILD_HOST"] ?? requested ?? "").trim().toLowerCase();
  const resolved = KNOWN_HOST_KINDS.includes(raw) ? raw : "claude";
  return { requested, resolved };
}
function appendTraceLine(file, event) {
  fs13.mkdirSync(path16.dirname(file), { recursive: true });
  fs13.appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
}
function emitRunClosed(root, runId, resolveHost, opts = {}) {
  try {
    const lifecycle = createRunLifecycle(createRealEnv(root, resolveHost));
    lifecycle.closeRun(runId, {
      status: opts.status ?? "closed",
      touched: opts.touched,
      coverage: opts.coverage,
      final_learning_checkpoint: opts.final_learning_checkpoint,
      artifacts: opts.artifacts
    });
    const prov = JSON.parse(fs13.readFileSync(provenancePath2(root, runId), "utf8"));
    const pointer = prov.terminal_trace_event;
    if (!pointer || typeof pointer.event_id !== "string") {
      process.stderr.write(
        `[run-trace] WARN: provenance.json missing terminal_trace_event pointer for ${runId}
`
      );
      return;
    }
    appendTraceLine(liveLogPath2(root, runId), {
      schema_version: "guild.trace_event.v1",
      event_id: pointer.event_id,
      event_name: "run_closed",
      run_id: runId,
      at: typeof pointer.at === "string" ? pointer.at : (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    process.stderr.write(
      `[run-trace] WARN: emitRunClosed failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
var STALE_RUN_GRACE_MULTIPLIER = 3;
function newestRunActivityMs(root, runId) {
  const dir = runDir2(root, runId);
  const candidates = [
    liveLogPath2(root, runId),
    path16.join(dir, "events.ndjson"),
    path16.join(dir, "run.yaml")
  ];
  try {
    const inProgress = path16.join(dir, "in-progress");
    for (const name of fs13.readdirSync(inProgress)) {
      candidates.push(path16.join(inProgress, name));
    }
  } catch {
  }
  let newest = 0;
  for (const p of candidates) {
    try {
      newest = Math.max(newest, fs13.statSync(p).mtimeMs);
    } catch {
    }
  }
  return newest;
}
function closeStalePriorOpenRun(root, resolveHost, now = Date.now) {
  try {
    const priorId = resolveRunIdForTrace(root, {});
    if (!priorId) return;
    let runYaml;
    try {
      runYaml = fs13.readFileSync(path16.join(runDir2(root, priorId), "run.yaml"), "utf8");
    } catch {
      return;
    }
    if (!/^status:\s*open\b/m.test(runYaml)) return;
    const lastActivityMs = newestRunActivityMs(root, priorId);
    if (lastActivityMs === 0) return;
    const graceMs = resolveHeartbeatTimeoutMs(root, "powerful") * STALE_RUN_GRACE_MULTIPLIER;
    if (now() - lastActivityMs <= graceMs) return;
    emitRunClosed(root, priorId, resolveHost, { status: "closed" });
  } catch {
  }
}
function startRunOnly(root, resolveHost, opts = {}) {
  try {
    closeStalePriorOpenRun(root, resolveHost);
    const lifecycle = createRunLifecycle(createRealEnv(root, resolveHost));
    return lifecycle.startRun(buildStartRunOpts(root, opts));
  } catch (err) {
    process.stderr.write(
      `[run-trace] WARN: startRunOnly failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return null;
  }
}
function buildStartRunOpts(root, opts) {
  const runClass = opts.run_class ?? "full";
  const command = opts.command ?? "/guild:learn";
  const cwd = opts.cwd ?? root;
  const targetKind = opts.target_kind ?? "existing_guild_project";
  const tierPolicy = runClass === "lightweight" ? "n/a (read-only lightweight run)" : "default (full run)";
  const scanPolicy = runClass === "lightweight" ? "n/a (no scan)" : "default";
  const ignorePolicy = runClass === "lightweight" ? "n/a (no scan)" : "default";
  const phase = runClass === "lightweight" ? command.replace(/^\/guild:/, "") : opts.phase && isCanonicalPhase(opts.phase) ? opts.phase : null;
  return {
    command,
    arguments: {},
    cwd,
    root,
    target_kind: targetKind,
    workspace: { is_workspace: false, root },
    project: runClass === "lightweight" ? command.replace(/^\/guild:/, "") : "project",
    host_requested: process.env["GUILD_HOST"] ?? "auto",
    model_tier_policy: tierPolicy,
    ignore_policy: ignorePolicy,
    scan_policy: scanPolicy,
    initiative: opts.initiative ?? null,
    // NN#5: scalar record ONLY, never a dir
    phase,
    run_class: runClass,
    // U6: thread the resolved-settings snapshot straight through. Undefined
    // when the caller passed none (back-compat: startRun skips the write).
    snapshot: opts.snapshot
  };
}
function resolvePreflightSnapshot(cwd, probe) {
  try {
    const result = runStartPreflight({ cwd, probe });
    if (result.needsTmuxPrompt) {
      process.stderr.write(
        `[run-trace] NOTE: tmux is available and agent_mode is not "team"; using the resolved default "${result.resolved.config.agent_mode}" (no interactive tmux prompt in a non-interactive CLI context). Run \`guild:config role\` / \`config set agent_mode team\` to pin it.
`
      );
    }
    return result.snapshot;
  } catch (err) {
    process.stderr.write(
      `[run-trace] WARN: run-start preflight failed; starting the run WITHOUT a resolved-settings snapshot (degraded): ${err instanceof Error ? err.message : String(err)}
`
    );
    return void 0;
  }
}
function buildPhaseArtifacts(root, runId) {
  const artifacts = { runId };
  try {
    const hDir = path16.join(runDir2(root, runId), "handoffs");
    const blocks = [];
    const texts = [];
    for (const f of fs13.readdirSync(hDir)) {
      if (!f.endsWith(".md")) continue;
      const content = fs13.readFileSync(path16.join(hDir, f), "utf8");
      texts.push(content);
      const env = extractHandoffEnvelope(content);
      if (env && typeof env === "object") blocks.push(env);
    }
    if (blocks.length) artifacts.handoffBlocks = blocks;
    if (texts.length) artifacts.handoffTexts = texts;
  } catch {
  }
  try {
    const prov = JSON.parse(fs13.readFileSync(provenancePath2(root, runId), "utf8"));
    if (prov && typeof prov.touched === "object") artifacts.provenanceTouched = prov.touched;
  } catch {
  }
  return artifacts;
}
function emitPhaseCheckpoint(root, runId, phase) {
  try {
    const checkpointPhase = PHASE_TOKEN_TO_CHECKPOINT[phase];
    if (checkpointPhase === void 0) return;
    const checkpointFile = path16.join(
      root,
      ".guild",
      "runs",
      runId,
      "learning",
      `${checkpointPhase}-${runId}.yaml`
    );
    if (fs13.existsSync(checkpointFile)) return;
    let decisions;
    try {
      const verdict = classifyPhase(buildPhaseArtifacts(root, runId));
      decisions = verdict;
    } catch {
      decisions = void 0;
    }
    writeCheckpoint({
      runId,
      phase: checkpointPhase,
      evidenceRef: `.guild/runs/${runId}/run.yaml#phases_log`,
      guildRoot: root,
      decisions
    });
  } catch (err) {
    process.stderr.write(
      `[run-trace] WARN: emitPhaseCheckpoint(${phase}) failed (fail-open): ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
function recordPhase(root, phase, opts = {}) {
  try {
    const runId = opts.runId ?? resolveRunIdForTrace(root, opts.env ?? process.env);
    if (!runId) return null;
    const lifecycleEnv = createRealEnv(root, defaultResolveHost);
    if (!appendPhase(lifecycleEnv, root, runId, phase)) return null;
    emitPhaseCheckpoint(root, runId, phase);
    return runId;
  } catch {
    return null;
  }
}
function startAndCloseRun(root, resolveHost, opts = {}) {
  try {
    closeStalePriorOpenRun(root, resolveHost);
    const lifecycle = createRunLifecycle(createRealEnv(root, resolveHost));
    const runId = lifecycle.startRun(buildStartRunOpts(root, opts));
    emitRunClosed(root, runId, resolveHost, { status: "closed" });
    return runId;
  } catch (err) {
    process.stderr.write(
      `[run-trace] WARN: startAndCloseRun failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return null;
  }
}
function recordStatusLightweight(root, resolveHost, opts = {}) {
  if (!readRecordStatusRuns(root)) return null;
  return startAndCloseRun(root, resolveHost, {
    command: "/guild:status",
    cwd: opts.cwd,
    target_kind: opts.target_kind,
    run_class: "lightweight"
  });
}
function writeSkippedFiles(root, runId, entries) {
  const out = skippedFilesPath(root, runId);
  const body = {
    schema_version: "guild.skipped_files.v1",
    run_id: runId,
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    skipped_count: entries.length,
    skipped: entries
  };
  fs13.mkdirSync(path16.dirname(out), { recursive: true });
  fs13.writeFileSync(out, JSON.stringify(body, null, 2) + "\n", "utf8");
  return out;
}

// run-trace.ts
function flag(argv, name) {
  const prefix = `--${name}=`;
  const eqMatch = argv.find((a) => a.startsWith(prefix));
  if (eqMatch) return eqMatch.slice(prefix.length);
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : void 0;
}
async function readStdin() {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve8) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve8(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve8(""));
  });
}
var USAGE = "usage: run-trace.ts <start|status|phase|skipped> [--cwd <root>] [--run-id <id>]\n  start   --command=/guild:plan [--phase=<p>] [--run-class=full|lightweight] [--cwd <root>]\n  status  [--cwd <root>]   (alias: start --run-class=lightweight + OQ6 gate)\n  phase   --phase=<init|ideate|plan|build|qa|ops> [--run-id <id>] [--cwd <root>]\n  skipped --run-id <id>    [--cwd <root>] < entries.json\n";
async function main2() {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const cwd = flag(argv, "cwd") ?? process.env["GUILD_CWD"] ?? process.cwd();
  const root = resolveGuildRoot(cwd);
  if (sub === "start") {
    const command = flag(argv, "command") ?? "/guild:learn";
    const runClassRaw = flag(argv, "run-class");
    const runClass = runClassRaw === "lightweight" ? "lightweight" : "full";
    const initiative = flag(argv, "initiative") ?? null;
    const phase = flag(argv, "phase") ?? null;
    const snapshot = resolvePreflightSnapshot(cwd);
    const runId = runClass === "lightweight" ? startAndCloseRun(root, defaultResolveHost, {
      command,
      cwd,
      run_class: "lightweight",
      initiative,
      snapshot
    }) : startRunOnly(root, defaultResolveHost, {
      command,
      cwd,
      run_class: "full",
      initiative,
      phase,
      // T0: seed run.yaml phase: + first phases_log entry (canonical-validated downstream)
      snapshot
    });
    if (runId) process.stdout.write(runId + "\n");
    process.exit(0);
  }
  if (sub === "phase") {
    const phase = flag(argv, "phase");
    if (!phase) {
      process.stderr.write(
        "[run-trace] usage: phase --phase=<init|ideate|plan|build|qa|ops> [--run-id <id>] [--cwd <root>]\n"
      );
      process.exit(1);
    }
    const runId = flag(argv, "run-id");
    recordPhase(root, phase, runId ? { runId } : {});
    process.exit(0);
  }
  if (sub === "status") {
    const runId = recordStatusLightweight(root, defaultResolveHost, { cwd });
    if (runId) process.stdout.write(runId + "\n");
    process.exit(0);
  }
  if (sub === "skipped") {
    const runId = flag(argv, "run-id") ?? process.env["GUILD_RUN_ID"];
    if (!runId) {
      process.stderr.write("[run-trace] usage: skipped --run-id <id> [--cwd <root>] < entries.json\n");
      process.exit(1);
    }
    const raw = await readStdin();
    let entries = [];
    try {
      const parsed = JSON.parse(raw.trim() || "[]");
      if (Array.isArray(parsed)) entries = parsed;
    } catch {
      process.stderr.write("[run-trace] skipped: invalid JSON on stdin; writing empty set.\n");
    }
    const out = writeSkippedFiles(root, runId, entries);
    process.stdout.write(out + "\n");
    process.exit(0);
  }
  process.stderr.write("[run-trace] " + USAGE);
  process.exit(1);
}
main2().catch((err) => {
  process.stderr.write(
    `[run-trace] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(1);
});
