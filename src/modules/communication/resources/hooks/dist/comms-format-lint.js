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

// ../../../hooks/node_modules/js-yaml/lib/common.js
var require_common = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/common.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/exception.js
var require_exception = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/exception.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/snippet.js
var require_snippet = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/snippet.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/type.js
var require_type = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/schema.js
var require_schema = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/schema.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/type/str.js
var require_str = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type/str.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/type/seq.js
var require_seq = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type/seq.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/type/map.js
var require_map = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type/map.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/schema/failsafe.js
var require_failsafe = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/schema/failsafe.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/type/null.js
var require_null = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type/null.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/type/bool.js
var require_bool = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type/bool.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/type/int.js
var require_int = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type/int.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/type/float.js
var require_float = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type/float.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/schema/json.js
var require_json = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/schema/json.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/schema/core.js
var require_core = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/schema/core.js"(exports2, module2) {
    "use strict";
    module2.exports = require_json();
  }
});

// ../../../hooks/node_modules/js-yaml/lib/type/timestamp.js
var require_timestamp = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type/timestamp.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/type/merge.js
var require_merge = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type/merge.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/type/binary.js
var require_binary = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type/binary.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/type/omap.js
var require_omap = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type/omap.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/type/pairs.js
var require_pairs = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type/pairs.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/type/set.js
var require_set = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/type/set.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/schema/default.js
var require_default = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/schema/default.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/loader.js
var require_loader = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/loader.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/lib/dumper.js
var require_dumper = __commonJS({
  "../../../hooks/node_modules/js-yaml/lib/dumper.js"(exports2, module2) {
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

// ../../../hooks/node_modules/js-yaml/index.js
var require_js_yaml = __commonJS({
  "../../../hooks/node_modules/js-yaml/index.js"(exports2, module2) {
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

// comms-format-lint.ts
var path5 = __toESM(require("path"));

// ../src/modules/communication/workflows/comms-format-lint.ts
var fs3 = __toESM(require("fs"));
var path4 = __toESM(require("path"));

// ../src/modules/distribution/workflows/build-inventory.ts
var fs2 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));

// ../src/modules/kernel/workflows/module-manifest.ts
var OWNED_INVENTORY_CATEGORIES = Object.freeze([
  "commands",
  "skills",
  "agents",
  "hooks",
  "mcp_servers",
  "scripts"
]);

// ../src/modules/kernel/workflows/yaml-loader.ts
var path = __toESM(require("node:path"));
function pluginLocalScriptsRoots() {
  return [
    // Source/runtime TS layout: src/modules/kernel/workflows -> plugin/scripts.
    path.resolve(__dirname, "..", "..", "..", "..", "scripts"),
    // Bundled hook layout: hooks/dist -> plugin/scripts.
    path.resolve(__dirname, "..", "..", "scripts"),
    // Bundled agent-team hook layout: hooks/agent-team/dist -> plugin/scripts.
    path.resolve(__dirname, "..", "..", "..", "scripts")
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
  const cwdRoot = path.resolve(process.cwd(), "scripts");
  tried.push(cwdRoot);
  const api = tryScriptsRoot(cwdRoot);
  if (api) return api;
  throw new Error(
    `Guild needs the js-yaml package and could not resolve it. Fix: npm install --prefix <plugin-root>/scripts (roots tried: ${tried.join(", ")})`
  );
}

// ../src/modules/kernel/workflows/sealed-collections.ts
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

// ../src/modules/distribution/workflows/inventory-schema.ts
var INVENTORY_CATEGORIES = Object.freeze([
  "commands",
  "skills",
  "agents",
  "hooks",
  "mcp_servers",
  "scripts",
  "schemas",
  "docs"
]);
var ALLOWED_INVENTORY_KEYS = sealSet([
  "schema_version",
  "generated_at",
  "plugin_version",
  "manifest",
  ...INVENTORY_CATEGORIES
], "ALLOWED_INVENTORY_KEYS");
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}
function validateEntryBase(entry, category, index, errors) {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    errors.push(`${category}[${index}] must be a non-null object`);
    return {};
  }
  const e = entry;
  if (!isNonEmptyString(e["id"])) {
    errors.push(`${category}[${index}].id must be a non-empty string`);
  }
  const isDeferredSchema = category === "schemas" && e["status"] === "deferred";
  if (!isNonEmptyString(e["source_path"])) {
    if (!(isDeferredSchema && e["source_path"] === "")) {
      errors.push(
        `${category}[${index}].source_path must be a non-empty string` + (category === "schemas" ? ` (empty allowed only for status:"deferred")` : "")
      );
    }
  } else if (e["source_path"].startsWith("./")) {
    errors.push(
      `${category}[${index}].source_path must be bare repo-relative (no "./" prefix): got ${JSON.stringify(e["source_path"])}`
    );
  }
  return { id: typeof e["id"] === "string" ? e["id"] : void 0 };
}
function validateCategory(obj, category, errors) {
  const list = obj[category];
  if (!Array.isArray(list)) {
    errors.push(`${category} must be an array (may be empty, but must be present)`);
    return;
  }
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < list.length; i++) {
    const { id } = validateEntryBase(list[i], category, i, errors);
    if (id !== void 0) {
      if (seen.has(id)) {
        errors.push(`${category} has duplicate id ${JSON.stringify(id)} (ids must be unique within a category)`);
      }
      seen.add(id);
    }
    const e = list[i];
    if (category === "hooks" && !isNonEmptyString(e?.["event"])) {
      errors.push(`hooks[${i}].event must be a non-empty string`);
    }
    if (category === "mcp_servers") {
      const t = e?.["transport"];
      if (t !== "stdio" && t !== "http") {
        errors.push(`mcp_servers[${i}].transport must be "stdio" or "http"; got ${JSON.stringify(t)}`);
      }
    }
    if (category === "schemas") {
      const s = e?.["status"];
      if (s !== "exists" && s !== "deferred") {
        errors.push(`schemas[${i}].status must be "exists" or "deferred"; got ${JSON.stringify(s)}`);
      }
    }
  }
}
function validateInventoryV1(value) {
  const errors = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["inventory must be a non-null object"] };
  }
  const obj = value;
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_INVENTORY_KEYS.has(k)) {
      errors.push(`unknown key "${k}" \u2014 strict guild.inventory.v1 rejects extra/misspelled keys`);
    }
  }
  if (obj["schema_version"] !== "guild.inventory.v1") {
    errors.push(
      `schema_version must be "guild.inventory.v1"; got ${JSON.stringify(obj["schema_version"])}`
    );
  }
  if (!isNonEmptyString(obj["generated_at"])) {
    errors.push("generated_at must be a non-empty ISO 8601 string");
  }
  if (!isNonEmptyString(obj["plugin_version"])) {
    errors.push("plugin_version must be a non-empty string");
  }
  const manifest = obj["manifest"];
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    errors.push("manifest must be a non-null object");
  } else {
    const m = manifest;
    if (!isNonEmptyString(m["name"])) errors.push("manifest.name must be a non-empty string");
    if (!isNonEmptyString(m["version"])) errors.push("manifest.version must be a non-empty string");
    if (typeof m["description"] !== "string") errors.push("manifest.description must be a string");
  }
  for (const category of INVENTORY_CATEGORIES) {
    validateCategory(obj, category, errors);
  }
  return { valid: errors.length === 0, errors };
}

