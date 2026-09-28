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

// hooks/node_modules/js-yaml/lib/schema.js
var require_schema = __commonJS({
  "hooks/node_modules/js-yaml/lib/schema.js"(exports2, module2) {
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

// hooks/node_modules/js-yaml/lib/type/pairs.js
var require_pairs = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/pairs.js"(exports2, module2) {
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

// hooks/node_modules/js-yaml/lib/type/set.js
var require_set = __commonJS({
  "hooks/node_modules/js-yaml/lib/type/set.js"(exports2, module2) {
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

// hooks/detect-guild-version.ts
var path20 = __toESM(require("node:path"));
var fs16 = __toESM(require("node:fs"));

// hooks/lib/guild-root.ts
var fs13 = __toESM(require("node:fs"));
var path16 = __toESM(require("node:path"));

// src/domains/state/atomic-write.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var crypto = __toESM(require("crypto"));

// src/domains/state/plugin-install-guard.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function assertNotUnderPluginInstall(absPath, pluginInstallRoot) {
  const root = pluginInstallRoot ?? process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"] ?? process.env["CODEX_PLUGIN_ROOT"];
  if (!root) return;
  const resolvedRoot = path.resolve(root);
  const rel2 = path.relative(resolvedRoot, path.resolve(absPath));
  if (rel2 === "" || !rel2.startsWith("..") && !path.isAbsolute(rel2)) {
    const underOwnDotGuild = rel2 === ".guild" || rel2.startsWith(`.guild${path.sep}`);
    if (underOwnDotGuild && fs.existsSync(path.join(resolvedRoot, ".git"))) return;
    throw new Error(`project-created Guild artifact would be written under plugin install dir: ${absPath}`);
  }
}

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
var path4 = __toESM(require("node:path"));

// src/domains/kernel/plugin-root.ts
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
var PLUGIN_ROOT_MARKER = path3.join("runtime", "guild-mcp.js");
function findPluginRoot(fromDir) {
  let dir = path3.resolve(fromDir);
  for (; ; ) {
    if (fs3.existsSync(path3.join(dir, PLUGIN_ROOT_MARKER))) return dir;
    const parent = path3.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

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

// src/domains/kernel/path-containment.ts
var fs4 = __toESM(require("node:fs"));
var path5 = __toESM(require("node:path"));
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
  return rel2 === ".." || rel2.startsWith(`..${path5.sep}`) || path5.isAbsolute(rel2);
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
  const rel2 = path5.relative(parent, child);
  return rel2 === "" || !escapes(rel2);
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
  const rel2 = path5.relative(realRoot, realProbe);
  if (rel2 !== "" && escapes(rel2)) {
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
var path6 = __toESM(require("node:path"));
function durableGuildDir(activeRoot) {
  return path6.join(activeRoot, ".guild");
}

// src/domains/state/guild-root.ts
var fs5 = __toESM(require("node:fs"));
var path7 = __toESM(require("node:path"));
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

// src/domains/state/index-migrate.ts
var import_node_child_process = require("node:child_process");
var fs6 = __toESM(require("node:fs"));
var path8 = __toESM(require("node:path"));
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
    const abs = path8.isAbsolute(raw) ? raw : path8.resolve(cwd, raw);
    const root = path8.dirname(abs);
    if (fs6.existsSync(root)) return root;
  } catch {
  }
  return path8.resolve(cwd);
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
    const guildRoot = resolveGuildRoot2(cwd);
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
if (typeof module !== "undefined" && require.main === module && /^index-migrate\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  runIndexMigrateCli();
}

// src/domains/state/storage-policy.ts
var path9 = __toESM(require("node:path"));
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
  sources: path9.join("knowledge", "sources"),
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
var fs7 = __toESM(require("node:fs"));
var path10 = __toESM(require("node:path"));
function lstatSafe(p) {
  try {
    return fs7.lstatSync(p);
  } catch {
    return null;
  }
}
function readdirSafe(dir) {
  try {
    return fs7.readdirSync(dir);
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
    real = fs7.realpathSync(abs);
    realRoot = fs7.realpathSync(root);
  } catch {
    return null;
  }
  const rel2 = path10.relative(realRoot, real);
  if (rel2 === "" || rel2.startsWith("..") || path10.isAbsolute(rel2)) return null;
  return real;
}
function isContainedRealDir(abs, root) {
  return resolveContainedRealDir(abs, root) !== null;
}
function removeContainedTree(abs, root) {
  const real = resolveContainedRealDir(abs, root);
  if (!real) return null;
  fs7.rmSync(real, { recursive: true, force: true });
  return real;
}

// src/domains/state/storage-layout.ts
var POLICY_CONFIG_FILES = Object.freeze({
  project: "config/project.json",
  workspace: "config/workspace.json"
});

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
var LOCK_STALE_MS = 15 * 60 * 1e3;

// src/domains/state/upgrade-steps.ts
var crypto2 = __toESM(require("node:crypto"));
var fs8 = __toESM(require("node:fs"));
var path11 = __toESM(require("node:path"));
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
  const rel2 = relToGuild.split(path11.sep).join("/");
  return DERIVED_PATTERNS.some((re) => re.test(rel2)) ? "derived" : "durable";
}
function rel(ctx, abs) {
  return path11.relative(ctx.root, abs).split(path11.sep).join("/");
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
    return fs8.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}
function writeFile(ctx, abs, text) {
  if (ctx.dryRun) return;
  fs8.mkdirSync(path11.dirname(abs), { recursive: true });
  fs8.writeFileSync(abs, text, "utf8");
}
function sha256(text) {
  return crypto2.createHash("sha256").update(text).digest("hex");
}
function filesUnder(dir, out = []) {
  for (const name of readdirSafe(dir)) {
    const abs = path11.join(dir, name);
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
    const legacy = readIfFile(path11.join(ctx.guildDir, "settings.json"));
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
    const roots = ["initiatives", "team", "teams"].map((d) => path11.join(ctx.guildDir, d));
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
      const abs = path11.join(ctx.guildDir, name);
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
        fs8.rmSync(abs, { force: true });
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
    const runsDir = path11.join(ctx.guildDir, "runs");
    if (!isContainedRealDir(runsDir, ctx.guildDir)) {
      return { status: "skipped", detail: "no .guild/runs tree", paths: [] };
    }
    const written = [];
    let open = 0;
    for (const name of readdirSafe(runsDir)) {
      if (name.startsWith("_")) continue;
      const runDir = path11.join(runsDir, name);
      if (!isContainedRealDir(runDir, ctx.guildDir)) continue;
      const receipt = path11.join(runDir, "receipt.json");
      if (lstatSafe(receipt)) continue;
      const runYaml = readIfFile(path11.join(runDir, "run.yaml"));
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
    const abs = path11.join(ctx.guildDir, "current-run-id");
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
    if (!ctx.dryRun) fs8.rmSync(abs, { force: true });
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
    const dir = path11.join(ctx.guildDir, LEGACY_VERSION_TREE);
    if (!isContainedRealDir(dir, ctx.guildDir)) {
      return { status: "skipped", detail: `no leftover ${LEGACY_VERSION_TREE} tree`, paths: [] };
    }
    const snapshots = filesUnder(dir);
    if (snapshots.length === 0) {
      if (!ctx.dryRun) removeContainedTree(dir, ctx.guildDir);
      return { status: "completed", detail: `removed the empty ${LEGACY_VERSION_TREE} tree`, paths: [rel(ctx, dir)] };
    }
    const live = /* @__PURE__ */ new Set();
    const skillsDir = path11.join(ctx.guildDir, "skills");
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
      const abs = path11.join(ctx.guildDir, relPath);
      if (!lstatSafe(abs)) continue;
      if (classifyPath(relPath) !== "derived") continue;
      if (!ctx.dryRun) fs8.rmSync(abs, { force: true });
      changed.push(rel(ctx, abs));
    }
    for (const relPath of AUTHORED_REGISTRIES) {
      const abs = path11.join(ctx.guildDir, relPath);
      const text = readIfFile(abs);
      if (text === null) continue;
      const target = path11.join(ctx.guildDir, "artifacts", "legacy", relPath.replace("/", "-"));
      if (lstatSafe(target)) continue;
      writeFile(ctx, target, text);
      if (!ctx.dryRun) fs8.rmSync(abs, { force: true });
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

// src/domains/state/detect.ts
var fs9 = __toESM(require("fs"));
var path12 = __toESM(require("path"));
var import_child_process = require("child_process");
function readRemote(childPath) {
  const gitConfig = path12.join(childPath, ".git", "config");
  if (!fs9.existsSync(gitConfig)) return null;
  try {
    const content = fs9.readFileSync(gitConfig, "utf8");
    const match = content.match(/url\s*=\s*(.+)/);
    if (!match) return null;
    const url = match[1].trim();
    return url.replace(/^git@/, "").replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/:/, "/");
  } catch {
    return null;
  }
}
function readHead(childPath) {
  try {
    const result = (0, import_child_process.execSync)("git rev-parse HEAD", {
      cwd: childPath,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 3e3
    }).trim();
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}
function classifyChild(root, name) {
  const childPath = path12.join(root, name);
  let stat;
  try {
    stat = fs9.statSync(childPath);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;
  const hasGit = fs9.existsSync(path12.join(childPath, ".git"));
  const hasGuild = fs9.existsSync(durableGuildDir(childPath));
  if (!hasGit && !hasGuild) return null;
  const kind = hasGuild ? "sub-guild" : "sub-project";
  const has_wiki = fs9.existsSync(path12.join(durableGuildDir(childPath), "wiki"));
  const has_indexes = fs9.existsSync(path12.join(durableGuildDir(childPath), "indexes"));
  const remote = hasGit ? readRemote(childPath) : null;
  const last_seen_commit = hasGit ? readHead(childPath) : null;
  return {
    name,
    path: name,
    // relative to root (depth-1 means path === name)
    kind,
    remote,
    has_wiki,
    has_indexes,
    last_seen_commit
  };
}
function detect(root, modeOverride, readMode) {
  const mode = modeOverride ?? readMode(root);
  const RULE = "immediate child has .git/ OR .guild/";
  let subGuilds = [];
  try {
    const entries = fs9.readdirSync(root);
    for (const name of entries) {
      const sg = classifyChild(root, name);
      if (sg !== null) subGuilds.push(sg);
    }
  } catch {
  }
  let kind;
  if (mode === "on") {
    kind = "workspace";
  } else if (mode === "off") {
    kind = "regular";
    subGuilds = [];
  } else {
    kind = subGuilds.length > 0 ? "workspace" : "regular";
  }
  return {
    kind,
    detection: { depth: 1, rule: RULE, mode },
    sub_guilds: subGuilds
  };
}
function parseArgs(argv) {
  let cwd;
  let mode;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && argv[i + 1]) {
      cwd = argv[++i];
    } else if (arg === "--mode" && argv[i + 1]) {
      const v = argv[++i];
      if (v === "auto" || v === "on" || v === "off") mode = v;
    }
  }
  return { cwd, mode };
}
function runWorkspaceDetectCli(readMode, argv = process.argv.slice(2)) {
  const { cwd: cwdArg, mode } = parseArgs(argv);
  const cwd = cwdArg ?? process.env["GUILD_CWD"] ?? process.cwd();
  if (!fs9.existsSync(cwd) || !fs9.statSync(cwd).isDirectory()) {
    process.stderr.write(`[workspace/detect] ERROR: --cwd "${cwd}" is not a directory
`);
    process.exit(1);
  }
  try {
    const result = detect(cwd, mode, readMode);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (e) {
    process.stderr.write(`[workspace/detect] ERROR: ${e.message}
`);
    process.exit(2);
  }
}
if (typeof module !== "undefined" && require.main === module && /^detect\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  runWorkspaceDetectCli();
}

// src/domains/state/federated-query.ts
var fs10 = __toESM(require("fs"));
var path13 = __toESM(require("path"));
function federatedQuery(root, query, scope) {
  const manifestPath = path13.join(durableGuildDir(root), "workspace.json");
  if (!fs10.existsSync(manifestPath)) {
    throw new Error(`workspace.json not found at ${manifestPath}`);
  }
  const manifest = JSON.parse(fs10.readFileSync(manifestPath, "utf8"));
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
    const subAbsPath = path13.resolve(root, sg.path);
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
function parseArgs2(argv) {
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
  const { cwd: cwdArg, query, scope } = parseArgs2(argv);
  const cwd = cwdArg ?? process.env["GUILD_CWD"] ?? process.cwd();
  if (!query) {
    process.stderr.write(`[workspace/federated-query] ERROR: --query is required
`);
    process.exit(1);
  }
  if (!fs10.existsSync(path13.join(durableGuildDir(cwd), "workspace.json"))) {
    process.stderr.write(
      `[workspace/federated-query] ERROR: no workspace.json at ${path13.join(durableGuildDir(cwd), "workspace.json")}
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
var fs11 = __toESM(require("fs"));
var path14 = __toESM(require("path"));
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
  const manifestPath = path14.join(durableGuildDir(workspaceRoot), "workspace.json");
  if (!fs11.existsSync(manifestPath)) return [];
  try {
    const raw = JSON.parse(fs11.readFileSync(manifestPath, "utf8"));
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
  const runsDir = path14.join(durableGuildDir(childDir), "runs");
  if (!fs11.existsSync(runsDir)) return [];
  const results = [];
  try {
    const runIds = fs11.readdirSync(runsDir);
    for (const runId of runIds) {
      const candidate = path14.join(runsDir, runId, "learn", "harvest-candidates.json");
      if (fs11.existsSync(candidate)) {
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
    raw = JSON.parse(fs11.readFileSync(harvestPath, "utf8"));
  } catch {
    return [];
  }
  const sourcePath = path14.relative(workspaceRoot, harvestPath);
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
    const childDir = path14.join(workspaceRoot, child.path);
    const harvestFiles = findHarvestFiles(childDir);
    for (const hf of harvestFiles) {
      const from = extractFromHarvestFile(hf, child.name, workspaceRoot);
      all.push(...from);
    }
  }
  return all;
}
function parseArgs3(argv) {
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
  const { workspaceRoot: rootArg, child, runId: runIdArg } = parseArgs3(argv);
  const workspaceRoot = rootArg ?? process.env["GUILD_CWD"] ?? process.cwd();
  if (!fs11.existsSync(workspaceRoot) || !fs11.statSync(workspaceRoot).isDirectory()) {
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
    const runsBase = path14.resolve(durableGuildDir(workspaceRoot), "runs");
    const runsDir = path14.join(runsBase, runId);
    const manifestPath = path14.join(runsDir, "upstream-candidates.json");
    const resolvedRunsDir = path14.resolve(runsDir);
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

// src/domains/state/write-manifest.ts
var fs12 = __toESM(require("fs"));
var path15 = __toESM(require("path"));
var CODE_EXTENSIONS = /* @__PURE__ */ new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp"
]);
function hasTopLevelCode(root) {
  try {
    const entries = fs12.readdirSync(root);
    for (const name of entries) {
      const ext = path15.extname(name).toLowerCase();
      if (CODE_EXTENSIONS.has(ext)) {
        try {
          const stat = fs12.statSync(path15.join(root, name));
          if (stat.isFile()) return true;
        } catch {
        }
      }
    }
  } catch {
  }
  return false;
}
function writeManifest(root, modeOverride, readMode) {
  const detection = detect(root, modeOverride, readMode);
  const rootWiki = hasTopLevelCode(root);
  const manifest = {
    schema_version: "guild.workspace.v1",
    is_workspace: detection.kind === "workspace",
    detected_at: (/* @__PURE__ */ new Date()).toISOString(),
    detection: detection.detection,
    root_wiki: rootWiki,
    sub_guilds: detection.sub_guilds,
    query_recipe: {
      mechanism: "guild-memory MCP wiki_search/wiki_get/wiki_list with per-call cwd override (or GUILD_MEMORY_WIKI_ROOT=<path>/.guild/wiki)",
      fan_out: "iterate sub_guilds where has_wiki; merge results, tag each hit with sub_guild.name",
      example: "wiki_search({ query: '<q>', cwd: 'plugin' })"
    }
  };
  const guildDir = durableGuildDir(root);
  fs12.mkdirSync(guildDir, { recursive: true });
  const manifestPath = path15.join(guildDir, "workspace.json");
  atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return manifestPath;
}
function parseArgs4(argv) {
  let cwd;
  let mode;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && argv[i + 1]) {
      cwd = argv[++i];
    } else if (arg === "--mode" && argv[i + 1]) {
      const v = argv[++i];
      if (v === "auto" || v === "on" || v === "off") mode = v;
    }
  }
  return { cwd, mode };
}
function runWriteWorkspaceManifestCli(readMode, argv = process.argv.slice(2)) {
  const { cwd: cwdArg, mode } = parseArgs4(argv);
  const cwd = cwdArg ?? process.env["GUILD_CWD"] ?? process.cwd();
  if (!fs12.existsSync(cwd) || !fs12.statSync(cwd).isDirectory()) {
    process.stderr.write(`[workspace/write-manifest] ERROR: --cwd "${cwd}" is not a directory
`);
    process.exit(1);
  }
  try {
    const written = writeManifest(cwd, mode, readMode);
    process.stdout.write(written + "\n");
  } catch (e) {
    process.stderr.write(`[workspace/write-manifest] ERROR: ${e.message}
`);
    process.exit(2);
  }
}
if (typeof module !== "undefined" && require.main === module && /^write-manifest\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  runWriteWorkspaceManifestCli();
}

// hooks/lib/guild-root.ts
function resolveGuildRoot3(startCwd) {
  const resolvedStart = path16.resolve(startCwd);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs13.existsSync(path16.join(current, ".git"))) {
      return current;
    }
    if (nearestGuildDir === null) {
      const guildDir = durableGuildDir(current);
      if (fs13.existsSync(guildDir)) {
        try {
          if (fs13.statSync(guildDir).isDirectory()) {
            nearestGuildDir = current;
          }
        } catch {
        }
      }
    }
    const parent = path16.dirname(current);
    if (parent === current) {
      return nearestGuildDir ?? resolvedStart;
    }
    current = parent;
  }
}

// scripts/dot-guild/convert/detect.ts
var path18 = __toESM(require("path"));

// scripts/dot-guild/convert/seams.ts
var fs14 = __toESM(require("fs"));
var crypto3 = __toESM(require("crypto"));
var path17 = __toESM(require("path"));
var yaml = require_js_yaml();
var realFs = {
  existsSync: (p) => fs14.existsSync(p),
  readFileSync: (p) => fs14.readFileSync(p, "utf8"),
  readBytes: (p) => fs14.readFileSync(p),
  writeFileSync: (p, data) => {
    fs14.mkdirSync(path17.dirname(p), { recursive: true });
    fs14.writeFileSync(p, data, "utf8");
  },
  writeBytes: (p, data) => {
    fs14.mkdirSync(path17.dirname(p), { recursive: true });
    fs14.writeFileSync(p, data);
  },
  mkdirSync: (p, opts) => {
    fs14.mkdirSync(p, opts.recursive ? { recursive: true } : void 0);
  },
  rmFileSync: (p) => fs14.rmSync(p, { force: true }),
  readdirSync: (p) => fs14.readdirSync(p, { withFileTypes: true }).map((e) => ({
    name: e.name,
    isDirectory: e.isDirectory(),
    isFile: e.isFile()
  })),
  isSymlink: (p) => {
    try {
      return fs14.lstatSync(p).isSymbolicLink();
    } catch {
      return false;
    }
  },
  sha256: (p) => crypto3.createHash("sha256").update(fs14.readFileSync(p)).digest("hex")
};
function parseJson(content) {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
function parseYaml2(content) {
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
function walk(fs17, dir, excludeDir, base, _depth = 0, _budget = { nodes: 0 }) {
  if (_depth > WALK_MAX_DEPTH) return [];
  if (_budget.nodes >= WALK_MAX_NODES) return [];
  if (!fs17.existsSync(dir)) return [];
  const out = [];
  let entries;
  try {
    entries = fs17.readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (_budget.nodes >= WALK_MAX_NODES) break;
    _budget.nodes += 1;
    const full = path18.join(dir, e.name);
    if (e.isDirectory) {
      if (excludeDir(e.name)) continue;
      const sub = walk(fs17, full, excludeDir, base, _depth + 1, _budget);
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
  return path18.relative(guildDir, p);
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
function detect2(fs17, guildDir) {
  const evidence = [];
  const unparseable = [];
  const pr = { fs: fs17, guildDir, evidence, unparseable };
  const addM1 = (p, marker, note) => evidence.push({ path: relTo(guildDir, p), marker, contributes: "M1", note });
  const addM2 = (p, marker, note) => evidence.push({ path: relTo(guildDir, p), marker, contributes: "M2", note });
  if (!fs17.existsSync(guildDir)) {
    return { classification: "none", m1: false, m2: false, hasUnparseable: false, evidence, unparseable };
  }
  const topFiles = walk(fs17, guildDir, (name) => isBackupDir(name), guildDir);
  if (topFiles.length === 0) {
    return { classification: "none", m1: false, m2: false, hasUnparseable: false, evidence, unparseable };
  }
  const j = (rel2) => path18.join(guildDir, rel2);
  {
    const p = j("settings.json");
    if (fs17.existsSync(p)) {
      addM2(p, "P1", "settings.json exists (v2-only file)");
      const parsed = readParsed(pr, p, "json", true);
      for (const k of v1KeysIn(parsed)) addM1(p, "P1", `v1-only key: ${k}`);
    }
  }
  {
    const p = j("settings.local.json");
    if (fs17.existsSync(p)) {
      addM2(p, "P9", "settings.local.json exists (v2-era surface \u2014 F2)");
      const parsed = readParsed(pr, p, "json", true);
      for (const k of v1KeysIn(parsed)) addM1(p, "P9", `local-only v1 key: ${k}`);
    }
  }
  {
    const p = j("config.yml");
    if (fs17.existsSync(p)) {
      addM1(p, "P2", "config.yml exists (v1-only file)");
      readParsed(pr, p, "yaml", true);
    }
  }
  {
    const p = j(path18.join("indexes", "initiatives-registry.yaml"));
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
    if (fs17.existsSync(runsDir)) {
      let runEntries;
      try {
        runEntries = fs17.readdirSync(runsDir);
      } catch {
        runEntries = [];
      }
      for (const e of runEntries) {
        if (!e.isDirectory) continue;
        const runDir = path18.join(runsDir, e.name);
        const runYaml = path18.join(runDir, "run.yaml");
        const meta = path18.join(runDir, "metadata.json");
        const hasRunYaml = fs17.existsSync(runYaml);
        if (hasRunYaml) {
          const parsed = readParsed(pr, runYaml, "yaml", true);
          const sv = svOf(parsed);
          if (sv === "guild.run.v1" || sv && SCHEMA_STAMP_RE.test(sv)) addM2(runYaml, "P5", `schema_version: ${sv}`);
          else addM2(runYaml, "P5", "run.yaml present (v2 run manifest)");
        }
        if (fs17.existsSync(meta) && !hasRunYaml) {
          addM1(meta, "P6", "metadata.json without sibling run.yaml (v1 run record)");
          readParsed(pr, meta, "json", true);
        }
      }
    }
  }
  {
    const hostsDir = j("hosts");
    if (fs17.existsSync(hostsDir)) {
      let hostEntries;
      try {
        hostEntries = fs17.readdirSync(hostsDir);
      } catch {
        hostEntries = [];
      }
      for (const e of hostEntries) {
        if (!e.isDirectory) continue;
        const cap = path18.join(hostsDir, e.name, "capability.json");
        const parsed = readParsed(pr, cap, "json", false);
        const sv = svOf(parsed);
        if (sv && (sv === "guild.host_capability.v1" || SCHEMA_STAMP_RE.test(sv))) addM2(cap, "P7", `schema_version: ${sv}`);
      }
    }
  }
  {
    const refDir = j("reflections");
    if (fs17.existsSync(refDir)) {
      let refEntries;
      try {
        refEntries = fs17.readdirSync(refDir);
      } catch {
        refEntries = [];
      }
      for (const e of refEntries) {
        if (!e.isFile || !e.name.endsWith(".md")) continue;
        const p = path18.join(refDir, e.name);
        let head = "";
        try {
          head = fs17.readFileSync(p).slice(0, P10_HEAD_BYTES);
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
      fs17,
      guildDir,
      (name) => isBackupDir(name),
      guildDir
    );
    for (const f of files) {
      const base = path18.basename(f);
      const ext = path18.extname(f).toLowerCase();
      if (isBackupDir(base) || isReportFile(base)) continue;
      if (base === "events.ndjson" || f.includes(`${path18.sep}logs${path18.sep}`) || ext === ".jsonl") continue;
      if (!P10_EXTS.has(ext)) continue;
      let head = "";
      try {
        head = fs17.readFileSync(f).slice(0, P10_HEAD_BYTES);
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

// scripts/lib/state/ensure-storage-layout.ts
var fs15 = __toESM(require("node:fs"));
var path19 = __toESM(require("node:path"));
var CURRENT_LAYOUT_VERSION = 2;
function markerPath(root) {
  return path19.join(root, ".guild", "storage-layout.json");
}
function detect3(cwd = process.cwd()) {
  const root = resolveGuildRoot(cwd);
  const marker = markerPath(root);
  if (!fs15.existsSync(path19.join(root, ".guild"))) {
    return { state: "absent", version: null, root, marker };
  }
  let version = null;
  try {
    const parsed = JSON.parse(fs15.readFileSync(marker, "utf8"));
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
      path19.join(__dirname, "upgrade-chain.js"),
      path19.join(__dirname, "lib", "state", "upgrade-chain"),
      path19.join(__dirname, "upgrade-chain")
    ];
    const spec = candidates.find((c) => fs15.existsSync(c) || fs15.existsSync(`${c}.ts`)) ?? candidates[2];
    upgradeChunk = require(spec);
  }
  return upgradeChunk;
}
function ensureStorageLayout(cwd = process.cwd(), opts = {}) {
  const status = detect3(cwd);
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
  const after = detect3(cwd);
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

// hooks/detect-guild-version.ts
async function readStdin() {
  return new Promise((resolve13) => {
    const chunks = [];
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve13(result);
    };
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => settle(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => settle(""));
    setTimeout(() => settle(Buffer.concat(chunks).toString("utf8")), 500);
  });
}
function resolveMigratePath() {
  const pluginRoot = process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"];
  if (pluginRoot) {
    const candidate = path20.resolve(pluginRoot, "scripts/dot-guild/migrate-guild.ts");
    if (fs16.existsSync(candidate)) return candidate;
    return candidate;
  }
  const distRelative = path20.resolve(__dirname, "../../scripts/dot-guild/migrate-guild.ts");
  const srcRelative = path20.resolve(__dirname, "../scripts/dot-guild/migrate-guild.ts");
  if (fs16.existsSync(distRelative)) return distRelative;
  if (fs16.existsSync(srcRelative)) return srcRelative;
  return distRelative;
}
function buildV1MixedMessage(classification, guildDir, repoRoot, migratePath) {
  const classLabel = classification === "mixed" ? "v1/mixed" : "v1";
  const base = `npx tsx "${migratePath}" --root="${repoRoot}"`;
  return [
    `[Guild] v1 .guild detected \u2014 migrate to v2? [migrate / dry-run / skip]`,
    ``,
    `  Classification: ${classLabel}   Path: ${guildDir}`,
    ``,
    `  migrate  \u2192 ${base} --mode=migrate`,
    `             (snapshots .guild/ first, then converts in place; rollback available)`,
    `  dry-run  \u2192 ${base} --mode=dry-run`,
    `             (previews the plan + writes only a dry-run report under .guild/; no migration, no snapshot)`,
    `  skip     \u2192 do nothing (this message surfaces again next session)`,
    ``,
    `  Multi-repo (workspace): add --workspace to fan out to all child repos.`,
    ``,
    `  Tip: run dry-run first to preview before committing to migrate.`
  ].join("\n");
}
function buildCorruptMessage(guildDir, repoRoot, migratePath) {
  const base = `npx tsx "${migratePath}" --root="${repoRoot}"`;
  return [
    `[Guild] corrupt .guild detected \u2014 migration blocked pending manual review`,
    ``,
    `  Path: ${guildDir}`,
    ``,
    `  One or more authoritative files failed to parse (truncated / invalid JSON/YAML).`,
    `  Blind conversion could discard data. Inspect first, then re-classify.`,
    ``,
    `  Recommended steps:`,
    `    1. Inspect:  ${base} --mode=dry-run`,
    `                 (reads; writes only a dry-run report under .guild/ \u2014 no other changes)`,
    `    2. Manual review: open the flagged files and repair or remove the corrupt entries.`,
    `    3. Re-run:   ${base} --mode=dry-run  (confirm no corrupt files remain)`,
    `    4. Once dry-run reports clean, re-open the session \u2014 the normal migrate prompt`,
    `       will surface if any v1/mixed keys remain.`,
    ``,
    `  Do not force migrate on a corrupt tree.`
  ].join("\n");
}
async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    if (raw.trim()) {
      payload = JSON.parse(raw.trim());
    }
  } catch {
    process.exit(0);
  }
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const root = resolveGuildRoot3(cwd);
  const guildDir = durableGuildDir(root);
  try {
    ensureStorageLayout(root, { detectOnly: true });
  } catch {
    process.exit(0);
  }
  if (!fs16.existsSync(guildDir)) {
    process.exit(0);
  }
  const result = detect2(realFs, guildDir);
  const migratePath = resolveMigratePath();
  switch (result.classification) {
    case "v2":
    case "none":
      break;
    case "v1":
    case "mixed":
      process.stdout.write(
        buildV1MixedMessage(result.classification, guildDir, root, migratePath) + "\n"
      );
      break;
    case "corrupt":
      process.stdout.write(buildCorruptMessage(guildDir, root, migratePath) + "\n");
      break;
    default:
      break;
  }
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(
    `[detect-guild-version] error (session unaffected): ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(0);
});