// ../src/modules/state/workflows/dependency-graph-schema.ts
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

// ../src/modules/migrations/workflows/index-migrate.ts
var import_node_child_process = require("node:child_process");
var fs = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
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
    const abs = path2.isAbsolute(raw) ? raw : path2.resolve(cwd, raw);
    const root = path2.dirname(abs);
    if (fs.existsSync(root)) return root;
  } catch {
  }
  return path2.resolve(cwd);
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
    fs.mkdirSync(path2.dirname(dbPath), { recursive: true });
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
    dbPath = path2.join(guildRoot, ".guild", "index.sqlite");
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

// ../src/modules/migrations/workflows/wiki-importance.ts
var STRUCTURAL_BASENAMES = sealSet([
  "index.md",
  "readme.md",
  "log.md",
  "query.md",
  "transfer-manifest.md"
], "STRUCTURAL_BASENAMES");

// ../src/modules/distribution/workflows/parity-contract.ts
var DISCOVERY_RULES = deepFreeze([
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
var COVERAGE_ENFORCED_CATEGORIES = Object.freeze(DISCOVERY_RULES.filter(
  (r) => r.enforced
).map((r) => r.category));
function inventoryIds(inventory, category) {
  const list = inventory[category] ?? [];
  return new Set(list.map((e) => e.id));
}
function checkCoverage(discovered, inventory) {
  const categories = [];
  const reasons = [];
  for (const enforced of COVERAGE_ENFORCED_CATEGORIES) {
    if (discovered[enforced] === void 0) {
      reasons.push(
        `coverage: enforced category "${enforced}" was not supplied in the discovery scan (SC-7a requires every enforced category to be scanned \u2014 cannot pass vacuously)`
      );
    }
  }
  for (const category of INVENTORY_CATEGORIES) {
    const found = discovered[category];
    if (found === void 0) continue;
    const inv = inventoryIds(inventory, category);
    const missing = [...found].filter((id) => !inv.has(id)).sort();
    const phantom = [...inv].filter((id) => !found.has(id)).sort();
    const ok = missing.length === 0 && phantom.length === 0;
    categories.push({
      category,
      missing_from_inventory: missing,
      phantom_in_inventory: phantom,
      ok
    });
    for (const id of missing) {
      reasons.push(
        `coverage: ${category} "${id}" exists in the repo but is MISSING from guild.inventory.v1 (silent drop \u2014 SC-7a)`
      );
    }
    for (const id of phantom) {
      reasons.push(
        `coverage: ${category} "${id}" is in guild.inventory.v1 but was NOT discovered in the repo (phantom \u2014 SC-7a)`
      );
    }
  }
  return { ok: reasons.length === 0, categories, reasons };
}

// ../src/modules/distribution/workflows/handoff-v2.ts
var ALLOWED_INJECTION_CLEAN_VALUES = sealSet(["clean", "flagged", "unverified"], "ALLOWED_INJECTION_CLEAN_VALUES");
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
], "ALLOWED_TOP_LEVEL_KEYS");

// ../src/modules/distribution/workflows/result-contracts.ts
var EXISTING_CONTRACTS = deepFreeze([
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
var DEFERRED_CONTRACTS = Object.freeze([]);
var RESULT_CONTRACTS = Object.freeze([
  ...EXISTING_CONTRACTS,
  ...DEFERRED_CONTRACTS
]);
var PHASE1_NORMALIZER_TARGETS = sealSet(EXISTING_CONTRACTS.map((c) => c.wire_schema_version), "PHASE1_NORMALIZER_TARGETS");

// ../src/modules/distribution/workflows/build-inventory.ts
var PLUGIN_ROOT = path3.resolve(__dirname, "../../../..");
var UNSTAMPED_GENERATED_AT = "1970-01-01T00:00:00.000Z";
function toPosix(p) {
  return p.split(path3.sep).join("/");
}
function existsDir(p) {
  try {
    return fs2.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function listMdFiles(dir) {
  if (!existsDir(dir)) return [];
  return fs2.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
}
function walkFiles(root, rel, pred, out) {
  const abs = path3.join(root, rel);
  if (!existsDir(abs)) return;
  for (const name of fs2.readdirSync(abs).sort()) {
    if (name === "node_modules" || name === "__tests__") continue;
    const childRel = rel ? `${rel}/${name}` : name;
    const childAbs = path3.join(abs, name);
    let st;
    try {
      st = fs2.statSync(childAbs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(root, childRel, pred, out);
    } else if (pred(toPosix(childRel), name)) {
      out.push(toPosix(childRel));
    }
  }
}
function readFile(abs) {
  return fs2.readFileSync(abs, "utf8");
}
function frontmatterField(content, field) {
  return readScalarField(content, field);
}
function discoverCommands(root) {
  const dir = path3.join(root, "commands");
  return listMdFiles(dir).map((file) => {
    const id = file.replace(/\.md$/i, "");
    const description = frontmatterField(readFile(path3.join(dir, file)), "description");
    const e = { id, source_path: `commands/${file}` };
    if (description) e.description = description;
    return e;
  }).sort((a, b) => a.id.localeCompare(b.id));
}
function discoverAgents(root) {
  const dir = path3.join(root, "agents");
  return listMdFiles(dir).map((file) => {
    const id = file.replace(/\.md$/i, "");
    const description = frontmatterField(readFile(path3.join(dir, file)), "description");
    const e = { id, source_path: `agents/${file}` };
    if (description) e.description = description;
    return e;
  }).sort((a, b) => a.id.localeCompare(b.id));
}
function discoverSkills(root) {
  const files = [];
  walkFiles(root, "skills", (_rel, name) => name === "SKILL.md" || name === "SKILL.src.md", files);
  const byName = /* @__PURE__ */ new Map();
  for (const rel of files) {
    const content = readFile(path3.join(root, rel));
    const id = frontmatterField(content, "name");
    if (!id) {
      throw new Error(`build-inventory: skill at ${rel} has no \`name:\` frontmatter (cannot derive id)`);
    }
    const isSrc = rel.endsWith("SKILL.src.md");
    const segs = rel.split("/");
    const tier = segs.length >= 3 ? segs[1] : void 0;
    const description = frontmatterField(content, "description");
    const entry = { id, source_path: rel };
    if (tier) entry.tier = tier;
    if (description) entry.description = description;
    const prior = byName.get(id);
    if (!prior) {
      byName.set(id, { entry, isSrc });
    } else if (isSrc && !prior.isSrc) {
      byName.set(id, { entry, isSrc });
    }
  }
  return [...byName.values()].map((v) => v.entry).sort((a, b) => a.id.localeCompare(b.id));
}
function hookScriptPath(command) {
  const m = /\$\{(?:GUILD_PLUGIN_ROOT(?::-\$\{CLAUDE_PLUGIN_ROOT\})?|CLAUDE_PLUGIN_ROOT)\}\/([^\s"']+)/.exec(command);
  if (m) return m[1];
  const tokens = command.trim().split(/\s+/);
  const last = tokens[tokens.length - 1];
  return last && last.includes("/") ? last.replace(/^\.\//, "") : null;
}
function discoverHooks(root) {
  const file = path3.join(root, "hooks", "hooks.json");
  if (!fs2.existsSync(file)) return [];
  const parsed = JSON.parse(readFile(file));
  const hooksObj = parsed.hooks ?? {};
  const entries = [];
  for (const event of Object.keys(hooksObj)) {
    const blocks = hooksObj[event];
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      const matcher = block.matcher;
      const inner = block.hooks ?? [];
      for (const h of inner) {
        if (!h.command) continue;
        const sp = hookScriptPath(h.command);
        if (!sp) continue;
        const base = sp.split("/").pop();
        const e = { id: `${event}:${base}`, source_path: sp, event };
        if (matcher) e.matcher = matcher;
        entries.push(e);
      }
    }
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}
function discoverMcpServers(root) {
  const file = path3.join(root, ".mcp.json");
  if (!fs2.existsSync(file)) return [];
  const parsed = JSON.parse(readFile(file));
  const servers = parsed.mcpServers ?? {};
  const entries = [];
  for (const id of Object.keys(servers)) {
    const s = servers[id];
    const transport = s["type"] === "http" ? "http" : "stdio";
    const e = { id, source_path: ".mcp.json", transport };
    if (typeof s["command"] === "string") e.command = s["command"];
    if (Array.isArray(s["args"])) e.args = s["args"].map(String);
    if (typeof s["url"] === "string") e.url = s["url"];
    const cap = s["mcp_capability"];
    if (cap && typeof cap.read_only === "boolean") e.read_only = cap.read_only;
    if (cap && typeof cap.description === "string") e.description = cap.description;
    entries.push(e);
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}
function discoverScripts(root) {
  const files = [];
  walkFiles(
    root,
    "scripts",
    (rel, name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    files
  );
  return files.map((rel) => {
    const underScripts = rel.replace(/^scripts\//, "");
    const id = underScripts.replace(/\.ts$/, "");
    return { id, source_path: rel, kind: id.startsWith("lib/") ? "lib" : "cli" };
  }).sort((a, b) => a.id.localeCompare(b.id));
}
function discoverHookCliBundles(root, boundBasenames) {
  const distDir = path3.join(root, "hooks", "dist");
  if (!existsDir(distDir)) return [];
  const referenced = /* @__PURE__ */ new Set();
  for (const file of listMdFiles(path3.join(root, "commands"))) {
    const content = readFile(path3.join(root, "commands", file));
    for (const m of content.matchAll(/hooks\/dist\/([A-Za-z0-9_.-]+\.js)/g)) {
      referenced.add(m[1]);
    }
  }
  return [...referenced].filter((basename) => !boundBasenames.has(basename)).filter((basename) => fs2.existsSync(path3.join(distDir, basename))).map(
    (basename) => ({
      id: `hooks/dist/${basename.replace(/\.js$/, "")}`,
      source_path: `hooks/dist/${basename}`,
      kind: "cli"
    })
  ).sort((a, b) => a.id.localeCompare(b.id));
}
function discoverDocs(root) {
  const files = [];
  walkFiles(root, "docs", (_rel, name) => name.endsWith(".md"), files);
  return files.map((rel) => {
    const id = rel.replace(/\.md$/i, "");
    const title = frontmatterField(readFile(path3.join(root, rel)), "title");
    const e = { id, source_path: rel };
    if (title) e.title = title;
    return e;
  }).sort((a, b) => a.id.localeCompare(b.id));
}
function discoverSchemas() {
  return RESULT_CONTRACTS.map(
    (c) => ({
      id: c.wire_schema_version,
      source_path: c.source_path,
      status: c.status,
      validator_kind: c.validator_kind
    })
  ).sort((a, b) => a.id.localeCompare(b.id));
}
function discoverSurfaces(root = PLUGIN_ROOT) {
  const commands = discoverCommands(root);
  const skills = discoverSkills(root);
  const agents = discoverAgents(root);
  const hooks = discoverHooks(root);
  const mcp_servers = discoverMcpServers(root);
  const boundHookBasenames = new Set(hooks.map((h) => h.source_path.split("/").pop()));
  const scripts = [...discoverScripts(root), ...discoverHookCliBundles(root, boundHookBasenames)].sort(
    (a, b) => a.id.localeCompare(b.id)
  );
  const schemas = discoverSchemas();
  const docs = discoverDocs(root);
  const idSet = (list) => new Set(list.map((e) => e.id));
  const discovered = {
    commands: idSet(commands),
    agents: idSet(agents),
    skills: idSet(skills),
    hooks: idSet(hooks),
    mcp_servers: idSet(mcp_servers),
    scripts: idSet(scripts)
  };
  return { commands, skills, agents, hooks, mcp_servers, scripts, schemas, docs, discovered };
}
function readManifest(root) {
  const file = path3.join(root, ".claude-plugin", "plugin.json");
  const raw = JSON.parse(readFile(file));
  const manifest = {
    name: String(raw["name"] ?? ""),
    version: String(raw["version"] ?? ""),
    description: String(raw["description"] ?? "")
  };
  if (typeof raw["homepage"] === "string") manifest.homepage = raw["homepage"];
  if (typeof raw["repository"] === "string") manifest.repository = raw["repository"];
  if (raw["author"] && typeof raw["author"] === "object") {
    manifest.author = raw["author"];
  }
  if (typeof raw["license"] === "string") manifest.license = raw["license"];
  if (Array.isArray(raw["keywords"])) manifest.keywords = raw["keywords"].map(String);
  return { manifest, version: manifest.version };
}
function buildInventory(root = PLUGIN_ROOT, generatedAt = UNSTAMPED_GENERATED_AT) {
  const d = discoverSurfaces(root);
  const { manifest, version } = readManifest(root);
  const inventory = {
    schema_version: "guild.inventory.v1",
    generated_at: generatedAt,
    plugin_version: version,
    manifest,
    commands: d.commands,
    skills: d.skills,
    agents: d.agents,
    hooks: d.hooks,
    mcp_servers: d.mcp_servers,
    scripts: d.scripts,
    schemas: d.schemas,
    docs: d.docs
  };
  const validation = validateInventoryV1(inventory);
  if (!validation.valid) {
    throw new Error(
      "build-inventory: generated inventory FAILED validation:\n  " + validation.errors.join("\n  ")
    );
  }
  const coverage = checkCoverage(d.discovered, inventory);
  if (!coverage.ok) {
    throw new Error(
      "build-inventory: SC-7(a) coverage self-check FAILED (discovery != inventory):\n  " + coverage.reasons.join("\n  ")
    );
  }
  for (const cat of COVERAGE_ENFORCED_CATEGORIES) {
    if (d.discovered[cat] === void 0) {
      throw new Error(`build-inventory: enforced category "${cat}" was not scanned (internal error)`);
    }
  }
  return inventory;
}
function serializeInventory(inventory) {
  return JSON.stringify(inventory, null, 2) + "\n";
}
function parseArgs(argv) {
  let out;
  let root = PLUGIN_ROOT;
  let generatedAt = process.env["GUILD_INVENTORY_GENERATED_AT"] || UNSTAMPED_GENERATED_AT;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" && argv[i + 1] !== void 0) out = argv[++i];
    else if (a.startsWith("--out=")) out = a.slice("--out=".length);
    else if (a === "--root" && argv[i + 1] !== void 0) root = path3.resolve(argv[++i]);
    else if (a.startsWith("--root=")) root = path3.resolve(a.slice("--root=".length));
    else if (a === "--generated-at" && argv[i + 1] !== void 0) generatedAt = argv[++i];
    else if (a.startsWith("--generated-at=")) generatedAt = a.slice("--generated-at=".length);
    else if (a === "--check") check = true;
    else return { error: `unknown argument: ${a}` };
  }
  return { out, root, generatedAt, check };
}
function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(
      parsed.error + "\nusage: build-inventory.ts [--out <path>] [--root <pluginRoot>] [--generated-at <iso>] [--check]\n"
    );
    return 1;
  }
  const outPath = parsed.out ?? path3.join(parsed.root, "guild.inventory.json");
  let inventory;
  try {
    inventory = buildInventory(parsed.root, parsed.generatedAt);
  } catch (err) {
    process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
    return 2;
  }
  const serialized = serializeInventory(inventory);
  if (parsed.check) {
    let onDisk = null;
    try {
      onDisk = fs2.readFileSync(outPath, "utf8");
    } catch {
      onDisk = null;
    }
    if (onDisk === null) {
      process.stderr.write(`build-inventory --check: ${outPath} does not exist (run without --check to generate)
`);
      return 2;
    }
    if (onDisk !== serialized) {
      process.stderr.write(
        `build-inventory --check: ${outPath} is STALE \u2014 regenerate with \`npx tsx scripts/build-inventory.ts\`
`
      );
      return 2;
    }
    process.stdout.write(`build-inventory: ${outPath} is up to date.
`);
    return 0;
  }
  try {
    fs2.writeFileSync(outPath, serialized);
  } catch (err) {
    process.stderr.write(`build-inventory: cannot write ${outPath}: ${String(err)}
`);
    return 1;
  }
  process.stdout.write(
    `build-inventory: wrote ${outPath} (${inventory.commands.length} commands, ${inventory.skills.length} skills, ${inventory.agents.length} agents, ${inventory.hooks.length} hooks, ${inventory.mcp_servers.length} mcp, ${inventory.scripts.length} scripts, ${inventory.schemas.length} schemas, ${inventory.docs.length} docs)
`
  );
  return 0;
}
if (require.main === module) {
  process.exit(main());
}

// ../src/modules/distribution/workflows/equivalence-contract.ts
var EQUIVALENCE_SURFACES = Object.freeze([
  "manifest",
  "commands",
  "skills",
  "agents",
  "hooks_json",
  "bootstrap_sh",
  "mcp_json",
  "script_refs"
]);
var INTENTIONAL_EXCLUSIONS = deepFreeze([
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
var PROVENANCE_FIELDS = sealSet([
  "_rendered_at",
  "_source_version",
  "generated_at"
], "PROVENANCE_FIELDS");
var SORTED_MANIFEST_ARRAYS = sealSet(["skills", "commands", "agents"], "SORTED_MANIFEST_ARRAYS");

// ../src/modules/distribution/workflows/release-distribution-contract.ts
var OPERATION_KINDS = Object.freeze(["render", "install", "activate", "update", "uninstall", "verify"]);
var ACCEPTED_CONFORMANCE_ARTIFACTS = Object.freeze([
  Object.freeze({ path: "handoffs/tooling-engineer-MH-08.md", sha256: "6168cd3381edd6a8f4cb234e4cb1c714147c65ea11c92cd9210c6429663fcdb1" }),
  Object.freeze({ path: "validation/mh-08-r12-done-lead-validation.json", sha256: "23dee57b587426ef56fbbc60e38d0008eb8c972890d1ceb3cbe0ddde3bcebb85" }),
  Object.freeze({ path: "review/G-lane:MH-08/result-12-r2.json", sha256: "5141b2b45caee0e47ca21dd853db22f8d885161935b19049c2392036710d0bd4" }),
  Object.freeze({ path: "validation/mh-08-r12-review-r2-lead-validation.json", sha256: "0f8054585bd4aeae1780e49c67cf6e65efe7023aeafceeed6fe336090c0fc27e" })
]);

// ../src/modules/distribution/workflows/surface-manifest.ts
var SURFACE_KINDS = Object.freeze(["skill", "command", "agent"]);

// ../src/modules/host-runtime/workflows/host-capabilities-schema.ts
var UPDATE_COMMANDS = {
  marketplace_cli: "claude plugin marketplace update guild && claude plugin update guild@guild",
  self_update: "guild-run update",
  reinstall_command: "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update"
};
var INJECTION_SUPPORT = Object.freeze(["verified", "target", "absent"]);
var INJECTION_SUPPORT_SET = new Set(INJECTION_SUPPORT);
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
var REQUIRED_HOOK_EVENTS = Object.freeze([
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

// ../src/modules/host-runtime/workflows/host-registry-schema.ts
var HOST_IDS = Object.freeze([
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
var HOST_FAMILIES = Object.freeze([
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
var AUTH_PROBES = Object.freeze([
  "codex_stored_or_env",
  "none",
  "cursor_stored",
  "gh_auth",
  "opencode_stored_or_env",
  "acli_stored"
]);
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
var HOST_REGISTRY_ROWS = deepFreeze({
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
var RUNGS = Object.freeze(["native", "wrapped", "bridged", "emulated", "degraded"]);
var ADAPTER_SURFACES = Object.freeze(["interaction", "session", "semantic_tool", "browser"]);
var INFERRED_HOSTS = sealSet([
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
var RUNG_SET = new Set(RUNGS);
var SURFACE_SET = new Set(ADAPTER_SURFACES);

// ../src/modules/host-runtime/workflows/host-profiles-validate.ts
var KNOWN_HOST_IDS = new Set(HOST_IDS);
var VALID_HOST_PROFILE_ENTRY_KEYS = sealSet(["models", "enabled"], "VALID_HOST_PROFILE_ENTRY_KEYS");
var VALID_HOST_PROFILE_MODEL_KEYS = sealSet(["cheap", "mid", "powerful"], "VALID_HOST_PROFILE_MODEL_KEYS");

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

// ../src/modules/host-runtime/workflows/host-adapter-contract.ts
var HOST_ADAPTER_OPERATIONS = Object.freeze([
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

// ../src/modules/host-runtime/workflows/host-capability-snapshot.ts
var import_node_crypto = require("node:crypto");
var HOST_CAPABILITY_SNAPSHOT_SCHEMA = "guild.host_capability_snapshot.v1";
var HOST_CAPABILITY_SNAPSHOT_RESULT_SCHEMA = "guild.host_capability_snapshot_result.v1";
var HOST_CAPABILITY_IDS = Object.freeze([
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
var HOST_ADAPTER_OWNED_CONCERNS = Object.freeze([
  "host_identity_resolution",
  "host_entry_point_binding",
  "host_capability_snapshot",
  "host_native_event_normalization"
]);
var HOST_ADAPTER_NOT_OWNED_CONCERNS = Object.freeze([
  "lifecycle_state",
  "gate_policy",
  "artifact_semantics",
  "document_rendering",
  "transport_execution"
]);
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

// ../src/modules/distribution/workflows/verify-installer.ts
var BUILD_ONCE_SNIPPET = "would run: npx tsx scripts/build-host-packages.ts --root . --out dist --generated-at <generated-at>";
var INSTALLER_HOST_EXPECTATIONS = deepFreeze([
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

// ../src/modules/communication/workflows/comms-format-lint.ts
var yaml = loadYamlApi();
var POLICY_EFFECTIVE_DATE = /* @__PURE__ */ new Date("2026-06-03T00:00:00Z");
function normalisePath(p) {
  return path4.normalize(p).replace(/\\/g, "/");
}
function loadInventoryAllowList() {
  const inventoryPath = path4.resolve(
    __dirname,
    // __dirname = <repo>/src/modules/communication/workflows; four `..` reach the
    // repo root: workflows → communication → modules → src → <repo>. (The prior
    // five-`..` overshot to the umbrella parent — a path that does not exist in a
    // standalone plugin checkout, so the allow-list silently never loaded.)
    "../../../..",
    ".guild/initiatives/active/communication-format-standardization/yaml-reader-inventory.json"
  );
  try {
    if (!fs3.existsSync(inventoryPath)) return /* @__PURE__ */ new Set();
    const raw = fs3.readFileSync(inventoryPath, "utf8");
    const data = JSON.parse(raw);
    const files = /* @__PURE__ */ new Set();
    for (const reader of data.readers ?? []) {
      if (reader.file) {
        files.add(normalisePath(reader.file));
      }
    }
    return files;
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function isLegacyExempt(filePath) {
  const normalised = normalisePath(filePath);
  return normalised.includes("legacy-example") || normalised.includes("fixtures/legacy-example");
}
function isBuildArtifactExempt(filePath) {
  return normalisePath(filePath).includes("/dist/");
}
function isHandoffFixtureExempt(filePath) {
  const normalised = normalisePath(filePath);
  return normalised.includes("/fixtures/") && normalised.includes("/handoffs/");
}
function extractAllHandoffEnvelopes(content) {
  const results = [];
  const pattern = /```guild\.handoff\.v2\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    if (match[1]) {
      try {
        results.push(JSON.parse(match[1].trim()));
      } catch {
        results.push(null);
      }
    }
  }
  return results;
}
var ALLOWED_ENVELOPE_KEYS = ALLOWED_TOP_LEVEL_KEYS;
var VALID_ENVELOPE_TIERS = /* @__PURE__ */ new Set(["cheap", "mid", "powerful"]);
var VALID_ENVELOPE_STATUSES = /* @__PURE__ */ new Set(["done", "blocked", "escalate"]);
var ENVELOPE_SUMMARY_MAX = 600;
var ENVELOPE_NOTES_MAX = 200;
function envelopeShapeErrors(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["envelope must be a non-null object"];
  }
  const obj = value;
  const errors = [];
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_ENVELOPE_KEYS.has(k)) {
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
  if (typeof obj["tier"] !== "string" || !VALID_ENVELOPE_TIERS.has(obj["tier"])) {
    errors.push(`tier must be one of cheap|mid|powerful; got ${JSON.stringify(obj["tier"])}`);
  }
  if (typeof obj["status"] !== "string" || !VALID_ENVELOPE_STATUSES.has(obj["status"])) {
    errors.push(
      `status must be one of done|blocked|escalate; got ${JSON.stringify(obj["status"])}`
    );
  }
  if (typeof obj["summary"] !== "string") {
    errors.push("summary must be a string");
  } else if (obj["summary"].trim() === "") {
    errors.push("summary must not be empty");
  } else if (obj["summary"].length > ENVELOPE_SUMMARY_MAX) {
    errors.push(
      `summary exceeds ${ENVELOPE_SUMMARY_MAX} char cap (bloat rejection SC-7): got ${obj["summary"].length} chars`
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
    } else if (obj["notes"].length > ENVELOPE_NOTES_MAX) {
      errors.push(
        `notes exceeds ${ENVELOPE_NOTES_MAX} char cap (O-4 binding resolution): got ${obj["notes"].length} chars`
      );
    }
  }
  if (obj["injection_clean"] !== void 0 && !ALLOWED_INJECTION_CLEAN_VALUES.has(obj["injection_clean"])) {
    errors.push(
      `injection_clean must be one of clean|flagged|unverified; got ${JSON.stringify(obj["injection_clean"])}`
    );
  }
  return errors;
}
function looksLikeReceipt(filePath, content) {
  if (!filePath.endsWith(".md")) return false;
  const normalised = normalisePath(filePath);
  if (normalised.includes("/handoffs/") || normalised.includes("/receipts/")) return true;
  if (/^type:\s*handoff_receipt\s*$/m.test(content)) return true;
  return false;
}
function checkAmbiguousReceipt(filePath, content) {
  if (!looksLikeReceipt(filePath, content)) return [];
  const envelopes = extractAllHandoffEnvelopes(content);
  if (envelopes.length === 0) {
    return [
      {
        check: "a",
        severity: "warn",
        file: filePath,
        message: "handoff receipt has no embedded `guild.handoff.v2` block \u2014 a valid receipt must embed exactly one (OD-2, communication-format-policy \xA77)"
      }
    ];
  }
  if (envelopes.length >= 2) {
    return [
      {
        check: "a",
        severity: "warn",
        file: filePath,
        message: `handoff receipt has ${envelopes.length} embedded \`guild.handoff.v2\` blocks (duplicate) \u2014 exactly one is required (OD-2)`
      }
    ];
  }
  const envelope = envelopes[0];
  if (envelope === null) {
    return [
      {
        check: "a",
        severity: "warn",
        file: filePath,
        message: "handoff receipt's embedded `guild.handoff.v2` block is not valid JSON (strict v2 requires parseable JSON)"
      }
    ];
  }
  const shapeErrors = envelopeShapeErrors(envelope);
  if (shapeErrors.length > 0) {
    return [
      {
        check: "a",
        severity: "warn",
        file: filePath,
        message: `handoff receipt's embedded \`guild.handoff.v2\` block fails shape validation: ` + shapeErrors.join("; ")
      }
    ];
  }
  return [];
}
var HAND_ROLLED_PATTERN_SOURCES = [
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
  {
    src: String.raw`/\^(?!(?:https?|ftp|file|wss?|data|mailto)[:/])[A-Za-z_][A-Za-z0-9_-]*:`,
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
var HAND_ROLLED_PATTERNS = HAND_ROLLED_PATTERN_SOURCES.map(({ src, label }) => ({
  pattern: new RegExp(src),
  label
}));
var SELF_EXEMPT_SUFFIXES = [
  "src/modules/communication/workflows/comms-format-lint.ts",
  "scripts/comms/comms-format-lint.ts",
  "scripts/comms/__tests__/comms-format-lint.test.ts"
];
function checkNewHandRolledYaml(filePath, content, allowList) {
  const ext = path4.extname(filePath).toLowerCase();
  if (![".ts", ".js", ".tsx", ".jsx"].includes(ext)) return [];
  const normalised = normalisePath(filePath);
  if (SELF_EXEMPT_SUFFIXES.some((s) => normalised.endsWith(s))) return [];
  for (const inventoried of allowList) {
    if (normalised.endsWith(inventoried) || normalised.includes(inventoried)) return [];
  }
  const YAML_SURFACE_SIGNAL = /\.ya?ml\b|(?:from|require\s*\(|import\s*\()\s*['"`](?:js-)?yaml['"`]|\byaml\s*\.\s*(?:load|loadAll|parse|safeLoad)\b|front[-\s]?matter|(?:['"`\/^]|\\[rn])-{3}(?:['"`\/$]|\\[rn])|\^-\{3\}\$/i;
  if (!YAML_SURFACE_SIGNAL.test(content)) return [];
  const findings = [];
  for (const { pattern, label } of HAND_ROLLED_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        check: "b",
        severity: "warn",
        file: filePath,
        message: `new hand-rolled YAML reader detected (${label}) \u2014 use shared js-yaml parser instead (OD-3, communication-format-policy \xA7"New artifact must declare its category")`
      });
      break;
    }
  }
  return findings;
}
var COMM_ARTIFACT_TYPES = /* @__PURE__ */ new Set([
  "handoff_receipt",
  "run_manifest",
  "team_manifest",
  "review_packet",
  "learning_checkpoint",
  "trace_event"
]);
function isHumanKnowledgeDoc(filePath) {
  const normalised = normalisePath(filePath);
  return normalised.includes("/docs/knowledge/") || normalised.includes("/.guild/wiki/");
}
function checkUndeclaredCategory(filePath, content) {
  if (!filePath.endsWith(".md") && !filePath.endsWith(".yaml") && !filePath.endsWith(".yml")) {
    return [];
  }
  if (isHumanKnowledgeDoc(filePath)) return [];
  const fmStart = content.indexOf("---");
  if (fmStart !== 0 && fmStart !== -1) return [];
  if (fmStart === -1) return [];
  const fmEnd = content.indexOf("\n---", fmStart + 3);
  if (fmEnd === -1) return [];
  const rawFrontmatter = content.slice(fmStart + 3, fmEnd).trim();
  if (!rawFrontmatter) return [];
  let fm;
  try {
    fm = yaml.load(rawFrontmatter);
  } catch {
    return [];
  }
  if (typeof fm !== "object" || fm === null || Array.isArray(fm)) return [];
  const fmObj = fm;
  const artifactType = typeof fmObj["type"] === "string" ? fmObj["type"].trim() : null;
  if (!artifactType || !COMM_ARTIFACT_TYPES.has(artifactType)) return [];
  if (fmObj["artifact_category"] !== void 0 && fmObj["artifact_category"] !== null && fmObj["artifact_category"] !== "") {
    return [];
  }
  return [
    {
      check: "c",
      severity: "warn",
      file: filePath,
      message: `communication artifact of type "${artifactType}" does not declare \`artifact_category:\` \u2014 every new communication artifact must state its category before choosing a format (communication-format-policy \xA7"New artifact must declare its category")`
    }
  ];
}
function readRunStartedAt(runDir) {
  const runYamlPath = path4.join(runDir, "run.yaml");
  try {
    if (!fs3.existsSync(runYamlPath)) return null;
    const raw = fs3.readFileSync(runYamlPath, "utf8");
    const m = raw.match(/^started_at:[ \t]*(.*)$/m);
    if (!m || !m[1] || m[1].trim() === "") return null;
    const d = new Date(m[1].trim());
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
function isRunInScope(runDir) {
  const d = readRunStartedAt(runDir);
  if (d === null) return false;
  return d >= POLICY_EFFECTIVE_DATE;
}
function resolvePathsFromDiffRange(diffRange) {
  try {
    const { execSync } = require("child_process");
    const output = execSync(`git diff --name-only ${diffRange}`, {
      encoding: "utf8",
      timeout: 1e4
    });
    return output.trim().split("\n").filter(Boolean).map((p) => path4.resolve(p));
  } catch {
    return [];
  }
}
function lintCommsFormat(opts = {}) {
  const findings = [];
  const allowList = loadInventoryAllowList();
  const inScopePaths = new Set(opts.paths ?? []);
  if (opts.diffRange) {
    for (const p of resolvePathsFromDiffRange(opts.diffRange)) {
      inScopePaths.add(p);
    }
  }
  for (const filePath of inScopePaths) {
    if (isLegacyExempt(filePath)) continue;
    if (isBuildArtifactExempt(filePath)) continue;
    let content;
    try {
      if (!fs3.existsSync(filePath)) continue;
      content = fs3.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (!isHandoffFixtureExempt(filePath)) {
      findings.push(...checkAmbiguousReceipt(filePath, content));
    }
    findings.push(...checkNewHandRolledYaml(filePath, content, allowList));
    findings.push(...checkUndeclaredCategory(filePath, content));
  }
  if (opts.runsDir) {
    try {
      if (!fs3.existsSync(opts.runsDir)) return findings;
      const runDirs = fs3.readdirSync(opts.runsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path4.join(opts.runsDir, d.name));
      for (const runDir of runDirs) {
        if (!isRunInScope(runDir)) continue;
        const handoffsDir = path4.join(runDir, "handoffs");
        if (!fs3.existsSync(handoffsDir)) continue;
        const receiptFiles = fs3.readdirSync(handoffsDir, { withFileTypes: true }).filter((f) => f.isFile() && f.name.endsWith(".md")).map((f) => path4.join(handoffsDir, f.name));
        for (const receiptPath of receiptFiles) {
          if (isLegacyExempt(receiptPath)) continue;
          if (inScopePaths.has(receiptPath)) continue;
          let content;
          try {
            content = fs3.readFileSync(receiptPath, "utf8");
          } catch {
            continue;
          }
          if (!isHandoffFixtureExempt(receiptPath)) {
            findings.push(...checkAmbiguousReceipt(receiptPath, content));
          }
        }
      }
    } catch {
    }
  }
  return findings;
}

// comms-format-lint.ts
async function readStdin() {
  return new Promise((resolve6) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve6(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve6(""));
  });
}
function isEnforceEnabled() {
  return process.env["GUILD_COMMS_FORMAT_ENFORCE"] === "1";
}
function printFindings(findings, enforceMode) {
  if (findings.length === 0) {
    return false;
  }
  let hasCheckA = false;
  for (const f of findings) {
    const loc = f.line !== void 0 ? `:${f.line}` : "";
    process.stderr.write(
      `[comms-format-lint] WARN [check-${f.check}] ${f.file}${loc}: ${f.message}
`
    );
    if (f.check === "a") {
      hasCheckA = true;
    }
  }
  if (enforceMode && hasCheckA) {
    const checkAFindings = findings.filter((f) => f.check === "a");
    process.stderr.write(
      `[comms-format-lint] BLOCK: enforce mode active (GUILD_COMMS_FORMAT_ENFORCE=1) \u2014 ${checkAFindings.length} check-a violation(s) detected.
  Receipts must embed exactly ONE valid \`guild.handoff.v2\` JSON block (communication-format-policy \xA7"Handoff contract", OD-2).
  To suppress this block, fix the receipt or set GUILD_COMMS_FORMAT_ENFORCE=0.
`
    );
    return true;
  }
  const mode = enforceMode ? "enforce mode (check-b/c advisory only)" : "U5a warn mode";
  process.stderr.write(
    `[comms-format-lint] ${findings.length} warning(s) \u2014 non-blocking (${mode})
`
  );
  return false;
}
async function main2() {
  const enforceMode = isEnforceEnabled();
  const raw = await readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw.trim());
  } catch {
    process.exit(0);
  }
  const toolName = payload.tool_name ?? "";
  if (toolName !== "Write" && toolName !== "Edit") {
    process.exit(0);
  }
  const filePath = payload.tool_input?.file_path;
  if (typeof filePath !== "string" || filePath.trim() === "") {
    process.exit(0);
  }
  const absolutePath = path5.isAbsolute(filePath) ? filePath : path5.resolve(process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd(), filePath);
  let findings = [];
  try {
    findings = lintCommsFormat({ paths: [absolutePath], enforce: enforceMode });
  } catch (err) {
    process.stderr.write(
      `[comms-format-lint] WARN: lint core threw \u2014 ${err instanceof Error ? err.message : String(err)}
`
    );
    process.exit(0);
  }
  const shouldBlock = printFindings(findings, enforceMode);
  if (shouldBlock) {
    process.exit(2);
  }
  process.exit(0);
}
main2().catch((err) => {
  process.stderr.write(
    `[comms-format-lint] WARN: unexpected error \u2014 ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(0);
});
